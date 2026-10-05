// Turno de los barridos largos contra Operam (#509): el barrido del sync post-venta y
// el barrido diario de post-fixes del quote nunca corren a la vez. El 2026-10-01
// corrieron juntos y los dos recibieron 429. Cada uno conserva su ritmo propio; el
// turno solo los forma uno detras de otro.
//
// Dos barridos distintos se forman: el segundo ESPERA (saltarlo perderia su dia). El
// mismo barrido pedido otra vez mientras corre o espera se omite: { omitido: true }.
// Vive en memoria, como los demas locks: ASUME UNA SOLA INSTANCIA.

export const TURNO_SYNC_OPERAM = 'sync-operam';
export const TURNO_POSTFIX_QUOTES = 'postfix-quotes';
export const TURNO_FECHAS_ENTREGA = 'fechas-entrega';

let cola = Promise.resolve();
const ocupados = new Set();

export function turnoOcupado(nombre) {
  return ocupados.has(nombre);
}

export function enTurno(nombre, fn) {
  if (ocupados.has(nombre)) return Promise.resolve({ omitido: true });
  ocupados.add(nombre);
  const mio = cola.then(() => fn());
  cola = mio.catch(() => {});
  return mio.finally(() => ocupados.delete(nombre));
}
