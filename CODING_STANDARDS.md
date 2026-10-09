# Estandares de los modulos de dominio

Reglas de criterio para los modulos que dan cuerpo a un termino del glosario (`GLOSSARY.md`): hoy **Alta de cliente** (`lib/alta-cliente.js`), **Subida del quote** (`lib/subida-quote.js`), **Modo del alta** (`public/js/modo-alta-logica.js`) y **Contactos en Operam** (`lib/contactos-operam.js`, con su nucleo puro `lib/contactos-operam-logica.js`) y **Fusion de Contactos** (`lib/fusion-contactos.js`, #565). Las aplica `/code-review` a todo modulo de dominio nuevo o tocado. Cada regla cita la decision de donde sale; el detalle y las opciones descartadas viven en el ADR.

Un modulo de dominio nuevo se agrega a la lista de arriba y a `MODULOS_DE_DOMINIO` en `test/modulos-dominio.test.js`.

## 1. Un termino, un modulo

Un concepto del glosario vive en UN modulo, que es la unica puerta para leerlo y escribirlo. Si la misma secuencia aparece en dos lugares, uno de ellos sobra: los caminos distintos son la misma operacion con distinta riqueza de datos, no copias. (ADR-0017: tres altas en `server.js` habian divergido sin razon de dominio; ADR-0022; ADR-0024: Contactos en Operam como puerta unica.)

## 2. Devuelve valores, nunca HTTP

El modulo devuelve un valor que describe lo que paso; nunca un status, un `res` ni un cuerpo de respuesta. El handler solo traduce valor -> status/codigo/cuerpo, y lo que el navegador necesita para reintentar lo arma el handler, no el modulo. **Regla mecanica**: un modulo de dominio no importa Express ni `server.js`, ni directo ni a traves de lo que importa; la hace cumplir `test/modulos-dominio.test.js`. (ADR-0017, ADR-0022.)

## 3. Tres desenlaces

Una operacion que escribe termina en uno de tres desenlaces: **lograda** (con su reporte de pasos; puede llevar aviso), **pregunta al vendedor** (las opciones entre las que elige y lo necesario para reintentar con su decision) o **bloqueo con motivo** (antes de escribir lo que no debe escribirse). Un fallo secundario despues de lo esencial no convierte la operacion en bloqueo: queda lograda con aviso. (ADR-0017; ADR-0022; ADR-0024: la falla del contacto deja la subida lograda con aviso.)

## 4. Costura `deps = {}` con adaptador en memoria

Las dependencias con IO (Operam, Neon, la web legacy, stores) entran por `deps = {}` con fallback a las funciones reales; las que solo el caller puede resolver son obligatorias y sin fallback. Las pruebas usan un adaptador en memoria en `test/helpers/` que implementa las MISMAS dependencias e imita los quirks medidos de Operam (lo que acepta y no escribe, las formas reales de sus respuestas), sin tocar `globalThis.fetch`. (ADR-0017: `test/helpers/operam-memoria.js`; ADR-0022; ADR-0024.)

## 5. Una regla, una prueba

Cada regla del modulo tiene su prueba por la interfaz del modulo contra el adaptador en memoria, vista en rojo primero; la ruta HTTP prueba solo su traduccion. Las pruebas HTTP que pasan por la ruta para probar OTRO modulo se quedan. (ADR-0017; nota 2026-10-03 de ADR-0022, #527.)

## 6. Relee y compara siempre

Un 200 o `result: true` de Operam no garantiza nada: despues de escribir, el modulo relee por donde Operam de verdad expone el dato y compara; lo que no quedo se reporta como no aplicado con su motivo real. Lo que el modulo decidio no mandar no se reporta como ignorado. (ADR-0017: verificar el domicilio de entrega releyendolo, siempre; ADR-0024.)

## 7. Mensaje en dos capas

Cada paso, bloqueo, pregunta o campo no aplicado lleva un `mensaje` con las palabras del glosario para el vendedor y un `detalle` tecnico para depurar; la pantalla muestra el primero y pliega el segundo. Nada de `err.message` crudo ni nombres de endpoint en el texto del vendedor. (ADR-0017; ADR-0024.)

## 8. Limites escritos

El ADR del modulo dice que esta dentro y que fuera, y el modulo lo respeta: lo que es de otro concepto lo consume como resultado o como `deps`, no lo reimplementa. (ADR-0017: el POST del quote y la vigencia son de la Subida del quote; ADR-0022: el registro de la cotizacion es de la subida; ADR-0023: un solo punto escribe el Modo del alta.)

## 9. Mudanzas sin cambio de comportamiento

Mover codigo a un modulo es un cambio invisible: mismas respuestas, mismos textos, mismas asimetrias. Las pruebas que ya existian se quedan como red durante la mudanza; lo que haya que corregir se decide en su propio ticket. (ADR-0022: las pruebas HTTP conviven como red; ADR-0023: cada transicion reproduce su camino, con sus asimetrias.)
