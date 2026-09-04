import { reunionFuturaDe, reunionPendienteResultadoDe } from '../public/js/prospectos-logica.js';
import { partirPorCodigoPais, errorReglaNacional } from '../public/js/alta-logica.js';

const MS_DIA = 24 * 60 * 60 * 1000;

const PASOS = [
  { paso: 'vencida', minDias: 28 },
  { paso: 'dia21', minDias: 21 },
  { paso: 'dia7', minDias: 7 },
  { paso: 'dia2', minDias: 2 },
];

const ESTADOS_CERRADOS = new Set(['ganada', 'perdida', 'descartada']);

// Reja sobre el telefono ya compuesto. Dos capas: el piso de LARGO, que depende
// de si el numero ya viene en formato internacional (issue #175 -- con "+"
// bastan 8 digitos, porque hay paises con nacional de 7 como Aruba o los fijos
// de Panama; sin "+" se siguen exigiendo 11, ya que un numero pelon de 10 no
// dice de que pais es), y encima la regla NACIONAL del pais cuando su codigo
// esta en REGLAS_TELEFONO (issue #176). Esa segunda capa no es una verdad
// propia: es la misma tabla que aplica validarTelefono en el formulario, asi
// que un "+52" de 8 digitos vuelve a fallar aqui en vez de colarse por el piso
// internacional. De los paises que la tabla no conoce sigue sabiendo solo el
// largo -- el aviso fino de esos lo da el widget en el navegador, sin bloquear.
export function telefonoValido(telefono) {
  if (!telefono) return false;
  const tel = String(telefono).trim();
  const digitos = tel.replace(/\D/g, '');
  if (digitos.length > 15) return false;
  if (tel.startsWith('+') ? digitos.length < 8 : digitos.length < 11) return false;
  const partes = partirPorCodigoPais(digitos);
  return partes ? !errorReglaNacional(partes.dial, partes.nacional) : true;
}

// El "+" manda sobre la heuristica de largo (issue #175): un numero de 10 digitos
// se asumia mexicano, lo que convertia "+297 563 3917" en wa.me/522975633917 --
// numero mexicano valido, o sea mensaje a un desconocido. El prefijo 52 queda
// reservado para el nacional pelon, que es dato legacy. El piso de 8 no sobra:
// sin el, un "+123" pasaria a devolver "123" en vez del null de siempre.
export function telefonoWa(telefono) {
  if (!telefono) return null;
  const tel = String(telefono).trim();
  const crudos = tel.replace(/\D/g, '');
  // Los legacy mexicanos guardados traen el "1" de movil heredado (+52 1 55...)
  // y wa.me lo tomaba literal: el link salia a un numero que no existe (issue
  // #176). El dato en reposo no se toca -- se normaliza al consumirlo.
  const partes = partirPorCodigoPais(crudos);
  const digitos = partes && partes.dial === '52' ? `52${partes.nacional}` : crudos;
  if (tel.startsWith('+')) return digitos.length >= 8 ? digitos : null;
  if (digitos.length === 10) return `52${digitos}`;
  if (digitos.length >= 11) return digitos;
  return null;
}

// El paso de cadencia de UNA cotizacion (2/7/21/28, CONTEXT.md "Cola Hoy"),
// extraido de calcularCola en #319 porque la Tabla de prospectos necesita el
// MISMO paso para decir "Seguimiento a la N, dia X": dos vistas leyendo una
// sola escalera, nunca dos copias que puedan discrepar. `paso` es null
// mientras no toca ninguno (menos de 2 dias); `dias` va aparte porque la fila
// lo muestra tal cual.
export function pasoCadencia(cotizacion, hoy = new Date()) {
  const dias = Math.floor((hoy - new Date(cotizacion.fecha)) / MS_DIA);
  const pendiente = PASOS.find(p => dias >= p.minDias);
  return { paso: pendiente ? pendiente.paso : null, dias };
}

function claveCliente(c) {
  return c.data?.cliente?.rfc || c.cliente || `id-${c.id}`;
}

