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
  const data = await apiCall('GET', `/api/v3/sales/customers?search=${encodeURIComponent(query)}&limit=10`);
  return data.data || [];
}

export async function obtenerDomicilios(customerId) {
  const data = await apiCall('GET', `/api/v3/sales/customers/${customerId}`);
  const cliente = Array.isArray(data.data) ? data.data[0] : data;
  const branches = cliente?.branches || [];

  // Obtener detalle de cada branch (tiene dirección en case correcto)
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

  return results
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value);
}

export async function subirCotizacionOperam(data) {
  const c = data.cliente || {};
  const clientes = await buscarClientes(c.rfc || c.razonSocial || '');
  const clienteOperam = clientes.find(x =>
    (x.tax_id || '').toUpperCase() === (c.rfc || '').toUpperCase()
  ) || clientes[0];
  if (!clienteOperam) throw new Error('Cliente no encontrado en Operam');

  const payload = {
    customer_id: parseInt(clienteOperam.customer_id),
    branch_id: parseInt(clienteOperam.branches?.[0]?.branch_code || 1),
    payment: 9,
    OrderDate: data.fecha || new Date().toISOString().split('T')[0],
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
    comments: Array.isArray(data.notas) ? data.notas.join('. ') : '',
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

export function resetSession() { token = null; }
