# ADR-0007: Vigencia "Válido hasta" — post-fix inmediato por la web legacy de Operam

## Status

Accepted (2026-07-27)

## Context

La API v3 de Operam no permite fijar la vigencia de una cotización. Verificado en vivo (HITL #68, quotes 1160-1163) y documentado en `lib/operam-client.js:237-241`: el `POST /api/v3/sales/quote` **ignora** `valid_until`, `delivery_date`, `valid_days` y 7 nombres más, y deja el campo nativo "Válido hasta" en `ord_date-1`. Tampoco existe `PUT` de quotes (501).

La vigencia correcta sí viaja en dos lugares: el campo `comments` del quote (`lib/operam-client.js:244`) y el PDF/HTML que genera el cotizador. El problema es exclusivamente el campo nativo que la UI de Operam muestra como "Válido hasta".

Sondeo de la web legacy contra la cotización 1193 (solo lectura, 2026-07-27):

- `GET /sales/sales_order_entry.php?ModifyQuotationNumber=1193` devuelve el **formulario de edición completo, renderizado en servidor** (FrontAccounting clásico, sin SPA). El campo es `<input name="delivery_date">`; el submit es `ProcessOrder` ("Confirmar Cambios").
- El formulario incluye `_token` (CSRF por sesión), `cart_id` (las líneas viven en `$_SESSION`) y `_modified` (control de edición concurrente).
- La cotización 1193, creada el 2026-07-27 con 30 días de vigencia, muestra `delivery_date = 2026-07-26` y el aviso **"Esta cotizacion esta vencida"**, mientras su `comments` dice "Valido hasta: 2026-08-26". El ERP declara vencido un documento vivo: el defecto no es cosmético.
- El parámetro correcto es `ModifyQuotationNumber`. `ModifyQuotation` devuelve la página sin formulario, y `ModifyOrderNumber` interpreta el número como pedido.

Precedente de scraping: `lib/operam-web.js` (91 líneas — login por form de FA con cookie, GET de `view_sales_order.php`, y un predicado puro sobre el HTML) resuelve el estado de cancelación, que la API v3 tampoco expone (#76). Dos precisiones que las notas del issue #100 y el ADR-0006 omiten: **ese módulo es solo lectura**, y **vive únicamente en la rama `issue-76-backfill`, nunca mergeada a `main`**. No hay infraestructura de scraping en producción hoy.

## Decision

**El campo nativo "Válido hasta" se corrige por post-fix contra la web legacy, inmediatamente después del `POST` del quote por API**, dentro de la misma operación de subida.

- Se trae `lib/operam-web.js` a `main` desde `issue-76-backfill` y se extiende a escritura: `GET` del formulario de edición → parsear **todos** sus campos → re-postearlos idénticos salvo `delivery_date` → `ProcessOrder`. Preservar literalmente todo lo demás es la forma más segura de escribir: el post-fix no decide el contenido del documento, solo lo devuelve con un campo cambiado.
- **Inmediato, no diferido.** La ventana entre el `POST` del quote y el post-fix es de segundos: nada cambió de precios ni existencias, y nadie más tocó el documento. Esto acota el riesgo de que `ProcessOrder` recalcule algo con datos distintos de los que el cliente ya recibió.
- **No bloqueante.** Si el post-fix falla, el quote ya existe y `comments` sigue siendo el respaldo de la vigencia. Un fallo se reporta como `step` con `status: 'error'` (mismo trato que el `PUT` del branch en `#96`), nunca tumba la subida.
- **Con verificación post-escritura**, releyendo el documento y comparando `delivery_date`: mismo patrón que el quirk ya documentado del `PUT` de clientes (200 que ignora campos en silencio) y que `diffBranchDomicilio`.
- **Sin backfill.** Los quotes ya creados con la fecha mala se quedan como están. El backfill es el caso de mayor riesgo (documentos viejos, precios que pudieron cambiar entre la creación y la corrección) y su beneficio es marginal: son cotizaciones cuya vigencia ya venció o está por vencer.

La decisión aplica **solo a la vigencia**. La edición del *contenido* de un quote (#104) queda como decisión abierta — ver "Alcance no cubierto".

### Alternativas descartadas

**Tratar el cotizador como única fuente de verdad** (PDF/HTML + `comments`) y documentar a los vendedores que el campo nativo no es confiable. Cero código y cero riesgo, pero deja al ERP mostrando "Esta cotizacion esta vencida" sobre cotizaciones vivas y obliga a cada vendedor a sostener mentalmente la excepción. Operam es la fuente única de información comercial (ADR-0006); un campo visible y sistemáticamente incorrecto la erosiona.

**Reproducir el carrito por scraping para editar el quote completo** (`Edit0`/`Delete0`/`AddItem` contra `$_SESSION['Items']`, cada línea un `POST`). Es lo que pediría #104. Se descarta *para este ADR* por ser un orden de magnitud más frágil que cambiar un campo de texto, y porque un fallo a mitad de camino deja el documento en un estado intermedio inválido.

## Consequences

- El campo nativo de Operam pasa a ser correcto en quotes nuevos creados por el cotizador. `comments` conserva la línea "Valido hasta: ..." como respaldo — redundante a propósito, porque el post-fix puede fallar.
- Se introduce en el camino crítico de la subida una dependencia del **HTML de un SaaS de terceros**. Operam actualiza sin compromiso de compatibilidad; cuando cambie un `name=` del formulario, el post-fix fallará. El modo de falla peligroso es el silencioso (escribir algo distinto de lo esperado), y por eso la verificación post-escritura no es opcional.
- `CancelOrder` vive en el mismo formulario que `ProcessOrder`. Un error de serialización del body no degrada: **anula la cotización**. La construcción del body debe ser explícita sobre qué botón manda.
- **Riesgo abierto al aprobar el ADR — resuelto el 2026-07-27 (ver "Verificación"):** no se pudo verificar leyendo si `ProcessOrder` re-aplica la lista de precios (`sales_type`) o toca reservas de inventario (`Location`) al re-confirmar el documento — en el mismo formulario existe un botón `update = "Recalculate"`. La implementación debía verificarlo contra un quote desechable antes de habilitarse en el camino de subida.
- El estado del documento vive en `$_SESSION` atado a la cookie de la cuenta `Claude Code`. Los post-fixes deben serializarse: dos corridas concurrentes sobre la misma cuenta se pisan. El lock `subidasOperamEnCurso` de `server.js` ya cubre el caso por cotización, no entre cotizaciones distintas.
- El cotizador pasa a depender de **dos** mecanismos de auth contra Operam: el Bearer de la API v3 y la sesión por cookie de la web legacy. Son independientes; una rotación de contraseña rompe ambos, un cambio de la API rompe solo uno.
- Se acepta que el sistema escriba en el ERP por un canal no soportado por el proveedor. Es una deuda consciente: la alternativa es que Operam exponga la vigencia en la API v3, y esa petición al proveedor sigue siendo la solución de fondo.

## Verificación (2026-07-27, implementación #106)

El gate previo se ejecutó contra un cliente y una cotización desechables (cliente 487, quote 1195) con un precio unitario deliberadamente fuera de toda lista (99.99) y un descuento propio (7%), para que cualquier recálculo fuera visible:

- **`ProcessOrder` NO recalcula.** Tras el post-fix, partidas, precio unitario, descuento, subtotal, IVA y total quedaron **idénticos** carácter por carácter. El riesgo que quedaba abierto se cierra: la decisión de este ADR se sostiene.
- El campo nativo quedó corregido (`2026-08-26`, la vigencia real) y el aviso **"Esta cotizacion esta vencida"** desapareció de la página de edición. El quote 1193, sin post-fix, conserva `2026-07-26` y sigue mostrando el aviso — control de la comparación.

Quedan en Operam para limpieza manual el cliente 487 ("PRUEBA POST-FIX VIGENCIA 106 - BORRAR") y su cotización 1195.

### Alcance no cubierto

Este ADR **no** decide qué pasa con el quote de Operam cuando se "Actualiza" una cotización ya subida (#104). Hoy `server.js:1240` devuelve `yaSubida: true` y no re-sube: si una actualización cambia precios o cantidades, el PDF que recibe el cliente diverge en silencio del quote registrado en Operam, y el pedido se surte contra Operam. Esa decisión queda abierta a propósito, para tomarse informada por lo que se aprenda al implementar el post-fix de `delivery_date` — en particular, por la respuesta al riesgo abierto sobre `ProcessOrder`.

Las opciones sobre la mesa para #104 son (a) anular el quote por la web legacy y recrearlo por la API v3, aceptando que cambia el folio; (b) reproducir el carrito por scraping conservando el folio; (c) no tocar Operam. **#104 sigue bloqueado.**
