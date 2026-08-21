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
const { resetIndice } = await import('../lib/indice-telefonos.js');
const { resetSession } = await import('../lib/operam-client.js');

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

// Operam de mentira: el listado paginado de clientes del que sale la segunda
// fuente (#228). Va en TODOS los mocks porque el barrido consulta el indice de
// telefonos en cada pasada; `paginas` cuenta las lecturas reales para poder
// afirmar que el cache del indice se respeta.
function operamFalso(clientes = [], estado = {}) {
  estado.paginas = 0;
  return {
    '/api/v3/login': () => jsonResponse({ token: 'tok-operam', result: true }),
    '/api/v3/sales/customers': () => {
      estado.paginas += 1;
      return jsonResponse({ total: clientes.length, data: clientes });
    },
  };
}

const CLIENTE_OPERAM = {
  customer_id: '101', CustName: 'COCINAS DEL VALLE SA DE CV', cust_ref: 'Cocinas del Valle',
  contacts: [{ action: 'general', name: 'Laura Mendez', phone: '55 4444 1111', email: 'laura@cocinas.mx' }],
  branches: [{ branch_code: '1', br_name: 'Almacen Norte', phone: '55 7777 2222' }],
};

// Lo que la libreta de Google YA tiene (#229). Se lee en cada pasada, paginada,
// y es lo que permite adoptar en vez de duplicar. `estado.paginasLibreta` cuenta
// las lecturas para poder afirmar sobre la paginacion.
function conexionesFalsas(existentes = [], estado = {}) {
  estado.paginasLibreta = 0;
  return {
    '/people/me/connections': () => {
      estado.paginasLibreta += 1;
      return jsonResponse({ connections: existentes, totalPeople: existentes.length });
    },
  };
}

