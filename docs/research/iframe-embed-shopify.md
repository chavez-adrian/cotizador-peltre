# Embeber el formulario de mayoreo via iframe cross-origin en Shopify -- riesgos verificados

**Fecha de investigacion:** 2026-08-17
**Alcance:** el iframe hijo es `https://cotizador-peltre.onrender.com/mayoreo`, servido por este repo; el padre es una pagina de Shopify (`pppeltre.mx/pages/peltre-de-mayoreo`, tema del theme editor). Origenes distintos: cross-origin real, no solo cross-subdominio.
**Ticket relacionado:** #162 (Turnstile, gate de salida a produccion) y #164 (reemplazo del formulario en Shopify) de la spec #155, ver `PROGRESS.md`.

> Convencion: cada afirmacion lleva su fuente y la fecha en que se verifico contra ella (todas 2026-08-17 salvo que se indique otra). Veredicto por riesgo: **CONFIRMADO** (la fuente primaria lo dice explicitamente), **DESCARTADO** (la fuente primaria dice que no aplica o el mecanismo que lo causaba ya no existe), **SIN EVIDENCIA OFICIAL** (no hay doc primaria que lo confirme o niegue; se dice explicitamente en vez de rellenar con blogs).
>
> ASCII estricto en todo el archivo, igual que el resto del codigo del repo.

---

## 1. Cloudflare Turnstile dentro de un iframe cross-origin

### 1.1 Que SI documenta Cloudflare sobre iframes

**No hay una pagina oficial dedicada a "Turnstile dentro de un iframe cross-origin".** Se revisaron directamente `developers.cloudflare.com/turnstile/troubleshooting/`, `.../frequently-asked-questions/`, `.../get-started/client-side-rendering/`, `.../concepts/widget/`, `.../additional-configuration/hostname-management/` y `.../reference/content-security-policy/` (todas consultadas 2026-08-17): ninguna menciona iframes, `sandbox`, `allow` ni Safari/ITP de forma directa. Es una laguna real de la documentacion, no una omision de esta investigacion.

**Lo que si esta confirmado y es relevante:**

