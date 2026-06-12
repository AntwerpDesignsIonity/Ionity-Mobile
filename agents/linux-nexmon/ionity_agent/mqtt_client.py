"""Thin paho-mqtt publisher."""
from __future__ import annotations

import json

import paho.mqtt.client as mqtt


class MqttPublisher:
    def __init__(self, host: str, port: int, client_id: str):
        self._client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=client_id)
        self._host = host
        self._port = port

    def connect(self) -> None:
        self._client.connect(self._host, self._port, keepalive=30)
        self._client.loop_start()

    def publish(self, topic: str, payload: dict) -> None:
        self._client.publish(topic, json.dumps(payload), qos=1)

    def close(self) -> None:
        self._client.loop_stop()
        self._client.disconnect()
