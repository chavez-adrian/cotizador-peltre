# ADR-0009: El folio de Operam es el número de la cotización (subir antes de generar)

- **Estado:** Aprobado (2026-07-28). Decisión de Adrián.
- **Issues:** #111 (decisión y alcance), #110 (el PDF hoy no imprime ningún número), #109 (el aviso del modo actualización nombraba el id interno).
- **Antecedentes:** ADR-0006 / #83 (toda cotización generada se auto-sube a Operam), #63 (folio nullable = pre-cotización), #103 (los GET de PDF/HTML regeneran desde `data`), ADR-0008 / #104 (actualizar conservando folio).

## Contexto

El cotizador maneja hoy **dos numeraciones** para la misma cosa:

- el **id interno** del registro (secuencial del cotizador: 16, 17, 18…), y
- el **folio del quote en Operam** (1199, 1200…), que es el número que existe en el ERP, el que ve producción y el que el cliente acabará escuchando por teléfono.

Ninguna de las dos se presenta de forma consistente. Estado verificado el 2026-07-28:

- El **HTML** que se comparte por WhatsApp imprime el **id interno** (`Cotizacion #16`).
- El **PDF no imprime ningún número**: el generador sabe pintar `No. Cotizacion: N`, pero ni el POST que crea el documento ni el GET que lo regenera desde el registro le pasan el id. Comprobado ejecutando el generador (con id el número aparece en el buffer; sin id, no).
- El aviso del modo actualización mezclaba ambos mundos en una frase — "se actualizará la cotización **#16** y su quote en Operam (mismo folio)" — que se lee como si 16 fuera el folio. Fue el síntoma que destapó todo esto durante la verificación de #104.

El problema de fondo no es cosmético. Un cliente con dos cotizaciones nuestras puede tener un documento sin número y otro numerado con una secuencia que Operam desconoce, y ni el vendedor ni producción pueden cruzarlos sin abrir el ERP.

### Por qué no basta con "imprimir el id interno también en el PDF"

Porque perpetúa la numeración doble. Y porque el orden actual del flujo impide imprimir el folio: la cotización se **genera primero** y se **sube a Operam después**, de forma asíncrona (#83). Cuando el PDF ya se descargó, el folio todavía no existe.

## Decisión

**El número de la cotización es el folio de Operam.** El id interno deja de presentarse como "cotización #N" y queda como clave técnica del registro.

**Para que eso sea posible se invierte el orden de la generación: primero se sube a Operam, luego se genera el documento con el folio ya asignado.**

### Flujo nuevo

1. Se guarda/actualiza el registro del cotizador (como hoy: es lo que da el `cotizacionId`).
2. Se sube la cotización a Operam y se espera el folio.
3. Se genera el documento **ya con el folio** y se entrega al vendedor.

En **modo actualización** (ADR-0008) no hay inversión que hacer: el folio ya existe por el gate de `puedeActualizarCotizacion`, así que el documento se genera directamente con él.

### Fallback obligatorio: Operam no puede bloquear la entrega del documento

Si la subida falla o no responde, **el documento se entrega igual, sin número, marcado como pre-cotización** — el estado PRE de #63 y el botón de Reintentar de #83 ya existen y son exactamente esta situación. Lo que se pierde es el número, nunca el documento.

Una vez que el folio llega (por el reintento o por la subida diferida), **el documento correcto se obtiene re-compartiendo desde el historial**: gracias a #103 los GET de PDF/HTML regeneran desde `data`, así que recogen el folio sin que nadie regenere nada a mano.

### Las pre-cotizaciones no inventan número

Una PRE no tiene folio por definición. Su documento no muestra número y se identifica como pre-cotización. Nunca se le pone el id interno disfrazado de folio: sería volver a la numeración doble por la puerta de atrás.

## Consecuencias

- **El vendedor espera.** Generar deja de ser instantáneo: ahora incluye el viaje a Operam (que además puede incluir el alta del cliente genérico, #81/#83). La UI debe mostrar el progreso real ("Subiendo a Operam…" → "Generando documento…"), no un spinner mudo. Es el costo consciente de que el documento nazca con el número bueno.
- **Se invierte una decisión de #83.** Ahí la subida se hizo asíncrona *a propósito*, para no bloquear la entrega del PDF. Este ADR mantiene esa garantía por otra vía: la subida ya no bloquea porque falle, sino que su fallo degrada a PRE.
- **El nombre del archivo descargado** pasa a usar el folio; sin folio, cae a un nombre de pre-cotización.
- **La ventana de doble numeración es real y hay que cruzarla de golpe.** Los documentos ya enviados con id interno seguirán circulando. Por eso #110 (que el PDF imprima número) **no debe desplegarse solo**: si sale antes que este cambio, los clientes reciben una tanda numerada con id interno que después cambia de secuencia. #110 y #111 se liberan juntos.
- **El lock de subidas** (`subidasOperamEnCurso`, en memoria, instancia única de Render) pasa a estar en la ruta crítica de la generación, no en un camino secundario. Hay que confirmar que un segundo intento concurrente degrada a un mensaje útil y no a un documento sin número silencioso.
- **La verificación tiene que ser end-to-end**, no de unidad: que el número impreso en el PDF y en el HTML del mismo registro sea el mismo, y sea el que Operam muestra para ese quote.
