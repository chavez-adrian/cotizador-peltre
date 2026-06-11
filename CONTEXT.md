# Glosario de dominio — Cotizador Peltre Nacional

## Prospecto

La persona o entidad detrás de un número de celular que mostró interés comercial pero aún no tiene alta de cliente en Operam. Un celular corresponde siempre a exactamente un prospecto. No existe una entidad "oportunidad" separada: cada cotización ligada al prospecto representa una oportunidad, y el historial del prospecto las acumula (una agencia que cotiza para dos clientes finales es un prospecto con dos cotizaciones; un restaurantero que vuelve meses después es el mismo prospecto con historial).

Un cliente con alta en Operam nunca vuelve a ser prospecto: si el celular capturado pertenece a un cliente existente, el sistema lo señala (guardrail, mismo patrón que la deduplicación de clientes) y el vendedor cotiza sobre el cliente, no crea prospecto. Esa detección es "best effort": en Operam los teléfonos no viven en el cliente sino repartidos entre sus contactos y sus domicilios de entrega, en formatos inconsistentes; la comparación se hace por los últimos 10 dígitos del número nacional.

## Etapas de prospecto

Nuevo (capturado, sin atender) → Contactado (hubo primera conversación) → Calificado (se conoce tipo de cliente, piezas aproximadas y es mayoreo viable) → Cotizado. La transición a Cotizado es automática al ligarse una cotización al celular del prospecto; en ese momento el seguimiento de la cotización releva al seguimiento del prospecto — una persona nunca tiene dos colas activas. Si se crea una cotización con un celular que no corresponde a ningún prospecto ni cliente de Operam, el sistema crea el prospecto automáticamente en etapa Cotizado, pidiendo al vendedor únicamente el canal de origen; el resto de los datos se toma de la cotización. Así el embudo queda completo sin perder el canal real. Salida en cualquier etapa: No útil, con motivo obligatorio de catálogo corto (menudeo, fuera de zona, sin presupuesto, spam, sin respuesta). El prospecto se asigna al vendedor que lo captura; un proceso de asignación manual o automático es evolución futura.

## Prospecto convertido en cliente

Un prospecto cuyo celular se dio de alta como cliente en Operam queda ligado a ese cliente, pero la conversión NO lo saca del seguimiento: permanece en la cola con la etiqueta "Ya es cliente — falta cotizar" hasta que una cotización lo pase a Cotizado (decisión 2026-06-11: la conversión real del negocio es la venta, no el alta; la cola vigila la fuga de altas que nunca cotizan).

## Visibilidad de prospectos

Cada vendedor ve únicamente sus propios prospectos; el rol admin ve todos — el mismo modelo de visibilidad que las cotizaciones. Cuando un vendedor intenta capturar un celular que ya es prospecto de otro vendedor, el sistema rechaza la captura indicando quién lo atiende ("este celular ya lo atiende [vendedor]"), sin exponer más datos del prospecto; la coordinación entre vendedores ocurre fuera del sistema.

## Horas hábiles

El reloj con el que se mide la espera de un prospecto: lunes a viernes 10:00–18:00, sábado 10:00–14:00, festivos mexicanos excluidos. Un prospecto que escribe en fin de semana o festivo no acumula espera; los prospectos aceptan respuesta a la mañana siguiente hábil sin molestia. Las cotizaciones, en cambio, se siguen midiendo en días naturales (cadencia día 2/7/21/vencida).

## Cadencia de prospecto

Los tiempos de seguimiento de un prospecto corren en horas hábiles y dependen del canal: WhatsApp e Instagram esperan respuesta en horas (rojo a las 2 horas hábiles sin contactar); correo y formulario toleran más (rojo a las 8). Cada prospecto muestra una etiqueta visible de horas hábiles sin respuesta con semáforo (verde < 2, ámbar 2–8, rojo > 8). Tras 3 toques sin respuesta el sistema sugiere — nunca aplica solo — la salida a No útil (sin respuesta). Una reunión diagnóstico futura suprime la cadencia.

## Captura de prospecto

Registro mínimo de un prospecto, diseñado para hacerse en segundos desde el teléfono. Obligatorios: celular (con código de país), nombre (se acepta sin apellido) y ciudad (necesaria para estimar envío). Opcionales: empresa, tipo de cliente (segmentos existentes), piezas estimadas (+100/+350/+550/+1,500/+6,000), correo, temperatura (1–5) y notas. Canal de origen obligatorio, de catálogo cerrado: WhatsApp, Instagram, Facebook/Messenger, Meta Ads (pagado — se distingue del orgánico), Formulario web, Correo, Referido, Bazar Sábado, Feria/Expo. Los prospectos de Feria/Expo no se capturan a mano: la plataforma del evento entrega un CSV de gafetes escaneados que se importa deduplicando por celular.

Actividad con fecha sobre un prospecto (no es etapa): llamada o videollamada que el prospecto solicita para explorar su proyecto. Mientras la reunión está en el futuro, la cadencia de seguimiento del prospecto se suprime; pasada la fecha, el seguimiento pide registrar el resultado (avanzar a Calificado o salir a No útil).

## Tablero de prospectos

Vista kanban de los prospectos (conmutable con la vista de lista; la cola "Qué toca hoy" permanece fija sobre ambas). Cinco columnas siempre visibles: Nuevo, Contactado, Calificado, Cotizado y No útil (con su motivo en la tarjeta). El arrastre de tarjetas respeta las reglas del dominio — un paso adelante, soltar en No útil exige motivo, y Cotizado no acepta arrastres porque solo una cotización real mueve ahí (decisión 2026-06-11: se replica la experiencia de Bitrix24 sin sacrificar que el embudo mida verdad). Funciona también en el teléfono (desplazamiento horizontal por columna; en táctil el cambio de etapa puede seguir siendo por botón).

## Tablero de cotizaciones

Vista kanban de las cotizaciones cuyas columnas son la cadencia de seguimiento más el cierre: Recién enviada, Día 2, Día 7, Por vencer, Vencida, Ganada y Perdida. Las tarjetas avanzan solas con el tiempo (las columnas de cadencia no aceptan arrastres); solo el cierre se opera arrastrando a Ganada o Perdida. Se llama "Cotizaciones" — término canónico — aunque Bitrix24 le llamara negociaciones. Las etapas post-venta (producción, entrega) viven en Operam y no son columnas de este tablero.

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
