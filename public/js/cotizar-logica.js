// Logica pura del flujo de cotizacion (sin efectos de navegador).
// Compartida con app.js (import nativo) y probada en cotizar-logica.test.cjs.

const LEYENDA_DOMICILIO = 'Favor de confirmar el domicilio de entrega';

// Espejo de lib/validar-cp.js (validarCP): la misma regla por pais, replicada aqui
// porque lib/ NO se sirve al navegador (solo public/). Mantener ambas en sincronia.
// Se exporta: chipsCompletitud (alta-logica.js) la reusa para el estado del chip
// Entrega ("CP capturado" vs "pendiente"), issue #84.
export function cpValido(cp, pais) {
  if (pais === 'CA') return /^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$/.test(cp);
  return /^\d{5}$/.test(cp);
}

// Domicilio de entrega para el DOCUMENTO (issue #84): nada es requisito para
// generar. Solo decide si hace falta la leyenda de confirmacion -- ausente que
// falte Calle (con o sin CP/pais) -> leyenda; Calle presente -> sin leyenda.
// Antes (#71) bloqueaba la generacion si faltaba CP/pais; el gate se releva por
// completo aqui porque CP+pais siguen siendo obligatorios solo para COTIZAR
// PAQUETERIA (envia.com), no para generar el documento -- ese gate vive aparte,
// en cotizarEnvia (app.js), que sigue exigiendo un CP valido.
export function validarDomicilioEntrega({ calle } = {}) {
  if (!(calle || '').trim()) return { ok: true, leyenda: LEYENDA_DOMICILIO };
  return { ok: true };
}

// Nombres canonicos de paqueteria (issue #71, decision Adrian): el carrier se
// muestra con su marca real (preserva acronimos: DHL, UPS, FedEx) y el servicio en
// Title Case. Arregla el "fedex ground" feo sin convertir DHL->Dhl ni UPS->Ups.
const CARRIERS_CANONICOS = {
  fedex: 'FedEx', dhl: 'DHL', ups: 'UPS', estafeta: 'Estafeta',
  redpack: 'Redpack', paquetexpress: 'Paquetexpress',
};

function tituloPalabras(str) {
  return (str || '').trim().toLowerCase().split(/\s+/).filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// Carrier con su marca canonica si es conocido; si no, Title Case (presentable).
export function formatCarrier(carrier) {
  const c = (carrier || '').trim();
  if (!c) return '';
  return CARRIERS_CANONICOS[c.toLowerCase()] || tituloPalabras(c);
}

// Servicio de paqueteria en Title Case ("ground" -> "Ground").
export function formatServicio(servicio) {
  return tituloPalabras(servicio);
}

// Escape local (no se importa de prospectos-logica.js para evitar un ciclo:
// prospectos-logica.js -> alta-logica.js -> cotizar-logica.js).
function escapeHtml(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Modal de confirmacion de identidad antes de generar el PDF/HTML (issue #87):
// evita estampar la cotizacion al vendedor equivocado cuando el dispositivo
// quedo logueado con otro usuario. Mismo patron que buildCanalModalHtml
// (prospectos-logica.js): HTML puro, el overlay/promesa vive en app.js.
export function buildConfirmarVendedorModalHtml(vendedorNombre) {
  return `
    <div style="background:#fff;border-radius:8px;padding:20px;max-width:340px;width:90%">
      <div style="font-weight:600;margin-bottom:4px">Cotización a nombre de: ${escapeHtml(vendedorNombre)}</div>
      <div class="cot-card-meta" style="margin-bottom:8px">Confirma que eres tú quien esta generando esta cotización.</div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="btn btn-secondary btn-sm" id="confirmar-vendedor-cancelar">Cancelar</button>
        <button class="btn btn-primary btn-sm" id="confirmar-vendedor-confirmar">Confirmar</button>
      </div>
    </div>
  `;
}
