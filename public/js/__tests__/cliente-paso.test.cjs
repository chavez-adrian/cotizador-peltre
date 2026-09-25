'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

// Logica pura del rediseno del paso Cliente (variante B, issue #82; entrega
// diferida al paso Envio en #84). Todo lo decisional del paso vive en
// alta-logica.js y se prueba aqui; el render en app.js es tonto (sin DOM en
// Node, no se prueba). Ver CONTEXT.md.

let mezclarResultadosBusqueda, recientesDesdeCotizaciones, chipsCompletitud, contactoAccionable,
  buildClienteDesdeContactoNuevo, clienteDesdeProspecto, accionCelularContactoNuevo,
  decidirVistaTrasBusqueda, accionProspecto409, paisDesdeCodigoTelefono,
  contactosEntregaDisponibles, etiquetaTagContacto, nombreConCorto,
  contactoEntregaDelCliente, seleccionContactoEntrega, cotizacionesPreviasDelCliente, etiquetaPapelesContacto,
  clienteDesdeCotizacionReciente, ofreceCrearContacto;

before(async () => {
  ({
    mezclarResultadosBusqueda, recientesDesdeCotizaciones, chipsCompletitud, contactoAccionable,
    buildClienteDesdeContactoNuevo, clienteDesdeProspecto, accionCelularContactoNuevo,
    decidirVistaTrasBusqueda, accionProspecto409, paisDesdeCodigoTelefono,
    contactosEntregaDisponibles, etiquetaTagContacto, nombreConCorto,
    contactoEntregaDelCliente, seleccionContactoEntrega, cotizacionesPreviasDelCliente, etiquetaPapelesContacto,
    clienteDesdeCotizacionReciente, ofreceCrearContacto,
  } = await import('../alta-logica.js'));
});

// === nombreConCorto: formato unificado "RAZON SOCIAL (Nombre corto)" (#196) ===
// UN helper puro de TEXTO (no HTML) para toda superficie que identifica a un
// cliente de Operam por nombre. Omite el parentesis cuando el nombre corto esta
// vacio o es igual al nombre bajo normalizacion ligera LOCAL (minusculas, sin
// acentos, espacios colapsados) -- sin importar normalizarNombre de
// lib/deduplicacion.js (los modulos de public/js son browser-safe y no importan
// de lib/, regla documentada en pipeline-logica.js).

test('K1: nombre + corto informativo -> "NOMBRE (Corto)"', () => {
  assert.equal(nombreConCorto('DECORACION MARIA PIA', 'Casa Maria Pia'), 'DECORACION MARIA PIA (Casa Maria Pia)');
});

test('K2: corto vacio o ausente -> solo el nombre, sin parentesis', () => {
  assert.equal(nombreConCorto('Peltre Nacional', ''), 'Peltre Nacional');
  assert.equal(nombreConCorto('Peltre Nacional', null), 'Peltre Nacional');
  assert.equal(nombreConCorto('Peltre Nacional', undefined), 'Peltre Nacional');
  assert.equal(nombreConCorto('Peltre Nacional', '   '), 'Peltre Nacional');
});

test('K3: corto igual al nombre (case/acentos/espacios distintos) -> sin parentesis redundante', () => {
  assert.equal(nombreConCorto('Peltre Nacional', 'PELTRE NACIONAL'), 'Peltre Nacional');
  assert.equal(nombreConCorto('PELTRE NACIONAL', 'Peltre Nacional'), 'PELTRE NACIONAL');
  assert.equal(nombreConCorto('El Pendulo', 'el   pendulo'), 'El Pendulo');
  assert.equal(nombreConCorto('Jose Perez', 'Jos\u00e9 P\u00e9rez'), 'Jose Perez');
});

test('K4: corto distinto del nombre -> parentesis', () => {
  assert.equal(nombreConCorto('El Pendulo SA de CV', 'El Pendulo'), 'El Pendulo SA de CV (El Pendulo)');
});

test('K5: nombre vacio con corto presente no antepone espacio (defensivo)', () => {
  assert.equal(nombreConCorto('', 'Corto'), '(Corto)');
});

test('K6: nombre y corto ambos vacios -> cadena vacia', () => {
  assert.equal(nombreConCorto(null, null), '');
  assert.equal(nombreConCorto('', ''), '');
});

const OPERAM = [
  { id: 10, name: 'La Vasija Azul SA de CV', ref: 'La Vasija', rfc: 'VAZ990101QX3', telefonos: ['+52 55 1002 1463'] },
  { id: 11, name: 'Distribuidora El Comal', ref: 'El Comal', rfc: 'DCO150612AB1', telefonos: [] },
];
const PROSPECTOS = [
  { id: 1, nombre: 'Maria Torres', ciudad: 'Guadalajara', celular: '+52 33 1234 5678', etapa: 'por_cotizar', vendedor: 'Ana' },
  { id: 2, nombre: 'Vasija Nueva', ciudad: 'Puebla', celular: '+52 22 2345 6789', etapa: 'por_cotizar', vendedor: 'Ana' },
];

// === mezclarResultadosBusqueda: busqueda unificada Operam + prospectos (AC2) ===

test('M1: mezcla clientes Operam y prospectos, cada uno con su tipo', () => {
  const r = mezclarResultadosBusqueda(OPERAM, PROSPECTOS, 'vasija');
  const tipos = r.map(x => x.tipo);
  assert.ok(r.length >= 2, 'debe traer los dos "Vasija"');
  assert.ok(tipos.includes('operam'));
  assert.ok(tipos.includes('prospecto'));
});

// #344: los dos estados del Cliente Operam y las etiquetas de su Contacto los
// deriva el servidor; la fila los lleva para que el tag no tenga que recalcular
// nada contra un RFC que puede estar viejo.
test('M1b: la fila de Operam conserva los estados y las etiquetas que mando el servidor', () => {
  const clientes = [{ id: 514, name: 'Jorge Orea', rfc: 'XAXX010101000', telefonos: [],
    fiscal: 'sin_datos_fiscales', comercial: 'con_pedido', etiquetas: ['prospecto', 'con_pedido'] }];
  const [fila] = mezclarResultadosBusqueda(clientes, [], 'jorge');
  assert.strictEqual(fila.fiscal, 'sin_datos_fiscales');
  assert.strictEqual(fila.comercial, 'con_pedido');
  assert.deepStrictEqual(fila.etiquetas, ['prospecto', 'con_pedido']);
});

test('M1c: una respuesta sin estados deja la fila sin ellos, no con unos inventados', () => {
  const [fila] = mezclarResultadosBusqueda(
    [{ id: 520, name: 'Pedro SA', rfc: 'PSA950101AB1', telefonos: [] }], [], 'pedro');
  assert.strictEqual(fila.fiscal, null);
  assert.strictEqual(fila.comercial, null);
  assert.deepStrictEqual(fila.etiquetas, []);
});

test('M2: filtra por nombre (case-insensitive) en ambos origenes', () => {
  const r = mezclarResultadosBusqueda(OPERAM, PROSPECTOS, 'comal');
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].tipo, 'operam');
  assert.strictEqual(r[0].nombre, 'Distribuidora El Comal');
});

test('M3: Operam tambien matchea por RFC; prospecto por celular (digitos)', () => {
  const porRfc = mezclarResultadosBusqueda(OPERAM, PROSPECTOS, 'dco150612');
  assert.strictEqual(porRfc.length, 1);
  assert.strictEqual(porRfc[0].tipo, 'operam');
  const porCel = mezclarResultadosBusqueda(OPERAM, PROSPECTOS, '3312345678');
  assert.strictEqual(porCel.length, 1);
  assert.strictEqual(porCel[0].tipo, 'prospecto');
  assert.strictEqual(porCel[0].nombre, 'Maria Torres');
});

