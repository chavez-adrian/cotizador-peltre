# Spike: integracion de la API de Lalamove como opcion de envio local

Issue de referencia: #72 (chavez-adrian/cotizador-peltre)
Fecha del spike: 2026-07-30
Alcance: investigacion documental sobre fuentes primarias (developers.lalamove.com, lalamove.com/es-mx). No se probo la API en vivo (no hay credenciales tramitadas todavia).

---

## Resumen ejecutivo

La integracion es **viable en principio**: la API de Lalamove opera en Mexico, tiene un endpoint de cotizacion (`POST /v3/quotations`) que devuelve tarifa sin crear la orden, ofrece sandbox gratuito, y documenta tipos de vehiculo con capacidad de carga hasta 1,500 kg (Camion) — mas que suficiente para una cotizacion de mayoreo de peltre que supere 100 kg.

Ningun supuesto del brief original quedo contradicho por la documentacion publica. Lo que SI queda como incognita real (no resuelta por documentacion publica, ver seccion de riesgos) es si la cobertura de recolector/entrega alcanza Ixtapaluca, Estado de Mexico, donde esta la fabrica — toda la documentacion publica de Mexico habla de "Ciudad de Mexico" como referencia y no menciona explicitamente el resto de la zona metropolitana ni municipios del Edomex.

**Que debe tramitar Adrian Chavez, en orden, para empezar a probar:**

1. Entrar a `https://partnerportal.lalamove.com` y registrar una cuenta de Partner Portal (rol "API ally") para Peltre Nacional.
2. Dentro del portal, ir a la pestana "Developers" y generar las llaves de **sandbox** (`pk_test` / `sk_test`) — esto es gratuito, sin aprobacion ni papeleo adicional segun la documentacion.
3. Con esas llaves, hacer una prueba de `GET /v3/cities` con `Market: MX` para confirmar que servicios/vehiculos existen realmente para Mexico y sus locodes exactos, y una prueba de `POST /v3/quotations` con una direccion de origen en Ixtapaluca (o el CP de la fabrica) para ver si el sistema la acepta o la rechaza por estar fuera de cobertura. **Este paso es el que resuelve la principal incognita del spike** — no requiere pasar a produccion, sandbox alcanza para esto.
4. Si el resultado de (3) es favorable, contactar a `partner.support@lalamove.com` para preguntar puntualmente por cobertura de recoleccion en Ixtapaluca/zona oriente del Edomex y por tarifas reales de referencia.
5. Solo si (3) y (4) confirman cobertura util, avanzar a producción: recargar el "Lalamove Wallet" vía Partner Portal para generar llaves `pk_prod`/`sk_prod`.

No hay necesidad de compromiso comercial ni minimo de volumen documentado publicamente para llegar hasta el paso 4 — todo eso es gratuito y de bajo riesgo.

---

## 1. Disponibilidad en Mexico

Confirmado: Mexico (codigo de mercado `MX`) es uno de los 11 mercados donde opera la API de Lalamove, junto con Japon, Brasil, Hong Kong, Indonesia, Malasia, Filipinas, Singapur, Taiwan, Tailandia y Vietnam.

La documentacion de referencia y la pagina publica de tarifas para Mexico solo mencionan explicitamente **Ciudad de Mexico** como ciudad de cobertura. Ni la documentacion de desarrollador ni la pagina de tarifas listan Ixtapaluca ni otros municipios del Estado de Mexico por nombre. El endpoint `GET /v3/cities` (con header `Market: MX`) es, segun la documentacion, la fuente autoritativa de las ciudades/locodes soportados y hay que consultarlo directamente con credenciales — no se pudo verificar su respuesta exacta sin cuenta.

**No verificado:** si Ixtapaluca especificamente cae dentro del poligono de cobertura de recoleccion/entrega. Esto no esta documentado publicamente y solo se resuelve consultando `GET /v3/cities` o probando una cotizacion real con esa direccion de origen.

Fuentes primarias:
- https://developers.lalamove.com/ (lista de mercados soportados)
- https://www.lalamove.com/es-mx/todos-vehiculos-tarifa-detalles (pagina de tarifas Mexico, solo menciona CDMX)

---

## 2. Requisitos de acceso

Segun la pagina oficial de API de Lalamove Mexico (`lalamove.com/es-mx/api`), el proceso tiene 4 pasos:

