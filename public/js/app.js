import {
  altaCsfResultadoParseo,
  combinarTelefonoConCodigo,
  validarTelefono,
  separarTelefonoCodigo,
  calcularDiffFiscal,
  buildDiffFiscalHtml,
  buildDedupExactoConDiffHtml,
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
} from './cotizaciones-logica.js';
import {
  buildTableroPipelineHtml,
  oportunidadesActivas,
  badgeFolioOperamHtml,
  badgeFolioOperamProspectoHtml,
  cadenaOperamHtml,
  botonCompletarHtml,
  siguientePasoFormalizacion,
  buildColaHoyHtml,
  buildMenuNuevoHtml,
  buildCerradasHtml,
} from './pipeline-logica.js';
import {
  estadoStepper,
  textoProgreso,
} from './stepper-logica.js';
import {
  validarDomicilioEntrega,
  formatCarrier,
  formatServicio,
} from './cotizar-logica.js';

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

// Lee el domicilio de entrega del DOM y delega en la funcion pura (#71).
function validarDomicilioCotizacion() {
  return validarDomicilioEntrega({
    calle: document.getElementById('cl-calle')?.value,
    cp: document.getElementById('cl-cp-entrega')?.value,
    pais: document.getElementById('cl-pais')?.value || 'MX',
  });
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
  cart: new Map(), // key -> { product, cantidad }
  shipping: { option: 'none', desc: '', cost: 0 },
  lastCotizacionId: null,
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
  if (res.status === 401) { logout(); throw new Error('No autorizado'); }
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

function logout() {
  state.token = null;
  state.user = null;
  state.precios = null;
  state.cart.clear();
  localStorage.removeItem('token');
  localStorage.removeItem('user');
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
  const date = new Date(state.precios.extracted).toLocaleDateString('es-MX', {
    day: 'numeric', month: 'short', year: 'numeric'
  });
  document.getElementById('prices-date').textContent = `Precios: ${date}`;
}

// === TIER LOGIC ===
function getTotalPiezas() {
  let total = 0;
  for (const item of state.cart.values()) total += item.cantidad;
  return total;
}

function getCurrentTier() {
  const total = getTotalPiezas();
  const tiers = state.precios?.tiers || [];
  let current = tiers[0];
  for (const t of tiers) {
    if (total >= t.min_qty) current = t;
  }
  return current;
}

function getNextTier() {
  const total = getTotalPiezas();
  const tiers = state.precios?.tiers || [];
  for (const t of tiers) {
    if (t.min_qty > total) return t;
  }
  return null;
}

function getPrice(product) {
  const tier = getCurrentTier();
  return product.prices[tier.id] ?? product.prices['Menudeo'] ?? 0;
}

function updateTierBar() {
  const total = getTotalPiezas();
  const tier = getCurrentTier();
  const next = getNextTier();

  document.getElementById('tier-label').textContent = total === 0 ? 'Sin productos' : `Lista de precios: ${tier.label}`;
  document.getElementById('tier-stats').textContent = total > 0 ? `${total} pzs totales` : '';
  document.getElementById('tier-next').textContent = '';

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
  state.cart.set(key, { product: cartProduct, cantidad: (prev?.cantidad || 0) + qty });

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
  let subtotal = 0;
  let html = '';

  for (const [key, { product, cantidad }] of state.cart) {
    const price = getPrice(product);
    const total = price * cantidad;
    subtotal += total;
    const name = product.name.replace(/^[A-Z]{2,3}\d{2}\s+/, '');
    html += `
      <div class="cart-line" data-key="${key}">
        <span class="cart-line-sku">${key}</span>
        <span class="cart-line-name" title="${name}">${name}</span>
        <div class="cart-line-qty-wrap col-num">
          <span class="qty-display">${cantidad}</span>
          <button class="qty-icon-btn" onclick="cartLineStartEdit('${key}')" title="Editar">&#9998;</button>
          <input class="qty-input" type="number" min="1" value="${cantidad}" style="display:none" inputmode="numeric"
            onkeydown="if(event.key==='Enter')cartLineConfirmEdit('${key}')">
          <button class="qty-icon-btn qty-ok-btn" style="display:none" onclick="cartLineConfirmEdit('${key}')" title="Confirmar">&#10003;</button>
        </div>
        <span class="cart-line-price col-num">$${fmt(price)}</span>
        <span class="cart-line-total col-num">$${fmt(total)}</span>
        <div class="cart-line-del col-del"><button onclick="removeItem('${key}')" title="Quitar">&times;</button></div>
      </div>
    `;
  }

  container.innerHTML = html;
  const iva = subtotal * 0.16;
  subtotalEl.innerHTML = `Subtotal: <strong>$${fmt(subtotal)}</strong> &nbsp;+&nbsp; IVA $${fmt(iva)} &nbsp;= &nbsp;<strong>$${fmt(subtotal + iva)}</strong>`;
}

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
    state.cart.set(key, { product, cantidad: qty });
  }

  updateTierBar();
  updateCartSummary();
  renderProducts(document.getElementById('search-input').value);
  updateResumen();
  updateShippingSummary();
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
    state.cart.set(skuKey, { product: skuProduct, cantidad: qty });
  }

  updateTierBar();
  updateCartSummary();
  renderProducts(document.getElementById('search-input').value);
  updateResumen();
  updateShippingSummary();
}

window.changeQty = changeQty;
window.setQty = setQty;
window.changeQtySku = changeQtySku;
window.setQtySku = setQtySku;
window.removeItem = (key) => {
  state.cart.delete(key);
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
  const totalPzs = getTotalPiezas();
  const items = state.cart.size;

  if (items === 0) {
    bar.style.display = 'none';
    return;
  }

  bar.style.display = 'flex';
  const subtotal = calcSubtotal();
  document.getElementById('cart-total').textContent = `$${fmt(subtotal)}`;
  document.getElementById('cart-count').textContent = `${items} producto${items !== 1 ? 's' : ''}, ${totalPzs} pzs`;
}

