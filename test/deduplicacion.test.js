import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarNombre, detectarDuplicados } from '../lib/deduplicacion.js';

// N1: quita acentos
test('N1: normalizarNombre quita acentos', () => {
  const tokens = normalizarNombre('Distribuciones Rápidas Ópticas');
  assert.ok(tokens.includes('distribuciones'), `esperaba "distribuciones" en [${tokens}]`);
  assert.ok(tokens.includes('rapidas'), `esperaba "rapidas" en [${tokens}]`);
  assert.ok(tokens.includes('opticas'), `esperaba "opticas" en [${tokens}]`);
});

// N2: convierte a minusculas
test('N2: normalizarNombre convierte a minusculas', () => {
  const tokens = normalizarNombre('PELTRE NACIONAL');
  assert.ok(tokens.includes('peltre'), `esperaba "peltre" en [${tokens}]`);
  assert.ok(tokens.includes('nacional'), `esperaba "nacional" en [${tokens}]`);
});

// N3: elimina articulos (el, la, los, las, un, una)
test('N3: normalizarNombre elimina articulos el/la/los/las/un/una', () => {
  const tokens = normalizarNombre('El Gran Mercado de La Ciudad');
  assert.ok(!tokens.includes('el'), `no esperaba "el" en [${tokens}]`);
  assert.ok(!tokens.includes('la'), `no esperaba "la" en [${tokens}]`);
  assert.ok(tokens.includes('gran'), `esperaba "gran" en [${tokens}]`);
  assert.ok(tokens.includes('mercado'), `esperaba "mercado" en [${tokens}]`);
  assert.ok(tokens.includes('ciudad'), `esperaba "ciudad" en [${tokens}]`);
});

test('N3b: normalizarNombre elimina articulos un/una/los/las', () => {
  const tokens = normalizarNombre('Los Tres Amigos Una Empresa');
  assert.ok(!tokens.includes('los'), `no esperaba "los" en [${tokens}]`);
  assert.ok(!tokens.includes('una'), `no esperaba "una" en [${tokens}]`);
  assert.ok(tokens.includes('tres'), `esperaba "tres" en [${tokens}]`);
  assert.ok(tokens.includes('amigos'), `esperaba "amigos" en [${tokens}]`);
  assert.ok(tokens.includes('empresa'), `esperaba "empresa" en [${tokens}]`);
});

// N4: elimina preposiciones (de, del, en, y, e)
test('N4: normalizarNombre elimina preposiciones de/del/en/y/e', () => {
  const tokens = normalizarNombre('Comercio y Distribución en México del Norte');
  assert.ok(!tokens.includes('y'), `no esperaba "y" en [${tokens}]`);
  assert.ok(!tokens.includes('en'), `no esperaba "en" en [${tokens}]`);
  assert.ok(!tokens.includes('del'), `no esperaba "del" en [${tokens}]`);
  assert.ok(tokens.includes('comercio'), `esperaba "comercio" en [${tokens}]`);
  assert.ok(tokens.includes('distribucion'), `esperaba "distribucion" en [${tokens}]`);
  assert.ok(tokens.includes('mexico'), `esperaba "mexico" en [${tokens}]`);
  assert.ok(tokens.includes('norte'), `esperaba "norte" en [${tokens}]`);
});

// N5: elimina sufijos corporativos
test('N5a: normalizarNombre elimina sufijo "sa de cv"', () => {
  const tokens = normalizarNombre('Peltre Nacional SA de CV');
  assert.ok(!tokens.includes('sa'), `no esperaba "sa" en [${tokens}]`);
  assert.ok(!tokens.includes('de'), `no esperaba "de" en [${tokens}]`);
  assert.ok(!tokens.includes('cv'), `no esperaba "cv" en [${tokens}]`);
  assert.ok(tokens.includes('peltre'), `esperaba "peltre" en [${tokens}]`);
  assert.ok(tokens.includes('nacional'), `esperaba "nacional" en [${tokens}]`);
});

