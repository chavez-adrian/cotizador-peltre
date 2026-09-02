import express from 'express';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { extractPrices, diffPrices } from './lib/extract-prices.js';
import { generateQuotePDF } from './lib/pdf-generator.js';
import { generateQuoteHTML } from './lib/html-generator.js';
import { calcularPaquetes } from './lib/calcular-envio.js';
import { buscarClientes, buscarClientesPorRfc, obtenerDomicilios, subirCotizacionOperam, actualizarClienteDirecto, buscarClientePorRFC, verificarRfcLibre, crearCliente, crearClienteDirecto, actualizarBranchCliente, crearBranchCliente, obtenerBranchId, obtenerBranchesCliente, obtenerBranch, obtenerClientePorId, vigenciaDeCotizacion, huellaContenidoQuote, contenidoQuoteCambio, listarTodosClientes, listarPedidos, obtenerQuote, obtenerCliente, listarSalesTypes, listarPreciosCompletos, listarItemsCompletos, _setMinInterval } from './lib/operam-client.js';
import { corregirVigenciaQuote, actualizarQuoteOperam, actualizarSegmentoClienteWeb } from './lib/operam-web.js';
import { puedeActualizarCotizacion } from './public/js/cotizaciones-logica.js';
import { buscarClientesPorTexto } from './lib/indice-telefonos.js';
import { buildActualizarFiscalPayload, bodyDesdeDiffFiscal, calcularDiffFiscal, camposNoAplicados, precargaComercialUpgrade } from './public/js/alta-logica.js';
import { necesitaAltaGenerica, rfcGenericoDe, buildClienteGenerico, resolverSalesTypeId, FUENTE_ALTA_GENERICA, FUENTE_SUCURSAL_CREADA, buildBranchGenerico, sucursalEquivalente, diffBranchDomicilio } from './lib/alta-generica.js';
import { construirReporteHigiene } from './lib/higiene-clientes.js';
import { construirCatalogo, productosSinCaja } from './lib/catalogo-operam.js';
import { reconciliarPorIdentificador, reconciliarOportunidad, esActivaPostVentaCandidata } from './lib/sync-operam-io.js';
import { extraerIdentificador, registrarEvento as registrarEventoWebhook, marcarProcesado } from './lib/sync-operam-webhook.js';
import { detectarDuplicados, RFC_GENERICOS, esDebtorGenerico, normalizarRfc, normalizarNombre, hechosCandidato, agregarCandidatosPorCustRef, coincideCustRef } from './lib/deduplicacion.js';
import { construirEntradaCotizacion } from './lib/backfill-operam.mjs';
import { depositarCandidatos, MESES_VENTANA, fechaCorteMeses } from './lib/recolector-genericos.mjs';
import { folioMaximoConocido, planearDescubrimiento } from './lib/descubrimiento-operam.mjs';
import { GRACIA_DIAS } from './lib/cruce-identidad.js';
import { paisDeClienteOperam } from './lib/pais-operam.js';
import { parsearCSF } from './lib/parsear-csf.js';
import { query as dbQuery } from './lib/db.js';
import { calcularCola, telefonoValido, telefonoWa } from './lib/seguimiento.js';
import { calcularColaProspectos } from './lib/seguimiento-prospectos.js';
import { calcularColaHoy } from './lib/cola-hoy.js';
import * as cotStore from './lib/cotizaciones-store.js';
import * as prospectosStore from './lib/prospectos-store.js';
import * as bandejaStore from './lib/bandeja-store.js';
import * as vendedoresStore from './lib/vendedores-store.js';
import * as configStore from './lib/config-store.js';
import { clasificarCelular } from './lib/clasificar-celular.js';
import { importarProspectosFeria } from './lib/importar-prospectos.js';
import { refrescarIndice, matchCliente, clientesCacheados } from './lib/indice-telefonos.js';
import { primerDiaHabilDespues } from './lib/horas-habiles.js';
import { transicionPorCotizacion, transicionPorAsignacion, esSalida, documentoBloqueado, cotizacionesDedupVencidas, LEYENDA_DEDUP_PENDIENTE, MOTIVO_PRE_DEDUP, MOTIVO_PRE_OPERAM } from './lib/pipeline.js';
import { puedeAsignar, normalizarPuedeAsignar } from './public/js/pipeline-logica.js';
import { validarProspectoBody, validarTransicion, contarMotivosNoUtil, reunionPendienteResultado, reunionPendienteResultadoDe, validarEdicionProspecto, buildEdicionProspectoDatos, CANALES, MOTIVOS_NO_UTIL, OPCIONALES as PROSPECTO_OPCIONALES, normalizarTextosProspecto, validarProspectoExpoBody, buildDatosExpo, validarCalificacion, buildCalificacion, validarSiguienteContacto, buildEventoSiguienteContacto } from './public/js/prospectos-logica.js';
import { PASOS_DECORADO, checklistInicial, marcarPaso, revertirPaso, progresoDecorado, puedeLiberar } from './public/js/decorados-logica.js';
import { piezasDeProducto, validarPreciosManualesCalca, aplicarPrecioManualEnPartidas, MOTIVOS_PRECIO_MANUAL, puedePrecioCalca, normalizarPuedePrecioCalca } from './public/js/calcas-logica.js';
import { topeDescuentoVendedor, validarDescuentosCotizacion, partidasConDescuento, normalizarTope } from './public/js/descuento-logica.js';
import { validarTierCotizacion, puedeFijarLista, normalizarPuedeFijarLista } from './public/js/tier-logica.js';
import { validarDescripcionesCotizacion } from './public/js/descripcion-logica.js';
import { validarMayoreo, buildCapturaMayoreo, capitalizarCampo } from './public/js/mayoreo-logica.js';
import { numeroTelefonoEsPosible } from './lib/telefono-posible.js';
import { permitirCaptura } from './lib/rate-limit-publico.js';
import { verificarTurnstile, turnstileConfigurado } from './lib/turnstile.js';
import { validarCP } from './lib/validar-cp.js';
import { buscarCP } from './lib/codigos-postales.js';
import { leerArchivoSync } from './lib/fs-reintento.js';
import { enviarAlertaMayoreo } from './lib/alerta-mayoreo-io.js';
import { barrerContactosGoogle } from './lib/contactos-io.js';
import { sondearPedidosShopify } from './lib/pedidos-shopify-io.js';
import { credencialesConfiguradas as shopifyConfigurado } from './lib/shopify-pedidos.js';
import { credencialesConfiguradas as googleConfigurado } from './lib/google-contactos.js';
import { registrarBarrido as registrarBarridoContactos } from './lib/contactos-observabilidad-io.js';
import { listarTodos as listarBarridosContactos } from './lib/contactos-observabilidad-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');
const PUBLIC_DIR = join(__dirname, 'public');

const envFile = join(__dirname, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const PORT = process.env.PORT || 3000;

// Segmentos reales de Operam (id interno, NO la clave 000-1000), recolectados
// de los 440 clientes de produccion el 2026-06-10. Operam no expone catalogo
// (GET segments -> 501); si se agrega un segmento en Operam hay que sumarlo aqui.
const SEGMENTOS = [
  { id: 1,  nombre: 'Sin segmento' },
  { id: 14, nombre: 'Distribuidores' },
  { id: 8,  nombre: 'Menudistas' },
  { id: 10, nombre: 'Restaurantes, hoteles' },
  { id: 12, nombre: 'Agencias | Marcas' },
  { id: 11, nombre: 'e-commerce' },
  { id: 15, nombre: 'Eventos' },
  { id: 16, nombre: 'Consumidor final' },
  { id: 13, nombre: 'Empleados' },
  { id: 9,  nombre: 'Familia y Amigos' },
  { id: 17, nombre: 'Maquila' },
];

let listasPrecios = [];

const app = express();
// Un solo salto de proxy (el de Render). Con esto req.ip es la IP real del
// visitante y no la del proxy -- si no, TODAS las capturas publicas caerian en
// el mismo balde del rate limit. Un valor de `true` (confiar en toda la cadena)
// seria peor que nada aqui: dejaria que el cliente falsee su IP con un
// X-Forwarded-For propio.
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(express.static(PUBLIC_DIR));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

function readJSON(filename) {
  const path = join(DATA_DIR, filename);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJSON(filename, data) {
  writeFileSync(join(DATA_DIR, filename), JSON.stringify(data, null, 2));
}

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No autorizado' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token invalido' });
  }
}

function adminMiddleware(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Solo administradores' });
  next();
}

// Los handlers que consultan el store de vendedores llevan try/catch propio:
// en Express 4 un rechazo en handler async no llega al error handler y tumba
// el proceso (unhandled rejection). Sin DATABASE_URL el store no rechaza; con
// Neon, un fallo transitorio debe ser un 500, no una caida.
app.post('/api/login', async (req, res) => {
  try {
    const { vendedorId, pin } = req.body;
    const vendedores = await vendedoresStore.listar();
    if (!vendedores.length) return res.status(500).json({ error: 'Vendedores no configurados' });
    const v = vendedores.find(v => v.id === vendedorId && v.pin === pin);
    if (!v) return res.status(401).json({ error: 'PIN incorrecto' });
    const token = jwt.sign({ id: v.id, name: v.name, role: v.role }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, user: { id: v.id, name: v.name, role: v.role } });
  } catch (err) {
    res.status(500).json({ error: 'Registro de vendedores no disponible: ' + err.message });
  }
});

app.get('/api/vendedores', async (req, res) => {
  try {
    const vendedores = await vendedoresStore.listar();
    if (!vendedores.length) return res.status(500).json({ error: 'Vendedores no configurados' });
    res.json(vendedores.map(v => ({ id: v.id, name: v.name })));
  } catch (err) {
    res.status(500).json({ error: 'Registro de vendedores no disponible: ' + err.message });
  }
});

// Tope de descuento VIGENTE del usuario autenticado (#137). Se lee del registro
// de vendedores en cada consulta, no del JWT: el token no se re-emite cuando el
// admin otorga o quita el permiso, asi que meterlo ahi lo dejaria congelado
// hasta el siguiente login. El rol viene del token (el mismo que ya decide
// adminMiddleware); un id que no este en el registro cae a 0.
async function topeDescuentoDeUsuario(user) {
  const registro = (await vendedoresStore.listar()).find(v => v.id === user?.id);
  return topeDescuentoVendedor({ role: user?.role, topeDescuento: registro?.topeDescuento });
}

// Permiso de fijar lista VIGENTE del usuario autenticado (#153, spec #98).
// Mismo motivo que topeDescuentoDeUsuario: se lee del registro en cada
// consulta, no del JWT, porque el token no se re-emite cuando el admin
// otorga o quita el checkbox.
async function puedeFijarListaDeUsuario(user) {
  const registro = (await vendedoresStore.listar()).find(v => v.id === user?.id);
  return puedeFijarLista({ role: user?.role, puedeFijarLista: registro?.puedeFijarLista });
}

// Permiso de capturar el precio de una calca (#280, spec #278), espejo exacto
// de puedeFijarListaDeUsuario: se lee del registro en cada consulta, no del
// JWT, porque el token no se re-emite cuando el admin otorga o quita el
// checkbox.
async function puedePrecioCalcaDeUsuario(user) {
  const registro = (await vendedoresStore.listar()).find(v => v.id === user?.id);
  return puedePrecioCalca({ role: user?.role, puedePrecioCalca: registro?.puedePrecioCalca });
}

// Permiso de asignacion VIGENTE del usuario autenticado (#156, spec #155,
// CONTEXT.md "Visibilidad"): ver la columna No Asignado y asignarle dueno a esas
// tarjetas. Mismo motivo que los dos anteriores para leerlo del registro y no
// del JWT: el token no se re-emite cuando el admin otorga o quita el checkbox,
// y este permiso abre visibilidad sobre tarjetas ajenas -- quitarlo tiene que
// surtir efecto en la siguiente peticion, no en el siguiente login.
async function puedeAsignarDeUsuario(user) {
  const registro = (await vendedoresStore.listar()).find(v => v.id === user?.id);
  return puedeAsignar({ role: user?.role, puedeAsignar: registro?.puedeAsignar });
}

// Middleware del permiso de asignacion: reemplaza a adminMiddleware en las rutas
// que asignan dueno. NO existe rol gerente (decision explicita de la spec #155):
// el permiso es un checkbox por vendedor, ningun otro check de admin cambia.
async function asignacionMiddleware(req, res, next) {
  try {
    if (!(await puedeAsignarDeUsuario(req.user))) {
      return res.status(403).json({ error: 'Sin permiso de asignación' });
    }
    next();
  } catch (err) {
    res.status(500).json({ error: 'Registro de vendedores no disponible: ' + err.message });
  }
}

