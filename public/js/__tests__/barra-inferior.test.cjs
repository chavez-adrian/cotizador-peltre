'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Barra inferior fija (bottom-nav, #53) contra lo demas que se pega a la
// pantalla (#442, decision de Adrian 2026-09-25): todo lo fijo o sticky se
// apoya ARRIBA de la barra en todas las pantallas, y el lateral "Progreso del
// alta" no desborda en telefono. Sin DOM en Node: se lee el CSS y el HTML.

const css = fs.readFileSync(path.join(__dirname, '..', '..', 'css', 'style.css'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');

function declaraciones(cuerpo) {
  const m = new Map();
  for (const trozo of cuerpo.split(';')) {
    const i = trozo.indexOf(':');
    if (i < 0) continue;
    const prop = trozo.slice(0, i).trim().toLowerCase();
    if (prop) m.set(prop, trozo.slice(i + 1).trim());
  }
  return m;
}

function reglasCss(texto) {
  const limpio = texto.replace(/\/\*[\s\S]*?\*\//g, '');
  const reglas = [];
  const pila = [];
  let buf = '';
  for (const ch of limpio) {
    if (ch === '{') { pila.push(buf.trim()); buf = ''; continue; }
    if (ch === '}') {
      const selector = pila.pop();
      if (selector && !selector.startsWith('@') && buf.trim()) {
        reglas.push({
          selector,
          selectores: selector.split(',').map((s) => s.trim()),
          media: pila.filter((s) => s.startsWith('@media')).join(' '),
          decl: declaraciones(buf),
        });
      }
      buf = '';
      continue;
    }
    buf += ch;
  }
  return reglas;
}

const reglas = reglasCss(css);

function variablesDe(filtro, base = new Map()) {
  const vars = new Map(base);
  for (const r of reglas.filter((x) => !x.media && filtro(x))) {
    for (const [prop, valor] of r.decl) if (prop.startsWith('--')) vars.set(prop, valor);
  }
  return vars;
}

// Dos contextos: el de la raiz y el de #app-view con la barra del total del
// carrito a la vista (#app-view:has(> #cart-summary ...)).
const esReglaConTotal = (r) => r.selectores.some((s) => s.startsWith('#app-view:has(') && s.includes('#cart-summary'));
const VARS_BASE = variablesDe((r) => r.selectores.includes(':root'));
const VARS_CON_TOTAL = variablesDe(esReglaConTotal, VARS_BASE);

function px(valor, vars = VARS_BASE) {
  let v = String(valor).trim();
  for (let i = 0; i < 10 && v.includes('var('); i++) {
    v = v.replace(/var\(\s*(--[\w-]+)\s*\)/g, (_, nombre) => (vars.has(nombre) ? vars.get(nombre) : 'NaN'));
  }
  // calc anidado (un --pie-fijo que ya es calc dentro de otro calc): solo hay sumas, se aplana.
  if (v.startsWith('calc(')) return v.replace(/calc\(|[()]/g, '').split('+').reduce((suma, t) => suma + px(t, vars), 0);
  if (v === '0') return 0;
  const m = /^(-?\d+(?:\.\d+)?)px$/.exec(v);
  return m ? Number(m[1]) : NaN;
}

function reglaDe(selector, { media = '' } = {}) {
  const r = reglas.filter((x) => x.selectores.includes(selector) && x.media === media);
  assert.ok(r.length > 0, `falta la regla ${selector}${media ? ' en ' + media : ''}`);
  return r[r.length - 1];
}

const ALTO_BARRA = px(reglas.find((r) => r.selectores.includes('body') && r.decl.has('padding-bottom')).decl.get('padding-bottom'));
const Z_BARRA = Number(reglaDe('.bottom-nav').decl.get('z-index'));

function estilosInline(texto) {
  const out = [];
  const re = /<[a-z][^>]*?\sstyle="([^"]*)"[^>]*>/gi;
  for (let m; (m = re.exec(texto));) out.push({ etiqueta: m[0], decl: declaraciones(m[1]) });
  return out;
}

function tapaLaBarra(decl) {
  const pos = (decl.get('position') || '').toLowerCase();
  if (pos !== 'fixed' && pos !== 'sticky') return false;
  if (!decl.has('bottom')) return false;
  if (px(decl.get('bottom')) >= ALTO_BARRA) return false;
  return !(Number(decl.get('z-index')) > Z_BARRA);
}

test('la barra inferior reserva su alto y va encima de lo que se pega a la pantalla', () => {
  assert.equal(ALTO_BARRA, 64);
  assert.equal(Z_BARRA, 900);
});

test('#442: nada fijo o sticky del CSS queda debajo de la barra inferior (se apoya arriba o va encima)', () => {
  const debajo = reglas
    .filter((r) => !r.selectores.includes('.bottom-nav'))
    .filter((r) => tapaLaBarra(r.decl))
    .map((r) => `${r.selector} (bottom ${r.decl.get('bottom')}, z-index ${r.decl.get('z-index') || 'auto'})`);
  assert.deepEqual(debajo, []);
});

test('#442: la barra del total del carrito se apoya arriba de la barra inferior', () => {
  const r = reglaDe('.cart-summary');
  assert.equal(r.decl.get('position'), 'sticky');
  assert.ok(px(r.decl.get('bottom')) >= ALTO_BARRA, `bottom ${r.decl.get('bottom')}`);
});

function botonPorOnclick(fn) {
  const m = new RegExp(`<button[^>]*onclick="${fn}\\(\\)"[^>]*>`).exec(html);
  assert.ok(m, `falta el boton de ${fn}()`);
  return m[0];
}

function clasesDe(etiqueta) {
  const m = /\sclass="([^"]*)"/.exec(etiqueta);
  return m ? m[1].split(/\s+/).filter(Boolean) : [];
}

