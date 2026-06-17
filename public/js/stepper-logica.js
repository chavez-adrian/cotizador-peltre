// Logica pura del stepper del flujo de cotizar (issue #60, PRD #52 historia 38,
// CONTEXT.md "Alta de cliente"): los 4 pasos del flujo se presentan como un
// stepper guiado con avance visible (en que paso voy / cuanto falta). Modulo
// sin efectos de navegador, mismo patron que pipeline-logica.js /
// cotizaciones-logica.js: lo consumen app.js y los tests .cjs via import().
//
// El stepper GUIA y MUESTRA progreso pero NO bloquea la navegacion: se puede
// llegar a Cotizacion sin pasar por el alta de cliente (AC2) y los pasos siguen
// siendo navegables con un clic. La completitud de cada paso se deriva de un
// estado plano con los MISMOS criterios que hoy calcula updateTabIndicators en
// app.js: cliente = razon social con valor, productos = carrito no vacio,
// envio = una opcion de envio elegida.

export const PASOS_STEPPER = ['cliente', 'productos', 'envio', 'resumen'];

export const PASO_LABELS = {
  cliente: 'Cliente',
  productos: 'Productos',
  envio: 'Envio',
  resumen: 'Cotizacion',
};

// Que llave del estado plano marca la completitud de cada paso. El paso
// resumen (Cotizacion) no tiene criterio propio: es el destino, no un requisito.
const COMPLETITUD = {
  cliente: 'clienteListo',
  productos: 'productosListos',
  envio: 'envioListo',
};

export function indicePaso(paso) {
  return PASOS_STEPPER.indexOf(paso);
}

export function esPasoValido(paso) {
  return PASOS_STEPPER.includes(paso);
}

export function siguientePaso(paso) {
  const i = indicePaso(paso);
  if (i === -1) return PASOS_STEPPER[0];
  return PASOS_STEPPER[Math.min(i + 1, PASOS_STEPPER.length - 1)];
}

export function pasoAnterior(paso) {
  const i = indicePaso(paso);
  if (i === -1) return PASOS_STEPPER[0];
  return PASOS_STEPPER[Math.max(i - 1, 0)];
}

export function pasoCompleto(paso, estado) {
  const llave = COMPLETITUD[paso];
  if (!llave || !estado) return false;
  return !!estado[llave];
}

export function pasosCompletos(estado) {
  return PASOS_STEPPER.filter(paso => pasoCompleto(paso, estado));
}

export function progresoStepper(paso) {
  const i = indicePaso(paso);
  const actual = (i === -1 ? 0 : i) + 1;
  const total = PASOS_STEPPER.length;
  return { actual, total, fraccion: actual / total };
}

export function textoProgreso(paso) {
  const { actual, total } = progresoStepper(paso);
  return `Paso ${actual} de ${total}`;
}

export function estadoStepper(pasoActual, estado) {
  const actual = esPasoValido(pasoActual) ? pasoActual : PASOS_STEPPER[0];
  return {
    actual,
    progreso: progresoStepper(actual),
    pasos: PASOS_STEPPER.map((paso, i) => ({
      paso,
      numero: i + 1,
      label: PASO_LABELS[paso],
      esActual: paso === actual,
      completo: pasoCompleto(paso, estado),
    })),
  };
}
