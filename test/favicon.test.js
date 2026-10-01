import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { inflateSync } from 'zlib';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import supertest from 'supertest';
import { fotoDatos, fijarDatos } from './helpers/datos-aislados.js';

// Icono de pestana (#503): la taza pp.peltre negra sobre un cuadro blanco de
// esquinas redondeadas -- sobre transparente el trazo negro desaparecia en las
// pestanas con tema oscuro --. Antes ninguna pagina lo declaraba y
// `/favicon.ico` lo atrapaba la ruta comodin: el navegador recibia index.html
// donde esperaba una imagen.

const __dirname = dirname(fileURLToPath(import.meta.url));
const COTS_PATH = join(__dirname, '..', 'data', 'cotizaciones.json');

const envPath = join(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

const { app } = await import('../server.js');

const PAGINAS = ['/', '/admin', '/admin/catalogo', '/prospectos', '/mayoreo'];

function hrefDeLink(html, rel) {
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    const r = tag.match(/\brel=["']([^"']+)["']/i);
    if (!r || r[1].toLowerCase() !== rel) continue;
    const h = tag.match(/\bhref=["']([^"']+)["']/i);
    return h ? h[1] : null;
  }
  return null;
}

function cuerpoBinario(res, cb) {
  const partes = [];
  res.on('data', p => partes.push(p));
  res.on('end', () => cb(null, Buffer.concat(partes)));
}

async function pedirBinario(ruta) {
  return supertest(app).get(ruta).buffer(true).parse(cuerpoBinario);
}

function ihdr(png) {
  assert.ok(png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'firma PNG');
  assert.strictEqual(png.toString('latin1', 12, 16), 'IHDR');
  return {
    ancho: png.readUInt32BE(16),
    alto: png.readUInt32BE(20),
    profundidad: png[24],
    tipoColor: png[25],
    entrelazado: png[28],
  };
}

// Decodificador minimo (RGBA 8 bits sin entrelazar, lo unico que produce el
// generador) para leer pixeles sin agregar una dependencia.
function pixelesRGBA(png) {
  const h = ihdr(png);
  assert.strictEqual(h.profundidad, 8, 'PNG de 8 bits');
  assert.strictEqual(h.tipoColor, 6, 'PNG RGBA');
  assert.strictEqual(h.entrelazado, 0, 'PNG sin entrelazar');
  const idat = [];
  let i = 8;
  while (i < png.length) {
    const largo = png.readUInt32BE(i);
    const tipo = png.toString('latin1', i + 4, i + 8);
    if (tipo === 'IDAT') idat.push(png.subarray(i + 8, i + 8 + largo));
    i += 12 + largo;
  }
  const crudo = inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const fila = h.ancho * bpp;
  const out = Buffer.alloc(fila * h.alto);
  for (let y = 0; y < h.alto; y++) {
    const filtro = crudo[y * (fila + 1)];
    const ini = y * (fila + 1) + 1;
    for (let x = 0; x < fila; x++) {
      const v = crudo[ini + x];
      const a = x >= bpp ? out[y * fila + x - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * fila + x] : 0;
      const c = x >= bpp && y > 0 ? out[(y - 1) * fila + x - bpp] : 0;
      let pred = 0;
      if (filtro === 1) pred = a;
      else if (filtro === 2) pred = b;
      else if (filtro === 3) pred = (a + b) >> 1;
      else if (filtro === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * fila + x] = (v + pred) & 0xff;
    }
  }
  return {
    ...h,
    en(x, y) {
      const k = y * fila + x * bpp;
      return [out[k], out[k + 1], out[k + 2], out[k + 3]];
    },
  };
}

test('#503: GET /favicon.ico responde el icono, nunca index.html', async () => {
  const res = await pedirBinario('/favicon.ico');
  assert.strictEqual(res.status, 200);
  assert.match(res.headers['content-type'], /^image\/(x-icon|vnd\.microsoft\.icon)/);
  assert.strictEqual(res.body.readUInt16LE(0), 0, 'cabecera ICO: reservado');
  assert.strictEqual(res.body.readUInt16LE(2), 1, 'cabecera ICO: tipo icono');
});

