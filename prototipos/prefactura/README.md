# Prototipo: Prefactura de muestra (representación tipo CFDI)

Prototipo funcional que genera una **prefactura** (documento de MUESTRA, sin validez fiscal)
a partir de un pedido de Operam, clonando el aspecto visual del CFDI real de Peltre Nacional.

> **Stack del prototipo:** Python + `reportlab` (generación) + `pdfplumber`/`pypdfium2` (calcar
> geometría del CFDI de referencia). **El runtime del cotizador es Node/Express**, así que para
> integrarlo hay que **portar el layout a PDFKit** (`lib/pdf-generator.js` ya usa PDFKit). Este
> prototipo es la **referencia de diseño**, no el código de producción.

## Archivos
- `gen_prefactura.py` — generador. Lee un pedido (JSON de Operam) y produce el PDF A4.
- `inspect_ref.py` — extrae tamaño de página, fuentes, líneas y columnas del CFDI de referencia.
- `map_borders.py` — mapea cada línea/borde del CFDI a su sección (color, grosor, texto vecino).
- `ejemplo-pedido-7486.json` — detalle real del pedido 7486 (`obtenerPedido(7486)` de Operam).
- `ejemplo-prefactura-v6.pdf` — salida final del prototipo (6 iteraciones).
- `comparacion-vs-cfdi.png` — lado a lado (izq = CFDI real, der = prefactura).

## Geometría CALCADA del CFDI (para portar a PDFKit sin re-derivar)
- **Página:** A4 = 595.28 × 841.89 pt. Márgenes 14.2 pt por lado → ancho útil 566.9 pt.
- **Fuentes:** solo Helvetica y Helvetica-Bold. Tamaños 7.5 (cuerpo/etiquetas), 7.3 (tabla),
  7.0, 6.0 (sellos). Son core fonts → PDFKit las tiene nativas, sin registrar TTF.
- **Columnas de la tabla de conceptos (X absolutas):**
  `14.2 · 65.2 · 240.9 · 292.0 · 337.3 · 405.4 · 462.0 · 507.4 · 581.1`
  (Código · Descripción · Cantidad · Unidad · Precio Unitario · Descuento · Obj.Imp · Importe)
- **Esquema de bordes (lo más sutil):**
  - Encabezado, Cliente/Entrega y filas meta (Orden/Moneda…): **SIN lados ni verticales**;
    solo **reglas horizontales NEGRAS de 0.57 pt** a todo el ancho entre secciones.
  - De "Forma de Pago" hacia abajo (forma + tabla + totales): **caja de borde GRIS 0.87**.
  - Tabla: divisores de columna **negros 0.5** solo en el CUERPO (el encabezado no los lleva);
    separadores de renglón **gris claro**; línea bajo el encabezado de columnas **negra 0.5**.
  - Línea **gris 1.5 pt** (gris 0.345) sobre el bloque fiscal.
- **Alto de renglón en Cliente/Entrega:** pitch ~11.1 pt (padding chico, sección compacta).
- **Encabezado:** logo en x≈16 (80×80 pt en el original); emisor en x≈203; rejilla derecha en x≈373.

## Datos: de dónde salen
- `lib/operam-client.js` → `obtenerPedido(orderNo)` ya devuelve `detalles` (partidas con
  `stk_code`, `description`, `unit_price`, `quantity`) + `debtor` (RFC, cfdi_* fiscales) + branch.
- Totales: subtotal = Σ(precio×cantidad); IVA 16%; total. (Cuadró al centavo con el pedido 7486.)
- Importe con letra: implementado en el prototipo (num→palabras es-MX).

## Decisiones pendientes (dueño de producto) antes de producción
1. **Régimen fiscal del cliente:** Operam no lo trae en el pedido; el prototipo asume `601`.
2. **ClaveProdServ (SAT):** el prototipo la infiere por tipo de producto (52152102 tazas,
   52152004 platos, 52152007 tazones/salseras). Definir la fuente real (¿catálogo Operam?).
3. **Uso CFDI / Método / Forma de pago:** defaults G01 / PPD / 99; ¿tomar del `debtor`?
4. **Salvaguardas de "no fiscal":** marca de agua "PREFACTURA", "Nº Prefactura" en rojo,
   folio/sellos SIMULADOS, leyenda al pie. **Deben conservarse** para que no se confunda con
   un CFDI timbrado real.
5. **Quién puede generarla** (rol/permiso) y desde dónde en la UI.

## Integración sugerida (ver issue)
- `lib/prefactura-generator.js` (PDFKit) — portar el layout de este prototipo.
- `GET /api/prefactura/pdf/:orderNo` (authMiddleware) — lee el pedido de Operam, calcula, genera.
- Entrada en la UI (vista de pedidos / acción "Prefactura") con `?descargar=1` opcional.
