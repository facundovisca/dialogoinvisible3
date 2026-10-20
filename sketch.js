const canalProyector = new BroadcastChannel("instalacion_dialogo");
let ultimoTick = 0; // para escalar la lógica por tiempo real (no por cuadro)

let MOCK_MODE = true;
let ultimoMockAuto = 0;

const params = {
	distConexion: 100,
	probConexion: 0.043,
	velGlobal: 0.5,
	tamanoBase: 1.2,
	tamNacimiento: 0.3, // escala del recién nacido (menor = más chico)
	tamMaximo: 1.0, // escala al llegar al máximo, justo antes de reproducirse
	opacidadLineas: 1,
	brilloParticulas: 1.4,
	mostrarParticulasEnNotebook: true,
	rssiMinimo: -95,
	entradaPct: 100, // % de probes que se aceptan (bajalo si entran demasiados)
	cooldownMac: 800,
	crecimientoPorProbe: 0.12, // cuánta madurez (0..1) suma cada probe: 0.12 = se divide en ~9-10 probes
	crecimientoPorConexion: 0.015, // madurez que suma cada conexión (solo esporas: 0.02 = ~50 conexiones para madurar)
	crecimientoPorConexionGen0: 0.0004, // madurez que suma cada conexión a los dispositivos base (Gen 0)
	decaimientoMadurez: 0.004, // madurez que se pierde por segundo (muy lento)
	maxGeneraciones: 2, // hasta qué generación de esporas pueden reproducirse
	maxReproduccionesEspora: 1, // cuántas veces puede reproducirse cada espora (los dispositivos reales, siempre)
	minHijas: 2, // al reproducirse, la madre suelta entre minHijas y maxHijas células nuevas
	maxHijas: 4,
	madurezTrasReproducir: 0.0, // madurez de la madre después de reproducirse (0 = vuelve a empezar)
	vidaEntidad: 60, // segundos sin probe antes de que la entidad se desvanezca
	maxEntidades: 200, // tope duro: si se supera, se desvanecen las más viejas
	modoOrbital: true, // true = la placa es el centro y las células orbitan según su RSSI ([O] alterna)
	maxConexiones: 250, // tope de conexiones vivas a la vez (evita miles de líneas y mensajes al proyector)
	intervaloMock: 900,
	volDrone: 0.5,
	volGrave: 0.5,
	volProbes: 1.0,
	volConexiones: 1.0,
	pulsosEntidades: true,
	volRuidoVigilancia: 1.0,
	volTensionVigilancia: 1.0,
	freqRuidoVigilancia: 1.0,
	colorLetrasVigilancia: "#ff3c34",
	nombresSimuladosVigilancia: true, // true = en vigilancia la MAC se transforma en nombre simulado/red con efecto glitch
	pctNombresSimulados: 35, // % de dispositivos <PROBE SEARCH> que revelan nombre simulado en vigilancia
	tiempoLifecycle: 105, // segundos para completar el ciclo de color (30% menos que 150s)
	cicloAutomatico: true, // true = ciclo automático gobernado por células de 2da gen
	umbralGen2: 3, // células de 2da gen requeridas para disparar la vigilancia (evita gatillo sensible)
	genDisparadora: 2, // generación mínima que activa la vigilancia (2 = nieta)
	vidaGen2: 20, // duración de vida (s) de células de 2da gen
	umbralEdadColorAntigua: 0.75, // valor de edadColor (0..1) para considerar a una célula antigua
	pctPurga: 100, // % de células antiguas que se purgan al salir de vigilancia (0..100)
	enfriamientoVigilancia: 6, // segundos de espera tras volver a normal antes de otra vigilancia (ahora más corto porque la purga previene re-disparos)
	duracionVigilancia: 60, // tiempo máximo de seguridad (s) de vigilancia por si ninguna muere
};

let probesRecibidos = 0,
	probesAceptados = 0,
	ultimoConteoEntrada = 0;
const MAX_LINEAS_SERIAL_POR_FRAME = 200;

const ultimosProbesPorMac = new Map();
const mapEntidades = new Map();
const conexiones = [];

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
const DURACION_PAUSA_ANTES_GLITCH_MS = 250;
const DURACION_GLITCH_VIGILANCIA_MS = 750;
const DURACION_REVELADO_DBBM_MS = 420;
const PULSOS_BLINK = [
	{ inicio: 0, duracion: 54, alpha: 235 },
	{ inicio: 108, duracion: 46, alpha: 255 },
	{ inicio: 510, duracion: 58, alpha: 215 },
	{ inicio: 666, duracion: 48, alpha: 250 },
	{ inicio: 1248, duracion: 55, alpha: 230 },
];

// --- Controlador de estados del ciclo automático ---
// Estados: "NORMAL" -> (célula de gen 2 activa) -> "VIGILANCIA" -> (muerte gen 2 / timeout) -> "ENFRIAMIENTO" -> "NORMAL"
let estadoCiclo = "NORMAL"; // "NORMAL" | "VIGILANCIA" | "ENFRIAMIENTO"
let finEnfriamiento = 0;
let centinelaId = "";

const MAX_ETIQUETAS = 40; // etiquetas de MAC visibles a la vez (si se pasa, las de las células más viejas se borran primero)

// --- Serial robusto: reconexión automática + aviso de silencio ---
let serialEstado = "sim"; // "sim" | "conectado" | "sin datos" | "desconectado" | "pausado"
let ultimoDatoSerial = 0;
let ultimoIntentoSerial = 0;
let serialPausadoManual = false; // true si se cerró a mano con [C]: no reconectar
const SERIAL_REINTENTO_MS = 5000;
const SERIAL_SILENCIO_MS = 120000; // 2 min sin ningún dato = aviso

// --- Una sola conexión viva por par de células (se renueva en vez de duplicarse) ---
const conexionesPorPar = new Map();
const DENSIDAD_REF = 25; // conexiones simultáneas que equivalen a "densidad máxima" (mueve drones y filtro)

