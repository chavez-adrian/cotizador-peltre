import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const IMAGES_PATH = join(__dirname, '..', 'data', 'images.json');

const COMPANY = {
  name: 'PELTRE NACIONAL',
  legal: 'Peltre Nacional SA de CV',
  rfc: 'PNA170810CF1',
  tel: '(55)43976785',
  email: 'contacto@pppeltre.mx',
  web: 'www.pppeltre.mx',
  address: 'Roberto Fierro MZ42 LT13, Col. Alfredo del Mazo, CP 56577, Ixtapaluca, Edo. de Mexico',
  banco: 'Banorte',
  cuenta: '1212905824',
  clabe: '002180700947054340',
  swift: 'MENOMXMTXXX',
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

  const totalCantidad = items.reduce((sum, item) => sum + (item.cantidad || 0), 0);

  const itemRows = items.map((item) => {
    const modelCode = (item.codigo || '').slice(0, 4);
    const imgUrl = images[item.codigo] || images[modelCode];
    const lineTotal = (item.cantidad || 0) * (item.precio || 0) * (1 - (item.descuento || 0) / 100);

    const imgCell = hasImages
      ? `<td class="td-img">${imgUrl ? `<img src="${esc(imgUrl)}" alt="${esc(item.codigo)}" class="product-img" loading="lazy">` : ''}</td>`
      : '';

    return `<tr>
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

  const logoPath = join(__dirname, '..', 'public', 'logo_pn.png');
  const logoHtml = existsSync(logoPath)
    ? `<img src="data:image/png;base64,${readFileSync(logoPath).toString('base64')}" alt="pp.peltre" style="max-height:70px;width:auto;">`
    : `<div class="company-name">${esc(COMPANY.name)}</div>`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="format-detection" content="telephone=no,address=no,email=no">
<title>Cotizacion${data.id ? ' #' + data.id : ''} - Peltre Nacional</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #222; background: #fff; }
a { color: inherit !important; text-decoration: none !important; pointer-events: none; }
.print-bar { background: #444; color: #fff; padding: 10px 24px; display: flex; justify-content: space-between; align-items: center; }
.print-bar span { font-size: 13px; font-weight: 600; }
.btn-print { background: #fff; color: #444; border: none; padding: 6px 18px; border-radius: 20px; font-size: 12px; font-weight: 700; cursor: pointer; }
.page { max-width: 900px; margin: 24px auto; background: #fff; border-radius: 4px; box-shadow: 0 2px 12px rgba(0,0,0,0.10); padding: 36px 40px; }

/* Header 3 columns */
.header { display: grid; grid-template-columns: 1fr 1fr 1fr; align-items: flex-start; padding-bottom: 12px; border-bottom: 1px solid #ccc; margin-bottom: 14px; gap: 12px; }
.company-name { font-size: 16px; font-weight: 700; margin-bottom: 4px; }
.company-info { font-size: 10.5px; color: #444; line-height: 1.8; text-align: center; }
.quote-block { text-align: right; }
.quote-block h2 { font-size: 36px; font-weight: 700; color: #aaa; letter-spacing: 1px; line-height: 1; margin-bottom: 8px; }
.quote-num { color: #C05000; font-weight: 700; }
.quote-meta { font-size: 11px; color: #444; line-height: 2; }
.page-num { font-size: 9px; color: #999; text-align: right; }

/* Client */
.client-section { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 14px; }
.client-block h3 { font-size: 11px; font-weight: 700; margin-bottom: 5px; }
.client-block p { font-size: 11px; line-height: 1.75; color: #444; }
.client-label { font-weight: 700; color: #222; }
.ref-cliente { font-size: 11px; color: #333; margin-bottom: 6px; }

/* Commercial table */
.comercial-table { width: 100%; border-collapse: collapse; margin-bottom: 14px; font-size: 11px; }
.comercial-table th { background: #e8e8e8; color: #222; font-weight: 700; padding: 5px 8px; border: 1px solid #ccc; text-align: left; font-size: 10.5px; }
.comercial-table td { padding: 5px 8px; border: 1px solid #ccc; }

/* Payment terms */
.pago-line { font-size: 11px; margin-bottom: 10px; }

/* Products box (border around table + totals, matching Operam) */
.products-box { border: 1px solid #ccc; margin-bottom: 20px; }

/* Products table */
table.products { width: 100%; border-collapse: collapse; font-size: 11px; }
table.products thead tr { background: #e8e8e8; }
table.products th { color: #222; font-size: 10.5px; font-weight: 700; padding: 6px 7px; text-align: left; border: 1px solid #ccc; border-top: none; border-left: none; border-right: none; }
table.products th.num { text-align: right; }
table.products td { padding: 5px 7px; border-bottom: 1px solid #eee; vertical-align: middle; }
table.products td.num { text-align: right; }
table.products td.td-code { font-family: monospace; font-size: 10.5px; color: #555; }
.product-img { width: 44px; height: 44px; object-fit: cover; border-radius: 4px; display: block; }
.td-img, .th-img { width: 54px; text-align: center; }

/* Bottom: notes + totals */
.bottom-section { display: flex; justify-content: space-between; align-items: flex-start; padding: 12px 10px 10px; gap: 20px; }
.notes-block { flex: 1; }
.notes-block ul { list-style: disc; padding-left: 18px; }
.notes-block li { font-size: 10.5px; color: #555; line-height: 1.9; }

.totals-table { min-width: 260px; border-collapse: collapse; font-size: 12px; }
.totals-table td { padding: 5px 10px; }
.totals-table td:last-child { text-align: right; font-weight: 600; min-width: 110px; }
.totals-table tr:not(:last-child) td { border-bottom: 1px solid #ddd; }
.totals-table tr.total-row td { font-weight: 700; font-size: 13px; border-top: 2px solid #222; padding-top: 7px; }

/* Footer */
.footer { padding-top: 10px; border-top: 1px solid #ddd; font-size: 9.5px; color: #888; text-align: center; line-height: 1.8; }

@media print {
  body { background: #fff; }
  .print-bar { display: none !important; }
  .page { margin: 0; box-shadow: none; border-radius: 0; padding: 20px; }
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
    <div class="header-logo">
      ${logoHtml}
    </div>
    <div class="company-info">
      ${esc(COMPANY.name)}<br>
      Tel. ${esc(COMPANY.tel)}<br>
      e-Mail: ${esc(COMPANY.email)}<br>
      R.F.C: ${esc(COMPANY.rfc)}
    </div>
    <div class="quote-block">
      <div class="page-num">Pagina 1 de 1</div>
      <h2>COTIZACION</h2>
      <div class="quote-meta">
        Fecha:&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;${esc(fecha)}<br>
        ${data.id ? `N&ordm; Cotizaci&oacute;n:&nbsp;&nbsp;<span class="quote-num">${esc(String(data.id))}</span><br>` : ''}
        ${data.referencia ? `Referencia:&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;${esc(data.referencia)}<br>` : ''}
      </div>
    </div>
  </div>

  <div class="client-section">
    <div class="client-block">
      <h3>Datos de Facturacion:</h3>
      <p>
        ${(c.razonSocial || c.empresa) ? `<span class="client-label">Razon Social</span> ${esc(c.razonSocial || c.empresa)}<br>` : ''}
        ${c.cpFiscal ? `<span class="client-label">CP Fiscal:</span> ${esc(c.cpFiscal)}<br>` : ''}
        ${c.rfc ? `<span class="client-label">Rfc:</span>${esc(c.rfc)}` : ''}
      </p>
    </div>
    <div class="client-block">
      <h3>Datos de entrega</h3>
      <p>
        ${c.nombreEntrega ? `<span class="client-label">Entregar a:</span>${esc(c.nombreEntrega)}<br>&nbsp;<br>` : ''}
        ${dirEntrega ? `<span class="client-label">Direccion:</span>${esc(dirEntrega)}<br>&nbsp;<br>` : ''}
        ${(c.celEntrega || c.emailEntrega) ? `<span class="client-label">Telefono:</span>${esc(c.celEntrega || '')}${c.emailEntrega ? ` , <span class="client-label">Correo:</span>${esc(c.emailEntrega)}` : ''}<br>` : ''}
        ${(c.referencia || c.nombreCorto) ? `<span class="client-label">Referencia Cliente:</span>${esc(c.referencia || c.nombreCorto)}` : ''}
      </p>
    </div>
  </div>

  <table class="comercial-table">
    <thead>
      <tr>
        <th>Referencia del Cliente</th>
        <th>Representante de Ventas</th>
        <th>R.F.C.</th>
        <th>N&ordm; Cotizaci&oacute;n</th>
        <th>Valido hasta</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>${esc(c.referencia || c.nombreCorto || '')}</td>
        <td>${esc(data.vendedor || '')}</td>
        <td>${esc(c.rfc || '')}</td>
        <td>${data.id ? esc(String(data.id)) : ''}</td>
        <td>${esc(vigencia)}</td>
      </tr>
    </tbody>
  </table>

  ${data.condicionesPago ? `<div class="pago-line">Terminos de Pago: ${esc(data.condicionesPago)}</div>` : ''}

  <div class="products-box">
    <table class="products">
      <thead>
        <tr>
          ${headerImgCell}
          <th>Codigo de Articulo</th>
          <th>Descripcion del Articulo</th>
          <th class="num">Ctdad</th>
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
      <div class="notes-block">
        ${notas.length > 0 ? `<ul>${notas.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
      </div>
      <table class="totals-table">
        <tr>
          <td>Sub-Total [${totalCantidad}]</td>
          <td>${fmtPrice(data.subtotal)}</td>
        </tr>
        <tr>
          <td>I.V.A. 16% (16%)</td>
          <td>${fmtPrice(data.iva)}</td>
        </tr>
        <tr class="total-row">
          <td><strong>TOTAL</strong></td>
          <td>${fmtPrice(data.total)}</td>
        </tr>
      </table>
    </div>
  </div>

  <div class="footer">
    Todas las cantidades se indican en - MXN<br>
    Banco: ${esc(COMPANY.banco)}, Cuenta Bancaria: ${esc(COMPANY.cuenta)}, CLABE: ${esc(COMPANY.clabe)}, SWIFT: ${esc(COMPANY.swift)}
  </div>

</div>
</body>
</html>`;
}