test('M3b: Operam tambien matchea por nombre corto (cust_ref) y telefono de contacto (issue #97)', () => {
  const porNombreCorto = mezclarResultadosBusqueda(OPERAM, PROSPECTOS, 'la vasija');
  assert.ok(porNombreCorto.some(r => r.tipo === 'operam' && r.id === 10));

  const porTelefono = mezclarResultadosBusqueda(OPERAM, PROSPECTOS, '10021463');
  assert.strictEqual(porTelefono.length, 1);
  assert.strictEqual(porTelefono[0].tipo, 'operam');
  assert.strictEqual(porTelefono[0].id, 10);
});

test('M4: query de menos de 2 caracteres devuelve vacio (se muestran recientes)', () => {
  assert.deepStrictEqual(mezclarResultadosBusqueda(OPERAM, PROSPECTOS, 'v'), []);
  assert.deepStrictEqual(mezclarResultadosBusqueda(OPERAM, PROSPECTOS, ' '), []);
});

test('M5: coincidencias por prefijo van antes que coincidencias internas', () => {
  const r = mezclarResultadosBusqueda(OPERAM, PROSPECTOS, 'vasija');
  // "La Vasija Azul" (interno) vs "Vasija Nueva" (prefijo) -> prefijo primero
  assert.strictEqual(r[0].nombre, 'Vasija Nueva');
});

test('M6: tolera listas nulas/indefinidas', () => {
  assert.doesNotThrow(() => mezclarResultadosBusqueda(null, undefined, 'vasija'));
  assert.deepStrictEqual(mezclarResultadosBusqueda(null, null, 'x'), []);
});

// === #292: acentos y mayusculas no deben descartar coincidencias ===
const OPERAM_ACENTOS = [
  { id: 20, name: 'Raúl Chávez', ref: 'Raul Chavez', rfc: 'CARR800101AB1', telefonos: [] },
  { id: 21, name: 'Adrian Chavez Rosete', ref: 'Adrian Chavez', rfc: 'CARA850202CD2', telefonos: [] },
  { id: 22, name: 'Chávez Distribuidora', ref: 'Chavez Dist', rfc: 'CDI900303EF3', telefonos: [] },
];
const PROSPECTOS_ACENTOS = [
  { id: 3, nombre: 'Adrián Pérez', ciudad: 'Toluca', celular: '', etapa: 'por_cotizar', vendedor: 'Ana' },
];

test('M7 (#292): "chavez" y "chavez" (con acento) devuelven los mismos clientes, con o sin acento en el dato', () => {
  const sinAcento = mezclarResultadosBusqueda(OPERAM_ACENTOS, [], 'chavez');
  assert.deepStrictEqual(sinAcento.map(r => r.id).sort(), [20, 21, 22]);
  const conAcento = mezclarResultadosBusqueda(OPERAM_ACENTOS, [], 'chávez');
  assert.deepStrictEqual(conAcento.map(r => r.id).sort(), [20, 21, 22]);
});

test('M8 (#292): un prospecto con acento aparece buscando con y sin acento', () => {
  const sinAcento = mezclarResultadosBusqueda([], PROSPECTOS_ACENTOS, 'adrian');
  assert.strictEqual(sinAcento.length, 1);
  assert.strictEqual(sinAcento[0].nombre, 'Adrián Pérez');
  const conAcento = mezclarResultadosBusqueda([], PROSPECTOS_ACENTOS, 'adrián');
  assert.strictEqual(conAcento.length, 1);
  assert.strictEqual(conAcento[0].nombre, 'Adrián Pérez');
});

test('M9 (#292): el orden por prefijo trata acentos igual de un lado y del otro', () => {
  // "Chavez Distribuidora" (id 22) empieza con "chavez" -> prefijo; "Raul Chavez"
  // (id 20) lo trae en medio -> interno. El resultado es el mismo con o sin
  // acento en la query, y con o sin acento en el dato.
  const conAcentoEnQuery = mezclarResultadosBusqueda(OPERAM_ACENTOS, [], 'chávez');
  const sinAcentoEnQuery = mezclarResultadosBusqueda(OPERAM_ACENTOS, [], 'chavez');
  assert.strictEqual(conAcentoEnQuery[0].id, 22);
  assert.strictEqual(sinAcentoEnQuery[0].id, 22);
});

// === #421: el RFC del paso Cliente, con espacios y la fila "Crear contacto" ===
// Caso real de la prueba HITL: el cliente 52 se llama distinto de su RFC, asi
// que por RFC solo lo reconoce la columna rfc de la fila.
const CLIENTE_52 = { id: '52', name: 'G J Y ASOCIADOS ABOGADOS SC', ref: 'Pizza Studio', rfc: 'GJA990301TM7', telefonos: [] };

test('M10 (#421): un RFC tecleado con espacios no descarta al Cliente Operam que el servidor encontro', () => {
  assert.deepStrictEqual(mezclarResultadosBusqueda([CLIENTE_52], [], 'GJA 990301 TM7').map(r => r.id), ['52']);
  assert.deepStrictEqual(mezclarResultadosBusqueda([CLIENTE_52], [], 'gja 990301 tm7').map(r => r.id), ['52']);
});

// === recientesDesdeCotizaciones: ultimos clientes cotizados por el vendedor ===

test('R1: deriva recientes distintos, mas nuevo primero', () => {
  const cots = [
    { id: 1, fecha: '2026-07-01', cliente: 'La Vasija Azul', telefono: '5215512345678' },
    { id: 2, fecha: '2026-07-05', cliente: 'El Comal', telefono: '5213311112222' },
    { id: 3, fecha: '2026-07-03', cliente: 'La Vasija Azul', telefono: '5215512345678' },
  ];
  const r = recientesDesdeCotizaciones(cots);
  assert.strictEqual(r[0].nombre, 'El Comal');       // 07-05
  assert.strictEqual(r[1].nombre, 'La Vasija Azul');  // 07-03 (mas reciente de sus dos)
  assert.strictEqual(r.length, 2, 'deduplica por nombre');
  assert.strictEqual(r[1].fecha, '2026-07-03', 'de las dos suyas se queda la mas reciente');
});

test('R2: respeta el limite y descarta entradas sin nombre', () => {
  const cots = [
    { id: 1, fecha: '2026-07-01', cliente: 'A' },
    { id: 2, fecha: '2026-07-02', cliente: '' },
    { id: 3, fecha: '2026-07-03', cliente: 'B' },
    { id: 4, fecha: '2026-07-04', cliente: 'C' },
  ];
  const r = recientesDesdeCotizaciones(cots, 2);
  assert.strictEqual(r.length, 2);
  assert.deepStrictEqual(r.map(x => x.nombre), ['C', 'B']);
});

test('R3: tolera lista nula', () => {
  assert.deepStrictEqual(recientesDesdeCotizaciones(null), []);
});

// #196: nombreCorto ya viaja en /api/cotizaciones desde #147 (hoy solo usado
// para matching del buscador del Historial); el derivador de recientes debe
// dejarlo pasar para que las pantallas de Recientes puedan pintarlo.
test('R4: deja pasar nombreCorto de la cotizacion mas reciente de cada cliente', () => {
  const cots = [
    { id: 1, fecha: '2026-07-01', cliente: 'Hotel Azul Centro', nombreCorto: 'Hotel Azul' },
  ];
  const r = recientesDesdeCotizaciones(cots);
  assert.strictEqual(r[0].nombreCorto, 'Hotel Azul');
});

test('R5: sin nombreCorto en la cotizacion -> cadena vacia (no undefined)', () => {
  const cots = [{ id: 1, fecha: '2026-07-01', cliente: 'A' }];
  const r = recientesDesdeCotizaciones(cots);
  assert.strictEqual(r[0].nombreCorto, '');
});

// === chipsCompletitud: estado de chips desde datos reales (AC6, tri-estado #84) ===

