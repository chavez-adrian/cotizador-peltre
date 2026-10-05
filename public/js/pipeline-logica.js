// Logica pura del tablero unico del pipeline (issue #53, ADR-0005, CONTEXT.md
// "Tablero del pipeline"): un solo kanban de 7 columnas que reemplaza los dos
// tableros separados del modelo previo (prospectos y cotizaciones). La unidad
// que vive en cada tarjeta es la oportunidad: antes de cotizar es el prospecto
// (etapa por_cotizar / no_asignado), al cotizar lleva la cotizacion
// (seguimiento y post-venta). Modulo sin efectos de navegador, mismo patron que
// cotizaciones-logica.js: lo consumen app.js y los tests .cjs via import().
//
// Browser-safe: no importa de lib/. El vocabulario canonico vive en
// lib/pipeline.js (lo usan stores/server/migracion); aqui se reexpresa para el
// frontend, alineado a ese glosario.

import { escapeHtml, CANALES, buildColaProspectosHtml, MOTIVOS_NO_UTIL, buildEdicionProspectoFormHtml, chipOrigenHtml, celularParaAccion, ETAPA_LABELS, buildWaLink } from './prospectos-logica.js';
import { PASOS_DECORADO, esDecorada, progresoDecorado } from './decorados-logica.js';
import { chipsCompletitud, customerIdFiscal, mostrarBotonCsf, esRfcGenerico, nombreConCorto, SALIDAS_DEDUP, PASOS_OK_QUE_SE_LEEN } from './alta-logica.js';
import { filtrarPorCriterio, fechaLocal } from './busqueda-logica.js';
import { tienePedido, textoMotivoPerdida } from './perdida-logica.js';
import { puedeCancelar } from './cancelada-logica.js';
import { faltaComprobante, comprobanteDe, puedeSubirComprobante, ACCEPT_COMPROBANTE } from './comprobante-pago-logica.js';
import { buildBotonEditarHtml, tienePedidoAsociado } from './editar-cotizacion-logica.js';
import { ICONO_WHATSAPP, ICONO_CORREO, ICONO_CAMION, ICONO_TRES_PUNTOS } from './iconos.js';
import { entregaPedido } from './entrega-pedido-logica.js';
import { SIN_DATOS_FISCALES, CON_DATOS_FISCALES, CON_PEDIDO, ETIQUETA_FISCAL, ETIQUETA_COMERCIAL, ETIQUETAS_CONTACTO_ORDEN, ETIQUETA_CONTACTO } from './estado-cliente-logica.js';

// Candado del documento por duplicado sin resolver (#204). Reexpresion frontend
// del motivo de PRE que define lib/pipeline.js (este modulo NO importa de lib/,
// ver cabecera); test/pipeline.test.js compara ambas definiciones para que no
// deriven. La garantia REAL es del servidor -- los GET que regeneran el
// documento van sin auth --; esto solo apaga los botones para que el vendedor
// vea por que.
export const LEYENDA_DEDUP_PENDIENTE = 'Esta cotizacion tiene un posible duplicado pendiente de resolver';

export function documentoBloqueado(cot) {
  return (cot?.data?.motivoPre ?? cot?.motivoPre ?? null) === 'dedup';
}

// Leyenda del chip de una PRE con motivo conocido (#285). Hoy solo el cliente sin
// lista de precios tiene una: el PRE generico no dice nada y el vendedor no tiene
// como saber que el arreglo esta en el CLIENTE (asignarle una lista en Operam) y
// no en la cotizacion -- reintentar sin eso falla igual, para siempre. El motivo
// llega en data.motivoPre (entrada completa) o plano (fila del Historial): el
// mismo campo a dos alturas que ya maneja documentoBloqueado.
export const LEYENDA_PRE_SIN_LISTA = 'PRE: Cliente Operam sin lista de precios';
// #466: el alta se bloqueo porque el vendedor no tiene ID de Operam. Mismo trato
// que la lista: el arreglo lo hace un administrador en /admin, no la cotizacion.
export const LEYENDA_PRE_SIN_VENDEDOR = 'PRE: vendedor sin ID de Operam';

const LEYENDAS_PRE = { 'sin-lista': LEYENDA_PRE_SIN_LISTA, 'sin-vendedor': LEYENDA_PRE_SIN_VENDEDOR };

export function leyendaPre(cot) {
  return LEYENDAS_PRE[cot?.data?.motivoPre ?? cot?.motivoPre ?? null] || '';
}

// Las 7 etapas del embudo son las columnas del tablero. Las salidas (No util,
// Perdida, Cancelada) NO son columnas: viven en filtro/historial.
export const COLUMNAS_PIPELINE = [
  'no_asignado', 'por_cotizar', 'seguimiento', 'anticipo_pagado',
  'pedido_liberado', 'saldo_pagado', 'producto_entregado',
];

export const COLUMNA_LABELS = {
  no_asignado: 'No Asignado',
  por_cotizar: 'Por Cotizar',
  seguimiento: 'Seguimiento',
  anticipo_pagado: 'Anticipo pagado',
  pedido_liberado: 'Pedido liberado',
  saldo_pagado: 'Saldo pagado',
  producto_entregado: 'Producto entregado',
};

const SALIDAS = new Set(['no_util', 'perdida', 'cancelada']);

export function esSalida(etapa) {
  return SALIDAS.has(etapa);
}

// Modo inicial del Pipeline (#520): la eleccion guardada valida gana en
// cualquier ancho; sin ella, por debajo del layout de escritorio de la lista
// (el @media de .pl en style.css, atado por prueba) abre en lista. Solo decide
// el estado inicial: girar o redimensionar no cambia el modo ya pintado.
export const PIPELINE_MODOS = new Set(['tablero', 'lista', 'cerradas']);
export const ANCHO_ESCRITORIO_PIPELINE = 900;

export function modoInicialPipeline(ancho, guardado) {
  if (PIPELINE_MODOS.has(guardado)) return guardado;
  return ancho < ANCHO_ESCRITORIO_PIPELINE ? 'lista' : 'tablero';
}

// Estado PRE / folio Operam (issue #63, CONTEXT.md "Pre-cotizacion"): la
// ausencia del folio define el estado "PRE"; con folio la cotizacion muestra
// "Cotizacion N". Reexpresion browser-safe de lib/pipeline.etiquetaFolioOperam
// (este modulo no importa de lib/, mismo criterio que el resto del vocabulario).
// La convencion "#Operam N" (#63) se retiro en #309: nombraba el ERP en vez de
// la cosa.
export function etiquetaFolioOperam(o) {
  const folio = o && o.folioOperam;
  if (folio != null && folio !== '') return `Cotización ${folio}`;
  // Historica de registro desconocido (anterior a #63): se asume registrada, sin
  // badge (ni PRE ni Cotizacion N). Las nuevas sin folio si son PRE.
  return o && o.registroDesconocido ? '' : 'PRE';
}

// Formalizar una pre-cotizacion desde su tarjeta (issue #66, AC1): el disparador
// "Completar" solo aplica mientras la cotizacion sigue siendo PRE. Reusa la regla
// de dominio del badge: con folio ya esta registrada (Cotizacion N) y una historica
// de registro desconocido se asume registrada -- ninguna ofrece "Completar".
export function puedeCompletarPreCotizacion(cot) {
  return !!cot && etiquetaFolioOperam(cot) === 'PRE';
}

// Interpreta la respuesta de POST /api/cotizacion/operam/:id (auto-subida, #83)
// en un estado de UI, por status + campos estructurados -- NUNCA parseando el
// string de error (misma disciplina que accionProspecto409 de alta-logica, #82).
// El endpoint de #81 (ADR-0006) es la unica fuente:
//   200 { ok, folio }             -> 'folio'      (subio; deja de ser PRE)
//   409 { error, candidatos: [] } -> 'candidatos' (dedup por nombre: elegir uno)
//   422 { error }                 -> 'sin_datos'  (cotizacion legacy sin datos
//                                                   minimos: queda PRE, reintento inutil)
//   503 / red / cualquier otro    -> 'pre'        (Operam fallo: PRE + Reintentar
//                                                   idempotente)
// Un 409 de conflicto (customerId que contradice lo ligado, sin lista de
// candidatos) cae a 'pre' con su mensaje: no hay lista que ofrecer.
// Resultado del post-fix de la vigencia (#106, ADR-0007) leido de los steps de la
// subida: 'ok' | 'revisar' | null (el paso no viene -- respuesta anterior a #106 o
// camino que no subio nada; ahi no se opina en vez de inventar un estado).
function estadoVigencia(steps) {
  const paso = (Array.isArray(steps) ? steps : []).find(s => s && s.name === 'post-fix vigencia');
  if (!paso) return null;
  return paso.status === 'ok' ? 'ok' : 'revisar';
}

// Los pasos del alta que el vendedor tiene que LEER (#364, ADR-0017): los que no
// salieron bien. Cada uno viaja en dos capas -- `mensaje` en palabras del glosario,
// que se muestra siempre, y `detalle` tecnico, que va plegado --, asi que el slot ya
// no pinta el nombre del paso ni el `error` crudo de la API.
//
// Los pasos en ok y los omitidos NO se pintan aqui -- salvo PASOS_OK_QUE_SE_LEEN (#433):
// a quien quedo el domicilio nuevo es noticia aunque salga bien --: viajan igual en
// `steps` para quien depure, y listarlos todos convertiria cada subida exitosa en un muro de diez
// renglones. 'post-fix vigencia' queda fuera porque ya tiene su propio aviso, con
// texto propio (estadoVigencia): pintarlo dos veces seria decir lo mismo dos veces.
//
// Un paso que fallo SIN mensaje (una respuesta anterior a #364, u otro endpoint) no
// se calla: sale con un texto generico y su detalle, porque el silencio nunca es una
// salida valida.
const PASO_CON_AVISO_PROPIO = new Set(['post-fix vigencia']);

export function pasosParaMostrar(steps) {
  return (Array.isArray(steps) ? steps : [])
    .filter(s => s && (s.status === 'warn' || s.status === 'error' || (s.status === 'ok' && PASOS_OK_QUE_SE_LEEN.has(s.name))) && !PASO_CON_AVISO_PROPIO.has(s.name))
    .map(s => ({
      estado: s.status,
      mensaje: s.mensaje || 'Un paso del alta del Cliente Operam no se completo.',
      detalle: s.detalle || s.error || '',
    }));
}

export function interpretarSubidaOperam(resultado) {
  const r = resultado || {};
  const pasos = pasosParaMostrar(r.steps);
  // ADR-0009: con la subida en la ruta critica de la generacion, "ya hay una
  // subida en vuelo" y "Operam no respondio a tiempo" dejan de ser detalles
  // internos -- son la razon de que el documento salga como PRE, y el vendedor
  // tiene que leerla. Antes el caso en vuelo era un return mudo en app.js.
  if (r.enVuelo) {
    return { estado: 'pre', mensaje: 'Ya hay una subida a Operam en curso para esta cotizacion: el documento sale como pre-cotizacion. Reintenta cuando termine.' };
  }
  if (r.timeout) {
    return { estado: 'pre', mensaje: 'Operam no respondio a tiempo: el documento se entrega como pre-cotizacion, sin numero. Si la subida termina sola, el documento numerado queda en Ver HTML / Descargar PDF (o en el historial).' };
  }
  // yaSubida (#83 F1c): la cotizacion ya tenia folio y el endpoint NO re-subio
  // (los quotes de Operam no se editan por API): folio + nota de que una
  // regeneracion local no viaja a la cotizacion ya registrada.
  // customerId/clienteGenerico (#93): la subida con alta generica (#81) devuelve
  // el customer_id creado/reutilizado; con clienteGenerico se ofrece la CSF junto
  // al folio (mismo criterio que el chip Fiscal de la tarjeta).
  if (r.ok) return { estado: 'folio', folio: r.folio ?? null, yaSubida: !!r.yaSubida, customerId: r.customerId ?? null, clienteGenerico: !!r.clienteGenerico, vigencia: estadoVigencia(r.steps), pasos };
  const candidatos = Array.isArray(r.candidatos) ? r.candidatos : [];
  if (r.status === 409 && candidatos.length) {
    // Las salidas que ofrece el modulo del alta (#377), tal cual: la vista no las
    // decide. Sin el campo se conservan las tres, que es lo que respondia antes.
    return {
      estado: 'candidatos', candidatos,
      mensaje: r.error || 'Hay Clientes Operam con nombre similar',
      opciones: Array.isArray(r.opciones) ? r.opciones : SALIDAS_DEDUP,
    };
  }
  // #242: el nombre corto (cust_ref) es UNICO GLOBAL en Operam y el que se
  // capturo ya lo usa otro cliente. No es un fallo transitorio del ERP: hasta que
  // el vendedor cambie el nombre corto, reintentar da exactamente el mismo error
  // -- por eso es un estado propio y no el 'pre' con Reintentar. Se clasifica por
  // el codigo estructurado, nunca parseando el texto.
  // #345: el celular ya esta ligado a OTRO Cliente Operam. No es un fallo: casi
  // siempre es la segunda razon social del mismo Contacto, asi que el servidor
  // exige una confirmacion explicita (428) y esto es una PREGUNTA con su boton,
  // nunca el 'pre' con Reintentar -- reintentar sin confirmar daria lo mismo.
  // Se clasifica por el codigo, jamas por el texto.
  if (r.status === 428 && r.codigo === 'CONFIRMAR_OTRA_RAZON_SOCIAL') {
    return {
      estado: 'otra_razon_social',
      mensaje: r.error || 'El celular de esta cotizacion ya esta ligado a otro Cliente Operam',
      ligado: Array.isArray(r.ligado) ? r.ligado : [],
      elegido: r.elegido || null,
      reintentar: r.reintentar || null,
    };
  }
  if (r.status === 409 && r.codigo === 'CUST_REF_DUPLICADO') {
    return { estado: 'cust_ref', mensaje: r.error || 'El nombre corto ya lo usa otro Cliente Operam', nombreCorto: r.nombreCorto ?? null, pasos };
  }
  if (r.status === 422) {
    return { estado: 'sin_datos', mensaje: r.error || 'Faltan datos minimos para dar de alta el Cliente Operam', pasos };
  }
  return { estado: 'pre', mensaje: r.error || 'No se pudo subir a Operam', pasos };
}

// Texto de la diferencia de nombre (#210): palabras CRUDAS en AMBAS direcciones,
// sin clasificar -- ni gazetteer ni lista curada que adivine si una palabra es
// una ciudad o un tipo de entidad; el vendedor decide. Vacio si los nombres
// normalizan igual (nada que mostrar, no se inventa una diferencia).
function textoDiferenciaNombre(diff) {
  const soloInput = Array.isArray(diff?.soloInput) ? diff.soloInput : [];
  const soloCandidato = Array.isArray(diff?.soloCandidato) ? diff.soloCandidato : [];
  if (!soloInput.length && !soloCandidato.length) return '';
  const partes = [];
  if (soloCandidato.length) partes.push(`${soloCandidato.join(', ')} (en Operam)`);
  if (soloInput.length) partes.push(`${soloInput.join(', ')} (en tu captura)`);
  return `Difiere en: ${partes.join(' · ')}`;
}

