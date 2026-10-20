const canal = new BroadcastChannel('instalacion_dialogo');

// Latido: si el notebook deja de enviar cuadros, la imagen se funde a negro en vez de quedar congelada.
let ultimoFrame = 0;
const SIN_SENAL_MS = 2000;

let entidadesRecibidas = [];
let conexionesRecibidas = [];
let colapsoActivo = false;
let parpadeoNegro = 0;
let seguimientosActuales = [];

// Resolución del notebook que genera los datos (llega en cada SYNC_FRAME).
let anchoOrigen = 1440;
let altoOrigen = 900;

const params = {
  distConexion: 160,
  opacidadLineas: 3.0,
  tamanoBase: 1.0,
  brilloParticulas: 1.0,
  pctNombresSimulados: 35
};

function setup() {
  createCanvas(windowWidth, windowHeight);

  canal.onmessage = (event) => {
    const data = event.data;

    if (data.tipo === 'SYNC_FRAME') {
      ultimoFrame = performance.now();
      entidadesRecibidas = data.entidades || [];
      conexionesRecibidas = data.conexiones || [];
      colapsoActivo = Boolean(data.colapso && data.colapso.activo);
      parpadeoNegro = data.colapso ? data.colapso.parpadeoNegro || 0 : 0;
      seguimientosActuales = data.colapso ? data.colapso.seguimientos || [] : [];
      if (data.anchoOrigen) anchoOrigen = data.anchoOrigen;
      if (data.altoOrigen) altoOrigen = data.altoOrigen;
      if (data.params) {
        Object.assign(params, data.params);
        if (data.params.paletaEdad && typeof asignarPaletaEdad === "function") {
          asignarPaletaEdad(data.params.paletaEdad);
        }
      }
    } else if (data.tipo === 'LIMPIAR_TODO') {
      entidadesRecibidas = [];
      conexionesRecibidas = [];
      colapsoActivo = false;
      parpadeoNegro = 0;
      seguimientosActuales = [];
    }
  };
}

function draw() {
  background(0);

  if (ultimoFrame > 0 && performance.now() - ultimoFrame > SIN_SENAL_MS &&
      (entidadesRecibidas.length > 0 || conexionesRecibidas.length > 0 || colapsoActivo || parpadeoNegro > 0)) {
    entidadesRecibidas = [];      // el fondo translúcido se encarga del fundido a negro
    conexionesRecibidas = [];
    colapsoActivo = false;
    parpadeoNegro = 0;
    seguimientosActuales = [];
  }

  // Factor de escala proyector / notebook: tamaños y grosores se ven igual en cualquier resolución.
  const k = (width / anchoOrigen + height / altoOrigen) / 2;

  // 1. Entidades (mismo orden de dibujo que el notebook: primero células, después filamentos)
  noStroke();
  for (const e of entidadesRecibidas) {
    const px = e.nx * width;
    const py = e.ny * height;
    const gx = px;
    const gy = py;
    const escala = e.escala !== undefined ? e.escala : 1.0;
    const pulsoRespiracion = e.pulsoRespiracion !== undefined ? e.pulsoRespiracion : 1;
    const edadDibujo = e.edad || 0;
    const intensidadRespiracion = 0.82 + (pulsoRespiracion - 0.95) * 3.6;
    const tamEscalado = e.tamBase * params.tamanoBase * e.factorCercania * escala * k * pulsoRespiracion;
    const brilloSonoro = e.brilloSonoro || 0;

    const maduracion = constrain(e.madurez || 0, 0, 1);
    const brilloEdad = brilloPorEdad(edadDibujo);

    // Halo difuso y orgánico (mismo degradado que en el notebook)
    const potenciaHalo = map(maduracion, 0, 1, 14, 34);
    const aHalo = potenciaHalo * e.opacidad * params.brilloParticulas * 0.38 * brilloEdad;
    dibujarHaloOrganico(gx, gy, tamEscalado, edadDibujo, aHalo * 7.0 * intensidadRespiracion, e.seed || 0, millis(), colapsoActivo);

    const opacidad = min(1.0, e.opacidad);
    const tamNucleo = max(2.8 * k, tamEscalado * map(brilloSonoro, 0, 1, 0.55, 0.9));
    dibujarNucleoSuave(
      gx, gy, tamNucleo, edadDibujo,
      210 * opacidad * params.brilloParticulas * intensidadRespiracion,
      e.seed || 0,
      colapsoActivo
    );

    if (!colapsoActivo && brilloSonoro > 0.05 && opacidad > 0) {
      const alphaNucleo = constrain(
        brilloSonoro * 220 * opacidad * params.brilloParticulas, 0, 255
      );
      dibujarDestelloSuave(gx, gy, tamNucleo * 3.0, alphaNucleo);
    }
  }

  // 2. Conexiones: misma función de dibujo y de opacidad que el notebook (Conexion.js)
  if (!colapsoActivo) {
    for (const c of conexionesRecibidas) {
      const ax = c.nax * width;
      const ay = c.nay * height;
      const bx = c.nbx * width;
      const by = c.nby * height;

      // Distancia en píxeles del NOTEBOOK (la escala en que está definida distConexion), en vivo.
      const d = dist(c.nax * anchoOrigen, c.nay * altoOrigen, c.nbx * anchoOrigen, c.nby * altoOrigen);
      const flash = c.brilloFlash || 0;

      const [r, g, b] = Conexion.colorConexion(c.edadA || 0, c.edadB || 0);
      const alpha = Conexion.alpha(d, params.distConexion, c.vida, params.opacidadLineas, flash);
      Conexion.dibujarFilamentos(
        ax, ay, bx, by, c.seed, k, [r, g, b], alpha, Conexion.grosor(flash) * k
      );
    }
  }

  // 3. Etiquetas de MAC (después de los filamentos, igual que en el notebook)
  if (!colapsoActivo) {
    for (const e of entidadesRecibidas) {
      if (!e.etiqueta) continue;
      const escala = e.escala !== undefined ? e.escala : 1.0;
      const tam = e.tamBase * params.tamanoBase * e.factorCercania * escala * k;
      const [cr, cg, cb] = colorPorEdad(e.edad || 0);
      dibujarEtiquetaMac(
        e.etiqueta, e.etiquetaLetras || 0,
        e.nx * width, e.ny * height + max(tam * 1.1, tam * 0.9) + 12 * k,
        (e.etiquetaAlpha || 0) * min(1.0, e.opacidad) * params.brilloParticulas,
        cr, cg, cb, k
      );
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
        seguimiento.nx * width,
        seguimiento.ny * height,
        seguimiento.tam * k,
        seguimiento.alpha,
        seguimiento.mac,
        seguimiento.alphaMac,
        seguimiento.dbm,
        seguimiento.alphaDbm,
        k
      );
    }
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

function keyPressed() {
  if (key === 'f' || key === 'F') {
    alternarFullscreen();
    return;
  }

  canal.postMessage({
    tipo: 'COMANDO_TECLA',
    tecla: key
  });
}

function doubleClicked() {
  alternarFullscreen();
}

function alternarFullscreen() {
  const fs = fullscreen();
  fullscreen(!fs);
}