test('C1: cliente Operam completo -> Contacto y Fiscal en verde, Entrega completo', () => {
  const c = { name: 'La Vasija', telefono: '+52 55 1234 5678', cp: '06600', pais: 'MX', calle: 'Reforma 100', rfc: 'VAZ990101QX3' };
  assert.deepStrictEqual(chipsCompletitud(c), { contacto: true, entrega: 'completo', fiscal: true });
});

test('C2: contacto nuevo -> solo Contacto; Entrega pendiente (sin CP) y Fiscal pendiente', () => {
  const c = buildClienteDesdeContactoNuevo({ nombre: 'Juan', telefono: '+52 55 1234 5678', ciudad: 'CDMX' });
  const chips = chipsCompletitud(c);
  assert.strictEqual(chips.contacto, true);
  assert.strictEqual(chips.entrega, 'pendiente', 'ciudad no es domicilio de entrega (CP+pais)');
  assert.strictEqual(chips.fiscal, false, 'sin RFC real');
});

test('C3: RFC generico no cuenta como fiscal completo', () => {
  const c = { name: 'X', telefono: '+52 5555555555', rfc: 'XAXX010101000' };
  assert.strictEqual(chipsCompletitud(c).fiscal, false);
  const c2 = { name: 'X', telefono: '+52 5555555555', rfc: 'XEXX010101000' };
  assert.strictEqual(chipsCompletitud(c2).fiscal, false);
});

test('C4: sin telefono no hay chip de Contacto', () => {
  assert.strictEqual(chipsCompletitud({ name: 'X' }).contacto, false);
});

// === contactoAccionable: el chip Contacto abre la captura del telefono (#418) ===
// Un Cliente Operam sin telefono no tenia por donde capturarlo: el campo vive en
// el formulario legacy oculto. El chip se vuelve boton solo cuando falta el
// telefono -- lo unico que el paso Cliente sabe capturar de ese chip.

test('CA1: Cliente Operam sin telefono -> el chip Contacto es accionable', () => {
  const c = { name: 'G J Y ASOCIADOS ABOGADOS SC', ref: 'GJY', telefono: '', rfc: 'GAA010101AB1', tipo: 'operam' };
  assert.strictEqual(contactoAccionable(c), true);
});

test('CA2: cliente con telefono -> el chip Contacto NO es accionable', () => {
  const c = { name: 'La Vasija', telefono: '+52 55 1234 5678', tipo: 'operam' };
  assert.strictEqual(contactoAccionable(c), false);
});

test('CA3: telefono de puros espacios cuenta como ausente (misma lectura que chipsCompletitud)', () => {
  const c = { name: 'X', telefono: '   ' };
  assert.strictEqual(contactoAccionable(c), true);
  assert.strictEqual(chipsCompletitud(c).contacto, false);
});

test('CA4: sin la llave telefono (fila Operam sin branches ni contacts) -> accionable', () => {
  assert.strictEqual(contactoAccionable({ name: 'X' }), true);
});

test('CA5: telefono incompleto -> sigue accionable y el chip NO se pone verde', () => {
  const c = { name: 'X', telefono: '+52 55' };
  assert.strictEqual(contactoAccionable(c), true);
  assert.strictEqual(chipsCompletitud(c).contacto, false);
});

test('CA6: numero sin codigo de pais (pais "Otro") -> accionable, igual que la reja de la generacion', () => {
  const c = { name: 'X', telefono: '12345678' };
  assert.strictEqual(contactoAccionable(c), true);
  assert.strictEqual(chipsCompletitud(c).contacto, false);
});

test('CA7: E.164 del widget (sin espacios) -> chip verde y no accionable', () => {
  const c = { name: 'X', telefono: '+525512345678' };
  assert.strictEqual(contactoAccionable(c), false);
  assert.strictEqual(chipsCompletitud(c).contacto, true);
});

test('CA8: el campo cl-telefono vive en #pc-tel-captura, fuera del bloque oculto de facturacion', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
  const bloque = (id) => {
    const ini = html.indexOf(`<div id="${id}"`);
    assert.ok(ini >= 0, `falta #${id}`);
    let prof = 0;
    const re = /<div\b|<\/div>/g;
    re.lastIndex = ini;
    for (let m; (m = re.exec(html));) {
      prof += m[0] === '</div>' ? -1 : 1;
      if (prof === 0) return html.slice(ini, re.lastIndex);
    }
    assert.fail(`#${id} sin cerrar`);
  };
  assert.ok(bloque('pc-tel-captura').includes('id="cl-telefono"'));
  assert.ok(!bloque('pc-factura-hidden').includes('id="cl-telefono"'));
});

test('C5: CP + pais validos sin Calle -> entrega "cp" (#84)', () => {
  const c = { name: 'X', telefono: '+52 5555555555', cp: '06600', pais: 'MX' };
  assert.strictEqual(chipsCompletitud(c).entrega, 'cp');
});

test('C6: CP con formato invalido -> entrega "pendiente" aunque haya algo tecleado', () => {
  const c = { name: 'X', telefono: '+52 5555555555', cp: '123', pais: 'MX' };
  assert.strictEqual(chipsCompletitud(c).entrega, 'pendiente');
});

test('C7: CP valido canadiense + Calle -> entrega "completo"', () => {
  const c = { name: 'X', telefono: '+52 5555555555', cp: 'K1A 0A9', pais: 'CA', calle: 'Main St 1' };
  assert.strictEqual(chipsCompletitud(c).entrega, 'completo');
});

test('C8: sin nada de entrega -> "pendiente"', () => {
  assert.strictEqual(chipsCompletitud({ name: 'X', telefono: '+52 5555555555' }).entrega, 'pendiente');
});

// === #427: el chip Contacto juzga el numero de Operam como lo completa el campo ===
// Operam guarda el numero como se tecleo, casi siempre sin codigo de pais. En el
// paso Cliente el widget lo carga con separarTelefonoCodigo y lo arma con su
// codigo; la vista Clientes juzgaba el texto crudo y el mismo cliente salia
// pendiente ahi y verde en el paso Cliente (casos de produccion, 2026-09-22).

test('C9 (#427): 6 MALTE TALLER, Cel 5565641576 sin codigo -> Contacto verde y no accionable', () => {
  const fila = { tipo: 'operam', id: '6', name: 'MALTE TALLER', telefono: '5565641576', telefonos: ['5565641576'] };
  assert.strictEqual(chipsCompletitud(fila).contacto, true);
  assert.strictEqual(contactoAccionable(fila), false);
});

test('C10 (#427): 19 LANIFEM, 444 165 8765 con espacios y sin codigo -> mismo resultado', () => {
  const fila = { tipo: 'operam', id: '19', name: 'LANIFEM', telefono: '444 165 8765', telefonos: ['444 165 8765'] };
  assert.strictEqual(chipsCompletitud(fila).contacto, true);
  assert.strictEqual(contactoAccionable(fila), false);
});

test('C11 (#427): numero que ya trae su codigo (+52 55 6564 1576) -> sin cambios, verde', () => {
  const fila = { tipo: 'operam', id: '6', name: 'MALTE TALLER', telefono: '+52 55 6564 1576' };
  assert.strictEqual(chipsCompletitud(fila).contacto, true);
  assert.strictEqual(contactoAccionable(fila), false);
});

test('C12 (#427): 12 digitos que empiezan con 52 y 11 que empiezan con 1 se completan como en el campo', () => {
  assert.strictEqual(chipsCompletitud({ name: 'X', telefono: '52 55 6564 1576' }).contacto, true);
  assert.strictEqual(chipsCompletitud({ name: 'X', telefono: '1 337 292 4966' }).contacto, true);
});

test('C13 (#427): lo que el campo no sabe completar sigue pendiente y accionable', () => {
  for (const telefono of ['656 1576', 'sin numero', 'Tel. 55 65', '565641576']) {
    const fila = { tipo: 'operam', name: 'X', telefono };
    assert.strictEqual(chipsCompletitud(fila).contacto, false, telefono);
    assert.strictEqual(contactoAccionable(fila), true, telefono);
  }
});

