import XLSX from 'xlsx';
import { validarTelefono } from '../public/js/alta-logica.js';
import { segmentoDeTipo, normalizarTextosProspecto } from '../public/js/prospectos-logica.js';
import { ultimos10 } from './telefono-llave.js';

// Parser puro del export real del evento (issue #265, CONTEXT.md "Importacion
// del export del evento"): la plataforma de Abastur entrega un XLSX con la hoja
// "Contacts" (la segunda, "incl. duplicates", se ignora) y las columnas que se
// listan en COLUMNAS. No toca el store: devuelve las filas listas para cruzar,
// los gafetes sin celular, las descartadas con motivo y los avisos de forma
// del archivo (columnas esperadas que no aparecieron, actividades sin mapeo);
// el cruce contra prospectos existentes y clientes Operam vive en la ruta,
// porque ahi es donde enriquecer o crear es una decision con IO.

const HOJA = 'Contacts';

// Un campo puede traer mas de una cabecera aceptada (issue #277: la edicion de
// evento cambia el nombre de columna de una edicion a otra); indicesDeCabeceras
// usa la primera que este presente en el archivo.
const COLUMNAS = {
  nombre: 'First name',
  apellido: 'Last name',
  jobTitle: 'Job title',
  empresa: 'Company',
  correo: 'Email',
  celular: 'Mobile phone',
  ciudad: 'City',
  estado: 'State',
  actividad: 'Actividad principal de la empresa (es)',
  puesto: ['Puesto (es)', 'Cargo (es)'],
  tamano: 'Tamaño de la empresa (es)',
  decision: ['Decisión de compra (es)', 'En una toma de decisión (es)'],
  areaInteres: 'Selecciona tu área de interés (es)',
  scoring: 'Scoring',
  nota: 'Note',
  expositor: 'Exhibitor member (first connection)',
  fecha: 'First connection date',
};

// Actividad principal declarada por el asistente en la app del evento -> tipo de
// cliente del catalogo cerrado (CONTEXT.md "Tipo de cliente"). Lo que no esta en
// la tabla cae en "Otro" conservando el texto original: el catalogo es cerrado
// pero la respuesta del asistente no se pierde.
const ACTIVIDAD_A_TIPO = {
  'restaurante': 'Restaurantes',
  'hotel': 'Hoteles',
  'cafeteria': 'Cafeterías',
  'distribuidor': 'Distribuidores',
  'proveedor': 'Distribuidores',
  'distribuidor/proveedor': 'Distribuidores',
  'catering': 'Catering | Eventos',
  'catering/organizador de eventos': 'Catering | Eventos',
  'catering/banquetes': 'Catering | Eventos',
  'pasteleria/panaderia': 'Cafeterías',
};

function limpiar(valor) {
  if (valor === undefined || valor === null) return '';
  return String(valor).trim();
}

