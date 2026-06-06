# ADR-0001: Estrategia de deduplicación para clientes con RFC genérico

## Status

Accepted

## Context

Múltiples clientes pueden compartir el mismo RFC genérico (`XAXX010101000` para nacionales sin RFC, `XEXX010101000` para extranjeros). El RFC no sirve como llave de deduplicación en estos casos. Han ocurrido duplicados en Operam, lo que fragmenta el historial del cliente.

## Decision

Para clientes con RFC genérico, la deduplicación opera en dos fases:

**Fase 1 — Coincidencia por nombre normalizado:**
Antes de crear el cliente, buscar en Operam clientes con el mismo RFC genérico y comparar sus nombres (CustName y cust_ref) contra el nombre nuevo. La normalización elimina: acentos, puntuación, artículos (el, la, los, las, del), preposiciones (de, y, e) y sufijos corporativos (sa de cv, sapi de cv, s de rl de cv, sc, ac). Si hay coincidencia de tokens significativa, se considera posible duplicado.

**Fase 2 — Selección de cliente existente o nuevo domicilio:**
Si hay coincidencia de nombre, el vendedor **no puede crear ni forzar la creación**. El sistema muestra los candidatos existentes. El vendedor debe elegir uno de ellos. Al elegir un cliente existente, el sistema muestra sus domicilios de entrega actuales para que el vendedor seleccione uno o cree uno nuevo. Esto resuelve tanto el caso de duplicado real como el de nueva sucursal de un cliente existente.

## Consequences

- Previene duplicados por RFC genérico sin permitir que el vendedor los ignore o fuerce.
- Resuelve el caso de nueva sucursal de cliente existente sin crear un cliente duplicado.
- Si los candidatos mostrados genuinamente no corresponden al cliente nuevo (falso positivo de nombre), el vendedor no tiene escape — deberá escalar a Adrián para que cree el cliente directamente en Operam. Este caso se considera suficientemente raro para aceptar esta fricción.
- No aplica para clientes con RFC real, donde la deduplicación sigue siendo por RFC exacto.
