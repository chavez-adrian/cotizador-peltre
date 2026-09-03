// EL titulador del repo (issue #293): la UNICA regla "texto gritado -> Titulo".
// Antes vivian tres, cada una con su tabla y sus huecos: normalizarNombreFiscal
// (#241, razon social del SAT), capitalizarCampo (#235/#269, captura de
// prospecto) y titular (importador del export de feria, palabra por palabra).
// La empresa de 98 prospectos de Abastur se guardo gritando porque el importador
// solo titulaba el nombre: con una sola regla eso ya no se puede repetir.
//
// Vive en public/js porque lib/ y server.js SI pueden importar de aqui y no al
// reves (mismo patron que alta-logica.js / prospectos-logica.js). Lo consumen la
// Referencia del cliente (lib/referencia-cliente.js), el Contacto de Google
// (lib/contactos-logica.js), la captura de prospecto (prospectos-logica.js,
// mayoreo-logica.js) y el importador (lib/importar-prospectos.js).
//
// Las reglas son las de #241 mas las dos que aportaba #269: la guarda de
// intencion (abajo) y la lista fija de siglas no societarias.

// Preposiciones y conjunciones: minusculas dentro del nombre, salvo al inicio.
const ENLACES = new Set(['de', 'del', 'y', 'e', 'o', 'a', 'en', 'al', 'por', 'con', 'sin', 'para']);

// Los articulos son ambiguos: en "HOTELES DE LA COSTA" el articulo es parte del
// complemento y va bajo ("de la Costa"), pero en "COMERCIALIZADORA EL PENDULO"
// encabeza el nombre de la marca y va alto ("El Pendulo"). Se decide por lo que
// tiene delante: articulo pegado a un enlace va bajo, si no va alto.
const ARTICULOS = new Set(['el', 'la', 'los', 'las']);

// Siglas que nunca son palabras: las de forma societaria mexicana (sin esto "EL
// PENDULO SA DE CV" se leeria "El Pendulo Sa de Cv") mas la lista fija que
// aporto #269 -- CDMX y las paqueterias con las que opera el cotizador.
const SIGLAS = new Set([
  'SA', 'CV', 'SAPI', 'SC', 'AC', 'RL', 'SRL', 'SAS',
  'CDMX', 'FEDEX', 'DHL', 'UPS',
]);

// Igual con puntos: "S.A." o "C.V." Se compara sin puntos contra SIGLAS.
function esSigla(palabra) {
  const limpia = palabra.replace(/\./g, '');
  return limpia.length > 0 && SIGLAS.has(limpia.toUpperCase());
}

// Numeros romanos bien formados ("EL FOGON III", "JUAN PABLO II"): van en
// mayusculas, no en Title Case. Se exigen tres letras o mas -- mas el "II", que si
// aparece en nombres comerciales -- porque varias palabras espanolas de dos letras
// tambien se leen como romanos ("MI" = 1001, "DI" = 501) y ahi manda el espanol.
const ROMANO = /^M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/;
// "MIX" es romano valido (1009) y a la vez palabra: gana la palabra.
const FALSOS_ROMANOS = new Set(['MIX']);
function esRomano(palabra) {
  const limpia = palabra.replace(/\./g, '').toUpperCase();
  if (!limpia || FALSOS_ROMANOS.has(limpia) || !ROMANO.test(limpia)) return false;
  return limpia.length >= 3 || limpia === 'II';
}

// Regla de respaldo para el Contacto de Google (#247): la razon social solo
// registra siglas de forma societaria (SA, CV...), pero un nombre de PERSONA
// puede traer una sigla comercial que no esta en esa lista ("MAG IMPRESIONES").
// Sin una lista cerrada de siglas de persona, el respaldo es posicional: un
// token de 3 letras o menos (sin contar puntos) que no sea preposicion ni
// articulo se deja tal cual en vez de arriesgarse a destrozarlo en Titulo. Es
// deliberadamente activada solo con { siglasCortas: true } -- la razon social
// no la usa, para no repetir el efecto secundario que ya prueba "MIX es
// palabra, no el romano 1009" (un token de 3 letras que SI es palabra).
function esSiglaCorta(palabra) {
  const limpia = palabra.replace(/\./g, '');
  if (!limpia || limpia.length > 3) return false;
  const baja = limpia.toLowerCase();
  return !ENLACES.has(baja) && !ARTICULOS.has(baja);
}

