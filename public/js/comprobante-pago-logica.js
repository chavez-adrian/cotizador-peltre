// Nucleo PURO del Comprobante de pago (#485, CONTEXT.md "Comprobante de pago";
// decision de Adrian 2026-09-28 a sugerencia de Alejandro): el archivo -- imagen
// o PDF -- que el Contacto manda como prueba de un pago, archivado en el Dropbox
// de la empresa por el flujo `pago` (lib/dropbox-destinos.js). Lo consumen
// server.js (la ruta que sube y guarda) y el tablero (badge, archivos y control),
// para que el que decide y el que pinta no diverjan.
//
// Vive en `data.comprobantesPago.<pago>` = { fecha, archivos: [{ nombre, ruta,
// fecha }] }: `nombre` es el del archivo que eligio el vendedor y `ruta` la que
// Dropbox CONFIRMO (path_display). Un archivo que Dropbox no confirmo no se
// guarda nunca. `PAGOS_COMPROBANTE` declara los pagos que admiten comprobante: el
// primero y, desde #486, el del saldo cuando la venta va a dos pagos.
//
// #486: la venta va a dos pagos si el sync vio alguna vez un pago parcial: la
// marca `data.huboAnticipo` (lib/sync-operam-io.js) que nunca se borra. Una venta
// que paso directo a Saldo pagado lleva un solo comprobante.

import { ETAPAS_POST_VENTA } from './perdida-logica.js';

export const PAGOS_COMPROBANTE = {
  primer: { texto: 'Primer pago' },
  saldo: { texto: 'Saldo' },
};

export const LIMITE_MB_COMPROBANTE = 10;
export const LIMITE_BYTES_COMPROBANTE = LIMITE_MB_COMPROBANTE * 1024 * 1024;
export const MAX_ARCHIVOS_COMPROBANTE = 10;

// Por extension y no por tipo MIME: las fotos HEIC del iPhone llegan con el tipo
// vacio en varios navegadores.
export const EXTENSIONES_COMPROBANTE = ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'];

const EXTENSIONES = new Set(EXTENSIONES_COMPROBANTE);

function extensionDe(nombre) {
  const m = String(nombre || '').match(/\.([a-zA-Z0-9]+)$/);
  return m ? m[1] : '';
}

export const MENSAJE_SIN_ARCHIVOS = 'Elige el archivo del comprobante de pago (imagen o PDF).';
export const MENSAJE_DEMASIADOS_ARCHIVOS = `Son demasiados archivos: sube hasta ${MAX_ARCHIVOS_COMPROBANTE} por vez.`;

export function mensajeArchivoGrande(nombre) {
  const quien = nombre ? `"${nombre}" pesa` : 'Un archivo pesa';
  return `${quien} m\u00e1s de ${LIMITE_MB_COMPROBANTE} MB: reduce la foto o env\u00eda el PDF original del banco.`;
}

// [{ nombre, tamano }] -> texto accionable o null. Lo usan el navegador antes de
// mandar y la ruta al recibir.
export function errorArchivosComprobante(archivos) {
  const lista = Array.isArray(archivos) ? archivos : [];
  if (!lista.length) return MENSAJE_SIN_ARCHIVOS;
  if (lista.length > MAX_ARCHIVOS_COMPROBANTE) return MENSAJE_DEMASIADOS_ARCHIVOS;
  const ajenos = lista.filter(a => !EXTENSIONES.has(extensionDe(a.nombre).toLowerCase()));
  if (ajenos.length) {
    const nombres = ajenos.map(a => `"${a.nombre}"`).join(', ');
    return `${nombres} no es imagen ni PDF: el comprobante se sube como foto (JPG, PNG, WEBP, HEIC) o PDF.`;
  }
  const grande = lista.find(a => Number(a.tamano) > LIMITE_BYTES_COMPROBANTE);
  if (grande) return mensajeArchivoGrande(grande.nombre);
  return null;
}

