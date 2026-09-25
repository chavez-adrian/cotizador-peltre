// Limite de intentos del login por PIN (#450). El PIN es de 4 digitos: sin tope
// se prueban las 10,000 combinaciones. Tras MAX_INTENTOS_LOGIN fallos para un
// mismo vendedor, o desde una misma IP (aunque sean contra vendedores
// distintos), esa llave queda bloqueada BLOQUEO_LOGIN_MS contados desde el fallo
// que llego al tope; durante el bloqueo POST /api/login responde 429 sin revisar
// el PIN, y los intentos no alargan la espera. Un login correcto reinicia el
// contador de SU vendedor, no el de la IP (si no, una cuenta propia serviria
// para seguir probando PINes ajenos desde la misma IP). Un fallo cuenta mientras
// tenga menos de BLOQUEO_LOGIN_MS: sin esa ventana, los dedazos sueltos de una
// oficina detras de una sola IP la bloquearian tarde o temprano.
//
// Mismo patron que lib/rate-limit-publico.js (#157): vive en memoria, valido
// mientras Render corra UNA sola instancia, y `ahora` es inyectable.

export const MAX_INTENTOS_LOGIN = 5;
export const BLOQUEO_LOGIN_MS = 15 * 60 * 1000;

const fallos = new Map();
const bloqueos = new Map();

// Solo un id entero positivo abre llave por vendedor: el body llega sin validar
// (hasta 10mb), y cada vendedorId distinto quedaria 15 min en el Map. Con un id
// invalido el fallo cuenta solo contra la IP (nunca entra: no hay vendedor asi).
function llaves({ vendedorId, ip }) {
  const ipKey = `ip:${String(ip || 'desconocida')}`;
  return Number.isInteger(vendedorId) && vendedorId > 0 ? [`vendedor:${vendedorId}`, ipKey] : [ipKey];
}

// Poda perezosa: sin esto los Map crecen sin techo en un proceso de larga vida.
function podar(ahora) {
  const desde = ahora - BLOQUEO_LOGIN_MS;
  for (const [k, marcas] of fallos) {
    const vivas = marcas.filter(t => t > desde);
    if (vivas.length) fallos.set(k, vivas);
    else fallos.delete(k);
  }
  for (const [k, vence] of bloqueos) {
    if (vence <= ahora) bloqueos.delete(k);
  }
}

// Minutos (redondeados hacia arriba) que faltan para que el intento pueda
// revisarse; 0 si ni el vendedor ni la IP estan bloqueados.
export function esperaLogin(intento, ahora = Date.now()) {
  podar(ahora);
  const vence = Math.max(0, ...llaves(intento).map(k => bloqueos.get(k) || 0));
  return vence > ahora ? Math.ceil((vence - ahora) / 60000) : 0;
}

// Anota un PIN rechazado y devuelve la espera que queda tras anotarlo: el fallo
// que llega al tope ya responde como bloqueo.
export function registrarFalloLogin(intento, ahora = Date.now()) {
  podar(ahora);
  for (const k of llaves(intento)) {
    const marcas = fallos.get(k) || [];
    marcas.push(ahora);
    if (marcas.length >= MAX_INTENTOS_LOGIN) {
      bloqueos.set(k, ahora + BLOQUEO_LOGIN_MS);
      fallos.delete(k);
    } else {
      fallos.set(k, marcas);
    }
  }
  return esperaLogin(intento, ahora);
}

export function registrarExitoLogin({ vendedorId }) {
  fallos.delete(`vendedor:${vendedorId}`);
}

export function mensajeDemasiadosIntentos(minutos) {
  return `Demasiados intentos, espera ${minutos} min`;
}

export function resetLimiteLogin() {
  fallos.clear();
  bloqueos.clear();
}

// Orquestacion del login (#450), fuera de server.js para probarla con una lista
// asincrona que tarda (en produccion sale de Neon). El await va PRIMERO: revisar
// el bloqueo, comparar el PIN y anotar el resultado ocurren en un mismo tramo
// sincrono, sin awaits de por medio. Si la revision fuera antes del await, una
// rafaga simultanea pasaria entera la revision antes de que se anotara ningun
// fallo, y el PIN correcto en vuelo entraria con el tope ya alcanzado.
// Devuelve { status: 200, vendedor } o { status, error }.
export async function intentarLogin({ vendedorId, pin, soloAdmin, ip }, listarVendedores) {
  const vendedores = await listarVendedores();
  const intento = { vendedorId, ip };
  const espera = esperaLogin(intento);
  if (espera) return { status: 429, error: mensajeDemasiadosIntentos(espera) };
  if (!vendedores.length) return { status: 500, error: 'Vendedores no configurados' };
  const rechazar = error => {
    const min = registrarFalloLogin(intento);
    if (min) return { status: 429, error: mensajeDemasiadosIntentos(min) };
    return { status: 401, error };
  };
  const v = vendedores.find(v => v.id === vendedorId && v.pin === pin);
  // #440: el login de /admin pide `soloAdmin`; el no-admin con PIN correcto
  // recibe la MISMA respuesta que un PIN equivocado (no confirma el PIN), y
  // cuenta como fallo igual que el.
  if (soloAdmin === true && (!v || v.role !== 'admin')) {
    return rechazar('PIN incorrecto o no es administrador');
  }
  if (!v) return rechazar('PIN incorrecto');
  registrarExitoLogin(intento);
  return { status: 200, vendedor: v };
}

// Llaves vivas (fallos + bloqueos); para comprobar que el Map no crece por basura.
export function tamanoLimiteLogin() {
  return fallos.size + bloqueos.size;
}
