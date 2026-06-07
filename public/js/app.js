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

// === PDF GENERATION ===
async function generatePDF() {
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
        telefono: document.getElementById('cl-telefono').value,
        nombreEntrega: document.getElementById('cl-nombre-entrega').value,
        calle: document.getElementById('cl-calle').value,
        numInt: document.getElementById('cl-num-int').value,
        colonia: document.getElementById('cl-colonia').value,
        cpEntrega: document.getElementById('cl-cp-entrega').value,
        municipio: document.getElementById('cl-municipio').value,
        estado: document.getElementById('cl-estado').value,
        celEntrega: document.getElementById('cl-cel-entrega').value,
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
        telefono: document.getElementById('cl-telefono').value,
        nombreEntrega: document.getElementById('cl-nombre-entrega').value,
        calle: document.getElementById('cl-calle').value,
        numInt: document.getElementById('cl-num-int').value,
        colonia: document.getElementById('cl-colonia').value,
        cpEntrega: document.getElementById('cl-cp-entrega').value,
        municipio: document.getElementById('cl-municipio').value,
        estado: document.getElementById('cl-estado').value,
        celEntrega: document.getElementById('cl-cel-entrega').value,
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
  setClienteModo('buscar');
  csfDatosExtraidos = null;
  csfClienteExistente = null;
  csfDiffPendiente = null;
  const manualStatus = document.getElementById('manual-rfc-status');
  if (manualStatus) manualStatus.style.display = 'none';
  const manualPanelAct = document.getElementById('manual-panel-actualizar');
  if (manualPanelAct) manualPanelAct.style.display = 'none';
  const manualPanelConf = document.getElementById('manual-panel-confirmacion');
  if (manualPanelConf) manualPanelConf.style.display = 'none';
  const csfFile = document.getElementById('csf-file');
  if (csfFile) csfFile.value = '';
  const csfStatus = document.getElementById('csf-status');
  if (csfStatus) csfStatus.style.display = 'none';
  const csfPreview = document.getElementById('csf-preview');
  if (csfPreview) csfPreview.style.display = 'none';
  resetFlujoGuiado();
  switchTab('cliente');
  renderProducts();
  updateTierBar();
  updateCartSummary();
  updateResumen();
  renderCartLines();
}

// === MODO CLIENTE ===
function setClienteModo(modo) {
  document.querySelectorAll('.modo-btn').forEach(b => b.classList.toggle('active', b.dataset.modo === modo));
  document.querySelectorAll('.cliente-panel').forEach(p => p.style.display = 'none');
  document.getElementById(`panel-${modo}`).style.display = 'block';
}
window.setClienteModo = setClienteModo;

// === CSF ===
let csfDatosExtraidos = null;
let csfClienteExistente = null;

const CSF_FORM_FIELD_IDS = [
  'cl-razon-social', 'cl-nombre-corto', 'cl-rfc', 'cl-cp-fiscal', 'cl-telefono',
  'cl-nombre-entrega', 'cl-calle', 'cl-num-int', 'cl-colonia', 'cl-cp-entrega',
  'cl-municipio', 'cl-estado', 'cl-cel-entrega', 'cl-email-entrega',
];

export function buildPreFillMap(datos) {
  return {
    'cl-razon-social': datos.razonSocial,
    'cl-rfc': datos.rfc,
    'cl-cp-fiscal': datos.cp,
    'cl-calle': datos.calle,
    'cl-num-int': datos.numInt,
    'cl-colonia': datos.colonia,
    'cl-cp-entrega': datos.cp,
    'cl-municipio': datos.municipio,
    'cl-estado': datos.estado,
  };
}

export function applyPreFillMap(mapa, getEl) {
  for (const [id, val] of Object.entries(mapa)) {
    const el = getEl(id);
    if (el) el.value = val;
  }
}

const _AREA_POR_PAIS = { MX: '1', US: '5', CA: '7' };

export function buildPaisConfig(pais) {
  if (!pais || pais === 'MX') {
    return { country: 'MX', curr_code: 'MXN', area_pais: '1' };
  }
  return { country: pais, curr_code: 'USD', area_pais: _AREA_POR_PAIS[pais] || '6' };
}

export function findRfcMatch(clientes, rfc) {
  if (!rfc) return null;
  const rfcNorm = rfc.toLowerCase();
  return clientes.find(c => (c.rfc || '').toLowerCase() === rfcNorm) || null;
}

export function shouldTriggerRfcSearch(rfc) {
  if (!rfc) return false;
  return rfc.trim().length >= 12;
}