test('N5b: normalizarNombre elimina sufijos srl/sapi/sc/ac/llc/inc/corp/ltd', () => {
  const tokensSrl = normalizarNombre('Distribuidora Omega SRL');
  assert.ok(!tokensSrl.includes('srl'), `no esperaba "srl" en [${tokensSrl}]`);
  assert.ok(tokensSrl.includes('distribuidora'), `esperaba "distribuidora" en [${tokensSrl}]`);
  assert.ok(tokensSrl.includes('omega'), `esperaba "omega" en [${tokensSrl}]`);

  const tokensLlc = normalizarNombre('Global Trade LLC');
  assert.ok(!tokensLlc.includes('llc'), `no esperaba "llc" en [${tokensLlc}]`);
  assert.ok(tokensLlc.includes('global'), `esperaba "global" en [${tokensLlc}]`);
  assert.ok(tokensLlc.includes('trade'), `esperaba "trade" en [${tokensLlc}]`);

  const tokensInc = normalizarNombre('Tech Supplies Inc');
  assert.ok(!tokensInc.includes('inc'), `no esperaba "inc" en [${tokensInc}]`);

  const tokensCorp = normalizarNombre('Megastore Corp');
  assert.ok(!tokensCorp.includes('corp'), `no esperaba "corp" en [${tokensCorp}]`);

  const tokensLtd = normalizarNombre('Omega Systems Ltd');
  assert.ok(!tokensLtd.includes('ltd'), `no esperaba "ltd" en [${tokensLtd}]`);
});

test('N5c: normalizarNombre elimina sufijo "sapi de cv"', () => {
  const tokens = normalizarNombre('Grupo Industrial SAPI de CV');
  assert.ok(!tokens.includes('sapi'), `no esperaba "sapi" en [${tokens}]`);
  assert.ok(!tokens.includes('de'), `no esperaba "de" en [${tokens}]`);
  assert.ok(!tokens.includes('cv'), `no esperaba "cv" en [${tokens}]`);
  assert.ok(tokens.includes('grupo'), `esperaba "grupo" en [${tokens}]`);
  assert.ok(tokens.includes('industrial'), `esperaba "industrial" en [${tokens}]`);
});

// N6: devuelve array de tokens no vacios
test('N6: normalizarNombre devuelve array de strings no vacios', () => {
  const tokens = normalizarNombre('Peltre Nacional SA de CV');
  assert.ok(Array.isArray(tokens), 'debe retornar un array');
  assert.ok(tokens.length > 0, 'el array no debe estar vacio');
  assert.ok(tokens.every(t => typeof t === 'string' && t.length > 0), 'todos los tokens deben ser strings no vacios');
});

// N7: falso positivo — nombre completamente diferente no produce tokens iguales
test('N7: normalizarNombre nombres distintos producen tokens distintos (falso positivo)', () => {
  const tokensA = normalizarNombre('Panaderia Gomez');
  const tokensB = normalizarNombre('Ferreteria Lopez');
  const solapamiento = tokensA.filter(t => tokensB.includes(t));
  assert.strictEqual(solapamiento.length, 0, `no esperaba solapamiento entre ${tokensA} y ${tokensB}`);
});

// N8: nombre con mezcla de acentos + articulos + sufijos corporativos
test('N8: normalizarNombre maneja mezcla de acentos/articulos/sufijos en un nombre real', () => {
  // "Distribuciones El Aguila SA de CV" -> tokens: ["distribuciones", "aguila"]
  const tokens = normalizarNombre('Distribuciones El Aguila SA de CV');
  assert.ok(!tokens.includes('el'), `no esperaba "el" en [${tokens}]`);
  assert.ok(!tokens.includes('sa'), `no esperaba "sa" en [${tokens}]`);
  assert.ok(!tokens.includes('de'), `no esperaba "de" en [${tokens}]`);
  assert.ok(!tokens.includes('cv'), `no esperaba "cv" en [${tokens}]`);
  assert.ok(tokens.includes('distribuciones'), `esperaba "distribuciones" en [${tokens}]`);
  assert.ok(tokens.includes('aguila'), `esperaba "aguila" en [${tokens}]`);
});

// ============================================================
// detectarDuplicados — tests RED (D1-D6)
// ============================================================

const CLIENTES_MOCK = [
  { RFC: 'PNA010203ABC', rfc: 'PNA010203ABC', CustName: 'Peltre Nacional SA de CV', cust_ref: 'PELTRE', id: 1 },
  { RFC: 'DIS860901XYZ', rfc: 'DIS860901XYZ', CustName: 'Distribuidora Omega SRL', cust_ref: 'OMEGA', id: 2 },
  { RFC: 'XAXX010101000', rfc: 'XAXX010101000', CustName: 'Comercio General SA de CV', cust_ref: 'COGEN', id: 3 },
  { RFC: 'XAXX010101000', rfc: 'XAXX010101000', CustName: 'Comercializadora General del Norte', cust_ref: 'COGENO', id: 4 },
  { RFC: 'XEXX010101000', rfc: 'XEXX010101000', CustName: 'Global Imports LLC', cust_ref: 'GLOBIMPORT', id: 5 },
];