// Libreta de Google de mentira: acumula lo creado y responde como la People API.
function libretaFalsa({ fallaEn = null, demora = false, clientes = [], operam = {}, existentes = [] } = {}) {
  const estado = { creados: [], actualizados: [], tokens: 0, enVuelo: 0, maxEnVuelo: 0, intentos: 0, operam };
  const handlers = {
    ...operamFalso(clientes, operam),
    ...conexionesFalsas(existentes, estado),
    ':updateContact': (u, opts) => {
      const body = JSON.parse(opts.body);
      estado.actualizados.push({ url: u, body });
      return jsonResponse({ resourceName: 'people/c9', etag: `etag-${estado.actualizados.length + 100}` });
    },
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
  // El indice de clientes cachea una hora: sin limpiarlo, una prueba heredaria
  // los clientes de la anterior.
  resetIndice();
  resetSession();
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
    ...operamFalso(),
    ...conexionesFalsas(),
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
    ...operamFalso(),
    ...conexionesFalsas(),
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

// --- Los clientes de Operam como segunda fuente (#228) ---

test('los telefonos de un cliente de Operam llegan a la libreta en la misma pasada', async () => {
  const { handlers, estado } = libretaFalsa({ clientes: [CLIENTE_OPERAM] });
  mockFetchByUrl(handlers);

  const resumen = await barrerContactosGoogle();

  // El prospecto de siempre + el contacto del cliente + el telefono del domicilio.
  assert.equal(resumen.creados, 3);
  const nombres = estado.creados.map(c => c.body.names[0].givenName).sort();
  assert.deepEqual(nombres, [
    'Almacen Norte - Cocinas del Valle',
    'Laura Mendez - Cocinas del Valle',
    'Laura Mendez - Cocinas del Valle',
  ].sort());
  const delCliente = estado.creados.find(c => c.body.phoneNumbers[0].value === '+525544441111');
  assert.equal(delCliente.body.userDefined[0].value, 'cotizador:cliente:101');
});

test('el barrido lee del cache del indice: la segunda pasada no vuelve a listar clientes', async () => {
  // El listado de clientes es paginado y con freno anti-429, y ya esta cacheado
  // una hora. Este barrido HEREDA ese ritmo en vez de imponer uno propio: si
  // pidiera clientes en cada pasada, cuadruplicaria la presion sobre Operam.
  const { handlers, estado } = libretaFalsa({ clientes: [CLIENTE_OPERAM] });
  mockFetchByUrl(handlers);

  await barrerContactosGoogle();
  assert.equal(estado.operam.paginas, 1);
  await barrerContactosGoogle();
  assert.equal(estado.operam.paginas, 1, 'la segunda pasada sale del cache del indice');
});

test('un fallo de Operam no impide que los prospectos lleguen a la libreta', async () => {
  const { handlers, estado } = libretaFalsa();
  mockFetchByUrl({
    ...handlers,
    '/api/v3/sales/customers': () => jsonResponse({ error: 'boom' }, 500),
  });

  const resumen = await barrerContactosGoogle();

  assert.equal(resumen.creados, 1, 'el prospecto se escribe igual');
  assert.equal(estado.creados[0].body.names[0].givenName, 'Laura Mendez - Cocinas del Valle');
});

test('un celular que es prospecto y cliente a la vez produce UNA ficha, la del cliente', async () => {
  const mismoCelular = {
    ...CLIENTE_OPERAM,
    contacts: [{ action: 'general', name: 'Laura Mendez', phone: '5512345678' }],
    branches: [],
  };
  const { handlers, estado } = libretaFalsa({ clientes: [mismoCelular] });
  mockFetchByUrl(handlers);

  const resumen = await barrerContactosGoogle();

  assert.equal(resumen.creados, 1);
  assert.equal(estado.creados[0].body.userDefined[0].value, 'cotizador:cliente:101');
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
    ...operamFalso(),
    ...conexionesFalsas(),
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
    ...operamFalso(),
    ...conexionesFalsas(),
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

// --- Adopcion de contactos que ya estaban en la libreta (#229) ---

// Un contacto que una persona guardo a mano en el telefono: nombre inventado,
// dos telefonos y un correo que la sincronizacion no conoce. El celular del
// prospecto es uno de sus numeros, guardado con el "1" de WhatsApp.
const HECHO_A_MANO = {
  resourceName: 'people/c9',
  etag: 'etag-9',
  names: [{ displayName: 'Laura la del hotel' }],
  phoneNumbers: [{ value: '+52 1 55 1234 5678' }, { value: '222 111 3344' }],
  emailAddresses: [{ value: 'personal@laura.mx' }],
};

test('un celular que ya tenia contacto en la libreta se ADOPTA en vez de duplicarse', async () => {
  const { handlers, estado } = libretaFalsa({ existentes: [HECHO_A_MANO] });
  mockFetchByUrl(handlers);

  const resumen = await barrerContactosGoogle();

  assert.equal(resumen.creados, 0, 'crear otra ficha del mismo numero es el bug de #229');
  assert.equal(estado.creados.length, 0);
  assert.equal(resumen.actualizados, 1);
  assert.equal(estado.actualizados[0].body.names[0].givenName, 'Laura Mendez - Cocinas del Valle');
});

test('la clase adoptada queda persistida en el mapeo', async () => {
  mockFetchByUrl(libretaFalsa({ existentes: [HECHO_A_MANO] }).handlers);
  await barrerContactosGoogle();
  const fila = leerMapeo()[0];
  assert.equal(fila.celular10, '5512345678');
  assert.equal(fila.resourceName, 'people/c9', 'se apunta al contacto que ya existia');
  assert.equal(fila.clase, 'adoptado');
});

// =========================================================================
// CANDADO ADR-0013, medido donde de verdad importa: en el cuerpo del PATCH que
// sale hacia Google. Google REEMPLAZA los campos que nombra updatePersonFields;
// mandar phoneNumbers con un solo numero borra el otro telefono de esa persona,
// y mandar emailAddresses vacio borra su correo. En cada pasada.
// =========================================================================
test('CANDADO ADR-0013: el PATCH de un adoptado no menciona telefonos, correos ni direcciones', async () => {
  const { handlers, estado } = libretaFalsa({ existentes: [HECHO_A_MANO] });
  mockFetchByUrl(handlers);

  await barrerContactosGoogle();

  const { url, body } = estado.actualizados[0];
  const mascara = decodeURIComponent(url.match(/updatePersonFields=([^&]*)/)[1]).split(',');
  assert.deepEqual(mascara, ['names', 'organizations', 'userDefined']);
  // El cuerpo tiene que coincidir con la mascara: un campo presente en el cuerpo
  // y ausente de la mascara no se escribe, pero uno presente en la mascara y
  // ausente del cuerpo se escribe VACIO, que es la forma de borrar.
  assert.deepEqual(Object.keys(body).filter(k => k !== 'etag').sort(), ['names', 'organizations', 'userDefined']);
  for (const prohibido of ['phoneNumbers', 'emailAddresses', 'addresses']) {
    assert.equal(prohibido in body, false, `${prohibido} en el cuerpo BORRA lo que la persona guardo`);
    assert.equal(mascara.includes(prohibido), false, `${prohibido} en la mascara BORRA lo que la persona guardo`);
  }
});

test('varias pasadas seguidas sobre un adoptado no vuelven a tocarlo', async () => {
  const { handlers, estado } = libretaFalsa({ existentes: [HECHO_A_MANO] });
  mockFetchByUrl(handlers);

  await barrerContactosGoogle();
  await barrerContactosGoogle();
  const tercera = await barrerContactosGoogle();

  assert.equal(estado.actualizados.length, 1, 'solo la primera pasada escribe');
  assert.equal(tercera.actualizados, 0);
  assert.equal(tercera.creados, 0);
});

test('la libreta se lee PAGINADA: un contacto de la segunda pagina tambien se adopta', async () => {
  // ~15 contactos hoy, pero la pagina de Google topa en 1000 y el default es
  // 100: quedarse con la primera pagina duplicaria en silencio a partir del 101.
  const estado = { paginas: [], creados: 0, actualizados: [] };
  mockFetchByUrl({
    ...operamFalso(),
    'oauth2.googleapis.com/token': () => jsonResponse({ access_token: 'tok', expires_in: 3600 }),
    '/people/me/connections': (u) => {
      estado.paginas.push(u);
      const token = (u.match(/pageToken=([^&]*)/) || [])[1];
      if (!token) return jsonResponse({ connections: [], nextPageToken: 'pagina-2' });
      return jsonResponse({ connections: [HECHO_A_MANO] });
    },
    'people:createContact': () => {
      estado.creados += 1;
      return jsonResponse({ resourceName: 'people/c1', etag: 'etag-1' });
    },
    ':updateContact': (u, opts) => {
      estado.actualizados.push(JSON.parse(opts.body));
      return jsonResponse({ resourceName: 'people/c9', etag: 'etag-99' });
    },
  });

  const resumen = await barrerContactosGoogle();

  assert.equal(estado.paginas.length, 2, 'la segunda pagina se pide con el pageToken');
  assert.ok(estado.paginas[1].includes('pageToken=pagina-2'));
  assert.equal(estado.creados, 0, 'el contacto de la segunda pagina evita la creacion');
  assert.equal(resumen.actualizados, 1);
});

test('si la libreta no se puede leer, la pasada NO crea fichas a ciegas', async () => {
  // Crear sin saber que hay en la libreta duplicaria los contactos ajenos, que
  // es exactamente lo que #229 existe para impedir. Mejor no hacer nada y que la
  // siguiente pasada lo resuelva.
  const estado = { creados: 0 };
  mockFetchByUrl({
    ...operamFalso(),
    'oauth2.googleapis.com/token': () => jsonResponse({ access_token: 'tok', expires_in: 3600 }),
    '/people/me/connections': () => jsonResponse({ error: { code: 500, message: 'boom' } }, 500),
    'people:createContact': () => {
      estado.creados += 1;
      return jsonResponse({ resourceName: 'people/c1', etag: 'etag-1' });
    },
  });

  const resumen = await barrerContactosGoogle();

  assert.equal(estado.creados, 0, 'ni una sola escritura a ciegas');
  assert.equal(resumen.creados, 0);
  assert.equal(resumen.omitido, 'libreta ilegible');
  assert.equal(resumen.errores.length, 1, 'el motivo tiene que quedar reportado');
  assert.deepEqual(leerMapeo(), []);
});

test('tras un fallo de la libreta, la siguiente pasada corre normal', async () => {
  mockFetchByUrl({
    ...operamFalso(),
    'oauth2.googleapis.com/token': () => jsonResponse({ access_token: 'tok', expires_in: 3600 }),
    '/people/me/connections': () => jsonResponse({ error: { code: 500, message: 'boom' } }, 500),
  });
  await barrerContactosGoogle();

  const { handlers, estado } = libretaFalsa();
  mockFetchByUrl(handlers);
  const resumen = await barrerContactosGoogle();

  assert.equal(resumen.creados, 1, 'el lock se libero y el barrido se recupera solo');
  assert.equal(estado.creados.length, 1);
});
