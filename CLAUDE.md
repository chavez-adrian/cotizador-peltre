# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # desarrollo con hot-reload (--watch)
npm start            # produccion
npm test             # todos los tests (1250, 0 fallas esperadas)

# Correr un test individual:
node --test test/server.test.js
node --test test/operam-client.test.js
node --test --test-concurrency=1 public/js/__tests__/alta-csf.test.cjs
```

> `--test-concurrency=1` es obligatorio cuando los tests comparten estado global (`globalThis.fetch` mock o `cotizaciones.json`). Sin el los tests se interfieren.

## Documentos de contexto del proceso comercial

Antes de trabajar en cambios al flujo de clientes, leer:

- `PROCESO_COMERCIAL_AS_IS.md` — narrativa completa del proceso comercial de Peltre Nacional (mayoreo, sistemas, cotización, producción, envío).
- `SOP_crear_cliente_operam.md` — procedimiento oficial de 45 pasos para dar de alta un cliente en Operam, con checklist de validación.
- `MAPEO_CAMPOS_CLIENTE.md` — mapeo cruzado de campos entre SOP, UI del cotizador, API de Operam y Neon DB. **v2.1 (2026-07-14): describe el flujo ACTUAL** (alta genérica #81/#83 + upgrade fiscal #85 + vista Clientes #94 + campos conservados #95), re-auditado fila por fila contra el código (#39). Los gaps abiertos que documenta son reales.

---

## Arquitectura

El proyecto es un servidor Express monolitico (`server.js`) con frontend vanilla JS (`public/js/app.js`, ~2500 lineas). Sin frameworks frontend, sin bundlers.

> **Trampa de `onclick` inline vs `window` (#112).** Varios menus arman sus botones con `onclick="<accion>()"` (p. ej. `buildMenuNuevoHtml` de `pipeline-logica.js`), y un `onclick` inline resuelve **contra `window`**, no contra el scope del modulo. Si existe una `function foo()` de modulo Y un `window.foo = ...` distinto, el menu dispara el de `window` y el de modulo queda muerto para esa ruta — sin error, sin sintoma en los tests. Paso exactamente eso con `nuevaCotizacion` (dos simbolos: uno reseteaba, el otro solo navegaba). **Regla: un solo simbolo por nombre; si algo se invoca desde `onclick`, exponerlo a `window` JUNTO a su declaracion.** Y leccion de proceso: esto no lo ve un code review leyendo el diff (se lee simbolo por simbolo), solo aparece **ejecutando en navegador**.

`public/js/alta-logica.js` es un modulo ES sin efectos de navegador que concentra la logica pura del flujo de alta de cliente (parseo de CSF, diff fiscal, payload de `/api/crear-cliente`, payload del upgrade fiscal de `/api/actualizar-cliente-fiscal/:id`, combinacion de telefono). `app.js` lo importa de forma nativa (`<script type="module">`); los tests lo consumen via `import()` dinamico (ver seccion Tests); `server.js` importa de el las funciones de diff/payload fiscal (issue #85) para el endpoint de upgrade — tres consumidores, cero copias espejo (resolucion de "Especie A" del Candidato 2 de `architecture-review-cotizador-20260606.html`, issue #36; mismo patron de cross-import server↔public/js ya usado con `prospectos-logica.js`/`decorados-logica.js`).

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
| `operam-client.js` | Bearer token auth con auto-refresh en 401. Exporta `buscarClientes`, `obtenerDomicilios`, `subirCotizacionOperam`, `actualizarCliente`, `actualizarClienteDirecto`, `buscarClientePorRFC`, `crearCliente`, `actualizarBranchCliente`, `obtenerBranch`, `obtenerBranchId`, `obtenerClientePorId`, `listarTransacciones`, `listarPedidos`, `resetSession` |
| `alta-generica.js` | Alta del cliente con RFC generico al subir cotizacion (#81/#83): `buildClienteGenerico` (lee `emailFactura` -> `invoice_email` desde #95), `buildBranchGenerico`/`diffBranchDomicilio` (PUT del branch con domicilio de entrega + verificacion, #96), `necesitaAltaGenerica`, `rfcGenericoPara`, `resolverSalesTypeId`, `FUENTE_ALTA_GENERICA` |
| `higiene-clientes.js` | Nucleo puro del reporte admin "Clientes genericos sin actividad" (#86) |
| `deduplicacion.js` | RFC genericos + deteccion de duplicados (dedup #78: nombre + telefono como senal fuerte) |
| `sync-operam.js` | Nucleo PURO del sync post-venta (#62): `etapaPostVenta(hechos, op)` (hechos normalizados → etapa, con gate de #61 y monotonia) + `hechosDesdeOperam` (transacciones crudas → hechos). **Mapeo REAL de tipos de Operam: ver `peltre-operam.md` §12** (el MCP `operam-api` los etiqueta mal). Pago por `allocated` vs `total` (tolerancia 1%), no por `outstanding`. Sin IO. |
| `sync-operam-io.js` | Motor de reconciliacion: lee Operam read-only (`listarTransacciones`/`listarPedidos`), normaliza, aplica el nucleo y mueve la tarjeta. Binding por `data.orderOperam` (el folio de cotizacion NUNCA es el `order_`). Lo usan el webhook y `/api/sync-operam`. |
| `sync-operam-webhook.js` | Webhook de Operam: extraccion defensiva del identificador, clave idempotente, log en Neon. |
| `operam-web.js` | Web legacy de Operam (FrontAccounting) para lo que la API v3 no permite. Login por form + cookie (auth distinta del Bearer). Dos escrituras: (1) post-fix de vigencia (#106, ADR-0007): `corregirVigenciaQuote` + los puros `parsearFormularioQuote`/`serializarBodyQuote`/`leerValidoHastaVista`; (2) **actualizacion del quote conservando folio** (#104, ADR-0008): `actualizarQuoteOperam` — reescritura completa en `$_SESSION` (Delete0 iterado + AddItem por partida con el mapeo compartido `armarContenidoQuote` de operam-client) y UN solo `ProcessOrder` que lleva comments/cust_ref/vigencia (sin post-fix separado en este camino), con verificacion post-escritura (`compararQuoteVista`; NO compara descripciones — las impone el catalogo de Operam). Verificado en vivo 2026-07-28: Delete/AddItem NO tocan la base hasta ProcessOrder, y el `price` enviado prevalece sobre la lista del cliente. El body lleva `ProcessOrder` y NUNCA `CancelOrder` (vive en el mismo form y anularia la cotizacion; `ES_SUBMIT`/`bodyDesdeCampos` son la segunda linea de defensa). La deteccion de cancelacion (#76) usa la misma sesion web pero vive en la rama `issue-76-backfill`, sin mergear: no esta en main. |
| `db.js` | Pool pg con DATABASE_URL. Exporta `query(sql, params)`. Retorna null si no hay pool (graceful). Auto-crea tablas `clientes_log` y `operam_webhooks_log` en Neon al iniciar. |
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
- `listas_precios`: de `GET /api/v3/sales/sales_types` (todas las activas). Operam entrega la etiqueta en `sales_type` (texto: M100, "Precio de lista", "Segundas", "Amazon"...) y el id numerico en `id` — que es lo que el cliente guarda en su campo `sales_type`. El catalogo expone `{ id: t.id (numerico), nombre: t.sales_type (etiqueta) }`; el selector muestra la etiqueta y manda el id numerico (verificado en vivo 2026-06-17; la API ya NO usa `sales_type_id` ni `description`)

> `data/vendedores.json` tiene dos espacios de ID: `id` (interno del cotizador, secuencial) y `operam_id` (ID en Operam, no secuencial). El campo `salesman` que va al body de Operam usa `operam_id`.

### Persistencia

- Neon Postgres (`DATABASE_URL`) — tablas `cotizaciones` (historial + seguimientos + estado, via `lib/cotizaciones-store.js`) y `clientes_log` (auditoria de altas). El store cae a `data/cotizaciones.json` cuando no hay `DATABASE_URL` (dev local y tests); el disco de Render es efimero, asi que en produccion la fuente de verdad es Neon.
- Los GET `/api/cotizacion/pdf/:id` y `/html/:id` REGENERAN el documento desde `data` jsonb (#103) y desde ADR-0009 (#110/#111) son el **UNICO** camino que genera documento: los `POST /api/cotizacion/pdf` y `/html` se eliminaron (guardaban Y generaban, y cada uno decidia por su cuenta que numero imprimir — la causa raiz de #110). Guardar es ahora `POST /api/cotizacion`, que solo crea/actualiza el registro y devuelve `{ id, folioOperam }`. La cache de disco se elimino y el listado expone `hasData` (ya no `hasPdf`). Van SIN authMiddleware a proposito (compartir por WhatsApp); `?descargar=1` cambia el `Content-Disposition` a `attachment` (la descarga del vendedor) y el nombre del archivo se arma SOLO ahi. El envio elegido se persiste estructurado en `data.envio` `{opcion, carrier, servicio, precio, descripcion}` (#102) y `cargarCotizacion` lo restaura sin re-disparar envia.com.
- "Actualizar cotizacion" vs "Crear nueva a partir de esta" (#104, ADR-0008): actualizar reutiliza `cotizacionId` (ya no se resetea `lastCotizacionId` incondicionalmente al Cargar) y reescribe el quote de Operam conservando folio via `actualizarQuoteOperam`. Gate `puedeActualizarCotizacion`: solo con folio subido y sin pedido asociado (`data.orderOperam` ausente) y mismo cliente. Si la edicion web falla, el registro local SI se actualiza y queda marcado `quoteDesactualizado` con Reintentar.
- **Regenerar una cotizacion ya subida actualiza su quote, sin preguntar (#114).** Regenerar (mismo `cotizacionId`, sin pasar por el historial) sobre un registro que ya tiene `folioOperam` compara el contenido nuevo contra `data.huellaQuote` — la huella de lo que el cotizador dejo en el quote, persistida al subir (los dos caminos) y al actualizar con exito. Si no cambio, NO se toca Operam (caso tipico: el PDF y luego el HTML del mismo carrito). Si cambio, `POST /api/cotizacion` devuelve `requiereActualizacionOperam` y la generacion entra por el MISMO camino de #104 (`/actualizar` → `actualizarQuoteOperam`), que conserva el folio; con pedido asociado el gate responde 409 y la UI avisa fuerte (badge + boton "Crear una cotizacion nueva a partir de esta" + `alert`), porque el documento ya salio numerado. `huellaContenidoQuote` (`lib/operam-client.js`) se deriva de `armarContenidoQuote` — el unico mapeo de que viaja al quote — asi que no puede divergir de lo que se sube. **Que cuenta como cambio (corregido en #115):** partidas, importes, cliente, **el `comments` completo (notas + envios Lalamove, que no son partida y viven SOLO ahi)** y **el PLAZO de vigencia en dias**. Que NO: la **fecha** absoluta de vigencia (se recalcula en cada generacion: incluirla haria que generar el PDF hoy y el HTML manana pareciera un cambio; por eso la linea `Valido hasta` del comments se normaliza al plazo, derivado con las MISMAS funciones que lo construyen — `vigenciaDeCotizacion`/`fechaDeCotizacion`, defaults incluidos), el formato del documento (PDF/HTML, fotos) y la descripcion de la partida (la impone el catalogo de Operam). Ojo con el error que #115 corrigio: las notas parecian "presentacion" y no lo son — `armarComentariosQuote` las mete en `comments`. La comparacion es SIEMPRE local — el quote NUNCA se lee antes de reescribir: el cotizador manda y una edicion hecha directamente en Operam se pierde (decision explicita, ver comentario de #114). Contexto que la sustenta: **el cotizador no se entera de NADA que pase con quotes en Operam** — el sync ignora el tipo 32 (`lib/sync-operam.js`), los webhooks son Payment/Order/CustDelivery y no hay importacion de quotes creados alla (parte B de #76).
- **La generacion espera la operacion de Operam en vuelo (#116).** Antes, pedir el HTML enseguida del PDF comparaba contra la huella vieja (la reescritura no la habia persistido todavia), pedia actualizar otra vez y chocaba con la guarda: el vendedor veia "ya hay una operacion en curso, reintenta" en el flujo mas comun. `guardarYNumerarCotizacion` espera esa operacion (`esperarOperamEnVuelo`, progreso "Esperando a Operam...") acotada por `TIMEOUT_OPERAM_MS`; si vence, sigue y el aviso queda como red de seguridad — el documento nunca se retiene. **La senal `requiereActualizacionOperam` manda TAMBIEN en modo actualizacion**: forzar la reescritura por el modo reescribia el quote dos veces con contenido identico (la guarda lo frenaba por accidente). Cuando no hay nada que actualizar, el slot lo ACUSA reusando la vista de `yaSubida` (folio + "el contenido no cambio"), en vez de dejar el aviso previo sin respuesta.
- **Numeracion de la cotizacion (ADR-0009, implementado en #110+#111):** el numero de la cotizacion **es el folio de Operam**, no el id interno del registro (que queda como clave tecnica: sigue siendo la URL de los GET y de `shareWhatsApp`). Un solo punto lo decide — `datosDocumento(entry)` en `server.js` — y los generadores leen `data.folio` (ya NO `data.id`). Para poder imprimirlo se **invirtio el orden**: `guardarYNumerarCotizacion` (`app.js`) guarda, **espera** la subida a Operam y recien entonces abre el documento desde el GET, con progreso real en el boton ("Guardando..." / "Subiendo a Operam..." / "Generando documento..."). Fallback obligatorio: si la subida falla, choca con el lock (425), la subida ya esta en vuelo o pasa el timeout duro `TIMEOUT_OPERAM_MS` (20s), el documento se entrega igual **sin numero y como pre-cotizacion** (encabezado `PRE-COTIZACION`, archivo `PreCotizacion_PeltreNacional`), con el estado PRE + Reintentar en el slot; el bueno se re-comparte desde el historial. `interpretarSubidaOperam` distingue `enVuelo` y `timeout` como PRE explicitos: el ADR prohibe el documento sin numero silencioso. En **modo actualizacion** (#104) no hay inversion: el folio ya existe y la reescritura del quote no bloquea el documento.
- `GET /api/cotizaciones/:id` devuelve `data` **mas `folioOperam`** (#109). El folio es columna de primer nivel del registro (`folio_operam`), no vive dentro de `data`; el listado ya lo exponia y el detalle no, asi que la vista de cotizacion no tenia forma de conocerlo. Al nombrarlo en la UI se usa SIEMPRE `etiquetaFolioOperam` (`public/js/pipeline-logica.js`, convencion `#Operam N` de #63) — nunca el id interno.
- `data/*.json` — vendedores, precios, cajas, config. Leidos/escritos sincronicamente.
- Migracion historica: `scripts/migrar-cotizaciones-neon.mjs` (idempotente, corrida el 2026-06-10; excluyo entradas de vendedores Test/Tester).

