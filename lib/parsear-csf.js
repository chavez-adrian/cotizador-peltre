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
const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const CATALOGO_REGIMENES = [
  ['601', 'General de Ley Personas Morales'],
  ['603', 'Personas Morales con Fines no Lucrativos'],
  ['605', 'Sueldos y Salarios e Ingresos Asimilados a Salarios'],
  ['606', 'Arrendamiento'],
  ['607', 'Regimen de Enajenacion o Adquisicion de Bienes'],
  ['608', 'Demas ingresos'],
  ['610', 'Residentes en el Extranjero sin Establecimiento Permanente en Mexico'],
  ['611', 'Ingresos por Dividendos'],
  ['612', 'Personas Fisicas con Actividades Empresariales y Profesionales'],
  ['614', 'Ingresos por intereses'],
  ['615', 'Regimen de los ingresos por obtencion de premios'],
  ['616', 'Sin obligaciones fiscales'],
  ['620', 'Sociedades Cooperativas de Produccion que optan por diferir sus ingresos'],
  ['621', 'Incorporacion Fiscal'],
  ['622', 'Actividades Agricolas, Ganaderas, Silvicolas y Pesqueras'],
  ['623', 'Opcional para Grupos de Sociedades'],
  ['624', 'Coordinados'],
  ['625', 'Regimen de las Actividades Empresariales con ingresos a traves de Plataformas Tecnologicas'],
  ['626', 'Regimen Simplificado de Confianza'],
].map(([codigo, desc]) => [codigo, norm(desc)]).sort((a, b) => b[1].length - a[1].length);

function mapearRegimenPorTexto(texto) {
  const t = norm(texto);
  for (const [codigo, desc] of CATALOGO_REGIMENES) {
    if (t.includes(desc)) return codigo;
  }
  return '';
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