test('C14 (#427): completar no rescata un nacional mexicano invalido (la reja sigue siendo la misma)', () => {
  const fila = { name: 'X', telefono: '0565641576' };
  assert.strictEqual(chipsCompletitud(fila).contacto, false);
  assert.strictEqual(contactoAccionable(fila), true);
});

test('C15 (#427): Cliente Operam sin telefono -> Contacto sigue pendiente', () => {
  const fila = { tipo: 'operam', id: '7', name: 'SIN TELEFONO SA', telefono: '', telefonos: [] };
  assert.strictEqual(chipsCompletitud(fila).contacto, false);
  assert.strictEqual(contactoAccionable(fila), true);
});

// === buildClienteDesdeContactoNuevo: alimenta gate #81 y cl-* ===

test('N1: nombre alimenta name Y ref (gate #81: razonSocial||nombreCorto), ciudad -> municipio', () => {
  const c = buildClienteDesdeContactoNuevo({ nombre: '  Juan Perez ', telefono: '+52 55 1234 5678', ciudad: 'Puebla', canal: 'WhatsApp' });
  assert.strictEqual(c.name, 'Juan Perez');
  assert.strictEqual(c.ref, 'Juan Perez');
  assert.strictEqual(c.telefono, '+52 55 1234 5678');
  assert.strictEqual(c.municipio, 'Puebla');
  assert.strictEqual(c.pais, 'MX');
  assert.strictEqual(c.tipo, 'nuevo');
  assert.strictEqual(c.rfc, '');
});

test('N2: respeta pais extranjero', () => {
  const c = buildClienteDesdeContactoNuevo({ nombre: 'John', telefono: '+1 5551234567', ciudad: 'Dallas', pais: 'US' });
  assert.strictEqual(c.pais, 'US');
});

// issue #121: el segmento elegido en el formulario "Contacto nuevo" viaja al cliente
// para que el alta generica lo mande a Operam (buildClienteGenerico lee segmentoId).
test('N3: segmento elegido -> segmentoId (issue #121)', () => {
  const c = buildClienteDesdeContactoNuevo({ nombre: 'Juan', telefono: '+52 5588776655', ciudad: 'CDMX', segmentoId: '10' });
  assert.strictEqual(c.segmentoId, '10');
});

test('N4: sin segmento elegido -> segmentoId vacio', () => {
  const c = buildClienteDesdeContactoNuevo({ nombre: 'Juan', telefono: '+52 5588776655', ciudad: 'CDMX' });
  assert.strictEqual(c.segmentoId, '');
});

// === clienteDesdeProspecto ===

test('P1: normaliza un prospecto al objeto cliente del cotizador', () => {
  const c = clienteDesdeProspecto(PROSPECTOS[0]);
  assert.strictEqual(c.tipo, 'prospecto');
  assert.strictEqual(c.name, 'Maria Torres');
  assert.strictEqual(c.ref, 'Maria Torres');
  assert.strictEqual(c.telefono, '+52 33 1234 5678');
  assert.strictEqual(c.municipio, 'Guadalajara');
  assert.strictEqual(c.prospectoId, 1);
  assert.strictEqual(c.rfc, '');
});

// === clienteDesdeProspecto: enhebrar el customer_id del cliente generico (#85) ===
// Un prospecto que ya cotizo quedo ligado a un cliente generico en Operam
// (prospectosStore.ligarCliente guarda data.cliente_id). Ese id es el destino del
// PUT del upgrade fiscal; sin el la tarjeta no sabe contra que cliente actualizar.

test('P2: prospecto ligado a cliente generico expone clienteOperamId', () => {
  const p = { id: 5, nombre: 'Ligado SA', ciudad: 'Leon', celular: '+52 47 7000 0000', data: { cliente_id: 912 } };
  assert.strictEqual(clienteDesdeProspecto(p).clienteOperamId, 912);
});

test('P3: prospecto sin data (nunca cotizo) tiene clienteOperamId null', () => {
  assert.strictEqual(clienteDesdeProspecto(PROSPECTOS[0]).clienteOperamId, null);
});

// issue #121: el segmento elegido al capturar el prospecto (persistido en
// data.segmento_id, OPCIONALES de prospectos-logica.js) debe sobrevivir a un
// "Ya lo conozco" -> prospecto en otra sesion, no solo al guardado inmediato del
// mismo "Contacto nuevo".
test('P5: prospecto con segmento_id en data expone segmentoId (issue #121)', () => {
  const p = { id: 6, nombre: 'Con Segmento SA', ciudad: 'CDMX', celular: '+52 55 0000 0000', data: { segmento_id: '10' } };
  assert.strictEqual(clienteDesdeProspecto(p).segmentoId, '10');
});

test('P6: prospecto sin segmento_id en data -> segmentoId vacio', () => {
  assert.strictEqual(clienteDesdeProspecto(PROSPECTOS[0]).segmentoId, '');
});

test('P4: prospecto con data pero sin cliente_id tiene clienteOperamId null', () => {
  const p = { id: 6, nombre: 'X', celular: '+52 5500000000', data: { correo: 'x@y.com' } };
  assert.strictEqual(clienteDesdeProspecto(p).clienteOperamId, null);
});

// === accionCelularContactoNuevo: guardrails del celular (AC3/AC4, #69) ===

test('A1: celular libre -> crear', () => {
  const r = accionCelularContactoNuevo({ tipo: 'libre' }, 'Ana');
  assert.strictEqual(r.accion, 'crear');
});

test('A2: celular de cliente Operam -> cotizar sobre ese cliente (AC4)', () => {
  const r = accionCelularContactoNuevo({ tipo: 'cliente', cust_name: 'LA VASIJA AZUL SA DE CV' }, 'Ana');
  assert.strictEqual(r.accion, 'cotizar_cliente');
  assert.strictEqual(r.cust_name, 'LA VASIJA AZUL SA DE CV');
  assert.match(r.mensaje, /cliente/i);
});

test('A3: prospecto propio -> usar_prospecto (no se duplica, AC3)', () => {
  const r = accionCelularContactoNuevo({ tipo: 'prospecto', prospecto: { nombre: 'Juan', vendedor: 'Ana' } }, 'Ana');
  assert.strictEqual(r.accion, 'usar_prospecto');
  assert.match(r.mensaje, /Juan/);
});

test('A4: prospecto ajeno -> bloquear con aviso de quien lo atiende (#69/Visibilidad)', () => {
  const r = accionCelularContactoNuevo({ tipo: 'prospecto', prospecto: { nombre: 'Juan', vendedor: 'Beto' } }, 'Ana');
  assert.strictEqual(r.accion, 'bloquear');
  assert.match(r.mensaje, /Beto/);
});

test('A5: clasificacion nula tolerada -> crear', () => {
  assert.strictEqual(accionCelularContactoNuevo(null, 'Ana').accion, 'crear');
});

// === decidirVistaTrasBusqueda ===

test('V1: query corta -> recientes', () => {
  assert.strictEqual(decidirVistaTrasBusqueda('v', []), 'recientes');
});
test('V2: con resultados -> resultados', () => {
  assert.strictEqual(decidirVistaTrasBusqueda('vasija', [{ tipo: 'operam' }]), 'resultados');
});
test('V3: sin resultados -> crear', () => {
  assert.strictEqual(decidirVistaTrasBusqueda('zzz', []), 'crear');
});

// === ofreceCrearContacto: la fila "Crear contacto" del paso Cliente (#421) ===
// Decision de Adrian 2026-09-23: con un RFC que ya encontro un Cliente Operam la
// fila no sale (invita a duplicar); con un nombre, o con un RFC sin resultados,
// sale como siempre.

