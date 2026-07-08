# PROCESO COMERCIAL ACTUAL DE PELTRE NACIONAL
# Version AS-IS para que un LLM entienda el proceso tal como funciona hoy


# 1. Contexto general

Peltre Nacional fabrica y vende piezas de peltre bajo la marca pp.peltre.

El proceso comercial aplica principalmente para clientes de mayoreo, es decir, clientes que compran 100 piezas o mas.

Los clientes de menos de 100 piezas normalmente se consideran menudeo y se mandan a comprar por Shopify.

---

# 2. Datos comerciales correctos

Correo comercial:

contacto@pppeltre.mx

WhatsApp de ventas:

+52 720 787 0782

---

# 3. Sistemas que se usan

## 3.1 Operam

Operam es el ERP.

Los modulos de Operam son:

- Ventas
- Compras y Gastos
- Articulos e Inventario
- Manufactura
- Bancos
- Contabilidad

En Operam se manejan documentos como:

- cotizacion
- pedido
- factura
- pago
- nota de entrega

La idea es que los documentos queden ligados entre si.

Por ejemplo:

cotizacion -> pedido -> factura -> pagos -> nota de entrega

---

## 3.2 Bitrix24

Bitrix24 es el CRM.

Hay dos pipelines.

---

## Pipeline 1: Prospectos

Etapas:

1. No Asignado
2. Registrado
3. Primer Contacto
4. Reunion Diagnostico

En cualquier etapa del pipeline de Prospectos, el prospecto puede irse a:

- Prospecto No Util
- Pipeline de Negociaciones

---

## Pipeline 2: Negociaciones

Etapas:

1. Hacer Cotizacion
2. Presentar Cotizacion
3. Seguimiento
4. Anticipo pagado | OC Recibida
5. Produccion Liberada
6. Saldo pagado
7. Producto entregado

En cualquier etapa del pipeline de Negociaciones, la negociacion puede cerrarse como:

- Cerrado Ganado
- Cerrado Perdido
- Analizar la falla

---

## 3.3 Shopify

Shopify se usa para:

- venta directa de menudeo
- pagina web
- chatbot
- formulario de mayoreo
- resenas / encuestas de satisfaccion

La app para encuestas se llama:

Revie
https://revie.ai/

Revie manda la encuesta 10 dias despues de que el pedido fue enviado.

---

## 3.4 Envia.com

Envia.com se usa para:

- cotizar envios
- generar guias
- mandar links de rastreo
- gestionar reclamos de paqueteria

---

## 3.5 Lalamove

Lalamove se usa para algunas entregas locales.

El problema con Lalamove es que debe haber alguien disponible para recibir el producto.

Ademas, el chofer puede traer otras rutas. Entonces es dificil calcular bien la hora estimada de llegada.

Si no hay nadie para recibir, puede fallar la entrega. Eso genera molestia con el cliente y tambien genera costo, porque se cobra el regreso al origen y luego se cobra otro intento de entrega otro dia.

---

## 3.6 Calculadora de cajas

Hay una calculadora interna en Excel.

Se usa para estimar:

- cuantas cajas se necesitan
- medidas aproximadas de las cajas
- peso aproximado del envio

Esto se usa antes de cotizar el envio en Envia.com.

---

# 4. Como llegan los prospectos

Los prospectos pueden llegar por:

- anuncios de Meta Ads
- pagina web
- chatbot
- formulario de mayoreo
- boton de WhatsApp
- Instagram
- Facebook Messenger
- correo electronico
- WhatsApp

---

# 5. Registro del prospecto en Bitrix24

Cuando llega un prospecto, el vendedor debe registrarlo en Bitrix24.

Datos que debe registrar:

- nombre del prospecto
- primer apellido
- nombre de la compania
- tipo de cliente
- ciudad
- cantidad estimada de piezas totales
- correo electronico
- numero de WhatsApp
- temperatura del prospecto, del 1 al 5

La cantidad estimada se clasifica asi:

- +100 piezas
- +350 piezas
- +550 piezas
- +1,500 piezas

---

# 6. Calificacion inicial: menudeo o mayoreo

Lo primero es saber si el cliente esta buscando menudeo o mayoreo.

## Menudeo

Si el cliente quiere menos de 100 piezas, normalmente se le resuelven dudas y se le manda a comprar por Shopify.

## Mayoreo

Si el cliente quiere 100 piezas o mas, entra al proceso comercial de mayoreo.

---

# 7. Tipos de clientes de mayoreo

Los clientes de mayoreo pueden ser, por ejemplo:

- restaurantes
- hoteles
- cafeterias
- tiendas
- ecommerce
- agencias de marketing
- proyectos promocionales
- distribuidores