app.get('/api/precios', authMiddleware, async (req, res) => {
  try {
    const precios = readJSON('precios.json');
    if (!precios) return res.status(500).json({ error: 'Precios no disponibles' });
    const config = configStore.leer() || {
      tiposActivos: precios.tiposProducto || [],
      texturasActivas: Object.keys(precios.texturas || {}).map(Number).filter(t => ![0, 8, 9].includes(t)),
    };
    // El tope y el permiso de fijar lista viajan con los precios porque son
    // parte del poder de precio del vendedor y la pantalla los refresca en
    // cada arranque de sesion (showApp).
    res.json({
      ...precios, config,
      topeDescuento: await topeDescuentoDeUsuario(req.user),
      puedeFijarLista: await puedeFijarListaDeUsuario(req.user),
      puedePrecioCalca: await puedePrecioCalcaDeUsuario(req.user),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function validarTelefonoCotizacion(req, res) {
  const tel = req.body?.cliente?.telefono;
  if (!tel) {
    res.status(400).json({ error: 'El telefono del cliente es obligatorio' });
    return false;
  }
  if (!telefonoValido(tel)) {
    res.status(400).json({ error: 'El telefono debe incluir codigo de pais (ej. +52 55 1234 5678)' });
    return false;
  }
  return true;
}

// Hook de embudo al crear cotizacion (issue #46; vocabulario del pipeline
// unificado, issue #53; regla de dominio formal, issue #55): la transicion la
// gobierna transicionPorCotizacion (lib/pipeline.js), el mismo disparador que
// usara el sync de Operam (#62). Desde Por Cotizar/No util -> Seguimiento; si ya
// esta en Seguimiento (idempotente) o la regla no permite mover (No Asignado sin
// vendedor, etapas post-venta que mueve Operam, Perdida) solo se acumula el
// evento sin cambiar la etapa. Celular libre con canal del catalogo -> auto-crea
// el prospecto directo en Seguimiento con los datos de la cotizacion (sin canal
// no se crea: el frontend siempre lo manda, la API directa sin canal no genera
// prospecto); celular de cliente Operam -> nada. Best effort: un fallo aqui jamas
// rompe la generacion.
async function pasarProspectoASeguimiento(p, cotizacionId, vendedor) {
  const evento = {
    tipo: 'cotizacion', cotizacion_id: cotizacionId, de: p.etapa,
    fecha: new Date().toISOString(), vendedor,
  };
  const destino = transicionPorCotizacion(p.etapa);
  if (destino && destino !== p.etapa) await prospectosStore.cambiarEtapa(p.id, destino, evento);
  else await prospectosStore.registrarEvento(p.id, evento);
}

async function actualizarEmbudoPorCotizacion(data, cotizacionId, vendedor) {
  try {
    const celular = data.cliente?.telefono;
    // Sin canal valido no puede haber auto-creacion: basta buscar el prospecto
    // local, sin consultar el indice de Operam (el caso comun: cotizar a
    // clientes existentes no toca Operam).
    if (!CANALES.includes(data.canal)) {
      const p = await prospectosStore.buscarPorCelular(celular);
      if (p) await pasarProspectoASeguimiento(p, cotizacionId, vendedor);
      return;
    }
    const clasificacion = await clasificarCelular(celular);
    if (clasificacion.tipo === 'prospecto') {
      await pasarProspectoASeguimiento(clasificacion.prospecto, cotizacionId, vendedor);
      return;
    }
    if (clasificacion.tipo === 'cliente') return;
    const fecha = new Date().toISOString();
    const id = await prospectosStore.crear({
      fecha, vendedor, celular: celular.trim(),
      nombre: data.cliente?.nombreCorto || data.cliente?.razonSocial || 'Sin nombre',
      ciudad: data.cliente?.municipio || data.cliente?.estado || '',
      canal: data.canal, etapa: 'seguimiento', data: {},
    });
    await prospectosStore.registrarEvento(id, { tipo: 'cotizacion', cotizacion_id: cotizacionId, fecha, vendedor });
  } catch (err) {
    console.warn('[prospectos] hook de cotizacion fallo:', err.message);
  }
}

// Crea la cotizacion, o -- si el body trae un cotizacionId de un entry existente
// (issue #83, F1) -- ACTUALIZA ese entry y devuelve el mismo id: regenerar el
// mismo carrito en otro formato (PDF para archivo + HTML para WhatsApp) o con
// ajustes es UNA sola cotizacion, no dos. En la actualizacion se copian al data
// nuevo el customerId/branchId ya ligados por la subida (#81) -- la regeneracion
// del formulario no los trae y el merge del store reemplaza data.cliente
// completo -- y NO se repite el hook del embudo (el prospecto ya se movio y
// tendria un evento duplicado). cotizacionId invalido o inexistente cae al
// camino de crear.
//
// Devuelve ademas requiereActualizacionOperam (#114): este es el UNICO punto donde
// todavia coexisten el contenido nuevo y la huella de lo que se subio -- un renglon
// mas abajo el data viejo ya se sobrescribio y el "antes" se perdio. Con folio y
// contenido distinto, regenerar tiene que reescribir el quote conservando el folio,
// porque el documento ya sale numerado con el (ADR-0009) y si no el cliente recibe un
// papel que no coincide con lo que produccion ve en el ERP. Sin folio no hay quote que
// actualizar: ese camino es la subida normal.
//
// Aqui NO se aplica el gate de puedeActualizarCotizacion a proposito: si la cotizacion
// ya tiene pedido, la reescritura es imposible pero la divergencia existe igual, y
// callarla seria peor. Se pide la actualizacion, /actualizar responde 409 con el motivo
// y la UI lo convierte en un aviso visible con la salida (crear una nueva).
// prevConocido (#154): el caller puede pasar el registro previo si ya lo leyo
// (validacion del tier fijado) para no repetir la misma consulta al store en
// el mismo request. undefined => se lee aqui, como siempre.
async function crearOActualizarCotizacion(data, vendedor, prevConocido) {
  const idPrevio = parseInt(data.cotizacionId, 10);
  delete data.cotizacionId; // campo de control: no persistirlo dentro de data
  const entry = {
    fecha: new Date().toISOString(), vendedor,
    cliente: data.cliente?.nombreCorto || data.cliente?.razonSocial || 'Sin nombre',
    // Piezas de PRODUCTO (#91): las de calca no cuentan como volumen -- van
    // aplicadas sobre piezas que ya estan contadas -- y el envio no es pieza.
    totalPiezas: piezasDeProducto(data.items),
    total: data.total || 0, tier: data.tier || '', data,
  };
  if (Number.isInteger(idPrevio) && idPrevio > 0) {
    const prev = prevConocido !== undefined ? prevConocido : await cotStore.obtener(idPrevio);
    if (prev) {
      const prevCli = prev.data?.cliente || {};
      if (data.cliente) {
        if (data.cliente.customerId == null && prevCli.customerId != null) data.cliente.customerId = prevCli.customerId;
        if (data.cliente.branchId == null && prevCli.branchId != null) data.cliente.branchId = prevCli.branchId;
      }
      const yaEnOperam = prev.folioOperam != null && prev.folioOperam !== '';
      const requiereActualizacionOperam = yaEnOperam && contenidoQuoteCambio(data, prev.data?.huellaQuote);
      await cotStore.actualizarCotizacion(idPrevio, entry);
      return { id: idPrevio, requiereActualizacionOperam };
    }
  }
  const id = await cotStore.crear(entry);
  await actualizarEmbudoPorCotizacion(data, id, vendedor);
  return { id, requiereActualizacionOperam: false };
}

// Guardar la cotizacion. NO genera documento (ADR-0009): devuelve el id del
// registro y el folio de Operam si ya existe, y el frontend decide -- guarda,
// espera el folio y pide el documento a los GET, que son el unico generador.
// Sustituye a los POST /api/cotizacion/pdf y /html, que guardaban Y generaban:
// eran dos de los cuatro caminos que decidian por separado que numero llevaba el
// documento, que es la causa raiz de #110.
app.post('/api/cotizacion', authMiddleware, async (req, res) => {
  if (!validarTelefonoCotizacion(req, res)) return;
  // El tope de descuento no depende de la pantalla (#137): misma regla pura que
  // frena la captura en el carrito, aplicada aqui al vendedor autenticado.
  const descuentos = validarDescuentosCotizacion(partidasConDescuento(req.body), await topeDescuentoDeUsuario(req.user));
  if (!descuentos.ok) return res.status(403).json({ error: descuentos.mensaje });
  // La descripcion de partida tampoco depende de la pantalla (#139): el limite es el
  // del textarea de Operam, y pasarse deja al ERP diciendo algo distinto del
  // documento que el cliente ya vio. Es un dato mal formado, no una falta de
  // permiso: 400, no 403.
  const descripciones = validarDescripcionesCotizacion(req.body?.items);
  if (!descripciones.ok) return res.status(400).json({ error: descripciones.mensaje });
  // #154: si se esta editando un registro existente (cotizacionId) Y ese
  // registro es del vendedor que edita (o el editor es admin), lo que YA estaba
  // autorizado ahi -- el tier fijado (#154) y el precio manual de calca (#283)
  // -- sigue siendo valido aunque quien edita no tenga el permiso: corregir
  // cantidades o notas no debe tumbar una autorizacion que ya ocurrio. El
  // chequeo de dueno (mismo predicado que GET /api/cotizaciones/:id) es
  // obligatorio: sin el, un cotizacionId AJENO seria una via para colarse el
  // permiso -- justo el riesgo que el propio ticket #154 senala ("muy laxa =
  // bypass del permiso via edicion").
  const idPrevio = parseInt(req.body?.cotizacionId, 10);
  const prevEntry = Number.isInteger(idPrevio) && idPrevio > 0
    ? await cotStore.obtener(idPrevio)
    : null;
  const esDuenoDelPrevio = !!prevEntry && (req.user.role === 'admin' || prevEntry.vendedor === req.user.name);
  // El precio manual de calca tampoco depende de la pantalla (#279, spec #278):
  // esconder el input no frena un POST armado a mano. Dos desenlaces distintos,
  // igual que en el resto del endpoint: una partida que no es calca o un valor
  // imposible son dato mal formado (400), y capturar sin permiso es falta de
  // permiso (403). #283: sin permiso, la captura que YA traia esa partida en el
  // registro propio que se edita tambien pasa (dejarla como esta o quitarla,
  // nunca cambiarla a otro valor).
  const preciosCalca = validarPreciosManualesCalca(
    req.body?.items,
    await puedePrecioCalcaDeUsuario(req.user),
    esDuenoDelPrevio ? (prevEntry.data?.items ?? null) : null,
  );
  if (!preciosCalca.ok) {
    const status = preciosCalca.motivo === MOTIVOS_PRECIO_MANUAL.SIN_PERMISO ? 403 : 400;
    return res.status(status).json({ error: preciosCalca.mensaje });
  }
  // La lista fijada tampoco depende de la pantalla (#151/#153, spec #98): un
  // tier ajeno al tabulador solo pasa con rol admin o checkbox de vendedor,
  // mismo patron que el tope de descuento -- el permiso lo hace valer el
  // servidor, no el selector oculto. El tabulador del volumen ACTUAL no es la
  // comparacion correcta al editar: se compara contra el tier YA guardado.
  const precios = readJSON('precios.json');
  const tierValidado = validarTierCotizacion(precios?.tiers, piezasDeProducto(req.body?.items), req.body?.tier, await puedeFijarListaDeUsuario(req.user), esDuenoDelPrevio ? (prevEntry.tier ?? null) : null);
  if (!tierValidado.ok) return res.status(403).json({ error: tierValidado.mensaje });
  try {
    const data = req.body;
    // El precio efectivo de una calca con captura ES el manual (#279): el
    // documento, el quote y la huella leen `precio`, asi que dejar el de lista
    // ahi cotizaria el estimado con el precio del proveedor guardado al lado.
    if (Array.isArray(data.items)) data.items = aplicarPrecioManualEnPartidas(data.items);
    data.vendedor = req.user.name;
    const { id, requiereActualizacionOperam } = await crearOActualizarCotizacion(data, req.user.name, prevEntry);
    const entry = await cotStore.obtener(id);
    res.json({ id, folioOperam: entry?.folioOperam ?? null, requiereActualizacionOperam });
  } catch (err) {
    console.error('Error guardando cotizacion:', err);
    res.status(500).json({ error: 'Error guardando la cotizacion' });
  }
});

// UN solo punto arma los datos del documento (ADR-0009). El numero de la
// cotizacion ES el folio de Operam -- columna de primer nivel del registro (#109),
// no vive en data -- y jamas el id interno, que es solo la clave tecnica. Sin
// folio el documento sale sin numero: es una pre-cotizacion, y ponerle el id
// seria reintroducir la doble numeracion por la puerta de atras.
function datosDocumento(entry) {
  const folio = entry.folioOperam != null && entry.folioOperam !== '' ? String(entry.folioOperam) : null;
  return { ...entry.data, folio };
}

// Nombre del archivo descargado, en el unico lugar que lo decide: el
// Content-Disposition del GET (ADR-0009; app.js ya no lo arma). Con folio se
// nombra por folio; sin folio es una pre-cotizacion y tampoco lleva numero.
function nombreArchivoPdf(folio) {
  return folio ? `Cotizacion_PeltreNacional_${folio}.pdf` : 'PreCotizacion_PeltreNacional.pdf';
}

// Regeneran el documento desde el registro guardado (data jsonb) en vez de
// servir un archivo de disco (issue #103): el disco de Render es efimero y
// muere en cada deploy, mientras que data sobrevive en Neon. Sin
// authMiddleware a proposito (se comparten por WhatsApp). Desde ADR-0009 son
// tambien el UNICO camino que genera documento: los POST /pdf y /html se
// eliminaron para que no haya cuatro sitios decidiendo que numero se imprime.
app.get('/api/cotizacion/html/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID invalido' });
  const entry = await cotStore.obtener(id);
  if (!entry || !entry.data) return res.status(404).send('<p>HTML no encontrado</p>');
  // Candado por duplicado sin resolver (#204): AQUI es donde importa. Estas rutas
  // van sin auth y son el UNICO camino que genera documento, asi que apagar los
  // botones en la UI no basta -- el link ya compartido tambien tiene que morir.
  if (documentoBloqueado(entry)) return res.status(409).send(`<p>${LEYENDA_DEDUP_PENDIENTE}.</p>`);
  try {
    const data = datosDocumento(entry);
    const html = generateQuoteHTML(data, { incluirFotos: !!data.incluirFotos });
    res.set({ 'Content-Type': 'text/html; charset=utf-8' });
    res.send(html);
  } catch (err) {
    console.error('Error regenerando HTML:', err);
    res.status(500).send('<p>Error generando HTML</p>');
  }
});

app.get('/api/cotizacion/pdf/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID invalido' });
  const entry = await cotStore.obtener(id);
  if (!entry || !entry.data) return res.status(404).json({ error: 'PDF no encontrado' });
  if (documentoBloqueado(entry)) return res.status(409).json({ error: `${LEYENDA_DEDUP_PENDIENTE}.` });
  try {
    const data = datosDocumento(entry);
    const pdfBuffer = await generateQuotePDF(data);
    // ?descargar=1 = la descarga del vendedor al generar (attachment, con el
    // nombre que decide el server); sin el, inline para el link que se comparte
    // por WhatsApp, que se ve en el navegador.
    const disposicion = req.query.descargar ? 'attachment' : 'inline';
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${disposicion}; filename="${nombreArchivoPdf(data.folio)}"`,
    });
    res.send(pdfBuffer);
  } catch (err) {
    console.error('Error regenerando PDF:', err);
    res.status(500).json({ error: 'Error generando PDF' });
  }
});

app.get('/api/cotizaciones', authMiddleware, async (req, res) => {
  const log = await cotStore.listar();
  const filtradas = req.user.role === 'admin'
    ? log
    : log.filter(c => c.vendedor === req.user.name);
  res.json(filtradas.map(({ id, fecha, vendedor, cliente, totalPiezas, total, tier, data, estado, etapa, folioOperam, registroDesconocido }) => ({
    id, fecha, vendedor, cliente, totalPiezas, total, tier,
    estado: estado || 'abierta',
    etapa,
    // Folio de Operam nullable (issue #63): null = pre-cotizacion (badge "PRE");
    // registroDesconocido = historica anterior a #63 (se asume registrada, sin badge).
    folioOperam: folioOperam ?? null,
    registroDesconocido: registroDesconocido ?? false,
    // Producto decorado / calca (issue #61): el flag y el checklist viven en data;
    // el tablero pinta el checklist con progreso en la tarjeta de cotizacion.
    decorado: data?.decorado === true,
    calcaChecklist: data?.calcaChecklist ?? null,
    // Espejo de la cadena Operam (issue #67, AC3/AC4): cotizacion/pedido/factura/
    // remisiones/pagos/notas que el sync persistio en data.espejoOperam; la tarjeta
    // lo pinta como cadena de folios para trazabilidad.
    espejoOperam: data?.espejoOperam ?? null,
    // Pago sin registrar (issue #77): la tarjeta entregada-impaga muestra el badge
    // "Pago sin registrar" mientras el pago no aparezca liquidado; el sync lo apaga.
    pagoSinRegistrar: data?.pagoSinRegistrar === true,
    // Pedido asociado (#62) y marca de quote desactualizado (#104): el historial los
    // necesita para decidir si ofrece "Actualizar cotizacion" (gate del ADR-0008) y
    // para pintar el reintento cuando la edicion del quote no pego.
    orderOperam: data?.orderOperam ?? null,
    quoteDesactualizado: data?.quoteDesactualizado ?? null,
    // Por que quedo en PRE (#204): con 'dedup' el Historial deshabilita Ver PDF /
    // Ver HTML / WhatsApp con el motivo a la vista. El candado de verdad lo aplican
    // los GET que regeneran.
    motivoPre: data?.motivoPre ?? null,
    telefono: telefonoWa(data?.cliente?.celEntrega || data?.cliente?.telefono),
    // Nombre corto y contacto de entrega (#147): amplian el matching del
    // buscador del Historial (filtrarCotizaciones) mas alla de razon social.
    nombreCorto: data?.cliente?.nombreCorto ?? null,
    contactoEntrega: data?.cliente?.contactoEntrega ?? null,
    hasData: !!data,
  })));
});

app.get('/api/cotizaciones/:id', authMiddleware, async (req, res) => {
  const id = parseInt(req.params.id);
  const entry = await cotStore.obtener(id);
  if (!entry) return res.status(404).json({ error: 'No encontrada' });
  if (req.user.role !== 'admin' && entry.vendedor !== req.user.name) {
    return res.status(403).json({ error: 'Sin acceso' });
  }
  // folioOperam (#109): columna de primer nivel del registro, no vive en data.
  // La vista de cotizacion (cargarCotizacion) lo necesita para el aviso de modo
  // actualizacion sin adivinarlo ni pedirlo aparte; el listado ya lo exponia.
  res.json({ ...entry.data, folioOperam: entry.folioOperam ?? null });
});

app.get('/api/seguimiento', authMiddleware, async (req, res) => {
  const log = await cotStore.listar();
  const visibles = req.user.role === 'admin'
    ? log
    : log.filter(c => c.vendedor === req.user.name);
  res.json(calcularCola(visibles));
});

// Cola Hoy fusionada (issue #64, CONTEXT.md "Cola Hoy"): una sola cola del dia
// que mezcla los prospectos en Por Cotizar (horas habiles) y las cotizaciones
// en Seguimiento (dias naturales), ordenada por urgencia relativa al umbral de
// cada tipo. Reusa los dos motores via lib/cola-hoy.js; la visibilidad por
// vendedor es la misma de /api/prospectos/cola y /api/seguimiento.
//
// Las tarjetas No Asignado entran a la cola (#156) por la MISMA puerta que el
// tablero (prospectosVisiblesPara): solo llegan al admin y a quien tiene el
// permiso de asignacion. El nucleo (lib/cola-hoy.js) las incorpora si llegan y
// las pone al frente; quien no tiene el permiso simplemente no las recibe.
app.get('/api/hoy', authMiddleware, async (req, res) => {
  try {
    const cotizaciones = await cotStore.listar();
    const prospectosVisibles = await prospectosVisiblesPara(req.user);
    const cotizacionesVisibles = req.user.role === 'admin'
      ? cotizaciones
      : cotizaciones.filter(c => c.vendedor === req.user.name);
    res.json(calcularColaHoy(prospectosVisibles, cotizacionesVisibles, new Date()));
  } catch (err) {
    res.status(500).json({ error: 'No se pudo armar la cola de hoy: ' + err.message });
  }
});

const PASOS_VALIDOS = new Set(['dia2', 'dia7', 'dia21', 'vencida']);

app.post('/api/seguimiento/:id', authMiddleware, async (req, res) => {
  const { paso } = req.body;
  if (!PASOS_VALIDOS.has(paso)) return res.status(400).json({ error: 'Paso invalido' });
  const entry = await cotStore.obtener(parseInt(req.params.id));
  if (!entry) return res.status(404).json({ error: 'No encontrada' });
  if (req.user.role !== 'admin' && entry.vendedor !== req.user.name) {
    return res.status(403).json({ error: 'Sin acceso' });
  }
  const seguimientos = await cotStore.registrarSeguimiento(entry.id, {
    paso, fecha: new Date().toISOString(), vendedor: req.user.name,
  });
  res.json({ ok: true, seguimientos });
});

const ESTADOS_VALIDOS = new Set(['abierta', 'ganada', 'perdida', 'descartada']);

app.patch('/api/cotizacion/:id/estado', authMiddleware, async (req, res) => {
  const { estado } = req.body;
  if (!ESTADOS_VALIDOS.has(estado)) return res.status(400).json({ error: 'Estado invalido' });
  const entry = await cotStore.obtener(parseInt(req.params.id));
  if (!entry) return res.status(404).json({ error: 'No encontrada' });
  if (req.user.role !== 'admin' && entry.vendedor !== req.user.name) {
    return res.status(403).json({ error: 'Sin acceso' });
  }
  await cotStore.setEstado(entry.id, estado);
  res.json({ ok: true, estado });
});

// Cotizacion accesible por el usuario autenticado (dueno o admin), mismo guardrail
// que /api/seguimiento/:id. Responde 404/403 y devuelve undefined si no procede.
async function cotizacionOperable(req, res) {
  const entry = await cotStore.obtener(parseInt(req.params.id));
  if (!entry) { res.status(404).json({ error: 'No encontrada' }); return undefined; }
  if (req.user.role !== 'admin' && entry.vendedor !== req.user.name) {
    res.status(403).json({ error: 'Sin acceso' }); return undefined;
  }
  return entry;
}

// Reunion de diagnostico sobre una COTIZACION en Seguimiento (issue #65, CONTEXT.md
// "Reunion de diagnostico"): simetrica a la del prospecto. La reunion vive en el
// array seguimientos como entrada { tipo:'reunion', fecha_reunion, fecha }: una
// entrada sin `paso` no interfiere con la cadencia. Mientras es futura suprime la
// cadencia; al vencer reaparece en Hoy pidiendo el resultado (lib/seguimiento.js).
app.post('/api/cotizacion/:id/reunion', authMiddleware, async (req, res) => {
  const entry = await cotizacionOperable(req, res);
  if (!entry) return;
  const { fecha } = req.body || {};
  const f = fecha ? new Date(fecha) : null;
  if (!f || isNaN(f)) return res.status(400).json({ error: 'La fecha de la reunión es obligatoria' });
  if (f <= new Date()) return res.status(400).json({ error: 'La fecha de la reunión debe ser futura' });
  await cotStore.registrarSeguimiento(entry.id, {
    tipo: 'reunion', fecha_reunion: f.toISOString(),
    fecha: new Date().toISOString(), vendedor: req.user.name,
  });
  res.json({ ok: true });
});

// Resultado de la reunion pasada sobre una cotizacion (issue #65, Modelo A #59):
// el avance pertinente registra un evento posterior a la reunion (que limpia el
// pendiente, lib/seguimiento.js), o se cierra la cotizacion como Perdida. NO hay
// salida a No util para una cotizacion (Modelo A: una cotizacion sale del embudo
// solo por Perdida; No util es para descalificar prospectos sin cotizar).
app.post('/api/cotizacion/:id/reunion-resultado', authMiddleware, async (req, res) => {
  const { resultado } = req.body || {};
  const entry = await cotizacionOperable(req, res);
  if (!entry) return;
  if (!reunionPendienteResultadoDe(entry.seguimientos || [], new Date())) {
    return res.status(400).json({ error: 'No hay reunión pendiente de resultado' });
  }
  if (resultado === 'avance') {
    await cotStore.registrarSeguimiento(entry.id, {
      tipo: 'reunion_resultado', fecha: new Date().toISOString(), vendedor: req.user.name,
    });
    return res.json({ ok: true });
  }
  if (resultado === 'perdida') {
    await cotStore.setEstado(entry.id, 'perdida');
    return res.json({ ok: true, estado: 'perdida' });
  }
  res.status(400).json({ error: 'Resultado inválido: avance o perdida' });
});

// --- Producto decorado / calca (issue #61, CONTEXT.md "Producto decorado (calca)",
// ADR-0005) ---
// El flag decorado y el checklist de los 6 pasos viven en el data JSONB de la
// cotizacion (data.decorado / data.calcaChecklist). El dominio puro
// (decorados-logica.js) decide; estas rutas solo aplican: misma division que el
// hook de cotizacion (#55) y la asignacion (#57).

const CLAVES_PASO_CALCA = new Set(PASOS_DECORADO.map(p => p.clave));

// Marca/desmarca una cotizacion como decorada. Marcarla activa el checklist
// inicial (0/6); desmarcarla baja el flag (el checklist queda persistido por si
// se vuelve a marcar, pero el gate ya no aplica).
app.patch('/api/cotizacion/:id/decorado', authMiddleware, async (req, res) => {
  const entry = await cotizacionOperable(req, res);
  if (!entry) return;
  const decorado = req.body && req.body.decorado === true;
  const merge = decorado
    ? { decorado: true, calcaChecklist: (entry.data && entry.data.calcaChecklist) || checklistInicial() }
    : { decorado: false };
  await cotStore.actualizarDatos(entry.id, merge);
  res.json({ ok: true, decorado, progreso: progresoDecorado(merge.calcaChecklist) });
});

// Marca o revierte un paso del checklist de calca. El paso de archivos
// (archivos_dropbox) sube la posicion de calca a Dropbox FIRE-AND-FORGET: un
// fallo de Dropbox (o su ausencia en local) no bloquea la respuesta ni impide
// marcar el paso (mismo patron que subirCsfDropbox).
app.patch('/api/cotizacion/:id/calca-paso', authMiddleware, async (req, res) => {
  const { paso, completo } = req.body || {};
  if (!CLAVES_PASO_CALCA.has(paso)) return res.status(400).json({ error: 'Paso de calca invalido' });
  const entry = await cotizacionOperable(req, res);
  if (!entry) return;
  const actual = (entry.data && entry.data.calcaChecklist) || checklistInicial();
  const nuevo = completo === false ? revertirPaso(actual, paso) : marcarPaso(actual, paso);
  await cotStore.actualizarDatos(entry.id, { calcaChecklist: nuevo });
  if (paso === 'archivos_dropbox' && completo !== false && Array.isArray(req.body.archivos)) {
    subirCalcaDropbox(entry, req.body.archivos);
  }
  res.json({ ok: true, progreso: progresoDecorado(nuevo) });
});

function subirCalcaDropbox(entry, archivos) {
  // Ruta y nombre confirmados por Adrian (#61): la posicion de calca vive en
  // 1.0 Comercializacion/DISENO/CALCAS/OT Decorado y el archivo se nombra
  // "<Nombre del proyecto> - Pedido <id>". El "Nombre del proyecto" es la
  // referencia de la cotizacion (data.cliente.referencia); si falta, cae al
  // cliente y luego al id. La extension original se conserva.
  const CALCA_PATH = '/1.0 Comercialización/DISEÑO/CALCAS/OT Decorado';
  const proyecto = String(entry.data?.cliente?.referencia || entry.cliente || `Pedido ${entry.id}`)
    .replace(/[/\\:*?"<>|]/g, '').trim() || `Pedido ${entry.id}`;
  import('./lib/dropbox.js').then(({ upload }) => {
    for (const a of archivos) {
      if (!a || !a.nombre || !a.contenidoBase64) continue;
      const ext = (String(a.nombre).match(/\.[a-zA-Z0-9]+$/) || [''])[0];
      const path = `${CALCA_PATH}/${proyecto} - Pedido ${entry.id}${ext}`;
      upload(path, Buffer.from(a.contenidoBase64, 'base64'), 'add')
        .catch(err => console.error('[dropbox][calca]', err.message));
    }
  }).catch(err => console.error('[dropbox][calca]', err.message));
}

// Gate a Pedido liberado (issue #61, AC3). Punto de enforcement MINIMO: una
// cotizacion decorada con el checklist incompleto NO avanza (409); no decorada o
// checklist completo procede (marca data.pedidoLiberado). El gate vive en el
// dominio puro (puedeLiberar); esta ruta solo lo aplica.
//
// IMPORTANTE: #62 (sync post-venta con Operam, AUN NO EXISTE) dirigira el disparo
// REAL de Pedido liberado leyendo Operam y DEBE pasar por este mismo gate
// (puedeLiberar) antes de mover una oportunidad decorada a pedido_liberado. NO se
// modela aqui el mapeo completo estado->etapa post-venta: eso es #62.
app.post('/api/cotizacion/:id/liberar', authMiddleware, async (req, res) => {
  const entry = await cotizacionOperable(req, res);
  if (!entry) return;
  if (!puedeLiberar(entry)) {
    return res.status(409).json({
      error: 'No se puede liberar: el checklist de calca esta incompleto',
      progreso: progresoDecorado(entry.data && entry.data.calcaChecklist),
    });
  }
  await cotStore.actualizarDatos(entry.id, { pedidoLiberado: true });
  res.json({ ok: true, pedidoLiberado: true });
});

// --- Prospectos (issue #41, ADR-0004) ---

// 409 de colision de captura: el duplicado propio (o visto por admin) muestra el
// prospecto; el de otro vendedor solo dice quien lo atiende, sin mas datos
// (CONTEXT.md, Visibilidad de prospectos). Lleva un campo estructurado `tipo`
// (#82): el frontend decide por el (prospecto_propio -> usar el existente;
// prospecto_ajeno -> bloquear; cliente -> cotizar sobre el cliente), nunca
// parseando el string de error.
function respuestaProspectoExistente(res, existente, user) {
  const visible = user.role === 'admin' || existente.vendedor === user.name;
  return res.status(409).json(
    visible
      ? { error: 'Este celular ya es un prospecto', tipo: 'prospecto_propio', prospecto: existente }
      : { error: `Este celular ya lo atiende ${existente.vendedor}`, tipo: 'prospecto_ajeno' }
  );
}

function respuestaCelularDeCliente(res, cliente) {
  return res.status(409).json({
    error: `Este celular es del cliente ${cliente.cust_name} - cotizale como cliente, no se crea prospecto`,
    tipo: 'cliente',
    cust_name: cliente.cust_name,
  });
}

// Evento activo y liga del catalogo (issue #261, CONTEXT.md "Evento"): se
// configuran UNA vez desde el panel admin y viven en el store de configuracion
// (#276), la misma lectura/escritura que ya usa la configuracion del catalogo.
// Un evento sin nombre no es evento: el resto del sistema pregunta solo "hay
// evento activo".
// La fecha de fin NO apaga el evento sola -- es un dato del evento (de ahi sale
// el primer dia habil despues de la feria); apagarlo es del admin, para que la
// app nunca deje de ofrecer la captura a media feria por un reloj.
function eventoActivoConfigurado() {
  const evento = (configStore.leer() || {}).eventoActivo;
  return evento && evento.nombre ? evento : null;
}

// Calificacion de la captura de expo (issue #263): ella y el siguiente
// contacto viajan en el MISMO body que la captura y que la edicion -- con el
// prospecto enfrente no hay dos guardados. Las dos rutas comparten validacion y
// registro para que la regla no se bifurque; el compromiso es el mismo evento
// que registra su propia ruta (#262).
function errorCalificacionYSiguienteContacto(body) {
  const cal = validarCalificacion(body.calificacion);
  if (cal) return cal;
  if (body.siguiente_contacto == null) return null;
  return validarSiguienteContacto(body.siguiente_contacto);
}

async function registrarSiguienteContactoDelBody(id, body, vendedor) {
  if (body.siguiente_contacto == null) return;
  await prospectosStore.registrarEvento(id, buildEventoSiguienteContacto(body.siguiente_contacto, vendedor));
}

// Captura de expo (issue #261, spec #260) = esta MISMA ruta con mas campos, no
// una ruta nueva: es la misma entidad, el mismo pipeline y los mismos guardrails
// de celular. Lo que agrega el evento: tipo de cliente obligatorio y la
// posibilidad de capturar a nombre de OTRO asesor (los formatos en papel de
// quien no usa la app se transcriben esa noche), excepcion a la auto-asignacion
// que solo existe mientras hay evento activo.
app.post('/api/prospectos', authMiddleware, async (req, res) => {
  const body = req.body || {};
  const evento = eventoActivoConfigurado();
  const eventoBody = String(body.evento == null ? '' : body.evento).trim();
  // El evento no lo elige el que captura: es el activo o no es. Sin este candado
  // cualquier captura podria etiquetarse con un evento inventado y el filtro del
  // pipeline dejaria de significar algo.
  if (eventoBody && (!evento || eventoBody !== evento.nombre)) {
    return res.status(400).json({ error: 'El evento no coincide con el evento activo' });
  }
  const error = eventoBody ? validarProspectoExpoBody(body) : validarProspectoBody(body);
  if (error) return res.status(400).json({ error });
  const errorCalificacionCaptura = errorCalificacionYSiguienteContacto(body);
  if (errorCalificacionCaptura) return res.status(400).json({ error: errorCalificacionCaptura });
  // El asesor se valida contra el registro COMPLETO de vendedores, no contra el
  // catalogo filtrado por operam_id de /api/catalogos: quien solo transcribe
  // formatos de papel puede no tener id de Operam todavia.
  const asesor = String(body.asesor == null ? '' : body.asesor).trim();
  const capturaAjena = !!asesor && asesor !== req.user.name;
  if (capturaAjena) {
    // La excepcion a la auto-asignacion es de la CAPTURA DE EXPO (CONTEXT.md
    // "Captura de expo"), no de cualquier captura hecha mientras hay feria: sin
    // evento en el cuerpo el prospecto nace del que captura, como siempre. Asi
    // ademas ningun prospecto de otro dueno se queda sin el rastro de quien lo
    // capturo.
    if (!eventoBody) {
      return res.status(400).json({ error: 'Solo en la captura de expo se captura a nombre de otro asesor' });
    }
    const registro = await vendedoresStore.listar();
    if (!registro.some(v => v.name === asesor)) {
      return res.status(400).json({ error: 'El asesor debe ser un vendedor del registro' });
    }
  }
  // Guardrail best effort (CONTEXT.md, Prospecto): un cliente con alta en Operam
  // nunca vuelve a ser prospecto. Si el indice falla o no esta listo, la
  // clasificacion cae a libre y la captura procede.
  const clasificacion = await clasificarCelular(body.celular);
  if (clasificacion.tipo === 'prospecto') {
    return respuestaProspectoExistente(res, clasificacion.prospecto, req.user);
  }
  if (clasificacion.tipo === 'cliente') {
    return respuestaCelularDeCliente(res, clasificacion.cliente);
  }
  const data = {};
  for (const k of PROSPECTO_OPCIONALES) {
    if (body[k] !== undefined && body[k] !== null && body[k] !== '') data[k] = body[k];
  }
  // Lo de la expo manda sobre los opcionales crudos: el segmento sale del tipo
  // de cliente y la temperatura del nivel de interes, en un solo lugar.
  Object.assign(data, buildDatosExpo(body));
  // El codigo postal del que la pantalla de expo deriva la ciudad (#268) se
  // guarda en el MISMO data.cp de la captura publica (buildCapturaMayoreo), no
  // en una llave propia: es el dato que la cotizacion de envio ya no vuelve a
  // pedir. La regla del servidor no cambia -- la ciudad sigue siendo lo
  // obligatorio, venga del indice de CP o tecleada a mano.
  const cp = String(body.cp == null ? '' : body.cp).trim();
  if (cp) data.cp = cp;
  // La calificacion (#263) es opcional: si se guardo vacia no se escribe la
  // llave. Las piezas estimadas NO viven aqui -- son el opcional de
  // siempre, que ya viajo arriba.
  const calificacion = buildCalificacion(body.calificacion);
  if (Object.keys(calificacion).length) data.calificacion = calificacion;
  // Mayusculas corregidas y correo en minusculas en UN solo punto (issue #269,
  // CONTEXT.md "Prospecto"): lo mismo que aplica la edicion desde la tarjeta, y
  // por eso una captura de expo y su complemento posterior no pueden divergir.
  const textos = normalizarTextosProspecto({ nombre: body.nombre, ciudad: body.ciudad, data });
  let id;
  try {
    id = await prospectosStore.crear({
      fecha: new Date().toISOString(), vendedor: capturaAjena ? asesor : req.user.name,
      celular: body.celular.trim(), nombre: textos.nombre,
      ciudad: textos.ciudad, canal: body.canal, data: textos.data,
    });
  } catch (e) {
    if (e.code !== '23505') throw e;
    const dup = await prospectosStore.buscarPorCelular(body.celular);
    if (dup) return respuestaProspectoExistente(res, dup, req.user);
    return res.status(409).json({ error: 'Este celular ya es un prospecto' });
  }
  // Rastro de la captura de expo: el prospecto es del asesor, pero el historial
  // dice en que evento y QUIEN lo capturo (no siempre son la misma persona).
  if (eventoBody) {
    await prospectosStore.registrarEvento(id, {
      tipo: 'captura_expo', fecha: new Date().toISOString(),
      evento: eventoBody, vendedor: req.user.name,
    });
  }
  await registrarSiguienteContactoDelBody(id, body, req.user.name);
  res.status(201).json({ ok: true, id });
});

// Alta de prospecto SIN vendedor (issue #57, CONTEXT.md "Etapas del pipeline":
// No Asignado). La tarjeta nace en no_asignado y sin dueno; la asigna luego el
// admin (PATCH .../asignar) y entonces pasa a Por Cotizar. La consumira el
// formulario web "Peltre de Mayoreo" (y a futuro un bot), pero exponer esa
// escritura publica y su auth (token/API key) es una decision de seguridad
// posterior y fuera de alcance: aqui la ruta es admin-only (solo quien asigna ve
// No Asignado, CONTEXT.md "Visibilidad"). Reusa los mismos guardrails de
// /api/prospectos via clasificarCelular: un celular que ya es prospecto o cliente
// Operam no se duplica.
app.post('/api/prospectos/sin-asignar', authMiddleware, adminMiddleware, async (req, res) => {
  const body = req.body || {};
  const error = validarProspectoBody(body);
  if (error) return res.status(400).json({ error });
  const clasificacion = await clasificarCelular(body.celular);
  if (clasificacion.tipo === 'prospecto') {
    return respuestaProspectoExistente(res, clasificacion.prospecto, req.user);
  }
  if (clasificacion.tipo === 'cliente') {
    return respuestaCelularDeCliente(res, clasificacion.cliente);
  }
  const data = {};
  for (const k of PROSPECTO_OPCIONALES) {
    if (body[k] !== undefined && body[k] !== null && body[k] !== '') data[k] = body[k];
  }
  // La misma normalizacion que la captura autenticada (issue #269): la regla es
  // del PROSPECTO, no de la pantalla que lo captura (CONTEXT.md "Prospecto").
  const textos = normalizarTextosProspecto({ nombre: body.nombre, ciudad: body.ciudad, data });
  let id;
  try {
    id = await prospectosStore.crear({
      fecha: new Date().toISOString(), vendedor: null,
      celular: body.celular.trim(), nombre: textos.nombre,
      ciudad: textos.ciudad, canal: body.canal, etapa: 'no_asignado', data: textos.data,
    });
  } catch (e) {
    if (e.code !== '23505') throw e;
    const dup = await prospectosStore.buscarPorCelular(body.celular);
    if (dup) return respuestaProspectoExistente(res, dup, req.user);
    return res.status(409).json({ error: 'Este celular ya es un prospecto' });
  }
  res.status(201).json({ ok: true, id });
});

// Indice CP -> ciudad/estado (issue #160, ADR-0012 pto. 3): generado por
// scripts/sync-codigos-postales.mjs desde GeoNames (CC BY 4.0) y commiteado al
// repo (data/cp-mx.json / cp-us.json / cp-ca.json) -- el disco de Render es
// efimero y el arranque no debe depender de que geonames.org este arriba. Se
// carga UNA VEZ en el unico proceso; si un archivo faltara, ese pais simplemente
// no resuelve (404) en vez de tumbar el arranque del resto del cotizador.
function cargarIndiceCP() {
  const archivos = { MX: 'cp-mx.json', US: 'cp-us.json', CA: 'cp-ca.json' };
  const indice = {};
  for (const [pais, archivo] of Object.entries(archivos)) {
    const ruta = join(DATA_DIR, archivo);
    indice[pais] = existsSync(ruta) ? JSON.parse(leerArchivoSync(ruta)) : {};
  }
  return indice;
}
const indiceCP = cargarIndiceCP();

// GET publico de CP (issue #160, ADR-0012 pto. 3): autocompletado del
// formulario de mayoreo, no dato sensible -- el indice mismo es publico
// (GeoNames CC BY 4.0). Valida el FORMATO con el mismo validador que el resto
// de la app (lib/validar-cp.js) antes de buscar: un CP mal formado nunca llega
// al indice. El pais viaja en la URL en mayusculas (MX/US/CA, el mismo
// catalogo cerrado que paisDesdeCodigoTelefono en alta-logica.js); cualquier
// otro valor se rechaza igual que un formato invalido.
app.get('/api/cp/:pais/:cp', (req, res) => {
  const pais = String(req.params.pais || '').toUpperCase();
  if (!indiceCP[pais]) return res.status(400).json({ error: 'Pais no soportado' });
  if (!validarCP(req.params.cp, pais)) return res.status(400).json({ error: 'CP invalido' });
  const resultado = buscarCP(indiceCP, pais, req.params.cp);
  if (!resultado) return res.status(404).json({ error: 'CP no encontrado' });
  res.json(resultado);
});

// Captura publica de mayoreo (issue #157, ADR-0012). Es el UNICO endpoint de
// escritura sin auth del sistema: quien lo llama es un desconocido en internet.
//
// Tres cosas lo separan del alta sin asignar de arriba, y ninguna es la logica de
// dominio (esa se reusa entera: clasificarCelular + validarProspectoBody + el
// mismo store, etapa no_asignado y vendedor null):
//
//  1. La RESPUESTA ES OPACA. Siempre 200 con el mismo cuerpo, sin importar si el
//     celular era nuevo, ya era prospecto o ya era cliente de Operam, y sin
//     importar si el honeypot o el rate limit lo descartaron. Reusar las
//     respuestas informativas del endpoint autenticado ("este celular ya lo
//     atiende X") convertiria el formulario en un oraculo para enumerar la
//     cartera marcando telefonos. La regla de Visibilidad del glosario aplica
//     dentro del equipo; hacia internet no se revela nada. El unico status
//     distinto es el 400 de un cuerpo mal formado, que no habla del CRM y que un
//     navegador con el formulario real nunca provoca.
//  2. Defensas propias, en ORDEN deliberado (issue #162): rate limit -> honeypot
//     -> validacion local del formulario -> Turnstile -> Operam. La leccion de
//     #157 fue que el honeypot cortando ANTES del rate limit dejaba a un bot
//     atrapado con envios ilimitados; la misma logica manda aqui: Turnstile es
//     una llamada de RED a Cloudflare (lib/turnstile.js), la mas cara de la
//     cadena, asi que corre DESPUES de todo lo que se resuelve en memoria/CPU
//     (rate limit, honeypot, validarMayoreo, validarProspectoBody,
//     numeroTelefonoEsPosible) y ANTES de la llamada a Operam
//     (clasificarCelular). Un envio que ya iba a morir por una defensa barata
//     nunca le pega a Cloudflare.
//  3. El dedup es SILENCIOSO: si el celular ya es prospecto se registra el evento
//     en la tarjeta existente (el vendedor se entera de que volvio a levantar la
//     mano) sin duplicarla, sin cambiarle dueno y sin moverla de etapa.
const HONEYPOT = 'fax';

// Alerta por correo de la captura publica (issue #163; CONTEXT.md "Captura
// publica": "Cada captura publica avisa por correo a quienes tienen el permiso
// de asignacion"). FIRE-AND-FORGET, mismo contrato que subirCsfDropbox
// (lib/dropbox.js): la promesa nunca se espera y su fallo nunca llega a la
// respuesta del endpoint ni impide la tarjeta. `_enviarAlertaMayoreo` es
// inyectable SOLO para tests: nodemailer no pasa por fetch (no hay mock de URL
// que lo intercepte), asi que forzar un fallo de SMTP sin credenciales reales
// necesita sustituir el wrapper.
let _enviarAlertaMayoreo = enviarAlertaMayoreo;
export function _inyectarAlertaMayoreo(fn) { _enviarAlertaMayoreo = fn ?? enviarAlertaMayoreo; }

// Dispara la alerta para una captura ya validada -- tanto si el prospecto es
// NUEVO como si ya existia. Decision (issue #163): CONTEXT.md dice "cada
// captura publica avisa", no "cada prospecto nuevo"; el proposito es paridad
// con la notificacion que daba Bitrix para atencion comercial, y quien tiene el
// permiso de asignacion debe enterarse de que alguien volvio a levantar la
// mano, no solo la primera vez. No se dispara cuando el celular ya es CLIENTE
// de Operam: ahi no se toca ninguna tarjeta y el equipo comercial ya conoce el
// contacto.
// `form` es el body crudo del formulario (issue #165): cargo y el texto de
// "Otro" no viven en captura.data (buildCapturaMayoreo los aplasta en notas
// para la tarjeta), asi que la alerta los toma de ahi; el resto sale de
// captura.data ya limpio (trim) por buildCapturaMayoreo.
// El nombre de pila y el apellido (issue #236) viajan por esa MISMA via, y por
// la misma razon: la tarjeta guarda un solo nombre, asi que el corte entre los
// dos campos no sobrevive al aplanado -- y la vCard los necesita separados para
// emitir N: sin adivinar donde parte un nombre completo. Van con
// capitalizarCampo porque el form es crudo: sin eso la ficha diria
// "Laura Mendoza" en FN: y "MENDOZA" en N:, el mismo apellido de dos formas.
// `fechaCaptura` (issue #238) es el MISMO instante con el que se armo la
// captura, no uno nuevo: la nota de la vCard lo imprime como fecha de la foto y
// tiene que coincidir con lo que quedo en la tarjeta (el consentimiento de
// promociones ya se fecha con ese instante). El nucleo puro nunca lo calcula.
function dispararAlertaMayoreo(captura, form, fechaCaptura) {
  const d = captura.data || {};
  const prospecto = {
    fechaCaptura,
    nombre: captura.nombre,
    nombrePila: capitalizarCampo(form.nombre), apellido: capitalizarCampo(form.apellido),
    celular: captura.celular, ciudad: captura.ciudad,
    cp: d.cp, tipoProyecto: form.tipo,
    tipoProyectoOtro: form.tipo === 'Otro' ? form.otro : '',
    cantidadEstimada: d.piezas_estimadas, empresa: d.empresa,
    cargo: form.cargo, correo: d.correo, cuando: d.cuando, web: d.web,
    promos: d.promos,
  };
  _enviarAlertaMayoreo(prospecto).catch(err => console.error('[alerta-mayoreo]', err.message));
}

app.post('/api/prospectos/publico', async (req, res) => {
  const opaca = () => res.status(200).json({ ok: true });
  const form = req.body || {};

  // El tope por IP se cobra ANTES del honeypot, y por eso cuenta tambien los
  // envios que caen en la trampa: si el honeypot cortara primero, un bot
  // atrapado tendria envios ilimitados y la defensa barata se anularia sola.
  if (!permitirCaptura(req.ip)) return opaca();
  // Honeypot: campo oculto que una persona nunca ve ni llena. Se descarta en
  // silencio -- un 400 le ensenaria al bot cual es el campo trampa.
  if (String(form[HONEYPOT] || '').trim()) return opaca();

  if (validarMayoreo(form).length) return res.status(400).json({ error: 'Captura incompleta' });

  const fechaCaptura = new Date().toISOString();
  // QR del stand (issue #264, CONTEXT.md "Evento"): buildCapturaMayoreo compara
  // form.evento contra el evento activo y solo entonces nace con canal
  // Feria/Expo y data.evento; sin coincidencia, o sin evento activo, la captura
  // es la de siempre.
  const captura = buildCapturaMayoreo(form, fechaCaptura, eventoActivoConfigurado());
  // Segundo cinturon: la captura armada tiene que pasar la MISMA validacion que
  // el alta autenticada (#57), no solo la del formulario.
  if (validarProspectoBody(captura)) return res.status(400).json({ error: 'Captura incompleta' });

  // Revalidacion server-side del celular (issue #161): validarMayoreo solo mira
  // el LARGO de digitos (10 para MX/US/CA), asi que un numero como
  // +52 0000000000 pasa el formulario. libphonenumber-js valida el patron real
  // por pais. La respuesta sigue siendo la OPACA de siempre (ADR-0012): decirle
  // a un desconocido en internet "tu numero es imposible" es la misma clase de
  // fuga que las otras ramas de este endpoint evitan.
  if (!numeroTelefonoEsPosible(captura.celular)) return opaca();

  // Turnstile (issue #162): token ausente o invalido muere con la MISMA
  // respuesta opaca que las demas ramas -- decirle a un desconocido en internet
  // "tu verificacion fallo" es la misma clase de fuga que ADR-0012 ya evita en
  // las otras 6 ramas. Sin TURNSTILE_SECRET_KEY (dev/tests) verificarTurnstile
  // deja pasar sin llamar a Cloudflare; con Cloudflare caido tambien deja pasar
  // (fail-open, ver lib/turnstile.js) -- solo un token que Cloudflare evalua y
  // RECHAZA explicitamente descarta la captura.
  if (!(await verificarTurnstile(form.turnstileToken, req.ip))) return opaca();

  const clasificacion = await clasificarCelular(captura.celular);
  if (clasificacion.tipo === 'cliente') return opaca();
  if (clasificacion.tipo === 'prospecto') {
    await registrarCapturaPublica(clasificacion.prospecto.id, captura);
    dispararAlertaMayoreo(captura, form, fechaCaptura);
    return opaca();
  }

  try {
    await prospectosStore.crear({
      fecha: new Date().toISOString(), vendedor: null,
      celular: captura.celular, nombre: captura.nombre, ciudad: captura.ciudad,
      canal: captura.canal, etapa: 'no_asignado', data: captura.data,
    });
    dispararAlertaMayoreo(captura, form, fechaCaptura);
  } catch (e) {
    // Carrera contra otra captura del mismo celular: el indice unico gana y esto
    // se vuelve el caso "ya era prospecto". Hacia afuera, la misma respuesta.
    if (e.code !== '23505') {
      console.error('[mayoreo] captura publica fallo:', e.message);
      return opaca();
    }
    const dup = await prospectosStore.buscarPorCelular(captura.celular);
    if (dup) {
      await registrarCapturaPublica(dup.id, captura);
      dispararAlertaMayoreo(captura, form, fechaCaptura);
    }
  }
  return opaca();
});

// Evento en la tarjeta que ya existia: el prospecto volvio a levantar la mano por
// el formulario. Lleva lo que pidio esta vez (notas y piezas) para que el
// vendedor vea el cambio de intencion sin abrir nada mas.
function registrarCapturaPublica(id, captura) {
  return prospectosStore.registrarEvento(id, {
    tipo: 'captura_publica', fecha: new Date().toISOString(), canal: captura.canal,
    notas: captura.data.notas, piezas_estimadas: captura.data.piezas_estimadas,
  }).catch(err => console.error('[mayoreo] no se pudo registrar el evento:', err.message));
}

// Visibilidad (CONTEXT.md): cada vendedor ve unicamente sus propias
// oportunidades; el admin ve todas. Las tarjetas No Asignado no son de nadie: las
// ve ademas quien tiene el permiso de asignacion (#156), y SOLO esas -- el
// permiso abre la columna sin dueno, nunca la cartera de otro vendedor.
async function prospectosVisiblesPara(user) {
  const todos = await prospectosStore.listar();
  if (user.role === 'admin') return todos;
  const asigna = await puedeAsignarDeUsuario(user);
  return todos.filter(p => p.vendedor === user.name || (asigna && p.etapa === 'no_asignado'));
}

app.get('/api/prospectos', authMiddleware, async (req, res) => {
  try {
    res.json(await prospectosVisiblesPara(req.user));
  } catch (err) {
    res.status(500).json({ error: 'No se pudo listar prospectos: ' + err.message });
  }
});

// Cola de seguimiento (issue #44). Registrada antes de cualquier ruta
// /api/prospectos/:id para que "cola" nunca se interprete como un id.
app.get('/api/prospectos/cola', authMiddleware, async (req, res) => {
  const todos = await prospectosStore.listar();
  const visibles = req.user.role === 'admin'
    ? todos
    : todos.filter(p => p.vendedor === req.user.name);
  res.json(calcularColaProspectos(visibles, new Date()));
});

// Pre-clasificacion de celular (issue #46): el frontend la consulta antes de
// generar la cotizacion para decidir si pide el canal de origen (solo cuando
// el celular es libre). Devuelve el tipo y datos minimos no sensibles; el
// detalle del prospecto nunca viaja aqui (visibilidad, CONTEXT.md). Registrada
// antes de cualquier ruta /api/prospectos/:id.
app.get('/api/prospectos/clasificar', authMiddleware, async (req, res) => {
  const celular = req.query.celular;
  if (!celular) return res.status(400).json({ error: 'El celular es obligatorio' });
  const clasificacion = await clasificarCelular(celular);
  if (clasificacion.tipo === 'cliente') {
    return res.json({ tipo: 'cliente', cust_name: clasificacion.cliente.cust_name });
  }
  if (clasificacion.tipo === 'prospecto') {
    const { nombre, vendedor } = clasificacion.prospecto;
    return res.json({ tipo: 'prospecto', prospecto: { nombre, vendedor } });
  }
  res.json({ tipo: clasificacion.tipo });
});

// Trabajar el prospecto (issue #43): etapas manuales, toques y salida a No util.
// Misma visibilidad que el PATCH de estado de cotizaciones: el vendedor solo
// opera sus prospectos, admin todos.

// `incluyeSinDueno` extiende el acceso a las tarjetas No Asignado para quien
// tiene el permiso de asignacion (#156, decision del dueno 2026-08-16, CONTEXT.md
// "Visibilidad"): sin el, una tarjeta sin dueno no es de nadie y solo el admin
// podria sacarla del tablero. El ALCANCE lo acota el dominio, no un check aparte:
// desde no_asignado validarTransicion solo admite no_util y perdida, asi que
// abrir la ruta de etapa es abrir exactamente "descartar". Por eso el resto de
// las rutas (editar, toques, reunion) NO pasan la opcion: trabajar la tarjeta
// sigue exigiendo dueno o admin. Nunca alcanza la cartera de otro vendedor: la
// excepcion pide etapa no_asignado, que por definicion no tiene dueno.
async function prospectoOperable(req, res, { incluyeSinDueno = false } = {}) {
  const p = await prospectosStore.obtener(parseInt(req.params.id));
  if (!p) {
    res.status(404).json({ error: 'No encontrado' });
    return null;
  }
  if (req.user.role === 'admin' || p.vendedor === req.user.name) return p;
  if (incluyeSinDueno && p.etapa === 'no_asignado' && await puedeAsignarDeUsuario(req.user)) return p;
  res.status(403).json({ error: 'Sin acceso' });
  return null;
}

// Editar/complementar el prospecto desde su tarjeta (issue #66, CONTEXT.md
// "Captura de prospecto"): enriquece nombre, ciudad y los opcionales conforme
// avanza la conversacion. Permitido en cualquier etapa activa; no en una salida
// (No util/Perdida viven en historial). Misma visibilidad que las demas
// operaciones del prospecto. No mueve la etapa ni registra evento: la edicion
// enriquece, no avanza el embudo.
app.patch('/api/prospectos/:id', authMiddleware, async (req, res) => {
  const p = await prospectoOperable(req, res);
  if (!p) return;
  if (esSalida(p.etapa)) {
    return res.status(400).json({ error: 'No se edita un prospecto que ya salió del pipeline (No útil/Perdida)' });
  }
  const error = validarEdicionProspecto(req.body);
  if (error) return res.status(400).json({ error });
  // La edicion es el camino para completar despues la calificacion (#263): lo
  // que el stand no alcanzo a preguntar y lo que el importador no trae.
  const errorCalificacion = errorCalificacionYSiguienteContacto(req.body || {});
  if (errorCalificacion) return res.status(400).json({ error: errorCalificacion });
  await prospectosStore.actualizarDatos(p.id, normalizarTextosProspecto(buildEdicionProspectoDatos(req.body)));
  await registrarSiguienteContactoDelBody(p.id, req.body || {}, req.user.name);
  res.json({ ok: true });
});

// Asignar un vendedor a una tarjeta en No Asignado (issue #57, CONTEXT.md
// "Etapas del pipeline" + "Visibilidad"): exige el permiso de asignacion, que el
// admin tiene siempre y un vendedor puede tener por checkbox en /admin (#156 --
// ya no es admin-only). Quien asigna puede asignar a CUALQUIER vendedor del
// catalogo, no solo a si mismo. La transicion de etapa la decide la regla de
// dominio (transicionPorAsignacion) -- desde no_asignado -> por_cotizar; la capa
// de IO (asignarVendedor) la aplica. El vendedor elegido debe estar en el catalogo
// (registro de vendedores, la misma fuente que pobla el selector en /api/catalogos).
app.patch('/api/prospectos/:id/asignar', authMiddleware, asignacionMiddleware, async (req, res) => {
  try {
    const { vendedor } = req.body || {};
    const catalogo = (await vendedoresStore.listar()).filter(v => v.operam_id != null);
    if (!vendedor || !catalogo.some(v => v.name === vendedor)) {
      return res.status(400).json({ error: 'El vendedor a asignar debe ser uno del catálogo' });
    }
    const p = await prospectosStore.obtener(parseInt(req.params.id));
    if (!p) return res.status(404).json({ error: 'No encontrado' });
    const destino = transicionPorAsignacion(p.etapa);
    if (!destino) {
      return res.status(400).json({ error: 'Solo se asigna vendedor a una tarjeta en No Asignado' });
    }
    await prospectosStore.asignarVendedor(p.id, vendedor, destino, {
      tipo: 'asignacion', de: p.etapa, a: vendedor,
      fecha: new Date().toISOString(), vendedor: req.user.name,
    });
    res.json({ ok: true, etapa: destino });
  } catch (err) {
    res.status(500).json({ error: 'No se pudo asignar: ' + err.message });
  }
});

app.patch('/api/prospectos/:id/etapa', authMiddleware, async (req, res) => {
  const { etapa, motivo, folio } = req.body || {};
  // Unica ruta que acepta tarjetas sin dueno para quien tiene el permiso de
  // asignacion: desde no_asignado el dominio solo deja descartar (#156).
  const p = await prospectoOperable(req, res, { incluyeSinDueno: true });
  if (!p) return;
  const error = validarTransicion(p.etapa, etapa, motivo, folio);
  if (error) return res.status(400).json({ error });
  const fecha = new Date().toISOString();
  // Mover a Seguimiento a mano (issue #56): el vendedor cotizo por fuera, asi
  // que el folio de Operam se guarda en el prospecto (data.folioOperam). La
  // regla de dominio (validarTransicion) ya valido que hay folio y que el origen
  // es Por Cotizar; aqui se persiste etapa + folio + evento juntos.
  if (etapa === 'seguimiento') {
    const folioLimpio = String(folio).trim();
    await prospectosStore.moverASeguimientoConFolio(p.id, folioLimpio, {
      tipo: 'etapa', de: p.etapa, a: 'seguimiento', folio: folioLimpio, fecha, vendedor: req.user.name,
    });
    return res.json({ ok: true, etapa, folio: folioLimpio });
  }
  const evento = etapa === 'no_util'
    ? { tipo: 'no_util', motivo, fecha, vendedor: req.user.name }
    : { tipo: 'etapa', de: p.etapa, a: etapa, fecha, vendedor: req.user.name };
  await prospectosStore.cambiarEtapa(p.id, etapa, evento);
  res.json({ ok: true, etapa });
});

app.post('/api/prospectos/:id/toques', authMiddleware, async (req, res) => {
  const p = await prospectoOperable(req, res);
  if (!p) return;
  const eventos = await prospectosStore.registrarEvento(p.id, {
    tipo: 'toque', fecha: new Date().toISOString(), vendedor: req.user.name,
  });
  res.json({ ok: true, eventos });
});

// Reunion diagnostico (issue #45, CONTEXT.md "Captura de prospecto"): actividad
// con fecha, NO una etapa. Agendar registra el evento; re-agendar agrega otro
// (la ultima manda). La supresion de cadencia vive en el motor de la cola.
app.post('/api/prospectos/:id/reunion', authMiddleware, async (req, res) => {
  const p = await prospectoOperable(req, res);
  if (!p) return;
  const { fecha } = req.body || {};
  const f = fecha ? new Date(fecha) : null;
  if (!f || isNaN(f)) return res.status(400).json({ error: 'La fecha de la reunión es obligatoria' });
  if (f <= new Date()) return res.status(400).json({ error: 'La fecha de la reunión debe ser futura' });
  await prospectosStore.registrarEvento(p.id, {
    tipo: 'reunion', fecha_reunion: f.toISOString(),
    fecha: new Date().toISOString(), vendedor: req.user.name,
  });
  res.json({ ok: true });
});

// Siguiente contacto (issue #262, #270, spec #260, CONTEXT.md "Siguiente
// contacto"): compromiso de canales + fecha con el prospecto ("te escribo el
// lunes por WhatsApp y te mando el catalogo por correo" es UNO solo, con dos
// canales). Mismo mecanismo de evento que la reunion y las mismas garantias
// (dueno o admin), con dos diferencias: los canales son de catalogo cerrado
// propio (CANALES_SIGUIENTE_CONTACTO, distinto del canal de ORIGEN) y no hay
// resultado que registrar -- lo cierra un toque posterior a la fecha. El ultimo
// registrado manda.
app.post('/api/prospectos/:id/siguiente-contacto', authMiddleware, async (req, res) => {
  const p = await prospectoOperable(req, res);
  if (!p) return;
  const error = validarSiguienteContacto(req.body);
  if (error) return res.status(400).json({ error });
  await prospectosStore.registrarEvento(p.id, buildEventoSiguienteContacto(req.body, req.user.name));
  res.json({ ok: true });
});

// Resultado de la reunion pasada: en el pipeline unificado el avance pertinente
// lo dirige la cotizacion (Por Cotizar -> Seguimiento, otro issue); aqui el
// unico resultado que cierra el ciclo de la reunion es la salida a No util con
// motivo del catalogo (CONTEXT.md "Reunion de diagnostico": ya no avanza a
// Calificado, etapa eliminada por ADR-0005).
app.post('/api/prospectos/:id/reunion-resultado', authMiddleware, async (req, res) => {
  const { resultado, motivo } = req.body || {};
  const p = await prospectoOperable(req, res);
  if (!p) return;
  if (!reunionPendienteResultado(p, new Date())) {
    return res.status(400).json({ error: 'No hay reunión pendiente de resultado' });
  }
  if (resultado === 'no_util') {
    if (!MOTIVOS_NO_UTIL.includes(motivo)) {
      return res.status(400).json({ error: 'El motivo de No útil es obligatorio (catálogo cerrado)' });
    }
    await prospectosStore.cambiarEtapa(p.id, 'no_util', {
      tipo: 'no_util', motivo, fecha: new Date().toISOString(), vendedor: req.user.name,
    });
    return res.json({ ok: true, etapa: 'no_util' });
  }
  res.status(400).json({ error: 'Resultado inválido: no_util' });
});

app.get('/api/admin/prospectos/no-util', authMiddleware, adminMiddleware, async (req, res) => {
  const todos = await prospectosStore.listar();
  res.json(contarMotivosNoUtil(todos));
});

// Enriquecimiento con el export del evento (issue #265, CONTEXT.md "Importacion
// del export del evento"): lo capturado en el stand NUNCA se pisa, solo se
// rellena lo que este vacio. El tipo de cliente y su segmento viajan JUNTOS
// (poner uno sin el otro dejaria el segmento contradiciendo al texto) y la nota
// del export se AGREGA debajo de las notas que ya habia.
function campoVacio(v) {
  return v === undefined || v === null || String(v).trim() === '';
}

function datosParaEnriquecer(actual, entrantes) {
  const merge = {};
  const juntos = ['tipo_cliente', 'tipo_cliente_otro', 'segmento_id'];
  for (const [k, v] of Object.entries(entrantes)) {
    if (k === 'notas' || juntos.includes(k)) continue;
    if (campoVacio(actual[k]) && !campoVacio(v)) merge[k] = v;
  }
  if (!campoVacio(entrantes.tipo_cliente) && campoVacio(actual.tipo_cliente)) {
    for (const k of juntos) if (entrantes[k] !== undefined) merge[k] = entrantes[k];
  }
  if (!campoVacio(entrantes.notas)) {
    // Re-importar un archivo que trae filas ya importadas no debe repetir la
    // nota que el prospecto ya tiene (issue #277).
    if (campoVacio(actual.notas)) merge.notas = entrantes.notas;
    else if (!actual.notas.includes(entrantes.notas)) merge.notas = `${actual.notas}
${entrantes.notas}`;
  }
  return merge;
}

async function enriquecerConExport(existente, fila, evento, fecha) {
  const campos = { data: datosParaEnriquecer(existente.data || {}, fila.data) };
  if (campoVacio(existente.ciudad) && !campoVacio(fila.ciudad)) campos.ciudad = fila.ciudad;
  await prospectosStore.actualizarDatos(existente.id, campos);
  await prospectosStore.registrarEvento(existente.id, {
    tipo: 'importado', fecha, evento, vendedor: existente.vendedor,
  });
}

// Importacion del export del evento (issue #265, antes #47): la plataforma de
// Abastur entrega un XLSX con la hoja "Contacts" y aqui se cruza fila por fila.
// Un celular libre nace como prospecto del que escaneo el gafete; uno que ya es
// prospecto se ENRIQUECE; uno que ya es cliente de Operam se descarta; un gafete
// sin celular se cruza por correo contra los prospectos del mismo evento y, si
// no cruza, sale en el reporte en vez de nacer (invariante 1 celular = 1
// prospecto). La fecha del prospecto es el momento de la importacion (la del
// escaneo queda en data.escaneado): con la fecha original toda la cola naceria
// en rojo con horas habiles vencidas. El indice de clientes Operam se refresca
// UNA VEZ antes del loop (leccion de #46, no por fila); si falla, las filas se
// importan igual (best effort, mismo trade-off que la captura manual).
app.post('/api/admin/prospectos/importar', authMiddleware, adminMiddleware, upload.single('archivo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibio archivo' });
  const vendedores = await vendedoresStore.listar();
  const vendedorDefault = req.body?.vendedor || req.user.name;
  const eventoActivo = eventoActivoConfigurado();
  const evento = eventoActivo ? eventoActivo.nombre : undefined;
  let parseo;
  try {
    parseo = importarProspectosFeria(req.file.buffer, { vendedores, vendedorDefault, evento });
  } catch (err) {
    return res.status(400).json({ error: 'Error procesando archivo: ' + err.message });
  }
  const descartados = [...parseo.descartados];
  let indiceListo = false;
  try {
    await refrescarIndice();
    indiceListo = true;
  } catch (err) {
    console.warn('[prospectos] importacion sin indice Operam:', err.message);
  }
  const fecha = new Date().toISOString();
  const porVendedor = {};
  let importados = 0;
  let enriquecidos = 0;
  for (const p of parseo.listos) {
    const existente = await prospectosStore.buscarPorCelular(p.celular);
    if (existente) {
      await enriquecerConExport(existente, p, evento, fecha);
      enriquecidos++;
      continue;
    }
    if (indiceListo) {
      const cliente = await matchCliente(p.celular);
      if (cliente) {
        descartados.push({ fila: p.fila, nombre: p.nombre, motivo: 'ya es cliente' });
        continue;
      }
    }
    try {
      await prospectosStore.crear({
        fecha, vendedor: p.vendedor, celular: p.celular, nombre: p.nombre,
        ciudad: p.ciudad, canal: p.canal, data: p.data,
      });
    } catch (e) {
      if (e.code !== '23505') throw e;
      descartados.push({ fila: p.fila, nombre: p.nombre, motivo: 'ya es prospecto' });
      continue;
    }
    importados++;
    porVendedor[p.vendedor] = (porVendedor[p.vendedor] || 0) + 1;
  }
  // El cruce por correo es SOLO contra los prospectos del mismo evento (un
  // correo repetido de otra feria no es la misma oportunidad). Se lee despues
  // del loop para que un gafete sin celular alcance a los que acaban de nacer.
  // Sin evento activo no hay contra que cruzar y todos salen al reporte.
  const delEvento = evento
    ? (await prospectosStore.listar()).filter(x => (x.data || {}).evento === evento)
    : [];
  const sinCelular = [];
  for (const g of parseo.sinCelular) {
    const correo = g.correo.toLowerCase();
    const match = correo && delEvento.find(x => String((x.data || {}).correo || '').trim().toLowerCase() === correo);
    if (match) {
      await enriquecerConExport(match, g, evento, fecha);
      enriquecidos++;
      continue;
    }
    sinCelular.push({ fila: g.fila, nombre: g.nombre, empresa: g.empresa, correo: g.correo, scoring: g.scoring });
  }
  descartados.sort((a, b) => a.fila - b.fila);
  res.json({ importados, enriquecidos, descartados, sinCelular, porVendedor, avisos: parseo.avisos });
});

app.post('/api/admin/precios', authMiddleware, adminMiddleware, upload.single('excel'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibio archivo' });
  try {
    const newData = extractPrices(req.file.buffer);
    const oldData = readJSON('precios.json');
    const diff = oldData ? diffPrices(oldData, newData) : null;
    if (req.query.preview === '1') return res.json({ preview: true, diff, newVersion: newData.version });
    writeJSON('precios.json', newData);
    res.json({ saved: true, diff, version: newData.version });
  } catch (err) {
    console.error('Error procesando Excel:', err);
    res.status(400).json({ error: 'Error procesando archivo: ' + err.message });
  }
});

app.get('/api/admin/config', authMiddleware, adminMiddleware, (req, res) => {
  const config = configStore.leer() || { tiposActivos: [], texturasActivas: [] };
  const precios = readJSON('precios.json') || {};
  res.json({
    config,
    tiposDisponibles: precios.tiposProducto || [],
    tiposNombre: precios.tiposNombre || {},
    texturasDisponibles: precios.texturas || {},
  });
});

// Evento activo del panel admin (issue #261): nombre + fecha de fin, o null para
// apagar la captura de expo. Un evento a medias (sin nombre o sin fin) se
// rechaza: con el nombre viaja el etiquetado de TODO lo que entra por la feria.
function normalizarEventoActivo(evento) {
  if (evento == null || evento === '') return { evento: null };
  if (typeof evento !== 'object') return { error: 'Evento invalido' };
  const nombre = String(evento.nombre == null ? '' : evento.nombre).trim();
  const fin = String(evento.fin == null ? '' : evento.fin).trim();
  if (!nombre || !fin) return { error: 'El evento activo necesita nombre y fecha de fin' };
  return { evento: { nombre, fin } };
}

app.post('/api/admin/config', authMiddleware, adminMiddleware, async (req, res) => {
  const { tiposActivos, texturasActivas, eventoActivo, catalogoUrl, sitioUrl } = req.body;
  if (!Array.isArray(tiposActivos) || !Array.isArray(texturasActivas)) {
    return res.status(400).json({ error: 'Formato invalido' });
  }
  const { evento, error } = normalizarEventoActivo(eventoActivo);
  if (error) return res.status(400).json({ error });
  // La lectura va DENTRO del try junto con el guardado: el handler es async
  // desde #276 y Express 4 no atrapa lo que rechaza una promesa -- un fallo de
  // la base o un config.json corrupto tumbarian el proceso en vez de dar 500.
  try {
    // El merge parte de lo que hay en la BASE, no de la cache fria: si el warm
    // de arranque fallo o va en vuelo, leer() contesta con el archivo semilla y
    // guardar lo escribiria encima de lo configurado en el panel -- justo la
    // reversion al commit que #276 vino a eliminar.
    await configStore.cargar();
    // Merge sobre lo guardado: el panel manda lo que edita y lo demas se
    // conserva (antes este POST reescribia el archivo entero con dos llaves).
    const actual = configStore.leer() || {};
    const nuevo = { ...actual, tiposActivos, texturasActivas };
    if (eventoActivo !== undefined) nuevo.eventoActivo = evento;
    if (catalogoUrl !== undefined) nuevo.catalogoUrl = String(catalogoUrl == null ? '' : catalogoUrl).trim();
    if (sitioUrl !== undefined) nuevo.sitioUrl = String(sitioUrl == null ? '' : sitioUrl).trim();
    await configStore.guardar(nuevo);
  } catch (err) {
    return res.status(500).json({ error: 'Configuracion no disponible: ' + err.message });
  }
  res.json({ saved: true });
});

app.get('/api/admin/vendedores', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    res.json(await vendedoresStore.listar());
  } catch (err) {
    res.status(500).json({ error: 'Registro de vendedores no disponible: ' + err.message });
  }
});

app.put('/api/admin/vendedores', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const vendedores = req.body;
    if (!Array.isArray(vendedores)) return res.status(400).json({ error: 'Formato invalido' });
    // El tope y el flag de fijar lista se normalizan al guardarlos (#137/#153):
    // un valor basura o fuera de rango capturado en la administracion nunca
    // puede volverse permiso ilimitado.
    await vendedoresStore.reemplazar(vendedores.map(v => {
      if (!v) return v;
      const out = { ...v };
      if (v.topeDescuento !== undefined) out.topeDescuento = normalizarTope(v.topeDescuento);
      if (v.puedeFijarLista !== undefined) out.puedeFijarLista = normalizarPuedeFijarLista(v.puedeFijarLista);
      if (v.puedeAsignar !== undefined) out.puedeAsignar = normalizarPuedeAsignar(v.puedeAsignar);
      if (v.puedePrecioCalca !== undefined) out.puedePrecioCalca = normalizarPuedePrecioCalca(v.puedePrecioCalca);
      return out;
    }));
    res.json({ saved: true });
  } catch (err) {
    res.status(500).json({ error: 'No se pudo guardar el registro: ' + err.message });
  }
});

const ENVIA_ORIGIN = {
  name: 'Peltre Nacional', company: 'Peltre Nacional SA de CV',
  email: 'contacto@pppeltre.mx', phone: '5573151197',
  street: 'Roberto Fierro', number: 'MZ42 LT13',
  district: 'Alfredo del Mazo', city: 'Ixtapaluca',
  state: 'MEX', country: 'MX', postalCode: '56577',
};

app.post('/api/cotizacion/envio', authMiddleware, async (req, res) => {
  const { cpDestino, paisDestino, items, totalConIVA } = req.body;
  if (!cpDestino) return res.status(400).json({ error: 'CP destino requerido' });
  if (!items?.length) return res.status(400).json({ error: 'Carrito vacio' });
  const ENVIA_API_KEY = process.env.ENVIA_API_KEY;
  if (!ENVIA_API_KEY) return res.status(500).json({ error: 'ENVIA_API_KEY no configurado en .env' });
  let packages, resumen, warnings;
  try {
    ({ packages, resumen, warnings } = calcularPaquetes(items, totalConIVA || 0));
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (packages.length === 0) return res.status(400).json({ error: 'No se calcularon paquetes', warnings });
  const destination = { name: 'Destinatario', city: 'Destino', state: 'DF', country: paisDestino || 'MX', postalCode: cpDestino };
  const CARRIERS = ['fedex', 'dhl', 'ups'];
  const queryCarrier = async (carrier) => {
    const payload = { origin: ENVIA_ORIGIN, destination, packages, shipment: { carrier, type: 1 } };
    const r = await fetch('https://api.envia.com/ship/rate/', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${ENVIA_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await r.json();
    if (!r.ok || data.meta === 'error') return [];
    return Array.isArray(data) ? data : (data.data || []);
  };
  try {
    const results = await Promise.allSettled(CARRIERS.map(queryCarrier));
    const rates = results.filter(r => r.status === 'fulfilled').flatMap(r => r.value);
    rates.sort((a, b) => (a.totalPrice ?? a.rate ?? 0) - (b.totalPrice ?? b.rate ?? 0));
    if (rates.length === 0 && warnings.length === 0) warnings.push('No se obtuvieron tarifas de ninguna paqueteria');
    res.json({ rates, resumen, warnings });
  } catch (err) {
    console.error('Error cotizando envio:', err);
    res.status(500).json({ error: 'Error de conexion con envia.com: ' + err.message });
  }
});

app.get('/api/admin/cajas', authMiddleware, adminMiddleware, (req, res) => {
  res.json(readJSON('cajas.json') || {});
});

app.put('/api/admin/cajas', authMiddleware, adminMiddleware, (req, res) => {
  const cajas = req.body;
  if (typeof cajas !== 'object' || Array.isArray(cajas)) return res.status(400).json({ error: 'Formato invalido' });
  writeJSON('cajas.json', cajas);
  res.json({ saved: true });
});

app.get('/api/admin/cotizaciones', authMiddleware, adminMiddleware, async (req, res) => {
  const log = await cotStore.listar();
  res.json(log.map(({ id, fecha, vendedor, cliente, totalPiezas, total, tier }) =>
    ({ id, fecha, vendedor, cliente, totalPiezas, total, tier })
  ));
});

// Reporte de higiene de clientes con RFC generico (issue #86, ADR-0006
// "Higiene"): cruza clientes_log (altas genericas, #81) con las cotizaciones
// locales via la funcion pura construirReporteHigiene. Sin DB: lista vacia y
// sinDb:true (mismo patron de ausencia de datos que otras rutas admin), nunca
// un 503 -- es una vista informativa, no una operacion que dependa de Neon.
app.get('/api/admin/higiene-clientes-genericos', authMiddleware, adminMiddleware, async (req, res) => {
  const rows = await dbQuery(
    'SELECT id, created_at, rfc, nombre, resultado, cliente_id, fuente, dropbox_ok, error_msg FROM clientes_log ORDER BY created_at ASC'
  );
  if (rows === null) return res.json({ filas: [], sinDb: true });
  const cotizaciones = await cotStore.listar();
  res.json({ filas: construirReporteHigiene(rows.rows, cotizaciones, new Date()), sinDb: false });
});

// Observabilidad de los barridos de sincronizacion de contactos a Google
// (issue #230, padre #224): ultima corrida por barrido, totales de la ultima
// pasada y sus errores clasificados en autorizacion/datos/red/otro -- el caso
// concreto que hay que poder ver es una autorizacion revocada, que de otro
// modo no da ningun sintoma en el cotizador. Sin DB: lista vacia y
// sinDb:true, mismo patron que el reporte de higiene de arriba.
app.get('/api/admin/sync-contactos-google', authMiddleware, adminMiddleware, async (_req, res) => {
  const barridos = await listarBarridosContactos();
  res.json({ barridos, sinDb: !process.env.DATABASE_URL });
});

// Reporte de paridad del catalogo Excel vs Operam (issue #130, padre #120, bloqueado
// por #128/#129). Lee Operam completo con los lectores de #128 (~10 llamadas: sales
// types, precios e items paginados), corre el nucleo puro construirCatalogo contra
// data/catalogo-complemento.json y data/precios.json como referencia, y devuelve el
// reporte JSON. READ-ONLY siempre -- el apply se queda en scripts/sync-catalogo.mjs
// (#129); esta ruta nunca escribe data/precios.json.
app.get('/api/admin/paridad-catalogo', authMiddleware, adminMiddleware, async (_req, res) => {
  try {
    const salesTypes = await listarSalesTypes({ showInactive: true });
    const precios = await listarPreciosCompletos();
    const items = await listarItemsCompletos({ showInactive: true });
    const complemento = readJSON('catalogo-complemento.json') || {};
    const referencia = readJSON('precios.json');
    const { catalogo, paridad } = construirCatalogo({
      salesTypes, precios, items, complemento, referencia,
      extracted: new Date().toISOString(),
    });
    res.json({ ...paridad, sinCaja: productosSinCaja(catalogo) });
  } catch (err) {
    res.status(503).json({ error: 'No se pudo leer el catalogo de Operam: ' + err.message });
  }
});

// === BANDEJA DE REVISION "Rescatados de Operam" (issue #122) ===
// Vive FUERA de las 7 columnas del pipeline: lo que nace en Operam entra por
// aqui y llega al tablero solo si un humano lo acepta. Admin-only (misma
// visibilidad que el reporte de higiene, #86): el gate va en el servidor, no
// solo en la UI. Ninguna ruta de esta seccion habla con Operam -- los candidatos
// los siembra el lote historico (#124) o el descubrimiento recurrente (#126).
app.get('/api/admin/bandeja', authMiddleware, adminMiddleware, async (_req, res) => {
  res.json(await bandejaStore.listar());
});

// Aceptar un candidato = dejarlo entrar al tablero. Dos caminos, y lo elige el
// TIPO del candidato (no el cliente ni la UI): prospecto (#122, abajo) o
// cotizacion (#125, aceptarComoCotizacion). Lo comun a ambos vive aqui: existe,
// sigue pendiente y el vendedor es del catalogo.
// El prospecto se crea por el camino normal del store, con el vendedor propuesto
// EDITABLE (el body manda; sin body, el propuesto por el candidato) y validado
// contra el catalogo, igual que PATCH /api/prospectos/:id/asignar. Nace en la
// etapa por defecto del store (Por Cotizar): un quote rescatado que nunca cerro
// es trabajo por hacer, no un seguimiento vivo. Guarda folioOperam y la fuente
// para saber de que quote de Operam salio la tarjeta.
app.post('/api/admin/bandeja/:folio/aceptar', authMiddleware, adminMiddleware, async (req, res) => {
  const folio = String(req.params.folio);
  const candidato = await bandejaStore.obtener(folio);
  if (!candidato) return res.status(404).json({ error: 'No encontrado' });
  if (candidato.estado !== 'pendiente') {
    return res.status(409).json({ error: `Este candidato ya fue ${candidato.estado}`, estado: candidato.estado });
  }
  const vendedor = (req.body && req.body.vendedor) || candidato.vendedor;
  const catalogo = (await vendedoresStore.listar()).filter(v => v.operam_id != null);
  if (!vendedor || !catalogo.some(v => v.name === vendedor)) {
    return res.status(400).json({ error: 'El vendedor debe ser uno del catálogo' });
  }
  if (candidato.tipo === 'cotizacion') {
    return aceptarComoCotizacion(candidato, vendedor, res);
  }
  const data = { folioOperam: candidato.folio, fuente: bandejaStore.FUENTE_BANDEJA_OPERAM };
  if (candidato.email) data.correo = candidato.email;
  if (candidato.proyecto) data.proyecto = candidato.proyecto;
  if (candidato.domicilio) data.domicilio = candidato.domicilio;
  let prospectoId;
  let existente = false;
  try {
    prospectoId = await prospectosStore.crear({
      fecha: new Date().toISOString(), vendedor,
      celular: candidato.celular, nombre: candidato.contacto,
      ciudad: '', canal: null, data,
    });
  } catch (e) {
    if (e.code !== '23505') throw e;
    // Identidad 1 celular = 1 prospecto (CONTEXT.md): el candidato marcado como
    // posible duplicado se liga al prospecto que ya existe, en vez de crear una
    // tarjeta gemela. Sin celular no hay identidad que ligar: ahi el choque no
    // se puede resolver solo y el candidato se queda pendiente.
    const dup = await prospectosStore.buscarPorCelular(candidato.celular);
    if (!dup) return res.status(409).json({ error: 'No se pudo crear el prospecto: captúralo a mano' });
    prospectoId = dup.id;
    existente = true;
  }
  // El gate real contra el doble-aceptar es esta transicion atomica (UPDATE
  // WHERE estado='pendiente'), no el obtener() de arriba. Si dos requests
  // compiten, el perdedor pudo haber creado ya su prospecto: queda huerfano y el
  // request responde 409 -- edge aceptado (una sola instancia Node en Render y
  // el dedup por celular del store hace al huerfano casi imposible).
  const marcado = await bandejaStore.aceptar(folio, { vendedor, prospectoId });
  if (!marcado) return res.status(409).json({ error: 'Este candidato ya fue resuelto' });
  res.status(existente ? 200 : 201).json({ ok: true, prospectoId, existente });
});

// Aceptar un candidato tipo COTIZACION (issue #125): el quote de un cliente REAL
// entra al pipeline como oportunidad. La entrada se construye con la MISMA
// maquinaria del backfill historico (construirEntradaCotizacion de #76) desde el
// payload que el candidato carga en `quote` -- este camino NO habla con Operam --,
// de modo que la tarjeta creada es indistinguible para el sync de una importada por
// #76: partidas en data.items, RFC del debtor en data.cliente.rfc y el folio de
// Operam como columna de primer nivel (por ahi liga el sync su pedido).
async function aceptarComoCotizacion(candidato, vendedor, res) {
  // RESTRICCION DURA: un debtor GENERICO jamas puede volverse cotizacion del
  // pipeline. El fallback "agregado por cliente" del binding del sync (#67,
  // prioridad 3) mezclaria las transacciones de todos los contactos que comparten
  // el debtor y cerraria esas tarjetas en masa. Se valida en el SERVIDOR y por
  // debtorId: aunque un run defectuoso marcara tipo 'cotizacion' a un generico,
  // aqui se frena. Esos quotes se rescatan como PROSPECTO (#124).
  if (esDebtorGenerico(candidato.debtorId)) {
    return res.status(422).json({
      error: `${candidato.debtorNombre || 'Este cliente'} es un cliente genérico: su quote se acepta como prospecto, no como cotización (sus pedidos son de muchos contactos distintos)`,
    });
  }
  // El payload sembrado tiene que alcanzar para una oportunidad de verdad: sin
  // PARTIDAS el documento regenerado sale sin renglones (#76) y sin la fecha del
  // quote la entrada ni siquiera entra al store (columna NOT NULL en Neon). Mejor
  // frenar con motivo que dejar una tarjeta a medias en el tablero.
  const quote = candidato.quote;
  const partidas = (quote && Array.isArray(quote.detalles) ? quote.detalles : []).filter(Boolean);
  if (!quote || !quote.ord_date || partidas.length === 0) {
    return res.status(422).json({ error: 'Este candidato no trae el detalle completo del quote (partidas y fecha): no se puede crear la cotización con él' });
  }
  // Idempotencia contra el store de cotizaciones: si el folio ya es una oportunidad
  // (nacio en el cotizador o la importo #76) NO se duplica -- se liga el candidato a
  // la entrada EXISTENTE y se acusa. Misma comparacion como texto que folioYaExiste.
  const existentes = await cotStore.listar();
  const ya = existentes.find(c => c.folioOperam != null && String(c.folioOperam) === candidato.folio);
  if (ya) {
    const marcadoExistente = await bandejaStore.aceptar(candidato.folio, { vendedor, cotizacionId: ya.id });
    if (!marcadoExistente) return res.status(409).json({ error: 'Este candidato ya fue resuelto' });
    return res.json({ ok: true, cotizacionId: ya.id, existente: true });
  }
  // Pedido SINTETICO: solo aporta el folio del quote (order_no null = este quote
  // nunca se volvio pedido), igual que la parte B del backfill.
  const entrada = construirEntradaCotizacion({
    pedido: { trans_no_from: candidato.folio, order_no: null },
    quote,
    debtor: quote.debtor || { CustName: candidato.debtorNombre, debtor_no: candidato.debtorId },
    // Un quote rescatado que nunca cerro es un seguimiento vivo (misma etapa que le
    // da la parte B de #76): ya existe la cotizacion, lo que falta es perseguirla.
    etapa: 'seguimiento',
  });
  // El vendedor lo decide el humano en el selector de la bandeja (ya validado contra
  // el catalogo), no el mapeo del quote: por eso no se le pasa el catalogo arriba.
  entrada.vendedor = vendedor;
  // Origen HONESTO: `backfill` marca lo que importo el script historico de #76 y
  // esta tarjeta NO salio de ahi -- la acepto un humano en la bandeja, asi que su
  // origen es `fuente` (mismo marcador que el camino prospecto).
  entrada.data.fuente = bandejaStore.FUENTE_BANDEJA_OPERAM;
  entrada.data.backfill = false;

  const cotizacionId = await cotStore.crear(entrada);
  await cotStore.setFolioOperam(cotizacionId, entrada.folioOperam);
  await cotStore.cambiarEtapa(cotizacionId, entrada.etapa, {
    tipo: bandejaStore.FUENTE_BANDEJA_OPERAM,
    etapa: entrada.etapa,
    folioOperam: entrada.folioOperam,
    fecha: new Date().toISOString(),
  });
  // Mismo gate atomico que el camino prospecto: si dos requests compiten, el
  // perdedor responde 409 y su cotizacion queda huerfana (edge aceptado, una sola
  // instancia Node en Render).
  const marcado = await bandejaStore.aceptar(candidato.folio, { vendedor, cotizacionId });
  if (!marcado) return res.status(409).json({ error: 'Este candidato ya fue resuelto' });
  res.status(201).json({ ok: true, cotizacionId, existente: false });
}

// Descartar MARCA, nunca borra: el folio descartado se queda en la bandeja para
// que ningun run futuro lo vuelva a proponer. Sin reactivacion (fuera de #122).
app.post('/api/admin/bandeja/:folio/descartar', authMiddleware, adminMiddleware, async (req, res) => {
  const folio = String(req.params.folio);
  const candidato = await bandejaStore.obtener(folio);
  if (!candidato) return res.status(404).json({ error: 'No encontrado' });
  if (!await bandejaStore.descartar(folio)) {
    return res.status(409).json({ error: `Este candidato ya fue ${candidato.estado}`, estado: candidato.estado });
  }
  res.json({ ok: true });
});

// Descubrimiento RECURRENTE de quotes nuevos en Operam (issue #126). Companero
// "hacia adelante" del lote historico de #124: en vez de una ventana fija hacia
// atras, camina folios de quote hacia ARRIBA desde el folio maximo YA CONOCIDO
// por el cotizador (folioMaximoConocido, #126) y deposita lo nuevo en la bandeja
// via planearDescubrimiento + depositarCandidatos (#124, reusado tal cual).
// Mecanismo MANUAL a proposito (boton); un cron puede agregarse despues sin tocar
// nada de aqui. Read-only contra Operam SIEMPRE: cero escrituras al tablero, a
// prospectos o a cotizaciones -- todo pasa por la bandeja, un humano decide.
// Comparacion explicita contra undefined (no `||`): 0 es un valor valido (los
// tests lo usan para no pacear) y `0 || 1100` lo pisaria con el default.
const THROTTLE_DESCUBRIMIENTO_MS = process.env.DESCUBRIMIENTO_THROTTLE_MS !== undefined
  ? Number(process.env.DESCUBRIMIENTO_THROTTLE_MS)
  : 1100;
// Lock en memoria (mismo patron que subidasOperamEnCurso): una sola instancia
// Node en Render, asi que un booleano basta. Sin el, dos clicks del boton
// caminarian el mismo rango de folios y competirian por el throttle global de
// operam-client (_setMinInterval es estado COMPARTIDO del modulo, de ahi que se
// restaure a 0 en el finally -- el resto de la app no debe quedar paceada).
let descubrimientoEnCurso = false;

app.post('/api/admin/bandeja/buscar-nuevas', authMiddleware, adminMiddleware, async (_req, res) => {
  if (descubrimientoEnCurso) {
    return res.status(425).json({ error: 'Ya hay una busqueda de nuevas en Operam en curso; espera a que termine' });
  }
  descubrimientoEnCurso = true;
  _setMinInterval(THROTTLE_DESCUBRIMIENTO_MS);
  try {
    const [cotizaciones, bandeja, prospectos] = await Promise.all([
      cotStore.listar(), bandejaStore.listar(), prospectosStore.listar(),
    ]);
    const vendedores = await vendedoresStore.listar();
    const bandejaFolios = bandeja.map(b => b.folio);
    const folioDesde = folioMaximoConocido(cotizaciones, bandeja) + 1;
    // Cotizaciones ANULADAS en Operam (#76): la API no expone la cancelacion; el
    // set lo genera scripts/detectar-cancelados.mjs (scraping de la web legacy).
    const cancelados = readJSON('cancelados.json') || { orders: [], quotes: [] };

    try {
      // Catalogo de clientes COMPLETO (contacts[]/branches[] inline): la unica
      // fuente de identidad del cruce (#123) para el camino generico. Misma
      // lectura que rescatar-genericos.mjs (#124).
      const clientes = await listarTodosClientes();
      // Pedidos recientes, para que el cruce por identidad pueda encontrar el
      // pedido que CIERRA un quote generico nuevo (mismo rango que #124: desde
      // la ventana de la medicion menos la gracia de captura, hasta hoy).
      const hoy = new Date().toISOString().slice(0, 10);
      const fechaCorte = fechaCorteMeses(MESES_VENTANA, hoy);
      const desdePedidos = new Date(Date.parse(`${fechaCorte}T00:00:00Z`) - GRACIA_DIAS * 86400000)
        .toISOString().slice(0, 10);
      const pedidos = [];
      for (let skip = 0; ; skip += 100) {
        const pagina = await listarPedidos({ desde: desdePedidos, hasta: hoy, skip, limit: 100 });
        const lista = Array.isArray(pagina) ? pagina : [];
        pedidos.push(...lista);
        if (lista.length < 100) break;
      }

      const plan = await planearDescubrimiento({
        obtenerQuote, obtenerCliente, folioDesde,
        clientes, pedidos, prospectos, vendedores,
        cancelados: cancelados.quotes || [], bandejaFolios, cotizaciones,
      });
      const { agregados } = await depositarCandidatos(plan, bandejaStore.proponer);

      res.json({ nuevos: agregados, saltados: plan.skips, folioDesde: plan.folioDesde, folioHasta: plan.folioHasta });
    } catch (err) {
      res.status(503).json({ error: 'No se pudo buscar nuevas en Operam: ' + err.message });
    }
  } finally {
    _setMinInterval(0);
    descubrimientoEnCurso = false;
  }
});

function titleCase(str) {
  if (!str) return '';
  const lower = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'o', 'a', 'en', 'al', 'el', 'por', 'con', 'sin']);
  return str.trim().toLowerCase().split(/\s+/).map((w, i) => {
    if (i > 0 && lower.has(w)) return w;
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ');
}

app.get('/api/operam/clientes', authMiddleware, async (req, res) => {
  const q = req.query.q || '';
  if (!q.trim()) return res.json([]);
  try {
    // Issue #97: buscarClientes(q) es la busqueda de Operam (razon social);
    // buscarClientesPorTexto(q) cablea el indice de telefonos/nombre corto de
    // #42 (best effort, nunca lanza) para cubrir telefono de contacto y
    // cust_ref, que Operam no indexa. Se combinan y deduplican por customer_id.
    // OJO (#194): ninguna de las dos indexa el RFC, asi que un vendedor que
    // teclee un RFC en esta caja no encuentra nada. NO es el bug de #194 (aqui
    // el texto es libre, no una llave de dedup) y se dejo como estaba; si se
    // quiere cubrir, el camino es un fallback a buscarClientesPorRfc cuando q
    // tenga forma de RFC.
    const [porOperam, porIndice] = await Promise.all([
      buscarClientes(q),
      buscarClientesPorTexto(q),
    ]);
    const vistos = new Set();
    const raw = [...(Array.isArray(porOperam) ? porOperam : []), ...porIndice].filter(c => {
      if (vistos.has(c.customer_id)) return false;
      vistos.add(c.customer_id);
      return true;
    });
    const clientes = raw.map(c => {
      const branch = c.branches?.[0] || {};
      // OJO: telefonos trae los de TODOS los branches/contactos (no solo branches[0]) --
      // buscarClientesPorTexto puede matchear por un telefono que viva en otro branch.
      const telefonos = [
        ...(c.branches || []).map(b => b.phone),
        ...(c.contacts || []).flatMap(ct => [ct.phone, ct.phone2]),
      ].filter(Boolean);
      return {
        id: c.customer_id, name: c.CustName || '', ref: c.cust_ref || '', rfc: c.tax_id || '',
        calle: titleCase([c.street, c.street_number].filter(Boolean).join(' ')),
        numInt: c.suite_number || '', colonia: titleCase(c.district || ''),
        cp: c.postal_code || '', municipio: titleCase(c.city || ''), estado: titleCase(c.state || ''),
        telefono: telefonos[0] || '',
        telefonos,
        email: branch.email || c.contacts?.[0]?.email || '',
        nombreEntrega: branch.br_name || branch.contact_name || '',
        // #245: pais ISO (MX/US/CA) derivado del texto libre country, o null si
        // no se puede determinar (ver paisDeClienteOperam). El frontend fija
        // cl-pais solo cuando esto viene no nulo.
        pais: paisDeClienteOperam(c),
      };
    });
    res.json(clientes);
  } catch (err) {
    res.status(503).json({ error: 'Operam no disponible: ' + err.message });
  }
});

// Precarga de la configuracion comercial visible del cliente (issue #197): la
// Seccion 2 del upgrade fiscal se abre con lo que Operam tiene HOY, para que
// confirmar sin tocar nada no mande los defaults del panel encima de datos reales.
// Solo lectura, y el mapeo lo hace el nucleo puro (misma tabla que el diff/PUT).
// Un fallo responde 503 a proposito: el panel prefiere no precargar a precargar
// valores inventados, y sin precarga no deja viajar nada comercial.
app.get('/api/operam/clientes/:id/comercial', authMiddleware, async (req, res) => {
  try {
    const cliente = await obtenerClientePorId(req.params.id);
    if (!cliente) return res.status(503).json({ error: 'Operam no devolvio el cliente' });
    res.json(precargaComercialUpgrade(cliente));
  } catch (err) {
    res.status(503).json({ error: 'Operam no disponible: ' + err.message });
  }
});

app.get('/api/operam/clientes/:id/domicilios', authMiddleware, async (req, res) => {
  try {
    res.json(await obtenerDomicilios(req.params.id));
  } catch {
    res.status(503).json({ error: 'Operam no disponible' });
  }
});

// Fuente propia del log de clientes para el gate de este PATCH (issue #207): lo
// distingue del upgrade fiscal (FUENTE_CSF_UPGRADE) en la auditoria de clientes_log.
const FUENTE_PATCH_CLIENTE = 'patch-cliente';

app.patch('/api/operam/clientes/:id', authMiddleware, async (req, res) => {
  const { diff } = req.body || {};
  if (!diff || typeof diff !== 'object') return res.status(400).json({ error: 'diff requerido' });
  const id = req.params.id;
  // Gate anti-fusion (#207, mismo verificador del upgrade fiscal #85): un vendedor
  // autenticado NO puede asignarle a un cliente el RFC real de OTRO cliente por este
  // camino. Solo corre cuando el diff toca tax_id -- el resto de los campos no
  // arriesga una colision de identidad. RFC generico exento (comparte RFC por diseno).
  const rfcNuevo = diff.tax_id && typeof diff.tax_id === 'object' ? diff.tax_id.nuevo : undefined;
  const hayCambioRfc = rfcNuevo != null && rfcNuevo !== '';
  if (hayCambioRfc) {
    let verificacion;
    try {
      verificacion = await verificarRfcLibre(rfcNuevo, id);
    } catch (err) {
      return res.status(503).json({ error: 'No se pudo actualizar en Operam: ' + err.message });
    }
    if (verificacion.estado === 'otro') {
      logCliente(normalizarRfc(rfcNuevo), null, 'rfc-bloqueado', id, FUENTE_PATCH_CLIENTE, null, `El RFC ya pertenece al cliente ${verificacion.dueno.cliente_id} (${verificacion.dueno.CustName})`);
      return res.status(409).json({
        error: `Este RFC ya pertenece a otro cliente en Operam: ${verificacion.dueno.cliente_id} (${verificacion.dueno.CustName}).`,
        fusion: true,
        cliente: verificacion.dueno,
      });
    }
  }
  try {
    await actualizarClienteDirecto(id, bodyDesdeDiffFiscal(diff));
    if (hayCambioRfc) logCliente(normalizarRfc(rfcNuevo), null, 'rfc-actualizado', id, FUENTE_PATCH_CLIENTE, null, null);
    res.json({ ok: true });
  } catch (err) {
    if (hayCambioRfc) logCliente(normalizarRfc(rfcNuevo), null, 'error', id, FUENTE_PATCH_CLIENTE, null, err.message);
    res.status(503).json({ error: 'No se pudo actualizar en Operam: ' + err.message });
  }
});

// Subida de una cotizacion cuya oportunidad NO tiene cliente en Operam (issue #81,
// ADR-0006): una sola operacion server-side con reporte de pasos (estilo
// /api/crear-cliente, ADR-0002). Dedup en capas ANTES de crear:
//   1. celular contra prospectos: un prospecto convertido ya mapea celular ->
//      customer_id (data.cliente_id) y se reutiliza;
//   2. nombre normalizado contra los genericos de Operam (ADR-0001): con
//      candidatos la operacion SE DETIENE (409 { candidatos }); el vendedor
//      resuelve reintentando con { customerId } elegido -- el documento local no
//      se bloquea.
// Desde #204 esa parada SI tiene escape: { crearNuevo: true } = "ninguno es el
// mismo cliente". Salta la parada por nombre y NADA MAS -- la reutilizacion por
// celular (capa 1) y las guardas del customerId contradictorio corren igual, y el
// forzado queda en clientes_log para higiene-clientes (#86). Ver la nota fechada
// de ADR-0001.
// El customer_id se persiste (cotizacion y prospecto) ANTES de subir: un reintento
// tras fallo parcial entra por el camino normal con el id persistido y NO crea un
// segundo cliente.
// Pool de dedup por RFC generico + resultado de detectarDuplicados (#208):
// mismo pipeline que usan la parada original por nombre y la revalidacion del
// customerId elegido, factorizado para no divergir entre las dos. SIEMPRE
// buscarClientesPorRfc (#194, nunca buscarClientes: el ?search= de Operam no
// indexa el RFC) con el pool COMPLETO paginado (el pool de genericos crece por
// diseno, #81; un match fuera de la primera pagina volveria la dedup 'libre').
// SIN telefono/correo aqui a proposito (#210): esos solo alimentan los hechos
// del picker (ver contextoHechos/candidatoParaContrato abajo), nunca la
// seleccion -- detectarDuplicados/candidatosPorNombreOTelefono deciden con
// nombre y, cuando lo traen, telefono EXACTAMENTE igual que antes de #210.
// El pool es la UNION de los dos RFC genericos (#244), no el del RFC que le toco a
// esta cotizacion. Los clientes sin RFC real son un solo conjunto logico: el mismo
// cliente queda archivado bajo XAXX o XEXX segun el pais que capturo quien lo dio
// de alta, y ese pais no es confiable (al elegir un cliente de Operam queda siempre
// en MX). Consultar un solo generico dejaba ciega la mitad del universo: CUMBIARCA
// SA vivia en XEXX, la cotizacion pregunto por XAXX, el veredicto fue "libre" y el
// duplicado solo lo freno el cust_ref unico de Operam con un 406 sin salida.
// Mismo patron que ya usa /api/buscar-cliente-duplicado para el fallback de #78.
// `rfcGenerico` (el que se reporta y se loguea) SI sale del resolvedor: es el que
// llevaria el alta si hay que crear.
// Varias listas de clientes de Operam -> el pool que espera detectarDuplicados:
// aplana, quita repetidos por customer_id y expone RFC/id con los nombres que el
// nucleo puro compara. Lo comparten los DOS sitios que combinan pools (aqui y
// /api/buscar-cliente-duplicado, #78); tenerlo dos veces era arrastrar la misma
// forma con dos redacciones.
//
// Una fila SIN customer_id NO se descarta: no hay con que identificarla, y
// tratarlas como repetidas colapsaria filas distintas en una sola. Pasa al pool y
// que la dedup decida por nombre o telefono -- de mas se pregunta, de menos se
// crea un duplicado en silencio.
function poolClientesParaDedup(listas) {
  const vistos = new Set();
  return listas
    .flatMap(l => (Array.isArray(l) ? l : []))
    .filter(c => {
      const id = c?.customer_id;
      if (id == null || id === '') return true;
      if (vistos.has(id)) return false;
      vistos.add(id);
      return true;
    })
    .map(c => ({ ...c, RFC: c.tax_id || c.RFC || c.rfc || '', id: c.customer_id }));
}

// El nombre corto se escribe como `cust_ref` del cliente generico y Operam lo
// exige UNICO EN TODO EL PADRON, sin importar el RFC (#242, 406 "Already exists
// customer with same cust_ref"). Por eso, ademas de los pools de genericos, se
// busca el dueno del nombre corto en el padron COMPLETO (la cache de #42, que ya
// esta en memoria: el ?search= de Operam no indexa cust_ref ni RFC, #194) y se
// suma a la MISMA lista de candidatos. Es el unico camino que puede DESCUBRIR que
// el cliente ya existe bajo un RFC real -- la dedup de ADR-0001 nunca propone a un
// cliente identificado, asi que el choque terminaba en veredicto 'libre', POST y
// 406 sin salida. Sale del mismo pipeline a proposito: la revalidacion de #208
// recalcula esto mismo y tiene que aceptar al candidato elegido.
// El padron es best effort (clientesCacheados nunca lanza): con la cache fria o
// Operam caido no aporta candidatos y el respaldo es el 406 traducido de abajo.
// El padron se devuelve para nombrar al dueno del cust_ref si el POST choca.
async function poolDedupGenerico(c, entry) {
  const rfcGenerico = rfcGenericoDe(c);
  const nombre = c.razonSocial || c.nombreCorto || entry.cliente || '';
  const [pools, padron] = await Promise.all([
    Promise.all([...RFC_GENERICOS].map(g => buscarClientesPorRfc(g))),
    // El default de clientesCacheados espera hasta 120 s una cache fria (es para el
    // barrido de contactos, #228, donde nadie espera). Aqui hay un vendedor esperando
    // la subida: con 5 s el padron llega si esta caliente y, si no, B (el 406
    // traducido) sigue siendo la salida.
    clientesCacheados({ timeoutMs: 5000 }),
  ]);
  const dedup = detectarDuplicados(rfcGenerico, nombre, poolClientesParaDedup(pools));
  return { rfcGenerico, nombre, padron, dedup: agregarCandidatosPorCustRef(dedup, padron, c.nombreCorto) };
}

// Contexto para los hechos del picker (#210): el telefono/correo REALES del
// contacto capturado en este paso, para que celularMatch/correoMatch dejen de
// ser "sin dato" por falta de plomeria cuando el dato si existe. correo es
// opcional (emailFactura o, si falta, emailEntrega); sin ninguno de los dos
// hechosCandidato ya cae a 'sin_dato' honestamente (estadoMatch), no truena.
function contextoHechos(c, nombre) {
  return { tokensInput: normalizarNombre(nombre), telefonoInput: c.telefono, correoInput: c.emailFactura || c.emailEntrega || '' };
}

// Forma del candidato que viaja en el 409 (#210): datos base + hechos crudos
// (diferencia de nombre en ambas direcciones, letreros de celular/correo),
// calculados APARTE de la seleccion (hechosCandidato nunca decide quien entra a
// la lista). El picker (buildCandidatosOperamHtml) los pinta sin clasificar --
// el humano decide. Ninguna combinacion bloquea Elegir/Crear nuevo.
// custRefIgual (#242): este candidato usa EL MISMO nombre corto (cust_ref) que la
// cotizacion. Es el hecho mas duro del picker -- Operam no dejaria crear un cliente
// con ese nombre corto -- y puede venir de un cliente con RFC REAL, que ninguna otra
// senal habria propuesto. Por eso el picker pinta tambien su RFC.
function candidatoParaContrato(k, ctx) {
  const hechos = hechosCandidato(k, ctx.tokensInput, ctx.telefonoInput, ctx.correoInput);
  return {
    id: k.customer_id, CustName: k.CustName, cust_ref: k.cust_ref, tax_id: k.tax_id,
    diferenciaNombre: hechos.diferenciaNombre, celularMatch: hechos.celularMatch, correoMatch: hechos.correoMatch,
    custRefIgual: k._custRefIgual === true,
  };
}

// Traduccion del 406 de cust_ref duplicado (#242) a algo que el vendedor pueda
// EJECUTAR. Sin esto el unico camino era reintentar, que da exactamente el mismo
// 406: el nombre corto es unico global en Operam y nadie mas puede cambiarlo.
// Si el padron cacheado alcanza a nombrar al dueno, se nombra (razon social y RFC):
// saber contra que se choco es la diferencia entre cambiar el nombre corto a ciegas
// y darse cuenta de que ese cliente ya existia. Sin nombre corto capturado el
// cust_ref lo deriva Operam del nombre del cliente (buildClienteBody), asi que el
// texto no inventa un valor que el vendedor no escribio.
function esErrorCustRefDuplicado(err) {
  return /same cust_ref/i.test(String(err?.message || ''));
}

function mensajeCustRefDuplicado(nombreCorto, padron) {
  const dueno = (padron || []).find(k => coincideCustRef(k?.cust_ref, nombreCorto));
  const quien = dueno
    ? ` Lo usa ${dueno.CustName || `el cliente ${dueno.customer_id}`}${dueno.tax_id ? ` (RFC ${dueno.tax_id})` : ''}.`
    : '';
  const cual = nombreCorto ? ` "${nombreCorto}"` : '';
  return `El nombre corto${cual} ya lo usa otro cliente en Operam, que lo exige unico.${quien}` +
    ' Cambia el nombre corto del cliente y vuelve a generar la cotizacion.';
}

// Vendedor de la cotizacion -> su operam_id (el `salesman` que Operam guarda en
// la SUCURSAL, no en el cliente; ver docs/arquitectura.md). Lo necesitan el alta
// generica y la creacion de sucursal (#211), que escriben el mismo campo.
async function salesmanDeVendedor(nombreVendedor) {
  return (await vendedoresStore.listar()).find(v => v.name === nombreVendedor)?.operam_id ?? undefined;
}

async function subirConAltaGenerica(res, id, entry, customerIdElegido, crearNuevo, sucursalDe) {
  const c = entry.data?.cliente || {};
  const steps = [];
  // "Es sucursal de este cliente" (#211): el cliente existente manda igual que al
  // elegirlo -- mismas guardas, misma revalidacion contra el pool -- y ademas se
  // le crea una sucursal nueva. Con AMBOS en el body manda el elegido:
  // reutilizar tal cual es el desenlace mas conservador (no escribe nada nuevo),
  // misma regla que customerId frente a crearNuevo.
  const crearSucursal = customerIdElegido == null && sucursalDe != null;
  const idElegido = customerIdElegido ?? (crearSucursal ? sucursalDe : null);
  let customerId = idElegido;
  let creadoNuevo = false;
  let salesman;
  try {
    const prospecto = await prospectosStore.buscarPorCelular(c.telefono);

    if (customerId != null) {
      // El customerId elegido no puede contradecir lo ya ligado -- ni el de la
      // cotizacion (reintento con otro cliente) ni el del prospecto (celular ya
      // convertido). Mejor frenar que mezclar cuentas.
      if (c.customerId != null && String(c.customerId) !== String(customerId)) {
        return res.status(409).json({ error: `La cotizacion ya esta ligada al cliente ${c.customerId} en Operam y difiere del elegido (${customerId})` });
      }
      if (prospecto?.data?.cliente_id != null && String(prospecto.data.cliente_id) !== String(customerId)) {
        return res.status(409).json({ error: `El celular de la cotizacion ya esta ligado al cliente ${prospecto.data.cliente_id} en Operam y difiere del elegido (${customerId})` });
      }
      // #208: el customerId viene del BODY como eleccion del vendedor -- puede
      // venir manipulado o apuntar a una lista de candidatos que ya cambio desde
      // el 409 original. Se recalcula el MISMO pool que genero esa parada y se
      // exige que el elegido siga perteneciendo a el; si no, mismo contrato del
      // 409 de candidatos: se responde con la lista FRESCA para que el vendedor
      // vuelva a elegir, cero escrituras. La reutilizacion por celular (arriba)
      // NO pasa por aqui -- ese customerId no lo elige el vendedor en este request.
      {
        const { nombre: nombreRevalida, dedup: dedupRevalida } = await poolDedupGenerico(c, entry);
        const candidatosFrescos = dedupRevalida.tipo === 'candidatos' ? dedupRevalida.candidatos : [];
        if (!candidatosFrescos.some(k => String(k.customer_id) === String(customerId))) {
          await marcarMotivoPre(id, MOTIVO_PRE_DEDUP);
          const ctx = contextoHechos(c, nombreRevalida);
          return res.status(409).json({
            error: 'El cliente elegido ya no esta en la lista de candidatos: elige uno para continuar',
            candidatos: candidatosFrescos.map(k => candidatoParaContrato(k, ctx)),
          });
        }
      }
      steps.push({ name: 'dedup', status: 'ok', info: crearSucursal ? 'candidato elegido como matriz de la sucursal' : 'candidato elegido' });
    } else if (prospecto?.data?.cliente_id != null) {
      customerId = prospecto.data.cliente_id;
      steps.push({ name: 'dedup', status: 'ok', info: 'cliente reutilizado por celular' });
    } else {
      const { rfcGenerico, nombre, padron, dedup } = await poolDedupGenerico(c, entry);
      if (dedup.tipo === 'candidatos' && !crearNuevo) {
        // Sin resolver no hay documento (#204): se marca el motivo ANTES de
        // responder para que el candado de los GET aplique de inmediato.
        await marcarMotivoPre(id, MOTIVO_PRE_DEDUP);
        const ctx = contextoHechos(c, nombre);
        return res.status(409).json({
          error: 'Hay clientes con RFC generico y nombre similar en Operam: elige uno para continuar',
          candidatos: dedup.candidatos.map(k => candidatoParaContrato(k, ctx)),
        });
      }
      // El vendedor dijo "ninguno es el mismo cliente" (#204). Se crea, pero el
      // paso queda en warn (no es un alta limpia) y el motivo viaja al log de
      // auditoria mas abajo: es la unica forma de que higiene-clientes (#86)
      // distinga despues un generico nuevo legitimo de uno forzado sobre un
      // candidato que si era el mismo cliente.
      const forzado = dedup.tipo === 'candidatos'
        ? dedup.candidatos.map(k => k.customer_id).join(', ')
        : null;
      if (forzado) steps.push({ name: 'dedup', status: 'warn', info: `creacion forzada por el vendedor pese a candidatos (${forzado})` });
      else steps.push({ name: 'dedup', status: 'ok', info: 'libre' });

      salesman = await salesmanDeVendedor(entry.vendedor);
      const salesTypeId = resolverSalesTypeId(entry.tier, await obtenerListasPrecios());
      let creado;
      try {
        // crearClienteDirecto: SIN la dedup por RFC exacto de crearCliente (con
        // RFC generico devolveria cualquier generico existente; la dedup correcta
        // por nombre ya corrio arriba).
        creado = await crearClienteDirecto(buildClienteGenerico(entry, { salesman, salesTypeId }));
      } catch (err) {
        steps.push({ name: 'POST customer', status: 'error', error: err.message });
        logCliente(rfcGenerico, nombre, 'error', null, FUENTE_ALTA_GENERICA, null, err.message);
        await marcarMotivoPre(id, MOTIVO_PRE_OPERAM);
        // Choque de nombre corto (#242): no es un fallo de Operam sino un dato que
        // el vendedor tiene que corregir, y el 503 generico lo mandaba a reintentar
        // en un bucle que siempre da lo mismo. NUNCA se desambigua el cust_ref por
        // nuestra cuenta (un sufijo automatico esconderia que el cliente ya existia).
        if (esErrorCustRefDuplicado(err)) {
          return res.status(409).json({
            error: mensajeCustRefDuplicado(c.nombreCorto || '', padron),
            codigo: 'CUST_REF_DUPLICADO', nombreCorto: c.nombreCorto || '', steps,
          });
        }
        return res.status(503).json({ error: 'No se pudo crear el cliente generico en Operam: ' + err.message, steps });
      }
      customerId = creado.cliente_id;
      creadoNuevo = true;
      steps.push({ name: 'POST customer', status: 'ok' });
      logCliente(rfcGenerico, nombre, forzado ? 'creado-forzado' : 'creado', customerId, FUENTE_ALTA_GENERICA, null,
        forzado ? `El vendedor eligio "ninguno es el mismo cliente" pese a los candidatos ${forzado} (#204)` : null);
      steps.push({ name: 'log auditoria', status: 'ok', info: FUENTE_ALTA_GENERICA });
    }

    // Con customerId elegido NUNCA se reutiliza un branchId persistido (pudo
    // capturarse para OTRO cliente): se resuelve siempre el branch del elegido.
    // La EXCEPCION es la sucursal (#211): si la cotizacion ya esta ligada a ESTE
    // mismo cliente y trae branchId, ese branchId ES la sucursal que este mismo
    // camino creo en un intento anterior -- reusarla es lo que impide que un
    // reintento cree una segunda sucursal.
    let branchId = idElegido != null ? null : (c.branchId ?? c.branch_id ?? null);
    if (crearSucursal && String(c.customerId ?? '') === String(customerId)) {
      branchId = c.branchId ?? c.branch_id ?? null;
    }

    // Sucursal nueva bajo el cliente existente (#211): SOLO POST -- un PUT sobre
    // un branch ya configurado es REPLACE destructivo con campos irrecuperables
    // (docs/arquitectura.md). Se crea con el domicilio de entrega y el contacto
    // capturados, los mismos que el alta generica lleva al branch del cliente
    // recien creado (buildBranchGenerico, #96/#170).
    if (crearSucursal && branchId == null) {
      const nombreCliente = c.razonSocial || c.nombreCorto || entry.cliente || '';
      if (salesman === undefined) salesman = await salesmanDeVendedor(entry.vendedor);
      const datosSucursal = buildBranchGenerico(c, { salesman });
      let creada = null;
      try {
        // BUSCAR ANTES DE CREAR (sucursalEquivalente, alta-generica.js): un
        // intento anterior pudo haber escrito la sucursal en Operam y morir
        // despues (relectura que no la vio, persistencia que no corrio). Sin
        // esto el reintento dejaria una segunda sucursal identica. Si la lectura
        // falla se cae al catch: 503 SIN escribir, que es la salida segura --
        // sin saber que hay, crear es lo unico que no se puede deshacer.
        const previas = await Promise.all(
          (await obtenerBranchesCliente(customerId))
            .map(async b => ({ branch_code: b.branch_code, ...(await obtenerBranch(b.branch_code) || {}) }))
        );
        const yaCreada = sucursalEquivalente(previas, datosSucursal);
        if (yaCreada) {
          branchId = yaCreada.branch_code;
          steps.push({ name: 'POST branch (sucursal)', status: 'ok', info: 'omitido: la sucursal ya existia en Operam de un intento anterior' });
        } else {
          creada = await crearBranchCliente(customerId, datosSucursal);
          steps.push({ name: 'POST branch (sucursal)', status: 'ok' });
          // RELEER: Operam responde result:true aunque no haya escrito nada (#74).
          // La sucursal tiene que aparecer entre las del cliente o el paso queda en
          // error -- la cotizacion NO finge exito ni se sube a un branch inventado.
          const branches = await obtenerBranchesCliente(customerId);
          const fresca = branches.find(b => String(b.branch_code) === String(creada.branch_id));
          if (!fresca) {
            throw new Error(`la sucursal ${creada.branch_id ?? '(sin codigo)'} no aparece bajo el cliente ${customerId} al releer`);
          }
          branchId = fresca.branch_code;
          steps.push({ name: 'verificar sucursal', status: 'ok' });
        }
        logCliente(rfcGenericoDe(c), nombreCliente, 'creado', customerId, FUENTE_SUCURSAL_CREADA, null,
          yaCreada
            ? `Sucursal ${branchId} del cliente ${customerId} reusada: ya existia de un intento anterior (#211)`
            : `Sucursal ${branchId} creada bajo el cliente ${customerId} por decision del vendedor (#211)`);
        steps.push({ name: 'log auditoria', status: 'ok', info: FUENTE_SUCURSAL_CREADA });
      } catch (err) {
        // El nombre del paso distingue "no se pudo crear" de "se creo pero la
        // relectura no la vio": el segundo caso puede haber dejado una sucursal
        // en Operam y el reintento tiene que volver a mirar antes de crear.
        steps.push({ name: creada ? 'verificar sucursal' : 'POST branch (sucursal)', status: 'error', error: err.message });
        logCliente(rfcGenericoDe(c), nombreCliente, 'error', customerId, FUENTE_SUCURSAL_CREADA, null, err.message);
        await marcarMotivoPre(id, MOTIVO_PRE_OPERAM);
        return res.status(503).json({ error: 'No se pudo crear la sucursal en Operam: ' + err.message, customer_id: customerId, steps });
      }
    } else if (crearSucursal) {
      steps.push({ name: 'POST branch (sucursal)', status: 'ok', info: 'omitido: la sucursal ya se creo en un intento anterior' });
    }

    // Persistir ANTES de subir (idempotencia): la cotizacion queda ligada al
    // cliente aunque la subida falle.
    await cotStore.actualizarDatos(id, { cliente: { ...c, customerId, branchId } });
    steps.push({ name: 'persistir customer_id', status: 'ok' });
    // Ligar el prospecto es fire-and-forget (mismo trato que Dropbox): el cliente
    // YA existe y la subida debe completarse; un fallo del store solo se reporta.
    // Si abortara aqui, el reintento entraria por el camino normal (customerId ya
    // persistido) y el prospecto quedaria sin mapear para siempre.
    if (prospecto && prospecto.data?.cliente_id == null) {
      try {
        await prospectosStore.ligarCliente(prospecto.id, customerId, {
          tipo: 'cliente', cliente_id: customerId, nombre: c.razonSocial || c.nombreCorto || '',
          fecha: new Date().toISOString(), vendedor: entry.vendedor,
        });
        steps.push({ name: 'ligar prospecto', status: 'ok' });
      } catch (err) {
        console.error('[prospectos] No se pudo ligar prospecto al cliente generico:', err.message);
        steps.push({ name: 'ligar prospecto', status: 'error', error: err.message });
      }
    }

    // El POST de Operam ignora dimension_id/dimension2_id (#74): persistirlas via
    // PUT, no bloqueante (mismo trato que en /api/crear-cliente).
    if (creadoNuevo) {
      try {
        await actualizarClienteDirecto(customerId, { dimension_id: 1, dimension2_id: 5 });
        steps.push({ name: 'PUT customer (dimensiones)', status: 'ok' });
      } catch (err) {
        steps.push({ name: 'PUT customer (dimensiones)', status: 'error', error: err.message });
      }
    }

    // El quote debe ir al branch del cliente (Operam lo auto-crea en el POST), no
    // al fallback branch_id 1 de subirCotizacionOperam. Se persiste para que un
    // reintento (camino normal por customerId) tambien lo use.
    if (branchId == null) {
      try {
        branchId = await obtenerBranchId(customerId);
        steps.push({ name: 'GET branch_id', status: 'ok' });
        await cotStore.actualizarDatos(id, { cliente: { ...c, customerId, branchId } });
      } catch (err) {
        steps.push({ name: 'GET branch_id', status: 'error', error: err.message });
        await marcarMotivoPre(id, MOTIVO_PRE_OPERAM);
        return res.status(503).json({ error: 'No se pudo obtener el domicilio del cliente en Operam: ' + err.message, customer_id: customerId, steps });
      }
    }

    // PUT del branch: domicilio de entrega del paso Envio (#96) + tax_group_id/
    // sales_account (#189, SIEMPRE, tambien sin domicilio -- no dependen de el, solo
    // del pais). SOLO para el cliente RECIEN creado por esta alta generica: un cliente
    // preexistente (reusado por celular o elegido de candidatos) puede tener un
    // domicilio real en Operam que NO debemos pisar con el del cotizador -- ahi si se
    // omite el PUT completo, tax_group_id incluido (#189 solo corrige el camino de
    // creacion; corregir un branch ya configurado es manual, issue #195, por el REPLACE
    // destructivo de este PUT). actualizarBranchCliente ya mete customer_id en el body
    // (sin el, Operam resetea debtor_no a 0) y usa location/ship_via (#74). El fallo NO
    // tumba la subida: el cliente ya existe y el quote debe subirse (#81).
    if (creadoNuevo) {
      const branchDatos = buildBranchGenerico(c, { salesman });
      try {
        await actualizarBranchCliente(customerId, branchId, branchDatos);
        steps.push({ name: 'PUT branch (domicilio)', status: 'ok' });
        // Releer y verificar: Operam responde result:true aunque ignore campos (#74).
        try {
          const fresco = await obtenerBranch(branchId);
          const camposNoActualizados = diffBranchDomicilio(fresco, branchDatos);
          if (camposNoActualizados.length) {
            steps.push({ name: 'verificar branch', status: 'warn', camposNoActualizados });
          } else {
            steps.push({ name: 'verificar branch', status: 'ok' });
          }
        } catch (err) {
          steps.push({ name: 'verificar branch', status: 'error', error: err.message });
        }
      } catch (err) {
        steps.push({ name: 'PUT branch (domicilio)', status: 'error', error: err.message });
      }
    }

    try {
      // La huella (#114) se toma de ESTE objeto, no de entry.data: el cliente recien
      // ligado (customerId/branchId) forma parte de lo que se subio, y la siguiente
      // regeneracion si lo trae (crearOActualizarCotizacion lo copia del registro).
      // Calcularla sobre entry.data haria que toda regeneracion pareciera un cambio.
      const dataSubida = { ...entry.data, cliente: { ...c, customerId, branchId } };
      const folio = await subirCotizacionOperam(dataSubida);
      if (folio != null && folio !== '') {
        await cotStore.setFolioOperam(id, folio);
        await cotStore.actualizarDatos(id, { huellaQuote: huellaContenidoQuote(dataSubida) });
        // Hay folio: se resolvio por el camino que sea (candidato elegido, cliente
        // nuevo forzado o reintento) y el candado se levanta (#204).
        await marcarMotivoPre(id, null);
      }
      steps.push({ name: 'POST quote', status: 'ok' });
      const pasoVigencia = await postFixVigencia(folio, entry.data);
      if (pasoVigencia) steps.push(pasoVigencia);
      // clienteGenerico (#93): este camino SIEMPRE deja el cliente con RFC generico
      // (creado nuevo o reutilizado por celular/dedup de nombre, ambos genericos) --
      // el frontend lo usa para refrescar el chip Fiscal y ofrecer la CSF junto al folio.
      return res.json({ ok: true, folio, customer_id: customerId, clienteGenerico: true, steps });
    } catch (err) {
      steps.push({ name: 'POST quote', status: 'error', error: err.message });
      await marcarMotivoPre(id, MOTIVO_PRE_OPERAM);
      return res.status(503).json({ error: 'No se pudo subir a Operam: ' + err.message, customer_id: customerId, steps });
    } finally {
      // En el finally y no en cada salida: el cliente YA existe con el segmento sin
      // aplicar, suba el quote o no, y un reintento no vuelve a pasar por aqui (entra por
      // el camino normal con el customerId persistido). Si no se corrige ahora, nadie lo
      // corrige. Corre despues de armar la respuesta, que es justo lo que se busca.
      //
      // Sin distinguir cliente creado de reutilizado: la regla soloSinSegmento (#186) ya
      // decide por si sola -- el recien creado siempre esta en "Sin segmento" y lo recibe;
      // al reutilizado se le respeta el suyo si ya venia clasificado.
      postFixSegmentoGenerico(customerId, c.segmentoId);
    }
  } catch (err) {
    await marcarMotivoPre(id, MOTIVO_PRE_OPERAM);
    return res.status(503).json({ error: 'No se pudo completar la subida con alta generica: ' + err.message, steps });
  }
}

