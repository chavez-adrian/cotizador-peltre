import {
  altaCsfResultadoParseo,
  combinarTelefonoConCodigo,
  validarTelefono,
  separarTelefonoCodigo,
  calcularDiffFiscal,
  buildDiffFiscalHtml,
  buildDedupExactoConDiffHtml,
  buildCandidatosRfcGenericoHtml,
  buildAltaDarDeAltaPayload,
  buildClienteDesdeAlta,
  mensajeBusquedaCelular,
  mezclarResultadosBusqueda,
  recientesDesdeCotizaciones,
  chipsCompletitud,
  buildClienteDesdeContactoNuevo,
  clienteDesdeProspecto,
  accionCelularContactoNuevo,
  decidirVistaTrasBusqueda,
  accionProspecto409,
  paisDesdeCodigoTelefono,
  customerIdFiscal,
  validarAltaManualMinimos,
  emailFacturaParaUpgrade,
  contactosEntregaDisponibles,
  etiquetaTagContacto,
} from './alta-logica.js';
import {
  CANALES,
  PIEZAS_ESTIMADAS,
  validarProspectoBody,
  buildProspectoPayload,
  buildProspectoCardHtml,
  buildProspectoExistenteHtml,
  buildMotivosNoUtilHtml,
  buildColaProspectosHtml,
  escapeHtml,
  necesitaCanal,
  validarCanalCotizacion,
  buildCanalModalHtml,
  MOTIVOS_NO_UTIL,
  buildMotivoNoUtilModalHtml,
  validarEdicionProspecto,
} from './prospectos-logica.js';
import {
  puedeArrastrarCotizacion,
  buildTableroCotizacionesHtml,
  buildHistorialAccionesHtml,
  buildAccionesCargaHtml,
  buildAvisoModoActualizacion,
  textoBotonGenerar,
  filtrarCotizaciones,
} from './cotizaciones-logica.js';
import {
  buildTableroPipelineHtml,
  oportunidadesActivas,
  badgeFolioOperamHtml,
  badgeFolioOperamProspectoHtml,
  cadenaOperamHtml,
  badgePagoSinRegistrarHtml,
  botonCompletarHtml,
  interpretarSubidaOperam,
  buildOperamStatusHtml,
  interpretarActualizacionOperam,
  buildActualizacionStatusHtml,
  badgeQuoteDesactualizadoHtml,
  buildColaHoyHtml,
  buildMenuNuevoHtml,
  buildCerradasHtml,
  filaResultadoClienteHtml,
  filaCrearClienteHtml,
  cardClienteHtml,
  bannerUpgradeHtml,
} from './pipeline-logica.js';
import {
  buildBandejaHtml,
} from './bandeja-logica.js';
import {
  estadoStepper,
  textoProgreso,
} from './stepper-logica.js';
import {
  validarDomicilioEntrega,
  formatCarrier,
  formatServicio,
  cpValido,
  buildConfirmarVendedorModalHtml,
  debeInvalidarEnvioPorCantidad,
  bloqueaGeneracionPorEnvioInvalidado,
  MENSAJE_ENVIO_INVALIDADO,
  aplicarNotaTiempoEntrega,
  formatTiempoEntrega,
  formatDescripcionEnvioEnvia,
  buildEnvioEstructurado,
  restaurarEnvioDesdeCotizacion,
  debeAutoCotizarEnvia,
  buildEnviaRateRestauradaHtml,
  buildItemsYTotales,
  buildItemEnvio,
  importeLinea,
  nombreVisibleProducto,
} from './cotizar-logica.js';
import {
  puedeDescontar,
  validarDescuentoLinea,
  descuentoGlobalVigente,
} from './descuento-logica.js';
import {
  MAX_DESCRIPCION,
  validarDescripcionLinea,
} from './descripcion-logica.js';
import {
  TAMANOS_CALCA,
  TINTAS_CALCA,
  esCodigoCalca,
  buscarCalcaEnCatalogo,
  precioCalca,
  productoCalca,
  piezasDeProducto,
  hayCalcaEnCarrito,
  puedeAgregarCalca,
  motivoCalcaInvalida,
  MOTIVOS_CALCA_INVALIDA,
  bloqueaGeneracionPorCalcaSinVolumen,
  avisoCalcaInvalida,
  avisoNoPuedeAgregarCalca,
  relacionCalcaProducto,
  estadoMarcaDecorado,
} from './calcas-logica.js';

// === TELEFONOS (bloqueo duro con codigo de pais) ===
function leerTelefono(inputId, codeId) {
  return combinarTelefonoConCodigo(
    document.getElementById(codeId)?.value,
    document.getElementById(inputId)?.value
  );
}

function setTelefonoCampos(inputId, codeId, telefono) {
  const { code, numero } = separarTelefonoCodigo(telefono);
  const codeEl = document.getElementById(codeId);
  const inputEl = document.getElementById(inputId);
  if (codeEl) codeEl.value = code;
  if (inputEl) inputEl.value = numero;
}

function validarTelefonosCotizacion() {
  const errTel = validarTelefono(
    document.getElementById('cl-telefono-code')?.value,
    document.getElementById('cl-telefono')?.value
  );
  if (errTel) return `Telefono: ${errTel}`;
  const cel = document.getElementById('cl-cel-entrega')?.value?.trim();
  if (cel) {
    const errCel = validarTelefono(document.getElementById('cl-cel-entrega-code')?.value, cel);
    if (errCel) return `Celular de entrega: ${errCel}`;
  }
  return null;
}

// Lee el domicilio de entrega del DOM y delega en la funcion pura (#71/#84).
// Ya no bloquea la generacion (#84 AC4): solo decide si hace falta la leyenda
// de confirmacion cuando falta Calle.
function validarDomicilioCotizacion() {
  return validarDomicilioEntrega({
    calle: document.getElementById('cl-calle')?.value,
  });
}

// Lee los campos cl-* del cliente/domicilio para el body de /api/cotizacion
// (identico en PDF y HTML -- un solo lugar, #84). `leyenda`
// es el resultado de validarDomicilioCotizacion().
function leerClienteFormulario(leyenda) {
  return {
    razonSocial: document.getElementById('cl-razon-social').value,
    nombreCorto: document.getElementById('cl-nombre-corto').value,
    rfc: document.getElementById('cl-rfc').value,
    cpFiscal: document.getElementById('cl-cp-fiscal').value,
    segmentoId: document.getElementById('cl-segmento')?.value || '',
    telefono: leerTelefono('cl-telefono', 'cl-telefono-code'),
    nombreEntrega: document.getElementById('cl-nombre-entrega').value,
    calle: document.getElementById('cl-calle').value,
    numInt: document.getElementById('cl-num-int').value,
    colonia: document.getElementById('cl-colonia').value,
    cpEntrega: document.getElementById('cl-cp-entrega').value,
    municipio: document.getElementById('cl-municipio').value,
    estado: document.getElementById('cl-estado').value,
    celEntrega: leerTelefono('cl-cel-entrega', 'cl-cel-entrega-code'),
    emailEntrega: document.getElementById('cl-email-entrega').value,
    emailFactura: document.getElementById('cl-email-factura').value,
    referencias: document.getElementById('cl-referencias').value,
    referencia: document.getElementById('cl-referencia').value,
    pais: document.getElementById('cl-pais')?.value || 'MX',
    leyendaDomicilio: leyenda || '',
  };
}

// === UTILS ===
function toTitleCase(str) {
  if (!str) return str;
  const lower = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'o', 'a', 'en', 'al', 'el', 'por', 'con', 'sin']);
  return str.trim().toLowerCase().split(/\s+/).map((w, i) => {
    if (i > 0 && lower.has(w)) return w;
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ');
}

// === STATE ===
const state = {
  token: localStorage.getItem('token'),
  user: JSON.parse(localStorage.getItem('user') || 'null'),
  precios: null,
  cart: new Map(), // key -> { product, cantidad, descuento }
  shipping: { option: 'none', desc: '', cost: 0 },
  // Tope de descuento del vendedor logueado (#137): 0 = sin permiso. Lo manda el
  // servidor con los precios en cada arranque de sesion; el servidor lo vuelve a
  // hacer valer al guardar, esto solo decide que puede capturar la pantalla.
  topeDescuento: 0,
  lastCotizacionId: null,
  // Modo actualizacion (#104, ADR-0008): se entro por "Actualizar cotizacion" desde
  // el historial, asi que generar reescribe el MISMO registro y el MISMO quote de
  // Operam (conservando el folio) en vez de crear una cotizacion nueva. Cualquier
  // cosa que termine la sesion de cotizacion lo apaga.
  modoActualizacion: false,
  // Vendedor ya confirmado para la cotizacion en curso (#113). El modal de #87
  // existe para no estampar al vendedor equivocado, y eso solo puede cambiar al
  // EMPEZAR una cotizacion: dentro de la misma, preguntar otra vez por el segundo
  // formato es ruido (Adrian: genero el PDF y "Ver HTML" volvio a preguntar por
  // una cotizacion que ya estaba generada y subida). Se apaga en los mismos tres
  // puntos que lastCotizacionId: cotizacion nueva, cambio de cliente y cargar del
  // historial -- los unicos en que puede cambiar quien queda estampado.
  vendedorConfirmado: false,
};

let searchSelected = null; // { key, sku, product }

// Estado del flujo guiado
const guiado = {
  tipo: null, tamano: null, color1: null, textura: null,
  color2: null, filetes: null, colorRiso: null, cantidad: 1,
};

// === API ===
async function api(url, opts = {}) {
  const headers = { ...opts.headers };
  if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
  if (opts.body && !(opts.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch(url, { ...opts, headers });
  // Sesion expirada (#87, sesion de 24h): NO se usa logout() aqui porque
  // destruiria el carrito/captura en curso. sesionExpirada() solo invalida
  // el token y pide reloguear; el trabajo en memoria se conserva.
  if (res.status === 401) { sesionExpirada(); throw new Error('No autorizado'); }
  return res;
}

// === AUTH ===
async function loadVendedores() {
  const res = await fetch('/api/vendedores');
  const vendedores = await res.json();
  const sel = document.getElementById('login-vendedor');
  sel.innerHTML = vendedores.map(v =>
    `<option value="${v.id}">${v.name}</option>`
  ).join('');
}

async function login() {
  const vendedorId = parseInt(document.getElementById('login-vendedor').value);
  const pin = document.getElementById('login-pin').value;
  const errEl = document.getElementById('login-error');
  errEl.style.display = 'none';

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vendedorId, pin }),
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error; errEl.style.display = 'block'; return; }

    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    showApp();
  } catch (e) {
    errEl.textContent = 'Error de conexion';
    errEl.style.display = 'block';
  }
}

// Oculta las vistas de la app y muestra el login. Compartido por logout()
// (cierre explicito) y sesionExpirada() (401 con sesion de 24h, #87) -- la
// diferencia entre ambos esta en que estado de negocio limpian, no en el DOM.
function mostrarLoginView() {
  document.getElementById('app-view').style.display = 'none';
  document.getElementById('historial-view').style.display = 'none';
  const hv = document.getElementById('hoy-view');
  if (hv) hv.style.display = 'none';
  document.getElementById('prospectos-view').style.display = 'none';
  const pv = document.getElementById('pipeline-view');
  if (pv) pv.style.display = 'none';
  const bn = document.getElementById('bottom-nav');
  if (bn) bn.style.display = 'none';
  document.getElementById('login-view').style.display = 'flex';
  document.getElementById('login-pin').value = '';
}

// Cierre de sesion EXPLICITO (boton Salir): limpia todo, incluido el carrito.
function logout() {
  state.token = null;
  state.user = null;
  state.precios = null;
  state.cart.clear();
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  mostrarLoginView();
}

// Sesion expirada (401, #87): a diferencia de logout(), NO toca el carrito ni
// la captura en curso -- solo invalida el token y pide reloguear. Al volver a
// entrar, login() llama showApp() y el carrito/cliente en memoria siguen ahi.
function sesionExpirada() {
  state.token = null;
  state.user = null;
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  mostrarLoginView();
}

// === APP INIT ===
async function showApp() {
  document.getElementById('login-view').style.display = 'none';
  document.getElementById('historial-view').style.display = 'none';
  document.getElementById('app-view').style.display = 'block';
  document.getElementById('bottom-nav').style.display = 'flex';
  marcarNavActivo('nav-cotizar');
  document.getElementById('user-name').textContent = state.user.name;

  // Admin link visibility
  const adminLink = document.getElementById('admin-link');
  if (state.user.role === 'admin') adminLink.style.display = 'inline-flex';
  else adminLink.style.display = 'none';

  // La bandeja de rescatados es admin-only (issue #122, misma visibilidad que el
  // reporte de higiene #86). El gate real vive en el servidor; esto solo evita
  // ofrecer una vista que respondera 403.
  const bandejaBtn = document.getElementById('mas-rescatados');
  if (bandejaBtn) bandejaBtn.style.display = state.user.role === 'admin' ? 'inline-flex' : 'none';

  await loadPrecios();
  renderProducts();
  renderFlujoGuiado();
  updateTierBar();
  updateCartSummary();
  switchTab('cliente');
  pcRenderInicio();
  cargarBadgeSeguimiento();
}

async function loadPrecios() {
  const res = await api('/api/precios');
  state.precios = await res.json();
  state.topeDescuento = state.precios.topeDescuento || 0;
  const date = new Date(state.precios.extracted).toLocaleDateString('es-MX', {
    day: 'numeric', month: 'short', year: 'numeric'
  });
  document.getElementById('prices-date').textContent = `Precios: ${date}`;
}

// === TIER LOGIC ===
// El volumen que fija el tier son las piezas de PRODUCTO: las de calca no
// cuentan (issue #91, decision 2026-07-30). La calca hereda el tier para su
// precio pero no lo empuja -- va aplicada sobre piezas que ya estan contadas.
function itemsDelCarrito() {
  return [...state.cart].map(([codigo, { cantidad }]) => ({ codigo, cantidad }));
}

function getPiezasProducto() {
  return piezasDeProducto(itemsDelCarrito());
}

function getCurrentTier() {
  const total = getPiezasProducto();
  const tiers = state.precios?.tiers || [];
  let current = tiers[0];
  for (const t of tiers) {
    if (total >= t.min_qty) current = t;
  }
  return current;
}

function getNextTier() {
  const total = getPiezasProducto();
  const tiers = state.precios?.tiers || [];
  for (const t of tiers) {
    if (t.min_qty > total) return t;
  }
  return null;
}

// Precio unitario en el tier vigente, o null si el item NO tiene precio ahi.
// La calca no tiene menudeo (#91): resolverla con el `?? 0` de siempre la
// regalaria en el documento y en el quote. La ausencia se dice con null y el
// carrito la pinta como invalida, en vez de imprimir un cero silencioso.
function precioUnitario(product) {
  const tier = getCurrentTier();
  if (product.esCalca) return precioCalca(product, tier.id);
  return product.prices[tier.id] ?? product.prices['Menudeo'] ?? 0;
}

function getPrice(product) {
  return precioUnitario(product) ?? 0;
}

function updateTierBar() {
  const total = getPiezasProducto();
  const tier = getCurrentTier();
  const next = getNextTier();

  document.getElementById('tier-label').textContent = total === 0 ? 'Sin productos' : `Lista de precios: ${tier.label}`;
  document.getElementById('tier-stats').textContent = total > 0 ? `${total} pzs de producto` : '';
  document.getElementById('tier-next').textContent = '';

  // El selector de calca y el aviso de carrito invalido dependen del volumen:
  // este es el unico punto por el que pasan TODOS los cambios del carrito.
  renderCalcas();
  updateTabIndicators();
}

// === STEPPER INDICATOR (issue #60) ===
// Deriva la completitud de cada paso con los mismos criterios de siempre
// (cliente = razon social con valor, productos = carrito no vacio, envio =
// opcion elegida) y delega el modelo de avance/estado a stepper-logica.js
// (modulo puro, probado). Pinta el riel (numero/completo/actual + dots) y la
// barra de progreso. Guia y muestra avance sin bloquear el clic libre (AC2).
function pasoActualStepper() {
  const activo = document.querySelector('.tab.active');
  return activo?.dataset?.tab || 'cliente';
}

function estadoFlujoCotizar() {
  const opt = document.getElementById('shipping-option')?.value;
  return {
    clienteListo: !!(document.getElementById('cl-razon-social')?.value?.trim()),
    productosListos: state.cart.size > 0,
    envioListo: !!(opt && opt !== 'none'),
  };
}

function updateTabIndicators() {
  const vista = estadoStepper(pasoActualStepper(), estadoFlujoCotizar());

  vista.pasos.forEach(p => {
    const tab = document.querySelector(`.tab[data-tab="${p.paso}"]`);
    if (tab) tab.classList.toggle('completo', p.completo && !p.esActual);
    const dot = document.getElementById(`dot-${p.paso}`);
    if (dot) dot.classList.toggle('visible', p.completo);
  });

  const texto = document.getElementById('stepper-progress-text');
  if (texto) texto.textContent = textoProgreso(vista.actual);
  const fill = document.getElementById('stepper-progress-fill');
  if (fill) fill.style.width = `${Math.round(vista.progreso.fraccion * 100)}%`;
}

// === PRODUCTS / BUSCADOR TIPO OPERAM ===

function renderProducts() {
  // ya no se usa para renderizar la lista; el buscador usa el dropdown
}

function renderSearchDropdown(filter) {
  const dropdown = document.getElementById('search-dropdown');
  if (!state.precios || !dropdown) return;

  const f = filter.trim();
  if (f.length === 0) {
    dropdown.style.display = 'none';
    return;
  }

  // Búsqueda por tokens: cada palabra del query debe aparecer en sku+nombre
  const tokens = f.toLowerCase().split(/\s+/).filter(Boolean);
  const matchesTokens = (text) => tokens.every(t => text.includes(t));

  const skus = state.precios.skus || [];
  const products = state.precios.products || [];

  // Buscar primero en SKUs completos
  const skuMatches = skus.filter(s => {
    const haystack = ((s.sku || '') + ' ' + (s.nombre || '')).toLowerCase();
    return matchesTokens(haystack);
  }).slice(0, 25);

  let items;
  if (skuMatches.length > 0) {
    items = skuMatches.map(s => {
      const product = products.find(p => p.key === s.priceKey);
      const price = product ? getPrice(product) : 0;
      return { key: s.sku, name: s.nombre, price, inCart: state.cart.has(s.sku) };
    });
  } else {
    // Fallback: buscar en price keys
    items = products.filter(p => {
      const haystack = ((p.key || '') + ' ' + (p.name || '')).toLowerCase();
      return matchesTokens(haystack);
    }).slice(0, 25).map(p => ({
      key: p.key,
      name: p.name.replace(/^[A-Z]{2,3}\d{2}\s+/, ''),
      price: getPrice(p),
      inCart: state.cart.has(p.key),
    }));
  }

  if (items.length === 0) {
    dropdown.innerHTML = '<div class="dropdown-empty">Sin resultados</div>';
    dropdown.style.display = 'block';
    return;
  }

  dropdown.innerHTML = items.map(item => `
    <div class="dropdown-item${item.inCart ? ' in-cart' : ''}" onmousedown="selectSearchItem('${item.key}')">
      <span class="dropdown-item-sku">${item.key}</span>
      <span class="dropdown-item-name">${item.name}</span>
      <span class="dropdown-item-price">$${fmt(item.price)}</span>
    </div>
  `).join('');

  dropdown.style.display = 'block';
}

function selectSearchItem(key) {
  const skus = state.precios?.skus || [];
  const products = state.precios?.products || [];

  const sku = skus.find(s => s.sku === key);
  const product = sku
    ? products.find(p => p.key === sku.priceKey)
    : products.find(p => p.key === key);
  if (!product) return;

  searchSelected = { key, sku, product };

  const price = getPrice(product);
  const name = sku ? sku.nombre : product.name.replace(/^[A-Z]{2,3}\d{2}\s+/, '');
  const existingQty = state.cart.has(key) ? state.cart.get(key).cantidad : 0;

  const selectedEl = document.getElementById('search-selected');
  selectedEl.innerHTML = `
    <div class="search-selected-item">
      <div class="search-selected-info">
        <span class="search-selected-sku">${key}</span>
        <span class="search-selected-name">${name}</span>
        <span class="search-selected-price">$${fmt(price)} / pza</span>
      </div>
      <div class="search-selected-actions">
        <button class="qty-btn" onclick="changeSearchQty(-1)">-</button>
        <input class="qty-input" type="number" min="1" value="${existingQty || 1}" id="search-qty" inputmode="numeric">
        <button class="qty-btn" onclick="changeSearchQty(1)">+</button>
        <button class="btn btn-primary btn-sm" onclick="addSearchItemToCart()">Agregar</button>
        <button class="btn btn-secondary btn-sm" onclick="clearSearchSelected()">&times;</button>
      </div>
    </div>
  `;
  selectedEl.style.display = 'block';

  document.getElementById('search-dropdown').style.display = 'none';
  document.getElementById('search-input').value = '';
  setTimeout(() => document.getElementById('search-qty')?.select(), 50);
}

function changeSearchQty(delta) {
  const el = document.getElementById('search-qty');
  if (!el) return;
  el.value = Math.max(1, (parseInt(el.value) || 1) + delta);
}

function addSearchItemToCart() {
  if (!searchSelected) return;
  const { key, sku, product } = searchSelected;
  const qty = parseInt(document.getElementById('search-qty')?.value) || 1;

  let cartProduct;
  if (sku) {
    cartProduct = {
      key,
      name: sku.nombre,
      model: sku.tipo + sku.tamano,
      weight_kg: product.weight_kg,
      prices: product.prices,
    };
  } else {
    cartProduct = product;
  }

  const prev = state.cart.get(key);
  state.cart.set(key, conservarCaptura(key, { product: cartProduct, cantidad: (prev?.cantidad || 0) + qty }));

  updateTierBar();
  updateCartSummary();
  updateResumen();
  updateShippingSummary();
  renderCartLines();
  clearSearchSelected();
}

function clearSearchSelected() {
  searchSelected = null;
  const sel = document.getElementById('search-selected');
  if (sel) sel.style.display = 'none';
  const inp = document.getElementById('search-input');
  if (inp) { inp.value = ''; inp.focus(); }
}

window.selectSearchItem = selectSearchItem;
window.changeSearchQty = changeSearchQty;
window.addSearchItemToCart = addSearchItemToCart;
window.clearSearchSelected = clearSearchSelected;

// === CALCAS (issue #91, ADR-0010) ===
// La calca es una partida propia del carrito, sin ligarse a un producto base:
// el selector resuelve tamano x tintas contra el catalogo y la cantidad son
// PIEZAS DECORADAS. Todo lo que se pinta aqui depende del volumen de producto,
// asi que se repinta desde updateTierBar (por donde pasa todo cambio de carrito).
function catalogoCalcas() {
  return state.precios?.calcas || [];
}

function poblarSelectoresCalca() {
  const tam = document.getElementById('cal-tamano');
  const tintas = document.getElementById('cal-tintas');
  if (!tam || !tintas || tam.options.length > 0) return;
  tam.innerHTML = TAMANOS_CALCA.map(t => `<option value="${t.valor}">${t.etiqueta}</option>`).join('');
  tintas.innerHTML = TINTAS_CALCA.map(n => `<option value="${n}">${n} tinta${n !== 1 ? 's' : ''}</option>`).join('');
  tam.value = '050';
}

function calcaElegida() {
  return buscarCalcaEnCatalogo(catalogoCalcas(), {
    tamano: document.getElementById('cal-tamano')?.value,
    tintas: document.getElementById('cal-tintas')?.value,
  });
}

function renderCalcas() {
  const seccion = document.getElementById('calcas-section');
  if (!seccion) return;
  poblarSelectoresCalca();

  const piezas = getPiezasProducto();
  const ficha = calcaElegida();
  const precio = ficha ? precioCalca(ficha, getCurrentTier().id) : null;

  const resuelto = document.getElementById('cal-resuelto');
  document.getElementById('cal-sku').textContent = ficha ? ficha.code : '—';
  // "en esta lista", no "en Menudeo": el hueco de precio tambien puede caer en
  // un tier pagado (a CAL1025S le faltaba la M350), y nombrar el tier
  // equivocado manda al vendedor a resolver lo que no es.
  document.getElementById('cal-precio').textContent = precio === null
    ? 'sin precio en esta lista'
    : `$${fmt(precio)} / pza`;
  resuelto.className = precio === null ? 'calca-resuelto sin-precio' : 'calca-resuelto';

  // Cantidad prellenada con el total de piezas de producto (decision 8: el caso
  // comun es que todas la lleven), editable. No se pisa mientras se teclea.
  const cantidadEl = document.getElementById('cal-cantidad');
  if (cantidadEl && document.activeElement !== cantidadEl) {
    cantidadEl.value = piezas > 0 ? piezas : '';
  }

  // Umbral duro de 100 piezas de producto (decision 1): abajo de eso no se
  // agrega, y el aviso dice el umbral y lo que lleva. Tampoco se agrega una
  // calca sin precio en la lista vigente: seria meter al carrito una partida
  // que bloquea la generacion en el acto.
  const avisoEl = document.getElementById('cal-aviso');
  const impedimento = !puedeAgregarCalca(piezas)
    ? avisoNoPuedeAgregarCalca(piezas)
    : (ficha && precio === null ? avisoCalcaInvalida(MOTIVOS_CALCA_INVALIDA.SIN_PRECIO) : '');
  avisoEl.innerHTML = impedimento ? `<div class="alert alert-error">${impedimento}</div>` : '';
  document.getElementById('btn-agregar-calca').disabled = !!impedimento || !ficha;

  // El umbral es un invariante, no una validacion de captura (decision 2): si el
  // carrito cae bajo 100 piezas con calcas dentro, se marca y se bloquea la
  // generacion. No se revierte el cambio del vendedor ni se le quitan las calcas.
  const motivo = motivoCalcaInvalidaActual();
  for (const id of ['calca-invalido-productos', 'resumen-calca-invalido']) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.style.display = motivo ? 'block' : 'none';
    el.textContent = motivo ? avisoCalcaInvalida(motivo, piezas) : '';
  }
}

// Motivo por el que el carrito con calca no puede generar, o null si puede.
// `calcaSinPrecio` mira el precio REAL resuelto de cada calca: el umbral evita
// caer en Menudeo, pero una calca sin fila en un tier pagado tambien la dejaria
// sin precio, y ahi el `?? 0` de getPrice la imprimiria en $0.
function motivoCalcaInvalidaActual() {
  const items = itemsDelCarrito();
  const calcaSinPrecio = [...state.cart.values()]
    .some(({ product }) => product.esCalca && precioUnitario(product) === null);
  return motivoCalcaInvalida({
    piezasProducto: piezasDeProducto(items),
    hayCalca: hayCalcaEnCarrito(items),
    calcaSinPrecio,
  });
}

function agregarCalca() {
  const piezas = getPiezasProducto();
  const ficha = calcaElegida();
  if (!ficha || !puedeAgregarCalca(piezas)) return;
  if (precioCalca(ficha, getCurrentTier().id) === null) return;

  const cantidad = parseInt(document.getElementById('cal-cantidad')?.value) || 0;
  if (cantidad <= 0) return;

  const prev = state.cart.get(ficha.code);
  state.cart.set(ficha.code, conservarCaptura(ficha.code, {
    product: prev?.product || productoCalca(ficha),
    cantidad: (prev?.cantidad || 0) + cantidad,
  }));

  updateTierBar();
  updateCartSummary();
  updateResumen();
  updateShippingSummary();
  renderCartLines();
}

