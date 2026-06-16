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
- **#55 CERRADO** ✅ — cotizar → Seguimiento auto (regla de dominio `transicionPorCotizacion`). Mergeado a main.
- #56 mover a Seguimiento manual con folio — desbloqueado
- #57 No Asignado + asignación — desbloqueado
- #58 Hoy: prospectos por contactar — desbloqueado (desbloquea #8/#9 = #64/#65)
- #59 salidas No útil/Perdida + filtro — desbloqueado
- #60 cotizar repensado (stepper) — desbloqueado
- #61 decorados (checklist + gate + Dropbox) — desbloqueado
- #62 sync Operam post-venta — **HITL**, desbloqueado (dependencia técnica abierta: validar cadena cotización→pedido→pagos)
- **#63 CERRADO** ✅ — pre-cotización badge PRE / #Operam (históricas sin folio = registradas, corte por fecha). Mergeado a main.
- #64 Hoy suma cotizaciones (fusión) — bloqueado por #58
- #65 reunión re-encuadrada — bloqueado por #58
- #66 formalizar pre-cotización + editar prospecto — desbloqueado (tras #63)

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

## #55 — cotizar -> Seguimiento auto — CERRADO (aprobado por Adrián con evidencia de tests, sin demo manual; mergeado a main)
Núcleo: formalizó la regla de transición del pipeline (antes el hook movía a ciegas). Suite 503/503. Decisión de borde confirmada: cotizar revive desde No útil, NO desde Perdida, y No Asignado no salta sin vendedor.

