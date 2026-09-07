// Las etiquetas del Contacto (#344, spec #337, ADR-0016, CONTEXT.md
// "Contacto"): nucleo PURO, sin IO.
//
// Se DERIVAN en el servidor y no se guardan en ninguna parte: guardarlas seria
// poder capturarlas mal, y son justo lo que nadie debe poder capturar. Se
// ACUMULAN y no se quitan -- una Oportunidad Perdida no le quita ninguna al
// Contacto, porque describen su historia, no su estado de animo comercial.
//
// La clasificacion de un celular contra el embudo (lib/clasificar-celular.js) y
// la libreta de Google (lib/contactos-logica.js) consumen la etiqueta prospecto
// desde aqui: hasta #342 "tener fila en la tabla de prospectos" y "ser
// prospecto" eran lo mismo, y desde que la migracion crea Contactos que nadie
// capturo (marca sinCaptura) dejaron de serlo.

import { esContactoSinCaptura } from './contacto-cotizacion.js';
import { CON_PEDIDO as CLIENTE_CON_PEDIDO } from './estado-cliente-operam.js';
import { ultimos10 } from './telefono-llave.js';

export const PROSPECTO = 'prospecto';
export const COTIZADO = 'cotizado';
export const CON_PEDIDO = 'con_pedido';
export const CLIENTE_EN_LINEA = 'cliente_en_linea';

// El orden es el de la historia de la persona, y es el que lee la pantalla.
export const ETIQUETAS_ORDEN = [PROSPECTO, COTIZADO, CON_PEDIDO, CLIENTE_EN_LINEA];

// El texto de pantalla. "Cliente en linea" es compuesto e indivisible y "ya
// compro" se dice "con pedido" (ADR-0016).
export const ETIQUETA_LABELS = {
  [PROSPECTO]: 'Prospecto',
  [COTIZADO]: 'Cotizado',
  [CON_PEDIDO]: 'con pedido',
  [CLIENTE_EN_LINEA]: 'Cliente en linea',
};

// La etiqueta prospecto significa que ALGUIEN lo capturo por alguna puerta, no
// que exista una fila. El Contacto que nacio de la migracion (#342) existe para
// que una Oportunidad historica tenga de quien ser; nadie lo prospecto nunca.
export function esProspecto(contacto) {
  return !!contacto && !esContactoSinCaptura(contacto);
}

// contacto: la ficha del Contacto (o null); oportunidades: las suyas, en
// cualquier etapa; clientesOperam: los Clientes Operam ligados con su estado
// comercial ya resuelto; enLinea: su celular esta en los pedidos de la tienda.
export function etiquetasDeContacto({ contacto = null, oportunidades = [], clientesOperam = [], enLinea = false } = {}) {
  const etiquetas = [];
  if (esProspecto(contacto)) etiquetas.push(PROSPECTO);
  if ((oportunidades || []).some(o => o && o.folioOperam != null && o.folioOperam !== '')) etiquetas.push(COTIZADO);
  if ((clientesOperam || []).some(c => c && c.comercial === CLIENTE_CON_PEDIDO)) etiquetas.push(CON_PEDIDO);
  if (enLinea) etiquetas.push(CLIENTE_EN_LINEA);
  return etiquetas;
}

// El indice celular10 -> ficha del Contacto, la forma en que este modulo (y las
// rutas) preguntan "de quien es este numero". Vive aqui y no en cada ruta para
// que las dos superficies que lo arman no puedan discrepar en el recorte a diez
// digitos.
export function indiceContactosPorCelular(contactos) {
  const indice = new Map();
  for (const c of contactos || []) {
    const cel = ultimos10(c && c.celular);
    if (cel.length === 10 && !indice.has(cel)) indice.set(cel, c);
  }
  return indice;
}

// Los Clientes Operam ligados a un Contacto, por id. La relacion Contacto <->
// Cliente Operam es de MUCHOS A MUCHOS (ADR-0016): el comprador de dos
// restaurantes tiene pedido bajo uno y no bajo el otro, y sigue siendo un
// Contacto con pedido. Por eso la etiqueta los mira a TODOS y no solo al de la
// tarjeta o la fila que se esta pintando.
//
// Son las ligas que el cotizador PERSISTE: la de `ligarCliente`
// (`data.cliente_id` del Contacto) y la que anoto cada Oportunidad suya al
// cotizar. Las derivadas de Operam no se persisten y no entran aqui.
export function clientesOperamLigados(contacto, oportunidades = []) {
  const ids = [];
  const agregar = (id) => {
    if (id == null || id === '') return;
    if (!ids.includes(String(id))) ids.push(String(id));
  };
  agregar(contacto && contacto.data && contacto.data.cliente_id);
  for (const o of oportunidades || []) agregar(o && (o.clienteOperamId ?? o.customerId));
  return ids;
}

// El celular del Contacto de una tarjeta. La tarjeta ya lo trae resuelto
// (lib/oportunidades.js): `celularCruce` en una cotizacion -- que sale de
// `celularesDeCruce`, LA definicion del cruce (#342) -- y `celular` en un
// prospecto, cuya identidad ES su numero. Aqui no se reimplementa el cruce: si
// esa regla cambiara, cambiaria en un solo lugar.
function celularDeTarjeta(t) {
  const diez = ultimos10(t && (t.celularCruce ?? t.celular));
  return diez.length === 10 ? diez : null;
}

// Las tarjetas de Oportunidad + el cache de estados de Operam -> las mismas
// tarjetas con su Cliente Operam (con los dos estados) y las etiquetas de su
// Contacto.
//
// Las etiquetas son del CONTACTO, no de la tarjeta: se calculan una vez por
// celular sobre TODAS sus Oportunidades y se reparten a cada una. Por eso la
// tarjeta de un prospecto que ya cotizo por otra puerta lee "cotizado" aunque
// ella misma no tenga folio -- lo que describe es la persona.
//
// `estados` es Map(customer_id -> { fiscal, comercial, fuenteIncompleta });
// `contactos` es Map(celular10 -> ficha); `enLinea` es Set(celular10). Lo que no
// este en el cache NO se inventa: sin entrada, la tarjeta va sin Cliente Operam.
export function anotarEstadosOportunidades(tarjetas, { estados = new Map(), contactos = new Map(), enLinea = new Set() } = {}) {
  const lista = tarjetas || [];
  const estadoDe = (id) => (id == null ? null : estados.get(String(id)) || null);

  const porCelular = new Map();
  for (const t of lista) {
    const cel = celularDeTarjeta(t);
    if (!cel) continue;
    if (!porCelular.has(cel)) porCelular.set(cel, []);
    porCelular.get(cel).push(t);
  }

  const etiquetasPorCelular = new Map();
  for (const [cel, suyas] of porCelular) {
    const contacto = contactos.get(cel) || null;
    const clientesOperam = clientesOperamLigados(contacto, suyas)
      .map(id => { const estado = estadoDe(id); return estado ? { id, ...estado } : null; })
      .filter(Boolean);
    etiquetasPorCelular.set(cel, etiquetasDeContacto({
      contacto,
      oportunidades: suyas,
      clientesOperam,
      enLinea: enLinea.has(cel),
    }));
  }

  return lista.map(t => {
    const cel = celularDeTarjeta(t);
    const estado = estadoDe(t.clienteOperamId);
    return {
      ...t,
      clienteOperam: estado ? { id: t.clienteOperamId, ...estado } : null,
      etiquetas: (cel && etiquetasPorCelular.get(cel)) || [],
    };
  });
}
