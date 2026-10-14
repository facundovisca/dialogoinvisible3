class Conexion {
  constructor(a, b, distancia) {
    this.a = a;
    this.b = b;
    this.distancia = distancia;   // distancia al nacer (solo informativa; el dibujo usa la distancia en vivo)
    this.vida = 1.0;
    this.brilloFlash = 0.0;
    this.seed = random(1000);
  }

  destellar() {
    this.brilloFlash = 0.1;
  }

  // Lógica (se llama siempre, se dibuje o no localmente).
  // k = cuadros transcurridos (1 a 60 fps): el decaimiento no depende del framerate.
  actualizar(k = 1) {
    this.brilloFlash *= Math.pow(0.88, k);
    if (this.brilloFlash < 0.01) this.brilloFlash = 0;
  }

  // --- Funciones compartidas: el notebook y el proyector dibujan EXACTAMENTE igual ---

  // dist siempre en píxeles del notebook (la escala que usa distConexion).
  static alpha(dist, distRef, vida, opacidadLineas, flash) {
    const base = map(dist, 0, distRef, 180, 20, true);   // constrain: no se va a negativo si se estiran
    return constrain(base * vida * opacidadLineas + flash * 255, 0, 255);
  }

  static grosor(flash) {
    return map(flash, 0, 1, 0.9, 3.2);
  }

  static colorConexion(edadA, edadB) {
    const colorA = colorPorEdad(edadA);
    const colorB = colorPorEdad(edadB);
    return [
      (colorA[0] + colorB[0]) / 2,
      (colorA[1] + colorB[1]) / 2,
      (colorA[2] + colorB[2]) / 2
    ];
  }

  // Filamento ondulado. k = factor de escala de pantalla (proyector / notebook).
  // Usa vertex() (no curveVertex) para que la línea llegue hasta las dos células.
  static trazar(ax, ay, bx, by, seed, k = 1, desplazamiento = 0, amplitud = 10) {
    noFill();
    const perp = atan2(by - ay, bx - ax) + HALF_PI;
    const pasos = 10;
    beginShape();
    for (let i = 0; i <= pasos; i++) {
      const t = i / pasos;
      const x = lerp(ax, bx, t);
      const y = lerp(ay, by, t);
      const n = noise((x / k) * 0.01, (y / k) * 0.01, frameCount * 0.01 + seed);
      const offset = desplazamiento * sin(t * PI) + map(n, 0, 1, -amplitud, amplitud) * k * sin(t * PI);
      vertex(x + cos(perp) * offset, y + sin(perp) * offset);
    }
    endShape();
  }

  static dibujarFilamentos(ax, ay, bx, by, seed, k, color, alpha, grosor) {
    const [r, g, b] = color;

    stroke(r, g, b, alpha * 0.24);
    strokeWeight(grosor * 0.65);
    Conexion.trazar(ax, ay, bx, by, seed + 13.7, k, -2.2 * k, 5.5);
    Conexion.trazar(ax, ay, bx, by, seed + 29.3, k, 2.2 * k, 5.5);

    stroke(r, g, b, min(255, alpha * 1.25));
    strokeWeight(grosor * 1.15);
    Conexion.trazar(ax, ay, bx, by, seed, k);
  }

  dibujar() {
    const distRef = (typeof params !== "undefined" && params.distConexion) ? params.distConexion : 160;
    const d = dist(this.a.x, this.a.y, this.b.x, this.b.y);
    const [r, g, b] = Conexion.colorConexion(this.a.edadColor, this.b.edadColor);
    const alpha = Conexion.alpha(d, distRef, this.vida, params.opacidadLineas, this.brilloFlash);
    Conexion.dibujarFilamentos(
      this.a.x, this.a.y, this.b.x, this.b.y, this.seed, 1,
      [r, g, b], alpha, Conexion.grosor(this.brilloFlash)
    );
  }
}

// --- Etiqueta con la MAC bajo la célula (la misma función dibuja en el notebook y en el proyector) ---
// "letras" = cuántos caracteres ya se tipearon; el texto crece hacia la derecha sin moverse.
// k = factor de escala de pantalla (proyector / notebook).
function dibujarEtiquetaMac(texto, letras, x, y, alpha01, r, g, b, k = 1) {
  if (!texto || letras <= 0 || alpha01 <= 0.01) return;
  push();
  noStroke();
  textFont("monospace");
  textSize(10 * k);
  textAlign(LEFT, TOP);
  const ctx = drawingContext;
  const tieneEspaciado = ctx.letterSpacing !== undefined;
  if (tieneEspaciado) ctx.letterSpacing = (1.5 * k) + "px";
  const ancho = textWidth(texto);
  // color: el de la edad de la célula, apenas aclarado (se conserva el tono para que se lea la edad)
  fill(lerp(r, 255, 0.2), lerp(g, 255, 0.2), lerp(b, 255, 0.2), 175 * alpha01);
  text(texto.substring(0, letras), x - ancho / 2, y);
  if (tieneEspaciado) ctx.letterSpacing = "0px";
  pop();
}

