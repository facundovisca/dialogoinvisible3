// ============================================================================
// DIÁLOGO INVISIBLE - GESTOR DE INTERFAZ DE USUARIO (ui.js)
// ============================================================================
// Maneja:
// 1. Panel de controles DOM (creación reactiva por eventos, sin polling en draw).
// 2. Historial serial y terminal lateral DOM (#serial-log).
// 3. Renderizado del HUD informativo en Canvas 2D.
// ============================================================================

let hudVisible = true;
let mostrarLog = true;
let guiDiv = null;

let serialLogEl = null;
let serialLogHeaderEl = null;
let serialLogCountEl = null;
let infoEntradaEl = null;
let infoCicloEl = null;
let ultimoTextoCiclo = "";

const lineasConsola = new Map();
let ultimaConsola = 0;
const controlesUI = {};
let paramsRef = null;

/**
 * Inicializa el panel DOM de control, sliders reactivos, pickers y terminal serial.
 * @param {Object} params - Objeto de configuración global del sketch.
 * @param {Object} callbacks - Acciones externas como reiniciar obra o alternar audio.
 */
function iniciarUI(params, callbacks = {}) {
  paramsRef = params;

  // 1. Inicialización de referencias DOM para la consola serial
  serialLogEl = document.getElementById("serial-log");
  serialLogHeaderEl = document.getElementById("serial-log-header");
  serialLogCountEl = document.getElementById("serial-log-count");
  actualizarVisibilidadLog();

  // 2. Creación del contenedor principal de la GUI
  guiDiv = createDiv();
  guiDiv.id("gui-panel");
  guiDiv.position(20, 55);
  guiDiv.style("background", "rgba(0, 0, 0, 0.90)");
  guiDiv.style("border", "1px solid #ffffff");
  guiDiv.style("padding", "14px 10px 14px 14px");
  guiDiv.style("color", "white");
  guiDiv.style("font-family", "monospace");
  guiDiv.style("font-size", "12px");
  guiDiv.style("display", hudVisible ? "flex" : "none");
  guiDiv.style("flex-direction", "column");
  guiDiv.style("gap", "4px");
  guiDiv.style("z-index", "100");
  guiDiv.style("max-height", "calc(100vh - 85px)");
  guiDiv.style("overflow-y", "auto");
  guiDiv.style("overflow-x", "hidden");
  guiDiv.style("box-sizing", "border-box");
  guiDiv.style("width", "325px");
  guiDiv.style("scrollbar-width", "thin");
  guiDiv.style("scrollbar-color", "#666 #111");

  // Helper para construir controles deslizantes orientados a eventos (Opción 2-B)
  function crearControl(nombre, claveParam, min, max, valInicial, step, onChangeExtra) {
    const contenedor = createDiv();
    contenedor.style("display", "flex");
    contenedor.style("justify-content", "space-between");
    contenedor.style("align-items", "center");
    contenedor.style("width", "280px");

    const etiqueta = createSpan(nombre);
    etiqueta.style("width", "110px");

    const slider = createSlider(min, max, valInicial, step);
    slider.style("width", "110px");

    const formatVal = (v) => {
      if (typeof v === "number" && step < 0.001) {
        return Number(v.toFixed(4)).toString();
      }
      return v.toString();
    };

    const valor = createSpan(formatVal(valInicial));
    valor.style("width", "48px");
    valor.style("text-align", "right");

    // Enlace reactivo por evento .input()
    slider.input(() => {
      const v = slider.value();
      valor.html(formatVal(v));
      if (claveParam && paramsRef) {
        paramsRef[claveParam] = v;
      }
      if (typeof onChangeExtra === "function") {
        onChangeExtra(v);
      }
    });

    contenedor.child(etiqueta);
    contenedor.child(slider);
    contenedor.child(valor);
    guiDiv.child(contenedor);

    if (claveParam) {
      controlesUI[claveParam] = { slider, valorSpan: valor, contenedor };
    }

    return slider;
  }

  // --- SECCIÓN: CONTROLES VISUALES ---
  createDiv("<b>CONTROLES VISUALES</b>").parent(guiDiv);
  crearControl("Dist. Conexión", "distConexion", 50, 300, params.distConexion, 1);
  crearControl("Prob. Conexión", "probConexion", 0.001, 0.1, params.probConexion, 0.001);
  crearControl("Velocidad Gral", "velGlobal", 0.1, 3.0, params.velGlobal, 0.1);
  crearControl("Tamaño Part.", "tamanoBase", 0.1, 3.0, params.tamanoBase, 0.1);
  crearControl("Tam. Nacimiento", "tamNacimiento", 0.05, 1.0, params.tamNacimiento, 0.05);
  crearControl("Tam. Máximo", "tamMaximo", 0.4, 5.0, params.tamMaximo, 0.1);
  crearControl("Opacidad Líneas", "opacidadLineas", 0.0, 5.0, params.opacidadLineas, 0.1);
  crearControl("Brillo Part.", "brilloParticulas", 0.1, 3.0, params.brilloParticulas, 0.1);

  const cbVerParticulas = createCheckbox(" Ver dibujo local", params.mostrarParticulasEnNotebook);
  cbVerParticulas.checked(Boolean(params.mostrarParticulasEnNotebook));
  cbVerParticulas.parent(guiDiv);
  cbVerParticulas.style("margin-top", "3px");
  cbVerParticulas.changed(() => {
    paramsRef.mostrarParticulasEnNotebook = cbVerParticulas.checked();
  });
  controlesUI["mostrarParticulasEnNotebook"] = { checkbox: cbVerParticulas };

  // --- SECCIÓN: PALETA LIFECYCLE (NORMAL) ---
  createDiv("<br><b style='color:#78ff9a'>PALETA LIFECYCLE (NORMAL)</b>").parent(guiDiv);
  crearControl("Duración ciclo s", "tiempoLifecycle", 10, 300, params.tiempoLifecycle, 5);

  function crearColorControl(nombre, hexInicial, index) {
    const contenedor = createDiv();
    contenedor.style("display", "flex");
    contenedor.style("justify-content", "space-between");
    contenedor.style("align-items", "center");
    contenedor.style("width", "280px");
    contenedor.style("margin-top", "2px");

    const etiqueta = createSpan(nombre);
    etiqueta.style("width", "135px");
    etiqueta.style("color", "#d0d0d0");

    const picker = createColorPicker(hexInicial);
    picker.style("width", "40px");
    picker.style("height", "22px");
    picker.style("border", "1px solid #555");
    picker.style("background", "none");
    picker.style("cursor", "pointer");
    picker.style("padding", "0");
    picker.style("border-radius", "3px");

    const valor = createSpan(hexInicial.toUpperCase());
    valor.style("width", "65px");
    valor.style("text-align", "right");
    valor.style("font-size", "11px");
    valor.style("color", hexInicial);

    picker.input(() => {
      const val = picker.value();
      const hex = typeof val === "string" ? val : picker.color().toString("#rrggbb");
      valor.html(hex.toUpperCase());
      valor.style("color", hex);
      const rgb = hexToRgb(hex);
      definirColorEdad(index, rgb[0], rgb[1], rgb[2]);
    });

    contenedor.child(etiqueta);
    contenedor.child(picker);
    contenedor.child(valor);
    guiDiv.child(contenedor);

    return { picker, valor };
  }

  const etapasPaleta = [
    { nombre: "Color Comienzo (0%)", idx: 0 },
    { nombre: "Color Final (100%)", idx: 1 }
  ];

  etapasPaleta.forEach(e => {
    const rgb = _PALETA_EDAD[e.idx][1];
    crearColorControl(e.nombre, rgbToHex(rgb[0], rgb[1], rgb[2]), e.idx);
  });

  // --- SECCIÓN: CALIBRACIÓN PLACA REAL ---
  createDiv("<br><b>CALIBRACIÓN PLACA REAL</b>").parent(guiDiv);
  infoEntradaEl = createDiv("Recibidos: 0/s  |  Aceptados: 0/s");
  infoEntradaEl.parent(guiDiv);
  infoEntradaEl.style("color", "#78c8ff");
  crearControl("Entrada probes %", "entradaPct", 0, 100, params.entradaPct, 1);
  crearControl("Filtro RSSI dB", "rssiMinimo", -95, -40, params.rssiMinimo, 1);
  crearControl("Cooldown MAC ms", "cooldownMac", 100, 4000, params.cooldownMac, 50);
  crearControl("Crecim. x probe", "crecimientoPorProbe", 0.02, 0.5, params.crecimientoPorProbe, 0.01);
  crearControl("Vida sin probe s", "vidaEntidad", 5, 300, params.vidaEntidad, 5);
  crearControl("Máx. entidades", "maxEntidades", 10, 200, params.maxEntidades, 5);

  // --- SECCIÓN: SIMULACIÓN PROBES ---
  createDiv("<br><b>SIMULACIÓN PROBES</b>").parent(guiDiv);
  crearControl("Freq. Probe ms", "intervaloMock", 100, 4000, params.intervaloMock, 50);

  // --- SECCIÓN: PAISAJE SONORO (DRONES) ---
  createDiv("<br><b>PAISAJE SONORO (DRONES)</b>").parent(guiDiv);
  crearControl("Vol. Drones Fond", "volDrone", 0, 3, params.volDrone, 0.1);
  crearControl("Vol. Drones Grav", "volGrave", 0, 3, params.volGrave, 0.1);

  // --- SECCIÓN: PARTÍCULAS Y EVENTOS ---
  createDiv("<br><b>PARTÍCULAS Y EVENTOS</b>").parent(guiDiv);
  crearControl("Vol. Probes", "volProbes", 0, 3, params.volProbes, 0.1);
  crearControl("Vol. Conexiones", "volConexiones", 0, 3, params.volConexiones, 0.1);

  const cbPulsosEntidades = createCheckbox(" Habilitar Sonido", params.pulsosEntidades);
  cbPulsosEntidades.checked(Boolean(params.pulsosEntidades));
  cbPulsosEntidades.parent(guiDiv);
  cbPulsosEntidades.style("margin-top", "3px");
  cbPulsosEntidades.changed(() => {
    const habilitado = cbPulsosEntidades.checked();
    paramsRef.pulsosEntidades = habilitado;
    const contexto = getAudioContext();
    outputVolume(habilitado ? 1 : 0, 0);
    const operacion = habilitado ? contexto.resume() : contexto.suspend();
    operacion.catch(error => console.error("No se pudo cambiar el estado global del audio:", error));
    if (typeof callbacks.onAudioToggle === "function") callbacks.onAudioToggle(habilitado);
  });
  controlesUI["pulsosEntidades"] = { checkbox: cbPulsosEntidades };

  // --- SECCIÓN: CICLO AUTOMÁTICO (VIGILANCIA POR GEN 2) ---
  createDiv("<br><b style='color:#ffb347'>CICLO AUTOMÁTICO (VIGILANCIA)</b>").parent(guiDiv);
  infoCicloEl = createDiv("Iniciando monitor demográfico…");
  infoCicloEl.parent(guiDiv);
  infoCicloEl.style("color", "#ffb347");
  infoCicloEl.style("font-family", "monospace");
  infoCicloEl.style("font-size", "11px");
  infoCicloEl.style("line-height", "1.35");
  infoCicloEl.style("margin-top", "2px");
  infoCicloEl.style("margin-bottom", "6px");

  const cbCicloAutomatico = createCheckbox(" Ciclo automático", params.cicloAutomatico);
  cbCicloAutomatico.checked(Boolean(params.cicloAutomatico));
  cbCicloAutomatico.parent(guiDiv);
  cbCicloAutomatico.style("margin-top", "2px");
  cbCicloAutomatico.changed(() => {
    paramsRef.cicloAutomatico = cbCicloAutomatico.checked();
  });
  controlesUI["cicloAutomatico"] = { checkbox: cbCicloAutomatico };

  crearControl("Umbral Gen 2", "umbralGen2", 1, 8, params.umbralGen2, 1);
  crearControl("Crec. conex. Espora", "crecimientoPorConexion", 0.005, 0.08, params.crecimientoPorConexion, 0.005);
  crearControl("Crec. conex. Gen 0", "crecimientoPorConexionGen0", 0.0, 0.02, params.crecimientoPorConexionGen0, 0.0001);
  crearControl("Vida Gen 2 s", "vidaGen2", 5, 60, params.vidaGen2, 1);
  crearControl("Umbral color vieja", "umbralEdadColorAntigua", 0.5, 0.95, params.umbralEdadColorAntigua, 0.05);
  crearControl("Enfriamiento s", "enfriamientoVigilancia", 0, 60, params.enfriamientoVigilancia, 1);
  crearControl("Duración máx. s", "duracionVigilancia", 10, 180, params.duracionVigilancia, 5);

  // --- SECCIÓN: MODO VIGILANCIA [V] ---
  createDiv("<br><b style='color:#ff5b52'>MODO VIGILANCIA [V]</b>").parent(guiDiv);
  crearControl("Vol. Ruido", "volRuidoVigilancia", 0, 3, params.volRuidoVigilancia, 0.1);
  crearControl("Vol. Tensión", "volTensionVigilancia", 0, 3, params.volTensionVigilancia, 0.1);
  crearControl("Freq. Ráfagas", "freqRuidoVigilancia", 0.2, 3, params.freqRuidoVigilancia, 0.1);

  // --- SECCIÓN: ACCIONES ---
  createDiv("<br><b>ACCIONES</b>").parent(guiDiv);
  const btnLimpiar = createButton("REINICIAR OBRA [R]");
  btnLimpiar.parent(guiDiv);
  btnLimpiar.style("background", "#111");
  btnLimpiar.style("color", "#fff");
  btnLimpiar.style("border", "1px solid #777");
  btnLimpiar.style("padding", "6px 10px");
  btnLimpiar.style("font-family", "monospace");
  btnLimpiar.style("font-size", "11px");
  btnLimpiar.style("cursor", "pointer");
  btnLimpiar.style("margin-top", "2px");
  btnLimpiar.mousePressed(() => {
    if (typeof callbacks.onReiniciar === "function") callbacks.onReiniciar();
    else if (typeof reiniciarObra === "function") reiniciarObra();
  });
}

