// Nucleo PURO de la tarifa Tresguerras (#437): armado de los formularios del
// cotizador PUBLICO de su sitio (https://www.tresguerras.com.mx/3G/cotizadorcp.php,
// el mismo que los vendedores usaban a mano), parseo de sus respuestas y
// traduccion a la MISMA forma de tarjeta que envia.com y Lalamove. El IO vive en
// tresguerras.js.
//
// Via no oficial, sin sesion ni credenciales, medida en vivo 2026-09-23: dos POST
// form-urlencoded (Poblaciones y CotizarNew). Si Tresguerras mueve su pagina,
// ningun mock lo detecta: `node scripts/verificar-tresguerras.mjs` lo verifica EN
// VIVO.

export const HOST_TRESGUERRAS = 'www.tresguerras.com.mx';
export const URL_POBLACIONES = `https://${HOST_TRESGUERRAS}/3G/assets/Ajax/cotizadorcp_Ajax.php`;
export const URL_COTIZAR = `https://${HOST_TRESGUERRAS}/3G/assets/Ajax/cotizador_Ajax.php`;
export const URL_COTIZADOR_WEB = `https://${HOST_TRESGUERRAS}/3G/cotizadorcp.php`;

// Tresguerras RECOLECTA en la fabrica (decision de Adrian 2026-09-23): origen
// fijo en Ixtapaluca, colonia Alfredo del Mazo.
export const CP_ORIGEN = '56577';
export const COLONIA_FABRICA = '0000050499';

export const AVISO_CAMBIO = `Tresguerras cambio su cotizador; cotiza a mano en ${URL_COTIZADOR_WEB}`;

export function cuerpoPoblaciones(cpDestino) {
  return new URLSearchParams({ action: 'Poblaciones', origenCP: CP_ORIGEN, destinoCP: cpDestino }).toString();
}

// Poblaciones devuelve los <select> ya armados en HTML: `<option value="id">texto</option>`.
export function opcionesDeSelect(html) {
  const out = [];
  const re = /<option\s+value="([^"]*)"\s*>([\s\S]*?)<\/option>/gi;
  let m;
  while ((m = re.exec(String(html || ''))) !== null) out.push({ value: m[1], texto: m[2].trim() });
  return out;
}

// La colonia de destino NO mueve el precio (medido: 3 colonias de 64000, mismo
// total), asi que va la primera del CP.
export function origenYDestino(respuesta, cpDestino) {
  const pobOrigen = opcionesDeSelect(respuesta?.Origen?.HTML);
  const colOrigen = opcionesDeSelect(respuesta?.Origen?.Colonia);
  if (!respuesta?.Destino || !pobOrigen.length || !colOrigen.length) return { aviso: AVISO_CAMBIO };
  const pobDestino = opcionesDeSelect(respuesta.Destino.HTML);
  const colDestino = opcionesDeSelect(respuesta.Destino.Colonia);
  if (!pobDestino.length || !colDestino.length) {
    return { aviso: `Tresguerras no da servicio al CP ${cpDestino} (no lo encuentra en su cobertura)` };
  }
  const fabrica = colOrigen.find(c => c.value === COLONIA_FABRICA) || colOrigen[0];
  return {
    origen: { poblacion: pobOrigen[0].value, colonia: fabrica.value },
    destino: { poblacion: pobDestino[0].value, colonia: colDestino[0].value },
  };
}

// Centimetros de calcularPaquetes -> METROS, que es lo que lee el formulario
// (medido: con 50 en vez de 0.5 lo tomo como 50 m y respondio "Peso no
// autorizado"). Se redondea al centimetro, como las medidas de Lalamove (#72).
const aMetros = (cm) => String(Math.round(Number(cm)) / 100);
const aKg = (kg) => String(Math.round(Number(kg) * 100) / 100);

