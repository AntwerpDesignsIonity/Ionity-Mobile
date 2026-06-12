/*
 * Ionity-CSI ESP32 capture agent.
 *
 * Associates with an AP, enables native CSI (esp_wifi_set_csi_rx_cb), collects
 * REAL CSI frames + RSSI over a dwell window, and publishes Capture JSON to the
 * Ionity-CSI MQTT broker. Calibration is driven by `command` messages carrying a
 * sessionId + label; `run`/`stop` toggle continuous inference captures.
 *
 * Topics:
 *   publish  ionity/<id>/status, ionity/<id>/capture
 *   sub      ionity/<id>/command   { "action": "capture"|"run"|"stop", ... }
 */
#include <math.h>
#include <string.h>
#include <stdlib.h>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_netif.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "mqtt_client.h"
#include "nvs_flash.h"
#include "cJSON.h"

#define TAG "ionity-csi"
#define MAX_SUB 64
#define MAX_FRAMES CONFIG_IONITY_MAX_FRAMES

typedef struct {
    int8_t buf[MAX_SUB * 2]; /* interleaved [imag, real] int8 pairs */
    int len;                 /* valid bytes in buf */
    int8_t rssi;
} raw_frame_t;

static esp_mqtt_client_handle_t s_mqtt;
static raw_frame_t s_frames[MAX_FRAMES];
static volatile int s_frame_count;
static volatile bool s_capturing;
static volatile bool s_run;
static volatile int s_interval_ms = 1000;
static QueueHandle_t s_cmd_queue; /* of char* (owned JSON payloads) */
static char s_device_id[32];

/* ---- CSI callback: copy raw frames while capturing (keep it fast) -------- */
static void csi_rx_cb(void *ctx, wifi_csi_info_t *info) {
    (void)ctx;
    if (!s_capturing || s_frame_count >= MAX_FRAMES || info == NULL || info->buf == NULL) return;
    int len = info->len;
    if (len > MAX_SUB * 2) len = MAX_SUB * 2;
    raw_frame_t *f = &s_frames[s_frame_count];
    memcpy(f->buf, info->buf, len);
    f->len = len;
    f->rssi = info->rx_ctrl.rssi;
    s_frame_count++;
}

static void csi_enable(void) {
    wifi_csi_config_t cfg = {
        .lltf_en = true,
        .htltf_en = true,
        .stbc_htltf2_en = true,
        .ltf_merge_en = true,
        .channel_filter_en = true,
        .manu_scale = false,
        .shift = 0,
    };
    ESP_ERROR_CHECK(esp_wifi_set_csi_config(&cfg));
    ESP_ERROR_CHECK(esp_wifi_set_csi_rx_cb(csi_rx_cb, NULL));
    ESP_ERROR_CHECK(esp_wifi_set_csi(true));
}

/* ---- helpers ------------------------------------------------------------- */
static int channel_to_freq(int ch) { return ch == 0 ? 0 : (ch <= 14 ? 2407 + ch * 5 : 5000 + ch * 5); }

static void add_ap(cJSON *root) {
    wifi_ap_record_t ap;
    cJSON *j = cJSON_AddObjectToObject(root, "ap");
    char bssid[18] = "00:00:00:00:00:00";
    if (esp_wifi_sta_get_ap_info(&ap) == ESP_OK) {
        snprintf(bssid, sizeof(bssid), "%02x:%02x:%02x:%02x:%02x:%02x",
                 ap.bssid[0], ap.bssid[1], ap.bssid[2], ap.bssid[3], ap.bssid[4], ap.bssid[5]);
        cJSON_AddStringToObject(j, "bssid", bssid);
        cJSON_AddStringToObject(j, "ssid", (const char *)ap.ssid);
        cJSON_AddNumberToObject(j, "freqMhz", channel_to_freq(ap.primary));
    } else {
        cJSON_AddStringToObject(j, "bssid", bssid);
        cJSON_AddStringToObject(j, "ssid", CONFIG_IONITY_WIFI_SSID);
        cJSON_AddNumberToObject(j, "freqMhz", 2412);
    }
    cJSON_AddNumberToObject(j, "bandwidthMhz", 20);
}

