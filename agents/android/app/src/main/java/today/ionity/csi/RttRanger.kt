package today.ionity.csi

import android.content.Context
import android.content.pm.PackageManager
import android.net.wifi.ScanResult
import android.net.wifi.rtt.RangingRequest
import android.net.wifi.rtt.RangingResult
import android.net.wifi.rtt.RangingResultCallback
import android.net.wifi.rtt.WifiRttManager
import kotlin.coroutines.resume
import kotlinx.coroutines.suspendCancellableCoroutine

/**
 * 802.11mc FTM ranging via WifiRttManager (API 28+). Returns a real distance
 * estimate in millimetres to an FTM-capable AP, or null when unsupported / the
 * AP does not advertise 802.11mc responder support.
 */
class RttRanger(private val context: Context) {
    private val available: Boolean =
        context.packageManager.hasSystemFeature(PackageManager.FEATURE_WIFI_RTT)

    private val manager: WifiRttManager? =
        if (available) context.getSystemService(Context.WIFI_RTT_RANGING_SERVICE) as? WifiRttManager else null

    fun isAvailable(): Boolean = available && manager?.isAvailable == true

    /** @return Pair(distanceMm, stdDevMm) or null if ranging failed/unsupported. */
    suspend fun range(target: ScanResult): Pair<Double, Double>? {
        val mgr = manager ?: return null
        if (!mgr.isAvailable) return null
        @Suppress("DEPRECATION")
        if (android.os.Build.VERSION.SDK_INT < 33 && !target.is80211mcResponder) return null

        val request = RangingRequest.Builder().addAccessPoint(target).build()
        return suspendCancellableCoroutine { cont ->
            try {
                mgr.startRanging(request, context.mainExecutor, object : RangingResultCallback() {
                    override fun onRangingFailure(code: Int) = cont.resume(null)
                    override fun onRangingResults(results: List<RangingResult>) {
                        val r = results.firstOrNull { it.status == RangingResult.STATUS_SUCCESS }
                        cont.resume(r?.let { it.distanceMm.toDouble() to it.distanceStdDevMm.toDouble() })
                    }
                })
            } catch (e: SecurityException) {
                cont.resume(null)
            }
        }
    }
}
