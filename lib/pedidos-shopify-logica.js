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
// Devuelve null cuando no hay nada que resolver (campo vacio): eso no es un
// descarte, es un candidato que no existe.
function resolverTelefono(texto) {
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
  return { motivo: t.startsWith('+') ? MOTIVOS.noReconocido : MOTIVOS.sinCodigo };
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
//
// Aqui entra el escalon 2 (#256): el pais de la direccion ya viaja en el nodo
// (`countryCodeV2` de envio y de facturacion) y lo que falta es pasarselo a
// resolverTelefono junto con el veto por contradiccion entre las dos.
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

  const filas = [];
  const resueltos = new Set();
  const perdidos = [];
  for (const candidato of candidatosDe(nodo)) {
    const resultado = resolverTelefono(candidato.texto);
    if (!resultado) continue;
    if (resultado.telefono) {
      const celular10 = ultimos10(resultado.telefono);
      if (resueltos.has(celular10)) continue;
      resueltos.add(celular10);
      filas.push({
        pedido, creadoEn, telefono: resultado.telefono, celular10,
        nombre: candidato.nombre, correo, fuente: candidato.fuente,
      });
      continue;
    }
    perdidos.push({ fuente: candidato.fuente, motivo: resultado.motivo, llave: ultimos10(candidato.texto) || limpio(candidato.texto) });
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
