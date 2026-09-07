'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

// Logica pura de la vista Clientes (issue #94): mantenimiento de clientes desde
// el cotizador (alta completa + upgrade CSF sin cotizacion). La decision de si un
// RFC es generico, contra que customer_id se hace el upgrade y si procede el boton
// de CSF vive en alta-logica.js (extiende el paso Cliente, no lo copia); el HTML de
// las filas de resultado, la tarjeta, los chips y el banner de upgrade vive en
// pipeline-logica.js (mismo patron de funciones puras testeables). Sin DOM en Node.

let esRfcGenerico, customerIdFiscal, mostrarBotonCsf;
let tagResultadoClienteHtml, tagPedidoClienteHtml, filaResultadoClienteHtml, filaCrearClienteHtml,
  bannerUpgradeHtml, chipsClienteViewHtml, cardClienteHtml, rotuloPanelUpgrade,
  filaContactoHtml, fichaContactoHtml;

before(async () => {
  ({ esRfcGenerico, customerIdFiscal, mostrarBotonCsf } = await import('../alta-logica.js'));
  ({
    tagResultadoClienteHtml, tagPedidoClienteHtml, filaResultadoClienteHtml, filaCrearClienteHtml,
    bannerUpgradeHtml, chipsClienteViewHtml, cardClienteHtml, rotuloPanelUpgrade,
    filaContactoHtml, fichaContactoHtml,
  } = await import('../pipeline-logica.js'));
});

// === rotuloPanelUpgrade: titulo del panel de upgrade segun de donde se llega
// (#198) -- el chip/boton Fiscal sigue diciendo "Completar datos fiscales"; la
// puerta nueva "Editar datos de cliente" (fila de Resultados en vista Clientes)
// dice eso. Cambio de texto visible unicamente, el flujo del panel es el mismo. ===

test('R1: sin editar (llegada por el chip/boton Fiscal) -> "Completar datos fiscales"', () => {
  assert.equal(rotuloPanelUpgrade(false), 'Completar datos fiscales');
  assert.equal(rotuloPanelUpgrade(undefined), 'Completar datos fiscales');
});

test('R2: editar (llegada por "Editar datos de cliente") -> ese mismo rotulo', () => {
  assert.equal(rotuloPanelUpgrade(true), 'Editar datos de cliente');
});

// === esRfcGenerico ===

test('G1: XAXX010101000 y XEXX010101000 son genericos (case/espacios ignorados)', () => {
  assert.equal(esRfcGenerico('XAXX010101000'), true);
  assert.equal(esRfcGenerico('xexx010101000'), true);
  assert.equal(esRfcGenerico('  XAXX010101000 '), true);
});

test('G2: un RFC real no es generico; vacio/nulo tampoco', () => {
  assert.equal(esRfcGenerico('VAZ990101QX3'), false);
  assert.equal(esRfcGenerico(''), false);
  assert.equal(esRfcGenerico(null), false);
});

// === customerIdFiscal: contra que cliente de Operam se puede hacer el upgrade ===

test('C1: cliente Operam -> su id', () => {
  assert.equal(customerIdFiscal({ tipo: 'operam', id: 479 }), 479);
});

test('C2: prospecto ya ligado a un generico -> clienteOperamId', () => {
  assert.equal(customerIdFiscal({ tipo: 'prospecto', clienteOperamId: 51 }), 51);
});

test('C3: prospecto sin cotizar / contacto nuevo sin id -> null', () => {
  assert.equal(customerIdFiscal({ tipo: 'prospecto', clienteOperamId: null }), null);
  assert.equal(customerIdFiscal({ tipo: 'nuevo' }), null);
  assert.equal(customerIdFiscal(null), null);
});

test('C4 (#167): contacto nuevo YA con alta generica en Operam -> clienteOperamId', () => {
  assert.equal(customerIdFiscal({ tipo: 'nuevo', clienteOperamId: 88 }), 88);
});

// === mostrarBotonCsf: RFC generico + cliente en Operam contra el que actualizar ===

test('B1: Operam con RFC generico -> muestra el boton de CSF', () => {
  assert.equal(mostrarBotonCsf({ tipo: 'operam', id: 479, rfc: 'XAXX010101000' }), true);
});

