// Catalogo c_RegimenFiscal del SAT (Anexo 20 v4.0) como nucleo puro compartido
// (issue #191). Vivia solo dentro de lib/parsear-csf.js, sin exportar y sin copia
// del lado del navegador: el regimen se capturaba como texto libre y nadie validaba
// el codigo, asi que un "6O1" con letra O viajaba literal al POST/PUT de Operam.
// Un modulo, dos consumidores (lib/parsear-csf.js para mapear la descripcion de la
// Constancia a su codigo, app.js para pintar el selector), cero copias -- el mismo
// patron con el que server.js cross-importa alta-logica.js.
//
// `fisica` / `moral` son las dos columnas de aplicabilidad del propio catalogo del
// SAT. Se usan para filtrar el selector por el tipo de RFC ya capturado, que es lo
// que evita ofrecerle "General de Ley Personas Morales" a una persona fisica.
// 609 (Consolidacion) queda fuera a proposito: tiene fecha fin de vigencia.
export const CATALOGO_REGIMENES = [
  { codigo: '601', descripcion: 'General de Ley Personas Morales', fisica: false, moral: true },
  { codigo: '603', descripcion: 'Personas Morales con Fines no Lucrativos', fisica: false, moral: true },
  { codigo: '605', descripcion: 'Sueldos y Salarios e Ingresos Asimilados a Salarios', fisica: true, moral: false },
  { codigo: '606', descripcion: 'Arrendamiento', fisica: true, moral: false },
  { codigo: '607', descripcion: 'Regimen de Enajenacion o Adquisicion de Bienes', fisica: true, moral: false },
  { codigo: '608', descripcion: 'Demas ingresos', fisica: true, moral: false },
  { codigo: '610', descripcion: 'Residentes en el Extranjero sin Establecimiento Permanente en Mexico', fisica: true, moral: true },
  { codigo: '611', descripcion: 'Ingresos por Dividendos (socios y accionistas)', fisica: true, moral: false },
  { codigo: '612', descripcion: 'Personas Fisicas con Actividades Empresariales y Profesionales', fisica: true, moral: false },
  { codigo: '614', descripcion: 'Ingresos por intereses', fisica: true, moral: false },
  { codigo: '615', descripcion: 'Regimen de los ingresos por obtencion de premios', fisica: true, moral: false },
  { codigo: '616', descripcion: 'Sin obligaciones fiscales', fisica: true, moral: false },
  { codigo: '620', descripcion: 'Sociedades Cooperativas de Produccion que optan por diferir sus ingresos', fisica: false, moral: true },
  { codigo: '621', descripcion: 'Incorporacion Fiscal', fisica: true, moral: false },
  { codigo: '622', descripcion: 'Actividades Agricolas, Ganaderas, Silvicolas y Pesqueras', fisica: false, moral: true },
  { codigo: '623', descripcion: 'Opcional para Grupos de Sociedades', fisica: false, moral: true },
  { codigo: '624', descripcion: 'Coordinados', fisica: false, moral: true },
  { codigo: '625', descripcion: 'Regimen de las Actividades Empresariales con ingresos a traves de Plataformas Tecnologicas', fisica: true, moral: false },
  { codigo: '626', descripcion: 'Regimen Simplificado de Confianza', fisica: true, moral: true },
  { codigo: '628', descripcion: 'Hidrocarburos', fisica: false, moral: true },
  { codigo: '629', descripcion: 'De los Regimenes Fiscales Preferentes y de las Empresas Multinacionales', fisica: true, moral: false },
  { codigo: '630', descripcion: 'Enajenacion de acciones en bolsa de valores', fisica: true, moral: false },
];

export function labelRegimen(codigo) {
  const fila = CATALOGO_REGIMENES.find(r => r.codigo === codigo);
  return fila ? fila.descripcion : '';
}

export function esRegimenValido(codigo) {
  return CATALOGO_REGIMENES.some(r => r.codigo === String(codigo || '').trim());
}

// La longitud del RFC es la unica senal disponible en el formulario: 12 = moral,
// 13 = fisica. Un RFC vacio o a medio teclear no decide nada (null) -- ahi el
// selector ofrece el catalogo completo en vez de adivinar.
// La clase incluye la enye (u00D1) escapada: el codigo fuente se mantiene en
// ASCII estricto (CLAUDE.md).
const RE_RFC_MX = /^[A-Z&\u00D1]{3,4}\d{6}[A-Z0-9]{3}$/;

export function tipoPersonaRfc(rfc) {
  const limpio = String(rfc || '').trim().toUpperCase();
  if (!RE_RFC_MX.test(limpio)) return null;
  return limpio.length === 12 ? 'moral' : 'fisica';
}

// Filtra por el tipo de persona del RFC ya capturado. `seleccionado` nunca se cae
// de la lista: si el parser de la CSF extrajo un regimen que el filtro excluye (RFC
// y regimen en desacuerdo), quitarlo del <select> borraria en silencio un dato real
// -- se conserva y que el vendedor decida. Un codigo fuera del catalogo si se
// descarta: es justo lo que este selector viene a impedir.
export function regimenesParaRfc(rfc, seleccionado) {
  const tipo = tipoPersonaRfc(rfc);
  if (!tipo) return [...CATALOGO_REGIMENES];
  const elegido = String(seleccionado || '').trim();
  return CATALOGO_REGIMENES.filter(r => r[tipo] || r.codigo === elegido);
}

// Las opciones muestran codigo Y descripcion: el pedido de Adrian era exactamente
// que nadie tenga que recordar los regimenes por codigo. La primera opcion vacia
// mantiene el campo opcional en la pestana CSF (donde el parser lo autollena).
//
// `seleccionado` solo sirve para que un valor ya capturado no se caiga de la lista
// al filtrar; NINGUNA opcion sale con el atributo `selected`. Marcarlo romperia el
// borrador de formulario (#185), que decide "esto es captura o es el default" con
// option[selected]: lo capturado pasaria por default y no se guardaria. Quien
// repuebla el <select> le pone el valor por JS despues (altaPoblarRegimen).
export function opcionesRegimenHtml(rfc, seleccionado) {
  const elegido = String(seleccionado || '').trim();
  return '<option value="">-- Selecciona --</option>' +
    regimenesParaRfc(rfc, elegido).map(r =>
      `<option value="${r.codigo}">${r.codigo} - ${r.descripcion}</option>`
    ).join('');
}
