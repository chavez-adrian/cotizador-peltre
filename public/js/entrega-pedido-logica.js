// La fecha del pedido en el Pipeline (#531, #534). El sync la guarda en el espejo
// de Operam (del pedido principal) y aqui solo se decide si se pinta y con que
// texto. Formato elegido por Adrian con el prototipo (variante A, 2026-10-05): dia
// de la semana, dia/mes abreviado/anio de dos digitos y la cuenta de dias.
//   - Antes de Producto entregado: "Despacho" con la Fecha compromiso de despacho
//     (`fechaEntrega`, el "Requerido para"; conserva su nombre de #531).
//   - Producto entregado: la Fecha de despacho (`fechaDespacho`, la ultima
//     remision), "Entregado" o "Entregado parcialmente" segun `entregaCompleta`, sin
//     cuenta de dias. Sin las dos llaves (espejo anterior a #534) no se pinta nada:
//     nunca el "Requerido para" rotulado como Entregado.
// Sin color por atraso: el texto lo dice. Modulo hoja, sin IO.
//
// La fecha es un dia de Operam sin hora y se lee con fechaLocal (#428): llegue como
// '2026-10-20' o serializada como '2026-10-20T00:00:00.000Z', es el 20.
import { fechaLocal } from './busqueda-logica.js';
import { ETAPAS_POST_VENTA } from './perdida-logica.js';

const DIAS = ['dom', 'lun', 'mar', 'mi\u00e9', 'jue', 'vie', 's\u00e1b'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function diaCalendario(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function cuentaDeDias(dias) {
  if (dias === 0) return 'hoy';
  if (dias === 1) return 'ma\u00f1ana';
  if (dias > 1) return `en ${dias} d`;
  if (dias === -1) return 'venci\u00f3 ayer';
  return `venci\u00f3 hace ${-dias} d`;
}

function diaLegible(valor) {
  if (!valor) return null;
  const d = fechaLocal(valor);
  return isNaN(d) ? null : d;
}

function textoFecha(d) {
  return `${DIAS[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}/${MESES[d.getMonth()]}/${String(d.getFullYear()).slice(-2)}`;
}

// { rotulo, fecha, relativo, estado } o null: solo cotizaciones de Anticipo pagado
// en adelante con una fecha legible en su espejo. `estado` (futura, hoy, vencida,
// entregado, parcial): la cuenta va en negritas cuando es hoy o ya vencio, y
// `parcial` lleva la marca de aviso.
export function entregaPedido(o, ahora = new Date()) {
  if (!o || o.tipo !== 'cotizacion' || !ETAPAS_POST_VENTA.includes(o.etapa)) return null;
  const espejo = o.espejoOperam || {};
  if (o.etapa === 'producto_entregado') {
    const d = diaLegible(espejo.fechaDespacho);
    if (!d || typeof espejo.entregaCompleta !== 'boolean') return null;
    return espejo.entregaCompleta
      ? { rotulo: 'Entregado', fecha: textoFecha(d), relativo: '', estado: 'entregado' }
      : { rotulo: 'Entregado parcialmente', fecha: textoFecha(d), relativo: '', estado: 'parcial' };
  }
  const d = diaLegible(espejo.fechaEntrega);
  if (!d) return null;
  const dias = Math.round((diaCalendario(d) - diaCalendario(ahora)) / 86400000);
  return { rotulo: 'Despacho', fecha: textoFecha(d), relativo: cuentaDeDias(dias), estado: dias < 0 ? 'vencida' : dias === 0 ? 'hoy' : 'futura' };
}
