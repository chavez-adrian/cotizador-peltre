// Ficha de cliente de la web legacy de Operam (FrontAccounting) montada para los tests
// del post-fix del SEGMENTO. Nacio dentro de server.test.js con #172 (upgrade fiscal) y
// vive aparte desde #186, que conecta el mismo post-fix al alta generica (suite
// test/operam-generico.test.js) y al alta completa: copiarla las dejaria divergir justo
// en las trampas que reproduce.
//
// Lo que el mock imita a proposito (verificado en vivo en #172, cliente 492):
//   - un <form> de metadatos ANIDADO (HTML invalido) con el `_token` del CSRF DESPUES de
//     el: un recorte que corte en el primer </form> pierde el token;
//   - el boton destructivo `delete` en el MISMO formulario que el submit real, y un throw
//     si llegara a viajar en el POST;
//   - el rechazo de FA (`err`): 200 con la pagina re-renderizada, ningun campo aplicado y
//     un msgbox de clase err_msg como unica senal;
//   - la sesion caducada (`sesionCaducada`): el form de login devuelto con status 200.
//
// La ficha responde con el debtor_no que se le pidio, para que cada suite use los
// customer_id que le convengan sin parametrizar nada.
export function handlersWebFichaCliente({ err = null, sesionCaducada = false, noAplica = false } = {}) {
  const estado = { segmento: '1', customerId: '500' };
  const posts = [];
  const gets = [];
  const ficha = () => `<form method='post' action='/sales/manage/customers.php'>
<input type="hidden" name="customer_id" value='${estado.customerId}'>
<input type="text" name="CustName" value="Real SA de CV">
<input type="text" name="postal_code" value="06600">
<select name='segmento_id'>${['1', '3', '14'].map(v => `<option value='${v}'${v === estado.segmento ? ' selected' : ''}>seg ${v}</option>`).join('')}</select>
<form method='post' action='/sales/manage/customers.php'><input type="hidden" name="meta_value_new" value=''></form>
<input type="hidden" name="_token" value='TOK'>
<button type='submit' name='process' value='Actualizar Cliente'></button>
<button type='submit' name='delete' value='Eliminar Cliente'></button>
</form>`;
  const handlers = {
    'trans_type=30': () => ({ headers: {}, text: async () => '<html>login ok</html>' }),
    '/sales/manage/customers.php': (u, opts) => {
      if (opts?.method !== 'POST') {
        const pedido = String(u).match(/debtor_no=(\d+)/);
        gets.push(pedido ? pedido[1] : null);
        if (pedido) estado.customerId = pedido[1];
        return { headers: {}, text: async () => ficha() };
      }
      const p = new URLSearchParams(opts.body || '');
      posts.push(p);
      if (p.has('delete')) throw new Error('JAMAS debe mandarse el boton delete de la ficha de cliente');
      if (sesionCaducada) return { headers: {}, text: async () => '<input name="user_name_entry_field"><input type="password" name="password">' };
      if (err) return { headers: {}, text: async () => `<div id='msgbox'><div class="err_msg">${err}</div></div>${ficha()}` };
      if (!noAplica) estado.segmento = p.get('segmento_id');
      return { headers: {}, text: async () => ficha() };
    },
  };
  return { handlers, posts, gets, estado };
}
