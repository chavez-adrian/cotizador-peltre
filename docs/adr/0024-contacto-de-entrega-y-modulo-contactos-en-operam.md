# ADR-0024: El Contacto de entrega vive en el domicilio, el quote lo lleva siempre explícito, y los Contactos en Operam tienen un solo módulo

## Status

Accepted (2026-10-09). Complementa ADR-0016 (y lo enmienda: ver allí), ADR-0017 (Alta de cliente) y ADR-0022 (Subida del quote). Reabre #467. Origen: triage de #556 y sesión de `grill-with-docs` + `domain-modeling` con Adrián el 2026-10-09, con tres mediciones en vivo sobre el Cliente Operam 15 (quotes 1333-1356 y pedido 7789, todos cancelados; scripts y lecturas fuera del repo).

## Context

#556: la Cotización 1330 nació en Operam con el teléfono del contacto General del Cliente Operam, aunque su contacto de entrega no tenía teléfono, y al actualizarla el teléfono quedó vacío. La palabra "contacto" nombraba tres cosas (el Contacto del cotizador, cualquier Contacto en Operam, y la persona que recibe) y #329, #523, #425 y #556 rozaban el mismo hueco sin nombrarlo.

Medido el 2026-10-09:

- `POST /api/v3/sales/quote` **ignora** `contact_phone` y `contact_email` del payload (la verificación en vivo de #329 nunca se corrió). Los deriva del contacto del **domicilio**: el rol Pedidos gana sobre General aunque no tenga teléfono; dentro del mismo rol gana el registro de rol más antiguo, y volver a guardar un contacto en la web lo manda al final; Entrega y Facturación no cuentan; copia el Teléfono principal, nunca el Cel; no cae al contacto del cliente.
- El formulario web de edición del quote (y el de conversión a pedido) prellena un campo vacío con el contacto General **del cliente**. La corrección de vigencia que corre tras crear (`corregirVigenciaQuote`) repostea ese formulario sin sustituir teléfono ni correo, y así lo graba: ese es el número de la 1330. La actualización sí los manda, y un vacío explícito se respeta.
- El pedido **copia** teléfono y correo del quote al convertirse; no los re-deriva. Quien genera la guía toma el teléfono de los datos del pedido en Operam. La cotización impresa usa `deliver_to` y los datos guardados en el quote; el pedido impreso (PREFACTURA) no imprime teléfono; la remisión los imprime vacíos (inferido de cinco remisiones reales).
- La API v3 no escribe contactos (501). La web legacy sí: editar y crear contactos del cliente (`/sales/manage/customers.php`) y del domicilio (`/sales/manage/customer_branches.php`). Editar no cambia el `person_id`; el id del renglón de rol en `contact_list` sí. Ligar al domicilio crea siempre una persona nueva ("Clonar" también): no hay forma de ligar una persona existente. La página de domicilios trae en el mismo formulario los botones que guardan o borran el domicilio.
- `POST /customers` crea un domicilio y una sola persona, ligada como General del cliente y del domicilio, con el nombre corto del Cliente Operam como nombre. 0 Clientes Operam sin domicilio y 0 sin contactos; 81 domicilios sin General con persona.

## Decision

**El término.** Entra **Contacto de entrega** al glosario: la persona que recibe la mercancía, elegida o capturada en el paso Envío; su nombre, teléfono y correo son los del documento y los del encabezado del quote.

**Reglas.**

1. El teléfono del Contacto de entrega es obligatorio para generar y para actualizar una cotización, igual que el domicilio de entrega; el correo es opcional.
2. Al elegir una persona, el selector propone **sus** números en el orden de ADR-0016 (Cel, Teléfono, Secundario). Nunca toma los del General ni de otra persona: si quien recibe es el General, se elige al General.
3. El encabezado del quote (`deliver_to`, teléfono, correo) se escribe **siempre explícito**, al crear y al actualizar, por la web legacy; nunca se deja a lo que derive Operam. El cotizador gana sobre lo editado a mano en el quote: las correcciones se hacen en el cotizador.
4. En la Subida del quote, el Contacto de entrega se escribe en Operam como Contacto en Operam **del domicilio de entrega**, con rol Entrega y General, y queda como el **único General** de ese domicilio. Al contacto desplazado se le quita el General; si era su único rol pasa a Entrega, y en sus Notas queda una línea fechada de quién lo reemplazó y desde qué cotización. La falla de este paso deja la subida lograda con aviso.
5. El número capturado se escribe en Cel y en Teléfono principal (práctica del equipo: el principal es el celular). Un Teléfono distinto que ya estaba pasa a Secundario; si el Secundario estaba lleno, se avisa que se pierde. Pisar cualquier valor no vacío pide confirmación explícita al generar, con el valor viejo a la vista. El nombre de una persona existente no se toca.
6. Si la persona elegida solo está ligada al Cliente Operam, se crea su copia en el domicilio y el cotizador guarda la liga con la persona de origen; las ediciones siguientes van a la copia y la de origen no se toca.
7. Un documento ya generado no cambia si después cambia el Contacto en Operam; al Editar, el selector propone los datos vivos y el vendedor decide.
8. El Alta de cliente deja a la persona que crea Operam como Contacto de entrega (nombre, números, correo, roles) con el mismo módulo, y la verificación relee al contacto, no al domicilio.

**El módulo.** `lib/contactos-operam.js` es **la única puerta** para leer y escribir Contactos en Operam, con la forma de ADR-0017 y ADR-0022: devuelve valores, costura `deps = {}` con adaptador real (web legacy para escribir, API para leer) y adaptador en memoria para las pruebas, relee y compara siempre, Mensaje en dos capas. El adaptador nunca manda los botones de guardar o borrar el domicilio y cierra su sesión web. Absorbe la lectura de #105 (`contactos-domicilio.js`) y los lectores sueltos que hoy no leen el Cel. Es la primera interfaz de Operam por concepto, la que ADR-0017 pospuso hasta tener un segundo consumidor: aquí hay tres (Subida del quote, paso Envío, Alta de cliente).

**Las reglas de los módulos de dominio** (las de ADR-0017, 0022 y 0023) se escriben en `CODING_STANDARDS.md` antes de construir el módulo, para que `/code-review` las aplique; la regla mecánica (el módulo no importa Express ni `server.js`) va como prueba.

## Considered Options

- **Sin teléfono de entrega, heredar el del General del Cliente Operam** (o la cascada entrega -> General). Rechazada: imprime junto a un nombre el número de otra persona, que es el bug de #370. Se resuelve obligando el teléfono.
- **Dejar que Operam derive el encabezado del quote del contacto del domicilio.** Rechazada: depende del orden de los registros de rol, un contacto de Pedidos vacío le gana a todo, y 81 domicilios no tienen General.
- **Dos General en el domicilio, ordenados para que gane el Contacto de entrega** (re-guardar el viejo con una nota). Rechazada: cualquier edición posterior en Operam invierte el orden sin aviso. La nota se conserva como rastro, no como mecanismo.
- **Pasar al desplazado a Pedidos, a Facturación, o borrarlo.** Rechazadas: Pedidos le gana al General en la derivación, Facturación cambia a quién llegan las facturas, y el borrado en Operam es definitivo.
- **Ligar la persona existente del cliente al domicilio.** Imposible en la web legacy (medido); de ahí la copia con liga de origen.
- **Contacto de entrega solo en el cotizador, sin escribir Operam.** Rechazada: Adrián prefiere obligar a mantener el maestro de contactos completo, y el cotizador pasa a ser el lugar para editarlo.
- **Corregir solo el POST del quote para #556.** Insuficiente: el POST ignora las llaves; el arreglo está en la corrección de vigencia.

## Consequences

- #556 se arregla primero y sin esperar al módulo: la corrección de vigencia manda teléfono y correo del Contacto de entrega, y el teléfono se vuelve obligatorio.
- Los quotes ya subidos con el teléfono heredado se corrigen solos solo si alguien los regenera (sin backfill, como #329).
- El cotizador empieza a escribir contactos del ERP: #467 se reabre y lo decidido aquí manda sobre su cuerpo.
- Quedan en espera, sin issue: sesiones web que se acumulan (`UsersLimit`, sin logout), dimensiones en 0 al reenviar la ficha del cliente, la verificación del alta que compara contra lo que no escribió, renglones General vacíos que deja cada `PUT /branches`, personas Entrega sin datos, y el webhook `Order/ADD` que disparó el pedido de prueba 7789.

## Enmienda 2026-10-09 (decisiones tras la revisión)

Adrián revisó la spec #557 ya construida y decidió seis cosas. Mandan sobre lo de arriba donde chocan.

- **D1 — La pregunta del General solo se resuelve confirmando.** Se quita la salida "conservar": mientras el vendedor no confirme, el Contacto de entrega queda pendiente (la marca `data.contactoEntregaPendiente` persiste) y la pregunta vuelve en cada subida. Un cuerpo con `conservar` de una pestaña vieja se ignora. El texto de la pregunta dice cómo evitar desplazar al General: elegirlo como Contacto de entrega en el paso Envío. *Por qué*: con "conservar" el domicilio se quedaba con un General que no recibe y el quote decía otra persona; la regla 4 deja de tener excepción.
- **D2 — El alta completa toma el nombre de quien recibe del Contacto del cotizador.** El formulario de la vista Clientes no captura quién recibe, pero sí el celular del Contacto: la persona que crea Operam toma el nombre del Contacto cuyo celular (últimos 10 dígitos) es ese; sin Contacto, conserva el suyo (el nombre corto). *Por qué*: el nombre corto de la empresa como nombre de una persona era el hueco que la regla 8 dejaba.
- **D3 — Generar o actualizar exige celular, nombre (sin apellido vale) y CP; la calle ya no.** Mismo bloqueo de #558, con el campo que falta en el orden del formulario. *Por qué*: en mostrador y en expo la calle muchas veces no se sabe al cotizar; sin nombre, en cambio, la persona no se puede escribir en Operam.
- **D3b — Sin calle, "Por definir".** El documento, el `delivery_address` del quote y la calle del domicilio que escribe el alta dicen "Por definir" (una constante); al leer de regreso cuenta como calle vacía. La leyenda "Favor de confirmar el domicilio de entrega" sigue. Una cotización ya subida sin calle cambia de huella al regenerar: es legítimo. *Por qué*: Operam y la paquetería necesitan un texto que diga que falta, no un domicilio que empiece por la colonia.
- **D4 — El cambio de celular se pregunta en palabras simples, nunca "fundir".** Todo cambio del número de identidad de la persona se pregunta, con lo que pasa en el cotizador ("todo lo del número viejo pasa al número nuevo: N oportunidades y M cotizaciones"). Si el número viejo también tiene oportunidades de otras personas (teléfono de oficina), la pregunta lo advierte y ofrece dos salidas: mover todo al número nuevo, o solo actualizar el celular en Operam sin tocar el cotizador. El servidor dicta los cuerpos; el paso se llama "Contacto movido al número nuevo" y el evento guarda la ficha anterior completa. *Por qué*: la Fusión de Contactos de #565 movía historia sin que el vendedor supiera qué se movía, y un teléfono compartido no es la identidad de una persona.
- **D5 — Sin cambio.**
- **D6 — Interruptor de la escritura.** La variable `CONTACTOS_OPERAM_ESCRITURA` vale `apagado`, una lista de ids de Cliente Operam (`15`) o `todos`; ausente es `apagado`. Gobierna toda escritura de Contactos en Operam (la Subida al crear y al actualizar, el alta, la copia) y el paso del número. Un Cliente Operam fuera del interruptor se queda como antes de esta spec: sin leer la web legacy, sin pregunta, sin marca y sin paso de contacto en el reporte (solo el log). No gobierna #556 ni D3/D3b. El panel `/admin` avisa mientras no esté en `todos`. *Por qué*: la escritura al maestro de contactos se enciende por partes (primero el cliente 15 de pruebas) y se puede apagar sin un deploy.
