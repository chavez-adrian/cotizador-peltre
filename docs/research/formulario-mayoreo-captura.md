# Captura de teléfono, código postal y correo en el formulario de leads de mayoreo

**Fecha de investigación:** 2026-08-15
**Alcance:** México (principal), Estados Unidos y Canadá (secundarios)
**Contexto técnico asumido:** frontend vanilla JS sin bundler, assets vendoreados, Express en Render (una instancia), formulario servido desde dominio propio y embebido vía iframe en Shopify, decenas de envíos al mes, Cloudflare Turnstile ya decidido, código ASCII estricto.

> **Nota sobre este documento.** Es la primera nota de investigación del repo. En `cotizador/` los documentos viven en `docs/` (`arquitectura.md`, `adr/`, `spikes/`) y no había convención previa para notas de investigación; se establece aquí `docs/research/` como el lugar para este tipo de material. A diferencia del código, este archivo sí lleva acentos — es documentación, no fuente.
>
> Todo dato con URL fue verificado contra la fuente primaria en la fecha indicada. Lo que **no** se pudo verificar está marcado explícitamente con **[NO VERIFICADO]**. Las mediciones hechas por mí mismo (descargas, conteos, tamaños) están en el apéndice con los comandos para reproducirlas.

---

## 1. Resumen ejecutivo — qué adoptar exactamente

| Área | Decisión recomendada |
|---|---|
| **Widget de teléfono** | `intl-tel-input` v29.2.3, vendoreado. Copiar `intlTelInput.min.js` (50 KB), `intlTelInput.min.css` (15 KB), `utils.js` (269 KB, cargado en diferido) y los sprites de `dist/img/`. |
| **País inicial del teléfono** | `initialCountry: "mx"` fijo. **No** hacer lookup por IP. |
| **Validación de teléfono en cliente** | `iti.isValidNumber()` (por longitud, no `isValidNumberPrecise`) + `getValidationError()` para el mensaje. Guardar E.164 con `getNumber()`. |
| **Revalidación en servidor** | `libphonenumber-js` v1.13.11, import `libphonenumber-js/max`, `isValidPhoneNumber()`. Cero dependencias, MIT. |
| **Código postal MX / US / CA** | **Self-host del dataset de GeoNames**, cargado en memoria al arrancar. Sin llamada externa, sin llave, sin timeout, sin proveedor. ~384 KB gzip para los tres países. |
| **Granularidad CA** | Solo FSA (3 primeros caracteres) — suficiente para ciudad+provincia, que es todo lo que necesita un lead. |
| **Fallback de CP** | Campos `ciudad` y `estado` siempre visibles, prellenados y **editables**. Nunca bloquear el envío por un CP que no resuelve. |
| **Servicios de CP externos** | Ninguno. A este volumen no aportan nada que el dataset local no dé, y todos introducen llave, latencia y riesgo de proveedor. |
| **Correo — cliente** | `type="email"` + `required` + exigir al menos un punto en el dominio. Nada más restrictivo. |
| **Correo — detección de typos** | Implementar a mano (~40 líneas + lista de ~20 dominios MX/US). `mailcheck` está muerto y su sucesor no publica en npm desde 2023. |
| **Correo — MX en DNS** | `dns.promises.resolveMx()` nativo, con fallback a `resolveA` (regla de MX implícito de RFC 5321) y timeout de 2 s. **Advertencia suave, nunca bloqueo.** |
| **Etiquetas** | Fijas arriba del campo. Sin floating labels, sin placeholder-como-etiqueta. |
| **Momento de validar** | En `blur`, no en cada tecla. Excepción: CP y teléfono pueden validarse al alcanzar la longitud esperada. |
| **Requeridos/opcionales** | Marcar **ambos** explícitamente (asterisco + "(opcional)"). |
| **`autocomplete`** | Obligatorio en todos los campos (es requisito WCAG 1.3.5 nivel AA, no solo comodidad). Tabla en §4.4. |
| **iframe** | Altura vía `postMessage` + `ResizeObserver`, verificando `event.origin` con origen exacto. Añadir `allow="shared-autofill"` en el `<iframe>` del tema de Shopify. |
| **Excepción al "sin CDN"** | Turnstile **no se puede vendorear**: Cloudflare prohíbe explícitamente proxiar o cachear `api.js`. Es la única dependencia de tercero cargada en runtime. |

**La decisión de mayor impacto es la del código postal:** el análisis muestra que a decenas de envíos al mes ningún servicio externo se justifica. El catálogo completo de MX+US+CA cabe en RAM (~2.3 MB en JSON, ~384 KB comprimido) en el único proceso Node que ya corre en Render. Eso elimina de un golpe: llaves de API, cuotas, latencia de red, timeouts, cachés, y la posibilidad de que el campo CP falle porque un tercero se cayó.

---

## 2. Pregunta 1 — Widget de teléfono internacional

### 2.1 ¿Sigue vigente `intl-tel-input` en 2026? Sí, y con margen.

Verificado directamente contra la API de GitHub y el registry de npm el 2026-08-15:

