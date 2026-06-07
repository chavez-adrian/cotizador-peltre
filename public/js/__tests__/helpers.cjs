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

// ─── csf-upload.html: mapeo del endpoint centralizado al shape esperado por poblarForm ──
// Mapa de regimenes -> codigo (para el label legible regimen_text; el endpoint solo da el codigo)
const CSF_UPLOAD_REGIMENES = {
  'General de Ley Personas Morales':                                   '601',
  'Personas Morales con Fines no Lucrativos':                          '603',
  'Sueldos y Salarios e Ingresos Asimilados a Salarios':               '605',
  'Arrendamiento':                                                      '606',
  'Enajenación o Adquisición de Bienes':                               '607',
  'Demás ingresos':                                                     '608',
  'Residentes en el Extranjero sin Establecimiento Permanente':         '610',
  'Ingresos por Dividendos':                                            '611',
  'Personas Físicas con Actividades Empresariales y Profesionales':     '612',
  'Ingresos por intereses':                                             '614',
  'Sin obligaciones fiscales':                                          '616',
  'Incorporación Fiscal':                                               '621',
  'Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras':           '622',
  'Plataformas Tecnológicas':                                           '625',
  'Régimen Simplificado de Confianza':                                  '626',
};
const CSF_UPLOAD_PRIORIDAD = ['601','603','612','621','626','606','622','607','608','605','614','611','610','616','625'];

function csfUploadDetectarRegimenTexto(texto, codigoEndpoint) {
  const encontrados = [];
  for (const [clave, codigo] of Object.entries(CSF_UPLOAD_REGIMENES)) {
    if (texto.includes(clave)) encontrados.push({ texto: clave, codigo });
  }
  if (encontrados.length === 0) return '';
  encontrados.sort((a, b) => CSF_UPLOAD_PRIORIDAD.indexOf(a.codigo) - CSF_UPLOAD_PRIORIDAD.indexOf(b.codigo));
  // Preferir el que coincide con el codigo que ya retorno el endpoint (fuente de verdad)
  const match = encontrados.find(e => e.codigo === codigoEndpoint);
  return (match || encontrados[0]).texto;
}

const CSF_UPLOAD_MESES = { enero:'01',febrero:'02',marzo:'03',abril:'04',mayo:'05',junio:'06',
  julio:'07',agosto:'08',septiembre:'09',octubre:'10',noviembre:'11',diciembre:'12' };

function csfUploadExtraerFecha(texto) {
  const mFecha = texto.match(/A\s+(\d{1,2})\s+DE\s+([A-ZÁÉÍÓÚÑ]+)\s+DE\s+(\d{4})/i);
  if (mFecha) {
    const mes = CSF_UPLOAD_MESES[mFecha[2].toLowerCase()] || '01';
    return `${mFecha[3]}-${mes}-${mFecha[1].padStart(2, '0')}`;
  }
  const mFecha2 = texto.match(/Fecha del [uú]ltimo cambio de situaci[oó]n\s*:?\s*(\d{2})-(\d{2})-(\d{4})/i)
               || texto.match(/Fecha de Inicio de operaciones\s*:?\s*(\d{2})-(\d{2})-(\d{4})/i);
  if (mFecha2) return `${mFecha2[3]}-${mFecha2[2]}-${mFecha2[1]}`;
  return new Date().toISOString().slice(0, 10);
}

function csfUploadExtraerNotes(texto) {
  const actividades = [];
  const actRegex = /(\d+)\s+([A-ZÁÉÍÓÚÑ][^\n]+?)\s+(\d+)\s+(\d{2}\/\d{2}\/\d{4})/g;
  let mAct;
  while ((mAct = actRegex.exec(texto)) !== null) {
    const desc = mAct[2].trim();
    const pct = mAct[3];
    if (!actividades.some(a => a.includes(desc))) actividades.push(`${desc} (${pct}%)`);
  }
  if (actividades.length) {
    const fecha = csfUploadExtraerFecha(texto);
    return `Actividades económicas (CSF ${fecha}):\n` + actividades.map(a => `- ${a}`).join('\n');
  }
  const regimenesDetalle = [];
  const regRegex = /R[eé]gimen\s*:\s*(R[eé]gimen [^\n]+?)\s+Fecha de alta\s*:\s*(\d{2})-(\d{2})-(\d{4})/gi;
  let mReg;
  while ((mReg = regRegex.exec(texto)) !== null) {
    const nombre = mReg[1].trim().replace(/\s+/g, ' ');
    const fecha = `${mReg[4]}-${mReg[3]}-${mReg[2]}`;
    regimenesDetalle.push(`${nombre} (alta ${fecha})`);
  }
  if (regimenesDetalle.length) {
    const fecha = csfUploadExtraerFecha(texto);
    return `Regímenes fiscales (portal SAT ${fecha}):\n` + regimenesDetalle.map(r => `- ${r}`).join('\n');
  }
  return '';
}

