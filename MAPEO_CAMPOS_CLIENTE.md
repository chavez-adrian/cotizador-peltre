# Mapeo de campos de cliente

**Versión:** 2.2
**Fecha:** 2026-08-17
**Propósito:** Cruzar los campos requeridos por el SOP de alta de clientes en Operam contra lo que el cotizador captura actualmente, lo que llega a la API de Operam y lo que queda registrado en Neon DB.

**Nota (2026-08-17, revisión de vigencia):** la v2.1 quedó desfasada en tres premisas que la atravesaban entera. Esta versión las corrige y marca la corrección con el issue que las cambió; el resto de la tabla **no se re-auditó campo por campo** (las secciones 2.1, 2.2, 2.3, 2.5, 2.7 y 4 conservan el texto de v2.1, incluidas sus limitaciones de plataforma, que no se volvieron a probar contra Operam):

1. **El acordeón completo SÍ es alcanzable desde la UI.** `cvCaminoAlta()` (vista Clientes, fila punteada "Nuevo cliente / Alta completa en Operam, sin cotización") llama `abrirAcordeonAlta()` en modo creación. El gap #9 ("sin punto de entrada") ya no aplica.
2. **La alta genérica SÍ configura el branch** desde el issue #96 (`buildBranchGenerico` + `actualizarBranchCliente`, con verificación post-PUT). El gap #10 ("el domicilio de entrega nunca llega al branch"), que era el paraguas de toda la sección 2.6, dejó de ser cierto — con dos límites que se detallan ahí.
3. **El segmento sí se captura y sí se escribe en los tres caminos** (#121, #172, #186), pero NUNCA por la API v3: lo escribe un post-fix a la web legacy. Ver la fila Segmento en 2.4 y el gap #16.

**Nota (2026-07-14, issue #95):** decisión de Adrián — los 6 campos que la re-auditoría anterior (#39) marcaba como GAP/PARCIAL (nombre corto, Tax ID extranjero, Uso de CFDI, email de facturación, domicilio fiscal en captura manual, segmento) se conservan, NINGUNO se descarta. Los gaps #11-#16 de la sección 3 quedan RESUELTOS: `DIFF_FISCAL_CAMPOS` (`public/js/alta-logica.js`) ahora mapea `cust_ref`, `timbrado_uso_cfdi` (default `S01`, se manda siempre), `invoice_email` y `segmento_id`, así que viajan en el upgrade fiscal (`PUT /api/actualizar-cliente-fiscal/:id`) con el mismo mecanismo genérico de diff/verificación post-PUT que ya existía para RFC/razón social/domicilio — el quirk #74 (Operam ignora `segmento_id` en silencio) queda cubierto sin código nuevo en `server.js`. **[Corregido en v2.2: ese diagnóstico era erróneo — la API v3 no escribe `segmento_id` nunca, ni con verificación; lo escribe el post-fix web de #172. Ver gap #16.]** Tax ID extranjero no tiene campo dedicado en la API v3: se antepone a las notas existentes del cliente vía `buildNotasConTaxId` (nunca las borra). La pestaña "Captura manual" gana Calle/Número ext./Número int./Colonia (opcionales) y un selector de Segmento compartido con la pestaña CSF (`alta-upgrade-segmento`); sus mínimos obligatorios pasan a ser exactamente Razón Social, RFC, Código Postal y Régimen Fiscal (`validarAltaManualMinimos`) — nombre corto deja de ser obligatorio ahí.

**Nota (2026-07-13, re-auditoría completa, issue #39):** esta versión describe el flujo ACTUAL, post PRD #79/ADR-0006 e issue #85/#78. Ya no hay un boton "+ Nuevo cliente" que abra un alta completa manual: el cliente nace con **RFC generico** (`XAXX010101000` / `XEXX010101000`) al generarse la **primera cotizacion** (issue #81, `lib/alta-generica.js`, `POST /api/cotizacion/operam/:id`), con nombre real del contacto y vendedor real. La Constancia de Situacion Fiscal (CSF) llega despues como un **upgrade** (`PUT /api/actualizar-cliente-fiscal/:id`, issue #85) sobre ese cliente generico, nunca como un alta nueva. El paso Cliente "variante B" (issue #82, `pcState` en `app.js` + `public/js/alta-logica.js`) reemplaza el formulario plano de ~20 campos por un buscador mixto (Operam + prospectos) con tarjeta de chips Contacto/Entrega/Fiscal.

**Hallazgo estructural de la re-auditoria de v2.1 — CORREGIDO (2026-08-17):** v2.1 afirmaba que el acordeon completo de alta (`#panel-alta-cliente`, secciones 1-4, terminando en `POST /api/crear-cliente`) no tenia punto de entrada en la UI. Era cierto cuando se escribio y **ya no lo es**: la **vista Clientes** (menu) ofrece una fila punteada "Nuevo cliente — Alta completa en Operam, sin cotizacion" cuyo `cvCaminoAlta()` (`public/js/app.js`) re-parenta el panel a esa vista y llama `abrirAcordeonAlta()`, que resetea `modoUpgrade` y por lo tanto desvia la confirmacion al `POST` de creacion, no al `PUT` de #85. Las secciones 2 (config comercial), 3 (domicilio de entrega) y 4 (Dar de alta) **son alcanzables hoy**. El otro camino que abre el mismo panel sigue siendo `pcAbrirUpgradeFiscal()`, que si fija `modoUpgrade` y va al `PUT`. Ver seccion 3, gap #9.

**Nota:** En la tabla maestra, la columna "API Operam" indica el endpoint y la funcion realmente usados HOY para ese campo — que puede ser el POST de alta generica (`crearClienteDirecto`/`buildClienteBody`, siempre RFC generico), el PUT de upgrade fiscal (`buildActualizarFiscalPayload`/`DIFF_FISCAL_CAMPOS`) o el POST/PUT del acordeon completo (`buildClienteBody` vía `/api/crear-cliente`). Los campos del domicilio de entrega (seccion 2.6) llegan a `PUT /api/v3/sales/branches/{branch_id}` vía `actualizarBranchCliente()` desde **los dos** flujos: el acordeon completo (`/api/crear-cliente`, Step 3) y — desde el issue #96 — la alta generica (`buildBranchGenerico` en `lib/alta-generica.js`, con verificacion post-PUT via `diffBranchDomicilio`). Ver seccion 2.6 para los dos limites que conserva ese camino.

---

## 1. Fuentes cruzadas

| Fuente | Archivo |
|--------|---------|
| SOP oficial de alta de clientes | `SOP_crear_cliente_operam.md` |
| Paso Cliente variante B (buscador mixto Operam+prospectos, tarjeta de chips) | `public/js/app.js` (`pcState` y funciones `pc*`) + `public/js/alta-logica.js` (logica pura: `mezclarResultadosBusqueda`, `chipsCompletitud`, `buildClienteDesdeContactoNuevo`, `clienteDesdeProspecto`) |
| Alta genérica temprana del cliente (issue #81, ADR-0006) | `lib/alta-generica.js` (`necesitaAltaGenerica`, `buildClienteGenerico`, `resolverSalesTypeId`) + `server.js` (`POST /api/cotizacion/operam/:id` → `subirConAltaGenerica`) |
| Formulario de carga/edición de CSF (acordeón `#panel-alta-cliente`, accesible desde el chip Fiscal de la tarjeta y desde la vista Clientes) | `public/js/app.js` (tabs "Cargar CSF" / "Captura manual" dentro del mismo panel que ADR-0003 integró; `csf-upload.html` retirado por completo, el archivo ya no existe en disco) |
| Upgrade fiscal del cliente genérico (issue #85, ADR-0006) | `server.js` (`PUT /api/actualizar-cliente-fiscal/:id`) + `public/js/alta-logica.js` (`DIFF_FISCAL_CAMPOS`, `calcularDiffFiscal`, `buildActualizarFiscalPayload`, `camposNoAplicados`) |
| Alta completa vía POST (acordeón secciones 2-4; alcanzable desde la **vista Clientes** → "Nuevo cliente", `cvCaminoAlta`) | `server.js` (`POST /api/crear-cliente`) + `lib/operam-client.js` (`buildClienteBody`, `crearCliente`) |
| Post-fix del segmento por la web legacy (issues #172 y #186) | `lib/operam-web.js` (`actualizarSegmentoClienteWeb`, `parsearFormularioCliente`, `serializarBodyCliente`, `leerErrorWeb`) — lo llaman los tres caminos del alta |
| Domicilio de entrega → branch en la alta genérica (issue #96) | `lib/alta-generica.js` (`buildBranchGenerico`, `diffBranchDomicilio`) + `lib/operam-client.js` (`actualizarBranchCliente`) |
| Dedup por RFC exacto y por nombre normalizado (genéricos) | `lib/deduplicacion.js` (ADR-0001) |
| Dedup de candidatos por RFC genérico al llegar CSF con RFC real (issue #78) | `public/js/alta-logica.js` (`buildCandidatosRfcGenericoHtml`) + `server.js` (`GET /api/buscar-cliente-duplicado`) |
| Auditoría en base de datos | `lib/db.js` → tabla `clientes_log` en Neon |

---

## 2. Tabla maestra de campos

**Convenciones de estado:**
- `OK` — campo cubierto correctamente en el flujo vivo hoy
- `PARCIAL` — campo existe pero con limitaciones (ver notas)
- `GAP` — campo requerido por el SOP que el cotizador no captura, o que captura pero nunca envía en ningún camino alcanzable por la UI
- `HARDCODED` — valor fijo en el código; el SOP lo requiere configurable
- `CORRECTO` — valor hardcodeado que coincide con lo que el SOP indica como estándar
- `RESUELTO` — gap de auditorías previas que el código actual sí cubre

### 2.1 Identificación del cliente

| Campo semántico | Label en Operam | Ruta en Operam | SOP paso | Captura en UI hoy | API Operam (endpoint/función) | Neon `clientes_log` | Estado |
|---|---|---|---|---|---|---|---|
| RFC | R.F.C. | Conf. General > R.F.C. | 3 | Genérico automático (`rfcGenericoPara`, `lib/alta-generica.js:13`); real vía `csf-rfc` / `manual-rfc` en el upgrade | POST genérico → `tax_id` (`buildClienteBody`); PUT upgrade → `tax_id` vía `DIFF_FISCAL_CAMPOS` (`alta-logica.js:110`) | `rfc` (NOT NULL) | OK |
| Razón social / Nombre | (campo principal) | Conf. General | 5 (SAT) | `csf-razon-social` / `manual-razon-social` | POST genérico → `CustName` (`buildClienteGenerico`, `lib/alta-generica.js:55`, que `buildClienteBody` escribe como `cust_name`); PUT upgrade → `cust_name` (`DIFF_FISCAL_CAMPOS`, llave `write`) | `nombre` | **RESUELTO (#169)** — el PUT mandaba `CustName` (la llave de LECTURA) y Operam lo ignoraba en silencio, dejando la razón social sin escribir |
| Nombre corto | (cust_ref interno) | Conf. General | — | `csf-nombre-corto` / `manual-nombre-corto` | PUT upgrade → `cust_ref` (`DIFF_FISCAL_CAMPOS`, `alta-logica.js`, issue #95 regla 1) | — | **RESUELTO (#95)** — antes se leía y se descartaba; ahora viaja en el upgrade con el mismo mecanismo genérico de RFC/razón social |
| SAT IdCIF | SAT IdCIF | Conf. General > SAT IdCIF | 4 | `csf-idcif` / `manual-idcif` | PUT upgrade → `idcif` (`DIFF_FISCAL_CAMPOS`, `alta-logica.js:111`) | — | **RESUELTO** — antes PARCIAL solo en `csf-upload.html`; hoy viaja en el `PUT` de upgrade |
| Tax ID extranjero | — | — | — | `manual-tax-id-extranjero` (pestaña Captura manual — un cliente extranjero no tiene CSF del SAT, así que no aplica a la tab CSF) | PUT upgrade → concatenado a `notes` vía `buildNotasConTaxId` (antepone `Tax ID: XXX` a las notas existentes, sin borrarlas; issue #95 regla 5) | — | **RESUELTO (#95)** — no hay campo dedicado en la API v3, así que se persiste en notas; requiere una relectura previa al PUT (solo cuando el campo viene capturado) para no sobreescribir notas existentes |

### 2.2 Dirección fiscal

| Campo semántico | Label en Operam | Ruta en Operam | SOP paso | Captura en UI hoy | API Operam | Neon | Estado |
|---|---|---|---|---|---|---|---|
| Calle | Calle | Nombre y Dirección | 5 | `csf-calle` (tab CSF) y `manual-calle` (tab manual, opcional; issue #95 regla 4) | PUT upgrade → `street` (`DIFF_FISCAL_CAMPOS`), ambas tabs | — | **RESUELTO (#95)** — antes ausente en la tab manual; ahora capturable (opcional) en las dos rutas |
| Número exterior | Número | Nombre y Dirección | 5 | `csf-num-ext` y `manual-num-ext` (opcional) | PUT upgrade → `street_number` | — | RESUELTO (#95) — mismo patrón que Calle |
| Número interior | Interior | Nombre y Dirección | 5 | `csf-num-int` y `manual-num-int` (opcional) | PUT upgrade → `suite_number` | — | RESUELTO (#95) — mismo patrón |
| Colonia | Colonia | Nombre y Dirección | 5 | `csf-colonia` y `manual-colonia` (opcional) | PUT upgrade → `district` | — | RESUELTO (#95) — mismo patrón |
| Código postal fiscal | C.P. | Nombre y Dirección | 5 | `csf-cp` y `manual-cp` (ambas tabs; obligatorio en manual, regla 4) | PUT upgrade → `postal_code` | — | OK |
| Municipio | Ciudad / Municipio | Nombre y Dirección | 5 | `csf-municipio` y `manual-municipio` (opcional en manual) | PUT upgrade → `city` | — | OK |
| Estado | Estado | Nombre y Dirección | 5 | `csf-estado` y `manual-estado` (opcional en manual) | PUT upgrade → `state` | — | OK |
| País | País | Nombre y Dirección | — | `manual-pais` (solo en tab manual); tab CSF asume `pais: 'MX'` fijo (`lib/parsear-csf.js:133`) | No viaja en `DIFF_FISCAL_CAMPOS` (no hay campo `country`/`pais` en la lista, `alta-logica.js:108-120`) | — | **PARCIAL** — capturado en modo manual pero nunca enviado en el `PUT` de upgrade (la tabla no lo mapea); el POST genérico sí usa `c.pais` para el RFC genérico y para `area`, pero eso ocurre antes de tener CSF |

### 2.3 Configuración fiscal / CFDI

| Campo semántico | Label en Operam | Ruta en Operam | SOP paso | Captura en UI hoy | API Operam | Neon | Estado |
|---|---|---|---|---|---|---|---|
| Régimen fiscal SAT | Régimen Fiscal | CFDI | 5 (SAT) | `csf-regimen-fiscal` / `manual-regimen-fiscal`, autodetectado por `lib/parsear-csf.js` (`mapearRegimenPorTexto`) | PUT upgrade → `cfdi_regimen_fiscal` (`DIFF_FISCAL_CAMPOS`); la relectura de verificación lo lee como `regimen` (llave `read`, #169) | — | **RESUELTO** — antes PARCIAL solo en `csf-upload.html`; hoy viaja en el upgrade para ambas tabs |
| Uso de CFDI | Uso de CFDI | CFDI | — | `csf-uso-cfdi` / `manual-uso-cfdi` (selector, se lee en `altaCsfLeerFormulario`/`altaManualLeerFormulario`) | PUT upgrade → `timbrado_uso_cfdi` (`DIFF_FISCAL_CAMPOS`, issue #95 regla 2) — SE MANDA SIEMPRE (excepción de dominio a "ausente≠vacío"): si no se capturó o vino vacío, cae al default `S01` | — | **RESUELTO (#95)** — antes se leía y se descartaba en el único camino ejecutable |
| Método de pago CFDI | Método de Pago | CFDI > Método de Pago | 12–13 | No hay selector en ningún formulario vivo | HARDCODED `'PPD'` (`operam-client.js:291`, `DEFAULTS.cfdi_method_payment`) | — | HARDCODED — sin cambio vs. auditoría anterior |
| Forma de pago CFDI | Forma de Pago | CFDI > Forma de Pago | 14–15 | No hay selector | HARDCODED `'99'` (`operam-client.js:290`) | — | HARDCODED — sin cambio; correcto para PPD, incorrecto si se habilitara PUE |

### 2.4 Configuración comercial

| Campo semántico | Label en Operam | Ruta en Operam | SOP paso | Captura en UI hoy | API Operam | Neon | Estado |
|---|---|---|---|---|---|---|---|
| Lista de precios | Precio de lista | Conf. General > Lista de Precios | 6–7 | No hay selector directo; se deriva del `tier` de la cotización | POST genérico → `sales_type` vía `resolverSalesTypeId(tier, listasPrecios)` (`lib/alta-generica.js:41-44`, `server.js:1080`) | — | **RESUELTO (mecanismo distinto al PRD #26 original)** — antes GAP total; hoy se resuelve automáticamente del tier cotizado, sin selector manual. Si el tier no tiene lista homónima cae a "Precio de lista" (M550, el peor caso para menudeo, issue #92) |
| Segmento de cliente | Segmento Cliente | Conf. General > Segmento Cliente | 8–9 | `pc-segmento` (paso Cliente, desde #121), `alta-segmento` (acordeón completo) y `alta-upgrade-segmento` (tabs CSF/Manual del upgrade, #95 regla 6) | **NUNCA por la API v3** (ver abajo): lo escribe `actualizarSegmentoClienteWeb` (`lib/operam-web.js`) reposteando la ficha de cliente de la web legacy. Los tres caminos lo llaman (#172 upgrade fiscal, #186 alta completa y alta genérica). El `segmento_id` que viaja en el POST/PUT de la API se deja a propósito: si Operam lo arreglara, empezaría a funcionar solo | — | **RESUELTO (#172 + #186) en los tres caminos, con dos límites** — (a) los dos caminos del **alta** solo escriben si el cliente está en "Sin segmento" (id 1): a uno ya clasificado no se le pisa su segmento, porque ahí la selección viaja de pasada. El **upgrade fiscal** sí manda siempre: es una edición deliberada de la ficha; (b) el post-fix no relee para confirmar, así que un `ok` es éxito tentativo. **Ojo:** la validación de CP de FrontAccounting rechaza el guardado ENTERO, así que un cliente con CP vacío en Operam no recibe el segmento y el motivo real se le reporta al vendedor |
| Vendedor asignado | Vendedor | Domicilio > Vendedor | 10–11 | No hay selector; se deriva del vendedor autenticado que genera la cotización | **Es campo de la SUCURSAL, no del cliente** (verificado en vivo 2026-08-18, cliente 492): vive en `branches[].salesman_name` y se escribe en el `PUT /branches` (Step 3 del acordeón y `buildBranchGenerico` de la alta genérica). El `salesman` que el POST/PUT de customers manda lo ignora Operam porque a nivel cliente no existe. El valor es el lookup de `entry.vendedor` contra `operam_id` en `lib/vendedores-store.js` (Neon; `data/vendedores.json` es solo la siembra inicial, #140/#141) | — | **RESUELTO** — automático, sin intervención del vendedor. Pendiente de higiene: el Step 1b sigue mandando `salesman` en el PUT de customers, donde el campo no existe |
| Términos de pago | Términos de Pago | Ventas > Términos de Pago | 16–17 | Sin selector | HARDCODED `9` (Anticipo 50%) (`operam-client.js:293`) | — | CORRECTO — sin cambio vs. auditoría anterior (confirmado correcto para mayoreo) |
| Área / Zona de venta | Área/Zona de Venta | Domicilio > Área/Zona de Venta | 23–24 | Derivado del país | `derivarArea(pais)` (`operam-client.js`): MX→1, US→5, CA→7, otros→6. Se envía en `buildClienteBody` (nivel cliente) SIEMPRE; a nivel branch, en el `PUT` que hacen los dos flujos | — | **RESUELTO a nivel cliente y a nivel branch** (#96) — salvo cuando el `PUT` del branch no corre; ver los dos límites en 2.6 |
| Cuenta de ventas | Cuenta de Ventas | Domicilio/Contabilidad > Cuenta de Ventas | 43–44 | No enviar explícitamente (decisión previa, sigue vigente) | Se deriva de `tax_group_id`, seteado en `actualizarBranchCliente` (`operam-client.js`), que desde #96 corre también en la alta genérica | — | **RESUELTO para el cliente que nace CON domicilio de entrega capturado**; sigue sin verificarse qué `tax_group_id` recibe un branch auto-creado cuando el `PUT` no corre (cliente sin calle o sin CP, o cliente reusado). Ver gap #17 |
| Almacén predeterminado | Almacén de Inventario Predeterminada | Domicilio > Almacén | 21–22 | Fijo | `location: '40'` en `buildClienteBody` (nivel cliente) se envía SIEMPRE; a nivel branch (`location: 40`) en el `PUT` de los dos flujos | — | RESUELTO a nivel cliente y a nivel branch, mismo patrón que Área |
| Dimensión D1 | D1 — TALLER CASINO DE LA SELVA | Ventas > Dimensiones | 18–19 | Fijo | POST ignora `dimension_id` (quirk #74); la alta genérica lo corrige con un `PUT customer` explícito post-creación (`server.js:1126-1132`, `actualizarClienteDirecto(customerId, { dimension_id: 1, dimension2_id: 5 })`) | — | CORRECTO — confirmado que la alta genérica SÍ hace el PUT de corrección, igual que el acordeón completo lo hacía |
| Dimensión D2 | D2 — CORPORATIVO | Ventas > Dimensiones | 18–20 | Fijo | Mismo PUT que D1 | — | CORRECTO |
| Moneda | Moneda | — | — | Derivado del país | `curr_code` (MXN/USD) en `buildClienteBody` | — | OK — sin cambio |

### 2.5 Contacto principal

| Campo semántico | Label en Operam | Ruta en Operam | SOP paso | Captura en UI hoy | API Operam | Neon | Estado |
|---|---|---|---|---|---|---|---|
| Email principal | E-mail | Domicilio > E-mail | 25–26 | `cl-email-entrega` (paso Envío) — reutilizado como email principal por diseño (issue #16, documentado en `alta-logica.js:494-496`) | POST genérico → `email` = `c.emailEntrega` (`lib/alta-generica.js:61`) | — | **OK — reclasificado (era PARCIAL "solo en csf-upload")** — la decisión de reusar el email de entrega como contacto principal para clientes de mayoreo PyME sigue vigente y hoy sí llega a Operam en la alta genérica; no es un gap, es un diseño documentado |
| Teléfono (con código de país) | Teléfono | Domicilio > Teléfono | 27–29 | `cl-telefono-code`+`cl-telefono` (paso Cliente / contacto nuevo); combinado vía `combinarTelefonoConCodigo` (`alta-logica.js:52-59`) | POST genérico → `phone` = `c.telefono` (`lib/alta-generica.js:60`), ya combinado con código de país | — | **RESUELTO** — antes PARCIAL (cotizador principal sin selector de país); hoy el paso Cliente variante B sí combina código+número antes de guardar |
| Celular | Celular | Domicilio > Celular | 30 | Mismo número que teléfono, capturado como `celular_nota` | Va a `notes` como línea `Celular: ...` (`buildClienteBody`, `operam-client.js:314`), nunca a un campo API dedicado | — | **GAP + LIMITACIÓN DE PLATAFORMA (persiste)** — sin cambio vs. auditoría anterior; sigue sin ser settable vía API |
| Email para factura | — | — | — | `cl-email-factura` (paso Cliente/Envío) | POST alta genérica → `invoice_email` (`buildClienteGenerico` lee `c.emailFactura`, issue #95 regla 3); PUT upgrade → `invoice_email` (`DIFF_FISCAL_CAMPOS`, tomado del mismo input del DOM en `pcEjecutarUpgradeFiscal`) | — | **RESUELTO (#95) para persistir el dato** — el input ya existía y se descartaba (regresión de #39), ahora se lee en ambos caminos. Sigue **fuera de alcance** (ADR-0002, limitación de plataforma) crear el contacto etiquetado "Invoices" vía API — POST /contacts 501, PUT con array `contacts` se ignora; queda como paso manual en el SOP |
| Clasificación del contacto | Contacto para | Contacto > Contacto para | 34–35 | No aplica | Limitación de plataforma sin cambio: POST a contactos → 501; PUT con array `contacts` se ignora (verificado 2026-06-06, no re-verificado en este ciclo) | — | GAP + LIMITACIÓN DE PLATAFORMA — sin cambio |

### 2.6 Dirección de entrega (domicilio operativo)

**Hallazgo central de v2.1 — CORREGIDO (issue #96):** v2.1 decía que el domicilio de entrega no se subía al branch de Operam en el flujo vivo. Dejó de ser cierto: la alta genérica (`subirConAltaGenerica`) arma el body con `buildBranchGenerico` (`lib/alta-generica.js`), hace el `PUT /api/v3/sales/branches/{id}` con `customer_id` en el body (quirk #74) y **verifica releyendo** el branch (`diffBranchDomicilio`), reportando en `steps` cualquier campo que Operam haya ignorado. Desde #170 corrige además el nombre del branch a Title Case (Operam lo auto-crea copiando el `CustName` en MAYÚSCULAS).

**Los dos límites que sí quedan** (ninguno es "el dato no llega"):
1. **Solo para el cliente RECIÉN creado por esa alta.** Un cliente preexistente (reusado por celular o elegido de candidatos) conserva su domicilio: puede tener uno real en Operam que el cotizador no debe pisar.
2. **Sin calle o sin CP no hay `PUT`.** `buildBranchGenerico` devuelve `null` y el branch queda como Operam lo auto-creó, sin tumbar la subida.

| Campo semántico | Label en Operam | Ruta en Operam | SOP paso | Captura en UI hoy | API Operam (`actualizarBranchCliente`, desde los dos flujos) | Neon | Estado |
|---|---|---|---|---|---|---|---|
| Nombre de quien recibe | Nombre | Domicilios del Cliente | 42 | `cl-nombre-entrega` (un solo campo, sin apellido separado) | `br_name`, en Title Case desde #170 (prioriza el contacto de entrega sobre el nombre del cliente) | — | **RESUELTO (#96 + #170)** — llega al branch y se verifica releyendo. Persiste el punto menor heredado: no hay campo de apellido separado |
| Calle entrega | Dirección Postal | Domicilios > Dirección | 42 | `cl-calle` — **campo combinado "Calle y número exterior"**, ya no separado en calle/num.ext | `addr_street` (recibe el string combinado, sin separar) | — | **RESUELTO en transporte (#96)** — llega al branch. Persiste la diferencia de forma: el número exterior viaja dentro de la calle, igual que en el quote |
| Número exterior entrega | — | Domicilios | 42 | **No existe como campo independiente** — fusionado dentro de `cl-calle` desde issue #84 | `buildBranchGenerico` NO manda `addr_exterior`: nadie lo puebla por separado (el acordeón completo sí tiene `addr_exterior` propio) | — | **GAP de captura (decisión de forma, no de transporte)** — el dato llega dentro de `addr_street`; solo está sin desglosar |
| Número interior entrega | — | Domicilios | 42 | `cl-num-int` | `addr_interior` | — | RESUELTO (#96) |
| Colonia entrega | — | Domicilios | 42 | `cl-colonia` | `addr_colony` | — | RESUELTO (#96) |
| CP entrega | — | Domicilios | 42 | `cl-cp-entrega` | `addr_zip` | — | RESUELTO (#96) — además es uno de los dos campos sin los cuales NO se hace el `PUT` del branch |
| Ciudad entrega | — | Domicilios | 42 | `cl-municipio` (compartido con el paso Cliente) | `addr_city` | — | RESUELTO (#96) |
| Estado entrega | — | Domicilios | 42 | `cl-estado` | `addr_state` | — | RESUELTO (#96) |
| Teléfono entrega (con código de país) | Teléfono | Domicilios | 28 | `cl-cel-entrega-code`+`cl-cel-entrega`, combinado con `combinarTelefonoConCodigo` | `phone` (branch); si no se capturó, cae al teléfono del contacto | — | **RESUELTO en captura y en transporte (#96)** |
| Email entrega | E-mail | Domicilios | — | `cl-email-entrega` | `email` (branch) | — | **RESUELTO (#96)** — llega al branch y además se usa como email principal del cliente (ver 2.5) |
| Referencias de entrega | Referencias | Domicilios | 42 | `cl-referencias` (textarea, paso Envío) | `addr_reference` en `actualizarBranchCliente`. **Ojo al nombre:** sale de `referencias` (indicaciones de entrega), NO de `referencia` (el `cust_ref` del quote) | — | **RESUELTO (#96)** — el Gap #7 antiguo queda cerrado: el campo existe, tiene destino y el destino se dispara |

### 2.7 Auditoría / trazabilidad

| Campo semántico | Captura en UI hoy | API Operam | Neon `clientes_log` | Notas |
|---|---|---|---|---|
| Fecha de CSF | `csf-*` (vía PDF, no hay input directo de fecha en el detalle editable) | Incluida en `notes` vía `buildClienteBody` (`cliente.csf_fecha`) | — | Solo informativa; sin cambio |
| Fuente de alta | Implícita por camino de código, ya no por selector de UI | — | `fuente`: `'cotizador-generico'` (alta genérica automática, `lib/alta-generica.js:11` `FUENTE_ALTA_GENERICA`), `'csf-upgrade'` (upgrade fiscal, `server.js:1363` `FUENTE_CSF_UPGRADE`), `'cotizador'` (acordeón completo, si algún día se invoca) | **Actualizado respecto a la auditoría anterior** — la columna existe y hoy se puebla con valores nuevos y distinguibles por camino, cumpliendo el requisito de ADR-0006 ("log con fuente distinguible"); antes la tabla solo listaba `'operam-csf'`/`'operam-manual'` de la herramienta retirada |
| Notas / actividades económicas | — | `notes` (`buildClienteBody`) | — | Se concatena con Tax ID (si existiera), email de facturación, celular y fecha CSF; sin cambio funcional |
| ID del cliente en Operam | — | Respuesta de POST/PUT | `cliente_id` | Trazabilidad; sin cambio |
| Resultado de la operación | — | — | `resultado`: ahora incluye también `'fusion-bloqueada'` (gate anti-fusión de #85, `server.js:1383`) además de `creado`/`actualizado`/`duplicado`/`error` | Ampliado respecto a la auditoría anterior |
| PDF subido a Dropbox | — | — | `dropbox_ok` | Fire-and-forget, sin cambio; el upgrade fiscal también sube el PDF (`server.js:1415-1420`) |
| Mensaje de error | — | — | `error_msg` | Sin cambio; ahora también registra fallos de verificación post-PUT ("La verificacion post-PUT fallo...", `server.js:1423`) |

---

## 3. Gaps identificados

Campos y comportamientos que el SOP exige o que la propia arquitectura documentada (ADR-0006) da por hecho, y que el cotizador no cubre en el flujo vivo hoy, ordenados por impacto:

| # | Campo / comportamiento | Impacto | Descripción del gap |
|---|---|---|---|
| **9 (CERRADO 2026-08-17)** | Acordeón completo de alta (`#panel-alta-cliente` secciones 2-4, `POST /api/crear-cliente`) | — | Ya no aplica: la **vista Clientes** lo abre en modo creación vía `cvCaminoAlta()` → `abrirAcordeonAlta()`. La decisión que el gap pedía se tomó en la práctica por la vía (b): el alta completa sigue viva como camino para dar de alta un cliente **sin cotización**. |
| **10 (RESUELTO #96)** | Domicilio de entrega nunca llega al branch de Operam en el flujo vivo | — | La alta genérica hace el `PUT` del branch con el domicilio del paso Envío y verifica releyendo (`buildBranchGenerico` + `diffBranchDomicilio`). Quedan dos límites acotados, no un gap de transporte: solo aplica al cliente que ESA alta acaba de crear (a uno preexistente no se le pisa su domicilio real) y no hay `PUT` si falta calle o CP. Ver 2.6. |
| **11 (RESUELTO #95)** | Nombre corto (`cust_ref`) no viaja en el upgrade fiscal | Medio | `DIFF_FISCAL_CAMPOS` ahora mapea `cust_ref <- nombreCorto`; viaja en el `PUT` de upgrade con el mismo mecanismo genérico que RFC/razón social. |
| **12 (RESUELTO #95)** | Tax ID extranjero: ya no se captura en absoluto | Bajo (uso raro, clientes extranjeros) | Nuevo input `manual-tax-id-extranjero` en la tab manual; se persiste en `notes` vía `buildNotasConTaxId` (antepone `Tax ID: XXX` a las notas existentes, sin borrarlas; requiere una relectura previa al PUT solo cuando el campo viene capturado). |
| **13 (RESUELTO #95)** | Uso de CFDI: capturado y descartado | Medio | `DIFF_FISCAL_CAMPOS` mapea `timbrado_uso_cfdi <- usoCfdi`, con envío SIEMPRE (excepción de dominio) y default `S01` cuando no se capturó o vino vacío. |
| **14 (RESUELTO #95)** | Email de facturación no llega en la alta genérica | Medio | `buildClienteGenerico` ahora lee `c.emailFactura -> invoice_email`; `leerClienteFormulario` ya leía el input `cl-email-factura` pero lo descartaba. El upgrade también lo manda (`DIFF_FISCAL_CAMPOS`, tomado del mismo input por `pcEjecutarUpgradeFiscal`). |
| **15 (RESUELTO #95)** | Dirección fiscal (calle/num.ext/num.int/colonia) y país: ausentes en la tab "Captura manual" del upgrade | Medio | Se agregaron `manual-calle`/`manual-num-ext`/`manual-num-int`/`manual-colonia` (opcionales) a la tab manual; el país sigue sin mapearse en `DIFF_FISCAL_CAMPOS` (no forma parte del alcance de #95, permanece como gap menor). |
| **16 (RESUELTO #172 + #186)** | Segmento de cliente | Alto (heredado de auditoría anterior) | Se captura en los tres caminos (`pc-segmento` desde #121, `alta-segmento` y `alta-upgrade-segmento`) y se escribe en los tres. Lo que cambió el diagnóstico: **la API v3 no puede escribir `segmento_id` por NINGÚN camino** (sondeo exhaustivo en vivo de #172: POST, PUT dedicado, PUT bundleado y 8 nombres alternos; no persiste ni vuelve en el eco). No era el quirk #74 de "a veces lo ignora": no lo escribe nunca. Quien lo persiste es un post-fix que repostea la ficha de cliente de la web legacy (`actualizarSegmentoClienteWeb`). Límites en la fila Segmento de 2.4. |
| **17 (parcial, sigue abierto)** | Tax_group_id / cuenta de ventas cuando el `PUT` del branch NO corre | **Requiere verificación en vivo** | Resuelto #96 para el caso normal (cliente nuevo con calle y CP: el `PUT` manda `tax_group_id` explícito). Sigue sin verificarse qué `tax_group_id` — y qué cuenta de ventas derivada — recibe un branch auto-creado en los dos casos en que no hay `PUT`: cliente sin calle o sin CP, y cliente reusado. Riesgo contable no cuantificado. |
| 1 (heredado) | Celular como campo API dedicado | Limitación de plataforma | Sin cambio — sigue sin ser settable vía API v3, solo vía notas. |
| 2 (heredado, RESUELTO) | Cuenta de ventas vía `tax_group_id` en el branch | — | Vuelve a ser cierto desde #96 para el caso normal; ver #17 para los dos casos en que el `PUT` no corre. |
| 3 (heredado) | Clasificación del contacto ("Contacto para") | Limitación de plataforma | Sin cambio, no re-verificado en este ciclo. |
| 4 (heredado, RESUELTO) | Almacén predeterminado | — | `location: '40'` viaja a nivel cliente y, desde #96, también a nivel branch en la alta genérica. |
| 8 (heredado) | Apellido de quien recibe | Bajo | Sin cambio — `cl-nombre-entrega` sigue siendo un solo campo de texto libre. |

---

## 4. Valores hardcodeados vs SOP

Sin cambios respecto a la auditoría anterior — verificado que `DEFAULTS` en `lib/operam-client.js:289-300` conserva los mismos valores:

| Campo | Label en Operam | API param | Valor hardcodeado | Lo que el SOP indica | ¿Es problema? |
|---|---|---|---|---|---|
| Uso de CFDI | Uso de CFDI | `timbrado_uso_cfdi` | `'S01'` en `operam-client.js` (alta genérica); `'S01'` como default explícito en `DIFF_FISCAL_CAMPOS` (upgrade, issue #95) | Configurable; verificar con el cliente antes de facturar | No para el upgrade (#95 resuelto: el selector `csf-uso-cfdi`/`manual-uso-cfdi` sí se manda) — la alta genérica automática sigue sin selector, usa el default de Operam |
| Método de pago CFDI | Método de Pago | `cfdi_method_payment` | `'PPD'` | PPD o PUE según la negociación | Sí para clientes de contado o PUE — sin selector en ningún formulario |
| Forma de pago CFDI | Forma de Pago | `cfdi_form_payment` | `'99'` | `'99'` si PPD (correcto); forma real si PUE | Solo si se habilita PUE |
| Términos de pago | Términos de Pago | `payment_terms` | `9` (Anticipo 50%) | Elegir según negociación | No — confirmado correcto para mayoreo, fuera de scope |
| Área / Zona de venta | Área/Zona de Venta | `area` | Derivado de `pais` (`derivarArea`) | MX→1, US→5, CA→7, otros→6 | No — ya no es hardcodeado, se deriva automáticamente (resuelto respecto al PRD #26 original) |
| Ubicación (almacén, nivel cliente) | (interno) | `location` | `'40'` | No especificado en SOP para este endpoint | No — correcto, y sí se envía en la alta genérica |
| Dimensión D1 | D1 — TALLER CASINO DE LA SELVA | `dimension_id` | `1` | `1` (paso 19) | No — correcto, y confirmado que la alta genérica hace el PUT de corrección post-#74 |
| Dimensión D2 | D2 — CORPORATIVO | `dimension2_id` | `5` | `5` (paso 20) | No — correcto, mismo PUT de corrección |

---

## 5. Decisiones tomadas

- **PRD #26** — especificación original de lista de precios/segmento/vendedor; superada en su mecanismo (la lista y el vendedor se resuelven automático en la alta genérica; el segmento sí tiene selector) y su objetivo de fondo se cumplió: ver gap #16 (cerrado por #172 + #186).
- **ADR-0001** — deduplicación por nombre normalizado para RFC genérico.
- **ADR-0002** — alta como operación atómica; no fire-and-forget.
- **ADR-0003** — `csf-upload.html` se depreca; alta integrada en `index.html`. El acordeón que ADR-0003 integró sigue vivo y volvió a tener disparador propio: la vista Clientes lo abre en modo creación (gap #9, cerrado).
- **ADR-0006** — subida automática de cotizaciones y alta temprana de cliente genérico; CSF como upgrade, nunca alta. Es el ADR que rige el flujo vivo hoy.
- **#172 / #186** — `segmento_id` no es escribible por la API v3 por ningún camino; se persiste reposteando la ficha de cliente de la web legacy (FrontAccounting) desde los tres caminos del alta. Detalle del sondeo en vivo en `peltre-operam.md` §12.5c y en `docs/arquitectura.md` (§web legacy y §Quirks).
- **`CONTEXT.md`** — glosario de dominio con definiciones precisas de todos los términos del proceso.

Ver `PROCESO_COMERCIAL_AS_IS.md` para el contexto del proceso comercial completo.
