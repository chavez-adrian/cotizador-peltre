// Script de UN SOLO USO para obtener el refresh token de Google (issue #225).
//
// No forma parte del servidor: se corre a mano, una vez, desde la maquina de
// Adrian, y su unica salida es el GOOGLE_REFRESH_TOKEN que hay que pegar en
// Render. Mismo contrato que el refresh de lib/dropbox.js: cliente confidencial,
// token de larga vida en variable de entorno, sin dependencias nuevas.
//
// Uso:
//   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... node scripts/autorizar-google.mjs
//
// En PowerShell:
//   $env:GOOGLE_CLIENT_ID="..."; $env:GOOGLE_CLIENT_SECRET="..."; node scripts/autorizar-google.mjs
//
// Requiere que en la consola de Google el cliente OAuth sea de tipo "Web
// application" y tenga http://localhost:8080/callback como URI de redireccion
// autorizada (el puerto se puede cambiar con PUERTO_AUTORIZACION).

import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const PUERTO = Number(process.env.PUERTO_AUTORIZACION) || 8080;
const REDIRECT_URI = `http://localhost:${PUERTO}/callback`;

// El unico scope que permite escribir contactos. No existe uno mas acotado:
// verificado contra el documento de descubrimiento de la API (ver
// docs/research/sincronizacion-contactos-google.md seccion 3.5). Incluye borrar,
// por eso el modulo de produccion nunca debe invocar los endpoints de borrado.
const SCOPE = 'https://www.googleapis.com/auth/contacts';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Faltan GOOGLE_CLIENT_ID y/o GOOGLE_CLIENT_SECRET en el entorno.');
  console.error('Se obtienen en la consola de Google, al crear el cliente OAuth.');
  process.exit(1);
}

const estado = randomBytes(16).toString('hex');

// access_type=offline es lo que hace que Google devuelva refresh token, y
// prompt=consent fuerza la pantalla aunque esta cuenta ya haya autorizado antes
// (Google solo entrega el refresh token en el consentimiento, no en cada login).
const urlAutorizacion =
  'https://accounts.google.com/o/oauth2/v2/auth' +
  `?client_id=${encodeURIComponent(CLIENT_ID)}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  '&response_type=code' +
  `&scope=${encodeURIComponent(SCOPE)}` +
  '&access_type=offline' +
  '&prompt=consent' +
  `&state=${estado}`;

function responder(res, codigo, titulo, detalle) {
  res.writeHead(codigo, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(
    `<!doctype html><meta charset="utf-8">` +
    `<body style="font-family:system-ui;max-width:34rem;margin:4rem auto;line-height:1.5">` +
    `<h1 style="font-size:1.25rem">${titulo}</h1><p>${detalle}</p></body>`
  );
}

async function canjearCodigo(code) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(data)}`);
  return data;
}

function abrirNavegador(url) {
  // start es de cmd, no un ejecutable: en Windows hay que pasarlo por el shell.
  // El primer argumento vacio de start es el titulo de ventana, y sin el, una
  // URL entre comillas se interpretaria como titulo y no abriria nada.
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    // Si no se pudo abrir, la URL ya esta impresa en consola: se pega a mano.
  }
}

const servidor = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PUERTO}`);
  if (url.pathname !== '/callback') {
    responder(res, 404, 'Ruta no esperada', 'Este servidor solo atiende /callback.');
    return;
  }

  const error = url.searchParams.get('error');
  if (error) {
    responder(res, 400, 'Autorizacion cancelada', `Google respondio: ${error}`);
    console.error('\nGoogle nego la autorizacion:', error);
    servidor.close();
    process.exitCode = 1;
    return;
  }

  if (url.searchParams.get('state') !== estado) {
    responder(res, 400, 'Estado invalido', 'La respuesta no corresponde a esta sesion.');
    console.error('\nEl parametro state no coincide. Se descarta la respuesta.');
    servidor.close();
    process.exitCode = 1;
    return;
  }

  const code = url.searchParams.get('code');
  if (!code) {
    responder(res, 400, 'Falta el codigo', 'Google no devolvio el parametro code.');
    servidor.close();
    process.exitCode = 1;
    return;
  }

  try {
    const tokens = await canjearCodigo(code);
    if (!tokens.refresh_token) {
      responder(res, 500, 'Sin refresh token',
        'Google no devolvio refresh_token. Revoca el acceso de la app en la cuenta y vuelve a correr el script.');
      console.error('\nGoogle no devolvio refresh_token.');
      console.error('Suele pasar cuando la cuenta ya habia autorizado la app y no se forzo el consentimiento.');
      console.error('Solucion: entra a https://myaccount.google.com/permissions, quita el acceso de la app, y repite.');
      servidor.close();
      process.exitCode = 1;
      return;
    }

    responder(res, 200, 'Listo',
      'Ya puedes cerrar esta pestana. El refresh token se imprimio en la terminal.');

    console.log('\n===============================================================');
    console.log('GOOGLE_REFRESH_TOKEN=' + tokens.refresh_token);
    console.log('===============================================================');
    console.log('\nPegalo en las variables de entorno de Render, junto con');
    console.log('GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET.');
    console.log('\nNO lo pegues en el repositorio, en un issue ni en un chat:');
    console.log('con el se puede leer, editar y BORRAR toda la libreta de contactos.');
    console.log('\nScope autorizado:', tokens.scope || SCOPE);
    servidor.close();
  } catch (e) {
    responder(res, 500, 'Fallo el canje', 'Revisa la terminal para el detalle.');
    console.error('\nNo se pudo canjear el codigo por tokens:', e.message);
    servidor.close();
    process.exitCode = 1;
  }
});

servidor.listen(PUERTO, () => {
  console.log('Esperando la autorizacion de Google en', REDIRECT_URI);
  console.log('\nSi el navegador no se abre solo, pega esta URL:\n');
  console.log(urlAutorizacion + '\n');
  console.log('En la pantalla de "Google no ha verificado esta aplicacion",');
  console.log('entra a "Configuracion avanzada" y continua: es lo esperado.\n');
  abrirNavegador(urlAutorizacion);
});