function reglaPegadaDe(etiqueta) {
  const clases = clasesDe(etiqueta).map((c) => '.' + c);
  const r = reglas.find((x) => !x.media && x.selectores.some((s) => clases.includes(s))
    && x.decl.get('position') === 'sticky' && x.decl.has('bottom'));
  assert.ok(r, `ninguna de sus clases (${clases.join(' ')}) es sticky con bottom: ${etiqueta}`);
  return r;
}

const BOTONES_ALTA = ['altaCsfConfirmar', 'altaManualConfirmar', 'altaConfirmarComercial', 'altaConfirmarDomicilio']
  .map((fn) => ({ nombre: fn, etiqueta: botonPorOnclick(fn) }));

test('#442: los botones que confirman cada seccion del alta se apoyan arriba de la barra inferior', () => {
  for (const { nombre, etiqueta } of BOTONES_ALTA) {
    const bottom = px(reglaPegadaDe(etiqueta).decl.get('bottom'));
    assert.ok(bottom >= ALTO_BARRA, `${nombre}: bottom ${bottom}px, la barra mide ${ALTO_BARRA}px`);
  }
});

// "Siguiente" de Productos y de Envio, y la fila de Generar PDF / HTML /
// WhatsApp (el boton va con flex:1 dentro de ella): la barra intercepto el
// clic en escritorio con 900 px de alto (comentario del 2026-09-24).
const BOTONES_PASOS = [
  { nombre: 'Siguiente de Productos', etiqueta: etiquetaDe('id="btn-sig-productos"') },
  { nombre: 'Siguiente de Envio', etiqueta: etiquetaDe('id="btn-sig-envio"') },
  { nombre: 'fila de Generar PDF', etiqueta: padreDe('id="btn-pdf"') },
  // #488: el boton de consultar tarifas de Envio tambien quedo bajo la barra a 1280x900.
  { nombre: 'fila de Cotizar de Envio', etiqueta: padreDe('id="btn-cotizar-envia"') },
];

test('#442: "Siguiente" de los pasos y la fila de Generar PDF se quedan a la vista arriba de la barra inferior', () => {
  for (const { nombre, etiqueta } of BOTONES_PASOS) {
    const bottom = px(reglaPegadaDe(etiqueta).decl.get('bottom'));
    assert.ok(bottom >= ALTO_BARRA, `${nombre}: bottom ${bottom}px, la barra mide ${ALTO_BARRA}px`);
  }
});

test('#442: con el total del carrito a la vista, los botones de accion se apoyan arriba de el (no se enciman)', () => {
  const total = reglaDe('.cart-summary');
  const alto = px(total.decl.get('height'), VARS_CON_TOTAL);
  assert.ok(alto > 0, `.cart-summary sin alto declarado (height ${total.decl.get('height')}): sin el no hay donde apoyar lo demas`);
  const techoDelTotal = px(total.decl.get('bottom'), VARS_CON_TOTAL) + alto;
  for (const { nombre, etiqueta } of [...BOTONES_ALTA, ...BOTONES_PASOS]) {
    const bottom = px(reglaPegadaDe(etiqueta).decl.get('bottom'), VARS_CON_TOTAL);
    assert.ok(bottom >= techoDelTotal, `${nombre}: bottom ${bottom}px, el total del carrito llega a ${techoDelTotal}px`);
  }
});

