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
let _grupoInactivos = null;

// Solo para tests: limpia los caches de proceso (token y grupo) entre casos.
export function resetToken() {
  _accessToken = null;
  _tokenExpiry = 0;
  _grupoInactivos = null;
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

// La libreta que la cuenta tiene HOY (#229), leida ENTERA y paginada. Es lo
// unico que permite saber que celulares ya tienen contacto hecho a mano, y por
// tanto adoptarlos en vez de duplicarlos.
//
// NO se usa `people:searchContacts` para esto y nunca debe usarse: corre sobre
// un cache perezoso que exige una peticion de calentamiento, hace coincidencia
// por PREFIJO (buscar los ultimos diez digitos no encuentra un numero guardado
// como "+52 1 55...") y topa en 30 resultados. Un barrido que preguntara ahi
// concluiria "no existe" y crearia el duplicado.
//
// `personFields` pide lo minimo que el plan necesita: el telefono es la llave de
// coincidencia y `metadata` trae el etag con el que se actualiza sin una segunda
// lectura. Ni organizations ni userDefined entran: el plan no los mira, y la
// autoridad de que ficha es nuestra es el mapeo en Neon, no lo que diga Google.
const LIBRETA_PERSON_FIELDS = 'metadata,names,phoneNumbers';
// El tope de la People API. Con ~15 contactos hoy cabe todo en una pagina; el
// bucle existe porque el default es 100 y quedarse con la primera pagina
// empezaria a duplicar en silencio en cuanto la libreta crezca.
const LIBRETA_PAGE_SIZE = 1000;

export async function leerLibreta() {
  const contactos = [];
  let pageToken = '';
  do {
    const params = new URLSearchParams({
      personFields: LIBRETA_PERSON_FIELDS,
      pageSize: String(LIBRETA_PAGE_SIZE),
    });
    if (pageToken) params.set('pageToken', pageToken);
    const data = await pedir(`/people/me/connections?${params}`);
    for (const conexion of data.connections || []) {
      contactos.push({
        resourceName: conexion.resourceName,
        etag: conexion.etag,
        // Crudos, tal como los guardo la persona: quien compara es el nucleo
        // puro, por sus ultimos diez digitos.
        telefonos: (conexion.phoneNumbers || []).map(t => t.value).filter(Boolean),
      });
    }
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return contactos;
}

// EL grupo (etiqueta, en la UI de Google Contactos) donde vive lo que perdio
// respaldo (#231). Es un grupo PROPIO -- de usuario, no de sistema -- porque los
// unicos grupos de sistema a los que la API deja agregar miembros son
// `myContacts` y `starred`. El nombre es el que Adrian va a ver en el menu
// lateral del telefono, y no debe cambiar: renombrarlo aqui hace que la
// siguiente pasada cree un grupo nuevo y deje huerfano el anterior.
export const NOMBRE_GRUPO_INACTIVOS = 'Cotizador inactivos';

// Los grupos se listan paginados, igual que las conexiones.
async function buscarGrupo(nombre) {
  let pageToken = '';
  do {
    const params = new URLSearchParams({ pageSize: '1000' });
    if (pageToken) params.set('pageToken', pageToken);
    const data = await pedir(`/contactGroups?${params}`);
    const encontrado = (data.contactGroups || []).find(g => g.name === nombre);
    if (encontrado) return encontrado.resourceName;
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return null;
}

// Se lista primero y se crea solo si falta: crear uno con nombre repetido
// responde 409 ("Created contact group names must be unique to the users contact
// groups"), y ese 409 al arrancar no puede tumbar el barrido. El resourceName se
// cachea en memoria por lo que dure el proceso -- el grupo no se renombra solo.
async function grupoInactivos() {
  if (_grupoInactivos) return _grupoInactivos;
  const existente = await buscarGrupo(NOMBRE_GRUPO_INACTIVOS);
  if (existente) {
    _grupoInactivos = existente;
    return _grupoInactivos;
  }
  try {
    const data = await pedir('/contactGroups', {
      method: 'POST',
      body: JSON.stringify({ contactGroup: { name: NOMBRE_GRUPO_INACTIVOS } }),
    });
    _grupoInactivos = data.resourceName;
  } catch (err) {
    if (err.status !== 409) throw err;
    // Alguien lo creo entre la lista y la creacion (o existe con otro tipo):
    // releer es la respuesta correcta, no rendirse.
    _grupoInactivos = await buscarGrupo(NOMBRE_GRUPO_INACTIVOS);
    if (!_grupoInactivos) throw err;
  }
  return _grupoInactivos;
}

// Marcar y desmarcar son la MISMA operacion con el arreglo contrario: la
// membresia es lo unico que cambia, y el contacto conserva `myContacts`, su
// nombre y todos sus datos. No hay borrado por ningun camino (ADR-0013).
//
// La respuesta trae `notFoundResourceNames` cuando el contacto ya no existe en
// la libreta (alguien lo borro desde el telefono). No se trata como error a
// proposito: no hay accion posible desde aqui, y marcar la ficha como inactiva
// en el mapeo es justo lo que hay que hacer con un contacto que ya no esta.
async function modificarMembresia(cuerpo) {
  const grupo = await grupoInactivos();
  await pedir(`/${grupo}/members:modify`, { method: 'POST', body: JSON.stringify(cuerpo) });
}

export async function marcarContactoInactivo(resourceName) {
  await modificarMembresia({ resourceNamesToAdd: [resourceName] });
}

export async function reactivarContacto(resourceName) {
  await modificarMembresia({ resourceNamesToRemove: [resourceName] });
}

// Relectura para resolver un etag obsoleto: el etag correcto para el siguiente
// update viene en la respuesta del anterior, y solo hace falta volver a leer
// cuando alguien edito el contacto fuera del cotizador.
export async function leerContacto(resourceName) {
  const data = await pedir(`/${resourceName}?personFields=metadata,names,phoneNumbers`);
  return { resourceName: data.resourceName || resourceName, etag: data.etag };
}
