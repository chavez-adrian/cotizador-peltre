// Nucleo PURO del catalogo generado desde Operam (issue #128, padre #120). Sin IO:
// recibe los tres volcados de Operam (sales_types, prices_list, inventory/items) mas
// el archivo complementario y devuelve el catalogo con la forma EXACTA de
// data/precios.json (el frontend no cambia) mas un reporte de paridad contra el
// catalogo de referencia.

// El codigo de articulo codifica el producto en posiciones fijas:
// tipo(2) tamano(2) color1(2) color2(2) textura(1) capas(1) filetes(1) colorRiso(1)
// y un digito 13 opcional con las piezas del paquete. Es la unica fuente de los
// atributos del selector guiado: Operam guarda el codigo y la descripcion, no las
// partes. Los codigos legacy del Excel que no siguen la convencion NO se adivinan:
// su lectura vive en el complementario (skus).
const RE_SKU = /^([A-Z]{2})([A-Z0-9]{2})([A-Z0-9]{2})([A-Z0-9]{2})(\d)(\d)(\d)(\d)(\d?)$/;

export function decodificarSku(codigo) {
  const m = typeof codigo === 'string' ? RE_SKU.exec(codigo) : null;
  if (!m) return null;
  const [, tipo, tamano, color1, color2, textura, capas, filetes, colorRiso, paquete] = m;
  return {
    tipo,
    tamano,
    color1,
    color2: color2 === '00' ? null : color2,
    textura: Number(textura),
    capas: Number(capas),
    filetes: Number(filetes),
    colorRiso: colorRiso === '0' ? null : Number(colorRiso),
    paquete: paquete && paquete !== '0' ? Number(paquete) : null,
  };
}

// Texturas fuera del flujo guiado: 0 muestras, 8 decorado a mano, 9 decorado. Y solo
// se cotizan los filetes 1 (con borde) y 2 (sin borde). Mismo criterio que traia el
// extractor del Excel.
const TEXTURAS_FUERA = [0, 8, 9];
const FILETES_GUIADOS = [1, 2];

// Lectura de un articulo: manda la del complementario y, si no esta, la del codigo.
// El complementario trae la lectura congelada del catalogo vigente y cubre dos casos
// que el codigo no resuelve: los codigos legacy que no siguen la convencion
// (TA14G11211, TA14P1N1M0...) y el puno de codigos con dedazo (VJ04B1A32111 dice
// filete negro y el articulo es "filete azul"). Sin ninguna de las dos el articulo no
// entra: adivinar partes de un codigo que no las codifica llenaria el selector de
// piezas mal descritas.
function leerArticulo(stockId, tabla) {
  const canonico = decodificarSku(stockId);
  const guardado = (tabla || {})[stockId];
  if (!guardado) return canonico;
  return {
    tipo: guardado.tipo,
    tamano: guardado.tamano,
    color1: guardado.color1,
    color2: guardado.color2 ?? null,
    textura: Number(guardado.textura),
    capas: Number(guardado.capas),
    filetes: Number(guardado.filetes),
    colorRiso: guardado.colorRiso ?? null,
    // Las piezas del paquete son un digito posicional del codigo: el complementario
    // no las guarda (el catalogo vigente no las conservaba) y por eso se leen de ahi.
    paquete: guardado.paquete ?? canonico?.paquete ?? null,
  };
}

// Los tiers de volumen del cotizador, cada uno con la lista de Operam que le
// corresponde. Una sola tabla: `tiers` del catalogo es la proyeccion de id/label/
// min_qty. La resolucion es por NOMBRE (`sales_type`); el id es solo el respaldo si
// alguien renombra la lista en el ERP. El primero, "Menudeo" = "Precio de lista", es
// la BASE: factor 1 y origen de las demas.
const TIERS = [
  { id: 'Menudeo', label: 'Menudeo', min_qty: 1, lista: 'Precio de lista', idRespaldo: '12' },
  { id: 'M100', label: '100+ pzs', min_qty: 100, lista: 'M100', idRespaldo: '15' },
  { id: 'M350', label: '350+ pzs', min_qty: 350, lista: 'M350', idRespaldo: '16' },
  { id: 'M550', label: '550+ pzs', min_qty: 550, lista: 'M550', idRespaldo: '1' },
  { id: 'M1500', label: '1,500+ pzs', min_qty: 1500, lista: 'M1500', idRespaldo: '6' },
  { id: 'M6000', label: '6,000+ pzs', min_qty: 6000, lista: 'M6000', idRespaldo: '3' },
];

