// Logica pura del flujo de alta de cliente (CSF, diff fiscal, payload de alta).
// Modulo sin efectos secundarios de navegador -- importable tanto desde app.js
// (ESM nativo en el browser) como desde los tests (.cjs via import() dinamico).
// Existe para que ambos lados consuman la MISMA implementacion en vez de mantener
// copias espejo que pueden divergir (ver architecture-review-cotizador-20260606.html).

export const CSF_DATOS_VACIOS = {
  rfc: '', razonSocial: '', nombreCorto: '', idcif: '', regimenFiscal: '',
  calle: '', numExt: '', numInt: '', colonia: '', cp: '', municipio: '', estado: '',
};

// El endpoint centralizado puede responder ok:false (sin RFC detectado). A diferencia del
// parser viejo (que nunca fallaba), no queremos dejar al usuario sin salida -- siempre se
// devuelve success con un objeto datos completo (vacio si no hubo deteccion) para captura
// y edicion manual (issue #34).
export function altaCsfResultadoParseo(respuestaInterpretada, fileName) {
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

// Combina el codigo de pais del select alta-addr-phone-code con el numero capturado
// (issue #25 / SOP paso 28). El select incluye "+1-CA" como etiqueta para distinguir
// Canada de EUA visualmente, pero el codigo de marcado real es "+1" -- se descarta el
// sufijo "-CA" antes de anteponerlo. Si el numero ya viene con "+" se respeta tal cual
// (el vendedor pudo capturarlo completo) para no duplicar el prefijo.
export function combinarTelefonoConCodigo(code, phone) {
  const tel = (phone || '').trim();
  if (!tel) return '';
  if (tel.startsWith('+')) return tel;
  const prefijo = (code || '').replace(/-CA$/, '');
  if (!prefijo || prefijo === '+') return tel;
  return `${prefijo} ${tel}`;
}

// Validacion dura de telefono con codigo de pais. Para +52/+1/+1-CA el numero
// nacional debe tener exactamente 10 digitos. Para "Otro" (+) el vendedor debe
// capturar el numero internacional completo empezando con + (11-15 digitos).
// Si el numero ya trae +, se valida por longitud total y el select se ignora.
export function validarTelefono(code, phone) {
  const tel = (phone || '').trim();
  if (!tel) return 'El telefono es obligatorio (con codigo de pais)';
  const digitos = tel.replace(/\D/g, '');
  if (tel.startsWith('+') || (code || '') === '+' || !code) {
    if (!tel.startsWith('+') || digitos.length < 11 || digitos.length > 15) {
      return 'Captura el numero completo con codigo de pais (ej. +52 55 1234 5678)';
    }
    return null;
  }
  if (digitos.length !== 10) {
    return `El numero debe tener 10 digitos despues del codigo ${code.replace(/-CA$/, '')} (tiene ${digitos.length})`;
  }
  return null;
}

// Inversa de combinarTelefonoConCodigo: separa un telefono guardado en
// { code, numero } para repoblar el select + input. Prefijos conocidos: 52 y 1.
// Numeros legacy de 10 digitos (guardados antes del bloqueo duro) asumen +52.
export function separarTelefonoCodigo(telefono) {
  const tel = (telefono || '').trim();
  if (!tel) return { code: '+52', numero: '' };
  if (tel.startsWith('+52 ')) return { code: '+52', numero: tel.slice(4).trim() };
  if (tel.startsWith('+1 ')) return { code: '+1', numero: tel.slice(3).trim() };
  const digitos = tel.replace(/\D/g, '');
  if (!tel.startsWith('+')) {
    if (digitos.length === 12 && digitos.startsWith('52')) return { code: '+52', numero: digitos.slice(2) };
    if (digitos.length === 11 && digitos.startsWith('1')) return { code: '+1', numero: digitos.slice(1) };
    if (digitos.length === 10) return { code: '+52', numero: digitos };
  }
  return { code: '+', numero: tel };
}

// === Diff fiscal sobre cliente existente al subir CSF (issue #38) ===
//
// Mapea los datos de la CSF (altaState.datos: razonSocial/rfc/calle/numExt/...) contra
// los campos crudos del cliente en Operam (CustName/tax_id/street/...) y calcula un diff
// cuyas LLAVES son nombres de campo de OPERAM -- a proposito distinto del calcularDiff
// viejo (que usaba ids de DOM como cl-razon-social). actualizarCliente(id, diff) hace
// body[fieldId] = nuevo y lo manda directo al PUT /customers/:id de Operam: si la llave
// fuera un id de DOM, el PATCH mandaria campos que Operam no reconoce. Usar nombres de
// campo Operam es lo correcto para que el PATCH actualice algo real (ver ralph-progress.txt).
export const DIFF_FISCAL_CAMPOS = [
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

export const DIFF_FISCAL_LABELS = DIFF_FISCAL_CAMPOS.reduce((acc, { operam, label }) => {
  acc[operam] = label;
  return acc;
}, {});

export function calcularDiffFiscal(clienteOperam, csfDatos) {
  const diff = {};
  for (const { operam, csf, label } of DIFF_FISCAL_CAMPOS) {
    if (!(csf in csfDatos)) continue; // el formulario de captura no recolecta este campo (ej. alta manual no tiene domicilio fiscal completo) -- ausente != vacio, no es un cambio real
    const anterior = String(clienteOperam[operam] == null ? '' : clienteOperam[operam]).trim();
    const nuevo = String(csfDatos[csf] == null ? '' : csfDatos[csf]).trim();
    if (anterior !== nuevo) {
      diff[operam] = { anterior, nuevo, label };
    }
  }
  return diff;
}

export function buildDiffFiscalHtml(diff) {
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

// Compone el banner "RFC ya existe" (igual al existente, "Usar este cliente" SIEMPRE
// disponible -- AC3) + panel de diff fiscal cuando hay diferencias (AC1/AC4). Es
// deliberadamente NO bloqueante: el vendedor puede avanzar con "Usar este cliente" sin
// resolver el diff -- es un paso paralelo/opcional, no un gate (decision documentada en
// ralph-progress.txt iter 2: bloquear forzaria al vendedor a decidir sobre datos fiscales
// en medio de un flujo de cotizacion, friccion injustificada para un caso que no impide
// continuar -- el dato sigue desactualizado en Operam pero el vendedor ya fue avisado y
// puede resolverlo ahi mismo o despues).
export function buildDedupExactoConDiffHtml(cliente, csfDatos) {
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

// Construye el body de POST /api/crear-cliente a partir de los datos fiscales (CSF),
// los campos comerciales capturados y el domicilio de entrega. customerId/branchId
// no nulos indican un reintento (issue #?): se reenvian para que el backend continue
// donde quedo en vez de crear un cliente duplicado.
export function buildAltaDarDeAltaPayload(csfDatos, comercial, domicilio, customerId, branchId) {
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
    timbrado_uso_cfdi: comercial.uso_cfdi || '',
    sales_type: comercial.sales_type || '',
    segmento_id: comercial.segmento_id || '',
    salesman: comercial.salesman || '',
    invoice_email: comercial.invoice_email || '',
    celular_nota: comercial.celular_nota || '',
    // Contacto principal a nivel cliente (issue #16): el formulario no tiene una
    // seccion separada de "contacto principal" -- se reusa phone/email del domicilio
    // de entrega (ya combinado con codigo de pais, ver combinarTelefonoConCodigo) porque
    // en clientes de mayoreo PyME quien recibe en el domicilio operativo suele ser
    // tambien el contacto principal. Documentado en ralph-progress.txt (issue #26, item 5).
    phone: domicilio.phone || '',
    email: domicilio.email || '',
    pais: domicilio.pais || csfDatos.pais || 'MX',
    entrega: { ...domicilio },
    customer_id: customerId || null,
    branch_id: branchId || null,
    fuente: 'cotizador',
  };
}
