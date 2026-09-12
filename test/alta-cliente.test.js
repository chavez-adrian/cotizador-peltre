import { test } from 'node:test';
import assert from 'node:assert/strict';
import { darDeAlta, upgradeFiscal } from '../lib/alta-cliente.js';
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
  assert.match(res.mensaje, /Hotel Azul SA de CV/);
  assert.match(res.mensaje, /fusion manual/);
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
