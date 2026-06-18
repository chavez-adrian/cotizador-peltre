# PROGRESS — cotizador-peltre

> Este archivo es solo para **retomar**: estado, backlog activo, cómo orquestar, y decisiones/lecciones que NO viven en otro lado. El detalle de cada issue cerrado está en **git** (commits del merge) y en el **comentario de cierre del issue** en GitHub; las decisiones de dominio en **CONTEXT.md**/ADRs; el API de Operam en **peltre-operam.md**. No duplicar ese detalle aquí.

## Estado (2026-06-17)
- **PRD #52 (pipeline unificado de 7 etapas) COMPLETO y operando**: #53–#66 cerrados + **#62 sync Operam post-venta activado** (webhooks reales configurados). Suite **766/0**.
- **Trabajo activo = backlog de la prueba integral**. **#69 CERRADO** (estado compartido alta↔cotizador + aviso de celular enriquecido; mergeado 0d1493a). Resto: atacar uno a uno con subagente fresco.

## Cómo retomar (protocolo de orquestación)
Tu rol = **ORQUESTADOR**. El trabajo de cada issue lo hace un **subagente fresco** (Agent, general-purpose), uno por issue.
1. **Elige el siguiente issue** del backlog (prioriza el que desbloquea a otros / ruta crítica). **Presenta la elección a Adrián y espera confirmación** antes de lanzar el subagente. Decisiones de dominio: pregúntale, no asumas.
2. **Crea rama** `issue-NN-slug` desde `main`. Reconfirma baseline `npm test`.
3. **Lanza el subagente** con prompt denso: repo+rama exacta (no merge/push a main), entorno (Windows/PowerShell, `git -C`), baseline, **TDD con un criterio por ciclo + commit por ciclo** (conventional commits **español ASCII**, stage POR NOMBRE nunca `git add .`, cerrar con `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`), leer issue+CONTEXT+ADRs+peltre-operam antes de tocar código, qué REUSAR y qué está FUERA de alcance, **válvula de seguridad** (parar y reportar si no converge o toca decisión de dominio), reporte final (estado de cada AC + `npm test` + commits + demo).
4. **Al volver, NO cierres el issue.** Verifica TÚ: (a) `npm test` (0 fallas); (b) code-review del diff `git diff main...issue-NN` (revisa lo eliminado/remapeado, que no se debilitaron tests); (c) cada AC contra el CÓDIGO REAL, no el reporte; (d) prueba read-only contra Operam cuando aplique. Aplica fixes acotados con TDD.
5. **Gate de cierre = visto bueno de Adrián** (demo en vivo o aprobar con evidencia; backend suele bastar evidencia). **Advierte si la demo escribe en Operam.**
6. **Tras su OK**: actualiza este archivo (mapa/estado), commit; `git checkout main`; `git merge --no-ff issue-NN`; `npm test` en main; `git push origin main` (deploy Render); `gh issue close NN` con resumen + commits; borra la rama local.

**Notas de entorno:** `.env` local NO tiene `DATABASE_URL` → dev/tests usan fallback `data/*.json`; producción usa Neon. `gh` y el MCP `operam-api` (lectura) disponibles. **Demos remotas:** túnel temporal `cloudflared tunnel --url http://localhost:3000` tras `npm start`; bájalo al terminar; URL pública protegida por PIN.

## Documentación de fundación (en main)
- **CONTEXT.md** — glosario del modelo nuevo (oportunidad, 7 etapas, pre-cotización, decorados, cola Hoy fusionada, sync post-venta). El glosario manda.
- **docs/adr/0005** — pipeline unificado de 7 etapas (supersede el modelo de etapas de ADR-0004; resto de 0004 vigente: CRM mínimo, no-sync Bitrix).
- **peltre-operam.md** (raíz `_Claude/`) §12 — API de Operam: tipos de transacción reales (el MCP los etiqueta MAL), cadena `order_`, webhooks. Consultar ANTES de explorar Operam.
- Vocabulario: `no_asignado, por_cotizar, seguimiento, anticipo_pagado, pedido_liberado, saldo_pagado, producto_entregado`; salidas `no_util, perdida`. Identidad de tarjeta = **oportunidad** (1 tarjeta post-venta = 1 pedido Operam).

## Backlog activo — prueba integral 2026-06-17
**3 hotfixes ya mergeados** (desbloqueaban la prueba): 404 de búsqueda de cliente tratado como error (503 en captura manual); Operam renombró `sales_type_id`→`sales_type` (lista de precios vacía); listas con id=código duplicado y sin "Precio de lista" (ahora todas las activas, id numérico + etiqueta).

Issues abiertos (atacar uno a uno; los de bug etiquetados `ready-for-agent`):
- **#68** Subir a Operam — crítico **MERGEADO parcial** (cliente correcto, ya no usa `clientes[0]`; 422 si no identifica). Falta AC3 nativo: **vigencia** (verificar campo real contra cotización 1156, label "Válido hasta", +30d) y **línea de envío como partida** (mapeo: `250911001` foráneo fuera CDMX · `251021001` FedEx Ground CDMX/metro paquetería · `220906001/2/3` Lalamove metro CDMX · `FLETELOCALCDMX` en desuso). Hoy van en `comments`.
- **#70** Documentos: PDF con diseño viejo (HTML ok) + etiqueta "Pre-cotización" cuando es PRE.
- **#71** Domicilio de entrega: obligatorios solo CP+país (leyenda si Calle vacía) + paqueterías en Sentence case.
- **#74** Alta en Operam: faltan dimensiones (D1=1, D2=5) y creación de domicilio según SOP (vendedor, área, almacén, grupo de impuestos exento si extranjero).
- **#67** Espejo de folios + binding por `trans_no_from` (verificado: pedido 7269 ← cotización 1141).
- **#72** Cotizar con Lalamove (envío local) — feature, definir mecanismo de tarifa.
- **#73** Reconocer clientes existentes de Operam: canal "Cliente Actual" + índice de celulares (parte 2 a discutir).

