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
import { detectarDuplicados } from './lib/deduplicacion.js';
import { parsearCSF } from './lib/parsear-csf.js';
import { query as dbQuery } from './lib/db.js';
import { calcularCola, telefonoValido } from './lib/seguimiento.js';
import * as cotStore from './lib/cotizaciones-store.js';
import * as prospectosStore from './lib/prospectos-store.js';
import { validarProspectoBody, validarTransicion, contarMotivosNoUtil, OPCIONALES as PROSPECTO_OPCIONALES } from './public/js/prospectos-logica.js';

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

const MAYOREO_CODES = new Set(['M100','M350','M550','M1500','M6000','M6001','US100','US350','US550','US1500','US6000']);

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
  res.json(filtradas.map(({ id, fecha, vendedor, cliente, totalPiezas, total, tier, data }) => ({
    id, fecha, vendedor, cliente, totalPiezas, total, tier,
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

// --- Prospectos (issue #41, ADR-0004) ---

app.post('/api/prospectos', authMiddleware, async (req, res) => {
  const body = req.body || {};
  const error = validarProspectoBody(body);
  if (error) return res.status(400).json({ error });
  const existente = await prospectosStore.buscarPorCelular(body.celular);
  if (existente) {
    const visible = req.user.role === 'admin' || existente.vendedor === req.user.name;
    return res.status(409).json({
      error: 'Este celular ya es un prospecto',
      ...(visible ? { prospecto: existente } : {}),
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
    const verlo = dup && (req.user.role === 'admin' || dup.vendedor === req.user.name);
    return res.status(409).json({
      error: 'Este celular ya es un prospecto',
      ...(verlo ? { prospecto: dup } : {}),
    });
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

app.patch('/api/prospectos/:id/etapa', authMiddleware, async (req, res) => {
  const { etapa, motivo } = req.body || {};
  const p = await prospectoOperable(req, res);
  if (!p) return;
  const error = validarTransicion(p.etapa, etapa, motivo);
  if (error) return res.status(400).json({ error });
  const evento = etapa === 'no_util'
    ? { tipo: 'no_util', motivo, fecha: new Date().toISOString(), vendedor: req.user.name }
    : { tipo: 'etapa', de: p.etapa, a: etapa, fecha: new Date().toISOString(), vendedor: req.user.name };
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

app.get('/api/admin/prospectos/no-util', authMiddleware, adminMiddleware, async (req, res) => {
  const todos = await prospectosStore.listar();
  res.json(contarMotivosNoUtil(todos));
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
    res.json({ ok: true, folio });
  } catch (err) {
    res.status(503).json({ error: 'No se pudo subir a Operam: ' + err.message });
  }
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
    listasPrecios = tipos
      .filter(t => MAYOREO_CODES.has(t.sales_type_id))
      .map(t => ({ id: t.sales_type_id, nombre: t.description || t.sales_type_id }));
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