function ultimaReglaCon(prop, etiqueta, contenedor) {
  const clases = clasesDe(etiqueta).map((c) => '.' + c);
  const id = /\sid="([^"]*)"/.exec(etiqueta);
  const propios = id ? [...clases, '#' + id[1]] : clases;
  const candidatos = [...propios, ...propios.map((s) => `${contenedor} > ${s}`)];
  const r = reglas.filter((x) => !x.media && x.decl.has(prop) && x.selectores.some((s) => candidatos.includes(s)));
  assert.ok(r.length > 0, `ninguna regla le da ${prop}: ${etiqueta}`);
  return r[r.length - 1];
}

test('#488: la fila de Cotizar de Envio se apoya arriba del "Siguiente" sticky (no queda debajo de el)', () => {
  const fila = padreDe('id="btn-cotizar-envia"');
  const siguiente = etiquetaDe('id="btn-sig-envio"');
  const contenedor = '#shipping-envia';
  const altoSiguiente = ultimaReglaCon('height', siguiente, '#tab-envio').decl.get('height');
  for (const vars of [VARS_BASE, VARS_CON_TOTAL]) {
    const techoSiguiente = px(ultimaReglaCon('bottom', siguiente, '#tab-envio').decl.get('bottom'), vars) + px(altoSiguiente, vars);
    const bottomFila = px(ultimaReglaCon('bottom', fila, contenedor).decl.get('bottom'), vars);
    assert.ok(bottomFila >= techoSiguiente, `fila de Cotizar: bottom ${bottomFila}px, el Siguiente llega a ${techoSiguiente}px`);
  }
});

// #513: pegada al Siguiente, el borde de Cotizar tocaba el de Siguiente. Entre
// los dos queda el hueco de los botones apilados (gap de .form-row, 10px). El
// sticky coloca la caja, no el margen: el hueco sale de un bottom mayor o de un
// padding-bottom de la fila (opaco, con su fondo en linea).
test('#513: entre la fila de Cotizar de Envio y el "Siguiente" sticky queda un hueco de 10px', () => {
  const fila = padreDe('id="btn-cotizar-envia"');
  const siguiente = etiquetaDe('id="btn-sig-envio"');
  const contenedor = '#shipping-envia';
  const altoSiguiente = ultimaReglaCon('height', siguiente, '#tab-envio').decl.get('height');
  const conPadding = reglas.filter((x) => !x.media && x.decl.has('padding-bottom')
    && x.selectores.some((s) => s === `${contenedor} > .accion-fija`));
  const paddingFila = conPadding.length ? px(conPadding[conPadding.length - 1].decl.get('padding-bottom')) : 0;
  for (const vars of [VARS_BASE, VARS_CON_TOTAL]) {
    const techoSiguiente = px(ultimaReglaCon('bottom', siguiente, '#tab-envio').decl.get('bottom'), vars) + px(altoSiguiente, vars);
    const bordeCotizar = px(ultimaReglaCon('bottom', fila, contenedor).decl.get('bottom'), vars) + paddingFila;
    assert.ok(bordeCotizar - techoSiguiente >= 10, `Cotizar a ${bordeCotizar - techoSiguiente}px del Siguiente`);
  }
});

// Un sticky no sale de su bloque contenedor: dentro de #shipping-envia la fila
// solo subiria lo que mide la nota de arriba. Con display: contents el bloque
// pasa a ser el paso Envio entero, como el del Siguiente.
test('#488: el bloque de paqueteria no genera caja, asi la fila de Cotizar se pega en todo el paso Envio', () => {
  assert.equal(reglaDe('#shipping-envia').decl.get('display'), 'contents');
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const escrituras = app.match(/getElementById\('shipping-envia'\)\.style\.display\s*=[^;]*/g) || [];
  assert.ok(escrituras.length > 0, 'app.js ya no muestra/oculta #shipping-envia: revisar esta prueba');
  const conDisplayEnLinea = escrituras.filter((e) => /'(block|flex|grid|inline[\w-]*)'/.test(e));
  assert.deepEqual(conDisplayEnLinea, [], 'mostrarlo con un display en linea le gana al display: contents del CSS');
});

function coincideConTotalALaVista(estilo) {
  const regla = reglas.find(esReglaConTotal);
  assert.ok(regla, 'falta la regla #app-view:has(> #cart-summary ...) que dice cuando el total esta a la vista');
  const sel = regla.selectores.find((s) => s.includes('#cart-summary'));
  const cola = sel.slice(sel.indexOf('#cart-summary') + '#cart-summary'.length);
  const niega = /^:not\(\[style\*="([^"]*)"\]\)/.exec(cola);
  const afirma = /^\[style\*="([^"]*)"\]/.exec(cola);
  assert.ok(niega || afirma, `condicion no reconocida: ${sel}`);
  return niega ? !estilo.includes(niega[1]) : estilo.includes(afirma[1]);
}

