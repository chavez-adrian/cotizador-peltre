import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parsearCSF } from '../lib/parsear-csf.js';

const CSF_PERSONA_MORAL = `
CONSTANCIA DE SITUACION FISCAL
Denominación/Razón Social : BANCO DE MEXICO FIDEICOMISO PARA LOS MUSEOS DIEGO RIVERA Y FRIDA KAHLO
R.F.C. : BMF821130AR3
idCIF : 12345678901
Nombre de la Vialidad : AV 5 DE MAYO
Número Exterior : 2
Número Interior :
Nombre de la Colonia : CENTRO DE LA CIUDAD DE MEXICO AREA 1
Código Postal : 06000
Nombre del Municipio o Demarcación Territorial : CUAUHTEMOC
Nombre de la Entidad Federativa : CIUDAD DE MEXICO
Régimen Fiscal : 601 General de Ley Personas Morales
Actividades Económicas: Orden Actividad Económica Porcentaje Fecha Inicio Fecha Fin 1 Fideicomisos no clasificados en otra parte 100 30/11/1982
Fecha de emisión de este documento : A 8 DE MAYO DE 2026
`;

const CSF_RFC_SIN_SUFIJO_EXTRA = `
CONSTANCIA DE SITUACION FISCAL
Denominación/Razón Social : SAGO MEDICAL SERVICE
RFC: SMS200716NZ4 Denominación/Razón Social : SAGO MEDICAL SERVICE
idCIF : 20090146505
Nombre de la Vialidad : NAYARIT
Número Exterior : 56
Nombre de la Colonia : ROMA SUR
Código Postal : 06760
Nombre del Municipio o Demarcación Territorial : CUAUHTEMOC
Nombre de la Entidad Federativa : CIUDAD DE MEXICO
Régimen Fiscal : 601 General de Ley Personas Morales
`;

// Texto real extraido por pdf.js (une los items con espacios): toda la CSF
// queda en UNA sola linea y ademas el SAT pone dos campos por renglon
// ("Codigo Postal:23405 Tipo de Vialidad: ..."). Sin saltos de linea que
// delimiten el fin de cada campo. Fuente: Csf_ISI1801183Z4 (IMPORTACIONES SISCANI).
const CSF_UNA_LINEA = `Pagina [1] de [2] CEDULA DE IDENTIFICACION FISCAL ISI1801183Z4 Registro Federal de Contribuyentes IMPORTACIONES SISCANI Nombre, denominacion o razon social idCIF: 18020373831 CONSTANCIA DE SITUACION FISCAL Datos de Identificacion del Contribuyente: RFC: ISI1801183Z4 Denominación/Razón Social: IMPORTACIONES SISCANI Régimen Capital: SOCIEDAD ANONIMA DE CAPITAL VARIABLE Nombre Comercial: IMPORTACIONES SISCANI Fecha inicio de operaciones: 18 DE ENERO DE 2018 Estatus en el padrón: ACTIVO Fecha de último cambio de estado: 18 DE ENERO DE 2018 Datos del domicilio registrado Código Postal:23405 Tipo de Vialidad: CARRETERA (CARR.) Nombre de Vialidad: TRANSPENINSULAR Número Exterior: MODULO L 12 Número Interior:LOCAL 11 Y 12 Nombre de la Colonia: CABO COLORADO Nombre de la Localidad: SAN JOSE DEL CABO Nombre del Municipio o Demarcación Territorial: LOS CABOS Nombre de la Entidad Federativa: BAJA CALIFORNIA SUR Entre Calle: CALLE LOMA ENCANTADA Y Calle: REFERENCIA FRESKO PALMILLA Actividades Económicas: Orden Actividad Económica Porcentaje Fecha Inicio Fecha Fin 1 Otros intermediarios del comercio al por menor 100 18/01/2018 Regímenes: Régimen Fecha Inicio Fecha Fin Régimen General de Ley Personas Morales 18/01/2018 Obligaciones: `;