// === CART LINES (tabla en tab productos) ===
function renderCartLines() {
  const section = document.getElementById('cart-lines-section');
  const container = document.getElementById('cart-lines');
  const subtotalEl = document.getElementById('cart-lines-subtotal');
  if (!section || !container) return;

  if (state.cart.size === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';
  renderDescuentoGlobal();
  let subtotal = 0;
  let html = '';

  const piezasProducto = getPiezasProducto();
  for (const [key, { product, cantidad, descuento, descripcion }] of state.cart) {
    const precio = precioUnitario(product);
    const price = precio ?? 0;
    const desc = descuento || 0;
    const total = importeLinea({ cantidad, precio: price, descuento: desc });
    subtotal += total;
    // Lo que se muestra es lo que va a leer el cliente (#139): con descripcion
    // editada, la del vendedor; si no, la del catalogo.
    const nombreCatalogo = nombreVisibleProducto(product.name);
    const name = descripcion || nombreCatalogo;
    // La linea de calca dice sobre cuantas piezas se aplica, sin juzgarlo
    // (decision 8): el pedido mixto y la doble calca por pieza son legitimos.
    const relacion = product.esCalca
      ? `<span class="calca-relacion">${relacionCalcaProducto(cantidad, piezasProducto)}</span>`
      : '';
    html += `
      <div class="cart-line${precio === null ? ' cart-line-sin-precio' : ''}" data-key="${key}">
        <span class="cart-line-sku">${key}</span>
        <span class="cart-line-name" title="${escapeHtml(name)}">${escapeHtml(name)} ${relacion}
          <button class="qty-icon-btn${descripcion ? ' cart-line-desc-editada' : ''}" onclick="cartLineToggleDescripcion('${key}')" title="Editar la descripcion que ve el cliente">&#9998;</button>
        </span>
        <div class="cart-line-qty-wrap col-num">
          <span class="qty-display">${cantidad}</span>
          <button class="qty-icon-btn" onclick="cartLineStartEdit('${key}')" title="Editar">&#9998;</button>
          <input class="qty-input" type="number" min="1" value="${cantidad}" style="display:none" inputmode="numeric"
            onkeydown="if(event.key==='Enter')cartLineConfirmEdit('${key}')">
          <button class="qty-icon-btn qty-ok-btn" style="display:none" onclick="cartLineConfirmEdit('${key}')" title="Confirmar">&#10003;</button>
        </div>
        <span class="cart-line-price col-num">${precio === null ? 'sin precio' : '$' + fmt(price)}</span>
        <span class="cart-line-desc col-num">${celdaDescuentoLinea(key, desc)}</span>
        <span class="cart-line-total col-num">${precio === null ? '&mdash;' : '$' + fmt(total)}</span>
        <div class="cart-line-del col-del"><button onclick="removeItem('${key}')" title="Quitar">&times;</button></div>
        ${editorDescripcionLinea(key, descripcion, nombreCatalogo)}
      </div>
    `;
  }

  container.innerHTML = html;
  const iva = subtotal * 0.16;
  subtotalEl.innerHTML = `Subtotal: <strong>$${fmt(subtotal)}</strong> &nbsp;+&nbsp; IVA $${fmt(iva)} &nbsp;= &nbsp;<strong>$${fmt(subtotal + iva)}</strong>`;
}

// Todo lo que el atajo global toca (#138): las lineas del carrito MAS la partida
// de envio, y solo si existe -- misma regla que decide si el documento la lleva
// (buildItemEnvio), para que el campo global no cuente una partida fantasma.
function partidasDelCarrito() {
  const partidas = [...state.cart.values()].map(({ descuento }) => ({ descuento }));
  const itemEnvio = buildItemEnvio(envioCapturadoEnFormulario());
  if (itemEnvio) partidas.push(itemEnvio);
  return partidas;
}

// Campo "aplicar % a todo" (#138, ADR-0011). No guarda nada: muestra el % comun
// a todas las partidas y se queda en blanco en cuanto una se afina aparte, por
// que el descuento global no existe como entidad -- solo hay % por linea.
function renderDescuentoGlobal() {
  const el = document.getElementById('cart-desc-global');
  if (!el) return;
  if (!puedeDescontar(state.topeDescuento)) {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }
  el.style.display = 'flex';
  const vigente = descuentoGlobalVigente(partidasDelCarrito());
  el.innerHTML = `
    <label for="desc-global">Aplicar % de descuento a todo</label>
    <input id="desc-global" class="desc-input" type="number" min="0" max="${state.topeDescuento}" step="1"
      value="${vigente || ''}" placeholder="0" inputmode="numeric"
      onchange="aplicarDescuentoATodo(this.value)">
  `;
}

// El atajo: un % una sola vez y todas las partidas quedan con el, envio incluido,
// sobreescribiendo lo capturado antes. Despues se afina linea por linea. Pasa por
// el MISMO freno que la captura de una linea (validarDescuentoLinea) -- no hay
// regla nueva que el servidor tenga que aprender.
function aplicarDescuentoATodo(valor) {
  const r = validarDescuentoLinea(valor, state.topeDescuento);
  if (!r.ok) {
    alert(r.mensaje);
    renderCartLines();
    return;
  }
  for (const item of state.cart.values()) item.descuento = r.valor;
  envioDescuento = r.valor;
  // Mismo motivo que en la captura por linea: cambio el valor declarado a la
  // paqueteria para el seguro, asi que la tarifa vigente de envia.com ya no vale.
  invalidarEnvioSiAplica();
  updateCartSummary();
  updateResumen();
  renderCartLines();
}
window.aplicarDescuentoATodo = aplicarDescuentoATodo;

// Lo que el vendedor NEGOCIO sobre una partida -- su % de descuento (#137) y su
// descripcion (#139) -- sobrevive a cambiar la cantidad o a volver a agregar el mismo
// SKU. Los cinco caminos que reescriben la entrada del carrito la construian desde
// cero y borraban la captura en silencio: subir la cantidad con el +/- despues de
// negociar dejaba el documento sin el descuento acordado.
function conservarCaptura(key, entrada) {
  const prev = state.cart.get(key);
  if (!prev) return entrada;
  const capturado = {};
  if (prev.descuento) capturado.descuento = prev.descuento;
  if (prev.descripcion) capturado.descripcion = prev.descripcion;
  return { ...entrada, ...capturado };
}

// Lineas con el editor de descripcion abierto (#139). El estado vive fuera del
// render porque renderCartLines vuelve a pintar la tabla entera en cada cambio y
// cerrarle el editor al vendedor mientras escribe seria hostil.
const descripcionesAbiertas = new Set();

// Editor de la descripcion que ve el cliente (#139), en una fila propia bajo la
// partida: el texto puede ser largo (hasta el limite de Operam) y no cabe en la
// celda del nombre. Precargado con la del catalogo, que es lo que se manda si el
// vendedor no escribe nada.
function editorDescripcionLinea(key, descripcion, nombreCatalogo) {
  if (!descripcionesAbiertas.has(key)) return '';
  return `
    <div class="cart-line-descripcion">
      <textarea maxlength="${MAX_DESCRIPCION}" rows="2" placeholder="${escapeHtml(nombreCatalogo)}"
        onchange="cartLineSetDescripcion('${key}', this.value)">${escapeHtml(descripcion || nombreCatalogo)}</textarea>
      <div class="cart-line-descripcion-hint">Este texto es el que sale en la cotizacion del cliente y en Operam. Vacialo para volver a la descripcion del catalogo.</div>
    </div>
  `;
}

function cartLineToggleDescripcion(key) {
  if (descripcionesAbiertas.has(key)) descripcionesAbiertas.delete(key);
  else descripcionesAbiertas.add(key);
  renderCartLines();
  document.querySelector(`.cart-line[data-key="${key}"] .cart-line-descripcion textarea`)?.focus();
}
window.cartLineToggleDescripcion = cartLineToggleDescripcion;

// La descripcion se guarda SOLO cuando difiere de la del catalogo: esa marca es la
// que decide si al actualizar el quote de Operam hay que reescribir la linea, y
// marcar de mas costaria dos POSTs por partida contra la web legacy sin motivo.
function cartLineSetDescripcion(key, valor) {
  const item = state.cart.get(key);
  if (!item) return;
  const r = validarDescripcionLinea(valor, nombreVisibleProducto(item.product.name));
  if (!r.ok) {
    alert(r.mensaje);
    renderCartLines();
    return;
  }
  if (r.editada) item.descripcion = r.descripcion;
  else delete item.descripcion;
  renderCartLines();
}
window.cartLineSetDescripcion = cartLineSetDescripcion;

// Celda de % de descuento de una linea (#137). Sin tope asignado no hay captura:
// se muestra en solo lectura, porque una cotizacion cargada del historial puede
// traer descuentos que el vendedor ya no tiene permiso de mover.
function celdaDescuentoLinea(key, descuento) {
  if (!puedeDescontar(state.topeDescuento)) return descuento ? `${descuento}%` : '&mdash;';
  return `<input class="desc-input" type="number" min="0" max="${state.topeDescuento}" step="1"
    value="${descuento || ''}" placeholder="0" inputmode="numeric"
    onchange="cartLineSetDescuento('${key}', this.value)">`;
}

// La captura frena en el tope y lo dice (#137): al rechazar se vuelve a pintar la
// tabla, de modo que el input regresa al valor vigente en vez de quedar mintiendo.
function cartLineSetDescuento(key, valor) {
  const item = state.cart.get(key);
  if (!item) return;
  const r = validarDescuentoLinea(valor, state.topeDescuento);
  if (!r.ok) {
    alert(r.mensaje);
    renderCartLines();
    return;
  }
  item.descuento = r.valor;
  // El descuento mueve el valor que se declara a la paqueteria para el seguro
  // (#137 AC7), asi que invalida la tarifa vigente de envia.com por el mismo
  // motivo que un cambio de cantidad (#89): se cotizo con otro valor. El
  // descuento del FLETE no invalida nada -- borraria la partida que se edita.
  invalidarEnvioSiAplica();
  updateCartSummary();
  updateResumen();
  renderCartLines();
}
window.cartLineSetDescuento = cartLineSetDescuento;

function cartLineChangeQty(key, delta) {
  const item = state.cart.get(key);
  if (!item) return;
  const newQty = Math.max(1, item.cantidad + delta);
  item.cantidad = newQty;
  updateTierBar();
  updateCartSummary();
  updateResumen();
  updateShippingSummary();
  renderCartLines();
}

function cartLineSetQty(key, qty) {
  const item = state.cart.get(key);
  if (!item) return;
  if (qty <= 0) {
    state.cart.delete(key);
  } else {
    item.cantidad = qty;
  }
  updateTierBar();
  updateCartSummary();
  updateResumen();
  updateShippingSummary();
  renderCartLines();
}

function cartLineStartEdit(key) {
  const line = document.querySelector(`.cart-line[data-key="${key}"]`);
  if (!line) return;
  const wrap = line.querySelector('.cart-line-qty-wrap');
  wrap.querySelector('.qty-display').style.display = 'none';
  wrap.querySelector('.qty-icon-btn').style.display = 'none';
  const input = wrap.querySelector('.qty-input');
  input.style.display = 'inline-block';
  input.focus();
  input.select();
  wrap.querySelector('.qty-ok-btn').style.display = 'inline-block';
}

function cartLineConfirmEdit(key) {
  const line = document.querySelector(`.cart-line[data-key="${key}"]`);
  if (!line) return;
  const val = parseInt(line.querySelector('.qty-input').value) || 1;
  cartLineSetQty(key, val);
}

window.cartLineChangeQty = cartLineChangeQty;
window.cartLineSetQty = cartLineSetQty;
window.cartLineStartEdit = cartLineStartEdit;
window.cartLineConfirmEdit = cartLineConfirmEdit;

// Cambiar cantidad para price keys (búsqueda sin filtro)
function changeQty(key, delta) {
  const product = state.precios.products.find(p => p.key === key) || state.cart.get(key)?.product;
  if (!product) return;
  const current = state.cart.has(key) ? state.cart.get(key).cantidad : 0;
  setQty(key, current + delta, product);
}

function setQty(key, qty, productOverride = null) {
  const product = productOverride || state.precios.products.find(p => p.key === key) || state.cart.get(key)?.product;
  if (!product) return;

  if (qty <= 0) {
    state.cart.delete(key);
  } else {
    state.cart.set(key, conservarCaptura(key, { product, cantidad: qty }));
  }

  updateTierBar();
  updateCartSummary();
  renderProducts(document.getElementById('search-input').value);
  updateResumen();
  updateShippingSummary();
  // La tabla de articulos cotizados no se repintaba por este camino y quedaba
  // con precios del tier anterior. Con calca en el carrito la mentira es peor:
  // seguia mostrando el precio de mayoreo de una calca que ya cayo a Menudeo,
  // donde no tiene precio (#91).
  renderCartLines();
}

// Cambiar cantidad para SKUs completos (búsqueda con filtro)
function changeQtySku(skuKey, delta) {
  const sku = state.precios.skus.find(s => s.sku === skuKey);
  if (!sku) return;
  const product = state.precios.products.find(p => p.key === sku.priceKey);
  if (!product) return;
  const current = state.cart.has(skuKey) ? state.cart.get(skuKey).cantidad : 0;
  setQtySku(skuKey, current + delta, sku, product);
}

function setQtySku(skuKey, qty, skuData = null, productData = null) {
  const sku = skuData || state.precios.skus.find(s => s.sku === skuKey);
  const existing = state.cart.get(skuKey);

  if (qty <= 0) {
    state.cart.delete(skuKey);
  } else {
    const product = productData || (sku ? state.precios.products.find(p => p.key === sku.priceKey) : null) || existing?.product;
    if (!product) return;
    const skuProduct = existing?.product || {
      key: skuKey,
      name: sku?.nombre || skuKey,
      model: sku ? (sku.tipo + sku.tamano) : skuKey,
      weight_kg: product.weight_kg,
      prices: product.prices,
    };
    state.cart.set(skuKey, conservarCaptura(skuKey, { product: skuProduct, cantidad: qty }));
  }

  updateTierBar();
  updateCartSummary();
  renderProducts(document.getElementById('search-input').value);
  updateResumen();
  updateShippingSummary();
  renderCartLines();
}

window.changeQty = changeQty;
window.setQty = setQty;
window.changeQtySku = changeQtySku;
window.setQtySku = setQtySku;
window.removeItem = (key) => {
  state.cart.delete(key);
  // Quitar la partida cierra su editor de descripcion (#139): si no, volver a
  // agregar ese SKU lo mostraria abierto sin que nadie lo pidiera.
  descripcionesAbiertas.delete(key);
  updateTierBar();
  updateCartSummary();
  renderProducts(document.getElementById('search-input').value);
  updateResumen();
  updateShippingSummary();
  renderCartLines();
};

// === CART SUMMARY BAR ===
function updateCartSummary() {
  const bar = document.getElementById('cart-summary');
  const totalPzs = getPiezasProducto();
  const items = state.cart.size;

  if (items === 0) {
    bar.style.display = 'none';
    return;
  }

  bar.style.display = 'flex';
  const subtotal = calcSubtotal();
  // Las calcas se cuentan aparte: sus piezas no son piezas de producto (#91) y
  // sumarlas al conteo diria "1200 pzs" de un pedido de 600 tazas decoradas.
  const calcas = [...state.cart.keys()].filter(esCodigoCalca).length;
  const productos = items - calcas;
  const detalleCalcas = calcas > 0 ? ` + ${calcas} calca${calcas !== 1 ? 's' : ''}` : '';
  document.getElementById('cart-total').textContent = `$${fmt(subtotal)}`;
  document.getElementById('cart-count').textContent = `${productos} producto${productos !== 1 ? 's' : ''}, ${totalPzs} pzs${detalleCalcas}`;
}

// Subtotal de los articulos con su descuento por linea (#137): lo consumen la
// barra resumen, el resumen final y el valor declarado a la paqueteria, asi que
// todas las superficies dicen el mismo numero que el documento.
function calcSubtotal() {
  let subtotal = 0;
  for (const { product, cantidad, descuento } of state.cart.values()) {
    subtotal += importeLinea({ cantidad, precio: getPrice(product), descuento });
  }
  return subtotal;
}

// === SHIPPING ===
function updateShippingSummary() {
  const totalPzs = getPiezasProducto();
  let totalWeight = 0;
  for (const { product, cantidad } of state.cart.values()) {
    if (product.weight_kg) totalWeight += product.weight_kg * cantidad;
  }

  const el = document.getElementById('shipping-summary');
  if (totalPzs === 0) {
    el.textContent = 'Agrega productos para ver el resumen de envio.';
    el.className = 'alert alert-info';
    return;
  }

  el.innerHTML = `<strong>${totalPzs} piezas</strong> — Peso estimado: <strong>${totalWeight.toFixed(1)} kg</strong>`;
  el.className = 'alert alert-info';

  updateTabIndicators();
}

// === ENVIA.COM ===
let enviaRateSeleccionado = null; // { carrier, servicio, desc, cost }
let envioInvalidadoPorCantidad = false; // issue #89: cambio de cantidad invalido la tarifa vigente
let envioDescuento = 0; // issue #137: % de descuento de la partida de flete

// Captura del descuento del flete desde el resumen (#137). Mismo freno que las
// lineas del carrito: si rebasa el tope se avisa y se repinta con lo vigente.
function setEnvioDescuento(valor) {
  const r = validarDescuentoLinea(valor, state.topeDescuento);
  if (!r.ok) {
    alert(r.mensaje);
    updateResumen();
    return;
  }
  envioDescuento = r.valor;
  updateResumen();
  // Repinta el carrito porque el envio es una partida mas para el campo "% a
  // todo" (#138): bonificar solo el flete tiene que dejarlo en blanco.
  renderCartLines();
}
window.setEnvioDescuento = setEnvioDescuento;

async function cotizarEnvia() {
  const btn = document.getElementById('btn-cotizar-envia');
  const errEl = document.getElementById('envia-error');
  const resultsEl = document.getElementById('envia-results');
  const resumenEl = document.getElementById('envia-resumen');

  errEl.style.display = 'none';
  resultsEl.innerHTML = '';
  resumenEl.style.display = 'none';
  enviaRateSeleccionado = null;
  envioInvalidadoPorCantidad = false;

  // CP + pais UNICOS (#84 AC3): el mismo bloque de domicilio de entrega, ya no
  // hay un envia-cp/envia-pais aparte.
  const cp = document.getElementById('cl-cp-entrega')?.value?.trim();
  const pais = document.getElementById('cl-pais')?.value || 'MX';
  if (!cp || !cpValido(cp, pais)) {
    errEl.textContent = pais === 'CA' ? 'Ingresa un codigo postal canadiense valido (ej. K1A 0A9)' : 'Ingresa un CP de 5 digitos valido';
    errEl.style.display = 'block';
    return;
  }

  if (state.cart.size === 0) {
    errEl.textContent = 'Agrega productos al carrito primero';
    errEl.style.display = 'block';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Cotizando...';
  resultsEl.innerHTML = '<div style="color:var(--text-light);font-size:12px;padding:8px 0">Consultando tarifas...</div>';

  const items = [];
  for (const [key, { cantidad }] of state.cart) {
    items.push({ codigo: key, cantidad });
  }

  // Total con IVA para calcular seguro (25%). Con descuento se declara el valor
  // CON descuento (#137): es lo que el cliente paga y lo que dira la factura si
  // hay que reclamarle a la paqueteria. calcSubtotal ya viene descontado.
  const subtotal = calcSubtotal();
  const shippingCost = importeLinea({
    cantidad: 1,
    precio: parseFloat(document.getElementById('shipping-cost')?.value || 0) || 0,
    descuento: envioDescuento,
  });
  const totalConIVA = (subtotal + shippingCost) * 1.16;

  try {
    const res = await api('/api/cotizacion/envio', {
      method: 'POST',
      body: { cpDestino: cp, paisDestino: pais, items, totalConIVA },
    });
    const data = await res.json();

    if (!res.ok) {
      errEl.textContent = data.error || 'Error al cotizar';
      errEl.style.display = 'block';
      resultsEl.innerHTML = '';
      return;
    }

    const { rates, resumen, warnings } = data;

    // Mostrar resumen de cajas
    if (resumen?.length) {
      resumenEl.textContent = resumen.map(r =>
        `${r.total_cajas} caja${r.total_cajas !== 1 ? 's' : ''} ${r.caja} — ${r.total_peso_kg} kg`
      ).join(' · ');
      resumenEl.style.display = 'block';
    }

    if (warnings?.length) {
      const w = document.createElement('div');
      w.className = 'alert alert-warning';
      w.style.fontSize = '12px';
      w.style.marginBottom = '8px';
      w.textContent = 'Advertencias: ' + warnings.join('; ');
      resultsEl.appendChild(w);
    }

    if (!rates?.length) {
      resultsEl.innerHTML += '<div class="alert alert-warning">No se encontraron tarifas para ese CP.</div>';
      return;
    }

    // Ordenar por preferencia de carrier: FedEx > Estafeta > DHL > otros (por precio)
    const CARRIER_PREF = { fedex: 0, estafeta: 1, dhl: 2 };
    const getCarrierPref = (carrier) => {
      const c = (carrier || '').toLowerCase();
      if (c.includes('fedex')) return CARRIER_PREF.fedex;
      if (c.includes('estafeta')) return CARRIER_PREF.estafeta;
      if (c.includes('dhl')) return CARRIER_PREF.dhl;
      return 10;
    };
    const sorted = [...rates].sort((a, b) => {
      const pa = getCarrierPref(a.carrier), pb = getCarrierPref(b.carrier);
      if (pa !== pb) return pa - pb;
      return (a.totalPrice ?? a.rate ?? 0) - (b.totalPrice ?? b.rate ?? 0);
    });

    sorted.forEach((rate, idx) => {
      const precio = rate.totalPrice ?? rate.rate ?? 0;
      const carrier = rate.carrier ?? '';
      const servicio = rate.service ?? rate.serviceType ?? '';
      const dias = formatTiempoEntrega(rate);
      const esRecomendado = idx === 0;

      const card = document.createElement('div');
      card.className = 'envia-rate-card';
      card.innerHTML = `
        <div class="envia-rate-info">
          <div class="envia-rate-carrier">${formatCarrier(carrier)}${esRecomendado ? ' <span class="badge-rec">Recomendado</span>' : ''}</div>
          <div class="envia-rate-servicio">${formatServicio(servicio)}${dias ? ' · ' + dias : ''}</div>
        </div>
        <div class="envia-rate-precio">$${fmt(precio)}</div>
      `;
      card.addEventListener('click', () => seleccionarEnviaRate(card, rate, carrier, servicio, precio));
      resultsEl.appendChild(card);

      // Auto-seleccionar el primero (recomendado)
      if (esRecomendado) seleccionarEnviaRate(card, rate, carrier, servicio, precio);
    });

  } catch (e) {
    errEl.textContent = 'Error: ' + e.message;
    errEl.style.display = 'block';
    resultsEl.innerHTML = '';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Cotizar';
  }
}

function seleccionarEnviaRate(card, rate, carrier, servicio, precio) {
  document.querySelectorAll('.envia-rate-card').forEach(c => c.classList.remove('selected'));
  card.classList.add('selected');
  enviaRateSeleccionado = {
    carrier, servicio,
    desc: formatDescripcionEnvioEnvia(rate),
    cost: precio,
  };
  envioInvalidadoPorCantidad = false;
  // Sincronizar con los campos manuales para que updateResumen los tome
  document.getElementById('shipping-desc').value = enviaRateSeleccionado.desc;
  document.getElementById('shipping-cost').value = precio.toFixed(2);
  updateResumen();
  updateTabIndicators();
}

window.cotizarEnvia = cotizarEnvia;

// === MARCA DE PRODUCTO DECORADO (issue #91, ADR-0010) ===
// La calca del carrito enciende la marca y la FIJA: dejarla editable con calca
// dentro permitiria esquivar el gate de #61 (las 6 autorizaciones del proveedor)
// justo en el caso donde mas importa. Sin calca la marca sigue siendo del
// vendedor -- el decorado a mano y las texturas decoradas son decorado real y no
// producen partida. La calca es piso, no techo.
let decoradoManual = false;

function sincronizarMarcaDecorado() {
  const chk = document.getElementById('resumen-decorado');
  if (!chk) return;

  const hayCalca = hayCalcaEnCarrito(itemsDelCarrito());
  // Con calca la marca se asienta tambien en el estado propio: asi, al quitarla,
  // CONSERVA su valor y solo vuelve a ser editable (decision 5). Apagarla es un
  // acto explicito del vendedor, no un derivado del carrito.
  if (hayCalca) decoradoManual = true;

  const estado = estadoMarcaDecorado({ hayCalca, marcaActual: decoradoManual });
  if (chk.checked !== estado.valor) {
    chk.checked = estado.valor;
    const notasEl = document.getElementById('resumen-notas');
    if (notasEl) notasEl.value = aplicarNotaTiempoEntrega(notasEl.value, estado.valor);
  }
  chk.disabled = !estado.editable;

  const motivo = document.getElementById('resumen-decorado-motivo');
  if (motivo) motivo.textContent = estado.motivo;
}

// La marca viaja con el guardado para que la oportunidad nazca ya sujeta al gate
// de #61. Se manda SOLO en true: el data del registro se mergea a nivel raiz, asi
// que un false pisaria una marca puesta desde la tarjeta del tablero -- que es
// donde se apaga, con el aviso de que deja de exigir las 6 autorizaciones.
function marcaDecoradoParaGuardar() {
  const hayCalca = hayCalcaEnCarrito(itemsDelCarrito());
  return estadoMarcaDecorado({ hayCalca, marcaActual: decoradoManual }).valor ? true : undefined;
}

// === RESUMEN ===
function updateResumen() {
  const empty = document.getElementById('resumen-empty');
  const content = document.getElementById('resumen-content');
  const shippingAlert = document.getElementById('resumen-shipping-alert');

  // Vendedor logueado, visible en el resumen (issue #87): hoy vivia solo en
  // la barra superior (user-name) y era facil de ignorar.
  const vendedorEl = document.getElementById('resumen-vendedor');
  if (vendedorEl) vendedorEl.textContent = state.user ? `Cotización a nombre de: ${state.user.name}` : '';

  sincronizarMarcaDecorado();

  if (state.cart.size === 0) {
    empty.style.display = 'block';
    content.style.display = 'none';
    shippingAlert.style.display = 'none';
    return;
  }

  empty.style.display = 'none';
  content.style.display = 'block';

  // Alerta de envío
  const shippingOpt = document.getElementById('shipping-option').value;
  shippingAlert.style.display = shippingOpt === 'none' ? 'block' : 'none';

  // Aviso de envio invalidado por cambio de cantidades (issue #89)
  const envioInvalidadoAlert = document.getElementById('resumen-envio-invalidado');
  if (envioInvalidadoAlert) {
    envioInvalidadoAlert.style.display = envioInvalidadoPorCantidad ? 'block' : 'none';
    envioInvalidadoAlert.textContent = MENSAJE_ENVIO_INVALIDADO;
  }

  const itemsEl = document.getElementById('resumen-items');

  const piezasProducto = getPiezasProducto();
  let html = '';
  for (const [key, { product, cantidad, descuento, descripcion }] of state.cart) {
    const precio = precioUnitario(product);
    const price = precio ?? 0;
    const total = importeLinea({ cantidad, precio: price, descuento });
    // El resumen es la ultima pantalla antes de generar: muestra la descripcion
    // editada (#139), que es la que va a leer el cliente en el documento.
    const displayName = descripcion || nombreVisibleProducto(product.name);
    const isSkuItem = state.precios.skus?.some(s => s.sku === key);
    // El % negociado se dice junto al precio de lista: el resumen es la ultima
    // pantalla antes de generar y tiene que cuadrar con el documento (#137).
    const detalle = precio === null
      ? `${key} — sin precio`
      : `${key} — $${fmt(price)} / pza${descuento ? ` — ${descuento}% dscto.` : ''}`;
    const relacion = product.esCalca
      ? ` <span class="calca-relacion">${relacionCalcaProducto(cantidad, piezasProducto)}</span>`
      : '';

    html += `
      <div class="cart-item">
        <div class="cart-item-info">
          <div class="cart-item-name">${displayName}</div>
          <div class="cart-item-detail">${detalle}${relacion}</div>
          <div class="cart-item-qty">
            <button class="qty-btn" onclick="resumenChangeQty('${key}', -1)">-</button>
            <input class="qty-input" type="number" min="1" value="${cantidad}"
              onchange="resumenSetQty('${key}', parseInt(this.value)||1)"
              inputmode="numeric">
            <button class="qty-btn" onclick="resumenChangeQty('${key}', 1)">+</button>
            ${isSkuItem ? `<button class="btn btn-secondary btn-sm" style="margin-left:4px" onclick="editarItemGuiado('${key}')">Editar</button>` : ''}
          </div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
          <div class="cart-item-total">$${fmt(total)}</div>
          <button class="remove-btn" onclick="removeItem('${key}')" title="Quitar">&times;</button>
        </div>
      </div>
    `;
  }
  itemsEl.innerHTML = html;

  // Envío en resumen
  const shippingSection = document.getElementById('resumen-shipping');
  let shippingCost = 0;

  if (shippingOpt === 'manual' || shippingOpt === 'envia') {
    shippingCost = parseFloat(document.getElementById('shipping-cost').value) || 0;
    const shippingDesc = document.getElementById('shipping-desc').value || 'Envio';
    if (shippingCost > 0) {
      shippingSection.style.display = 'block';
      // El flete tambien se puede bonificar (#137): la captura vive aqui porque
      // es la unica superficie donde la partida de envio se ve en los dos modos
      // (el costo de envia.com se guarda en un campo oculto del tab Envio).
      const shippingNeto = importeLinea({ cantidad: 1, precio: shippingCost, descuento: envioDescuento });
      document.getElementById('resumen-shipping-detail').innerHTML = `
        <div class="cart-item-info">
          <div class="cart-item-name">${shippingDesc}</div>
          <div class="cart-item-detail">$${fmt(shippingCost)}${envioDescuento ? ` — ${envioDescuento}% dscto.` : ''}</div>
          ${puedeDescontar(state.topeDescuento) ? `
          <div class="cart-item-qty">
            <label style="font-size:12px;color:var(--text-light)">% dscto.</label>
            <input class="qty-input" type="number" min="0" max="${state.topeDescuento}" step="1"
              value="${envioDescuento || ''}" placeholder="0" inputmode="numeric"
              onchange="setEnvioDescuento(this.value)">
          </div>` : ''}
        </div>
        <div class="cart-item-total">$${fmt(shippingNeto)}</div>
      `;
      shippingCost = shippingNeto;
    } else {
      shippingSection.style.display = 'none';
    }
  } else {
    shippingSection.style.display = 'none';
  }

  // Totales
  const subtotal = calcSubtotal() + shippingCost;
  const iva = subtotal * 0.16;
  const total = subtotal + iva;

  document.getElementById('resumen-subtotal').textContent = `$${fmt(subtotal)}`;
  document.getElementById('resumen-iva').textContent = `$${fmt(iva)}`;
  document.getElementById('resumen-total').textContent = `$${fmt(total)}`;
}

// Controles de cantidad en el resumen
// Cambiar cantidades invalida la tarifa de envia.com vigente (issue #89): no se
// recalcula sola (evitaria 3 llamadas a paqueteria por toque), se invalida y se
// avisa. El envio manual capturado a mano no se toca.
function invalidarEnvioSiAplica() {
  const shippingOpt = document.getElementById('shipping-option').value;
  if (debeInvalidarEnvioPorCantidad(shippingOpt, enviaRateSeleccionado)) {
    enviaRateSeleccionado = null;
    envioInvalidadoPorCantidad = true;
    document.getElementById('shipping-cost').value = '';
    document.getElementById('shipping-desc').value = 'Envio';
  }
}

function resumenChangeQty(key, delta) {
  const item = state.cart.get(key);
  if (!item) return;
  const newQty = Math.max(0, item.cantidad + delta);
  if (newQty === 0) {
    state.cart.delete(key);
  } else {
    item.cantidad = newQty;
  }
  invalidarEnvioSiAplica();
  updateTierBar();
  updateCartSummary();
  renderProducts(document.getElementById('search-input').value);
  updateResumen();
  updateShippingSummary();
  renderCartLines();
}

function resumenSetQty(key, qty) {
  const item = state.cart.get(key);
  if (!item) return;
  if (qty <= 0) {
    state.cart.delete(key);
  } else {
    item.cantidad = qty;
  }
  invalidarEnvioSiAplica();
  updateTierBar();
  updateCartSummary();
  renderProducts(document.getElementById('search-input').value);
  updateResumen();
  updateShippingSummary();
  renderCartLines();
}

window.resumenChangeQty = resumenChangeQty;
window.resumenSetQty = resumenSetQty;

// Editar un item SKU desde el resumen: carga el flujo guiado con sus atributos
function editarItemGuiado(skuKey) {
  const sku = state.precios.skus?.find(s => s.sku === skuKey);
  if (!sku) return;
  const item = state.cart.get(skuKey);
  const cantidadActual = item?.cantidad || 1;

  // Precargar el flujo guiado
  Object.assign(guiado, {
    tipo: sku.tipo,
    tamano: sku.tamano,
    color1: sku.color1,
    textura: sku.textura,
    color2: sku.color2 || null,
    filetes: sku.filetes,
    colorRiso: sku.colorRiso ? parseInt(sku.colorRiso) : null,
    cantidad: cantidadActual,
  });

  // Remover del carrito para re-agregarlo editado
  state.cart.delete(skuKey);
  updateTierBar();
  updateCartSummary();

  switchTab('productos');
  renderFlujoGuiado();
  updateResumen();
}

window.editarItemGuiado = editarItemGuiado;

// === CANAL DE COTIZACION (issue #46) ===
// Antes de generar, se pre-clasifica el celular: solo si es libre (ni
// prospecto ni cliente Operam) se pide el canal de origen para que el
// servidor auto-cree el prospecto en Cotizado. Cancelar genera la
// cotizacion sin crear prospecto. Best effort: si la clasificacion falla,
// se genera sin friccion.
function pedirCanalCotizacion() {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:1000';
    overlay.innerHTML = buildCanalModalHtml();
    document.body.appendChild(overlay);
    const cerrar = canal => { overlay.remove(); resolve(canal); };
    document.getElementById('canal-cot-confirmar').addEventListener('click', () => {
      const canal = document.getElementById('canal-cot-select').value;
      const error = validarCanalCotizacion(canal);
      if (error) {
        const errEl = document.getElementById('canal-cot-error');
        errEl.textContent = error;
        errEl.style.display = 'block';
        return;
      }
      cerrar(canal);
    });
    document.getElementById('canal-cot-cancelar').addEventListener('click', () => cerrar(null));
  });
}

// === CONFIRMACION DE VENDEDOR (issue #87) ===
// Antes de generar el PDF/HTML se confirma a nombre de que vendedor va la
// cotizacion, para no estampar al vendedor equivocado cuando el dispositivo
// quedo logueado con otro usuario (caso real: prestamo de dispositivo).
function pedirConfirmarVendedor() {
  // Una vez por cotizacion (#113): ya confirmado = no se vuelve a preguntar
  // mientras siga siendo la misma cotizacion.
  if (state.vendedorConfirmado) return Promise.resolve(true);
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:1000';
    overlay.innerHTML = buildConfirmarVendedorModalHtml(state.user?.name || '');
    document.body.appendChild(overlay);
    const cerrar = ok => { overlay.remove(); state.vendedorConfirmado = ok; resolve(ok); };
    document.getElementById('confirmar-vendedor-confirmar').addEventListener('click', () => cerrar(true));
    document.getElementById('confirmar-vendedor-cancelar').addEventListener('click', () => cerrar(false));
  });
}

async function canalParaCotizacion(telefono) {
  try {
    const res = await api(`/api/prospectos/clasificar?celular=${encodeURIComponent(telefono)}`);
    if (!res.ok) return null;
    const clasificacion = await res.json();
    if (!necesitaCanal(clasificacion)) return null;
    return await pedirCanalCotizacion();
  } catch (e) {
    return null;
  }
}

// Etiquetas de los botones de generacion segun el modo (#109). Un solo lugar:
// el bloque vivia repetido en cada punto que entra o sale del modo actualizacion,
// y olvidar uno reintroduce exactamente el bug que #109 arreglo. Lee
// state.modoActualizacion en vez de recibirlo, para que no pueda mentir.
function aplicarEtiquetasBotonesGenerar() {
  const btnPdf = document.getElementById('btn-pdf');
  if (btnPdf) btnPdf.textContent = textoBotonGenerar('pdf', state.modoActualizacion);
  const btnHtml = document.getElementById('btn-html');
  if (btnHtml) btnHtml.textContent = textoBotonGenerar('html', state.modoActualizacion);
}

// Cuanto se espera a Operam antes de entregar el documento sin numero (ADR-0009,
// "Operam no puede bloquear la entrega"). La subida esta en la RUTA CRITICA de la
// generacion: si tarda mas que esto, el vendedor se queda mirando un boton en vez
// de atender a su cliente, asi que el documento sale como pre-cotizacion y el
// bueno se re-comparte desde el historial cuando el folio llegue.
const TIMEOUT_OPERAM_MS = 20000;

// Promise.race con un vencimiento: si la promesa no resuelve en ms, resuelve con
// lo que devuelva alVencer(). El guard `listo` evita que el temporizador dispare
// su efecto (repintar el slot) DESPUES de que la subida ya haya respondido bien.
function conLimiteDeTiempo(promesa, ms, alVencer) {
  let listo = false;
  return Promise.race([
    promesa.then(v => { listo = true; return v; }),
    new Promise(resolve => setTimeout(() => { if (!listo) resolve(alVencer()); }, ms)),
  ]);
}

