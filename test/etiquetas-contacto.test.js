// Nucleo puro de las etiquetas del Contacto (#344, spec #337, ADR-0016,
// CONTEXT.md "Contacto"): se DERIVAN, nunca se guardan, se acumulan y no se
// quitan -- una Oportunidad Perdida no le quita ninguna.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CON_PEDIDO, COTIZADO as CLIENTE_COTIZADO, SIN_ACTIVIDAD } from '../lib/estado-cliente-operam.js';
import {
  CLIENTE_EN_LINEA,
  CON_PEDIDO as ET_CON_PEDIDO,
  COTIZADO as ET_COTIZADO,
  PROSPECTO,
  anotarEstadosOportunidades,
  clientesOperamLigados,
  esProspecto,
  etiquetasDeContacto,
  indiceContactosPorCelular,
} from '../lib/etiquetas-contacto.js';

// --- etiqueta prospecto: la marca de que ALGUIEN lo capturo ---

test('#344: un Contacto capturado lleva la etiqueta prospecto', () => {
  assert.equal(esProspecto({ id: 7, celular: '5512345678' }), true);
});

test('#344: el Contacto nacido de la migracion no lleva la etiqueta prospecto', () => {
  assert.equal(esProspecto({ id: 8, data: { sinCaptura: true } }), false);
});

test('#344: sin Contacto no hay etiqueta prospecto', () => {
  assert.equal(esProspecto(null), false);
});

// --- las cuatro etiquetas ---

test('#344: un Contacto capturado sin folio ni pedido solo es prospecto', () => {
  const e = etiquetasDeContacto({ contacto: { id: 7 } });
  assert.deepEqual(e, [PROSPECTO]);
});

test('#344: una Oportunidad con folio de Operam lo deja cotizado', () => {
  const e = etiquetasDeContacto({ contacto: { id: 7 }, oportunidades: [{ folioOperam: '1240' }] });
  assert.deepEqual(e, [PROSPECTO, ET_COTIZADO]);
});

test('#344: un Cliente Operam ligado con pedido le da la etiqueta con pedido', () => {
  const e = etiquetasDeContacto({
    contacto: { id: 7 },
    oportunidades: [{ folioOperam: '1240' }],
    clientesOperam: [{ id: 517, comercial: CON_PEDIDO }],
  });
  assert.deepEqual(e, [PROSPECTO, ET_COTIZADO, ET_CON_PEDIDO]);
});

test('#344: un Cliente Operam ligado sin pedido no da la etiqueta con pedido', () => {
  const e = etiquetasDeContacto({
    contacto: { id: 7 },
    clientesOperam: [{ id: 517, comercial: CLIENTE_COTIZADO }, { id: 518, comercial: SIN_ACTIVIDAD }],
  });
  assert.deepEqual(e, [PROSPECTO]);
});

test('#344: el celular que compro en la tienda es Cliente en linea aunque nadie lo capturara', () => {
  const e = etiquetasDeContacto({ contacto: null, enLinea: true });
  assert.deepEqual(e, [CLIENTE_EN_LINEA]);
});

test('#344: Cliente en linea que ademas se dio de alta y compro conserva las dos etiquetas', () => {
  const e = etiquetasDeContacto({
    contacto: { id: 7 },
    oportunidades: [{ folioOperam: '1240' }],
    clientesOperam: [{ id: 517, comercial: CON_PEDIDO }],
    enLinea: true,
  });
  assert.deepEqual(e, [PROSPECTO, ET_COTIZADO, ET_CON_PEDIDO, CLIENTE_EN_LINEA]);
});

test('#344: una Oportunidad Perdida no le quita ninguna etiqueta al Contacto', () => {
  const e = etiquetasDeContacto({
    contacto: { id: 7 },
    oportunidades: [{ folioOperam: '1240', etapa: 'perdida' }],
    clientesOperam: [{ id: 517, comercial: CON_PEDIDO }],
  });
  assert.deepEqual(e, [PROSPECTO, ET_COTIZADO, ET_CON_PEDIDO]);
});

test('#344: un Contacto sin nada no tiene etiquetas', () => {
  assert.deepEqual(etiquetasDeContacto({}), []);
});

// --- anotar las tarjetas del tablero ---

const estados = new Map([
  ['517', { fiscal: 'sin_datos_fiscales', comercial: CON_PEDIDO, fuenteIncompleta: false }],
  ['518', { fiscal: 'con_datos_fiscales', comercial: SIN_ACTIVIDAD, fuenteIncompleta: true }],
]);

test('#344: la tarjeta de una cotizacion trae el Cliente Operam con sus dos estados', () => {
  const [t] = anotarEstadosOportunidades(
    [{ tipo: 'cotizacion', id: 'c51', celularCruce: '5512345678', clienteOperamId: 517, folioOperam: '1240' }],
    { estados }
  );
  assert.deepEqual(t.clienteOperam, {
    id: 517, fiscal: 'sin_datos_fiscales', comercial: CON_PEDIDO, fuenteIncompleta: false,
  });
});

