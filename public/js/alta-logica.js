// Logica pura del flujo de alta de cliente (CSF, diff fiscal, payload de alta).
// Modulo sin efectos secundarios de navegador -- importable tanto desde app.js
// (ESM nativo en el browser) como desde los tests (.cjs via import() dinamico).
// Existe para que ambos lados consuman la MISMA implementacion en vez de mantener
// copias espejo que pueden divergir (ver architecture-review-cotizador-20260606.html).

import { cpValido } from './cotizar-logica.js';
import { esRegimenValido, tipoPersonaRfc } from './regimen-fiscal-logica.js';
import { llaveCelularOrigen } from './origen-logica.js';

// Case-insensitive y sin acentos (NFD): pliega mayusculas y diacriticos para
// que dos grafias del mismo nombre (con o sin acento) comparen igual.
// UN solo pliegue de texto para todo el cotizador (issue #292): antes habia dos
// copias casi identicas (esta y normalizarBusqueda de cotizaciones-logica.js,
// #146) mas comparaciones literales en mezclarResultadosBusqueda e
// indice-telefonos.js que se perdian resultados con acentos de cualquier lado.
// Vive aqui (y no en cotizaciones-logica.js) porque alta-logica.js ya es el
// nucleo que server.js y lib/ cross-importan (mismo patron que
// regimen-fiscal-logica.js con server.js/app.js): los modulos de public/js
// nunca importan de lib/, pero lib/ SI importa de public/js.
export function normalizarBusqueda(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

// === Formato unificado "RAZON SOCIAL (Nombre corto)" (issue #196) ===
//
// UN helper puro de TEXTO (no HTML) para toda superficie que identifica a un
// cliente de Operam por nombre -- ninguna pantalla concatena su propio
// parentesis. Omite el parentesis cuando el nombre corto esta vacio o es
// igual al nombre bajo normalizacion ligera LOCAL (minusculas, sin acentos,
// espacios colapsados): NO se importa normalizarNombre de
// lib/deduplicacion.js (los modulos de public/js son browser-safe y no
// importan de lib/, regla documentada en pipeline-logica.js). Esa misma regla
// de igualdad protege a prospectos y contactos nuevos, cuyo `ref` se rellena
// con el propio nombre (clienteDesdeProspecto, buildClienteDesdeContactoNuevo):
// el helper puede aplicarse sin riesgo a cualquier fila, aunque las filas de
// tipo prospecto en los listados de busqueda no lo usan (no tienen cust_ref
// real). El escape HTML sigue siendo responsabilidad del render que consume
// el texto (escapeHtml en el punto de pintado) -- este helper NUNCA produce HTML.
function normalizarNombreLigero(valor) {
  return normalizarBusqueda(valor).replace(/\s+/g, ' ');
}

export function nombreConCorto(nombre, nombreCorto) {
  const n = String(nombre || '').trim();
  const corto = String(nombreCorto || '').trim();
  if (!corto) return n;
  if (normalizarNombreLigero(corto) === normalizarNombreLigero(n)) return n;
  return `${n} (${corto})`.trim();
}

export const CSF_DATOS_VACIOS = {
  rfc: '', razonSocial: '', nombreCorto: '', idcif: '', regimenFiscal: '',
  calle: '', numExt: '', numInt: '', colonia: '', cp: '', municipio: '', estado: '',
  actividades: [], csf_fecha: '',
};

// El endpoint centralizado puede responder ok:false (sin RFC detectado). A diferencia del
// parser viejo (que nunca fallaba), no queremos dejar al usuario sin salida -- siempre se
// devuelve success con un objeto datos completo (vacio si no hubo deteccion) para captura
// y edicion manual (issue #34).
export function altaCsfResultadoParseo(respuestaInterpretada, fileName, resultadoQR = null) {
  if (respuestaInterpretada && respuestaInterpretada.datos) {
    const datos = { ...CSF_DATOS_VACIOS, ...respuestaInterpretada.datos };
    const viaQR = resultadoQR === RESULTADO_QR.OK ? ' (leido del codigo QR del SAT)' : '';
    return {
      status: 'success',
      datos,
      bannerText: `${fileName} -- RFC: ${datos.rfc || '(no detectado)'}${viaQR}`,
    };
  }
  return {
    status: 'success',
    datos: { ...CSF_DATOS_VACIOS },
    bannerText: `${fileName} -- ${motivoCsfSinRfc(resultadoQR)}`,
  };
}

// EL vocabulario de como le fue al QR, en un solo lugar: lo produce app.js (que
// no es importable en Node) y lo consume el banner de aqui, asi que si cada lado
// escribiera sus propias cadenas un typo pasaria la suite entera. Mismo patron
// que estado-cliente-logica.js con los estados del Cliente Operam.
export const RESULTADO_QR = {
  OK: 'ok',
  SIN_LECTOR: 'sin-lector',
  SIN_CODIGO: 'sin-codigo',
  SIN_RESPUESTA: 'sin-respuesta',
  SIN_RFC: 'sin-rfc',
};

// El respaldo por QR fallaba en SILENCIO (issue #378): el vendedor leia "RFC no
// detectado" sin saber si el QR se habia intentado siquiera. El banner ahora
// nombra la via que fallo, porque cada una se corrige distinto -- volver a
// escanear la constancia, recargar la pagina, o esperar al SAT. Ningun mensaje
// afirma nada del texto del PDF salvo el ultimo, que es el unico caso en que se
// sabe que las DOS vias se agotaron.
function motivoCsfSinRfc(resultadoQR) {
  if (!resultadoQR) return 'RFC no detectado, captura los datos manualmente';
  if (resultadoQR === RESULTADO_QR.SIN_LECTOR) {
    return 'RFC no detectado: no se pudo cargar el lector de codigos QR, captura los datos manualmente';
  }
  if (resultadoQR === RESULTADO_QR.SIN_CODIGO) {
    return 'RFC no detectado: el PDF no trae un codigo QR del SAT, captura los datos manualmente';
  }
  if (resultadoQR === RESULTADO_QR.SIN_RESPUESTA) {
    return 'RFC no detectado: el SAT no respondio la consulta del codigo QR, captura los datos manualmente';
  }
  return 'RFC no detectado: ni el texto del PDF ni el codigo QR del SAT dieron el RFC, captura los datos manualmente';
}

// === Cuando ir al QR del SAT (issue #378) ===
//
// pdf.js devuelve items de texto vacios en una CSF cuyos glifos son trazos
// vectoriales; unos pocos caracteres (numeros de pagina, sellos) tampoco son una
// constancia legible. El umbral de 50 caracteres es el que trae el flujo desde
// #28: un texto mas corto que eso nunca ha producido un RFC.
export function csfTieneCapaDeTexto(itemsTotal, texto) {
  return itemsTotal > 0 && String(texto || '').trim().length >= 50;
}

// El QR es la fuente oficial y la mas robusta, pero consultarlo pega al servidor
// del SAT: se intenta SOLO cuando el PDF no dio RFC. Antes de #378 la condicion
// era "el PDF no trae texto", asi que una constancia CON texto que el parser no
// supiera leer terminaba en captura manual sin intentar la via buena.
export function csfDebeIntentarQR({ hayCapaDeTexto, rfcDetectado }) {
  if (!hayCapaDeTexto) return true;
  return !rfcDetectado;
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
export function quitarUnoLiderNacional(tel) {
  const digitos = tel.replace(/\D/g, '');
  if (digitos.length === 11 && digitos.startsWith('1')) {
    return tel.replace(/^\s*1[\s-]*/, '');
  }
  return tel;
}

// === Reglas nacionales por codigo de marcado (issue #176) ===
//
// UNA sola tabla para las dos rejas duras del sistema: validarTelefono (lo que
// el formulario deja capturar) y telefonoValido (lib/seguimiento.js, que solo
// ve el string ya compuesto). Antes cada una tenia su propia verdad de largo y
// un "+52" de 8 digitos pasaba por la segunda.
// `digitos` = largo nacional exacto. `primerDigito` = regla ESTRUCTURAL, no de
// metadata fina: el nacional mexicano empieza entre 2 y 9 desde la reforma del
// IFT de 2019 (Comunicado 34/2019), asi que atrapa capturas basura sin caducar
// como caducaria una copia vendoreada de libphonenumber
// (docs/investigacion-validacion-telefono.md).
export const REGLAS_TELEFONO = {
  52: { digitos: 10, primerDigito: /^[2-9]/, mensajePrimerDigito: 'El numero mexicano debe empezar entre 2 y 9 despues del +52' },
  1: { digitos: 10 },
};

const CODIGOS_MARCADO = Object.keys(REGLAS_TELEFONO).sort((a, b) => b.length - a.length);

// Los numeros mexicanos arrastran el "1" de movil heredado (+52 1 55 xxxx xxxx)
// y los +1 el "1" del codigo de pais. Con 11 digitos nacionales que empiezan en
// 1, ese 1 sobra: ningun nacional mexicano real empieza con 1. Normalizar (no
// relajar la reja) es lo que rescata los 11 legacy del export de Bitrix.
export function nacionalSinUnoLider(digitos) {
  return (digitos.length === 11 && digitos.startsWith('1')) ? digitos.slice(1) : digitos;
}

// Digitos nacionales de un numero internacional cuyo codigo de pais SI esta en
// la tabla; null cuando no lo esta (el resto del mundo se valida solo por largo
// total, que es lo unico que este modulo sabe de ellos).
export function partirPorCodigoPais(digitos) {
  for (const dial of CODIGOS_MARCADO) {
    if (digitos.startsWith(dial)) return { dial, nacional: nacionalSinUnoLider(digitos.slice(dial.length)) };
  }
  return null;
}

export function errorReglaNacional(dial, nacional) {
  const regla = REGLAS_TELEFONO[dial];
  if (!regla) return null;
  if (nacional.length !== regla.digitos) {
    return `El numero debe tener ${regla.digitos} digitos despues del codigo +${dial} (tiene ${nacional.length})`;
  }
  if (regla.primerDigito && !regla.primerDigito.test(nacional)) return regla.mensajePrimerDigito;
  return null;
}

// Espejo de quitarUnoLider para el numero que YA viene en formato
// internacional (issue #176): el widget entrega E.164 y ese camino devolvia el
// telefono tal cual, asi que el "1" legacy sobrevivia hasta el valor guardado.
// Solo aplica a +52 (donde el 1 es basura heredada); en +1 el 1 ES el codigo de
// pais. Conserva el formato del resto del numero.
export function quitarUnoLiderInternacional(telefono) {
  const tel = (telefono || '').trim();
  if (!tel.startsWith('+')) return tel;
  const digitos = tel.replace(/\D/g, '');
  if (!digitos.startsWith('52')) return tel;
  const nacional = digitos.slice(2);
  if (!(nacional.length === 11 && nacional.startsWith('1'))) return tel;
  return tel.replace(/^(\+\s*52[\s-]*)1[\s-]*/, '$1');
}

export function combinarTelefonoConCodigo(code, phone) {
  const tel = (phone || '').trim();
  if (!tel) return '';
  if (tel.startsWith('+')) return quitarUnoLiderInternacional(tel);
  const prefijo = (code || '').replace(/-CA$/, '');
  if (!prefijo || prefijo === '+') return tel;
  return `${prefijo} ${quitarUnoLiderNacional(tel)}`;
}

// Validacion dura de telefono con codigo de pais. Para +52/+1/+1-CA el numero
// nacional debe tener exactamente 10 digitos. Para "Otro" (+) el vendedor debe
// capturar el numero internacional completo empezando con + (8-15 digitos).
// Si el numero ya trae +, se valida por longitud total y el select se ignora.
// El piso son 8 y no 11 (issue #175): 11 asumia un nacional de 10 digitos, la
// regla de MX/US/CA y no la del mundo -- un nacional de 7 (Aruba, los fijos de
// Panama) suma 10 con su codigo de pais y quedaba rechazado. El "+" inicial
// sigue siendo obligatorio: sin el no se sabe de que pais es el numero.
// Sobre el largo se aplica la regla nacional del pais cuando su codigo esta en
// REGLAS_TELEFONO (issue #176): para +52 el nacional debe ser de 10 digitos que
// empiezan entre 2 y 9. Los paises fuera de la tabla se siguen validando solo
// por largo total -- el aviso fino de esos lo da el widget en el navegador, que
// nunca bloquea.
export function validarTelefono(code, phone) {
  const tel = (phone || '').trim();
  if (!tel) return 'El telefono es obligatorio (con codigo de pais)';
  const digitos = tel.replace(/\D/g, '');
  if (tel.startsWith('+') || (code || '') === '+' || !code) {
    if (!tel.startsWith('+') || digitos.length < 8 || digitos.length > 15) {
      return 'Captura el numero completo con codigo de pais (ej. +52 55 1234 5678)';
    }
    const partes = partirPorCodigoPais(digitos);
    return partes ? errorReglaNacional(partes.dial, partes.nacional) : null;
  }
  return errorReglaNacional(code.replace(/-CA$/, '').replace('+', ''), nacionalSinUnoLider(digitos));
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
// viejo (que usaba ids de DOM como cl-razon-social). bodyDesdeDiffFiscal(diff) traduce
// esas llaves a las de escritura y el resultado va al PUT /customers/:id de Operam: si la
// llave fuera un id de DOM, el PATCH mandaria campos que Operam no reconoce. Usar nombres
// de campo Operam es lo correcto para que el PATCH actualice algo real (ver ralph-progress.txt).
// `operam` es la llave canonica del campo en el diff Y el nombre que devuelve el GET.
// `write` y `read` la corrigen donde Operam usa nombres distintos para escribir y para
// leer (issue #169, sondeo en vivo sobre el cliente 491 con Operam 3.26.32):
//   - el PUT IGNORA en silencio `CustName` y solo persiste el nombre con `cust_name`
//     (la misma llave del POST de creacion, ver buildClienteBody);
//   - el GET de detalle NO devuelve `cfdi_regimen_fiscal`: expone el regimen como
//     `regimen`, asi que verificar contra la llave de escritura reportaba un rechazo
//     que nunca ocurrio.
// `read` cae de vuelta a `operam` cuando el objeto no trae la llave alterna: el mismo
// calcularDiffFiscal corre contra el detalle del GET y contra el listado de clientes,
// que no siempre coinciden en la forma. `read` acepta un path con punto (ej.
// 'segmento.id') para llaves anidadas -- el GET no expone `segmento_id` plano, lo
// devuelve como objeto `segmento: { id, clave, description }` (issue #172).
//
// Segmento no tiene workaround de escritura EN LA API v3 (issue #172, sondeo en vivo
// 2026-08-17, clientes 491/492, Operam 3.26.32): a diferencia de dimension_id/
// dimension2_id (que el POST ignora pero un PUT dedicado posterior si persiste),
// segmento_id NO persiste por NINGUN camino de la API -- ni POST, ni PUT bundleado, ni
// PUT dedicado en solitario, ni nombres de campo alternos (segment_id, id_segmento,
// sales_segment_id, segmento plano o anidado). Quien lo escribe es el post-fix por la
// web legacy (actualizarSegmentoClienteWeb en lib/operam-web.js), que el upgrade fiscal
// corre tras el PUT y antes de la relectura. El campo se queda en DIFF_FISCAL_CAMPOS
// porque sigue siendo la forma de verificarlo: si tampoco el post-fix lo aplico, la
// relectura lo reporta como no aplicado (ver camposNoAplicados) con el motivo real y el
// vendedor lo ajusta a mano en la UI de Operam. Detalle en peltre-operam.md seccion 12.5c.
// Uso de CFDI: UN solo campo (#alta-uso-cfdi) para los dos modos del panel, pero
// el default depende del modo (issue #193). Antes habia tres selectores -- uno por
// pestana de la Seccion 1 (default S01, leido solo por el upgrade) y otro en la
// Seccion 2 (default G03, leido solo por el alta) -- asi que el alta guardaba un uso
// de CFDI DISTINTO del que el vendedor habia visto en pantalla. Al consolidarlos, el
// default se elige al abrir el panel para que lo mostrado y lo enviado coincidan:
//   - alta completa: G03 (gastos en general), el default historico de la Seccion 2;
//   - upgrade fiscal: S01, el mismo que DIFF_FISCAL_CAMPOS fuerza en el PUT (regla 2
//     de #95) -- mostrar G03 ahi haria ver un valor que el PUT no manda.
// El argumento es altaCsfState.modoUpgrade: un customer_id o null. El modo lo decide
// la PRESENCIA del id, no su verdad.
export const USO_CFDI_DEFAULT_ALTA = 'G03';
export const USO_CFDI_DEFAULT_UPGRADE = 'S01';

export function usoCfdiPorDefecto(modoUpgrade) {
  return modoUpgrade != null ? USO_CFDI_DEFAULT_UPGRADE : USO_CFDI_DEFAULT_ALTA;
}

// Reapertura del panel de alta (issue #192). El panel es un solo nodo del DOM y su
// estado vive en memoria: hasta #192 nada lo limpiaba, asi que reabrir "Nuevo cliente"
// tras un alta exitosa dejaba el boton muerto Y -- si se hubiera podido pulsar --
// habria aplicado la config comercial, el segmento y el domicilio del cliente NUEVO
// encima del customer_id del ANTERIOR (POST /api/crear-cliente trata customer_id como
// "cliente ya conocido" y se salta la creacion).
//
// La distincion que hace este nucleo es la unica delicada: un alta COMPLETADA deja
// rastro que hay que tirar, pero un alta A MEDIAS es exactamente lo que el borrador
// persistente (#185) restaura a proposito -- vaciar a ciegas lo romperia. Un alta que
// FALLO tras crear el cliente tambien se conserva: ahi customer_id no es rastro viejo,
// es el destino legitimo de "Reintentar" (sin el, el reintento crearia un duplicado).
// Devuelve tambien `reiniciado` porque el DOM (pasos, botones, avisos) solo se limpia
// cuando el estado se limpio.
export function estadoAltaAlAbrirPanel(estado) {
  const base = estado || {};
  if (!base.altaCompletada) return { estado: base, reiniciado: false };
  return {
    estado: {
      ...base,
      customer_id: null,
      branch_id: null,
      clienteExistente: null,
      datos: null,
      domicilio: null,
      modo: null,
      // La linea base de la Seccion 2 del cliente reutilizado (#371) es rastro del
      // alta anterior igual que customer_id: heredarla podaria la Seccion 2 del
      // PROXIMO cliente contra la configuracion del que ya se dio de alta.
      comercialReutilizado: null,
      seccionAbierta: null,
      altaCompletada: false,
      usoCfdiElegido: false,
    },
    reiniciado: true,
  };
}

// `noLegible` marca los campos que Operam NO devuelve en NINGUNA lectura de la API v3
// (medido en vivo 2026-09-15, cliente 522, Operam 3.26.36: el detalle GET /customers/:id
// y el listado por ?tax_id= traen EXACTAMENTE las mismas 43 llaves, y ni idcif ni
// invoice_email estan entre ellas; no hay "ficha recortada" que releer). Es la regla de
// #169 vista desde el otro lado: ahi las llaves de escritura y de lectura son distintas,
// aqui la de lectura no existe. Esos campos SI se escriben -- van en el PUT como
// cualquier otro y el eco es su unica verificacion -- pero no se pueden COMPARAR, asi
// que calcularDiffFiscal no finge un valor anterior: los saca marcados y el panel lo
// dice (#373; hasta ahi el vendedor leia "IdCIF (SAT): (vacio) -> 15070019293" sobre un
// cliente que si lo tenia).
export const DIFF_FISCAL_CAMPOS = [
  { operam: 'CustName',            csf: 'razonSocial',   label: 'Razon Social', write: 'cust_name' },
  { operam: 'tax_id',              csf: 'rfc',           label: 'RFC' },
  { operam: 'cust_ref',            csf: 'nombreCorto',   label: 'Nombre corto' },
  { operam: 'timbrado_uso_cfdi',   csf: 'usoCfdi',        label: 'Uso de CFDI', default: 'S01' },
  { operam: 'invoice_email',       csf: 'invoiceEmail',   label: 'Email de facturacion', noLegible: true },
  { operam: 'segmento_id',         csf: 'segmentoId',     label: 'Segmento', read: 'segmento.id' },
  { operam: 'sales_type',          csf: 'salesType',      label: 'Lista de precios' },
  { operam: 'idcif',               csf: 'idcif',         label: 'IdCIF (SAT)', noLegible: true },
  { operam: 'street',              csf: 'calle',         label: 'Calle' },
  { operam: 'street_number',       csf: 'numExt',        label: 'Numero Exterior' },
  { operam: 'suite_number',        csf: 'numInt',        label: 'Numero Interior' },
  { operam: 'district',            csf: 'colonia',       label: 'Colonia' },
  { operam: 'postal_code',         csf: 'cp',            label: 'Codigo Postal' },
  { operam: 'city',                csf: 'municipio',     label: 'Municipio' },
  { operam: 'state',               csf: 'estado',        label: 'Estado' },
  { operam: 'cfdi_regimen_fiscal', csf: 'regimenFiscal', label: 'Regimen Fiscal', read: 'regimen' },
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

// Exportada desde #366: lib/alta-cliente.js compara la configuracion comercial de
// un Cliente Operam reutilizado con la MISMA regla de lectura (#169), sin copiar
// la tabla.
export function leerValorOperam(clienteOperam, { operam, read }) {
  const alterno = read
    ? read.split('.').reduce((v, k) => (v == null ? undefined : v[k]), clienteOperam)
    : undefined;
  return alterno == null ? clienteOperam[operam] : alterno;
}

export function calcularDiffFiscal(clienteOperam, csfDatos) {
  const diff = {};
  for (const campo of DIFF_FISCAL_CAMPOS) {
    const nuevoValor = resolverValorNuevo(campo, csfDatos);
    if (nuevoValor === undefined) continue;
    const { operam, label } = campo;
    const leido = leerValorOperam(clienteOperam, campo);
    const anterior = String(leido == null ? '' : leido).trim();
    const nuevo = String(nuevoValor).trim();
    // Lo que Operam no expone en lectura no se compara (#373): con valor capturado la
    // fila SALE SIEMPRE -- este diff es el cuerpo del PUT del panel (bodyDesdeDiffFiscal
    // en el PATCH) y el dato tiene que llegar a Operam -- y viaja marcada para que el
    // panel no invente el valor anterior. Sin valor capturado no hay nada que escribir.
    if (campo.noLegible) {
      if (nuevo) diff[operam] = { anterior, nuevo, label, noLegible: true };
      continue;
    }
    if (anterior !== nuevo) {
      diff[operam] = { anterior, nuevo, label };
    }
  }
  return diff;
}

// Lo que el panel de diff del dedup por RFC puede ofrecerle a Operam (issue #248).
// Hasta aqui el panel del ALTA COMPLETA comparaba contra `altaState.datos` CRUDO, que
// mezcla lo que si viene de la CSF con defaults del formulario y con campos de
// secciones que el vendedor todavia no puede tocar, y los presentaba a todos como
// "datos fiscales de la CSF". Como "Confirmar y actualizar en Operam" es todo-o-nada,
// esas filas arrastraban escrituras que nadie pidio (visto en vivo sobre el cliente 15):
//   - Uso de CFDI: el select nace en USO_CFDI_DEFAULT_ALTA (G03) y altaFijarDefaultUsoCfdi
//     lo escribe por JS, que no dispara `change`, asi que el diff ofrecia pisarle su S01.
//     Misma regla que usoCfdiParaPayload (#250): un default es la pregunta, no la
//     respuesta -- solo viaja lo que el vendedor cambio a proposito.
//   - Segmento: vive en la Seccion 2, BLOQUEADA mientras corre la dedup, asi que su
//     vacio no significa "borralo" (vacio-no-viaja, #197). Sale SIEMPRE, tambien con
//     valor: este camino no tiene con que escribirlo -- el PATCH no invoca el post-fix
//     web y la API v3 no persiste segmento_id por ningun camino (#172) -- y ofrecer una
//     escritura que jamas ocurre es peor que no ofrecerla.
//   - Lista de precios: el otro campo de la Seccion 2 (#372), por el mismo motivo. La
//     API v3 SI la escribe, y justamente por eso su vacio es peligroso: Operam lo
//     guarda como 0 y el cliente se queda sin lista (clienteSinListaPrecios, #285).
//     Tambien sale siempre: la configuracion comercial se captura en la Seccion 2, no
//     en el panel de la CSF.
// Se quita la LLAVE, no su valor: resolverValorNuevo distingue ausente de vacio, y un
// vacio con `default` caeria justo en el G03 que este ticket saca del diff.
export function datosFiscalesDelDedup(csfDatos, { usoCfdiElegido = false } = {}) {
  const salida = { ...(csfDatos || {}) };
  const llaveCsf = operam => DIFF_FISCAL_CAMPOS.find(c => c.operam === operam).csf;
  delete salida[llaveCsf('segmento_id')];
  delete salida[llaveCsf('sales_type')];
  if (!usoCfdiElegido) delete salida[llaveCsf('timbrado_uso_cfdi')];
  return salida;
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
    body[campo.write || campo.operam] = nuevoValor;
  }
  // notasActuales === null significa que la relectura previa FALLO: no sabemos que
  // notas tiene el cliente y mandar notes reconstruido desde vacio las pisaria. Se
  // omite notes; la verificacion post-PUT reporta el Tax ID/actividades como no aplicados.
  if (notasActuales !== null) {
    let notas = notasActuales;
    let tocoNotas = false;
    const conTax = buildNotasConTaxId(notas, csfDatos.taxIdExtranjero);
    if (conTax !== undefined) { notas = conTax; tocoNotas = true; }
    const conActividades = buildNotasConActividades(notas, csfDatos.actividades, csfDatos.csf_fecha);
    if (conActividades !== undefined) { notas = conActividades; tocoNotas = true; }
    if (tocoNotas) body.notes = notas;
  }
  return body;
}

// Motivo real del rechazo (issue #169): el PUT de Operam responde con el ECO de los
// campos que acepto -- lo enviado que no vuelve en la respuesta es exactamente lo que
// ignoro (verificado en vivo: `CustName` y `segmento_id` no vuelven y no se aplican;
// `cust_name`, `notes` y el domicilio fiscal si vuelven y si se aplican).
//
// El eco tambien ABSUELVE, y es la UNICA verificacion posible de los campos noLegible
// (#373): ninguna lectura de la API v3 devuelve idcif ni invoice_email, asi que entran
// al diff siempre que se capturen -- no hay con que compararlos -- aunque el PUT los
// haya escrito. Un campo que Operam confirmo en su propia respuesta no se le reporta al
// vendedor como no aplicado: seria ruido permanente sobre una escritura que si ocurrio.
const MOTIVO_IGNORADO = 'Operam ignoro este campo en el PUT (no lo devolvio en la respuesta)';

const LLAVE_ESCRITURA = DIFF_FISCAL_CAMPOS.reduce((acc, { operam, write }) => {
  acc[operam] = write || operam;
  return acc;
}, {});

// Body del PUT a partir de un diff de calcularDiffFiscal (panel "Confirmar y actualizar
// en Operam" del dedup por RFC). Las llaves del diff son de LECTURA, asi que hay que
// traducirlas antes de escribir: mandar `CustName` deja el nombre sin cambiar (#169).
export function bodyDesdeDiffFiscal(diff) {
  const body = {};
  for (const [campo, { nuevo }] of Object.entries(diff)) {
    body[LLAVE_ESCRITURA[campo] || campo] = nuevo;
  }
  return body;
}

// Vaciar la configuracion comercial NO viaja por el diff (#372). Los dos campos de la
// Seccion 2 son los que Operam coerciona a 0 cuando llegan vacios (#285): un
// `sales_type: ''` deja al cliente sin lista de precios y un `segmento_id: ''` le borra
// el segmento. `actualizarClienteDirecto` ya los deja en tierra en el punto de escritura
// (sinCamposCoercionables), pero el diff seguia contandolos como enviados y la
// verificacion por eco se los reportaba al vendedor como "Operam ignoro este campo": es
// falso -- nunca viajaron -- y le pide corregir algo que esta bien (misma leccion de
// #379). Podarlos ANTES del PUT deja las dos cosas dichas en un solo lugar: lo que se
// manda y el motivo real de lo que no.
// Solo frena el VACIO: un segmento o una lista con valor siguen viajando igual.
export const MOTIVO_COMERCIAL_VACIO = 'No se envio a Operam: vaciar este campo borraria la configuracion comercial del Cliente Operam (el vacio se guarda como 0). Se captura en la Seccion 2 o en la ficha del Cliente Operam.';

// Misma lista que CAMPOS_QUE_OPERAM_COERCIONA_A_CERO (lib/operam-client.js): este
// modulo va al navegador y no puede importarla; si Operam coerciona un tercer campo,
// se agrega en las DOS.
const COMERCIAL_VACIO_NO_VIAJA = ['segmento_id', 'sales_type'];

export function diffSinVaciadosComerciales(diff) {
  const enviable = {};
  const ignorados = [];
  for (const [campo, d] of Object.entries(diff || {})) {
    const nuevo = d && typeof d === 'object' ? d.nuevo : undefined;
    if (COMERCIAL_VACIO_NO_VIAJA.includes(campo) && String(nuevo == null ? '' : nuevo).trim() === '') {
      ignorados.push({
        campo,
        label: (d && d.label) || DIFF_FISCAL_LABELS[campo] || campo,
        anterior: d && d.anterior,
        nuevo,
        motivo: MOTIVO_COMERCIAL_VACIO,
      });
      continue;
    }
    enviable[campo] = d;
  }
  return { enviable, ignorados };
}

export function camposNoAplicados(diff, ecoPut) {
  const eco = ecoPut && typeof ecoPut === 'object' ? ecoPut : {};
  return Object.entries(diff)
    .filter(([campo]) => !((LLAVE_ESCRITURA[campo] || campo) in eco))
    .map(([campo, d]) => ({ campo, label: d.label, anterior: d.anterior, nuevo: d.nuevo, motivo: MOTIVO_IGNORADO }));
}

// Respuesta del upgrade fiscal -> lo que el vendedor tiene que ver (#367). Es el
// unico lugar que decide que significo la respuesta; el navegador solo pinta, y
// por eso esto se prueba sin DOM.
//
// Mensaje en dos capas (ADR-0017): por campo viaja el `mensaje` del glosario, que
// se muestra siempre, y el `detalle` tecnico, que va plegado. El motivo crudo
// queda de respaldo para una respuesta que todavia no mande las dos capas.
export const UPGRADE_TITULO_PENDIENTES = 'Datos fiscales actualizados, pero Operam no guardo todo: corrige estos datos en la ficha del cliente en Operam.';
export const UPGRADE_TITULO_LOGRADO = 'Datos fiscales actualizados en Operam.';

// EL texto del RFC que ya es de otro Cliente Operam (#375). Vive aqui porque lo
// comparten el bloqueo del servidor (lib/alta-cliente.js lo cross-importa) y el
// respaldo del navegador, que solo difieren en si conocen al dueno: sin nombre
// ni id sale la misma redaccion sin nombrarlo. "Fusion" es jerga del modulo y se
// queda en el `detalle`. Dice tambien que no se escribio nada, porque lo primero
// que el vendedor no sabia era si el bloqueo habia dejado el cliente a medias.
export function mensajeRfcDeOtroClienteOperam(dueno) {
  const id = dueno?.cliente_id;
  const nombre = dueno?.nombre;
  let quien = 'de otro Cliente Operam';
  if (nombre) quien = id ? `del Cliente Operam ${nombre} (${id})` : `del Cliente Operam ${nombre}`;
  else if (id) quien = `del Cliente Operam ${id}`;
  return `Este RFC ya es ${quien}. No se cambio nada. Si es a quien le estas cotizando, cotiza sobre ese Cliente Operam; si hay dos cuentas del mismo contribuyente, hay que unificarlas a mano en Operam.`;
}

export function interpretarRespuestaUpgrade(status, body) {
  const data = body || {};
  if (status === 409 && data.fusion) {
    return { tipo: 'fusion', mensaje: data.error || mensajeRfcDeOtroClienteOperam(), campos: [], noAplicados: [] };
  }
  if (status !== 200 || data.ok !== true) {
    return { tipo: 'error', mensaje: data.error || 'No se pudo actualizar en Operam', campos: [], noAplicados: [] };
  }
  const pendientes = Array.isArray(data.camposNoActualizados) ? data.camposNoActualizados : [];
  const campos = pendientes.map(c => ({
    label: c.label || c.campo,
    mensaje: c.mensaje || `${c.label || c.campo} no quedo guardado en Operam`,
    detalle: c.detalle || c.motivo || '',
  }));
  return {
    tipo: 'lograda',
    mensaje: campos.length ? UPGRADE_TITULO_PENDIENTES : UPGRADE_TITULO_LOGRADO,
    campos,
    // Las llaves de los campos que NO pegaron: la tarjeta del cliente solo
    // adopta lo que Operam si guardo.
    noAplicados: pendientes.map(c => c.campo),
  };
}

// A que pantalla vuelve el vendedor cuando el upgrade fiscal SI se logro, y si hace
// falta decirselo con todas sus letras (#407). El upgrade se abre por dos puertas:
// el chip Fiscal del paso Cliente (origen 'paso'), que deja la tarjeta de ese paso
// visible detras del panel, y la vista Clientes (origen 'clientes'), que deja ahi
// solo el titulo y "Volver al cliente". Repintar la tarjeta del paso al volver de
// la segunda no se ve, y el reporte calla cuando todo pego: el exito total salia
// como pantalla en blanco, y el vendedor repetia la operacion sin saberlo.
//
// La confirmacion explicita solo se pide cuando el reporte no va a salir: con campos
// pendientes su propio titulo (UPGRADE_TITULO_PENDIENTES) ya dice que paso, y dos
// avisos encimados dirian cosas distintas del mismo PUT.
export function destinoTrasUpgradeLogrado(origen, vista) {
  const enClientes = origen === 'clientes';
  // La confirmacion se ata a la vista LOGRADA, no solo a que no haya campos: una
  // vista de error o de fusion tambien llega sin campos, y su mensaje bajo el verde
  // de exito diria lo contrario de lo que paso.
  const lograda = !!vista && vista.tipo === 'lograda' && ((vista.campos || []).length === 0);
  return {
    pantalla: enClientes ? 'clientes' : 'paso',
    confirmacion: enClientes && lograda ? vista.mensaje : null,
  };
}

// A donde va el vendedor cuando el alta completa SI se logro y pulsa uno de los dos
// botones post-exito, "Cotizar ahora" o "Terminar" (#412). El panel del alta es un
// nodo UNICO que viaja (#376): la vista Clientes lo toma prestado (moverPanelA) y
// hasta #412 esos dos botones solo lo escondian con display:none, asi que el panel
// se quedaba colgado de #clientes-panel-slot mientras el vendedor cotizaba -- pedir
// "Nuevo cliente" en el paso Cliente ya no abria nada hasta recargar -- y la vista
// Clientes quedaba con el encabezado del alta y nada debajo.
//
// Quien decide es esto; app.js devuelve el panel a su casa SIEMPRE (devolverPanelACasa,
// que ademas apaga modoUpgrade y cierra el borrador de la superficie) y pinta la
// pantalla que sale de aqui. La vista Clientes solo se limpia cuando el panel estaba
// prestado ahi: repintarla desde el paso Cliente borraria la busqueda de otro momento.
export function destinoTrasAltaLograda(accion, opciones = {}) {
  const prestado = !!(opciones && opciones.panelEnVistaClientes);
  return {
    pantalla: accion === 'cotizar' ? 'cotizador' : (prestado ? 'clientes' : 'paso'),
    limpiarVistaClientes: prestado,
  };
}

// El puente Operam -> tarjeta. La llave del dato capturado NO se repite aqui: sale
// del mapeo canonico por campo (DIFF_FISCAL_CAMPOS.csf). Lo unico propio de esta
// tabla es como se llama el campo EN LA TARJETA, que Operam no conoce.
const CAMPOS_TARJETA_TRAS_UPGRADE = [
  { operam: 'tax_id', tarjeta: 'rfc' },
  { operam: 'CustName', tarjeta: 'name' },
];

// Lo que la tarjeta del Cliente Operam adopta del upgrade recien escrito: solo los
// campos que Operam SI guardo (quirk #74 -- el PUT ignora algunos en silencio y los
// reporta en camposNoActualizados). Un valor vacio no borra el que ya tenia: el
// vendedor puede subir una CSF sin tocar el nombre.
export function camposClienteOperamTrasUpgrade(datos, noAplicados) {
  const d = datos || {};
  const no = noAplicados || [];
  const cambios = {};
  for (const { operam, tarjeta } of CAMPOS_TARJETA_TRAS_UPGRADE) {
    if (no.includes(operam)) continue;
    const llave = DIFF_FISCAL_CAMPOS.find(c => c.operam === operam)?.csf;
    const valor = llave ? d[llave] : undefined;
    if (valor) cambios[tarjeta] = valor;
  }
  return cambios;
}

// Resultado del panel "Confirmar y actualizar en Operam" del dedup por RFC (#248).
// Hasta aqui el panel pintaba "Datos fiscales actualizados en Operam" pasara lo que
// pasara: el mensaje mentia cuando Operam ignoraba un campo en silencio (quirk #74).
// Consume la MISMA vista de interpretarRespuestaUpgrade que el upgrade fiscal, y por
// eso los dos caminos no pueden discrepar sobre que significo la respuesta. Los
// textos son constantes del modulo y las etiquetas salen de DIFF_FISCAL_CAMPOS: no
// llega dato capturado que haya que escapar (misma regla que buildDiffFiscalHtml).
export function buildDiffFiscalResultadoHtml(vista) {
  const campos = (vista && vista.campos) || [];
  const mensaje = (vista && vista.mensaje) || '';
  if (campos.length === 0) {
    return '<p class="alert alert-success" style="margin:0">' + mensaje + '</p>';
  }
  return '<div class="upgrade-reporte">' +
    '<p class="upgrade-reporte-titulo">' + mensaje + '</p>' +
    '<ul class="operam-pasos">' +
    campos.map(c =>
      '<li class="operam-paso operam-paso-error">' +
      '<strong>' + c.label + ':</strong> ' + c.mensaje +
      (c.detalle
        ? '<details class="operam-paso-detalle"><summary>Ver detalle t&eacute;cnico</summary><div>' + c.detalle + '</div></details>'
        : '') +
      '</li>'
    ).join('') +
    '</ul>' +
    '</div>';
}

// Configuracion comercial en el upgrade fiscal (issue #197). El vendedor VE la
// Seccion 2 durante el upgrade, asi que lo que corrija ahi tiene que viajar; hasta
// #197 se ignoraba en silencio. Tres campos entran (lista de precios, segmento,
// email de facturacion); vendedor y celular quedan fuera por decision del ticket
// (el vendedor vive en la SUCURSAL y PUT /branches es un REPLACE destructivo, #189;
// el celular es la llave de identidad del prospecto).
//
// Los tres se resuelven contra DIFF_FISCAL_CAMPOS, que ya es el UNICO mapeo
// lectura/escritura del cliente: `sales_type` se lee y se escribe con la misma
// llave (verificado en vivo, cliente 491: llega como id plano en string, "15" =
// M100), el segmento se lee anidado (`segmento.id`) y se escribe por el post-fix
// web, e `invoice_email` no es legible por el GET y solo lo confirma el eco del PUT.
const COMERCIAL_UPGRADE = ['sales_type', 'segmento_id', 'invoice_email'];

// Valores ACTUALES del cliente con los que se abre la Seccion 2 (decision 1 de
// #197). Sin esta precarga la feature seria un arma: mandar los campos con su
// default pisaria en Operam datos reales que el vendedor nunca vio.
// El email de facturacion se precarga SIEMPRE vacio -- el GET de detalle no lo
// expone, y precargarlo desde cualquier otra superficie le haria creer al vendedor
// que ese es el correo guardado en Operam (misma leccion de fuga de contexto de
// #95). El vendedor va con placeholder explicativo: es de la SUCURSAL, no del
// cliente, y este flujo tiene prohibido escribir branches.
// El uso de CFDI se suma en #371: lo pide el alta completa, donde reutilizar un
// Cliente Operam abria la Seccion 2 con el G03 del selector en vez del que el
// cliente ya tiene. SI es legible (no lleva `noLegible` en DIFF_FISCAL_CAMPOS), y
// sumarlo aqui no cambia el upgrade fiscal: COMERCIAL_UPGRADE -- lo unico que
// datosUpgradeConComercial poda y deja viajar -- no lo incluye.
export function precargaComercialUpgrade(clienteOperam) {
  const cliente = clienteOperam || {};
  const leer = operam => {
    const campo = DIFF_FISCAL_CAMPOS.find(c => c.operam === operam);
    const v = leerValorOperam(cliente, campo);
    return v == null ? '' : String(v);
  };
  return {
    salesType: leer('sales_type'),
    segmentoId: leer('segmento_id'),
    usoCfdi: leer('timbrado_uso_cfdi'),
    invoiceEmail: '',
    vendedorNombre: String(cliente.branches?.[0]?.salesman_name || ''),
  };
}

// Que se puede editar en la Seccion 2 segun el modo del panel (decision 4 de #197).
// En upgrade, dos campos se ven pero NO se escriben:
//   - Vendedor: vive en la SUCURSAL, y PUT /branches es un REPLACE destructivo sobre
//     sucursales ya configuradas (#189, danos reales en #195). Se muestra el actual,
//     leido de branches[0].salesman_name, y se cambia en Operam.
//   - Celular: es la llave de identidad del prospecto (ultimos10); editarlo tiene
//     implicaciones de ligado que no entran en este ticket.
// El email de facturacion si se edita, pero su placeholder cambia: el GET de Operam no
// lo expone, asi que el campo arranca vacio y eso NO significa que el cliente no tenga
// uno. En modo alta todo vuelve a como estaba (el argumento es el customer_id destino
// o null: el modo lo decide la PRESENCIA del id, igual que usoCfdiPorDefecto).
// El acordeon abre una seccion a la vez, pero en el upgrade la Configuracion
// comercial (Seccion 2) queda abierta junto a la que este activa: trae lo que el
// cliente tiene HOY en Operam y el vendedor debe verlo antes de confirmar, sin un
// clic que nada le pide dar (HITL de #396). Bloqueada, no se abre por esta regla.
export function seccionAltaAbierta(n, { seccionAbierta, modoUpgrade, bloqueada } = {}) {
  return seccionAbierta === n || (n === 2 && modoUpgrade != null && !bloqueada);
}

export const EMAIL_FACTURA_PLACEHOLDER_ALTA = 'facturacion@empresa.com';
export const EMAIL_FACTURA_PLACEHOLDER_UPGRADE = '(no visible desde Operam; escribe uno solo si quieres actualizarlo)';

export function modoComercialUpgrade(modoUpgrade, vendedorNombre) {
  if (modoUpgrade == null) {
    return { bloqueado: false, vendedorNota: '', celularNota: '', emailPlaceholder: EMAIL_FACTURA_PLACEHOLDER_ALTA };
  }
  const nombre = String(vendedorNombre || '').trim();
  return {
    bloqueado: true,
    vendedorNota: (nombre ? `${nombre} -- ` : '') + 'el vendedor se cambia en Operam',
    celularNota: 'El celular se edita en el prospecto',
    emailPlaceholder: EMAIL_FACTURA_PLACEHOLDER_UPGRADE,
  };
}

// Solo viaja lo que CAMBIO respecto a lo precargado (decision 2 de #197): los
// campos comerciales se podan de los datos fiscales y vuelven solo si el vendedor
// los movio. Lo que no viaja no se escribe ni se verifica -- misma semantica
// "ausente != vacio" de buildActualizarFiscalPayload -- y ademas ahorra el post-fix
// web del segmento cuando no hubo cambio.
//
// `precargado` tiene TRES estados, y la diferencia importa:
//   - objeto: linea base conocida. Solo viaja lo que difiera de ella.
//   - null: la precarga corrio y FALLO. No viaja nada comercial: sin linea base,
//     "cambio" no significa nada y cualquier valor del panel podria pisar un dato real.
//   - undefined: esta superficie no aporta configuracion comercial. Los datos pasan
//     TAL CUAL. Es el camino de "Actualizar este" sobre un candidato generico
//     (altaCandidatoActualizar, #78): entra al upgrade con lo que el vendedor capturo
//     en el ALTA, donde el segmento SI es captura suya y tiene que viajar (#193).
// Vaciar un campo ya precargado tampoco viaja: los <select> se repueblan desde el
// catalogo (altaEsperarCatalogosCompletos) y eso los resetea a "", asi que un vacio
// que viajara dejaria al cliente sin lista de precios por una carrera del catalogo.
export function datosUpgradeConComercial(datos, precargado, capturado) {
  const salida = { ...(datos || {}) };
  if (precargado === undefined) return salida;
  for (const operam of COMERCIAL_UPGRADE) {
    const { csf } = DIFF_FISCAL_CAMPOS.find(c => c.operam === operam);
    delete salida[csf];
    if (!precargado) continue;
    const nuevo = String((capturado || {})[csf] ?? '').trim();
    const anterior = String(precargado[csf] ?? '').trim();
    if (nuevo && nuevo !== anterior) salida[csf] = nuevo;
  }
  return salida;
}

// Email de facturacion en el upgrade (fix de la revision de #95): el input
// cl-email-factura es GLOBAL del flujo de cotizacion. Solo es confiable cuando el
// upgrade se abrio desde el paso Cliente ('paso'), donde pertenece al mismo cliente
// seleccionado; desde la vista Clientes (#94) puede traer el email de OTRO cliente
// cotizado antes (fuga de contexto) y se descarta.
export function emailFacturaParaUpgrade(origen, valor) {
  if (origen !== 'paso') return undefined;
  const v = String(valor || '').trim();
  return v || undefined;
}

// Validacion de la pestana "Captura manual" (issue #95 regla 4). Decision de
// Adrian: hay clientes que prefieren no compartir su CSF, asi que la captura
// manual debe permitir dar de alta con el domicilio fiscal minimo: Razon Social,
// RFC, Codigo Postal y Regimen Fiscal son los UNICOS obligatorios; calle, numero,
// colonia y estado quedan opcionales (igual que en la tab CSF, que ya los trae del
// PDF). El nombre corto (antes obligatorio en esta pestana) tambien pasa a
// opcional -- no esta en la lista de minimos de la regla 4.
// El regimen fiscal ya no se valida como "no vacio" sino como PERTENENCIA al
// catalogo del SAT (issue #191): mientras fue texto libre, un "6O1" con letra O o
// el codigo pegado junto con su descripcion viajaban literales al POST/PUT de
// Operam, que ni los rechaza ni avisa.
export function validarAltaManualMinimos(datos) {
  const d = datos || {};
  if (!String(d.rfc || '').trim()) return 'El RFC es obligatorio';
  if (!String(d.razonSocial || '').trim()) return 'La razon social es obligatoria';
  if (!String(d.cp || '').trim()) return 'El codigo postal es obligatorio';
  if (!String(d.regimenFiscal || '').trim()) return 'El regimen fiscal es obligatorio';
  if (!esRegimenValido(d.regimenFiscal)) return 'El regimen fiscal no es una clave del catalogo del SAT';
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

// Actividades economicas de la CSF -> notas del cliente (issue #171): mismo patron
// que Tax ID extranjero -- se compone sobre las notas EXISTENTES (nunca se
// sobreescriben notas ajenas: Tax ID, celular, email de facturacion). Si ya existia
// una seccion de una CSF anterior (misma firma "Actividades economicas (CSF ...):"
// seguida de bullets "- "), se REEMPLAZA esa seccion en vez de duplicarla -- un
// upgrade repetido (misma CSF u otra mas reciente) no debe acumular secciones.
// undefined si la CSF no trajo actividades -- el caller no debe tocar notes.
// El "(CSF ...)" es opcional en el match: csf_fecha puede venir vacio (CSF sin
// "Fecha de emision") y el encabezado que se escribe en ese caso omite el
// parentesis entero (ver buildNotasConActividades) -- el regex debe reconocer
// ambas formas para reemplazar la seccion sin importar cual se escribio antes.
const RE_SECCION_ACTIVIDADES = /Actividades economicas(?: \(CSF[^)]*\))?:\n(?:- [^\n]*(?:\n|$))*/;

export function buildNotasConActividades(notasActuales, actividades, csfFecha) {
  const lista = (Array.isArray(actividades) ? actividades : []).filter(Boolean);
  if (lista.length === 0) return undefined;
  const encabezado = csfFecha ? `Actividades economicas (CSF ${csfFecha}):` : 'Actividades economicas:';
  const seccion = `${encabezado}\n` + lista.map(a => `- ${a}`).join('\n');
  const actual = String(notasActuales || '').trim();
  if (RE_SECCION_ACTIVIDADES.test(actual)) {
    return actual.replace(RE_SECCION_ACTIVIDADES, seccion);
  }
  return actual ? `${actual}\n${seccion}` : seccion;
}

function etiquetaDiffFiscal(fieldId, label) {
  return label || DIFF_FISCAL_LABELS[fieldId] || fieldId;
}

// Un campo `noLegible` (#373) no se comparo con nada: Operam no lo devuelve en NINGUNA
// lectura de la API v3. Hasta #395 su fila viajaba bajo el encabezado "no coinciden", asi
// que toda CSF con IdCIF abria el panel contra CUALQUIER Cliente Operam afirmando una
// diferencia que nadie pudo medir (HITL 2026-09-18, RFC CARA830713D53 sobre el cliente
// 15) -- y un panel que sale siempre ensena al vendedor a confirmar sin leer, de modo que
// la vez que la diferencia sea real la pasa igual. El campo SE QUEDA en el panel, porque
// el diff ES el cuerpo del PUT (bodyDesdeDiffFiscal) y Confirmar es el unico camino por
// el que el IdCIF llega a Operam desde esta pantalla (#391); lo que cambia es lo que el
// panel DICE: una frase por campo, sin "anterior -> nuevo", con la unica pregunta que el
// vendedor puede contestar. El valor siempre existe (calcularDiffFiscal solo marca el
// campo cuando la CSF trajo algo que escribir). Los signos de apertura van como entidad
// HTML: el codigo es ASCII estricto.
function fraseNoVerificable(fieldId, { nuevo, label }) {
  return '<p class="diff-fiscal-no-verificable">La CSF trae el ' +
    etiquetaDiffFiscal(fieldId, label) + ' ' + nuevo +
    ', que puede ser diferente al registrado en Operam. &iquest;Lo sobrescribimos en Operam?</p>';
}

export function buildDiffFiscalHtml(diff) {
  const campos = Object.keys(diff);
  if (campos.length === 0) return '';
  const mostrar = valor => valor || '(vacio)';
  const noVerificables = campos.filter(fieldId => diff[fieldId].noLegible);
  const reales = campos.filter(fieldId => !diff[fieldId].noLegible);
  const filas = reales.map(fieldId => {
    const { anterior, nuevo, label } = diff[fieldId];
    return '<div class="diff-fiscal-fila">' +
      '<strong>' + etiquetaDiffFiscal(fieldId, label) + ':</strong> ' +
      '<span class="diff-fiscal-anterior">' + mostrar(anterior) + '</span>' +
      ' &rarr; ' +
      '<span class="diff-fiscal-nuevo">' + mostrar(nuevo) + '</span>' +
      '</div>';
  }).join('');
  const bloqueDiferencias = reales.length
    ? '<p class="dedup-alerta-naranja">Los datos fiscales de la CSF no coinciden con los guardados en Operam</p>' + filas
    : '';
  return '<div class="diff-fiscal-panel">' +
    bloqueDiferencias +
    noVerificables.map(fieldId => fraseNoVerificable(fieldId, diff[fieldId])).join('') +
    '<div class="diff-fiscal-acciones">' +
    '<button type="button" class="btn btn-secondary" onclick="altaDiffFiscalConfirmar()">Confirmar y actualizar en Operam</button> ' +
    '<button type="button" class="btn btn-secondary diff-fiscal-btn-descartar" onclick="altaDiffFiscalDescartar()">Descartar y continuar sin actualizar</button>' +
    '</div>' +
    '</div>';
}

// Compone el banner "RFC ya existe" (igual al existente, "Usar este Cliente Operam" SIEMPRE
// disponible -- AC3) + panel de diff fiscal cuando hay diferencias (AC1/AC4). Es
// deliberadamente NO bloqueante: el vendedor puede avanzar con "Usar este Cliente Operam" sin
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
    '<p><strong>' + nombreConCorto(nombre, cliente.cust_ref) + '</strong> (ID: ' + id + ', RFC: ' + rfcC + ')</p>' +
    '<button class="btn btn-secondary" type="button" onclick="altaDedupUsarCliente(' + id + ')">Usar este Cliente Operam</button>' +
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
      '<p><strong>' + nombreConCorto(nombre, c.cust_ref) + '</strong> &middot; ' + senal + '</p>' +
      '<button type="button" class="btn btn-secondary" onclick="altaCandidatoActualizar(' + c.id + ')">Actualizar este</button> ' +
      '<button type="button" class="btn btn-secondary" onclick="altaCandidatoCrearNuevo()">Crear nuevo</button>' +
      '</div>'
    );
  }).join('');
  return '<div class="dedup-candidatos-generico">' +
    '<p class="dedup-alerta-naranja">Este contacto coincide con un Cliente Operam ya existente (dado de alta sin RFC)</p>' +
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
    return { encontrado: true, tipo: 'cliente', mensaje: `Este celular ya tiene Cliente Operam${nombre ? ': ' + nombre : ''}` };
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
// cliente Operam -> su id; cualquier otro tipo (prospecto o contacto nuevo) con
// alta generica ya hecha -> clienteOperamId; sin cliente en Operam todavia -> null
// (#167: el contacto nuevo tambien puede llegar con clienteOperamId ya seteado).
// Fuente unica compartida por el paso Cliente (pcCustomerIdFiscal) y la vista
// Clientes (cvAbrirUpgrade) -- extender, no copiar.
export function customerIdFiscal(cliente) {
  const c = cliente || {};
  if (c.tipo === 'operam') return c.id != null ? c.id : null;
  return c.clienteOperamId != null ? c.clienteOperamId : null;
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
    segmentoId: c.segmentoId || '',
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
    // issue #121: sobrevive a un "Ya lo conozco" -> prospecto en otra sesion (el
    // segmento se guarda en data.segmento_id, OPCIONALES de prospectos-logica.js).
    segmentoId: (p.data && p.data.segmento_id) || '',
  };
}

