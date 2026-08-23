// Nucleo PURO de la carga historica de pedidos de la tienda en linea (spec
// #254, ticket #258; ADR-0014). La API de Shopify solo entrega 60 dias a esta
// app: este modulo traduce las DOS fuentes de la historia -- la exportacion de
// CLIENTES de Shopify (telefono, pais, correo) cruzada con los pedidos `S` de
// Operam (cliente de canal 184), o directamente la exportacion de PEDIDOS del
// admin cuando existe -- a la MISMA forma de nodo que consume `ingerirPedido`
// (lib/pedidos-shopify-logica.js). NO hay una segunda regla de telefono: todo
// pasa por ese nucleo.
//
// SIN red, SIN IO: el script (scripts/cargar-pedidos-shopify-historico.mjs) lee
// los archivos y Operam (read-only) y pasa el resultado aqui.

import { ultimos10 } from './telefono-llave.js';
import { ingerirPedido } from './pedidos-shopify-logica.js';

function limpio(v) {
  return String(v == null ? '' : v).trim();
}

// El export de clientes de Shopify escribe un apostrofo inicial delante de los
// telefonos con `+` (truco de Excel para que la celda no se lea como formula/
// numero): es texto del archivo, no un artefacto de la libreria de CSV, y hay
// que quitarlo antes de usar el numero para cualquier cosa.
function limpiarTelefonoCsv(v) {
  return limpio(v).replace(/^'/, '');
}

function normalizarCorreo(v) {
  return limpio(v).toLowerCase();
}

// Parser de CSV MINIMO propio, sin dependencias nuevas: soporta comillas,
// comas y saltos de linea dentro de un campo, y el doble-comillado ("" -> ").
// Se probo primero con `xlsx` (ya dependencia directa) pero su lector de CSV
// ADIVINA tipos como si fuera una hoja de calculo: convirtio "Created at"
// ("2026-08-21 17:31:03 -0600") en un numero de serie de Excel y telefonos sin
// apostrofo en Number -- exactamente el dato que este modulo necesita intacto
// como texto. Un parser que respeta el texto tal cual es mas simple que pelear
// con las opciones de coercion de una libreria de hojas de calculo.
export function parsearCsv(texto) {
  const t = String(texto == null ? '' : texto);
  const filas = [];
  let fila = [];
  let campo = '';
  let enComillas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (enComillas) {
      if (c === '"') {
        if (t[i + 1] === '"') { campo += '"'; i++; } else { enComillas = false; }
      } else {
        campo += c;
      }
      continue;
    }
    if (c === '"') { enComillas = true; continue; }
    if (c === ',') { fila.push(campo); campo = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { fila.push(campo); filas.push(fila); fila = []; campo = ''; continue; }
    campo += c;
  }
  if (campo !== '' || fila.length > 0) { fila.push(campo); filas.push(fila); }
  if (filas.length === 0) return [];

  const encabezados = filas[0];
  return filas.slice(1)
    .filter(f => f.length > 1 || (f.length === 1 && f[0] !== ''))
    .map(f => {
      const obj = {};
      encabezados.forEach((h, i) => { obj[h] = f[i] != null ? f[i] : ''; });
      return obj;
    });
}

// Indices de la exportacion de CLIENTES de Shopify para el cruce (#258): por
// correo y por ultimos10 de CUALQUIERA de los dos telefonos que trae el export
// (`Default Address Phone` y `Phone`). Primer valor gana si dos filas compartan
// llave (no se espera en el padron real). El `idx` es la fila del CSV, para
// poder marcar despues cuales compradores con pedidos NO cruzaron con ningun
// pedido de Operam.
export function indexarClientes(filasClientes) {
  const porCorreo = new Map();
  const porTelefono = new Map();
  (filasClientes || []).forEach((fila, idx) => {
    const pais = limpio(fila['Default Address Country Code']) || null;
    const correo = normalizarCorreo(fila['Email']);
    if (correo && !porCorreo.has(correo)) porCorreo.set(correo, { pais, idx });
    for (const campo of ['Default Address Phone', 'Phone']) {
      const cel = ultimos10(limpiarTelefonoCsv(fila[campo]));
      if (cel && !porTelefono.has(cel)) porTelefono.set(cel, { pais, idx });
    }
  });
  return { porCorreo, porTelefono };
}

// Ultimo recurso del pais (#258): el texto libre de `delivery_address` de
// Operam termina en un token de 2 letras (MX/US/CA) seguido, a veces, del CP.
// Solo se reconocen los 3 paises que el padron real usa (ADR-0014); cualquier
// otra cosa al final del texto no es un pais reconocible y se deja nula.
export function paisDeDireccionLibre(direccion) {
  const t = limpio(direccion);
  const m = t.match(/\b(MX|US|CA)\b(?:\s+\d{3,6})?\s*$/i);
  return m ? m[1].toUpperCase() : null;
}

// Resuelve el pais de UN pedido de Operam contra los indices de clientes
// (#258): correo primero, ultimos10 del telefono despues, y si ninguno cruza
// (o cruzo pero el registro no trae pais) el ultimo recurso es el texto de la
// direccion de entrega. `clienteIdx` viaja SIEMPRE que hubo cruce por correo o
// telefono, aunque ese cruce no haya aportado pais -- es lo que usa
// planearCargaDesdeOperam para saber que ese comprador del CSV SI tiene pedido.
export function resolverPaisPedido(pedido, indices) {
  const correo = normalizarCorreo(pedido && pedido.contact_email);
  let cliente = correo ? indices.porCorreo.get(correo) : undefined;
  let metodoMatch = cliente ? 'correo' : null;
  if (!cliente) {
    const cel = ultimos10(pedido && pedido.contact_phone);
    cliente = cel ? indices.porTelefono.get(cel) : undefined;
    metodoMatch = cliente ? 'telefono' : null;
  }
  const clienteIdx = cliente ? cliente.idx : null;
  if (cliente && cliente.pais) return { pais: cliente.pais, metodo: metodoMatch, clienteIdx };
  const inferido = paisDeDireccionLibre(pedido && pedido.delivery_address);
  if (inferido) return { pais: inferido, metodo: 'direccion', clienteIdx };
  return { pais: null, metodo: null, clienteIdx };
}

// Un pedido de Operam (Sales Order del cliente de canal 184) -> la forma del
// nodo de Shopify que consume ingerirPedido. Solo aporta UN candidato de
// telefono (el de envio): Operam no distingue direccion de facturacion para
// estos pedidos, y `phone`/`customer` (checkout/perfil) no existen en esta
// fuente.
export function pedidoOperamANodo(pedido, pais) {
  const p = pedido || {};
  return {
    name: limpio(p.reference),
    createdAt: p.ord_date,
    email: limpio(p.contact_email),
    phone: null,
    customer: null,
    shippingAddress: {
      name: limpio(p.deliver_to),
      phone: p.contact_phone,
      countryCodeV2: pais,
    },
    billingAddress: null,
  };
}

// Clasificacion SOLO para el resumen del dry-run (#258): no decide nada, no
// gatea ninguna fila -- ingerirPedido ya decidio eso. Un telefono con `+` o con
// mas de 10 digitos ya trae su propio codigo de pais (va a resolver en el
// escalon 1 de ingerirPedido); el resto, si resuelve, lo hizo con el pais
// completado (escalon 2). Es una observacion de FORMATO del texto, no una
// segunda regla de validez.
function traeCodigoExplicito(texto) {
  const t = limpio(texto);
  if (t.includes('+')) return true;
  return t.replace(/\D/g, '').length > 10;
}

// Orquestacion PURA del modo clientes+Operam (#258): cruza cada pedido de
// Operam con la exportacion de clientes para resolver su pais, lo traduce al
// nodo y lo pasa por ingerirPedido. Devuelve las filas/descartes YA resueltos
// mas el resumen que el script imprime en el dry-run.
export function planearCargaDesdeOperam({ pedidosOperam, filasClientes } = {}) {
  const indices = indexarClientes(filasClientes);
  const cruce = { correo: 0, telefono: 0, direccion: 0, sinPais: 0 };
  const clientesConPedido = new Set();
  const filas = [];
  const descartes = [];
  const telefonos = new Set();
  let conCodigo = 0;
  let porPais = 0;

  for (const pedido of pedidosOperam || []) {
    const resuelto = resolverPaisPedido(pedido, indices);
    if (resuelto.clienteIdx != null) clientesConPedido.add(resuelto.clienteIdx);
    if (resuelto.metodo === 'correo') cruce.correo++;
    else if (resuelto.metodo === 'telefono') cruce.telefono++;
    else if (resuelto.metodo === 'direccion') cruce.direccion++;
    else cruce.sinPais++;

    const nodo = pedidoOperamANodo(pedido, resuelto.pais);
    const ingerido = ingerirPedido(nodo);
    for (const fila of ingerido.filas) {
      filas.push(fila);
      telefonos.add(fila.celular10);
      if (traeCodigoExplicito(pedido && pedido.contact_phone)) conCodigo++;
      else porPais++;
    }
    descartes.push(...ingerido.descartes);
  }

  const compradoresSinPedido = (filasClientes || [])
    .map((fila, idx) => ({ idx, totalOrders: Number(fila['Total Orders']) || 0 }))
    .filter(f => f.totalOrders > 0 && !clientesConPedido.has(f.idx)).length;

  return {
    leidos: (pedidosOperam || []).length,
    filas,
    descartes,
    cruce,
    conCodigo,
    porPais,
    telefonosDistintos: telefonos.size,
    compradoresSinPedido,
  };
}

// Pais que el export de PEDIDOS del admin de Shopify trae en las columnas
// Shipping/Billing Country: en el export real (medido 2026-08-22) YA es el
// codigo ISO de 2 letras (MX/US/CA/AR/...), asi que viaja TAL CUAL a
// countryCodeV2 -- es ingerirPedido quien decide si ese pais valida el
// telefono, no este modulo (ninguna lista cerrada de paises aqui). Si algun
// export trajera el nombre completo en vez del codigo, se reconoce solo para
// los 3 paises del padron real (ADR-0014); cualquier otra cosa no se reconoce
// y el pedido se descarta como sin pais.
const NOMBRES_PAIS = { MEXICO: 'MX', 'UNITED STATES': 'US', CANADA: 'CA' };
function paisDeTexto(v) {
  const t = limpio(v).toUpperCase();
  if (!t) return null;
  if (/^[A-Z]{2}$/.test(t)) return t;
  return NOMBRES_PAIS[t] || null;
}

// Una fila de la exportacion de PEDIDOS del admin -> la forma del nodo. A
// diferencia del modo Operam, esta fuente SI trae las dos direcciones y sus
// telefonos por separado: no hace falta cruzar con nada.
export function pedidoCsvANodo(filaPedido) {
  const f = filaPedido || {};
  return {
    name: limpio(f['Name']),
    createdAt: f['Created at'],
    email: limpio(f['Email']),
    phone: limpiarTelefonoCsv(f['Phone']) || null,
    customer: null,
    shippingAddress: {
      name: limpio(f['Shipping Name']),
      phone: limpiarTelefonoCsv(f['Shipping Phone']) || null,
      countryCodeV2: paisDeTexto(f['Shipping Country']),
    },
    billingAddress: {
      name: limpio(f['Billing Name']),
      phone: limpiarTelefonoCsv(f['Billing Phone']) || null,
      countryCodeV2: paisDeTexto(f['Billing Country']),
    },
  };
}

// El texto CRUDO del candidato que produjo una fila, segun su `fuente`
// (#258): para clasificar "con codigo explicito" vs "completado por pais" en
// el resumen del dry-run SIN inventar una segunda regla -- ingerirPedido ya
// decidio la fila, esto solo mira de vuelta el texto de origen.
function textoDeFuente(filaPedido, fuente) {
  if (fuente === 'checkout') return filaPedido['Phone'];
  if (fuente === 'envio') return filaPedido['Shipping Phone'];
  if (fuente === 'facturacion') return filaPedido['Billing Phone'];
  return '';
}

// Orquestacion PURA del modo pedidos-CSV (#258, CAMINO PRINCIPAL cuando el
// dueno entrega el export de PEDIDOS del admin: el cruce con Operam sobra). El
// export del admin repite una fila POR RENGLON DE PRODUCTO del mismo pedido --
// se queda con la PRIMERA fila de cada `Name` (todas repiten los mismos datos
// de cabecera) para no procesar el mismo pedido varias veces. Los pedidos
// cancelados (`Cancelled at` con fecha) ENTRAN igual (decision del dueno:
// todos los pedidos respaldan una ficha, ADR-0014 "para siempre").
export function planearCargaDesdePedidosCsv({ filasPedidos } = {}) {
  const vistos = new Set();
  const filas = [];
  const descartes = [];
  const telefonos = new Set();
  let leidos = 0;
  let conCodigo = 0;
  let porPais = 0;
  for (const filaPedido of filasPedidos || []) {
    const nombre = limpio(filaPedido['Name']);
    if (!nombre || vistos.has(nombre)) continue;
    vistos.add(nombre);
    leidos++;
    const ingerido = ingerirPedido(pedidoCsvANodo(filaPedido));
    for (const fila of ingerido.filas) {
      filas.push(fila);
      telefonos.add(fila.celular10);
      if (traeCodigoExplicito(textoDeFuente(filaPedido, fila.fuente))) conCodigo++;
      else porPais++;
    }
    descartes.push(...ingerido.descartes);
  }
  return { leidos, filas, descartes, conCodigo, porPais, telefonosDistintos: telefonos.size };
}
