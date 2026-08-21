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

### Ajuste del mismo día: ante candidatos ya no hay "Dejar como PRE"

Tras lo anterior se revisó la política completa de deduplicación (investigación de industria + consenso multi-agente). El umbral de 2 tokens y el escape "crear nuevo" **se confirman tal cual**. Lo que cambia es la tercera salida, que hasta ahora existía por inercia.

La lista de candidatos ofrecía también **"Dejar como PRE"**, y esa era la peor opción disponible: dejaba al vendedor con un documento entregable *y* el posible duplicado sin resolver, que es exactamente el desenlace que la deduplicación existe para evitar. Se elimina. Ante candidatos hay **dos** salidas y ninguna es cómoda: elegir el cliente correcto, o declarar que ninguno lo es. El vendedor resuelve o el registro muere.

Se descartó explícitamente un bloqueo duro adicional por nombre "casi exacto" o por contención de tokens: el único STOP absoluto sigue siendo el RFC real exacto, que no es parte de este cambio.

Consecuencias:

- **Motivo del PRE persistido** (`data.motivoPre`, con `data.motivoPreDesde`): `'dedup'` cuando la subida terminó en candidatos sin resolver, `'operam'` cuando falló por error o timeout del ERP. Se limpia en cuanto hay folio, por cualquiera de los caminos. Los dos motivos tienen consecuencias opuestas y por eso hay que distinguirlos: con `'operam'` el documento sale igual, sin número (ADR-0009).
- **Candado del documento**: mientras el motivo sea `'dedup'`, los `GET /api/cotizacion/pdf/:id` y `/html/:id` no regeneran nada y responden un aviso. El candado vive ahí y no en la interfaz porque esas rutas van **sin auth** (se comparten por WhatsApp): apagar botones no cerraría el link. En la interfaz, Ver PDF / Ver HTML / WhatsApp aparecen deshabilitados con el motivo mientras dure.
- **Barrido a las 24 horas**: al arrancar el servidor y cada hora se borran las cotizaciones con motivo `'dedup'` de más de 24 horas. Sólo ésas: las `'operam'` nunca se tocan, y una que ya obtenga folio tampoco (aunque el flag quedara sucio). Se borra la cotización; **el prospecto se queda**, porque la oportunidad sigue viva — lo que se tira es el intento de documento.

El barrido corre en memoria y asume **una sola instancia** de Node, como el lock de subidas y la cola de post-fixes de vigencia (ver `CLAUDE.md`, Deploy). Es idempotente, así que con varias instancias el peor caso sería trabajo repetido.

## Nota 2026-08-21 (issue #244): el pool de la Fase 1 son los DOS genéricos, no "el mismo"

La Fase 1 dice arriba "buscar en Operam clientes con **el mismo RFC genérico**". Eso queda derogado: el pool pasa a ser la **unión de `XAXX010101000` y `XEXX010101000`**, deduplicada por `customer_id`.

El motivo es el propio Context de este ADR: *el RFC no sirve como llave de deduplicación en estos casos*. Si el RFC genérico no identifica, tampoco puede **particionar** — y eso es exactamente lo que hacía "el mismo RFC genérico". Cuál de los dos comodines le tocó a un cliente no es un atributo suyo: es el país que capturó quien lo dio de alta, un dato distinto en cada captura y del que ni siquiera se sabe si era correcto. Partir el universo por ahí es darle valor de llave a un no-dato, y deja ciega la mitad del universo en cada consulta.

**Cómo se destapó.** Cotización con cliente `CUMBIARCA SA` (nombre corto "Studio Iken", entrega en Panamá), elegido por "Ya lo conozco". El cliente ya existía en Operam bajo `XEXX010101000`. La cotización preguntó por `XAXX010101000` — porque el país queda siempre en `MX` al elegir un cliente de Operam (`pcLimpiarCamposCliente` lo resetea, `seleccionarClienteOperam` no lo toca y `GET /api/operam/clientes` ni siquiera devuelve el país). Veredicto `libre`, no se mostró el picker, se intentó crear, y lo único que frenó el duplicado fue la unicidad global del `cust_ref` en Operam con un **406 sin salida**: reintentar daba lo mismo y elegir el candidato correcto era imposible porque el candidato no estaba en la lista.