// issue #349: la CSF deja campos del domicilio presentes pero VACIOS. El
// separador ":\s*" cruzaba el salto de linea y el campo vacio se llevaba la
// etiqueta siguiente con su valor (asi llego "Nombre de la Co" a Operam).
const CSF_DOMICILIO_VACIO = `
CONSTANCIA DE SITUACION FISCAL
Denominación/Razón Social : COMERCIALIZADORA EJEMPLO
R.F.C. : CEJ140604560
Nombre de la Vialidad :
Número Exterior :
Número Interior :
Nombre de la Colonia :
Código Postal : 06000
Nombre del Municipio o Demarcación Territorial :
Nombre de la Entidad Federativa :
Régimen Fiscal : 601 General de Ley Personas Morales
`;

const CSF_PERSONA_FISICA = `
CONSTANCIA DE SITUACION FISCAL
Nombre (s) : ADRIANA
Primer Apellido : URENA
Segundo Apellido : GARCIA
R.F.C. : UEGA850312KL5
idCIF : 98765432101
Nombre de la Vialidad : INSURGENTES SUR
Número Exterior : 123
Nombre de la Colonia : DEL VALLE
Código Postal : 03100
Nombre del Municipio o Demarcación Territorial : BENITO JUAREZ
Nombre de la Entidad Federativa : CIUDAD DE MEXICO
Régimen Fiscal : 612 Personas Físicas con Actividades Empresariales
Actividades Económicas: Orden Actividad Económica Porcentaje Fecha Inicio Fecha Fin 1 Servicios de consultoria en computacion 60 01/01/2020 2 Otros servicios profesionales cientificos y tecnicos 40 01/01/2020
Fecha de emisión de este documento : A 15 DE JUNIO DE 2026
`;

