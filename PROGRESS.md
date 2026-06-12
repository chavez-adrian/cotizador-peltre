# PROGRESS — módulo de prospectos (actualizado 2026-06-10, sesión 3)

## ESTADO (sesión 3, cierre)

**#41-#47 TERMINADOS (7 de 8): demo aprobada, mergeados a main (deploy automático a Render) y cerrados. Solo queda #48 (Bitrix, HITL).**

#47: importación de Feria/Expo — el export real de Abastur es XLSX (no CSV): hoja "Contactos", Telefono numérico, Rankings Cold/Medium/Hot→temperatura 1/3/5 (Warm→2), "Sin definir por el usuario"=vacío, Dispositivo=quien escaneó→asignación automática de vendedor (match por nombre/primer nombre sin acentos; ambiguo→default elegido en la UI). `lib/importar-prospectos.js` (parser puro, fixture sintético en tests — el archivo real con datos personales JAMÁS se commitea), POST /api/admin/prospectos/importar (multer, índice Operam refrescado UNA vez antes del loop), UI admin con reporte. fecha del prospecto = momento de importación (escaneo en data.escaneado). Reimport idempotente (dedup contra store). Smoke real Abastur 2024: 326/347 importables (12 tel inválido, 6 dup, 3 ya-cliente). Suite 448/448.

#45: reunión diagnóstico — agendar (POST /:id/reunion, fecha futura), supresión de cadencia SOLO en el motor mientras es futura, reaparece al frente con `reunionVencida` pidiendo resultado (POST /:id/reunion-resultado: salto a Calificado válido solo ahí, o No útil con motivo), predicados compartidos ultimaReunion/reunionFutura/reunionPendienteResultado en prospectos-logica ("última" = la agendada más recientemente por fecha de registro — correcto para re-agendar a fecha más temprana). Suite 425/425. Review limpio sin fixes pre-merge; deuda: carrera ms en doble-click de resultado, select de motivos duplicado en 2 builders, validación de motivo duplicada en ruta resultado, badges inline (al 4º badge usar contenedor flex).

#46: `lib/clasificar-celular.js` (clasificación reutilizable prospecto/cliente/libre — refactor transparente de la captura, 28 tests previos intactos), endpoint GET /api/prospectos/clasificar, hook best-effort en POST /api/cotizacion/pdf|html (prospecto→Cotizado incluso desde No útil; libre+canal→auto-crea en Cotizado con datos de la cotización; cliente Operam→nada; sin canal no consulta Operam ni auto-crea), modal de canal en frontend solo para celular libre, etiqueta "Ya es cliente — falta cotizar" (decisión B en CONTEXT.md), etiquetaEvento como lookup table. Fix del review: await en vez de return-promesa dentro del try del hook (el rechazo escapaba al catch y rompía la generación con 500). Suite 407/407.

#42: 409 con dueño en colisión entre vendedores (sin exponer datos); `lib/indice-telefonos.js` — índice celular→cliente Operam construido del listado paginado (contacts[].phone/phone2 + branches[].phone vienen inline; 5 requests por refresh, cache 1 h, timeout 5 s, stale-on-error, best effort: su fallo NUNCA bloquea la captura); liga prospecto→cliente al completar alta (evento tipo 'cliente' + data.cliente_id, fire-and-forget patrón Dropbox). Fix del review: normalización de teléfono unificada en `ultimos10` (recorta ext/coma — el índice y el store DEBEN coincidir o la liga falla en silencio). Suite 380/380.

#44: módulo `horas-habiles` (L–V 10–18, sáb 10–14, festivos MX 2026-2027, evaluado en America/Mexico_City vía Intl — Render corre en UTC), motor `seguimiento-prospectos` (cola por urgencia relativa al umbral del canal; mensajería rojo 2 h / resto 8 h, ámbar = mitad; sugerencia No útil a los 3 toques, confirmada por el vendedor), ruta GET /api/prospectos/cola, sección "Qué toca hoy" + etiqueta semáforo en cards. Suite 360/360.