export function buildCsfDuplicadoBanner(cliente) {
  return 'Este cliente ya esta registrado en Operam (ID ' + cliente.id + ' -- ' + cliente.name + '). Sus datos han sido cargados en el formulario.';
}

export function buildClienteSnapshot(fieldIds, getVal) {
  const snap = {};
  for (const id of fieldIds) {
    snap[id] = getVal(id);
  }
  return snap;
}

export function buildOperamPreFillMap(cliente) {
  return {
    'cl-razon-social':   cliente.name,
    'cl-nombre-corto':   cliente.ref,
    'cl-rfc':            cliente.rfc,
    'cl-cp-fiscal':      cliente.cp,
    'cl-telefono':       cliente.telefono,
    'cl-nombre-entrega': cliente.nombreEntrega,
    'cl-calle':          cliente.calle,
    'cl-num-int':        cliente.numInt,
    'cl-colonia':        cliente.colonia,
    'cl-cp-entrega':     cliente.cp,
    'cl-municipio':      cliente.municipio,
    'cl-estado':         cliente.estado,
    'cl-cel-entrega':    cliente.telefono,
    'cl-email-entrega':  cliente.email,
  };
}

export function buildEntregaPayload(getVal) {
  return {
    br_name: getVal('cl-nombre-entrega'),
    addr_street: getVal('cl-calle'),
    addr_interior: getVal('cl-num-int'),
    addr_colony: getVal('cl-colonia'),
    addr_zip: getVal('cl-cp-entrega'),
    addr_city: getVal('cl-municipio'),
    addr_state: getVal('cl-estado'),
    phone: getVal('cl-cel-entrega'),
    email: getVal('cl-email-entrega'),
  };
}

export function calcularDiff(snapshot, formValues) {
  const diff = {};
  for (const id of Object.keys(snapshot)) {
    if (!(id in formValues)) continue;
    const anterior = String(snapshot[id] == null ? '' : snapshot[id]).trim();
    const nuevo = String(formValues[id] == null ? '' : formValues[id]).trim();
    if (anterior !== nuevo) {
      diff[id] = { anterior, nuevo };
    }
  }
  return diff;
}

const CSF_FIELD_LABELS = {
  'cl-razon-social':   'Razon Social',
  'cl-nombre-corto':   'Nombre Corto',
  'cl-rfc':            'RFC',
  'cl-cp-fiscal':      'CP Fiscal',
  'cl-telefono':       'Telefono',
  'cl-nombre-entrega': 'Nombre de Entrega',
  'cl-calle':          'Calle',
  'cl-num-int':        'Num Interior',
  'cl-colonia':        'Colonia',
  'cl-cp-entrega':     'CP Entrega',
  'cl-municipio':      'Municipio',
  'cl-estado':         'Estado',
  'cl-cel-entrega':    'Celular Entrega',
  'cl-email-entrega':  'Email Entrega',
};

export function buildConfirmacionItems(diff) {
  return Object.entries(diff).map(([fieldId, { anterior, nuevo }]) => ({
    fieldId,
    label: CSF_FIELD_LABELS[fieldId] || fieldId,
    anterior,
    nuevo,
  }));
}

