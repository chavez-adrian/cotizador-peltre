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
    const dias = Math.floor((hoy - new Date(c.fecha)) / MS_DIA);
    const hechos = new Set((c.seguimientos || []).map(s => s.paso));
    const pendiente = PASOS.find(p => dias >= p.minDias);
    if (pendiente && !hechos.has(pendiente.paso)) {
      const telefono = telefonoWa(c.data?.cliente?.celEntrega || c.data?.cliente?.telefono);
      const mensaje = mensajeSeguimiento(c, pendiente.paso);
      cola.push({
        id: c.id,
        paso: pendiente.paso,
        dias,
        cliente: c.cliente,
        vendedor: c.vendedor,
        total: c.total,
        totalPiezas: c.totalPiezas,
        fecha: c.fecha,
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
