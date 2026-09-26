// Envoltura con IO del padron de contactos de domicilio de entrega (#105). Aqui se
// LEE Operam y alla (lib/contactos-domicilio.js) se decide que fila es de quien.
//
// `GET /api/v3/admin/contact_list` no filtra (#397): leer los contactos de UN
// domicilio es leer la lista completa (~2100 filas, ~21 paginas de 100). Por eso se
// cachea en memoria con TTL de 1 h, como el padron de lib/indice-telefonos.js, y
// quien consulta NUNCA espera a Operam: con la cache fria o vencida responde lo que
// hay (null, "no se sabe", la primera vez) y el refresco corre en segundo plano. Asi un cache frio
// o un Operam caido degradan en silencio al paso Envio de siempre.
//
// Se carga al arrancar (#397, decision de Adrian del 2026-09-25; server.js lo
// dispara unos segundos despues de los otros warms) y se relee tras escribir un
// domicilio de entrega (alta-cliente.js), con una relectura mas si ya habia un
// barrido en vuelo. Asume UNA sola instancia, como config-store.

import { leerPaginaContactos, PAGINA_CONTACTOS } from './operam-client.js';
import { indiceContactosDomicilio } from './contactos-domicilio.js';

// Ritmo PROPIO (#438): una pagina cada INTERVALO_LECTURAS_MS como minimo, contado
// desde que arranco la anterior, y nunca dos a la vez. NO usa el throttle global de
// operam-client (_setMinInterval), que frenaria a todo el cotizador mientras barre;
// en rafaga las lecturas dispararon el 429 de Operam para toda la app (2026-09-23).
const INTERVALO_LECTURAS_MS = 1100;
const TTL_MS = 60 * 60 * 1000;
// Tras un fallo no se reintenta en cada consulta: seria un barrido de ~21 lecturas
// por cada vendedor que abre el paso Envio mientras Operam responde 429.
const RESPIRO_TRAS_FALLO_MS = 5 * 60 * 1000;
// Tope de paginas por si el `total` declarado mintiera (hoy son 21).
const MAX_PAGINAS = 100;
const LOG = '[contactos-domicilio]';

const sleep = (ms) => new Promise(res => setTimeout(res, ms));
const IO_DE_FABRICA = Object.freeze({
  leerPaginaContactos,
  intervaloMs: INTERVALO_LECTURAS_MS,
  esperar: sleep,
  ahora: () => Date.now(),
});
let io = { ...IO_DE_FABRICA };

let cache = { indice: null, ts: 0 };
let ultimoFallo = null;
let enCurso = null;
// Ritmo entre barridos tambien: la relectura tras escribir arranca justo al terminar
// el barrido anterior y su primera pagina respeta el intervalo desde la ultima.
let ultimaLectura = null;
// Escrituras de domicilio pedidas vs. las que ya cubrio un barrido exitoso que
// arranco despues de pedirse. Mientras falte alguna, la consulta relee pasado el
// respiro aunque el padron no haya vencido.
let escriturasPedidas = 0;
let escriturasLeidas = 0;
let relecturaAgendada = null;

async function barrer() {
  const cubre = escriturasPedidas;
  const aSuRitmo = async (leer) => {
    if (ultimaLectura !== null) {
      const falta = ultimaLectura + io.intervaloMs - io.ahora();
      if (falta > 0) await io.esperar(falta);
    }
    ultimaLectura = io.ahora();
    return leer();
  };
  let filas = [];
  let total = null;
  let skip = 0;
  for (let vuelta = 0; vuelta < MAX_PAGINAS; vuelta++) {
    const pagina = await aSuRitmo(() => io.leerPaginaContactos(skip));
    const recibidas = pagina?.filas || [];
    filas = filas.concat(recibidas);
    if (pagina?.total != null) total = pagina.total;
    if (recibidas.length === 0) break;
    if (total != null && filas.length >= total) break;
    if (total == null && recibidas.length < PAGINA_CONTACTOS) break;
    skip += recibidas.length;
  }
  // Freno "sin evidencia" (como #231): Operam tiene ~2100 contactos, asi que una
  // lectura sin ninguna fila es un sobre distinto al esperado o una respuesta vacia,
  // no un padron. Armarlo haria afirmar que ningun domicilio tiene contactos.
  if (filas.length === 0) throw new Error('contact_list no devolvio ninguna fila');
  cache = { indice: indiceContactosDomicilio(filas), ts: io.ahora() };
  ultimoFallo = null;
  escriturasLeidas = Math.max(escriturasLeidas, cubre);
}

