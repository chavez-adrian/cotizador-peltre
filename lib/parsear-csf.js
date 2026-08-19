import { nombrePropio } from './cruce-bitrix.js';
import { CATALOGO_REGIMENES, labelRegimen } from '../public/js/regimen-fiscal-logica.js';

// El SAT entrega la CSF con dos campos por renglon ("Codigo Postal:23405 Tipo
// de Vialidad: ...") y pdf.js une todos los items con espacios, dejando la
// constancia en una sola linea. Los regex de abajo delimitan cada campo con
// \n, asi que primero insertamos un salto de linea ANTES de cada etiqueta
// conocida para recuperar el delimitador. El texto ya orientado por lineas
// (tests, QR) pasa sin cambios relevantes.
const ETIQUETAS = [
  'Denominaci[oó]n\\s*\\/?\\s*Raz[oó]n\\s*Social',
  'Nombre\\s*\\(s\\)',
  'Primer\\s*Apellido',
  'Segundo\\s*Apellido',
  'CURP',
  'R[eé]gimen\\s*Capital',
  'Nombre\\s*Comercial',
  'Fecha\\s*inicio\\s*de\\s*operaciones',
  'Estatus\\s*en\\s*el\\s*padr[oó]n',
  'Situaci[oó]n\\s*del\\s*contribuyente',
  'Fecha\\s*de\\s*[uú]ltimo\\s*cambio\\s*de\\s*estado',
  'Fecha\\s*de\\s*emisi[oó]n',
  'Datos\\s*del\\s*domicilio',
  'C[oó]digo\\s*Postal',
  'Tipo\\s*de\\s*Vialidad',
  'Nombre\\s*de\\s*(?:la\\s*)?Vialidad',
  'N[uú]mero\\s*Exterior',
  'N[uú]mero\\s*Interior',
  'Nombre\\s*de\\s*la\\s*Colonia',
  'Nombre\\s*de\\s*la\\s*Localidad',
  'Nombre\\s*del\\s*Municipio(?:\\s*o\\s*Demarcaci[oó]n\\s*Territorial)?',
  'Nombre\\s*de\\s*la\\s*Entidad\\s*Federativa',
  'Entre\\s*Calle',
  'Y\\s*Calle',
  'Actividades\\s*Econ[oó]micas',
  'R[eé]gimen(?:es)?\\s*Fiscal',
  'R[eé]gimenes',
  'idCIF',
  'R\\.?F\\.?C\\.?',
];
const RE_ETIQUETAS = new RegExp('\\s*(' + ETIQUETAS.join('|') + ')\\s*:?\\s*', 'gi');

function normalizarLineas(texto) {
  return texto.replace(RE_ETIQUETAS, (m, label) => `\n${label}: `);
}

// Las CSF nuevas (cedula de identificacion) ya NO imprimen el codigo numerico
// del regimen; solo la descripcion en la seccion "Regimenes". Mapeamos la
// descripcion del catalogo c_RegimenFiscal del SAT al codigo. Ordenado por
// longitud descendente para que la frase mas especifica gane cuando una es
// substring de otra (p.ej. Actividades Empresariales aparece en 612 y 625).
// El catalogo en si vive en public/js/regimen-fiscal-logica.js desde el issue
// #191: el selector del alta necesita el mismo dato y una segunda copia se
// habria desincronizado. Aqui solo queda lo propio del parseo -- normalizar y
// ordenar para el match por texto.
const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const REGIMENES_POR_TEXTO = CATALOGO_REGIMENES
  .map(({ codigo, descripcion }) => [codigo, norm(descripcion)])
  .sort((a, b) => b[1].length - a[1].length);

function mapearRegimenPorTexto(texto) {
  const t = norm(texto);
  for (const [codigo, descNorm] of REGIMENES_POR_TEXTO) {
    if (t.includes(descNorm)) return codigo;
  }
  return '';
}

// La seccion "Actividades Economicas" del SAT es una tabla (Orden, Actividad
// Economica, Porcentaje, Fecha Inicio, Fecha Fin) que pdf.js aplana a texto corrido.
// normalizarLineas ya delimita el inicio de la seccion (label conocido) y su fin (el
// siguiente label, "Regimenes"), asi que esta funcion solo separa filas dentro de ese
// tramo: [orden] [descripcion] [porcentaje] [fecha inicio] [fecha fin opcional].
const RE_HEADER_ACTIVIDADES = /Orden\s+Actividad\s+Econ[oó]mica\s+Porcentaje\s+Fecha\s+Inicio\s+Fecha\s+Fin\s*/i;
const RE_FILA_ACTIVIDAD = /(\d+)\s+(.+?)\s+(\d{1,3})\s+(\d{2}\/\d{2}\/\d{4})(?:\s+\d{2}\/\d{2}\/\d{4})?\s*/g;

