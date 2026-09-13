// Nucleo puro de la Moneda del cliente (#297, ADR-0015; CONTEXT.md "Moneda del
// cliente"), que es el juicio de BLOQUEO mientras el cotizador no maneje moneda
// extranjera.
//
// La moneda la manda el CLIENTE (curr_code), no la lista de precios ni el
// domicilio. El cotizador nacio monolingue: calcula, imprime y sube precios en
// pesos pelones, y Operam los etiqueta con la moneda del cliente -- cotizarle a
// un cliente en USD registraria pesos como dolares, un error de 17x sin ningun
// aviso (20 de 469 clientes del padron, 0 cotizaciones 2026). Por eso se detiene
// con un mensaje accionable en los dos puntos: al elegir al cliente en el paso
// Cliente y al subir el quote (defensa del servidor, independiente de la
// pantalla). Lo LEVANTA el soporte de moneda extranjera (#295).
//
// Vive en public/js y no en lib/ por la regla de la casa: los modulos de
// public/js no importan de lib/, pero lib/ SI de public/js. El navegador no deja
// avanzar y el servidor rechaza la subida con el MISMO veredicto y el MISMO
// texto; con una copia por lado, un dia dirian cosas distintas.

// La unica moneda que el cotizador sabe calcular e imprimir.
export const MONEDA_BASE = 'MXN';

// Codigo estructurado de la respuesta: el frontend clasifica por codigo, nunca
// parseando el texto del error (misma disciplina que CLIENTE_SIN_LISTA_PRECIOS,
// #285, y CUST_REF_DUPLICADO, #242).
export const CODIGO_MONEDA_EXTRANJERA = 'CLIENTE_MONEDA_EXTRANJERA';

// La moneda llega con dos nombres segun la altura: `curr_code` es como viaja en
// Operam (el GET del cliente) y `moneda` como la expone la fila del cotizador
// (server.js, filaClienteOperam) al paso Cliente. Es el mismo dato a dos alturas
// -- el mismo trato que ya recibe motivoPre (lib/pipeline.js). Devuelve '' cuando
// no hay senal: ausencia no es moneda extranjera.
export function monedaDelCliente(cliente) {
  const valor = cliente?.curr_code ?? cliente?.moneda;
  return String(valor ?? '').trim().toUpperCase();
}

// El texto accionable: dice el motivo (el cotizador aun no maneja moneda
// extranjera) y que hacer (cotizar por Operam o esperar el soporte). Sin nombre a
// la mano sigue diciendo lo mismo y jamas imprime un hueco.
export function MENSAJE_MONEDA_EXTRANJERA(nombre, moneda) {
  const quien = String(nombre ?? '').trim();
  const sujeto = quien ? `El Cliente Operam ${quien}` : 'El Cliente Operam';
  const divisa = String(moneda ?? '').trim().toUpperCase() || 'otra moneda';
  return `${sujeto} cotiza en ${divisa} y el cotizador todavia no maneja moneda extranjera: `
    + `todo lo que calcula e imprime son pesos y Operam los registraria como ${divisa}. `
    + 'Haz esta cotizacion directamente en Operam o espera el soporte de moneda extranjera.';
}

// EL juicio, uno solo para las dos superficies: null = adelante (es el 96% del
// padron), o { moneda, mensaje } = se detiene. `nombre` lo pasa quien llama --
// cada superficie sabe de donde sacarlo (CustName en Operam, name en la fila) y
// el nucleo no adivina llaves de nombre.
export function bloqueoMonedaCliente(cliente, nombre) {
  const moneda = monedaDelCliente(cliente);
  if (!moneda || moneda === MONEDA_BASE) return null;
  return { moneda, mensaje: MENSAJE_MONEDA_EXTRANJERA(nombre, moneda) };
}

// Error tipado de la subida: separa "a este cliente no se le puede cotizar
// todavia" (422, reintentar no sirve) de "Operam fallo" (503 con Reintentar),
// igual que ErrorClienteSinLista (#285).
export class ErrorClienteMonedaExtranjera extends Error {
  constructor(nombre, moneda) {
    super(MENSAJE_MONEDA_EXTRANJERA(nombre, moneda));
    this.name = 'ErrorClienteMonedaExtranjera';
    this.codigo = CODIGO_MONEDA_EXTRANJERA;
    this.moneda = String(moneda ?? '').trim().toUpperCase();
  }
}