// UNICO punto de escritura del motivo de PRE (#204). Guarda POR QUE la cotizacion
// se quedo sin folio, porque los dos motivos tienen consecuencias opuestas:
// 'operam' entrega el documento igual (ADR-0009) y 'dedup' lo deja bajo candado
// hasta que el vendedor resuelva. La marca de tiempo es la que consume el barrido
// de 24 horas. motivo null limpia ambos campos: se llama en cuanto hay folio, por
// cualquiera de los caminos (elegir candidato, crear nuevo, reintento exitoso).
// No es bloqueante para el vendedor: si el store fallara, el peor caso es un
// candado de mas (recuperable) o una PRE sin motivo (se comporta como antes).
async function marcarMotivoPre(id, motivo) {
  try {
    await cotStore.actualizarDatos(id, {
      motivoPre: motivo,
      motivoPreDesde: motivo ? new Date().toISOString() : null,
    });
  } catch (err) {
    console.error('[motivoPre] no se pudo persistir el motivo', motivo, 'en la cotizacion', id, err.message);
  }
}

// Barrido de las cotizaciones detenidas por duplicado sin resolver (#204). Ante
// candidatos el vendedor resuelve o el registro muere: a las HORAS_VIDA_DEDUP
// horas se borra la cotizacion (el PROSPECTO se queda -- la oportunidad sigue
// viva, lo que se tira es el intento de documento). Que borrar lo decide el
// nucleo puro cotizacionesDedupVencidas, con sus tres guardas.
// Se exporta para los tests; en produccion lo dispara el timer de abajo.
export async function barrerCotizacionesDedupVencidas(ahora = new Date()) {
  let ids = [];
  try {
    ids = cotizacionesDedupVencidas(await cotStore.listar(), ahora);
    for (const id of ids) await cotStore.borrar(id);
  } catch (err) {
    console.error('[dedup] el barrido de cotizaciones vencidas fallo:', err.message);
    return ids;
  }
  if (ids.length) console.log('[dedup] barrido: borradas', ids.length, 'cotizacion(es) detenidas por duplicado sin resolver:', ids.join(', '));
  return ids;
}