function extraerActividades(texto) {
  const m = texto.match(/Actividades\s*Econ[oó]micas\s*:\s*([^\n]*)/i);
  if (!m) return [];
  const seccion = m[1].replace(RE_HEADER_ACTIVIDADES, '').trim();
  if (!seccion) return [];
  const filas = [];
  let fila;
  RE_FILA_ACTIVIDAD.lastIndex = 0;
  while ((fila = RE_FILA_ACTIVIDAD.exec(seccion))) {
    filas.push({ descripcion: fila[2].trim(), porcentaje: fila[3] });
  }
  if (filas.length === 0) return [];
  const conPorcentaje = filas.length > 1;
  return filas.map(f => conPorcentaje ? `${f.descripcion} (${f.porcentaje}%)` : f.descripcion);
}

// "Fecha de emision de este documento" trae texto entre la etiqueta y el valor
// ("de este documento :"), asi que no puede resolverse con el extractor generico
// label->valor (get()). normalizarLineas ya inserto ": " justo tras "emision", asi
// que este regex tolera ese infijo opcional y el prefijo "A " del SAT antes de la
// fecha ("A 8 DE MAYO DE 2026").
function extraerFechaEmision(texto) {
  const m = texto.match(/Fecha\s*de\s*emisi[oó]n\s*:\s*(?:de\s*este\s*documento\s*)?:?\s*(?:A\s+)?([^\n]+)/i);
  return m ? m[1].trim() : '';
}

export function parsearCSF(textoCrudo) {
  const texto = normalizarLineas(textoCrudo);
  const get = (regex) => {
    const m = texto.match(regex);
    return m ? m[1].trim() : '';
  };

  const rfc = get(/R\.?F\.?C\.?\s*:?\s*([A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3})/i);

  const razonSocial = (() => {
    const pm = get(/(?:Denominaci[oó]n\s*\/?\s*)?Raz[oó]n\s*Social\s*:\s*(.+?)(?=\n|R\.?F\.?C)/is);
    if (pm) return pm.trim();
    const nombre = get(/Nombre\s*(?:\(s\))?\s*:\s*([A-ZÁÉÍÓÚÑ ]+?)(?=\n)/i);
    const ap1 = get(/Primer\s*Apellido\s*:\s*([A-ZÁÉÍÓÚÑ ]+?)(?=\n)/i);
    const ap2 = get(/Segundo\s*Apellido\s*:\s*([A-ZÁÉÍÓÚÑ ]+?)(?=\n)/i);
    return [nombre, ap1, ap2].filter(Boolean).join(' ').trim();
  })();

  const idcif = get(/idCIF\s*:\s*(\d+)/i);
  const cp = get(/C[oó]digo\s*Postal\s*:?\s*(\d{5})/i);
  const calle = get(/Nombre\s*de\s*(?:la\s*)?Vialidad\s*:\s*([^\n]+)/i);
  const numExt = get(/N[uú]mero\s*Exterior\s*:\s*([^\n]+)/i);
  const numInt = get(/N[uú]mero\s*Interior\s*:\s*([^\n]*)/i);
  const colonia = get(/Nombre\s*de\s*la\s*Colonia\s*:\s*([^\n]+)/i);
  const municipio = get(/Nombre\s*del\s*Municipio[^\n:]*:\s*([^\n]+)/i);
  const estado = get(/Nombre\s*de\s*la\s*Entidad\s*Federativa\s*:\s*([^\n]+)/i);

  const regimenFiscal = (() => {
    const m = texto.match(/R[eé]gimen\s*Fiscal\s*:\s*(\d{3})/i);
    if (m) return m[1];
    return mapearRegimenPorTexto(texto);
  })();

  // La CSF del SAT imprime la razon social en MAYUSCULAS sostenidas; el nombre
  // corto propuesto sale en Title Case con la misma regla de #159 (issue #170).
  // El vendedor puede editarlo antes de confirmar.
  const nombreCorto = nombrePropio(razonSocial.split(' ').slice(0, 3).join(' '));

  return {
    rfc,
    razonSocial,
    nombreCorto,
    idcif,
    cp,
    calle,
    numExt,
    numInt: numInt || '',
    colonia,
    municipio,
    estado,
    pais: 'MX',
    regimenFiscal,
    regimenFiscalLabel: labelRegimen(regimenFiscal),
    actividades: extraerActividades(texto),
    csf_fecha: extraerFechaEmision(texto),
  };
}