const TIER_BASE = TIERS[0].id;

function resolverListas(salesTypes) {
  const listas = {};
  for (const tier of TIERS) {
    const st = (salesTypes || []).find(s => s.sales_type === tier.lista)
      || (salesTypes || []).find(s => String(s.id) === tier.idRespaldo);
    listas[tier.id] = st
      ? { listaId: String(st.id), factor: Number(st.factor) }
      : { listaId: tier.idRespaldo, factor: null };
  }
  return listas;
}

function indexarPrecios(precios) {
  const porSku = new Map();
  for (const fila of precios || []) {
    const id = fila.stock_id;
    if (!id) continue;
    if (!porSku.has(id)) porSku.set(id, []);
    porSku.get(id).push(fila);
  }
  return porSku;
}

// Precio de un stock_id en cada tier. Fila explicita con precio > 0 gana; si no,
// base x factor. Las filas en 0 se IGNORAN (herramental y focos las traen asi y no
// son precio, son ausencia de precio).
function preciosDeSku(filas, listas) {
  const explicito = (listaId) => {
    const f = (filas || []).find(x => String(x.sales_type_id) === listaId && Number(x.price) > 0);
    return f ? Number(f.price) : null;
  };
  const base = explicito(listas[TIER_BASE].listaId);
  const prices = {};
  for (const tier of TIERS) {
    const { listaId, factor } = listas[tier.id];
    const propio = explicito(listaId);
    prices[tier.id] = propio != null
      ? propio
      : (base != null && factor != null ? base * factor : null);
  }
  return { base, prices };
}

// El catalogo precia por clave y Operam por articulo: cuando los SKUs de una clave no
// cobran igual, manda el precio de la MAYORIA. Promediar inventaria un precio que
// nadie cobra. La agrupacion es por las 6 listas COMPLETAS, no solo por la base: dos
// articulos con la misma base pueden separarse por una fila explicita en otra lista, y
// agrupar por base dejaba el resultado a merced del orden en que Operam los devolviera.
// Empate en numero de SKUs -> gana el mas caro en la primera lista donde difieran
// (nunca se cobra de menos por accidente).
function precioRepresentante(conBase) {
  const porPrecios = new Map();
  for (const p of conBase) {
    // Agrupar al centavo: Operam guarda 6 decimales y dos capturas del "mismo" precio
    // difieren en millonesimas (2689.655176 vs 2689.655172) -- eso no es divergencia.
    const llave = TIERS.map(t => (p.prices[t.id] == null ? '-' : p.prices[t.id].toFixed(2))).join('|');
    if (!porPrecios.has(llave)) porPrecios.set(llave, { base: p.base, prices: p.prices, skus: [] });
    porPrecios.get(llave).skus.push(p.sku);
  }
  const variantes = [...porPrecios.values()];
  const ganadora = variantes.reduce((mejor, v) => {
    if (!mejor) return v;
    if (v.skus.length !== mejor.skus.length) return v.skus.length > mejor.skus.length ? v : mejor;
    for (const tier of TIERS) {
      const a = v.prices[tier.id] ?? -Infinity;
      const b = mejor.prices[tier.id] ?? -Infinity;
      if (a !== b) return a > b ? v : mejor;
    }
    return mejor;
  }, null);
  return { prices: ganadora.prices, variantes };
}

// Estados del reporte de paridad. Constantes explicitas: se comparan por IGUALDAD,
// nunca por prefijo (leccion de #123: 'sin-senal'.startsWith('si') conto vivos como
// cerrados en una medicion).
export const ESTADOS_PARIDAD = {
  MATCH: 'MATCH',
  MISMATCH: 'MISMATCH',
  SIN_SKU: 'SIN_SKU',
  NUEVO: 'NUEVO',
};

// Dos precios cuadran si difieren menos de un centavo: la referencia guarda el precio
// del Excel redondeado y el generado sale de multiplicar por el factor.
const TOLERANCIA_CENTAVO = 0.01;

