import { ultimos10 } from './telefono-llave.js';

// La casilla que la web de Operam etiqueta "Cel" viaja en la API como `fax`
// (ADR-0016, CONTEXT.md "Contacto en Operam"). Es donde el equipo busca el celular
// en la web, asi que el alta lo escribe ahi ademas de donde ya lo escribia (#339).
// Nucleo PURO sin IO: lo comparten el alta generica y el alta completa.
export const CAMPO_CEL = 'fax';

// Comparacion por los ultimos 10 digitos y no por texto exacto: es la MISMA llave
// de identidad de un Contacto (telefono-llave.js) y evita reportar como "no
// aplicado" un celular que SI quedo escrito y que Operam devuelve con otro formato
// (los contactos reales del padron traen "+52 55 3466 7682" donde se mando
// "5534667682"). Sin celular enviado no hay nada con que comparar.
function celCoincide(leido, enviado) {
  const esperado = ultimos10(enviado);
  return esperado !== '' && ultimos10(leido) === esperado;
}

// Verificacion post-escritura del Cel (#339). Operam responde 200 sin garantizar
// nada (#74), asi que el alta relee y compara. El unico lector de `fax` es
// `GET /customers/:id`: trae `contacts[]` (el Contacto en Operam auto-generado por
// el POST) y `branches[]` (la sucursal) en una sola llamada -- el
// `GET /branches/:code` NO expone la llave.
//
// Devuelve los campos que NO quedaron escritos como {campo, label, nuevo}, un
// SUBCONJUNTO del contrato de `camposNoAplicados` (upgrade fiscal) y
// `diffBranchDomicilio` (domicilio del branch): sin `anterior`, porque el Cel que
// falta no tiene un valor previo unico que mostrar -- un cliente puede traer varios
// Contactos en Operam y ninguno es "el" anterior. El alta los reporta en sus pasos
// sin cambiar su codigo de exito. Un celular que no se envio no se verifica.
export function celsNoAplicados(clienteFresco, { celCliente, celBranch, branchId } = {}) {
  const c = clienteFresco || {};
  const out = [];
  if (celCliente) {
    const contactos = Array.isArray(c.contacts) ? c.contacts : [];
    if (!contactos.some(ct => celCoincide(ct && ct[CAMPO_CEL], celCliente))) {
      out.push({ campo: CAMPO_CEL, label: 'Cel del contacto', nuevo: celCliente });
    }
  }
  if (celBranch) {
    const branches = Array.isArray(c.branches) ? c.branches : [];
    const branch = branches.find(b => b && String(b.branch_code) === String(branchId));
    if (!celCoincide(branch && branch[CAMPO_CEL], celBranch)) {
      out.push({ campo: CAMPO_CEL, label: 'Cel de la sucursal', nuevo: celBranch });
    }
  }
  return out;
}
