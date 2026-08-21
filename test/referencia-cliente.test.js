import { test } from 'node:test';
import assert from 'node:assert/strict';
import { referenciaDelCliente } from '../lib/referencia-cliente.js';

test('usa la referencia capturada cuando existe', () => {
  assert.equal(referenciaDelCliente({
    referencia: 'OC-4521', nombreCorto: 'El Pendulo',
    nombreEntrega: 'Almacen Roma', razonSocial: 'EL PENDULO SA DE CV',
  }), 'OC-4521');
});

test('sin referencia cae a nombreCorto', () => {
  assert.equal(referenciaDelCliente({
    nombreCorto: 'El Pendulo', nombreEntrega: 'Almacen Roma', razonSocial: 'EL PENDULO SA DE CV',
  }), 'El Pendulo');
});

test('sin referencia ni nombreCorto cae a nombreEntrega', () => {
  assert.equal(referenciaDelCliente({
    nombreEntrega: 'Almacen Roma', razonSocial: 'EL PENDULO SA DE CV',
  }), 'Almacen Roma');
});

test('razonSocial es el ultimo escalon (y se normaliza, ver mas abajo)', () => {
  assert.equal(referenciaDelCliente({ razonSocial: 'EL PENDULO SA DE CV' }), 'El Pendulo SA de CV');
});

test('un escalon de solo espacios cuenta como vacio', () => {
  assert.equal(referenciaDelCliente({
    referencia: '   ', nombreCorto: '\t', nombreEntrega: '\n  ', razonSocial: 'EL PENDULO SA DE CV',
  }), 'El Pendulo SA de CV');
});

test('devuelve la fuente elegida sin espacios de orilla', () => {
  assert.equal(referenciaDelCliente({ referencia: '  Boda Fernandez  ' }), 'Boda Fernandez');
});

test('cliente vacio, nulo o no objeto da cadena vacia', () => {
  assert.equal(referenciaDelCliente({}), '');
  assert.equal(referenciaDelCliente(null), '');
  assert.equal(referenciaDelCliente(undefined), '');
});

// Truncado a 60 (#241, paridad exacta): el limite lo impone el cust_ref del quote
// de Operam y ahora vive en el nucleo, para que el documento del cliente y el ERP
// digan literalmente lo mismo tambien cuando el escalon elegido es largo.
test('trunca a 60 caracteres', () => {
  assert.equal(referenciaDelCliente({ referencia: 'A'.repeat(80) }), 'A'.repeat(60));
});

test('trunca tambien el escalon de fallback, no solo lo capturado', () => {
  const larga = 'B'.repeat(80);
  assert.equal(referenciaDelCliente({ nombreEntrega: larga }).length, 60);
});

test('60 caracteres exactos pasan intactos', () => {
  const justa = 'C'.repeat(60);
  assert.equal(referenciaDelCliente({ referencia: justa }), justa);
});

// Normalizacion (#241): la razon social viene del SAT en MAYUSCULAS FISCALES y
// como referencia se lee a gritos. Se normaliza SOLO ese escalon: lo que el
// vendedor teclea es suyo y no se toca.
test('la razon social en mayusculas fiscales se normaliza', () => {
  assert.equal(referenciaDelCliente({ razonSocial: 'COMERCIALIZADORA EL PENDULO' }), 'Comercializadora El Pendulo');
});

test('la normalizacion respeta preposiciones y articulos en minuscula', () => {
  assert.equal(referenciaDelCliente({ razonSocial: 'HOTELES DE LA COSTA Y EL VALLE' }), 'Hoteles de la Costa y el Valle');
});

test('la normalizacion conserva las siglas corporativas', () => {
  assert.equal(referenciaDelCliente({ razonSocial: 'EL PENDULO SA DE CV' }), 'El Pendulo SA de CV');
  assert.equal(referenciaDelCliente({ razonSocial: 'GRUPO BAJIO S.A. DE C.V.' }), 'Grupo Bajio S.A. de C.V.');
  assert.equal(referenciaDelCliente({ razonSocial: 'SERVICIOS SAPI DE CV' }), 'Servicios SAPI de CV');
});

test('la normalizacion conserva los numeros romanos', () => {
  assert.equal(referenciaDelCliente({ razonSocial: 'RESTAURANTE EL FOGON III' }), 'Restaurante El Fogon III');
  assert.equal(referenciaDelCliente({ razonSocial: 'JUAN PABLO II' }), 'Juan Pablo II');
  assert.equal(referenciaDelCliente({ razonSocial: 'CARLOS XIV' }), 'Carlos XIV');
});

// Palabras espanolas de dos letras que tambien se leen como romanos ("MI" = 1001).
// Manda el espanol: solo se respetan romanos de tres letras o mas, mas el "II"
// que si aparece en nombres comerciales.
test('la normalizacion no confunde palabras espanolas con romanos', () => {
  assert.equal(referenciaDelCliente({ razonSocial: 'MI TIENDA DEL AHORRO' }), 'Mi Tienda del Ahorro');
  assert.equal(referenciaDelCliente({ razonSocial: 'CASA MIL SABORES' }), 'Casa Mil Sabores');
});

test('la normalizacion no destruye tokens con digito o simbolo', () => {
  assert.equal(referenciaDelCliente({ razonSocial: 'COMERCIAL 3M DE MEXICO' }), 'Comercial 3M de Mexico');
  assert.equal(referenciaDelCliente({ razonSocial: 'COCA-COLA FEMSA' }), 'Coca-Cola Femsa');
  assert.equal(referenciaDelCliente({ razonSocial: 'I+D MEXICO' }), 'I+D Mexico');
});

test('MIX es palabra, no el romano 1009', () => {
  assert.equal(referenciaDelCliente({ razonSocial: 'GRUPO MIX SA DE CV' }), 'Grupo Mix SA de CV');
});

test('la referencia capturada NO se normaliza: es del vendedor', () => {
  assert.equal(referenciaDelCliente({ referencia: 'OC-4521 BODA FERNANDEZ' }), 'OC-4521 BODA FERNANDEZ');
});

test('nombreCorto y nombreEntrega tampoco se normalizan', () => {
  assert.equal(referenciaDelCliente({ nombreCorto: 'EL PENDULO' }), 'EL PENDULO');
  assert.equal(referenciaDelCliente({ nombreEntrega: 'ALMACEN ROMA' }), 'ALMACEN ROMA');
});

test('la razon social ya normalizada sobrevive sin estropearse', () => {
  assert.equal(referenciaDelCliente({ razonSocial: 'El Pendulo SA de CV' }), 'El Pendulo SA de CV');
});

test('normaliza antes de truncar, no al reves', () => {
  const larga = 'COMERCIALIZADORA DE PRODUCTOS ALIMENTICIOS DEL BAJIO SA DE CV';
  const salida = referenciaDelCliente({ razonSocial: larga });
  assert.equal(salida.length, 60);
  assert.ok(salida.startsWith('Comercializadora de Productos Alimenticios del Bajio'), salida);
});
