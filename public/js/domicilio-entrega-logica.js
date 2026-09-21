// Nucleo puro del selector de Domicilio de entrega del paso Envio (#84, con red
// de pruebas desde #409). Lo que vive aqui son las dos decisiones que el
// navegador tomaba escondidas dentro de app.js: QUE queda escrito en los seis
// campos de la direccion al aplicar un domicilio, y EN CUAL de los domicilios
// del cliente arranca el selector.
//
// La regla de escritura NO es nueva: es la MISMA de `decidirCampoAsistido`
// (#291, autollenado por CP) -- lo que escribio una persona se respeta; lo que
// puso el sistema, el sistema lo puede reemplazar. Decision de Adrian del
// 2026-09-21: inventar una regla propia aqui dejaria el cotizador con dos
// comportamientos distintos para "el sistema quiere llenarte un campo que
// quiza ya tocaste".
//
// Lo que esa regla arregla y el `if (el && val)` de antes no podia: el campo que
// el domicilio nuevo NO trae se BORRA cuando lo habia puesto el selector. Sin
// eso, cambiar de domicilio dejaba la calle del nuevo con el CP del anterior --
// una direccion que no existe en ningun lado -- y desde el asiento del vendedor
// se leia igual que "el selector no hace nada".
import { decidirCampoAsistido } from './cp-autollenado.js';

// Los seis campos de la DIRECCION. El contacto de entrega (nombre, telefono,
// correo) no esta aqui a proposito: lo aplica su propio selector (#99), y
// mezclarlos haria que cambiar de domicilio pisara a la persona que recibe.
export const CAMPOS_DOMICILIO = ['calle', 'numInt', 'colonia', 'cp', 'municipio', 'estado'];

function texto(v) {
  return String(v == null ? '' : v).trim();
}

export function camposDomicilioVacios() {
  const out = {};
  for (const campo of CAMPOS_DOMICILIO) out[campo] = '';
  return out;
}

// La direccion que aporta un domicilio de Operam, ya normalizada a los seis
// campos. `respaldo` llena SOLO los huecos: es la direccion que el propio
// registro del cliente trajo antes (seleccionarClienteOperam prellena los cl-*
// con ella), y con branches sin calle ni CP en el ERP -- 33 medidos, #330 -- es
// lo unico que hay. Nunca pisa lo que el domicilio si trae.
export function valoresDeDomicilio(domicilio, respaldo) {
  const d = domicilio || {};
  const r = respaldo || {};
  const out = {};
  for (const campo of CAMPOS_DOMICILIO) out[campo] = texto(d[campo]) || texto(r[campo]);
  return out;
}

// De quien es lo que hay AHORA en el campo. El sistema tiene DOS escritores en
// el paso Envio -- este selector y el indice del CP (#291) -- y cada uno lleva
// su propia memoria, asi que hay que preguntarle a los dos: un municipio que
// dejo el indice NO es captura a mano, aunque este selector no lo haya puesto.
// Sin esto, cambiar de domicilio dejaba la calle y el CP del nuevo con el
// municipio del anterior: la misma mezcla que el ticket vino a matar, entrando
// por la puerta de al lado. Cuando no lo puso ninguno manda la memoria propia,
// que es la que `decidirCampoAsistido` devuelve actualizada.
function duenoDelCampo(actual, propio, ajeno) {
  const v = texto(actual);
  if (v !== '' && v === texto(ajeno)) return texto(ajeno);
  return texto(propio);
}

// Los seis campos en una sola decision. `delSelector` es lo que este mismo
// selector dejo la vez pasada: sin esa memoria no hay forma de distinguir el CP
// que puso el domicilio anterior del que tecleo el vendedor. `delIndiceCp` es
// la memoria del OTRO escritor del sistema, y solo habla de municipio y estado
// (los dos campos que el indice del CP sabe llenar).
export function planDomicilioAsistido(actuales, delSelector, valores, delIndiceCp) {
  const a = actuales || {};
  const m = delSelector || {};
  const v = valores || {};
  const cp = delIndiceCp || {};
  const out = { valores: {}, delSelector: {} };
  for (const campo of CAMPOS_DOMICILIO) {
    const r = decidirCampoAsistido(a[campo], duenoDelCampo(a[campo], m[campo], cp[campo]), v[campo]);
    out.valores[campo] = r.valor;
    out.delSelector[campo] = r.delIndice;
  }
  return out;
}

// En cual domicilio arranca el selector. El `branch_code` es lo que identifica
// al domicilio de entrega (#252) y es lo que la cotizacion guarda como
// `branchId` al subirse: al reabrirla, el selector tiene que abrir en ESE y no
// en el primero de la lista. Sin senal usable -- sin branchId, con uno que este
// cliente ya no tiene, o sin lista -- el primero, que es el default de siempre.
export function indiceDeDomicilio(domicilios, branchId) {
  const lista = Array.isArray(domicilios) ? domicilios : [];
  if (branchId == null || branchId === '') return 0;
  const i = lista.findIndex(d => d && d.branch_code != null && String(d.branch_code) === String(branchId));
  return i >= 0 ? i : 0;
}

// La traduccion de vuelta: que domicilio es el que esta elegido. Vive junto a su
// inversa porque la pantalla trabaja con el INDICE del <select> y todo lo que se
// guarda -- el borrador, la cotizacion -- lo hace por `branch_code`; tener las
// dos direcciones separadas es como el indice se cuela a un lugar donde el orden
// de la lista no es una promesa.
export function branchIdDeIndice(domicilios, indice) {
  const lista = Array.isArray(domicilios) ? domicilios : [];
  const d = lista[Number(indice) || 0];
  return d && d.branch_code != null ? d.branch_code : null;
}
