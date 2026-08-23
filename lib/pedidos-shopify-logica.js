// Nucleo PURO de la ingestion de pedidos de la tienda en linea (spec #254,
// ticket #255; ADR-0014; CONTEXT.md "Cliente en linea"). Recibe UN nodo de
// pedido tal como lo devuelve la GraphQL Admin API de Shopify y devuelve las
// FILAS que van a la tabla de pedidos mas los DESCARTES con su motivo.
// SIN red, SIN IO: no conoce Shopify ni Neon. La envoltura
// (lib/pedidos-shopify-io.js) lee y persiste; aqui se decide.
//
// La resolucion del telefono ocurre UNA vez, al ingerir, y no en cada pasada
// del barrido de contactos: asi el motivo de cada descarte se registra una sola
// vez y el plan de contactos recibe telefonos ya resueltos.

import { parsePhoneNumberFromString } from 'libphonenumber-js/max';
import { ultimos10 } from './telefono-llave.js';
import { aFormatoWhatsApp } from './contactos-logica.js';

// Motivos de descarte. Son texto para el panel (#257) y llave de agrupacion:
// cambiarlos cambia lo que ve el administrador, no el comportamiento.
export const MOTIVOS = {
  sinTelefono: 'pedido sin telefono',
  sinCodigo: 'sin codigo de pais',
  noReconocido: 'telefono con codigo de pais no reconocido',
  paisesContradictorios: 'paises contradictorios',
  invalidoParaPais: 'invalido en el pais de la direccion',
};

function limpio(v) {
  return String(v == null ? '' : v).trim();
}

