// IO del reintento del post-fix web del quote (#380). Aqui se escribe la cola, se
// relee Operam y se manda el correo; lo que se decide vive en lib/postfix-reintento.js.
//
// Tres entradas:
// - encolarPostFix: la subida (postFixQuote en server.js) le pasa lo que no quedo
//   verificado. Nunca lanza: la subida ya respondio o esta por responder.
// - procesarColaPostFix: el worker (timer de 1 min en server.js) reintenta lo que ya
//   toca, con la MISMA escritura y verificacion del post-fix (corregirVigenciaQuote).
// - barrerQuotesPostFix: el barrido diario relee por la API los quotes del cotizador
//   de los ultimos 30 dias y encola los desfasados.
//
// Cola y barrido comparten UN lock en memoria (una sola instancia en Render, como
// los demas barridos): nunca corren dos a la vez. Ritmo PROPIO y secuencial (#438):
// una operacion contra Operam cada INTERVALO_MS como minimo; jamas _setMinInterval,
// que frenaria a todo el cotizador.

import {
  clasificarPostFix, proximoIntento, vigenciaAnteriorAlDocumento,
  destinatariosAvisoPostFix, mensajeAvisoPostFix,
  cotizacionesDelBarrido, vigenciaDeComentarios, desfaseQuote,
  esperadoDeHuella, motivoDescarteReintento,
} from './postfix-reintento.js';
import * as pendientesStore from './postfix-pendientes-store.js';
import * as vendedoresStore from './vendedores-store.js';
import { transportadorConfigurado, REMITENTE } from './alerta-mayoreo-io.js';
import { corregirVigenciaQuote, abrirSesionWeb, transaccionCancelada } from './operam-web.js';
import { obtenerQuote, listarPedidos, vigenciaDeCotizacion } from './operam-client.js';
import * as cotStore from './cotizaciones-store.js';

const LOG = '[post-fix reintento]';

// Una operacion contra Operam cada INTERVALO_MS como minimo, contado desde que arranco
// la anterior (el ritmo de almacen-domicilios-io.js, #438).
const INTERVALO_MS = 1100;
const sleep = (ms) => new Promise(res => setTimeout(res, ms));
const PAGINA_PEDIDOS = 100;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

async function enviarCorreoSmtp(mensaje) {
  const nodemailer = (await import('nodemailer')).default;
  const transporte = transportadorConfigurado(nodemailer);
  if (!transporte) throw new Error('SMTP sin configurar (SMTP_USER / SMTP_PASS)');
  return transporte.sendMail({ from: REMITENTE, to: mensaje.to.join(', '), subject: mensaje.subject, text: mensaje.text });
}

function io(deps = {}) {
  return {
    ahora: () => new Date(),
    esperar: sleep,
    store: pendientesStore,
    corregirVigenciaQuote,
    obtenerQuote,
    obtenerCotizacion: cotStore.obtener,
    listarVendedores: vendedoresStore.listar,
    enviarCorreo: enviarCorreoSmtp,
    ...deps,
  };
}

// El aviso ACTIVO: correo a Adrian y al vendedor del quote. Queda rastro en Render
// siempre, llegue o no el correo. La fila pasa a 'avisado' aunque el SMTP falle: un
// aviso que no se pudo mandar no debe convertirse en reintentos de escritura sin fin.
async function avisar(pendiente, causa, x) {
  console.error(`${LOG} quote ${pendiente.folio} sin corregir (${causa}): ${pendiente.motivo}`);
  try {
    const vendedores = await x.listarVendedores();
    const destinatarios = destinatariosAvisoPostFix(vendedores, pendiente.vendedor, {
      adminEmailFallback: process.env.ALERTA_ADMIN_EMAIL,
    });
    const mensaje = mensajeAvisoPostFix(pendiente, { causa }, destinatarios);
    if (!mensaje) {
      console.error(`${LOG} quote ${pendiente.folio}: nadie con correo registrado a quien avisar`);
    } else {
      await x.enviarCorreo(mensaje);
    }
  } catch (err) {
    console.error(`${LOG} quote ${pendiente.folio}: el correo de aviso fallo:`, err.message);
  }
  await x.store.guardar({ ...pendiente, estado: 'avisado', proximoIntento: null });
}