// Espera a que termine la operacion de Operam en vuelo para esta cotizacion (#116),
// acotada por el mismo TIMEOUT_OPERAM_MS de ADR-0009. Devuelve true si quedo libre.
// Se consulta el Set en vez de guardar promesas a proposito: `subidasOperamEnVuelo`
// sigue siendo la unica fuente del estado en vuelo (dos estructuras para lo mismo
// divergirian), y la espera real dura segundos, asi que 200ms de resolucion sobran.
async function esperarOperamEnVuelo(key, ms = TIMEOUT_OPERAM_MS) {
  const t0 = Date.now();
  while (subidasOperamEnVuelo.has(key) && Date.now() - t0 < ms) {
    await new Promise(r => setTimeout(r, 200));
  }
  return !subidasOperamEnVuelo.has(key);
}

// Guardar -> subir a Operam esperando el folio -> generar el documento (ADR-0009).
// Es la INVERSION del orden de #83: antes se generaba el documento y la subida
// ocurria despues, asi que cuando el PDF ya estaba descargado el folio -- que es
// el numero de la cotizacion -- todavia no existia. Ahora la generacion espera al
// folio, con progreso real en el boton, y degrada a pre-cotizacion en vez de
// bloquear: fallo, timeout o subida en vuelo entregan el documento igual, sin
// numero, con el estado y el Reintentar de siempre (#63/#83) pintados en el slot.
// Devuelve el id del registro (con el que los GET arman el documento) o null si
// el guardado fallo, unico caso en que no hay nada que entregar.
async function guardarYNumerarCotizacion(body, progreso) {
  // #116: si la generacion anterior dejo una operacion de Operam en vuelo para ESTA
  // cotizacion (la reescritura del quote de #114, que tarda segundos por la web
  // legacy), hay que esperarla ANTES de guardar. Si no, el servidor compara contra la
  // huella vieja -- la reescritura todavia no la persistio -- pide actualizar otra vez
  // y se choca con su propia guarda: el vendedor veia "ya hay una operacion en curso,
  // reintenta" en el flujo mas comun que existe (PDF para archivo, HTML para WhatsApp).
  // Esperando, la huella ya esta al dia y el servidor responde por si mismo que no hay
  // nada que actualizar. Acotado: si no termina, se sigue y el aviso queda como red de
  // seguridad -- nunca se deja al vendedor sin documento (ADR-0009).
  const enVuelo = state.lastCotizacionId ? String(state.lastCotizacionId) : null;
  if (enVuelo && subidasOperamEnVuelo.has(enVuelo)) {
    progreso('Esperando a Operam...');
    await esperarOperamEnVuelo(enVuelo);
  }
  progreso('Guardando...');
  const res = await api('/api/cotizacion', { method: 'POST', body });
  if (!res.ok) {
    let err = {};
    try { err = await res.json(); } catch {}
    alert('Error: ' + (err.error || 'No se pudo guardar la cotizacion'));
    return null;
  }
  const { id, requiereActualizacionOperam, folioOperam } = await res.json();
  state.lastCotizacionId = String(id);
  const slot = document.getElementById('operam-status-cotizar');
  // Modo actualizacion (#104, ADR-0008): aqui NO hay inversion que hacer. El folio
  // ya existe -- el gate puedeActualizarCotizacion lo exige -- asi que el documento
  // se genera directo con el y la reescritura del quote sigue su curso sin
  // bloquearlo; si falla, el registro queda marcado con Reintentar.
  // requiereActualizacionOperam (#114) entra por la MISMA puerta: regenerar en la
  // misma sesion una cotizacion que ya tiene folio, con el contenido cambiado, es la
  // misma operacion que "Actualizar cotizacion" -- solo que sin pasar por el
  // historial. Converge aqui a proposito: un camino paralelo tendria su propio gate,
  // su propio lock y su propia forma de fallar. Si el contenido NO cambio, el
  // servidor no lo pide y la subida idempotente responde el folio sin tocar Operam.
  //
  // #116: la señal del servidor manda TAMBIEN en modo actualizacion. Antes el modo
  // forzaba la reescritura, y con la espera de arriba eso reescribia el quote DOS veces
  // con el contenido identico (el PDF y luego el HTML del mismo carrito): la guarda de
  // "operacion en curso" lo frenaba por accidente, no por diseño. Si la huella dice que
  // el quote ya coincide, no hay nada que reescribir -- ni entrando por "Actualizar
  // cotizacion" desde el historial. Sin folio (o sin huella, cotizaciones previas a
  // #114) el servidor responde que si hace falta, asi que #104 sigue cubierto.
  if (state.modoActualizacion && !requiereActualizacionOperam) {
    // Acuse de que no habia nada que hacer. Sin esto el slot se quedaba con el aviso
    // PREVIO ("al actualizar... se actualizara en Operam"), asi que el vendedor generaba
    // y no veia si su cotizacion habia viajado o no. Se reusa la misma vista que el
    // camino de subida da para yaSubida -- folio + "el contenido no cambio" -- en vez de
    // inventar un mensaje nuevo para el mismo hecho.
    if (slot) slot.innerHTML = buildOperamStatusHtml(id, interpretarSubidaOperam({ ok: true, folio: folioOperam ?? null, yaSubida: true }));
    return id;
  }
  if (requiereActualizacionOperam) {
    actualizarQuoteEnOperam(id, slot);
    return id;
  }
  progreso('Subiendo a Operam...');
  await conLimiteDeTiempo(autoSubirOperam(id, slot), TIMEOUT_OPERAM_MS, () => {
    const vencida = interpretarSubidaOperam({ timeout: true });
    if (slot) slot.innerHTML = buildOperamStatusHtml(id, vencida);
    return vencida;
  });
  progreso('Generando documento...');
  return id;
}

// cartEntries + envio capturado en el DOM (#135): la unica parte del payload de
// items que generatePDF/generateHTML no pueden compartir via cotizar-logica.js
// (nucleo puro sin IO) porque lee state.cart y el formulario.
function cartEntriesDesdeEstado() {
  const cartEntries = [];
  for (const [key, { product, cantidad, descuento, descripcion }] of state.cart) {
    cartEntries.push({ codigo: key, nombre: product.name, cantidad, precio: getPrice(product), descuento: descuento || 0, descripcion });
  }
  return cartEntries;
}

function envioCapturadoEnFormulario() {
  const shippingOpt = document.getElementById('shipping-option').value;
  const shippingDesc = document.getElementById('shipping-desc').value;
  const shippingCost = (shippingOpt === 'manual' || shippingOpt === 'envia')
    ? (parseFloat(document.getElementById('shipping-cost').value) || 0)
    : 0;
  return { shippingOpt, shippingDesc, shippingCost, shippingDescuento: envioDescuento };
}

// === PDF GENERATION ===
async function generatePDF() {
  const telErr = validarTelefonosCotizacion();
  if (telErr) {
    alert(telErr);
    switchTab('cliente');
    document.getElementById('cl-telefono')?.focus();
    return;
  }
  const domio = validarDomicilioCotizacion();
  if (bloqueaGeneracionPorEnvioInvalidado(envioInvalidadoPorCantidad)) {
    alert(MENSAJE_ENVIO_INVALIDADO);
    switchTab('resumen');
    return;
  }
  const motivoCalca = motivoCalcaInvalidaActual();
  if (bloqueaGeneracionPorCalcaSinVolumen(motivoCalca !== null)) {
    alert(avisoCalcaInvalida(motivoCalca, getPiezasProducto()));
    switchTab('productos');
    return;
  }
  if (!(await pedirConfirmarVendedor())) return;
  const btn = document.getElementById('btn-pdf');
  btn.disabled = true;
  btn.textContent = 'Generando...';

  try {
    const tier = getCurrentTier();
    const cartEntries = cartEntriesDesdeEstado();
    const envioForm = envioCapturadoEnFormulario();
    const { items, subtotal, iva, total } = buildItemsYTotales(cartEntries, envioForm);

    const vigenciaDias = parseInt(document.getElementById('resumen-vigencia').value) || 30;
    const vigenciaDate = new Date();
    vigenciaDate.setDate(vigenciaDate.getDate() + vigenciaDias);

    const notasText = document.getElementById('resumen-notas').value;
    const notas = notasText.split('\n').map(l => l.replace(/^-\s*/, '').trim()).filter(Boolean);

    const body = {
      fecha: new Date().toISOString().split('T')[0],
      vigencia: vigenciaDate.toISOString().split('T')[0],
      tier: tier.id,
      cliente: leerClienteFormulario(domio.leyenda),
      condicionesPago: document.getElementById('cl-condiciones').value,
      items,
      subtotal,
      iva,
      total,
      notas,
      // Envio estructurado {carrier, servicio, precio} (#102): prefactor para
      // restaurarlo tal cual al Cargar desde historial, sin re-cotizar envia.com.
      envio: buildEnvioEstructurado({ ...envioForm, enviaRateSeleccionado }),
      // Marca de producto decorado (ADR-0010): la calca del carrito la fija.
      decorado: marcaDecoradoParaGuardar(),
    };

    body.incluirFotos = document.getElementById('incluir-fotos')?.checked || false;

    const canal = await canalParaCotizacion(body.cliente.telefono);
    if (canal) body.canal = canal;

    // Regeneracion en la misma sesion de cotizacion (#83, F1): PDF + HTML del
    // mismo carrito son UNA cotizacion. El id de la primera generacion se reenvia
    // y el server actualiza el entry en vez de crear otro.
    if (state.lastCotizacionId) body.cotizacionId = state.lastCotizacionId;

    const cotizacionId = await guardarYNumerarCotizacion(body, texto => { btn.textContent = texto; });
    if (!cotizacionId) return;

    // El documento lo genera SIEMPRE el GET (unico generador desde ADR-0009): el
    // servidor decide el numero -- el folio de Operam -- y el nombre del archivo
    // (?descargar=1 = attachment). Sin `download` a proposito: el nombre lo pone
    // el Content-Disposition, para no volver a tenerlo definido en dos lugares.
    const a = document.createElement('a');
    a.href = `/api/cotizacion/pdf/${cotizacionId}?descargar=1`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (e) {
    alert('Error generando PDF: ' + e.message);
  } finally {
    btn.disabled = false;
    // #109: el texto idle depende del modo -- sin esto el boton volvia a decir
    // "Generar PDF" tras la primera actualizacion aunque se siguiera en modo
    // actualizacion.
    aplicarEtiquetasBotonesGenerar();
  }
}

async function generateHTML() {
  const telErr = validarTelefonosCotizacion();
  if (telErr) {
    alert(telErr);
    switchTab('cliente');
    document.getElementById('cl-telefono')?.focus();
    return;
  }
  const domio = validarDomicilioCotizacion();
  if (bloqueaGeneracionPorEnvioInvalidado(envioInvalidadoPorCantidad)) {
    alert(MENSAJE_ENVIO_INVALIDADO);
    switchTab('resumen');
    return;
  }
  const motivoCalca = motivoCalcaInvalidaActual();
  if (bloqueaGeneracionPorCalcaSinVolumen(motivoCalca !== null)) {
    alert(avisoCalcaInvalida(motivoCalca, getPiezasProducto()));
    switchTab('productos');
    return;
  }
  if (!(await pedirConfirmarVendedor())) return;
  const btn = document.getElementById('btn-html');
  btn.disabled = true;
  btn.textContent = 'Generando...';

  // La pestana del HTML se reserva AHORA, con el gesto del vendedor todavia
  // fresco: desde ADR-0009 abrir el documento ocurre despues de esperar a Operam
  // (hasta TIMEOUT_OPERAM_MS) y un window.open tan tarde se lo come el bloqueador
  // de popups. Si algo falla se cierra.
  const ventana = window.open('', '_blank');
  if (ventana) ventana.document.write('<p style="font-family:Arial;padding:24px">Generando la cotizacion...</p>');

  try {
    const tier = getCurrentTier();
    const cartEntries = cartEntriesDesdeEstado();
    const envioForm = envioCapturadoEnFormulario();
    const { items, subtotal, iva, total } = buildItemsYTotales(cartEntries, envioForm);

    const vigenciaDias = parseInt(document.getElementById('resumen-vigencia').value) || 30;
    const vigenciaDate = new Date();
    vigenciaDate.setDate(vigenciaDate.getDate() + vigenciaDias);

    const notasText = document.getElementById('resumen-notas').value;
    const notas = notasText.split('\n').map(l => l.replace(/^-\s*/, '').trim()).filter(Boolean);

    const body = {
      fecha: new Date().toISOString().split('T')[0],
      vigencia: vigenciaDate.toISOString().split('T')[0],
      tier: tier.id,
      incluirFotos: document.getElementById('incluir-fotos')?.checked || false,
      cliente: leerClienteFormulario(domio.leyenda),
      condicionesPago: document.getElementById('cl-condiciones').value,
      items,
      subtotal,
      iva,
      total,
      notas,
      envio: buildEnvioEstructurado({ ...envioForm, enviaRateSeleccionado }),
      // Marca de producto decorado (ADR-0010): la calca del carrito la fija.
      decorado: marcaDecoradoParaGuardar(),
    };

    const canal = await canalParaCotizacion(body.cliente.telefono);
    if (canal) body.canal = canal;

    // Misma sesion de cotizacion (#83, F1): reusar el entry ya creado por el PDF
    // (o una generacion previa) en vez de duplicar la cotizacion.
    if (state.lastCotizacionId) body.cotizacionId = state.lastCotizacionId;

    const cotizacionId = await guardarYNumerarCotizacion(body, texto => { btn.textContent = texto; });
    if (!cotizacionId) { ventana?.close(); return; }

    // Mismo criterio que el PDF: el HTML lo regenera el GET con el folio ya
    // persistido (unico generador, ADR-0009).
    const url = `/api/cotizacion/html/${cotizacionId}`;
    if (ventana) ventana.location = url;
    else window.open(url, '_blank');
  } catch (e) {
    ventana?.close();
    alert('Error generando HTML: ' + e.message);
  } finally {
    btn.disabled = false;
    // #109: mismo criterio que btn-pdf -- el texto idle depende del modo.
    aplicarEtiquetasBotonesGenerar();
  }
}

function shareWhatsApp() {
  const cliente = document.getElementById('cl-razon-social').value ||
                  document.getElementById('cl-nombre-corto').value || 'Cliente';
  const total = document.getElementById('resumen-total').textContent;

  let pdfUrl = '';
  if (state.lastCotizacionId) {
    pdfUrl = `${window.location.origin}/api/cotizacion/pdf/${state.lastCotizacionId}`;
  }

  const msg = encodeURIComponent(
    `Cotizacion Peltre Nacional\nCliente: ${cliente}\nTotal: ${total}` +
    (pdfUrl ? `\n\nDescargar PDF:\n${pdfUrl}` : '\n\nGenera el PDF primero para incluir el enlace.')
  );
  window.open(`https://wa.me/?text=${msg}`, '_blank');
}

// #112: una sola nuevaCotizacion. Habia dos homonimas -- esta, de modulo, que
// reseteaba, y otra en window que solo navegaba; el menu "+" arma sus botones
// con onclick="nuevaCotizacion()", que resuelve contra window, y por eso no
// reseteaba. Ahora hace las dos mitades: las necesitan tanto #btn-nueva como el
// menu "+", visible desde cualquier vista.
// Orden: cerrarMenuNuevo() va ANTES del confirm (si el vendedor cancela, el menu
// igual debe cerrarse); la navegacion va DESPUES, para que cancelar no mueva nada.
// Para #btn-nueva la navegacion no se ve (ya esta en esa vista), pero NO es
// inocua: ocultarTodasLasVistas llama devolverPanelACasa (#94), asi que empezar
// de cero tambien descarta un upgrade fiscal a medias. Es lo deseable.
function nuevaCotizacion() {
  cerrarMenuNuevo();
  if (state.cart.size > 0 && !confirm('Se perdera la cotizacion actual. Continuar?')) return;
  ocultarTodasLasVistas();
  document.getElementById('app-view').style.display = 'block';
  marcarNavActivo('nav-cotizar');
  state.cart.clear();
  descripcionesAbiertas.clear();
  state.lastCotizacionId = null;
  state.modoActualizacion = false;
  state.vendedorConfirmado = false;

  // Limpiar campos
  const campos = [
    'cl-razon-social', 'cl-nombre-corto', 'cl-rfc', 'cl-cp-fiscal', 'cl-segmento', 'cl-telefono',
    'cl-nombre-entrega', 'cl-calle', 'cl-num-int', 'cl-colonia', 'cl-cp-entrega',
    'cl-municipio', 'cl-estado', 'cl-cel-entrega', 'cl-email-entrega',
    'cl-referencias', 'cl-referencia',
  ];
  for (const id of campos) {
    const el = document.getElementById(id);
    if (el) el.value = '';
  }
  document.getElementById('cl-condiciones').value = 'Anticipo 50%';
  const telCodeEl = document.getElementById('cl-telefono-code');
  if (telCodeEl) telCodeEl.value = '+52';
  const celCodeEl = document.getElementById('cl-cel-entrega-code');
  if (celCodeEl) celCodeEl.value = '+52';
  const paisEl = document.getElementById('cl-pais');
  if (paisEl) paisEl.value = 'MX';
  document.getElementById('shipping-option').value = 'none';
  document.getElementById('shipping-cost').value = '';
  document.getElementById('shipping-desc').value = 'Envio';
  document.getElementById('shipping-manual').style.display = 'none';
  document.getElementById('shipping-envia').style.display = 'none';
  document.getElementById('envia-results').innerHTML = '';
  document.getElementById('envia-error').style.display = 'none';
  document.getElementById('envia-resumen').style.display = 'none';
  enviaRateSeleccionado = null;
  envioInvalidadoPorCantidad = false;
  // El descuento del flete es de la cotizacion, no del vendedor (#137).
  envioDescuento = 0;
  // La marca de decorado es de la cotizacion, no del vendedor (#91): una nueva
  // arranca sin ella y el checkbox vuelve a estar disponible.
  decoradoManual = false;
  const notasNuevas = document.getElementById('resumen-notas');
  if (notasNuevas) notasNuevas.value = aplicarNotaTiempoEntrega(notasNuevas.value, false);
  const operamStatus = document.getElementById('operam-status-cotizar');
  if (operamStatus) operamStatus.innerHTML = '';
  // #109: salir de modo actualizacion devuelve los botones a su texto normal.
  aplicarEtiquetasBotonesGenerar();
  // Reinicia la entrada del paso Cliente (variante B, #82) a los dos caminos;
  // pcRenderInicio ya limpia los campos del cliente y de entrega via
  // pcPrepararSeleccion (el bloque de entrega vive en el paso Envio desde #84).
  pcRecientesCache = null;
  pcRenderInicio();
  resetFlujoGuiado();
  switchTab('cliente');
  renderProducts();
  updateTierBar();
  updateCartSummary();
  updateResumen();
  renderCartLines();
}
// El menu global "+" arma sus botones con onclick="<accion>()" (ver
// buildMenuNuevoHtml en pipeline-logica.js), que resuelve contra window.
window.nuevaCotizacion = nuevaCotizacion;

// === OPERAM: cliente seleccionado ===
// (El buscador visible del paso vive en #pc-root, #82; el panel viejo de
// busqueda con dropdown propio se retiro junto con su markup.)
let operamClienteSeleccionado = null;

async function seleccionarClienteOperam(cliente) {
  operamClienteSeleccionado = cliente;

  const fill = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
  fill('cl-razon-social',   cliente.name);
  fill('cl-nombre-corto',   cliente.ref);
  fill('cl-rfc',            cliente.rfc);
  fill('cl-cp-fiscal',      cliente.cpFiscal || cliente.cp);
  if (cliente.telefono) setTelefonoCampos('cl-telefono', 'cl-telefono-code', cliente.telefono);
  fill('cl-calle',          cliente.calle);
  fill('cl-num-int',        cliente.numInt);
  fill('cl-colonia',        cliente.colonia);
  fill('cl-cp-entrega',     cliente.cp);
  fill('cl-municipio',      cliente.municipio);
  fill('cl-estado',         cliente.estado);
  // OJO (issue #99): NO se prellena cl-nombre-entrega/cl-cel-entrega/cl-email-entrega
  // aqui con cliente.telefono/cliente.email -- esos vienen del buscador (server.js
  // /api/operam/clientes), que puede mezclar el telefono de un contacto con el email
  // de OTRO (ambos "sueltos", sin nombre). El contacto de entrega se elige mas abajo
  // via el selector de contactos (pcRenderContactoSelect), siempre con nombre visible.
  updateTabIndicators();

  // Cargar domicilios + contactos del cliente (issue #99: obtenerDomicilios ahora
  // devuelve { domicilios, contacts }). Se precarga el primer domicilio; con varios,
  // el paso Envio ofrece su propio selector (pcRenderDomSelect, #84) sobre
  // window._operamDomicilios. El selector de contactos (pcRenderContactoSelect)
  // combina el contacto propio del domicilio actual con window._operamContactosCliente.
  window._operamDomicilios = [];
  window._operamContactosCliente = [];
  try {
    const res = await api(`/api/operam/clientes/${cliente.id}/domicilios`);
    if (res.ok) {
      const { domicilios, contacts } = await res.json();
      window._operamDomicilios = domicilios || [];
      window._operamContactosCliente = contacts || [];
    }
  } catch {}
  pcState.domicilioIdx = 0;
  if (window._operamDomicilios.length >= 1) aplicarDomicilio(window._operamDomicilios[0]);

  // Mostrar historial de cotizaciones para este cliente
  const nombreCliente = (cliente.name || '').toLowerCase();
  const rfcCliente = (cliente.rfc || '').toLowerCase();
  try {
    const r = await api('/api/cotizaciones');
    const todas = await r.json();
    const previas = todas.filter(c => {
      const n = (c.cliente || '').toLowerCase();
      return n.includes(nombreCliente.slice(0, 10)) ||
        (rfcCliente && n.includes(rfcCliente));
    });
    if (previas.length > 0) {
      renderHistorialCliente(previas);
    }
  } catch {}
}

window.seleccionarClienteOperam = seleccionarClienteOperam;

// Solo aplica la DIRECCION del domicilio (calle/CP/municipio/...); el contacto de
// entrega (nombre+telefono+email) lo aplica el selector de contactos (issue #99,
// pcRenderContactoSelect/pcAplicarContacto), siempre con nombre visible.
function aplicarDomicilio(d) {
  if (!d) return;
  const f = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
  f('cl-calle',       d.calle);
  f('cl-num-int',     d.numInt);
  f('cl-colonia',     d.colonia);
  f('cl-cp-entrega',  d.cp);
  f('cl-municipio',   d.municipio);
  f('cl-estado',      d.estado);
}

// ============================================================================
// PASO CLIENTE -- variante B (issue #82; entrega diferida al paso Envio en #84)
// ----------------------------------------------------------------------------
// La entrada del paso Cliente: dos caminos ("Ya lo conozco" / "Contacto nuevo")
// + nota de diferimiento; buscador unificado (Operam + prospectos) con recientes;
// captura minima del contacto nuevo (crea/usa prospecto); y la tarjeta del cliente
// seleccionado con chips de completitud y CTA a Productos. El domicilio de entrega
// (#pc-entrega-wrap) ya NO vive aqui: se captura/confirma en el paso Envio (#84);
// el chip Entrega de la tarjeta es informativo y lleva alla (switchTab('envio')).
// El render es tonto: toda la decision vive en alta-logica.js
// (mezclar/recientes/chips/guardrails). Ver CONTEXT.md.
// ============================================================================

const pcState = { cliente: null, domicilioIdx: 0 };

function pcEl() { return document.getElementById('pc-root'); }

// Estado vivo del cliente para los chips: mezcla el cliente elegido con lo que hay
// ahora en los campos cl-* (el bloque de entrega puede cambiar CP/pais despues).
function pcClienteActual() {
  const base = pcState.cliente || {};
  return {
    ...base,
    name: document.getElementById('cl-razon-social')?.value || base.name || '',
    ref: document.getElementById('cl-nombre-corto')?.value || base.ref || '',
    telefono: leerTelefono('cl-telefono', 'cl-telefono-code') || base.telefono || '',
    cp: document.getElementById('cl-cp-entrega')?.value || '',
    pais: document.getElementById('cl-pais')?.value || base.pais || 'MX',
    calle: document.getElementById('cl-calle')?.value || '',
    rfc: document.getElementById('cl-rfc')?.value || base.rfc || '',
  };
}

function pcIniciales(nombre) {
  const p = String(nombre || '').split(/\s+/).filter(Boolean);
  return ((p[0] || ' ')[0] + ((p[1] || ' ')[0] || '')).toUpperCase().trim() || '?';
}

function pcNota() {
  return '<div class="pc-nota"><span>&#9432;</span><span>' +
    'La <b>direccion de entrega</b> se captura en el paso Envio. ' +
    'Los <b>datos fiscales</b> (CSF / RFC) solo se piden si subes el cliente a Operam o factura.' +
    '</span></div>';
}

// Limpia los campos cl-* del cliente para que cada seleccion empiece en blanco
// (evita que el CP/domicilio del cliente anterior se filtre al siguiente y pinte
// mal el chip Entrega). No toca el carrito ni el resto del flujo de cotizacion.
function pcLimpiarCamposCliente() {
  const campos = [
    'cl-razon-social', 'cl-nombre-corto', 'cl-rfc', 'cl-cp-fiscal', 'cl-segmento', 'cl-telefono',
    'cl-referencia', 'cl-nombre-entrega', 'cl-calle', 'cl-num-int', 'cl-colonia',
    'cl-cp-entrega', 'cl-municipio', 'cl-estado', 'cl-cel-entrega', 'cl-email-entrega',
    'cl-email-factura', 'cl-referencias',
  ];
  for (const id of campos) { const el = document.getElementById(id); if (el) el.value = ''; }
  const telCode = document.getElementById('cl-telefono-code'); if (telCode) telCode.value = '+52';
  const celCode = document.getElementById('cl-cel-entrega-code'); if (celCode) celCode.value = '+52';
  const pais = document.getElementById('cl-pais'); if (pais) pais.value = 'MX';
  const rfc = document.getElementById('cl-rfc'); if (rfc) rfc.readOnly = false;
  window._operamDomicilios = null;
  window._operamContactosCliente = null;
  pcState.domicilioIdx = 0;
}

// Punto UNICO de preparacion antes de seleccionar/crear un cliente: limpia los
// campos cl-* (incluido el bloque de entrega, que desde #84 vive siempre visible
// en el paso Envio). TODOS los entry points de seleccion (busqueda, reciente,
// prospecto, cotizarProspecto, altaCotizarAhora, contacto nuevo) pasan por aqui
// -- sin esto, la direccion del cliente A se filtra a los cl-* del cliente B y
// su PDF puede salir con la direccion equivocada.
function pcPrepararSeleccion() {
  pcState.cliente = null;
  pcLimpiarCamposCliente();
  pcRenderDomSelect();
  // El historial de cotizaciones previas es del cliente anterior: se oculta y
  // seleccionarClienteOperam lo re-renderiza si el nuevo cliente tiene previas.
  const hist = document.getElementById('historial-cliente-panel');
  if (hist) { hist.style.display = 'none'; hist.innerHTML = ''; }
  // Cambio de cliente = fin de la sesion de cotizacion (#83, F1): la proxima
  // generacion crea SU entry, no actualiza el del cliente anterior. El estado de
  // subida del resumen tambien era del anterior.
  state.lastCotizacionId = null;
  state.modoActualizacion = false;
  state.vendedorConfirmado = false;
  const operamStatus = document.getElementById('operam-status-cotizar');
  if (operamStatus) operamStatus.innerHTML = '';
  // #109: cambio de cliente tambien sale de modo actualizacion.
  aplicarEtiquetasBotonesGenerar();
}

// --- Entrada: dos caminos ---
function pcRenderInicio() {
  pcPrepararSeleccion();
  pcProspectosCache = null; // se refrescan al abrir una nueva captura/busqueda
  const root = pcEl();
  if (!root) return;
  root.innerHTML =
    '<div class="pc-pregunta">&iquest;Para quien es la cotizacion?</div>' +
    '<button type="button" class="pc-camino" onclick="pcCaminoBuscar()">' +
    '<span class="pc-camino-ico">&#128269;</span>' +
    '<span class="pc-camino-txt"><span class="pc-camino-tit">Ya lo conozco</span>' +
    '<span class="pc-camino-desc">Buscar en Operam o en mis prospectos</span></span>' +
    '<span class="pc-camino-fl">&rsaquo;</span></button>' +
    '<button type="button" class="pc-camino" onclick="pcCaminoNuevo()">' +
    '<span class="pc-camino-ico">+</span>' +
    '<span class="pc-camino-txt"><span class="pc-camino-tit">Contacto nuevo</span>' +
    '<span class="pc-camino-desc">Solo nombre, celular y ciudad</span></span>' +
    '<span class="pc-camino-fl">&rsaquo;</span></button>' +
    pcNota();
}
window.pcRenderInicio = pcRenderInicio;

// --- Camino buscar ---
let pcRecientesCache = null;
let pcBuscarTimer = null;

async function pcCaminoBuscar() {
  const root = pcEl();
  root.innerHTML =
    '<div class="pc-pregunta">Buscar cliente<small>Operam y prospectos en una sola busqueda.</small></div>' +
    '<div class="pc-search"><input type="text" id="pc-q" class="pc-input-lg" ' +
    'placeholder="Nombre, empresa, RFC o celular..." autocomplete="off"></div>' +
    '<div id="pc-zona"></div>' +
    '<button type="button" class="pc-back" onclick="pcRenderInicio()">&lsaquo; Volver</button>';
  const input = document.getElementById('pc-q');
  input.addEventListener('input', () => {
    clearTimeout(pcBuscarTimer);
    pcBuscarTimer = setTimeout(pcBuscar, 250);
  });
  input.focus();
  await pcRenderRecientes();
}
window.pcCaminoBuscar = pcCaminoBuscar;

async function pcCargarRecientes() {
  if (pcRecientesCache) return pcRecientesCache;
  try {
    const res = await api('/api/cotizaciones');
    const cots = await res.json();
    pcRecientesCache = recientesDesdeCotizaciones(cots);
  } catch {
    pcRecientesCache = [];
  }
  return pcRecientesCache;
}

async function pcRenderRecientes() {
  const zona = document.getElementById('pc-zona');
  if (!zona) return;
  const recientes = await pcCargarRecientes();
  if (!recientes.length) { zona.innerHTML = ''; return; }
  zona.innerHTML = '<div class="pc-res-titulo">Recientes</div>' +
    recientes.map((r, i) =>
      `<button type="button" class="pc-res-row" onclick="pcElegirReciente(${r.cotizacionId})">` +
      `<span class="pc-res-ini">${escapeHtml(pcIniciales(r.nombre))}</span>` +
      `<span class="pc-res-main"><span class="pc-res-nombre">${escapeHtml(r.nombre)}</span>` +
      `<span class="pc-res-sub">${escapeHtml(r.telefono || 'Cotizado antes')}</span></span></button>`
    ).join('');
}

// Fetch compartido de los dos origenes (Operam + prospectos) + mezcla con la
// funcion pura, sin endpoint nuevo. Lo usan el buscador y las sugerencias de
// nombre. Secuenciado con un token incremental: si mientras la consulta estaba
// en vuelo se disparo otra (tecla siguiente), la respuesta vieja se descarta
// devolviendo null -- sin esto, una respuesta lenta pisa a la nueva y
// pcResultadosCache queda desfasado del render (elegir por indice = cliente
// equivocado). Los prospectos se cachean por sesion de captura (se invalidan al
// volver a la entrada y al crear un prospecto); Operam se consulta por query.
let pcProspectosCache = null;
let pcBusquedaSeq = 0;

async function pcBuscarMezclado(q) {
  const seq = ++pcBusquedaSeq;
  const [clientes, prospectos] = await Promise.all([
    api(`/api/operam/clientes?q=${encodeURIComponent(q)}`).then(r => r.ok ? r.json() : []).catch(() => []),
    pcProspectosCache
      ? Promise.resolve(pcProspectosCache)
      : api('/api/prospectos').then(r => r.ok ? r.json() : []).catch(() => [])
          .then(p => { pcProspectosCache = p; return p; }),
  ]);
  if (seq !== pcBusquedaSeq) return null;
  return mezclarResultadosBusqueda(clientes, prospectos, q);
}

async function pcBuscar() {
  const q = document.getElementById('pc-q')?.value || '';
  if (q.trim().length < 2) { await pcRenderRecientes(); return; }
  const zonaAntes = document.getElementById('pc-zona');
  if (!zonaAntes) return;
  zonaAntes.innerHTML = '<div class="pc-res-titulo">Buscando...</div>';
  const rows = await pcBuscarMezclado(q);
  if (!rows) return; // respuesta vieja descartada (llego una busqueda mas nueva)
  const zona = document.getElementById('pc-zona');
  if (!zona) return; // el vendedor ya salio de la pantalla de busqueda
  pcResultadosCache = rows;
  const vista = decidirVistaTrasBusqueda(q, rows);
  if (vista === 'resultados') {
    zona.innerHTML = '<div class="pc-res-titulo">Resultados</div>' +
      rows.map((r, i) => pcFilaResultado(r, i)).join('') +
      pcFilaCrear(q);
  } else {
    zona.innerHTML = pcFilaCrear(q);
  }
}

let pcResultadosCache = [];

function pcFilaResultado(r, i) {
  const tag = r.tipo === 'operam'
    ? '<span class="pc-tag operam">Operam</span>'
    : '<span class="pc-tag prospecto">Prospecto</span>';
  return `<button type="button" class="pc-res-row" onclick="pcElegirResultado(${i})">` +
    `<span class="pc-res-ini ${r.tipo}">${escapeHtml(pcIniciales(r.nombre))}</span>` +
    `<span class="pc-res-main"><span class="pc-res-nombre">${escapeHtml(r.nombre)}</span>` +
    `<span class="pc-res-sub">${escapeHtml(r.sub || '')}</span></span>${tag}</button>`;
}

function pcFilaCrear(query) {
  const q = query.trim();
  return `<button type="button" class="pc-res-row pc-crear" onclick="pcCaminoNuevo(${JSON.stringify(q).replace(/"/g, '&quot;')})">` +
    '<span class="pc-res-ini">+</span>' +
    `<span class="pc-res-main"><span class="pc-res-nombre">Crear contacto &laquo;${escapeHtml(q)}&raquo;</span>` +
    '<span class="pc-res-sub">Solo nombre, celular y ciudad &mdash; suficiente para cotizar</span></span></button>';
}

function pcElegirResultado(i) {
  const r = pcResultadosCache[i];
  if (!r) return;
  if (r.tipo === 'operam') pcElegirOperam(r.raw);
  else pcElegirProspecto(r.raw);
}
window.pcElegirResultado = pcElegirResultado;

async function pcElegirOperam(raw) {
  pcPrepararSeleccion();
  const root = pcEl();
  root.innerHTML = '<div class="pc-pregunta">Cargando cliente...</div>';
  await seleccionarClienteOperam(raw); // llena cl-* + carga domicilios/historial
  pcState.cliente = { ...raw, tipo: 'operam' };
  pcRenderTarjeta();
}

function pcLlenarCamposContacto(cliente) {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
  set('cl-razon-social', cliente.name);
  set('cl-nombre-corto', cliente.ref);
  set('cl-rfc', cliente.rfc || '');
  set('cl-segmento', cliente.segmentoId || '');
  set('cl-municipio', cliente.municipio || '');
  if (cliente.email) set('cl-email-entrega', cliente.email);
  const pais = document.getElementById('cl-pais');
  if (pais && cliente.pais) pais.value = cliente.pais;
  if (cliente.telefono) {
    setTelefonoCampos('cl-telefono', 'cl-telefono-code', cliente.telefono);
    setTelefonoCampos('cl-cel-entrega', 'cl-cel-entrega-code', cliente.telefono);
  }
}

function pcElegirProspecto(raw) {
  pcPrepararSeleccion();
  const cliente = clienteDesdeProspecto(raw);
  pcLlenarCamposContacto(cliente);
  pcState.cliente = cliente;
  pcRenderTarjeta();
}

async function pcElegirReciente(cotizacionId) {
  pcPrepararSeleccion();
  const root = pcEl();
  root.innerHTML = '<div class="pc-pregunta">Cargando...</div>';
  try {
    const res = await api(`/api/cotizaciones/${cotizacionId}`);
    const data = await res.json();
    const c = data.cliente || {};
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
    set('cl-razon-social', c.razonSocial);
    set('cl-nombre-corto', c.nombreCorto);
    set('cl-rfc', c.rfc);
    set('cl-cp-fiscal', c.cpFiscal);
    set('cl-segmento', c.segmentoId);
    set('cl-nombre-entrega', c.nombreEntrega);
    set('cl-calle', c.calle);
    set('cl-num-int', c.numInt);
    set('cl-colonia', c.colonia);
    set('cl-cp-entrega', c.cpEntrega);
    set('cl-municipio', c.municipio);
    set('cl-estado', c.estado);
    set('cl-email-entrega', c.emailEntrega);
    const pais = document.getElementById('cl-pais');
    if (pais) pais.value = c.pais || 'MX';
    if (c.telefono) setTelefonoCampos('cl-telefono', 'cl-telefono-code', c.telefono);
    if (c.celEntrega) setTelefonoCampos('cl-cel-entrega', 'cl-cel-entrega-code', c.celEntrega);
    pcState.cliente = {
      tipo: c.rfc ? 'operam' : 'nuevo',
      name: c.razonSocial || c.nombreCorto || '', ref: c.nombreCorto || '',
      rfc: c.rfc || '', telefono: c.telefono || '', cp: c.cpEntrega || '', pais: c.pais || 'MX',
    };
    pcRenderTarjeta();
  } catch {
    pcRenderInicio();
    alert('No se pudo cargar la cotizacion');
  }
}
window.pcElegirReciente = pcElegirReciente;

// --- Camino contacto nuevo ---
function pcCaminoNuevo(prefill) {
  const root = pcEl();
  const nombre = typeof prefill === 'string' ? prefill : '';
  const canales = CANALES.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  root.innerHTML =
    '<div class="pc-pregunta">Contacto nuevo<small>Lo minimo para cotizar. Queda guardado como prospecto.</small></div>' +
    `<div class="form-group"><label>Nombre *</label>` +
    `<input type="text" id="pc-nombre" value="${escapeHtml(nombre)}" placeholder="Nombre (se acepta sin apellido)" autocomplete="off"></div>` +
    '<div id="pc-sug" class="pc-sugerencias"></div>' +
    '<div class="form-group"><label>Celular *</label>' +
    '<div style="display:flex;gap:8px"><select id="pc-cel-code" style="flex:0 0 92px">' +
    '<option value="+52">+52</option><option value="+1">+1</option><option value="+1-CA">+1 CA</option><option value="+">Otro</option></select>' +
    '<input type="tel" id="pc-cel" inputmode="tel" placeholder="55 1234 5678" style="flex:1"></div>' +
    '<div id="pc-cel-aviso" class="pc-cel-aviso" style="display:none"></div></div>' +
    '<div class="form-group"><label>Ciudad *</label>' +
    '<input type="text" id="pc-ciudad" placeholder="Para estimar envio"></div>' +
    `<div class="form-group"><label>Canal de origen *</label><select id="pc-canal"><option value="">-- Selecciona --</option>${canales}</select></div>` +
    '<div class="form-group"><label>Segmento <span style="font-size:11px;color:var(--text-light)">(opcional)</span></label>' +
    '<select id="pc-segmento"><option value="">-- Selecciona --</option></select></div>' +
    '<div id="pc-nuevo-error" class="pc-error" style="display:none"></div>' +
    '<button type="button" class="btn btn-primary btn-block" id="pc-guardar" onclick="pcGuardarContactoNuevo()">Guardar y continuar</button>' +
    '<button type="button" class="pc-back" onclick="pcRenderInicio()">&lsaquo; Volver</button>';
  let sugTimer;
  document.getElementById('pc-nombre').addEventListener('input', () => {
    clearTimeout(sugTimer);
    sugTimer = setTimeout(pcSugerenciasNombre, 250);
  });
  document.getElementById('pc-cel').addEventListener('blur', pcClasificarCelular);
  document.getElementById('pc-nombre').focus();
  // El segmento comparte catalogo con alta-segmento/pr-segmento (issue #121): se
  // puebla async, igual que poblarSelectoresProspecto -- no bloquea el render del
  // formulario mientras /api/catalogos responde.
  cargarCatalogos().then(catalogos => {
    const sel = document.getElementById('pc-segmento');
    if (sel) {
      sel.innerHTML = '<option value="">-- Selecciona --</option>' +
        (catalogos.segmentos || []).map(s => `<option value="${s.id}">${s.nombre}</option>`).join('');
    }
  }).catch(() => {});
}
window.pcCaminoNuevo = pcCaminoNuevo;

async function pcSugerenciasNombre() {
  const q = document.getElementById('pc-nombre')?.value || '';
  if (q.trim().length < 2) {
    const sugAntes = document.getElementById('pc-sug');
    if (sugAntes) sugAntes.innerHTML = '';
    return;
  }
  const todos = await pcBuscarMezclado(q);
  if (!todos) return; // respuesta vieja descartada
  const sug = document.getElementById('pc-sug');
  if (!sug) return;
  const rows = todos.slice(0, 3);
  pcResultadosCache = rows;
  if (!rows.length) { sug.innerHTML = ''; return; }
  sug.innerHTML = '<div class="pc-sug-titulo">&iquest;Es alguno de estos?</div>' +
    rows.map((r, i) => pcFilaResultado(r, i)).join('');
}

// Clasifica el celular tecleado y devuelve la decision del guardrail (#69).
// La consumen DOS momentos: el blur (pinta el aviso, best effort) y el guardado
// (que la espera con await -- el blur async no garantiza haber terminado cuando
// el vendedor pega el celular y toca Guardar de inmediato).
async function pcObtenerDecisionCelular() {
  const tel = combinarTelefonoConCodigo(
    document.getElementById('pc-cel-code')?.value,
    document.getElementById('pc-cel')?.value
  );
  if (!tel) return { accion: 'crear', tipo: 'libre', mensaje: '' };
  let clasificacion = null;
  try {
    const res = await api(`/api/prospectos/clasificar?celular=${encodeURIComponent(tel)}`);
    if (res.ok) clasificacion = await res.json();
  } catch { /* best effort: si la clasificacion falla, decide el 409 del server */ }
  return accionCelularContactoNuevo(clasificacion, state.user?.name);
}

async function pcClasificarCelular() {
  const aviso = document.getElementById('pc-cel-aviso');
  if (!aviso) return;
  const decision = await pcObtenerDecisionCelular();
  if (decision.accion === 'crear') { aviso.style.display = 'none'; return; }
  aviso.style.display = 'block';
  aviso.className = 'pc-cel-aviso ' + (decision.accion === 'bloquear' ? 'pc-aviso-rojo' : 'pc-aviso-ambar');
  let extra = '';
  if (decision.accion === 'cotizar_cliente') {
    extra = ` <button type="button" class="pc-link" onclick="pcCotizarComoCliente(${JSON.stringify(decision.cust_name || '').replace(/"/g, '&quot;')})">Cotizar sobre ese cliente</button>`;
  }
  aviso.innerHTML = escapeHtml(decision.mensaje) + extra;
}

async function pcCotizarComoCliente(custName) {
  // El celular pertenece a un cliente Operam: se busca por nombre para cotizar
  // sobre el (la clasificacion solo devuelve el nombre; la API v3 no da el id aqui).
  const root = pcEl();
  await pcCaminoBuscar();
  const input = document.getElementById('pc-q');
  if (input && custName) { input.value = custName; await pcBuscar(); }
}
window.pcCotizarComoCliente = pcCotizarComoCliente;

async function pcGuardarContactoNuevo() {
  const err = document.getElementById('pc-nuevo-error');
  const nombre = document.getElementById('pc-nombre')?.value || '';
  const celNum = document.getElementById('pc-cel')?.value || '';
  const celCode = document.getElementById('pc-cel-code')?.value || '+52';
  const ciudad = document.getElementById('pc-ciudad')?.value || '';
  const canal = document.getElementById('pc-canal')?.value || '';
  const segmentoId = document.getElementById('pc-segmento')?.value || '';
  const telefono = combinarTelefonoConCodigo(celCode, celNum);

  const showErr = m => { if (err) { err.textContent = m; err.style.display = 'block'; } };
  if (err) err.style.display = 'none';

  const payload = buildProspectoPayload({ celularCode: celCode, celular: celNum, nombre, ciudad, canal, segmento_id: segmentoId });
  const errVal = validarProspectoBody(payload);
  if (errVal) { showErr(errVal); return; }

  const cliente = buildClienteDesdeContactoNuevo({ nombre, telefono, ciudad, canal, segmentoId, pais: paisDesdeCodigoTelefono(celCode) });

  const btn = document.getElementById('pc-guardar');
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }
  const restaurarBtn = () => { if (btn) { btn.disabled = false; btn.textContent = 'Guardar y continuar'; } };

  // Guardrail de celular ajeno (#69/Visibilidad): se ESPERA la clasificacion aqui
  // (no se confia en la del blur, que puede seguir en vuelo si el vendedor pego el
  // celular y toco Guardar de inmediato). El 409 estructurado del server queda de
  // backstop si esta consulta falla.
  const decisionCel = await pcObtenerDecisionCelular();
  if (decisionCel.accion === 'bloquear') { showErr(decisionCel.mensaje); restaurarBtn(); return; }

  try {
    const res = await api('/api/prospectos', { method: 'POST', body: payload });
    const data = await res.json().catch(() => ({}));
    if (res.status === 409) {
      // Decision por el campo estructurado `tipo` del server (accionProspecto409,
      // #82) -- nunca parseando el string de error.
      const decision = accionProspecto409(data);
      if (decision.accion === 'usar_prospecto' && decision.prospecto) {
        // 1 celular = 1 prospecto: se cotiza sobre el EXISTENTE (identidad del
        // server), no sobre lo tecleado.
        pcElegirProspecto(decision.prospecto);
        return;
      }
      if (decision.accion === 'cotizar_cliente' && decision.cust_name && err) {
        // Celular de cliente Operam: no se crea prospecto; se ofrece cotizar
        // sobre ese cliente (mismo destino que el aviso del blur).
        err.innerHTML = escapeHtml(decision.mensaje) +
          ` <button type="button" class="pc-link" onclick="pcCotizarComoCliente(${JSON.stringify(decision.cust_name).replace(/"/g, '&quot;')})">Cotizar sobre ese cliente</button>`;
        err.style.display = 'block';
      } else {
        showErr(decision.mensaje);
      }
      restaurarBtn();
      return;
    }
    if (!res.ok) {
      showErr(data.error || 'No se pudo guardar el contacto');
      restaurarBtn();
      return;
    }
    pcProspectosCache = null; // hay un prospecto nuevo: invalida la cache de busqueda
    pcPrepararSeleccion();
    pcLlenarCamposContacto(cliente);
    pcState.cliente = cliente;
    pcRenderTarjeta();
  } catch (e) {
    showErr('Error de conexion');
    restaurarBtn();
  }
}
window.pcGuardarContactoNuevo = pcGuardarContactoNuevo;

