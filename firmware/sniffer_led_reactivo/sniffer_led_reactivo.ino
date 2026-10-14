/*
  =====================================================================
  DIÁLOGO INVISIBLE - Sniffer WiFi para ESP8266 + LED reactivo
  =====================================================================
*/

#include <ESP8266WiFi.h>

extern "C" {
  #include "user_interface.h"
}

// ---------------------------------------------------------------------
// CONFIGURACIÓN
// ---------------------------------------------------------------------
#define MAX_CACHE 64
#define COOLDOWN_MS 3000        // 3 segundos entre registros de una misma MAC
#define CHANNEL_HOP_MS 250      // Salto entre canales 1 al 13

#define LED_PIN LED_BUILTIN

#define VENTANA_RSSI_MS 2000
#define BLINK_LENTO_MS 800
#define BLINK_RAPIDO_MS 80

// ---------------------------------------------------------------------
// Cache circular de MACs
// ---------------------------------------------------------------------
struct SeenMac {
  uint8_t mac[6];
  unsigned long lastSeen;
};

SeenMac cache[MAX_CACHE];
int cacheHead = 0;
int cacheTotal = 0;

bool alreadySeen(uint8_t *mac) {
  unsigned long now = millis();

  for (int i = 0; i < cacheTotal; i++) {
    if (memcmp(cache[i].mac, mac, 6) == 0) {
      if (now - cache[i].lastSeen < COOLDOWN_MS) {
        return true;
      }
      cache[i].lastSeen = now;
      return false;
    }
  }

  memcpy(cache[cacheHead].mac, mac, 6);
  cache[cacheHead].lastSeen = now;

  cacheHead = (cacheHead + 1) % MAX_CACHE;
  if (cacheTotal < MAX_CACHE) cacheTotal++;

  return false;
}

// ---------------------------------------------------------------------
// Variables para el LED reactivo
// ---------------------------------------------------------------------
int8_t mejorRSSIVentana = -100;
int8_t mejorRSSIActual = -100;
unsigned long inicioVentana = 0;

unsigned long ultimoBlink = 0;
bool estadoLed = false;

// ---------------------------------------------------------------------
// Callback de captura (usa el buffer crudo del SDK)
// ---------------------------------------------------------------------
void promisc_cb(uint8_t *buf, uint16_t len) {
  // Los paquetes con payload útil miden al menos 12 bytes de header + 24 de MAC header
  if (len < 36) return;

  // En el SDK de ESP8266, el RSSI se encuentra en el primer byte de control
  int8_t rssi = (int8_t)buf[0];

  // La trama 802.11 real arranca tras los 12 bytes del encabezado de recepción
  uint8_t *packet = buf + 12;
  uint16_t frameControl = packet[0] | (packet[1] << 8);

  // Subtipo Probe Request (Management 0x00, Subtipo 0x04 -> 0x0040)
  if ((frameControl & 0x00FC) == 0x0040) {
    uint8_t *macBytes = &packet[10]; // Dirección de origen (Transmitter Address)

    if (alreadySeen(macBytes)) {
      return;
    }

    char macStr[18];
    snprintf(macStr, sizeof(macStr), "%02X:%02X:%02X:%02X:%02X:%02X",
             macBytes[0], macBytes[1], macBytes[2],
             macBytes[3], macBytes[4], macBytes[5]);

    String ssid = "BROADCAST";
    // El SSID se encuentra en el tagged parameter 0 (offset 24 de la trama 802.11)
    if (len >= 12 + 26) {
      uint8_t tagType = packet[24];
      uint8_t ssidLen = packet[25];
      if (tagType == 0 && ssidLen > 0 && ssidLen <= 32 && (len >= 12 + 26 + ssidLen)) {
        char ssidBuf[33];
        memset(ssidBuf, 0, sizeof(ssidBuf));
        memcpy(ssidBuf, &packet[26], ssidLen);
        ssid = String(ssidBuf);
      }
    }

    Serial.printf("PROBE,%s,%d,%s\n", macStr, rssi, ssid.c_str());

    if (rssi > mejorRSSIVentana) {
      mejorRSSIVentana = rssi;
    }
  }
}

// ---------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(300);

  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, HIGH); // LED integrado apaga en HIGH

  wifi_set_opmode(STATION_MODE);
  wifi_promiscuous_enable(0);
  wifi_set_promiscuous_rx_cb(promisc_cb);
  wifi_promiscuous_enable(1);
  wifi_set_channel(1);

  inicioVentana = millis();
}

// ---------------------------------------------------------------------
void loop() {
  static unsigned long lastChannelChange = 0;
  if (millis() - lastChannelChange > CHANNEL_HOP_MS) {
    uint8_t currentChannel = wifi_get_channel();
    currentChannel = (currentChannel % 13) + 1;
    wifi_set_channel(currentChannel);
    lastChannelChange = millis();
  }

  if (millis() - inicioVentana > VENTANA_RSSI_MS) {
    mejorRSSIActual = mejorRSSIVentana;
    mejorRSSIVentana = -100;
    inicioVentana = millis();
  }

  int8_t rssiClamp = constrain(mejorRSSIActual, -100, -30);
  int intervaloBlink = map(rssiClamp, -80, -40, BLINK_LENTO_MS, BLINK_RAPIDO_MS);
  intervaloBlink = constrain(intervaloBlink, BLINK_RAPIDO_MS, BLINK_LENTO_MS);

  if (millis() - ultimoBlink > (unsigned long)intervaloBlink) {
    estadoLed = !estadoLed;
    digitalWrite(LED_PIN, estadoLed ? LOW : HIGH);
    ultimoBlink = millis();
  }
}