# cotizador-peltre

Herramienta interna de Peltre Nacional SA de CV. Combina tres funciones:

1. **Cotizador** — vendedores generan cotizaciones de acero esmaltado en campo, calculan envio y comparten PDF o HTML por WhatsApp.
2. **Pipeline comercial (CRM)** — tablero unico de oportunidades en 7 etapas (de prospecto a producto entregado) con cola "Hoy", seguimiento por cadencia, y **sincronizacion post-venta automatica con Operam** (webhooks + reconciliacion): pagos, pedido liberado y entrega mueven la tarjeta sin captura doble. Ver `CONTEXT.md` (glosario de dominio) y `PROGRESS.md` (PRD #52).
3. **Cliente generico + alta fiscal diferida** — el paso Cliente ofrece dos caminos ("Ya lo conozco" / "Contacto nuevo"); el cliente nace en Operam con RFC generico (`XAXX010101000`/`XEXX010101000`) al generar la primera cotizacion, sin alta manual (PRD #79, ADR-0006). Cuando llega la CSF, el vendedor la sube desde el chip "Fiscal" de la tarjeta: el sistema actualiza (nunca re-crea) ese cliente generico en Operam ERP, con gate anti-fusion y verificacion post-PUT.

**Produccion:** https://cotizador-peltre.onrender.com

## Stack

- Node.js >= 20 / Express — ES modules
- Frontend: HTML + CSS + JS vanilla (sin frameworks)
- PDF: pdfkit
- Autenticacion cotizador: JWT (30 dias)
- Alta fiscal (CSF): integrada al cotizador (chip "Fiscal" de la tarjeta del cliente), JWT requerido igual que el resto
- Base de datos: Neon Postgres (cotizaciones + seguimientos + log de auditoría de altas; fallback a JSON local sin DATABASE_URL)
- Integraciones: Operam ERP v3, envia.com, Dropbox, SAT (proxy QR)

## Requisitos

```
node >= 20
npm install
```

Copiar `.env.example` a `.env` y completar las variables:

| Variable | Descripcion |
|----------|-------------|
| `JWT_SECRET` | Clave secreta para JWT del cotizador |
| `OPERAM_URL` | URL base de Operam (ej. `https://peltrenacional.operam.pro`) |
| `OPERAM_USER` | Usuario API Operam |
| `OPERAM_PASSWORD` | Contrasena API Operam |
| `ENVIA_API_KEY` | API key de envia.com para cotizar envio |
| `DATABASE_URL` | Connection string Neon Postgres (cotizaciones, clientes_log, operam_webhooks_log) |
| `DROPBOX_REFRESH_TOKEN` | OAuth refresh token de Dropbox |
| `DROPBOX_APP_KEY` | App key de Dropbox |
| `DROPBOX_APP_SECRET` | App secret de Dropbox |
| `OPERAM_WEBHOOK_SECRET` | Secreto compartido del webhook de sync post-venta (header `X-Operam-Webhook-Secret`). Sin el, el endpoint es fail-closed (401) |

## Uso

```bash
npm start        # produccion
npm run dev      # desarrollo con --watch
npm test         # todos los tests (943, 0 fallas)
```

## Estructura

```
server.js              # API Express + auth + todas las rutas
lib/
  operam-client.js     # cliente Operam v3 (buscar, crear, actualizar, cotizar)
  db.js                # pool Neon Postgres — query() + auto-crea clientes_log
  dropbox.js           # backup de PDFs de CSF en Dropbox
  pdf-generator.js     # genera PDF de cotizacion
  html-generator.js    # genera HTML de cotizacion (para WhatsApp link)
  calcular-envio.js    # calcula paquetes para envia.com
  extract-prices.js    # extrae precios desde Excel
  parsear-csf.js       # extrae datos de PDF de Constancia de Situacion Fiscal
  validar-cp.js        # valida codigo postal por pais
public/
  index.html           # app cotizador (SPA)
  admin.html           # panel de administracion
  js/app.js            # logica frontend cotizador (~2500 lineas)
  js/__tests__/        # tests de funciones puras del frontend
data/
  precios.json         # catalogo de precios (cargado via admin)
  vendedores.json      # lista de vendedores con PIN
  cotizaciones.json    # historial de cotizaciones
  pdfs/                # PDFs generados
  htmls/               # HTMLs generados
test/                  # tests de backend (supertest + node:test)
```

## Flujos principales

### Cotizar (vendedores)
1. Login con ID de vendedor + PIN
2. Paso Cliente: "Ya lo conozco" (buscar en Operam o en prospectos propios, con recientes) o "Contacto nuevo" (celular, nombre, ciudad, canal — crea/usa el prospecto, issue #82)
3. Agregar productos al carrito (tier de precio calculado automaticamente)
4. Cotizar envio con envia.com (opcional; direccion de entrega se captura en el paso Envio)
5. Generar PDF o HTML, compartir por WhatsApp — la cotizacion se sube sola a Operam (issue #83); si la oportunidad no tenia cliente en Operam, primero se crea el cliente generico (issue #81, ADR-0006)

### CSF como upgrade del cliente generico (chip "Fiscal" de la tarjeta, autenticado)
1. En la tarjeta del cliente seleccionado, si ya existe un cliente en Operam con RFC generico, el chip "Fiscal" es clickeable
2. Se abre el mismo dropzone/parseo de CSF de siempre: subir PDF (o "Captura manual"); el sistema extrae RFC, razon social, regimen y domicilio fiscal
3. Al confirmar: gate anti-fusion (si el RFC real ya pertenece a OTRO cliente en Operam, se frena con 409 y se avisa — fusion manual, sin tocar nada)
4. Sin fusion: `PUT` sobre el mismo `customer_id` (nunca crea un cliente nuevo), relectura de verificacion (el `PUT` de Operam puede ignorar campos en silencio), backup del PDF en Dropbox y log en Neon (issue #85)
5. El chip pasa a verde cuando el RFC real quedo confirmado

### Actualizar cliente existente (formulario generico, sin gate de fusion)
1. Se detecta cliente existente (por RFC, en cualquier flujo)
2. Se editan los campos necesarios en el formulario
3. Al confirmar: se envian a Operam solo los campos modificados (diff), via `PUT /api/actualizar-cliente/:id`
4. El evento queda registrado en `clientes_log` en Neon

## API endpoints

### Cotizador (requieren JWT)

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| POST | `/api/login` | Autenticar vendedor |
| GET | `/api/precios` | Catalogo de precios con config activa |
| POST | `/api/cotizacion/pdf` | Generar PDF y guardar en historial |
| POST | `/api/cotizacion/html` | Generar HTML y guardar en historial |
| GET | `/api/cotizacion/pdf/:id` | Descargar PDF por ID |
| GET | `/api/cotizacion/html/:id` | Ver HTML por ID |
| GET | `/api/cotizaciones` | Historial del vendedor (o todos si admin) |
| GET | `/api/seguimiento` | Cola de seguimiento de cotizaciones (dia 2/7/21/vencida) |
| POST | `/api/seguimiento/:id` | Registrar paso de seguimiento hecho |
| PATCH | `/api/cotizacion/:id/estado` | Marcar cotizacion abierta/ganada/perdida/descartada |
| POST | `/api/cotizacion/envio` | Cotizar envio con envia.com |
| GET | `/api/operam/clientes` | Buscar clientes en Operam |
| GET | `/api/operam/clientes/:id/domicilios` | Domicilios de un cliente |
| PATCH | `/api/operam/clientes/:id` | Actualizar cliente en Operam |
| POST | `/api/cotizacion/operam/:id` | Subir cotizacion a Operam |
| POST | `/api/admin/precios` | Actualizar precios desde Excel (admin) |
| GET/POST | `/api/admin/config` | Configuracion de catalogo (admin) |
| GET/PUT | `/api/admin/vendedores` | Gestion de vendedores (admin) |
| GET/PUT | `/api/admin/cajas` | Configuracion de cajas de empaque (admin) |

### Pipeline y sync post-venta

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| POST | `/api/webhooks/operam` | Webhook de Operam (Pago de Cliente / Pedido / Remision -> Nuevo). Auth por header `X-Operam-Webhook-Secret`; log idempotente en Neon; reconcilia la oportunidad y mueve su etapa post-venta |
| POST | `/api/sync-operam` | Reconciliacion on-demand (red de seguridad): lee Operam y mueve las oportunidades activas que avanzaron (JWT) |

> El resto de rutas del pipeline (prospectos, asignacion, etapas, salidas, seguimiento, decorados) viven en `server.js`; el modelo de dominio esta en `CONTEXT.md` y el detalle del PRD en `PROGRESS.md`.

### Alta de clientes y CSF (requieren JWT, igual que el resto)

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| POST | `/api/crear-cliente` | Crear cliente en Operam desde datos CSF (camino de cliente formal nuevo sin historia previa); log en Neon; backup PDF en Dropbox |
| PUT | `/api/actualizar-cliente-fiscal/:id` | Upgrade de CSF sobre el cliente generico existente (issue #85): gate anti-fusion por RFC exacto + verificacion post-PUT; nunca crea cliente nuevo; log en Neon; backup PDF en Dropbox |
| GET | `/api/buscar-cliente?rfc=` | Buscar cliente por RFC exacto en Operam |
| PUT | `/api/actualizar-cliente/:id` | Actualizar campos de cliente en Operam (PUT generico, sin gate ni verificacion) |
| GET | `/api/log` | Ultimas 200 entradas de clientes_log en Neon |
| POST | `/api/csf-from-url` | Proxy: consulta URL del QR del SAT, devuelve texto plano y `datos` parseados (via `parsearCSF`) |
| POST | `/api/parsear-csf` | Recibe `{ texto }` y devuelve `{ ok, datos }` con la estructura completa extraida por `lib/parsear-csf.js::parsearCSF` (RFC, razon social, domicilio fiscal, regimen) |

## Tests

```bash
npm test
# 943 tests, 0 fallas
```

- `test/` — backend (supertest + node:test, ES modules)
- `public/js/__tests__/` — frontend puro (node:test, CommonJS helpers)
- `test/operam-client.test.js` — patron `mockFetchByUrl` para Operam
- `test/server.test.js` — integration HTTP con `mockOperamFetch`

## Notas de arquitectura

- El backup de Dropbox en `/api/crear-cliente` es fire-and-forget: si falla, la respuesta HTTP no se bloquea.
- El cliente generico (RFC `XAXX010101000`/`XEXX010101000`) nace server-side al generar la primera cotizacion de una oportunidad sin cliente en Operam, con dedup en capas (celular, luego nombre normalizado) antes de crear — nunca al capturar el contacto (`POST /api/cotizacion/operam/:id`, issue #81, ADR-0006).
- `lib/db.js` retorna `null` si `DATABASE_URL` no esta configurada (graceful degradation para desarrollo local).
- El schema de `clientes_log` (y `operam_webhooks_log`) se auto-crea al iniciar el servidor si hay `DATABASE_URL`.
- **Sync post-venta**: el webhook de Operam es solo una *senal*; la logica corre en un motor de reconciliacion (`lib/sync-operam-io.js`) que lee el estado real por API y aplica el nucleo puro (`lib/sync-operam.js`). El mismo motor sirve al webhook y a la reconciliacion on-demand. El mapeo real de Operam (los tipos de transaccion, que el MCP etiqueta mal) esta en `peltre-operam.md` (raiz `_Claude/`).
