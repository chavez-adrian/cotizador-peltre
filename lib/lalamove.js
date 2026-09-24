// IO de la tarifa Lalamove (#72): cotiza en paralelo cada vehiculo donde cabe
// la carga y devuelve tarjetas con la forma de envia.com. Nunca lanza: todo lo
// que impide cotizar sale como advertencia, porque "Cotizar con Lalamove" es
// una opcion que el vendedor eligio y un silencio no le diria nada.
import crypto from 'node:crypto';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { leerArchivoSync } from './fs-reintento.js';
import { fetchSinRedEnPruebas } from './red-en-pruebas.js';
import { coordenadasDeCP } from './codigos-postales.js';
import {
  encabezadosLalamove, serviciosDeMexico, vehiculosQueCaben,
  cuerpoCotizacion, tarifaDesdeCotizacion, esFueraDeArea,
} from './lalamove-logica.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COORDS_PATH = join(__dirname, '..', 'data', 'cp-mx-coords.json');
const TTL_SERVICIOS_MS = 24 * 60 * 60 * 1000;

const FUERA_DE_AREA = Symbol('fuera-de-area');

let indiceCoords = null;
let cacheServicios = null;

export function _reiniciarLalamove({ coords = null } = {}) {
  indiceCoords = coords;
  cacheServicios = null;
}

function coordenadas() {
  if (!indiceCoords) indiceCoords = existsSync(COORDS_PATH) ? JSON.parse(leerArchivoSync(COORDS_PATH)) : {};
  return indiceCoords;
}

async function pedir(metodo, path, cuerpo) {
  const body = cuerpo ? JSON.stringify(cuerpo) : '';
  const headers = encabezadosLalamove({
    key: process.env.LALAMOVE_API_KEY,
    secret: process.env.LALAMOVE_API_SECRET,
    ts: Date.now().toString(),
    metodo, path, body,
    requestId: crypto.randomUUID(),
  });
  const base = process.env.LALAMOVE_BASE_URL || 'https://rest.lalamove.com';
  const r = await fetchSinRedEnPruebas(base + path, { method: metodo, headers, body: body || undefined });
  const json = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, json };
}

async function servicios() {
  if (cacheServicios && Date.now() - cacheServicios.en < TTL_SERVICIOS_MS) return cacheServicios.lista;
  const r = await pedir('GET', '/v3/cities');
  if (!r.ok) throw new Error(`GET /v3/cities respondio ${r.status}`);
  const lista = serviciosDeMexico(r.json);
  if (lista.length) cacheServicios = { lista, en: Date.now() };
  return lista;
}

export async function tarifasLalamove({ cp, pesoKg, cajas = [] }) {
  if (!process.env.LALAMOVE_API_KEY || !process.env.LALAMOVE_API_SECRET) {
    return { rates: [], warnings: ['Lalamove no esta configurado (faltan LALAMOVE_API_KEY / LALAMOVE_API_SECRET)'] };
  }
  const destino = coordenadasDeCP(coordenadas(), cp);
  if (!destino) return { rates: [], warnings: [`Lalamove: no hay coordenadas para el CP ${cp}`] };

  let vehiculos;
  try {
    vehiculos = vehiculosQueCaben(await servicios(), { pesoKg, cajas });
  } catch (err) {
    return { rates: [], warnings: [`Lalamove no disponible: ${err.message}`] };
  }
  if (!vehiculos.length) {
    return { rates: [], warnings: [`Lalamove: la carga (${pesoKg} kg, ${cajas.reduce((s, c) => s + c.cantidad, 0)} cajas) no cabe con margen en ninguno de sus vehiculos`] };
  }

  const direccion = `CP ${cp}, Mexico`;
  const resultados = await Promise.allSettled(vehiculos.map(async (v) => {
    const r = await pedir('POST', '/v3/quotations', cuerpoCotizacion({ serviceType: v.key, destino: { ...destino, direccion } }));
    if (r.ok) return tarifaDesdeCotizacion(v, r.json);
    if (esFueraDeArea(r.json)) return FUERA_DE_AREA;
    // Cada vehiculo es una consulta y el limite es por minuto (sandbox 30,
    // produccion 100): varios clics seguidos en Cotizar lo alcanzan.
    if (r.status === 429) throw new Error('se alcanzo el limite de consultas por minuto, reintenta en un minuto');
    throw new Error(r.json?.errors?.[0]?.message || `respondio ${r.status}`);
  }));

  const rates = resultados.filter(x => x.status === 'fulfilled' && x.value && x.value !== FUERA_DE_AREA).map(x => x.value);
  const fallas = resultados.filter(x => x.status === 'rejected').map(x => x.reason?.message);
  const warnings = fallas.length ? [`Lalamove no cotizo ${fallas.length} vehiculo(s): ${[...new Set(fallas)].join('; ')}`] : [];
  if (!rates.length && resultados.some(x => x.value === FUERA_DE_AREA)) warnings.push(`Lalamove no da servicio en el CP ${cp}`);
  return { rates, warnings };
}
