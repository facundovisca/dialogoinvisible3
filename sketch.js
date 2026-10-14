const canalProyector = new BroadcastChannel("instalacion_dialogo");
let ultimoTick = 0;   // para escalar la lógica por tiempo real (no por cuadro)

let MOCK_MODE = true;
let ultimoMockAuto = 0;

const params = {
  distConexion: 161,
  probConexion: 0.043,
  velGlobal: 0.5,
  tamanoBase: 1.2,
  tamNacimiento: 0.3,    // escala del recién nacido (menor = más chico)
  tamMaximo: 1.0,        // escala al llegar al máximo, justo antes de reproducirse
  opacidadLineas: 1.4,
  brilloParticulas: 1.4,
  mostrarParticulasEnNotebook: true,
  rssiMinimo: -85,
  entradaPct: 100,       // % de probes que se aceptan (bajalo si entran demasiados)
  cooldownMac: 800,
  crecimientoPorProbe: 0.12,     // cuánta madurez (0..1) suma cada probe: 0.12 = se divide en ~9-10 probes
  crecimientoPorConexion: 0.004, // madurez que suma cada conexión (solo esporas)
  decaimientoMadurez: 0.004,     // madurez que se pierde por segundo (muy lento)
  maxGeneraciones: 2,            // hasta qué generación de esporas pueden reproducirse
  maxReproduccionesEspora: 1,    // cuántas veces puede reproducirse cada espora (los dispositivos reales, siempre)
  minHijas: 2,                   // al reproducirse, la madre suelta entre minHijas y maxHijas células nuevas
  maxHijas: 4,
  madurezTrasReproducir: 0.0,    // madurez de la madre después de reproducirse (0 = vuelve a empezar)
  vidaEntidad: 60,       // segundos sin probe antes de que la entidad se desvanezca
  maxEntidades: 200,     // tope duro: si se supera, se desvanecen las más viejas
  modoOrbital: true,     // true = la placa es el centro y las células orbitan según su RSSI ([O] alterna)
  maxConexiones: 250,    // tope de conexiones vivas a la vez (evita miles de líneas y mensajes al proyector)
  intervaloMock: 900,
  volDrone: 0.7,
  volGrave: 0.7,
  volProbes: 1.0,
  volConexiones: 1.0,
  pulsosEntidades: true,
  glitchIntensidad: 1.0,
  glitchScanlines: 1.0,
  volRuidoVigilancia: 1.0,
  volTensionVigilancia: 1.0,
  freqRuidoVigilancia: 1.0,
};

let sDistConexion, sProbConexion, sVelGlobal, sTamanoBase, sOpacidadLineas, sBrilloParticulas, sTamNacimiento, sTamMaximo, sCrecimientoProbe;
let sRssiMinimo, sCooldownMac, sVidaEntidad, sMaxEntidades, sEntradaPct;
let infoEntradaEl;
let probesRecibidos = 0, probesAceptados = 0, ultimoConteoEntrada = 0;
const MAX_LINEAS_SERIAL_POR_FRAME = 200;
let sIntervaloMock;
let sVolDrone, sVolGrave;
let sVolProbes, sVolConexiones;
let sGlitchIntensidad, sGlitchScanlines, sVolRuidoVig, sVolTensionVig, sFreqRuidoVig;
let cbPulsosEntidades, cbVerParticulas;
let btnLimpiar;

const ultimosProbesPorMac = new Map();
const mapEntidades = new Map();
const conexiones = [];

let hudVisible = true;
let guiDiv;
let port;
let colapsoActivo = false;
let modoOrbitalAntesColapso = params.modoOrbital;
let colapsoInicio = 0;
let parpadeoNegro = 0;
let inicioSeguimientoPorEntidad = new Map();
let seguimientosActuales = [];
const PERIODO_COLAPSO_MS = 1800;
const DURACION_ADQUISICION_MS = 1400;
const DURACION_REVELADO_MAC_MS = 360;
const DURACION_REVELADO_DBBM_MS = 420;
const PULSOS_BLINK = [
  { inicio: 0, duracion: 54, alpha: 235 },
  { inicio: 108, duracion: 46, alpha: 255 },
  { inicio: 510, duracion: 58, alpha: 215 },
  { inicio: 666, duracion: 48, alpha: 250 },
  { inicio: 1248, duracion: 55, alpha: 230 }
];

const LOG_MAX = 15;
const MAX_ETIQUETAS = 40;     // etiquetas de MAC visibles a la vez (si se pasa, las de las células más viejas se borran primero)
let mostrarLog = true;        // el historial de células en consola; [T] lo oculta sin borrarlo
let serialLogEl;
let serialLogHeaderEl;
let serialLogCountEl;

// --- Serial robusto: reconexión automática + aviso de silencio ---
let serialEstado = "sim";            // "sim" | "conectado" | "sin datos" | "desconectado" | "pausado"
let ultimoDatoSerial = 0;
let ultimoIntentoSerial = 0;
let serialPausadoManual = false;     // true si se cerró a mano con [C]: no reconectar
const SERIAL_REINTENTO_MS = 5000;
const SERIAL_SILENCIO_MS = 120000;   // 2 min sin ningún dato = aviso

// --- Una sola conexión viva por par de células (se renueva en vez de duplicarse) ---
const conexionesPorPar = new Map();
const DENSIDAD_REF = 25;             // conexiones simultáneas que equivalen a "densidad máxima" (mueve drones y filtro)

// --- Envío al proyector ---
let ultimoSync = 0;

// --- Grabación de probes a CSV (tecla [G]) para calibrar con datos reales ---
const CSV_MAX_FILAS = 200000;
let grabandoCSV = false;
let filasCSV = [];
let inicioGrabacion = 0;
const macsVistas = new Set();
const macsAleatorias = new Set();
let ultimaConsola = 0;
const lineasConsola = new Map();   // id de entidad -> línea del historial de la consola
const CONSOLA_MUESTRA_SSID = true; // false = la consola no muestra el nombre de la red buscada

// Temporizadores pendientes de la obra (arpegios, destellos): se cancelan al reiniciar.
const timeoutsObra = new Set();
function programar(fn, ms) {
  const id = setTimeout(() => { timeoutsObra.delete(id); fn(); }, ms);
  timeoutsObra.add(id);
}

