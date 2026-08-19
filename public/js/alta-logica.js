// Logica pura del flujo de alta de cliente (CSF, diff fiscal, payload de alta).
// Modulo sin efectos secundarios de navegador -- importable tanto desde app.js
// (ESM nativo en el browser) como desde los tests (.cjs via import() dinamico).
// Existe para que ambos lados consuman la MISMA implementacion en vez de mantener
// copias espejo que pueden divergir (ver architecture-review-cotizador-20260606.html).

import { cpValido } from './cotizar-logica.js';
import { esRegimenValido } from './regimen-fiscal-logica.js';

export const CSF_DATOS_VACIOS = {
  rfc: '', razonSocial: '', nombreCorto: '', idcif: '', regimenFiscal: '',
  calle: '', numExt: '', numInt: '', colonia: '', cp: '', municipio: '', estado: '',
  actividades: [], csf_fecha: '',
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
      seccionAbierta: null,
      altaCompletada: false,
    },
    reiniciado: true,
  };
}

export const DIFF_FISCAL_CAMPOS = [
  { operam: 'CustName',            csf: 'razonSocial',   label: 'Razon Social', write: 'cust_name' },
  { operam: 'tax_id',              csf: 'rfc',           label: 'RFC' },
  { operam: 'cust_ref',            csf: 'nombreCorto',   label: 'Nombre corto' },
  { operam: 'timbrado_uso_cfdi',   csf: 'usoCfdi',        label: 'Uso de CFDI', default: 'S01' },
  { operam: 'invoice_email',       csf: 'invoiceEmail',   label: 'Email de facturacion' },
  { operam: 'segmento_id',         csf: 'segmentoId',     label: 'Segmento', read: 'segmento.id' },
  { operam: 'idcif',               csf: 'idcif',         label: 'IdCIF (SAT)' },
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

function leerValorOperam(clienteOperam, { operam, read }) {
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
// El eco tambien ABSUELVE: el GET de detalle no expone idcif ni invoice_email, asi que
// la relectura los marca como distintos aunque el PUT los haya escrito. Un campo que
// Operam confirmo en su propia respuesta no se le reporta al vendedor como no aplicado
// -- seria ruido permanente sobre una escritura que si ocurrio.
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

export function camposNoAplicados(diff, ecoPut) {
  const eco = ecoPut && typeof ecoPut === 'object' ? ecoPut : {};
  return Object.entries(diff)
    .filter(([campo]) => !((LLAVE_ESCRITURA[campo] || campo) in eco))
    .map(([campo, d]) => ({ campo, label: d.label, anterior: d.anterior, nuevo: d.nuevo, motivo: MOTIVO_IGNORADO }));
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

function normalizarOperam(c) {
  return {
    tipo: 'operam', id: c.id, nombre: c.name || '', rfc: c.rfc || '', ref: c.ref || '',
    telefonos: c.telefonos || (c.telefono ? [c.telefono] : []),
    sub: c.rfc || '', raw: c,
  };
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
// recientes). Operam matchea por razon social, RFC, nombre corto (cust_ref, #97) o
// telefono de cualquier contacto (#97, digitos); el prospecto por nombre, ciudad o
// los digitos del celular. Ordena coincidencias por prefijo antes que internas
// (mezcla los tipos, no los agrupa: "distinguibles" no es "separados").
export function mezclarResultadosBusqueda(clientesOperam, prospectos, query) {
  const q = String(query || '').toLowerCase().trim();
  if (q.length < 2) return [];
  const qDigitos = q.replace(/\D/g, '');
  const filas = [
    ...(clientesOperam || []).map(normalizarOperam).filter(r =>
      r.nombre.toLowerCase().includes(q) ||
      r.rfc.toLowerCase().includes(q) ||
      r.ref.toLowerCase().includes(q) ||
      // >=8 digitos (formato "sin lada" en adelante, ver indice-telefonos.js): con
      // menos, un fragmento corto empataria demasiados telefonos del catalogo completo.
      (qDigitos.length >= 8 && r.telefonos.some(t => t.replace(/\D/g, '').includes(qDigitos)))),
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
// no nulos indican un reintento (issue #?): se reenvian para que el backend continue
// donde quedo en vez de crear un cliente duplicado.
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
export function contactosEntregaDisponibles(domicilio, contactosCliente) {
  const lista = [];
  const d = domicilio || {};
  if (d.contacto || d.telefono || d.email) {
    lista.push({ tag: 'domicilio', nombre: d.contacto || '', telefono: d.telefono || '', email: d.email || '' });
  }
  for (const c of contactosCliente || []) {
    if (c && (c.nombre || c.telefono || c.email)) lista.push(c);
  }
  return lista;
}

const TAGS_CONTACTO = { general: 'General', invoice: 'Facturacion', delivery: 'Entrega', domicilio: 'Domicilio' };

export function etiquetaTagContacto(tag) {
  return TAGS_CONTACTO[tag] || tag || '';
}

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
    fuente: 'cotizador',
  };
}
