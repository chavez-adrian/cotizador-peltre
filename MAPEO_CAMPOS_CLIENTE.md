# Mapeo de campos de cliente

**Versión:** 1.1  
**Fecha:** 2026-06-06  
**Propósito:** Cruzar los campos requeridos por el SOP de alta de clientes en Operam contra lo que el cotizador captura actualmente, lo que llega a la API de Operam y lo que queda registrado en Neon DB.

**Nota (2026-07-08):** este mapeo describe el flujo de alta previo al PRD #79/ADR-0006 (POST único con todos los datos fiscales de una vez). Desde ese PRD, el cliente nace con RFC genérico al generar la primera cotización (issue #81) y los datos fiscales llegan después, vía `PUT` de upgrade (issue #85) — el mapeo de campos fiscales sigue siendo válido para ese `PUT` (mismos campos de Operam), pero el momento y el endpoint cambiaron. No se reescribió la tabla completa; ver `docs/adr/0006-cliente-generico-temprano.md` y `server.js` (`PUT /api/actualizar-cliente-fiscal/:id`) para el flujo actual.

**Nota:** En la tabla maestra, la columna "API Operam (crearCliente)" cubre el endpoint `POST /api/v3/sales/customers` via `buildClienteBody()`. Los campos del domicilio de entrega (sección 2.6) llegan a `PUT /api/v3/sales/branches/{branch_id}` via `actualizarBranchCliente()` — Operam auto-crea el branch en el POST; el GET posterior recupera el branch_id; el PUT lo configura. Ver ADR-0002.

---

## 1. Fuentes cruzadas

