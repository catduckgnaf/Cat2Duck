package app.cadence

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import java.net.HttpURLConnection
import java.net.URL

object Store {
    private const val PREF = "cadence"
    private const val KEY = "doc"
    private const val URL_KEY = "serverUrl"
    private const val TOKEN_KEY = "serverToken"

    fun load(context: Context): Doc {
        val raw = context.getSharedPreferences(PREF, Context.MODE_PRIVATE).getString(KEY, null) ?: return Doc(emptyList(), emptyList())
        return try {
            parseDoc(raw)
        } catch (_: Exception) {
            Doc(emptyList(), emptyList())
        }
    }

    fun save(context: Context, doc: Doc) {
        context.getSharedPreferences(PREF, Context.MODE_PRIVATE).edit().putString(KEY, doc.toJson()).apply()
        refreshWidgets(context)
    }

    fun credentials(context: Context): Pair<String, String> {
        val prefs = context.getSharedPreferences(PREF, Context.MODE_PRIVATE)
        return (prefs.getString(URL_KEY, "") ?: "") to (prefs.getString(TOKEN_KEY, "") ?: "")
    }

    fun saveCredentials(context: Context, url: String, token: String) {
        context.getSharedPreferences(PREF, Context.MODE_PRIVATE).edit()
            .putString(URL_KEY, url.trim().trimEnd('/'))
            .putString(TOKEN_KEY, token.trim())
            .apply()
    }

    fun refreshWidgets(context: Context) {
        val manager = AppWidgetManager.getInstance(context)
        val ids = manager.getAppWidgetIds(ComponentName(context, TodayWidget::class.java))
        if (ids.isEmpty()) return
        context.sendBroadcast(
            Intent(context, TodayWidget::class.java).apply {
                action = AppWidgetManager.ACTION_APPWIDGET_UPDATE
                putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
            },
        )
    }

    fun sync(context: Context): String {
        val (url, token) = credentials(context)
        if (url.isBlank() || token.isBlank()) return "Add a server address and token first."
        val remote = http(url, token, "GET", null)
        val local = load(context)
        val merged = Doc(mergeTasks(local.tasks, remote.tasks), mergeCategories(local.categories, remote.categories))
        http(url, token, "PUT", merged.toJson())
        save(context, merged)
        return "Synced"
    }

    private fun mergeTasks(local: List<Task>, remote: List<Task>): List<Task> {
        val map = linkedMapOf<String, Task>()
        remote.forEach { map[it.id] = it }
        local.forEach { item ->
            val other = map[item.id]
            if (other == null || item.updatedAt > other.updatedAt) map[item.id] = item
        }
        return map.values.toList()
    }

    private fun mergeCategories(local: List<Category>, remote: List<Category>): List<Category> {
        val map = linkedMapOf<String, Category>()
        remote.forEach { map[it.id] = it }
        local.forEach { item ->
            val other = map[item.id]
            if (other == null || item.updatedAt > other.updatedAt) map[item.id] = item
        }
        return map.values.toList()
    }

    private fun http(base: String, token: String, method: String, body: String?): Doc {
        val path = if (method == "GET" || method == "PUT") "/v1/state" else "/health"
        val conn = (URL(base.trimEnd('/') + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 8000
            readTimeout = 8000
            setRequestProperty("Authorization", "Bearer $token")
            if (body != null) {
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
                outputStream.use { it.write(body.toByteArray()) }
            }
        }
        val code = conn.responseCode
        val text = (if (code in 200..299) conn.inputStream else conn.errorStream)?.bufferedReader()?.readText().orEmpty()
        if (code !in 200..299) error(text.ifBlank { "Server responded $code" })
        if (method == "PUT") return Doc(emptyList(), emptyList())
        return parseDoc(text)
    }
}
