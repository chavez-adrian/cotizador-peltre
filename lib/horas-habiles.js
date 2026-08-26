// Reloj de horas habiles del dominio (CONTEXT.md, Horas habiles): L-V 10:00-18:00,
// sabado 10:00-14:00, domingos y festivos mexicanos excluidos.
//
// Zona horaria: el horario habil se evalua SIEMPRE en America/Mexico_City, no en
// el tz del servidor (Render corre en UTC; los vendedores estan en CDMX). Mexico
// elimino el horario de verano en 2022, asi que CDMX es UTC-6 fijo, pero usamos
// Intl con el timeZone explicito para no depender de ese supuesto: cada instante
// se proyecta a su hora de pared en CDMX y toda la aritmetica ocurre ahi.

const MS_HORA = 60 * 60 * 1000;
const MS_DIA = 24 * MS_HORA;

// Festivos oficiales mexicanos -- lista estatica por anio, mantenible. Los lunes
// moviles (Constitucion, Natalicio de Juarez, Revolucion) ya estan resueltos a
// fecha concreta. Agregar el anio siguiente aqui cuando toque.
export const FESTIVOS = [
  // 2026
  '2026-01-01', // Anio Nuevo
  '2026-02-02', // Dia de la Constitucion (primer lunes de febrero)
  '2026-03-16', // Natalicio de Benito Juarez (tercer lunes de marzo)
  '2026-05-01', // Dia del Trabajo
  '2026-09-16', // Independencia
  '2026-11-16', // Revolucion Mexicana (tercer lunes de noviembre)
  '2026-12-25', // Navidad
  // 2027
  '2027-01-01',
  '2027-02-01',
  '2027-03-15',
  '2027-05-01',
  '2027-09-16',
  '2027-11-15',
  '2027-12-25',
];

const FESTIVOS_SET = new Set(FESTIVOS);

const fmtCdmx = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Mexico_City',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hourCycle: 'h23',
});

// Proyecta un instante a su hora de pared en CDMX, expresada como ms UTC del
// mismo reloj de pared. En ese espacio la aritmetica de dias es exacta.
function paredCdmx(instante) {
  const partes = {};
  for (const p of fmtCdmx.formatToParts(new Date(instante))) partes[p.type] = p.value;
  return Date.UTC(+partes.year, +partes.month - 1, +partes.day, +partes.hour, +partes.minute, +partes.second);
}

// Ventana habil de un dia (inicio de dia en espacio de pared): [apertura, cierre]
// en horas, o null si el dia no es habil.
function ventanaDia(inicioDia) {
  const d = new Date(inicioDia);
  if (FESTIVOS_SET.has(d.toISOString().slice(0, 10))) return null;
  const dow = d.getUTCDay();
  if (dow === 0) return null;
  if (dow === 6) return { abre: 10, cierra: 14 };
  return { abre: 10, cierra: 18 };
}

export function horasHabilesEntre(desde, hasta) {
  const a = paredCdmx(desde);
  const b = paredCdmx(hasta);
  if (b <= a) return 0;
  let total = 0;
  const primerDia = Math.floor(a / MS_DIA) * MS_DIA;
  for (let dia = primerDia; dia < b; dia += MS_DIA) {
    const v = ventanaDia(dia);
    if (!v) continue;
    const ini = Math.max(a, dia + v.abre * MS_HORA);
    const fin = Math.min(b, dia + v.cierra * MS_HORA);
    if (fin > ini) total += (fin - ini) / MS_HORA;
  }
  return total;
}

// Primer dia habil DESPUES de una fecha (issue #263, spec #260): de aqui sale la
// fecha prellenada del siguiente contacto al cerrar una feria ("el lunes te
// escribo"). Recibe y devuelve dia natural 'YYYY-MM-DD' -- es una fecha de
// calendario, no un instante, asi que la aritmetica va en UTC puro y nunca toca
// la hora de pared. Aqui "dia habil" es dia de OFICINA: L-V sin festivos. El
// sabado corto de la ventana de espera (ventanaDia) no cuenta para agendar un
// compromiso; el spec lo fija con "viernes -> lunes". Fecha invalida: null.
export function primerDiaHabilDespues(fecha) {
  const dia = String(fecha == null ? '' : fecha).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return null;
  let t = Date.parse(`${dia}T00:00:00Z`);
  if (isNaN(t)) return null;
  // Tope defensivo: ninguna racha de festivos y fines de semana llega a 14 dias.
  for (let i = 0; i < 14; i++) {
    t += MS_DIA;
    const d = new Date(t);
    const iso = d.toISOString().slice(0, 10);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6 && !FESTIVOS_SET.has(iso)) return iso;
  }
  return null;
}
