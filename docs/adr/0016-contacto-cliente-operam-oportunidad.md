# ADR-0016: Contacto, Cliente Operam y Oportunidad son tres entidades distintas, y "cliente" nunca va a secas

## Status

Accepted (2026-09-06). Supersede parcialmente ADR-0005 (la oportunidad ya no "coincide con el prospecto" antes de cotizar) y renombra términos de ADR-0006 (Cliente genérico → Cliente Operam sin datos fiscales). Origen: issue #288.

## Context

El "duplicado" de Jorge Orea en la vista Clientes (la fila de Operam y la fila del prospecto como dos personas, aunque el prospecto ya estaba ligado al `customer_id` 514) no era un bug de fusión de filas: el sistema no distinguía a la **persona** de la **entidad legal**, y la palabra "cliente" nombraba tres cosas a la vez — el registro de Operam (con o sin pedido), la persona que nos compró, y el comprador de la tienda en línea. Ese mismo vacío producía las dos tarjetas de una misma persona en el tablero (la del prospecto inerte en Por Cotizar y la de su cotización en Seguimiento), y dejaba sin lugar al interés nuevo de alguien que ya conocíamos (el celular no podía volver a capturarse como prospecto).

Sesión de `grill-with-docs` + `domain-modeling` con Adrián, 2026-09-03 a 2026-09-06, con dos mediciones en vivo: la estructura de contactos y sucursales de Operam (478 clientes) y el cruce actual cotización ↔ prospecto (84 cotizaciones en Neon).

## Decision

**Tres entidades.**

- **Contacto** = un celular. La identidad ES el número (últimos 10 dígitos), sin excepciones: cambiar de número es otro Contacto (se funde a mano si hace falta); la línea compartida de una empresa es un solo Contacto. Etiquetas acumulativas que nunca se quitan: prospecto, cotizado, con pedido, Cliente en línea. El Origen es del Contacto y solo de él.
- **Cliente Operam** = un `customer_id`. Estado fiscal *Sin datos fiscales* / *Con datos fiscales* (el RFC genérico es un estado legítimo y permanente para quien no factura, no una espera). Estado comercial *sin actividad* / *cotizado* / *con pedido*, derivado de TODO lo que Operam registra (también lo anterior al cotizador) y nunca capturado a mano. "Razón Social" queda como atributo (nombre fiscal), no como entidad.
- **Oportunidad** = una intención de compra. Nace con la intención (captura de prospecto, o "Nueva oportunidad" desde la ficha de un Contacto), no con la cotización. Toda tarjeta del tablero, en toda etapa, es una Oportunidad. Nace ligada de forma fija a su Contacto (el celular se anota al nacer y no se recalcula del teléfono tecleado después) y se liga a un Cliente Operam al cotizar o al dar de alta; ninguna de las dos ligas se mueve.

**Palabras reservadas.** "Cliente" nunca va a secas: es Cliente Operam o Cliente en línea (término compuesto e indivisible; un comprador en línea que pide factura es además Cliente Operam con pedido, y las etiquetas conviven). "Ya compró" se dice *con pedido*. La persona registrada en Operam con rol es **Contacto en Operam**. Se retiran "Cliente genérico" (→ Cliente Operam sin datos fiscales), "Cliente Actual" como origen (→ Relación existente: Contacto nuevo que llega por una relación que ya tenemos) y "Ya es cliente, falta cotizar" (→ Ya tiene Cliente Operam, falta cotizar).

**Relaciones.** Contacto ↔ Cliente Operam es muchos a muchos. El cotizador guarda las ligas que él creó; las demás se derivan de Operam con una regla estructural: un celular que aparece en cualquiera de las **seis casillas** bajo un `customer_id` — Teléfono, Teléfono Secundario y Cel de cada Contacto en Operam; Teléfono y Cel de cada sucursal; el del propio registro — liga a ese Contacto con ese Cliente Operam. La casilla que la web etiqueta "Cel" viaja en la API como `fax`; el cotizador escribe ahí el celular al dar de alta. El 409 "el celular ya está ligado a otro cliente" deja de ser un bloqueo y pasa a ser una pregunta al vendedor.

