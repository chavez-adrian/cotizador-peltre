import { registrar as registrarSubida } from './dropbox-subidas-store.js';

const BASE_CONT = 'https://content.dropboxapi.com/2';

// Flujo de origen de cada subida (issue #356). Son los TRES del repo; la
// etiqueta viaja hasta el registro para que el panel /admin diga que se estaba
// subiendo cuando algo fallo. Un llamador nuevo que no declare el suyo cae en
// 'desconocido': eso se ve en el panel, que es justo lo contrario de lo que
// #354 dejo pasar durante meses.
export const FLUJO_CSF = 'csf';
export const FLUJO_CALCA = 'calca';
export const FLUJO_BITRIX = 'bitrix';
export const FLUJO_DESCONOCIDO = 'desconocido';

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

async function subirArchivo(path, content, mode) {
  const token = await getToken();
  const body = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
  const r = await fetch(`${BASE_CONT}/files/upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': JSON.stringify({ path, mode, autorename: mode === 'add' }),
    },
    body,
  });
  if (!r.ok) throw new Error(`Dropbox ${r.status}: ${await r.text()}`);
  return r.json();
}

// EL envoltorio comun de las subidas y, desde #356, el UNICO punto donde se
// registra el intento: los tres flujos pasan por aqui, asi que el registro no
// se repite en ningun sitio de llamada. El contrato no cambia -- devuelve lo
// mismo y lanza el mismo error que antes; el registro nunca lanza (el store se
// traga sus propios fallos), asi que ninguna respuesta HTTP depende de el.
export async function upload(path, content, mode = 'overwrite', flujo = FLUJO_DESCONOCIDO) {
  try {
    const data = await subirArchivo(path, content, mode);
    await registrarSubida({ flujo, destino: path, ok: true });
    return data;
  } catch (err) {
    await registrarSubida({ flujo, destino: path, ok: false, error: err.message });
    throw err;
  }
}

export async function subirCsfDropbox(pdfBase64, rfc, nombre) {
  const CSF_PATH = '/PELTRE NACIONAL/3.0 ADMINISTRACIÓN/CONTABILIDAD/PNA170810CF1/CONSTANCIA SITUACION FISCAL CLIENTES';
  const nombreSano = nombre.replace(/[/\\:*?"<>|]/g, '').trim();
  const path = `${CSF_PATH}/${rfc} - ${nombreSano}.pdf`;
  const data = await upload(path, Buffer.from(pdfBase64, 'base64'), 'add', FLUJO_CSF);
  console.log(`[dropbox] Subido: ${data.path_display}`);
  return data;
}