function aIso(v) {
  const d = new Date(limpio(v));
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

// ESCALON 1 de la regla del telefono (ADR-0014, "El pais del telefono se
// infiere, con veto"): un codigo de pais explicito manda y la direccion no se
// consulta. Vale el `+` escrito y tambien el codigo NACIONAL pegado -- el
// comprador que teclea "16512712562" ya dijo de que pais es --, por eso el
// texto se parsea SIEMPRE con `+` delante y sin defaultCountry.
//
// El veto es `isValid()` y no `isPossible()`: sin el, prefijar `+` a un numero
// nacional mexicano de diez digitos lo convertiria en un numero de cualquier
// pais cuyo codigo empiece igual, y la ficha etiquetaria a otra persona. Medido
// sobre los pedidos reales: los diez digitos mexicanos del padron (55..., 44...,
// 61..., 33...) quedan INVALIDOS al leerse como extranjeros y caen al descarte,
// que es de donde los rescatara el escalon 2 con el pais de la direccion (#256).
//
// El pais de la direccion (ADR-0014, escalon 2), UNA vez por pedido: es el
// mismo para todos los candidatos, y calcularlo por candidato repetiria la
// logica de contradiccion sin necesidad. Envio y facturacion con paises
// distintos es indecidible (se descarta); con uno solo presente, ese manda;
// sin ninguno, no hay con que completar el escalon 2.
function paisDeDireccion(nodo) {
  const envioPais = limpio(nodo?.shippingAddress?.countryCodeV2) || null;
  const facturacionPais = limpio(nodo?.billingAddress?.countryCodeV2) || null;
  if (envioPais && facturacionPais && envioPais !== facturacionPais) {
    return { pais: null, motivo: MOTIVOS.paisesContradictorios };
  }
  const pais = envioPais || facturacionPais || null;
  return pais ? { pais, motivo: null } : { pais: null, motivo: MOTIVOS.sinCodigo };
}

// Devuelve null cuando no hay nada que resolver (campo vacio): eso no es un
// descarte, es un candidato que no existe. Cuando el texto no trae `+` ni
// codigo nacional pegado, `pendiente: true` deja la decision al escalon 2 --
// ESTE resultado por si solo no dice si el candidato se pierde, porque otro
// candidato del mismo pedido puede traer el mismo numero CON codigo (S1894).
function resolverEscalon1(texto) {
  const t = limpio(texto);
  if (!t) return null;
  const conMas = t.startsWith('+') ? t : `+${t}`;
  let numero = null;
  try {
    numero = parsePhoneNumberFromString(conMas);
  } catch {
    numero = null;
  }
  // aFormatoWhatsApp es EL punto unico del formato del telefono (#226): el
  // E.164 de libphonenumber pasa por ahi para que lo que se escribe en Google
  // salga de una sola funcion, no de dos que pueden divergir.
  if (numero && numero.isValid()) return { telefono: aFormatoWhatsApp(numero.number) };
  // El `+` explicito ya dijo de que pais es: si no valida, no se consulta la
  // direccion (ADR-0014, "el pais del telefono se infiere, con veto").
  if (t.startsWith('+')) return { motivo: MOTIVOS.noReconocido };
  return { pendiente: true };
}

// ESCALONES 2 y 3 (#256), solo para candidatos que el escalon 1 dejo
// `pendiente`. `direccion.pais` nulo es el escalon 3 ("todo lo demas"):
// paises contradictorios o ningun pais en la direccion, y el motivo ya viene
// armado por paisDeDireccion. Con pais disponible, el veto sigue siendo
// `isValid()` -- un numero que solo es NANP valido con una direccion mexicana
// se descarta igual que en el escalon 1, por la misma razon (#254: no admitir
// nunca el pais equivocado).
function resolverEscalon2(texto, direccion) {
  if (!direccion.pais) return { motivo: direccion.motivo };
  const t = limpio(texto);
  let numero = null;
  try {
    numero = parsePhoneNumberFromString(t, direccion.pais);
  } catch {
    numero = null;
  }
  if (numero && numero.isValid()) return { telefono: aFormatoWhatsApp(numero.number) };
  return { motivo: MOTIVOS.invalidoParaPais };
}

function llaveDe(texto) {
  return ultimos10(texto) || limpio(texto);
}

// Los candidatos de telefono de un pedido, EN ORDEN de precedencia:
// checkout -> envio -> perfil -> facturacion (#254). Cada uno viaja con el
// nombre que le corresponde, porque la ficha lleva el nombre de la direccion de
// la que salio el telefono: quien recibe el paquete puede no ser quien pago.
//
// La respuesta NO trae el nombre de la cuenta del cliente (no esta entre los
// campos que el spec pide, y `customer` solo aporta el telefono del perfil):
// para checkout y perfil el nombre del titular es el de la direccion de
// facturacion, que es quien pago. Ningun candidato se queda sin nombre mientras
// exista uno en el pedido; si no hay ninguno, el nombre va vacio y el nucleo de
// contactos nombra la ficha con el numero de pedido.
function candidatosDe(nodo) {
  const envio = nodo?.shippingAddress || {};
  const facturacion = nodo?.billingAddress || {};
  const nombreEnvio = limpio(envio.name);
  const nombreFacturacion = limpio(facturacion.name);
  const nombreTitular = nombreFacturacion || nombreEnvio;
  return [
    { fuente: 'checkout', texto: nodo?.phone, nombre: nombreTitular },
    { fuente: 'envio', texto: envio.phone, nombre: nombreEnvio || nombreFacturacion },
    { fuente: 'perfil', texto: nodo?.customer?.defaultPhoneNumber?.phoneNumber, nombre: nombreTitular },
    { fuente: 'facturacion', texto: facturacion.phone, nombre: nombreFacturacion || nombreEnvio },
  ];
}

// Un nodo de pedido -> { filas, descartes }. Cada telefono DISTINTO (por
// ultimos10, la unica llave de identidad del repo) produce UNA fila; el primer
// candidato del orden gana, y con el gana su nombre y su fuente.
export function ingerirPedido(nodo) {
  const pedido = limpio(nodo?.name);
  const creadoEn = aIso(nodo?.createdAt);
  const correo = limpio(nodo?.email);
  const direccion = paisDeDireccion(nodo);
  const candidatos = candidatosDe(nodo);

  // El escalon 1 se resuelve para TODOS los candidatos ANTES de decidir nada
  // (#256): un candidato pendiente de escalon 2 no debe generar fila ni
  // descarte propio si OTRO candidato del pedido -- venga antes o despues en
  // el orden de precedencia -- ya trajo el MISMO numero con codigo (medido en
  // S1894: envio sin codigo, facturacion con codigo; gana facturacion y envio
  // ni se reporta, sin importar que envio se recorra primero).
  const primerEscalon = candidatos.map(candidato => ({ candidato, resultado: resolverEscalon1(candidato.texto) }));
  const resueltosEscalon1 = new Set();
  for (const { candidato, resultado } of primerEscalon) {
    if (resultado?.telefono) resueltosEscalon1.add(llaveDe(candidato.texto));
  }

  const filas = [];
  const resueltos = new Set();
  const perdidos = [];
  function agregarFila(candidato, telefono) {
    const celular10 = ultimos10(telefono);
    if (resueltos.has(celular10)) return;
    resueltos.add(celular10);
    filas.push({
      pedido, creadoEn, telefono, celular10,
      nombre: candidato.nombre, correo, fuente: candidato.fuente,
    });
  }

  for (const { candidato, resultado } of primerEscalon) {
    if (!resultado) continue;
    if (resultado.telefono) {
      agregarFila(candidato, resultado.telefono);
      continue;
    }
    const llave = llaveDe(candidato.texto);
    if (resueltosEscalon1.has(llave)) continue;
    if (resultado.motivo) {
      perdidos.push({ fuente: candidato.fuente, motivo: resultado.motivo, llave });
      continue;
    }
    // pendiente (escalon 2): si otro candidato pendiente ya lo resolvio en
    // esta misma pasada (mismo numero en dos direcciones, ninguna con
    // codigo, como S1893), tampoco se reintenta ni se reporta dos veces.
    if (resueltos.has(llave)) continue;
    const segundo = resolverEscalon2(candidato.texto, direccion);
    if (segundo.telefono) {
      agregarFila(candidato, segundo.telefono);
    } else {
      perdidos.push({ fuente: candidato.fuente, motivo: segundo.motivo, llave });
    }
  }

  // Un pedido sin ningun candidato es la senal que el ADR-0014 pide vigilar
  // ("si un dia los pedidos empiezan a llegar sin telefono, la fuente no falla:
  // se vacia hacia adelante"). Va con motivo propio para que el panel lo
  // distinga de un telefono que si llego pero no se pudo usar.
  const descartes = [];
  if (filas.length === 0 && perdidos.length === 0) {
    return { filas, descartes: [{ pedido, fuente: null, motivo: MOTIVOS.sinTelefono }] };
  }

  const reportados = new Set();
  for (const perdido of perdidos) {
    // El mismo numero que otra direccion trajo CON codigo no se perdio: entro a
    // la libreta por esa otra via, y reportarlo diria lo contrario.
    if (resueltos.has(perdido.llave)) continue;
    if (reportados.has(perdido.llave)) continue;
    reportados.add(perdido.llave);
    descartes.push({ pedido, fuente: perdido.fuente, motivo: perdido.motivo });
  }
  return { filas, descartes };
}