test('C1 (#421): un RFC que encontro al Cliente Operam no ofrece crear contacto', () => {
  for (const q of ['GJA990301TM7', 'gja990301tm7', 'GJA 990301 TM7']) {
    const filas = mezclarResultadosBusqueda([CLIENTE_52], [], q);
    assert.strictEqual(filas.length, 1, `"${q}" encuentra al 52`);
    assert.strictEqual(ofreceCrearContacto(q, filas), false, `"${q}"`);
  }
});

test('C2 (#421): un RFC sin resultados si ofrece crear contacto', () => {
  const filas = mezclarResultadosBusqueda([], [], 'GJA990301TM7');
  assert.strictEqual(ofreceCrearContacto('GJA990301TM7', filas), true);
});

test('C3 (#421): un nombre que encuentra al Cliente Operam sigue ofreciendo crear contacto', () => {
  const filas = mezclarResultadosBusqueda([CLIENTE_52], [], 'G J Y ASOCIADOS');
  assert.strictEqual(filas.length, 1);
  assert.strictEqual(ofreceCrearContacto('G J Y ASOCIADOS', filas), true);
});

test('C4 (#421): un RFC que solo encontro prospectos (ningun Cliente Operam) si ofrece crear contacto', () => {
  const filas = [{ tipo: 'prospecto', id: 1, nombre: 'Maria Torres' }];
  assert.strictEqual(ofreceCrearContacto('GJA990301TM7', filas), true);
});

// === accionProspecto409: decision del frontend ante el 409 estructurado de
// POST /api/prospectos (tipo, no parsing de strings de error) ===

test('Q1: 409 tipo cliente -> cotizar sobre ese cliente, sin continuar la captura', () => {
  const r = accionProspecto409({ tipo: 'cliente', cust_name: 'HOTELERA DEL SUR SA DE CV', error: 'Este celular es del cliente...' });
  assert.strictEqual(r.accion, 'cotizar_cliente');
  assert.strictEqual(r.cust_name, 'HOTELERA DEL SUR SA DE CV');
  assert.ok(r.mensaje);
});

test('Q2: 409 tipo prospecto_propio -> usar el prospecto existente (1 celular = 1 prospecto)', () => {
  const p = { id: 4, nombre: 'Laura', ciudad: 'Puebla', celular: '+52 5512345678' };
  const r = accionProspecto409({ tipo: 'prospecto_propio', prospecto: p, error: 'ya es un prospecto' });
  assert.strictEqual(r.accion, 'usar_prospecto');
  assert.deepStrictEqual(r.prospecto, p);
});

test('Q3: 409 tipo prospecto_ajeno -> bloquear con el mensaje del server', () => {
  const r = accionProspecto409({ tipo: 'prospecto_ajeno', error: 'Este celular ya lo atiende Memo' });
  assert.strictEqual(r.accion, 'bloquear');
  assert.match(r.mensaje, /Memo/);
});

test('Q4: 409 sin tipo (server viejo/desconocido) -> bloquear, nunca crear contacto fantasma', () => {
  const r = accionProspecto409({ error: 'Este celular es del cliente X - cotizale como cliente, no se crea prospecto' });
  assert.strictEqual(r.accion, 'bloquear');
  assert.strictEqual(accionProspecto409(null).accion, 'bloquear');
});

// === paisDesdeCodigoTelefono: +1-CA debe dar CA, no US (CP canadiense valido) ===

test('T1: +52 -> MX, +1 -> US, +1-CA -> CA', () => {
  assert.strictEqual(paisDesdeCodigoTelefono('+52'), 'MX');
  assert.strictEqual(paisDesdeCodigoTelefono('+1'), 'US');
  assert.strictEqual(paisDesdeCodigoTelefono('+1-CA'), 'CA');
});

test('T2: codigo desconocido o vacio -> MX (default del negocio)', () => {
  assert.strictEqual(paisDesdeCodigoTelefono('+'), 'MX');
  assert.strictEqual(paisDesdeCodigoTelefono(''), 'MX');
  assert.strictEqual(paisDesdeCodigoTelefono(undefined), 'MX');
});

// === contactosEntregaDisponibles / etiquetaTagContacto: selector de contactos de
// entrega en el paso Envio (issue #99). Combina el contacto propio del domicilio
// (branch) con los contactos del cliente (contacts[], con tag de Operam), SIEMPRE
// con nombre visible -- nunca un telefono/correo suelto sin dueno (bug real: cliente
// GRUPO URUGUAYO MINAS con 4 contactos a nivel cliente y 0 a nivel domicilio, la app
// prellenaba telefono/correo sin decir de quien eran).

test('X1: domicilio con contacto propio + contactos del cliente -> el del domicilio va primero, tag "domicilio"', () => {
  const dom = { contacto: 'Adriana Urena', telefono: '55 1072 7542', email: 'a.urena@museo.mx' };
  const contactosCliente = [
    { tag: 'general', nombre: 'Gustavo Barcia', telefono: '55 4860 9144', email: 'gustavo@gum.com' },
  ];
  const r = contactosEntregaDisponibles(dom, contactosCliente);
  assert.strictEqual(r.length, 2);
  assert.strictEqual(r[0].tag, 'domicilio');
  assert.strictEqual(r[0].nombre, 'Adriana Urena');
  assert.strictEqual(r[1].nombre, 'Gustavo Barcia');
});

test('X2: domicilio sin contacto propio (calle sin nombre/telefono/email) -> solo los del cliente', () => {
  const dom = { calle: 'Reforma 100' };
  const contactosCliente = [{ tag: 'general', nombre: 'Gustavo Barcia', telefono: '', email: 'gustavo@gum.com' }];
  const r = contactosEntregaDisponibles(dom, contactosCliente);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].nombre, 'Gustavo Barcia');
});

test('X3: sin domicilio ni contactos de cliente -> []', () => {
  assert.deepStrictEqual(contactosEntregaDisponibles(null, []), []);
  assert.deepStrictEqual(contactosEntregaDisponibles({}, null), []);
});

test('X4: descarta contactos de cliente sin nombre NI telefono NI email', () => {
  const r = contactosEntregaDisponibles({}, [{ tag: 'general', nombre: '', telefono: '', email: '' }]);
  assert.deepStrictEqual(r, []);
});

test('X5: etiquetaTagContacto traduce los tags conocidos de Operam y el del domicilio', () => {
  assert.strictEqual(etiquetaTagContacto('general'), 'General');
  assert.strictEqual(etiquetaTagContacto('invoice'), 'Facturacion');
  assert.strictEqual(etiquetaTagContacto('delivery'), 'Entrega');
  assert.strictEqual(etiquetaTagContacto('domicilio'), 'Domicilio');
});

test('X6: etiquetaTagContacto con tag desconocido lo regresa tal cual; vacio -> vacio', () => {
  assert.strictEqual(etiquetaTagContacto('otro'), 'otro');
  assert.strictEqual(etiquetaTagContacto(''), '');
  assert.strictEqual(etiquetaTagContacto(undefined), '');
});

// === El Contacto de la cotizacion como TERCERA fuente del selector (issue #353) ===
// Cotizando para un Contacto (persona del celular) sin Cliente Operam con contactos,
// las dos fuentes de Operam estan vacias, el selector no se pintaba y "Entregar a"
// se tecleaba a mano -- aunque la app ya sabe como se llama esa persona. El Contacto
// entra AL FINAL: las fuentes de Operam conservan su orden y su autollenado.

test('X7: solo el Contacto de la cotizacion (sin fuentes de Operam) -> es la unica opcion, tag "contacto"', () => {
  const contacto = { tag: 'contacto', nombre: 'Jorge Orea', telefono: '+52 55 1234 5678', email: 'jorge@orea.mx' };
  const r = contactosEntregaDisponibles(null, null, contacto);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].tag, 'contacto');
  assert.strictEqual(r[0].nombre, 'Jorge Orea');
  assert.strictEqual(r[0].telefono, '+52 55 1234 5678');
});