// Lock en memoria por id de cotizacion (F3 de la revision de #83): la
// idempotencia de la subida cubre reintentos SECUENCIALES, no concurrencia --
// dos requests EN VUELO al mismo id (auto-subida + Reintentar del Historial, o
// doble click en Elegir candidato) leerian ambos customerId null y crearian DOS
// clientes genericos. Instancia unica en Render (plan Starter): un Set basta -- con
// varias instancias haria falta un lock compartido (Neon). El
// segundo request recibe 425 claro y reintenta cuando el primero termine.
const subidasOperamEnCurso = new Set();

// Lock en memoria por RFC normalizado para el alta completa (#209, POST
// /api/crear-cliente): mismo problema check-then-act que subidasOperamEnCurso de
// arriba, pero con un RFC en vez de un id de cotizacion -- dos requests EN VUELO
// con el MISMO RFC nuevo (doble click, dos pestanas) verian ambas el pool vacio en
// la dedup de crearCliente y crearian DOS clientes en Operam para el mismo RFC. A
// diferencia de subidasOperamEnCurso, aqui la segunda request no debe fallar con
// 425: debe ESPERAR a que la primera termine y solo entonces correr su propia
// dedup, que para ese momento SI encuentra al cliente recien creado (mismo
// resultado que si hubiera llegado tarde) -- ningun segundo POST de cliente llega
// a Operam. RFC_GENERICOS queda exento (comparten RFC por diseno, ADR-0001), igual
// que la dedup por RFC exacto de crearCliente. Map<rfc, Promise> hace de cola FIFO
// por RFC -- misma asuncion de instancia unica en Render (plan Starter) que
// subidasOperamEnCurso: con varias instancias haria falta un lock compartido
// (Neon).
const altaClienteEnCurso = new Map();

