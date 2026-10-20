// Hash simple y estable de un texto (para que cada MAC tenga siempre la misma nota).
function hashTexto(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

// Edad: de 0 (recién nacida) a 1 (vieja) en este tiempo de vida. Las jóvenes son rápidas y del color inicio;
// las viejas, lentas y del color final. Es tiempo real desde el nacimiento (no depende de los probes).
const ESCALA_EDAD_S = 105; // 30% menos que los 150s originales

// Etiqueta con la MAC: se tipea al nacer y se borra tras unos probes de crecimiento.
const ETIQUETA_FIJA = true;   // true = la MAC queda siempre bajo la célula (y cambia de color con su edad)
                              // false = se borra tras ETIQ_SONDAS probes (el comportamiento anterior)
const ETIQ_SONDAS = 3;        // probes de crecimiento tras los cuales se borra...
const ETIQ_MIN_MS = 4000;     // ...pero nunca antes de este tiempo visible
const ETIQ_MAX_MS = 20000;    // y como mucho se queda este tiempo
const ETIQ_FADE_MS = 1500;    // duración del fundido al borrarse
const ETIQ_LETRA_MS = 70;     // ms entre letra y letra al tipearse

class Entidad {
  constructor(x, y, rssi = -70, mac = "", esEspora = false, anguloInicial = null) {
    this.mac = mac;
    this.x = x;
    this.y = y;
    this.esEspora = esEspora;

    this.seed = random(10000);
    this.tiempoRuido = random(1000);
    this.angulo = anguloInicial !== null ? anguloInicial : random(TWO_PI);
    
    this.tamBase = esEspora ? random(10, 15) : random(16, 24);
    this.brilloSonoro = 0.0; 
    
    this.opacidad = 0.0;          // nace transparente y aparece de a poco
    // Madurez 0..1: 0 = recién nacido, 1 = tamaño máximo (se reproduce).
    // Sube con cada probe (o con cada conexión, en las esporas) y baja muy despacio.
    this.madurez = 0.0;
    this.madurezVisual = 0.0;     // versión suavizada de la madurez: es la que se ve (crece de a poco, sin saltos)
    this.generacion = 0;          // 0 = original; las esporas suben de generación al reproducirse
    this.reproducciones = 0;      // cuántas veces se reprodujo (las esporas tienen un máximo)
    this.llegoAlMax = false;      // se activa al llegar a madurez 1 (no se pierde por el decaimiento)
    this.tUlt = millis();
    this.muerta = false;
    this.nacimiento = millis();
    this.edad = 0;                // 0 = joven ... 1 = vieja (se actualiza en actualizar)
    this.edadColor = 0;
    this.cantidadPeticiones = 0;
    this.pulsoRespiracion = 1;

    // Etiqueta de texto con la MAC completa (solo dispositivos reales; las esporas no tienen).
    this.macOrigen = esEspora ? "" : mac;   // MAC del dispositivo original (las esporas la heredan de su madre)
    this.etiqueta = (!esEspora && mac) ? String(mac).toUpperCase() : "";
    this.etiquetaNace = millis();
    this.etiquetaFin = 0;         // instante en que empezó a borrarse (0 = todavía se ve entera)
    this.etiquetaAlpha = 0;
    this.etiquetaLetras = 0;      // cuántas letras ya se tipearon
    this.ssid = "";               // última red buscada (solo para la consola)
    this.sondasDesdeNacer = 0;    // probes de crecimiento recibidos desde que nació

    // Ciclo de vida: la entidad vive mientras siga recibiendo probes.
    this.ultimoProbe = millis();
    this.forzadaAMorir = false;
    this.desvaneciendo = false;   // true = se está yendo (por inactividad o por tope)
    this.velDesvanecer = 0.008;   // opacidad perdida por frame al desvanecerse

    if (typeof ESCALA_BASE_CONSONANTE !== "undefined" && ESCALA_BASE_CONSONANTE.length > 0) {
      // Cada dispositivo canta siempre la misma nota (derivada de su MAC). Sin MAC: al azar.
      this.frecuencia = mac
        ? ESCALA_BASE_CONSONANTE[hashTexto(mac) % ESCALA_BASE_CONSONANTE.length]
        : random(ESCALA_BASE_CONSONANTE);
    } else {
      this.frecuencia = 146.83;
    }
    
    this.actualizarRSSI(rssi);

    // --- Órbita (modo orbital: la placa es el centro de la constelación) ---
    // El RSSI da distancia, no dirección: el radio sale de la potencia y el ángulo de la MAC
    // (así el mismo dispositivo vuelve siempre a su mismo sector).
    const h = hashTexto(String(mac) + "#orbita");
    this.sentido = (h & 1) ? 1 : -1;                          // sentido de giro propio
    this.fase = ((h >>> 3) % 3600) / 3600 * TWO_PI;          // ángulo actual en su órbita
    this.excentricidad = 0.03 + ((h >>> 13) % 100) / 100 * 0.07;   // cuánto se "estira" su órbita
    this.faseExc = ((h >>> 20) % 628) / 100;
    this.rssiSuave = rssi;                                    // RSSI promediado: evita que tiemble con cada probe
    this.radioFijo = 0.5;                                     // solo las esporas: radio heredado
    this.radioF = this.fraccionObjetivo();                    // 0 = en la placa, 1 = borde de la zona de vida
    this.orbInit = false;

    this.rangoVelRapida = esEspora ? random(1.6, 2.2) : random(1.0, 1.5);
    this.rangoVelLenta = random(0.3, 0.6);
    this.velBase = this.rangoVelRapida;
  }

  // Fracción del radio (0..1) según el RSSI suavizado. Curva sigmoide centrada en -70 dBm:
  // abre el rango común (-60 a -80) para que las células no se amontonen en un solo anillo.
  fraccionObjetivo() {
    const s = 1 / (1 + Math.exp(-(this.rssiSuave + 70) / 9));
    return lerp(0.92, 0.10, s);
  }

  // Una espora nace como "satélite": hereda el sentido y la órbita de su madre, corrida unos grados.
  heredarOrbita(madre) {
    this.sentido = madre.sentido;
    this.fase = madre.fase + random(0.35, 0.9) * (random() < 0.5 ? -1 : 1);
    this.radioFijo = constrain(madre.radioF + random(-0.1, 0.1), 0.08, 0.95);
    this.radioF = madre.radioF;
    this.rssiSuave = madre.rssiSuave;
    this.orbInit = true;     // sale deslizándose desde la madre hasta su lugar en la órbita
  }

  // Movimiento orbital alrededor de la placa (centro de la pantalla).
  orbitar(dt) {
    const objetivo = this.esEspora ? this.radioFijo : this.fraccionObjetivo();
    this.radioF += (objetivo - this.radioF) * (1 - Math.exp(-dt * 0.5));   // el radio cambia lento (~2 s)

    // Las órbitas internas giran más rápido; con la edad, cada célula se aquieta (joven: rápida, vieja: lenta).
    const f = this.radioF;
    const omega = 0.22 * Math.pow(0.5 / (0.12 + f), 1.1) * lerp(1.35, 0.3, this.edad) * params.velGlobal;
    this.fase += this.sentido * omega * dt;

    const wob = 1 + this.excentricidad * Math.sin(2 * this.fase + this.faseExc);
    this.tiempoRuido += 0.004 * params.velGlobal * dt * 60;
    const dx = (noise(this.tiempoRuido + this.seed) - 0.5) * 14;          // un leve bamboleo orgánico
    const dy = (noise(this.tiempoRuido + this.seed + 50) - 0.5) * 14;
    const tx = width * 0.5 + Math.cos(this.fase) * width * 0.477 * f * wob + dx;
    const ty = height * 0.5 + Math.sin(this.fase) * height * 0.445 * f * wob + dy;

    if (!this.orbInit) {
      this.x = tx; this.y = ty; this.orbInit = true;      // al nacer aparece directo en su órbita
    } else {
      const a = 1 - Math.exp(-dt * 3);                    // y al cambiar de modo se desliza suave
      this.x += (tx - this.x) * a;
      this.y += (ty - this.y) * a;
    }
  }

  get maduracion() {
    return constrain(this.madurez, 0, 1);
  }

  // Escala de tamaño: de params.tamNacimiento (recién nacido) a params.tamMaximo (listo para reproducirse).
  get escalaTamano() {
    const nac = (typeof params !== "undefined" && params.tamNacimiento !== undefined) ? params.tamNacimiento : 0.3;
    const maxi = (typeof params !== "undefined" && params.tamMaximo !== undefined) ? params.tamMaximo : 3.5;
    return lerp(nac, maxi, constrain(this.madurezVisual, 0, 1));
  }

  // Ya llegó al máximo Y se ve en su tamaño máximo (así se la ve crecer hasta el final antes de reproducirse).
  get listaParaReproducir() {
    return !this.desvaneciendo && this.llegoAlMax && this.madurezVisual >= 0.97;
  }

  // Le toca reproducirse (la madre sigue viva y suelta células nuevas).
  // Las entidades ligadas a un dispositivo se reproducen siempre; las esporas hasta params.maxGeneraciones.
  puedeReproducirse() {
    if (!this.listaParaReproducir) return false;
    if (!this.esEspora) return true;
    const limite = (typeof params !== "undefined" && params.maxGeneraciones !== undefined) ? params.maxGeneraciones : 2;
    const maxRep = (typeof params !== "undefined" && params.maxReproduccionesEspora !== undefined) ? params.maxReproduccionesEspora : 1;
    return this.generacion < limite && this.reproducciones < maxRep;
  }

  actualizarRSSI(rssi) {
    this.rssi = constrain(rssi, -100, -30);
    this.factorCercania = map(this.rssi, -100, -30, 0.8, 1.7);
  }

  registrarProbe(rssi) {
    this.actualizarRSSI(rssi);
    this.rssiSuave += 0.25 * (rssi - this.rssiSuave);
    this.cantidadPeticiones++;
    const porProbe = (typeof params !== "undefined" && params.crecimientoPorProbe !== undefined) ? params.crecimientoPorProbe : 0.25;
    this.madurez = min(1.0, this.madurez + porProbe);
    if (this.madurez >= 1.0) this.llegoAlMax = true;
    this.brilloSonoro = 1.0;
    this.sondasDesdeNacer++;

    // Un probe nuevo renueva la vida (y frena un desvanecimiento por inactividad).
    this.ultimoProbe = millis();
    if (!this.forzadaAMorir) this.desvaneciendo = false;
  }

  alimentar() {
    if (this.esEspora) {
      const porConexion = (typeof params !== "undefined" && params.crecimientoPorConexion !== undefined) ? params.crecimientoPorConexion : 0.02;
      this.madurez = min(1.0, this.madurez + porConexion);
      if (this.madurez >= 1.0) this.llegoAlMax = true;
      // Las esporas no reciben probes propios: viven mientras se conecten.
      this.sondasDesdeNacer++;   // para ellas, cada conexión cuenta como "probe de crecimiento" de su etiqueta
      this.ultimoProbe = millis();
      if (!this.forzadaAMorir) this.desvaneciendo = false;
    } else {
      // Dispositivos originales (Gen 0): maduración suplementaria por filamentos de conexión
      const porConexionGen0 = (typeof params !== "undefined" && params.crecimientoPorConexionGen0 !== undefined) ? params.crecimientoPorConexionGen0 : 0.005;
      if (porConexionGen0 > 0) {
        this.madurez = min(1.0, this.madurez + porConexionGen0);
        if (this.madurez >= 1.0) this.llegoAlMax = true;
      }
    }
  }

  // Desvanecimiento forzado (por ejemplo, al superar el máximo de entidades).
  morir(vel = 0.03) {
    this.forzadaAMorir = true;
    this.desvaneciendo = true;
    this.velDesvanecer = vel;
  }

  actualizar(ahora) {
    // Tiempo real transcurrido. k = "cuadros equivalentes" (1 a 60 fps): todo lo que antes
    // era por-cuadro se multiplica por k, así la velocidad no depende del framerate.
    const dt = min(0.1, (ahora - this.tUlt) / 1000);
    this.tUlt = ahora;
    const k = dt * 60;

    // --- Etiqueta de MAC: se tipea, se queda unos probes y se borra con un fundido ---
    if (this.etiqueta) {
      const edad = ahora - this.etiquetaNace;
      if (!this.etiquetaFin && !ETIQUETA_FIJA &&
          (edad > ETIQ_MAX_MS || (this.sondasDesdeNacer >= ETIQ_SONDAS && edad > ETIQ_MIN_MS))) {
        this.etiquetaFin = ahora;
      }
      const fade = this.etiquetaFin ? 1 - (ahora - this.etiquetaFin) / ETIQ_FADE_MS : 1;
      if (fade <= 0) {
        this.etiqueta = "";
        this.etiquetaLetras = 0;
        this.etiquetaAlpha = 0;
      } else {
        this.etiquetaAlpha = fade;
        this.etiquetaLetras = min(this.etiqueta.length, floor(edad / ETIQ_LETRA_MS));
      }
    }

    // --- Ciclo de vida ---
    let vidaSeg = (params.vidaEntidad !== undefined ? params.vidaEntidad : 60);
    const genObj = (typeof params !== "undefined" && params.genDisparadora !== undefined ? params.genDisparadora : 2);
    if (this.generacion >= genObj && typeof params !== "undefined" && params.vidaGen2 !== undefined) {
      vidaSeg = params.vidaGen2;
    }
    const vidaMs = vidaSeg * 1000;
    if (!this.desvaneciendo && ahora - this.ultimoProbe > vidaMs) {
      this.desvaneciendo = true;
      if (this.generacion >= genObj) {
        this.forzadaAMorir = true;
        this.velDesvanecer = 0.02; // Desvanecimiento suave
      }
    }
    if (this.desvaneciendo) {
      this.opacidad = max(0, this.opacidad - this.velDesvanecer * k);
      if (this.opacidad <= 0.02) this.muerta = true;
    } else {
      // Aparición suave al nacer (y reaparición si estaba a medio desvanecer).
      this.opacidad = min(1.0, this.opacidad + 0.04 * k);
    }

    this.brilloSonoro *= Math.pow(0.86, k);

    // Decaimiento lento de la madurez, en tiempo real.
    const decae = (params.decaimientoMadurez !== undefined ? params.decaimientoMadurez : 0.004);
    this.madurez = max(0, this.madurez - decae * dt);

    // La madurez que se dibuja persigue a la real con una transición suave (~1 s).
    this.madurezVisual += (this.madurez - this.madurezVisual) * (1 - Math.exp(-dt * 3));

    // La edad (tiempo desde que nació, con transición suave) define la velocidad y el color.
    const escalaEdadS = (typeof params !== "undefined" && params.tiempoLifecycle !== undefined)
      ? params.tiempoLifecycle
      : ESCALA_EDAD_S;
    const tEdad = constrain((ahora - this.nacimiento) / (escalaEdadS * 1000), 0, 1);
    this.edad = tEdad * tEdad * (3 - 2 * tEdad);
    const peticionesMax = Math.max(3, Math.round(escalaEdadS * 0.133));
    const edadPorPeticiones = constrain(
      (this.cantidadPeticiones - 1) / (peticionesMax - 1), 0, 1
    );
    this.edadColor = max(this.edad, edadPorPeticiones);
    this.pulsoRespiracion = 1 + 0.05 * sin(ahora * 0.00125 + this.seed);

    // Las jóvenes son rápidas y las viejas lentas (movimiento libre).
    this.velBase = lerp(this.rangoVelRapida, this.rangoVelLenta, this.edad);

    if (params.modoOrbital || colapsoActivo) {
      this.orbitar(dt);
    } else {
      this.tiempoRuido += 0.004 * params.velGlobal * k;
      const variacionAngular = map(noise(this.tiempoRuido + this.seed), 0, 1, -0.06, 0.06);
      this.angulo += variacionAngular * k;

      // Zona de vida elíptica (aprovecha todo el ancho de la pantalla, no un círculo de radio height*0.4).
      const centroX = width * 0.5;
      const centroY = height * 0.5;
      const ex = (this.x - centroX) / (width * 0.45);
      const ey = (this.y - centroY) / (height * 0.42);
      if (ex * ex + ey * ey > 1) {
        const anguloAlCentro = atan2(centroY - this.y, centroX - this.x);
        // Giro por el camino más corto (antes el lerp podía dar la vuelta larga y hacerla girar en círculos).
        const dif = atan2(sin(anguloAlCentro - this.angulo), cos(anguloAlCentro - this.angulo));
        this.angulo += dif * (1 - Math.pow(1 - 0.02, k));
      }

      const velocidadActual = this.velBase * params.velGlobal * k;
      this.x += cos(this.angulo) * velocidadActual;
      this.y += sin(this.angulo) * velocidadActual;

      if (this.x < 50) { this.x = 50; this.angulo = random(-PI/2, PI/2); }
      if (this.x > width - 50) { this.x = width - 50; this.angulo = random(PI/2, PI*1.5); }
      if (this.y < 50) { this.y = 50; this.angulo = random(0, PI); }
      if (this.y > height - 50) { this.y = height - 50; this.angulo = random(-PI, 0); }
    }
  }

  // Se dibuja en una pasada aparte, después de los filamentos, para que ninguna línea tache el texto.
  dibujarEtiqueta() {
    if (!this.etiqueta) return;
    const tam = this.tamBase * params.tamanoBase * this.factorCercania * this.escalaTamano;
    const esVig = typeof colapsoActivo !== "undefined" && colapsoActivo;
    const [cr, cg, cb] = colorPorEdad(this.edadColor, esVig);
    dibujarEtiquetaMac(
      this.etiqueta, this.etiquetaLetras,
      this.x, this.y + max(tam * 1.1, tam * 0.9) + 12,
      this.etiquetaAlpha * min(1.0, this.opacidad) * params.brilloParticulas,
      cr, cg, cb, 1
    );
  }

  dibujar() {
    const esVig = typeof colapsoActivo !== "undefined" && colapsoActivo;
    const x = this.x;
    const y = this.y;
    const edadDibujo = this.edadColor;
    const tam = this.tamBase * params.tamanoBase * this.factorCercania * this.escalaTamano;
    const tamRespiracion = tam * this.pulsoRespiracion;
    const intensidadRespiracion = 0.82 + (this.pulsoRespiracion - 0.95) * 3.6;
    const brillo = this.brilloSonoro;
    const maduracion = constrain(this.madurezVisual, 0, 1);
    
    // Color según la EDAD: verde vivo (joven) → azul sereno (vieja). En vigilancia: rojo.
    const brilloEdad = brilloPorEdad(edadDibujo);

    noStroke();

    // Halo difuso y orgánico (un solo degradado, sin anillos): respira y su luz se desplaza despacio.
    const potenciaHalo = map(maduracion, 0, 1, 14, 34);
    const aHalo = potenciaHalo * this.opacidad * params.brilloParticulas * 0.38 * brilloEdad;
    dibujarHaloOrganico(x, y, tamRespiracion, edadDibujo, aHalo * 7.0 * intensidadRespiracion, this.seed, millis(), esVig);

    const opacidad = min(1.0, this.opacidad);
    const tamNucleo = max(2.8, tamRespiracion * map(brillo, 0, 1, 0.55, 0.9));
    dibujarNucleoSuave(
      x, y, tamNucleo, edadDibujo,
      210 * opacidad * params.brilloParticulas * intensidadRespiracion,
      this.seed,
      esVig
    );

    if (!esVig && brillo > 0.05 && opacidad > 0) {
      const alphaNucleo = constrain(
        brillo * 220 * opacidad * params.brilloParticulas, 0, 255
      );
      dibujarDestelloSuave(x, y, tamNucleo * 3.0, alphaNucleo);
    }

  }
}