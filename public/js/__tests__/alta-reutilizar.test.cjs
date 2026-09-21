'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

// Reutilizar Cliente Operam y domicilio en el alta completa (#371). Al elegir "Usar
// este Cliente Operam" y un domicilio suyo, la Seccion 2 se abre con lo que el
// cliente YA tiene en Operam y la Seccion 3 deja de pedir una captura que el modulo
// tira (con decision.tipo === 'usar' no hay PUT de branch, verificado en
// test/alta-cliente.test.js). Aqui vive la logica PURA de esas dos decisiones.

let precargaComercialUpgrade;
let altaReutilizaDomicilio;
let domicilioReutilizadoDelAlta;
let filasDomicilioReutilizado;
let entregaDeDomicilioOperam;
let buildClienteDesdeAlta;
let comercialDelAltaReutilizada;
let estadoAltaAlAbrirPanel;
let buildAltaDarDeAltaPayload;
let usoCfdiParaPayload;

// Dos domicilios del cliente 522, con la forma exacta que devuelve
// GET /api/operam/clientes/:id/domicilios (obtenerDomicilios en lib/operam-client.js).
const DOMICILIOS_522 = [
  {
    branch_code: 570, descripcion: 'Matriz', calle: 'Av Insurgentes Sur 1234',
    numInt: '3B', colonia: 'Del Valle', cp: '03100', municipio: 'Benito Juarez',
    estado: 'CDMX', contacto: 'Laura Mena', email: 'entregas@cliente.mx',
    telefono: '5512345678',
  },
  {
    branch_code: 571, descripcion: 'Bodega Norte', calle: 'Calle 5 de Mayo 20',
    numInt: '', colonia: 'Centro', cp: '54000', municipio: 'Tlalnepantla',
    estado: 'Mexico', contacto: '', email: '', telefono: '',
  },
];

before(async () => {
  ({
    precargaComercialUpgrade,
    altaReutilizaDomicilio,
    domicilioReutilizadoDelAlta,
    filasDomicilioReutilizado,
    entregaDeDomicilioOperam,
    buildClienteDesdeAlta,
    comercialDelAltaReutilizada,
    estadoAltaAlAbrirPanel,
    buildAltaDarDeAltaPayload,
    usoCfdiParaPayload,
  } = await import('../alta-logica.js'));
});

// El uso de CFDI SI es legible desde Operam (a diferencia de invoice_email e idcif,
// marcados noLegible en DIFF_FISCAL_CAMPOS por #373): el alta tiene que poder
// mostrarle al vendedor el que el cliente ya tiene, en vez del G03 con el que nace
// el selector.

test('R1: precargaComercialUpgrade lee el uso de CFDI con la llave real del GET', () => {
  const pre = precargaComercialUpgrade({
    customer_id: 522, sales_type: '15', timbrado_uso_cfdi: 'S01',
  });
  assert.equal(pre.usoCfdi, 'S01');
});

test('R2: precargaComercialUpgrade devuelve cadena vacia cuando el cliente no trae uso de CFDI', () => {
  const pre = precargaComercialUpgrade({ customer_id: 522 });
  assert.equal(pre.usoCfdi, '');
});

// Quien decide si la Seccion 3 pide captura es la eleccion de la Seccion 1, la misma
// que arma la `decision` del POST (altaState.clienteExistente): con un domicilio suyo
// elegido el modulo no escribe ningun branch, asi que capturar uno es tirarlo.

test('R3: con un domicilio del Cliente Operam elegido, la Seccion 3 no exige captura', () => {
  assert.equal(altaReutilizaDomicilio({ id: 61, branchIdx: 0, branchCode: 3 }), true);
});

test('R4: "Crear nuevo domicilio" sigue exigiendo la captura de la Seccion 3', () => {
  assert.equal(altaReutilizaDomicilio({ id: 61, branchIdx: 'nuevo', branchCode: null }), false);
});

test('R5: un alta sin Cliente Operam elegido exige la captura de la Seccion 3', () => {
  assert.equal(altaReutilizaDomicilio(null), false);
});

