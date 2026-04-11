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

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');
const PUBLIC_DIR = join(__dirname, 'public');
const PDFS_DIR = join(DATA_DIR, 'pdfs');
const HTMLS_DIR = join(DATA_DIR, 'htmls');

// Asegurar que los directorios existan
if (!existsSync(PDFS_DIR)) mkdirSync(PDFS_DIR, { recursive: true });
if (!existsSync(HTMLS_DIR)) mkdirSync(HTMLS_DIR, { recursive: true });

// .env manual (sin dotenv para mantenerlo simple)
const envFile = join(__dirname, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(PUBLIC_DIR));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// --- Helpers ---

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

// --- Auth ---

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

// --- Precios ---

app.get('/api/precios', authMiddleware, (req, res) => {
  const precios = readJSON('precios.json');
  if (!precios) return res.status(500).json({ error: 'Precios no disponibles' });
  const config = readJSON('config.json') || {
    tiposActivos: precios.tiposProducto || [],
    texturasActivas: Object.keys(precios.texturas || {}).map(Number).filter(t => ![0, 8, 9].includes(t)),
  };
  res.json({ ...precios, config });
});

// --- Cotizacion PDF ---

app.post('/api/cotizacion/pdf', authMiddleware, async (req, res) => {
  try {
    const data = req.body;
    data.vendedor = req.user.name;

    // Log de cotizacion (con datos completos para historial)
    const logPath = join(DATA_DIR, 'cotizaciones.json');
    const log = existsSync(logPath) ? JSON.parse(readFileSync(logPath, 'utf8')) : [];
    const id = log.length + 1;
    const entry = {
      id,
      fecha: new Date().toISOString(),
      vendedor: req.user.name,
      cliente: data.cliente?.nombreCorto || data.cliente?.razonSocial || 'Sin nombre',
      totalPiezas: data.items?.reduce((s, i) => s + (i.cantidad || 0), 0) || 0,
      total: data.total || 0,
      tier: data.tier || '',
      data, // datos completos para poder recargar
    };
    log.push(entry);
    writeJSON('cotizaciones.json', log);

    const pdfBuffer = await generateQuotePDF(data);

    // Guardar PDF en disco para WhatsApp link
    const pdfPath = join(PDFS_DIR, `cot_${id}.pdf`);
    writeFileSync(pdfPath, pdfBuffer);

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

// --- Cotizacion HTML ---

app.post('/api/cotizacion/html', authMiddleware, async (req, res) => {
  try {
    const data = req.body;
    data.vendedor = req.user.name;

    // Reusar o crear entrada en cotizaciones.json
    const logPath = join(DATA_DIR, 'cotizaciones.json');
    const log = existsSync(logPath) ? JSON.parse(readFileSync(logPath, 'utf8')) : [];
    const id = log.length + 1;
    const entry = {
      id,
      fecha: new Date().toISOString(),
      vendedor: req.user.name,
      cliente: data.cliente?.nombreCorto || data.cliente?.razonSocial || 'Sin nombre',
      totalPiezas: data.items?.reduce((s, i) => s + (i.cantidad || 0), 0) || 0,
      total: data.total || 0,
      tier: data.tier || '',
      data,
    };
    log.push(entry);
    writeJSON('cotizaciones.json', log);

    const incluirFotos = !!data.incluirFotos;
    data.id = id;
    const html = generateQuoteHTML(data, { incluirFotos });

    // Guardar HTML en disco
    const htmlPath = join(HTMLS_DIR, `cot_${id}.html`);
    writeFileSync(htmlPath, html, 'utf8');

    res.set({
      'Content-Type': 'text/html; charset=utf-8',
      'X-Cotizacion-Id': String(id),
    });
    res.send(html);
  } catch (err) {
    console.error('Error generando HTML:', err);
    res.status(500).json({ error: 'Error generando HTML' });
  }
});

// Servir HTML guardado por ID
app.get('/api/cotizacion/html/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID invalido' });

  const htmlPath = join(HTMLS_DIR, `cot_${id}.html`);
  if (!existsSync(htmlPath)) return res.status(404).send('<p>HTML no encontrado</p>');

  res.set({ 'Content-Type': 'text/html; charset=utf-8' });
  res.sendFile(htmlPath);
});

// Servir PDF guardado por ID (sin auth — el ID es suficientemente opaco para uso interno)
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

// --- Cotizaciones historial ---

app.get('/api/cotizaciones', authMiddleware, (req, res) => {
  const log = readJSON('cotizaciones.json') || [];
  const filtradas = req.user.role === 'admin'
    ? log
    : log.filter(c => c.vendedor === req.user.name);
  res.json(filtradas.map(({ id, fecha, vendedor, cliente, totalPiezas, total, tier, data }) => ({
    id, fecha, vendedor, cliente, totalPiezas, total, tier,
    hasData: !!data,
    hasPdf: existsSync(join(PDFS_DIR, `cot_${id}.pdf`)),
  })));
});

app.get('/api/cotizaciones/:id', authMiddleware, (req, res) => {
  const id = parseInt(req.params.id);
  const log = readJSON('cotizaciones.json') || [];
  const entry = log.find(c => c.id === id);
  if (!entry) return res.status(404).json({ error: 'No encontrada' });

  // Solo el vendedor dueño o admin pueden acceder
  if (req.user.role !== 'admin' && entry.vendedor !== req.user.name) {
    return res.status(403).json({ error: 'Sin acceso' });
  }

  res.json(entry.data);
});

