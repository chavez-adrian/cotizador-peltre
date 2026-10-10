// Fusion de Contactos (#565, enmienda 2026-10-09 a ADR-0016, GLOSSARY.md "Contacto"):
// cuando el vendedor cambia desde el cotizador el Cel de un Contacto en Operam (su
// person_id no cambia), el Contacto del numero viejo se funde solo en el del numero
// nuevo, con su historial, Oportunidades y etiquetas. Se prueba por la interfaz del
// modulo (`fundirContactos`) contra el adaptador en memoria de los stores
// (test/helpers/fusion-contactos-memoria.js), y lo que queda se lee con los MISMOS
// nucleos puros con los que el tablero arma tarjetas y etiquetas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fundirContactos, resumenDelCambioDeNumero } from '../lib/fusion-contactos.js';
import { fusionContactosEnMemoria } from './helpers/fusion-contactos-memoria.js';
import { oportunidadesDeContactos } from '../lib/oportunidad-pre.js';
import { tarjetasOportunidades } from '../lib/oportunidades.js';
import { anotarEstadosOportunidades, indiceContactosPorCelular } from '../lib/etiquetas-contacto.js';

const VIEJO = '+52 55 8888 0000';
const NUEVO = '+52 55 1234 5678';

// Lucia, capturada en la expo con su numero viejo, cotizada (folio 1357) y con una
// Nueva oportunidad abierta, ligada al Cliente Operam 22.
const LUCIA_VIEJO = {
  id: 10, fecha: '2026-09-01T16:00:00.000Z', vendedor: 'Ana', celular: VIEJO, nombre: 'Lucia Recibe',
  ciudad: 'Puebla', canal: 'expo', etapa: 'seguimiento',
  eventos: [{ tipo: 'captura', fecha: '2026-09-01T16:00:00.000Z', vendedor: 'Ana' }],
  data: { empresa: 'Taqueria Lucia', cliente_id: 22, clientes_operam: [{ cliente_id: 22, fuente: 'cotizador' }] },
};
// Su numero nuevo ya era un Contacto que nadie capturo (vino del historico de
// Operam), ligado al Cliente Operam 15, que ya compro.
const LUCIA_NUEVO = {
  id: 20, fecha: '2026-09-20T16:00:00.000Z', vendedor: null, celular: NUEVO, nombre: 'Lucia R', ciudad: '',
  canal: null, etapa: 'por_cotizar', eventos: [],
  data: { sinCaptura: true, cliente_id: 15, clientes_operam: [{ cliente_id: 15, fuente: 'cotizador' }] },
};
const OPORTUNIDAD_30 = {
  id: 30, fecha: '2026-10-01T16:00:00.000Z', contactoId: 10, contacto10: '5588880000', vendedor: 'Ana',
  etapa: 'por_cotizar', eventos: [], data: {},
};
const COTIZACION_100 = {
  id: 100, fecha: '2026-09-02T16:00:00.000Z', vendedor: 'Ana', cliente: 'Taqueria Lucia', folioOperam: '1357',
  estado: 'activa', etapa: 'seguimiento', contactoCelular: '5588880000',
  data: { cliente: { telefono: VIEJO, celEntrega: VIEJO, customerId: 22 } },
};

const SOLICITUD = { celularViejo: VIEJO, celularNuevo: NUEVO, personId: '1249', cotizacion: { id: 100, folio: '1357' }, vendedor: 'Ana' };

// Lo que el tablero pintaria con lo que quedo: tarjetas con sus etiquetas, con el
// Cliente Operam 15 con pedido y el 22 sin actividad.
function tablero(estado) {
  const filas = oportunidadesDeContactos(estado.contactos, estado.oportunidades);
  const tarjetas = tarjetasOportunidades(filas, estado.cotizaciones, { contactos: estado.contactos });
  const estados = new Map([['15', { fiscal: 'con_datos_fiscales', comercial: 'con_pedido' }], ['22', { fiscal: 'sin_datos_fiscales', comercial: 'sin_actividad' }]]);
  return anotarEstadosOportunidades(tarjetas, { estados, contactos: indiceContactosPorCelular(estado.contactos) });
}