// Calcas vitrificables: familia CAL<tintas><cm2>, de CAL1025 (1 tinta, 25 cm2) a
// CAL8200. Las CAL00xx (calcas de marca y de artistas) existen en Operam pero el
// flujo del cotizador no las modela. El sufijo S es la MIGRACION de unidad de medida
// Actividad -> Servicio (2026-08: Actividad no es admitida en la factura con
// complemento de exportacion; CAL1025 quedo "No usar" y su reemplazo es CAL1025S).
// Cuando el par convive, manda la variante que tenga precios; a precios iguales, la S.
const RE_CALCA = /^CAL[1-9]\d{3}S?$/;

// Clasificacion contra el catalogo de referencia, la misma para productos (llave
// `key`) y calcas (llave `code`): lo que la referencia tiene y Operam ya no puede
// preciar es SIN_SKU, lo que cobra distinto es MISMATCH y lo que Operam tiene de mas
// es NUEVO.
function clasificar(generados, deReferencia, campoLlave, tiersComparables = TIERS) {
  const porLlave = new Map(generados.map(g => [g[campoLlave], g]));
  const filas = [];
  for (const ref of deReferencia || []) {
    const llave = ref[campoLlave];
    const nuevo = porLlave.get(llave);
    if (!nuevo) {
      filas.push({ [campoLlave]: llave, name: ref.name ?? null, estado: ESTADOS_PARIDAD.SIN_SKU, diferencias: [] });
      continue;
    }
    const diferencias = [];
    for (const tier of tiersComparables) {
      const a = ref.prices?.[tier.id] ?? null;
      const b = nuevo.prices?.[tier.id] ?? null;
      if (a == null && b == null) continue;
      if (a == null || b == null || Math.abs(a - b) > TOLERANCIA_CENTAVO) {
        diferencias.push({ tier: tier.id, referencia: a, operam: b });
      }
    }
    filas.push({
      [campoLlave]: llave,
      name: nuevo.name ?? ref.name ?? null,
      estado: diferencias.length === 0 ? ESTADOS_PARIDAD.MATCH : ESTADOS_PARIDAD.MISMATCH,
      diferencias,
    });
  }
  const enReferencia = new Set((deReferencia || []).map(r => r[campoLlave]));
  for (const g of generados) {
    if (enReferencia.has(g[campoLlave])) continue;
    filas.push({ [campoLlave]: g[campoLlave], name: g.name ?? null, estado: ESTADOS_PARIDAD.NUEVO, diferencias: [] });
  }
  return filas;
}