// Cliente de la tarjeta al elegir una cotizacion de Recientes, y desde #394
// tambien al cargar una del historial (clienteAlCargarCotizacion). Los campos de
// entrega salen de ESA cotizacion, correo incluido; sin `email` aqui la opcion
// "(Contacto)" del selector de entrega no los explicaba y el paso Envio arrancaba
// en "+ Nuevo contacto", y elegirla borraba el correo (#353).
//
// El customerId de la cotizacion se pone en las DOS llaves de identidad (#394)
// porque customerIdFiscal las lee por separado: `id` cuando el tipo es operam
// (lo que una cotizacion con RFC real es) y `clienteOperamId` en los demas. Con
// solo la segunda, una cotizacion con RFC real viajaba sin Cliente Operam --
// para el resto de la pantalla era un cliente de Operam y para lo que se manda
// no lo era.
export function clienteDesdeCotizacionReciente(c) {
  const cl = c || {};
  return {
    tipo: cl.rfc ? 'operam' : 'nuevo',
    id: cl.customerId ?? null,
    name: cl.razonSocial || cl.nombreCorto || '', ref: cl.nombreCorto || '',
    rfc: cl.rfc || '', telefono: cl.telefono || '', email: cl.emailEntrega || '',
    cp: cl.cpEntrega || '', pais: cl.pais || 'MX',
    clienteOperamId: cl.customerId ?? null,
  };
}