test('B2: Operam con RFC real -> no muestra el boton', () => {
  assert.equal(mostrarBotonCsf({ tipo: 'operam', id: 10, rfc: 'VAZ990101QX3' }), false);
});

test('B3: prospecto sin cliente en Operam -> no muestra el boton (no hay contra que actualizar)', () => {
  assert.equal(mostrarBotonCsf({ tipo: 'prospecto', clienteOperamId: null, rfc: '' }), false);
});

test('B4: prospecto ligado a un generico -> muestra el boton', () => {
  assert.equal(mostrarBotonCsf({ tipo: 'prospecto', clienteOperamId: 51, rfc: '' }), true);
});

// === tagResultadoClienteHtml ===

test('T1: Cliente Operam sin datos fiscales -> tag rojo "Sin datos fiscales" (#344)', () => {
  const html = tagResultadoClienteHtml({ tipo: 'operam', rfc: 'XAXX010101000' });
  assert.match(html, /pc-tag generico/);
  assert.match(html, /Sin datos fiscales/);
  assert.doesNotMatch(html, /RFC gen/);
});

test('T2: Cliente Operam con RFC real -> tag "Con datos fiscales" (#344)', () => {
  const html = tagResultadoClienteHtml({ tipo: 'operam', rfc: 'VAZ990101QX3' });
  assert.match(html, /pc-tag operam/);
  assert.match(html, /Con datos fiscales/);
});

test('T3: prospecto -> tag "Prospecto"', () => {
  const html = tagResultadoClienteHtml({ tipo: 'prospecto' });
  assert.match(html, /pc-tag prospecto/);
});

// #344: el estado lo decide el SERVIDOR contra el RFC que Operam tiene hoy. Si
// llega, manda sobre el RFC de la fila -- que puede ser el de antes de un
// upgrade fiscal.
test('T4: el estado fiscal que manda el servidor gana sobre el RFC de la fila (#344)', () => {
  const html = tagResultadoClienteHtml({ tipo: 'operam', rfc: 'XAXX010101000', fiscal: 'con_datos_fiscales' });
  assert.match(html, /Con datos fiscales/);
  assert.doesNotMatch(html, /Sin datos fiscales/);
});

test('T5: el Cliente Operam con pedido lo dice, y el que no tiene no dice nada (#344)', () => {
  assert.match(tagPedidoClienteHtml({ tipo: 'operam', comercial: 'con_pedido' }), /pc-tag con-pedido/);
  assert.match(tagPedidoClienteHtml({ tipo: 'operam', comercial: 'con_pedido' }), /con pedido/);
  assert.equal(tagPedidoClienteHtml({ tipo: 'operam', comercial: 'cotizado' }), '');
  assert.equal(tagPedidoClienteHtml({ tipo: 'operam', comercial: 'sin_actividad' }), '');
  assert.equal(tagPedidoClienteHtml({ tipo: 'operam' }), '');
});

test('T6: la fila de resultado pinta los dos estados juntos (#344)', () => {
  const html = filaResultadoClienteHtml(
    { tipo: 'operam', nombre: 'Jorge Orea', sub: '', rfc: 'XAXX010101000', fiscal: 'sin_datos_fiscales', comercial: 'con_pedido' }, 0);
  assert.match(html, /Sin datos fiscales/);
  assert.match(html, /con pedido/);
});

// === filaResultadoClienteHtml / filaCrearClienteHtml ===

test('F1: la fila de resultado enlaza a cvElegirResultado por indice e incluye el tag', () => {
  const html = filaResultadoClienteHtml({ tipo: 'operam', nombre: 'Yazmin Vazquez', sub: 'XAXX010101000', rfc: 'XAXX010101000' }, 3);
  assert.match(html, /cvElegirResultado\(3\)/);
  assert.match(html, /pc-res-row/);
  assert.match(html, /Yazmin Vazquez/);
  assert.match(html, /pc-tag generico/);
});

test('F2: la fila de crear abre el alta completa con el query (no un prospecto minimo)', () => {
  const html = filaCrearClienteHtml('yazmin');
  assert.match(html, /pc-crear/);
  assert.match(html, /cvCaminoAlta/);
  assert.match(html, /yazmin/);
  assert.match(html, /alta cliente completo/i);
});

