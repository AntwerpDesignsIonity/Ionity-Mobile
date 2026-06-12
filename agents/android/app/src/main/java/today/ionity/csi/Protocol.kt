package today.ionity.csi

import kotlinx.serialization.Serializable

/** JSON shapes mirroring @ionity/metrification (validated server-side by zod). */

@Serializable
data class AccessPoint(
    val bssid: String,
    val ssid: String,
    val freqMhz: Double,
    val bandwidthMhz: Double? = null,
    val rssi: Double? = null,
)

@Serializable
data class RssiSample(val rssi: Double, val ts: Long)

@Serializable
data class CsiFrame(
    val ts: Long,
    val amplitude: List<Double>,
    val phase: List<Double>,
    val rssi: Double? = null,
)

@Serializable
data class Measurement(
    val rssi: List<RssiSample>,
    val csi: List<CsiFrame>,
    val ftmDistanceMm: Double? = null,
    val ftmStdDevMm: Double? = null,
)

@Serializable
data class CalibrationLabel(
    val axis: String,
    val valueMeters: Double,
    val direction: String? = null,
    val repetition: Int,
)

@Serializable
data class Capture(
    val deviceId: String,
    val agent: String = "android",
    val ap: AccessPoint,
    val startTs: Long,
    val endTs: Long,
    val measurement: Measurement,
    val label: CalibrationLabel? = null,
    val sessionId: String? = null,
)

@Serializable
data class StatusMessage(
    val deviceId: String,
    val agent: String = "android",
    val ts: Long,
    val state: String,
    val scan: List<AccessPoint>? = null,
    val message: String? = null,
)

object Topics {
    fun capture(id: String) = "ionity/$id/capture"
    fun status(id: String) = "ionity/$id/status"
}
