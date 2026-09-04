import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { importeLinea, fechaEmisionHoy } from '../public/js/cotizar-logica.js';
import { referenciaDelCliente } from './referencia-cliente.js';

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
  const { incluirFotos = false, id } = options;

  let images = {};
  if (incluirFotos && existsSync(IMAGES_PATH)) {
    try {
      images = JSON.parse(readFileSync(IMAGES_PATH, 'utf8'));
    } catch {}
  }

  const c = data.cliente || {};
  // Misma cadena que el cust_ref del quote de Operam (#241): el documento del
  // cliente y el ERP salen de la misma fuente y cortan en el mismo punto -- el
  // truncado a 60 vive en el nucleo, no en el consumidor de Operam.
  const refCliente = referenciaDelCliente(c);
  const items = data.items || [];
  // Mismo fallback que el quote (#284): la fecha del calendario del negocio, no la
  // de UTC -- el servidor corre en UTC y de noche imprimia la fecha de manana.
  const fecha = data.fecha || fechaEmisionHoy();
  const vigencia = data.vigencia || '';
  const notas = Array.isArray(data.notas) ? data.notas : [];
  // El numero de la cotizacion ES el folio de Operam (ADR-0009), nunca el id
  // interno del registro: el HTML mostraba el id y el PDF no mostraba ninguno,
  // que es justo la doble numeracion que el ADR cierra. Llega ya decidido desde
  // el unico punto del server que arma los datos del documento.
  const folio = data.folio != null && data.folio !== '' ? String(data.folio) : '';

  const dirEntrega = [c.calle, c.numInt, c.colonia, c.cpEntrega, c.municipio, c.estado]
    .filter(Boolean).join(', ');

  const hasImages = incluirFotos && Object.keys(images).length > 0;
  const headerImgCell = hasImages ? '<th class="th-img">Foto</th>' : '';

  const totalCantidad = items.reduce((sum, item) => sum + (item.cantidad || 0), 0);

  const itemRows = items.map((item) => {
    const modelCode = (item.codigo || '').slice(0, 4);
    const imgUrl = images[item.codigo] || images[modelCode];
    const lineTotal = importeLinea(item);

    const imgCell = hasImages
      ? `<td class="td-img">${imgUrl ? `<img src="${esc(imgUrl)}" alt="${esc(item.codigo)}" class="product-img" loading="lazy">` : ''}</td>`
      : '';

    return `<tr>
      ${imgCell}
      <td class="td-code">${esc(item.codigo)}</td>
      <td class="td-desc">${esc(item.descripcion)}</td>
      <td class="num" data-field="cant">${item.cantidad || ''}</td>
      <td class="num" data-field="unidad">${esc(item.unidad || 'pza')}</td>
      <td class="num" data-field="precio">${fmt(item.precio)}</td>
      <td class="num" data-field="dscto">${item.descuento ? item.descuento + '%' : ''}</td>
      <td class="num" data-field="total"><strong>${fmt(lineTotal)}</strong></td>
    </tr>`;
  }).join('\n');

  const logoPath = join(__dirname, '..', 'public', 'logo_pn.png');
  const logoHtml = existsSync(logoPath)
    ? `<img src="data:image/png;base64,${readFileSync(logoPath).toString('base64')}" alt="pp.peltre" style="width:150px;height:50px;object-fit:cover;object-position:center center;">`
    : `<div class="company-name">${esc(COMPANY.name)}</div>`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="format-detection" content="telephone=no,address=no,email=no">
