import { test } from 'node:test';
import assert from 'node:assert/strict';
import { darDeAlta, upgradeFiscal, vendedorDeCartera } from '../lib/alta-cliente.js';
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

// El alta completa (#366): la misma Solicitud, con datos fiscales reales y el
// segmento esperado. El RFC real es lo que la distingue del alta que nace con la
// cotizacion, y de ahi salen la dedup por RFC exacto y el lock.
const RFC_REAL = 'HAZ010203AB1';

function solicitudFiscal(extra = {}) {
  return solicitud({
    datosFiscales: {
      rfc: RFC_REAL, razonSocial: 'Hoteles Azules SA de CV', regimen: '601',
      idcif: '12345678901', calle: 'Av. Juarez', numExt: '55', numInt: '3',
      colonia: 'Centro', cp: '06000', municipio: 'Cuauhtemoc', estado: 'CDMX',
      actividades: [], csfFecha: '',
    },
    segmento: { preferencia: 'esperar' },
    ...extra,
  });
}

test('un alta con datos fiscales crea el Cliente Operam con su RFC real y su domicilio fiscal', async () => {
  const operam = operamEnMemoria();
  const res = await darDeAlta(solicitudFiscal({ domicilioEntrega: DOMICILIO }), operam.deps);

  assert.equal(res.tipo, 'lograda');
  assert.equal(res.creadoNuevo, true);
  const creado = operam.cliente(res.clienteId);
  assert.equal(creado.tax_id, RFC_REAL);
  assert.equal(creado.CustName, 'Hotel Azul Centro');
  assert.equal(creado.cfdi_regimen_fiscal, '601');
  assert.equal(creado.postal_code, '06000');
  assert.equal(creado.street, 'Av. Juarez');
});

test('el RFC real que ya tiene Cliente Operam detiene el alta con la pregunta, sin crear nada', async () => {
  const operam = operamEnMemoria({
    clientes: [{ customer_id: 61, CustName: 'HOTELES AZULES SA DE CV', cust_ref: 'Otro', tax_id: RFC_REAL, branches: [{ branch_code: 3 }] }],
  });
  const res = await darDeAlta(solicitudFiscal(), operam.deps);

  assert.equal(res.tipo, 'pregunta');
  assert.equal(res.motivo, 'candidatos');
  assert.deepEqual(res.candidatos.map(c => c.id), [61]);
  assert.equal(operam.pedidos('crearClienteDirecto').length, 0);
});

// #377: el RFC real exacto no es un "parecido" -- es el mismo contribuyente, y
// por eso la pregunta pierde la salida que crea una segunda cuenta.
test('la pregunta por RFC real exacto no ofrece "ninguno es el mismo"', async () => {
  const operam = operamEnMemoria({
    clientes: [{ customer_id: 61, CustName: 'HOTELES AZULES SA DE CV', cust_ref: 'Otro', tax_id: RFC_REAL, branches: [{ branch_code: 3 }] }],
  });
  const res = await darDeAlta(solicitudFiscal(), operam.deps);

  assert.equal(res.tipo, 'pregunta');
  assert.deepEqual(res.opciones, ['usar', 'otro-domicilio']);
  assert.match(res.mensaje, /mismo RFC/);
});

test('"ninguno es el mismo" contra un candidato con el mismo RFC real bloquea sin crear nada', async () => {
  const operam = operamEnMemoria({
    clientes: [{ customer_id: 61, CustName: 'HOTELES AZULES SA DE CV', cust_ref: 'Otro', tax_id: RFC_REAL, branches: [{ branch_code: 3 }] }],
  });
  const res = await darDeAlta(solicitudFiscal({ decision: { tipo: 'ninguno' } }), operam.deps);

  assert.equal(res.tipo, 'bloqueo');
  assert.equal(res.motivo, 'fusion');
  assert.match(res.mensaje, /Este RFC ya es del Cliente Operam HOTELES AZULES SA DE CV \(61\)/);
  assert.equal(res.clienteId, undefined, 'el bloqueo no liga la operacion al cliente ajeno');
  assert.deepEqual(res.dueno, { cliente_id: 61, nombre: 'HOTELES AZULES SA DE CV' });
  assert.equal(paso(res, 'dedup').status, 'error');
  assert.equal(operam.pedidos('crearClienteDirecto').length, 0);
  assert.deepEqual(operam.estado.auditoria.map(a => a[2]), ['fusion-bloqueada']);
});

// #377: la marca no puede depender de POR DONDE entro el candidato. El dueno del
// nombre corto sale del padron completo (#242) y es el unico camino que descubre
// que el cliente ya existia bajo un RFC real: si trae el mismo RFC real que se
// esta capturando, es el mismo contribuyente aunque el pool por ?tax_id= no lo
// haya devuelto.
test('el dueno del nombre corto con el mismo RFC real tampoco ofrece "ninguno es el mismo"', async () => {
  const operam = operamEnMemoria({
    clientes: [],
    padron: [{ customer_id: 70, CustName: 'HOTELES AZULES SA DE CV', cust_ref: 'Hotel Azul', tax_id: RFC_REAL }],
  });
  const res = await darDeAlta(solicitudFiscal(), operam.deps);

  assert.equal(res.tipo, 'pregunta');
  assert.deepEqual(res.candidatos.map(c => c.id), [70]);
  assert.deepEqual(res.opciones, ['usar', 'otro-domicilio']);
});

test('"ninguno es el mismo" contra el dueno del nombre corto con el mismo RFC real bloquea', async () => {
  const operam = operamEnMemoria({
    clientes: [],
    padron: [{ customer_id: 70, CustName: 'HOTELES AZULES SA DE CV', cust_ref: 'Hotel Azul', tax_id: RFC_REAL }],
  });
  const res = await darDeAlta(solicitudFiscal({ decision: { tipo: 'ninguno' } }), operam.deps);

  assert.equal(res.tipo, 'bloqueo');
  assert.equal(res.motivo, 'fusion');
  assert.equal(operam.pedidos('crearClienteDirecto').length, 0);
});

test('el candidato que solo coincide por nombre corto conserva las tres salidas', async () => {
  const operam = operamEnMemoria({
    clientes: [{ customer_id: 62, CustName: 'HOTEL AZUL DE OCCIDENTE', cust_ref: 'Hotel Azul', tax_id: 'HAO050607CD2', branches: [{ branch_code: 4 }] }],
  });
  const res = await darDeAlta(solicitudFiscal(), operam.deps);

  assert.equal(res.tipo, 'pregunta');
  assert.deepEqual(res.candidatos.map(c => c.id), [62]);
  assert.deepEqual(res.opciones, ['usar', 'otro-domicilio', 'ninguno']);
  assert.doesNotMatch(res.mensaje, /mismo RFC/);
});

test('con nombre corto distinto "ninguno es el mismo" crea el Cliente Operam como siempre', async () => {
  const operam = operamEnMemoria({
    clientes: [{ customer_id: 62, CustName: 'HOTEL AZUL DE OCCIDENTE', cust_ref: 'Hotel Azul', tax_id: 'HAO050607CD2', branches: [{ branch_code: 4 }] }],
  });
  const res = await darDeAlta(solicitudFiscal({ decision: { tipo: 'ninguno' } }), operam.deps);

  assert.equal(res.tipo, 'lograda');
  assert.equal(res.creadoNuevo, true);
  assert.equal(paso(res, 'dedup').status, 'warn');
});

test('el uso de CFDI elegido queda escrito por el PUT, que es el unico que Operam respeta', async () => {
  const operam = operamEnMemoria();
  const res = await darDeAlta(solicitudFiscal({
    comercial: { vendedor: 'Alejandro Chavez', tier: 'M100', salesTypeId: 15, segmentoId: null, correoFacturacion: '', usoCfdi: 'G03' },
  }), operam.deps);

  assert.equal(res.tipo, 'lograda');
  const put = operam.pedidos('actualizarClienteDirecto').find(l => l.args[1].dimension_id != null);
  assert.equal(put.args[1].timbrado_uso_cfdi, 'G03');
  assert.equal(operam.cliente(res.clienteId).timbrado_uso_cfdi, 'G03');
});