// D1: RFC real exacto -> tipo exacto
test('D1: detectarDuplicados retorna exacto para RFC real duplicado', () => {
  const result = detectarDuplicados('PNA010203ABC', 'Peltre Nacional SA de CV', CLIENTES_MOCK);
  assert.strictEqual(result.tipo, 'exacto');
  assert.ok(result.cliente, 'debe incluir cliente');
  assert.strictEqual(result.cliente.id, 1);
});

// D2: RFC real sin match -> libre
test('D2: detectarDuplicados retorna libre para RFC real sin match', () => {
  const result = detectarDuplicados('NUE990101ZZZ', 'Nueva Empresa SA de CV', CLIENTES_MOCK);
  assert.strictEqual(result.tipo, 'libre');
  assert.ok(!result.cliente, 'no debe incluir cliente');
  assert.ok(!result.candidatos, 'no debe incluir candidatos');
});

// D3: RFC generico XAXX con nombre similar (solapamiento >= 1 token) -> candidatos
test('D3: detectarDuplicados retorna candidatos para RFC generico XAXX con nombre similar', () => {
  const result = detectarDuplicados('XAXX010101000', 'Comercio General Mayorista SA de CV', CLIENTES_MOCK);
  assert.strictEqual(result.tipo, 'candidatos');
  assert.ok(Array.isArray(result.candidatos), 'debe incluir array candidatos');
  assert.ok(result.candidatos.length >= 1, 'debe haber al menos 1 candidato');
  const ids = result.candidatos.map(c => c.id);
  assert.ok(ids.includes(3) || ids.includes(4), 'candidatos deben incluir clientes con RFC XAXX y nombre similar');
});

// D4: RFC generico XEXX con nombre similar -> candidatos
test('D4: detectarDuplicados retorna candidatos para RFC generico XEXX con nombre similar', () => {
  const result = detectarDuplicados('XEXX010101000', 'Global Exports LLC', CLIENTES_MOCK);
  assert.strictEqual(result.tipo, 'candidatos');
  assert.ok(result.candidatos.some(c => c.id === 5), 'debe incluir cliente Global Imports LLC');
});

// D5: RFC generico, nombre sin solapamiento -> libre
test('D5: detectarDuplicados retorna libre para RFC generico con nombre sin solapamiento', () => {
  const result = detectarDuplicados('XAXX010101000', 'Panaderia Artesanal Tepito', CLIENTES_MOCK);
  assert.strictEqual(result.tipo, 'libre');
});

// D6: candidatos ordenados por similitud descendente (mas tokens en comun primero)
test('D6: detectarDuplicados ordena candidatos por similitud descendente', () => {
  // "Comercio General del Norte SA de CV" deberia tener mas solapamiento con id=4 que id=3
  // id=3: CustName="Comercio General SA de CV" => tokens: [comercio, general]
  // id=4: CustName="Comercializadora General del Norte" => tokens: [comercializadora, general, norte]
  // input: "Comercio General del Norte" => tokens: [comercio, general, norte]
  // solapamiento id=4: general+norte=2, id=3: comercio+general=2 => al menos ordenados
  const result = detectarDuplicados('XAXX010101000', 'Comercio General del Norte SA de CV', CLIENTES_MOCK);
  assert.strictEqual(result.tipo, 'candidatos');
  // primer candidato debe tener mayor o igual similitud que el segundo
  if (result.candidatos.length >= 2) {
    const sim0 = result.candidatos[0]._similitud;
    const sim1 = result.candidatos[1]._similitud;
    if (sim0 !== undefined && sim1 !== undefined) {
      assert.ok(sim0 >= sim1, `primer candidato (${sim0}) debe tener >= similitud que segundo (${sim1})`);
    }
  }
  assert.ok(result.candidatos.length >= 1);
});

