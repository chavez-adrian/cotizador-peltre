// El vocabulario de los dos estados del Cliente Operam (#344, ADR-0016,
// CONTEXT.md "Cliente Operam"), en UN solo lugar.
//
// Vive en public/js y no en lib/ por la regla de la casa: los modulos de
// public/js no importan de lib/, pero lib/ SI de public/js. El servidor decide
// los estados (lib/estado-cliente-operam.js) y el navegador los pinta; si cada
// lado tuviera su copia de las cadenas, un renombre dejaria a uno de los dos
// pintando una etiqueta que el otro ya no manda.
//
// "Sin datos fiscales" no es un pendiente ni una espera: para quien no factura
// es un estado legitimo y permanente. Y "ya compro" se dice "con pedido":
// "cliente" nunca va a secas (ADR-0016).

export const SIN_DATOS_FISCALES = 'sin_datos_fiscales';
export const CON_DATOS_FISCALES = 'con_datos_fiscales';

export const SIN_ACTIVIDAD = 'sin_actividad';
export const COTIZADO = 'cotizado';
export const CON_PEDIDO = 'con_pedido';

export const ETIQUETA_FISCAL = {
  [SIN_DATOS_FISCALES]: 'Sin datos fiscales',
  [CON_DATOS_FISCALES]: 'Con datos fiscales',
};

export const ETIQUETA_COMERCIAL = {
  [SIN_ACTIVIDAD]: 'sin actividad',
  [COTIZADO]: 'cotizado',
  [CON_PEDIDO]: 'con pedido',
};