// La fila tambien se pinta en el ESTADO INICIAL de la vista, con el buscador vacio
// (#190): ahi no hay query que entrecomillar y "cliente completo <<>>" seria ruido.
test('F2b: sin query la fila se ofrece igual, pero sin comillas vacias', () => {
  const html = filaCrearClienteHtml('');
  assert.match(html, /pc-crear/);
  assert.match(html, /cvCaminoAlta/);
  assert.match(html, /alta cliente completo/i);
  assert.doesNotMatch(html, /&laquo;\s*&raquo;/);
});

test('F2c: un query de solo espacios cuenta como vacio', () => {
  assert.doesNotMatch(filaCrearClienteHtml('   '), /&laquo;/);
});

test('F3: filaResultado escapa el nombre (sin XSS)', () => {
  const html = filaResultadoClienteHtml({ tipo: 'prospecto', nombre: '<img src=x>', sub: '' }, 0);
  assert.doesNotMatch(html, /<img src=x>/);
  assert.match(html, /&lt;img/);
});

// #196: nombre corto (cust_ref) entre parentesis, mismo formato en toda la app
// (helper nombreConCorto). Solo aplica a filas tipo 'operam' (traen ref real);
// las de prospecto no tienen cust_ref.
test('F4 (#196): fila operam con nombre corto distinto lo muestra entre parentesis', () => {
  const html = filaResultadoClienteHtml({ tipo: 'operam', nombre: 'Decoracion Maria Pia', ref: 'Casa Maria Pia', sub: '', rfc: 'VAZ990101QX3' }, 0);
  assert.match(html, /Decoracion Maria Pia \(Casa Maria Pia\)/);
});