function sinAcentos(v) {
  return limpiar(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Llave de comparacion de textos del export: sin acentos, sin dobles espacios y
// sin los espacios alrededor de la diagonal ("Distribuidor / Proveedor" y
// "Distribuidor/Proveedor" son la misma respuesta).
function llaveTexto(v) {
  return sinAcentos(v).replace(/\s+/g, ' ').replace(/\s*\/\s*/g, '/').trim();
}

// Celular del export: llega con lada y espacios ("+52 55 1242 1575"), pegado
// ("525512421575") o nacional a secas ("5512421575"). Mismo gate que el resto
// del sistema: el resultado lo valida validarTelefono de alta-logica.
export function normalizarCelularFeria(valor) {
  const digitos = limpiar(valor).replace(/\D/g, '');
  if (!digitos) return '';
  if (digitos.length === 12 && digitos.startsWith('52')) return '+52 ' + digitos.slice(-10);
  if (digitos.length === 10) return '+52 ' + digitos;
  return '+' + digitos;
}

// La fecha del primer contacto viaja como serial de Excel (dias desde
// 1899-12-30, la parte decimal es la hora). Sin zona horaria en el archivo, se
// lee como UTC. Un valor que no sea serial (algunos exports mandan texto) se
// devuelve tal cual: es mejor guardar la cadena original que inventar una fecha.
export function fechaDeSerialExcel(valor) {
  if (valor instanceof Date) return valor.toISOString();
  const texto = limpiar(valor);
  if (!texto) return '';
  const serial = Number(texto);
  if (!Number.isFinite(serial) || serial <= 0) return texto;
  const dias = Math.floor(serial);
  const segundos = Math.round((serial - dias) * 86400);
  return new Date(Date.UTC(1899, 11, 30) + dias * 86400000 + segundos * 1000).toISOString();
}

// El export llega TODO en MAYUSCULAS y de ahi pasa a la libreta de WhatsApp.
// La regla de capitalizacion es la de la casa ("venga de donde venga la
// captura", #235/#269), y desde #293 esa regla es UNA SOLA en todo el repo:
// aTitulo (public/js/titulo-logica.js), que aqui se aplica por
// normalizarTextosProspecto. Antes vivia aqui una funcion `titular` propia y
// mas pobre -- sin particulas ("Los Antojos DEL Gordo") ni siglas fijas ("Sa De
// Cv") -- y ademas solo se aplicaba al nombre de la persona, asi que la empresa
// y la ciudad se guardaban como venian del gafete.

// "Exhibitor member (first connection)" = quien escaneo el gafete en el stand.
// Si matchea a un vendedor (nombre completo o primer nombre, sin distinguir
// mayusculas ni acentos) la fila se asigna a el; primer nombre ambiguo no
// matchea y la fila cae al vendedor default del formulario.
export function matchVendedorExpositor(expositor, vendedores) {
  const e = llaveTexto(expositor);
  if (!e) return null;
  const lista = vendedores || [];
  const completo = lista.find(v => llaveTexto(v.name) === e);
  if (completo) return completo.name;
  const porPrimerNombre = lista.filter(v => llaveTexto(v.name).split(' ')[0] === e);
  return porPrimerNombre.length === 1 ? porPrimerNombre[0].name : null;
}

// El export 2026 separa las dos actividades compuestas con guion en vez de
// diagonal ("Distribuidor - Proveedor"); llaveTexto NO se toca porque la
// comparten matchVendedorExpositor e indicesDeCabeceras y su contrato es sobre
// la diagonal. Esta normalizacion queda LOCAL al camino de la actividad.
function llaveActividad(v) {
  return llaveTexto(v).replace(/\s*-\s*/g, '/');
}

function tipoClienteDeActividad(actividad) {
  const texto = limpiar(actividad);
  if (!texto) return null;
  const tipo = ACTIVIDAD_A_TIPO[llaveActividad(texto)];
  if (tipo) return { tipo_cliente: tipo, segmento_id: segmentoDeTipo(tipo) };
  return { tipo_cliente: 'Otro', tipo_cliente_otro: texto, segmento_id: segmentoDeTipo('Otro') };
}

// Scoring de la app del evento (1-5) -> temperatura del prospecto, que ya es esa
// misma escala. Fuera de rango o vacio no manda: la temperatura se queda sin
// poner en vez de inventarse.
function temperaturaDeScoring(scoring) {
  const n = Number(limpiar(scoring));
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : undefined;
}

// Puesto, tamano de empresa, decision de compra y area de interes son las
// senales de calificacion del cuestionario del evento. Van por DOS caminos a la
// vez desde las MISMAS senales (senalesDeCalificacion, un solo punto de
// decision): como campos propios de data, que es lo unico filtrable y
// ordenable, y como UNA linea de notas debajo de la nota del vendedor.
// La linea de notas NO se puede tocar: la idempotencia de #277 compara la nota
// entrante contra la guardada, y cambiar su forma haria que re-subir el archivo
// duplicara la nota en cada prospecto ya importado.
function senalesDeCalificacion(campo) {
  return {
    puesto: campo('puesto') || campo('jobTitle'),
    tamano: campo('tamano'),
    decision: campo('decision'),
    area_interes: campo('areaInteres'),
  };
}

function lineaCalificacion(senales) {
  return [
    ['Puesto', senales.puesto],
    ['Tamaño de empresa', senales.tamano],
    ['Decisión de compra', senales.decision],
    ['Área de interés', senales.area_interes],
  ].filter(([, v]) => v).map(([etiqueta, v]) => `${etiqueta}: ${v}`).join(' | ');
}

function indicesDeCabeceras(headers) {
  const porLlave = new Map();
  headers.forEach((h, i) => {
    const llave = llaveTexto(h);
    if (llave && !porLlave.has(llave)) porLlave.set(llave, i);
  });
  const idx = {};
  for (const [campo, cabecera] of Object.entries(COLUMNAS)) {
    const opciones = Array.isArray(cabecera) ? cabecera : [cabecera];
    const i = opciones.map(o => porLlave.get(llaveTexto(o))).find(v => v !== undefined);
    idx[campo] = i === undefined ? -1 : i;
  }
  return idx;
}

// Etiqueta para el aviso de columna no encontrada: si el campo acepta varios
// alias, se listan todos (ninguno de los dos aparecio en el archivo).
function etiquetaColumna(cabecera) {
  return Array.isArray(cabecera) ? cabecera.join(' / ') : cabecera;
}

export function importarProspectosFeria(buffer, { vendedores = [], vendedorDefault, evento } = {}) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const hoja = wb.Sheets[HOJA];
  if (!hoja) throw new Error(`El archivo no tiene hoja "${HOJA}"`);
  const filas = XLSX.utils.sheet_to_json(hoja, { header: 1 });
  const idx = indicesDeCabeceras(filas[0] || []);
  // Avisos de forma del archivo (issue #277): columnas esperadas que no
  // aparecieron (con todos sus alias) y actividades que cayeron a "Otro" sin
  // mapeo, para que un cambio de edicion se note en vez de degradar en
  // silencio.
  const columnasNoEncontradas = Object.entries(COLUMNAS)
    .filter(([campo]) => idx[campo] === -1)
    .map(([, cabecera]) => etiquetaColumna(cabecera));
  const actividadesSinMapeo = new Map();
  const listos = [];
  const sinCelular = [];
  const descartados = [];
  const vistos = new Set();
  for (let i = 1; i < filas.length; i++) {
    const row = filas[i] || [];
    if (row.every(c => limpiar(c) === '')) continue;
    const fila = i + 1; // numero de fila en el spreadsheet (encabezados = 1)
    const campo = c => (idx[c] === -1 ? '' : limpiar(row[idx[c]]));
    const nombreCrudo = [campo('nombre'), campo('apellido')].filter(Boolean).join(' ');
    const correo = campo('correo');
    const empresa = campo('empresa');
    // La fecha del escaneo se conserva en data.escaneado; la fecha del prospecto
    // es el momento de la importacion y la pone la ruta (si no, toda la cola
    // naceria con las horas habiles vencidas).
    const data = { escaneado: fechaDeSerialExcel(idx.fecha === -1 ? '' : row[idx.fecha]) };
    if (evento) data.evento = evento;
    if (empresa) data.empresa = empresa;
    if (correo) data.correo = correo;
    const tipo = tipoClienteDeActividad(campo('actividad'));
    if (tipo) {
      Object.assign(data, tipo);
      if (tipo.tipo_cliente_otro) {
        actividadesSinMapeo.set(tipo.tipo_cliente_otro, (actividadesSinMapeo.get(tipo.tipo_cliente_otro) || 0) + 1);
      }
    }
    const temperatura = temperaturaDeScoring(campo('scoring'));
    if (temperatura !== undefined) data.temperatura = temperatura;
    const senales = senalesDeCalificacion(campo);
    const notas = [campo('nota'), lineaCalificacion(senales)].filter(Boolean).join('\n');
    if (notas) data.notas = notas;
    for (const [k, v] of Object.entries(senales)) if (v) data[k] = v;

    // La fila entera se guarda con la MISMA regla que la captura manual y la de
    // expo (issue #293): el importador titulaba solo el nombre con una funcion
    // propia y guardaba la empresa cruda, y asi nacieron 98 prospectos de
    // Abastur gritando en la libreta de WhatsApp. normalizarTextosProspecto es
    // el unico punto de la regla; aqui se aplica ANTES de decidir si la fila
    // nace, se enriquece o sale al reporte, para que los tres caminos guarden
    // el mismo texto.
    const { nombre, ciudad, data: datos } = normalizarTextosProspecto({
      nombre: nombreCrudo, ciudad: campo('ciudad') || campo('estado'), data,
    });

    const celularCrudo = campo('celular');
    if (!celularCrudo) {
      // Gafete sin celular: no nace como prospecto (invariante 1 celular = 1
      // prospecto). La ruta lo cruza por correo contra los prospectos del evento
      // y lo que no cruza sale en el reporte para perseguirlo a mano.
      if (!nombre && !correo) continue;
      sinCelular.push({
        fila, nombre, empresa: datos.empresa || '', correo: datos.correo || '',
        scoring: temperatura === undefined ? '' : temperatura, data: datos,
      });
      continue;
    }
    const celular = normalizarCelularFeria(celularCrudo);
    if (validarTelefono('', celular)) {
      descartados.push({ fila, nombre, motivo: 'telefono invalido' });
      continue;
    }
    if (!nombre) {
      descartados.push({ fila, nombre, motivo: 'sin nombre' });
      continue;
    }
    const llave = ultimos10(celular);
    if (vistos.has(llave)) {
      descartados.push({ fila, nombre, motivo: 'duplicado en archivo' });
      continue;
    }
    vistos.add(llave);
    // La fila sale por el MISMO punto que la captura manual
    // (normalizarTextosProspecto, arriba): nombre, empresa y ciudad
    // capitalizados y correo en minusculas, sin una segunda copia de la regla
    // aqui. Las llaves que no le tocan (fila, celular, canal, vendedor) viajan
    // como estan.
    listos.push({
      fila,
      celular,
      nombre,
      correo: datos.correo || '',
      ciudad,
      canal: 'Feria/Expo',
      vendedor: matchVendedorExpositor(campo('expositor'), vendedores) || vendedorDefault,
      data: datos,
    });
  }
  const avisos = {
    columnasNoEncontradas,
    actividadesSinMapeo: [...actividadesSinMapeo].map(([actividad, conteo]) => ({ actividad, filas: conteo })),
  };
  return { listos, sinCelular, descartados, avisos };
}
