// Envoltura con IO del barrido de domicilios con almacen mal configurado (#416).
// Aqui se LEE Operam y alla (lib/almacen-domicilios.js) se decide.
//
// El listado de clientes trae los domicilios inline pero NO el almacen: el
// `default_location` solo lo da el detalle de cada branch (`GET /branches/:code`).
// Es la misma lectura con la que #330 midio el padron (489 clientes, 531
// domicilios; 9 respondieron 429 en la primera pasada), asi que el barrido es de
// cientos de lecturas y su resultado CRUDO se guarda en memoria -- el GET del
// panel y marcar/desmarcar "asi va bien" recalculan el reporte sobre el sin volver
// a leer Operam. Un reinicio lo pierde y el panel pide barrer otra vez; asume UNA
// sola instancia, como config-store.
//
// Un domicilio que no se pudo leer NO tumba el barrido: su error viaja en
// `errores` y el nucleo lo reporta aparte. Lo que si tumba el barrido es no poder
// leer el padron (o el login): sin padron no hay nada que decir.

import { listarTodosClientes, obtenerBranch, nombresDeAlmacenes } from './operam-client.js';

// Ritmo PROPIO del barrido (#438): una lectura de Operam cada INTERVALO_LECTURAS_MS
// como minimo, contado desde que arranco la anterior -- la que ya tardo mas no
// suma espera. Es el ritmo de los scripts de lote (sync-catalogo,
// rescatar-genericos). NO usa el throttle global de operam-client
// (_setMinInterval): ese frenaria a todo el cotizador mientras barre, y el resto
// de la app sigue sin throttle. Sin ritmo, en produccion las lecturas en rafaga
// dispararon el 429 de Operam para toda la app (2026-09-23).
const INTERVALO_LECTURAS_MS = 1100;
const sleep = (ms) => new Promise(res => setTimeout(res, ms));
const RITMO_DE_FABRICA = Object.freeze({ intervaloMs: INTERVALO_LECTURAS_MS, esperar: sleep, ahora: () => Date.now() });
let ritmo = { ...RITMO_DE_FABRICA };

const LOG = '[almacen-domicilios]';
// Una linea de avance cada tantas lecturas: a 1.1 s por lectura, ~1 por minuto.
const AVISO_CADA = 50;

let ultimo = null;
let enCurso = null;
let avance = null;

function codigosDeBranch(clientes) {
  const codigos = new Set();
  for (const c of clientes || []) {
    for (const b of c?.branches || []) {
      const codigo = String(b?.branch_code ?? '').trim();
      if (codigo) codigos.add(codigo);
    }
  }
  return [...codigos];
}

async function barrer(deps) {
  const io = { listarTodosClientes, obtenerBranch, nombresDeAlmacenes, ...ritmo, ...deps };
  let ultimaLectura = null;
  async function aSuRitmo(leer) {
    if (ultimaLectura !== null) {
      const falta = ultimaLectura + io.intervaloMs - io.ahora();
      if (falta > 0) await io.esperar(falta);
    }
    ultimaLectura = io.ahora();
    return leer();
  }
  const arranque = io.ahora();
  let clientes;
  try {
    clientes = await aSuRitmo(() => io.listarTodosClientes());
  } catch (err) {
    throw new Error('No se pudo leer el padron de Operam: ' + err.message);
  }
  const codigos = codigosDeBranch(clientes);
  avance.total = codigos.length;
  console.log(`${LOG} barrido iniciado: ${codigos.length} domicilios de ${clientes.length} Clientes Operam, una lectura cada ${io.intervaloMs} ms`);
  const branches = {};
  const errores = {};
  for (const codigo of codigos) {
    try {
      const branch = await aSuRitmo(() => io.obtenerBranch(codigo));
      if (branch) branches[codigo] = branch;
    } catch (err) {
      errores[codigo] = err.message;
    }
    avance.revisados++;
    if (avance.revisados % AVISO_CADA === 0 && avance.revisados < codigos.length) {
      console.log(`${LOG} ${avance.revisados}/${codigos.length} domicilios revisados (${Object.keys(errores).length} sin leer)`);
    }
  }
  const almacenes = await aSuRitmo(() => io.nombresDeAlmacenes());
  ultimo = { fecha: new Date().toISOString(), clientes, branches, errores, almacenes };
  avance.estado = 'terminado';
  avance.fin = new Date().toISOString();
  const segundos = Math.round((io.ahora() - arranque) / 1000);
  console.log(`${LOG} barrido terminado en ${segundos} s: ${codigos.length} domicilios revisados, ${Object.keys(errores).length} sin leer`);
}

// Corre en SEGUNDO PLANO (#438): quien lo lanza no espera -- la ruta responde de
// inmediato y el panel consulta avanceBarridoAlmacenes() hasta que termina. Un
// barrido a la vez: el segundo clic recibe el mismo que ya va en vuelo. La promesa
// nunca rechaza: el fallo queda en el avance, no como rechazo suelto.
export function barrerAlmacenesDomicilios(deps = {}) {
  if (!enCurso) {
    avance = { estado: 'en curso', inicio: new Date().toISOString(), revisados: 0, total: null };
    enCurso = barrer(deps)
      .catch(err => {
        avance.estado = 'fallo';
        avance.error = err.message;
        avance.fin = new Date().toISOString();
        console.error(`${LOG} barrido fallo: ${err.message}`);
      })
      .finally(() => { enCurso = null; });
  }
  return enCurso;
}

export function avanceBarridoAlmacenes() {
  return avance ? { ...avance } : null;
}

export function ultimoBarridoAlmacenes() {
  return ultimo;
}

export function _esperarBarrido() {
  return enCurso || Promise.resolve();
}

// Seam de prueba para la costura HTTP, que lanza el barrido sin deps: sin ritmo
// (intervaloMs 0) o con reloj falso. Gemelo de _setBackoff429Base.
export function _setRitmo(parcial) {
  ritmo = { ...ritmo, ...parcial };
}

// Seam de prueba: proceso recien arrancado, sin barrido en memoria.
export function _reiniciar() {
  ultimo = null;
  enCurso = null;
  avance = null;
  ritmo = { ...RITMO_DE_FABRICA };
}
