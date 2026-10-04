# ADR-0022: La subida del quote es un módulo que escribe en el registro de la cotización

## Status

Accepted (2026-10-03). Sigue el precedente de ADR-0017 (alta de cliente como módulo con adaptador). Complementa ADR-0008 (actualizar conservando el folio) y ADR-0009 (el número de la cotización es el folio de Operam). Origen: review de arquitectura del 2026-10-03 (candidato 1), sesión de diseño con Adrián y #524 (tajada 1 de 3; #525 y #526 completan crear).

## Context

Subir o actualizar una cotización en Operam no existía como una pieza con nombre. Era una secuencia repartida en dos rutas de `server.js` (`POST /api/cotizacion/operam/:id` y `POST /api/cotizacion/operam/:id/actualizar`) y unas veinte funciones sueltas que recibían `res` y contestaban ellas mismas al navegador (~880 líneas). El tramo "llegó el folio: guardarlo, guardar la huella, levantar el motivo de PRE, correr el post-fix" y la traducción de errores estaban escritos dos veces, y 15 archivos de prueba ejercitaban todo por HTTP imitando el protocolo de Operam con mocks de `fetch`.

El alta de cliente ya había resuelto el mismo problema (ADR-0017): un módulo que devuelve valores y recibe sus dependencias por `deps`, con handlers que solo traducen.

## Decision

- **Un módulo `lib/subida-quote.js`** con el concepto **Subida del quote** (término nuevo en `CONTEXT.md`). Al terminar las tres tajadas tendrá dos operaciones: `subirQuote` y `actualizarQuote`. La primera tajada entrega `actualizarQuote(id, deps)`.
- **Devuelve valores, nunca un status HTTP**, y no importa Express ni `server.js`. El handler traduce valor a HTTP con las mismas URLs, status y cuerpos de antes: el navegador no se entera.
- **El módulo escribe en el registro de la cotización**: el store de cotizaciones entra por `deps`. En ADR-0017 el alta no escribe en la cotización porque eso "es de la subida"; este módulo ES la subida, y el folio, la huella y la marca de quote desactualizado son suyos.
- **El candado por id de cotización vive en el módulo** (`conCandadoSubida`, antes `subidasOperamEnCurso` en `server.js`). Ocupado no espera: devuelve un valor `OCUPADO` y cada ruta lo traduce al 425 con su texto de siempre. No es reentrante: tomarlo dos veces en la misma petición devuelve ocupado, así que quien ya lo tiene llama a la parte sin candado. Mientras crear siga en `server.js`, su ruta usa este mismo candado: una subida y una actualización de la misma cotización se siguen excluyendo.
- **Seam `deps = {}`** con fallback a las funciones reales (store, `actualizarQuoteOperam`, cola de reintentos del post-fix). Los resolutores de lo esperado en el encabezado (`listaDelQuote`, `transportistaDelQuote`) son dependencias obligatorias sin fallback: viven en `server.js`, que es quien lee el catálogo, y el handler las pasa.
- **El segmento diferido del alta se dispara al final del módulo** cuando llegue crear con alta de cliente (tajada 3), no en el handler.
- **Las pruebas HTTP existentes conviven como red** de equivalencia y no se tocan en este cambio; el módulo nace con pruebas propias por su interfaz, sin `fetch` ni supertest, contra adaptadores en memoria. Reducirlas es un ticket posterior.
- **El navegador sigue eligiendo la ruta** (crear o actualizar); se corrige después con una entrada única.

## Considered Options

- **Que la ruta siga escribiendo el registro y el módulo solo hable con Operam.** Rechazada: deja el tramo "llegó el folio" repartido entre el módulo y cada handler, que es justo lo que estaba duplicado.
- **Migrar las pruebas HTTP en el mismo cambio.** Rechazada: son la prueba de que el refactor no cambió comportamiento; migrarlas a la vez quitaría la red justo cuando más se necesita.
- **Meter en el alcance el guardado (`POST /api/cotizacion`) y el navegador.** Rechazada: multiplica el riesgo de un refactor que debe ser invisible; la entrada única es su propio ticket.

## Consequences

- El handler de `/actualizar` queda como traducción de valores; las tajadas 2 y 3 heredan la misma forma (valores con `tipo`, `deps`, candado adentro).
- Mientras las tres tajadas no terminen, la ruta de crear sigue en `server.js` y la Subida del quote vive en dos lugares; el candado ya es uno solo.
- Hay dos baterías de prueba sobre la misma secuencia (HTTP y del módulo) hasta el ticket que reduzca las HTTP.
- El candado sigue asumiendo una sola instancia de Node (Render Starter); con varias habría que moverlo a Neon.

