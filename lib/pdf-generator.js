import PDFDocument from 'pdfkit';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { importeLinea } from '../public/js/cotizar-logica.js';
import { referenciaDelCliente } from './referencia-cliente.js';

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

// Geometria calcada del PDF oficial de Operam (TCPDF, A4); ver
// scratchpad cotizacion-operam-referencia.pdf. Unidades pt, top desde arriba.
const PAGE = { width: 595.28, height: 841.89 };
const MARGEN = 22.7;
const DER = 572.6;
const CAJA_X = 26.8;
const CAJA_W = DER - CAJA_X;

const NEGRO = '#000000';
const GRIS_TITULO = '#CCCCCC';
const ROJO_FOLIO = '#FF0000';
const GRIS_LINEA = '#808080';
const GRIS_CAJA = '#DDDDDD';

const PASO_73 = 9.15;
const PASO_75 = 9.35;
const FILA_PAD = 5.4;
const FILA_BASE = 8.05;

const COLS_REF = [22.7, 132.7, 242.6, 352.6, 462.6, DER];
const COLS_ITEMS = [26.8, 81.4, 299.7, 354.3, 408.9, 463.4, 518.0, DER];
const FOTO_W = 54.6;

const TOPE_FILAS = 770;
const TOPE_BLOQUE = 788;
const CONT_TOP = 30;
const PIE_Y = 800.8;