export function calcularCola(cotizaciones, hoy = new Date()) {
  const ultimaPorCliente = new Map();
  for (const c of cotizaciones) {
    if (ESTADOS_CERRADOS.has(c.estado)) continue;
    const clave = claveCliente(c);
    const previa = ultimaPorCliente.get(clave);
    if (!previa || new Date(c.fecha) > new Date(previa.fecha)) {
      ultimaPorCliente.set(clave, c);
    }
  }
  const cola = [];
  for (const c of ultimaPorCliente.values()) {
    // Reunion de diagnostico sobre la cotizacion (issue #65, simetrica a la del
    // prospecto): las reuniones viven en el array seguimientos como entradas
    // { tipo:'reunion', fecha_reunion, fecha }. Mientras la reunion es futura la
    // cadencia se suprime (la cotizacion sale de la cola); pasada la fecha sin
    // evento posterior, reaparece pidiendo registrar el resultado AUNQUE el paso
    // de cadencia ya este hecho. Una entrada de reunion no tiene `paso`, asi que
    // no interfiere con el calculo del paso pendiente.
    const eventos = c.seguimientos || [];
    if (reunionFuturaDe(eventos, hoy)) continue;
    const fechaReunion = reunionPendienteResultadoDe(eventos, hoy);
    const { paso, dias } = pasoCadencia(c, hoy);
    const hechos = new Set(eventos.map(s => s.paso));
    if (fechaReunion || (paso && !hechos.has(paso))) {
      const telefono = telefonoWa(c.data?.cliente?.celEntrega || c.data?.cliente?.telefono);
      const mensaje = mensajeSeguimiento(c, paso || 'dia2');
      cola.push({
        id: c.id,
        paso,
        dias,
        cliente: c.cliente,
        vendedor: c.vendedor,
        total: c.total,
        totalPiezas: c.totalPiezas,
        fecha: c.fecha,
        // Folio de Operam nullable (issue #63): null = pre-cotizacion (badge
        // "PRE"); con folio la tarjeta muestra "Cotizacion N"; registroDesconocido =
        // historica anterior a #63 (se asume registrada, sin badge).
        folioOperam: c.folioOperam ?? null,
        registroDesconocido: c.registroDesconocido ?? false,
        // Reunion vencida (issue #65): la cotizacion reaparece pidiendo el
        // resultado. El flag y la fecha los lee la cola Hoy para ordenarla arriba.
        reunionVencida: !!fechaReunion,
        fechaReunion: fechaReunion || null,
        telefono,
        mensaje,
        waLink: telefono ? `https://wa.me/${telefono}?text=${encodeURIComponent(mensaje)}` : null,
      });
    }
  }
  return cola;
}

// Plantilla acordada con Adrian (2026-06-12): saluda por nombre, presenta al
// vendedor y referencia la fecha de envio. Sin emojis: se rompian en el
// camino al draft de WhatsApp (aparecia el simbolo de reemplazo).
export function mensajeSeguimiento(c, paso) {
  const nombre = c.data?.cliente?.nombreCorto || c.cliente || '';
  const fecha = new Date(c.fecha).toLocaleDateString('es-MX', { day: 'numeric', month: 'long' });
  const saludo = `Hola${nombre ? ` ${nombre}` : ''}, te escribe ${c.vendedor} de pp.peltre sobre la cotización que te enviamos el ${fecha}. `;
  const textos = {
    dia2: `${saludo}¿Tuviste oportunidad de revisarla? Con gusto resolvemos cualquier duda sobre modelos, colores o cantidades.`,
    dia7: `${saludo}Seguimos pendientes; si quieres ajustar piezas, colores o el volumen para mejorar el precio, lo vemos sin compromiso.`,
    dia21: `${saludo}Está por vencer la próxima semana: si confirmas antes respetamos el precio y apartamos tu espacio de producción.`,
    vencida: `${saludo}Ya venció, pero con gusto la reactivamos con precios vigentes. ¿La retomamos?`,
  };
  return textos[paso] || textos.dia2;
}
