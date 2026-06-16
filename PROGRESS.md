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
- #56 mover a Seguimiento manual con folio — desbloqueado
- #57 No Asignado + asignación — desbloqueado
- **#58 CERRADO** ✅ — Hoy muestra la cola de prospectos en Por Cotizar (cierra el H4 de #53). Cola de cotizaciones reubicada en Más → "Seguimiento cotizaciones" hasta la fusión #64. Mergeado a main.
- #59 salidas No útil/Perdida + filtro — desbloqueado
- #60 cotizar repensado (stepper) — desbloqueado
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

## Siguiente
#53, #54, #55, #58, #63, #64 y #66 cerrados y en main (7 de 14). Cola Hoy fusionada + ruta de pre-cotización + botón `+` global y alta manual de prospecto completas. Candidatos: **#57** (No Asignado + asignación — entrada del embudo por arriba, reusa la regla de dominio de #55) · **#56** (manual a Seguimiento con folio — primera acción de tarjeta en el tablero) · **#59** (salidas No útil/Perdida + filtro/historial) · **#65** (reunión re-encuadrada; desbloqueado por #58) · **#60** (cotizar stepper — UX grande del flujo central) · **#61** (decorados). #62 (sync Operam) de-riesga la dependencia abierta pero es HITL (escribe/lee Operam real).

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