**Migración del vínculo Oportunidad → Contacto**, una sola vez, sobre las 84 cotizaciones existentes: las 30 que hoy cruzan con un prospecto por teléfono reciben ese Contacto; las 14 con teléfono pero sin prospecto reciben un Contacto nuevo sin etiqueta prospecto (son Clientes Operam históricos); las 40 sin teléfono reciben un Contacto por respaldo automático en este orden: teléfono anotado en la cotización, y después el índice de Operam bajo su `customer_id` buscando primero Cel, luego Teléfono, luego Teléfono Secundario. Riesgo aceptado por el dueño: un teléfono de sucursal compartido puede colgar una Oportunidad vieja a otra persona.

## Considered Options

- **Identidad del Contacto = la persona (varios celulares)** en vez del celular. Rechazada: obliga a una entidad con id propio, tabla de fusiones y reglas de conflicto, cuando todo lo construido (índice de teléfonos, libreta de Google, herencia de Origen, dedup) descansa en `ultimos10`. El cambio de número es raro en mayoreo y se funde a mano.
- **Identidad de la entidad = RFC.** Rechazada: decenas de registros comparten `XAXX010101000`; con el RFC como identidad todos los sin datos fiscales serían la misma entidad. La identidad es el `customer_id` y "RFC real es único" es una invariante sobre el atributo (gate anti-fusión de #85).
- **"Cliente" = tiene alta en Operam.** Rechazada por el dueño: una entidad puede existir en Operam sin haber comprado nunca, y nadie llama cliente a quien solo pidió una cotización.
- **Nombre de la entidad: Entidad, Customer o Cliente Operam.** Se eligió Cliente Operam porque es la palabra de la pantalla de Operam, respeta las más de veinte entradas del glosario que ya usaban "cliente" con ese sentido (con Entidad/Customer todas quedaban contradictorias: "Cliente genérico" sería una entidad que no es cliente) y el precio es solo una regla de estilo: cliente siempre con apellido. Para "ya compró" se consideraron *convertido*, *activo*, *ganado* y *comprador*; el dueño eligió *con pedido*.
- **Oportunidad nace al cotizar y la tarjeta del Contacto sale del tablero** (propuesta original del issue). Rechazada: deja sin tarjeta el interés nuevo de un Contacto ya cotizado (el celular no puede recapturarse) y obliga a "prender y apagar" la tarjeta de la persona. Con la Oportunidad naciendo con la intención el tablero tiene una sola clase de tarjeta y el caso sale con un botón.
- **Dejar las 40 cotizaciones sin teléfono como "sin Contacto" visibles** en vez de asignar automático. Recomendación del agente, rechazada por el dueño a favor del respaldo automático con el riesgo anotado arriba.

## Consequences

- El glosario cambia de forma: Prospecto pasa de entidad a etiqueta; entran Contacto, Cliente Operam y Razón Social; se renombran Contacto de cliente, Cliente genérico y Prospecto convertido en cliente. Las entradas anteriores que dicen "cliente" a secas hablan del Cliente Operam y se corrigen conforme se tocan.
- La tabla `prospectos` guarda hoy dos cosas juntas (el Contacto y su primera Oportunidad) y hay que separarlas; la liga `data.cliente_id` pasa de singular a lista. Es la parte de más riesgo y va como ticket propio con la migración descrita arriba.
- Deuda inmediata y medible: el índice de teléfonos no lee la casilla Cel (`fax`) ni en personas ni en sucursales; 68 celulares de 65 Clientes Operam son invisibles hoy (382 cubiertos). Leerla y escribir el celular en Cel al dar de alta son el primer ticket.
- Tickets derivados: tablero solo de Oportunidades con "Nueva oportunidad"; buscador y vista Clientes por Contacto una sola vez; el 409 del celular ligado como pregunta; renombres de etiquetas y del origen; estado comercial del Cliente Operam derivado de quotes y pedidos (con el hueco aceptado de los quotes web no enumerables por la API). Nada de esto se implementa antes de que existan sus tickets.
- La clasificación de un celular y la precedencia de la libreta de Google (ADR-0013) siguen funcionando: solo cambia el nombre de lo que muestran (Cliente Operam en vez de "cliente").