// --- Tarjeta del cliente seleccionado ---

// Fila unica de los 3 chips de completitud (la usan la tarjeta y el re-pintado
// en vivo). El chip Entrega es tri-estado (#84): pendiente / CP capturado /
// domicilio completo; ya no abre un bloque local -- tocarlo lleva al paso Envio,
// que es donde vive el domicilio desde #84.
// customer_id de Operam contra el que se puede hacer el upgrade fiscal (#85):
// cliente Operam -> su id; prospecto ya ligado a un generico -> clienteOperamId;
// contacto nuevo / prospecto sin cotizar -> null (aun no hay cliente en Operam).
function pcCustomerIdFiscal() {
  return customerIdFiscal(pcState.cliente);
}

function pcChipsHtml(chips, customerIdFiscal) {
  const chip = (ok, okLabel, pendLabel) => ok
    ? `<span class="pc-chip ok">&#10003; ${okLabel}</span>`
    : `<span class="pc-chip pend">${pendLabel}</span>`;
  const entregaChip = chips.entrega === 'completo'
    ? '<span class="pc-chip ok">&#10003; Entrega</span>'
    : chips.entrega === 'cp'
      ? '<span class="pc-chip parcial">Entrega &middot; CP</span>'
      : '<span class="pc-chip pend">Entrega &middot; pendiente</span>';
  // El chip Fiscal es accionable (patron del chip Entrega, #84) solo cuando el RFC
  // sigue generico Y hay un cliente en Operam contra el cual actualizar: tocarlo abre
  // el flujo de CSF en modo upgrade (PUT). Sin cliente en Operam queda estatico.
  const fiscalChip = chips.fiscal
    ? '<span class="pc-chip ok">&#10003; Fiscal</span>'
    : (customerIdFiscal != null
        ? '<button type="button" class="pc-chip-btn" onclick="pcAbrirUpgradeFiscalDesdePaso()"><span class="pc-chip pend">Fiscal &middot; subir CSF</span></button>'
        : '<span class="pc-chip pend">Fiscal &middot; al subir a Operam</span>');
  return chip(chips.contacto, 'Contacto', 'Contacto') +
    `<button type="button" class="pc-chip-btn" onclick="switchTab('envio')">${entregaChip}</button>` +
    fiscalChip;
}

function pcRenderTarjeta() {
  const root = pcEl();
  const c = pcClienteActual();
  const esOperam = pcState.cliente?.tipo === 'operam';
  const chips = chipsCompletitud(c);
  // Cada parte se escapa ANTES de unir con la entidad &middot; (escapar el join
  // completo la romperia); telefono/ciudad son datos (p. ej. CSV de feria) y van
  // a innerHTML: sin escape seria un stored XSS.
  const subPartes = esOperam
    ? [c.rfc, 'Cliente en Operam']
    : [c.telefono, pcState.cliente?.ciudad, 'Prospecto'];
  const sub = subPartes.filter(Boolean).map(escapeHtml).join(' &middot; ');

  root.innerHTML =
    '<div class="pc-pregunta">Cliente seleccionado</div>' +
    '<div class="pc-cli-card">' +
    `<div class="pc-cli-nombre">${escapeHtml(c.name || 'Sin nombre')}</div>` +
    `<div class="pc-cli-sub">${sub}</div>` +
    `<div class="pc-chips">${pcChipsHtml(chips, pcCustomerIdFiscal())}</div>` +
    (esOperam ? '' : '<div class="pc-cli-hint">Puedes cotizar y mandar por WhatsApp con esto. La direccion se pide en Envio; los datos fiscales (CSF) solo si subes el cliente a Operam.</div>') +
    '<button type="button" class="btn btn-primary btn-block" style="margin-top:16px" onclick="pcContinuar()">Continuar a Productos &rsaquo;</button>' +
    '</div>' +
    '<button type="button" class="pc-back" onclick="pcRenderInicio()">&lsaquo; Cambiar de cliente</button>';

  pcRenderDomSelect();
  updateTabIndicators();
}

function pcContinuar() {
  switchTab('productos');
}
window.pcContinuar = pcContinuar;

// Selector de domicilio para cliente Operam con varios branches (#84: vive en
// el paso Envio, dentro de #pc-dom-slot -- HERMANO de #pc-root igual que antes
// de #84, ahora en otra pestana; los innerHTML de #pc-root nunca lo tocan).
function pcRenderDomSelect() {
  const slot = document.getElementById('pc-dom-slot');
  if (!slot) return;
  const esOperam = pcState.cliente?.tipo === 'operam';
  const doms = window._operamDomicilios;
  if (esOperam && Array.isArray(doms) && doms.length > 1) {
    slot.innerHTML = '<div class="form-group pc-dom"><label>Domicilio de entrega</label>' +
      '<select id="pc-dom-select" onchange="pcCambiarDomicilio()">' +
      doms.map((d, i) => `<option value="${i}">${escapeHtml(d.descripcion || d.calle || ('Domicilio ' + (i + 1)))}</option>`).join('') +
      '</select></div>';
  } else {
    slot.innerHTML = '';
  }
  pcRenderContactoSelect();
}

function pcCambiarDomicilio() {
  const idx = parseInt(document.getElementById('pc-dom-select')?.value) || 0;
  pcState.domicilioIdx = idx;
  aplicarDomicilio(window._operamDomicilios?.[idx]);
  pcRenderContactoSelect();
  pcRenderChips();
}
window.pcCambiarDomicilio = pcCambiarDomicilio;

// Selector de contacto de entrega (issue #99): combina el contacto propio del
// domicilio actual con los contactos del cliente (window._operamContactosCliente,
// con tag de Operam) para que el vendedor elija A QUIEN entregar, con nombre visible
// -- nunca un telefono/correo suelto sin dueno. Se re-renderiza al cambiar de
// domicilio (pcCambiarDomicilio) porque el contacto propio del domicilio cambia.
function pcContactosDisponibles() {
  const dom = window._operamDomicilios?.[pcState.domicilioIdx || 0];
  return contactosEntregaDisponibles(dom, window._operamContactosCliente);
}

function pcAplicarContacto(c) {
  const f = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
  f('cl-nombre-entrega', c?.nombre);
  setTelefonoCampos('cl-cel-entrega', 'cl-cel-entrega-code', c?.telefono || '');
  f('cl-email-entrega', c?.email);
  pcRenderChips();
}

function pcRenderContactoSelect() {
  const slot = document.getElementById('pc-contacto-slot');
  if (!slot) return;
  const contactos = pcContactosDisponibles();
  if (contactos.length === 0) {
    slot.innerHTML = '';
    return;
  }
  const opciones = contactos.map((c, i) => {
    const tag = etiquetaTagContacto(c.tag);
    const datos = [c.telefono, c.email].filter(Boolean).join(' · ');
    const etiqueta = (c.nombre || 'Sin nombre') + (tag ? ` (${tag})` : '') + (datos ? ' — ' + datos : '');
    return `<option value="${i}">${escapeHtml(etiqueta)}</option>`;
  }).join('');
  slot.innerHTML = '<div class="form-group pc-dom"><label>Contacto de entrega</label>' +
    '<select id="pc-contacto-select" onchange="pcCambiarContacto()">' +
    opciones +
    '<option value="nuevo">+ Nuevo contacto</option>' +
    '</select></div>';
  pcAplicarContacto(contactos[0]);
}

function pcCambiarContacto() {
  const val = document.getElementById('pc-contacto-select')?.value;
  if (val === 'nuevo') {
    pcAplicarContacto(null);
    document.getElementById('cl-nombre-entrega')?.focus();
    return;
  }
  pcAplicarContacto(pcContactosDisponibles()[parseInt(val)]);
}
window.pcCambiarContacto = pcCambiarContacto;

// Re-pinta solo los chips (sin re-render completo, para no perder foco al editar).
function pcRenderChips() {
  const cont = pcEl()?.querySelector('.pc-chips');
  if (!cont) return;
  cont.innerHTML = pcChipsHtml(chipsCompletitud(pcClienteActual()), pcCustomerIdFiscal());
}

// --- Upgrade fiscal desde el chip Fiscal (issue #85) ---
// Reutiliza la seccion 1 del acordeon (dropzone + parseo + campos editables) pero
// reorientada al PUT del upgrade en vez del POST de creacion: al confirmar,
// altaCsfConfirmar detecta altaCsfState.modoUpgrade y llama a pcEjecutarUpgradeFiscal.
function pcAbrirUpgradeFiscal(customerId, banner, origen) {
  const panel = document.getElementById('panel-alta-cliente');
  if (!panel) return;
  altaCsfState.modoUpgrade = customerId;
  // Origen del upgrade ('paso' | 'clientes'): decide si cl-email-factura es
  // confiable (ver emailFacturaParaUpgrade en alta-logica.js).
  altaCsfState.upgradeOrigen = origen || null;
  altaCsfState.datos = null;
  altaCsfState.pdfBase64 = null;
  // Banner de contexto (#94): visible siempre que modoUpgrade este activo. Hace
  // visible CONTRA QUIEN se actualiza (hoy ese contexto es invisible). Aplica
  // tanto al upgrade desde el paso Cliente como desde la vista Clientes.
  const bannerEl = document.getElementById('alta-upgrade-banner');
  if (bannerEl) {
    bannerEl.innerHTML = bannerUpgradeHtml({ id: customerId, nombre: banner?.nombre, rfc: banner?.rfc });
    bannerEl.style.display = '';
  }
  panel.style.display = 'block';
  altaTabSwitch('csf');
  altaState.seccionAbierta = null;
  altaToggleSeccion(1);
  altaCsfSetStatus('idle');
  altaPoblarSelectorSegmentoUpgrade();
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
window.pcAbrirUpgradeFiscal = pcAbrirUpgradeFiscal;

// Segmento en el panel de upgrade (issue #95 regla 6): comparte catalogo con
// alta-segmento (Seccion 2), pero es un <select> propio -- la Seccion 2 vive en
// el flujo del acordeon completo (POST, hoy sin punto de entrada en la UI) y no
// se abre durante un upgrade.
function altaPoblarSelectorSegmentoUpgrade() {
  const sel = document.getElementById('alta-upgrade-segmento');
  if (!sel) return;
  cargarCatalogos().then(catalogos => {
    sel.innerHTML = '<option value="">-- Selecciona --</option>' +
      (catalogos.segmentos || []).map(s => `<option value="${s.id}">${s.nombre}</option>`).join('');
  }).catch(() => {});
}

// Wrapper del chip Fiscal del paso Cliente: deriva el contexto del banner (nombre
// + RFC generico) de pcState.cliente, sin embeber texto arbitrario en el onclick.
function pcAbrirUpgradeFiscalDesdePaso() {
  const id = pcCustomerIdFiscal();
  if (id == null) return;
  const c = pcState.cliente || {};
  pcAbrirUpgradeFiscal(id, { nombre: c.name || c.ref || '', rfc: c.rfc || '' }, 'paso');
}
window.pcAbrirUpgradeFiscalDesdePaso = pcAbrirUpgradeFiscalDesdePaso;

async function pcEjecutarUpgradeFiscal(datos) {
  const customerId = altaCsfState.modoUpgrade;
  const btn = document.getElementById('csf-btn-confirmar');
  const errDiv = document.getElementById('csf-campos-error');
  const mostrarError = msg => { if (errDiv) { errDiv.style.display = ''; errDiv.textContent = msg; } };
  if (btn) { btn.disabled = true; btn.textContent = 'Actualizando en Operam...'; }
  // Email de facturacion (issue #95 regla 3): se captura en el paso Cliente/Envio
  // (cl-email-factura), input GLOBAL que vive fuera del acordeon de la CSF. Solo se
  // incluye cuando el upgrade se abrio desde el paso Cliente ('paso'): desde la
  // vista Clientes (#94) puede traer el email de OTRO cliente cotizado antes (fuga
  // de contexto detectada en la revision de #95).
  const emailFactura = emailFacturaParaUpgrade(
    altaCsfState.upgradeOrigen,
    document.getElementById('cl-email-factura')?.value
  );
  const csfDatosConFactura = emailFactura ? { ...datos, invoiceEmail: emailFactura } : datos;
  try {
    const res = await api(`/api/actualizar-cliente-fiscal/${customerId}`, {
      method: 'PUT',
      body: { csfDatos: csfDatosConFactura, pdf_base64: altaCsfState.pdfBase64 || null },
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 409 && data.fusion) {
      const c = data.cliente || {};
      mostrarError(`${data.error} Cliente existente: ${c.CustName || ''} (ID ${c.cliente_id || ''}).`);
      return;
    }
    if (!res.ok || !data.ok) {
      mostrarError(data.error || 'No se pudo actualizar en Operam');
      return;
    }
    const ignorado = data.camposNoActualizados || [];
    const campoPego = campo => !ignorado.some(x => x.campo === campo);
    const panel = document.getElementById('panel-alta-cliente');
    if (panel) panel.style.display = 'none';
    altaCsfState.modoUpgrade = null; altaCsfState.upgradeOrigen = null;
    // El chip Fiscal pasa a verde solo si el RFC real SI pego (chipsCompletitud lo
    // deriva de pcState.cliente.rfc). Si Operam ignoro un campo (quirk del PUT),
    // esa parte de la tarjeta se queda con el valor viejo en vez de mostrar un dato
    // que Operam en realidad no guardo.
    if (pcState.cliente && campoPego('tax_id')) pcState.cliente.rfc = datos.rfc;
    if (pcState.cliente && campoPego('CustName')) pcState.cliente.name = datos.razonSocial || pcState.cliente.name;
    const rfcInput = document.getElementById('cl-rfc');
    if (rfcInput && campoPego('tax_id')) rfcInput.value = datos.rfc;
    const razonInput = document.getElementById('cl-razon-social');
    if (razonInput && campoPego('CustName') && datos.razonSocial) razonInput.value = datos.razonSocial;
    pcRenderTarjeta();
    if (ignorado.length) {
      alert('Datos fiscales actualizados, pero Operam ignoro estos campos (corrigelos en Operam): ' +
        ignorado.map(x => x.label || x.campo).join(', '));
    }
  } catch (e) {
    mostrarError('Error de conexion');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Confirmar datos fiscales'; }
  }
}

function renderHistorialCliente(cotizaciones) {
  const panel = document.getElementById('historial-cliente-panel');
  if (!panel) return;
  panel.style.display = 'block';
  panel.innerHTML = `<div class="section-header">Cotizaciones previas (${cotizaciones.length})</div>` +
    cotizaciones.slice(-5).reverse().map(c => {
      const fecha = new Date(c.fecha).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
      // "Reintentar subida" solo si la cotizacion sigue en PRE (sin folio); una ya
      // registrada (#Operam N) o historica no lo ofrece (#83, AC6). El contenedor
      // por-cotizacion recibe el estado al reintentar.
      return `<div class="cot-mini">
        <span>${fecha} - ${c.tier} - $${c.total?.toLocaleString('es-MX', { minimumFractionDigits: 2 })}${badgeFolioOperamHtml(c)}${badgeQuoteDesactualizadoHtml(c)}</span>
        ${c.hasData ? buildAccionesCargaHtml(c) : ''}
        ${c.hasData ? `<a href="/api/cotizacion/pdf/${c.id}" target="_blank" class="btn btn-sm btn-secondary">PDF</a>` : ''}
        ${botonCompletarHtml(c)}
        <div class="operam-status-slot"></div>
      </div>`;
    }).join('');
}
window.renderHistorialCliente = renderHistorialCliente;

// Resuelve el slot de estado RELATIVO al elemento clickeado (F2 de la revision
// de #83): la misma cotizacion puede estar pintada en dos paneles a la vez
// (Historial y cotizaciones previas del cliente, ambos vivos en el DOM con
// display:none), asi que un id global operam-status-cot-N seria duplicado y
// getElementById pintaria siempre en el primero -- posiblemente el oculto. Un
// boton dentro del slot (Reintentar/Elegir/Dejar como PRE) resuelve a su propio
// slot; el boton "Reintentar subida" de las acciones de la tarjeta resuelve al
// slot hermano dentro de la misma tarjeta (.cot-card / .cot-mini).
function slotOperamDesde(el) {
  if (!el || !el.closest) return null;
  return el.closest('.operam-status-slot') ||
    el.closest('.cot-card, .cot-mini')?.querySelector('.operam-status-slot') || null;
}

// Auto-subida a Operam (#83, ADR-0006): al generar una cotizacion (PDF/HTML) se
// sube sola via el endpoint idempotente de #81 -- sin boton manual. La misma
// funcion sirve para el reintento y para resolver la dedup por nombre (extraBody
// = { customerId }). El resultado se pinta en el slot (nodo DOM) con la vista
// pura interpretarSubidaOperam + buildOperamStatusHtml (folio | PRE + Reintentar
// | candidatos inline | PRE sin datos). Desde ADR-0009 la generacion ESPERA a
// esta subida para imprimir el folio, pero un fallo sigue sin bloquear el
// documento: degrada a PRE (sin numero) en vez de dejar al vendedor sin nada.
// Subidas en vuelo por id (F3 de la revision): un doble click en Reintentar /
// Elegir, o un Reintentar con la auto-subida original aun en vuelo, no dispara
// un segundo POST (el server ademas tiene su lock por id, que es la proteccion
// real; esto evita el 425 en el caso comun). El id se normaliza a string (llega
// como string de state.lastCotizacionId y como numero de los onclick).
const subidasOperamEnVuelo = new Set();

async function autoSubirOperam(id, slot, extraBody) {
  if (!id) return null;
  const key = String(id);
  // Ya en vuelo: antes esto era un `return` mudo, inofensivo mientras la subida
  // era secundaria. Con ADR-0009 la subida esta en la ruta critica de la
  // generacion, asi que un silencio aqui produce justo lo que el ADR prohibe --
  // un documento sin numero sin decir por que. Se devuelve (y se pinta) un PRE
  // explicito, distinto de un fallo, con el Reintentar de siempre.
  if (subidasOperamEnVuelo.has(key)) {
    const enVuelo = interpretarSubidaOperam({ enVuelo: true });
    if (slot) slot.innerHTML = buildOperamStatusHtml(id, enVuelo);
    return enVuelo;
  }
  subidasOperamEnVuelo.add(key);
  if (slot) slot.innerHTML = '<span class="operam-status">Subiendo a Operam...</span>';
  let resultado;
  try {
    const opts = { method: 'POST' };
    if (extraBody) opts.body = extraBody;
    const res = await api(`/api/cotizacion/operam/${id}`, opts);
    let data = {};
    try { data = await res.json(); } catch {}
    resultado = {
      ok: res.ok, status: res.status, folio: data.folio, yaSubida: data.yaSubida,
      error: data.error, candidatos: data.candidatos,
      customerId: data.customer_id, clienteGenerico: data.clienteGenerico,
      // #106: los steps traen el resultado del post-fix de la vigencia; sin esto un
      // fallo solo viviria en los logs del servidor y el vendedor mandaria la
      // cotizacion sin saber que en Operam se ve vencida.
      steps: data.steps,
    };
  } catch (e) {
    resultado = { ok: false, status: 0, error: e.message };
  } finally {
    subidasOperamEnVuelo.delete(key);
  }
  const vista = interpretarSubidaOperam(resultado);
  // #93: la cotizacion recien subida (misma sesion, mismo cliente del paso
  // Cliente) trae el customer_id del alta generica -- se refresca pcState al
  // instante para que el chip Fiscal deje de estar muerto sin depender de una
  // nueva busqueda. Cliente tipo 'operam' ya trae su propio id real: no aplica.
  if (vista.customerId != null && key === String(state.lastCotizacionId) &&
      pcState.cliente && pcState.cliente.tipo !== 'operam') {
    pcState.cliente.clienteOperamId = vista.customerId;
    if (pcEl()?.querySelector('.pc-cli-card')) pcRenderChips();
  }
  if (slot) slot.innerHTML = buildOperamStatusHtml(id, vista);
  return vista;
}
// Actualizacion del quote conservando el folio (#104, ADR-0008). Se dispara tras
// generar el documento cuando la sesion venia de "Actualizar cotizacion": el registro
// del cotizador ya lo reescribio la generacion (crearOActualizarCotizacion honra
// cotizacionId), aqui se reescribe el quote en Operam. Comparte la guarda de subidas
// en vuelo con autoSubirOperam: las dos operaciones se pisarian el carrito de FA, y
// el servidor ademas tiene su lock por id (la proteccion real).
async function actualizarQuoteEnOperam(id, slot) {
  if (!id) return;
  const key = String(id);
  // Ya en vuelo: era un `return` mudo, tolerable mientras esto solo lo disparaba el
  // boton del historial. Desde #114 la reescritura del quote esta en la ruta critica
  // de CADA generacion (Generar PDF y enseguida Ver HTML la disparan dos veces), y un
  // silencio aqui deja el quote con lo viejo mientras el documento ya salio numerado.
  // Se pinta el mismo aviso que da el 425 del servidor, con su Reintentar.
  if (subidasOperamEnVuelo.has(key)) {
    const enCurso = interpretarActualizacionOperam({
      ok: false, status: 425, escrito: false,
      error: 'Ya hay una operacion de Operam en curso para esta cotizacion: reintenta cuando termine.',
    });
    if (slot) slot.innerHTML = buildActualizacionStatusHtml(id, enCurso);
    return enCurso;
  }
  subidasOperamEnVuelo.add(key);
  if (slot) slot.innerHTML = '<span class="operam-status">Actualizando en Operam...</span>';
  let resultado;
  try {
    const res = await api(`/api/cotizacion/operam/${id}/actualizar`, { method: 'POST' });
    let data = {};
    try { data = await res.json(); } catch {}
    resultado = {
      ok: data.ok === true, status: res.status, folio: data.folio,
      escrito: data.escrito, verificado: data.verificado,
      error: data.error, discrepancias: data.discrepancias,
    };
  } catch (e) {
    resultado = { ok: false, status: 0, error: e.message };
  } finally {
    subidasOperamEnVuelo.delete(key);
  }
  const vista = interpretarActualizacionOperam(resultado);
  if (slot) slot.innerHTML = buildActualizacionStatusHtml(id, vista);
  // #114: bloqueada = el quote ya tiene pedido y Operam no deja editarlo, asi que el
  // documento recien generado lleva un folio cuyo quote conserva el contenido viejo.
  // El slot solo no basta: el vendedor acaba de descargar el PDF y su siguiente gesto
  // es mandarselo al cliente. Aqui NO vale entregar callado un documento numerado que
  // diverge (decision de Adrian), y este es el unico aviso que se cruza en el camino.
  if (vista.estado === 'bloqueada') {
    alert('OJO: el documento ya lleva el folio de Operam, pero la cotizacion en Operam NO se actualizo.\n\n' +
      (vista.mensaje || '') +
      '\n\nUsa "Crear una cotizacion nueva a partir de esta" antes de enviarsela al cliente.');
  }
  return vista;
}
window.reintentarActualizacionOperam = (id, el) => actualizarQuoteEnOperam(id, slotOperamDesde(el));

window.reintentarSubidaOperam = (id, el) => autoSubirOperam(id, slotOperamDesde(el));
window.elegirCandidatoOperam = (id, customerId, el) => autoSubirOperam(id, slotOperamDesde(el), { customerId });
window.dejarPreOperam = (id, el) => {
  const slot = slotOperamDesde(el);
  if (slot) slot.innerHTML = buildOperamStatusHtml(id, { estado: 'sin_datos', mensaje: 'Queda como PRE. Puedes reintentar la subida desde el historial.' });
};

// Reintentar la subida de una cotizacion PRE desde su tarjeta (boton "Reintentar
// subida", #83). Reusa la auto-subida idempotente pintando el resultado en el
// slot de SU tarjeta (resuelto desde el boton clickeado, F2) -- sin navegar (F4):
// el retry puede salir del panel de cotizaciones previas en plena captura y
// arrancar al vendedor al Historial seria robarle la pantalla. El folio queda
// visible in situ; el badge de la tarjeta se actualiza en el proximo render.
function completarPreCotizacion(id, el) {
  return autoSubirOperam(id, slotOperamDesde(el));
}
window.completarPreCotizacion = completarPreCotizacion;

// === TABS ===
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.toggle('active', t.id === `tab-${name}`));
  if (name === 'resumen') updateResumen();
  if (name === 'envio') {
    updateShippingSummary();
    // Auto-cotizar con el CP ya capturado en el bloque de entrega si aplica
    // (#84: mismo campo, ya no hay que copiarlo a un envia-cp aparte).
    const cpCliente = document.getElementById('cl-cp-entrega')?.value?.trim();
    if (cpCliente && /^\d{5}$/.test(cpCliente)) {
      const opt = document.getElementById('shipping-option');
      if (opt && opt.value === 'none' && state.cart.size > 0) {
        opt.value = 'envia';
        document.getElementById('shipping-envia').style.display = 'block';
        document.getElementById('shipping-manual').style.display = 'none';
      }
      // #102: si ya hay una tarifa elegida (restaurada del historial o de la
      // misma sesion) no se vuelve a consultar envia.com al re-entrar al tab.
      if (debeAutoCotizarEnvia(opt?.value, state.cart.size, enviaRateSeleccionado)) {
        setTimeout(cotizarEnvia, 100);
      }
    }
  }
  updateTabIndicators();
}
// El chip Entrega de la tarjeta (#84) navega con onclick="switchTab('envio')"
// inline en el HTML generado; sin este exponer global, un modulo ES no cuelga
// sus funciones de window y el onclick revienta con ReferenceError.
window.switchTab = switchTab;