// Exportados desde #346: el buscador de la vista Clientes arma sus filas en el
// SERVIDOR y usa ESTOS normalizadores, no una copia con los mismos literales.
export function normalizarOperam(c) {
  return {
    tipo: 'operam', id: c.id, nombre: c.name || '', rfc: c.rfc || '', ref: c.ref || '',
    telefonos: c.telefonos || (c.telefono ? [c.telefono] : []),
    sub: c.rfc || '', raw: c,
    // Los dos estados del Cliente Operam y las etiquetas de su Contacto (#344):
    // los deriva el servidor y la fila los pinta. Viajan en la fila y no solo en
    // `raw` porque el tag los lee ahi (tagResultadoClienteHtml); null cuando la
    // respuesta no los trae -- ahi el tag cae al RFC de la propia fila.
    fiscal: c.fiscal ?? null,
    comercial: c.comercial ?? null,
    etiquetas: c.etiquetas || [],
  };
}

export function normalizarProspecto(p) {
  return {
    tipo: 'prospecto', id: p.id, nombre: p.nombre || '',
    ciudad: p.ciudad || '', celular: p.celular || '', etapa: p.etapa || '',
    sub: [p.ciudad, p.celular].filter(Boolean).join(' - '), raw: p,
  };
}

// Cuando un Contacto responde al texto tecleado: por su nombre, por su ciudad o
// por los digitos de su celular. Lo comparten el buscador mezclado del paso
// Cliente (aqui abajo) y el de la vista Clientes, que desde #346 arma sus filas
// en el SERVIDOR (cross-import de la casa) -- una sola definicion de "este
// Contacto sale en esta busqueda".
export function contactoCoincideBusqueda(contacto, query) {
  const p = contacto || {};
  const q = normalizarBusqueda(query);
  if (q.length < 2) return false;
  const qDigitos = q.replace(/\D/g, '');
  return normalizarBusqueda(p.nombre || '').includes(q) ||
    normalizarBusqueda(p.ciudad || '').includes(q) ||
    (qDigitos.length >= 2 && String(p.celular || '').replace(/\D/g, '').includes(qDigitos));
}

