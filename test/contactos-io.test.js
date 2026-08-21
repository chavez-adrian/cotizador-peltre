import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'fs';
import { leerArchivoSync, escribirArchivoSync, borrarArchivoSync } from '../lib/fs-reintento.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROSPECTOS_PATH = join(__dirname, '..', 'data', 'prospectos.json');
const MAPEO_PATH = join(__dirname, '..', 'data', 'contactos-google.json');

// La suite NO toca red ni credenciales: las tres GOOGLE_* se montan aqui con
// valores de mentira y todo el trafico lo intercepta el mock por URL, el mismo
// patron que usan las suites del cliente de Operam. El .env local no las tiene
// -- y no debe tenerlas: sin mock, un fallo de esta suite escribiria en la
// libreta real.
process.env.GOOGLE_CLIENT_ID = 'id-de-prueba';
process.env.GOOGLE_CLIENT_SECRET = 'secreto-de-prueba';
process.env.GOOGLE_REFRESH_TOKEN = 'refresh-de-prueba';

const { barrerContactosGoogle } = await import('../lib/contactos-io.js');
const { resetToken } = await import('../lib/google-contactos.js');

const originalFetch = globalThis.fetch;

function mockFetchByUrl(handlers) {
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    for (const [pat, fn] of Object.entries(handlers)) {
      if (u.includes(pat)) return fn(u, opts);
    }
    throw new Error('Unmocked fetch: ' + u);
  };
}

function jsonResponse(data, status = 200) {
  return {
    ok: status < 400, status,
    json: async () => data,
    text: async () => JSON.stringify(data),
  };
}

const PROSPECTO = {
  id: 12, fecha: '2026-08-01T00:00:00Z', vendedor: 'Memo',
  celular: '+52 5512345678', celular10: '5512345678',
  nombre: 'Laura Mendez', ciudad: 'Puebla', canal: 'WhatsApp',
  etapa: 'por_cotizar', eventos: [],
  data: { empresa: 'Cocinas del Valle', correo: 'laura@cocinas.mx' },
};

const OTRO = {
  ...PROSPECTO, id: 13, celular: '+52 5598765432', celular10: '5598765432',
  nombre: 'Pedro Ruiz', data: { empresa: 'Ferreteria Norte' },
};

// Libreta de Google de mentira: acumula lo creado y responde como la People API.
function libretaFalsa({ fallaEn = null, demora = false } = {}) {
  const estado = { creados: [], tokens: 0, enVuelo: 0, maxEnVuelo: 0, intentos: 0 };
  const handlers = {
    'oauth2.googleapis.com/token': () => {
      estado.tokens += 1;
      return jsonResponse({ access_token: `tok${estado.tokens}`, expires_in: 3600 });
    },
    'people:createContact': async (u, opts) => {
      estado.intentos += 1;
      estado.enVuelo += 1;
      estado.maxEnVuelo = Math.max(estado.maxEnVuelo, estado.enVuelo);
      if (demora) await new Promise(r => setImmediate(r));
      const body = JSON.parse(opts.body);
      estado.enVuelo -= 1;
      const nombre = body.names?.[0]?.givenName;
      if (fallaEn && nombre && nombre.includes(fallaEn)) {
        return jsonResponse({ error: { code: 500, message: 'boom' } }, 500);
      }
      const resourceName = `people/c${estado.creados.length + 1}`;
      estado.creados.push({ resourceName, body, token: opts.headers.Authorization });
      return jsonResponse({ ...body, resourceName, etag: `etag-${estado.creados.length}` });
    },
  };
  return { handlers, estado };
}

let respaldoProspectos = null;
let existiaProspectos = false;
let respaldoMapeo = null;
let existiaMapeo = false;

before(() => {
  existiaProspectos = existsSync(PROSPECTOS_PATH);
  if (existiaProspectos) respaldoProspectos = leerArchivoSync(PROSPECTOS_PATH);
  existiaMapeo = existsSync(MAPEO_PATH);
  if (existiaMapeo) respaldoMapeo = leerArchivoSync(MAPEO_PATH);
});

after(() => {
  globalThis.fetch = originalFetch;
  if (existiaProspectos) escribirArchivoSync(PROSPECTOS_PATH, respaldoProspectos);
  else if (existsSync(PROSPECTOS_PATH)) borrarArchivoSync(PROSPECTOS_PATH);
  if (existiaMapeo) escribirArchivoSync(MAPEO_PATH, respaldoMapeo);
  else if (existsSync(MAPEO_PATH)) borrarArchivoSync(MAPEO_PATH);
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_REFRESH_TOKEN;
});

beforeEach(() => {
  escribirArchivoSync(PROSPECTOS_PATH, JSON.stringify([PROSPECTO], null, 2));
  escribirArchivoSync(MAPEO_PATH, '[]');
  globalThis.fetch = async (url) => { throw new Error('fetch sin mock en tests: ' + url); };
  resetToken();
});

