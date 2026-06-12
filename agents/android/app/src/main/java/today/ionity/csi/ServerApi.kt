package today.ionity.csi

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request

@Serializable
data class StepView(
    val index: Int,
    val axis: String,
    val valueMeters: Double,
    val direction: String? = null,
    val repetition: Int,
)

@Serializable
data class SessionView(
    val sessionId: String,
    val deviceId: String,
    val apBssid: String,
    val direction: String,
    val total: Int,
    val accepted: Int,
    val progress: Double,
    val current: StepView? = null,
    val complete: Boolean,
)

/** Minimal REST client for the Ionity-CSI server (calibration sessions). */
class ServerApi(private val baseUrl: String) {
    private val http = OkHttpClient()
    private val json = Json { ignoreUnknownKeys = true }

    fun getSession(sessionId: String): SessionView? {
        val req = Request.Builder().url("$baseUrl/api/sessions/$sessionId").build()
        http.newCall(req).execute().use { res ->
            if (!res.isSuccessful) return null
            val body = res.body?.string() ?: return null
            return runCatching { json.decodeFromString<SessionView>(body) }.getOrNull()
        }
    }
}