async function crearClienteConLock(cliente) {
  const rfc = normalizarRfc(cliente.tax_id);
  if (RFC_GENERICOS.has(rfc)) return crearCliente(cliente);
  const previa = altaClienteEnCurso.get(rfc);
  const actual = (previa ? previa.catch(() => {}) : Promise.resolve()).then(() => crearCliente(cliente));
  altaClienteEnCurso.set(rfc, actual);
  try {
    return await actual;
  } finally {
    // Solo se borra la entrada si nadie se encolo detras -- si ya hay una promesa
    // mas nueva en el mapa, esa es la que manda liberar el lock cuando termine.
    if (altaClienteEnCurso.get(rfc) === actual) altaClienteEnCurso.delete(rfc);
  }
}

// Post-fix de la vigencia (#106, ADR-0007). El POST del quote ignora valid_until y deja
// el campo nativo "Valido hasta" en ord_date-1, asi que Operam marca como vencidas
// cotizaciones vivas; se corrige por la web legacy en cuanto el quote existe. NO es
// bloqueante: el quote ya esta subido y comments sigue llevando la vigencia, asi que un
// fallo aqui se reporta como step y nunca tumba la subida. La verificacion post-escritura
// (releer y comparar) sigue el mismo patron que el PUT del branch (#96) y el quirk del
// PUT de clientes, que responde 200 aunque ignore campos.
async function postFixVigencia(folio, data) {
  if (folio == null || folio === '') return null;
  try {
    const r = await corregirVigenciaQuote(folio, vigenciaDeCotizacion(data));
    if (r.ok) return { name: 'post-fix vigencia', status: 'ok' };
    // verificado false = la vista no traia el campo, asi que no se sabe como quedo; se
    // reporta distinto de "quedo con otra fecha" para no afirmar lo que no se comprobo.
    return {
      name: 'post-fix vigencia', status: 'warn',
      verificado: r.verificado, esperado: r.esperado, encontrado: r.encontrado,
    };
  } catch (err) {
    console.error('[post-fix vigencia] fallo en el quote', folio, err.message);
    return { name: 'post-fix vigencia', status: 'error', error: err.message };
  }
}