// El querystring que la pagina arma con el formulario (jQuery serialize): un
// renglon `i` por tipo de caja, con el PESO DE CADA BULTO. El valor declarado es
// el total de la cotizacion (decision de Adrian): el seguro sale dentro de la
// tarifa; sin valor, el campo va vacio y no hay seguro.
export function datosFormCotizacion({ origen, destino, cpDestino, cajas = [], valorDeclarado = 0 }) {
  const p = new URLSearchParams({
    cpOrigen: CP_ORIGEN, ColOriCp: origen.colonia, origen2: origen.poblacion,
    cpDestino, ColDesCp: destino.colonia, destino2: destino.poblacion,
  });
  cajas.forEach((c, i) => {
    const [largo, ancho, alto] = c.medidasCm;
    p.append(`opcionMedidas[${i}]`, 'conMedidas');
    p.append(`bulto[${i}]`, String(c.cantidad));
    p.append(`peso[${i}]`, aKg(c.pesoKg));
    p.append(`largo[${i}]`, aMetros(largo));
    p.append(`ancho[${i}]`, aMetros(ancho));
    p.append(`alto[${i}]`, aMetros(alto));
  });
  p.append('valorCM', '100');
  p.append('valorDec', valorDeclarado > 0 ? String(Math.round(valorDeclarado)) : '');
  p.append('codPromocion', '');
  return p.toString();
}

export function cuerpoCotizar(datosForm) {
  return new URLSearchParams({ action: 'CotizarNew', esKiosko: 'true', datosForm }).toString();
}

// Los montos llegan como texto con comas de miles ("3,930.95").
export function montoTresguerras(texto) {
  const limpio = String(texto ?? '').replace(/,/g, '').trim();
  if (!/^\d+(\.\d+)?$/.test(limpio)) return null;
  return Number(limpio);
}

// El desglose viaja como HTML (una tabla "Rubro : | $ monto"); de ahi salen los
// dias de transito y los cuatro rubros que el vendedor ve en la tarjeta. La
// etiqueta de recoleccion lleva acento en la respuesta, por eso el comodin.
const RUBROS = { flete: 'Flete', recoleccion: 'Recolecci.n', entrega: 'Entrega a Domicilio', seguro: 'Seguro' };

function montoDeRubro(html, etiqueta) {
  const m = new RegExp(String.raw`>\s*${etiqueta}\s*:\s*</td>\s*<td[^>]*>\s*<b>\s*\$\s*([\d,]+(?:\.\d+)?)`, 'i').exec(html);
  return m ? montoTresguerras(m[1]) : null;
}

function desgloseDe(html) {
  const texto = String(html || '');
  const dias = /TRANSITO\s*:[\s\S]*?<b>\s*(\d+)\s*d/i.exec(texto);
  const desglose = {};
  for (const [llave, etiqueta] of Object.entries(RUBROS)) desglose[llave] = montoDeRubro(texto, etiqueta);
  return {
    days: dias ? Number(dias[1]) : null,
    desglose: Object.values(desglose).every(v => v !== null) ? desglose : null,
  };
}

// Solo la tarjeta PUERTA A PUERTA (recoleccion en la fabrica + entrega a
// domicilio). Su senal de servicio es el precio: `Terrestre.error` puede decir
// "Sin servicio" junto a una tarifa valida (medido: habla de otro servicio), asi
// que solo se lee para explicar un precio en 0.00. El total ya trae IVA; la
// partida del quote le suma el suyo, igual que Lalamove (#72, decision de Adrian).
export function tarjetaDesdeCotizacion(respuesta, cpDestino) {
  const t = respuesta?.Terrestre;
  const total = montoTresguerras(t?.precioTotal?.purtaPuerta);
  if (total === null) return { aviso: AVISO_CAMBIO };
  if (total === 0) {
    const motivo = String(t.error || '').trim();
    if (/peso|dimensi/i.test(motivo)) {
      return { aviso: `Tresguerras rechazo la carga (${motivo}): revisa el peso y las medidas de las cajas, o cotiza a mano en ${URL_COTIZADOR_WEB}` };
    }
    return { aviso: `Tresguerras no da servicio puerta a puerta al CP ${cpDestino}${motivo ? ` (${motivo})` : ''}` };
  }
  return {
    rate: {
      carrier: 'tresguerras',
      service: 'Puerta a puerta',
      serviceDescription: 'Tresguerras puerta a puerta',
      totalPrice: total,
      currency: 'MXN',
      ...desgloseDe(t.purtaPuerta),
    },
  };
}