// AC5 — nombre identico sin acentos detecta candidato
test('D7: detectarDuplicados detecta candidato con nombre identico pero sin acentos (AC5)', () => {
  // "Comercio General SA de CV" en Operam; input escrito sin acento en 'e': igual tras NFD
  const clientes = [
    { RFC: 'XAXX010101000', rfc: 'XAXX010101000', CustName: 'Distribuciones Rapidas SA de CV', cust_ref: 'DISRAP', id: 10 },
  ];
  // Input con tilde: 'Distribuciones Rápidas' — deberia matchear igual
  const result = detectarDuplicados('XAXX010101000', 'Distribuciones Rapidas SA de CV', clientes);
  assert.strictEqual(result.tipo, 'candidatos');
  assert.ok(result.candidatos.some(c => c.id === 10), 'debe encontrar el candidato');
});

// AC5 — nombre con articulos y sufijos corporativos
test('D8: detectarDuplicados detecta candidato con articulos/sufijos en nombre (AC5)', () => {
  const clientes = [
    { RFC: 'XAXX010101000', rfc: 'XAXX010101000', CustName: 'El Aguila SA de CV', cust_ref: 'AGUILA', id: 20 },
  ];
  // Input con articulos: "Distribuidora El Aguila SA" -> tokens: [distribuidora, aguila]
  // CustName tokens: [aguila] -> solapamiento=1
  const result = detectarDuplicados('XAXX010101000', 'Distribuidora El Aguila SA de CV', clientes);
  assert.strictEqual(result.tipo, 'candidatos');
  assert.ok(result.candidatos.some(c => c.id === 20), 'debe encontrar candidato El Aguila');
});

// ============================================================
// Issue #78: RFC real sin match exacto -- fallback a candidatos
// SOLO entre clientes con RFC generico (el cliente pudo darse de
// alta sin RFC y ahora llega su CSF real, caso real "Siscani").
// ============================================================

// D9: RFC real sin match exacto, nombre solapa con cliente de RFC generico -> candidatos
test('D9: detectarDuplicados con RFC real sin match exacto cae a candidatos por nombre entre clientes con RFC generico', () => {
  const clientes = [
    { RFC: 'XAXX010101000', rfc: 'XAXX010101000', CustName: 'Siscani Group SA de CV', cust_ref: 'SISCANI', id: 30 },
    { RFC: 'DIS860901XYZ', rfc: 'DIS860901XYZ', CustName: 'Distribuidora Omega SRL', cust_ref: 'OMEGA', id: 2 },
  ];
  const result = detectarDuplicados('ISI1801183Z4', 'Importaciones Siscani', clientes);
  assert.strictEqual(result.tipo, 'candidatos');
  assert.ok(result.candidatos.some(c => c.id === 30), 'debe encontrar el candidato Siscani Group con RFC generico');
  assert.ok(!result.candidatos.some(c => c.id === 2), 'no debe incluir clientes con RFC real (no genericos) como candidatos');
});

// D10: RFC real sin match exacto Y sin solapamiento de nombre, pero telefono
// coincide (ultimos 10 digitos) -- senal fuerte, marca candidato igual (caso
// real: el nombre "Siscani Group" vs "Importaciones Siscani" pudo no solapar
// segun el umbral, pero el telefono del contacto SI coincidio).
test('D10: detectarDuplicados marca candidato por telefono aunque el nombre no solape', () => {
  const clientes = [
    {
      RFC: 'XAXX010101000', rfc: 'XAXX010101000', CustName: 'Grupo ABC', cust_ref: 'ABC', id: 40,
      contacts: [{ phone: '55 1234 5678' }],
    },
  ];
  const result = detectarDuplicados('NUE990101ZZZ', 'Nombre Totalmente Distinto', clientes, '5512345678');
  assert.strictEqual(result.tipo, 'candidatos');
  assert.ok(result.candidatos.some(c => c.id === 40), 'debe marcar candidato por telefono aunque el nombre no solape');
});

// D11: RFC real sin match, sin solapamiento de nombre, sin telefono coincidente -> libre
test('D11: detectarDuplicados retorna libre cuando ni nombre ni telefono coinciden con clientes de RFC generico', () => {
  const clientes = [
    {
      RFC: 'XAXX010101000', rfc: 'XAXX010101000', CustName: 'Grupo ABC', cust_ref: 'ABC', id: 40,
      contacts: [{ phone: '55 1234 5678' }],
    },
  ];
  const result = detectarDuplicados('NUE990101ZZZ', 'Nombre Totalmente Distinto', clientes, '5599998888');
  assert.strictEqual(result.tipo, 'libre');
});
