# ADR-0017: El alta de cliente es un módulo con adaptador de Operam, y sus tres caminos son una sola operación

## Status

Accepted (2026-09-09). Complementa ADR-0002 (el alta es atómica para el vendedor) y ADR-0001 (deduplicación). Sustituye la justificación de #186 para el post-fix del segmento en la subida de cotización. Origen: revisión de arquitectura del 2026-09-09 (sesión de `improve-codebase-architecture` + `grilling` con Adrián).

## Context

La secuencia del alta de un Cliente Operam — deduplicar, crear o reutilizar el cliente, dimensiones, domicilio de entrega, verificar lo que Operam aceptó, Cel, segmento — estaba escrita tres veces en `server.js`: `subirConAltaGenerica` (336 líneas, mezclada con la subida del quote y sus post-fixes), `POST /api/crear-cliente` (202) y `PUT /api/actualizar-cliente-fiscal/:id` (145). Los últimos diez tickets (#339 a #353) tocaron ese flujo y cada uno tuvo que editar dos o tres de las copias.

Las copias ya habían divergido sin razón de dominio: solo el alta genérica relee el domicilio de entrega y compara campo por campo (`diffBranchDomicilio`); el alta completa confía en una casilla `cliente_existente` que le manda el navegador para decidir si el PUT del branch es seguro (en #250 esa confianza le borró al cliente 15 su vendedor y su domicilio); solo el alta completa toma el lock por RFC real; solo el upgrade refresca el padrón de teléfonos; el post-fix del segmento tenía tres contratos distintos; y la deduplicación del lado del servidor solo existía en la genérica — el alta completa dependía de que el navegador la hubiera corrido.

Ninguna de las tres copias recibía a Operam como dependencia. El único seam disponible era `globalThis.fetch`, y por eso una sola suite (`test/server.test.js`) hace 84 llamadas a `mockOperamFetch` reescribiendo el protocolo de 4 a 6 endpoints para probar una regla de negocio; 13 suites que levantan `server.js` arrancan con las credenciales reales del `.env` sin sobreescribir `fetch`.

Además, los textos que veía el vendedor mezclaban niveles: nombres de pasos como `PUT branch (domicilio)` y `err.message` crudos de la API.

## Decision

**Un módulo `lib/alta-cliente.js`** garantiza "existe un Cliente Operam listo para cotizar y facturar". Dos operaciones:

- `darDeAlta(solicitud, deps)` cubre el alta genérica (Cliente Operam sin datos fiscales al subir la cotización) y el alta completa como **una sola operación con distinta riqueza de datos**. Devuelve un resultado, nunca un status HTTP: alta lograda con el reporte de pasos, pregunta al vendedor (candidatos y las opciones entre las que elige), o bloqueo con motivo.
- `upgradeFiscal(id, csfDatos, deps)` con el gate anti-fusión por RFC (#85) adentro.

**Entrada: una Solicitud de alta** normalizada (término nuevo en `CONTEXT.md`): Contacto, datos fiscales o ninguno, configuración comercial, domicilio de entrega, decisión de dedup si la hubo, y la preferencia sobre el segmento. La subida de cotización la arma desde la cotización; el handler del formulario desde el body. El módulo decide RFC genérico vs real según haya datos fiscales.

**Dentro del módulo:** la deduplicación en capas (ADR-0001, #242, #345) para las dos altas — el alta completa gana el guardrail del servidor; el navegador puede seguir pre-consultando pero el servidor decide —; el lock por RFC real para los tres caminos; la auditoría en `clientes_log`; el refresco del padrón de teléfonos; y **una sola secuencia de pasos**: dedup → crear o reutilizar → configuración comercial (solo si hay cambios) → dimensiones → domicilio de entrega (POST solo si no existe uno equivalente; PUT **solo sobre el recién creado**, con una sola bandera interna que decide el módulo, nunca el navegador) → verificar el domicilio releyéndolo, **siempre** → verificar Cel → segmento. Los pasos que no aplican se reportan como omitidos con su motivo.

**Fuera del módulo:** el POST del quote, el post-fix de vigencia (ADR-0007) y escribir `customerId`/`branchId` en la cotización. Eso es de la subida de cotización (ADR-0009), que consume el resultado del alta. Los handlers solo traducen: Solicitud ← HTTP; resultado → 200 / 428 `CONFIRMAR_OTRA_RAZON_SOCIAL` / 409; y serializan las opciones de reintento (el módulo devuelve la decisión, el handler arma el cuerpo con el que el navegador reintenta, como dicta #345).

**Seam: `deps = {}`** con las funciones actuales de `operam-client`, `operam-web` e `indice-telefonos` como fallback (patrón de la casa: `sync-operam-io`, `alerta-mayoreo-io`, `backfill-operam`). El adaptador en memoria de los tests implementa las mismas funciones. `alta-generica.js` conserva sus constructores puros como seam interno del módulo; sus cuatro importadores ajenos no cambian.

**Segmento:** el alta completa y el upgrade fiscal lo esperan, como hoy. La subida de cotización lo pide **diferido** — la latencia actual de la subida es aceptable y no se apuesta a que esperar lo siga siendo — pero el fallo deja de vivir solo en el log de Render: se anota en `clientes_log` como "segmento pendiente" con su motivo, visible en `/admin`. Es una preferencia explícita de la Solicitud con razón escrita, no un accidente por camino.

**Mensaje en dos capas** (término nuevo en `CONTEXT.md`): cada paso, bloqueo o campo no aplicado lleva un `mensaje` en términos del glosario para el vendedor y un `detalle` técnico para depurar. La pantalla muestra siempre el primero; el segundo va plegado o en el reporte de pasos.

**Tests:** el módulo nace con tests propios contra el adaptador en memoria (una regla, un test). Los supertest actuales quedan como red durante el cambio, tocándose solo la lista de pasos que ahora incluye "verificar domicilio de entrega" en el alta completa. En ticket aparte se reducen a la traducción HTTP y se borra lo que ya cubre el módulo.

## Considered Options

- **Incluir el POST del quote y los post-fixes en el módulo** ("subir a Operam"). Rechazada: mezcla dos conceptos del glosario (Alta de cliente y Número de la cotización) y el upgrade fiscal no tendría lugar.
- **Dejar el upgrade fiscal como handler aparte** porque no crea nada. Rechazada: comparte el gate anti-fusión, el PUT con eco, la relectura y el post-fix del segmento con las altas; dejarlo fuera conserva una copia.
- **Dos funciones, una por camino** (`darDeAltaGenerica(entry)` y `darDeAltaCompleta(body)`). Rechazada: la interfaz seguiría teniendo dos formas y los tests cubrirían ambas; la traducción a la Solicitud es de los callers.
- **Deduplicación fuera, el caller pasa `clienteExistente`.** Rechazada: deja la regla partida entre la subida y el navegador y al alta completa sin guardrail del servidor, que es lo que produjo #250.
- **Interfaz nueva de Operam por concepto desde ahora** (`operam.clientes.crear`, `operam.domicilios.crear`…). Pospuesta: obliga a reescribir el adaptador real en el mismo cambio; con `deps = {}` el seam ya es real (dos adaptadores) y la interfaz angosta se justifica cuando haya un segundo consumidor.
- **Segmento inline en los tres caminos** (recomendación inicial de la revisión). Rechazada por el dueño: la latencia de la subida es aceptable hoy y esperar uno o dos segundos más a la web legacy no se acepta a ciegas. Si se quiere saber el costo real, se mide sobre el cliente de prueba 497 antes de decidir.
- **Que el módulo arme el cuerpo de reintento completo.** Rechazada: el módulo aprendería la forma del contrato HTTP del navegador.
- **Fusionar `alta-generica.js` en el módulo nuevo.** Rechazada: obliga a re-apuntar cuatro importadores y un test por un beneficio cosmético.

## Consequences

- Cambios de comportamiento observables, aceptados a sabiendas: el alta completa puede responder la pregunta 428 de duplicado donde hoy crea sin preguntar (el formulario de alta tiene que saber mostrarla; hoy solo la muestra la pantalla de cotizar); el alta completa hace una lectura más a Operam para verificar el domicilio de entrega; las dos altas comparten el lock por RFC real.
- `server.js` pierde unas 500 líneas y tres orquestaciones; los handlers quedan como traducción HTTP.
- La palabra "sucursal" sale del texto para el vendedor: en Operam y en el glosario es **domicilio de entrega**; `branch` se queda en el código y en el detalle técnico.
- Los mensajes en dos capas obligan a revisar cada `steps.push` y cada `err.message` que hoy llega a pantalla.
- `helpers.cjs` y el formulario de alta en el navegador (candidato 2 de la misma revisión) no entran aquí; el resultado y la pregunta 428 que este módulo devuelve son la interfaz que ese trabajo consumirá.
