// Nucleo puro de la alerta por correo de captura publica de mayoreo (issue #163,
// ADR-0012; CONTEXT.md "Captura publica": "Cada captura publica avisa por correo a
// quienes tienen el permiso de asignacion"). Arma destinatarios y el mensaje SIN
// IO -- el envio real vive en lib/alerta-mayoreo-io.js (nodemailer), mismo patron
// de nucleo+wrapper que lib/sync-operam.js / lib/sync-operam-io.js.
//
// Destinatarios (issue #156): vendedores con permiso de asignacion (puedeAsignar,
// que ya incluye a los admin) deduplicados por correo (case-insensitive). El
// registro de vendedores (lib/vendedores-store.js) NO tenia campo de correo antes
// de este issue -- se agrego `email` (columna nueva, mismo patron ALTER TABLE IF
// NOT EXISTS que puede_fijar_lista/puede_asignar de #153/#156) porque no existe
// ninguna convencion de correo corporativo documentada (nombre@dominio) para
// derivarlo sin inventarlo; Adrian lo llena en /admin. Un vendedor sin correo
// registrado simplemente no recibe alerta. Si NINGUN admin tiene correo
// registrado, se agrega `adminEmailFallback` (env var ALERTA_ADMIN_EMAIL,
// resuelta por el wrapper IO) para que la alerta no se quede sin destinatario
// mientras el registro se llena.

import { puedeAsignar } from '../public/js/pipeline-logica.js';
import { buildWaLink, escapeHtml } from '../public/js/prospectos-logica.js';

function correoValido(v) {
  const s = String(v == null ? '' : v).trim();
  return s.includes('@') ? s : null;
}

export function destinatariosAlertaMayoreo(vendedores, { adminEmailFallback } = {}) {
  const lista = Array.isArray(vendedores) ? vendedores : [];
  const set = new Map(); // llave: correo en minusculas -> correo original
  let adminConCorreo = false;
  for (const v of lista) {
    if (!v || !puedeAsignar(v)) continue;
    const correo = correoValido(v.email);
    if (!correo) continue;
    if (v.role === 'admin') adminConCorreo = true;
    const llave = correo.toLowerCase();
    if (!set.has(llave)) set.set(llave, correo);
  }
  if (!adminConCorreo) {
    const fallback = correoValido(adminEmailFallback);
    if (fallback && !set.has(fallback.toLowerCase())) set.set(fallback.toLowerCase(), fallback);
  }
  return Array.from(set.values());
}

const ASUNTO = 'Nuevo prospecto de mayoreo';

function dato(v) {
  const s = String(v == null ? '' : v).trim();
  return s || 'Sin dato';
}

function limpio(v) {
  return String(v == null ? '' : v).trim();
}

// Tipo de proyecto + el texto libre de "Otro" cuando el prospecto lo lleno --
// el core no necesita saber que el catalogo llama "Otro" a esa opcion, solo
// que hay un texto adicional que mostrar entre parentesis.
function lineaTipoProyecto(p) {
  const otro = limpio(p.tipoProyectoOtro);
  return otro ? `${dato(p.tipoProyecto)} (${otro})` : dato(p.tipoProyecto);
}

// Ciudad + CP en una sola linea (ticket #165: "ciudad+CP"); el CP es opcional
// (no todo el catalogo de paises lo capturaba antes de #160).
function lineaCiudad(p) {
  const cp = limpio(p.cp);
  return cp ? `${dato(p.ciudad)} (CP ${cp})` : dato(p.ciudad);
}

// Promociones: solo se imprime si ACEPTO (issue #165, "promos (si acepto, con
// fecha)") -- el "no" es la ausencia de la linea, no un valor negativo visible.
function lineaPromos(p) {
  const promos = p.promos;
  if (!promos || !promos.acepta) return null;
  const fecha = limpio(promos.fecha);
  return fecha ? `Si (${fecha})` : 'Si';
}

// Filas [etiqueta, valor] del cuerpo del correo, en el orden del ticket #165.
// Los campos opcionales (empresa, cargo, correo, para cuando, sitio web/redes,
// promos) se omiten por completo cuando vienen vacios -- nunca "Sin dato" para
// esos, a diferencia de los obligatorios de arriba.
function filasProspecto(p) {
  const filas = [
    ['Nombre', dato(p.nombre)],
    ['Celular', dato(p.celular)],
    ['Ciudad', lineaCiudad(p)],
    ['Tipo de proyecto', lineaTipoProyecto(p)],
    ['Cantidad estimada', dato(p.cantidadEstimada)],
  ];
  const opcional = (label, v) => { const s = limpio(v); if (s) filas.push([label, s]); };
  opcional('Empresa', p.empresa);
  opcional('Cargo', p.cargo);
  opcional('Correo', p.correo);
  opcional('Para cuando', p.cuando);
  opcional('Sitio web / redes', p.web);
  const promos = lineaPromos(p);
  if (promos) filas.push(['Promociones', promos]);
  return filas;
}

