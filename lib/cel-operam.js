import { ultimos10 } from './telefono-llave.js';
import { contactosDeClienteOperam } from './contactos-operam-logica.js';

// La casilla que la web de Operam etiqueta "Cel" viaja en la API como `fax`
// (ADR-0016, GLOSSARY.md "Contacto en Operam"). Es donde el equipo busca el celular
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
//
// Las personas del cliente releido y el General aplanado de su domicilio los lee el
// modulo Contactos en Operam (#560); aqui solo se compara su Cel.
export function celsNoAplicados(clienteFresco, { celCliente, celBranch, branchId } = {}) {
  const { cliente: personas, generales } = contactosDeClienteOperam(clienteFresco || {});
  const out = [];
  if (celCliente) {
    if (!personas.some(p => celCoincide(p.casillas.cel, celCliente))) {
      out.push({ campo: CAMPO_CEL, label: 'Cel del contacto', nuevo: celCliente });
    }
  }
  if (celBranch) {
    const general = generales.find(g => g.branchCode !== '' && g.branchCode === String(branchId));
    if (!celCoincide(general?.casillas.cel, celBranch)) {
      out.push({ campo: CAMPO_CEL, label: 'Cel del domicilio de entrega', nuevo: celBranch });
    }
  }
  return out;
}
