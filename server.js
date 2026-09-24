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
import { buscarClientes, buscarClientesPorRfc, obtenerDomicilios, subirCotizacionOperam, actualizarClienteDirecto, buscarClientePorRFC, verificarRfcLibre, obtenerClientePorId, vigenciaDeCotizacion, huellaContenidoQuote, contenidoQuoteCambio, listarTodosClientes, listarPedidos, obtenerQuote, obtenerCliente, listarSalesTypes, listarPreciosCompletos, listarItemsCompletos, _setMinInterval } from './lib/operam-client.js';
import { corregirVigenciaQuote, actualizarQuoteOperam, actualizarSegmentoClienteWeb } from './lib/operam-web.js';
import { puedeActualizarCotizacion, ligaClienteAlGuardar, vendedorAlGuardar } from './public/js/cotizaciones-logica.js';
import { buscarClientesPorTexto } from './lib/indice-telefonos.js';
import { bodyDesdeDiffFiscal, camposNoAplicados, diffSinVaciadosComerciales, precargaComercialUpgrade, contactoCoincideBusqueda, normalizarOperam, normalizarProspecto } from './public/js/alta-logica.js';
import { necesitaAltaGenerica, resolverSalesTypeId } from './lib/alta-generica.js';
import { darDeAlta, upgradeFiscal } from './lib/alta-cliente.js';
import { logCliente, marcarDropbox } from './lib/clientes-log.js';
import { construirReporteHigiene } from './lib/higiene-clientes.js';
import { filasSegmentoPendiente } from './lib/segmento-pendiente.js';
import { reporteAlmacenDomicilios, excepcionesAlmacen, marcarAsiVaBien, desmarcarAsiVaBien } from './lib/almacen-domicilios.js';
import { barrerAlmacenesDomicilios, ultimoBarridoAlmacenes, avanceBarridoAlmacenes } from './lib/almacen-domicilios-io.js';
import { construirCatalogo, productosSinCaja } from './lib/catalogo-operam.js';
import { reconciliarPorIdentificador, reconciliarOportunidad, esActivaPostVentaCandidata } from './lib/sync-operam-io.js';
import { extraerIdentificador, registrarEvento as registrarEventoWebhook, marcarProcesado } from './lib/sync-operam-webhook.js';
import { detectarDuplicados, RFC_GENERICOS, esDebtorGenerico, normalizarRfc, tieneFormaDeRfc, poolClientesParaDedup } from './lib/deduplicacion.js';
import { construirEntradaCotizacion } from './lib/backfill-operam.mjs';
import { depositarCandidatos, MESES_VENTANA, fechaCorteMeses } from './lib/recolector-genericos.mjs';
import { folioMaximoConocido, planearDescubrimiento } from './lib/descubrimiento-operam.mjs';
import { GRACIA_DIAS } from './lib/cruce-identidad.js';
import { paisDeClienteOperam } from './lib/pais-operam.js';
import { parsearCSF } from './lib/parsear-csf.js';
import { esHostDelSat, htmlATexto, descargarValidadorQR } from './lib/sat-qr.js';
import { query as dbQuery } from './lib/db.js';
import { calcularCola, telefonoValido, telefonoWa } from './lib/seguimiento.js';
import { calcularColaProspectos } from './lib/seguimiento-prospectos.js';
import { filaTabla, cotizacionesDelProspecto } from './lib/tabla-prospectos.js';
import { calcularColaHoy } from './lib/cola-hoy.js';
import { tarjetasOportunidades, cotizacionesDeLaOportunidad, oportunidadesQueFaltaCotizar, prospectoAOportunidad } from './lib/oportunidades.js';
import { oportunidadesDeContactos, principalPorContacto, oportunidadQueCotiza } from './lib/oportunidad-pre.js';
import * as oportunidadPreIo from './lib/oportunidad-pre-io.js';
import { celularAlNacer, celularesDeCruce, llaveContacto } from './lib/contacto-cotizacion.js';
import { ligasDeContacto, conLigaDerivada, decidirLiga } from './lib/ligas-contacto.js';
// Los dos estados del Cliente Operam y las etiquetas del Contacto (#344,
// ADR-0016): derivados en el servidor desde lo que Operam registra, nunca
// capturados. El nucleo decide; lib/actividad-operam.js es quien lee y cachea.
import { anotarEstadosOportunidades, etiquetasDeContacto, clientesOperamLigados, indiceContactosPorCelular } from './lib/etiquetas-contacto.js';
import { filasBuscadorClientes } from './lib/buscador-clientes.js';
import { estadosDeClientes, estadosPorId, celularesEnLinea, refrescarActividad } from './lib/actividad-operam.js';
import { ultimos10 } from './lib/telefono-llave.js';
import * as cotStore from './lib/cotizaciones-store.js';
import * as prospectosStore from './lib/prospectos-store.js';
import * as oportunidadesStore from './lib/oportunidades-store.js';
import * as bandejaStore from './lib/bandeja-store.js';
import * as vendedoresStore from './lib/vendedores-store.js';
import * as configStore from './lib/config-store.js';
import * as modelosStore from './lib/modelos-store.js';
import { clasificarCelular } from './lib/clasificar-celular.js';
import { importarProspectosExpo } from './lib/importar-prospectos.js';
import { refrescarIndice, matchCliente, clientesCacheados, telefonosDeClienteOperam } from './lib/indice-telefonos.js';
import { primerDiaHabilDespues } from './lib/horas-habiles.js';
import { transicionPorCotizacion, transicionPorAsignacion, esSalida, documentoBloqueado, cotizacionesDedupVencidas, LEYENDA_DEDUP_PENDIENTE, MOTIVO_PRE_DEDUP, MOTIVO_PRE_OPERAM, MOTIVO_PRE_SIN_LISTA } from './lib/pipeline.js';
import { esErrorRateMoneda, ErrorClienteSinLista, MENSAJE_CLIENTE_SIN_LISTA, CODIGO_CLIENTE_SIN_LISTA } from './lib/lista-precios-cliente.js';
import { monedaDelCliente, ErrorClienteMonedaExtranjera, CODIGO_MONEDA_EXTRANJERA } from './public/js/moneda-cliente-logica.js';
import { puedeAsignar, normalizarPuedeAsignar } from './public/js/pipeline-logica.js';
import { validarProspectoBody, validarTransicion, contarMotivosNoUtil, reunionPendienteResultado, reunionPendienteResultadoDe, validarEdicionProspecto, buildEdicionProspectoDatos, CANALES, MOTIVOS_NO_UTIL, OPCIONALES as PROSPECTO_OPCIONALES, normalizarTextosProspecto, validarProspectoExpoBody, buildDatosExpo, validarCalificacion, buildCalificacion, validarSiguienteContacto, buildEventoSiguienteContacto } from './public/js/prospectos-logica.js';
import { PASOS_DECORADO, checklistInicial, marcarPaso, revertirPaso, progresoDecorado, puedeLiberar } from './public/js/decorados-logica.js';
// Origen heredado (#287): el MISMO nucleo puro que usa el navegador. El
// Historial y la cola Hoy no cargan prospectos, asi que la herencia se resuelve
// en su propio GET; nunca se persiste en la cotizacion.
import { indiceOrigenPorCelular, anotarOrigen } from './public/js/origen-logica.js';
import { piezasDeProducto, validarPreciosManualesCalca, aplicarPrecioManualEnPartidas, MOTIVOS_PRECIO_MANUAL, puedePrecioCalca, normalizarPuedePrecioCalca } from './public/js/calcas-logica.js';
import { topeDescuentoVendedor, validarDescuentosCotizacion, partidasConDescuento, normalizarTope } from './public/js/descuento-logica.js';
import { validarTierCotizacion, listasHabilitadasDeVendedor, normalizarListasHabilitadas, normalizarPuedeFijarLista, esEscalonDeVolumen, validarListaCliente, listaIdDeTier } from './public/js/tier-logica.js';
import { validarOperamIds } from './public/js/vendedores-logica.js';
import { validarDescripcionesCotizacion } from './public/js/descripcion-logica.js';
import { validarMayoreo, buildCapturaMayoreo } from './public/js/mayoreo-logica.js';
import { aTitulo } from './public/js/titulo-logica.js';
import { numeroTelefonoEsPosible } from './lib/telefono-posible.js';
import { permitirCaptura } from './lib/rate-limit-publico.js';
import { verificarTurnstile, turnstileConfigurado } from './lib/turnstile.js';
import { validarCP } from './lib/validar-cp.js';
import { buscarCP } from './lib/codigos-postales.js';
import { tarifasLalamove } from './lib/lalamove.js';
import { tarifasTresguerras } from './lib/tresguerras.js';
import { leerArchivoSync } from './lib/fs-reintento.js';
import { enviarAlertaMayoreo } from './lib/alerta-mayoreo-io.js';
import { barrerContactosGoogle } from './lib/contactos-io.js';
import { sondearPedidosShopify } from './lib/pedidos-shopify-io.js';
import { credencialesConfiguradas as shopifyConfigurado } from './lib/shopify-pedidos.js';
import { credencialesConfiguradas as googleConfigurado } from './lib/google-contactos.js';
import { registrarBarrido as registrarBarridoContactos } from './lib/contactos-observabilidad-io.js';
import { listarTodos as listarBarridosContactos } from './lib/contactos-observabilidad-store.js';
import { listarRecientes as listarSubidasDropbox } from './lib/dropbox-subidas-store.js';
import { estadoDeFlujos as estadoFlujosDropbox, lugarDeSubida as lugarSubidaDropbox } from './lib/dropbox-destinos.js';

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
// 10mb, el mismo tope que multer de aqui abajo (#350): el PDF de la CSF viaja en
// base64 DENTRO del JSON (alta completa y upgrade fiscal), y una constancia escaneada
// crece un tercio al codificarse. Con 1mb un alta con constancia pesada moria con 413
// antes de tocar la ruta -- el respaldo tumbando el alta, que es peor que no respaldar.
app.use(express.json({ limit: '10mb' }));
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

// Los ids de lista de Operam del catalogo vigente. Son DOS lecturas distintas y
// a proposito desde que el catalogo trae listas SIN escalon de volumen (#298):
// `listasDelCatalogo` son TODAS las que el catalogo sabe preciar -- las unicas
// fijables, y lo que el rol admin puede fijar -- y `listasVolumenDelCatalogo`
// solo los ESCALONES (los tiers con min_qty), que es el insumo de la migracion
// de lectura de #296: el flag de #153 otorgaba el tabulador, asi que migrarlo a
// "todas las listas del catalogo" le regalaria Segundas a quien nadie se la
// marco en la matriz. Salen del catalogo, no de una tabla copiada.
function tiersDelCatalogo() {
  return readJSON('precios.json')?.tiers || [];
}

function listasDelCatalogo() {
  return tiersDelCatalogo().map(t => t.listaId).filter(Boolean);
}

function listasVolumenDelCatalogo() {
  return tiersDelCatalogo().filter(esEscalonDeVolumen).map(t => t.listaId).filter(Boolean);
}

// La lista de precios que le toca al ENCABEZADO del quote (#403): la que se cotizo,
// no la que el cliente tiene en su ficha. Es el mismo `listaId` del catalogo por el
// que ya cruza el permiso (#296); null cuando el tier del registro no existe en el
// catalogo vigente -- entonces no se escribe nada y el post-fix lo reporta.
function listaDelQuote(entry) {
  return listaIdDeTier(tiersDelCatalogo(), entry?.tier);
}

// Permiso de lista VIGENTE del usuario autenticado (#296, ADR-0015): rol admin
// (todas) o las celdas de SU renglon de la matriz, ya migradas si el registro
// todavia trae el flag binario de #153. Mismo motivo que topeDescuentoDeUsuario
// para releerlo del registro y no del JWT: el token no se re-emite cuando el
// admin mueve una celda.
async function permisoListasDeUsuario(user) {
  const registro = (await vendedoresStore.listar()).find(v => v.id === user?.id);
  return {
    esAdmin: user?.role === 'admin',
    listasHabilitadas: listasHabilitadasDeVendedor(registro, listasVolumenDelCatalogo()),
  };
}

// Las listas que quien captura puede ASIGNARLE a un cliente (#300, ADR-0015):
// la misma matriz que gobierna la lista fijada de una cotizacion. El universo es
// otro a proposito -- aqui son las sales_types ACTIVAS de Operam, no los tiers del
// catalogo: a un cliente se le puede asignar una lista que el cotizador todavia no
// sabe preciar (quien precia ese campo es el ERP), y por eso el rol admin recibe
// todas las activas y no `listasDelCatalogo`.
async function listasAsignablesDeUsuario(user) {
  const permiso = await permisoListasDeUsuario(user);
  if (!permiso.esAdmin) return permiso.listasHabilitadas;
  return (await obtenerListasPrecios()).map(l => String(l.id));
}

// El veredicto del guardado en las DOS operaciones del cliente (alta y edicion):
// devuelve el mensaje del rechazo, o null si la lista puede viajar. El juicio vive
// en el nucleo puro; aqui solo se reunen sus tres insumos, y los dos caros se pagan
// SOLO en el camino raro (una lista que quien guarda no tiene habilitada):
//   - `leerActual` es la lista que el Cliente Operam tiene HOY, leida de OPERAM y
//     nunca del cuerpo de la peticion: conservarla siempre es valido, y creerle al
//     navegador seria dejar el permiso en manos de la pantalla. Sin lectura posible
//     (alta de un cliente nuevo, o Operam caido) no hay excepcion que aplicar.
//   - el nombre de la lista, para que el vendedor lea "Segundas" y no un id.
async function rechazoListaCliente(user, solicitada, leerActual) {
  const pedida = String(solicitada ?? '').trim();
  if (!pedida) return null;
  const permiso = await permisoListasDeUsuario(user);
  if (validarListaCliente({ solicitada: pedida, permiso }).ok) return null;
  let actual;
  try {
    actual = leerActual ? await leerActual() : undefined;
  } catch {
    actual = undefined;
  }
  const nombre = (await obtenerListasPrecios()).find(l => String(l.id) === pedida)?.nombre;
  const veredicto = validarListaCliente({ solicitada: pedida, actual, permiso, nombre });
  return veredicto.ok ? null : veredicto.mensaje;
}

// La lista de precios que el Cliente Operam tiene HOY, para la excepcion de arriba.
async function listaActualDeCliente(clienteId) {
  if (clienteId == null || clienteId === '') return undefined;
  return (await obtenerClientePorId(clienteId))?.sales_type;
}