Los segmentos principales son:

1. HoReCa: restaurantes y hoteles
2. Retail: tiendas fisicas o ecommerce que revenden producto
3. Proyectos promocionales: empresas o agencias que quieren producto con logo o personalizacion
4. Distribuidores: clientes que compran volumenes grandes

---

# 8. Informacion inicial que se le pide al cliente

Al prospecto de mayoreo se le pide entender:

- que tipo de proyecto tiene
- que tipo de cliente es
- cuantas piezas necesita aproximadamente
- que modelos quiere
- que colores quiere
- si ya tiene definida la combinacion de modelos, colores y cantidades

Normalmente se le manda el catalogo PDF.

El catalogo incluye:

- presentacion de Peltre Nacional
- modelos disponibles
- colores disponibles
- ejemplos de proyectos
- clientes relevantes

---

# 9. Restricciones importantes del producto

## 9.1 Modelos especiales

Peltre Nacional no fabrica modelos especiales para pedidos normales.

El cliente debe escoger modelos existentes.

La razon es que desarrollar un troquel nuevo puede costar aproximadamente de 300,000 a 500,000 pesos.

---

## 9.2 Colores especiales

Normalmente tampoco se desarrollan colores nuevos para pedidos normales.

La razon es que los oxidos son costosos y tienen MOQ muy altos.

Solo se considera desarrollar un color nuevo si el pedido es suficientemente grande o estrategico.

---

# 10. Listas de precios por volumen

Las listas de precios se manejan segun el volumen total de piezas.

- M100: para pedidos de 100 piezas o mas. Precio: 70% del precio de lista.
- M350: para pedidos de 350 piezas o mas. Precio: 60% del precio de lista.
- M550: para pedidos de 550 piezas o mas. Precio: 50% del precio de lista.
- M1500: para pedidos de 1,500 piezas o mas. Precio: 45% del precio de lista.
- M6000: para pedidos de 6,000 piezas o mas. Precio: 40% del precio de lista.

---

# 11. Preparacion de la cotizacion

Cuando el cliente ya tiene mas o menos claro:

- modelo
- color
- cantidad

se prepara la cotizacion en Operam.

Si el cliente todavia no tiene datos fiscales cargados, se puede hacer la cotizacion con cliente generico.

La cotizacion tiene una vigencia de 4 semanas.

---

# 12. Calculo del envio

Para calcular el envio:

1. Se copian los SKUs y cantidades a la calculadora de cajas.
2. La calculadora estima numero de cajas, medidas y peso.
3. Con esa informacion se cotiza en Envia.com.
4. El costo del envio se agrega a la cotizacion.

El seguro normalmente se declara por el 25% del valor del pedido.

No se asegura el 100% porque subiria mucho el costo del envio.

---

# 13. Condiciones comerciales

Las condiciones estandar son:

- 50% de anticipo para iniciar produccion
- 50% de saldo antes de enviar

Tiempos de fabricacion:

- producto estandar: 4 semanas desde el anticipo
- producto con calca: 6 semanas desde el anticipo

Para pedidos mayores de 1,500 piezas, el tiempo de fabricacion puede incrementarse.

La logica comercial es EXW, es decir, el producto se entrega en fabrica y el riesgo del transporte lo asume el cliente.

---

# 14. Confirmacion de la cotizacion

El cliente revisa la cotizacion.

Debe validar:

- modelos
- colores
- cantidades
- precio
- envio
- condiciones de pago
- tiempo de entrega

Si hay errores o cambios, se ajusta la cotizacion.

---

# 15. Alta del cliente en Operam

Antes de convertir la cotizacion en pedido, se necesita cargar bien al cliente.

Se solicita constancia de situacion fiscal.

Datos fiscales:

- razon social
- RFC
- regimen fiscal
- uso de CFDI
- metodo de pago
- lista de precios

Datos de contacto:

- correo
- WhatsApp
- contacto comercial

Direccion de entrega:

- calle
- numero
- colonia
- estado
- codigo postal
- referencias

Tambien se registra la persona que recibe:

- nombre
- apellido
- celular
- codigo pais

La direccion se valida en Google Maps.

---

# 16. Facturacion

El esquema normal es hacer una factura total en PPD.

Despues se generan complementos de pago:

- uno por el anticipo
- otro por el saldo

Tambien existe la alternativa de:

- factura de anticipo
- factura final
- nota de credito

pero el esquema estandar es factura total PPD con complementos.

---

# 17. Conversion de cotizacion a pedido

Cuando el cliente paga el anticipo:

