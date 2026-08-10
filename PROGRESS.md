# PROGRESS — Prefactura de muestra (tipo CFDI)

**Fecha:** 2026-08-10
**Rama:** `feat-prefactura-prototipo`

## Qué se hizo
Prototipo funcional que genera una **prefactura** (documento de MUESTRA, sin validez fiscal) a
partir de un pedido de Operam, clonando el aspecto del CFDI real de Peltre Nacional. Nació de una
petición puntual (prefactura del pedido 7486 para un cliente) y evolucionó a 6 iteraciones con un
feedback loop basado en geometría (pdfplumber), no "a ojo".

Resultado: en **formato y bordes** es prácticamente indistinguible del CFDI. Diferencias restantes
son intencionales (marca de agua "PREFACTURA", "Nº Prefactura", leyenda de muestra) o de contenido
(otro cliente / 14 vs 8 partidas → 2 páginas).

## Dónde quedó el avance
- `prototipos/prefactura/` — prototipo completo + notas de geometría calcada + ejemplo + comparación.
  Ver `prototipos/prefactura/README.md` (tiene TODA la geometría para portar sin re-derivar).
- Issue de integración: **#132** — https://github.com/chavez-adrian/cotizador-peltre/issues/132

## Decisión de arquitectura clave
El prototipo es **Python + reportlab**; el cotizador es **Node/Express + PDFKit**. La integración
NO es copiar el .py: hay que **portar el layout a PDFKit** en `lib/prefactura-generator.js`. La
geometría (A4, márgenes 14.2pt, fuentes Helvetica 7.5/7.3/6.0, columnas X, esquema de bordes)
está calcada y documentada en el README del prototipo.

## Próximo paso al reanudar
1. `gh issue view 132` para el spec completo.
2. Crear `lib/prefactura-generator.js` (PDFKit) portando el layout del README.
3. `GET /api/prefactura/pdf/:orderNo` (authMiddleware) usando `obtenerPedido` de operam-client.
4. Entrada en la UI (vista de pedidos) + `?descargar=1`.
5. Resolver las 5 decisiones de producto del README (régimen, ClaveProdServ, uso/forma/método,
   salvaguardas no-fiscal, rol que puede generarla).

## Cuidado / salvaguarda
La prefactura NO es un CFDI. Conservar SIEMPRE las marcas de "documento de muestra / sin validez
fiscal" (marca de agua, folio/sellos simulados, leyenda). Nunca generar algo que se pueda confundir
con una factura timbrada real.
