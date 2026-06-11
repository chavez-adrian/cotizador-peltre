# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # desarrollo con hot-reload (--watch)
npm start            # produccion
npm test             # todos los tests (280, 0 fallas esperadas)

# Correr un test individual:
node --test test/server.test.js
node --test test/operam-client.test.js
node --test --test-concurrency=1 public/js/__tests__/csf.test.cjs
```

> `--test-concurrency=1` es obligatorio cuando los tests comparten estado global (`globalThis.fetch` mock o `cotizaciones.json`). Sin el los tests se interfieren.

## Documentos de contexto del proceso comercial

Antes de trabajar en cambios al flujo de clientes, leer:

- `PROCESO_COMERCIAL_AS_IS.md` — narrativa completa del proceso comercial de Peltre Nacional (mayoreo, sistemas, cotización, producción, envío).
- `SOP_crear_cliente_operam.md` — procedimiento oficial de 45 pasos para dar de alta un cliente en Operam, con checklist de validación.
- `MAPEO_CAMPOS_CLIENTE.md` — mapeo cruzado de campos entre SOP, formularios del cotizador, API de Operam y Neon DB. Incluye gaps y valores hardcodeados vs SOP. Es la base del PRD pendiente.

---

## Arquitectura

El proyecto es un servidor Express monolitico (`server.js`) con frontend vanilla JS (`public/js/app.js`, ~2500 lineas). Sin frameworks frontend, sin bundlers.

`public/js/alta-logica.js` es un modulo ES sin efectos de navegador que concentra la logica pura del flujo de alta de cliente (parseo de CSF, diff fiscal, payload de `/api/crear-cliente`, combinacion de telefono). `app.js` lo importa de forma nativa (`<script type="module">`); los tests lo consumen via `import()` dinamico (ver seccion Tests) — un mismo modulo, dos consumidores, cero copias espejo (resolucion de "Especie A" del Candidato 2 de `architecture-review-cotizador-20260606.html`, issue #36).

### Flujo de datos principal

```
Browser (app.js) → /api/*                        → server.js → lib/* → Operam v3 API / envia.com
                                                             → data/*.json (persistencia en disco)
                                                             → pdfkit / html-generator
                 → /api/crear-cliente             → lib/operam-client.js → Operam
                 → /api/buscar-cliente            → lib/db.js            → Neon (clientes_log)
                 → /api/actualizar-cliente/:id                           → lib/dropbox.js → Dropbox
                 → /api/log
                 → /api/csf-from-url              → SAT (proxy QR)
```

### Modulos lib/

| Modulo | Que hace |
|--------|----------|
| `operam-client.js` | Bearer token auth con auto-refresh en 401. Exporta `buscarClientes`, `obtenerDomicilios`, `subirCotizacionOperam`, `actualizarCliente`, `actualizarClienteDirecto`, `buscarClientePorRFC`, `crearCliente`, `actualizarBranchCliente`, `resetSession` |
| `db.js` | Pool pg con DATABASE_URL. Exporta `query(sql, params)`. Retorna null si no hay pool (graceful). Auto-crea tabla `clientes_log` en Neon al iniciar. |
| `dropbox.js` | OAuth token refresh. Exporta `upload(path, content)` y `subirCsfDropbox(pdfBase64, rfc, nombre)` |
| `parsear-csf.js` | Funcion pura — extrae RFC, razon social, domicilio, regimen de texto de PDF de CSF del SAT |
| `pdf-generator.js` | PDFKit, llama a URLs de imagenes de Shopify en tiempo real si `incluirFotos: true` |
| `html-generator.js` | HTML auto-contenido para WhatsApp, mismo formato visual que el PDF |
| `calcular-envio.js` | Convierte carrito en paquetes fisicos para envia.com; lee `data/cajas.json` y `data/precios.json` (campo `boxMap`) |
| `extract-prices.js` | Parsea Excel maestro de precios (hoja `precios_pna`) → `data/precios.json` |
| `validar-cp.js` | Funcion pura para validar CP por pais |

### Catalogos

`GET /api/catalogos` — sirve datos para los selectores del formulario de alta:
- `segmentos`: hardcodeados con los ids internos REALES de Operam (11 segmentos; id=1 es "Sin segmento", id=14 "Distribuidores", etc. — la clave 000-1000 de la UI de Operam NO es el id de la API; verificado contra produccion 2026-06-10; Operam no expone catalogo de segmentos, GET segments responde 501)
- `vendedores`: de `data/vendedores.json` filtrando `operam_id != null`
- `listas_precios`: de `GET /api/v3/sales/sales_types`, filtradas a mayoreo: M100/350/550/1500/6000/6001 + US100/350/550/1500/6000

> `data/vendedores.json` tiene dos espacios de ID: `id` (interno del cotizador, secuencial) y `operam_id` (ID en Operam, no secuencial). El campo `salesman` que va al body de Operam usa `operam_id`.

### Persistencia

- Neon Postgres (`DATABASE_URL`) — tablas `cotizaciones` (historial + seguimientos + estado, via `lib/cotizaciones-store.js`) y `clientes_log` (auditoria de altas). El store cae a `data/cotizaciones.json` cuando no hay `DATABASE_URL` (dev local y tests); el disco de Render es efimero, asi que en produccion la fuente de verdad es Neon.
- `data/*.json` — vendedores, precios, cajas, config. Leidos/escritos sincronicamente.
- Migracion historica: `scripts/migrar-cotizaciones-neon.mjs` (idempotente, corrida el 2026-06-10; excluyo entradas de vendedores Test/Tester).

### Auth

Dos niveles:
- **Rutas del cotizador**: JWT de 30 dias. `vendedores.json` contiene ID + PIN. El rol `admin` desbloquea `/api/admin/*`.
- **Rutas CSF** (`/api/crear-cliente`, `/api/buscar-cliente`, `/api/actualizar-cliente/:id`, `/api/log`, `/api/csf-from-url`): protegidas con `authMiddleware` igual que el resto del cotizador — el alta de cliente vive unicamente en el acordeon de `app.js` (autenticado), tras el retiro de la herramienta standalone `csf-upload.html` (ADR-0003).

`server.js` carga `.env` manualmente sin dotenv (patron en lineas 24-30).

### Tests

**Backend** (`test/`): ES modules, `node:test` + `supertest`. El app se importa sin `listen()` gracias al guard `isMain` en `server.js`.

**Frontend** (`public/js/__tests__/`): CommonJS (`.cjs`). No hay DOM. Las funciones puras compartidas con `app.js` (ex-"Especie A": parseo CSF, diff fiscal, payload de alta, telefono) viven en `public/js/alta-logica.js` (modulo ES) y se importan en el test con `await import('../alta-logica.js')` dentro de un hook `before()` (`app.js` no puede importarse en Node por sus efectos de borde de navegador en scope de modulo — `localStorage`, `window.x = fn` — de ahi la necesidad de un modulo intermedio sin esos efectos). El resto de funciones puras (specs de estado/payloads/HTML con contraparte real, p.ej. `buildAltaDomicilioPayload`, `buildDedupExactoHtml`) viven en `helpers.cjs` y se prueban con `require`.

> Eliminadas en la resolucion de "Especie B" (issue #36): `buildDedupRequest`, `buildDedupDomiciliosRequest`, `buildActualizarFiscalRequest`, `buildCargarCatalogosRequest` describian una forma `{ url, method, body, headers: { Authorization } }` que el codigo real NUNCA construye — `api()` (app.js) inyecta `Authorization` desde `state.token` internamente, sin que el caller arme ese objeto ni reciba un `authHeader`. Eran tests tautologicos (la funcion de test devolvia un literal y el test afirmaba ese mismo literal) que no cubrian comportamiento de `app.js` ni del backend. Si se requiere cobertura real de esas rutas, el lugar correcto es un test de integracion `supertest` en `test/`, no una funcion pura que repita el contrato.

**Patron mock Operam**: `mockFetchByUrl(urlHandlers)` en los tests intercepta por substring de URL (`/login`, `/customers`, etc.) y restaura el original al terminar.

**Patron mock para rutas CSF**: `mockOperamFetch(handlers)` en `test/server.test.js` — misma logica.

**Testear PDFs**: pasar `_compress: false` en los datos para desactivar FlateDecode; luego buscar strings con `buffer.toString('latin1').includes(str)`.

## Integraciones externas

- **Operam ERP v3**: `OPERAM_URL` + `OPERAM_USER` + `OPERAM_PASSWORD`. Company ID: `346`. Auth por Bearer token.
- **Neon Postgres**: `DATABASE_URL`. Tabla `clientes_log` con schema auto-creado. Solo para log de altas CSF.
- **Dropbox**: `DROPBOX_REFRESH_TOKEN` + `DROPBOX_APP_KEY` + `DROPBOX_APP_SECRET`. Backup de PDFs de CSF. Fire-and-forget — fallo no bloquea la respuesta HTTP.
- **envia.com**: `ENVIA_API_KEY`. Se consultan FedEx, DHL y UPS en paralelo con `Promise.allSettled`.
- **Shopify**: `SHOPIFY_API_TOKEN` (solo para el script `scripts/fetch-shopify-images.js`).
- **SAT Mexico**: proxy en `/api/csf-from-url` para leer QR codes de CSF cuando el PDF no tiene texto extraible.

## Deploy

Render.com (free tier). Auto-deploy desde `main`. Config en `render.yaml`.

Variables configuradas en el dashboard de Render (no en `render.yaml`):
- `OPERAM_URL`, `OPERAM_USER`, `OPERAM_PASSWORD`
- `DATABASE_URL` (Neon — misma DB que usaba operam-server)
- `DROPBOX_REFRESH_TOKEN`, `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET`
- `ENVIA_API_KEY`
