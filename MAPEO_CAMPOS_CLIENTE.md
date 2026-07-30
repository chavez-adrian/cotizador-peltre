# Mapeo de campos de cliente

**Versión:** 2.1
**Fecha:** 2026-07-14
**Propósito:** Cruzar los campos requeridos por el SOP de alta de clientes en Operam contra lo que el cotizador captura actualmente, lo que llega a la API de Operam y lo que queda registrado en Neon DB.

**Nota (2026-07-14, issue #95):** decisión de Adrián — los 6 campos que la re-auditoría anterior (#39) marcaba como GAP/PARCIAL (nombre corto, Tax ID extranjero, Uso de CFDI, email de facturación, domicilio fiscal en captura manual, segmento) se conservan, NINGUNO se descarta. Los gaps #11-#16 de la sección 3 quedan RESUELTOS: `DIFF_FISCAL_CAMPOS` (`public/js/alta-logica.js`) ahora mapea `cust_ref`, `timbrado_uso_cfdi` (default `S01`, se manda siempre), `invoice_email` y `segmento_id`, así que viajan en el upgrade fiscal (`PUT /api/actualizar-cliente-fiscal/:id`) con el mismo mecanismo genérico de diff/verificación post-PUT que ya existía para RFC/razón social/domicilio — el quirk #74 (Operam ignora `segmento_id` en silencio) queda cubierto sin código nuevo en `server.js`. Tax ID extranjero no tiene campo dedicado en la API v3: se antepone a las notas existentes del cliente vía `buildNotasConTaxId` (nunca las borra). La pestaña "Captura manual" gana Calle/Número ext./Número int./Colonia (opcionales) y un selector de Segmento compartido con la pestaña CSF (`alta-upgrade-segmento`); sus mínimos obligatorios pasan a ser exactamente Razón Social, RFC, Código Postal y Régimen Fiscal (`validarAltaManualMinimos`) — nombre corto deja de ser obligatorio ahí.

**Nota (2026-07-13, re-auditoría completa, issue #39):** esta versión describe el flujo ACTUAL, post PRD #79/ADR-0006 e issue #85/#78. Ya no hay un boton "+ Nuevo cliente" que abra un alta completa manual: el cliente nace con **RFC generico** (`XAXX010101000` / `XEXX010101000`) al generarse la **primera cotizacion** (issue #81, `lib/alta-generica.js`, `POST /api/cotizacion/operam/:id`), con nombre real del contacto y vendedor real. La Constancia de Situacion Fiscal (CSF) llega despues como un **upgrade** (`PUT /api/actualizar-cliente-fiscal/:id`, issue #85) sobre ese cliente generico, nunca como un alta nueva. El paso Cliente "variante B" (issue #82, `pcState` en `app.js` + `public/js/alta-logica.js`) reemplaza el formulario plano de ~20 campos por un buscador mixto (Operam + prospectos) con tarjeta de chips Contacto/Entrega/Fiscal.

**Hallazgo estructural de esta re-auditoria:** el acordeon completo de alta (`#panel-alta-cliente`, secciones 1-4, terminando en `POST /api/crear-cliente`) sigue existiendo en el codigo pero **no tiene ningun punto de entrada activo en la UI** — `abrirAcordeonAlta()` (`public/js/app.js:3703`) esta expuesta en `window` pero ningun boton ni `onclick` la invoca (verificado por grep en `app.js` e `index.html`). El unico camino que abre ese panel hoy es `pcAbrirUpgradeFiscal()` (`app.js:2048`), que siempre fija `altaCsfState.modoUpgrade` a un `customer_id` y por lo tanto siempre desvia la confirmacion hacia `pcEjecutarUpgradeFiscal()` (el `PUT` de #85), nunca hacia el `POST` de creacion. Consecuencia: **las Secciones 2 (config comercial), 3 (domicilio de entrega) y 4 (Dar de alta / POST) del acordeon son inalcanzables desde la UI en produccion.** El codigo sigue vivo porque `helpers.cjs`/`alta-csf.test.cjs` lo prueban como funcion pura y porque `server.js` conserva el endpoint, pero un vendedor no puede hoy disparar ese flujo. Ver seccion 3, gap nuevo #9.

**Nota:** En la tabla maestra, la columna "API Operam" indica el endpoint y la funcion realmente usados HOY para ese campo — que puede ser el POST de alta generica (`crearClienteDirecto`/`buildClienteBody`, siempre RFC generico), el PUT de upgrade fiscal (`buildActualizarFiscalPayload`/`DIFF_FISCAL_CAMPOS`) o el POST/PUT del acordeon completo (`buildClienteBody` vía `/api/crear-cliente`, hoy inalcanzable por UI pero documentado porque el endpoint sigue activo y probado). Los campos del domicilio de entrega (seccion 2.6) solo llegan a `PUT /api/v3/sales/branches/{branch_id}` vía `actualizarBranchCliente()` en el flujo del acordeon completo (`/api/crear-cliente`) — **el flujo de alta generica NO llama `actualizarBranchCliente` en ningun punto** (verificado: unico caller en `server.js` es la linea del acordeon completo). Ver gap nuevo #10.

---

## 1. Fuentes cruzadas

| Fuente | Archivo |
|--------|---------|
| SOP oficial de alta de clientes | `SOP_crear_cliente_operam.md` |
| Paso Cliente variante B (buscador mixto Operam+prospectos, tarjeta de chips) | `public/js/app.js` (`pcState` y funciones `pc*`) + `public/js/alta-logica.js` (logica pura: `mezclarResultadosBusqueda`, `chipsCompletitud`, `buildClienteDesdeContactoNuevo`, `clienteDesdeProspecto`) |
| Alta genérica temprana del cliente (issue #81, ADR-0006) | `lib/alta-generica.js` (`necesitaAltaGenerica`, `buildClienteGenerico`, `resolverSalesTypeId`) + `server.js` (`POST /api/cotizacion/operam/:id` → `subirConAltaGenerica`) |
| Formulario de carga/edición de CSF (acordeón `#panel-alta-cliente`, hoy accesible únicamente desde el chip Fiscal de la tarjeta) | `public/js/app.js` (tabs "Cargar CSF" / "Captura manual" dentro del mismo panel que ADR-0003 integró; `csf-upload.html` retirado por completo, el archivo ya no existe en disco) |
| Upgrade fiscal del cliente genérico (issue #85, ADR-0006) | `server.js` (`PUT /api/actualizar-cliente-fiscal/:id`) + `public/js/alta-logica.js` (`DIFF_FISCAL_CAMPOS`, `calcularDiffFiscal`, `buildActualizarFiscalPayload`) |
| Alta completa vía POST (acordeón secciones 2-4; endpoint activo, **sin punto de entrada en la UI actual** — ver hallazgo estructural arriba) | `server.js` (`POST /api/crear-cliente`) + `lib/operam-client.js` (`buildClienteBody`, `crearCliente`) |
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
| Razón social / Nombre | (campo principal) | Conf. General | 5 (SAT) | `csf-razon-social` / `manual-razon-social` | POST genérico → `CustName` (`buildClienteGenerico`, `lib/alta-generica.js:55`); PUT upgrade → `CustName` (`DIFF_FISCAL_CAMPOS`) | `nombre` | OK |
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
| Régimen fiscal SAT | Régimen Fiscal | CFDI | 5 (SAT) | `csf-regimen-fiscal` / `manual-regimen-fiscal`, autodetectado por `lib/parsear-csf.js` (`mapearRegimenPorTexto`) | PUT upgrade → `cfdi_regimen_fiscal` (`DIFF_FISCAL_CAMPOS`) | — | **RESUELTO** — antes PARCIAL solo en `csf-upload.html`; hoy viaja en el upgrade para ambas tabs |
| Uso de CFDI | Uso de CFDI | CFDI | — | `csf-uso-cfdi` / `manual-uso-cfdi` (selector, se lee en `altaCsfLeerFormulario`/`altaManualLeerFormulario`) | PUT upgrade → `timbrado_uso_cfdi` (`DIFF_FISCAL_CAMPOS`, issue #95 regla 2) — SE MANDA SIEMPRE (excepción de dominio a "ausente≠vacío"): si no se capturó o vino vacío, cae al default `S01` | — | **RESUELTO (#95)** — antes se leía y se descartaba en el único camino ejecutable |
| Método de pago CFDI | Método de Pago | CFDI > Método de Pago | 12–13 | No hay selector en ningún formulario vivo | HARDCODED `'PPD'` (`operam-client.js:291`, `DEFAULTS.cfdi_method_payment`) | — | HARDCODED — sin cambio vs. auditoría anterior |
| Forma de pago CFDI | Forma de Pago | CFDI > Forma de Pago | 14–15 | No hay selector | HARDCODED `'99'` (`operam-client.js:290`) | — | HARDCODED — sin cambio; correcto para PPD, incorrecto si se habilitara PUE |

### 2.4 Configuración comercial

| Campo semántico | Label en Operam | Ruta en Operam | SOP paso | Captura en UI hoy | API Operam | Neon | Estado |
|---|---|---|---|---|---|---|---|
| Lista de precios | Precio de lista | Conf. General > Lista de Precios | 6–7 | No hay selector directo; se deriva del `tier` de la cotización | POST genérico → `sales_type` vía `resolverSalesTypeId(tier, listasPrecios)` (`lib/alta-generica.js:41-44`, `server.js:1080`) | — | **RESUELTO (mecanismo distinto al PRD #26 original)** — antes GAP total; hoy se resuelve automáticamente del tier cotizado, sin selector manual. Si el tier no tiene lista homónima cae a "Precio de lista" (M550, el peor caso para menudeo, issue #92) |
| Segmento de cliente | Segmento Cliente | Conf. General > Segmento Cliente | 8–9 | `alta-upgrade-segmento` (selector nuevo, compartido por las tabs CSF/Manual del panel de upgrade; issue #95 regla 6) | PUT upgrade → `segmento_id` (`DIFF_FISCAL_CAMPOS`) con verificación post-PUT del quirk #74 (Operam puede ignorarlo en silencio) vía el mismo mecanismo genérico de `camposNoActualizados` | — | **RESUELTO (#95) para el camino de upgrade** — sigue sin capturarse en la alta genérica automática (`buildClienteGenerico`); el vendedor lo completa al upgrade fiscal, no en el alta inicial |
| Vendedor asignado | Vendedor | Domicilio > Vendedor | 10–11 | No hay selector; se deriva del vendedor autenticado que genera la cotización | POST genérico → `salesman` = lookup de `entry.vendedor` contra `operam_id` en `data/vendedores.json` (`server.js:1079`) | — | **RESUELTO** — automático, sin intervención del vendedor (a diferencia del PRD #26 original que preveía un selector) |
| Términos de pago | Términos de Pago | Ventas > Términos de Pago | 16–17 | Sin selector | HARDCODED `9` (Anticipo 50%) (`operam-client.js:293`) | — | CORRECTO — sin cambio vs. auditoría anterior (confirmado correcto para mayoreo) |
| Área / Zona de venta | Área/Zona de Venta | Domicilio > Área/Zona de Venta | 23–24 | Derivado del país | `derivarArea(pais)` (`operam-client.js:302-307`): MX→1, US→5, CA→7, otros→6. Se envía en `buildClienteBody` (nivel cliente) SIEMPRE; a nivel branch solo si `actualizarBranchCliente` corre (inalcanzable hoy) | — | **RESUELTO a nivel cliente; PARCIAL a nivel branch** (ver gap nuevo #10) |
| Cuenta de ventas | Cuenta de Ventas | Domicilio/Contabilidad > Cuenta de Ventas | 43–44 | No enviar explícitamente (decisión previa, sigue vigente) | Se deriva de `tax_group_id`, seteado en `actualizarBranchCliente` (`operam-client.js:380`) — **solo corre en el acordeón completo, inalcanzable hoy** | — | **PARCIAL (requiere decision)** — la resolución de la auditoría anterior asumía que el branch siempre se configuraba; hoy, para un cliente nacido de alta genérica, el branch nunca recibe `tax_group_id` explícito. No se verificó en este ciclo cuál es el default de Operam para un branch auto-creado sin ese PUT — requiere decisión de dominio o prueba en vivo |
| Almacén predeterminado | Almacén de Inventario Predeterminada | Domicilio > Almacén | 21–22 | Fijo | `location: '40'` en `buildClienteBody` (nivel cliente, `operam-client.js:294`) se envía SIEMPRE en la alta genérica; a nivel branch (`location: 40`) solo si `actualizarBranchCliente` corre | — | RESUELTO a nivel cliente; PARCIAL a nivel branch, mismo patrón que Área |
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

**Hallazgo central de esta sección:** el domicilio de entrega se sigue capturando en el paso Envío (`cl-*`, campos migrados ahí en issue #84) y se usa para cotizar paquetería (envia.com) y para imprimir el PDF/HTML — pero **no se sube al branch de Operam en el flujo vivo**. `actualizarBranchCliente` (el único código que hace `PUT /api/v3/sales/branches/{id}`) solo lo invoca `POST /api/crear-cliente` (`server.js:1544`), que es el endpoint del acordeón completo sin punto de entrada en la UI (ver hallazgo estructural). La alta genérica (`subirConAltaGenerica`) resuelve el `branch_id` con `obtenerBranchId` pero nunca lo actualiza.

| Campo semántico | Label en Operam | Ruta en Operam | SOP paso | Captura en UI hoy | API Operam (`actualizarBranchCliente`, solo alcanzable vía acordeón completo) | Neon | Estado |
|---|---|---|---|---|---|---|---|
| Nombre de quien recibe | Nombre | Domicilios del Cliente | 42 | `cl-nombre-entrega` (un solo campo, sin apellido separado) | `br_name` | — | **PARCIAL/GAP** — se captura pero no llega a Operam en el camino vivo (alta genérica no toca el branch); antes era "PARCIAL — no hay campo de apellido", ahora el problema es más grave: no llega en absoluto |
| Calle entrega | Dirección Postal | Domicilios > Dirección | 42 | `cl-calle` — **campo combinado "Calle y número exterior"** (`index.html:621-622`), ya no separado en calle/num.ext como antes | `addr_street` (recibiría el string combinado sin separar, solo si el branch se actualizara) | — | **GAP** — no llega a Operam; adicionalmente, si llegara, el campo ya no está separado en calle/num.ext (regresión de forma respecto a la auditoría anterior, que asumía inputs separados) |
| Número exterior entrega | — | Domicilios | 42 | **No existe como campo independiente** — fusionado dentro de `cl-calle` desde issue #84 | `addr_exterior` recibiría cadena vacía si el branch se actualizara (nadie lo puebla por separado) | — | **GAP (regresión confirmada, issue #39 lo señalaba explícitamente)** — antes PARCIAL "solo en csf-upload"; hoy ni siquiera existe como campo capturable independiente en ningún formulario vivo |
| Número interior entrega | — | Domicilios | 42 | `cl-num-int` | `addr_interior` | — | GAP (no llega al branch) — dato capturado, transporte roto |
| Colonia entrega | — | Domicilios | 42 | `cl-colonia` | `addr_colony` | — | GAP (no llega al branch) |
| CP entrega | — | Domicilios | 42 | `cl-cp-entrega` | `addr_zip` | — | GAP (no llega al branch) — aunque sí se usa localmente para cotizar envío (`cpValido`, `chipsCompletitud`) |
| Ciudad entrega | — | Domicilios | 42 | `cl-municipio` (compartido con el paso Cliente) | `addr_city` | — | GAP (no llega al branch) |
| Estado entrega | — | Domicilios | 42 | `cl-estado` | `addr_state` | — | GAP (no llega al branch) |
| Teléfono entrega (con código de país) | Teléfono | Domicilios | 28 | `cl-cel-entrega-code`+`cl-cel-entrega`, combinado con `combinarTelefonoConCodigo` | `phone` (branch) | — | **RESUELTO en captura** (antes "ningún formulario tenía selector de país"; ahora sí) — pero **GAP en transporte** (no llega al branch) |
| Email entrega | E-mail | Domicilios | — | `cl-email-entrega` | `email` (branch) | — | Mismo patrón: capturado, no transportado al branch; sí se usa como email principal del cliente (ver 2.5) |
| Referencias de entrega | Referencias | Domicilios | 42 | `cl-referencias` (textarea, paso Envío) | `addr_reference` — existe en `actualizarBranchCliente` (`operam-client.js:392`) | — | **Reformulado (Gap #7 antiguo ya no aplica tal cual)** — antes el gap era "csf-upload no tiene el campo Y cl-referencias no se conecta"; hoy `cl-referencias` sí existe y sí tiene destino en el código (`addr_reference`), pero como ningún camino vivo llama `actualizarBranchCliente`, el gap real pasó de "falta conexión" a "falta el disparo completo del branch" — ver gap nuevo #10, que es ahora el paraguas de todo el bloque 2.6 |

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
| **9 (nuevo)** | Acordeón completo de alta (`#panel-alta-cliente` secciones 2-4, `POST /api/crear-cliente`) | **Alto — arquitectura** | `abrirAcordeonAlta()` no tiene ningún `onclick` ni caller en `index.html`/`app.js`. Todo el código de configuración comercial (lista de precios, segmento, vendedor, uso CFDI), captura de domicilio de entrega separado (`alta-addr-*`) y el flujo de "Dar de alta" con progreso POST+GET+PUT es inalcanzable desde la UI en producción. Es candidato a: (a) issue de limpieza si se decide que ya no hace falta (la alta genérica lo reemplazó funcionalmente), o (b) issue de bug si se decide que sí debería seguir siendo alcanzable (p. ej. para un alta manual sin pasar por RFC genérico). **Requiere decisión** — no es evidente cuál de las dos alternativas es la intención vigente. |
| **10 (nuevo)** | Domicilio de entrega nunca llega al branch de Operam en el flujo vivo | **Crítico** | `actualizarBranchCliente` (único código que hace `PUT /api/v3/sales/branches/{id}`) solo se invoca desde `POST /api/crear-cliente` (gap #9, inalcanzable). La alta genérica (`subirConAltaGenerica`) resuelve `branch_id` pero nunca lo actualiza. Consecuencia: para todo cliente nacido de la alta genérica (que hoy es la única forma de nacer), el domicilio de entrega, teléfono/email de branch, referencias y `tax_group_id`/`area` a nivel branch quedan en lo que Operam auto-asigne al crear el customer, nunca en lo que el vendedor capturó en el paso Envío. Directamente ligado al gap #9: resolver #9 resolvería #10 automáticamente si el destino elegido es reactivar el acordeón, o requeriría un nuevo mecanismo (p. ej. un botón "Actualizar domicilio en Operam" análogo al de #85) si se decide no reactivarlo. |
| **11 (RESUELTO #95)** | Nombre corto (`cust_ref`) no viaja en el upgrade fiscal | Medio | `DIFF_FISCAL_CAMPOS` ahora mapea `cust_ref <- nombreCorto`; viaja en el `PUT` de upgrade con el mismo mecanismo genérico que RFC/razón social. |
| **12 (RESUELTO #95)** | Tax ID extranjero: ya no se captura en absoluto | Bajo (uso raro, clientes extranjeros) | Nuevo input `manual-tax-id-extranjero` en la tab manual; se persiste en `notes` vía `buildNotasConTaxId` (antepone `Tax ID: XXX` a las notas existentes, sin borrarlas; requiere una relectura previa al PUT solo cuando el campo viene capturado). |
| **13 (RESUELTO #95)** | Uso de CFDI: capturado y descartado | Medio | `DIFF_FISCAL_CAMPOS` mapea `timbrado_uso_cfdi <- usoCfdi`, con envío SIEMPRE (excepción de dominio) y default `S01` cuando no se capturó o vino vacío. |
| **14 (RESUELTO #95)** | Email de facturación no llega en la alta genérica | Medio | `buildClienteGenerico` ahora lee `c.emailFactura -> invoice_email`; `leerClienteFormulario` ya leía el input `cl-email-factura` pero lo descartaba. El upgrade también lo manda (`DIFF_FISCAL_CAMPOS`, tomado del mismo input por `pcEjecutarUpgradeFiscal`). |
| **15 (RESUELTO #95)** | Dirección fiscal (calle/num.ext/num.int/colonia) y país: ausentes en la tab "Captura manual" del upgrade | Medio | Se agregaron `manual-calle`/`manual-num-ext`/`manual-num-int`/`manual-colonia` (opcionales) a la tab manual; el país sigue sin mapearse en `DIFF_FISCAL_CAMPOS` (no forma parte del alcance de #95, permanece como gap menor). |
| **16 (RESUELTO #95, parcial)** | Segmento de cliente | Alto (heredado de auditoría anterior) | `DIFF_FISCAL_CAMPOS` mapea `segmento_id <- segmentoId`, capturable en el nuevo selector `alta-upgrade-segmento` del panel de upgrade, con verificación post-PUT automática del quirk #74. Sigue sin capturarse en la alta genérica automática (`buildClienteGenerico`) — el vendedor lo completa al hacer el upgrade fiscal, no en el alta inicial del cliente genérico. |
| **17 (nuevo)** | Tax_group_id / cuenta de ventas para clientes de alta genérica | **Requiere decisión** | Sin el PUT branch (gap #10), no se verificó en este ciclo qué `tax_group_id` (y por lo tanto qué cuenta de ventas derivada) recibe un branch auto-creado sin configuración explícita. Riesgo contable no cuantificado. |
| 1 (heredado) | Celular como campo API dedicado | Limitación de plataforma | Sin cambio — sigue sin ser settable vía API v3, solo vía notas. |
| 2 (heredado, RESUELTO) | Cuenta de ventas vía `tax_group_id` en el branch | — | Ver gap nuevo #17 — la resolución previa asumía que el branch siempre se configuraba; ya no es cierto en el camino vivo. |
| 3 (heredado) | Clasificación del contacto ("Contacto para") | Limitación de plataforma | Sin cambio, no re-verificado en este ciclo. |
| 4 (heredado, RESUELTO a nivel cliente) | Almacén predeterminado | — | `location: '40'` sí viaja a nivel cliente en la alta genérica; a nivel branch depende del gap #10. |
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

- **PRD #26** — especificación original de lista de precios/segmento/vendedor; superada en su mecanismo (ya no hay selector manual, se resuelve automático en la alta genérica) pero el objetivo de fondo se cumplió parcialmente — ver gap #16 (segmento sigue pendiente).
- **ADR-0001** — deduplicación por nombre normalizado para RFC genérico.
- **ADR-0002** — alta como operación atómica; no fire-and-forget.
- **ADR-0003** — `csf-upload.html` se depreca; alta integrada en `index.html`. Superada parcialmente por ADR-0006 (issue #82 retiró el botón "+ Nuevo cliente" de la pantalla de entrada; el acordeón que ADR-0003 integró sigue vivo en código pero, tras el retiro de su botón de entrada, quedó sin disparador — ver gap #9 de esta re-auditoría).
- **ADR-0006** — subida automática de cotizaciones y alta temprana de cliente genérico; CSF como upgrade, nunca alta. Es el ADR que rige el flujo vivo hoy.
- **`CONTEXT.md`** — glosario de dominio con definiciones precisas de todos los términos del proceso.

Ver `PROCESO_COMERCIAL_AS_IS.md` para el contexto del proceso comercial completo.