test('F5 (#196): fila operam con nombre corto igual al nombre no repite parentesis', () => {
  const html = filaResultadoClienteHtml({ tipo: 'operam', nombre: 'Peltre Nacional', ref: 'PELTRE NACIONAL', sub: '', rfc: 'VAZ990101QX3' }, 0);
  assert.match(html, /pc-res-nombre">Peltre Nacional<\/span>/);
});

test('F6 (#196): fila prospecto NO aplica el helper aunque traiga un ref (no tiene cust_ref real)', () => {
  const html = filaResultadoClienteHtml({ tipo: 'prospecto', nombre: 'Maria Torres', ref: 'Un ref cualquiera', sub: '' }, 0);
  assert.match(html, /pc-res-nombre">Maria Torres<\/span>/);
});

// === Accion "Editar" de la fila (#198): puerta de entrada explicita segun tipo,
// sin mover ni duplicar la fila de alta (#190). ===

test('E1: fila de cliente Operam emite "Editar datos de cliente" contra su indice', () => {
  const html = filaResultadoClienteHtml({ tipo: 'operam', nombre: 'Yazmin Vazquez', sub: 'XAXX010101000', rfc: 'XAXX010101000' }, 3);
  assert.match(html, /cvEditarClienteFila\(3\)/);
  assert.match(html, /Editar datos de cliente/);
});

// #346: la vista dejo de listar prospectos sueltos y lista CONTACTOS, asi que la
// puerta de #198 es la misma sobre la persona -- mismo formulario inline de #66.
test('E2: fila de Contacto en etapa activa emite "Editar Contacto" con el formulario inline de #66', () => {
  const raw = { id: 77, nombre: 'Maria Torres', ciudad: 'CDMX', celular: '+525511112222', etapa: 'por_cotizar', data: {} };
  const html = filaResultadoClienteHtml({ tipo: 'contacto', id: 77, nombre: 'Maria Torres', sub: '', raw }, 0);
  assert.match(html, /cvAbrirEdicionProspectoFila\(77\)/);
  assert.match(html, /Editar Contacto/);
  assert.match(html, /id="pr-edicion-77"/);
  assert.match(html, /id="ed-nombre-77"/); // reusa buildEdicionProspectoFormHtml de #66, sin copia
});

test('E3 (#66): Contacto en etapa de salida (no_util/perdida) no ofrece la accion -- el server rechaza con 400', () => {
  const rawNoUtil = { id: 78, nombre: 'Cerrado', ciudad: 'CDMX', celular: '+525511112222', etapa: 'no_util', data: {} };
  const htmlNoUtil = filaResultadoClienteHtml({ tipo: 'contacto', id: 78, nombre: 'Cerrado', sub: '', raw: rawNoUtil }, 0);
  assert.doesNotMatch(htmlNoUtil, /Editar Contacto/);
  assert.doesNotMatch(htmlNoUtil, /pr-edicion-78/);

  const rawPerdida = { id: 79, nombre: 'Cerrado', ciudad: 'CDMX', celular: '+525511112222', etapa: 'perdida', data: {} };
  const htmlPerdida = filaResultadoClienteHtml({ tipo: 'contacto', id: 79, nombre: 'Cerrado', sub: '', raw: rawPerdida }, 0);
  assert.doesNotMatch(htmlPerdida, /Editar Contacto/);
});

test('E4: fila de Contacto sin raw resuelto (compatibilidad) no revienta ni ofrece editar', () => {
  const html = filaResultadoClienteHtml({ tipo: 'contacto', nombre: 'Sin raw', sub: '' }, 0);
  assert.doesNotMatch(html, /Editar Contacto/);
});

// === bannerUpgradeHtml ===

test('N1: el banner nombra al cliente, su id y el RFC generico que se sustituye', () => {
  const html = bannerUpgradeHtml({ nombre: 'Yazmin Vazquez', id: 479, rfc: 'XAXX010101000' });
  assert.match(html, /banner-upgrade/);
  assert.match(html, /Yazmin Vazquez/);
  assert.match(html, /479/);
  assert.match(html, /XAXX010101000/);
  assert.match(html, /No se crea un cliente nuevo/);
});

test('N2: el banner escapa el nombre del cliente', () => {
  const html = bannerUpgradeHtml({ nombre: '<b>x</b>', id: 1, rfc: 'XAXX010101000' });
  assert.doesNotMatch(html, /<b>x<\/b>/);
});

test('N3: RFC real (no generico) -> copy de edicion, sin "generico" ni "se sustituira"', () => {
  const html = bannerUpgradeHtml({ nombre: 'Decoracion Maria Pia', id: 900, rfc: 'DMP2306125E3' });
  assert.match(html, /Editando datos de:/);
  assert.match(html, /RFC actual:/);
  assert.match(html, /DMP2306125E3/);
  assert.doesNotMatch(html, /generico/);
  assert.doesNotMatch(html, /se sustituira/);
});

test('N4: RFC vacio -> copy de pendiente, sin el hueco "generico  se"', () => {
  const html = bannerUpgradeHtml({ nombre: 'Cliente Nuevo', id: 5, rfc: '' });
  assert.match(html, /Editando datos de:/);
  assert.match(html, /RFC actual: pendiente/);
  assert.doesNotMatch(html, /generico\s{2}se/);
  assert.doesNotMatch(html, /generico/);
});

// === chipsClienteViewHtml ===

test('H1: chip Fiscal pendiente con cliente en Operam es accionable (abre el upgrade)', () => {
  const html = chipsClienteViewHtml({ contacto: true, entrega: 'cp', fiscal: false }, 479);
  assert.match(html, /cvAbrirUpgrade\(\)/);
  assert.match(html, /Entrega &middot; CP/);
});

test('H2: chip Fiscal en verde cuando el RFC ya es real (sin boton)', () => {
  const html = chipsClienteViewHtml({ contacto: true, entrega: 'completo', fiscal: true }, 10);
  assert.doesNotMatch(html, /cvAbrirUpgrade/);
  assert.match(html, /Fiscal/);
});

test('H3: sin cliente en Operam el chip Fiscal es estatico (no abre upgrade)', () => {
  const html = chipsClienteViewHtml({ contacto: true, entrega: 'pendiente', fiscal: false }, null);
  assert.doesNotMatch(html, /cvAbrirUpgrade/);
});

// === cardClienteHtml ===

test('D1: Operam generico -> boton CSF + boton Cotizar + ID en el subtitulo', () => {
  const html = cardClienteHtml({ tipo: 'operam', id: 479, name: 'Yazmin Vazquez', rfc: 'XAXX010101000', telefono: '+52 55 1111 2222', cp: '31000', pais: 'MX' });
  assert.match(html, /Completar datos fiscales \(CSF\)/);
  assert.match(html, /cvCotizar\(\)/);
  assert.match(html, /ID 479/);
  assert.match(html, /Cliente en Operam/);
});

test('D2: Operam con RFC real -> sin boton CSF, chips en verde', () => {
  const html = cardClienteHtml({ tipo: 'operam', id: 10, name: 'La Vasija', rfc: 'VAZ990101QX3', telefono: '+52 55 1111 2222', cp: '44100', calle: 'Reforma 10', pais: 'MX' });
  assert.doesNotMatch(html, /Completar datos fiscales/);
  assert.match(html, /cvCotizar\(\)/);
});

test('D3: escapa el nombre del cliente', () => {
  const html = cardClienteHtml({ tipo: 'operam', id: 1, name: '<script>x</script>', rfc: 'XAXX010101000' });
  assert.doesNotMatch(html, /<script>x<\/script>/);
});

// #196: la tarjeta del cliente seleccionado (paso Cliente y vista Clientes,
// mismo builder) muestra el nombre corto (ref) entre parentesis.
test('D4 (#196): cardClienteHtml muestra el nombre corto cuando difiere del nombre', () => {
  const html = cardClienteHtml({ tipo: 'operam', id: 479, name: 'Decoracion Maria Pia', ref: 'Casa Maria Pia', rfc: 'VAZ990101QX3' });
  assert.match(html, /Decoracion Maria Pia \(Casa Maria Pia\)/);
});

test('D5 (#196): cardClienteHtml sin nombre corto informativo no agrega parentesis', () => {
  const html = cardClienteHtml({ tipo: 'operam', id: 479, name: 'Peltre Nacional', ref: 'PELTRE NACIONAL', rfc: 'VAZ990101QX3' });
  assert.doesNotMatch(html, /pc-cli-nombre">[^<]*\(/);
});

// === Issue #287: chip Origen en la vista Clientes ===
// Un cliente de Operam no tiene origen propio: solo lo tiene si alguna vez fue
// prospecto en el cotizador. La herencia la anota el buscador (pcBuscarMezclado,
// que ya carga los prospectos) y aqui solo se pinta.

test('OR11: la fila de resultado pinta el Origen heredado y el que falta', () => {
  const conOrigen = filaResultadoClienteHtml({ tipo: 'operam', nombre: 'Yazmin Vazquez', sub: '', rfc: 'VAZ990101QX3', origen: 'Referido' }, 0);
  assert.match(conOrigen, /origen-badge">Origen: Referido/);
  const historico = filaResultadoClienteHtml({ tipo: 'operam', nombre: 'Cliente historico', sub: '', rfc: 'VAZ990101QX3' }, 1);
  assert.match(historico, /origen-badge-vacio">Origen sin identificar/);
});

test('OR12: la tarjeta del cliente pinta el Origen heredado y el que falta', () => {
  const conOrigen = cardClienteHtml({ tipo: 'operam', id: 479, name: 'Yazmin Vazquez', rfc: 'VAZ990101QX3', origen: 'Feria/Expo' });
  assert.match(conOrigen, /origen-badge">Origen: Feria\/Expo/);
  const historico = cardClienteHtml({ tipo: 'operam', id: 480, name: 'Cliente historico', rfc: 'VAZ990101QX3' });
  assert.match(historico, /origen-badge-vacio">Origen sin identificar/);
});

// === #346: la vista Clientes agrupa por Contacto (spec #337, ADR-0016) ===
// La unidad de la fila es la PERSONA, no la entidad legal: la misma persona una
// sola vez, con sus etiquetas y sus Clientes Operam anidados. La ficha es su
// historia completa antes de escribirle.

const CONTACTO = {
  tipo: 'contacto', id: 1, nombre: 'Laura Mendez', ciudad: 'Puebla',
  celular: '+52 55 1234 5678', sub: 'Puebla - +52 55 1234 5678', origen: 'WhatsApp',
  etiquetas: ['prospecto', 'cotizado', 'con_pedido'],
  oportunidades: [
    { tipo: 'cotizacion', id: 'c50', refId: 50, etapa: 'seguimiento', folioOperam: 1240 },
    { tipo: 'cotizacion', id: 'c51', refId: 51, etapa: 'perdida', folioOperam: 1199 },
    { tipo: 'prospecto', id: 'p1', refId: 1, etapa: 'por_cotizar', folioOperam: null },
  ],
  clientesOperam: [
    { id: '514', nombre: 'JORGE OREA', rfc: 'XAXX010101000', fiscal: 'sin_datos_fiscales', comercial: 'con_pedido' },
    { id: '780', nombre: 'OREA EVENTOS SA DE CV', rfc: 'OEV220101QX3', fiscal: 'con_datos_fiscales', comercial: 'cotizado' },
  ],
  raw: { id: 1, nombre: 'Laura Mendez', ciudad: 'Puebla', celular: '+52 55 1234 5678', etapa: 'seguimiento', data: {} },
};

test('CT1: la ficha nombra al Contacto, su celular y su Origen', () => {
  const html = fichaContactoHtml(CONTACTO);
  assert.match(html, /Laura Mendez/);
  assert.match(html, /\+52 55 1234 5678/);
  assert.match(html, /origen-badge">Origen: WhatsApp/);
});

test('CT2: la ficha pinta las etiquetas del Contacto con su texto de pantalla', () => {
  const html = fichaContactoHtml(CONTACTO);
  assert.match(html, />Prospecto</);
  assert.match(html, />Cotizado</);
  assert.match(html, />con pedido</);
});

test('CT3: la ficha lista TODAS sus Oportunidades con su folio y su etapa', () => {
  const html = fichaContactoHtml(CONTACTO);
  assert.match(html, /badge-operam">[^<]*1240/);
  assert.match(html, /Seguimiento/);
  assert.match(html, /badge-operam">[^<]*1199/);
  assert.match(html, /Perdida/);
  assert.match(html, /Por Cotizar/);
});

test('CT4: la ficha lista sus Clientes Operam con sus dos estados', () => {
  const html = fichaContactoHtml(CONTACTO);
  assert.match(html, /JORGE OREA/);
  assert.match(html, /Sin datos fiscales/);
  assert.match(html, /OREA EVENTOS SA DE CV/);
  assert.match(html, /Con datos fiscales/);
  assert.match(html, /pc-tag con-pedido/);
});

// AC4: el salto a completar datos fiscales apunta al Cliente Operam que le
// falta, no al Contacto -- un Contacto puede tener varios.
test('CT5: solo el Cliente Operam sin datos fiscales ofrece completarlos, contra SU id', () => {
  const html = fichaContactoHtml(CONTACTO);
  assert.match(html, /cvUpgradeClienteOperam\('514'\)/);
  assert.doesNotMatch(html, /cvUpgradeClienteOperam\('780'\)/);
});

test('CT6: la ficha abre Nueva oportunidad con el celular y deja cotizar', () => {
  const html = fichaContactoHtml(CONTACTO);
  assert.match(html, /abrirNuevaOportunidad\('\+525512345678'\)/);
  assert.match(html, /cvCotizar\(\)/);
});

test('CT7: un Contacto sin Oportunidades ni Clientes Operam lo dice, sin huecos', () => {
  const html = fichaContactoHtml({ ...CONTACTO, oportunidades: [], clientesOperam: [], etiquetas: [] });
  assert.match(html, /Sin oportunidades/);
  assert.match(html, /Sin Clientes Operam/);
});

test('CT8: la ficha escapa el nombre del Contacto', () => {
  const html = fichaContactoHtml({ ...CONTACTO, nombre: '<img src=x>' });
  assert.doesNotMatch(html, /<img src=x>/);
  assert.match(html, /&lt;img/);
});

test('CT9: la fila del Contacto abre su ficha por indice y nombra sus Clientes Operam', () => {
  const html = filaContactoHtml(CONTACTO, 2);
  assert.match(html, /cvElegirResultado\(2\)/);
  assert.match(html, /Laura Mendez/);
  assert.match(html, /JORGE OREA/);
  assert.match(html, /OREA EVENTOS SA DE CV/);
});

test('CT10: filaResultadoClienteHtml despacha a la fila de Contacto por su tipo', () => {
  assert.equal(filaResultadoClienteHtml(CONTACTO, 2), filaContactoHtml(CONTACTO, 2));
});
