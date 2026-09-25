// Nucleo PURO del reintento del post-fix web del quote (#380). El post-fix
// (`corregirVigenciaQuote`, lib/operam-web.js) escribe en UN ProcessOrder la vigencia,
// la lista del encabezado (#403) y el transportista (#448), y verifica releyendo. Lo
// que no quede verificado se encola PERSISTIDO y se reintenta con backoff; aqui se
// decide, sin IO, que cuenta como verificado, que se reintenta y que no tiene caso
// reintentar. El IO vive en lib/postfix-reintento-io.js.

import { puedeActualizarCotizacion } from '../public/js/cotizaciones-logica.js';

// Un campo del encabezado (lista o transportista) tal como lo devuelve operam-web:
// `aplica && !escrita && !yaCorrecto` es la ABSTENCION del decisor (el formulario no
// ofrece esa opcion o no es la pagina esperada). Es deterministica: repostear lo mismo
// vuelve a abstenerse, asi que no es transitoria.
function estadoCampo(nombre, c) {
  if (!c || c.ok) return null;
  if (c.aplica && !c.escrita && !c.yaCorrecto) {
    return { estado: 'definitivo', motivo: `${nombre}: no se escribio -- ${c.motivo ?? 'sin motivo'}` };
  }
  return {
    estado: 'transitorio',
    motivo: `${nombre}: se esperaba ${c.esperado ?? '(sin dato)'} y se leyo ${c.encontrado ?? '(sin dato)'}${c.motivo ? ' -- ' + c.motivo : ''}`,
  };
}

// Lo que devolvio corregirVigenciaQuote -> { estado, motivo }. estado es
// 'verificado' (los tres campos confirmados o sin nada que escribir), 'transitorio'
// (vale la pena reintentar) o 'definitivo' (reintentar no cambia nada). Si hay algo
// transitorio manda el reintento: lo que se pueda corregir se corrige, y lo definitivo
// se avisa al agotar.
export function clasificarPostFix(r) {
  const fallos = [];
  if (!r?.ok) {
    fallos.push({
      estado: 'transitorio',
      motivo: r?.verificado === false
        ? `vigencia: la vista de Operam no trajo el campo Valido hasta (se esperaba ${r?.esperado ?? '(sin dato)'})`
        : `vigencia: se esperaba ${r?.esperado ?? '(sin dato)'} y se leyo ${r?.encontrado ?? '(sin dato)'}`,
    });
  }
  for (const f of [estadoCampo('lista', r?.lista), estadoCampo('transportista', r?.transportista)]) {
    if (f) fallos.push(f);
  }
  if (!fallos.length) return { estado: 'verificado', motivo: null };
  const estado = fallos.some(f => f.estado === 'transitorio') ? 'transitorio' : 'definitivo';
  return { estado, motivo: fallos.map(f => f.motivo).join('; ') };
}

// Backoff de los reintentos (decision de Adrian 2026-09-25): 1 min, 10 min, 1 h y
// 6 h despues del fallo anterior. `intentos` = reintentos ya hechos (0 tras el fallo
// del post-fix de la subida). null = se agoto y toca avisar.
export const BACKOFF_MINUTOS = Object.freeze([1, 10, 60, 360]);

export function proximoIntento(intentos, ahora) {
  const n = Number(intentos) || 0;
  if (n >= BACKOFF_MINUTOS.length) return null;
  return new Date(ahora.getTime() + BACKOFF_MINUTOS[n] * 60 * 1000);
}

// La firma de #406: con una vigencia ANTERIOR a la fecha del documento (ord_date),
// FA rechaza el ProcessOrder entero ("La fecha de validez solicitada es anterior a la
// fecha de la cotizacion") y no guarda nada. Compara contra el DOCUMENTO, no contra
// hoy. Fechas yyyy-mm-dd: el orden de texto es el del calendario. Sin alguna de las
// dos no se juzga (no se excluye por sospecha).
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
export function vigenciaAnteriorAlDocumento(vigencia, fechaDocumento) {
  const v = String(vigencia ?? '').slice(0, 10);
  const d = String(fechaDocumento ?? '').slice(0, 10);
  if (!FECHA.test(v) || !FECHA.test(d)) return false;
  return v < d;
}

