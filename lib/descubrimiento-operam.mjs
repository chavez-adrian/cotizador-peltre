// Nucleo PURO del descubrimiento RECURRENTE de quotes nuevos en Operam hacia la
// bandeja de revision (issue #126). Es el companero "hacia adelante" del lote
// historico de #124: en vez de caminar una ventana fija hacia atras, camina
// folios de quote hacia ARRIBA desde el folio maximo YA CONOCIDO (el mayor entre
// los folioOperam del store de cotizaciones y los folios ya sembrados en la
// bandeja -- los folios de Operam son secuenciales), y clasifica cada quote
// nuevo por tipo de debtor:
//
//   - debtor GENERICO (cliente-cajon)  -> candidato PROSPECTO. Se REUSA
//     evaluarQuote/candidatoDesdeQuote de recolector-genericos.mjs (#124) tal
//     cual: mismo cruce por identidad (#123), mismas marcas, mismos filtros
//     CERRO / total-cero.
//   - debtor de un cliente REAL         -> candidato COTIZACION, con el payload
//     COMPLETO del quote (mas el debtor resuelto via lectura inyectada) y un
//     vendedor propuesto en el orden INVERSO al de los genericos: aqui el
//     `salesman` del quote SI describe a quien vendio, asi que manda; el
//     usuario creador es el fallback (ver resolverVendedorPropuestoReal).
//
// SIN IO propio: las lecturas de Operam (obtenerQuote, obtenerCliente) entran
// INYECTADAS, mismo patron que planearBackfill/planearBackfillSinPedido y que
// planearRecoleccion. El script/endpoint orquesta el walk con las lecturas
// reales (read-only, paceadas con _setMinInterval); el deposito en la bandeja lo
// hace depositarCandidatos (#124), sin reinventarlo aqui.

import { esDebtorGenerico } from './deduplicacion.js';
import { evaluarQuote, MOTIVOS as MOTIVOS_GENERICO } from './recolector-genericos.mjs';
import {
  DEBTORS_PRUEBA, DEBTORS_SOCIOS, FOLIOS_EXCLUIDOS_MANUAL, esSucursalTlapacoya,
  mapearSalesman, mapearVendedorPorUsuario, folioYaExiste,
} from './backfill-operam.mjs';