test('X8: con fuentes de Operam, el Contacto va AL FINAL y la opcion 0 sigue siendo la de siempre', () => {
  const dom = { contacto: 'Adriana Urena', telefono: '55 1072 7542', email: 'a.urena@museo.mx' };
  const contactosCliente = [{ tag: 'general', nombre: 'Gustavo Barcia', telefono: '55 4860 9144', email: '' }];
  const contacto = { tag: 'contacto', nombre: 'Jorge Orea', telefono: '+52 55 1234 5678', email: '' };
  const r = contactosEntregaDisponibles(dom, contactosCliente, contacto);
  assert.strictEqual(r.length, 3);
  assert.strictEqual(r[0].tag, 'domicilio');
  assert.strictEqual(r[1].nombre, 'Gustavo Barcia');
  assert.strictEqual(r[2].tag, 'contacto');
});

test('X9: un Contacto sin nombre NI telefono NI email no entra a la lista', () => {
  assert.deepStrictEqual(contactosEntregaDisponibles(null, null, { tag: 'contacto', nombre: '', telefono: '', email: '' }), []);
  assert.deepStrictEqual(contactosEntregaDisponibles(null, null, null), []);
});

// contactoEntregaDelCliente traduce el cliente elegido en el paso Cliente a una
// entrada del selector. Solo la persona: un Cliente Operam es una razon social y sus
// personas ya vienen por contacts[] (glosario: Contacto vs Contacto en Operam).
test('X10: contactoEntregaDelCliente convierte al prospecto/contacto nuevo; el Cliente Operam no', () => {
  const prospecto = { tipo: 'prospecto', name: 'Jorge Orea', telefono: '+52 55 1234 5678', email: 'jorge@orea.mx' };
  assert.deepStrictEqual(contactoEntregaDelCliente(prospecto), {
    tag: 'contacto', nombre: 'Jorge Orea', telefono: '+52 55 1234 5678', email: 'jorge@orea.mx',
  });
  const nuevo = { tipo: 'nuevo', name: 'Ana Ruiz', telefono: '55 9999 0000', email: '' };
  assert.strictEqual(contactoEntregaDelCliente(nuevo).nombre, 'Ana Ruiz');
  assert.strictEqual(contactoEntregaDelCliente({ tipo: 'operam', name: 'GRUPO URUGUAYO MINAS SA DE CV' }), null);
  assert.strictEqual(contactoEntregaDelCliente(null), null);
});

// El upgrade fiscal (#85) pisa `name` con la razon social del SAT sin cambiar el
// tipo: ese prospecto ya no lleva ahi el nombre de una persona, y ofrecerlo pondria
// la razon social en MAYUSCULAS en el "Entregar a" que se imprime.
test('X10b: un prospecto que ya subio su constancia deja de ser el Contacto de entrega', () => {
  const conCsf = { tipo: 'prospecto', name: 'LAURA DANIRA GONZALEZ FERNANDEZ', rfc: 'GOFL851023IT6', telefono: '+52 55 1234 5678' };
  assert.strictEqual(contactoEntregaDelCliente(conCsf), null);
});

// El telefono compara por la llave de identidad del repo, no como texto: Operam
// entrega extensiones pegadas al numero y el widget (#176) reescribe el campo.
test('X10c: el mismo numero empata aunque Operam lo traiga con extension', () => {
  const contactos = [{ tag: 'general', nombre: 'Patricia Hamui', telefono: '55 5395 2615 ext 116', email: '' }];
  const r = seleccionContactoEntrega(contactos, { nombre: '', telefono: '+52 55 5395 2615', email: '' });
  assert.deepStrictEqual(r, { indice: 0, aplicar: true });
});

// Cargar una cotizacion copia a Envio su entrega (cargarCotizacion, Editar y
// Copiar; hasta #409 tambien los Recientes del paso Cliente, que hoy prellenan la
// busqueda). El cliente de la tarjeta no traia correo: la opcion "(Contacto)" no
// explicaba lo capturado, el selector arrancaba en "+ Nuevo contacto" y elegirla
// borraba el correo (Erick Tellez, cotizacion 106, HITL de #353).
test('X10d: una cotizacion cargada deja elegida la opcion del Contacto con su correo', () => {
  const cotizacion = {
    rfc: '', razonSocial: 'Erick Tellez', nombreCorto: 'Erick Tellez', telefono: '+523221508025',
    nombreEntrega: 'Erick Tellez', celEntrega: '+523221508025', emailEntrega: 'erick.tellez@auberge.com',
    cpEntrega: '63734', pais: 'MX', customerId: 528,
  };
  const cliente = clienteDesdeCotizacionReciente(cotizacion);
  assert.strictEqual(cliente.clienteOperamId, 528);
  const contactos = contactosEntregaDisponibles(null, null, contactoEntregaDelCliente(cliente));
  const capturado = { nombre: cotizacion.nombreEntrega, telefono: cotizacion.celEntrega, email: cotizacion.emailEntrega };
  assert.deepStrictEqual(seleccionContactoEntrega(contactos, capturado), { indice: 0, aplicar: true });
  assert.strictEqual(contactos[0].email, 'erick.tellez@auberge.com');
});

test('X10e: si esa cotizacion se entrego a otra persona, lo capturado no es del Contacto', () => {
  const cotizacion = {
    razonSocial: 'Erick Tellez', telefono: '+523221508025',
    nombreEntrega: 'Rosa Mena', celEntrega: '+525511112222', emailEntrega: 'rosa@hotel.mx',
  };
  const contactos = contactosEntregaDisponibles(null, null, contactoEntregaDelCliente(clienteDesdeCotizacionReciente(cotizacion)));
  const capturado = { nombre: 'Rosa Mena', telefono: '+525511112222', email: 'rosa@hotel.mx' };
  assert.deepStrictEqual(seleccionContactoEntrega(contactos, capturado), { indice: null, aplicar: false });
});

test('X11: etiquetaTagContacto traduce el tag del Contacto de la cotizacion', () => {
  assert.strictEqual(etiquetaTagContacto('contacto'), 'Contacto');
});

// === seleccionContactoEntrega: que opcion queda elegida y si se pisa lo capturado ===
// El selector se re-pinta en cada pcRenderTarjeta (cambio de cliente, upgrade fiscal,
// borrador restaurado). Aplicar la opcion 0 en cada repintada pisaba en silencio el
// "Entregar a" que el vendedor habia tecleado y que el borrador acababa de restaurar
// (misma clase de bug que #352). La pregunta es de QUIEN es lo que ya esta en los
// campos: si es de una de las opciones se completan sus huecos, y si no es de nadie
// lo escribio una persona y no se toca.
const CONTACTOS = [
  { tag: 'domicilio', nombre: 'Adriana Urena', telefono: '55 1072 7542', email: 'a.urena@museo.mx' },
  { tag: 'contacto', nombre: 'Jorge Orea', telefono: '+52 55 1234 5678', email: 'jorge@orea.mx' },
];

test('X12: sin nada capturado -> se elige y se aplica la primera opcion (autollenado de siempre)', () => {
  assert.deepStrictEqual(
    seleccionContactoEntrega(CONTACTOS, { nombre: '', telefono: '', email: '' }),
    { indice: 0, aplicar: true },
  );
});

test('X13: lo capturado ES una de las opciones -> queda elegida esa', () => {
  const r = seleccionContactoEntrega(CONTACTOS, { nombre: 'Jorge Orea', telefono: '55 1234 5678', email: 'JORGE@orea.mx' });
  assert.deepStrictEqual(r, { indice: 1, aplicar: true });
});

// EL caso del ticket: elegir un Contacto ya escribia su celular y su correo de
// entrega (pcLlenarCamposContacto) pero nunca su nombre. Esos dos campos son suyos,
// asi que no son captura ajena que proteger: se completa el hueco de "Entregar a".
test('X14: capturado el celular y el correo del Contacto, falta el nombre -> se elige y se aplica', () => {
  const r = seleccionContactoEntrega(CONTACTOS, { nombre: '', telefono: '+52 55 1234 5678', email: 'jorge@orea.mx' });
  assert.deepStrictEqual(r, { indice: 1, aplicar: true });
});