// Post-fix del SEGMENTO del cliente generico (#186). El POST /customers manda segmento_id
// desde #121 y Operam lo IGNORA -- la API v3 no lo escribe por NINGUN camino (#172,
// sondeo en vivo) -- asi que todo prospecto creado al subir una cotizacion quedaba en
// "Sin segmento" aunque el vendedor lo hubiera capturado. Lo escribe la web legacy, la
// misma funcion que ya usa el upgrade fiscal.
//
// FIRE-AND-FORGET y encolado SIEMPRE despues del post-fix de vigencia, nunca antes: este
// camino corre dentro de la subida de la cotizacion, que el frontend abandona a los
// TIMEOUT_OPERAM_MS entregando una PRE-COTIZACION (ADR-0009). La cola de post-fixes es
// FIFO y compartida, asi que encolarlo primero meteria su latencia en el camino critico
// aunque no se esperara el resultado. El precio es que un fallo solo vive en el log: la
// respuesta ya se fue y este flujo no puede reportarlo en `steps`.
function postFixSegmentoGenerico(customerId, segmentoId) {
  if (!segmentoId) return;
  actualizarSegmentoClienteWeb(customerId, segmentoId, { soloSinSegmento: true })
    .then(r => {
      if (!r.ok) console.error('[alta-generica] post-fix web del segmento fallo en el cliente', customerId, r.error);
    })
    .catch(err => console.error('[alta-generica] post-fix web del segmento fallo en el cliente', customerId, err.message));
}

