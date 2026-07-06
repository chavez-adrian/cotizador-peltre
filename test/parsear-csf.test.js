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
  });

  it('B9: regimenFiscal por texto en persona fisica (RESICO)', () => {
    const t = 'Regímenes: Régimen Régimen Simplificado de Confianza 01/01/2022';
    assert.equal(parsearCSF(t).regimenFiscal, '626');
  });

  it('B10: formato viejo con codigo numerico sigue teniendo prioridad', () => {
    assert.equal(parsearCSF(CSF_PERSONA_FISICA).regimenFiscal, '612');
  });
});