// La vigencia que el quote LLEVA: la ultima linea "Valido hasta: yyyy-mm-dd" que
// armarComentariosQuote (lib/operam-client.js) pone en comments. Es la referencia del
// barrido y NO `data.vigencia`: cada regeneracion reemplaza `data` (y la huella solo
// mira el plazo), asi que la fecha de la cotizacion se mueve sin que el quote se
// reescriba, y compararla corregiria quotes que estan bien.
export function vigenciaDeComentarios(comments) {
  const m = String(comments ?? '').match(/Valido hasta:\s*(\d{4}-\d{2}-\d{2})/g);
  if (!m) return null;
  return m[m.length - 1].slice(-10);
}

const texto = (v) => (v == null || v === '' ? null : String(v));

// Los campos que el post-fix escribe, leidos por la API v3 (GET /sales/quote/:folio)
// contra lo esperado { vigencia, lista, transportista }. Lo esperado en null no se
// compara: no habia nada que escribir. El domicilio de entrega (branch_code) NO
// entra: el post-fix de la subida no lo escribe (viaja en el POST de la API).
export function desfaseQuote(quote, esperado = {}) {
  const pares = [
    ['vigencia', esperado.vigencia, quote?.delivery_date],
    ['lista', esperado.lista, quote?.order_type],
    ['transportista', esperado.transportista, quote?.ship_via],
  ];
  const desfases = [];
  for (const [campo, e, leido] of pares) {
    const esp = texto(e);
    if (esp === null) continue;
    const encontrado = texto(leido);
    if (encontrado !== esp) desfases.push({ campo, esperado: esp, encontrado });
  }
  return desfases;
}

// Lo que la subida INTENTO escribir de lista y transportista, tal como quedo en la
// huella del quote (#114, `data.huellaQuote`). Un campo que la huella no trae
// (guardada antes de #403 o de #448) sale en null: nunca se intento y no se juzga. Es
// la referencia del barrido y del worker, en vez de recalcularlo con el catalogo y la
// configuracion de /admin de hoy (eso reescribiria 30 dias de quotes al cambiarlos).
export function esperadoDeHuella(huellaQuote) {
  let h = null;
  try {
    h = typeof huellaQuote === 'string' ? JSON.parse(huellaQuote) : null;
  } catch {
    h = null;
  }
  if (!h || typeof h !== 'object') return { lista: null, transportista: null, trae: { lista: false, transportista: false } };
  const trae = { lista: 'listaId' in h, transportista: 'shipVia' in h };
  return {
    lista: trae.lista ? texto(h.listaId) : null,
    transportista: trae.transportista ? texto(h.shipVia) : null,
    trae,
  };
}

// Antes de escribir, el worker relee el REGISTRO del cotizador: si ya no respalda lo
// encolado la fila se descarta sin escribir -> motivo, o null si se puede reintentar.
// Fuera: sin registro o ligado a otro folio, con pedido (gate de #104; #406 decidio no
// repostear quotes con pedido), con el quote desactualizado (lo resuelve el Reintentar
// del Historial) y lo que el vendedor cambio despues de encolar (/actualizar reescribe
// lista, transportista y vigencia: el reintento los regresaria a los viejos). La
// vigencia solo se compara en lo que encolo la subida: el barrido toma la de comments.
export function motivoDescarteReintento(p, registro, { vigenciaRegistro = null } = {}) {
  if (!registro) return 'la cotizacion ya no existe en el cotizador';
  if (texto(registro.folioOperam) !== texto(p.folio)) return `la cotizacion ya no esta ligada al quote ${p.folio}`;
  const gate = puedeActualizarCotizacion({
    hasData: !!registro.data,
    folioOperam: registro.folioOperam,
    orderOperam: registro.data?.orderOperam ?? null,
  });
  if (!gate.puede) return gate.motivo;
  if (registro.data.quoteDesactualizado) return 'el quote quedo desactualizado: lo resuelve el Reintentar del Historial';
  const huella = esperadoDeHuella(registro.data.huellaQuote);
  if (huella.trae.lista && huella.lista !== texto(p.lista)) return `la lista cambio despues de encolar (hoy ${huella.lista ?? '(ninguna)'}, se encolo ${p.lista ?? '(ninguna)'})`;
  if (huella.trae.transportista && huella.transportista !== texto(p.transportista)) return `el transportista cambio despues de encolar (hoy ${huella.transportista ?? '(ninguno)'}, se encolo ${p.transportista ?? '(ninguno)'})`;
  if (p.origen === 'post-fix' && texto(vigenciaRegistro) !== texto(p.vigencia)) return `la vigencia cambio despues de encolar (hoy ${vigenciaRegistro ?? '(sin dato)'}, se encolo ${p.vigencia ?? '(sin dato)'})`;
  return null;
}

