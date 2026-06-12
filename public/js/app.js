import {
  altaCsfResultadoParseo,
  combinarTelefonoConCodigo,
  validarTelefono,
  separarTelefonoCodigo,
  calcularDiffFiscal,
  buildDiffFiscalHtml,
  buildDedupExactoConDiffHtml,
  buildAltaDarDeAltaPayload,
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
  buildReporteImportacionHtml,
  escapeHtml,
  necesitaCanal,
  validarCanalCotizacion,
  buildCanalModalHtml,
  MOTIVOS_NO_UTIL,
  puedeArrastrar,
  buildTableroHtml,
  buildMotivoNoUtilModalHtml,
} from './prospectos-logica.js';
import {
  puedeArrastrarCotizacion,
  buildTableroCotizacionesHtml,
} from './cotizaciones-logica.js';

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
  document.getElementById('seguimiento-view').style.display = 'none';
  document.getElementById('prospectos-view').style.display = 'none';
  document.getElementById('login-view').style.display = 'flex';
  document.getElementById('login-pin').value = '';
}

// === APP INIT ===
async function showApp() {
  document.getElementById('login-view').style.display = 'none';
  document.getElementById('historial-view').style.display = 'none';
  document.getElementById('app-view').style.display = 'block';
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

// === TAB INDICATORS ===
function updateTabIndicators() {
  const dotProductos = document.getElementById('dot-productos');
  const dotCliente = document.getElementById('dot-cliente');
  const dotEnvio = document.getElementById('dot-envio');

  if (dotProductos) dotProductos.classList.toggle('visible', state.cart.size > 0);
  if (dotCliente) dotCliente.classList.toggle('visible', !!(document.getElementById('cl-razon-social')?.value?.trim()));
  if (dotEnvio) {
    const opt = document.getElementById('shipping-option')?.value;
    dotEnvio.classList.toggle('visible', opt && opt !== 'none');
  }
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
          <div class="envia-rate-carrier">${carrier}${esRecomendado ? ' <span class="badge-rec">Recomendado</span>' : ''}</div>
          <div class="envia-rate-servicio">${servicio}${dias ? ' · ' + dias : ''}</div>
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
    desc: `${carrier} ${servicio}`.trim(),
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
  document.getElementById('panel-buscar').style.display = 'block';
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
  fill('cl-cp-fiscal',      cliente.cp);
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
  document.getElementById('app-view').style.display = 'none';
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
    return `
      <div class="cot-card">
        <div class="cot-card-header">
          <div>
            <div class="cot-card-cliente">${c.cliente || 'Sin nombre'}</div>
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

// === SEGUIMIENTO ===
const PASO_LABELS = {
  dia2: 'Primer seguimiento',
  dia7: 'Segundo seguimiento',
  dia21: 'Por vencer',
  vencida: 'Vencida',
};

async function showSeguimiento() {
  document.getElementById('app-view').style.display = 'none';
  document.getElementById('seguimiento-view').style.display = 'block';

  const loadingEl = document.getElementById('seguimiento-loading');
  const listEl = document.getElementById('seguimiento-list');
  loadingEl.style.display = 'block';
  listEl.innerHTML = '';

  try {
    const res = await api('/api/seguimiento');
    const cola = await res.json();
    loadingEl.style.display = 'none';
    actualizarBadgeSeguimiento(cola.length);

    if (!cola.length) {
      listEl.innerHTML = '<div class="empty-state"><p>Sin seguimientos pendientes. 🎉</p></div>';
      return;
    }

    listEl.innerHTML = cola.map(item => {
      const fecha = new Date(item.fecha).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
      const btnWa = item.waLink
        ? `<a href="${item.waLink}" target="_blank" class="btn btn-primary btn-sm">WhatsApp</a>`
        : `<button class="btn btn-secondary btn-sm" disabled title="Sin telefono registrado">WhatsApp</button>`;
      return `
        <div class="cot-card">
          <div class="cot-card-header">
            <div>
              <div class="cot-card-cliente">${item.cliente || 'Sin nombre'}</div>
              <div class="cot-card-meta">${PASO_LABELS[item.paso] || item.paso} · cotizada el ${fecha} (hace ${item.dias} dias) · ${item.totalPiezas} pzs</div>
            </div>
            <div>
              <div class="cot-card-total">$${fmt(item.total)}</div>
            </div>
          </div>
          <div class="cot-card-actions">
            ${btnWa}
            <button class="btn btn-secondary btn-sm" onclick="marcarSeguimiento(${item.id}, '${item.paso}')">✓ Hecho</button>
            <button class="btn btn-secondary btn-sm" onclick="cambiarEstadoCotizacion(${item.id}, 'ganada')">Ganada</button>
            <button class="btn btn-secondary btn-sm" onclick="cambiarEstadoCotizacion(${item.id}, 'perdida')">Perdida</button>
          </div>
        </div>
      `;
    }).join('');
  } catch (e) {
    loadingEl.textContent = 'Error cargando seguimientos';
  }
}

async function marcarSeguimiento(id, paso) {
  try {
    const res = await api(`/api/seguimiento/${id}`, { method: 'POST', body: { paso } });
    if (!res.ok) { alert('No se pudo registrar el seguimiento'); return; }
    showSeguimiento();
  } catch (e) {
    alert('Error de conexion');
  }
}

async function cambiarEstadoCotizacion(id, estado) {
  try {
    const res = await api(`/api/cotizacion/${id}/estado`, { method: 'PATCH', body: { estado } });
    if (!res.ok) { alert('No se pudo actualizar el estado'); return; }
    showSeguimiento();
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

async function cargarBadgeSeguimiento() {
  try {
    const res = await api('/api/seguimiento');
    if (!res.ok) return;
    const cola = await res.json();
    actualizarBadgeSeguimiento(cola.length);
  } catch (e) { /* sin red no hay badge */ }
}

window.marcarSeguimiento = marcarSeguimiento;
window.cambiarEstadoCotizacion = cambiarEstadoCotizacion;

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
  document.getElementById('app-view').style.display = 'none';
  document.getElementById('prospectos-view').style.display = 'block';
  poblarSelectoresProspecto();
  cargarListaProspectos();
  cargarMotivosNoUtil();
  cargarImportarFeria();
}

// Importacion de Feria/Expo (issue #47): solo admin. El select trae el
// vendedor default para las filas cuyo Dispositivo no matchea a nadie.
async function cargarImportarFeria() {
  const cont = document.getElementById('prospectos-importar-admin');
  if (!cont || state.user.role !== 'admin') return;
  cont.style.display = 'block';
  const sel = document.getElementById('imp-feria-vendedor');
  if (sel.options.length) return;
  try {
    const res = await api('/api/vendedores');
    if (!res.ok) return;
    const vendedores = await res.json();
    sel.innerHTML = vendedores.map(v => `<option value="${escapeHtml(v.name)}">${escapeHtml(v.name)}</option>`).join('');
    sel.value = state.user.name;
  } catch (e) { /* sin red no hay importacion */ }
}

async function importarFeria() {
  const errEl = document.getElementById('imp-feria-error');
  const reporteEl = document.getElementById('imp-feria-reporte');
  const input = document.getElementById('imp-feria-archivo');
  const btn = document.getElementById('btn-importar-feria');
  errEl.style.display = 'none';
  reporteEl.innerHTML = '';
  const archivo = input.files[0];
  if (!archivo) {
    errEl.textContent = 'Selecciona el archivo XLSX de la expo';
    errEl.style.display = 'block';
    return;
  }
  const fd = new FormData();
  fd.append('archivo', archivo);
  fd.append('vendedor', document.getElementById('imp-feria-vendedor').value);
  btn.disabled = true;
  try {
    const res = await api('/api/admin/prospectos/importar', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) {
      errEl.textContent = data.error || 'No se pudo importar el archivo';
      errEl.style.display = 'block';
      return;
    }
    reporteEl.innerHTML = buildReporteImportacionHtml(data);
    input.value = '';
    cargarListaProspectos();
  } catch (e) {
    errEl.textContent = 'Error de conexion';
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
  }
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

// Conmutador kanban/lista (issue #49): la cola "Que toca hoy" permanece fija
// sobre ambas vistas; la preferencia del usuario se recuerda en localStorage.
let prospectosModo = localStorage.getItem('prospectosModo') === 'tablero' ? 'tablero' : 'lista';
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
  const tableroEl = document.getElementById('prospectos-tablero');
  const esTablero = prospectosModo === 'tablero';
  document.getElementById('prospectos-contenido').classList.toggle('modo-tablero', esTablero);
  const btnLista = document.getElementById('btn-modo-lista');
  const btnTablero = document.getElementById('btn-modo-tablero');
  btnLista.classList.toggle('btn-primary', !esTablero);
  btnLista.classList.toggle('btn-secondary', esTablero);
  btnTablero.classList.toggle('btn-primary', esTablero);
  btnTablero.classList.toggle('btn-secondary', !esTablero);
  tableroEl.style.display = esTablero ? 'flex' : 'none';
  tituloEl.style.display = !esTablero && ultimosProspectos.length ? 'block' : 'none';
  listEl.style.display = esTablero ? 'none' : 'block';
  const colaPorId = new Map(ultimaColaProspectos.map(i => [i.id, i]));
  if (esTablero) {
    listEl.innerHTML = '';
    tableroEl.innerHTML = buildTableroHtml(ultimosProspectos, colaPorId);
    return;
  }
  tableroEl.innerHTML = '';
  if (!ultimosProspectos.length) {
    listEl.innerHTML = '<div class="empty-state"><p>Sin prospectos capturados.</p></div>';
    return;
  }
  listEl.innerHTML = ultimosProspectos.slice().reverse()
    .map(p => buildProspectoCardHtml(p, colaPorId.get(p.id))).join('');
}

function setModoProspectos(modo) {
  prospectosModo = modo;
  localStorage.setItem('prospectosModo', modo);
  renderProspectos();
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
    tablero.querySelectorAll('.tablero-col.drop-ok').forEach(c => c.classList.remove('drop-ok'));
  });
}

async function soltarEnColumna(origen, destino) {
  if (!puedeArrastrar(origen.col, destino)) {
    avisoTablero(destino === 'cotizado'
      ? 'Cotizado no acepta arrastres: solo una cotización real mueve ahí'
      : 'Movimiento inválido: las etapas avanzan un paso a la vez');
    return;
  }
  if (destino === 'no_util') {
    const motivo = await pedirMotivoNoUtil();
    if (!motivo) return;
    patchEtapaProspecto(origen.id, { etapa: 'no_util', motivo }, 'No se pudo registrar la salida');
    return;
  }
  patchEtapaProspecto(origen.id, { etapa: destino }, 'No se pudo avanzar la etapa');
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
    cargarListaProspectos();
    cargarMotivosNoUtil();
  } catch (e) {
    alert('Error de conexion');
  }
}

function avanzarEtapaProspecto(id, etapa) {
  patchEtapaProspecto(id, { etapa }, 'No se pudo avanzar la etapa');
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
    cargarListaProspectos();
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
    cargarListaProspectos();
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

window.avanzarEtapaProspecto = avanzarEtapaProspecto;
window.marcarNoUtilProspecto = marcarNoUtilProspecto;
window.registrarToqueProspecto = registrarToqueProspecto;
window.toggleHistorialProspecto = toggleHistorialProspecto;
window.sugerirNoUtilProspecto = sugerirNoUtilProspecto;
window.agendarReunionProspecto = agendarReunionProspecto;
window.resultadoReunionProspecto = resultadoReunionProspecto;
window.resultadoReunionNoUtilProspecto = resultadoReunionNoUtilProspecto;
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

  // Historial
  document.getElementById('btn-historial').addEventListener('click', showHistorial);
  document.getElementById('btn-volver-app').addEventListener('click', () => {
    document.getElementById('historial-view').style.display = 'none';
    document.getElementById('app-view').style.display = 'block';
  });
  document.getElementById('btn-cot-modo-lista').addEventListener('click', () => setModoCotizaciones('lista'));
  document.getElementById('btn-cot-modo-tablero').addEventListener('click', () => setModoCotizaciones('tablero'));
  initDragEnTablero('cotizaciones-tablero', {
    atributo: 'col',
    puedeSoltar: puedeArrastrarCotizacion,
    alSoltar: soltarEnColumnaCotizacion,
  });

  // Seguimiento
  document.getElementById('btn-seguimiento').addEventListener('click', showSeguimiento);
  document.getElementById('btn-volver-seguimiento').addEventListener('click', () => {
    document.getElementById('seguimiento-view').style.display = 'none';
    document.getElementById('app-view').style.display = 'block';
  });

  // Prospectos
  document.getElementById('btn-prospectos').addEventListener('click', showProspectos);
  document.getElementById('btn-volver-prospectos').addEventListener('click', () => {
    document.getElementById('prospectos-view').style.display = 'none';
    document.getElementById('app-view').style.display = 'block';
  });
  document.getElementById('btn-nuevo-prospecto').addEventListener('click', () => {
    const form = document.getElementById('prospecto-form');
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
  });
  document.getElementById('btn-guardar-prospecto').addEventListener('click', guardarProspecto);
  document.getElementById('btn-modo-lista').addEventListener('click', () => setModoProspectos('lista'));
  document.getElementById('btn-modo-tablero').addEventListener('click', () => setModoProspectos('tablero'));
  initDragEnTablero('prospectos-tablero', {
    atributo: 'etapa',
    puedeSoltar: puedeArrastrar,
    alSoltar: soltarEnColumna,
  });
  document.getElementById('btn-importar-feria').addEventListener('click', importarFeria);
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
    catalogos.listas_precios.map(l => `<option value="${l.id}">${l.id} — ${l.nombre}</option>`).join('');

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

function altaCotizarAhora() {
  const customerId = altaState.customer_id;
  if (!customerId) return;
  const panel = document.getElementById('panel-alta-cliente');
  if (panel) panel.style.display = 'none';
  const buscarPanel = document.getElementById('panel-buscar');
  if (buscarPanel) buscarPanel.style.display = 'none';
  const searchInput = document.getElementById('operam-search');
  if (searchInput) { searchInput.value = altaCsfState.datos?.rfc || ''; }
  document.getElementById('btn-buscar-operam')?.click();
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
