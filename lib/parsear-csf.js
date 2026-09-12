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
  'Fecha\\s*(?:de\\s*)?[Ii]nicio\\s*de\\s*operaciones',
  'Estatus\\s*en\\s*el\\s*padr[oó]n',
  'Situaci[oó]n\\s*del\\s*contribuyente',
  'Fecha\\s*de\\s*[uú]ltimo\\s*cambio\\s*de\\s*estado',
  'Fecha\\s*del\\s*[uú]ltimo\\s*cambio\\s*de\\s*situaci[oó]n',
  'Fecha\\s*Nacimiento',
  'Fecha\\s*de\\s*alta',
  'Datos\\s*de\\s*Identificaci[oó]n',
  'Datos\\s*de\\s*Ubicaci[oó]n',
  'Caracter[ií]sticas\\s*fiscales',
  'Municipio\\s*o\\s*delegaci[oó]n',
  'Entidad\\s*Federativa',
  'Apellido\\s*Paterno',
  'Apellido\\s*Materno',
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
// Etiquetas CORTAS o ambiguas del validador QR (issue #378): "CP", "AL",
// "Nombre" o "Regimen" a secas aparecerian dentro de un valor legitimo, asi que
// aqui los dos puntos NO son opcionales y la etiqueta tiene que EMPEZAR palabra:
// sin el lookbehind, el "AL:" de un domicilio "CALLE LOCAL: 5" partia el valor y
// dejaba la calle en "CALLE LOC". El grupo general se prueba primero, de modo que
// "Nombre de la Vialidad:" le sigue ganando a "Nombre:".
const ETIQUETAS_ESTRICTAS = [
  'CP',
  'AL',
  'Nombre',
  'Colonia',
  'R[eé]gimen',
];
const INICIO_DE_PALABRA = '(?<![A-Za-z0-9ÁÉÍÓÚÑáéíóúñ])';
const RE_ETIQUETAS = new RegExp(
  '\\s*(?:(' + ETIQUETAS.join('|') + ')\\s*:?|' + INICIO_DE_PALABRA + '(' + ETIQUETAS_ESTRICTAS.join('|') + ')\\s*:)[ \\t]*',
  'gi');

// El validador QR pone el VALOR EN LA LINEA SIGUIENTE a su etiqueta, asi que ese
// salto hay que plegarlo... pero SOLO cuando abajo viene un valor. Si abajo hay
// otra etiqueta, el campo esta presente y VACIO y plegarlo reintroduciria el
// dano de #349 (asi el "CP: 57170" del validador entraba como numero interior).
// El lookahead pregunta por las etiquetas CONOCIDAS, no por "algo con dos
// puntos": un valor puede llevarlos ("CALLE LOCAL: 5") y ese domicilio no se
// puede perder.
const RE_VALOR_EN_LA_LINEA_DE_ABAJO = new RegExp(
  ':[ \\t]*\\n[ \\t]*(?!(?:' + ETIQUETAS.concat(ETIQUETAS_ESTRICTAS).join('|') + ')[ \\t]*:)',
  'gi');

function normalizarLineas(texto) {
  return texto
    .replace(RE_ETIQUETAS, (m, general, estricta) => `\n${general || estricta}: `)
    .replace(RE_VALOR_EN_LA_LINEA_DE_ABAJO, ': ');
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
  const m = texto.match(/Actividades\s*Econ[oó]micas\s*:[ \t]*([^\n]*)/i);
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
  const m = texto.match(/Fecha\s*de\s*emisi[oó]n\s*:[ \t]*(?:de[ \t]*este[ \t]*documento[ \t]*)?:?[ \t]*(?:A[ \t]+)?([^\n]*)/i);
  return m ? m[1].trim() : '';
}

export function parsearCSF(textoCrudo) {
  const texto = normalizarLineas(textoCrudo);
  const get = (regex) => {
    const m = texto.match(regex);
    return m ? m[1].trim() : '';
  };

  // El separador entre la etiqueta y su valor es SIEMPRE [ \t]*, nunca \s*
  // (issue #349). El dano solo lo hace \s* cuando la captura es texto libre
  // ([^\n]*): con el campo presente y VACIO el \s* goloso se come el \n y el
  // grupo se lleva la etiqueta de abajo con su valor -- asi llego "Nombre de la
  // Co" al suite_number de dos clientes. Donde la captura es de forma estricta
  // (\d{5}, \d{3}, el patron del RFC) el \s* nunca pudo capturar una etiqueta;
  // ahi [ \t]* va por uniformidad, y es seguro porque normalizarLineas ya dejo
  // cada valor pegado a su etiqueta en la misma linea. Por lo mismo el grupo
  // cierra con * y no con +: un campo vacio debe dar '' ahi mismo, no hacer que
  // el match salte a una aparicion posterior de la misma etiqueta.
  const rfc = get(/R\.?F\.?C\.?[ \t]*:?[ \t]*([A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3})/i);

  const razonSocial = (() => {
    const pm = get(/(?:Denominaci[oó]n\s*\/?\s*)?Raz[oó]n\s*Social\s*:[ \t]*([^\n]*?)(?=\n|R\.?F\.?C)/i);
    if (pm) return pm.trim();
    const nombre = get(/Nombre\s*(?:\(s\))?\s*:[ \t]*([A-ZÁÉÍÓÚÑ ]*?)(?=\n)/i);
    const ap1 = get(/(?:Primer\s*Apellido|Apellido\s*Paterno)\s*:[ \t]*([A-ZÁÉÍÓÚÑ ]*?)(?=\n)/i);
    const ap2 = get(/(?:Segundo\s*Apellido|Apellido\s*Materno)\s*:[ \t]*([A-ZÁÉÍÓÚÑ ]*?)(?=\n)/i);
    return [nombre, ap1, ap2].filter(Boolean).join(' ').trim();
  })();

  const idcif = get(/idCIF\s*:[ \t]*(\d+)/i);
  // La variante corta del validador exige empezar palabra Y dos puntos: "CP"
  // suelto se cuela dentro de una colonia ("RINCONADA ACP12345" daba cp 12345).
  const cp = get(/(?:C[oó]digo\s*Postal[ \t]*:?|(?<![A-Za-z0-9ÁÉÍÓÚÑáéíóúñ])CP[ \t]*:)[ \t]*(\d{5})/i);
  const calle = get(/Nombre\s*de\s*(?:la\s*)?Vialidad\s*:[ \t]*([^\n]*)/i);
  const numExt = get(/N[uú]mero\s*Exterior\s*:[ \t]*([^\n]*)/i);
  const numInt = get(/N[uú]mero\s*Interior\s*:[ \t]*([^\n]*)/i);
  const colonia = get(/(?:Nombre\s*de\s*la\s*)?Colonia\s*:[ \t]*([^\n]*)/i);
  const municipio = get(/(?:Nombre\s*del\s*Municipio[^\n:]*|Municipio\s*o\s*delegaci[oó]n)\s*:[ \t]*([^\n]*)/i);
  const estado = get(/(?:Nombre\s*de\s*la\s*)?Entidad\s*Federativa\s*:[ \t]*([^\n]*)/i);

  const regimenFiscal = (() => {
    const m = texto.match(/R[eé]gimen\s*Fiscal\s*:[ \t]*(\d{3})/i);
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
