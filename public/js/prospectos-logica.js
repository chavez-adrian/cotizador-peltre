// Logica pura del modulo de prospectos (issue #41, ADR-0004): catalogos cerrados,
// validacion de captura y payload de POST /api/prospectos. Modulo sin efectos de
// navegador -- lo consumen app.js (ESM en el browser), server.js (validacion del
// lado del servidor) y los tests .cjs via import() dinamico. Mismo patron que
// alta-logica.js: una sola implementacion, cero copias espejo.

import { validarTelefono, combinarTelefonoConCodigo } from './alta-logica.js';

// Canal de origen del prospecto -- catalogo cerrado (CONTEXT.md, Captura de prospecto).
export const CANALES = [
  'WhatsApp',
  'Instagram',
  'Facebook/Messenger',
  'Meta Ads',
  'Formulario web',
  'Correo',
  'Referido',
  'Bazar Sábado',
  'Feria/Expo',
];

// Piezas estimadas -- mismos cortes que las listas de mayoreo.
export const PIEZAS_ESTIMADAS = ['+100', '+350', '+550', '+1,500', '+6,000'];

const OPCIONALES = ['empresa', 'segmento_id', 'piezas_estimadas', 'correo', 'temperatura', 'notas'];

// Valida el body de POST /api/prospectos (celular ya combinado con codigo de pais).
// La reusa el servidor y el frontend tras armar el payload. La validacion del
// celular es la misma del alta de cliente (alta-logica.validarTelefono).
export function validarProspectoBody(body) {
  const b = body || {};
  const errTel = validarTelefono('', b.celular);
  if (errTel) return `Celular: ${errTel}`;
  if (!(b.nombre || '').trim()) return 'El nombre es obligatorio';
  if (!(b.ciudad || '').trim()) return 'La ciudad es obligatoria';
  if (!CANALES.includes(b.canal)) return 'El canal de origen es obligatorio (catálogo cerrado)';
  return null;
}

// Arma el body de POST /api/prospectos desde los campos del formulario de captura.
// Los opcionales vacios no viajan.
export function buildProspectoPayload(campos) {
  const c = campos || {};
  const payload = {
    celular: combinarTelefonoConCodigo(c.celularCode, c.celular),
    nombre: (c.nombre || '').trim(),
    ciudad: (c.ciudad || '').trim(),
    canal: c.canal || '',
  };
  for (const k of OPCIONALES) {
    const v = typeof c[k] === 'string' ? c[k].trim() : c[k];
    if (v !== undefined && v !== null && v !== '') payload[k] = v;
  }
  return payload;
}
