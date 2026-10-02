# ADR-0021: La liga cotización-pedido es por documento; el cliente del registro no decide

## Status

Accepted (2026-10-01). Refina ADR-0005 (pipeline unificado) y el binding de #67. Origen: #506 ("Evaluación verificada", 2026-10-02) y su hijo #508.

## Context

El sync post-venta mueve una cotización por los hechos de SU pedido en Operam (#507). Ese pedido se encontraba a través del registro: se leían las transacciones del Cliente Operam o del RFC que guardaba la cotización, de ahí salía el `debtor_no`, con él se listaban los pedidos del cliente y entre ellos se buscaba el que traía el folio en `trans_no_from`.

Medido contra producción, ese camino perdía 12 pedidos que sí existen en Operam:

- Desde el rediseño del paso Cliente la mayoría de los registros guarda el Cliente Operam y ya no el RFC (50 de 81 cotizaciones en Seguimiento con folio); ninguna cotización sin RFC había sido ligada nunca.
- En dos casos el pedido está bajo OTRO Cliente Operam que el del registro (1186: registro 485, pedido 7414 del cliente 290; 1239: registro 499, pedido del 256): ni el Cliente Operam basta.
- Un RFC mal capturado (1169) o distinto del de Operam (1294) tampoco liga.
- Un cliente con pedido y todavía sin factura ni remisión no ligaba nunca: el `debtor_no` se deducía de transacciones que aún no existían.

El pedido, en cambio, sí dice de qué cotización nació: `trans_no_from` es el folio de la cotización de origen (peltre-operam.md §12.2).

## Decision

- **La liga cotización-pedido es por documento.** El pedido de una cotización se busca en el listado de pedidos de Operam por su documento de origen (`trans_no_from` = folio), **sin filtrar por el RFC ni por el Cliente Operam del registro**. La cadena (factura, remisión, pagos) se lee con el cliente DEL PEDIDO.
- `data.orderOperam` explícito conserva la prioridad: ancla la liga. Los pedidos hermanos del mismo documento entran a los hechos (un folio puede tener dos pedidos: 836, 861), y el principal no es uno de total cero habiendo otro con total.
- Una venta directa (`trans_no_from` vacío) nunca se liga.
- El listado se lee en una ventana que arranca 60 días antes de la fecha de la cotización (el pedido nace de ella; lo medido: la peor de 43 ligas reales tiene el pedido 3 días antes), con ritmo propio (una lectura cada 1.1 s, sin el throttle global) y compartido dentro de un lote.
- Existe la herramienta acotada: `POST /api/admin/cotizaciones/:id/reconciliar-operam` reconcilia UNA cotización, con modo en seco que responde el mismo plan sin escribir.

## Considered Options

- **Seguir por el registro, agregando el Cliente Operam al RFC.** Rechazada: deja fuera los dos pedidos que viven bajo otro Cliente Operam y sigue sin ligar el pedido sin transacciones.
- **Filtrar el listado por un parámetro de Operam.** El endpoint de pedidos no documenta un filtro por `trans_no_from`; la ventana por fecha es lo verificable.
- **Leer siempre los dos años.** Rechazada por costo: ~29 páginas por cotización contra una o dos para una reciente.

## Consequences

- El webhook y el barrido encuentran el pedido aunque el registro no tenga RFC; la selección de candidatas por RFC del webhook y de la ruta masiva queda como estaba y la cambian #509 y #510. Ligar en lote las 12 cotizaciones huérfanas es la reparación de datos de #511, fila por fila.
- Un pedido con fecha más de 60 días anterior a la cotización no se encuentra: no se ha visto, y sale como "sin pedido propio", nunca como liga equivocada.
- El cliente del registro deja de importar para el sync; si difiere del del pedido, esa discrepancia es dato, no criterio.