// Mapea { rfc, razonSocial, nombreCorto, calle, numExt, numInt, colonia, municipio, estado,
// cp, idcif, regimenFiscal, pais } (datos del endpoint /api/parsear-csf) + texto crudo
// (para derivados de presentacion que el endpoint no produce: regimen_text/notes/csf_fecha)
// al shape que poblarForm() de csf-upload.html espera.
function buildCsfUploadDatosDesdeEndpoint(datos, texto) {
  const d = datos || {};
  const txt = texto || '';
  return {
    CustName: d.razonSocial || '',
    cust_ref: d.nombreCorto || '',
    tax_id: d.rfc || '',
    idcif: d.idcif || '',
    street: d.calle || '',
    street_number: d.numExt || '',
    suite_number: d.numInt || '',
    district: d.colonia || '',
    postal_code: d.cp || '',
    city: d.municipio || '',
    state: d.estado || '',
    country: 'México',
    cfdi_regimen_fiscal: d.regimenFiscal || '',
    regimen_text: csfUploadDetectarRegimenTexto(txt, d.regimenFiscal || ''),
    csf_fecha: csfUploadExtraerFecha(txt),
    notes: csfUploadExtraerNotes(txt),
    phone: '',
    email: '',
  };
}

// Decide que devuelve parsearCSF(texto) tras llamar a /api/parsear-csf (issue #34, corrida 2):
// el endpoint puede responder {ok:false} (HTTP 422, "No se detecto un RFC en el texto"). El
// parser viejo de csf-upload.html NUNCA lanzaba (siempre devolvia datos usables, rfc:'' si no
// detectaba nada). Esta funcion mirrorea la decision que parsearCSF debe tomar: SIEMPRE devolver
// un objeto datos mapeado (shape de poblarForm) -- nunca lanzar -- para que procesarPDF muestre
// formSection con captura manual habilitada (mismo principio que altaCsfResultadoParseo, iter5;
// converge con el camino existente `if (!data.tax_id)` de procesarPDF, sin duplicar logica).
function buildCsfUploadDatosParseo(json, texto) {
  const datos = (json && json.ok && json.datos) ? json.datos : {};
  return buildCsfUploadDatosDesdeEndpoint(datos, texto);
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
  const filas = campos.map(fieldId => {
    const { anterior, nuevo, label } = diff[fieldId];
    return '<div class="diff-fiscal-fila">' +
      '<strong>' + (label || DIFF_FISCAL_LABELS[fieldId] || fieldId) + ':</strong> ' +
      '<span class="diff-fiscal-anterior">' + (anterior || '(vacio)') + '</span>' +
      ' &rarr; ' +
      '<span class="diff-fiscal-nuevo">' + (nuevo || '(vacio)') + '</span>' +
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

module.exports = { buildPreFillMap, applyPreFillMap, buildEntregaPayload, buildCsfPayload, buildPaisConfig, buildOperamPreFillMap, buildCsfDuplicadoBanner, buildClienteSnapshot, findRfcMatch, calcularDiff, buildConfirmacionItems, shouldTriggerRfcSearch, buildAltaSelectoresOpts, altaToggleSeccionState, buildCargarCatalogosRequest, buildAltaComercialPayload, buildCsfDropzoneState, buildCsfDatosExtraidos, validarCsfCampos, buildCsfConfirmarPayload, altaCheckpointState, altaDesbloqueaSeccion, buildCsfDatosDesdeRespuesta, altaCsfResultadoParseo, buildCsfUploadDatosDesdeEndpoint, buildCsfUploadDatosParseo, buildAltaDomicilioPayload, validarAltaDomicilio, buildAltaDarDeAltaPayload, validarRfcManual, buildManualDatosExtraidos, buildManualConfirmarPayload, buildDedupRequest, buildDedupDomiciliosRequest, buildDedupExactoHtml, buildDedupDomiciliosHtml, buildDedupCandidatosHtml, resolveClienteId, calcularDiffFiscal, buildDiffFiscalHtml, buildDedupExactoConDiffHtml };