test('sin datos fiscales el PUT lleva el uso de CFDI que impone el RFC generico, no el capturado', async () => {
  const operam = operamEnMemoria();
  const res = await darDeAlta(solicitud({
    comercial: { vendedor: 'Alejandro Chavez', tier: 'M100', salesTypeId: 15, segmentoId: null, correoFacturacion: '', usoCfdi: 'G03' },
  }), operam.deps);

  assert.equal(res.tipo, 'lograda');
  const put = operam.pedidos('actualizarClienteDirecto').find(l => l.args[1].dimension_id != null);
  assert.equal(put.args[1].timbrado_uso_cfdi, 'S01');
});

test('sobre el Cliente Operam que el vendedor eligio no se escribe ningun domicilio de entrega', async () => {
  const operam = operamEnMemoria({
    clientes: [{
      customer_id: 61, CustName: 'HOTELES AZULES SA DE CV', tax_id: RFC_REAL,
      branches: [{ branch_code: 3, br_name: 'Matriz', addr_street: 'Domicilio real del cliente' }],
    }],
  });
  const res = await darDeAlta(solicitudFiscal({
    domicilioEntrega: DOMICILIO,
    decision: { tipo: 'usar', clienteId: 61 },
  }), operam.deps);

  assert.equal(res.tipo, 'lograda');
  assert.equal(res.clienteId, 61);
  assert.equal(operam.pedidos('actualizarBranchCliente').length, 0);
  assert.equal(operam.branch(3).addr_street, 'Domicilio real del cliente');
  assert.equal(paso(res, 'PUT branch (domicilio)').status, 'omitido');
});

test('el Cliente Operam reutilizado que ya tiene la configuracion comercial capturada no se toca', async () => {
  const operam = operamEnMemoria({
    clientes: [{
      customer_id: 61, CustName: 'HOTELES AZULES SA DE CV', tax_id: RFC_REAL,
      sales_type: 15, timbrado_uso_cfdi: 'G03', segmento: { id: 9 },
      branches: [{ branch_code: 3 }],
    }],
  });
  const res = await darDeAlta(solicitudFiscal({
    comercial: { vendedor: 'Alejandro Chavez', salesTypeId: 15, segmentoId: 9, correoFacturacion: '', usoCfdi: 'G03' },
    decision: { tipo: 'usar', clienteId: 61 },
  }), operam.deps);

  assert.equal(res.tipo, 'lograda');
  assert.equal(paso(res, 'PUT customer (config comercial)').status, 'omitido');
  assert.equal(operam.pedidos('actualizarClienteDirecto').length, 0);
});

test('del Cliente Operam reutilizado solo viaja lo que cambia de la configuracion comercial', async () => {
  const operam = operamEnMemoria({
    clientes: [{
      customer_id: 61, CustName: 'HOTELES AZULES SA DE CV', tax_id: RFC_REAL,
      sales_type: 15, timbrado_uso_cfdi: 'S01', segmento: { id: 9 },
      branches: [{ branch_code: 3 }],
    }],
  });
  const res = await darDeAlta(solicitudFiscal({
    comercial: { vendedor: 'Alejandro Chavez', salesTypeId: 15, segmentoId: 9, correoFacturacion: '', usoCfdi: 'G03' },
    decision: { tipo: 'usar', clienteId: 61 },
  }), operam.deps);

  assert.equal(res.tipo, 'lograda');
  assert.equal(paso(res, 'PUT customer (config comercial)').status, 'ok');
  const puts = operam.pedidos('actualizarClienteDirecto');
  assert.equal(puts.length, 1);
  assert.deepEqual(puts[0].args[1], { timbrado_uso_cfdi: 'G03' });
});

test('el Cliente Operam recien creado omite la configuracion comercial porque nacio con ella', async () => {
  const operam = operamEnMemoria();
  const res = await darDeAlta(solicitudFiscal(), operam.deps);

  assert.equal(res.tipo, 'lograda');
  const p = paso(res, 'PUT customer (config comercial)');
  assert.equal(p.status, 'omitido');
  assert.match(p.mensaje, /nacio/);
});

test('dos altas simultaneas con el mismo RFC real crean un solo Cliente Operam', async () => {
  const operam = operamEnMemoria();
  const [a, b] = await Promise.all([
    darDeAlta(solicitudFiscal(), operam.deps),
    darDeAlta(solicitudFiscal(), operam.deps),
  ]);

  assert.equal(operam.pedidos('crearClienteDirecto').length, 1);
  assert.deepEqual([a.tipo, b.tipo].sort(), ['lograda', 'pregunta']);
});

test('tras un alta con datos fiscales lograda se refresca el padron de telefonos', async () => {
  const operam = operamEnMemoria();
  const res = await darDeAlta(solicitudFiscal(), operam.deps);

  assert.equal(res.tipo, 'lograda');
  assert.equal(operam.pedidos('refrescarIndice').length, 1);
});

test('el nombre corto repetido en el alta con datos fiscales manda a dar de alta otra vez, no a generar una cotizacion', async () => {
  const operam = operamEnMemoria({
    padron: [{ customer_id: 12, CustName: 'Azul Hoteles SA de CV', cust_ref: 'Hotel Azul', tax_id: 'AHO010101AAA' }],
    falla: { crearClienteDirecto: 'Operam 406: Already exists customer with same cust_ref' },
  });
  const res = await darDeAlta(solicitudFiscal({ decision: { tipo: 'ninguno' } }), operam.deps);

  assert.equal(res.tipo, 'bloqueo');
  assert.equal(res.motivo, 'cust-ref-duplicado');
  assert.match(res.mensaje, /vuelve a dar de alta al cliente/);
  assert.doesNotMatch(res.mensaje, /cotizacion/);
});

test('el alta sin datos fiscales no releee el padron completo: le basta la entrada del cliente', async () => {
  const operam = operamEnMemoria();
  const res = await darDeAlta(solicitud(), operam.deps);

  assert.equal(res.tipo, 'lograda');
  assert.equal(operam.pedidos('refrescarIndice').length, 0);
});

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

// El domicilio de entrega que el vendedor eligio entre los del Cliente Operam
// (#252, absorbido por #368): con varios domicilios, el primero de la lista no es
// el que el vendedor escogio, y la cotizacion heredaria la plaza equivocada.
test('con dos domicilios de entrega, usar devuelve el que eligio el vendedor y no el primero', async () => {
  const operam = operamEnMemoria({
    clientes: [{
      customer_id: 41, CustName: 'Hotel Azul Centro', cust_ref: 'Hotel Azul', tax_id: 'XAXX010101000',
      branches: [{ branch_code: 7, br_name: 'Matriz' }, { branch_code: 9, br_name: 'Planta Norte' }],
    }],
  });
  const res = await darDeAlta(solicitud({ decision: { tipo: 'usar', clienteId: 41, domicilioId: 9 } }), operam.deps);

  assert.equal(res.tipo, 'lograda');
  assert.equal(res.clienteId, 41);
  assert.equal(res.domicilioId, 9);
});

test('usar sin domicilio elegido conserva el domicilio de entrega que ya tenia el Cliente Operam', async () => {
  const operam = operamEnMemoria({
    clientes: [{
      customer_id: 41, CustName: 'Hotel Azul Centro', cust_ref: 'Hotel Azul', tax_id: 'XAXX010101000',
      branches: [{ branch_code: 7, br_name: 'Matriz' }, { branch_code: 9, br_name: 'Planta Norte' }],
    }],
  });
  const res = await darDeAlta(solicitud({ decision: { tipo: 'usar', clienteId: 41 } }), operam.deps);

  assert.equal(res.tipo, 'lograda');
  assert.equal(res.domicilioId, 7);
  assert.equal(operam.pedidos('crearBranchCliente').length, 0);
  assert.equal(operam.pedidos('actualizarBranchCliente').length, 0);
});

test('el domicilio de entrega que no es del Cliente Operam elegido vuelve a preguntar, nunca se crea a ciegas', async () => {
  const operam = operamEnMemoria({
    clientes: [{
      customer_id: 41, CustName: 'Hotel Azul Centro', cust_ref: 'Hotel Azul', tax_id: 'XAXX010101000',
      branches: [{ branch_code: 7, br_name: 'Matriz' }],
    }],
  });
  const res = await darDeAlta(solicitud({ decision: { tipo: 'usar', clienteId: 41, domicilioId: 999 } }), operam.deps);

  assert.equal(res.tipo, 'pregunta');
  assert.equal(res.motivo, 'candidatos');
  assert.deepEqual(res.opciones, ['usar', 'otro-domicilio', 'ninguno']);
  assert.deepEqual(res.candidatos.map(c => c.id), [41]);
  assert.equal(operam.pedidos('crearBranchCliente').length, 0);
  assert.equal(operam.pedidos('actualizarBranchCliente').length, 0);
});

