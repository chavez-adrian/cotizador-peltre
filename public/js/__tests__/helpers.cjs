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

const ALTA_LOCKED_SECCIONES = [3, 4];

function altaToggleSeccionState(estado, n) {
  if (ALTA_LOCKED_SECCIONES.includes(n)) return { ...estado };
  const nuevo = estado.seccionAbierta === n ? null : n;
  return { ...estado, seccionAbierta: nuevo };
}

function buildCargarCatalogosRequest(authHeader) {
  return {
    url: '/api/catalogos',
    headers: { 'Authorization': authHeader },
  };
}

function buildAltaComercialPayload(getVal) {
  return {
    sales_type: getVal('alta-lista-precios'),
    segmento_id: getVal('alta-segmento'),
    salesman: getVal('alta-vendedor'),
    invoice_email: getVal('alta-email-factura'),
    celular_nota: getVal('alta-celular'),
  };
}

// Interpreta la respuesta de POST /api/parsear-csf ({ ok, datos } o { ok:false, error })
function buildCsfDatosDesdeRespuesta(json) {
  if (json && json.ok && json.datos) return { datos: json.datos };
  if (json && json.error) return { error: json.error };
  return { error: 'Respuesta invalida del servidor al parsear la CSF' };
}

function altaCheckpointState(estado, n, done) {
  return { ...estado, checkpoints: { ...estado.checkpoints, [n]: done } };
}

// Completar la seccion n desbloquea seccion n+1 si estaba en locked
function altaDesbloqueaSeccion(locked, seccionCompletada) {
  const siguiente = seccionCompletada + 1;
  return locked.filter(s => s !== siguiente);
}

function validarCsfCampos(getVal) {
  if (!getVal('csf-rfc')) return 'El RFC es obligatorio';
  if (!getVal('csf-razon-social')) return 'La razon social es obligatoria';
  if (!getVal('csf-nombre-corto')) return 'El nombre corto es obligatorio';
  return null;
}

function buildCsfConfirmarPayload(getVal) {
  return {
    rfc: getVal('csf-rfc'),
    razonSocial: getVal('csf-razon-social'),
    nombreCorto: getVal('csf-nombre-corto'),
    idcif: getVal('csf-idcif'),
    regimenFiscal: getVal('csf-regimen-fiscal'),
    usoCfdi: getVal('csf-uso-cfdi'),
    calle: getVal('csf-calle'),
    numExt: getVal('csf-num-ext'),
    numInt: getVal('csf-num-int'),
    colonia: getVal('csf-colonia'),
    cp: getVal('csf-cp'),
    municipio: getVal('csf-municipio'),
    estado: getVal('csf-estado'),
  };
}

function buildCsfDropzoneState(estado, accion) {
  switch (accion.type) {
    case 'LOADING':
      return { ...estado, status: 'loading', spinnerText: 'Extrayendo RFC, razon social, domicilio fiscal, regimen, SAT IdCIF...' };
    case 'SUCCESS':
      return { ...estado, status: 'success', rfc: accion.rfc, fileName: accion.fileName };
    case 'ERROR':
      return { ...estado, status: 'error', mensaje: accion.mensaje };
    case 'RESET':
      return { status: 'idle', rfc: null, fileName: null, mensaje: null };
    default:
      return { ...estado };
  }
}

const CSF_CAMPOS_REQUERIDOS = ['rfc', 'razonSocial', 'nombreCorto'];

function buildCsfDatosExtraidos(datos) {
  for (const campo of CSF_CAMPOS_REQUERIDOS) {
    if (!datos[campo]) {
      return { error: `Campo requerido faltante: ${campo}` };
    }
  }
  return {
    rfc: datos.rfc,
    razonSocial: datos.razonSocial,
    nombreCorto: datos.nombreCorto,
    idcif: datos.idcif || '',
    cp: datos.cp || '',
    municipio: datos.municipio || '',
    estado: datos.estado || '',
    regimenFiscal: datos.regimenFiscal || '',
    usoCfdi: datos.usoCfdi || 'S01',
  };
}

