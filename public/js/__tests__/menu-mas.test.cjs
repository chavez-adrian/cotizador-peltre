// #533: Cancelada y Nueva oportunidad viven en el menu de tres puntos de la
// tarjeta del tablero y de la fila abierta de la lista (variante A de #531: en
// el renglon de WhatsApp y correo). Perdida y No util siguen a la vista.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let L;
before(async () => {
  L = await import('../pipeline-logica.js');
});

const ESPEJO_CON_PEDIDO = { cotizacion: '1300', pedido: '7301' };

function prospecto(extra) {
  return {
    tipo: 'prospecto', id: 'p7', refId: 7, nombre: 'Laura', vendedor: 'Memo', celular: '+52 5512345678',
    etapa: 'por_cotizar', total: 0, ...extra,
  };
}
function cotizacion(extra) {
  return {
    tipo: 'cotizacion', id: 'c41', refId: 41, hasData: true, nombre: 'Hotel Azul', vendedor: 'Memo',
    total: 5000, etapa: 'seguimiento', folioOperam: '1300', contactoCelular: '+52 5598765432', ...extra,
  };
}
const conPedido = extra => cotizacion({ etapa: 'pedido_liberado', orderOperam: '7301', espejoOperam: ESPEJO_CON_PEDIDO, ...extra });

// Lo que esta DENTRO del menu y lo que queda fuera de el.
function partes(html) {
  const m = html.match(/<div [^>]*class="menu-mas-lista"[^>]*>([\s\S]*?)<\/div>/);
  return { menu: m ? m[1] : null, fuera: m ? html.replace(m[0], '') : html };
}
const tarjeta = (o, esAdmin) => L.buildTableroPipelineHtml([o], { esAdmin });
const fila = (o, esAdmin) => L.buildFilaListaPipelineHtml(o, { abierta: true, esAdmin });

test('#533 admin + pedido: el menu trae Cancelada y Nueva oportunidad, y fuera no queda ninguna', () => {
  for (const html of [tarjeta(conPedido(), true), fila(conPedido(), true)]) {
    const { menu, fuera } = partes(html);
    assert.ok(menu, 'pinta el menu');
    assert.ok(menu.includes('cerrarCanceladaTablero(41)'));
    assert.ok(menu.includes("abrirNuevaOportunidad('+525598765432')"));
    assert.equal(fuera.includes('cerrarCanceladaTablero'), false);
    assert.equal(fuera.includes('abrirNuevaOportunidad'), false);
    assert.match(fuera, /class="menu-mas-boton"[^>]*aria-haspopup="menu"/);
  }
});

test('#533 admin + pedido sin celular: el menu trae solo Cancelada', () => {
  const { menu } = partes(tarjeta(conPedido({ contactoCelular: null }), true));
  assert.ok(menu.includes('cerrarCanceladaTablero(41)'));
  assert.equal(menu.includes('abrirNuevaOportunidad'), false);
});

test('#533 no admin o sin pedido: Cancelada no aparece; con celular queda Nueva oportunidad', () => {
  for (const [o, esAdmin] of [[conPedido(), false], [cotizacion(), true]]) {
    for (const html of [tarjeta(o, esAdmin), fila(o, esAdmin)]) {
      const { menu } = partes(html);
      assert.equal(html.includes('cerrarCanceladaTablero'), false);
      assert.ok(menu.includes("abrirNuevaOportunidad('+525598765432')"));
    }
  }
});

test('#533 sin ninguna de las dos acciones no hay tres puntos', () => {
  for (const [o, esAdmin] of [[conPedido({ contactoCelular: null }), false], [cotizacion({ contactoCelular: null }), true]]) {
    for (const html of [tarjeta(o, esAdmin), fila(o, esAdmin)]) {
      assert.equal(html.includes('menu-mas'), false);
    }
  }
});

test('#533 Perdida y No util siguen fuera del menu', () => {
  const p = partes(tarjeta(prospecto(), true));
  assert.ok(p.menu.includes("abrirNuevaOportunidad('+525512345678')"));
  assert.ok(p.fuera.includes('marcarNoUtilTablero(7)'));
  assert.ok(p.fuera.includes("cerrarPerdidaTablero('prospecto', 7)"));
  const c = partes(fila(cotizacion(), true));
  assert.ok(c.fuera.includes("cerrarPerdidaTablero('cotizacion', 41)"));
});

test('#533 el menu nace cerrado, como menu de botones, y su boton lo controla por id', () => {
  const html = L.buildMenuMasHtml(conPedido(), { esAdmin: true, superficie: 'tablero' });
  const id = html.match(/aria-controls="([^"]+)"/)[1];
  assert.match(html, new RegExp(`<div id="${id}" class="menu-mas-lista" role="menu" hidden>`));
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /aria-label="M\u00e1s acciones"/);
  assert.equal((html.match(/role="menuitem"/g) || []).length, 2);
  assert.notEqual(id, L.buildMenuMasHtml(conPedido(), { esAdmin: true, superficie: 'lista' }).match(/aria-controls="([^"]+)"/)[1],
    'tablero y lista no comparten id');
});

test('#533 una Oportunidad que ya salio del embudo no ofrece Cancelada', () => {
  const html = L.buildMenuMasHtml(conPedido({ etapa: 'cancelada' }), { esAdmin: true });
  assert.equal(html.includes('cerrarCanceladaTablero'), false);
});
