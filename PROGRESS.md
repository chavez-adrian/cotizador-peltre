# PROGRESS — módulo de prospectos (actualizado 2026-06-10, sesión 3)

## ESTADO (sesión 3, cierre)

**#41 y #43 TERMINADOS: demo aprobada, mergeados a main (deploy automático a Render) y cerrados.**

#41 incluyó además: ajustes de demo (banderas país, opcionales visibles, labels, temperatura en estrellas), corrección del catálogo de SEGMENTOS a los ids internos reales de Operam (la clave 000-1000 de la UI NO es el id de la API; verificado contra producción) y corrección de los 2 clientes afectados (456 vía API, 457 vía UI por quirk de Operam documentado en CLAUDE.md).

#43: etapas manuales un-paso (validarTransicion compartida frontend/server), toques con fecha/autor, No útil con catálogo obligatorio, historial en eventos JSONB (migración ALTER TABLE auto en ensureSchema), conteo admin de motivos. Suite 327/327.

**Deuda acumulada (findings menores de reviews #41+#43, atacar al tocar esos archivos):** leerJson/escribirJson/filaAEntrada y bloques fallback JSON duplicados entre stores y dentro de prospectos-store; ensureSchema cachea promise rechazada; temperatura/segmento_id como strings; showProspectos no oculta otras vistas; retorno de cambiarEtapa/registrarEvento sin verificar en rutas (carrera inalcanzable hoy — no hay borrado); buildWaLink duplica telefonoWa.

**Notas de diseño para #45/#46:** extraer un builder de eventos cuando se agreguen tipos nuevos (hoy inline en la ruta PATCH etapa); el flag `activo` de la card excluye `cotizado` — #45 lo tendrá que revisar.

**Siguiente:** desbloqueados #42 (frenos de frontera), #44 (cola/semáforo en horas hábiles), #47 (CSV feria) y #48 (Bitrix, HITL). Recomendación: #44 — completa la ruta crítica y es donde el módulo empieza a vender. Esperar confirmación de Adrián. Idea de Adrián sin issue aún: kanban estilo Bitrix (prospectos con #44; cotizaciones = issue nuevo).

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