1. El vendedor pide comprobante.
2. Adrian confirma que el deposito cayo.
3. Adrian revisa que los datos esten completos.
4. La cotizacion se convierte en pedido en Operam.

Antes de convertir a pedido, Adrian revisa:

- datos fiscales
- uso de CFDI
- regimen fiscal
- direccion de entrega
- persona que recibe
- telefono con codigo pais correcto

Cuando se convierte en pedido, produccion ya lo puede ver en Operam.

---

# 18. Conciliacion y factura

La contadora Adriana Siliceo concilia pagos.

Ella:

- revisa movimientos bancarios
- identifica el pago
- emite factura
- registra pagos en Operam

Idealmente el cliente pone la referencia de la cotizacion en la transferencia.

---

# 19. Produccion

Produccion ve el pedido en Operam en la parte de pedidos pendientes.

A partir de ahi fabrica el pedido conforme a la fecha comprometida.

---

# 20. Pedido listo y solicitud de saldo

Cuando produccion ya tiene el pedido listo o casi listo, avisa en el grupo de WhatsApp comercial.

Ventas solicita al cliente el pago del saldo.

Adrian confirma cuando el saldo ya quedo pagado.

Sin saldo pagado no se libera el envio.

---

# 21. Envio

Cuando el saldo esta pagado, se libera el envio.

Produccion genera la guia en Envia.com.

Envia.com normalmente manda al cliente:

- WhatsApp
- link de rastreo

Si el envio es por Lalamove, ventas debe avisar manualmente al cliente porque no funciona igual que una paqueteria tradicional.

---

# 22. Entrega y nota de entrega

Produccion registra la nota de entrega en Operam.

La entrega puede ser:

- total
- parcial

Si es parcial, el pedido debe seguir abierto hasta entregar todo.

---

# 23. Cierre en Bitrix24

El vendedor mueve la negociacion en Bitrix24 segun el avance real.

Cuando el pedido ya fue entregado correctamente, se puede cerrar como Cerrado Ganado.

Si se pierde, se puede cerrar como Cerrado Perdido.

Si hay algo que revisar, se puede mandar a Analizar la falla.

---

# 24. Encuesta de satisfaccion

Para clientes de Shopify, Revie manda encuesta 10 dias despues de que el pedido fue enviado.

La encuesta sirve para pedir calificacion y resena.

---

# 25. Revision del pedido por el cliente

Cuando el cliente recibe el pedido, debe revisarlo lo antes posible.

Debe revisar:

- si las cajas llegaron danadas
- si el empaque interno esta danado
- si hay piezas rotas, golpeadas o danadas

---

# 26. Reclamo por dano en envio

Si hay dano, se le pide al cliente evidencia.

Fotos necesarias:

- fotos de las 6 caras de la caja
- foto de la guia visible
- fotos del empaque interno
- fotos de las piezas danadas

Tambien debe indicar:

- que SKUs se danaron
- cuantas piezas se danaron por SKU

Con eso se evalua si conviene levantar reclamo en Envia.com.

---

# 27. Criterio ante danos

La prioridad es resolverle al cliente.

Primero se busca reponer.

Despues se decide si vale la pena meter reclamo formal con la paqueteria.

Opciones:

1. reponer con stock disponible
2. usar calcas sobrantes
3. pedir a Vitromugs calcas sobrantes del mismo trabajo
4. mandar hacer nueva corrida de calcas
5. hacer nota de credito
6. reembolso como ultima opcion

---

# 28. Pedidos de reposicion

Si se necesita reponer producto, se crea un pedido nuevo en Operam.

La referencia se escribe asi:

P + numero del pedido original + "-R"

Ejemplo:

P4490-R

Esto permite que produccion lo vea como pedido normal, pero que internamente se sepa que es una reposicion.

---

# 29. Proceso de pedidos con calca vitrificable

Cuando el cliente quiere un logo, diseno o personalizacion con calca, el proceso se vuelve distinto.

El proveedor externo es Vitromugs:

https://www.vitromugs.com.mx/

Vitromugs produce las calcas vitrificables.

El documento que Vitromugs usa para produccion se llama:

Orden de Trabajo.

---

# 30. Variables para cotizar calca

Para cotizar calca se necesita saber:

- tamano de la calca
- numero de tintas
- cantidad de calcas iguales
- diseno

Los rangos de area son:

- 1/8: hasta 25 cm2
- 1/4: hasta 50 cm2
- 1/2: hasta 100 cm2
- 1/1: hasta 200 cm2

---

# 31. Restriccion de calcas iguales

El pedido minimo de Vitromugs es de 100 calcas iguales.

Iguales significa:

- mismo diseno
- mismo tamano
- mismos colores
- mismo numero de tintas

