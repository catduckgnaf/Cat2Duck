package app.cadence

import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar
import java.util.UUID

data class Repeat(
    val kind: String = "none",
    val every: Int = 1,
    val unit: String = "day",
    val days: List<Int> = emptyList(),
)

data class Category(
    val id: String,
    val name: String,
    val createdAt: String,
    val updatedAt: String,
    val deleted: Boolean = false,
)

data class Task(
    val id: String,
    val title: String,
    val notes: String,
    val categoryId: String?,
    val date: String?,
    val repeat: Repeat,
    val done: Boolean,
    val completedAt: String?,
    val createdAt: String,
    val updatedAt: String,
    val deleted: Boolean = false,
)

data class Doc(val tasks: List<Task>, val categories: List<Category>)

fun todayKey(): String = toKey(Calendar.getInstance())

fun toKey(c: Calendar): String =
    "%04d-%02d-%02d".format(c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH))

fun parseKey(key: String): Calendar {
    val p = key.split("-")
    return Calendar.getInstance().apply {
        set(Calendar.YEAR, p[0].toInt())
        set(Calendar.MONTH, p[1].toInt() - 1)
        set(Calendar.DAY_OF_MONTH, p[2].toInt())
        set(Calendar.HOUR_OF_DAY, 12)
        set(Calendar.MINUTE, 0)
        set(Calendar.SECOND, 0)
        set(Calendar.MILLISECOND, 0)
    }
}

fun addDays(key: String, n: Int): String {
    val c = parseKey(key)
    c.add(Calendar.DAY_OF_MONTH, n)
    return toKey(c)
}

fun jsDay(c: Calendar): Int = c.get(Calendar.DAY_OF_WEEK) - 1

fun daysBetween(a: String, b: String): Int =
    Math.round((parseKey(b).timeInMillis - parseKey(a).timeInMillis) / 86_400_000.0).toInt()

private fun daysInMonth(c: Calendar): Int =
    Calendar.getInstance().apply {
        timeInMillis = c.timeInMillis
        set(Calendar.DAY_OF_MONTH, 1)
        add(Calendar.MONTH, 1)
        add(Calendar.DAY_OF_MONTH, -1)
    }.get(Calendar.DAY_OF_MONTH)

fun nextOccurrence(anchor: String, repeat: Repeat, after: String): String? {
    if (repeat.kind == "none" || (repeat.kind == "days" && repeat.days.isEmpty())) return null
    var cursor = addDays(after, 1)
    repeat(800) {
        if (matches(cursor, anchor, repeat)) return cursor
        cursor = addDays(cursor, 1)
    }
    return null
}

private fun matches(day: String, anchor: String, repeat: Repeat): Boolean {
    val d = parseKey(day)
    val a = parseKey(anchor)
    return when (repeat.kind) {
        "daily" -> true
        "weekdays" -> jsDay(d) != 0 && jsDay(d) != 6
        "weekly" -> jsDay(d) == jsDay(a)
        "monthly" -> d.get(Calendar.DAY_OF_MONTH) == minOf(a.get(Calendar.DAY_OF_MONTH), daysInMonth(d))
        "interval" -> {
            val every = repeat.every.coerceIn(1, 99)
            when (repeat.unit) {
                "week" -> {
                    val diff = daysBetween(anchor, day)
                    diff >= 0 && diff % (every * 7) == 0
                }
                "month" -> {
                    val months = (d.get(Calendar.YEAR) - a.get(Calendar.YEAR)) * 12 +
                        (d.get(Calendar.MONTH) - a.get(Calendar.MONTH))
                    months >= 0 && months % every == 0 &&
                        d.get(Calendar.DAY_OF_MONTH) == minOf(a.get(Calendar.DAY_OF_MONTH), daysInMonth(d))
                }
                else -> {
                    val diff = daysBetween(anchor, day)
                    diff >= 0 && diff % every == 0
                }
            }
        }
        "days" -> repeat.days.contains(jsDay(d))
        else -> false
    }
}

