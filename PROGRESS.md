# PROGRESS — sesión 2026-06-10 (cortada por límite de tokens)

## Qué se estaba haciendo y por qué

Sesión de grilling (`/grill-with-docs`) para el **módulo de prospectos** del cotizador — el CRM mínimo que reemplazará a Bitrix24 como experimento de 4–6 semanas en paralelo. Flujo acordado con Adrián: `/grill-with-docs` → `/to-prd` → `/to-issues`, y después implementar.

Contexto completo del día (todo terminado y en producción): ver `ANALISIS_AUTOMATIZACION_VENTAS.md` sección "Avance de implementación" — seguimiento de cotizaciones (cola día 2/7/21/vencida), bloqueo duro de teléfono con código de país, migración de cotizaciones a Neon (`wandering-violet/neondb`, tabla `cotizaciones`, 49 migradas), cotizador en Render plan Starter (deploy `f0d92dd` live, verificado en producción), cron-jobs de keepalive desactivados por Adrián.

## Estado exacto del grilling

Las decisiones resueltas YA ESTÁN ESCRITAS en `CONTEXT.md` (glosario actualizado inline durante la sesión — leerlo es obligatorio antes de continuar). Resumen de lo resuelto:

1. **Prospecto** = persona/entidad detrás del celular; 1 celular = 1 prospecto; sin entidad "oportunidad" (las cotizaciones ligadas son las oportunidades).
2. **Cliente Operam nunca regresa a prospecto** — guardrail al capturar celular de cliente existente (verificado contra API real: en Operam los teléfonos viven en `contacts[].phone` Y `branches[].phone`, inconsistentes; match por últimos 10 dígitos; requiere índice local de teléfonos).
3. **Etapas:** Nuevo → Contactado → Calificado → Cotizado (automática al ligarse cotización por celular; releva el seguimiento) + salida No útil con motivo obligatorio. Asignación = quien captura atiende; proceso de asignación es evolución futura.
4. **Reunión diagnóstico** = actividad con fecha, NO etapa; suprime cadencia mientras es futura; al pasar pide registrar resultado.
5. **Cadencia en horas hábiles** (L–V 7:30–16:30, sáb 7:30–13:00, festivos MX excluidos); etiqueta semáforo "X h hábiles sin respuesta" (verde <2, ámbar 2–8, rojo >8); WhatsApp/IG corren en horas, correo/formulario toleran más; 3 toques sin respuesta → sugerir No útil (nunca automático).
6. **Captura:** obligatorios celular + nombre (sin apellido OK) + ciudad (para estimar envío) + canal. Canales: WhatsApp, Instagram, Facebook/Messenger, Meta Ads (pagado ≠ orgánico), Formulario web, Correo, Referido, Bazar Sábado, Feria/Expo (este último por importación CSV de gafetes escaneados, dedup por celular).

## Pregunta PENDIENTE de respuesta (retomar aquí)

**Pregunta 6:** cotización creada directo sin prospecto previo (celular no matchea prospecto ni cliente Operam) — ¿auto-crear prospecto en etapa Cotizado con canal "Directo"? Recomendación dada: **sí (opción b)** — embudo completo sin disciplina extra; costo aceptado: se pierde el canal real de origen. **Adrián no había respondido aún.**

## Preguntas que faltaban después de la 6

7. Visibilidad: ¿cada vendedor ve solo sus prospectos y admin todo (igual que cotizaciones)? (recomendación: sí, mismo modelo)
8. Histórico de Bitrix: ¿importar los prospectos vivos (vía REST/CSV de Bitrix) o empezar de cero?
9. Ofrecer **ADR 0004**: "CRM mínimo de prospectos dentro del cotizador en lugar de sincronizar con Bitrix24" — cumple los 3 criterios (difícil de revertir, sorprendente sin contexto, trade-off real). Redactarlo al cerrar el grilling.

## Siguiente acción exacta al retomar

1. Leer `CONTEXT.md`, este archivo y `ANALISIS_AUTOMATIZACION_VENTAS.md`.
2. Re-hacer la Pregunta 6 a Adrián (texto arriba) y continuar con 7, 8 y el ADR 0004.
3. Al terminar el grilling: `/to-prd` (PRD del módulo de prospectos) → `/to-issues` (issues en `chavez-adrian/cotizador-peltre`).
4. Implementar con TDD (obligatorio en este repo).

## Decisiones/contexto extra descubiertos hoy (no perder)

- El bot de calificación WhatsApp (#3 del análisis) está diseñado a nivel concepto en `ANALISIS_AUTOMATIZACION_VENTAS.md` y en la conversación: Cloud API de Meta directo (sin Wazzup), receptor = cotizador Starter, Claude Haiku con tools (guardar_prospecto/enviar_catalogo/escalar_a_humano), no cotiza ni negocia, handoff limpio. Pendiente decidir: número nuevo dedicado vs migrar el actual. El módulo de prospectos es prerequisito (el bot deposita ahí).
- Decisión estratégica: NO construir sync Operam↔Bitrix24 (era el punto #2 del análisis); en su lugar el módulo de prospectos como experimento para abandonar Bitrix. Si el experimento falla, el diseño del sync (tabla de vínculos por ID + conciliación con bandeja) quedó descrito en la conversación y en el análisis.
- operam-export sigue suspendido en Render hasta julio o hasta decisión (si hay pedidos de exportación antes, subirlo a Starter o correr local).
- Los 6 cron-jobs de cron-job.org están inactivos (Adrián los desactivó); no reactivarlos por default.
