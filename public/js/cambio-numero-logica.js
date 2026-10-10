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
// otrasPersonas }`. Sin Contacto del numero viejo no hay nada que mover y no se dice
// nada. Con otras personas en el numero viejo (telefono compartido) se avisa.
export function textoEnElCotizador(numero) {
  if (!numero || !numero.contactoViejo) return '';
  const base = `En el cotizador, todo lo del ${numero.viejo} pasa al n\u00famero nuevo: ${loQueSeMueve(numero.oportunidades, numero.cotizaciones)}. El ${numero.viejo} deja de aparecer como Contacto.`;
  const otras = numero.otrasPersonas || [];
  if (!otras.length) return base;
  return `${base} Ojo: el ${numero.viejo} tambi\u00e9n tiene oportunidades de ${unir(otras)}. Puede ser el tel\u00e9fono de una oficina que comparten varias personas.`;
}

// Telefono compartido: el numero viejo tiene oportunidades o cotizaciones de otras
// personas. Solo entonces hay dos salidas.
export function esTelefonoCompartido(numero) {
  return !!(numero && numero.contactoViejo && (numero.otrasPersonas || []).length);
}

// Los botones de la pregunta, en el orden en que se pintan: `salida` es la llave del
// cuerpo que dicto el servidor en `reintentar`. Las dos del telefono compartido
// confirman la escritura en Operam; la segunda no mueve nada en el cotizador.
export function botonesCambioDeNumero(nombre, numero) {
  if (!esTelefonoCompartido(numero)) return [{ salida: 'confirmar', texto: 'Confirmar' }];
  return [
    { salida: 'confirmar', texto: `Es el celular de ${nombre}: pasar sus ${loQueSeMueve(numero.oportunidades, numero.cotizaciones)} al n\u00famero nuevo` },
    { salida: 'soloOperam', texto: `Es un tel\u00e9fono compartido: solo actualizar el celular de ${nombre} en Operam; el ${numero.viejo} se queda como est\u00e1 en el cotizador` },
  ];
}
