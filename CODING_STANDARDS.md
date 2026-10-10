# Estandares de los modulos de dominio

Reglas de criterio que comparten los modulos de dominio del cotizador: los que nacen de un termino de `GLOSSARY.md` y encierran una secuencia que antes vivia repartida en `server.js` o en `app.js` (hoy `lib/alta-cliente.js`, `lib/subida-quote.js`, `lib/contactos-operam.js` y `public/js/modo-alta-logica.js`). Cada regla cita el ADR donde se decidio; si una regla y un ADR no coinciden, manda el ADR y esta pagina se corrige. `/code-review` las aplica a todo modulo de dominio nuevo o tocado.

La regla mecanica (un modulo de dominio no importa Express ni el servidor) la cuida una prueba: `test/modulos-dominio.test.js`. Un modulo de dominio nuevo se agrega a su lista.

## 1. Un termino, un modulo

El modulo lleva el nombre de un concepto del glosario (Alta de cliente, Subida del quote, Modo del alta, Contacto en Operam) y es el UNICO lugar donde vive su secuencia. Si la misma regla aparece en dos sitios, uno de los dos sobra: los callers consumen el modulo, no lo copian. Un concepto nuevo entra primero al glosario y despues al codigo. (ADR-0017, ADR-0022, ADR-0023, ADR-0024)

## 2. Devuelve valores, nunca HTTP

El modulo devuelve un valor con `tipo` (o un estado nuevo, en el navegador) y nunca un status HTTP: no recibe `req` ni `res`, no importa Express ni `server.js`. El handler solo traduce el valor a status, codigo y cuerpo, y el navegador no se entera del cambio. (ADR-0017, ADR-0022)

## 3. Tres desenlaces

Una operacion termina en uno de tres desenlaces: **lograda** (con el reporte de lo que hizo), **pregunta al vendedor** (con las opciones entre las que elige) o **bloqueo con motivo**. El modulo devuelve la decision que hace falta; el cuerpo exacto con el que el navegador reintenta lo arma el handler, para que el modulo no aprenda la forma del contrato HTTP. (ADR-0017)

## 4. Costura `deps = {}` con adaptador en memoria

Las dependencias con IO (Operam, la web legacy, los stores, el padron) entran por `deps = {}`, con las funciones reales como valor por omision. Las pruebas pasan un adaptador en memoria que implementa LAS MISMAS funciones (`test/helpers/operam-memoria.js`, `test/helpers/subida-quote-memoria.js`): sin `globalThis.fetch`, sin supertest. Un resolutor que solo existe en `server.js` (lo que lee el catalogo) es una dependencia obligatoria sin valor por omision, y el handler la pasa. (ADR-0017, ADR-0022)

## 5. Una regla, una prueba

Cada regla del modulo tiene su prueba por la interfaz del modulo, vista en rojo antes de escribir el codigo, con el valor esperado sacado del issue o de un caso conocido. Las reglas del modulo se prueban en el modulo; las pruebas de la ruta solo prueban la traduccion valor -> HTTP. (ADR-0017, ADR-0022 nota de #527)

## 6. Relee y compara, siempre

Un 200 o un `result: true` de Operam no garantiza nada: toda escritura se relee y se compara campo por campo, y lo que no quedo se reporta con su motivo en vez de darse por hecho. La verificacion no depende de una bandera que mande el navegador. (ADR-0017, ADR-0024)

## 7. Mensaje en dos capas

Cada paso, bloqueo, pregunta o campo no aplicado lleva un `mensaje` con las palabras del glosario (domicilio de entrega, Cliente Operam, Contacto de entrega; nunca "sucursal" ni `PUT branch`) y un `detalle` tecnico para depurar. La pantalla muestra el `mensaje` y pliega el `detalle`. El paso que no aplica sale `omitido` con su motivo. (ADR-0017)

## 8. Limites escritos

El ADR del modulo dice que queda DENTRO y que queda FUERA (que escribe y que no, quien escribe el registro de la cotizacion, que dispara al final), y el codigo lo respeta: lo que esta fuera se consume como resultado o entra por `deps`, nunca se reimplementa adentro. (ADR-0017, ADR-0022)

## 9. Mudanzas sin cambio de comportamiento

Mover una secuencia a un modulo es invisible para el vendedor: mismas URLs, status, cuerpos y textos. Las pruebas existentes se quedan como red durante la mudanza y se reducen en un ticket aparte. Las asimetrias que aparecen al juntar caminos se reproducen tal cual, se escriben en una tabla y cada una se decide en su propio ticket. (ADR-0022, ADR-0023)
