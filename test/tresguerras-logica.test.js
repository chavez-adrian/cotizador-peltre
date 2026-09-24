import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { leerArchivoSync } from '../lib/fs-reintento.js';
import {
  opcionesDeSelect, origenYDestino, cuerpoPoblaciones, datosFormCotizacion, cuerpoCotizar,
  montoTresguerras, tarjetaDesdeCotizacion,
} from '../lib/tresguerras-logica.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Respuestas REALES del cotizador publico de Tresguerras, capturadas 2026-09-23
// (una consulta a la vez) contra www.tresguerras.com.mx/3G/assets/Ajax/.
const fixture = (nombre) => JSON.parse(leerArchivoSync(join(__dirname, 'fixtures', `tresguerras-${nombre}.json`)));

test('cuerpoPoblaciones: form-urlencoded con el origen fijo en la fabrica (56577)', () => {
  assert.equal(cuerpoPoblaciones('64000'), 'action=Poblaciones&origenCP=56577&destinoCP=64000');
});

test('opcionesDeSelect: lee value y texto de cada <option>, sin espacios sobrantes', () => {
  const pob = fixture('poblaciones-64000');
  assert.deepEqual(opcionesDeSelect(pob.Destino.HTML), [{ value: '0000000053', texto: 'MONTERREY, N.L.' }]);
  assert.deepEqual(opcionesDeSelect(pob.Destino.Colonia).slice(0, 2), [
    { value: '0000113951', texto: 'CENTRO' },
    { value: '0000064681', texto: 'LA FINCA' },
  ]);
  assert.deepEqual(opcionesDeSelect(''), []);
  assert.deepEqual(opcionesDeSelect(undefined), []);
});

test('origenYDestino: origen = poblacion de Ixtapaluca con la colonia de la fabrica; destino = primera colonia del CP', () => {
  assert.deepEqual(origenYDestino(fixture('poblaciones-64000'), '64000'), {
    origen: { poblacion: '0000001632', colonia: '0000050499' },
    destino: { poblacion: '0000000053', colonia: '0000113951' },
  });
});

test('origenYDestino: la colonia de la fabrica gana aunque no venga primero; sin ella, la primera', () => {
  const pob = fixture('poblaciones-64000');
  const invertida = { ...pob, Origen: { ...pob.Origen, Colonia: '<option value="0000050650">VALLE VERDE </option><option value="0000050499">ALFREDO DEL MAZO </option>' } };
  assert.equal(origenYDestino(invertida, '64000').origen.colonia, '0000050499');
  const sinFabrica = { ...pob, Origen: { ...pob.Origen, Colonia: '<option value="0000050650">VALLE VERDE </option>' } };
  assert.equal(origenYDestino(sinFabrica, '64000').origen.colonia, '0000050650');
});

test('origenYDestino: CP que Tresguerras no encuentra -> aviso con el CP', () => {
  const r = origenYDestino(fixture('poblaciones-sin-destino'), '99999');
  assert.equal(r.origen, undefined);
  assert.match(r.aviso, /^Tresguerras no da servicio al CP 99999/);
});

test('origenYDestino: respuesta con otra forma -> aviso de que el cotizador cambio, con la liga para cotizar a mano', () => {
  for (const raro of [null, {}, { Origen: {} }, { Origen: { HTML: '' }, Destino: { HTML: '' } }]) {
    const r = origenYDestino(raro, '64000');
    assert.match(r.aviso, /Tresguerras cambio su cotizador; cotiza a mano en https:\/\/www\.tresguerras\.com\.mx\/3G\/cotizadorcp\.php/);
  }
});

const OD_64000 = { origen: { poblacion: '0000001632', colonia: '0000050499' }, destino: { poblacion: '0000000053', colonia: '0000113951' } };

// El datosForm con el que se midio la tarifa de referencia en vivo (8 cajas
// 0.5x0.4x0.4 m de 25 kg, 56577 -> 64000, valor declarado $10,000 = $3,930.95).
test('datosFormCotizacion: medidas en METROS, peso POR BULTO y valor declarado, un renglon por tipo de caja', () => {
  const df = datosFormCotizacion({ ...OD_64000, cpDestino: '64000', cajas: [{ cantidad: 8, medidasCm: [50, 40, 40], pesoKg: 25 }], valorDeclarado: 10000 });
  assert.equal(df, 'cpOrigen=56577&ColOriCp=0000050499&origen2=0000001632&cpDestino=64000&ColDesCp=0000113951&destino2=0000000053'
    + '&opcionMedidas%5B0%5D=conMedidas&bulto%5B0%5D=8&peso%5B0%5D=25&largo%5B0%5D=0.5&ancho%5B0%5D=0.4&alto%5B0%5D=0.4'
    + '&valorCM=100&valorDec=10000&codPromocion=');
});

test('datosFormCotizacion: varios tipos de caja, centimetros redondeados y valor declarado entero', () => {
  const p = new URLSearchParams(datosFormCotizacion({ ...OD_64000, cpDestino: '64000', cajas: [
    { cantidad: 3, medidasCm: [45, 30.4, 37.5], pesoKg: 12.345 },
    { cantidad: 1, medidasCm: [60, 40, 40], pesoKg: 30 },
  ], valorDeclarado: 5432.678 }));
  assert.deepEqual([p.get('bulto[0]'), p.get('peso[0]'), p.get('largo[0]'), p.get('ancho[0]'), p.get('alto[0]')], ['3', '12.35', '0.45', '0.3', '0.38']);
  assert.deepEqual([p.get('bulto[1]'), p.get('peso[1]'), p.get('largo[1]')], ['1', '30', '0.6']);
  assert.equal(p.get('opcionMedidas[1]'), 'conMedidas');
  assert.equal(p.get('valorDec'), '5433');
});

