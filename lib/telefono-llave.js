// El recorte de extension ("ext.123", ",116"), aislado de ultimos10 para que
// aFormatoWhatsApp (lib/contactos-logica.js, #247) lo aplique tambien ANTES de
// quitar los no-digitos: sin esto "55 5395 2615 ext 116" escribia
// +525553952615116 en Google -- la llave del mapeo quedaba bien (ultimos10 ya
// recortaba) pero el numero mandado a WhatsApp era basura.
export function sinExtension(celular) {
  return String(celular || '').split(/ext/i)[0].split(',')[0];
}

// Unica normalizacion de telefono a llave de IDENTIDAD de prospecto ("1 celular
// = 1 prospecto", CONTEXT.md): recorta extension antes de tomar los ultimos 10
// digitos. La usan el store de prospectos, el indice de telefonos de Operam
// (#42) y el cruce por identidad (#123) -- deben coincidir o la liga falla, por
// eso vive en un modulo PURO sin IO en vez de en el store (importar el store
// aqui traeria lib/db.js y fs a modulos que no pueden tenerlos). Tambien la usa
// la deduplicacion de clientes, que antes la copiaba por esa misma razon.
export function ultimos10(celular) {
  return sinExtension(celular).replace(/\D/g, '').slice(-10);
}