// El juicio de UN intento del post-fix: su resultado (o la excepcion) -> estado y
// motivo. La vigencia anterior a la fecha del documento no se intenta: FA rechaza el
// ProcessOrder entero (#406).
function juicio({ resultado, error }) {
  if (error != null) return { estado: 'transitorio', motivo: `el post-fix fallo antes de verificar: ${error}` };
  return clasificarPostFix(resultado);
}

function pendienteDe(entrada, origen) {
  return {
    folio: String(entrada.folio),
    cotizacionId: entrada.cotizacionId ?? null,
    vendedor: entrada.vendedor ?? null,
    origen,
    vigencia: entrada.vigencia ?? null,
    lista: entrada.lista ?? null,
    transportista: entrada.transportista ?? null,
    fechaDocumento: entrada.fechaDocumento ?? null,
    estado: 'pendiente',
    intentos: 0,
  };
}

// Serializa las escrituras de encolado y le da a las pruebas algo que esperar: la
// subida no espera esta promesa.
let encolados = Promise.resolve();
export function _esperarEncolados() {
  return encolados;
}

export function encolarPostFix(entrada, deps = {}) {
  const trabajo = encolados.then(() => encolarAhora(entrada, deps));
  encolados = trabajo.catch(() => {});
  return trabajo;
}

async function encolarAhora(entrada, deps) {
  const x = io(deps);
  try {
    const base = pendienteDe(entrada, 'post-fix');
    if (vigenciaAnteriorAlDocumento(base.vigencia, base.fechaDocumento)) {
      return await avisar({ ...base, motivo: `vigencia ${base.vigencia} anterior a la fecha del documento ${base.fechaDocumento}: Operam rechaza el cambio` }, 'definitivo', x);
    }
    const j = juicio(entrada);
    if (j.estado === 'verificado') return;
    const pendiente = { ...base, motivo: j.motivo };
    if (j.estado === 'definitivo') return await avisar(pendiente, 'definitivo', x);
    const encolado = await x.store.encolar({ ...pendiente, proximoIntento: proximoIntento(0, x.ahora()).toISOString() });
    if (encolado) console.error(`${LOG} quote ${pendiente.folio} encolado para reintento: ${j.motivo}`);
  } catch (err) {
    console.error(`${LOG} no se pudo encolar el quote ${entrada?.folio}:`, err.message);
  }
}

// La actualizacion del quote que el vendedor logro (#104) reescribe lista,
// transportista y vigencia: lo encolado antes traeria los valores VIEJOS y la
// revertiria. Sale de la cola; nunca lanza.
export async function sacarDeLaColaPostFix(folio, deps = {}) {
  const x = io(deps);
  try {
    await x.store.borrar(String(folio));
  } catch (err) {
    console.error(`${LOG} no se pudo sacar de la cola el quote ${folio}:`, err.message);
  }
}

// UN lock para la cola y el barrido: una sola corrida a la vez en el proceso.
let enCurso = false;
async function conLock(fn) {
  if (enCurso) return { omitido: true };
  enCurso = true;
  try {
    return await fn();
  } finally {
    enCurso = false;
  }
}

// El ritmo propio: antes de cada operacion contra Operam, espera lo que falte para
// cumplir INTERVALO_MS desde que arranco la anterior. Nunca rafaga.
function ritmo(x) {
  let ultima = null;
  return async function aSuRitmo(fn) {
    if (ultima !== null) {
      const falta = ultima + INTERVALO_MS - x.ahora().getTime();
      if (falta > 0) await x.esperar(falta);
    }
    ultima = x.ahora().getTime();
    return fn();
  };
}

const toca = (p, ahora) => p.estado === 'pendiente' && (p.proximoIntento == null || new Date(p.proximoIntento).getTime() <= ahora.getTime());