async function procesarCSF(input) {
  const file = input.files[0];
  if (!file) return;

  const statusEl = document.getElementById('csf-status');
  const previewEl = document.getElementById('csf-preview');
  statusEl.style.display = 'block';
  statusEl.className = 'alert alert-info';
  statusEl.textContent = 'Leyendo PDF...';
  previewEl.style.display = 'none';

  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let textoTotal = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      textoTotal += content.items.map(item => item.str).join(' ') + '\n';
    }

    const datos = parsearCSFTexto(textoTotal);
    if (!datos.rfc) {
      statusEl.className = 'alert alert-error';
      statusEl.textContent = 'No se pudo extraer el RFC. Verifica que el PDF sea una CSF valida.';
      return;
    }

    csfDatosExtraidos = datos;
    csfClienteExistente = null;

    // Pre-fill form with CSF data first
    applyPreFillMap(
      { ...buildPreFillMap(datos), 'cl-pais': 'MX' },
      (id) => document.getElementById(id)
    );

    // Guard: buscar RFC en Operam antes de mostrar boton Crear
    statusEl.style.display = 'block';
    statusEl.className = 'alert alert-info';
    statusEl.textContent = 'Verificando RFC en Operam...';

    try {
      const rfcRes = await api('/api/operam/clientes?q=' + encodeURIComponent(datos.rfc));
      if (rfcRes.ok) {
        const clientes = await rfcRes.json();
        const match = findRfcMatch(clientes, datos.rfc);
        if (match) {
          const getVal = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
          applyPreFillMap(buildOperamPreFillMap(match), (id) => document.getElementById(id));
          const snap = buildClienteSnapshot(CSF_FORM_FIELD_IDS, getVal);
          csfClienteExistente = { id: match.id, nombre: match.name, snapshot: snap };
          const btnCrear = document.getElementById('btn-crear-csf');
          if (btnCrear) btnCrear.textContent = 'Actualizar en Operam';
          statusEl.style.display = 'block';
          statusEl.className = 'alert alert-warning';
          statusEl.textContent = buildCsfDuplicadoBanner(match);
          previewEl.style.display = 'block';
          document.getElementById('csf-datos-preview').innerHTML = `
            <strong>${datos.razonSocial}</strong><br>
            RFC: ${datos.rfc}<br>
            Domicilio: ${[datos.calle, datos.numExt, datos.colonia, datos.cp, datos.municipio, datos.estado].filter(Boolean).join(', ')}<br>
            Regimen: ${datos.regimenFiscal}
          `;
          return;
        }
      }
    } catch {}

    // No match: flujo de creacion normal
    statusEl.style.display = 'none';
    previewEl.style.display = 'block';

    document.getElementById('csf-datos-preview').innerHTML = `
      <strong>${datos.razonSocial}</strong><br>
      RFC: ${datos.rfc}<br>
      Domicilio: ${[datos.calle, datos.numExt, datos.colonia, datos.cp, datos.municipio, datos.estado].filter(Boolean).join(', ')}<br>
      Regimen: ${datos.regimenFiscal}
    `;
  } catch (e) {
    statusEl.className = 'alert alert-error';
    statusEl.textContent = 'Error leyendo el PDF: ' + e.message;
  }
}
window.procesarCSF = procesarCSF;

function parsearCSFTexto(texto) {
  const get = (regex) => { const m = texto.match(regex); return m ? m[1].trim() : ''; };

  const rfc = get(/R\.?F\.?C\.?\s*:?\s*([A-Z&Ñ][A-Z0-9]{10,12})/i);

  const razonSocial = (() => {
    const pm = get(/Denominaci[oó]n\/?Raz[oó]n\s*Social\s*:\s*(.+?)(?=\s*R\.?F\.?C|\s*idCIF)/is);
    if (pm) return pm.replace(/\s+/g, ' ').trim();
    const nombre = get(/Nombre\s*(?:\(s\))?\s*:\s*([A-ZÁÉÍÓÚÑ ]+?)(?=\s+(?:Primer|R\.?F\.?C))/i);
    const ap1 = get(/Primer\s*Apellido\s*:\s*([A-ZÁÉÍÓÚÑ ]+?)(?=\n|\s{2,})/i);
    const ap2 = get(/Segundo\s*Apellido\s*:\s*([A-ZÁÉÍÓÚÑ ]+?)(?=\n|\s{2,})/i);
    return [nombre, ap1, ap2].filter(Boolean).join(' ').trim();
  })();

  return {
    rfc,
    razonSocial,
    nombreCorto: razonSocial.split(' ').slice(0, 3).join(' '),
    idcif: get(/idCIF\s*:\s*(\d+)/i),
    cp: get(/C[oó]digo\s*Postal\s*:?\s*(\d{5})/i),
    calle: get(/Nombre\s*de\s*(?:la\s*)?Vialidad\s*:\s*([^\n]+)/i),
    numExt: get(/N[uú]mero\s*Exterior\s*:\s*([^\n]+)/i),
    numInt: get(/N[uú]mero\s*Interior\s*:\s*([^\n]*)/i) || '',
    colonia: get(/Nombre\s*de\s*la\s*Colonia\s*:\s*([^\n]+)/i),
    municipio: get(/Nombre\s*del\s*Municipio[^\n:]*:\s*([^\n]+)/i),
    estado: get(/Nombre\s*de\s*la\s*Entidad\s*Federativa\s*:\s*([^\n]+)/i),
    regimenFiscal: (texto.match(/R[eé]gimen\s*Fiscal\s*:\s*(\d{3})/i) || [])[1] || '',
    pais: 'MX',
  };
}

let csfDiffPendiente = null;