/**
 * Permite modificar el valor de un control del panel y su objeto de parámetros externamente.
 * @param {string} clave 
 * @param {number|boolean} valor 
 */
function actualizarControlUI(clave, valor) {
  if (paramsRef) paramsRef[clave] = valor;
  const ctrl = controlesUI[clave];
  if (!ctrl) return;
  if (ctrl.slider) {
    ctrl.slider.value(valor);
    if (ctrl.valorSpan) {
      const txt = typeof valor === "number" && valor < 0.001 ? Number(valor.toFixed(4)).toString() : valor.toString();
      ctrl.valorSpan.html(txt);
    }
  } else if (ctrl.checkbox) {
    ctrl.checkbox.checked(Boolean(valor));
  }
}

/**
 * Actualiza la información de flujo de probes por segundo en el panel.
 */
function actualizarInfoEntrada(recibidosPorSeg, aceptadosPorSeg) {
  if (infoEntradaEl) {
    infoEntradaEl.html(
      `Recibidos: ${recibidosPorSeg.toFixed(1)}/s  |  Aceptados: ${aceptadosPorSeg.toFixed(1)}/s`
    );
  }
}

/**
 * Muestra el estado del controlador demográfico y métricas clave en la UI.
 * @param {Object|number} info 
 */
function actualizarInfoCiclo(info) {
  if (!infoCicloEl) return;
  if (typeof info === "number") {
    infoCicloEl.html(`Células activas: ${info}`);
    return;
  }
  const colorEstado = info.estado === "VIGILANCIA" ? "#ff5b52" : (info.estado === "ENFRIAMIENTO" ? "#ffd700" : "#80dc64");
  const centTexto = info.tiempoGen2 > 0 ? ` (${info.tiempoGen2}s restantes)` : "";
  const enfriarTexto = info.enfriamientoRestante > 0 ? ` [espera ${info.enfriamientoRestante}s]` : "";
  const umbralG2 = info.umbralGen2 !== undefined ? info.umbralGen2 : 2;
  const gen2Color = info.gen2Count >= umbralG2 ? "#ff5b52" : (info.gen2Count > 0 ? "#ffd700" : "#80dc64");

  const html = `Estado: <b style="color:${colorEstado}">${info.estado}</b>${enfriarTexto}<br>` +
    `Gen ≥${info.genMin}: <b style="color:${gen2Color}">${info.gen2Count} / ${umbralG2}</b>${centTexto}<br>` +
    `Antiguas (color ≥${info.umbralColor.toFixed(2)}): <b>${info.antiguasCount}</b><br>` +
    `Total activas: <b>${info.totalActivas}</b> | Disp. reales: <b>${info.dispositivosReales}</b>`;

  if (html === ultimoTextoCiclo) return;
  ultimoTextoCiclo = html;
  infoCicloEl.html(html);
}

