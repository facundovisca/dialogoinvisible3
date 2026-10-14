/*
  =====================================================================
  DIÁLOGO INVISIBLE - Sniffer WiFi para ESP8266 + LED reactivo
  =====================================================================
  Suma sobre la versión anterior:
  - El LED integrado de la placa parpadea más rápido cuanto más cerca
    (RSSI menos negativo) esté el celular detectado más fuerte en los
    últimos segundos.
  =====================================================================
*/

#include <ESP8266WiFi.h>
extern "C" {
  #include "user_interface.h"
}

// ---------------------------------------------------------------------
// CONFIGURACIÓN
// ---------------------------------------------------------------------
#define MAX_CACHE 60
#define COOLDOWN_MS 4000
#define CHANNEL_HOP_MS 300

// LED integrado de la placa (activo en LOW: LOW = encendido, HIGH = apagado)
// Si tenés un LED externo en otro pin, cambiá esta línea, ej: #define LED_PIN 5
#define LED_PIN LED_BUILTIN

// Cada cuánto "cerramos" una ventana de medición de RSSI para decidir
// el ritmo de parpadeo. Dentro de cada ventana, guardamos el RSSI más
// fuerte (celular más cercano) que haya aparecido.
#define VENTANA_RSSI_MS 2000

// Parpadeo más lento cuando no hay nadie cerca, más rápido cuando sí.
#define BLINK_LENTO_MS 800   // celular lejos (o nadie detectado)
#define BLINK_RAPIDO_MS 80   // celular muy cerca

// ---------------------------------------------------------------------
struct RxControl {
  signed rssi:8;
  unsigned rate:4;
  unsigned is_group:1;
  unsigned :27;
  unsigned sig_mode:2;
  unsigned legacy_length:12;
  unsigned damatch0:1;
  unsigned damatch1:1;
  unsigned bssidmatch0:1;
  unsigned bssidmatch1:1;
  unsigned MCS:7;
  unsigned CWB:1;
  unsigned HT_length:16;
  unsigned Smoothing:1;
  unsigned Not_Sounding:1;
  unsigned :1;
  unsigned Aggregation:1;
  unsigned STBC:2;
  unsigned FEC_CODING:1;
  unsigned SGI:1;
  unsigned rx_end_state:8;
  unsigned ampdu_cnt:8;
  unsigned channel:4;
  unsigned :12;
};

// ---------------------------------------------------------------------
// Cache de MACs ya vistas (filtro anti-spam)
// ---------------------------------------------------------------------
struct SeenMac {
  uint8_t mac[6];
  unsigned long lastSeen;
};

SeenMac cache[MAX_CACHE];
int cacheCount = 0;

bool alreadySeen(uint8_t *mac) {
  unsigned long now = millis();
  for (int i = 0; i < cacheCount; i++) {
    if (memcmp(cache[i].mac, mac, 6) == 0) {
      if (now - cache[i].lastSeen < COOLDOWN_MS) {
        return true;
      }
      cache[i].lastSeen = now;
      return false;
    }
  }
  int idx = (cacheCount < MAX_CACHE) ? cacheCount++ : 0;
  memcpy(cache[idx].mac, mac, 6);
  cache[idx].lastSeen = now;
  return false;
}

// ---------------------------------------------------------------------
// Variables para el LED reactivo a proximidad
// ---------------------------------------------------------------------
int8_t mejorRSSIVentana = -100;   // el más fuerte visto en la ventana actual
int8_t mejorRSSIActual = -100;    // el que se usa AHORA para calcular el parpadeo
unsigned long inicioVentana = 0;

unsigned long ultimoBlink = 0;
bool estadoLed = false;

// ---------------------------------------------------------------------
// Callback de captura de paquetes WiFi
// ---------------------------------------------------------------------
void promisc_cb(uint8_t *buf, uint16_t len) {
  if (len < 12) return;

  RxControl *sniffer = (RxControl*) buf;
  int8_t rssi = sniffer->rssi;

  uint8_t *packet = buf + 12;
  uint16_t frameControl = packet[0] | (packet[1] << 8);

  if ((frameControl & 0x00FC) == 0x0040) { // Probe Request

    uint8_t *macBytes = &packet[10];

    if (alreadySeen(macBytes)) {
      return; // spam de la misma MAC, ignorar
    }

    char macStr[18];
    snprintf(macStr, sizeof(macStr), "%02X:%02X:%02X:%02X:%02X:%02X",
             macBytes[0], macBytes[1], macBytes[2],
             macBytes[3], macBytes[4], macBytes[5]);

    String ssid = "BROADCAST";
    uint8_t ssidLen = packet[25];
    if (ssidLen > 0 && ssidLen < 32) {
      char ssidBuf[33];
      memset(ssidBuf, 0, sizeof(ssidBuf));
      memcpy(ssidBuf, &packet[26], ssidLen);
      ssid = String(ssidBuf);
    }

    Serial.printf("PROBE, %s, %d, %s\n", macStr, rssi, ssid.c_str());

    // ---- LED: registrar si este es el RSSI más fuerte de la ventana ----
    if (rssi > mejorRSSIVentana) {
      mejorRSSIVentana = rssi;
    }
  }
}

// ---------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n--- INICIANDO SNIFFER ESP8266 ---");

  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, HIGH); // apagado al inicio (LED integrado es activo en LOW)

  wifi_set_opmode(STATION_MODE);
  wifi_promiscuous_enable(0);
  wifi_set_promiscuous_rx_cb(promisc_cb);
  wifi_promiscuous_enable(1);
  wifi_set_channel(1);

  inicioVentana = millis();

  Serial.println("Modo promiscuo activado correctamente.");
  Serial.printf("Filtro anti-spam: cooldown %d ms, cache %d MACs.\n",
                COOLDOWN_MS, MAX_CACHE);
}

// ---------------------------------------------------------------------
void loop() {
  // ---- Cambio de canal WiFi ----
  static unsigned long lastChannelChange = 0;
  if (millis() - lastChannelChange > CHANNEL_HOP_MS) {
    uint8_t currentChannel = wifi_get_channel();
    currentChannel = (currentChannel % 13) + 1;
    wifi_set_channel(currentChannel);
    lastChannelChange = millis();
  }

  // ---- Cerrar ventana de medición de RSSI ----
  // Cada VENTANA_RSSI_MS tomamos el RSSI más fuerte visto y lo usamos
  // para decidir el ritmo de parpadeo hasta la próxima ventana.
  // Si en la ventana no apareció nadie, mejorRSSIVentana sigue en -100
  // (equivalente a "nadie cerca"), así el parpadeo vuelve a ser lento.
  if (millis() - inicioVentana > VENTANA_RSSI_MS) {
    mejorRSSIActual = mejorRSSIVentana;
    mejorRSSIVentana = -100; // reiniciar para la próxima ventana
    inicioVentana = millis();
  }

  // ---- Calcular intervalo de parpadeo según proximidad ----
  int8_t rssiClamp = constrain(mejorRSSIActual, -100, -30);
  int intervaloBlink = map(rssiClamp, -80, -40, BLINK_LENTO_MS, BLINK_RAPIDO_MS);
  intervaloBlink = constrain(intervaloBlink, BLINK_RAPIDO_MS, BLINK_LENTO_MS);

  // ---- Parpadear sin bloquear el resto del loop ----
  if (millis() - ultimoBlink > (unsigned long)intervaloBlink) {
    estadoLed = !estadoLed;
    digitalWrite(LED_PIN, estadoLed ? LOW : HIGH); // LOW = encendido
    ultimoBlink = millis();
  }
}