test('otro domicilio de este cliente crea uno nuevo y deja intactos los que ya existian', async () => {
  const operam = operamEnMemoria({
    clientes: [{
      customer_id: 41, CustName: 'Hotel Azul Centro', cust_ref: 'Hotel Azul', tax_id: 'XAXX010101000',
      branches: [
        { branch_code: 7, br_name: 'Matriz', addr_street: 'Otra calle', addr_zip: '11000' },
        { branch_code: 8, br_name: 'Planta', addr_street: 'Camino viejo', addr_zip: '54000' },
      ],
    }],
  });
  const res = await darDeAlta(solicitud({
    domicilioEntrega: DOMICILIO,
    decision: { tipo: 'otro-domicilio', clienteId: 41 },
  }), operam.deps);

  assert.equal(res.tipo, 'lograda');
  assert.equal(operam.pedidos('crearBranchCliente').length, 1);
  assert.equal(operam.pedidos('actualizarBranchCliente').length, 0);
  assert.equal(operam.branch(7).addr_street, 'Otra calle');
  assert.equal(operam.branch(8).addr_street, 'Camino viejo');
  assert.equal(operam.branch(res.domicilioId).addr_street, 'Av. Reforma 100');
});

// #374: el domicilio de entrega nacio en ESTA corrida aunque el Cliente Operam
// sea viejo. Los pasos del domicilio no pueden hablar de uno preexistente -- el
// panel manda los tres a la misma fila y el vendedor leia que no se habia tocado
// nada justo despues de crearlo.
test('otro domicilio no reporta el domicilio recien creado como preexistente', async () => {
  const operam = operamEnMemoria({
    clientes: [{
      customer_id: 41, CustName: 'Hotel Azul Centro', cust_ref: 'Hotel Azul', tax_id: 'XAXX010101000',
      branches: [{ branch_code: 7, br_name: 'Matriz', addr_street: 'Otra calle', addr_zip: '11000' }],
    }],
  });
  const res = await darDeAlta(solicitud({
    domicilioEntrega: DOMICILIO,
    decision: { tipo: 'otro-domicilio', clienteId: 41 },
  }), operam.deps);

  assert.equal(res.tipo, 'lograda');
  for (const p of res.pasos.filter(p => /branch/.test(p.name))) {
    assert.ok(!`${p.mensaje} ${p.detalle}`.includes('no se toco su domicilio'),
      `el paso ${p.name} dice que no se toco el domicilio: ${p.mensaje}`);
    assert.ok(!`${p.mensaje} ${p.detalle}`.includes('preexistente'),
      `el paso ${p.name} llama preexistente al domicilio recien creado: ${p.detalle}`);
  }
});

// La fila "Obtener domicilio" se quedaba en pendiente: por este camino el
// domicilio ya quedo resuelto al crearlo, y el paso que lo dice faltaba.
test('otro domicilio reporta cual domicilio de entrega se usa', async () => {
  const operam = operamEnMemoria({
    clientes: [{
      customer_id: 41, CustName: 'Hotel Azul Centro', cust_ref: 'Hotel Azul', tax_id: 'XAXX010101000',
      branches: [{ branch_code: 7, br_name: 'Matriz', addr_street: 'Otra calle', addr_zip: '11000' }],
    }],
  });
  const res = await darDeAlta(solicitud({
    domicilioEntrega: DOMICILIO,
    decision: { tipo: 'otro-domicilio', clienteId: 41 },
  }), operam.deps);

  const obtener = paso(res, 'GET branch_id');
  assert.ok(obtener, 'el alta tiene que decir a que domicilio de entrega va la cotizacion');
  assert.equal(obtener.status, 'ok');
  assert.ok(obtener.mensaje.includes('recien creado'));
  assert.ok(obtener.detalle.includes(String(res.domicilioId)));
});

// La otra salida del paso nuevo: el reintento donde el domicilio ya se habia
// creado en una corrida anterior (sucursalEquivalente lo encuentra y no crea otro).
// El mensaje no puede decir "recien creado" ahi: no nacio en esta corrida.
test('otro domicilio reusado de un intento anterior lo dice en vez de fingir que acaba de nacer', async () => {
  const operam = operamEnMemoria({
    clientes: [{
      customer_id: 41, CustName: 'Hotel Azul Centro', cust_ref: 'Hotel Azul', tax_id: 'XAXX010101000',
      branches: [
        { branch_code: 7, br_name: 'Matriz', addr_street: 'Otra calle', addr_zip: '11000' },
        { branch_code: 9, br_name: DOMICILIO.nombre, addr_street: DOMICILIO.calle, addr_zip: DOMICILIO.cp },
      ],
    }],
  });
  const res = await darDeAlta(solicitud({
    domicilioEntrega: DOMICILIO,
    decision: { tipo: 'otro-domicilio', clienteId: 41 },
  }), operam.deps);

  assert.equal(res.tipo, 'lograda');
  assert.equal(operam.pedidos('crearBranchCliente').length, 0, 'no se crea un segundo domicilio identico');
  assert.equal(paso(res, 'POST branch').status, 'omitido');
  const obtener = paso(res, 'GET branch_id');
  assert.equal(obtener.status, 'ok');
  assert.ok(obtener.mensaje.includes('intento anterior'), obtener.mensaje);
  assert.ok(!obtener.mensaje.includes('recien creado'), 'no nacio en esta corrida');
});

// El guard que faltaba (#374): los pasos del modulo pasados POR EL PANEL. Los tres
// pasos del domicilio comparten fila y el ultimo manda (#366), asi que un omitido
// empujado detras de la creacion vuelve a tapar la fila -- que es exactamente como
// nacio este bug. Esto se prueba de punta a punta o no se prueba: el test del panel
// solo por su lado usa pasos escritos a mano, que no son los que el modulo emite.
test('los pasos del alta con domicilio nuevo dejan las filas del panel en la creacion', async () => {
  const { interpretarRespuestaAlta, ALTA_PASO_FILA } = await import('../public/js/alta-logica.js');
  const operam = operamEnMemoria({
    clientes: [{
      customer_id: 41, CustName: 'Hotel Azul Centro', cust_ref: 'Hotel Azul', tax_id: 'XAXX010101000',
      branches: [{ branch_code: 7, br_name: 'Matriz', addr_street: 'Otra calle', addr_zip: '11000' }],
    }],
  });
  const res = await darDeAlta(solicitud({
    domicilioEntrega: DOMICILIO,
    decision: { tipo: 'otro-domicilio', clienteId: 41 },
  }), operam.deps);

  const { filas } = interpretarRespuestaAlta({ ok: true, steps: res.pasos });
  const fila = n => filas.find(f => f.fila === ALTA_PASO_FILA[n]);

  assert.equal(fila('GET branch_id').status, 'ok', 'Obtener domicilio no puede quedarse pendiente');
  const domicilio = fila('PUT branch (domicilio)');
  assert.equal(domicilio.status, 'ok', 'la fila del domicilio cierra en la creacion, no en un omitido');
  assert.ok(domicilio.detalle.includes(String(res.domicilioId)));
});

// La decision que ya no es valida (#208): el candidato pudo desaparecer del pool
// entre la pregunta y la respuesta. Se vuelve a preguntar con la lista fresca,
// cero escrituras -- las tres decisiones sobre un cliente elegido pasan por aqui.
test('usar un Cliente Operam que ya no esta en la lista de parecidos vuelve a preguntar sin escribir', async () => {
  const operam = operamEnMemoria({
    clientes: [{ customer_id: 41, CustName: 'Otra Cosa SA', cust_ref: 'Otra', tax_id: 'XAXX010101000', branches: [{ branch_code: 7 }] }],
  });
  const res = await darDeAlta(solicitud({ decision: { tipo: 'usar', clienteId: 77 } }), operam.deps);

  assert.equal(res.tipo, 'pregunta');
  assert.equal(res.motivo, 'candidatos');
  assert.equal(operam.pedidos('crearClienteDirecto').length, 0);
  assert.equal(operam.pedidos('crearBranchCliente').length, 0);
});