app.post('/api/cotizacion/operam/:id', authMiddleware, async (req, res) => {
  const id = parseInt(req.params.id);
  if (subidasOperamEnCurso.has(id)) {
    return res.status(425).json({ error: 'Ya hay una subida a Operam en curso para esta cotizacion; espera a que termine y revisa el estado' });
  }
  subidasOperamEnCurso.add(id);
  try {
    const entry = await cotStore.obtener(id);
    if (!entry) return res.status(404).json({ error: 'Cotizacion no encontrada' });
    // Ya subida (#83, F1c): los quotes de Operam no se editan por API -- re-subir
    // duplicaria el quote. Se devuelve el folio existente sin tocar Operam.
    // Desde #114 este corte significa UNA sola cosa: el contenido no cambio (regenerar
    // el mismo carrito en otro formato). Una regeneracion CON cambios ya no llega
    // aqui: POST /api/cotizacion devuelve requiereActualizacionOperam y la generacion
    // entra por /actualizar, que reescribe el quote conservando el folio (#104,
    // ADR-0008). La decision se toma alli porque es el unico punto donde todavia
    // coexisten el contenido nuevo y la huella de lo que se subio.
    if (entry.folioOperam != null && entry.folioOperam !== '') {
      // #167 causa 3: eco del customer_id ya ligado -- sin esto, regenerar una
      // cotizacion ya subida no recupera el dato y el chip Fiscal queda sin
      // refrescar hasta la proxima busqueda (autoSubirOperam lo lee de esta
      // misma respuesta, ver app.js #93).
      return res.json({ ok: true, folio: entry.folioOperam, yaSubida: true, customer_id: entry.data?.cliente?.customerId ?? null });
    }
    // Alta temprana de cliente generico (#81, ADR-0006): sin cliente en Operam se
    // crea uno con RFC generico y la cotizacion nace a su nombre. customerId en el
    // body = el vendedor resolvio la dedup de nombre eligiendo un candidato
    // (ADR-0001). Con customerId o RFC real en la cotizacion -- o sin los datos
    // minimos del contacto (nombre + telefono) -- el camino de siempre.
    // crearNuevo (#204) = el vendedor vio los candidatos y dijo "ninguno es el
    // mismo cliente". Solo tiene efecto en la parada por nombre; con customerId
    // en el mismo body manda el elegido (reutilizar es el desenlace seguro).
    // sucursalDe (#211) = el vendedor vio los candidatos y dijo "es sucursal de
    // este cliente": mismo cliente existente que al elegirlo, mas una sucursal
    // nueva con el domicilio de entrega. Entra por el mismo camino y con las
    // mismas guardas; con customerId en el mismo body manda el elegido.
    const customerIdElegido = req.body?.customerId ?? null;
    const crearNuevo = req.body?.crearNuevo === true;
    const sucursalDe = req.body?.sucursalDe ?? null;
    if (customerIdElegido != null || sucursalDe != null || necesitaAltaGenerica(entry)) {
      // await: el finally debe liberar el lock hasta que la operacion termine.
      return await subirConAltaGenerica(res, id, entry, customerIdElegido, crearNuevo, sucursalDe);
    }
    try {
      const folio = await subirCotizacionOperam(entry.data);
      // Persistir el folio: la cotizacion deja de ser pre-cotizacion (#63).
      if (folio != null && folio !== '') {
        await cotStore.setFolioOperam(id, folio);
        // Huella de lo que quedo en el quote (#114): sin ella la proxima regeneracion
        // no puede saber si el contenido cambio, que es lo que decide si hay que
        // reescribir el quote o dejarlo en paz.
        await cotStore.actualizarDatos(id, { huellaQuote: huellaContenidoQuote(entry.data) });
        await marcarMotivoPre(id, null);
      }
      const pasoVigencia = await postFixVigencia(folio, entry.data);
      res.json({ ok: true, folio, steps: pasoVigencia ? [pasoVigencia] : [] });
    } catch (err) {
      // Cliente no identificado (#68): es un problema de datos de la cotizacion,
      // no de disponibilidad de Operam. 422 con el mensaje claro, sin subir.
      if (/identificar el cliente/i.test(err.message)) {
        return res.status(422).json({ error: err.message });
      }
      // PRE por Operam (#204): el documento SIGUE saliendo, sin numero (ADR-0009).
      await marcarMotivoPre(id, MOTIVO_PRE_OPERAM);
      res.status(503).json({ error: 'No se pudo subir a Operam: ' + err.message });
    }
  } finally {
    subidasOperamEnCurso.delete(id);
  }
});

// Actualizar la cotizacion ya registrada conservando el folio (#104, ADR-0008).
// El REGISTRO del cotizador ya lo actualizo la generacion del documento
// (crearOActualizarCotizacion honra cotizacionId): aqui solo se reescribe el quote
// en Operam, que no tiene PUT en la API v3 (501) y solo se puede editar por la web
// legacy. Comparte el lock por id con la subida: una subida y una actualizacion en
// vuelo sobre la misma cotizacion se pisarian el carrito de FA.
//
// Si la edicion falla, el registro del cotizador NO se revierte -- es la fuente del
// PDF/HTML que el cliente ya tiene -- y la cotizacion queda marcada con
// data.quoteDesactualizado para que el historial ofrezca reintentar (analogo al
// estado PRE de la subida). Por eso un fallo responde 200 con ok:false y no 5xx:
// no es que la peticion fallara, es que Operam quedo desalineado y hay que avisarlo
// con detalle, incluido si se alcanzo a escribir (`escrito`).
app.post('/api/cotizacion/operam/:id/actualizar', authMiddleware, async (req, res) => {
  const id = parseInt(req.params.id);
  if (subidasOperamEnCurso.has(id)) {
    return res.status(425).json({ error: 'Ya hay una operacion de Operam en curso para esta cotizacion; espera a que termine y revisa el estado' });
  }
  subidasOperamEnCurso.add(id);
  try {
    const entry = await cotStore.obtener(id);
    if (!entry) return res.status(404).json({ error: 'Cotizacion no encontrada' });
    // El gate es el MISMO que decide los botones en el historial, pero la autoridad
    // esta aqui: la UI no es la que permite escribir en el ERP.
    const gate = puedeActualizarCotizacion({
      hasData: !!entry.data,
      folioOperam: entry.folioOperam,
      orderOperam: entry.data?.orderOperam ?? null,
    });
    if (!gate.puede) return res.status(409).json({ error: gate.motivo });

    const r = await actualizarQuoteOperam(entry.folioOperam, entry.data);
    if (r.ok) {
      // Nueva huella (#114): el quote acaba de quedar con ESTE contenido, asi que
      // regenerar el mismo carrito (otro formato) ya no debe reescribir nada.
      await cotStore.actualizarDatos(id, { quoteDesactualizado: null, huellaQuote: huellaContenidoQuote(entry.data) });
      return res.json({ ok: true, folio: entry.folioOperam, actualizada: true, steps: [{ name: 'actualizar quote', status: 'ok' }] });
    }
    const marca = {
      fecha: new Date().toISOString(),
      escrito: !!r.escrito,
      error: r.error ?? null,
      discrepancias: r.discrepancias ?? [],
    };
    await cotStore.actualizarDatos(id, { quoteDesactualizado: marca });
    return res.json({
      ok: false, folio: entry.folioOperam, actualizada: false,
      escrito: !!r.escrito, verificado: !!r.verificado,
      error: r.error ?? null, discrepancias: r.discrepancias ?? [],
      steps: [{ name: 'actualizar quote', status: 'error', error: r.error ?? null, discrepancias: r.discrepancias ?? [] }],
    });
  } finally {
    subidasOperamEnCurso.delete(id);
  }
});

// --- Webhook de Operam: sync post-venta (#62) ---
// Operam dispara webhooks salientes (admin/web_hooks.php) en cada Pago / Pedido /
// Remision. El webhook es solo una SENAL: aqui NO se confia en su payload (formato
// aun no fijado); se loguea idempotentemente, se extrae un identificador de forma
// defensiva y la RECONCILIACION lee el estado real por API y mueve la tarjeta.
// Auth por header secreto (Operam no tiene el JWT del cotizador). Responde 200
// aunque no se ligue a una oportunidad o Operam este caido (no truena el webhook).
app.post('/api/webhooks/operam', async (req, res) => {
  const secret = process.env.OPERAM_WEBHOOK_SECRET;
  const recibido = req.headers['x-operam-webhook-secret'];
  if (!secret || recibido !== secret) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  const payload = req.body || {};
  let event_key = null;
  try {
    // Log idempotente: si el evento ya se registro, no reprocesar (la monotonia del
    // nucleo tambien lo cubre, pero asi se evita la lectura/escritura de mas).
    const reg = await registrarEventoWebhook(payload);
    event_key = reg.event_key;
    if (!reg.nuevo) {
      return res.json({ ok: true, duplicado: true, reconciliadas: [] });
    }
  } catch (err) {
    console.error('[webhook][operam] log:', err.message);
  }

  let reconciliadas = [];
  try {
    const identificador = extraerIdentificador(payload);
    const oportunidades = await cotStore.listar();
    reconciliadas = await reconciliarPorIdentificador(identificador, oportunidades);
  } catch (err) {
    // Operam caido / lectura fallida: el webhook no truena. La reconciliacion
    // on-demand (al abrir Pipeline/Hoy) es la red de seguridad.
    console.error('[webhook][operam] reconciliacion:', err.message);
  }
  if (event_key) {
    marcarProcesado(event_key, `reconciliadas:${reconciliadas.length}`)
      .catch(err => console.error('[webhook][operam] marcar:', err.message));
  }
  res.json({ ok: true, reconciliadas });
});

// Reconciliacion on-demand (#62 F4): red de seguridad por si un webhook se pierde
// o no esta configurado. Recorre SOLO las oportunidades activas no terminadas con
// RFC (las candidatas a tener movimiento post-venta en Operam), lee la verdad por
// API y mueve las que avanzan. Autenticada con el JWT del cotizador. Best-effort:
// el fallo de una oportunidad no aborta el resto.
app.post('/api/sync-operam', authMiddleware, async (req, res) => {
  let cotizaciones = [];
  try {
    cotizaciones = await cotStore.listar();
  } catch (err) {
    return res.status(503).json({ error: 'No se pudieron leer las cotizaciones: ' + err.message });
  }
  const candidatas = cotizaciones.filter(c =>
    esActivaPostVentaCandidata(c) && c?.data?.cliente?.rfc
  );
  const movidas = [];
  for (const op of candidatas) {
    try {
      const r = await reconciliarOportunidad(op);
      if (r.movida) movidas.push({ id: op.id, etapa: r.etapa });
    } catch (err) {
      console.error('[sync-operam] oportunidad', op.id, err.message);
    }
  }
  res.json({ ok: true, revisadas: candidatas.length, movidas });
});

// --- CSF: proxy QR del SAT ---

