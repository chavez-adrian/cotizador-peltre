import { test } from 'node:test';
import assert from 'node:assert/strict';
import { darDeAlta } from '../lib/alta-cliente.js';
import { operamEnMemoria } from './helpers/operam-memoria.js';
import { fuenteSegmento, RESULTADO_SEGMENTO_PENDIENTE } from '../lib/segmento-pendiente.js';

// Modulo Alta de cliente (#364, ADR-0017). Una regla por test, contra el
// adaptador de Operam en memoria: ningun test de este archivo sobreescribe
// globalThis.fetch ni levanta el servidor. El vocabulario de los nombres es el
// del glosario (CONTEXT.md): Cliente Operam, domicilio de entrega, Contacto.

const CELULAR = '+52 5588776655';

function solicitud(extra = {}) {
  return {
    contacto: { celular: CELULAR, prospecto: null, ligas: [] },
    identidad: { razonSocial: 'Hotel Azul Centro', nombreCorto: 'Hotel Azul', nombreVisible: 'Hotel Azul', rfc: '', pais: 'MX' },
    datosFiscales: null,
    comercial: { vendedor: 'Alejandro Chavez', tier: 'M100', salesTypeId: 15, segmentoId: null, correoFacturacion: '', usoCfdi: '' },
    domicilioEntrega: { nombre: '', calle: '', numInt: '', colonia: '', municipio: '', estado: '', cp: '', referencias: '', telefono: '', correo: '' },
    ligaFija: { clienteId: null, domicilioId: null },
    decision: null,
    segmento: { preferencia: 'diferido' },
    ...extra,
  };
}

function paso(resultado, name) {
  return resultado.pasos.find(p => p.name === name);
}

const DOMICILIO = {
  nombre: 'Recepcion', calle: 'Av. Reforma 100', numInt: 'A', colonia: 'Centro',
  municipio: 'Cuauhtemoc', estado: 'CDMX', cp: '06600', referencias: 'Entre calles',
  telefono: '5511223344', correo: 'entrega@hotelazul.mx',
};

test('un Contacto sin Cliente Operam parecido da de alta un Cliente Operam nuevo', async () => {
  const operam = operamEnMemoria();
  const res = await darDeAlta(solicitud(), operam.deps);

  assert.equal(res.tipo, 'lograda');
  assert.equal(res.creadoNuevo, true);
  assert.equal(res.clienteId, 900);
  const creado = operam.cliente(900);
  assert.equal(creado.tax_id, 'XAXX010101000');
  assert.equal(creado.CustName, 'Hotel Azul Centro');
  assert.equal(creado.sales_type, 15);
});

test('el Cliente Operam que el vendedor eligio se reutiliza sin crear otro', async () => {
  const operam = operamEnMemoria({
    clientes: [{ customer_id: 41, CustName: 'Hotel Azul Centro', cust_ref: 'Hotel Azul', tax_id: 'XAXX010101000', branches: [{ branch_code: 7, br_name: 'HOTEL AZUL' }] }],
  });
  const res = await darDeAlta(solicitud({ decision: { tipo: 'usar', clienteId: 41 } }), operam.deps);

  assert.equal(res.tipo, 'lograda');
  assert.equal(res.creadoNuevo, false);
  assert.equal(res.clienteId, 41);
  assert.equal(operam.pedidos('crearClienteDirecto').length, 0);
});

test('el celular ya ligado a un Cliente Operam lo reutiliza sin preguntar', async () => {
  const operam = operamEnMemoria({
    clientes: [{ customer_id: 55, CustName: 'Hotel Azul Centro', tax_id: 'XAXX010101000', branches: [{ branch_code: 9 }] }],
  });
  const res = await darDeAlta(solicitud({
    contacto: { celular: CELULAR, prospecto: { id: 1 }, ligas: [{ cliente_id: 55, fuente: 'cotizador' }] },
  }), operam.deps);

  assert.equal(res.tipo, 'lograda');
  assert.equal(res.clienteId, 55);
  assert.equal(res.creadoNuevo, false);
  assert.equal(paso(res, 'dedup').mensaje, 'Se uso el Cliente Operam que ya estaba ligado a este celular');
});

test('el vendedor que declara que ninguno es el mismo cliente crea uno nuevo y queda anotado', async () => {
  const operam = operamEnMemoria({
    clientes: [{ customer_id: 41, CustName: 'Hotel Azul Centro', cust_ref: 'Otro', tax_id: 'XAXX010101000', branches: [{ branch_code: 7 }] }],
  });
  const res = await darDeAlta(solicitud({ decision: { tipo: 'ninguno' } }), operam.deps);

  assert.equal(res.tipo, 'lograda');
  assert.equal(res.creadoNuevo, true);
  assert.equal(paso(res, 'dedup').status, 'warn');
  assert.equal(operam.estado.auditoria[0][2], 'creado-forzado');
});