const LETRERO_MATCH_TEXTO = { coincide: 'coincide', no_coincide: 'no coincide', sin_dato: 'sin dato' };
const LETRERO_MATCH_CLASE = { coincide: 'operam-letrero-ok', no_coincide: 'operam-letrero-alerta', sin_dato: 'operam-letrero-neutro' };

// Letrero de celular/correo (#210): TRES estados -- coincide / no coincide /
// sin dato. "sin dato" NUNCA se pinta como "no coincide" (41% de las fichas
// historicas de Operam no tienen telefono capturado). Es evidencia, nunca
// candado: no deshabilita Elegir ni Crear nuevo.
function letreroMatch(etiqueta, estado) {
  const clase = LETRERO_MATCH_CLASE[estado] || LETRERO_MATCH_CLASE.sin_dato;
  const texto = LETRERO_MATCH_TEXTO[estado] || LETRERO_MATCH_TEXTO.sin_dato;
  return `<span class="operam-letrero ${clase}">${escapeHtml(etiqueta)}: ${texto}</span>`;
}

// Una salida que no viene NO se pinta (#377): QUE salidas hay lo decide el modulo
// del alta segun el motivo del candidato -- con el mismo RFC real "ninguno es el
// mismo" no existe, porque crearia una segunda cuenta del mismo contribuyente --
// y cada pantalla traduce esa lista a sus acciones. Un boton que el servidor va a
// rechazar es peor que no tenerlo: el vendedor lo aprieta y pierde el intento.
function botonSalida(accion, clase, c, i) {
  if (!accion) return '';
  return `<button class="btn btn-sm ${clase}" onclick="${accion.onclick(c, i)}">${escapeHtml(accion.texto)}</button>`;
}

// Hecho del nombre corto repetido (#242): este candidato usa EXACTAMENTE el
// mismo cust_ref que la cotizacion, y Operam lo exige unico en todo el padron
// (no dejaria crear el cliente). Es el unico hecho del picker que puede venir de
// un cliente con RFC REAL, al que la dedup de genericos (ADR-0001) nunca llega:
// por eso se muestra su razon social Y su RFC -- el vendedor tiene que poder ver
// que su cliente quiza ya existe bajo otro RFC antes de decidir.
function textoCustRefIgual(c) {
  const partes = [];
  if (c.CustName) partes.push(c.CustName);
  if (c.tax_id) partes.push(`RFC ${c.tax_id}`);
  const quien = partes.length ? `: ${partes.join(' - ')}` : '';
  return `Mismo nombre corto en Operam${quien}`;
}

// Lista inline (no modal, #83) de candidatos de la dedup por nombre (ADR-0001).
// TRES salidas, ninguna comoda (#204 ajuste, #211): elegir el cliente correcto
// (elegirCandidatoOperam -> { customerId }), declarar que el negocio capturado es
// otra plaza de ese cliente (marcarSucursalOperam -> { sucursalDe }) o que ninguno
// lo es (crearNuevoClienteOperam -> { crearNuevo: true }). El orden va de la
// opcion mas conservadora a la que mas cuentas crea. "Dejar como PRE" se QUITO de
// aqui: dejaba al vendedor con un documento entregable y un duplicado sin
// resolver, que es justo lo que la dedup viene a evitar. Mientras no resuelva, el
// documento queda bajo candado (motivoPre 'dedup') y el registro se borra a las
// 24 horas. dejarPreOperam sigue vivo para el PRE por fallo de Operam, que no
// cambia. Los botones pasan `this` -- NUNCA un id de contenedor: la misma
// cotizacion puede estar pintada en dos paneles a la vez (Historial y
// cotizaciones previas del cliente) y un id duplicado haria que getElementById
// pintara siempre en el primero, posiblemente oculto (F2 de la revision). app.js
// resuelve el slot relativo al elemento clickeado.
// #210: cada candidato trae hechos (diferenciaNombre, celularMatch, correoMatch)
// que se pintan como evidencia -- ninguna combinacion bloquea ni deshabilita
// Elegir/Crear nuevo, el humano sigue decidiendo.
// LA pieza de los candidatos, compartida por los dos sitios donde el vendedor
// contesta la pregunta de duplicado (#368): la pantalla de cotizar y el
// formulario de alta. Mismo HTML y mismos hechos; lo unico que cambia son las
// etiquetas y los `onclick`, que cada pantalla dicta en `acciones` --
// `{ usar, otroDomicilio, ninguno }`, cada una `{ texto, onclick }`, donde
// `onclick` recibe el candidato y su indice y devuelve la llamada ya escrita. Una
// accion NULA es una salida que no se ofrece y no se pinta (#377, ver botonSalida).
export function buildCandidatosDedupHtml(candidatos, mensaje, acciones) {
  const items = (candidatos || []).map((c, i) => {
    // #196: mismo formato unico de parentesis que el resto de la app (antes
    // separador ad hoc " . cust_ref").
    const nombre = escapeHtml(nombreConCorto(c.CustName || c.cust_name || 'Sin nombre', c.cust_ref));
    const diffTexto = textoDiferenciaNombre(c.diferenciaNombre);
    const diffHtml = diffTexto ? `<div class="operam-candidato-diff">${escapeHtml(diffTexto)}</div>` : '';
    const letreros = `<div class="operam-candidato-letreros">${letreroMatch('Celular', c.celularMatch)}${letreroMatch('Correo', c.correoMatch)}</div>`;
    const custRefHtml = c.custRefIgual ? `<div class="operam-candidato-custref">${escapeHtml(textoCustRefIgual(c))}</div>` : '';
    return `<li class="operam-candidato">
      <div class="operam-candidato-info">
        <span class="operam-candidato-nombre">${nombre}</span>
        ${custRefHtml}
        ${diffHtml}
        ${letreros}
      </div>
      <div class="operam-candidato-acciones">
        ${botonSalida(acciones.usar, 'btn-primary', c, i)}
        ${botonSalida(acciones.otroDomicilio, 'btn-secondary', c, i)}
      </div>
    </li>`;
  }).join('');
  return `<div class="operam-status operam-status-candidatos">
    <div class="operam-candidatos-msg">${escapeHtml(mensaje || 'Elige el Cliente Operam correcto:')}</div>
    <ul class="operam-candidatos-lista">${items}</ul>
    ${botonSalida(acciones.ninguno, 'btn-secondary')}
  </div>`;
}

// En la pantalla de cotizar las salidas llegan como la LISTA del modulo (#377):
// los onclick de aqui no son cuerpos dictados sino llamadas a los handlers de la
// cotizacion. Sin lista se conservan las tres: quitar botones por un dato ausente
// dejaria al vendedor sin ninguna salida.
export function buildCandidatosOperamHtml(id, candidatos, mensaje, salidas) {
  const hay = s => !Array.isArray(salidas) || salidas.includes(s);
  return buildCandidatosDedupHtml(candidatos, mensaje, {
    usar: hay('usar') ? { texto: 'Elegir', onclick: c => `elegirCandidatoOperam(${id}, ${c.id}, this)` } : null,
    otroDomicilio: hay('otro-domicilio') ? { texto: 'Es otro domicilio de este Cliente Operam', onclick: c => `marcarSucursalOperam(${id}, ${c.id}, this)` } : null,
    ninguno: hay('ninguno') ? { texto: 'Ninguno es el mismo Cliente Operam - crear nuevo', onclick: () => `crearNuevoClienteOperam(${id}, this)` } : null,
  });
}

// La misma pieza en el formulario de alta (#368), con las tres salidas de la
// Deduplicacion de cliente en palabras del glosario. Los handlers reciben el
// INDICE del candidato -- no su id --: el navegador ya tiene el cuerpo de
// reintento que el servidor dicto para cada uno y solo tiene que dar con el suyo.
// En el formulario cada salida se pinta solo si el servidor dicto CON QUE cuerpo
// se reintenta (#377): `opciones` son esos cuerpos y no se interpretan, asi que
// "hay boton" y "hay con que reintentar" son la misma cosa -- un boton sin cuerpo
// dictado moriria en el "vuelve a presionar Dar de alta" de cuerpoDeReintentoAlta.
export function buildCandidatosAltaHtml(candidatos, mensaje, detalle, opciones) {
  // Sin opciones dictadas NO se quitan botones, misma regla que la pantalla de
  // cotizar: una pregunta sin ninguna salida deja al vendedor sin nada que
  // apretar, y el boton que no tenga cuerpo ya muere con el "vuelve a presionar
  // Dar de alta" de cuerpoDeReintentoAlta. Con opciones, solo lo que dicen.
  const porCandidato = Array.isArray(opciones?.porCandidato) ? opciones.porCandidato : null;
  const dictada = llave => porCandidato === null || porCandidato.some(f => f && f[llave]);
  const pregunta = buildCandidatosDedupHtml(candidatos, mensaje, {
    usar: dictada('usar') ? { texto: 'Usar este Cliente Operam', onclick: (c, i) => `altaPreguntaUsar(${i})` } : null,
    otroDomicilio: dictada('otroDomicilio') ? { texto: 'Es otro domicilio de este Cliente Operam', onclick: (c, i) => `altaPreguntaOtroDomicilio(${i})` } : null,
    ninguno: (porCandidato === null || opciones?.ninguno) ? { texto: 'Ninguno es el mismo', onclick: () => 'altaPreguntaNinguno()' } : null,
  });
  // Mensaje en dos capas (CONTEXT.md): de que pool salieron estos candidatos se
  // muestra PLEGADO, igual que el detalle de cada paso del alta.
  if (!detalle) return pregunta;
  return `${pregunta}<details class="operam-paso-detalle"><summary>Ver detalle t&eacute;cnico</summary><div>${escapeHtml(detalle)}</div></details>`;
}

// Un Cliente Operam nombrado para la pregunta de #345: razon social si el padron
// la alcanzo a dar, y siempre su id -- sin nombre el vendedor todavia puede
// buscarlo en Operam, sin id no tendria nada.
function textoClienteOperam(c) {
  const k = c || {};
  const id = k.customerId != null ? `#${k.customerId}` : '';
  const nombre = k.nombre ? `${k.nombre} ` : '';
  return `${nombre}${id}`.trim();
}