- El widget mismo se implementa **como un iframe** que Cloudflare inyecta desde `challenges.cloudflare.com/turnstile/v0/api.js`. El `frame-src` y `script-src` de CSP deben permitir ese origen. Fuente: [developers.cloudflare.com/turnstile/reference/content-security-policy](https://developers.cloudflare.com/turnstile/reference/content-security-policy/).
- `api.js` **debe** cargarse desde la URL exacta: *"The `api.js` file must be fetched from the exact URL shown above. Proxying or caching this file will cause Turnstile to fail when future updates are released."* -- ya documentado en la nota anterior del repo (`formulario-mayoreo-captura.md`), reverificado hoy.
- El error **200500** existe en el catalogo oficial de codigos de error y dice exactamente: *"The Turnstile iframe could not load. Check if challenges.cloudflare.com is blocked."* Fuente: [developers.cloudflare.com/turnstile/troubleshooting/client-side-errors/error-codes](https://developers.cloudflare.com/turnstile/troubleshooting/client-side-errors/error-codes/).
- El error **110200** ("Domain not authorized") indica que el hostname donde corre el widget no esta dado de alta en Hostname Management. Fuente: misma pagina de error-codes.

**Distincion importante que descarta una confusion comun de busqueda:** la frase *"Challenge Pages cannot be embedded in cross-origin iframes"* existe en la documentacion oficial, pero pertenece al producto **Challenge Pages** (paginas interstitial de WAF/Bot Fight Mode/Under Attack Mode), no a **Turnstile** (el widget embebible). La propia doc distingue los dos productos aunque comparten mecanismo interno. Fuente: [developers.cloudflare.com/cloudflare-challenges/concepts/how-challenges-work](https://developers.cloudflare.com/cloudflare-challenges/concepts/how-challenges-work/).

**Veredicto: SIN EVIDENCIA OFICIAL** de que Turnstile este soportado o no soportado explicitamente dentro de un iframe cross-origin -- porque la documentacion sencillamente no aborda el escenario. No hay una prohibicion documentada (a diferencia de Challenge Pages, que si la tiene). El comportamiento observado (§1.4) es la mejor evidencia disponible.

### 1.2 sandbox / allow del iframe padre

MDN confirma el comportamiento base del atributo `sandbox`: **ausente = sin restricciones**; solo cuando el atributo esta presente (incluso vacio) se aplican bloqueos, y estos se levantan individualmente con tokens (`allow-scripts`, `allow-forms`, `allow-same-origin`, etc.). Fuente: [developer.mozilla.org/.../iframe](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe), consultado 2026-08-17.

El snippet actual **no lleva `sandbox`**, por lo que esta regla no aplica: el iframe tiene autoridad ambiente completa salvo lo que module `allow` (Permissions Policy) o el propio navegador. Esto es consistente con reportes (no oficiales, ver abajo) de que Turnstile falla dentro de iframes con `sandbox` mal configurado.

**Evidencia no oficial pero corroborante:** varios reportes en GitHub issues, WordPress.org y el foro comunitario de Cloudflare (community.cloudflare.com -- foro de usuarios, NO documentacion oficial) describen errores de Turnstile ("sandboxed frame error") cuando un `sandbox` restrictivo (comunmente inyectado por plugins de seguridad como `nuxt-security`) no incluye `allow-same-origin allow-scripts allow-forms allow-popups`. Turnstile crea internamente un iframe intermedio `about:blank` con su propio `sandbox` para aislar el challenge del resto de la pagina; un `sandbox` del padre demasiado restrictivo bloquea que ese iframe interno se ejecute. Esto **no es documentacion oficial de Cloudflare** -- es una inferencia consistente de varios reportes independientes, y se marca como tal.

**Veredicto: CONFIRMADO (indirectamente) que el snippet actual, al no llevar `sandbox`, no esta expuesto a este problema.** Si en algun momento se agrega `sandbox` por endurecimiento, debe incluir como minimo `allow-scripts allow-same-origin allow-forms allow-popups` o Turnstile puede romperse. **SIN EVIDENCIA OFICIAL** del mecanismo exacto (el iframe interno `about:blank`) porque no hay doc de Cloudflare que lo describa; la evidencia es de terceros.

### 1.3 Permissions Policy / `allow`

No se encontro ninguna directiva de Permissions Policy que Cloudflare documente como requerida para Turnstile (a diferencia de, por ejemplo, `payment` para la Payment Request API). El snippet actual no lleva `allow` y no hay fuente oficial que diga que deba llevarlo para que Turnstile funcione.

**Veredicto: SIN EVIDENCIA OFICIAL** de un requisito de `allow` para Turnstile. No agregar nada por este concepto sin una razon distinta (ver §2 sobre `shared-autofill`, que es un tema aparte).

### 1.4 Storage partitioning / ITP de Safari

**Hallazgo clave, y es tranquilizador:** el cookie de estado de Cloudflare (`cf_clearance`) se emite con `SameSite=None; Secure; Partitioned` -- es decir, ya cumple con **CHIPS** (Cookies Having Independent Partitioned State), el mecanismo que tanto Chrome como Safari adoptaron para permitir cookies de terceros *sin* necesitar acceso a storage no particionado. Textual: *"the `cf_clearance` cookie is stored in a partition keyed to the top-level site and is not shared across embedding sites."* Fuente: [developers.cloudflare.com/fundamentals/reference/policies-compliances/cloudflare-cookies](https://developers.cloudflare.com/fundamentals/reference/policies-compliances/cloudflare-cookies/), consultado 2026-08-17.

Esto importa porque explica **por que Turnstile no depende de la Storage Access API ni de que Safari le conceda acceso a cookies "unpartitioned"**: al usar un cookie particionado por diseno, Turnstile no necesita que el usuario interactue para pedir storage sin particionar (que es justo lo que bloquea ITP para trackers de terceros). El mecanismo de ITP que rompe login/tracking de terceros (documentado en WebKit: *"the embedded content treats the user as logged out even though they are logged in"*, [webkit.org/blog/8124/introducing-storage-access-api](https://webkit.org/blog/8124/introducing-storage-access-api/)) no aplica a un widget que nunca pidio ver el estado de sesion del usuario en el dominio raiz -- solo necesita su propio estado de challenge, que CHIPS le da sin pedir permiso.

**Lo que esto NO cubre:** no hay una pagina de Cloudflare que diga textualmente "Turnstile funciona bajo ITP de Safari"; es una inferencia razonada a partir de como esta construido el cookie (fuente primaria: la pagina de cookies de Cloudflare) mas el mecanismo documentado de CHIPS/ITP (fuente primaria: WebKit). Es la mejor evidencia disponible, no una cita directa.

**Veredicto: CONFIRMADO por inferencia de fuente primaria** que el widget no deberia romperse por ITP al RENDERIZAR ni al EMITIR el cookie de estado (diseno CHIPS). **SIN EVIDENCIA OFICIAL** sobre el comportamiento exacto al COMPLETAR el desafio en Safari iOS real -- ninguna fuente primaria lo describe paso a paso, y el contexto empirico ya provisto ("el widget renderiza en Chrome; falta certeza sobre ITP al completar en Safari") sigue sin resolverse por documentacion. Recomendacion: probar el flujo completo (no solo el render) en Safari iOS real antes de publicar -- es la unica forma de cerrar esta laguna, documentacion o no.

### 1.5 Hostname que valida el sitekey: iframe o pagina contenedora

Hostname Management valida por **FQDN exacto** (o su arbol de subdominios), sin wildcards, sin esquema ni puerto. Fuente: [developers.cloudflare.com/turnstile/additional-configuration/hostname-management](https://developers.cloudflare.com/turnstile/additional-configuration/hostname-management/). La documentacion consultada **no dice explicitamente** si valida el hostname del documento que ejecuta `api.js` (el iframe, `cotizador-peltre.onrender.com`) o el de la ventana top-level (`pppeltre.mx`).

Por como esta construido el mecanismo (el script se carga y ejecuta en el `document` del iframe, que es quien tiene el `location.hostname` real; el padre nunca ejecuta ese script), lo logico es que valide el hostname del iframe. Esto es consistente con que Turnstile ya "funciona" segun la nota empirica (widget visible en Chrome dentro del iframe) -- si validara el hostname del padre (`pppeltre.mx`, no dado de alta para el sitekey del cotizador), se hubiera visto el error 110200 en pantalla.

**Veredicto: SIN EVIDENCIA OFICIAL explicita, pero CONFIRMADO empiricamente por descarte** (el widget renderiza sin error 110200 en el entorno de prueba, lo cual solo es posible si valida contra `cotizador-peltre.onrender.com` o si ese hostname ya esta en la lista autorizada del sitekey). Verificar en el dashboard de Cloudflare (Turnstile > tu sitekey > Hostname Management) que el hostname dado de alta sea el del iframe (`cotizador-peltre.onrender.com`), no el de Shopify.

---

## 2. Autofill del navegador en iframes cross-origin

### 2.1 Chrome -- distincion pago vs contacto/direccion, verificada en fuente primaria

El documento tecnico de Chromium sobre autofill entre iframes es explicito sobre el mecanismo:

> *"The same-origin policy is a solid baseline for autofilling across frames"* -- es decir, por default Chrome SI intenta autocompletar formularios dentro de iframes, con la politica de mismo-origen como base. Fuente: [chromium.googlesource.com/.../docs/security/autofill-across-iframes.md](https://chromium.googlesource.com/chromium/src/+/refs/tags/124.0.6367.205/docs/security/autofill-across-iframes.md), consultado 2026-08-17.

**`shared-autofill` es una permission policy que resuelve un problema DISTINTO al nuestro.** El caso de uso documentado, tanto en el doc tecnico como en el blog oficial, es un **formulario partido entre multiples frames** -- tipicamente el campo de nombre del titular en la pagina del comercio (origen top-level) y el numero de tarjeta en un iframe de un PSP (Stripe Elements, Adyen), cada campo en un origen distinto dentro de la MISMA pagina. Textual del blog: *"This is particularly useful for payment forms, where it is very common for sensitive fields (for PCI DSS compliance) to be loaded from a third-party origin such as a payment service provider (PSP)."* Fuente: [developer.chrome.com/blog/shared-autofill](https://developer.chrome.com/blog/shared-autofill), consultado 2026-08-17. Sin `shared-autofill`, Chrome no completa across esos multiples frames porque no puede diferenciar un frame de confianza de uno no confiable con solo la politica de mismo-origen.

**Nuestro caso es estructuralmente distinto y mas simple: el formulario completo (nombre, correo, telefono, CP) vive dentro de UN SOLO documento (el iframe), que es autocontenido.** No hay ningun campo en el frame padre (Shopify) que deba combinarse con campos del iframe para formar "un" formulario. El autofill de Chrome opera sobre el DOM de cada documento/formulario de forma independiente para heuristicas de clasificacion de campos -- eso no esta restringido por politica de origen cruzado, porque no hay cruce de frames dentro del formulario mismo. Esto es una **inferencia razonada** a partir del mecanismo documentado (el problema que resuelve `shared-autofill` es especificamente el de multiples frames en un mismo formulario), no una cita directa que diga "un iframe autocontenido no necesita esto" -- pero es coherente con el resultado empirico ya reportado: autofill de telefono y correo funcionando en Chrome desktop sin ningun `allow` en el snippet actual.

**Veredicto: DESCARTADO como riesgo.** El resultado empirico (autofill funcionando en Chrome sin `allow="shared-autofill"`) es exactamente lo que predice la documentacion primaria una vez se entiende el alcance real de la feature: aplica a formularios partidos entre frames, no al caso de un iframe autocontenido. `allow="shared-autofill"` en el snippet actual **no es necesario** -- contrario a lo que sugeria la nota de investigacion previa del repo (`formulario-mayoreo-captura.md` §5.5), que dejo el punto marcado como "parcialmente verificado" antes de tener el dato empirico de hoy.

### 2.2 Safari / WebKit -- sin documentacion oficial del mecanismo, con una pista fuerte de foro DTS

**No existe una pagina de developer.apple.com o webkit.org que documente el comportamiento de AutoFill/QuickType dentro de iframes cross-origin.** Se revisaron `developer.apple.com/documentation/safari-developer-tools/autofill` (pagina renderizada por JS, contenido no accesible via fetch de texto plano) y las paginas de Password AutoFill; ninguna aborda iframes.

**El unico dato oficial encontrado es indirecto y sobre un caso distinto (relleno programatico, no AutoFill nativo):** un ingeniero de Apple (Frameworks Engineer, foro oficial de Apple Developer) respondio sobre si es posible rellenar programaticamente (via WKWebView/JS) campos dentro de un iframe cross-origin: *"There's no supported way for you to achieve this with the APIs currently available. If you'd like us to consider adding the necessary functionality, please file an enhancement request using Feedback Assistant."* Fuente: [developer.apple.com/forums/thread/763885](https://developer.apple.com/forums/thread/763885), consultado 2026-08-17.

Esto es sobre **relleno programatico desde el app host** (un password manager de terceros o una app WKWebView inyectando JS), no sobre el comportamiento nativo de Safari AutoFill/QuickType al mostrar sugerencias sobre un `<input>` visible dentro de un iframe -- que es arquitectonicamente distinto: QuickType opera a nivel del motor de renderizado (WebKit engine), no como JS de pagina sujeto a Same-Origin Policy, por lo que puede "ver" el campo enfocado sin que la politica de origenes cruzados se lo impida. Esto es coherente con el resultado empirico ya reportado (QuickType SI sugiere telefono y correo dentro del iframe en Safari iOS real), pero **no hay una fuente primaria que explique el mecanismo o lo garantice como comportamiento soportado** -- es observacion empirica sin respaldo documental, no al reves.

**Sobre por que NO sugiere nombre/apellido:** no se encontro ninguna fuente oficial (Apple o WebKit) que explique por que QuickType ofrece telefono/correo pero no nombre dentro de un iframe cross-origin. Es plausible que sea heuristica de confianza propia de Apple Contactos/QuickType (mismo patron que el resto de AutoFill: campos de "contacto rapido" vs. campos de identidad mas sensibles), pero no hay cita que lo confirme.

**Veredicto: SIN EVIDENCIA OFICIAL** del mecanismo. El comportamiento reportado empiricamente (funciona para telefono/correo, no para nombre) es el unico dato confiable disponible y debe tratarse como un hallazgo de prueba, no como una garantia documentada -- puede cambiar entre versiones de iOS sin aviso porque no hay contrato publico que lo fije.

### 2.3 Firefox -- confirmado para logins, no aplica a Form Autofill de contacto

Se encontro y verifico directamente el bug primario de Mozilla:

**Bug 786276** ("Don't autofill logins in frames that are not same-origin with top-level page"), estado **VERIFIED FIXED** (Firefox 83). Es especificamente sobre el **gestor de contrasenas** (login/password manager), no sobre el "Form Autofill" (direcciones/tarjetas). Cita de la verificacion: *"the login you created for the origin [...] is not autofilled into the [...] page loaded into the iframe"* cuando el origen del iframe difiere del top-level. Fuente: [bugzilla.mozilla.org/show_bug.cgi?id=786276](https://bugzilla.mozilla.org/show_bug.cgi?id=786276), consultado 2026-08-17.

**No se encontro un bug o doc equivalente para el modulo "Form Autofill" (direcciones/telefono/correo) de Firefox especificamente sobre iframes cross-origin.** Ese modulo (distinto del password manager) no tiene la misma cobertura de busqueda en las fuentes consultadas.

**Veredicto: CONFIRMADO** que Firefox bloquea deliberadamente el autofill de **credenciales guardadas** (usuario/contrasena) dentro de iframes cross-origin, por diseno de seguridad (mitiga clickjacking de credenciales). **No aplica a nuestro formulario**, que no tiene campos de login. **SIN EVIDENCIA OFICIAL** sobre el comportamiento de Firefox Form Autofill (direccion/telefono/correo) especificamente en iframes cross-origin -- no verificado, y el contexto del encargo no incluia una prueba empirica en Firefox real para contrastar.

### 2.4 Campos de pago -- no aplica a este formulario

El formulario de mayoreo no tiene campos de tarjeta ni invoca la Payment Request API, asi que la distincion documentada por Chrome/MDN (Permissions Policy `payment`, `allow="payment"` para invocar `PaymentRequest()` desde un iframe cross-origin) es irrelevante aqui. Se confirma solo para cerrar el punto: MDN documenta que el default allowlist de `payment` es `self`, y que un iframe cross-origin necesita `allow="payment"` explicito para invocar la API. Fuente: [developer.mozilla.org/.../Permissions-Policy/payment](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Permissions-Policy/payment), consultado 2026-08-17. **No aplica** -- se documenta para que quede explicito que se evaluo y se descarto, no por omision.

---

## 3. Quirks de iframes en Safari iOS

### 3.1 "El iframe se expande al alto de su contenido" -- DESCARTADO como comportamiento vigente

Este es el hallazgo mas importante de esta seccion, y contradice la premisa comun ("todavia hay que lidiar con el frame flattening de iOS"):

El mecanismo detras de ese quirk clasico se llama **"frame flattening"**: WebKit expandia (aplanaba) casi cualquier iframe al alto de su contenido interno, deliberadamente, para que el usuario no quedara "atrapado" en un area chica con scroll propio dentro de una pantalla movil pequena. Se habilito por default en iOS en 2014 (bug [128151](https://bugs.webkit.org/show_bug.cgi?id=128151), *"[WebKit2, iOS] Enable frame flattening by default on iOS"*, RESOLVED FIXED, r163353).

**Ese mecanismo ya no existe en WebKit.** El codigo de frame flattening se elimino por completo del motor en julio de 2022: bug [242883](https://bugs.webkit.org/show_bug.cgi?id=242883), *"Remove frame flattening code"*, RESOLVED FIXED, comiteado 2022-07-19. La documentacion de la API publica de WebKitGTK (parte del proyecto WebKit, uno de sus puertos oficiales) lo confirma sin ambiguedad: *"Frame flattening is no longer supported. This property does nothing. Please do not use it in newly written code."* -- deprecado desde WebKitGTK 2.38. Fuente: [webkitgtk.org/reference/webkit2gtk/stable/property.Settings.enable-frame-flattening.html](https://webkitgtk.org/reference/webkit2gtk/stable/property.Settings.enable-frame-flattening.html), consultado 2026-08-17.

En paralelo, iOS/iPadOS **13** (2019) habilito frames genuinamente scrollables como alternativa al aplanado: bug [149264](https://bugs.webkit.org/show_bug.cgi?id=149264), *"[iOS] IFrames are not scrollable even when scrolling=yes is specified"*, resuelto con *"Scrollable frames on iOS were enabled"* (changeset 242814, julio 2019).

**Conclusion combinando ambos hechos:** un iframe en iOS Safari moderno (iOS 13+, y con mas razon desde que el codigo de flattening se elimino en 2022) **no se auto-expande al alto de su contenido por ningun mecanismo nativo del navegador**. Un iframe con altura fija se comporta igual que en cualquier otro navegador: si el contenido excede la altura declarada, hace scroll interno (a menos que se bloquee explicitamente con `scrolling="no"`), y NO crece solo.

**Esto tiene una implicacion directa y positiva para el snippet actual:** el mecanismo que ya se implemento -- el hijo manda su altura por `postMessage` y el padre ajusta el `<iframe>` -- **no esta compensando ningun comportamiento roto de iOS; es la unica forma correcta y estandar de lograr auto-altura en CUALQUIER navegador**, moderno o viejo, con o sin frame flattening. No hace falta ningun ajuste adicional especifico de iOS para este punto.

**Veredicto: DESCARTADO** como riesgo especifico de iOS (el mecanismo que lo causaba fue removido del motor en 2022) **y CONFIRMADO** que la solucion ya implementada (postMessage + resize del padre) es la correcta independientemente de esa historia.

### 3.2 Scroll y foco al abrir el teclado dentro de un iframe -- CONFIRMADO como riesgo real y activo

A diferencia del punto anterior, esta clase de bug **si sigue activa** en el bug tracker de WebKit, con reportes recientes:

- Bug [158629](https://bugs.webkit.org/show_bug.cgi?id=158629) -- *"Focus event dispatched in iframe causes parent document to scroll incorrectly"*. RESOLVED FIXED (r202292), pero un reporte de seguimiento en 2018 (bug 186268) indico que el problema persistia para elementos no-input. El bug base confirma el mecanismo: al enfocar un input dentro de un iframe en una pagina larga, WebKit podia hacer scroll del documento padre con el offset equivocado porque `setProhibitsScrolling()` solo se aplicaba al FrameView interno, no a los ancestros.
- Bug [176451](https://bugs.webkit.org/show_bug.cgi?id=176451) -- *"scrollIntoView and scrolling to anchor inside iframe don't scroll content to proper position"*.
- Bug [300523](https://bugs.webkit.org/show_bug.cgi?id=300523) -- *"REGRESSION (iOS 26): Safari on iPhones with Dynamic Island shifts the viewport upward when scrolling or closing the keyboard"* -- reporte reciente contra iOS 26, evidencia de que el area sigue siendo fragil en versiones actuales.

**Veredicto: CONFIRMADO como categoria de riesgo activa** (el foco/scroll de campos dentro de iframes en iOS tiene un historial largo de bugs, algunos cerrados, otros reabiertos, y regresiones reportadas contra versiones recientes de iOS). **No hay una fuente oficial que diga "esto esta resuelto en iOS 26"** -- lo contrario: el bug 300523 sugiere que sigue habiendo friccion en las versiones actuales. Mitigacion practica (sin fuente que la prescriba, es criterio propio): probar el flujo real de foco/tab entre campos con el teclado abierto en un iPhone real antes de publicar, mismo criterio que ya se aplico para el autofill.

### 3.3 `position: fixed` dentro de iframes -- CONFIRMADO como resuelto (2019), no aplica salvo que se use

- Bug [154399](https://bugs.webkit.org/show_bug.cgi?id=154399) -- *"Position fixed is buggy with overflow:auto scrolling inside iframes"*, elementos con `position:fixed` "saltaban" durante scroll rapido dentro de un iframe con `overflow:auto`. RESOLVED FIXED, r246156, 2019-06-06.

**Relevancia para este formulario:** no se identifico ningun uso de `position: fixed` en el formulario de mayoreo (no se reviso el CSS a fondo por estar fuera del alcance de "no tocar codigo", pero no es un patron mencionado en el contexto empirico). Si el formulario no usa `position: fixed`, este punto es irrelevante en la practica.

**Veredicto: CONFIRMADO como bug historico, resuelto en 2019.** Si el formulario no usa `position: fixed`, DESCARTADO por no aplicabilidad. Si en el futuro se agrega un elemento fijo (ej. una barra de progreso o un boton flotante), validar en iOS real -- el bug esta resuelto pero el area es historicamente fragil (ver §3.2).

### 3.4 VisualViewport y teclado -- limitacion documentada, no un bug

MDN documenta explicitamente que, dentro de un iframe, `VisualViewport` **no aporta nada nuevo**: *"For an `<iframe>`, visual viewport metrics like `VisualViewport.width` always correspond to layout viewport metrics like `document.documentElement.clientWidth`."* Fuente: [developer.mozilla.org/.../VisualViewport](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport), consultado 2026-08-17. Es decir, un iframe no tiene su propio "visual viewport" distinto del padre -- solo la ventana top-level lo tiene. Ademas, el meta-atributo moderno `interactive-widget` (que en Chrome/Firefox permite controlar si el teclado redimensiona o se superpone al viewport) **no tiene soporte en WebKit/Safari** todavia; hay un issue de posicionamiento de estandares abierto (`WebKit/standards-positions#65`) pidiendolo.

**Veredicto: CONFIRMADO (limitacion documentada, no un bug).** No hay forma de que el iframe hijo detecte el redimensionado del viewport por el teclado de forma nativa via `VisualViewport`; cualquier ajuste de layout al abrir el teclado dentro del iframe depende del comportamiento generico del navegador (reflow normal de la pagina), no de una API dedicada. No se identifico necesidad de esto en el formulario actual (no hay elementos que dependan de conocer el alto visible restante), asi que es informativo, no accionable hoy.

---

## 4. Shopify -- script tags en `body_html` de una pagina

### 4.1 Lo que documenta shopify.dev sobre el campo

El recurso `Page` de la Admin REST API describe `body_html` unicamente como *"The text content of the page, complete with HTML markup"*, sin enumerar restricciones, sanitizacion ni lista de tags permitidos/prohibidos. Fuente: [shopify.dev/docs/api/admin-rest/latest/resources/page](https://shopify.dev/docs/api/admin-rest/latest/resources/page), consultado 2026-08-17.

**No se encontro documentacion de shopify.dev que diga explicitamente si escribir `body_html` via la Admin API (REST o GraphQL) sanitiza o preserva un `<script>`.** La API en si (una escritura server-to-server) no pasa por el editor de texto enriquecido del admin -- ese es un dato estructural razonable (la sanitizacion de TinyMCE, ver abajo, es client-side en el navegador del admin), pero no hay una fuente que lo confirme por escrito para el caso especifico de escribir directo por API.

### 4.2 Lo que SI confirma el Help Center: el editor de texto enriquecido sanitiza

El Help Center oficial de Shopify confirma sanitizacion activa en el editor WYSIWYG de paginas/blogs/productos/colecciones:

> *"TinyMCE provides content filtering logic that automatically corrects HTML formatting to prevent storefront malfunctions and security risks."*

Y advierte explicitamente contra pelear con esa sanitizacion:

> *"Although you can manually edit HTML back to its original form, it's recommended that you work with these automated changes to prevent potential issues."*

Fuente: [help.shopify.com/en/manual/shopify-admin/productivity-tools/rich-text-editor](https://help.shopify.com/en/manual/shopify-admin/productivity-tools/rich-text-editor), consultado 2026-08-17.

**Lo que esta pagina NO enumera explicitamente es la lista de tags afectados** -- no dice en texto "los `<script>` se eliminan". Lo unico documentado de forma concreta en esta pagina es un limite de tamano: 64 KB para el contenido de Paginas, entradas de Blog y "additional scripts" (dato reportado en el changelog oficial que referencia esta pagina de ayuda, no verificado linea por linea en el Help Center mismo dentro de esta sesion).

**Veredicto: SIN EVIDENCIA OFICIAL categorica** de que `<script>` se elimine especificamente. Lo que SI esta confirmado por fuente primaria es que el editor de texto enriquecido (TinyMCE) aplica sanitizacion activa de HTML "para prevenir fallas del storefront y riesgos de seguridad" -- eso es exactamente el tipo de filtro que, en configuraciones tipicas de TinyMCE, remueve `<script>` por default. Tratar esto como riesgo real hasta probarlo, no como hecho descartado.

### 4.3 La ruta segura y documentada: plantilla alterna, fuera de `body_html`

Existe un mecanismo oficial y documentado para evitar el problema por completo: las **plantillas alternas** de tema (`page.<sufijo>.liquid`), que son archivos de codigo del tema (editados en el editor de codigo del tema, no en el editor de texto enriquecido de la pagina) y que Shopify asocia a una pagina especifica sin pasar el contenido por `body_html` ni por TinyMCE en absoluto. Documentado en [shopify.dev/docs/storefronts/themes/architecture/templates/alternate-templates](https://shopify.dev/docs/storefronts/themes/architecture/templates/alternate-templates), consultado 2026-08-17: el nombre de archivo sigue el patron `template-name.template-suffix.liquid` (ej. `page.mayoreo.liquid`), y `template.suffix` permite identificar la plantilla activa en Liquid.

**Veredicto: CONFIRMADO que existe una ruta oficial para insertar el `<script>`/`<iframe>` sin pasar por la sanitizacion del editor de texto enriquecido**, usando una plantilla alterna de pagina en vez de escribir el snippet dentro de `body_html`. Es la opcion recomendada en §5.

---

## 5. Ajustes recomendados al snippet

1. **No agregar `sandbox` al `<iframe>`.** El estado actual (sin `sandbox`) es correcto: MDN confirma que la ausencia del atributo significa cero restricciones, y agregar un `sandbox` mal configurado es la causa documentada (por terceros, no por Cloudflare, pero consistente) de que Turnstile deje de funcionar. Si en el futuro se quiere endurecer por otras razones, el conjunto minimo es `allow-scripts allow-same-origin allow-forms allow-popups`.
2. **No agregar `allow="shared-autofill"`.** La investigacion previa del repo lo sugeria "por si acaso"; hoy se puede cerrar el punto: `shared-autofill` resuelve un problema de formularios partidos entre multiples frames (tipico de PSPs de pago), no el de un formulario autocontenido en un solo iframe como el nuestro. No aporta nada y no hace falta.
3. **Verificar en el dashboard de Cloudflare que el hostname autorizado del sitekey de Turnstile sea el del iframe (`cotizador-peltre.onrender.com`), no el de Shopify.** La documentacion no lo dice explicitamente, pero es la unica configuracion consistente con que el widget ya renderice sin error 110200.
4. **Probar el flujo COMPLETO de Turnstile (no solo el render) en Safari iOS real** antes de publicar: completar el challenge y confirmar que el submit del formulario recibe un token valido. No hay documentacion oficial que cierre esta duda; es la unica forma de resolverla.
5. **Probar foco/tab entre campos con el teclado del iPhone abierto**, dentro del iframe real embebido en la pagina de Shopify (no en el formulario standalone). El area de scroll/foco en iframes de iOS tiene un historial largo de bugs en WebKit, con regresiones reportadas contra versiones tan recientes como iOS 26 (bug 300523). No asumir que "renderiza bien" implica que el foco/scroll tambien se comporta bien.
6. **Insertar el snippet (script + iframe) via una plantilla alterna de tema (`page.mayoreo.liquid`) en vez de pegarlo en el editor de texto enriquecido de la pagina.** Es la ruta documentada que evita depender de si TinyMCE preserva o elimina el `<script>` al guardar -- evita el riesgo por completo en vez de mitigarlo.
7. **No es necesario ningun ajuste por "frame flattening" ni por auto-expansion del iframe en iOS.** El mecanismo que causaba ese comportamiento fue eliminado del motor WebKit en 2022; el postMessage + resize ya implementado es la solucion correcta y suficiente, sin relacion con ese historial.

---

## 6. Recomendacion final: iframe vs. link

**Sostener el iframe, con las validaciones pendientes de la lista de arriba antes de publicar -- no hay evidencia oficial de un riesgo que lo descarte.**

El razonamiento, punto por punto contra lo investigado:

- **Turnstile:** no hay prohibicion documentada de Cloudflare para correr Turnstile dentro de un iframe cross-origin (a diferencia de Challenge Pages, que si la tiene explicita). El diseno del cookie de estado (`Partitioned`, CHIPS) sugiere que no deberia chocar con ITP de Safari al nivel de renderizado. La unica duda real y sin cerrar es el comportamiento al COMPLETAR el challenge en Safari iOS -- una prueba manual, no un cambio de arquitectura, cierra esa duda.
- **Autofill:** el analisis de fuente primaria de Chrome descarta la preocupacion inicial sobre `shared-autofill` -- nuestro caso (formulario autocontenido en un solo frame) no es el escenario que esa politica resuelve, y el resultado empirico ya lo confirma. Firefox solo bloquea logins cross-origin, no aplica. Safari no tiene documentacion pero el comportamiento observado (funciona parcialmente) no es un bloqueo, es una degradacion aceptable -- el usuario puede escribir su nombre a mano.
- **Quirks de iOS:** el riesgo mas temido (el iframe expandiendose solo al alto de su contenido) esta **descartado por obsolescencia del mecanismo que lo causaba** (frame flattening, removido de WebKit en 2022). El riesgo real que persiste (foco/scroll con teclado abierto) es antiguo, documentado, con regresiones activas -- pero es un problema de pulido de UX, no un bloqueo funcional: en el peor caso el usuario tiene que hacer scroll manual para ver el campo que esta llenando, no pierde datos ni falla el envio.
- **Shopify:** existe una ruta oficial (plantilla alterna) que evita por completo la incertidumbre sobre si el editor de texto sanitiza el `<script>`. Usarla convierte un riesgo "sin evidencia oficial" en un no-riesgo, sin necesidad de decidir nada sobre el link vs. iframe.

Ninguno de los cuatro riesgos investigados tiene evidencia oficial de ser un bloqueador estructural para el iframe. El unico camino alterno (un link que saque al usuario de Shopify hacia el dominio del cotizador) evita las dos dudas reales (Turnstile al completar en Safari, foco/scroll con teclado) a cambio de una friccion de UX peor y segura: sacar al comprador de la pagina de la marca justo antes de dejar sus datos es, por si solo, una perdida de conversion mas probable que los riesgos tecnicos aqui investigados. Con las pruebas manuales de la lista de §5 hechas (Turnstile completo + foco en Safari iOS real), el iframe es la opcion correcta.

---

## 7. Indice de fuentes

**Cloudflare Turnstile**
- https://developers.cloudflare.com/turnstile/troubleshooting/
- https://developers.cloudflare.com/turnstile/frequently-asked-questions/
- https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/
- https://developers.cloudflare.com/turnstile/concepts/widget/
- https://developers.cloudflare.com/turnstile/additional-configuration/hostname-management/
- https://developers.cloudflare.com/turnstile/reference/content-security-policy/
- https://developers.cloudflare.com/turnstile/troubleshooting/client-side-errors/error-codes/
- https://developers.cloudflare.com/cloudflare-challenges/concepts/how-challenges-work/
- https://developers.cloudflare.com/fundamentals/reference/policies-compliances/cloudflare-cookies/

**Autofill**
- https://chromium.googlesource.com/chromium/src/+/refs/tags/124.0.6367.205/docs/security/autofill-across-iframes.md
- https://developer.chrome.com/blog/shared-autofill
- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Permissions-Policy/payment
- https://bugzilla.mozilla.org/show_bug.cgi?id=786276
- https://developer.apple.com/forums/thread/763885
- https://developer.apple.com/documentation/safari-developer-tools/autofill (contenido no accesible via fetch de texto plano en esta sesion)

**WebKit / iOS quirks**
- https://bugs.webkit.org/show_bug.cgi?id=128151 (frame flattening habilitado, 2014)
- https://bugs.webkit.org/show_bug.cgi?id=242883 (frame flattening removido, 2022)
- https://webkitgtk.org/reference/webkit2gtk/stable/property.Settings.enable-frame-flattening.html
- https://bugs.webkit.org/show_bug.cgi?id=149264 (scrollable frames en iOS 13, 2019)
- https://bugs.webkit.org/show_bug.cgi?id=158629 (foco en iframe descuadra scroll del padre)
- https://bugs.webkit.org/show_bug.cgi?id=176451 (scrollIntoView en iframe)
- https://bugs.webkit.org/show_bug.cgi?id=300523 (regresion iOS 26, teclado)
- https://bugs.webkit.org/show_bug.cgi?id=154399 (position:fixed en iframe con overflow:auto, resuelto 2019)
- https://webkit.org/blog/8124/introducing-storage-access-api/
- https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport

**Shopify**
- https://shopify.dev/docs/api/admin-rest/latest/resources/page
- https://help.shopify.com/en/manual/shopify-admin/productivity-tools/rich-text-editor
- https://shopify.dev/docs/storefronts/themes/architecture/templates/alternate-templates
- https://shopify.dev/changelog/rich-text-editor-update

**Contexto interno consultado (no fuente externa)**
- `docs/research/formulario-mayoreo-captura.md` (nota previa del repo, §5.5 revisada y resuelta aqui)
- `lib/turnstile.js` (verificacion server-side actual, fail-open en fallo de red, ver comentarios del modulo)
- `public/js/mayoreo.js` (mecanismo postMessage de altura ya implementado)
- `PROGRESS.md` (spec #155, tickets #162/#164)
