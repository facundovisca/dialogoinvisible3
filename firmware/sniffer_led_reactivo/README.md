# 📡 Instalación Interactiva - Diálogo invisible de los bolsillos

Sistema de visualización y audio generativo en tiempo real a partir de señales Wi-Fi (Probe Requests) capturadas con ESP8266/ESP32.

## 📁 Estructura del Repositorio

* `/firmware`: Código `.ino` para cargar en la placa NodeMCU / ESP8266 desde el IDE de Arduino.
* `/web`: Interfaz de control, motor gráfico en p5.js y síntesis de audio (WebAudio).

## 🚀 Cómo Ejecutar

1. **Cargar Firmware:** Cargar el sketch de la carpeta `/firmware` en la placa con velocidad de puerto serie a `115200`.
2. **Ejecutar Interfaz:** Abrir `web/index.html` en Chrome.
3. **Modo Simulación Por Defecto:** Presionar la tecla **`M`** A modo de llave para pasar al punto **4**
4. **Conectar Serial:** Presionar la tecla **`C`** para seleccionar el puerto de la placa.
5. **Abrir Proyector:** Presionar la tecla **`P`** para abrir la ventana secundaria y arrastrarla al proyector.
5. **Ocultar el HUD** Presionando la tecla  **`H`** 