// Un solo buscador que encuentra a la vez clientes de Operam y prospectos del
// vendedor, distinguibles por tipo (AC2). Query < 2 chars -> [] (el caller muestra
// recientes). Operam matchea por razon social, RFC, nombre corto (cust_ref, #97) o
// telefono de cualquier contacto (#97, digitos); el prospecto por nombre, ciudad o
// los digitos del celular. Ordena coincidencias por prefijo antes que internas
// (mezcla los tipos, no los agrupa: "distinguibles" no es "separados").
export function mezclarResultadosBusqueda(clientesOperam, prospectos, query) {
  const q = normalizarBusqueda(query);
  if (q.length < 2) return [];
  const qDigitos = q.replace(/\D/g, '');
  // #421: el RFC se compara SIN espacios de los dos lados, como lo consulta el
  // servidor (normalizarRfc): "GJA 990301 TM7" lo encontraba el servidor y aqui
  // se descartaba.
  const qRfc = q.replace(/\s+/g, '');
  const filas = [
    ...(clientesOperam || []).map(normalizarOperam).filter(r =>
      normalizarBusqueda(r.nombre).includes(q) ||
      normalizarBusqueda(r.rfc).replace(/\s+/g, '').includes(qRfc) ||
      normalizarBusqueda(r.ref).includes(q) ||
      // >=8 digitos (formato "sin lada" en adelante, ver indice-telefonos.js): con
      // menos, un fragmento corto empataria demasiados telefonos del catalogo completo.
      (qDigitos.length >= 8 && r.telefonos.some(t => t.replace(/\D/g, '').includes(qDigitos)))),
    ...(prospectos || []).map(normalizarProspecto).filter(r => contactoCoincideBusqueda(r, query)),
  ];
  return filas.sort((a, b) => {
    const pa = normalizarBusqueda(a.nombre).startsWith(q) ? 0 : 1;
    const pb = normalizarBusqueda(b.nombre).startsWith(q) ? 0 : 1;
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
    // Sin `cotizacionId` desde #409: lo leia pcElegirReciente para cargar esa
    // cotizacion, y ese camino ya no existe -- las dos pantallas de Recientes
    // prellenan la busqueda y resuelven el registro real de Operam por nombre.
    out.push({ nombre: c.cliente, nombreCorto: c.nombreCorto || '', telefono: c.telefono || '', fecha: c.fecha });
    if (out.length >= limite) break;
  }
  return out;
}

// Reexpresion browser-safe de normalizarRfc (lib/deduplicacion.js): mayusculas y
// sin espacios, para que el mismo RFC capturado de dos formas compare igual.
export function llaveRfc(rfc) {
  return String(rfc || '').toUpperCase().replace(/\s+/g, '');
}

// Si un texto libre tiene forma de RFC mexicano (#421): la forma de
// tipoPersonaRfc (12 = moral, 13 = fisica) sobre el texto ya normalizado, asi
// que minusculas y espacios no cuentan. La comparten la busqueda de Clientes
// Operam por texto del servidor (suma el ?tax_id= de Operam, que su ?search= no
// cubre, #194) y la fila "Crear contacto" del paso Cliente (ofreceCrearContacto):
// vive aqui y lib/deduplicacion.js la reexporta (cross-import de la casa).
export function tieneFormaDeRfc(texto) {
  return tipoPersonaRfc(llaveRfc(texto)) !== null;
}

// Las cotizaciones del cliente elegido para el panel "Cotizaciones previas" de la
// tarjeta del paso Cliente (#389). Filtra por IDENTIDAD, nunca por prefijo ni por
// pedazo del nombre: el Cliente Operam que la cotizacion anoto al subirse
// (`data.cliente.customerId`, que GET /api/cotizaciones expone como `customerId`)
// es la respuesta cuando la cotizacion lo tiene -- otro `customerId` es otro
// cliente, aunque se llamen casi igual.
//
// Los respaldos son para la cotizacion que NO lo anoto (las del backfill #76 y las
// anteriores al alta generica): el RFC real EXACTO, que es el mismo contribuyente,
// y el Contacto con el que nacio (`contactoCelular`) contra las casillas de
// telefono del Cliente Operam, por los ultimos 10 digitos. Un RFC generico no
// identifica a nadie (lo comparten los Clientes Operam sin datos fiscales), asi
// que nunca liga.
export function cotizacionesPreviasDelCliente(cotizaciones, cliente) {
  const c = cliente || {};
  const clienteId = c.id != null ? String(c.id) : null;
  const rfcCliente = esRfcGenerico(c.rfc) ? '' : llaveRfc(c.rfc);
  const celulares = new Set(
    (Array.isArray(c.telefonos) && c.telefonos.length ? c.telefonos : [c.telefono])
      .map(llaveCelularOrigen).filter(t => t.length === 10));
  return (cotizaciones || []).filter(cot => {
    if (!cot) return false;
    if (cot.customerId != null) return clienteId !== null && String(cot.customerId) === clienteId;
    const rfcCot = esRfcGenerico(cot.rfc) ? '' : llaveRfc(cot.rfc);
    if (rfcCliente && rfcCot === rfcCliente) return true;
    const cel = llaveCelularOrigen(cot.contactoCelular);
    return cel.length === 10 && celulares.has(cel);
  });
}

// Estado de los chips de completitud de la tarjeta (AC6/#82; tri-estado de
// Entrega extendido en #84), desde datos reales:
//  - Contacto: nombre resoluble (name||ref) Y un telefono que pasa la reja de la
//    generacion (#418: con cualquier digito se ponia verde sobre un numero que
//    igual iba a bloquear).
//  - Entrega: tri-estado -- 'pendiente' (sin CP valido), 'cp' (CP+pais validos,
//    sin Calle) o 'completo' (CP+pais validos y Calle). El domicilio se captura
//    en el paso Envio (#84); Operam ya lo trae con el cliente.
//  - Fiscal: RFC real (presente y NO generico -- el generico ES "pendiente fiscal").
export function chipsCompletitud(cliente) {
  const c = cliente || {};
  const nombre = (c.name || c.ref || '').trim();
  const cp = (c.cp || c.cpEntrega || '').trim();
  const pais = (c.pais || '').trim();
  const calle = (c.calle || '').trim();
  const rfc = (c.rfc || '').toUpperCase().trim();
  const cpOk = !!(cp && pais && cpValido(cp, pais));
  return {
    contacto: !!(nombre && telefonoPasaLaReja(c.telefono)),
    entrega: cpOk ? (calle ? 'completo' : 'cp') : 'pendiente',
    fiscal: !!(rfc && !RFC_GENERICOS_BROWSER.has(rfc)),
  };
}

// El telefono del cliente tal como lo junta el widget (codigo + numero, #176)
// contra la MISMA regla que la reja de la generacion: un numero armado con su
// codigo empieza con '+' y validarTelefono lo juzga completo, sin mirar el
// select; el que no lo trae es el de pais "Otro" tecleado sin codigo, que la
// reja tambien rechaza.
// #427: el numero que llega sin codigo (el texto crudo de Operam en la vista
// Clientes) se completa como lo hace el campo al cargarlo -- separarTelefonoCodigo
// + combinarTelefonoConCodigo: 10 digitos -> +52, 12 que empiezan con 52 -> +52,
// 11 que empiezan con 1 -> +1 -- y el resultado pasa por la misma reja; lo que no
// sabe completar (code '+') sigue pendiente. El que ya trae '+' no se toca, asi
// que en el paso Cliente el veredicto no cambia. La reja REAL de la generacion
// (validarTelefonosCotizacion, app.js) juzga el campo del widget, no esto.
function telefonoPasaLaReja(telefono) {
  const tel = (telefono || '').trim();
  if (!tel) return false;
  if (tel.startsWith('+')) return !validarTelefono('', tel);
  const { code, numero } = separarTelefonoCodigo(tel);
  return !validarTelefono('', combinarTelefonoConCodigo(code, numero));
}

// El chip Contacto se vuelve boton cuando al telefono le falta algo (#418): un
// Cliente Operam sin telefono no tenia por donde capturarlo -- el campo vivia en
// el formulario legacy oculto -- y la reja de la generacion lo mandaba a un campo
// invisible. El nombre que falte no lo captura este chip, por eso solo mira el
// telefono.
export function contactoAccionable(cliente) {
  return !telefonoPasaLaReja((cliente || {}).telefono);
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

// Si la busqueda del paso Cliente ofrece la fila "Crear contacto" (#421,
// decision de Adrian 2026-09-23): siempre, salvo cuando lo tecleado tiene forma
// de RFC y la busqueda ya encontro al menos un Cliente Operam -- ofrecer crear
// un contacto con un RFC que ya existe invita a duplicar. Con un nombre, o con
// un RFC que no encontro ningun Cliente Operam, la fila sale como siempre.
export function ofreceCrearContacto(query, resultados) {
  if (!tieneFormaDeRfc(query)) return true;
  return !(resultados || []).some(r => r && r.tipo === 'operam');
}

// Decision ante el 409 de POST /api/prospectos, por el campo estructurado `tipo`
// del server (#82) -- NUNCA parseando el string de error (el mensaje de "tiene
// Cliente Operam" contiene la palabra "prospecto"; cualquier regex se rompe con el copy).
// Sin tipo reconocible se bloquea: fail-safe, no se crea un contacto fantasma
// sobre un estado desconocido.
export function accionProspecto409(data) {
  const d = data || {};
  if (d.tipo === 'cliente') {
    return { accion: 'cotizar_cliente', cust_name: d.cust_name || '', mensaje: d.error || 'Este celular ya tiene Cliente Operam' };
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

// Inversa de paisDesdeCodigoTelefono: iso2 (el que entrega un widget de pais,
// ej. intl-tel-input, issue #161) -> codigo de marcado de la casa. Antes de
// #161 el sistema no manejaba iso2 (los selects de pais usaban el codigo
// directo), por eso esta tabla es nueva -- pero vive junto a
// paisDesdeCodigoTelefono para no repetir la correspondencia MX/US/CA en dos
// modulos. Cualquier iso2 fuera de esta tabla cae al generico '+' en el
// consumidor (ver mayoreo.js).
export const CEL_CODE_POR_ISO2 = { mx: '+52', us: '+1', ca: '+1-CA' };

// Construye el body de POST /api/crear-cliente a partir de los datos fiscales (CSF),
// los campos comerciales capturados y el domicilio de entrega. customerId/branchId
// no nulos evitan crear un cliente duplicado, pero por si solos NO dicen de que caso
// se trata: pueden ser un reintento de esta misma alta o un cliente que ya existia y
// el vendedor eligio en la dedup. Eso lo dice `opciones.clienteExistente` (#250).
// === Selector de contactos de entrega en el paso Envio (issue #99) ===
//
// Antes, el paso Envio prellenaba telefono/correo de entrega tomando el primer valor
// "suelto" que encontrara (branch o primer contacto del cliente), sin decir a quien
// pertenecia (caso real: GRUPO URUGUAYO MINAS, 4 contactos a nivel cliente y 0 a nivel
// domicilio -- la app prellenaba un telefono y un correo de personas distintas sin
// atribucion). Esta funcion arma la lista COMPLETA de candidatos con nombre visible,
// para que el vendedor elija a quien entregar en vez de heredar un dato huerfano.
// El contacto propio del domicilio (branch) va primero porque es el mas especifico
// a esa direccion; los contactos del cliente (contacts[], con su tag de Operam:
// general/invoice/delivery) le siguen en el orden que trae la API.
//
// El Contacto de la cotizacion (la persona del celular, tercera fuente desde #353)
// va AL FINAL: cotizando para un Contacto sin Cliente Operam con contactos las dos
// fuentes de Operam quedan vacias, no se pintaba selector y "Entregar a" se tecleaba
// a mano aunque la app ya sepa como se llama. Ultimo y no primero para que el
// autollenado por defecto de un Cliente Operam con contactos no cambie.
//
// La MISMA persona es una sola opcion (#424): Operam repite a una persona una vez
// por rol (Israel Avila, cliente 217, cuatro veces) y en las altas del cotizador el
// contacto del domicilio nace con los datos del General (Lobo Glamp, cliente 228),
// asi que el selector ofrecia dos o cuatro opciones identicas y el vendedor lo leia
// como la lista de domicilios. La opcion que queda esta en el lugar de la primera y
// lleva en `tags` todos sus papeles en el orden en que aparecieron (decision de
// Adrian, 2026-09-22); `tag` sigue siendo el primero para quien ya lo lee.
export function contactosEntregaDisponibles(domicilio, contactosCliente, contacto) {
  const candidatos = [];
  const d = domicilio || {};
  if (d.contacto || d.telefono || d.email) {
    candidatos.push({ tag: 'domicilio', nombre: d.contacto || '', telefono: d.telefono || '', email: d.email || '' });
  }
  for (const c of contactosCliente || []) {
    if (c && (c.nombre || c.telefono || c.email)) candidatos.push(c);
  }
  if (contacto && (contacto.nombre || contacto.telefono || contacto.email)) candidatos.push(contacto);
  const lista = [];
  for (const c of candidatos) {
    const igual = lista.find(o => mismaPersonaDeEntrega(o, c));
    if (!igual) lista.push({ ...c, tags: c.tag ? [c.tag] : [] });
    else if (c.tag && !igual.tags.includes(c.tag)) igual.tags.push(c.tag);
  }
  return lista;
}

// Misma persona = mismo nombre, mismo telefono y mismo correo. Un campo vacio en
// las dos cuenta como igual; vacio contra lleno NO: con lo que se sabe son dos
// personas distintas y el vendedor tiene que poder elegir entre ellas. El telefono
// va por la llave de identidad del repo (Operam y el widget lo escriben distinto).
function mismaPersonaDeEntrega(a, b) {
  return normalizarBusqueda(a.nombre) === normalizarBusqueda(b.nombre) &&
    normalizarBusqueda(a.email) === normalizarBusqueda(b.email) &&
    llaveCelularOrigen(a.telefono) === llaveCelularOrigen(b.telefono);
}

// El cliente elegido en el paso Cliente, traducido a entrada del selector. Solo la
// PERSONA: un Cliente Operam es una razon social y sus personas ya llegan por
// contacts[] con su rol (glosario: Contacto vs Contacto en Operam). Prospecto y
// contacto nuevo comparten forma (buildClienteDesdeContactoNuevo/clienteDesdeProspecto),
// asi que un solo mapeo cubre los dos caminos.
//
// El RFC descarta igual que el tipo: el upgrade fiscal (#85) pisa `name` con la
// razon social del SAT y NO cambia el tipo, asi que un prospecto que ya subio su
// constancia deja de tener ahi el nombre de la persona. Sin esta guarda, "Entregar
// a" acabaria diciendo la razon social en MAYUSCULAS, que es lo que se imprime en
// el documento y viaja como deliver_to del quote.
export function contactoEntregaDelCliente(cliente) {
  const c = cliente || {};
  if (!c.tipo || c.tipo === 'operam' || c.rfc) return null;
  const entrada = { tag: 'contacto', nombre: c.name || '', telefono: c.telefono || '', email: c.email || '' };
  return (entrada.nombre || entrada.telefono || entrada.email) ? entrada : null;
}

const TAGS_CONTACTO = {
  general: 'General', invoice: 'Facturacion', delivery: 'Entrega', order: 'Pedido', domicilio: 'Domicilio', contacto: 'Contacto',
};

export function etiquetaTagContacto(tag) {
  return TAGS_CONTACTO[tag] || tag || '';
}

// Los papeles de una opcion del selector, juntos y separados por coma (#424):
// "Domicilio, General". Es lo que va entre parentesis en el <option>.
export function etiquetaPapelesContacto(contacto) {
  const c = contacto || {};
  return (c.tags || [c.tag]).map(etiquetaTagContacto).filter(Boolean).join(', ');
}

// Que opcion queda elegida al pintar el selector y si se llenan los campos de
// entrega con ella (#353). El selector se re-pinta en CADA pcRenderTarjeta (cambio
// de cliente, upgrade fiscal, borrador restaurado), y aplicar la opcion 0 en cada
// repintada pisaba en silencio lo que el vendedor tecleo en "Entregar a" y lo que el
// borrador acababa de restaurar (la clase de bug de #352).
//
// La pregunta es de QUIEN es lo que ya esta en los campos, y la contesta la
// coincidencia: si todo lo capturado que no esta vacio corresponde a una de las
// opciones, esa persona es la que esta ahi y se aplica para completar los huecos
// -- ese es el caso que motiva el ticket, porque al elegir un Contacto la app ya
// escribe su celular y su correo de entrega pero nunca su nombre. Si algo capturado
// no le corresponde a nadie, lo escribio una persona: queda "+ Nuevo contacto"
// (indice null) y no se toca nada.
//
// `capturaManual` es la marca de que el vendedor eligio "+ Nuevo contacto" en el
// selector (#355). Sin ella, los campos vacios de esa eleccion son indistinguibles
// de los de "todavia no hay nada" y la repintada re-aplicaba la opcion 0 encima de
// una decision explicita. Mientras este puesta NO se elige ni se aplica a nadie --
// tampoco cuando lo capturado coincide con una opcion: la marca solo la quita el
// vendedor (otra opcion del selector u otro cliente; otro domicilio ya no, #422), y hasta
// entonces quien captura es el.
export function seleccionContactoEntrega(contactos, capturado, capturaManual) {
  const lista = contactos || [];
  if (lista.length === 0) return { indice: null, aplicar: false };
  if (capturaManual) return { indice: null, aplicar: false };
  const cap = capturado || {};
  if (!cap.nombre && !cap.telefono && !cap.email) return { indice: 0, aplicar: true };
  const i = lista.findIndex(c => contactoExplicaLoCapturado(c, cap));
  return i === -1 ? { indice: null, aplicar: false } : { indice: i, aplicar: true };
}

// El contacto de entrega cuando el vendedor cambia de domicilio (#422, decision de
// Adrian del 2026-09-25). Antes ese camino aplicaba a ciegas la opcion 0 del
// domicilio nuevo (#355) y la 1292 perdio el celular que el vendedor habia
// tecleado. La regla es la de no pisar de #291/#409: lo que puso el selector se
// reemplaza por el contacto del domicilio nuevo -- y lo que este no trae se BORRA,
// igual que la direccion --; lo capturado a mano, y "+ Nuevo contacto", sobrevive.
//
// "Lo puso el selector" se contesta contra la lista del domicilio ANTERIOR, no la
// del nuevo: el contacto propio del domicilio anterior ya no esta en la lista
// nueva, y seleccionContactoEntrega a secas lo leeria como captura ajena. Lo
// capturado que nadie de la lista anterior explica lo escribio una persona, y ahi
// decide seleccionContactoEntrega sobre la lista nueva (no pisa; si coincide con
// una opcion, la elige). `indice: null` con `aplicar: true` = el domicilio nuevo no
// ofrece a nadie y los tres campos se vacian.
export function contactoAlCambiarDomicilio(contactosAntes, contactosDespues, capturado, capturaManual) {
  if (capturaManual) return { indice: null, aplicar: false };
  const cap = capturado || {};
  const hayCaptura = !!(cap.nombre || cap.telefono || cap.email);
  const loPusoElSelector = hayCaptura && (contactosAntes || []).some(c => contactoExplicaLoCapturado(c, cap));
  if (loPusoElSelector) return { indice: (contactosDespues || []).length ? 0 : null, aplicar: true };
  return seleccionContactoEntrega(contactosDespues, capturado, false);
}

// Solo se comparan los campos capturados que traen algo: un hueco no descarta a
// nadie (es justo lo que falta por llenar). El telefono va por su llave de
// identidad y no como texto: el campo lo reescribe el widget (#176), asi que el
// mismo numero vuelve del input como "+52 55 ..." y nunca empataria con el
// "55 ... ext 116" que trae Operam. Se usa la llave canonica del repo y no una
// copia local, que ademas de derivar se comeria la extension como digitos.
function contactoExplicaLoCapturado(contacto, capturado) {
  const c = contacto || {};
  const igualTexto = (a, b) => normalizarBusqueda(a) === normalizarBusqueda(b);
  if (capturado.nombre && !igualTexto(c.nombre, capturado.nombre)) return false;
  if (capturado.email && !igualTexto(c.email, capturado.email)) return false;
  if (capturado.telefono && llaveCelularOrigen(c.telefono) !== llaveCelularOrigen(capturado.telefono)) return false;
  return true;
}

// Uso de CFDI que va al payload (issue #250). Sobre un cliente EXISTENTE el select
// arranca preseleccionado en G03 (altaFijarDefaultUsoCfdi no dispara `change`), y ese
// default llegaba al PUT como si el vendedor lo hubiera elegido: el cliente 15 perdio
// su S01 sin que nadie tocara el campo. Un default es la pregunta, no la respuesta --
// solo viaja lo que el vendedor cambio a proposito. En un alta NUEVA el cliente nace
// con este valor, asi que ahi el default SI es el dato.
export function usoCfdiParaPayload({ clienteExistente, usoCfdiElegido, valor } = {}) {
  if (clienteExistente && !usoCfdiElegido) return '';
  return valor || '';
}

// Tras restaurar un borrador (#185) el select ya no dispara `change`, pero el mecanismo
// solo repone un campo que seguia en su default y solo guarda lo que era captura: si
// despues de restaurar el valor difiere del default vigente es PORQUE el vendedor lo
// cambio en la sesion anterior (#251). Misma regla al vaciar: vuelve al default y deja
// de contar como eleccion.
export function usoCfdiCuentaComoElegido({ valor, defaultVigente } = {}) {
  return !!valor && valor !== defaultVigente;
}

// El PDF de la constancia que el vendedor solto en la Seccion 1 (#350). El servidor
// sabe respaldarlo en Dropbox desde #24, pero por el camino del alta nunca le llegaba
// uno, asi que esa rama era codigo muerto y ninguna constancia dada de alta aqui se
// respaldo jamas. Dos guardas, porque el estado del panel sobrevive al cambio de
// pestana: solo viaja el PDF de ESTE RFC (con otro, Dropbox archivaria el archivo
// equivocado bajo el nombre del cliente nuevo) y solo cuando el alta va a CREAR el
// cliente -- sobre uno existente el servidor no sube nada. Sin archivo no viaja la
// llave, y eso no es un error: hay altas sin constancia.
export function pdfCsfParaRespaldo({ pdfBase64, pdfRfc, rfc, clienteExistente } = {}) {
  if (!pdfBase64 || clienteExistente === true) return null;
  const mismo = (v) => String(v || '').trim().toUpperCase();
  return mismo(pdfRfc) && mismo(pdfRfc) === mismo(rfc) ? pdfBase64 : null;
}

// `opciones.clienteExistente` marca el alta que va sobre un Cliente Operam elegido por dedup
// ("Usar este Cliente Operam", por RFC o por celular): el servidor no puede deducirlo del
// customer_id, que en el reintento de un alta nueva significa lo contrario (#250).
export function buildAltaDarDeAltaPayload(csfDatos, comercial, domicilio, customerId, branchId, opciones = {}) {
  const clienteExistente = opciones.clienteExistente === true;
  const pdfBase64 = pdfCsfParaRespaldo({
    pdfBase64: opciones.pdfBase64,
    pdfRfc: opciones.pdfRfc,
    rfc: csfDatos.rfc,
    clienteExistente,
  });
  return {
    ...(pdfBase64 ? { pdf_base64: pdfBase64 } : {}),
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
    timbrado_uso_cfdi: usoCfdiParaPayload({ clienteExistente, usoCfdiElegido: opciones.usoCfdiElegido === true, valor: comercial.uso_cfdi }),
    sales_type: comercial.sales_type || '',
    segmento_id: comercial.segmento_id || '',
    salesman: comercial.salesman || '',
    invoice_email: comercial.invoice_email || '',
    celular_nota: comercial.celular_nota || '',
    // Actividades economicas + fecha de la CSF (issue #171): buildClienteBody las
    // usa para armar la seccion de notas "Actividades economicas (CSF <fecha>):".
    actividades: csfDatos.actividades || [],
    csf_fecha: csfDatos.csf_fecha || '',
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
    cliente_existente: clienteExistente,
    // La salida de la dedup que el vendedor eligio, cuando la eligio (#368): con
    // "usar" viaja tambien el domicilio de entrega que escogio entre los del
    // Cliente Operam, que hasta #252 se quedaba en el navegador sin que nadie lo
    // leyera y la cotizacion heredaba el primero de la lista.
    ...(opciones.decision ? { decision: opciones.decision } : {}),
    // `fuente` NO viaja (#350): el servidor ya la deriva del PDF, y mandarla fija en
    // 'cotizador' era justamente lo que dejaba muerta esa rama. Un solo dueno de la regla.
  };
}

// === Reutilizar el domicilio de entrega del Cliente Operam elegido (#371) ===
//
// Con `decision.tipo === 'usar'` el modulo NO escribe ningun branch (el PUT es solo
// sobre el recien creado, ADR-0017, y lo fija test/alta-cliente.test.js "sobre el
// Cliente Operam que el vendedor eligio no se escribe ningun domicilio de entrega"):
// todo lo que el vendedor teclee en la Seccion 3 se tira. Por eso esa seccion deja de
// pedir captura y pasa a MOSTRAR el domicilio elegido.
//
// La entrada es `altaState.clienteExistente`, la MISMA eleccion con la que se arma la
// `decision` del POST: un solo dueno de "que eligio el vendedor". 'nuevo' es el valor
// literal con el que altaDedupNuevoDomicilio marca "Crear nuevo domicilio", y ahi la
// captura sigue siendo obligatoria porque ese branch SI nace en esta alta.
export function altaReutilizaDomicilio(clienteExistente) {
  const elegido = clienteExistente || {};
  if (elegido.id == null) return false;
  return elegido.branchIdx != null && elegido.branchIdx !== 'nuevo';
}

// El domicilio elegido dentro de la lista que pinto los radios. El `branch_code`
// manda sobre el indice: es lo que identifica al domicilio en Operam y lo que viaja
// como `decision.domicilioId` (#252), mientras que el indice depende del orden en que
// llego la lista. Uno que ya no esta en la lista devuelve null y no se muestra nada:
// el servidor lo revalida igual y vuelve a preguntar (#368).
export function domicilioReutilizadoDelAlta(clienteExistente, domicilios) {
  if (!altaReutilizaDomicilio(clienteExistente)) return null;
  const lista = Array.isArray(domicilios) ? domicilios : [];
  const { branchIdx, branchCode } = clienteExistente;
  if (branchCode != null) {
    return lista.find(d => String(d.branch_code) === String(branchCode)) || null;
  }
  return lista[Number(branchIdx)] || null;
}

// Lo que la Seccion 3 muestra del domicilio elegido, en pares etiqueta/valor y NUNCA
// como HTML: el nucleo no toca el DOM y quien pinta lo hace con textContent, asi que
// un nombre de sucursal con `<` no puede convertirse en marcado. Las etiquetas son las
// mismas del formulario que sustituye, para que el vendedor lea lo de siempre. Un
// campo vacio en Operam no produce fila: una etiqueta hueca parece un dato faltante
// que hay que llenar, y aqui no hay nada que llenar.
const DOMICILIO_REUTILIZADO_CAMPOS = [
  ['descripcion', 'Nombre del domicilio'],
  ['calle', 'Calle'],
  ['numInt', 'Num. interior'],
  ['colonia', 'Colonia'],
  ['cp', 'CP'],
  ['municipio', 'Ciudad / Municipio'],
  ['estado', 'Estado'],
  ['contacto', 'Contacto'],
  ['telefono', 'Telefono'],
  ['email', 'Email de entrega'],
];

export function filasDomicilioReutilizado(domicilio) {
  if (!domicilio) return [];
  return DOMICILIO_REUTILIZADO_CAMPOS
    .map(([campo, etiqueta]) => ({ etiqueta, valor: String(domicilio[campo] ?? '').trim() }))
    .filter(f => f.valor !== '');
}

// El domicilio elegido en las llaves que habla el resto del alta (altaState.domicilio,
// que alimentan buildAltaDarDeAltaPayload y buildClienteDesdeAlta). Sin esto la
// Seccion 3 en solo lectura dejaria a "Cotizar ahora" sin calle ni nombre de entrega,
// que es lo que hoy le da la captura que este ticket quita. Al servidor no le cambia
// nada: con `decision.tipo === 'usar'` el modulo no escribe ningun branch.
// `addr_exterior` queda VACIO a proposito: obtenerDomicilios ya une calle y numero
// exterior en `calle`, y quien consume estas llaves los vuelve a concatenar.
// La Seccion 2 precargada es la configuracion que el Cliente Operam YA tiene, no una
// eleccion del vendedor: solo viaja lo que CAMBIO (misma regla de #248/#250 que ya
// gobierna el uso de CFDI en usoCfdiParaPayload y el upgrade en
// datosUpgradeConComercial). Si lo precargado viajara, el alta pediria escrituras que
// nadie pidio -- y el segmento dispara ademas el post-fix por la web legacy, cuyo
// fallo saldria como "No se pudo guardar el segmento" sobre un campo que nadie toco.
// Sin precarga (alta nueva, o la lectura fallo) todo viaja tal cual: ahi la Seccion 2
// SI es captura del vendedor.
// Solo se podan los dos campos que la precarga escribe. El uso de CFDI ya lo resuelve
// usoCfdiParaPayload por su bandera de eleccion, y vendedor / celular / email de
// facturacion no se precargan (el email no es legible desde Operam, #373).
const COMERCIAL_ALTA_PRECARGADO = [['sales_type', 'salesType'], ['segmento_id', 'segmentoId']];

export function comercialDelAltaReutilizada(comercial, precargado) {
  const salida = { ...(comercial || {}) };
  if (!precargado) return salida;
  for (const [campo, llave] of COMERCIAL_ALTA_PRECARGADO) {
    const nuevo = String(salida[campo] ?? '').trim();
    const anterior = String(precargado[llave] ?? '').trim();
    if (nuevo === anterior) salida[campo] = '';
  }
  return salida;
}

export function entregaDeDomicilioOperam(domicilio) {
  const d = domicilio || {};
  return {
    br_name: d.descripcion || '',
    br_ref: '',
    addr_street: d.calle || '',
    addr_exterior: '',
    addr_interior: d.numInt || '',
    addr_colony: d.colonia || '',
    addr_zip: d.cp || '',
    addr_city: d.municipio || '',
    addr_state: d.estado || '',
    pais: '',
    phone: d.telefono || '',
    addr_reference: '',
    email: d.email || '',
  };
}

// Fila del panel de la Seccion 4 por NOMBRE del step, nunca por posicion (#112): el
// servidor manda mas pasos de los que el panel pinta (config comercial / dimensiones,
// que no tienen fila) y el orden cambia entre las dos ramas del alta. Mapeado por
// indice, el resultado del PUT de customers se pintaba sobre la fila del GET del
// branch y "Configurar domicilio" nunca llegaba a pintarse.
export const ALTA_PASO_FILA = {
  // El alta puede CREAR el Cliente Operam o reutilizar uno (#366): la fila de
  // arriba dice cual de las dos cosas paso, y por eso la comparte con el paso
  // de deduplicacion, que es el que lo decide. Con cliente reutilizado no hay
  // 'POST customer' y la fila se queda con el mensaje de la dedup.
  dedup: 0,
  'POST customer': 0,
  'PUT customer (config comercial)': 1,
  'PUT customer (dimensiones)': 5,
  segmento: 2,
  'GET branch_id': 3,
  // Los tres pasos del domicilio de entrega comparten fila y el ULTIMO manda: la
  // verificacion por relectura es la que sabe como quedo de verdad (#366).
  'POST branch': 4,
  'PUT branch (domicilio)': 4,
  'verificar branch': 4,
  'verificar Cel': 6,
  // A quien quedo el domicilio NUEVO de un Cliente Operam existente (#414, #433):
  // fila propia, porque en la del domicilio la verificacion lo taparia.
  'vendedor branch': 7,
};

export const ALTA_PASO_FILAS = [...new Set(Object.values(ALTA_PASO_FILA))];

// Filas de pasos que solo corren en un camino del alta (#433): sin paso no se
// pintan, en vez de quedarse pendientes para siempre. `vendedor branch` solo
// existe al crear otro domicilio sobre un Cliente Operam elegido.
export const ALTA_PASO_FILAS_OPCIONALES = [ALTA_PASO_FILA['vendedor branch']];

// Pasos cuyo EXITO tambien es noticia para el vendedor (#433): la herencia del
// vendedor decide a quien paga el Reporte de Comisiones, asi que su paloma no
// puede ser muda. Lo comparten el panel del alta y la subida de la cotizacion
// (`pasosParaMostrar`, pipeline-logica.js).
export const PASOS_OK_QUE_SE_LEEN = new Set(['vendedor branch']);

// Traduce la respuesta de POST /api/crear-cliente a lo que el panel debe mostrar.
//
// Vive aqui y no en app.js (#213) por una razon concreta: app.js no es importable en
// Node, asi que esta decision no tenia seam de prueba y el caso que importaba -- una
// respuesta SIN `steps` -- nunca se probo. El 400 de "Falta el RFC (tax_id)" dejaba
// las cinco filas en pending, no leia `data.error` y el vendedor veia CERO cambio:
// "el boton no hace nada" era literal.
//
// Regla que sostiene el nucleo: una respuesta que no se entiende SIEMPRE deja mensaje.
// El silencio nunca es una salida valida.
// Lo que hay que decir de un paso que NO fallo (issue #250). Antes toda paloma era
// muda y tres de las cinco mentian: la del segmento tapaba una escritura que el
// servidor decidio no hacer (`info: 'conservado'`, #186) y la del domicilio tapaba un
// PUT destructivo. Un paso omitido lleva su motivo en `info`; un exito normal no dice
// nada, que es lo correcto.
function mensajeExitoPaso(step) {
  if (step.status === 'omitido') return step.mensaje || step.info || '';
  if (PASOS_OK_QUE_SE_LEEN.has(step.name)) return step.mensaje || '';
  return '';
}

// Respuestas donde Reintentar es una trampa: el boton daria exactamente lo mismo
// hasta que el vendedor haga algo distinto (#366). El posible duplicado se
// resuelve eligiendo una de las tres salidas que el 428 trae pintadas (#368), y
// el boton generico ademas reintentaria con el cuerpo original -- sin decision --
// para volver a la misma pregunta; el nombre corto repetido se resuelve
// cambiandolo, porque Operam lo exige unico global (#242).
const SIN_REINTENTO = new Set(['POSIBLE_DUPLICADO', 'CUST_REF_DUPLICADO']);

export const CODIGO_POSIBLE_DUPLICADO = 'POSIBLE_DUPLICADO';

// El candidato del 428, que viene en palabras del glosario, traducido a la forma
// que lee la pieza de candidatos de la pantalla de cotizar (nombres de campo de
// Operam). La traduccion vive aqui, en el nucleo puro, y no en app.js: es parte
// de entender la respuesta, y asi tiene test sin DOM.
function candidatoParaPintar(c) {
  const porque = c?.porque || {};
  return {
    id: c?.id,
    CustName: c?.razonSocial || '',
    cust_ref: c?.nombreCorto || '',
    tax_id: c?.rfc || '',
    diferenciaNombre: porque.diferenciaNombre,
    celularMatch: porque.celularMatch,
    correoMatch: porque.correoMatch,
    custRefIgual: porque.custRefIgual === true,
  };
}

// La pregunta de duplicado (428 POSIBLE_DUPLICADO, #368): el mensaje, los
// candidatos ya listos para pintar y las opciones TAL CUAL las dicto el servidor
// -- son los cuerpos de reintento y el navegador no los interpreta, solo los
// reenvia (#345).
function preguntaDeDuplicado(d) {
  if (d.codigo !== CODIGO_POSIBLE_DUPLICADO) return null;
  return {
    mensaje: d.error || '',
    detalle: d.detalle || '',
    candidatos: (Array.isArray(d.candidatos) ? d.candidatos : []).map(candidatoParaPintar),
    opciones: d.opciones || null,
  };
}

// El cuerpo con el que el navegador reintenta el alta tras elegir una salida. Sale
// ENTERO de las opciones que dicto el servidor (la misma Solicitud mas la
// decision); aqui solo se le agregan las dos cosas que el servidor no podia poner:
// el domicilio de entrega que el vendedor eligio entre los del Cliente Operam
// (#252) y el PDF de la constancia, que no viaja de vuelta porque pesa.
// Sin cuerpo dictado devuelve null: no se inventa una decision.
const LLAVE_OPCION_CANDIDATO = { usar: 'usar', 'otro-domicilio': 'otroDomicilio' };

// LAS salidas de la Deduplicacion de cliente (CONTEXT.md), en el orden en que se
// pintan, en UN solo lugar: las decide el modulo del alta (`lib/alta-cliente.js`
// las cross-importa) y las pinta el navegador (`pipeline-logica.js`), y con una
// copia en cada lado la lista podria divergir sin que nada avisara. CUALES se
// ofrecen en una pregunta concreta depende del motivo del candidato (#377); esta
// es la lista completa.
export const SALIDAS_DEDUP = ['usar', 'otro-domicilio', 'ninguno'];

export function cuerpoDeReintentoAlta(opciones, eleccion, extras = {}) {
  const tipo = eleccion?.tipo;
  const llave = LLAVE_OPCION_CANDIDATO[tipo];
  const dictado = tipo === 'ninguno'
    ? opciones?.ninguno
    : llave && (opciones?.porCandidato || []).find(o => String(o?.id) === String(eleccion?.clienteId))?.[llave];
  if (!dictado) return null;
  const domicilioId = extras.domicilioId;
  return {
    ...dictado,
    ...(extras.pdfBase64 ? { pdf_base64: extras.pdfBase64 } : {}),
    decision: {
      ...dictado.decision,
      ...(domicilioId != null && domicilioId !== '' ? { domicilioId } : {}),
    },
  };
}

export function interpretarRespuestaAlta(data) {
  const d = data || {};
  const steps = Array.isArray(d.steps) ? d.steps : [];
  const exito = d.ok === true;

  const opcional = f => ALTA_PASO_FILAS_OPCIONALES.includes(f);
  const porFila = new Map(ALTA_PASO_FILAS.map(f => [f, { fila: f, status: 'pending', msg: '', detalle: '', oculta: opcional(f) }]));
  let primerError = null;
  for (const crudo of steps) {
    const fila = ALTA_PASO_FILA[crudo?.name];
    if (fila === undefined) continue;
    // La fila de arriba se titula "Crear cliente" (#433): un `dedup` en ok que la
    // cierra sin un POST customer detras que lo pise es un Cliente Operam
    // REUTILIZADO. Su paloma afirmaba una creacion que no hubo (en el HITL de #414
    // solo se creo un domicilio); sale omitida con el motivo del modulo.
    const step = crudo.name === 'dedup' && crudo.status === 'ok' ? { ...crudo, status: 'omitido' } : crudo;
    const omitido = step.status === 'omitido';
    // Un AVISO no es un fallo (#366): el Cel que Operam no aplico o el campo del
    // domicilio de entrega que ignoro no tumban el alta -- el cliente quedo
    // creado y lo que falta se arregla en Operam. Pintarlo de error mandaria a
    // reintentar un alta que ya paso.
    const aviso = step.status === 'warn';
    const esError = step.status !== 'ok' && !omitido && !aviso;
    // Mensaje en dos capas (ADR-0017): el vendedor lee el mensaje en palabras del
    // glosario y el detalle tecnico va plegado. El error crudo queda como respaldo
    // de las respuestas que todavia no mandan mensaje; el nombre del paso ya nunca
    // es el texto que se muestra.
    const msg = esError || aviso ? (step.mensaje || step.error || '') : mensajeExitoPaso(step);
    const detalle = step.detalle || (step.mensaje ? step.error || '' : '');
    porFila.set(fila, { fila, status: esError ? 'error' : aviso ? 'warn' : omitido ? 'omitido' : 'ok', msg, detalle, oculta: false });
    if (esError && !primerError) primerError = msg || 'Un paso del alta fallo sin decir por que.';
  }

  // Sin steps no hay nada que pintar: el motivo tiene que salir por el banner o el
  // fallo queda invisible. `d.error` manda sobre el paso que fallo cuando existe
  // (#366): es el motivo del BLOQUEO en palabras del vendedor, con lo que hay que
  // hacer -- "cambia el nombre corto" dice mas que "no se pudo crear el cliente".
  // La pregunta de duplicado es la excepcion (#368): no es un fallo, es una
  // decision pendiente, y su mensaje encabeza la pregunta -- repetirlo en el
  // banner rojo lo pintaria como error y diria dos veces lo mismo.
  const pregunta = preguntaDeDuplicado(d);
  const mensajeError = exito || pregunta
    ? null
    : (d.error
      || primerError
      || 'El alta no se completo y el servidor no explico por que. Reintenta; si sigue igual, avisa.');

  return {
    exito,
    mensajeError,
    pregunta,
    filas: [...porFila.values()],
    mostrarReintentar: !exito && !SIN_REINTENTO.has(d.codigo),
  };
}

// Guardia previa al POST (#213): la Seccion 1 es la que decide SOBRE QUE cliente
// aplica el alta, y sus datos viven en memoria (altaState.datos), no en los campos de
// pantalla. Se puede llegar al boton "Dar de alta" sin haberla confirmado -- la
// Seccion 2 no tiene candado y confirmar 2 y 3 abre la 4 -- y el borrador (#185)
// repinta los campos sin restaurar ese estado, asi que la pantalla se ve completa
// mientras la memoria esta vacia. Sin esta guardia el alta viaja sin RFC y muere en
// un 400 que hasta #213 no se veia.
export function errorAltaSinConfirmar(csfDatos) {
  const rfc = String(csfDatos?.rfc || '').trim();
  if (!rfc) return 'Falta confirmar la Seccion 1 (datos fiscales): abrela y presiona "Verificar y confirmar" antes de dar de alta.';
  return null;
}

// Guardia de "Dar de alta" en modo upgrade fiscal (#376). El acordeon del alta
// (#panel-alta-cliente) es UN solo nodo y el upgrade fiscal (#85) lo reusa: las
// Secciones 3 y 4 que desbloqueo un alta anterior de la MISMA pestana siguen abiertas
// cuando el upgrade se abre despues, y desde ahi "Dar de alta" manda un
// POST /api/crear-cliente con la CSF del upgrade (altaDarDeAlta cae a
// altaCsfState.datos). Asi, en el HITL de #361, un upgrade que el gate de fusion ya
// habia bloqueado degenero en un alta del cliente que ya existia. En modo upgrade no
// hay alta posible: el trabajo termina en la Seccion 1 (+ la 2 por #197). La guardia
// mira el MODO, no el DOM -- el candado de las secciones es lo que el vendedor ve,
// esto es lo que lo hace cierto.
export function errorAltaEnModoUpgrade(modoUpgrade) {
  if (modoUpgrade == null) return null;
  return `Este panel esta actualizando los datos fiscales del Cliente Operam ${modoUpgrade}: aqui no se da de alta, se actualiza. Confirma la Seccion 1 para actualizarlo; para un alta nueva, cierra el panel y vuelve a abrirlo.`;
}