// Un reintento: la MISMA escritura y verificacion del post-fix de la subida
// (corregirVigenciaQuote con la vigencia, la lista y el transportista que se
// guardaron al encolar). Devuelve el desenlace para el resumen.
async function reintentar(p, x) {
  if (vigenciaAnteriorAlDocumento(p.vigencia, p.fechaDocumento)) {
    await avisar({ ...p, motivo: `vigencia ${p.vigencia} anterior a la fecha del documento ${p.fechaDocumento}: Operam rechaza el cambio` }, 'definitivo', x);
    return 'avisado';
  }
  // Primero el REGISTRO del cotizador: si ya no respalda lo encolado (pedido, quote
  // desactualizado, o el vendedor lo actualizo despues con otra lista, transportista o
  // vigencia) la fila sale sin escribir. Sin poder leerlo no se escribe: transitorio.
  let registro;
  try {
    registro = await x.obtenerCotizacion(p.cotizacionId);
  } catch (err) {
    return await registrarFallo(p, x, juicio({ error: `no se pudo releer la cotizacion antes de reintentar: ${err.message}` }));
  }
  const descarte = motivoDescarteReintento(p, registro, { vigenciaRegistro: registro?.data ? vigenciaDeCotizacion(registro.data) : null });
  if (descarte) {
    await x.store.borrar(p.folio);
    console.log(`${LOG} quote ${p.folio} sale de la cola sin reintentar: ${descarte}`);
    return 'verificado';
  }
  // Relectura ANTES de escribir, por la API: si el quote ya tiene lo esperado no se
  // repostea (tambien cubre el post-fix que si pego y la vista no dejo verificar), y si
  // su comments ya lleva OTRA vigencia es que el documento se reescribio despues de
  // encolar (la actualizacion de #104): el reintento traeria la vigencia vieja y lo
  // regresaria, asi que sale de la cola y el barrido diario juzga el documento nuevo.
  // Sin poder leerlo no se escribe a ciegas: cuenta como transitorio.
  let entrada;
  let quote;
  try {
    quote = await x.obtenerQuote(p.folio);
    if (!quote) throw new Error(`Operam no devuelve el quote ${p.folio}`);
  } catch (err) {
    entrada = { error: `no se pudo releer el quote antes de reintentar: ${err.message}` };
  }
  if (quote) {
    const vigenciaActual = vigenciaDeComentarios(quote.comments);
    if (vigenciaActual !== null && p.vigencia != null && vigenciaActual !== p.vigencia) {
      await x.store.borrar(p.folio);
      console.log(`${LOG} quote ${p.folio} se reescribio despues de encolar (Valido hasta ${vigenciaActual}, se encolo ${p.vigencia}): no se toca`);
      return 'verificado';
    }
    if (!desfaseQuote(quote, p).length) {
      await x.store.borrar(p.folio);
      console.log(`${LOG} quote ${p.folio} ya estaba como se esperaba: no se reescribe`);
      return 'verificado';
    }
    try {
      entrada = { resultado: await x.corregirVigenciaQuote(p.folio, p.vigencia, { lista: p.lista, transportista: p.transportista }) };
    } catch (err) {
      entrada = { error: err.message };
    }
  }
  return registrarFallo(p, x, juicio(entrada));
}

// El desenlace de un intento: verificado sale de la cola; lo definitivo o agotado se
// avisa; lo transitorio sube un intento y espera su backoff.
async function registrarFallo(p, x, j) {
  if (j.estado === 'verificado') {
    await x.store.borrar(p.folio);
    console.log(`${LOG} quote ${p.folio} corregido y verificado en el reintento ${p.intentos + 1}`);
    return 'verificado';
  }
  const intentos = p.intentos + 1;
  if (j.estado === 'definitivo') {
    await avisar({ ...p, intentos, motivo: j.motivo }, 'definitivo', x);
    return 'avisado';
  }
  const proximo = proximoIntento(intentos, x.ahora());
  if (!proximo) {
    await avisar({ ...p, intentos, motivo: j.motivo }, 'agotado', x);
    return 'avisado';
  }
  console.error(`${LOG} quote ${p.folio} sigue sin verificar (reintento ${intentos}): ${j.motivo}`);
  await x.store.guardar({ ...p, intentos, proximoIntento: proximo.toISOString(), motivo: j.motivo });
  return 'reintentar';
}

