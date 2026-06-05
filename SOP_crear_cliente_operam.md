# SOP - Crear cliente en Operam

**Código:** SOP-COM-OPERAM-001  
**Versión:** 1.0 borrador  
**Fecha:** 2026-06-03  
**Área responsable:** Comercial / Administración  
**Fuente:** Documento Scribe `Crear cliente | Operam`, 25 páginas, 45 pasos.

Documento operativo para estandarizar el alta de clientes en Operam, reducir errores fiscales/comerciales y asegurar que los datos de contacto, domicilio y cuenta de ventas queden correctamente configurados.

---

## Índice

1. [Propósito y alcance](#1-propósito-y-alcance)
2. [Entradas requeridas antes de iniciar](#2-entradas-requeridas-antes-de-iniciar)
3. [Reglas críticas de captura](#3-reglas-críticas-de-captura)
4. [Procedimiento paso a paso](#4-procedimiento-paso-a-paso)
5. [Checklist final antes de cerrar el alta](#5-checklist-final-antes-de-cerrar-el-alta)
6. [Criterios de aceptación](#6-criterios-de-aceptación)
7. [Control documental](#7-control-documental)

---

## 1. Propósito y alcance

### Propósito

Crear clientes nuevos en Operam con información fiscal, comercial, logística y de contacto completa y consistente, antes de generar cotizaciones, pedidos, facturas, entregas o complementos de pago.

### Alcance

Aplica para todo cliente nuevo registrado en Operam: clientes nacionales, clientes extranjeros, restaurantes, hoteles, distribuidores, agencias, e-commerce, mostrador u otros segmentos comerciales.

### Resultado esperado

Al terminar el procedimiento, debe existir en Operam un cliente con:

- Cliente creado correctamente.
- Datos fiscales cargados desde SAT, cuando aplique.
- Lista de precios, segmento, vendedor y términos comerciales asignados.
- Contacto principal configurado.
- Domicilio operativo editado y validado.
- Cuenta de ventas correcta para México o extranjero.

---

## 2. Entradas requeridas antes de iniciar

| Dato | Uso en Operam | Validación mínima |
|---|---|---|
| RFC del cliente | Alta fiscal del cliente | Debe coincidir con la constancia fiscal o datos del SAT. |
| SAT IdCIF | Consulta y carga de datos fiscales | Debe corresponder al RFC capturado. |
| Lista de precios | Condiciones comerciales | Asignar la lista aprobada para el cliente. |
| Segmento de cliente | Clasificación comercial | Seleccionar el tipo real de cliente; no dejar `Sin segmento` salvo autorización. |
| Vendedor asignado | Responsabilidad comercial | Debe coincidir con quien dará seguimiento a la cuenta. |
| Método, forma y términos de pago | CFDI y cobranza | Debe coincidir con la negociación y reglas fiscales. |
| Email y teléfono principal | Documentos y comunicación | Teléfono con código de país; email sin errores de captura. |
| Domicilio postal / entrega | Guías, entregas y documentación operativa | No confundir con domicilio fiscal. Completar referencias si son necesarias. |
| País o zona de venta | Clasificación comercial y contable | México, USA, Canadá u otra región según corresponda. |

---

## 3. Reglas críticas de captura

> **Regla crítica:** No usar solo MAYÚSCULAS en campos no fiscales.
>
> En Operam, el domicilio fiscal y la razón social suelen aparecer en mayúsculas porque vienen del SAT. Para nombres cortos, contactos, direcciones postales o direcciones de envío, usar mayúsculas/minúsculas normales para no confundir información fiscal con información operativa.

### Reglas fiscales / CFDI

- **PPD:** si el método de pago es `PPD - Pago en parcialidades o diferido`, la forma de pago debe ser `99 - Por definir`.
- **PUE:** si el método de pago es `PUE - Pago en una sola exhibición`, seleccionar la forma de pago real que será usada en la transacción.
- **Uso de CFDI:** verificar que el uso de CFDI sea el indicado por el cliente antes de facturar.

### Reglas comerciales / logísticas

- El primer campo **Teléfono** se imprime en cotizaciones, pedidos, facturas y entregas; siempre debe estar lleno.
- Cuando el teléfono principal sea celular, capturarlo también en el campo **Celular**.
- Por lo general, el almacén predeterminado debe ser **PT**.
- Para clientes de México, por lo general usar zona de venta **10 México**.

> **Atención a domicilios:** Al crear un cliente, Operam puede generar automáticamente un domicilio usando el domicilio fiscal. Ese domicilio debe revisarse y editarse para evitar errores en guías de envío, entregas o localización por parte del chofer/repartidor.

---

## 4. Procedimiento paso a paso

| No. | Actividad | Instrucción | Campo / pantalla | Criterio de control |
|---:|---|---|---|---|
| 1 | Acceder a Operam | Navegar a `https://peltrenacional.operam.pro/`. | Operam | Usar credenciales autorizadas. |
| 2 | Abrir administración de clientes | Dar clic en `Administrar Clientes`. | Menú principal > Mantenimiento | Debe abrirse la pantalla de clientes. |
| 3 | Capturar RFC | Capturar el RFC del cliente. | Configuración General > Nombre y Dirección > R.F.C. | Validar que coincida con la constancia fiscal. |
| 4 | Capturar SAT IdCIF | Capturar el SAT IdCIF del cliente. | Configuración General > Nombre y Dirección > SAT IdCIF | El IdCIF es necesario para obtener datos del SAT. |
| 5 | Obtener datos del SAT | Dar clic en `Obtener Datos SAT`. | Botón Obtener Datos SAT | El sistema debe prellenar datos fiscales del cliente. |
| 6 | Abrir lista de precios | Dar clic en el campo `Precio de lista`. | Configuración General > Lista de Precios | No dejar el valor por defecto sin validar. |
| 7 | Seleccionar lista de precios | Seleccionar la lista de precios que corresponda al cliente. | Lista de Precios | Ejemplos visibles: M100, M1500, M350, M550, M6000, M6001. |
| 8 | Abrir segmento de cliente | Dar clic en `000 - Sin segmento`. | Configuración General > Segmento Cliente | El segmento define la clasificación comercial. |
| 9 | Elegir tipo de cliente | Elegir el tipo de cliente correspondiente. | Segmento Cliente | Ejemplos: Distribuidores, maquila, menudistas, restaurantes/hoteles, agencias/marcas, e-commerce, eventos, consumidor final, empleados, familia/amigos. |
| 10 | Abrir vendedor | Dar clic en `Vendedor`. | Domicilio / Datos comerciales > Vendedor | Debe asignarse el responsable comercial correcto. |
| 11 | Elegir vendedor asignado | Seleccionar al vendedor asignado al cliente. | Vendedor | Ejemplos visibles: Adrián Chávez, Alejandro Chávez, Amazon, Mercado Libre, Mostrador, Oswaldo Chávez, Shopify. |
| 12 | Abrir método de pago CFDI | Dar clic en `Método de Pago`. | CFDI > Método de Pago | Este campo debe ser congruente con la negociación. |
| 13 | Elegir método de pago CFDI | Seleccionar el método de pago correspondiente. Generalmente usar `PPD - Pago en parcialidades o diferido`. | CFDI > Método de Pago | Usar PUE solo cuando el pago se realice en una sola exhibición. |
| 14 | Abrir forma de pago CFDI | Dar clic en `Forma de Pago`. | CFDI > Forma de Pago | Depende del método de pago seleccionado. |
| 15 | Elegir forma de pago CFDI | Si el método de pago es PPD, elegir siempre `99 - Por definir`. Si el método es PUE, elegir la forma de pago que se usará en la transacción. | CFDI > Forma de Pago | Regla crítica de facturación. |
| 16 | Abrir términos de pago | Dar clic en `Términos de Pago`. | Ventas > Términos de Pago | Debe reflejar las condiciones acordadas en la negociación. |
| 17 | Elegir términos de pago | Elegir el término de pago de la negociación. Por lo general usar `Anticipo 50%`. | Ventas > Términos de Pago | Opciones visibles: 30 días, 60 días, 7 días, Anticipo 50%, Contra entrega, De contado, Por anticipado. |
| 18 | Abrir dimensiones | Dar clic en `Dimensiones`. | Ventas > Dimensiones | Se deben capturar las dimensiones indicadas. |
| 19 | Seleccionar D1 | Elegir `D1 - 1 TALLER CASINO DE LA SELVA (1)`. | Dimensiones | Capturar como dimensión requerida para el cliente. |
| 20 | Seleccionar D2 | Elegir `D2 - 5 CORPORATIVO (5)`. | Dimensiones | Capturar como segunda dimensión requerida. |
| 21 | Abrir almacén predeterminado | Dar clic en `Almacén de Inventario Predeterminado`. | Domicilio > Almacén de Inventario Predeterminada | No dejar Almacén MP si el cliente comprará producto terminado. |
| 22 | Elegir almacén | Elegir el almacén correspondiente. Por lo general usar `PT`. | Almacén de Inventario Predeterminado | PT = producto terminado. |
| 23 | Abrir área/zona de venta | Dar clic en `Área/Zona de Venta`. | Domicilio > Área/Zona de Venta | Seleccionar conforme a ubicación o canal. |
| 24 | Elegir área geográfica de venta | Elegir el área geográfica correspondiente. Por lo general usar `10 México`. | Área/Zona de Venta | Opciones visibles incluyen 10 México, 20 USA, 30 CANADA, 90 Otras regiones, Tiendas digitales, Tiendas físicas, Ventas de mostrador. |
| 25 | Ir a campo email | Dar clic en `E-mail`. | Domicilio > E-mail | El email será el contacto principal del cliente. |
| 26 | Capturar correo principal | Teclear el correo electrónico del contacto principal. | E-mail | Validar ortografía del dominio y del usuario antes de guardar. |
| 27 | Ir a teléfono | Dar clic en `Teléfono`. | Domicilio > Teléfono | Este campo se imprime en documentos operativos. |
| 28 | Capturar teléfono principal | Teclear el teléfono del contacto principal. Incluir siempre el código del país. | Teléfono | Formato recomendado: +52 seguido del número completo para México. |
| 29 | Validar teléfono impreso | Verificar que el primer campo de teléfono esté lleno. Este número se imprimirá en cotizaciones, pedidos, facturas y entregas. | Teléfono | Preferentemente usar celular con código de país. |
| 30 | Capturar celular si aplica | Si el teléfono es el mismo que el celular, registrar el mismo número tanto en `Teléfono` como en `Celular`. | Teléfono / Celular | Evita que documentos salgan sin teléfono utilizable. |
| 31 | Crear cliente | Dar clic en `Añadir Nuevo Cliente`. | Botón Añadir Nuevo Cliente | El cliente queda creado; después se deben revisar contactos y domicilios. |
| 32 | Abrir contactos | Dar clic en `Contactos`. | Pestaña Contactos | Operam genera/permite editar contactos asociados. |
| 33 | Editar contacto | Dar clic en el ícono de editar. | Contactos > Editar | Actualizar clasificación y dirección del contacto. |
| 34 | Abrir contacto para | Dar clic en `Contacto para`. | Contacto > Contacto para | Define qué comunicaciones recibe el contacto. |
| 35 | Asignar uso del contacto | Seleccionar `Invoices` si el contacto debe recibir facturas o complementos de pago de las órdenes asociadas. | Contacto para | Guía: quien recibe mercancía = Deliveries; facturas = Invoices; contacto principal = General + Invoices. |
| 36 | Abrir dirección del contacto | Dar clic en `Dirección`. | Contacto > Dirección | El sistema puede prellenar con domicilio fiscal. |
| 37 | Depurar dirección del contacto | La dirección capturada inicialmente suele ser la fiscal. Cambiarla por la dirección postal del contacto cuando sea relevante. Si no es relevante, borrar el domicilio fiscal del contacto. | Contacto > Dirección | Regla crítica: el domicilio fiscal aparece en MAYÚSCULAS. No usar solo mayúsculas en nombres cortos, contactos o direcciones de envío para evitar confundirlos con razón social/domicilio fiscal. |
| 38 | Actualizar contacto | Dar clic en `Actualizar`. | Contacto > Actualizar | Verificar que los cambios queden guardados. |
| 39 | Regresar a configuración general | Dar clic en `Configuración General`. | Pestaña Configuración General | Continuar con domicilios del cliente. |
| 40 | Abrir domicilios del cliente | Dar clic en `Agregar o Editar Domicilios del Cliente`. Al crear un cliente, el sistema genera un domicilio por default; ese domicilio debe editarse. | Configuración General > Domicilios | No crear duplicados si solo se requiere corregir el domicilio automático. |
| 41 | Editar domicilio default | Dar clic en el ícono de `Editar` del domicilio creado automáticamente. | Domicilios del Cliente > Editar | Este domicilio se usará para operaciones y envíos. |
| 42 | Corregir domicilio de envío/entrega | La dirección del domicilio también aparece prellenada con el domicilio fiscal en MAYÚSCULAS. Cambiarla usando minúsculas y completar cuidadosamente cada campo. | Domicilio del Cliente | Un error puede afectar guías de envío, entregas o la capacidad del repartidor/chofer para ubicar el domicilio. Incluir referencias cuando aplique. |
| 43 | Abrir cuenta de ventas | Dar clic en `Cuenta de Ventas`. | Domicilio/Contabilidad > Cuenta de Ventas | La cuenta depende de si la venta es nacional o exportación. |
| 44 | Seleccionar cuenta de ventas | Para ventas en México seleccionar `401-01-001 Ventas y/o servicios gravados a la tasa general`. Para ventas en el extranjero seleccionar `401-07-000 Ventas exentas exportación`. | Cuenta de Ventas | Regla crítica contable y fiscal. |
| 45 | Guardar domicilio | Dar clic en `Actualizar`. | Domicilio > Actualizar | Proceso terminado cuando cliente, contacto y domicilio quedan guardados. |

---

## 5. Checklist final antes de cerrar el alta

- [ ] RFC capturado y validado contra datos SAT.
- [ ] SAT IdCIF capturado correctamente.
- [ ] Datos SAT obtenidos y revisados.
- [ ] Lista de precios correcta.
- [ ] Segmento de cliente correcto.
- [ ] Vendedor asignado correctamente.
- [ ] Método de pago CFDI correcto.
- [ ] Forma de pago congruente con el método de pago.
- [ ] Términos de pago capturados conforme a la negociación.
- [ ] Dimensiones D1 y D2 capturadas.
- [ ] Almacén predeterminado configurado, por lo general PT.
- [ ] Área/Zona de venta correcta.
- [ ] Email del contacto principal revisado.
- [ ] Teléfono principal con código de país.
- [ ] Celular capturado cuando aplique.
- [ ] Contacto configurado para General, Invoices o Deliveries según corresponda.
- [ ] Dirección del contacto corregida si no debe ser la fiscal.
- [ ] Domicilio del cliente editado y completado con referencias necesarias.
- [ ] Cuenta de ventas correcta: México o extranjero.
- [ ] Cliente, contacto y domicilio actualizados/guardados.

---

## 6. Criterios de aceptación

El alta se considera correcta cuando el cliente puede usarse para cotizar, generar pedidos, facturar, registrar entregas y enviar documentación sin requerir correcciones fiscales, comerciales o logísticas posteriores.

| Elemento | Criterio de aceptación |
|---|---|
| Cliente | Existe en Operam con RFC, razón social/nombre, datos SAT y configuración comercial. |
| Contacto | Cuenta con email, teléfono y clasificación de uso: General, Invoices o Deliveries. |
| Domicilio | El domicilio operativo no se confunde con el domicilio fiscal y está listo para entregas/envíos. |
| CFDI | Método de pago, forma de pago y uso CFDI están configurados de forma congruente. |
| Ventas | Cuenta contable de ventas seleccionada correctamente para venta nacional o exportación. |

---

## 7. Control documental

| Campo | Información |
|---|---|
| Fuente de elaboración | Documento Scribe `Crear cliente \| Operam`, 25 páginas, con 45 pasos. |
| Documento generado | SOP - Crear cliente en Operam |
| Responsable sugerido | Área Comercial / Administración de Peltre Nacional |
| Frecuencia de revisión | Cada vez que cambie la interfaz de Operam, las políticas comerciales o las reglas fiscales internas. |
| Registros/evidencia | Cliente creado en Operam; contacto actualizado; domicilio del cliente actualizado. |

### Trazabilidad al documento original

| Referencia | Contenido cubierto |
|---|---|
| Pág. 1 | Acceso a Operam. |
| Págs. 2-6 | Alta inicial del cliente: RFC, SAT IdCIF, datos SAT, lista de precios, segmento y vendedor. |
| Págs. 7-10 | Configuración fiscal y comercial: método de pago, forma de pago, términos y dimensiones. |
| Págs. 11-16 | Almacén, zona de venta, datos de contacto y creación del cliente. |
| Págs. 17-20 | Configuración de contactos y reglas de dirección del contacto. |
| Págs. 21-25 | Edición del domicilio del cliente y cuenta de ventas. |

---

## Nota de liberación interna

Este archivo Markdown fue estructurado como SOP a partir del documento original de Scribe. Antes de liberarlo como procedimiento oficial, validar internamente:

- Código documental.
- Responsable del proceso.
- Reglas fiscales y contables vigentes.
- Nombres actuales de campos en Operam.
- Políticas comerciales vigentes de Peltre Nacional.
