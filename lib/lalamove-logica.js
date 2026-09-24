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

// Pin de "Peltre Nacional" en Google Maps (plus code 73XV+67 Ixtapaluca),
// confirmado por Adrian 2026-09-23.
export const ORIGEN_FABRICA = {
  lat: 19.298081,
  lng: -98.9068244,
  direccion: 'Roberto Fierro MZ42 LT13, Alfredo del Mazo, 56577 Ixtapaluca, Mex.',
};

// Las claves de la API no son las de la pagina de tarifas de Lalamove MX: se
// emparejaron por carga y medidas (CAR = la "SUV" de 300 kg, MPV = el "Auto" de
// 200 kg, TRUCK330 = el "Camion"). TRUCK3_5T y TRUCK5T solo aparecen en
// produccion (el sandbox no los lista).
const NOMBRE_VEHICULO = {
  MOTORCYCLE: 'Motocicleta',
  HATCHBACK: 'Hatchback',
  MPV: 'Auto',
  CAR: 'SUV',
  UV_FIORINO: 'Camioneta',
  PICKUP_MX: 'Pick up',
  VAN: 'Van',
  TRUCK330: 'Camion',
  TRUCK3_5T: 'Camion 3.5 t',
  TRUCK5T: 'Camion 5 t',
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

// Las cajas solo pueden ocupar este tanto del espacio de carga: estiba imperfecta,
// cabina irregular, cajas que no se apilan. Decision de Adrian (2026-09-23):
// mejor sobrecotizar que ofrecer un vehiculo donde la carga no cabe.
export const FACTOR_LLENADO = 0.6;

const aCm = (d) => Number(d?.value) * (d?.unit === 'cm' ? 1 : 100);
const mayorAMenor = (medidas) => [...medidas].sort((a, b) => b - a);

export function serviciosDeMexico(respuestaCities) {
  const ciudad = (respuestaCities?.data || []).find(c => c.locode === 'MX MEX') || respuestaCities?.data?.[0];
  return (ciudad?.services || [])
    .map(s => {
      const d = s.dimensions;
      const medidas = d ? [aCm(d.length), aCm(d.width), aCm(d.height)] : [];
      return {
        key: s.key,
        cargaKg: Number(s.load?.value),
        medidasCm: medidas.length === 3 && medidas.every(m => m > 0) ? mayorAMenor(medidas) : null,
      };
    })
    .filter(s => s.key && Number.isFinite(s.cargaKg))
    .sort((a, b) => a.cargaKg - b.cargaKg);
}

// Filtro burdo a proposito: descarta lo que DEFINITIVAMENTE no cabe. Peso contra
// la carga nominal (el peso de calcularPaquetes ya trae +15%), volumen de las
// CAJAS (no de las piezas) contra FACTOR_LLENADO del espacio de carga, y la caja
// mas grande lado contra lado. Un vehiculo sin medidas publicadas se juzga solo
// por peso: no hay con que decir que no cabe.
export function vehiculosQueCaben(servicios, { pesoKg = 0, cajas = [] } = {}) {
  const volumenCajas = cajas.reduce((s, c) => s + c.cantidad * c.medidasCm.reduce((v, m) => v * m, 1), 0);
  const cajaMayor = cajas.map(c => mayorAMenor(c.medidasCm));
  return servicios.filter(s => {
    if (pesoKg > 0 && s.cargaKg < pesoKg) return false;
    if (!s.medidasCm) return true;
    const volumenVehiculo = s.medidasCm.reduce((v, m) => v * m, 1);
    if (volumenCajas > volumenVehiculo * FACTOR_LLENADO) return false;
    return cajaMayor.every(c => c.every((m, i) => m <= s.medidasCm[i]));
  });
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
    cargaKg: vehiculo.cargaKg,
    medidasCm: vehiculo.medidasCm ?? null,
    distanciaKm: Number.isFinite(metros) ? Math.round(metros / 100) / 10 : null,
  };
}

export function esFueraDeArea(cuerpoError) {
  return (cuerpoError?.errors || []).some(e => e.id === 'ERR_OUT_OF_SERVICE_AREA');
}