describe('parsearCSF', () => {
  it('B1: RFC de persona moral', () => {
    assert.equal(parsearCSF(CSF_PERSONA_MORAL).rfc, 'BMF821130AR3');
  });

  it('B2: razonSocial de persona moral contiene BANCO DE MEXICO', () => {
    assert.ok(parsearCSF(CSF_PERSONA_MORAL).razonSocial.includes('BANCO DE MEXICO'));
  });

  it('B3: CP de persona moral', () => {
    assert.equal(parsearCSF(CSF_PERSONA_MORAL).cp, '06000');
  });

  it('B4: RFC de persona fisica', () => {
    assert.equal(parsearCSF(CSF_PERSONA_FISICA).rfc, 'UEGA850312KL5');
  });

  it('B5: razonSocial de persona fisica contiene nombre y apellido', () => {
    const result = parsearCSF(CSF_PERSONA_FISICA).razonSocial;
    assert.ok(result.includes('ADRIANA'), `Esperaba ADRIANA en: ${result}`);
    assert.ok(result.includes('URENA'), `Esperaba URENA en: ${result}`);
  });

  it('B6: regimenFiscal solo el codigo numerico', () => {
    assert.equal(parsearCSF(CSF_PERSONA_MORAL).regimenFiscal, '601');
  });

  it('B7: RFC no captura caracteres extra cuando el texto siguiente empieza con letra', () => {
    assert.equal(parsearCSF(CSF_RFC_SIN_SUFIJO_EXTRA).rfc, 'SMS200716NZ4');
  });

  describe('B8: CSF en una sola linea (pdf.js une items con espacios)', () => {
    const d = parsearCSF(CSF_UNA_LINEA);
    it('rfc', () => assert.equal(d.rfc, 'ISI1801183Z4'));
    it('razonSocial sin arrastrar el siguiente campo', () =>
      assert.equal(d.razonSocial, 'IMPORTACIONES SISCANI'));
    it('cp', () => assert.equal(d.cp, '23405'));
    it('calle sin arrastrar Numero Exterior', () =>
      assert.equal(d.calle, 'TRANSPENINSULAR'));
    it('numExt sin arrastrar Numero Interior', () =>
      assert.equal(d.numExt, 'MODULO L 12'));
    it('numInt sin arrastrar Nombre de la Colonia', () =>
      assert.equal(d.numInt, 'LOCAL 11 Y 12'));
    it('colonia sin arrastrar Nombre de la Localidad', () =>
      assert.equal(d.colonia, 'CABO COLORADO'));
    it('municipio sin arrastrar Nombre de la Entidad', () =>
      assert.equal(d.municipio, 'LOS CABOS'));
    it('estado sin arrastrar Entre Calle', () =>
      assert.equal(d.estado, 'BAJA CALIFORNIA SUR'));
    it('regimenFiscal mapeado desde el texto cuando la CSF no trae codigo', () =>
      assert.equal(d.regimenFiscal, '601'));
    it('regimenFiscalLabel legible del codigo mapeado', () =>
      assert.equal(d.regimenFiscalLabel, 'General de Ley Personas Morales'));
  });

  it('B9: regimenFiscal por texto en persona fisica (RESICO)', () => {
    const t = 'Regímenes: Régimen Régimen Simplificado de Confianza 01/01/2022';
    const d = parsearCSF(t);
    assert.equal(d.regimenFiscal, '626');
    assert.equal(d.regimenFiscalLabel, 'Regimen Simplificado de Confianza');
  });

  it('B10: formato viejo con codigo numerico sigue teniendo prioridad', () => {
    const d = parsearCSF(CSF_PERSONA_FISICA);
    assert.equal(d.regimenFiscal, '612');
    assert.equal(d.regimenFiscalLabel, 'Personas Fisicas con Actividades Empresariales y Profesionales');
  });

  it('B11: sin regimen, regimenFiscalLabel vacio', () => {
    assert.equal(parsearCSF('RFC: XAXX010101000').regimenFiscalLabel, '');
  });

  // issue #170: la CSF del SAT imprime la razon social en MAYUSCULAS sostenidas;
  // nombreCorto (primeras 3 palabras) sale en Title Case (misma regla de #159).
  it('B12: nombreCorto de persona moral en Title Case', () => {
    assert.equal(parsearCSF(CSF_PERSONA_MORAL).nombreCorto, 'Banco de Mexico');
  });

  it('B13: nombreCorto de persona fisica en Title Case', () => {
    assert.equal(parsearCSF(CSF_PERSONA_FISICA).nombreCorto, 'Adriana Urena Garcia');
  });

  it('B14: nombreCorto de la CSF en una sola linea en Title Case', () => {
    assert.equal(parsearCSF(CSF_UNA_LINEA).nombreCorto, 'Importaciones Siscani');
  });

  // issue #171: las actividades economicas de la CSF nunca llegaban a las notas
  // del cliente porque parsearCSF no las extraia.
  it('B15: actividades de persona moral con una sola actividad (sin porcentaje, es el 100%)', () => {
    assert.deepEqual(parsearCSF(CSF_PERSONA_MORAL).actividades, ['Fideicomisos no clasificados en otra parte']);
  });

  it('B16: csf_fecha de persona moral extraida de "Fecha de emision de este documento"', () => {
    assert.equal(parsearCSF(CSF_PERSONA_MORAL).csf_fecha, '8 DE MAYO DE 2026');
  });

  it('B17: actividades de persona fisica con varias actividades incluyen el porcentaje de cada una', () => {
    assert.deepEqual(parsearCSF(CSF_PERSONA_FISICA).actividades, [
      'Servicios de consultoria en computacion (60%)',
      'Otros servicios profesionales cientificos y tecnicos (40%)',
    ]);
  });

  it('B18: csf_fecha de persona fisica', () => {
    assert.equal(parsearCSF(CSF_PERSONA_FISICA).csf_fecha, '15 DE JUNIO DE 2026');
  });

  it('B19: actividades de la CSF en una sola linea (pdf.js une items con espacios)', () => {
    assert.deepEqual(parsearCSF(CSF_UNA_LINEA).actividades, ['Otros intermediarios del comercio al por menor']);
  });

  it('B20: sin "Fecha de emision", csf_fecha vacio (CSF_UNA_LINEA solo trae fecha inicio de operaciones)', () => {
    assert.equal(parsearCSF(CSF_UNA_LINEA).csf_fecha, '');
  });

  it('B21: sin seccion de Actividades Economicas, actividades es lista vacia', () => {
    assert.deepEqual(parsearCSF(CSF_RFC_SIN_SUFIJO_EXTRA).actividades, []);
  });

  // issue #349: campo presente y vacio produce cadena vacia, nunca la etiqueta
  // siguiente con su valor.
  it('B22: numero interior vacio en la CSF de persona moral no arrastra la colonia', () => {
    const d = parsearCSF(CSF_PERSONA_MORAL);
    assert.equal(d.numInt, '');
    assert.equal(d.colonia, 'CENTRO DE LA CIUDAD DE MEXICO AREA 1');
  });

  describe('B23: todos los campos del domicilio presentes y vacios', () => {
    const d = parsearCSF(CSF_DOMICILIO_VACIO);
    it('calle', () => assert.equal(d.calle, ''));
    it('numExt', () => assert.equal(d.numExt, ''));
    it('numInt', () => assert.equal(d.numInt, ''));
    it('colonia', () => assert.equal(d.colonia, ''));
    it('municipio', () => assert.equal(d.municipio, ''));
    it('estado', () => assert.equal(d.estado, ''));
    it('lo que si trae valor sigue saliendo', () => {
      assert.equal(d.rfc, 'CEJ140604560');
      assert.equal(d.cp, '06000');
      assert.equal(d.razonSocial, 'COMERCIALIZADORA EJEMPLO');
      assert.equal(d.regimenFiscal, '601');
    });
  });

  // El caso que produjo el dato malo en produccion (clientes 504 y 516) es una
  // CSF de UNA sola linea, no una multilinea: pdf.js une los items con espacios
  // y normalizarLineas es quien inserta el \n que el \s* goloso se comia.
  it('B24: CSF en una sola linea con Numero Interior vacio no arrastra la colonia', () => {
    const t = 'Código Postal:23405 Nombre de Vialidad: TRANSPENINSULAR Número Exterior: MODULO L 12 '
      + 'Número Interior: Nombre de la Colonia: GARITA DE JALISCO '
      + 'Nombre del Municipio o Demarcación Territorial: LOS CABOS';
    const d = parsearCSF(t);
    assert.equal(d.numInt, '');
    assert.equal(d.colonia, 'GARITA DE JALISCO');
    assert.equal(d.numExt, 'MODULO L 12');
    assert.equal(d.calle, 'TRANSPENINSULAR');
    assert.equal(d.municipio, 'LOS CABOS');
  });

  it('B25: razon social presente y vacia no arrastra el RFC', () => {
    const d = parsearCSF('Denominación/Razón Social :\nR.F.C. : CEJ140604560\n');
    assert.equal(d.razonSocial, '');
    assert.equal(d.rfc, 'CEJ140604560');
  });
});

