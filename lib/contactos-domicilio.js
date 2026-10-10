// Nucleo PURO del padron de contactos de domicilio de entrega (#105; hallazgos medidos
// en #397). El GET del cliente solo trae los contactos del Cliente Operam y el del
// branch no trae ninguno: los de cada domicilio solo salen de
// `GET /api/v3/admin/contact_list`, que no filtra y trae TODOS los contactos de
// Operam. Aqui se decide que renglones son de un domicilio (`type: cust_branch`, con
// `entity_id` = branch_code) y se descartan los vacios; el IO y la cache viven en
// lib/contactos-domicilio-io.js.
//
// Desde #559 se guardan los renglones CRUDOS: traducirlos a personas con sus roles
// (`action`; en contact_list `ref` es texto libre y NO es marca) y sus casillas es de
// lib/contactos-operam.js, la unica puerta para leer Contactos en Operam. Un renglon
// con solo el Cel (`fax`) NO esta vacio.
const CASILLAS = ['name', 'phone', 'phone2', 'fax', 'email'];

export function indiceContactosDomicilio(filas) {
  const indice = new Map();
  for (const f of filas || []) {
    if (f?.type !== 'cust_branch') continue;
    const codigo = String(f.entity_id ?? '').trim();
    if (!codigo) continue;
    if (!CASILLAS.some(k => String(f[k] ?? '').trim())) continue;
    if (!indice.has(codigo)) indice.set(codigo, []);
    indice.get(codigo).push({ ...f });
  }
  return indice;
}