### Auth

Dos niveles:
- **Rutas del cotizador**: JWT de 30 dias. `vendedores.json` contiene ID + PIN. El rol `admin` desbloquea `/api/admin/*`.
- **Rutas CSF** (`/api/crear-cliente`, `/api/buscar-cliente`, `/api/actualizar-cliente/:id`, `/api/actualizar-cliente-fiscal/:id`, `/api/log`, `/api/csf-from-url`): protegidas con `authMiddleware` igual que el resto del cotizador (la herramienta standalone `csf-upload.html` se retiro en ADR-0003). El ciclo de vida del cliente tiene tres caminos, todos autenticados: (1) **alta generica** al subir cotizacion (`lib/alta-generica.js`, #81/#83; desde #96 tambien hace PUT del branch con el domicilio de entrega, SOLO para el cliente recien creado); (2) **upgrade fiscal** `/api/actualizar-cliente-fiscal/:id` sobre el generico (issue #85, ADR-0006: gate anti-fusion por RFC exacto + verificacion post-PUT con `camposNoActualizados`, nunca crea cliente nuevo; desde #95 tambien lleva cust_ref, uso CFDI con default S01, invoice_email, segmento y Tax ID extranjero anexado a `notes` sin pisar notas existentes); (3) **alta completa** con el acordeon de `app.js` + `POST /api/crear-cliente`. Los caminos 2 y 3 son accesibles sin cotizacion desde la **vista Clientes** (menu Mas, #94; el panel de alta es UNICO y se re-parenta — `moverPanelA`/`devolverPanelACasa`, reset de `modoUpgrade` en cada cambio de vista). OJO: los campos `cl-*` son globales del flujo de cotizacion; desde la vista Clientes NO son confiables (ver `emailFacturaParaUpgrade`).

`server.js` carga `.env` manualmente sin dotenv (patron en lineas 24-30).

> Quirk de Operam (2026-06-10): `PUT /api/v3/sales/customers/{id}` puede responder 200 e ignorar `segmento_id` silenciosamente en algunos registros (cliente 457 lo ignoro 3 veces; cliente 456 lo acepto a la primera). Si una actualizacion de segmento "no pega", verificar releyendo y corregir en la UI de Operam.

### Tests

**Backend** (`test/`): ES modules, `node:test` + `supertest`. El app se importa sin `listen()` gracias al guard `isMain` en `server.js`.

> **Todo acceso a `data/*.json` pasa por `lib/fs-reintento.js`** (`leerArchivoSync`/`escribirArchivoSync`/`borrarArchivoSync`), en los stores Y en los helpers de los tests. Razon (#117): el repo vive bajo OneDrive, que toma locks intermitentes (EBUSY) sobre esos archivos al sincronizarlos — un `writeFileSync` directo tumbaba ~1 de cada 3 corridas de la suite (y si el EBUSY caia en un `before()`, abortaba el archivo de test completo). El helper reintenta SOLO EBUSY con espera sincrona corta; otros codigos (EPERM, ENOENT) se propagan de inmediato — hay un test (`operam-generico`) que simula fallo de escritura con `chmodSync` y depende de que EPERM NO se reintente. Al escribir un test nuevo que toque `data/*.json`, importar estos helpers, no `fs` directo.

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

Render.com (plan Starter: el servicio NO duerme, una sola instancia). Auto-deploy desde `main`. Config en `render.yaml`.

> Varias piezas asumen **un solo proceso Node**: el lock `subidasOperamEnCurso` de `server.js` y la cola de post-fixes de vigencia de `lib/operam-web.js` viven en memoria. Si algun dia se escala a varias instancias (Standard+), esas garantias dejan de valer y hay que moverlas a Neon o a un lock distribuido.

Variables configuradas en el dashboard de Render (no en `render.yaml`):
- `OPERAM_URL`, `OPERAM_USER`, `OPERAM_PASSWORD`
- `DATABASE_URL` (Neon — misma DB que usaba operam-server)
- `DROPBOX_REFRESH_TOKEN`, `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET`
- `ENVIA_API_KEY`
