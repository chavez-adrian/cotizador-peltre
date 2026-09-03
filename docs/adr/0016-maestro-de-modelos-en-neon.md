# El maestro de modelos vive en Neon, no en el Excel de precios

El **Resumen de la cotización** (el mensaje enriquecido de WhatsApp) agrupa las partidas por **Familia de producto** para que una cotización de 42 partidas quepa en seis renglones. Eso obligó a contestar de dónde sale la familia, y la respuesta destapó una pregunta más grande: dónde vive el maestro de producto de la empresa.

La familia **no se deriva del código del SKU**. Se probó y falla: `VA` mezcla tazas con pocillos, `VT` mezcla tequileros con vasos de mesa, y los platos hondos y trincheros son la misma familia en dos prefijos distintos (`PH` y `PL`). El prefijo es código de molde, no clasificación comercial; la familia es una decisión por modelo que toma una persona. Ya existía tomada: la columna `amazon_type` de la pestaña `catalogo` de `LISTA DE PRECIOS 2026 Abril.xlsx` (Dropbox, `/PELTRE NACIONAL/1.0 COMERCIALIZACION/VENTAS/PRECIOS/`), 17 valores sobre 36 modelos, y acierta justo donde el prefijo falla: `VA09 Pocillo` es `pocillo`, no `taza`. El nombre de la columna tampoco es casero — Amazon llama literalmente *product type* a esa clasificacion.

La decisión (2026-09-03, sesión de diseño con Adrián) es migrar **el bloque completo de modelos** —36 filas, 32 columnas: nombre comercial, familia, género, peso, medidas, capacidad, caja, código SAT, clasificación GS1— a una **tabla propia en Neon**, sembrada desde el archivo versionado y editable desde un panel nuevo `/admin/catalogo`. Mismo patrón que `lib/vendedores-store.js` y `lib/config-store.js`: semilla si la tabla está vacía (nunca pisa lo guardado), fallback al JSON sin `DATABASE_URL` para dev y tests.

Se consideraron cuatro alcances. **Solo la familia** (`modelo -> familia`, 36 renglones) se rechazó porque crearía **tres fuentes de verdad para datos del mismo modelo**: la familia en Neon, el peso y el nombre en `data/catalogo-complemento.json`, y todo en el Excel — peor que cualquiera de los extremos. **Las seis tablas de la pestaña** (colores, texturas, cajas, la regla `textura_capa -> price_key`, listas) y **el libro entero con sus derivaciones** (`carga_articulos` con 1,268 filas, GS1, Shopify, `precios_pna`) quedaron como issues #303 y #304: los otros cinco bloques no tienen huecos conocidos, nadie los edita, y llevan tiempo congelados alimentando el selector guiado sin dar lata. La duplicación que justifica esta decisión ahí no existe.

**Neon y no el archivo versionado, pero no por el disco efímero de Render**: `data/catalogo-complemento.json` está en git y un redeploy lo restaura idéntico — el disco efímero solo mata lo que se escribe en runtime. Las razones son otras dos. `lib/extract-prices.js` quedó LEGADO desde #131 (el catálogo se genera desde Operam), así que bajar una columna por esa vía sería revivir un pipeline muerto. Y estos son datos comerciales que una persona corrige cuando el catálogo cambia, no constantes del código: el mismo criterio que movió la configuración del panel a Neon en #276, donde "editarlo en un commit ya NO llega a producción" fue el punto, no la persistencia.

**Tabla propia, no un campo dentro de `config_panel`**: 36 renglones indexados por modelo son una tabla de consulta, no un documento de configuración. `config_panel` guarda un solo JSONB con caché síncrona en memoria; meterle esto le estira la forma sin ganar nada.

## Consecuencias

Un modelo sin familia asignada tiene que ser **visible como pendiente en el panel**, nunca caer callado en "Otros". Hoy `BA30 Base 30 cm` y `OL24 Olla 24 cm` no tienen `amazon_type` — ese silencio es exactamente el modo de falla que la migración debe cerrar, no heredar.

Dos correcciones que la lectura del Excel destapó y que entran con la semilla: `CL28 Comal` está clasificado como `griddle`, en inglés, porque la columna nació para Amazon — pasa a `comal`, que es lo que el cliente lee. Y `SA08` y `SC08` comparten `nombre_comercial` "Salsera" siendo piezas distintas (recta y cónica): el nombre comercial **no es único** hoy, y el resumen imprimiría dos renglones idénticos.

El Excel deja de ser fuente de los datos de modelo pero **sigue generando** los SKUs, los artículos que se cargan a Operam, los códigos GS1 y los listados de Shopify. Es un estado transitorio aceptado a sabiendas: la fuente en Neon y el generador en un libro que ahora tiene que leerla. Lo cierra #304, y su riesgo principal es de arqueología, no de programación — las fórmulas llevan años de reglas empíricas que no están escritas en ningún lado.

Si el store usa caché síncrona como `config-store.js`, hereda su supuesto de **una sola instancia**, igual que el lock de subidas a Operam y la cola de post-fixes de vigencia.

El glosario captura los términos: "Familia de producto", "Modelo", "Maestro de modelos" y "Resumen de la cotización".
