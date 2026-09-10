import { query as dbQuery } from './db.js';

// Auditoria de altas y cambios de cliente (tabla clientes_log de Neon). Vivia
// dentro de server.js; sale aqui con #364 (ADR-0017) porque lib/alta-cliente.js
// la recibe como dependencia y un modulo de lib/ no puede importar al servidor.
// La fila que inserta es la MISMA: nada de este cambio toca el esquema ni los
// valores. Fire-and-forget, como siempre: un fallo de la base jamas altera el
// alta -- solo se registra en consola.
export function logCliente(rfc, nombre, resultado, cliente_id, fuente, dropbox_ok, error_msg) {
  dbQuery(
    'INSERT INTO clientes_log (rfc, nombre, resultado, cliente_id, fuente, dropbox_ok, error_msg) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [rfc, nombre || null, resultado, cliente_id || null, fuente || null, dropbox_ok ?? null, error_msg || null]
  ).catch(err => console.error('[db] Error insertando log:', err.message));
}
