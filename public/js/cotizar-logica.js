// Logica pura del flujo de cotizacion (sin efectos de navegador).
// Compartida con app.js (import nativo) y probada en cotizar-logica.test.cjs.

const LEYENDA_DOMICILIO = 'Favor de confirmar el domicilio de entrega';

function cpValido(cp, pais) {
  if (pais === 'CA') return /^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$/.test(cp);
  return /^\d{5}$/.test(cp);
}

// Domicilio de entrega para cotizar: CP y pais OBLIGATORIOS, Calle OPCIONAL.
// Si falta CP o pais (o el CP no cumple el formato del pais) -> { ok:false, error }.
// Si hay CP+pais validos pero Calle vacia -> { ok:true, leyenda }.
// Si todo presente -> { ok:true }.
export function validarDomicilioEntrega({ calle, cp, pais } = {}) {
  const cpTrim = (cp || '').trim();
  const paisTrim = (pais || '').trim();
  if (!paisTrim) return { ok: false, error: 'Selecciona el pais de entrega' };
  if (!cpTrim || !cpValido(cpTrim, paisTrim)) {
    return {
      ok: false,
      error: paisTrim === 'CA'
        ? 'Ingresa un codigo postal canadiense valido (ej. K1A 0A9)'
        : 'Ingresa un CP de entrega de 5 digitos valido',
    };
  }
  if (!(calle || '').trim()) return { ok: true, leyenda: LEYENDA_DOMICILIO };
  return { ok: true };
}

// Sentence case: solo la primera letra en mayuscula, resto en minuscula.
// Recorta espacios al inicio y fin. "fedex ground" -> "Fedex ground".
export function sentenceCase(str) {
  const s = (str || '').trim();
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
