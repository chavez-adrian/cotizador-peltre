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

module.exports = { buildPreFillMap, applyPreFillMap, buildEntregaPayload };
