const BASE_CONT = 'https://content.dropboxapi.com/2';

export async function upload(path, content, mode = 'overwrite') {
  const token = process.env.DROPBOX_TOKEN;
  if (!token) throw new Error('DROPBOX_TOKEN no configurado');
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
