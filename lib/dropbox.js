import { destinoDeFlujo, rutaDeSubida, cabecerasDeDestino, avisoSinConfigurar } from './dropbox-destinos.js';
import { registrar as registrarSubida } from './dropbox-subidas-store.js';

const BASE_CONT = 'https://content.dropboxapi.com/2';

let _accessToken = null;
let _tokenExpiry = 0;

async function getToken() {
  if (_accessToken && Date.now() < _tokenExpiry) return _accessToken;
  const refreshToken = process.env.DROPBOX_REFRESH_TOKEN;
  const appKey = process.env.DROPBOX_APP_KEY;
  const appSecret = process.env.DROPBOX_APP_SECRET;
  if (!refreshToken || !appKey || !appSecret) throw new Error('Faltan vars DROPBOX_REFRESH_TOKEN / DROPBOX_APP_KEY / DROPBOX_APP_SECRET');
  const body = `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}&client_id=${encodeURIComponent(appKey)}&client_secret=${encodeURIComponent(appSecret)}`;
  const r = await fetch('https://api.dropbox.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!r.ok) throw new Error(`Dropbox token refresh ${r.status}: ${await r.text()}`);
  const data = await r.json();
  _accessToken = data.access_token;
  _tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  console.log('[dropbox] Token renovado');
  return _accessToken;
}

async function subirArchivo(path, content, mode, config) {
  const token = await getToken();
  const body = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
  const r = await fetch(`${BASE_CONT}/files/upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': JSON.stringify({ path, mode, autorename: mode === 'add' }),
      ...cabecerasDeDestino(config),
    },
    body,
  });
  if (!r.ok) throw new Error(`Dropbox ${r.status}: ${await r.text()}`);
  return r.json();
}

// EL envoltorio comun de las subidas y, desde #356, el UNICO punto donde se
// registra el intento: los tres flujos pasan por aqui, asi que el registro no
// se repite en ningun sitio de llamada. La fila lleva el namespace contra el
// que viajo la peticion (#399): la ruta sola no distingue el Dropbox real del
// sandbox. El registro nunca lanza (el store se traga sus propios fallos), asi
// que ninguna respuesta HTTP depende de el.
//
// `destino` es la configuracion del flujo, nunca una ruta absoluta suelta
// (#357): `{ flujo, archivo }`, donde `archivo` es la ruta RELATIVA al destino
// del flujo (ver lib/dropbox-destinos.js), y `flujo` es la misma llave que
// identifica la subida en el panel de #356 -- una sola, declarada alla. Sin
// namespace configurado la peticion sale como salia -- ruta absoluta heredada
// y sin header nuevo -- y queda la advertencia. Con namespace, un error de
// Dropbox RECHAZA y no se reintenta contra la ruta de texto: eso
// reintroduciria el bug de #354.
//
// Un flujo que no exista revienta aqui, ANTES de pedir token y sin dejar
// registro: no hay ruta que registrar y es un error de programacion, no una
// subida fallida.
export async function upload(destino, content, mode = 'overwrite') {
  const config = destinoDeFlujo(destino.flujo);
  const aviso = avisoSinConfigurar(config);
  if (aviso) console.warn(aviso);
  const path = rutaDeSubida(config, destino.archivo);
  try {
    const data = await subirArchivo(path, content, mode, config);
    await registrarSubida({ flujo: config.flujo, destino: path, namespace: config.namespace, ok: true });
    return data;
  } catch (err) {
    await registrarSubida({ flujo: config.flujo, destino: path, namespace: config.namespace, ok: false, error: err.message });
    throw err;
  }
}

export async function subirCsfDropbox(pdfBase64, rfc, nombre) {
  const nombreSano = nombre.replace(/[/\\:*?"<>|]/g, '').trim();
  const data = await upload({ flujo: 'csf', archivo: `${rfc} - ${nombreSano}.pdf` }, Buffer.from(pdfBase64, 'base64'), 'add');
  console.log(`[dropbox] Subido: ${data.path_display}`);
  return data;
}