test('F1: queda un solo Contacto, el del numero nuevo, con las Oportunidades y las etiquetas de los dos', async () => {
  const mem = fusionContactosEnMemoria({ contactos: [LUCIA_VIEJO, LUCIA_NUEVO], oportunidades: [OPORTUNIDAD_30], cotizaciones: [COTIZACION_100] });
  const r = await fundirContactos(SOLICITUD, mem.deps);
  assert.equal(r.tipo, 'lograda');
  assert.equal(r.fundido, true);

  assert.deepEqual(mem.estado.contactos.map(c => [c.id, c.celular10]), [[20, '5512345678']]);
  const tarjetas = tablero(mem.estado);
  assert.deepEqual(tarjetas.map(t => t.id).sort(), ['c100', 'p30']);
  assert.equal(tarjetas.find(t => t.id === 'p30').celular, NUEVO);
  assert.equal(tarjetas.find(t => t.id === 'c100').celularCruce, '5512345678');
  for (const t of tarjetas) assert.deepEqual(t.etiquetas, ['prospecto', 'cotizado', 'con_pedido'], `tarjeta ${t.id}`);
});

// La Oportunidad que la ficha del Contacto todavia sintetizaba (#343: sin registro
// propio, la ficha ES su Oportunidad) no se pierde al borrar la ficha: se separa con la
// misma regla de la migracion y se mueve. La del Contacto nuevo, si lo capturaron,
// tampoco desaparece cuando recibe Oportunidades propias.
test('F2: la Oportunidad que cada ficha sintetizaba sigue en el tablero, en el Contacto del numero nuevo', async () => {
  const viejo = { ...LUCIA_VIEJO, etapa: 'por_cotizar', data: { empresa: 'Taqueria Lucia' } };
  const nuevo = { ...LUCIA_NUEVO, vendedor: 'Beto', canal: 'whatsapp', etapa: 'por_cotizar', data: {} };
  const mem = fusionContactosEnMemoria({ contactos: [viejo, nuevo] });
  const r = await fundirContactos(SOLICITUD, mem.deps);
  assert.equal(r.tipo, 'lograda');

  const tarjetas = tablero(mem.estado);
  assert.deepEqual(tarjetas.map(t => [t.id, t.celular, t.vendedor, t.etapa]).sort(), [
    ['p10', NUEVO, 'Ana', 'por_cotizar'],
    ['p20', NUEVO, 'Beto', 'por_cotizar'],
  ]);
  assert.deepEqual(mem.estado.oportunidades.map(o => [o.id, o.contactoId, o.contacto10]).sort(), [
    [10, 20, '5512345678'],
    [20, 20, '5512345678'],
  ]);
});

// La fusion queda registrada en el Contacto que queda: de que numero a que numero, por
// que person_id y desde que cotizacion, con el Contacto que se fundio y sus eventos.
test('F3: la fusion queda registrada como evento del Contacto que queda (de, a, person_id, cotizacion)', async () => {
  const mem = fusionContactosEnMemoria({ contactos: [LUCIA_VIEJO, LUCIA_NUEVO], oportunidades: [OPORTUNIDAD_30], cotizaciones: [COTIZACION_100] });
  await fundirContactos(SOLICITUD, mem.deps);
  const [evento] = mem.estado.contactos.find(c => c.id === 20).eventos;
  assert.deepEqual(
    { tipo: evento.tipo, celularDe: evento.celularDe, celularA: evento.celularA, personId: evento.personId, cotizacion: evento.cotizacion, contactoFundido: evento.contactoFundido, vendedor: evento.vendedor, fecha: evento.fecha },
    { tipo: 'fusion', celularDe: '5588880000', celularA: '5512345678', personId: '1249', cotizacion: { id: 100, folio: '1357' }, contactoFundido: 10, vendedor: 'Ana', fecha: '2026-10-09T18:00:00.000Z' },
  );
  assert.deepEqual(evento.eventosFundidos, LUCIA_VIEJO.eventos);
  assert.deepEqual([evento.oportunidades, evento.cotizaciones], [[30], [100]]);
  // D4 (decisiones de Adrian 2026-10-09): el evento guarda la ficha vieja COMPLETA, para
  // poder deshacer a mano lo que se borro.
  assert.deepEqual(evento.fichaAnterior, { ...LUCIA_VIEJO, celular10: '5588880000' });
});

