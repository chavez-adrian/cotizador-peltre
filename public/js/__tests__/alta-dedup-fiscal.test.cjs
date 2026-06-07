'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  calcularDiffFiscal,
  buildDiffFiscalHtml,
  buildDedupExactoConDiffHtml,
} = require('./helpers.cjs');

// === calcularDiffFiscal ===
// Compara los datos fiscales de la CSF recien subida (formato altaState.datos)
// contra el cliente ya guardado en Operam (formato crudo de /api/buscar-cliente-duplicado).
// El diff resultante usa NOMBRES DE CAMPO DE OPERAM como llave (CustName, tax_id, street, ...)
// porque actualizarCliente(id, diff) hace body[fieldId] = nuevo y lo manda directo al PUT
// de Operam -- si la llave fuera un id de DOM (cl-razon-social) el PATCH mandaria campos
// que Operam no reconoce. Esto difiere a proposito del calcularDiff viejo (deuda tecnica).

const clienteOperamBase = {
  customer_id: 77,
  CustName: 'Peltre Nacional SA de CV',
  tax_id: 'PNA010203ABC',
  idcif: 'IDCIF123',
  street: 'Reforma',
  street_number: '100',
  suite_number: 'A',
  district: 'Juarez',
  postal_code: '06600',
  city: 'CDMX',
  state: 'CDMX',
  cfdi_regimen_fiscal: '601',
};

const csfDatosIguales = {
  rfc: 'PNA010203ABC',
  razonSocial: 'Peltre Nacional SA de CV',
  idcif: 'IDCIF123',
  calle: 'Reforma',
  numExt: '100',
  numInt: 'A',
  colonia: 'Juarez',
  cp: '06600',
  municipio: 'CDMX',
  estado: 'CDMX',
  regimenFiscal: '601',
};

test('G1: calcularDiffFiscal retorna objeto vacio cuando no hay diferencias', () => {
  const diff = calcularDiffFiscal(clienteOperamBase, csfDatosIguales);
  assert.deepEqual(diff, {});
});

test('G2: calcularDiffFiscal detecta cambio en razon social (CustName)', () => {
  const csfDatos = { ...csfDatosIguales, razonSocial: 'Peltre Nacional Industrias SA de CV' };
  const diff = calcularDiffFiscal(clienteOperamBase, csfDatos);
  assert.ok('CustName' in diff, 'debe usar CustName como llave (nombre de campo Operam)');
  assert.equal(diff.CustName.anterior, 'Peltre Nacional SA de CV');
  assert.equal(diff.CustName.nuevo, 'Peltre Nacional Industrias SA de CV');
});

test('G3: calcularDiffFiscal detecta cambio de domicilio fiscal completo', () => {
  const csfDatos = {
    ...csfDatosIguales,
    calle: 'Insurgentes',
    numExt: '200',
    numInt: 'B',
    colonia: 'Roma',
    cp: '06700',
    municipio: 'Guadalajara',
    estado: 'Jalisco',
  };
  const diff = calcularDiffFiscal(clienteOperamBase, csfDatos);
  assert.equal(diff.street.anterior, 'Reforma');
  assert.equal(diff.street.nuevo, 'Insurgentes');
  assert.equal(diff.street_number.nuevo, '200');
  assert.equal(diff.suite_number.nuevo, 'B');
  assert.equal(diff.district.nuevo, 'Roma');
  assert.equal(diff.postal_code.nuevo, '06700');
  assert.equal(diff.city.nuevo, 'Guadalajara');
  assert.equal(diff.state.nuevo, 'Jalisco');
});

test('G4: calcularDiffFiscal detecta cambio de regimen fiscal (cfdi_regimen_fiscal)', () => {
  const csfDatos = { ...csfDatosIguales, regimenFiscal: '612' };
  const diff = calcularDiffFiscal(clienteOperamBase, csfDatos);
  assert.equal(diff.cfdi_regimen_fiscal.anterior, '601');
  assert.equal(diff.cfdi_regimen_fiscal.nuevo, '612');
});

test('G5: calcularDiffFiscal detecta cambio de RFC (tax_id) e idcif', () => {
  const csfDatos = { ...csfDatosIguales, rfc: 'NUE010101XYZ', idcif: 'IDCIF999' };
  const diff = calcularDiffFiscal(clienteOperamBase, csfDatos);
  assert.equal(diff.tax_id.anterior, 'PNA010203ABC');
  assert.equal(diff.tax_id.nuevo, 'NUE010101XYZ');
  assert.equal(diff.idcif.anterior, 'IDCIF123');
  assert.equal(diff.idcif.nuevo, 'IDCIF999');
});

test('G6: calcularDiffFiscal ignora diferencias de espacios en blanco al inicio/final', () => {
  const csfDatos = { ...csfDatosIguales, razonSocial: '  Peltre Nacional SA de CV  ' };
  const diff = calcularDiffFiscal(clienteOperamBase, csfDatos);
  assert.deepEqual(diff, {}, 'no debe marcar diferencia solo por espacios');
});