// --- Envío al proyector ---
let ultimoSync = 0;

// --- Grabación de probes a CSV (tecla [G]) para calibrar con datos reales ---
const CSV_MAX_FILAS = 200000;
let grabandoCSV = false;
let filasCSV = [];
let inicioGrabacion = 0;
const macsVistas = new Set();
const macsAleatorias = new Set();
const CONSOLA_MUESTRA_SSID = true; // false = la consola no muestra el nombre de la red buscada

// Temporizadores pendientes de la obra (arpegios, destellos): se cancelan al reiniciar.
const timeoutsObra = new Set();
function programar(fn, ms) {
	const id = setTimeout(() => {
		timeoutsObra.delete(id);
		fn();
	}, ms);
	timeoutsObra.add(id);
}

// REINICIAR OBRA: vuelve todo a cero, como si recién se encendiera la instalación.
function reiniciarObra() {
	estadoCiclo = "NORMAL";
	finEnfriamiento = 0;
	centinelaId = "";
	vaciarObra();
}

// Vacía células, conexiones, cola de probes y sonido. La usan reiniciarObra y la disolución del ciclo.
function vaciarObra() {
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
		} catch (e) {
			/* puerto cerrado: no hay nada que descartar */
		}
	}
	// ...reiniciar el simulador (espera un intervalo completo antes del primer probe)...
	ultimoMockAuto = millis();
	// ...y vaciar el registro de probes que se ve en pantalla.
	limpiarLineasConsola();

	// Arpegios y destellos que estaban por ocurrir
	timeoutsObra.forEach(clearTimeout);
	timeoutsObra.clear();

	// Sonido: límites de tiempo y rotación de voces de vuelta a cero
	if (typeof reiniciarSonido === "function") reiniciarSonido();

	canalProyector.postMessage({ tipo: "LIMPIAR_TODO" });
}

function setup() {
	createCanvas(windowWidth, windowHeight);

	canalProyector.onmessage = (event) => {
		const data = event.data;
		if (data.tipo === "COMANDO_TECLA") {
			ejecutarComandoTeclado(data.tecla);
		}
	};

	iniciarUI(params, {
		onReiniciar: reiniciarObra,
	});

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
	background(0);
	actualizarLogicaGlobal();

	if (params.mostrarParticulasEnNotebook) {
		for (const [mac, e] of mapEntidades.entries()) e.dibujar();
		if (!colapsoActivo) {
			for (const c of conexiones) c.dibujar();
			for (const e of mapEntidades.values()) e.dibujarEtiqueta();
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
					1,
				);
			}
		}
	}

	dibujarHUD(params);
}