// === Validador QR del SAT (issue #378) ===
//
// La pagina que abre el QR de la CSF (validadorqr.jsf) NO es la constancia: usa
// otras etiquetas ("CP", "Municipio o delegacion", "Entidad Federativa",
// "Colonia", "Apellido Paterno") y pone el VALOR EN LA LINEA SIGUIENTE a su
// etiqueta.
//
// La ESTRUCTURA de abajo se calco de lo que htmlATexto devolvio sobre el HTML
// real del SAT el 2026-09-12 (orden de campos, saltos y campos vacios incluidos);
// los DATOS son inventados, para no meter los de una persona en el repo. Por eso
// mismo esta fixture no puede detectar que el SAT cambie su pagina: eso lo
// verifica en vivo `node scripts/verificar-csf-qr.mjs <url del QR>`.
const VALIDADOR_QR = `Validador QR 
 El RFC: PEGJ850214HN2, tiene asociada la siguiente informacion.
 Datos de Identificacion
 CURP: 
 PEGJ850214HDFRRN09
 Nombre: 
 JUAN CARLOS
 Apellido Paterno: 
 PEREZ
 Apellido Materno: 
 GARCIA
 Fecha Nacimiento: 
 14-02-1985
 Fecha de Inicio de operaciones: 
 01-03-2010
 Situacion del contribuyente: 
 ACTIVO
 Fecha del ultimo cambio de situacion: 
 05-06-2012
 Datos de Ubicacion (domicilio fiscal, vigente)
 Entidad Federativa: 
 MEXICO
 Municipio o delegacion: 
 IXTAPALUCA
 Colonia: 
 SAN BUENAVENTURA
 Tipo de vialidad: 
 Nombre de la vialidad: 
 AVENIDA DE LOS PINOS
 Numero exterior: 
 45
 Numero interior: 
 CP: 
 56530
 AL: 
 MEXICO 2
 Caracteristicas fiscales (vigente)
 Regimen: 
 Regimen de Sueldos y Salarios e Ingresos Asimilados a Salarios
 Fecha de alta: 
 16-01-2006`;

