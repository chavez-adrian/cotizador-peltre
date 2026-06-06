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
    invoice_email: getVal('cl-email-factura'),
    fuente: 'cotizador',
    entrega: buildEntregaPayload(getVal),
  };
}

const AREA_POR_PAIS_CJ = { MX: '1', US: '5', CA: '7' };

function buildPaisConfig(pais) {
  if (!pais || pais === 'MX') {
    return { country: 'MX', curr_code: 'MXN', area_pais: '1' };
  }
  return { country: pais, curr_code: 'USD', area_pais: AREA_POR_PAIS_CJ[pais] || '6' };
}

function buildOperamPreFillMap(cliente) {
  return {
    'cl-razon-social':   cliente.name,
    'cl-nombre-corto':   cliente.ref,
    'cl-rfc':            cliente.rfc,
    'cl-cp-fiscal':      cliente.cp,
    'cl-telefono':       cliente.telefono,
    'cl-nombre-entrega': cliente.nombreEntrega,
    'cl-calle':          cliente.calle,
    'cl-num-int':        cliente.numInt,
    'cl-colonia':        cliente.colonia,
    'cl-cp-entrega':     cliente.cp,
    'cl-municipio':      cliente.municipio,
    'cl-estado':         cliente.estado,
    'cl-cel-entrega':    cliente.telefono,
    'cl-email-entrega':  cliente.email,
  };
}

function buildCsfDuplicadoBanner(cliente) {
  return 'Este cliente ya esta registrado en Operam (ID ' + cliente.id + ' -- ' + cliente.name + '). Sus datos han sido cargados en el formulario.';
}

function buildClienteSnapshot(fieldIds, getVal) {
  const snap = {};
  for (const id of fieldIds) {
    snap[id] = getVal(id);
  }
  return snap;
}

function findRfcMatch(clientes, rfc) {
  if (!rfc) return null;
  const rfcNorm = rfc.toLowerCase();
  return clientes.find(c => (c.rfc || '').toLowerCase() === rfcNorm) || null;
}

function shouldTriggerRfcSearch(rfc) {
  if (!rfc) return false;
  return rfc.trim().length >= 12;
}

function calcularDiff(snapshot, formValues) {
  const diff = {};
  for (const id of Object.keys(snapshot)) {
    if (!(id in formValues)) continue;
    const anterior = String(snapshot[id] == null ? '' : snapshot[id]).trim();
    const nuevo = String(formValues[id] == null ? '' : formValues[id]).trim();
    if (anterior !== nuevo) {
      diff[id] = { anterior, nuevo };
    }
  }
  return diff;
}

const FIELD_LABELS = {
  'cl-razon-social':   'Razon Social',
  'cl-nombre-corto':   'Nombre Corto',
  'cl-rfc':            'RFC',
  'cl-cp-fiscal':      'CP Fiscal',
  'cl-telefono':       'Telefono',
  'cl-nombre-entrega': 'Nombre de Entrega',
  'cl-calle':          'Calle',
  'cl-num-int':        'Num Interior',
  'cl-colonia':        'Colonia',
  'cl-cp-entrega':     'CP Entrega',
  'cl-municipio':      'Municipio',
  'cl-estado':         'Estado',
  'cl-cel-entrega':    'Celular Entrega',
  'cl-email-entrega':  'Email Entrega',
};

function buildConfirmacionItems(diff) {
  return Object.entries(diff).map(([fieldId, { anterior, nuevo }]) => ({
    fieldId,
    label: FIELD_LABELS[fieldId] || fieldId,
    anterior,
    nuevo,
  }));
}

function buildAltaSelectoresOpts(catalogos) {
  const listas = (catalogos.listas_precios || []).map(l => ({ value: l.id, label: `${l.id} -- ${l.nombre}` }));
  const segmentos = (catalogos.segmentos || []).map(s => ({ value: String(s.id), label: s.nombre }));
  const vendedores = (catalogos.vendedores || []).map(v => ({ value: String(v.operam_id), label: v.name }));
  return { listas, segmentos, vendedores };
}

module.exports = { buildPreFillMap, applyPreFillMap, buildEntregaPayload, buildCsfPayload, buildPaisConfig, buildOperamPreFillMap, buildCsfDuplicadoBanner, buildClienteSnapshot, findRfcMatch, calcularDiff, buildConfirmacionItems, shouldTriggerRfcSearch, buildAltaSelectoresOpts };