function actualizarLogicaGlobal() {
	const ahora = millis();
	parpadeoNegro = colapsoActivo ? calcularParpadeoNegro(ahora) : 0;
	// kt = cuadros equivalentes desde la última llamada (1 a 60 fps). Todo lo "por cuadro" se escala con kt.
	const kt =
		ultimoTick === 0 ? 1 : constrain((ahora - ultimoTick) / (1000 / 60), 0, 6);
	ultimoTick = ahora;

	// Contador de entrada: cuántos probes llegan y cuántos se aceptan por segundo.
	if (ultimoConteoEntrada === 0) ultimoConteoEntrada = ahora;
	const transcurrido = ahora - ultimoConteoEntrada;
	if (transcurrido >= 1000) {
		const seg = transcurrido / 1000;
		actualizarInfoEntrada(probesRecibidos / seg, probesAceptados / seg);
		probesRecibidos = 0;
		probesAceptados = 0;
		ultimoConteoEntrada = ahora;
	}

	if (!MOCK_MODE) {
		gestionarSerial(ahora);
		if (port && serialEstado !== "desconectado" && serialEstado !== "pausado") {
			// Antes: una línea por frame. Con probes reales el buffer crecía y aparecía latencia.
			let leidas = 0;
			while (
				port.availableBytes() > 0 &&
				leidas < MAX_LINEAS_SERIAL_POR_FRAME
			) {
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
			if (e.puedeReproducirse())
				paraReproducir.push(e); // se reproduce fuera del bucle (no tocar el Map mientras se recorre)
			else if (e.esEspora) e.morir(0.012); // última generación: al madurar se desvanece (no se reproduce)
		}
	}
	for (const madre of paraReproducir) reproducirCelula(madre);
	actualizarCicloVigilancia(ahora);
	actualizarVigilancia(ahora);

	// Tope duro: si hay demasiadas, se desvanecen las de probe más viejo.
	// Se cuentan solo las que no están ya yéndose, para no marcar de más mientras se desvanecen.
	const vivas = Array.from(mapEntidades.values()).filter(
		(e) => !e.desvaneciendo,
	);
	if (vivas.length > params.maxEntidades) {
		// Primero se van las esporas (de mayor generación, y las más viejas). Los dispositivos reales, al final:
		// las esporas renuevan su "último probe" con cada conexión y antes hacían que se sacrificara al dispositivo real.
		vivas.sort(
			(x, y) =>
				Number(y.esEspora) - Number(x.esEspora) ||
				y.generacion - x.generacion ||
				x.ultimoProbe - y.ultimoProbe,
		);
		const sobrantes = vivas.length - params.maxEntidades;
		for (let i = 0; i < sobrantes; i++) vivas[i].morir();
	}

	const entidadesActivas = Array.from(mapEntidades.values());

	for (let i = conexiones.length - 1; i >= 0; i--) {
		conexiones[i].actualizar(kt); // decae el flash siempre, se dibuje o no en el notebook
		conexiones[i].vida -= 0.015 * kt;
		if (conexiones[i].vida <= 0.02) {
			const c = conexiones[i];
			if (conexionesPorPar.get(c.clave) === c) conexionesPorPar.delete(c.clave);
			conexiones.splice(i, 1);
		}
	}

	// La probabilidad es "por cuadro a 60 fps": se ajusta al tiempo real transcurrido.
	const pCon = 1 - (1 - params.probConexion) ** kt;
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
				if (
					existente &&
					!(
						(existente.a === a && existente.b === b) ||
						(existente.a === b && existente.b === a)
					)
				) {
					existente = null; // quedó de una célula anterior con la misma MAC: se reemplaza por una nueva
				}
				if (existente) {
					existente.vida = 1.0;
					existente.destellar(); // el destello de la línea no depende del sonido
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
						{ freq: b.frecuencia, nx: b.x / width, mac: b.mac, entidad: b },
					];

					let sumaDist = d;
					let cantNodos = 2;

					for (let k = 0; k < entidadesActivas.length; k++) {
						if (k === i || k === j) continue;
						const c = entidadesActivas[k];
						const dAC = dist(a.x, a.y, c.x, c.y);
						const dBC = dist(b.x, b.y, c.x, c.y);

						if (dAC < params.distConexion && dBC < params.distConexion) {
							clusterVoces.push({
								freq: c.frecuencia,
								nx: c.x / width,
								mac: c.mac,
								entidad: c,
							});
							if (typeof c.alimentar === "function") c.alimentar();
							sumaDist += (dAC + dBC) * 0.5;
							cantNodos++;
							if (cantNodos >= 4) break;
						}
					}

					if (typeof dispararAcordeGrupo === "function") {
						const ocurrio = dispararAcordeGrupo(
							clusterVoces,
							sumaDist / cantNodos,
						);
						acordeDisparadoEsteFrame = true;
						if (ocurrio) {
							// Destellos independientes del volumen: cada célula se ilumina en su turno del arpegio.
							clusterVoces.forEach((v, idx) => {
								if (idx === 0) v.entidad.brilloSonoro = 1.0;
								else
									programar(() => {
										v.entidad.brilloSonoro = 1.0;
									}, idx * 35);
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
			etiqueta: e.etiqueta, // MAC completa ("" si no tiene o ya se borró)
			etiquetaLetras: e.etiquetaLetras,
			etiquetaAlpha: e.etiquetaAlpha,
		});
	}

	const payloadConexiones = [];
	for (const c of conexiones) {
		payloadConexiones.push({
			nax: c.a.x / width,
			nay: c.a.y / height,
			nbx: c.b.x / width,
			nby: c.b.y / height,
			vida: c.vida,
			brilloFlash: c.brilloFlash,
			edadA: c.a.edadColor,
			edadB: c.b.edadColor,
			seed: c.seed,
		});
	}

	// Con poca carga se envía a 60 Hz. Con muchísimos elementos se baja a ~30 Hz para no saturar el canal.
	const pesado = payloadEntidades.length + payloadConexiones.length > 300;
	const enviar = !pesado || ahora - ultimoSync >= 33;
	if (enviar) ultimoSync = ahora;
	if (enviar)
		canalProyector.postMessage({
			tipo: "SYNC_FRAME",
			anchoOrigen: width, // el proyector escala tamaños y distancias según esta resolución
			altoOrigen: height,
			entidades: payloadEntidades,
			conexiones: payloadConexiones,
			colapso: {
				activo: colapsoActivo,
				ruidoActivo:
					typeof estaActivoRuidoColapso === "function"
						? estaActivoRuidoColapso()
						: false,
				parpadeoNegro: parpadeoNegro,
				seguimientos: seguimientosActuales.map((seguimiento) => ({
					nx: seguimiento.x / width,
					ny: seguimiento.y / height,
					tam: seguimiento.tam,
					alpha: seguimiento.alpha,
					alphaMac: seguimiento.alphaMac,
					alphaDbm: seguimiento.alphaDbm,
					mac: seguimiento.mac,
					dbm: seguimiento.dbm,
				})),
			},
			params: {
				distConexion: params.distConexion,
				opacidadLineas: params.opacidadLineas,
				tamanoBase: params.tamanoBase,
				brilloParticulas: params.brilloParticulas,
				paletaEdad: _PALETA_EDAD,
				colorLetrasVigilancia: params.colorLetrasVigilancia,
				nombresSimuladosVigilancia: params.nombresSimuladosVigilancia,
				pctNombresSimulados: params.pctNombresSimulados,
			},
		});

	const densidad = constrain(conexiones.length / DENSIDAD_REF, 0, 1);
	const dispositivosActivos = Array.from(mapEntidades.values()).filter(
		(e) => !e.esEspora && !e.desvaneciendo,
	).length;
	actualizarCampo(
		densidad,
		dispositivosActivos,
		colapsoActivo,
		parpadeoNegro,
		ahora - colapsoInicio,
	);
	actualizarConsola(ahora);
}

let contadorEsporas = 0;

// Elige `cantidad` notas distintas entre sí y distintas de las de `excluir`.
function elegirNotasNuevas(cantidad, excluir) {
	const escala =
		typeof ESCALA_BASE_CONSONANTE !== "undefined" &&
		ESCALA_BASE_CONSONANTE.length > 0
			? ESCALA_BASE_CONSONANTE
			: [146.83];
	const pool = escala.filter((f) => !excluir.includes(f));
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
	for (const otra of mapEntidades.values())
		if (otra.etiqueta && !otra.etiquetaFin) conTexto.push(otra);
	const sobran = conTexto.length + nuevas - MAX_ETIQUETAS;
	if (sobran <= 0) return;
	conTexto.sort((x, y) => x.etiquetaNace - y.etiquetaNace);
	for (let i = 0; i < sobran && i < conTexto.length; i++)
		conTexto[i].etiquetaFin = ahora;
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
		const hija = new Entidad(
			madre.x + cos(ang) * 18,
			madre.y + sin(ang) * 18,
			madre.rssi,
			id,
			true,
			ang,
		);

		hija.generacion = madre.generacion + 1;
		hija.heredarOrbita(madre);
		// La hija lleva la MAC del dispositivo original: el nombre se hereda de generación en generación.
		hija.macOrigen = madre.macOrigen || madre.mac;
		hija.etiqueta = String(hija.macOrigen).toUpperCase();
		hija.etiquetaNace = millis();
		hija.frecuencia = notas[i];
		hija.brilloSonoro = 1.0;
		hija.ssid = madre.ssid || "";
		hija.aliasVigilancia = madre.aliasVigilancia || "";
		mapEntidades.set(id, hija);

		// Cada hija suena con su nota propia, escalonadas como un pequeño arpegio.
		if (typeof dispararPulsoCrecimiento === "function") {
			const sonar = () => {
				dispararPulsoCrecimiento(
					0.5,
					hija.rssi,
					hija.frecuencia,
					hija.x / width,
					hija,
				);
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

function esSsidLegible(str) {
	if (!str || str === "BROADCAST") return false;
	if (str.includes("\uFFFD")) return false;
	let tieneAlfanumerico = false;
	for (let i = 0; i < str.length; i++) {
		const c = str.charCodeAt(i);
		// Códigos de control ASCII y extendidos no imprimibles
		if ((c >= 0 && c <= 31) || (c >= 127 && c <= 159)) return false;
		if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)) {
			tieneAlfanumerico = true;
		}
	}
	return tieneAlfanumerico;
}

function procesarMensajeSerial(str) {
	const partes = str.split(",");
	if (partes.length >= 3 && partes[0] === "PROBE") {
		const mac = partes[1].trim();
		const rssi = parseInt(partes[2].trim(), 10);
		if (!mac || isNaN(rssi)) return; // línea corrupta: antes NaN pasaba el filtro de RSSI
		let ssid = partes.length >= 4 ? partes.slice(3).join(",").trim() : ""; // un SSID puede traer comas
		// Filtrar basura binaria, bytes corruptos o caracteres de control no imprimibles
		if (ssid && !esSsidLegible(ssid)) {
			ssid = "";
		}

		probesRecibidos++;

		if (rssi < params.rssiMinimo) {
			registrarProbeCSV(mac, rssi, ssid, "descartado_rssi");
			return;
		}

		// Reducción de entrada: acepta solo el porcentaje elegido de los probes que pasan el filtro.
		// Va antes del cooldown para que un probe descartado no bloquee a la MAC.
		if (random(100) >= params.entradaPct) {
			registrarProbeCSV(mac, rssi, ssid, "descartado_entrada");
			return;
		}

		const ahora = millis();
		if (ultimosProbesPorMac.has(mac)) {
			if (ahora - ultimosProbesPorMac.get(mac) < params.cooldownMac) {
				registrarProbeCSV(mac, rssi, ssid, "descartado_cooldown");
				return;
			}
		}
		ultimosProbesPorMac.set(mac, ahora);
		probesAceptados++;
		registrarProbeCSV(mac, rssi, ssid, "aceptado");

		if (mapEntidades.has(mac)) {
			const existente = mapEntidades.get(mac);
			existente.registrarProbe(rssi);
			existente.ssid = ssid;
			if (ssid && ssid !== "BROADCAST") {
				existente.aliasVigilancia = ssid;
			}

			if (existente.puedeReproducirse()) {
				reproducirCelula(existente);
			} else {
				if (typeof dispararPulsoCrecimiento === "function") {
					dispararPulsoCrecimiento(
						existente.maduracion,
						rssi,
						existente.frecuencia,
						existente.x / width,
						existente,
					);
				}
			}
		} else {
			const x = random(width);
			const y = random(height);
			const nuevaEntidad = new Entidad(x, y, rssi, mac);
			nuevaEntidad.cantidadPeticiones = 1;
			liberarEtiquetas(1, ahora); // toda célula real nace CON su MAC (si hace falta, se borra la etiqueta más vieja)
			nuevaEntidad.ssid = ssid;
			nuevaEntidad.aliasVigilancia = asignarIdentidadVigilancia(mac, ssid);
			mapEntidades.set(mac, nuevaEntidad);

			if (typeof dispararPulsoCrecimiento === "function") {
				dispararPulsoCrecimiento(
					0.0,
					rssi,
					nuevaEntidad.frecuencia,
					x / width,
					nuevaEntidad,
				);
			}
		}
	}
}

const DISPOSITIVOS_SALA = [
	{
		mac: "DC:2C:6E:AA:BB:CC",
		ssids: ["iPhone de Emiliano", "BROADCAST"],
		tipo: "permanente",
	},
	{
		mac: "A4:C3:F0:8A:11:42",
		ssids: ["Lab_Artes", "UNA_Alumnos", "BROADCAST"],
		tipo: "permanente",
	},
	{
		mac: "38:F9:D3:9B:4C:E1",
		ssids: ["Fibertel-WiFi-601", "BROADCAST"],
		tipo: "permanente",
	},
	{
		mac: "B0:4E:26:77:01:A9",
		ssids: ["iPhone_Santi", "BROADCAST"],
		tipo: "permanente",
	},
	{
		mac: "68:DB:CA:41:2E:8F",
		ssids: ["TeleCentro-WiFi-2.4", "BROADCAST"],
		tipo: "permanente",
	},
	{
		mac: "FC:E9:98:A2:33:55",
		ssids: ["Personal-Flow-88", "BROADCAST"],
		tipo: "permanente",
	},
	{
		mac: "14:2D:27:E5:60:81",
		ssids: ["BA_WiFi_Gratis", "BROADCAST"],
		tipo: "permanente",
	},
	{
		mac: "84:D4:7E:11:B2:9C",
		ssids: ["Galaxy-A54", "BROADCAST"],
		tipo: "permanente",
	},
	{
		mac: "AC:BC:32:8D:E0:41",
		ssids: ["Claro-Red-412", "BROADCAST"],
		tipo: "permanente",
	},
	{
		mac: "58:CB:52:19:D4:F0",
		ssids: ["iPad_Taller", "BROADCAST"],
		tipo: "permanente",
	},
	{
		mac: "D4:61:9D:3A:82:13",
		ssids: ["Movistar_Fibra_7B", "BROADCAST"],
		tipo: "permanente",
	},
	{
		mac: "2C:F0:5D:81:AA:99",
		ssids: ["iPhone_Gaby", "BROADCAST"],
		tipo: "permanente",
	},
	{
		mac: "70:85:C2:5E:10:3B",
		ssids: ["Motorola_Edge", "BROADCAST"],
		tipo: "permanente",
	},
	{
		mac: "52:54:00:12:34:56",
		ssids: ["ThinkPad_T480", "BROADCAST"],
		tipo: "permanente",
	},
	{
		mac: "00:1A:2B:3C:4D:5E",
		ssids: ["MacBook_Pro_14", "BROADCAST"],
		tipo: "permanente",
	},
	{
		mac: "3C:22:FB:99:11:22",
		ssids: ["Galaxy_Tab_S8", "BROADCAST"],
		tipo: "permanente",
	},
	{
		mac: "80:2A:A8:44:55:66",
		ssids: ["Apple_Watch_S7", "BROADCAST"],
		tipo: "permanente",
	},
	{
		mac: "44:65:0D:77:88:99",
		ssids: ["Pixel_7_Pro", "BROADCAST"],
		tipo: "permanente",
	},
	{
		mac: "9C:8E:99:33:22:11",
		ssids: ["iPad_Air_5", "BROADCAST"],
		tipo: "permanente",
	},
	{
		mac: "94:E6:F7:19:D4:6C",
		ssids: ["BROADCAST", "MiFibra-104"],
		tipo: "medio",
	},
	{
		mac: "18:65:90:3A:FB:27",
		ssids: ["Redmi_Note_12", "BROADCAST"],
		tipo: "medio",
	},
	{
		mac: "D8:12:65:4E:91:02",
		ssids: ["Fibertel-WiFi-204", "BROADCAST"],
		tipo: "medio",
	},
	{ mac: "50:32:75:A8:1F:B4", ssids: ["BROADCAST"], tipo: "medio" },
	{
		mac: "E4:5F:01:B9:33:7C",
		ssids: ["iPhone_Turista", "BROADCAST"],
		tipo: "medio",
	},
	{
		mac: "88:66:5A:02:44:CD",
		ssids: ["TeleCentro-WiFi-5G", "BROADCAST"],
		tipo: "medio",
	},
	{
		mac: "00:E0:4C:90:7E:11",
		ssids: ["BA_WiFi_Gratis", "BROADCAST"],
		tipo: "medio",
	},
	{
		mac: "C0:EE:FB:41:88:22",
		ssids: ["Galaxy_S23_Ultra", "BROADCAST"],
		tipo: "medio",
	},
	{ mac: "40:4E:36:20:99:A1", ssids: ["BROADCAST"], tipo: "medio" },
	{
		mac: "34:80:B3:7C:15:E8",
		ssids: ["DIRECTV_Net_2.4", "BROADCAST"],
		tipo: "medio",
	},
	{ mac: "24:4B:FE:12:87:65", ssids: ["Moto_G82", "BROADCAST"], tipo: "medio" },
	{
		mac: "74:AC:B9:66:77:88",
		ssids: ["Redmi_Note_10", "BROADCAST"],
		tipo: "medio",
	},
	{ mac: "AC:87:A3:44:11:00", ssids: ["BROADCAST"], tipo: "medio" },
	{
		mac: "10:94:BB:22:33:44",
		ssids: ["iPhone_11", "BROADCAST"],
		tipo: "medio",
	},
	{
		mac: "B8:78:26:99:88:77",
		ssids: ["Fibertel_WiFi", "BROADCAST"],
		tipo: "medio",
	},
	{ mac: "E0:D4:E8:55:66:77", ssids: ["BROADCAST"], tipo: "medio" },
	{
		mac: "64:16:66:33:44:55",
		ssids: ["Galaxy_A14", "BROADCAST"],
		tipo: "medio",
	},
	{ mac: "90:78:41:11:22:33", ssids: ["BROADCAST"], tipo: "medio" },
	{ mac: "F8:1A:67:8B:20:44", ssids: ["BROADCAST"], tipo: "paso" },
	{
		mac: "A0:C5:89:12:34:56",
		ssids: ["Uber_Driver_WiFi", "BROADCAST"],
		tipo: "paso",
	},
	{ mac: "60:01:94:AA:BB:CC", ssids: ["BROADCAST"], tipo: "paso" },
	{ mac: "78:28:CA:DD:EE:11", ssids: ["iPhone", "BROADCAST"], tipo: "paso" },
	{ mac: "28:6A:B8:33:22:11", ssids: ["BROADCAST"], tipo: "paso" },
	{
		mac: "BC:D1:77:44:55:66",
		ssids: ["TeleCentro-440", "BROADCAST"],
		tipo: "paso",
	},
	{
		mac: "48:2C:A0:77:88:99",
		ssids: ["Galaxy-J7-Prime", "BROADCAST"],
		tipo: "paso",
	},
	{ mac: "90:9A:4A:10:20:30", ssids: ["BROADCAST"], tipo: "paso" },
	{ mac: "1C:56:FE:44:33:22", ssids: ["BROADCAST"], tipo: "paso" },
	{ mac: "A8:96:75:55:44:33", ssids: ["BROADCAST"], tipo: "paso" },
	{ mac: "54:E4:3A:66:77:88", ssids: ["BROADCAST"], tipo: "paso" },
	{ mac: "C8:3A:35:11:00:99", ssids: ["BROADCAST"], tipo: "paso" },
	{ mac: "D0:03:DF:22:33:44", ssids: ["BROADCAST"], tipo: "paso" },
	{ mac: "4C:EB:BD:77:88:99", ssids: ["BROADCAST"], tipo: "paso" },
	{ mac: "7C:04:D0:88:99:00", ssids: ["BROADCAST"], tipo: "paso" },
	{ mac: "8C:85:90:99:00:11", ssids: ["BROADCAST"], tipo: "paso" },
	{ mac: "30:07:4D:11:22:33", ssids: ["BROADCAST"], tipo: "paso" },
];

let _catalogoSimuladoCache = null;

function obtenerCatalogoSimulado() {
	if (_catalogoSimuladoCache && _catalogoSimuladoCache.length > 0) {
		return _catalogoSimuladoCache;
	}
	const lista = [];
	for (const d of DISPOSITIVOS_SALA) {
		if (Array.isArray(d.ssids)) {
			for (const s of d.ssids) {
				const limpio = String(s).trim();
				if (limpio && limpio !== "BROADCAST" && !lista.includes(limpio)) {
					lista.push(limpio);
				}
			}
		}
	}
	if (!lista.includes("iPhone de Emiliano")) {
		lista.push("iPhone de Emiliano");
	}
	_catalogoSimuladoCache = lista;
	return _catalogoSimuladoCache;
}

function asignarIdentidadVigilancia(mac, ssid) {
	if (ssid && ssid !== "BROADCAST") {
		return ssid;
	}
	const catalogo = obtenerCatalogoSimulado();
	if (!catalogo || catalogo.length === 0) return String(mac || "").toUpperCase();
	const strMac = String(mac || "").toUpperCase();
	const h = typeof hashTexto === "function" ? hashTexto(strMac) : Math.abs(strMac.split("").reduce((a, b) => ((a << 5) - a) + b.charCodeAt(0), 0));
	return catalogo[h % catalogo.length];
}

function calcularTextoGlitch(textoOrigen, textoDestino, progreso) {
	if (progreso <= 0) return textoOrigen;
	if (progreso >= 1) return textoDestino;

	const caracteresGlitch = "0123456789ABCDEF!@#$%&*<>/-_[]";
	const lenOrigen = textoOrigen.length;
	const lenDestino = textoDestino.length;
	const longitudActual = Math.round(lenOrigen + (lenDestino - lenOrigen) * progreso);
	const caracteresFijos = Math.floor(progreso * lenDestino);

	let resultado = "";
	for (let i = 0; i < longitudActual; i++) {
		if (i < caracteresFijos) {
			resultado += textoDestino[i];
		} else if (i === caracteresFijos) {
			resultado += caracteresGlitch[Math.floor(Math.random() * caracteresGlitch.length)];
		} else {
			const r = Math.random();
			if (r < 0.65) {
				resultado += caracteresGlitch[Math.floor(Math.random() * caracteresGlitch.length)];
			} else if (r < 0.85 && i < lenOrigen) {
				resultado += textoOrigen[i];
			} else if (i < lenDestino) {
				resultado += textoDestino[i];
			} else {
				resultado += caracteresGlitch[Math.floor(Math.random() * caracteresGlitch.length)];
			}
		}
	}
	return resultado;
}

function generarProbeSimulado() {
	const r = random();
	const candidatos =
		r < 0.6
			? DISPOSITIVOS_SALA.filter((d) => d.tipo === "permanente")
			: r < 0.85
				? DISPOSITIVOS_SALA.filter((d) => d.tipo === "medio")
				: DISPOSITIVOS_SALA.filter((d) => d.tipo === "paso");
	const disp = random(candidatos);
	const ssidRandom = random(disp.ssids);
	const rssiRandom =
		disp.tipo === "permanente"
			? floor(random(-72, -38))
			: disp.tipo === "medio"
				? floor(random(-82, -50))
				: floor(random(-92, -70));
	procesarMensajeSerial(`PROBE,${disp.mac},${rssiRandom},${ssidRandom}`);
}

function ejecutarComandoTeclado(k) {
	if (k === "c" || k === "C") {
		desbloquearAudio();
		if (!MOCK_MODE && port) {
			if (!port.opened()) {
				serialPausadoManual = false;
				port.open(115200);
			} else {
				serialPausadoManual = true;
				port.close();
			}
		}
	}
	if (k === "m" || k === "M") {
		MOCK_MODE = !MOCK_MODE;
		reiniciarObra(); // cada modo arranca la obra de cero (no se mezclan células SIM con REAL)
		if (!MOCK_MODE) {
			serialPausadoManual = false;
			if (!port) port = createSerial();
			const usedPorts = usedSerialPorts();
			if (usedPorts.length > 0) port.open(usedPorts[0], 115200);
		} else {
			if (port && port.opened()) port.close();
		}
	}
	if (k === "h" || k === "H") alternarVisibilidadUI();
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
	if (k === "t" || k === "T") alternarVisibilidadLog();
	if (k === "n" || k === "N") generarProbeSimulado();
	if (k === "r" || k === "R") reiniciarObra();
}

function alternarColapso() {
	if (colapsoActivo) {
		retornarANormalConPurga(millis());
	} else {
		aplicarEstadoColapso(true);
		estadoCiclo = "VIGILANCIA";
	}
}

// Censo demográfico en tiempo real
function contarDemografia() {
	let totalActivas = 0;
	let dispositivosReales = 0;
	let antiguasCount = 0;
	const gen2Activas = [];
	const genMin =
		params.genDisparadora !== undefined ? params.genDisparadora : 2;
	const umbralColor =
		params.umbralEdadColorAntigua !== undefined
			? params.umbralEdadColorAntigua
			: 0.75;

	for (const [id, e] of mapEntidades.entries()) {
		if (e.muerta) continue;
		if (!e.desvaneciendo) {
			totalActivas++;
			if (!e.esEspora) dispositivosReales++;
			if (e.edadColor >= umbralColor) antiguasCount++;
			if (e.generacion >= genMin) gen2Activas.push({ id, e });
		}
	}

	return {
		totalActivas,
		dispositivosReales,
		antiguasCount,
		gen2Activas,
		genMin,
		umbralColor,
	};
}

// Purga activa al salir de vigilancia (Opción 1: Poda de esporas + renacimiento desde Gen 0):
// 1. Elimina TODAS las esporas (Gen 1 y Gen 2) para dejar solo los dispositivos base (Gen 0).
// 2. Elimina una porción de las células originales más antiguas.
function ejecutarPurgaActiva() {
	const umbral =
		params.umbralEdadColorAntigua !== undefined
			? params.umbralEdadColorAntigua
			: 0.75;
	const pct = constrain(
		(params.pctPurga !== undefined ? params.pctPurga : 50) / 100,
		0,
		1,
	);

	// 1. ELIMINAR TODAS LAS ESPORAS (GEN 1 y GEN 2)
	// Limpia el linaje derivado para que el canvas quede con los dispositivos reales.
	// Es imposible un re-disparo inmediato: primero Gen 0 debe parir Gen 1, y Gen 1 debe crecer y parir Gen 2.
	for (const e of mapEntidades.values()) {
		if (!e.muerta && e.esEspora) {
			e.morir(0.02); // Desvanecimiento suave
		}
	}

	// 2. PURGAR UNA PORCIÓN DE LAS CÉLULAS ORIGINALES (GEN 0) MÁS ANTIGUAS
	if (pct > 0) {
		const candidatas = [];
		const resto = [];

		for (const e of mapEntidades.values()) {
			if (!e.muerta && !e.desvaneciendo && !e.esEspora) {
				if (e.edadColor >= umbral) {
					candidatas.push(e);
				} else {
					resto.push(e);
				}
			}
		}

		if (candidatas.length > 0) {
			candidatas.sort((a, b) => b.edadColor - a.edadColor);
			const aEliminar = Math.ceil(candidatas.length * pct);
			for (let i = 0; i < aEliminar; i++) {
				candidatas[i].morir(0.015);
			}
		} else if (resto.length > 0) {
			resto.sort((a, b) => b.edadColor - a.edadColor);
			const adultas = resto.filter((e) => e.edadColor >= 0.4);
			const base = adultas.length > 0 ? adultas : resto;
			const aEliminar = Math.min(
				base.length,
				Math.max(1, Math.ceil(base.length * (pct * 0.3))),
			);
			for (let i = 0; i < aEliminar; i++) {
				base[i].morir(0.015);
			}
		}
	}
}

// Retorno suave al modo normal con purga activa y período de enfriamiento
function retornarANormalConPurga(ahora) {
	aplicarEstadoColapso(false);
	ejecutarPurgaActiva();
	const segEnf =
		params.enfriamientoVigilancia !== undefined
			? params.enfriamientoVigilancia
			: 6;
	finEnfriamiento = ahora + segEnf * 1000;
	estadoCiclo = "ENFRIAMIENTO";
	centinelaId = "";
}

// CICLO AUTOMÁTICO: gobernado por linaje de 2da generación y purga activa
function actualizarCicloVigilancia(ahora) {
	const demo = contarDemografia();
	const umbralG2 = params.umbralGen2 !== undefined ? params.umbralGen2 : 2;

	// Tiempo restante de vida de la célula de 2da generación (para la UI)
	let tiempoGen2 = 0;
	if (demo.gen2Activas.length > 0) {
		const primera = demo.gen2Activas[0].e;
		const vidaSeg = params.vidaGen2 !== undefined ? params.vidaGen2 : 20;
		const transcurrido = (ahora - primera.ultimoProbe) / 1000;
		tiempoGen2 = max(0, Math.ceil(vidaSeg - transcurrido));
	}

	// Manejo de la fase de enfriamiento
	let enfriamientoRestante = 0;
	if (estadoCiclo === "ENFRIAMIENTO") {
		if (ahora >= finEnfriamiento) {
			estadoCiclo = "NORMAL";
		} else {
			enfriamientoRestante = max(
				0,
				Math.ceil((finEnfriamiento - ahora) / 1000),
			);
		}
	}

	// Notificar estado demográfico y métricas a la UI
	if (typeof actualizarInfoCiclo === "function") {
		actualizarInfoCiclo({
			estado: colapsoActivo ? "VIGILANCIA" : estadoCiclo,
			genMin: demo.genMin,
			gen2Count: demo.gen2Activas.length,
			umbralGen2: umbralG2,
			tiempoGen2: tiempoGen2,
			umbralColor: demo.umbralColor,
			antiguasCount: demo.antiguasCount,
			totalActivas: demo.totalActivas,
			dispositivosReales: demo.dispositivosReales,
			enfriamientoRestante: enfriamientoRestante,
		});
	}

	if (!params.cicloAutomatico) {
		if (colapsoActivo) estadoCiclo = "VIGILANCIA";
		else if (estadoCiclo === "VIGILANCIA") estadoCiclo = "NORMAL";
		return;
	}

	// Transiciones de estado automáticas con umbral de población Gen 2
	if (estadoCiclo === "NORMAL") {
		if (demo.gen2Activas.length >= umbralG2) {
			// Disparador: se alcanzó el umbral configurado de células Gen 2
			centinelaId = demo.gen2Activas[0].id;
			aplicarEstadoColapso(true);
			estadoCiclo = "VIGILANCIA";
		}
	} else if (estadoCiclo === "VIGILANCIA") {
		// Requisito de retorno al modo normal:
		// 1. Mueren las células de 2da generación (el centinela murió o no quedan gen 2 activas)
		// 2. O se supera el tiempo máximo de seguridad (duracionVigilancia)
		const timeoutSeg =
			params.duracionVigilancia !== undefined ? params.duracionVigilancia : 60;
		const expiroPorTiempo = ahora - colapsoInicio >= timeoutSeg * 1000;

		let centinelaMurio = false;
		if (centinelaId) {
			const cent = mapEntidades.get(centinelaId);
			if (!cent || cent.muerta || cent.desvaneciendo) {
				centinelaMurio = true;
			}
		}
		const murioGen2 = centinelaMurio || demo.gen2Activas.length === 0;

		if (murioGen2 || expiroPorTiempo) {
			retornarANormalConPurga(ahora);
		}
	}
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

	const activas = Array.from(mapEntidades.entries()).filter(
		([, e]) => !e.muerta && e.opacidad > 0.1,
	);
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
			1,
		);
		const alphaDbm = constrain(
			(transcurrido - DURACION_ADQUISICION_MS - DURACION_REVELADO_MAC_MS) /
				DURACION_REVELADO_DBBM_MS,
			0,
			1,
		);
		const semilla = semillaSeguimiento(id);
		const radioBusqueda = max(
			8,
			min(18, objetivo.tamBase * objetivo.factorCercania * 0.8),
		);
		const faseBusqueda = max(0, transcurrido) * 0.007 + semilla;
		const radioActual =
			radioBusqueda *
			(1 - suave) *
			(0.82 + 0.18 * Math.sin(faseBusqueda * 1.7));
		const derivaX = Math.cos(faseBusqueda) * radioActual;
		const derivaY = Math.sin(faseBusqueda * 0.9) * radioActual * 0.72;
		const rssi = Number.isFinite(objetivo.rssiSuave)
			? objetivo.rssiSuave
			: Number.isFinite(objetivo.rssi)
				? objetivo.rssi
				: -72;
		const variacionDb = Math.sin(ahora * 0.0031 + semilla * 2.3) * 1.2;
		const tam =
			objetivo.tamBase *
			params.tamanoBase *
			objetivo.factorCercania *
			objetivo.escalaTamano *
			objetivo.pulsoRespiracion;
		const macBase = String(objetivo.macOrigen || objetivo.mac || "").toUpperCase();
		let textoVigilancia = macBase;

		if (params.nombresSimuladosVigilancia) {
			const tieneSsidReal = Boolean(objetivo.ssid && objetivo.ssid !== "BROADCAST");
			const pctSim = params.pctNombresSimulados !== undefined ? params.pctNombresSimulados : 35;
			const esCandidatoSimulado = !tieneSsidReal && (typeof objetivo.debeRevelarNombreSimulado === "function"
				? objetivo.debeRevelarNombreSimulado(pctSim)
				: true);
			const debeMostrarNombre = tieneSsidReal || esCandidatoSimulado;

			if (debeMostrarNombre) {
				if (!objetivo.aliasVigilancia) {
					objetivo.aliasVigilancia = asignarIdentidadVigilancia(macBase, objetivo.ssid);
				}
				const textoDestino = objetivo.aliasVigilancia || macBase;
				const tInicioGlitch =
					DURACION_ADQUISICION_MS +
					DURACION_REVELADO_MAC_MS +
					DURACION_PAUSA_ANTES_GLITCH_MS;
				if (transcurrido >= tInicioGlitch) {
					const progresoGlitch = constrain(
						(transcurrido - tInicioGlitch) / DURACION_GLITCH_VIGILANCIA_MS,
						0,
						1,
					);
					textoVigilancia = calcularTextoGlitch(macBase, textoDestino, progresoGlitch);
				}
			}
		}

		seguimientosActuales.push({
			x: objetivo.x + derivaX,
			y: objetivo.y + derivaY,
			tam,
			alpha: transcurrido < 0 ? 0 : 24 + 30 * suave,
			alphaMac,
			alphaDbm,
			mac: alphaMac > 0 ? textoVigilancia : "",
			dbm:
				alphaDbm > 0
					? `${Math.round(constrain(rssi + variacionDb, -100, -30))} dBm`
					: "",
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
	for (let i = 0; i < id.length; i++)
		hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
	return hash;
}

function calcularParpadeoNegro(ahora) {
	const t = (ahora - colapsoInicio) % PERIODO_COLAPSO_MS;
	const pulso = PULSOS_BLINK.find(
		(p) => t >= p.inicio && t < p.inicio + p.duracion,
	);
	return pulso ? pulso.alpha : 0;
}

// Los navegadores solo permiten iniciar el audio tras un gesto real (clic o tecla en ESTA ventana).
// Las teclas que llegan desde el proyector no cuentan. Para la muestra, abrir Chrome con:
//   --autoplay-policy=no-user-gesture-required
// Mantiene el puerto serial vivo: si se cae, reintenta solo (sin gesto, el puerto ya fue autorizado).
function gestionarSerial(ahora) {
	if (MOCK_MODE) {
		serialEstado = "sim";
		return;
	}
	if (!port) {
		try {
			port = createSerial();
		} catch (e) {}
		return;
	}
	let abierto = false;
	try {
		abierto = port.opened();
	} catch (e) {}
	if (!abierto) {
		ultimoDatoSerial = 0;
		if (serialPausadoManual) {
			serialEstado = "pausado";
			return;
		}
		serialEstado = "desconectado";
		if (ahora - ultimoIntentoSerial > SERIAL_REINTENTO_MS) {
			ultimoIntentoSerial = ahora;
			try {
				const usados = usedSerialPorts();
				if (usados.length > 0) port.open(usados[0], 115200);
			} catch (e) {
				/* se reintenta en unos segundos */
			}
		}
		return;
	}
	if (ultimoDatoSerial === 0) ultimoDatoSerial = ahora;
	serialEstado =
		ahora - ultimoDatoSerial > SERIAL_SILENCIO_MS ? "sin datos" : "conectado";
}

function desbloquearAudio() {
	if (!params.pulsosEntidades) return;
	if (getAudioContext().state !== "running") userStartAudio();
}

function mousePressed() {
	desbloquearAudio();
}
function windowResized() {
	resizeCanvas(windowWidth, windowHeight);
}
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
	if (filasCSV.length > CSV_MAX_FILAS) {
		alternarGrabacion();
		return;
	} // tope: guarda y corta
	const aleatoria = esMacAleatoria(mac);
	macsVistas.add(mac);
	if (aleatoria) macsAleatorias.add(mac);
	const ssidCsv = '"' + String(ssid).replace(/"/g, '""') + '"';
	filasCSV.push(
		`${new Date().toISOString()},${Math.round(millis() - inicioGrabacion)},${mac},${aleatoria ? 1 : 0},${rssi},${ssidCsv},${estado}`,
	);
}