export function procesarColaPostFix(deps = {}) {
  const x = io(deps);
  return conLock(async () => {
    const resumen = { revisados: 0, verificados: 0, reintentar: 0, avisados: 0 };
    let cola;
    try {
      cola = (await x.store.listar()).filter(p => toca(p, x.ahora()));
    } catch (err) {
      console.error(`${LOG} no se pudo leer la cola:`, err.message);
      return { ...resumen, error: err.message };
    }
    const aSuRitmo = ritmo(x);
    for (const p of cola) {
      resumen.revisados++;
      try {
        const desenlace = await aSuRitmo(() => reintentar(p, x));
        if (desenlace === 'verificado') resumen.verificados++;
        else if (desenlace === 'avisado') resumen.avisados++;
        else resumen.reintentar++;
      } catch (err) {
        console.error(`${LOG} quote ${p.folio}: el reintento fallo sin poder registrarse:`, err.message);
      }
    }
    return resumen;
  });
}

// El detector de cancelados por defecto: la API v3 pinta un quote anulado IGUAL que
// uno vivo, y solo la vista read-only de FA lo dice (#76). Sesion PROPIA por barrido,
// nunca la compartida del post-fix (esa es del carrito de edicion). trans_type 32.
function detectorDeCancelados() {
  let consultar = null;
  return async (folio) => {
    if (!consultar) consultar = await abrirSesionWeb();
    return transaccionCancelada(consultar, folio, 32);
  };
}

const describirDesfase = (d) => d.map(x => `${x.campo}: en Operam ${x.encontrado ?? '(vacio)'}, se esperaba ${x.esperado}`).join('; ');