// === FORMAT ===
function fmt(n) {
  if (n == null) return '0.00';
  return n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// === FLUJO GUIADO ===

function getSkusFiltrados(sel = {}) {
  const skus = state.precios?.skus || [];
  const { tiposActivos = [], texturasActivas = [] } = state.precios?.config || {};
  return skus.filter(s => {
    if (tiposActivos.length && !tiposActivos.includes(s.tipo)) return false;
    if (texturasActivas.length && !texturasActivas.includes(s.textura)) return false;
    if (sel.tipo != null && s.tipo !== sel.tipo) return false;
    if (sel.tamano != null && s.tamano !== sel.tamano) return false;
    if (sel.color1 != null && s.color1 !== sel.color1) return false;
    if (sel.textura != null && s.textura !== sel.textura) return false;
    if (sel.color2 != null && s.color2 !== sel.color2) return false;
    if (sel.filetes != null && s.filetes !== sel.filetes) return false;
    if (sel.colorRiso != null && s.colorRiso !== sel.colorRiso) return false;
    return true;
  });
}

function unique(arr) { return [...new Set(arr)].filter(v => v != null); }

function getSKUFinal() {
  const { tipo, tamano, color1, textura, color2, filetes, colorRiso } = guiado;
  if (!tipo || !tamano || !color1 || textura === null || filetes === null) return null;
  const sel = { tipo, tamano, color1, textura, filetes };
  const mid = getSkusFiltrados({ tipo, tamano, color1, textura });
  const colores2Disp = unique(mid.map(s => s.color2));
  if (colores2Disp.length > 0 && color2 === null) return null;
  if (color2 !== null) sel.color2 = color2;
  if (filetes === 1) {
    if (colorRiso === null) return null;
    sel.colorRiso = colorRiso;
  }
  const filtrados = getSkusFiltrados(sel);
  return filtrados[0] || null;
}

function renderFlujoGuiado() {
  const container = document.getElementById('flujo-guiado');
  if (!container || !state.precios) return;

  const { tipo, tamano, color1, textura, color2, filetes, colorRiso, cantidad } = guiado;
  const { config = {}, colores = {}, texturas = {}, colorFiletes = {}, tiposNombre = {} } = state.precios;
  const { texturasActivas = [] } = config;
  const filetesLabels = { 1: 'Con borde', 2: 'Sin borde' };

  // Lookup tipo corto → nombre
  const tipoLabel = {};
  for (const [modelo, nombre] of Object.entries(tiposNombre)) {
    const p = modelo.slice(0, 2);
    if (!tipoLabel[p]) tipoLabel[p] = nombre.replace(/\s+\d[\d.]*\s*(cm|lt|lts|pz|piezas)?.*$/i, '').trim();
  }

  // Calcular opciones de cada paso en base al estado actual
  const tiposDisp   = unique(getSkusFiltrados({}).map(s => s.tipo)).sort();
  const tamanosDisp = tipo   ? unique(getSkusFiltrados({tipo}).map(s => s.tamano)).sort((a,b) => parseInt(a)-parseInt(b)) : [];
  const coloresDisp = (tipo && tamano) ? unique(getSkusFiltrados({tipo,tamano}).map(s => s.color1)).sort() : [];
  const texturasDisp = (tipo && tamano && color1)
    ? unique(getSkusFiltrados({tipo,tamano,color1}).filter(s => texturasActivas.includes(s.textura)).map(s => s.textura)).sort((a,b)=>a-b) : [];

  const midSkus = (tipo && tamano && color1 && textura !== null)
    ? getSkusFiltrados({tipo,tamano,color1,textura}) : [];
  const colores2Disp = unique(midSkus.map(s => s.color2)).filter(v => v !== null);
  const color2Done = colores2Disp.length === 0 || color2 !== null;

  const selBase = { tipo, tamano, color1, textura };
  if (color2 !== null) selBase.color2 = color2;
  const filetesDisp = (tipo && tamano && color1 && textura !== null && color2Done)
    ? unique(getSkusFiltrados(selBase).map(s => s.filetes)).sort() : [];

  const risosDisp = (tipo && tamano && color1 && textura !== null && color2Done && filetes === 1)
    ? unique(getSkusFiltrados({...selBase, filetes}).map(s => s.colorRiso)).sort((a,b)=>a-b) : [];

  // Función genérica para renderizar un select
  const mkSelect = (campo, opts, labelFn, curVal) => {
    const dis = opts.length === 0 ? ' disabled' : '';
    const optHtml = opts.map(o => `<option value="${o}"${curVal===o?' selected':''}>${labelFn(o)}</option>`).join('');
    return `<select onchange="onFlujoChange('${campo}',this.value)"${dis}>
      <option value="">—</option>${optHtml}
    </select>`;
  };

  const pasos = [
    { label: 'Tipo',        html: mkSelect('tipo',     tiposDisp,    t => `${t} — ${tipoLabel[t]||t}`, tipo) },
    { label: 'Tamaño',      html: mkSelect('tamano',   tamanosDisp,  t => `${parseInt(t)} cm`,          tamano) },
    { label: 'Color',       html: mkSelect('color1',   coloresDisp,  c => colores[c]||c,                color1) },
    { label: 'Textura',     html: mkSelect('textura',  texturasDisp, t => texturas[t]||t,               textura) },
    { label: 'Color 2',     html: mkSelect('color2',   colores2Disp, c => colores[c]||c,                color2) },
    { label: 'Filetes',     html: mkSelect('filetes',  filetesDisp,  f => filetesLabels[f]||`Filete ${f}`, filetes) },
    { label: 'Color filete',html: mkSelect('colorRiso',risosDisp,    r => colorFiletes[r]||`Color ${r}`, colorRiso) },
  ];

  let html = '<div class="flujo-grid">';
  for (const p of pasos) html += `<div class="flujo-paso"><label>${p.label}</label>${p.html}</div>`;
  html += '</div>';

  container.innerHTML = html;

  // Resultado en el contenedor derecho
  const resContainer = document.getElementById('flujo-resultado-container');
  if (!resContainer) return;

  const skuFinal = getSKUFinal();
  if (skuFinal) {
    const product = state.precios.products.find(p => p.key === skuFinal.priceKey);
    const precio = product ? getPrice(product) : 0;
    resContainer.innerHTML = `<div class="flujo-resultado">
      <div class="flujo-res-info">
        <div class="flujo-sku-nombre" title="${skuFinal.nombre}">${skuFinal.nombre}</div>
        <div class="flujo-sku-precio">$${fmt(precio)} / pza &nbsp;·&nbsp; ${getCurrentTier().label}</div>
      </div>
      <div class="flujo-res-actions">
        <button class="qty-btn" onclick="cambiarCantidadGuiado(-1)">-</button>
        <input class="qty-input" type="number" min="1" value="${cantidad}" id="fg-cantidad"
          oninput="guiado.cantidad=Math.max(1,parseInt(this.value)||1)" inputmode="numeric">
        <button class="qty-btn" onclick="cambiarCantidadGuiado(1)">+</button>
        <button class="btn btn-primary btn-sm" onclick="agregarAlCarritoGuiado()">Agregar</button>
        <button class="btn btn-secondary btn-sm" onclick="resetFlujoGuiado()">Limpiar</button>
      </div>
    </div>`;
  } else {
    resContainer.innerHTML = '';
  }
}

function onFlujoChange(campo, valor) {
  const numericFields = new Set(['textura', 'filetes', 'colorRiso']);
  guiado[campo] = valor === '' ? null : numericFields.has(campo) ? parseInt(valor) : valor;
  const orden = ['tipo','tamano','color1','textura','color2','filetes','colorRiso'];
  const idx = orden.indexOf(campo);
  for (let i = idx + 1; i < orden.length; i++) guiado[orden[i]] = null;
  guiado.cantidad = 1;
  renderFlujoGuiado();
}

function cambiarCantidadGuiado(delta) {
  guiado.cantidad = Math.max(1, guiado.cantidad + delta);
  const el = document.getElementById('fg-cantidad');
  if (el) el.value = guiado.cantidad;
}

function agregarAlCarritoGuiado() {
  const skuFinal = getSKUFinal();
  if (!skuFinal) return;
  const product = state.precios.products.find(p => p.key === skuFinal.priceKey);
  if (!product) return;

  const inputEl = document.getElementById('fg-cantidad');
  const cantidad = Math.max(1, parseInt(inputEl?.value) || guiado.cantidad || 1);

  const skuProduct = {
    key: skuFinal.sku,
    name: skuFinal.nombre,
    model: skuFinal.tipo + skuFinal.tamano,
    weight_kg: product.weight_kg,
    prices: product.prices,
  };

  const prev = state.cart.get(skuFinal.sku);
  state.cart.set(skuFinal.sku, conservarCaptura(skuFinal.sku, { product: skuProduct, cantidad: (prev?.cantidad || 0) + cantidad }));

  updateTierBar();
  updateCartSummary();
  updateResumen();
  updateShippingSummary();
  renderCartLines();
  resetFlujoGuiado();
}

function resetFlujoGuiado() {
  Object.assign(guiado, { tipo: null, tamano: null, color1: null, textura: null,
    color2: null, filetes: null, colorRiso: null, cantidad: 1 });
  renderFlujoGuiado();
}

window.onFlujoChange = onFlujoChange;
window.cambiarCantidadGuiado = cambiarCantidadGuiado;
window.agregarAlCarritoGuiado = agregarAlCarritoGuiado;
window.resetFlujoGuiado = resetFlujoGuiado;

// === HISTORIAL ===
// Conmutador kanban/lista (issue #50): mismo patron que el tablero de
// prospectos (#49); la preferencia del usuario se recuerda en localStorage.
let cotizacionesModo = localStorage.getItem('cotizacionesModo') === 'tablero' ? 'tablero' : 'lista';
let ultimasCotizaciones = [];
// Criterio del buscador (#146, rango de fechas #148): vive en memoria, no
// persiste (ni localStorage ni servidor). Re-entrar al Historial lo limpia.
let cotizacionesFiltro = { texto: '', desde: '', hasta: '' };

async function showHistorial() {
  ocultarTodasLasVistas();
  document.getElementById('historial-view').style.display = 'block';
  cotizacionesFiltro = { texto: '', desde: '', hasta: '' };
  document.getElementById('historial-buscar').value = '';
  document.getElementById('historial-desde').value = '';
  document.getElementById('historial-hasta').value = '';
  await recargarHistorial();
}

// Recarga el listado conservando el filtro: la usan las acciones que cierran
// una cotizacion (boton y arrastre a Ganada/Perdida) para refrescar sin que el
// vendedor pierda lo que estaba buscando.
async function recargarHistorial() {
  const loadingEl = document.getElementById('historial-loading');
  loadingEl.style.display = 'block';
  document.getElementById('historial-list').innerHTML = '';
  document.getElementById('cotizaciones-tablero').innerHTML = '';
  document.getElementById('historial-sin-resultados').style.display = 'none';

  try {
    const res = await api('/api/cotizaciones');
    ultimasCotizaciones = await res.json();
    loadingEl.style.display = 'none';
    renderHistorial();
  } catch (e) {
    loadingEl.textContent = 'Error cargando historial';
  }
}

function renderHistorial() {
  const listEl = document.getElementById('historial-list');
  const tableroEl = document.getElementById('cotizaciones-tablero');
  const sinResultadosEl = document.getElementById('historial-sin-resultados');
  const esTablero = cotizacionesModo === 'tablero';
  const btnLista = document.getElementById('btn-cot-modo-lista');
  const btnTablero = document.getElementById('btn-cot-modo-tablero');
  btnLista.classList.toggle('btn-primary', !esTablero);
  btnLista.classList.toggle('btn-secondary', esTablero);
  btnTablero.classList.toggle('btn-primary', esTablero);
  btnTablero.classList.toggle('btn-secondary', !esTablero);
  // El filtro se aplica al arreglo ANTES de pintar (#146): Lista y Tablero lo
  // comparten gratis y cambiar de modo lo conserva.
  const visibles = filtrarCotizaciones(ultimasCotizaciones, cotizacionesFiltro);
  // "No hay resultados" no es "no hay cotizaciones": si el listado trae algo y
  // el filtro no matcha nada, manda el aviso del buscador en los dos modos.
  const sinResultados = visibles.length === 0 && ultimasCotizaciones.length > 0;
  sinResultadosEl.style.display = sinResultados ? 'block' : 'none';
  tableroEl.style.display = esTablero && !sinResultados ? 'flex' : 'none';
  listEl.style.display = !esTablero && !sinResultados ? 'block' : 'none';
  if (sinResultados) {
    listEl.innerHTML = '';
    tableroEl.innerHTML = '';
    return;
  }
  if (esTablero) {
    listEl.innerHTML = '';
    tableroEl.innerHTML = buildTableroCotizacionesHtml(visibles);
    return;
  }
  tableroEl.innerHTML = '';

  if (!visibles.length) {
    listEl.innerHTML = '<div class="empty-state"><p>Sin cotizaciones registradas.</p></div>';
    return;
  }

  listEl.innerHTML = visibles.slice().reverse().map(c => {
    const fecha = new Date(c.fecha).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
    // Ver PDF / Ver HTML / WhatsApp regeneran desde el registro guardado
    // (issue #103), no desde disco ni desde el estado del formulario.
    const accionesDocumento = buildHistorialAccionesHtml(c, window.location.origin);
    // "Cargar" hacia dos cosas a la vez (#104): restaurar el carrito y, calladamente,
    // empezar una cotizacion NUEVA. Ahora son dos acciones explicitas.
    const btnCargar = buildAccionesCargaHtml(c);
    // Estado PRE / #Operam (issue #63) visible en el Historial; "Completar"
    // (issue #66) formaliza la pre-cotizacion desde su tarjeta. Solo aparece
    // mientras la cotizacion sigue siendo PRE.
    const badge = badgeFolioOperamHtml(c) + badgeQuoteDesactualizadoHtml(c);
    const btnCompletar = botonCompletarHtml(c);
    return `
      <div class="cot-card">
        <div class="cot-card-header">
          <div>
            <div class="cot-card-cliente">${escapeHtml(c.cliente || 'Sin nombre')}${badge}</div>
            <div class="cot-card-meta">${fecha} · ${c.vendedor} · ${c.totalPiezas} pzs</div>
          </div>
          <div>
            <div class="cot-card-total">$${fmt(c.total)}</div>
            <div class="cot-card-tier">${c.tier}</div>
          </div>
        </div>
        <div class="cot-card-actions">
          ${accionesDocumento}
          ${btnCargar}
          ${btnCompletar}
        </div>
        <div class="operam-status-slot"></div>
      </div>
    `;
  }).join('');
}

function setModoCotizaciones(modo) {
  cotizacionesModo = modo;
  localStorage.setItem('cotizacionesModo', modo);
  renderHistorial();
}

// Drop en el tablero de cotizaciones (issue #50): solo el cierre se opera
// arrastrando -- Ganada o Perdida con confirmacion, via el PATCH de estado
// existente. El tiempo no se arrastra: los drops a cadencia rebotan sin
// llamar al servidor.
async function soltarEnColumnaCotizacion(origen, destino) {
  if (!puedeArrastrarCotizacion(origen.col, destino)) {
    avisoTablero(origen.col === 'ganada' || origen.col === 'perdida'
      ? 'Una cotización cerrada no se reabre arrastrando'
      : 'El tiempo no se arrastra: las tarjetas avanzan solas con los días');
    return;
  }
  const label = destino === 'ganada' ? 'Ganada' : 'Perdida';
  const cot = ultimasCotizaciones.find(c => c.id === origen.id);
  if (!confirm(`¿Marcar la cotización de ${cot?.cliente || 'este cliente'} como ${label}?`)) return;
  try {
    const res = await api(`/api/cotizacion/${origen.id}/estado`, { method: 'PATCH', body: { estado: destino } });
    if (!res.ok) { avisoTablero('No se pudo actualizar el estado'); return; }
    recargarHistorial();
  } catch (e) {
    avisoTablero('Error de conexion');
  }
}

// === SEGUIMIENTO DE COTIZACIONES ===
// La cola de cotizaciones (cadencia de dias naturales) ya no tiene vista propia:
// se fusiono con la cola Hoy (#64), donde cada cotizacion se pinta con
// buildColaCotizacionItemHtml (pipeline-logica.js). Aqui solo quedan las acciones
// sobre cada item (marcar el paso, cerrar el estado), que la cola Hoy invoca.

// El seguimiento de cotizaciones vive ahora en la cola Hoy fusionada (#64): tras
// registrar el paso o cerrar el estado, se refresca Hoy (su unico hogar).
async function marcarSeguimiento(id, paso) {
  try {
    const res = await api(`/api/seguimiento/${id}`, { method: 'POST', body: { paso } });
    if (!res.ok) { alert('No se pudo registrar el seguimiento'); return; }
    avisoTablero('Registrado: la tarjeta sale de la cola y volverá cuando toque el siguiente paso (día 2 → 7 → 21 → vencida)');
    showHoy();
  } catch (e) {
    alert('Error de conexion');
  }
}

async function cambiarEstadoCotizacion(id, estado) {
  try {
    const res = await api(`/api/cotizacion/${id}/estado`, { method: 'PATCH', body: { estado } });
    if (!res.ok) { alert('No se pudo actualizar el estado'); return; }
    showHoy();
  } catch (e) {
    alert('Error de conexion');
  }
}

// Reunion de diagnostico sobre una cotizacion en la cola Hoy (issue #65): agendar
// (input datetime de la card) o registrar el resultado (avance reanuda la cadencia,
// Perdida cierra; Modelo A: no hay No util para cotizaciones).
async function agendarReunionCotizacion(id) {
  const input = document.getElementById(`cot-reunion-${id}`);
  const valor = input ? input.value : '';
  if (!valor) { alert('Selecciona fecha y hora de la reunión'); return; }
  try {
    const res = await api(`/api/cotizacion/${id}/reunion`, {
      method: 'POST', body: { fecha: new Date(valor).toISOString() },
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || 'No se pudo agendar la reunión');
      return;
    }
    showHoy();
  } catch (e) {
    alert('Error de conexion');
  }
}

async function resultadoReunionCotizacion(id, resultado) {
  try {
    const res = await api(`/api/cotizacion/${id}/reunion-resultado`, {
      method: 'POST', body: { resultado },
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || 'No se pudo registrar el resultado');
      return;
    }
    showHoy();
  } catch (e) {
    alert('Error de conexion');
  }
}

function actualizarBadgeSeguimiento(count) {
  const badge = document.getElementById('seguimiento-badge');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count;
    badge.style.display = 'block';
  } else {
    badge.style.display = 'none';
  }
}

// El badge de Hoy cuenta la cola UNICA del dia (issue #64): prospectos en Por
// Cotizar + cotizaciones en Seguimiento, ya fusionadas por GET /api/hoy. El
// contador es el tamano total de esa cola.
async function cargarBadgeSeguimiento() {
  try {
    const res = await api('/api/hoy');
    if (!res.ok) return;
    const cola = await res.json();
    actualizarBadgeSeguimiento(cola.length);
  } catch (e) { /* sin red no hay badge */ }
}

window.marcarSeguimiento = marcarSeguimiento;
window.cambiarEstadoCotizacion = cambiarEstadoCotizacion;
window.agendarReunionCotizacion = agendarReunionCotizacion;
window.resultadoReunionCotizacion = resultadoReunionCotizacion;

// === PROSPECTOS (issue #41) ===
let prospectoSelectoresListos = false;

async function poblarSelectoresProspecto() {
  if (prospectoSelectoresListos) return;
  prospectoSelectoresListos = true;
  document.getElementById('pr-canal').innerHTML =
    '<option value="">-- Selecciona --</option>' +
    CANALES.map(c => `<option value="${c}">${c}</option>`).join('');
  document.getElementById('pr-piezas').innerHTML =
    '<option value="">--</option>' +
    PIEZAS_ESTIMADAS.map(p => `<option value="${p}">${p}</option>`).join('');
  try {
    const catalogos = await cargarCatalogos();
    document.getElementById('pr-segmento').innerHTML =
      '<option value="">--</option>' +
      catalogos.segmentos.map(s => `<option value="${s.id}">${s.nombre}</option>`).join('');
  } catch {
    prospectoSelectoresListos = false;
  }
}

function showProspectos() {
  ocultarTodasLasVistas();
  document.getElementById('prospectos-view').style.display = 'block';
  poblarSelectoresProspecto();
  cargarListaProspectos();
  cargarMotivosNoUtil();
}

// === VISTA CLIENTES (issue #94) ===
// Mantenimiento de clientes desde el cotizador: alta completa (POST) y upgrade de
// CSF (PUT) sin abrir una cotizacion. Hermana de Historial/Prospectos; sigue su
// patron de montaje. Reusa el buscador mixto (pcBuscarMezclado) y los chips del
// paso Cliente (chipsCompletitud); el render vive en pipeline-logica.js. El panel
// de alta (#panel-alta-cliente) se re-parenta a #clientes-panel-slot (moverPanelA)
// y vuelve a su casa al salir (devolverPanelACasa, via ocultarTodasLasVistas).
const cvState = { seleccion: null };
let cvResultadosCache = [];

function cvRoot() { return document.getElementById('clientes-root'); }

function showClientes() {
  ocultarTodasLasVistas();
  document.getElementById('clientes-view').style.display = 'block';
  marcarNavActivo('nav-mas');
  cvState.seleccion = null;
  pcProspectosCache = null; // se refresca al abrir la busqueda
  cvRenderBusqueda();
}

function cvRenderBusqueda() {
  const root = cvRoot();
  if (!root) return;
  cvState.seleccion = null;
  root.innerHTML =
    '<div class="pc-pregunta">Clientes<small>Busca un cliente para completar sus datos, o da de alta uno nuevo.</small></div>' +
    '<div class="pc-search"><input type="text" id="cv-q" class="pc-input-lg" ' +
    'placeholder="Nombre, RFC o telefono..." autocomplete="off"></div>' +
    '<div id="cv-zona"></div>';
  const input = document.getElementById('cv-q');
  let timer;
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(cvBuscar, 250); });
  input.focus();
  cvRenderRecientes();
}
window.cvRenderBusqueda = cvRenderBusqueda;

