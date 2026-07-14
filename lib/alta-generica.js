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

// Lista de precios del cliente generico = tier de la cotizacion mapeado por
// nombre al catalogo de Operam. Si el tier no tiene lista homonima (p.ej.
// "Menudeo", que no existe en Operam) cae a "Precio de lista": omitir sales_type
// delega el default de Operam (M550), el peor caso para un cliente de menudeo
// (issue #92).
export function resolverSalesTypeId(tier, listasPrecios) {
  const listas = Array.isArray(listasPrecios) ? listasPrecios : [];
  return listas.find(l => l.nombre === tier)?.id ?? listas.find(l => l.nombre === 'Precio de lista')?.id;
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
  if (c.emailFactura) cliente.invoice_email = c.emailFactura;
  if (salesman != null) cliente.salesman = salesman;
  if (salesTypeId != null) cliente.sales_type = salesTypeId;
  return cliente;
}

// Domicilio de entrega del paso Envio -> body del PUT de branch (issue #96). El
// paso Envio captura MENOS campos que el alta completa: no hay br_name/br_ref ni
// numero exterior separado (la calle carga calle+numero, como en el quote). Se
// mapea SOLO lo que /api/crear-cliente ya lleva al branch; br_name/br_ref se omiten
// para que Operam conserve el branch que auto-creo en el POST. addr_reference viene
// de `referencias` (indicaciones de entrega), NO de `referencia` (el cust_ref del
// quote). Sin calle o sin CP no hay domicilio util -> null: el caller omite el PUT
// (el cliente queda como hoy, sin domicilio, sin tumbar la subida). El customer_id
// y los quirks location/ship_via del PUT los pone actualizarBranchCliente.
export function buildBranchGenerico(cliente, { salesman } = {}) {
  const c = cliente || {};
  const calle = String(c.calle || '').trim();
  const cp = String(c.cpEntrega || '').trim();
  if (!calle || !cp) return null;
  const datos = {
    pais: c.pais || 'MX',
    addr_street: calle,
    addr_interior: c.numInt || '',
    addr_colony: c.colonia || '',
    addr_city: c.municipio || '',
    addr_state: c.estado || '',
    addr_zip: cp,
    addr_reference: c.referencias || '',
    phone: c.celEntrega || c.telefono || '',
    email: c.emailEntrega || '',
  };
  if (salesman != null) datos.salesman = salesman;
  return datos;
}

// Campos verificables del branch (label para el reporte). Se comparan tras el PUT.
const CAMPOS_BRANCH = [
  ['addr_street', 'Calle'], ['addr_interior', 'Numero interior'], ['addr_colony', 'Colonia'],
  ['addr_city', 'Municipio'], ['addr_state', 'Estado'], ['addr_zip', 'CP'],
  ['addr_reference', 'Referencias'], ['phone', 'Telefono'], ['email', 'Email'],
];

// Verificacion post-PUT (#96, quirk #74): Operam responde result:true aunque ignore
// campos. Compara el branch releido contra lo enviado y devuelve SOLO los que se
// intentaron escribir (no vacios) y no coinciden.
export function diffBranchDomicilio(branchFresco, enviado) {
  const b = branchFresco || {};
  const e = enviado || {};
  const out = [];
  for (const [campo, label] of CAMPOS_BRANCH) {
    const nuevo = String(e[campo] ?? '').trim();
    if (!nuevo) continue;
    if (String(b[campo] ?? '').trim() !== nuevo) {
      out.push({ campo, label, anterior: b[campo] ?? '', nuevo });
    }
  }
  return out;
}
