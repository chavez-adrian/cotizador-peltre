import express from 'express';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { extractPrices, diffPrices } from './lib/extract-prices.js';
import { generateQuotePDF } from './lib/pdf-generator.js';
import { generateQuoteHTML } from './lib/html-generator.js';
import { calcularPaquetes } from './lib/calcular-envio.js';
import { buscarClientes, obtenerDomicilios, subirCotizacionOperam, actualizarCliente, actualizarClienteDirecto, buscarClientePorRFC, crearCliente, actualizarBranchCliente, obtenerBranchId } from './lib/operam-client.js';
import { reconciliarPorIdentificador, reconciliarOportunidad, esActivaPostVentaCandidata } from './lib/sync-operam-io.js';
import { extraerIdentificador, registrarEvento as registrarEventoWebhook, marcarProcesado } from './lib/sync-operam-webhook.js';
import { detectarDuplicados } from './lib/deduplicacion.js';
import { parsearCSF } from './lib/parsear-csf.js';
import { query as dbQuery } from './lib/db.js';
import { calcularCola, telefonoValido, telefonoWa } from './lib/seguimiento.js';
import { calcularColaProspectos } from './lib/seguimiento-prospectos.js';
import { calcularColaHoy } from './lib/cola-hoy.js';
import * as cotStore from './lib/cotizaciones-store.js';
import * as prospectosStore from './lib/prospectos-store.js';
import { clasificarCelular } from './lib/clasificar-celular.js';
import { importarProspectosFeria } from './lib/importar-prospectos.js';
import { refrescarIndice, matchCliente } from './lib/indice-telefonos.js';
import { transicionPorCotizacion, transicionPorAsignacion, esSalida } from './lib/pipeline.js';
import { validarProspectoBody, validarTransicion, contarMotivosNoUtil, reunionPendienteResultado, reunionPendienteResultadoDe, validarEdicionProspecto, buildEdicionProspectoDatos, CANALES, MOTIVOS_NO_UTIL, OPCIONALES as PROSPECTO_OPCIONALES } from './public/js/prospectos-logica.js';
import { PASOS_DECORADO, checklistInicial, marcarPaso, revertirPaso, progresoDecorado, puedeLiberar } from './public/js/decorados-logica.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');
const PUBLIC_DIR = join(__dirname, 'public');
const PDFS_DIR = join(DATA_DIR, 'pdfs');
const HTMLS_DIR = join(DATA_DIR, 'htmls');

if (!existsSync(PDFS_DIR)) mkdirSync(PDFS_DIR, { recursive: true });
if (!existsSync(HTMLS_DIR)) mkdirSync(HTMLS_DIR, { recursive: true });

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

app.post('/api/login', (req, res) => {
  const { vendedorId, pin } = req.body;
  const vendedores = readJSON('vendedores.json');
  if (!vendedores) return res.status(500).json({ error: 'Vendedores no configurados' });
  const v = vendedores.find(v => v.id === vendedorId && v.pin === pin);
  if (!v) return res.status(401).json({ error: 'PIN incorrecto' });
  const token = jwt.sign({ id: v.id, name: v.name, role: v.role }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id: v.id, name: v.name, role: v.role } });
});

app.get('/api/vendedores', (req, res) => {
  const vendedores = readJSON('vendedores.json');
  if (!vendedores) return res.status(500).json({ error: 'Vendedores no configurados' });
  res.json(vendedores.map(v => ({ id: v.id, name: v.name })));
});

