package app.cadence

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.ui.Alignment
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private val Paper = Color(0xFF141311)
private val Ink = Color(0xFFF4F1EA)
private val Muted = Color(0xFFB7B1A6)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            MaterialTheme(colorScheme = darkColorScheme(background = Paper, surface = Paper, primary = Ink, onPrimary = Paper, onSurface = Ink, onBackground = Ink)) {
                Surface(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing), color = Paper) {
                    CadenceApp()
                }
            }
        }
    }
}

@Composable
private fun CadenceApp() {
    val context = LocalContext.current
    var doc by remember { mutableStateOf(Store.load(context)) }
    var view by remember { mutableStateOf("feed") }
    var categoryId by remember { mutableStateOf<String?>(null) }
    var draft by remember { mutableStateOf("") }
    var editing by remember { mutableStateOf<Task?>(null) }
    var settings by remember { mutableStateOf(false) }
    val today = todayKey()
    val scope = rememberCoroutineScope()

    fun commit(next: Doc) {
        doc = next
        Store.save(context, next)
    }

    val names = doc.categories.filter { !it.deleted }.associate { it.id to it.name }
    val visible = doc.tasks.filter { task ->
        if (task.deleted) return@filter false
        if (categoryId != null && task.categoryId != categoryId) return@filter false
        if (view == "done") return@filter task.done
        if (task.done) return@filter false
        when (view) {
            "feed" -> true
            "today" -> task.date == today
            "upcoming" -> task.date != null && task.date > today
            "overdue" -> task.date != null && task.date < today
            "later" -> task.date == null
            "repeats" -> task.repeat.kind != "none"
            else -> false
        }
    }

    Column(Modifier.fillMaxSize().padding(horizontal = 12.dp, vertical = 8.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text("Cadence", style = MaterialTheme.typography.titleLarge, color = Ink)
            TextButton(onClick = { settings = true }) { Text("Settings") }
        }
        Row(Modifier.horizontalScroll(rememberScrollState()).padding(vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf("feed", "today", "upcoming", "overdue", "later", "repeats", "done").forEach { id ->
                Filter(id.replaceFirstChar { it.uppercase() }, view == id) { view = id }
            }
        }
        LazyColumn(Modifier.weight(1f).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            items(visible, key = { it.id }) { task ->
                Row(Modifier.fillMaxWidth().padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f).clickable { editing = task }) {
                        Text(task.title, color = Ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        val meta = listOfNotNull(names[task.categoryId], repeatLabel(task.repeat).takeIf { task.repeat.kind != "none" }, task.date ?: "No date")
                        Text(meta.joinToString(" · "), color = Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    IconButton(onClick = { commit(doc.copy(tasks = doc.tasks.map { if (it.id == task.id) advance(it) else it })) }) {
                        Icon(Icons.Outlined.Check, contentDescription = if (task.done) "Undo ${task.title}" else "Complete ${task.title}", tint = Ink)
                    }
                }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                draft,
                { draft = it },
                modifier = Modifier.weight(1f).heightIn(max = 52.dp),
                placeholder = { Text("Add a task", color = Muted) },
                singleLine = true,
                colors = darkFieldColors(),
            )
            Button(onClick = {
                val title = draft.trim()
                if (title.isEmpty()) return@Button
                val now = java.time.Instant.now().toString()
                val task = Task(newId(), title, "", categoryId, if (view == "later") null else today, Repeat(), false, null, now, now)
                commit(doc.copy(tasks = listOf(task) + doc.tasks))
                draft = ""
            }) { Text("Add") }
        }
    }

    editing?.let { task ->
        DetailDialog(task, doc.categories.filter { !it.deleted }, onDismiss = { editing = null }) { updated ->
            commit(doc.copy(tasks = doc.tasks.map { if (it.id == updated.id) updated else it }))
            editing = null
        }
    }
    if (settings) {
        SettingsDialog(onDismiss = { settings = false }) { message ->
            scope.launch {
                val result = withContext(Dispatchers.IO) {
                    try {
                        Store.sync(context)
                    } catch (e: Exception) {
                        e.message ?: "Could not reach the server"
                    }
                }
                message(result)
                doc = Store.load(context)
            }
        }
    }
}

@Composable
private fun Filter(label: String, selected: Boolean, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        shape = RoundedCornerShape(50),
        colors = ButtonDefaults.buttonColors(containerColor = if (selected) Ink else Color(0xFF2A2824), contentColor = if (selected) Paper else Ink),
    ) { Text(label) }
}

@Composable
private fun darkFieldColors() = OutlinedTextFieldDefaults.colors(
    focusedTextColor = Ink,
    unfocusedTextColor = Ink,
    disabledTextColor = Muted,
    cursorColor = Ink,
    focusedLabelColor = Ink,
    unfocusedLabelColor = Muted,
    focusedBorderColor = Muted,
    unfocusedBorderColor = Color(0xFF5C574F),
)

@Composable
private fun DetailDialog(task: Task, categories: List<Category>, onDismiss: () -> Unit, onSave: (Task) -> Unit) {
    var title by remember { mutableStateOf(task.title) }
    var notes by remember { mutableStateOf(task.notes) }
    var categoryId by remember { mutableStateOf(task.categoryId) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Details") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(title, { title = it }, label = { Text("Task") }, colors = darkFieldColors())
                Text("Category", color = Muted)
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Filter("None", categoryId == null) { categoryId = null }
                    categories.forEach { category -> Filter(category.name, categoryId == category.id) { categoryId = category.id } }
                }
                OutlinedTextField(notes, { notes = it }, label = { Text("Notes") }, minLines = 4, colors = darkFieldColors())
                Text(repeatLabel(task.repeat) + " · " + (task.date ?: "No date"), color = Muted)
            }
        },
        confirmButton = {
            TextButton(onClick = {
                onSave(task.copy(title = title.trim().ifBlank { task.title }, notes = notes, categoryId = categoryId, updatedAt = java.time.Instant.now().toString()))
            }) { Text("Save") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Close") } },
    )
}

@Composable
private fun SettingsDialog(onDismiss: () -> Unit, onSync: ((String) -> Unit) -> Unit) {
    val context = LocalContext.current
    val (savedUrl, savedToken) = Store.credentials(context)
    var url by remember { mutableStateOf(savedUrl) }
    var token by remember { mutableStateOf(savedToken) }
    var status by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Settings") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(url, { url = it }, label = { Text("Server address") }, colors = darkFieldColors())
                OutlinedTextField(token, { token = it }, label = { Text("Token") }, colors = darkFieldColors())
                if (status.isNotBlank()) Text(status, color = Muted)
            }
        },
        confirmButton = {
            TextButton(onClick = {
                Store.saveCredentials(context, url, token)
                onSync { status = it }
            }) { Text("Save and sync") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Close") } },
    )
}