| Fuente | Archivo |
|--------|---------|
| SOP oficial de alta de clientes | `SOP_crear_cliente_operam.md` |
| Formulario de alta desde CSF | ~~`public/csf-upload.html`~~ retirado (ADR-0003); la carga de CSF vive en `public/js/app.js` (acordeón `#panel-alta-cliente`), reorientada al upgrade del cliente genérico desde el chip Fiscal de la tarjeta (issue #85) |
| Formulario del cotizador principal | `public/index.html` + `public/js/app.js` |
| Función de creación en API | `lib/operam-client.js` → `buildClienteBody()` + `crearCliente()` |
| Auditoría en base de datos | `lib/db.js` → tabla `clientes_log` en Neon |

---

## 2. Tabla maestra de campos

**Convenciones de estado:**
- `OK` — campo cubierto correctamente
- `PARCIAL` — campo existe pero con limitaciones (ver notas)
- `GAP` — campo requerido por el SOP que el cotizador no captura
- `HARDCODED` — valor fijo en el código; el SOP lo requiere configurable
- `CORRECTO` — valor hardcodeado que coincide con lo que el SOP indica como estándar

### 2.1 Identificación del cliente

| Campo semántico | Label en Operam | Ruta en Operam | SOP paso | csf-upload.html | cotizador index.html | API Operam (`crearCliente`) | Neon `clientes_log` | Estado |
|---|---|---|---|---|---|---|---|---|
| RFC | R.F.C. | Conf. General > Nombre y Dirección > R.F.C. | 3 | `f_tax_id` | `cl-rfc` | `tax_id` | `rfc` (NOT NULL) | OK |
| Razón social / Nombre | (campo principal) | Conf. General | 5 (SAT) | `f_CustName` | `cl-razon-social` | `cust_name` | `nombre` | OK |
| Nombre corto | (cust_ref interno) | Conf. General | — | `f_cust_ref` | `cl-nombre-corto` | `cust_ref` | — | OK |
| SAT IdCIF | SAT IdCIF | Conf. General > Nombre y Dirección > SAT IdCIF | 4 | `f_idcif` | — | `idcif` | — | PARCIAL — solo en csf-upload |
| Tax ID extranjero | — | — | — | `f_tax_id_ext` | `cl-tax-id-ext` | concatenado en `notes` | — | PARCIAL — no va como campo independiente a Operam |

### 2.2 Dirección fiscal (precargada desde SAT, paso 5)

| Campo semántico | Label en Operam | Ruta en Operam | SOP paso | csf-upload.html | cotizador index.html | API Operam | Neon | Estado |
|---|---|---|---|---|---|---|---|---|
| Calle | Calle | Nombre y Dirección | 5 | `f_street` | — | `street` | — | PARCIAL — solo en csf-upload |
| Número exterior | Número | Nombre y Dirección | 5 | `f_street_number` | — | `street_number` | — | PARCIAL — solo en csf-upload |
| Número interior | Interior | Nombre y Dirección | 5 | `f_suite_number` | — | `suite_number` | — | PARCIAL — solo en csf-upload |
| Colonia | Colonia | Nombre y Dirección | 5 | `f_district` | — | `district` | — | PARCIAL — solo en csf-upload |
| Código postal fiscal | C.P. | Nombre y Dirección | 5 | `f_postal_code` | `cl-cp-fiscal` | `postal_code` | — | OK |
| Municipio | Ciudad / Municipio | Nombre y Dirección | 5 | `f_city` | `cl-municipio` | `city` | — | OK |
| Estado | Estado | Nombre y Dirección | 5 | `f_state` | `cl-estado` | `state` | — | OK |
| País | País | Nombre y Dirección | — | `f_pais` | `cl-pais` | `country` | — | OK |

### 2.3 Configuración fiscal / CFDI

| Campo semántico | Label en Operam | Ruta en Operam | SOP paso | csf-upload.html | cotizador index.html | API Operam | Neon | Estado |
|---|---|---|---|---|---|---|---|---|
| Régimen fiscal SAT | Régimen Fiscal | CFDI | 5 (SAT) | `f_cfdi_regimen_fiscal` | — | `cfdi_regimen_fiscal` (default '612') | — | PARCIAL — solo en csf-upload |
| Uso de CFDI | Uso de CFDI | CFDI | — | `f_timbrado_uso_cfdi` (selector 29 opciones) | — | `timbrado_uso_cfdi` | — | HARDCODED — `buildClienteBody` ignora el selector y envía siempre `'S01'` (lib/operam-client.js:167) |
| Método de pago CFDI | Método de Pago | CFDI > Método de Pago | 12–13 | — | — | `cfdi_method_payment` | — | HARDCODED — siempre `'PPD'`; SOP pide configurar PPD o PUE |
| Forma de pago CFDI | Forma de Pago | CFDI > Forma de Pago | 14–15 | — | — | `cfdi_form_payment` | — | HARDCODED — siempre `'99'`; correcto para PPD pero no para PUE |

### 2.4 Configuración comercial

| Campo semántico | Label en Operam | Ruta en Operam | SOP paso | csf-upload.html | cotizador index.html | API Operam | Neon | Estado |
|---|---|---|---|---|---|---|---|---|
| Lista de precios | Precio de lista | Conf. General > Lista de Precios | 6–7 | — | — | `sales_type` (PRD #26) | — | **GAP → PRD** — no en ningún formulario actual; se implementa en PRD #26 como selector `/api/catalogos`; opciones mayoreo: M100, M350, M550, M1500, M6000, M6001, US100, US350, US550, US1500, US6000 |
| Segmento de cliente | Segmento Cliente | Conf. General > Segmento Cliente | 8–9 | `f_segmento_id` | — | `segmento_id` (PRD #26) | — | PARCIAL → PRD — se captura en csf-upload pero no llega a Operam; se implementa en PRD #26 via `buildClienteBody()` |
| Vendedor asignado | Vendedor | Domicilio > Vendedor | 10–11 | `f_salesman` | — | `salesman` = `operam_id` (PRD #26) | — | PARCIAL → PRD — se captura pero no llega a Operam; `data/vendedores.json` tiene campo `operam_id` separado del `id` interno; se implementa en PRD #26 |
| Términos de pago | Términos de Pago | Ventas > Términos de Pago | 16–17 | — | `cl-condiciones` | `payment_terms` | — | CORRECTO — hardcodeado `9` (Anticipo 50%); confirmado correcto para todos los clientes de mayoreo; fuera de scope cambiarlo |
| Área / Zona de venta | Área/Zona de Venta | Domicilio > Área/Zona de Venta | 23–24 | — | — | `area` | — | HARDCODED → PRD — actualmente `1` para todos; se deriva del país en PRD #26: MX→`1`, US→`5`, CA→`7`, otros→`6` |
| Cuenta de ventas | Cuenta de Ventas | Domicilio/Contabilidad > Cuenta de Ventas | 43–44 | — | — | (no enviar) | — | RESUELTO — verificado 2026-06-06: `sales_account` siempre vacío en API incluso en clientes configurados vía UI; Operam lo deriva internamente del `tax_group_id`; nunca enviar este campo explícitamente |
| Almacén predeterminado | Almacén de Inventario Predeterminada | Domicilio > Almacén | 21–22 | — | — | `location: 40` en PUT branch | — | RESUELTO — verificado 2026-06-06: campo correcto en PUT `/api/v3/sales/branches/{id}` es `location: 40` (entero); NO es `default_location`; siempre `40` (PT); no editable por el vendedor |
| Dimensión D1 | D1 — TALLER CASINO DE LA SELVA | Ventas > Dimensiones | 18–19 | — | — | `dimension_id` | — | CORRECTO — hardcodeado en `1`; coincide con SOP |
| Dimensión D2 | D2 — CORPORATIVO | Ventas > Dimensiones | 18–20 | — | — | `dimension2_id` | — | CORRECTO — hardcodeado en `5`; coincide con SOP |
| Moneda | Moneda | — | — | derivado de `f_pais` | — | `curr_code` (MXN / USD) | — | OK |

### 2.5 Contacto principal

| Campo semántico | Label en Operam | Ruta en Operam | SOP paso | csf-upload.html | cotizador index.html | API Operam | Neon | Estado |
|---|---|---|---|---|---|---|---|---|
| Email principal | E-mail | Domicilio > E-mail | 25–26 | `f_email` | — | `email` | — | PARCIAL — solo en csf-upload |
| Teléfono (con código de país) | Teléfono | Domicilio > Teléfono | 27–29 | `f_phone_code` + `f_phone_number` | `cl-telefono` (sin selector de país) | `phone` | — | PARCIAL — cotizador main no tiene selector de código de país |
| Celular | Celular | Domicilio > Celular | 30 | (mismo número que teléfono según SOP) | — | — | — | **GAP** — SOP requiere capturar también en campo Celular; no está en la API |
| Email para factura | — | — | — | `f_invoice_email` | `cl-email-factura` | `invoice_email` | — | OK |
| Clasificación del contacto | Contacto para | Contacto > Contacto para | 34–35 | — | — | — | — | **GAP + LIMITACIÓN DE PLATAFORMA** — SOP exige General / Invoices / Deliveries; POST a endpoints de contactos devuelve 501; PUT a customer con contactos nuevos sin ID los ignora (verificado contra producción 2026-06-06); gestión exclusivamente manual en UI de Operam |

### 2.6 Dirección de entrega (domicilio operativo)

| Campo semántico | Label en Operam | Ruta en Operam | SOP paso | csf-upload.html | cotizador index.html | API Operam (`entrega`) | Neon | Estado |
|---|---|---|---|---|---|---|---|---|
| Nombre de quien recibe | Nombre | Domicilios del Cliente | 42 | `f_del_name` (nombre + apellido en un campo) | `cl-nombre-entrega` | `br_name` | — | PARCIAL — no hay campo separado para apellido |
| Calle entrega | Dirección Postal | Domicilios > Dirección | 42 | `f_del_street` | `cl-calle` | `addr_street` | — | OK |
| Número exterior entrega | — | Domicilios | 42 | `f_del_ext` | — | `addr_exterior` | — | PARCIAL — solo en csf-upload |
| Número interior entrega | — | Domicilios | 42 | `f_del_int` | `cl-num-int` | `addr_interior` | — | OK |
| Colonia entrega | — | Domicilios | 42 | `f_del_colony` | `cl-colonia` | `addr_colony` | — | OK |
| CP entrega | — | Domicilios | 42 | `f_del_zip` | `cl-cp-entrega` | `addr_zip` | — | OK |
| Ciudad entrega | — | Domicilios | 42 | `f_del_city` | `cl-municipio` | `addr_city` | — | OK |
| Estado entrega | — | Domicilios | 42 | `f_del_state` | `cl-estado` | `addr_state` | — | OK |
| Teléfono entrega (con código de país) | Teléfono | Domicilios | 28 | `f_del_phone` (sin selector de código de país) | `cl-cel-entrega` (sin selector) | `phone` | — | PARCIAL — ningún formulario tiene selector de código de país para entrega |
| Email entrega | E-mail | Domicilios | — | `f_del_email` | `cl-email-entrega` | `email` | — | OK |
| Referencias de entrega | Referencias | Domicilios | 42 | — | `cl-referencias` | `addr_reference` en branch API | — | PARCIAL — ausente en csf-upload.html; `cl-referencias` del cotizador principal no se envía a Operam actualmente, pero el campo SÍ existe en `POST /api/v3/sales/branches` |

### 2.7 Auditoría / trazabilidad

| Campo semántico | csf-upload.html | cotizador index.html | API Operam | Neon `clientes_log` | Notas |
|---|---|---|---|---|---|
| Fecha de CSF | `f_csf_fecha` | — | incluida en `notes` | — | Solo informativa |
| Fuente de alta | `fuente` ('operam-csf' / 'operam-manual') | — | — | `fuente` | Para auditoría |
| Notas / actividades económicas | `f_notes` | — | `notes` | — | Se concatena con Tax ID y fecha CSF |
| ID del cliente en Operam | — | — | respuesta de POST | `cliente_id` | Trazabilidad |
| Resultado de la operación | — | — | — | `resultado` | éxito / duplicado / error |
| PDF subido a Dropbox | — | — | — | `dropbox_ok` | Fire-and-forget |
| Mensaje de error | — | — | — | `error_msg` | Solo si falla |

---

## 3. Gaps identificados

Campos que el SOP exige y el cotizador no cubre actualmente, ordenados por impacto:

| # | Campo | Label en Operam | Impacto | Descripción del gap |
|---|---|---|---|---|
| 1 | Lista de precios | "Precio de lista" | **Crítico** | El SOP (paso 6–7) requiere asignar M100, M350, M550, M1500, M6000 o M6001 según el volumen del cliente. No existe en ningún formulario ni en `buildClienteBody`. Actualmente se asigna manualmente en Operam después del alta. |
| 2 | Cuenta de ventas | "Cuenta de Ventas" | **Crítico** | El SOP (paso 43–44) requiere `401-01-001` para México o `401-07-000` para exportación. Verificado empíricamente (2026-06-06): `sales_account` siempre aparece vacío en la API incluso en clientes correctamente configurados vía UI. Operam deriva la cuenta de ventas internamente del `tax_group_id` del branch — no es un campo que el cotizador deba setear. Gap resuelto seteando `tax_group_id: 1` (México) o `tax_group_id: 2` (extranjero) en el PUT del branch. |
| 3 | Clasificación del contacto | "Contacto para" | **Limitación de plataforma** | El SOP (paso 34–35) exige General, Invoices y Deliveries. **Confirmado 2026-06-06:** POST a cualquier endpoint de contactos → 501; PUT a customers con array `contacts` (incluyendo IDs existentes) → silenciosamente ignorado. Operam auto-genera un contacto General al crear el cliente. Los contactos Invoices y Deliveries son paso manual del SOP posterior al alta. NO es un gap implementable — es una limitación de la API v3. |
| 4 | Almacén predeterminado | "Almacén de Inventario Predeterminada" | **Alto** | El SOP (paso 21–22) requiere `PT` (producto terminado). Verificado empíricamente (2026-06-06): el branch auto-creado recibe `default_location: "40"` si el POST del cliente incluye `location: 40`. Para actualizarlo vía PUT branch, el campo correcto es `location: 40` (entero), no `default_location`. Gap resuelto incluyendo `location: 40` tanto en el POST del cliente como en el PUT del branch. |
| 5 | Celular | "Celular" | **Limitación de plataforma** | El SOP (paso 30) indica capturar también en el campo Celular. Campo a nivel contacto, no a nivel cliente/branch. **Confirmado 2026-06-06:** no es settable vía ningún endpoint de API v3. Workaround: capturar en notas del cliente al crear; registrar manualmente en Operam UI > contacto General > campo Celular como paso post-alta. |
| 6 | Código de país en teléfono de entrega | "Teléfono" (domicilio) | **Medio** | Ningún formulario tiene selector de código de país para el teléfono de la dirección de entrega. El SOP (paso 28) exige incluirlo. PRD #26 incluye agregar selector de código de país al formulario de entrega en index.html. |
| 7 | Referencias de entrega | "Referencias" | **Medio** | `csf-upload.html` no tiene campo de referencias de entrega. El cotizador principal sí tiene `cl-referencias` pero no se envía a Operam actualmente. El campo `addr_reference` SÍ existe en la branch API — es solo un gap de frontend y de conexión. |
| 8 | Apellido de quien recibe | "Nombre" | **Bajo** | `f_del_name` y `cl-nombre-entrega` son un solo campo de texto libre. El SOP podría requerir nombre y apellido separados para la persona que recibe en el domicilio. |

---

## 4. Valores hardcodeados vs SOP

Campos que `buildClienteBody()` (`lib/operam-client.js:131–143`) envía con valor fijo a Operam, sin pasar por la UI:

| Campo | Label en Operam | API param | Valor hardcodeado | Lo que el SOP indica | ¿Es problema? |
|---|---|---|---|---|---|
| Uso de CFDI | Uso de CFDI | `timbrado_uso_cfdi` | `'S01'` | Configurable; verificar con el cliente antes de facturar | Sí — el selector del HTML (`f_timbrado_uso_cfdi`) existe pero es ignorado |
| Método de pago CFDI | Método de Pago | `cfdi_method_payment` | `'PPD'` | PPD o PUE según la negociación | Sí para clientes de contado o PUE |
| Forma de pago CFDI | Forma de Pago | `cfdi_form_payment` | `'99'` | `'99'` si PPD (correcto); forma real si PUE | Solo si se habilita PUE |
| Términos de pago | Términos de Pago | `payment_terms` | `9` (Anticipo 50%) | Elegir según negociación | **No** — confirmado correcto para todos los clientes de mayoreo; fuera de scope cambiarlo (PRD #26) |
| Área / Zona de venta | Área/Zona de Venta | `area` | `1` | MX→`1`, US→`5`, CA→`7`, otros→`6` | **Sí → PRD #26** — se automatiza derivando del país del domicilio; ya no será hardcodeado |
| Ubicación (almacén en crearCliente) | (interno) | `location` | `'40'` | No especificado en SOP para este endpoint; `PT` se configura en el branch via `default_location: "40"` | No — `'40'` es correcto; el campo relevante para PT está en el branch |
| Dimensión D1 | D1 — TALLER CASINO DE LA SELVA | `dimension_id` | `1` | `1` (paso 19) | No — valor correcto según SOP |
| Dimensión D2 | D2 — CORPORATIVO | `dimension2_id` | `5` | `5` (paso 20) | No — valor correcto según SOP |

---

## 5. Decisiones tomadas

Este mapeo fue el insumo para el PRD (issue #26) y el grill session que produjo los ADRs. Las decisiones ya están documentadas:

- **PRD #26** — `github.com/chavez-adrian/cotizador-peltre/issues/26` — especificación completa de la implementación.
- **ADR-0001** — `docs/adr/0001-deduplicacion-clientes-rfc-generico.md` — deduplicación por nombre normalizado para RFC genérico.
- **ADR-0002** — `docs/adr/0002-alta-cliente-operacion-atomica.md` — alta como operación atómica; no fire-and-forget.
- **ADR-0003** — `docs/adr/0003-unificacion-alta-cliente-en-cotizador.md` — `csf-upload.html` se depreca; alta integrada en `index.html`.
- **`CONTEXT.md`** — glosario de dominio con definiciones precisas de todos los términos del proceso.

Ver `PROCESO_COMERCIAL_AS_IS.md` para el contexto del proceso comercial completo.