// El barrido diario (#380): relee por la API los quotes del cotizador de los ultimos
// 30 dias y ENCOLA los que no tienen lo que el post-fix debia dejar. No escribe: la
// correccion la hace el worker de la cola con la misma escritura del post-fix, asi que
// el barrido y la subida desembocan en el mismo camino.
//
// Lo esperado: la vigencia que el quote LLEVA en comments (nunca `data.vigencia`, que
// se mueve con cada regeneracion) y la lista y el transportista que la subida INTENTO,
// tal como quedaron en `data.huellaQuote` (`esperadoDeHuella`). Un campo que la huella
// no trae no se juzga: los quotes anteriores a #448 tienen ship_via 1 a proposito, y
// recalcularlo con el catalogo y /admin de hoy reescribiria 30 dias al cambiarlos.
// El desfasado solo se encola si se CONFIRMA en vivo que no esta cancelado.
export function barrerQuotesPostFix(deps = {}) {
  const x = {
    listarCotizaciones: cotStore.listar,
    listarPedidos,
    quoteCancelado: detectorDeCancelados(),
    ...io(deps),
  };
  return conLock(async () => {
    const resumen = { revisados: 0, desfasados: 0, conPedido: 0, encolados: 0, cancelados: 0, sinLeer: 0, sinVerificar: 0 };
    let candidatos;
    try {
      const enCola = new Set((await x.store.listar()).map(p => String(p.folio)));
      candidatos = cotizacionesDelBarrido(await x.listarCotizaciones(), { ahora: x.ahora(), foliosEnCola: enCola });
    } catch (err) {
      console.error(`${LOG} barrido: no se pudo armar la lista de quotes:`, err.message);
      return { ...resumen, error: err.message };
    }
    console.log(`${LOG} barrido iniciado: ${candidatos.length} quote(s) del cotizador de los ultimos 30 dias`);
    const aSuRitmo = ritmo(x);

    // 1) Releer cada quote y quedarse con los desfasados.
    const desfasados = [];
    for (const c of candidatos) {
      const folio = String(c.folioOperam);
      resumen.revisados++;
      let quote;
      try {
        quote = await aSuRitmo(() => x.obtenerQuote(folio));
      } catch (err) {
        resumen.sinLeer++;
        console.error(`${LOG} barrido: no se pudo leer el quote ${folio}:`, err.message);
        continue;
      }
      if (!quote) continue;
      const vigencia = vigenciaDeComentarios(quote.comments);
      const { lista, transportista } = esperadoDeHuella(c.data?.huellaQuote);
      const desfase = desfaseQuote(quote, { vigencia, lista, transportista });
      if (desfase.length) desfasados.push({ c, folio, quote, vigencia, lista, transportista, desfase });
    }
    resumen.desfasados = desfasados.length;
    if (!desfasados.length) {
      console.log(`${LOG} barrido terminado: ${JSON.stringify(resumen)}`);
      return resumen;
    }

    // 2) Fuera los que ya se convirtieron en pedido. La evidencia es el trans_no_from
    // de los pedidos que enumera la API (el espejo local data.orderOperam es
    // incompleto, #344); un pedido nace despues de su quote, asi que se leen desde la
    // fecha del quote desfasado mas viejo. Sin poder leerlos no se encola nada esa
    // pasada: sin evidencia no se escribe en un documento que pudo ya tener pedido.
    const conPedido = new Set();
    try {
      const fechas = desfasados.map(d => String(d.quote.ord_date ?? '').slice(0, 10)).filter(f => FECHA.test(f)).sort();
      const hasta = x.ahora().toISOString().slice(0, 10);
      const desde = fechas[0] ?? hasta;
      for (let skip = 0; ; skip += PAGINA_PEDIDOS) {
        const pagina = await aSuRitmo(() => x.listarPedidos({ desde, hasta, skip, limit: PAGINA_PEDIDOS }));
        for (const pe of pagina || []) {
          if (pe?.trans_no_from != null && pe.trans_no_from !== '') conPedido.add(String(pe.trans_no_from));
        }
        if (!Array.isArray(pagina) || pagina.length < PAGINA_PEDIDOS) break;
      }
    } catch (err) {
      console.error(`${LOG} barrido: no se pudieron leer los pedidos de Operam; no se encola nada esta pasada:`, err.message);
      return { ...resumen, sinEvidencia: true };
    }

    // 3) Solo lo que la vista confirma NO anulado entra a la cola.
    for (const { c, folio, quote, vigencia, lista, transportista, desfase } of desfasados) {
      if (conPedido.has(folio)) {
        resumen.conPedido++;
        continue;
      }
      let cancelado;
      try {
        cancelado = await aSuRitmo(() => x.quoteCancelado(folio));
      } catch (err) {
        resumen.sinVerificar++;
        console.error(`${LOG} barrido: quote ${folio} desfasado pero no se pudo confirmar que no este cancelado; no se toca:`, err.message);
        continue;
      }
      if (cancelado) {
        resumen.cancelados++;
        continue;
      }
      try {
        const encolado = await x.store.encolar({
          folio, cotizacionId: c.id ?? null, vendedor: c.vendedor ?? null, origen: 'barrido',
          vigencia: vigencia ?? quote.delivery_date ?? null, lista, transportista,
          fechaDocumento: quote.ord_date ?? null,
          estado: 'pendiente', intentos: 0,
          proximoIntento: proximoIntento(0, x.ahora()).toISOString(),
          motivo: describirDesfase(desfase),
        });
        if (encolado) {
          resumen.encolados++;
          console.error(`${LOG} barrido: quote ${folio} desfasado, encolado: ${describirDesfase(desfase)}`);
        }
      } catch (err) {
        console.error(`${LOG} barrido: no se pudo encolar el quote ${folio}:`, err.message);
      }
    }
    console.log(`${LOG} barrido terminado: ${JSON.stringify(resumen)}`);
    return resumen;
  });
}
