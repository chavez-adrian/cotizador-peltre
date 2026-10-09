// Nucleo PURO del padron de contactos de domicilio de entrega (#105; hallazgos medidos
// en #397). El GET del cliente solo trae los contactos del Cliente Operam y el del
// branch no trae ninguno: los de cada domicilio solo salen de
// `GET /api/v3/admin/contact_list`, que no filtra y trae TODOS los contactos de
// Operam. Aqui se decide que renglones son de un domicilio (`type: cust_branch`, con
// `entity_id` = branch_code) y se guardan TAL CUAL: traducirlos a personas (por
// person_id, con roles y casillas, el Cel incluido) es de lib/contactos-operam.js
// (#559). El IO y la cache viven en lib/contactos-domicilio-io.js.
export function indiceContactosDomicilio(filas) {
  const indice = new Map();
  for (const f of filas || []) {
    if (f?.type !== 'cust_branch') continue;
    const codigo = String(f.entity_id ?? '').trim();
    if (!codigo) continue;
    if (!indice.has(codigo)) indice.set(codigo, []);
    indice.get(codigo).push(f);
  }
  return indice;
}