// Los quotes que revisa el barrido diario: los del cotizador (con folio) cuyo registro
// se guardo en los ultimos `dias`. Fuera, con precedente en el repo: el que ya tiene
// pedido (#406 lo decide aparte: el pedido ya heredo el encabezado), el que quedo
// desactualizado (su divergencia la resuelve el Reintentar del Historial, #104) y el
// folio que ya esta en la cola en CUALQUIER estado -- si no, el barrido re-encolaria
// cada dia el mismo quote y mandaria el mismo correo cada dia.
export const DIAS_BARRIDO = 30;

export function cotizacionesDelBarrido(cotizaciones, { ahora, dias = DIAS_BARRIDO, foliosEnCola = new Set() } = {}) {
  const desde = ahora.getTime() - dias * 24 * 3600 * 1000;
  return (cotizaciones || []).filter((c) => {
    const folio = texto(c?.folioOperam);
    if (folio === null) return false;
    if (c.data?.orderOperam != null && c.data.orderOperam !== '') return false;
    if (c.data?.quoteDesactualizado) return false;
    if (foliosEnCola.has(folio)) return false;
    const t = new Date(c.fecha).getTime();
    return Number.isFinite(t) && t >= desde;
  });
}

function correoValido(v) {
  const s = String(v ?? '').trim();
  return s.includes('@') ? s : null;
}

const mismoNombre = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

// A quien se avisa: a Adrian -- los `admin` del registro con correo, y si ninguno lo
// tiene, ALERTA_ADMIN_EMAIL (la misma regla de respaldo que la alerta de mayoreo) -- y
// al vendedor del quote. La cotizacion guarda al vendedor por NOMBRE (columna
// `vendedor`), asi que se cruza por nombre; sin correo registrado no recibe nada.
export function destinatariosAvisoPostFix(vendedores, vendedorDelQuote, { adminEmailFallback } = {}) {
  const lista = Array.isArray(vendedores) ? vendedores : [];
  const set = new Map();
  const agregar = (correo) => {
    if (correo && !set.has(correo.toLowerCase())) set.set(correo.toLowerCase(), correo);
  };
  for (const v of lista) {
    if (v?.role === 'admin') agregar(correoValido(v.email));
  }
  if (!set.size) agregar(correoValido(adminEmailFallback));
  const vendedor = lista.find(v => mismoNombre(v?.name, vendedorDelQuote));
  agregar(correoValido(vendedor?.email));
  return [...set.values()];
}

const CAMPOS = [['vigencia', 'Valido hasta'], ['lista', 'Lista de precios'], ['transportista', 'Transportista']];

// El correo del aviso. `causa`: 'agotado' (se acabaron los reintentos) o 'definitivo'
// (FA lo rechaza de una forma que reintentar no arregla). null sin destinatarios.
export function mensajeAvisoPostFix(pendiente, { causa } = {}, destinatarios = []) {
  if (!destinatarios.length) return null;
  const p = pendiente || {};
  const esperado = CAMPOS
    .filter(([k]) => texto(p[k]) !== null)
    .map(([k, etiqueta]) => `  - ${etiqueta}: ${p[k]}`);
  const porQue = causa === 'definitivo'
    ? 'Operam lo rechaza de una forma que reintentar no arregla, asi que no se reintenta: hay que corregirlo a mano.'
    : `Se hicieron ${p.intentos ?? 0} reintentos (1 min, 10 min, 1 h y 6 h) y ninguno quedo verificado.`;
  const text = [
    `La cotizacion ${p.folio} no quedo en Operam como la subio el cotizador.`,
    '',
    porQue,
    '',
    'Lo que debia quedar en el encabezado del quote:',
    ...(esperado.length ? esperado : ['  - (sin datos)']),
    '',
    `Lo que no quedo: ${p.motivo ?? '(sin motivo registrado)'}`,
    '',
    `Vendedor: ${p.vendedor ?? '(sin vendedor)'}`,
    'Revisala en Operam (Ventas > Consultar cotizaciones) y corrige el encabezado.',
  ].join('\n');
  return { to: destinatarios, subject: `Cotizacion ${p.folio}: Operam no quedo como se subio`, text };
}