test('otro domicilio de un Cliente Operam que ya no esta en la lista vuelve a preguntar sin crear el domicilio', async () => {
  const operam = operamEnMemoria({
    clientes: [{ customer_id: 41, CustName: 'Otra Cosa SA', cust_ref: 'Otra', tax_id: 'XAXX010101000', branches: [{ branch_code: 7 }] }],
  });
  const res = await darDeAlta(solicitud({
    domicilioEntrega: DOMICILIO,
    decision: { tipo: 'otro-domicilio', clienteId: 77 },
  }), operam.deps);

  assert.equal(res.tipo, 'pregunta');
  assert.equal(res.motivo, 'candidatos');
  assert.equal(operam.pedidos('crearBranchCliente').length, 0);
});

test('en el alta con datos fiscales el Cliente Operam elegido que ya no esta en el pool vuelve a preguntar', async () => {
  const operam = operamEnMemoria({
    clientes: [{ customer_id: 61, CustName: 'HOTELES AZULES SA DE CV', cust_ref: 'Otro', tax_id: RFC_REAL, branches: [{ branch_code: 3 }] }],
  });
  const res = await darDeAlta(solicitudFiscal({ decision: { tipo: 'usar', clienteId: 88 } }), operam.deps);

  assert.equal(res.tipo, 'pregunta');
  assert.equal(res.motivo, 'candidatos');
  assert.deepEqual(res.candidatos.map(c => c.id), [61]);
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

// #431: el GET /branches/:code no expone el telefono ni el correo del domicilio
// (el adaptador lo modela como Operam); quien los trae es `branches[]` de
// GET /customers/:id. El alta del Cliente Operam 530 salia con "Operam ignoro
// phone" sobre un telefono que SI quedo guardado.
test('el telefono del domicilio de entrega se verifica contra GET /customers/:id, que si lo expone (#431)', async () => {
  const operam = operamEnMemoria();
  const res = await darDeAlta(solicitud({ domicilioEntrega: DOMICILIO }), operam.deps);

  assert.equal(res.tipo, 'lograda');
  assert.equal(operam.pedidos('obtenerClientePorId').length, 1, 'la verificacion del Cel reusa la misma relectura del cliente');
  const releido = await operam.deps.obtenerBranch(res.domicilioId);
  assert.equal(releido.phone, undefined, 'GET /branches/:code no trae phone');
  const enCliente = (await operam.deps.obtenerClientePorId(res.clienteId)).branches
    .find(b => String(b.branch_code) === String(res.domicilioId));
  assert.equal(enCliente.phone, DOMICILIO.telefono, 'GET /customers/:id si lo trae');
  const verificacion = paso(res, 'verificar branch');
  assert.equal(verificacion.status, 'ok');
  assert.equal(verificacion.mensaje, 'El domicilio de entrega quedo guardado en Operam');
});

test('un telefono del domicilio de entrega que Operam de verdad no guardo sigue saliendo como aviso (#431)', async () => {
  const operam = operamEnMemoria({ ignoraBranch: ['phone'] });
  const res = await darDeAlta(solicitud({ domicilioEntrega: DOMICILIO }), operam.deps);

  assert.equal(res.tipo, 'lograda');
  const verificacion = paso(res, 'verificar branch');
  assert.equal(verificacion.status, 'warn');
  assert.equal(verificacion.mensaje, 'El domicilio de entrega no quedo completo en Operam');
  assert.deepEqual(verificacion.camposNoActualizados.map(x => [x.campo, x.nuevo]), [['phone', DOMICILIO.telefono]]);
  assert.match(verificacion.detalle, /Operam ignoro phone/);
});

// Sin GET /customers/:id el telefono y el correo no se pudieron leer: salen de la
// comparacion (patron noLegible de #373) y el detalle lo dice, en vez de afirmar
// que Operam los ignoro. La calle, que SI trae GET /branches/:code, se sigue
// verificando.
test('si GET /customers/:id falla, el telefono del domicilio queda sin comprobar y no se reporta como ignorado (#431)', async () => {
  const operam = operamEnMemoria({ falla: { obtenerClientePorId: 'Operam 503' } });
  const res = await darDeAlta(solicitud({ domicilioEntrega: DOMICILIO }), operam.deps);

  assert.equal(res.tipo, 'lograda');
  const verificacion = paso(res, 'verificar branch');
  assert.equal(verificacion.status, 'ok');
  assert.match(verificacion.detalle, /phone, email sin comprobar/);
  assert.match(verificacion.detalle, /Operam 503/);
  assert.equal(paso(res, 'verificar Cel').status, 'error');
});

// #386: el PUT de branch EXIGE br_ref -- sin el Operam responde 406 ("La
// referencia de sucursal es requerida") y el domicilio capturado en el paso Envio
// nunca se aplica. Como ese paso no captura referencia corta, la del branch que
// Operam auto-creo se relee y se reenvia tal cual: el PUT es REPLACE, asi que
// omitirla (#96) no la conservaba, la rechazaba.
test('el domicilio de entrega del paso Envio viaja con la referencia que Operam auto-creo, sin cambiarla', async () => {
  const operam = operamEnMemoria();
  const res = await darDeAlta(solicitud({ domicilioEntrega: DOMICILIO }), operam.deps);

  assert.equal(res.tipo, 'lograda');
  const [put] = operam.pedidos('actualizarBranchCliente');
  assert.equal(put.args[2].br_ref, 'AUTO', 'el PUT reenvia la referencia releida del branch');
  assert.equal(operam.branch(res.domicilioId).branch_ref, 'AUTO', 'la referencia del domicilio no cambia por el PUT');
  assert.equal(operam.branch(res.domicilioId).addr_street, 'Av. Reforma 100');
});

// El alta completa SI captura referencia corta (#366) y esa es la que manda: la
// releida solo cubre al paso Envio, que no la captura (#386).
test('el alta completa manda la referencia corta capturada, no la que Operam auto-creo', async () => {
  const operam = operamEnMemoria();
  const res = await darDeAlta(solicitudFiscal({
    domicilioEntrega: { ...DOMICILIO, referenciaCorta: 'ALMCEN' },
  }), operam.deps);

  assert.equal(res.tipo, 'lograda');
  const [put] = operam.pedidos('actualizarBranchCliente');
  assert.equal(put.args[2].br_ref, 'ALMCEN');
  assert.equal(operam.branch(res.domicilioId).branch_ref, 'ALMCEN');
});

// La relectura previa es best effort: si truena, el PUT sale igual (sin ella
// actualizarBranchCliente cae a br_name) en vez de perder el domicilio capturado.
test('el domicilio de entrega se escribe aunque la relectura previa del branch falle', async () => {
  const operam = operamEnMemoria({ falla: { obtenerBranch: 'Operam 500' } });
  const res = await darDeAlta(solicitud({ domicilioEntrega: DOMICILIO }), operam.deps);

  assert.equal(res.tipo, 'lograda');
  assert.equal(operam.pedidos('actualizarBranchCliente').length, 1);
  assert.equal(paso(res, 'PUT branch (domicilio)').status, 'ok');
  assert.equal(operam.branch(res.domicilioId).addr_street, 'Av. Reforma 100');
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

// === Upgrade fiscal (#367; #85, #207, #360, #253) ===========================
// El Cliente Operam que nacio sin datos fiscales se completa con la CSF (o con
// los minimos capturados a mano). Nunca nace uno nuevo aqui.

const CSF = {
  rfc: 'HAC010203AB1', razonSocial: 'HOTEL AZUL CENTRO SA DE CV', idcif: 'IDCIF9',
  calle: 'Reforma', numExt: '100', numInt: '', colonia: 'Juarez',
  cp: '06600', municipio: 'Cuauhtemoc', estado: 'CDMX', regimenFiscal: '601',
};

// Cliente Operam sin datos fiscales tal como lo devuelve el GET de detalle: RFC
// generico, nombre corto igual al nombre con el que nacio y segmento anidado.
function sinDatosFiscales(over = {}) {
  return {
    customer_id: 500, CustName: 'Hotel Azul Centro', cust_ref: 'Hotel Azul Centro',
    tax_id: 'XAXX010101000', segmento: { id: '1' },
    branches: [{ branch_code: 7, br_name: 'HOTEL AZUL CENTRO' }], contacts: [],
    ...over,
  };
}

test('el upgrade fiscal escribe los datos de la CSF sobre el mismo Cliente Operam, sin crear ninguno', async () => {
  const operam = operamEnMemoria({ clientes: [sinDatosFiscales()] });
  const res = await upgradeFiscal(500, CSF, operam.deps);

  assert.equal(res.tipo, 'lograda');
  assert.equal(res.clienteId, 500);
  assert.deepEqual(res.camposNoAplicados, []);
  assert.equal(operam.pedidos('crearClienteDirecto').length, 0);
  // El domicilio de entrega no se toca NUNCA en el upgrade: el PUT es un REPLACE
  // destructivo sobre uno ya configurado (#189, danos reales en #195).
  assert.equal(operam.pedidos('actualizarBranchCliente').length, 0);
  assert.equal(operam.pedidos('crearBranchCliente').length, 0);
  const fresco = operam.cliente(500);
  assert.equal(fresco.tax_id, 'HAC010203AB1');
  assert.equal(fresco.CustName, 'HOTEL AZUL CENTRO SA DE CV');
  assert.equal(fresco.postal_code, '06600');
});

test('el RFC que ya pertenece a otro Cliente Operam bloquea la fusion, lo nombra y no escribe nada', async () => {
  const operam = operamEnMemoria({
    clientes: [sinDatosFiscales(), { customer_id: 800, CustName: 'Hotel Azul SA de CV', tax_id: 'HAC010203AB1', branches: [] }],
  });
  const res = await upgradeFiscal(500, CSF, operam.deps);

  assert.equal(res.tipo, 'bloqueo');
  assert.equal(res.motivo, 'fusion');
  assert.match(res.mensaje, /Hotel Azul SA de CV \(800\)/);
  assert.match(res.mensaje, /No se cambio nada/);
  assert.match(res.mensaje, /unificarlas a mano en Operam/);
  assert.ok(!/fusion/.test(res.mensaje), 'la jerga del modulo no llega al vendedor');
  assert.match(res.detalle, /fusion manual, la API no unifica cuentas/);
  assert.equal(res.dueno.cliente_id, 800);
  assert.equal(res.dueno.nombre, 'Hotel Azul SA de CV');
  assert.equal(operam.pedidos('actualizarClienteDirecto').length, 0);
  const auditoria = operam.estado.auditoria.find(a => a[2] === 'fusion-bloqueada');
  assert.ok(auditoria, 'la fusion bloqueada queda en la auditoria');
  assert.equal(auditoria[3], 800);
});

test('el campo que Operam ignora sale como campo no aplicado, con mensaje y detalle', async () => {
  const operam = operamEnMemoria({ clientes: [sinDatosFiscales()], ignoraCliente: ['cust_name'] });
  const res = await upgradeFiscal(500, CSF, operam.deps);

  assert.equal(res.tipo, 'lograda');
  assert.equal(res.camposNoAplicados.length, 1);
  const campo = res.camposNoAplicados[0];
  assert.equal(campo.campo, 'CustName');
  assert.equal(campo.label, 'Razon Social');
  assert.equal(campo.esperado, 'HOTEL AZUL CENTRO SA DE CV');
  assert.equal(campo.leido, 'Hotel Azul Centro');
  assert.match(campo.mensaje, /Razon Social/);
  assert.ok(campo.detalle, 'el detalle tecnico acompana al mensaje');
});

// El segmento no lo escribe la API v3 por ningun camino (#172): lo aplica el
// post-fix por la web legacy, que corre antes de la relectura.
test('el segmento que la web si aplico deja de reportarse como campo no aplicado', async () => {
  const operam = operamEnMemoria({ clientes: [sinDatosFiscales()], ignoraCliente: ['segmento_id'] });
  const res = await upgradeFiscal(500, { ...CSF, segmentoId: '3' }, operam.deps);

  assert.equal(res.tipo, 'lograda');
  assert.deepEqual(res.camposNoAplicados, []);
  assert.equal(paso(res, 'segmento').status, 'ok');
});

test('el segmento que la web no pudo escribir sale como paso con el motivo real, no como campo ignorado', async () => {
  const operam = operamEnMemoria({
    clientes: [sinDatosFiscales()],
    ignoraCliente: ['segmento_id'],
    segmentoWeb: { ok: false, error: 'El codigo postal no puede ser vacio' },
  });
  const res = await upgradeFiscal(500, { ...CSF, segmentoId: '3' }, operam.deps);

  assert.equal(res.tipo, 'lograda');
  const pasoSegmento = paso(res, 'segmento');
  assert.equal(pasoSegmento.status, 'error');
  assert.match(pasoSegmento.detalle, /codigo postal/);
  assert.equal(res.camposNoAplicados.find(c => c.campo === 'segmento_id'), undefined,
    'el motivo real ya viaja en el paso: repetirlo como campo ignorado por el PUT seria falso');
});

// #253: esta es la via para corregir un segmento mal asignado -- el vendedor lo
// edita a proposito, asi que se escribe aunque el cliente ya tuviera otro.
test('el segmento elegido se escribe aunque el Cliente Operam ya tuviera otro, y el resultado dice de cual a cual', async () => {
  const operam = operamEnMemoria({
    clientes: [sinDatosFiscales({ segmento: { id: '5' } })],
    ignoraCliente: ['segmento_id'],
  });
  const res = await upgradeFiscal(500, { ...CSF, segmentoId: '3' }, operam.deps);

  assert.equal(res.tipo, 'lograda');
  assert.deepEqual(res.segmento, { anterior: '5', actual: '3' });
  assert.equal(operam.cliente(500).segmento.id, '3');
  assert.equal(operam.pedidos('actualizarSegmentoClienteWeb')[0].args[2], undefined,
    'sin soloSinSegmento: el segmento ya asignado no frena la correccion');
  const auditoria = operam.estado.auditoria.find(a => a[2] === 'segmento-escrito');
  assert.ok(auditoria, 'la correccion del segmento queda en la auditoria');
  assert.match(auditoria[6], /5 -> 3/);
});

// #360: el nombre corto es el nombre comercial del cliente, no su razon social.
test('el upgrade fiscal no toca el nombre corto propio del Cliente Operam', async () => {
  const operam = operamEnMemoria({ clientes: [sinDatosFiscales({ cust_ref: 'Azulito' })] });
  const res = await upgradeFiscal(500, { ...CSF, nombreCorto: 'Hotel Azul Centro' }, operam.deps);

  assert.equal(res.tipo, 'lograda');
  assert.equal(operam.cliente(500).cust_ref, 'Azulito');
  assert.equal(operam.pedidos('actualizarClienteDirecto')[0].args[1].cust_ref, undefined);
  assert.equal(paso(res, 'nombre corto').status, 'omitido');
  // #379: lo que el modulo decidio no mandar no puede salir como "Operam lo
  // ignoro" -- seria pedirle al vendedor que corrija algo que esta bien.
  assert.deepEqual(res.camposNoAplicados, []);
  assert.equal(paso(res, 'verificar fiscal').status, 'ok');
});

// #379: lo que absuelve al campo es haberlo omitido, no llamarse cust_ref: uno que
// SI viajo y Operam ignoro sigue siendo un pendiente del vendedor.
test('el nombre corto que Operam ignora en el PUT si sale como campo no aplicado', async () => {
  const operam = operamEnMemoria({ clientes: [sinDatosFiscales()], ignoraCliente: ['cust_ref'] });
  const res = await upgradeFiscal(500, { ...CSF, nombreCorto: 'Hotel Azul' }, operam.deps);

  assert.equal(res.tipo, 'lograda');
  assert.equal(paso(res, 'nombre corto'), undefined);
  assert.deepEqual(res.camposNoAplicados.map(c => c.campo), ['cust_ref']);
});

test('el upgrade fiscal si llena el nombre corto que dejo el alta generica', async () => {
  const operam = operamEnMemoria({ clientes: [sinDatosFiscales()] });
  const res = await upgradeFiscal(500, { ...CSF, nombreCorto: 'Hotel Azul' }, operam.deps);

  assert.equal(res.tipo, 'lograda');
  assert.equal(operam.cliente(500).cust_ref, 'Hotel Azul');
  assert.equal(paso(res, 'nombre corto'), undefined);
});

test('el nombre corto que el vendedor no capturo NO borra el que el Cliente Operam ya tenia', async () => {
  const operam = operamEnMemoria({ clientes: [sinDatosFiscales()] });
  const res = await upgradeFiscal(500, { ...CSF, nombreCorto: '' }, operam.deps);

  assert.equal(operam.cliente(500).cust_ref, 'Hotel Azul Centro');
  assert.equal(operam.pedidos('actualizarClienteDirecto')[0].args[1].cust_ref, undefined);
  assert.equal(paso(res, 'nombre corto').status, 'omitido');
  assert.deepEqual(res.camposNoAplicados, []);
});

test('el nombre corto que ya usa otro Cliente Operam bloquea el upgrade pidiendo cambiarlo', async () => {
  const operam = operamEnMemoria({
    clientes: [sinDatosFiscales()],
    falla: { actualizarClienteDirecto: 'Operam 406: Already exists customer with same cust_ref' },
  });
  const res = await upgradeFiscal(500, { ...CSF, nombreCorto: 'Hotel Azul' }, operam.deps);

  assert.equal(res.tipo, 'bloqueo');
  assert.equal(res.motivo, 'cust-ref-duplicado');
  assert.match(res.mensaje, /"Hotel Azul" ya lo usa otro Cliente Operam/);
  assert.match(res.mensaje, /Cambialo/);
  assert.match(res.detalle, /same cust_ref/);
});

test('el upgrade fiscal llena el nombre corto vacio', async () => {
  const operam = operamEnMemoria({ clientes: [sinDatosFiscales({ cust_ref: '' })] });
  await upgradeFiscal(500, { ...CSF, nombreCorto: 'Hotel Azul' }, operam.deps);

  assert.equal(operam.cliente(500).cust_ref, 'Hotel Azul');
});

// #95 regla 5 y #171: lo que no tiene campo propio en la API viaja compuesto
// sobre las notas del cliente, sin borrar las que ya tenia.
test('el Tax ID extranjero se antepone a las notas que el Cliente Operam ya tenia', async () => {
  const operam = operamEnMemoria({ clientes: [sinDatosFiscales({ notes: 'Notas previas del cliente' })] });
  await upgradeFiscal(500, { ...CSF, taxIdExtranjero: 'US123456789' }, operam.deps);

  assert.equal(operam.cliente(500).notes, 'Tax ID: US123456789\nNotas previas del cliente');
});

test('las notas que Operam no guardo salen como campo no aplicado', async () => {
  const operam = operamEnMemoria({
    clientes: [sinDatosFiscales({ notes: 'Notas previas del cliente' })],
    ignoraCliente: ['notes'],
  });
  const res = await upgradeFiscal(500, { ...CSF, actividades: ['Comercio al por menor'], csf_fecha: '8 DE MAYO DE 2026' }, operam.deps);

  const notas = res.camposNoAplicados.find(c => c.campo === 'notes');
  assert.ok(notas, 'las actividades que no quedaron en las notas se reportan');
  assert.equal(notas.label, 'Actividades economicas');
  assert.ok(notas.detalle.includes('Actividades economicas (CSF 8 DE MAYO DE 2026):'));
});

// #327: sin entrada fresca que meterle al padron cacheado, el unico camino
// honesto es releerlo entero en vez de dejarlo viejo una hora.
test('si la relectura falla, el upgrade sigue logrado y el padron se refresca entero', async () => {
  const operam = operamEnMemoria({
    clientes: [sinDatosFiscales()],
    falla: { obtenerClientePorId: 'Operam 503' },
  });
  const res = await upgradeFiscal(500, CSF, operam.deps);

  assert.equal(res.tipo, 'lograda');
  assert.equal(paso(res, 'verificar fiscal').status, 'error');
  assert.equal(operam.pedidos('refrescarIndice').length, 1);
  assert.equal(operam.pedidos('actualizarClienteEnCache').length, 0);
});

test('el upgrade fiscal no puede completarse si Operam rechaza el PUT', async () => {
  const operam = operamEnMemoria({
    clientes: [sinDatosFiscales()],
    falla: { actualizarClienteDirecto: 'Operam 500' },
  });
  const res = await upgradeFiscal(500, CSF, operam.deps);

  assert.equal(res.tipo, 'bloqueo');
  assert.equal(res.motivo, 'operam');
  assert.match(res.detalle, /Operam 500/);
});

test('todo paso del upgrade fiscal lleva mensaje para el vendedor y detalle tecnico', async () => {
  const operam = operamEnMemoria({ clientes: [sinDatosFiscales()], ignoraCliente: ['segmento_id'] });
  const res = await upgradeFiscal(500, { ...CSF, segmentoId: '3' }, operam.deps);

  for (const p of res.pasos) {
    assert.ok(p.mensaje, `el paso ${p.name} no trae mensaje`);
    assert.ok(p.detalle, `el paso ${p.name} no trae detalle`);
    assert.doesNotMatch(p.mensaje, /sucursal|branch|customer|endpoint/i, `el paso ${p.name} usa vocabulario tecnico en el mensaje`);
  }
});

// === #356: el id de la fila de auditoria sale del modulo ===
// clientes_log.dropbox_ok se escribia SIEMPRE en null porque al insertar el log
// la subida de la constancia todavia no resolvia. Quien la respalda (el
// endpoint, no el modulo) necesita saber QUE fila corregir despues, y la fila es
// la del alta -- no la ultima del cliente, que puede ser de otro intento.

// logCliente devuelve el id de lo que inserto (#356). Aqui se numeran las
// llamadas para poder afirmar a CUAL de ellas corresponde el logId devuelto.
function conAuditoriaNumerada(deps) {
  const filas = [];
  return {
    filas,
    deps: { ...deps, logCliente: (...args) => { filas.push(args); return filas.length; } },
  };
}

test('el alta devuelve el id de la fila de auditoria del cliente que creo (#356)', async () => {
  const operam = operamEnMemoria();
  const auditoria = conAuditoriaNumerada(operam.deps);
  const res = await darDeAlta(solicitudFiscal({ domicilioEntrega: DOMICILIO }), auditoria.deps);

  assert.equal(res.tipo, 'lograda');
  assert.equal(res.creadoNuevo, true);
  const esperado = auditoria.filas.findIndex(a => a[2] === 'creado') + 1;
  assert.ok(esperado > 0, 'el alta registro la creacion en la auditoria');
  assert.equal(await res.logId, esperado);
});

test('el upgrade fiscal devuelve el id de la fila de auditoria de su actualizacion (#356)', async () => {
  const operam = operamEnMemoria({ clientes: [sinDatosFiscales()] });
  const auditoria = conAuditoriaNumerada(operam.deps);
  const res = await upgradeFiscal(500, CSF, auditoria.deps);

  assert.equal(res.tipo, 'lograda');
  const esperado = auditoria.filas.findIndex(a => a[2] === 'actualizado') + 1;
  assert.ok(esperado > 0, 'el upgrade registro la actualizacion en la auditoria');
  assert.equal(await res.logId, esperado);
});

// === #414: el domicilio nuevo de un Cliente Operam existente respeta su cartera ===
// En Operam el vendedor vive en el DOMICILIO de entrega y el "Reporte de Comisiones
// Por Flujo" paga por domicilio: ni el quote ni la factura tienen vendedor propio.
// Crear OTRO domicilio a nombre de quien captura partia la cartera del cliente en
// silencio. Regla (a') de Adrian (2026-09-22): si los domicilios ACTIVOS que el
// cliente ya tiene son de UNA sola persona, el nuevo nace a su nombre; si no, como
// hoy, pero diciendolo. Persona = su id de Operam esta en el registro de vendedores;
// los canales (Amazon, Shopify, Mostrador, Mercado Libre) y el vacio no lo estan.
// Ids reales de Operam (peltre-operam.md): 1 Adrian, 2 Alejandro, 3 Shopify.

const REGISTRO = [
  { name: 'Adrian Chavez', operam_id: 1 },
  { name: 'Alejandro Chavez', operam_id: 2 },
  { name: 'Jaime Abaroa', operam_id: null },
];

test('la cartera cuyos domicilios son de una sola persona le da esa persona al domicilio nuevo', () => {
  const r = vendedorDeCartera([
    { branch_code: '7', salesman: '2', inactive: '0' },
    { branch_code: '8', salesman: '2', inactive: '0' },
  ], REGISTRO);

  assert.equal(r.salesman, 2);
  assert.equal(r.motivo, 'persona-unica');
});

test('la cartera con dos personas distintas no le da vendedor al domicilio nuevo', () => {
  const r = vendedorDeCartera([
    { branch_code: '475', salesman: '1', inactive: '0' },
    { branch_code: '476', salesman: '2', inactive: '0' },
  ], REGISTRO);

  assert.equal(r.salesman, null);
  assert.equal(r.motivo, 'varias-personas');
});

// El vacio no es una persona aunque el registro tenga un vendedor SIN operam_id
// (Jaime Abaroa): comparar texto contra texto los empataria (la misma trampa de
// mapearSalesman en el backfill, #76).
test('la cartera de solo canales o domicilios sin vendedor no tiene persona', () => {
  const r = vendedorDeCartera([
    { branch_code: '203', salesman: '3', inactive: '0' },
    { branch_code: '54', salesman: '', inactive: '0' },
    { branch_code: '55', salesman: '0', inactive: '0' },
    { branch_code: '56', salesman: null, inactive: '0' },
    { branch_code: '57', inactive: '0' },
  ], REGISTRO);

  assert.equal(r.salesman, null);
  assert.equal(r.motivo, 'sin-persona');
});

test('un domicilio inactivo no cuenta para la cartera', () => {
  const r = vendedorDeCartera([
    { branch_code: '7', salesman: '2', inactive: '0' },
    { branch_code: '8', salesman: '1', inactive: '1' },
  ], REGISTRO);

  assert.equal(r.salesman, 2);
  assert.equal(r.motivo, 'persona-unica');
});

// --- darDeAlta: el domicilio nuevo ("es otro domicilio de este cliente") ---
// Los domicilios del cliente se leen como los devuelve GET /branches/:code: con el
// id `salesman` en texto e `inactive` "0"/"1" (llaves medidas en vivo, 2026-09-07,
// branch 564 del cliente 15). La lista de GET /customers/:id solo trae
// `salesman_name`, y el adaptador en memoria la modela asi.

function clienteConCartera(branches) {
  return { customer_id: 41, CustName: 'Hotel Azul Centro', cust_ref: 'Hotel Azul', tax_id: 'XAXX010101000', branches };
}

function otroDomicilioPedidoPor(vendedor, extra = {}) {
  return solicitud({
    comercial: { vendedor, tier: 'M100', salesTypeId: 15, segmentoId: null, correoFacturacion: '', usoCfdi: '' },
    domicilioEntrega: DOMICILIO,
    decision: { tipo: 'otro-domicilio', clienteId: 41 },
    ...extra,
  });
}

test('el domicilio nuevo de un cliente de otra persona nace a nombre de esa persona, no de quien lo pide', async () => {
  const operam = operamEnMemoria({
    vendedores: REGISTRO,
    clientes: [clienteConCartera([
      { branch_code: '7', br_name: 'Matriz', addr_street: 'Otra calle', addr_zip: '11000', salesman: '2', inactive: '0' },
      { branch_code: '8', br_name: 'Planta', addr_street: 'Camino viejo', addr_zip: '54000', salesman: '2', inactive: '0' },
    ])],
  });
  const res = await darDeAlta(otroDomicilioPedidoPor('Adrian Chavez'), operam.deps);

  assert.equal(res.tipo, 'lograda');
  const [post] = operam.pedidos('crearBranchCliente');
  assert.equal(post.args[1].salesman, 2, 'el POST viaja con el vendedor del cliente');
  const cartera = paso(res, 'vendedor branch');
  assert.equal(cartera.status, 'ok');
  assert.equal(cartera.mensaje, 'El domicilio nuevo queda a nombre de Alejandro Chavez, que atiende a este cliente');
  assert.match(cartera.detalle, /salesman 2/);
  assert.match(cartera.detalle, /7, 8/);
  assert.match(cartera.detalle, /pedia 1/);
});

test('el domicilio nuevo hereda a la persona aunque el cliente tenga tambien un domicilio de canal', async () => {
  const operam = operamEnMemoria({
    vendedores: REGISTRO,
    clientes: [clienteConCartera([
      { branch_code: '7', br_name: 'Matriz', addr_street: 'Otra calle', addr_zip: '11000', salesman: '2', inactive: '0' },
      { branch_code: '8', br_name: 'Tienda en linea', salesman: '3', inactive: '0' },
    ])],
  });
  const res = await darDeAlta(otroDomicilioPedidoPor('Adrian Chavez'), operam.deps);

  assert.equal(res.tipo, 'lograda');
  assert.equal(operam.pedidos('crearBranchCliente')[0].args[1].salesman, 2);
  assert.equal(operam.branch(res.domicilioId).salesman, 2);
  assert.equal(paso(res, 'vendedor branch').status, 'ok');
});

test('con dos personas en la cartera el domicilio nuevo va a quien lo pide y el paso avisa por que', async () => {
  const operam = operamEnMemoria({
    vendedores: REGISTRO,
    clientes: [clienteConCartera([
      { branch_code: '475', br_name: 'Estudio', salesman: '1', inactive: '0' },
      { branch_code: '476', br_name: 'Lemus', salesman: '2', inactive: '0' },
    ])],
  });
  const res = await darDeAlta(otroDomicilioPedidoPor('Adrian Chavez'), operam.deps);

  assert.equal(res.tipo, 'lograda');
  assert.equal(operam.pedidos('crearBranchCliente')[0].args[1].salesman, 1, 'como hoy: el vendedor de la solicitud');
  const aviso = paso(res, 'vendedor branch');
  assert.equal(aviso.status, 'warn');
  assert.equal(aviso.mensaje, 'El domicilio nuevo queda a nombre de Adrian Chavez: el cliente no tiene un vendedor unico en sus domicilios');
  assert.match(aviso.detalle, /475=1 Adrian Chavez/);
  assert.match(aviso.detalle, /476=2 Alejandro Chavez/);
});

test('con solo canales o vendedor vacio en la cartera el domicilio nuevo va a quien lo pide y el paso avisa', async () => {
  const operam = operamEnMemoria({
    vendedores: REGISTRO,
    clientes: [clienteConCartera([
      { branch_code: '203', br_name: 'Shopify', salesman: '3', inactive: '0' },
      { branch_code: '54', br_name: 'Bodega', salesman: '0', inactive: '0' },
    ])],
  });
  const res = await darDeAlta(otroDomicilioPedidoPor('Alejandro Chavez'), operam.deps);

  assert.equal(res.tipo, 'lograda');
  assert.equal(operam.pedidos('crearBranchCliente')[0].args[1].salesman, 2);
  const aviso = paso(res, 'vendedor branch');
  assert.equal(aviso.status, 'warn');
  assert.equal(aviso.mensaje, 'El domicilio nuevo queda a nombre de Alejandro Chavez: el cliente no tiene un vendedor unico en sus domicilios');
  assert.match(aviso.detalle, /203=3 \(fuera del registro de vendedores\)/);
});

test('un domicilio inactivo de otra persona no le quita la cartera al domicilio nuevo', async () => {
  const operam = operamEnMemoria({
    vendedores: REGISTRO,
    clientes: [clienteConCartera([
      { branch_code: '7', br_name: 'Matriz', salesman: '2', inactive: '0' },
      { branch_code: '8', br_name: 'Vieja', salesman: '1', inactive: '1' },
    ])],
  });
  const res = await darDeAlta(otroDomicilioPedidoPor('Adrian Chavez'), operam.deps);

  assert.equal(res.tipo, 'lograda');
  assert.equal(operam.pedidos('crearBranchCliente')[0].args[1].salesman, 2);
  assert.equal(paso(res, 'vendedor branch').status, 'ok');
});

// La cartera es un paso mas del domicilio nuevo y NUNCA lo bloquea: sin registro
// de vendedores no se sabe de quien es el cliente, asi que se escribe como antes
// de #414 y el paso lo dice. El alta completa manda el id del selector
// (`salesmanId`), asi que ahi el registro solo lo lee la cartera.
test('sin registro de vendedores el domicilio nuevo se crea con el vendedor de la solicitud y el paso avisa', async () => {
  const operam = operamEnMemoria({
    vendedores: REGISTRO,
    falla: { listar: 'Neon no responde' },
    clientes: [clienteConCartera([
      { branch_code: '7', br_name: 'Matriz', salesman: '2', inactive: '0' },
    ])],
  });
  const res = await darDeAlta(otroDomicilioPedidoPor('Adrian Chavez', {
    comercial: { vendedor: 'Adrian Chavez', salesmanId: '1', tier: 'M100', salesTypeId: 15, segmentoId: null, correoFacturacion: '', usoCfdi: '' },
  }), operam.deps);

  assert.equal(res.tipo, 'lograda');
  assert.equal(operam.pedidos('crearBranchCliente')[0].args[1].salesman, '1');
  const aviso = paso(res, 'vendedor branch');
  assert.equal(aviso.status, 'warn');
  assert.equal(aviso.mensaje, 'El domicilio nuevo queda con el vendedor que se pidio: no se pudo revisar quien atiende a este cliente');
  assert.match(aviso.detalle, /Neon no responde/);
});

// Sin regresion: el Cliente Operam que nace en ESTA corrida no tiene cartera que
// heredar, asi que su domicilio sigue naciendo con el vendedor de la solicitud.
test('el cliente recien creado sigue naciendo con el vendedor de la solicitud, sin paso de cartera', async () => {
  const operam = operamEnMemoria({ vendedores: REGISTRO });
  const res = await darDeAlta(solicitud({
    comercial: { vendedor: 'Adrian Chavez', tier: 'M100', salesTypeId: 15, segmentoId: null, correoFacturacion: '', usoCfdi: '' },
    domicilioEntrega: DOMICILIO,
  }), operam.deps);

  assert.equal(res.tipo, 'lograda');
  assert.equal(res.creadoNuevo, true);
  assert.equal(operam.pedidos('crearClienteDirecto')[0].args[0].salesman, 1);
  assert.equal(operam.pedidos('actualizarBranchCliente')[0].args[2].salesman, 1);
  assert.equal(paso(res, 'vendedor branch'), undefined);
});

// Sin regresion: el reintento que encuentra el domicilio de un intento anterior no
// lo vuelve a escribir, y la cartera no entra en esa busqueda (nombre + calle + CP).
test('el reintento que reusa el domicilio equivalente no crea otro ni le cambia el vendedor', async () => {
  const operam = operamEnMemoria({
    vendedores: REGISTRO,
    clientes: [clienteConCartera([
      { branch_code: '7', br_name: 'Matriz', addr_street: 'Otra calle', addr_zip: '11000', salesman: '2', inactive: '0' },
      { branch_code: '9', br_name: DOMICILIO.nombre, addr_street: DOMICILIO.calle, addr_zip: DOMICILIO.cp, salesman: '1', inactive: '0' },
    ])],
  });
  const res = await darDeAlta(otroDomicilioPedidoPor('Adrian Chavez'), operam.deps);

  assert.equal(res.tipo, 'lograda');
  assert.equal(res.domicilioId, '9');
  assert.equal(paso(res, 'POST branch').status, 'omitido');
  assert.equal(operam.pedidos('crearBranchCliente').length, 0);
  assert.equal(operam.pedidos('actualizarBranchCliente').length, 0);
  assert.equal(operam.branch('9').salesman, '1');
  assert.equal(paso(res, 'vendedor branch'), undefined);
});

// El aviso nombra lo que de verdad se escribio: un id que el registro no conoce
// (el selector del alta solo ofrece el registro, pero el cuerpo puede traer otro)
// sigue viajando, asi que decir "sin vendedor" seria falso.
test('el aviso de la cartera nombra por su id al vendedor pedido que el registro no conoce', async () => {
  const operam = operamEnMemoria({
    vendedores: REGISTRO,
    clientes: [clienteConCartera([
      { branch_code: '475', br_name: 'Estudio', salesman: '1', inactive: '0' },
      { branch_code: '476', br_name: 'Lemus', salesman: '2', inactive: '0' },
    ])],
  });
  const res = await darDeAlta(otroDomicilioPedidoPor('Adrian Chavez', {
    comercial: { vendedor: 'Adrian Chavez', salesmanId: '7', tier: 'M100', salesTypeId: 15, segmentoId: null, correoFacturacion: '', usoCfdi: '' },
  }), operam.deps);

  assert.equal(operam.pedidos('crearBranchCliente')[0].args[1].salesman, '7');
  assert.equal(paso(res, 'vendedor branch').mensaje,
    'El domicilio nuevo queda a nombre del vendedor 7 de Operam: el cliente no tiene un vendedor unico en sus domicilios');
});

// Un vendedor del registro sin operam_id (Jaime Abaroa) no resuelve ningun
// `salesman`: el domicilio viaja sin vendedor, como antes de #414, y el aviso lo dice.
test('sin vendedor que escribir y sin persona unica el aviso dice que el domicilio nuevo queda sin vendedor', async () => {
  const operam = operamEnMemoria({
    vendedores: REGISTRO,
    clientes: [clienteConCartera([
      { branch_code: '475', br_name: 'Estudio', salesman: '1', inactive: '0' },
      { branch_code: '476', br_name: 'Lemus', salesman: '2', inactive: '0' },
    ])],
  });
  const res = await darDeAlta(otroDomicilioPedidoPor('Jaime Abaroa'), operam.deps);

  assert.equal(res.tipo, 'lograda');
  assert.ok(!('salesman' in operam.pedidos('crearBranchCliente')[0].args[1]));
  assert.equal(paso(res, 'vendedor branch').mensaje,
    'El domicilio nuevo queda sin vendedor: el cliente no tiene un vendedor unico en sus domicilios');
});

// #433, de punta a punta: los pasos que el MODULO emite al crear otro domicilio
// sobre un Cliente Operam de cartera unica, pasados por el panel del alta completa
// y por el slot de la subida. Con pasos escritos a mano el panel podia verse bien
// y no ser lo que el modulo manda (la leccion de #374).
test('la herencia del domicilio nuevo se lee en el panel del alta y en la subida, y Crear cliente no se palomea', async () => {
  const { interpretarRespuestaAlta, ALTA_PASO_FILA } = await import('../public/js/alta-logica.js');
  const { pasosParaMostrar } = await import('../public/js/pipeline-logica.js');
  const operam = operamEnMemoria({
    vendedores: REGISTRO,
    clientes: [clienteConCartera([
      { branch_code: '7', br_name: 'Matriz', addr_street: 'Otra calle', addr_zip: '11000', salesman: '2', inactive: '0' },
    ])],
  });
  const res = await darDeAlta(otroDomicilioPedidoPor('Adrian Chavez'), operam.deps);
  assert.equal(res.tipo, 'lograda');

  const { filas, exito } = interpretarRespuestaAlta({ ok: true, steps: res.pasos });
  const fila = n => filas.find(f => f.fila === ALTA_PASO_FILA[n]);
  assert.equal(exito, true);
  const vendedor = fila('vendedor branch');
  assert.equal(vendedor.oculta, false);
  assert.equal(vendedor.status, 'ok');
  assert.equal(vendedor.msg, 'El domicilio nuevo queda a nombre de Alejandro Chavez, que atiende a este cliente');
  const arriba = fila('POST customer');
  assert.equal(arriba.status, 'omitido', 'no se creo ningun Cliente Operam: solo el domicilio');
  assert.match(arriba.msg, /se le agrega un domicilio de entrega/);

  const subida = pasosParaMostrar(res.pasos);
  assert.ok(subida.some(p => p.estado === 'ok' && p.mensaje === 'El domicilio nuevo queda a nombre de Alejandro Chavez, que atiende a este cliente'),
    JSON.stringify(subida));
});

test('sin paso de cartera (cliente recien creado) la fila del vendedor del domicilio nuevo no aparece en el panel', async () => {
  const { interpretarRespuestaAlta, ALTA_PASO_FILA } = await import('../public/js/alta-logica.js');
  const operam = operamEnMemoria({ vendedores: REGISTRO });
  const res = await darDeAlta(solicitud({
    comercial: { vendedor: 'Adrian Chavez', tier: 'M100', salesTypeId: 15, segmentoId: null, correoFacturacion: '', usoCfdi: '' },
    domicilioEntrega: DOMICILIO,
  }), operam.deps);
  assert.equal(res.tipo, 'lograda');

  const { filas } = interpretarRespuestaAlta({ ok: true, steps: res.pasos });
  assert.equal(filas.find(f => f.fila === ALTA_PASO_FILA['vendedor branch']).oculta, true);
  assert.equal(filas.find(f => f.fila === ALTA_PASO_FILA['POST customer']).status, 'ok', 'el cliente si nacio en esta alta');
});
