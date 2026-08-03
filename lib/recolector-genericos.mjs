// Nucleo PURO del recolector de quotes de los debtors GENERICOS (issue #124). Los
// quotes levantados sobre un cliente-cajon (GENERICO TIENDAS DIGITALES y sus
// hermanos) no tienen contraparte nombrada en Operam, asi que el backfill #76 los
// dejo fuera del pipeline; aqui se rescatan como CANDIDATOS a prospecto para la
// bandeja de revision (#122), donde un humano decide uno por uno.
//
// SIN IO: el script scripts/rescatar-genericos.mjs orquesta estas funciones con las
// lecturas de Operam (read-only), los catalogos y el deposito en la bandeja.
// Mismo reparto que backfill-operam.mjs / scripts/backfill-operam.mjs.

// El celular se guarda LIMPIO, no solo se compara limpio (#123).
import { limpiarTelefonoParaGuardar, cruzarIdentidad, CERRO, COMPRO_OTRA_COSA } from './cruce-identidad.js';
// Los 5 clientes-cajon (143, 183, 184, 256, 449) viven en un solo lugar.
import { DEBTORS_GENERICOS } from './deduplicacion.js';
// La MISMA llave de identidad de prospecto que usa el store (1 celular = 1
// prospecto), para que el aviso de duplicado dentro del lote hable el mismo idioma
// que el aviso contra los prospectos ya existentes.
import { ultimos10 } from './telefono-llave.js';
// Mismo mapeo de vendedor que el backfill (#76): operam_id -> name y real_name del
// usuario creador -> name, sin inventar vendedores que no esten en el catalogo.
import { mapearSalesman, mapearVendedorPorUsuario } from './backfill-operam.mjs';

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

