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
    return m ? m[1] : '';
  })();

  const nombreCorto = razonSocial.split(' ').slice(0, 3).join(' ');

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
  };
}