test('un Cliente Operam parecido detiene el alta con la pregunta y sus tres salidas', async () => {
  const operam = operamEnMemoria({
    clientes: [{ customer_id: 41, CustName: 'Hotel Azul Centro', cust_ref: 'Otro', tax_id: 'XAXX010101000', branches: [{ branch_code: 7 }] }],
  });
  const res = await darDeAlta(solicitud(), operam.deps);

  assert.equal(res.tipo, 'pregunta');
  assert.equal(res.motivo, 'candidatos');
  assert.deepEqual(res.opciones, ['usar', 'otro-domicilio', 'ninguno']);
  assert.deepEqual(res.candidatos.map(c => c.id), [41]);
  assert.equal(operam.pedidos('crearClienteDirecto').length, 0);
});

test('el domicilio de entrega equivalente que ya existe se omite en vez de crearse otra vez', async () => {
  const operam = operamEnMemoria({
    clientes: [{
      customer_id: 41, CustName: 'Hotel Azul Centro', tax_id: 'XAXX010101000',
      branches: [
        { branch_code: 7, br_name: 'Matriz', addr_street: 'Otra calle', addr_zip: '11000' },
        { branch_code: 8, br_name: 'Recepcion', addr_street: 'Av. Reforma 100', addr_zip: '06600' },
      ],
    }],
  });
  const res = await darDeAlta(solicitud({
    domicilioEntrega: DOMICILIO,
    decision: { tipo: 'otro-domicilio', clienteId: 41 },
  }), operam.deps);

  assert.equal(res.tipo, 'lograda');
  assert.equal(res.domicilioId, 8);
  assert.equal(paso(res, 'POST branch').status, 'omitido');
  assert.equal(operam.pedidos('crearBranchCliente').length, 0);
});

test('un campo que Operam ignora del domicilio de entrega recien creado sale como aviso con sus dos capas', async () => {
  const operam = operamEnMemoria({ ignoraBranch: ['addr_interior'] });
  const res = await darDeAlta(solicitud({ domicilioEntrega: DOMICILIO }), operam.deps);

  assert.equal(res.tipo, 'lograda');
  const verificacion = paso(res, 'verificar branch');
  assert.equal(verificacion.status, 'warn');
  assert.equal(verificacion.mensaje, 'El domicilio de entrega no quedo completo en Operam');
  assert.match(verificacion.detalle, /addr_interior/);
  assert.deepEqual(verificacion.camposNoActualizados.map(x => x.campo), ['addr_interior']);
});

test('sobre un domicilio de entrega que el alta no acaba de crear nunca se escribe', async () => {
  const operam = operamEnMemoria({
    clientes: [{ customer_id: 55, CustName: 'Hotel Azul Centro', tax_id: 'XAXX010101000', branches: [{ branch_code: 9, addr_street: 'Domicilio real del cliente' }] }],
  });
  const res = await darDeAlta(solicitud({
    domicilioEntrega: DOMICILIO,
    contacto: { celular: CELULAR, prospecto: null, ligas: [{ cliente_id: 55, fuente: 'cotizador' }] },
  }), operam.deps);

  assert.equal(res.tipo, 'lograda');
  assert.equal(operam.pedidos('actualizarBranchCliente').length, 0);
  assert.equal(paso(res, 'PUT branch (domicilio)').status, 'omitido');
  assert.equal(operam.branch(9).addr_street, 'Domicilio real del cliente');
});

test('el Cel que Operam no aplica no tumba el alta: sale como campo no aplicado', async () => {
  const operam = operamEnMemoria({ ignoraCliente: ['fax'], ignoraBranch: ['fax'] });
  const res = await darDeAlta(solicitud({ domicilioEntrega: DOMICILIO }), operam.deps);

  assert.equal(res.tipo, 'lograda');
  const cel = paso(res, 'verificar Cel');
  assert.equal(cel.status, 'warn');
  assert.equal(cel.mensaje, 'El celular del Contacto no quedo guardado en la casilla Cel de Operam');
  assert.equal(cel.camposNoActualizados.length, 2);
});

test('el celular ligado a otro Cliente Operam se pregunta antes de crear o escribir nada', async () => {
  const operam = operamEnMemoria({
    clientes: [{ customer_id: 41, CustName: 'Hotel Azul Centro', tax_id: 'XAXX010101000', branches: [{ branch_code: 7 }] }],
  });
  const res = await darDeAlta(solicitud({
    contacto: { celular: CELULAR, prospecto: { id: 1 }, ligas: [{ cliente_id: 77, fuente: 'cotizador' }] },
    decision: { tipo: 'usar', clienteId: 41 },
  }), operam.deps);

  assert.equal(res.tipo, 'pregunta');
  assert.equal(res.motivo, 'otra-razon-social');
  assert.deepEqual(res.ligadas.map(l => l.cliente_id), [77]);
  assert.equal(res.clienteId, 41);
  assert.deepEqual(res.decision, { tipo: 'usar', clienteId: 41 });
  assert.equal(operam.pedidos('crearClienteDirecto').length, 0);
  assert.equal(operam.pedidos('actualizarBranchCliente').length, 0);
});

