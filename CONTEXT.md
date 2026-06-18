# Glosario de dominio — Cotizador Peltre Nacional

## Pipeline

El embudo comercial único, del primer interés al producto entregado. Reemplaza el modelo previo de dos mundos separados (etapas de prospecto por un lado, tablero de cotizaciones por otro). Una sola secuencia de etapas con dos salidas. La unidad que avanza por el pipeline es la **oportunidad**. Ver ADR-0005.

## Oportunidad

La unidad de trabajo del pipeline: una intención de compra que se sigue de punta a punta. Antes de cotizar, la oportunidad coincide con el **prospecto** (la persona o entidad detrás de un celular). Al generarse la primera cotización (pre-cotización o cotización), la oportunidad lleva esa cotización por el resto del embudo. Un mismo prospecto que cotiza una segunda vez (p. ej. una agencia que cotiza para dos clientes finales) genera una **segunda oportunidad** (segunda tarjeta). Esta es la invariante que mantiene limpio el sync con Operam: una tarjeta en etapas post-venta corresponde a un pedido. (Cambio respecto al modelo previo, que no reconocía "oportunidad" como entidad y trataba cada cotización solo como historial del prospecto: ver ADR-0005.)

## Prospecto

La persona o entidad detrás de un número de celular que mostró interés comercial pero aún no tiene alta de cliente en Operam. Un celular corresponde siempre a exactamente un prospecto. El prospecto es la cara de la oportunidad antes de cotizar; sus cotizaciones se acumulan en su historial y cada una, al existir, define una oportunidad en el pipeline.

Un cliente con alta en Operam nunca vuelve a ser prospecto: si el celular capturado pertenece a un cliente existente, el sistema lo señala (guardrail, mismo patrón que la deduplicación de clientes) y el vendedor cotiza sobre el cliente, no crea prospecto. Esa detección es "best effort": en Operam los teléfonos no viven en el cliente sino repartidos entre sus contactos y sus domicilios de entrega, en formatos inconsistentes; la comparación se hace por los últimos 10 dígitos del número nacional.

## Etapas del pipeline

`No Asignado → Por Cotizar → Seguimiento → Anticipo pagado → Pedido liberado → Saldo pagado → Producto entregado`. Dos salidas desde cualquier etapa activa: **No útil** (con motivo obligatorio de catálogo) y **Perdida** (con confirmación); ambas viven en filtro/historial, fuera del tablero activo.

- **No Asignado**: la oportunidad entró sin vendedor. Ocurre con prospectos que llegan del formulario web "Peltre de Mayoreo" o, a futuro, de un bot (WhatsApp, redes, correo). Requiere asignar un vendedor; al asignarlo, la tarjeta pasa automáticamente a Por Cotizar.
- **Por Cotizar**: la oportunidad ya tiene dueño y aún no se cotiza. Cuando el vendedor crea el prospecto a mano, nace aquí auto-asignado. Es donde corre la cadencia de prospecto en horas hábiles y donde se agenda la reunión de diagnóstico.
- **Seguimiento**: existe una cotización (pre o formal). La transición Por Cotizar → Seguimiento es automática al generar una pre-cotización o cotización con el Cotizador, o cuando Operam reporta una cotización creada para la tarjeta; manual solo capturando el número de cotización de Operam (sin folio no avanza). Aquí corre la cadencia de cotización en días naturales.
- **Anticipo pagado → Pedido liberado → Saldo pagado → Producto entregado**: etapas post-venta, dirigidas automáticamente por hechos en Operam (ver Sincronización post-venta con Operam). El vendedor no las captura a mano.

Las etapas intermedias de prospección del modelo previo (Contactado, Calificado) se eliminan (ADR-0005). La transición a Cotizado del modelo previo se reemplaza por la transición a Seguimiento.

## Pre-cotización