function fmt(n) {
  if (n == null) return '0.00';
  return n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function linea(doc, x0, x1, y, grosor, color) {
  doc.moveTo(x0, y).lineTo(x1, y).lineWidth(grosor).strokeColor(color).stroke();
}

function lineaSegmentada(doc, cortes, y, grosor, color) {
  for (let i = 0; i < cortes.length - 1; i++) {
    linea(doc, cortes[i], cortes[i + 1], y, grosor, color);
  }
}

function lineasDe(doc, texto, ancho) {
  if (!texto) return 1;
  const h = doc.heightOfString(String(texto), { width: ancho, lineGap: 0 });
  return Math.max(1, Math.round(h / doc.currentLineHeight(true)));
}

function gapPara(doc, paso) {
  return paso - doc.currentLineHeight(true);
}

// pdfminer (con el que se midio la referencia TCPDF) reporta el top del texto
// con un ascender mayor que el que usa PDFKit para colocarlo; este corrimiento
// hace que el texto CAIGA donde la referencia lo reporta.
function aj(size, bold) {
  return (bold ? 0.075 : 0.0685) * size;
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
      size: [PAGE.width, PAGE.height],
      margin: 0,
      bufferPages: true,
      compress: data._compress !== false,
    });

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const c = data.cliente || {};
    // Misma cadena que el cust_ref del quote de Operam (#241): el documento del
    // cliente y el ERP salen de la misma fuente y cortan en el mismo punto -- el
    // truncado a 60 vive en el nucleo, no en el consumidor de Operam.
    const refCliente = referenciaDelCliente(c);
    const items = data.items || [];
    const fecha = data.fecha || new Date().toISOString().split('T')[0];
    const vigencia = data.vigencia || '';
    // El numero de la cotizacion ES el folio de Operam (ADR-0009), nunca el id
    // interno del registro. Lo resuelve un solo punto del server y llega aqui ya
    // decidido; sin folio el documento sale como PRE-COTIZACION explicita.
    const folio = data.folio != null && data.folio !== '' ? String(data.folio) : '';

    // === ENCABEZADO ===
    if (existsSync(LOGO_PATH)) {
      doc.image(LOGO_PATH, 26.7, 23.7, { width: 80, height: 80 });
    } else {
      doc.fontSize(10).font('Helvetica-Bold').fillColor(NEGRO)
        .text(COMPANY.name, 26.7, 55, { width: 170, lineBreak: false });
    }

    const aj73 = aj(7.3, false);
    doc.fontSize(7.3).font('Helvetica').fillColor(NEGRO);
    doc.text(COMPANY.name, 206.2, 25.0 + aj73, { lineBreak: false });
    doc.text(`Tel. ${COMPANY.tel}`, 206.2, 43.3 + aj73, { lineBreak: false });
    doc.text(`e-Mail: ${COMPANY.email}`, 206.2, 52.4 + aj73, { lineBreak: false });
    doc.text(`R.F.C: ${COMPANY.rfc}`, 206.2, 61.5 + aj73, { lineBreak: false });

    doc.fontSize(20).font('Helvetica-Bold').fillColor(GRIS_TITULO)
      .text(folio ? 'COTIZACION' : 'PRE-COTIZACION', 300, 27.7 + aj(20, true), { width: 240.7, align: 'right' });

    doc.fontSize(7.3).font('Helvetica').fillColor(NEGRO);
    let metaY = 50.0;
    doc.text('Fecha:', 379.2, metaY + aj73, { lineBreak: false });
    doc.text(fecha, 477.0, metaY + aj73, { lineBreak: false });
    metaY += PASO_73;
    if (folio) {
      doc.text('N\u00ba Cotizaci\u00f3n:', 379.2, metaY + aj73, { lineBreak: false });
      doc.fillColor(ROJO_FOLIO).text(folio, 477.0, metaY + aj73, { lineBreak: false });
      doc.fillColor(NEGRO);
      metaY += PASO_73;
    }
    if (data.referencia) {
      doc.text('Referencia:', 379.2, metaY + aj73, { lineBreak: false });
      doc.text(String(data.referencia), 477.0, metaY + aj73, { lineBreak: false });
    }

    linea(doc, MARGEN, DER, 108.0, 0.57, NEGRO);

    // === DOMICILIOS (2 columnas, labels Bold pegados al valor) ===
    const gap73 = gapPara(doc, PASO_73);
    const filaDomicilio = (x, top, ancho, partes) => {
      doc.fontSize(7.3);
      const topDibujo = top + aj73;
      for (let i = 0; i < partes.length; i++) {
        const { t, bold } = partes[i];
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(NEGRO);
        const opts = { width: ancho, lineGap: gap73, continued: i < partes.length - 1 };
        if (i === 0) doc.text(t, x, topDibujo, opts);
        else doc.text(t, opts);
      }
      const usadas = Math.max(1, Math.round((doc.y - topDibujo) / PASO_73));
      return top + 11.27 + (usadas - 1) * PASO_73;
    };

    const dirEntrega = [c.calle, c.numInt, c.colonia, c.cpEntrega, c.municipio, c.estado]
      .filter(Boolean).join(', ');

    const filasIzq = [[{ t: 'Datos de Facturaci\u00f3n:', bold: false }]];
    if (c.razonSocial || c.empresa) {
      filasIzq.push([{ t: 'Company Name ', bold: true }, { t: String(c.razonSocial || c.empresa), bold: false }]);
    }
    if (c.cpFiscal) filasIzq.push([{ t: 'Direcci\u00f3n:', bold: true }, { t: String(c.cpFiscal), bold: false }]);
    if (c.rfc) filasIzq.push([{ t: 'Rfc:', bold: true }, { t: String(c.rfc), bold: false }]);

    const filasDer = [[{ t: 'Datos de entrega', bold: false }]];
    if (c.nombreEntrega) filasDer.push([{ t: 'Entregar a:', bold: true }, { t: String(c.nombreEntrega), bold: false }]);
    const dirDer = dirEntrega || c.direccionEntrega || '';
    if (dirDer) filasDer.push([{ t: 'Direcci\u00f3n:', bold: true }, { t: String(dirDer), bold: false }]);
    if (c.leyendaDomicilio) filasDer.push([{ t: String(c.leyendaDomicilio), bold: false }]);
    if (c.celEntrega || c.emailEntrega) {
      const fila = [{ t: 'Tel\u00e9fono:', bold: true }];
      if (c.emailEntrega) {
        fila.push({ t: `${c.celEntrega || ''} , `, bold: false });
        fila.push({ t: 'Correo:', bold: true });
        fila.push({ t: String(c.emailEntrega), bold: false });
      } else {
        fila.push({ t: String(c.celEntrega), bold: false });
      }
      filasDer.push(fila);
    }
    if (refCliente) filasDer.push([{ t: 'Referencia Cliente:', bold: true }, { t: refCliente, bold: false }]);

    let yIzq = 110.6;
    for (const partes of filasIzq) yIzq = filaDomicilio(27.7, yIzq, 267, partes);
    let yDer = 110.6;
    for (const partes of filasDer) yDer = filaDomicilio(302.7, yDer, DER - 302.7, partes);

    const regla2 = Math.max(yIzq, yDer) - 2.3;
    linea(doc, MARGEN, DER, regla2, 0.57, NEGRO);

    // === TABLA DE REFERENCIA (5 columnas iguales) ===
    const celda = (texto, top, x0, x1, opciones) => {
      const { align = 'center', bold = false } = opciones || {};
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.5).fillColor(NEGRO);
      const ancho = x1 - x0 - 8;
      const x = align === 'right' ? x0 : x0 + 4;
      doc.text(String(texto), x, top + aj(7.5, bold), { width: ancho, align, lineGap: gapPara(doc, PASO_75) });
    };

    const headersRef = ['Referencia del Cliente', 'Representante de Ventas', 'R.F.C.', 'N\u00ba Cotizaci\u00f3n', 'Valido hasta'];
    const valoresRef = [refCliente, data.vendedor || '', c.rfc || '', folio, vigencia];

    const cajaRefTop = regla2 + 4.9;
    const headerRefTop = cajaRefTop + 14.9;
    doc.font('Helvetica-Bold').fontSize(7.5);
    let hdrRefLineas = 1;
    for (let i = 0; i < headersRef.length; i++) {
      hdrRefLineas = Math.max(hdrRefLineas, lineasDe(doc, headersRef[i], COLS_REF[i + 1] - COLS_REF[i] - 8));
    }
    for (let i = 0; i < headersRef.length; i++) {
      celda(headersRef[i], headerRefTop, COLS_REF[i], COLS_REF[i + 1], { bold: true });
    }
    const reglaRef = headerRefTop + hdrRefLineas * PASO_75 + 2.45;
    lineaSegmentada(doc, COLS_REF, reglaRef, 0.5, NEGRO);

    doc.font('Helvetica').fontSize(7.5);
    let valRefLineas = 1;
    for (let i = 0; i < valoresRef.length; i++) {
      valRefLineas = Math.max(valRefLineas, lineasDe(doc, valoresRef[i], COLS_REF[i + 1] - COLS_REF[i] - 8));
    }
    for (let i = 0; i < valoresRef.length; i++) {
      if (valoresRef[i]) celda(valoresRef[i], reglaRef + FILA_PAD, COLS_REF[i], COLS_REF[i + 1], {});
    }
    const fondoRef = reglaRef + FILA_BASE + valRefLineas * PASO_75;
    lineaSegmentada(doc, COLS_REF, fondoRef, 0.3, GRIS_LINEA);
    doc.rect(MARGEN, cajaRefTop, DER - MARGEN, fondoRef - cajaRefTop)
      .lineWidth(0.5).strokeColor(GRIS_CAJA).stroke();

    // === TERMINOS DE PAGO ===
    if (data.condicionesPago) {
      doc.fontSize(7.5).font('Helvetica').fillColor(NEGRO)
        .text(`T\u00e9rminos de Pago: ${data.condicionesPago}`, MARGEN, fondoRef + 20.1 + aj(7.5, false), { lineBreak: false });
    }

    // === TABLA DE PARTIDAS ===
    const conFotos = incluirFotos && Object.keys(imgBuffers).length > 0;
    let cols = COLS_ITEMS;
    if (conFotos) {
      // La columna Foto roba ancho a Descripcion; el resto de cortes no se mueve.
      cols = [CAJA_X, CAJA_X + FOTO_W, CAJA_X + FOTO_W + 54.6, 299.7, 354.3, 408.9, 463.4, 518.0, DER];
    }
    const headersItems = [
      ...(conFotos ? ['Foto'] : []),
      'C\u00f3digo de Art\u00edculo', 'Descripci\u00f3n del Art\u00edculo', 'Ctdad', 'Unidad', 'Precio', '% Dscto.', 'Total',
    ];

    const cajas = [];
    const abrirTabla = (top) => {
      const hTop = top + 14.9;
      doc.font('Helvetica-Bold').fontSize(7.5);
      let hLineas = 1;
      for (let i = 0; i < headersItems.length; i++) {
        hLineas = Math.max(hLineas, lineasDe(doc, headersItems[i], cols[i + 1] - cols[i] - 8));
      }
      for (let i = 0; i < headersItems.length; i++) {
        celda(headersItems[i], hTop, cols[i], cols[i + 1], { bold: true });
      }
      const regla = hTop + hLineas * PASO_75 + 2.45;
      lineaSegmentada(doc, cols, regla, 0.5, NEGRO);
      cajas.push({ page: doc.bufferedPageRange().count - 1, top });
      return regla;
    };
    const cerrarCaja = (fondo) => {
      const caja = cajas[cajas.length - 1];
      caja.fondo = fondo;
    };

    let reglaY = abrirTabla(fondoRef + 46.9);

    doc.font('Helvetica').fontSize(7.5);
    for (const item of items) {
      const lineaTotal = importeLinea(item);
      const celdas = [
        ...(conFotos ? [{ img: imgBuffers[item.codigo] }] : []),
        { t: item.codigo || '', align: 'center', valign: 'centro' },
        { t: item.descripcion || '', align: 'center' },
        { t: String(item.cantidad || ''), align: 'right' },
        { t: item.unidad || 'pza', align: 'center' },
        { t: fmt(item.precio), align: 'right' },
        { t: item.descuento ? `${item.descuento}%` : '', align: 'right' },
        { t: fmt(lineaTotal), align: 'right', valign: 'fondo' },
      ];
      let L = 1;
      for (let i = 0; i < celdas.length; i++) {
        if (celdas[i].img !== undefined) continue;
        celdas[i].lineas = lineasDe(doc, celdas[i].t, cols[i + 1] - cols[i] - 8);
        L = Math.max(L, celdas[i].lineas);
      }
      if (conFotos) L = Math.max(L, 3);
      const filaH = FILA_BASE + L * PASO_75;

      if (reglaY + filaH > TOPE_FILAS) {
        cerrarCaja(reglaY);
        doc.addPage();
        reglaY = abrirTabla(CONT_TOP);
        doc.font('Helvetica').fontSize(7.5);
      }

      for (let i = 0; i < celdas.length; i++) {
        const cel = celdas[i];
        if (cel.img !== undefined) {
          if (cel.img) {
            try {
              doc.image(cel.img, cols[i] + 4, reglaY + 2, {
                fit: [cols[i + 1] - cols[i] - 8, filaH - 4],
              });
            } catch {}
          }
          continue;
        }
        if (!cel.t) continue;
        let extra = 0;
        if (cel.valign === 'centro') extra = Math.floor((L - cel.lineas) / 2);
        else if (cel.valign === 'fondo') extra = L - cel.lineas;
        celda(cel.t, reglaY + FILA_PAD + extra * PASO_75, cols[i], cols[i + 1], { align: cel.align });
      }
      reglaY += filaH;
      lineaSegmentada(doc, cols, reglaY, 0.3, GRIS_LINEA);
    }

    // === NOTAS + TOTALES (dentro de la misma caja) ===
    const notas = Array.isArray(data.notas) ? data.notas : [];
    const totalCantidad = items.reduce((sum, item) => sum + (item.cantidad || 0), 0);
    const filasTotales = [
      [`Sub-Total [${totalCantidad}]`, fmt(data.subtotal || 0), false],
      ['I.V.A. 16% (16%)', fmt(data.iva || 0), false],
      ['TOTAL', fmt(data.total || 0), true],
    ];

    const notasW = 320;
    doc.font('Helvetica').fontSize(7.5);
    let lineasNotas = 0;
    for (const nota of notas) lineasNotas += lineasDe(doc, `- ${nota}`, notasW);
    const altoBloque = Math.max(lineasNotas * PASO_75, 2 * 17.4 + PASO_75) + 2.55;

    if (reglaY + 22.7 + altoBloque > TOPE_BLOQUE) {
      cerrarCaja(reglaY);
      doc.addPage();
      reglaY = abrirTabla(CONT_TOP);
    }

    const bloqueTop = reglaY + 22.7;
    doc.font('Helvetica').fontSize(7.5).fillColor(NEGRO);
    let notaY = bloqueTop;
    for (const nota of notas) {
      doc.text(`- ${nota}`, 30.8, notaY + aj(7.5, false), { width: notasW, lineGap: gapPara(doc, PASO_75) });
      notaY += lineasDe(doc, `- ${nota}`, notasW) * PASO_75;
    }

    let totY = bloqueTop;
    for (const [etiqueta, monto, esTotal] of filasTotales) {
      doc.font(esTotal ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.5).fillColor(NEGRO)
        .text(etiqueta, 362.5, totY + aj(7.5, esTotal), { lineBreak: false });
      doc.font('Helvetica')
        .text(monto, 450, totY + aj(7.5, false), { width: 564.6 - 450, align: 'right', lineBreak: false });
      totY += 17.4;
    }
    const fondoCaja = Math.max(notaY, totY - 17.4 + PASO_75) + 2.55;
    cerrarCaja(fondoCaja);

    // Cajas grises solo-trazo de cada pagina de partidas
    const rango = doc.bufferedPageRange();
    for (const caja of cajas) {
      doc.switchToPage(caja.page);
      doc.rect(CAJA_X, caja.top, CAJA_W, caja.fondo - caja.top)
        .lineWidth(0.5).strokeColor(GRIS_CAJA).stroke();
    }

    // === PIE Y PAGINACION (en todas las paginas) ===
    for (let i = 0; i < rango.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(6).font('Helvetica').fillColor(NEGRO)
        .text(`Pagina ${i + 1} de ${rango.count}`, 400, 15.3 + aj(6, false), { width: 160.3, align: 'right' });
      doc.fontSize(7.5)
        .text('Todas las cantidades se indican en - MXN', CAJA_X, PIE_Y + aj(7.5, false), { lineBreak: false });
      doc.text(BANK, CAJA_X, PIE_Y + 9.3 + aj(7.5, false), { width: CAJA_W, lineGap: gapPara(doc, PASO_75) });
    }

    doc.end();
  });
}