test('el nombre corto que ya usa otro Cliente Operam bloquea el alta nombrando al dueno', async () => {
  const operam = operamEnMemoria({
    padron: [{ customer_id: 12, CustName: 'Azul Hoteles SA de CV', cust_ref: 'Hotel Azul', tax_id: 'AHO010101AAA' }],
    falla: { crearClienteDirecto: 'Operam 406: Already exists customer with same cust_ref' },
  });
  const res = await darDeAlta(solicitud({ decision: { tipo: 'ninguno' } }), operam.deps);

  assert.equal(res.tipo, 'bloqueo');
  assert.equal(res.motivo, 'cust-ref-duplicado');
  assert.match(res.mensaje, /Azul Hoteles SA de CV/);
  assert.match(res.mensaje, /RFC AHO010101AAA/);
  assert.match(res.detalle, /same cust_ref/);
});

test('el Cliente Operam sin lista de precios se bloquea con la accion a tomar, no con el texto del ERP', async () => {
  const operam = operamEnMemoria({
    clientes: [{ customer_id: 41, CustName: 'Hotel Azul Centro', tax_id: 'XAXX010101000', branches: [{ branch_code: 7 }] }],
    falla: { crearBranchCliente: 'Operam 406: Debe haber al menos un rate de moneda' },
  });
  const res = await darDeAlta(solicitud({
    domicilioEntrega: DOMICILIO,
    decision: { tipo: 'otro-domicilio', clienteId: 41 },
  }), operam.deps);

  assert.equal(res.tipo, 'bloqueo');
  assert.equal(res.motivo, 'sin-lista-precios');
  assert.match(res.mensaje, /no tiene lista de precios en Operam/);
  assert.match(res.detalle, /rate de moneda/);
  assert.equal(res.clienteId, 41);
});

// --- Segmento comercial (#365) ----------------------------------------------
// La API v3 no escribe el segmento por ningun camino (#172): lo escribe la web
// legacy despues del alta. La Solicitud decide si el alta ESPERA esa escritura
// (el vendedor esta mirando) o la deja DIFERIDA (la subida de la cotizacion, cuya
// latencia manda). Diferida, el fallo no cabe en la respuesta: se anota en la
// auditoria como segmento pendiente para que se vea en el panel.

const comercialConSegmento = { vendedor: 'Alejandro Chavez', tier: 'M100', salesTypeId: 15, segmentoId: '14', correoFacturacion: '', usoCfdi: '' };

function filasPendientes(operam) {
  return operam.estado.auditoria.filter(a => a[2] === RESULTADO_SEGMENTO_PENDIENTE);
}

// Un tick de la cola de microtareas: lo que necesita el post-fix diferido para
// llegar a su .then/.catch una vez que su promesa resolvio.
function vaciarPendientes() {
  return new Promise(resolve => setImmediate(resolve));
}

test('con el segmento diferido el alta NO espera a la web legacy', async () => {
  let resuelto = false;
  const operam = operamEnMemoria({
    segmentoWeb: () => new Promise(resolve => setTimeout(() => { resuelto = true; resolve({ ok: true }); }, 50)),
  });

  const res = await darDeAlta(solicitud({ comercial: comercialConSegmento }), operam.deps);

  assert.equal(res.tipo, 'lograda');
  assert.equal(resuelto, false, 'el alta devolvio antes de que la web legacy contestara');
  assert.equal(paso(res, 'segmento').status, 'omitido');
  assert.match(paso(res, 'segmento').mensaje, /se escribe despues/);
  assert.equal(typeof res.segmentoDiferido, 'function', 'la escritura diferida se devuelve para dispararla despues de responder');
  assert.equal(operam.pedidos('actualizarSegmentoClienteWeb').length, 0, 'nada se escribio antes de dispararla');
  await res.segmentoDiferido();
  assert.equal(resuelto, true);
});

