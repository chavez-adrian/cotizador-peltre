import XLSX from 'xlsx';
import { validarTelefono } from '../public/js/alta-logica.js';
import { ultimos10 } from './prospectos-store.js';

// Parser puro de la importacion de prospectos de Feria/Expo (issue #47,
// CONTEXT.md "Captura de prospecto"): la plataforma del evento entrega un
// XLSX de gafetes escaneados (hoja "Contactos"; el issue decia CSV pero el
// export real de Abastur es XLSX). No toca el store: devuelve las filas
// listas para crear y las descartadas con motivo; la deduplicacion contra
// prospectos existentes y clientes Operam vive en la ruta.

const SIN_DEFINIR = 'sin definir por el usuario';

// Rankings de la lectora de gafetes -> temperatura de la captura (1-5).
const TEMPERATURAS = { cold: 1, warm: 2, medium: 3, hot: 5 };

// El literal "Sin definir por el usuario" aparece en cualquier campo del
// export y equivale a vacio.
function limpiar(valor) {
  const v = valor === undefined || valor === null ? '' : String(valor).trim();
  return v.toLowerCase() === SIN_DEFINIR ? '' : v;
}

// Telefono del export: numero (525512952080) o vacio. Mismo gate que el resto
// del sistema: el resultado se valida con validarTelefono de alta-logica.
export function normalizarCelularFeria(valor) {
  const digitos = limpiar(valor).replace(/\D/g, '');
  if (!digitos) return '';
  if (digitos.length === 12 && digitos.startsWith('52')) return '+52 ' + digitos.slice(-10);
  if (digitos.length === 10) return '+52 ' + digitos;
  return '+' + digitos;
}

function sinAcentos(v) {
  return limpiar(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Dispositivo = nombre de quien escaneo el gafete en el stand. Si matchea a
// un vendedor (nombre completo o primer nombre, sin distinguir mayusculas ni
// acentos) la fila se asigna a el; primer nombre ambiguo no matchea.
export function matchVendedorDispositivo(dispositivo, vendedores) {
  const d = sinAcentos(dispositivo);
  if (!d) return null;
  const lista = vendedores || [];
  const completo = lista.find(v => sinAcentos(v.name) === d);
  if (completo) return completo.name;
  const porPrimerNombre = lista.filter(v => sinAcentos(v.name).split(' ')[0] === d);
  return porPrimerNombre.length === 1 ? porPrimerNombre[0].name : null;
}

export function importarProspectosFeria(buffer, { vendedores = [], vendedorDefault } = {}) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const hoja = wb.Sheets['Contactos'];
  if (!hoja) throw new Error('El archivo no tiene hoja "Contactos"');
  const filas = XLSX.utils.sheet_to_json(hoja, { header: 1 });
  const headers = (filas[0] || []).map(h => String(h || '').trim());
  const idx = {
    dispositivo: headers.indexOf('Dispositivo'),
    fechaHora: headers.indexOf('Fecha/Hora'),
    nombre: headers.indexOf('Nombre'),
    apellido: headers.indexOf('Apellido Paterno'),
    empresa: headers.indexOf('Empresa'),
    puesto: headers.indexOf('Puesto'),
    correo: headers.indexOf('Correo electronico'),
    telefono: headers.indexOf('Telefono'),
    rankings: headers.indexOf('Rankings'),
    ciudad: headers.indexOf('Ciudad'),
    estado: headers.indexOf('Estado'),
    comentarios: headers.indexOf('Comentarios'),
  };
  const listos = [];
  const descartados = [];
  const vistos = new Set();
  for (let i = 1; i < filas.length; i++) {
    const row = filas[i] || [];
    if (row.every(c => limpiar(c) === '')) continue;
    const fila = i + 1; // numero de fila en el spreadsheet (encabezados = 1)
    const nombre = [limpiar(row[idx.nombre]), limpiar(row[idx.apellido])].filter(Boolean).join(' ');
    const celular = normalizarCelularFeria(row[idx.telefono]);
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
    // La Fecha/Hora del escaneo se conserva en data.escaneado; la fecha del
    // prospecto es el momento de la importacion y la pone la ruta (si no, toda
    // la cola naceria con las horas habiles vencidas).
    const data = { escaneado: limpiar(row[idx.fechaHora]) };
    const empresa = limpiar(row[idx.empresa]);
    if (empresa) data.empresa = empresa;
    const correo = limpiar(row[idx.correo]);
    if (correo) data.correo = correo;
    const temperatura = TEMPERATURAS[limpiar(row[idx.rankings]).toLowerCase()];
    if (temperatura) data.temperatura = temperatura;
    const notas = [limpiar(row[idx.puesto]), limpiar(row[idx.comentarios])].filter(Boolean).join(' - ');
    if (notas) data.notas = notas;
    listos.push({
      fila,
      celular,
      nombre,
      ciudad: limpiar(row[idx.ciudad]) || limpiar(row[idx.estado]) || '',
      canal: 'Feria/Expo',
      vendedor: matchVendedorDispositivo(row[idx.dispositivo], vendedores) || vendedorDefault,
      data,
    });
  }
  return { listos, descartados };
}
