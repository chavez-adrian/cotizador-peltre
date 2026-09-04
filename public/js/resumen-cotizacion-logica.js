// Nucleo unico del Resumen de la cotizacion (#307/#312, CONTEXT.md "Resumen de
// la cotizacion"): lo que el cliente recibe por WhatsApp. Modulo puro sin
// efectos de navegador, mismo patron que origen-logica.js: lo consumen app.js
// (la cotizacion recien generada), cotizaciones-logica.js (el historial) y los
// tests .cjs via import().
//
// El mensaje NO es cliente-y-total: es un resumen por Familia de producto cuyo
// unico trabajo es que el cliente abra el documento (#312). Sin importes por
// renglon a proposito -- una columna de cifras se lee como lista de precios e
// invita a auditar linea por linea, que no es la conversacion de un chat. El
// dinero aparece una sola vez, al cierre.

import { importeLinea } from './cotizar-logica.js';
import { esCodigoCalca } from './calcas-logica.js';
import { aTitulo } from './titulo-logica.js';

const CODIGO_ENVIO = 'ENVIO';

// Familia y modelo son la misma llave del maestro de articulos (ADR-0016): los
// 4 primeros caracteres del SKU. VA05B1001112 -> VA05.
const LARGO_MODELO = 4;

function modeloDe(codigo) {
  return String(codigo || '').slice(0, LARGO_MODELO);
}

function fmtMiles(n) {
  return (n || 0).toLocaleString('es-MX');
}

function fmtMoneda(n) {
  return (n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// #311: sin numero no hay mensaje, sea cual sea el motivo por el que falta (PRE
// por fallo de Operam o registro sin id). Un numero es la identidad de la
// cotizacion (ADR-0009); compartir sin numero es compartir algo sin identidad.
export const LEYENDA_SIN_FOLIO = 'Sin número de cotización no se puede compartir; se habilita en cuanto Operam lo asigne';

export function motivoSinResumen(registro) {
  const r = registro || {};
  if (r.id == null || r.id === '') return LEYENDA_SIN_FOLIO;
  if (r.folioOperam == null || r.folioOperam === '') return LEYENDA_SIN_FOLIO;
  return null;
}

// La familia se captura en minuscula singular ("taza", "tazon", "portavasos") y
// el renglon la imprime capitalizada y en plural.
function enPlural(familia) {
  if (/s$/.test(familia)) return familia;
  if (/ón$/.test(familia)) return `${familia.slice(0, -2)}ones`;
  if (/[aeiou]$/.test(familia)) return `${familia}s`;
  return `${familia}es`;
}

function capitalizar(texto) {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function plural(n, singular, plural_) {
  return `${fmtMiles(n)} ${n === 1 ? singular : plural_}`;
}

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

// La vigencia es una fecha PLANA (YYYY-MM-DD), no un instante: se parte a mano
// en vez de pasarla por Date, que la anclaria a las 00:00 UTC y la imprimiria un
// dia antes para quien la lea al oeste de Greenwich.
function fechaEnProsa(vigencia) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(vigencia || ''));
  if (!m) return null;
  return `${Number(m[3])} de ${MESES[Number(m[2]) - 1]} de ${m[1]}`;
}

// Los modelos que el indice no conoce caen en un renglon "Otros" al final de las
// familias: el resumen nunca omite piezas que el cliente si va a recibir. El
// pendiente de verdad se resuelve en /admin/catalogo, donde ADR-0016 lo exige
// VISIBLE -- aqui solo se evita que el silencio llegue al chat.
const FAMILIA_OTROS = 'Otros';

// Partidas -> renglones del bloque, en el orden en que se imprimen. La calca no
// es producto (ADR-0010) y lleva su propio renglon en piezas decoradas; el envio
// es un servicio y siempre cierra el bloque.
function renglonesDeItems(items, indiceFamilias) {
  const porFamilia = new Map();
  let piezasCalca = 0;
  let piezas = 0;
  let envio = null;

  for (const item of items || []) {
    if (item.codigo === CODIGO_ENVIO) { envio = item; continue; }
    if (esCodigoCalca(item.codigo)) { piezasCalca += item.cantidad || 0; continue; }
    const familia = indiceFamilias[modeloDe(item.codigo)] || null;
    const llave = familia || FAMILIA_OTROS;
    if (!porFamilia.has(llave)) porFamilia.set(llave, { familia, modelos: new Set(), piezas: 0, importe: 0 });
    const grupo = porFamilia.get(llave);
    grupo.modelos.add(modeloDe(item.codigo));
    grupo.piezas += item.cantidad || 0;
    grupo.importe += importeLinea(item);
    piezas += item.cantidad || 0;
  }

  // Por importe descendente aunque el importe no se imprima: el renglon que mas
  // pesa en la cotizacion es el que el cliente tiene que ver primero.
  const conFamilia = [...porFamilia.values()].filter(g => g.familia).sort((a, b) => b.importe - a.importe);
  const otros = porFamilia.get(FAMILIA_OTROS);
  const renglones = conFamilia.map(g => [
    capitalizar(enPlural(g.familia)),
    plural(g.modelos.size, 'modelo', 'modelos'),
    plural(g.piezas, 'pza', 'pzs'),
  ].join(' · '));

  if (otros) {
    renglones.push([
      FAMILIA_OTROS,
      plural(otros.modelos.size, 'modelo', 'modelos'),
      plural(otros.piezas, 'pza', 'pzs'),
    ].join(' · '));
  }
  if (piezasCalca > 0) {
    renglones.push(`Calcas · ${plural(piezasCalca, 'pieza decorada', 'piezas decoradas')}`);
  }
  // El envio lleva renglon SIEMPRE: con partida, el servicio y el tiempo tal
  // como los reporta la paqueteria; sin ella, la ausencia dicha en voz alta.
  renglones.push(envio ? `Envío · ${envio.descripcion}` : 'No incluye envío');
  return { renglones, piezas };
}

// registro = { id, folioOperam, cliente, nombreCorto, vigencia, total, items }.
// indiceFamilias = { [modelo]: familia }, el que viaja en el catalogo que el
// servidor ya le manda al navegador. La liga es SIEMPRE al documento HTML, la
// unica cara del documento hacia el cliente; el PDF es la descarga del vendedor,
// y va por el id interno, que es la clave tecnica de las URLs (ADR-0009).
export function mensajeCotizacion(registro, origin = '', indiceFamilias = {}) {
  const r = registro || {};
  if (motivoSinResumen(r)) return null;

  const { renglones, piezas } = renglonesDeItems(r.items, indiceFamilias || {});
  const destinatario = r.nombreCorto || aTitulo(r.cliente) || 'Cliente';
  const vigencia = fechaEnProsa(r.vigencia);

  const lineas = [
    '*pp.peltre - Peltre Nacional*',
    `*Cotización ${r.folioOperam}*`,
    `Para: ${destinatario}`,
    '',
    ...renglones,
    '',
    `*${plural(piezas, 'pieza', 'piezas')} · TOTAL $${fmtMoneda(r.total)} IVA incluido*`,
    ...(vigencia ? [`Válido hasta el ${vigencia}`] : []),
    '',
    'Por favor revisa a detalle los modelos, colores y condiciones en el siguiente link.',
    '',
    'Avísame si tienes alguna duda.',
    '',
    `${origin}/api/cotizacion/html/${r.id}`,
  ];
  const texto = lineas.join('\n');
  return { texto, waUrl: `https://wa.me/?text=${encodeURIComponent(texto)}` };
}
