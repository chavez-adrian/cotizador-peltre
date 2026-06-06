# ADR-0002: El alta de cliente es una operación atómica para el vendedor

## Status

Accepted

## Context

El alta de cliente en Operam implica múltiples llamadas API independientes: crear el cliente, obtener el branch auto-creado y configurar su domicilio de entrega. Ninguna de estas operaciones es transaccional en la API de Operam — cada una puede fallar independientemente.

Verificado empíricamente el 2026-06-06: Operam auto-crea un branch por defecto al ejecutar `POST /api/v3/sales/customers` ("Una sucursal por defecto ha sido creada automaticamente"). No existe `POST /api/v3/sales/branches` como operación de alta — el branch ya existe y solo necesita configurarse vía PUT.

## Decision

El alta de cliente es atómica desde la perspectiva del vendedor: no se reporta éxito hasta que todos los pasos han completado correctamente. Si cualquier paso falla, el vendedor ve el error específico y debe resolverlo antes de continuar.

**Flujo correcto:**

```
1. POST /api/v3/sales/customers
   → Operam auto-crea branch; respuesta incluye customer_id

2. GET /api/v3/sales/customers/{customer_id}
   → Recuperar branch_id (campo branch_code en la respuesta)

3. PUT /api/v3/sales/branches/{branch_id}
   → Configurar domicilio: br_name (required), br_ref (required),
     tax_group_id (1=MX / 2=extranjero), location: 40 (entero),
     ship_via: 1 (entero), addr_*, phone, email, area, salesman
   → NO enviar sales_account — Operam lo deriva del tax_group_id
```

No se usa fire-and-forget para ninguno de estos pasos. A diferencia de integraciones auxiliares (Dropbox), el branch es operativo: sin él no se puede facturar ni entregar.

Si el cliente ya fue creado en Operam pero el PUT del branch falló, el sistema informa al vendedor qué paso falló y permite reintentar desde ese punto sin duplicar el cliente.

## Consequences

- El vendedor siempre termina el alta con un cliente completamente configurado o con un error claro que resolver.
- Requiere manejo de estado parcial: si el cliente se creó pero el PUT del branch falló, el sistema debe saber que el customer_id y branch_id ya existen y no intentar crear el cliente de nuevo al reintentar.
- La UX debe mostrar el progreso de los pasos (POST → GET → PUT) para que el vendedor sepa en qué punto ocurrió el fallo.
- Adrián no necesita hacer QA de completitud del alta — solo de corrección comercial en la aprobación del pedido.
- Los contactos adicionales (Invoices, Deliveries) y el campo Celular no son configurables vía API v3 (POST /contacts → 501; PUT /customers con contacts → ignorado). Permanecen como pasos manuales del SOP posterior al alta automatizada.
