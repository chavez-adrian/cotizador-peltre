// Envoltura con IO del barrido de domicilios con almacen mal configurado (#416).
// Aqui se LEE Operam y alla (lib/almacen-domicilios.js) se decide.
//
// El listado de clientes trae los domicilios inline pero NO el almacen: el
// `default_location` solo lo da el detalle de cada branch (`GET /branches/:code`).
// Es la misma lectura con la que #330 midio el padron (489 clientes, 531
// domicilios; 9 respondieron 429 en la primera pasada), asi que el barrido es de
// cientos de lecturas: corre a pedido desde el panel, con pocas lecturas en vuelo
// (el backoff 429 de apiCall hace el resto), y su resultado CRUDO se guarda en
// memoria -- el GET del panel y marcar/desmarcar "asi va bien" recalculan el
// reporte sobre el sin volver a leer Operam. Un reinicio lo pierde y el panel
// pide barrer otra vez; asume UNA sola instancia, como config-store.
//
// Un domicilio que no se pudo leer NO tumba el barrido: su error viaja en
// `errores` y el nucleo lo reporta aparte. Lo que si tumba el barrido es no poder
// leer el padron (o el login): sin padron no hay nada que decir.

import { listarTodosClientes, obtenerBranch, nombresDeAlmacenes } from './operam-client.js';

const LECTURAS_EN_VUELO = 4;

let ultimo = null;
let enCurso = null;

function codigosDeBranch(clientes) {
  const codigos = new Set();
  for (const c of clientes || []) {
    for (const b of c?.branches || []) {
      const codigo = String(b?.branch_code ?? '').trim();
      if (codigo) codigos.add(codigo);
    }
  }
  return [...codigos];
}

async function barrer(deps) {
  const io = { listarTodosClientes, obtenerBranch, nombresDeAlmacenes, ...deps };
  const clientes = await io.listarTodosClientes();
  const codigos = codigosDeBranch(clientes);
  const branches = {};
  const errores = {};
  let siguiente = 0;
  async function lector() {
    while (siguiente < codigos.length) {
      const codigo = codigos[siguiente++];
      try {
        const branch = await io.obtenerBranch(codigo);
        if (branch) branches[codigo] = branch;
      } catch (err) {
        errores[codigo] = err.message;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(LECTURAS_EN_VUELO, codigos.length) }, lector));
  const almacenes = await io.nombresDeAlmacenes();
  ultimo = { fecha: new Date().toISOString(), clientes, branches, errores, almacenes };
  return ultimo;
}

// Un barrido a la vez: el segundo clic espera al que ya va en vuelo.
export function barrerAlmacenesDomicilios(deps = {}) {
  if (!enCurso) enCurso = barrer(deps).finally(() => { enCurso = null; });
  return enCurso;
}

export function ultimoBarridoAlmacenes() {
  return ultimo;
}

// Seam de prueba: proceso recien arrancado, sin barrido en memoria.
export function _reiniciar() {
  ultimo = null;
  enCurso = null;
}
