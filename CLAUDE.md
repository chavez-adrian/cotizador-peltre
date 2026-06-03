# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # desarrollo con hot-reload (--watch)
npm start            # produccion
npm test             # todos los tests (160, ~0 fallas esperadas)

# Correr un test individual:
node --test test/server.test.js
node --test test/operam-client.test.js
node --test --test-concurrency=1 public/js/__tests__/csf.test.cjs
node --test --test-concurrency=1 public/js/__tests__/csf-upload-alta.test.cjs
```

> `--test-concurrency=1` es obligatorio cuando los tests comparten estado global (`globalThis.fetch` mock o `cotizaciones.json`). Sin el los tests se interfieren.

## Arquitectura

El proyecto es un servidor Express monolitico (`server.js`) con frontend vanilla JS (`public/js/app.js`, ~2500 lineas) y una herramienta standalone de alta de clientes (`public/csf-upload.html`). Sin frameworks frontend, sin bundlers.

### Flujo de datos principal

```
Browser (app.js)          → /api/* → server.js → lib/* → Operam v3 API / envia.com
                                              → data/*.json (persistencia en disco)
                                              → pdfkit / html-generator
Browser (csf-upload.html) → /api/crear-cliente   → lib/operam-client.js → Operam
                          → /api/buscar-cliente   → lib/db.js            → Neon (clientes_log)
                          → /api/actualizar-cliente/:id                  → lib/dropbox.js → Dropbox
                          → /api/log
                          → /api/csf-from-url     → SAT (proxy QR)
```

### Modulos lib/

| Modulo | Que hace |
|--------|----------|
| `operam-client.js` | Bearer token auth con auto-refresh en 401. Exporta `buscarClientes`, `obtenerDomicilios`, `subirCotizacionOperam`, `actualizarCliente`, `actualizarClienteDirecto`, `buscarClientePorRFC`, `crearCliente`, `resetSession` |
| `db.js` | Pool pg con DATABASE_URL. Exporta `query(sql, params)`. Retorna null si no hay pool (graceful). Auto-crea tabla `clientes_log` en Neon al iniciar. |
| `dropbox.js` | OAuth token refresh. Exporta `upload(path, content)` y `subirCsfDropbox(pdfBase64, rfc, nombre)` |
| `parsear-csf.js` | Funcion pura — extrae RFC, razon social, domicilio, regimen de texto de PDF de CSF del SAT |
| `pdf-generator.js` | PDFKit, llama a URLs de imagenes de Shopify en tiempo real si `incluirFotos: true` |
| `html-generator.js` | HTML auto-contenido para WhatsApp, mismo formato visual que el PDF |
| `calcular-envio.js` | Convierte carrito en paquetes fisicos para envia.com; lee `data/cajas.json` y `data/precios.json` (campo `boxMap`) |
| `extract-prices.js` | Parsea Excel maestro de precios (hoja `precios_pna`) → `data/precios.json` |
| `validar-cp.js` | Funcion pura para validar CP por pais |

### Persistencia

Dual:
- `data/*.json` — cotizaciones, vendedores, precios, cajas. Leidos/escritos sincronicamente.
- Neon Postgres (`DATABASE_URL`) — tabla `clientes_log` para auditoria de altas de clientes.

### Auth

Dos niveles:
- **Rutas del cotizador**: JWT de 30 dias. `vendedores.json` contiene ID + PIN. El rol `admin` desbloquea `/api/admin/*`.
- **Rutas CSF** (`/api/crear-cliente`, `/api/buscar-cliente`, `/api/actualizar-cliente/:id`, `/api/log`, `/api/csf-from-url`): sin JWT — usadas por `csf-upload.html` sin friccion.

`server.js` carga `.env` manualmente sin dotenv (patron en lineas 24-30).

### Tests

**Backend** (`test/`): ES modules, `node:test` + `supertest`. El app se importa sin `listen()` gracias al guard `isMain` en `server.js`.

**Frontend** (`public/js/__tests__/`): CommonJS (`.cjs`). Las funciones puras se extraen en `helpers.cjs` y se prueban directamente con `node:test`. No hay DOM.

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
