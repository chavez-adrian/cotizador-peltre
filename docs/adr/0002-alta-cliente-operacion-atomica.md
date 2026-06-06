# ADR-0002: El alta de cliente es una operación atómica para el vendedor

## Status

Accepted

## Context

El alta de cliente en Operam implica múltiples llamadas API independientes: crear el cliente, registrar contactos (General, Invoices, Deliveries), crear el domicilio de entrega y configurar almacén y cuenta de ventas. Ninguna de estas operaciones es transaccional en la API de Operam — cada una puede fallar independientemente.

## Decision

El alta de cliente es atómica desde la perspectiva del vendedor: no se reporta éxito hasta que todos los pasos han completado correctamente. Si cualquier paso falla, el vendedor ve el error específico y debe resolverlo antes de continuar.

No se usa fire-and-forget para ninguno de los pasos de alta. A diferencia de integraciones auxiliares (Dropbox), los contactos y el domicilio de entrega son datos operativos sin los cuales el cliente no puede usarse para cotizar, facturar o entregar.

Si el cliente ya fue creado en Operam pero un paso posterior falla, el sistema informa al vendedor qué paso falló y permite reintentar desde ese punto sin duplicar el cliente.

## Consequences

- El vendedor siempre termina el alta con un cliente completamente configurado o con un error claro que resolver.
- Requiere manejo de estado parcial: si el cliente se creó pero el domicilio falló, el sistema debe saber que el cliente ya existe y no intentar crearlo de nuevo al reintentar.
- La UX debe mostrar el progreso de los pasos para que el vendedor sepa en qué punto ocurrió el fallo.
- Adrián no necesita hacer QA de completitud del alta — solo de corrección comercial en la aprobación del pedido.