Si cambia el tamano, color o diseno, ya cuenta como otra calca.

---

# 32. Requisitos del archivo de diseno

El archivo debe venir en Adobe Illustrator.

Debe estar:

- vectorizado
- con textos en curvas
- en centimetros
- a escala real 1:1
- con colores del circulo cromatico, cuando aplique

---

# 33. Wireframes

Peltre Nacional puede entregar al cliente o disenador un archivo de Illustrator con wireframes de las piezas.

Estos wireframes tienen:

- medidas reales
- escala 1:1
- guia para colocar el diseno correctamente

Esto ayuda a que el disenador no mande algo fuera de proporcion o dificil de aplicar.

---

# 34. Formato de posicion de calca

El Formato de posicion de calca es clave.

Se hace en Illustrator.

Sirve para:

- mostrar al cliente donde va la calca
- definir tamano
- definir posicion
- aprobar visualmente el diseno
- mandar a Vitromugs
- mandar a produccion

Se guarda como:

- archivo AI
- PDF

El PDF se puede mandar al cliente para aprobacion.

El formato tambien se imprime o se comparte con produccion para que sepan exactamente donde aplicar la calca.

---

# 35. Cotizacion con Vitromugs

Cuando ya se tiene el archivo o una idea clara del diseno, se manda a Vitromugs.

Normalmente se manda por WhatsApp.

Debe quedar claro si se esta pidiendo:

- solo cotizacion
- o ya produccion confirmada

Vitromugs responde con precio.

Peltre Nacional valida ese precio y lo integra a la cotizacion del cliente.

---

# 36. Despues del anticipo en pedidos con calca

Cuando el cliente ya aprobo y pago anticipo:

1. Se confirma a Vitromugs que el trabajo si va.
2. Se confirma cantidad por diseno.
3. Se manda o reenvía el arte aprobado.
4. Vitromugs manda dummy.
5. Se revisan medidas y codigos de tintas.
6. Se da visto bueno.
7. Vitromugs libera su Orden de Trabajo.

---

# 37. Dummy de Vitromugs

El dummy sirve para confirmar:

- tamano
- dimensiones
- colores
- codigos de tintas

Antes de producir todas las calcas, se revisa que todo este correcto.

---

# 38. Produccion de calcas

Cuando ya esta aprobado el dummy, Vitromugs produce:

- positivos
- mallas
- serigrafia
- calcas

Luego entrega las calcas a Peltre Nacional.

---

# 39. Recepcion de calcas

Cuando llegan las calcas, se debe revisar:

- cantidad correcta
- interfoliado correcto
- defectos visibles
- dimensiones correctas segun el Formato de posicion de calca

Esto se revisa antes de pasarlas a produccion.

---

# 40. Prueba en mufla

Antes de aplicar todas las calcas, se hace una prueba.

Se aplica una calca a una pieza y se mete a la mufla.

Esto sirve para revisar:

- color final
- registro
- cobertura
- si la tinta cubre bien
- si se hizo doble pasada cuando era necesario

Por ejemplo, si se aplica una calca clara sobre fondo oscuro, puede necesitar doble pasada.

---

# 41. Problemas posibles con calcas

Pueden pasar problemas como:

- color incorrecto
- tinta equivocada
- fuera de registro
- baja cobertura
- falta de doble pasada
- dimensiones incorrectas

Si el problema viene de Vitromugs, se pide reposicion urgente.

Si el problema afecta tiempos, se comunica al cliente con claridad.

---

# 42. Comunicacion con cliente en pedidos personalizados

En pedidos con calca es muy importante mantener informado al cliente.

Si hay retrasos o problemas, se le debe avisar.

Se pueden mandar fotos para explicar:

- que salio mal
- que se esta corrigiendo
- como quedo la prueba
- que impacto tiene en tiempo

La idea es controlar la comunicacion y que el cliente vea que el tema se esta atendiendo.

---

# 43. Muestras

Si el cliente quiere muestra, se puede hacer.

Costo:

600 pesos por diseno

Ademas se cobran:

- piezas
- paqueteria

Tiempo:

2 a 4 semanas

La muestra incluye una ronda de cambios.

Para muestras, el pago es 100% anticipado.

El flujo es parecido a un pedido normal:

cotizacion -> pago -> pedido -> factura -> produccion -> envio

---

# 44. Muestra durante produccion

A veces el cliente pide ver una muestra cuando el pedido ya esta corriendo.

En ese caso se puede pedir a Vitromugs una muestra antes del tiraje completo.

Peltre Nacional la quema en la mufla, toma buenas fotos y se las manda al cliente.

Esto permite validar visualmente sin frenar demasiado el proceso completo.
