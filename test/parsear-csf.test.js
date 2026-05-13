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
});