app.post('/api/csf-from-url', authMiddleware, async (req, res) => {
  const { url } = req.body || {};
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'Falta url' });
  let parsed;
  try { parsed = new URL(url); } catch { return res.status(400).json({ error: 'URL invalida' }); }
  if (!/\.sat\.gob\.mx$/i.test(parsed.hostname) && parsed.hostname !== 'sat.gob.mx') {
    return res.status(400).json({ error: 'URL no pertenece al SAT' });
  }
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PeltreBot/1.0)' } });
    if (!r.ok) return res.status(502).json({ error: `SAT respondio ${r.status}` });
    const html = await r.text();
    const texto = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(tr|div|p|li|td|th)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"')
      .replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n').trim();
    res.json({ ok: true, texto, datos: parsearCSF(texto) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- CSF: parsear texto a estructura (sin JWT) ---

app.post('/api/parsear-csf', (req, res) => {
  const { texto } = req.body || {};
  if (!texto || typeof texto !== 'string') return res.status(400).json({ error: 'Falta texto' });
  const datos = parsearCSF(texto);
  if (!datos.rfc) return res.status(422).json({ ok: false, error: 'No se detecto un RFC en el texto' });
  res.json({ ok: true, datos });
});

// --- CSF: historial de auditoria ---

app.get('/api/log', authMiddleware, async (req, res) => {
  const rows = await dbQuery(
    'SELECT id, created_at, rfc, nombre, resultado, cliente_id, fuente, dropbox_ok, error_msg FROM clientes_log ORDER BY created_at DESC LIMIT 200'
  );
  if (rows === null) return res.status(503).json({ error: 'Base de datos no configurada' });
  res.json(rows.rows);
});

// --- CSF: actualizar cliente existente ---

app.put('/api/actualizar-cliente/:id', authMiddleware, async (req, res) => {
  const campos = req.body;
  if (!campos || Object.keys(campos).length === 0) {
    return res.status(400).json({ error: 'No se enviaron campos a actualizar' });
  }
  try {
    await actualizarClienteDirecto(req.params.id, campos);
    res.json({ ok: true });
  } catch (err) {
    res.status(503).json({ error: 'No se pudo actualizar en Operam: ' + err.message });
  }
});

// --- CSF: upgrade del cliente generico con los datos fiscales reales (issue #85, ADR-0006) ---
//
// Cuando llega la Constancia de Situacion Fiscal se hace PUT sobre el cliente generico
// existente (RFC real, razon social, regimen, domicilio fiscal), NUNCA un POST nuevo.
// Dos zonas de robustez:
//  - Gate anti-fusion: si el RFC real ya existe en Operam con OTRO cliente, frena (409)
//    sin escribir nada -- el prospecto resulto ser un cliente formal existente y la
//    fusion es manual. Si el match es el MISMO cliente (reintento) o no hay match, procede.
//  - Verificacion post-PUT: releer el cliente y comparar (quirk de Operam: PUT 200 que
//    ignora campos en silencio, ver CLAUDE.md cliente 457); los campos que no pegaron se
//    reportan en camposNoActualizados para que el vendedor los corrija en Operam.
const FUENTE_CSF_UPGRADE = 'csf-upgrade';

app.put('/api/actualizar-cliente-fiscal/:id', authMiddleware, async (req, res) => {
  const { csfDatos: csfDatosCrudo, pdf_base64 } = req.body || {};
  const rfc = (csfDatosCrudo && csfDatosCrudo.rfc || '').trim().toUpperCase();
  if (!rfc) return res.status(400).json({ error: 'Faltan los datos fiscales: el RFC es obligatorio' });
  const id = req.params.id;
  // El RFC normalizado (mayusculas) alimenta TANTO el gate anti-fusion como el PUT y
  // el log -- el flujo de dedup viejo (lib/deduplicacion.js) ya normaliza asi antes de
  // comparar; sin esto, un RFC capturado en minusculas podria no matchear un cliente
  // formal ya existente en Operam y colar una fusion silenciosa.
  const csfDatos = { ...csfDatosCrudo, rfc };

  // Gate anti-fusion (#85) via el verificador compartido de "RFC libre" (#207): mismo
  // criterio que el PATCH de clientes, para que no exista un camino debil que lo
  // contradiga. Comportamiento sin cambios respecto al gate anterior (buscarClientePorRFC
  // + comparacion manual): la suite UF1-UF6 es la red de seguridad.
  let verificacion;
  try {
    verificacion = await verificarRfcLibre(rfc, id);
  } catch (err) {
    return res.status(503).json({ error: 'Operam no disponible: ' + err.message });
  }
  if (verificacion.estado === 'otro') {
    logCliente(rfc, csfDatos.razonSocial, 'fusion-bloqueada', verificacion.dueno.cliente_id, FUENTE_CSF_UPGRADE, null, null);
    return res.status(409).json({
      error: 'Este RFC ya pertenece a otro cliente en Operam. Es una fusion manual: el prospecto resulto ser un cliente formal existente.',
      fusion: true,
      cliente: verificacion.dueno,
    });
  }

  // Tax ID extranjero (issue #95 regla 5) y actividades economicas de la CSF (issue
  // #171): ninguno tiene campo dedicado en la API v3, se componen sobre las notas
  // EXISTENTES del cliente (sin borrarlas). Requiere conocer esas notas ANTES del
  // PUT -- una relectura extra, solo cuando se capturo alguno de los dos (el camino
  // comun sin ninguno no paga este GET adicional).
  const hayActividades = Array.isArray(csfDatos.actividades) && csfDatos.actividades.length > 0;
  let notasActuales;
  if (csfDatos.taxIdExtranjero || hayActividades) {
    try {
      const clienteActual = await obtenerClientePorId(id);
      notasActuales = (clienteActual && clienteActual.notes) || '';
    } catch (err) {
      // Relectura fallida: null le dice a buildActualizarFiscalPayload que OMITA
      // notes (reconstruirlas desde '' pisaria notas reales del cliente). El Tax ID
      // y las actividades quedan sin aplicar y la verificacion post-PUT lo reporta.
      notasActuales = null;
      console.error('[csf-upgrade] relectura de notas fallo, Tax ID/actividades omitidos:', err.message);
    }
  }

  // El PUT responde con el eco de los campos que Operam acepto (#169): es la unica
  // senal del motivo real cuando un campo no pega, y la unica confirmacion posible
  // para los que el GET de detalle no expone (idcif, invoice_email).
  let ecoPut = null;
  try {
    ecoPut = await actualizarClienteDirecto(id, buildActualizarFiscalPayload(csfDatos, notasActuales));
  } catch (err) {
    logCliente(rfc, csfDatos.razonSocial, 'error', id, FUENTE_CSF_UPGRADE, null, err.message);
    return res.status(503).json({ error: 'No se pudo actualizar en Operam: ' + err.message });
  }

  // Post-fix del SEGMENTO por la web legacy (#172): la API v3 no puede escribir
  // segmento_id por ningun camino (sondeo en vivo, peltre-operam.md 12.5c), asi que se
  // repostea la ficha de cliente de FrontAccounting. El orden importa por partida doble:
  // corre DESPUES del PUT (que ya escribio el postal_code de la CSF, sin el cual FA
  // rechaza el guardado entero) y ANTES de la relectura (asi la verificacion ve el
  // segmento ya aplicado y deja de reportarlo). Un fallo aqui NO tumba el upgrade: el
  // PUT ya se aplico; el segmento queda sin escribir y la verificacion lo reporta con
  // el motivo real de la web en vez del generico.
  let motivoSegmentoWeb = null;
  if (csfDatos.segmentoId) {
    const r = await actualizarSegmentoClienteWeb(id, csfDatos.segmentoId);
    if (!r.ok) {
      motivoSegmentoWeb = `No se pudo escribir el segmento por la web de Operam: ${r.error}`;
      console.error('[csf-upgrade] post-fix web del segmento fallo:', r.error);
    }
  }

  // La relectura de verificacion es un paso APARTE del PUT: si el PUT ya tuvo exito
  // en Operam, un fallo aqui (red, o Operam devolviendo el cliente vacio) no debe
  // reportarse como "no se pudo actualizar" -- el dato SI quedo escrito, solo no se
  // pudo confirmar. Colapsar ambos pasos en un mismo catch contaminaba el log de
  // auditoria con 'error' para una escritura que en realidad tuvo exito.
  let camposNoActualizados = [];
  let verificacionFallida = false;
  try {
    const fresco = await obtenerClientePorId(id);
    if (!fresco) throw new Error('Operam no devolvio el cliente en la relectura');
    const diff = calcularDiffFiscal(fresco, csfDatos);
    camposNoActualizados = camposNoAplicados(diff, ecoPut);
    // El motivo generico ("Operam ignoro este campo en el PUT") es cierto pero inutil
    // cuando lo que fallo fue el post-fix web: ahi el motivo real (CP vacio, sesion
    // caducada) es lo unico que le dice al vendedor que hacer.
    const segmentoPendiente = motivoSegmentoWeb && camposNoActualizados.find(c => c.campo === 'segmento_id');
    if (segmentoPendiente) segmentoPendiente.motivo = motivoSegmentoWeb;
    // notes no esta en DIFF_FISCAL_CAMPOS (su valor "nuevo" depende de las notas
    // previas, no es un campo de comparacion directa) -- se verifica aparte: la
    // linea del Tax ID debe estar presente en las notas releidas.
    if (csfDatos.taxIdExtranjero) {
      const prefijo = `Tax ID: ${csfDatos.taxIdExtranjero}`;
      const notasFrescas = fresco.notes || '';
      if (!notasFrescas.includes(prefijo)) {
        camposNoActualizados.push({ campo: 'notes', label: 'Tax ID extranjero', anterior: notasFrescas, nuevo: prefijo });
      }
    }
    if (hayActividades) {
      const encabezadoActividades = csfDatos.csf_fecha
        ? `Actividades economicas (CSF ${csfDatos.csf_fecha}):`
        : 'Actividades economicas:';
      const notasFrescas = fresco.notes || '';
      if (!notasFrescas.includes(encabezadoActividades)) {
        camposNoActualizados.push({ campo: 'notes', label: 'Actividades economicas', anterior: notasFrescas, nuevo: encabezadoActividades });
      }
    }
  } catch (err) {
    verificacionFallida = true;
    console.error('[csf-upgrade] verificacion post-PUT fallo:', err.message);
  }

  if (pdf_base64) {
    import('./lib/dropbox.js').then(({ subirCsfDropbox }) =>
      subirCsfDropbox(pdf_base64, rfc, csfDatos.razonSocial)
        .catch(err => console.error('[dropbox]', err.message))
    );
  }
  // dropbox_ok en null (no true): la subida es fire-and-forget, igual que en
  // /api/crear-cliente -- en este punto no se sabe si de verdad se subio.
  logCliente(rfc, csfDatos.razonSocial, 'actualizado', id, FUENTE_CSF_UPGRADE, null, verificacionFallida ? 'La verificacion post-PUT fallo (el PUT si se aplico)' : null);
  res.json({ ok: true, customer_id: Number(id), camposNoActualizados, verificacionFallida });
});

// --- CSF: crear cliente desde datos de CSF ---

function logCliente(rfc, nombre, resultado, cliente_id, fuente, dropbox_ok, error_msg) {
  dbQuery(
    'INSERT INTO clientes_log (rfc, nombre, resultado, cliente_id, fuente, dropbox_ok, error_msg) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [rfc, nombre || null, resultado, cliente_id || null, fuente || null, dropbox_ok ?? null, error_msg || null]
  ).catch(err => console.error('[db] Error insertando log:', err.message));
}

// Conversion prospecto -> cliente (issue #42): si el telefono del cliente recien
// dado de alta matchea un prospecto por ultimos 10 digitos, el prospecto queda
// ligado al cliente y la conversion aparece en su historial. Fire-and-forget,
// mismo patron que Dropbox: un fallo del store jamas rompe el alta.
async function ligarProspectoACliente(cliente, customerId, vendedor) {
  const telefonos = [cliente.phone, cliente.celular_nota, cliente.entrega?.phone].filter(Boolean);
  for (const tel of telefonos) {
    const p = await prospectosStore.buscarPorCelular(tel);
    if (p) {
      await prospectosStore.ligarCliente(p.id, customerId, {
        tipo: 'cliente', cliente_id: customerId, nombre: cliente.CustName || '',
        fecha: new Date().toISOString(), vendedor,
      });
      return;
    }
  }
}

// Backstop del telefono en el alta (issue #176): la capa estricta del navegador
// AVISA y deja guardar con confirmacion, asi que un numero imposible para su
// pais puede llegar hasta aqui. El servidor NO lo rechaza -- fallar el alta por
// esta causa dejaria al vendedor con el cliente enfrente y sin salida, justo lo
// que la decision de producto descarto. Solo queda registrado para revision, con
// el mismo criterio (y la misma funcion) que la captura publica de mayoreo.
function marcarTelefonoSospechoso(cliente) {
  for (const tel of [cliente.phone, cliente.entrega?.phone].filter(Boolean)) {
    if (!numeroTelefonoEsPosible(tel)) {
      console.warn(`[telefono-sospechoso] alta ${cliente.tax_id}: ${tel}`);
    }
  }
}

function nombreSegmento(id) {
  return SEGMENTOS.find(s => String(s.id) === String(id))?.nombre || '';
}

// Solo las llaves que traen un valor capturado (issue #250). Mandar '' a Operam no es
// "no cambiar": es escribir vacio, y varios campos lo coercionan a 0.
function camposConValor(campos) {
  return Object.fromEntries(Object.entries(campos).filter(([, v]) => v !== '' && v !== null && v !== undefined));
}

app.post('/api/crear-cliente', authMiddleware, async (req, res) => {
  const cliente = req.body;
  if (!cliente?.tax_id) return res.status(400).json({ error: 'Falta el RFC (tax_id)' });
  marcarTelefonoSospechoso(cliente);
  const fuente = cliente.fuente || (cliente.pdf_base64 ? 'csf-upload' : 'cotizador');
  const steps = [];
  let customer_id = cliente.customer_id || null;
  let branch_id = cliente.branch_id || null;
  // customer_id ya viaja en el payload: puede ser reintento de un alta nueva (los
  // datos comerciales ya se mandaron en el POST /customers de ese mismo flujo) o un
  // cliente EXISTENTE elegido via deduplicacion (altaState.clienteExistente, issue #31)
  // -- en ese caso el POST /customers nunca corrio y sales_type/segmento_id/
  // timbrado_uso_cfdi seleccionados en la seccion 2 se perdian en silencio (issue #11,
  // gap confirmado en auditoria de #26). Reenviar esos campos via PUT /customers/:id
  // cierra ese gap y es idempotente para el reintento.
  //
  // Los dos casos NO son equivalentes y aqui se distinguen (issue #250): fundirlos
  // costo la configuracion del cliente 15 en produccion. Sobre un cliente EXISTENTE el
  // alta no esta terminando de configurar lo que acaba de crear, esta escribiendo
  // encima de lo que otro configuro -- el PUT del branch (REPLACE destructivo) se omite
  // por completo, mismo contrato que el gate `creadoNuevo` del alta generica. La marca
  // la pone el frontend (`cliente_existente`) porque es el unico que sabe de donde
  // salio el customer_id; sin ella, `customer_id` significa reintento.
  const customerIdYaConocido = !!customer_id;
  const esClienteExistente = cliente.cliente_existente === true;

  try {
    // Step 1: POST customer (skip if customer_id already known — reintento)
    if (!customer_id) {
      try {
        const resultado = await crearClienteConLock(cliente);
        if (resultado.duplicado) {
          // Salida temprana ANTES del post-fix del segmento (#186) a proposito: aqui no
          // se escribe NADA sobre el cliente encontrado -- el vendedor todavia no decidio
          // usarlo. Escribirle el segmento seria tocar un cliente ajeno sin su visto bueno.
          steps.push({ name: 'POST customer', status: 'ok', info: 'duplicado' });
          logCliente(cliente.tax_id, cliente.CustName, 'duplicado', resultado.cliente_id, fuente, null, null);
          return res.json({ ok: true, customer_id: resultado.cliente_id, branch_id, duplicado: true, steps });
        }
        customer_id = resultado.cliente_id;
        steps.push({ name: 'POST customer', status: 'ok' });
        if (cliente.pdf_base64) {
          import('./lib/dropbox.js').then(({ subirCsfDropbox }) =>
            subirCsfDropbox(cliente.pdf_base64, cliente.tax_id, cliente.CustName)
              .catch(err => console.error('[dropbox]', err.message))
          );
        }
      } catch (err) {
        steps.push({ name: 'POST customer', status: 'error', error: err.message });
        logCliente(cliente.tax_id, cliente.CustName, 'error', null, fuente, null, err.message);
        return res.json({ ok: false, customer_id, branch_id, steps });
      }
    } else {
      steps.push({ name: 'POST customer', status: 'ok', info: 'reintento' });
    }

    // Step 1b: PUT customer — sincronizar config comercial cuando el customer_id ya
    // era conocido al entrar (cliente existente via dedup, o reintento). No bloquea el
    // flujo si falla -- el domicilio (PUT branch) sigue siendo lo critico para terminar
    // el alta (issue #11).
    if (customerIdYaConocido) {
      // salesman NO viaja aqui (issue #187): es campo de la SUCURSAL en FrontAccounting,
      // no del cliente -- el PUT /customers/:id lo ignora porque a ese nivel no existe.
      // Se escribe donde vive, en el PUT /branches del Step 3. segmento_id se deja aunque
      // la API v3 tampoco lo persista (mismo criterio que #172): si algun dia Operam lo
      // arregla, empieza a funcionar solo.
      //
      // Un campo vacio NO es un dato (issue #250): los tres selects nacen en '' y sin
      // filtrarlos el PUT escribia ese vacio -- Operam lo coerciona (sales_type '' -> 0)
      // y el cliente pierde su configuracion. Vacio = "el vendedor no eligio", y de eso
      // no se sigue nada que escribir.
      const comercial = camposConValor({
        sales_type: cliente.sales_type,
        segmento_id: cliente.segmento_id,
        timbrado_uso_cfdi: cliente.timbrado_uso_cfdi,
      });
      if (!Object.keys(comercial).length) {
        steps.push({ name: 'PUT customer (config comercial)', status: 'omitido', info: 'Sin cambios de configuracion comercial' });
      } else {
        try {
          await actualizarClienteDirecto(customer_id, comercial);
          steps.push({ name: 'PUT customer (config comercial)', status: 'ok' });
        } catch (err) {
          steps.push({ name: 'PUT customer (config comercial)', status: 'error', error: err.message });
        }
      }
    } else {
      // Step 1c: PUT customer — persistir dimensiones en un alta NUEVA. El POST
      // /customers de Operam IGNORA dimension_id/dimension2_id (los guarda en 0,
      // verificado en vivo #74); solo un PUT /customers/:id los persiste. No bloquea
      // el flujo si falla -- el domicilio sigue siendo lo critico (issue #74).
      try {
        await actualizarClienteDirecto(customer_id, { dimension_id: 1, dimension2_id: 5 });
        steps.push({ name: 'PUT customer (dimensiones)', status: 'ok' });
      } catch (err) {
        steps.push({ name: 'PUT customer (dimensiones)', status: 'error', error: err.message });
      }
    }

    // Step 1d: post-fix del SEGMENTO por la web legacy (#186, mismo motivo que #172). Ni
    // el POST /customers del alta nueva ni el PUT del Step 1b escriben segmento_id: la
    // API v3 no lo persiste por NINGUN camino, asi que el segmento que el vendedor eligio
    // se perdia en silencio en las DOS ramas. Corre aqui, con el customer_id ya resuelto
    // y ANTES del branch, y NO bloquea: un fallo (tipicamente FA rechazando el formulario
    // entero por un CP vacio del cliente, trampa 1 de #172) no puede impedir el PUT del
    // branch, que es lo critico para terminar el alta -- mismo criterio del Step 1b.
    //
    // El `ok` es un exito TENTATIVO, no una relectura: no se agrega el GET extra porque
    // actualizarSegmentoClienteWeb ya lee la ficha antes de escribir (sabe si el segmento
    // ya era el correcto) y `leerErrorWeb` cubre el unico rechazo conocido de FA. Si algun
    // dia FA ignorara el campo en silencio, esto lo reportaria como ok -- ahi si haria
    // falta releer.
    if (cliente.segmento_id) {
      const r = await actualizarSegmentoClienteWeb(customer_id, cliente.segmento_id, { soloSinSegmento: true });
      if (r.ok) {
        // `conservado` no es un fallo: el cliente ya estaba clasificado y su segmento
        // manda sobre lo que se eligio en esta alta. Se reporta igual para que el vendedor
        // no crea que su seleccion se aplico.
        // `actual` es el id interno de Operam: al vendedor le sirve el nombre, que es lo
        // que el panel pinta junto a la paloma (#250).
        steps.push({ name: 'post-fix segmento (web)', status: 'ok', ...(r.conservado ? { info: 'conservado', actual: r.actual, actualNombre: nombreSegmento(r.actual) } : {}) });
      } else {
        // El motivo REAL de la web es lo unico que le dice al vendedor que hacer.
        console.error('[crear-cliente] post-fix web del segmento fallo:', r.error);
        steps.push({ name: 'post-fix segmento (web)', status: 'error', error: r.error });
      }
    }

    // Step 2: GET customer to resolve branch_id
    if (!branch_id) {
      try {
        branch_id = await obtenerBranchId(customer_id);
        steps.push({ name: 'GET branch_id', status: 'ok' });
      } catch (err) {
        steps.push({ name: 'GET branch_id', status: 'error', error: err.message });
        return res.json({ ok: false, customer_id, branch_id, steps });
      }
    } else {
      steps.push({ name: 'GET branch_id', status: 'ok', info: 'reintento' });
    }

    // Step 3: PUT branch - configure domicilio. SOLO sobre la sucursal que esta misma
    // alta creo (#250): el PUT es REPLACE y sobre un cliente existente pisa su domicilio
    // real -- nombre, vendedor, cuentas contables y br_post_address, varias de ellas
    // irrecuperables por API. Agregarle una plaza a un cliente existente es POST de
    // sucursal (#211), nunca este PUT.
    if (esClienteExistente) {
      steps.push({ name: 'PUT branch', status: 'omitido', info: 'Cliente existente: se conserva su domicilio en Operam' });
    } else {
      try {
        const entrega = cliente.entrega || {};
        await actualizarBranchCliente(customer_id, branch_id, {
          ...entrega,
          pais: entrega.pais || cliente.pais || 'MX',
          salesman: cliente.salesman,
        });
        steps.push({ name: 'PUT branch', status: 'ok' });
      } catch (err) {
        steps.push({ name: 'PUT branch', status: 'error', error: err.message });
        logCliente(cliente.tax_id, cliente.CustName, 'error', customer_id, fuente, null, err.message);
        return res.json({ ok: false, customer_id, branch_id, steps });
      }
    }

    logCliente(cliente.tax_id, cliente.CustName, 'creado', customer_id, fuente, null, null);
    ligarProspectoACliente(cliente, customer_id, req.user.name)
      .catch(err => console.error('[prospectos] No se pudo ligar prospecto a cliente:', err.message));
    res.json({ ok: true, customer_id, branch_id, duplicado: false, steps });
  } catch (err) {
    logCliente(cliente.tax_id, cliente.CustName, 'error', null, fuente, null, err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- CSF: buscar cliente por RFC ---

app.get('/api/buscar-cliente', authMiddleware, async (req, res) => {
  const { rfc } = req.query;
  if (!rfc) return res.status(400).json({ error: 'Falta el parametro rfc' });
  try {
    res.json(await buscarClientePorRFC(rfc));
  } catch (err) {
    res.status(503).json({ error: 'Operam no disponible: ' + err.message });
  }
});

app.get('/api/buscar-cliente-duplicado', authMiddleware, async (req, res) => {
  const { rfc, nombre, telefono } = req.query;
  if (!rfc) return res.status(400).json({ error: 'Falta el parametro rfc' });
  try {
    const rfcNorm = rfc.toUpperCase().trim();
    const esGenerico = RFC_GENERICOS.has(rfcNorm);
    // buscarClientesPorRfc y NO buscarClientes (#194): el ?search= de Operam
    // busca por nombre y no indexa el RFC, asi que este pool siempre llegaba
    // vacio y el endpoint respondia 'libre' aunque el cliente existiera.
    // Se consulta con rfcNorm (no con el crudo): el RFC llega tal cual lo capturo
    // el vendedor y es el mismo valor con el que se compara el tax_id de vuelta.
    const raw = await buscarClientesPorRfc(rfcNorm);
    // Issue #78: si el RFC de entrada es real y no trae un match exacto, el
    // cliente pudo darse de alta antes sin CSF (RFC generico). Ese cliente es
    // INVISIBLE a la busqueda anterior porque tiene OTRO tax_id -- se busca
    // aparte por cada RFC generico y se le da a detectarDuplicados el pool
    // combinado para que aplique nombre/telefono.
    const listas = [raw];
    if (!esGenerico && !raw.some(c => (c.tax_id || '').toUpperCase().trim() === rfcNorm)) {
      listas.push(...(await Promise.all([...RFC_GENERICOS].map(g => buscarClientesPorRfc(g)))));
    }
    const clientes = poolClientesParaDedup(listas);
    const resultado = detectarDuplicados(rfc, nombre || '', clientes, telefono || '');
    res.json(resultado);
  } catch (err) {
    res.status(503).json({ error: 'Operam no disponible: ' + err.message });
  }
});

// El permiso de asignacion viaja con los catalogos (#156) porque es la misma
// pregunta que la pantalla hace al pintar el tablero y la cola Hoy: "a quien
// puedo asignar" y "puedo asignar". El servidor lo vuelve a hacer valer en cada
// escritura (asignacionMiddleware): esto solo decide que control se pinta.
app.get('/api/catalogos', authMiddleware, async (req, res) => {
  try {
    // Una sola lectura del registro para las dos respuestas: el catalogo y el
    // permiso del solicitante salen de la misma lista.
    const registro = await vendedoresStore.listar();
    const vendedores = registro
      .filter(v => v.operam_id != null)
      .map(v => ({ id: v.id, name: v.name, operam_id: v.operam_id }));
    const yo = registro.find(v => v.id === req.user?.id);
    // Evento activo y liga del catalogo (issue #261): viajan aqui porque es la
    // pregunta que la pantalla hace al arrancar -- si hay evento ofrece la
    // captura de expo, si no, la app se ve como siempre. `asesores` es el
    // registro COMPLETO (no el filtrado por operam_id de `vendedores`): en la
    // expo se captura a nombre de quien todavia no tiene id de Operam.
    const config = configStore.leer() || {};
    // La fecha prellenada del siguiente contacto (#263) se DERIVA del fin del
    // evento aqui, no se guarda: si el admin corrige la fecha de cierre, la
    // sugerencia se mueve sola. Es el primer dia habil despues de la feria.
    const evento = eventoActivoConfigurado();
    res.json({
      segmentos: SEGMENTOS, vendedores, listas_precios: await obtenerListasPrecios(),
      puedeAsignar: puedeAsignar({ role: req.user?.role, puedeAsignar: yo?.puedeAsignar }),
      eventoActivo: evento && { ...evento, siguienteContactoSugerido: primerDiaHabilDespues(evento.fin) },
      catalogoUrl: config.catalogoUrl || '',
      sitioUrl: config.sitioUrl || '',
      asesores: registro.map(v => v.name),
    });
  } catch (err) {
    res.status(500).json({ error: 'Registro de vendedores no disponible: ' + err.message });
  }
});

app.get('/admin', (req, res) => {
  res.sendFile(join(PUBLIC_DIR, 'admin.html'));
});

// Pagina publica de captacion de mayoreo (issue #157). Sin auth a proposito: es
// la cara que ve el prospecto desconocido, enlazada desde la pagina de mayoreo
// de la tienda. El catch-all de abajo devolveria index.html (el cotizador).
//
// El sitekey de Turnstile (issue #162, ADR-0012 pto. 2) se inyecta aqui via
// TURNSTILE_SITE_KEY: el HTML del repo nunca lleva la llave escrita. Sin la
// var (dev local, que no tiene llaves de Turnstile) los dos marcadores quedan
// vacios: no se pinta el widget y NO se carga el script de Cloudflare -- el
// formulario funciona igual, sin verificacion (server.js valida esto mismo del
// lado de POST /api/prospectos/publico via lib/turnstile.js).
app.get('/mayoreo', (req, res) => {
  const html = readFileSync(join(PUBLIC_DIR, 'mayoreo.html'), 'utf8');
  const siteKey = process.env.TURNSTILE_SITE_KEY;
  // Escapa comillas al interpolar en el atributo: la env var es de confianza
  // hoy, pero un HTML armado por interpolacion cruda no deberia asumirlo.
  const widget = siteKey
    ? `<div class="cf-turnstile" data-sitekey="${siteKey.replace(/"/g, '&quot;')}"></div>`
    : '';
  // Excepcion deliberada a la regla de vendoreo (ADR-0012 pto. 2, CLAUDE.md):
  // Cloudflare PROHIBE autohospedar o proxiar este script -- rota sus defensas
  // anti-bot sin aviso. Es la UNICA dependencia de terceros en runtime del
  // formulario. No lo vendorees.
  const script = siteKey
    ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>'
    : '';
  res.type('html').send(
    html.replace('<!--TURNSTILE_WIDGET-->', widget).replace('<!--TURNSTILE_SCRIPT-->', script)
  );
});

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(join(PUBLIC_DIR, 'index.html'));
});

async function cargarListasPrecios() {
  try {
    // listarSalesTypes ya pasa por apiCall (lib/operam-client.js): bearer con
    // auto-refresh, reintento/backoff anti-429 y el status + cuerpo del error en
    // el mensaje cuando Operam no contesta 200. El login propio de antes no
    // miraba el status: un 429 (pagina HTML de rate limit) reventaba el r.json()
    // con "Unexpected token '<'", un mensaje que no dice ni el status ni la causa.
    const tipos = await listarSalesTypes();
    // Operam v3 (verificado en vivo 2026-06-17): la etiqueta viene en `sales_type`
    // (texto libre: M100, "Precio de lista", "Segundas", "Amazon"...) y el id
    // numerico en `id` -- que es lo que el cliente guarda en su campo sales_type.
    // El selector debe mostrar la etiqueta y mandar el id numerico. Se exponen
    // todas las listas activas: el filtro se queda aunque listarSalesTypes() sin
    // showInactive ya las excluya del lado del servidor -- es la unica barrera si
    // alguien cambia ese default a showInactive:true (Bazaar/Shopify/Globarco
    // siguen inactivas con clientes vivos ya asignados, docs/arquitectura.md).
    listasPrecios = tipos
      .filter(t => t.inactive !== '1' && t.inactive !== 1)
      .map(t => ({ id: t.id, nombre: t.sales_type }));
  } catch (err) {
    // Un fallo NO pisa una lista ya cargada (#246): resolverSalesTypeId corre
    // dentro del request de subida del vendedor, y con [] omite sales_type en
    // silencio (Operam aplica su default M550, el peor caso). Si nunca cargo
    // sigue en [] (su valor inicial); si ya habia una lista buena, se queda.
    console.error('[catalogos] No se pudieron cargar listas_precios:', err.message);
  }
}

// Recarga perezosa (#246): un fallo de arranque (p.ej. Operam en 429 por minutos)
// dejaba listasPrecios = [] de por vida -- la unica carga corria una vez dentro
// del guard isMain. Cualquier consumidor llama obtenerListasPrecios() en vez de
// leer listasPrecios directo; si esta vacia, reintenta con dos guardas: (a) una
// sola carga en vuelo a la vez (los consumidores concurrentes reusan la misma
// promesa), (b) enfriamiento entre intentos fallidos para no martillar a Operam
// cuando esta caido (un 429 en rafaga empeoraria el bloqueo, ver backoff429Base).
let cargaListasEnCurso = null;
let ultimoFalloListas = 0;
let enfriamientoListasMs = 60000;
export function _setEnfriamientoListasMs(ms) { enfriamientoListasMs = ms; }
export function _resetListasPrecios() {
  listasPrecios = [];
  cargaListasEnCurso = null;
  ultimoFalloListas = 0;
}
export async function obtenerListasPrecios() {
  if (listasPrecios.length > 0) return listasPrecios;
  if (Date.now() - ultimoFalloListas < enfriamientoListasMs) return listasPrecios;
  if (!cargaListasEnCurso) {
    cargaListasEnCurso = cargarListasPrecios().finally(() => { cargaListasEnCurso = null; });
  }
  await cargaListasEnCurso;
  if (listasPrecios.length === 0) ultimoFalloListas = Date.now();
  return listasPrecios;
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  // La configuracion del panel (#276) se sirve de una cache en memoria porque
  // sus lectores son sincronos: se calienta ANTES de escuchar para que el
  // primer request ya vea lo guardado en Neon y no la semilla del archivo.
  configStore.cargar()
    .catch(err => console.warn('[config-store] warm de arranque fallo:', err.message))
    .then(() => cargarListasPrecios())
    .then(() => {
      app.listen(PORT, () => console.log(`Cotizador corriendo en http://localhost:${PORT}`));
    });
  // Calienta el indice de telefonos de Operam al arrancar (issue #73 parte 2): el
  // refresh tarda ~7s (440 clientes) y el lookup en cache frio se rinde a los 5s, por
  // eso el PRIMER formulario no reconocia al cliente existente. Eager + fire-and-forget:
  // para cuando el vendedor busca, el indice ya esta caliente. Un fallo no bloquea el
  // arranque (matchCliente ya degrada a "libre" si el indice no esta).
  refrescarIndice().catch(err => console.warn('[indice-telefonos] warm de arranque fallo:', err.message));
  // Aviso UNA VEZ al arrancar (issue #162), no por request: la verificacion en
  // POST /api/prospectos/publico se omite mientras falte la llave.
  if (!turnstileConfigurado()) {
    console.warn('[turnstile] TURNSTILE_SECRET_KEY no configurada: la verificacion se omite (dev)');
  }
  // Barrido de cotizaciones detenidas por duplicado sin resolver (#204): al
  // arrancar y cada hora. Como el lock subidasOperamEnCurso y la cola de
  // post-fixes de vigencia, ASUME UNA SOLA INSTANCIA (Render plan Starter): con
  // varias, todas barrerian a la vez sobre la misma tabla. Es idempotente (borrar
  // dos veces el mismo id no hace dano), asi que el peor caso concurrente es
  // trabajo repetido, no corrupcion. Fire-and-forget: un fallo no tumba el
  // arranque y el siguiente ciclo reintenta.
  const barrer = () => barrerCotizacionesDedupVencidas()
    .catch(err => console.error('[dedup] barrido periodico fallo:', err.message));
  barrer();
  setInterval(barrer, 3600 * 1000).unref();

  // Sincronizacion de prospectos y clientes a la libreta de Contactos de Google
  // (spec #224, tickets #227 y #228): quien atiende el WhatsApp comercial ve el
  // nombre de quien le escribe en vez de un numero pelado. Va aqui y NO en las rutas de alta a
  // proposito: cero ganchos en las ocho rutas que capturan prospectos o
  // clientes, para que un fallo de Google jamas altere una respuesta del
  // cotizador ni haga esperar al vendedor. La frescura se consigue con la
  // frecuencia del barrido, no interceptando escrituras.
  // UN solo timer para las dos fuentes, cada 15 minutos, y no uno propio para
  // los clientes: los prospectos viven en Neon y son baratos de leer, y los
  // clientes salen del cache del indice de telefonos, que solo relee Operam
  // cuando su TTL de una hora vence (#228). Es decir, el ritmo horario se
  // respeta sin un segundo reloj -- tres de cada cuatro pasadas no tocan Operam
  // y la cuarta reusa el listado que el indice iba a pedir de todas formas. Dos
  // timers ademas se pisarian en el mismo lock del barrido y darian dos
  // resumenes distintos al panel de admin.
  // Como el barrido de dedup, ASUME UNA SOLA INSTANCIA (el lock del barrido
  // vive en memoria, en lib/contactos-io.js).
  if (!googleConfigurado()) {
    // Aviso UNA VEZ al arrancar, como el de turnstile: sin las tres GOOGLE_* el
    // barrido no arranca y nada mas del cotizador se entera.
    console.warn('[contactos-google] Faltan GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN: la sincronizacion de contactos no corre');
  } else {
    // Observabilidad (#230): una sola llamada por pasada, en el mismo tick del
    // barrido. registrarBarridoContactos persiste el resultado y, si hace
    // falta, manda el correo de aviso -- nunca lanza, asi que no cambia el
    // try/catch de arriba. Va aqui y no en un setInterval propio: el barrido
    // ya corre cada 15 min bajo isMain con .unref() (linea de abajo), y eso
    // ya alcanza para detectar una autorizacion revocada sin agregar un
    // segundo timer.
    const barrerContactos = () => barrerContactosGoogle()
      .then(r => {
        registrarBarridoContactos('contactos', r);
        if (r.creados || r.actualizados || r.inactivados || r.errores.length) {
          console.log(`[contactos-google] creados=${r.creados} actualizados=${r.actualizados} inactivados=${r.inactivados} errores=${r.errores.length}`);
        }
      })
      .catch(err => console.error('[contactos-google] barrido periodico fallo:', err.message));
    barrerContactos();
    setInterval(barrerContactos, 15 * 60 * 1000).unref();
  }

  // Sondeo de pedidos de la tienda en linea (spec #254, ticket #255; ADR-0014):
  // llena la tabla pedidos_shopify, que es la TERCERA fuente del barrido de
  // arriba. Los dos son independientes a proposito -- corren en timers
  // distintos, con locks distintos, y el barrido de contactos lee la tabla y no
  // este sondeo: una tienda caida no puede frenar la sincronizacion de
  // prospectos ni de clientes.
  //
  // Cada hora y no cada quince minutos: quien compra en la tienda escribe al
  // WhatsApp horas o dias despues, no en el minuto siguiente, y cada corrida
  // gasta cuota de la API de Shopify. Sin webhook (ADR-0014).
  //
  // Como los otros barridos, ASUME UNA SOLA INSTANCIA (el lock vive en memoria,
  // en lib/pedidos-shopify-io.js).
  if (!shopifyConfigurado()) {
    console.warn('[pedidos-shopify] Falta SHOPIFY_API_TOKEN: el sondeo de pedidos de la tienda no corre');
  } else {
    const sondearPedidos = () => sondearPedidosShopify()
      .then(r => {
        // El resumen de este sondeo tiene forma PROPIA ({leidos, filas,
        // descartes}) y no la del barrido de contactos: registrarBarrido guarda
        // su fecha de corrida y sus errores -- que es lo que detecta un token
        // muerto o revocado -- y deja en cero creados/actualizados/inactivados,
        // que son de la otra forma. lib/pedidos-shopify-io.js ya agrega
        // r.totales ({leidos, filas, descartesPorMotivo}); lib/contactos-observabilidad.js
        // lo conserva sin conocer su forma y el panel de /admin lo pinta (#257).
        registrarBarridoContactos('shopify-pedidos', r);
        if (r.leidos || r.descartes.length || r.errores.length) {
          // El primer motivo va en el log: sin el, un token sin scope solo se
          // diagnostica entrando al panel (asi salio el ACCESS_DENIED de #255).
          const motivo = r.errores[0]?.motivo ? ` motivo=${String(r.errores[0].motivo).slice(0, 200)}` : '';
          console.log(`[pedidos-shopify] leidos=${r.leidos} filas=${r.filas} descartes=${r.descartes.length} errores=${r.errores.length}${motivo}`);
        }
      })
      .catch(err => console.error('[pedidos-shopify] sondeo periodico fallo:', err.message));
    // La primera corrida espera unos segundos: al arrancar ya compiten el warm
    // del indice de telefonos y el primer barrido de contactos, y este sondeo
    // no tiene ninguna prisa.
    setTimeout(sondearPedidos, 10 * 1000).unref();
    setInterval(sondearPedidos, 3600 * 1000).unref();
  }
}
export { app, cargarListasPrecios };
