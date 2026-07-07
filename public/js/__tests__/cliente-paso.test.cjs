'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

// Logica pura del rediseno del paso Cliente (variante B, issue #82). Todo lo
// decisional del paso vive en alta-logica.js y se prueba aqui; el render en
// app.js es tonto (sin DOM en Node, no se prueba). Ver prototype-cliente.html.

let mezclarResultadosBusqueda, recientesDesdeCotizaciones, chipsCompletitud,
  buildClienteDesdeContactoNuevo, clienteDesdeProspecto, accionCelularContactoNuevo,
  decidirVistaTrasBusqueda;

before(async () => {
  ({
    mezclarResultadosBusqueda, recientesDesdeCotizaciones, chipsCompletitud,
    buildClienteDesdeContactoNuevo, clienteDesdeProspecto, accionCelularContactoNuevo,
    decidirVistaTrasBusqueda,
  } = await import('../alta-logica.js'));
});

const OPERAM = [
  { id: 10, name: 'La Vasija Azul SA de CV', ref: 'La Vasija', rfc: 'VAZ990101QX3' },
  { id: 11, name: 'Distribuidora El Comal', ref: 'El Comal', rfc: 'DCO150612AB1' },
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
  assert.strictEqual(r[1].cotizacionId, 3);
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

// === chipsCompletitud: estado de chips desde datos reales (AC6) ===

test('C1: cliente Operam completo -> los tres chips en verde', () => {
  const c = { name: 'La Vasija', telefono: '+52 55 1234 5678', cp: '06600', pais: 'MX', rfc: 'VAZ990101QX3' };
  assert.deepStrictEqual(chipsCompletitud(c), { contacto: true, entrega: true, fiscal: true });
});

test('C2: contacto nuevo -> solo Contacto; Entrega y Fiscal pendientes', () => {
  const c = buildClienteDesdeContactoNuevo({ nombre: 'Juan', telefono: '+52 55 1234 5678', ciudad: 'CDMX' });
  const chips = chipsCompletitud(c);
  assert.strictEqual(chips.contacto, true);
  assert.strictEqual(chips.entrega, false, 'ciudad no es domicilio de entrega (CP+pais)');
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
