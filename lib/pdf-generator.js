import PDFDocument from 'pdfkit';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = join(__dirname, '..', 'public', 'logo_pn.png');
const IMAGES_PATH = join(__dirname, '..', 'data', 'images.json');

const COMPANY = {
  name: 'PELTRE NACIONAL',
  rfc: 'PNA170810CF1',
  tel: '(55)43976785',
  email: 'contacto@pppeltre.mx',
};

const BANK = 'Banco: Banorte, Cuenta Bancaria: 1212905824, CLABE: 002180700947054340, SWIFT: MENOMXMTXXX';

const PAGE = { width: 612, height: 792, margin: 40 };
const CONTENT_W = PAGE.width - PAGE.margin * 2;

function fmt(n) {
  if (n == null) return '0.00';
  return n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function drawTable(doc, headers, rows, x, y, widths) {
  const colCount = headers.length;
  const totalW = widths.reduce((s, w) => s + w, 0);
  const headerH = 16;
  const rowH = 14;

  doc.rect(x, y, totalW, headerH).fill('#F0F0F0');
  doc.rect(x, y, totalW, headerH).stroke('#CCCCCC');

  doc.fontSize(7).font('Helvetica-Bold').fillColor('#000000');
  let cx = x;
  for (let i = 0; i < colCount; i++) {
    doc.text(headers[i], cx + 3, y + 4, { width: widths[i] - 6, align: 'left' });
    cx += widths[i];
  }
  y += headerH;

  doc.font('Helvetica').fontSize(7.5).fillColor('#000000');
  for (const row of rows) {
    doc.rect(x, y, totalW, rowH).stroke('#CCCCCC');
    cx = x;
    for (let i = 0; i < colCount; i++) {
      doc.text(String(row[i] ?? ''), cx + 3, y + 3, { width: widths[i] - 6, align: 'left' });
      cx += widths[i];
    }
    y += rowH;
  }
  return y;
}

export async function generateQuotePDF(data) {
  const imgBuffers = {};
  const incluirFotos = !!data.incluirFotos;
  if (incluirFotos && existsSync(IMAGES_PATH)) {
    let images = {};
    try { images = JSON.parse(readFileSync(IMAGES_PATH, 'utf8')); } catch {}
    const items = data.items || [];
    await Promise.allSettled(items.map(async (item) => {
      const codigo = item.codigo || '';
      const url = images[codigo] || images[codigo.slice(0, 4)];
      if (!url) return;
      try {
        const res = await fetch(url);
        if (!res.ok) return;
        imgBuffers[codigo] = Buffer.from(await res.arrayBuffer());
      } catch {}
    }));
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: PAGE.margin, bottom: PAGE.margin, left: PAGE.margin, right: PAGE.margin },
      bufferPages: true,
      compress: data._compress !== false,
    });

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    let y = PAGE.margin;
    const c = data.cliente || {};
    const items = data.items || [];
    const fecha = data.fecha || new Date().toISOString().split('T')[0];
    const vigencia = data.vigencia || '';

    // === HEADER — 3 columnas ===
    const hasLogo = existsSync(LOGO_PATH);
    const colW3 = CONTENT_W / 3;

    // Columna izquierda: logo o nombre
    if (hasLogo) {
      doc.image(LOGO_PATH, PAGE.margin, y, { width: 100 });
    } else {
      doc.fontSize(14).font('Helvetica-Bold').fillColor('#000000')
        .text(COMPANY.name, PAGE.margin, y, { width: colW3 });
    }

    // Columna central: info empresa
    const centroX = PAGE.margin + colW3;
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#000000')
      .text(COMPANY.name, centroX, y, { width: colW3, align: 'center' });
    doc.fontSize(7.5).font('Helvetica').fillColor('#444444')
      .text(`Tel. ${COMPANY.tel}`, centroX, y + 12, { width: colW3, align: 'center' })
      .text(`e-Mail: ${COMPANY.email}`, { width: colW3, align: 'center' })
      .text(`R.F.C: ${COMPANY.rfc}`, { width: colW3, align: 'center' });

    // Columna derecha: COTIZACION + meta
    const derechaX = PAGE.margin + colW3 * 2;
    doc.fontSize(7).font('Helvetica').fillColor('#999999')
      .text('Pagina 1 de 1', derechaX, y, { width: colW3, align: 'right' });
    doc.fontSize(22).font('Helvetica-Bold').fillColor('#000000')
      .text('COTIZACION', derechaX, y + 8, { width: colW3, align: 'right' });

    let metaY = y + 34;
    doc.fontSize(8).font('Helvetica').fillColor('#000000')
      .text(`Fecha: ${fecha}`, derechaX, metaY, { width: colW3, align: 'right' });
    metaY += 10;
    if (data.id) {
      doc.fillColor('#C05000').font('Helvetica-Bold')
        .text(`No. Cotizacion: ${data.id}`, derechaX, metaY, { width: colW3, align: 'right' });
      doc.fillColor('#000000').font('Helvetica');
      metaY += 10;
    }
    if (data.referencia) {
      doc.fontSize(8).font('Helvetica').fillColor('#000000')
        .text(`Referencia: ${data.referencia}`, derechaX, metaY, { width: colW3, align: 'right' });
    }

    y += 70;
    doc.moveTo(PAGE.margin, y).lineTo(PAGE.margin + CONTENT_W, y)
      .strokeColor('#CCCCCC').lineWidth(0.5).stroke();
    y += 10;

    // === DATOS DEL CLIENTE — 2 columnas ===
    const halfW = CONTENT_W / 2 - 5;

    doc.fontSize(8).font('Helvetica-Bold').fillColor('#000000')
      .text('Datos de Facturacion:', PAGE.margin, y);
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#000000')
      .text('Datos de entrega', PAGE.margin + halfW + 10, y);
    y += 12;

    doc.font('Helvetica').fillColor('#444444').fontSize(7.5);

    const dirFiscal = [c.domicilioFiscal, c.cpFiscal].filter(Boolean).join(', ');
    const dirEntrega = [c.calle, c.numInt, c.colonia, c.cpEntrega, c.municipio, c.estado]
      .filter(Boolean).join(', ');

    const leftLines = [
      (c.razonSocial || c.empresa) ? (c.razonSocial || c.empresa) : '',
      dirFiscal || '',
      c.rfc ? `RFC: ${c.rfc}` : '',
    ].filter(Boolean);

    const rightLines = [
      c.nombreEntrega || '',
      dirEntrega || (c.direccionEntrega || ''),
      c.leyendaDomicilio || '',
      (c.celEntrega || c.telefonoEntrega) ? `Tel: ${c.celEntrega || c.telefonoEntrega}` : '',
      c.emailEntrega ? `Correo: ${c.emailEntrega}` : '',
      (c.nombreCorto || c.referencia) ? `Referencia Cliente: ${c.nombreCorto || c.referencia}` : '',
    ].filter(Boolean);

    const startY = y;
    for (let i = 0; i < leftLines.length; i++) {
      const isBold = i === 0;
      doc.font(isBold ? 'Helvetica-Bold' : 'Helvetica').fillColor('#000000');
      doc.text(leftLines[i], PAGE.margin, y + i * 10, { width: halfW });
    }
    y = startY;
    for (let i = 0; i < rightLines.length; i++) {
      const isBold = i === 0;
      doc.font(isBold ? 'Helvetica-Bold' : 'Helvetica').fillColor('#000000');
      doc.text(rightLines[i], PAGE.margin + halfW + 10, y + i * 10, { width: halfW });
    }
    y += Math.max(leftLines.length, rightLines.length) * 10 + 8;

    // === TABLA COMERCIAL — 5 columnas ===
    const comercialHeaders = [
      'Referencia del Cliente',
      'Representante de Ventas',
      'R.F.C.',
      'No. Cotizacion',
      'Valido hasta',
    ];
    const comercialWidths = [100, 110, 80, 80, CONTENT_W - 370];
    const comercialRow = [
      c.referencia || c.nombreCorto || '',
      data.vendedor || '',
      c.rfc || '',
      data.id ? String(data.id) : '',
      vigencia,
    ];
    y = drawTable(doc, comercialHeaders, [comercialRow], PAGE.margin, y, comercialWidths);
    y += 10;

    // === TERMINOS DE PAGO ===
    if (data.condicionesPago) {
      doc.fontSize(8).font('Helvetica').fillColor('#000000')
        .text(`Terminos de Pago: ${data.condicionesPago}`, PAGE.margin, y);
      y += 14;
    }

    // === TABLA DE PRODUCTOS ===
    const hasImgs = incluirFotos && Object.keys(imgBuffers).length > 0;
    const imgColW = hasImgs ? 32 : 0;

    const prodHeaders = [
      ...(hasImgs ? ['Foto'] : []),
      'Codigo de Articulo',
      'Descripcion del Articulo',
      'Ctdad',
      'Unidad',
      'Precio',
      '% Dscto.',
      'Total',
    ];
    const fixedBase = imgColW + 70 + 42 + 38 + 68 + 42;
    const descW = CONTENT_W - fixedBase - 60;
    const prodWidths = [
      ...(hasImgs ? [imgColW] : []),
      70,
      descW + (hasImgs ? 0 : 0),
      42,
      38,
      68,
      42,
      60,
    ];

    const totalH = 16;
    const prodRowH = hasImgs ? 32 : 14;

    // Header
    doc.rect(PAGE.margin, y, CONTENT_W, totalH).fill('#F0F0F0');
    doc.rect(PAGE.margin, y, CONTENT_W, totalH).stroke('#CCCCCC');
    doc.fontSize(7).font('Helvetica-Bold').fillColor('#000000');
    let cx = PAGE.margin;
    for (let i = 0; i < prodHeaders.length; i++) {
      const align = i >= (hasImgs ? 3 : 2) ? 'right' : 'left';
      doc.text(prodHeaders[i], cx + 3, y + 4, { width: prodWidths[i] - 6, align });
      cx += prodWidths[i];
    }
    y += totalH;

    // Rows
    doc.font('Helvetica').fillColor('#000000').fontSize(7.5);
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (y + prodRowH > PAGE.height - PAGE.margin - 130) {
        doc.addPage();
        y = PAGE.margin;
      }

      const lineTotal = (item.cantidad || 0) * (item.precio || 0) * (1 - (item.descuento || 0) / 100);
      const rowData = [
        ...(hasImgs ? [''] : []),
        item.codigo || '',
        item.descripcion || '',
        String(item.cantidad || ''),
        item.unidad || 'pza',
        fmt(item.precio),
        item.descuento ? `${item.descuento}%` : '',
        fmt(lineTotal),
      ];

      doc.rect(PAGE.margin, y, CONTENT_W, prodRowH).stroke('#CCCCCC');

      cx = PAGE.margin;
      for (let j = 0; j < prodHeaders.length; j++) {
        const align = j >= (hasImgs ? 3 : 2) ? 'right' : 'left';
        if (hasImgs && j === 0) {
          const buf = imgBuffers[item.codigo];
          if (buf) {
            try {
              doc.image(buf, cx + 2, y + 2, { fit: [imgColW - 4, prodRowH - 4] });
            } catch {}
          }
        } else {
          const textY = hasImgs ? y + (prodRowH - 9) / 2 : y + 3;
          doc.text(rowData[j], cx + 3, textY, { width: prodWidths[j] - 6, align });
        }
        cx += prodWidths[j];
      }
      y += prodRowH;
    }

    doc.moveTo(PAGE.margin, y).lineTo(PAGE.margin + CONTENT_W, y)
      .strokeColor('#CCCCCC').lineWidth(0.5).stroke();
    y += 12;

    // === SECCION INFERIOR — notas + totales ===
    const notas = Array.isArray(data.notas) ? data.notas : [];
    const totalsW = CONTENT_W * 0.42;
    const totalsX = PAGE.margin + CONTENT_W - totalsW;
    const notasW = CONTENT_W - totalsW - 20;

    const totalCantidad = items.reduce((sum, item) => sum + (item.cantidad || 0), 0);
    const subtotal = data.subtotal || 0;
    const iva = data.iva || 0;
    const total = data.total || 0;

    const totalRows = [
      [`Sub-Total [${totalCantidad}]`, fmt(subtotal)],
      ['I.V.A. 16% (16%)', fmt(iva)],
      ['TOTAL', fmt(total)],
    ];

    let notasY = y;
    doc.fontSize(7.5).font('Helvetica').fillColor('#555555');
    for (const nota of notas) {
      if (notasY + 10 > PAGE.height - PAGE.margin - 20) break;
      doc.text(`- ${nota}`, PAGE.margin, notasY, { width: notasW });
      notasY += 10;
    }

    let ty = y;
    for (const [label, value] of totalRows) {
      const isTotal = label === 'TOTAL';
      doc.rect(totalsX, ty, totalsW, 14).stroke('#CCCCCC');
      if (isTotal) {
        doc.fontSize(8).font('Helvetica-Bold').fillColor('#000000');
      } else {
        doc.fontSize(7.5).font('Helvetica').fillColor('#000000');
      }
      doc.text(label, totalsX + 4, ty + 3, { width: totalsW * 0.5 - 8 });
      doc.text(value, totalsX + totalsW * 0.5, ty + 3, { width: totalsW * 0.5 - 4, align: 'right' });
      ty += 14;
    }

    y = Math.max(notasY, ty) + 12;

    // === FOOTER ===
    if (y + 30 > PAGE.height - PAGE.margin) {
      doc.addPage();
      y = PAGE.margin;
    }
    doc.moveTo(PAGE.margin, y).lineTo(PAGE.margin + CONTENT_W, y)
      .strokeColor('#CCCCCC').lineWidth(0.5).stroke();
    y += 6;
    doc.fontSize(7.5).font('Helvetica').fillColor('#888888')
      .text('Todas las cantidades se indican en - MXN', PAGE.margin, y)
      .text(BANK, PAGE.margin, y + 10, { width: CONTENT_W });

    // Paginacion
    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.fontSize(7).fillColor('#999999').font('Helvetica')
        .text(`Pagina ${i + 1} de ${pageCount}`,
          PAGE.margin, PAGE.height - PAGE.margin + 10,
          { width: CONTENT_W, align: 'right' });
    }

    doc.end();
  });
}
