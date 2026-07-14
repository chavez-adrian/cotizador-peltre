// Logica pura del flujo de alta de cliente (CSF, diff fiscal, payload de alta).
// Modulo sin efectos secundarios de navegador -- importable tanto desde app.js
// (ESM nativo en el browser) como desde los tests (.cjs via import() dinamico).
// Existe para que ambos lados consuman la MISMA implementacion en vez de mantener
// copias espejo que pueden divergir (ver architecture-review-cotizador-20260606.html).

import { cpValido } from './cotizar-logica.js';

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
// Los numeros +52 arrastran a veces el "1" de movil mexicano heredado
// (+52 1 55 xxxx xxxx) y los +1 el "1" del codigo de pais. Cuando el numero
// nacional trae 11 digitos empezando con 1, el "1" sobra: los 10 significativos
// son los restantes. Devuelve el telefono sin ese "1" lider (conservando el
// resto del formato); si no aplica, lo deja igual.
function quitarUnoLider(tel) {
  const digitos = tel.replace(/\D/g, '');
  if (digitos.length === 11 && digitos.startsWith('1')) {
    return tel.replace(/^\s*1[\s-]*/, '');
  }
  return tel;
}

export function combinarTelefonoConCodigo(code, phone) {
  const tel = (phone || '').trim();
  if (!tel) return '';
  if (tel.startsWith('+')) return tel;
  const prefijo = (code || '').replace(/-CA$/, '');
  if (!prefijo || prefijo === '+') return tel;
  return `${prefijo} ${quitarUnoLider(tel)}`;
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
  const nacional = (digitos.length === 11 && digitos.startsWith('1')) ? digitos.slice(1) : digitos;
  if (nacional.length !== 10) {
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
  { operam: 'cust_ref',            csf: 'nombreCorto',   label: 'Nombre corto' },
  { operam: 'timbrado_uso_cfdi',   csf: 'usoCfdi',        label: 'Uso de CFDI', default: 'S01' },
  { operam: 'invoice_email',       csf: 'invoiceEmail',   label: 'Email de facturacion' },
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

// Resuelve el valor "nuevo" de un campo del diff/payload contra la CSF/manual.
// Para la mayoria de los campos, ausente en csfDatos == el formulario de captura
// no lo recolecta (ej. alta manual no tiene domicilio fiscal completo) -- NO es un
// cambio real, se omite (undefined). Cuando SI esta presente pero vacio, y el campo
// tiene `default` (issue #95 regla 2, Uso de CFDI), cae al default en vez de vaciar
// el dato en Operam. `forzarDefault` es la excepcion de dominio de esa misma regla:
// Uso de CFDI se manda SIEMPRE en el PUT, incluso si el formulario ni siquiera lo
// capturo -- solo lo usa buildActualizarFiscalPayload; calcularDiffFiscal conserva
// la semantica de "ausente != vacio" para no reportar diffs falsos contra clientes
// de Operam que no traen ese campo crudo.
function resolverValorNuevo({ csf, default: def }, csfDatos, { forzarDefault = false } = {}) {
  const presente = csf in csfDatos;
  if (!presente) return (forzarDefault && def !== undefined) ? def : undefined;
  const crudo = csfDatos[csf];
  if (crudo == null || crudo === '') return def !== undefined ? def : '';
  return crudo;
}

export function calcularDiffFiscal(clienteOperam, csfDatos) {
  const diff = {};
  for (const campo of DIFF_FISCAL_CAMPOS) {
    const nuevoValor = resolverValorNuevo(campo, csfDatos);
    if (nuevoValor === undefined) continue;
    const { operam, label } = campo;
    const anterior = String(clienteOperam[operam] == null ? '' : clienteOperam[operam]).trim();
    const nuevo = String(nuevoValor).trim();
    if (anterior !== nuevo) {
      diff[operam] = { anterior, nuevo, label };
    }
  }
  return diff;
}

// Body del PUT del upgrade de CSF (issue #85): escribe los datos fiscales reales
// (RFC, razon social, regimen, domicilio fiscal) sobre el cliente generico existente.
// Recorre la MISMA tabla que calcularDiffFiscal para que lo enviado y lo verificado
// sean simetricos. Omite campos que la CSF no recolecto (ausente != vacio): mandar
// una cadena vacia nukearia en Operam un dato que el vendedor nunca tuvo oportunidad
// de capturar.
// notasActuales (issue #95 regla 5): las notas crudas del cliente en Operam ANTES
// del PUT, solo necesarias cuando la CSF/formulario trae un Tax ID extranjero
// capturado -- el caller (server.js) las lee con una relectura previa unicamente en
// ese caso, para no pagar un GET extra en el camino comun.
export function buildActualizarFiscalPayload(csfDatos, notasActuales) {
  const body = {};
  for (const campo of DIFF_FISCAL_CAMPOS) {
    const nuevoValor = resolverValorNuevo(campo, csfDatos, { forzarDefault: true });
    if (nuevoValor === undefined) continue;
    body[campo.operam] = nuevoValor;
  }
  const notas = buildNotasConTaxId(notasActuales, csfDatos.taxIdExtranjero);
  if (notas !== undefined) body.notes = notas;
  return body;
}

// Validacion de la pestana "Captura manual" (issue #95 regla 4). Decision de
// Adrian: hay clientes que prefieren no compartir su CSF, asi que la captura
// manual debe permitir dar de alta con el domicilio fiscal minimo: Razon Social,
// RFC, Codigo Postal y Regimen Fiscal son los UNICOS obligatorios; calle, numero,
// colonia y estado quedan opcionales (igual que en la tab CSF, que ya los trae del
// PDF). El nombre corto (antes obligatorio en esta pestana) tambien pasa a
// opcional -- no esta en la lista de minimos de la regla 4.
export function validarAltaManualMinimos(datos) {
  const d = datos || {};
  if (!String(d.rfc || '').trim()) return 'El RFC es obligatorio';
  if (!String(d.razonSocial || '').trim()) return 'La razon social es obligatoria';
  if (!String(d.cp || '').trim()) return 'El codigo postal es obligatorio';
  if (!String(d.regimenFiscal || '').trim()) return 'El regimen fiscal es obligatorio';
  return null;
}

// Tax ID extranjero -> notas del cliente (issue #95 regla 5): no hay campo dedicado
// en la API v3 de Operam para eso, asi que se antepone una linea con prefijo claro
// a las notas EXISTENTES en Operam (nunca se sobreescriben: notas trae actividades
// economicas, celular, email de facturacion, etc. -- ver buildClienteBody). Idempotente:
// si la linea ya esta presente (reintento del upgrade) no la duplica. undefined si no
// hay Tax ID capturado -- el caller no debe tocar el campo notes en ese caso.
export function buildNotasConTaxId(notasActuales, taxIdExtranjero) {
  const tax = String(taxIdExtranjero || '').trim();
  if (!tax) return undefined;
  const actual = String(notasActuales || '').trim();
  const prefijo = `Tax ID: ${tax}`;
  if (actual.includes(prefijo)) return actual;
  return actual ? `${prefijo}\n${actual}` : prefijo;
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

// Candidatos por RFC generico cuando llega una CSF con RFC REAL (issue #78):
// el cliente pudo darse de alta antes sin CSF. A diferencia de la rama generica
// de ADR-0001 (buildDedupCandidatosHtml en helpers.cjs -- vendedor NUNCA puede
// crear nuevo, debe elegir uno o escalar), aqui el RFC de entrada YA es real:
// "Crear nuevo" es un camino legitimo si el candidato resulta ser otra empresa.
// "Actualizar este" dispara el upgrade fiscal existente de #85 sobre ese
// customer_id con los datos de la CSF ya parseada.
export function buildCandidatosRfcGenericoHtml(candidatos) {
  if (!Array.isArray(candidatos) || candidatos.length === 0) return '';
  const filas = candidatos.map(c => {
    const nombre = c.CustName || c.cust_ref || 'Sin nombre';
    const senal = c._telefonoMatch ? 'telefono coincide' : 'nombre similar';
    return (
      '<div class="candidato-generico-fila">' +
      '<p><strong>' + nombre + '</strong> (' + (c.cust_ref || '') + ') &middot; ' + senal + '</p>' +
      '<button type="button" class="btn btn-secondary" onclick="altaCandidatoActualizar(' + c.id + ')">Actualizar este</button> ' +
      '<button type="button" class="btn btn-secondary" onclick="altaCandidatoCrearNuevo()">Crear nuevo</button>' +
      '</div>'
    );
  }).join('');
  return '<div class="dedup-candidatos-generico">' +
    '<p class="dedup-alerta-naranja">Este contacto coincide con un cliente ya existente en Operam (dado de alta sin RFC)</p>' +
    filas +
    '</div>';
}

// === Estado compartido alta -> cotizador (issue #69) ===
//
// Tras dar de alta un cliente, "Cotizar ahora" debe abrir el cotizador con el cliente
// YA cargado, sin re-pedir datos ni depender de un round-trip a Operam por RFC (que
// puede no encontrar al cliente recien creado). Se reusa lo capturado en altaState:
// los datos fiscales (datos) y el domicilio de entrega (domicilio, que ya trae el
// telefono combinado con codigo de pais). El objeto resultante tiene la MISMA forma
// que consume seleccionarClienteOperam en app.js (id/name/ref/rfc/calle/.../telefono),
// de modo que el mismo prellenado de la pestana de cliente sirve para ambos caminos.
export function buildClienteDesdeAlta(altaState) {
  const st = altaState || {};
  const datos = st.datos || {};
  const dom = st.domicilio || {};
  const calle = [dom.addr_street, dom.addr_exterior].filter(Boolean).join(' ');
  return {
    id: st.customer_id != null ? st.customer_id : null,
    name: datos.razonSocial || '',
    ref: datos.nombreCorto || '',
    rfc: datos.rfc || '',
    cpFiscal: datos.cp || '',
    calle,
    numInt: dom.addr_interior || '',
    colonia: dom.addr_colony || '',
    cp: dom.addr_zip || datos.cp || '',
    municipio: dom.addr_city || datos.municipio || '',
    estado: dom.addr_state || datos.estado || '',
    nombreEntrega: dom.br_name || '',
    telefono: dom.phone || '',
    email: dom.email || '',
  };
}

// Traduce la clasificacion de un celular (/api/prospectos/clasificar: {tipo:
// 'cliente'|'prospecto'|'libre'}) a una decision para la UI del primer formulario
// (issue #69 AC3). Mismo guardrail que la dedup por RFC: si el celular ya pertenece a
// un prospecto o cliente, se avisa; libre o respuesta invalida no marca nada (best
// effort: la clasificacion puede fallar y no debe bloquear el alta).
export function mensajeBusquedaCelular(clasificacion) {
  const c = clasificacion || {};
  if (c.tipo === 'cliente') {
    const nombre = c.cust_name || (c.cliente && c.cliente.cust_name) || '';
    return { encontrado: true, tipo: 'cliente', mensaje: `Este celular ya es un cliente en Operam${nombre ? ': ' + nombre : ''}` };
  }
  if (c.tipo === 'prospecto') {
    const p = c.prospecto || {};
    const nombre = p.nombre || '';
    const vendedor = p.vendedor || '';
    let mensaje = `Este celular ya es un prospecto${nombre ? ': ' + nombre : ''}`;
    if (vendedor) mensaje += ` (lo atiende ${vendedor})`;
    return { encontrado: true, tipo: 'prospecto', mensaje };
  }
  return { encontrado: false, tipo: c.tipo || 'libre', mensaje: '' };
}

// === Paso Cliente variante B (issue #82; entrega diferida al paso Envio en #84) ===
//
// Toda la logica decisional del rediseno del paso Cliente vive aqui (el render de
// app.js es tonto): mezcla de busqueda Operam+prospectos, derivacion de recientes,
// estado de chips (tri-estado de Entrega, #84), payload del contacto nuevo y
// guardrails del celular. Ver CONTEXT.md.

const RFC_GENERICOS_BROWSER = new Set(['XAXX010101000', 'XEXX010101000']);

// Un RFC generico (XAXX/XEXX del SAT) marca a un cliente como "pendiente fiscal":
// se dio de alta sin CSF y puede actualizarse con datos fiscales reales (#85/#94).
export function esRfcGenerico(rfc) {
  return RFC_GENERICOS_BROWSER.has(String(rfc || '').toUpperCase().trim());
}

// customer_id de Operam contra el que se puede hacer el upgrade fiscal (#85/#94):
// cliente Operam -> su id; prospecto ya ligado a un generico -> clienteOperamId;
// contacto nuevo / prospecto sin cotizar -> null (aun no hay cliente en Operam).
// Fuente unica compartida por el paso Cliente (pcCustomerIdFiscal) y la vista
// Clientes (cvAbrirUpgrade) -- extender, no copiar.
export function customerIdFiscal(cliente) {
  const c = cliente || {};
  if (c.tipo === 'operam') return c.id != null ? c.id : null;
  if (c.tipo === 'prospecto') return c.clienteOperamId != null ? c.clienteOperamId : null;
  return null;
}

// El boton "Completar datos fiscales (CSF)" (y el chip Fiscal accionable) proceden
// solo cuando el RFC sigue pendiente (generico/vacio) Y hay un cliente en Operam
// contra el cual hacer el PUT del upgrade. Misma regla que el chip Fiscal del paso
// Cliente (chipsCompletitud.fiscal + customerIdFiscal).
export function mostrarBotonCsf(cliente) {
  return !chipsCompletitud(cliente).fiscal && customerIdFiscal(cliente) != null;
}

// Un contacto nuevo (persona detras de un celular) y un prospecto se normalizan al
// MISMO objeto cliente que consume seleccionarClienteOperam (name/ref/telefono/...),
// para que el prellenado de los campos cl-* y el gate #81 (necesitaAltaGenerica:
// razonSocial||nombreCorto Y telefono) sirvan igual por los tres caminos. La ciudad
// va a `municipio` como pista para estimar envio; el domicilio de entrega (CP+pais)
// se difiere al bloque opcional de la tarjeta (migra al paso Envio en #84).
export function buildClienteDesdeContactoNuevo(campos) {
  const c = campos || {};
  const nombre = (c.nombre || '').trim();
  const ciudad = (c.ciudad || '').trim();
  return {
    tipo: 'nuevo',
    id: null,
    name: nombre,
    ref: nombre,
    rfc: '',
    telefono: c.telefono || '',
    municipio: ciudad,
    ciudad,
    pais: c.pais || 'MX',
    canal: c.canal || '',
    email: c.email || '',
  };
}

export function clienteDesdeProspecto(prospecto) {
  const p = prospecto || {};
  const ciudad = p.ciudad || '';
  return {
    tipo: 'prospecto',
    id: null,
    prospectoId: p.id != null ? p.id : null,
    // customer_id del cliente generico si el prospecto ya cotizo (ligarCliente, #81):
    // destino del PUT del upgrade fiscal (#85). null = nunca cotizo, no hay contra que actualizar.
    clienteOperamId: (p.data && p.data.cliente_id != null) ? p.data.cliente_id : null,
    name: p.nombre || '',
    ref: p.nombre || '',
    rfc: '',
    telefono: p.celular || '',
    municipio: ciudad,
    ciudad,
    pais: 'MX',
    etapa: p.etapa || '',
    email: (p.data && p.data.correo) || '',
  };
}

function normalizarOperam(c) {
  return { tipo: 'operam', id: c.id, nombre: c.name || '', rfc: c.rfc || '', sub: c.rfc || '', raw: c };
}

function normalizarProspecto(p) {
  return {
    tipo: 'prospecto', id: p.id, nombre: p.nombre || '',
    ciudad: p.ciudad || '', celular: p.celular || '', etapa: p.etapa || '',
    sub: [p.ciudad, p.celular].filter(Boolean).join(' - '), raw: p,
  };
}

// Un solo buscador que encuentra a la vez clientes de Operam y prospectos del
// vendedor, distinguibles por tipo (AC2). Query < 2 chars -> [] (el caller muestra
// recientes). Operam matchea por nombre o RFC; el prospecto por nombre, ciudad o los
// digitos del celular. Ordena coincidencias por prefijo antes que internas (mezcla
// los tipos, no los agrupa: "distinguibles" no es "separados").
export function mezclarResultadosBusqueda(clientesOperam, prospectos, query) {
  const q = String(query || '').toLowerCase().trim();
  if (q.length < 2) return [];
  const qDigitos = q.replace(/\D/g, '');
  const filas = [
    ...(clientesOperam || []).map(normalizarOperam).filter(r =>
      r.nombre.toLowerCase().includes(q) || r.rfc.toLowerCase().includes(q)),
    ...(prospectos || []).map(normalizarProspecto).filter(r =>
      r.nombre.toLowerCase().includes(q) ||
      r.ciudad.toLowerCase().includes(q) ||
      (qDigitos.length >= 2 && r.celular.replace(/\D/g, '').includes(qDigitos))),
  ];
  return filas.sort((a, b) => {
    const pa = a.nombre.toLowerCase().startsWith(q) ? 0 : 1;
    const pb = b.nombre.toLowerCase().startsWith(q) ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return a.nombre.localeCompare(b.nombre);
  });
}

// Los ultimos clientes/prospectos cotizados por el vendedor, derivados de
// GET /api/cotizaciones (cada entrada: { id, fecha, cliente, telefono }). Deduplica
// por nombre (conserva la mas reciente), ordena por fecha desc y recorta al limite.
export function recientesDesdeCotizaciones(cotizaciones, limite = 6) {
  const ordenadas = (cotizaciones || [])
    .filter(c => c && (c.cliente || '').trim())
    .slice()
    .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
  const vistos = new Set();
  const out = [];
  for (const c of ordenadas) {
    const clave = c.cliente.trim().toLowerCase();
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    out.push({ nombre: c.cliente, telefono: c.telefono || '', cotizacionId: c.id, fecha: c.fecha });
    if (out.length >= limite) break;
  }
  return out;
}

// Estado de los chips de completitud de la tarjeta (AC6/#82; tri-estado de
// Entrega extendido en #84), desde datos reales:
//  - Contacto: nombre resoluble (name||ref) Y telefono (lo minimo para cotizar).
//  - Entrega: tri-estado -- 'pendiente' (sin CP valido), 'cp' (CP+pais validos,
//    sin Calle) o 'completo' (CP+pais validos y Calle). El domicilio se captura
//    en el paso Envio (#84); Operam ya lo trae con el cliente.
//  - Fiscal: RFC real (presente y NO generico -- el generico ES "pendiente fiscal").
export function chipsCompletitud(cliente) {
  const c = cliente || {};
  const nombre = (c.name || c.ref || '').trim();
  const telefono = (c.telefono || '').trim();
  const cp = (c.cp || c.cpEntrega || '').trim();
  const pais = (c.pais || '').trim();
  const calle = (c.calle || '').trim();
  const rfc = (c.rfc || '').toUpperCase().trim();
  const cpOk = !!(cp && pais && cpValido(cp, pais));
  return {
    contacto: !!(nombre && telefono),
    entrega: cpOk ? (calle ? 'completo' : 'cp') : 'pendiente',
    fiscal: !!(rfc && !RFC_GENERICOS_BROWSER.has(rfc)),
  };
}

// Decide que hacer cuando, en el camino "Contacto nuevo", se clasifica el celular
// (GET /api/prospectos/clasificar) al blur (AC3/AC4, #69, CONTEXT.md "Visibilidad"):
//  - cliente Operam  -> cotizar sobre ese cliente (se busca por nombre en Operam).
//  - prospecto propio -> usar ese prospecto (no se duplica; 1 celular = 1 prospecto).
//  - prospecto ajeno  -> bloquear la captura indicando quien lo atiende.
//  - libre/nulo       -> crear normalmente.
export function accionCelularContactoNuevo(clasificacion, usuarioActual) {
  const c = clasificacion || {};
  const msg = mensajeBusquedaCelular(c);
  if (c.tipo === 'cliente') {
    return { accion: 'cotizar_cliente', tipo: 'cliente', cust_name: msg.encontrado ? (c.cust_name || (c.cliente && c.cliente.cust_name) || '') : '', mensaje: msg.mensaje };
  }
  if (c.tipo === 'prospecto') {
    const vendedor = (c.prospecto && c.prospecto.vendedor) || '';
    const ajeno = vendedor && usuarioActual && vendedor !== usuarioActual;
    return { accion: ajeno ? 'bloquear' : 'usar_prospecto', tipo: 'prospecto', prospecto: c.prospecto || null, mensaje: msg.mensaje };
  }
  return { accion: 'crear', tipo: 'libre', mensaje: '' };
}

// Que renderiza el camino "Ya lo conozco" tras teclear: recientes (query corta),
// la lista de resultados, o la oferta de crear el contacto (sin resultados, AC).
export function decidirVistaTrasBusqueda(query, resultados) {
  if (String(query || '').trim().length < 2) return 'recientes';
  return (resultados && resultados.length) ? 'resultados' : 'crear';
}

// Decision ante el 409 de POST /api/prospectos, por el campo estructurado `tipo`
// del server (#82) -- NUNCA parseando el string de error (el mensaje de "es un
// cliente" contiene la palabra "prospecto"; cualquier regex se rompe con el copy).
// Sin tipo reconocible se bloquea: fail-safe, no se crea un contacto fantasma
// sobre un estado desconocido.
export function accionProspecto409(data) {
  const d = data || {};
  if (d.tipo === 'cliente') {
    return { accion: 'cotizar_cliente', cust_name: d.cust_name || '', mensaje: d.error || 'Este celular ya es un cliente en Operam' };
  }
  if (d.tipo === 'prospecto_propio') {
    return { accion: 'usar_prospecto', prospecto: d.prospecto || null, mensaje: d.error || '' };
  }
  return { accion: 'bloquear', mensaje: d.error || 'No se pudo guardar el contacto' };
}

// Pais del contacto a partir del codigo de marcado del select. +1 y +1-CA
// comparten el codigo real +1 pero son paises distintos: el CP canadiense
// (K1A 0A9) solo valida con pais CA (cpValido, #71). "Otro" y vacio caen a MX
// (default del negocio; el select de pais de entrega solo tiene MX/US/CA).
export function paisDesdeCodigoTelefono(code) {
  if (code === '+1') return 'US';
  if (code === '+1-CA') return 'CA';
  return 'MX';
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
