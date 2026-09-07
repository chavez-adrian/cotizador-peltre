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
  esProspecto,
  etiquetasDeContacto,
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
    [{ tipo: 'cotizacion', id: 'c51', contactoCelular: '5512345678', clienteOperamId: 517, folioOperam: '1240' }],
    { estados }
  );
  assert.deepEqual(t.clienteOperam, {
    id: 517, fiscal: 'sin_datos_fiscales', comercial: CON_PEDIDO, fuenteIncompleta: false,
  });
});

test('#344: la tarjeta hereda las etiquetas del Contacto, no las suyas', () => {
  const tarjetas = anotarEstadosOportunidades([
    { tipo: 'prospecto', id: 'p7', celular: '5512345678', clienteOperamId: null },
    { tipo: 'cotizacion', id: 'c51', contactoCelular: '5512345678', clienteOperamId: 517, folioOperam: '1240' },
  ], { estados, contactos: new Map([['5512345678', { id: 7 }]]) });
  assert.deepEqual(tarjetas[0].etiquetas, [PROSPECTO, ET_COTIZADO, ET_CON_PEDIDO]);
  assert.deepEqual(tarjetas[1].etiquetas, [PROSPECTO, ET_COTIZADO, ET_CON_PEDIDO]);
});

test('#344: una tarjeta sin Contacto no inventa etiquetas ni Cliente Operam', () => {
  const [t] = anotarEstadosOportunidades(
    [{ tipo: 'cotizacion', id: 'c52', contactoCelular: null, clienteOperamId: null }],
    { estados }
  );
  assert.deepEqual(t.etiquetas, []);
  assert.equal(t.clienteOperam, null);
});

test('#344: un Cliente Operam que el cache todavia no conoce no se inventa estados', () => {
  const [t] = anotarEstadosOportunidades(
    [{ tipo: 'cotizacion', id: 'c53', contactoCelular: '5599990000', clienteOperamId: 999 }],
    { estados }
  );
  assert.equal(t.clienteOperam, null);
});

// Mismo respaldo que celularesDeCruce (#342): una cotizacion que la migracion
// no ha tocado cruza por el telefono del documento, y su tarjeta tiene que
// llevar las etiquetas de esa misma persona.
test('#344: la cotizacion sin Contacto anotado cruza por el telefono del documento', () => {
  const [t] = anotarEstadosOportunidades(
    [{ tipo: 'cotizacion', id: 'c60', contactoCelular: null, telefono: '525512345678', clienteOperamId: 517, folioOperam: '1240' }],
    { estados, contactos: new Map([['5512345678', { id: 7 }]]) }
  );
  assert.deepEqual(t.etiquetas, [PROSPECTO, ET_COTIZADO, ET_CON_PEDIDO]);
});

test('#344: el celular en los pedidos de la tienda marca Cliente en linea en la tarjeta', () => {
  const [t] = anotarEstadosOportunidades(
    [{ tipo: 'cotizacion', id: 'c54', contactoCelular: '5599990000', clienteOperamId: 518 }],
    { estados, enLinea: new Set(['5599990000']) }
  );
  assert.deepEqual(t.etiquetas, [CLIENTE_EN_LINEA]);
});
