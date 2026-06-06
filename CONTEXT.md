# Glosario de dominio — Cotizador Peltre Nacional

## Alta de cliente

Proceso de registrar a un cliente nuevo en Operam con todos los campos requeridos por el SOP-COM-OPERAM-001: datos fiscales, configuración comercial, contacto y domicilio de entrega. La realiza el **vendedor**. Se considera completa cuando el cliente puede usarse para generar cotizaciones, pedidos y facturas sin correcciones posteriores.

## Aprobación de pedido

Revisión final que hace **Adrián** antes de convertir una cotización en pedido en Operam. Es el punto de QA humano del proceso comercial: valida datos fiscales, configuración comercial y dirección de entrega. No es parte del alta de cliente.

## Vendedor

Actor que atiende prospectos, captura datos del cliente, crea el alta en Operam y genera cotizaciones. Usa el cotizador como herramienta principal. Tiene acceso a `csf-upload.html` para dar de alta clientes y al cotizador principal para generar cotizaciones.

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
