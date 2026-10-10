// D6 (decisiones de Adrian 2026-10-09): el interruptor de la escritura de Contactos en
// Operam es la variable de entorno CONTACTOS_OPERAM_ESCRITURA, y AUSENTE es apagado. El
// .env de las pruebas no la trae, asi que una suite que necesite que el modulo Contactos
// en Operam escriba la fija en su before() y la deja como estaba en su after():
//
//   let restaurarInterruptor;
//   before(() => { restaurarInterruptor = fijarInterruptorContactos('todos'); });
//   after(() => restaurarInterruptor());
//
// `undefined` la borra (el caso ausente). El modulo la lee en cada llamada.
const VARIABLE = 'CONTACTOS_OPERAM_ESCRITURA';

export function fijarInterruptorContactos(valor) {
  const previo = process.env[VARIABLE];
  if (valor === undefined) delete process.env[VARIABLE];
  else process.env[VARIABLE] = valor;
  return () => {
    if (previo === undefined) delete process.env[VARIABLE];
    else process.env[VARIABLE] = previo;
  };
}
