# ADR-0008: Actualizar cotización editando el quote por la web legacy (conservando el folio)

- **Estado:** Aprobado (2026-07-28). Decisión de Adrián.
- **Issue:** #104. Antecedente: ADR-0007 (#106), que dejó esta pregunta explícitamente abierta.

## Contexto

Hoy "Cargar" desde el historial se comporta como crear-nueva: cambiar parámetros y Generar produce un registro nuevo del cotizador y (por la auto-subida de #83) un quote NUEVO en Operam. La API v3 de quotes no tiene PUT (501), así que "actualizar" el quote existente solo es posible por la web legacy (FrontAccounting).

El ADR-0007 dejó tres opciones para #104: (a) anular el quote y recrearlo por API (cambia el folio), (b) editar el quote por scraping conservando el folio, (c) no tocar Operam.

## Decisión

**Opción (b): editar el quote existente vía `sales_order_entry.php?ModifyQuotationNumber=N`, conservando el folio.**

Razones para descartar (a), operativas y decisivas: cada edición generaría una cotización cancelada más en Operam, y los reportes de consulta de cotizaciones listan TODAS, incluidas las canceladas — con el volumen de ediciones reales sería muy difícil distinguir las cotizaciones vivas. Contra (c): dejar el quote desactualizado en el ERP reproduce la confusión que ya ocurrió en vivo (2026-07-28: quote con contenido distinto del que el vendedor creía haber mandado).

### La palanca central de robustez: la edición de FA es transaccional de facto

El formulario de edición de FrontAccounting no escribe el documento en cada paso: `Delete{n}` y `AddItem` mutan el carrito en `$_SESSION` (atado al `cart_id` del form), y la base de datos solo se toca cuando se manda `ProcessOrder`. Consecuencia de diseño: **cualquier fallo antes de `ProcessOrder` se resuelve abandonando la sesión, con el documento intacto**. El único momento de exposición real es el único POST de `ProcessOrder` — exactamente la misma exposición que ya aceptamos en el post-fix de vigencia (ADR-0007), que está en producción.

> **Supuesto de carga.** Que `Delete{n}`/`AddItem` no escriben nada en la base es una inferencia de la arquitectura de FA (cart en sesión + `cart_id`), no un hecho verificado. La implementación DEBE verificarlo en vivo contra un quote desechable antes de habilitar el flujo en la UI. Si resultara falso, este ADR se revisa.

### Algoritmo (reescritura completa, no diff)

1. **Gate**: solo cotizaciones con folio ya subido y **sin pedido asociado** (`data.orderOperam` del sync #62 ausente). Operam además deshabilita la edición en su UI cuando el quote ya se convirtió — el gate del cotizador debe ser consistente con eso.
2. Abrir el formulario de edición y parsear (reutilizando `parsearFormularioQuote`).
3. **Borrar todas las líneas**: `Delete0` iterado, re-parseando la respuesta en cada paso (los índices se renumeran tras cada borrado; iterar `Delete0` N veces evita depender de la numeración).
4. **Agregar las líneas nuevas**: un `AddItem` por partida (`stock_id`, `qty`, `price`, `Disc`), reutilizando el MISMO mapeo de SKUs/precios de `subirCotizacionOperam` para que crear y actualizar produzcan quotes idénticos.
5. **Un único `ProcessOrder`** con el header actualizado en el mismo body: `Comments` (vía `armarComentariosQuote`), `cust_ref` (cadena de #108) y `delivery_date` = vigencia — en este camino el post-fix separado de vigencia (#106) no hace falta: viaja en el mismo POST.
6. **Verificación post-escritura obligatoria** releyendo `view_sales_order.php`: SKUs, cantidades, precios, total y comments contra lo esperado. Discrepancia → aviso al vendedor (patrón #106); nunca fallo silencioso.

### Reglas heredadas de ADR-0007 que aplican igual

- El submit se agrega explícito y constante; `CancelOrder` vive en el mismo form y JAMÁS se copia ni se parametriza.
- Un POST de escritura no se reintenta a ciegas (no se sabe si llegó); la sesión caduca a mitad = abortar.
- Serialización en la cola de proceso de `operam-web.js` (el estado vive en `$_SESSION` de una sola cuenta). Vale por la instancia única de Render (Starter); con más instancias haría falta lock compartido.

### Comportamiento del registro del cotizador si la edición web falla

Propuesta (a confirmar en implementación): el registro del cotizador SÍ se actualiza siempre (es la fuente del PDF/HTML que ve el cliente), y si la edición del quote falla, la cotización queda marcada con "quote de Operam desactualizado" + botón de reintento — análogo al estado PRE de la subida.

## UX

Tras Cargar desde el historial, dos acciones explícitas:

- **"Actualizar cotización"** — reutiliza `cotizacionId` (revierte el reset de `lastCotizacionId`, #83 F1) y edita el quote en Operam conservando folio. Default cuando la cotización está viva y sin pedido; **deshabilitado si hay pedido asociado**.
- **"Crear nueva a partir de ésta"** — el comportamiento actual, ahora con nombre honesto.

## Consecuencias

- La superficie de scraping crece: de 1 POST (post-fix de vigencia) a N+2 POSTs por edición. Mitigación: todo menos `ProcessOrder` es reversible por abandono; verificación post-escritura; los selectores/campos se toman del form parseado, no hardcodeados.
- El botón `update` ("Recalculate") del form sugiere que FA puede recalcular precios de lista; verificar en vivo que el `price` enviado en `AddItem` prevalece sobre la lista del cliente.
- Un cambio de HTML de Operam rompe el flujo; el modo de falla esperado es ruidoso (parseo falla → abortar sin `ProcessOrder`), y la verificación post-escritura cubre el silencioso.
- Fase obligatoria de implementación: probar el ciclo completo contra un quote desechable en producción ANTES de cablear los botones a la UI (mismo protocolo que la verificación del ADR-0007).
