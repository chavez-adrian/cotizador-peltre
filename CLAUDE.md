# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # desarrollo con hot-reload (--watch)
npm start            # produccion
npm test             # todos los tests (0 fallas esperadas)

# Correr un test individual:
node --test test/server.test.js
node --test --test-concurrency=1 public/js/__tests__/alta-csf.test.cjs
```

> `--test-concurrency=1` es obligatorio cuando los tests comparten estado global (`globalThis.fetch` mock o `cotizaciones.json`). Sin el los tests se interfieren.

## Documentos de contexto — leer ANTES de tocar el area

- `docs/arquitectura.md` — **detalle por modulo/tema** (lib/, persistencia, catalogos, auth, quirks de Operam). Este CLAUDE.md es el resumen; el detalle vive alla.
- `CONTEXT.md` — glosario de dominio (el glosario manda) + `docs/adr/` — decisiones de arquitectura (0001-0011).
- `PROCESO_COMERCIAL_AS_IS.md`, `SOP_crear_cliente_operam.md`, `MAPEO_CAMPOS_CLIENTE.md` — proceso comercial y flujo de clientes; leer antes de cambios a ese flujo.
- `peltre-operam.md` (raiz `_Claude/`) §12 — API de Operam: tipos de transaccion REALES (el MCP `operam-api` los etiqueta mal), cadena `order_`, contrato de escritura del quote. Consultar ANTES de explorar Operam.

## Arquitectura

Servidor Express monolitico (`server.js`) con frontend vanilla JS (`public/js/app.js`). Sin frameworks frontend, sin bundlers.

```
Browser (app.js) → /api/*                        → server.js → lib/* → Operam v3 API / envia.com
                                                             → data/*.json (persistencia en disco)
                                                             → pdfkit / html-generator
                 → /api/crear-cliente             → lib/operam-client.js → Operam
                 → /api/buscar-cliente            → lib/db.js            → Neon (clientes_log)
                 → /api/actualizar-cliente/:id                           → lib/dropbox.js → Dropbox
                 → /api/csf-from-url              → SAT (proxy QR)
```

Patron de la casa: **nucleos PUROS sin IO** compartidos por cross-import entre `server.js` y `public/js` (un modulo, varios consumidores, cero copias espejo). Ejemplos: `alta-logica.js`, `calcas-logica.js`, `cruce-identidad.js`.

### Modulos lib/ (una linea; detalle en docs/arquitectura.md)

| Modulo | Que hace |
|--------|----------|
| `operam-client.js` | Bearer auth con auto-refresh; `buildClienteBody` = UNICO mapeo cliente→Operam (ahi viven los overrides fiscales del RFC generico #121); lectores read-only con retry y throttle anti-429 |
| `alta-generica.js` | Alta con RFC generico al subir cotizacion (#81/#83) + PUT del branch con domicilio de entrega (#96) |
| `deduplicacion.js` | RFC genericos + dedup (#78); `DEBTORS_GENERICOS`; `normalizarNombre` |
| `cruce-identidad.js` | Nucleo puro del cruce por identidad (#123): CERRO/COMPRO_OTRA_COSA/SIN_SENAL, banda ±15%, normalizacion de telefono |
| `telefono-llave.js` | `ultimos10` = la UNICA llave de identidad de prospecto |
| `higiene-clientes.js` | Reporte admin "Clientes genericos sin actividad" (#86) |
| `sync-operam.js` / `sync-operam-io.js` / `sync-operam-webhook.js` | Sync post-venta (#62): nucleo puro + motor de reconciliacion + webhook; binding SOLO por `data.orderOperam` |
| `backfill-operam.mjs` | Nucleo puro del backfill historico (#76); excluye cancelados |
| `recolector-genericos.mjs` | Lote historico de quotes de debtors genericos → bandeja (#124); orquestado por `scripts/rescatar-genericos.mjs` |
| `catalogo-operam.js` | Catalogo generado desde Operam (#128/#131); orquestado por `scripts/sync-catalogo.mjs` |
| `operam-web.js` | Web legacy (FrontAccounting): vigencia (#106) + actualizar quote conservando folio (#104) + deteccion de cancelados |
| `db.js` | Pool pg; `query()` retorna null sin pool (graceful); auto-crea `clientes_log` y `operam_webhooks_log` en Neon |
| `dropbox.js` | OAuth refresh; `upload` y `subirCsfDropbox` (backup de CSF, fire-and-forget) |
| `parsear-csf.js` | Puro: extrae RFC/razon social/domicilio/regimen del PDF de CSF |
| `pdf-generator.js` / `html-generator.js` | PDFKit / HTML auto-contenido para WhatsApp, mismo formato visual |
| `calcular-envio.js` | Carrito → paquetes fisicos para envia.com; excluye `ENVIO` y la calca |
| `extract-prices.js` | LEGADO desde el corte #131: contraste contra el Excel, ya no genera `data/precios.json` |
| `validar-cp.js` | Puro: valida CP por pais |
| `fs-reintento.js` | TODO acceso a `data/*.json` pasa por aqui (ver Trampas) |

`public/js/alta-logica.js` (logica pura del alta de cliente) y `public/js/calcas-logica.js` (calca en el carrito, #91/ADR-0010) son los nucleos puros del frontend — detalle y reglas no obvias en `docs/arquitectura.md`.

## Trampas que cuestan horas (no derivables del codigo)

- **`onclick` inline resuelve contra `window`, no contra el modulo (#112).** Si existen `function foo()` de modulo Y `window.foo = ...`, el menu dispara el de `window` y el otro queda muerto — sin error, sin sintoma en tests. Regla: un simbolo por nombre; lo invocado desde `onclick` se expone a `window` JUNTO a su declaracion. Esto NO lo ve un code review: solo aparece **ejecutando en navegador**.
- **`lib/fs-reintento.js` es obligatorio para `data/*.json`** (#117), en stores Y helpers de tests: OneDrive toma locks EBUSY intermitentes que tumbaban ~1 de cada 3 corridas. Reintenta SOLO EBUSY; EPERM/ENOENT se propagan (un test depende de eso). Nunca `fs` directo.
- **Calca sin precio = null, nunca $0** (#91): las 32 calcas tienen `Menudeo: null` y el fallback a 0 imprimia calcas gratis en PDF y quote. Las piezas de calca NO cuentan para el tier; la calca fija la marca `decorado` y `app.js` la manda solo en `true` (un `false` pisaria la marca del tablero).
- **Quirks de escritura de Operam**: 200/`result:true` no garantiza nada — releer SIEMPRE. `segmento_id` y `dimension_id` pueden ignorarse en silencio; `PUT /branches` huerfana el domicilio sin `customer_id` en el body; no hay DELETE de clientes. Detalle en `docs/arquitectura.md` §Quirks.
- **El body del quote web lleva `ProcessOrder` y NUNCA `CancelOrder`** (viven en el mismo form; CancelOrder anula la cotizacion).
- **La comparacion de huella del quote (#114) es SIEMPRE local**: el cotizador manda y una edicion hecha directamente en Operam se pierde (decision explicita).
- **Codigos de calca se BUSCAN en el catalogo, nunca se concatenan**: uno inventado da 406 al subir el quote.
- **ASCII estricto** en codigo y commits: sin acentos, sin comillas tipograficas, sin em-dashes.

## Persistencia (reglas vigentes; historia en docs/arquitectura.md y ADR-0008/0009)

- Neon Postgres (`DATABASE_URL`) es la fuente de verdad en produccion; sin `DATABASE_URL` los stores caen a `data/*.json` (dev y tests). El disco de Render es efimero.
- **El numero de la cotizacion ES el folio de Operam** (ADR-0009), nunca el id interno (clave tecnica de URLs). Un solo punto lo decide: `datosDocumento(entry)` en `server.js`. En la UI siempre `etiquetaFolioOperam` (`pipeline-logica.js`).
- Los GET `/api/cotizacion/pdf/:id` y `/html/:id` REGENERAN desde `data` jsonb y son el UNICO camino que genera documento; `POST /api/cotizacion` solo guarda. Van sin auth a proposito (compartir por WhatsApp).
- El flujo guarda → espera subida a Operam → abre el documento numerado; si Operam falla o excede `TIMEOUT_OPERAM_MS`, el documento sale igual como PRE-COTIZACION explicita (nunca sin numero silencioso).
- Regenerar una cotizacion ya subida compara contra `data.huellaQuote` y actualiza el quote conservando folio solo si cambio (#114-#116); con pedido asociado responde 409.
- Gate `puedeActualizarCotizacion`: solo con folio subido, sin pedido asociado y mismo cliente (#104).

## Auth

- Rutas del cotizador: JWT de 30 dias; `vendedores.json` tiene ID + PIN; rol `admin` desbloquea `/api/admin/*`.
- Rutas CSF: mismas garantias (`authMiddleware`). El ciclo de vida del cliente tiene 3 caminos autenticados: alta generica al subir cotizacion, upgrade fiscal (#85, gate anti-fusion por RFC exacto) y alta completa. Detalle en `docs/arquitectura.md` §Auth.
- `server.js` carga `.env` manualmente sin dotenv (lineas ~24-30) y PISA `process.env`.

## Tests

**Backend** (`test/`): ES modules, `node:test` + `supertest`. El app se importa sin `listen()` gracias al guard `isMain` en `server.js`. Helpers de archivos: SIEMPRE via `lib/fs-reintento.js`.

**Frontend** (`public/js/__tests__/`): CommonJS (`.cjs`), sin DOM. `app.js` NO es importable en Node (efectos de navegador en scope de modulo); las funciones puras compartidas viven en modulos intermedios (`alta-logica.js`, importado con `await import()` en un `before()`; el resto en `helpers.cjs` via `require`). No escribir tests tautologicos que afirmen literales que el codigo real nunca construye (leccion de #36).

- Mock de Operam: `mockFetchByUrl(urlHandlers)` / `mockOperamFetch(handlers)` interceptan por substring de URL y restauran al terminar.
- Testear PDFs: pasar `_compress: false` y buscar strings con `buffer.toString('latin1').includes(str)`.

## Integraciones externas

- **Operam ERP v3**: `OPERAM_URL` + `OPERAM_USER` + `OPERAM_PASSWORD`. Company ID: `346`. Bearer token.
- **Neon Postgres**: `DATABASE_URL`.
- **Dropbox**: `DROPBOX_REFRESH_TOKEN` + `DROPBOX_APP_KEY` + `DROPBOX_APP_SECRET`. Fire-and-forget.
- **envia.com**: `ENVIA_API_KEY`. FedEx, DHL y UPS en paralelo con `Promise.allSettled`.
- **Shopify**: `SHOPIFY_API_TOKEN` (solo `scripts/fetch-shopify-images.js`).
- **SAT**: proxy en `/api/csf-from-url` para QR de CSF sin texto extraible.

## Deploy

Render.com (plan Starter: no duerme, UNA instancia). Auto-deploy desde `main`. Config en `render.yaml`; las env vars viven en el dashboard de Render, no en el yaml.

> Varias piezas asumen **un solo proceso Node**: el lock `subidasOperamEnCurso` y la cola de post-fixes de vigencia viven en memoria. Con varias instancias habria que moverlas a Neon o a un lock distribuido.