test('datosFormCotizacion: sin valor declarado el campo va vacio (sin seguro)', () => {
  const p = new URLSearchParams(datosFormCotizacion({ ...OD_64000, cpDestino: '64000', cajas: [{ cantidad: 1, medidasCm: [50, 40, 40], pesoKg: 25 }], valorDeclarado: 0 }));
  assert.equal(p.get('valorDec'), '');
});

test('cuerpoCotizar: action=CotizarNew, esKiosko y el datosForm urlencoded dentro del form', () => {
  const df = 'cpOrigen=56577&bulto%5B0%5D=8';
  const cuerpo = cuerpoCotizar(df);
  assert.match(cuerpo, /^action=CotizarNew&esKiosko=true&datosForm=/);
  assert.equal(new URLSearchParams(cuerpo).get('datosForm'), df);
});

test('montoTresguerras: montos con comas de miles; lo ilegible es null', () => {
  assert.equal(montoTresguerras('3,930.95'), 3930.95);
  assert.equal(montoTresguerras('0.00'), 0);
  assert.equal(montoTresguerras('1,234,567.8'), 1234567.8);
  assert.equal(montoTresguerras(''), null);
  assert.equal(montoTresguerras(undefined), null);
  assert.equal(montoTresguerras('N/A'), null);
});

// Referencia medida en vivo (brief de #437): puerta a puerta $3,930.95 = flete
// 1,706.34 + recoleccion 783.32 + entrega 783.32 + seguro 100 + cpac 15.77 + IVA.
test('tarjetaDesdeCotizacion: con precio -> UNA tarjeta puerta a puerta con el total CON IVA, dias de transito y desglose', () => {
  assert.deepEqual(tarjetaDesdeCotizacion(fixture('cotizar-con-precio'), '64000'), {
    rate: {
      carrier: 'tresguerras',
      service: 'Puerta a puerta',
      serviceDescription: 'Tresguerras puerta a puerta',
      totalPrice: 3930.95,
      currency: 'MXN',
      days: 1,
      desglose: { flete: 1706.34, recoleccion: 783.32, entrega: 783.32, seguro: 100 },
    },
  });
});

test('tarjetaDesdeCotizacion: el error "Sin servicio" que acompana a una tarifa valida NO la descarta', () => {
  const r = fixture('cotizar-con-precio');
  assert.equal(r.Terrestre.error, 'Sin servicio');
  assert.equal(tarjetaDesdeCotizacion(r, '64000').rate.totalPrice, 3930.95);
});

test('tarjetaDesdeCotizacion: puerta a puerta en 0.00 (hay ocurre, no domicilio) -> aviso de que no da servicio al CP', () => {
  const r = fixture('cotizar-sin-servicio');
  assert.notEqual(r.Terrestre.precioTotal.ocurre, '0.00');
  assert.deepEqual(tarjetaDesdeCotizacion(r, '56577'), { aviso: 'Tresguerras no da servicio puerta a puerta al CP 56577 (Sin servicio)' });
});

test('tarjetaDesdeCotizacion: ruta no autorizada -> aviso con el CP', () => {
  assert.deepEqual(tarjetaDesdeCotizacion(fixture('cotizar-ruta-no-autorizada'), '64000'),
    { aviso: 'Tresguerras no da servicio puerta a puerta al CP 64000 (Ruta no autorizada)' });
});

test('tarjetaDesdeCotizacion: peso no autorizado -> aviso sobre la carga, accionable', () => {
  const { aviso } = tarjetaDesdeCotizacion(fixture('cotizar-peso-no-autorizado'), '64000');
  assert.equal(aviso, 'Tresguerras rechazo la carga (Peso no autorizado): revisa el peso y las medidas de las cajas, o cotiza a mano en https://www.tresguerras.com.mx/3G/cotizadorcp.php');
});

test('tarjetaDesdeCotizacion: respuesta con otra forma -> aviso de que el cotizador cambio', () => {
  const buena = fixture('cotizar-con-precio');
  const casos = [null, {}, { Terrestre: {} }, { Terrestre: { precioTotal: {} } },
    { Terrestre: { ...buena.Terrestre, precioTotal: { purtaPuerta: 'N/A' } } }];
  for (const raro of casos) {
    assert.deepEqual(tarjetaDesdeCotizacion(raro, '64000'), { aviso: 'Tresguerras cambio su cotizador; cotiza a mano en https://www.tresguerras.com.mx/3G/cotizadorcp.php' });
  }
});

test('tarjetaDesdeCotizacion: sin desglose legible la tarjeta sale igual, sin dias ni desglose', () => {
  const buena = fixture('cotizar-con-precio');
  const { rate } = tarjetaDesdeCotizacion({ Terrestre: { ...buena.Terrestre, purtaPuerta: '<p>otra cosa</p>' } }, '64000');
  assert.equal(rate.totalPrice, 3930.95);
  assert.equal(rate.days, null);
  assert.equal(rate.desglose, null);
});
