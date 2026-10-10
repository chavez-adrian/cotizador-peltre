// EL armador del domicilio de entrega (#332). Un solo modulo para los tres consumidores
// que lo imprimen -- el quote de Operam (`delivery_address`, `lib/operam-client.js`), el
// PDF y el HTML del cliente --, porque tenerlo copiado hizo que la correccion del numero
// interior llegara al quote y no al documento: el quote 1283 decia "Bosques de Europa 163
// Int. 4, ..." y el HTML de la misma cotizacion "Bosques de Europa 163, 4, ...".
//
// El interior va PEGADO a la calle -- que ya trae el numero exterior desde el paso Envio
// -- con la convencion mexicana, no como elemento suelto entre comas, que se leeria como
// un dato mas del domicilio. "Int." solo antecede a un interior DESNUDO (empieza con
// digito o mide hasta 3): los vendedores capturan "Dept 301", "Local 11" o
// "Mz. 4 Lts. 13 y 15", que ya se explican solos o ni siquiera son un interior.
//
// D3b (decisiones de Adrian 2026-10-09): sin calle -- ya no es obligatoria -- su lugar
// lo ocupa "Por definir" (CALLE_POR_DEFINIR, public/js/domicilio-entrega-logica.js), con
// el interior pegado si lo hay, siempre que el domicilio traiga algun otro dato; sin
// ninguno no se inventa un domicilio. La leyenda "Favor de confirmar el domicilio de
// entrega" (#84) la sigue poniendo el documento.
import { CALLE_POR_DEFINIR } from '../public/js/domicilio-entrega-logica.js';

export function calleConInterior(cliente) {
  const c = cliente || {};
  const calle = String(c.calle || '').trim() || CALLE_POR_DEFINIR;
  const interior = String(c.numInt || '').trim();
  if (!interior) return calle;
  const texto = /^\d/.test(interior) || interior.length <= 3 ? `Int. ${interior}` : interior;
  return `${calle} ${texto}`;
}

export function domicilioEntrega(cliente) {
  const c = cliente || {};
  const resto = [c.colonia, c.cpEntrega, c.municipio, c.estado].filter(Boolean);
  const conCalle = String(c.calle || '').trim() || String(c.numInt || '').trim() || resto.length;
  return [conCalle ? calleConInterior(c) : '', ...resto].filter(Boolean).join(', ');
}
