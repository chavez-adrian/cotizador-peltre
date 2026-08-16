// Revalidacion server-side del celular capturado en el formulario publico de
// mayoreo (issue #161, ADR-0012). validarTelefono (alta-logica.js) solo mira
// LARGO de digitos -- por diseno, para no rechazar un lead legitimo en el
// navegador (docs/research/formulario-mayoreo-captura.md 2.4). Un numero puede
// tener el largo correcto y aun asi ser IMPOSIBLE para su pais (ej. area code
// que no existe). El servidor si puede darse ese lujo: solo marca el registro
// para revision, no lo descarta de cara al usuario (nunca vuelve un error --
// ver server.js, la rama entra a la respuesta opaca).
//
// Variante /max (no la /min por defecto ni /mobile) por decision de la
// investigacion (2.6): en el servidor no hay presupuesto de bytes que cuidar,
// y la validacion estricta detiene basura de bots que ya paso Turnstile.
import { isValidPhoneNumber } from 'libphonenumber-js/max';

export function numeroTelefonoEsPosible(celular) {
  try {
    return isValidPhoneNumber(String(celular == null ? '' : celular));
  } catch {
    return false;
  }
}
