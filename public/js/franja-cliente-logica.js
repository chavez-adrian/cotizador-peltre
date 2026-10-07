// Franja de a quien se cotiza (#480): entre el stepper y el contenido del paso,
// visible en los 4 pasos para que el vendedor que se distrajo no tenga que
// regresar al paso 1 a acordarse. Nucleo PURO: recibe la identidad como objeto
// plano y devuelve texto, nunca HTML (los nombres vienen de CSV de expo y van a
// innerHTML: el escape es del pintado en app.js).
import { customerIdFiscal, esRfcGenerico, nombreConCorto } from './alta-logica.js';
import { etiquetaFolioOperam } from './pipeline-logica.js';

export const TEXTO_SIN_SELECCION = 'Elige un Contacto o Cliente Operam';

// La identidad sale de lo MISMO que se guarda y se sube a Operam: el cliente
// elegido (pcState.cliente) y lo que devuelve leerClienteFormulario. "Hay
// Cliente Operam" lo decide customerIdFiscal, la fuente unica del chip Fiscal.
// Sin datos fiscales = RFC generico o sin RFC, la regla de
// lib/estado-cliente-operam.js. Una fila Operam pura no trae Contacto conocido:
// el Contacto solo sale cuando lo elegido es una persona (prospecto o nuevo).
export function identidadFranja(cliente, campos, folio) {
  if (!cliente) return null;
  const f = campos || {};
  const rfc = String(f.rfc || cliente.rfc || '').trim();
  const clienteOperam = customerIdFiscal(cliente) != null
    ? {
      nombreCorto: String(f.nombreCorto || '').trim(),
      nombre: String(f.razonSocial || '').trim(),
      sinDatosFiscales: !rfc || esRfcGenerico(rfc),
    }
    : null;
  const contacto = cliente.tipo === 'prospecto' || cliente.tipo === 'nuevo'
    ? { nombre: String(cliente.name || '').trim(), celular: String(cliente.telefono || '').trim() }
    : null;
  return { clienteOperam, contacto, folio: folio ?? null };
}

// -> { vacia, texto, partes: [{ etiqueta, valor }] }. Cada dato sale solo si
// existe; la parte sin etiqueta se pinta sola (el nombre de un Cliente Operam
// Sin datos fiscales no es razon social, GLOSSARY.md). El nombre corto igual al
// nombre no se repite: misma regla que nombreConCorto.
export function franjaCliente(identidad) {
  const i = identidad || {};
  const partes = [];
  const co = i.clienteOperam;
  if (co) {
    const nombre = String(co.nombre || '').trim();
    const corto = String(co.nombreCorto || '').trim();
    if (corto && (!nombre || nombreConCorto(nombre, corto) !== nombre)) {
      partes.push({ etiqueta: 'Nombre corto', valor: corto });
    }
    if (nombre) partes.push({ etiqueta: co.sinDatosFiscales ? '' : 'Raz\u00f3n social', valor: nombre });
  }
  const ct = i.contacto;
  if (ct) {
    const valor = [ct.nombre, ct.celular].map(v => String(v || '').trim()).filter(Boolean).join(' \u00b7 ');
    if (valor) partes.push({ etiqueta: 'Contacto', valor });
  }
  if (i.folio != null && i.folio !== '') partes.push({ etiqueta: '', valor: etiquetaFolioOperam({ folioOperam: i.folio }) });
  if (!partes.length) return { vacia: true, texto: TEXTO_SIN_SELECCION, partes: [] };
  return { vacia: false, texto: '', partes };
}