Medido en vivo el 2026-08-21: pool `XEXX` = 34 clientes (incluye al de este caso), pool `XAXX` = 82 (no lo incluye).

**Consecuencias:**

- **`rfcGenericoDe(cliente)`** (`lib/alta-generica.js`) resuelve el genérico que le corresponde a un cliente: **el RFC capturado si ya es genérico**, y sólo a falta de él se deriva del país. El RFC capturado es un hecho; el país, una inferencia. Decide el `tax_id` con el que se crearía el cliente y el genérico que se reporta al log — no el pool, que ya no se particiona.
- El filtro de la rama genérica de `detectarDuplicados` compara **pertenencia** a `RFC_GENERICOS`, no igualdad con el RFC de entrada. Sin esto la unión sería un no-op: los candidatos del otro genérico se descartaban en silencio.
- Sigue siendo **sólo entre genéricos**. Un cliente con RFC real jamás entra como candidato de un genérico: ése está identificado y su dedup es la del RFC exacto, que no cambia.
- El umbral de 2 tokens (#204) es lo que acota el ruido del pool más grande, y no se toca. Un nombre sin tokens útiles sigue sin producir candidatos.
- Cuesta una lectura paginada extra a Operam por verificación, y la revalidación del candidato elegido (#208) la repite. Es el precio de no volver a tener medio universo invisible.
- **Queda abierto** que el país del cliente elegido siga llegando mal: esta nota lo neutraliza para la deduplicación, no lo arregla. Sigue afectando el envío y la clasificación fiscal del domicilio — en particular, "es sucursal de este cliente" (#211) sobre un cliente extranjero crea la sucursal como gravada en vez de exportación.

## Nota 2026-08-21 (issue #242): el `cust_ref` entra a la Fase 1, y ése sí cruza el RFC

Toda esta decisión compara **nombres**. Operam además exige que el `cust_ref` (nombre corto) sea **único en todo el padrón**, sin importar el RFC: crear un cliente con uno ya usado responde `406 Already exists customer with same cust_ref` (medido en vivo 2026-08-21). El cotizador escribe ahí el nombre corto capturado (`buildClienteGenerico`), así que un nombre corto repetido mataba el alta — y la Fase 1, acotada a los genéricos, no podía ni ver al dueño cuando éste tenía RFC real. Veredicto `libre`, POST, 406; y con el escape de #204 ("ninguno es el mismo cliente"), el mismo 406. Reintentar daba exactamente lo mismo: sin salida.

Se agrega a la Fase 1 una segunda búsqueda, en paralelo a la de nombre: el **`cust_ref` exacto** del nombre corto capturado contra el padrón COMPLETO de Operam (la caché de `indice-telefonos.js`), **sin filtrar por RFC**. Un acierto entra a la misma lista de candidatos, marcado, y el picker muestra su razón social y su RFC.

Es una **excepción deliberada** a "un cliente con RFC real jamás entra como candidato de un genérico" (nota de #244). La razón: aquí no se infiere un parecido, se constata un hecho duro — Operam **no dejará** crear ese cliente. Y es el único camino que puede *descubrir* que el cliente ya existía bajo un RFC real, en vez de sólo evitar el choque. La comparación es con trim y sin distinguir mayúsculas; no se pudo medir si la unicidad de Operam es case-sensitive, y el supuesto conservador es el que pregunta de más.

Si aun así el POST choca (caché fría, Operam caído, o el vendedor forzó "crear nuevo"), el 406 deja de ser un callejón: la ruta responde `409 { codigo: 'CUST_REF_DUPLICADO', nombreCorto }` con un texto que le pide al vendedor cambiar el nombre corto, nombrando al dueño cuando el padrón alcanza a verlo. **No** se desambigua el `cust_ref` con un sufijo automático: eso escondería justo el hallazgo — que el cliente ya existía.

Consecuencia conocida: si el nombre corto es genuinamente de otro cliente (homónimo real), el vendedor tiene que cambiarlo. Desde el historial una cotización PRE no ofrece "Editar" (el gate `puedeActualizarCotizacion` exige folio), así que el camino es corregir el campo en la sesión viva y volver a generar, o "Copiar cotización".
