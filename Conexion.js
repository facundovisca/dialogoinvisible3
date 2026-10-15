class Conexion {
  constructor(a, b, distancia) {
    this.a = a;
    this.b = b;
    this.distancia = distancia; // distancia al nacer (solo informativa; el dibujo usa la distancia en vivo)
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
    const base = map(dist, 0, distRef, 180, 20, true); // constrain: no se va a negativo si se estiran
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
      (colorA[2] + colorB[2]) / 2,
    ];
  }

  // Filamento ondulado. k = factor de escala de pantalla (proyector / notebook).
  // Usa vertex() (no curveVertex) para que la línea llegue hasta las dos células.
  static trazar(
    ax,
    ay,
    bx,
    by,
    seed,
    k = 1,
    desplazamiento = 0,
    amplitud = 10,
  ) {
    noFill();
    const perp = atan2(by - ay, bx - ax) + HALF_PI;
    const pasos = 10;
    beginShape();
    for (let i = 0; i <= pasos; i++) {
      const t = i / pasos;
      const x = lerp(ax, bx, t);
      const y = lerp(ay, by, t);
      const n = noise((x / k) * 0.01, (y / k) * 0.01, frameCount * 0.01 + seed);
      const offset =
        desplazamiento * sin(t * PI) +
        map(n, 0, 1, -amplitud, amplitud) * k * sin(t * PI);
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
    const distRef =
      typeof params !== "undefined" && params.distConexion
        ? params.distConexion
        : 160;
    const d = dist(this.a.x, this.a.y, this.b.x, this.b.y);
    const [r, g, b] = Conexion.colorConexion(
      this.a.edadColor,
      this.b.edadColor,
    );
    const alpha = Conexion.alpha(
      d,
      distRef,
      this.vida,
      params.opacidadLineas,
      this.brilloFlash,
    );
    Conexion.dibujarFilamentos(
      this.a.x,
      this.a.y,
      this.b.x,
      this.b.y,
      this.seed,
      1,
      [r, g, b],
      alpha,
      Conexion.grosor(this.brilloFlash),
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
  if (tieneEspaciado) ctx.letterSpacing = 1.5 * k + "px";
  const ancho = textWidth(texto);
  // color: el de la edad de la célula, apenas aclarado (se conserva el tono para que se lea la edad)
  fill(lerp(r, 255, 0.2), lerp(g, 255, 0.2), lerp(b, 255, 0.2), 175 * alpha01);
  text(texto.substring(0, letras), x - ancho / 2, y);
  if (tieneEspaciado) ctx.letterSpacing = "0px";
  pop();
}

function rgbToHex(r, g, b) {
  const h =
    (1 << 24) + (Math.round(r) << 16) + (Math.round(g) << 8) + Math.round(b);
  return "#" + h.toString(16).slice(1);
}

function hexToRgb(hex) {
  let c = String(hex).replace("#", "");
  if (c.length === 3) {
    c = c
      .split("")
      .map((x) => x + x)
      .join("");
  }
  const num = parseInt(c, 16);
  if (isNaN(num)) return [128, 128, 128];
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

// ============================================================================
// COLORES INICIALES DEL LIFECYCLE (Podés cambiar estos valores HEX aquí):
// ============================================================================
const COLOR_HEX_INICIO = "#0AFF33"; // Color al nacer / joven (0%)
const COLOR_HEX_FINAL = "#FBFF00"; // Color al envejecer / longeva (100%)
// ============================================================================

const PALETA_EDAD_DEFAULT = [
  [0.0, hexToRgb(COLOR_HEX_INICIO)],
  [1.0, hexToRgb(COLOR_HEX_FINAL)],
];

let _PALETA_EDAD = PALETA_EDAD_DEFAULT.map((p) => [p[0], [...p[1]]]);

function definirColorEdad(indice, r, g, b) {
  if (_PALETA_EDAD[indice]) {
    _PALETA_EDAD[indice][1] = [Math.round(r), Math.round(g), Math.round(b)];
  }
}

function asignarPaletaEdad(paleta) {
  if (Array.isArray(paleta) && paleta.length >= 2) {
    _PALETA_EDAD = paleta.map((p) => [
      p[0],
      [Math.round(p[1][0]), Math.round(p[1][1]), Math.round(p[1][2])],
    ]);
  }
}

const COLOR_ROJO_VIGILANCIA = [255, 60, 52]; // Rojo vigilancia
const COLOR_ROJO_VIGILANCIA_BORDE = [230, 35, 45]; // Borde del halo en vigilancia

function colorPorEdad(
  edad,
  esVigilancia = typeof colapsoActivo !== "undefined" && colapsoActivo,
) {
  if (esVigilancia) {
    return COLOR_ROJO_VIGILANCIA.slice();
  }
  const t = constrain(edad, 0, 1);
  if (_PALETA_EDAD.length === 2) {
    const c0 = _PALETA_EDAD[0][1];
    const c1 = _PALETA_EDAD[1][1];
    return [
      lerp(c0[0], c1[0], t),
      lerp(c0[1], c1[1], t),
      lerp(c0[2], c1[2], t),
    ];
  }
  for (let i = 1; i < _PALETA_EDAD.length; i++) {
    if (t <= _PALETA_EDAD[i][0]) {
      const [t0, c0] = _PALETA_EDAD[i - 1];
      const [t1, c1] = _PALETA_EDAD[i];
      const u = (t - t0) / (t1 - t0);
      return [
        lerp(c0[0], c1[0], u),
        lerp(c0[1], c1[1], u),
        lerp(c0[2], c1[2], u),
      ];
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
const HALO_RADIO = 4.2; // radio total del halo, en unidades de "tam"
const HALO_PASOS = 8; // paradas del degradado (más = más suave)
const _HALO_EXP = Math.exp(-3.0);
const _haloPerfil = []; // perfil de la campana, calculado una sola vez
for (let i = 0; i <= HALO_PASOS; i++) {
  const t = i / HALO_PASOS;
  _haloPerfil.push((Math.exp(-3.0 * t * t) - _HALO_EXP) / (1 - _HALO_EXP));
}

// alpha = opacidad máxima en el centro (0..255). tiempo en ms (para la respiración).
function dibujarHaloOrganico(
  x,
  y,
  tam,
  edad,
  alpha,
  semilla,
  tiempo,
  esVigilancia = typeof colapsoActivo !== "undefined" && colapsoActivo,
) {
  if (alpha < 0.5 || tam <= 0) return;
  const ctx = drawingContext;
  const R = tam * HALO_RADIO * (1 + 0.06 * Math.sin(tiempo * 0.0011 + semilla));
  const ang = tiempo * 0.00035 + semilla * 1.7;
  const desv = R * 0.16; // el centro de luz se corre un poco y se mueve despacio
  const x0 = x + Math.cos(ang) * desv;
  const y0 = y + Math.sin(ang * 1.3) * desv;
  const c1 = esVigilancia ? COLOR_ROJO_VIGILANCIA : colorPorEdad(edad, false);
  const c2 = esVigilancia
    ? COLOR_ROJO_VIGILANCIA_BORDE
    : colorPorEdad(Math.min(1, edad + 0.12), false); // borde: apenas más azul (misma paleta)

  ctx.save(); // save/restore: p5 guarda su propio estilo de relleno
  const grad = ctx.createRadialGradient(x0, y0, 0, x, y, R);
  for (let i = 0; i <= HALO_PASOS; i++) {
    const t = i / HALO_PASOS;
    const r = Math.round(c1[0] + (c2[0] - c1[0]) * t);
    const g = Math.round(c1[1] + (c2[1] - c1[1]) * t);
    const b = Math.round(c1[2] + (c2[2] - c1[2]) * t);
    grad.addColorStop(
      t,
      "rgba(" +
        r +
        "," +
        g +
        "," +
        b +
        "," +
        ((alpha * _haloPerfil[i]) / 255).toFixed(4) +
        ")",
    );
  }
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function dibujarNucleoSuave(
  x,
  y,
  diam,
  edad,
  alpha,
  semilla = 0,
  esVigilancia = typeof colapsoActivo !== "undefined" && colapsoActivo,
) {
  if (alpha < 0.5 || diam <= 0) return;
  const ctx = drawingContext;
  const [r, g, b] = (
    esVigilancia ? COLOR_ROJO_VIGILANCIA : colorPorEdad(edad, false)
  ).map(Math.round);
  const respiracion = 1 + 0.06 * Math.sin(millis() * 0.0018 + semilla);
  const R = (diam * respiracion) / 2;
  ctx.save();
  const grad = ctx.createRadialGradient(x, y, 0, x, y, R);
  grad.addColorStop(0, `rgba(${r},${g},${b},${(alpha / 255).toFixed(4)})`);
  grad.addColorStop(
    0.35,
    `rgba(${r},${g},${b},${((alpha * 0.72) / 255).toFixed(4)})`,
  );
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
  grad.addColorStop(
    0.45,
    "rgba(255,255,255," + ((alpha * 0.35) / 255).toFixed(4) + ")",
  );
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function dibujarSeguimientoCelula(
  x,
  y,
  tam,
  alpha,
  mac = "",
  alphaMac = 0,
  dbm = "",
  alphaDbm = 0,
  k = 1,
) {
  if (alpha <= 0 && alphaMac <= 0 && alphaDbm <= 0) return;
  push();
  if (alpha > 0) {
    noFill();
    stroke(255, 58, 48, alpha);
    strokeWeight(max(1, 1.1 * k));
    const mitad = max(12 * k, tam * 1.45);
    const tramo = max(4 * k, mitad * 0.32);
    const x0 = x - mitad;
    const x1 = x + mitad;
    const y0 = y - mitad;
    const y1 = y + mitad;
    line(x0, y0, x0 + tramo, y0);
    line(x0, y0, x0, y0 + tramo);
    line(x1, y0, x1 - tramo, y0);
    line(x1, y0, x1, y0 + tramo);
    line(x0, y1, x0 + tramo, y1);
    line(x0, y1, x0, y1 - tramo);
    line(x1, y1, x1 - tramo, y1);
    line(x1, y1, x1, y1 - tramo);
  }
  const labelY = y + max(13 * k, tam * 1.9);
  if (mac && alphaMac > 0) {
    textFont("monospace");
    textSize(9 * k);
    textAlign(CENTER, TOP);
    noStroke();
    fill(255, 118, 105, 185 * alphaMac);
    text(mac, x, labelY);
  }
  if (dbm && alphaDbm > 0) {
    textFont("monospace");
    textSize(8 * k);
    textAlign(CENTER, TOP);
    noStroke();
    fill(255, 156, 145, 170 * alphaDbm);
    text(dbm, x, labelY + 12 * k);
  }
  pop();
}

function aplicarEfectoGlitch(ruidoFuerte = false, k = 1) {
  const ctx = drawingContext;
  if (!ctx || !ctx.canvas) return;
  const w = width;
  const h = height;

  const multIntensidad =
    typeof params !== "undefined" && params.glitchIntensidad !== undefined
      ? params.glitchIntensidad
      : 1.0;
  const multScanlines =
    typeof params !== "undefined" && params.glitchScanlines !== undefined
      ? params.glitchScanlines
      : 1.0;

  if (multIntensidad <= 0.01 && multScanlines <= 0.01) return;

  push();

  if (ruidoFuerte) {
    // --- IMPACTO FUERTE (acoplado al pulso de ruido blanco del audio) ---
    // 1. Rebanadas horizontales desplazadas (Opción A)
    if (multIntensidad > 0.01) {
      const cantFranjas = floor(random(6, 12) * multIntensidad);
      for (let i = 0; i < cantFranjas; i++) {
        const sh = floor(random(8, 45) * k);
        const sy = floor(random(0, max(1, h - sh)));
        const dx = floor(random(-60, 60) * k * multIntensidad);
        if (abs(dx) > 3) {
          ctx.drawImage(ctx.canvas, 0, sy, w, sh, dx, sy, w, sh);
        }
      }
    }

    // 2. Desfase de color / aberración en 1 o 2 bandas
    if (multScanlines > 0.01 && random() > 1 - 0.8 * min(1, multScanlines)) {
      const tintY = random(0, h - 30);
      const tintH = random(12, 50) * k;
      noStroke();
      if (random() > 0.5) {
        fill(255, 45, 60, random(40, 85) * multScanlines); // Rojo vigilancia
      } else {
        fill(45, 215, 255, random(35, 75) * multScanlines); // Cian desync
      }
      rect(0, tintY, w, tintH);
    }

    // 3. Scanlines marcadas (Opción C)
    if (multScanlines > 0.01) {
      const cantLineas = floor(random(8, 20) * multScanlines);
      strokeWeight(max(1, 1.2 * k));
      for (let i = 0; i < cantLineas; i++) {
        const ly = random(h);
        stroke(255, constrain(random(70, 180) * multScanlines, 0, 255));
        line(0, ly, w, ly);
      }
    }

    // 4. Bloques de estática digital
    if (multIntensidad > 0.01) {
      noStroke();
      const cantBloques = floor(random(4, 9) * multIntensidad);
      for (let i = 0; i < cantBloques; i++) {
        const bx = random(w * 0.05, w * 0.9);
        const by = random(h * 0.05, h * 0.9);
        const bw = random(20, 130) * k;
        const bh = random(3, 14) * k;
        fill(255, constrain(random(50, 140) * multIntensidad, 0, 255));
        rect(bx, by, bw, bh);
      }
    }
  } else {
    // --- ESTADO BASE DE COLAPSO (glitch sutil e intermitente) ---
    if (multIntensidad > 0.01 && random() < 0.25 * multIntensidad) {
      const sh = floor(random(4, 18) * k);
      const sy = floor(random(0, max(1, h - sh)));
      const dx = floor(random(-12, 12) * k * multIntensidad);
      if (abs(dx) > 2) {
        ctx.drawImage(ctx.canvas, 0, sy, w, sh, dx, sy, w, sh);
      }
    }

    if (multScanlines > 0.01 && random() < 0.35 * multScanlines) {
      strokeWeight(1);
      const cantLineas = floor(random(1, 4) * multScanlines);
      for (let i = 0; i < cantLineas; i++) {
        stroke(255, constrain(random(18, 48) * multScanlines, 0, 255));
        const ly = random(h);
        line(0, ly, w, ly);
      }
    }
  }

  pop();
}