async function cvRenderRecientes() {
  const zona = document.getElementById('cv-zona');
  if (!zona) return;
  const recientes = await pcCargarRecientes();
  if (!recientes.length) { zona.innerHTML = ''; return; }
  // Los recientes derivan de cotizaciones (nombre + telefono) y no traen RFC/id,
  // asi que tocarlos prellena la busqueda y resuelve el registro real de Operam
  // (con su tag generico correcto), en vez de intentar pintar una tarjeta a medias.
  zona.innerHTML = '<div class="pc-res-titulo">Recientes</div>' +
    recientes.map(r =>
      '<button type="button" class="pc-res-row" onclick="cvBuscarPrefill(' + JSON.stringify(r.nombre).replace(/"/g, '&quot;') + ')">' +
      '<span class="pc-res-ini">' + escapeHtml(pcIniciales(r.nombre)) + '</span>' +
      '<span class="pc-res-main"><span class="pc-res-nombre">' + escapeHtml(r.nombre) + '</span>' +
      '<span class="pc-res-sub">' + escapeHtml(r.telefono || 'Cotizado antes') + '</span></span></button>'
    ).join('');
}

async function cvBuscarPrefill(nombre) {
  const input = document.getElementById('cv-q');
  if (input) { input.value = nombre || ''; await cvBuscar(); }
}
window.cvBuscarPrefill = cvBuscarPrefill;

async function cvBuscar() {
  const q = document.getElementById('cv-q')?.value || '';
  if (q.trim().length < 2) { await cvRenderRecientes(); return; }
  const zonaAntes = document.getElementById('cv-zona');
  if (!zonaAntes) return;
  zonaAntes.innerHTML = '<div class="pc-res-titulo">Buscando...</div>';
  const rows = await pcBuscarMezclado(q);
  if (!rows) return; // respuesta vieja descartada
  const zona = document.getElementById('cv-zona');
  if (!zona) return;
  cvResultadosCache = rows;
  zona.innerHTML = (rows.length ? '<div class="pc-res-titulo">Resultados</div>' +
    rows.map((r, i) => filaResultadoClienteHtml(r, i)).join('') : '') +
    filaCrearClienteHtml(q);
}

function cvElegirResultado(i) {
  const r = cvResultadosCache[i];
  if (!r) return;
  const card = r.tipo === 'operam'
    ? { ...r.raw, tipo: 'operam', pais: r.raw?.pais || 'MX' }
    : clienteDesdeProspecto(r.raw);
  cvState.seleccion = { tipo: r.tipo, card, raw: r.raw };
  cvRenderTarjeta();
}
window.cvElegirResultado = cvElegirResultado;

function cvRenderTarjeta() {
  const root = cvRoot();
  const sel = cvState.seleccion;
  if (!root || !sel) return;
  root.innerHTML =
    '<div class="pc-pregunta">Cliente</div>' +
    cardClienteHtml(sel.card) +
    '<button type="button" class="pc-back" onclick="cvRenderBusqueda()">&lsaquo; Buscar otro cliente</button>';
}
window.cvRenderTarjeta = cvRenderTarjeta;

// Fila punteada -> alta COMPLETA (acordeon 1-4, POST). Re-parenta el panel a la
// vista y lo abre en modo creacion (abrirAcordeonAlta resetea modoUpgrade).
function cvCaminoAlta(query) {
  const root = cvRoot();
  if (!root) return;
  cvState.seleccion = null;
  const q = typeof query === 'string' ? query.trim() : '';
  root.innerHTML =
    '<div class="pc-pregunta">Nuevo cliente<small>Alta completa en Operam, sin cotizacion.' +
    (q ? ' (' + escapeHtml(q) + ')' : '') + '</small></div>' +
    '<button type="button" class="pc-back" onclick="cvRenderBusqueda()">&lsaquo; Cancelar</button>';
  moverPanelA(document.getElementById('clientes-panel-slot'));
  const panel = document.getElementById('panel-alta-cliente');
  if (panel) panel.style.display = 'none'; // abrirAcordeonAlta togglea sobre display
  abrirAcordeonAlta();
}
window.cvCaminoAlta = cvCaminoAlta;

// Chip/boton Fiscal -> upgrade de CSF (PUT #85) sobre el cliente generico, con el
// banner de contexto. Re-parenta el panel a la vista Clientes.
function cvAbrirUpgrade() {
  const sel = cvState.seleccion;
  if (!sel) return;
  const id = customerIdFiscal(sel.card);
  if (id == null) return;
  const c = sel.card;
  const root = cvRoot();
  if (root) {
    root.innerHTML =
      '<div class="pc-pregunta">Completar datos fiscales</div>' +
      '<button type="button" class="pc-back" onclick="cvRenderTarjeta()">&lsaquo; Volver al cliente</button>';
  }
  moverPanelA(document.getElementById('clientes-panel-slot'));
  pcAbrirUpgradeFiscal(id, { nombre: c.name || c.ref || '', rfc: c.rfc || '' }, 'clientes');
}
window.cvAbrirUpgrade = cvAbrirUpgrade;

// "Cotizar a este cliente": aterriza en el paso Cliente con el cliente ya
// seleccionado (reusa pcElegirOperam / pcElegirProspecto -> seleccionarClienteOperam).
function cvCotizar() {
  const sel = cvState.seleccion;
  if (!sel) return;
  ocultarTodasLasVistas();
  document.getElementById('app-view').style.display = 'block';
  marcarNavActivo('nav-cotizar');
  switchTab('cliente');
  if (sel.tipo === 'operam') pcElegirOperam(sel.raw);
  else pcElegirProspecto(sel.raw);
}
window.cvCotizar = cvCotizar;

window.nuevoCliente = () => {
  cerrarMenuNuevo();
  showClientes();
  cvCaminoAlta('');
};

// === BANDEJA DE REVISION "Rescatados de Operam" (issue #122) ===
// Vista hermana de Clientes, FUERA de las 7 columnas del pipeline: lista los
// candidatos rescatados de Operam y deja aceptarlos (nace la tarjeta en el
// tablero) o descartarlos (se marcan, no se borran). Solo admin. El HTML lo arma
// la logica pura de bandeja-logica.js; aqui vive el estado y el IO.
//
// Los handlers de las tarjetas se invocan desde onclick inline, que resuelve
// contra window (trampa #112): cada uno se expone a window JUNTO a su
// declaracion y no existe ningun otro simbolo con ese nombre.
const bandejaState = { filtro: 'pendiente', candidatos: [], vendedores: [], busqueda: {} };

async function showBandeja() {
  ocultarTodasLasVistas();
  document.getElementById('bandeja-view').style.display = 'block';
  marcarNavActivo('nav-mas');
  bandejaState.filtro = 'pendiente';
  bandejaState.busqueda = {};
  await cargarBandeja();
}

async function cargarBandeja() {
  const root = document.getElementById('bandeja-root');
  if (!root) return;
  root.innerHTML = '<div class="empty-state"><p>Cargando...</p></div>';
  try {
    const [res, catalogos] = await Promise.all([api('/api/admin/bandeja'), cargarCatalogos()]);
    if (!res.ok) {
      root.innerHTML = '<div class="alert alert-warning">No se pudo cargar la bandeja.</div>';
      return;
    }
    bandejaState.candidatos = await res.json();
    bandejaState.vendedores = catalogos.vendedores || [];
  } catch (e) {
    root.innerHTML = '<div class="alert alert-warning">Error de conexión al cargar la bandeja.</div>';
    return;
  }
  renderBandeja();
}

function renderBandeja() {
  const root = document.getElementById('bandeja-root');
  if (!root) return;
  root.innerHTML = buildBandejaHtml(bandejaState.candidatos, bandejaState.filtro, bandejaState.vendedores, bandejaState.busqueda);
}

function bandejaCandidato(folio) {
  return bandejaState.candidatos.find(c => String(c.folio) === String(folio));
}

function bandejaFiltro(filtro) {
  bandejaState.filtro = filtro;
  renderBandeja();
}
window.bandejaFiltro = bandejaFiltro;

// El vendedor elegido en el select solo vive en el candidato hasta que se acepta
// (es el vendedor que viaja en el POST). No se re-renderiza: el select ya muestra
// la eleccion y repintar cerraria el foco del usuario.
function bandejaSetVendedor(folio, vendedor) {
  const c = bandejaCandidato(folio);
  if (c) c.vendedor = vendedor;
}
window.bandejaSetVendedor = bandejaSetVendedor;

// Los dos caminos de aceptacion comparten endpoint: el servidor decide cual aplica
// por el TIPO del candidato (y es quien frena a los genericos, #125). Aqui solo
// cambia el nombre de lo que se crea, para que el aviso de error lo diga.
async function bandejaEnviarAceptar(folio, queSeCrea) {
  const c = bandejaCandidato(folio);
  if (!c) return;
  if (!c.vendedor) { alert('Elige el vendedor antes de aceptar'); return; }
  try {
    const res = await api(`/api/admin/bandeja/${encodeURIComponent(folio)}/aceptar`, {
      method: 'POST', body: { vendedor: c.vendedor },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error || `No se pudo aceptar el candidato como ${queSeCrea}`);
    }
  } catch (e) {
    alert('Error de conexión al aceptar el candidato');
    return;
  }
  await cargarBandeja();
}

async function bandejaAceptar(folio) {
  await bandejaEnviarAceptar(folio, 'prospecto');
}
window.bandejaAceptar = bandejaAceptar;

// Aceptar como COTIZACION (#125): la oportunidad nace en el pipeline con las
// partidas del quote y su folio de Operam ligado.
async function bandejaAceptarCotizacion(folio) {
  await bandejaEnviarAceptar(folio, 'cotización');
}
window.bandejaAceptarCotizacion = bandejaAceptarCotizacion;

async function bandejaDescartar(folio) {
  try {
    const res = await api(`/api/admin/bandeja/${encodeURIComponent(folio)}/descartar`, {
      method: 'POST', body: {},
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error || 'No se pudo descartar el candidato');
    }
  } catch (e) {
    alert('Error de conexión al descartar el candidato');
    return;
  }
  await cargarBandeja();
}
window.bandejaDescartar = bandejaDescartar;

function bandejaVerEnTablero() {
  showPipeline();
  marcarNavActivo('nav-pipeline');
}
window.bandejaVerEnTablero = bandejaVerEnTablero;

// "Buscar nuevas en Operam" (#126): dispara el descubrimiento recurrente. El
// walk pacea contra Operam (throttle anti-429), asi que puede tardar unos
// segundos -- el boton se deshabilita mientras esta en vuelo y al terminar pinta
// el resultado (nuevos + saltados) y recarga la bandeja para ver lo depositado.
async function bandejaBuscarNuevas() {
  bandejaState.busqueda = { ocupado: true };
  renderBandeja();
  try {
    const res = await api('/api/admin/bandeja/buscar-nuevas', { method: 'POST', body: {} });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error || 'No se pudo buscar nuevas en Operam');
      bandejaState.busqueda = {};
      return;
    }
    const resultado = await res.json();
    bandejaState.busqueda = { resultado };
    const [listado, catalogos] = await Promise.all([api('/api/admin/bandeja'), cargarCatalogos()]);
    if (listado.ok) bandejaState.candidatos = await listado.json();
    bandejaState.vendedores = catalogos.vendedores || [];
  } catch (e) {
    alert('Error de conexión al buscar nuevas en Operam');
    bandejaState.busqueda = {};
  }
  renderBandeja();
}
window.bandejaBuscarNuevas = bandejaBuscarNuevas;

// === PIPELINE (tablero unico de 7 etapas, issue #53) ===
// Una oportunidad: antes de cotizar es el prospecto (su etapa del pipeline ya
// viene migrada del store); al cotizar, la cotizacion lleva la oportunidad por
// el resto del embudo (su etapa la deriva el store del estado). El tablero las
// reparte en sus 7 columnas; las salidas viven fuera. Conmutador lista/tablero.
const PIPELINE_MODOS = new Set(['tablero', 'lista', 'cerradas']);
let pipelineModo = PIPELINE_MODOS.has(localStorage.getItem('pipelineModo')) ? localStorage.getItem('pipelineModo') : 'tablero';
let ultimasOportunidades = [];
// Catalogo de vendedores para el control de asignar de la tarjeta No Asignado
// (issue #57): solo lo carga el admin (la unica que ve esas tarjetas y asigna).
let vendedoresPipeline = [];

function motivoNoUtilDe(p) {
  // El motivo de la salida a No util vive en el evento no_util (issue #59, AC3:
  // el filtro de cerradas lo muestra). El ultimo evento no_util manda.
  let motivo = null;
  for (const e of p.eventos || []) {
    if (e.tipo === 'no_util' && e.motivo) motivo = e.motivo;
  }
  return motivo;
}

function prospectoAOportunidad(p) {
  return {
    tipo: 'prospecto', id: `p${p.id}`, refId: p.id, nombre: p.nombre,
    vendedor: p.vendedor, ciudad: p.ciudad, canal: p.canal, etapa: p.etapa,
    total: 0, fecha: p.fecha,
    // Folio de Operam de un prospecto movido a mano (issue #56): vive en el bag
    // data porque cotizo por fuera (no hay cotizacion en el sistema). La tarjeta
    // pinta "#Operam N" solo si hay folio (nunca PRE, eso es de cotizaciones).
    folioOperam: p.data?.folioOperam ?? null,
    // Motivo de la salida a No util (issue #59, AC3): lo muestra el filtro de
    // cerradas. Solo aplica a prospectos (Modelo A).
    motivoNoUtil: motivoNoUtilDe(p),
  };
}

function cotizacionAOportunidad(c) {
  return {
    tipo: 'cotizacion', id: `c${c.id}`, refId: c.id, nombre: c.cliente,
    vendedor: c.vendedor, etapa: c.etapa, total: c.total, totalPiezas: c.totalPiezas,
    fecha: c.fecha, folioOperam: c.folioOperam ?? null,
    decorado: c.decorado === true, calcaChecklist: c.calcaChecklist ?? null,
    // Cadena de folios de Operam (issue #67, AC4): el espejo persistido por el sync
    // (data.espejoOperam) que la tarjeta pinta para trazabilidad.
    espejoOperam: c.espejoOperam ?? null,
    // Pago sin registrar (issue #77): la entregada-impaga muestra el badge hasta que
    // el sync detecte el pago (allocated ~ total) y apague el flag.
    pagoSinRegistrar: c.pagoSinRegistrar === true,
  };
}

async function showPipeline() {
  ocultarTodasLasVistas();
  document.getElementById('pipeline-view').style.display = 'block';
  const loadingEl = document.getElementById('pipeline-loading');
  loadingEl.style.display = 'block';
  document.getElementById('pipeline-tablero').innerHTML = '';
  document.getElementById('pipeline-list').innerHTML = '';
  try {
    const [resP, resC] = await Promise.all([api('/api/prospectos'), api('/api/cotizaciones')]);
    const prospectos = resP.ok ? await resP.json() : [];
    const cotizaciones = resC.ok ? await resC.json() : [];
    ultimasOportunidades = [
      ...prospectos.map(prospectoAOportunidad),
      ...cotizaciones.map(cotizacionAOportunidad),
    ];
    // Asignar vendedor a una tarjeta No Asignado (issue #57) es accion de admin:
    // solo el admin necesita el catalogo de vendedores para el selector. El
    // no-admin no ve tarjetas No Asignado (su cartera no incluye sin-dueno).
    if (state.user.role === 'admin') {
      try { vendedoresPipeline = (await cargarCatalogos()).vendedores || []; } catch { vendedoresPipeline = []; }
    }
    loadingEl.style.display = 'none';
    renderPipeline();
  } catch (e) {
    loadingEl.textContent = 'Error cargando el pipeline';
  }
}

function renderPipeline() {
  const tableroEl = document.getElementById('pipeline-tablero');
  const listEl = document.getElementById('pipeline-list');
  const esTablero = pipelineModo === 'tablero';
  const esCerradas = pipelineModo === 'cerradas';
  const btnLista = document.getElementById('btn-pipeline-modo-lista');
  const btnTablero = document.getElementById('btn-pipeline-modo-tablero');
  const btnCerradas = document.getElementById('btn-pipeline-modo-cerradas');
  // El modo activo va en btn-primary, los otros en btn-secondary.
  for (const [btn, activo] of [[btnTablero, esTablero], [btnLista, pipelineModo === 'lista'], [btnCerradas, esCerradas]]) {
    if (!btn) continue;
    btn.classList.toggle('btn-primary', activo);
    btn.classList.toggle('btn-secondary', !activo);
  }
  tableroEl.style.display = esTablero ? 'flex' : 'none';
  listEl.style.display = esTablero ? 'none' : 'block';
  if (esTablero) {
    listEl.innerHTML = '';
    tableroEl.innerHTML = buildTableroPipelineHtml(ultimasOportunidades, {
      vendedores: vendedoresPipeline, esAdmin: state.user.role === 'admin',
    });
    return;
  }
  tableroEl.innerHTML = '';
  // Modo Cerradas (issue #59, AC3): las salidas No util/Perdida que el tablero y
  // la lista ocultan viven aqui, con su tipo de cierre y, para No util, el motivo.
  if (esCerradas) {
    listEl.innerHTML = buildCerradasHtml(ultimasOportunidades);
    return;
  }
  // Vista lista: las mismas oportunidades que pinta el tablero (sus 7 columnas),
  // mas reciente primero. Las salidas No util/Perdida NO se muestran aqui: viven
  // en filtro/historial, igual que el tablero las excluye (oportunidadesActivas).
  const activas = oportunidadesActivas(ultimasOportunidades)
    .slice().sort((a, b) => new Date(b.fecha || 0) - new Date(a.fecha || 0));
  if (!activas.length) {
    listEl.innerHTML = '<div class="empty-state"><p>Sin oportunidades en el pipeline.</p></div>';
    return;
  }
  listEl.innerHTML = activas.map(o => {
    const total = o.total ? `<div class="cot-card-total">$${fmt(o.total)}</div>` : '';
    const meta = [o.vendedor, o.ciudad, o.canal].filter(Boolean).map(escapeHtml).join(' · ');
    const badge = o.tipo === 'cotizacion' ? badgeFolioOperamHtml(o) : badgeFolioOperamProspectoHtml(o);
    const cadena = cadenaOperamHtml(o.espejoOperam);
    return `<div class="cot-card"><div class="cot-card-header"><div>
      <div class="cot-card-cliente">${escapeHtml(o.nombre || 'Sin nombre')}${badge}${badgePagoSinRegistrarHtml(o)}</div>
      <div class="cot-card-meta">${escapeHtml(PIPELINE_LABEL[o.etapa] || o.etapa)}${meta ? ' · ' + meta : ''}</div>
      ${cadena}
    </div>${total}</div></div>`;
  }).join('');
}

const PIPELINE_LABEL = {
  no_asignado: 'No Asignado', por_cotizar: 'Por Cotizar', seguimiento: 'Seguimiento',
  anticipo_pagado: 'Anticipo pagado', pedido_liberado: 'Pedido liberado',
  saldo_pagado: 'Saldo pagado', producto_entregado: 'Producto entregado',
  no_util: 'No útil', perdida: 'Perdida',
};

// Asignar vendedor a una tarjeta No Asignado desde el tablero (issue #57): la
// PRIMERA accion de tarjeta (el tablero era solo-lectura hasta #53). Lee el
// vendedor del selector que pinto buildAsignarControlHtml y llama PATCH
// /api/prospectos/:id/asignar; el servidor aplica la regla de dominio
// (no_asignado -> por_cotizar) y la tarjeta se mueve al recargar el pipeline.
async function asignarVendedorTablero(id) {
  const sel = document.getElementById(`asignar-vendedor-${id}`);
  const vendedor = sel?.value;
  if (!vendedor) { avisoTablero('Elige un vendedor para asignar'); return; }
  try {
    const res = await api(`/api/prospectos/${id}/asignar`, { method: 'PATCH', body: { vendedor } });
    if (!res.ok) {
      let data = {};
      try { data = await res.json(); } catch {}
      avisoTablero(data.error || 'No se pudo asignar');
      return;
    }
    avisoTablero(`Asignado a ${vendedor}`);
    showPipeline();
  } catch (e) {
    avisoTablero('Error de conexion');
  }
}
window.asignarVendedorTablero = asignarVendedorTablero;

// Mover a Seguimiento a mano desde el tablero (issue #56): el vendedor cotizo POR
// FUERA (directo en Operam), asi que captura el folio de Operam y la tarjeta pasa
// de Por Cotizar a Seguimiento. Captura minima con prompt(); el guard del frontend
// rechaza un folio vacio (sin pegarle al servidor) y la ruta vuelve a validarlo
// server-side. El folio se guarda en el prospecto (data.folioOperam). La tarjeta
// se mueve al recargar el pipeline.
async function moverASeguimientoTablero(id) {
  const folio = (prompt('Numero de cotizacion de Operam (folio):') || '').trim();
  if (!folio) { avisoTablero('El folio de Operam es obligatorio para mover a Seguimiento'); return; }
  try {
    const res = await api(`/api/prospectos/${id}/etapa`, { method: 'PATCH', body: { etapa: 'seguimiento', folio } });
    if (!res.ok) {
      let data = {};
      try { data = await res.json(); } catch {}
      avisoTablero(data.error || 'No se pudo mover a Seguimiento');
      return;
    }
    avisoTablero(`Movido a Seguimiento (folio ${folio})`);
    showPipeline();
  } catch (e) {
    avisoTablero('Error de conexion');
  }
}
window.moverASeguimientoTablero = moverASeguimientoTablero;

// Salidas del embudo desde la tarjeta del tablero (issue #59, Modelo A). El
// control pinta el id numerico (refId); aqui se ubica la oportunidad por ese id
// para conocer su tipo (la salida de un prospecto y la de una cotizacion pegan a
// rutas distintas).
function oportunidadDeTablero(tipo, id) {
  return ultimasOportunidades.find(o => o.tipo === tipo && (o.refId ?? o.id) === id);
}

// No util (solo PROSPECTOS, Modelo A): exige un motivo del catalogo. Si el select
// quedo vacio, NO se llama al servidor y la tarjeta se queda donde esta (AC4:
// cancelar regresa la tarjeta a su columna sin tocar el servidor). El servidor
// vuelve a validar el motivo (catalogo cerrado).
async function marcarNoUtilTablero(id) {
  const motivo = document.getElementById(`salida-motivo-${id}`)?.value;
  if (!motivo) { avisoTablero('Elige el motivo de No útil (catálogo cerrado)'); return; }
  try {
    const res = await api(`/api/prospectos/${id}/etapa`, { method: 'PATCH', body: { etapa: 'no_util', motivo } });
    if (!res.ok) {
      let data = {};
      try { data = await res.json(); } catch {}
      avisoTablero(data.error || 'No se pudo registrar la salida');
      return;
    }
    avisoTablero(`Salida a No útil (${motivo})`);
    showPipeline();
  } catch (e) {
    avisoTablero('Error de conexion');
  }
}
window.marcarNoUtilTablero = marcarNoUtilTablero;

// Perdida (prospecto o cotizacion): pide confirmacion (AC2). Si el vendedor
// cancela la confirmacion, no se llama al servidor. El prospecto cierra via
// PATCH .../etapa {perdida}; la cotizacion via PATCH .../estado {perdida} (ruta
// existente, Modelo A: una cotizacion sale del embudo solo por Perdida).
async function cerrarPerdidaTablero(id) {
  const o = oportunidadDeTablero('prospecto', id) || oportunidadDeTablero('cotizacion', id);
  const nombre = o ? (o.nombre || 'esta oportunidad') : 'esta oportunidad';
  if (!confirm(`¿Cerrar como Perdida ${nombre}? Sale del tablero y queda en el historial.`)) return;
  const esCot = o && o.tipo === 'cotizacion';
  const req = esCot
    ? api(`/api/cotizacion/${id}/estado`, { method: 'PATCH', body: { estado: 'perdida' } })
    : api(`/api/prospectos/${id}/etapa`, { method: 'PATCH', body: { etapa: 'perdida' } });
  try {
    const res = await req;
    if (!res.ok) {
      let data = {};
      try { data = await res.json(); } catch {}
      avisoTablero(data.error || 'No se pudo cerrar como Perdida');
      return;
    }
    avisoTablero('Cerrada como Perdida');
    showPipeline();
  } catch (e) {
    avisoTablero('Error de conexion');
  }
}
window.cerrarPerdidaTablero = cerrarPerdidaTablero;

// Producto decorado / calca (issue #61). Acciones de la tarjeta de cotizacion:
// marcar/desmarcar decorada (activa el checklist 0/6), togglear un paso del
// checklist y subir los archivos de posicion de calca a Dropbox (paso 6). El
// control pinta el id numerico (refId); las rutas esperan el id real de la
// cotizacion.
async function marcarDecorada(id, decorado) {
  try {
    const res = await api(`/api/cotizacion/${id}/decorado`, { method: 'PATCH', body: { decorado: !!decorado } });
    if (!res.ok) { avisoTablero('No se pudo actualizar decorada'); return; }
    showPipeline();
  } catch (e) { avisoTablero('Error de conexion'); }
}
window.marcarDecorada = marcarDecorada;

async function toggleCalcaPaso(id, paso, completo) {
  try {
    const res = await api(`/api/cotizacion/${id}/calca-paso`, { method: 'PATCH', body: { paso, completo: !!completo } });
    if (!res.ok) { avisoTablero('No se pudo actualizar el paso de calca'); return; }
    showPipeline();
  } catch (e) { avisoTablero('Error de conexion'); }
}
window.toggleCalcaPaso = toggleCalcaPaso;

function leerArchivoBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

// Sube la posicion de calca a Dropbox y marca el paso 6. La subida es
// fire-and-forget en el servidor: un fallo de Dropbox no impide marcar el paso.
async function subirCalcaArchivos(id) {
  const input = document.getElementById(`calca-archivos-${id}`);
  const files = input && input.files ? Array.from(input.files) : [];
  if (!files.length) { avisoTablero('Elige los archivos de posicion de calca'); return; }
  try {
    const archivos = await Promise.all(files.map(async f => ({ nombre: f.name, contenidoBase64: await leerArchivoBase64(f) })));
    const res = await api(`/api/cotizacion/${id}/calca-paso`, { method: 'PATCH', body: { paso: 'archivos_dropbox', completo: true, archivos } });
    if (!res.ok) { avisoTablero('No se pudo subir la posicion de calca'); return; }
    avisoTablero('Archivos enviados a Dropbox');
    showPipeline();
  } catch (e) { avisoTablero('Error de conexion'); }
}
window.subirCalcaArchivos = subirCalcaArchivos;

function setModoPipeline(modo) {
  pipelineModo = modo;
  localStorage.setItem('pipelineModo', modo);
  renderPipeline();
}

function ocultarTodasLasVistas() {
  for (const v of ['app-view', 'historial-view', 'hoy-view', 'prospectos-view', 'pipeline-view', 'clientes-view', 'bandeja-view']) {
    const el = document.getElementById(v);
    if (el) el.style.display = 'none';
  }
  // Cualquier cambio de vista devuelve #panel-alta-cliente a su lugar en el paso
  // Cliente y resetea el estado del upgrade (#94): salir de la vista Clientes (o
  // navegar a cualquier otra) nunca puede dejar un modoUpgrade colgado que dispare
  // un PUT contra el cliente equivocado.
  devolverPanelACasa();
  cerrarMenuMas();
  cerrarMenuNuevo();
}

// Re-parenteo de #panel-alta-cliente (#94): el panel es UNICO (leccion #82, no se
// clona). Vive en el paso Cliente (#tab-cliente); la vista Clientes lo toma prestado
// con appendChild y lo devuelve a su posicion original al salir. _panelHome guarda
// esa posicion la primera vez que se mueve.
let _panelHome = null;

function moverPanelA(contenedor) {
  const panel = document.getElementById('panel-alta-cliente');
  if (!panel || !contenedor) return;
  if (!_panelHome) _panelHome = { parent: panel.parentNode, next: panel.nextSibling };
  contenedor.appendChild(panel);
}

function devolverPanelACasa() {
  const panel = document.getElementById('panel-alta-cliente');
  if (!panel) return;
  panel.style.display = 'none';
  altaCsfState.modoUpgrade = null; altaCsfState.upgradeOrigen = null;
  const banner = document.getElementById('alta-upgrade-banner');
  if (banner) { banner.innerHTML = ''; banner.style.display = 'none'; }
  if (!_panelHome) return;
  const { parent, next } = _panelHome;
  if (!parent) return;
  if (next && next.parentNode === parent) parent.insertBefore(panel, next);
  else parent.appendChild(panel);
}

function marcarNavActivo(id) {
  document.querySelectorAll('.bottom-nav-btn').forEach(b => b.classList.toggle('activo', b.id === id));
}

function cerrarMenuMas() {
  const menu = document.getElementById('nav-mas-menu');
  if (menu) menu.style.display = 'none';
}

function cerrarMenuNuevo() {
  const menu = document.getElementById('nav-nuevo-menu');
  if (menu) menu.style.display = 'none';
}

async function cargarMotivosNoUtil() {
  const cont = document.getElementById('prospectos-no-util-admin');
  if (!cont || state.user.role !== 'admin') return;
  try {
    const res = await api('/api/admin/prospectos/no-util');
    if (!res.ok) return;
    const conteo = await res.json();
    document.getElementById('prospectos-no-util-list').innerHTML = buildMotivosNoUtilHtml(conteo);
    cont.style.display = 'block';
  } catch (e) { /* sin red no hay conteo */ }
}

// El tablero kanban del modelo previo se movio al destino Pipeline (tablero
// unico de 7 etapas, issue #53). La pantalla de prospectos queda como lista de
// captura + cola "Que toca hoy", accesible desde "Mas".
let ultimosProspectos = [];
let ultimaColaProspectos = [];

async function cargarListaProspectos() {
  const loadingEl = document.getElementById('prospectos-loading');
  const colaSeccion = document.getElementById('prospectos-cola-seccion');
  loadingEl.style.display = 'block';
  document.getElementById('prospectos-list').innerHTML = '';
  try {
    const [res, resCola] = await Promise.all([
      api('/api/prospectos'),
      api('/api/prospectos/cola'),
    ]);
    ultimosProspectos = await res.json();
    ultimaColaProspectos = resCola.ok ? await resCola.json() : [];
    loadingEl.style.display = 'none';
    colaSeccion.style.display = ultimosProspectos.length ? 'block' : 'none';
    document.getElementById('prospectos-cola').innerHTML = buildColaProspectosHtml(ultimaColaProspectos);
    renderProspectos();
  } catch (e) {
    loadingEl.textContent = 'Error cargando prospectos';
  }
}

function renderProspectos() {
  const listEl = document.getElementById('prospectos-list');
  const tituloEl = document.getElementById('prospectos-list-titulo');
  tituloEl.style.display = ultimosProspectos.length ? 'block' : 'none';
  const colaPorId = new Map(ultimaColaProspectos.map(i => [i.id, i]));
  if (!ultimosProspectos.length) {
    listEl.innerHTML = '<div class="empty-state"><p>Sin prospectos capturados.</p></div>';
    return;
  }
  listEl.innerHTML = ultimosProspectos.slice().reverse()
    .map(p => buildProspectoCardHtml(p, colaPorId.get(p.id), new Date(), { compacta: true })).join('');
}

// === HOY (issue #64, ADR-0005 "Cola Hoy"): el destino Hoy muestra la cola UNICA
// del dia, fusionada: prospectos en Por Cotizar (horas habiles) + cotizaciones en
// Seguimiento (dias naturales), en un solo orden por urgencia relativa al umbral
// de cada tipo. El backend (lib/cola-hoy.js via GET /api/hoy) ya fusiona y ordena;
// el frontend solo pinta con buildColaHoyHtml, que delega por tipo (prospecto =
// buildColaProspectosHtml; cotizacion = buildColaCotizacionItemHtml).
async function showHoy() {
  ocultarTodasLasVistas();
  document.getElementById('hoy-view').style.display = 'block';
  const loadingEl = document.getElementById('hoy-loading');
  const colaEl = document.getElementById('hoy-cola');
  loadingEl.style.display = 'block';
  colaEl.innerHTML = '';
  try {
    const res = await api('/api/hoy');
    const cola = res.ok ? await res.json() : [];
    loadingEl.style.display = 'none';
    actualizarBadgeSeguimiento(cola.length);
    colaEl.innerHTML = buildColaHoyHtml(cola);
  } catch (e) {
    loadingEl.textContent = 'Error cargando la cola de hoy';
  }
}

// Tras una accion sobre un prospecto, refresca la vista visible (Hoy o la lista
// de Prospectos en Mas) sin asumir desde donde se disparo.
function refrescarProspectos() {
  if (document.getElementById('hoy-view')?.style.display === 'block') {
    showHoy();
  } else {
    cargarListaProspectos();
  }
}

// Drag & drop generico de tableros kanban (issues #49 y #50): HTML5 nativo,
// sin librerias. Las columnas llevan data-<atributo> y las tarjetas data-id +
// data-<atributo>; la validez la decide puedeSoltar (logica pura) y alSoltar
// ejecuta el movimiento. Soltar en la columna de origen es un no-op silencioso;
// un drop invalido no llama al servidor -- la tarjeta no se mueve y se avisa.
function initDragEnTablero(containerId, { atributo, puedeSoltar, alSoltar }) {
  const tablero = document.getElementById(containerId);
  let dragOrigen = null;
  tablero.addEventListener('dragstart', e => {
    const card = e.target.closest('.tablero-card');
    if (!card || card.getAttribute('draggable') !== 'true') return;
    dragOrigen = { id: parseInt(card.dataset.id, 10), col: card.dataset[atributo] };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', card.dataset.id);
    tablero.querySelectorAll('.tablero-col').forEach(c => {
      const destino = c.dataset[atributo];
      c.classList.toggle('drop-valido', destino !== dragOrigen.col && puedeSoltar(dragOrigen.col, destino));
    });
    tablero.classList.add('arrastrando');
  });
  tablero.addEventListener('dragover', e => {
    const col = e.target.closest('.tablero-col');
    if (!col || !dragOrigen) return;
    e.preventDefault();
    const valido = puedeSoltar(dragOrigen.col, col.dataset[atributo]);
    e.dataTransfer.dropEffect = valido ? 'move' : 'none';
    col.classList.toggle('drop-ok', valido);
  });
  tablero.addEventListener('dragleave', e => {
    const col = e.target.closest('.tablero-col');
    if (col) col.classList.remove('drop-ok');
  });
  tablero.addEventListener('drop', e => {
    const col = e.target.closest('.tablero-col');
    if (!col || !dragOrigen) return;
    e.preventDefault();
    col.classList.remove('drop-ok');
    const origen = dragOrigen;
    dragOrigen = null;
    if (col.dataset[atributo] === origen.col) return;
    alSoltar(origen, col.dataset[atributo]);
  });
  tablero.addEventListener('dragend', () => {
    dragOrigen = null;
    tablero.classList.remove('arrastrando');
    tablero.querySelectorAll('.tablero-col').forEach(c => c.classList.remove('drop-ok', 'drop-valido'));
  });
}

// Selector de motivo al soltar en No util: mismo patron que el modal de
// canal de #46. Cancelar resuelve null y la tarjeta se queda donde estaba.
function pedirMotivoNoUtil() {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:1000';
    overlay.innerHTML = buildMotivoNoUtilModalHtml();
    document.body.appendChild(overlay);
    const cerrar = motivo => { overlay.remove(); resolve(motivo); };
    document.getElementById('motivo-tablero-confirmar').addEventListener('click', () => {
      const motivo = document.getElementById('motivo-tablero-select').value;
      if (!MOTIVOS_NO_UTIL.includes(motivo)) {
        const errEl = document.getElementById('motivo-tablero-error');
        errEl.textContent = 'El motivo de No útil es obligatorio (catálogo cerrado)';
        errEl.style.display = 'block';
        return;
      }
      cerrar(motivo);
    });
    document.getElementById('motivo-tablero-cancelar').addEventListener('click', () => cerrar(null));
  });
}

