import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const IMAGES_PATH = join(__dirname, '..', 'data', 'images.json');

const COMPANY = {
  name: 'PELTRE NACIONAL',
  legal: 'Peltre Nacional SA de CV',
  rfc: 'PNA170810CF1',
  tel: '(55) 7315 1197',
  email: 'contacto@pppeltre.mx',
  web: 'www.pppeltre.mx',
  address: 'Roberto Fierro MZ42 LT13, Col. Alfredo del Mazo, CP 56577, Ixtapaluca, Edo. de México',
};

function fmt(n) {
  if (n == null) return '0.00';
  return n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPrice(n) {
  return '$ ' + fmt(n);
}

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Genera HTML de cotizacion.
 * @param {object} data - Datos de la cotizacion (mismo formato que generateQuotePDF)
 * @param {object} options - { incluirFotos: bool }
 * @returns {string} HTML completo
 */
export function generateQuoteHTML(data, options = {}) {
  const { incluirFotos = false } = options;

  let images = {};
  if (incluirFotos && existsSync(IMAGES_PATH)) {
    try {
      images = JSON.parse(readFileSync(IMAGES_PATH, 'utf8'));
    } catch {}
  }

  const c = data.cliente || {};
  const items = data.items || [];
  const fecha = data.fecha || new Date().toISOString().split('T')[0];
  const vigencia = data.vigencia || '';
  const notas = Array.isArray(data.notas) ? data.notas : [];

  const dirEntrega = [c.calle, c.numInt, c.colonia, c.cpEntrega, c.municipio, c.estado]
    .filter(Boolean).join(', ');

  const hasImages = incluirFotos && Object.keys(images).length > 0;

  const headerImgCell = hasImages ? '<th class="th-img">Foto</th>' : '';

  const itemRows = items.map((item, i) => {
    const modelCode = (item.codigo || '').slice(0, 4);
    const imgUrl = images[item.codigo] || images[modelCode];
    const lineTotal = (item.cantidad || 0) * (item.precio || 0) * (1 - (item.descuento || 0) / 100);

    const imgCell = hasImages
      ? `<td class="td-img">${imgUrl ? `<img src="${esc(imgUrl)}" alt="${esc(item.codigo)}" class="product-img" loading="lazy">` : ''}</td>`
      : '';

    return `<tr class="${i % 2 === 1 ? 'alt' : ''}">
      ${imgCell}
      <td class="td-code">${esc(item.codigo)}</td>
      <td>${esc(item.descripcion)}</td>
      <td class="num">${item.cantidad || ''}</td>
      <td class="num">${esc(item.unidad || 'pza')}</td>
      <td class="num">${fmt(item.precio)}</td>
      <td class="num">${item.descuento ? item.descuento + '%' : ''}</td>
      <td class="num"><strong>${fmt(lineTotal)}</strong></td>
    </tr>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Cotizacion${data.id ? ' #' + data.id : ''} - Peltre Nacional</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #2D3436; background: #f0f4fa; }
.print-bar { background: #063995; color: #fff; padding: 10px 24px; display: flex; justify-content: space-between; align-items: center; }
.print-bar span { font-size: 13px; font-weight: 600; }
.btn-print { background: #fff; color: #063995; border: none; padding: 6px 18px; border-radius: 20px; font-size: 12px; font-weight: 700; cursor: pointer; }
.btn-print:hover { background: #EBF3FF; }
.page { max-width: 900px; margin: 24px auto; background: #fff; border-radius: 8px; box-shadow: 0 2px 12px rgba(0,0,0,0.10); padding: 36px 40px; }

/* Header */
.header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 16px; border-bottom: 2px solid #063995; margin-bottom: 16px; gap: 16px; }
.company-name { font-size: 18px; font-weight: 700; color: #063995; margin-bottom: 4px; }
.company-info { font-size: 10.5px; color: #636E72; line-height: 1.7; }
.quote-block { text-align: right; flex-shrink: 0; }
.quote-block h2 { font-size: 22px; font-weight: 700; color: #063995; letter-spacing: 1px; }
.quote-meta { font-size: 10.5px; color: #636E72; line-height: 1.8; margin-top: 4px; }
.quote-meta strong { color: #333; }

/* Client */
.client-section { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 14px; }
.client-block h3 { font-size: 10px; font-weight: 700; color: #063995; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 5px; border-bottom: 1px solid #E5ECF8; padding-bottom: 3px; }
.client-block p { font-size: 11px; line-height: 1.75; color: #444; }

/* Commercial bar */
.comercial-bar { background: #F4F8FE; border-left: 3px solid #418FFF; border-radius: 0 4px 4px 0; padding: 7px 12px; font-size: 11px; color: #444; margin-bottom: 16px; display: flex; gap: 28px; flex-wrap: wrap; }
.comercial-bar strong { color: #063995; }

/* Table */
table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 11px; }
thead tr { background: #063995; }
th { color: #fff; font-size: 10px; font-weight: 600; padding: 6px 7px; text-align: left; }
th.num { text-align: right; }
td { padding: 5px 7px; border-bottom: 1px solid #EBEBEB; vertical-align: middle; }
td.num { text-align: right; }
td.td-code { font-family: monospace; font-size: 10.5px; color: #555; }
tr.alt td { background: #F4F8FE; }
.product-img { width: 44px; height: 44px; object-fit: cover; border-radius: 4px; display: block; }
.td-img, .th-img { width: 54px; text-align: center; }

/* Totals */
.bottom-section { display: flex; justify-content: flex-end; margin-bottom: 20px; }
.totals-table { min-width: 260px; border-collapse: collapse; font-size: 12px; }
.totals-table td { padding: 5px 10px; border-bottom: 1px solid #EBEBEB; }
.totals-table td:last-child { text-align: right; font-weight: 600; min-width: 100px; }
.totals-table tr.total-row td { background: #063995; color: #fff; font-weight: 700; font-size: 13px; border-bottom: none; }

/* Notes */
.notes { margin-bottom: 20px; }
.notes h3 { font-size: 10px; font-weight: 700; color: #063995; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
.notes ul { list-style: none; padding: 0; }
.notes li { font-size: 10.5px; color: #555; line-height: 1.9; padding-left: 14px; position: relative; }
.notes li::before { content: "—"; position: absolute; left: 0; color: #aaa; }

/* Footer */
.footer { padding-top: 10px; border-top: 1px solid #EBEBEB; font-size: 9.5px; color: #aaa; text-align: center; line-height: 1.6; }

@media print {
  body { background: #fff; }
  .print-bar { display: none !important; }
  .page { margin: 0; box-shadow: none; border-radius: 0; padding: 20px; }
  tr.alt td { background: #f7faff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  thead tr { background: #063995 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .totals-table tr.total-row td { background: #063995 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
</style>
</head>
<body>

<div class="print-bar">
  <span>Cotizacion Peltre Nacional${data.id ? ' #' + esc(String(data.id)) : ''}</span>
  <button class="btn-print" onclick="window.print()">Imprimir / Guardar PDF</button>
</div>

<div class="page">

  <div class="header">
    <div>
      <div class="company-name">${esc(COMPANY.name)}</div>
      <div class="company-info">
        ${esc(COMPANY.legal)}<br>
        RFC: ${esc(COMPANY.rfc)}<br>
        Tel. ${esc(COMPANY.tel)} &nbsp;·&nbsp; ${esc(COMPANY.email)}<br>
        ${esc(COMPANY.web)}
      </div>
    </div>
    <div class="quote-block">
      <h2>COTIZACION</h2>
      <div class="quote-meta">
        ${data.id ? `Núm: <strong>#${esc(String(data.id))}</strong><br>` : ''}
        Fecha: <strong>${esc(fecha)}</strong><br>
        ${vigencia ? `Válida hasta: <strong>${esc(vigencia)}</strong><br>` : ''}
        ${data.tier ? `Precio tier: <strong>${esc(data.tier)}</strong>` : ''}
      </div>
    </div>
  </div>

  <div class="client-section">
    <div class="client-block">
      <h3>Datos de Facturación</h3>
      <p>
        ${(c.razonSocial || c.empresa) ? `<strong>${esc(c.razonSocial || c.empresa)}</strong><br>` : ''}
        ${c.rfc ? `RFC: ${esc(c.rfc)}<br>` : ''}
        ${c.cpFiscal ? `CP fiscal: ${esc(c.cpFiscal)}<br>` : ''}
        ${c.telefono ? `Tel: ${esc(c.telefono)}` : ''}
      </p>
    </div>
    <div class="client-block">
      <h3>Datos de Entrega</h3>
      <p>
        ${c.nombreEntrega ? `<strong>${esc(c.nombreEntrega)}</strong><br>` : ''}
        ${dirEntrega ? `${esc(dirEntrega)}<br>` : (c.direccionEntrega ? `${esc(c.direccionEntrega)}<br>` : '')}
        ${c.referencias ? `Ref: ${esc(c.referencias)}<br>` : ''}
        ${(c.celEntrega || c.telefonoEntrega) ? `Tel: ${esc(c.celEntrega || c.telefonoEntrega)}<br>` : ''}
        ${c.emailEntrega ? esc(c.emailEntrega) : ''}
      </p>
    </div>
  </div>

  <div class="comercial-bar">
    ${data.vendedor ? `<div>Representante: <strong>${esc(data.vendedor)}</strong></div>` : ''}
    ${data.condicionesPago ? `<div>Condiciones de pago: <strong>${esc(data.condicionesPago)}</strong></div>` : ''}
    ${c.referencia ? `<div>Referencia: <strong>${esc(c.referencia)}</strong></div>` : ''}
  </div>

  <table>
    <thead>
      <tr>
        ${headerImgCell}
        <th>Código</th>
        <th>Descripción</th>
        <th class="num">Cant.</th>
        <th class="num">Unidad</th>
        <th class="num">Precio</th>
        <th class="num">% Dscto.</th>
        <th class="num">Total</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows}
    </tbody>
  </table>

  <div class="bottom-section">
    <table class="totals-table">
      <tr>
        <td>Sub-Total [${items.length}]</td>
        <td>${fmtPrice(data.subtotal)}</td>
      </tr>
      <tr>
        <td>I.V.A. 16%</td>
        <td>${fmtPrice(data.iva)}</td>
      </tr>
      <tr class="total-row">
        <td>TOTAL MXN</td>
        <td>${fmtPrice(data.total)}</td>
      </tr>
    </table>
  </div>

  ${notas.length > 0 ? `<div class="notes">
    <h3>Notas</h3>
    <ul>${notas.map(n => `<li>${esc(n)}</li>`).join('')}</ul>
  </div>` : ''}

  <div class="footer">
    Todas las cantidades se indican en MXN &nbsp;·&nbsp; ${esc(COMPANY.address)}
  </div>

</div>
</body>
</html>`;
}