1. Revisar la documentacion de la API con desarrolladores internos.
2. Registrarse en el Partner Portal (`partnerportal.lalamove.com`) como "API ally".
3. Probar en sandbox con llaves de prueba (`pk_test`/`sk_test`) — **gratuito, sin aprobacion adicional** segun la documentacion ("No additional credentials or approvals are required" para sandbox).
4. Pasar a produccion recargando el "Lalamove Wallet" con dinero real para generar llaves `pk_prod`/`sk_prod`.

No se documenta publicamente un minimo de volumen ni un costo de alta por si mismo — el "costo" es el saldo que se recarga en el wallet para pagar los envios reales una vez en produccion. La documentacion no distingue explicitamente "cuenta business" de "cuenta personal" en el contexto del Partner Portal (usa el termino "API ally"); si existe una distincion formal de tipo de cuenta legal/fiscal, no quedo documentada en las fuentes publicas revisadas — es otra pregunta para `partner.support@lalamove.com`.

Fuentes primarias:
- https://www.lalamove.com/es-mx/api
- https://developers.lalamove.com/ (seccion de autenticacion / sandbox vs produccion)

---

## 3. Endpoint de cotizacion

Si existe: `POST /v3/quotations`, documentado en `developers.lalamove.com`, que NO crea una orden — solo devuelve una tarifa y un `quotationId` que despues (opcionalmente) se usa para colocar la orden real con `POST /v3/orders`.

**Request** (campos documentados):

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `serviceType` | string | si | tipo de vehiculo; las claves varian por mercado, se consultan via `GET /v3/cities` |
| `stops` | array | si | de 2 a 16 paradas, cada una con `coordinates` (`lat`/`lng`) **y** `address` (texto) |
| `language` | string | si | idioma de la direccion, ej. `en_HK`, `zh_HK` (para MX seria el equivalente en espanol/ingles de Mexico, no confirmado el codigo exacto) |
| `scheduleAt` | string | no | ISO 8601 UTC; se omite para servicio inmediato, se incluye para programar hasta 30 dias adelante |
| `specialRequests` | array | no | manejo especial (ej. mas de un socio conductor para carga pesada) |
| `isRouteOptimized` | boolean | no | optimizacion de ruta con multiples paradas |
| `item` | object | no | peso, categorias, instrucciones de manejo |

Cada parada (`stop`) requiere **ambos** campos: coordenadas lat/lng Y direccion de texto — no es "una u otra", la documentacion muestra el formato con los dos juntos.

**Autenticacion:** HMAC-SHA256. Formula documentada:

```
SIGNATURE = HmacSHA256(<TIMESTAMP>\r\n<HTTP_VERB>\r\n<PATH>\r\n\r\n<BODY>, <SECRET>)
```

Headers requeridos: `Authorization: hmac <KEY>:<TIMESTAMP>:<SIGNATURE>`, `Market: <MARKET_CODE>`, `Request-ID: <NONCE>`. Timestamps en milisegundos Unix, firma en hex minusculas, todo sobre HTTPS.

**Response (201):** incluye `quotationId` (UUID), `expiresAt`, `priceBreakdown` (base, kilometraje extra, recargos, IVA, total), `stops` con `stopId` asignado, `distance` (metros), y eco de `serviceType`/`specialRequests`/`item`.

**Vigencia de la cotizacion:** Lalamove "honra" la cotizacion durante **5 minutos**, incluso si el precio subio en ese lapso — la orden se coloca al precio cotizado originalmente si se confirma dentro de esa ventana.

**Rate limits documentados** (peticiones por minuto):

| Endpoint | Sandbox | Produccion |
|---|---|---|
| Get Quotation | 30 | 100 |
| Get Quotation Details | 50 | 300 |
| Place Order | 30 | 100 |
| Get Order Details | 50 | 300 |
| Get Driver Details | 50 | 300 |
| Change Driver | 30 | 100 |
| Cancel Order | 30 | 100 |
| Add Priority Fee | 30 | 100 |
| Get City Info | 50 | 300 |

Los headers de respuesta exponen `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` para monitorear consumo.

Fuente primaria: https://developers.lalamove.com/

---

## 4. Tipos de vehiculo en Mexico y limites de carga

La pagina publica de tarifas de Mexico (`lalamove.com/es-mx/todos-vehiculos-tarifa-detalles`) documenta esta tabla de vehiculos disponibles y sus limites:

| Vehiculo | Peso maximo | Dimensiones maximas (L x A x Al, cm) |
|---|---|---|
| Motocicleta | 20 kg | 40 x 40 x 35 |
| Hatchback | 100 kg | 90 x 90 x 70 |
| Auto | 200 kg | 125 x 80 x 60 |
| SUV | 300 kg | 130 x 160 x 80 |
| Pick up | 700 kg | 168 x 134 x 51 |
| Camioneta | 500 kg | 188 x 133 x 108 |
| Van | 1,000 kg | 200 x 120 x 120 |
| Camion | 1,500 kg | 200 x 200 x 170 |