Una cotización emitida con datos mínimos (Prospecto Mínimo) y sin registro en Operam, para cotizar sin fricción con el cliente enfrente. No usa Cliente Genérico. Se modela con el folio de Operam ausente (nullable); esa ausencia define el estado "PRE". La distinción **PRE** vs **"#Operam N"** es visible en la tarjeta, en la cola Hoy y en el tablero. Generar una pre-cotización mueve la oportunidad a Seguimiento conservando el PRE. Se formaliza ("completar después") desde la tarjeta: completar los datos del prospecto, dar de alta el cliente en Operam y registrar la cotización; al obtener folio, pierde el PRE.

Corte histórico (decisión 2026-06-16): el folio de Operam no se persistía antes del despliegue de #63, así que una cotización anterior a esa fecha y sin folio no se puede distinguir de una pre-cotización. Se asume **registrada** (no PRE) y no muestra badge — el badge PRE aplica solo a cotizaciones nuevas. El discriminante es la fecha (no el id, que no es contiguo) y vive en la migración de lectura del store.

## Prospecto Mínimo

El conjunto mínimo de datos con el que se puede emitir una pre-cotización sin alta de cliente: lo necesario para identificar al prospecto y calcular la cotización (celular, nombre, ciudad para estimar envío) más el carrito. El alta fiscal completa en Operam se difiere a la formalización.

## Producto decorado (calca)

Una cotización cuyo producto lleva calca (decorado) activa un proceso de autorizaciones con el proveedor de calca, representado como un checklist de 6 pasos en la tarjeta: (1) cotización con proveedor de calca, (2) posición de calca enviada al cliente para autorización, (3) arte final enviado al proveedor, (4) dummy del proveedor autorizado, (5) liberación de producción autorizada, (6) archivos de posición de calca subidos a Dropbox. Una oportunidad decorada no puede llegar a Pedido liberado con el checklist incompleto (gate).

## Prospecto convertido en cliente

Un prospecto cuyo celular se dio de alta como cliente en Operam queda ligado a ese cliente, pero la conversión NO lo saca del seguimiento: la oportunidad permanece en Por Cotizar con la etiqueta "Ya es cliente — falta cotizar" hasta que una cotización la pase a Seguimiento (decisión 2026-06-11: la conversión real del negocio es la venta, no el alta; la cola vigila la fuga de altas que nunca cotizan).

## Visibilidad

Cada vendedor ve únicamente sus propias oportunidades; el rol admin ve todas y es quien asigna vendedor a las tarjetas en No Asignado. Cuando un vendedor intenta capturar un celular que ya es prospecto de otro vendedor, el sistema rechaza la captura indicando quién lo atiende ("este celular ya lo atiende [vendedor]"), sin exponer más datos; la coordinación entre vendedores ocurre fuera del sistema.

