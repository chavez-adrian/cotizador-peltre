// Verificacion EN VIVO, READ-ONLY, de las credenciales de Google Contactos
// (issue #225). Mismo espiritu que scripts/verificar-dedup-rfc.mjs: comprueba
// contra el servicio real un supuesto que ningun test mockeado puede comprobar.
//
// NO ESCRIBE NADA. Solo refresca el access token y hace dos GET. Es seguro
// correrlo las veces que haga falta.
//
// Uso:
//   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... GOOGLE_REFRESH_TOKEN=... node scripts/verificar-google.mjs
//
// En PowerShell:
//   $env:GOOGLE_CLIENT_ID="..."; $env:GOOGLE_CLIENT_SECRET="..."; $env:GOOGLE_REFRESH_TOKEN="..."; node scripts/verificar-google.mjs
//
// Responde tres preguntas: (1) el refresh token sirve, (2) el permiso concedido
// es el de escritura y no el de solo lectura, (3) cuantos contactos hay hoy en
// la libreta -- numero que hace falta para el respaldo previo de #232.

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;

const SCOPE_ESCRITURA = 'https://www.googleapis.com/auth/contacts';

const faltantes = [
  ['GOOGLE_CLIENT_ID', CLIENT_ID],
  ['GOOGLE_CLIENT_SECRET', CLIENT_SECRET],
  ['GOOGLE_REFRESH_TOKEN', REFRESH_TOKEN],
].filter(([, v]) => !v).map(([k]) => k);

if (faltantes.length) {
  console.error('Faltan en el entorno: ' + faltantes.join(', '));
  process.exit(1);
}

// Un valor pegado con comillas o con espacios sobrantes produce un
// invalid_client cuyo mensaje no menciona ni comillas ni espacios. Se detecta
// aqui, que es mucho mas barato que descubrirlo dentro del sync.
for (const [nombre, valor] of [
  ['GOOGLE_CLIENT_ID', CLIENT_ID],
  ['GOOGLE_CLIENT_SECRET', CLIENT_SECRET],
  ['GOOGLE_REFRESH_TOKEN', REFRESH_TOKEN],
]) {
  if (valor !== valor.trim()) {
    console.error(`AVISO: ${nombre} tiene espacios o saltos de linea al principio o al final.`);
  }
  if (/^["']|["']$/.test(valor.trim())) {
    console.error(`AVISO: ${nombre} empieza o termina con comillas. En Render el valor va pelado.`);
  }
}

async function accessToken() {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID.trim(),
      client_secret: CLIENT_SECRET.trim(),
      refresh_token: REFRESH_TOKEN.trim(),
      grant_type: 'refresh_token',
    }),
  });
  const data = await r.json();
  if (!r.ok) {
    const pista = data.error === 'invalid_client'
      ? '  -> client_id o client_secret incorrectos (revisa comillas y espacios).'
      : data.error === 'invalid_grant'
        ? '  -> el refresh token no sirve: mal copiado, revocado, o la app volvio a estado de pruebas.'
        : '';
    throw new Error(`${r.status} ${data.error || ''} ${data.error_description || ''}\n${pista}`);
  }
  return data;
}

async function get(url, token) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await r.json();
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(data).slice(0, 300)}`);
  return data;
}

const main = async () => {
  console.log('Refrescando el access token...');
  const tok = await accessToken();
  console.log('  OK. El refresh token sirve.');

  const scopes = (tok.scope || '').split(' ').filter(Boolean);
  const puedeEscribir = scopes.includes(SCOPE_ESCRITURA);
  console.log('  Permisos concedidos:', scopes.join(', ') || '(no informados)');
  console.log(puedeEscribir
    ? '  OK. Incluye el permiso de escritura de contactos.'
    : '  FALTA el permiso de escritura. Con esto el sync no podria crear nada.');

  // No se consulta el perfil del titular (people/me con emailAddresses): eso
  // exige el scope `profile`, que a proposito NO pedimos. Que Google conteste
  // 403 ahi es la confirmacion de que el permiso quedo acotado a contactos.
  // Para identificar la libreta basta mirar los propios contactos, que si estan
  // dentro del scope: si los nombres son reconocibles, es la cuenta correcta.
  console.log('\nLeyendo la libreta de contactos...');
  const lista = await get(
    'https://people.googleapis.com/v1/people/me/connections' +
    '?personFields=names&pageSize=5&sortOrder=FIRST_NAME_ASCENDING',
    tok.access_token
  );
  const total = lista.totalPeople ?? lista.totalItems ?? '(no informado)';
  console.log('  Contactos actuales:', total);
  console.log('  Es el numero a respaldar antes de la primera carga (#232).');

  const muestra = (lista.connections || [])
    .map((p) => p.names?.[0]?.displayName)
    .filter(Boolean);
  if (muestra.length) {
    console.log('\n  Primeros contactos, para que reconozcas la libreta:');
    for (const n of muestra) console.log('    -', n);
    console.log('  Si no reconoces estos nombres, autorizaste la cuenta equivocada.');
  } else if (total === 0) {
    console.log('\n  La libreta esta vacia. Si esperabas contactos, revisa que cuenta autorizaste.');
  }

  console.log('\nNo se escribio nada. Verificacion terminada.');
  if (!puedeEscribir) process.exitCode = 1;
};

main().catch((e) => {
  console.error('\nFALLO:', e.message);
  process.exitCode = 1;
});
