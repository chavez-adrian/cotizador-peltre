# ADR-0023: Modo del alta: un modulo puro decide el modo del panel del alta

## Status

Accepted (2026-10-05). Origen: review de arquitectura del 2026-10-03 (candidato 3, "El panel del alta: un modo, no seis banderas y el DOM"), sesion de diseno con Adrian del 2026-10-04/05 y #539 (tajada 1 de 3; #540 mete la constancia y #541 deriva la pantalla). Complementa ADR-0017 (Alta de cliente como modulo): aquel es el servidor, este es el panel del navegador.

## Context

El panel donde se da de alta un Cliente Operam es el MISMO nodo del DOM que el de la actualizacion fiscal (trampa #376). En que modo estaba lo recordaba `altaCsfState.modoUpgrade` (`null` = alta; un `customer_id` = actualizacion de ese cliente), junto con `upgradeOrigen` y `comercialPrecargado`, y esos tres campos se escribian a mano desde siete lugares de `public/js/app.js`. Cada camino reiniciaba su propio subconjunto, y seis tickets cerrados son la misma fuga por distintos lados (#376, #412, #432, #489, #491, #516). Lo que impedia que volvieran eran pruebas que leen `app.js` como TEXTO.

## Decision

- **Un nucleo PURO sin DOM, `public/js/modo-alta-logica.js`**, con el concepto **Modo del alta** (entrada nueva en `GLOSSARY.md`). Su estado es `{ clienteId, origen, comercialPrecargado }` (`MODO_ALTA_INICIAL` = `{ null, null, undefined }`) y sus transiciones reciben el estado y devuelven uno nuevo sin mutar el recibido: `alAbrirAlta`, `alAbrirActualizacion(m, clienteId, origen)`, `alPrecargarComercial(m, pre)`, `alLograrActualizacion`, `alActualizarCandidato(m, clienteId)`, `alCrearNuevoCandidato` y `alCerrarPanel`, una por camino de `app.js`.
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
- Quien lee el modo antes de cerrarlo (la llave del borrador en `devolverPanelACasa`) lo lee ANTES de aplicar la transicion. (Hasta #541: desde entonces la arma `alCerrarPanel` con el estado que recibe; ver su nota.)
- El orden "ocultar las vistas y luego abrir la actualizacion" sigue cuidado por una prueba de texto: ninguna prueba del modulo ve un reordenamiento en `app.js`.

## Nota 2026-10-06: la constancia entra al modulo (#540, tajada 2)

La constancia en memoria (`status`, `rfc`, `fileName`, `mensaje`, `datos`, `pdfBase64`, `regimenesDetectados`, `confirmado`, `constanciaDeUpgrade`, `lectura`) deja `altaCsfState`, que desaparece de `app.js`, y vive PLANA en `modoAlta`, junto al modo; el contador de lecturas (`altaCsfLecturas`) entra como `lecturas`, monotono. Transiciones nuevas: `alReiniciarAlta`, `alEmpezarLectura`, `alLeerConstancia`, `alFallarLectura`, `alConfirmarConstancia`, `alVaciarConstancia`; `alAbrirAlta`, `alAbrirActualizacion` y `alLograrActualizacion` (que gana el `clienteId`) la tratan en el mismo paso. Abrir el alta le dice a `app.js` que hacer con `altaState.datos` por la consulta pura `aperturaDelAlta`, leida antes de la transicion: las transiciones siguen devolviendo solo estado hasta #541. `altaCsfSetStatus` se renombra `altaCsfPintarStatus` y solo pinta.

Las funciones puras de `alta-logica.js` (`constanciaAlAbrirAlta`, `sinConstancia`, `estadoTrasErrorLectura`, `lecturaVigente`, `visibilidadPanelCsf`, `constanciaViva`) se QUEDAN donde estan y con su firma: el modulo las llama. Moverlas habria obligado a tocar las pruebas de comportamiento de #491 y #516 que las importan, y esas no cambian. Las cinco pruebas de texto de #491 se partieron como en la tajada 1: la garantia pasa al modulo y el orden en `app.js` se queda de texto.

### Asimetrias de la constancia ("-" = no lo toca)

| Camino | status | rfc / fileName | mensaje | datos / pdfBase64 / regimenes | confirmado | constanciaDeUpgrade | lectura | `altaState.datos` |
|---|---|---|---|---|---|---|---|---|
| Abrir alta, reinicio #192 (alta anterior completada) | idle | null | - | null | false | - | null | null |
| Abrir alta con constancia del upgrade (#491) | idle | null | - | null | false | null | null | null |
| Abrir alta con constancia del alta; plegar | - | - | - | - | - | - | - | - |
| Abrir actualizacion | idle | - | - | null | - | el id | null | - |
| Actualizacion lograda | - | - | - | - | - | el id | - | null |
| Actualizacion fallida; "Actualizar este"; "Crear nuevo"; cerrar; precarga | - | - | - | - | - | - | - | - |
| Empieza una lectura | loading | - | - | - | - | - | n | - |
| Lectura lograda y vigente | el del resultado | solo con RFC | - | los nuevos | - | - | - | - |
| Lectura fallida y vigente (#516) | error | null | el error | null | false | se conserva | null | - |
| Lectura no vigente | - | - | - | - | - | - | - | - |
| Confirmar | - | rfc solo con PDF | - | datos del formulario | true | - | - | `{...datos}` en alta |
| Vaciar a mano (borrador) | idle | null | - | null | false | null | null | - |

1. Abrir la actualizacion no limpia `rfc`, `fileName`, `mensaje` ni `confirmado`.
2. La actualizacion lograda marca la constancia pero NO anula la lectura en curso; solo abrirla la anula.
3. "Actualizar este" no marca la constancia: la marca llega solo si el PUT se logra. Ni cerrar ni "Crear nuevo" la tocan.
4. El reinicio #192 no toca la marca del upgrade ni el mensaje; el descarte de #491 si quita la marca.
5. `mensaje` solo lo escribe el error: una lectura lograda despues deja el mensaje viejo (no se ve).
6. Una lectura lograda sin RFC deja `rfc` y `fileName` de la constancia anterior.
7. Empezar una lectura deja los `datos` y el PDF anteriores hasta que termine.
8. La lectura lograda no regresa `confirmado` a `false`.
9. Vaciar a mano quita la marca del upgrade; el error de lectura la conserva.
10. La actualizacion lograda llega tarde (asimetria 5 de arriba): marca con su id aunque en medio se haya abierto otra cosa.
11. `confirmado` es estado muerto: se escribe y nadie lo lee. Entra al literal inicial como `false`; quitarlo es del ticket de asimetrias.

## Nota 2026-10-06: la pantalla se deriva del modo (#541, tajada 3)

Cada transicion devuelve `{ estado, acciones }` -- tambien las que no tocan la pantalla, con `acciones: []` -- y `aplicarModoAlta` asigna el estado y EN SEGUIDA ejecuta la lista con UN ejecutor, `ejecutarAccionAlta` en `app.js`, un `case` por tipo. Los tipos viven congelados en `ACCIONES_MODO` y el `default` lanza: un tipo mal escrito no lo veria ninguna prueba de la suite (`app.js` no se importa), asi que una prueba del modulo afirma que todo tipo emitido esta en la lista y una de texto que el ejecutor tiene exactamente esos casos. `devolverPanelACasa`, `altaCandarSeccionesAvanzadas`, `altaLimpiarProgreso` y `altaBotonDarDeAltaSegunModo` dejaron de existir: son casos del ejecutor, y recoger el panel es `aplicarModoAlta(alCerrarPanel)` en sus cinco llamadores (`ocultarTodasLasVistas`, `pcRenderInicio`, `cvRenderBusqueda`, `cvVolverATarjeta`, `altaCerrarPanelPostExito`). La llave del borrador `upgrade-fiscal-<id>` ya no se lee del modo ANTES de cerrarlo (Consequences de arriba): la arma `alCerrarPanel` con el `clienteId` del estado que recibe.

| Accion | Argumento | El ejecutor |
|---|---|---|
| `recogerPanel` | - | oculta `#panel-alta-cliente` y lo devuelve a su casa (#412, #489) |
| `cerrarBorrador` | `formId` | `cerrarFormularioBorrador(formId, null)`: deja de autoguardar, no lo mata (#185) |
| `botonDarDeAlta` | `habilitado` | `disabled` de "Dar de alta" (#376); el modulo lo calcula del estado YA cambiado (`clienteId == null`), nunca literal |
| `banner` | `{ id, nombre, rfc }` o `null` | `bannerUpgradeHtml` y visible, o vacio y oculto (#94) |
| `candarSecciones` | - | Secciones 3 y 4 a su candado y la 3 a modo captura (#376, #371) |
| `limpiarProgreso` | - | palomas `chkdot-1..3` a vacio (#432) |

### Transicion -> acciones (en el orden de antes de #541)

| Transicion | Acciones |
|---|---|
| `alAbrirAlta` | boton, banner `null` |
| `alReiniciarAlta` (#192, solo si el alta anterior se completo) | boton, limpiarProgreso, candarSecciones |
| `alAbrirActualizacion(m, clienteId, origen, banner)` | banner `{ id, nombre, rfc }` (tolera `banner` null), candarSecciones, limpiarProgreso, boton |
| `alCerrarPanel` | recogerPanel, cerrarBorrador `alta-completa`, cerrarBorrador `upgrade-fiscal-<id>` solo si el estado recibido tenia `clienteId`, boton, banner `null` |
| `alActualizarCandidato` | boton |
| `alCrearNuevoCandidato` | boton |
| `alLograrActualizacion`, `alPrecargarComercial` y las seis de la constancia | ninguna |

### Asimetrias de la pantalla

1. Abrir el alta no canda ni limpia palomas: lo hace el reinicio, y solo si el alta anterior se completo (un alta a medias conserva su avance, #185). No existe "soltar secciones": se desbloquean una por una al confirmar la anterior.
2. Cerrar no canda ni limpia palomas: lo decide la siguiente apertura.
3. "Actualizar este" apaga el boton, pero no canda, no limpia palomas ni pone banner.
4. La actualizacion lograda no recoge el panel -- lo esconde con `display:none` en `app.js` y desde la vista Clientes queda en el slot, a proposito: el reporte de #407 se inserta junto a el --, no reenciende "Dar de alta" ni oculta el banner hasta el siguiente abrir alta o cerrar. Es lo que #412 prohibio para el alta.
5. "Crear nuevo" prende el boton y no toca el banner.
6. Cerrar cierra SIEMPRE el borrador del alta, y el del upgrade solo si habia actualizacion.
7. `altaCerrarPanelPostExito` con `limpiarVistaClientes` cierra dos veces, y `pcAbrirUpgradeFiscal` cierra (`ocultarTodasLasVistas`) justo antes de abrir: idempotente.
8. Plegar el alta (`abrirAcordeonAlta` con el panel visible) es un medio cerrar SIN transicion: oculta el panel y cierra el borrador del alta, pero no recoge el nodo ni toca el modo, el boton o el banner.

### Lo que sigue siendo cableado de `app.js`, y por que

- QUE boton o pintor dispara QUE transicion: eso cuidan las pruebas de texto que quedan (#489-1, #489-2, AD6, AD7, C16b, #432-2/-3 en su mitad de orden, #489-3 en el caso `recogerPanel`).
- Mostrar el panel al abrir, plegarlo y prestarlo a la vista Clientes (`moverPanelA`): dependen de la vista y del toggle, no del modo.
- Los borradores de abrir la actualizacion (`alta-completa` con `ocultar: false`) y de la lograda (`vaciarCamposSuperficie` + `ENVIO_EXITOSO`): van pegados al vaciado de la superficie, que no es del vocabulario.
- `aperturaDelAlta` se queda como consulta aparte (#540): escribe `altaState.datos`, que no es `modoAlta`, y absorberla moveria `altaPintarConstanciaVacia` antes del reinicio de #192, del que depende su pintura.

**Orden.** Las acciones corren junto a su transicion, unas lineas antes que en el codigo de antes: en `pcAbrirUpgradeFiscal` el banner, el candado, las palomas y el boton van antes del regimen, el `display:block` y `altaTabSwitch`; en `altaReiniciarPanel` el boton, las palomas y el candado van antes del regimen, `altaCsfPintarStatus` y `altaPasosReset`; en el cierre los borradores se cierran despues de cambiar el estado, y `recogerPanel` junta el `display:none` (antes lo primero) con el regreso a `_panelHome` (antes lo ultimo) al principio de la lista. Ninguna de esas funciones lee el candado, las palomas, el boton, el banner ni `modoAlta.clienteId`, los helpers del borrador no dependen de donde este el nodo y todo es sincrono: nada observable cambia.

## Nota 2026-10-06: las asimetrias decididas (#542)

La tabla de veredictos de abajo la aprobo Adrian el 2026-10-06; el diseno de las filas 3, 4 y 5 se aprobo en el punto de revision del issue. Diez filas se unificaron y siete se DECLARAN: son el comportamiento elegido, no un pendiente.

| # | Camino / que no hacia | Veredicto | Como quedo |
|---|---|---|---|
| 1 | Estado muerto: `confirmado`, `fileName`, `mensaje` | Unificar | Fuera de `MODO_ALTA_INICIAL` (11 llaves), de las transiciones y de `sinConstancia` / `estadoTrasErrorLectura`. El texto del error viaja a `altaCsfPintarStatus` por `opts` |
| 2 | Plegar sin transicion (`abrirAcordeonAlta` con el panel visible) | Unificar | La rama no existe; sus dos llamadores ya no fuerzan `display:none` |
| 3 | Escrituras tardias de la precarga y del PUT logrado | Unificar | Guarda por `clienteId`: `actualizacionVigente` (ver abajo) |
| 4 | Abrir el alta a medias no reponia progreso | Unificar | `progresoDelAlta` + `altaReponerProgreso` (ver abajo) |
| 5 | Abrir el alta alternaba la Seccion 1 | Unificar | `altaAbrirSeccion`: abre, nunca alterna |
| 6 | La lograda no reencendia "Dar de alta" ni ocultaba el banner | Unificar | `alLograrActualizacion` -> `[boton, banner null]` |
| 7 | La lograda no recoge el panel | Declarar | Decision 1 |
| 8 | Abrir la actualizacion no limpiaba `rfc` | Unificar | `alAbrirActualizacion` parte de `sinConstancia` |
| 9 | El reinicio #192 no quitaba la marca del upgrade | Unificar | `alReiniciarAlta` = `sinConstancia` |
| 10 | La precarga sobrevivia a cerrar y a "Crear nuevo"; "Actualizar este" no tocaba el origen | Unificar | `comercialPrecargado: undefined` al cerrar y en "Crear nuevo"; `origen: null` en "Actualizar este" |
| 11 | "Actualizar este" no marca la constancia, no limpia palomas ni pone banner | Declarar | Decision 2 |
| 12 | Cerrar no canda ni limpia palomas | Declarar | Decision 3 |
| 13 | La lograda no anula la lectura en curso; lectura sin RFC deja el `rfc` anterior; empezar una lectura deja los datos anteriores | Declarar | Decision 4 |
| 14 | El error de lectura conserva la marca; vaciar la quita | Declarar | Decision 5 |
| 15 | Cierre doble idempotente; borrador del upgrade solo con id | Declarar | Decisiones 6 y 7 |

### Decisiones (lo que se declara y se deja)

1. La actualizacion lograda no recoge el panel (pantalla 4, mitad b): el reporte de #407 se inserta junto al panel, y recogerlo lo mandaria al paso Cliente.
2. "Actualizar este" no marca la constancia, no limpia palomas ni pone banner (modo 3 = constancia 3 = pantalla 3): el alta sigue siendo el alta, y la marca llega solo si el PUT se logra.
3. Cerrar no canda ni limpia palomas (pantalla 2): un alta a medias conserva su avance (#185). Desde #542 abrir el alta tambien REPONE ese avance desde `altaState`.
4. La lograda no anula la lectura en curso (constancia 2); una lectura sin RFC deja el `rfc` anterior (constancia 6); empezar una lectura deja los datos anteriores (constancia 7): carreras que el siguiente paso corrige, y durante `loading` se ve el spinner.
5. El error de lectura conserva la marca del upgrade y vaciar a mano la quita (constancia 9): decision de #516.
6. El cierre doble es idempotente (pantalla 7).
7. El borrador del upgrade se cierra solo si habia `clienteId` (pantalla 6).

### La guarda de las escrituras tardias (fila 3)

`actualizacionVigente(m, clienteId)` = `m.clienteId != null && m.clienteId === clienteId`: el id es la identidad, sin contador, el patron de `lecturaVigente`. `alPrecargarComercial(m, clienteId, pre)` y `alLograrActualizacion(m, clienteId, lectura)` no escriben el modo (`clienteId`, `origen`, `comercialPrecargado`) ni piden pantalla cuando la actualizacion ya no es la de ese cliente. La marca SI sigue a la constancia: la lograda tardia la marca suya si la constancia en memoria es la que viajo (`lecturaVigente(m, lectura)`, con la lectura que se leyo antes del PUT) y nadie la marco; si en medio se abrio otra actualizacion, la marca ya es de esa. Sin esa excepcion, la constancia que "Actualizar este" escribio en A, con el panel cerrado antes de que volviera el PUT, la mandaria el siguiente alta por POST como cliente nuevo (#491).

En `app.js` la transicion corre siempre y `actualizacionVigente` se pregunta para la pantalla. La precarga tardia no pinta nada: ni la Seccion 2 ni el aviso de la fallida. La lograda tardia mata solo la LLAVE de su borrador (`matarBorradorFormulario`: `vaciarCamposSuperficie` escribiria en la Seccion 1 del panel abierto y `cerrarFormularioBorrador`, aun sin ocultar, le taparia su aviso de constancia; basta porque ese cliente ya paso por `alCerrarPanel`, y todo camino que abre otro pasa antes por cerrar), aplica su transicion, consume `altaState.datos` si la transicion dejo la constancia marcada como suya, y adopta los cambios en `pcState.cliente` (`pcAdoptarUpgradeFiscal`, guardado por id). No vacia ni oculta el panel, no toca la Seccion 2, no pinta tarjeta ni reporte, y no llama `cvAdoptarUpgradeFiscal`, que con la tarjeta de la vista Clientes escribe sin mirar el id. El error tardio (la respuesta no lograda y "Error de conexion") tampoco se pinta.

### El avance del alta a medias (filas 4 y 5)

`progresoDelAlta(altaState)` (`alta-logica.js`) -> `{ palomas, desbloquear, abrir }`. La paloma 2 y la Seccion 3 salen de `altaState.comercialConfirmado`, campo nuevo que escribe `altaConfirmarComercial` solo en modo alta (el mismo boton se ve en la Seccion 2 de una actualizacion) y que sueltan el reinicio #192 y la actualizacion lograda, que vacia la Seccion 2; la paloma 3 y la Seccion 4, de `altaState.domicilio`. La Seccion 1 no aporta paloma ni desbloqueo: tras la actualizacion su constancia ya se descarto (#491), sin actualizacion en medio nada se borro, y `datos` se escribe ANTES de la dedup, que puede seguir sin decidir. Solo decide `abrir`: la primera seccion sin confirmar. `abrirAcordeonAlta` lo pinta con `altaReponerProgreso` (solo agrega: candar y limpiar son del reinicio, que parte de cero; la Seccion 3 vuelve al modo del domicilio elegido, #371) y abre con `altaAbrirSeccion`, que respeta el candado y no alterna; si la seccion a abrir sigue candada (la 2 con la dedup sin decidir), abre la 1. Es cableado y no accion del vocabulario: el progreso es de `altaState`, no de `modoAlta`. `pcAbrirUpgradeFiscal` tambien abre con `altaAbrirSeccion(1)`.

Tras pasar por una actualizacion, la Seccion 1 sale vacia y ABIERTA, con la paloma 2 de vuelta y la Seccion 3 desbloqueada a un clic: el acordeon abre una seccion a la vez y la que falta es la 1, sin la cual "Dar de alta" no avanza (`altaDarDeAlta` se detiene sin RFC).

### Consecuencias aceptadas

1. Cerrar A y volver a abrir A antes de que vuelva su PUT hace vigente al PUT viejo: corre la rama completa (vacia la Seccion 1 recien reabierta y oculta el panel). Aceptado por "sin contador": es el mismo cliente y el PUT si se escribio.
2. Un error tardio de una actualizacion ya cerrada se pierde en silencio, y el `finally` reenciende `csf-btn-confirmar` en el panel que este abierto: es el mismo boton de la Seccion 1 y solo `pcEjecutarUpgradeFiscal` lo apaga y lo enciende; guardado, el siguiente alta lo encontraria muerto. La ventana de doble envio queda abierta.
3. La captura manual no tiene `lectura`, asi que la lograda tardia no la marca (antes si se marcaba). Dano bajo: el siguiente alta cae en la dedup por el RFC real del cliente, no en un POST silencioso.
4. Las pruebas de #491/#516 en `alta-panel-estado.test.cjs`, que la nota de #540 declaro intactas, perdieron las llaves `fileName`, `confirmado` y `mensaje` de sus literales (y #516-3 su afirmacion del mensaje, con su titulo); es la unica excepcion. #491-6 se reescribio sin la rama de plegar.