fun advance(task: Task, today: String = todayKey()): Task {
    val now = java.time.Instant.now().toString()
    if (task.repeat.kind == "none") {
        val done = !task.done
        return task.copy(done = done, completedAt = if (done) now else null, updatedAt = now)
    }
    val anchor = task.date ?: today
    val after = if (task.date != null && task.date > today) task.date else today
    val next = nextOccurrence(anchor, task.repeat, after)
        ?: return task.copy(done = true, completedAt = now, updatedAt = now)
    return task.copy(date = next, done = false, completedAt = now, updatedAt = now)
}

fun repeatLabel(repeat: Repeat): String = when (repeat.kind) {
    "daily" -> "Every day"
    "weekdays" -> "Weekdays"
    "weekly" -> "Every week"
    "monthly" -> "Every month"
    "interval" -> if (repeat.every <= 1) "Every ${repeat.unit}" else "Every ${repeat.every} ${repeat.unit}s"
    "days" -> if (repeat.days.isEmpty()) "Choose days" else repeat.days.sorted().joinToString(" ")
    else -> "Once"
}

fun newId(): String = UUID.randomUUID().toString()

fun parseDoc(raw: String): Doc {
    val root = JSONObject(raw.ifBlank { "{}" })
    return Doc(parseTasks(root.optJSONArray("tasks")), parseCategories(root.optJSONArray("categories")))
}

private fun parseTasks(array: JSONArray?): List<Task> {
    if (array == null) return emptyList()
    return buildList {
        for (i in 0 until array.length()) {
            val o = array.optJSONObject(i) ?: continue
            val repeat = o.optJSONObject("repeat")
            val days = mutableListOf<Int>()
            val dayArr = repeat?.optJSONArray("days")
            if (dayArr != null) for (d in 0 until dayArr.length()) days.add(dayArr.optInt(d))
            add(
                Task(
                    id = o.optString("id"),
                    title = o.optString("title"),
                    notes = o.optString("notes"),
                    categoryId = if (!o.has("categoryId") || o.isNull("categoryId")) null else o.getString("categoryId"),
                    date = if (!o.has("date") || o.isNull("date")) null else o.getString("date"),
                    repeat = Repeat(
                        kind = repeat?.optString("kind", "none") ?: "none",
                        every = repeat?.optInt("every", 1) ?: 1,
                        unit = repeat?.optString("unit", "day") ?: "day",
                        days = days,
                    ),
                    done = o.optBoolean("done", false),
                    completedAt = if (!o.has("completedAt") || o.isNull("completedAt")) null else o.getString("completedAt"),
                    createdAt = o.optString("createdAt"),
                    updatedAt = o.optString("updatedAt"),
                    deleted = o.optBoolean("deleted", false),
                ),
            )
        }
    }
}

private fun parseCategories(array: JSONArray?): List<Category> {
    if (array == null) return emptyList()
    return buildList {
        for (i in 0 until array.length()) {
            val o = array.optJSONObject(i) ?: continue
            add(
                Category(
                    id = o.optString("id"),
                    name = o.optString("name"),
                    createdAt = o.optString("createdAt"),
                    updatedAt = o.optString("updatedAt"),
                    deleted = o.optBoolean("deleted", false),
                ),
            )
        }
    }
}

fun Doc.toJson(): String {
    val tasks = JSONArray()
    for (task in this.tasks) {
        val repeat = JSONObject()
            .put("kind", task.repeat.kind)
            .put("every", task.repeat.every)
            .put("unit", task.repeat.unit)
            .put("days", JSONArray(task.repeat.days))
        tasks.put(
            JSONObject()
                .put("id", task.id)
                .put("title", task.title)
                .put("notes", task.notes)
                .put("categoryId", task.categoryId ?: JSONObject.NULL)
                .put("date", task.date ?: JSONObject.NULL)
                .put("repeat", repeat)
                .put("done", task.done)
                .put("completedAt", task.completedAt ?: JSONObject.NULL)
                .put("createdAt", task.createdAt)
                .put("updatedAt", task.updatedAt)
                .put("deleted", task.deleted),
        )
    }
    val categories = JSONArray()
    for (category in this.categories) {
        categories.put(
            JSONObject()
                .put("id", category.id)
                .put("name", category.name)
                .put("createdAt", category.createdAt)
                .put("updatedAt", category.updatedAt)
                .put("deleted", category.deleted),
        )
    }
    return JSONObject().put("tasks", tasks).put("categories", categories).toString()
}