// Un token con digito o con un simbolo que no sea de nombre propio ("3M", "I+D")
// es una sigla o una marca tecnica, no una palabra: se respeta en mayusculas. En
// Title Case salia destrozado ("3m", "I+d"), porque capitalizar el PRIMER caracter
// no hace nada cuando ese caracter es un digito.
const TOKEN_TECNICO = /[0-9]/u;
const SIMBOLO_RARO = /[^\p{L}\-'.]/u;
// Tras guion o apostrofe sigue nombre propio, no palabra nueva: "COCA-COLA" ->
// "Coca-Cola", "O'BRIEN" -> "O'Brien".
function capitalizar(palabra) {
  if (TOKEN_TECNICO.test(palabra) || SIMBOLO_RARO.test(palabra)) return palabra.toUpperCase();
  return palabra.toLowerCase().replace(/(^|[-'])(\p{L})/gu, (_, sep, letra) => sep + letra.toUpperCase());
}

function empiezaEnAlta(token) {
  const letra = token.match(/\p{L}/u);
  return !!letra && letra[0] === letra[0].toUpperCase() && letra[0] !== letra[0].toLowerCase();
}

// Guarda de intencion (#247, ampliada en #293 con el contraste de #269): un
// campo YA escrito con mayusculas y minusculas es de quien lo escribio y no se
// toca -- "McDonald's", "Hotel La Joya", "Grupo GNP", "BGE Esquivel". Sin esta
// guarda la regla de #241 los destrozaba ("Mcdonald'S", "Grupo Gnp").
//
// La senal de intencion es que TODA palabra con letras empiece en mayuscula y
// que el campo no venga entero en mayusculas (eso ultimo es grito del SAT o del
// export de feria, no intencion). Un campo entero en minusculas o tecleado a
// dedazos ("jUaN pErEz") tampoco trae senal y se corrige: es la tabla de #235,
// donde el vendedor teclea de corrido en el celular.
function escritoConIntencion(texto) {
  if (texto === texto.toUpperCase()) return false;
  const conLetras = texto.split(' ').filter(t => /\p{L}/u.test(t));
  return conLetras.length > 0 && conLetras.every(empiezaEnAlta);
}

// Texto gritado -> forma legible. Devuelve siempre una cadena (vacia para nulo,
// indefinido o puros espacios) y colapsa los espacios de sobra: lo guarda el
// prospecto y lo lee el ERP, y " JUAN  PEREZ " no es un nombre distinto.
//
// { siglasCortas: true } lo activa el consumidor que sabe que su campo puede
// traer siglas comerciales cortas (ver esSiglaCorta).
export function aTitulo(valor, { siglasCortas = false } = {}) {
  const texto = String(valor == null ? '' : valor).trim().replace(/\s+/g, ' ');
  if (!texto) return '';
  if (escritoConIntencion(texto)) return texto;
  const palabras = texto.split(' ');
  const salida = [];
  for (let i = 0; i < palabras.length; i++) {
    const palabra = palabras[i];
    if (esSigla(palabra) || esRomano(palabra) || (siglasCortas && esSiglaCorta(palabra))) {
      salida.push(palabra.toUpperCase()); continue;
    }
    const baja = palabra.toLowerCase();
    const alta = capitalizar(palabra);
    if (i === 0) { salida.push(alta); continue; }
    if (ENLACES.has(baja)) { salida.push(baja); continue; }
    if (ARTICULOS.has(baja)) {
      const anterior = palabras[i - 1].toLowerCase();
      salida.push(ENLACES.has(anterior) ? baja : alta);
      continue;
    }
    salida.push(alta);
  }
  return salida.join(' ');
}
