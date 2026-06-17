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

export async function buscarClientes(query) {
  try {
    const data = await apiCall('GET', `/api/v3/sales/customers?search=${encodeURIComponent(query)}&limit=10`);
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

  // La linea de envio (codigo ENVIO) y la vigencia se anexan a comments porque el
  // quote v3 (POST /api/v3/sales/quote, "misma estructura que pedido") NO expone un
  // campo de "valido hasta" ni un stock_id de flete canonico (hay varios SKUs de
  // flete en Operam: FLETELOCALCDMX, 250911001 Envio Foraneo, 251021001 FedEx...,
  // y elegir cual es decision de dominio del dueno). Anexarlas a comments evita
  // perder la informacion sin inventar un SKU ni un campo de API inexistente.
  const envios = (data.items || []).filter(i => i.codigo === 'ENVIO');
  const partes = [];
  if (Array.isArray(data.notas) && data.notas.length) partes.push(data.notas.join('. '));
  partes.push(`Valido hasta: ${vigencia}`);
  for (const e of envios) {
    partes.push(`Envio: ${e.descripcion || 'Envio'} $${e.precio}`);
  }
  const comments = partes.filter(Boolean).join('. ');

  const payload = {
    customer_id: parseInt(customerId),
    branch_id: parseInt(branchId || 1),
    payment: 9,
    OrderDate: orderDate,
    valid_until: vigencia,
    deliver_to: c.nombreEntrega || c.razonSocial || '',
    delivery_address: [c.calle, c.colonia, c.cpEntrega, c.municipio, c.estado].filter(Boolean).join(', '),
    items: (data.items || [])
      .filter(i => i.codigo !== 'ENVIO')
      .map(i => ({
        stock_id: i.codigo,
        stock_id_text: i.descripcion,
        qty: i.cantidad,
        price: i.precio,
        Disc: i.descuento || 0,
      })),
    comments,
    cust_ref: c.referencia || '',
  };

  const result = await apiCall('POST', '/api/v3/sales/quote', payload);
  if (!result.result) throw new Error(result.messages?.join(', ') || 'Error Operam');
  return result.quote_id || result.factura_no;
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

export async function obtenerBranchId(customerId) {
  const data = await apiCall('GET', `/api/v3/sales/customers/${customerId}`);
  const cliente = Array.isArray(data.data) ? data.data[0] : data;
  const branchCode = cliente?.branches?.[0]?.branch_code;
  if (!branchCode) throw new Error('No se encontro branch_code para el cliente');
  return branchCode;
}

export async function actualizarBranchCliente(customerId, branchId, datos) {
  let resolvedBranchId = branchId;
  if (!resolvedBranchId) {
    resolvedBranchId = await obtenerBranchId(customerId);
  }
  const esMX = !datos.pais || datos.pais === 'MX';
  const area = derivarArea(datos.pais);
  const body = {
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

export async function crearCliente(cliente) {
  const existente = await buscarClientePorRFC(cliente.tax_id);
  if (existente.encontrado) {
    return { duplicado: true, cliente_id: existente.cliente_id, nombre: existente.CustName, ...existente };
  }
  const body = buildClienteBody(cliente);
  const result = await apiCall('POST', '/api/v3/sales/customers', body);
  if (!result.result) throw new Error((result.messages || []).join(', ') || 'Error al crear cliente en Operam');
  return { duplicado: false, cliente_id: result.customer_id, nombre: cliente.CustName };
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
