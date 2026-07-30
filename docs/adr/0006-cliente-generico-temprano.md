# ADR-0006: Subida automática de cotizaciones y alta temprana de cliente genérico (supersede parcialmente ADR-0005)

## Status

Accepted (2026-07-06)

## Context

Con el pipeline unificado (ADR-0005), la pre-cotización quedó definida como un modo de trabajo legítimo: cotizar con Prospecto Mínimo, sin registro en Operam ni Cliente Genérico, y formalizar después ("completar después" desde la tarjeta). Esto dejaba dos costos sin resolver:

- Lo que el equipo de ventas cotiza no es visible en Operam hasta que alguien formaliza manualmente. Operam deja de ser la fuente única de información comercial mientras una cotización permanece en PRE.
- La formalización manual es un paso extra que depende de que el vendedor regrese a la tarjeta; en la práctica se posterga o se olvida, y el folio de Operam queda ausente indefinidamente.

El PRD del issue #79 encarga resolver esto para todas las cotizaciones nuevas. Este ADR documenta la decisión tomada por el dueño el 2026-07-06.

## Decision

**Toda cotización generada (PDF/HTML/WhatsApp) se sube automáticamente a Operam al generarla**, sin botón manual. Driver: visibilidad de lo que cotiza el equipo de ventas y Operam como fuente única robusta de información comercial.

**Si la oportunidad no tiene cliente en Operam**, el servidor crea primero un cliente REAL con RFC genérico (`XAXX010101000` nacional, `XEXX010101000` extranjero) con nombre real del contacto y vendedor real, y luego sube la cotización a su nombre — operación atómica server-side, mismo precedente de ADR-0002 (el vendedor no ve éxito parcial). **Nunca se reasigna una cotización**: nace a nombre correcto. El RFC genérico ES el marcador de "pendiente de datos fiscales"; no se usa segmento especial ni cliente placeholder.

**La pre-cotización deja de ser un modo de trabajo.** Queda solo como estado de excepción: folio ausente únicamente cuando Operam falló al generar la cotización (caída de red, error de API), con reintento idempotente sobre el mismo intento. Esto supersede parcialmente ADR-0005 y la entrada "Pre-cotización" de CONTEXT.md, que modelaban PRE como un modo elegido ("cotizar sin fricción con el cliente enfrente", "no usa Cliente Genérico") con formalización manual posterior.

**La CSF es un upgrade, nunca un alta.** Al llegar la Constancia de Situación Fiscal se hace `PUT` sobre el cliente genérico existente (RFC real, razón social, régimen, domicilio fiscal), no un `POST` nuevo. Gate anti-fusión: si el RFC real ya existe en Operam con otro cliente, el sistema frena y avisa (fusión manual, no automática). Verificación post-`PUT` por el quirk ya documentado de Operam (200 que ignora campos en silencio — ver `CLAUDE.md`, cliente 457).

**Certeza contra duplicados**, en capas:
1. Celular contra la base propia (prospectos): invariante 1 celular = 1 prospecto, más registro de altas en Neon con mapeo celular → `customer_id`.
2. Nombre normalizado contra Operam (ADR-0001), sin escape para el vendedor.
3. RFC exacto en el momento del upgrade de CSF.

El momento de creación del cliente genérico es la **primera cotización generada**, nunca la captura del contacto: los prospectos que no cotizan no entran a Operam.

**Higiene**: reporte admin de clientes con RFC genérico sin actividad (≥6 meses) como candidatos a inactivación manual en Operam. Verificado por el dueño: Operam acepta múltiples clientes con el mismo RFC genérico, así que la acumulación no es un error de integridad sino un costo operativo a vigilar.

### Alternativa descartada

Crear las cotizaciones a nombre de un cliente placeholder único ("GENERICO TIENDAS DIGITALES") y reasignarlas al cliente real cuando llegaran los datos fiscales. Se descartó porque:

- (a) Dependía de editar/reasignar cotizaciones vía API de Operam, capacidad no verificada — y la API es débil justo en esa zona (el estado de cancelación ni siquiera es visible por API; ver `lib/operam-web.js`, issue #76).
- (b) Riesgo operativo de que un pedido o remisión saliera a nombre del placeholder si nadie ejecutaba la reasignación a tiempo.
- (c) Contaminación de estadísticas por cliente y por vendedor en Operam, al concentrar todo el volumen de "pendientes de datos fiscales" en una sola cuenta.

Invertir qué es genérico (el RFC, no el cliente) elimina toda necesidad de reasignación: cada cliente genérico es un cliente real y distinto desde el origen.

## Consequences

- Operam refleja en tiempo real lo que el equipo de ventas cotiza, sin paso de formalización manual ni cotizaciones invisibles fuera de Operam.
- El vendedor deja de tener un paso extra ("completar después"); la carga se mueve al servidor en el momento de generar la cotización.
- La distinción PRE / "#Operam N" en la tarjeta se conserva pero cambia de significado: PRE pasa de ser un modo elegido a ser una falla transitoria con reintento, y debería ser rara en operación normal.
- El corte histórico de #63 (cotizaciones sin folio previas a esa fecha se asumen registradas, no PRE) sigue vigente sin cambios — sigue discriminando por fecha de despliegue, no por el nuevo criterio de excepción.
- Costo real: clientes genéricos se acumulan en Operam aunque la venta muera después de la primera cotización (nunca se limpian automáticamente; dependen del reporte de higiene y de inactivación manual).
- Costo real: la subida automática crea el cliente en Operam aunque la oportunidad nunca vuelva a avanzar — a diferencia del modelo anterior, donde una pre-cotización sin formalizar no dejaba rastro en Operam.
- Dependencia crítica: la garantía de deduplicación por celular solo cubre altas hechas por el cotizador. Un alta manual genérica hecha directo en la UI de Operam (fuera del cotizador) queda fuera de esa garantía y puede introducir un duplicado que el sistema no detecta.
- El upgrade de CSF requiere el gate anti-fusión y la verificación post-`PUT`; ambos son pasos adicionales de robustez que no existían cuando el alta con datos fiscales completos ocurría una sola vez (sin RFC genérico previo).
