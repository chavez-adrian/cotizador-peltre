// Nucleo PURO del reintento del post-fix web del quote (#380). El post-fix
// (`corregirVigenciaQuote`, lib/operam-web.js) escribe en UN ProcessOrder la vigencia,
// la lista del encabezado (#403), el transportista (#448) y el telefono y el correo del
// Contacto de entrega (#556), y verifica releyendo. Lo
// que no quede verificado se encola PERSISTIDO y se reintenta con backoff; aqui se
// decide, sin IO, que cuenta como verificado, que se reintenta y que no tiene caso
// reintentar. El IO vive en lib/postfix-reintento-io.js.
//
// Los campos salen de la tabla del Post-fix del encabezado del quote (#522): los que
// se reintentan son las filas con `momentos.reintentar`, los que relee el barrido las
// de `momentos.barrido`, y su llave en la huella es la de la fila.

import { puedeActualizarCotizacion } from '../public/js/cotizaciones-logica.js';
import { filasEn, filasCampo } from './postfix-encabezado-quote.js';

const FILAS_REINTENTO = filasEn('reintentar');

// Un campo del encabezado (lista o transportista) tal como lo devuelve operam-web:
// `aplica && !escrita && !yaCorrecto` es la ABSTENCION del decisor (el formulario no
// ofrece esa opcion o no es la pagina esperada). Es deterministica: repostear lo mismo
// vuelve a abstenerse, asi que no es transitoria.
// El vacio es un valor en las filas `texto` (#556) y se nombra; null es "sin dato".
const mostrar = (v) => (v == null ? '(sin dato)' : v === '' ? '(vacio)' : v);

