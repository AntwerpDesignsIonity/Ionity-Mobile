package today.ionity.csi

import android.Manifest
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json

/**
 * Ionity-CSI Android agent UI. Scans WiFi, walks a server-created calibration
 * session (RSSI + 802.11mc FTM range per point), and runs continuous inference
 * captures. Stock Android exposes RSSI + FTM only — never true CSI.
 */
class MainActivity : ComponentActivity() {
    private val json = Json { encodeDefaults = false }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { MaterialTheme { AgentScreen() } }
    }

    @Composable
    private fun AgentScreen() {
        val ctx = this
        var deviceId by remember { mutableStateOf("android-1") }
        var mqttHost by remember { mutableStateOf("192.168.1.10") }
        var serverUrl by remember { mutableStateOf("http://192.168.1.10:8080") }
        var sessionId by remember { mutableStateOf("") }
        var status by remember { mutableStateOf("Grant permissions, then Scan.") }
        var aps by remember { mutableStateOf(listOf<AccessPoint>()) }
        var selected by remember { mutableStateOf<AccessPoint?>(null) }
        var runJob by remember { mutableStateOf<Job?>(null) }

        val wifi = remember { WifiCapture(ctx) }
        val rtt = remember { RttRanger(ctx) }
        val mqtt = remember(mqttHost) { MqttPublisher(mqttHost, 1883) }
        val server = remember(serverUrl) { ServerApi(serverUrl) }

        val permLauncher = rememberLauncherForActivityResult(
            ActivityResultContracts.RequestMultiplePermissions(),
        ) { status = "Permissions updated. Ready to scan." }

        LaunchedEffect(Unit) {
            permLauncher.launch(
                arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.NEARBY_WIFI_DEVICES),
            )
            runCatching { mqtt.connect() }
        }

        Column(Modifier.padding(16.dp).fillMaxSize(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Ionity-CSI Agent", style = MaterialTheme.typography.headlineSmall)
            OutlinedTextField(deviceId, { deviceId = it }, label = { Text("Device id") })
            OutlinedTextField(mqttHost, { mqttHost = it }, label = { Text("MQTT host") })
            OutlinedTextField(serverUrl, { serverUrl = it }, label = { Text("Server URL") })
            Text("FTM (802.11mc): ${if (rtt.isAvailable()) "available" else "unavailable"}")

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = {
                    aps = wifi.scan().sortedByDescending { it.rssi ?: -200.0 }
                    runCatching {
                        mqtt.publish(
                            Topics.status(deviceId),
                            json.encodeToString(
                                StatusMessage.serializer(),
                                StatusMessage(deviceId, ts = System.currentTimeMillis(), state = "scanning", scan = aps),
                            ),
                        )
                    }
                    status = "Scanned ${aps.size} APs."
                }) { Text("Scan") }

                Button(
                    enabled = selected != null && sessionId.isNotBlank(),
                    onClick = {
                        lifecycleScope.launch {
                            status = captureCalibrationPoint(wifi, rtt, mqtt, server, deviceId, selected!!, sessionId)
                        }
                    },
                ) { Text("Capture point") }
            }

            OutlinedTextField(sessionId, { sessionId = it }, label = { Text("Calibration session id") })

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    enabled = selected != null && runJob == null,
                    onClick = {
                        runJob = lifecycleScope.launch {
                            while (true) {
                                captureInference(wifi, rtt, mqtt, deviceId, selected!!)
                                delay(1000)
                            }
                        }
                        status = "Running inference…"
                    },
                ) { Text("Run") }
                Button(enabled = runJob != null, onClick = {
                    runJob?.cancel(); runJob = null; status = "Stopped."
                }) { Text("Stop") }
            }

            Text(status)
            Divider()
            Text("Tap an AP to target it:")
            LazyColumn(Modifier.weight(1f)) {
                items(aps) { ap ->
                    val mark = if (ap.bssid == selected?.bssid) "● " else "○ "
                    Text(
                        "$mark${ap.ssid.ifBlank { "(hidden)" }}  ${ap.rssi?.toInt()} dBm  ${ap.bssid}",
                        Modifier.fillMaxWidth().padding(vertical = 6.dp).clickable { selected = ap },
                    )
                }
            }
        }
    }

    private suspend fun captureCalibrationPoint(
        wifi: WifiCapture, rtt: RttRanger, mqtt: MqttPublisher, server: ServerApi,
        deviceId: String, ap: AccessPoint, sessionId: String,
    ): String {
        val session = server.getSession(sessionId) ?: return "Session not found."
        val step = session.current ?: return if (session.complete) "Calibration complete." else "No current step."
        val start = System.currentTimeMillis()
        val (rssi, resolved) = wifi.dwell(ap.bssid, 4000)
        val ftm = wifi.findByBssid(ap.bssid)?.let { rtt.range(it) }
        val label = CalibrationLabel(step.axis, step.valueMeters, step.direction, step.repetition)
        val capture = Capture(
            deviceId = deviceId,
            ap = resolved ?: ap,
            startTs = start,
            endTs = System.currentTimeMillis(),
            measurement = Measurement(rssi, emptyList(), ftm?.first, ftm?.second),
            label = label,
            sessionId = sessionId,
        )
        mqtt.publish(Topics.capture(deviceId), json.encodeToString(Capture.serializer(), capture))
        return "Captured ${step.axis} ${step.valueMeters} (pass ${step.repetition + 1}); ${rssi.size} RSSI samples."
    }

    private suspend fun captureInference(
        wifi: WifiCapture, rtt: RttRanger, mqtt: MqttPublisher, deviceId: String, ap: AccessPoint,
    ) {
        val start = System.currentTimeMillis()
        val (rssi, resolved) = wifi.dwell(ap.bssid, 1000)
        val ftm = wifi.findByBssid(ap.bssid)?.let { rtt.range(it) }
        val capture = Capture(
            deviceId = deviceId,
            ap = resolved ?: ap,
            startTs = start,
            endTs = System.currentTimeMillis(),
            measurement = Measurement(rssi, emptyList(), ftm?.first, ftm?.second),
        )
        mqtt.publish(Topics.capture(deviceId), json.encodeToString(Capture.serializer(), capture))
    }
}