// La pregunta de #345 (spec #337 user story 13): el celular ya esta ligado a otro
// Cliente Operam y la salida NO es un error sino una decision del vendedor. Una
// sola salida afirmativa ("si, es otra razon social del mismo Contacto") que
// reintenta con la confirmacion; la negativa es dejar la cotizacion como PRE, el
// mismo boton que ya existe para el fallo de Operam. La liga que vino del indice
// de Operam se marca como tal: no la decidio el cotizador y puede ser un telefono
// compartido. Los botones pasan `this` (ver buildCandidatosOperamHtml).
function buildOtraRazonSocialHtml(id, vista) {
  const ligado = (vista.ligado || []).map(c => {
    const origen = c.fuente === 'operam' ? ' <span class="operam-status-nota">(seg&uacute;n Operam)</span>' : '';
    return `<li>${escapeHtml(textoClienteOperam(c))}${origen}</li>`;
  }).join('');
  const elegido = vista.elegido ? escapeHtml(textoClienteOperam(vista.elegido)) : '';
  // El cuerpo del reintento lo dicta el servidor (`reintentar`): la pregunta
  // puede nacer de un candidato elegido, de "es sucursal de este cliente" o del
  // camino normal, y cada uno se reintenta distinto. Va serializado en el
  // onclick, mismo patron que la fila "Crear contacto" del paso Cliente.
  const cuerpo = JSON.stringify(vista.reintentar || { otraRazonSocial: true }).replace(/"/g, '&quot;');
  return `<div class="operam-status operam-status-candidatos">
    <div class="operam-candidatos-msg">${escapeHtml(vista.mensaje || '')}</div>
    <div>Este celular ya est&aacute; ligado a:</div>
    <ul class="operam-candidatos-lista">${ligado}</ul>
    <div>La cotizaci&oacute;n va a: <strong>${elegido}</strong></div>
    <button class="btn btn-sm btn-primary" onclick="confirmarOtraRazonSocialOperam(${id}, ${cuerpo}, this)">S&iacute;, es otra raz&oacute;n social del mismo Contacto</button>
    <button class="btn btn-sm btn-secondary" onclick="dejarPreOperam(${id}, this)">No, dejar como PRE</button>
  </div>`;
}

// Estado de la auto-subida (#83) para pintar en el resumen (al generar) o en la
// tarjeta del historial (al reintentar). Unica fuente del bloque de estado, sobre
// la vista pura de interpretarSubidaOperam. 'folio' = subio (verde), con nota si
// yaSubida (F1c: la regeneracion local no viaja a Operam); 'candidatos' = lista
// de dedup; 'sin_datos' = PRE sin reintento (falta de datos, no de Operam);
// 'pre' = fallo transitorio de Operam con Reintentar idempotente. Los botones
// pasan `this` (ver buildCandidatosOperamHtml).
// El reporte de pasos en dos capas (#364): el mensaje del glosario a la vista y el
// detalle tecnico dentro de un <details>, cerrado. Sin pasos que reportar no pinta
// nada -- un contenedor vacio solo agrega ruido a la subida que salio bien.
function buildPasosAltaHtml(pasos) {
  const lista = Array.isArray(pasos) ? pasos : [];
  if (!lista.length) return '';
  const items = lista.map(p => {
    const detalle = p.detalle
      ? `<details class="operam-paso-detalle"><summary>Ver detalle t&eacute;cnico</summary><div>${escapeHtml(p.detalle)}</div></details>`
      : '';
    return `<li class="operam-paso operam-paso-${escapeHtml(p.estado || 'warn')}">${escapeHtml(p.mensaje || '')}${detalle}</li>`;
  }).join('');
  return `<ul class="operam-pasos">${items}</ul>`;
}

export function buildOperamStatusHtml(id, vista) {
  const v = vista || {};
  const pasos = buildPasosAltaHtml(v.pasos);
  if (v.estado === 'folio') {
    const folio = v.folio != null && v.folio !== '' ? ` — <strong>${escapeHtml(etiquetaFolioOperam({ folioOperam: v.folio }))}</strong>` : '';
    // yaSubida (#83 F1c) cambia de significado con #114: el endpoint ya solo corta sin
    // tocar Operam cuando el contenido NO cambio (regenerar el mismo carrito en otro
    // formato). Un cambio real ya no se queda en local -- viaja por el camino de
    // actualizacion (#104) -- asi que la nota vieja ("los cambios locales no actualizan
    // la cotizacion ya subida") describia el bug de #114, no el comportamiento.
    const nota = v.yaSubida
      ? ` <span class="operam-status-nota">El contenido no cambio: el quote de Operam ya coincide.</span>`
      : '';
    // #93: cliente generico recien creado/reutilizado -- se ofrece la CSF junto al
    // folio, mismo flujo de upgrade del chip Fiscal (#85), sin duplicar logica.
    const csf = v.clienteGenerico && v.customerId != null
      ? ` <button type="button" class="btn btn-sm btn-secondary" onclick="pcAbrirUpgradeFiscal(${v.customerId}, null, 'resumen')">&iquest;Ya tienes su CSF? Subela</button>`
      : '';
    // #106: el post-fix de la vigencia no pego. La cotizacion esta BIEN (el PDF y las
    // notas del quote llevan la fecha correcta); lo que queda mal es el campo nativo
    // que se ve en Operam, que ademas la marcaria como vencida. Se avisa sin alarmar:
    // la subida fue un exito, esto es un detalle a revisar en Operam.
    const vig = v.vigencia === 'revisar'
      ? ` <span class="operam-status-nota">Revisa el campo &laquo;V&aacute;lido hasta&raquo; en Operam: pudo no quedar corregido. El PDF y las notas de la cotizacion si llevan la vigencia correcta.</span>`
      : '';
    return `<span class="operam-status operam-status-ok">Subida a Operam${folio}</span>${nota}${vig}${csf}${pasos}`;
  }
  if (v.estado === 'candidatos') {
    return buildCandidatosOperamHtml(id, v.candidatos, v.mensaje, v.opciones);
  }
  if (v.estado === 'otra_razon_social') {
    return buildOtraRazonSocialHtml(id, v);
  }
  if (v.estado === 'sin_datos') {
    return `<span class="operam-status operam-status-pre"><span class="cot-badge badge-pre">PRE</span> ${escapeHtml(v.mensaje || '')}</span>${pasos}`;
  }
  // #242: choque de nombre corto. SIN Reintentar a proposito (mismo criterio que
  // 'sin_datos'): el boton volveria a chocar contra la unicidad global del
  // cust_ref. Lo que resuelve es cambiar el nombre corto en el paso Cliente y
  // volver a generar; el texto del servidor es el que lo dice, con el dueno del
  // nombre corto cuando el padron alcanza a nombrarlo.
  if (v.estado === 'cust_ref') {
    return `<span class="operam-status operam-status-pre"><span class="cot-badge badge-pre">PRE</span> ${escapeHtml(v.mensaje || '')}</span>${pasos}`;
  }
  return `<span class="operam-status operam-status-pre"><span class="cot-badge badge-pre">PRE</span> ${escapeHtml(v.mensaje || 'No se pudo subir a Operam')}</span>` +
    ` <button class="btn btn-sm btn-primary" onclick="reintentarSubidaOperam(${id}, this)">Reintentar</button>` + pasos;
}

// --- Actualizacion del quote conservando el folio (#104, ADR-0008) -----------
// Respuesta de POST /api/cotizacion/operam/:id/actualizar leida como estado de UI,
// por campos estructurados y NUNCA parseando el string de error (misma disciplina
// que interpretarSubidaOperam). La distincion que de verdad importa para el vendedor
// es `escrito`:
//   ok: true                      -> 'actualizada'    (mismo folio, quote reescrito)
//   ok: false, escrito: false     -> 'desactualizado' (se aborto ANTES de confirmar:
//                                    el quote en Operam quedo INTACTO -- la palanca
//                                    de robustez del ADR -- y reintentar es seguro)
//   ok: false, escrito: true      -> 'revisar'        (se confirmo pero la
//                                    verificacion vio diferencias: alguien tiene que
//                                    mirar el ERP)
//   409                           -> 'bloqueada'      (gate: PRE o con pedido; un
//                                    reintento volveria a fallar igual)
// Los pasos que hay que LEER viajan tambien aqui desde #403: la lista del encabezado
// se escribe en este camino igual que en la subida, y puede no quedar (formulario sin
// el select, lista fuera de sus opciones) sin que la actualizacion falle. Con `ok` y
// un paso en warn el vendedor tiene que enterarse igual: si no, el unico rastro de que
// el quote quedo con la lista del cliente seria el log del servidor.
export function interpretarActualizacionOperam(resultado) {
  const r = resultado || {};
  const pasos = pasosParaMostrar(r.steps);
  if (r.ok) return { estado: 'actualizada', folio: r.folio ?? null, pasos };
  if (r.status === 409) {
    return { estado: 'bloqueada', mensaje: r.error || 'Esta cotizacion no se puede actualizar en Operam', pasos };
  }
  const discrepancias = Array.isArray(r.discrepancias) ? r.discrepancias : [];
  if (r.escrito === true) {
    return { estado: 'revisar', mensaje: r.error || 'La cotizacion se confirmo en Operam pero no quedo como se esperaba', discrepancias, pasos };
  }
  return { estado: 'desactualizado', mensaje: r.error || 'No se pudo actualizar la cotizacion en Operam', discrepancias, pasos };
}

// Estado de la actualizacion para pintar en el slot (resumen o tarjeta). Mismo
// contrato de botones que buildOperamStatusHtml: pasan `this`, nunca un id de
// contenedor (la misma cotizacion puede estar pintada en dos paneles a la vez).
export function buildActualizacionStatusHtml(id, vista) {
  const v = vista || {};
  const pasos = buildPasosAltaHtml(v.pasos);
  if (v.estado === 'actualizada') {
    const folio = v.folio != null && v.folio !== '' ? ` — <strong>${escapeHtml(etiquetaFolioOperam({ folioOperam: v.folio }))}</strong>` : '';
    return `<span class="operam-status operam-status-ok">Cotizaci&oacute;n actualizada en Operam${folio}</span>${pasos}`;
  }
  // Bloqueada = el quote ya se convirtio en pedido y Operam no deja editarlo. Desde
  // #504 no se entrega documento (seria un folio con un contenido que el quote no
  // tiene), y el quote se queda con el contenido viejo, asi que ademas del motivo se
  // ofrece la UNICA salida real, la misma que da el historial -- crear una
  // cotizacion nueva a partir de esta. Se reusa cargarCotizacion(id, 'nueva') en vez de inventar un
  // simbolo nuevo para el onclick (trampa de #112).
  if (v.estado === 'bloqueada') {
    return `<span class="operam-status operam-status-pre"><span class="cot-badge badge-pre">Operam desactualizado</span> ${escapeHtml(v.mensaje || '')}</span>` +
      ` <button class="btn btn-sm btn-primary" onclick="cargarCotizacion(${id}, 'nueva')">Copiar cotizaci&oacute;n</button>` + pasos;
  }
  const aviso = (badge, texto) =>
    `<span class="operam-status operam-status-pre"><span class="cot-badge badge-pre">${badge}</span> ` +
    `${texto} ${escapeHtml(v.mensaje || '')}</span>` +
    ` <button class="btn btn-sm btn-primary" onclick="reintentarActualizacionOperam(${id}, this)">Reintentar</button>` + pasos;
  if (v.estado === 'revisar') {
    return aviso('Revisar', 'El cambio se confirm&oacute; en Operam pero la verificaci&oacute;n vio diferencias: revisa el quote en Operam.');
  }
  return aviso('Operam desactualizado', 'No se pudo actualizar el quote; en Operam qued&oacute; SIN cambios (intacto).');
}

// Badge de la tarjeta del historial: el registro del cotizador se actualizo pero el
// quote de Operam no. Se marca porque el pedido se surte contra Operam, asi que una
// divergencia silenciosa es justo el problema que #104 vino a cerrar.
// Con pedido (#528, decision 8) reintentar ya no sirve -- el gate lo bloquea --: la
// etiqueta dice que se copie la cotizacion.
export function badgeQuoteDesactualizadoHtml(cot) {
  if (!cot || !cot.quoteDesactualizado) return '';
  if (tienePedidoAsociado(cot)) {
    return ` <span class="cot-badge badge-pre" title="El registro del cotizador cambio pero el quote de Operam no, y ya tiene pedido: no se puede actualizar, copia la cotizacion">Operam desactualizado: copia la cotizaci&oacute;n</span>`;
  }
  return ` <span class="cot-badge badge-pre" title="El registro del cotizador se actualizo pero el quote de Operam no: reintenta desde la cotizacion">Operam desactualizado</span>`;
}

// Boton "Reintentar subida" de la tarjeta de cotizacion (Historial): reintenta la
// auto-subida idempotente (#81) cuando la cotizacion quedo PRE. Con ADR-0006 PRE
// pasa de ser un modo elegido ("Completar") a un fallo transitorio a reintentar;
// solo aparece mientras la cotizacion es PRE (sin folio, no historica). Dispara
// completarPreCotizacion(id, this) en app.js, que resuelve el slot de SU tarjeta.
export function botonCompletarHtml(cot) {
  if (!puedeCompletarPreCotizacion(cot)) return '';
  return `<button class="btn btn-primary btn-sm" onclick="completarPreCotizacion(${cot.id}, this)">Reintentar subida</button>`;
}

// Boton + global (issue #54, PRD #52 historias 4-5): visible en todos los
// destinos del bottom-nav, ofrece dos acciones -- "Nueva cotizacion" (la vista
// de cotizar existente) y "Nuevo prospecto" (la captura minima existente).
// Cada accion dispara la funcion homonima de app.js.
export const ACCIONES_NUEVO = [
  { label: 'Nueva cotizacion', accion: 'nuevaCotizacion' },
  { label: 'Nuevo prospecto', accion: 'nuevoProspecto' },
  { label: 'Nuevo Cliente Operam', accion: 'nuevoCliente' },
];

// Captura de expo (issue #267): el "+" es su UNICA entrada, y solo con evento
// activo (CONTEXT.md "Captura de expo"). Va primero porque en expo es LA accion
// del vendedor; fuera de expo el menu queda exactamente como siempre.
const ACCION_NUEVO_EXPO = { label: 'Nuevo prospecto expo', accion: 'nuevoProspectoExpo' };

export function buildMenuNuevoHtml(hayEventoActivo = false) {
  const acciones = hayEventoActivo ? [ACCION_NUEVO_EXPO, ...ACCIONES_NUEVO] : ACCIONES_NUEVO;
  return acciones
    .map(a => `<button class="btn btn-sm btn-secondary" onclick="${a.accion}()">${escapeHtml(a.label)}</button>`)
    .join('');
}

// === Vista Clientes (issue #94): mantenimiento de clientes desde el cotizador ===
// Reusa el buscador mixto y los chips del paso Cliente (alta-logica.js); estas
// funciones puras solo componen el HTML de la vista (filas, tarjeta, banner). Los
// onclick disparan las funciones cv* de app.js (wiring de DOM, no testeable en Node).

function inicialesCliente(nombre) {
  const p = String(nombre || '').split(/\s+/).filter(Boolean);
  return ((p[0] || ' ')[0] + ((p[1] || ' ')[0] || '')).toUpperCase().trim() || '?';
}

// El tag de una fila de resultado: el ESTADO FISCAL del Cliente Operam en rojo
// cuando es "Sin datos fiscales" (saltan a la vista para completarlos, #94) y en
// azul cuando ya los tiene; gris "Prospecto" para la fila del Contacto.
//
// El estado lo manda el servidor (#344): ahi se decide contra el RFC que Operam
// tiene HOY. El respaldo por RFC de la propia fila es para una fila que venga de
// otra fuente (o de una respuesta anterior a #344) -- misma regla, peor dato.
// Antes decia "RFC generico" y "Operam": "generico" describe al RFC y no a la
// persona, y la etiqueta tiene que decirle al vendedor que hacer (ADR-0016).
export function sinDatosFiscales(r) {
  const row = r || {};
  return row.fiscal ? row.fiscal === SIN_DATOS_FISCALES : esRfcGenerico(row.rfc);
}

export function tagResultadoClienteHtml(r) {
  const row = r || {};
  if (row.tipo !== 'operam') return '<span class="pc-tag prospecto">Prospecto</span>';
  const sinDatos = sinDatosFiscales(row);
  const estado = sinDatos ? SIN_DATOS_FISCALES : CON_DATOS_FISCALES;
  return `<span class="pc-tag ${sinDatos ? 'generico' : 'operam'}">${escapeHtml(ETIQUETA_FISCAL[estado])}</span>`;
}

// El estado COMERCIAL de la fila, y solo cuando dice algo que el vendedor tiene
// que ver: "Ya compro" (#500; el valor sigue siendo con_pedido). "cotizado" y "sin actividad" no se pintan -- una fila
// con tres etiquetas deja de leerse de un vistazo, y el hueco de los quotes web
// (fuenteIncompleta) haria de "sin actividad" una afirmacion que no se sostiene.
export function tagPedidoClienteHtml(r) {
  const row = r || {};
  if (row.comercial !== CON_PEDIDO) return '';
  return `<span class="pc-tag con-pedido">${escapeHtml(ETIQUETA_COMERCIAL[CON_PEDIDO])}</span>`;
}

// Accion "Editar" de la fila (#198): puerta de entrada explicita por tipo, sin
// mover ni duplicar la fila de alta (#190). Cliente Operam abre el MISMO panel
// de upgrade (#85/#197) rotulado como edicion (cvEditarClienteFila, en app.js,
// resuelve el customer_id desde el cache de resultados). Prospecto en etapa
// activa despliega inline el formulario de #66: reusa buildEdicionProspectoFormHtml
// y el MISMO guardarEdicionProspecto global que ya usa la card del tablero
// (mismo contenedor pr-edicion-<id>, mismo formId prospecto-edicion-<id> del
// borrador de #185) -- casi cero codigo nuevo de guardado. Abrir pasa por
// cvAbrirEdicionProspectoFila (app.js), no directo por abrirEdicionProspecto:
// el mismo prospecto puede tener OTRO nodo pr-edicion-<id> montado y oculto en
// la vista Prospectos (buildProspectoCardHtml, #66) si el vendedor la visito
// antes en esta sesion -- ocultarTodasLasVistas() solo esconde esa vista, no
// destruye su DOM, y con el id duplicado document.getElementById siempre
// resolveria ESE nodo ajeno (aparece primero en el documento), no el de esta
// fila. El wrapper desmonta ese huerfano antes de abrir. El formulario nace
// SIEMPRE cerrado; un nuevo render de #cv-zona (otra busqueda) lo sustituye por
// uno igual de cerrado, asi que un formulario abierto se pierde con el
// siguiente render (decision de #198: aceptable y simple, no hay estado de
// "esta fila esta editandose" que preservar). Un prospecto en etapa de salida
// (no_util/perdida/cancelada) no ofrece la accion: el servidor ya rechaza esa edicion
// con 400 (#66).
function botonEditarFilaHtml(onclick, texto) {
  return '<div style="margin:-2px 0 8px 4px">' +
    '<button type="button" class="btn btn-secondary btn-sm" onclick="' + onclick + '">' + texto + '</button>' +
    '</div>';
}

function accionEditarFilaHtml(row, i) {
  if (row.tipo === 'operam') {
    return botonEditarFilaHtml('cvEditarClienteFila(' + i + ')', 'Editar datos de Cliente Operam');
  }
  // #346: la vista dejo de listar prospectos sueltos y lista CONTACTOS, asi que
  // la puerta de #198 es la misma sobre la persona -- mismo formulario inline,
  // mismo guardarEdicionProspecto, mismo id pr-edicion-<id>. Sigue sin ofrecerse
  // sobre una etapa de salida (el servidor rechaza esa edicion con 400, #66).
  if (row.tipo === 'contacto' && row.raw && !esSalida(row.raw.etapa)) {
    return botonEditarFilaHtml('cvAbrirEdicionProspectoFila(' + row.raw.id + ')', 'Editar Contacto') +
      '<div id="pr-edicion-' + row.raw.id + '" style="display:none">' + buildEdicionProspectoFormHtml(row.raw) + '</div>';
  }
  return '';
}

export function filaResultadoClienteHtml(r, i) {
  const row = r || {};
  // #346: la fila de un Contacto es otra cosa -- la PERSONA con sus Clientes
  // Operam anidados -- y la pinta su propio builder.
  if (row.tipo === 'contacto') return filaContactoHtml(row, i);
  // #196: nombre corto (cust_ref) entre parentesis, formato unico. Solo en
  // filas 'operam' (row.ref = cust_ref real); prospectos no lo tienen.
  const nombreTexto = row.tipo === 'operam' ? nombreConCorto(row.nombre, row.ref) : (row.nombre || '');
  return '<button type="button" class="pc-res-row" onclick="cvElegirResultado(' + i + ')">' +
    '<span class="pc-res-ini ' + escapeHtml(row.tipo || '') + '">' + escapeHtml(inicialesCliente(row.nombre)) + '</span>' +
    '<span class="pc-res-main"><span class="pc-res-nombre">' + escapeHtml(nombreTexto) + '</span>' +
    '<span class="pc-res-sub">' + escapeHtml(row.sub || '') + '</span>' +
    // Origen (#287): heredado del prospecto del mismo celular, o sin identificar
    // cuando el cliente nunca fue prospecto en el cotizador.
    chipOrigenHtml(row) + '</span>' +
    tagResultadoClienteHtml(row) + tagPedidoClienteHtml(row) + '</button>' +
    accionEditarFilaHtml(row, i);
}

// Fila punteada que abre el alta COMPLETA (acordeon 1-4, POST /api/crear-cliente),
// no un prospecto minimo como en el paso Cliente (#94, pieza 3). Desde #190 tambien
// se pinta en el estado inicial de la vista Clientes, con el buscador vacio: sin
// query no hay nombre que entrecomillar y las comillas se omiten enteras.
export function filaCrearClienteHtml(query) {
  const q = String(query || '').trim();
  const conQuery = q ? ' &laquo;' + escapeHtml(q) + '&raquo;' : '';
  return '<button type="button" class="pc-res-row pc-crear" onclick="cvCaminoAlta(' + JSON.stringify(q).replace(/"/g, '&quot;') + ')">' +
    '<span class="pc-res-ini">+</span>' +
    '<span class="pc-res-main"><span class="pc-res-nombre">Dar de alta Cliente Operam completo' + conQuery + '</span>' +
    '<span class="pc-res-sub">Con datos fiscales, comerciales y domicilio &mdash; sin cotizacion</span></span></button>';
}

// Banner de contexto del upgrade fiscal (#94): hace visible CONTRA QUIEN se
// actualiza. Se muestra siempre que altaCsfState.modoUpgrade este activo (tambien
// cuando el upgrade se abre desde el paso Cliente).
export function bannerUpgradeHtml(ctx) {
  const c = ctx || {};
  const nombre = c.nombre || 'este Cliente Operam';
  const id = c.id != null ? String(c.id) : '';
  const rfc = c.rfc || '';
  const texto = esRfcGenerico(rfc)
    ? 'RFC generico ' + escapeHtml(rfc) + ' se sustituira con el RFC real de la CSF. No se crea un Cliente Operam nuevo.'
    : 'Editando datos de: ' + escapeHtml(nombre) + '. RFC actual: ' + escapeHtml(rfc || 'pendiente') +
      '. La CSF es opcional; el RFC solo cambia si subes una CSF con otro RFC.';
  return '<div class="banner-upgrade"><span>&#8635;</span>' +
    '<div><b>Actualizando: ' + escapeHtml(nombre) + (id ? ' (ID ' + escapeHtml(id) + ')' : '') + '</b>' +
    '<small>' + texto + '</small></div></div>';
}

// Rotulo del panel de upgrade fiscal segun de donde se llega (#198): el
// chip/boton Fiscal existente sigue diciendo "Completar datos fiscales"; la
// puerta nueva "Editar datos de Cliente Operam" (accion de la fila en Resultados)
// dice eso. Cambio de texto visible unicamente -- el panel y su flujo (PUT
// #85, CSF opcional) son el mismo en los dos casos.
export function rotuloPanelUpgrade(editar) {
  return editar ? 'Editar datos de Cliente Operam' : 'Completar datos fiscales';
}

// Chips de completitud de la tarjeta en la vista Clientes. A diferencia del paso
// Cliente, Contacto y Entrega son informativos (no hay paso Envio a donde ir); solo
// el chip Fiscal pendiente es accionable (abre el upgrade) cuando hay cliente en Operam.
export function chipsClienteViewHtml(chips, custId) {
  const c = chips || {};
  const contacto = c.contacto
    ? '<span class="pc-chip ok">&#10003; Contacto</span>'
    : '<span class="pc-chip pend">Contacto</span>';
  const entrega = c.entrega === 'completo'
    ? '<span class="pc-chip ok">&#10003; Entrega</span>'
    : c.entrega === 'cp'
      ? '<span class="pc-chip parcial">Entrega &middot; CP</span>'
      : '<span class="pc-chip pend">Entrega &middot; pendiente</span>';
  const fiscal = c.fiscal
    ? '<span class="pc-chip ok">&#10003; Fiscal</span>'
    : (custId != null
        ? '<button type="button" class="pc-chip-btn" onclick="cvAbrirUpgrade()"><span class="pc-chip pend">Fiscal &middot; subir CSF</span></button>'
        : '<span class="pc-chip pend">Fiscal &middot; al subir a Operam</span>');
  return contacto + entrega + fiscal;
}

export function cardClienteHtml(cliente) {
  const c = cliente || {};
  const chips = chipsCompletitud(c);
  const custId = customerIdFiscal(c);
  const esOperam = c.tipo === 'operam';
  // #196: nombre corto entre parentesis. La regla de igualdad de nombreConCorto
  // protege el caso prospecto/contacto nuevo, donde ref ES el propio nombre.
  const nombre = nombreConCorto(c.name || c.ref || 'Sin nombre', c.ref);
  // #427: el telefono del Cliente Operam es el de la fila del servidor, el primero
  // de `telefonos` (Cel > Telefono > Secundario, #426), tal como lo guarda Operam.
  const subPartes = esOperam
    ? [c.rfc, c.telefono, 'Cliente en Operam' + (c.id != null ? ' (ID ' + c.id + ')' : '')]
    : [c.telefono, c.ciudad || c.municipio, 'Prospecto'];
  const sub = subPartes.filter(Boolean).map(escapeHtml).join(' &middot; ');
  const botonCsf = mostrarBotonCsf(c)
    ? '<button type="button" class="btn btn-primary btn-block" style="margin-top:16px" onclick="cvAbrirUpgrade()">Completar datos fiscales (CSF)</button>'
    : '';
  return '<div class="pc-cli-card">' +
    '<div class="pc-cli-nombre">' + escapeHtml(nombre) + '</div>' +
    '<div class="pc-cli-sub">' + sub + '</div>' +
    '<div style="margin-top:8px">' + chipOrigenHtml(c) + '</div>' +
    '<div class="pc-chips">' + chipsClienteViewHtml(chips, custId) + '</div>' +
    botonCsf +
    '<button type="button" class="btn btn-secondary btn-block" style="margin-top:8px" onclick="cvCotizar()">Cotizar a este Cliente Operam &rsaquo;</button>' +
    '</div>';
}

// Las oportunidades que viven en el pipeline (las 7 columnas): excluye las
// salidas No util, Perdida y Cancelada, que viven en filtro/historial. Es la misma regla
// que aplica el tablero (agruparPipeline ignora las salidas); la vista lista la
// usa para no mostrar lo que el tablero oculta. Una sola fuente de "que es
// activo".
export function oportunidadesActivas(oportunidades) {
  return (oportunidades || []).filter(o => !esSalida(o.etapa));
}

// Reparte las oportunidades en las 7 columnas por su etapa. Las salidas quedan
// fuera del tablero. Cada columna se ordena de la mas reciente a la mas antigua
// cuando la oportunidad trae fecha.
export function agruparPipeline(oportunidades) {
  const cols = {};
  for (const c of COLUMNAS_PIPELINE) cols[c] = [];
  for (const o of oportunidades || []) {
    if (cols[o.etapa]) cols[o.etapa].push(o);
  }
  for (const c of COLUMNAS_PIPELINE) {
    cols[c].sort((a, b) => fechaLocal(b.fecha || 0) - fechaLocal(a.fecha || 0));
  }
  return cols;
}

function fmtMoneda(n) {
  if (n == null) return '0.00';
  return n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// La identidad de la tarjeta es la oportunidad: el nombre del prospecto antes de
// cotizar, el cliente de la cotizacion despues. En este slice la tarjeta solo
// existe y se ve en su columna; las acciones (transiciones, drag) llegan en
// issues posteriores.
function nombreOportunidad(o) {
  return o.nombre || o.cliente || 'Sin nombre';
}

// Badge HTML del estado de folio de una cotizacion: '' si es historica de
// registro desconocido (sin etiqueta), si no el chip "PRE" (ambar) o "Cotizacion N"
// (azul). Unica fuente del badge: la reusan el tablero, la cola Hoy y la vista
// lista, para que las tres pinten lo mismo (incluido el caso sin badge).
export function badgeFolioOperamHtml(cot) {
  const etiqueta = etiquetaFolioOperam(cot);
  if (!etiqueta) return '';
  const clase = etiqueta === 'PRE' ? 'badge-pre' : 'badge-operam';
  // #285: una PRE con motivo conocido se explica en el propio chip, en lugar del
  // "PRE" mudo. etiquetaFolioOperam NO cambia: sigue siendo la regla de dominio
  // que decide si la cotizacion es PRE (puedeCompletarPreCotizacion la lee).
  const texto = (etiqueta === 'PRE' && leyendaPre(cot)) || etiqueta;
  return `<span class="cot-badge ${clase}">${escapeHtml(texto)}</span>`;
}

// Badge de folio de un PROSPECTO movido a mano a Seguimiento (issue #56, AC3,
// CONTEXT.md "Etapas del pipeline"): el vendedor cotizo POR FUERA, asi que no hay
// cotizacion en el sistema y el folio vive en el prospecto (data.folioOperam,
// mapeado a o.folioOperam por prospectoAOportunidad). Muestra "Cotizacion N" SOLO si
// hay folio; jamas "PRE" (PRE es un concepto de cotizacion, no de prospecto). Sin
// folio no pinta nada. Reusa etiquetaFolioOperam unicamente cuando hay folio.
export function badgeFolioOperamProspectoHtml(o) {
  const folio = o && o.folioOperam;
  if (folio == null || folio === '') return '';
  return `<span class="cot-badge badge-operam">${escapeHtml(etiquetaFolioOperam({ folioOperam: folio }))}</span>`;
}

// El badge de la tarjeta del tablero depende del tipo de oportunidad: una
// cotizacion lleva el chip PRE / Cotizacion N (issue #63); un prospecto solo lleva
// Cotizacion N si fue movido a mano con folio (issue #56), nunca PRE.
function badgeFolioOperam(o) {
  return o.tipo === 'cotizacion' ? badgeFolioOperamHtml(o) : badgeFolioOperamProspectoHtml(o);
}

// Texto compacto de la cadena de folios de Operam (issue #67, AC4) a partir del
// espejo persistido (data.espejoOperam de #67 AC3). Muestra SOLO los eslabones
// presentes, en orden de la cadena post-venta: cotizacion -> pedido -> factura ->
// remision -> estado de pago. El pago es un ESTADO derivado de la factura
// ('anticipo'/'pagado'), no un folio (los pagos/notas no son atribuibles a un pedido
// por la API, decision #67). Estilo del badge (denso, una linea):
//   "Cot #1141 - Pedido #7269 - Factura A1907 - Remision - Pagado". Sin espejo o sin
// eslabones devuelve cadena vacia (la tarjeta no pinta el elemento).
export function cadenaOperamTexto(espejo) {
  if (!espejo || typeof espejo !== 'object') return '';
  const partes = [];
  if (espejo.cotizacion) partes.push(`Cot #${espejo.cotizacion}`);
  if (espejo.pedido) partes.push(`Pedido #${espejo.pedido}`);
  if (espejo.factura && (espejo.factura.ref || espejo.factura.numero)) {
    partes.push(`Factura ${espejo.factura.ref || espejo.factura.numero}`);
  }
  if (Array.isArray(espejo.remisiones) && espejo.remisiones.length > 0) partes.push('Remision');
  if (espejo.pago === 'pagado') partes.push('Pagado');
  else if (espejo.pago === 'anticipo') partes.push('Anticipo');
  return partes.join(' - ');
}

// Elemento HTML de la cadena de folios para la tarjeta (issue #67, AC4). Vacio si
// no hay cadena (no ensucia la tarjeta de una oportunidad sin sync). Escapa el
// texto (los folios/refs vienen de Operam).
export function cadenaOperamHtml(espejo) {
  const texto = cadenaOperamTexto(espejo);
  if (!texto) return '';
  return `<div class="cot-cadena-operam">${escapeHtml(texto)}</div>`;
}

// Badge "Pago sin registrar" (issue #77): la tarjeta ya ENTREGADA (etapa
// producto_entregado) cuyo pago aun no aparece registrado en Operam. En el pipeline
// manda el cumplimiento (entrega), no la cobranza: la tarjeta llega a entregado con
// la remision y este sello marca la cobranza pendiente hasta que el pago se registre
// (el sync apaga el flag pagoSinRegistrar al liquidarse). Se ata a la etapa entregada
// para no contradecir una tarjeta topada por el gate de calca (#61): sin entrega no
// hay sello de entrega. Vacio en cualquier otro caso.
export function badgePagoSinRegistrarHtml(o) {
  if (!o || o.etapa !== 'producto_entregado' || !o.pagoSinRegistrar) return '';
  return '<span class="cot-badge badge-impago">Pago sin registrar</span>';
}

// Badge "Falta comprobante" (#485, CONTEXT.md "Comprobante de pago"): la tarjeta
// ya paso de Seguimiento sin el comprobante del primer pago. Aviso, no candado:
// la etapa la sigue moviendo Operam. Convive con "Pago sin registrar" (#77).
// #486: el del saldo lleva su propio badge, solo en una venta con anticipo.
export function badgeFaltaComprobanteHtml(o) {
  const primer = faltaComprobante(o) ? '<span class="cot-badge badge-falta-comprobante">Falta comprobante</span>' : '';
  const saldo = faltaComprobante(o, 'saldo') ? '<span class="cot-badge badge-falta-comprobante">Falta comprobante del saldo</span>' : '';
  return primer + saldo;
}

function diaDelComprobante(fecha) {
  const d = fechaLocal(fecha);
  if (isNaN(d)) return '';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

// El comprobante del primer pago en la tarjeta (#485): sus archivos y su fecha,
// y el selector para subirlo desde Seguimiento o despues (corregir un faltante).
// Solo COTIZACIONES, con el id numerico (refId), leccion del bug de #57.
// #486: con anticipo, un bloque aparte para el del saldo desde Pedido liberado,
// con sus propios archivos, selector y boton.
const COMPROBANTE_TARJETA = {
  primer: { titulo: 'Comprobante del primer pago', subir: 'Subir comprobante de pago', sufijo: '', arg: '' },
  saldo: { titulo: 'Comprobante del saldo', subir: 'Subir comprobante del saldo', sufijo: '-saldo', arg: ", 'saldo'" },
};

function comprobantePagoBloqueHtml(o, id, pago) {
  if (!puedeSubirComprobante(o, pago)) return '';
  const t = COMPROBANTE_TARJETA[pago];
  const c = comprobanteDe(o, pago);
  const archivos = c
    ? `<div class="comprobante-pago-archivos">${t.titulo} (${escapeHtml(diaDelComprobante(c.fecha))}): ${c.archivos.map(a => escapeHtml(a.nombre)).join(', ')}</div>`
    : '';
  return `<div class="cot-card-actions comprobante-pago-control">
    ${archivos}
    <input type="file" id="comprobante-pago-${id}${t.sufijo}" class="btn-sm" accept="${ACCEPT_COMPROBANTE}" multiple>
    <button class="btn btn-sm btn-secondary" onclick="subirComprobantePago(${id}${t.arg})">${c ? 'Agregar al comprobante' : t.subir}</button>
  </div>`;
}

export function buildComprobantePagoHtml(o) {
  if (!o || o.tipo !== 'cotizacion') return '';
  const id = o.refId ?? o.id;
  return comprobantePagoBloqueHtml(o, id, 'primer') + comprobantePagoBloqueHtml(o, id, 'saldo');
}

// Los dos estados del Cliente Operam de la Oportunidad, en la tarjeta (#344,
// spec #337 user stories 8-10). Los manda el servidor ya derivados de Operam:
// aqui NO se recalcula nada -- el RFC de la cotizacion puede ser el de antes de
// un upgrade fiscal, y esa es justo la etiqueta que no debe mentir.
//
// Sin Cliente Operam ligado (o con uno que el cache no conoce) no se pinta nada:
// una tarjeta sin etiqueta es mejor que una con la etiqueta equivocada. El
// estado comercial solo se pinta cuando es "Ya compro" (#500), por lo mismo que en la
// fila de resultado.
export function badgeClienteOperamHtml(o) {
  const cli = o && o.clienteOperam;
  if (!cli) return '';
  const fiscal = ETIQUETA_FISCAL[cli.fiscal];
  const badges = fiscal
    ? `<span class="cot-badge badge-fiscal-${cli.fiscal === SIN_DATOS_FISCALES ? 'pendiente' : 'listo'}">${escapeHtml(fiscal)}</span>`
    : '';
  const pedido = cli.comercial === CON_PEDIDO
    ? `<span class="cot-badge badge-con-pedido">${escapeHtml(ETIQUETA_COMERCIAL[CON_PEDIDO])}</span>`
    : '';
  return badges + pedido;
}

// Asignar vendedor desde la tarjeta (issue #57, CONTEXT.md "Etapas del pipeline"
// + "Visibilidad"): la PRIMERA accion de tarjeta del tablero, que hasta ahora era
// solo-lectura (#53). Solo aplica a una oportunidad en No Asignado (la unica que
// no tiene dueno). La regla de dominio simetrica vive en lib/pipeline
// (transicionPorAsignacion); aqui solo se decide si la tarjeta admite el control.
export function esAsignable(o) {
  return !!o && o.etapa === 'no_asignado';
}

// Permiso de asignacion (#156, spec #155, CONTEXT.md "Visibilidad"): ver la
// columna No Asignado y asignarle dueno a esas tarjetas. El admin lo tiene
// siempre; un vendedor lo puede tener por checkbox en /admin (el gerente
// comercial -- el sistema NO modela un rol gerente, decision explicita). Mismo
// patron y misma normalizacion defensiva que normalizarListasHabilitadas (#153, #296): basura o
// ausencia degradan a SIN permiso, nunca a permiso implicito.
export function normalizarPuedeAsignar(valor) {
  return valor === true;
}

export function puedeAsignar(vendedor) {
  if (!vendedor) return false;
  if (vendedor.role === 'admin') return true;
  return normalizarPuedeAsignar(vendedor.puedeAsignar);
}

// Control de asignacion sobre la tarjeta No Asignado: un selector con los
// vendedores del catalogo (GET /api/catalogos) + un boton que dispara
// asignarVendedorTablero(id, this) en app.js (PATCH /api/prospectos/:id/asignar).
// Solo lo ve quien tiene el permiso de asignacion (CONTEXT.md "Visibilidad"); quien
// no lo tiene ni siquiera recibe tarjetas No Asignado del servidor. Puede asignar a
// CUALQUIER vendedor del catalogo, no solo a si mismo. Sin vendedores en el
// catalogo no se pinta. Funcion pura: el cableado DOM vive en app.js.
//
// El boton pasa `this` y NUNCA un id de contenedor (mismo criterio que la lista de
// candidatos de Operam, #83 F2): desde #156 la MISMA tarjeta puede estar pintada a
// la vez en la cola Hoy y en el tablero -- las dos vistas solo se ocultan con
// display:none, su HTML sigue en el documento. Con getElementById el boton del
// tablero leeria el select de Hoy (precede en el documento) y asignaria al vendedor
// que quedo elegido en la otra vista, o avisaria "elige un vendedor" con uno ya
// elegido. `superficie` ademas evita el id duplicado entre ambas pinturas.
export function buildAsignarControlHtml(o, vendedores, tienePermiso, superficie = 'tablero') {
  if (!tienePermiso || !esAsignable(o) || !(vendedores && vendedores.length)) return '';
  // refId es el id numerico real del prospecto; o.id puede venir prefijado ("p7").
  // El control debe disparar la accion con el id numerico (un identificador sin
  // comillas como "p7" seria una variable undefined en el navegador).
  const id = o.refId ?? o.id;
  const opciones = vendedores
    .map(v => `<option value="${escapeHtml(v.name)}">${escapeHtml(v.name)}</option>`)
    .join('');
  return `<div class="cot-card-actions tablero-asignar">
    <select id="asignar-vendedor-${escapeHtml(superficie)}-${id}" class="btn-sm"><option value="">Asignar a...</option>${opciones}</select>
    <button class="btn btn-primary btn-sm" onclick="asignarVendedorTablero(${id}, this)">Asignar</button>
  </div>`;
}

// Mover a Seguimiento a mano (issue #56, AC1): boton sobre la tarjeta de un
// PROSPECTO en Por Cotizar que abre la captura del folio de Operam (el vendedor
// cotizo POR FUERA). El trigger es un boton, no arrastre (fuera de alcance); al
// confirmar, app.js (moverASeguimientoTablero) llama PATCH /api/prospectos/:id/etapa
// con { etapa:'seguimiento', folio }. Lo ve quien opera la tarjeta (dueno o admin,
// la ruta ya valida con prospectoOperable): NO es admin-only. Una cotizacion ya
// avanza sola al cotizar en el sistema (#55), por eso no lleva este boton.
export function buildMoverSeguimientoControlHtml(o) {
  if (!o || o.tipo !== 'prospecto' || o.etapa !== 'por_cotizar') return '';
  // refId es el id numerico del prospecto (la ruta espera el id real); o.id puede
  // venir prefijado ("p7") cuando la oportunidad se arma desde un prospecto.
  const id = o.refId ?? o.id;
  return `<div class="cot-card-actions tablero-mover">
    <button class="btn btn-primary btn-sm" onclick="moverASeguimientoTablero(${id})">A Seguimiento (folio Operam)</button>
  </div>`;
}

// Controles de salida del embudo en la tarjeta del tablero (issue #59, Modelo A,
// CONTEXT.md "Etapas del pipeline"). Solo sobre oportunidades en etapa ACTIVA (las
// que ya salieron no se vuelven a cerrar). Para un PROSPECTO sin cotizar: salida a
// No util con motivo obligatorio del catalogo (select) -- cancelar el select no
// llama al servidor (AC4) -- mas Perdida con confirmacion. Para una COTIZACION:
// solo Perdida (una cotizacion real sale del embudo solo por Perdida, no por No
// util; los motivos de No util son de descalificacion de prospecto). Usa el id
// numerico (refId), nunca el prefijado ("p7"/"c10"), leccion del bug de #57.
// Perdida lleva ademas el TIPO (#478): prospectos y cotizaciones comparten
// numeros de refId, y con el id solo la accion cerraba al prospecto homonimo.
// #482: con pedido (tienePedido) Perdida no se ofrece: esa venta ya se cerro.
// #484: con pedido la unica salida es Cancelada, y solo se le pinta al admin;
// desde #533 vive en el menu de tres puntos (buildMenuMasHtml), no aqui.
export function buildSalidaControlHtml(o) {
  if (!o || esSalida(o.etapa)) return '';
  const id = o.refId ?? o.id;
  const perdida = tienePedido(o) ? ''
    : `<button class="btn btn-secondary btn-sm" onclick="cerrarPerdidaTablero('${o.tipo === 'cotizacion' ? 'cotizacion' : 'prospecto'}', ${id})">Perdida</button>`;
  if (o.tipo === 'cotizacion') {
    return perdida ? `<div class="cot-card-actions tablero-salida">${perdida}</div>` : '';
  }
  const motivos = MOTIVOS_NO_UTIL
    .map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`)
    .join('');
  return `<div class="cot-card-actions tablero-salida">
    <select id="salida-motivo-${id}" class="btn-sm"><option value="">Motivo No útil...</option>${motivos}</select>
    <button class="btn btn-secondary btn-sm" onclick="marcarNoUtilTablero(${id})">No útil</button>
    ${perdida}
  </div>`;
}

// La peticion de Perdida se decide por el tipo que pinto la tarjeta (#478), nunca
// por el que se encuentre con ese refId: el prospecto y la cotizacion pueden
// compartir numero y cerrar uno por el otro deja viva a la de la tarjeta.
// #483: el cuerpo lleva el Motivo de Perdida (y la nota) que el vendedor eligio
// en la ventana del motivo.
export function peticionPerdidaTablero(tipo, id, salida) {
  if (tipo === 'cotizacion') return { url: `/api/cotizacion/${id}/estado`, body: { estado: 'perdida', ...salida } };
  if (tipo === 'prospecto') return { url: `/api/prospectos/${id}/etapa`, body: { etapa: 'perdida', ...salida } };
  return null;
}

// Ventana del motivo de una salida (#483): la abren los cinco caminos que
// ofrecen Perdida ANTES de llamar al servidor, y cancelar no llama. Titulo y
// catalogo ({ valor, texto, exigeNota }) los pone quien la abre, asi otra salida
// con motivo de catalogo usa la misma ventana. La nota es opcional salvo en el
// motivo que la exige; la validacion es la misma del servidor.
// #484: sin catalogo (Cancelada) el motivo es texto libre: no hay selector y el
// campo de texto ES el motivo.
export function buildMotivoSalidaModalHtml({ titulo, catalogo }) {
  if (!catalogo) {
    return `
    <div style="background:#fff;border-radius:8px;padding:20px;max-width:360px;width:90%">
      <div style="font-weight:600;margin-bottom:4px">${escapeHtml(titulo)}</div>
      <div class="cot-card-meta" style="margin-bottom:8px">El motivo es obligatorio. Cancelar no cambia nada.</div>
      <textarea id="motivo-salida-nota" rows="3" placeholder="Motivo" style="width:100%;margin-bottom:8px"></textarea>
      <div id="motivo-salida-error" style="display:none;color:#c0392b;font-size:13px;margin-bottom:8px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="btn btn-secondary btn-sm" id="motivo-salida-cancelar">Cancelar</button>
        <button class="btn btn-primary btn-sm" id="motivo-salida-confirmar">Confirmar</button>
      </div>
    </div>
  `;
  }
  const conNota = catalogo.filter(m => m.exigeNota).map(m => m.texto).join(', ');
  return `
    <div style="background:#fff;border-radius:8px;padding:20px;max-width:360px;width:90%">
      <div style="font-weight:600;margin-bottom:4px">${escapeHtml(titulo)}</div>
      <div class="cot-card-meta" style="margin-bottom:8px">El motivo es obligatorio (cat\u00e1logo cerrado)${conNota ? `; con ${escapeHtml(conNota)} escribe una nota` : ''}. Cancelar no cambia nada.</div>
      <select id="motivo-salida-select" style="width:100%;margin-bottom:8px">
        <option value="">-- Selecciona el motivo --</option>
        ${catalogo.map(m => `<option value="${escapeHtml(m.valor)}">${escapeHtml(m.texto)}</option>`).join('')}
      </select>
      <textarea id="motivo-salida-nota" rows="2" placeholder="Nota" style="width:100%;margin-bottom:8px"></textarea>
      <div id="motivo-salida-error" style="display:none;color:#c0392b;font-size:13px;margin-bottom:8px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="btn btn-secondary btn-sm" id="motivo-salida-cancelar">Cancelar</button>
        <button class="btn btn-primary btn-sm" id="motivo-salida-confirmar">Confirmar</button>
      </div>
    </div>
  `;
}

// Control de producto decorado / calca en la tarjeta de cotizacion (issue #61,
// CONTEXT.md "Producto decorado (calca)"). Solo aplica a COTIZACIONES (un
// prospecto sin cotizar no lleva calca). Una cotizacion no decorada ofrece
// marcarla; una decorada pinta la calca PLEGADA (#532) con su avance en el
// resumen (p. ej. 3/6). Lo que el vendedor abrio o cerro (plegables, por
// "<id de tarjeta>:calca", la misma llave que la lista) sobrevive al repintado
// que sigue a marcar una casilla. Usa el id numerico (refId), nunca el
// prefijado ("c10"), leccion del bug de #57.
export function buildDecoradoControlHtml(o, plegables) {
  if (!o || o.tipo !== 'cotizacion') return '';
  const id = o.refId ?? o.id;
  if (!esDecorada(o)) {
    return `<div class="cot-card-actions decorado-control">
      <button class="btn btn-secondary btn-sm" onclick="marcarDecorada(${id}, true)">Marcar decorada (calca)</button>
    </div>`;
  }
  const { completos, total } = progresoDecorado(o.calcaChecklist || (o.data && o.data.calcaChecklist));
  const llave = `${o.id}:calca`;
  const abierto = !!(plegables && plegables[llave]);
  return `<details class="decorado-control calca-pleg" data-lista-plegable="${escapeHtml(llave)}"${abierto ? ' open' : ''}><summary>Calca <span class="pl-estado pl-estado-${completos === total ? 'ok' : 'pend'}">${completos}/${total}</span>${CHEVRON_LISTA}</summary>
    ${buildCalcaPasosHtml(o)}
  </details>`;
}

// El cuerpo de la calca abierta (#532), el mismo en la tarjeta y en la fila de
// la lista: una casilla por paso con su texto. Marcarla o desmarcarla es el
// Marcar / Revertir de siempre (toggleCalcaPaso, mismo PATCH). El paso 6
// (archivos_dropbox) conserva el input de archivo que sube la posicion de calca.
export function buildCalcaPasosHtml(o) {
  const id = o.refId ?? o.id;
  const checklist = o.calcaChecklist || (o.data && o.data.calcaChecklist);
  const ch = Array.isArray(checklist) ? checklist : [];
  const pasos = PASOS_DECORADO.map(p => {
    const hit = ch.find(x => x && x.clave === p.clave);
    const hecho = !!(hit && hit.completo);
    const archivos = p.clave === 'archivos_dropbox'
      ? `<div class="calca-dropbox"><input type="file" id="calca-archivos-${id}" multiple><button class="btn btn-sm btn-primary" onclick="subirCalcaArchivos(${id})">Subir a Dropbox</button></div>`
      : '';
    return `<li class="calca-paso${hecho ? ' calca-paso-hecho' : ''}"><label class="calca-check"><input type="checkbox"${hecho ? ' checked' : ''} onchange="toggleCalcaPaso(${id}, '${p.clave}', this.checked)"><span>${escapeHtml(p.label)}</span></label>${archivos}</li>`;
  }).join('');
  return `<ul class="calca-checklist">${pasos}</ul>
    <button type="button" class="calca-quitar" onclick="marcarDecorada(${id}, false)">Quitar decorada</button>`;
}

// Oportunidad sin Contacto (#342, spec #337 user story 22, ADR-0016): la
// migracion le asigna Contacto a casi todo lo existente, pero una cotizacion
// historica sin telefono y sin nada bajo su Cliente Operam en el indice se queda
// sin persona a la que colgarse. En vez de adivinarla, la tarjeta lo DICE y el
// vendedor -- que si sabe de quien es -- le captura el celular ahi mismo; ese
// celular la liga en ese momento y ya no se mueve.
//
// Solo aplica a COTIZACIONES: el celular de un prospecto ES su identidad, no
// puede faltar. Usa el id numerico (refId), nunca el prefijado ("c51"), leccion
// del bug de #57.
export function oportunidadSinContacto(o) {
  return !!o && o.tipo === 'cotizacion' && !o.contactoCelular;
}

export function buildSinContactoControlHtml(o) {
  if (!oportunidadSinContacto(o)) return '';
  const id = o.refId ?? o.id;
  return `<div class="cot-card-actions tablero-sin-contacto">
    <span class="cot-badge badge-sin-contacto">Sin Contacto</span>
    <button class="btn btn-secondary btn-sm" onclick="capturarContactoTablero(${id})">Capturar celular</button>
  </div>`;
}

// El celular del Contacto de la tarjeta (#343): la cotizacion lo trae en su liga
// fija (#342) y el prospecto ES su celular. El saneo para el onclick lo hace
// `celularParaAccion` (prospectos-logica.js), el unico punto que lo define.
export function celularDeContacto(o) {
  return celularParaAccion(o && (o.tipo === 'cotizacion' ? o.contactoCelular : o.celular));
}

// "Nueva oportunidad" desde la tarjeta (#343, spec #337, ADR-0016): un Contacto
// que ya cotizo vuelve a preguntar y ese interes necesita tarjeta propia -- su
// celular ya es prospecto y no se puede capturar otra vez. Un Contacto, varias
// tarjetas.
//
// El unico requisito es saber de QUIEN es la tarjeta: una cotizacion sin Contacto
// (#342) no puede abrir nada. No pide origen: lo hereda del Contacto.
export function puedeAbrirNuevaOportunidad(o) {
  return !!celularDeContacto(o);
}

// Menu de tres puntos (#533, variante A de #531): Nueva oportunidad y
// Cancelada se usan rara vez, asi que dejan su fila de botones y viven en un
// menu junto a WhatsApp y correo, igual en la tarjeta del tablero y en la fila
// abierta de la lista. Las reglas no cambian: Nueva oportunidad con celular del
// Contacto, Cancelada solo al admin y con pedido. Sin ninguna, no hay menu.
// El boton no lleva onclick: lo abre y lo cierra la delegacion de app.js
// (data-menu-mas); las opciones si, y son las mismas de antes. La superficie
// separa el id de la lista entre tablero y lista.

function opcionMenuMasHtml(onclick, texto, ayuda, peligro) {
  return `<button type="button" role="menuitem" class="menu-mas-opcion${peligro ? ' menu-mas-peligro' : ''}" onclick="${onclick}">${texto}<small>${ayuda}</small></button>`;
}

export function buildMenuMasHtml(o, { esAdmin = false, superficie = 'tablero' } = {}) {
  if (!o) return '';
  const opciones = [];
  if (puedeAbrirNuevaOportunidad(o)) {
    opciones.push(opcionMenuMasHtml(`abrirNuevaOportunidad('${escapeHtml(celularDeContacto(o))}')`, 'Nueva oportunidad', 'Otra tarjeta para el mismo Contacto'));
  }
  if (o.tipo === 'cotizacion' && !esSalida(o.etapa) && puedeCancelar(o, esAdmin)) {
    opciones.push(opcionMenuMasHtml(`cerrarCanceladaTablero(${o.refId ?? o.id})`, 'Cancelada', 'Ya hay pedido; solo admin', true));
  }
  if (!opciones.length) return '';
  const lista = `menu-mas-${superficie}-${escapeHtml(o.id)}`;
  return `<div class="menu-mas"><button type="button" class="menu-mas-boton" data-menu-mas aria-haspopup="menu" aria-expanded="false" aria-controls="${lista}" aria-label="M\u00e1s acciones" title="M\u00e1s acciones">${ICONO_TRES_PUNTOS}</button><div id="${lista}" class="menu-mas-lista" role="menu" hidden>${opciones.join('')}</div></div>`;
}

// WhatsApp, correo y, si hay, el menu: un solo renglon. Sin menu el par queda
// tal cual (#519).
function contactoYMenuHtml(o, menu) {
  const contacto = buildContactoDirectoHtml(o);
  return menu ? `<div class="contacto-fila">${contacto}${menu}</div>` : contacto;
}

// WhatsApp y Correo desde la Oportunidad (#519): dos accesos con icono que
// llevan la tarjeta del tablero y la fila abierta de la lista, con este UNICO
// constructor. El numero es el del Contacto (celularDeContacto, con el enlace de
// Prospectos); el mensaje de seguimiento y el correo los resuelve el servidor
// (lib/oportunidades.js), porque el mensaje es el de la cola Hoy y vive en lib/.
// El texto solo viaja en Seguimiento: post-venta abre la conversacion sin texto.
// Sin el dato el acceso sale apagado con su aviso, nunca se omite: el vendedor
// ve que falta.
const FORMA_CORREO = /^[^\s@]+@[^\s@]+$/;

function accesoContactoHtml(nombre, clase, href, aviso, icono) {
  if (!href) return `<button type="button" class="btn-contacto btn-contacto-${clase}" disabled aria-label="${nombre}" title="${aviso}">${icono}</button>`;
  return `<a class="btn-contacto btn-contacto-${clase}" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" aria-label="${nombre}" title="${nombre}">${icono}</a>`;
}

export function buildContactoDirectoHtml(o) {
  const wa = buildWaLink(celularDeContacto(o));
  const mensaje = o && o.tipo === 'cotizacion' && o.etapa === 'seguimiento' ? o.mensajeSeguimiento : null;
  const correo = String((o && o.correo) || '').trim();
  return `<div class="contacto-directo">${
    accesoContactoHtml('WhatsApp', 'wa', wa && (mensaje ? `${wa}?text=${encodeURIComponent(mensaje)}` : wa), 'Sin telefono registrado', ICONO_WHATSAPP)
  }${
    accesoContactoHtml('Correo', 'correo', FORMA_CORREO.test(correo) ? `mailto:${correo}` : null, 'Sin correo registrado', ICONO_CORREO)
  }</div>`;
}

// Editar desde el Pipeline (#502): la tarjeta de cotizacion, en el tablero y en
// la lista, lleva el Editar del Historial con su mismo gate -- solo Editar, sin
// Copiar -- y SOLO en Seguimiento y Anticipo pagado; con pedido ya no se puede
// editar y el boton se oculta en vez de apagarse (decisiones de Adrian
// 2026-10-01). Con pedido = `tienePedidoAsociado`, la condicion del gate
// (orderOperam o el pedido del espejo de Operam); no `tienePedido`, que cuenta
// toda etapa post-venta y dejaria Anticipo pagado sin boton. El id del onclick es el REAL (refId), no el `c<id>` de la
// tarjeta. Un prospecto no tiene cotizacion que cargar.
const ETAPAS_CON_EDITAR = new Set(['seguimiento', 'anticipo_pagado']);

export function buildEditarOportunidadHtml(o) {
  if (o?.tipo !== 'cotizacion' || !ETAPAS_CON_EDITAR.has(o.etapa) || tienePedidoAsociado(o)) return '';
  const boton = buildBotonEditarHtml({ id: o.refId, hasData: o.hasData, folioOperam: o.folioOperam, orderOperam: o.orderOperam, espejoOperam: o.espejoOperam });
  return `<div class="cot-card-actions tablero-editar">${boton}</div>`;
}

// La fecha del pedido (#531, #534): la decide entrega-pedido-logica.js y aqui
// solo se pinta, igual en la tarjeta del tablero (renglon propio bajo el
// encabezado) y en la fila CERRADA de la lista (dentro de su boton, por eso
// `etiqueta` = span). Entregado parcialmente lleva el signo de advertencia y el
// color de aviso. Vacio cuando no aplica.
export function entregaPedidoHtml(o, ahora = new Date(), etiqueta = 'div') {
  const e = entregaPedido(o, ahora);
  if (!e) return '';
  const ya = e.estado === 'hoy' || e.estado === 'vencida' ? ' entrega-pedido-ya' : '';
  const dias = e.relativo ? ` <span class="entrega-pedido-dias${ya}">\u00b7 ${escapeHtml(e.relativo)}</span>` : '';
  const parcial = e.estado === 'parcial';
  const clase = parcial ? 'entrega-pedido entrega-pedido-parcial' : 'entrega-pedido';
  const aviso = parcial ? '\u26a0\ufe0f ' : '';
  return `<${etiqueta} class="${clase}">${ICONO_CAMION}<span>${aviso}${e.rotulo} <b>${escapeHtml(e.fecha)}</b>${dias}</span></${etiqueta}>`;
}

function buildOportunidadCardHtml(o, vendedores, tienePermiso, esAdmin, ahora, plegables) {
  const total = o.total ? `<div class="cot-card-total">$${fmtMoneda(o.total)}</div>` : '';
  // El Origen sale de la linea gris y se lee en su chip (#287).
  const meta = [o.vendedor, o.ciudad].filter(Boolean).map(escapeHtml).join(' · ');
  const badge = badgeFolioOperam(o);
  const cadena = cadenaOperamHtml(o.espejoOperam);
  const asignar = buildAsignarControlHtml(o, vendedores, tienePermiso);
  const mover = buildMoverSeguimientoControlHtml(o);
  const salida = buildSalidaControlHtml(o);
  const decorado = buildDecoradoControlHtml(o, plegables);
  const comprobante = buildComprobantePagoHtml(o);
  const sinContacto = buildSinContactoControlHtml(o);
  const editar = buildEditarOportunidadHtml(o);
  const contactoDirecto = contactoYMenuHtml(o, buildMenuMasHtml(o, { esAdmin, superficie: 'tablero' }));
  return `<div class="tablero-card" data-id="${o.id}" data-etapa="${escapeHtml(o.etapa)}">
    <div class="cot-card">
      <div class="cot-card-header">
        <div>
          <div class="cot-card-cliente">${escapeHtml(nombreOportunidad(o))}${badge}${badgePagoSinRegistrarHtml(o)}${badgeFaltaComprobanteHtml(o)}${badgeClienteOperamHtml(o)}</div>
          ${meta ? `<div class="cot-card-meta">${meta}</div>` : ''}
          <div style="margin-top:4px">${chipOrigenHtml(o)}</div>
        </div>
        <div class="cot-card-lado">${total}${contactoDirecto}</div>
      </div>
      ${entregaPedidoHtml(o, ahora)}
      ${cadena}
      ${editar}
      ${sinContacto}
      ${asignar}
      ${mover}
      ${decorado}
      ${comprobante}
      ${salida}
    </div>
  </div>`;
}

export function buildTableroPipelineHtml(oportunidades, { vendedores, puedeAsignar: tienePermiso, esAdmin = false, ahora = new Date(), plegables } = {}) {
  const cols = agruparPipeline(oportunidades);
  return COLUMNAS_PIPELINE.map(etapa => {
    const tarjetas = cols[etapa].map(o => buildOportunidadCardHtml(o, vendedores, tienePermiso, esAdmin, ahora, plegables)).join('');
    const suma = cols[etapa].reduce((s, o) => s + (o.total || 0), 0);
    return `
      <div class="tablero-col" data-etapa="${etapa}">
        <div class="tablero-col-header"><span class="col-pill col-pill-${etapa}">${escapeHtml(COLUMNA_LABELS[etapa])} <span class="tablero-col-count">${cols[etapa].length}</span></span></div>
        <div class="tablero-col-suma">$${fmtMoneda(suma)}</div>
        <div class="tablero-col-cards">${tarjetas || '<div class="tablero-col-vacia">Sin oportunidades</div>'}</div>
      </div>
    `;
  }).join('');
}

// Vista lista del Pipeline (#518): un acordeon por etapa, en el orden del
// tablero, con la fila que se expande. Trae la MISMA informacion y las MISMAS
// acciones que la tarjeta del tablero porque llama a sus mismos constructores;
// aqui solo se decide como se acomodan. El pliegue (etapas abiertas, fila
// abierta) lo guarda app.js en memoria y llega en el contexto; los botones del
// acordeon NO llevan onclick: app.js los atiende por delegacion con los
// atributos data-lista-*.
export const ETAPAS_ABIERTAS_AL_ENTRAR = ['no_asignado', 'por_cotizar', 'seguimiento'];

const CHEVRON_LISTA = '<svg class="pl-chev" viewBox="0 0 20 20" aria-hidden="true"><path d="M5 7.5l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function diaCalendario(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// "hoy" / "ayer" / "hace N d" por dia calendario local; la fecha se lee con
// fechaLocal (#428): un dia de Operam sin hora es ese dia y no el anterior.
export function antiguedadOportunidad(fecha, ahora = new Date()) {
  if (!fecha) return '';
  const d = fechaLocal(fecha);
  if (isNaN(d)) return '';
  const dias = Math.max(0, Math.round((diaCalendario(ahora) - diaCalendario(d)) / 86400000));
  if (dias === 0) return 'hoy';
  if (dias === 1) return 'ayer';
  return `hace ${dias} d`;
}

// Bloque plegable del detalle: el resumen dice el estado y el cuerpo es el
// control de la tarjeta tal cual. Lo que el vendedor abrio o cerro a mano
// (contexto.plegables, por "<id de tarjeta>:<bloque>") gana al estado inicial:
// asi marcar un paso de la calca, que repinta la lista, no lo vuelve a plegar.
function plegableListaHtml(o, bloque, titulo, estado, tono, contenido, abiertoAlNacer, plegables) {
  if (!contenido) return '';
  const llave = `${o.id}:${bloque}`;
  const abierto = plegables && llave in plegables ? plegables[llave] : abiertoAlNacer;
  return `<details class="pl-pleg pl-${bloque}" data-lista-plegable="${escapeHtml(llave)}"${abierto ? ' open' : ''}><summary><span>${titulo}</span><span class="pl-estado pl-estado-${tono}">${estado}</span>${CHEVRON_LISTA}</summary>
      <div class="pl-pleg-cuerpo">${contenido}</div>
    </details>`;
}

// El detalle de la fila abierta: informacion, acciones, Calca y Comprobante
// plegables con su estado, y al final las salidas. El estado de cada plegable
// sale de los predicados de siempre (esDecorada, progresoDecorado,
// faltaComprobante, comprobanteDe), nunca de una regla nueva.
export function buildDetalleListaPipelineHtml(o, { vendedores, puedeAsignar: tienePermiso, esAdmin = false, plegables } = {}) {
  const decorada = esDecorada(o);
  let calca = '';
  if (decorada) {
    const { completos, total } = progresoDecorado(o.calcaChecklist || (o.data && o.data.calcaChecklist));
    calca = plegableListaHtml(o, 'calca', 'Calca', `${completos} de ${total}`, completos === total ? 'ok' : 'pend', buildCalcaPasosHtml(o), false, plegables);
  }
  const falta = faltaComprobante(o) || faltaComprobante(o, 'saldo');
  const subido = comprobanteDe(o) || comprobanteDe(o, 'saldo');
  const comprobante = plegableListaHtml(o, 'comprobante', 'Comprobante de pago',
    falta ? 'Falta' : (subido ? 'Subido' : 'Opcional'), falta ? 'alerta' : (subido ? 'ok' : 'pend'),
    buildComprobantePagoHtml(o), falta, plegables);
  const acciones = [
    buildEditarOportunidadHtml(o),
    buildMoverSeguimientoControlHtml(o),
    buildAsignarControlHtml(o, vendedores, tienePermiso, 'lista'),
    buildSinContactoControlHtml(o),
    decorada ? '' : buildDecoradoControlHtml(o),
  ].join('');
  const salida = buildSalidaControlHtml(o);
  return `<div class="pl-detalle">
      <div class="pl-info">${chipOrigenHtml(o)}${badgeClienteOperamHtml(o)}${cadenaOperamHtml(o.espejoOperam)}${contactoYMenuHtml(o, buildMenuMasHtml(o, { esAdmin, superficie: 'lista' }))}</div>
      ${acciones ? `<div class="pl-acciones">${acciones}</div>` : ''}
      ${calca}${comprobante}
      ${salida ? `<div class="pl-salida"><span class="pl-salida-tit">Cerrar oportunidad</span>${salida}</div>` : ''}
    </div>`;
}

// Fila de la lista (#502 la saco de app.js; #518 la iguala a la tarjeta).
// Cerrada: nombre (mismo respaldo que la tarjeta), total o "Sin cotizar", SOLO
// los chips que piden atencion y vendedor - ciudad - antiguedad; la etapa la
// dice su seccion. Abierta: ademas, el detalle completo.
export function buildFilaListaPipelineHtml(o, contexto = {}) {
  const { abierta = false, ahora = new Date() } = contexto;
  const total = o.total
    ? `<span class="pl-total">$${fmtMoneda(o.total)}</span>`
    : '<span class="pl-total pl-sin-total">Sin cotizar</span>';
  const sinContacto = oportunidadSinContacto(o)
    ?'<span class="cot-badge badge-sin-contacto">Sin Contacto</span>' : '';
  const chips = badgeFolioOperam(o) + badgePagoSinRegistrarHtml(o) + badgeFaltaComprobanteHtml(o) + sinContacto;
  const meta = [o.vendedor, o.ciudad, antiguedadOportunidad(o.fecha, ahora)].filter(Boolean).map(escapeHtml).join(' \u00b7 ');
  return `<div class="pl-fila${abierta ? ' pl-abierta' : ''}" id="pl-fila-${escapeHtml(o.id)}">
      <button type="button" class="pl-fila-cab" data-lista-fila="${escapeHtml(o.id)}" aria-expanded="${abierta}">
        <span class="pl-nombre">${escapeHtml(nombreOportunidad(o))}</span>
        ${entregaPedidoHtml(o, ahora, 'span')}
        ${total}
        ${chips ? `<span class="pl-chips">${chips}</span>` : ''}
        ${meta ? `<span class="pl-meta">${meta}</span>` : ''}
        ${CHEVRON_LISTA}
      </button>
      ${abierta ? buildDetalleListaPipelineHtml(o, contexto) : ''}
    </div>`;
}

// Una seccion por etapa: encabezado con nombre, conteo y la MISMA suma que la
// columna del tablero. La etapa vacia se pinta inerte.
function buildSeccionListaPipelineHtml(etapa, lista, contexto) {
  const { etapasAbiertas, filaAbierta } = contexto;
  const vacia = lista.length === 0;
  const abierta = !vacia && etapasAbiertas.has(etapa);
  const suma = lista.reduce((s, o) => s + (o.total || 0), 0);
  const filas = abierta
    ? `<div class="pl-filas">${lista.map(o => buildFilaListaPipelineHtml(o, { ...contexto, abierta: o.id === filaAbierta })).join('')}</div>`
    : '';
  return `<section class="pl-sec etapa-${etapa}${abierta ? ' pl-sec-abierta' : ''}${vacia ? ' pl-sec-vacia' : ''}" data-etapa="${etapa}">
      <button type="button" class="pl-sec-cab" data-lista-etapa="${etapa}" aria-expanded="${abierta}"${vacia ? ' disabled' : ''}>
        <span class="pl-sec-nom">${escapeHtml(COLUMNA_LABELS[etapa])}</span>
        <span class="pl-sec-n">${lista.length}</span>
        <span class="pl-sec-suma">$${fmtMoneda(suma)}</span>
        ${vacia ? '' : CHEVRON_LISTA}
      </button>
      ${filas}
    </section>`;
}

export function buildListaPipelineHtml(oportunidades, contexto = {}) {
  const ctx = { ...contexto, etapasAbiertas: contexto.etapasAbiertas || new Set(ETAPAS_ABIERTAS_AL_ENTRAR) };
  const cols = agruparPipeline(oportunidades);
  const hayAbiertas = COLUMNAS_PIPELINE.some(e => ctx.etapasAbiertas.has(e) && cols[e].length);
  return `<div class="pl">
      <div class="pl-barra"><button type="button" class="pl-todo" data-lista-accion="todas">${hayAbiertas ? 'Plegar todo' : 'Abrir todo'}</button></div>
      ${COLUMNAS_PIPELINE.map(etapa => buildSeccionListaPipelineHtml(etapa, cols[etapa], ctx)).join('')}
    </div>`;
}

// Cola Hoy fusionada (issue #64, CONTEXT.md "Cola Hoy"): la cola del dia mezcla
// prospectos por contactar (horas habiles) y cotizaciones por seguir (dias
// naturales). El backend (lib/cola-hoy.js -> GET /api/hoy) ya la fusiona y
// ordena por urgencia relativa al umbral de cada tipo, etiquetando cada item con
// `tipo`. Aqui solo se pinta, delegando por tipo y PRESERVANDO ese orden (no se
// reagrupa por tipo). El item de prospecto reusa buildColaProspectosHtml (con su
// WhatsApp, registrar contacto, reunion vencida y sugerencia No util a 3 toques);
// el de cotizacion lleva su mensaje de seguimiento por WhatsApp.

// Etiquetas legibles del paso de seguimiento de una cotizacion (cadencia de dias
// naturales 2/7/21/28, lib/seguimiento.js). Antes vivian inline en showSeguimiento.
const PASO_LABELS = {
  dia2: 'Primer seguimiento',
  dia7: 'Segundo seguimiento',
  dia21: 'Por vencer',
  vencida: 'Vencida',
};

// Tarjeta de una cotizacion en la cola Hoy: WhatsApp con el mensaje de
// seguimiento (item.waLink, sin telefono -> deshabilitado), marcar el paso hecho
// y cerrar el estado (Ganada/Perdida). Extraido de showSeguimiento (app.js) para
// reusarlo en la cola fusionada sin duplicar el markup.
//
// Reunion de diagnostico (issue #65, simetrica a la del prospecto): toda card de
// cotizacion ofrece agendar una reunion (input datetime + boton). Cuando la
// reunion vencio (item.reunionVencida), la card pide registrar el resultado:
// avance (Hecho, registra un evento que reanuda la cadencia) o Perdida (Modelo A
// #59: una cotizacion sale del embudo solo por Perdida, nunca por No util). Usa el
// id numerico de la cotizacion (leccion del bug de #57; aqui el id no viene
// prefijado, pero se documenta el criterio).
export function buildColaCotizacionItemHtml(item) {
  const fecha = fechaLocal(item.fecha).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
  const btnWa = item.waLink
    ? `<a href="${item.waLink}" target="_blank" class="btn btn-primary btn-sm">WhatsApp</a>`
    : `<button class="btn btn-secondary btn-sm" disabled title="Sin telefono registrado">WhatsApp</button>`;
  const badge = badgeFolioOperamHtml(item);
  const pasoLabel = item.paso ? (PASO_LABELS[item.paso] || item.paso) : 'Reunión pendiente';
  const agendar =
    `<input type="datetime-local" id="cot-reunion-${item.id}" class="btn-sm">` +
    `<button class="btn btn-secondary btn-sm" onclick="agendarReunionCotizacion(${item.id})">Agendar reunión</button>`;
  // Reunion vencida: la card pide el resultado (avance/Perdida); el flujo de
  // seguimiento normal (marcar Hecho) cede el paso al cierre de la reunion. Si la
  // cotizacion reaparece solo por la reunion (sin paso de cadencia pendiente), no
  // se pinta "Hecho" (no hay paso que marcar).
  // #482: con pedido (tienePedido) Perdida no se ofrece en ninguna de las dos.
  const conPedido = tienePedido(item);
  let acciones;
  if (item.reunionVencida) {
    const btnPerdida = conPedido ? ''
      : `<button class="btn btn-secondary btn-sm" onclick="resultadoReunionCotizacion(${item.id}, 'perdida')">Perdida</button>`;
    acciones = `${btnWa} ${agendar}
      <button class="btn btn-secondary btn-sm" onclick="resultadoReunionCotizacion(${item.id}, 'avance')">✓ Hecho</button>
      ${btnPerdida}`;
  } else {
    const btnHecho = item.paso
      ? `<button class="btn btn-secondary btn-sm" onclick="marcarSeguimiento(${item.id}, '${item.paso}')">✓ Hecho</button>`
      : '';
    const btnPerdida = conPedido ? ''
      : `<button class="btn btn-secondary btn-sm" onclick="cambiarEstadoCotizacion(${item.id}, 'perdida')">Perdida</button>`;
    acciones = `${btnWa} ${agendar} ${btnHecho}
      <button class="btn btn-secondary btn-sm" onclick="cambiarEstadoCotizacion(${item.id}, 'ganada')">Ganada</button>
      ${btnPerdida}`;
  }
  const reunionBadge = item.reunionVencida
    ? `<div style="margin-top:4px"><span class="reunion-badge">Reunión del ${escapeHtml(new Date(item.fechaReunion).toLocaleString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }))} — registrar resultado</span></div>`
    : '';
  return `
    <div class="cot-card">
      <div class="cot-card-header">
        <div>
          <div class="cot-card-cliente">${escapeHtml(item.cliente || 'Sin nombre')}${badge}</div>
          <div class="cot-card-meta">${escapeHtml(pasoLabel)} · cotizada el ${escapeHtml(fecha)} (hace ${item.dias} dias) · ${item.totalPiezas} pzs</div>
          <div style="margin-top:4px">${chipOrigenHtml(item)}</div>
          ${reunionBadge}
        </div>
        <div>
          <div class="cot-card-total">$${fmtMoneda(item.total)}</div>
        </div>
      </div>
      <div class="cot-card-actions">
        ${acciones}
      </div>
    </div>
  `;
}

// Espera sin asignar legible (#464): `item.horas` son horas HABILES con decimales
// (lib/cola-hoy.js). Se redondea PRIMERO a horas enteras y, desde una jornada
// L-V completa (8 h, el umbral rojo de correo y formulario), se lee en dias
// habiles + horas. El dia habil es la jornada de 8 h: el sabado corto (4 h)
// cuenta como media jornada, aproximacion aceptada; nunca dias naturales, que son
// el reloj de la cotizacion (CONTEXT.md "Horas habiles").
const HORAS_JORNADA = 8;

function esperaSinAsignarTexto(horas) {
  const enteras = Math.round(horas);
  if (enteras < HORAS_JORNADA) return `${enteras} h`;
  const dias = Math.floor(enteras / HORAS_JORNADA);
  const resto = enteras % HORAS_JORNADA;
  const textoDias = dias === 1 ? '1 d\u00eda h\u00e1bil' : `${dias} d\u00edas h\u00e1biles`;
  return resto ? `${textoDias} y ${resto} h` : textoDias;
}

// Item de tarjeta No Asignado en la cola Hoy (#156, spec #155, CONTEXT.md "Cola
// Hoy"): un lead sin dueno es un pendiente del dia. Solo llega a quien tiene el
// permiso de asignacion (lo filtra GET /api/hoy), y su unico pendiente es
// asignarle vendedor: reusa el MISMO control de la tarjeta del tablero
// (buildAsignarControlHtml -> asignarVendedorTablero) en vez de duplicarlo. No
// ofrece registrar contacto ni la sugerencia de No util: esa cadencia mide la
// espera del vendedor, y aqui todavia no hay vendedor.
export function buildColaNoAsignadoItemHtml(item, vendedores, tienePermiso) {
  const espera = item.horas != null ? ` · ${esperaSinAsignarTexto(item.horas)} sin asignar` : '';
  const meta = [item.ciudad, item.celular].filter(Boolean).map(escapeHtml).join(' · ');
  const asignar = buildAsignarControlHtml({ ...item, refId: item.id }, vendedores, tienePermiso, 'hoy');
  return `
    <div class="cot-card">
      <div class="cot-card-header">
        <div>
          <div class="cot-card-cliente">${escapeHtml(item.nombre || 'Sin nombre')}</div>
          <div class="cot-card-meta">Sin vendedor${escapeHtml(espera)}${meta ? ' · ' + meta : ''}</div>
          <div style="margin-top:4px">${chipOrigenHtml(item)}</div>
        </div>
      </div>
      ${asignar}
    </div>
  `;
}

export function buildColaHoyHtml(cola, { vendedores, puedeAsignar: tienePermiso } = {}) {
  if (!cola || !cola.length) return '<div class="cot-card-meta">Nada pendiente por ahora.</div>';
  return cola.map(item => {
    if (item.tipo === 'no_asignado') return buildColaNoAsignadoItemHtml(item, vendedores, tienePermiso);
    if (item.tipo === 'cotizacion') return buildColaCotizacionItemHtml(item);
    // buildColaProspectosHtml itera una lista; un solo prospecto = lista de uno.
    return buildColaProspectosHtml([item]);
  }).join('');
}

// Filtro/historial de cerradas (issue #59, AC3, CONTEXT.md "Etapas del pipeline":
// las salidas viven en filtro/historial, fuera del tablero activo). Lista las
// oportunidades en salida (No util / Perdida / Cancelada) mostrando su nombre,
// el tipo de cierre y su motivo (para No util, el del catalogo: o.motivoNoUtil,
// derivado del ultimo evento no_util por prospectoAOportunidad). Reusa el mismo criterio de
// "que es salida" que el tablero (esSalida).
const SALIDA_LABELS = { no_util: 'No útil', perdida: 'Perdida', cancelada: 'Cancelada' };

// El Motivo de Perdida y su nota como segmento de la linea de metadatos (#483):
// el texto del motivo tras el separador, con ": la nota" si la hay. La Perdida
// anterior al catalogo no trae motivo y no pinta nada. Lo comparten Cerradas y el
// Historial.
export function motivoPerdidaHtml(o) {
  if (!o || !o.motivoPerdida) return '';
  const nota = o.notaPerdida ? `: ${escapeHtml(o.notaPerdida)}` : '';
  return ` \u00b7 ${escapeHtml(textoMotivoPerdida(o.motivoPerdida))}${nota}`;
}

// #484: el motivo libre de la Cancelada, en el mismo lugar que el de Perdida.
// Lo comparten Cerradas y el Historial.
export function motivoCanceladaHtml(o) {
  return o && o.motivoCancelada ? ` \u00b7 ${escapeHtml(o.motivoCancelada)}` : '';
}

export function buildCerradasHtml(oportunidades) {
  const cerradas = (oportunidades || []).filter(o => esSalida(o.etapa))
    .slice().sort((a, b) => fechaLocal(b.fecha || 0) - fechaLocal(a.fecha || 0));
  if (!cerradas.length) return '<div class="cot-card-meta">Sin oportunidades cerradas.</div>';
  return cerradas.map(o => {
    const cierre = SALIDA_LABELS[o.etapa] || o.etapa;
    const motivo = o.etapa === 'no_util' && o.motivoNoUtil ? ` · ${escapeHtml(o.motivoNoUtil)}`
      : o.etapa === 'perdida' ? motivoPerdidaHtml(o)
      : o.etapa === 'cancelada' ? motivoCanceladaHtml(o) : '';
    const meta = [o.vendedor, o.ciudad].filter(Boolean).map(escapeHtml).join(' · ');
    return `<div class="cot-card"><div class="cot-card-header"><div>
      <div class="cot-card-cliente">${escapeHtml(nombreOportunidad(o))}</div>
      <div class="cot-card-meta">${escapeHtml(cierre)}${motivo}${meta ? ' · ' + meta : ''}</div>
      <div style="margin-top:4px">${chipOrigenHtml(o)}</div>
    </div></div></div>`;
  }).join('');
}

// --- Filtro por evento (issue #261, CONTEXT.md "Evento") ---
// Despues de la expo el director pregunta cuantos prospectos dejo Abastur y en
// que etapa quedaron: el evento viaja en la oportunidad del PROSPECTO, que sigue
// en el tablero despues de cotizar (su etapa avanza a Seguimiento), y el
// pipeline lo filtra en los tres modos. La tarjeta de la cotizacion no lleva
// evento: la cotizacion no conoce al prospecto del que salio. Desde #457 es un
// filtro mas de la rejilla (BUSCABLES_OPORTUNIDAD.filtros), no un select propio.

// --- Buscador del Pipeline y de la cola Hoy (#289) ---
// El mismo control del Historial (texto + Desde/Hasta) sobre las dos listas que
// se pintan aqui. En el pipeline se combina con AND con los filtros por selector
// y aplica a los tres modos (tablero, lista y cerradas); en Hoy filtra la cola
// ya ordenada por urgencia sin reordenarla y sin tocar el badge de pendientes,
// que sigue contando la cola COMPLETA.
//
// El telefono tiene dos nombres segun de donde viene la tarjeta (el prospecto
// trae `celular`, la cotizacion `telefono`) y la cola Hoy mezcla los dos tipos:
// por eso los dos se declaran y el match es por digitos.
//
// El Origen viaja con dos nombres por la misma razon: el prospecto lo trae
// capturado en `canal` y la cotizacion lo trae HEREDADO en `origen` (#287, lo
// anota quien resuelve la herencia). Declarar los dos cierra la limitacion que
// dejo #289: "Instagram" encontraba al prospecto pero no a sus cotizaciones.
//
// El vendedor NO es buscable (ver BUSCABLES_COTIZACION): filtrar por persona
// es un selector aparte, no texto libre que ahogue a la tarjeta tecleada.
//
// Filtros por selector (#457, spec #398): el Origen se lee con sus dos nombres
// (el heredado manda: es el que anota quien resolvio la herencia, y en el
// prospecto coincide con su `canal`); el Evento es un derivado que solo traen
// los prospectos de expo, asi que con una sola expo el selector SI decide
// (`pintarConUnaOpcion`) y sin ninguna no se pinta, como el select de #261.
const ORIGEN_DE_TARJETA = { etiqueta: 'Origen', lee: o => o?.origen || o?.canal, procedencia: 'catalogo', valores: CANALES };
const VENDEDOR_DE_TARJETA = { etiqueta: 'Vendedor', lee: o => o?.vendedor, procedencia: 'datos' };

export const BUSCABLES_OPORTUNIDAD = {
  camposDe: o => [o?.nombre, o?.ciudad, o?.canal, o?.origen, o?.folioOperam],
  digitosDe: o => [o?.celular, o?.telefono],
  fechaDe: o => o?.fecha,
  filtros: {
    origen: ORIGEN_DE_TARJETA,
    evento: { etiqueta: 'Evento', lee: o => o?.evento, procedencia: 'datos', pintarConUnaOpcion: true },
    vendedor: VENDEDOR_DE_TARJETA,
  },
};

export const BUSCABLES_COLA_HOY = {
  camposDe: i => [i?.nombre, i?.cliente, i?.ciudad, i?.canal, i?.origen, i?.folioOperam],
  digitosDe: i => [i?.celular, i?.telefono],
  fechaDe: i => i?.fecha,
  // #457 (historia 15): los pendientes de una persona. La tarjeta No Asignado
  // viaja con vendedor null: ningun vendedor la reclama.
  filtros: { vendedor: VENDEDOR_DE_TARJETA },
};

export function filtrarOportunidades(oportunidades, criterio) {
  return filtrarPorCriterio(oportunidades, criterio, BUSCABLES_OPORTUNIDAD);
}

export function filtrarColaHoy(cola, criterio) {
  return filtrarPorCriterio(cola, criterio, BUSCABLES_COLA_HOY);
}

// === La vista Clientes por Contacto (#346, spec #337, ADR-0016) ===
//
// La unidad de la pantalla deja de ser el registro de Operam y pasa a ser la
// PERSONA: Jorge Orea salia dos veces -- como Cliente Operam y como prospecto --
// aunque el prospecto ya estuviera ligado a ese mismo `customer_id`. Aqui sale
// una vez, con sus Clientes Operam colgando de el.

// Los chips de las etiquetas del Contacto (#344). Se acumulan y no se quitan:
// una Oportunidad Perdida no le quita ninguna, porque describen su historia. El
// texto y el orden salen del vocabulario que comparte con el servidor.
export function etiquetasContactoHtml(etiquetas) {
  const tiene = new Set(etiquetas || []);
  return ETIQUETAS_CONTACTO_ORDEN.filter(e => tiene.has(e))
    .map(e => `<span class="pc-tag ${e.replace(/_/g, '-')}">${escapeHtml(ETIQUETA_CONTACTO[e])}</span>`)
    .join('');
}

// Una Oportunidad en la ficha: su etapa y su folio. El badge es el MISMO del
// tablero (badgeFolioOperam, que ya distingue cotizacion de prospecto y nunca
// pinta "PRE" sobre una Oportunidad pre-cotizacion), y la etiqueta de etapa es
// ETAPA_LABELS, que si nombra las salidas -- la ficha lista tambien las
// perdidas y las no utiles.
function oportunidadFichaHtml(o) {
  const op = o || {};
  return '<div class="pc-ficha-item">' +
    '<span class="pc-res-main"><span class="pc-res-nombre">' +
    escapeHtml(ETAPA_LABELS[op.etapa] || op.etapa || 'Sin etapa') + '</span>' +
    '<span class="pc-res-sub">' + escapeHtml(op.nombre || '') + '</span></span>' +
    badgeFolioOperam(op) + '</div>';
}

// Un Cliente Operam en la ficha: sus dos estados y, cuando le faltan los datos
// fiscales, el salto a completarlos CONTRA SU id -- un Contacto puede tener
// varios y solo uno necesitar la constancia.
function clienteOperamFichaHtml(c) {
  const row = { ...(c || {}), tipo: 'operam' };
  const nombre = row.nombre || 'Sin nombre';
  const id = row.id == null ? '' : String(row.id);
  const accion = sinDatosFiscales(row) && id
    ? '<div style="margin-top:4px"><button type="button" class="btn btn-secondary btn-sm" ' +
      'onclick="cvUpgradeClienteOperam(\'' + escapeHtml(id) + '\')">Completar datos fiscales</button></div>'
    : '';
  // El RFC va en el sub como en la tarjeta (cardClienteHtml, misma forma): es el
  // dato que cambia al completar la constancia, y sin el la ficha no mostraba el
  // resultado del upgrade -- solo que el boton desaparecia (#407).
  const sub = [row.rfc, 'Cliente en Operam' + (id ? ' (ID ' + id + ')' : '')]
    .filter(Boolean).map(escapeHtml).join(' &middot; ');
  return '<div class="pc-ficha-item">' +
    '<span class="pc-res-main"><span class="pc-res-nombre">' + escapeHtml(nombreConCorto(nombre, row.ref)) + '</span>' +
    '<span class="pc-res-sub">' + sub + '</span>' +
    accion + '</span>' +
    tagResultadoClienteHtml({ ...row, nombre }) + tagPedidoClienteHtml(row) + '</div>';
}

// La ficha del Contacto: su historia completa antes de escribirle (user story 6
// de la spec). Etiquetas, TODAS sus Oportunidades -- activas, ganadas y
// perdidas, con folio y etapa -- y TODOS sus Clientes Operam con sus dos
// estados, mas las tres puertas de salida: Nueva oportunidad, cotizar y
// completar datos fiscales.
export function fichaContactoHtml(r) {
  const row = r || {};
  const celular = celularDeContacto(row);
  const sub = [row.celular, row.ciudad].filter(Boolean).map(escapeHtml).join(' &middot; ');
  const oportunidades = (row.oportunidades || []).length
    ? (row.oportunidades || []).map(oportunidadFichaHtml).join('')
    : '<div class="pc-res-sub">Sin oportunidades</div>';
  const clientes = (row.clientesOperam || []).length
    ? (row.clientesOperam || []).map(clienteOperamFichaHtml).join('')
    : '<div class="pc-res-sub">Sin Clientes Operam</div>';
  const nueva = celular
    ? '<button type="button" class="btn btn-secondary btn-block" style="margin-top:8px" ' +
      'onclick="abrirNuevaOportunidad(\'' + escapeHtml(celular) + '\')">Nueva oportunidad</button>'
    : '';
  return '<div class="pc-cli-card">' +
    '<div class="pc-cli-nombre">' + escapeHtml(row.nombre || 'Sin nombre') + '</div>' +
    '<div class="pc-cli-sub">' + sub + '</div>' +
    '<div style="margin-top:8px">' + chipOrigenHtml(row) + '</div>' +
    '<div class="pc-chips">' + etiquetasContactoHtml(row.etiquetas) + '</div>' +
    '<div class="pc-ficha-seccion"><div class="pc-res-titulo">Oportunidades</div>' + oportunidades + '</div>' +
    '<div class="pc-ficha-seccion"><div class="pc-res-titulo">Clientes Operam</div>' + clientes + '</div>' +
    nueva +
    '<button type="button" class="btn btn-secondary btn-block" style="margin-top:8px" onclick="cvCotizar()">Cotizar a este Contacto &rsaquo;</button>' +
    '</div>';
}

// La fila de un Contacto en Resultados: la persona, sus etiquetas y los nombres
// de sus Clientes Operam anidados -- para que se vea de un vistazo que ese
// registro de Operam que el vendedor buscaba ya esta ahi dentro y no falta.
export function filaContactoHtml(r, i) {
  const row = r || {};
  const nombres = (row.clientesOperam || []).map(c => (c && c.nombre) || '').filter(Boolean);
  const anidados = nombres.length
    ? '<span class="pc-res-sub">' + nombres.map(escapeHtml).join(' &middot; ') + '</span>'
    : '';
  return '<button type="button" class="pc-res-row" onclick="cvElegirResultado(' + i + ')">' +
    '<span class="pc-res-ini contacto">' + escapeHtml(inicialesCliente(row.nombre)) + '</span>' +
    '<span class="pc-res-main"><span class="pc-res-nombre">' + escapeHtml(row.nombre || '') + '</span>' +
    '<span class="pc-res-sub">' + escapeHtml(row.sub || '') + '</span>' +
    anidados + chipOrigenHtml(row) + '</span>' +
    etiquetasContactoHtml(row.etiquetas) + '</button>' +
    accionEditarFilaHtml(row, i);
}
