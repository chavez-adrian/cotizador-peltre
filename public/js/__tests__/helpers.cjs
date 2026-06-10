'use strict';

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

// Helper privado de buildAltaDomicilioPayload (NO exportado: el contrato publico/testeado
// de combinarTelefonoConCodigo ahora vive en alta-logica.js, ver alta-domicilio.test.cjs).
function combinarTelefonoLocal(code, phone) {
  const tel = (phone || '').trim();
  if (!tel) return '';
  if (tel.startsWith('+')) return tel;
  const prefijo = (code || '').replace(/-CA$/, '');
  if (!prefijo || prefijo === '+') return tel;
  return `${prefijo} ${tel}`;
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
    phone: combinarTelefonoLocal(getVal('alta-addr-phone-code'), getVal('alta-addr-phone')),
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
  if (!getVal('alta-addr-phone')) return 'El telefono es obligatorio (con codigo de pais)';
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

function resolveClienteId(state) {
  if (state && state.clienteExistente && state.clienteExistente.id != null) {
    return state.clienteExistente.id;
  }
  return (state && state.customer_id != null) ? state.customer_id : null;
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

module.exports = { buildAltaSelectoresOpts, altaToggleSeccionState, buildAltaComercialPayload, buildCsfDropzoneState, buildCsfDatosExtraidos, validarCsfCampos, buildCsfConfirmarPayload, altaCheckpointState, altaDesbloqueaSeccion, buildCsfDatosDesdeRespuesta, buildAltaDomicilioPayload, validarAltaDomicilio, validarRfcManual, buildManualDatosExtraidos, buildManualConfirmarPayload, buildDedupExactoHtml, buildDedupDomiciliosHtml, buildDedupCandidatosHtml, resolveClienteId };
