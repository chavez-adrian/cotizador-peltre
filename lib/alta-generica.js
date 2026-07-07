import { RFC_GENERICOS } from './deduplicacion.js';

// Logica pura del alta temprana de cliente generico (issue #81, ADR-0006): decide
// cuando una cotizacion pertenece a una oportunidad SIN cliente en Operam y
// construye el payload del cliente generico. Sin IO; la orquestacion (dedup en
// capas, POST a Operam, persistencia, subida) vive en server.js
// (POST /api/cotizacion/operam/:id).

// Fuente distinguible en clientes_log para el alta generica automatica (las del
// alta manual son 'csf-upload' / 'cotizador').
export const FUENTE_ALTA_GENERICA = 'cotizador-generico';

export function rfcGenericoPara(pais) {
  return !pais || pais === 'MX' ? 'XAXX010101000' : 'XEXX010101000';
}

// Sin cliente en Operam = sin id de cliente y sin RFC real resoluble. Un RFC
// generico capturado NO identifica (multiples clientes lo comparten, ADR-0001):
// resolverlo por RFC exacto subiria la cotizacion a cualquier generico existente.
// Ademas exige los datos minimos del contacto: sin nombre resoluble no hay con
// que crear ni deduplicar por nombre (tokens vacios siempre dan 'libre') y sin
// telefono no hay llave de dedup de capa 1 (celular) -- una cotizacion legacy sin
// esos datos toma el camino viejo, que responde su 422 claro sin efectos, en vez
// de crear un cliente fantasma.
export function necesitaAltaGenerica(entry) {
  const e = entry || {};
  const c = e.data?.cliente || {};
  if (c.customerId != null || c.operamId != null) return false;
  const rfc = String(c.rfc || '').toUpperCase().trim();
  if (rfc && !RFC_GENERICOS.has(rfc)) return false;
  const nombre = String(c.razonSocial || c.nombreCorto || e.cliente || '').trim();
  const telefono = String(c.telefono || '').trim();
  return nombre !== '' && telefono !== '';
}

// Payload para crearClienteDirecto: nombre real del contacto y vendedor real
// (ADR-0006); lista de precios = tier de la cotizacion mapeado al id numerico de
// Operam (la lista con la que se cotizo). El resto de defaults (uso CFDI S01,
// regimen 612, terminos de pago...) los aplica buildClienteBody, los mismos del
// alta actual. celular_nota lleva el celular a notes, como en el alta manual.
export function buildClienteGenerico(entry, { salesman, salesTypeId } = {}) {
  const c = entry.data?.cliente || {};
  const cliente = {
    tax_id: rfcGenericoPara(c.pais),
    CustName: c.razonSocial || c.nombreCorto || entry.cliente || '',
    pais: c.pais || 'MX',
    celular_nota: c.telefono || '',
  };
  if (c.nombreCorto) cliente.cust_ref = c.nombreCorto;
  if (c.telefono) cliente.phone = c.telefono;
  if (c.emailEntrega) cliente.email = c.emailEntrega;
  if (salesman != null) cliente.salesman = salesman;
  if (salesTypeId != null) cliente.sales_type = salesTypeId;
  return cliente;
}