/**
 * Alterna la visibilidad del panel de controles y el HUD (tecla H).
 */
function alternarVisibilidadUI() {
  hudVisible = !hudVisible;
  if (guiDiv) guiDiv.style("display", hudVisible ? "flex" : "none");
  return hudVisible;
}

/**
 * Alterna la visibilidad de la consola lateral de logs (tecla T).
 */
function alternarVisibilidadLog() {
  mostrarLog = !mostrarLog;
  actualizarVisibilidadLog();
  return mostrarLog;
}

/**
 * Sincroniza la visibilidad de los elementos DOM del log según el estado actual.
 */
function actualizarVisibilidadLog(colapso) {
  const colapsoAct = colapso !== undefined ? colapso : (typeof colapsoActivo !== "undefined" ? colapsoActivo : false);
  const display = mostrarLog && !colapsoAct ? "flex" : "none";
  if (serialLogEl) serialLogEl.style.display = display;
  if (serialLogHeaderEl) serialLogHeaderEl.style.display = display === "flex" ? "block" : "none";
}

/**
 * Actualiza el historial acumulativo de dispositivos en la consola lateral.
 */
function actualizarConsola(ahora, entidadesMap, colapso) {
  if (!serialLogEl) return;
  if (ahora - ultimaConsola < 150) return; // Limita a ~7 updates/seg
  ultimaConsola = ahora;

  const entidades = entidadesMap || (typeof mapEntidades !== "undefined" ? mapEntidades : null);
  if (!entidades) return;

  const colapsoAct = colapso !== undefined ? colapso : (typeof colapsoActivo !== "undefined" ? colapsoActivo : false);
  const muestraSsid = typeof CONSOLA_MUESTRA_SSID !== "undefined" ? CONSOLA_MUESTRA_SSID : true;

  let dispositivosActivos = 0;
  let agregoLinea = false;

  for (const [id, e] of entidades) {
    if (e.esEspora) continue;
    if (!e.desvaneciendo) dispositivosActivos++;

    const claveLinea = `${id}-${e.seed}`;
    let el = lineasConsola.get(claveLinea);
    if (!el) {
      el = document.createElement("div");
      el.className = "log-entry";
      lineasConsola.set(claveLinea, el);
      serialLogEl.appendChild(el);
      agregoLinea = true;
    }

    const red = !muestraSsid ? "" :
      (e.ssid && e.ssid !== "BROADCAST" ? `  |  [${e.ssid}]` : "  |  <PROBE SEARCH>");
    const identidad = String(e.mac).toUpperCase();
    el.textContent = `${identidad}  |  ${Math.round(e.rssi)} dBm${red}`;

    const [r, g, b] = colorPorEdad(e.edadColor, colapsoAct);
    el.style.color = `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
    el.style.opacity = (0.7 + 0.3 * Math.min(1, e.brilloSonoro)).toFixed(2);
  }

  if (serialLogCountEl) serialLogCountEl.textContent = String(dispositivosActivos);
  if (agregoLinea) serialLogEl.scrollTop = serialLogEl.scrollHeight;
}

/**
 * Borra todas las líneas visuales de la consola y restablece el contador.
 */
function limpiarLineasConsola() {
  for (const el of lineasConsola.values()) el.remove();
  lineasConsola.clear();
  if (serialLogEl) serialLogEl.scrollTop = 0;
  if (serialLogCountEl) serialLogCountEl.textContent = "0";
}

/**
 * Determina texto y color del indicador de conexión serial para el HUD.
 */
function textoEstadoSerial() {
  const isMock = typeof MOCK_MODE !== "undefined" ? MOCK_MODE : false;
  if (isMock) return null;

  const estado = typeof serialEstado !== "undefined" ? serialEstado : "desconectado";
  const ultimoDato = typeof ultimoDatoSerial !== "undefined" ? ultimoDatoSerial : 0;

  switch (estado) {
    case "conectado":
      return { txt: "SERIAL: conectado", col: [80, 220, 100] };
    case "sin datos":
      return { txt: `SERIAL: sin datos hace ${max(0, floor((millis() - ultimoDato) / 60000))} min`, col: [255, 160, 40] };
    case "desconectado":
      return { txt: "SERIAL: desconectado · reintentando…", col: [255, 80, 80] };
    case "pausado":
      return { txt: "SERIAL: pausado ([C] para reanudar)", col: [160, 160, 160] };
    default:
      return null;
  }
}

/**
 * Renderiza el HUD informativo en Canvas 2D (encabezado, pie con teclas y alertas).
 * @param {Object} params - Parámetros del sketch
 * @param {Object} [estado] - Estado opcional para desacoplar del ámbito global
 */
function dibujarHUD(params, estado = {}) {
  const mockMode = estado.mockMode !== undefined ? estado.mockMode : (typeof MOCK_MODE !== "undefined" ? MOCK_MODE : false);
  const estadoSerial = estado.serialEstado || (typeof serialEstado !== "undefined" ? serialEstado : "desconectado");
  const grabando = estado.grabandoCSV !== undefined ? estado.grabandoCSV : (typeof grabandoCSV !== "undefined" ? grabandoCSV : false);
  const txtEscala = estado.nombreEscala || (typeof nombreEscalaActual !== "undefined" ? nombreEscalaActual : "PENTATÓNICA A MENOR");
  const macsTotal = estado.macsVistasSize !== undefined ? estado.macsVistasSize : (typeof macsVistas !== "undefined" ? macsVistas.size : 0);
  const macsAleat = estado.macsAleatoriasSize !== undefined ? estado.macsAleatoriasSize : (typeof macsAleatorias !== "undefined" ? macsAleatorias.size : 0);
  const filasTotal = estado.filasCSVLength !== undefined ? estado.filasCSVLength : (typeof filasCSV !== "undefined" ? filasCSV.length : 0);

  if (hudVisible) {
    push();
    textFont("monospace");
    textSize(12);
    textAlign(LEFT, TOP);
    noStroke();
    fill(0, 0, 0, 220);
    rect(20, 20, 600, 26, 3);
    stroke(255, 60);
    noFill();
    rect(20, 20, 600, 26, 3);

    noStroke();
    fill(180);
    text("MODO:", 28, 27);

    if (mockMode) {
      fill(80, 220, 100);
      text(`SIM (${params.intervaloMock}ms)`, 68, 27);
    } else {
      fill(255, 160, 40);
      text(`REAL (>${params.rssiMinimo}dB)`, 68, 27);
    }

    fill(160);
    text("|", 222, 27);
    text("ESCALA ACTUAL:", 236, 27);

    fill(120, 200, 255);
    text(txtEscala, 342, 27);

    const margenInf = 34;
    const yFooter = height - margenInf;
    const altoFooter = 24;

    // Línea de estado justo arriba del pie: serial y grabación
    textSize(11);
    textAlign(LEFT, CENTER);
    noStroke();
    const yEstado = yFooter - 14;
    let xEstado = 24;
    const est = textoEstadoSerial();
    if (est) {
      fill(...est.col);
      text(est.txt, xEstado, yEstado);
      xEstado += textWidth(est.txt) + 24;
    }
    if (grabando) {
      fill(255, 80, 80);
      const pctAleat = macsTotal ? round(100 * macsAleat / macsTotal) : 0;
      text(`● REC ${filasTotal - 1} probes · MACs únicas ${macsTotal} · aleatorias ${macsAleat} (${pctAleat}%) · [G] para guardar`, xEstado, yEstado);
    }

    noStroke();
    fill(0, 0, 0, 210);
    rect(20, yFooter, width - 40, altoFooter, 3);
    stroke(255, 50);
    noFill();
    rect(20, yFooter, width - 40, altoFooter, 3);

    noStroke();
    textSize(11);
    textAlign(LEFT, CENTER);

    const centroYTexto = yFooter + altoFooter / 2;
    let posX = 30;

    const itemsInstrucciones = [
      { tecla: "[C]", desc: "Audio/Serial" },
      { tecla: "[M]", desc: "Modo Real/Sim" },
      { tecla: "[N]", desc: "Disparar Probe" },
      { tecla: "[P]", desc: "Abrir Proyector" },
      { tecla: "[R]", desc: "Reiniciar Obra" },
      { tecla: "[G]", desc: "Grabar Probes" },
      { tecla: "[T]", desc: "Terminal de Datos" },
      { tecla: "[O]", desc: "Orbital / Libre" },
      { tecla: "[V]", desc: "Colapso" },
      { tecla: "[F]", desc: "Pantalla Completa" },
      { tecla: "[H]", desc: "Ocultar Controles" }
    ];

    for (let i = 0; i < itemsInstrucciones.length; i++) {
      const it = itemsInstrucciones[i];
      fill(80, 220, 100);
      text(it.tecla, posX, centroYTexto);
      posX += textWidth(it.tecla) + 5;

      fill(210);
      text(it.desc, posX, centroYTexto);
      posX += textWidth(it.desc) + 16;
    }
    pop();
  } else {
    // HUD oculto: solo se muestra algo si hay un problema o se está grabando
    const est = textoEstadoSerial();
    const hayProblema = est && estadoSerial !== "conectado" && estadoSerial !== "sim";
    if (hayProblema || grabando) {
      push();
      textFont("monospace");
      textSize(11);
      textAlign(LEFT, TOP);
      noStroke();
      if (hayProblema) { fill(...est.col, 160); text(est.txt, 14, 12); }
      if (grabando) { fill(255, 80, 80, 160); text("● REC", 14, hayProblema ? 28 : 12); }
      pop();
    }
  }
}