async function crearClienteDesdeCSF() {
  if (!csfDatosExtraidos) return;

  // Modo actualizacion: cliente existente detectado
  if (csfClienteExistente) {
    const getVal = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
    const formValues = {};
    for (const id of CSF_FORM_FIELD_IDS) formValues[id] = getVal(id);
    const diff = calcularDiff(csfClienteExistente.snapshot, formValues);

    const statusEl = document.getElementById('csf-status');
    if (Object.keys(diff).length === 0) {
      statusEl.style.display = 'block';
      statusEl.className = 'alert alert-info';
      statusEl.textContent = 'No hay cambios que guardar.';
      return;
    }

    csfDiffPendiente = diff;
    mostrarPanelConfirmacion(diff);
    return;
  }

  const btn = document.getElementById('btn-crear-csf');
  btn.disabled = true;
  btn.textContent = 'Creando cliente...';
  const statusEl = document.getElementById('csf-status');
  statusEl.style.display = 'none';

  try {
    const getVal = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
    const paisVal = getVal('cl-pais') || 'MX';
    const paisConfig = buildPaisConfig(paisVal);
    const invoice_tax_id = getVal('cl-tax-id-ext') || '';
    const invoice_email = getVal('cl-email-factura') || '';
    const payload = {
      CustName: csfDatosExtraidos.razonSocial,
      cust_ref: csfDatosExtraidos.nombreCorto,
      tax_id: csfDatosExtraidos.rfc,
      idcif: csfDatosExtraidos.idcif,
      street: toTitleCase(csfDatosExtraidos.calle),
      street_number: csfDatosExtraidos.numExt,
      suite_number: csfDatosExtraidos.numInt,
      district: toTitleCase(csfDatosExtraidos.colonia),
      postal_code: csfDatosExtraidos.cp,
      city: toTitleCase(csfDatosExtraidos.municipio),
      state: toTitleCase(csfDatosExtraidos.estado),
      country: paisConfig.country,
      curr_code: paisConfig.curr_code,
      area_pais: paisConfig.area_pais,
      invoice_tax_id,
      invoice_email,
      cfdi_regimen_fiscal: csfDatosExtraidos.regimenFiscal,
      salesman: String(state.user.id || '1'),
      segmento_id: '1',
      timbrado_uso_cfdi: 'S01',
      actividades: [],
      csf_fecha: '',
      phone: '',
      email: '',
      fuente: 'cotizador',
      entrega: buildEntregaPayload(getVal),
    };

    const res = await fetch('https://operam-server.onrender.com/api/crear-cliente', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (data.error) throw new Error(data.error);

    const nombreCortoEl = document.getElementById('cl-nombre-corto');
    if (nombreCortoEl && data.nombre) nombreCortoEl.value = data.nombre;

    statusEl.style.display = 'block';
    statusEl.className = data.duplicado
      ? 'alert alert-warning'
      : 'alert alert-success';
    statusEl.textContent = data.duplicado
      ? `Cliente ya existia en Operam (ID ${data.cliente_id}). Datos cargados.`
      : `Cliente creado en Operam (ID ${data.cliente_id}). Formulario listo.`;

    document.getElementById('csf-preview').style.display = 'none';
    csfDatosExtraidos = null;
    csfClienteExistente = null;

    setTimeout(() => setClienteModo('manual'), 800);

  } catch (e) {
    statusEl.style.display = 'block';
    statusEl.className = 'alert alert-error';
    statusEl.textContent = 'Error al crear cliente: ' + e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Crear cliente en Operam y continuar';
  }
}
window.crearClienteDesdeCSF = crearClienteDesdeCSF;

function mostrarPanelConfirmacion(diff) {
  const items = buildConfirmacionItems(diff);
  const listaEl = document.getElementById('csf-lista-cambios');
  if (listaEl) {
    listaEl.innerHTML = items.map(item =>
      `<div><strong>${item.label}:</strong> ${item.anterior || '(vacio)'} &rarr; ${item.nuevo || '(vacio)'}</div>`
    ).join('');
  }
  const panel = document.getElementById('csf-panel-confirmacion');
  if (panel) panel.style.display = 'block';
  const previewEl = document.getElementById('csf-preview');
  if (previewEl) previewEl.style.display = 'none';
}
window.mostrarPanelConfirmacion = mostrarPanelConfirmacion;

async function confirmarCambios() {
  if (!csfClienteExistente || !csfDiffPendiente) return;
  const btn = document.getElementById('btn-confirmar-cambios');
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }
  const statusEl = document.getElementById('csf-status');

  try {
    const res = await api(`/api/operam/clientes/${csfClienteExistente.id}`, {
      method: 'PATCH',
      body: { diff: csfDiffPendiente },
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Error al actualizar');

    statusEl.style.display = 'block';
    statusEl.className = 'alert alert-success';
    statusEl.textContent = 'Datos del cliente actualizados en Operam.';

    const panel = document.getElementById('csf-panel-confirmacion');
    if (panel) panel.style.display = 'none';
    document.getElementById('csf-preview').style.display = 'none';
    csfDatosExtraidos = null;
    csfClienteExistente = null;
    csfDiffPendiente = null;

    setTimeout(() => setClienteModo('manual'), 800);
  } catch (e) {
    statusEl.style.display = 'block';
    statusEl.className = 'alert alert-error';
    statusEl.textContent = 'Error al actualizar cliente: ' + e.message;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Confirmar cambios'; }
  }
}
window.confirmarCambios = confirmarCambios;

function cancelarConfirmacion() {
  csfDiffPendiente = null;
  const panel = document.getElementById('csf-panel-confirmacion');
  if (panel) panel.style.display = 'none';
  const previewEl = document.getElementById('csf-preview');
  if (previewEl) previewEl.style.display = 'block';
}
window.cancelarConfirmacion = cancelarConfirmacion;

function cancelarCSF() {
  csfDatosExtraidos = null;
  csfClienteExistente = null;
  csfDiffPendiente = null;
  const btnCrear = document.getElementById('btn-crear-csf');
  if (btnCrear) btnCrear.textContent = 'Crear cliente en Operam y continuar';
  document.getElementById('csf-file').value = '';
  document.getElementById('csf-preview').style.display = 'none';
  const panelConf = document.getElementById('csf-panel-confirmacion');
  if (panelConf) panelConf.style.display = 'none';
  document.getElementById('csf-status').style.display = 'none';
}
window.cancelarCSF = cancelarCSF;

// === MANUAL RFC GUARD ===

function cancelarConfirmacionManual() {
  csfDiffPendiente = null;
  csfClienteExistente = null;
  const panelAct = document.getElementById('manual-panel-actualizar');
  if (panelAct) panelAct.style.display = 'none';
  const panelConf = document.getElementById('manual-panel-confirmacion');
  if (panelConf) panelConf.style.display = 'none';
  const statusEl = document.getElementById('manual-rfc-status');
  if (statusEl) statusEl.style.display = 'none';
}
window.cancelarConfirmacionManual = cancelarConfirmacionManual;

function actualizarDesdeManual() {
  if (!csfClienteExistente) return;
  const getVal = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
  const formValues = {};
  for (const id of CSF_FORM_FIELD_IDS) formValues[id] = getVal(id);
  const diff = calcularDiff(csfClienteExistente.snapshot, formValues);

  const statusEl = document.getElementById('manual-rfc-status');
  if (Object.keys(diff).length === 0) {
    if (statusEl) { statusEl.style.display = 'block'; statusEl.className = 'alert alert-info'; statusEl.textContent = 'No hay cambios que guardar.'; }
    return;
  }

  csfDiffPendiente = diff;
  const items = buildConfirmacionItems(diff);
  const listaEl = document.getElementById('manual-lista-cambios');
  if (listaEl) {
    listaEl.innerHTML = items.map(item =>
      `<div><strong>${item.label}:</strong> ${item.anterior || '(vacio)'} &rarr; ${item.nuevo || '(vacio)'}</div>`
    ).join('');
  }
  const panelAct = document.getElementById('manual-panel-actualizar');
  if (panelAct) panelAct.style.display = 'none';
  const panelConf = document.getElementById('manual-panel-confirmacion');
  if (panelConf) panelConf.style.display = 'block';
}
window.actualizarDesdeManual = actualizarDesdeManual;

async function confirmarCambiosManual() {
  if (!csfClienteExistente || !csfDiffPendiente) return;
  const btn = document.getElementById('btn-manual-confirmar-cambios');
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }
  const statusEl = document.getElementById('manual-rfc-status');

  try {
    const res = await api(`/api/operam/clientes/${csfClienteExistente.id}`, {
      method: 'PATCH',
      body: { diff: csfDiffPendiente },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al actualizar');

    if (statusEl) { statusEl.style.display = 'block'; statusEl.className = 'alert alert-success'; statusEl.textContent = 'Datos del cliente actualizados en Operam.'; }
    const panelConf = document.getElementById('manual-panel-confirmacion');
    if (panelConf) panelConf.style.display = 'none';
    csfClienteExistente = null;
    csfDiffPendiente = null;
  } catch (e) {
    if (statusEl) { statusEl.style.display = 'block'; statusEl.className = 'alert alert-error'; statusEl.textContent = 'Error al actualizar cliente: ' + e.message; }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Confirmar cambios'; }
  }
}
window.confirmarCambiosManual = confirmarCambiosManual;

async function buscarRfcEnManual(rfc) {
  const statusEl = document.getElementById('manual-rfc-status');
  const setStatus = (msg, cls) => {
    if (!statusEl) return;
    if (msg) { statusEl.style.display = 'block'; statusEl.className = 'alert ' + cls; statusEl.textContent = msg; }
    else statusEl.style.display = 'none';
  };

  try {
    const res = await api('/api/operam/clientes?q=' + encodeURIComponent(rfc));
    if (!res.ok) { setStatus('No se pudo verificar en Operam', 'alert-warning'); return; }
    const clientes = await res.json();
    const match = findRfcMatch(clientes, rfc);
    if (!match) return;

    const getVal = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
    applyPreFillMap(buildOperamPreFillMap(match), (id) => document.getElementById(id));
    const snap = buildClienteSnapshot(CSF_FORM_FIELD_IDS, getVal);
    csfClienteExistente = { id: match.id, nombre: match.name, snapshot: snap };
    setStatus(buildCsfDuplicadoBanner(match), 'alert-warning');
    const panelAct = document.getElementById('manual-panel-actualizar');
    if (panelAct) panelAct.style.display = 'block';
  } catch {
    setStatus('No se pudo verificar en Operam', 'alert-warning');
  }
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
  fill('cl-telefono',       cliente.telefono);
  fill('cl-nombre-entrega', cliente.nombreEntrega);
  fill('cl-calle',          cliente.calle);
  fill('cl-num-int',        cliente.numInt);
  fill('cl-colonia',        cliente.colonia);
  fill('cl-cp-entrega',     cliente.cp);
  fill('cl-municipio',      cliente.municipio);
  fill('cl-estado',         cliente.estado);
  fill('cl-cel-entrega',    cliente.telefono);
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
  if (d.telefono) f('cl-cel-entrega', d.telefono);
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
async function showHistorial() {
  document.getElementById('app-view').style.display = 'none';
  document.getElementById('historial-view').style.display = 'block';

  const loadingEl = document.getElementById('historial-loading');
  const listEl = document.getElementById('historial-list');
  loadingEl.style.display = 'block';
  listEl.innerHTML = '';

  try {
    const res = await api('/api/cotizaciones');
    const cots = await res.json();

    loadingEl.style.display = 'none';

    if (!cots.length) {
      listEl.innerHTML = '<div class="empty-state"><p>Sin cotizaciones registradas.</p></div>';
      return;
    }

    listEl.innerHTML = cots.slice().reverse().map(c => {
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
  } catch (e) {
    loadingEl.textContent = 'Error cargando historial';
  }
}

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
      'cl-telefono': c.telefono || '',
      'cl-nombre-entrega': c.nombreEntrega || '',
      'cl-calle': c.calle || '',
      'cl-num-int': c.numInt || '',
      'cl-colonia': c.colonia || '',
      'cl-cp-entrega': c.cpEntrega || '',
      'cl-municipio': c.municipio || '',
      'cl-estado': c.estado || '',
      'cl-cel-entrega': c.celEntrega || '',
      'cl-email-entrega': c.emailEntrega || '',
      'cl-referencias': c.referencias || '',
      'cl-referencia': c.referencia || '',
    };
    for (const [id, val] of Object.entries(campos)) {
      const el = document.getElementById(id);
      if (el) el.value = val;
    }
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

  // RFC blur guard for manual panel
  const clRfcEl = document.getElementById('cl-rfc');
  if (clRfcEl) {
    clRfcEl.addEventListener('blur', () => {
      const panelManual = document.getElementById('panel-manual');
      if (!panelManual || panelManual.style.display === 'none') return;
      if (clRfcEl.readOnly) return;
      const rfc = clRfcEl.value;
      if (shouldTriggerRfcSearch(rfc)) buscarRfcEnManual(rfc);
    });
  }

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

const ALTA_CSF_DATOS_VACIOS = {
  rfc: '', razonSocial: '', nombreCorto: '', idcif: '', regimenFiscal: '',
  calle: '', numExt: '', numInt: '', colonia: '', cp: '', municipio: '', estado: '',
};

// El endpoint centralizado puede responder ok:false (sin RFC detectado). A diferencia del
// parser viejo (que nunca fallaba), no queremos dejar al usuario sin salida -- siempre se
// devuelve success con un objeto datos completo (vacio si no hubo deteccion) para captura
// y edicion manual (issue #34).
function altaCsfResultadoParseo(respuestaInterpretada, fileName) {
  if (respuestaInterpretada && respuestaInterpretada.datos) {
    const datos = { ...ALTA_CSF_DATOS_VACIOS, ...respuestaInterpretada.datos };
    return {
      status: 'success',
      datos,
      bannerText: `${fileName} -- RFC: ${datos.rfc || '(no detectado)'}`,
    };
  }
  return {
    status: 'success',
    datos: { ...ALTA_CSF_DATOS_VACIOS },
    bannerText: `${fileName} -- RFC no detectado, captura los datos manualmente`,
  };
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
      const r = await fetch('/api/csf-from-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: urlQR }) });
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

// === Diff fiscal sobre cliente existente al subir CSF (issue #38) ===
//
// Mapea los datos de la CSF (altaState.datos: razonSocial/rfc/calle/numExt/...) contra
// los campos crudos del cliente en Operam (CustName/tax_id/street/...) y calcula un diff
// cuyas LLAVES son nombres de campo de OPERAM -- a proposito distinto del calcularDiff
// viejo (que usaba ids de DOM como cl-razon-social). actualizarCliente(id, diff) hace
// body[fieldId] = nuevo y lo manda directo al PUT /customers/:id de Operam: si la llave
// fuera un id de DOM, el PATCH mandaria campos que Operam no reconoce. Usar nombres de
// campo Operam es lo correcto para que el PATCH actualice algo real (ver ralph-progress.txt).
const DIFF_FISCAL_CAMPOS = [
  { operam: 'CustName',            csf: 'razonSocial',   label: 'Razon Social' },
  { operam: 'tax_id',              csf: 'rfc',           label: 'RFC' },
  { operam: 'idcif',               csf: 'idcif',         label: 'IdCIF (SAT)' },
  { operam: 'street',              csf: 'calle',         label: 'Calle' },
  { operam: 'street_number',       csf: 'numExt',        label: 'Numero Exterior' },
  { operam: 'suite_number',        csf: 'numInt',        label: 'Numero Interior' },
  { operam: 'district',            csf: 'colonia',       label: 'Colonia' },
  { operam: 'postal_code',         csf: 'cp',            label: 'Codigo Postal' },
  { operam: 'city',                csf: 'municipio',     label: 'Municipio' },
  { operam: 'state',               csf: 'estado',        label: 'Estado' },
  { operam: 'cfdi_regimen_fiscal', csf: 'regimenFiscal', label: 'Regimen Fiscal' },
];

const DIFF_FISCAL_LABELS = DIFF_FISCAL_CAMPOS.reduce((acc, { operam, label }) => {
  acc[operam] = label;
  return acc;
}, {});

export function calcularDiffFiscal(clienteOperam, csfDatos) {
  const diff = {};
  for (const { operam, csf, label } of DIFF_FISCAL_CAMPOS) {
    if (!(csf in csfDatos)) continue; // el formulario de captura no recolecta este campo (ej. alta manual no tiene domicilio fiscal completo) -- ausente != vacio, no es un cambio real
    const anterior = String(clienteOperam[operam] == null ? '' : clienteOperam[operam]).trim();
    const nuevo = String(csfDatos[csf] == null ? '' : csfDatos[csf]).trim();
    if (anterior !== nuevo) {
      diff[operam] = { anterior, nuevo, label };
    }
  }
  return diff;
}

export function buildDiffFiscalHtml(diff) {
  const campos = Object.keys(diff);
  if (campos.length === 0) return '';
  const mostrar = valor => valor || '(vacio)';
  const filas = campos.map(fieldId => {
    const { anterior, nuevo, label } = diff[fieldId];
    return '<div class="diff-fiscal-fila">' +
      '<strong>' + (label || DIFF_FISCAL_LABELS[fieldId] || fieldId) + ':</strong> ' +
      '<span class="diff-fiscal-anterior">' + mostrar(anterior) + '</span>' +
      ' &rarr; ' +
      '<span class="diff-fiscal-nuevo">' + mostrar(nuevo) + '</span>' +
      '</div>';
  }).join('');
  return '<div class="diff-fiscal-panel">' +
    '<p class="dedup-alerta-naranja">Los datos fiscales de la CSF no coinciden con los guardados en Operam</p>' +
    filas +
    '<div class="diff-fiscal-acciones">' +
    '<button type="button" class="btn btn-secondary" onclick="altaDiffFiscalConfirmar()">Confirmar y actualizar en Operam</button> ' +
    '<button type="button" class="btn btn-secondary diff-fiscal-btn-descartar" onclick="altaDiffFiscalDescartar()">Descartar y continuar sin actualizar</button>' +
    '</div>' +
    '</div>';
}

// Compone el banner "RFC ya existe" (igual al existente, "Usar este cliente" SIEMPRE
// disponible -- AC3) + panel de diff fiscal cuando hay diferencias (AC1/AC4). Es
// deliberadamente NO bloqueante: el vendedor puede avanzar con "Usar este cliente" sin
// resolver el diff -- es un paso paralelo/opcional, no un gate (decision documentada en
// ralph-progress.txt iter 2: bloquear forzaria al vendedor a decidir sobre datos fiscales
// en medio de un flujo de cotizacion, friccion injustificada para un caso que no impide
// continuar -- el dato sigue desactualizado en Operam pero el vendedor ya fue avisado y
// puede resolverlo ahi mismo o despues).
export function buildDedupExactoConDiffHtml(cliente, csfDatos) {
  const nombre = cliente.CustName || cliente.name || '';
  const id = cliente.id || cliente.customer_id || '';
  const rfcC = cliente.RFC || cliente.rfc || cliente.tax_id || '';
  const base =
    '<div class="dedup-exacto">' +
    '<p class="dedup-alerta-roja">Este RFC ya existe en Operam</p>' +
    '<p><strong>' + nombre + '</strong> (ID: ' + id + ', RFC: ' + rfcC + ')</p>' +
    '<button class="btn btn-secondary" type="button" onclick="altaDedupUsarCliente(' + id + ')">Usar este cliente</button>' +
    '</div>';
  if (!csfDatos) return base;
  const diff = calcularDiffFiscal(cliente, csfDatos);
  return base + buildDiffFiscalHtml(diff);
}

// Documenta/testea la forma de la peticion PATCH /api/operam/clientes/:id {diff} (AC2)
// que altaDiffFiscalConfirmar dispara via api(). Mismo patron que buildDedupRequest:
// vive como funcion pura exportada para poder afirmar { url, method, body, headers } sin
// DOM/fetch -- la implementacion real usa api() (que ya agrega Authorization desde
// state.token) y construye la llamada inline, igual que altaDedupCorrer hace con
// /api/buscar-cliente-duplicado pese a que existe buildDedupRequest.
export function buildActualizarFiscalRequest(clienteId, diff, authHeader) {
  return {
    url: '/api/operam/clientes/' + clienteId,
    method: 'PATCH',
    body: { diff },
    headers: { 'Authorization': authHeader },
  };
}

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
    const token = localStorage.getItem('token') || sessionStorage.getItem('token') || '';
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
    phone: getVal('alta-addr-phone'),
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
  const payload = {
    tax_id: csfDatos.rfc || '',
    CustName: csfDatos.razonSocial || '',
    cust_ref: csfDatos.nombreCorto || '',
    idcif: csfDatos.idcif || '',
    street: csfDatos.calle || '',
    street_number: csfDatos.numExt || '',
    suite_number: csfDatos.numInt || '',
    district: csfDatos.colonia || '',
    postal_code: csfDatos.cp || '',
    city: csfDatos.municipio || '',
    state: csfDatos.estado || '',
    cfdi_regimen_fiscal: csfDatos.regimenFiscal || '',
    timbrado_uso_cfdi: getComercial('alta-uso-cfdi'),
    sales_type: getComercial('alta-lista-precios'),
    segmento_id: getComercial('alta-segmento'),
    salesman: getComercial('alta-vendedor'),
    pais: domicilio.pais || csfDatos.pais || 'MX',
    entrega: { ...domicilio },
    customer_id: resolvedCustomerId,
    branch_id: altaState.branch_id || null,
    fuente: 'cotizador',
  };

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
  const panel = document.getElementById('panel-alta');
  if (panel) panel.style.display = 'none';
  const buscarPanel = document.getElementById('panel-buscar');
  if (buscarPanel) buscarPanel.style.display = 'none';
  const searchInput = document.getElementById('operam-search');
  if (searchInput) { searchInput.value = altaCsfState.datos?.rfc || ''; }
  document.getElementById('btn-buscar-operam')?.click();
}

function altaTerminar() {
  const panel = document.getElementById('panel-alta');
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
