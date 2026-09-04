'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

// EL titulador del repo (issue #293): un solo "MAYUSCULAS -> Titulo" para la
// razon social (#241), el contacto de Google (#247), la captura de prospecto
// (#235/#269) y el importador del export de expo. Los tres primeros bloques de
// casos son los que ya probaban esas funciones antes de unificarlas; el ultimo
// es la tabla del brief de #293.

let aTitulo;
before(async () => {
  ({ aTitulo } = await import('../titulo-logica.js'));
});

// === Tabla del brief de #293 ===

test('T1: la sigla societaria sobrevive con y sin puntos', () => {
  assert.equal(aTitulo('ACESA INTERABASTO S.A DE C.V'), 'Acesa Interabasto S.A de C.V');
  assert.equal(aTitulo('EL PENDULO S.A. DE C.V.'), 'El Pendulo S.A. de C.V.');
});

test('T2: un token con simbolo tecnico se respeta', () => {
  assert.equal(aTitulo('GRUPO N&M'), 'Grupo N&M');
});

test('T3: el articulo pegado al nombre de la marca va alto', () => {
  assert.equal(aTitulo('TACOS LA GÜERA'), 'Tacos La Güera');
});

test('T4: la lista fija de siglas se conserva siempre', () => {
  assert.equal(aTitulo('CDMX FOODS'), 'CDMX Foods');
});

test('T5: lo que ya viene escrito con mayusculas y minusculas no se toca', () => {
  assert.equal(aTitulo("McDonald's"), "McDonald's");
  assert.equal(aTitulo('Hotel La Joya'), 'Hotel La Joya');
});

test('T6: siglasCortas respeta una sigla comercial corta que la lista no conoce', () => {
  assert.equal(aTitulo('MAG IMPRESIONES', { siglasCortas: true }), 'MAG Impresiones');
  // sin la opcion se titula como palabra: es el default de la razon social (#241)
  assert.equal(aTitulo('MAG IMPRESIONES'), 'Mag Impresiones');
});

// === Casos que ya cubria normalizarNombreFiscal (#241, razon social) ===

test('T7: preposiciones, articulos y siglas corporativas de la razon social', () => {
  assert.equal(aTitulo('COMERCIALIZADORA EL PENDULO'), 'Comercializadora El Pendulo');
  assert.equal(aTitulo('HOTELES DE LA COSTA Y EL VALLE'), 'Hoteles de la Costa y el Valle');
  assert.equal(aTitulo('EL PENDULO SA DE CV'), 'El Pendulo SA de CV');
  assert.equal(aTitulo('GRUPO BAJIO S.A. DE C.V.'), 'Grupo Bajio S.A. de C.V.');
  assert.equal(aTitulo('SERVICIOS SAPI DE CV'), 'Servicios SAPI de CV');
});

test('T8: numeros romanos, falsos romanos y tokens tecnicos', () => {
  assert.equal(aTitulo('RESTAURANTE EL FOGON III'), 'Restaurante El Fogon III');
  assert.equal(aTitulo('JUAN PABLO II'), 'Juan Pablo II');
  assert.equal(aTitulo('CARLOS XIV'), 'Carlos XIV');
  assert.equal(aTitulo('MI TIENDA DEL AHORRO'), 'Mi Tienda del Ahorro');
  assert.equal(aTitulo('CASA MIL SABORES'), 'Casa Mil Sabores');
  assert.equal(aTitulo('GRUPO MIX SA DE CV'), 'Grupo Mix SA de CV');
  assert.equal(aTitulo('COMERCIAL 3M DE MEXICO'), 'Comercial 3M de Mexico');
  assert.equal(aTitulo('COCA-COLA FEMSA'), 'Coca-Cola Femsa');
  assert.equal(aTitulo('I+D MEXICO'), 'I+D Mexico');
});

test('T9: una razon social ya normalizada sobrevive sin estropearse', () => {
  assert.equal(aTitulo('El Pendulo SA de CV'), 'El Pendulo SA de CV');
});

// === Casos que ya cubria normalizarPersonaVisible (#247, persona del contacto) ===

