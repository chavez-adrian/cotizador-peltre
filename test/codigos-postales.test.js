import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarCp, buscarCP, normalizarEstadoMx, construirIndiceCP } from '../lib/codigos-postales.js';

test('normalizarCp MX: 5 digitos, quita no-digitos', () => {
  assert.equal(normalizarCp('MX', '56530'), '56530');
  assert.equal(normalizarCp('MX', ' 5653 0 '), '56530');
});

test('normalizarCp US: 5 digitos, corta el +4', () => {
  assert.equal(normalizarCp('US', '90210-1234'), '90210');
});

test('normalizarCp CA: mayusculas, sin espacios, solo el FSA (3 caracteres)', () => {
  assert.equal(normalizarCp('CA', 'm5v 3l9'), 'M5V');
  assert.equal(normalizarCp('CA', 'M5V'), 'M5V');
});

test('buscarCP: acierto devuelve ciudad y estado del indice', () => {
  const indice = { MX: { '56530': ['Ixtapaluca', 'Estado de Mexico'] } };
  assert.deepEqual(buscarCP(indice, 'MX', '56530'), { ciudad: 'Ixtapaluca', estado: 'Estado de Mexico' });
});

test('buscarCP: no encontrado devuelve null', () => {
  const indice = { MX: { '56530': ['Ixtapaluca', 'Estado de Mexico'] } };
  assert.equal(buscarCP(indice, 'MX', '99999'), null);
});

test('buscarCP: pais sin indice devuelve null', () => {
  assert.equal(buscarCP({}, 'MX', '56530'), null);
});

test('normalizarEstadoMx: Distrito Federal -> Ciudad de Mexico', () => {
  assert.equal(normalizarEstadoMx('Distrito Federal'), 'Ciudad de México');
});

test('normalizarEstadoMx: el estado "Mexico" a secas se desambigua de la CDMX', () => {
  assert.equal(normalizarEstadoMx('México'), 'Estado de México');
});

test('normalizarEstadoMx: formas cortas de Coahuila/Michoacan/Veracruz', () => {
  assert.equal(normalizarEstadoMx('Coahuila de Zaragoza'), 'Coahuila');
  assert.equal(normalizarEstadoMx('Michoacán de Ocampo'), 'Michoacán');
  assert.equal(normalizarEstadoMx('Veracruz de Ignacio de la Llave'), 'Veracruz');
});

test('normalizarEstadoMx: estados sin normalizacion pasan igual', () => {
  assert.equal(normalizarEstadoMx('Jalisco'), 'Jalisco');
});

// Filas reales de GeoNames (MX.txt/US.txt/CA.txt, descargadas y verificadas
// 2026-08-16) usadas como fixture: mismas columnas, mismo orden.
const MX_56530 = [
  'MX\t56530\tLa Venta\tMéxico\t15\tIxtapaluca\t039\tIxtapaluca\t18\t19.3063\t-98.8802\t4',
  'MX\t56530\tJacarandas I y II\tMéxico\t15\tIxtapaluca\t039\tIxtapaluca\t18\t19.3168\t-98.8791\t3',
].join('\n');
const MX_02000_DF = 'MX\t02000\tCentro de Azcapotzalco\tDistrito Federal\t09\tAzcapotzalco\t002\tCiudad de México\t02\t19.4815\t-99.1862\t4';
const US_90210 = 'US\t90210\tBeverly Hills\tCalifornia\tCA\tLos Angeles\t037\t\t\t34.0901\t-118.4065\t4';
const CA_M5V = 'CA\tM5V\tDowntown Toronto\tOntario\tON\tToronto\t8133394\t\t\t43.6404\t-79.3995\t6';

test('construirIndiceCP: MX usa el municipio (admin2), no la colonia, y colapsa las colonias repetidas', () => {
  const { MX } = construirIndiceCP({ mx: MX_56530, us: '', ca: '' });
  assert.deepEqual(MX['56530'], ['Ixtapaluca', 'Estado de México']);
  assert.equal(Object.keys(MX).length, 1);
});

test('construirIndiceCP: MX normaliza Distrito Federal a Ciudad de Mexico', () => {
  const { MX } = construirIndiceCP({ mx: MX_02000_DF, us: '', ca: '' });
  assert.deepEqual(MX['02000'], ['Azcapotzalco', 'Ciudad de México']);
});

test('construirIndiceCP: US usa ciudad (place name) + abreviatura de estado (admin code1)', () => {
  const { US } = construirIndiceCP({ mx: '', us: US_90210, ca: '' });
  assert.deepEqual(US['90210'], ['Beverly Hills', 'CA']);
});

test('construirIndiceCP: CA usa ciudad + provincia y la llave es el FSA de 3 caracteres', () => {
  const { CA } = construirIndiceCP({ mx: '', us: '', ca: CA_M5V });
  assert.deepEqual(CA['M5V'], ['Downtown Toronto', 'Ontario']);
});
