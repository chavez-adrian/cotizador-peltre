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

export async function upload(path, content, mode = 'overwrite') {
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

export async function subirCsfDropbox(pdfBase64, rfc, nombre) {
  const CSF_PATH = '/PELTRE NACIONAL/3.0 ADMINISTRACIÓN/CONTABILIDAD/PNA170810CF1/CONSTANCIA SITUACION FISCAL CLIENTES';
  const nombreSano = nombre.replace(/[/\\:*?"<>|]/g, '').trim();
  const path = `${CSF_PATH}/${rfc} - ${nombreSano}.pdf`;
  const data = await upload(path, Buffer.from(pdfBase64, 'base64'), 'add');
  console.log(`[dropbox] Subido: ${data.path_display}`);
  return data;
}
