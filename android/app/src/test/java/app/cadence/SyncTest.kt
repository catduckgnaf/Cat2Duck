package app.cadence

import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.ServerSocket
import java.net.Socket
import java.nio.charset.StandardCharsets
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SyncTest {
    private val local = Doc(emptyList(), listOf(Category("local", "Local", "2026-09-28T10:00:00Z", "2026-09-28T10:00:00Z")))

    private class StubServer(private val alwaysConflict: Boolean = false, private val conflictOnce: Boolean = false) : AutoCloseable {
        private val socket = ServerSocket(0)
        private val lock = Any()
        private var revision = 0
        private val puts = mutableListOf<String>()
        private var conflictServed = false
        private val thread = Thread {
            while (!socket.isClosed) {
                try { handle(socket.accept()) } catch (_: Exception) { if (!socket.isClosed) throw RuntimeException() }
            }
        }.apply { isDaemon = true; start() }

        val base = "http://127.0.0.1:${socket.localPort}"

        private fun handle(client: Socket) = client.use { connection ->
            val input = BufferedReader(InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))
            val request = input.readLine()?.split(" ") ?: return
            val headers = mutableMapOf<String, String>()
            while (true) {
                val line = input.readLine() ?: break
                if (line.isEmpty()) break
                val split = line.indexOf(':')
                if (split > 0) headers[line.substring(0, split).lowercase()] = line.substring(split + 1).trim()
            }
            val length = headers["content-length"]?.toIntOrNull() ?: 0
            val body = CharArray(length)
            var count = 0
            while (count < length) {
                val n = input.read(body, count, length - count)
                if (n < 0) break
                count += n
            }
            val (status, etag, response) = synchronized(lock) {
                when {
                    request[0] == "GET" && request.getOrNull(1) == "/trace/puts" -> Triple(200, null, JSONArray(puts).toString())
                    request[0] == "GET" -> {
                        val doc = if (revision == 0) Doc(emptyList(), emptyList()) else Doc(emptyList(), listOf(Category("remote", "Remote", "2026-09-28T11:00:00Z", "2026-09-28T11:00:00Z")))
                        Triple(200, "\"$revision\"", doc.toJson())
                    }
                    request[0] == "PUT" -> {
                        val match = headers["if-match"].orEmpty()
                        puts += match
                        when {
                            match != "\"$revision\"" -> Triple(409, "\"$revision\"", "{\"error\":\"State changed\"}")
                            alwaysConflict || (conflictOnce && !conflictServed) -> {
                                conflictServed = true
                                revision++
                                Triple(409, "\"$revision\"", "{\"error\":\"State changed\"}")
                            }
                            else -> {
                                revision++
                                Triple(200, "\"$revision\"", String(body, 0, count))
                            }
                        }
                    }
                    else -> Triple(404, null, "{}")
                }
            }
            val bytes = response.toByteArray(StandardCharsets.UTF_8)
            val out = connection.getOutputStream()
            out.write("HTTP/1.1 $status OK\r\nContent-Type: application/json\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n".toByteArray())
            if (etag != null) out.write("ETag: $etag\r\n".toByteArray())
            out.write("\r\n".toByteArray())
            out.write(bytes)
            out.flush()
        }

        fun putRevisions(): List<String> = synchronized(lock) { puts.toList() }
        override fun close() { socket.close(); thread.join(1000) }
    }

    @Test fun revisionAwareSyncUsesServerRevisionAndMerges() {
        StubServer().use { server ->
            val result = Store.sync(server.base, "test-token", local)
            assertEquals(listOf("\"0\""), server.putRevisions())
            assertEquals(listOf("local"), result.categories.map { it.id })
        }
    }

    @Test fun retriesConflictWithLatestRevision() {
        StubServer(conflictOnce = true).use { server ->
            val result = Store.sync(server.base, "test-token", local)
            assertEquals(listOf("\"0\"", "\"1\""), server.putRevisions())
            assertEquals(listOf("local", "remote"), result.categories.map { it.id }.sorted())
        }
    }

    @Test fun repeatedConflictsFailInsteadOfReportingSuccess() {
        StubServer(alwaysConflict = true).use { server ->
            try {
                Store.sync(server.base, "test-token", local)
                throw AssertionError("Conflict must fail")
            } catch (error: IllegalStateException) {
                assertTrue(error.message.orEmpty().contains("State changed"))
                assertEquals(3, server.putRevisions().size)
            }
        }
    }
}
