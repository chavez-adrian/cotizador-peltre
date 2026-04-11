import PDFDocument from 'pdfkit';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = join(__dirname, '..', 'data', 'logo_pn.png');
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

const COLORS = {
  dark: '#063995',
  mid: '#1a5ac7',
  light: '#636E72',
  bg: '#F4F6FA',
  headerBg: '#063995',
  border: '#C5CCD8',
  white: '#FFFFFF',
  black: '#2D3436',
};

const PAGE = { width: 612, height: 792, margin: 40 }; // Letter size
const CONTENT_W = PAGE.width - PAGE.margin * 2;

function fmt(n) {
  if (n == null) return '';
  return n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPrice(n) {
  if (n == null) return '';
  return '$ ' + fmt(n);
}

/**
 * Genera el PDF de cotizacion.
 * @param {object} data - Datos de la cotizacion
 * @returns {Promise<Buffer>}
 */
export async function generateQuotePDF(data) {
  // Pre-fetch product images if requested
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
    });

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    let y = PAGE.margin;

    // === HEADER ===
    const hasLogo = existsSync(LOGO_PATH);
    let logoW = 0;

    if (hasLogo) {
      logoW = 110;
      doc.image(LOGO_PATH, PAGE.margin, y, { width: logoW });
    }

    const textX = PAGE.margin + (hasLogo ? logoW + 10 : 0);
    const textW = CONTENT_W * 0.52 - (hasLogo ? logoW + 10 : 0);

    if (!hasLogo) {
      doc.fontSize(16).fillColor(COLORS.dark).font('Helvetica-Bold')
        .text(COMPANY.name, textX, y, { width: textW });
    }

    doc.fontSize(7.5).fillColor(COLORS.light).font('Helvetica')
      .text(COMPANY.legal, textX, hasLogo ? y + 2 : y + 20, { width: textW })
      .text(`R.F.C: ${COMPANY.rfc}`)
      .text(`Tel. ${COMPANY.tel}`)
      .text(`${COMPANY.email}  ·  ${COMPANY.web}`);

    // Titulo COTIZACION a la derecha
    const rightX = PAGE.margin + CONTENT_W * 0.55;
    const rightW = CONTENT_W * 0.45;
    doc.fontSize(22).fillColor(COLORS.dark).font('Helvetica-Bold')
      .text('COTIZACION', rightX, y, { width: rightW, align: 'right' });

    const fecha = data.fecha || new Date().toISOString().split('T')[0];
    const vigencia = data.vigencia || '';
    doc.fontSize(8).fillColor(COLORS.black).font('Helvetica')
      .text(`Fecha: ${fecha}`, rightX, y + 28, { width: rightW, align: 'right' });
    if (vigencia) {
      doc.text(`Válido hasta: ${vigencia}`, { width: rightW, align: 'right' });
    }
    if (data.tier) {
      doc.text(`Precio tier: ${data.tier}`, { width: rightW, align: 'right' });
    }

    y += 70;
    doc.moveTo(PAGE.margin, y).lineTo(PAGE.margin + CONTENT_W, y)
      .strokeColor(COLORS.dark).lineWidth(1.5).stroke();
    y += 8;

    // === DATOS DEL CLIENTE ===
    const c = data.cliente || {};
    const colW = CONTENT_W / 2 - 5;

    doc.fontSize(8).font('Helvetica-Bold').fillColor(COLORS.dark)
      .text('Datos de Facturación:', PAGE.margin, y);
    doc.fontSize(8).font('Helvetica-Bold').fillColor(COLORS.dark)
      .text('Datos de entrega:', PAGE.margin + colW + 10, y);
    y += 12;

    doc.font('Helvetica').fillColor(COLORS.black).fontSize(7.5);

    // Dirección de entrega compuesta
    const dirEntrega = [c.calle, c.numInt, c.colonia, c.cpEntrega, c.municipio, c.estado]
      .filter(Boolean).join(', ');

    const leftLines = [
      (c.razonSocial || c.empresa) ? `Empresa: ${c.razonSocial || c.empresa}` : '',
      c.rfc ? `RFC: ${c.rfc}` : '',
      c.cpFiscal ? `CP fiscal: ${c.cpFiscal}` : '',
    ].filter(Boolean);

    const rightLines = [
      c.nombreEntrega ? `Entregar a: ${c.nombreEntrega}` : '',
      dirEntrega ? `Dirección: ${dirEntrega}` : (c.direccionEntrega ? `Dirección: ${c.direccionEntrega}` : ''),
      c.referencias ? `Ref: ${c.referencias}` : '',
      (c.celEntrega || c.telefonoEntrega) ? `Tel: ${c.celEntrega || c.telefonoEntrega}` : '',
      c.emailEntrega ? `Correo: ${c.emailEntrega}` : '',
      c.referencia ? `Referencia: ${c.referencia}` : '',
    ].filter(Boolean);

    const maxLines = Math.max(leftLines.length, rightLines.length);
    for (let i = 0; i < maxLines; i++) {
      if (leftLines[i]) doc.text(leftLines[i], PAGE.margin, y, { width: colW });
      if (rightLines[i]) doc.text(rightLines[i], PAGE.margin + colW + 10, y, { width: colW });
      y += 10;
    }
    y += 6;

    // === INFO COMERCIAL ===
    doc.moveTo(PAGE.margin, y).lineTo(PAGE.margin + CONTENT_W, y)
      .strokeColor(COLORS.border).lineWidth(0.5).stroke();
    y += 6;

    const infoItems = [
      ['Representante de Ventas', data.vendedor || ''],
      ['Condiciones de Pago', data.condicionesPago || 'Anticipo 50%'],
    ].filter(([, v]) => v);

    doc.fontSize(7.5).font('Helvetica');
    for (const [label, value] of infoItems) {
      doc.font('Helvetica-Bold').fillColor(COLORS.dark).text(`${label}: `, PAGE.margin, y, { continued: true });
      doc.font('Helvetica').fillColor(COLORS.black).text(value);
      y += 10;
    }
    y += 8;

    // === TABLA DE PRODUCTOS ===
    const hasImgs = incluirFotos && Object.keys(imgBuffers).length > 0;
    const imgColW = hasImgs ? 30 : 0;
    const cols = [
      ...(hasImgs ? [{ label: '', w: imgColW, align: 'center', isImg: true }] : []),
      { label: 'Código', w: 70, align: 'left' },
      { label: 'Descripción', w: hasImgs ? 165 : 195, align: 'left' },
      { label: 'Ctdad', w: 42, align: 'right' },
      { label: 'Unidad', w: 38, align: 'center' },
      { label: 'Precio', w: 68, align: 'right' },
      { label: '% Dscto.', w: 42, align: 'right' },
    ];
    const fixedW = cols.reduce((s, c) => s + c.w, 0);
    cols.push({ label: 'Total', w: CONTENT_W - fixedW, align: 'right' });

    // Header
    let x = PAGE.margin;
    doc.rect(PAGE.margin, y, CONTENT_W, 16).fill(COLORS.headerBg);
    doc.fontSize(7).font('Helvetica-Bold').fillColor(COLORS.white);
    for (const col of cols) {
      doc.text(col.label, x + 3, y + 4, { width: col.w - 6, align: col.align });
      x += col.w;
    }
    y += 16;

    // Rows
    const items = data.items || [];
    doc.font('Helvetica').fillColor(COLORS.black).fontSize(7.5);
    const rowH = hasImgs ? 30 : 14;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      // Page break check
      if (y + rowH > PAGE.height - PAGE.margin - 120) {
        doc.addPage();
        y = PAGE.margin;
      }

      if (i % 2 === 1) {
        doc.rect(PAGE.margin, y, CONTENT_W, rowH).fill(COLORS.bg);
        doc.fillColor(COLORS.black);
      }

      x = PAGE.margin;
      const lineTotal = (item.cantidad || 0) * (item.precio || 0) * (1 - (item.descuento || 0) / 100);
      const rowData = [
        ...(hasImgs ? [''] : []),
        item.codigo || '',
        item.descripcion || '',
        (item.cantidad || '').toString(),
        item.unidad || 'pza',
        fmt(item.precio),
        item.descuento ? `${item.descuento}%` : '',
        fmt(lineTotal),
      ];

      for (let j = 0; j < cols.length; j++) {
        const col = cols[j];
        if (col.isImg) {
          const buf = imgBuffers[item.codigo];
          if (buf) {
            try {
              doc.image(buf, x + 2, y + 2, { fit: [imgColW - 4, rowH - 4], align: 'center', valign: 'center' });
            } catch {}
          }
        } else {
          const textY = hasImgs ? y + (rowH - 9) / 2 : y + 3;
          doc.text(rowData[j], x + 3, textY, { width: col.w - 6, align: col.align });
        }
        x += col.w;
      }
      y += rowH;
    }

    // Bottom border of table
    doc.moveTo(PAGE.margin, y).lineTo(PAGE.margin + CONTENT_W, y)
      .strokeColor(COLORS.border).lineWidth(0.5).stroke();
    y += 12;

    // === TOTALES ===
    const totalsW = CONTENT_W * 0.42;
    const totalsX = PAGE.margin + CONTENT_W - totalsW;

    const subtotal = data.subtotal || 0;
    const iva = data.iva || 0;
    const total = data.total || 0;

    let ty = y;
    const totalRows = [
      [`Sub-Total [${items.length}]`, fmtPrice(subtotal)],
      ['I.V.A. 16%', fmtPrice(iva)],
      ['TOTAL', fmtPrice(total)],
    ];

    for (const [label, value] of totalRows) {
      const isTotal = label === 'TOTAL';
      if (isTotal) {
        doc.rect(totalsX, ty, totalsW, 14).fill(COLORS.headerBg);
        doc.fontSize(8).font('Helvetica-Bold').fillColor(COLORS.white);
      } else {
        doc.fontSize(7.5).font('Helvetica').fillColor(COLORS.black);
      }
      doc.text(label, totalsX + 4, ty + 3, { width: totalsW * 0.5 - 8 });
      doc.text(value, totalsX + totalsW * 0.5, ty + 3, { width: totalsW * 0.5 - 4, align: 'right' });
      ty += 14;
    }

    y = ty + 12;

    // === NOTAS ===
    const notas = data.notas || [
      'Precios EXW Ixtapaluca, Estado de México. No incluye envío.',
      'Envío a costo y riesgo del cliente.',
      'Tiempo de entrega: 6 semanas contadas a partir del pago del anticipo.',
      'Se requiere 50% de anticipo para comenzar la producción.',
      'Pago del saldo previo a la entrega.',
    ];

    doc.fontSize(7).fillColor(COLORS.black).font('Helvetica');
    for (const nota of notas) {
      if (y + 10 > PAGE.height - PAGE.margin - 20) {
        doc.addPage();
        y = PAGE.margin;
      }
      doc.text(`- ${nota}`, PAGE.margin, y, { width: CONTENT_W });
      y += 10;
    }

    y += 8;
    doc.fontSize(7).fillColor(COLORS.light).font('Helvetica')
      .text('Todas las cantidades se indican en MXN', PAGE.margin, y);

    // === FOOTER ===
    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.fontSize(7).fillColor(COLORS.light).font('Helvetica')
        .text(`Página ${i + 1} de ${pageCount}`,
          PAGE.margin, PAGE.height - PAGE.margin + 10,
          { width: CONTENT_W, align: 'right' });
    }

    doc.end();
  });
}
