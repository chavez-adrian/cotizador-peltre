// Nucleo puro de la lista de precios del cliente (issue #285).
//
// Un cliente de Operam que quedo SIN lista de precios (sales_type 0) no puede
// valuar ningun documento: el POST del quote responde
// "Operam 406: Debe haber al menos un rate de moneda", que no menciona ni al
// cliente ni a la lista. La cotizacion salia como PRE-COTIZACION y el vendedor no
// tenia como saber que el arreglo estaba en el CLIENTE (asignarle una lista en
// Operam), no en la cotizacion -- el reintento del historial fallaba igual, para
// siempre.
//
// Como se pierde la lista: un PUT con sales_type '' -- Operam lo coerciona a 0 y
// el cliente pierde su configuracion (#250 cerro ese camino en el alta; el
// guardia que impide emitir la llave vacia vive en lib/operam-client.js).
//
// Aqui viven SOLO las reglas; el IO (leer el cliente antes del POST, responder el
// 422, marcar el motivo de la PRE) es de los callers.

// Listas activas en Operam al 2026-09-01: Precio de lista (12), M100 (15),
// M350 (16), M550 (1), M1500 (6), M6000 (3). Van en el mensaje para que quien lo
// corrija sepa que elegir sin salir a preguntar.
export const LISTAS_PRECIOS_VIGENTES = 'Precio de lista, M100, M350, M550, M1500, M6000';

// Codigo estructurado de la respuesta: el frontend clasifica por codigo, nunca
// parseando el texto del error (misma disciplina que CUST_REF_DUPLICADO, #242).
export const CODIGO_CLIENTE_SIN_LISTA = 'CLIENTE_SIN_LISTA_PRECIOS';

// El GET de Operam devuelve sales_type como string ("0", "12"), pero aqui entran
// tambien el 0 numerico y la ausencia del campo: en los tres casos el cliente no
// tiene con que valuar. NO se valida que el id exista en Operam -- solo que haya
// uno; elegir cual es una decision comercial que se toma en Operam.
export function clienteSinListaPrecios(cliente) {
  const valor = cliente?.sales_type;
  if (valor == null) return true;
  const texto = String(valor).trim();
  return texto === '' || texto === '0';
}

// El texto accionable. Sin nombre (el fallback del 406 no siempre lo tiene a
// mano) sigue diciendo que hacer, y jamas imprime un hueco.
export function MENSAJE_CLIENTE_SIN_LISTA(nombre) {
  const quien = String(nombre ?? '').trim();
  const sujeto = quien ? `El cliente ${quien}` : 'El cliente';
  return `${sujeto} no tiene lista de precios en Operam; asignale una (${LISTAS_PRECIOS_VIGENTES}) y vuelve a subir`;
}

// Reconoce el 406 de Operam cuando llega de todos modos (cliente que se quedo sin
// lista entre la lectura y el POST, o un camino que no alcanzo a checar).
// Insensible a mayusculas y acentos: el texto lo escribe el ERP y no es contrato.
export function esErrorRateMoneda(mensaje) {
  const texto = String(mensaje ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
  return texto.includes('rate de moneda');
}

// Error tipado: separa "el cliente esta mal configurado" (422, reintentar no
// sirve hasta arreglarlo en Operam) de "Operam fallo" (503 con Reintentar).
export class ErrorClienteSinLista extends Error {
  constructor(nombre) {
    super(MENSAJE_CLIENTE_SIN_LISTA(nombre));
    this.name = 'ErrorClienteSinLista';
    this.codigo = CODIGO_CLIENTE_SIN_LISTA;
  }
}
