// UNICA cadena de la "Referencia del cliente" (CONTEXT.md, #241): la referencia
// que el cliente da a la operacion -- proyecto, evento u orden de compra -- que
// nace en la cotizacion y se hereda al pedido y a la factura. La comparten el
// quote de Operam (cust_ref) y el documento del cliente (PDF/HTML, donde sale en
// el bloque del cliente Y en la tabla comercial): si cada consumidor arma la suya
// el ERP y el documento prometen cosas distintas.
//
// El orden lo fijo Adrian en #241 (antes, #108: referencia -> nombreCorto ->
// razonSocial -> nombreEntrega). trim() por escalon para que uno de solo espacios
// cuente como vacio.

// Limite del campo cust_ref del quote de Operam. Vive en el nucleo, no en el
// consumidor de Operam, para que el documento del cliente corte donde corta el
// ERP: con un escalon de fallback largo (razon social mexicana tipica) el quote
// truncaba y el PDF no, y los dos decian cosas distintas.
const LIMITE_CUST_REF_OPERAM = 60;

// Preposiciones y conjunciones: minusculas dentro del nombre, salvo al inicio.
const ENLACES = new Set(['de', 'del', 'y', 'e', 'o', 'a', 'en', 'al', 'por', 'con', 'sin', 'para']);

// Los articulos son ambiguos: en "HOTELES DE LA COSTA" el articulo es parte del
// complemento y va bajo ("de la Costa"), pero en "COMERCIALIZADORA EL PENDULO"
// encabeza el nombre de la marca y va alto ("El Pendulo"). Se decide por lo que
// tiene delante: articulo pegado a un enlace va bajo, si no va alto.
const ARTICULOS = new Set(['el', 'la', 'los', 'las']);

// Siglas de forma societaria: en un nombre fiscal mexicano son mayusculas, no
// palabras. Sin esto "EL PENDULO SA DE CV" se leeria "El Pendulo Sa de Cv".
const SIGLAS = new Set(['SA', 'CV', 'SAPI', 'SC', 'AC', 'RL', 'SRL', 'SAS']);

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

// Nombre fiscal (MAYUSCULAS del SAT) -> forma legible. Solo se aplica a la razon
// social: lo que el vendedor teclea es suyo y no se toca, y el nombre corto ya
// viene en mayusculas/minusculas normales por definicion (CONTEXT.md).
//
// Exportada para el Contacto de Google (#228), que necesita el MISMO escalon de
// respaldo (razon social legible) sin heredar el corte a 60 de Operam ni el
// resto de la cadena de la Referencia del cliente, que es otro concepto del
// glosario. Es una utileria de texto, no una segunda cadena de referencia.
export function normalizarNombreFiscal(texto) {
  const palabras = texto.split(/\s+/);
  const salida = [];
  for (let i = 0; i < palabras.length; i++) {
    const palabra = palabras[i];
    if (esSigla(palabra) || esRomano(palabra)) { salida.push(palabra.toUpperCase()); continue; }
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

export function referenciaDelCliente(cliente) {
  const c = cliente || {};
  const escalones = [
    { valor: c.referencia, normalizar: false },
    { valor: c.nombreCorto, normalizar: false },
    { valor: c.nombreEntrega, normalizar: false },
    { valor: c.razonSocial, normalizar: true },
  ];
  const elegido = escalones
    .map(e => ({ ...e, valor: (e.valor || '').trim() }))
    .find(e => e.valor);
  if (!elegido) return '';
  const texto = elegido.normalizar ? normalizarNombreFiscal(elegido.valor) : elegido.valor;
  return texto.slice(0, LIMITE_CUST_REF_OPERAM);
}