function avisoTablero(msg) {
  const aviso = document.createElement('div');
  aviso.className = 'tablero-aviso';
  aviso.textContent = msg;
  document.body.appendChild(aviso);
  setTimeout(() => aviso.remove(), 2500);
}

function leerFormularioProspecto() {
  const val = id => document.getElementById(id)?.value;
  return buildProspectoPayload({
    celularCode: val('pr-celular-code'),
    celular: val('pr-celular'),
    nombre: val('pr-nombre'),
    ciudad: val('pr-ciudad'),
    canal: val('pr-canal'),
    empresa: val('pr-empresa'),
    segmento_id: val('pr-segmento'),
    piezas_estimadas: val('pr-piezas'),
    correo: val('pr-correo'),
    temperatura: document.getElementById('pr-temperatura')?.dataset.valor,
    notas: val('pr-notas'),
  });
}

function pintarTemperatura(valor) {
  const cont = document.getElementById('pr-temperatura');
  if (!cont) return;
  cont.dataset.valor = valor || '';
  cont.querySelectorAll('.pr-estrella').forEach(s => {
    s.textContent = Number(s.dataset.v) <= Number(valor || 0) ? '★' : '☆';
  });
}

function mostrarErrorProspecto(msg) {
  const errEl = document.getElementById('pr-error');
  errEl.textContent = msg || '';
  errEl.style.display = msg ? 'block' : 'none';
}

function limpiarFormularioProspecto() {
  ['pr-celular', 'pr-nombre', 'pr-ciudad', 'pr-empresa', 'pr-correo', 'pr-notas',
    'pr-canal', 'pr-segmento', 'pr-piezas'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  pintarTemperatura('');
  mostrarErrorProspecto(null);
  document.getElementById('pr-existente').innerHTML = '';
}

async function guardarProspecto() {
  mostrarErrorProspecto(null);
  document.getElementById('pr-existente').innerHTML = '';
  const payload = leerFormularioProspecto();
  const error = validarProspectoBody(payload);
  if (error) { mostrarErrorProspecto(error); return; }
  try {
    const res = await api('/api/prospectos', { method: 'POST', body: payload });
    if (res.status === 409) {
      const data = await res.json();
      mostrarErrorProspecto(data.error || 'Este celular ya es un prospecto');
      document.getElementById('pr-existente').innerHTML = buildProspectoExistenteHtml(data);
      return;
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      mostrarErrorProspecto(data.error || 'No se pudo guardar el prospecto');
      return;
    }
    limpiarFormularioProspecto();
    document.getElementById('prospecto-form').style.display = 'none';
    cargarListaProspectos();
  } catch (e) {
    mostrarErrorProspecto('Error de conexion');
  }
}

// Trabajar el prospecto (issue #43): handlers de las acciones de la card.
async function patchEtapaProspecto(id, body, msgError) {
  try {
    const res = await api(`/api/prospectos/${id}/etapa`, { method: 'PATCH', body });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || msgError);
      return;
    }
    refrescarProspectos();
    cargarMotivosNoUtil();
  } catch (e) {
    alert('Error de conexion');
  }
}

function marcarNoUtilProspecto(id) {
  const sel = document.getElementById(`pr-motivo-${id}`);
  const motivo = sel ? sel.value : '';
  if (!motivo) { alert('Selecciona el motivo de No útil (catálogo cerrado)'); return; }
  patchEtapaProspecto(id, { etapa: 'no_util', motivo }, 'No se pudo registrar la salida');
}

async function registrarToqueProspecto(id) {
  try {
    const res = await api(`/api/prospectos/${id}/toques`, { method: 'POST' });
    if (!res.ok) { alert('No se pudo registrar el toque'); return; }
    refrescarProspectos();
  } catch (e) {
    alert('Error de conexion');
  }
}

function toggleHistorialProspecto(id) {
  const el = document.getElementById(`pr-historial-${id}`);
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

// Sugerencia de la cola tras 3 toques (issue #44): el vendedor confirma,
// nunca se aplica sola.
function sugerirNoUtilProspecto(id) {
  if (!confirm('3 toques sin respuesta. ¿Marcar este prospecto como No útil (sin respuesta)?')) return;
  patchEtapaProspecto(id, { etapa: 'no_util', motivo: 'sin respuesta' }, 'No se pudo registrar la salida');
}

// Reunion diagnostico (issue #45): agendar desde la card y registrar el
// resultado desde la cola cuando la reunion ya paso.
async function agendarReunionProspecto(id) {
  const input = document.getElementById(`pr-reunion-${id}`);
  const valor = input ? input.value : '';
  if (!valor) { alert('Selecciona fecha y hora de la reunión'); return; }
  try {
    const res = await api(`/api/prospectos/${id}/reunion`, {
      method: 'POST', body: { fecha: new Date(valor).toISOString() },
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || 'No se pudo agendar la reunión');
      return;
    }
    cargarListaProspectos();
  } catch (e) {
    alert('Error de conexion');
  }
}

async function resultadoReunionProspecto(id, resultado, motivo) {
  try {
    const res = await api(`/api/prospectos/${id}/reunion-resultado`, {
      method: 'POST', body: { resultado, motivo },
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || 'No se pudo registrar el resultado');
      return;
    }
    refrescarProspectos();
    cargarMotivosNoUtil();
  } catch (e) {
    alert('Error de conexion');
  }
}

function resultadoReunionNoUtilProspecto(id) {
  const sel = document.getElementById(`cola-motivo-${id}`);
  const motivo = sel ? sel.value : '';
  if (!motivo) { alert('Selecciona el motivo de No útil (catálogo cerrado)'); return; }
  resultadoReunionProspecto(id, 'no_util', motivo);
}

// Editar/complementar el prospecto desde su tarjeta (issue #66): el formulario
// inline viene en la card (oculto); abrirEdicionProspecto lo muestra/oculta y
// guardarEdicionProspecto lee los campos y persiste via PATCH /api/prospectos/:id.
function abrirEdicionProspecto(id) {
  const el = document.getElementById(`pr-edicion-${id}`);
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

const EDICION_OPCIONALES = ['empresa', 'segmento_id', 'piezas_estimadas', 'correo', 'temperatura', 'notas'];

async function guardarEdicionProspecto(id) {
  const val = campo => {
    const el = document.getElementById(`ed-${campo}-${id}`);
    return el ? el.value : undefined;
  };
  const body = { nombre: val('nombre'), ciudad: val('ciudad') };
  for (const k of EDICION_OPCIONALES) body[k] = val(k);
  const error = validarEdicionProspecto(body);
  if (error) { alert(error); return; }
  try {
    const res = await api(`/api/prospectos/${id}`, { method: 'PATCH', body });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || 'No se pudieron guardar los cambios');
      return;
    }
    cargarListaProspectos();
  } catch (e) {
    alert('Error de conexion');
  }
}

window.abrirEdicionProspecto = abrirEdicionProspecto;
window.guardarEdicionProspecto = guardarEdicionProspecto;
window.marcarNoUtilProspecto = marcarNoUtilProspecto;
window.registrarToqueProspecto = registrarToqueProspecto;
window.toggleHistorialProspecto = toggleHistorialProspecto;
window.sugerirNoUtilProspecto = sugerirNoUtilProspecto;
window.agendarReunionProspecto = agendarReunionProspecto;
window.resultadoReunionProspecto = resultadoReunionProspecto;
window.resultadoReunionNoUtilProspecto = resultadoReunionNoUtilProspecto;
window.cotizarProspecto = id => {
  const p = ultimosProspectos.find(x => x.id === id);
  if (!p) return;
  ocultarTodasLasVistas();
  document.getElementById('app-view').style.display = 'block';
  marcarNavActivo('nav-cotizar');
  switchTab('cliente');
  // Entra directo a la tarjeta del prospecto (variante B, #82).
  pcElegirProspecto(p);
  window.scrollTo({ top: 0, behavior: 'smooth' });
};
window.cerrarCotizacionTablero = async (id, estado) => {
  const cot = ultimasCotizaciones.find(c => c.id === id);
  const label = estado === 'ganada' ? 'Ganada' : 'Perdida';
  if (!confirm(`¿Marcar la cotización de ${cot ? cot.cliente : 'este cliente'} como ${label}?`)) return;
  try {
    const res = await api(`/api/cotizacion/${id}/estado`, { method: 'PATCH', body: { estado } });
    if (!res.ok) { alert('No se pudo actualizar el estado'); return; }
    recargarHistorial();
  } catch (e) {
    alert('Error de conexion');
  }
};
window.toggleAccionesProspecto = id => {
  const el = document.getElementById(`pr-acciones-${id}`);
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
};
window.abrirCapturaRapida = () => {
  const form = document.getElementById('prospecto-form');
  form.style.display = 'block';
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  document.getElementById('pr-celular').focus();
};

// Acciones del boton + global (issue #54). "Nueva cotizacion" reusa la unica
// funcion nuevaCotizacion (linea ~1412, expuesta a window ahi mismo -- #112:
// antes habia una segunda homonima aqui que solo navegaba). "Nuevo prospecto"
// abre la captura minima EXISTENTE: el formulario de prospecto que ya vive en
// la vista de Prospectos. No se reinventa la captura ni la cotizacion: el +
// solo enruta.
window.nuevoProspecto = () => {
  cerrarMenuNuevo();
  showProspectos();
  marcarNavActivo('nav-mas');
  abrirCapturaRapida();
};

// modo (#104, ADR-0008): 'actualizar' reusa el registro y el folio de Operam;
// 'nueva' es el comportamiento historico de "Cargar" (#83 F1), ahora con nombre
// honesto. El default es 'nueva' porque cualquier llamador que no elija explicitamente
// no debe terminar reescribiendo un documento que el cliente ya tiene.
// Descripcion editada de una partida guardada (#139), lista para el carrito. Solo la
// MARCADA se restaura: la de una partida sin marca es la del catalogo de ese momento
// y volver a meterla como texto propio la congelaria para siempre.
function descripcionRestaurada(item) {
  return item?.descripcionEditada && item?.descripcion ? { descripcion: item.descripcion } : {};
}

async function cargarCotizacion(id, modo = 'nueva') {
  try {
    const res = await api(`/api/cotizaciones/${id}`);
    if (!res.ok) { alert('No se pudo cargar la cotizacion'); return; }
    const cot = await res.json();

    // Poblar campos del cliente
    const c = cot.cliente || {};
    const campos = {
      'cl-razon-social': c.razonSocial || '',
      'cl-nombre-corto': c.nombreCorto || '',
      'cl-rfc': c.rfc || '',
      'cl-cp-fiscal': c.cpFiscal || '',
      'cl-nombre-entrega': c.nombreEntrega || '',
      'cl-calle': c.calle || '',
      'cl-num-int': c.numInt || '',
      'cl-colonia': c.colonia || '',
      'cl-cp-entrega': c.cpEntrega || '',
      'cl-municipio': c.municipio || '',
      'cl-estado': c.estado || '',
      'cl-email-entrega': c.emailEntrega || '',
      'cl-referencias': c.referencias || '',
      'cl-referencia': c.referencia || '',
    };
    for (const [id, val] of Object.entries(campos)) {
      const el = document.getElementById(id);
      if (el) el.value = val;
    }
    setTelefonoCampos('cl-telefono', 'cl-telefono-code', c.telefono || '');
    setTelefonoCampos('cl-cel-entrega', 'cl-cel-entrega-code', c.celEntrega || '');
    if (cot.condicionesPago) document.getElementById('cl-condiciones').value = cot.condicionesPago;
    const paisEl = document.getElementById('cl-pais');
    if (paisEl) paisEl.value = c.pais || 'MX';

    // Poblar carrito
    state.cart.clear();
    descripcionesAbiertas.clear();
    for (const item of (cot.items || [])) {
      if (item.codigo === 'ENVIO') continue;
      // La calca (#91) no vive en products ni en skus sino en el catalogo de
      // calcas: sin este caso la partida se perderia al Cargar en silencio, y
      // regenerar reescribiria el quote de Operam SIN la calca (#114).
      if (esCodigoCalca(item.codigo)) {
        const ficha = catalogoCalcas().find(c => c.code === item.codigo);
        if (ficha) state.cart.set(item.codigo, { product: productoCalca(ficha), cantidad: item.cantidad, descuento: item.descuento || 0, ...descripcionRestaurada(item) });
        continue;
      }
      // Intentar encontrar en SKUs o products
      const sku = state.precios.skus?.find(s => s.sku === item.codigo);
      const product = state.precios.products.find(p => p.key === item.codigo) ||
        (sku ? state.precios.products.find(p => p.key === sku.priceKey) : null);
      if (!product) continue;

      const cartProduct = sku ? {
        key: item.codigo,
        name: sku.nombre,
        model: sku.tipo + sku.tamano,
        weight_kg: product.weight_kg,
        prices: product.prices,
      } : product;

      // El descuento por linea se restaura junto con la cantidad (#137): sin el,
      // regenerar reescribiria el quote SIN la negociacion (mismo agujero que ya
      // mordio con la calca). La descripcion editada (#139), por lo mismo.
      state.cart.set(item.codigo, { product: cartProduct, cantidad: item.cantidad, descuento: item.descuento || 0, ...descripcionRestaurada(item) });
    }

    // Envio (issue #102): restaura carrier/servicio/precio tal cual se guardo,
    // sin re-cotizar con envia.com. Cotizaciones viejas sin envio estructurado
    // degradan a "sin seleccion" (restaurarEnvioDesdeCotizacion lo resuelve).
    const envioRestore = restaurarEnvioDesdeCotizacion(cot.envio);
    document.getElementById('shipping-option').value = envioRestore.opcion;
    document.getElementById('shipping-envia').style.display = envioRestore.mostrarEnvia ? 'block' : 'none';
    document.getElementById('shipping-manual').style.display = envioRestore.mostrarManual ? 'block' : 'none';
    document.getElementById('shipping-cost').value = envioRestore.cost;
    document.getElementById('shipping-desc').value = envioRestore.desc;
    // Confirmacion visual de la tarifa restaurada (hallazgo del code review):
    // sin esto el tab Envio se veia vacio para un envio via envia.com aunque el
    // valor ya estuviera bien restaurado para el Resumen/PDF.
    document.getElementById('envia-results').innerHTML = envioRestore.enviaRateSeleccionado?.carrier
      ? buildEnviaRateRestauradaHtml(envioRestore.enviaRateSeleccionado)
      : '';
    document.getElementById('envia-error').style.display = 'none';
    document.getElementById('envia-resumen').style.display = 'none';
    enviaRateSeleccionado = envioRestore.enviaRateSeleccionado;
    envioInvalidadoPorCantidad = false;
    envioDescuento = envioRestore.descuento || 0;

    // Notas y vigencia
    if (cot.notas) document.getElementById('resumen-notas').value = cot.notas.map(n => `- ${n}`).join('\n');

    // La marca de decorado viaja con la cotizacion (#91): se restaura tal cual
    // se guardo para no apagarla al Cargar. Con calca en el carrito la
    // sincronizacion la vuelve a fijar de todos modos (ADR-0010).
    decoradoManual = cot.decorado === true;

    // Que pasa al generar desde aqui (#104, ADR-0008 -- revierte de forma explicita
    // la decision de #83 F1, que reseteaba esto siempre):
    //   'nueva'      -> sesion nueva: se crea otro registro y otro quote en Operam.
    //   'actualizar' -> se reusa el mismo registro (cotizacionId) y se reescribe el
    //                   quote existente conservando el folio.
    // El gate de que "actualizar" sea siquiera ofrecible lo decide el historial
    // (puedeActualizarCotizacion) y lo hace valer el servidor.
    state.modoActualizacion = modo === 'actualizar';
    state.lastCotizacionId = state.modoActualizacion ? String(id) : null;
    // #113: cargar OTRA cotizacion es exactamente cuando puede cambiar quien queda
    // estampado, asi que la confirmacion se vuelve a pedir en los dos modos.
    state.vendedorConfirmado = false;
    const operamStatus = document.getElementById('operam-status-cotizar');
    if (operamStatus) {
      // folioOperam viaja en la respuesta del detalle (#109): el gate de
      // "Actualizar cotizacion" (puedeActualizarCotizacion) ya exige que exista,
      // asi que aqui siempre esta presente en modo actualizacion.
      operamStatus.innerHTML = state.modoActualizacion
        ? buildAvisoModoActualizacion(cot.folioOperam)
        : '';
    }
    // Etiquetas de los botones (#109): en modo actualizacion comunican que
    // reescriben el documento/quote existente, no que crean uno nuevo.
    aplicarEtiquetasBotonesGenerar();

    // Volver a la app
    document.getElementById('historial-view').style.display = 'none';
    document.getElementById('app-view').style.display = 'block';
    switchTab('productos');
    updateTierBar();
    updateCartSummary();
    updateResumen();
    renderProducts();
    renderFlujoGuiado();
    renderCartLines();
  } catch (e) {
    alert('Error al cargar: ' + e.message);
  }
}

window.cargarCotizacion = cargarCotizacion;

// === INIT ===
document.addEventListener('DOMContentLoaded', async () => {
  await loadVendedores();

  document.getElementById('login-btn').addEventListener('click', login);
  document.getElementById('login-pin').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
  document.getElementById('logout-btn').addEventListener('click', logout);

  // Tabs
  document.querySelectorAll('.tab').forEach(t =>
    t.addEventListener('click', () => switchTab(t.dataset.tab))
  );

  // Search con dropdown tipo Operam
  const searchInput = document.getElementById('search-input');
  searchInput.addEventListener('input', e => renderSearchDropdown(e.target.value));
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.getElementById('search-dropdown').style.display = 'none';
      searchInput.value = '';
    }
  });
  searchInput.addEventListener('blur', () => {
    setTimeout(() => {
      const dd = document.getElementById('search-dropdown');
      if (dd) dd.style.display = 'none';
    }, 150);
  });

  // Tab indicator para cliente y envio (el bloque de entrega vive en Envio, #84)
  document.getElementById('tab-cliente').addEventListener('input', updateTabIndicators);
  document.getElementById('tab-envio').addEventListener('input', () => { pcRenderChips(); updateTabIndicators(); });

  // Botones Siguiente
  document.getElementById('btn-sig-cliente').addEventListener('click', () => switchTab('productos'));
  document.getElementById('btn-sig-productos').addEventListener('click', () => switchTab('envio'));
  document.getElementById('btn-sig-envio').addEventListener('click', () => switchTab('resumen'));

  // Shipping option toggle
  document.getElementById('shipping-option').addEventListener('change', e => {
    const val = e.target.value;
    document.getElementById('shipping-envia').style.display = val === 'envia' ? 'block' : 'none';
    document.getElementById('shipping-manual').style.display = val === 'manual' ? 'block' : 'none';
    // Limpiar costo si cambia la opción
    if (val !== 'envia' && val !== 'manual') {
      document.getElementById('shipping-cost').value = '';
    }
    // Salir de "envia" descarta la invalidacion por cantidad (issue #89): ya no
    // aplica, el envio activo dejo de depender de una tarifa de envia.com.
    if (val !== 'envia') envioInvalidadoPorCantidad = false;
    updateResumen();
    updateTabIndicators();
  });
  document.getElementById('btn-cotizar-envia').addEventListener('click', cotizarEnvia);
  document.getElementById('cl-cp-entrega').addEventListener('keydown', e => { if (e.key === 'Enter') cotizarEnvia(); });
  document.getElementById('shipping-cost').addEventListener('input', () => updateResumen());
  document.getElementById('shipping-desc').addEventListener('input', () => updateResumen());

  // Nota de tiempo de entrega (#90): togglear el checkbox actualiza SOLO esa
  // linea del textarea de notas, sin pisotear ediciones manuales del vendedor.
  // Desde #91 el checkbox tambien lleva la marca de decorado del vendedor
  // (decoradoManual); con calca en el carrito va disabled y no llega aqui.
  document.getElementById('resumen-decorado').addEventListener('change', e => {
    decoradoManual = e.target.checked;
    const notasEl = document.getElementById('resumen-notas');
    notasEl.value = aplicarNotaTiempoEntrega(notasEl.value, e.target.checked);
    sincronizarMarcaDecorado();
  });

  // Calcas (issue #91): el selector recalcula codigo y precio; agregar mete la
  // partida al carrito. Sin onclick inline a proposito -- la trampa de #112.
  document.getElementById('cal-tamano')?.addEventListener('change', renderCalcas);
  document.getElementById('cal-tintas')?.addEventListener('change', renderCalcas);
  document.getElementById('btn-agregar-calca')?.addEventListener('click', agregarCalca);

  // PDF, HTML & WhatsApp
  document.getElementById('btn-pdf').addEventListener('click', generatePDF);
  document.getElementById('btn-html').addEventListener('click', generateHTML);
  document.getElementById('btn-whatsapp').addEventListener('click', shareWhatsApp);
  document.getElementById('btn-nueva').addEventListener('click', nuevaCotizacion);

  // Navegacion inferior (bottom-nav, issue #53): Cotizar / Hoy / Pipeline / Mas.
  // Pipeline esta vivo (tablero unico de 7 etapas); los demas enlazan por ahora
  // a las pantallas existentes. La app abre en Cotizar.
  document.getElementById('nav-cotizar')?.addEventListener('click', () => {
    ocultarTodasLasVistas();
    document.getElementById('app-view').style.display = 'block';
    marcarNavActivo('nav-cotizar');
  });
  document.getElementById('nav-hoy')?.addEventListener('click', () => {
    showHoy();
    marcarNavActivo('nav-hoy');
  });
  document.getElementById('nav-pipeline')?.addEventListener('click', () => {
    showPipeline();
    marcarNavActivo('nav-pipeline');
  });
  document.getElementById('nav-mas')?.addEventListener('click', () => {
    cerrarMenuNuevo();
    const menu = document.getElementById('nav-mas-menu');
    if (menu) menu.style.display = menu.style.display === 'none' ? 'flex' : 'none';
  });
  // Boton + global (issue #54): visible en todos los destinos; ofrece "Nueva
  // cotizacion" y "Nuevo prospecto". El menu se arma con la logica pura
  // (buildMenuNuevoHtml); cada boton dispara la funcion global homonima.
  document.getElementById('nav-add')?.addEventListener('click', () => {
    cerrarMenuMas();
    const menu = document.getElementById('nav-nuevo-menu');
    if (!menu) return;
    if (menu.style.display === 'none') {
      menu.innerHTML = buildMenuNuevoHtml();
      menu.style.display = 'flex';
    } else {
      menu.style.display = 'none';
    }
  });
  document.getElementById('mas-historial')?.addEventListener('click', () => { cerrarMenuMas(); marcarNavActivo('nav-mas'); showHistorial(); });
  document.getElementById('mas-prospectos')?.addEventListener('click', () => { cerrarMenuMas(); marcarNavActivo('nav-mas'); showProspectos(); });
  document.getElementById('mas-clientes')?.addEventListener('click', () => { cerrarMenuMas(); showClientes(); });
  document.getElementById('mas-rescatados')?.addEventListener('click', () => { cerrarMenuMas(); showBandeja(); });
  document.getElementById('btn-volver-bandeja')?.addEventListener('click', () => {
    ocultarTodasLasVistas();
    document.getElementById('app-view').style.display = 'block';
    marcarNavActivo('nav-cotizar');
  });
  document.getElementById('btn-volver-clientes')?.addEventListener('click', () => {
    ocultarTodasLasVistas();
    document.getElementById('app-view').style.display = 'block';
    marcarNavActivo('nav-cotizar');
  });
  document.getElementById('btn-pipeline-modo-lista')?.addEventListener('click', () => setModoPipeline('lista'));
  document.getElementById('btn-pipeline-modo-tablero')?.addEventListener('click', () => setModoPipeline('tablero'));
  document.getElementById('btn-pipeline-modo-cerradas')?.addEventListener('click', () => setModoPipeline('cerradas'));

  // Volver a Cotizar desde Historial (la navegacion vive en el bottom-nav, issue #53)
  document.getElementById('btn-volver-app').addEventListener('click', () => {
    ocultarTodasLasVistas();
    document.getElementById('app-view').style.display = 'block';
    marcarNavActivo('nav-cotizar');
  });
  document.getElementById('btn-cot-modo-lista').addEventListener('click', () => setModoCotizaciones('lista'));
  document.getElementById('btn-cot-modo-tablero').addEventListener('click', () => setModoCotizaciones('tablero'));
  // Buscador del Historial (#146): filtra en vivo al teclear, sin ida al
  // servidor (el listado completo ya esta en memoria).
  document.getElementById('historial-buscar').addEventListener('input', e => {
    cotizacionesFiltro.texto = e.target.value;
    renderHistorial();
  });
  // Rango de fechas Desde/Hasta (#148): se combina con AND con el texto via
  // el mismo criterio de filtrarCotizaciones.
  document.getElementById('historial-desde').addEventListener('input', e => {
    cotizacionesFiltro.desde = e.target.value;
    renderHistorial();
  });
  document.getElementById('historial-hasta').addEventListener('input', e => {
    cotizacionesFiltro.hasta = e.target.value;
    renderHistorial();
  });
  initDragEnTablero('cotizaciones-tablero', {
    atributo: 'col',
    puedeSoltar: puedeArrastrarCotizacion,
    alSoltar: soltarEnColumnaCotizacion,
  });

  // Volver a Cotizar desde Hoy
  document.getElementById('btn-volver-hoy')?.addEventListener('click', () => {
    ocultarTodasLasVistas();
    document.getElementById('app-view').style.display = 'block';
    marcarNavActivo('nav-cotizar');
  });

  // Volver a Cotizar desde Prospectos
  document.getElementById('btn-volver-prospectos').addEventListener('click', () => {
    ocultarTodasLasVistas();
    document.getElementById('app-view').style.display = 'block';
    marcarNavActivo('nav-cotizar');
  });
  document.getElementById('btn-nuevo-prospecto').addEventListener('click', () => {
    const form = document.getElementById('prospecto-form');
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
  });
  document.getElementById('btn-guardar-prospecto').addEventListener('click', guardarProspecto);
  document.getElementById('pr-temperatura').addEventListener('click', e => {
    const v = e.target.dataset ? e.target.dataset.v : null;
    if (!v) return;
    const actual = document.getElementById('pr-temperatura').dataset.valor;
    pintarTemperatura(v === actual ? '' : v);
  });

  // Selector de pais: adapta formulario para clientes extranjeros
  const clPaisEl = document.getElementById('cl-pais');
  if (clPaisEl) {
    clPaisEl.addEventListener('change', () => {
      const pais = clPaisEl.value;
      const esExtranjero = pais !== 'MX';
      const rfcInput = document.getElementById('cl-rfc');
      const taxIdExtWrap = document.getElementById('cl-tax-id-ext-wrap');

      if (esExtranjero) {
        if (rfcInput) { rfcInput.value = 'XEXX010101000'; rfcInput.readOnly = true; }
        if (taxIdExtWrap) taxIdExtWrap.style.display = '';
      } else {
        if (rfcInput) { rfcInput.value = ''; rfcInput.readOnly = false; }
        if (taxIdExtWrap) taxIdExtWrap.style.display = 'none';
      }
    });
  }

  // Auto-login if token exists
  if (state.token && state.user) {
    try {
      await showApp();
    } catch {
      logout();
    }
  }
});

// === ACORDEON ALTA CLIENTE (issue #27) ===

const altaState = {
  seccionAbierta: null,
  catalogos: null,
};

async function cargarCatalogos() {
  if (altaState.catalogos) return altaState.catalogos;
  const res = await api('/api/catalogos');
  altaState.catalogos = await res.json();
  return altaState.catalogos;
}

function altaPoblarSelectores(catalogos) {
  const selLista = document.getElementById('alta-lista-precios');
  const selSeg = document.getElementById('alta-segmento');
  const selVend = document.getElementById('alta-vendedor');
  if (!selLista || !selSeg || !selVend) return;

  selLista.innerHTML = '<option value="">-- Selecciona --</option>' +
    catalogos.listas_precios.map(l => `<option value="${l.id}">${l.nombre}</option>`).join('');

  selSeg.innerHTML = '<option value="">-- Selecciona --</option>' +
    catalogos.segmentos.map(s => `<option value="${s.id}">${s.nombre}</option>`).join('');

  selVend.innerHTML = '<option value="">-- Selecciona --</option>' +
    catalogos.vendedores.map(v => `<option value="${v.operam_id}">${v.name}</option>`).join('');
}

function abrirAcordeonAlta() {
  const panel = document.getElementById('panel-alta-cliente');
  if (!panel) return;
  const visible = panel.style.display !== 'none';
  if (visible) {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = 'block';
  // Este camino es el de "cliente formal nuevo" (POST), nunca el upgrade fiscal
  // (#85): si un intento de upgrade anterior quedo colgado en altaCsfState.modoUpgrade
  // (p. ej. tras un error sin cerrar el panel), confirmar aqui NO debe aplicarse sobre
  // ese customer_id viejo.
  altaCsfState.modoUpgrade = null; altaCsfState.upgradeOrigen = null;
  const bannerEl = document.getElementById('alta-upgrade-banner');
  if (bannerEl) { bannerEl.innerHTML = ''; bannerEl.style.display = 'none'; }
  altaToggleSeccion(1);
  cargarCatalogos().then(altaPoblarSelectores).catch(() => {});
}

function altaToggleSeccion(n) {
  const sec = document.getElementById(`alta-sec-${n}`);
  if (sec && sec.classList.contains('alta-seccion-bloqueada')) return;

  const prev = altaState.seccionAbierta;
  altaState.seccionAbierta = (prev === n) ? null : n;

  [1, 2, 3, 4].forEach(i => {
    const s = document.getElementById(`alta-sec-${i}`);
    const body = document.getElementById(`alta-body-${i}`);
    const ico = document.getElementById(`alta-ico-${i}`);
    if (!s || !body) return;
    const isOpen = altaState.seccionAbierta === i;
    const isLocked = s.classList.contains('alta-seccion-bloqueada');
    body.style.display = isOpen ? 'block' : 'none';
    s.classList.toggle('alta-sec-activa', isOpen);
    if (ico && !isLocked) ico.textContent = isOpen ? '-' : '+';
  });
}

window.abrirAcordeonAlta = abrirAcordeonAlta;
window.altaToggleSeccion = altaToggleSeccion;

// === CSF DROPZONE — Seccion 1 (issue #28) ===

const altaCsfState = {
  status: 'idle',
  rfc: null,
  fileName: null,
  mensaje: null,
  datos: null,
  modoUpgrade: null, // customer_id destino cuando el flujo CSF se abre en modo upgrade (#85)
  pdfBase64: null,
};

function altaCsfSetStatus(status, opts = {}) {
  altaCsfState.status = status;
  const dropzone = document.getElementById('csf-dropzone');
  const spinner = document.getElementById('csf-spinner');
  const bannerOk = document.getElementById('csf-banner-ok');
  const bannerErr = document.getElementById('csf-banner-err');
  const detalles = document.getElementById('csf-detalles');

  if (dropzone) dropzone.style.display = status === 'idle' ? '' : 'none';
  if (spinner) spinner.style.display = status === 'loading' ? '' : 'none';
  if (bannerOk) bannerOk.style.display = status === 'success' ? '' : 'none';
  if (bannerErr) bannerErr.style.display = status === 'error' ? '' : 'none';
  if (detalles) detalles.style.display = status === 'success' ? '' : 'none';

  if (status === 'loading') {
    const txt = document.getElementById('csf-spinner-text');
    if (txt) txt.textContent = opts.spinnerText || 'Extrayendo RFC, razon social, domicilio fiscal, regimen, SAT IdCIF...';
  }
  if (status === 'success') {
    const txt = document.getElementById('csf-banner-txt');
    if (txt) txt.textContent = opts.bannerText || '';
  }
  if (status === 'error') {
    const txt = document.getElementById('csf-banner-err-txt');
    if (txt) txt.textContent = opts.mensaje || 'Error al procesar el PDF';
  }
}

function altaCsfPonerDatos(datos) {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
  set('csf-razon-social', datos.razonSocial);
  set('csf-rfc', datos.rfc);
  set('csf-nombre-corto', datos.nombreCorto);
  set('csf-idcif', datos.idcif);
  set('csf-regimen-fiscal', datos.regimenFiscal);
  const regLabel = document.getElementById('csf-regimen-fiscal-label');
  if (regLabel) regLabel.textContent = datos.regimenFiscalLabel || '';
  set('csf-calle', datos.calle);
  set('csf-num-ext', datos.numExt);
  set('csf-num-int', datos.numInt);
  set('csf-colonia', datos.colonia);
  set('csf-cp', datos.cp);
  set('csf-municipio', datos.municipio);
  set('csf-estado', datos.estado);
}

// Parseo de CSF centralizado en el backend (lib/parsear-csf.js via POST /api/parsear-csf, issue #33/#34)
async function altaCsfParsearEnServidor(texto) {
  const r = await fetch('/api/parsear-csf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ texto }),
  });
  const json = await r.json();
  if (json && json.ok && json.datos) return { datos: json.datos };
  return { error: (json && json.error) || 'No se pudo parsear la CSF' };
}

