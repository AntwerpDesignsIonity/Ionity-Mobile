package today.ionity.csi

import com.hivemq.client.mqtt.MqttClient
import com.hivemq.client.mqtt.datatypes.MqttQos
import com.hivemq.client.mqtt.mqtt5.Mqtt5AsyncClient
import java.nio.charset.StandardCharsets
import java.util.UUID

/** HiveMQ MQTT client wrapper for publishing captures + status. */
class MqttPublisher(host: String, port: Int) {
    private val client: Mqtt5AsyncClient = MqttClient.builder()
        .useMqttVersion5()
        .identifier("ionity-android-" + UUID.randomUUID())
        .serverHost(host)
        .serverPort(port)
        .buildAsync()

    fun connect() {
        client.connect()
    }

    fun publish(topic: String, payload: String) {
        client.publishWith()
            .topic(topic)
            .qos(MqttQos.AT_LEAST_ONCE)
            .payload(payload.toByteArray(StandardCharsets.UTF_8))
            .send()
    }

    fun close() {
        client.disconnect()
    }
}
