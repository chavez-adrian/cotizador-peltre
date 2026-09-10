// Adaptador de Operam EN MEMORIA para los tests de lib/alta-cliente.js (#364,
// ADR-0017). Implementa las MISMAS dependencias que el adaptador real (las
// funciones de operam-client, operam-web, indice-telefonos, la auditoria, el
// registro de vendedores y el store de prospectos) y registra que se le pidio, para que las
// reglas del alta se prueben sin tocar globalThis.fetch ni el protocolo HTTP de
// Operam.
//
// Modela los dos quirks que el alta existe para sobrevivir:
//   - `ignoraCliente` / `ignoraBranch`: campos que Operam acepta con 200 y NO
//     escribe (#74). Es lo que hace fallar la verificacion por relectura.
//   - `falla`: la dependencia que lanza, por nombre, para probar los bloqueos.
//
// El POST de cliente auto-crea su domicilio de entrega copiando el nombre en
// MAYUSCULAS, como Operam (#170), y el POST de domicilio no lo hace: asi la
// diferencia entre "recien creado" y "preexistente" se ve en el estado.

import { CAMPO_CEL } from '../../lib/cel-operam.js';

const CAMPOS_BRANCH_DESDE_CLIENTE = ['phone', 'email'];

export function operamEnMemoria({
  clientes = [],
  padron = null,
  salesTypes = [
    { id: 12, sales_type: 'Precio de lista' },
    { id: 15, sales_type: 'M100' },
  ],
  salesman = 2,
  ignoraCliente = [],
  ignoraBranch = [],
  segmentoWeb = { ok: true },
  falla = {},
  siguienteClienteId = 900,
  siguienteBranchId = 800,
} = {}) {
  const estado = {
    clientes: clientes.map(c => ({ ...c, branches: (c.branches || []).map(b => ({ ...b })) })),
    proximoCliente: siguienteClienteId,
    proximoBranch: siguienteBranchId,
    cache: [],
    auditoria: [],
    ligas: [],
  };
  const llamadas = [];

  const registrar = (nombre, ...args) => {
    llamadas.push({ dep: nombre, args });
    if (falla[nombre]) throw new Error(falla[nombre]);
  };
  const buscarCliente = id => estado.clientes.find(c => String(c.customer_id) === String(id)) || null;
  const buscarBranch = code => estado.clientes
    .flatMap(c => c.branches || [])
    .find(b => String(b.branch_code) === String(code)) || null;
  const aplicar = (destino, campos, ignorados) => {
    for (const [k, v] of Object.entries(campos || {})) {
      if (ignorados.includes(k)) continue;
      destino[k] = v;
    }
  };

  const deps = {
    async buscarClientesPorRfc(rfc) {
      registrar('buscarClientesPorRfc', rfc);
      return estado.clientes.filter(c => String(c.tax_id || '') === String(rfc));
    },
    async clientesCacheados(opts) {
      registrar('clientesCacheados', opts);
      return padron === null ? estado.clientes : padron;
    },
    actualizarClienteEnCache(cliente) {
      registrar('actualizarClienteEnCache', cliente);
      estado.cache.push(cliente);
    },
    async crearClienteDirecto(body) {
      registrar('crearClienteDirecto', body);
      const customer_id = estado.proximoCliente++;
      const branch_code = estado.proximoBranch++;
      const branch = { branch_code, br_name: String(body.CustName || '').toUpperCase(), br_ref: 'AUTO' };
      for (const campo of CAMPOS_BRANCH_DESDE_CLIENTE) if (body[campo]) branch[campo] = body[campo];
      // El Cel del Contacto en Operam sale de `celular_nota` (buildClienteBody lo
      // escribe en la casilla `fax`, #339): el adaptador lo imita para que la
      // verificacion por relectura tenga algo real que comparar.
      const contacto = { id: 1, name: body.CustName };
      aplicar(contacto, { [CAMPO_CEL]: body.celular_nota || null }, ignoraCliente);
      const cliente = { ...body, customer_id, sales_type: body.sales_type ?? '12', branches: [branch], contacts: [contacto] };
      estado.clientes.push(cliente);
      return { cliente_id: customer_id, nombre: body.CustName };
    },
    async actualizarClienteDirecto(id, campos) {
      registrar('actualizarClienteDirecto', id, campos);
      const cliente = buscarCliente(id);
      if (!cliente) throw new Error(`Cliente ${id} inexistente`);
      aplicar(cliente, campos, ignoraCliente);
      return campos;
    },
    async obtenerClientePorId(id) {
      registrar('obtenerClientePorId', id);
      return buscarCliente(id);
    },
    async obtenerBranchesCliente(id) {
      registrar('obtenerBranchesCliente', id);
      return buscarCliente(id)?.branches || [];
    },
    async obtenerBranch(code) {
      registrar('obtenerBranch', code);
      return buscarBranch(code);
    },
    async obtenerBranchId(id) {
      registrar('obtenerBranchId', id);
      const code = buscarCliente(id)?.branches?.[0]?.branch_code;
      if (code == null) throw new Error(`El cliente ${id} no tiene domicilio de entrega`);
      return code;
    },
    async crearBranchCliente(customerId, datos) {
      registrar('crearBranchCliente', customerId, datos);
      const cliente = buscarCliente(customerId);
      if (!cliente) throw new Error(`Cliente ${customerId} inexistente`);
      const branch_code = estado.proximoBranch++;
      const branch = { branch_code };
      aplicar(branch, datos, ignoraBranch);
      cliente.branches.push(branch);
      return { branch_id: branch_code };
    },
    async actualizarBranchCliente(customerId, branchId, datos) {
      registrar('actualizarBranchCliente', customerId, branchId, datos);
      const branch = buscarBranch(branchId);
      if (!branch) throw new Error(`Domicilio ${branchId} inexistente`);
      aplicar(branch, datos, ignoraBranch);
      return { branch_id: branchId };
    },
    async listarSalesTypes() {
      registrar('listarSalesTypes');
      return salesTypes;
    },
    logCliente(...args) {
      registrar('logCliente', ...args);
      estado.auditoria.push(args);
    },
    // El segmento NO lo escribe la API v3 por ningun camino (#172): lo escribe la
    // web legacy. Aqui solo se registra la llamada y se responde lo que el test
    // configure en `segmentoWeb` -- un objeto para el desenlace fijo, o una
    // funcion cuando el test necesita controlar CUANDO resuelve (post-fix
    // diferido). El contrato real nunca lanza; para probar el catch del diferido
    // esta `falla.actualizarSegmentoClienteWeb`.
    async actualizarSegmentoClienteWeb(clienteId, segmentoId, opciones) {
      registrar('actualizarSegmentoClienteWeb', clienteId, segmentoId, opciones);
      return typeof segmentoWeb === 'function'
        ? await segmentoWeb(clienteId, segmentoId, opciones)
        : segmentoWeb;
    },
    async listar() {
      registrar('listar');
      return [{ name: 'Alejandro Chavez', operam_id: salesman }];
    },
    async ligarCliente(prospectoId, clienteId, evento) {
      registrar('ligarCliente', prospectoId, clienteId, evento);
      estado.ligas.push({ prospectoId, clienteId, evento });
    },
  };

  return {
    deps,
    estado,
    llamadas,
    // Que se le pidio, por nombre de dependencia: el equivalente en memoria de
    // "que endpoints se llamaron" que hoy comprueban los supertest por fetch.
    pedidos: nombre => llamadas.filter(l => l.dep === nombre),
    cliente: buscarCliente,
    branch: buscarBranch,
  };
}
