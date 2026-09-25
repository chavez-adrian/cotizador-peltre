// Nucleo PURO del padron de contactos de domicilio de entrega (#105; hallazgos medidos
// en #397). El GET del cliente solo trae los contactos del Cliente Operam y el del
// branch no trae ninguno: los de cada domicilio solo salen de
// `GET /api/v3/admin/contact_list`, que no filtra y trae TODOS los contactos de
// Operam. Aqui se decide que filas son de un domicilio (`type: cust_branch`, con
// `entity_id` = branch_code) y se descartan las vacias; el IO y la cache viven en
// lib/contactos-domicilio-io.js.
//
// La marca es `action` (general/invoice/delivery). En contact_list `ref` es texto
// libre ("Adrian Pestalozzi Referencia"), asi que NO sirve de respaldo como en
// contacts[] del cliente. La forma de cada contacto es la de mapearContactosCliente
// (operam-client.js) para que el navegador los lea igual.
export function indiceContactosDomicilio(filas) {
  const indice = new Map();
  for (const f of filas || []) {
    if (f?.type !== 'cust_branch') continue;
    const codigo = String(f.entity_id ?? '').trim();
    if (!codigo) continue;
    const contacto = {
      tag: f.action || '',
      nombre: f.name || '',
      telefono: f.phone || f.phone2 || '',
      email: f.email || '',
    };
    if (!contacto.nombre && !contacto.telefono && !contacto.email) continue;
    if (!indice.has(codigo)) indice.set(codigo, []);
    indice.get(codigo).push(contacto);
  }
  return indice;
}