Excepción — pre-clasificación en el alta de cliente (decisión 2026-06-17, #69): el aviso de celular del formulario de alta (`GET /api/prospectos/clasificar`) sí expone el nombre del prospecto y el vendedor que lo atiende, sea propio o ajeno ("Este celular ya es un prospecto: [nombre] (lo atiende [vendedor])"), para que quien da de alta reconozca de inmediato un celular ya registrado. Decisión del dueño: entre el equipo de ventas de Peltre no se aplica la barrera de privacidad de prospectos en este punto; revierte para este endpoint la regla de "sin exponer más datos".

## Horas hábiles

El reloj con el que se mide la espera de un prospecto en Por Cotizar: lunes a viernes 10:00–18:00, sábado 10:00–14:00, festivos mexicanos excluidos. Un prospecto que escribe en fin de semana o festivo no acumula espera; acepta respuesta a la mañana siguiente hábil sin molestia. Las cotizaciones en Seguimiento, en cambio, se miden en días naturales (cadencia día 2/7/21/vencida).

## Cadencia de prospecto

Los tiempos de seguimiento de un prospecto en Por Cotizar corren en horas hábiles y dependen del canal: WhatsApp e Instagram esperan respuesta en horas (rojo a las 2 horas hábiles sin contactar); correo y formulario toleran más (rojo a las 8). Cada prospecto muestra una etiqueta visible de horas hábiles sin respuesta con semáforo (verde < 2, ámbar 2–8, rojo > 8). Tras 3 toques sin respuesta el sistema sugiere — nunca aplica solo — la salida a No útil (sin respuesta). Una reunión de diagnóstico futura suprime la cadencia.

## Cola Hoy (seguimiento fusionado)

La cola única de pendientes del día: fusiona el seguimiento de prospectos en Por Cotizar (cadencia en horas hábiles, semáforo por canal) con el de cotizaciones en Seguimiento (cadencia en días naturales 2/7/21/28). Se ordena por urgencia relativa al umbral de cada tipo (cada reloj con su medida). Reemplaza las dos colas separadas del modelo previo. Permanece fija sobre el tablero y la vista de lista. Es el contenido del destino "Hoy" en la navegación.

## Captura de prospecto

Registro mínimo de un prospecto, diseñado para hacerse en segundos desde el teléfono. Obligatorios: celular (con código de país), nombre (se acepta sin apellido) y ciudad (necesaria para estimar envío). Opcionales: empresa, tipo de cliente (segmentos existentes), piezas estimadas (+100/+350/+550/+1,500/+6,000), correo, temperatura (1–5) y notas. Canal de origen obligatorio, de catálogo cerrado: WhatsApp, Instagram, Facebook/Messenger, Meta Ads (pagado — se distingue del orgánico), Formulario web, Correo, Referido, Bazar Sábado, Feria/Expo. Los prospectos de Feria/Expo no se capturan a mano: la plataforma del evento entrega un CSV de gafetes escaneados que se importa deduplicando por celular. Un prospecto creado a mano por un vendedor nace en Por Cotizar, auto-asignado a ese vendedor.

## Reunión de diagnóstico

Actividad con fecha sobre una oportunidad en Por Cotizar o Seguimiento (no es etapa): llamada o videollamada que el cliente solicita para explorar su proyecto. Mientras la reunión está en el futuro, la cadencia de seguimiento de esa tarjeta se suprime; pasada la fecha sin actividad posterior, la cola Hoy pide registrar el resultado (el avance pertinente o la salida a No útil — ya no avanza a "Calificado", etapa eliminada). Re-agendar registra otro evento y la última reunión manda.

## Tablero del pipeline

Vista kanban única de las oportunidades, con las 7 etapas como columnas (las salidas No útil y Perdida viven en filtro/historial, no como columnas activas). Reemplaza los dos tableros separados del modelo previo (prospectos y cotizaciones). Conmutable con la vista de lista; la cola Hoy permanece fija sobre ambas. Muestra la suma en pesos por columna. El arrastre respeta las reglas del dominio del módulo de pipeline: un paso a la vez; soltar en No útil exige motivo; el paso manual a Seguimiento exige el número de cotización; las etapas post-venta no se arrastran porque las mueve Operam. Funciona también en el teléfono (desplazamiento horizontal por columna; en táctil las transiciones pueden ser por botón). Término canónico del destino y del tablero: **Pipeline**.

## Sincronización post-venta con Operam

Las cuatro etapas post-venta (Anticipo pagado, Pedido liberado, Saldo pagado, Producto entregado) se mueven leyendo hechos de Operam (API v3 o webhooks): pagos, liberación de pedido y entrega. El tablero no contradice a Operam en estas etapas y el vendedor no captura doble. La dependencia técnica quedó resuelta (#62): la API expone toda la cadena por la llave `order_`. Las cuatro etapas son **automáticas** (ninguna arranca en modo manual): el dato está expuesto para las cuatro.

El mapeo real de Operam (corre sobre FrontAccounting; ver `peltre-operam.md` §12 — las etiquetas del MCP `operam-api` están mal): la cadena post-venta se une por el campo `order_`/`order_no`. Tipos de transacción: **10 = factura** (con CFDI; de aquí salen los montos de pago `allocated`/`outstanding`/`total_amount`; el pago de cliente tipo 12 se aplica contra ella), **13 = remisión** (sin CFDI), **30 = pedido/Sales Order** (lo que devuelve `listar_pedidos`). Reglas: el pago se deriva de `allocated` vs `total` (el `outstanding` del listado de Operam no es fiable — sale ≠ 0 en facturas ya pagadas): anticipo pagado = `0 < allocated < total`; saldo pagado = `allocated >= total*0.99` (tolera 1% por error humano de pago de más/menos); pedido liberado = existe Sales Order (30); producto entregado = existe remisión (13). La etapa decorada respeta el gate de calca (#61) y el avance es monótono (no retrocede).

El sync corre por dos vías sobre el mismo motor de reconciliación (`lib/sync-operam-io.js`): un **webhook** de Operam (`POST /api/webhooks/operam`, auth por header secreto) tratado como mera señal — no se confía en su payload —, y una **reconciliación on-demand** (`POST /api/sync-operam`) como red de seguridad. Ambas leen el estado real por API (`listarTransacciones` por RFC + `listarPedidos` por cliente), normalizan a hechos y aplican el núcleo puro. El motor liga la oportunidad a su cadena por el número de pedido (`order_`) cuando se conoce (`data.orderOperam`); **el número de cotización nunca es igual al número de pedido en Operam**, así que el folio de la cotización (`folioOperam`) no sirve como `order_` (usarlo arriesgaría un falso match con el pedido de otra cadena). Sin `order_` explícito, agrega por cliente (correcto cuando el cliente tiene una sola oportunidad activa).

## Alta de cliente

Proceso de registrar a un cliente nuevo en Operam con todos los campos requeridos por el SOP-COM-OPERAM-001: datos fiscales, configuración comercial, contacto y domicilio de entrega. La realiza el **vendedor**. Se considera completa cuando el cliente puede usarse para generar cotizaciones, pedidos y facturas sin correcciones posteriores.

## Aprobación de pedido

Revisión final que hace **Adrián** antes de convertir una cotización en pedido en Operam. Es el punto de QA humano del proceso comercial: valida datos fiscales, configuración comercial y dirección de entrega. No es parte del alta de cliente.

## Vendedor

Actor que atiende prospectos, captura datos del cliente, crea el alta en Operam y genera cotizaciones. Usa el cotizador como herramienta principal — el alta de cliente (carga de CSF o captura manual) vive en el acordeon "+ Nuevo cliente" del propio cotizador, autenticado con el mismo JWT (ADR-0003; la herramienta standalone `csf-upload.html` fue retirada).

## Nombre de cliente (CustName)

Nombre fiscal del cliente tal como aparece en la constancia de situación fiscal o en el registro legal de la empresa. En México corresponde a la razón social del SAT. Para clientes extranjeros, es el business legal name. Se escribe en mayúsculas cuando viene del SAT. Campo principal de identificación en Operam.

## Nombre corto (cust_ref)

Nombre comercial del cliente, distinto del nombre fiscal. Se usa para referirse al cliente en el día a día. En México puede ser el nombre de la tienda o marca. En Estados Unidos equivale al "doing business as" (DBA). Se escribe en mayúsculas/minúsculas normales, no en mayúsculas fiscales.

## Deduplicación de cliente

Proceso de verificar que un cliente nuevo no exista ya en Operam antes de crearlo. Para clientes con RFC real: búsqueda exacta por RFC. Para clientes con RFC genérico (`XAXX010101000` o `XEXX010101000`): búsqueda por nombre normalizado (sin acentos, sin artículos, sin preposiciones, sin sufijos corporativos) contra CustName y cust_ref. Si hay coincidencia de nombre, el vendedor **no puede crear ni forzar la creación** — el sistema muestra los candidatos existentes y el vendedor debe elegir uno. Si el vendedor elige un cliente existente, el sistema muestra sus domicilios de entrega para que el vendedor seleccione uno existente o cree uno nuevo.

## Domicilio de entrega (sucursal)

Dirección operativa donde se entrega el pedido al cliente. Un cliente puede tener múltiples domicilios de entrega en Operam. Cada domicilio tiene un nombre largo y un nombre corto. No confundir con el domicilio fiscal. Al detectar un posible duplicado, el vendedor puede seleccionar un cliente existente y elegir o crear un domicilio de entrega, en vez de crear un cliente duplicado.

## Almacén predeterminado

Siempre `PT` (producto terminado) para todos los clientes de mayoreo, sin excepción. Se asigna automáticamente al crear el cliente — no requiere selección del vendedor.

## Cuenta de ventas

Campo contable del domicilio de entrega en Operam. Se deriva automáticamente del país del domicilio: México → `401-01-001 Ventas y/o servicios gravados a la tasa general`; cualquier otro país → `401-07-000 Ventas exentas exportación`. No es editable por el vendedor — el sistema la asigna según el grupo de impuestos que corresponde al país del domicilio. Un cliente mexicano puede tener cuenta de exportación si su domicilio de entrega está en el extranjero. En la API de Operam el campo del branch se llama `sales_account` y se establece al crear o editar el domicilio (`PUT /api/v3/sales/branches/{id}`).

## Grupo de impuestos

Clasificación fiscal del domicilio de entrega. Se deriva del país del domicilio: domicilio en México → gravado (IVA 16%); domicilio en el extranjero → exento de impuestos. Determina la cuenta de ventas correcta. En la API de Operam el campo se llama `tax_group_id`: México → `1` (IVA 16%), extranjero → `2` (exento). Confirmado contra branches reales de producción.

## Contacto de cliente

Persona registrada en Operam asociada a un cliente, con una clasificación de uso: General (comprador principal), Invoices (recibe facturas y complementos de pago), Deliveries (recibe mercancía en el domicilio de entrega). Un cliente puede tener múltiples contactos. En la práctica, a veces es la misma persona para todos los roles. Para el contacto de facturación, frecuentemente solo se conoce el correo electrónico; en ese caso el nombre se registra como "Facturación".

Cuando se crea un cliente via API (`POST /api/v3/sales/customers`), Operam auto-genera un contacto de tipo General con el `cust_ref` como nombre y el `phone`/`email` del cliente. Este contacto auto-generado cubre el requisito del SOP de tener un contacto General. Los contactos adicionales (Invoices, Deliveries) se registran manualmente en la UI de Operam. La API v3 no soporta ninguna operación programática sobre contactos: POST devuelve 501, y PUT al cliente ignora completamente el array `contacts` (verificado contra producción — no actualiza ni con IDs existentes). Los campos internos de contacto son: `action` ("general" / "invoice" / "delivery"), `ref` (categoría visible), `name`, `name2`, `phone`, `phone2`, `fax`, `email`, `notes`.

## Configuración comercial del cliente

Conjunto de campos que definen las condiciones de venta de un cliente: lista de precios, segmento, vendedor asignado, términos de pago, área/zona de venta. El vendedor puede revisar y editar estos campos tanto al crear un cliente nuevo como al seleccionar un cliente existente durante el flujo de alta.

## RFC genérico

RFC que se usa cuando el cliente no tiene RFC mexicano. Dos variantes: `XAXX010101000` para personas sin RFC nacional, `XEXX010101000` para clientes extranjeros. No es un identificador único: múltiples clientes distintos pueden tener el mismo RFC genérico, por lo que no puede usarse como llave de deduplicación.

## Lista de precios

Descuento estructural asignado a un cliente según el volumen estimado de compra. Opciones: M100, M350, M550, M1500, M6000, M6001. La selecciona el **vendedor** en el alta con base en la estimación inicial del cliente. El vendedor es responsable de ajustarla si el volumen cotizado cambia. Adrián la revisa en la aprobación del pedido y notifica al vendedor si hay error.

## Guardrail

Restricción en el formulario de alta que impide errores críticos sin requerir intervención de Adrián. Ejemplo: detectar RFC duplicado antes de crear el cliente. Los guardrails hacen viable que el vendedor complete el alta por sí solo.
