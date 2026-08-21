// Prueba manual del formato de telefono para WhatsApp (issue #226).
//
// Crea UN contacto de prueba en la libreta de Google usando el MISMO camino de
// escritura que usara el sync (la API, no la interfaz web). Esto importa: la
// interfaz de Google puede normalizar el numero al guardarlo, asi que crear el
// contacto a mano mediria otra cosa distinta de la que nos interesa.
//
// NO BORRA NADA. Los contactos de prueba se eliminan a mano desde
// contacts.google.com al terminar, viendo lo que se elimina.
//
// Uso:
//   node scripts/probar-formato-telefono.mjs "+525512345678"  "ZZ PRUEBA SIN UNO"
//   node scripts/probar-formato-telefono.mjs "+5215512345678" "ZZ PRUEBA CON UNO"
//
// En PowerShell, con las tres variables GOOGLE_* ya en el entorno.
//
// Despues de cada corrida hay que mirar el telefono: forzar la sincronizacion de
// contactos y ver si el chat existente con ese numero pasa a mostrar el nombre.
// Hacer UNA prueba a la vez y borrarla antes de la siguiente: con los dos
// formatos presentes a la vez no se sabe cual gano.

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;

const [telefono, nombre] = process.argv.slice(2);

if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
  console.error('Faltan GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET y/o GOOGLE_REFRESH_TOKEN.');
  process.exit(1);
}
if (!telefono || !nombre) {
  console.error('Uso: node scripts/probar-formato-telefono.mjs "<telefono>" "<nombre>"');
  console.error('Ej:  node scripts/probar-formato-telefono.mjs "+525512345678" "ZZ PRUEBA SIN UNO"');
  process.exit(1);
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
  if (!r.ok) throw new Error(`${r.status} ${data.error || ''} ${data.error_description || ''}`);
  return data.access_token;
}

const main = async () => {
  const token = await accessToken();

  console.log('Creando contacto de prueba...');
  console.log('  Nombre:  ', nombre);
  console.log('  Telefono:', telefono, '  <- tal cual, sin tocar');

  const r = await fetch(
    'https://people.googleapis.com/v1/people:createContact' +
    '?personFields=names,phoneNumbers,memberships',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        names: [{ givenName: nombre }],
        phoneNumbers: [{ value: telefono }],
      }),
    }
  );
  const data = await r.json();
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(data).slice(0, 400)}`);

  console.log('\nCreado. Lo que Google guardo realmente:');
  for (const p of data.phoneNumbers || []) {
    console.log('  value:        ', p.value);
    console.log('  canonicalForm:', p.canonicalForm ?? '(no devolvio)');
    if (p.canonicalForm && p.canonicalForm !== p.value) {
      console.log('  -> OJO: Google normalizo el numero. La forma canonica difiere de la escrita.');
    }
  }
  console.log('  resourceName: ', data.resourceName, ' <- identificador, por si hace falta');

  const grupos = (data.memberships || [])
    .map((m) => m.contactGroupMembership?.contactGroupId)
    .filter(Boolean);
  console.log('  grupos:       ', grupos.join(', ') || '(ninguno)');
  if (!grupos.includes('myContacts')) {
    console.log('  -> OJO: no quedo en myContacts. Android podria no sincronizarlo.');
  }

  console.log('\n--- Ahora, en el telefono ---');
  console.log('1. Ajustes > Cuentas > pppeltre@gmail.com > Sincronizar ahora (Contactos).');
  console.log('2. Abre WhatsApp Business y busca el chat existente con ese numero.');
  console.log('3. Anota si el chat muestra "' + nombre + '" o si sigue mostrando el numero.');
  console.log('\nDespues borra el contacto a mano en contacts.google.com antes de');
  console.log('probar el otro formato. Con los dos presentes no se sabe cual gano.');
};

main().catch((e) => {
  console.error('\nFALLO:', e.message);
  process.exitCode = 1;
});