// productosSinCaja avisa de un pendiente que calcular-envio.js necesita para no fallar
// en runtime (#102/#68): un producto con ficha en el complementario pero cuyo modelo
// no tiene entrada en boxMap. Sin este aviso el hueco se descubre hasta que un
// vendedor cotiza el modelo nuevo y el calculo de envio truena silenciosamente.
// Vive junto a construirCatalogo (no en scripts/sync-catalogo.mjs, #130): tanto el
// script como la ruta admin de paridad (server.js) la necesitan, y server.js solo
// importa de lib/.
export function productosSinCaja(catalogo) {
  const modelos = new Set((catalogo.boxMap || []).map(b => b.modelo));
  return (catalogo.products || [])
    .filter(p => !modelos.has(p.model))
    .map(p => ({ key: p.key, model: p.model }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

export function construirCatalogo({ salesTypes, precios, items, complemento, referencia = null, version = null, extracted = null } = {}) {
  const comp = complemento || {};
  const listas = resolverListas(salesTypes);
  const filasPorSku = indexarPrecios(precios);
  const letras = comp.letrasPrecio || {};
  const fichas = comp.productos || {};

  // Los items pueden venir con inactivos (show_inactive=1, y ASI deben pedirse): un
  // articulo inactivo esta EN DESUSO -- no entra al catalogo ni a los pendientes,
  // pero clasifica: su fila de precio no es huerfana y su ausencia no es un faltante.
  const inactivos = new Set((items || []).filter(i => i.inactive === '1').map(i => i.stock_id));
  const activos = (items || []).filter(i => i.inactive !== '1');

  const porClave = new Map();
  const skus = [];
  const sinFicha = new Map();
  const ilegibles = [];
  const preciosPorSku = new Map();
  for (const item of activos) {
    const suPrecio = preciosDeSku(filasPorSku.get(item.stock_id), listas);
    preciosPorSku.set(item.stock_id, suPrecio);
    // Un articulo con precio vivo que no se puede leer es un pendiente: o el codigo se
    // retira en el ERP o su lectura se agrega al complementario. Callarlo lo esconde.
    // Lo que queda fuera del flujo guiado a proposito (muestras, decorados, filetes de
    // oreja) NO es pendiente y no se reporta.
    const partes = leerArticulo(item.stock_id, comp.skus);
    const anotarIlegible = () => {
      if (suPrecio.base != null && !RE_CALCA.test(item.stock_id || '')) {
        ilegibles.push({ stock_id: item.stock_id, nombre: (item.description || '').trim() });
      }
    };
    if (!partes) { anotarIlegible(); continue; }
    if (TEXTURAS_FUERA.includes(partes.textura)) continue;
    if (!FILETES_GUIADOS.includes(partes.filetes)) continue;
    const letra = letras[`${partes.textura}:${partes.capas}`];
    if (!letra) { anotarIlegible(); continue; }
    const claveBase = `${partes.tipo}${partes.tamano}${letra}`;
    if (!fichas[claveBase]) {
      if (suPrecio.base != null) sinFicha.set(claveBase, (sinFicha.get(claveBase) || 0) + 1);
      continue;
    }
    const clave = partes.paquete ? `${claveBase}P${partes.paquete}` : claveBase;
    if (!porClave.has(clave)) porClave.set(clave, { claveBase, paquete: partes.paquete, skus: [] });
    porClave.get(clave).skus.push(item.stock_id);
    skus.push({
      sku: item.stock_id,
      tipo: partes.tipo,
      tamano: partes.tamano,
      color1: partes.color1,
      textura: partes.textura,
      capas: partes.capas,
      filetes: partes.filetes,
      color2: partes.color2,
      colorRiso: partes.colorRiso,
      priceKey: clave,
      nombre: (item.description || '').trim(),
    });
  }

  const products = [];
  const divergentes = [];
  // Claves cuyos articulos EXISTEN en Operam pero ninguno tiene fila de "Precio de
  // lista": accionable distinto de SIN_SKU (aqui el pendiente es subirles precio en
  // el ERP, no crear articulos). Caso real que lo motivo: TP24R1B11211 (TP24B).
  const sinPrecioLista = [];
  for (const [clave, grupo] of porClave) {
    const conBase = grupo.skus
      .map(sku => ({ sku, ...preciosPorSku.get(sku) }))
      .filter(p => p.base != null);
    if (conBase.length === 0) {
      sinPrecioLista.push({ key: clave, articulos: [...grupo.skus] });
      continue;
    }
    const representante = precioRepresentante(conBase);
    if (representante.variantes.length > 1) {
      divergentes.push({ key: clave, precios: representante.variantes });
    }
    const ficha = fichas[grupo.claveBase] || {};
    const piezas = grupo.paquete;
    products.push({
      key: clave,
      name: piezas && ficha.name ? `${ficha.name} (paquete de ${piezas})` : (ficha.name ?? null),
      nameEn: piezas && ficha.nameEn ? `${ficha.nameEn} (pack of ${piezas})` : (ficha.nameEn ?? null),
      model: grupo.claveBase.replace(/[A-Z]$/, ''),
      weight_kg: ficha.weight_kg != null ? (piezas ? ficha.weight_kg * piezas : ficha.weight_kg) : null,
      prices: representante.prices,
    });
  }

  const fichasCalca = comp.calcas || {};
  // La familia se agrupa por codigo BASE (CAL1025 y CAL1025S son la misma calca en
  // migracion de unidad Actividad -> Servicio): entra al catalogo UNA de las dos, la
  // que tenga precios, y a precios de ambas manda la S (la unidad buena).
  const calcasPorBase = new Map();
  for (const item of activos) {
    if (!RE_CALCA.test(item.stock_id || '')) continue;
    const { base, prices } = preciosPorSku.get(item.stock_id);
    if (base == null && Object.values(prices).every(p => p == null)) continue;
    const codeBase = item.stock_id.replace(/S$/, '');
    const candidato = {
      code: item.stock_id,
      codeBase,
      name: (item.description || '').trim(),
      nameEn: fichasCalca[item.stock_id]?.nameEn ?? fichasCalca[codeBase]?.nameEn ?? null,
      unit: item.stock_id.endsWith('S') ? 'SER' : 'ACT',
      prices,
    };
    const previa = calcasPorBase.get(codeBase);
    if (!previa || candidato.code.endsWith('S')) calcasPorBase.set(codeBase, candidato);
  }
  const calcas = [...calcasPorBase.values()].map(({ codeBase, ...c }) => c);

  const catalogo = {
    version: version ?? comp.version ?? null,
    extracted,
    products,
    calcas,
    aplicacionExtra: comp.aplicacionExtra ?? null,
    tiers: TIERS.map(({ id, label, min_qty }) => ({ id, label, min_qty })),
    boxMap: comp.boxMap || [],
    skus,
    colores: comp.colores || {},
    texturas: comp.texturas || {},
    filetes: comp.filetes || {},
    colorFiletes: comp.colorFiletes || {},
    tiposProducto: [...new Set(skus.map(s => s.tipo))].sort(),
    tiposNombre: comp.tiposNombre || {},
  };

  // Huerfana = fila de precio cuyo articulo no existe NI como inactivo (borrado del
  // maestro). La fila de un articulo INACTIVO no es huerfana: es precio de un articulo
  // en desuso, se lista aparte como informativo.
  const idsItems = new Set((items || []).map(i => i.stock_id));
  const huerfanas = (precios || [])
    .filter(f => f.stock_id && !idsItems.has(f.stock_id) && Number(f.price) > 0)
    .map(f => ({ stock_id: f.stock_id, sales_type_id: String(f.sales_type_id), price: Number(f.price) }));
  const inactivasFilas = new Map();
  for (const f of precios || []) {
    if (!f.stock_id || !inactivos.has(f.stock_id) || Number(f.price) <= 0) continue;
    inactivasFilas.set(f.stock_id, (inactivasFilas.get(f.stock_id) || 0) + 1);
  }
  const inactivasConPrecio = [...inactivasFilas.entries()].map(([stock_id, filas]) => ({ stock_id, filas }));

  // El catalogo vigente puede referir SKUs que Operam ya retiro: en desuso (el
  // articulo existe pero esta inactivo -- el desactualizado es el Excel) o
  // inexistentes (nunca se cargaron -- el unico caso 2 real del corte #131).
  const idsActivos = new Set(activos.map(i => i.stock_id));
  const skusEnDesuso = [];
  const skusInexistentes = [];
  for (const s of referencia?.skus || []) {
    if (idsActivos.has(s.sku)) continue;
    (inactivos.has(s.sku) ? skusEnDesuso : skusInexistentes).push(s.sku);
  }

  const filas = clasificar(products, referencia?.products, 'key');
  // Las calcas NO tienen menudeo (se venden desde 100 piezas): Operam no les da fila
  // de "Precio de lista" y eso es lo CORRECTO. El Menudeo que la referencia del Excel
  // les pone es un piso de conveniencia del extractor (C100), no un precio real, asi
  // que Menudeo queda fuera de la comparacion — comparar contra el piso marcaba las
  // 16 calcas vigentes como MISMATCH sin que ningun precio real difiriera.
  // La comparacion de calcas es por codigo BASE en AMBOS lados: la referencia puede
  // decir CAL1025 (Excel) o CAL1025S (un catalogo ya generado, post-corte #131) y el
  // catalogo traer cualquiera de las dos (misma calca, unidad migrada) -- comparar por
  // stock_id literal inventaria un SIN_SKU y un NUEVO falsos por cada migracion.
  const aBase = c => ({ ...c, code: (c.code || '').replace(/S$/, '') });
  const calcasComparables = calcas.map(aBase);
  const refCalcas = referencia?.calcas ? referencia.calcas.map(aBase) : referencia?.calcas;
  const filasCalcas = clasificar(calcasComparables, refCalcas, 'code', TIERS.filter(t => t.id !== 'Menudeo'));
  // Los conteos por estado son de PRODUCTOS (las calcas se listan aparte).
  const resumen = { huerfanas: huerfanas.length, divergentes: divergentes.length, ilegibles: ilegibles.length };
  for (const estado of Object.values(ESTADOS_PARIDAD)) {
    resumen[estado] = filas.filter(f => f.estado === estado).length;
  }

  const paridad = {
    resumen,
    productos: filas,
    calcas: filasCalcas,
    huerfanas,
    divergentes,
    ilegibles,
    sinFicha: [...sinFicha.entries()].map(([key, articulos]) => ({ key, articulos })),
    sinPrecioLista,
    inactivasConPrecio,
    skusEnDesuso,
    skusInexistentes,
  };

  return { catalogo, paridad };
}