// REINICIAR OBRA: vuelve todo a cero, como si recién se encendiera la instalación.
function reiniciarObra() {
  if (colapsoActivo) {
    colapsoActivo = false;
    params.modoOrbital = modoOrbitalAntesColapso;
    parpadeoNegro = 0;
    inicioSeguimientoPorEntidad.clear();
    seguimientosActuales = [];
    actualizarVisibilidadLog();
  }

  // Células, conexiones y memoria de dispositivos (cooldown por MAC)
  mapEntidades.clear();
  conexiones.length = 0;
  ultimosProbesPorMac.clear();
  contadorEsporas = 0;
  conexionesPorPar.clear();
  ultimoDatoSerial = 0;

  // Probe requests: descartar lo que quedó en cola en el puerto serial...
  if (port && typeof port.availableBytes === "function") {
    try {
      let guardia = 0;
      while (port.availableBytes() > 0 && guardia++ < 5000) {
        if (!port.readUntil("\n")) break;
      }
    } catch (e) { /* puerto cerrado: no hay nada que descartar */ }
  }
  // ...reiniciar el simulador (espera un intervalo completo antes del primer probe)...
  ultimoMockAuto = millis();
  // ...y vaciar el registro de probes que se ve en pantalla.
  limpiarLineasConsola();
  if (serialLogCountEl) serialLogCountEl.textContent = "0";

  // Arpegios y destellos que estaban por ocurrir
  timeoutsObra.forEach(clearTimeout);
  timeoutsObra.clear();

  // Sonido: límites de tiempo y rotación de voces de vuelta a cero
  if (typeof reiniciarSonido === "function") reiniciarSonido();

  canalProyector.postMessage({ tipo: "LIMPIAR_TODO" });
}

function setup() {
  createCanvas(windowWidth, windowHeight);
  serialLogEl = document.getElementById("serial-log");
  serialLogHeaderEl = document.getElementById("serial-log-header");
  serialLogCountEl = document.getElementById("serial-log-count");
  if (serialLogEl) serialLogEl.style.display = mostrarLog ? "flex" : "none";
  if (serialLogHeaderEl) serialLogHeaderEl.style.display = mostrarLog ? "block" : "none";

  canalProyector.onmessage = (event) => {
    const data = event.data;
    if (data.tipo === "COMANDO_TECLA") {
      ejecutarComandoTeclado(data.tecla);
    }
  };

  guiDiv = createDiv();
  guiDiv.id("gui-panel");
  guiDiv.position(20, 55);
  guiDiv.style("background", "rgba(0, 0, 0, 0.90)");
  guiDiv.style("border", "1px solid #ffffff");
  guiDiv.style("padding", "14px 10px 14px 14px");
  guiDiv.style("color", "white");
  guiDiv.style("font-family", "monospace");
  guiDiv.style("font-size", "12px");
  guiDiv.style("display", "flex");
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

  function crearControl(nombre, min, max, val, step) {
    const contenedor = createDiv();
    contenedor.style("display", "flex");
    contenedor.style("justify-content", "space-between");
    contenedor.style("align-items", "center");
    contenedor.style("width", "280px");

    const etiqueta = createSpan(nombre);
    etiqueta.style("width", "110px");

    const slider = createSlider(min, max, val, step);
    slider.style("width", "110px");

    const valor = createSpan(val.toString());
    valor.style("width", "35px");
    valor.style("text-align", "right");

    slider.input(() => { valor.html(slider.value()); });

    contenedor.child(etiqueta);
    contenedor.child(slider);
    contenedor.child(valor);
    guiDiv.child(contenedor);

    return slider;
  }

  createDiv("<b>CONTROLES VISUALES</b>").parent(guiDiv);
  sDistConexion = crearControl("Dist. Conexión", 50, 300, params.distConexion, 1);
  sProbConexion = crearControl("Prob. Conexión", 0.001, 0.1, params.probConexion, 0.001);
  sVelGlobal = crearControl("Velocidad Gral", 0.1, 3.0, params.velGlobal, 0.1);
  sTamanoBase = crearControl("Tamaño Part.", 0.1, 3.0, params.tamanoBase, 0.1);
  sTamNacimiento = crearControl("Tam. Nacimiento", 0.05, 1.0, params.tamNacimiento, 0.05);
  sTamMaximo = crearControl("Tam. Máximo", 0.4, 5.0, params.tamMaximo, 0.1);
  sOpacidadLineas = crearControl("Opacidad Líneas", 0.0, 5.0, params.opacidadLineas, 0.1);
  sBrilloParticulas = crearControl("Brillo Part.", 0.1, 3.0, params.brilloParticulas, 0.1);

  cbVerParticulas = createCheckbox(" Ver dibujo local", params.mostrarParticulasEnNotebook);
  cbVerParticulas.parent(guiDiv);
  cbVerParticulas.style("margin-top", "3px");

  createDiv("<br><b>CALIBRACIÓN PLACA REAL</b>").parent(guiDiv);
  infoEntradaEl = createDiv("Recibidos: 0/s  |  Aceptados: 0/s");
  infoEntradaEl.parent(guiDiv);
  infoEntradaEl.style("color", "#78c8ff");
  sEntradaPct = crearControl("Entrada probes %", 0, 100, params.entradaPct, 1);
  sRssiMinimo = crearControl("Filtro RSSI dB", -95, -40, params.rssiMinimo, 1);
  sCooldownMac = crearControl("Cooldown MAC ms", 100, 4000, params.cooldownMac, 50);
  sCrecimientoProbe = crearControl("Crecim. x probe", 0.02, 0.5, params.crecimientoPorProbe, 0.01);
  sVidaEntidad = crearControl("Vida sin probe s", 5, 300, params.vidaEntidad, 5);
  sMaxEntidades = crearControl("Máx. entidades", 10, 200, params.maxEntidades, 5);

  createDiv("<br><b>SIMULACIÓN PROBES</b>").parent(guiDiv);
  sIntervaloMock = crearControl("Freq. Probe ms", 100, 4000, params.intervaloMock, 50);

  createDiv("<br><b>PAISAJE SONORO (DRONES)</b>").parent(guiDiv);
  sVolDrone = crearControl("Vol. Drones Fond", 0, 3, params.volDrone, 0.1);
  sVolGrave = crearControl("Vol. Drones Grav", 0, 3, params.volGrave, 0.1);

  createDiv("<br><b>PARTÍCULAS Y EVENTOS</b>").parent(guiDiv);
  sVolProbes = crearControl("Vol. Probes", 0, 3, params.volProbes, 0.1);
  sVolConexiones = crearControl("Vol. Conexiones", 0, 3, params.volConexiones, 0.1);

  cbPulsosEntidades = createCheckbox(" Habilitar Sonido", params.pulsosEntidades);
  cbPulsosEntidades.parent(guiDiv);
  cbPulsosEntidades.style("margin-top", "3px");
  cbPulsosEntidades.changed(() => {
    const habilitado = cbPulsosEntidades.checked();
    params.pulsosEntidades = habilitado;
    const contexto = getAudioContext();
    outputVolume(habilitado ? 1 : 0, 0);
    const operacion = habilitado ? contexto.resume() : contexto.suspend();
    operacion.catch(error => console.error("No se pudo cambiar el estado global del audio:", error));
  });

  createDiv("<br><b style='color:#ff5b52'>MODO VIGILANCIA / GLITCH [V]</b>").parent(guiDiv);
  sGlitchIntensidad = crearControl("Glitch Int. [A]", 0, 3, params.glitchIntensidad, 0.1);
  sGlitchScanlines = crearControl("Scanlines [C]", 0, 3, params.glitchScanlines, 0.1);
  sVolRuidoVig = crearControl("Vol. Ruido", 0, 3, params.volRuidoVigilancia, 0.1);
  sVolTensionVig = crearControl("Vol. Tensión", 0, 3, params.volTensionVigilancia, 0.1);
  sFreqRuidoVig = crearControl("Freq. Ráfagas", 0.2, 3, params.freqRuidoVigilancia, 0.1);

  createDiv("<br><b>ACCIONES</b>").parent(guiDiv);
  btnLimpiar = createButton("REINICIAR OBRA [R]");
  btnLimpiar.parent(guiDiv);
  btnLimpiar.style("background", "#111");
  btnLimpiar.style("color", "#fff");
  btnLimpiar.style("border", "1px solid #777");
  btnLimpiar.style("padding", "6px 10px");
  btnLimpiar.style("font-family", "monospace");
  btnLimpiar.style("font-size", "11px");
  btnLimpiar.style("cursor", "pointer");
  btnLimpiar.style("margin-top", "2px");
  btnLimpiar.mousePressed(reiniciarObra);

  if (!MOCK_MODE) {
    port = createSerial();
    const usedPorts = usedSerialPorts();
    if (usedPorts.length > 0) port.open(usedPorts[0], 115200);
  }

  iniciarCapaGrave();
  iniciarDronesTensionColapso();
  iniciarAmbienteColapso();
  iniciarPulso();
  iniciarConexionSonora();
  if (typeof iniciarMasterSuave === "function") iniciarMasterSuave();

  setInterval(() => {
    if (document.hidden) actualizarLogicaGlobal();
  }, 1000 / 60);
}