function texto(v) {
  return v == null ? '' : String(v).trim();
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function primeroNoVacio(...valores) {
  for (const v of valores) {
    const t = texto(v);
    if (t !== '') return t;
  }
  return '';
}

// El debtor del quote como NUMERO, o null si falta / no es un id (mismo criterio
// que recolector-genericos.mjs; se duplica aqui porque no se exporta de alla --
// es un helper de dos lineas, no una pieza de logica que valga la pena acoplar).
function debtorDeQuote(quote) {
  const v = (quote || {}).debtor_no;
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Vendedor PROPUESTO para un quote de CLIENTE REAL (#126). Orden INVERSO al de
// resolverVendedorPropuesto de recolector-genericos.mjs (#124), a proposito: ahi
// el `salesman` describe al cliente-cajon compartido (Mostrador, casi siempre),
// asi que el usuario creador manda. Aqui el debtor es un cliente nombrado y su
// `salesman` SI describe quien lo vendio -- ese manda, y el usuario creador queda
// como fallback si el salesman no mapea al catalogo. null si ninguno mapea.
export function resolverVendedorPropuestoReal(quote, vendedores) {
  const q = quote || {};
  const salesman = mapearSalesman(q.salesman ?? q.branch?.salesman, vendedores);
  if (salesman) return salesman;
  return mapearVendedorPorUsuario(q.user?.real_name, vendedores);
}

// El candidato tipo COTIZACION que recibe bandejaStore.proponer (#122), con el
// payload `quote` COMPLETO (#125: la aceptacion construye la oportunidad desde
// este payload sin volver a hablar con Operam) mas el `debtor` ya resuelto
// anexado tal cual lo documenta bandeja-store.js.
export function candidatoCotizacionDesdeQuote({ folio, quote, debtor, vendedores } = {}) {
  const q = quote || {};
  return {
    folio: String(folio),
    tipo: 'cotizacion',
    fecha: q.ord_date || null,
    contacto: texto(q.deliver_to),
    celular: texto(q.contact_phone),
    email: texto(q.contact_email),
    proyecto: primeroNoVacio(q.cust_ref, q.customer_ref),
    domicilio: texto(q.delivery_address),
    monto: num(q.total),
    debtorId: debtorDeQuote(q),
    debtorNombre: texto(debtor && (debtor.CustName || debtor.cust_name)),
    vendedor: resolverVendedorPropuestoReal(q, vendedores),
    // Un candidato tipo cotizacion no lleva el cruce por identidad (#123): el
    // debtor YA es un cliente nombrado en Operam, no hay identidad que inferir.
    // Las marcas viajan completas de todos modos (mismo contrato que el store).
    marcas: { comproOtraCosa: false, posibleDuplicado: false },
    quote: { ...q, debtor: debtor || null },
  };
}

// El folio MAXIMO ya conocido por el cotizador: el mayor entre los folioOperam
// del store de cotizaciones (nacidos en el cotizador o importados por #76/#125)
// y los folios ya sembrados en la bandeja (en cualquier estado -- un candidato
// propuesto y luego descartado sigue siendo "ya conocido", no hay que
// redescubrirlo). Los folios de Operam son secuenciales: caminar hacia arriba
// desde aqui + 1 cubre exactamente lo nuevo. 0 si no hay ninguno (primera
// corrida sin semilla -- el caller decide como sembrarla).
export function folioMaximoConocido(cotizaciones, bandeja) {
  let max = 0;
  for (const c of cotizaciones || []) {
    const n = Number(c && c.folioOperam);
    if (Number.isFinite(n) && n > max) max = n;
  }
  for (const b of bandeja || []) {
    const n = Number(b && b.folio);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

// Motivos de SALTO del walk (#126). Constantes explicitas, comparadas por
// igualdad (misma leccion que #123/#124: comparar por prefijo cuenta cosas
// vivas como cerradas).
export const MOTIVOS = Object.freeze({
  YA_EXISTE: 'ya-existe',
  YA_EN_BANDEJA: 'ya-en-bandeja',
  CANCELADO: 'cancelado',
  PRUEBA: 'prueba',
  SOCIO: 'socio',
  OTRA_SUCURSAL: 'otra-sucursal',
  EXCLUIDO_MANUAL: 'excluido-manual',
  CERRO: 'cerro',
  TOTAL_CERO: 'total-cero',
});

const LLAVE_SKIP = Object.freeze({
  [MOTIVOS.YA_EXISTE]: 'yaExiste',
  [MOTIVOS.YA_EN_BANDEJA]: 'yaEnBandeja',
  [MOTIVOS.CANCELADO]: 'cancelado',
  [MOTIVOS.PRUEBA]: 'prueba',
  [MOTIVOS.SOCIO]: 'socio',
  [MOTIVOS.OTRA_SUCURSAL]: 'otraSucursal',
  [MOTIVOS.EXCLUIDO_MANUAL]: 'excluidoManual',
  [MOTIVOS.CERRO]: 'cerro',
  [MOTIVOS.TOTAL_CERO]: 'totalCero',
});

function skipsVacios() {
  const s = {};
  for (const k of Object.values(LLAVE_SKIP)) s[k] = 0;
  return s;
}

// PLAN del descubrimiento recurrente (#126). Camina folios de quote de
// `folioDesde` hacia ARRIBA leyendo el lector inyectado `obtenerQuote`:
//   - null (404): el folio no existe TODAVIA -> SALTA. Una racha de
//     `maxRachaVacia` 404 seguidos corta el walk (tope de la corrida: sin esto
//     seguiria probando folios para siempre si Operam nunca los crea).
//   - resto: se clasifica por tipo de debtor.
//
// Antes de clasificar, TRES filtros son comunes a ambos tipos (se aplican
// primero porque son locales/baratos y porque cubren la idempotencia que pide
// el issue): ya en el store de cotizaciones (folioYaExiste), ya en la bandeja
// (cualquier estado) y cancelado en Operam (data/cancelados.json).
//
// Debtor GENERICO: delega en evaluarQuote (#124) tal cual -- mismo cruce, mismas
// marcas, mismos filtros CERRO/total-cero. Debtor de un cliente REAL: aplica las
// exclusiones VIGENTES de #76 (venta directa/prueba, socios, sucursales
// no-Tlapacoya, folios excluidos a mano) y arma el candidato tipo cotizacion con
// el debtor resuelto via `obtenerCliente` (memoizado por debtor: varios quotes
// nuevos del mismo cliente en una corrida no repiten la lectura).
//
// PROHIBIDO usar pedidoQueCierra/la banda del 75% de #76 aqui: el cierre por
// identidad de #123 (via evaluarQuote) es su reemplazo para el camino generico;
// el camino de cliente real no necesita "cierre" -- el quote YA es del cliente
// nombrado, se propone tal cual y el humano decide en la bandeja.
//
// Devuelve un PLAN sin escribir nada; el deposito en la bandeja es
// depositarCandidatos (#124), reusado por el caller.
export async function planearDescubrimiento({
  obtenerQuote, obtenerCliente, folioDesde,
  clientes, pedidos, prospectos, vendedores,
  cancelados = [], bandejaFolios = [], cotizaciones = [],
  maxRachaVacia = 20,
} = {}) {
  const plan = {
    folioDesde: folioDesde != null ? Number(folioDesde) : null,
    folioHasta: null, // ultimo folio EXISTENTE visto (el techo real de esta corrida)
    leidos: 0,
    candidatos: [],
    skips: skipsVacios(),
  };
  if (folioDesde == null) return plan;

  const canceladosSet = new Set([...cancelados].map(String));
  const bandejaSet = new Set([...bandejaFolios].map(String));
  // Celulares de los candidatos PROSPECTO que ya salieron en esta corrida (mismo
  // proposito que en recolector-genericos.mjs): dos quotes nuevos del mismo
  // contacto de un cajon generico no deben nacer como dos prospectos gemelos.
  const celularesDelLote = new Set();
  // Debtor ya resuelto en esta corrida (varios quotes nuevos del mismo cliente
  // real no repiten la lectura de obtenerCliente).
  const debtorCache = new Map();
  let rachaVacia = 0;

  for (let folio = Number(folioDesde); ; folio++) {
    const quote = await obtenerQuote(folio);
    plan.leidos++;
    if (!quote) {
      if (++rachaVacia >= maxRachaVacia) break;
      continue;
    }
    rachaVacia = 0;
    plan.folioHasta = folio;

    const f = String(folio);
    if (bandejaSet.has(f)) { plan.skips.yaEnBandeja++; continue; }
    if (folioYaExiste(cotizaciones, f)) { plan.skips.yaExiste++; continue; }
    if (canceladosSet.has(f)) { plan.skips.cancelado++; continue; }

    const debtorNo = debtorDeQuote(quote);
    if (esDebtorGenerico(debtorNo)) {
      const r = evaluarQuote({
        folio, quote, clientes, pedidos, prospectos, vendedores,
        cancelados: canceladosSet, bandejaFolios: bandejaSet, celularesDelLote,
      });
      if (r.motivo === null) {
        plan.candidatos.push({ candidato: r.candidato, cruce: r.cruce });
        continue;
      }
      switch (r.motivo) {
        case MOTIVOS_GENERICO.CERRO: plan.skips.cerro++; break;
        case MOTIVOS_GENERICO.TOTAL_CERO: plan.skips.totalCero++; break;
        case MOTIVOS_GENERICO.CANCELADO: plan.skips.cancelado++; break;
        case MOTIVOS_GENERICO.YA_EN_BANDEJA: plan.skips.yaEnBandeja++; break;
        default: break; // NO_GENERICO no puede pasar: ya filtramos por esDebtorGenerico
      }
      continue;
    }

    // Cliente REAL: exclusiones vigentes de #76 (#126 las REUSA, no las reescribe).
    const debtorStr = debtorNo != null ? String(debtorNo) : null;
    if (debtorStr != null && DEBTORS_PRUEBA.has(debtorStr)) { plan.skips.prueba++; continue; }
    if (debtorStr != null && DEBTORS_SOCIOS.has(debtorStr)) { plan.skips.socio++; continue; }
    if (FOLIOS_EXCLUIDOS_MANUAL.has(f)) { plan.skips.excluidoManual++; continue; }
    if (!esSucursalTlapacoya(quote)) { plan.skips.otraSucursal++; continue; }

    let debtor = null;
    if (debtorStr != null) {
      if (debtorCache.has(debtorStr)) {
        debtor = debtorCache.get(debtorStr);
      } else {
        debtor = obtenerCliente ? await obtenerCliente(debtorStr) : null;
        debtorCache.set(debtorStr, debtor);
      }
    }
    const candidato = candidatoCotizacionDesdeQuote({ folio, quote, debtor, vendedores });
    plan.candidatos.push({ candidato, cruce: null });
  }
  return plan;
}