## Nota 2026-10-03 (issue #527): la doble bateria ya se redujo

La regla queda asi: **las reglas de la Subida del quote se prueban en el modulo** (`test/subida-quote.test.js`, `test/subida-quote-alta.test.js`) y **la ruta prueba la traduccion** (status, codigo y cuerpo por cada valor; auth; el texto del 425 de cada ruta; el `reintentar` del 428). Las pruebas HTTP que prueban reglas de OTRO modulo a traves de la ruta (el cuerpo real que llega a Operam, el ProcessOrder, el segmento por la ficha web, la cola de reintentos persistida, el cableado de `listaDelQuote`/`transportistaDelQuote`/`obtenerListasPrecios` en `server.js`) se quedan: el modulo de la subida sustituye esas dependencias por dobles y no las cubre.

De 94 pruebas HTTP clasificadas se borraron 8: seis ya cubiertas por el modulo (G1b, C2, dos del gate de `/actualizar` y la marca de quote desactualizado de A104, la huella con el transportista) y dos cuya regla se escribio primero en el modulo (la huella al crear como literal con `listaId`/`shipVia` en null presentes, #114-6; la subida que no espera al segmento diferido, S6). La tabla y el sabotaje que demuestra que el modulo sostiene lo borrado viven en el issue.

Las filas de la tabla valor -> respuesta que ninguna prueba HTTP afirmaba viven en `test/subida-quote-http.test.js`, salvo `actualizada: true`, que la sostiene A104 en `test/server.test.js` (provocarla pide el doble completo de la web legacy). Dos ramas de `responderBloqueoAlta` no se pueden alcanzar desde `POST /api/cotizacion/operam/:id` y por eso no tienen prueba HTTP: `fusion` (el alta solo marca el mismo RFC real con `datosFiscales.rfc`, y la subida siempre manda `datosFiscales: null`) y `sin-vendedor-operam` con `customer_id` (ese bloqueo ocurre antes de cualquier escritura y nunca trae `clienteId`).

## Nota 2026-10-04 (issue #528): el servidor decide, el guardado deja la marca

Se cierra el pendiente de "el navegador sigue eligiendo la ruta". Generar una cotizacion son dos peticiones y la segunda ya no la elige el navegador: guarda, llama SIEMPRE a `POST /api/cotizacion/operam/:id` y pinta.

- **Quien decide "cambio"**: el guardado, el unico momento con lo nuevo y lo previo a la vista (la vigencia previa se pierde un renglon despues). Lo PERSISTE en `data.quoteDesactualizado`: la marca previa tal cual o la pendiente `{ fecha, pendiente: true }`. La de fallo conserva su forma `{ fecha, escrito, error, discrepancias }`. El guardado solo pone la marca, nunca la quita, y descarta la llave si llega en el cuerpo (con o sin `cotizacionId`): el data se mergea por la raiz y una llave ajena la quitaria o la falsificaria.
- **Quien decide la operacion**: `subirQuote`, dentro de UN candado y con la lectura que ya hacia. Sin folio crea; con folio y marca actualiza (`actualizarRegistro`, la misma secuencia de `actualizarQuote`, sin volver a tomar el candado) y el valor lleva `operacion: 'actualizar'`; con folio y sin marca, `ya-subida`. La ruta de crear responde en esa rama lo mismo que `/actualizar` (`respuestaActualizacion`) mas `operacion`; el 425 y el 404 ocurren antes de leer el registro y conservan el texto de crear, y el navegador los lee por si la cotizacion ya tenia folio (`interpreteOperam`).
- **La carrera guardado / actualizacion en vuelo**: guardar B mientras se escribe A dejaria registro B, quote A y la marca quitada. La actualizacion lograda relee el registro y solo quita la marca si su huella es la que se escribio; si no, guarda la huella de lo escrito y conserva la marca (o pone la pendiente), y la siguiente llamada vuelve a actualizar. Entre la relectura y la escritura queda una ventana de milisegundos: aceptada.
- **Pendiente**: `/actualizar` y la senal `requiereActualizacionOperam` de la respuesta del guardado siguen vivas para las pestanas abiertas con el `app.js` anterior; el `app.js` nuevo las ignora. Se retiran juntas en un ticket posterior.
- **Borde transitorio aceptado**: una pestana con el `app.js` anterior que caiga en la rama actualizar por la ruta de crear y falle lee el 200 `ok: false` como exito; la marca sigue visible en el Historial.
