'use strict';

function buildPreFillMap(datos) {
  return {
    'cl-razon-social': datos.razonSocial,
    'cl-rfc': datos.rfc,
    'cl-cp-fiscal': datos.cp,
    'cl-calle': datos.calle,
    'cl-num-int': datos.numInt,
    'cl-colonia': datos.colonia,
    'cl-cp-entrega': datos.cp,
    'cl-municipio': datos.municipio,
    'cl-estado': datos.estado,
  };
}

function applyPreFillMap(mapa, getEl) {
  for (const [id, val] of Object.entries(mapa)) {
    const el = getEl(id);
    if (el) el.value = val;
  }
}

function buildEntregaPayload(getVal) {
  return {
    br_name: getVal('cl-nombre-entrega'),
    addr_street: getVal('cl-calle'),
    addr_interior: getVal('cl-num-int'),
    addr_colony: getVal('cl-colonia'),
    addr_zip: getVal('cl-cp-entrega'),
    addr_city: getVal('cl-municipio'),
    addr_state: getVal('cl-estado'),
    phone: getVal('cl-cel-entrega'),
    email: getVal('cl-email-entrega'),
  };
}

function buildCsfPayload(datos, getVal, userId) {
  return {
    CustName: datos.razonSocial,
    cust_ref: datos.nombreCorto,
    tax_id: datos.rfc,
    idcif: datos.idcif,
    street: datos.calle,
    street_number: datos.numExt,
    suite_number: datos.numInt,
    district: datos.colonia,
    postal_code: datos.cp,
    city: datos.municipio,
    state: datos.estado,
    country: 'Mexico',
    cfdi_regimen_fiscal: datos.regimenFiscal,
    salesman: String(userId),
    segmento_id: '1',
    timbrado_uso_cfdi: 'S01',
    actividades: [],
    csf_fecha: '',
    phone: '',
    email: '',
    fuente: 'cotizador',
    entrega: buildEntregaPayload(getVal),
  };
}

module.exports = { buildPreFillMap, applyPreFillMap, buildEntregaPayload, buildCsfPayload };
