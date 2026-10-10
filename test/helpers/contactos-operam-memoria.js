// Adaptador de Operam EN MEMORIA para las pruebas de lib/contactos-operam.js (#559,
// ADR-0024). Implementa las MISMAS dependencias que el adaptador real y guarda el
// estado en la forma CRUDA de Operam, para que el modulo traduzca lo mismo que
// traduce en produccion:
//   - `clientes`: lo que devuelve `GET /customers/:id`, con `contacts[]` (un renglon
//     POR ROL; `id` = person_id) y `branches[]`.
//   - `contactList`: los renglones de `GET /api/v3/admin/contact_list` (un renglon
//     por rol, con su `id` de renglon y el `person_id` de la persona; `type`
//     `cust_branch` y `entity_id` = branch_code para los del domicilio).
//   - `padronCargado: false`: el padron de contact_list todavia no se leyo (cache
//     fria u Operam caido): no se sabe que contactos tiene un domicilio.

export function contactosOperamEnMemoria({ clientes = [], contactList = [], padronCargado = true } = {}) {
  const llamadas = [];
  return {
    llamadas,
    deps: {
      async leerCliente(clienteId) {
        llamadas.push({ dep: 'leerCliente', args: [clienteId] });
        const c = clientes.find(x => String(x.customer_id) === String(clienteId));
        return c ? structuredClone(c) : null;
      },
      filasDelDomicilio(branchCode) {
        llamadas.push({ dep: 'filasDelDomicilio', args: [branchCode] });
        if (!padronCargado) return null;
        return contactList
          .filter(f => f.type === 'cust_branch' && String(f.entity_id) === String(branchCode))
          .map(f => ({ ...f }));
      },
    },
  };
}
