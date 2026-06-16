# PROGRESS — rediseño del cotizador (PRD #52: pipeline unificado de 7 etapas + bottom-nav)

Orquestación issue-por-issue: subagente fresco por issue, TDD por criterio de aceptación, orquestador verifica (suite + code-review + criterios contra código real) y Adrián hace la demo como gate de cierre.

## Documentación de fundación (en main)
- `CONTEXT.md` reescrito al modelo nuevo (oportunidad, 7 etapas, pre-cotización, decorados, cola Hoy fusionada, sync post-venta). El glosario manda.
- `docs/adr/0005-pipeline-unificado-7-etapas.md`: supersede el modelo de etapas de ADR-0004 (resto de 0004 vigente: CRM mínimo, no-sync Bitrix).
- Vocabulario canónico: `no_asignado, por_cotizar, seguimiento, anticipo_pagado, pedido_liberado, saldo_pagado, producto_entregado`; salidas `no_util, perdida`.
- Identidad de tarjeta = **oportunidad**: antes de cotizar = prospecto; al cotizar la tarjeta lleva esa cotización; 2ª cotización del mismo prospecto = 2ª tarjeta (invariante 1 tarjeta post-venta = 1 pedido Operam).

## Mapa de issues (#53–#66, todos hijos de #52)
- **#53 CERRADO** ✅ — tracer: bottom-nav + 7 etapas + migración + tablero único. Mergeado a main (deploy Render).
- #54 crear prospecto en Por Cotizar (+global) — bloqueado por #53 (ya desbloqueado)
- #55 cotizar → Seguimiento auto — desbloqueado
- #56 mover a Seguimiento manual con folio — desbloqueado
- #57 No Asignado + asignación — desbloqueado
- #58 Hoy: prospectos por contactar — desbloqueado (desbloquea #8/#9 = #64/#65)
- #59 salidas No útil/Perdida + filtro — desbloqueado
- #60 cotizar repensado (stepper) — desbloqueado
- #61 decorados (checklist + gate + Dropbox) — desbloqueado
- #62 sync Operam post-venta — **HITL**, desbloqueado (dependencia técnica abierta: validar cadena cotización→pedido→pagos)
- #63 pre-cotización badge PRE — bloqueado por #55
- #64 Hoy suma cotizaciones (fusión) — bloqueado por #58
- #65 reunión re-encuadrada — bloqueado por #58
- #66 formalizar pre-cotización + editar prospecto — bloqueado por #63

## #53 — cierre
Demo aprobada por Adrián (probó remoto vía túnel cloudflared, datos reales). Commits en main vía merge de `issue-53-tracer-embudo`:
- 6e2ebc2 doc fundación · d5f777b pipeline.js · fcd3d90 migrar-pipeline.js · 50a7ddc stores+dominio · 7fc762b bottom-nav+tablero · 8df3446 PROGRESS
- Fixes de code-review (hallazgos): 923e407 `oportunidadesActivas` (pura+test Q10) · 298c239 aplica hallazgos 1-3 en frontend.
  - H1 (corrección): vista Lista del pipeline excluye salidas como el tablero (antes las mostraba).
  - H2: una sola navegación — retirado el header viejo (Prospectos/Seguimiento/Historial) y sus listeners; badge de pendientes movido a Hoy.
  - H3: se marca el destino activo al entrar desde Más y al volver a Cotizar.
- **H4 (NO arreglado, por diseño): "Hoy" solo muestra cotizaciones; la cola de prospectos vive en Más→Prospectos. Es el contenido de #58 (#7) + #64 (#8). Decisión de Adrián: dejarlo para #58.**
- Suite 497/497.

### Decisiones de #53 que no perder
- Migración en la frontera de LECTURA del store (listar/obtener/buscarPorCelular en ambos backends), idempotente, no reescribe disco/Neon (mezcla física de vocabulario en Neon, normalizada en lectura — deuda aceptada).
- `migrarCotizacion` respeta una etapa de pipeline ya presente; solo deriva del estado si no hay (deja la puerta al sync post-venta de #62).
- Avance manual entre etapas de prospección ELIMINADO (ADR-0005). Única transición manual viva hoy: salida a No útil. `por_cotizar→seguimiento` la dispara el hook de cotización (auto, ya re-mapeado de #46) o folio Operam (será #56).
- `oportunidadesActivas` (public/js/pipeline-logica.js) = única fuente de "qué es activo" (filtra salidas); la usan tablero y lista.
- Tablero viejo de cotizaciones queda como pantalla legacy accesible desde Historial (no se eliminó su código; el destino Pipeline usa el tablero único).

## Siguiente
Issue por seleccionar/confirmar con Adrián. Candidatos fuertes: **#55** (ruta crítica hacia pre-cotización #63→#66, formaliza la transición central) o **#58** (Hoy, desbloquea #64/#65). #62 (sync Operam) de-riesga la dependencia abierta pero es HITL.