function leerMapeo() {
  return JSON.parse(leerArchivoSync(MAPEO_PATH));
}

test('un prospecto capturado produce una ficha en la libreta, sin que nadie dispare nada', async () => {
  const { handlers, estado } = libretaFalsa();
  mockFetchByUrl(handlers);

  const resumen = await barrerContactosGoogle();

  assert.equal(resumen.creados, 1);
  assert.equal(estado.creados.length, 1);
  const body = estado.creados[0].body;
  assert.equal(body.names.length, 1, 'names es singleton: mandar dos produce error');
  assert.equal(body.names[0].givenName, 'Laura Mendez - Cocinas del Valle');
  assert.equal(body.phoneNumbers[0].value, '+525512345678');
  assert.equal(body.emailAddresses[0].value, 'laura@cocinas.mx');
});

test('la ficha queda en myContacts, sin lo cual Android no la sincroniza', async () => {
  const { handlers, estado } = libretaFalsa();
  mockFetchByUrl(handlers);
  await barrerContactosGoogle();
  const grupos = (estado.creados[0].body.memberships || [])
    .map(m => m.contactGroupMembership?.contactGroupId);
  assert.ok(grupos.includes('myContacts'), 'la ficha debe entrar en myContacts');
});

test('la ficha lleva la marca de origen del cotizador, visible al exportar', async () => {
  const { handlers, estado } = libretaFalsa();
  mockFetchByUrl(handlers);
  await barrerContactosGoogle();
  const marca = (estado.creados[0].body.userDefined || []).find(u => u.key === 'origen');
  assert.equal(marca.value, 'cotizador:prospecto:12');
});

test('el mapeo persiste la ficha bajo el celular NORMALIZADO, no bajo lo escrito en Google', async () => {
  mockFetchByUrl(libretaFalsa().handlers);
  await barrerContactosGoogle();
  const mapeo = leerMapeo();
  assert.equal(mapeo.length, 1);
  assert.equal(mapeo[0].celular10, '5512345678');
  assert.equal(mapeo[0].resourceName, 'people/c1');
  assert.equal(mapeo[0].etag, 'etag-1');
});

test('dos pasadas seguidas sobre el mismo estado no producen escrituras la segunda', async () => {
  const { handlers, estado } = libretaFalsa();
  mockFetchByUrl(handlers);
  await barrerContactosGoogle();
  const resumen = await barrerContactosGoogle();
  assert.equal(resumen.creados, 0);
  assert.equal(resumen.actualizados, 0);
  assert.equal(estado.creados.length, 1, 'la segunda pasada no debe escribir nada');
});

test('sin las credenciales de Google el barrido no arranca ni toca la red', async () => {
  const guardado = process.env.GOOGLE_REFRESH_TOKEN;
  delete process.env.GOOGLE_REFRESH_TOKEN;
  try {
    const resumen = await barrerContactosGoogle();
    assert.equal(resumen.omitido, 'sin credenciales');
    assert.equal(resumen.creados, 0);
  } finally {
    process.env.GOOGLE_REFRESH_TOKEN = guardado;
  }
});

test('las escrituras a Google van SECUENCIALES, nunca en paralelo', async () => {
  // Google lo pide por escrito en cada metodo de mutacion. El mock cuenta
  // cuantas peticiones estan en vuelo a la vez: con Promise.all serian 2.
  escribirArchivoSync(PROSPECTOS_PATH, JSON.stringify([PROSPECTO, OTRO], null, 2));
  const { handlers, estado } = libretaFalsa({ demora: true });
  mockFetchByUrl(handlers);

  const resumen = await barrerContactosGoogle();

  assert.equal(resumen.creados, 2);
  assert.equal(estado.maxEnVuelo, 1, 'nunca debe haber dos escrituras en vuelo');
});

test('un access token vencido se refresca solo y la escritura se reintenta una vez', async () => {
  const estado = { tokens: 0, intentos: 0, tokensUsados: [] };
  mockFetchByUrl({
    'oauth2.googleapis.com/token': () => {
      estado.tokens += 1;
      return jsonResponse({ access_token: `tok${estado.tokens}`, expires_in: 3600 });
    },
    'people:createContact': (u, opts) => {
      estado.intentos += 1;
      estado.tokensUsados.push(opts.headers.Authorization);
      if (estado.intentos === 1) return jsonResponse({ error: { code: 401, message: 'expirado' } }, 401);
      return jsonResponse({ resourceName: 'people/c1', etag: 'etag-1' });
    },
  });

  const resumen = await barrerContactosGoogle();

  assert.equal(resumen.creados, 1, 'el reintento debe salvar la escritura');
  assert.equal(estado.intentos, 2);
  assert.equal(estado.tokens, 2, 'el token se refresca al ver el 401');
  assert.equal(estado.tokensUsados[1], 'Bearer tok2', 'el reintento va con el token nuevo');
});

