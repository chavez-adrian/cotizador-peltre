# PROGRESS — módulo de prospectos (actualizado 2026-06-10, sesión 2)

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

1. `/to-issues` — descomponer el PRD (issue #40) en issues implementables en `chavez-adrian/cotizador-peltre`.
2. Implementar con TDD (obligatorio en este repo).

## Contexto vigente que no perder

- Bot de calificación WhatsApp (#3 del análisis): diseñado a nivel concepto en `ANALISIS_AUTOMATIZACION_VENTAS.md`; depende del módulo de prospectos. Pendiente decidir número nuevo vs migrar el actual.
- operam-export sigue suspendido en Render hasta julio o hasta que haya pedidos de exportación.
- Los 6 cron-jobs de cron-job.org están inactivos (Adrián los desactivó); no reactivarlos por default.
- Cotizador en Render plan Starter, deploy verificado en producción; cotizaciones en Neon (`wandering-violet/neondb`, tabla `cotizaciones`).
