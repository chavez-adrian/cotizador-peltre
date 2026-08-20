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

## Nota 2026-08-19 (issue #204): el umbral sube a 2 tokens y la Fase 2 SÍ tiene escape

Lo anterior queda como está: es la decisión que se tomó y con la que se construyó el flujo. Esto es lo que cambió al ejercerla por primera vez contra datos reales.

Hasta el arreglo de #194, el pool de clientes con RFC genérico llegaba **vacío** (el `?search=` de Operam no indexa el RFC), así que la Fase 1 nunca comparó contra un candidato real. Con el pool completo (~78 clientes) aparecieron dos cosas que la decisión original no podía haber previsto:

1. **"Coincidencia de tokens significativa" estaba implementada como UN token.** Una sola palabra compartida —un nombre de pila, un apellido común— marcaba candidato. En la auditoría de las ~104 fichas comerciales de genéricos el umbral de 1 token dio **0/23 aciertos**: todos falsos positivos. El umbral pasa a **2 tokens compartidos**, salvo que el nombre capturado tenga un solo token útil tras normalizar, donde basta 1 (si no, la dedup queda ciega para nombres de una palabra). El match por **teléfono** no cambia: sigue siendo señal fuerte independiente y marca candidato por sí solo (fue lo único que detectó el duplicado real "Siscani", #78).

2. **La fricción de la Fase 2 dejó de ser aceptable.** La consecuencia asumida arriba ("el vendedor no tiene escape — deberá escalar a Adrián") se apoyaba en que el falso positivo fuera raro. Con el umbral viejo era lo normal, y el precio no era esperar a Adrián: era que la cotización saliera como **PRE-COTIZACIÓN sin folio** delante del cliente. Adrián revierte esa parte de la decisión: la lista de candidatos de la subida de cotización ofrece **"Ninguno es el mismo cliente - crear nuevo"**, que reintenta con `{ crearNuevo: true }`.

El escape salta **solo** la parada por nombre similar. Siguen intactas la reutilización del cliente por celular de un prospecto ya convertido y las guardas del `customerId` contradictorio. Cada creación forzada queda en `clientes_log` con resultado `creado-forzado` y el detalle de los candidatos que se descartaron, para que el reporte de higiene (#86) pueda revisarla después.

El alta completa ya ofrecía su propia salida equivalente ("Ninguno es el mismo cliente - escalar a Adrián"); esta nota alinea el camino de la subida de cotización con ese patrón.
