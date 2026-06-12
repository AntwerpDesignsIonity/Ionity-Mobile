package today.ionity.csi

import android.content.Context
import android.net.wifi.ScanResult
import android.net.wifi.WifiManager
import kotlinx.coroutines.delay

/**
 * RSSI + scan capture on stock Android. Stock phones expose RSSI and scan
 * results but NOT true CSI — this agent therefore reports RSSI (+ FTM range via
 * [RttRanger]) only. All values are read from WifiManager; nothing is invented.
 */
class WifiCapture(context: Context) {
    private val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager

    fun scan(): List<AccessPoint> =
        wifi.scanResults.map { it.toAccessPoint() }

    fun findByBssid(bssid: String): ScanResult? =
        wifi.scanResults.firstOrNull { it.BSSID.equals(bssid, ignoreCase = true) }

    /** Dwell: poll RSSI for [bssid] over [dwellMs] at ~2 Hz. */
    suspend fun dwell(bssid: String, dwellMs: Long): Pair<List<RssiSample>, AccessPoint?> {
        val samples = mutableListOf<RssiSample>()
        val end = System.currentTimeMillis() + dwellMs
        var ap: AccessPoint? = null
        while (System.currentTimeMillis() < end) {
            val r = wifi.scanResults.firstOrNull { it.BSSID.equals(bssid, ignoreCase = true) }
            if (r != null) {
                samples.add(RssiSample(r.level.toDouble(), System.currentTimeMillis()))
                ap = r.toAccessPoint()
            }
            delay(500)
        }
        return samples to ap
    }
}

private fun ScanResult.toAccessPoint(): AccessPoint {
    val ssid = if (android.os.Build.VERSION.SDK_INT >= 33) wifiSsid?.toString()?.trim('"') ?: "" else @Suppress("DEPRECATION") SSID
    return AccessPoint(
        bssid = BSSID,
        ssid = ssid,
        freqMhz = frequency.toDouble(),
        bandwidthMhz = channelWidthMhz(),
        rssi = level.toDouble(),
    )
}

private fun ScanResult.channelWidthMhz(): Double = when (channelWidth) {
    ScanResult.CHANNEL_WIDTH_20MHZ -> 20.0
    ScanResult.CHANNEL_WIDTH_40MHZ -> 40.0
    ScanResult.CHANNEL_WIDTH_80MHZ -> 80.0
    ScanResult.CHANNEL_WIDTH_160MHZ -> 160.0
    else -> 20.0
}