| Dato | Valor | Fuente |
|---|---|---|
| Versión actual | **29.2.3**, publicada **2026-08-14** | [api.github.com releases](https://api.github.com/repos/jackocnr/intl-tel-input/releases) |
| Último push al repo | **2026-08-14T09:59:52Z** (ayer) | [api.github.com/repos/jackocnr/intl-tel-input](https://api.github.com/repos/jackocnr/intl-tel-input) |
| Estrellas / archivado | 8,245 / **no archivado** | ídem |
| Issues abiertos | **1** | ídem |
| Licencia | MIT | ídem |
| Dependencias en npm | **ninguna** | [registry.npmjs.org/intl-tel-input/latest](https://registry.npmjs.org/intl-tel-input/latest) |

Las cinco releases más recientes muestran mantenimiento real, no cosmético: v29.2.3 "Update utils to libphonenumber v9.0.37" (2026-08-14), v29.2.2 arreglo de `initialCountryLookup` fallido que borraba el país seleccionado (2026-08-07), v29.2.1 arreglos de `strictMode`, v29.1.3 códigos de área faltantes de Jersey/Guernsey (2026-08-04). Fuente: [releases](https://api.github.com/repos/jackocnr/intl-tel-input/releases?per_page=5).

Un issue abierto sobre 8.2k estrellas es una señal fuerte de que el mantenedor está al día.

### 2.2 Tamaños reales de los archivos a vendorear

Medidos contra el manifiesto de jsDelivr para el paquete npm publicado ([data.jsdelivr.com/v1/packages/npm/intl-tel-input@29.2.3](https://data.jsdelivr.com/v1/packages/npm/intl-tel-input@29.2.3)):

| Archivo | Bytes | Nota |
|---|---|---|
| `dist/js/intlTelInput.min.js` | **50,336** | núcleo, obligatorio |
| `dist/js/utils.js` | **268,650** | libphonenumber compilado, carga diferida |
| `dist/js/intlTelInputWithUtils.min.js` | 316,268 | alternativa todo-en-uno, **no recomendada** |
| `dist/css/intlTelInput.min.css` | **15,450** | incluye referencias a los sprites de banderas |
| `dist/css/intlTelInput-no-assets.min.css` | 15,353 | si prefieres servir tus propias banderas |
| `dist/js/data.min.js` | 6,269 | datos de países (ya incluidos en el bundle principal) |
| `dist/img/` | sprites PNG y WebP | banderas |

La documentación oficial redondea así: **"The utils script adds ~260KB on top of the ~30KB core library"** — el "~30KB" es gzip; los 50,336 B de arriba son el `.min.js` sin comprimir. Fuente: [`site/src/docs/markdown/utils.md`](https://github.com/jackocnr/intl-tel-input/blob/master/site/src/docs/markdown/utils.md).

### 2.3 Cómo vendorearlo sin build tools

La documentación oficial tiene una ruta explícita "Using a script tag" que no requiere bundler, y dice literalmente *"Alternatively, use your own hosted files"*. Fuente: [`vanilla_javascript.md`](https://github.com/jackocnr/intl-tel-input/blob/master/site/src/docs/markdown/vanilla_javascript.md).

Adaptado a rutas locales:

```html
<link rel="stylesheet" href="/vendor/intl-tel-input/intlTelInput.min.css">
<script src="/vendor/intl-tel-input/intlTelInput.min.js"></script>
<script>
  var input = document.querySelector("#telefono");
  var iti = window.intlTelInput(input, {
    initialCountry: "mx",
    loadUtils: function () { return import("/vendor/intl-tel-input/utils.js"); }
  });
</script>
```

Detalle importante: `loadUtils` recibe una función que devuelve un `import()` dinámico. El ejemplo oficial usa una URL de jsDelivr dentro de un `<script>` clásico — es un `import()` nativo del navegador, no del bundler, así que **funciona igual apuntando a una ruta local vendoreada**. No hace falta ningún paso de build.

La única condición es servir `utils.js` con `Content-Type: text/javascript` desde el mismo origen (Express con `express.static` ya lo hace).

### 2.4 Cómo funciona la validación

`utils.js` es *"a custom build of Google's libphonenumber that powers all formatting, validation, and placeholder generation"*. Solo tras cargarlo funcionan `isValidNumber`, `getNumberType`, `getValidationError` y los placeholders por país. Fuente: [`utils.md`](https://github.com/jackocnr/intl-tel-input/blob/master/site/src/docs/markdown/utils.md).

**Decisión no obvia — `isValidNumber` vs `isValidNumberPrecise`.** En v29 los nombres cambiaron y la elección importa:

- `utils.isValidNumber()` — valida **por longitud**. La doc dice: *"More future-proof than `utils.isValidNumberPrecise`, as country length rules rarely change."* (Antes se llamaba `isPossibleNumber`.)
- `utils.isValidNumberPrecise()` — valida contra reglas exactas de código de área. La doc advierte: *"these rules change each month for various countries, so the package needs to be kept up-to-date (e.g. via an automated script) — otherwise you may start rejecting valid numbers."* (Antes se llamaba `isValidNumber`.)

Fuente: [`utils.md`](https://github.com/jackocnr/intl-tel-input/blob/master/site/src/docs/markdown/utils.md).

Para un formulario de leads, **rechazar un lead válido cuesta más que aceptar uno dudoso**. Usar `isValidNumber` (por longitud) y actualizar el paquete sin prisa.

Buenas prácticas oficiales que conviene seguir tal cual ([`best_practices.md`](https://github.com/jackocnr/intl-tel-input/blob/master/site/src/docs/markdown/best_practices.md)):

- **Guardar en E.164** (`+525512345678`). *"Since the dial code is embedded in the number, you don't need to store the country separately."* Se lee con `getNumber()` y se restaura pasando el E.164 como valor inicial del input.
- **`strictMode` está activo por default** y bloquea caracteres no numéricos y topa la longitud máxima del país. La doc insiste en que el rechazo no sea silencioso: `strictRejectAnimation` da un shake/flash sin escribir código, y el evento `strict:reject` permite mensaje propio con `e.detail = { source, rejectedInput, reason }`.
- **Mapear el código de error a mensaje propio.** `getValidationError()` devuelve `TOO_SHORT`, `TOO_LONG`, `INVALID_COUNTRY_CODE`, etc. La doc trae un helper `getErrorMessage` de ejemplo — traducirlo al español y ya.

### 2.5 Preselección de país por IP — recomendación: **no hacerlo**

`intl-tel-input` soporta la detección por IP mediante `initialCountryLookup` (opción **renombrada**; antes era `geoIpLookup`), que solo corre si `initialCountry` no está fijado. Fuente: [`best_practices.md`](https://github.com/jackocnr/intl-tel-input/blob/master/site/src/docs/markdown/best_practices.md) y la página de ejemplo [intl-tel-input.com/examples/vanilla-javascript/lookup-country](https://intl-tel-input.com/examples/vanilla-javascript/lookup-country).

La propia doc del ejemplo advierte que el servicio que sugiere (ipapi.co) *"has a limited free tier that stops working once its quota is reached"*.

**Verificación en vivo, 2026-08-15** — llamé a los endpoints desde esta máquina:

| Endpoint | Resultado real | CORS `*` | Llave | Uso comercial |
|---|---|---|---|---|
| `ipapi.co/json/` | **`{"error":true,"reason":"RateLimited"}`** | — | no | free = "testing/development" según su pricing |
| `api.country.is/` | `{"ip":"...","country":"MX"}` ✅ | **sí** | **no** | **sí** |
| `ipwho.is/` | `{"country_code":"MX","success":true}` ✅ | **sí** | **no** | **sí** |
| `www.cloudflare.com/cdn-cgi/trace` | `loc=MX` ✅ | **sí** | no | endpoint interno no documentado |
| `api.zippopotam.us/mx/56530` | 200 ✅ | **sí** | no | — |

El caso de `ipapi.co` es demostrativo: es el servicio que la documentación oficial de intl-tel-input sugiere, y en una llamada sin llave desde una IP residencial mexicana **devolvió `RateLimited` a la primera**. Su pricing confirma el free tier en 1,000/día y lo describe como apto solo para pruebas ([ipapi.co/#pricing](https://ipapi.co/#pricing)).

Datos de los que sí sirven:

- **country.is** — *"No quotas. Infrastructure rate-limits to 10 requests per second per IP to prevent abuse."*, sin llave, uso comercial permitido, operado por Line of Flight desde 2015, datos de MaxMind GeoLite2 + Cloudflare. Fuente: [country.is](https://country.is/).
- **ipwho.is** — free endpoint 1,000 req/día, sin registro ni llave, *"Commercial use allowed"*, sin SLA. Detalle crítico para nuestro caso: *"When using CORS (JavaScript requests from your website), requests are counted per domain, not per individual visitor IP. The daily limit is shared across all traffic from that domain."* Fuente: [ipwhois.io/documentation](https://ipwhois.io/documentation).

**Qué NO sirve:**

- **`ip-api.com`** queda descartado de entrada: *"The use of the API is strictly limited for a non-commercial purpose and in a non-commercial environment"* y *"Only members with a pro subscription can use the API in a commercial environment."* Un formulario de leads de una empresa es uso comercial. Fuente: [ip-api.com/docs/legal](https://ip-api.com/docs/legal).
- **`CF-IPCountry`** no aplica. El header requiere que el tráfico pase por Cloudflare, y además hay que activarlo: *"To add this header to requests... enable the **Add visitor location headers** Managed Transform."* Fuente: [Cloudflare HTTP headers](https://developers.cloudflare.com/fundamentals/reference/http-headers/). El servidor está en Render, que documenta `X-Forwarded-For` para la IP del cliente pero **no expone ningún header de país** — busqué en su documentación y no existe. El endpoint `www.cloudflare.com/cdn-cgi/trace` sí responde `loc=MX` con `Access-Control-Allow-Origin: *` (verificado), pero es una ruta interna sin contrato público; construir sobre ella es aceptar que se rompa sin aviso.

**Recomendación: `initialCountry: "mx"` fijo.**

El razonamiento no es de costo, es de tasa de acierto. El público objetivo del formulario de mayoreo es abrumadoramente mexicano. Un default MX acierta la gran mayoría de las veces con **cero** latencia, cero llamadas de red, cero llaves y cero dependencias. La detección por IP cambia ese acierto por: una llamada de red bloqueante antes de que el campo sea usable, una cuota de tercero, y un modo de falla nuevo — precisamente el que v29.2.2 tuvo que parchar ("failed `initialCountryLookup` wiping the user's selected country"). Además, un vendedor mexicano usando VPN o un cliente de US que ya está tecleando su número ven el mismo selector de país a un clic de distancia.

Si en algún momento se quiere la detección, usar **country.is** (sin llave, CORS, comercial permitido, 10 rps) y siempre con fallback a `"mx"`.

### 2.6 Revalidación en servidor (Node)

**`libphonenumber-js`** es la elección correcta y está viva:

| Dato | Valor | Fuente |
|---|---|---|
| Versión | **1.13.11**, publicada **2026-08-14** | [registry.npmjs.org/libphonenumber-js](https://registry.npmjs.org/libphonenumber-js) |
| Cadencia | 1.13.7 (18 jun), 1.13.8 (3 jul), 1.13.9 (17 jul), 1.13.10 (30 jul), 1.13.11 (14 ago) — **releases quincenales** | ídem |
| Licencia / dependencias | MIT / **ninguna** | ídem |
| Push al repo | 2026-06-18 | [api.github.com/repos/catamphetamine/libphonenumber-js](https://api.github.com/repos/catamphetamine/libphonenumber-js) |

Ojo: el repo **no publica GitHub Releases** desde 2016 (los últimos tags son 0.2.1 y 0.2.2 de diciembre 2016). Juzgar su salud por las releases de GitHub daría un falso negativo — la señal real está en npm, y ahí publica cada dos semanas. La documentación explica por qué: un script vigila `PhoneNumberMetadata.xml` de Google y dispara release automático al detectar cambios ([README](https://github.com/catamphetamine/libphonenumber-js#readme)).

**Tamaños de metadata** (del README oficial): `min` (default, `libphonenumber-js`) ~80 KB · `mobile` (`libphonenumber-js/mobile`) ~95 KB · `max` (`libphonenumber-js/max`) ~145 KB. El `unpackedSize` de npm es 10.2 MB porque el paquete trae las tres variantes más los `.d.ts` y ESM/CJS — lo que carga tu proceso es solo la variante importada.

Diferencia de API, del README: *"`.isPossible()` only checks the phone number length. Doesn't check the actual phone number digits"*, mientras `.isValid()` valida además los patrones de dígitos por país.

Recomendación para el servidor: `import { isValidPhoneNumber } from "libphonenumber-js/max"`. En el servidor no hay presupuesto de bytes que cuidar y la validación estricta detiene basura de bots que ya pasó Turnstile. Es una asimetría deliberada respecto al cliente (donde recomendé la validación por longitud): en el cliente el costo de un falso negativo es perder un lead; en el servidor solo marca el registro para revisión, no lo descarta.

### 2.7 Alternativas a `intl-tel-input`

**[NO VERIFICADO]** No encontré ninguna biblioteca vanilla-JS competidora con mantenimiento comparable en 2026. Las alternativas que aparecen en búsquedas son componentes atados a un framework (`react-phone-number-input`, del mismo autor de `libphonenumber-js`) o forks abandonados de `intl-tel-input` (`rjoo/`, `DimitarChristoff/`, `weilu/`, `Kanasimy/`, `Reusablecode/`). Esta es una afirmación **por ausencia de evidencia**, no una verificación exhaustiva del ecosistema: no existe una fuente primaria que enumere alternativas, así que lo constaté por búsqueda y no puedo garantizar que no exista algo relevante que no salió.

Lo que sí está verificado y basta para decidir: `intl-tel-input` tuvo una release **ayer**, tiene 1 issue abierto, cero dependencias, licencia MIT y una ruta documentada de uso sin bundler. No hay razón para buscar más.

---

## 3. Pregunta 2 — Resolución de código postal a ciudad/estado

### 3.1 El dato duro que cambia la decisión

Antes de comparar servicios: **descargué los datasets de GeoNames y los medí**. Los números están en el apéndice §7 con los comandos.

| País | Archivo GeoNames | Renglones | CPs distintos | Índice CP→[ciudad,estado] JSON | gzip |
|---|---|---|---|---|---|
| **MX** | `MX.zip` 2,012,242 B → `MX.txt` 12,083,028 B | 144,655 | **32,448** | 1,249 KB | **110 KB** |
| **US** | `US.zip` 634,334 B → `US.txt` 2,668,861 B | 41,490 | **41,488** | 1,076 KB | **263 KB** |
| **CA** | `CA.zip` 37,562 B → `CA.txt` 125,925 B | 1,657 | **1,653** (solo FSA) | 46 KB | **11 KB** |
| **Total** | — | 187,802 | 75,589 | **~2.3 MB** | **~384 KB** |

Los 144,655 renglones de MX con 32,448 CPs distintos corresponden a los asentamientos (colonias) por código postal: es el catálogo SEPOMEX completo, con la colonia en `place name`, el municipio en `admin name2` y el estado en `admin name1`.

**Un índice CP→ciudad+estado de los tres países ocupa ~2.3 MB en memoria.** El proceso Node de Render lo carga al arrancar sin notarlo. Esto es lo que vuelve irrelevante a todo el mercado de servicios de CP para este caso de uso.

### 3.2 Zippopotam.us — funciona, pero sirve datos congelados en 2019

Verifiqué la API en vivo y cubre los tres países:

```
GET https://api.zippopotam.us/mx/01000  -> 200, "San Angel", "Distrito Federal"
GET https://api.zippopotam.us/us/90210  -> 200, "Beverly Hills", "California"
GET https://api.zippopotam.us/ca/M5V    -> 200, "Downtown Toronto (...)", "Ontario"
```

Responde con `access-control-allow-origin: *` y `Cache-Control: max-age=14400`, o sea es usable directo desde el navegador.

La tabla de países de su portada ([zippopotam.us](https://zippopotam.us/)) declara para México: rango `01000 : 99998`, **75,203** registros. Para US: 43,624. Para CA: **1,621** (nótese: FSA, no código completo).

**El problema es la frescura.** Tres evidencias convergentes:

1. El repositorio de datos [github.com/zippopotamus/zippopotamus](https://api.github.com/repos/zippopotamus/zippopotamus) tiene `pushed_at: 2019-12-13`, 67 issues abiertos y **sin licencia declarada**.
2. Comparé el mismo CP contra el archivo de GeoNames de hoy: para `MX 56530` (Ixtapaluca, donde está la fábrica) zippopotam devuelve coordenadas `-99.7917` y `-99.3208`; el GeoNames actual devuelve `-98.8802`. Ixtapaluca está en `-98.88`. **Las coordenadas que sirve zippopotam están mal por ~40 km** y coinciden con un snapshot viejo, no con el dato vigente.
3. Su propia documentación reconoce que el dato no es suyo: *"All data in the Zippopotam.us API service is from GeoNames"* y remite las correcciones a GeoNames, no a ellos. También declara que el dato se entrega *"as-is without any guarantee on accuracy, coverage, etc."* Fuente: [docs.zippopotam.us](https://docs.zippopotam.us/docs/getting-started/).

**Conclusión: si el dato de zippopotam viene de GeoNames y está congelado en 2019, tomar el dataset de GeoNames directamente es estrictamente mejor** — más fresco, con licencia clara, sin dependencia de red y sin límite de uso. No hay ninguna razón para usar zippopotam.

No encontré límites de uso publicados. **[NO VERIFICADO]** — no existe una página de rate limits ni de términos más allá del "as-is".

### 3.3 GeoNames — la fuente recomendada

| Dato | Valor | Fuente |
|---|---|---|
| Licencia | **Creative Commons Attribution 4.0** | [readme.txt](https://download.geonames.org/export/zip/readme.txt) |
| Requisito de atribución | *"you can use the dump as long as you give credit to geonames (a link on your website to www.geonames.org is ok)"* | ídem |
| Cobertura | *"nearly 100 countries are currently supported. New countries are added when the national postal service starts publishing data under a compatible license."* | ídem |
| Fecha de los archivos MX/US/CA | **2026-08-15 04:24 UTC** (día de la consulta) | [download.geonames.org/export/zip/](https://download.geonames.org/export/zip/) |
| Formato | TSV UTF-8, 12 columnas | readme.txt |

Columnas relevantes: `country code`, `postal code`, `place name`, `admin name1` (estado), `admin code1`, `admin name2` (municipio/condado), `admin code2`, `admin name3`, `admin code3`, `latitude`, `longitude`, `accuracy`.

Todos los archivos comparten el timestamp `2026-08-15 04:24`, lo que indica una regeneración automática. Que sea **diaria** es una inferencia razonable a partir de una sola observación — **[NO VERIFICADO]** que la cadencia sea exactamente diaria; lo verificable es que los archivos estaban regenerados el mismo día de la consulta.

**Dos trampas concretas del dataset MX que hay que parchar:**

1. **`admin name1` dice `"Distrito Federal"`**, no `"Ciudad de México"`. Verificado: los 32 valores distintos de estado incluyen `Distrito Federal` y no incluyen `Ciudad de México`. El DF se renombró en enero de 2016; GeoNames no actualizó el nombre. Curiosamente, en esos mismos renglones `admin name3` **sí** dice `Ciudad de México`. Requiere una normalización de una línea. También conviene normalizar `Coahuila de Zaragoza`, `Michoacán de Ocampo` y `Veracruz de Ignacio de la Llave` a sus formas cortas si se quiere consistencia con Operam.
2. **La "ciudad" para MX debe salir de `admin name2` (municipio), no de `place name`** (que es la colonia). Ejemplo real: `MX 56530` tiene 9 renglones (`La Venta`, `Capilla III`, `Ixtapaluca Centro`, ...) todos con `admin name2 = Ixtapaluca`. Para un formulario de lead, "Ixtapaluca" es la respuesta correcta; la colonia no la pide nadie en una cotización de mayoreo.

**Canadá: el límite es legal, no técnico.** El readme lo dice: *"for CA, NL and UK only the first part of the codes. The full codes for CA are in the CA_full.csv.zip."* El `CA.zip` que verifiqué trae 1,653 FSA (los 3 primeros caracteres, ej. `M5V`) con ciudad y provincia — que es exactamente lo que un formulario de lead necesita. Existe `CA_full.csv.zip` (6.1 M) con los códigos completos, pero el readme solo declara restricción de copyright explícita para UK (Royal Mail), Chile, Irlanda y Malta, **no** para Canadá. **[NO VERIFICADO]** el estatus legal de `CA_full.csv.zip` frente a los derechos de Canada Post. Dado que Canada Post licencia comercialmente "Postal Code Address Data — Complete list of Canadian postal codes" ([license-data](https://www.canadapost-postescanada.ca/cpc/en/commercial/data-solutions/license-data.page)), **la recomendación prudente es usar solo `CA.zip` (FSA)** y no tocar `CA_full`.

### 3.4 Google Maps Platform — esquema vigente y por qué no aplica

El esquema de precios cambió el **1 de marzo de 2025**: se introdujeron los niveles Essentials / Pro / Enterprise, se eliminó el crédito mensual único de USD $200 y se sustituyó por una asignación gratuita **por SKU**. Fuente: [FAQ de cambios de precios](https://developers.google.com/maps/billing-and-pricing/faq).

Precios vigentes verificados en la [lista oficial de precios de Core Services](https://developers.google.com/maps/billing-and-pricing/pricing):

| SKU | Nivel | Gratis/mes | Precio en el tramo siguiente |
|---|---|---|---|
| **Geocoding API** | Essentials | **10,000 eventos** | $5.00 / 1,000 (10,001–100,000) |
| **Address Validation API** | **Pro** | **5,000 eventos** | $17.00 / 1,000 (5,001–100,000) |
| Places Autocomplete — per request | Essentials | 10,000 | $2.83 / 1,000 |
| Places Autocomplete — per session | Essentials | **ilimitado** | sin cargo |
| Places Details | Essentials | 10,000 | $5.00 / 1,000 |
| Places Details (IDs Only) | Essentials | ilimitado | sin cargo |

Confirmado también en la doc del producto: *"Essentials SKUs (except Map Tiles API SKUs) have 10,000 requests available at no cost per month"* ([Geocoding usage and billing](https://developers.google.com/maps/documentation/geocoding/usage-and-billing)), con límite de 3,000 QPM.

**Cuál aplicaría:** para CP→ciudad, la **Geocoding API** con `components=postal_code:56530|country:MX`. Address Validation es para validar una dirección completa, no para resolver un CP suelto, y está en Pro a $17/1,000 — el SKU equivocado y el más caro.

**Por qué no la recomiendo aun siendo gratis a este volumen.** A decenas de envíos al mes estaríamos ~3 órdenes de magnitud debajo de los 10,000 gratis, así que el costo monetario sería $0. Pero el costo real no es el dinero:

- Exige **cuenta de facturación activa con tarjeta**, aunque nunca se cobre. Es una obligación administrativa permanente por un campo de formulario.
- Exige **gestionar y restringir una API key**, que en un formulario público hay que proxiar por el servidor de todas formas para no exponerla.
- Introduce **latencia de red y un modo de falla** en el campo CP, que hay que cubrir con timeout, caché y fallback — todo trabajo que el dataset local vuelve innecesario.
- Google ya cambió el esquema una vez (marzo 2025, eliminando el crédito de $200). Puede volver a cambiarlo.

Contra un `Map` en memoria que resuelve en microsegundos y no puede fallar, no hay caso.

### 3.5 COPOMEX y opciones mexicanas

**COPOMEX** ([copomex.com](https://copomex.com/)) — API mexicana especializada en CP:

- **Free tier: 50 consultas**, una sola vez, para el primer proyecto de la cuenta. No es 50/mes: es 50 en total.
- Paquetes prepagados en MXN + 16% IVA: **1,000 consultas = $133.10**, 5,000 = $399.30, 50,000 = $1,331.00. Las consultas no expiran.
- Requiere registro y token de proyecto; se descuenta 1 crédito por petición ([documentación](https://api.copomex.com/documentacion/inicio)).
- Existe el token `pruebas` para probar sin registro, pero *"los datos devueltos son aleatorios"*.
- Declara usar *"la base de datos Oficial de los Códigos Postales de México"* con detección automática de cambios.

Evaluación honesta: **COPOMEX es la mejor opción externa para México** — devuelve colonias, municipio y estado con datos frescos, y a nuestro volumen (digamos 50 consultas/mes) $133 MXN alcanzarían para más de un año. No es caro. Pero sigue siendo una llave, una cuenta, un saldo que se agota en silencio, y una llamada de red — a cambio de un dato que ya tenemos en disco gratis y bajo licencia CC BY.

El free tier de 50 consultas totales lo descarta para producción sin pagar.

**Datasets de SEPOMEX en GitHub** (fechas de último push verificadas hoy):

| Repo | Último push | Licencia | Nota |
|---|---|---|---|
| [IcaliaLabs/sepomex](https://github.com/IcaliaLabs/sepomex) | **2026-08-10** | MIT | API REST sobre el catálogo, ~154k asentamientos en SQLite |
| [acrogenesis/API-Codigos-Postales](https://github.com/acrogenesis/API-Codigos-Postales) | 2026-03-23 | MIT | API JSON CP→colonia/municipio/estado |
| [open-mexico/mexico-geojson](https://github.com/open-mexico/mexico-geojson) | 2026-05-04 | MIT | GeoJSON de colonias, para mapas |
| [redrbrt/sepomex-zip-codes](https://github.com/redrbrt/sepomex-zip-codes) | 2022-03-11 | Unlicense | SQL/JSON/CSV/XML — desactualizado |
| [d3249/mexico_zipcodes](https://github.com/d3249/mexico_zipcodes) | 2019-03-12 | ninguna | abandonado |

**[NO VERIFICADO]** — que el repo tenga push reciente **no prueba que el dataset embebido esté fresco**; un commit de CI o README mueve `pushed_at` sin tocar los datos. No abrí los archivos de datos de cada repo para fechar el catálogo. Esta es exactamente la razón por la que prefiero GeoNames, donde el archivo mismo lleva timestamp verificable.

**Fuente oficial SEPOMEX.** El catálogo se descarga de [correosdemexico.gob.mx — Consulta CP / Exportar](https://www.correosdemexico.gob.mx/SSLServicios/ConsultaCP/CodigoPostal_Exportar.aspx), en EXCEL (una hoja por estado), TXT (delimitado por `|`) o XML, por estado o país completo. Fecha de última actualización declarada en la página al momento de la consulta: **2026-08-14**.

**Advertencia de licencia:** la página declara que el catálogo *"es elaborado por el Servicio Postal Mexicano y se proporciona en forma gratuita, no estando permitida su comercialización, total o parcial"*. Usarlo internamente para resolver el CP de un lead propio no es comercializar el catálogo; **revenderlo o exponerlo como servicio de datos sí lo sería**. Vale la pena tenerlo presente si algún día se considera abrir un endpoint público de CP. GeoNames, bajo CC BY 4.0, no tiene esa restricción — solo exige atribución.

### 3.6 Canada Post y los servicios de verificación de direcciones

**Canada Post AddressComplete** — precios verificados en [canadapost-postescanada.ca/ac/pricing](https://www.canadapost-postescanada.ca/ac/pricing/), en CAD:

| Consultas | Precio | Por consulta |
|---|---|---|
| 300 | $35 | 11.6¢ |
| 1,000 | $100 | 10.0¢ |
| 10,000 | $850 | 8.5¢ |

Los créditos vencen a los 12 meses. Direcciones internacionales cuestan 1¢ adicional por consulta. El plan mínimo son **$35 CAD por 300 consultas** — para el puñado de leads canadienses que este formulario verá al año, es absurdo.

Canada Post licencia el dato crudo por separado ("Postal Code Address Data", "Postal Code Latitude/Longitude Data") con entrega por FTP y actualizaciones mensuales, **sin precio publicado**: hay que hablar con un especialista ([license-data](https://www.canadapost-postescanada.ca/cpc/en/commercial/data-solutions/license-data.page)). **[NO VERIFICADO]** el precio y **[NO VERIFICADO]** una declaración explícita de propiedad intelectual — la página lista los productos y el proceso de licenciamiento pero no afirma en texto que el dato sea propietario. El hecho de que se licencie bajo contrato y que GeoNames publique solo el FSA lo implica fuertemente, pero es inferencia mía, no cita.

**Resto de los proveedores** (precios verificados en sus páginas oficiales):

- **Smarty International** ([smarty.com/pricing/international](https://www.smarty.com/pricing/international)): desde **$95 USD/mes** por 1,000 consultas. Prueba de 42 días con 100 consultas sin tarjeta. Cobertura de 240 países bajo una sola suscripción, precio global no por país. **[NO VERIFICADO]** que México esté explícitamente listado — la página dice "all countries and territories" y remite a una lista aparte que no abrí.
- **Loqate** ([loqate.com/en-us/pricing](https://www.loqate.com/en-us/pricing/)): pay-as-you-go, Address Capture internacional **9.4¢/consulta** en el paquete de $100, bajando a 5.8¢ en el de $1,000. Prueba de 45 días sin tarjeta. **[NO VERIFICADO]** cobertura específica de México; no aparece listado.
- **PostGrid** ([postgrid.com/address-verification-pricing](https://www.postgrid.com/address-verification-pricing/)): plan internacional Essential **$30 USD/mes por 500 consultas** + $0.03 por consulta extra. Incluye "245+ countries". 100–500 créditos gratis para pruebas.
- **Geoapify** ([geoapify.com/pricing](https://www.geoapify.com/pricing/)): **3,000 créditos/día gratis**, sin tarjeta, **uso comercial permitido** con atribución obligatoria (`Powered by Geoapify` con enlace). Planes de pago desde $59/mes por 10,000/día. **[NO VERIFICADO]** que su geocoding resuelva CP mexicanos con `type=postcode` — intenté probarlo y el endpoint exige llave (401), así que no pude confirmarlo.
- **HERE**: **[NO VERIFICADO]** — la página de precios ([here.com/get-started/pricing](https://www.here.com/get-started/pricing)) no expone los números sin registro y `developer.here.com/pricing` redirige. En resultados de búsqueda sobre páginas de here.com aparecen cifras de un plan Freemium de 250,000 transacciones/mes y un plan Limited de 1,000/día, con $1 por cada 1,000 adicionales, pero **no pude confirmarlo contra la página de precios**. No lo tomes como dato firme.

**Nota aparte — Nominatim (OpenStreetMap).** Lo probé y resuelve CP mexicanos bien: `postalcode=56530&country=MX` devuelve `"56530, Ixtapaluca, Estado de México, México"`. Pero su política de uso lo descarta explícitamente para este caso: máximo *"1 request per second"*, y sobre autocompletado dice literalmente que *"Auto-complete search"* **"is not yet supported by Nominatim and you must not implement such a service."* Además exige User-Agent identificable y atribución ODbL. Fuente: [operations.osmfoundation.org/policies/nominatim](https://operations.osmfoundation.org/policies/nominatim/). Un campo de CP que dispara al salir del foco está en zona gris respecto a esa prohibición; no vale la pena el riesgo.

### 3.7 Tabla comparativa de servicios de código postal

| Servicio | MX | US | CA | Precio verificado a bajo volumen | Free tier | ¿Llave? | Riesgo principal |
|---|:--:|:--:|:--:|---|---|:--:|---|
| **GeoNames self-host** ✅ | ✅ colonia+municipio+estado | ✅ | ⚠️ solo FSA | **$0** | n/a (descarga) | **no** | Requiere job de actualización; `Distrito Federal` sin normalizar |
| SEPOMEX oficial self-host | ✅ oficial | ❌ | ❌ | $0 | n/a | no | Descarga manual (ASP.NET); prohibida su comercialización |
| Zippopotam.us | ✅ | ✅ | ⚠️ FSA | $0 | ilimitado sin documentar | no | **Datos congelados en 2019**; sin SLA; sin licencia |
| Google Geocoding API | ✅ | ✅ | ✅ | $0 (10k gratis) | 10,000/mes | **sí** | Requiere facturación con tarjeta; esquema cambió en 2025 |
| Google Address Validation | ✅ | ✅ | ✅ | $0 (5k gratis) | 5,000/mes | **sí** | SKU Pro $17/1,000; producto equivocado para CP suelto |
| COPOMEX | ✅ mejor detalle MX | ❌ | ❌ | $133 MXN / 1,000 | **50 totales** | **sí** | Free tier inservible; saldo se agota en silencio |
| Geoapify | ⚠️ sin verificar | ✅ | ✅ | $0 hasta 3,000/día | 3,000/día | **sí** | Atribución visible obligatoria |
| Canada Post AddressComplete | +1¢ intl | +1¢ intl | ✅ nativo | **$35 CAD / 300** | prueba | **sí** | Carísimo; créditos vencen a 12 meses |
| Smarty International | ⚠️ | ✅ | ✅ | **$95 USD/mes** mínimo | 100 en 42 días | **sí** | Suscripción mínima desproporcionada |
| Loqate | ⚠️ | ✅ | ✅ | 9.4¢ USD/consulta | prueba 45 días | **sí** | Precio por consulta alto |
| PostGrid Internacional | ✅ (245+) | ✅ | ✅ | $30 USD/mes / 500 | 100–500 créditos | **sí** | Suscripción mensual fija |
| HERE | ⚠️ | ✅ | ✅ | **[NO VERIFICADO]** | **[NO VERIFICADO]** | **sí** | Precios no públicos sin registro |
| Nominatim (OSM) | ✅ | ✅ | ✅ | $0 | 1 req/s | no | **Prohíbe explícitamente autocompletado** |

### 3.8 Arquitectura recomendada del campo CP

```
                        NAVEGADOR (iframe, dominio propio)
  +-------------------------------------------------------------------+
  |  [ Pais v ]  [ Codigo postal ]  [ Ciudad ]  [ Estado ]             |
  |      MX           56530          Ixtapaluca   Mexico               |
  |                     |                ^           ^                 |
  |                     | blur / 5 digitos           |                 |
  |                     v                |           |                 |
  |            fetch /api/cp/mx/56530 ---+-----------+                 |
  |            (AbortController, timeout 1500 ms)                      |
  |                     |                                              |
  |            404 o timeout -> no pasa nada:                          |
  |            ciudad y estado quedan vacios y editables               |
  +-------------------------------------------------------------------+
                              |
                              v  (mismo origen, sin CORS)
  +-------------------------------------------------------------------+
  |            EXPRESS EN RENDER  --  UNA INSTANCIA                    |
  |                                                                    |
  |   GET /api/cp/:pais/:cp                                            |
  |     |                                                              |
  |     +--> lib/codigos-postales.js   (NUCLEO PURO, sin IO)           |
  |            |                                                       |
  |            +-- normalizarCp(pais, cp)                              |
  |            |     MX: 5 digitos, padStart con cero                  |
  |            |     US: 5 digitos, corta el +4                        |
  |            |     CA: mayusculas, sin espacios, toma los 3 primeros |
  |            |                                                       |
  |            +-- Map en memoria, cargado UNA VEZ al arranque         |
  |                  data/cp-mx.json  32,448 CPs   110 KB gz           |
  |                  data/cp-us.json  41,488 ZIPs  263 KB gz           |
  |                  data/cp-ca.json   1,653 FSAs   11 KB gz           |
  |                                                                    |
  |            -> { ciudad, estado } | null   (microsegundos)          |
  +-------------------------------------------------------------------+
                              ^
                              |  fuera de linea, mensual
  +-------------------------------------------------------------------+
  |   scripts/sync-codigos-postales.mjs                                |
  |     descarga MX.zip / US.zip / CA.zip de download.geonames.org     |
  |     -> normaliza -> escribe data/cp-*.json -> commit               |
  |     Normalizaciones MX: "Distrito Federal" -> "Ciudad de Mexico",  |
  |     ciudad = admin name2 (municipio), no place name (colonia)      |
  +-------------------------------------------------------------------+
```

**Fuente por país:**

| País | Fuente | Granularidad de respuesta | Justificación |
|---|---|---|---|
| **MX** | GeoNames `MX.zip` | municipio + estado | 32,448 CPs, actualizado el día de la consulta, CC BY 4.0. Cubre el 100% del público objetivo sin llave ni red. |
| **US** | GeoNames `US.zip` | ciudad + abreviatura de estado | 41,488 ZIPs. Alternativa libre equivalente: [US Census ZCTA Gazetteer](https://www2.census.gov/geo/docs/maps-data/data/gazetteer/) (verifiqué que existe hasta `2025_Gazetteer`), pero GeoNames ya da ciudad+estado listos. |
| **CA** | GeoNames `CA.zip` | ciudad + provincia, **desde el FSA** | El código completo canadiense es producto licenciado de Canada Post. El FSA da ciudad y provincia correctas, que es todo lo que un lead necesita. |

**Decisiones de diseño y su porqué:**

1. **Sin proxy a terceros, sin caché, sin timeout hacia afuera.** El enunciado del encargo pedía "proxy server-side con caché en memoria y timeout corto" — esa arquitectura es la correcta *si dependes de un servicio externo*. La medición muestra que no hace falta depender de uno. El "caché en memoria" se vuelve el dataset entero, y el "timeout corto" desaparece porque no hay red. Menos piezas, menos modos de falla. El timeout de 1,500 ms del diagrama es del navegador hacia nuestro propio Express, no hacia un tercero.
2. **Ciudad y estado siempre visibles y editables.** El CP prellena, no dicta. Casos reales donde el prellenado será incorrecto o ausente: CPs nuevos posteriores al último sync, CPs de zonas de reparto especiales, y todo Canadá donde el FSA de una ciudad grande cubre varios barrios. Un formulario que bloquea el envío porque su tabla no conoce un CP pierde un lead por un problema que es nuestro, no del cliente.
3. **El núcleo va en `lib/codigos-postales.js` sin IO**, siguiendo el patrón de la casa (`alta-logica.js`, `calcas-logica.js`, `cruce-identidad.js`): la normalización del CP por país es lógica pura, testeable y compartible por cross-import entre `server.js` y `public/js`. La carga del `Map` desde disco vive fuera, en el consumidor.
4. **Actualización mensual por script versionado, no en runtime.** `scripts/sync-codigos-postales.mjs` en la línea de `sync-catalogo.mjs`. Los `data/cp-*.json` se commitean: el disco de Render es efímero y el arranque no debe depender de que geonames.org esté arriba.
5. **La atribución de GeoNames es obligatoria** (CC BY 4.0). Basta un enlace a `www.geonames.org` en el pie del formulario o en la página de créditos.

**Trade-off self-host vs servicio externo, por país:**

- **MX — self-host gana con claridad.** Es el país que importa, el dataset es el más completo de los tres (colonia, municipio, estado), la licencia es limpia y el volumen es tan bajo que cualquier servicio externo sería infraestructura ociosa. El único costo es normalizar "Distrito Federal" y correr un script al mes.
- **US — self-host gana por inercia.** Ya montaste el mecanismo para MX; agregar 263 KB gzip y el archivo `US.zip` es trabajo cero. Un servicio externo solo para US no se justifica.
- **CA — self-host gana, pero es el caso más débil.** Solo tienes FSA. Si algún día el negocio canadiense creciera al punto de necesitar validación de dirección completa (para etiquetas de envío, por ejemplo), ahí sí hay que pagar Canada Post AddressComplete o PostGrid. Para captura de leads, el FSA basta y el gasto no tiene sentido.

---

## 4. Pregunta 3 — Validación de correo en 2026

### 4.1 La base: `type="email"` y nada más agresivo

El navegador valida `<input type="email">` con un algoritmo equivalente a este regex, documentado por MDN:

```
/^[\w.!#$%&'*+/=?^`{|}~-]+@[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?(?:\.[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?)*$/i
```

Fuente: [MDN — input type=email](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/email).

Dos consecuencias prácticas de leer ese regex con cuidado:

- **Acepta `usuario@dominio` sin punto.** El grupo de subdominios es `*` (cero o más). Para un formulario B2B donde el correo debe ser real, exigir al menos un punto en el dominio es una restricción defendible y de bajísimo riesgo (los dominios sin punto solo existen en redes internas).
- **Rechaza cosas técnicamente válidas por RFC 5322** (local-parts entre comillas, dominios en literal IP). MDN advierte de *"known specification issues related to international domain names and the validation of email addresses in HTML"*. En la práctica esos casos no llegan a un formulario de mayoreo, así que no hay que compensarlos.

MDN es tajante sobre lo demás: *"a user can tinker with your HTML behind the scenes, so your site **must not** use this validation for any security purposes. You **must** verify the email address on the server side."*

### 4.2 ¿Vale la pena verificar el registro MX en DNS? Sí, como señal — nunca como bloqueo

**No hace falta biblioteca.** Node trae `dns.promises.resolveMx()` nativo: firma `dnsPromises.resolveMx(hostname)`, devuelve un array de `{ priority, exchange }`. Estado **Stable**, disponible desde v10.6.0, fuera de experimental desde v11.14.0/v10.17.0, sin avisos de deprecación. Fuente: [nodejs.org/api/dns.html](https://nodejs.org/api/dns.html).

**Pero la ausencia de MX no significa que el correo no exista.** RFC 5321 §5.1 define la regla de MX implícito:

> *"If an empty list of MXs is returned, the address is treated as if it was associated with an implicit MX RR, with a preference of 0, pointing to that host."*

Fuente: [RFC 5321 §5.1](https://www.rfc-editor.org/rfc/rfc5321.txt).

Un dominio con solo registro A y un servidor SMTP escuchando ahí **recibe correo perfectamente**. Es una configuración vieja pero existente, y no es raro en PyMEs mexicanas con hosting compartido antiguo — justo el perfil de cliente de mayoreo.

**Implementación recomendada:**

```
1. resolveMx(dominio)            -> si devuelve >=1 registro: OK
2. si ENOTFOUND/ENODATA: resolveA(dominio) -> si responde: OK (MX implicito)
3. si el dominio entero no resuelve: marcar el lead con una bandera de revision
4. timeout global de 2 s; si expira, tratar como OK
5. NUNCA rechazar el envio del formulario por esto
```

El razonamiento del punto 5: el DNS saliente desde Render puede ser lento o fallar, y el costo de perder un lead real de mayoreo supera con mucho el de guardar un correo con typo. La verificación MX sirve para **priorizar la bandeja del vendedor**, no para portear la puerta.

### 4.3 Detección de typos de dominio: `mailcheck` está muerto

Verificado el 2026-08-15:

| Dato | Valor | Fuente |
|---|---|---|
| Último commit de `mailcheck/mailcheck` | **2022-05-06** | [api.github.com/repos/mailcheck/mailcheck](https://api.github.com/repos/mailcheck/mailcheck) |
| Última publicación en npm | **v1.1.1, 2015-07-05** | [registry.npmjs.org/mailcheck](https://registry.npmjs.org/mailcheck) |
| Estrellas / issues abiertos | 7,938 / 44 | ídem |

Once años sin publicar en npm. Para una biblioteca cuyo valor **es** una lista de dominios y TLDs vigentes, eso no es "estable", es abandonado: no conoce `outlook.com` moderno ni los TLDs posteriores a 2015.

**El sucesor tiene un asterisco importante.** `@zootools/email-spell-checker` (repo [smashsend/email-spell-checker](https://github.com/smashsend/email-spell-checker), MIT, reescritura en TypeScript de mailcheck, ~1.9 KB):

- El **repo está vivo**: último push 2026-08-11, con commits de mantenimiento real de datos en marzo de 2026 (`chore: Add mac.com and .tv`, `fix(TLDs): add 'website' TLD`, `fix: change proton short domain to .me`).
- Pero **npm está congelado**: `dist-tags.latest` = **1.12.0, publicada 2023-01-18**, y el `package.json` del repo sigue marcando `"version": "1.12.0"`. Fuentes: [registry.npmjs.org](https://registry.npmjs.org/@zootools/email-spell-checker) y [package.json del repo](https://github.com/smashsend/email-spell-checker/blob/main/package.json).

Es decir: **las correcciones de dominios y TLDs de 2026 no están publicadas en npm.** Instalar el paquete te da la versión de 2023.

**Recomendación: implementarlo a mano.** Para este proyecto es la opción correcta, no un atajo:

- El stack es vanilla JS vendoreado; meter un paquete TypeScript con `dist/` de 36 archivos por 1.9 KB de lógica es desproporcionado.
- La lógica completa son ~40 líneas: distancia de edición (Levenshtein o Sift3) contra una lista de dominios, con umbral.
- **La lista es lo que importa, y la nuestra debe ser mexicana**, no la genérica: `gmail.com`, `hotmail.com`, `outlook.com`, `yahoo.com`, `yahoo.com.mx`, `live.com.mx`, `hotmail.com.mx`, `prodigy.net.mx`, `icloud.com`, `me.com`. Ninguna lista genérica en inglés incluye `prodigy.net.mx` ni `yahoo.com.mx`, que sí aparecen en clientes mexicanos.
- Sugerir, **nunca autocorregir**: "¿Quisiste decir juan@gmail.com?" con un botón para aceptarlo. Autocorregir un correo correcto que se parece a uno común es peor que no hacer nada.

Si de todos modos se prefiere la biblioteca, **vendorear desde el repo** (rama `main`), no desde npm.

### 4.4 Qué NO hacer

| Antipatrón | Por qué está mal |
|---|---|
| **Bloquear o quitar el `+` (subaddressing)** | RFC 5233 lo define formalmente: el `+` separa el `user` del `detail` en el local-part, ej. `ken+sieve@example.org`. Es una dirección válida y entregable. Quien escribe `ventas+peltre@empresa.com` está organizando su bandeja, no evadiendo nada. Fuente: [RFC 5233](https://datatracker.ietf.org/doc/html/rfc5233). |
| **Lista negra de TLDs "raros"** | La lista de IANA tenía **1,438 TLDs** el 2026-08-15 (versión 2026081500) y cambia. Cualquier lista blanca hecha a mano rechazará dominios legítimos. Fuente: [data.iana.org/TLD/tlds-alpha-by-domain.txt](https://data.iana.org/TLD/tlds-alpha-by-domain.txt). |
| **Regex "estricto" propio** | Toda variante casera de un regex RFC 5322 rechaza correos válidos. MDN documenta el regex del estándar; usar ese o ninguno. |
| **Bloquear cuentas de rol (`ventas@`, `compras@`, `info@`)** | En B2B mexicano esas **son** las direcciones de los compradores. Bloquearlas es rechazar al cliente objetivo. |
| **Sondeo SMTP (`VRFY` / `RCPT TO` sin enviar)** | Poco fiable (catch-all y greylisting dan falsos positivos y negativos) y arriesga que la IP saliente de Render entre en listas negras. |
| **Bloquear el envío por MX faltante** | Ver §4.2: RFC 5321 §5.1 permite entrega sin MX vía registro A. |
| **`placeholder` como etiqueta** | MDN: *"Avoid using the `placeholder` attribute if you can. It is not as semantically useful as other ways to explain your form, and can cause unexpected technical issues with your content."* Ver también §5.2. |
| **Autocapitalización en el campo de correo** | Baymard recomienda desactivarla en móvil: los usuarios esperan minúsculas. Usar `autocapitalize="off"` + `spellcheck="false"`. Fuente: [baymard.com/learn/input-fields](https://baymard.com/learn/input-fields). |

Sobre bibliotecas de validación en servidor: `validator.js` está sano (v13.15.35 publicada 2026-04-02, push al repo 2026-08-15, 23.7k estrellas, MIT), pero su `isEmail()` no aporta gran cosa sobre el regex del estándar más la comprobación de DNS. No es necesario añadir la dependencia. Fuentes: [npm](https://registry.npmjs.org/validator), [GitHub](https://api.github.com/repos/validatorjs/validator.js).

---

## 5. Pregunta 4 — UX del formulario de lead B2B

### 5.1 Orden de campos y agrupación

No hay una fuente primaria que dicte un orden canónico para leads B2B; lo que sigue combina hallazgos verificados con criterio de diseño, y lo señalo como tal.

Lo **verificado** de Baymard ([baymard.com/learn/input-fields](https://baymard.com/learn/input-fields)):

- *"Users become intimidated by 10-15+ fields on a single page"*; la recomendación es reducir campos combinando entradas, ocultando los opcionales y quitando los irrelevantes al contexto.
- Prellenar campos relacionados cuando se pueda anticipar el valor (correo, componentes de dirección, CP), *"to reduce tedium and checkout friction"*.
- Mostrar valores prellenados como **campos de texto editables**, no como texto estático: los usuarios pasan por alto el contenido no interactivo. Esto refuerza directamente la decisión de §3.8 de dejar ciudad y estado editables.
- Evitar límites de caracteres restrictivos: *"89% of users entered numerical inputs in several different ways, even when formatting examples showed the required input format."*

**Orden propuesto** (criterio propio, apoyado en lo anterior):

```
1. Nombre                    given-name      *
2. Apellido                  family-name     *
3. Empresa                   organization    *   <- es un formulario B2B: va arriba
4. Correo                    email           *
5. Telefono (intl-tel-input) tel             *
6. Pais                      country         *   <- gobierna el formato del CP
7. Codigo postal             postal-code     *
8. Ciudad                    address-level2      <- prellenado desde el CP, editable
9. Estado                    address-level1      <- prellenado desde el CP, editable
---- Opcionales, agrupados al final ----
10. Cargo                    organization-title  (opcional)
11. Sitio web                url                 (opcional)
12. Comentario / que busca   (textarea)          (opcional)
```

**Agrupar opcionales al final, visibles, en vez de progressive disclosure.** Con solo tres campos opcionales, esconderlos tras un "Mostrar más" añade una interacción para ahorrar tres renglones — mal negocio. Baymard sí documenta que colapsar tras un enlace *"serves as an effective indicator of optionality"*, así que la técnica es válida; simplemente no se gana nada a esta escala. El país va **antes** del CP porque determina la normalización y el largo esperado del código.

### 5.2 Etiquetas: fijas arriba, sin excepción

Baymard estudió 18 sitios móviles con más de 1,000 llenados de campo. Conclusión: **etiquetas arriba del campo** en móvil vertical. Las etiquetas a la izquierda dejan el campo tan angosto que el usuario no ve lo que escribió completo, no detecta sus errores antes de enviar, y al ser rechazado no puede identificar qué está mal. Fuente: [baymard.com/blog/mobile-form-usability-label-position](https://baymard.com/blog/mobile-form-usability-label-position).

Ventaja secundaria que la propia investigación señala: con la etiqueta arriba hay espacio para texto de etiqueta claro (no limitado a 1–2 palabras), para marcar requerido/opcional, y para una descripción de ayuda.

Sobre **etiquetas dentro del campo (inline / placeholder-como-etiqueta)**, Baymard es directo: cuando la etiqueta desaparece al empezar a escribir, corregir errores se vuelve difícil y los usuarios *"ended up deleting the entire input just to be able to read the label once again."* Fuente: [baymard.com/blog/mobile-forms-avoid-inline-labels](https://baymard.com/blog/mobile-forms-avoid-inline-labels).

Sobre **floating labels**, la respuesta honesta es que **no hay evidencia**: Baymard dice que prometen el look limpio del inline sin perder contexto, pero *"there's currently no in-depth usability testing available on the performance or potential side effects."* Su recomendación explícita es *"be cautious when implementing floating labels"*. Fuente: ídem.

**Veredicto: etiqueta fija arriba.** Es lo único con evidencia a favor. El `placeholder` se reserva para ejemplos de formato ("56530", "ventas@empresa.com"), nunca para el nombre del campo.

**Marcar requeridos Y opcionales.** Baymard: solo **14%** de los sitios marca ambos (6% en móvil), pese a que 98% tiene al menos un campo opcional. Cuando solo se marcan los opcionales, **32%** de los usuarios chocó con errores de validación por no llenar requeridos; cuando solo se marcan los requeridos, el usuario no sabe si los demás son opcionales de verdad. Recomendación: asterisco en requeridos + "(opcional)" en el resto. Fuente: [baymard.com/blog/required-optional-form-fields](https://baymard.com/blog/required-optional-form-fields).

### 5.3 Cuándo validar y cómo mostrar el error

**En `blur`, no en cada tecla.** Baymard documenta que la validación prematura interrumpe el tecleo y hace que el usuario dude de entradas correctas; cita a un participante frustrado porque el sitio *"is like kind of yelling at me before… I didn't try to submit anything"* al validar un campo vacío recién enfocado. Datos: 31% de los sitios no tiene validación inline y 4% la implementa mal. Fuente: [baymard.com/blog/inline-form-validation](https://baymard.com/blog/inline-form-validation).

**La excepción documentada aplica justo a nuestros campos:** para entradas de longitud predecible — *"ZIP codes, phone numbers, credit card numbers"* — la validación puede dispararse al alcanzar el número correcto de caracteres. Eso justifica que el lookup de CP se dispare al quinto dígito en MX, sin esperar al blur.

`web.dev` coincide en el mecanismo: *"You can add real-time validation in JavaScript by listening to the `onblur` event of a form control"*. Fuente: [web.dev/learn/forms/validation](https://web.dev/learn/forms/validation).

**Cómo mostrar el error:**

- Mensaje **inline, junto al campo**, no en un resumen arriba. Y nunca solo por color: web.dev advierte que *"to communicate error or success you should never rely only on color"* por daltonismo — el color va acompañado de texto o icono.
- Vincular el mensaje al input con **`aria-describedby`**; web.dev lo recomienda tanto para las reglas de formato como para el mensaje de error.
- **`aria-live="assertive"`** en el contenedor del error, con la limitación que la propia guía señala: en formularios de varios campos solo anuncia el primer error, así que conviene concatenar o anunciar al enfocar cada campo. Fuente: [web.dev/learn/forms/accessibility](https://web.dev/learn/forms/accessibility).
- Usar la **Constraint Validation API** con `setCustomValidity()` para que el mensaje sea idéntico en todos los navegadores (los mensajes nativos varían y están en el idioma del navegador, no del sitio).

**Criterios WCAG que esto satisface:**

| SC | Nivel | Requisito |
|---|---|---|
| [3.3.1 Error Identification](https://www.w3.org/WAI/WCAG22/Understanding/error-suggestion.html) | A | El error se identifica y se describe en texto |
| [3.3.2 Labels or Instructions](https://www.w3.org/WAI/WCAG22/Understanding/error-suggestion.html) | A | Etiquetas e instrucciones presentes |
| [3.3.3 Error Suggestion](https://www.w3.org/WAI/WCAG22/Understanding/error-suggestion.html) | AA | *"If an input error is automatically detected and suggestions for correction are known, then the suggestions are provided to the user."* — esto es exactamente la sugerencia de typo de dominio de §4.3 |
| [1.3.5 Identify Input Purpose](https://www.w3.org/WAI/WCAG22/Understanding/identify-input-purpose.html) | AA | El propósito de cada campo debe ser determinable programáticamente → **el atributo `autocomplete` es la técnica** |
| [3.3.7 Redundant Entry](https://www.w3.org/WAI/WCAG22/Understanding/redundant-entry.html) | **A** (WCAG 2.2) | No pedir dos veces lo ya capturado en el mismo proceso: debe autopoblarse o poder seleccionarse |

Nota de peso: **1.3.5 convierte a `autocomplete` en un requisito de accesibilidad nivel AA**, no en una comodidad opcional.

### 5.4 Atributos `autocomplete` correctos

Valores tomados del estándar WHATWG, con la descripción normativa de cada uno ([html.spec.whatwg.org — autofill](https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#autofill)):

| Campo | `autocomplete` | Definición del estándar |
|---|---|---|
| Nombre | `given-name` | *"Given name (in some Western cultures, also known as the first name)"* |
| Apellido | `family-name` | *"Family name (in some Western cultures, also known as the last name or surname)"* |
| Nombre completo (si se unifica) | `name` | *"Full name"* |
| Correo | `email` | *"Email address"* |
| **Teléfono (campo único, E.164)** | **`tel`** | *"Full telephone number, **including country code**"* |
| Lada de país (si se separa) | `tel-country-code` | *"Country code component of the telephone number"* |
| Número nacional (si se separa) | `tel-national` | *"Telephone number without the country code component"* |
| Código postal | `postal-code` | *"Postal code, post code, ZIP code, CEDEX code"* |
| **Estado** | **`address-level1`** | *"The broadest administrative level in the address, i.e. the province within which the locality is found"* |
| **Ciudad / municipio** | **`address-level2`** | *"The second administrative level, in addresses with two or more administrative levels"* |
| País (select) | `country` | *"Country code"* |
| País (nombre visible) | `country-name` | *"Country name"* |
| Empresa | `organization` | *"Company name corresponding to the person, address, or contact information in the other fields"* |
| Cargo | `organization-title` | *"Job title (e.g. 'Software Engineer', 'Senior Vice President', 'Deputy Managing Director')"* |
| Sitio web | `url` | *"Home page or other web page corresponding to the company, person, address, or contact information"* |

**Punto crítico con `intl-tel-input`:** `tel` significa el número **con** código de país. Como el plan es guardar E.164 vía `getNumber()`, el `autocomplete="tel"` va en el input visible y el valor E.164 viaja en el `hiddenInput` — coherente con la semántica del estándar. Si en cambio se partiera en dos campos, hay que usar `tel-country-code` + `tel-national`, no `tel` en ambos.

**Ojo con el mapeo MX de `address-level1/2`:** el estándar define `address-level1` como el nivel administrativo más amplio. En México eso es el **estado**, y `address-level2` el **municipio/alcaldía**. Es consistente con el mapeo de GeoNames de §3.3 (`admin name1` = estado, `admin name2` = municipio). En US: `address-level1` = estado (CA), `address-level2` = ciudad.

`web.dev` añade un detalle de implementación: los navegadores guardan el valor asociado al atributo `name`, *"Some browsers also look at the `id` attribute when storing and filling in data"* — así que conviene que `name` e `id` sean descriptivos y estándar (`email`, `postal-code`), no `campo7`. Fuente: [web.dev/learn/forms/autofill](https://web.dev/learn/forms/autofill).

### 5.5 Consideraciones específicas del iframe

Este es el punto con más riesgo real y menos documentación firme.

**El formulario estará en un iframe cross-origin.** Se sirve desde nuestro dominio y se embebe en una página de Shopify (`*.myshopify.com` o el dominio de la tienda). Son orígenes distintos, con todo lo que eso implica.

**Autofill en iframes cross-origin — verificación parcial.** Chrome documenta que la política del mismo origen es la línea base para autocompletado entre marcos, y que *"does not provide sufficient granularity for the browser to differentiate between trusted and untrusted frames for autofill"*. Introdujo la permission policy **`shared-autofill`**, que el padre activa así:

```html
<iframe src="https://formulario.peltrenacional.mx/mayoreo" allow="shared-autofill"></iframe>
```

Fuente: [developer.chrome.com/blog/shared-autofill](https://developer.chrome.com/blog/shared-autofill).

**[PARCIALMENTE VERIFICADO — leer con cuidado]:** ese artículo trata específicamente de **campos de pago sensibles** (números de tarjeta repartidos entre el comercio y el PSP), y se describe a sí mismo como *"an initial proposal"* que estuvo detrás de un flag desde Chrome 93. **No pude confirmar en fuente primaria cuál es el comportamiento exacto, hoy y por navegador, del autofill de datos de contacto y dirección (nombre, correo, teléfono, CP) dentro de un iframe cross-origin.** Es plausible que funcione sin restricción por no ser datos de pago, pero no lo verifiqué.

Recomendación práctica, dada esa incertidumbre:

1. Poner `allow="shared-autofill"` en el `<iframe>` del tema de Shopify. Es gratis y no rompe nada si resulta innecesario.
2. **Probar el autofill a mano** en Chrome, Safari y Firefox con perfiles que tengan datos guardados, antes de dar el formulario por terminado. Esto no es opcional: es exactamente la clase de bug que ningún test detecta y que solo aparece ejecutando en navegador.
3. Poner igualmente los `autocomplete` correctos: aunque el autofill del navegador estuviera limitado, **1.3.5 los exige** para tecnologías de asistencia, que no dependen de esa política.

**Altura del iframe: `postMessage` + `ResizeObserver`.** No hay redimensionado automático cross-origin; el hijo debe informar su altura al padre. MDN es explícito sobre la seguridad:

> *"Always provide a specific `targetOrigin`, not `*`, if you know where the other window's document should be located. Failing to provide a specific target could disclose data to a malicious site."*

y del lado receptor:

> *"Any window (including, for example, `http://evil.example.com`) can send a message to any other window within the iframe hierarchy. Having verified identity, however, you still should always verify the syntax of the received message."*

Fuente: [MDN — Window.postMessage](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage).

Patrón concreto:

```
HIJO (formulario, nuestro dominio):
  new ResizeObserver(function () {
    parent.postMessage(
      { tipo: "altura", px: document.documentElement.scrollHeight },
      "https://tienda.peltrenacional.mx"        // origen EXACTO, nunca "*"
    );
  }).observe(document.body);

PADRE (tema de Shopify):
  window.addEventListener("message", function (e) {
    if (e.origin !== "https://formulario.peltrenacional.mx") return;  // verificar SIEMPRE
    if (!e.data || e.data.tipo !== "altura") return;                  // verificar sintaxis
    var px = Number(e.data.px);
    if (!(px > 0 && px < 5000)) return;                               // acotar
    iframe.style.height = px + "px";
  });
```

**Viewport:** el iframe hereda el ancho que le da el padre. Con etiquetas arriba (§5.2) el formulario funciona a cualquier ancho sin media queries, que es una razón práctica adicional para esa decisión.

**Turnstile es la excepción al "sin CDN de terceros".** La documentación de Cloudflare lo prohíbe explícitamente:

> *"The `api.js` file must be fetched from the exact URL shown above. Proxying or caching this file will cause Turnstile to fail when future updates are released."*

Fuente: [developers.cloudflare.com/turnstile/get-started/client-side-rendering](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/). El script debe cargarse de `https://challenges.cloudflare.com/turnstile/v0/api.js`. Es la única dependencia de tercero en runtime y no hay forma de evitarla; conviene documentarlo para que no se intente "arreglar" después. **[NO VERIFICADO]**: si el hostname que valida el sitekey es el del iframe o el de la página contenedora — esa página de la doc no lo cubre y hay que confirmarlo en la configuración del sitekey (lo lógico es que sea el del iframe, que es quien ejecuta el widget, pero no lo verifiqué).

---

## 6. Lo que NO se pudo verificar en fuente primaria

Recopilado para que nadie lo tome como hecho:

| Tema | Estado |
|---|---|
| Alternativas a `intl-tel-input` en 2026 | Afirmación por ausencia de evidencia. No hay fuente que enumere el ecosistema; lo constaté por búsqueda. |
| Cadencia exacta de actualización de GeoNames | Los archivos estaban regenerados el día de la consulta (2026-08-15 04:24 UTC). Que sea *diaria* es inferencia de una sola observación. |
| Estatus legal de `CA_full.csv.zip` de GeoNames | El readme no declara restricción para CA (solo para GB/CL/IE/MT), pero Canada Post licencia comercialmente el dato completo. Recomendé no usarlo por prudencia. |
| Declaración explícita de propiedad de los códigos postales por Canada Post | La página de licenciamiento lista productos y proceso, pero no afirma en texto que el dato sea propietario. Es inferencia. |
| Cobertura explícita de México en Smarty y Loqate | Ambas dicen "internacional / 240+ países" sin listar México en la página consultada. |
| Precios y free tier de HERE | La página de precios no expone números sin registro; `developer.here.com/pricing` redirige. Las cifras que circulan (250,000/mes freemium, 1,000/día limited, $1/1,000) **no** las pude confirmar. |
| Que Geoapify resuelva CP mexicanos con `type=postcode` | El endpoint exige llave (devolvió 401). No probado. |
| Frescura del dato dentro de los repos SEPOMEX de GitHub | `pushed_at` reciente no prueba dataset fresco. No abrí los archivos de datos de cada repo. |
| Autofill de datos de contacto/dirección en iframes cross-origin, por navegador, hoy | La doc de Chrome que encontré trata de campos de **pago**. Requiere prueba manual en navegador. |
| Si el sitekey de Turnstile valida el hostname del iframe o el de la página contenedora | No cubierto en la página de client-side rendering consultada. |
| Límites de uso publicados de zippopotam.us | No existe página de rate limits ni términos más allá del "as-is". |

---

## 7. Apéndice — mediciones propias reproducibles

Todo lo de esta sección lo ejecuté el 2026-08-15; los comandos permiten reproducirlo.

**Descarga y conteo de los datasets:**

```bash
curl -o MX.zip https://download.geonames.org/export/zip/MX.zip   # 2,012,242 B
curl -o US.zip https://download.geonames.org/export/zip/US.zip   #   634,334 B
curl -o CA.zip https://download.geonames.org/export/zip/CA.zip   #    37,562 B
unzip -o MX.zip -d MX && unzip -o US.zip -d US && unzip -o CA.zip -d CA

wc -l MX/MX.txt US/US.txt CA/CA.txt
#  144655 MX/MX.txt   |  41490 US/US.txt   |   1657 CA/CA.txt

for f in MX/MX.txt US/US.txt CA/CA.txt; do cut -f2 $f | sort -u | wc -l; done
#   32448 (MX)        |  41488 (US)        |   1653 (CA, solo FSA)
```

**Muestras que sustentan las trampas documentadas en §3.3:**

```
$ awk -F'\t' '$2=="01000"' MX/MX.txt
MX  01000  San Angel  Distrito Federal  09  Alvaro Obregon  010  Ciudad de Mexico  01  19.3587  -99.2033  4
      ^CP  ^colonia   ^estado (OBSOLETO)     ^municipio          ^admin3

$ awk -F'\t' '$2=="56530"' MX/MX.txt | wc -l
9                                    # nueve colonias en un solo CP
$ awk -F'\t' '$2=="56530"' MX/MX.txt | head -1
MX  56530  La Venta  Mexico  15  Ixtapaluca  039  Ixtapaluca  18  19.3063  -98.8802  4

$ awk -F'\t' '$2=="90210"' US/US.txt
US  90210  Beverly Hills  California  CA  Los Angeles  037  ...

$ awk -F'\t' '$2=="M5V"' CA/CA.txt
CA  M5V  Downtown Toronto (CN Tower / King and Spadina / ...)  Ontario  ON  Toronto  ...
```

**Prueba de que zippopotam sirve datos viejos** (§3.2):

```
$ curl -s https://api.zippopotam.us/mx/56530 | grep -o '"longitude": "[^"]*"' | head -2
"longitude": "-99.7917"      <- zippopotam
"longitude": "-99.3208"

$ awk -F'\t' '$2=="56530"' MX/MX.txt | head -1 | cut -f11
-98.8802                     <- GeoNames vigente. Ixtapaluca esta en -98.88
```

**Tamaño del índice derivado CP→[ciudad, estado]** (script Python en el apéndice del scratchpad; usa `admin name2` como ciudad para MX y CA, `place name` para US):

```
MX: 32448 CPs  | JSON 1249 KB | gzip 110 KB
US: 41488 CPs  | JSON 1076 KB | gzip 263 KB
CA:  1653 CPs  | JSON   46 KB | gzip  11 KB
                 -------------  ----------
                 TOTAL ~2.3 MB   ~384 KB
```

**Verificación en vivo de endpoints de geolocalización por IP** (§2.5), desde una IP residencial mexicana:

```
$ curl -s https://ipapi.co/json/
{"error": true, "reason": "RateLimited", ...}          <- el que sugiere la doc oficial

$ curl -s https://api.country.is/
{"ip":"2806:2a0:...","country":"MX"}                   <- OK

$ curl -s "https://ipwho.is/?fields=ip,country_code,success"
{"success": true, "country_code": "MX"}                 <- OK

$ curl -s https://www.cloudflare.com/cdn-cgi/trace | grep loc=
loc=MX                                                  <- OK pero sin contrato publico
```

**Cabeceras CORS** (`-H "Origin: https://example.com"`):

```
api.country.is        -> 200, Access-Control-Allow-Origin: *
ipwho.is              -> Access-Control-Allow-Origin: *
api.zippopotam.us     -> 200, access-control-allow-origin: *, Cache-Control: max-age=14400
cloudflare /cdn-cgi/trace -> 200, Access-Control-Allow-Origin: *  (GET; con HEAD da 404)
```

**Lista de TLDs de IANA** (§4.4):

```
$ curl -s https://data.iana.org/TLD/tlds-alpha-by-domain.txt | head -1
# Version 2026081500, Last Updated Sat Aug 15 07:07:01 2026 UTC
$ curl -s https://data.iana.org/TLD/tlds-alpha-by-domain.txt | tail -n +2 | wc -l
1438
```

---

## 8. Índice de fuentes

**Teléfono**
- https://github.com/jackocnr/intl-tel-input · https://api.github.com/repos/jackocnr/intl-tel-input · https://api.github.com/repos/jackocnr/intl-tel-input/releases
- https://github.com/jackocnr/intl-tel-input/blob/master/site/src/docs/markdown/vanilla_javascript.md
- https://github.com/jackocnr/intl-tel-input/blob/master/site/src/docs/markdown/utils.md
- https://github.com/jackocnr/intl-tel-input/blob/master/site/src/docs/markdown/best_practices.md
- https://data.jsdelivr.com/v1/packages/npm/intl-tel-input@29.2.3 · https://registry.npmjs.org/intl-tel-input/latest
- https://intl-tel-input.com/examples/vanilla-javascript/lookup-country
- https://registry.npmjs.org/libphonenumber-js · https://api.github.com/repos/catamphetamine/libphonenumber-js · https://github.com/catamphetamine/libphonenumber-js#readme
- https://ipapi.co/#pricing · https://ip-api.com/docs/legal · https://country.is/ · https://ipwhois.io/documentation
- https://developers.cloudflare.com/fundamentals/reference/http-headers/
- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/tel

**Código postal**
- https://download.geonames.org/export/zip/ · https://download.geonames.org/export/zip/readme.txt
- https://zippopotam.us/ · https://docs.zippopotam.us/docs/getting-started/ · https://api.github.com/repos/zippopotamus/zippopotamus
- https://developers.google.com/maps/billing-and-pricing/pricing · https://developers.google.com/maps/billing-and-pricing/faq · https://developers.google.com/maps/documentation/geocoding/usage-and-billing
- https://copomex.com/ · https://api.copomex.com/documentacion/inicio
- https://www.correosdemexico.gob.mx/SSLServicios/ConsultaCP/CodigoPostal_Exportar.aspx
- https://www.canadapost-postescanada.ca/ac/pricing/ · https://www.canadapost-postescanada.ca/cpc/en/commercial/data-solutions/license-data.page
- https://www.smarty.com/pricing/international · https://www.loqate.com/en-us/pricing/ · https://www.postgrid.com/address-verification-pricing/ · https://www.geoapify.com/pricing/
- https://operations.osmfoundation.org/policies/nominatim/ · https://www2.census.gov/geo/docs/maps-data/data/gazetteer/
- https://github.com/IcaliaLabs/sepomex · https://github.com/acrogenesis/API-Codigos-Postales · https://github.com/open-mexico/mexico-geojson

**Correo**
- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/email
- https://nodejs.org/api/dns.html · https://www.rfc-editor.org/rfc/rfc5321.txt (§5.1) · https://datatracker.ietf.org/doc/html/rfc5233
- https://api.github.com/repos/mailcheck/mailcheck · https://registry.npmjs.org/mailcheck
- https://github.com/smashsend/email-spell-checker · https://registry.npmjs.org/@zootools/email-spell-checker
- https://data.iana.org/TLD/tlds-alpha-by-domain.txt · https://registry.npmjs.org/validator · https://api.github.com/repos/validatorjs/validator.js

**UX y accesibilidad**
- https://baymard.com/blog/mobile-form-usability-label-position · https://baymard.com/blog/mobile-forms-avoid-inline-labels
- https://baymard.com/blog/required-optional-form-fields · https://baymard.com/blog/inline-form-validation · https://baymard.com/learn/input-fields
- https://web.dev/learn/forms/validation · https://web.dev/learn/forms/accessibility · https://web.dev/learn/forms/autofill
- https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#autofill
- https://www.w3.org/WAI/WCAG22/Understanding/identify-input-purpose.html · https://www.w3.org/WAI/WCAG22/Understanding/error-suggestion.html · https://www.w3.org/WAI/WCAG22/Understanding/redundant-entry.html
- https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage · https://developer.chrome.com/blog/shared-autofill
- https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/
