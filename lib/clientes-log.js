import { query as dbQuery } from './db.js';

// Auditoria de altas y cambios de cliente (tabla clientes_log de Neon). Vivia
// dentro de server.js; sale aqui con #364 (ADR-0017) porque lib/alta-cliente.js
// la recibe como dependencia y un modulo de lib/ no puede importar al servidor.
// La fila que inserta es la MISMA: nada de este cambio toca el esquema ni los
// valores. Fire-and-forget, como siempre: un fallo de la base jamas altera el
// alta -- solo se registra en consola.
//
// #356: devuelve el id de lo que inserto. Sigue siendo fire-and-forget (nadie
// tiene que esperar la promesa), pero quien sube la constancia a Dropbox la
// guarda para poder corregir esa fila cuando la subida resuelva -- esa es la
// unica forma de que dropbox_ok deje de ser siempre null. Resuelve a null sin
// base de datos o si la insercion falla: quien la use tiene que tolerarlo.
export function logCliente(rfc, nombre, resultado, cliente_id, fuente, dropbox_ok, error_msg, deps = {}) {
  const query = deps.query || dbQuery;
  return query(
    'INSERT INTO clientes_log (rfc, nombre, resultado, cliente_id, fuente, dropbox_ok, error_msg) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
    [rfc, nombre || null, resultado, cliente_id || null, fuente || null, dropbox_ok ?? null, error_msg || null]
  )
    .then(r => r?.rows?.[0]?.id ?? null)
    .catch(err => { console.error('[db] Error insertando log:', err.message); return null; });
}

// Corrige dropbox_ok de una fila ya insertada cuando la promesa de la subida
// resuelve (#356). `logId` puede ser el id o la promesa que devolvio logCliente:
// el llamador dispara la subida sin esperar a la auditoria. Nunca lanza -- es el
// ultimo eslabon de una cadena fire-and-forget y ninguna respuesta HTTP depende
// de el. Solo toca dropbox_ok: error_msg es del alta y el mensaje del fallo de
// Dropbox vive en lib/dropbox-subidas-store.js, con su flujo y su destino.
export async function marcarDropbox(logId, ok, deps = {}) {
  const query = deps.query || dbQuery;
  try {
    const id = await logId;
    if (!id) return false;
    await query('UPDATE clientes_log SET dropbox_ok = $1 WHERE id = $2', [ok === true, id]);
    return true;
  } catch (err) {
    console.error('[db] Error marcando dropbox_ok:', err.message);
    return false;
  }
}
