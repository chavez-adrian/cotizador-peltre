// Los textos del paso del numero (D4, decisiones de Adrian 2026-10-09; #565, enmienda a
// ADR-0016): cuando el vendedor cambia desde el cotizador el numero de una persona de
// Operam, lo que cuelga del Contacto del numero viejo pasa al del numero nuevo, y antes
// se le pregunta. Ningun texto que vea el vendedor dice "fundir" ni "fusion": esas
// palabras se quedan en el codigo (lib/fusion-contactos.js) y en los docs tecnicos.
//
// Vive en public/js porque lo leen los dos lados (cross-import lib -> public/js, como
// contacto-entrega-logica.js): el servidor arma la pregunta y el paso del reporte, y el
// navegador los botones. Puro, sin IO.

// El nombre del paso del reporte. Lo escriben la Fusion de Contactos y la Subida del quote.
export const PASO_CAMBIO_DE_NUMERO = 'Contacto movido al n\u00famero nuevo';

const cuenta = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

export function loQueSeMueve(oportunidades, cotizaciones) {
  return `${cuenta(oportunidades, 'oportunidad', 'oportunidades')} y ${cuenta(cotizaciones, 'cotizaci\u00f3n', 'cotizaciones')}`;
}

function unir(nombres) {
  if (nombres.length <= 1) return nombres.join('');
  return `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;
}

// La primera oracion de la pregunta: lo que cambia en Operam.
export function textoCambioDeNumero(nombre, viejo, nuevo) {
  return `El celular de ${nombre} cambia de ${viejo} a ${nuevo}.`;
}

// Lo que pasa en el cotizador, con el resumen que lee la Fusion de Contactos
// (`resumenDelCambioDeNumero`): `{ viejo, contactoViejo, oportunidades, cotizaciones,
// otrasPersonas, cotizacionesDeOtras }`. Sin Contacto del numero viejo no hay nada que
// mover y no se dice nada. Con otras personas en el numero viejo (telefono compartido)
// se avisa y se explica lo que hace cada uno de los dos botones, que son cortos. Las
// otras personas salen de las cotizaciones del numero viejo (las Oportunidades no
// guardan nombre propio), asi que el texto dice cuantas de esas cotizaciones son suyas.
function deOtrasPersonas(numero) {
  const otras = numero.otrasPersonas;
  const quienes = `${otras.length === 1 ? 'otra persona' : 'otras personas'} (${unir(otras)})`;
  const k = numero.cotizacionesDeOtras;
  if (k === 1 && numero.cotizaciones === 1) return `esa cotizaci\u00f3n est\u00e1 a nombre de ${quienes}`;
  return `${k} de esas cotizaciones ${k === 1 ? 'est\u00e1' : 'est\u00e1n'} a nombre de ${quienes}`;
}

export function textoEnElCotizador(numero, nombre) {
  if (!numero || !numero.contactoViejo) return '';
  const { viejo } = numero;
  const cuanto = loQueSeMueve(numero.oportunidades, numero.cotizaciones);
  if (!esTelefonoCompartido(numero)) {
    return `En el cotizador, todo lo del ${viejo} pasa al n\u00famero nuevo: ${cuanto}. El ${viejo} deja de aparecer como Contacto.`;
  }
  return `En el cotizador, el ${viejo} tiene ${cuanto}, y ${deOtrasPersonas(numero)}: puede ser el tel\u00e9fono de una oficina que comparten varias personas. ` +
    `Si era solo de ${nombre}, todo pasa al n\u00famero nuevo y el ${viejo} deja de aparecer como Contacto. ` +
    `Si es compartido, en el cotizador se queda como est\u00e1. En los dos casos se actualiza Operam.`;
}

// Telefono compartido: el numero viejo tiene cotizaciones de otras
// personas. Solo entonces hay dos salidas.
export function esTelefonoCompartido(numero) {
  return !!(numero && numero.contactoViejo && (numero.otrasPersonas || []).length);
}

// Los botones de la pregunta, en el orden en que se pintan: `salida` es la llave del
// cuerpo que dicto el servidor en `reintentar`. Las dos del telefono compartido
// confirman la escritura en Operam; la segunda no mueve nada en el cotizador. Lo que
// hace cada una lo explica `textoEnElCotizador`, en el mensaje de arriba.
export function botonesCambioDeNumero(numero) {
  if (!esTelefonoCompartido(numero)) return [{ salida: 'confirmar', texto: 'Confirmar' }];
  return [
    { salida: 'confirmar', texto: 'Era solo suyo: pasar todo al n\u00famero nuevo' },
    { salida: 'soloOperam', texto: 'Es compartido: dejarlo como est\u00e1' },
  ];
}