test('#442: la condicion "total a la vista" sigue lo que updateCartSummary escribe en #cart-summary', () => {
  assert.equal(selectorDe(padreDe('id="cart-summary"')), '#app-view', 'la regla usa > : #cart-summary debe ser hijo directo de #app-view');
  // bar.style.display = 'flex' | 'none' queda serializado asi en el atributo style.
  assert.equal(coincideConTotalALaVista('display: flex;'), true);
  assert.equal(coincideConTotalALaVista('display: none;'), false);
  const inicial = /\sstyle="([^"]*)"/.exec(etiquetaDe('id="cart-summary"'))[1];
  assert.equal(coincideConTotalALaVista(inicial), false, `al cargar (style="${inicial}") el total no esta a la vista`);
});

test('#442: la seccion del alta no le quita el sticky a su boton (overflow sin contenedor de scroll)', () => {
  const overflow = reglaDe('.alta-seccion').decl.get('overflow');
  assert.ok(!['hidden', 'auto', 'scroll'].includes(overflow), `overflow: ${overflow}`);
});

const TELEFONO = '@media (max-width: 480px)';

function etiquetaDe(marca) {
  const i = html.indexOf(marca);
  assert.ok(i >= 0, `falta ${marca}`);
  const ini = html.lastIndexOf('<', i);
  return html.slice(ini, html.indexOf('>', i) + 1);
}

function padreDe(marca) {
  const fin = html.indexOf(marca);
  assert.ok(fin >= 0, `falta ${marca}`);
  const pila = [];
  const re = /<div\b[^>]*>|<\/div>/g;
  for (let m; (m = re.exec(html)) && m.index < fin;) {
    if (m[0] === '</div>') pila.pop(); else pila.push(m[0]);
  }
  const propia = etiquetaDe(marca);
  return propia.startsWith('<div') && pila[pila.length - 1] === propia ? pila[pila.length - 2] : pila[pila.length - 1];
}

function selectorDe(etiqueta) {
  const id = /\sid="([^"]*)"/.exec(etiqueta);
  if (id) return '#' + id[1];
  const clases = clasesDe(etiqueta);
  assert.ok(clases.length > 0, `sin id ni clase: ${etiqueta}`);
  return '.' + clases[0];
}

function inlineDe(etiqueta) {
  const m = /\sstyle="([^"]*)"/.exec(etiqueta);
  return declaraciones(m ? m[1] : '');
}

test('#442: el lateral "Progreso del alta" no fija su ancho en linea (el CSS lo decide por pantalla)', () => {
  const inline = inlineDe(etiquetaDe('id="alta-sidebar"'));
  for (const prop of ['width', 'flex-shrink', 'position']) assert.ok(!inline.has(prop), `#alta-sidebar lleva ${prop} en linea`);
  const escritorio = reglaDe('#alta-sidebar');
  assert.equal(escritorio.decl.get('width'), '210px');
});

test('#442: en telefono el lateral pasa a una tira arriba del formulario, a todo lo ancho', () => {
  const contenedor = padreDe('id="alta-sidebar"');
  const selContenedor = selectorDe(contenedor);
  assert.ok(!inlineDe(contenedor).has('align-items'), 'el contenedor fija align-items en linea y el CSS de telefono no lo puede cambiar');
  const col = reglaDe(selContenedor, { media: TELEFONO });
  assert.equal(col.decl.get('flex-direction'), 'column');
  assert.equal(col.decl.get('align-items'), 'stretch');

  const tira = reglaDe('#alta-sidebar', { media: TELEFONO });
  assert.ok(Number(tira.decl.get('order')) < 0, `order ${tira.decl.get('order')}: la tira va ARRIBA del formulario`);
  assert.ok(['100%', 'auto'].includes(tira.decl.get('width')), `width ${tira.decl.get('width')}`);
  assert.equal(tira.decl.get('position'), 'static');
});

test('#442: en telefono los pasos del lateral van en renglon (tira compacta)', () => {
  const lista = padreDe('id="chk-1"');
  assert.ok(!inlineDe(lista).has('flex-direction'), 'la lista fija flex-direction en linea');
  const r = reglaDe(selectorDe(lista), { media: TELEFONO });
  assert.equal(r.decl.get('flex-direction'), 'row');
  assert.equal(r.decl.get('flex-wrap'), 'wrap');
});

test('#442: nada fijo o sticky con estilo en linea del index queda debajo de la barra inferior', () => {
  const debajo = estilosInline(html).filter((e) => tapaLaBarra(e.decl)).map((e) => e.etiqueta);
  assert.deepEqual(debajo, []);
});