// --- Admin: Upload precios ---

app.post('/api/admin/precios', authMiddleware, adminMiddleware, upload.single('excel'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibio archivo' });

  try {
    const newData = extractPrices(req.file.buffer);
    const oldData = readJSON('precios.json');
    const diff = oldData ? diffPrices(oldData, newData) : null;

    if (req.query.preview === '1') {
      return res.json({ preview: true, diff, newVersion: newData.version });
    }

    writeJSON('precios.json', newData);
    res.json({ saved: true, diff, version: newData.version });
  } catch (err) {
    console.error('Error procesando Excel:', err);
    res.status(400).json({ error: 'Error procesando archivo: ' + err.message });
  }
});

// --- Admin: Config catálogo cotizable ---

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

// --- Admin: Vendedores ---

app.get('/api/admin/vendedores', authMiddleware, adminMiddleware, (req, res) => {
  const vendedores = readJSON('vendedores.json');
  res.json(vendedores);
});

app.put('/api/admin/vendedores', authMiddleware, adminMiddleware, (req, res) => {
  const vendedores = req.body;
  if (!Array.isArray(vendedores)) return res.status(400).json({ error: 'Formato invalido' });
  writeJSON('vendedores.json', vendedores);
  res.json({ saved: true });
});

// --- Cotizar envío con envia.com ---

const ENVIA_ORIGIN = {
  name: 'Peltre Nacional',
  company: 'Peltre Nacional SA de CV',
  email: 'contacto@pppeltre.mx',
  phone: '5573151197',
  street: 'Roberto Fierro',
  number: 'MZ42 LT13',
  district: 'Alfredo del Mazo',
  city: 'Ixtapaluca',
  state: 'MEX',
  country: 'MX',
  postalCode: '56577',
};

app.post('/api/cotizacion/envio', authMiddleware, async (req, res) => {
  const { cpDestino, items, totalConIVA } = req.body;

  if (!cpDestino) return res.status(400).json({ error: 'CP destino requerido' });
  if (!items?.length) return res.status(400).json({ error: 'Carrito vacío' });

  const ENVIA_API_KEY = process.env.ENVIA_API_KEY;
  if (!ENVIA_API_KEY) return res.status(500).json({ error: 'ENVIA_API_KEY no configurado en .env' });

  let packages, resumen, warnings;
  try {
    ({ packages, resumen, warnings } = calcularPaquetes(items, totalConIVA || 0));
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  if (packages.length === 0) {
    return res.status(400).json({ error: 'No se calcularon paquetes', warnings });
  }

  const destination = {
    name: 'Destinatario',
    city: 'Destino',
    state: 'DF',
    country: 'MX',
    postalCode: cpDestino,
  };

  const CARRIERS = ['fedex', 'dhl', 'ups'];

  const queryCarrier = async (carrier) => {
    const payload = {
      origin: ENVIA_ORIGIN,
      destination,
      packages,
      shipment: { carrier, type: 1 },
    };
    const r = await fetch('https://api.envia.com/ship/rate/', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ENVIA_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const data = await r.json();
    if (!r.ok || data.meta === 'error') return [];
    return Array.isArray(data) ? data : (data.data || []);
  };

  try {
    const results = await Promise.allSettled(CARRIERS.map(queryCarrier));
    const rates = results
      .filter(r => r.status === 'fulfilled')
      .flatMap(r => r.value);
    rates.sort((a, b) => (a.totalPrice ?? a.rate ?? 0) - (b.totalPrice ?? b.rate ?? 0));

    if (rates.length === 0 && warnings.length === 0) {
      warnings.push('No se obtuvieron tarifas de ninguna paquetería');
    }

    res.json({ rates, resumen, warnings });
  } catch (err) {
    console.error('Error cotizando envío:', err);
    res.status(500).json({ error: 'Error de conexión con envia.com: ' + err.message });
  }
});

// --- Admin: Cajas ---

app.get('/api/admin/cajas', authMiddleware, adminMiddleware, (req, res) => {
  const cajas = readJSON('cajas.json') || {};
  res.json(cajas);
});

app.put('/api/admin/cajas', authMiddleware, adminMiddleware, (req, res) => {
  const cajas = req.body;
  if (typeof cajas !== 'object' || Array.isArray(cajas)) {
    return res.status(400).json({ error: 'Formato inválido' });
  }
  writeJSON('cajas.json', cajas);
  res.json({ saved: true });
});

// --- Admin: Cotizaciones log ---

app.get('/api/admin/cotizaciones', authMiddleware, adminMiddleware, (req, res) => {
  const log = readJSON('cotizaciones.json') || [];
  res.json(log.map(({ id, fecha, vendedor, cliente, totalPiezas, total, tier }) =>
    ({ id, fecha, vendedor, cliente, totalPiezas, total, tier })
  ));
});

// --- Admin page ---

app.get('/admin', (req, res) => {
  res.sendFile(join(PUBLIC_DIR, 'admin.html'));
});

// --- SPA fallback ---

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(join(PUBLIC_DIR, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Cotizador corriendo en http://localhost:${PORT}`);
});
