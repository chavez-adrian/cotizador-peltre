# ADR-0018: El Alta de artículo nace en el Maestro de artículos; Operam conserva la verdad del estado comercial

## Status

Accepted (2026-09-14). Extiende ADR-0016 (el maestro de artículos vive en Neon) y toma del Alta de cliente (ADR-0017) el patrón de escribir en Operam y releer. Origen: sesión de `grill-with-docs` + `domain-modeling` con Adrián sobre #303 y #304.

## Context

Desde #131 el catálogo del cotizador se genera **desde Operam**: el ERP dice qué artículos existen y a qué precio. El Maestro de artículos (ADR-0016) abrió la dirección contraria para una parte de los datos —lo que un artículo *es*—, pero hasta hoy solo con el bloque de modelos y sin escribir nada hacia Operam.

El cuello de botella real del maestro, dicho por Adrián en esta sesión, no es dónde viven las tablas sino el **Alta de artículo**: crear un artículo nuevo exige que una sola persona agregue una fila a la hoja de carga del Excel maestro y suba a mano tres archivos a tres portales de Operam (artículos, precios, clave SAT), y después recuerde correr el sync del catálogo. Se decidió atacar eso con una **bala trazadora vertical** (un alta de punta a punta para el caso más simple) en vez de la migración horizontal de las seis tablas que planteaba #303. Al nacer el artículo en el cotizador y empujarse a Operam, hubo que decidir quién tiene la verdad.

## Decision

**Verdad repartida, no invertida.**

- El **Maestro de artículos** es la única fuente de **lo que un artículo es**: sus partes (modelo, tamaño, colores, textura, capas, filetes, riso, oreja, decorado), su código, su nombre, su caja, su clave SAT y su clasificación GS1. El Alta de artículo nace ahí.
- **El Maestro de artículos define también el precio de lista de cada Clave de precio** (modelo + letra de acabado; añadido 2026-09-15). Es la tabla que una persona edita en el ajuste anual de precios; el precio de cada artículo en cada lista se deriva de ahí y se empuja a Operam, para un artículo nuevo en el alta y para todos en el ajuste anual (los cargadores masivos por texto pegado, tope 2,000 filas, son para esto).
- **Operam** sigue siendo la fuente de **su estado comercial**: que existe como `stock_id`, qué precio tiene **cargado** en qué listas, y si está activo. Precio definido y precio cargado pueden diferir (un empuje a medias, una edición directa en el ERP); el reporte de paridad los compara y la definición del maestro es la que manda para el siguiente empuje. El alta **escribe en Operam y relee** para comprobar qué aceptó, igual que el Alta de cliente; no da por hecho que lo que mandó es lo que quedó.
- El sync del catálogo **sigue leyendo Operam completo**. Los más de mil artículos históricos que el maestro todavía no sabe describir no se vuelven anomalías por esta decisión.

## Considered Options

- **El maestro como única fuente de existencia (Operam espejo).** Rechazada: convertiría en anomalía, el día uno, a todo artículo histórico que el maestro no describe, y la arqueología para describirlos es el trabajo de #304, no de esta bala trazadora. Además exige un candado contra altas directas en Operam que la API no ofrece: sería una regla que el sistema no puede hacer cumplir.
- **Tomar el precio de un artículo nuevo copiándolo de sus hermanos en Operam, sin tabla de precios en el maestro** (recomendación del agente). Rechazada por Adrián: resuelve el alta pero no el ajuste anual, que exige decidir ~62 precios de lista en un solo lugar y derivar de ahí más de mil artículos; con el precio solo en Operam, ese ajuste seguiría viviendo en el Excel.
- **Seguir con Operam como única fuente y que el alta sea solo un generador de archivos para subir a mano.** Rechazada como destino (se acepta a lo sumo como paso intermedio para precio o SAT si la API no los cubre): deja a la misma persona como cuello de botella y no quita el sync manual.

## Consequences

- Caminos de escritura, verificados en lectura el 2026-09-14: el artículo por `POST /api/v3/inventory/items`; la clave SAT es un campo del formulario web del artículo (`timbrado_v33_prod_ser`, se guarda con `addupdate`); el precio por artículo y lista es el formulario `inventory/prices.php` (`ADD_ITEM`). Los cargadores masivos de precios y de clave SAT no reciben archivo sino un `textarea` de texto pegado (tope 2,000 filas) y quedan para lotes, no para el alta. Todo se relee: artículo y precios por la v3, la clave SAT desde el formulario. Queda por sondear con un artículo desechable si el `POST` de la v3 acepta la clave SAT en el payload.
- Discrepancias entre el maestro y Operam (resuelto el 2026-09-15 por ADR-0020): la tabla de artículos se siembra desde la hoja de carga del Excel, así que el maestro describe los 1,270 artículos históricos desde el inicio. Un artículo creado directo en Operam después de eso, o uno del maestro que falta en Operam (un alta a medias), es una anomalía que el reporte de paridad denuncia; no se resuelve en automático.
- La convención de códigos y nombres que hoy imponen las fórmulas del Excel pasa a ser regla del maestro. `decodificarSku` ya lee la mayor parte de esa convención; el alta necesita su inversa, y le faltan dos partes que el Excel sí maneja: color de oreja y decorado.
- #303 se reescribe: deja de ser "las seis tablas de la pestaña" y pasa a ser "el vocabulario que el Alta de artículo necesita". #304 deja de ser un bloque de arqueología previa y se convierte en balas trazadoras sucesivas (GS1, Shopify, Amazon, cajas) sobre el mismo maestro.
