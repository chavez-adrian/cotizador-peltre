import { reunionFuturaDe, reunionPendienteResultadoDe } from '../public/js/prospectos-logica.js';

const MS_DIA = 24 * 60 * 60 * 1000;

const PASOS = [
  { paso: 'vencida', minDias: 28 },
  { paso: 'dia21', minDias: 21 },
  { paso: 'dia7', minDias: 7 },
  { paso: 'dia2', minDias: 2 },
];

const ESTADOS_CERRADOS = new Set(['ganada', 'perdida', 'descartada']);

export function telefonoValido(telefono) {
  if (!telefono) return false;
  const digitos = String(telefono).replace(/\D/g, '');
  return digitos.length >= 11 && digitos.length <= 15;
}

export function telefonoWa(telefono) {
  if (!telefono) return null;
  const digitos = String(telefono).replace(/\D/g, '');
  if (digitos.length === 10) return `52${digitos}`;
  if (digitos.length >= 11) return digitos;
  return null;
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
    const dias = Math.floor((hoy - new Date(c.fecha)) / MS_DIA);
    const hechos = new Set(eventos.map(s => s.paso));
    const pendiente = PASOS.find(p => dias >= p.minDias);
    if (fechaReunion || (pendiente && !hechos.has(pendiente.paso))) {
      const paso = pendiente ? pendiente.paso : null;
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
        // "PRE"); con folio la tarjeta muestra "#Operam N"; registroDesconocido =
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
