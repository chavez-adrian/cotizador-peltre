// Nucleo PURO del modulo Fusion de Contactos (#565, enmienda 2026-10-09 a ADR-0016):
// lo que la ficha del Contacto que queda gana del que se funde, sin IO. La puerta con
// IO (los stores, el orden de la fusion y su registro) es lib/fusion-contactos.js.

import { esContactoSinCaptura } from './contacto-cotizacion.js';
import { ligasDeContacto, parcheDeLiga } from './ligas-contacto.js';

const vacio = v => v === undefined || v === null || String(v).trim() === '';
// Lo que la ficha fundida no copia campo por campo: las ligas se unen, la marca de
// captura se decide aparte y las notas se juntan.
const DATA_APARTE = new Set(['cliente_id', 'clientes_operam', 'sinCaptura', 'notas']);

// Lo que la ficha del Contacto que queda gana del que se funde: SOLO lo vacio (nombre,
// ciudad, Origen, vendedor y lo de `data`), las ligas a Clientes Operam unidas, la
// etiqueta prospecto si el que se funde estaba capturado y las notas juntas.
export function fichaFundida(queda, sefunde) {
  const campos = {};
  for (const k of ['nombre', 'ciudad', 'canal', 'vendedor']) {
    if (vacio(queda[k]) && !vacio(sefunde[k])) campos[k] = sefunde[k];
  }
  const d = queda.data || {};
  const v = sefunde.data || {};
  const data = {};
  for (const [k, valor] of Object.entries(v)) {
    if (!DATA_APARTE.has(k) && vacio(d[k]) && !vacio(valor)) data[k] = valor;
  }
  let ligas = d;
  for (const liga of ligasDeContacto(v)) ligas = parcheDeLiga(ligas, liga.cliente_id, liga.fuente);
  if (ligas !== d) Object.assign(data, ligas);
  if (esContactoSinCaptura(queda) && !esContactoSinCaptura(sefunde)) data.sinCaptura = false;
  if (!vacio(v.notas)) {
    if (vacio(d.notas)) data.notas = v.notas;
    else if (!String(d.notas).includes(v.notas)) data.notas = `${d.notas}\n${v.notas}`;
  }
  return { ...campos, data };
}
