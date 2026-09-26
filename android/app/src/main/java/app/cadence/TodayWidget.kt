package app.cadence

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.view.View
import android.widget.RemoteViews

class TodayWidget : AppWidgetProvider() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == ACTION_TOGGLE) {
            val id = intent.getStringExtra(EXTRA_ID) ?: return
            val doc = Store.load(context)
            Store.save(context, doc.copy(tasks = doc.tasks.map { if (it.id == id) advance(it) else it }))
            return
        }
        super.onReceive(context, intent)
    }

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        val doc = Store.load(context)
        val today = todayKey()
        val open = doc.tasks.filter { !it.deleted && !it.done && it.date == today }
        val names = doc.categories.filter { !it.deleted }.associate { it.id to it.name }
        ids.forEach { widgetId ->
            val views = RemoteViews(context.packageName, R.layout.widget_today)
            views.setTextViewText(R.id.widget_heading, "Today")
            views.setTextViewText(
                R.id.widget_sub,
                if (open.isEmpty()) "Nothing due. Repeats show only their next time." else "${open.size} open",
            )
            val launch = PendingIntent.getActivity(
                context,
                0,
                Intent(context, MainActivity::class.java),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            views.setOnClickPendingIntent(R.id.widget_heading, launch)
            repeat(5) { index ->
                val row = id(context, "row$index")
                val title = id(context, "title$index")
                val check = id(context, "check$index")
                val task = open.getOrNull(index)
                if (task == null) {
                    views.setViewVisibility(row, View.GONE)
                } else {
                    views.setViewVisibility(row, View.VISIBLE)
                    val category = names[task.categoryId]
                    views.setTextViewText(title, if (category == null) task.title else "$category · ${task.title}")
                    views.setOnClickPendingIntent(title, launch)
                    val toggle = Intent(context, TodayWidget::class.java).apply {
                        action = ACTION_TOGGLE
                        putExtra(EXTRA_ID, task.id)
                    }
                    views.setOnClickPendingIntent(
                        check,
                        PendingIntent.getBroadcast(
                            context,
                            task.id.hashCode(),
                            toggle,
                            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                        ),
                    )
                }
            }
            manager.updateAppWidget(widgetId, views)
        }
    }

    private fun id(context: Context, name: String): Int =
        context.resources.getIdentifier(name, "id", context.packageName)

    companion object {
        const val ACTION_TOGGLE = "app.cadence.TOGGLE"
        const val EXTRA_ID = "taskId"
    }
}
