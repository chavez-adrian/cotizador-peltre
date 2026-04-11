import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CAJAS_PATH = join(__dirname, '..', 'data', 'cajas.json');
const PRECIOS_PATH = join(__dirname, '..', 'data', 'precios.json');

const MAX_KG_POR_CAJA = 45;

/**
 * Dado un array de items del carrito, calcula los paquetes para envia.com.
 * Algoritmo basado en volumen:
 *   - vol_pieza = largo × ancho × alto (cm³)
 *   - vol_ajustado = Σ(vol_pieza × cantidad) × 1.15 por grupo de caja
 *   - n_cajas = ceil(vol_ajustado / vol_caja)
 *   - peso_kg = Σ(peso_g × cantidad / 1000) × 1.15 por grupo
 *
 * @param {Array<{codigo: string, cantidad: number}>} items
 * @param {number} [totalConIVA]
 * @returns {{ packages: Array, resumen: Array, warnings: string[] }}
 */
export function calcularPaquetes(items, totalConIVA = 0) {
  if (!existsSync(CAJAS_PATH)) throw new Error('Catálogo de cajas no configurado (data/cajas.json)');
  if (!existsSync(PRECIOS_PATH)) throw new Error('Precios no cargados');

  const cajas = JSON.parse(readFileSync(CAJAS_PATH, 'utf8'));
  const { boxMap } = JSON.parse(readFileSync(PRECIOS_PATH, 'utf8'));

  const warnings = [];

  // Acumular por tipo de caja: vol_cm3 y peso_g
  const porCaja = new Map();

  for (const item of items) {
    if (item.codigo === 'ENVIO') continue;

    const modelo = item.codigo.slice(0, 4);
    const boxEntry = boxMap.find(b => b.modelo === modelo);

    if (!boxEntry) {
      warnings.push(`Modelo ${modelo} sin empaque configurado`);
      continue;
    }

    if (!boxEntry.caja) {
      warnings.push(`Modelo ${modelo} sin tipo de caja asignado`);
      continue;
    }

    const cajaInfo = cajas[boxEntry.caja];
    if (!cajaInfo) {
      warnings.push(`Tipo de caja "${boxEntry.caja}" no en catálogo`);
      continue;
    }

    if (!cajaInfo.largo_cm || !cajaInfo.ancho_cm || !cajaInfo.alto_cm) {
      throw new Error(`Caja "${boxEntry.caja}" sin dimensiones. Ve a Admin → Cajas.`);
    }

    if (!porCaja.has(boxEntry.caja)) {
      porCaja.set(boxEntry.caja, { cajaInfo, cajaCode: boxEntry.caja, vol_cm3: 0, peso_g: 0 });
    }

    const grupo = porCaja.get(boxEntry.caja);

    // Volumen de pieza: usar dimensiones reales si están disponibles
    // Si no hay dims, acumular piezas para count-based (fallback)
    if (boxEntry.largo_cm && boxEntry.ancho_cm && boxEntry.alto_cm) {
      grupo.vol_cm3 += boxEntry.largo_cm * boxEntry.ancho_cm * boxEntry.alto_cm * item.cantidad;
      grupo.vol_disponible = true;
    } else {
      grupo.n_cajas_fallback = (grupo.n_cajas_fallback || 0) + Math.ceil(item.cantidad / (boxEntry.pz_por_caja || 1));
    }
    grupo.peso_g += (boxEntry.peso_g || 0) * item.cantidad;
  }

  const packages = [];
  const resumen = [];
  let total_cajas_global = 0;

  // Primera pasada: calcular n_cajas por grupo
  const grupos = [];
  for (const [cajaCode, grupo] of porCaja) {
    const { cajaInfo } = grupo;
    const vol_caja_cm3 = cajaInfo.largo_cm * cajaInfo.ancho_cm * cajaInfo.alto_cm;
    let n_cajas, vol_ajustado;
    if (grupo.vol_disponible) {
      vol_ajustado = grupo.vol_cm3 * 1.15;
      n_cajas = Math.max(1, Math.ceil(vol_ajustado / vol_caja_cm3));
    } else {
      vol_ajustado = 0;
      n_cajas = Math.max(1, grupo.n_cajas_fallback || 1);
    }
    const peso_kg_total = (grupo.peso_g / 1000) * 1.15;

    if (peso_kg_total / n_cajas > MAX_KG_POR_CAJA) {
      warnings.push(`Grupo ${cajaCode}: peso promedio por caja excede ${MAX_KG_POR_CAJA}kg`);
    }

    grupos.push({ cajaCode, cajaInfo, n_cajas, peso_kg_total, vol_ajustado });
    total_cajas_global += n_cajas;
  }

  const valorAsegurado = totalConIVA > 0 ? Math.round(totalConIVA * 0.25) : 0;

  for (const { cajaCode, cajaInfo, n_cajas, peso_kg_total, vol_ajustado } of grupos) {
    const peso_promedio_kg = peso_kg_total / n_cajas;
    const declaredValue = total_cajas_global > 0
      ? Math.round(valorAsegurado * n_cajas / total_cajas_global)
      : 0;

    packages.push({
      content: 'Artículos de peltre esmaltado',
      amount: n_cajas,
      type: 'box',
      dimensions: {
        length: cajaInfo.largo_cm,
        width: cajaInfo.ancho_cm,
        height: cajaInfo.alto_cm,
      },
      weight: parseFloat(Math.max(0.1, peso_promedio_kg).toFixed(3)),
      insurance: valorAsegurado > 0 ? 1 : 0,
      declaredValue,
    });

    resumen.push({
      caja: cajaCode,
      descripcion: cajaInfo.descripcion,
      total_cajas: n_cajas,
      vol_ajustado_cm3: Math.round(vol_ajustado),
      total_peso_kg: parseFloat(peso_kg_total.toFixed(2)),
    });
  }

  return { packages, resumen, warnings };
}
