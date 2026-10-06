# ADR-0023: Modo del alta: un modulo puro decide el modo del panel del alta

## Status

Accepted (2026-10-05). Origen: review de arquitectura del 2026-10-03 (candidato 3, "El panel del alta: un modo, no seis banderas y el DOM"), sesion de diseno con Adrian del 2026-10-04/05 y #539 (tajada 1 de 3; #540 mete la constancia y #541 deriva la pantalla). Complementa ADR-0017 (Alta de cliente como modulo): aquel es el servidor, este es el panel del navegador.

## Context

El panel donde se da de alta un Cliente Operam es el MISMO nodo del DOM que el de la actualizacion fiscal (trampa #376). En que modo estaba lo recordaba `altaCsfState.modoUpgrade` (`null` = alta; un `customer_id` = actualizacion de ese cliente), junto con `upgradeOrigen` y `comercialPrecargado`, y esos tres campos se escribian a mano desde siete lugares de `public/js/app.js`. Cada camino reiniciaba su propio subconjunto, y seis tickets cerrados son la misma fuga por distintos lados (#376, #412, #432, #489, #491, #516). Lo que impedia que volvieran eran pruebas que leen `app.js` como TEXTO.

## Decision

- **Un nucleo PURO sin DOM, `public/js/modo-alta-logica.js`**, con el concepto **Modo del alta** (entrada nueva en `CONTEXT.md`). Su estado es `{ clienteId, origen, comercialPrecargado }` (`MODO_ALTA_INICIAL` = `{ null, null, undefined }`) y sus transiciones reciben el estado y devuelven uno nuevo sin mutar el recibido: `alAbrirAlta`, `alAbrirActualizacion(m, clienteId, origen)`, `alPrecargarComercial(m, pre)`, `alLograrActualizacion`, `alActualizarCandidato(m, clienteId)`, `alCrearNuevoCandidato` y `alCerrarPanel`, una por camino de `app.js`.
- **Un solo punto que escribe**: en `app.js`, `let modoAlta` y `aplicarModoAlta(transicion, ...args)`, junto a la declaracion de `altaCsfState`. El modo vive en un objeto APARTE de la constancia: asi los `Object.assign(altaCsfState, ...)` de la constancia dejan de reescribirlo. Los lectores leen `modoAlta.clienteId` / `.origen` / `.comercialPrecargado`; las funciones de `alta-logica.js` que reciben el modo como argumento no cambian de firma.
- **Comportamiento IDENTICO**: cada transicion reproduce lo que hacia su camino, con sus asimetrias. Ninguna se corrige aqui; la tabla de abajo es la entrada del ticket que las decida.
- **Pruebas**: las de texto que anclaban en el modo (C16b, #489-3) se parten: la garantia "cerrar apaga la actualizacion" pasa a comportamiento en `modo-alta-logica.test.cjs`, y el orden y la llamada en `app.js` (cableado) se quedan de texto con el ancla nueva.

## Asimetrias (lo que cada camino escribe; "-" = no lo toca)

| Camino | clienteId | origen | comercialPrecargado |
|---|---|---|---|
| Abrir el alta (`abrirAcordeonAlta`, al abrir) | null | null | undefined |
| Abrir la actualizacion (`pcAbrirUpgradeFiscal`) | el id | origen o null | null |
| Precarga comercial lograda | - | - | la precarga |
| Actualizacion lograda (`pcEjecutarUpgradeFiscal`) | null | null | undefined |
| Actualizacion fallida | - | - | - |
| "Actualizar este" del duplicado (`altaCandidatoActualizar`) | el id | - | undefined |
| "Crear nuevo" del duplicado (`altaCandidatoCrearNuevo`) | null | null | - |
| Cerrar / recoger el panel (`devolverPanelACasa`) | null | null | - |

1. La precarga sobrevive a cerrar y a "Crear nuevo" (abrir el alta y la actualizacion lograda la ponen en undefined). Inofensivo hoy: todo camino que vuelve a actualizacion la reescribe.
2. "Actualizar este" no toca el origen. Hoy siempre llega null.
3. "Actualizar este" no marca la constancia, no limpia las palomas ni pinta el banner; abrir la actualizacion si (constancia: #540; palomas y banner: #541).
4. La precarga tardia: `pcPrecargarComercialUpgrade` escribe tras un `await` sin mirar el modo, aunque el panel ya se haya cerrado o se haya abierto otro cliente.
5. La actualizacion lograda tambien llega tarde: apaga el modo al volver del PUT aunque en medio se haya abierto otra cosa.

## Considered Options

- **Un widget con DOM, como `telefono-widget.js`.** Rechazada: la suite `.cjs` corre sin navegador; el modulo tiene que poder probarse solo.
- **Dejarlo como esta.** Rechazada: seis tickets con la misma fuga; las pruebas de texto pasan con la llamada en el lugar equivocado y se rompen al renombrar.
- **Unificar las asimetrias en el mismo cambio.** Rechazada: es una mudanza que debe ser invisible; cada asimetria se decide en su ticket.

## Consequences

- En esta tajada las transiciones solo devuelven estado; `app.js` sigue haciendo la pantalla y la constancia a mano (tajadas 2 y 3).
- Quien lee el modo antes de cerrarlo (la llave del borrador en `devolverPanelACasa`) lo lee ANTES de aplicar la transicion.
- El orden "ocultar las vistas y luego abrir la actualizacion" sigue cuidado por una prueba de texto: ninguna prueba del modulo ve un reordenamiento en `app.js`.