test('T10: la persona en mayusculas se titula; la iniciales con punto se conservan', () => {
  assert.equal(aTitulo('BRENDA GARCIA'), 'Brenda Garcia');
  assert.equal(aTitulo('J. LOPEZ'), 'J. Lopez');
  assert.equal(aTitulo('MA. ELENA RUIZ'), 'Ma. Elena Ruiz');
  assert.equal(aTitulo('BGE Esquivel'), 'BGE Esquivel');
});

// === Casos que ya cubria capitalizarCampo (#235/#269, captura de prospecto) ===

test('T11: la tabla del ticket #235', () => {
  assert.equal(aTitulo('JUAN PEREZ'), 'Juan Perez');
  assert.equal(aTitulo('juan perez'), 'Juan Perez');
  assert.equal(aTitulo('jUaN pErEz'), 'Juan Perez');
  assert.equal(aTitulo('MARIA DE LOS ANGELES RUIZ'), 'Maria de los Angeles Ruiz');
  assert.equal(aTitulo('Grupo GNP'), 'Grupo GNP');
  assert.equal(aTitulo('GRUPO GNP'), 'Grupo Gnp');
  assert.equal(aTitulo('HOTEL AZUL SA DE CV'), 'Hotel Azul SA de CV');
  assert.equal(aTitulo('LA PARRILLA'), 'La Parrilla');
});

test('T12: la lista fija de siglas incluye a las paqueterias y a CDMX', () => {
  assert.equal(aTitulo('envios rl'), 'Envios RL');
  assert.equal(aTitulo('MUDANZAS SC'), 'Mudanzas SC');
  assert.equal(aTitulo('oficina cdmx'), 'Oficina CDMX');
  assert.equal(aTitulo('paqueteria fedex dhl ups'), 'Paqueteria FEDEX DHL UPS');
});

test('T13: una sigla corta escrita a proposito solo se respeta cuando hay contraste', () => {
  assert.equal(aTitulo('Refacciones ABCD'), 'Refacciones ABCD');
  assert.equal(aTitulo('REFACCIONES ABCD'), 'Refacciones Abcd');
});

test('T14: los acentos quedan intactos', () => {
  assert.equal(aTitulo('MARÍA JOSÉ NÚÑEZ'), 'María José Núñez');
  assert.equal(aTitulo('ángel gonzález'), 'Ángel González');
});

test('T15: colapsa espacios de sobra y tolera vacio, nulo y ausente', () => {
  assert.equal(aTitulo('  JUAN    PEREZ  '), 'Juan Perez');
  assert.equal(aTitulo(''), '');
  assert.equal(aTitulo('   '), '');
  assert.equal(aTitulo(undefined), '');
  assert.equal(aTitulo(null), '');
});

// La guarda es de INTENCION, no de "entero en mayusculas": un campo a medio
// escribir no trae senal y se corrige. #247 (que solo miraba si la cadena entera
// estaba en mayusculas) dejaba "MARIA lopez" intacto en la ficha de Google.
test('T16: un campo parcialmente mixto no trae senal de intencion y se corrige', () => {
  assert.equal(aTitulo('MARIA lopez'), 'Maria Lopez');
  assert.equal(aTitulo('juan PEREZ'), 'Juan Perez');
});

test('T17: un campo sin letras no se altera', () => {
  assert.equal(aTitulo('5512345678'), '5512345678');
});

// Medidos en el dry-run del parche de #293 contra produccion: la coma pegada
// convertia la palabra en "simbolo raro" y salia gritada.
test('T18: la puntuacion pegada a la palabra no la vuelve sigla', () => {
  assert.equal(aTitulo('Villas flamingos, Holbox'), 'Villas Flamingos, Holbox');
  assert.equal(aTitulo('VILLAS FLAMINGOS, HOLBOX'), 'Villas Flamingos, Holbox');
  assert.equal(aTitulo('HOTEL PLAYA, S.A. DE C.V.'), 'Hotel Playa, S.A. de C.V.');
  assert.equal(aTitulo('tacos (los buenos)'), 'Tacos (Los Buenos)');
});

test('T19: una sigla corta en mayusculas dentro de un campo mixto se respeta por contraste', () => {
  assert.equal(aTitulo('MHW Mexico Central de Compras'), 'MHW Mexico Central de Compras');
  assert.equal(aTitulo('MHW MEXICO CENTRAL DE COMPRAS'), 'Mhw Mexico Central de Compras');
  assert.equal(aTitulo('hotel DE mexico'), 'Hotel de Mexico');
});