function enRespiro() {
  return ultimoFallo !== null && io.ahora() - ultimoFallo < RESPIRO_TRAS_FALLO_MS;
}

// Un refresco a la vez: quien llega mientras hay uno en vuelo recibe el mismo (el
// warm, el refresco por TTL). La promesa nunca rechaza; un fallo conserva el padron
// anterior y queda en el log.
export function refrescarContactosDomicilio() {
  if (!enCurso) {
    enCurso = barrer()
      .catch(err => {
        ultimoFallo = io.ahora();
        console.warn(`${LOG} no se pudo leer contact_list de Operam: ${err.message}`);
      })
      .finally(() => { enCurso = null; });
  }
  return enCurso;
}

// Tras escribir un domicilio de entrega (#397): el barrido en vuelo pudo haber leido
// ya la pagina de ese domicilio, asi que no basta con reusarlo. Se agenda UNA
// relectura que arranca cuando el en vuelo termina; las peticiones que lleguen
// mientras tanto reciben esa misma. Si el en vuelo fallo, o el anterior fallo hace
// menos de 5 min, la relectura no sale en rafaga: queda pendiente para la primera
// consulta pasado el respiro (el contador de escrituras la garantiza). Nunca rechaza.
export function releerContactosDomicilioTrasEscribir() {
  escriturasPedidas++;
  if (!enCurso) return enRespiro() ? Promise.resolve() : refrescarContactosDomicilio();
  if (!relecturaAgendada) {
    relecturaAgendada = enCurso.then(() => {
      relecturaAgendada = null;
      if (enRespiro()) return undefined;
      return refrescarContactosDomicilio();
    });
  }
  return relecturaAgendada;
}

function necesitaRefresco() {
  if (enCurso || relecturaAgendada) return false;
  if (enRespiro()) return false;
  return !cache.indice || io.ahora() - cache.ts > TTL_MS || escriturasLeidas < escriturasPedidas;
}

// Los contactos de un domicilio de entrega (branch_code), con la forma de
// mapearContactosCliente. Nunca espera a Operam ni lanza. Sin padron todavia (cache
// fria o Operam caido desde el arranque) devuelve null y no la lista vacia: no se
// sabe, y el paso Envio no debe afirmar que el domicilio no tiene contactos.
export function contactosDelDomicilio(branchCode) {
  if (necesitaRefresco()) refrescarContactosDomicilio();
  if (!cache.indice) return null;
  const codigo = String(branchCode ?? '').trim();
  if (!codigo) return [];
  return (cache.indice.get(codigo) || []).map(c => ({ ...c }));
}

export function _esperarRefresco() {
  return relecturaAgendada || enCurso || Promise.resolve();
}

// Seam de prueba: Operam en memoria, ritmo y reloj.
export function _setIo(parcial) {
  io = { ...io, ...parcial };
}

// Seam de prueba: proceso recien arrancado.
export function _reiniciar() {
  cache = { indice: null, ts: 0 };
  ultimoFallo = null;
  enCurso = null;
  ultimaLectura = null;
  escriturasPedidas = 0;
  escriturasLeidas = 0;
  relecturaAgendada = null;
  io = { ...IO_DE_FABRICA };
}