/* Build + publish a capture from the frames gathered during the last dwell. */
static void publish_capture(int64_t start_ms, int64_t end_ms, const char *session_id, cJSON *label) {
    cJSON *root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "deviceId", s_device_id);
    cJSON_AddStringToObject(root, "agent", "esp32");
    add_ap(root);
    cJSON_AddNumberToObject(root, "startTs", (double)start_ms);
    cJSON_AddNumberToObject(root, "endTs", (double)end_ms);

    cJSON *meas = cJSON_AddObjectToObject(root, "measurement");
    cJSON *rssi_arr = cJSON_AddArrayToObject(meas, "rssi");
    cJSON *csi_arr = cJSON_AddArrayToObject(meas, "csi");

    int n = s_frame_count;
    for (int fi = 0; fi < n; fi++) {
        raw_frame_t *f = &s_frames[fi];
        int subs = f->len / 2;
        cJSON *frame = cJSON_CreateObject();
        cJSON_AddNumberToObject(frame, "ts", (double)(start_ms + fi));
        cJSON *amp = cJSON_AddArrayToObject(frame, "amplitude");
        cJSON *pha = cJSON_AddArrayToObject(frame, "phase");
        for (int k = 0; k < subs; k++) {
            int im = f->buf[2 * k];
            int re = f->buf[2 * k + 1];
            cJSON_AddItemToArray(amp, cJSON_CreateNumber(sqrtf((float)(re * re + im * im))));
            cJSON_AddItemToArray(pha, cJSON_CreateNumber(atan2f((float)im, (float)re)));
        }
        cJSON_AddNumberToObject(frame, "rssi", f->rssi);
        cJSON_AddNumberToObject(frame, "bandwidthMhz", 20);
        cJSON_AddItemToArray(csi_arr, frame);
        /* one RSSI sample per frame */
        cJSON *rs = cJSON_CreateObject();
        cJSON_AddNumberToObject(rs, "rssi", f->rssi);
        cJSON_AddNumberToObject(rs, "ts", (double)(start_ms + fi));
        cJSON_AddItemToArray(rssi_arr, rs);
    }

    if (session_id && session_id[0]) cJSON_AddStringToObject(root, "sessionId", session_id);
    if (label) cJSON_AddItemReferenceToObject(root, "label", label);

    char *payload = cJSON_PrintUnformatted(root);
    if (payload) {
        char topic[64];
        snprintf(topic, sizeof(topic), "ionity/%s/capture", s_device_id);
        esp_mqtt_client_publish(s_mqtt, topic, payload, 0, 1, 0);
        ESP_LOGI(TAG, "published capture: %d frames", n);
        free(payload);
    }
    cJSON_Delete(root);
}

/* Run one dwell: clear buffer, collect for dwell_ms, then publish. */
static void do_capture(int dwell_ms, const char *session_id, cJSON *label) {
    s_frame_count = 0;
    int64_t start_ms = esp_timer_get_time() / 1000;
    s_capturing = true;
    vTaskDelay(pdMS_TO_TICKS(dwell_ms));
    s_capturing = false;
    int64_t end_ms = esp_timer_get_time() / 1000;
    publish_capture(start_ms, end_ms, session_id, label);
}

/* ---- command + capture task --------------------------------------------- */
static void capture_task(void *arg) {
    (void)arg;
    int64_t next_run = 0;
    for (;;) {
        char *cmd = NULL;
        if (xQueueReceive(s_cmd_queue, &cmd, pdMS_TO_TICKS(50)) == pdTRUE && cmd) {
            cJSON *j = cJSON_Parse(cmd);
            if (j) {
                const cJSON *action = cJSON_GetObjectItem(j, "action");
                if (cJSON_IsString(action)) {
                    if (strcmp(action->valuestring, "capture") == 0) {
                        const cJSON *dwell = cJSON_GetObjectItem(j, "dwellMs");
                        const cJSON *sid = cJSON_GetObjectItem(j, "sessionId");
                        cJSON *label = cJSON_GetObjectItem(j, "label");
                        do_capture(cJSON_IsNumber(dwell) ? dwell->valueint : CONFIG_IONITY_DWELL_MS,
                                   cJSON_IsString(sid) ? sid->valuestring : NULL, label);
                    } else if (strcmp(action->valuestring, "run") == 0) {
                        const cJSON *iv = cJSON_GetObjectItem(j, "intervalMs");
                        if (cJSON_IsNumber(iv)) s_interval_ms = iv->valueint;
                        s_run = true;
                    } else if (strcmp(action->valuestring, "stop") == 0) {
                        s_run = false;
                    }
                }
                cJSON_Delete(j);
            }
            free(cmd);
        }
        if (s_run && esp_timer_get_time() / 1000 >= next_run) {
            do_capture(CONFIG_IONITY_DWELL_MS, NULL, NULL);
            next_run = esp_timer_get_time() / 1000 + s_interval_ms;
        }
    }
}