#41 incluyó además: ajustes de demo (banderas país, opcionales visibles, labels, temperatura en estrellas), corrección del catálogo de SEGMENTOS a los ids internos reales de Operam (la clave 000-1000 de la UI NO es el id de la API; verificado contra producción) y corrección de los 2 clientes afectados (456 vía API, 457 vía UI por quirk de Operam documentado en CLAUDE.md).

#43: etapas manuales un-paso (validarTransicion compartida frontend/server), toques con fecha/autor, No útil con catálogo obligatorio, historial en eventos JSONB (migración ALTER TABLE auto en ensureSchema), conteo admin de motivos. Suite 327/327.

**Deuda nueva del review #44:** FESTIVOS solo 2026-2027 sin guard — **agregar 2028 antes de dic-2027 o meter un warn de año faltante**; CANALES_MENSAJERIA es set propio separado del catálogo CANALES (canal nuevo cae al umbral tolerante en silencio); tercera copia del filtro de visibilidad en server.js (extraer helper al volver a tocar); colores de semáforo en hex vs variables CSS. Notas para #45: exponer eventos en el shape de la cola (para "registrar resultado" de reunión) y la supresión por reunión debe extender el motor, no filtrar en ruta/frontend.

**Deuda acumulada (findings menores de reviews #41+#43, atacar al tocar esos archivos):** leerJson/escribirJson/filaAEntrada y bloques fallback JSON duplicados entre stores y dentro de prospectos-store; ensureSchema cachea promise rechazada; temperatura/segmento_id como strings; showProspectos no oculta otras vistas; retorno de cambiarEtapa/registrarEvento sin verificar en rutas (carrera inalcanzable hoy — no hay borrado); buildWaLink duplica telefonoWa.

**Notas de diseño para #45/#46:** extraer un builder de eventos cuando se agreguen tipos nuevos (hoy inline en la ruta PATCH etapa); el flag `activo` de la card excluye `cotizado` — #45 lo tendrá que revisar.

**Deuda nueva del review #42:** con Operam caído y cache vacío cada captura espera el timeout de 5 s (backoff pendiente); clasificación de celular (propio/ajeno/cliente/libre) inline en la ruta — extraer al llegar #46; tres formas de 409 con literal duplicado; mocks de fetch duplicados entre archivos de test. **Punto abierto registrado en #46 (decisión de Adrián):** prospecto convertido en cliente sin cotizar sigue en la cola — resolverlo al implementar #46 (comentario en el issue).

**Deuda nueva del review #46:** la generación de cotización puede cargar el timeout de 5 s del índice cuando viaja canal y Operam está caído (backoff pendiente, mismo trade que captura); listeners del modal de canal sin remoción explícita; las rutas pdf/html duplican el wrapper crear+hook. Notas de altitud para #47/#48: clasificarCelular es por-llamada (sin modo batch — para CSV grande refrescar índice una vez antes del loop); normalizar canal (trim) en imports.

**Deuda nueva del review #47:** headers del XLSX se matchean exacto (columna renombrada → reporte confuso "todo teléfono inválido" en vez de "columna faltante"); import O(n²) solo en modo JSON local; NOTA #48: extraer el pipeline route-side (dedup store + clasificar + crear + reporte) al llegar el segundo import.

**#50 TERMINADO (kanban cotizaciones): demo aprobada, mergeado y cerrado. La réplica de la experiencia Bitrix24 está completa.** Refactor primero (pagó la deuda de #49): initDragEnTablero genérico para ambos tableros, CSS .tablero compartido, guard de columna en el wiring. `public/js/cotizaciones-logica.js` nuevo (módulo puro browser-safe: NO importa de lib/ — telefonoWa formatea server-side en GET /api/cotizaciones, que ahora expone estado||'abierta' y telefono). Columnas cadencia (2/7/21/28 días naturales, misma aritmética del motor) + Ganada/Perdida (solo el cierre se arrastra, con confirm); descartadas fuera del tablero. Conmutador en Historial con localStorage propio. Suite 470/470. Deuda: umbrales 2/7/21/28 duplicados entre cotizaciones-logica y PASOS de lib/seguimiento (mover umbrales al módulo compartido y que lib importe — patrón server→public/js ya existente); test del endpoint no asegura campos preexistentes.

**#49 TERMINADO (kanban prospectos): demo aprobada, mergeado y cerrado.** Conmutador lista⇄tablero con preferencia en localStorage, cola fija, 5 columnas con contadores, drag HTML5 delegado en contenedor persistente (initTableroDrag UNA vez), drops válidos vía PATCH existente, No útil con modal de motivo, móvil con scroll-snap. Fix del review: limpiar el contenedor inactivo al conmutar (IDs DOM duplicados entre vistas → botones operaban sobre el fantasma oculto). Suite 457/457. Deuda para #50: guard de===a vive en soltarEnColumna; initTableroDrag y CSS soldados a prospectos — parametrizar al construir #50.

**Kanban (grilling 2026-06-11, decisiones en CONTEXT.md "Tablero de prospectos"/"Tablero de cotizaciones"):** arrastre respeta el dominio (un paso; No útil pide motivo; Cotizado no acepta drops), No útil como columna siempre visible, conmutador kanban⇄lista con "Qué toca hoy" fija sobre ambas, tablero de cotizaciones con columnas de cadencia+cierre (solo el cierre se arrastra), móvil con swipe horizontal, término canónico "Cotizaciones". Issues publicados: **#49** (kanban prospectos, ready-for-agent, sin bloqueos) y **#50** (kanban cotizaciones, bloqueado por #49).

**Siguiente:** #49 → #50 (kanban) y #48 (importación Bitrix one-time, HITL — requiere sesión con Adrián y el export real de Bitrix: mapeo de etapas/canales y asignación de vendedores). Esperar confirmación de Adrián para arrancar.

**Code-review COMPLETO.** Findings verificados (orden de severidad):
1. **XSS almacenado (CONFIRMADO, arreglar antes de merge):** `buildProspectoCardHtml` (prospectos-logica.js:52-53) interpola nombre/empresa/ciudad/canal/celular sin escapar y app.js lo asigna a innerHTML (lista + pr-existente:1811). Mismo patrón crudo existe en cards de historial/seguimiento (app.js:1598/1655) pero ahí el dato lo captura el vendedor; el prospecto es dato de terceros (y #47 importará CSVs externos). Fix: helper `escapeHtml` en prospectos-logica.js con test.
2. **Carrera TOCTOU en dedup (PLAUSIBLE, arreglar antes de merge):** sin UNIQUE en `celular10` (SCHEMA), dos POST concurrentes pasan ambos `buscarPorCelular` y rompen 1 celular = 1 prospecto. Fix: UNIQUE INDEX + capturar 23505 → 409.
3. **OPCIONALES duplicado (CONFIRMADO):** server.js:262 `PROSPECTO_OPCIONALES` repite la lista de prospectos-logica.js:25 — exportarla e importarla (server ya importa validarProspectoBody del mismo módulo).
4. leerJson/escribirJson/filaAEntrada duplican cotizaciones-store (cleanup, puede ir en #42+).
5. ensureSchema cachea promise rechazada (patrón pre-existente copiado de cotizaciones-store; afecta ambos stores; baja prioridad).
6. temperatura/segmento_id viajan como strings de los selects (deriva futura; coerción en buildProspectoPayload).
7. showProspectos no oculta historial/seguimiento-view (asimetría inalcanzable hoy; generalizar navegación cuando #42+ agregue vistas).
REFUTADOS: bypass de dedup sin dígitos (validarTelefono exige 11-15 dígitos), navegación a/b (header aislado), lista vieja tras guardar (muestra "Cargando..."), vendedor undefined en JWT propio, SELECT*+filtro JS (patrón del repo).

**Fixes 1-3 APLICADOS con TDD** (commits 915e330 y 8dc02bf, suite 302/302 verde, rama pusheada): escapeHtml en tarjetas, UNIQUE INDEX celular10 + 23505→409 (el fallback JSON también lanza 23505 para paridad), OPCIONALES exportado de prospectos-logica.js e importado en server.js.

**Al retomar:** demo de Adrián (npm run dev → login vendedor → botón Prospectos → capturar, duplicar, probar admin) → con su visto bueno: merge de `issue-41-captura-prospectos` a main (dispara deploy a producción en Render) → cerrar #41 con comentario-resumen anotando findings 4-7 como deuda aceptada. Luego elegir siguiente issue (#42, #43 o #47, todos desbloqueados) y esperar confirmación.

## Estado: grilling COMPLETO + PRD PUBLICADO

**PRD publicado como issue #40** (`ready-for-agent`) en `chavez-adrian/cotizador-peltre` vía `/to-prd`. Cambios sobre lo grillado, decididos por Adrián al revisar los módulos:

- **Horas hábiles cambiaron a L–V 10:00–18:00, sábado 10:00–14:00** (antes 7:30–16:30 / 7:30–13:00 — era horario de fábrica; el nuevo es horario comercial). `CONTEXT.md` ya actualizado.
- Nombres de módulos: `seguimiento-prospectos` (no "cadencia-prospectos"), `importar-csv-prospectos` (no "importar-gafetes").
- Tests: lógica + rutas (5 módulos puros con TDD + supertest para rutas; frontend solo lógica pura extraída).

La sesión de `/grill-with-docs` del módulo de prospectos cerró. Todas las decisiones viven en `CONTEXT.md` (glosario) y `docs/adr/0004-crm-minimo-prospectos-en-cotizador.md`. Resoluciones de esta sesión:

- **Pregunta 6:** cotización con celular nuevo (sin prospecto ni cliente Operam) → auto-crear prospecto en etapa Cotizado, **pidiendo el canal de origen al vendedor** (no se usa canal "Directo"; no se pierde el dato).
- **Pregunta 7:** visibilidad igual que cotizaciones (vendedor ve lo suyo, admin todo). Colisión de celular entre vendedores: rechazo con aviso "este celular ya lo atiende [vendedor B]", sin exponer más datos.
- **Pregunta 8:** importación única de los prospectos VIVOS de Bitrix24 (CSV o REST), dedup por celular, descarte de celulares inválidos; Bitrix queda solo-lectura. **Punto abierto para el PRD:** mapeo de etapas y canales de Bitrix al modelo nuevo — requiere ver el export real.
- **ADR 0004** redactado y aceptado: CRM mínimo en el cotizador en lugar de sync Operam↔Bitrix24.

## Siguiente acción exacta

PRD #40 descompuesto en 8 slices verticales (2026-06-10, `/to-issues`; Adrián pidió re-corte más vertical — cada issue es un escenario demoable de punta a punta):

- #41 Captura y lista (tracer bullet) — sin bloqueos, **empezar aquí**
- #42 Frenos de frontera (otro vendedor / cliente Operam / ligar al convertir) — bloqueado por #41
- #43 Trabajar el prospecto (etapas, toques, No útil, historial) — bloqueado por #41
- #44 Cola de seguimiento con semáforo en horas hábiles — bloqueado por #43
- #45 Reunión diagnóstico — bloqueado por #44
- #46 Cotizar actualiza el embudo (Cotizado automático + auto-creación con canal) — bloqueado por #42 y #43
- #47 Importación CSV Feria/Expo — bloqueado por #41
- #48 Importación Bitrix one-time — **HITL** (`ready-for-human`), bloqueado por #41 y #43

Ruta crítica: #41 → #43 → #44. Implementar con TDD (obligatorio en este repo).

## Contexto vigente que no perder

- Bot de calificación WhatsApp (#3 del análisis): diseñado a nivel concepto en `ANALISIS_AUTOMATIZACION_VENTAS.md`; depende del módulo de prospectos. Pendiente decidir número nuevo vs migrar el actual.
- operam-export sigue suspendido en Render hasta julio o hasta que haya pedidos de exportación.
- Los 6 cron-jobs de cron-job.org están inactivos (Adrián los desactivó); no reactivarlos por default.
- Cotizador en Render plan Starter, deploy verificado en producción; cotizaciones en Neon (`wandering-violet/neondb`, tabla `cotizaciones`).