### Estado de cada AC (verificado contra tests corridos)
- AC1 cotizar mueve a Seguimiento auto — VERDE (ya venía de #53/#46; ahora vía regla). Tests H1, H10 en `test/cotizar-embudo.test.js`.
- AC2 la transición la valida la regla de dominio (no salta etapas) — VERDE (núcleo nuevo de #55). `transicionPorCotizacion` en `lib/pipeline.js` + hook enrutado + H11.
- AC3 tarjeta queda en columna Seguimiento — YA-CUBIERTO-#53. H1 (`etapa==='seguimiento'`); el tablero lee la etapa del store (`oportunidadesActivas`), sin código nuevo.
- AC4 hook best-effort — YA-CUBIERTO-#53. H9 (prospectos.json corrupto -> cotización 200).
- AC5 regla auto + hook con pruebas (dominio + ruta) — VERDE. Dominio = `test/pipeline.test.js` (5 tests nuevos); ruta = `test/cotizar-embudo.test.js` (H1-H11).
- "Cotizar real, no enlace viejo" — YA-CUBIERTO-#53. `app.js:2492` `nav-cotizar` muestra `app-view` (Cotizador real).
- Disparador Operam — gancho preparado: la regla es agnóstica del disparador (Cotizador y Operam comparten `transicionPorCotizacion`); lectura real es #62, NO se construyó aquí.

### Diseño de la regla (lo que no perder)
- `transicionPorCotizacion(etapaActual) -> 'seguimiento' | null`. Orígenes válidos: `{por_cotizar, seguimiento, no_util}`. null en `no_asignado` (necesita vendedor primero), post-venta (las mueve Operam, no retroceden) y `perdida` (revivir es solo desde No util). Idempotente en `seguimiento`. Función pura, mismo disparador para Cotizador y Operam (#62).
- Hook (`pasarProspectoASeguimiento`, server.js): `const destino = transicionPorCotizacion(p.etapa); if (destino && destino !== p.etapa) cambiarEtapa(destino, ev); else registrarEvento(ev);`. Simplificó el hook (se eliminó el caso especial `=== 'seguimiento'`). Auto-creación de celular libre sigue naciendo en `seguimiento` (nacimiento, no transición; coherente con la regla — H5).

### Commits (rama)
- dfeb18c feat: regla de dominio transicionPorCotizacion en pipeline (#55) — `lib/pipeline.js`, `test/pipeline.test.js`
- 92b4d63 feat: el hook de cotizacion enruta por la regla de dominio del pipeline (#55) — `server.js`, `test/cotizar-embudo.test.js`

## #63 — pre-cotización badge PRE — CERRADO (aprobado por Adrián con evidencia; blocker de históricos resuelto; mergeado a main). Suite 525/525

### INVESTIGACIÓN (riesgo clave del prompt — hallazgo)
- **El folio de Operam NUNCA se persistió.** `subirCotizacionOperam` (frontend `app.js`) lo recibía en la respuesta y lo mostraba en un `alert`; la ruta `/api/cotizacion/operam/:id` devolvía `{ok,folio}` sin escribir nada. El schema de `cotizaciones` no tenía columna folio. → ARREGLADO: ahora la ruta persiste el folio vía `setFolioOperam`.
- **Las 55 cotizaciones históricas NO permiten distinguir PRE de registrada.** 0/55 tienen folio guardado; 0/55 tienen `customerId`/`operamId`; 39/55 tienen `data.cliente.rfc` (los otros 16 ni siquiera tienen `data`). La presencia de RFC NO prueba registro en Operam.
- El flujo actual YA permite cotizar sin alta (celular libre / Prospecto Mínimo, auto-creación de prospecto al cotizar #46): "generar pre-cotización" NO requirió flujo nuevo, solo el folio nullable + presentación. Confirmado por el test O3.

### BLOCKER RESUELTO (decisión de Adrián 2026-06-16: opción A)
Históricas sin folio = **registradas (no PRE)**. La migración de lectura (`migrar-pipeline.migrarCotizacion`) marca `registroDesconocido=true` a las cotizaciones anteriores al corte `PRE_COTIZACION_DESDE` (`2026-06-16T00:00:00Z`) sin folio; el dominio (`esPreCotizacion`/`etiquetaFolioOperam`) no las trata como PRE ni les pinta badge. Las nuevas sin folio sí son PRE. Corte por **fecha** (los ids no son contiguos: 1..10000, frágil). El badge se unificó en `badgeFolioOperamHtml` (tablero/cola/lista, evita el chip vacío del caso sin-badge). Commit ed4ea75. Documentado en CONTEXT.md "Pre-cotización" (Corte histórico).

### Estado de cada AC (verificado contra tests corridos)
- AC1 pre-cotización con Prospecto Mínimo sin alta — YA-CUBIERTO (#46) + verificado. Test O3 (`test/cotizar-embudo.test.js`).
- AC2 sin folio = PRE visible — VERDE. Dominio `esPreCotizacion`/`etiquetaFolioOperam` (`test/pipeline.test.js`); presentación Q12 (`pipeline-logica.test.cjs`).
- AC3 con folio = #Operam N — VERDE. Persistencia (store `setFolioOperam`) + ruta O1 (la subida guarda el folio) + presentación Q13.
- AC4 distinción visible en tarjeta, cola Hoy y tablero — VERDE. Tarjeta+tablero pipeline (Q12/Q13), cola Hoy (`seguimiento.test.js` folioOperam + app.js pinta el chip).
- AC5 pre-cotización mueve a Seguimiento conservando PRE — YA-CUBIERTO (#55) + verificado end-to-end. Test O3.
- AC6 pruebas dominio+ruta — VERDE. Dominio: `pipeline.test.js`. Ruta: `cotizar-embudo.test.js` (O1/O2/O3) + `cotizaciones-store.test.js`.

### Diseño (lo que no perder)
- Estado PRE modelado con **`folioOperam` nullable** en la cotización (null/'' = PRE; con valor = `#Operam N`). Folio persistido como **texto** (identificador, no número) — consistente Postgres (`folio_operam TEXT`, ADD COLUMN IF NOT EXISTS idempotente) y fallback JSON.
- Dominio puro: `esPreCotizacion(cot)` + `etiquetaFolioOperam(cot)` en `lib/pipeline.js`. Reexpresado browser-safe como `etiquetaFolioOperam(o)` en `pipeline-logica.js` (no importa de lib/, mismo criterio que el resto del vocabulario del frontend).
- Badge solo en oportunidades **tipo cotización** (un prospecto en por_cotizar aún no cotizó → sin badge). Chip ámbar `.badge-pre`, chip azul `.badge-operam` (tokens OKLCH existentes, estrategia Restrained conservada).
- NO toqué el tablero legacy de cotizaciones (`cotizaciones-logica.js`): es pantalla legacy de Historial (PROGRESS #53); el tablero canónico del rediseño es el del pipeline, ya cubierto.
- Formalización ("completar después") es #66: NO construida aquí (correcto por alcance).

### Commits (rama `issue-63-precotizacion-pre`)
- 6aab304 feat: estado PRE / folio Operam nullable en el dominio del pipeline — `lib/pipeline.js`, `test/pipeline.test.js`
- c1efd7f feat: el store persiste el folio de Operam — `lib/cotizaciones-store.js`, `test/cotizaciones-store.test.js`
- 4dbfc87 feat: subir a Operam persiste el folio — `server.js`, `lib/cotizaciones-store.js`, `test/cotizar-embudo.test.js`, `test/cotizaciones-store.test.js`
- 4a24e74 feat: badge PRE / #Operam en tarjeta, cola Hoy y tablero — `pipeline-logica.js`, `pipeline-logica.test.cjs`, `seguimiento.js`, `seguimiento.test.js`, `server.js`, `app.js`, `style.css`
- 7895f2a test: pre-cotización sin alta mueve a Seguimiento conservando PRE — `test/cotizar-embudo.test.js`

### DEMO (2 min) para Adrián
1. Cotizar con un celular nuevo (libre) + canal WhatsApp, generar HTML/PDF (NO subir a Operam).
2. Ir a Pipeline → la tarjeta aparece en **Seguimiento** con chip ámbar **PRE**. En Hoy (cuando aplique cadencia) y vista lista, mismo chip PRE.
3. Sobre esa cotización, "Subir a Operam" (con un cliente real con RFC en Operam). Recargar Pipeline → el chip cambia a **#Operam N** (folio real). La tarjeta sigue en Seguimiento.
4. (Datos históricos) Mirar el tablero: hoy las viejas salen **PRE** — punto de decisión del orquestador (ver BLOCKER).

## Siguiente
#53, #55 y #63 cerrados y en main (3 de 14). Candidatos: **#66** (formalizar pre-cotización + editar prospecto — desbloqueado por #63, completa el ciclo PRE→registrada; reusa `setFolioOperam` y el alta de cliente) · **#56** (mover a Seguimiento manual con folio — reusa `transicionPorCotizacion` y `setFolioOperam`) · **#58** (Hoy, desbloquea #64/#65 y cierra H4). #62 (sync Operam) de-riesga la dependencia abierta pero es HITL.