/* ---- MQTT ---------------------------------------------------------------- */
static void publish_status(const char *state) {
    cJSON *root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "deviceId", s_device_id);
    cJSON_AddStringToObject(root, "agent", "esp32");
    cJSON_AddNumberToObject(root, "ts", (double)(esp_timer_get_time() / 1000));
    cJSON_AddStringToObject(root, "state", state);
    char *payload = cJSON_PrintUnformatted(root);
    if (payload) {
        char topic[64];
        snprintf(topic, sizeof(topic), "ionity/%s/status", s_device_id);
        esp_mqtt_client_publish(s_mqtt, topic, payload, 0, 1, 0);
        free(payload);
    }
    cJSON_Delete(root);
}

static void mqtt_event_handler(void *args, esp_event_base_t base, int32_t id, void *data) {
    (void)args; (void)base;
    esp_mqtt_event_handle_t e = data;
    char topic[64];
    switch ((esp_mqtt_event_id_t)id) {
        case MQTT_EVENT_CONNECTED:
            snprintf(topic, sizeof(topic), "ionity/%s/command", s_device_id);
            esp_mqtt_client_subscribe(s_mqtt, topic, 1);
            publish_status("idle");
            ESP_LOGI(TAG, "mqtt connected; subscribed %s", topic);
            break;
        case MQTT_EVENT_DATA: {
            char *payload = strndup(e->data, e->data_len);
            if (payload && xQueueSend(s_cmd_queue, &payload, 0) != pdTRUE) free(payload);
            break;
        }
        default:
            break;
    }
}

static void mqtt_start(void) {
    esp_mqtt_client_config_t cfg = { .broker.address.uri = CONFIG_IONITY_MQTT_URI };
    s_mqtt = esp_mqtt_client_init(&cfg);
    esp_mqtt_client_register_event(s_mqtt, ESP_EVENT_ANY_ID, mqtt_event_handler, NULL);
    esp_mqtt_client_start(s_mqtt);
}

/* ---- WiFi ---------------------------------------------------------------- */
static void wifi_event_handler(void *arg, esp_event_base_t base, int32_t id, void *data) {
    (void)arg; (void)data;
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        ESP_LOGW(TAG, "disconnected, reconnecting");
        esp_wifi_connect();
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        ESP_LOGI(TAG, "got IP; enabling CSI + MQTT");
        csi_enable();
        mqtt_start();
    }
}

static void wifi_start(void) {
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_create_default_wifi_sta();

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(WIFI_EVENT, ESP_EVENT_ANY_ID, wifi_event_handler, NULL, NULL));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(IP_EVENT, IP_EVENT_STA_GOT_IP, wifi_event_handler, NULL, NULL));

    wifi_config_t wc = { 0 };
    strlcpy((char *)wc.sta.ssid, CONFIG_IONITY_WIFI_SSID, sizeof(wc.sta.ssid));
    strlcpy((char *)wc.sta.password, CONFIG_IONITY_WIFI_PASSWORD, sizeof(wc.sta.password));
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wc));
    ESP_ERROR_CHECK(esp_wifi_start());
}

void app_main(void) {
    ESP_ERROR_CHECK(nvs_flash_init());
    strlcpy(s_device_id, CONFIG_IONITY_DEVICE_ID, sizeof(s_device_id));
    s_cmd_queue = xQueueCreate(8, sizeof(char *));
    xTaskCreate(capture_task, "capture", 8192, NULL, 5, NULL);
    wifi_start();
    ESP_LOGI(TAG, "Ionity-CSI ESP32 agent '%s' started", s_device_id);
}
