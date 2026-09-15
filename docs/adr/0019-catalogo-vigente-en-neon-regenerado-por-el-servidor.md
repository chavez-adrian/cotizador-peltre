# ADR-0019: El catálogo vigente vive en Neon y lo regenera el servidor desde Operam; `precios.json` degrada a semilla

## Status

Accepted (2026-09-15). Complementa ADR-0018 (el Alta de artículo nace en el maestro). Origen: sesión de `grill-with-docs` con Adrián sobre #303.

## Context

El catálogo que el cotizador sirve (`/api/precios`) es `data/precios.json`, un archivo versionado que `scripts/sync-catalogo.mjs --apply` reescribe en la máquina de Adrián leyendo Operam completo; después se commitea y se despliega. La ruta `POST /api/admin/precios` que lo sobrescribe en runtime es del extractor legado (#131) y en Render escribe en disco efímero. Resultado: un artículo creado en Operam **no existe para el cotizador** hasta el siguiente commit, y "sincronizar" es un paso manual que alguien tiene que recordar. Con el Alta de artículo (ADR-0018) eso dejaría el alta a medias: en el ERP sí, cotizable no.

El servidor ya sabe construir el catálogo desde Operam en memoria: la ruta de paridad corre `construirCatalogo` contra Operam en ~10 llamadas y solo reporta, no guarda.

## Decision

- El catálogo vigente se **persiste en Neon** con el patrón de la casa: `precios.json` queda como **semilla** si la tabla está vacía y como **fallback** sin `DATABASE_URL` (dev y tests); nunca pisa lo guardado.
- **Lo regenera el servidor** con el mismo núcleo puro que usa la paridad, en **segundo plano** (lee Operam completo con el throttle anti-429 que ya tiene el script; tarda decenas de segundos y no debe bloquear al admin), y avisa cuando termina.
- El Alta de artículo **termina disparando esa regeneración**. Para todo lo demás (cambios hechos directo en Operam) hay un botón "Regenerar catálogo" en el panel de admin.
- `sync-catalogo.mjs` **deja de ser el camino de producción**; el commit de `precios.json` ya no forma parte de publicar un artículo.

## Considered Options

- **Insertar solo el artículo nuevo en el catálogo persistido** y dejar la regeneración completa como paso manual. Rechazada: dos caminos para poblar el mismo catálogo, y a la primera discrepancia nadie sabe cuál manda.
- **No tocarlo en la primera bala trazadora** (el alta escribe en Operam y el sync sigue manual). Rechazada: deja el alta sin su última milla y no prueba nada sobre el sync, que fue nombrado como parte del cuello de botella.

## Consequences

- La regeneración es un trabajo de fondo con estado (en curso, terminado, fallido) que el panel muestra; una lectura degenerada de Operam (dump vacío, 401 silencioso) no debe reemplazar el catálogo bueno: la guarda mínima que ya tiene el script pasa al servidor.
- Vale el supuesto de **una sola instancia** ya declarado para otros trabajos de fondo del cotizador.
- El extractor legado y su ruta de subida de Excel pierden su último uso y se retiran cuando esto entre (regla de la casa: el código en desuso se borra).