for (const pagina of PAGINAS) {
  test(`#503: ${pagina} declara icon y apple-touch-icon y los dos se sirven como PNG`, async () => {
    const res = await supertest(app).get(pagina);
    assert.strictEqual(res.status, 200);
    assert.match(res.headers['content-type'], /text\/html/);
    for (const rel of ['icon', 'apple-touch-icon']) {
      const href = hrefDeLink(res.text, rel);
      assert.ok(href, `${pagina} declara rel="${rel}"`);
      const img = await pedirBinario(href);
      assert.strictEqual(img.status, 200, `${href} existe`);
      assert.match(img.headers['content-type'], /^image\/png/);
    }
  });
}

test('#503: icon mide 32x32 y apple-touch-icon 180x180', async () => {
  const html = (await supertest(app).get('/')).text;
  const icon = ihdr((await pedirBinario(hrefDeLink(html, 'icon'))).body);
  assert.deepStrictEqual([icon.ancho, icon.alto], [32, 32]);
  const apple = ihdr((await pedirBinario(hrefDeLink(html, 'apple-touch-icon'))).body);
  assert.deepStrictEqual([apple.ancho, apple.alto], [180, 180]);
});

test('#503: el icono de 180 lleva el cuadro blanco redondeado: esquinas transparentes y fondo blanco opaco', async () => {
  const html = (await supertest(app).get('/')).text;
  const px = pixelesRGBA((await pedirBinario(hrefDeLink(html, 'apple-touch-icon'))).body);
  const ult = px.ancho - 1;
  for (const [x, y] of [[0, 0], [ult, 0], [0, ult], [ult, ult]]) {
    assert.strictEqual(px.en(x, y)[3], 0, `esquina (${x},${y}) transparente`);
  }
  // El centro geometrico cae dentro de la taza (trazo hueco): blanco del cuadro.
  // El borde medio de arriba, fuera de la taza, tambien es del cuadro, no transparente.
  const centro = Math.floor(px.ancho / 2);
  assert.deepStrictEqual(px.en(centro, centro), [255, 255, 255, 255], 'centro blanco opaco');
  assert.deepStrictEqual(px.en(centro, 2), [255, 255, 255, 255], 'borde superior blanco opaco');
});

// La cotizacion HTML es autocontenida (el logo ya viaja en data:): el icono
// tambien, para que funcione guardada y abierta sin conexion.
let restaurarDatos;
const ID_COT = 950301;
before(() => {
  restaurarDatos = fotoDatos([COTS_PATH]);
  fijarDatos(COTS_PATH, [{
    id: ID_COT, fecha: '2026-10-01T12:00:00Z', vendedor: 'Prueba', cliente: 'La Mesa',
    totalPiezas: 10, total: 1000, tier: 'Menudeo', folioOperam: '1500',
    data: {
      cliente: { nombre: 'La Mesa' },
      items: [{ modelo: 'P01', descripcion: 'Taza', cantidad: 10, precio: 100 }],
      subtotal: 1000, total: 1000, tier: 'Menudeo', vendedor: 'Prueba',
    },
  }]);
});
after(() => restaurarDatos());

test('#503: la cotizacion HTML declara el icono embebido como data:image/png', async () => {
  const res = await supertest(app).get(`/api/cotizacion/html/${ID_COT}`);
  assert.strictEqual(res.status, 200);
  const href = hrefDeLink(res.text, 'icon');
  assert.ok(href, 'declara rel="icon"');
  assert.ok(href.startsWith('data:image/png;base64,'), 'el icono viaja embebido');
  const png = Buffer.from(href.slice('data:image/png;base64,'.length), 'base64');
  const h = ihdr(png);
  assert.deepStrictEqual([h.ancho, h.alto], [32, 32]);
});
