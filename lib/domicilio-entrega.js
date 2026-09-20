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
export function calleConInterior(cliente) {
  const c = cliente || {};
  const calle = String(c.calle || '').trim();
  const interior = String(c.numInt || '').trim();
  if (!interior) return calle;
  const texto = /^\d/.test(interior) || interior.length <= 3 ? `Int. ${interior}` : interior;
  return calle ? `${calle} ${texto}` : texto;
}

export function domicilioEntrega(cliente) {
  const c = cliente || {};
  return [calleConInterior(c), c.colonia, c.cpEntrega, c.municipio, c.estado]
    .filter(Boolean).join(', ');
}
