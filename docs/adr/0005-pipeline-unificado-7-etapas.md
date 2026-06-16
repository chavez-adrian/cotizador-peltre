# ADR-0005: Pipeline unificado de 7 etapas (supersede el modelo de etapas de ADR-0004)

## Status

Accepted (2026-06-16)

## Context

El módulo de prospectos (ADR-0004) y el de cotizaciones crecieron como dos mundos separados:

- Prospectos con etapas `Nuevo → Contactado → Calificado → Cotizado` (más salida No útil), su propio tablero kanban y su cola de seguimiento en horas hábiles.
- Cotizaciones con un tablero de cadencia (Recién enviada / Día 2 / Día 7 / Por vencer / Vencida / Ganada / Perdida) y su cola en días naturales.

La app nació para el alta de cliente y creció por acreción: la navegación quedó en botones de header, los componentes nuevos escondidos. El vendedor reporta que no es intuitiva, no distingue una pre-cotización (emitida con datos mínimos, sin registro en Operam) de una cotización formal, no las ve juntas para seguimiento, el acceso no es prioritario, regresar a editar un prospecto es engorroso, el producto decorado (con calca) no vive en el sistema, y las etapas post-venta que Operam ya registra (anticipo, liberación, saldo, entrega) no aparecen en el embudo.

## Decision

Se unifica todo en un solo **pipeline de 7 etapas**: `No Asignado → Por Cotizar → Seguimiento → Anticipo pagado → Pedido liberado → Saldo pagado → Producto entregado`, con salidas No útil (motivo de catálogo) y Perdida (con confirmación). La unidad que avanza es la **oportunidad** (= prospecto antes de cotizar; = la cotización después; una segunda cotización del mismo prospecto genera una segunda tarjeta, manteniendo la invariante 1 tarjeta post-venta = 1 pedido en Operam).

Cambios estructurales:

- **Navegación bottom-nav** (Cotizar / Hoy / Pipeline / Más) más un botón `+` global, reemplazando header + tabs. La app abre en Cotizar.
- **Se eliminan las etapas Contactado y Calificado.** Un prospecto vive en Por Cotizar hasta que se cotiza. La transición a Cotizado del modelo previo se reemplaza por la transición a Seguimiento.
- **Reunión de diagnóstico se conserva** como actividad agendable (no etapa), en Por Cotizar y Seguimiento.
- **Cola Hoy fusionada**: una sola cola que mezcla prospectos en Por Cotizar (horas hábiles) y cotizaciones en Seguimiento (días naturales), ordenada por urgencia relativa.
- **Tablero único de pipeline** reemplaza los dos tableros separados.
- **Pre-cotización** como concepto canónico: cotización con Prospecto Mínimo, sin registro en Operam ni Cliente Genérico, modelada con folio de Operam nullable; distinción visible PRE / "#Operam N"; formalización "completar después" desde la tarjeta.
- **Checklist de decorados** (6 pasos de calca) en la tarjeta, con gate a Pedido liberado.
- **Sincronización post-venta con Operam**: las 4 etapas post-venta se mueven leyendo Operam (API v3 / webhooks). Dependencia técnica abierta: confirmar la cadena cotización → pedido → pagos; lo no expuesto arranca manual con sugerencia.

Documentado en el PRD #52 y descompuesto en los issues #53–#66.

## Consequences

- **Supersede el modelo de etapas de ADR-0004.** El resto de ADR-0004 sigue vigente: el CRM mínimo vive en el cotizador, no se sincroniza con Bitrix24, el celular es la llave prospecto↔cotización, y el guardrail "cliente Operam nunca regresa a prospecto" se resuelve con el índice local de teléfonos.
- **Obsoleta parte de #43–#45** (etapas manuales de prospección) y **unifica los tableros de #49–#50**. Se conservan re-encuadrados: la reunión de #45, la cadencia, el semáforo en horas hábiles, el índice de teléfonos y la auto-creación de prospecto al cotizar.
- **Introduce "oportunidad"** como unidad del pipeline; CONTEXT.md ya no afirma que no existe entidad de oportunidad.
- **Migración de datos**: etapas viejas → nuevas (`nuevo`/`contactado`/`calificado` → `por_cotizar`; `cotizado` → `seguimiento`; `no_util` se conserva); estados de cotización mapean a la etapa post-venta correspondiente. Idempotente, preserva el historial de eventos.
- **Dependencia técnica abierta**: el sync post-venta depende de lo que exponga la API/webhooks de Operam; es la única pieza del modelo sin cerrar (issue #62, HITL).
- **Costo**: el monolito (`server.js` + `app.js`) crece otra vez; se mitiga extrayendo módulos de dominio puro (`pipeline`, `cola-hoy`, `decorado-checklist`, núcleo de `operam-sync`) testeables en aislamiento.