async function altaCsfExtraerQR(pdfDoc) {
  if (typeof jsQR === 'undefined') return null;
  const totalPaginas = Math.min(pdfDoc.numPages, 2);
  for (let i = 1; i <= totalPaginas; i++) {
    const page = await pdfDoc.getPage(i);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    const imageData = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imageData.data, imageData.width, imageData.height);
    if (code && code.data && code.data.includes('sat.gob.mx')) return code.data;
  }
  return null;
}

function altaCsfExtraerIdCifDeUrl(url) {
  try {
    const u = new URL(url);
    for (const [, val] of u.searchParams) {
      const partes = val.split(/[_\-|]/);
      for (const p of partes) { if (/^\d{10,12}$/.test(p)) return p; }
    }
    const match = url.match(/\b(\d{10,12})\b/);
    return match ? match[1] : '';
  } catch { return ''; }
}

async function altaCsfLeerPDF(file) {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const totalPaginas = Math.min(pdf.numPages, 2);
  let textoTotal = '';
  let itemsTotal = 0;
  for (let i = 1; i <= totalPaginas; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent({ includeMarkedContent: true });
    itemsTotal += content.items.length;
    textoTotal += content.items.filter(it => it.str !== undefined).map(it => it.str).join(' ') + '\n';
  }
  if (itemsTotal === 0 || textoTotal.trim().length < 50) {
    const urlQR = await altaCsfExtraerQR(pdf);
    if (urlQR) {
      const token = window._authToken || localStorage.getItem('token') || '';
      const r = await fetch('/api/csf-from-url', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ url: urlQR }) });
      const data = await r.json();
      if (data.ok && data.texto) {
        const idcifDelQR = altaCsfExtraerIdCifDeUrl(urlQR);
        return idcifDelQR ? `idCIF: ${idcifDelQR}\n${data.texto}` : data.texto;
      }
    }
  }
  return textoTotal;
}

async function altaCsfProcesarArchivo(file) {
  altaCsfSetStatus('loading', { spinnerText: 'Extrayendo RFC, razon social, domicilio fiscal, regimen, SAT IdCIF...' });
  try {
    // Base64 del PDF para respaldarlo en Dropbox al confirmar el upgrade fiscal (#85).
    altaCsfState.pdfBase64 = await leerArchivoBase64(file).catch(() => null);
    const texto = await altaCsfLeerPDF(file);
    const respuesta = await altaCsfParsearEnServidor(texto);
    const resultado = altaCsfResultadoParseo(respuesta, file.name);
    altaCsfState.datos = resultado.datos;
    altaCsfPonerDatos(resultado.datos);
    altaCsfSetStatus(resultado.status, { bannerText: resultado.bannerText });
    if (resultado.datos.rfc) {
      altaCsfState.rfc = resultado.datos.rfc;
      altaCsfState.fileName = file.name;
    }
  } catch (err) {
    altaCsfSetStatus('error', { mensaje: 'Error al leer el PDF: ' + err.message });
  }
}

function altaCsfValidarCampos() {
  const getVal = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
  if (!getVal('csf-rfc')) return 'El RFC es obligatorio';
  if (!getVal('csf-razon-social')) return 'La razon social es obligatoria';
  if (!getVal('csf-nombre-corto')) return 'El nombre corto es obligatorio';
  return null;
}

function altaCsfLeerFormulario() {
  const getVal = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
  return {
    // Mayusculas como en altaManualLeerFormulario: el gate anti-fusion del upgrade
    // fiscal (#85) depende de comparar el mismo RFC contra Operam sin diferencias de case.
    rfc: getVal('csf-rfc').toUpperCase(),
    razonSocial: getVal('csf-razon-social'),
    nombreCorto: getVal('csf-nombre-corto'),
    idcif: getVal('csf-idcif'),
    regimenFiscal: getVal('csf-regimen-fiscal'),
    usoCfdi: getVal('csf-uso-cfdi'),
    calle: getVal('csf-calle'),
    numExt: getVal('csf-num-ext'),
    numInt: getVal('csf-num-int'),
    colonia: getVal('csf-colonia'),
    cp: getVal('csf-cp'),
    municipio: getVal('csf-municipio'),
    estado: getVal('csf-estado'),
    segmentoId: getVal('alta-upgrade-segmento'),
  };
}

async function altaCsfConfirmar() {
  const errDiv = document.getElementById('csf-campos-error');
  const err = altaCsfValidarCampos();
  if (err) {
    if (errDiv) { errDiv.textContent = err; errDiv.style.display = ''; }
    return;
  }
  if (errDiv) errDiv.style.display = 'none';

  const datos = altaCsfLeerFormulario();
  altaCsfState.datos = datos;
  altaCsfState.confirmado = true;

  // Modo upgrade (#85): el destino es el PUT sobre el cliente generico existente,
  // no el POST de creacion con dedup por nombre del acordeon viejo.
  if (altaCsfState.modoUpgrade != null) {
    await pcEjecutarUpgradeFiscal(datos);
    return;
  }

  altaState.datos = { ...datos };
  await altaDedupCorrer(datos.rfc, datos.razonSocial);
}

window.altaCsfConfirmar = altaCsfConfirmar;

// === Seccion 1: Tab switcher (CSF / Manual) ===

function altaTabSwitch(modo) {
  const panelCsf = document.getElementById('alta-panel-csf');
  const panelManual = document.getElementById('alta-panel-manual');
  const btnCsf = document.getElementById('alta-tab-btn-csf');
  const btnManual = document.getElementById('alta-tab-btn-manual');
  if (!panelCsf || !panelManual) return;
  const isCsf = modo === 'csf';
  panelCsf.style.display = isCsf ? '' : 'none';
  panelManual.style.display = isCsf ? 'none' : '';
  if (btnCsf) btnCsf.classList.toggle('active', isCsf);
  if (btnManual) btnManual.classList.toggle('active', !isCsf);
}

window.altaTabSwitch = altaTabSwitch;

// === Seccion 1: Modo manual ===

const RFC_MX_REGEX_APP = /^[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}$/i;
const RFC_GENERICOS_MX_APP = new Set(['XAXX010101000', 'XEXX010101000']);

function altaManualSetPais(pais) {
  const rfcInput = document.getElementById('manual-rfc');
  if (!rfcInput) return;
  if (pais && pais !== 'MX') {
    rfcInput.placeholder = 'Tax ID o usar XEXX010101000';
  } else {
    rfcInput.placeholder = 'Ej: SMS200716NZ4';
  }
  const errDiv = document.getElementById('manual-rfc-error');
  if (errDiv) errDiv.style.display = 'none';
}

function altaManualValidarRfc() {
  const rfcInput = document.getElementById('manual-rfc');
  const paisSelect = document.getElementById('manual-pais');
  const errDiv = document.getElementById('manual-rfc-error');
  if (!rfcInput || !errDiv) return null;
  const rfc = rfcInput.value.trim().toUpperCase();
  const pais = paisSelect ? paisSelect.value : 'MX';
  if (pais !== 'MX') { errDiv.style.display = 'none'; return null; }
  if (!rfc) { errDiv.textContent = 'El RFC es obligatorio'; errDiv.style.display = ''; return 'El RFC es obligatorio'; }
  if (RFC_GENERICOS_MX_APP.has(rfc)) { errDiv.style.display = 'none'; return null; }
  if (!RFC_MX_REGEX_APP.test(rfc)) {
    const msg = 'El RFC no tiene formato valido (12 o 13 caracteres alfanumericos)';
    errDiv.textContent = msg; errDiv.style.display = '';
    return msg;
  }
  errDiv.style.display = 'none';
  return null;
}

function altaManualLeerFormulario() {
  const getVal = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
  return {
    rfc: getVal('manual-rfc').toUpperCase(),
    razonSocial: getVal('manual-razon-social'),
    nombreCorto: getVal('manual-nombre-corto'),
    idcif: getVal('manual-idcif'),
    taxIdExtranjero: getVal('manual-tax-id-extranjero'),
    regimenFiscal: getVal('manual-regimen-fiscal'),
    usoCfdi: getVal('manual-uso-cfdi'),
    calle: getVal('manual-calle'),
    numExt: getVal('manual-num-ext'),
    numInt: getVal('manual-num-int'),
    colonia: getVal('manual-colonia'),
    cp: getVal('manual-cp'),
    municipio: getVal('manual-municipio'),
    estado: getVal('manual-estado'),
    pais: getVal('manual-pais'),
    segmentoId: getVal('alta-upgrade-segmento'),
  };
}

async function altaManualConfirmar() {
  const errDiv = document.getElementById('manual-campos-error');
  const rfcErr = altaManualValidarRfc();
  if (rfcErr) {
    if (errDiv) { errDiv.textContent = rfcErr; errDiv.style.display = ''; }
    return;
  }
  const datos = altaManualLeerFormulario();
  // Minimos de la regla 4 (#95): Razon Social, RFC, Codigo Postal, Regimen Fiscal.
  // El nombre corto ya no es obligatorio en esta pestana; calle/numero/colonia/
  // estado se capturan abajo pero son opcionales por diseno.
  const minErr = validarAltaManualMinimos(datos);
  if (minErr) {
    if (errDiv) { errDiv.textContent = minErr; errDiv.style.display = ''; }
    return;
  }
  if (errDiv) errDiv.style.display = 'none';

  // Modo upgrade (#85): igual que altaCsfConfirmar, la pestana "Captura manual" es
  // el MISMO panel/Seccion 1 abierto por pcAbrirUpgradeFiscal -- sin este chequeo,
  // confirmar aqui se saltaria el PUT de upgrade y su gate anti-fusion, disparando
  // el POST de creacion viejo sobre un cliente que ya existe en Operam.
  if (altaCsfState.modoUpgrade != null) {
    await pcEjecutarUpgradeFiscal(datos);
    return;
  }

  altaState.datos = {
    rfc: datos.rfc,
    razonSocial: datos.razonSocial,
    nombreCorto: datos.nombreCorto,
    idcif: datos.idcif || '',
    regimenFiscal: datos.regimenFiscal || '',
    usoCfdi: datos.usoCfdi || 'S01',
    calle: datos.calle || '',
    numExt: datos.numExt || '',
    numInt: datos.numInt || '',
    colonia: datos.colonia || '',
    cp: datos.cp || '',
    municipio: datos.municipio || '',
    estado: datos.estado || '',
    pais: datos.pais || 'MX',
  };
  altaState.modo = 'manual';

  await altaDedupCorrer(datos.rfc, datos.razonSocial);
}

window.altaManualSetPais = altaManualSetPais;
window.altaManualValidarRfc = altaManualValidarRfc;
window.altaManualConfirmar = altaManualConfirmar;

// Estado del diff fiscal pendiente (issue #38). Vive aparte de altaState.clienteExistente
// porque el diff puede calcularse y descartarse/confirmarse ANTES de que el vendedor
// elija "Usar este cliente" -- son ciclos de vida independientes.
const altaDiffFiscalState = {
  cliente: null,
  diff: null,
};

async function altaDiffFiscalConfirmar() {
  const { cliente, diff } = altaDiffFiscalState;
  if (!cliente || !diff || Object.keys(diff).length === 0) return;
  const id = cliente.id || cliente.customer_id;
  const dedupDiv = document.getElementById('alta-dedup-resultado');
  const panel = dedupDiv ? dedupDiv.querySelector('.diff-fiscal-panel') : null;
  const btn = panel ? panel.querySelector('.diff-fiscal-acciones .btn-secondary:not(.diff-fiscal-btn-descartar)') : null;
  if (btn) { btn.disabled = true; btn.textContent = 'Actualizando...'; }

  try {
    const res = await api('/api/operam/clientes/' + id, { method: 'PATCH', body: { diff } });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al actualizar');

    if (panel) {
      panel.innerHTML = '<p class="alert alert-success" style="margin:0">Datos fiscales actualizados en Operam.</p>';
    }
    altaDiffFiscalState.cliente = null;
    altaDiffFiscalState.diff = null;
  } catch (err) {
    if (panel) {
      const msgEl = document.createElement('p');
      msgEl.className = 'alert alert-error';
      msgEl.style.fontSize = '12px';
      msgEl.textContent = 'Error al actualizar datos fiscales: ' + err.message;
      panel.appendChild(msgEl);
    }
    if (btn) { btn.disabled = false; btn.textContent = 'Confirmar y actualizar en Operam'; }
  }
}
window.altaDiffFiscalConfirmar = altaDiffFiscalConfirmar;

function altaDiffFiscalDescartar() {
  const dedupDiv = document.getElementById('alta-dedup-resultado');
  const panel = dedupDiv ? dedupDiv.querySelector('.diff-fiscal-panel') : null;
  if (panel) panel.remove();
  altaDiffFiscalState.cliente = null;
  altaDiffFiscalState.diff = null;
}
window.altaDiffFiscalDescartar = altaDiffFiscalDescartar;

// === Seccion 1: Deduplicacion (issue #31) ===

function altaDedupDesbloquear() {
  const dot = document.getElementById('chkdot-1');
  if (dot) { dot.classList.add('done'); dot.textContent = 'v'; }
  const sec2 = document.getElementById('alta-sec-2');
  if (sec2) {
    sec2.classList.remove('alta-seccion-bloqueada');
    const hdr = document.getElementById('alta-hd-2');
    if (hdr) hdr.style.cursor = '';
  }
  altaToggleSeccion(2);
}

async function altaDedupCorrer(rfc, razonSocial, telefono) {
  const dedupDiv = document.getElementById('alta-dedup-resultado');
  if (!dedupDiv) { altaDedupDesbloquear(); return; }

  dedupDiv.innerHTML = '<p style="font-size:13px;color:var(--text-light)">Verificando duplicados...</p>';
  dedupDiv.style.display = '';

  try {
    const params = new URLSearchParams({ rfc, nombre: razonSocial || '', telefono: telefono || '' });
    const res = await api('/api/buscar-cliente-duplicado?' + params.toString());
    if (!res.ok) throw new Error('Error ' + res.status);
    const resultado = await res.json();

    if (resultado.tipo === 'libre') {
      dedupDiv.style.display = 'none';
      altaDedupDesbloquear();
      return;
    }

    if (resultado.tipo === 'exacto') {
      const c = resultado.cliente;
      const csfDatos = altaState.datos || null;
      altaDiffFiscalState.cliente = c;
      altaDiffFiscalState.diff = csfDatos ? calcularDiffFiscal(c, csfDatos) : {};
      dedupDiv.innerHTML = buildDedupExactoConDiffHtml(c, csfDatos);
      return;
    }

    if (resultado.tipo === 'candidatos') {
      // Issue #78: cuando el RFC de entrada YA es real, los candidatos vienen
      // del fallback contra clientes con RFC generico -- UI distinta a la rama
      // generica de ADR-0001 (aqui SI se puede crear nuevo).
      const rfcNorm = (rfc || '').toUpperCase().trim();
      if (RFC_GENERICOS_MX_APP.has(rfcNorm)) {
        const items = resultado.candidatos.map(c =>
          '<label style="display:block;padding:4px 0;cursor:pointer">' +
          '<input type="radio" name="dedup-candidato" value="' + c.id + '" onchange="altaDedupSelCandidato(' + c.id + ')">' +
          ' <strong>' + (c.CustName || '') + '</strong> (' + (c.cust_ref || '') + ')' +
          '</label>'
        ).join('');
        dedupDiv.innerHTML =
          '<div class="dedup-candidatos">' +
          '<p class="dedup-alerta-naranja">Posibles clientes existentes</p>' +
          items +
          '<label style="display:block;padding:4px 0;cursor:pointer">' +
          '<input type="radio" name="dedup-candidato" value="escalar">' +
          ' Ninguno es el mismo cliente - escalar a Adrian' +
          '</label>' +
          '</div>';
      } else {
        dedupDiv.innerHTML = buildCandidatosRfcGenericoHtml(resultado.candidatos);
      }
      return;
    }
  } catch (err) {
    dedupDiv.innerHTML = '<p style="color:var(--danger);font-size:12px">Error al verificar duplicados: ' + err.message + '</p>';
  }
}

async function altaDedupUsarCliente(clienteId) {
  altaState.clienteExistente = { id: clienteId };
  const dedupDiv = document.getElementById('alta-dedup-resultado');
  if (dedupDiv) {
    dedupDiv.innerHTML += '<p style="font-size:12px;color:var(--text-light)">Cargando domicilios...</p>';
  }
  try {
    const res = await api('/api/operam/clientes/' + clienteId + '/domicilios');
    if (!res.ok) throw new Error('Error ' + res.status);
    const { domicilios } = await res.json();
    altaDedupMostrarDomicilios(clienteId, domicilios || []);
  } catch (err) {
    if (dedupDiv) dedupDiv.innerHTML += '<p style="color:var(--danger);font-size:12px">Error al cargar domicilios: ' + err.message + '</p>';
  }
}

async function altaDedupSelCandidato(clienteId) {
  altaState.clienteExistente = { id: clienteId };
  await altaDedupUsarCliente(clienteId);
}

function altaDedupMostrarDomicilios(clienteId, domicilios) {
  const dedupDiv = document.getElementById('alta-dedup-resultado');
  if (!dedupDiv) return;
  const items = domicilios.map((d, i) =>
    '<label style="display:block;padding:4px 0;cursor:pointer">' +
    '<input type="radio" name="dedup-domicilio" value="' + i + '" onchange="altaDedupSelDomicilio(' + clienteId + ',' + i + ')">' +
    ' ' + (d.descripcion || 'Domicilio ' + (i + 1)) + ' - ' + (d.calle || '') + ', ' + (d.municipio || '') +
    '</label>'
  ).join('');
  const crearOpcion =
    '<label style="display:block;padding:4px 0;cursor:pointer">' +
    '<input type="radio" name="dedup-domicilio" value="nuevo" onchange="altaDedupNuevoDomicilio(' + clienteId + ')">' +
    ' Crear nuevo domicilio' +
    '</label>';
  const existingDedup = dedupDiv.querySelector('.dedup-exacto, .dedup-candidatos');
  const domDiv = document.createElement('div');
  domDiv.className = 'dedup-domicilios';
  domDiv.innerHTML = '<p style="font-weight:600;font-size:13px;margin-top:12px">Selecciona un domicilio de entrega:</p>' + items + crearOpcion;
  if (existingDedup) existingDedup.appendChild(domDiv);
  else dedupDiv.appendChild(domDiv);
}

function altaDedupSelDomicilio(clienteId, domicilioIdx) {
  altaState.clienteExistente = { id: clienteId, branchIdx: domicilioIdx };
  altaDedupDesbloquear();
}

function altaDedupNuevoDomicilio(clienteId) {
  altaState.clienteExistente = { id: clienteId, branchIdx: 'nuevo' };
  altaDedupDesbloquear();
}

window.altaDedupUsarCliente = altaDedupUsarCliente;
window.altaDedupSelCandidato = altaDedupSelCandidato;
window.altaDedupSelDomicilio = altaDedupSelDomicilio;
window.altaDedupNuevoDomicilio = altaDedupNuevoDomicilio;

// --- Candidatos por RFC generico (issue #78) ---
// "Actualizar este" dispara el upgrade fiscal EXISTENTE de #85 (pcEjecutarUpgradeFiscal
// / PUT /api/actualizar-cliente-fiscal/:id, con su gate anti-fusion y verificacion
// post-PUT) contra el customer_id del candidato, usando los datos de la CSF ya
// parseada en altaState.datos -- no se reabre el formulario, ya se tienen los datos.
async function altaCandidatoActualizar(clienteId) {
  altaCsfState.modoUpgrade = clienteId;
  await pcEjecutarUpgradeFiscal(altaState.datos);
}
window.altaCandidatoActualizar = altaCandidatoActualizar;

// "Crear nuevo" descarta el candidato y continua el camino de creacion (POST)
// que ya estaba en curso. Si el candidato aparecio en la Seccion 1 (justo tras
// parsear la CSF) la Seccion 2 sigue bloqueada y hay que desbloquearla; si
// aparecio en la Seccion 2 (disparado por altaBuscarCelular, con la Seccion 2
// ya abierta) no se debe re-alternar la seccion o quedaria colapsada.
function altaCandidatoCrearNuevo() {
  const dedupDiv = document.getElementById('alta-dedup-resultado');
  if (dedupDiv) { dedupDiv.innerHTML = ''; dedupDiv.style.display = 'none'; }
  const candDiv = document.getElementById('alta-celular-candidatos');
  if (candDiv) { candDiv.innerHTML = ''; candDiv.style.display = 'none'; }
  const sec2 = document.getElementById('alta-sec-2');
  if (sec2 && sec2.classList.contains('alta-seccion-bloqueada')) altaDedupDesbloquear();
}
window.altaCandidatoCrearNuevo = altaCandidatoCrearNuevo;

// === Seccion 2: Confirmar config comercial ===

// Busqueda por celular en el primer formulario (issue #69 AC3): al capturar el
// celular en el alta se clasifica contra el embudo (mismo endpoint que la captura
// de prospecto y el hook de cotizacion) y se avisa si ya es prospecto o cliente --
// guardrail equivalente a la dedup por RFC. Best effort: si la clasificacion falla
// no se bloquea el alta.
async function altaBuscarCelular() {
  const aviso = document.getElementById('alta-celular-aviso');
  if (!aviso) return;
  const codeEl = document.getElementById('alta-celular-code');
  const celular = leerTelefono('alta-celular', codeEl ? 'alta-celular-code' : null) || (document.getElementById('alta-celular')?.value || '').trim();
  const candDiv = document.getElementById('alta-celular-candidatos');
  if (candDiv) { candDiv.innerHTML = ''; candDiv.style.display = 'none'; }
  if (!celular) { aviso.style.display = 'none'; aviso.textContent = ''; return; }
  try {
    const res = await api(`/api/prospectos/clasificar?celular=${encodeURIComponent(celular)}`);
    const clasificacion = await res.json();
    const r = mensajeBusquedaCelular(clasificacion);
    if (r.encontrado) {
      aviso.textContent = r.mensaje;
      aviso.style.color = r.tipo === 'cliente' ? '#c00' : '#b45309';
      aviso.style.display = 'block';
    } else {
      aviso.style.display = 'none';
      aviso.textContent = '';
    }
  } catch {
    aviso.style.display = 'none';
    aviso.textContent = '';
  }

  // Issue #78: el nombre/RFC solos no siempre detectan un cliente ya existente
  // con RFC generico (caso real "Siscani": el aviso de arriba, por telefono, fue
  // lo UNICO que lo detecto). Se re-consulta el mismo endpoint de dedup ahora
  // que hay telefono, solo si seguimos en el camino de creacion (no en upgrade)
  // y todavia no se eligio un cliente existente.
  if (candDiv && altaCsfState.modoUpgrade == null && altaState.datos?.rfc && !altaState.clienteExistente) {
    try {
      const params = new URLSearchParams({ rfc: altaState.datos.rfc, nombre: altaState.datos.razonSocial || '', telefono: celular });
      const res2 = await api('/api/buscar-cliente-duplicado?' + params.toString());
      const resultado2 = await res2.json();
      if (resultado2.tipo === 'candidatos') {
        candDiv.innerHTML = buildCandidatosRfcGenericoHtml(resultado2.candidatos);
        candDiv.style.display = 'block';
      }
    } catch {
      // Best effort -- un fallo aqui no debe bloquear el alta.
    }
  }
}
window.altaBuscarCelular = altaBuscarCelular;

function altaConfirmarComercial() {
  const dot = document.getElementById('chkdot-2');
  if (dot) { dot.classList.add('done'); dot.textContent = 'v'; }

  const sec3 = document.getElementById('alta-sec-3');
  if (sec3) {
    sec3.classList.remove('alta-seccion-bloqueada');
    const hdr = document.getElementById('alta-hd-3');
    if (hdr) hdr.style.cursor = '';
    const ico = document.getElementById('alta-ico-3');
    if (ico) { ico.textContent = '+'; }
  }

  altaToggleSeccion(3);
}

window.altaConfirmarComercial = altaConfirmarComercial;

// === Seccion 3: Confirmar domicilio de entrega ===

function altaLeerDomicilio() {
  const getVal = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
  return {
    br_name: getVal('alta-br-name'),
    br_ref: getVal('alta-br-ref'),
    addr_street: getVal('alta-addr-street'),
    addr_exterior: getVal('alta-addr-exterior'),
    addr_interior: getVal('alta-addr-interior'),
    addr_colony: getVal('alta-addr-colony'),
    addr_zip: getVal('alta-addr-zip'),
    addr_city: getVal('alta-addr-city'),
    addr_state: getVal('alta-addr-state'),
    pais: getVal('alta-pais'),
    phone: combinarTelefonoConCodigo(getVal('alta-addr-phone-code'), getVal('alta-addr-phone')),
    addr_reference: getVal('alta-addr-reference'),
    email: getVal('alta-addr-email'),
  };
}

function altaValidarDomicilio() {
  const getVal = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
  if (!getVal('alta-br-name')) return 'El nombre del domicilio es obligatorio';
  if (!getVal('alta-br-ref')) return 'La referencia corta es obligatoria';
  if (!getVal('alta-addr-street')) return 'La calle es obligatoria';
  if (!getVal('alta-addr-zip')) return 'El codigo postal es obligatorio';
  if (!getVal('alta-addr-city')) return 'La ciudad es obligatoria';
  if (!getVal('alta-addr-state')) return 'El estado es obligatorio';
  const telErr = validarTelefono(getVal('alta-addr-phone-code'), getVal('alta-addr-phone'));
  if (telErr) return telErr;
  return null;
}

function altaConfirmarDomicilio() {
  const errDiv = document.getElementById('alta-domicilio-error');
  const err = altaValidarDomicilio();
  if (err) {
    if (errDiv) { errDiv.textContent = err; errDiv.style.display = ''; }
    return;
  }
  if (errDiv) errDiv.style.display = 'none';

  altaState.domicilio = altaLeerDomicilio();

  const dot = document.getElementById('chkdot-3');
  if (dot) { dot.classList.add('done'); dot.textContent = 'v'; }

  const sec4 = document.getElementById('alta-sec-4');
  if (sec4) {
    sec4.classList.remove('alta-seccion-bloqueada');
    const hdr = document.getElementById('alta-hd-4');
    if (hdr) hdr.style.cursor = '';
    const ico = document.getElementById('alta-ico-4');
    if (ico) { ico.textContent = '+'; }
  }

  altaToggleSeccion(4);
}

window.altaConfirmarDomicilio = altaConfirmarDomicilio;

// === Seccion 4: Dar de alta (progreso POST+GET+PUT) ===

const ALTA_PASO_NOMBRES = ['POST customer', 'GET branch_id', 'PUT branch'];
const ALTA_ICO_PENDING = '○';
const ALTA_ICO_SPIN = '◔';
const ALTA_ICO_OK = '✓';
const ALTA_ICO_ERR = '✗';

function altaPasoSetStatus(idx, status, msg) {
  const ico = document.getElementById(`alta-paso-ico-${idx}`);
  const msgEl = document.getElementById(`alta-paso-msg-${idx}`);
  const row = document.getElementById(`alta-paso-${idx}`);
  if (ico) {
    ico.textContent = status === 'ok' ? ALTA_ICO_OK : status === 'error' ? ALTA_ICO_ERR : status === 'loading' ? ALTA_ICO_SPIN : ALTA_ICO_PENDING;
    ico.style.color = status === 'ok' ? 'var(--success, #22c55e)' : status === 'error' ? 'var(--danger)' : '';
  }
  if (msgEl) {
    if (msg && status === 'error') { msgEl.textContent = msg; msgEl.style.display = ''; }
    else { msgEl.style.display = 'none'; }
  }
  if (row) row.style.background = status === 'error' ? '#fff5f5' : '';
}

function altaPasosReset() {
  [0, 1, 2].forEach(i => altaPasoSetStatus(i, 'pending', ''));
}

function altaDarDeAlta() {
  const btn = document.getElementById('alta-btn-dar-alta');
  const reintBtn = document.getElementById('alta-btn-reintentar');
  const exitoDiv = document.getElementById('alta-btns-exito');
  if (btn) btn.disabled = true;
  if (reintBtn) reintBtn.style.display = 'none';
  if (exitoDiv) exitoDiv.style.display = 'none';

  altaPasosReset();

  const csfDatos = altaState.datos || altaCsfState.datos || {};
  const getComercial = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
  const domicilio = altaState.domicilio || {};
  const resolvedCustomerId = (altaState.clienteExistente && altaState.clienteExistente.id != null)
    ? altaState.clienteExistente.id
    : (altaState.customer_id || null);
  const comercial = {
    uso_cfdi: getComercial('alta-uso-cfdi'),
    sales_type: getComercial('alta-lista-precios'),
    segmento_id: getComercial('alta-segmento'),
    salesman: getComercial('alta-vendedor'),
    invoice_email: getComercial('alta-email-factura'),
    celular_nota: getComercial('alta-celular'),
  };
  const payload = buildAltaDarDeAltaPayload(csfDatos, comercial, domicilio, resolvedCustomerId, altaState.branch_id);

  [0, 1, 2].forEach(i => altaPasoSetStatus(i, 'loading'));

  const token = window._authToken || localStorage.getItem('token') || '';
  fetch('/api/crear-cliente', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify(payload),
  })
    .then(r => r.json())
    .then(data => {
      altaState.customer_id = data.customer_id;
      altaState.branch_id = data.branch_id;

      const stepNames = ['POST customer', 'GET branch_id', 'PUT branch'];
      (data.steps || []).forEach((step, i) => {
        altaPasoSetStatus(i, step.status === 'ok' ? 'ok' : 'error', step.error || '');
      });

      if (data.ok) {
        if (exitoDiv) { exitoDiv.style.display = 'flex'; }
      } else {
        if (reintBtn) reintBtn.style.display = '';
        if (btn) btn.disabled = false;
      }
    })
    .catch(err => {
      altaPasoSetStatus(0, 'error', err.message);
      if (reintBtn) reintBtn.style.display = '';
      if (btn) btn.disabled = false;
    });
}

function altaReintentar() {
  altaDarDeAlta();
}

async function altaCotizarAhora() {
  const customerId = altaState.customer_id;
  if (!customerId) return;
  const panel = document.getElementById('panel-alta-cliente');
  if (panel) panel.style.display = 'none';
  // Estado compartido (#69): el cotizador abre con el cliente recien dado de alta
  // YA cargado -- razon social, telefono (con codigo de pais) y domicilio prellenados
  // desde lo capturado en el alta, sin re-pedir datos ni round-trip a Operam por RFC.
  // pcElegirOperam es el punto central de seleccion (#82): limpia los campos del
  // cliente anterior y muestra la tarjeta.
  const cliente = buildClienteDesdeAlta(altaState);
  switchTab('cliente');
  await pcElegirOperam(cliente);
}

function altaTerminar() {
  const panel = document.getElementById('panel-alta-cliente');
  if (panel) panel.style.display = 'none';
  const btnNuevo = document.getElementById('btn-nuevo-cliente');
  if (btnNuevo) btnNuevo.textContent = 'Nuevo cliente';
}

window.altaDarDeAlta = altaDarDeAlta;
window.altaReintentar = altaReintentar;
window.altaCotizarAhora = altaCotizarAhora;
window.altaTerminar = altaTerminar;

// Wiring del dropzone
document.addEventListener('DOMContentLoaded', () => {
  const zone = document.getElementById('csf-dropzone');
  const input = document.getElementById('csf-input');
  if (!zone || !input) return;

  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file && file.type === 'application/pdf') altaCsfProcesarArchivo(file);
  });
  input.addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) altaCsfProcesarArchivo(file);
  });
});

// Wiring de busqueda por celular en el primer formulario (issue #69 AC3).
document.addEventListener('DOMContentLoaded', () => {
  const cel = document.getElementById('alta-celular');
  if (cel) cel.addEventListener('blur', altaBuscarCelular);
});