describe('parsearCSF sobre el texto del validador QR (issue #378)', () => {
  const d = parsearCSF(`idCIF: 17030802592
${VALIDADOR_QR}`);

  it('RFC', () => assert.equal(d.rfc, 'PEGJ850214HN2'));
  it('idCIF (lo antepone el navegador desde la URL del QR)', () => assert.equal(d.idcif, '17030802592'));
  it('razon social compuesta de nombre y apellidos', () => assert.equal(d.razonSocial, 'JUAN CARLOS PEREZ GARCIA'));
  it('nombre corto propuesto', () => assert.equal(d.nombreCorto, 'Juan Carlos Perez'));
  it('CP', () => assert.equal(d.cp, '56530'));
  it('municipio ("Municipio o delegacion")', () => assert.equal(d.municipio, 'IXTAPALUCA'));
  it('estado ("Entidad Federativa" sin "Nombre de la")', () => assert.equal(d.estado, 'MEXICO'));
  it('colonia ("Colonia" sin "Nombre de la")', () => assert.equal(d.colonia, 'SAN BUENAVENTURA'));
  it('calle', () => assert.equal(d.calle, 'AVENIDA DE LOS PINOS'));
  it('numero exterior', () => assert.equal(d.numExt, '45'));
  it('numero interior vacio no se lleva el CP de abajo', () => assert.equal(d.numInt, ''));
  it('regimen por descripcion (el validador no imprime el codigo)', () => assert.equal(d.regimenFiscal, '605'));
});

// Las etiquetas cortas del validador ("CP", "AL") aparecen dentro de palabras
// comunes de un domicilio: sin exigir inicio de palabra, el "AL:" de
// "CALLE LOCAL: 5" partia el valor y la calle llegaba a Operam como "CALLE LOC".
describe('etiquetas cortas dentro de un valor (issue #378)', () => {
  it('el AL de LOCAL no parte la calle', () => {
    const d = parsearCSF('Nombre de la vialidad: \nCALLE LOCAL: 5\nCP: \n56530');
    assert.equal(d.calle, 'CALLE LOCAL: 5');
    assert.equal(d.cp, '56530');
  });

  it('un CP sin dos puntos dentro de una colonia no se lee como codigo postal', () => {
    const d = parsearCSF('Nombre de la Colonia: RINCONADA ACP12345\nCódigo Postal: 06000');
    assert.equal(d.cp, '06000');
  });

  it('el CP pegado a otra palabra no se confunde con la etiqueta', () => {
    const d = parsearCSF('Colonia: \nRINCONADA ACP: 3\nCP: \n06000');
    assert.equal(d.colonia, 'RINCONADA ACP: 3');
    assert.equal(d.cp, '06000');
  });
});
