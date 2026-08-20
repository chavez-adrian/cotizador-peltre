import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarNombre, detectarDuplicados, hechosCandidato, esDebtorGenerico } from '../lib/deduplicacion.js';

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
// El nombre de entrada solapa DOS tokens con "Global Imports LLC" (#204: uno
// solo -- el "Global" de cualquier razon social en ingles -- ya no basta).
test('D4: detectarDuplicados retorna candidatos para RFC generico XEXX con nombre similar', () => {
  const result = detectarDuplicados('XEXX010101000', 'Global Imports Trading LLC', CLIENTES_MOCK);
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
    { RFC: 'XAXX010101000', rfc: 'XAXX010101000', CustName: 'La Distribuidora de El Aguila SA de CV', cust_ref: 'AGUILA', id: 20 },
  ];
  // Input con articulos: "Distribuidora El Aguila SA de CV" -> tokens: [distribuidora, aguila]
  // CustName tokens (tras quitar la/de/el/sa/cv): [distribuidora, aguila] -> solapamiento=2
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
  // Dos tokens en comun con "Siscani Group SA de CV" (#204: el nombre real del
  // caso, "Importaciones Siscani", solapaba uno solo y hoy se resuelve por
  // telefono -- ver D16/D17).
  const result = detectarDuplicados('ISI1801183Z4', 'Importaciones Siscani Group', clientes);
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

// D12: hasta #194 el pool de genericos llegaba VACIO (el ?search= de Operam no
// indexa el RFC), asi que la dedup por nombre de ADR-0001 nunca corrio sobre
// datos reales. Con el arreglo recibe el pool completo -- 78 clientes activos
// con RFC generico medidos en produccion el 2026-08-19. El nucleo debe elegir
// SOLO al que empata y no marcar de candidato al resto del cajon.
test('D12: con el pool completo de genericos (~80) solo devuelve al que empata por nombre', () => {
  const relleno = [
    'FERRETERIA EL CLAVO', 'PANADERIA SAN JUDAS', 'MUEBLERIA DEL VALLE', 'TALLER MECANICO NORTE',
    'PAPELERIA ESCOLAR', 'FARMACIA GUADALUPANA', 'CARNICERIA LA BONITA', 'VIDRIERIA MODERNA',
  ];
  const clientes = Array.from({ length: 80 }, (_, i) => ({
    RFC: 'XAXX010101000', rfc: 'XAXX010101000',
    CustName: `${relleno[i % relleno.length]} ${i}`, cust_ref: `REF${i}`, id: 1000 + i,
  }));
  clientes.push({
    RFC: 'XAXX010101000', rfc: 'XAXX010101000',
    CustName: 'PRUEBA 186 GENERICO', cust_ref: 'PRUEBA186', id: 495,
  });
  const result = detectarDuplicados('XAXX010101000', 'Prueba 186 Generico', clientes);
  assert.strictEqual(result.tipo, 'candidatos');
  assert.strictEqual(result.candidatos.length, 1, 'el resto del cajon no es candidato');
  assert.strictEqual(result.candidatos[0].id, 495);
});

// ============================================================
// Issue #204: umbral de solapamiento. Con el pool completo que estreno #194, un
// solo token compartido (un nombre de pila, un apellido comun) marcaba candidato
// y detenia la subida de una cotizacion sin relacion con el generico. El umbral
// es min(2, tokens del input): dos palabras en comun, salvo que el nombre
// capturado tenga una sola palabra util (si no, la dedup queda ciega para
// nombres de un token).
// ============================================================

// D13: caso real que rompio en produccion (2026-08-19) -- el contacto capturado
// comparte SOLO el nombre de pila con un generico del cajon.
test('D13: un solo token compartido (nombre de pila) NO marca candidato', () => {
  const clientes = [
    { RFC: 'XAXX010101000', rfc: 'XAXX010101000', CustName: 'JOSE ADRIAN ROMAN ROMERO', cust_ref: 'Pergola Cholula', id: 60 },
  ];
  const result = detectarDuplicados('XAXX010101000', 'Adrian Vazquez Ruiz', clientes);
  assert.strictEqual(result.tipo, 'libre');
});

// D14: dos tokens compartidos siguen marcando candidato (la senal que si sirve).
test('D14: dos tokens compartidos SI marcan candidato', () => {
  const clientes = [
    { RFC: 'XAXX010101000', rfc: 'XAXX010101000', CustName: 'JOSE ADRIAN ROMAN ROMERO', cust_ref: 'Pergola Cholula', id: 60 },
  ];
  const result = detectarDuplicados('XAXX010101000', 'Adrian Roman Vazquez', clientes);
  assert.strictEqual(result.tipo, 'candidatos');
  assert.strictEqual(result.candidatos[0].id, 60);
});

// D15: nombre capturado de UN solo token util -- exigir 2 dejaria la dedup ciega
// para "Pergola" o "Siscani", asi que ahi basta el unico token que hay.
test('D15: con un solo token util en el nombre capturado basta 1 coincidencia', () => {
  const clientes = [
    { RFC: 'XAXX010101000', rfc: 'XAXX010101000', CustName: 'Pergola Cholula', cust_ref: 'PERGOLA', id: 61 },
  ];
  const result = detectarDuplicados('XAXX010101000', 'Pergola', clientes);
  assert.strictEqual(result.tipo, 'candidatos');
  assert.strictEqual(result.candidatos[0].id, 61);
});

// D16: el umbral NO toca el match por telefono, que es senal fuerte propia --
// asi se detecto el duplicado real "Siscani" (#78), con un solo token en comun.
test('D16: el telefono sigue marcando candidato con un solo token compartido', () => {
  const clientes = [
    {
      RFC: 'XAXX010101000', rfc: 'XAXX010101000', CustName: 'Siscani Group SA de CV', cust_ref: 'SISCANI', id: 30,
      contacts: [{ phone: '55 1234 5678' }],
    },
  ];
  const result = detectarDuplicados('ISI1801183Z4', 'Importaciones Siscani', clientes, '5512345678');
  assert.strictEqual(result.tipo, 'candidatos');
  assert.strictEqual(result.candidatos[0].id, 30);
  assert.strictEqual(result.candidatos[0]._telefonoMatch, true);
});

// D17: el umbral aplica IGUAL en la rama del fallback de RFC real (#78, "no se
// inventa un umbral nuevo"): sin telefono, un token en comun ya no basta.
test('D17: en el fallback de RFC real un token compartido sin telefono da libre', () => {
  const clientes = [
    { RFC: 'XAXX010101000', rfc: 'XAXX010101000', CustName: 'Siscani Group SA de CV', cust_ref: 'SISCANI', id: 30 },
  ];
  const result = detectarDuplicados('ISI1801183Z4', 'Importaciones Siscani', clientes);
  assert.strictEqual(result.tipo, 'libre');
});

// ============================================================
// Issue #210: el picker de candidatos muestra hechos (no clasifica). Palabras
// de diferencia del nombre en AMBAS direcciones y CRUDAS (sin gazetteer), y
// letreros de celular/correo con TRES estados -- "sin dato" nunca es
// "no coincide" (41% de las fichas historicas de Operam no tienen telefono).
// hechosCandidato es una funcion APARTE de detectarDuplicados/candidatosPor-
// NombreOTelefono a proposito (review de #210): calcula evidencia sobre un
// candidato que YA entro a la lista, sin tocar la seleccion -- _similitud y
// _telefonoMatch (arriba, D1-D17) siguen decidiendo eso exactamente igual que
// antes de #210.
// ============================================================

// D18: familia real "Ojo de Agua" -- tres candidatos que difieren del input por
// palabras distintas, con overlap suficiente (ojo+agua) para seguir siendo
// candidatos pese a que el input tambien trae una palabra que ninguno tiene
// ("sur"), asi se ejercen las dos direcciones a la vez.
test('D18: hechosCandidato marca palabras crudas en ambas direcciones -- familia Ojo de Agua', () => {
  const clientes = [
    { RFC: 'XAXX010101000', rfc: 'XAXX010101000', CustName: 'Ojo de Agua Grupo', cust_ref: 'OJOAGUA-GPO', id: 70 },
    { RFC: 'XAXX010101000', rfc: 'XAXX010101000', CustName: 'Ojo de Agua Puebla', cust_ref: 'OJOAGUA-PUE', id: 71 },
    { RFC: 'XAXX010101000', rfc: 'XAXX010101000', CustName: 'Ojo de Agua Grupo Puebla', cust_ref: 'OJOAGUA-GP', id: 72 },
  ];
  const result = detectarDuplicados('XAXX010101000', 'Ojo de Agua Sur', clientes);
  assert.strictEqual(result.tipo, 'candidatos');
  assert.strictEqual(result.candidatos.length, 3);
  const tokensInput = normalizarNombre('Ojo de Agua Sur');
  const porId = Object.fromEntries(result.candidatos.map(c => [c.id, hechosCandidato(c, tokensInput)]));
  assert.deepEqual(porId[70].diferenciaNombre, { soloInput: ['sur'], soloCandidato: ['grupo'] });
  assert.deepEqual(porId[71].diferenciaNombre, { soloInput: ['sur'], soloCandidato: ['puebla'] });
  assert.deepEqual(porId[72].diferenciaNombre, { soloInput: ['sur'], soloCandidato: ['grupo', 'puebla'] });
});

// D19: mismo nombre exacto (sin diferencia) -- las dos listas salen vacias, no
// se inventa una diferencia donde no la hay.
test('D19: hechosCandidato sale vacio en ambas direcciones cuando los nombres normalizan igual', () => {
  const cliente = { RFC: 'XAXX010101000', rfc: 'XAXX010101000', CustName: 'Ojo de Agua Sur', cust_ref: 'OJOAGUA-SUR', id: 73 };
  const hechos = hechosCandidato(cliente, normalizarNombre('Ojo de Agua Sur'));
  assert.deepEqual(hechos.diferenciaNombre, { soloInput: [], soloCandidato: [] });
});

// D19b (review de #210): si el candidato entro a la lista por solapar con
// cust_ref y NO con CustName, la diferencia debe compararse contra la base que
// de verdad gano -- comparar siempre contra CustName mostraria una diferencia
// enorme que no fue la que lo marco candidato.
test('D19b: hechosCandidato compara contra cust_ref cuando fue ese el que gano el solapamiento', () => {
  const cliente = { RFC: 'XAXX010101000', rfc: 'XAXX010101000', CustName: 'XYZ Corp Internacional', cust_ref: 'Ojo de Agua Norte', id: 74 };
  const hechos = hechosCandidato(cliente, normalizarNombre('Ojo de Agua Sur'));
  assert.deepEqual(hechos.diferenciaNombre, { soloInput: ['sur'], soloCandidato: ['norte'] });
});

// D20: TRES estados de letrero -- ficha con dato que coincide, ficha con dato
// que NO coincide, y ficha sin dato (honesto: sin_dato, nunca no_coincide).
test('D20: hechosCandidato distingue coincide / no_coincide / sin_dato en celular y correo', () => {
  const conMatch = {
    RFC: 'XAXX010101000', rfc: 'XAXX010101000', CustName: 'Ojo de Agua Sur', cust_ref: 'OJOAGUA-A', id: 80,
    contacts: [{ phone: '55 1234 5678', email: 'ventas@ojodeagua.mx' }],
  };
  const sinMatch = {
    RFC: 'XAXX010101000', rfc: 'XAXX010101000', CustName: 'Ojo de Agua Sur', cust_ref: 'OJOAGUA-B', id: 81,
    contacts: [{ phone: '55 9999 0000', email: 'otro@dominio.mx' }],
  };
  const sinFicha = { RFC: 'XAXX010101000', rfc: 'XAXX010101000', CustName: 'Ojo de Agua Sur', cust_ref: 'OJOAGUA-C', id: 82 };
  const tokensInput = normalizarNombre('Ojo de Agua Sur');

  const h80 = hechosCandidato(conMatch, tokensInput, '5512345678', 'ventas@ojodeagua.mx');
  assert.strictEqual(h80.celularMatch, 'coincide');
  assert.strictEqual(h80.correoMatch, 'coincide');

  const h81 = hechosCandidato(sinMatch, tokensInput, '5512345678', 'ventas@ojodeagua.mx');
  assert.strictEqual(h81.celularMatch, 'no_coincide');
  assert.strictEqual(h81.correoMatch, 'no_coincide');

  const h82 = hechosCandidato(sinFicha, tokensInput, '5512345678', 'ventas@ojodeagua.mx');
  assert.strictEqual(h82.celularMatch, 'sin_dato', 'sin telefono en la ficha -- sin_dato, no no_coincide');
  assert.strictEqual(h82.correoMatch, 'sin_dato', 'sin correo en la ficha -- sin_dato, no no_coincide');
});

// D21: sin telefono/correo capturados en el INPUT, el letrero tambien es
// sin_dato aunque la ficha del candidato si tenga el dato -- no hay con que
// comparar, y afirmar "no coincide" seria una senal falsa.
test('D21: hechosCandidato da sin_dato sin telefono/correo en el input aunque la ficha si tenga dato', () => {
  const cliente = {
    RFC: 'XAXX010101000', rfc: 'XAXX010101000', CustName: 'Ojo de Agua Sur', cust_ref: 'OJOAGUA-SUR', id: 90,
    contacts: [{ phone: '55 1234 5678', email: 'ventas@ojodeagua.mx' }],
  };
  const hechos = hechosCandidato(cliente, normalizarNombre('Ojo de Agua Sur'));
  assert.strictEqual(hechos.celularMatch, 'sin_dato');
  assert.strictEqual(hechos.correoMatch, 'sin_dato');
});

// D22 (review de #210, ambos ejes): el telefono capturado en el contacto de la
// alta generica NUNCA se pasaba a detectarDuplicados desde poolDedupGenerico --
// #210 es un ticket de UI, no debe activar por accidente la senal fuerte de
// telefono en un flujo que nunca la tuvo. Verifica que detectarDuplicados SIN
// telefono siga sin marcar candidato por un match que solo existe por telefono
// (D10/D16 ya cubren el camino CON telefono explicito; este cubre el default).
test('D22: detectarDuplicados sin telefono no marca candidato aunque la ficha comparta telefono con el input (seleccion intacta tras #210)', () => {
  const clientes = [
    {
      RFC: 'XAXX010101000', rfc: 'XAXX010101000', CustName: 'Nombre Sin Relacion', cust_ref: 'NSR', id: 95,
      contacts: [{ phone: '55 1234 5678' }],
    },
  ];
  const result = detectarDuplicados('XAXX010101000', 'Otro Nombre Distinto', clientes);
  assert.strictEqual(result.tipo, 'libre');
});

// ============================================================
// Issue #201: el debtor 14 "PUBLICO EN GENERAL" es la factura global de bazar
// para el SAT (cajon que agrupa compradores sin relacion entre si, igual que
// los 5 cajones ya registrados) y faltaba en DEBTORS_GENERICOS.
// ============================================================

// D23: esDebtorGenerico(14) responde true como numero y como string (igual que
// el resto del set, comparar con Number() adentro del predicado).
test('D23: esDebtorGenerico reconoce el debtor 14 (PUBLICO EN GENERAL, factura global de bazar) como numero y como string', () => {
  assert.strictEqual(esDebtorGenerico(14), true);
  assert.strictEqual(esDebtorGenerico('14'), true);
});
