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

const CSF_DATOS_VACIOS = {
  rfc: '', razonSocial: '', nombreCorto: '', idcif: '', regimenFiscal: '',
  calle: '', numExt: '', numInt: '', colonia: '', cp: '', municipio: '', estado: '',
};

// Decide que mostrar/poblar tras llamar a /api/parsear-csf (issue #34): a diferencia del
// parser viejo (que nunca fallaba), el endpoint puede responder ok:false. Para no dejar al
// usuario sin salida (csf-detalles oculto), siempre se devuelve status 'success' con un
// objeto datos completo (vacio si no hubo deteccion) para captura/edicion manual.
function altaCsfResultadoParseo(respuestaInterpretada, fileName) {
  if (respuestaInterpretada && respuestaInterpretada.datos) {
    const datos = { ...CSF_DATOS_VACIOS, ...respuestaInterpretada.datos };
    return {
      status: 'success',
      datos,
      bannerText: `${fileName} -- RFC: ${datos.rfc || '(no detectado)'}`,
    };
  }
  return {
    status: 'success',
    datos: { ...CSF_DATOS_VACIOS },
    bannerText: `${fileName} -- RFC no detectado, captura los datos manualmente`,
  };
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

// Combina el codigo de pais del select alta-addr-phone-code con el numero capturado
// (issue #25 / SOP paso 28). El select incluye "+1-CA" como etiqueta para distinguir
// Canada de EUA visualmente, pero el codigo de marcado real es "+1" -- se descarta el
// sufijo "-CA" antes de anteponerlo. Si el numero ya viene con "+" se respeta tal cual
// (el vendedor pudo capturarlo completo) para no duplicar el prefijo.
function combinarTelefonoConCodigo(code, phone) {
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
    phone: combinarTelefonoConCodigo(getVal('alta-addr-phone-code'), getVal('alta-addr-phone')),
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
    invoice_email: comercial.invoice_email || '',
    celular_nota: comercial.celular_nota || '',
    phone: domicilio.phone || '',
    email: domicilio.email || '',
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

// === Diff fiscal sobre cliente existente al subir CSF (issue #38) ===
//
// Mapea los datos de la CSF (formato altaState.datos: razonSocial/rfc/calle/numExt/...)
// contra los campos crudos del cliente en Operam (CustName/tax_id/street/...) y calcula
// un diff cuyas LLAVES son nombres de campo de OPERAM -- a proposito distinto del
// calcularDiff viejo (que usaba ids de DOM como cl-razon-social). actualizarCliente(id, diff)
// hace body[fieldId] = nuevo y lo manda directo al PUT /customers/:id de Operam: si la
// llave fuera un id de DOM, el PATCH mandaria campos que Operam no reconoce (silenciosamente
// ignorados). Usar nombres de campo Operam es lo correcto para que el PATCH actualice algo real.
const DIFF_FISCAL_CAMPOS = [
  { operam: 'CustName',            csf: 'razonSocial',   label: 'Razon Social' },
  { operam: 'tax_id',              csf: 'rfc',           label: 'RFC' },
  { operam: 'idcif',               csf: 'idcif',         label: 'IdCIF (SAT)' },
  { operam: 'street',              csf: 'calle',         label: 'Calle' },
  { operam: 'street_number',       csf: 'numExt',        label: 'Numero Exterior' },
  { operam: 'suite_number',        csf: 'numInt',        label: 'Numero Interior' },
  { operam: 'district',            csf: 'colonia',       label: 'Colonia' },
  { operam: 'postal_code',         csf: 'cp',            label: 'Codigo Postal' },
  { operam: 'city',                csf: 'municipio',     label: 'Municipio' },
  { operam: 'state',               csf: 'estado',        label: 'Estado' },
  { operam: 'cfdi_regimen_fiscal', csf: 'regimenFiscal', label: 'Regimen Fiscal' },
];

function calcularDiffFiscal(clienteOperam, csfDatos) {
  const diff = {};
  for (const { operam, csf, label } of DIFF_FISCAL_CAMPOS) {
    if (!(csf in csfDatos)) continue;
    const anterior = String(clienteOperam[operam] == null ? '' : clienteOperam[operam]).trim();
    const nuevo = String(csfDatos[csf] == null ? '' : csfDatos[csf]).trim();
    if (anterior !== nuevo) {
      diff[operam] = { anterior, nuevo, label };
    }
  }
  return diff;
}

const DIFF_FISCAL_LABELS = DIFF_FISCAL_CAMPOS.reduce((acc, { operam, label }) => {
  acc[operam] = label;
  return acc;
}, {});

function buildDiffFiscalHtml(diff) {
  const campos = Object.keys(diff);
  if (campos.length === 0) return '';
  const mostrar = valor => valor || '(vacio)';
  const filas = campos.map(fieldId => {
    const { anterior, nuevo, label } = diff[fieldId];
    return '<div class="diff-fiscal-fila">' +
      '<strong>' + (label || DIFF_FISCAL_LABELS[fieldId] || fieldId) + ':</strong> ' +
      '<span class="diff-fiscal-anterior">' + mostrar(anterior) + '</span>' +
      ' &rarr; ' +
      '<span class="diff-fiscal-nuevo">' + mostrar(nuevo) + '</span>' +
      '</div>';
  }).join('');
  return '<div class="diff-fiscal-panel">' +
    '<p class="dedup-alerta-naranja">Los datos fiscales de la CSF no coinciden con los guardados en Operam</p>' +
    filas +
    '<div class="diff-fiscal-acciones">' +
    '<button type="button" class="btn btn-secondary" onclick="altaDiffFiscalConfirmar()">Confirmar y actualizar en Operam</button> ' +
    '<button type="button" class="btn btn-secondary diff-fiscal-btn-descartar" onclick="altaDiffFiscalDescartar()">Descartar y continuar sin actualizar</button>' +
    '</div>' +
    '</div>';
}

// Compone el banner "RFC ya existe" + panel de diff fiscal cuando hay diferencias.
// No bloqueante: "Usar este cliente" siempre presente (AC3). Ver razonamiento de diseno
// (por que NO bloquea) en el comentario gemelo de app.js y en ralph-progress.txt iter 2.
function buildDedupExactoConDiffHtml(cliente, csfDatos) {
  const nombre = cliente.CustName || cliente.name || '';
  const id = cliente.id || cliente.customer_id || '';
  const rfcC = cliente.RFC || cliente.rfc || cliente.tax_id || '';
  const base =
    '<div class="dedup-exacto">' +
    '<p class="dedup-alerta-roja">Este RFC ya existe en Operam</p>' +
    '<p><strong>' + nombre + '</strong> (ID: ' + id + ', RFC: ' + rfcC + ')</p>' +
    '<button class="btn btn-secondary" type="button" onclick="altaDedupUsarCliente(' + id + ')">Usar este cliente</button>' +
    '</div>';
  if (!csfDatos) return base;
  const diff = calcularDiffFiscal(cliente, csfDatos);
  return base + buildDiffFiscalHtml(diff);
}

// Arma la peticion PATCH /api/operam/clientes/:id {diff} (AC2). Mismo patron que
// buildDedupRequest -- testeable sin DOM/fetch. Ver gemelo en app.js.
function buildActualizarFiscalRequest(clienteId, diff, authHeader) {
  return {
    url: '/api/operam/clientes/' + clienteId,
    method: 'PATCH',
    body: { diff },
    headers: { 'Authorization': authHeader },
  };
}

module.exports = { buildAltaSelectoresOpts, altaToggleSeccionState, buildCargarCatalogosRequest, buildAltaComercialPayload, buildCsfDropzoneState, buildCsfDatosExtraidos, validarCsfCampos, buildCsfConfirmarPayload, altaCheckpointState, altaDesbloqueaSeccion, buildCsfDatosDesdeRespuesta, altaCsfResultadoParseo, combinarTelefonoConCodigo, buildAltaDomicilioPayload, validarAltaDomicilio, buildAltaDarDeAltaPayload, validarRfcManual, buildManualDatosExtraidos, buildManualConfirmarPayload, buildDedupRequest, buildDedupDomiciliosRequest, buildDedupExactoHtml, buildDedupDomiciliosHtml, buildDedupCandidatosHtml, resolveClienteId, calcularDiffFiscal, buildDiffFiscalHtml, buildDedupExactoConDiffHtml, buildActualizarFiscalRequest };
