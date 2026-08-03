// Unica normalizacion de telefono a llave de IDENTIDAD de prospecto ("1 celular
// = 1 prospecto", CONTEXT.md): recorta extension ("ext.123", ",116") antes de
// tomar los ultimos 10 digitos. La usan el store de prospectos, el indice de
// telefonos de Operam (#42) y el cruce por identidad (#123) -- deben coincidir o
// la liga falla, por eso vive en un modulo PURO sin IO en vez de en el store
// (importar el store aqui traeria lib/db.js y fs a modulos que no pueden tenerlos).
export function ultimos10(celular) {
  const sinExt = String(celular || '').split(/ext/i)[0].split(',')[0];
  return sinExt.replace(/\D/g, '').slice(-10);
}
