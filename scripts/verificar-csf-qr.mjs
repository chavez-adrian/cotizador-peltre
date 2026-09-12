// Verificador EN VIVO del respaldo por QR de la CSF (issue #378).
//
// Por que no es un test de la suite: la suite prueba el parser contra una fixture
// sintetica y el proxy contra un https.get mockeado. Ningun mock puede detectar
// que el SAT cambio las etiquetas de su validador, que dejo de aceptar el TLS
// relajado o que la pagina ya no es la misma -- que es justo como este respaldo
// llevaba desde #28 roto sin que nadie se enterara. Este script le pregunta al
// SAT de verdad.
//
// READ-ONLY: un solo GET al validador del SAT. Cero escrituras, cero Operam.
//
// Uso:
//   node scripts/verificar-csf-qr.mjs "<url del QR de una CSF>"
//
// La URL es la que imprime el QR de cualquier constancia; sale del propio PDF
// (el cotizador la lee con jsQR) o de escanear el codigo con el telefono.
//
// exit 0 = el respaldo por QR sirve, 1 = esta roto y el vendedor se queda sin el.
import { descargarValidadorQR, htmlATexto, esHostDelSat } from '../lib/sat-qr.js';
import { parsearCSF } from '../lib/parsear-csf.js';

const url = process.argv[2];
if (!url) {
  console.error('Falta la URL del QR.\nUso: node scripts/verificar-csf-qr.mjs "https://siat.sat.gob.mx/app/qr/faces/pages/mobile/validadorqr.jsf?D1=10&D2=1&D3=..."');
  process.exit(1);
}

let hostname;
try { hostname = new URL(url).hostname; } catch {
  console.error(`URL invalida: ${url}`);
  process.exit(1);
}
if (!esHostDelSat(hostname)) {
  console.error(`${hostname} no es un host del SAT: el proxy la rechazaria con 400.`);
  process.exit(1);
}

// El idCIF no viene en la pagina, viaja en la URL del QR: el navegador lo
// antepone al texto antes de parsear y aqui se replica ese mismo paso.
function idCifDeLaUrl(u) {
  const m = new URL(u).searchParams.get('D3') || '';
  const partes = m.split(/[_\-|]/);
  for (const p of partes) if (/^\d{10,12}$/.test(p)) return p;
  return '';
}

const CAMPOS = ['rfc', 'razonSocial', 'cp', 'calle', 'colonia', 'municipio', 'estado', 'regimenFiscal'];

const { status, html } = await descargarValidadorQR(url);
console.log(`SAT respondio ${status} (${html.length} caracteres de HTML)`);
if (status !== 200) {
  console.error('El proxy respondería 502 y el vendedor se queda sin el respaldo por QR.');
  process.exit(1);
}

const texto = htmlATexto(html);
const idcif = idCifDeLaUrl(url);
const datos = parsearCSF(idcif ? `idCIF: ${idcif}\n${texto}` : texto);

console.log('');
for (const campo of CAMPOS) {
  console.log(`  ${datos[campo] ? 'OK  ' : 'VACIO'} ${campo}: ${datos[campo] || '(vacio)'}`);
}
console.log(`  ${datos.idcif ? 'OK  ' : 'VACIO'} idcif: ${datos.idcif || '(vacio)'}`);

const vacios = CAMPOS.filter(c => !datos[c]);
if (vacios.length) {
  console.error(`\nEl validador contesto pero el parser no saco: ${vacios.join(', ')}.`);
  console.error('Probablemente el SAT cambio las etiquetas de la pagina. Texto recibido:\n');
  console.error(texto);
  process.exit(1);
}

console.log('\nEl respaldo por QR sirve: el panel del alta se llenaria con estos datos.');
