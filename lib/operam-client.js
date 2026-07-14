import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { RFC_GENERICOS } from './deduplicacion.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Rangos de CP "zona metro" para clasificar el flete (issue #68). Se lee al cargar
// el modulo (como otros data files); ajustable sin tocar codigo. Si falta o esta
// mal formado, queda en [] -> todo CP cae a foraneo (el default seguro).
let RANGOS_ZONA_METRO = [];
try {
  const z = JSON.parse(readFileSync(join(__dirname, '..', 'data', 'zona-metro.json'), 'utf8'));
  RANGOS_ZONA_METRO = z.rangos_local || [];
} catch { RANGOS_ZONA_METRO = []; }

// SKUs de flete de paqueteria en Operam (FedEx Ground). El carrier real (FedEx, DHL,
// UPS, Estafeta) va SOLO en stock_id_text; el stock_id es siempre uno de estos dos.
const FLETE_LOCAL = '251021001';   // FedEx Ground (zona metro)
const FLETE_FORANEO = '251021002'; // FedEx Ground Foraneo

let token = null;

async function getToken() {
  const r = await fetch(`${process.env.OPERAM_URL}/api/v3/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      company: '346',
      user: process.env.OPERAM_USER,
      pass: process.env.OPERAM_PASSWORD,
    }),
  });
  const data = await r.json();
  if (!data.token) throw new Error('Login Operam fallido');
  token = data.token;
}

async function apiCall(method, endpoint, body, isRetry = false) {
  if (!token) await getToken();
  const r = await fetch(`${process.env.OPERAM_URL}${endpoint}`, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401 && !isRetry) {
    token = null;
    await getToken();
    return apiCall(method, endpoint, body, true);
  }
  if (!r.ok) throw new Error(`Operam ${r.status}`);
  return r.json();
}

export async function buscarClientes(query, limit = 10) {
  try {
    const data = await apiCall('GET', `/api/v3/sales/customers?search=${encodeURIComponent(query)}&limit=${limit}`);
    return data.data || [];
  } catch (err) {
    // Operam responde 404 cuando la busqueda no tiene resultados (cliente nuevo):
    // no es un error sino una lista vacia. Evita el 503 al verificar duplicados.
    if (/Operam 404/.test(err.message)) return [];
    throw err;
  }
}

// Listado completo paginado. El listado trae inline contacts[] y branches[]
// (verificado contra produccion 2026-06-10) -- ~440 clientes en 5 requests.
export async function listarTodosClientes() {
  const limit = 100;
  let clientes = [];
  let total = Infinity;
  for (let skip = 0; skip < total; skip += limit) {
    const data = await apiCall('GET', `/api/v3/sales/customers?limit=${limit}&skip=${skip}`);
    total = data.total || 0;
    clientes = clientes.concat(data.data || []);
  }
  return clientes;
}

// Lecturas read-only para el sync post-venta (#62). Endpoints v3 confirmados
// contra el Postman de la API y en vivo (peltre-operam.md seccion 12). El mapeo
// de trans_type lo aplica lib/sync-operam.js (hechosDesdeOperam); aqui solo se
// leen las transacciones crudas.

// Transacciones de venta de un cliente (factura 10, nota credito 11, pago 12,
// remision 13, pedido 30...). GET /api/v3/sales/transactions. since_date y
// until_date son obligatorios en la API; el caller los provee (rango amplio).
export async function listarTransacciones({ rfc, customerId, filterType, desde, hasta, skip = 0, limit = 100 } = {}) {
  const qs = new URLSearchParams();
  qs.set('since_date', desde || '');
  qs.set('until_date', hasta || '');
  if (rfc) qs.set('customer_rfc', rfc);
  if (customerId != null) qs.set('customer_id', String(customerId));
  if (filterType != null && filterType !== '') qs.set('filterType', String(filterType));
  qs.set('skip', String(skip));
  qs.set('limit', String(limit));
  const data = await apiCall('GET', `/api/v3/sales/transactions?${qs.toString()}`);
  return data.data || [];
}

// Pedidos (Sales Orders, trans_type 30). GET /api/v3/sales/sales_orders. Cada
// pedido trae order_no (la llave de la cadena), debtor_no y total.
export async function listarPedidos({ debtorNo, desde, hasta, skip = 0, limit = 100 } = {}) {
  const qs = new URLSearchParams();
  if (debtorNo != null) qs.set('debtor_no', String(debtorNo));
  if (desde) qs.set('DateFrom', desde);
  if (hasta) qs.set('DateTo', hasta);
  qs.set('skip', String(skip));
  qs.set('limit', String(limit));
  const data = await apiCall('GET', `/api/v3/sales/sales_orders?${qs.toString()}`);
  return data.data || [];
}

export async function obtenerDomicilios(customerId) {
  const data = await apiCall('GET', `/api/v3/sales/customers/${customerId}`);
  const cliente = Array.isArray(data.data) ? data.data[0] : data;
  const branches = cliente?.branches || [];

  const results = await Promise.allSettled(
    branches.map(async (b) => {
      try {
        const bd = await apiCall('GET', `/api/v3/sales/branches/${b.branch_code}`);
        const d = bd.data?.[0] || {};
        return {
          descripcion: d.br_name || b.br_name || b.branch_ref || '',
          calle: [d.addr_street, d.addr_exterior].filter(Boolean).join(' Nº '),
          numInt: d.addr_interior || '',
          colonia: d.addr_colony || '',
          cp: d.addr_zip || '',
          municipio: d.addr_city || '',
          estado: d.addr_state || '',
          contacto: d.contact_name || b.contact_name || '',
          email: d.email || b.email || '',
          telefono: d.phone || b.phone || '',
        };
      } catch {
        return {
          descripcion: b.br_name || b.branch_ref || '',
          calle: '', numInt: '', colonia: '',
          cp: '', municipio: '', estado: '',
          contacto: b.contact_name || '', email: b.email || '', telefono: b.phone || '',
        };
      }
    })
  );

  return results.filter(r => r.status === 'fulfilled').map(r => r.value);
}

// Suma 'dias' naturales a una fecha YYYY-MM-DD y devuelve YYYY-MM-DD (UTC, sin
// arrastre de zona horaria).
function sumarDias(fechaISO, dias) {
  const base = fechaISO ? new Date(`${fechaISO}T00:00:00Z`) : new Date();
  base.setUTCDate(base.getUTCDate() + dias);
  return base.toISOString().split('T')[0];
}

// Clasifica un CP de entrega como zona metropolitana LOCAL (true) o foraneo
// (false) contra una lista de rangos inclusivos [desde, hasta] de CP de 5 digitos
// (issue #68). Comparacion lexicografica de strings de 5 digitos (equivale a la
// numerica porque todos tienen el mismo largo y solo digitos). CP ausente o no de
// 5 digitos -> foraneo por defecto (la decision segura: no asumir tarifa local).
export function esZonaMetroLocal(cp, rangos) {
  const s = String(cp ?? '').trim();
  if (!/^\d{5}$/.test(s)) return false;
  for (const [desde, hasta] of rangos || []) {
    if (s >= desde && s <= hasta) return true;
  }
  return false;
}

export async function subirCotizacionOperam(data) {
  const c = data.cliente || {};

  // 1) Identificar el cliente correcto, NUNCA al azar (issue #68):
  //    (a) si la cotizacion ya trae el id del cliente en Operam, usarlo directo;
  //    (b) si no, resolver por RFC EXACTO con buscarClientePorRFC;
  //    (c) si no hay id ni match unico por RFC -> error claro y NO subir.
  //    Se elimino el fallback `|| clientes[0]` que subio la cot 1157 al cliente
  //    equivocado (Utilitario Mexicano). Mejor fallar que asociar mal.
  let customerId = c.customerId ?? c.operamId ?? null;
  let branchId = c.branchId ?? c.branch_id ?? null;
  if (customerId == null) {
    const rfc = (c.rfc || '').trim();
    if (!rfc) {
      throw new Error('No se pudo identificar el cliente en Operam: la cotizacion no tiene RFC. Verifica el RFC del cliente.');
    }
    const encontrado = await buscarClientePorRFC(rfc);
    if (!encontrado.encontrado) {
      throw new Error(`No se pudo identificar el cliente en Operam por el RFC ${rfc}. Verifica el RFC o da de alta el cliente antes de subir.`);
    }
    customerId = encontrado.cliente_id;
    if (branchId == null) branchId = encontrado.branch_code ?? null;
  }

  // Vigencia / "valido hasta": la cotizacion trae data.vigencia (= fecha + 30 dias
  // calculado en el frontend). Si no viene, se deriva como OrderDate + 30 dias.
  const orderDate = data.fecha || new Date().toISOString().split('T')[0];
  const vigencia = data.vigencia || sumarDias(orderDate, 30);

  // El envio (codigo ENVIO) se vuelve una PARTIDA nativa del quote con el SKU de flete
  // de paqueteria que corresponde a la zona del CP de ENTREGA (issue #68): local ->
  // FedEx Ground (251021001), foraneo -> FedEx Ground Foraneo (251021002). El carrier
  // real va SOLO en stock_id_text; el stock_id es siempre uno de esos dos. La clasif.
  // local/foraneo usa esZonaMetroLocal(cpEntrega); si el CP falta o es invalido, esa
  // funcion devuelve false y el envio cae a foraneo (default seguro, documentado ahi).
  // Excepcion: Lalamove se difiere a #72 (se factura por tamano de vehiculo, dato que
  // el cotizador no captura) -> NO se mapea a partida, queda en comments como hoy.
  const esLalamove = (e) => /lalamove/i.test(e.descripcion || '');
  const enviosPaqueteria = (data.items || []).filter(i => i.codigo === 'ENVIO' && !esLalamove(i));
  const enviosLalamove = (data.items || []).filter(i => i.codigo === 'ENVIO' && esLalamove(i));
  const stockFlete = esZonaMetroLocal(c.cpEntrega, RANGOS_ZONA_METRO) ? FLETE_LOCAL : FLETE_FORANEO;

  // La vigencia ("Valido hasta") se entrega en comments: la API del quote NO permite
  // setearla. Probado en vivo (HITL #68, quotes 1160-1163): el POST ignora valid_until,
  // delivery_date, valid_days y 7 nombres mas, y deja delivery_date (el campo nativo
  // "Valido hasta") en ord_date-1; tampoco hay PUT de quotes (501). Por eso la UI muestra
  // una fecha incorrecta en quotes creados por API y comments es el unico carrier correcto.
  const partes = [];
  if (Array.isArray(data.notas) && data.notas.length) partes.push(data.notas.join('. '));
  partes.push(`Valido hasta: ${vigencia}`);
  for (const e of enviosLalamove) {
    partes.push(`Envio: ${e.descripcion || 'Envio'} $${e.precio}`);
  }
  const comments = partes.filter(Boolean).join('. ');

  const itemsNormales = (data.items || [])
    .filter(i => i.codigo !== 'ENVIO')
    .map(i => ({
      stock_id: i.codigo,
      stock_id_text: i.descripcion,
      qty: i.cantidad,
      price: i.precio,
      Disc: i.descuento || 0,
    }));
  const itemsFlete = enviosPaqueteria.map(e => ({
    stock_id: stockFlete,
    stock_id_text: e.descripcion || 'Envio',
    qty: 1,
    price: e.precio,
    Disc: 0,
  }));

  const payload = {
    customer_id: parseInt(customerId),
    branch_id: parseInt(branchId || 1),
    payment: 9,
    OrderDate: orderDate,
    deliver_to: c.nombreEntrega || c.razonSocial || '',
    delivery_address: [c.calle, c.colonia, c.cpEntrega, c.municipio, c.estado].filter(Boolean).join(', '),
    items: [...itemsNormales, ...itemsFlete],
    comments,
    cust_ref: c.referencia || '',
  };

  const result = await apiCall('POST', '/api/v3/sales/quote', payload);
  if (!result.result) throw new Error(result.messages?.join(', ') || 'Error Operam');
  // El folio del quote viene en added_trans_no (verificado en vivo, quote 1160, #68);
  // quote_id/factura_no NO existen en la respuesta. server.js lo persiste con
  // setFolioOperam (#63), asi que devolver undefined dejaba la cotizacion como
  // pre-cotizacion para siempre.
  return result.added_trans_no ?? result.quote_id ?? result.factura_no;
}

export async function actualizarCliente(id, diff) {
  const body = {};
  for (const [fieldId, { nuevo }] of Object.entries(diff)) {
    body[fieldId] = nuevo;
  }
  const result = await apiCall('PUT', `/api/v3/sales/customers/${id}`, body);
  if (result.result === false) {
    throw new Error((result.messages || []).join(', ') || 'Error al actualizar cliente en Operam');
  }
  return result;
}

export async function actualizarClienteDirecto(id, campos) {
  const result = await apiCall('PUT', `/api/v3/sales/customers/${id}`, campos);
  if (result.result === false) {
    throw new Error((result.messages || []).join(', ') || 'Error al actualizar cliente en Operam');
  }
  return result;
}

const DEFAULTS = {
  cfdi_form_payment: '99',
  cfdi_method_payment: 'PPD',
  timbrado_uso_cfdi: 'S01',
  payment_terms: 9,
  location: '40',
  dimension_id: 1,
  dimension2_id: 5,
  credit_limit: 0,
  discount: 0,
  pymt_discount: 0,
};

const AREA_POR_PAIS = { MX: 1, US: 5, CA: 7 };

function derivarArea(pais) {
  if (!pais || pais === 'MX') return 1;
  return AREA_POR_PAIS[pais] || 6;
}

export function buildClienteBody(cliente) {
  const CustName = cliente.CustName || '';
  const cust_ref = cliente.cust_ref || CustName.toLowerCase().replace(/\b\w/g, l => l.toUpperCase());
  const taxIdPrefix = cliente.invoice_tax_id ? `Tax ID: ${cliente.invoice_tax_id}\n` : '';
  const invoiceEmailLine = cliente.invoice_email ? `Email de facturacion: ${cliente.invoice_email}\n` : '';
  const celularLine = cliente.celular_nota ? `Celular: ${cliente.celular_nota}\n` : '';
  const notes = `${taxIdPrefix}${invoiceEmailLine}${celularLine}Actividades economicas (CSF ${cliente.csf_fecha || ''}):\n` +
    (cliente.actividades || []).map(a => `- ${a}`).join('\n');
  const area = derivarArea(cliente.pais || cliente.area_pais);
  return {
    cust_name: CustName,
    cust_ref,
    tax_id: cliente.tax_id,
    idcif: cliente.idcif || '',
    street: cliente.street || '',
    street_number: cliente.street_number || '',
    suite_number: cliente.suite_number || '',
    district: cliente.district || '',
    postal_code: cliente.postal_code || '',
    city: cliente.city || '',
    state: cliente.state || '',
    country: cliente.country || 'Mexico',
    phone: cliente.phone || null,
    email: cliente.email || null,
    cfdi_regimen_fiscal: cliente.cfdi_regimen_fiscal || '612',
    timbrado_uso_cfdi: cliente.timbrado_uso_cfdi || DEFAULTS.timbrado_uso_cfdi,
    sales_type: cliente.sales_type,
    segmento_id: cliente.segmento_id,
    salesman: cliente.salesman,
    notes,
    cfdi_form_payment: DEFAULTS.cfdi_form_payment,
    cfdi_method_payment: DEFAULTS.cfdi_method_payment,
    payment_terms: DEFAULTS.payment_terms,
    location: DEFAULTS.location,
    area,
    curr_code: cliente.curr_code || 'MXN',
    dimension_id: DEFAULTS.dimension_id,
    dimension2_id: DEFAULTS.dimension2_id,
    credit_limit: DEFAULTS.credit_limit,
    discount: DEFAULTS.discount,
    pymt_discount: DEFAULTS.pymt_discount,
  };
}

// Relectura de verificacion post-PUT (#85): devuelve el cliente crudo de Operam
// (CustName/tax_id/street/...) para comparar con calcularDiffFiscal y detectar el
// quirk del PUT 200 que ignora campos en silencio.
export async function obtenerClientePorId(customerId) {
  const data = await apiCall('GET', `/api/v3/sales/customers/${customerId}`);
  return Array.isArray(data.data) ? data.data[0] : data;
}

export async function obtenerBranchId(customerId) {
  const data = await apiCall('GET', `/api/v3/sales/customers/${customerId}`);
  const cliente = Array.isArray(data.data) ? data.data[0] : data;
  const branchCode = cliente?.branches?.[0]?.branch_code;
  if (!branchCode) throw new Error('No se encontro branch_code para el cliente');
  return branchCode;
}

// Lee un branch por su branch_code para la verificacion post-PUT (#96). Devuelve
// el registro crudo (addr_street, addr_zip...) o null si Operam no lo entrega.
export async function obtenerBranch(branchCode) {
  const data = await apiCall('GET', `/api/v3/sales/branches/${branchCode}`);
  return data.data?.[0] || null;
}

export async function actualizarBranchCliente(customerId, branchId, datos) {
  let resolvedBranchId = branchId;
  if (!resolvedBranchId) {
    resolvedBranchId = await obtenerBranchId(customerId);
  }
  const esMX = !datos.pais || datos.pais === 'MX';
  const area = derivarArea(datos.pais);
  const body = {
    customer_id: customerId,
    br_name: datos.br_name,
    br_ref: datos.br_ref,
    tax_group_id: esMX ? 1 : 2,
    location: 40,
    ship_via: 1,
    area,
    salesman: datos.salesman,
    addr_street: datos.addr_street || '',
    addr_exterior: datos.addr_exterior || '',
    addr_interior: datos.addr_interior || '',
    addr_colony: datos.addr_colony || '',
    addr_city: datos.addr_city || '',
    addr_state: datos.addr_state || '',
    addr_zip: datos.addr_zip || '',
    addr_reference: datos.addr_reference || '',
    phone: datos.phone || '',
    email: datos.email || '',
  };
  const result = await apiCall('PUT', `/api/v3/sales/branches/${resolvedBranchId}`, body);
  if (result.result === false) {
    throw new Error((result.messages || []).join(', ') || 'Error al actualizar branch en Operam');
  }
  return { branch_id: resolvedBranchId, result };
}

// POST /customers SIN la dedup por RFC exacto de crearCliente: con un RFC generico
// (XAXX/XEXX) esa dedup matchearia contra CUALQUIER generico existente y devolveria
// el cliente equivocado. La dedup correcta para genericos es por nombre (ADR-0001)
// y corre en el caller (alta generica de #81).
export async function crearClienteDirecto(cliente) {
  const body = buildClienteBody(cliente);
  const result = await apiCall('POST', '/api/v3/sales/customers', body);
  if (!result.result) throw new Error((result.messages || []).join(', ') || 'Error al crear cliente en Operam');
  return { cliente_id: result.customer_id, nombre: cliente.CustName };
}

export async function crearCliente(cliente) {
  // Con RFC generico (XAXX/XEXX) NO se deduplica por RFC exacto: el lookup
  // devolveria CUALQUIER generico existente (multiples clientes lo comparten) y
  // el alta reportaria duplicado contra el cliente equivocado. La dedup correcta
  // para genericos es por nombre (ADR-0001), que el flujo del alta ya corre via
  // /api/buscar-cliente-duplicado.
  const rfc = String(cliente.tax_id || '').toUpperCase().trim();
  if (!RFC_GENERICOS.has(rfc)) {
    const existente = await buscarClientePorRFC(cliente.tax_id);
    if (existente.encontrado) {
      return { duplicado: true, cliente_id: existente.cliente_id, nombre: existente.CustName, ...existente };
    }
  }
  return { duplicado: false, ...(await crearClienteDirecto(cliente)) };
}

export async function buscarClientePorRFC(rfc) {
  let data;
  try {
    data = await apiCall('GET', `/api/v3/sales/customers?tax_id=${encodeURIComponent(rfc)}`);
  } catch (err) {
    // 404 = RFC inexistente (sin resultados): no es error, es "no encontrado".
    if (/Operam 404/.test(err.message)) return { encontrado: false };
    throw err;
  }
  if (!data.total || data.total === 0) return { encontrado: false };
  const c = data.data[0];
  const branch = c.branches?.[0] || {};
  return {
    encontrado: true,
    cliente_id: c.customer_id,
    branch_code: branch.branch_code,
    CustName: c.CustName,
    tax_id: c.tax_id,
    street: c.street,
    street_number: c.street_number,
    suite_number: c.suite_number,
    district: c.district,
    postal_code: c.postal_code,
    city: c.city,
    state: c.state,
    cfdi_regimen_fiscal: c.cfdi_regimen_fiscal,
    branch: {
      br_name: branch.br_name,
      addr_street: branch.addr_street,
      addr_colony: branch.addr_colony,
      addr_zip: branch.addr_zip,
      addr_city: branch.addr_city,
      addr_state: branch.addr_state,
      phone: branch.phone,
      email: branch.email,
    },
  };
}

export function resetSession() { token = null; }
