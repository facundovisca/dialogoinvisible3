const canal = new BroadcastChannel('instalacion_dialogo');

// Latido: si el notebook deja de enviar cuadros, la imagen se funde a negro en vez de quedar congelada.
let ultimoFrame = 0;
const SIN_SENAL_MS = 2000;

let entidadesRecibidas = [];
let conexionesRecibidas = [];

// Resolución del notebook que genera los datos (llega en cada SYNC_FRAME).
let anchoOrigen = 1440;
let altoOrigen = 900;

const params = {
  distConexion: 160,
  opacidadLineas: 3.0,
  tamanoBase: 1.0,
  brilloParticulas: 1.0
};

function setup() {
  createCanvas(windowWidth, windowHeight);

  canal.onmessage = (event) => {
    const data = event.data;

    if (data.tipo === 'SYNC_FRAME') {
      ultimoFrame = performance.now();
      entidadesRecibidas = data.entidades || [];
      conexionesRecibidas = data.conexiones || [];
      if (data.anchoOrigen) anchoOrigen = data.anchoOrigen;
      if (data.altoOrigen) altoOrigen = data.altoOrigen;
      if (data.params) {
        Object.assign(params, data.params);
      }
    } else if (data.tipo === 'LIMPIAR_TODO') {
      entidadesRecibidas = [];
      conexionesRecibidas = [];
    }
  };
}

function draw() {
  background(0);

  if (ultimoFrame > 0 && performance.now() - ultimoFrame > SIN_SENAL_MS &&
      (entidadesRecibidas.length > 0 || conexionesRecibidas.length > 0)) {
    entidadesRecibidas = [];      // el fondo translúcido se encarga del fundido a negro
    conexionesRecibidas = [];
  }

  // Factor de escala proyector / notebook: tamaños y grosores se ven igual en cualquier resolución.
  const k = (width / anchoOrigen + height / altoOrigen) / 2;

  // 1. Entidades (mismo orden de dibujo que el notebook: primero células, después filamentos)
  noStroke();
  for (const e of entidadesRecibidas) {
    const px = e.nx * width;
    const py = e.ny * height;
    const escala = e.escala !== undefined ? e.escala : 1.0;
    const pulsoRespiracion = e.pulsoRespiracion !== undefined ? e.pulsoRespiracion : 1;
    const intensidadRespiracion = 0.82 + (pulsoRespiracion - 0.95) * 3.6;
    const tamEscalado = e.tamBase * params.tamanoBase * e.factorCercania * escala * k * pulsoRespiracion;
    const brilloSonoro = e.brilloSonoro || 0;

    const maduracion = constrain(e.madurez || 0, 0, 1);

    const brilloEdad = brilloPorEdad(e.edad || 0);      // color: verde vivo (joven) → azul sereno (vieja)

    // Halo difuso y orgánico (mismo degradado que en el notebook)
    const potenciaHalo = map(maduracion, 0, 1, 14, 34);
    const aHalo = potenciaHalo * e.opacidad * params.brilloParticulas * 0.38 * brilloEdad;
    if (HALO_ORGANICO) {
      dibujarHaloOrganico(px, py, tamEscalado, e.edad || 0, aHalo * 7.0 * intensidadRespiracion, e.seed || 0, millis());
    } else {
      const [r, g, b] = colorPorEdad(e.edad || 0);
      for (let i = 5; i > 0; i--) {
        fill(r, g, b, aHalo);
        ellipse(px, py, tamEscalado * i * 1.35);
      }
    }

    const opacidad = min(1.0, e.opacidad);
    const tamNucleo = max(2.8 * k, tamEscalado * map(brilloSonoro, 0, 1, 0.55, 0.9));
    dibujarNucleoSuave(
      px, py, tamNucleo, e.edad || 0,
      210 * opacidad * params.brilloParticulas * intensidadRespiracion,
      e.seed || 0
    );

    if (brilloSonoro > 0.05 && opacidad > 0) {
      const alphaNucleo = constrain(
        brilloSonoro * 220 * opacidad * params.brilloParticulas, 0, 255
      );
      dibujarDestelloSuave(px, py, tamNucleo * 3.0, alphaNucleo);
    }
  }

  // 2. Conexiones: misma función de dibujo y de opacidad que el notebook (Conexion.js)
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

  // 3. Etiquetas de MAC (después de los filamentos, igual que en el notebook)
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