test('G7: calcularDiffFiscal trata valores null/undefined del cliente Operam como cadena vacia', () => {
  const clienteIncompleto = { customer_id: 5, CustName: 'Cliente X', tax_id: 'CLX010101AB1' };
  const csfDatos = { ...csfDatosIguales, rfc: 'CLX010101AB1', razonSocial: 'Cliente X', idcif: 'NUEVO' };
  const diff = calcularDiffFiscal(clienteIncompleto, csfDatos);
  assert.equal(diff.idcif.anterior, '');
  assert.equal(diff.idcif.nuevo, 'NUEVO');
  assert.ok(!('CustName' in diff), 'sin diferencia real no debe aparecer en el diff');
});

// === buildDiffFiscalHtml ===

test('G8: buildDiffFiscalHtml retorna string con cada cambio antes -> despues', () => {
  const diff = {
    CustName: { anterior: 'Antes SA', nuevo: 'Despues SA' },
    cfdi_regimen_fiscal: { anterior: '601', nuevo: '612' },
  };
  const html = buildDiffFiscalHtml(diff);
  assert.ok(typeof html === 'string');
  assert.ok(html.includes('Antes SA'), 'debe mostrar valor anterior');
  assert.ok(html.includes('Despues SA'), 'debe mostrar valor nuevo');
  assert.ok(html.includes('601') && html.includes('612'), 'debe mostrar cambio de regimen');
});

test('G9: buildDiffFiscalHtml usa etiquetas legibles, no nombres crudos de campo Operam', () => {
  const diff = { CustName: { anterior: 'A', nuevo: 'B' }, tax_id: { anterior: 'X', nuevo: 'Y' } };
  const html = buildDiffFiscalHtml(diff);
  assert.ok(/raz[oó]n social/i.test(html), 'CustName debe traducirse a una etiqueta legible (Razon Social)');
  assert.ok(/rfc/i.test(html), 'tax_id debe traducirse a una etiqueta legible (RFC)');
});

test('G10: buildDiffFiscalHtml incluye botones confirmar y descartar', () => {
  const diff = { CustName: { anterior: 'A', nuevo: 'B' } };
  const html = buildDiffFiscalHtml(diff);
  assert.ok(/confirmar/i.test(html), 'debe ofrecer boton de confirmar actualizacion');
  assert.ok(/descartar|no actualizar|continuar sin/i.test(html), 'debe ofrecer boton de descartar');
});

test('G11: buildDiffFiscalHtml con diff vacio retorna cadena vacia (sin friccion, AC4)', () => {
  const html = buildDiffFiscalHtml({});
  assert.equal(html, '', 'sin diferencias no debe renderizar ningun panel');
});

// === buildDedupExactoConDiffHtml ===
// Compone el banner "RFC ya existe" (igual al flujo actual, AC3: "Usar este cliente"
// SIEMPRE disponible) + el panel de diff fiscal cuando aplica (AC1/AC4: solo si hay
// diferencias). Es deliberadamente NO bloqueante -- el vendedor puede usar el cliente
// existente sin resolver el diff primero (decision de diseno: paso paralelo/opcional,
// ver razonamiento en ralph-progress.txt iter 2).

const clienteExacto = { id: 77, customer_id: 77, CustName: 'Peltre Nacional SA de CV', RFC: 'PNA010203ABC', tax_id: 'PNA010203ABC' };

test('G12: buildDedupExactoConDiffHtml sin diferencias fiscales NO agrega panel de diff (AC4, sin friccion)', () => {
  const csfDatosIgualesAlCliente = {
    razonSocial: 'Peltre Nacional SA de CV', rfc: 'PNA010203ABC', idcif: '', calle: '',
    numExt: '', numInt: '', colonia: '', cp: '', municipio: '', estado: '', regimenFiscal: '',
  };
  const html = buildDedupExactoConDiffHtml(clienteExacto, csfDatosIgualesAlCliente);
  assert.ok(html.includes('Usar este cliente'), 'banner exacto debe seguir presente');
  assert.ok(!html.includes('diff-fiscal-panel'), 'sin diferencias no debe renderizar panel de diff');
});

test('G13: buildDedupExactoConDiffHtml con diferencias fiscales agrega el panel de diff Y conserva "Usar este cliente" (AC1+AC3, no bloqueante)', () => {
  const csfDatosConCambios = {
    razonSocial: 'Peltre Nacional Industrias SA de CV', rfc: 'PNA010203ABC', idcif: '',
    calle: '', numExt: '', numInt: '', colonia: '', cp: '', municipio: '', estado: '', regimenFiscal: '',
  };
  const html = buildDedupExactoConDiffHtml(clienteExacto, csfDatosConCambios);
  assert.ok(html.includes('Usar este cliente'), 'boton Usar este cliente debe seguir disponible (no bloquea)');
  assert.ok(html.includes('diff-fiscal-panel'), 'con diferencias debe mostrar el panel de diff');
  assert.ok(html.includes('Peltre Nacional Industrias SA de CV'), 'debe mostrar el valor nuevo de razon social');
});

test('G14: buildDedupExactoConDiffHtml sin csfDatos (undefined) no truena y omite el diff', () => {
  const html = buildDedupExactoConDiffHtml(clienteExacto, undefined);
  assert.ok(html.includes('Usar este cliente'));
  assert.ok(!html.includes('diff-fiscal-panel'));
});