// Nombre en Dropbox: el numero de la cotizacion ES el folio de Operam (ADR-0009);
// sin folio, la pre-cotizacion lleva su id. Con varios archivos se numeran.
export function nombreArchivoComprobante({ folio, id, cliente, pago, indice, total, nombreOriginal }) {
  const numero = folio != null && folio !== '' ? `Cotizacion ${folio}` : `Cotizacion PRE ${id}`;
  const quien = String(cliente || '').replace(/[/\\:*?"<>|]/g, '').trim();
  const texto = PAGOS_COMPROBANTE[pago]?.texto || pago;
  const n = total > 1 ? ` - ${indice + 1}` : '';
  const ext = extensionDe(nombreOriginal);
  return `${[numero, quien, texto].filter(Boolean).join(' - ')}${n}${ext ? `.${ext}` : ''}`;
}

// El comprobante ya guardado mas los archivos que Dropbox acaba de confirmar. Los
// archivos se ACUMULAN (subir despues corrige un faltante, no borra lo anterior)
// y la fecha del comprobante es la de la ultima confirmacion.
export function comprobanteConArchivos(previo, confirmados, fecha) {
  const anteriores = Array.isArray(previo?.archivos) ? previo.archivos : [];
  const nuevos = confirmados.map(a => ({ nombre: a.nombre, ruta: a.ruta, fecha }));
  return { fecha, archivos: [...anteriores, ...nuevos] };
}

// Lo que la respuesta dice cuando Dropbox no confirmo todo. Sin ningun archivo
// confirmado el comprobante sigue faltando; con alguno, se nombra lo guardado y
// lo que hay que volver a subir.
export function mensajeSubidaIncompleta(confirmados, fallidos) {
  const nombres = (lista) => lista.map(a => `"${a.nombre}"`).join(', ');
  const falto = `Dropbox no confirm\u00f3 ${nombres(fallidos)}: vuelve a subirlo.`;
  if (!confirmados.length) return `${falto} El comprobante de pago sigue faltando.`;
  return `${falto} Se guard\u00f3 ${nombres(confirmados)}.`;
}

// Lo que la respuesta dice cuando Dropbox confirmo todo. Sin DROPBOX_NS_PAGO y
// DROPBOX_PATH_PAGO el flujo escribe en el sandbox de la app: decir solo
// "Dropbox confirmo" haria creer que el comprobante ya esta en la carpeta de la
// empresa.
export function mensajeSubidaCompleta(cantidad, { sandbox = false } = {}) {
  if (sandbox) return `El comprobante qued\u00f3 en el sandbox de la app (${cantidad} archivo(s)), no en la carpeta de la empresa: falta configurar el destino de Dropbox de comprobantes de pago.`;
  return `Dropbox confirm\u00f3 ${cantidad} archivo(s) del comprobante.`;
}

const ETAPAS_CON_COMPROBANTE = new Set(['seguimiento', ...ETAPAS_POST_VENTA]);

export const MENSAJE_COMPROBANTE_FUERA_DE_ETAPA = 'El comprobante de pago se sube desde Seguimiento o despu\u00e9s, y no en una oportunidad cerrada.';

export const MENSAJE_SALDO_SIN_ANTICIPO = 'Esta venta no registr\u00f3 anticipo en Operam: lleva un solo comprobante de pago, el del primer pago.';
export const MENSAJE_SALDO_FUERA_DE_ETAPA = 'El comprobante del saldo se sube desde Pedido liberado o despu\u00e9s.';

const ETAPAS_CON_SALDO = new Set(['pedido_liberado', 'saldo_pagado', 'producto_entregado']);
const ETAPAS_FALTA_SALDO = new Set(['saldo_pagado', 'producto_entregado']);

// La marca de anticipo en la entrada completa (data) o en la tarjeta aplanada.
export function huboAnticipoDe(o) {
  return (o?.data?.huboAnticipo ?? o?.huboAnticipo) === true;
}

// Por que no se puede subir el comprobante de ese pago (texto para el 409), o
// null si se puede. El primero se ofrece desde Seguimiento y el del saldo desde
// Pedido liberado, solo con anticipo; los dos se pueden subir despues, en
// cualquier etapa post-venta, para corregir un faltante.
export function motivoSinComprobante(o, pago = 'primer') {
  if (pago === 'saldo') {
    if (!huboAnticipoDe(o)) return MENSAJE_SALDO_SIN_ANTICIPO;
    return ETAPAS_CON_SALDO.has(o?.etapa) ? null : MENSAJE_SALDO_FUERA_DE_ETAPA;
  }
  return !!o && ETAPAS_CON_COMPROBANTE.has(o.etapa) ? null : MENSAJE_COMPROBANTE_FUERA_DE_ETAPA;
}

export function puedeSubirComprobante(o, pago = 'primer') {
  return !!o && motivoSinComprobante(o, pago) === null;
}

// El `accept` del selector de archivos: la misma lista que valida la ruta.
export const ACCEPT_COMPROBANTE = EXTENSIONES_COMPROBANTE.map(e => `.${e}`).join(',');

// El comprobante de un pago en la entrada completa (data) o en la tarjeta
// aplanada; null si no hay ningun archivo confirmado.
export function comprobanteDe(o, pago = 'primer') {
  const c = (o?.data?.comprobantesPago ?? o?.comprobantesPago)?.[pago];
  return c && Array.isArray(c.archivos) && c.archivos.length ? c : null;
}

// "Falta comprobante": la tarjeta ya paso de Seguimiento (Anticipo pagado o
// posterior) y no tiene comprobante del primer pago. Es el aviso inverso de
// "Pago sin registrar" (#77) y conviven. El del saldo (#486) falta en Saldo
// pagado o Producto entregado, y solo en una venta con anticipo.
export function faltaComprobante(o, pago = 'primer') {
  if (!o || comprobanteDe(o, pago)) return false;
  if (pago === 'saldo') return huboAnticipoDe(o) && ETAPAS_FALTA_SALDO.has(o.etapa);
  return ETAPAS_POST_VENTA.includes(o.etapa);
}