// Permiso de capturar el precio de una calca (#280, spec #278), espejo exacto
// de permisoListasDeUsuario: se lee del registro en cada consulta, no del
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
    // El indice modelo -> familia del maestro de articulos (#312, ADR-0016)
    // viaja con el catalogo: el Resumen de la cotizacion se arma en el navegador
    // y agrupa por Familia de producto, asi que sin el indice no podria. Va
    // indexado por MODELO (los 4 primeros caracteres del SKU), que es la llave
    // del maestro.
    const familias = Object.fromEntries((await modelosStore.listar()).map(m => [m.modelo, m.familia]));
    // El tope y las listas habilitadas viajan con los precios porque son parte
    // del poder de precio del vendedor y la pantalla los refresca en cada
    // arranque de sesion (showApp). Desde #296 lo que viaja es la coleccion de
    // listas, no el flag binario de #153; el rol admin recibe todas las que el
    // catalogo sabe preciar, que son las unicas fijables.
    const permisoListas = await permisoListasDeUsuario(req.user);
    res.json({
      ...precios, config, familias,
      topeDescuento: await topeDescuentoDeUsuario(req.user),
      listasHabilitadas: permisoListas.esAdmin ? listasDelCatalogo() : permisoListas.listasHabilitadas,
      puedePrecioCalca: await puedePrecioCalcaDeUsuario(req.user),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function validarTelefonoCotizacion(req, res) {
  const tel = req.body?.cliente?.telefono;
  if (!tel) {
    res.status(400).json({ error: 'El telefono es obligatorio' });
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
async function pasarProspectoASeguimiento(contacto, cotizacionId, vendedor) {
  // #343: lo que avanza por el embudo es la OPORTUNIDAD del Contacto, no el
  // Contacto. Si no la moviera aqui, la tarjeta se quedaria en Por Cotizar y la
  // misma persona saldria dos veces en la cola Hoy. Con varias, la regla de cual
  // avanza vive en el nucleo puro (oportunidadQueCotiza), no aqui.
  const filas = oportunidadesDeContactos([contacto], await oportunidadesStore.listar());
  const op = oportunidadQueCotiza(filas, vendedor);
  const evento = {
    tipo: 'cotizacion', cotizacion_id: cotizacionId, de: op.etapa,
    fecha: new Date().toISOString(), vendedor,
  };
  const destino = transicionPorCotizacion(op.etapa);
  if (destino && destino !== op.etapa) await oportunidadPreIo.cambiarEtapa(op, destino, evento);
  else await oportunidadPreIo.registrarEvento(op, evento);
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
        // #394: la liga con el Cliente Operam es FIJA, asi que aqui no se
        // "rellena" lo que falte sino que manda la persistida. Editar desde el
        // historial mandaba el customerId del cliente que quedo en la sesion del
        // navegador y ese id ajeno pisaba el registro en silencio.
        const liga = ligaClienteAlGuardar(data.cliente, prevCli);
        if (liga.customerId != null) data.cliente.customerId = liga.customerId;
        if (liga.branchId != null) data.cliente.branchId = liga.branchId;
        if (liga.customerIdIgnorado != null) {
          console.warn('[liga] la cotizacion', idPrevio, 'esta ligada al Cliente Operam', liga.customerId,
            '- se ignoro el', liga.customerIdIgnorado, 'que llego al guardar');
        }
      }
      const yaEnOperam = prev.folioOperam != null && prev.folioOperam !== '';
      // La lista del encabezado entra a la comparacion desde #403: con el mismo
      // precio en dos listas nada mas se movia y el quote se quedaba con la vieja.
      const requiereActualizacionOperam = yaEnOperam && contenidoQuoteCambio(data, prev.data?.huellaQuote, { listaId: listaDelQuote(entry) });
      await cotStore.actualizarCotizacion(idPrevio, entry);
      return { id: idPrevio, requiereActualizacionOperam };
    }
  }
  // La Oportunidad nace ligada a su Contacto (#342, ADR-0016, CONTEXT.md
  // "Oportunidad"): el celular se anota AQUI, en el unico punto donde una
  // cotizacion nace, y ninguna regeneracion posterior lo recalcula -- el camino
  // de actualizacion de arriba ni siquiera lo menciona. Corregir un telefono mal
  // tecleado deja de mover la tarjeta a otra persona.
  entry.contactoCelular = celularAlNacer(data.cliente);
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
  // tier ajeno al tabulador solo pasa con rol admin o con ESA lista habilitada
  // en la matriz de quien guarda (#296), mismo patron que el tope de descuento
  // -- el permiso lo hace valer el servidor, no el selector oculto. El
  // tabulador del volumen ACTUAL no es la comparacion correcta al editar: se
  // compara contra el tier YA guardado.
  const precios = readJSON('precios.json');
  const tierValidado = validarTierCotizacion(precios?.tiers, piezasDeProducto(req.body?.items), req.body?.tier, await permisoListasDeUsuario(req.user), esDuenoDelPrevio ? (prevEntry.tier ?? null) : null);
  if (!tierValidado.ok) return res.status(403).json({ error: tierValidado.mensaje });
  try {
    const data = req.body;
    // El precio efectivo de una calca con captura ES el manual (#279): el
    // documento, el quote y la huella leen `precio`, asi que dejar el de lista
    // ahi cotizaria el estimado con el precio del proveedor guardado al lado.
    if (Array.isArray(data.items)) data.items = aplicarPrecioManualEnPartidas(data.items);
    // El Representante de Ventas del documento es el del REGISTRO, no quien
    // guarda (#405): editar la cotizacion de otro vendedor -- que es lo que
    // hace el admin desde el Historial -- no la reasigna. En una cotizacion
    // nueva (prevEntry null, tambien en Copiar) sigue siendo quien la crea.
    const vendedor = vendedorAlGuardar(prevEntry, req.user.name);
    data.vendedor = vendedor;
    const { id, requiereActualizacionOperam } = await crearOActualizarCotizacion(data, vendedor, prevEntry);
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
    const html = generateQuoteHTML(data, { incluirFotos: !!data.incluirFotos, id });
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
  // Origen heredado (#287): el Historial no carga prospectos, asi que la
  // herencia se resuelve aqui. El indice se arma con los prospectos VISIBLES
  // para quien pregunta, la misma puerta que usa el pipeline en el navegador
  // (GET /api/prospectos): las dos vistas dicen lo mismo del mismo cliente.
  const indiceOrigen = indiceOrigenPorCelular(await contactosVisiblesPara(req.user));
  res.json(anotarOrigen(filtradas.map(({ id, fecha, vendedor, cliente, totalPiezas, total, tier, data, estado, etapa, folioOperam, registroDesconocido, contactoCelular }) => ({
    id, fecha, vendedor, cliente, totalPiezas, total, tier,
    estado: estado || 'abierta',
    etapa,
    // El Contacto de la Oportunidad (#342): por AQUI se hereda el Origen, no por
    // el telefono tecleado, que es dato del documento y puede corregirse.
    contactoCelular: contactoCelular ?? null,
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
    // De quien es la cotizacion (#389): el Cliente Operam al que se subio y el RFC
    // con el que se subio. Con esto el panel "Cotizaciones previas" del paso Cliente
    // filtra por IDENTIDAD (cotizacionesPreviasDelCliente, alta-logica.js) en vez de
    // por los primeros 10 caracteres del nombre, que mezclaba clientes distintos.
    customerId: data?.cliente?.customerId ?? null,
    rfc: data?.cliente?.rfc ?? null,
    // Vigencia y partidas del Resumen de la cotizacion (#312): el texto lo arma
    // el navegador con el mismo nucleo que la cotizacion recien generada, y
    // desde el Historial estos son los dos datos que le faltaban. Los items van
    // PROYECTADOS a lo que el resumen agrupa -- el detalle completo (diseno,
    // descripcionEditada, precioManual) no tiene por que viajar en cada fila.
    vigencia: data?.vigencia ?? null,
    items: (data?.items ?? []).map(({ codigo, descripcion, cantidad, precio, descuento }) =>
      ({ codigo, descripcion, cantidad, precio, descuento })),
    hasData: !!data,
  })), indiceOrigen));
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
// tablero (oportunidadesVisiblesPara): solo llegan al admin y a quien tiene el
// permiso de asignacion. El nucleo (lib/cola-hoy.js) las incorpora si llegan y
// las pone al frente; quien no tiene el permiso simplemente no las recibe.
app.get('/api/hoy', authMiddleware, async (req, res) => {
  try {
    const cotizaciones = await cotStore.listar();
    const embudo = await embudoVisiblePara(req.user);
    const cotizacionesVisibles = req.user.role === 'admin'
      ? cotizaciones
      : cotizaciones.filter(c => c.vendedor === req.user.name);
    // Origen (#287): la cola llega fusionada del servidor, asi que aqui se anota
    // el heredado de las cotizaciones. El item de prospecto ya trae su `canal`.
    const cola = calcularColaHoy(embudo.oportunidades, cotizacionesVisibles, new Date());
    res.json(anotarOrigen(cola, indiceOrigenPorCelular(embudo.contactos)));
  } catch (err) {
    res.status(500).json({ error: 'No se pudo armar la cola de hoy: ' + err.message });
  }
});

// Endpoint unico de Oportunidades (#340, spec #337, ADR-0016, CONTEXT.md
// "Oportunidad"): TODAS las tarjetas visibles para quien pregunta, en todas las
// etapas y con una sola forma. El tablero deja de fusionar dos respuestas en el
// navegador -- de ahi salia la persona duplicada, con su tarjeta de prospecto
// inerte y la de su cotizacion avanzando.
//
// La visibilidad es la MISMA de siempre y por las MISMAS puertas: los prospectos
// por oportunidadesVisiblesPara (lo suyo, todo si es admin, y No Asignado con el
// permiso de asignacion) y las cotizaciones por el filtro del Historial. El
// Origen se hereda del Contacto con el indice de los prospectos visibles, igual
// que en el Historial y en la cola Hoy.
app.get('/api/oportunidades', authMiddleware, async (req, res) => {
  try {
    const cotizaciones = await cotStore.listar();
    const embudo = await embudoVisiblePara(req.user);
    const cotizacionesVisibles = req.user.role === 'admin'
      ? cotizaciones
      : cotizaciones.filter(c => c.vendedor === req.user.name);
    const tarjetas = tarjetasOportunidades(embudo.oportunidades, cotizacionesVisibles);
    // Los estados del Cliente Operam y las etiquetas del Contacto (#344): se
    // DERIVAN aqui, nunca se guardan. Todo es best effort -- si el cache de
    // Operam o la tabla de la tienda no responden, la tarjeta viaja sin
    // Cliente Operam y sin las etiquetas que dependan de ellos, jamas con una
    // etiqueta inventada.
    const contactos = indiceContactosPorCelular(embudo.contactos);
    // Los ids llevan tambien la liga persistida del propio Contacto
    // (`data.cliente_id`): un Contacto puede tener pedido bajo un Cliente
    // Operam que ninguna de sus tarjetas nombra (muchos a muchos, ADR-0016).
    const ligados = [...contactos.values()].flatMap(c => clientesOperamLigados(c));
    const [estados, enLinea] = await Promise.all([
      estadosPorId([...tarjetas.map(t => t.clienteOperamId), ...ligados]),
      celularesEnLinea(),
    ]);
    const conEstados = anotarEstadosOportunidades(tarjetas, { estados, contactos, enLinea });
    res.json(anotarOrigen(conEstados, indiceOrigenPorCelular(embudo.contactos)));
  } catch (err) {
    res.status(500).json({ error: 'No se pudieron listar las oportunidades: ' + err.message });
  }
});

// "Nueva oportunidad" desde la tarjeta o la ficha del Contacto (#343, spec #337,
// ADR-0016): un Contacto que ya cotizo vuelve a preguntar. Hasta este ticket ese
// interes no tenia donde vivir -- su celular ya era prospecto y no se podia
// capturar otra vez.
//
// NO pide origen (AC2): el Origen es del Contacto y solo de el (#287), y la
// tarjeta lo hereda como cualquier otra. El unico dato del cuerpo es el celular,
// que es la identidad del Contacto (CONTEXT.md "Contacto").
//
// La visibilidad es la de la captura: sobre el Contacto de otro vendedor no se
// abre nada, igual que hoy no se puede capturar su celular.
app.post('/api/oportunidades', authMiddleware, async (req, res) => {
  try {
    const celular = String((req.body || {}).celular || '').trim();
    if (!celular) return res.status(400).json({ error: 'El celular es obligatorio' });
    const contacto = await prospectosStore.buscarPorCelular(celular);
    if (!contacto) {
      return res.status(404).json({ error: 'Este celular todavia no es un Contacto: captura el prospecto' });
    }
    if (req.user.role !== 'admin' && contacto.vendedor && contacto.vendedor !== req.user.name) {
      return res.status(403).json({ error: `Este celular ya lo atiende ${contacto.vendedor}` });
    }
    const nueva = await oportunidadPreIo.abrirNuevaOportunidad(
      contacto, await cotStore.listar(), req.user.name, new Date());
    const filas = oportunidadesDeContactos([contacto], await oportunidadesStore.listar());
    const fila = filas.find(f => f.id === nueva.id);
    const [tarjeta] = anotarOrigen(
      [prospectoAOportunidad(fila)], indiceOrigenPorCelular([contacto]));
    res.status(201).json({ ok: true, oportunidad: tarjeta });
  } catch (err) {
    res.status(500).json({ error: 'No se pudo abrir la oportunidad: ' + err.message });
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

// El Contacto que nace sin captura (#342, AC5): existe para que una Oportunidad
// tenga de quien ser, no porque alguien lo haya prospectado. Sin etiqueta
// prospecto (la marca sinCaptura lo dice), sin Origen -- no llego por ninguna
// puerta -- y fuera del tablero: su Oportunidad es la cotizacion, no una tarjeta
// propia. Best effort: si el celular ya era Contacto no se crea nada, y un fallo
// aqui no tumba la liga, que es lo que el vendedor vino a hacer.
async function crearContactoSinCaptura(entry, celular, telefonoTecleado) {
  try {
    if (await prospectosStore.buscarPorCelular(celular)) return;
    const cli = entry.data?.cliente || {};
    await prospectosStore.crear({
      fecha: new Date().toISOString(), vendedor: entry.vendedor,
      celular: telefonoTecleado || celular,
      nombre: cli.nombreCorto || entry.cliente || 'Sin nombre',
      ciudad: cli.municipio || cli.estado || '',
      canal: '', etapa: 'seguimiento',
      data: {
        sinCaptura: true, fuenteContacto: 'captura_manual',
        ...(cli.customerId != null ? { cliente_id: cli.customerId } : {}),
      },
    });
  } catch (err) {
    console.warn('[contacto] no se pudo crear el Contacto de la cotizacion:', err.message);
  }
}

// Capturar a mano el Contacto de una Oportunidad que se quedo sin el (#342,
// spec #337, user story 22): la migracion resuelve la mayoria, pero una
// cotizacion historica sin telefono y sin nada en el indice de Operam queda
// "sin Contacto" a la vista, y el vendedor -- que si sabe de quien es -- le
// captura el celular desde la tarjeta. La liga sigue siendo FIJA: la guarda del
// store (setContactoCelular) no pisa una ya anotada, y aqui eso sale como 409
// con el celular que ya tiene, nunca como un cambio silencioso.
app.post('/api/cotizacion/:id/contacto', authMiddleware, async (req, res) => {
  const entry = await cotizacionOperable(req, res);
  if (!entry) return;
  const tecleado = req.body?.celular;
  const celular = llaveContacto(tecleado);
  if (!celular) {
    return res.status(400).json({ error: 'El celular del Contacto debe traer 10 dígitos' });
  }
  const ligado = await cotStore.setContactoCelular(entry.id, celular);
  if (!ligado) {
    return res.status(409).json({
      error: 'Esta cotización ya está ligada a un Contacto y esa liga no se mueve',
      contactoCelular: entry.contactoCelular ?? null,
    });
  }
  // Si ese celular todavia no es Contacto, nace aqui igual que en la migracion
  // (misma marca sinCaptura): ligar la Oportunidad a un celular sin ficha la
  // dejaria apuntando a nadie -- sin Origen que heredar y sin ficha que abrir.
  await crearContactoSinCaptura(entry, celular, tecleado);
  res.json({ ok: true, contactoCelular: celular });
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
  // Nombre confirmado por Adrian (#61): "<Nombre del proyecto> - Pedido <id>".
  // El "Nombre del proyecto" es la referencia de la cotizacion
  // (data.cliente.referencia); si falta, cae al cliente y luego al id. La
  // extension original se conserva. El destino ya no viaja aqui: es el flujo
  // `calca` de lib/dropbox-destinos.js (#357).
  const proyecto = String(entry.data?.cliente?.referencia || entry.cliente || `Pedido ${entry.id}`)
    .replace(/[/\\:*?"<>|]/g, '').trim() || `Pedido ${entry.id}`;
  import('./lib/dropbox.js').then(({ upload }) => {
    for (const a of archivos) {
      if (!a || !a.nombre || !a.contenidoBase64) continue;
      const ext = (String(a.nombre).match(/\.[a-zA-Z0-9]+$/) || [''])[0];
      const archivo = `${proyecto} - Pedido ${entry.id}${ext}`;
      upload({ flujo: 'calca', archivo }, Buffer.from(a.contenidoBase64, 'base64'), 'add')
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
// El guardrail de siempre (un celular = un Contacto) mas la salida que #343 le
// abre: en vez de dejar al vendedor sin nada que hacer con el interes nuevo de
// alguien que ya conocemos, la respuesta ofrece abrirle una Nueva oportunidad
// (POST /api/oportunidades con ese mismo celular). No se crea prospecto.
function respuestaProspectoExistente(res, existente, user) {
  const visible = user.role === 'admin' || existente.vendedor === user.name;
  return res.status(409).json(
    visible
      ? {
        error: 'Este celular ya es un prospecto', tipo: 'prospecto_propio', prospecto: existente,
        nuevaOportunidad: { celular: existente.celular },
      }
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
// el primer dia habil despues de la expo); apagarlo es del admin, para que la
// app nunca deje de ofrecer la captura a media expo por un reloj.
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

// El compromiso es de la OPORTUNIDAD (#343): se registra donde ella vive. La
// captura pasa `{ propia: false, id }` porque su Contacto recien creado todavia
// es su propia Oportunidad.
async function registrarSiguienteContactoDelBody(op, body, vendedor) {
  if (body.siguiente_contacto == null) return;
  await oportunidadPreIo.registrarEvento(op, buildEventoSiguienteContacto(body.siguiente_contacto, vendedor));
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
    // "Captura de expo"), no de cualquier captura hecha mientras hay expo: sin
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
  await registrarSiguienteContactoDelBody({ propia: false, id }, body, req.user.name);
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
// EL titulador del repo porque el form es crudo: sin eso la ficha diria
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
    nombrePila: aTitulo(form.nombre), apellido: aTitulo(form.apellido),
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
    await registrarCapturaPublica(clasificacion.prospecto, captura);
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
      await registrarCapturaPublica(dup, captura);
      dispararAlertaMayoreo(captura, form, fechaCaptura);
    }
  }
  return opaca();
});

// Evento en la tarjeta que ya existia: el prospecto volvio a levantar la mano por
// el formulario. Lleva lo que pidio esta vez (notas y piezas) para que el
// vendedor vea el cambio de intencion sin abrir nada mas.
async function registrarCapturaPublica(contacto, captura) {
  try {
    // #343: el evento va a la Oportunidad principal del Contacto, que es la
    // tarjeta que el vendedor tiene enfrente.
    const op = oportunidadPrincipalDe(contacto, await oportunidadesStore.listar());
    await oportunidadPreIo.registrarEvento(op, {
      tipo: 'captura_publica', fecha: new Date().toISOString(), canal: captura.canal,
      notas: captura.data.notas, piezas_estimadas: captura.data.piezas_estimadas,
    });
  } catch (err) {
    console.error('[mayoreo] no se pudo registrar el evento:', err.message);
  }
}

// La Oportunidad que representa hoy a un Contacto (#343): la misma regla de la
// lista de personas. Mientras la separacion no ha corrido es su propia fila.
function oportunidadPrincipalDe(contacto, oportunidades) {
  return principalPorContacto(oportunidadesDeContactos([contacto], oportunidades))[0];
}

// Visibilidad (CONTEXT.md): cada vendedor ve unicamente sus propias
// oportunidades; el admin ve todas. Las tarjetas No Asignado no son de nadie: las
// ve ademas quien tiene el permiso de asignacion (#156), y SOLO esas -- el
// permiso abre la columna sin dueno, nunca la cartera de otro vendedor.
//
// Desde #343 hay DOS listas visibles, porque la fila de prospectos dejo de ser
// una sola cosa (ADR-0016): los CONTACTOS (la persona, con su Origen) y sus
// OPORTUNIDADES pre-cotizacion (la intencion de compra, que es lo que se
// trabaja). Un Contacto puede tener varias.
// Una sola lectura del embudo por request: las rutas que necesitan las dos
// listas piden `embudoVisiblePara` y las que necesitan una sola usan su
// envoltura.
//
// Las Oportunidades se filtran por SU vendedor, no por el del Contacto: la
// tarjeta es de quien la trabaja. El Contacto es visible si es suyo o si alguna
// de sus Oportunidades lo es -- por eso la columna sin dueno se lee de la
// OPORTUNIDAD y no de la etapa que quedo congelada en la fila del Contacto tras
// la separacion. Mientras esta no ha corrido las dos reglas coinciden, asi que
// la visibilidad no cambia para nada de lo existente.
async function embudoVisiblePara(user) {
  const contactos = await prospectosStore.listar();
  const filas = oportunidadesDeContactos(contactos, await oportunidadesStore.listar());
  if (user.role === 'admin') return { contactos, oportunidades: filas };
  const asigna = await puedeAsignarDeUsuario(user);
  const oportunidades = filas.filter(o => o.vendedor === user.name || (asigna && o.etapa === 'no_asignado'));
  const conTarjetaVisible = new Set(oportunidades.map(o => o.contactoId));
  return {
    contactos: contactos.filter(c => c.vendedor === user.name || conTarjetaVisible.has(c.id)),
    oportunidades,
  };
}

async function contactosVisiblesPara(user) {
  return (await embudoVisiblePara(user)).contactos;
}

async function oportunidadesVisiblesPara(user) {
  return (await embudoVisiblePara(user)).oportunidades;
}

// Una fila por PERSONA (#343): el buscador del paso Cliente y la lista de
// prospectos hablan de Contactos, no de intenciones, y un Contacto con dos
// Oportunidades no puede volver a salir dos veces (ADR-0016). De cada uno viaja
// su Oportunidad principal, que es la que la tarjeta de la lista trabaja.
//
// #400: la fila viaja con la etiqueta "Ya tiene Cliente Operam, falta cotizar"
// ya juzgada (`faltaCotizar`). El navegador no puede calcularla -- la mitad de
// "todavia no cotiza" son las cotizaciones que este vendedor PUEDE VER --, y de
// la liga a secas salia sobre Contactos que el cotizador dio de alta AL cotizar.
app.get('/api/prospectos', authMiddleware, async (req, res) => {
  try {
    const filas = principalPorContacto(await oportunidadesVisiblesPara(req.user));
    // La MISMA visibilidad de GET /api/prospectos/tabla: se filtran por vendedor
    // antes de ligarlas, para que la senal no cuente ninguna cotizacion ajena.
    const cotizaciones = await cotStore.listar();
    const cotizacionesVisibles = req.user.role === 'admin'
      ? cotizaciones
      : cotizaciones.filter(c => c.vendedor === req.user.name);
    const faltan = oportunidadesQueFaltaCotizar(filas, cotizacionesVisibles);
    res.json(filas.map(p => ({ ...p, faltaCotizar: faltan.has(p.id) })));
  } catch (err) {
    res.status(500).json({ error: 'No se pudo listar prospectos: ' + err.message });
  }
});

// Tabla de prospectos (spec #306, CONTEXT.md "Tabla de prospectos"): una fila
// por Oportunidad pre-cotizacion visible con los campos derivados que la
// pantalla NO calcula. Desde #343 la fila es de la INTENCION, no de la persona:
// un Contacto que volvio a preguntar tiene dos renglones que trabajar.
// Registrada antes de cualquier ruta /api/prospectos/:id, como "cola".
app.get('/api/prospectos/tabla', authMiddleware, async (req, res) => {
  try {
    const ahora = new Date();
    const visibles = await oportunidadesVisiblesPara(req.user);
    // #319: las cotizaciones se filtran por la MISMA visibilidad que en
    // GET /api/hoy antes de ligarlas, para que un vendedor nunca vea por la
    // fila del prospecto la cotizacion de otro.
    const cotizaciones = await cotStore.listar();
    const cotizacionesVisibles = req.user.role === 'admin'
      ? cotizaciones
      : cotizaciones.filter(c => c.vendedor === req.user.name);
    res.json(visibles.map(p => filaTabla(p, cotizacionesDeLaOportunidad(p, cotizacionesVisibles), ahora)));
  } catch (err) {
    res.status(500).json({ error: 'No se pudo armar la tabla de prospectos: ' + err.message });
  }
});

// Cola de seguimiento (issue #44). Registrada antes de cualquier ruta
// /api/prospectos/:id para que "cola" nunca se interprete como un id.
//
// #400: la etiqueta "Ya tiene Cliente Operam, falta cotizar" del item sale del
// mismo juicio que la de la lista, con las cotizaciones ya filtradas por
// visibilidad (lo que GET /api/hoy hace dentro de lib/cola-hoy.js).
app.get('/api/prospectos/cola', authMiddleware, async (req, res) => {
  const visibles = await oportunidadesVisiblesPara(req.user);
  const cotizaciones = await cotStore.listar();
  const cotizacionesVisibles = req.user.role === 'admin'
    ? cotizaciones
    : cotizaciones.filter(c => c.vendedor === req.user.name);
  res.json(calcularColaProspectos(
    visibles, new Date(), oportunidadesQueFaltaCotizar(visibles, cotizacionesVisibles)
  ));
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
//
// Desde #343 el id de la ruta es el de la OPORTUNIDAD, no el del Contacto: es la
// intencion de compra lo que se trabaja. Mientras la separacion no ha corrido
// los dos ids coinciden (el Contacto sintetiza su propia Oportunidad), asi que
// ninguna liga existente cambia. Devuelve la Oportunidad fusionada y su Contacto:
// la edicion de datos escribe en la persona, todo lo demas en la intencion.
async function oportunidadOperable(req, res, { incluyeSinDueno = false } = {}) {
  const id = parseInt(req.params.id);
  const contactos = await prospectosStore.listar();
  const filas = oportunidadesDeContactos(contactos, await oportunidadesStore.listar());
  const op = filas.find(f => f.id === id);
  if (!op) {
    res.status(404).json({ error: 'No encontrado' });
    return null;
  }
  const contacto = contactos.find(c => c.id === op.contactoId);
  if (req.user.role === 'admin' || op.vendedor === req.user.name) return { op, contacto };
  if (incluyeSinDueno && op.etapa === 'no_asignado' && await puedeAsignarDeUsuario(req.user)) return { op, contacto };
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
  const operable = await oportunidadOperable(req, res);
  if (!operable) return;
  const { op, contacto } = operable;
  if (esSalida(op.etapa)) {
    return res.status(400).json({ error: 'No se edita un prospecto que ya salió del pipeline (No útil/Perdida)' });
  }
  const error = validarEdicionProspecto(req.body);
  if (error) return res.status(400).json({ error });
  // La edicion es el camino para completar despues la calificacion (#263): lo
  // que el stand no alcanzo a preguntar y lo que el importador no trae.
  const errorCalificacion = errorCalificacionYSiguienteContacto(req.body || {});
  if (errorCalificacion) return res.status(400).json({ error: errorCalificacion });
  // Los datos editables son de la PERSONA (nombre, ciudad, empresa, correo,
  // tipo): se escriben en el Contacto, no en la Oportunidad.
  await prospectosStore.actualizarDatos(contacto.id, normalizarTextosProspecto(buildEdicionProspectoDatos(req.body)));
  await registrarSiguienteContactoDelBody(op, req.body || {}, req.user.name);
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
    const id = parseInt(req.params.id);
    const contactos = await prospectosStore.listar();
    const op = oportunidadesDeContactos(contactos, await oportunidadesStore.listar()).find(f => f.id === id);
    if (!op) return res.status(404).json({ error: 'No encontrado' });
    const destino = transicionPorAsignacion(op.etapa);
    if (!destino) {
      return res.status(400).json({ error: 'Solo se asigna vendedor a una tarjeta en No Asignado' });
    }
    await oportunidadPreIo.asignarVendedor(op, contactos.find(c => c.id === op.contactoId), vendedor, destino, {
      tipo: 'asignacion', de: op.etapa, a: vendedor,
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
  const operable = await oportunidadOperable(req, res, { incluyeSinDueno: true });
  if (!operable) return;
  const { op } = operable;
  const error = validarTransicion(op.etapa, etapa, motivo, folio);
  if (error) return res.status(400).json({ error });
  const fecha = new Date().toISOString();
  // Mover a Seguimiento a mano (issue #56): el vendedor cotizo por fuera, asi
  // que el folio de Operam se guarda en el prospecto (data.folioOperam). La
  // regla de dominio (validarTransicion) ya valido que hay folio y que el origen
  // es Por Cotizar; aqui se persiste etapa + folio + evento juntos.
  if (etapa === 'seguimiento') {
    const folioLimpio = String(folio).trim();
    await oportunidadPreIo.moverASeguimientoConFolio(op, folioLimpio, {
      tipo: 'etapa', de: op.etapa, a: 'seguimiento', folio: folioLimpio, fecha, vendedor: req.user.name,
    });
    return res.json({ ok: true, etapa, folio: folioLimpio });
  }
  const evento = etapa === 'no_util'
    ? { tipo: 'no_util', motivo, fecha, vendedor: req.user.name }
    : { tipo: 'etapa', de: op.etapa, a: etapa, fecha, vendedor: req.user.name };
  await oportunidadPreIo.cambiarEtapa(op, etapa, evento);
  res.json({ ok: true, etapa });
});

app.post('/api/prospectos/:id/toques', authMiddleware, async (req, res) => {
  const operable = await oportunidadOperable(req, res);
  if (!operable) return;
  const eventos = await oportunidadPreIo.registrarEvento(operable.op, {
    tipo: 'toque', fecha: new Date().toISOString(), vendedor: req.user.name,
  });
  res.json({ ok: true, eventos });
});

// Reunion diagnostico (issue #45, CONTEXT.md "Captura de prospecto"): actividad
// con fecha, NO una etapa. Agendar registra el evento; re-agendar agrega otro
// (la ultima manda). La supresion de cadencia vive en el motor de la cola.
app.post('/api/prospectos/:id/reunion', authMiddleware, async (req, res) => {
  const operable = await oportunidadOperable(req, res);
  if (!operable) return;
  const { fecha } = req.body || {};
  const f = fecha ? new Date(fecha) : null;
  if (!f || isNaN(f)) return res.status(400).json({ error: 'La fecha de la reunión es obligatoria' });
  if (f <= new Date()) return res.status(400).json({ error: 'La fecha de la reunión debe ser futura' });
  await oportunidadPreIo.registrarEvento(operable.op, {
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
  const operable = await oportunidadOperable(req, res);
  if (!operable) return;
  const error = validarSiguienteContacto(req.body);
  if (error) return res.status(400).json({ error });
  await oportunidadPreIo.registrarEvento(operable.op, buildEventoSiguienteContacto(req.body, req.user.name));
  res.json({ ok: true });
});

// Resultado de la reunion pasada: en el pipeline unificado el avance pertinente
// lo dirige la cotizacion (Por Cotizar -> Seguimiento, otro issue); aqui el
// unico resultado que cierra el ciclo de la reunion es la salida a No util con
// motivo del catalogo (CONTEXT.md "Reunion de diagnostico": ya no avanza a
// Calificado, etapa eliminada por ADR-0005).
app.post('/api/prospectos/:id/reunion-resultado', authMiddleware, async (req, res) => {
  const { resultado, motivo } = req.body || {};
  const operable = await oportunidadOperable(req, res);
  if (!operable) return;
  const { op } = operable;
  if (!reunionPendienteResultado(op, new Date())) {
    return res.status(400).json({ error: 'No hay reunión pendiente de resultado' });
  }
  if (resultado === 'no_util') {
    if (!MOTIVOS_NO_UTIL.includes(motivo)) {
      return res.status(400).json({ error: 'El motivo de No útil es obligatorio (catálogo cerrado)' });
    }
    await oportunidadPreIo.cambiarEtapa(op, 'no_util', {
      tipo: 'no_util', motivo, fecha: new Date().toISOString(), vendedor: req.user.name,
    });
    return res.json({ ok: true, etapa: 'no_util' });
  }
  res.status(400).json({ error: 'Resultado inválido: no_util' });
});

app.get('/api/admin/prospectos/no-util', authMiddleware, adminMiddleware, async (req, res) => {
  const todos = oportunidadesDeContactos(
    await prospectosStore.listar(), await oportunidadesStore.listar());
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

// Los textos que el importador guardo antes de aplicar la regla de la casa
// quedaron como venian del gafete (MAYUSCULAS) y de ahi pasaron a la libreta de
// Google. Volver a subir el export los corrige. Es la UNICA excepcion a "lo
// capturado en el stand nunca se pisa", y se sostiene porque capitalizar no
// cambia el dato sino como esta escrito: la regla es la misma "venga de donde
// venga la captura" (#235/#269, y desde #293 con el titulador unico del repo
// via normalizarTextosProspecto). Sobre lo capturado a mano,
// que ya nacio normalizado, no escribe nada -- es idempotente. Las notas NO
// entran: son texto del vendedor, no identidad del prospecto.
function correccionDeTextos(existente, campos) {
  const fusionado = {
    nombre: existente.nombre,
    ciudad: campos.ciudad === undefined ? existente.ciudad : campos.ciudad,
    data: { ...(existente.data || {}), ...campos.data },
  };
  const limpio = normalizarTextosProspecto(fusionado);
  const correccion = {};
  if (limpio.nombre !== fusionado.nombre) correccion.nombre = limpio.nombre;
  if (limpio.ciudad !== fusionado.ciudad) correccion.ciudad = limpio.ciudad;
  const data = {};
  for (const k of ['empresa', 'correo']) {
    if (limpio.data[k] !== fusionado.data[k]) data[k] = limpio.data[k];
  }
  if (Object.keys(data).length) correccion.data = data;
  return correccion;
}

async function enriquecerConExport(existente, fila, evento, fecha) {
  const campos = { data: datosParaEnriquecer(existente.data || {}, fila.data) };
  if (campoVacio(existente.ciudad) && !campoVacio(fila.ciudad)) campos.ciudad = fila.ciudad;
  const correccion = correccionDeTextos(existente, campos);
  Object.assign(campos, correccion, { data: { ...campos.data, ...(correccion.data || {}) } });
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
    parseo = importarProspectosExpo(req.file.buffer, { vendedores, vendedorDefault, evento });
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
        descartados.push({ fila: p.fila, nombre: p.nombre, motivo: 'ya tiene Cliente Operam' });
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
  // correo repetido de otra expo no es la misma oportunidad). Se lee despues
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
// rechaza: con el nombre viaja el etiquetado de TODO lo que entra por la expo.
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

// La matriz de listas habilitadas se pinta con lo que este GET devuelve, asi
// que sale ya NORMALIZADA (#296): un registro que todavia trae el flag binario
// de #153 se lee con los escalones de volumen marcados, y el primer guardado
// materializa la migracion en vez de borrarle el permiso.
app.get('/api/admin/vendedores', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const listasVolumen = listasVolumenDelCatalogo();
    const registro = await vendedoresStore.listar();
    res.json(registro.map(v => ({ ...v, listasHabilitadas: listasHabilitadasDeVendedor(v, listasVolumen) })));
  } catch (err) {
    res.status(500).json({ error: 'Registro de vendedores no disponible: ' + err.message });
  }
});

app.put('/api/admin/vendedores', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const vendedores = req.body;
    if (!Array.isArray(vendedores)) return res.status(400).json({ error: 'Formato invalido' });
    // operam_id (#434): entero positivo o null, sin repetir; se valida ANTES
    // de reemplazar porque el reemplazo es del registro entero.
    const operamIds = validarOperamIds(vendedores);
    if (operamIds.error) return res.status(400).json({ error: operamIds.error });
    // El tope y el flag de fijar lista se normalizan al guardarlos (#137/#153):
    // un valor basura o fuera de rango capturado en la administracion nunca
    // puede volverse permiso ilimitado.
    await vendedoresStore.reemplazar(operamIds.vendedores.map(v => {
      if (!v) return v;
      const out = { ...v };
      if (v.topeDescuento !== undefined) out.topeDescuento = normalizarTope(v.topeDescuento);
      if (v.puedeFijarLista !== undefined) out.puedeFijarLista = normalizarPuedeFijarLista(v.puedeFijarLista);
      // Las celdas de la matriz (#296) viajan en el mismo PUT de reemplazo
      // completo: basura capturada ahi se guarda como sin permiso, nunca como
      // permiso implicito. La lista vacia SI se guarda (destildar todo es una
      // decision, distinta de "sin configurar", que es lo que migra).
      if (v.listasHabilitadas !== undefined) out.listasHabilitadas = normalizarListasHabilitadas(v.listasHabilitadas);
      if (v.puedeAsignar !== undefined) out.puedeAsignar = normalizarPuedeAsignar(v.puedeAsignar);
      if (v.puedePrecioCalca !== undefined) out.puedePrecioCalca = normalizarPuedePrecioCalca(v.puedePrecioCalca);
      return out;
    }));
    res.json({ saved: true });
  } catch (err) {
    res.status(500).json({ error: 'No se pudo guardar el registro: ' + err.message });
  }
});

// Maestro de articulos, bloque de modelos (#310, ADR-0016). `sinFamilia` viaja
// aparte de las filas para que el panel marque los pendientes sin re-derivar la
// regla en el navegador.
app.get('/api/admin/modelos', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    res.json({ modelos: await modelosStore.listar(), sinFamilia: await modelosStore.sinFamilia() });
  } catch (err) {
    res.status(500).json({ error: 'Maestro de modelos no disponible: ' + err.message });
  }
});

app.put('/api/admin/modelos/:modelo', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const campos = req.body || {};
    const noEditables = Object.keys(campos).filter(c => !modelosStore.CAMPOS_EDITABLES.includes(c));
    if (noEditables.length) return res.status(400).json({ error: 'Columnas no editables: ' + noEditables.join(', ') });
    const fila = await modelosStore.actualizar(req.params.modelo, campos);
    if (!fila) return res.status(404).json({ error: 'Modelo no encontrado' });
    res.json(fila);
  } catch (err) {
    res.status(500).json({ error: 'Maestro de modelos no disponible: ' + err.message });
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

// "Cotizar con Lalamove" (#72): opcion propia del selector de envio, con la
// misma forma de respuesta que envia.com para que el paso Envio pinte las
// tarjetas igual. Elige vehiculo por el peso y las cajas de calcularPaquetes.
app.post('/api/cotizacion/envio/lalamove', authMiddleware, async (req, res) => {
  const { cpDestino, paisDestino, items } = req.body;
  if (!cpDestino) return res.status(400).json({ error: 'CP destino requerido' });
  if (!items?.length) return res.status(400).json({ error: 'Carrito vacio' });
  if ((paisDestino || 'MX') !== 'MX') return res.status(400).json({ error: 'Lalamove solo entrega en Mexico' });
  let packages, resumen, warnings;
  try {
    ({ packages, resumen, warnings } = calcularPaquetes(items, 0));
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (packages.length === 0) return res.status(400).json({ error: 'No se calcularon paquetes', warnings });
  const pesoKg = Math.ceil(resumen.reduce((s, g) => s + (g.total_peso_kg || 0), 0));
  const cajas = packages.map(p => ({ cantidad: p.amount, medidasCm: [p.dimensions.length, p.dimensions.width, p.dimensions.height] }));
  const { rates, warnings: avisos } = await tarifasLalamove({ cp: cpDestino, pesoKg, cajas });
  rates.sort((a, b) => a.totalPrice - b.totalPrice);
  res.json({ rates, resumen, warnings: warnings.concat(avisos) });
});

// "Cotizar con Tresguerras" (#437): opcion propia del selector de envio, con la
// tarifa PUERTA A PUERTA del cotizador publico de Tresguerras (recoleccion en la
// fabrica). Las cajas de calcularPaquetes van con su peso POR BULTO y el total de
// la cotizacion como valor declarado (el seguro sale dentro de la tarifa).
app.post('/api/cotizacion/envio/tresguerras', authMiddleware, async (req, res) => {
  const { cpDestino, paisDestino, items, totalConIVA } = req.body;
  if (!cpDestino) return res.status(400).json({ error: 'CP destino requerido' });
  if (!items?.length) return res.status(400).json({ error: 'Carrito vacio' });
  if ((paisDestino || 'MX') !== 'MX') return res.status(400).json({ error: 'Tresguerras solo cotiza envios en Mexico' });
  let packages, resumen, warnings;
  try {
    ({ packages, resumen, warnings } = calcularPaquetes(items, 0));
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (packages.length === 0) return res.status(400).json({ error: 'No se calcularon paquetes', warnings });
  const cajas = packages.map(p => ({ cantidad: p.amount, medidasCm: [p.dimensions.length, p.dimensions.width, p.dimensions.height], pesoKg: p.weight }));
  const { rates, warnings: avisos } = await tarifasTresguerras({ cp: cpDestino, cajas, valorDeclarado: Number(totalConIVA) || 0 });
  res.json({ rates, resumen, warnings: warnings.concat(avisos) });
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

// Clientes Operam con el SEGMENTO PENDIENTE (issue #365, ADR-0017): la subida de
// cotizacion escribe el segmento diferido, asi que su fallo no cabe en la respuesta
// al vendedor. La regla de que sigue pendiente vive en el nucleo puro
// filasSegmentoPendiente, que ademas traduce el id del segmento a su nombre y arma
// la liga "Ver en Operam" con el catalogo y la URL que se le pasan desde aqui.
// Sin DB: lista vacia y sinDb:true, mismo patron que el reporte de higiene.
app.get('/api/admin/segmento-pendiente', authMiddleware, adminMiddleware, async (_req, res) => {
  const rows = await dbQuery(
    'SELECT created_at, rfc, nombre, resultado, cliente_id, fuente, error_msg FROM clientes_log ORDER BY created_at ASC'
  );
  if (rows === null) return res.json({ filas: [], sinDb: true });
  res.json({
    filas: filasSegmentoPendiente(rows.rows, { segmentos: SEGMENTOS, operamUrl: process.env.OPERAM_URL }),
    sinDb: false,
  });
});

// Domicilios con almacen mal configurado (issue #416, derivado de #409): el
// barrido del padron corre A PEDIDO (son cientos de lecturas a Operam) y deja su
// resultado crudo en memoria. Desde #438 corre en SEGUNDO PLANO con ritmo propio:
// el POST lo arranca y responde de inmediato (202), y el panel consulta el GET,
// que trae el `avance` (en curso / terminado / fallo, revisados de total); el GET y marcar/desmarcar "asi va bien" recalculan
// el reporte sobre el sin volver a leer Operam. La regla vive en el nucleo puro
// reporteAlmacenDomicilios y la lista de excepciones en la configuracion del
// panel (config-store, #276), con la llave ausente como semilla.
function respuestaAlmacenDomicilios(config) {
  const barrido = ultimoBarridoAlmacenes();
  const reporte = reporteAlmacenDomicilios({
    ...(barrido || {}),
    excepciones: excepcionesAlmacen(config),
    operamUrl: process.env.OPERAM_URL,
  });
  return {
    ...reporte,
    barrido: barrido ? { fecha: barrido.fecha, clientes: barrido.clientes.length } : null,
    avance: avanceBarridoAlmacenes(),
  };
}

app.get('/api/admin/almacen-domicilios', authMiddleware, adminMiddleware, (_req, res) => {
  res.json(respuestaAlmacenDomicilios(configStore.leer()));
});

app.post('/api/admin/almacen-domicilios/barrer', authMiddleware, adminMiddleware, (_req, res) => {
  barrerAlmacenesDomicilios();
  res.status(202).json(respuestaAlmacenDomicilios(configStore.leer()));
});

// Marcar y desmarcar guardan con el mismo merge que POST /api/admin/config: se
// parte de lo que hay en la BASE (cargar() antes de leer) y se conserva el resto
// de la configuracion. Lectura y guardado van en el mismo try: Express 4 no
// atrapa promesas rechazadas.
async function guardarExcepcionesAlmacen(res, cambiar) {
  let config;
  try {
    await configStore.cargar();
    const actual = configStore.leer() || {};
    const excepciones = cambiar(excepcionesAlmacen(actual));
    if (!excepciones) return res.status(400).json({ error: 'Falta el domicilio o el almacen que se aprueba' });
    config = { ...actual, excepcionesAlmacen: excepciones };
    await configStore.guardar(config);
  } catch (err) {
    return res.status(500).json({ error: 'Configuracion no disponible: ' + err.message });
  }
  res.json(respuestaAlmacenDomicilios(config));
}

app.post('/api/admin/almacen-domicilios/asi-va-bien', authMiddleware, adminMiddleware, (req, res) =>
  guardarExcepcionesAlmacen(res, lista => marcarAsiVaBien(lista, req.body)));

app.delete('/api/admin/almacen-domicilios/asi-va-bien/:branchCode', authMiddleware, adminMiddleware, (req, res) =>
  guardarExcepcionesAlmacen(res, lista => desmarcarAsiVaBien(lista, req.params.branchCode)));

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

// Intentos de subida a Dropbox (issue #356, hijo de #354): las tres subidas del
// repo son fire-and-forget y su fallo solo llegaba a console.error. Esta es la
// superficie donde se ve, con la mas reciente primero. El store se traga sus
// propios fallos y devuelve lista vacia, asi que aqui no hay sinDb que reportar:
// sin DATABASE_URL el registro cae al JSON de disco y se muestra igual.
// #399: cada fila sale con su `lugar` (Dropbox real o sandbox de la app) y,
// aparte, `flujos` dice contra que escribe HOY cada flujo -- estado calculado
// al leer, no una fila mas que se iria del LIMIT.
app.get('/api/admin/dropbox-subidas', authMiddleware, adminMiddleware, async (_req, res) => {
  const subidas = await listarSubidasDropbox();
  res.json({
    flujos: estadoFlujosDropbox(),
    subidas: subidas.map(s => ({ ...s, lugar: lugarSubidaDropbox(s) })),
  });
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
      error: `${candidato.debtorNombre || 'Este Cliente Operam'} es Cliente Operam sin datos fiscales: su quote se acepta como prospecto, no como cotización (sus pedidos son de muchos contactos distintos)`,
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

// Issue #97: buscarClientes(q) es la busqueda de Operam (razon social);
// buscarClientesPorTexto(q) cablea el indice de telefonos/nombre corto de
// #42 (best effort, nunca lanza) para cubrir telefono de contacto y
// cust_ref, que Operam no indexa. Se combinan y deduplican por customer_id.
// Ninguna de las dos indexa el RFC (#194), asi que un RFC tecleado aqui no
// encontraba nada y el paso Cliente ofrecia crear un contacto con el (#421):
// solo cuando q tiene forma de RFC se suma buscarClientesPorRfc (?tax_id=,
// RFC completo, no prefijo) con el RFC normalizado, best effort como el resto
// de la ruta -- si falla, responden las otras dos fuentes.
async function clientesOperamPorTexto(q) {
  const [porOperam, porIndice, porRfc] = await Promise.all([
    buscarClientes(q),
    buscarClientesPorTexto(q),
    tieneFormaDeRfc(q) ? buscarClientesPorRfc(normalizarRfc(q)).catch(() => []) : [],
  ]);
  const vistos = new Set();
  return [...(Array.isArray(porOperam) ? porOperam : []), ...porIndice, ...porRfc].filter(c => {
    if (vistos.has(c.customer_id)) return false;
    vistos.add(c.customer_id);
    return true;
  });
}

// Los celulares por los que un Cliente Operam liga con un Contacto: los de sus
// SEIS casillas (regla estructural de ADR-0016), en el orden del respaldo de la
// migracion (Cel > Telefono > Secundario), porque el Cel es el numero mas
// probable de WhatsApp. Son los mismos numeros de su fila (#426), reducidos a
// la llave de 10 digitos.
function celularesDeClienteOperam(c) {
  return telefonosDeClienteOperam(c).map(llaveContacto).filter(Boolean);
}

// La fila de un Cliente Operam que leen el paso Cliente y la vista Clientes.
// Sin las etiquetas: esas son del CONTACTO (ADR-0016) y las agrega quien sabe
// de quien es la fila.
function filaClienteOperam(c, estadoOperam) {
  const branch = c.branches?.[0] || {};
  // OJO: telefonos trae los de TODAS las casillas (#426: el Cel incluido) --
  // buscarClientesPorTexto puede matchear por cualquiera y el navegador vuelve a
  // filtrar sobre este campo.
  const telefonos = telefonosDeClienteOperam(c);
  return {
    id: c.customer_id, name: c.CustName || '', ref: c.cust_ref || '', rfc: c.tax_id || '',
    calle: titleCase([c.street, c.street_number].filter(Boolean).join(' ')),
    numInt: c.suite_number || '', colonia: titleCase(c.district || ''),
    cp: c.postal_code || '', municipio: titleCase(c.city || ''),
    // `estado` aqui es el estado de la republica del domicilio; los dos estados
    // del Cliente Operam viajan como `fiscal` y `comercial`.
    estado: titleCase(c.state || ''),
    telefono: telefonos[0] || '',
    telefonos,
    email: branch.email || c.contacts?.[0]?.email || '',
    nombreEntrega: branch.br_name || branch.contact_name || '',
    // #245: pais ISO (MX/US/CA) derivado del texto libre country, o null si
    // no se puede determinar (ver paisDeClienteOperam). El frontend fija
    // cl-pais solo cuando esto viene no nulo.
    pais: paisDeClienteOperam(c),
    // #297: la Moneda del cliente (curr_code). Viaja en la fila porque el paso
    // Cliente tiene que avisar AL SELECCIONAR, sin volver a preguntarle a Operam;
    // el juicio lo da el mismo nucleo puro que usa la subida. '' = sin senal.
    moneda: monedaDelCliente(c),
    // #344: los dos estados del Cliente Operam. `fiscal` sale del RFC de HOY,
    // no del que se capturo alguna vez; `fuenteIncompleta` declara el hueco de
    // los quotes web.
    fiscal: estadoOperam?.fiscal ?? null,
    comercial: estadoOperam?.comercial ?? null,
    fuenteIncompleta: estadoOperam?.fuenteIncompleta ?? null,
  };
}

app.get('/api/operam/clientes', authMiddleware, async (req, res) => {
  const q = req.query.q || '';
  if (!q.trim()) return res.json([]);
  try {
    const raw = await clientesOperamPorTexto(q);
    // Los dos estados de cada Cliente Operam del resultado (#344, ADR-0016) y
    // las etiquetas del Contacto que comparte su celular. Ambos derivados: el
    // vendedor lee "Sin datos fiscales" y "con pedido" sin capturar nada, y el
    // Cliente Operam del historico que nunca paso por el cotizador aparece con
    // pedido cuando lo tiene. Best effort igual que el resto de la ruta.
    const [estados, enLinea, contactos, cotizaciones] = await Promise.all([
      estadosDeClientes(raw),
      celularesEnLinea(),
      prospectosStore.listar().catch(() => []),
      cotStore.listar().catch(() => []),
    ]);
    const contactoPorCelular = indiceContactosPorCelular(contactos);
    // De que Contacto es cada Cliente Operam del resultado, por la regla
    // estructural de ADR-0016: un celular en cualquiera de las SEIS casillas
    // liga (celularesDeClienteOperam). El primero que resulte ser Contacto
    // manda: una fila POR Contacto es la vista Clientes de #346, que tiene su
    // propia ruta.
    const contactoDeCliente = (c) => {
      for (const cel of celularesDeClienteOperam(c)) {
        const ficha = contactoPorCelular.get(cel);
        if (ficha || enLinea.has(cel)) return { cel, ficha: ficha || null };
      }
      return null;
    };
    // Un Contacto puede tener pedido bajo un Cliente Operam que no es el de
    // esta fila (muchos a muchos, ADR-0016): sus otras ligas se resuelven con
    // el MISMO cache y entran a la etiqueta.
    const contactoPorCliente = new Map(raw.map(c => [String(c.customer_id), contactoDeCliente(c)]));
    const oportunidadesDe = (ficha) => (ficha ? cotizacionesDelProspecto(ficha, cotizaciones) : []);
    const ligados = [...contactoPorCliente.values()].filter(Boolean)
      .flatMap(x => clientesOperamLigados(x.ficha, oportunidadesDe(x.ficha).map(o => ({ customerId: o.data?.cliente?.customerId }))));
    const estadosLigados = await estadosPorId(ligados);
    const clientes = raw.map(c => {
      // `estadoOperam` y no `estado`: en esta misma fila `estado` es el estado
      // de la republica del domicilio.
      const estadoOperam = estados.get(String(c.customer_id)) || null;
      const contacto = contactoPorCliente.get(String(c.customer_id)) || null;
      const oportunidades = oportunidadesDe(contacto && contacto.ficha);
      const clientesOperam = [
        ...(estadoOperam ? [{ id: c.customer_id, ...estadoOperam }] : []),
        ...clientesOperamLigados(contacto && contacto.ficha,
          oportunidades.map(o => ({ customerId: o.data?.cliente?.customerId })))
          .map(id => { const e = estadosLigados.get(id); return e ? { id, ...e } : null; })
          .filter(Boolean),
      ];
      return {
        ...filaClienteOperam(c, estadoOperam),
        // #344: las etiquetas del Contacto que comparte el celular de esta fila.
        etiquetas: contacto
          ? etiquetasDeContacto({
            contacto: contacto.ficha,
            // La MISMA liga Contacto -> Oportunidades de la Tabla de prospectos
            // (#319/#342): evento de cotizacion o el Contacto anotado.
            oportunidades,
            clientesOperam,
            enLinea: enLinea.has(contacto.cel),
          })
          : [],
      };
    });
    res.json(clientes);
  } catch (err) {
    res.status(503).json({ error: 'Operam no disponible: ' + err.message });
  }
});

// El buscador de la vista Clientes, por CONTACTO (#346, spec #337, ADR-0016).
//
// La vista mezclaba dos listas en el navegador -- los Clientes Operam y los
// prospectos del vendedor -- y la misma persona salia dos veces. Aqui la unidad
// de la fila es el Contacto: una fila por celular, con sus etiquetas, sus
// Oportunidades y sus Clientes Operam ANIDADOS, mas las filas de los Clientes
// Operam de los que no conocemos a nadie. Quien decide la forma es el nucleo
// puro (lib/buscador-clientes.js); aqui solo se lee.
//
// La visibilidad es la de siempre: se parte del embudo visible para quien
// pregunta, asi que el Contacto de otro vendedor no aparece -- y su Cliente
// Operam sigue saliendo como fila suelta, igual que hoy.
//
// El paso Cliente NO cambia: sigue con GET /api/operam/clientes, que es la
// busqueda de entidades para cotizar.
app.get('/api/contactos/buscar', authMiddleware, async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  try {
    const raw = await clientesOperamPorTexto(q);
    const celularesPorCliente = new Map(
      raw.map(c => [String(c.customer_id), celularesDeClienteOperam(c)]));
    const idsDelResultado = new Set(raw.map(c => String(c.customer_id)));

    const embudo = await embudoVisiblePara(req.user);
    const cotizaciones = await cotStore.listar();
    // #319: las cotizaciones se filtran por la MISMA visibilidad antes de
    // ligarlas, para que un vendedor nunca vea por la ficha de un Contacto la
    // cotizacion de otro.
    const cotizacionesVisibles = req.user.role === 'admin'
      ? cotizaciones
      : cotizaciones.filter(c => c.vendedor === req.user.name);

    // Los Contactos que entran: los que responden al texto y los de los Clientes
    // Operam que ya respondieron. Buscar "Orea" tiene que traer a su comprador
    // aunque el se llame de otra forma -- si no, el Cliente Operam volveria a
    // salir como fila suelta y la persona quedaria escondida.
    //
    // "Ser de" tiene las DOS fuentes de ADR-0016: el celular en una de las seis
    // casillas (derivada) y la liga que el cotizador persistio -- la del propio
    // Contacto y la que anoto cada cotizacion suya al subirse. Con solo la
    // derivada, el Cliente Operam ligado a mano cuyo celular Operam no conoce
    // dejaba a su comprador escondido.
    const celularesDelResultado = new Set([...celularesPorCliente.values()].flat());
    const contactoPorCelular = indiceContactosPorCelular(embudo.contactos);
    const ligadosAlResultado = new Set();
    for (const c of embudo.contactos) {
      if (ligasDeContacto(c.data).some(l => idsDelResultado.has(String(l.cliente_id)))) {
        ligadosAlResultado.add(c.id);
      }
    }
    for (const cot of cotizacionesVisibles) {
      const customerId = cot.data?.cliente?.customerId;
      if (customerId == null || !idsDelResultado.has(String(customerId))) continue;
      for (const cel of celularesDeCruce(cot)) {
        const ficha = contactoPorCelular.get(cel);
        if (ficha) ligadosAlResultado.add(ficha.id);
      }
    }
    const fichas = embudo.contactos.filter(c =>
      contactoCoincideBusqueda(c, q) ||
      celularesDelResultado.has(ultimos10(c.celular)) ||
      ligadosAlResultado.has(c.id));

    const oportunidadesPre = oportunidadesDeContactos(fichas, await oportunidadesStore.listar());
    const porContacto = await Promise.all(fichas.map(async ficha => {
      const cots = cotizacionesDelProspecto(ficha, cotizacionesVisibles);
      const suyas = oportunidadesPre.filter(o => o.contactoId === ficha.id);
      // Sus Clientes Operam: los que el cotizador persistio (`ligasDeContacto`
      // via `clientesOperamLigados`) MAS el que deriva del indice de telefonos,
      // que no se guarda y se calcula en lectura (`conLigaDerivada`, #345). Sin
      // el, la ficha de quien nunca cotizo por aqui no mostraria el Cliente
      // Operam que comparte su numero -- y "todos sus Clientes Operam" es justo
      // lo que la ficha promete.
      const persistidas = clientesOperamLigados(ficha, cots.map(c => ({ customerId: c.data?.cliente?.customerId })))
        .map(cliente_id => ({ cliente_id }));
      const derivada = await matchCliente(ficha.celular);
      return {
        ficha,
        // Todas sus Oportunidades, en la misma forma que las tarjetas del
        // tablero (#340): las pre-cotizacion y las que ya son cotizacion, sin
        // que la persona salga dos veces por la misma intencion.
        tarjetas: tarjetasOportunidades(suyas, cots),
        ligados: conLigaDerivada(persistidas, derivada?.customer_id ?? null).map(l => String(l.cliente_id)),
      };
    }));

    // Las fichas de Operam de todo lo que va a viajar: las del resultado y las
    // de las ligas de cada Contacto, que pueden no estar en el resultado
    // (muchos a muchos, ADR-0016). Lo que el padron no conoce no se inventa:
    // sin ficha no hay RFC con el que decir su estado fiscal, y una fila sin
    // Cliente Operam es mejor que una con la etiqueta equivocada.
    const padron = await clientesCacheados({ timeoutMs: 5000 }).catch(() => []);
    const padronPorId = new Map((padron || []).map(c => [String(c.customer_id), c]));
    const fichasOperam = new Map(raw.map(c => [String(c.customer_id), c]));
    for (const id of porContacto.flatMap(x => x.ligados)) {
      if (fichasOperam.has(id)) continue;
      const ficha = padronPorId.get(id);
      if (ficha) fichasOperam.set(id, ficha);
    }
    const [estados, enLinea] = await Promise.all([
      estadosDeClientes([...fichasOperam.values()]),
      celularesEnLinea(),
    ]);
    // La fila de un Cliente Operam, con la forma que el navegador ya sabia leer
    // (`normalizarOperam`, el MISMO normalizador del buscador mezclado): la fila
    // se arma aqui porque quien decide que sale y bajo quien es el servidor,
    // pero su forma no se reexpresa.
    const filaOperamDe = (id) => {
      const ficha = fichasOperam.get(String(id));
      return ficha ? normalizarOperam(filaClienteOperam(ficha, estados.get(String(id)) || null)) : null;
    };

    const contactos = porContacto.map(({ ficha, tarjetas, ligados }) => ({
      ...normalizarProspecto(ficha),
      tipo: 'contacto',
      oportunidades: tarjetas,
      clientesOperam: ligados.map(filaOperamDe).filter(Boolean),
    }));

    const filas = filasBuscadorClientes({
      clientesOperam: raw.map(c => filaOperamDe(c.customer_id)).filter(Boolean),
      contactos,
      celularesPorCliente,
    });
    // Las etiquetas se derivan DESPUES de anidar (#344): miran TODOS los
    // Clientes Operam del Contacto, tambien el que solo se supo por el indice de
    // telefonos. Calcularlas antes dejaba a un Contacto sin la etiqueta "con
    // pedido" del Cliente Operam que su propia fila ya mostraba con pedido.
    const conEtiquetas = filas.map(f => (f.tipo !== 'contacto' ? f : {
      ...f,
      etiquetas: etiquetasDeContacto({
        contacto: f.raw,
        oportunidades: f.oportunidades,
        clientesOperam: f.clientesOperam,
        enLinea: enLinea.has(ultimos10(f.celular)),
      }),
    }));
    // El Origen (#287) se resuelve aqui, donde estan los Contactos: la fila del
    // Contacto lo trae propio y la del Cliente Operam suelto lo hereda si algun
    // Contacto visible comparte su telefono.
    res.json(anotarOrigen(conEtiquetas, indiceOrigenPorCelular(embudo.contactos)));
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
  // Listas habilitadas (#300): una lista CON valor si viaja en este diff (#372), asi
  // que este camino tambien puede mover la lista del cliente. El valor "anterior" del
  // diff lo arma el navegador: la excepcion de conservar la actual se comprueba contra
  // Operam, nunca contra el.
  const rechazoLista = await rechazoListaCliente(
    req.user,
    diff.sales_type && typeof diff.sales_type === 'object' ? diff.sales_type.nuevo : undefined,
    () => listaActualDeCliente(id)
  );
  if (rechazoLista) return res.status(403).json({ error: rechazoLista });
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
      logCliente(normalizarRfc(rfcNuevo), null, 'rfc-bloqueado', id, FUENTE_PATCH_CLIENTE, null, `El RFC ya pertenece al Cliente Operam ${verificacion.dueno.cliente_id} (${verificacion.dueno.CustName})`);
      return res.status(409).json({
        error: `Este RFC ya pertenece a otro Cliente Operam: ${verificacion.dueno.cliente_id} (${verificacion.dueno.CustName}).`,
        fusion: true,
        cliente: verificacion.dueno,
      });
    }
  }
  try {
    // El eco del PUT es lo unico que dice que acepto Operam (#248): un 200 no
    // garantiza nada (quirk #74) y hasta aqui el vendedor leia "actualizados"
    // incluso cuando Operam habia ignorado el campo en silencio -- la misma clase de
    // fallo de #169, en otra superficie. La pieza de verificacion es la del upgrade
    // fiscal, sin copia: las llaves del diff son de LECTURA y camposNoAplicados ya
    // las traduce a las de escritura para buscarlas en el eco.
    // Vaciar el segmento o la lista de precios no viaja (#372): el diff puede traerlos
    // en vacio desde la Seccion 2 bloqueada, y Operam los guardaria como 0. Se quedan
    // fuera del PUT y de su verificacion, con su motivo real.
    const { enviable, ignorados } = diffSinVaciadosComerciales(diff);
    const eco = await actualizarClienteDirecto(id, bodyDesdeDiffFiscal(enviable));
    if (hayCambioRfc) logCliente(normalizarRfc(rfcNuevo), null, 'rfc-actualizado', id, FUENTE_PATCH_CLIENTE, null, null);
    // Misma llave de respuesta que el upgrade fiscal, para que el navegador lea los
    // dos caminos con interpretarRespuestaUpgrade.
    res.json({ ok: true, camposNoActualizados: camposNoAplicados(enviable, eco).concat(ignorados) });
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
// --- Ligas Contacto -> Cliente Operam al subir (#345, spec #337, ADR-0016) ---
//
// El Contacto de la cotizacion: el celular ANOTADO al nacer (#342) manda, y solo
// si la cotizacion es anterior a ese campo se cae a lo tecleado. Asi corregir un
// telefono despues no cambia de quien es la Oportunidad ni a quien se le liga el
// Cliente Operam.
async function contactoDeLaSubida(entry) {
  for (const celular of celularesDeCruce(entry)) {
    const p = await prospectosStore.buscarPorCelular(celular);
    if (p) return p;
  }
  return null;
}

const CODIGO_OTRA_RAZON_SOCIAL = 'CONFIRMAR_OTRA_RAZON_SOCIAL';

// Un Cliente Operam con nombre, para que la pregunta no sea sobre dos numeros
// pelados. El padron cacheado (#42) es best effort: si Operam no responde, la
// pregunta sale igual con el id, que es lo que el vendedor necesita para no
// quedarse detenido.
function clienteALaVista(clienteId, padron, fuente) {
  const k = (padron || []).find(c => String(c?.customer_id) === String(clienteId));
  return {
    customerId: clienteId,
    nombre: k?.CustName || '',
    nombreCorto: k?.cust_ref || '',
    rfc: k?.tax_id || '',
    ...(fuente ? { fuente } : {}),
  };
}

// La pregunta que sustituye al 409 "ya esta ligado ... y difiere del elegido"
// (ADR-0016): el celular ligado a otro Cliente Operam es la segunda razon social
// del mismo Contacto casi siempre, y bloquear la venta por eso era el peor
// desenlace. 428 (el servidor exige que el request venga confirmado) y NO 409:
// el frontend clasifica por el codigo, nunca por el texto, y 409 ya significa
// otras dos cosas en esta misma ruta (candidatos de dedup, cust_ref duplicado).
// La liga derivada de Operam se calcula AQUI, en lectura, y nunca se persiste:
// es informacion para el vendedor, jamas un bloqueo -- un telefono compartido en
// una casilla de Operam no puede frenar una cotizacion.
// `reintentar` es el cuerpo EXACTO con el que se vuelve a pedir la subida al
// confirmar: la pregunta puede nacer de un candidato elegido, de "es sucursal de
// este cliente" o del camino normal, y cada uno se reintenta distinto. Lo decide
// el servidor, que es quien sabe por que camino entro; el navegador solo lo
// reenvia (y las guardas de #208 vuelven a correr sobre el, como siempre).
async function responderConfirmarOtraRazonSocial(res, { contacto, ligadas, clienteId, reintentar }) {
  const padron = await clientesCacheados({ timeoutMs: 5000 });
  const derivada = contacto ? await matchCliente(contacto.celular) : null;
  const todas = conLigaDerivada(ligadas, derivada?.customer_id ?? null);
  return res.status(428).json({
    error: 'El celular de esta cotizacion ya esta ligado a otro Cliente Operam. ' +
      'Confirma si es otra razon social del mismo Contacto para agregar la liga sin quitar la que ya tenia.',
    codigo: CODIGO_OTRA_RAZON_SOCIAL,
    ligado: todas.map(l => clienteALaVista(l.cliente_id, padron, l.fuente)),
    elegido: clienteALaVista(clienteId, padron),
    contacto: contacto ? { celular: contacto.celular, nombre: contacto.nombre || '' } : null,
    reintentar: { ...(reintentar || {}), otraRazonSocial: true },
  });
}

// La liga se AGREGA, nunca reemplaza (ADR-0016). Fire-and-forget como el resto
// de este camino: el quote ya esta en Operam y un fallo del store solo se
// reporta como paso.
async function agregarLigaAlContacto(contacto, clienteId, entry, steps) {
  try {
    await prospectosStore.ligarCliente(contacto.id, clienteId, {
      tipo: 'cliente', cliente_id: clienteId,
      nombre: entry.data?.cliente?.razonSocial || entry.data?.cliente?.nombreCorto || '',
      fecha: new Date().toISOString(), vendedor: entry.vendedor,
    });
    steps?.push({ name: 'ligar prospecto', status: 'ok' });
  } catch (err) {
    console.error('[prospectos] No se pudo ligar el Contacto al Cliente Operam:', err.message);
    steps?.push({ name: 'ligar prospecto', status: 'error', error: err.message });
  }
}

// De lo que el vendedor contesto en el body a la decision de dedup que entiende
// el modulo (CONTEXT.md "Solicitud de alta"). Con AMBOS en el body manda el
// elegido: reutilizar tal cual es el desenlace mas conservador (no escribe nada
// nuevo), misma regla que customerId frente a crearNuevo.
function decisionDeLaSubida(customerIdElegido, crearNuevo, sucursalDe) {
  if (customerIdElegido != null) return { tipo: 'usar', clienteId: customerIdElegido };
  if (sucursalDe != null) return { tipo: 'otro-domicilio', clienteId: sucursalDe };
  if (crearNuevo) return { tipo: 'ninguno' };
  return null;
}

// La Solicitud de alta armada desde la cotizacion: TODA la traduccion que hace la
// subida hacia el modulo Alta de cliente (ADR-0017). Sin datos fiscales, porque
// este camino siempre da de alta un Cliente Operam sin ellos (ADR-0006), y con el
// segmento en 'diferido' -- la latencia de la subida manda, asi que el modulo
// dispara su escritura sin esperarla y anota el fallo como segmento pendiente
// (#365), que el administrador ve en /admin.
//
// salesTypeId viaja RESUELTO: el catalogo de listas de precios ya vive cacheado
// aqui (obtenerListasPrecios, con la recarga perezosa de #246) y pasarselo le
// ahorra al modulo una lectura a Operam dentro del camino critico del vendedor.
function solicitudDeLaSubida(entry, { prospecto, decision, otraRazonSocial, salesTypeId }) {
  const c = entry.data?.cliente || {};
  return {
    contacto: {
      celular: c.telefono || '',
      prospecto,
      ligas: ligasDeContacto(prospecto?.data),
      otraRazonSocialConfirmada: !!otraRazonSocial,
    },
    identidad: {
      razonSocial: c.razonSocial || '',
      nombreCorto: c.nombreCorto || '',
      nombreVisible: entry.cliente || '',
      rfc: c.rfc || '',
      pais: c.pais || 'MX',
    },
    datosFiscales: null,
    comercial: {
      vendedor: entry.vendedor,
      tier: entry.tier,
      salesTypeId,
      segmentoId: c.segmentoId,
      correoFacturacion: c.emailFactura || '',
      usoCfdi: c.usoCfdi,
    },
    domicilioEntrega: {
      nombre: c.nombreEntrega || '',
      calle: c.calle || '',
      numInt: c.numInt || '',
      colonia: c.colonia || '',
      municipio: c.municipio || '',
      estado: c.estado || '',
      cp: c.cpEntrega || '',
      referencias: c.referencias || '',
      telefono: c.celEntrega || '',
      correo: c.emailEntrega || '',
    },
    ligaFija: { clienteId: c.customerId ?? null, domicilioId: c.branchId ?? c.branch_id ?? null },
    decision,
    segmento: { preferencia: 'diferido' },
  };
}

// Anotar el Cliente Operam en la cotizacion es de la SUBIDA, no del alta
// (ADR-0017): el modulo no escribe en la cotizacion. Se llama en cuanto el
// resultado trae un Cliente Operam y ANTES de responder -- tambien cuando el
// desenlace es un bloqueo --, porque de eso depende que un reintento entre por el
// camino normal y reuse ese cliente en vez de crear un segundo (idempotencia).
async function anotarClienteEnCotizacion(id, c, customerId, branchId) {
  await cotStore.actualizarDatos(id, { cliente: { ...c, customerId, branchId } });
}

// El motivo de PRE que le toca a cada bloqueo del alta (#204): 'dedup' deja el
// documento bajo candado hasta que el vendedor resuelva, y los demas lo entregan
// igual (ADR-0009). La liga fija de la cotizacion no marca motivo: no es una PRE
// por falta de resolucion sino una cotizacion que ya pertenece a otro cliente.
const MOTIVO_PRE_DE_BLOQUEO = {
  'liga-fija': null,
  // El mismo RFC real de otro Cliente Operam (#377) es un duplicado que el vendedor
  // tiene que resolver, igual que los candidatos: el documento queda bajo candado.
  fusion: MOTIVO_PRE_DEDUP,
  'sin-lista-precios': MOTIVO_PRE_SIN_LISTA,
};

// Un bloqueo del alta -> la MISMA respuesta HTTP de siempre. El codigo de estado lo pone
// aqui el handler y no el alta (ADR-0017): 409 para lo que el vendedor tiene que
// resolver (liga fija de la cotizacion, nombre corto duplicado), 422 para el cliente mal
// configurado en Operam (reintentar no sirve hasta arreglarlo, #285) y 503 para lo que
// fallo en Operam.
function responderBloqueoAlta(res, bloqueo) {
  const { motivo, mensaje, pasos } = bloqueo;
  const cliente = bloqueo.clienteId != null ? { customer_id: bloqueo.clienteId } : {};
  if (motivo === 'liga-fija') return res.status(409).json({ error: mensaje });
  // La tabla enumera los motivos del modulo y no puede dejar ninguno afuera: el que
  // falte cae al 503 de "fallo Operam" y entrega el documento. `fusion` (#377) es lo
  // contrario de una falla del ERP -- es un duplicado que el vendedor resuelve.
  if (motivo === 'fusion') return res.status(409).json({ error: mensaje, steps: pasos });
  if (motivo === 'cust-ref-duplicado') {
    return res.status(409).json({ error: mensaje, codigo: 'CUST_REF_DUPLICADO', nombreCorto: bloqueo.nombreCorto, steps: pasos });
  }
  if (motivo === 'sin-lista-precios') {
    return res.status(422).json({ error: mensaje, codigo: CODIGO_CLIENTE_SIN_LISTA, ...cliente, steps: pasos });
  }
  return res.status(503).json({ error: mensaje, ...cliente, steps: pasos });
}

// La subida del quote sobre el Cliente Operam que dejo listo el alta, con sus post-fixes
// (vigencia y segmento). Es la que escribe en la cotizacion lo que sale de aqui: folio,
// huella y motivo de PRE.
async function subirQuoteTrasAlta(res, id, entry, { customerId, branchId, creadoNuevo, pasos, segmentoDiferido }) {
  const c = entry.data?.cliente || {};
  try {
    // La huella (#114) se toma de ESTE objeto, no de entry.data: el cliente recien
    // ligado (customerId/branchId) forma parte de lo que se subio, y la siguiente
    // regeneracion si lo trae (crearOActualizarCotizacion lo copia del registro).
    // Calcularla sobre entry.data haria que toda regeneracion pareciera un cambio.
    const dataSubida = { ...entry.data, cliente: { ...c, customerId, branchId } };
    // El cliente que ACABA de crear esta alta nace con la lista de su tier
    // (buildClienteGenerico): releerlo solo para comprobarlo seria una lectura de
    // mas dentro del camino critico de la subida (#285). El cliente reusado o
    // elegido si se checa: puede llevar anos sin lista.
    const folio = await subirCotizacionOperam(dataSubida, { verificarListaPrecios: !creadoNuevo });
    if (folio != null && folio !== '') {
      await cotStore.setFolioOperam(id, folio);
      await cotStore.actualizarDatos(id, { huellaQuote: huellaContenidoQuote(dataSubida, { listaId: listaDelQuote(entry) }) });
      // Hay folio: se resolvio por el camino que sea (candidato elegido, cliente
      // nuevo forzado o reintento) y el candado se levanta (#204).
      await marcarMotivoPre(id, null);
    }
    pasos.push({
      name: 'POST quote', status: 'ok',
      mensaje: folio ? 'La cotizacion quedo registrada en Operam' : 'La cotizacion se envio a Operam pero volvio sin numero',
      detalle: 'POST quote -> folio ' + (folio == null || folio === '' ? '(ninguno)' : folio),
    });
    pasos.push(...await postFixQuote(folio, entry));
    // clienteGenerico (#93): este camino SIEMPRE deja el cliente con RFC generico
    // (creado nuevo o reutilizado por celular/dedup de nombre, ambos genericos) --
    // el frontend lo usa para refrescar el chip Fiscal y ofrecer la CSF junto al folio.
    return res.json({ ok: true, folio, customer_id: customerId, clienteGenerico: true, steps: pasos });
  } catch (err) {
    pasos.push({
      name: 'POST quote', status: 'error',
      mensaje: 'La cotizacion no se pudo registrar en Operam',
      detalle: 'POST quote: ' + err.message,
    });
    // Cliente sin lista de precios (#285): el cliente EXISTENTE que el vendedor
    // eligio (o al que se le colgo la sucursal) puede estar sin lista; el recien
    // creado por esta misma alta nace con la de su tier y no se checa.
    if (await responderSiClienteSinLista(res, id, err, { customer_id: customerId, steps: pasos })) return;
    // Moneda extranjera (#297): el cliente EXISTENTE que el vendedor eligio (o al
    // que se le colgo la sucursal) puede cotizar en otra moneda; el recien creado
    // por esta misma alta nace en MXN y no se checa.
    if (responderSiMonedaExtranjera(res, err, { customer_id: customerId, steps: pasos })) return;
    await marcarMotivoPre(id, MOTIVO_PRE_OPERAM);
    return res.status(503).json({ error: 'No se pudo subir a Operam: ' + err.message, customer_id: customerId, steps: pasos });
  } finally {
    // La escritura diferida del segmento (#365) se dispara DESPUES de responder, suba el
    // quote o no: el cliente ya existe y un reintento no vuelve a pasar por aqui. Antes
    // del POST del quote se encolaria delante del post-fix de vigencia, que si se espera.
    segmentoDiferido?.();
  }
}

// Las dos mitades de este camino: primero el alta del Cliente Operam sin datos fiscales,
// que hace el modulo y devuelve valores, y luego la subida del quote sobre lo que
// devolvio. Aqui viven la traduccion a HTTP y las escrituras en la cotizacion, que son de
// la subida (ADR-0017).
async function subirConAltaGenerica(res, id, entry, customerIdElegido, crearNuevo, sucursalDe, otraRazonSocial) {
  const c = entry.data?.cliente || {};
  const prospecto = await contactoDeLaSubida(entry);
  const decision = decisionDeLaSubida(customerIdElegido, crearNuevo, sucursalDe);
  const alta = await darDeAlta(solicitudDeLaSubida(entry, {
    prospecto, decision, otraRazonSocial,
    salesTypeId: resolverSalesTypeId(entry.tier, await obtenerListasPrecios()),
  }));

  // Idempotencia del reintento (ADR-0017): en cuanto el alta deja un Cliente Operam se
  // anota en la cotizacion ANTES de responder, aunque el desenlace sea un bloqueo -- si
  // no, el reintento entraria sin id persistido y crearia un SEGUNDO cliente. La
  // pregunta queda fuera a proposito: ahi no se creo ni se escribio nada y el vendedor
  // todavia puede elegir otro cliente.
  if (alta.tipo !== 'pregunta' && alta.clienteId != null) {
    await anotarClienteEnCotizacion(id, c, alta.clienteId, alta.domicilioId ?? null);
    alta.pasos.push({
      name: 'persistir customer_id', status: 'ok',
      mensaje: 'La cotizacion quedo ligada a este Cliente Operam',
      detalle: `cotizacion ${id} -> cliente ${alta.clienteId}, branch ${alta.domicilioId ?? '(sin resolver)'}`,
    });
  }

  if (alta.tipo === 'pregunta') {
    if (alta.motivo === 'otra-razon-social') {
      // El cuerpo del reintento lo dicta el SERVIDOR (#345): la pregunta puede nacer de
      // un candidato elegido, de "es otro domicilio de este cliente" o del camino
      // normal, y cada uno se reintenta distinto.
      return await responderConfirmarOtraRazonSocial(res, {
        contacto: alta.contacto, ligadas: alta.ligadas, clienteId: alta.clienteId,
        reintentar: {
          ...(customerIdElegido != null ? { customerId: customerIdElegido } : {}),
          ...(customerIdElegido == null && sucursalDe != null ? { sucursalDe } : {}),
          ...(crearNuevo ? { crearNuevo: true } : {}),
        },
      });
    }
    // Sin resolver no hay documento (#204): el motivo se marca ANTES de responder para
    // que el candado de los GET aplique de inmediato.
    await marcarMotivoPre(id, MOTIVO_PRE_DEDUP);
    // Las salidas las manda el MODULO (#377): con un candidato del mismo RFC real no
    // viene "ninguno es el mismo", y el navegador no pinta el boton que no recibe.
    return res.status(409).json({ error: alta.mensaje, candidatos: alta.candidatos, opciones: alta.opciones });
  }
  if (alta.tipo === 'bloqueo') {
    const motivoPre = alta.motivo in MOTIVO_PRE_DE_BLOQUEO ? MOTIVO_PRE_DE_BLOQUEO[alta.motivo] : MOTIVO_PRE_OPERAM;
    if (motivoPre) await marcarMotivoPre(id, motivoPre);
    return responderBloqueoAlta(res, alta);
  }
  return await subirQuoteTrasAlta(res, id, entry, {
    customerId: alta.clienteId, branchId: alta.domicilioId, creadoNuevo: alta.creadoNuevo, pasos: alta.pasos,
    segmentoDiferido: alta.segmentoDiferido,
  });
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

// Cliente sin lista de precios (#285). Dos entradas al mismo desenlace: el corte
// ANTES del POST (ErrorClienteSinLista, lanzado por subirCotizacionOperam) y el
// 406 "rate de moneda" que llegue de todos modos. No es un fallo de Operam sino
// un cliente mal configurado, asi que va como 422 CON codigo estructurado (el
// frontend clasifica por codigo, nunca por el texto) y SIN Reintentar: el boton
// volveria a chocar contra lo mismo hasta que alguien le asigne una lista en
// Operam. El motivo se guarda para que el historial lo explique en vez de
// mostrar el PRE mudo. Devuelve true si se hizo cargo del error.
async function responderSiClienteSinLista(res, id, err, extra = {}) {
  const sinLista = err instanceof ErrorClienteSinLista;
  if (!sinLista && !esErrorRateMoneda(err.message)) return false;
  await marcarMotivoPre(id, MOTIVO_PRE_SIN_LISTA);
  // El fallback no siempre tiene el nombre a mano; el mensaje sin el sigue
  // diciendo que hacer.
  res.status(422).json({ error: sinLista ? err.message : MENSAJE_CLIENTE_SIN_LISTA(), codigo: CODIGO_CLIENTE_SIN_LISTA, ...extra });
  return true;
}

// Cliente con moneda extranjera (#297, ADR-0015). Mismo trato que el cliente sin
// lista: no es un fallo de Operam sino un cliente al que el cotizador todavia no
// le puede cotizar, asi que va como 422 CON codigo estructurado y SIN Reintentar
// -- reintentar subiria pesos etiquetados en otra moneda. No marca motivo de PRE:
// el 422 dice el motivo completo en cada intento, y el catalogo de motivos es
// vocabulario del pipeline. Devuelve true si se hizo cargo del error.
function responderSiMonedaExtranjera(res, err, extra = {}) {
  if (!(err instanceof ErrorClienteMonedaExtranjera)) return false;
  res.status(422).json({ error: err.message, codigo: CODIGO_MONEDA_EXTRANJERA, moneda: err.moneda, ...extra });
  return true;
}

// Lock en memoria por id de cotizacion (F3 de la revision de #83): la
// idempotencia de la subida cubre reintentos SECUENCIALES, no concurrencia --
// dos requests EN VUELO al mismo id (auto-subida + Reintentar del Historial, o
// doble click en Elegir candidato) leerian ambos customerId null y crearian DOS
// clientes genericos. Instancia unica en Render (plan Starter): un Set basta -- con
// varias instancias haria falta un lock compartido (Neon). El
// segundo request recibe 425 claro y reintenta cuando el primero termine.
const subidasOperamEnCurso = new Set();

// El lock por RFC real del alta completa (#209) vive desde #366 en
// lib/alta-cliente.js (conLockPorRfc): es del alta, no del handler, y asi lo
// comparten sus tres caminos (ADR-0017).

// Post-fix de la vigencia (#106, ADR-0007). El POST del quote ignora valid_until y deja
// el campo nativo "Valido hasta" en ord_date-1, asi que Operam marca como vencidas
// cotizaciones vivas; se corrige por la web legacy en cuanto el quote existe. NO es
// bloqueante: el quote ya esta subido y comments sigue llevando la vigencia, asi que un
// fallo aqui se reporta como step y nunca tumba la subida. La verificacion post-escritura
// (releer y comparar) sigue el mismo patron que el PUT del branch (#96) y el quirk del
// PUT de clientes, que responde 200 aunque ignore campos.
//
// Desde #403 el mismo POST lleva la LISTA DE PRECIOS del encabezado, el otro campo del
// quote que la API v3 no escribe: el quote nacia con la lista del CLIENTE aunque se
// hubiera cotizado en otra, y de ese encabezado hereda el pedido. Son dos campos
// independientes y se reportan como dos pasos -- que la lista no se pueda escribir no
// dice nada de la vigencia, ni al reves.
async function postFixQuote(folio, entry) {
  if (folio == null || folio === '') return [];
  const data = entry?.data;
  try {
    const r = await corregirVigenciaQuote(folio, vigenciaDeCotizacion(data), { lista: listaDelQuote(entry) });
    const pasos = [];
    if (r.ok) {
      pasos.push({
        name: 'post-fix vigencia', status: 'ok',
        mensaje: 'La vigencia quedo corregida en Operam',
        detalle: 'quote ' + folio + ' campo Valido hasta',
      });
    } else {
      // verificado false = la vista no traia el campo, asi que no se sabe como quedo; se
      // reporta distinto de "quedo con otra fecha" para no afirmar lo que no se comprobo.
      pasos.push({
        name: 'post-fix vigencia', status: 'warn',
        mensaje: 'Revisa la vigencia de la cotizacion en Operam: pudo no quedar corregida',
        detalle: 'quote ' + folio + ': se esperaba ' + (r.esperado ?? '(sin dato)') + ' y se leyo ' + (r.encontrado ?? '(sin dato)'),
        verificado: r.verificado, esperado: r.esperado, encontrado: r.encontrado,
      });
    }
    const pasoLista = pasoListaQuote(folio, r.lista);
    if (pasoLista) pasos.push(pasoLista);
    return pasos;
  } catch (err) {
    console.error('[post-fix vigencia] fallo en el quote', folio, err.message);
    // El post-fix no llego a escribir NADA, asi que la lista tampoco: se nombra con su
    // motivo real en vez de callarla -- desde #403 el vendedor espera un paso por cada
    // uno de los dos campos, y el silencio se leeria como "la lista si quedo".
    const lista = listaDelQuote(entry);
    return [{
      name: 'post-fix vigencia', status: 'error',
      mensaje: 'No se pudo corregir la vigencia de la cotizacion en Operam',
      detalle: 'quote ' + folio + ': ' + err.message,
    }, ...(lista == null ? [] : [{
      name: 'lista del quote', status: 'warn',
      mensaje: 'Revisa la lista de precios de la cotizacion en Operam: pudo quedar con la del cliente',
      detalle: 'quote ' + folio + ': se esperaba la lista ' + lista + ' y no se envio -- el post-fix fallo antes de escribir: ' + err.message,
      verificado: false, esperado: lista, encontrado: null,
    }]),];
  }
}

// El paso de la lista del encabezado (#403), en dos capas como los demas. Los tres
// desenlaces son distintos a proposito: escrita y verificada, no aplicaba (la
// cotizacion no resuelve lista y el quote se queda con la del cliente, que es lo que
// pasaba siempre antes de #403) y "no quedo", que es lo unico que el vendedor tiene
// que ir a revisar. El detalle dice si se escribio y no pego o si ni se intento, con
// el motivo real -- nunca "Operam lo ignoro" sobre un campo que no viajo (#379).
function pasoListaQuote(folio, lista) {
  if (!lista) return null;
  const nombre = 'lista del quote';
  if (!lista.aplica) {
    return {
      name: nombre, status: 'omitido',
      mensaje: 'La cotizacion quedo en Operam con la lista de precios que ya tenia el cliente',
      detalle: 'quote ' + folio + ': ' + (lista.motivo ?? 'no habia lista que escribir'),
    };
  }
  if (lista.ok) {
    return {
      name: nombre, status: 'ok',
      mensaje: lista.yaCorrecto
        ? 'La cotizacion ya estaba en Operam con la lista de precios cotizada'
        : 'La lista de precios de la cotizacion quedo corregida en Operam',
      detalle: 'quote ' + folio + ' lista ' + lista.esperado,
    };
  }
  return {
    name: nombre, status: 'warn',
    mensaje: 'Revisa la lista de precios de la cotizacion en Operam: pudo quedar con la del cliente',
    detalle: 'quote ' + folio + ': se esperaba la lista ' + (lista.esperado ?? '(sin dato)') + (lista.escrita
      // Escrita y sin confirmar: el motivo dice si la relectura fallo (y por que) o si
      // Operam contesto con otra lista. Sin el, "se leyo (sin dato)" tapaba la causa.
      ? ' y se leyo ' + (lista.encontrado ?? '(sin dato)') + (lista.motivo ? ' -- ' + lista.motivo : '')
      : ' y no se envio -- ' + (lista.motivo ?? 'sin motivo')),
    verificado: lista.verificado, esperado: lista.esperado, encontrado: lista.encontrado,
  };
}

// El almacen del que se entrega, cuando el domicilio nuevo lo movio (#409). NO es un
// error del cotizador ni de la subida: FA lo deriva del `default_location` del
// DOMICILIO, asi que un domicilio mal configurado en Operam arrastra el almacen sin
// que nadie lo pida -- y el pedido que se derive lo hereda. Por eso sale como `warn`
// accionable y nombra el almacen (el vendedor reconoce "Almacen MP", no un loc_code).
// Sin cambio no se pinta ningun paso: un aviso que aparece siempre deja de leerse.
function pasoAlmacenQuote(folio, almacen) {
  if (!almacen || !almacen.cambio) return null;
  return {
    name: 'almacen de entrega',
    status: 'warn',
    mensaje: `El domicilio elegido cambio el almacen de entrega a "${almacen.a}". Si no es el correcto, el domicilio esta mal configurado en Operam.`,
    detalle: 'quote ' + folio + ': el almacen paso de ' + almacen.de + ' a ' + almacen.a +
      ' porque Operam lo toma del domicilio (default_location del branch)',
  };
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
    // otraRazonSocial (#345) = el vendedor vio la pregunta y contesto que si: el
    // Cliente Operam al que se sube es otra razon social del MISMO Contacto, asi
    // que la liga se agrega a las que ya tenia en vez de bloquear la subida.
    const customerIdElegido = req.body?.customerId ?? null;
    const crearNuevo = req.body?.crearNuevo === true;
    const sucursalDe = req.body?.sucursalDe ?? null;
    const otraRazonSocial = req.body?.otraRazonSocial === true;
    if (customerIdElegido != null || sucursalDe != null || necesitaAltaGenerica(entry)) {
      // await: el finally debe liberar el lock hasta que la operacion termine.
      return await subirConAltaGenerica(res, id, entry, customerIdElegido, crearNuevo, sucursalDe, otraRazonSocial);
    }
    // Camino normal: el Cliente Operam ya lo eligio el vendedor en el paso Cliente
    // ("Ya lo conozco"). Aqui tambien nace una liga Contacto -> Cliente Operam
    // (#345): sin ella, cotizarle al restaurante desde el celular propio de la
    // compradora dejaba al Contacto sin ningun Cliente Operam, y la unica forma de
    // ligarlo era dar de alta uno sin datos fiscales que duplicaba al que ya
    // existia. Con el Contacto ya ligado a OTRO Cliente Operam se pregunta,
    // exactamente igual que en el alta generica.
    // Sin customerId en la cotizacion (cliente resuelto por RFC dentro de
    // subirCotizacionOperam) no hay a quien ligar todavia: no se inventa.
    const contactoSubida = await contactoDeLaSubida(entry);
    const ligasSubida = ligasDeContacto(contactoSubida?.data);
    const decisionLiga = decidirLiga(ligasSubida, entry.data?.cliente?.customerId ?? null, { confirmado: otraRazonSocial });
    if (decisionLiga.accion === 'confirmar') {
      return await responderConfirmarOtraRazonSocial(res, {
        contacto: contactoSubida, ligadas: ligasSubida, clienteId: entry.data.cliente.customerId,
      });
    }
    try {
      const folio = await subirCotizacionOperam(entry.data);
      // Persistir el folio: la cotizacion deja de ser pre-cotizacion (#63).
      if (folio != null && folio !== '') {
        await cotStore.setFolioOperam(id, folio);
        // Huella de lo que quedo en el quote (#114): sin ella la proxima regeneracion
        // no puede saber si el contenido cambio, que es lo que decide si hay que
        // reescribir el quote o dejarlo en paz.
        await cotStore.actualizarDatos(id, { huellaQuote: huellaContenidoQuote(entry.data, { listaId: listaDelQuote(entry) }) });
        await marcarMotivoPre(id, null);
      }
      const pasosPostFix = await postFixQuote(folio, entry);
      // La liga solo se anota cuando el quote ya existe: sin folio no hubo venta
      // que ligar, y el reintento vuelve a pasar por aqui.
      const pasosLiga = [];
      if (folio != null && folio !== '' && contactoSubida && decisionLiga.accion === 'agregar') {
        await agregarLigaAlContacto(contactoSubida, entry.data.cliente.customerId, entry, pasosLiga);
      }
      res.json({ ok: true, folio, steps: [...pasosPostFix, ...pasosLiga] });
    } catch (err) {
      // Cliente no identificado (#68): es un problema de datos de la cotizacion,
      // no de disponibilidad de Operam. 422 con el mensaje claro, sin subir.
      if (/identificar el cliente/i.test(err.message)) {
        return res.status(422).json({ error: err.message });
      }
      // Cliente sin lista de precios (#285): tampoco es indisponibilidad de Operam.
      if (await responderSiClienteSinLista(res, id, err)) return;
      // Cliente con moneda extranjera (#297): el cotizador no puede subir este
      // quote hasta que exista el soporte de moneda.
      if (responderSiMonedaExtranjera(res, err)) return;
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

    const r = await actualizarQuoteOperam(entry.folioOperam, entry.data, { lista: listaDelQuote(entry) });
    const pasoLista = pasoListaQuote(entry.folioOperam, r.lista);
    const pasoAlmacen = pasoAlmacenQuote(entry.folioOperam, r.almacen);
    if (r.ok) {
      // Nueva huella (#114): el quote acaba de quedar con ESTE contenido, asi que
      // regenerar el mismo carrito (otro formato) ya no debe reescribir nada.
      await cotStore.actualizarDatos(id, { quoteDesactualizado: null, huellaQuote: huellaContenidoQuote(entry.data, { listaId: listaDelQuote(entry) }) });
      return res.json({
        ok: true, folio: entry.folioOperam, actualizada: true,
        steps: [{ name: 'actualizar quote', status: 'ok' }, ...(pasoLista ? [pasoLista] : []), ...(pasoAlmacen ? [pasoAlmacen] : [])],
      });
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
      steps: [
        { name: 'actualizar quote', status: 'error', error: r.error ?? null, discrepancias: r.discrepancias ?? [] },
        ...(pasoLista ? [pasoLista] : []),
        ...(pasoAlmacen ? [pasoAlmacen] : []),
      ],
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
  if (!esHostDelSat(parsed.hostname)) {
    return res.status(400).json({ error: 'URL no pertenece al SAT' });
  }
  try {
    const { status, html } = await descargarValidadorQR(url);
    if (status !== 200) return res.status(502).json({ error: `SAT respondio ${status}` });
    const texto = htmlATexto(html);
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
  // Listas habilitadas (#300): este PUT escribe los mismos campos del cliente sin
  // pasar por ningun panel, asi que el permiso tambien se exige aqui -- dejarlo
  // fuera seria dejarlo en manos de la pantalla.
  const rechazoLista = await rechazoListaCliente(req.user, campos.sales_type, () => listaActualDeCliente(req.params.id));
  if (rechazoLista) return res.status(403).json({ error: rechazoLista });
  try {
    await actualizarClienteDirecto(req.params.id, campos);
    res.json({ ok: true });
  } catch (err) {
    res.status(503).json({ error: 'No se pudo actualizar en Operam: ' + err.message });
  }
});

// --- CSF: upgrade del cliente generico con los datos fiscales reales (issue #85, ADR-0006) ---
//
// Desde #367 (ADR-0017) la operacion entera vive en lib/alta-cliente.js
// (upgradeFiscal): el gate anti-fusion, el PUT con el eco, el post-fix del segmento y
// la relectura que compara. Aqui solo queda la traduccion HTTP -- Solicitud <- body,
// resultado -> status -- mas el respaldo de la constancia en Dropbox, que no es del
// alta sino de este endpoint.
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

  // Listas habilitadas (#300): la Seccion 2 de este panel puede mover la lista de
  // precios del cliente. Cambiarla exige la celda; conservar la que el cliente ya
  // tiene -- lo que Operam dice, no lo que diga el navegador -- siempre es valido.
  // Va antes de upgradeFiscal: un rechazo no escribe nada.
  const rechazoLista = await rechazoListaCliente(req.user, csfDatos.salesType, () => listaActualDeCliente(id));
  if (rechazoLista) return res.status(403).json({ error: rechazoLista });

  const resultado = await upgradeFiscal(id, csfDatos);
  if (resultado.tipo === 'bloqueo') {
    // La fusion es la unica parada con nombre propio para el navegador: identifica al
    // Cliente Operam dueno del RFC para que el vendedor sepa contra quien fusionar.
    if (resultado.motivo === 'fusion') {
      return res.status(409).json({ error: resultado.mensaje, fusion: true, dueno: resultado.dueno });
    }
    if (resultado.motivo === 'cust-ref-duplicado') {
      return res.status(409).json({ error: resultado.mensaje, codigo: 'CUST_REF_DUPLICADO', nombreCorto: resultado.nombreCorto });
    }
    return res.status(503).json({ error: resultado.mensaje, detalle: resultado.detalle });
  }

  // Respaldo de la constancia (fire-and-forget, como en /api/crear-cliente): es del
  // endpoint, no del alta -- el modulo no conoce Dropbox ni el PDF.
  if (pdf_base64) {
    import('./lib/dropbox.js').then(({ subirCsfDropbox }) =>
      subirCsfDropbox(pdf_base64, rfc, csfDatos.razonSocial)
        .then(() => marcarDropbox(resultado.logId, true))
        .catch(err => {
          console.error('[dropbox]', err.message);
          return marcarDropbox(resultado.logId, false);
        })
    );
  }
  res.json({
    ok: true,
    customer_id: Number(id),
    // El navegador sigue leyendo camposNoActualizados: la llave del contrato HTTP no
    // cambia porque el modulo la nombre camposNoAplicados.
    camposNoActualizados: resultado.camposNoAplicados,
    verificacionFallida: resultado.pasos.some(p => p.name === 'verificar fiscal' && p.status === 'error'),
    segmento: resultado.segmento,
    pasos: resultado.pasos,
  });
});

// --- CSF: crear cliente desde datos de CSF ---

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

// El customer_id del formulario significa una de dos cosas, y las dos terminan en
// la MISMA decision (#366): un Cliente Operam EXISTENTE elegido por dedup
// (`cliente_existente`, por RFC o por celular) o el reintento de un alta que ya
// creo el cliente. En ambos el cliente ya existe y hay que reusarlo, asi que la
// casilla del navegador viaja solo como pista: quien decide si el domicilio de
// entrega es nuevo -- y por lo tanto si se escribe -- es el modulo, con su propia
// bandera (ADR-0017). Es lo que cierra #250, donde esa casilla gobernaba el PUT.
// Desde #368 el formulario tambien contesta la pregunta de duplicado: `decision`
// llega tal cual el servidor la dicto en el 428 ({ tipo, clienteId, domicilioId? }).
// El `customer_id` sobrevive como compatibilidad -- significa lo mismo, "usar" --
// para el reintento del boton generico y para el alta que ya venia con un cliente
// elegido por la dedup previa del navegador.
const DECISIONES_ALTA = new Set(['usar', 'otro-domicilio', 'ninguno']);

// El Cliente Operam sobre el que un alta va a escribir cuando REUTILIZA uno (#300):
// misma regla que aplica lib/alta-cliente.js -- solo 'usar' y 'otro-domicilio' caen
// sobre un cliente que ya existe; 'ninguno' crea uno nuevo, asi que ahi no hay lista
// actual que conservar por mucho que el cuerpo traiga un clienteId.
function clienteReutilizadoDelAlta(body) {
  const d = decisionDelFormulario(body);
  return d && (d.tipo === 'usar' || d.tipo === 'otro-domicilio') ? d.clienteId : null;
}

function decisionDelFormulario(body) {
  const d = body?.decision;
  if (d && DECISIONES_ALTA.has(d.tipo)) {
    return {
      tipo: d.tipo,
      clienteId: d.clienteId ?? null,
      ...(d.domicilioId != null && d.domicilioId !== '' ? { domicilioId: d.domicilioId } : {}),
    };
  }
  const id = body?.customer_id;
  return id ? { tipo: 'usar', clienteId: id } : null;
}

// La Solicitud de alta armada desde el formulario de la vista Clientes (#366,
// ADR-0017): TODA la traduccion del body HTTP hacia el modulo. Siempre con datos
// fiscales (la Seccion 1 es una constancia o la captura minima) y con el segmento
// en 'esperar': el vendedor esta mirando el reporte de pasos.
function solicitudDelFormulario(body, vendedor) {
  const b = body || {};
  const entrega = b.entrega || {};
  return {
    contacto: { celular: b.celular_nota || '', prospecto: null, ligas: [] },
    identidad: {
      razonSocial: b.CustName || '',
      nombreCorto: b.cust_ref || '',
      nombreVisible: b.CustName || '',
      rfc: b.tax_id || '',
      pais: b.pais || 'MX',
    },
    datosFiscales: {
      rfc: b.tax_id || '',
      razonSocial: b.CustName || '',
      regimen: b.cfdi_regimen_fiscal || '',
      idcif: b.idcif || '',
      calle: b.street || '',
      numExt: b.street_number || '',
      numInt: b.suite_number || '',
      colonia: b.district || '',
      cp: b.postal_code || '',
      municipio: b.city || '',
      estado: b.state || '',
      actividades: b.actividades || [],
      csfFecha: b.csf_fecha || '',
    },
    comercial: {
      vendedor,
      // El selector de vendedor manda el operam_id del catalogo, no el nombre.
      salesmanId: b.salesman,
      salesTypeId: b.sales_type || undefined,
      segmentoId: b.segmento_id || undefined,
      correoFacturacion: b.invoice_email || '',
      usoCfdi: b.timbrado_uso_cfdi || '',
    },
    domicilioEntrega: {
      nombre: entrega.br_name || '',
      referenciaCorta: entrega.br_ref || '',
      calle: entrega.addr_street || '',
      numExt: entrega.addr_exterior || '',
      numInt: entrega.addr_interior || '',
      colonia: entrega.addr_colony || '',
      municipio: entrega.addr_city || '',
      estado: entrega.addr_state || '',
      cp: entrega.addr_zip || '',
      referencias: entrega.addr_reference || '',
      telefono: entrega.phone || '',
      correo: entrega.email || '',
    },
    ligaFija: { clienteId: null, domicilioId: b.branch_id ?? null },
    decision: decisionDelFormulario(b),
    segmento: { preferencia: 'esperar' },
    auditoria: { fuente: b.fuente || (b.pdf_base64 ? 'csf-upload' : 'cotizador') },
  };
}

// El resultado del modulo -> HTTP (ADR-0017: el modulo devuelve valores, el
// handler traduce). La pregunta de duplicado sale 428 con sus TRES salidas ya
// serializadas y sin crear nada.
//
// El cuerpo del reintento lo dicta el SERVIDOR (#345, #368): es la MISMA
// Solicitud que llego mas la decision que el vendedor eligio, y el navegador lo
// reenvia TAL CUAL -- asi el modulo no aprende la forma del contrato HTTP y el
// navegador no arma decisiones por su cuenta. El PDF de la constancia NO viaja de
// vuelta: pesa (va en base64) y el navegador todavia lo tiene en memoria, asi que
// lo vuelve a adjuntar al reintentar.
function cuerpoDeReintento(body, decision) {
  const { pdf_base64: _pdf, ...sinPdf } = body || {};
  return { ...sinPdf, decision };
}

// El candidato en palabras del glosario, con `porque` = los hechos crudos que el
// modulo calculo (#210). Ninguno bloquea ninguna salida: el vendedor decide.
function candidatoDeLaPregunta(c) {
  return {
    id: c.id,
    razonSocial: c.CustName || '',
    rfc: c.tax_id || '',
    nombreCorto: c.cust_ref || '',
    porque: {
      diferenciaNombre: c.diferenciaNombre,
      celularMatch: c.celularMatch,
      correoMatch: c.correoMatch,
      custRefIgual: c.custRefIgual,
    },
  };
}

// Como se llama en el contrato HTTP cada salida por candidato. QUE salidas hay lo
// decide el MODULO y viaja en `alta.opciones` (ADR-0017: el modulo devuelve la
// decision, el handler arma el cuerpo); aqui solo se sabe serializar cada una, y
// por eso las tres salidas no vuelven a enumerarse.
const LLAVE_SALIDA_CANDIDATO = { usar: 'usar', 'otro-domicilio': 'otroDomicilio' };

// Las salidas de la Deduplicacion de cliente (CONTEXT.md) ya serializadas: las que
// van por candidato ("usar este Cliente Operam", "es otro domicilio de este
// cliente") y la global ("ninguno es el mismo"). Con varios domicilios el
// navegador le agrega `decision.domicilioId` al cuerpo de `usar` tras elegir.
function opcionesDeLaPregunta(body, candidatos, salidas) {
  const hay = new Set(salidas || []);
  const porCandidato = (candidatos || []).map(c => {
    const fila = { id: c.id };
    for (const [salida, llave] of Object.entries(LLAVE_SALIDA_CANDIDATO)) {
      if (hay.has(salida)) fila[llave] = cuerpoDeReintento(body, { tipo: salida, clienteId: c.id });
    }
    return fila;
  });
  return {
    porCandidato,
    ...(hay.has('ninguno') ? { ninguno: cuerpoDeReintento(body, { tipo: 'ninguno' }) } : {}),
  };
}

app.post('/api/crear-cliente', authMiddleware, async (req, res) => {
  const cliente = req.body;
  if (!cliente?.tax_id) return res.status(400).json({ error: 'Falta el RFC (tax_id)' });
  // Listas habilitadas (#300): asignarle una lista a un cliente es mas permanente
  // que fijarla en una cotizacion -- queda escrita en el ERP y gobierna lo que
  // Operam facture despues --, asi que la gobierna la misma matriz. Va ANTES de
  // darDeAlta: un alta rechazada no escribe nada en Operam. Sobre un Cliente Operam
  // reutilizado, conservar la lista que ya tiene sigue siendo valido.
  const rechazoLista = await rechazoListaCliente(
    req.user, cliente.sales_type,
    () => listaActualDeCliente(clienteReutilizadoDelAlta(cliente))
  );
  if (rechazoLista) return res.status(403).json({ error: rechazoLista });
  marcarTelefonoSospechoso(cliente);

  const alta = await darDeAlta(solicitudDelFormulario(cliente, req.user.name));

  // Respaldo de la constancia en Dropbox (#24/#350): no es del alta, es del
  // archivo que el vendedor solto. Fire-and-forget, y solo cuando esta alta creo
  // al cliente -- sobre uno que ya existia no hay constancia nueva que archivar.
  // #356: el resultado de la subida vuelve a la fila de auditoria del alta
  // (clientes_log.dropbox_ok), que hasta ahora era siempre null porque al
  // insertarla la promesa todavia no resolvia. El detalle del fallo -- flujo,
  // destino y mensaje -- lo guarda el envoltorio comun de lib/dropbox.js.
  if (cliente.pdf_base64 && alta.creadoNuevo) {
    import('./lib/dropbox.js').then(({ subirCsfDropbox }) =>
      subirCsfDropbox(cliente.pdf_base64, cliente.tax_id, cliente.CustName)
        .then(() => marcarDropbox(alta.logId, true))
        .catch(err => {
          console.error('[dropbox]', err.message);
          return marcarDropbox(alta.logId, false);
        })
    );
  }

  if (alta.tipo === 'pregunta') {
    // 428 y NADA escrito: el navegador ya pre-consulta la dedup, asi que llegar
    // aqui significa que se le escapo un posible duplicado. El vendedor elige una
    // de las tres salidas y el navegador reintenta con el cuerpo que va aqui.
    const candidatos = alta.candidatos || [];
    return res.status(428).json({
      codigo: 'POSIBLE_DUPLICADO',
      // Mensaje en dos capas (CONTEXT.md): el vendedor lee `error` y el `detalle`
      // -- de que pool salieron estos candidatos -- va plegado bajo la pregunta.
      error: alta.mensaje,
      detalle: alta.detalle || '',
      candidatos: candidatos.map(candidatoDeLaPregunta),
      opciones: opcionesDeLaPregunta(cliente, candidatos, alta.opciones),
    });
  }

  if (alta.tipo === 'bloqueo') {
    // El nombre corto ya usado es un hecho duro de Operam, no una falla suya: el
    // vendedor tiene que cambiarlo, no reintentar (#242). El customer_id viaja
    // aunque el alta se haya bloqueado, para que un reintento reuse ese cliente.
    const cuerpo = { ok: false, error: alta.mensaje, detalle: alta.detalle, customer_id: alta.clienteId ?? null, branch_id: null, steps: alta.pasos };
    if (alta.motivo === 'cust-ref-duplicado') return res.status(409).json({ ...cuerpo, codigo: 'CUST_REF_DUPLICADO' });
    if (alta.motivo === 'liga-fija') return res.status(409).json(cuerpo);
    // El mismo RFC real de otro Cliente Operam (#377) es un conflicto que el vendedor
    // resuelve, no una falla de Operam: 409 como la liga fija, jamas el 503 del ERP.
    if (alta.motivo === 'fusion') return res.status(409).json(cuerpo);
    return res.status(503).json(cuerpo);
  }

  ligarProspectoACliente(cliente, alta.clienteId, req.user.name)
    .catch(err => console.error('[prospectos] No se pudo ligar prospecto a cliente:', err.message));
  res.json({ ok: true, customer_id: alta.clienteId, branch_id: alta.domicilioId, duplicado: false, steps: alta.pasos });
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
    // sugerencia se mueve sola. Es el primer dia habil despues de la expo.
    const evento = eventoActivoConfigurado();
    res.json({
      segmentos: SEGMENTOS, vendedores, listas_precios: await obtenerListasPrecios(),
      // Listas habilitadas (#300): el catalogo COMPLETO sigue viajando -- de ahi sale
      // el nombre de la lista que el cliente ya tiene, que el selector ofrece aunque
      // no este habilitada -- y aparte van las que quien captura puede asignar. Quien
      // filtra el selector es el nucleo puro (opcionesListaCliente); esto solo decide
      // que se pinta, y el servidor lo vuelve a exigir en cada escritura.
      listasHabilitadas: await listasAsignablesDeUsuario(req.user),
      puedeAsignar: puedeAsignar({ role: req.user?.role, puedeAsignar: yo?.puedeAsignar }),
      eventoActivo: evento && { ...evento, siguienteContactoSugerido: primerDiaHabilDespues(evento.fin) },
      catalogoUrl: config.catalogoUrl || '',
      sitioUrl: config.sitioUrl || '',
      // #323: base de la instalacion de Operam, para la liga "Ver en Operam" de
      // la Tabla de prospectos (ficha del cliente en la web legacy). Sin barra
      // final, como arma la liga lib/operam-web.js.
      operamUrl: String(process.env.OPERAM_URL || '').replace(/\/+$/, ''),
      asesores: registro.map(v => v.name),
    });
  } catch (err) {
    res.status(500).json({ error: 'Registro de vendedores no disponible: ' + err.message });
  }
});

app.get('/admin', (req, res) => {
  res.sendFile(join(PUBLIC_DIR, 'admin.html'));
});

// Maestro de articulos (#310). El HTML va sin auth, igual que /admin: los datos
// los pide a /api/admin/modelos con el token de administrador.
app.get('/admin/catalogo', (req, res) => {
  res.sendFile(join(PUBLIC_DIR, 'admin-catalogo.html'));
});

// Tabla de prospectos. El HTML no lleva datos: los pide a /api/prospectos/tabla
// con el token del vendedor, asi que la visibilidad es la de siempre (cada quien
// los suyos, el admin todos) y la liga se puede compartir sin exponer a nadie.
app.get('/prospectos', (req, res) => {
  res.sendFile(join(PUBLIC_DIR, 'prospectos.html'));
});

// La liga vieja de la tabla de la expo (#317): el vendedor la tiene guardada en
// el telefono desde Abastur, asi que no se rompe, redirige.
app.get('/leads', (req, res) => {
  res.redirect('/prospectos');
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
    // El maestro de modelos (#310) crea su tabla y la siembra en el mismo
    // momento: asi la primera visita a /admin/catalogo ya ve las 36 filas.
    .then(() => modelosStore.cargar())
    .catch(err => console.warn('[modelos-store] warm de arranque fallo:', err.message))
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
  // Misma razon para el estado comercial de los Clientes Operam (#344): la
  // barrida de pedidos es paginada y la primera pantalla se rendiria antes de
  // que llegara, mostrando "sin actividad" a Clientes Operam que si tienen
  // pedido. Fire-and-forget; un fallo deja el cache vacio y la respuesta lo
  // declara como fuente incompleta.
  refrescarActividad().catch(err => console.warn('[actividad-operam] warm de arranque fallo:', err.message));
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