test('R6: el Cliente Operam elegido sin domicilio todavia elegido exige la captura', () => {
  // Estado intermedio real: altaDedupUsarCliente fija el cliente y recien entonces
  // pide sus domicilios. Hasta que el vendedor marque uno no hay nada que mostrar.
  assert.equal(altaReutilizaDomicilio({ id: 61 }), false);
});

// Cual es el domicilio elegido. El branch_code manda sobre el indice: es lo que
// identifica al domicilio en Operam y lo que viaja en decision.domicilioId (#252),
// mientras que el indice depende del orden con el que llego la lista.

test('R7: el domicilio elegido se resuelve por su branch_code, no por su posicion', () => {
  const d = domicilioReutilizadoDelAlta({ id: 522, branchIdx: 1, branchCode: 570 }, DOMICILIOS_522);
  assert.equal(d.branch_code, 570);
  assert.equal(d.descripcion, 'Matriz');
});

test('R8: sin branch_code se cae al indice que marco el radio', () => {
  const d = domicilioReutilizadoDelAlta({ id: 522, branchIdx: 1, branchCode: null }, DOMICILIOS_522);
  assert.equal(d.branch_code, 571);
});

test('R9: con "Crear nuevo domicilio" no hay domicilio elegido que mostrar', () => {
  assert.equal(domicilioReutilizadoDelAlta({ id: 522, branchIdx: 'nuevo' }, DOMICILIOS_522), null);
});

test('R10: un branch_code que ya no esta en la lista no inventa domicilio', () => {
  assert.equal(domicilioReutilizadoDelAlta({ id: 522, branchIdx: 9, branchCode: 999 }, DOMICILIOS_522), null);
});

// Lo que la Seccion 3 muestra en solo lectura: pares etiqueta/valor, NUNCA HTML --
// el core no toca el DOM y quien pinta escapa con textContent.

test('R11: las filas del domicilio elegido llevan las etiquetas de la Seccion 3 con sus valores', () => {
  const filas = filasDomicilioReutilizado(DOMICILIOS_522[0]);
  const porEtiqueta = Object.fromEntries(filas.map(f => [f.etiqueta, f.valor]));
  assert.equal(porEtiqueta['Nombre del domicilio'], 'Matriz');
  assert.equal(porEtiqueta['Calle'], 'Av Insurgentes Sur 1234');
  assert.equal(porEtiqueta['Num. interior'], '3B');
  assert.equal(porEtiqueta['Colonia'], 'Del Valle');
  assert.equal(porEtiqueta['CP'], '03100');
  assert.equal(porEtiqueta['Ciudad / Municipio'], 'Benito Juarez');
  assert.equal(porEtiqueta['Estado'], 'CDMX');
  assert.equal(porEtiqueta['Telefono'], '5512345678');
  assert.equal(porEtiqueta['Email de entrega'], 'entregas@cliente.mx');
});

test('R12: un campo vacio en Operam no produce fila (nada de etiquetas huecas)', () => {
  const filas = filasDomicilioReutilizado(DOMICILIOS_522[1]);
  const etiquetas = filas.map(f => f.etiqueta);
  assert.ok(!etiquetas.includes('Num. interior'));
  assert.ok(!etiquetas.includes('Telefono'));
  assert.ok(!etiquetas.includes('Email de entrega'));
  assert.ok(etiquetas.includes('Ciudad / Municipio'));
});

test('R13: sin domicilio no hay filas', () => {
  assert.deepEqual(filasDomicilioReutilizado(null), []);
});

// El domicilio elegido ocupa el lugar de lo que la Seccion 3 ya no captura
// (altaState.domicilio). Sin esto "Cotizar ahora" abriria el cotizador sin calle ni
// nombre de entrega, que es justo lo que hoy le da la captura que este ticket quita.

test('R14: el domicilio de Operam se traduce a las llaves que habla el resto del alta', () => {
  const e = entregaDeDomicilioOperam(DOMICILIOS_522[0]);
  assert.equal(e.br_name, 'Matriz');
  assert.equal(e.addr_street, 'Av Insurgentes Sur 1234');
  assert.equal(e.addr_interior, '3B');
  assert.equal(e.addr_colony, 'Del Valle');
  assert.equal(e.addr_zip, '03100');
  assert.equal(e.addr_city, 'Benito Juarez');
  assert.equal(e.addr_state, 'CDMX');
  assert.equal(e.phone, '5512345678');
  assert.equal(e.email, 'entregas@cliente.mx');
});