test('un token que sigue vencido no reintenta en bucle: se rinde tras un intento', async () => {
  const estado = { intentos: 0 };
  mockFetchByUrl({
    'oauth2.googleapis.com/token': () => jsonResponse({ access_token: 'tok', expires_in: 3600 }),
    'people:createContact': () => {
      estado.intentos += 1;
      return jsonResponse({ error: { code: 401, message: 'revocado' } }, 401);
    },
  });

  const resumen = await barrerContactosGoogle();

  assert.equal(estado.intentos, 2, 'un intento y UN reintento, no mas');
  assert.equal(resumen.creados, 0);
  assert.equal(resumen.errores.length, 1);
});

test('un fallo a mitad del plan no descarta lo ya aplicado ni impide la siguiente pasada', async () => {
  escribirArchivoSync(PROSPECTOS_PATH, JSON.stringify([PROSPECTO, OTRO], null, 2));
  const primera = libretaFalsa({ fallaEn: 'Pedro' });
  mockFetchByUrl(primera.handlers);

  const uno = await barrerContactosGoogle();
  assert.equal(uno.creados, 1);
  assert.equal(uno.errores.length, 1);
  assert.deepEqual(leerMapeo().map(m => m.celular10), ['5512345678'],
    'lo escrito antes del fallo queda persistido');

  // Siguiente pasada, ya sin el fallo: solo falta el que no se pudo escribir.
  const segunda = libretaFalsa();
  mockFetchByUrl(segunda.handlers);
  const dos = await barrerContactosGoogle();

  assert.equal(dos.creados, 1, 'solo se reintenta el que falto');
  assert.equal(segunda.estado.creados.length, 1);
  assert.equal(segunda.estado.creados[0].body.names[0].givenName, 'Pedro Ruiz - Ferreteria Norte');
});

test('un etag obsoleto se reconoce por su MOTIVO y no por su codigo: se relee y se reintenta', async () => {
  // 400 + failedPrecondition significa "alguien edito esto desde el telefono",
  // no "payload malformado". Google no manda 409 aqui.
  escribirArchivoSync(MAPEO_PATH, JSON.stringify([{
    celular10: '5512345678', resourceName: 'people/c1', etag: 'viejo',
    clase: 'propio', huella: 'huella-de-otra-pasada',
  }], null, 2));
  const estado = { intentos: 0, etagsEnviados: [], relecturas: 0 };
  mockFetchByUrl({
    'oauth2.googleapis.com/token': () => jsonResponse({ access_token: 'tok', expires_in: 3600 }),
    ':updateContact': (u, opts) => {
      estado.intentos += 1;
      estado.etagsEnviados.push(JSON.parse(opts.body).etag);
      if (estado.intentos === 1) {
        return jsonResponse({
          error: {
            code: 400, status: 'FAILED_PRECONDITION', message: 'etag mismatch',
            details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'failedPrecondition' }],
          },
        }, 400);
      }
      return jsonResponse({ resourceName: 'people/c1', etag: 'fresco' });
    },
    'people/c1?personFields': () => {
      estado.relecturas += 1;
      return jsonResponse({ resourceName: 'people/c1', etag: 'recien-leido' });
    },
  });

  const resumen = await barrerContactosGoogle();

  assert.equal(estado.relecturas, 1, 'se relee el contacto en vez de rendirse');
  assert.deepEqual(estado.etagsEnviados, ['viejo', 'recien-leido']);
  assert.equal(resumen.actualizados, 1);
  assert.equal(leerMapeo()[0].etag, 'fresco');
});

test('un 400 que NO es de etag no se relee: no todo 400 es un conflicto de version', async () => {
  escribirArchivoSync(MAPEO_PATH, JSON.stringify([{
    celular10: '5512345678', resourceName: 'people/c1', etag: 'viejo',
    clase: 'propio', huella: 'huella-de-otra-pasada',
  }], null, 2));
  const estado = { intentos: 0, relecturas: 0 };
  mockFetchByUrl({
    'oauth2.googleapis.com/token': () => jsonResponse({ access_token: 'tok', expires_in: 3600 }),
    ':updateContact': () => {
      estado.intentos += 1;
      return jsonResponse({ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'names is a singleton' } }, 400);
    },
    'people/c1?personFields': () => {
      estado.relecturas += 1;
      return jsonResponse({ resourceName: 'people/c1', etag: 'recien-leido' });
    },
  });

  const resumen = await barrerContactosGoogle();

  assert.equal(estado.relecturas, 0, 'un payload malformado no se arregla releyendo');
  assert.equal(estado.intentos, 1);
  assert.equal(resumen.actualizados, 0);
  assert.equal(resumen.errores.length, 1);
});
