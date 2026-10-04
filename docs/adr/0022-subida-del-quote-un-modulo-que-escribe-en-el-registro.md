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