function draw() {
  params.distConexion = sDistConexion.value();
  params.probConexion = sProbConexion.value();
  params.velGlobal = sVelGlobal.value();
  params.tamanoBase = sTamanoBase.value();
  params.tamNacimiento = sTamNacimiento.value();
  params.tamMaximo = sTamMaximo.value();
  params.opacidadLineas = sOpacidadLineas.value();
  params.brilloParticulas = sBrilloParticulas.value();

  params.entradaPct = sEntradaPct.value();
  params.rssiMinimo = sRssiMinimo.value();
  params.cooldownMac = sCooldownMac.value();
  params.crecimientoPorProbe = sCrecimientoProbe.value();
  params.vidaEntidad = sVidaEntidad.value();
  params.maxEntidades = sMaxEntidades.value();
  params.intervaloMock = sIntervaloMock.value();

  params.volDrone = sVolDrone.value();
  params.volGrave = sVolGrave.value();
  params.volProbes = sVolProbes.value();
  params.volConexiones = sVolConexiones.value();
  params.pulsosEntidades = cbPulsosEntidades.checked();
  params.mostrarParticulasEnNotebook = cbVerParticulas.checked();

  if (sGlitchIntensidad) {
    params.glitchIntensidad = sGlitchIntensidad.value();
    params.glitchScanlines = sGlitchScanlines.value();
    params.volRuidoVigilancia = sVolRuidoVig.value();
    params.volTensionVigilancia = sVolTensionVig.value();
    params.freqRuidoVigilancia = sFreqRuidoVig.value();
  }

  background(0);
  actualizarLogicaGlobal();

  if (params.mostrarParticulasEnNotebook) {
    for (const [mac, e] of mapEntidades.entries()) e.dibujar();
    for (const c of conexiones) c.dibujar();
    if (!colapsoActivo) {
      for (const e of mapEntidades.values()) e.dibujarEtiqueta();
    }
  }

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

    if (MOCK_MODE) {
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
    const txtEscala = typeof nombreEscalaActual !== "undefined" ? nombreEscalaActual : "PENTATÓNICA A MENOR";
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
    if (grabandoCSV) {
      fill(255, 80, 80);
      const pctAleat = macsVistas.size ? round(100 * macsAleatorias.size / macsVistas.size) : 0;
      text(`● REC ${filasCSV.length - 1} probes · MACs únicas ${macsVistas.size} · aleatorias ${macsAleatorias.size} (${pctAleat}%) · [G] para guardar`, xEstado, yEstado);
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
  }
  else {
    // HUD oculto: solo se muestra algo si hay un problema (o se está grabando), bien discreto.
    const est = textoEstadoSerial();
    const hayProblema = est && serialEstado !== "conectado" && serialEstado !== "sim";
    if (hayProblema || grabandoCSV) {
      push();
      textFont("monospace");
      textSize(11);
      textAlign(LEFT, TOP);
      noStroke();
      if (hayProblema) { fill(...est.col, 160); text(est.txt, 14, 12); }
      if (grabandoCSV) { fill(255, 80, 80, 160); text("● REC", 14, hayProblema ? 28 : 12); }
      pop();
    }
  }
  if (colapsoActivo && parpadeoNegro > 0) {
    push();
    noStroke();
    fill(0, parpadeoNegro);
    rect(0, 0, width, height);
    pop();
  }
  if (colapsoActivo) {
    for (const seguimiento of seguimientosActuales) {
      dibujarSeguimientoCelula(
        seguimiento.x,
        seguimiento.y,
        seguimiento.tam,
        seguimiento.alpha,
        seguimiento.mac,
        seguimiento.alphaMac,
        seguimiento.dbm,
        seguimiento.alphaDbm,
        1
      );
    }
    const ruidoActivo = typeof estaActivoRuidoColapso === "function" ? estaActivoRuidoColapso() : false;
    aplicarEfectoGlitch(ruidoActivo, 1);
  }
}

function actualizarLogicaGlobal() {
  const ahora = millis();
  parpadeoNegro = colapsoActivo ? calcularParpadeoNegro(ahora) : 0;
  // kt = cuadros equivalentes desde la última llamada (1 a 60 fps). Todo lo "por cuadro" se escala con kt.
  const kt = ultimoTick === 0 ? 1 : constrain((ahora - ultimoTick) / (1000 / 60), 0, 6);
  ultimoTick = ahora;


  // Contador de entrada: cuántos probes llegan y cuántos se aceptan por segundo.
  if (ultimoConteoEntrada === 0) ultimoConteoEntrada = ahora;
  const transcurrido = ahora - ultimoConteoEntrada;
  if (transcurrido >= 1000) {
    const seg = transcurrido / 1000;
    if (infoEntradaEl) {
      infoEntradaEl.html(
        `Recibidos: ${(probesRecibidos / seg).toFixed(1)}/s  |  Aceptados: ${(probesAceptados / seg).toFixed(1)}/s`
      );
    }
    probesRecibidos = 0;
    probesAceptados = 0;
    ultimoConteoEntrada = ahora;
  }

  if (!MOCK_MODE) {
    gestionarSerial(ahora);
    if (port && serialEstado !== "desconectado" && serialEstado !== "pausado") {
      // Antes: una línea por frame. Con probes reales el buffer crecía y aparecía latencia.
      let leidas = 0;
      while (port.availableBytes() > 0 && leidas < MAX_LINEAS_SERIAL_POR_FRAME) {
        const str = port.readUntil("\n");
        if (!str || str.length === 0) break;
        procesarMensajeSerial(str.trim());
        leidas++;
      }
      if (leidas > 0) ultimoDatoSerial = ahora;
    }
  } else {
    if (ahora - ultimoMockAuto > params.intervaloMock) {
      generarProbeSimulado();
      ultimoMockAuto = ahora;
    }
  }

  const paraReproducir = [];
  for (const [mac, e] of mapEntidades.entries()) {
    e.actualizar(ahora);
    if (e.muerta) {
      mapEntidades.delete(mac);
      ultimosProbesPorMac.delete(mac);
    } else if (e.listaParaReproducir) {
      if (e.puedeReproducirse()) paraReproducir.push(e);      // se reproduce fuera del bucle (no tocar el Map mientras se recorre)
      else if (e.esEspora) e.morir(0.012);              // última generación: al madurar se desvanece (no se reproduce)
    }
  }
  for (const madre of paraReproducir) reproducirCelula(madre);
  actualizarVigilancia(ahora);

  // Tope duro: si hay demasiadas, se desvanecen las de probe más viejo.
  // Se cuentan solo las que no están ya yéndose, para no marcar de más mientras se desvanecen.
  const vivas = Array.from(mapEntidades.values()).filter(e => !e.desvaneciendo);
  if (vivas.length > params.maxEntidades) {
    // Primero se van las esporas (de mayor generación, y las más viejas). Los dispositivos reales, al final:
    // las esporas renuevan su "último probe" con cada conexión y antes hacían que se sacrificara al dispositivo real.
    vivas.sort((x, y) =>
      (Number(y.esEspora) - Number(x.esEspora)) ||
      (y.generacion - x.generacion) ||
      (x.ultimoProbe - y.ultimoProbe));
    const sobrantes = vivas.length - params.maxEntidades;
    for (let i = 0; i < sobrantes; i++) vivas[i].morir();
  }

  const entidadesActivas = Array.from(mapEntidades.values());

  for (let i = conexiones.length - 1; i >= 0; i--) {
    conexiones[i].actualizar(kt);   // decae el flash siempre, se dibuje o no en el notebook
    conexiones[i].vida -= 0.015 * kt;
    if (conexiones[i].vida <= 0.02) {
      const c = conexiones[i];
      if (conexionesPorPar.get(c.clave) === c) conexionesPorPar.delete(c.clave);
      conexiones.splice(i, 1);
    }
  }

  // La probabilidad es "por cuadro a 60 fps": se ajusta al tiempo real transcurrido.
  const pCon = 1 - Math.pow(1 - params.probConexion, kt);
  let acordeDisparadoEsteFrame = false;

  for (let i = 0; !colapsoActivo && i < entidadesActivas.length; i++) {
    for (let j = i + 1; j < entidadesActivas.length; j++) {
      const a = entidadesActivas[i];
      const b = entidadesActivas[j];
      if (a.opacidad < 0.3 || b.opacidad < 0.3) continue;
      const d = dist(a.x, a.y, b.x, b.y);

      if (d < params.distConexion && random() < pCon) {
        // Un par de células tiene UNA sola conexión viva: si ya existe se renueva y destella de nuevo
        // (antes se apilaban varias líneas encima y se inflaba la "densidad").
        const clave = a.mac < b.mac ? a.mac + "|" + b.mac : b.mac + "|" + a.mac;
        let existente = conexionesPorPar.get(clave);
        if (existente && !((existente.a === a && existente.b === b) || (existente.a === b && existente.b === a))) {
          existente = null;   // quedó de una célula anterior con la misma MAC: se reemplaza por una nueva
        }
        if (existente) {
          existente.vida = 1.0;
          existente.destellar();     // el destello de la línea no depende del sonido
        } else {
          if (conexiones.length >= params.maxConexiones) continue;
          const nuevaConexion = new Conexion(a, b, d);
          nuevaConexion.clave = clave;
          nuevaConexion.destellar();
          conexiones.push(nuevaConexion);
          conexionesPorPar.set(clave, nuevaConexion);
        }

        if (typeof a.alimentar === "function") a.alimentar();
        if (typeof b.alimentar === "function") b.alimentar();

        if (!acordeDisparadoEsteFrame) {
          const clusterVoces = [
            { freq: a.frecuencia, nx: a.x / width, mac: a.mac, entidad: a },
            { freq: b.frecuencia, nx: b.x / width, mac: b.mac, entidad: b }
          ];

          let sumaDist = d;
          let cantNodos = 2;

          for (let k = 0; k < entidadesActivas.length; k++) {
            if (k === i || k === j) continue;
            const c = entidadesActivas[k];
            const dAC = dist(a.x, a.y, c.x, c.y);
            const dBC = dist(b.x, b.y, c.x, c.y);

            if (dAC < params.distConexion && dBC < params.distConexion) {
              clusterVoces.push({ freq: c.frecuencia, nx: c.x / width, mac: c.mac, entidad: c });
              if (typeof c.alimentar === "function") c.alimentar();
              sumaDist += (dAC + dBC) * 0.5;
              cantNodos++;
              if (cantNodos >= 4) break;
            }
          }

          if (typeof dispararAcordeGrupo === "function") {
            const ocurrio = dispararAcordeGrupo(clusterVoces, sumaDist / cantNodos);
            acordeDisparadoEsteFrame = true;
            if (ocurrio) {
              // Destellos independientes del volumen: cada célula se ilumina en su turno del arpegio.
              clusterVoces.forEach((v, idx) => {
                if (idx === 0) v.entidad.brilloSonoro = 1.0;
                else programar(() => { v.entidad.brilloSonoro = 1.0; }, idx * 35);
              });
            }
          }
        }
      }
    }
  }

  const payloadEntidades = [];
  for (const [mac, e] of mapEntidades.entries()) {
    payloadEntidades.push({
      mac: mac,
      nx: e.x / width,
      ny: e.y / height,
      factorCercania: e.factorCercania,
      madurez: e.madurezVisual,
      edad: e.edadColor,
      seed: e.seed,
      escala: e.escalaTamano,
      opacidad: e.opacidad,
      brilloSonoro: e.brilloSonoro,
      pulsoRespiracion: e.pulsoRespiracion,
      tamBase: e.tamBase,
      interferencia: e.interferencia,
      etiqueta: e.etiqueta,                 // MAC completa ("" si no tiene o ya se borró)
      etiquetaLetras: e.etiquetaLetras,
      etiquetaAlpha: e.etiquetaAlpha
    });
  }

  const payloadConexiones = [];
  for (const c of conexiones) {
    payloadConexiones.push({
      nax: c.a.x / width,
      nay: c.a.y / height,
      nbx: c.b.x / width,
      nby: c.b.y / height,
      distancia: c.distancia,
      vida: c.vida,
      brilloFlash: c.brilloFlash,
      edadA: c.a.edadColor,
      edadB: c.b.edadColor,
      seed: c.seed
    });
  }

  // Con poca carga se envía a 60 Hz. Con muchísimos elementos se baja a ~30 Hz para no saturar el canal.
  const pesado = payloadEntidades.length + payloadConexiones.length > 300;
  const enviar = !pesado || ahora - ultimoSync >= 33;
  if (enviar) ultimoSync = ahora;
  if (enviar) canalProyector.postMessage({
    tipo: "SYNC_FRAME",
    anchoOrigen: width,     // el proyector escala tamaños y distancias según esta resolución
    altoOrigen: height,
    entidades: payloadEntidades,
    conexiones: payloadConexiones,
    colapso: {
      activo: colapsoActivo,
      ruidoActivo: typeof estaActivoRuidoColapso === "function" ? estaActivoRuidoColapso() : false,
      parpadeoNegro: parpadeoNegro,
      seguimientos: seguimientosActuales.map(seguimiento => ({
        nx: seguimiento.x / width,
        ny: seguimiento.y / height,
        tam: seguimiento.tam,
        alpha: seguimiento.alpha,
        alphaMac: seguimiento.alphaMac,
        alphaDbm: seguimiento.alphaDbm,
        mac: seguimiento.mac,
        dbm: seguimiento.dbm
      }))
    },
    params: {
      distConexion: params.distConexion,
      opacidadLineas: params.opacidadLineas,
      tamanoBase: params.tamanoBase,
      brilloParticulas: params.brilloParticulas,
      glitchIntensidad: params.glitchIntensidad,
      glitchScanlines: params.glitchScanlines
    }
  });

  let densidad = constrain(conexiones.length / DENSIDAD_REF, 0, 1);
  const dispositivosActivos = Array.from(mapEntidades.values())
    .filter(e => !e.esEspora && !e.desvaneciendo).length;
  actualizarCampo(densidad, dispositivosActivos, colapsoActivo, parpadeoNegro, ahora - colapsoInicio);
  actualizarConsola(ahora);
}

let contadorEsporas = 0;

// Elige `cantidad` notas distintas entre sí y distintas de las de `excluir`.
function elegirNotasNuevas(cantidad, excluir) {
  const escala = (typeof ESCALA_BASE_CONSONANTE !== "undefined" && ESCALA_BASE_CONSONANTE.length > 0)
    ? ESCALA_BASE_CONSONANTE
    : [146.83];
  const pool = escala.filter(f => !excluir.includes(f));
  const notas = [];
  while (notas.length < cantidad) {
    if (pool.length === 0) {
      notas.push(random(escala));
    } else {
      notas.push(pool.splice(floor(random(pool.length)), 1)[0]);
    }
  }
  return notas;
}

// La madre llegó al tamaño máximo: NO muere. Se desprenden de 2 a 4 células nuevas
// (al azar), cada una con una nota nueva, y la madre vuelve a empezar a crecer.
// Tope de etiquetas simultáneas (para que no se pisen): si con las "nuevas" se pasa de MAX_ETIQUETAS,
// las etiquetas más viejas empiezan a borrarse (con su fundido) para dejarles lugar.
function liberarEtiquetas(nuevas, ahora) {
  const conTexto = [];
  for (const otra of mapEntidades.values()) if (otra.etiqueta && !otra.etiquetaFin) conTexto.push(otra);
  const sobran = conTexto.length + nuevas - MAX_ETIQUETAS;
  if (sobran <= 0) return;
  conTexto.sort((x, y) => x.etiquetaNace - y.etiquetaNace);
  for (let i = 0; i < sobran && i < conTexto.length; i++) conTexto[i].etiquetaFin = ahora;
}

function reproducirCelula(madre) {
  const cantidad = floor(random(params.minHijas, params.maxHijas + 1));
  const notas = elegirNotasNuevas(cantidad, [madre.frecuencia]);

  const anguloBase = random(TWO_PI);
  const paso = TWO_PI / cantidad;
  liberarEtiquetas(cantidad, millis());

  for (let i = 0; i < cantidad; i++) {
    const ang = anguloBase + i * paso + random(-0.3, 0.3);
    const id = `ESP_${contadorEsporas++}`;
    const hija = new Entidad(madre.x + cos(ang) * 18, madre.y + sin(ang) * 18, madre.rssi, id, true, ang);

    hija.generacion = madre.generacion + 1;
    hija.heredarOrbita(madre);
    // La hija lleva la MAC del dispositivo original: el nombre se hereda de generación en generación.
    hija.macOrigen = madre.macOrigen || madre.mac;
    hija.etiqueta = String(hija.macOrigen).toUpperCase();
    hija.etiquetaNace = millis();
    hija.frecuencia = notas[i];
    hija.brilloSonoro = 1.0;
    mapEntidades.set(id, hija);

    // Cada hija suena con su nota propia, escalonadas como un pequeño arpegio.
    if (typeof dispararPulsoCrecimiento === "function") {
      const sonar = () => {
        dispararPulsoCrecimiento(0.5, hija.rssi, hija.frecuencia, hija.x / width, hija);
      };
      if (i === 0) sonar();
      else programar(sonar, i * 110);
    }
  }

  // La madre sigue viva: se "vacía" y empieza a crecer de nuevo.
  madre.madurez = params.madurezTrasReproducir;
  madre.llegoAlMax = false;
  madre.reproducciones++;
  madre.brilloSonoro = 1.0;

}

function procesarMensajeSerial(str) {
  const partes = str.split(",");
  if (partes.length >= 3 && partes[0] === "PROBE") {
    const mac = partes[1].trim();
    const rssi = parseInt(partes[2].trim(), 10);
    if (!mac || isNaN(rssi)) return;   // línea corrupta: antes NaN pasaba el filtro de RSSI
    const ssid = partes.length >= 4 ? partes.slice(3).join(",").trim() : "";   // un SSID puede traer comas

    probesRecibidos++;

    if (rssi < params.rssiMinimo) { registrarProbeCSV(mac, rssi, ssid, "descartado_rssi"); return; }

    // Reducción de entrada: acepta solo el porcentaje elegido de los probes que pasan el filtro.
    // Va antes del cooldown para que un probe descartado no bloquee a la MAC.
    if (random(100) >= params.entradaPct) { registrarProbeCSV(mac, rssi, ssid, "descartado_entrada"); return; }

    const ahora = millis();
    if (ultimosProbesPorMac.has(mac)) {
      if (ahora - ultimosProbesPorMac.get(mac) < params.cooldownMac) { registrarProbeCSV(mac, rssi, ssid, "descartado_cooldown"); return; }
    }
    ultimosProbesPorMac.set(mac, ahora);
    probesAceptados++;
    registrarProbeCSV(mac, rssi, ssid, "aceptado");

    if (mapEntidades.has(mac)) {
      const existente = mapEntidades.get(mac);
      existente.registrarProbe(rssi);
      existente.ssid = ssid;

      if (existente.puedeReproducirse()) {
        reproducirCelula(existente);
      } else {
        if (typeof dispararPulsoCrecimiento === "function") {
          dispararPulsoCrecimiento(existente.maduracion, rssi, existente.frecuencia, existente.x / width, existente);
        }
      }
    } else {
      const x = random(width);
      const y = random(height);
      const nuevaEntidad = new Entidad(x, y, rssi, mac);
      nuevaEntidad.cantidadPeticiones = 1;
      liberarEtiquetas(1, ahora);   // toda célula real nace CON su MAC (si hace falta, se borra la etiqueta más vieja)
      nuevaEntidad.ssid = ssid;
      mapEntidades.set(mac, nuevaEntidad);

      if (typeof dispararPulsoCrecimiento === "function") {
        dispararPulsoCrecimiento(0.0, rssi, nuevaEntidad.frecuencia, x / width, nuevaEntidad);
      }
    }

  }
}

const DISPOSITIVOS_SALA = [
  { mac: "A4:C3:F0:8A:11:42", ssids: ["Lab_Artes", "UNA_Alumnos", "BROADCAST"], tipo: "permanente" },
  { mac: "38:F9:D3:9B:4C:E1", ssids: ["Fibertel-WiFi-601", "BROADCAST"], tipo: "permanente" },
  { mac: "B0:4E:26:77:01:A9", ssids: ["iPhone_Santi", "BROADCAST"], tipo: "permanente" },
  { mac: "68:DB:CA:41:2E:8F", ssids: ["TeleCentro-WiFi-2.4", "BROADCAST"], tipo: "permanente" },
  { mac: "FC:E9:98:A2:33:55", ssids: ["Personal-Flow-88", "BROADCAST"], tipo: "permanente" },
  { mac: "14:2D:27:E5:60:81", ssids: ["BA_WiFi_Gratis", "BROADCAST"], tipo: "permanente" },
  { mac: "84:D4:7E:11:B2:9C", ssids: ["Galaxy-A54", "BROADCAST"], tipo: "permanente" },
  { mac: "AC:BC:32:8D:E0:41", ssids: ["Claro-Red-412", "BROADCAST"], tipo: "permanente" },
  { mac: "58:CB:52:19:D4:F0", ssids: ["iPad_Taller", "BROADCAST"], tipo: "permanente" },
  { mac: "D4:61:9D:3A:82:13", ssids: ["Movistar_Fibra_7B", "BROADCAST"], tipo: "permanente" },
  { mac: "2C:F0:5D:81:AA:99", ssids: ["iPhone_Gaby", "BROADCAST"], tipo: "permanente" },
  { mac: "70:85:C2:5E:10:3B", ssids: ["Motorola_Edge", "BROADCAST"], tipo: "permanente" },
  { mac: "52:54:00:12:34:56", ssids: ["ThinkPad_T480", "BROADCAST"], tipo: "permanente" },
  { mac: "00:1A:2B:3C:4D:5E", ssids: ["MacBook_Pro_14", "BROADCAST"], tipo: "permanente" },
  { mac: "3C:22:FB:99:11:22", ssids: ["Galaxy_Tab_S8", "BROADCAST"], tipo: "permanente" },
  { mac: "80:2A:A8:44:55:66", ssids: ["Apple_Watch_S7", "BROADCAST"], tipo: "permanente" },
  { mac: "44:65:0D:77:88:99", ssids: ["Pixel_7_Pro", "BROADCAST"], tipo: "permanente" },
  { mac: "9C:8E:99:33:22:11", ssids: ["iPad_Air_5", "BROADCAST"], tipo: "permanente" },
  { mac: "94:E6:F7:19:D4:6C", ssids: ["BROADCAST", "MiFibra-104"], tipo: "medio" },
  { mac: "18:65:90:3A:FB:27", ssids: ["Redmi_Note_12", "BROADCAST"], tipo: "medio" },
  { mac: "D8:12:65:4E:91:02", ssids: ["Fibertel-WiFi-204", "BROADCAST"], tipo: "medio" },
  { mac: "50:32:75:A8:1F:B4", ssids: ["BROADCAST"], tipo: "medio" },
  { mac: "E4:5F:01:B9:33:7C", ssids: ["iPhone_Turista", "BROADCAST"], tipo: "medio" },
  { mac: "88:66:5A:02:44:CD", ssids: ["TeleCentro-WiFi-5G", "BROADCAST"], tipo: "medio" },
  { mac: "00:E0:4C:90:7E:11", ssids: ["BA_WiFi_Gratis", "BROADCAST"], tipo: "medio" },
  { mac: "C0:EE:FB:41:88:22", ssids: ["Galaxy_S23_Ultra", "BROADCAST"], tipo: "medio" },
  { mac: "40:4E:36:20:99:A1", ssids: ["BROADCAST"], tipo: "medio" },
  { mac: "34:80:B3:7C:15:E8", ssids: ["DIRECTV_Net_2.4", "BROADCAST"], tipo: "medio" },
  { mac: "24:4B:FE:12:87:65", ssids: ["Moto_G82", "BROADCAST"], tipo: "medio" },
  { mac: "74:AC:B9:66:77:88", ssids: ["Redmi_Note_10", "BROADCAST"], tipo: "medio" },
  { mac: "AC:87:A3:44:11:00", ssids: ["BROADCAST"], tipo: "medio" },
  { mac: "10:94:BB:22:33:44", ssids: ["iPhone_11", "BROADCAST"], tipo: "medio" },
  { mac: "B8:78:26:99:88:77", ssids: ["Fibertel_WiFi", "BROADCAST"], tipo: "medio" },
  { mac: "E0:D4:E8:55:66:77", ssids: ["BROADCAST"], tipo: "medio" },
  { mac: "64:16:66:33:44:55", ssids: ["Galaxy_A14", "BROADCAST"], tipo: "medio" },
  { mac: "90:78:41:11:22:33", ssids: ["BROADCAST"], tipo: "medio" },
  { mac: "F8:1A:67:8B:20:44", ssids: ["BROADCAST"], tipo: "paso" },
  { mac: "A0:C5:89:12:34:56", ssids: ["Uber_Driver_WiFi", "BROADCAST"], tipo: "paso" },
  { mac: "60:01:94:AA:BB:CC", ssids: ["BROADCAST"], tipo: "paso" },
  { mac: "78:28:CA:DD:EE:11", ssids: ["iPhone", "BROADCAST"], tipo: "paso" },
  { mac: "28:6A:B8:33:22:11", ssids: ["BROADCAST"], tipo: "paso" },
  { mac: "BC:D1:77:44:55:66", ssids: ["TeleCentro-440", "BROADCAST"], tipo: "paso" },
  { mac: "48:2C:A0:77:88:99", ssids: ["Galaxy-J7-Prime", "BROADCAST"], tipo: "paso" },
  { mac: "90:9A:4A:10:20:30", ssids: ["BROADCAST"], tipo: "paso" },
  { mac: "1C:56:FE:44:33:22", ssids: ["BROADCAST"], tipo: "paso" },
  { mac: "A8:96:75:55:44:33", ssids: ["BROADCAST"], tipo: "paso" },
  { mac: "54:E4:3A:66:77:88", ssids: ["BROADCAST"], tipo: "paso" },
  { mac: "C8:3A:35:11:00:99", ssids: ["BROADCAST"], tipo: "paso" },
  { mac: "D0:03:DF:22:33:44", ssids: ["BROADCAST"], tipo: "paso" },
  { mac: "4C:EB:BD:77:88:99", ssids: ["BROADCAST"], tipo: "paso" },
  { mac: "7C:04:D0:88:99:00", ssids: ["BROADCAST"], tipo: "paso" },
  { mac: "8C:85:90:99:00:11", ssids: ["BROADCAST"], tipo: "paso" },
  { mac: "30:07:4D:11:22:33", ssids: ["BROADCAST"], tipo: "paso" }
];

function generarProbeSimulado() {
  const r = random();
  let candidatos = r < 0.6 ? DISPOSITIVOS_SALA.filter(d => d.tipo === "permanente") : (r < 0.85 ? DISPOSITIVOS_SALA.filter(d => d.tipo === "medio") : DISPOSITIVOS_SALA.filter(d => d.tipo === "paso"));
  const disp = random(candidatos);
  const ssidRandom = random(disp.ssids);
  let rssiRandom = disp.tipo === "permanente" ? floor(random(-72, -38)) : (disp.tipo === "medio" ? floor(random(-82, -50)) : floor(random(-92, -70)));
  procesarMensajeSerial(`PROBE,${disp.mac},${rssiRandom},${ssidRandom}`);
}

function ejecutarComandoTeclado(k) {
  if (k === "c" || k === "C") {
    desbloquearAudio();
    if (!MOCK_MODE && port) {
      if (!port.opened()) { serialPausadoManual = false; port.open(115200); }
      else { serialPausadoManual = true; port.close(); }
    }
  }
  if (k === "m" || k === "M") {
    MOCK_MODE = !MOCK_MODE;
    reiniciarObra();               // cada modo arranca la obra de cero (no se mezclan células SIM con REAL)
    if (!MOCK_MODE) {
      serialPausadoManual = false;
      if (!port) port = createSerial();
      const usedPorts = usedSerialPorts();
      if (usedPorts.length > 0) port.open(usedPorts[0], 115200);
    } else {
      if (port && port.opened()) port.close();
    }
  }
  if (k === "h" || k === "H") {
    hudVisible = !hudVisible;
    if (guiDiv) guiDiv.style("display", hudVisible ? "flex" : "none");
  }
  if (k === "p" || k === "P") {
    window.open("proyector.html", "Proyector", "width=1920,height=1080");
  }
  if (k === "f" || k === "F") fullscreen(!fullscreen());
  if (k === "g" || k === "G") alternarGrabacion();
  if (k === "o" || k === "O") {
    if (colapsoActivo) modoOrbitalAntesColapso = !modoOrbitalAntesColapso;
    else params.modoOrbital = !params.modoOrbital;
  }
  if (k === "v" || k === "V") alternarColapso();
  if (k === "t" || k === "T") {
    mostrarLog = !mostrarLog;
    actualizarVisibilidadLog();
  }
  if (k === "n" || k === "N") generarProbeSimulado();
  if (k === "r" || k === "R") reiniciarObra();
}

function alternarColapso() {
  aplicarEstadoColapso(!colapsoActivo);
}

function aplicarEstadoColapso(activo) {
  colapsoActivo = activo;
  if (activo) {
    modoOrbitalAntesColapso = params.modoOrbital;
    params.modoOrbital = false;
    colapsoInicio = millis();
    inicioSeguimientoPorEntidad = new Map();
    seguimientosActuales = [];
    actualizarVisibilidadLog();
    conexiones.length = 0;
    conexionesPorPar.clear();
    if (typeof dispararRuidoColapsoInmediato === "function") {
      dispararRuidoColapsoInmediato();
    }
  } else {
    params.modoOrbital = modoOrbitalAntesColapso;
    parpadeoNegro = 0;
    inicioSeguimientoPorEntidad.clear();
    seguimientosActuales = [];
    actualizarVisibilidadLog();
  }
}

function actualizarVigilancia(ahora) {
  if (!colapsoActivo) {
    seguimientosActuales = [];
    return;
  }

  const activas = Array.from(mapEntidades.entries())
    .filter(([, e]) => !e.muerta && e.opacidad > 0.1);
  const idsActivos = new Set(activas.map(([id]) => id));
  for (const id of inicioSeguimientoPorEntidad.keys()) {
    if (!idsActivos.has(id)) inicioSeguimientoPorEntidad.delete(id);
  }
  seguimientosActuales = [];

  for (const [id, objetivo] of activas) {
    if (!inicioSeguimientoPorEntidad.has(id)) {
      inicioSeguimientoPorEntidad.set(id, ahora + demoraAdquisicion(id));
    }
    const transcurrido = ahora - inicioSeguimientoPorEntidad.get(id);
    const progreso = constrain(transcurrido / DURACION_ADQUISICION_MS, 0, 1);
    const suave = progreso * progreso * (3 - 2 * progreso);
    const alphaMac = constrain(
      (transcurrido - DURACION_ADQUISICION_MS) / DURACION_REVELADO_MAC_MS,
      0,
      1
    );
    const alphaDbm = constrain(
      (transcurrido - DURACION_ADQUISICION_MS - DURACION_REVELADO_MAC_MS) /
        DURACION_REVELADO_DBBM_MS,
      0,
      1
    );
    const semilla = semillaSeguimiento(id);
    const radioBusqueda = max(8, min(18, objetivo.tamBase * objetivo.factorCercania * 0.8));
    const faseBusqueda = max(0, transcurrido) * 0.007 + semilla;
    const radioActual = radioBusqueda * (1 - suave) *
      (0.82 + 0.18 * Math.sin(faseBusqueda * 1.7));
    const derivaX = Math.cos(faseBusqueda) * radioActual;
    const derivaY = Math.sin(faseBusqueda * 0.9) * radioActual * 0.72;
    const rssi = Number.isFinite(objetivo.rssiSuave)
      ? objetivo.rssiSuave
      : Number.isFinite(objetivo.rssi) ? objetivo.rssi : -72;
    const variacionDb = Math.sin(ahora * 0.0031 + semilla * 2.3) * 1.2;
    const tam = objetivo.tamBase * params.tamanoBase *
      objetivo.factorCercania * objetivo.escalaTamano * objetivo.pulsoRespiracion;
    seguimientosActuales.push({
      x: objetivo.x + derivaX,
      y: objetivo.y + derivaY,
      tam,
      alpha: transcurrido < 0 ? 0 : 24 + 30 * suave,
      alphaMac,
      alphaDbm,
      mac: alphaMac > 0 ? objetivo.mac : "",
      dbm: alphaDbm > 0
        ? `${Math.round(constrain(rssi + variacionDb, -100, -30))} dBm`
        : ""
    });
  }
}

function demoraAdquisicion(id) {
  let hash = semillaSeguimiento(id);
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return (hash >>> 0) % 9000;
}

function semillaSeguimiento(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return hash;
}

function calcularParpadeoNegro(ahora) {
  const t = (ahora - colapsoInicio) % PERIODO_COLAPSO_MS;
  const pulso = PULSOS_BLINK.find(p => t >= p.inicio && t < p.inicio + p.duracion);
  return pulso ? pulso.alpha : 0;
}

function actualizarVisibilidadLog() {
  const display = mostrarLog && !colapsoActivo ? "flex" : "none";
  if (serialLogEl) serialLogEl.style.display = display;
  if (serialLogHeaderEl) serialLogHeaderEl.style.display = display === "flex" ? "block" : "none";
}

// Los navegadores solo permiten iniciar el audio tras un gesto real (clic o tecla en ESTA ventana).
// Las teclas que llegan desde el proyector no cuentan. Para la muestra, abrir Chrome con:
//   --autoplay-policy=no-user-gesture-required
// Mantiene el puerto serial vivo: si se cae, reintenta solo (sin gesto, el puerto ya fue autorizado).
function gestionarSerial(ahora) {
  if (MOCK_MODE) { serialEstado = "sim"; return; }
  if (!port) { try { port = createSerial(); } catch (e) { } return; }
  let abierto = false;
  try { abierto = port.opened(); } catch (e) { }
  if (!abierto) {
    ultimoDatoSerial = 0;
    if (serialPausadoManual) { serialEstado = "pausado"; return; }
    serialEstado = "desconectado";
    if (ahora - ultimoIntentoSerial > SERIAL_REINTENTO_MS) {
      ultimoIntentoSerial = ahora;
      try {
        const usados = usedSerialPorts();
        if (usados.length > 0) port.open(usados[0], 115200);
      } catch (e) { /* se reintenta en unos segundos */ }
    }
    return;
  }
  if (ultimoDatoSerial === 0) ultimoDatoSerial = ahora;
  serialEstado = (ahora - ultimoDatoSerial > SERIAL_SILENCIO_MS) ? "sin datos" : "conectado";
}

function textoEstadoSerial() {
  if (MOCK_MODE) return null;
  switch (serialEstado) {
    case "conectado": return { txt: "SERIAL: conectado", col: [80, 220, 100] };
    case "sin datos": return { txt: `SERIAL: sin datos hace ${max(0, floor((millis() - ultimoDatoSerial) / 60000))} min`, col: [255, 160, 40] };
    case "desconectado": return { txt: "SERIAL: desconectado · reintentando…", col: [255, 80, 80] };
    case "pausado": return { txt: "SERIAL: pausado ([C] para reanudar)", col: [160, 160, 160] };
    default: return null;
  }
}

function desbloquearAudio() {
  if ((cbPulsosEntidades && !cbPulsosEntidades.checked()) || params.pulsosEntidades === false) return;
  if (getAudioContext().state !== "running") userStartAudio();
}

function mousePressed() { desbloquearAudio(); }
function windowResized() { resizeCanvas(windowWidth, windowHeight); }
function keyPressed() {
  desbloquearAudio();
  ejecutarComandoTeclado(key);
}

// Segundo bit del primer byte = "administrada localmente": la MAC es aleatoria (privacidad de iOS/Android).
function esMacAleatoria(mac) {
  return (parseInt(mac.charAt(1), 16) & 2) !== 0;
}

function alternarGrabacion() {
  if (!grabandoCSV) {
    filasCSV = ["fecha_hora,ms,mac,mac_aleatoria,rssi,ssid,estado"];
    macsVistas.clear();
    macsAleatorias.clear();
    inicioGrabacion = millis();
    grabandoCSV = true;
  } else {
    grabandoCSV = false;
    if (filasCSV.length > 1) {
      const d = new Date();
      const p2 = (n) => String(n).padStart(2, "0");
      const sello = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
      saveStrings(filasCSV, `probes_${sello}`, "csv");
    }
    filasCSV = [];
  }
}

function registrarProbeCSV(mac, rssi, ssid, estado) {
  if (!grabandoCSV) return;
  if (filasCSV.length > CSV_MAX_FILAS) { alternarGrabacion(); return; }   // tope: guarda y corta
  const aleatoria = esMacAleatoria(mac);
  macsVistas.add(mac);
  if (aleatoria) macsAleatorias.add(mac);
  const ssidCsv = '"' + String(ssid).replace(/"/g, '""') + '"';
  filasCSV.push(`${new Date().toISOString()},${Math.round(millis() - inicioGrabacion)},${mac},${aleatoria ? 1 : 0},${rssi},${ssidCsv},${estado}`);
}

// Historial acumulativo: cada dispositivo real conserva una línea con el color de su edad (excluye esporas).
function actualizarConsola(ahora) {
  if (!serialLogEl) return;
  if (ahora - ultimaConsola < 150) return;     // ~7 veces por segundo alcanza
  ultimaConsola = ahora;

  let dispositivosActivos = 0;
  let agregoLinea = false;
  for (const [id, e] of mapEntidades) {
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
    const red = !CONSOLA_MUESTRA_SSID ? "" :
      (e.ssid && e.ssid !== "BROADCAST" ? `  |  [${e.ssid}]` : "  |  <PROBE SEARCH>");
    const identidad = String(e.mac).toUpperCase();
    el.textContent = `${identidad}  |  ${Math.round(e.rssi)} dBm${red}`;   // textContent: nada se interpreta como HTML
    const [r, g, b] = colorPorEdad(colapsoActivo ? 1 : e.edadColor);
    el.style.color = `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
    el.style.opacity = (0.7 + 0.3 * Math.min(1, e.brilloSonoro)).toFixed(2);
  }
  if (serialLogCountEl) serialLogCountEl.textContent = String(dispositivosActivos);
  if (agregoLinea) serialLogEl.scrollTop = serialLogEl.scrollHeight;
}

function limpiarLineasConsola() {
  for (const el of lineasConsola.values()) el.remove();
  lineasConsola.clear();
  if (serialLogEl) serialLogEl.scrollTop = 0;
}
