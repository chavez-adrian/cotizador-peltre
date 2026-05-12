let sessionCookie = null;

export function resetSession() {
  sessionCookie = null;
}

async function login() {
  const url = process.env.OPERAM_URL;
  const initRes = await fetch(url, { redirect: 'follow' });
  const initCookie = initRes.headers.get('set-cookie')?.split(';')[0] || '';

  const loginRes = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': initCookie,
    },
    body: new URLSearchParams({
      user_name_entry_field: process.env.OPERAM_USER,
      password: process.env.OPERAM_PASSWORD,
      'Login': 'Login',
    }),
    redirect: 'manual',
  });

  const cookie = loginRes.headers.get('set-cookie')?.split(';')[0]
    || initRes.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('Login a Operam fallido: no se obtuvo cookie');
  sessionCookie = cookie;
}

async function ensureSession() {
  if (!sessionCookie) { await login(); return; }
  const testRes = await fetch(
    `${process.env.OPERAM_URL}/sales/inquiry/customers.ajax.php?inactive=false&term=test`,
    { headers: { Cookie: sessionCookie } }
  );
  if (testRes.status === 401 || testRes.redirected) {
    sessionCookie = null;
    await login();
  }
}

export async function buscarClientes(query) {
  await ensureSession();
  const url = `${process.env.OPERAM_URL}/sales/inquiry/customers.ajax.php?inactive=false&term=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { Cookie: sessionCookie } });
  if (!res.ok) throw new Error(`Operam ${res.status}`);
  return res.json();
}

export async function obtenerDomicilios(clienteId) {
  await ensureSession();
  const res = await fetch(`${process.env.OPERAM_URL}/sales/manage/customers.php`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': sessionCookie,
    },
    body: new URLSearchParams({
      customer_id: clienteId,
      '_customer_id_update': ' ',
    }),
  });
  const html = await res.text();
  return extraerDomicilios(html);
}

function extraerDomicilios(html) {
  const matches = [];
  const regex = /delivery_address[^>]*>([^<]+)/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    matches.push({ descripcion: m[1].trim() });
  }
  return matches;
}

export async function subirCotizacionOperam(data) {
  await ensureSession();
  const url = process.env.OPERAM_URL;
  const c = data.cliente || {};
  const items = data.items || [];

  const clientes = await buscarClientes(c.rfc || c.razonSocial || '');
  const clienteOperam = clientes.find(x =>
    (x.rfc || '').toUpperCase() === (c.rfc || '').toUpperCase()
  ) || clientes[0];

  if (!clienteOperam) throw new Error('Cliente no encontrado en Operam');

  const payload = new URLSearchParams({
    customer_id: clienteOperam.id || clienteOperam.debtorno,
    process: 'Añadir Cotización',
  });

  items.forEach((item, i) => {
    payload.append(`Lines[${i}][stockid]`, item.codigo);
    payload.append(`Lines[${i}][quantity]`, item.cantidad);
    payload.append(`Lines[${i}][price]`, item.precio);
  });

  // Endpoint real de Operam para cotizaciones: saleshdr.php (pendiente de verificar)
  const salesRes = await fetch(`${url}/sales/manage/saleshdr.php`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': sessionCookie,
    },
    body: payload,
  });

  if (!salesRes.ok) throw new Error(`Operam ${salesRes.status}`);

  const responseText = await salesRes.text();
  const folioMatch = responseText.match(/(?:cotizaci[oó]n|orden|folio)[^\d]*(\d+)/i);
  return folioMatch ? folioMatch[1] : 'creada';
}