// El debtor del quote como NUMERO (los ids de DEBTORS_GENERICOS son numericos y
// Operam manda el campo como texto). null cuando falta o no es un id.
function debtorDeQuote(quote) {
  const v = (quote || {}).debtor_no;
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Llave de identidad del celular del quote (ultimos 10 digitos), o '' si no trae.
// Es la llave del prospecto, no una normalizacion nueva.
function llaveCelular(quote) {
  return ultimos10(limpiarTelefonoParaGuardar((quote || {}).contact_phone)) || '';
}

// Vendedor PROPUESTO del candidato (#124). El orden es el INVERSO al del backfill
// (#76, construirEntradaCotizacion), a proposito: en un quote de debtor generico el
// `salesman` no describe quien vendio sino a quien esta asignado el cliente-cajon
// COMPARTIDO (casi siempre 7 = Mostrador, que por decision no entra al catalogo),
// asi que atribuirle todos los quotes del cajon a ese vendedor seria falso. Quien
// cotizo es el USUARIO CREADOR (user.real_name, sin acentos en Operam); el salesman
// queda como fallback por si el creador no esta en el catalogo. null cuando ninguno
// mapea: la bandeja obliga al humano a elegir vendedor al aceptar, y un vendedor
// inventado es peor que ninguno.
export function resolverVendedorPropuesto(quote, vendedores) {
  const q = quote || {};
  const creador = mapearVendedorPorUsuario(q.user?.real_name, vendedores);
  if (creador) return creador;
  return mapearSalesman(q.salesman ?? q.branch?.salesman, vendedores);
}

// El candidato que recibe bandejaStore.proponer (#122). El folio del quote es la
// clave natural de la bandeja, de ahi que entre por parametro: el walk lo conoce
// (es el id que se leyo), la cabecera del quote no lo expone con un nombre estable.
export function candidatoDesdeQuote({ folio, quote, vendedores, debtorNombre, marcas } = {}) {
  const q = quote || {};
  const m = marcas || {};
  return {
    folio: String(folio),
    tipo: 'prospecto',
    fecha: q.ord_date || null,
    contacto: texto(q.deliver_to),
    celular: limpiarTelefonoParaGuardar(q.contact_phone),
    email: texto(q.contact_email),
    proyecto: primeroNoVacio(q.cust_ref, q.customer_ref),
    domicilio: texto(q.delivery_address),
    monto: num(q.total),
    debtorId: debtorDeQuote(q),
    debtorNombre: texto(debtorNombre),
    vendedor: resolverVendedorPropuesto(q, vendedores),
    // Las dos marcas viajan SIEMPRE completas (misma regla que el store): la vista
    // las pinta por presencia y un booleano ausente se leeria como false por
    // accidente en vez de por decision.
    marcas: {
      comproOtraCosa: m.comproOtraCosa === true,
      posibleDuplicado: m.posibleDuplicado === true,
    },
  };
}

// VENTANA del lote (decision Adrian 2026-08-03): 6 meses hacia atras. Es el
// alcance que la medicion #118 midio de punta a punta (27 candidatos, 27 de 27 sin
// senal de cierre no existen como cliente); ampliarla es una decision de negocio,
// por eso el script la expone como flag en vez de fijarla aqui.
export const MESES_VENTANA = 6;

// Fecha de corte (YYYY-MM-DD) de la ventana. `hoy` entra por parametro para que la
// funcion sea pura y testeable; el script pasa la fecha del dia.
export function fechaCorteMeses(meses = MESES_VENTANA, hoy = new Date().toISOString().slice(0, 10)) {
  const d = new Date(`${String(hoy).slice(0, 10)}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - Number(meses));
  return d.toISOString().slice(0, 10);
}

// Motivos de EXCLUSION del lote. Son constantes explicitas y se comparan por
// igualdad (misma leccion que las categorias del cruce, #123: comparar por prefijo
// conto vivos como cerrados en la medicion).
export const MOTIVOS = Object.freeze({
  NO_GENERICO: 'no-generico',
  CANCELADO: 'cancelado',
  YA_EN_BANDEJA: 'ya-en-bandeja',
  TOTAL_CERO: 'total-cero',
  CERRO: 'cerro',
});

// El nombre del cliente-cajon sale del MISMO catalogo que ya se leyo para el cruce:
// los debtors genericos son clientes de Operam como cualquier otro. Sin lectura extra.
function nombreDeDebtor(clientes, debtorNo) {
  for (const c of clientes || []) {
    if (!c) continue;
    const id = c.customer_id != null ? c.customer_id : c.debtor_no;
    if (id != null && String(id) === String(debtorNo)) return c.CustName || c.cust_name || '';
  }
  return '';
}

// Decide QUE hacer con un quote ya leido, contra los catalogos ya leidos. Devuelve
// SIEMPRE la misma forma:
//   { motivo, candidato, cruce }
//   motivo     null si es candidato; si no, uno de MOTIVOS (por que se excluyo)
//   candidato  el objeto que recibe bandejaStore.proponer, o null si se excluyo
//   cruce      el resultado de cruzarIdentidad (#123) cuando se corrio, o null. Es
//              la EVIDENCIA que imprime el dry-run: sin ella una exclusion por
//              "ya cerro" seria una caja negra (misma exigencia que #76).
//
// El orden de los filtros es deliberado: primero los LOCALES y baratos (pertenencia
// al cajon, cancelado, ya en bandeja, monto $0) y al final el cruce por identidad,
// que recorre los catalogos completos.
//
// `celularesDelLote` es de SOLO LECTURA aqui (las llaves de celular de los
// candidatos que ya salieron en esta corrida): quien camina el lote la mantiene
// (planearRecoleccion), para que esta funcion siga siendo pura.
export function evaluarQuote({
  folio, quote, clientes, pedidos, prospectos, vendedores,
  cancelados = [], bandejaFolios = [], celularesDelLote = new Set(),
} = {}) {
  const q = quote || {};
  const f = String(folio);
  const excluir = (motivo, cruce = null) => ({ motivo, candidato: null, cruce });

  const debtorNo = debtorDeQuote(q);
  if (debtorNo == null || !DEBTORS_GENERICOS.has(debtorNo)) return excluir(MOTIVOS.NO_GENERICO);
  if (new Set([...cancelados].map(String)).has(f)) return excluir(MOTIVOS.CANCELADO);
  if (new Set([...bandejaFolios].map(String)).has(f)) return excluir(MOTIVOS.YA_EN_BANDEJA);
  // Un quote de $0 no es una oportunidad (error de captura, muestra o prueba). Va
  // ANTES del cruce a proposito: sin monto la banda de +-15% no discrimina nada.
  if (num(q.total) <= 0) return excluir(MOTIVOS.TOTAL_CERO);

  const cruce = cruzarIdentidad({ quote: q, clientes, pedidos, prospectos });
  // CERRO se compara por IGUALDAD contra la constante, nunca por prefijo (#123).
  if (cruce.categoria === CERRO) return excluir(MOTIVOS.CERRO, cruce);

  const candidato = candidatoDesdeQuote({
    folio: f,
    quote: q,
    vendedores,
    debtorNombre: nombreDeDebtor(clientes, debtorNo),
    marcas: {
      // El contacto ya es cliente y compro OTRA cosa: la cotizacion puede seguir
      // viva, y es justo el caso que el humano debe juzgar (decision #124).
      comproOtraCosa: cruce.categoria === COMPRO_OTRA_COSA,
      // Duplicado por celular en DOS frentes: contra los prospectos que ya existen
      // (#123) y contra los candidatos que ya salieron en ESTE lote. El segundo hace
      // falta porque un cliente pide 2-3 cotizaciones del mismo proyecto (folios
      // 1120/1121 de la medicion, mismo celular): ninguno es prospecto todavia, asi
      // que sin esto los dos entrarian sin marca y al aceptarlos nacerian dos
      // tarjetas de la misma persona.
      posibleDuplicado: cruce.duplicadoProspecto != null || celularesDelLote.has(llaveCelular(q)),
    },
  });
  return { motivo: null, candidato, cruce };
}

// Deposita los candidatos del plan en la bandeja (#122) con el `proponer`
// inyectado (el store real en el script; el mismo store en fallback de disco en los
// tests). La IDEMPOTENCIA no se implementa aqui: la da la clave natural del store
// (folio) -- proponer devuelve false cuando el folio ya estaba en la bandeja EN
// CUALQUIER ESTADO, asi que un candidato aceptado o descartado no puede regresar.
// Esta funcion solo recorre y cuenta, en serie: dos INSERT del mismo folio en
// paralelo no aportan nada y el volumen del lote es de decenas.
export async function depositarCandidatos(plan, proponer) {
  let agregados = 0;
  let yaEstaban = 0;
  for (const { candidato } of (plan && plan.candidatos) || []) {
    if (await proponer(candidato)) agregados++;
    else yaEstaban++;
  }
  return { agregados, yaEstaban };
}

// Contador por motivo, con la misma llave que MOTIVOS pero en camelCase (asi el
// dry-run puede imprimir plan.skips.<motivo> sin traducir a mano).
const LLAVE_SKIP = Object.freeze({
  [MOTIVOS.NO_GENERICO]: 'noGenerico',
  [MOTIVOS.CANCELADO]: 'cancelado',
  [MOTIVOS.YA_EN_BANDEJA]: 'yaEnBandeja',
  [MOTIVOS.TOTAL_CERO]: 'totalCero',
  [MOTIVOS.CERRO]: 'cerro',
});

// PLAN del lote historico (#124). Camina folios de quote de `folioMax` hacia ABAJO
// leyendo el lector inyectado (en el script, GET /sales/quote/{id} paceado):
//   - null (404): el folio no existe o se anulo -> SALTA. Una racha de
//     `maxRachaVacia` 404 seguidos corta el walk (techo de volumen: sin esto se
//     bajaria hueco por hueco hasta folioMin).
//   - ord_date < fechaCorte: fuera de la ventana -> DETIENE el walk (los folios son
//     crecientes en el tiempo, todo lo de abajo es mas viejo).
//   - resto: lo decide evaluarQuote contra los catalogos ya leidos.
// El id-walk es la UNICA enumeracion posible: los quotes (tipo 32) no se listan
// (filterType=32 devuelve 0 y el campo del listado es `type`, no `trans_type`,
// medicion 2026-08-01).
//
// Devuelve un PLAN; no escribe nada (el deposito es depositarCandidatos).
export async function planearRecoleccion({
  obtenerQuote, folioMax, folioMin = 1, fechaCorte,
  clientes, pedidos, prospectos, vendedores,
  cancelados = [], bandejaFolios = [], maxRachaVacia = 50,
} = {}) {
  const plan = {
    folioMax: folioMax != null ? Number(folioMax) : null,
    folioMin: Number(folioMin),
    fechaCorte: fechaCorte || null,
    leidos: 0,
    candidatos: [],
    // Solo las exclusiones DEL LOTE (quotes de los cajones genericos): son las que
    // el humano revisa folio por folio. Los quotes de clientes nombrados se cuentan
    // en skips.noGenerico y no se listan -- son el grueso del walk y no dicen nada.
    excluidos: [],
    skips: { noGenerico: 0, cancelado: 0, yaEnBandeja: 0, totalCero: 0, cerro: 0 },
  };
  if (folioMax == null) return plan;

  const canceladosSet = new Set([...cancelados].map(String));
  const bandejaSet = new Set([...bandejaFolios].map(String));
  // Celulares de los candidatos que ya salieron en ESTE lote (llave de prospecto).
  // El walk va del folio mas nuevo al mas viejo, asi que la marca cae en la
  // cotizacion mas ANTIGUA del mismo contacto: la nueva es la vigente.
  const celularesDelLote = new Set();
  let rachaVacia = 0;

  for (let folio = Number(folioMax); folio >= plan.folioMin; folio--) {
    const quote = await obtenerQuote(folio);
    plan.leidos++;
    if (!quote) {
      if (++rachaVacia >= maxRachaVacia) break;
      continue;
    }
    rachaVacia = 0;
    // La ventana corta el walk SOLO con una fecha real: un quote sin ord_date no es
    // "anterior a la ventana" -- tratarlo como tal (cadena vacia < fechaCorte) mataria
    // el resto del lote por un dato faltante en UN folio.
    const fechaQuote = String(quote.ord_date || '').slice(0, 10);
    if (fechaCorte && fechaQuote !== '' && fechaQuote < String(fechaCorte).slice(0, 10)) break;

    const r = evaluarQuote({
      folio, quote, clientes, pedidos, prospectos, vendedores,
      cancelados: canceladosSet, bandejaFolios: bandejaSet, celularesDelLote,
    });
    if (r.motivo === null) {
      const llave = llaveCelular(quote);
      if (llave !== '') celularesDelLote.add(llave);
      plan.candidatos.push({ candidato: r.candidato, cruce: r.cruce });
      continue;
    }
    plan.skips[LLAVE_SKIP[r.motivo]]++;
    if (r.motivo === MOTIVOS.NO_GENERICO) continue;
    plan.excluidos.push({
      folio: String(folio),
      motivo: r.motivo,
      fecha: quote.ord_date || null,
      contacto: texto(quote.deliver_to),
      monto: num(quote.total),
      cruce: r.cruce,
    });
  }
  return plan;
}