// --- Color y brillo según la EDAD de la célula (0 = recién nacida, 1 = vieja) ---
// Joven: verde vivo y luminoso. Vieja: azul sereno y más tenue.
// Verde (joven) → rojo (vieja), pasando por lima, amarillo y ámbar: un verde-rojo directo se pone "oliva"
// (barro) en el medio. El rojo final es un coral claro para que el texto chico se lea sobre negro.
const _PALETA_EDAD = [
  [0.00, [80, 255, 110]],    // verde vivo
  [0.25, [170, 240, 70]],    // lima
  [0.50, [250, 220, 60]],    // amarillo
  [0.75, [255, 150, 60]],    // ámbar
  [1.00, [255, 85, 75]]      // rojo coral
];
function colorPorEdad(edad) {
  const t = constrain(edad, 0, 1);
  for (let i = 1; i < _PALETA_EDAD.length; i++) {
    if (t <= _PALETA_EDAD[i][0]) {
      const [t0, c0] = _PALETA_EDAD[i - 1];
      const [t1, c1] = _PALETA_EDAD[i];
      const u = (t - t0) / (t1 - t0);
      return [lerp(c0[0], c1[0], u), lerp(c0[1], c1[1], u), lerp(c0[2], c1[2], u)];
    }
  }
  return _PALETA_EDAD[_PALETA_EDAD.length - 1][1].slice();
}

function brilloPorEdad(edad) {
  return lerp(1.3, 0.85, constrain(edad, 0, 1));
}

// --- Halo orgánico: un solo degradado radial, sin anillos visibles ---
// Reemplaza a los 5 círculos concentricos (que dejaban bordes duros al crecer la célula).
// El degradado cae como una campana hasta 0 (sin corte), "respira" y su centro de luz se desplaza
// despacio, así el halo no es un círculo perfecto. Conserva la paleta (verde → azul según la edad).
const HALO_ORGANICO = true;
const HALO_RADIO = 4.2;        // radio total del halo, en unidades de "tam"
const HALO_PASOS = 8;          // paradas del degradado (más = más suave)
const _HALO_EXP = Math.exp(-3.0);
const _haloPerfil = [];        // perfil de la campana, calculado una sola vez
for (let i = 0; i <= HALO_PASOS; i++) {
  const t = i / HALO_PASOS;
  _haloPerfil.push((Math.exp(-3.0 * t * t) - _HALO_EXP) / (1 - _HALO_EXP));
}

// alpha = opacidad máxima en el centro (0..255). tiempo en ms (para la respiración).
function dibujarHaloOrganico(x, y, tam, edad, alpha, semilla, tiempo) {
  if (alpha < 0.5 || tam <= 0) return;
  const ctx = drawingContext;
  const R = tam * HALO_RADIO * (1 + 0.06 * Math.sin(tiempo * 0.0011 + semilla));
  const ang = tiempo * 0.00035 + semilla * 1.7;
  const desv = R * 0.16;                                   // el centro de luz se corre un poco y se mueve despacio
  const x0 = x + Math.cos(ang) * desv;
  const y0 = y + Math.sin(ang * 1.3) * desv;
  const c1 = colorPorEdad(edad);                           // centro: color de su edad
  const c2 = colorPorEdad(Math.min(1, edad + 0.12));       // borde: apenas más azul (misma paleta)

  ctx.save();                                              // save/restore: p5 guarda su propio estilo de relleno
  const grad = ctx.createRadialGradient(x0, y0, 0, x, y, R);
  for (let i = 0; i <= HALO_PASOS; i++) {
    const t = i / HALO_PASOS;
    const r = Math.round(c1[0] + (c2[0] - c1[0]) * t);
    const g = Math.round(c1[1] + (c2[1] - c1[1]) * t);
    const b = Math.round(c1[2] + (c2[2] - c1[2]) * t);
    grad.addColorStop(t, "rgba(" + r + "," + g + "," + b + "," + (alpha * _haloPerfil[i] / 255).toFixed(4) + ")");
  }
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function dibujarNucleoSuave(x, y, diam, edad, alpha, semilla = 0) {
  if (alpha < 0.5 || diam <= 0) return;
  const ctx = drawingContext;
  const [r, g, b] = colorPorEdad(edad).map(Math.round);
  const respiracion = 1 + 0.06 * Math.sin(millis() * 0.0018 + semilla);
  const R = (diam * respiracion) / 2;
  ctx.save();
  const grad = ctx.createRadialGradient(x, y, 0, x, y, R);
  grad.addColorStop(0, `rgba(${r},${g},${b},${(alpha / 255).toFixed(4)})`);
  grad.addColorStop(0.35, `rgba(${r},${g},${b},${(alpha * 0.72 / 255).toFixed(4)})`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Destello blanco al sonar, sin borde duro (antes era un disco plano). diam = diámetro, alpha 0..255.
function dibujarDestelloSuave(x, y, diam, alpha) {
  if (alpha < 0.5 || diam <= 0) return;
  const ctx = drawingContext;
  const R = diam / 2;
  ctx.save();
  const grad = ctx.createRadialGradient(x, y, 0, x, y, R);
  grad.addColorStop(0, "rgba(255,255,255," + (alpha / 255).toFixed(4) + ")");
  grad.addColorStop(0.45, "rgba(255,255,255," + (alpha * 0.35 / 255).toFixed(4) + ")");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