test('X15: lo capturado no es ninguna opcion -> "+ Nuevo contacto" y NO se pisa', () => {
  const r = seleccionContactoEntrega(CONTACTOS, { nombre: 'Recepcion almacen', telefono: '', email: '' });
  assert.deepStrictEqual(r, { indice: null, aplicar: false });
});

// Un nombre tecleado a mano manda aunque el celular si sea el del Contacto: el
// borrador restaurado con "Recepcion almacen" no se vuelve "Jorge Orea" solo.
test('X16: un solo campo capturado que no corresponde basta para no pisar nada', () => {
  const r = seleccionContactoEntrega(CONTACTOS, { nombre: 'Recepcion almacen', telefono: '+52 55 1234 5678', email: 'jorge@orea.mx' });
  assert.deepStrictEqual(r, { indice: null, aplicar: false });
});

test('X17: sin opciones no hay nada que elegir ni que aplicar', () => {
  assert.deepStrictEqual(seleccionContactoEntrega([], { nombre: '', telefono: '', email: '' }), { indice: null, aplicar: false });
  assert.deepStrictEqual(seleccionContactoEntrega(null, null), { indice: null, aplicar: false });
});

// EL caso de #355: el vendedor eligio "+ Nuevo contacto" para capturar a mano a
// quien recibe y todavia no teclea nada. Mirando solo los campos, ese vacio es
// identico al de "todavia no hay nada", asi que la repintada de la tarjeta (hoy el
// regreso del upgrade fiscal) re-aplicaba la opcion 0 sobre su decision explicita.
// La marca de captura manual es la que distingue los dos vacios.
test('X18: con captura manual y campos vacios -> "+ Nuevo contacto", sin autollenado', () => {
  assert.deepStrictEqual(
    seleccionContactoEntrega(CONTACTOS, { nombre: '', telefono: '', email: '' }, true),
    { indice: null, aplicar: false },
  );
});

// La marca dura hasta que el vendedor la quite (otra opcion del selector u otro
// cliente; otro domicilio ya no, #422), asi que tampoco un dato que CASUALMENTE sea el de una
// opcion vuelve a elegirla: tecleo esos digitos a mano y el selector no se le mueve.
test('X19: con captura manual, ni lo que corresponde a una opcion la re-elige', () => {
  assert.deepStrictEqual(
    seleccionContactoEntrega(CONTACTOS, { nombre: '', telefono: '+52 55 1234 5678', email: 'jorge@orea.mx' }, true),
    { indice: null, aplicar: false },
  );
});

// Limpiar la marca (cambio de cliente, otra opcion del selector) devuelve el
// autollenado de siempre: la marca es lo unico que cambia el veredicto.
test('X20: sin la marca, el autollenado de #353 no cambia', () => {
  assert.deepStrictEqual(
    seleccionContactoEntrega(CONTACTOS, { nombre: '', telefono: '', email: '' }, false),
    { indice: 0, aplicar: true },
  );
});

// === La misma persona es UNA opcion, con todos sus papeles (#424) ===
// Cliente Operam 228 (Lobo Glamp): el contacto de su unico domicilio y su contacto
// General nacieron con los mismos datos en el alta del cotizador, y el selector
// ofrecia dos opciones que eran la misma persona. El vendedor leyo el selector de
// contacto como la lista de domicilios y concluyo que el cotizador no correspondia
// a Operam. Decision de Adrian (2026-09-22): la opcion que queda lleva TODOS los
// papeles juntos.
const LOBO_GLAMP_DOMICILIO = { descripcion: 'Cecilia Avila', contacto: 'Lobo Glamp', telefono: '', email: 'adri3012@hotmail.com' };

test('X21: contacto del domicilio y contacto General con los mismos datos son UNA opcion (Domicilio, General)', () => {
  const contactosCliente = [{ tag: 'general', nombre: 'Lobo Glamp', telefono: '', email: 'adri3012@hotmail.com' }];
  const r = contactosEntregaDisponibles(LOBO_GLAMP_DOMICILIO, contactosCliente);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].nombre, 'Lobo Glamp');
  assert.strictEqual(r[0].tag, 'domicilio');
  assert.deepStrictEqual(r[0].tags, ['domicilio', 'general']);
  assert.strictEqual(etiquetaPapelesContacto(r[0]), 'Domicilio, General');
});

// Cliente 217: Operam entrega a Israel Avila una vez por rol (delivery, general,
// invoice, order). Sale UNA vez con los cuatro papeles en el orden en que llegaron.
test('X22: un contacto repetido en 4 papeles sale una vez, con los 4 papeles en orden', () => {
  const israel = { nombre: 'Israel Avila', telefono: '55 2222 3333', email: 'israel@avila.mx' };
  const contactosCliente = [
    { tag: 'general', ...israel },
    { tag: 'invoice', ...israel },
    { tag: 'delivery', ...israel },
    { tag: 'order', ...israel },
  ];
  const r = contactosEntregaDisponibles({ calle: 'Reforma 100' }, contactosCliente);
  assert.strictEqual(r.length, 1);
  assert.deepStrictEqual(r[0].tags, ['general', 'invoice', 'delivery', 'order']);
  assert.strictEqual(etiquetaPapelesContacto(r[0]), 'General, Facturacion, Entrega, Pedido');
});

// Mismo nombre no es misma persona: un telefono o un correo distinto son otra
// forma de localizar a quien recibe, y el vendedor tiene que poder elegirla.
test('X23: mismo nombre con otro telefono u otro correo sale por separado', () => {
  const base = { nombre: 'Israel Avila', telefono: '55 2222 3333', email: 'israel@avila.mx' };
  const otroTelefono = contactosEntregaDisponibles(null, [
    { tag: 'general', ...base },
    { tag: 'delivery', ...base, telefono: '55 9999 8888' },
  ]);
  assert.strictEqual(otroTelefono.length, 2);
  const otroCorreo = contactosEntregaDisponibles(null, [
    { tag: 'general', ...base },
    { tag: 'invoice', ...base, email: 'facturas@avila.mx' },
  ]);
  assert.strictEqual(otroCorreo.length, 2);
  assert.deepStrictEqual(otroCorreo.map(c => c.tags), [['general'], ['invoice']]);
});

// Vacio contra lleno no es "igual": con lo que se sabe son dos personas distintas.
test('X24: un dato vacio en una entrada y lleno en la otra NO las junta', () => {
  const r = contactosEntregaDisponibles(
    { contacto: 'Lobo Glamp', telefono: '', email: 'adri3012@hotmail.com' },
    [{ tag: 'general', nombre: 'Lobo Glamp', telefono: '55 4444 5555', email: 'adri3012@hotmail.com' }],
  );
  assert.strictEqual(r.length, 2);
});

// El telefono es el mismo numero aunque venga en otro formato: el Contacto de la
// cotizacion lo trae del widget con lada de pais y Operam sin ella. Nombre y
// correo se comparan sin mayusculas ni acentos.
test('X25: el mismo telefono en otro formato SI se junta, tambien con el Contacto de la cotizacion', () => {
  const r = contactosEntregaDisponibles(
    null,
    [{ tag: 'general', nombre: 'Ramon Garcia', telefono: '55 1234 5678', email: 'Ramon@Garcia.mx' }],
    { tag: 'contacto', nombre: 'Ram\u00f3n Garc\u00eda', telefono: '+52 55 1234 5678', email: 'ramon@garcia.mx' },
  );
  assert.strictEqual(r.length, 1);
  assert.deepStrictEqual(r[0].tags, ['general', 'contacto']);
  assert.strictEqual(r[0].telefono, '55 1234 5678');
  assert.strictEqual(etiquetaPapelesContacto(r[0]), 'General, Contacto');
});