function buildAltaDomicilioPayload(getVal) {
  return {
    br_name: getVal('alta-br-name'),
    br_ref: getVal('alta-br-ref'),
    addr_street: getVal('alta-addr-street'),
    addr_exterior: getVal('alta-addr-exterior'),
    addr_interior: getVal('alta-addr-interior'),
    addr_colony: getVal('alta-addr-colony'),
    addr_zip: getVal('alta-addr-zip'),
    addr_city: getVal('alta-addr-city'),
    addr_state: getVal('alta-addr-state'),
    pais: getVal('alta-pais'),
    phone: getVal('alta-addr-phone'),
    addr_reference: getVal('alta-addr-reference'),
    email: getVal('alta-addr-email'),
  };
}

function validarAltaDomicilio(getVal) {
  if (!getVal('alta-br-name')) return 'El nombre del domicilio (br_name) es obligatorio';
  if (!getVal('alta-br-ref')) return 'La referencia corta (br_ref) es obligatoria';
  if (!getVal('alta-addr-street')) return 'La calle es obligatoria';
  if (!getVal('alta-addr-zip')) return 'El codigo postal es obligatorio';
  if (!getVal('alta-addr-city')) return 'La ciudad es obligatoria';
  if (!getVal('alta-addr-state')) return 'El estado es obligatorio';
  return null;
}

// RFC regex: 3-4 letras/& seguido de 6 digitos seguido de 3 chars alfanumericos
// 12 chars = persona moral, 13 chars = persona fisica
const RFC_MX_REGEX = /^[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}$/i;
const RFC_GENERICOS_MX = new Set(['XAXX010101000', 'XEXX010101000']);

function validarRfcManual(rfc, pais) {
  if (pais && pais !== 'MX') return null;
  if (!rfc) return 'El RFC es obligatorio';
  if (RFC_GENERICOS_MX.has(rfc.toUpperCase())) return null;
  if (!RFC_MX_REGEX.test(rfc)) return 'El RFC no tiene formato valido (12 o 13 caracteres alfanumericos)';
  return null;
}

const MANUAL_CAMPOS_REQUERIDOS = ['rfc', 'razonSocial', 'nombreCorto'];

function buildManualDatosExtraidos(campos) {
  for (const campo of MANUAL_CAMPOS_REQUERIDOS) {
    if (!campos[campo]) {
      return { error: `Campo requerido faltante: ${campo}` };
    }
  }
  return {
    rfc: campos.rfc,
    razonSocial: campos.razonSocial,
    nombreCorto: campos.nombreCorto,
    idcif: campos.idcif || '',
    cp: campos.cp || '',
    municipio: campos.municipio || '',
    estado: campos.estado || '',
    regimenFiscal: campos.regimenFiscal || '',
    usoCfdi: campos.usoCfdi || 'S01',
    pais: campos.pais || 'MX',
  };
}

function buildManualConfirmarPayload(getVal) {
  return {
    rfc: getVal('manual-rfc'),
    razonSocial: getVal('manual-razon-social'),
    nombreCorto: getVal('manual-nombre-corto'),
    idcif: getVal('manual-idcif'),
    regimenFiscal: getVal('manual-regimen-fiscal'),
    usoCfdi: getVal('manual-uso-cfdi'),
    cp: getVal('manual-cp'),
    municipio: getVal('manual-municipio'),
    estado: getVal('manual-estado'),
    pais: getVal('manual-pais'),
  };
}

function buildAltaDarDeAltaPayload(csfDatos, comercial, domicilio, customerId, branchId) {
  return {
    tax_id: csfDatos.rfc || '',
    CustName: csfDatos.razonSocial || '',
    cust_ref: csfDatos.nombreCorto || '',
    idcif: csfDatos.idcif || '',
    street: csfDatos.calle || '',
    street_number: csfDatos.numExt || '',
    suite_number: csfDatos.numInt || '',
    district: csfDatos.colonia || '',
    postal_code: csfDatos.cp || '',
    city: csfDatos.municipio || '',
    state: csfDatos.estado || '',
    cfdi_regimen_fiscal: csfDatos.regimenFiscal || '',
    timbrado_uso_cfdi: comercial.uso_cfdi || 'S01',
    sales_type: comercial.sales_type || '',
    segmento_id: comercial.segmento_id || '',
    salesman: comercial.salesman || '',
    pais: domicilio.pais || 'MX',
    entrega: { ...domicilio },
    customer_id: customerId || null,
    branch_id: branchId || null,
    fuente: 'cotizador',
  };
}

