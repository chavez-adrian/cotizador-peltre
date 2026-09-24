// Nucleo PURO de la tarifa Lalamove (#72): firma HMAC, eleccion de vehiculos por
// peso, cuerpo de POST /v3/quotations y traduccion de la respuesta a la MISMA
// forma de tarjeta que devuelve envia.com, para que el paso Envio las pinte y
// las elija igual que FedEx/DHL/UPS. El IO vive en lalamove.js.
//
// Medido en sandbox 2026-09-23 (docs/spikes/lalamove-api.md): MX tiene una sola
// ciudad (`MX MEX`), la fabrica de Ixtapaluca SI es origen valido, fuera del
// poligono responde 422 ERR_OUT_OF_SERVICE_AREA, y el `item` (peso categorico)
// no mueve el precio -- por eso no se manda.
import crypto from 'node:crypto';

// Centroide de la colonia Alfredo del Mazo (OpenStreetMap); el precio depende
// de la distancia, ~6 MXN/km, asi que un error de cientos de metros no pesa.
export const ORIGEN_FABRICA = {
  lat: 19.2925089,
  lng: -98.9079391,
  direccion: 'Roberto Fierro MZ42 LT13, Alfredo del Mazo, 56577 Ixtapaluca, Mex.',
};

// Las claves de la API no son las de la pagina de tarifas de Lalamove MX: se
// emparejaron por carga y medidas (CAR = la "SUV" de 300 kg, MPV = el "Auto" de
// 200 kg, TRUCK330 = el "Camion").
const NOMBRE_VEHICULO = {
  MOTORCYCLE: 'Motocicleta',
  HATCHBACK: 'Hatchback',
  MPV: 'Auto',
  CAR: 'SUV',
  UV_FIORINO: 'Camioneta',
  PICKUP_MX: 'Pick up',
  VAN: 'Van',
  TRUCK330: 'Camion',
};

export function firmaLalamove({ secret, ts, metodo, path, body = '' }) {
  return crypto.createHmac('sha256', secret)
    .update(`${ts}\r\n${metodo}\r\n${path}\r\n\r\n${body}`)
    .digest('hex');
}

export function encabezadosLalamove({ key, secret, ts, metodo, path, body = '', requestId }) {
  return {
    'Content-Type': 'application/json',
    Authorization: `hmac ${key}:${ts}:${firmaLalamove({ secret, ts, metodo, path, body })}`,
    Market: 'MX',
    'Request-ID': requestId,
  };
}

export function serviciosDeMexico(respuestaCities) {
  const ciudad = (respuestaCities?.data || []).find(c => c.locode === 'MX MEX') || respuestaCities?.data?.[0];
  return (ciudad?.services || [])
    .map(s => ({ key: s.key, cargaKg: Number(s.load?.value) }))
    .filter(s => s.key && Number.isFinite(s.cargaKg))
    .sort((a, b) => a.cargaKg - b.cargaKg);
}

export function vehiculosQueAlcanzan(servicios, pesoKg) {
  return servicios.filter(s => !(pesoKg > 0) || s.cargaKg >= pesoKg);
}

export function cuerpoCotizacion({ serviceType, destino }) {
  const parada = (lat, lng, address) => ({ coordinates: { lat: String(lat), lng: String(lng) }, address });
  return {
    data: {
      serviceType,
      language: 'es_MX',
      stops: [
        parada(ORIGEN_FABRICA.lat, ORIGEN_FABRICA.lng, ORIGEN_FABRICA.direccion),
        parada(destino.lat, destino.lng, destino.direccion),
      ],
    },
  };
}

export function tarifaDesdeCotizacion(vehiculo, respuesta) {
  const total = Number(respuesta?.data?.priceBreakdown?.total);
  if (!respuesta?.data?.priceBreakdown?.total || !Number.isFinite(total)) return null;
  const nombre = NOMBRE_VEHICULO[vehiculo.key] || vehiculo.key;
  const metros = Number(respuesta.data.distance?.value);
  return {
    carrier: 'lalamove',
    service: nombre,
    serviceDescription: `Lalamove ${nombre} (hasta ${vehiculo.cargaKg} kg)`,
    totalPrice: total,
    currency: respuesta.data.priceBreakdown.currency || 'MXN',
    distanciaKm: Number.isFinite(metros) ? Math.round(metros / 100) / 10 : null,
  };
}

export function esFueraDeArea(cuerpoError) {
  return (cuerpoError?.errors || []).some(e => e.id === 'ERR_OUT_OF_SERVICE_AREA');
}