app.get('/api/precios', authMiddleware, (req, res) => {
  const precios = readJSON('precios.json');
  if (!precios) return res.status(500).json({ error: 'Precios no disponibles' });
  const config = readJSON('config.json') || {
    tiposActivos: precios.tiposProducto || [],
    texturasActivas: Object.keys(precios.texturas || {}).map(Number).filter(t => ![0, 8, 9].includes(t)),
  };
  res.json({ ...precios, config });
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

app.post('/api/cotizacion/pdf', authMiddleware, async (req, res) => {
  if (!validarTelefonoCotizacion(req, res)) return;
  try {
    const data = req.body;
    data.vendedor = req.user.name;
    const id = await cotStore.crear({
      fecha: new Date().toISOString(), vendedor: req.user.name,
      cliente: data.cliente?.nombreCorto || data.cliente?.razonSocial || 'Sin nombre',
      totalPiezas: data.items?.reduce((s, i) => s + (i.cantidad || 0), 0) || 0,
      total: data.total || 0, tier: data.tier || '', data,
    });
    await actualizarEmbudoPorCotizacion(data, id, req.user.name);
    const pdfBuffer = await generateQuotePDF(data);
    writeFileSync(join(PDFS_DIR, `cot_${id}.pdf`), pdfBuffer);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="Cotizacion_PeltreNacional_${id}.pdf"`,
      'X-Cotizacion-Id': String(id),
    });
    res.send(pdfBuffer);
  } catch (err) {
    console.error('Error generando PDF:', err);
    res.status(500).json({ error: 'Error generando PDF' });
  }
});

app.post('/api/cotizacion/html', authMiddleware, async (req, res) => {
  if (!validarTelefonoCotizacion(req, res)) return;
  try {
    const data = req.body;
    data.vendedor = req.user.name;
    const id = await cotStore.crear({
      fecha: new Date().toISOString(), vendedor: req.user.name,
      cliente: data.cliente?.nombreCorto || data.cliente?.razonSocial || 'Sin nombre',
      totalPiezas: data.items?.reduce((s, i) => s + (i.cantidad || 0), 0) || 0,
      total: data.total || 0, tier: data.tier || '', data,
    });
    await actualizarEmbudoPorCotizacion(data, id, req.user.name);
    const incluirFotos = !!data.incluirFotos;
    data.id = id;
    const html = generateQuoteHTML(data, { incluirFotos });
    writeFileSync(join(HTMLS_DIR, `cot_${id}.html`), html, 'utf8');
    res.set({ 'Content-Type': 'text/html; charset=utf-8', 'X-Cotizacion-Id': String(id) });
    res.send(html);
  } catch (err) {
    console.error('Error generando HTML:', err);
    res.status(500).json({ error: 'Error generando HTML' });
  }
});

app.get('/api/cotizacion/html/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID invalido' });
  const htmlPath = join(HTMLS_DIR, `cot_${id}.html`);
  if (!existsSync(htmlPath)) return res.status(404).send('<p>HTML no encontrado</p>');
  res.set({ 'Content-Type': 'text/html; charset=utf-8' });
  res.sendFile(htmlPath);
});

app.get('/api/cotizacion/pdf/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID invalido' });
  const pdfPath = join(PDFS_DIR, `cot_${id}.pdf`);
  if (!existsSync(pdfPath)) return res.status(404).json({ error: 'PDF no encontrado' });
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `inline; filename="Cotizacion_PeltreNacional_${id}.pdf"`,
  });
  res.sendFile(pdfPath);
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
    telefono: telefonoWa(data?.cliente?.celEntrega || data?.cliente?.telefono),
    hasData: !!data,
    hasPdf: existsSync(join(PDFS_DIR, `cot_${id}.pdf`)),
  })));
});

app.get('/api/cotizaciones/:id', authMiddleware, async (req, res) => {
  const id = parseInt(req.params.id);
  const entry = await cotStore.obtener(id);
  if (!entry) return res.status(404).json({ error: 'No encontrada' });
  if (req.user.role !== 'admin' && entry.vendedor !== req.user.name) {
    return res.status(403).json({ error: 'Sin acceso' });
  }
  res.json(entry.data);
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
app.get('/api/hoy', authMiddleware, async (req, res) => {
  const prospectos = await prospectosStore.listar();
  const cotizaciones = await cotStore.listar();
  const esAdmin = req.user.role === 'admin';
  const prospectosVisibles = esAdmin ? prospectos : prospectos.filter(p => p.vendedor === req.user.name);
  const cotizacionesVisibles = esAdmin ? cotizaciones : cotizaciones.filter(c => c.vendedor === req.user.name);
  res.json(calcularColaHoy(prospectosVisibles, cotizacionesVisibles, new Date()));
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
// (CONTEXT.md, Visibilidad de prospectos).
function respuestaProspectoExistente(res, existente, user) {
  const visible = user.role === 'admin' || existente.vendedor === user.name;
  return res.status(409).json(
    visible
      ? { error: 'Este celular ya es un prospecto', prospecto: existente }
      : { error: `Este celular ya lo atiende ${existente.vendedor}` }
  );
}

app.post('/api/prospectos', authMiddleware, async (req, res) => {
  const body = req.body || {};
  const error = validarProspectoBody(body);
  if (error) return res.status(400).json({ error });
  // Guardrail best effort (CONTEXT.md, Prospecto): un cliente con alta en Operam
  // nunca vuelve a ser prospecto. Si el indice falla o no esta listo, la
  // clasificacion cae a libre y la captura procede.
  const clasificacion = await clasificarCelular(body.celular);
  if (clasificacion.tipo === 'prospecto') {
    return respuestaProspectoExistente(res, clasificacion.prospecto, req.user);
  }
  if (clasificacion.tipo === 'cliente') {
    return res.status(409).json({
      error: `Este celular es del cliente ${clasificacion.cliente.cust_name} - cotizale como cliente, no se crea prospecto`,
    });
  }
  const data = {};
  for (const k of PROSPECTO_OPCIONALES) {
    if (body[k] !== undefined && body[k] !== null && body[k] !== '') data[k] = body[k];
  }
  let id;
  try {
    id = await prospectosStore.crear({
      fecha: new Date().toISOString(), vendedor: req.user.name,
      celular: body.celular.trim(), nombre: body.nombre.trim(),
      ciudad: body.ciudad.trim(), canal: body.canal, data,
    });
  } catch (e) {
    if (e.code !== '23505') throw e;
    const dup = await prospectosStore.buscarPorCelular(body.celular);
    if (dup) return respuestaProspectoExistente(res, dup, req.user);
    return res.status(409).json({ error: 'Este celular ya es un prospecto' });
  }
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
    return res.status(409).json({
      error: `Este celular es del cliente ${clasificacion.cliente.cust_name} - cotizale como cliente, no se crea prospecto`,
    });
  }
  const data = {};
  for (const k of PROSPECTO_OPCIONALES) {
    if (body[k] !== undefined && body[k] !== null && body[k] !== '') data[k] = body[k];
  }
  let id;
  try {
    id = await prospectosStore.crear({
      fecha: new Date().toISOString(), vendedor: null,
      celular: body.celular.trim(), nombre: body.nombre.trim(),
      ciudad: body.ciudad.trim(), canal: body.canal, etapa: 'no_asignado', data,
    });
  } catch (e) {
    if (e.code !== '23505') throw e;
    const dup = await prospectosStore.buscarPorCelular(body.celular);
    if (dup) return respuestaProspectoExistente(res, dup, req.user);
    return res.status(409).json({ error: 'Este celular ya es un prospecto' });
  }
  res.status(201).json({ ok: true, id });
});

app.get('/api/prospectos', authMiddleware, async (req, res) => {
  const todos = await prospectosStore.listar();
  const visibles = req.user.role === 'admin'
    ? todos
    : todos.filter(p => p.vendedor === req.user.name);
  res.json(visibles);
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

async function prospectoOperable(req, res) {
  const p = await prospectosStore.obtener(parseInt(req.params.id));
  if (!p) {
    res.status(404).json({ error: 'No encontrado' });
    return null;
  }
  if (req.user.role !== 'admin' && p.vendedor !== req.user.name) {
    res.status(403).json({ error: 'Sin acceso' });
    return null;
  }
  return p;
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
  await prospectosStore.actualizarDatos(p.id, buildEdicionProspectoDatos(req.body));
  res.json({ ok: true });
});

// Asignar un vendedor a una tarjeta en No Asignado (issue #57, CONTEXT.md
// "Etapas del pipeline" + "Visibilidad"): admin-only (solo quien asigna ve No
// Asignado). La transicion de etapa la decide la regla de dominio
// (transicionPorAsignacion) -- desde no_asignado -> por_cotizar; la capa de IO
// (asignarVendedor) la aplica. El vendedor elegido debe estar en el catalogo
// (data/vendedores.json, la misma fuente que pobla el selector en /api/catalogos).
app.patch('/api/prospectos/:id/asignar', authMiddleware, adminMiddleware, async (req, res) => {
  const { vendedor } = req.body || {};
  const catalogo = (readJSON('vendedores.json') || []).filter(v => v.operam_id != null);
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
});

app.patch('/api/prospectos/:id/etapa', authMiddleware, async (req, res) => {
  const { etapa, motivo, folio } = req.body || {};
  const p = await prospectoOperable(req, res);
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

// Importacion de prospectos de Feria/Expo (issue #47, CONTEXT.md "Captura de
// prospecto"): la plataforma del evento entrega un XLSX de gafetes escaneados
// que se importa deduplicando por celular. La fecha del prospecto es el
// momento de la importacion (la del escaneo queda en data.escaneado): con la
// fecha original toda la cola naceria en rojo con horas habiles vencidas. El
// indice de clientes Operam se refresca UNA VEZ antes del loop (leccion de
// #46, no por fila); si falla, las filas se importan igual (best effort,
// mismo trade-off que la captura manual).
app.post('/api/admin/prospectos/importar', authMiddleware, adminMiddleware, upload.single('archivo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibio archivo' });
  const vendedores = readJSON('vendedores.json') || [];
  const vendedorDefault = req.body?.vendedor || req.user.name;
  let parseo;
  try {
    parseo = importarProspectosFeria(req.file.buffer, { vendedores, vendedorDefault });
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
  for (const p of parseo.listos) {
    const existente = await prospectosStore.buscarPorCelular(p.celular);
    if (existente) {
      descartados.push({ fila: p.fila, nombre: p.nombre, motivo: 'ya es prospecto' });
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
  descartados.sort((a, b) => a.fila - b.fila);
  res.json({ importados, descartados, porVendedor });
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
  const config = readJSON('config.json') || { tiposActivos: [], texturasActivas: [] };
  const precios = readJSON('precios.json') || {};
  res.json({
    config,
    tiposDisponibles: precios.tiposProducto || [],
    tiposNombre: precios.tiposNombre || {},
    texturasDisponibles: precios.texturas || {},
  });
});

app.post('/api/admin/config', authMiddleware, adminMiddleware, (req, res) => {
  const { tiposActivos, texturasActivas } = req.body;
  if (!Array.isArray(tiposActivos) || !Array.isArray(texturasActivas)) {
    return res.status(400).json({ error: 'Formato invalido' });
  }
  writeJSON('config.json', { tiposActivos, texturasActivas });
  res.json({ saved: true });
});

app.get('/api/admin/vendedores', authMiddleware, adminMiddleware, (req, res) => {
  res.json(readJSON('vendedores.json'));
});

app.put('/api/admin/vendedores', authMiddleware, adminMiddleware, (req, res) => {
  const vendedores = req.body;
  if (!Array.isArray(vendedores)) return res.status(400).json({ error: 'Formato invalido' });
  writeJSON('vendedores.json', vendedores);
  res.json({ saved: true });
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
    const raw = await buscarClientes(q);
    const clientes = (Array.isArray(raw) ? raw : []).map(c => {
      const branch = c.branches?.[0] || {};
      return {
        id: c.customer_id, name: c.CustName || '', ref: c.cust_ref || '', rfc: c.tax_id || '',
        calle: titleCase([c.street, c.street_number].filter(Boolean).join(' ')),
        numInt: c.suite_number || '', colonia: titleCase(c.district || ''),
        cp: c.postal_code || '', municipio: titleCase(c.city || ''), estado: titleCase(c.state || ''),
        telefono: branch.phone || c.contacts?.[0]?.phone || '',
        email: branch.email || c.contacts?.[0]?.email || '',
        nombreEntrega: branch.br_name || branch.contact_name || '',
      };
    });
    res.json(clientes);
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

app.patch('/api/operam/clientes/:id', authMiddleware, async (req, res) => {
  const { diff } = req.body || {};
  if (!diff || typeof diff !== 'object') return res.status(400).json({ error: 'diff requerido' });
  try {
    await actualizarCliente(req.params.id, diff);
    res.json({ ok: true });
  } catch (err) {
    res.status(503).json({ error: 'No se pudo actualizar en Operam: ' + err.message });
  }
});

app.post('/api/cotizacion/operam/:id', authMiddleware, async (req, res) => {
  const id = parseInt(req.params.id);
  const entry = await cotStore.obtener(id);
  if (!entry) return res.status(404).json({ error: 'Cotizacion no encontrada' });
  try {
    const folio = await subirCotizacionOperam(entry.data);
    // Persistir el folio: la cotizacion deja de ser pre-cotizacion (#63).
    if (folio != null && folio !== '') await cotStore.setFolioOperam(id, folio);
    res.json({ ok: true, folio });
  } catch (err) {
    // Cliente no identificado (#68): es un problema de datos de la cotizacion,
    // no de disponibilidad de Operam. 422 con el mensaje claro, sin subir.
    if (/identificar el cliente/i.test(err.message)) {
      return res.status(422).json({ error: err.message });
    }
    res.status(503).json({ error: 'No se pudo subir a Operam: ' + err.message });
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

app.post('/api/crear-cliente', authMiddleware, async (req, res) => {
  const cliente = req.body;
  if (!cliente?.tax_id) return res.status(400).json({ error: 'Falta el RFC (tax_id)' });
  const fuente = cliente.fuente || (cliente.pdf_base64 ? 'csf-upload' : 'cotizador');
  const steps = [];
  let customer_id = cliente.customer_id || null;
  let branch_id = cliente.branch_id || null;
  // customer_id ya viaja en el payload: puede ser reintento de un alta nueva (los
  // datos comerciales ya se mandaron en el POST /customers de ese mismo flujo) o un
  // cliente EXISTENTE elegido via deduplicacion (altaState.clienteExistente, issue #31)
  // -- en ese caso el POST /customers nunca corrio y sales_type/segmento_id/salesman/
  // timbrado_uso_cfdi seleccionados en la seccion 2 se perdian en silencio (issue #11,
  // gap confirmado en auditoria de #26). Reenviar esos campos via PUT /customers/:id es
  // idempotente para el caso de reintento (mismos valores que ya fueron al POST) y
  // cierra el gap para el caso de cliente existente -- por eso se ejecuta siempre que
  // el customer_id ya viene resuelto, sin necesidad de distinguir los dos casos.
  const customerIdYaConocido = !!customer_id;

  try {
    // Step 1: POST customer (skip if customer_id already known — reintento)
    if (!customer_id) {
      try {
        const resultado = await crearCliente(cliente);
        if (resultado.duplicado) {
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
      try {
        await actualizarClienteDirecto(customer_id, {
          sales_type: cliente.sales_type,
          segmento_id: cliente.segmento_id,
          salesman: cliente.salesman,
          timbrado_uso_cfdi: cliente.timbrado_uso_cfdi,
        });
        steps.push({ name: 'PUT customer (config comercial)', status: 'ok' });
      } catch (err) {
        steps.push({ name: 'PUT customer (config comercial)', status: 'error', error: err.message });
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

    // Step 3: PUT branch — configure domicilio
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
  const { rfc, nombre } = req.query;
  if (!rfc) return res.status(400).json({ error: 'Falta el parametro rfc' });
  try {
    const raw = await buscarClientes(rfc);
    const clientes = (Array.isArray(raw) ? raw : []).map(c => ({
      ...c,
      RFC: c.tax_id || c.RFC || c.rfc || '',
      id: c.customer_id,
    }));
    const resultado = detectarDuplicados(rfc, nombre || '', clientes);
    res.json(resultado);
  } catch (err) {
    res.status(503).json({ error: 'Operam no disponible: ' + err.message });
  }
});

app.get('/api/catalogos', authMiddleware, (_req, res) => {
  const vendedores = (readJSON('vendedores.json') || [])
    .filter(v => v.operam_id != null)
    .map(v => ({ id: v.id, name: v.name, operam_id: v.operam_id }));
  res.json({ segmentos: SEGMENTOS, vendedores, listas_precios: listasPrecios });
});

app.get('/admin', (req, res) => {
  res.sendFile(join(PUBLIC_DIR, 'admin.html'));
});

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(join(PUBLIC_DIR, 'index.html'));
});

async function cargarListasPrecios() {
  try {
    const r = await fetch(`${process.env.OPERAM_URL}/api/v3/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company: '346', user: process.env.OPERAM_USER, pass: process.env.OPERAM_PASSWORD }),
    });
    const login = await r.json();
    if (!login.token) throw new Error('Login fallido al cargar listas');
    const r2 = await fetch(`${process.env.OPERAM_URL}/api/v3/sales/sales_types`, {
      headers: { 'Authorization': `Bearer ${login.token}`, 'Content-Type': 'application/json' },
    });
    const data = await r2.json();
    const tipos = Array.isArray(data.data) ? data.data : [];
    // Operam v3 (verificado en vivo 2026-06-17): la etiqueta viene en `sales_type`
    // (texto libre: M100, "Precio de lista", "Segundas", "Amazon"...) y el id
    // numerico en `id` -- que es lo que el cliente guarda en su campo sales_type.
    // El selector debe mostrar la etiqueta y mandar el id numerico. Se exponen
    // todas las listas activas.
    listasPrecios = tipos
      .filter(t => t.inactive !== '1' && t.inactive !== 1)
      .map(t => ({ id: t.id, nombre: t.sales_type }));
  } catch (err) {
    console.error('[catalogos] No se pudieron cargar listas_precios:', err.message);
    listasPrecios = [];
  }
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  cargarListasPrecios().then(() => {
    app.listen(PORT, () => console.log(`Cotizador corriendo en http://localhost:${PORT}`));
  });
}
export { app, cargarListasPrecios };
