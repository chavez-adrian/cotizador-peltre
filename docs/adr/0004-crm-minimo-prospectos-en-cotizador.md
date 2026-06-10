# ADR-0004: CRM mínimo de prospectos dentro del cotizador en lugar de sincronizar con Bitrix24

## Status

Accepted (2026-06-10)

## Context

El análisis de automatización de ventas identificaba como punto #2 construir una sincronización Operam↔Bitrix24 (tabla de vínculos por ID + conciliación con bandeja) para mantener el CRM alineado con el ERP. Bitrix24 es hoy el CRM de prospectos, pero su uso real es bajo, vive desconectado del flujo donde los vendedores ya trabajan (el cotizador) y la sincronización sería infraestructura permanente al servicio de una herramienta que se usa poco.

## Decision

No se construye el sync Operam↔Bitrix24. En su lugar, se construye un módulo de prospectos dentro del cotizador — un CRM mínimo — como experimento de 4–6 semanas para abandonar Bitrix24.

El módulo implementa el modelo documentado en `CONTEXT.md`: prospecto identificado por celular (1 celular = 1 prospecto), etapas Nuevo → Contactado → Calificado → Cotizado con salida No útil, transición automática a Cotizado al ligarse una cotización (con auto-creación de prospecto pidiendo canal cuando el celular es nuevo), cadencia en horas hábiles con semáforo por canal, captura mínima desde el teléfono y visibilidad por vendedor (admin ve todo).

Los prospectos vivos de Bitrix se importan una sola vez (deduplicando por celular, descartando los que no tengan celular válido); Bitrix queda en solo-lectura durante el experimento.

## Consequences

- El vendedor opera todo el flujo comercial en una sola herramienta: prospecto → cotización → cliente → pedido. El celular es la llave que une prospecto y cotización.
- El bot de calificación por WhatsApp (punto #3 del análisis) depende de este módulo — deposita prospectos aquí. No puede construirse antes.
- Sin sync, no hay entidad espejo que conciliar: el guardrail "cliente Operam nunca regresa a prospecto" se resuelve con un índice local de teléfonos (best effort, últimos 10 dígitos) en lugar de infraestructura de sincronización.
- Si el experimento falla y se regresa a Bitrix24, el diseño del sync descartado quedó documentado en `ANALISIS_AUTOMATIZACION_VENTAS.md` para retomarse.
- El costo aceptado: el cotizador deja de ser solo cotizador y absorbe responsabilidad de CRM, creciendo el monolito (`server.js` + `app.js`).