test('R15: el numero exterior NO se duplica: obtenerDomicilios ya lo trae dentro de la calle', () => {
  // lib/operam-client.js une addr_street y addr_exterior en `calle`; repetirlo en
  // addr_exterior dejaria "Av Insurgentes Sur 1234 1234" en el cotizador, que
  // vuelve a concatenar los dos (buildClienteDesdeAlta).
  assert.equal(entregaDeDomicilioOperam(DOMICILIOS_522[0]).addr_exterior, '');
});

test('R16: "Cotizar ahora" sobre el Cliente Operam reutilizado abre con el domicilio elegido', () => {
  const cliente = buildClienteDesdeAlta({
    customer_id: 522,
    datos: { razonSocial: 'HOTELES AZULES SA DE CV', nombreCorto: 'Hoteles Azules', rfc: 'HAZ010203AB1', cp: '11000' },
    domicilio: entregaDeDomicilioOperam(DOMICILIOS_522[0]),
  });
  assert.equal(cliente.calle, 'Av Insurgentes Sur 1234');
  assert.equal(cliente.nombreEntrega, 'Matriz');
  assert.equal(cliente.cp, '03100');
  assert.equal(cliente.municipio, 'Benito Juarez');
  assert.equal(cliente.telefono, '5512345678');
});

// Lo precargado es la configuracion que el cliente YA tiene, no una eleccion del
// vendedor (#248/#250). Si viajara, el alta pediria escrituras que nadie pidio: el
// segmento dispara el post-fix por la web legacy (un round trip mas, y su fallo
// saldria como "No se pudo guardar el segmento" sobre un campo que nadie toco).

const PRECARGA_522 = { salesType: '15', segmentoId: '9', usoCfdi: 'S01', invoiceEmail: '', vendedorNombre: 'Adrian Chavez' };
const COMERCIAL_PANEL = {
  uso_cfdi: 'S01', sales_type: '15', segmento_id: '9',
  salesman: '4', invoice_email: '', celular_nota: '+525512345678',
};

test('R17: sin tocar la Seccion 2 precargada, la lista y el segmento no viajan', () => {
  const c = comercialDelAltaReutilizada(COMERCIAL_PANEL, PRECARGA_522);
  assert.equal(c.sales_type, '');
  assert.equal(c.segmento_id, '');
});

test('R18: cambiar la lista de precios la hace viajar, sin arrastrar el segmento', () => {
  const c = comercialDelAltaReutilizada({ ...COMERCIAL_PANEL, sales_type: '16' }, PRECARGA_522);
  assert.equal(c.sales_type, '16');
  assert.equal(c.segmento_id, '');
});

test('R19: cambiar el segmento lo hace viajar', () => {
  const c = comercialDelAltaReutilizada({ ...COMERCIAL_PANEL, segmento_id: '3' }, PRECARGA_522);
  assert.equal(c.segmento_id, '3');
});

test('R20: el vendedor, el celular y el email de facturacion no los toca la poda', () => {
  const c = comercialDelAltaReutilizada({ ...COMERCIAL_PANEL, invoice_email: 'facturacion@cliente.mx' }, PRECARGA_522);
  assert.equal(c.salesman, '4');
  assert.equal(c.celular_nota, '+525512345678');
  assert.equal(c.invoice_email, 'facturacion@cliente.mx');
  assert.equal(c.uso_cfdi, 'S01');
});

test('R21: sin precarga (alta nueva, o la lectura fallo) la Seccion 2 viaja tal cual', () => {
  const c = comercialDelAltaReutilizada(COMERCIAL_PANEL, null);
  assert.equal(c.sales_type, '15');
  assert.equal(c.segmento_id, '9');
});