// Sin un Contacto con el numero nuevo no se crea otro para fundir: el viejo se muda al
// numero nuevo con su misma ficha (id, Origen, eventos), y sus Oportunidades y
// cotizaciones lo siguen.
test('F4: si el numero nuevo no era un Contacto, el viejo se muda a el con su ficha, Oportunidades y cotizaciones', async () => {
  const mem = fusionContactosEnMemoria({ contactos: [LUCIA_VIEJO], oportunidades: [OPORTUNIDAD_30], cotizaciones: [COTIZACION_100] });
  const r = await fundirContactos(SOLICITUD, mem.deps);
  assert.deepEqual([r.tipo, r.fundido, r.forma, r.contactoId], ['lograda', true, 'mudado', 10]);
  assert.deepEqual(mem.estado.contactos.map(c => [c.id, c.celular, c.celular10, c.canal, c.nombre]), [[10, NUEVO, '5512345678', 'expo', 'Lucia Recibe']]);
  const tarjetas = tablero(mem.estado);
  assert.deepEqual(tarjetas.map(t => t.id).sort(), ['c100', 'p30']);
  for (const t of tarjetas) assert.deepEqual(t.etiquetas, ['prospecto', 'cotizado'], `tarjeta ${t.id}`);
  const eventos = mem.estado.contactos[0].eventos;
  assert.equal(eventos.length, 2);
  assert.deepEqual([eventos[1].tipo, eventos[1].celularDe, eventos[1].celularA, eventos[1].personId], ['fusion', '5588880000', '5512345678', '1249']);
  // D4: tambien al mudar, la ficha como estaba antes (con el numero viejo).
  assert.deepEqual(eventos[1].fichaAnterior, { ...LUCIA_VIEJO, celular10: '5588880000' });
});

test('F5: si el numero anterior no era un Contacto del cotizador no se funde nada y no se escribe', async () => {
  const mem = fusionContactosEnMemoria({ contactos: [LUCIA_NUEVO], cotizaciones: [COTIZACION_100] });
  const r = await fundirContactos(SOLICITUD, mem.deps);
  assert.deepEqual([r.tipo, r.fundido, r.motivo], ['lograda', false, 'sin-contacto-viejo']);
  assert.equal(r.pasos[0].status, 'omitido');
  assert.match(r.pasos[0].mensaje, /no era un Contacto/);
  assert.deepEqual(mem.llamadas.map(([n]) => n), ['contactos.buscarPorCelular']);
  assert.equal(mem.estado.cotizaciones[0].contactoCelular, '5588880000');
});

test('F6: el mismo numero con otro formato, o un numero sin 10 digitos, no funde nada', async () => {
  const mismo = fusionContactosEnMemoria({ contactos: [LUCIA_VIEJO] });
  const r = await fundirContactos({ ...SOLICITUD, celularNuevo: '55 8888 0000' }, mismo.deps);
  assert.deepEqual([r.fundido, r.motivo], [false, 'mismo-numero']);
  const corto = await fundirContactos({ ...SOLICITUD, celularNuevo: '1234' }, mismo.deps);
  assert.deepEqual([corto.fundido, corto.motivo], [false, 'sin-numero']);
  assert.deepEqual(mismo.llamadas, []);
});

