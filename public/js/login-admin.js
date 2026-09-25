// Login de administrador (#440, #449): EL unico camino por el que entran los
// paneles /admin y /admin/catalogo (antes cada uno traia su copia y la del
// Maestro de articulos seguia fija en el vendedor 1). El selector "Administrador" usa la misma
// lista publica del login de / (GET /api/vendedores, solo id y nombre) y el login
// manda `soloAdmin: true`: quien decide si el elegido es admin es POST /api/login,
// que al no-admin le responde lo MISMO que a un PIN equivocado. El navegador
// ademas descarta cualquier respuesta cuyo rol no sea admin (defensa extra), pero
// la regla que cuenta, y la que lleva el limite de intentos, es la del servidor.

export const MENSAJE_LOGIN_ADMIN = 'PIN incorrecto o no es administrador';

// -> { token, user } o { error }. `vendedorId` puede llegar como texto (el value
// del <select>); el servidor compara el id numerico.
export async function entrarComoAdmin(fetchFn, vendedorId, pin) {
  const res = await fetchFn('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vendedorId: parseInt(vendedorId, 10), pin, soloAdmin: true }),
  });
  const data = await res.json();
  if (!res.ok || data.user?.role !== 'admin') return { error: MENSAJE_LOGIN_ADMIN };
  return { token: data.token, user: data.user };
}

// Opciones del selector "Administrador": todo el registro publico, sin marcar
// quien es admin. Sin red o con error, lista vacia (no hay login).
export async function vendedoresLoginAdmin(fetchFn) {
  try {
    const res = await fetchFn('/api/vendedores');
    if (!res.ok) return [];
    return (await res.json()).map(v => ({ id: v.id, name: v.name }));
  } catch (e) {
    return [];
  }
}

// Monta el login sobre los ids que comparten los dos paneles (admin-login,
// admin-vendedor, admin-pin, admin-error, admin-login-btn, admin-app) y llama a
// `alEntrar(token)` cuando el administrador elegido entra.
export async function montarLoginAdmin(alEntrar) {
  const $ = id => document.getElementById(id);
  const entrar = async () => {
    const errEl = $('admin-error');
    errEl.style.display = 'none';
    const r = await entrarComoAdmin(fetch, $('admin-vendedor').value, $('admin-pin').value);
    if (r.error) {
      errEl.textContent = r.error;
      errEl.style.display = 'block';
      return;
    }
    $('admin-login').style.display = 'none';
    $('admin-app').style.display = 'block';
    alEntrar(r.token);
  };
  $('admin-login-btn').addEventListener('click', entrar);
  $('admin-pin').addEventListener('keydown', e => { if (e.key === 'Enter') entrar(); });
  const vendedores = await vendedoresLoginAdmin(fetch);
  $('admin-vendedor').replaceChildren(...vendedores.map(v => new Option(v.name, v.id)));
}
