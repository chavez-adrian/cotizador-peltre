# PROGRESS — rediseño del cotizador (PRD #52: pipeline unificado de 7 etapas + bottom-nav)

Orquestación issue-por-issue: subagente fresco por issue, TDD por criterio de aceptación, orquestador verifica (suite + code-review + criterios contra código real) y Adrián hace la demo como gate de cierre.

## CÓMO RETOMAR (protocolo de orquestación — leer esto primero)

Tu rol es **ORQUESTADOR**. El trabajo de cada issue lo hace un **subagente fresco** (Agent tool, general-purpose), uno POR ISSUE. El PRD padre es el issue **#52** en `chavez-adrian/cotizador-peltre`. Pasos:

1. **Elegir el siguiente issue** entre los disponibles (mapa abajo) — el de mayor prioridad (desbloquea a otros / ruta crítica / reduce riesgo), no necesariamente el menor. Respeta los "Blocked by". **Presenta la elección a Adrián y ESPERA SU CONFIRMACIÓN antes de lanzar el subagente** (usa AskUserQuestion con 2-3 candidatos). Decisiones de dominio/producto: pregúntale, no asumas.
2. **Antes de lanzar**, revisa si el issue contradice CONTEXT.md/un ADR. CONTEXT.md + ADR-0005 YA están alineados al modelo nuevo, así que normalmente no hay conflicto; si lo hubiera, resuélvelo con Adrián primero.
3. **Crear rama** `issue-NN-slug` desde `main` (`git checkout -b`). Si hay doc de fundación que tocar, commitearla ahí primero.
4. **Lanzar el subagente** con un prompt que incluya: repo y rama exacta (no merge/push a main), entorno (Windows/PowerShell, `git -C`), baseline actual de `npm test` (**559 pass / 0 fail en main tras #64** — reconfírmalo con `npm test` y actualiza este número al cerrar cada issue), usar `/tdd` con **ciclos por criterio de aceptación**, leer issue+PRD+CONTEXT.md+ADRs antes de tocar código, commits por ciclo (conventional commits español ASCII, stage POR NOMBRE nunca `git add .`, terminar mensaje con `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`), checkpoints en PROGRESS.md, válvula de seguridad (parar y reportar si no converge o si toca una decisión de dominio), y reporte final con estado de cada AC + `npm test` + commits + demo de 2 min. Dile qué REUSAR (no reinventar) y qué está fuera de alcance.
5. **Al volver el subagente, NO cierres el issue.** Verifica TÚ MISMO: (a) corre la suite completa (`npm test`, 0 fallas); (b) code-review del diff (`git diff main...issue-NN`), revisando lo eliminado/remapeado y que no se debilitaron tests; (c) verifica cada AC contra el CÓDIGO REAL, no el reporte; (d) prepara una demo de 2 min. Aplica tú los fixes de code-review si son acotados (con TDD).
6. **La demo de Adrián es el gate de cierre.** Pregúntale cómo cerrar (AskUserQuestion): demo en vivo o aprobar con evidencia. Para slices visuales ofrece demo; para backend, "aprobar con evidencia" suele bastar. **Advierte si la demo escribe en Operam** (formalizar/alta crean datos reales).
7. **Tras su visto bueno:** actualiza PROGRESS.md (mapa + estado del issue), commit; `git checkout main`; `git merge --no-ff issue-NN` con mensaje resumen; corre `npm test` en main; `git push origin main` (dispara deploy en Render); `gh issue close NN` con comentario-resumen + commits. Luego vuelve al paso 1 y ESPERA confirmación.

**Demos remotas (Adrián fuera de Tlapacoya):** la app corre en esta máquina; para que entre, monta un túnel temporal — descarga `cloudflared` (binario oficial) a `%TEMP%`, `npm start` en background, `cloudflared tunnel --url http://localhost:3000`, dale la URL `*.trycloudflare.com` (protegida por su PIN). Bájalo al terminar (mata `cloudflared` y el `node` del puerto 3000). Advierte que es URL pública temporal.

**Notas:** `.env` local NO tiene `DATABASE_URL` → dev/tests usan el fallback `data/*.json`; producción usa Neon. `gh` está disponible. Hay ramas de feature locales mergeadas sin borrar (limpieza opcional con `git branch -d`).

## Documentación de fundación (en main)
- `CONTEXT.md` reescrito al modelo nuevo (oportunidad, 7 etapas, pre-cotización, decorados, cola Hoy fusionada, sync post-venta). El glosario manda.
- `docs/adr/0005-pipeline-unificado-7-etapas.md`: supersede el modelo de etapas de ADR-0004 (resto de 0004 vigente: CRM mínimo, no-sync Bitrix).
- Vocabulario canónico: `no_asignado, por_cotizar, seguimiento, anticipo_pagado, pedido_liberado, saldo_pagado, producto_entregado`; salidas `no_util, perdida`.
- Identidad de tarjeta = **oportunidad**: antes de cotizar = prospecto; al cotizar la tarjeta lleva esa cotización; 2ª cotización del mismo prospecto = 2ª tarjeta (invariante 1 tarjeta post-venta = 1 pedido Operam).

## Mapa de issues (#53–#66, todos hijos de #52)
- **#53 CERRADO** ✅ — tracer: bottom-nav + 7 etapas + migración + tablero único. Mergeado a main (deploy Render).
- **#54 CERRADO** ✅ — botón `+` global (Nueva cotización / Nuevo prospecto) + crear prospecto a mano que nace en Por Cotizar auto-asignado. Mergeado a main (deploy Render). Suite 561/561.
- **#55 CERRADO** ✅ — cotizar → Seguimiento auto (regla de dominio `transicionPorCotizacion`). Mergeado a main.
- **#56 CERRADO** ✅ — mover a Seguimiento manual (botón en la tarjeta Por Cotizar) exigiendo folio Operam (rechazo server-side sin folio); el folio vive en `data.folioOperam` del prospecto, badge `#Operam N` (nunca PRE). Mergeado a main. Suite 593/593.
- **#57 CERRADO** ✅ — entrada No Asignado (`POST /api/prospectos/sin-asignar` admin-only) + asignar vendedor (`PATCH .../asignar`) que mueve a Por Cotizar vía regla de dominio `transicionPorAsignacion`. Primera acción de tarjeta del tablero (asignar, solo admin). Mergeado a main. **Bug del botón de asignar (usaba id prefijado `p7`, roto en navegador) corregido en la rama de #56 — regresión Q38/Q39.**
- **#58 CERRADO** ✅ — Hoy muestra la cola de prospectos en Por Cotizar (cierra el H4 de #53). Cola de cotizaciones reubicada en Más → "Seguimiento cotizaciones" hasta la fusión #64. Mergeado a main.
- **#59 CERRADO** ✅ — salidas No útil (motivo de catálogo, solo prospectos — Modelo A) y Perdida (confirmación; cotización vía ruta de estado, prospecto vía ruta de etapa) + filtro "Cerradas" en el Pipeline. Cancelar sin motivo no toca el servidor. Mergeado a main. Suite 604/604.
- **#60 CERRADO** ✅ — cotizar como stepper guiado de 4 pasos (Cliente→Productos→Envío→Cotización) con avance visible ("Paso N de 4" + barra + marca de completado); alta de cliente como excepción (no punto de partida), guardrails/dedup intactos. Lógica pura `stepper-logica.js` (16 tests). Mergeado a main. Suite 620/620.
- #61 decorados (checklist + gate + Dropbox) — desbloqueado
- #62 sync Operam post-venta — **HITL**, desbloqueado (dependencia técnica abierta: validar cadena cotización→pedido→pagos)
- **#63 CERRADO** ✅ — pre-cotización badge PRE / #Operam (históricas sin folio = registradas, corte por fecha). Mergeado a main.
- **#64 CERRADO** ✅ — Hoy suma cotizaciones (cola fusionada prospectos+cotizaciones por urgencia relativa). Eliminó la pantalla separada de seguimiento. Mergeado a main.
- #65 reunión re-encuadrada — desbloqueado (tras #58)
- **#66 CERRADO** ✅ — formalizar pre-cotización (botón Completar en Historial) + editar prospecto. Mergeado a main.

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

## #59 — salidas No util / Perdida + filtro/historial — CERRADO (aprobado por Adrian con evidencia; verificado por el orquestador; mergeado a main). Suite 604/604. Modelo A: No util solo prospectos, cotizacion solo Perdida. La leccion del bug de #57 fue aplicada por el subagente (refId + regresion Q43 con forma prefijada).

Modelo A (decision de Adrian, NO reabrir): **No util** (motivo obligatorio de catalogo) aplica SOLO a PROSPECTOS sin cotizar; una COTIZACION sale del embudo SOLO por **Perdida** (con confirmacion), no por No util. Reusa rutas existentes.

### Baseline: 593 pass / 0 fail (reconfirmado al empezar).

### Decisiones tomadas (antes de codear)
- Dominio: `validarTransicion(actual, nueva, motivo, folio)` ya valida `no_util`. Se EXTIENDE para permitir `perdida` desde cualquier etapa ACTIVA (no desde una salida); Perdida NO lleva motivo (la confirmacion es del frontend). NO se toca el caso `no_util` ni el `por_cotizar->seguimiento` con folio (#56).
- Ruta de PROSPECTO: `PATCH /api/prospectos/:id/etapa` ya maneja `no_util` (motivo); se agrega rama `perdida` (registra evento `{tipo:'etapa', de, a:'perdida'}` via cambiarEtapa, sin motivo).
- Ruta de COTIZACION (solo Perdida): `PATCH /api/cotizacion/:id/estado` con `{estado:'perdida'}` YA EXISTE; el frontend ya tiene `cambiarEstadoCotizacion`/`cerrarCotizacionTablero`. Una cotizacion perdida ya mapea a etapa `perdida` (migrar-pipeline) y sale del tablero (oportunidadesActivas). NO se crea ruta nueva ni se agrega no_util a esa ruta.
- Acciones de tarjeta del tablero: para PROSPECTO activo -> No util (select de motivo) + Perdida (confirm); para COTIZACION activa -> Perdida (confirm). Logica pura en pipeline-logica.js (usa `o.refId ?? o.id`, leccion #57), cableado DOM en app.js.
- Filtro/historial (AC3): tercer modo del Pipeline "Cerradas" que lista las oportunidades en salida (esSalida) con su tipo y, para No util, el motivo.
- Cancelar (AC4): si el usuario cancela el select de motivo, no se llama al servidor (la tarjeta queda donde esta). Sin rollback.

### Plan de ciclos (TDD, 1 AC por ciclo)
- C1 (AC1+AC2 dominio): validarTransicion permite perdida desde activa, rechaza desde salida. Test en prospectos-logica.test.cjs.
- C2 (AC1+AC2 ruta prospecto): PATCH .../etapa maneja perdida (sin motivo). Test en prospectos-api.test.js. No util ya probado.
- C3 (AC1+AC2 frontend): controles de salida en la tarjeta (pura). Tests en pipeline-logica.test.cjs (incl. forma prefijada p7/c10).
- C4 (AC4 + cableado): app.js (cancelar = sin servidor).
- C5 (AC3 filtro/historial): modo Cerradas (lista salidas con tipo + motivo). Test pura en pipeline-logica.test.cjs.

### CERRADO por el subagente (pendiente verificacion del orquestador + demo de Adrian). Suite 604/604 (593 baseline + 11 nuevos). VERIFICADO EN NAVEGADOR (leccion #57).

### Estado de cada AC
- AC1 (No util exige motivo de catalogo, server-side, solo prospectos): VERDE. Dominio validarTransicion (ya validaba no_util, T5/T6). Ruta PATCH .../etapa (ya probada). Tablero: control con select de motivo solo en prospecto (Q40), nunca en cotizacion (Q41, Modelo A). Navegador: Laura -> no_util motivo "fuera de zona" persistido server-side.
- AC2 (Perdida pide confirmacion): VERDE. Dominio validarTransicion permite perdida desde activa (T6b), rechaza desde salida (T6c). Ruta prospecto (perdida sin motivo) + ruta cotizacion (estado, ya existia). Confirm() en cerrarPerdidaTablero (app.js). Navegador: Pedro (prospecto) y cot 55 (cotizacion) cerrados con confirmacion.
- AC3 (cerradas salen del tablero y viven en filtro/historial): VERDE. Tablero/lista ya excluyen salidas (oportunidadesActivas, #53). Tercer modo "Cerradas" lista las salidas con tipo + motivo (buildCerradasHtml, Q45/Q46). Navegador: Cerradas muestra Laura/No util/fuera de zona, Pedro/Perdida, cot55/Perdida; el activo ya no las pinta.
- AC4 (cancelar No util regresa la tarjeta sin tocar el servidor): VERDE. Sin select de motivo no se llama al servidor (marcarNoUtilTablero corta). Navegador: click No util sin motivo -> Laura sigue en por_cotizar en disco (sin eventos nuevos).
- AC5 (reglas con pruebas dominio + ruta): VERDE. Dominio: T6b/T6c (perdida). Ruta: 2 tests perdida prospecto en prospectos-api.test.js; no_util ya probado; cotizacion perdida via estado (seguimiento-api.test.js existente). Frontend pura: Q40-Q46.

### Diseno (lo que no perder)
- Dominio: `validarTransicion` extendido con rama `perdida` (permitida desde ETAPAS_ACTIVAS, derivadas de ETAPA_LABELS menos no_util/perdida; rechazada desde salida). NO se toco no_util ni por_cotizar->seguimiento (#56). Perdida sin motivo (la confirmacion es del frontend).
- Ruta prospecto: PATCH .../etapa YA era generica (`no_util ? evento no_util : evento etapa`); perdida cae en la rama generica una vez que el dominio la permite. No requirio cambio de ruta (solo tests que lo fijan).
- Ruta cotizacion: REUSADA `PATCH /api/cotizacion/:id/estado {estado:'perdida'}` (Modelo A). Una cotizacion perdida deriva etapa 'perdida' en la lectura (migrar-pipeline) y sale del tablero. NO se creo ruta ni se agrego no_util a estado.
- Frontend pura (pipeline-logica.js): `buildSalidaControlHtml(o)` -- prospecto activo: select motivo + No util + Perdida; cotizacion activa: solo Perdida; salida: ''. Usa `o.refId ?? o.id` (leccion #57, Q43). `buildCerradasHtml(oportunidades)` filtra esSalida, ordena reciente primero, muestra tipo de cierre + motivo (o.motivoNoUtil).
- Cableado (app.js): `marcarNoUtilTablero` (sin motivo = aviso, sin servidor = AC4), `cerrarPerdidaTablero` (confirm; resuelve tipo por id en ultimasOportunidades para elegir la ruta). `prospectoAOportunidad` ahora deriva `motivoNoUtil` del ultimo evento no_util. Tercer modo "Cerradas" en renderPipeline + boton en index.html + listener + PIPELINE_MODOS.

### Commits (rama issue-59-salidas)
- ddf0de7 feat: validarTransicion permite salida a Perdida desde etapa activa (#59)
- 3778803 test: PATCH etapa a Perdida cierra el prospecto y rechaza desde una salida (#59)
- 273007a feat: controles de salida No util/Perdida en la tarjeta del tablero (logica pura) (#59)
- 9fcc286 feat: cableado de salidas No util/Perdida en el tablero; cancelar no toca el servidor (#59)
- 7b039bc feat: filtro Cerradas en el Pipeline lista las salidas No util/Perdida con motivo (#59)

### DEMO (2 min) para Adrian
1. Login admin (Adrian Chavez, PIN 0000). Ir a Pipeline (bottom-nav), Tablero.
2. En Por Cotizar, cada prospecto trae: "A Seguimiento (folio Operam)" (#56), select "Motivo No util...", boton "No util", boton "Perdida". Una cotizacion en Seguimiento solo trae "Perdida" (Modelo A: no No util para cotizaciones).
3. Sacar a No util: elegir un motivo y tocar "No util" -> la tarjeta sale del tablero (queda en el historial con su motivo).
4. Cancelar: tocar "No util" SIN elegir motivo -> aviso "Elige el motivo..."; la tarjeta NO se mueve (no se toca el servidor).
5. Cerrar como Perdida: tocar "Perdida" en un prospecto o cotizacion -> confirmacion; al aceptar sale del tablero.
6. Ver el filtro: tocar "Cerradas" -> lista las salidas con su tipo (No util / Perdida) y, para No util, el motivo.

### Deuda / pendientes
- El frontend (controles de tarjeta + modo Cerradas) no tiene test de DOM (patron del repo: sin DOM en tests); la logica pura si (Q40-Q46) y el cableado se verifico EN NAVEGADOR (Laura/Pedro/cot55 + cancelar). 
- data/prospectos.json y data/cotizaciones.json (gitignored) quedaron con el estado del demo en vivo (Laura/Pedro/cot55 cerrados) -- son fixtures locales, no se commitean.

## #65 — reunion re-encuadrada (rama issue-65-reunion) — EN PROGRESO

Slice MEDIANO: la reunion sobre PROSPECTOS (Por Cotizar) ya existe (#45); FALTA la maquinaria simetrica sobre COTIZACIONES (Seguimiento). Baseline reconfirmado: 620 pass / 0 fail.

### Plan de ciclos (TDD, 1 AC por ciclo)
- C1 (AC5 nucleo): generalizar predicados a `ultimaReunionDe(eventos)`, `reunionFuturaDe(eventos, ahora)`, `reunionPendienteResultadoDe(eventos, ahora)` sobre ARRAY; reexpresar `reunionFutura(p)`/`reunionPendienteResultado(p)` como wrappers (NO romper #45/RU6). Tests en prospectos-logica.test.cjs.
- C2 (AC2/AC3 cadencia cotizacion): `calcularCola` (lib/seguimiento.js) lee reuniones de `c.seguimientos` (entradas `{tipo:'reunion'}`): si futura -> continue (suprime); si pendiente -> emite item con `reunionVencida:true`+`fechaReunion` AUNQUE el paso de cadencia ya este hecho. Tests en seguimiento.test.js.
- C3 (AC3 orden): `cola-hoy.js` ya ordena reunionVencida primero (condicion generica); confirmar con test que aplica a cotizaciones. Tests en cola-hoy.test.js.
- C4 (AC1/AC4 rutas): POST /api/cotizacion/:id/reunion (agendar) + POST /api/cotizacion/:id/reunion-resultado (avance/Hecho o Perdida, NO No util — Modelo A). Reusa registrarSeguimiento + setEstado. Tests en seguimiento-api.test.js.
- C5 (AC1/AC4 frontend): card de cotizacion de cola Hoy (buildColaCotizacionItemHtml) gana agendar reunion + (si reunionVencida) registrar resultado (Hecho/Perdida). Usa refId. Tests en pipeline-logica.test.cjs.

### Decisiones de diseno (lo que no perder)
- Los eventos de reunion de la cotizacion viven en el array `seguimientos` existente (entrada `{tipo:'reunion', fecha_reunion, fecha, vendedor}`). `calcularCola` hace `(c.seguimientos||[]).map(s=>s.paso)`: una entrada de reunion (sin paso) es ignorada por ese map, NO rompe la cadencia. Evita migracion de schema.
- El nucleo lee `e.fecha` de cada entrada del array para "evento posterior limpia el pendiente": tanto reuniones como pasos de cadencia tienen `fecha`, asi que registrar el avance (marcar paso/Hecho) limpia el pendiente de reunion. Coherente con el Modelo A.
- Resultado de reunion sobre COTIZACION: avance (registrar seguimiento/Hecho) o Perdida. NO No util (Modelo A #59: la cotizacion sale solo por Perdida).

### Estado: CERRADO por el subagente (pendiente verificacion del orquestador + demo de Adrian). Suite 640/640 (620 baseline + 20 nuevos). C1-C5 VERDE.

### Estado de cada AC
- AC1 (agendar reunion en Por Cotizar y Seguimiento): VERDE. Prospecto YA-CUBIERTO (#45, RU2). Cotizacion NUEVO: ruta POST /api/cotizacion/:id/reunion (CR1) + card de cola Hoy con input datetime + agendarReunionCotizacion (Q25).
- AC2 (reunion futura suprime la cadencia): VERDE. Prospecto YA-CUBIERTO (#45, R1). Cotizacion NUEVO: calcularCola hace continue si reunionFuturaDe (REU1, CR1 end-to-end).
- AC3 (al vencer reaparece en Hoy pidiendo resultado): VERDE. Cotizacion NUEVO: calcularCola emite reunionVencida+fechaReunion aunque el paso de cadencia ya este hecho (REU2/REU3); cola-hoy la ordena arriba para ambos tipos (H8).
- AC4 (resultado sin etapas eliminadas): VERDE. Cotizacion: avance (registra evento que reanuda cadencia) o Perdida; no_util RECHAZADO (Modelo A #59) -> CR4/CR5/CR6. Frontend Q26 (Hecho/Perdida, sin No util).
- AC5 (predicados + supresion con pruebas para ambos tipos): VERDE. Nucleo: RU7/RU8 (array). Prospecto: R1-R4. Cotizacion: REU1-REU5 (cadencia) + CR1-CR8 (rutas) + Q25-Q28 (frontend) + H8 (orden).

### Diseno (lo que no perder)
- Nucleo generalizado en prospectos-logica.js: ultimaReunionDe/reunionFuturaDe/reunionPendienteResultadoDe operan sobre el ARRAY de eventos. reunionFutura(p)/reunionPendienteResultado(p) quedan como wrappers (pasan p.eventos). Cambio sutil: ultimaReunion ahora ordena por fecha_reunion (no fecha de registro) -- mas correcto, no rompe RU4/R4.
- Las reuniones de la COTIZACION viven en el array `seguimientos` (entrada {tipo:'reunion', fecha_reunion, fecha, vendedor}). calcularCola hace map(s=>s.paso): una entrada de reunion (sin paso) NO interfiere con la cadencia. Sin migracion de schema.
- calcularCola: si reunionFuturaDe -> continue; si reunionPendienteResultadoDe -> emite item con reunionVencida+fechaReunion AUNQUE el paso de cadencia este hecho (paso puede ser null si reaparece solo por reunion -> mensaje fallback 'dia2', card no pinta "Hecho").
- Resultado de reunion de cotizacion (Modelo A): 'avance' registra {tipo:'reunion_resultado', fecha} (evento posterior limpia el pendiente y reanuda la cadencia); 'perdida' -> setEstado('perdida'). NO No util. Reusa registrarSeguimiento + setEstado, sin schema nuevo.
- Rutas (server.js): POST /api/cotizacion/:id/reunion + /reunion-resultado, auth dueno-o-admin (helper cotizacionOperable, espeja /api/seguimiento/:id). Importa reunionPendienteResultadoDe.
- Frontend: buildColaCotizacionItemHtml (pipeline-logica.js) con agendar + (si reunionVencida) Hecho/Perdida. Cableado agendarReunionCotizacion/resultadoReunionCotizacion en app.js (espeja agendarReunionProspecto, llaman showHoy al terminar).

### Commits (rama issue-65-reunion)
- e4f2e15 feat: generaliza los predicados de reunion sobre un array de eventos (#65)
- fc8b2a2 feat: la cadencia de cotizacion respeta la reunion de diagnostico (#65)
- b66f68b test: la reunion de cotizacion vencida encabeza la cola Hoy (#65)
- 7f7c426 feat: rutas de reunion de diagnostico sobre una cotizacion (#65)
- 549790b feat: agendar y resolver la reunion de una cotizacion en la cola Hoy (#65)

### Deuda / pendientes
- El frontend (card de cotizacion + cableado) no tiene test de DOM (patron del repo: sin DOM). La logica pura si (Q25-Q28) y el cableado espeja el patron ya probado de agendarReunionProspecto. Verificacion en navegador queda como deuda de proceso (igual que #59/#60); el orquestador puede capturar via chrome-devtools + npm start. NO se verifico en navegador para no crear datos de prueba en disco.
- DEMO (2 min): 1) Login, ir a Hoy. 2) En una cotizacion en Seguimiento: "Agendar reunion" con fecha futura -> la cotizacion sale de Hoy. 3) (Vencer la fecha o usar fixture con reunion pasada) -> reaparece arriba con "Reunion del ... — registrar resultado" + botones Hecho/Perdida. 4) "Hecho" (avance) -> reanuda la cadencia; o "Perdida" -> cierra la cotizacion. 5) Confirmar que el prospecto sigue: en Por Cotizar agendar reunion futura -> sale de Hoy; vencida -> reaparece con No util (flujo #45 intacto).

## Siguiente
#53, #54, #55, #56, #57, #58, #59, #60, #63, #64 y #66 cerrados y en main (11 de 14). Ciclo de vida del embudo COMPLETO + flujo de cotizar reencuadrado como stepper (#60). El tablero tiene 3 acciones de tarjeta (asignar #57, mover a Seguimiento #56, salidas #59), todas con el patrón de cableado endurecido (refId + tests de forma prefijada). **Deuda de proceso: las acciones de tarjeta del tablero / cambios visuales idealmente se verifican en navegador, no solo por tests puros (origen del bug de #57); ahora el orquestador puede capturar via chrome-devtools MCP + npm start local.** Faltan 3: **#65** (reunión re-encuadrada; desbloqueado por #58, el más acotado) · **#61** (decorados — checklist + gate a Pedido liberado + Dropbox) · **#62** (sync Operam post-venta — de-riesga la dependencia abierta pero es HITL, lee/escribe Operam real, requiere sesión con Adrián).

## #60 — cotizar repensado (stepper guiado + alta como excepcion) — CERRADO (aprobado por Adrian con CAPTURAS en vivo; verificado por el orquestador; mergeado a main). Suite 620/620 (604 baseline + 16 nuevos)

### Verificacion en navegador del orquestador (capturas enviadas a Adrian)
Levante el server local y recorri el stepper: Paso 1 Cliente -> al llenar Razon Social la pestana Cliente queda marcada "OK" -> Paso 2 Productos con barra al 50% -> Paso 4 Cotizacion al 100% SIN abrir el alta (AC2 confirmado en vivo: se llega a Cotizacion sin alta) -> "+ Nuevo cliente" abre el acordeon de alta intacto (AC3). El indicador "Paso N de 4" + barra de avance + marca de completado (AC1) se ven correctos. Capturas en .temporales/stepper-*.png.

Reframe de la barra de tabs del flujo de cotizar como STEPPER GUIADO con avance visible. NO reescribe el buscador de productos, el envio, el PDF/HTML ni el alta: solo la capa de navegacion/progreso + un modulo puro nuevo. El alta sigue siendo la excepcion ("+ Nuevo cliente" -> abrirAcordeonAlta), intacta (ADR-0002/0003).

### Decision de producto (NO bloquea, solo guia)
El stepper GUIA y MUESTRA progreso pero NO bloquea la navegacion: se llega a Cotizacion sin pasar por el alta (AC2) y el clic libre se preserva. estadoStepper NO expone ninguna nocion de "bloqueado" (test S16). Esto es lo que el prompt fijo por defecto; no se asumio restriccion fuerte.

### Estado de cada AC (verificado contra tests + navegador)
- AC1 (stepper de 4 pasos con avance visible): VERDE. Riel con numero por paso (1..4) + marca de completado + barra "Paso N de 4" + fill %. Verificado en navegador: Cliente->Productos->Envio->Cotizacion mostro Paso 1/2/3/4 y fill 25/50/75/100%, con checks verdes acumulandose. Captura .temporales/stepper-envio.png.
- AC2 (cotizacion sin alta completa): VERDE. Recorrido end-to-end hasta resumen (Cotizacion) con panel-alta-cliente SIEMPRE en display:none (altaNuncaAbierta=true). El stepper no obliga al alta.
- AC3 (alta disponible como excepcion, guardrails+dedup intactos): VERDE. "+ Nuevo cliente" abre el acordeon (none->block) con tabs CSF/manual intactos; NO se toco el interior. Ruta dedup reachable+autenticada (GET /api/buscar-cliente-duplicado dio 503 por falta de Operam en local, NO 401 -> auth ok; logica cubierta por E1-E4 del baseline). Cero cambios en abrirAcordeonAlta, CSF, captura manual, /api/crear-cliente, /api/buscar-cliente-duplicado.
- AC4 (logica pura de avance/estado con pruebas): VERDE. `public/js/stepper-logica.js` (modulo ES browser-safe) + `public/js/__tests__/stepper-logica.test.cjs` (S1-S16). updateTabIndicators delega en estadoStepper (ya no calcula inline).

### Diseno (lo que no perder)
- Modulo puro `stepper-logica.js`: `PASOS_STEPPER=['cliente','productos','envio','resumen']`, `PASO_LABELS` (4o = 'Cotizacion'), `indicePaso`, `esPasoValido`, `siguientePaso`/`pasoAnterior` (clamp en extremos), `pasoCompleto(paso,estado)` (estado plano `{clienteListo,productosListos,envioListo}`, mismos criterios que el viejo updateTabIndicators; resumen no tiene criterio), `pasosCompletos`, `progresoStepper` ({actual 1-based,total,fraccion}), `textoProgreso` ("Paso N de M"), `estadoStepper(pasoActual,estado)` (riel: por paso numero/label/esActual/completo, SIN "bloqueado").
- app.js: importa estadoStepper/textoProgreso. `pasoActualStepper()` lee el `.tab.active`; `estadoFlujoCotizar()` arma el estado plano (mismos getters de DOM de siempre). `updateTabIndicators` pinta clase `completo` (solo si completo y NO actual), dots por paso, texto y fill. `switchTab` ahora llama updateTabIndicators al final (el indicador sigue al paso actual).
- index.html: nav.tabs gana clase `stepper`, cada tab un `<span class="step-num">N</span>`; debajo `#stepper-progress` (texto + riel + fill). style.css: `.step-num` (gris/azul-actual/verde-completo con "OK" ASCII via ::before), `.stepper-progress*` (sticky bajo el riel, fill primary con transition).
- ASCII estricto: la marca de completado es "OK" (no checkmark Unicode) por la regla de encoding del CLAUDE.md.

### Commits (rama issue-60-stepper)
- c2256ea feat: logica pura del stepper del flujo de cotizar (#60) -- stepper-logica.js + stepper-logica.test.cjs
- d2943f9 feat: stepper guiado con avance visible en el flujo de cotizar (#60) -- index.html, style.css, app.js

### Archivos tocados
- Nuevos: public/js/stepper-logica.js, public/js/__tests__/stepper-logica.test.cjs
- Modificados: public/index.html (nav + barra de progreso), public/css/style.css (estilos stepper), public/js/app.js (import + updateTabIndicators delega + switchTab refresca)

### DEMO (2 min) para Adrian
1. Login (cualquier vendedor). Abre en Cotizar; arriba el stepper: "1 Cliente / 2 Productos / 3 Envio / 4 Cotizacion" + barra "Paso 1 de 4".
2. En Cliente (por defecto "Buscar en Operam", NO el alta): escribir Razon Social -> Cliente se marca completo (check verde). Tocar "Siguiente": pasa a Productos, barra "Paso 2 de 4" (50%).
3. Agregar un producto -> Productos completo. Siguiente -> Envio "Paso 3 de 4" (75%); elegir opcion de envio -> Envio completo. Siguiente -> Cotizacion "Paso 4 de 4" (100%). Se LLEGO a la cotizacion sin abrir el alta (AC2).
4. Los tabs siguen siendo clickeables en cualquier orden (no bloquea). 
5. Alta como excepcion (AC3): tocar "+ Nuevo cliente" -> abre el acordeon (CSF / captura manual) con dedup. NO cambio nada del alta; solo como se llega.

### Deuda / pendientes
- El indicador (riel + barra) no tiene test de DOM (patron del repo: sin DOM en tests); la logica pura si (S1-S16) y el cableado se verifico EN NAVEGADOR (recorrido completo + alta como excepcion). Deuda de proceso del repo (acciones de UI idealmente en navegador) atendida aqui.
- AC3 dedup: en local da 503 (Operam no configurado); el comportamiento real de dedup esta cubierto por E1-E4 del baseline. La demo de Adrian NO escribe en Operam salvo que de de alta un cliente real desde el acordeon.

## #57 — No Asignado + asignación de vendedor — EN PROGRESO (rama issue-57-no-asignado)

Slice: oportunidades que llegan sin dueño caen en No Asignado; un admin les asigna vendedor y la tarjeta pasa automáticamente a Por Cotizar (regla de dominio, espeja #55).

### Decisiones tomadas (antes de codear)
- **Regla de dominio (espeja transicionPorCotizacion #55)**: `transicionPorAsignacion(etapaActual)` en `lib/pipeline.js` → `'por_cotizar'` SOLO si `etapaActual==='no_asignado'`, else `null`. Función pura.
- **Auth de la ruta de intake (decisión de seguridad de Adrián, ver prompt)**: NO se expone escritura pública. La ruta de alta sin asignar es **autenticada admin-only** (`POST /api/prospectos/sin-asignar`, adminMiddleware). El wiring del formulario web externo "Peltre de Mayoreo" y su token público es POSTERIOR y fuera de alcance. Reusa los guardrails de `clasificarCelular` (no duplica prospecto/cliente Operam).
- **Asignación**: ruta `PATCH /api/prospectos/:id/asignar` admin-only (solo quien asigna ve No Asignado, CONTEXT.md Visibilidad). El store `asignarVendedor(id, vendedor, evento)` fija el vendedor; la transición de etapa la decide la regla de dominio en la RUTA (`transicionPorAsignacion` + `cambiarEtapa`), igual que el hook de #55 (la regla decide, la IO aplica).
- **Visibilidad ya resuelta**: tarjetas No Asignado tienen `vendedor` null → no-admin no las ve (filtro existente `p.vendedor === req.user.name`), admin sí. Se agrega test que lo afirma; NO se cambia el filtro.
- **Control de asignar en la tarjeta (primera acción de tarjeta del tablero)**: UI mínima admin-only (select de vendedores de `/api/catalogos` + asignar) sobre la tarjeta No Asignado. Lógica pura en pipeline-logica.js, cableado DOM en app.js.

### Plan de ciclos (TDD)
- C1 (AC4 dominio): `transicionPorAsignacion` + test en `test/pipeline.test.js`.
- C2 (store): `asignarVendedor` + test en `test/prospectos-store.test.js`.
- C3 (AC1 ruta): `POST /api/prospectos/sin-asignar` admin → no_asignado sin vendedor + test en `test/prospectos-api.test.js`.
- C4 (AC3/AC4 ruta): `PATCH /api/prospectos/:id/asignar` admin → por_cotizar + test.
- C5 (AC2 + visibilidad): test no-admin no ve No Asignado, admin sí + lógica pura del control de asignar (pipeline-logica.test.cjs).

### Estado: CERRADO por el subagente (pendiente verificacion del orquestador + demo de Adrian). Suite 581/581 (561 baseline + 20 nuevos).

### Estado de cada AC (verificado contra tests corridos)
- AC1 (ruta de alta sin vendedor -> No Asignado): VERDE. `POST /api/prospectos/sin-asignar` admin-only crea en `no_asignado` sin vendedor, reusa guardrails. Tests en `prospectos-api.test.js` (5: alta, auth admin, validacion, dedup prospecto, guardrail cliente Operam).
- AC2 (columna No Asignado lista las tarjetas sin dueno): YA-CUBIERTO (#53: `agruparPipeline`/`buildTableroPipelineHtml` ya pintan la columna; Q3 reparte `no_asignado`). Verificado + test de visibilidad nuevo ("No Asignado solo lo ve quien asigna") afirma que admin ve la tarjeta sin dueno y el no-admin no.
- AC3 (asignar vendedor mueve a Por Cotizar auto): VERDE. `PATCH /api/prospectos/:id/asignar` -> `por_cotizar`. Test "mueve la tarjeta a Por Cotizar con el vendedor elegido".
- AC4 (la transicion la valida la regla de dominio): VERDE. `transicionPorAsignacion` en `lib/pipeline.js` (espeja #55) + la ruta enruta por ella (regla decide, store aplica). Tests dominio en `pipeline.test.js` (3) + ruta "solo aplica desde No Asignado".
- AC5 (alta sin asignar + asignacion con pruebas dominio + ruta): VERDE. Dominio: `pipeline.test.js` (transicionPorAsignacion) + `prospectos-store.test.js` (asignarVendedor). Ruta: `prospectos-api.test.js` (sin-asignar + asignar). Frontend: `pipeline-logica.test.cjs` Q27-Q31.
- Visibilidad (CONTEXT.md): YA-CUBIERTA por el filtro existente (`p.vendedor === req.user.name`; null no matchea ningun nombre). NO se cambio el filtro; se agrego test que lo afirma.

### Diseno (lo que no perder)
- **Regla de dominio** `transicionPorAsignacion(etapaActual)` -> `'por_cotizar'` SOLO si `no_asignado`, else null. Pura, simetrica de `transicionPorCotizacion`.
- **Store** `asignarVendedor(id, vendedor, etapa, evento)`: fija vendedor + etapa (que decide la regla en la RUTA) + appendea evento. La ruta llama `transicionPorAsignacion` y pasa el destino al store (regla decide, IO aplica; coherente con el hook de #55).
- **Auth del intake**: `POST /api/prospectos/sin-asignar` es **admin-only** (NO escritura publica). El wiring del formulario web externo "Peltre de Mayoreo" y su token publico es POSTERIOR y fuera de alcance (decision de seguridad de Adrian). Documentado en comentario del codigo y aqui.
- **Primera accion de tarjeta del tablero**: el control de asignar (`buildAsignarControlHtml`) es la primera accion sobre la tarjeta del tablero (antes solo-lectura, #53). Admin-only, solo sobre No Asignado. Pura en pipeline-logica.js (Q27-Q31), cableado DOM `asignarVendedorTablero` en app.js. `buildTableroPipelineHtml(oportunidades, {vendedores, esAdmin})` -- sin opts mantiene el comportamiento previo (no control), por eso no rompe tests existentes.
- Validacion del vendedor en la ruta de asignar: contra `data/vendedores.json` filtrado por `operam_id != null` (misma fuente que `/api/catalogos` que pobla el selector).

### Commits (rama issue-57-no-asignado)
- 8f03131 feat: regla de dominio transicionPorAsignacion en pipeline (#57)
- 9a4c2d4 feat: el store asigna vendedor y aplica la etapa destino (#57)
- 7b4ba3d feat: alta de prospecto sin asignar cae en No Asignado (#57)
- 8a9e288 feat: asignar vendedor mueve la tarjeta de No Asignado a Por Cotizar (#57)
- 74b3136 feat: control de asignar vendedor en la tarjeta No Asignado del tablero (#57)

### DEMO (2 min) para Adrian
1. Login como **admin** (Adrian Chavez, PIN 0000).
2. **Crear una tarjeta No Asignado** (simula el formulario "Peltre de Mayoreo"): no hay UI publica todavia, asi que se prueba la ruta directo. En la consola del navegador (F12), con sesion admin:
   `fetch('/api/prospectos/sin-asignar',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+localStorage.getItem('token')},body:JSON.stringify({celular:'+52 5587654321',nombre:'Mayoreo Web Demo',ciudad:'Toluca',canal:'Formulario web'})}).then(r=>r.json()).then(console.log)`
   (o via curl/Postman con el JWT). Deberia responder `{ok:true,id:...}`.
3. Ir a **Pipeline** (bottom-nav): la tarjeta aparece en la columna **No Asignado**, sin vendedor, con un selector "Asignar a..." + boton **Asignar** (solo visible como admin).
4. Elegir un vendedor del selector (p. ej. Alejandro Chavez) y tocar **Asignar**: la tarjeta se mueve a **Por Cotizar** con ese vendedor (recarga el tablero). Aviso "Asignado a ...".
5. Cerrar sesion y entrar como **vendedor** (NO admin): en Pipeline la columna No Asignado NO muestra tarjetas sin dueno (no son de su cartera); si se le asigno una, ahora la ve en Por Cotizar.

### Deuda / pendientes
- **Auth del intake externo (POSTERIOR, fuera de alcance):** la ruta de alta sin asignar es admin-only. El formulario web "Peltre de Mayoreo" y el bot necesitaran una entrada autenticada propia (token/API key publica) -- es decision de seguridad de Adrian, NO se expuso escritura publica.
- No hay UI para disparar el alta sin asignar desde la app (es la entrada externa). El admin la prueba via consola/curl. Si Adrian quiere un boton manual de "alta sin asignar" en la app, es trabajo adicional no pedido por el issue.
- El frontend del control de asignar no tiene test de DOM (patron del repo: sin DOM en tests); la logica pura si (Q27-Q31) y el cableado se valida en navegador.

## #66 — formalizar pre-cotización + editar prospecto — CERRADO (aprobado por Adrián con evidencia; mergeado a main)

### INVESTIGACIÓN (reusar, no reinventar)
- **Formalizar = encadenar piezas existentes, NO un alta nueva.** Las dos piezas ya existen y son idempotentes/desacopladas:
  1. Alta de cliente: `POST /api/crear-cliente` (server.js ~820). Guardrails + deduplicación por RFC (`crearCliente` en operam-client.js corta si el RFC ya existe → `duplicado:true`). Atómico (ADR-0002), idempotente al reintento. Al completar liga el prospecto (`ligarProspectoACliente`, evento `cliente` + `data.cliente_id`).
  2. Registro de cotización + folio: `POST /api/cotizacion/operam/:id` (server.js 716). Busca el cliente por RFC/razón social (`subirCotizacionOperam`), registra el quote y persiste el folio con `setFolioOperam` → la cotización pierde el PRE. Ya probado por O1.
- **Caso "ya es cliente Operam — falta cotizar" (CONTEXT.md):** NO hay alta nueva; solo registrar. Es exactamente `POST /api/cotizacion/operam/:id` directo (busca el cliente existente por RFC y registra). O1 ya lo cubre con un cliente que existe en Operam.
- **Decisión de dominio "falla a mitad" (alta sí, registro no): YA resuelta por la arquitectura, no es decisión nueva.** Alta idempotente (no duplica por RFC) + registro independiente (O2: si falla, sigue PRE; el cliente dado de alta persiste en Operam). Reintentar el registro tras alta exitosa no re-da-de-alta. Coherente con ADR-0002. → encadeno en el FRONTEND (el acordeón de alta ya vive ahí, ADR-0003), preservando el desacople; NO creo una ruta transaccional nueva.
- **Editar prospecto: NO existe ruta/función.** El store (prospectos-store.js) tiene `cambiarEtapa`, `registrarEvento`, `ligarCliente` — ninguna edita `data`/campos. La construyo: `actualizarDatos(id, campos)` (patrón de los otros updates: UPDATE Postgres + fallback JSON) + `PATCH /api/prospectos/:id` con validación. Campos del issue: nombre, ciudad (columnas propias) + opcionales en `data` (empresa, segmento_id=tipo cliente, piezas_estimadas, correo, temperatura, notas — = `OPCIONALES` de prospectos-logica.js). "Cualquier etapa activa" (CONTEXT.md): se permite en las 7 etapas, NO en salidas (no_util/perdida). La edición toca solo el prospecto local (CRM), no Operam.

### Plan de ciclos (TDD, 1 AC por ciclo)
- C1 (AC4 dominio): store `actualizarDatos(id, campos)` actualiza nombre/ciudad + merge en data; no toca etapa/eventos. Test en `prospectos-store.test.js`.
- C2 (AC4 ruta): `PATCH /api/prospectos/:id` valida (obligatorios, opcionales), respeta visibilidad (404/403/401), rechaza en salidas, persiste. Test en `prospectos-api.test.js`.
- C3 (AC1/AC2/AC3 ruta — formalizar): test end-to-end de ruta: una pre-cotización (sin folio) se registra vía `/api/cotizacion/operam/:id` con el cliente recién dado de alta → obtiene folio → deja de ser PRE. Cubre el caso "ya es cliente Operam". Guardrail del alta verificado vía `/api/crear-cliente` (dedup). Test en `cotizar-embudo.test.js` (reusa O1; agrega caso de formalización explícito).
- C4 (frontend mínimo): botón "Editar"/"Completar después" en la tarjeta del prospecto/cotización + funciones que llaman las rutas. Lógica pura en prospectos-logica.js si aplica.

### Estado: CERRADO. Todos los AC verdes, suite 540/540 (537 + 3 del botón Completar). Aprobado por Adrián con evidencia (sin demo manual, para no crear datos reales en Operam). Deuda menor anotada: el fallback al alta depende de un match de string del error `Cliente no encontrado en Operam` (operam-client.js:98) — frágil; idealmente un código de error.

### Disparador "Completar" sobre la tarjeta PRE (AC1, decision de Adrian 2026-06-16)
Antes la formalizacion solo era posible en dos pasos/dos pantallas (acordeon de alta + "Subir a Operam"). Ahora hay un boton **Completar** sobre la tarjeta de la pre-cotizacion en el **Historial** de cotizaciones (`renderHistorial`, app.js), junto a Cargar/Ver PDF, que tambien ahora muestra el chip **PRE / #Operam** (antes solo el tablero del pipeline y la cola Hoy lo pintaban).
- Logica pura en `pipeline-logica.js` (probada en `.cjs`): `puedeCompletarPreCotizacion(cot)` (solo PRE: sin folio y no `registroDesconocido`), `botonCompletarHtml(cot)` (pinta el boton solo si PRE), `siguientePasoFormalizacion(resultado)` (`listo` | `alta` | `error` segun la respuesta del registro). Tests Q17/Q18/Q19.
- Orquestacion en `completarPreCotizacion(id)` (app.js): registra directo via `POST /api/cotizacion/operam/:id`. Si OK -> folio, deja de ser PRE, refresca Historial (caso "ya es cliente Operam"). Si Operam responde "Cliente no encontrado en Operam" -> guia al alta: `cargarCotizacion(id)` prellena el formulario con los datos de la cotizacion y `abrirAcordeonAlta()` abre el alta; tras el alta el vendedor vuelve a tocar Completar y el registro procede. Cualquier otro fallo se reporta sin mandar al alta.
- NO se toco el tablero del pipeline (solo-lectura por #53): el boton vive en el Historial / cotizaciones, donde el vendedor ya ve la cotizacion. Reusa `subirCotizacionOperam` (ruta) y el acordeon de alta existentes; no duplica rutas. El backend (alta + registro) ya estaba probado por F1/F2/O1/O2.

### Commits (rama `issue-66-formalizar-precotizacion`)
- cb44515 feat: store edita datos del prospecto sin tocar el embudo — `lib/prospectos-store.js`, `test/prospectos-store.test.js`
- a8058ab feat: PATCH /api/prospectos/:id edita el prospecto en cualquier etapa activa — `server.js`, `public/js/prospectos-logica.js`, `test/prospectos-api.test.js`
- 47627c0 test: formalizar una pre-cotizacion (alta + registro) le quita el PRE — `test/cotizar-embudo.test.js`
- e73304a feat: editar el prospecto desde su tarjeta en cualquier etapa activa (frontend) — `public/js/prospectos-logica.js`, `public/js/app.js`, `public/js/__tests__/prospectos-logica.test.cjs`
- b76e4f0 feat: completar una pre-cotizacion desde su tarjeta (logica pura) — `public/js/pipeline-logica.js`, `public/js/__tests__/pipeline-logica.test.cjs`
- a1c4537 feat: boton Completar sobre la tarjeta PRE del Historial formaliza la cotizacion — `public/js/app.js`

### Estado de cada AC (verificado contra tests corridos)
- AC1 (formalizar = alta + registro, en pocos clics desde la tarjeta PRE): VERDE. Boton **Completar** sobre la card PRE del Historial: registro directo (`/api/cotizacion/operam/:id`) con fallback guiado al alta (`/api/crear-cliente` via acordeon prellenado). Logica pura Q17/Q18/Q19; backend F1/F2/O1/O2.
- AC2 (pierde PRE, muestra folio): VERDE. El registro persiste el folio (`setFolioOperam`, #63) → `esPreCotizacion`=false. F1 + O1. Badge ya pintado por #63 (badgeFolioOperamHtml).
- AC3 (alta conserva guardrails y dedup): VERDE. `crearCliente` corta por RFC existente (no duplica). Test F2 (caso "ya es cliente").
- AC4 (editar/complementar en cualquier etapa activa): VERDE. Store `actualizarDatos` + `PATCH /api/prospectos/:id` + frontend (botón Editar en card, form inline). Tests de store (2), ruta (4), frontend (4).
- AC5 (pruebas dominio + ruta): VERDE. Dominio: store (prospectos-store.test.js) + lógica pura (prospectos-logica.test.cjs ED1-ED4). Ruta: prospectos-api.test.js (4 PATCH) + cotizar-embudo.test.js (F1/F2).

### Decisión de diseño clave (formalización)
NO se construyó ruta transaccional nueva: la formalización encadena dos piezas EXISTENTES, idempotentes y desacopladas (alta atómica por RFC + registro independiente). Si el registro falla tras un alta exitosa, el cliente persiste en Operam y la cotización sigue PRE para reintentar solo el registro (O2). El frontend ya expone ambos pasos (acordeón "+ Nuevo cliente" + botón "Subir a Operam"). El caso "ya es cliente Operam" es solo el registro directo (busca por RFC, sin alta) — O1/F2.

### Nota de alcance (frontend de formalización)
Las tarjetas del **tablero del pipeline** siguen siendo solo-lectura (decisión #53: las acciones de tarjeta llegan en issues posteriores). El disparador "Completar" vive en el **Historial / cotizaciones** (`renderHistorial`), donde el vendedor ya ve la cotización con su chip PRE — NO en el tablero. Reusa los flujos existentes (registro via `subirCotizacionOperam` + acordeón de alta), no se construyó UI de acciones nueva en el tablero. Acoplamiento conocido (no bloqueante): `subirCotizacionOperam` busca el cliente por `data.cliente.rfc`/razonSocial; una PRE de Prospecto Mínimo sin RFC debe formalizarse dando primero de alta el cliente con datos que coincidan — ahora ese fallback es automático (al fallar el registro por "Cliente no encontrado" el botón abre el alta prellenado), pero el vendedor debe capturar el RFC en el alta para que el reintento del registro lo encuentre.

### DEMO (2 min) para Adrián
1. **Editar prospecto**: en Más → Prospectos, sobre una tarjeta activa (Por Cotizar o Seguimiento) tocar "Editar" (en compacta, primero "Más"). Cambiar empresa/temperatura/notas y "Guardar". La tarjeta recarga con los datos nuevos. Probar también en una tarjeta de etapa post-venta: también deja editar. En una de No útil/Perdida no aparece "Editar".
2. **Formalizar una pre-cotización (un clic desde la tarjeta)**: en Más → Historial, sobre una cotización con chip ámbar **PRE**, tocar **Completar**.
   - Caso "ya es cliente Operam": el registro corre directo, sale el folio y la tarjeta pasa a **#Operam N** (el botón Completar desaparece).
   - Caso "falta dar de alta": Completar avisa que el cliente no está en Operam y abre el formulario de alta **prellenado** con los datos de la cotización; completar el alta (con RFC real; el guardrail de dedup avisa si ya existe y reutiliza), volver a Historial y tocar **Completar** otra vez → ahora registra y obtiene el folio.

## #58 — Hoy: prospectos por contactar — CERRADO (aprobado por Adrián con evidencia; mergeado a main). Suite 542/542. Deuda menor: la cola de prospectos aparece en Hoy y en Más→Prospectos (redundante); cola de cotizaciones reubicada en Más→"Seguimiento cotizaciones" (hogar temporal hasta #64)

Cierra el H4 de #53: reencauzar el destino **Hoy** a la cola de prospectos en Por Cotizar (horas hábiles), REUSANDO el motor #44 (`calcularColaProspectos`), la ruta (`GET /api/prospectos/cola`) y el HTML (`buildColaProspectosHtml`). NO se fusiona con la cola de cotizaciones (eso es #64).

### Estado de cada AC
- AC1 (Hoy muestra prospectos en Por Cotizar ordenados por urgencia): VERDE (Ciclo 2). `nav-hoy` -> `showHoy()` renderiza `buildColaProspectosHtml` de `/api/prospectos/cola`. Orden por urgencia: motor (S9) + ruta (`prospectos-api.test.js` "mas urgente primero"). Verificado en navegador: cola Laura/Pedro/Sofia con horas hábiles + semáforo.
- AC2 (horas hábiles + semáforo por canal): YA-CUBIERTO-#44. Motor `lib/seguimiento-prospectos.js` + tests S2-S7. Se hereda al reusar la cola.
- AC3 (registrar contacto + WhatsApp desde la cola): YA-CUBIERTO-#44. `buildColaProspectosHtml` (botones) + tests C3. Se hereda.
- AC4 (sugerencia No útil a 3 toques): YA-CUBIERTO-#44. `buildColaProspectosHtml` + `sugerirNoUtilProspecto` + test C4. Se hereda.
- AC5 (badge de Hoy = pendientes de prospectos): VERDE (Ciclo 1). `contarPendientesProspectos` + `cargarBadgeSeguimiento` ahora lee `/api/prospectos/cola`. Tests H1/H2 en `prospectos-logica.test.cjs`.
- AC6 (motor con pruebas: orden, horas hábiles, semáforo, sugerencia 3 toques): YA-CUBIERTO-#44. `test/seguimiento-prospectos.test.js` (S1-S12, R1-R4) + ruta `test/prospectos-api.test.js`.

### Decisión de producto resuelta (cola de cotizaciones al reencauzar Hoy)
El prompt autoriza moverla "p. ej. desde Más". `nav-mas-menu` ya tiene Historial y Prospectos; se agrega **Seguimiento (cotizaciones)** ahí (= `showSeguimiento`, intacta). NO es decisión de dominio nueva (el prompt lo sugiere); NO se borra ni rompe `showSeguimiento`/`calcularCola`, para que #64 la fusione.

### Commits (rama)
- d9114c7 feat: el badge de Hoy cuenta los pendientes de prospectos (#58) — `prospectos-logica.js`, `prospectos-logica.test.cjs`, `app.js`
- (Ciclo 2) feat: el destino Hoy muestra la cola de prospectos en Por Cotizar (#58) — `app.js`, `index.html`, `PROGRESS.md`

### Verificación end-to-end (navegador, datos locales JSON migrados)
Login admin, bottom-nav muestra "Hoy 3" (badge = 3 prospectos en Por Cotizar). Toco Hoy: cola Laura/Pedro/Sofia con "21.5 h hábiles sin respuesta" + semáforo + WhatsApp (wa.me) + Registrar contacto. "Registrar contacto" reinicia el reloj a 0 h y reordena (refresca Hoy). Tras 3 toques aparece "3 toques sin respuesta · ¿No útil?" (sugerencia, confirmada por el vendedor). Más → "Seguimiento cotizaciones" abre la cola de cotizaciones intacta (cadencia días naturales, Ganada/Perdida). Sin errores de consola.

### CERRADO: todos los AC verdes/ya-cubiertos. Suite 542/542 (540 baseline + H1/H2). Listo para verificación del orquestador + demo de Adrián.

## #64 — Hoy suma cotizaciones (cola fusionada) — CERRADO (aprobado por Adrián con evidencia; mergeado a main). Suite 559/559. Implementado en dos tandas (subagente 1 se cortó por límite tras el backend; subagente 2 hizo el frontend). `lib/cola-hoy.js` (urgencia relativa: prospecto horas/umbralRojo, cotización dias/28, reunión vencida primero) + GET /api/hoy + buildColaHoyHtml. Se eliminó por completo showSeguimiento/seguimiento-view (la cola de cotizaciones ya solo vive en Hoy).

Fusiona en el destino **Hoy** la cola de prospectos (horas hábiles) con la de cotizaciones (días naturales) en un solo listado ordenado, REUSANDO el backend ya hecho (`lib/cola-hoy.js` + `GET /api/hoy`, no tocados).

### Qué se construyó/reusó (frontend)
- **`buildColaHoyHtml(cola)`** (NUEVO, en `public/js/pipeline-logica.js`): función pura de presentación. Itera la cola ya fusionada+ordenada del backend y delega por `tipo` PRESERVANDO el orden (no reagrupa). Prospecto → reusa `buildColaProspectosHtml([item])`; cotización → `buildColaCotizacionItemHtml`.
- **`buildColaCotizacionItemHtml(item)`** (NUEVO, mismo módulo): extraído del markup inline de `showSeguimiento` (app.js). WhatsApp con `item.waLink` (sin teléfono → botón deshabilitado), badge de folio (`badgeFolioOperamHtml`), etiqueta del paso (`PASO_LABELS` movido aquí desde app.js), días, total, ✓ Hecho (`marcarSeguimiento`), Ganada/Perdida (`cambiarEstadoCotizacion`).
- **`showHoy`** (app.js): ahora consume `GET /api/hoy` y pinta con `buildColaHoyHtml`. Antes leía `/api/prospectos/cola` + `buildColaProspectosHtml`.
- **`cargarBadgeSeguimiento`** (app.js): ahora lee `GET /api/hoy` y el badge = `cola.length` (total fusionado). Antes contaba solo prospectos.
- `marcarSeguimiento` / `cambiarEstadoCotizacion` ahora refrescan `showHoy()` (su nuevo hogar).

### "Seguimiento cotizaciones" de Más — RETIRADO (decisión de diseño)
La cola de cotizaciones ahora vive fusionada en Hoy, así que el acceso separado quedó redundante. Retirado en su totalidad (regla de proyecto: nada de código en desuso): botón `mas-seguimiento` + su listener, vista `seguimiento-view` (HTML), `showSeguimiento`, `btn-volver-seguimiento` + su listener, `PASO_LABELS` (movido a pipeline-logica.js). Las acciones `marcarSeguimiento`/`cambiarEstadoCotizacion` se conservan (las invoca la card de cotización en Hoy). Import de `contarPendientesProspectos` retirado de app.js (ya no se usa; sigue exportado y testeado en prospectos-logica para la lista de Más).

### Decisión de diseño: dónde vive buildColaHoyHtml
En `pipeline-logica.js`, NO en prospectos-logica.js, por la dirección de dependencias: `pipeline-logica` importa de `prospectos-logica` (no al revés). Necesita ambos: `buildColaProspectosHtml`/`escapeHtml` (de prospectos-logica) y `badgeFolioOperamHtml` (local a pipeline-logica). Ponerlo en prospectos-logica habría creado un ciclo de imports.

### Estado de cada AC (verificado: tests + render end-to-end con datos locales)
- AC1 (un solo listado ordenado prospectos+cotizaciones): VERDE. `/api/hoy` con datos locales devuelve 10 items (3 prospectos + 7 cotizaciones) INTERCALADOS por urgencia; `buildColaHoyHtml` los pinta en ese orden exacto (verificado por posición de los onclick: `p3 c1 p4 c2 c13 c48 c9999 c55 c10000 p2`, estrictamente creciente). Test Q20.
- AC2 (cada reloj con su medida): YA-CUBIERTO (backend `cola-hoy.js`): prospecto urg=horas/umbralRojo, cotización urg=días/28. Heredado.
- AC3 (orden por urgencia relativa): YA-CUBIERTO (backend). El frontend solo preserva el orden recibido (Q20).
- AC4 (acción correcta por tipo): VERDE. Prospecto: Registrar contacto/WhatsApp/reunión vencida/sugerencia No útil (reusa buildColaProspectosHtml). Cotización: WhatsApp de seguimiento + ✓ Hecho + Ganada/Perdida. Tests Q21/Q22/Q23 + render real.
- AC5 (módulo de cola fusionada con pruebas): VERDE (backend `test/cola-hoy.test.js` + `test/hoy-api.test.js`, 12 tests). Presentación: Q20-Q24 en `pipeline-logica.test.cjs`.
- Badge cuenta ambos tipos: VERDE. `cargarBadgeSeguimiento` lee `/api/hoy`, badge=total (10 con datos locales).

### Commits (rama issue-64-hoy-fusion)
- 599e9f2 feat: buildColaHoyHtml pinta la cola Hoy fusionada delegando por tipo (#64) — `pipeline-logica.js`, `pipeline-logica.test.cjs`
- b037682 feat: el destino Hoy muestra la cola fusionada del dia y retira el acceso separado (#64) — `app.js`, `index.html`
- (backend previo, ya en rama: a821bdc / 712b0df / d1f11d7 / 2d18abc)

### DEMO (2 min) para Adrián
1. Login admin. El bottom-nav muestra **"Hoy 10"** (badge = cola fusionada completa: prospectos + cotizaciones, antes solo contaba prospectos).
2. Tocar **Hoy**: un solo listado INTERCALADO por urgencia. Con los datos locales: Pedro (prospecto, urg 10.7) primero, luego "Test SA de CV" (cotización, urg 2.86), luego Sofia (prospecto), luego más cotizaciones... — los dos tipos compiten en la misma escala, cada uno con su reloj.
3. Sobre un ítem **prospecto**: WhatsApp + "Registrar contacto" (y, si aplica, reunión vencida / "3 toques · ¿No útil?"). Registrar contacto reordena la cola.
4. Sobre un ítem **cotización**: WhatsApp con el mensaje de seguimiento del paso (día 2/7/21/vencida), chip de folio (PRE / #Operam N), "✓ Hecho" (saca la tarjeta hasta el siguiente paso) y Ganada/Perdida.
5. Ir a **Más**: ya NO aparece "Seguimiento cotizaciones" (su cola se fusionó en Hoy). Solo Historial y Prospectos.

## #54 — crear prospecto en Por Cotizar (boton + global) — CERRADO (aprobado por Adrian con evidencia; verificado por el orquestador contra el codigo real; mergeado a main). Suite 561/561

### INVESTIGACION (reusar, no reinventar) — el backend y la captura YA existian
- **Ruta `POST /api/prospectos` (server.js ~357) ya hacia todo el trabajo de dominio**: no fija `etapa` (deja el default del store), auto-asigna `req.user.name`, y aplica los 3 guardrails via `clasificarCelular` (prospecto propio -> 409 con datos; prospecto de otro vendedor -> 409 "ya lo atiende X" sin exponer; cliente Operam -> 409 "cotizale como cliente"; dedup por celular10/indice unico). NO se reescribio.
- **Store `crear(entry)` (lib/prospectos-store.js ~201)** ya nace en `por_cotizar` (`entry.etapa || 'por_cotizar'`). NO se toco.
- **AC2, AC4, AC5 ya estaban CUBIERTOS por tests existentes** (verificado leyendo los tests, no el reporte):
  - AC2 (auto-asign + nace en Por Cotizar): `test/prospectos-api.test.js:79` ("vendedor autenticado captura un prospecto y lo ve en su lista en Por Cotizar") afirma `etapa==='por_cotizar'` y `vendedor==='Memo'`.
  - AC4 (guardrails): `test/prospectos-api.test.js:124` (propio 409+datos) y `:138` (otro vendedor 409 sin exponer); cliente Operam en `test/clasificar-celular.test.js`.
  - AC5 dominio: `test/prospectos-store.test.js:34` ("un prospecto a mano nace en por_cotizar") afirma el default del store. AC5 ruta: el mismo `prospectos-api.test.js:79` afirma la etapa por defecto de la ruta.
- **Captura frontend ya existia**: `prospecto-form` (index.html), `abrirCapturaRapida`/`guardarProspecto` (app.js). El + reusa ESTA captura, no una nueva.

### Lo que SI se construyo (foco del slice: AC1 + AC3)
- **AC1 (boton + global)**: boton circular cobalto `#nav-add` (aria-label "Crear") centrado en el bottom-nav (entre Hoy y Pipeline), visible en TODOS los destinos porque la barra es fija (`showApp` la muestra siempre). Al tocarlo abre `#nav-nuevo-menu` con dos botones armados por la logica pura `buildMenuNuevoHtml()`: "Nueva cotizacion" -> `nuevaCotizacion()` (vista de cotizar existente, igual que `nav-cotizar`); "Nuevo prospecto" -> `nuevoProspecto()` (`showProspectos()` + `abrirCapturaRapida()`, la captura EXISTENTE). Menus + y Mas mutuamente excluyentes (abrir uno cierra el otro); `ocultarTodasLasVistas` cierra ambos.
- **AC3 (tarjeta en Por Cotizar sin recarga)**: `guardarProspecto` ya refrescaba la lista de Prospectos (`cargarListaProspectos`), donde el vendedor ve la tarjeta al instante. Para el TABLERO: `showPipeline()` re-fetchea `/api/prospectos` + `/api/cotizaciones` en cada navegacion del bottom-nav (no es recarga manual del navegador), asi que la tarjeta nueva sale en Por Cotizar al ir a Pipeline. NO se invento mecanismo nuevo de refresco. La regla pura que la coloca en la columna es `agruparPipeline` (ya probada por Q3).

### Logica pura nueva (TDD, en pipeline-logica.js, probada en .cjs)
- `ACCIONES_NUEVO` = `[{label:'Nueva cotizacion',accion:'nuevaCotizacion'},{label:'Nuevo prospecto',accion:'nuevoProspecto'}]`. `buildMenuNuevoHtml()` pinta un boton por accion con su `onclick`. Tests Q25/Q26 en `pipeline-logica.test.cjs`. Vive en pipeline-logica.js (modulo del shell/pipeline que ya agrega prospectos+cotizaciones; importa `escapeHtml` de prospectos-logica, respeta la direccion de imports).

### Estado de cada AC (verificado: tests + navegador end-to-end con un vendedor real)
- AC1 (+ global visible en todos los destinos, ofrece Nueva cotizacion/Nuevo prospecto): VERDE. Logica pura Q25/Q26 + verificado en navegador (Cotizar y Pipeline muestran el +; el menu abre ambas acciones; "Nuevo prospecto" abre la captura existente).
- AC2 (a mano -> Por Cotizar auto-asignado): YA-CUBIERTO (`prospectos-api.test.js:79`). Verificado en navegador (tarjeta "Demo AC54 Prospecto · Alejandro Chavez · Toluca · WhatsApp").
- AC3 (tarjeta en Por Cotizar sin recarga manual): VERDE. Verificado en navegador: tras guardar via el +, navegar a Pipeline muestra la tarjeta en la columna **Por Cotizar** (count 1), sin refresh del navegador. Regla pura `agruparPipeline` (Q3).
- AC4 (guardrails siguen aplicando): YA-CUBIERTO (`prospectos-api.test.js:124`/`:138` + `clasificar-celular.test.js`). El + reusa la misma ruta, no la cambia.
- AC5 (dominio + ruta con prueba de etapa por defecto): YA-CUBIERTO. Dominio: `prospectos-store.test.js:34`. Ruta: `prospectos-api.test.js:79`.

### Commits (rama issue-54-crear-prospecto)
- eb592b4 feat: menu del boton + global (logica pura) ofrece Nueva cotizacion y Nuevo prospecto (#54) — `pipeline-logica.js`, `pipeline-logica.test.cjs`
- 05e41b7 feat: boton + global en el bottom-nav crea cotizacion o prospecto (#54) — `index.html`, `style.css`, `app.js`

### DEMO (2 min) para Adrian
1. Login. En CUALQUIER destino (Cotizar, Hoy, Pipeline, Mas) el bottom-nav muestra el boton **+** redondo cobalto al centro.
2. Tocar **+**: aparece un menu con **Nueva cotizacion** y **Nuevo prospecto**.
3. **Nueva cotizacion** -> vuelve a la vista de cotizar (home). **Nuevo prospecto** -> abre la captura minima existente (celular/nombre/ciudad/canal + opcionales), con el celular ya enfocado.
4. Capturar un prospecto (celular nuevo + canal): se guarda auto-asignado al vendedor, nace en **Por Cotizar** y aparece en la lista de Prospectos.
5. Ir a **Pipeline** (bottom-nav, sin recargar): la tarjeta esta en la columna **Por Cotizar**.
6. Guardrails intactos: capturar un celular ya tuyo avisa que ya es prospecto; uno de otro vendedor dice "ya lo atiende X"; uno de un cliente Operam manda a cotizarle como cliente.

### Notas / deuda
- "Nueva cotizacion" simplemente lleva a la vista de cotizar tal cual (no toca un carrito a medias) — el rediseno del flujo de cotizar como stepper es #60, fuera de alcance aqui.
- El boton + NO es una accion de tarjeta del tablero (el tablero sigue solo-lectura, decision #53).
- El frontend del + no tiene test de DOM (no hay DOM en los tests, patron del repo); la logica pura del menu si (Q25/Q26) y el cableado se valido en navegador.

## #56 — mover a Seguimiento manual capturando folio Operam — CERRADO (aprobado por Adrian con evidencia; verificado por el orquestador; mergeado a main). Suite 593/593 (581 baseline + 10 de #56 + Q38/Q39 del fix de #57)

### Fix de #57 incluido en este merge (hallazgo del orquestador)
El boton de asignar vendedor de #57 estaba roto en el navegador: `buildAsignarControlHtml` emitia `onclick="asignarVendedorTablero(${o.id})"` con `o.id` prefijado (`p7`), un identificador sin comillas = variable undefined; el boton no hacia nada (la ruta si servia). Corregido a `o.refId ?? o.id` (como el control de mover de #56). Regresiones Q38 (asignar) y Q39 (mover) con la forma real prefijada (`id:'p7', refId:7`); los helpers de test usaban id numerico sin refId, por eso #57 no lo cazo. Leccion: las acciones de tarjeta del tablero se verifican EN NAVEGADOR, no solo por tests puros del string HTML.

Reintroduce UNA transicion manual forward del embudo (Por Cotizar -> Seguimiento), gated por folio de Operam: el vendedor cotizo POR FUERA (directo en Operam), no hay cotizacion en el sistema, asi que captura el folio al mover y se guarda en el prospecto. NO es drag-and-drop (boton, fuera de alcance el arrastre). NO toca el flujo automatico de #55.

### Estado de cada AC (verificado contra tests corridos)
- AC1 (mover a mano abre la captura del folio): VERDE. Boton "A Seguimiento (folio Operam)" sobre la tarjeta de un prospecto en Por Cotizar (`buildMoverSeguimientoControlHtml`, pipeline-logica.js, Q35-Q37). `moverASeguimientoTablero(id)` (app.js) captura con prompt() y llama PATCH .../etapa. Logica pura testeada; cableado DOM por verificar en navegador.
- AC2 (rechazo server-side sin folio): VERDE. `validarTransicion('por_cotizar','seguimiento',motivo,folio)` rechaza sin folio (regla de dominio, T3 en prospectos-logica.test.cjs); la ruta hereda el 400 (prospectos-api.test.js: "sin folio se rechaza server-side y la tarjeta no avanza"). Guard adicional en el frontend (moverASeguimientoTablero corta el prompt vacio).
- AC3 (tarjeta movida muestra "#Operam N"): VERDE. `badgeFolioOperamProspectoHtml(o)` pinta #Operam N solo con folio, JAMAS PRE (Q32-Q34). `prospectoAOportunidad` mapea `folioOperam: p.data?.folioOperam ?? null`; tablero y vista lista lo pintan por tipo.
- AC4 (prueba de dominio + prueba de ruta del rechazo sin folio): VERDE. Dominio: T3 (prospectos-logica.test.cjs) + moverASeguimientoConFolio (prospectos-store.test.js). Ruta: 3 tests en prospectos-api.test.js (sin folio 400, con folio mueve+guarda, desde no-PorCotizar 400 aun con folio).

### Diseno (lo que no perder)
- **Regla de dominio**: `validarTransicion(actual, nueva, motivo, folio)` — se anadio el 4o parametro `folio`. Nueva arista: `por_cotizar -> seguimiento` valida SOLO con folio no vacio (`String(folio).trim()`); sin folio devuelve "El folio de Operam es obligatorio...". Desde cualquier otra etapa (incl. seguimiento->seguimiento) sigue "Transicion invalida". El caso `no_util` NO se toco (folio irrelevante). Unico caller real: la ruta PATCH .../etapa.
- **Folio en el PROSPECTO**: `data.folioOperam` (TEXT, identificador como #63, no columna nueva). Store: `moverASeguimientoConFolio(id, folio, evento)` (nuevo, espeja asignarVendedor) fija etapa='seguimiento' + merge data.folioOperam + appendea evento en una operacion (UPDATE Postgres + fallback JSON). El evento de etapa lleva el folio: `{ tipo:'etapa', de, a:'seguimiento', folio, fecha, vendedor }`.
- **Ruta** PATCH /api/prospectos/:id/etapa: cuando `etapa==='seguimiento'` enruta por `moverASeguimientoConFolio` (etapa+folio+evento); el resto (no_util / otros) sigue por `cambiarEtapa`. validarTransicion ya rechazo sin folio y desde origen invalido.
- **Badge de prospecto vs cotizacion**: `badgeFolioOperam(o)` (interno) = cotizacion -> `badgeFolioOperamHtml` (PRE/#Operam, comportamiento #63 intacto, Q12/Q13 verdes); prospecto -> `badgeFolioOperamProspectoHtml` (#Operam solo si folio, NUNCA PRE). PRE es concepto de COTIZACION, no de prospecto.
- **Trigger = boton, no drag** (decision de alcance ya aprobada). El boton solo aparece sobre PROSPECTOS en por_cotizar (una cotizacion avanza sola, #55). Lo ve quien opera la tarjeta (dueno o admin; la ruta usa prospectoOperable) — NO admin-only (a diferencia del asignar de #57). `moverASeguimientoTablero` usa `o.refId ?? o.id` (id numerico real para la ruta).

### Commits (rama issue-56-seguimiento-folio)
- 4ab6098 feat: validarTransicion permite Por Cotizar a Seguimiento manual con folio (#56) — prospectos-logica.js, prospectos-logica.test.cjs
- 45f06bf feat: el store mueve a Seguimiento guardando data.folioOperam (#56) — prospectos-store.js, prospectos-store.test.js
- 47d0689 feat: PATCH etapa a Seguimiento exige folio y lo persiste server-side (#56) — server.js, prospectos-api.test.js
- b7bd17e feat: la tarjeta de un prospecto movido a mano muestra #Operam N (#56) — pipeline-logica.js, app.js, pipeline-logica.test.cjs
- b9366d8 feat: boton para mover a Seguimiento con folio en la tarjeta Por Cotizar (#56) — pipeline-logica.js, app.js, pipeline-logica.test.cjs

### DEMO (2 min) para Adrian
1. Login. Ir a **Pipeline** (bottom-nav), vista tablero. En la columna **Por Cotizar**, sobre una tarjeta de prospecto aparece el boton **"A Seguimiento (folio Operam)"**.
2. Tocarlo: sale un prompt **"Numero de cotizacion de Operam (folio):"**.
   - Si se deja vacio y se confirma: aviso "El folio de Operam es obligatorio..." y la tarjeta NO se mueve (guard del frontend). Si se forzara la peticion sin folio (consola), el servidor responde 400 (rechazo server-side).
   - Escribir un folio (p. ej. `55123`) y confirmar: aviso "Movido a Seguimiento (folio 55123)"; la tarjeta pasa a la columna **Seguimiento** y muestra el chip azul **#Operam 55123** (nunca PRE). El folio queda en data.folioOperam del prospecto.
3. Una cotizacion ya en el sistema NO lleva este boton (avanza sola al cotizar, #55). Una tarjeta en No Asignado tampoco (necesita vendedor primero).

### Deuda / pendientes
- **El folio NO se valida contra Operam** (fuera de alcance): se captura como texto libre; validar que el numero exista realmente en Operam es trabajo futuro (cuando se cierre el sync #62). Hoy un folio invalido se aceptaria.
- El frontend (boton + prompt + moverASeguimientoTablero) no tiene test de DOM (patron del repo: sin DOM en tests); la logica pura si (Q35-Q37) y el cableado se valida en navegador.
- `moverASeguimientoTablero` usa `o.refId` para el id real. El control de asignar de #57 usa `o.id` directo (posible id prefijado "p7"); si #57 funciona en produccion es porque su flujo difiere — NO se toco (fuera de alcance), pero anotado por si el asignar tuviera un latente.
