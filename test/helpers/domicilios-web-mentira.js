// La web legacy DE MENTIRAS de la pagina de domicilios de un Cliente Operam
// (/sales/manage/customer_branches.php) para las pruebas del adaptador real del modulo
// Contactos en Operam (#561, #562): sirve las paginas REALES medidas el 2026-10-09 sobre
// el Cliente Operam 15, domicilio 564 (recortadas y en ASCII:
// test/fixtures/operam-domicilios-*.html) y responde segun el boton que trae el body,
// como FrontAccounting. Se instala como globalThis.fetch (--test-concurrency=1).
//
// Como la web real, lo que devuelve una escritura YA es la pestana Contactos releida:
// la persona agregada (contactsADD) aparece en la tabla con sus Asignaciones, y la
// editada (contactsUPDATE) con las suyas (assgn[] es REPLACE) y, en su formulario de
// editar, con las Notas que se mandaron. `estado.pedidos` registra cada peticion.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
export const pagina = (n) => readFileSync(join(DIR, n), 'utf8');
export const LISTA = pagina('operam-domicilios-15.html');
export const GENERAL_564 = pagina('operam-domicilios-564-general.html');
export const CONTACTOS_564 = pagina('operam-domicilios-564-contactos.html');
export const NUEVO_564 = pagina('operam-domicilios-564-contacto-nuevo.html');
export const ROLES_564 = pagina('operam-domicilios-564-contactos-roles.html');
// #562: la tabla con un General (1289, medido) y su formulario de EDITAR, el unico que
// trae las Notas y los roles marcados en assgn[].
export const CONTACTOS_GENERAL_564 = pagina('operam-domicilios-564-contactos-general.html');
export const EDITAR_1289 = pagina('operam-domicilios-564-editar-contacto.html');

const ETIQUETA_ROL = { 1: 'General', 2: 'Invoices', 3: 'Orders', 4: 'Deliveries' };

export function webDeMentiras({ despuesDeEditar = GENERAL_564, errorAlAgregar = null, tabla = CONTACTOS_564, errorAlActualizar = null } = {}) {
  const estado = { pedidos: [], agregadas: [], editadas: [] };
  // Lo que la web pinta tras actualizar a una persona: sus Asignaciones son las del
  // assgn[] que llego (REPLACE) y sus casillas (#563) las que llegaron: Telefono,
  // Telefono Secundario, Cel y email son las columnas 4 a 7 de la tabla. El nombre
  // completo (columna 3) es el nombre y el apellido que llegaron (#566).
  const CELDAS_CASILLAS = { 2: 'nombre', 3: 'phone', 4: 'phone2', 5: 'fax', 6: 'email' };
  const conCasillas = (fila, p) => {
    let i = -1;
    return fila.replace(/<td[^>]*>[\s\S]*?<\/td>/g, (td) => {
      i += 1;
      const llave = CELDAS_CASILLAS[i];
      if (!llave) return td;
      const v = llave === 'nombre' ? [p.get('name'), p.get('name2')].filter(Boolean).join(' ') : (p.get(llave) ?? '');
      return llave === 'email' ? `<td ><a href='mailto:${v}'>${v}</a></td>` : `<td >${v}</td>`;
    });
  };
  const conEditadas = (html) => estado.editadas.reduce((h, p) => {
    const pid = [...p.keys()].find((k) => k.startsWith('contactsUPDATE[')).slice('contactsUPDATE['.length, -1);
    const etiquetas = p.getAll('assgn[]').map((c) => ETIQUETA_ROL[c]).join(',');
    return h.split(/(?=<tr class=')/).map((fila) => (fila.includes(`contactsEdit[${pid}]`) ? conCasillas(fila.replace(/<td >[^<]*<\/td>/, `<td >${etiquetas}</td>`), p) : fila)).join('');
  }, html);
  const conAgregadas = () => conEditadas(estado.agregadas.reduce((html, p, i) => {
    const etiquetas = p.getAll('assgn[]').map((c) => ETIQUETA_ROL[c]).join(',');
    const pid = String(1300 + i);
    const fila = `<tr class='oddrow'  >\n<td >${etiquetas}</td>\n<td >${p.get('ref')}</td>\n<td >${[p.get('name'), p.get('name2')].join(' ')}</td>\n` +
      `<td >${p.get('phone')}</td>\n<td >${p.get('phone2')}</td>\n<td >${p.get('fax')}</td>\n<td ><a href='mailto:${p.get('email')}'>${p.get('email')}</a></td>\n` +
      `<td align='center'><button type='submit' class='editbutton' name='contactsEdit[${pid}]' value='1' title='Editar' /></button>\n</td>` +
      `<td align='center'><button type='submit' class='editbutton' name='contactsDelete[${pid}]' value='1' title='Eliminar' /></button>\n</td></tr>\n`;
    return html.replace(/<\/table><\/center>(\s*<br><center><button)/, (_, resto) => fila.repeat(p.getAll('assgn[]').length) + '</table></center>' + resto);
  }, tabla));
  // El formulario de editar de la 1289 despues de la ultima actualizacion: sus Notas,
  // sus roles marcados y sus casillas (#563) son los que se mandaron.
  const formularioDeEditar = () => {
    const ultima = estado.editadas.at(-1);
    if (!ultima) return EDITAR_1289;
    const marcados = ultima.getAll('assgn[]');
    return EDITAR_1289
      .replace(/(<textarea name='notes'[^>]*>)[^<]*(<\/textarea>)/, (_, a, b) => `${a}${ultima.get('notes')}${b}`)
      .replace(/(<input [^>]*name="(phone|phone2|fax|email)"[^>]*value=")[^"]*(")/g, (_, a, llave, b) => `${a}${ultima.get(llave) ?? ''}${b}`)
      .replace(/<option groupid='(\d)'\s*(?:selected)?\s*value='(\d)'>/g, (_, g, v) => `<option groupid='${g}' ${marcados.includes(v) ? 'selected ' : ''} value='${v}'>`);
  };
  estado.fetch = async (url, init = {}) => {
    const u = String(url);
    const metodo = (init.method || 'GET').toUpperCase();
    const params = new URLSearchParams(init.body ? String(init.body) : '');
    estado.pedidos.push({ url: u, metodo, params });
    if (u.includes('trans_no=1&trans_type=30')) return new Response('<html><body>login de mentira</body></html>');
    if (u.includes('/access/logout.php')) return new Response('<html><body>sesion cerrada</body></html>');
    if (!u.includes('/sales/manage/customer_branches.php')) throw new Error('pagina inesperada ' + u);
    if (metodo === 'GET') return new Response(LISTA);
    if (params.has('Edit564')) return new Response(despuesDeEditar);
    if (params.has('tabs_contacts')) return new Response(conAgregadas());
    if (params.has('contactsNEW')) return new Response(NUEVO_564);
    if (params.has('contactsADD')) {
      if (errorAlAgregar) return new Response(NUEVO_564.replace('<form', `<div class='err_msg'>${errorAlAgregar}</div><form`));
      estado.agregadas.push(params);
      return new Response(conAgregadas());
    }
    if (params.has('contactsEdit[1289]')) return new Response(formularioDeEditar());
    if (params.has('contactsUPDATE[1289]')) {
      if (errorAlActualizar) return new Response(EDITAR_1289.replace('<form', `<div class='err_msg'>${errorAlActualizar}</div><form`));
      estado.editadas.push(params);
      return new Response(conAgregadas());
    }
    throw new Error('submit inesperado: ' + [...params.keys()].join(','));
  };
  return estado;
}
