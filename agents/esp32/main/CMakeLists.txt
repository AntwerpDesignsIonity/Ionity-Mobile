idf_component_register(
  SRCS "ionity_csi_main.c"
  INCLUDE_DIRS "."
  REQUIRES nvs_flash esp_wifi esp_event mqtt json esp_netif
)