function textoDeFilas(filas) {
  return filas.map(([label, valor]) => `${label}: ${valor}`).join('\n');
}

// Version HTML: identica a la de texto, salvo el Celular -- issue #165 pide que
// un clic abra WhatsApp (wa.me), asi que esa fila (y solo esa) se envuelve en
// un <a>. buildWaLink ya es el builder de la casa (prospectos-logica.js, #118):
// solo digitos, funciona para +52 y cualquier otro pais.
function htmlDeFilas(filas, waLink) {
  return filas.map(([label, valor]) => {
    if (label === 'Celular' && waLink) {
      return `<p><strong>${escapeHtml(label)}:</strong> <a href="${escapeHtml(waLink)}">${escapeHtml(valor)}</a></p>`;
    }
    return `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(valor)}</p>`;
  }).join('\n');
}

// Escapa los caracteres reservados de un valor de vCard (RFC 6350 3.4): backslash
// y las comas/punto y coma que el formato usa como separadores de estructura.
function escapeVCard(v) {
  return limpio(v).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

// N: (nombre estructurado, componentes apellidos;nombre;segundos nombres;
// prefijos;sufijos) es OBLIGATORIA en vCard 3.0 y su ausencia era el bug de
// #234/#236: Android la deduce de FN:, pero Contactos de Apple, sin N:, lee la
// ficha como ficha de EMPRESA y promueve ORG: a titulo del contacto -- el
// vendedor terminaba con un contacto llamado como la empresa. Se queda en 3.0
// (en 4.0 N: es opcional, pero cambiar de version perderia compatibilidad sin
// ganar nada).
//
// Nada de partir el nombre completo: los dos componentes llegan como campos
// propios del prospecto (`nombrePila` y `apellido`) porque el formulario
// publico ya los pide por separado y server.js los toma del cuerpo crudo,
// igual que el cargo. `p.nombre` (el nombre ya unido que va en FN:) solo se usa
// de respaldo, para un prospecto que no traiga los campos separados: ahi la
// ficha sigue siendo valida con el nombre completo en el componente de pila.
function lineaN(p) {
  const apellido = limpio(p.apellido);
  const pila = limpio(p.nombrePila) || limpio(p.nombre);
  return `N:${escapeVCard(apellido)};${escapeVCard(pila)};;;`;
}

// vCard del prospecto (issue #165, extendida por #237 con TITLE: y URL:):
// nombre, celular, correo, empresa, cargo y sitio web/redes -- para que
// "Agregar contacto" prellene lo util y el vendedor no pierda ese contexto en
// cuanto cierra el correo. Sin servicios externos: es un string armado a mano,
// CRLF por el RFC. Los campos opcionales se omiten si estan vacios (una EMAIL:
// vacia rompe algunos lectores de vCard).
export function vcardDeProspecto(prospecto) {
  const p = prospecto || {};
  const lineas = ['BEGIN:VCARD', 'VERSION:3.0', lineaN(p), `FN:${escapeVCard(p.nombre)}`];
  if (limpio(p.celular)) lineas.push(`TEL;TYPE=CELL:${escapeVCard(p.celular)}`);
  if (limpio(p.correo)) lineas.push(`EMAIL:${escapeVCard(p.correo)}`);
  if (limpio(p.empresa)) lineas.push(`ORG:${escapeVCard(p.empresa)}`);
  if (limpio(p.cargo)) lineas.push(`TITLE:${escapeVCard(p.cargo)}`);
  if (limpio(p.web)) lineas.push(`URL:${escapeVCard(p.web)}`);
  lineas.push('END:VCARD');
  return lineas.join('\r\n');
}

// Mensaje de alerta para un prospecto de la captura publica de mayoreo (issue
// #163, extendido por #165 a la informacion completa del formulario + celular
// accionable por WhatsApp + vCard adjunta). Sin destinatarios validos no arma
// mensaje (devuelve null) -- el wrapper IO nunca debe intentar mandar un correo
// vacio de "to".
export function mensajeAlertaMayoreo(prospecto, vendedores, opts) {
  const to = destinatariosAlertaMayoreo(vendedores, opts);
  if (to.length === 0) return null;
  const p = prospecto || {};
  const filas = filasProspecto(p);
  const waLink = buildWaLink(p.celular);
  return {
    to, subject: ASUNTO,
    text: textoDeFilas(filas),
    html: htmlDeFilas(filas, waLink),
    vcard: vcardDeProspecto(p),
  };
}