<title>${folio ? 'Cotizacion #' + folio : 'Pre-cotizacion'} - Peltre Nacional</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #222; background: #fff; }
a { color: inherit !important; text-decoration: none !important; pointer-events: none; }
.print-bar { background: #444; color: #fff; padding: 10px 24px; display: flex; justify-content: space-between; align-items: center; }
.print-bar span { font-size: 13px; font-weight: 600; }
.btn-print { background: #fff; color: #444; border: none; padding: 6px 18px; border-radius: 20px; font-size: 12px; font-weight: 700; cursor: pointer; }
/* El boton se volvio enlace (#308): la regla global "a" de arriba fuerza
   color/decoracion y desactiva el click de cualquier autolink accidental en el
   cuerpo del documento -- sin este override el enlace se veria bien pero no
   respondera al toque. */
a.btn-print { color: #444 !important; text-decoration: none !important; pointer-events: auto; display: inline-block; }
.page { max-width: 900px; margin: 24px auto; background: #fff; border-radius: 4px; box-shadow: 0 2px 12px rgba(0,0,0,0.10); padding: 28px 36px; }

/* Header 3 columns */
.header { display: grid; grid-template-columns: 1fr 1fr 1fr; align-items: flex-start; padding-bottom: 10px; border-bottom: 1px solid #ccc; margin-bottom: 9px; gap: 12px; }
.company-name { font-size: 14px; font-weight: 700; margin-bottom: 4px; }
.company-info { font-size: 9.5px; color: #444; line-height: 1.3; text-align: left; }
.quote-block { text-align: right; }
.quote-block h2 { font-size: 34px; font-weight: 700; color: #aaa; letter-spacing: 1px; line-height: 1; margin-bottom: 3px; }
.quote-num { color: #CC0000; font-weight: 700; }
.quote-meta { font-size: 11px; color: #444; }
.qm-row { display: flex; justify-content: flex-start; line-height: 1.35; gap: 0; }
.qm-label { min-width: 105px; text-align: left; }
.qm-val { text-align: left; padding-left: 4px; }
.page-num { font-size: 9px; color: #999; text-align: right; }

/* Client */
.client-section { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 16px; }
.section-title { font-size: 10px; font-weight: 400; color: #444; margin-bottom: 2px; }
.client-block p { font-size: 10px; line-height: 1.3; color: #444; }
.client-label { font-weight: 700; color: #222; }

/* Commercial table */
.comercial-table { width: 100%; border-collapse: collapse; margin-bottom: 14px; font-size: 10px; }
.comercial-table th { background: #e8e8e8; color: #222; font-weight: 700; padding: 4px 7px; border: 1px solid #ccc; text-align: left; font-size: 9.5px; }
.comercial-table td { padding: 4px 7px; border: 1px solid #ccc; font-size: 10px; }

/* Payment terms */
.pago-line { font-size: 11px; margin-top: 0; margin-bottom: 18px; }

/* Products box (border around table + totals, matching Operam) */
.products-box { border: 1px solid #aaa; margin-bottom: 20px; }

/* Products table */
table.products { width: 100%; border-collapse: collapse; font-size: 10px; }
table.products thead tr { background: #e8e8e8; }
table.products th { color: #222; font-size: 9.5px; font-weight: 700; padding: 6px 7px; text-align: left; border-bottom: 1px solid #aaa; background: #e8e8e8; }
table.products th.num { text-align: right; }
table.products td { padding: 7px 7px; border-bottom: 1px solid #ccc; vertical-align: middle; }
table.products td.num { text-align: right; }
table.products td.td-code { font-family: monospace; font-size: 10.5px; color: #555; width: 110px; }
table.products th:first-child { width: 110px; word-wrap: break-word; }
.product-img { width: 44px; height: 44px; object-fit: cover; border-radius: 4px; display: block; }
.td-img, .th-img { width: 54px; text-align: center; }

/* Bottom: notes + totals */
.bottom-section { display: flex; justify-content: space-between; align-items: flex-start; padding: 14px 12px 14px; gap: 20px; }
.notes-block { flex: 1; }
.notes-block ul { list-style: disc; padding-left: 16px; }
.notes-block li { font-size: 9.5px; color: #555; line-height: 1.5; }

.totals-table { min-width: 240px; border-collapse: collapse; font-size: 11px; }
.totals-table td { padding: 4px 9px; }
.totals-table td:last-child { text-align: right; font-weight: 600; min-width: 100px; }
.totals-table tr:not(:last-child) td { border-bottom: 1px solid #ddd; }
.totals-table tr.total-row td { font-weight: 700; font-size: 12px; border-top: 2px solid #222; padding-top: 6px; }

/* Footer */
.footer { padding-top: 3px; border-top: 1px solid #ddd; font-size: 8.5px; color: #888; text-align: center; line-height: 1.3; }

@media print {
  body { background: #fff; }
  .print-bar { display: none !important; }
  .page { margin: 0; box-shadow: none; border-radius: 0; padding: 20px; }
}

/* Vista movil (#302): tarjetas por partida en pantallas de celular. Solo bajo
   @media screen -- @media print arriba queda intacto y estas reglas nunca
   aplican al imprimir, ni en tablet/desktop (481px+). */
@media screen and (max-width: 480px) {
  body { font-size: 15px; overflow-x: hidden; }

  .print-bar { flex-wrap: wrap; gap: 8px; padding: 8px 12px; }
  /* overflow-wrap se hereda a todo el documento: codigos monoespaciados, RFC,
     correos o nombres largos sin espacios se parten en vez de recortarse
     fuera de pantalla con el overflow-x: hidden de arriba. */
  .page { max-width: 100%; margin: 0; padding: 12px; border-radius: 0; box-shadow: none; overflow-wrap: anywhere; }

  /* Header y datos de cliente: una columna, pares etiqueta:valor apilados */
  .header { display: block; }
  .header > div { margin-bottom: 10px; }
  .quote-block { text-align: left; }
  .quote-block h2 { font-size: 22px; }
  .company-info, .quote-meta, .qm-label, .qm-val { font-size: 13px; }

  .client-section { display: block; }
  .client-section .client-block { margin-bottom: 12px; }
  .section-title { font-size: 12px; }
  .client-block p { font-size: 13px; }
  .pago-line { font-size: 13px; }

  /* Tabla comercial: de 5 columnas a lista de pares etiqueta:valor */
  .comercial-table, .comercial-table thead, .comercial-table tbody,
  .comercial-table tr, .comercial-table th, .comercial-table td {
    display: block;
    width: 100%;
  }
  .comercial-table thead { display: none; }
  .comercial-table td { border: none; border-bottom: 1px solid #ddd; padding: 5px 0; font-size: 13px; }
  .comercial-table tbody td:nth-child(1)::before { content: "Referencia del Cliente: "; font-weight: 700; }
  .comercial-table tbody td:nth-child(2)::before { content: "Representante de Ventas: "; font-weight: 700; }
  .comercial-table tbody td:nth-child(3)::before { content: "R.F.C.: "; font-weight: 700; }
  /* content de CSS NO parsea entidades HTML: van escapes unicode (la doble
     diagonal es del template literal de JS; el doble espacio tras el escape
     es obligado -- el primero lo consume el terminador del escape CSS). */
  .comercial-table tbody td:nth-child(4)::before { content: "N\\0000ba  Cotizaci\\0000f3n: "; font-weight: 700; }
  .comercial-table tbody td:nth-child(5)::before { content: "Valido hasta: "; font-weight: 700; }

  /* Partidas: tarjeta por linea (codigo + descripcion, cantidad x precio,
     descuento si existe, total destacado) en vez de tabla de 8 columnas */
  .products-box { border: none; }
  table.products, table.products tbody { display: block; width: 100%; }
  table.products thead { display: none; }
  table.products tr {
    display: block;
    border: 1px solid #ccc;
    border-radius: 8px;
    padding: 10px 12px;
    margin-bottom: 10px;
  }
  table.products td { display: block; border: none; padding: 0; font-size: 14px; }
  table.products td.td-img { margin-bottom: 8px; }
  table.products td.td-img .product-img { width: 64px; height: 64px; }
  table.products td.td-code { font-family: monospace; font-weight: 700; font-size: 13px; color: #555; }
  table.products td.td-desc { margin: 2px 0 6px; }
  table.products td[data-field="unidad"] { display: none; }
  table.products td[data-field="cant"],
  table.products td[data-field="precio"] { display: inline; }
  table.products td[data-field="cant"]::after { content: " x "; }
  table.products td[data-field="dscto"] { display: inline; margin-left: 8px; color: #a30000; }
  table.products td[data-field="dscto"]:empty { display: none; }
  table.products td[data-field="total"] { margin-top: 6px; font-size: 17px; }
  table.products td[data-field="total"] strong { color: #CC0000; }

  /* Notas y totales apilados, sin compartir fila */
  .bottom-section { display: block; padding: 12px 4px; }
  .notes-block { margin-bottom: 14px; }
  .notes-block li { font-size: 13px; }
  .totals-table { width: 100%; font-size: 14px; }

  .footer { font-size: 11px; }
}
</style>
</head>
<body>

<div class="print-bar">
  <span>${folio ? 'Cotizacion Peltre Nacional #' + esc(folio) : 'Pre-cotizacion Peltre Nacional'}</span>
  ${id != null ? `<a class="btn-print" href="/api/cotizacion/pdf/${esc(id)}" target="_blank" rel="noopener">Descargar PDF</a>` : ''}
</div>

<div class="page">

  <div class="header">
    <div class="header-logo">
      ${logoHtml}
    </div>
    <div class="company-info">
      ${esc(COMPANY.name)}<br>
      <br>
      Tel. ${esc(COMPANY.tel)}<br>
      e-Mail: ${esc(COMPANY.email)}<br>
      R.F.C: ${esc(COMPANY.rfc)}
    </div>
    <div class="quote-block">
      <div class="page-num">Pagina 1 de 1</div>
      <h2>${folio ? 'COTIZACION' : 'PRE-COTIZACION'}</h2>
      <div class="quote-meta">
        <div class="qm-row"><span class="qm-label">Fecha:</span><span class="qm-val">${esc(fecha)}</span></div>
        ${folio ? `<div class="qm-row"><span class="qm-label">N&ordm; Cotizaci&oacute;n:</span><span class="qm-val quote-num">${esc(folio)}</span></div>` : ''}
        ${data.referencia ? `<div class="qm-row"><span class="qm-label">Referencia:</span><span class="qm-val">${esc(data.referencia)}</span></div>` : ''}
      </div>
    </div>
  </div>

  <div class="client-section">
    <div class="client-block">
      <div class="section-title">Datos de Facturaci&oacute;n:</div>
      <p>
        ${(c.razonSocial || c.empresa) ? `<span class="client-label">Company Name</span> ${esc(c.razonSocial || c.empresa)}<br>` : ''}
        ${c.cpFiscal ? `<span class="client-label">Direcci&oacute;n:</span>${esc(c.cpFiscal)}<br><span style="display:block;height:5px"></span>` : ''}
        ${c.rfc ? `<span class="client-label">Rfc:</span>${esc(c.rfc)}` : ''}
      </p>
    </div>
    <div class="client-block">
      <div class="section-title">Datos de entrega</div>
      <p>
        ${c.nombreEntrega ? `<span class="client-label">Entregar a:</span>${esc(c.nombreEntrega)}<br><span style="display:block;height:5px"></span>` : ''}
        ${dirEntrega ? `<span class="client-label">Direcci&oacute;n:</span>${esc(dirEntrega)}<br><span style="display:block;height:5px"></span>` : ''}
        ${c.leyendaDomicilio ? `<span class="client-label">${esc(c.leyendaDomicilio)}</span><br><span style="display:block;height:5px"></span>` : ''}
        ${(c.celEntrega || c.emailEntrega) ? `<span class="client-label">Tel&eacute;fono:</span>${esc(c.celEntrega || '')}${c.emailEntrega ? ` , <span class="client-label">Correo:</span>${esc(c.emailEntrega)}` : ''}<br>` : ''}
        ${refCliente ? `<span class="client-label">Referencia Cliente:</span>${esc(refCliente)}` : ''}
      </p>
    </div>
  </div>

  <table class="comercial-table">
    <colgroup>
      <col style="width:22%">
      <col style="width:22%">
      <col style="width:22%">
      <col style="width:12%">
      <col style="width:22%">
    </colgroup>
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
        <td>${esc(refCliente)}</td>
        <td>${esc(data.vendedor || '')}</td>
        <td>${esc(c.rfc || '')}</td>
        <td>${esc(folio)}</td>
        <td>${esc(vigencia)}</td>
      </tr>
    </tbody>
  </table>

  ${data.condicionesPago ? `<div class="pago-line">T&eacute;rminos de Pago: ${esc(data.condicionesPago)}</div>` : ''}

  <div class="products-box">
    <table class="products">
      <thead>
        <tr>
          ${headerImgCell}
          <th>C&oacute;digo de<br>Art&iacute;culo</th>
          <th>Descripci&oacute;n del Art&iacute;culo</th>
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
          <td>${fmt(data.subtotal)}</td>
        </tr>
        <tr>
          <td>I.V.A. 16% (16%)</td>
          <td>${fmt(data.iva)}</td>
        </tr>
        <tr class="total-row">
          <td><strong>TOTAL</strong></td>
          <td>${fmt(data.total)}</td>
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
