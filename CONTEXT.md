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

Deja de ser un modo de trabajo elegible (ADR-0006): toda cotización nueva se sube automáticamente a Operam al generarse, creando de paso un Cliente Genérico si la oportunidad todavía no tiene cliente. **PRE** queda solo como estado de excepción — el folio de Operam está ausente únicamente cuando Operam falló al generar la cotización (caída de red, error de API), con reintento idempotente sobre el mismo intento. La distinción **PRE** vs **"#Operam N"** se conserva visible en la tarjeta, en la cola Hoy y en el tablero, pero en operación normal debería ser rara y transitoria, no un estado en el que una cotización permanezca a propósito. Una PRE **no tiene número** (no existe folio que imprimir) y su documento se identifica como **pre-cotización**: ponerle el id interno sería reintroducir la doble numeración que ADR-0009 cierra.

Corte histórico (decisión 2026-06-16): el folio de Operam no se persistía antes del despliegue de #63, así que una cotización anterior a esa fecha y sin folio no se puede distinguir de una pre-cotización. Se asume **registrada** (no PRE) y no muestra badge — el badge PRE aplica solo a cotizaciones nuevas. El discriminante es la fecha (no el id, que no es contiguo) y vive en la migración de lectura del store.

## Número de la cotización

Es el **folio del quote en Operam**, y sólo ése (ADR-0009). El id interno del registro del cotizador es una clave técnica — vive en las URL de los documentos y del historial — y nunca se presenta como "cotización #N": el cliente que recibe el documento y quien abre el ERP tienen que leer el mismo número. Para poder imprimirlo, generar un documento **espera** a que la cotización esté subida a Operam; si no lo consigue, el documento se entrega igual **sin número**, como pre-cotización, y el numerado se re-comparte desde el historial cuando el folio llegue. En la UI el folio se nombra siempre con la convención **"#Operam N"** (#63).

## Editar / Copiar cotización

Las dos acciones de carga del historial (#104, ADR-0008; renombradas en #149). **Editar** reescribe el MISMO registro y el MISMO quote de Operam conservando el folio — solo aplica cuando hay un quote editable y nadie lo ha convertido todavía (gate `puedeActualizarCotizacion`). **Copiar cotización** parte de los datos de una cotización existente para empezar una NUEVA — folio y registro propios — y es la única salida cuando Editar está bloqueado (ej. la cotización ya tiene un pedido asociado en Operam). Un mismo botón, un mismo nombre en todos los avisos: Historial, aviso de cotización bloqueada del pipeline (#114) y el alert de divergencia tras generar.

## Vigencia ("Válido hasta")

La fecha hasta la que la cotización se sostiene, capturada en días por el vendedor (30 por omisión) y calculada sobre la fecha de emisión. Vive en tres lugares por razones distintas: el PDF/HTML que recibe el cliente (donde siempre fue correcta), el campo `comments` del quote de Operam (respaldo, porque la API no acepta la fecha) y el campo nativo "Válido hasta" de Operam, que la API v3 ignora y deja en `ord_date-1` — dejando el ERP mostrando "Esta cotizacion esta vencida" sobre cotizaciones vivas.

El campo nativo se corrige por **post-fix contra la web legacy de Operam**, inmediatamente después de subir el quote y de forma no bloqueante (ADR-0007). La línea "Valido hasta: ..." en `comments` se conserva como respaldo deliberadamente redundante: el post-fix puede fallar y la vigencia no puede quedarse sin portador dentro de Operam.

## Prospecto Mínimo

El conjunto mínimo de datos con el que se puede emitir una cotización sin que el prospecto haya completado su alta fiscal: lo necesario para identificar al prospecto y calcular la cotización (celular, nombre, ciudad para estimar envío) más el carrito. Ya no difiere el alta en Operam (ADR-0006): al generar la primera cotización, el sistema crea automáticamente el Cliente Genérico correspondiente. El alta fiscal completa se difiere al upgrade por CSF, no al alta del cliente en sí.

## Producto decorado (calca)

Una cotización cuyo producto lleva calca (decorado) activa un proceso de autorizaciones con el proveedor de calca, representado como un checklist de 6 pasos en la tarjeta: (1) cotización con proveedor de calca, (2) posición de calca enviada al cliente para autorización, (3) arte final enviado al proveedor, (4) dummy del proveedor autorizado, (5) liberación de producción autorizada, (6) archivos de posición de calca subidos a Dropbox. Una oportunidad decorada no puede llegar a Pedido liberado con el checklist incompleto (gate).

Hay dos formas de que una cotización sea decorada, y solo una deja rastro en el carrito: la **calca**, que es una partida propia, y el decorado a mano (y las texturas decoradas), que se aplica sobre la pieza sin generar partida. Por eso la calca en el carrito determina que la cotización sea decorada y fija esa marca, mientras que la ausencia de calca deja la marca a criterio del vendedor: la calca es piso, no techo (ADR-0010). Quitar la calca no revierte la marca ni descarta el checklist — las autorizaciones ya gestionadas con el proveedor son hechos del mundo, no un derivado del carrito.

## Calca

Partida independiente de la cotización, con su propia cantidad —medida en **piezas decoradas**, no en diseños— y sin ligarse a un producto base. Su precio sale de la misma lista que el resto de la cotización, pero **sus piezas no cuentan para el volumen que determina esa lista**: la lista la fijan las piezas de producto y la calca la hereda para su precio.

La calca no tiene precio de menudeo: cuando la lista vigente de la cotización es Menudeo, la calca se cobra con la lista **M100**, la primera donde existe. Cada partida de calca se factura con un **piso de 100 piezas** (decisión 2026-08-14, issue #98; supersede el estado inválido de #91): el proveedor imprime mínimo 100 calcas por diseño, así que una captura menor se sube automáticamente a 100 con aviso — la cantidad facturada es la misma en carrito, documento y quote. El piso es **por partida** (por diseño), no por el total de calcas, y aplica siempre, aunque el volumen de producto supere el mínimo de sobra. La consecuencia aceptada se mantiene: una cotización de solo calcas no existe en el cotizador; ese caso se levanta a mano en Operam.

## Aplicación extra

Cargo por aplicar una calca **adicional sobre la misma pieza**. Tiene precio por lista pero no existe como artículo en el ERP, así que hoy no puede cotizarse.

## Prospecto convertido en cliente

Un prospecto cuyo celular se dio de alta como cliente en Operam queda ligado a ese cliente, pero la conversión NO lo saca del seguimiento: la oportunidad permanece en Por Cotizar con la etiqueta "Ya es cliente — falta cotizar" hasta que una cotización la pase a Seguimiento (decisión 2026-06-11: la conversión real del negocio es la venta, no el alta; la cola vigila la fuga de altas que nunca cotizan).

## Cliente genérico

Cliente real en Operam, dado de alta con RFC genérico (`XAXX010101000` nacional, `XEXX010101000` extranjero) como marcador de "datos fiscales pendientes" — no un placeholder ni un segmento especial (ADR-0006). Nace en el servidor al generarse la primera cotización de una oportunidad que aún no tiene cliente en Operam, con nombre real del contacto y vendedor real; la cotización se sube a su nombre en el mismo momento, de forma atómica, y nunca se reasigna después.

La certeza contra duplicados depende de que el cotizador sea el único punto de entrada de clientes genéricos, con deduplicación en capas: celular contra la base propia de prospectos (invariante 1 celular = 1 prospecto, más el registro de altas en Neon con mapeo celular → `customer_id`), nombre normalizado contra Operam (ADR-0001) y, en el upgrade, RFC exacto. Un alta genérica hecha manualmente en la UI de Operam, fuera del cotizador, queda fuera de esta garantía.

Al llegar la Constancia de Situación Fiscal, el cliente genérico se actualiza (`PUT`), nunca se re-crea: es un upgrade con gate anti-fusión (si el RFC real ya existe en Operam con otro cliente, se frena y se avisa para fusión manual) y verificación posterior por el quirk conocido de Operam (`PUT` 200 que ignora campos en silencio).

Higiene: reporte admin de clientes con RFC genérico sin actividad (≥6 meses), como candidatos a inactivación manual en Operam — Operam acepta múltiples clientes con el mismo RFC genérico, así que la acumulación no se detecta como error, solo se vigila.

## Visibilidad

Cada vendedor ve únicamente sus propias oportunidades; el rol admin ve todas. Asignar vendedor a las tarjetas en No Asignado (y ver esa columna) requiere el **permiso de asignación**: el admin lo tiene siempre; un vendedor lo puede tener por checkbox en /admin (decisión 2026-08-15, mismo patrón que el permiso de fijar lista). Quien asigna puede asignar a cualquier vendedor, no solo a sí mismo — es el permiso del gerente comercial, aunque el sistema no modela un rol formal de gerente. El permiso alcanza además para **descartar** una tarjeta sin dueño (salida a No útil o Perdida, decisión del dueño 2026-08-16): un lead que nadie va a trabajar tiene que poder salir del tablero sin depender del admin. No alcanza para *trabajarla* — editarla, registrarle un toque o agendarle reunión siguen exigiendo ser su dueño o admin, porque eso ya es atenderla y para eso primero se asigna. El límite lo hace cumplir el propio embudo: desde No Asignado las únicas transiciones válidas son las dos salidas. Cuando un vendedor intenta capturar un celular que ya es prospecto de otro vendedor, el sistema rechaza la captura indicando quién lo atiende ("este celular ya lo atiende [vendedor]"), sin exponer más datos; la coordinación entre vendedores ocurre fuera del sistema.

Excepción — pre-clasificación en el alta de cliente (decisión 2026-06-17, #69): el aviso de celular del formulario de alta (`GET /api/prospectos/clasificar`) sí expone el nombre del prospecto y el vendedor que lo atiende, sea propio o ajeno ("Este celular ya es un prospecto: [nombre] (lo atiende [vendedor])"), para que quien da de alta reconozca de inmediato un celular ya registrado. Decisión del dueño: entre el equipo de ventas de Peltre no se aplica la barrera de privacidad de prospectos en este punto; revierte para este endpoint la regla de "sin exponer más datos".

## Horas hábiles

El reloj con el que se mide la espera de un prospecto en Por Cotizar: lunes a viernes 10:00–18:00, sábado 10:00–14:00, festivos mexicanos excluidos. Un prospecto que escribe en fin de semana o festivo no acumula espera; acepta respuesta a la mañana siguiente hábil sin molestia. Las cotizaciones en Seguimiento, en cambio, se miden en días naturales (cadencia día 2/7/21/vencida).

## Cadencia de prospecto

Los tiempos de seguimiento de un prospecto en Por Cotizar corren en horas hábiles y dependen del canal: WhatsApp e Instagram esperan respuesta en horas (rojo a las 2 horas hábiles sin contactar); correo y formulario toleran más (rojo a las 8). Cada prospecto muestra una etiqueta visible de horas hábiles sin respuesta con semáforo (verde < 2, ámbar 2–8, rojo > 8). Tras 3 toques sin respuesta el sistema sugiere — nunca aplica solo — la salida a No útil (sin respuesta). Una reunión de diagnóstico futura suprime la cadencia.

## Cola Hoy (seguimiento fusionado)

La cola única de pendientes del día: fusiona el seguimiento de prospectos en Por Cotizar (cadencia en horas hábiles, semáforo por canal) con el de cotizaciones en Seguimiento (cadencia en días naturales 2/7/21/28). Se ordena por urgencia relativa al umbral de cada tipo (cada reloj con su medida). Reemplaza las dos colas separadas del modelo previo. Permanece fija sobre el tablero y la vista de lista. Es el contenido del destino "Hoy" en la navegación. Incluye además las tarjetas No Asignado, visibles solo para quien tiene el permiso de asignación (decisión 2026-08-15): un lead sin dueño es un pendiente del día, no un detalle del tablero. Encabezan la cola **incondicionalmente** — por encima incluso de una reunión vencida, que es la otra excepción al orden por urgencia (decisión del dueño 2026-08-16): no compiten por urgencia relativa porque su reloj no mide lo mismo, mientras cualquier otra tarjeta ya tiene a alguien trabajándola, esta no tiene a nadie.

## Captura de prospecto

Registro mínimo de un prospecto, diseñado para hacerse en segundos desde el teléfono. Obligatorios: celular (con código de país), nombre (se acepta sin apellido) y ciudad (necesaria para estimar envío). Opcionales: empresa, tipo de cliente (segmentos existentes), piezas estimadas (+100/+350/+550/+1,500/+6,000), correo, temperatura (1–5) y notas. Canal de origen obligatorio, de catálogo cerrado: WhatsApp, Instagram, Facebook/Messenger, Meta Ads (pagado — se distingue del orgánico), Formulario web, Correo, Referido, Bazar Sábado, Feria/Expo, Cliente Actual (un cliente que ya nos compró y abre una operación nueva, a veces bajo otra razón social del mismo grupo). Los prospectos de Feria/Expo no se capturan a mano: la plataforma del evento entrega un CSV de gafetes escaneados que se importa deduplicando por celular. Un prospecto creado a mano por un vendedor nace en Por Cotizar, auto-asignado a ese vendedor.

## Captura pública (formulario de mayoreo)

La variante de captura en la que el prospecto se registra a sí mismo desde el formulario web de mayoreo (canal Formulario web); nace en No Asignado, sin vendedor. La secuencia es semántica y fija (decisión 2026-08-15, ratificada tras panel de debate y ajustada por el dueño): primero el proyecto — tipo de proyecto (pre-asigna el segmento de Operam; la opción elegida se conserva textual en las notas porque varias opciones caen en un mismo segmento; "Otro" exige especificar cuál), nombre de la empresa o proyecto (opcional, inmediatamente bajo el tipo: es la continuación natural de la pregunta), cantidad estimada (con ejemplo de conversión a tier; omite deliberadamente +6,000: ese nivel exige negociación humana y no debe entrar por autoservicio), código postal del que el sistema deriva la ciudad ("para calcular tu envío"; captura manual de ciudad como respaldo si el CP no resuelve) y "¿para cuándo lo necesitas?" opcional, de catálogo cerrado de rangos (próximas 4 semanas / 3 meses / 6 meses / aún sin fecha — nunca texto libre ni fecha exacta) — después la persona: nombre y apellido por separado (se conservan como un solo nombre — dos campos obligatorios inducen datos más completos) y su cargo opcional — al final el contacto: celular con código de país (la llave de identidad; "te escribimos por WhatsApp"), correo opcional (decisión 2026-08-15: la llave es el celular y el canal real es WhatsApp; el formulario pide más que el Prospecto Mínimo solo en apellido y cantidad, por calificación comercial) y sitio web o redes opcional. Los grupos no llevan encabezados visibles (el orden comunica solo) y los obligatorios se marcan con asterisco rojo. El consentimiento se separa por finalidad (LFPDPPP): atender la solicitud es la finalidad primaria y no lleva checkbox — la cubre el Aviso de Privacidad enlazado en el punto de captura ("Al enviar aceptas...") — mientras que las promociones son finalidad secundaria con checkbox propio, opcional, desmarcado por defecto y guardado con fecha (la prueba del consentimiento vale tanto como el consentimiento); enviar sin marcarlo siempre funciona. La respuesta pública nunca revela si el celular ya es prospecto o cliente — hacia afuera siempre es "gracias, te contactamos"; la regla de Visibilidad aplica solo dentro del equipo. Cada captura pública avisa por correo a quienes tienen el permiso de asignación.

## Reunión de diagnóstico

Actividad con fecha sobre una oportunidad en Por Cotizar o Seguimiento (no es etapa): llamada o videollamada que el cliente solicita para explorar su proyecto. Mientras la reunión está en el futuro, la cadencia de seguimiento de esa tarjeta se suprime; pasada la fecha sin actividad posterior, la cola Hoy pide registrar el resultado (el avance pertinente o la salida a No útil — ya no avanza a "Calificado", etapa eliminada). Re-agendar registra otro evento y la última reunión manda.

## Tablero del pipeline

Vista kanban única de las oportunidades, con las 7 etapas como columnas (las salidas No útil y Perdida viven en filtro/historial, no como columnas activas). Reemplaza los dos tableros separados del modelo previo (prospectos y cotizaciones). Conmutable con la vista de lista; la cola Hoy permanece fija sobre ambas. Muestra la suma en pesos por columna. El arrastre respeta las reglas del dominio del módulo de pipeline: un paso a la vez; soltar en No útil exige motivo; el paso manual a Seguimiento exige el número de cotización; las etapas post-venta no se arrastran porque las mueve Operam. Funciona también en el teléfono (desplazamiento horizontal por columna; en táctil las transiciones pueden ser por botón). Término canónico del destino y del tablero: **Pipeline**.

## Sincronización post-venta con Operam

Las cuatro etapas post-venta (Anticipo pagado, Pedido liberado, Saldo pagado, Producto entregado) se mueven leyendo hechos de Operam (API v3 o webhooks): pagos, liberación de pedido y entrega. El tablero no contradice a Operam en estas etapas y el vendedor no captura doble. La dependencia técnica quedó resuelta (#62): la API expone toda la cadena por la llave `order_`. Las cuatro etapas son **automáticas** (ninguna arranca en modo manual): el dato está expuesto para las cuatro.

El mapeo real de Operam (corre sobre FrontAccounting; ver `peltre-operam.md` §12 — las etiquetas del MCP `operam-api` están mal): la cadena post-venta se une por el campo `order_`/`order_no`. Tipos de transacción: **10 = factura** (con CFDI; de aquí salen los montos de pago `allocated`/`outstanding`/`total_amount`; el pago de cliente tipo 12 se aplica contra ella), **13 = remisión** (sin CFDI), **30 = pedido/Sales Order** (lo que devuelve `listar_pedidos`). Reglas: el pago se deriva de `allocated` vs `total` (el `outstanding` del listado de Operam no es fiable — sale ≠ 0 en facturas ya pagadas): anticipo pagado = `0 < allocated < total`; saldo pagado = `allocated >= total*0.99` (tolera 1% por error humano de pago de más/menos); pedido liberado = existe Sales Order (30); producto entregado = existe remisión (13). La etapa decorada respeta el gate de calca (#61) y el avance es monótono (no retrocede).

**En el pipeline manda el cumplimiento, no la cobranza** (decisión de Adrián, issue #77): una remisión lleva la tarjeta a Producto entregado aunque el pago no esté registrado (la contadora lo captura a mano con días de desfase). La tarjeta entregada-impaga muestra el badge **"Pago sin registrar"** hasta que la señal de pago aparece (`allocated ~ total`), y sigue siendo candidata de reconciliación mientras el badge esté vivo — el pago tardío lo apaga; una entregada ya pagada es terminal para el sync.

El sync corre por dos vías sobre el mismo motor de reconciliación (`lib/sync-operam-io.js`): un **webhook** de Operam (`POST /api/webhooks/operam`, auth por header secreto) tratado como mera señal — no se confía en su payload —, y una **reconciliación on-demand** (`POST /api/sync-operam`) como red de seguridad. Ambas leen el estado real por API (`listarTransacciones` por RFC + `listarPedidos` por cliente), normalizan a hechos y aplican el núcleo puro. El motor liga la oportunidad a su cadena por el número de pedido (`order_`) cuando se conoce (`data.orderOperam`); **el número de cotización nunca es igual al número de pedido en Operam**, así que el folio de la cotización (`folioOperam`) no sirve como `order_` (usarlo arriesgaría un falso match con el pedido de otra cadena). Sin `order_` explícito, agrega por cliente (correcto cuando el cliente tiene una sola oportunidad activa).

## Alta de cliente

Proceso de registrar a un cliente nuevo en Operam con todos los campos requeridos por el SOP-COM-OPERAM-001: datos fiscales, configuración comercial, contacto y domicilio de entrega. La realiza el **vendedor**. Se considera completa cuando el cliente puede usarse para generar cotizaciones, pedidos y facturas sin correcciones posteriores.

Tres caminos (todos desde el cotizador): el **cliente genérico** nace solo al generar la primera cotización (ADR-0006); el **upgrade fiscal** completa al genérico cuando llega la CSF (o por captura manual con mínimos: razón social, RFC, CP y régimen — para clientes que prefieren no compartir su constancia); el **alta completa** sin cotización vive en la vista Clientes ("+ → Nuevo cliente"). El contacto etiquetado "Invoices" para el envío automático de facturas NO es configurable por API (ADR-0002) y sigue siendo paso manual en la UI de Operam.

## Vista Clientes

Superficie de **mantenimiento de clientes** sin cotización de por medio (menú Más, issue #94): buscar un cliente (Operam + prospectos; los de RFC genérico se marcan en rojo), completar sus datos fiscales con CSF o captura manual, dar de alta un cliente completo, o saltar a cotizarle. Existe porque los casos "ya tengo los datos fiscales de un genérico" y "alta completa sin cotizar" son poco frecuentes pero reales, y antes obligaban a ir a la UI de Operam.

## Aprobación de pedido

Revisión final que hace **Adrián** antes de convertir una cotización en pedido en Operam. Es el punto de QA humano del proceso comercial: valida datos fiscales, configuración comercial y dirección de entrega. No es parte del alta de cliente.

## Vendedor

Actor que atiende prospectos, captura datos del cliente y genera cotizaciones. Usa el cotizador como herramienta principal: en el paso Cliente elige "Ya lo conozco" (buscar en Operam o en sus prospectos) o "Contacto nuevo" (celular, nombre, ciudad, canal — issue #82); el cliente genérico en Operam nace solo al generar la primera cotización (issue #81, ADR-0006), sin paso de alta manual. Cuando llega la CSF, el vendedor la sube desde el chip "Fiscal" de la tarjeta del cliente (issue #85) o desde la vista Clientes sin abrir una cotización (issue #94); en ambos casos se actualiza (nunca se crea) el cliente genérico existente, con un banner que muestra contra quién. Todo autenticado con el mismo JWT (ADR-0003; la herramienta standalone `csf-upload.html` fue retirada).

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

## Lista fijada (override)

En la cotización, la lista la determina el tabulador automático por piezas de producto (**Auto**). Un vendedor con el **permiso de fijar lista** (permiso individual otorgado por el admin, apagado por omisión; el rol admin siempre lo tiene) puede fijarla manualmente a cualquiera de los tiers, y la lista fijada manda de forma **absoluta** sobre el volumen, en ambas direcciones, con aviso informativo — nunca bloqueante — cuando no coincide con la que daría el tabulador (issue #98). El override vive en la **cotización**, no en el cliente: la siguiente cotización del mismo cliente arranca en Auto. **Editar** conserva la lista fijada sin importar quién edite (sin permiso se puede dejar o regresar a Auto, no cambiar a otra); **Copiar** solo la hereda si quien copia tiene el permiso. No deja marca especial: la lista elegida queda guardada con la cotización como siempre.

## Descuento (comercial)

Porcentaje por partida (0–100) que el vendedor captura sobre el precio de lista del tier vigente. Es distinto de la **Lista de precios**, que es el descuento estructural por volumen: el comercial se aplica encima y no mueve el tier (el tier lo fijan las piezas, nunca el dinero). Toda partida puede llevarlo, incluido el envío. El **descuento global** no es una entidad propia (ADR-0011): es un atajo de captura que escribe el mismo % en todas las partidas (re-aplicarlo las sobreescribe; después se puede ajustar línea por línea). La fuente de verdad es siempre el % por línea — documento, cotizador y Operam ven exactamente lo mismo, sin renglones de descuento que el ERP no pueda representar.

Descontar es un **permiso, no un derecho**: cada vendedor tiene un tope de descuento asignado por el admin, con 0% mientras no se le asigne (el rol admin no tiene tope). El control de fondo sigue siendo la Aprobación de pedido.

Con descuento, el valor que se declara a la paquetería para el seguro es el valor **con** descuento: lo que el cliente realmente paga, coincidente con la factura ante una reclamación.

## Descripción de partida

El texto que describe cada línea de la cotización, con un máximo de 1000 caracteres (el límite del campo en Operam). Por omisión viene del catálogo; el vendedor puede editarlo por partida (artículos y calcas), y vaciarlo lo regresa a la del catálogo. La descripción editada queda **también en Operam**, no solo en el documento del cliente: al crear el quote viaja en el payload de la API, y al actualizarlo conservando folio se reescribe línea por línea (edición por partida de la pantalla del quote, contrato verificado en vivo con el quote 1216 el 2026-08-13). Una descripción editada cuenta como cambio de contenido del quote y dispara su actualización.

La partida de **envío** es un caso aparte: su descripción no sale de ningún catálogo — la arma el cotizador con el servicio y el tiempo literales de la paquetería —, así que siempre se impone en Operam aunque el vendedor no la haya tecleado. El vendedor no la edita desde el carrito; sale de la tarifa elegida.

## Tiempo de entrega (envío cotizado)

El estimado que la paquetería reporta al cotizar el envío. Se promete al cliente en la descripción de la partida de envío usando el nombre del servicio y el estimado **literales** de la paquetería, con la precisión "hábiles" cuando el estimado viene en días (p. ej. "FedEx Nacional Económico — entrega estimada 1-2 días hábiles"). Esa misma promesa es la que queda escrita en la partida de envío del quote de Operam, tanto al crearlo como al actualizarlo.

## Borrador de cotización

El 100% del avance de la sesión de Cotizar en curso — carrito con descuentos y descripciones editadas, cliente o contacto nuevo a medio capturar, envío elegido, lista fijada, vigencia, vendedor confirmado y, en modo Editar, el binding al registro original — conservado automáticamente en el dispositivo, por vendedor, sin acción del usuario (decisión 2026-08-17, issue #177; origen: en Android, cambiar de app descarta la pestaña y borraba todo). Sobrevive al cierre del navegador, al cambio de app y al cierre de sesión; nunca es visible para otro vendedor en el mismo dispositivo. Al volver se restaura: en silencio si la última actividad fue hace menos de 30 minutos, con prompt Continuar / Descartar (Descartar pide confirmación) si fue hace más. Muere al generar la cotización con éxito, al empezar una cotización nueva, al descartarlo o a los 30 días sin tocarlo. Los precios no reviven con el borrador: cada línea se re-resuelve contra el catálogo vigente — la intención (productos, cantidades, descuentos) es del vendedor; los precios son del catálogo — y un SKU que ya no existe marca la línea como inválida. El gate de Editar se re-aplica al generar, no al restaurar.

## Borrador de formulario

Lo tecleado en cualquier otro formulario del sistema (captura de prospecto, alta completa de cliente, upgrade fiscal, edición de prospecto, toques) se conserva igual — por dispositivo y por vendedor — y reaparece al volver a abrir ese mismo formulario, marcado visiblemente como borrador restaurado y con forma de limpiarlo. Se limpia al enviar con éxito o al cancelar explícitamente; sin prompt de 30 minutos (el prefill de un formulario no arriesga nada equivalente a generar una cotización vieja). Un archivo adjunto (la CSF) no es restaurable; los datos ya extraídos de él, sí.

## Guardrail

Restricción en el formulario de alta que impide errores críticos sin requerir intervención de Adrián. Ejemplo: detectar RFC duplicado antes de crear el cliente. Los guardrails hacen viable que el vendedor complete el alta por sí solo.