function resolveClienteId(state) {
  if (state && state.clienteExistente && state.clienteExistente.id != null) {
    return state.clienteExistente.id;
  }
  return (state && state.customer_id != null) ? state.customer_id : null;
}

function buildDedupRequest(rfc, nombre, authHeader) {
  const params = new URLSearchParams({ rfc, nombre: nombre || '' });
  return {
    url: '/api/buscar-cliente-duplicado?' + params.toString(),
    headers: { 'Authorization': authHeader },
  };
}

function buildDedupDomiciliosRequest(clienteId, authHeader) {
  return {
    url: '/api/operam/clientes/' + clienteId + '/domicilios',
    headers: { 'Authorization': authHeader },
  };
}

function buildDedupExactoHtml(cliente) {
  const nombre = cliente.CustName || cliente.name || '';
  const id = cliente.id || cliente.customer_id || '';
  const rfc = cliente.RFC || cliente.rfc || cliente.tax_id || '';
  return '<div class="dedup-exacto">' +
    '<p class="dedup-alerta-roja">Este RFC ya existe en Operam</p>' +
    '<p><strong>' + nombre + '</strong> (ID: ' + id + ', RFC: ' + rfc + ')</p>' +
    '<button type="button" onclick="altaDedupUsarCliente(' + id + ')">Usar este cliente</button>' +
    '</div>';
}

function buildDedupDomiciliosHtml(domicilios, clienteId) {
  const items = domicilios.map((d, i) =>
    '<label>' +
    '<input type="radio" name="dedup-domicilio" value="' + i + '" onclick="altaDedupSelDomicilio(' + clienteId + ',' + i + ')">' +
    ' ' + (d.descripcion || d.br_name || 'Domicilio ' + (i + 1)) +
    ' — ' + (d.calle || '') + ', ' + (d.municipio || '') +
    '</label><br>'
  ).join('');
  const crearOpcion =
    '<label>' +
    '<input type="radio" name="dedup-domicilio" value="nuevo" onclick="altaDedupNuevoDomicilio(' + clienteId + ')">' +
    ' Crear nuevo domicilio' +
    '</label>';
  return '<div class="dedup-domicilios">' + items + crearOpcion + '</div>';
}

function buildDedupCandidatosHtml(candidatos) {
  const items = candidatos.map((c, i) =>
    '<label>' +
    '<input type="radio" name="dedup-candidato" value="' + c.id + '" onclick="altaDedupSelCandidato(' + c.id + ')">' +
    ' ' + (c.CustName || c.name || '') + ' (' + (c.cust_ref || '') + ')' +
    '</label><br>'
  ).join('');
  const escalarOpcion =
    '<label>' +
    '<input type="radio" name="dedup-candidato" value="escalar">' +
    ' Ninguno es el mismo cliente - escalar a Adrian' +
    '</label>';
  return '<div class="dedup-candidatos">' +
    '<p class="dedup-alerta-naranja">Posibles clientes existentes</p>' +
    items + escalarOpcion +
    '</div>';
}

module.exports = { buildPreFillMap, applyPreFillMap, buildEntregaPayload, buildCsfPayload, buildPaisConfig, buildOperamPreFillMap, buildCsfDuplicadoBanner, buildClienteSnapshot, findRfcMatch, calcularDiff, buildConfirmacionItems, shouldTriggerRfcSearch, buildAltaSelectoresOpts, altaToggleSeccionState, buildCargarCatalogosRequest, buildAltaComercialPayload, buildCsfDropzoneState, buildCsfDatosExtraidos, validarCsfCampos, buildCsfConfirmarPayload, altaCheckpointState, altaDesbloqueaSeccion, buildCsfDatosDesdeRespuesta, buildAltaDomicilioPayload, validarAltaDomicilio, buildAltaDarDeAltaPayload, validarRfcManual, buildManualDatosExtraidos, buildManualConfirmarPayload, buildDedupRequest, buildDedupDomiciliosRequest, buildDedupExactoHtml, buildDedupDomiciliosHtml, buildDedupCandidatosHtml, resolveClienteId };