// Una cotizacion anterior a la liga fija (#342) cruza por el telefono tecleado: con el
// Contacto viejo borrado se quedaria colgando de un numero que ya no es de nadie, asi
// que la fusion le anota la liga al numero nuevo. Una liga fija de otro numero no se
// toca.
test('F7: la cotizacion historica que cruzaba por el numero viejo queda ligada al nuevo; la de otro Contacto no se toca', async () => {
  const historica = { ...COTIZACION_100, id: 101, contactoCelular: null };
  const ajena = { ...COTIZACION_100, id: 102, contactoCelular: '5599990000', data: { cliente: { telefono: VIEJO } } };
  const mem = fusionContactosEnMemoria({ contactos: [LUCIA_VIEJO, LUCIA_NUEVO], cotizaciones: [historica, ajena] });
  const r = await fundirContactos(SOLICITUD, mem.deps);
  assert.deepEqual(r.cotizaciones, [101]);
  assert.deepEqual(mem.estado.cotizaciones.map(c => [c.id, c.contactoCelular]), [[101, '5512345678'], [102, '5599990000']]);
});

// Una falla del registro a medias no lanza: el desenlace dice en dos capas que la
// fusion no termino y, en el detalle, en que paso fallo y que ya se habia movido.
test('F8: si un store falla a medias, devuelve el aviso en dos capas con lo que alcanzo a moverse', async () => {
  const mem = fusionContactosEnMemoria({
    contactos: [LUCIA_VIEJO, LUCIA_NUEVO], oportunidades: [OPORTUNIDAD_30], cotizaciones: [COTIZACION_100],
    falla: { 'contactos.borrar': true },
  });
  const r = await fundirContactos(SOLICITUD, mem.deps);
  assert.deepEqual([r.tipo, r.motivo, r.pasos[0].name, r.pasos[0].status], ['bloqueo', 'registro', 'Contacto movido al n\u00famero nuevo', 'warn']);
  assert.match(r.mensaje, /no se pudo terminar de pasar lo del \+52 55 8888 0000 al \+52 55 1234 5678/);
  assert.doesNotMatch(r.mensaje, /borrar|store|memoria/);
  assert.match(r.detalle, /fallo al borrar el Contacto viejo/);
  assert.match(r.detalle, /oportunidades \[30\] a 20/);
  assert.match(r.detalle, /evento fusion en 20/);
});

// D4 (decisiones de Adrian 2026-10-09): ningun texto que vea el vendedor dice "fundir"
// ni "fusion"; el paso se llama "Contacto movido al numero nuevo". La palabra se queda en
// el codigo y en el registro (el evento sigue siendo `fusion`).
test('F9: los pasos del cambio de numero no dicen fundir ni fusion, en ninguno de sus desenlaces', async () => {
  const casos = [
    [fusionContactosEnMemoria({ contactos: [LUCIA_VIEJO, LUCIA_NUEVO], oportunidades: [OPORTUNIDAD_30], cotizaciones: [COTIZACION_100] }), SOLICITUD],
    [fusionContactosEnMemoria({ contactos: [LUCIA_VIEJO] }), SOLICITUD],
    [fusionContactosEnMemoria({ contactos: [LUCIA_NUEVO] }), SOLICITUD],
    [fusionContactosEnMemoria({ contactos: [LUCIA_VIEJO] }), { ...SOLICITUD, celularNuevo: '55 8888 0000' }],
    [fusionContactosEnMemoria({ contactos: [LUCIA_VIEJO] }), { ...SOLICITUD, celularNuevo: '1234' }],
    [fusionContactosEnMemoria({ contactos: [LUCIA_VIEJO, LUCIA_NUEVO], falla: { 'contactos.borrar': true } }), SOLICITUD],
  ];
  for (const [mem, solicitud] of casos) {
    const r = await fundirContactos(solicitud, mem.deps);
    for (const p of r.pasos) {
      assert.equal(p.name, 'Contacto movido al n\u00famero nuevo');
      assert.doesNotMatch(p.mensaje, /fund|fusi/i, p.mensaje);
    }
    if (r.mensaje) assert.doesNotMatch(r.mensaje, /fund|fusi/i);
  }
});