function calcSubtotal() {
  let subtotal = 0;
  for (const { product, cantidad } of state.cart.values()) {
    subtotal += getPrice(product) * cantidad;
  }
  return subtotal;
}

// === SHIPPING ===
function updateShippingSummary() {
  const totalPzs = getTotalPiezas();
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

  // Si hay CP del cliente, pre-llenarlo en el campo de envia
  const cpCliente = document.getElementById('cl-cp-entrega')?.value?.trim();
  const cpEnvia = document.getElementById('envia-cp');
  if (cpEnvia && cpCliente && !cpEnvia.value) cpEnvia.value = cpCliente;

  updateTabIndicators();
}

// === ENVIA.COM ===
let enviaRateSeleccionado = null; // { desc, cost }

async function cotizarEnvia() {
  const btn = document.getElementById('btn-cotizar-envia');
  const errEl = document.getElementById('envia-error');
  const resultsEl = document.getElementById('envia-results');
  const resumenEl = document.getElementById('envia-resumen');

  errEl.style.display = 'none';
  resultsEl.innerHTML = '';
  resumenEl.style.display = 'none';
  enviaRateSeleccionado = null;

  const cp = document.getElementById('envia-cp')?.value?.trim();
  const pais = document.getElementById('envia-pais')?.value || 'MX';
  const cpValido = pais === 'CA'
    ? /^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$/.test(cp)
    : /^\d{5}$/.test(cp);
  if (!cp || !cpValido) {
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

  // Total con IVA para calcular seguro (25%)
  const subtotal = calcSubtotal();
  const shippingCost = parseFloat(document.getElementById('shipping-cost')?.value || 0) || 0;
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
      const dias = rate.days != null ? `${rate.days} día${rate.days !== 1 ? 's' : ''}` : '';
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
      card.addEventListener('click', () => seleccionarEnviaRate(card, carrier, servicio, precio));
      resultsEl.appendChild(card);

      // Auto-seleccionar el primero (recomendado)
      if (esRecomendado) seleccionarEnviaRate(card, carrier, servicio, precio);
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

function seleccionarEnviaRate(card, carrier, servicio, precio) {
  document.querySelectorAll('.envia-rate-card').forEach(c => c.classList.remove('selected'));
  card.classList.add('selected');
  enviaRateSeleccionado = {
    desc: `${formatCarrier(carrier)} ${formatServicio(servicio)}`.trim(),
    cost: precio,
  };
  // Sincronizar con los campos manuales para que updateResumen los tome
  document.getElementById('shipping-desc').value = enviaRateSeleccionado.desc;
  document.getElementById('shipping-cost').value = precio.toFixed(2);
  updateResumen();
  updateTabIndicators();
}

window.cotizarEnvia = cotizarEnvia;

// === RESUMEN ===
function updateResumen() {
  const empty = document.getElementById('resumen-empty');
  const content = document.getElementById('resumen-content');
  const shippingAlert = document.getElementById('resumen-shipping-alert');

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

  const itemsEl = document.getElementById('resumen-items');

  let html = '';
  for (const [key, { product, cantidad }] of state.cart) {
    const price = getPrice(product);
    const total = price * cantidad;
    const displayName = product.name.replace(/^[A-Z]{2,3}\d{2}\s+/, '');
    const isSkuItem = state.precios.skus?.some(s => s.sku === key);

    html += `
      <div class="cart-item">
        <div class="cart-item-info">
          <div class="cart-item-name">${displayName}</div>
          <div class="cart-item-detail">${key} — $${fmt(price)} / pza</div>
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
      document.getElementById('resumen-shipping-detail').innerHTML = `
        <div class="cart-item-info">
          <div class="cart-item-name">${shippingDesc}</div>
        </div>
        <div class="cart-item-total">$${fmt(shippingCost)}</div>
      `;
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
function resumenChangeQty(key, delta) {
  const item = state.cart.get(key);
  if (!item) return;
  const newQty = Math.max(0, item.cantidad + delta);
  if (newQty === 0) {
    state.cart.delete(key);
  } else {
    item.cantidad = newQty;
  }
  updateTierBar();
  updateCartSummary();
  renderProducts(document.getElementById('search-input').value);
  updateResumen();
  updateShippingSummary();
}

function resumenSetQty(key, qty) {
  const item = state.cart.get(key);
  if (!item) return;
  if (qty <= 0) {
    state.cart.delete(key);
  } else {
    item.cantidad = qty;
  }
  updateTierBar();
  updateCartSummary();
  renderProducts(document.getElementById('search-input').value);
  updateResumen();
  updateShippingSummary();
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
  if (!domio.ok) {
    alert(domio.error);
    switchTab('cliente');
    document.getElementById('cl-cp-entrega')?.focus();
    return;
  }
  const btn = document.getElementById('btn-pdf');
  btn.disabled = true;
  btn.textContent = 'Generando...';

  try {
    const tier = getCurrentTier();
    const items = [];
    for (const [key, { product, cantidad }] of state.cart) {
      const price = getPrice(product);
      const displayName = product.name.replace(/^[A-Z]{2,3}\d{2}\s+/, '');
      items.push({
        codigo: key,
        descripcion: displayName,
        cantidad,
        unidad: 'pza',
        precio: price,
        descuento: 0,
      });
    }

    // Envío
    const shippingOpt = document.getElementById('shipping-option').value;
    let shippingCost = 0;
    if (shippingOpt === 'manual' || shippingOpt === 'envia') {
      shippingCost = parseFloat(document.getElementById('shipping-cost').value) || 0;
      if (shippingCost > 0) {
        items.push({
          codigo: 'ENVIO',
          descripcion: document.getElementById('shipping-desc').value || 'Envio',
          cantidad: 1,
          unidad: 'ACT',
          precio: shippingCost,
          descuento: 0,
        });
      }
    }

    const subtotal = items.reduce((s, i) => s + (i.cantidad * i.precio * (1 - (i.descuento || 0) / 100)), 0);
    const iva = subtotal * 0.16;
    const total = subtotal + iva;

    const vigenciaDias = parseInt(document.getElementById('resumen-vigencia').value) || 30;
    const vigenciaDate = new Date();
    vigenciaDate.setDate(vigenciaDate.getDate() + vigenciaDias);

    const notasText = document.getElementById('resumen-notas').value;
    const notas = notasText.split('\n').map(l => l.replace(/^-\s*/, '').trim()).filter(Boolean);

    const body = {
      fecha: new Date().toISOString().split('T')[0],
      vigencia: vigenciaDate.toISOString().split('T')[0],
      tier: tier.id,
      cliente: {
        razonSocial: document.getElementById('cl-razon-social').value,
        nombreCorto: document.getElementById('cl-nombre-corto').value,
        rfc: document.getElementById('cl-rfc').value,
        cpFiscal: document.getElementById('cl-cp-fiscal').value,
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
        referencias: document.getElementById('cl-referencias').value,
        referencia: document.getElementById('cl-referencia').value,
        pais: document.getElementById('cl-pais')?.value || 'MX',
        leyendaDomicilio: domio.leyenda || '',
      },
      condicionesPago: document.getElementById('cl-condiciones').value,
      items,
      subtotal,
      iva,
      total,
      notas,
    };

    body.incluirFotos = document.getElementById('incluir-fotos')?.checked || false;

    const canal = await canalParaCotizacion(body.cliente.telefono);
    if (canal) body.canal = canal;

    const res = await api('/api/cotizacion/pdf', {
      method: 'POST',
      body,
    });

    if (!res.ok) {
      const err = await res.json();
      alert('Error: ' + (err.error || 'No se pudo generar'));
      return;
    }

    // Capturar el ID de cotizacion del header
    state.lastCotizacionId = res.headers.get('X-Cotizacion-Id');

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Cotizacion_PeltreNacional_${state.lastCotizacionId || 'nuevo'}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert('Error generando PDF: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Generar PDF';
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
  if (!domio.ok) {
    alert(domio.error);
    switchTab('cliente');
    document.getElementById('cl-cp-entrega')?.focus();
    return;
  }
  const btn = document.getElementById('btn-html');
  btn.disabled = true;
  btn.textContent = 'Generando...';

  try {
    const tier = getCurrentTier();
    const items = [];
    for (const [key, { product, cantidad }] of state.cart) {
      const price = getPrice(product);
      const displayName = product.name.replace(/^[A-Z]{2,3}\d{2}\s+/, '');
      items.push({ codigo: key, descripcion: displayName, cantidad, unidad: 'pza', precio: price, descuento: 0 });
    }

    const shippingOpt = document.getElementById('shipping-option').value;
    let shippingCost = 0;
    if (shippingOpt === 'manual' || shippingOpt === 'envia') {
      shippingCost = parseFloat(document.getElementById('shipping-cost').value) || 0;
      if (shippingCost > 0) {
        items.push({
          codigo: 'ENVIO',
          descripcion: document.getElementById('shipping-desc').value || 'Envio',
          cantidad: 1,
          unidad: 'ACT',
          precio: shippingCost,
          descuento: 0,
        });
      }
    }

    const subtotal = items.reduce((s, i) => s + (i.cantidad * i.precio * (1 - (i.descuento || 0) / 100)), 0);
    const iva = subtotal * 0.16;
    const total = subtotal + iva;

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
      cliente: {
        razonSocial: document.getElementById('cl-razon-social').value,
        nombreCorto: document.getElementById('cl-nombre-corto').value,
        rfc: document.getElementById('cl-rfc').value,
        cpFiscal: document.getElementById('cl-cp-fiscal').value,
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
        referencias: document.getElementById('cl-referencias').value,
        referencia: document.getElementById('cl-referencia').value,
        pais: document.getElementById('cl-pais')?.value || 'MX',
        leyendaDomicilio: domio.leyenda || '',
      },
      condicionesPago: document.getElementById('cl-condiciones').value,
      items,
      subtotal,
      iva,
      total,
      notas,
    };

    const canal = await canalParaCotizacion(body.cliente.telefono);
    if (canal) body.canal = canal;

    const res = await api('/api/cotizacion/html', { method: 'POST', body });

    if (!res.ok) {
      const err = await res.json();
      alert('Error: ' + (err.error || 'No se pudo generar'));
      return;
    }

    state.lastCotizacionId = res.headers.get('X-Cotizacion-Id');

    const html = await res.text();
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (e) {
    alert('Error generando HTML: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Ver HTML';
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

function nuevaCotizacion() {
  if (state.cart.size > 0 && !confirm('Se perdera la cotizacion actual. Continuar?')) return;
  state.cart.clear();
  state.lastCotizacionId = null;

  // Limpiar campos
  const campos = [
    'cl-razon-social', 'cl-nombre-corto', 'cl-rfc', 'cl-cp-fiscal', 'cl-telefono',
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
  document.getElementById('envia-cp').value = '';
  const envPaisEl = document.getElementById('envia-pais');
  if (envPaisEl) envPaisEl.value = 'MX';
  enviaRateSeleccionado = null;
  // Reinicia la entrada del paso Cliente (variante B, #82) a los dos caminos.
  pcRecientesCache = null;
  pcState.cliente = null;
  pcState.entregaAbierta = false;
  const entregaWrap = document.getElementById('pc-entrega-wrap');
  if (entregaWrap) entregaWrap.style.display = 'none';
  pcRenderInicio();
  resetFlujoGuiado();
  switchTab('cliente');
  renderProducts();
  updateTierBar();
  updateCartSummary();
  updateResumen();
  renderCartLines();
}

// === OPERAM: buscar cliente ===
let operamClienteSeleccionado = null;

async function buscarClienteOperam(query) {
  const statusEl = document.getElementById('operam-search-status');
  const setStatus = (msg, color = 'var(--text-light)') => {
    if (!statusEl) return;
    if (msg) { statusEl.style.display = 'block'; statusEl.style.color = color; statusEl.textContent = msg; }
    else statusEl.style.display = 'none';
  };

  if (query.length < 2) {
    document.getElementById('operam-dropdown').style.display = 'none';
    setStatus(null);
    return;
  }

  setStatus('Buscando...');
  const btn = document.getElementById('btn-buscar-operam');
  if (btn) btn.disabled = true;

  try {
    const res = await api(`/api/operam/clientes?q=${encodeURIComponent(query)}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setStatus(err.error || 'Error al buscar', '#c00');
      return;
    }
    const clientes = await res.json();
    renderOperamDropdown(clientes);
    setStatus(clientes.length ? null : 'Sin resultados');
  } catch {
    setStatus('Error de conexion', '#c00');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function renderOperamDropdown(clientes) {
  const dd = document.getElementById('operam-dropdown');
  if (!clientes.length) { dd.style.display = 'none'; return; }
  dd.innerHTML = clientes.slice(0, 10).map(c =>
    `<div class="dropdown-item" onmousedown="seleccionarClienteOperam(${JSON.stringify(c).replace(/"/g, '&quot;')})">
      <span class="dropdown-item-name">${c.name || ''}</span>
      <span class="dropdown-item-sku">${c.rfc || ''}</span>
    </div>`
  ).join('');
  dd.style.display = 'block';
}

async function seleccionarClienteOperam(cliente) {
  operamClienteSeleccionado = cliente;
  document.getElementById('operam-dropdown').style.display = 'none';
  document.getElementById('operam-search-status').style.display = 'none';
  document.getElementById('operam-search').value = cliente.name || '';

  const fill = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
  fill('cl-razon-social',   cliente.name);
  fill('cl-nombre-corto',   cliente.ref);
  fill('cl-rfc',            cliente.rfc);
  fill('cl-cp-fiscal',      cliente.cpFiscal || cliente.cp);
  if (cliente.telefono) setTelefonoCampos('cl-telefono', 'cl-telefono-code', cliente.telefono);
  fill('cl-nombre-entrega', cliente.nombreEntrega);
  fill('cl-calle',          cliente.calle);
  fill('cl-num-int',        cliente.numInt);
  fill('cl-colonia',        cliente.colonia);
  fill('cl-cp-entrega',     cliente.cp);
  fill('cl-municipio',      cliente.municipio);
  fill('cl-estado',         cliente.estado);
  if (cliente.telefono) setTelefonoCampos('cl-cel-entrega', 'cl-cel-entrega-code', cliente.telefono);
  fill('cl-email-entrega',  cliente.email);
  updateTabIndicators();

  // Cargar domicilios con dirección correcta desde el branch
  try {
    const res = await api(`/api/operam/clientes/${cliente.id}/domicilios`);
    if (!res.ok) return;
    const domicilios = await res.json();
    window._operamDomicilios = domicilios;

    if (domicilios.length === 1) {
      // Branch único: aplicar automáticamente la dirección de entrega
      aplicarDomicilio(domicilios[0]);
    } else if (domicilios.length > 1) {
      // Múltiples branches: mostrar selector
      const sel = document.getElementById('operam-domicilio-select');
      sel.innerHTML = domicilios.map((d, i) =>
        `<option value="${i}">${d.descripcion || d.calle || ''}</option>`
      ).join('');
      document.getElementById('operam-domicilios').style.display = 'block';
      // Precargar el primero
      aplicarDomicilio(domicilios[0]);
    }
  } catch {}

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

function aplicarDomicilio(d) {
  if (!d) return;
  const f = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
  f('cl-calle',       d.calle);
  f('cl-num-int',     d.numInt);
  f('cl-colonia',     d.colonia);
  f('cl-cp-entrega',  d.cp);
  f('cl-municipio',   d.municipio);
  f('cl-estado',      d.estado);
  if (d.telefono) setTelefonoCampos('cl-cel-entrega', 'cl-cel-entrega-code', d.telefono);
  if (d.email)    f('cl-email-entrega', d.email);
  if (d.contacto) f('cl-nombre-entrega', d.contacto);
}

function usarDomicilioOperam() {
  const idx = parseInt(document.getElementById('operam-domicilio-select')?.value) || 0;
  aplicarDomicilio(window._operamDomicilios?.[idx]);
  document.getElementById('operam-domicilios').style.display = 'none';
}
window.usarDomicilioOperam = usarDomicilioOperam;

// ============================================================================
// PASO CLIENTE — variante B (issue #82)
// ----------------------------------------------------------------------------
// La entrada del paso Cliente: dos caminos ("Ya lo conozco" / "Contacto nuevo")
// + nota de diferimiento; buscador unificado (Operam + prospectos) con recientes;
// captura minima del contacto nuevo (crea/usa prospecto); y la tarjeta del cliente
// seleccionado con chips de completitud y CTA a Productos. El render es tonto: toda
// la decision vive en alta-logica.js (mezclar/recientes/chips/guardrails). Ver
// prototype-cliente.html (variante B) y CONTEXT.md.
// ============================================================================

const pcState = { cliente: null };

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
    'cl-razon-social', 'cl-nombre-corto', 'cl-rfc', 'cl-cp-fiscal', 'cl-telefono',
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
}

// --- Entrada: dos caminos ---
function pcRenderInicio() {
  pcState.cliente = null;
  pcState.entregaAbierta = false;
  const entregaWrap = document.getElementById('pc-entrega-wrap');
  if (entregaWrap) entregaWrap.style.display = 'none';
  pcLimpiarCamposCliente();
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

async function pcBuscar() {
  const q = document.getElementById('pc-q')?.value || '';
  const zona = document.getElementById('pc-zona');
  if (!zona) return;
  if (q.trim().length < 2) { await pcRenderRecientes(); return; }
  zona.innerHTML = '<div class="pc-res-titulo">Buscando...</div>';
  // Los dos origenes en paralelo; se mezclan con la funcion pura (sin endpoint nuevo).
  const [clientes, prospectos] = await Promise.all([
    api(`/api/operam/clientes?q=${encodeURIComponent(q)}`).then(r => r.ok ? r.json() : []).catch(() => []),
    api('/api/prospectos').then(r => r.ok ? r.json() : []).catch(() => []),
  ]);
  const rows = mezclarResultadosBusqueda(clientes, prospectos, q);
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
  const cliente = clienteDesdeProspecto(raw);
  pcLlenarCamposContacto(cliente);
  pcState.cliente = cliente;
  pcRenderTarjeta();
}

async function pcElegirReciente(cotizacionId) {
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
}
window.pcCaminoNuevo = pcCaminoNuevo;

async function pcSugerenciasNombre() {
  const q = document.getElementById('pc-nombre')?.value || '';
  const sug = document.getElementById('pc-sug');
  if (!sug) return;
  if (q.trim().length < 2) { sug.innerHTML = ''; return; }
  const [clientes, prospectos] = await Promise.all([
    api(`/api/operam/clientes?q=${encodeURIComponent(q)}`).then(r => r.ok ? r.json() : []).catch(() => []),
    api('/api/prospectos').then(r => r.ok ? r.json() : []).catch(() => []),
  ]);
  const rows = mezclarResultadosBusqueda(clientes, prospectos, q).slice(0, 3);
  pcResultadosCache = rows;
  if (!rows.length) { sug.innerHTML = ''; return; }
  sug.innerHTML = '<div class="pc-sug-titulo">&iquest;Es alguno de estos?</div>' +
    rows.map((r, i) => pcFilaResultado(r, i)).join('');
}

async function pcClasificarCelular() {
  const aviso = document.getElementById('pc-cel-aviso');
  if (!aviso) return;
  const tel = combinarTelefonoConCodigo(
    document.getElementById('pc-cel-code')?.value,
    document.getElementById('pc-cel')?.value
  );
  if (!tel) { aviso.style.display = 'none'; return; }
  let clasificacion = null;
  try {
    const res = await api(`/api/prospectos/clasificar?celular=${encodeURIComponent(tel)}`);
    if (res.ok) clasificacion = await res.json();
  } catch { /* best effort */ }
  const decision = accionCelularContactoNuevo(clasificacion, state.user?.name);
  pcCelDecision = decision;
  if (decision.accion === 'crear') { aviso.style.display = 'none'; return; }
  aviso.style.display = 'block';
  aviso.className = 'pc-cel-aviso ' + (decision.accion === 'bloquear' ? 'pc-aviso-rojo' : 'pc-aviso-ambar');
  let extra = '';
  if (decision.accion === 'cotizar_cliente') {
    extra = ` <button type="button" class="pc-link" onclick="pcCotizarComoCliente(${JSON.stringify(decision.cust_name || '').replace(/"/g, '&quot;')})">Cotizar sobre ese cliente</button>`;
  }
  aviso.innerHTML = escapeHtml(decision.mensaje) + extra;
}

let pcCelDecision = { accion: 'crear' };

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
  const telefono = combinarTelefonoConCodigo(celCode, celNum);

  const showErr = m => { if (err) { err.textContent = m; err.style.display = 'block'; } };
  if (err) err.style.display = 'none';

  // Guardrail de celular ajeno (#69/Visibilidad): no se captura sobre otro vendedor.
  if (pcCelDecision.accion === 'bloquear') { showErr(pcCelDecision.mensaje); return; }

  const payload = buildProspectoPayload({ celularCode: celCode, celular: celNum, nombre, ciudad, canal });
  const errVal = validarProspectoBody(payload);
  if (errVal) { showErr(errVal); return; }

  const cliente = buildClienteDesdeContactoNuevo({ nombre, telefono, ciudad, canal, pais: celCode === '+1' || celCode === '+1-CA' ? 'US' : 'MX' });

  const btn = document.getElementById('pc-guardar');
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }
  const restaurarBtn = () => { if (btn) { btn.disabled = false; btn.textContent = 'Guardar y continuar'; } };
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
function pcRenderTarjeta() {
  const root = pcEl();
  const c = pcClienteActual();
  const esOperam = pcState.cliente?.tipo === 'operam';
  const chips = chipsCompletitud(c);
  const sub = esOperam
    ? [c.rfc, 'Cliente en Operam'].filter(Boolean).join(' &middot; ')
    : [c.telefono, pcState.cliente?.ciudad, 'Contacto nuevo'].filter(Boolean).join(' &middot; ');

  const chip = (ok, okLabel, pendLabel) => ok
    ? `<span class="pc-chip ok">&#10003; ${okLabel}</span>`
    : `<span class="pc-chip pend">${pendLabel}</span>`;

  // Selector de domicilio para cliente Operam con varios branches.
  let domHtml = '';
  const doms = window._operamDomicilios;
  if (esOperam && Array.isArray(doms) && doms.length > 1) {
    domHtml = '<div class="form-group pc-dom"><label>Domicilio de entrega</label>' +
      '<select id="pc-dom-select" onchange="pcCambiarDomicilio()">' +
      doms.map((d, i) => `<option value="${i}">${escapeHtml(d.descripcion || d.calle || ('Domicilio ' + (i + 1)))}</option>`).join('') +
      '</select></div>';
  }

  root.innerHTML =
    '<div class="pc-pregunta">Cliente seleccionado</div>' +
    '<div class="pc-cli-card">' +
    `<div class="pc-cli-nombre">${escapeHtml(c.name || 'Sin nombre')}</div>` +
    `<div class="pc-cli-sub">${sub}</div>` +
    '<div class="pc-chips">' +
    chip(chips.contacto, 'Contacto', 'Contacto') +
    `<button type="button" class="pc-chip-btn" onclick="pcToggleEntrega()">${chip(chips.entrega, 'Entrega', 'Entrega &middot; agregar')}</button>` +
    chip(chips.fiscal, 'Fiscal', 'Fiscal &middot; al subir a Operam') +
    '</div>' +
    (esOperam ? '' : '<div class="pc-cli-hint">Puedes cotizar y mandar por WhatsApp con esto. La direccion se pide en Envio; los datos fiscales (CSF) solo si subes el cliente a Operam.</div>') +
    domHtml +
    '<button type="button" class="btn btn-primary btn-block" style="margin-top:16px" onclick="pcContinuar()">Continuar a Productos &rsaquo;</button>' +
    '</div>' +
    '<button type="button" class="pc-back" onclick="pcRenderInicio()">&lsaquo; Cambiar de cliente</button>';

  // Reengancha el bloque de entrega (que vive en el form legacy) bajo la tarjeta
  // cuando el vendedor lo abrio antes; se mantiene abierto tras re-render.
  if (pcState.entregaAbierta) pcMostrarEntrega(true);
  updateTabIndicators();
}

function pcContinuar() {
  document.getElementById('pc-entrega-wrap')?.classList.remove('pc-entrega-inline');
  switchTab('productos');
}
window.pcContinuar = pcContinuar;

function pcCambiarDomicilio() {
  const idx = parseInt(document.getElementById('pc-dom-select')?.value) || 0;
  aplicarDomicilio(window._operamDomicilios?.[idx]);
  pcRenderChips();
}
window.pcCambiarDomicilio = pcCambiarDomicilio;

// Revela el bloque de entrega (opcional, #82; migra al paso Envio en #84). Se
// mueve inline bajo la tarjeta para que la edicion quede a la vista.
function pcToggleEntrega() {
  pcState.entregaAbierta = !pcState.entregaAbierta;
  pcMostrarEntrega(pcState.entregaAbierta);
}
window.pcToggleEntrega = pcToggleEntrega;

function pcMostrarEntrega(mostrar) {
  const wrap = document.getElementById('pc-entrega-wrap');
  const root = pcEl();
  if (!wrap || !root) return;
  if (mostrar) {
    wrap.style.display = 'block';
    wrap.classList.add('pc-entrega-inline');
    root.appendChild(wrap);
    if (!wrap.dataset.pcBound) {
      wrap.addEventListener('input', pcRenderChips);
      wrap.dataset.pcBound = '1';
    }
  } else {
    wrap.style.display = 'none';
  }
}

// Re-pinta solo los chips (sin re-render completo, para no perder foco al editar).
function pcRenderChips() {
  const chips = chipsCompletitud(pcClienteActual());
  const cont = pcEl()?.querySelector('.pc-chips');
  if (!cont) return;
  const chip = (ok, okLabel, pendLabel) => ok
    ? `<span class="pc-chip ok">&#10003; ${okLabel}</span>`
    : `<span class="pc-chip pend">${pendLabel}</span>`;
  cont.innerHTML =
    chip(chips.contacto, 'Contacto', 'Contacto') +
    `<button type="button" class="pc-chip-btn" onclick="pcToggleEntrega()">${chip(chips.entrega, 'Entrega', 'Entrega &middot; agregar')}</button>` +
    chip(chips.fiscal, 'Fiscal', 'Fiscal &middot; al subir a Operam');
}

function renderHistorialCliente(cotizaciones) {
  const panel = document.getElementById('historial-cliente-panel');
  if (!panel) return;
  panel.style.display = 'block';
  panel.innerHTML = `<div class="section-header">Cotizaciones previas (${cotizaciones.length})</div>` +
    cotizaciones.slice(-5).reverse().map(c => {
      const fecha = new Date(c.fecha).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
      return `<div class="cot-mini">
        <span>${fecha} - ${c.tier} - $${c.total?.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
        ${c.hasData ? `<button class="btn btn-sm btn-secondary" onclick="cargarCotizacion(${c.id})">Cargar</button>` : ''}
        ${c.hasPdf ? `<a href="/api/cotizacion/pdf/${c.id}" target="_blank" class="btn btn-sm btn-secondary">PDF</a>` : ''}
        <button class="btn btn-sm btn-primary" onclick="subirCotizacionOperam(${c.id})">Subir a Operam</button>
      </div>`;
    }).join('');
}
window.renderHistorialCliente = renderHistorialCliente;

async function subirCotizacionOperam(id) {
  const btn = event?.target;
  if (btn) { btn.disabled = true; btn.textContent = 'Subiendo...'; }
  try {
    const res = await api(`/api/cotizacion/operam/${id}`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error');
    alert(`Cotizacion subida a Operam${data.folio ? ' - Folio: ' + data.folio : ''}`);
  } catch (e) {
    alert('Error al subir: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Subir a Operam'; }
  }
}
window.subirCotizacionOperam = subirCotizacionOperam;

// Formalizar una pre-cotizacion desde su tarjeta (issue #66, AC1). Encadena las
// dos piezas existentes y desacopladas: (1) registro directo de la cotizacion
// (busca el cliente por RFC en Operam y persiste el folio -> deja de ser PRE);
// (2) si Operam no halla al cliente, guia al vendedor al alta (flujo existente),
// prellenando el formulario con los datos de la cotizacion via cargarCotizacion;
// tras el alta, vuelve a tocar "Completar" para registrar. El paso lo decide la
// regla pura siguientePasoFormalizacion sobre la respuesta del servidor.
async function completarPreCotizacion(id) {
  const btn = event?.target;
  if (btn) { btn.disabled = true; btn.textContent = 'Completando...'; }
  let resultado;
  try {
    const res = await api(`/api/cotizacion/operam/${id}`, { method: 'POST' });
    let data = {};
    try { data = await res.json(); } catch {}
    resultado = { ok: res.ok, status: res.status, folio: data.folio, error: data.error };
  } catch (e) {
    resultado = { ok: false, status: 0, error: e.message };
  }
  const paso = siguientePasoFormalizacion(resultado);
  if (paso === 'listo') {
    alert(`Cotizacion registrada en Operam${resultado.folio ? ' - Folio: ' + resultado.folio : ''}`);
    showHistorial();
    return;
  }
  if (btn) { btn.disabled = false; btn.textContent = 'Completar'; }
  if (paso === 'alta') {
    alert('El cliente aun no esta en Operam. Damoslo de alta primero (el formulario se prellena con los datos de la cotizacion) y al terminar vuelve a tocar "Completar".');
    await cargarCotizacion(id); // prellena el formulario y cambia a la vista Cotizar
    abrirAcordeonAlta();
    return;
  }
  alert('No se pudo completar: ' + (resultado.error || 'error desconocido'));
}
window.completarPreCotizacion = completarPreCotizacion;

// === TABS ===
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.toggle('active', t.id === `tab-${name}`));
  if (name === 'resumen') updateResumen();
  if (name === 'envio') {
    updateShippingSummary();
    // Auto-cotizar con CP del cliente si aplica
    const cpCliente = document.getElementById('cl-cp-entrega')?.value?.trim();
    const cpEnvia = document.getElementById('envia-cp');
    if (cpCliente && /^\d{5}$/.test(cpCliente) && cpEnvia) {
      cpEnvia.value = cpCliente;
      const opt = document.getElementById('shipping-option');
      if (opt && opt.value === 'none' && state.cart.size > 0) {
        opt.value = 'envia';
        document.getElementById('shipping-envia').style.display = 'block';
        document.getElementById('shipping-manual').style.display = 'none';
      }
      if (opt?.value === 'envia' && state.cart.size > 0) {
        setTimeout(cotizarEnvia, 100);
      }
    }
  }
  updateTabIndicators();
}

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
  state.cart.set(skuFinal.sku, { product: skuProduct, cantidad: (prev?.cantidad || 0) + cantidad });

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

async function showHistorial() {
  ocultarTodasLasVistas();
  document.getElementById('historial-view').style.display = 'block';

  const loadingEl = document.getElementById('historial-loading');
  loadingEl.style.display = 'block';
  document.getElementById('historial-list').innerHTML = '';
  document.getElementById('cotizaciones-tablero').innerHTML = '';

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
  const esTablero = cotizacionesModo === 'tablero';
  const btnLista = document.getElementById('btn-cot-modo-lista');
  const btnTablero = document.getElementById('btn-cot-modo-tablero');
  btnLista.classList.toggle('btn-primary', !esTablero);
  btnLista.classList.toggle('btn-secondary', esTablero);
  btnTablero.classList.toggle('btn-primary', esTablero);
  btnTablero.classList.toggle('btn-secondary', !esTablero);
  tableroEl.style.display = esTablero ? 'flex' : 'none';
  listEl.style.display = esTablero ? 'none' : 'block';
  if (esTablero) {
    listEl.innerHTML = '';
    tableroEl.innerHTML = buildTableroCotizacionesHtml(ultimasCotizaciones);
    return;
  }
  tableroEl.innerHTML = '';

  if (!ultimasCotizaciones.length) {
    listEl.innerHTML = '<div class="empty-state"><p>Sin cotizaciones registradas.</p></div>';
    return;
  }

  listEl.innerHTML = ultimasCotizaciones.slice().reverse().map(c => {
    const fecha = new Date(c.fecha).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
    const btnPdf = c.hasPdf
      ? `<a href="/api/cotizacion/pdf/${c.id}" target="_blank" class="btn btn-secondary btn-sm">Ver PDF</a>`
      : `<button class="btn btn-secondary btn-sm" disabled title="PDF no disponible">Ver PDF</button>`;
    const btnCargar = c.hasData
      ? `<button class="btn btn-primary btn-sm" onclick="cargarCotizacion(${c.id})">Cargar</button>`
      : `<button class="btn btn-secondary btn-sm" disabled title="Datos no disponibles">Cargar</button>`;
    // Estado PRE / #Operam (issue #63) visible en el Historial; "Completar"
    // (issue #66) formaliza la pre-cotizacion desde su tarjeta. Solo aparece
    // mientras la cotizacion sigue siendo PRE.
    const badge = badgeFolioOperamHtml(c);
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
          ${btnPdf}
          ${btnCargar}
          ${btnCompletar}
        </div>
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
    showHistorial();
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
      <div class="cot-card-cliente">${escapeHtml(o.nombre || 'Sin nombre')}${badge}</div>
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
  for (const v of ['app-view', 'historial-view', 'hoy-view', 'prospectos-view', 'pipeline-view']) {
    const el = document.getElementById(v);
    if (el) el.style.display = 'none';
  }
  cerrarMenuMas();
  cerrarMenuNuevo();
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
    showHistorial();
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

// Acciones del boton + global (issue #54). "Nueva cotizacion" lleva a la vista
// de cotizar existente (la app abre ahi). "Nuevo prospecto" abre la captura
// minima EXISTENTE: el formulario de prospecto que ya vive en la vista de
// Prospectos. No se reinventa la captura ni la cotizacion: el + solo enruta.
window.nuevaCotizacion = () => {
  cerrarMenuNuevo();
  ocultarTodasLasVistas();
  document.getElementById('app-view').style.display = 'block';
  marcarNavActivo('nav-cotizar');
};
window.nuevoProspecto = () => {
  cerrarMenuNuevo();
  showProspectos();
  marcarNavActivo('nav-mas');
  abrirCapturaRapida();
};

async function cargarCotizacion(id) {
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
    for (const item of (cot.items || [])) {
      if (item.codigo === 'ENVIO') continue;
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

      state.cart.set(item.codigo, { product: cartProduct, cantidad: item.cantidad });
    }

    // Notas y vigencia
    if (cot.notas) document.getElementById('resumen-notas').value = cot.notas.map(n => `- ${n}`).join('\n');

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

  // Tab indicator para cliente
  document.getElementById('tab-cliente').addEventListener('input', updateTabIndicators);

  // Botones Siguiente
  document.getElementById('btn-sig-cliente').addEventListener('click', () => switchTab('productos'));
  document.getElementById('btn-sig-productos').addEventListener('click', () => switchTab('envio'));
  document.getElementById('btn-sig-envio').addEventListener('click', () => switchTab('resumen'));

  // Shipping option toggle
  document.getElementById('shipping-option').addEventListener('change', e => {
    const val = e.target.value;
    document.getElementById('shipping-envia').style.display = val === 'envia' ? 'block' : 'none';
    document.getElementById('shipping-manual').style.display = val === 'manual' ? 'block' : 'none';
    // Pre-llenar CP de envia con el del cliente si está vacío
    if (val === 'envia') {
      const cpCliente = document.getElementById('cl-cp-entrega')?.value?.trim();
      const cpEnvia = document.getElementById('envia-cp');
      if (cpEnvia && cpCliente && !cpEnvia.value) cpEnvia.value = cpCliente;
    }
    // Limpiar costo si cambia la opción
    if (val !== 'envia' && val !== 'manual') {
      document.getElementById('shipping-cost').value = '';
    }
    updateResumen();
    updateTabIndicators();
  });
  document.getElementById('btn-cotizar-envia').addEventListener('click', cotizarEnvia);
  document.getElementById('envia-cp').addEventListener('keydown', e => { if (e.key === 'Enter') cotizarEnvia(); });
  document.getElementById('shipping-cost').addEventListener('input', () => updateResumen());
  document.getElementById('shipping-desc').addEventListener('input', () => updateResumen());

  // Operam: buscar cliente
  const operamSearchEl = document.getElementById('operam-search');
  if (operamSearchEl) {
    let operamTimer;
    operamSearchEl.addEventListener('input', e => {
      clearTimeout(operamTimer);
      operamTimer = setTimeout(() => buscarClienteOperam(e.target.value), 300);
    });
    operamSearchEl.addEventListener('keydown', e => {
      if (e.key === 'Enter') { clearTimeout(operamTimer); buscarClienteOperam(e.target.value); }
    });
    operamSearchEl.addEventListener('blur', () => {
      setTimeout(() => {
        document.getElementById('operam-dropdown').style.display = 'none';
      }, 150);
    });
  }
  document.getElementById('btn-buscar-operam')?.addEventListener('click', () => {
    buscarClienteOperam(document.getElementById('operam-search').value);
  });
  const btnUsarDom = document.getElementById('btn-usar-domicilio');
  if (btnUsarDom) btnUsarDom.addEventListener('click', usarDomicilioOperam);

  // PDF, HTML & WhatsApp
  document.getElementById('btn-pdf').addEventListener('click', generatePDF);
  document.getElementById('btn-html').addEventListener('click', generateHTML);
  document.getElementById('btn-whatsapp').addEventListener('click', shareWhatsApp);
  document.getElementById('btn-nueva').addEventListener('click', nuevaCotizacion);

  // Subir a Operam
  document.getElementById('btn-subir-operam')?.addEventListener('click', () => {
    if (!state.lastCotizacionId) { alert('Genera el PDF primero'); return; }
    subirCotizacionOperam(state.lastCotizacionId);
  });

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
    rfc: getVal('csf-rfc'),
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
    regimenFiscal: getVal('manual-regimen-fiscal'),
    usoCfdi: getVal('manual-uso-cfdi'),
    cp: getVal('manual-cp'),
    municipio: getVal('manual-municipio'),
    estado: getVal('manual-estado'),
    pais: getVal('manual-pais'),
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
  if (!datos.rfc) {
    const msg = 'El RFC es obligatorio';
    if (errDiv) { errDiv.textContent = msg; errDiv.style.display = ''; }
    return;
  }
  if (!datos.razonSocial) {
    const msg = 'La razon social es obligatoria';
    if (errDiv) { errDiv.textContent = msg; errDiv.style.display = ''; }
    return;
  }
  if (!datos.nombreCorto) {
    const msg = 'El nombre corto es obligatorio';
    if (errDiv) { errDiv.textContent = msg; errDiv.style.display = ''; }
    return;
  }
  if (errDiv) errDiv.style.display = 'none';

  altaState.datos = {
    rfc: datos.rfc,
    razonSocial: datos.razonSocial,
    nombreCorto: datos.nombreCorto,
    idcif: datos.idcif || '',
    regimenFiscal: datos.regimenFiscal || '',
    usoCfdi: datos.usoCfdi || 'S01',
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

async function altaDedupCorrer(rfc, razonSocial) {
  const dedupDiv = document.getElementById('alta-dedup-resultado');
  if (!dedupDiv) { altaDedupDesbloquear(); return; }

  dedupDiv.innerHTML = '<p style="font-size:13px;color:var(--text-light)">Verificando duplicados...</p>';
  dedupDiv.style.display = '';

  try {
    const params = new URLSearchParams({ rfc, nombre: razonSocial || '' });
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
    const domicilios = await res.json();
    altaDedupMostrarDomicilios(clienteId, domicilios);
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
  const cliente = buildClienteDesdeAlta(altaState);
  switchTab('cliente');
  await seleccionarClienteOperam(cliente);
  // Muestra la tarjeta del cliente (variante B, #82) en vez del form plano.
  pcState.cliente = { ...cliente, tipo: 'operam' };
  pcRenderTarjeta();
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