test('el segmento diferido que Operam rechaza queda en la auditoria como segmento pendiente', async () => {
  const operam = operamEnMemoria({ segmentoWeb: { ok: false, error: 'El codigo postal no puede ser vacio' } });

  const res = await darDeAlta(solicitud({ comercial: comercialConSegmento }), operam.deps);
  await res.segmentoDiferido();
  await vaciarPendientes();

  assert.equal(res.tipo, 'lograda');
  const [pendiente] = filasPendientes(operam);
  assert.ok(pendiente, 'el fallo diferido deja su fila de auditoria');
  const [rfc, nombre, , clienteId, fuente, dropbox, motivo] = pendiente;
  assert.equal(rfc, 'XAXX010101000');
  assert.equal(nombre, 'Hotel Azul Centro');
  assert.equal(clienteId, res.clienteId);
  assert.equal(fuente, fuenteSegmento('14'));
  assert.equal(dropbox, null);
  const [mensaje, detalle] = motivo.split(' | ');
  assert.equal(mensaje, 'El segmento no quedo guardado en Operam');
  assert.match(detalle, /El codigo postal no puede ser vacio/);
});

test('el segmento diferido que si se escribe no deja fila de pendiente', async () => {
  const operam = operamEnMemoria({ segmentoWeb: { ok: true } });

  const res = await darDeAlta(solicitud({ comercial: comercialConSegmento }), operam.deps);
  await res.segmentoDiferido();
  await vaciarPendientes();

  assert.equal(operam.pedidos('actualizarSegmentoClienteWeb').length, 1);
  assert.deepEqual(filasPendientes(operam), []);
});

test('el segmento diferido que truena tambien queda como pendiente, con el motivo tecnico', async () => {
  const operam = operamEnMemoria({ falla: { actualizarSegmentoClienteWeb: 'ECONNRESET' } });

  const res = await darDeAlta(solicitud({ comercial: comercialConSegmento }), operam.deps);
  await res.segmentoDiferido();
  await vaciarPendientes();

  const [pendiente] = filasPendientes(operam);
  assert.ok(pendiente);
  assert.match(pendiente[6], /ECONNRESET/);
});

test('con el segmento en esperar el alta espera la escritura y la reporta como un paso mas', async () => {
  let resuelto = false;
  const operam = operamEnMemoria({
    segmentoWeb: () => new Promise(resolve => setTimeout(() => { resuelto = true; resolve({ ok: true }); }, 20)),
  });

  const res = await darDeAlta(solicitud({
    comercial: comercialConSegmento,
    segmento: { preferencia: 'esperar' },
  }), operam.deps);

  assert.equal(resuelto, true, 'el alta espero a la web legacy');
  assert.equal(paso(res, 'segmento').status, 'ok');
  assert.equal(operam.estado.auditoria.filter(a => a[2] === 'segmento-escrito').length, 1);
});

test('con el segmento en esperar un rechazo de Operam sale como paso en error con sus dos capas', async () => {
  const operam = operamEnMemoria({ segmentoWeb: { ok: false, error: 'La sesion de Operam caduco' } });

  const res = await darDeAlta(solicitud({
    comercial: comercialConSegmento,
    segmento: { preferencia: 'esperar' },
  }), operam.deps);

  assert.equal(res.tipo, 'lograda');
  const seg = paso(res, 'segmento');
  assert.equal(seg.status, 'error');
  assert.equal(seg.mensaje, 'El segmento no quedo guardado en Operam');
  assert.match(seg.detalle, /La sesion de Operam caduco/);
});

test('el Cliente Operam que ya venia clasificado conserva su segmento y el paso lo dice', async () => {
  const operam = operamEnMemoria({ segmentoWeb: { ok: true, conservado: true, actual: '10' } });

  const res = await darDeAlta(solicitud({
    comercial: comercialConSegmento,
    segmento: { preferencia: 'esperar' },
  }), operam.deps);

  const seg = paso(res, 'segmento');
  assert.equal(seg.status, 'omitido');
  assert.match(seg.mensaje, /ya estaba clasificado/);
  assert.equal(operam.estado.auditoria.filter(a => a[2] === 'segmento-escrito').length, 0);
});

test('sin segmento capturado el alta no toca la web legacy y omite el paso', async () => {
  const operam = operamEnMemoria();

  const res = await darDeAlta(solicitud(), operam.deps);

  assert.equal(paso(res, 'segmento').status, 'omitido');
  assert.equal(operam.pedidos('actualizarSegmentoClienteWeb').length, 0);
});

test('todo paso del alta lleva mensaje para el vendedor y detalle tecnico', async () => {
  const operam = operamEnMemoria();
  const res = await darDeAlta(solicitud({ domicilioEntrega: DOMICILIO }), operam.deps);

  assert.equal(res.tipo, 'lograda');
  for (const p of res.pasos) {
    assert.ok(p.mensaje, `el paso ${p.name} no trae mensaje`);
    assert.ok(p.detalle, `el paso ${p.name} no trae detalle`);
    assert.doesNotMatch(p.mensaje, /sucursal|branch|customer|endpoint/i, `el paso ${p.name} usa vocabulario tecnico en el mensaje`);
  }
});