test('#344: la tarjeta hereda las etiquetas del Contacto, no las suyas', () => {
  const tarjetas = anotarEstadosOportunidades([
    { tipo: 'prospecto', id: 'p7', celular: '5512345678', clienteOperamId: null },
    { tipo: 'cotizacion', id: 'c51', celularCruce: '5512345678', clienteOperamId: 517, folioOperam: '1240' },
  ], { estados, contactos: new Map([['5512345678', { id: 7 }]]) });
  assert.deepEqual(tarjetas[0].etiquetas, [PROSPECTO, ET_COTIZADO, ET_CON_PEDIDO]);
  assert.deepEqual(tarjetas[1].etiquetas, [PROSPECTO, ET_COTIZADO, ET_CON_PEDIDO]);
});

test('#344: una tarjeta sin Contacto no inventa etiquetas ni Cliente Operam', () => {
  const [t] = anotarEstadosOportunidades(
    [{ tipo: 'cotizacion', id: 'c52', celularCruce: null, clienteOperamId: null }],
    { estados }
  );
  assert.deepEqual(t.etiquetas, []);
  assert.equal(t.clienteOperam, null);
});

test('#344: un Cliente Operam que el cache todavia no conoce no se inventa estados', () => {
  const [t] = anotarEstadosOportunidades(
    [{ tipo: 'cotizacion', id: 'c53', celularCruce: '5599990000', clienteOperamId: 999 }],
    { estados }
  );
  assert.equal(t.clienteOperam, null);
});

// La tarjeta trae su celular de Contacto YA resuelto por celularesDeCruce
// (#342, lib/oportunidades.js): con liga fija es esa, y en una historica sin
// migrar es lo tecleado. Este modulo no reimplementa ese cruce.
test('#344: la tarjeta cruza por el celular que celularesDeCruce ya resolvio', () => {
  const [t] = anotarEstadosOportunidades(
    [{ tipo: 'cotizacion', id: 'c60', celularCruce: '5512345678', clienteOperamId: 517, folioOperam: '1240' }],
    { estados, contactos: new Map([['5512345678', { id: 7 }]]) }
  );
  assert.deepEqual(t.etiquetas, [PROSPECTO, ET_COTIZADO, ET_CON_PEDIDO]);
});

// Muchos a muchos (ADR-0016): el comprador de dos restaurantes tiene pedido
// bajo uno y no bajo el otro, y sigue siendo un Contacto con pedido. La liga que
// el Contacto guarda (`data.cliente_id`) cuenta aunque ninguna tarjeta la nombre
// -- pasa cuando su tarjeta de prospecto ya la callo una cotizacion.
test('#344: la etiqueta con pedido mira TODOS los Clientes Operam ligados, no solo el de la tarjeta', () => {
  const [t] = anotarEstadosOportunidades(
    [{ tipo: 'cotizacion', id: 'c55', celularCruce: '5512345678', clienteOperamId: 518 }],
    { estados, contactos: new Map([['5512345678', { id: 7, data: { cliente_id: 517 } }]]) }
  );
  assert.deepEqual(t.etiquetas, [PROSPECTO, ET_CON_PEDIDO]);
  // El Cliente Operam de la tarjeta sigue siendo el suyo, no el del Contacto.
  assert.equal(t.clienteOperam.id, 518);
});

test('#344: los Clientes Operam ligados son la liga del Contacto y la de cada Oportunidad, sin repetir', () => {
  const ids = clientesOperamLigados(
    { id: 7, data: { cliente_id: 517 } },
    [{ clienteOperamId: 518 }, { clienteOperamId: 517 }, { clienteOperamId: null }]
  );
  assert.deepEqual(ids, ['517', '518']);
  assert.deepEqual(clientesOperamLigados(null, []), []);
});

test('#344: el indice de Contactos por celular descarta lo que no llega a diez digitos', () => {
  const indice = indiceContactosPorCelular([
    { id: 7, celular: '+52 55 1234 5678' }, { id: 8, celular: '5512' }, { id: 9, celular: '' },
  ]);
  assert.deepEqual([...indice.keys()], ['5512345678']);
});

test('#344: el celular en los pedidos de la tienda marca Cliente en linea en la tarjeta', () => {
  const [t] = anotarEstadosOportunidades(
    [{ tipo: 'cotizacion', id: 'c54', celularCruce: '5599990000', clienteOperamId: 518 }],
    { estados, enLinea: new Set(['5599990000']) }
  );
  assert.deepEqual(t.etiquetas, [CLIENTE_EN_LINEA]);
});