Para el caso de Peltre Nacional (cotizaciones de mayoreo que pueden superar 100 kg), los vehiculos relevantes serian Camioneta, Van o Camion — todos por encima del umbral de 100 kg mencionado en el brief.

**Nota de fuente:** esta tabla viene de la pagina publica de marketing/tarifas de Lalamove Mexico, NO del endpoint tecnico `GET /v3/cities` de la API de desarrollador (que es la fuente que la propia documentacion tecnica indica como autoritativa y que hay que "consultar periodicamente" porque las claves de servicio y limites pueden cambiar). Es razonable como referencia inicial, pero **debe confirmarse contra `GET /v3/cities` con credenciales reales** antes de disenar la logica de seleccion de vehiculo — las claves de `serviceType` que devuelve ese endpoint son las que en realidad hay que mandar en `POST /v3/quotations`, y podrian no ser exactamente estos ocho nombres.

Fuentes primarias:
- https://www.lalamove.com/es-mx/todos-vehiculos-tarifa-detalles
- https://developers.lalamove.com/ (indicacion de consultar `GET /v3/cities` para claves de servicio reales)

---

## 5. Restricciones practicas

**Geocoding:** el formato de `stops` en `POST /v3/quotations` exige **ambos** campos — `coordinates` (lat/lng) y `address` (texto) — en cada parada, segun el ejemplo documentado. Esto implica que el cotizador SI necesitaria hacer geocoding previo (convertir la direccion de texto capturada hoy en el flujo de alta de cliente a lat/lng) antes de poder llamar el endpoint; no basta con mandar solo la direccion de texto. Esta es una pieza de trabajo adicional real si se integra: hoy `lib/parsear-csf.js` y el flujo de domicilio del cotizador no generan coordenadas.

**Vigencia de la cotizacion:** confirmado en la seccion 3 — 5 minutos, con el precio "congelado" para la orden si se confirma dentro de esa ventana.

Fuente primaria: https://developers.lalamove.com/

---

## Riesgos e incognitas que solo se resuelven con la cuenta ya tramitada

Estas preguntas NO tienen respuesta en la documentacion publica y solo se resuelven teniendo credenciales de sandbox (gratis) o de produccion:

- **Cobertura real de Ixtapaluca:** si `GET /v3/cities` (Market: MX) y una cotizacion de prueba con origen en la fabrica realmente devuelven servicio, o si el poligono de cobertura de Lalamove Mexico se limita a CDMX y colonias cercanas dejando fuera la zona oriente del Edomex. Este es el riesgo mas importante para el caso de uso de Peltre Nacional, porque el punto de recoleccion (la fabrica) es lo que esta en duda, no solo el destino.
- **Tarifas reales:** la pagina publica no da montos ($/km, tarifa base) — solo el algoritmo de factores (trafico, volumen, disponibilidad, peajes). El costo real solo se conoce cotizando en sandbox/produccion.
- **Limites de peso reales para Camioneta/Van/Camion en la practica:** la tabla publica da limites nominales; no se sabe si en la operacion real de Mexico hay restricciones adicionales (ej. disponibilidad real de socios conductores con vehiculo de esa capacidad en la zona, o si el sistema rechaza pedidos que se acercan al limite por seguridad).
- **Claves exactas de `serviceType` para Mexico:** la tabla de vehiculos de la seccion 4 viene de marketing, no de la API; los nombres reales que acepta `POST /v3/quotations` (`serviceType`) hay que obtenerlos de `GET /v3/cities` con credenciales.
- **Soporte real de tracking/guia:** la documentacion menciona `Get Order Details` y `Get Driver Details`, pero no se investigo en este spike el detalle de que informacion de tracking queda disponible para compartir con el cliente final (link publico de seguimiento, POD/prueba de entrega, etc.) — util para el flujo de WhatsApp del cotizador.
- **Tipo de cuenta legal/fiscal requerida** para el Partner Portal (persona moral vs persona fisica con actividad empresarial) — no documentado publicamente, habria que preguntar directo a partner.support@lalamove.com.
- **Idioma/locale exacto** que espera el campo `language` para direcciones en Mexico (los ejemplos documentados son de Hong Kong: `en_HK`, `zh_HK`) — no se encontro el codigo exacto para `es_MX` o similar en la documentacion publica revisada.