function estadoCampo(nombre, c) {
  if (!c || c.ok) return null;
  if (c.aplica && !c.escrita && !c.yaCorrecto) {
    return { estado: 'definitivo', motivo: `${nombre}: no se escribio -- ${c.motivo ?? 'sin motivo'}` };
  }
  return {
    estado: 'transitorio',
    motivo: `${nombre}: se esperaba ${mostrar(c.esperado)} y se leyo ${mostrar(c.encontrado)}${c.motivo ? ' -- ' + c.motivo : ''}`,
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
  for (const fila of filasCampo('reintentar')) {
    const f = estadoCampo(fila.campo, r?.[fila.campo]);
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

const texto = (v) => (v == null || v === '' ? null : String(v));

// Los campos que el post-fix escribe, leidos por la API v3 (GET /sales/quote/:folio)
// con la `llaveApi` de su fila contra lo esperado (por `campo`). Lo esperado en null no
// se compara: no habia nada que escribir. El domicilio de entrega (branch_code) NO
// entra: su fila declara que no entra al barrido (el post-fix de la subida no lo
// escribe, viaja en el POST de la API).
//
// `momento` dice que filas se comparan: `barrido` (el barrido diario, contra la huella)
// o `reintentar` (el worker, contra lo encolado, antes de repostear). Son distintos
// desde #556: el telefono y el correo del Contacto de entrega se reintentan pero NO
// entran al barrido -- compararlos contra la huella reescribiria los quotes historicos
// con el telefono heredado, un backfill que no se pidio --; sin ellos en el worker, una
// fila encolada solo por el telefono saldria "sin desfase" sin escribirse. En una fila
// `texto` el vacio es un valor y se compara (null = no se encolo, no se compara).
export function desfaseQuote(quote, esperado = {}, { momento = 'barrido' } = {}) {
  const desfases = [];
  for (const { campo, llaveApi, tipo } of filasEn(momento)) {
    if (tipo === 'texto') {
      if (esperado[campo] == null) continue;
      const esp = String(esperado[campo]).trim();
      const leido = quote?.[llaveApi];
      const encontrado = leido === undefined ? null : String(leido ?? '').trim();
      if (encontrado !== esp) desfases.push({ campo, esperado: esp, encontrado });
      continue;
    }
    const esp = texto(esperado[campo]);
    if (esp === null) continue;
    const encontrado = texto(quote?.[llaveApi]);
    if (encontrado !== esp) desfases.push({ campo, esperado: esp, encontrado });
  }
  return desfases;
}

// Lo que la subida INTENTO escribir de lista, transportista y vigencia, tal como quedo
// en la huella del quote (#114, `data.huellaQuote`). Un campo que la huella no trae
// (guardada antes de #403, de #448 o de #505) sale en null: nunca se intento y no se
// juzga. Es la referencia del barrido y del worker, en vez de recalcularlo con el
// catalogo y la configuracion de /admin de hoy (eso reescribiria 30 dias de quotes al
// cambiarlos). La vigencia tampoco sale de la linea "Valido hasta" de comments (#505):
// las notas del quote se editan a mano en Operam y no son fuente de verdad.
export function esperadoDeHuella(huellaQuote) {
  let h = null;
  try {
    h = typeof huellaQuote === 'string' ? JSON.parse(huellaQuote) : null;
  } catch {
    h = null;
  }
  const valida = !!h && typeof h === 'object';
  const esperado = {};
  const trae = {};
  for (const { campo, huella, llaveHuellaBase } of FILAS_REINTENTO) {
    // El telefono y el correo del Contacto de entrega (#556) no son campos tardios:
    // viven en el objeto base de la huella desde #329 (`llaveHuellaBase`) y el vacio es
    // un valor. El worker los escribe al repostear una fila del barrido -- sin ellos FA
    // prellenaria el General del cliente --, pero el barrido no los compara contra el
    // quote (ver desfaseQuote).
    if (!huella) {
      trae[campo] = valida && !!llaveHuellaBase && llaveHuellaBase in h;
      esperado[campo] = trae[campo] ? String(h[llaveHuellaBase] ?? '').trim() : null;
      continue;
    }
    trae[campo] = valida && huella.llave in h;
    esperado[campo] = trae[campo] ? texto(h[huella.llave]) : null;
  }
  return { ...esperado, trae };
}

// El orden en que el worker revisa lo que cambio despues de encolar: las `select`
// primero y la vigencia al final, que ademas se compara contra el registro.
const FILAS_DESCARTE = [...filasCampo('reintentar'), ...FILAS_REINTENTO.filter((f) => f.tipo === 'fecha')];

// Antes de escribir, el worker relee el REGISTRO del cotizador: si ya no respalda lo
// encolado la fila se descarta sin escribir -> motivo, o null si se puede reintentar.
// Fuera: sin registro o ligado a otro folio, con pedido (gate de #104; #406 decidio no
// repostear quotes con pedido), con el quote desactualizado (lo resuelve el Reintentar
// del Historial) y lo que el vendedor cambio despues de encolar (/actualizar reescribe
// lista, transportista y vigencia: el reintento los regresaria a los viejos). La
// vigencia se compara contra la de la huella (#505: lo que el cotizador escribio, para
// lo que encolo el barrido) y, en lo que encolo la subida, contra la del registro.
export function motivoDescarteReintento(p, registro, { vigenciaRegistro = null } = {}) {
  if (!registro) return 'la cotizacion ya no existe en el cotizador';
  if (texto(registro.folioOperam) !== texto(p.folio)) return `la cotizacion ya no esta ligada al quote ${p.folio}`;
  const gate = puedeActualizarCotizacion({
    hasData: !!registro.data,
    folioOperam: registro.folioOperam,
    orderOperam: registro.data?.orderOperam ?? null,
    espejoOperam: registro.data?.espejoOperam ?? null,
  });
  if (!gate.puede) return gate.motivo;
  if (registro.data.quoteDesactualizado) return 'el quote quedo desactualizado: lo resuelve el Reintentar del Historial';
  const huella = esperadoDeHuella(registro.data.huellaQuote);
  for (const { campo, tipo, reintento: { nombre, vacio } } of FILAS_DESCARTE) {
    if (!huella.trae[campo]) continue;
    // Un `texto` (#556) se compara con el vacio como valor, y solo si se encolo: la
    // fila anterior a #556 (null) no lo escribe, asi que no hay nada que se pise.
    if (tipo === 'texto') {
      if (p[campo] == null) continue;
      const encolado = String(p[campo]).trim();
      if (huella[campo] !== encolado) return `${nombre} cambio despues de encolar (hoy ${huella[campo] || vacio}, se encolo ${encolado || vacio})`;
      continue;
    }
    if (huella[campo] !== texto(p[campo])) return `${nombre} cambio despues de encolar (hoy ${huella[campo] ?? vacio}, se encolo ${p[campo] ?? vacio})`;
  }
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

const CAMPOS = FILAS_REINTENTO.map((f) => [f.campo, f.reintento.etiquetaAviso, f]);

// El correo del aviso. `causa`: 'agotado' (se acabaron los reintentos) o 'definitivo'
// (FA lo rechaza de una forma que reintentar no arregla). null sin destinatarios.
export function mensajeAvisoPostFix(pendiente, { causa } = {}, destinatarios = []) {
  if (!destinatarios.length) return null;
  const p = pendiente || {};
  // En una fila `texto` (#556) el vacio tambien es lo que debia quedar y se nombra.
  const seEscribio = (k, f) => texto(p[k]) !== null || (f.tipo === 'texto' && p[k] === '');
  const esperado = CAMPOS
    .filter(([k, , f]) => seEscribio(k, f))
    .map(([k, etiqueta, f]) => `  - ${etiqueta}: ${p[k] === '' ? f.reintento.vacio : p[k]}`);
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