test('R22: reabrir el panel tras un alta completada tira la linea base del cliente anterior', () => {
  // Mismo riesgo que customer_id y clienteExistente (#192): el panel es un solo nodo,
  // y una linea base heredada haria que la Seccion 2 del PROXIMO cliente se podara
  // contra la configuracion del anterior.
  const { estado } = estadoAltaAlAbrirPanel({
    altaCompletada: true, customer_id: 522, clienteExistente: { id: 522, branchIdx: 0 },
    comercialReutilizado: PRECARGA_522,
  });
  assert.equal(estado.comercialReutilizado, null);
});

// El cuerpo con el que sale "Dar de alta" en el caso del ticket: Cliente Operam
// reutilizado, domicilio 570 elegido y Seccion 2 sin tocar. Es la unica costura
// automatizable de "produce el mismo resultado que hoy": el servidor ya esta cubierto
// por test/alta-cliente.test.js ("sobre el Cliente Operam que el vendedor eligio no se
// escribe ningun domicilio de entrega" y "con dos domicilios de entrega, usar devuelve
// el que eligio el vendedor").

test('R23: el POST del alta reutilizada lleva la decision con su domicilio y nada comercial que escribir', () => {
  const csfDatos = { rfc: 'HAZ010203AB1', razonSocial: 'HOTELES AZULES SA DE CV', nombreCorto: 'Hoteles Azules' };
  const elegido = { id: 522, branchIdx: 0, branchCode: 570 };
  const domicilio = entregaDeDomicilioOperam(domicilioReutilizadoDelAlta(elegido, DOMICILIOS_522));
  const comercial = comercialDelAltaReutilizada(COMERCIAL_PANEL, PRECARGA_522);
  const payload = buildAltaDarDeAltaPayload(csfDatos, comercial, domicilio, 522, null, {
    clienteExistente: true,
    usoCfdiElegido: false,
    decision: { tipo: 'usar', clienteId: 522, domicilioId: 570 },
  });

  assert.deepEqual(payload.decision, { tipo: 'usar', clienteId: 522, domicilioId: 570 });
  assert.equal(payload.cliente_existente, true);
  // Nada de la Seccion 2 viaja: sin diferencias no hay PUT de configuracion comercial
  // ni post-fix web del segmento sobre un cliente que ya los tiene.
  assert.equal(payload.sales_type, '');
  assert.equal(payload.segmento_id, '');
  assert.equal(payload.timbrado_uso_cfdi, usoCfdiParaPayload({ clienteExistente: true, usoCfdiElegido: false, valor: 'S01' }));
  assert.equal(payload.timbrado_uso_cfdi, '');
  // El domicilio que viaja es el elegido, no una captura: el modulo no escribe
  // branches sobre un Cliente Operam reutilizado, y asi "Cotizar ahora" sabe a donde va.
  assert.equal(payload.entrega.br_name, 'Matriz');
  assert.equal(payload.entrega.addr_zip, '03100');
});

test('R24: "Crear nuevo domicilio" sigue mandando el domicilio capturado y su decision', () => {
  const csfDatos = { rfc: 'HAZ010203AB1', razonSocial: 'HOTELES AZULES SA DE CV', nombreCorto: 'Hoteles Azules' };
  const capturado = {
    br_name: 'Bodega Sur', br_ref: 'BODSUR', addr_street: 'Calle Sur 456', addr_exterior: '456',
    addr_interior: '', addr_colony: 'Centro', addr_zip: '01000', addr_city: 'Alvaro Obregon',
    addr_state: 'CDMX', pais: 'MX', phone: '5599887766', addr_reference: '', email: '',
  };
  const payload = buildAltaDarDeAltaPayload(csfDatos, COMERCIAL_PANEL, capturado, 522, null, {
    clienteExistente: true,
    usoCfdiElegido: false,
    decision: { tipo: 'otro-domicilio', clienteId: 522 },
  });

  assert.deepEqual(payload.decision, { tipo: 'otro-domicilio', clienteId: 522 });
  assert.equal(payload.entrega.br_name, 'Bodega Sur');
  assert.equal(payload.entrega.br_ref, 'BODSUR');
  assert.equal(payload.entrega.addr_exterior, '456');
});