// Juntar duplicados no toca la regla de #353/#355: la opcion por defecto sigue
// siendo la primera de la lista, ya sin duplicados, y lo capturado se reconoce
// contra esa misma lista (el indice que devuelve es el del <option> que se pinta).
test('X26: con la lista sin duplicados, el default sigue siendo la primera opcion y lo capturado se reconoce', () => {
  const contactos = contactosEntregaDisponibles(LOBO_GLAMP_DOMICILIO, [
    { tag: 'general', nombre: 'Lobo Glamp', telefono: '', email: 'adri3012@hotmail.com' },
    { tag: 'invoice', nombre: 'Cecilia Avila', telefono: '55 6666 7777', email: 'cecilia@loboglamp.mx' },
  ]);
  assert.strictEqual(contactos.length, 2);
  assert.deepStrictEqual(
    seleccionContactoEntrega(contactos, { nombre: '', telefono: '', email: '' }),
    { indice: 0, aplicar: true },
  );
  assert.deepStrictEqual(
    seleccionContactoEntrega(contactos, { nombre: 'Cecilia Avila', telefono: '+52 55 6666 7777', email: '' }),
    { indice: 1, aplicar: true },
  );
  assert.deepStrictEqual(
    seleccionContactoEntrega(contactos, { nombre: '', telefono: '', email: '' }, true),
    { indice: null, aplicar: false },
  );
  assert.deepStrictEqual(
    seleccionContactoEntrega(contactos, { nombre: 'Recepcion almacen', telefono: '', email: '' }),
    { indice: null, aplicar: false },
  );
});

// === cotizacionesPreviasDelCliente: el historial de la tarjeta es POR IDENTIDAD (#389) ===
// El panel "Cotizaciones previas" filtraba TODAS las cotizaciones por los primeros
// 10 caracteres del nombre, asi que "maria del " empataba a cualquier "Maria del
// ...". Como el panel ofrece Editar y Copiar cotizacion sobre esas filas, el
// vendedor podia abrir la de otro cliente creyendo que era del elegido.

// Los dos casos del ticket: el Cliente Operam 44 y la clienta 248, que comparten
// los primeros 10 caracteres del nombre y no son la misma persona.
const CLIENTE_44 = {
  id: 44, name: 'MARIA DEL PILAR ROSETE MELGOZA', ref: 'Maria del Pilar Rosete',
  rfc: 'ROMP580101AB1', telefonos: ['+52 55 4001 2233'],
};
const PREVIAS_248 = [
  { id: 57, fecha: '2026-02-16T18:00:00.000Z', cliente: 'MARIA DEL PILAR CORREA VERGARA', customerId: 248, rfc: 'COVM700202XY8', contactoCelular: '5599887766', total: 8022 },
  { id: 51, fecha: '2026-05-11T18:00:00.000Z', cliente: 'MARIA DEL PILAR CORREA VERGARA', customerId: 248, rfc: 'COVM700202XY8', contactoCelular: '5599887766', total: 6763.88 },
];

test('H1: mismo prefijo de nombre y otro Cliente Operam -> no aparece ninguna (el caso del ticket)', () => {
  assert.deepStrictEqual(cotizacionesPreviasDelCliente(PREVIAS_248, CLIENTE_44), []);
});

test('H2: las cotizaciones del propio Cliente Operam siguen apareciendo, en el orden que llegaron', () => {
  const propias = [
    { id: 90, fecha: '2026-03-02T18:00:00.000Z', cliente: 'MARIA DEL PILAR ROSETE MELGOZA', customerId: 44, rfc: 'ROMP580101AB1', total: 1200 },
    { id: 95, fecha: '2026-06-02T18:00:00.000Z', cliente: 'Maria del Pilar Rosete', customerId: '44', rfc: 'ROMP580101AB1', total: 3400 },
  ];
  assert.deepStrictEqual(
    cotizacionesPreviasDelCliente([PREVIAS_248[0], propias[0], PREVIAS_248[1], propias[1]], CLIENTE_44),
    propias,
  );
});

// Respaldo para la cotizacion vieja que no anoto su Cliente Operam (las del
// backfill #76 y las anteriores al alta generica): el RFC real EXACTO es el mismo
// contribuyente.
test('H3: cotizacion sin customerId pero con el RFC real del cliente -> aparece', () => {
  const vieja = { id: 12, fecha: '2025-11-02T18:00:00.000Z', cliente: 'M. DEL PILAR ROSETE', customerId: null, rfc: 'romp580101ab1', total: 500 };
  assert.deepStrictEqual(cotizacionesPreviasDelCliente([vieja, ...PREVIAS_248], CLIENTE_44), [vieja]);
});

// El RFC generico lo comparten todos los Clientes Operam sin datos fiscales: no
// identifica a nadie y por eso nunca liga (ni del lado del cliente ni del de la
// cotizacion).
test('H4: RFC generico de los dos lados -> no liga nada', () => {
  const generico = { ...CLIENTE_44, rfc: 'XAXX010101000' };
  const cots = [
    { id: 20, fecha: '2026-01-05T18:00:00.000Z', cliente: 'OTRA PERSONA', customerId: null, rfc: 'XAXX010101000', total: 300 },
    { id: 21, fecha: '2026-01-06T18:00:00.000Z', cliente: 'UN EXTRANJERO', customerId: null, rfc: 'XEXX010101000', total: 400 },
  ];
  assert.deepStrictEqual(cotizacionesPreviasDelCliente(cots, generico), []);
  assert.deepStrictEqual(cotizacionesPreviasDelCliente(cots, CLIENTE_44), []);
});

// La liga que la cotizacion ya trae manda: si dice de que Cliente Operam es, ese
// es el veredicto. Dos cuentas del mismo contribuyente son dos clientes distintos
// en Operam y se unifican a mano, no en este panel.
test('H5: cotizacion con customerId de OTRO cliente no entra por el RFC', () => {
  const ajena = { id: 30, fecha: '2026-04-01T18:00:00.000Z', cliente: 'ROSETE MELGOZA MARIA', customerId: 900, rfc: 'ROMP580101AB1', total: 700 };
  assert.deepStrictEqual(cotizacionesPreviasDelCliente([ajena], CLIENTE_44), []);
});

// Segundo respaldo de la cotizacion sin customerId: el Contacto con el que nacio
// (`contactoCelular`) esta en una casilla de telefono del Cliente Operam elegido.
// La comparacion es por los ultimos 10 digitos, como toda identidad de Contacto.
test('H6: cotizacion sin customerId ni RFC real, con el celular del cliente -> aparece', () => {
  const vieja = { id: 40, fecha: '2025-09-09T18:00:00.000Z', cliente: 'PILAR', customerId: null, rfc: 'XAXX010101000', contactoCelular: '+52 1 55 4001 2233', total: 900 };
  assert.deepStrictEqual(cotizacionesPreviasDelCliente([vieja, ...PREVIAS_248], CLIENTE_44), [vieja]);
});

test('H7: el celular de otro Contacto no liga, aunque el nombre se parezca', () => {
  const ajena = { id: 41, fecha: '2025-09-10T18:00:00.000Z', cliente: 'MARIA DEL PILAR CORREA VERGARA', customerId: null, rfc: '', contactoCelular: '5599887766', total: 950 };
  assert.deepStrictEqual(cotizacionesPreviasDelCliente([ajena], CLIENTE_44), []);
});

test('H8: tolera listas y cliente nulos', () => {
  assert.deepStrictEqual(cotizacionesPreviasDelCliente(null, CLIENTE_44), []);
  assert.deepStrictEqual(cotizacionesPreviasDelCliente(PREVIAS_248, null), []);
  assert.deepStrictEqual(cotizacionesPreviasDelCliente([null, undefined], CLIENTE_44), []);
});