// D4: lo que la pregunta le dice al vendedor ANTES de mover nada -- cuantas
// oportunidades y cotizaciones pasan al numero nuevo y si el numero viejo tiene
// oportunidades o cotizaciones de OTRAS personas --, sin escribir nada.
test('F10: el resumen del cambio cuenta las oportunidades y cotizaciones del numero viejo, sin escribir nada', async () => {
  const historica = { ...COTIZACION_100, id: 101, contactoCelular: null, data: { cliente: { telefono: VIEJO, nombreEntrega: 'Lucia' } } };
  const ajena = { ...COTIZACION_100, id: 102, contactoCelular: '5599990000', data: { cliente: { telefono: VIEJO, nombreEntrega: 'Otra Persona' } } };
  const mem = fusionContactosEnMemoria({ contactos: [LUCIA_VIEJO, LUCIA_NUEVO], oportunidades: [OPORTUNIDAD_30], cotizaciones: [COTIZACION_100, historica, ajena] });
  const r = await resumenDelCambioDeNumero({ celularViejo: VIEJO, nombres: ['Lucia Recibe'] }, mem.deps);
  assert.deepEqual(r, { contactoViejo: true, oportunidades: 1, cotizaciones: 2, otrasPersonas: [] });
  assert.deepEqual(mem.llamadas.map(([n]) => n).filter(n => !/buscarPorCelular|listar/.test(n)), []);
});

// La ficha que todavia ES su Oportunidad (#343) cuenta como una.
test('F11: sin Oportunidades propias, la que la ficha sintetiza cuenta como una; sin Contacto viejo no hay nada que mover', async () => {
  const sintetiza = fusionContactosEnMemoria({ contactos: [{ ...LUCIA_VIEJO, etapa: 'por_cotizar', data: {} }] });
  assert.deepEqual(await resumenDelCambioDeNumero({ celularViejo: VIEJO, nombres: ['Lucia Recibe'] }, sintetiza.deps),
    { contactoViejo: true, oportunidades: 1, cotizaciones: 0, otrasPersonas: [] });
  const nadie = fusionContactosEnMemoria({ contactos: [LUCIA_NUEVO], cotizaciones: [COTIZACION_100] });
  assert.deepEqual(await resumenDelCambioDeNumero({ celularViejo: VIEJO, nombres: ['Lucia Recibe'] }, nadie.deps),
    { contactoViejo: false, oportunidades: 0, cotizaciones: 0, otrasPersonas: [] });
});

// Telefono compartido (D4): "otras personas" son los nombres, normalizados (sin acentos
// ni mayusculas ni espacios de mas), de la ficha del Contacto viejo y del Contacto de
// entrega de sus cotizaciones que no son el de la persona: ni iguales, ni el mismo nombre
// sin apellido (uno es el comienzo, palabra por palabra, del otro). Las Oportunidades
// no guardan nombre propio: su persona es la ficha.
test('F12: el numero viejo con oportunidades de otras personas las nombra una vez cada una; las de la misma persona, con o sin apellido, no cuentan', async () => {
  const pedro = { ...LUCIA_VIEJO, nombre: 'Pedro Lopez' };
  const deMaria = { ...COTIZACION_100, id: 103, data: { cliente: { telefono: VIEJO, nombreEntrega: 'Mar\u00eda  Ruiz' } } };
  const deMaria2 = { ...COTIZACION_100, id: 104, data: { cliente: { telefono: VIEJO, nombreEntrega: 'maria ruiz' } } };
  const deLucia = { ...COTIZACION_100, id: 105, data: { cliente: { telefono: VIEJO, nombreEntrega: 'Lucia' } } };
  const mem = fusionContactosEnMemoria({ contactos: [pedro], cotizaciones: [deMaria, deMaria2, deLucia] });
  const r = await resumenDelCambioDeNumero({ celularViejo: VIEJO, nombres: ['Lucia Recibe Almacen', 'Lucia Recibe'] }, mem.deps);
  assert.deepEqual(r.otrasPersonas, ['Pedro Lopez', 'Mar\u00eda  Ruiz']);
  assert.equal(r.cotizaciones, 3);
});