- **#75** Limpiar datos de prueba (prod/Neon, **destructivo, gate humano**): estrategia en 3 pasos — borrar lo obvio → consultar Operam (si existe = real, conservar) → lo dudoso, confirmar con Adrián. Dry-run primero + respaldo de lo borrado.

## Backlog prueba integral — CERRADOS (detalle en git + comentario de cierre del issue)
- **#69** estado compartido alta↔cotizador: `buildClienteDesdeAlta`→`seleccionarClienteOperam` prellena el cotizador al "Cotizar ahora" (telefono con codigo → Generar PDF no lo re-pide; `cl-cp-fiscal` usa CP fiscal real, no el de entrega); aviso de celular en el 1er form (`mensajeBusquedaCelular`, clasifica al `blur`) que **expone nombre+vendedor del prospecto** (decision de dominio 2026-06-17, excepcion en CONTEXT.md §Visibilidad). 4o sintoma (tarjeta no aparecia) resuelto por el prellenado del telefono (la compuerta server-side rechazaba la cotizacion sin telefono). Merge **0d1493a**.

## Mapa de issues del PRD #52 — CERRADOS (detalle en git + comentario de cierre del issue)
- **#53** tracer: bottom-nav + 7 etapas + migración de lectura + tablero único.
- **#54** botón `+` global (nueva cotización / nuevo prospecto que nace en Por Cotizar auto-asignado).
- **#55** cotizar → Seguimiento auto (regla `transicionPorCotizacion`).
- **#56** mover a Seguimiento manual exigiendo folio Operam (rechazo server-side sin folio; badge `#Operam N`).
- **#57** entrada No Asignado (alta admin-only) + asignar vendedor → Por Cotizar (`transicionPorAsignacion`).
- **#58** Hoy muestra la cola de prospectos en Por Cotizar.
- **#59** salidas No útil (motivo de catálogo, solo prospectos) y Perdida (confirmación) + filtro "Cerradas".
- **#60** cotizar como stepper guiado de 4 pasos; alta como excepción (`stepper-logica.js`).
- **#61** decorado: checklist de calca (6 pasos) + gate `puedeLiberar` a Pedido liberado (409 si incompleto) + Dropbox.
- **#62** sync Operam post-venta: webhook + reconciliación on-demand sobre `lib/sync-operam.js`/`sync-operam-io.js`.
- **#63** pre-cotización badge PRE / #Operam (folio nullable; corte histórico por fecha).
- **#64** Hoy suma cotizaciones (cola fusionada por urgencia relativa; eliminó la pantalla separada de seguimiento).
- **#65** reunión de diagnóstico sobre prospectos (Por Cotizar) y cotizaciones (Seguimiento).
- **#66** formalizar pre-cotización (botón Completar en Historial) + editar prospecto.

## Decisiones y lecciones que no perder (no están en otro lado)
- **Acciones de tarjeta del tablero** usan `o.refId ?? o.id` (los ids pueden venir prefijados, p.ej. `p7`/`c10`). Los tests puros del HTML NO cazan un id prefijado mal escrito → **verificar EN NAVEGADOR** (origen del bug de #57; chrome-devtools MCP + `npm start`).
- **Modelo A (#59, no reabrir):** **No útil** (motivo obligatorio de catálogo) solo para PROSPECTOS sin cotizar; una COTIZACIÓN sale del embudo solo por **Perdida** (con confirmación).
- **Migración de lectura:** `migrarCotizacion`/`migrarProspecto` (lib/migrar-pipeline.js) **respetan una etapa de pipeline ya persistida**; solo la derivan del estado si no hay. Por eso el sync post-venta puede persistir la etapa y no se pierde al releer.
- **Operam — el MCP `operam-api` etiqueta MAL los `filterType`.** Tipos reales y cadena `order_`: ver peltre-operam.md §12. Señal de pago = **`allocated` vs `total`** con tolerancia 1% (el `outstanding` del listado no es fiable). **El nº de cotización NUNCA es el nº de pedido**; el pedido recuerda su cotización en `trans_no_from`. Quirk: `PUT customers` puede ignorar `segmento_id` silenciosamente (verificar releyendo).
- **Sync #62 activo:** webhooks `Payment/Order/CustDelivery → /api/webhooks/operam` (header `X-Operam-Webhook-Secret`, secret en Render) + reconciliación on-demand `POST /api/sync-operam` (red de seguridad). Binding preciso solo vía `data.orderOperam`. Gate de #61 (`puedeLiberar`) respetado por el sync.
- **Auth del intake (#57):** la ruta de alta sin asignar es **admin-only**; no se expone escritura pública (el formulario web externo "Peltre de Mayoreo" y su token son trabajo posterior).
- **ASCII estricto** en código/commits (regla de encoding del CLAUDE.md): marca de completado "OK", sin acentos ni comillas tipográficas.
