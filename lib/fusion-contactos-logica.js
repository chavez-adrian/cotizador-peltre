// Nucleo PURO del modulo Fusion de Contactos (#565, enmienda 2026-10-09 a ADR-0016):
// lo que la ficha del Contacto que queda gana del que se funde, sin IO. La puerta con
// IO (los stores, el orden de la fusion y su registro) es lib/fusion-contactos.js.

import { esContactoSinCaptura, celularesDeCruce } from './contacto-cotizacion.js';
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

// Las cotizaciones que siguen al numero viejo: las de su liga fija (#342) y las
// historicas sin liga que cruzaban por lo tecleado. Son las que la fusion mueve.
export function cotizacionesDelNumero(cotizaciones, numero10) {
  return (cotizaciones || []).filter(c => c.contactoCelular === numero10
    || (vacio(c.contactoCelular) && celularesDeCruce(c).includes(numero10)));
}

// Telefono compartido (D4, decisiones de Adrian 2026-10-09 y 2026-10-10). La regla:
// "otra persona" es un nombre, normalizado (sin acentos, sin mayusculas, sin espacios de
// mas), que no es ninguna de las `referencias` -- el Contacto del cotizador de ese
// numero, y la persona que se edita (su nombre en Operam y el del Contacto de entrega)
// --: ni igual, ni el comienzo, palabra por palabra, de una de ellas o al reves (el mismo
// nombre con o sin apellido). Se juzga sobre los `nombres` del Contacto de entrega de
// las cotizaciones del numero viejo: la ficha es el Contacto mismo y las Oportunidades
// no guardan nombre propio. Cada otra persona sale una vez, con el primer nombre tal
// como se escribio.
const normalizarNombrePersona = v => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim();
const empiezaCon = (a, b) => a === b || a.startsWith(`${b} `);

export function otrasPersonas(referencias, nombres) {
  const refs = (referencias || []).map(normalizarNombrePersona).filter(Boolean);
  const vistas = new Set();
  const otras = [];
  for (const nombre of nombres || []) {
    const n = normalizarNombrePersona(nombre);
    if (!n || vistas.has(n) || refs.some(r => empiezaCon(r, n) || empiezaCon(n, r))) continue;
    vistas.add(n);
    otras.push(String(nombre).trim());
  }
  return otras;
}
