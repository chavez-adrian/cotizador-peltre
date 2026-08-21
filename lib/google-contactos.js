// Cliente REST de la People API de Google (spec #224, ticket #227). Calcado de
// lib/dropbox.js: cache de access token en memoria con expiracion, refresh por
// POST al token endpoint y fetch nativo contra people.googleapis.com. CERO
// dependencias nuevas -- se descarto `googleapis` (233 MB instalados medidos) y
// `@googleapis/people` (19 MB por tipos que este repo, sin TypeScript, no usa).
//
// Env vars (Render): GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET + GOOGLE_REFRESH_TOKEN,
// las MISMAS que ya usan scripts/verificar-google.mjs y scripts/autorizar-google.mjs.
//
// Este modulo NO decide nada: traduce una ficha del nucleo puro al recurso
// Person y ejecuta. Lo que se escribe y a quien lo decide lib/contactos-logica.js.
//
// Nunca hay un DELETE aqui, ni lo habra (ADR-0013): el permiso concedido incluye
// el borrado; ejercerlo no. La ventana de deshacer de Google revierte la libreta
// ENTERA a un instante, no un contacto suelto.

const BASE = 'https://people.googleapis.com/v1';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

let _accessToken = null;
let _tokenExpiry = 0;

// Solo para tests: limpia el cache del token entre casos.
export function resetToken() {
  _accessToken = null;
  _tokenExpiry = 0;
}

export function credencialesConfiguradas() {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_REFRESH_TOKEN
  );
}

async function getToken(forzar = false) {
  if (!forzar && _accessToken && Date.now() < _tokenExpiry) return _accessToken;
  if (!credencialesConfiguradas()) {
    throw new Error('Faltan vars GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN');
  }
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID.trim(),
      client_secret: process.env.GOOGLE_CLIENT_SECRET.trim(),
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN.trim(),
      grant_type: 'refresh_token',
    }),
  });
  if (!r.ok) throw new Error(`Google token refresh ${r.status}: ${await r.text()}`);
  const data = await r.json();
  _accessToken = data.access_token;
  _tokenExpiry = Date.now() + ((data.expires_in || 3600) - 60) * 1000;
  // El refresh token no se promete inmutable y el proceso en Render no puede
  // reescribir su propia variable de entorno: si Google devuelve uno nuevo,
  // queda dicho en el log para que Adrian lo pegue a mano (misma limitacion que
  // lib/dropbox.js, que no ha dado problemas en produccion).
  if (data.refresh_token && data.refresh_token !== process.env.GOOGLE_REFRESH_TOKEN.trim()) {
    console.warn('[google-contactos] Google devolvio un GOOGLE_REFRESH_TOKEN nuevo: hay que actualizarlo en Render');
  }
  return _accessToken;
}

// Un 401 significa access token vencido, no credenciales malas: se fuerza UN
// refresh y se reintenta UNA vez. Un segundo 401 si es un fallo real y se
// propaga -- reintentar en bucle contra un permiso revocado no lo arregla.
async function pedir(path, opciones = {}) {
  const llamar = async (token) => fetch(`${BASE}${path}`, {
    ...opciones,
    headers: {
      ...(opciones.headers || {}),
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  let r = await llamar(await getToken());
  if (r.status === 401) r = await llamar(await getToken(true));

  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(`Google People ${r.status}: ${JSON.stringify(data).slice(0, 300)}`);
    err.status = r.status;
    // El etag obsoleto llega como 400 con reason failedPrecondition, NO como
    // 409: un manejador que solo mire el codigo HTTP no distingue "alguien
    // edito esto desde el telefono" de "payload malformado". Se expone el
    // motivo para que el caller decida releer en vez de tratarlo como error.
    err.motivo = data?.error?.details?.find(d => d.reason)?.reason || data?.error?.status || '';
    throw err;
  }
  return data;
}

// Traduccion ficha (dominio) -> recurso Person (Google). Es la UNICA tabla que
// convierte los campos del nucleo puro en nombres de la People API, y por eso el
// nucleo puede no conocer Google.
const CAMPO_A_GOOGLE = {
  nombreVisible: 'names',
  telefono: 'phoneNumbers',
  correo: 'emailAddresses',
  organizacion: 'organizations',
  origen: 'userDefined',
};

// `givenName` y no `unstructuredName` a proposito: Google PARSEA el nombre no
// estructurado en nombre y apellidos y reconstruye el visible, lo que puede
// reordenar "Persona - Empresa" y romper la unica garantia que importa (que la
// persona vaya primero y sobreviva al truncado de WhatsApp). Con givenName el
// nombre visible es exactamente la cadena que se escribio. Es tambien el campo
// con el que se midio #226. `names` es SINGLETON: mandar dos produce error.
function persona(ficha, campos) {
  const valores = {
    names: ficha.nombreVisible ? [{ givenName: ficha.nombreVisible }] : [],
    phoneNumbers: ficha.telefono ? [{ value: ficha.telefono }] : [],
    emailAddresses: ficha.correo ? [{ value: ficha.correo }] : [],
    organizations: ficha.organizacion ? [{ name: ficha.organizacion }] : [],
    userDefined: ficha.origen ? [{ key: 'origen', value: ficha.origen }] : [],
  };
  const cuerpo = {};
  for (const campo of campos) {
    const llave = CAMPO_A_GOOGLE[campo];
    cuerpo[llave] = valores[llave];
  }
  return cuerpo;
}

function mascaraGoogle(campos) {
  return campos.map(c => CAMPO_A_GOOGLE[c]).join(',');
}

// Toda ficha nueva entra en `myContacts`: es el grupo que Android sincroniza, y
// la API ademas exige que un contacto pertenezca al menos a un grupo. Quitarlo
// para dejarlo solo en un grupo propio es la "optimizacion" que rompe la
// sincronizacion con el telefono.
export async function crearContacto(ficha, campos) {
  const cuerpo = {
    ...persona(ficha, campos),
    memberships: [{ contactGroupMembership: { contactGroupId: 'myContacts' } }],
  };
  const data = await pedir('/people:createContact?personFields=metadata,names,phoneNumbers', {
    method: 'POST',
    body: JSON.stringify(cuerpo),
  });
  return { resourceName: data.resourceName, etag: data.etag };
}

// La actualizacion REEMPLAZA los campos de la mascara en vez de fusionarlos:
// por eso la mascara viaja explicita desde el plan y no se arma aqui.
export async function actualizarContacto({ resourceName, etag, ficha, mascara }) {
  const cuerpo = { ...persona(ficha, mascara), etag };
  const data = await pedir(
    `/${resourceName}:updateContact?updatePersonFields=${encodeURIComponent(mascaraGoogle(mascara))}&personFields=metadata,names,phoneNumbers`,
    { method: 'PATCH', body: JSON.stringify(cuerpo) }
  );
  return { resourceName: data.resourceName || resourceName, etag: data.etag };
}

// Relectura para resolver un etag obsoleto: el etag correcto para el siguiente
// update viene en la respuesta del anterior, y solo hace falta volver a leer
// cuando alguien edito el contacto fuera del cotizador.
export async function leerContacto(resourceName) {
  const data = await pedir(`/${resourceName}?personFields=metadata,names,phoneNumbers`);
  return { resourceName: data.resourceName || resourceName, etag: data.etag };
}
