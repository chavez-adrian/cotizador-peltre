// Nucleo puro del Origen (issue #287, CONTEXT.md "Origen"): de donde vino el
// prospecto. El campo en codigo, API y base de datos sigue llamandose `canal`;
// "Origen" es la palabra del glosario y de la interfaz.
//
// El prospecto lo trae capturado. La cotizacion y el cliente NO lo guardan: lo
// HEREDAN del prospecto cuyo celular coincide, por la llave de identidad
// (ultimos 10 digitos, "1 celular = 1 prospecto"). Nunca se persiste: si el
// prospecto corrige su origen, todas sus cotizaciones lo reflejan.
//
// Modulo sin efectos de navegador y SIN IMPORTS: lo cross-importa server.js
// (los GET del Historial y de Hoy resuelven la herencia ahi, donde el navegador
// no carga prospectos) y lo consumen app.js y los tests .cjs via import(). El
// chip visible (chipOrigenHtml) vive en prospectos-logica.js, junto a escapeHtml
// y al resto de los badges de tarjeta: importarlo aqui haria un ciclo.

// Reexpresion browser-safe de ultimos10 (lib/telefono-llave.js): los modulos de
// public/js no importan de lib/. test/origen-api.test.js compara las dos
// definiciones para que no deriven -- si divergen, la herencia falla en silencio.
export function llaveCelularOrigen(celular) {
  return String(celular || '').split(/ext/i)[0].split(',')[0].replace(/\D/g, '').slice(-10);
}

// Indice llave de celular -> canal del prospecto. Un celular es a lo sumo un
// prospecto (invariante del glosario), asi que el primero manda; un prospecto
// sin canal no entra (no tendria origen que heredar).
export function indiceOrigenPorCelular(prospectos) {
  const indice = new Map();
  for (const p of prospectos || []) {
    const llave = llaveCelularOrigen(p?.celular);
    const canal = String(p?.canal || '').trim();
    if (!llave || !canal || indice.has(llave)) continue;
    indice.set(llave, canal);
  }
  return indice;
}

// Los telefonos con los que un item puede ligar a un prospecto: el prospecto
// trae `celular`, la cotizacion `telefono` y el cliente de Operam la lista
// `telefonos` (una ficha puede tener varios contactos).
function telefonosDe(item) {
  const i = item || {};
  const varios = Array.isArray(i.telefonos) ? i.telefonos : [];
  return [i.celular, i.telefono, ...varios];
}

// El Origen de un item y si esta identificado. Manda lo que ya trae el item: el
// `origen` que anoto quien lo resolvio (idempotente: anotar dos veces no cambia
// nada, y una tarjeta ya anotada se pinta sin volver a cruzar) o el `canal`
// propio del prospecto. Si no trae ninguno, se hereda del prospecto ligado por
// celular. Sin liga, origen vacio: el chip lo pinta "Origen sin identificar".
export function origenDe(item, indice) {
  const propio = String(item?.origen || item?.canal || '').trim();
  if (propio) return { origen: propio, identificado: true };
  for (const tel of telefonosDe(item)) {
    const llave = llaveCelularOrigen(tel);
    const heredado = llave && indice ? indice.get(llave) : null;
    if (heredado) return { origen: heredado, identificado: true };
  }
  return { origen: '', identificado: false };
}

// Deja el Origen resuelto en el campo `origen` de cada item, en copias. UN solo
// lugar decide como se llama ese campo: lo usan el pipeline en el navegador y
// los GET del Historial y de Hoy en el servidor.
export function anotarOrigen(items, indice) {
  return (items || []).map(item => ({ ...item, origen: origenDe(item, indice).origen }));
}
