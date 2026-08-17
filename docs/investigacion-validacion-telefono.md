# Investigacion: validacion de celulares para WhatsApp (E.164) - practicas 2026

Fecha: 2026-08-17. Contexto: issues #175 (validacion por largo, implementada) y
#176 (capa estricta con libphonenumber, propuesta). Pregunta de fondo: si el
diseno de #176 (aviso no bloqueante + utils.js vendoreado + backstop en server
que registra sin rechazar) es la mejor practica, o si hay un patron mejor.

Todas las citas van a fuente primaria (repos oficiales, docs first-party).
Lo que es inferencia mia esta marcado como **[inferencia]**.

---

## TL;DR

**El rumbo de #176 es correcto y esta alineado con la practica 2026, con dos
correcciones concretas:**

1. **La capa estricta NO debe usar `isValidNumberPrecise` como criterio
   principal.** Los propios autores de intl-tel-input (que compilan el
   libphonenumber vendoreado en este repo) lo desaconsejan explicitamente:
   las reglas precisas cambian cada mes y una copia vendoreada sin
   actualizacion automatica "empezara a rechazar numeros validos". Su
   recomendacion oficial es la validacion por largo (`utils.isValidNumber`,
   antes llamada `isPossibleNumber`), que "es mucho mas estable porque las
   reglas de largo rara vez cambian". Es decir: la mejor practica documentada
   por la fuente coincide con el espiritu de #175, no lo contradice. La capa
   precisa puede quedarse como AVISO informativo (nunca bloqueo), que es
   exactamente lo que propone #176.

2. **Los 11 numeros legacy `+52 1 XX XXXX XXXX` de Bitrix fallan TODAS las
   capas de libphonenumber, incluida la laxa** (el nacional queda de 11
   digitos y el largo posible de MX es 10: falla por `TOO_LONG`). La solucion
   no es relajar la validacion sino **normalizar antes de validar**: si tras
   `+52` siguen 11 digitos y el primero es `1`, quitar ese `1`. Es una
   transformacion sin ambiguedad porque ningun numero nacional mexicano puede
   empezar con 1 (patron general de la metadata: `[2-9]\d{9}`). Con esa
   normalizacion, los 11 legacy pasan cualquier capa y el conteo de fallas
   reales del export de Bitrix baja de 12 a ~1. **[inferencia** derivada de la
   metadata oficial, ver seccion 3**]**

3. Lo que ningun validador da (y ningun producto serio pretende dar con
   validacion de formato) es alcanzabilidad: Google lo dice textual - eso solo
   lo resuelve un paso de verificacion (OTP) o, en este flujo, el primer
   mensaje de WhatsApp del vendedor, que actua como verificacion humana
   natural. El backstop del server que registra sin rechazar es consistente
   con la guia de Google de no almacenar veredictos de validez como si fueran
   permanentes.

No hay un "patron mejor" que cambie la arquitectura: la escalera estandar 2026
es (a) UI que previene errores (selector de pais, formato as-you-type, largo
capado), (b) validacion estructural al capturar (largo primero, precisa como
aviso), (c) normalizacion a E.164 para almacenar, (d) verificacion real solo
si el costo del dato malo lo justifica (OTP o lookup de paga tipo Twilio, que
aqui no se justifica: el vendedor escribe por WhatsApp de inmediato).

---

## 1. libphonenumber: estandar de facto, isPossible vs isValid, y falsos negativos

**Es el estandar de facto.** Los autores de intl-tel-input: "International
number formatting/validation is hard (it varies by country/district, and we
currently support ~230 countries). The only comprehensive solution we have
found is libphonenumber" (docs de utils, repo oficial). Twilio Lookup v2 usa
la misma logica estructural (largo + prefijo) para su flag `valid` gratuito.

**Que valida cada funcion** (javadoc de `PhoneNumberUtil.java`, repo
google/libphonenumber):

- `isValidNumber`: "Tests whether a phone number matches a valid pattern.
  Note this doesn't verify the number is actually in use, which is impossible
  to tell by just looking at a number itself."
- `isPossibleNumber` / `isPossibleNumberWithReason`: "provides a more lenient
  check than isValidNumber (...) It only checks the length of phone numbers.
  In particular, it doesn't check starting digits of the number (...) it is
  much faster than isValidNumber."

**Que significa "valido" y su latencia** (FAQ.md oficial, seccion "What does
it mean for a phone number to be valid?"): "Our phone number library can tell
that a number range is valid when there is sufficient official documentation,
with some latency after this fact is brought to our attention (...) Do not
rely on libphonenumber to determine whether numbers are currently assigned to
a specific user and reachable. Some products (e.g. Google 2-step verification)
do this with a verification step e.g. by sending an SMS or placing an
automated phone call with a verification code."

**Sobre bloquear con veredictos de validez** (FALSEHOODS.md oficial):

- "Phone numbers that are valid today will always be valid (...) Tip: Don't
  store properties for a phone number such as validity or type. Check this
  information again from the library when you need it."
- "National numbering plans (...) represent the intentions of the government
  or telecom. These may be published before, during, or after the actual
  implementation of numbering plan changes in the real world."
- "An invalid number will not reach an endpoint" es listada como falsedad
  (1-800-MICROSOFT conecta aunque sobren digitos).

**La advertencia mas directa para este proyecto** viene de intl-tel-input
(que es quien compilo el utils.js vendoreado). Doc oficial de
`utils.isValidNumberPrecise`: "Note that these rules change each month for
various countries, so the package needs to be kept up-to-date (e.g. via an
automated script) - otherwise you may start rejecting valid numbers. For a
simpler and more future-proof check, see utils.isValidNumber." Y en el ejemplo
oficial de validacion precisa, en caja de advertencia: "we strongly recommend
sticking to the standard validation method, which is much more stable as it
only checks number length rules, which rarely change."

Nota de nomenclatura importante para no confundirse con el utils.js
vendoreado: en versiones recientes `utils.isValidNumber` ES la validacion por
largo ("previously named utils.isPossibleNumber") y la de patron preciso se
renombro a `utils.isValidNumberPrecise` ("previously named
utils.isValidNumber").

Fuentes: FAQ.md y FALSEHOODS.md y PhoneNumberUtil.java en
github.com/google/libphonenumber; site/src/docs/markdown/utils.md y
site/src/examples/vanilla-javascript/validation-precise/desc.html en
github.com/jackocnr/intl-tel-input.

## 2. Que hacen los productos serios: bloqueo, aviso, o verificacion posterior

**intl-tel-input (best practices oficiales)**: "Check the number is valid
before storing it, and reject invalid input" - pero con `isValidNumber` (la
por largo), no con la precisa (seccion 1). O sea: rechazo duro SOLO de lo
estructuralmente imposible (largo), no de lo que la metadata precisa opine.

**Twilio Lookup v2**: la validacion basica es gratuita y estructural
("returns the provided phone number in E.164 and national formats and
performs basic phone number validation"; `valid` indica "if the phone number
is in a valid range that can be freely assigned by a carrier to a user").
El tipo de linea (mobile/landline/VoIP) es un paquete de PAGA aparte (Line
Type Intelligence). Twilio lo posiciona para reducir mensajes no entregables
y fraude, no como gate de formularios; la alcanzabilidad real la resuelve su
producto Verify (OTP), no Lookup.

**Stripe Checkout**: campo requerido con selector, y ni siquiera Stripe
garantiza formato en todos los caminos: "We guarantee phone numbers in the
E.164 format when a customer doesn't use wallet payments"; con Apple/Google
Pay "the phone number format isn't guaranteed (...) We return the phone number
value that's provided by the third-party wallet". Es decir: Stripe acepta y
entrega el dato imperfecto en lugar de bloquear la transaccion. **[inferencia
sobre la intencion; las citas son textuales]**

**WhatsApp / Meta (Cloud API)**: el destinatario es tolerante en formato:
"Plus signs (+), hyphens (-), parenthesis ((,)), and spaces are supported in
send message requests. We highly recommend that you include both the plus sign
and country calling code"; si se omite el `+`, Meta antepone el codigo de pais
del negocio y "This can result in undelivered or misdelivered messages". Meta
mismo NORMALIZA en vez de rechazar: "For Brazil and Mexico, the extra added
prefix of the phone number may be modified by the Cloud API. This is a
standard behavior of the system and is not considered a bug."

**wa.me (FAQ oficial de WhatsApp, verificado contra el texto de la pagina)**:
"Use https://wa.me/<number> where the <number> is a full phone number in
international format. Omit any zeroes, brackets, or dashes when adding the
phone number in international format." Ejemplo: `https://wa.me/1XXXXXXXXXX`.
O sea: E.164 sin el `+`. El E.164 almacenado por el cotizador sirve directo
quitando el signo.

**Patron agregado 2026 [inferencia]**: bloqueo duro solo para lo imposible
(largo/estructura), normalizacion agresiva a E.164, aviso suave para lo
dudoso, y verificacion (OTP/lookup) reservada a flujos donde el costo del
dato malo es alto. Nadie de esta lista usa la validacion precisa de patron
como muro en captura.

## 3. Mexico: el "1" movil, la reforma IFT 2019, libphonenumber y WhatsApp

**La reforma**: IFT, Comunicado 34/2019 (16-jul-2019): a partir del 3 de
agosto de 2019 todo Mexico marca a 10 digitos y desaparecen los prefijos 01,
044 y 045 (y con ellos el "1" tras +52 para moviles desde el extranjero).
Hubo un ano de convivencia de ambas marcaciones (fin de transicion en 2020).

**libphonenumber** (FAQ.md, seccion Argentina/Mexico): "Mexico used to have
such additional prefixes (1, 02, 045, ...) for dialling mobile numbers (...)
As these dialling patterns were deprecated, we removed them but still maintain
mobile and fixed-line ranges at higher level, returning type as
FIXED_LINE_OR_MOBILE."

**Consecuencia medible en la metadata vigente** (PhoneNumberMetadata.xml,
territorio MX): patron general `[2-9]\d{9}` y `possibleLengths national="10"`,
sin `nationalPrefixForParsing` que quite un "1". Por tanto
`+52 1 55 1234 5678` parsea a un nacional de 11 digitos que empieza con 1:

- `isValidNumberPrecise` -> false (no matchea `[2-9]\d{9}`), y
- **la capa laxa por largo TAMBIEN falla** (`TOO_LONG`, 11 != 10).

Esto explica los 11/12 rechazos del export de Bitrix y define el fix: **quitar
el 1 post-52 ANTES de validar**. Es seguro porque `[2-9]\d{9}` garantiza que
ningun nacional MX real empieza con 1, asi que un 11-digitos-con-1 tras +52
solo puede ser el formato legacy. `alta-logica.js` ya hace exactamente esto
para el caso +1 de 11 digitos; falta el espejo +521 en el punto donde se
normaliza para validar/guardar. **[inferencia sobre el fix; los patrones son
textuales de la metadata]**

**WhatsApp y +521**: la doc vigente de Cloud API ya no documenta el detalle
Argentina/Mexico mas alla de la frase citada en la seccion 2 ("the extra added
prefix (...) may be modified by the Cloud API"): Meta acepta ambas formas y
normaliza el prefijo el mismo. Para links wa.me, la experiencia comun es que
`521XXXXXXXXXX` y `52XXXXXXXXXX` resuelven al mismo chat, pero NO encontre
doc primaria de Meta que lo afirme para wa.me: tratarlo como no garantizado y
emitir siempre `52` + 10 digitos, que es la forma canonica post-2019.
**[inferencia marcada; sin fuente primaria para el caso wa.me]**

## 4. Exigir tipo MOBILE: no viable en este mercado

- libphonenumber (FAQ.md): "SMSs can be sent to MOBILE or FIXED_LINE_OR_MOBILE
  numbers"; y para MX/AR: "Certain countries' mobile and/or fixed line ranges
  may overlap or too granular, which may make accurate identification
  impossible. Eg: Argentina and Mexico." Mexico regresa FIXED_LINE_OR_MOBILE
  "at higher level".
- intl-tel-input (doc de utils): "In some countries (e.g. the US) there's no
  way to differentiate between fixed-line and mobile numbers, so in those
  cases it will return FIXED_LINE_OR_MOBILE." Su opcion `allowedNumberTypes`
  por default es `["MOBILE", "FIXED_LINE"]`, y al pasar `["MOBILE"]`
  "FIXED_LINE_OR_MOBILE is automatically included - so countries like the US
  (where the two can't be told apart) still match correctly".

Conclusion: en los DOS mercados principales del cotizador (MX y NANP) el tipo
no es distinguible; exigir MOBILE estricto solo generaria falsos rechazos sin
atrapar nada. Nadie de las fuentes consultadas recomienda exigirlo para flujos
de WhatsApp; deteccion de tipo confiable existe solo como servicio de paga con
datos de carrier (Twilio Line Type Intelligence). **[la conclusion es
inferencia; las citas son textuales]**

## 5. Patrones de UI recomendados (autores de intl-tel-input, docs oficiales)

De `site/src/docs/markdown/best_practices.md` y el ejemplo oficial de
validacion (repo jackocnr/intl-tel-input):

- **Selector de pais** con `initialCountry` fijo si conoces al usuario (aqui:
  `"mx"`), o lookup por IP si no. Placeholder de ejemplo por pais
  (`getExampleNumber`).
- **Guardar y restaurar en E.164**: "Since the dial code is embedded in the
  number (e.g. "+17024181234"), you don't need to store the country
  separately." Restaurar pasando el E.164 como valor inicial: la libreria
  deduce el pais.
- **strictMode encendido con feedback visible**: rechaza caracteres no
  numericos y capa el largo maximo del pais MIENTRAS se teclea, con animacion
  de rechazo ("the rejection shouldn't be silent"). Esto convierte gran parte
  de la validacion en prevencion.
- **Formato as-you-type** (`formatAsYouType` / `utils.formatNumberAsYouType`).
- **Momento de validar** (ejemplo oficial `validation/display_code.js`): la
  validacion se ENCIENDE en blur y en submit; una vez visible, se re-evalua en
  cada `input` (para que el error desaparezca en cuanto el usuario lo
  corrige). Nunca valida keystroke-a-keystroke antes del primer blur.
- **Mensajes especificos por codigo de error** via `getValidationError`:
  mapear `TOO_SHORT` / `TOO_LONG` / `INVALID_COUNTRY_CODE` a textos propios
  ("Mapping the error codes to user-facing messages is left to you because the
  wording belongs to your app"), con default "Invalid number".
- **utils.js en diferido**: "~260KB on top of the ~30KB core (...) Lazy load
  utils on demand (recommended)" via `loadUtils` con `import()` - exactamente
  el patron que ya usa `public/js/mayoreo.js`.

## Recomendacion aplicada al cotizador

**Mantener:**

- La validacion por largo de #175 como capa dura sincrona: coincide con la
  recomendacion oficial de los autores de la libreria (largo = lo unico
  estable). El caso Aruba (+297, 7 digitos) queda cubierto por la rama "Otro"
  de 8-15 digitos totales.
- El patron de dos capas de mayoreo.js (laxa sincrona + utils.js diferido)
  como base para el alta interna, tal como propone #176.
- Aviso y confirmacion, nunca bloqueo, para la capa estricta: respaldado por
  la advertencia oficial de metadata que caduca (seccion 1) y por los 11
  numeros +521 reales del export de Bitrix.
- El backstop del server que registra sin rechazar: consistente con "Don't
  store properties for a phone number such as validity (...) check again when
  you need it" (FALSEHOODS.md).

**Corregir / agregar:**

1. **Normalizar +521 antes de validar y de guardar** (quitar el "1" cuando a
   `+52` le siguen 11 digitos y el primero es 1). Elimina 11 de los 12 falsos
   rechazos medidos y produce el E.164 canonico que quieren wa.me y la Cloud
   API. Bajo costo, cero ambiguedad (seccion 3).
2. En la capa estricta de #176, usar como criterio del AVISO
   `getValidationError` / la validacion por largo del utils.js, y tratar el
   veredicto de `isValidNumberPrecise` como informativo secundario (o no
   usarlo): con utils.js vendoreado y sin script de actualizacion, la precisa
   degrada sola con el tiempo. Si se quiere conservar, acompanar el aviso con
   el motivo ("posible numero invalido segun catalogo [fecha de la copia]").
3. **Endurecer +52 sin romper legacy**: tras normalizar el 1, se puede exigir
   ademas que el primer digito nacional sea 2-9 (regla estructural estable de
   MX, `[2-9]\d{9}`). Atrapa capturas basura tipo "1234567890" u "0..." que el
   puro largo deja pasar. Mantenerlo como parte de la capa dura es razonable
   porque es la misma regla desde 2019; si se prefiere maxima prudencia,
   dejarlo en la capa de aviso. **[inferencia]**
4. `telefonoValido` (la funcion espejo que solo mira largo) debe delegar en la
   misma tabla de reglas por codigo que ya usa el mensaje de error de #175, no
   mantener una segunda verdad; un +52 de 8 digitos debe fallar ahi tambien.
   (Debilidad ya conocida; esta investigacion no encontro razon para
   conservarla.)
5. **No exigir tipo MOBILE** (seccion 4). **No comprar verificacion** (OTP /
   Twilio Lookup) para este flujo: el primer WhatsApp del vendedor verifica
   alcanzabilidad mejor y gratis; reservar lookup de paga solo si algun dia un
   flujo automatizado envia mensajes sin humano en el loop. **[inferencia]**
6. En UI del alta interna, adoptar del ejemplo oficial: validar on-blur +
   on-submit (no antes del primer blur), re-evaluar en cada input una vez
   mostrado el error, y mensajes por codigo (`TOO_SHORT` -> "Faltan digitos
   para +52 (van N de 10)", etc.). Placeholder con numero de ejemplo del pais
   seleccionado.

## Fuentes consultadas

- google/libphonenumber - FAQ.md:
  https://github.com/google/libphonenumber/blob/master/FAQ.md
- google/libphonenumber - FALSEHOODS.md:
  https://github.com/google/libphonenumber/blob/master/FALSEHOODS.md
- google/libphonenumber - PhoneNumberUtil.java (javadoc de isValidNumber /
  isPossibleNumberWithReason):
  https://github.com/google/libphonenumber/blob/master/java/libphonenumber/src/com/google/i18n/phonenumbers/PhoneNumberUtil.java
- google/libphonenumber - PhoneNumberMetadata.xml (territorio MX):
  https://github.com/google/libphonenumber/blob/master/resources/PhoneNumberMetadata.xml
- intl-tel-input - docs de utils (isValidNumber vs isValidNumberPrecise,
  carga diferida): repo jackocnr/intl-tel-input,
  site/src/docs/markdown/utils.md (publicado en
  https://intl-tel-input.com/docs; el sitio devuelve 403 a fetchers, se
  consulto el markdown fuente en el repo)
- intl-tel-input - best practices:
  site/src/docs/markdown/best_practices.md (mismo repo)
- intl-tel-input - ejemplo oficial de validacion (triggers blur/submit/input)
  y advertencia sobre validacion precisa:
  site/src/examples/vanilla-javascript/validation/display_code.js y
  site/src/examples/vanilla-javascript/validation-precise/desc.html
- Meta / WhatsApp Cloud API - formatos de numero de usuario (plus sign,
  country code, nota Brasil/Mexico):
  https://developers.facebook.com/docs/whatsapp/cloud-api/reference/phone-numbers/
- WhatsApp - FAQ de click to chat (wa.me):
  https://faq.whatsapp.com/5913398998672934 (pagina JS-rendered; texto
  verificado contra la copia archivada de la misma URL)
- Twilio - Lookup v2: https://www.twilio.com/docs/lookup/v2-api
- Stripe - Collect customer phone numbers (Checkout):
  https://docs.stripe.com/payments/checkout/phone-numbers
- IFT - Comunicado 34/2019 (marcacion a 10 digitos desde 3-ago-2019,
  eliminacion de 01/044/045):
  https://www.ift.org.mx/comunicacion-y-medios/comunicados-ift/es/partir-del-3-de-agosto-mexico-tendra-una-nueva-forma-de-marcacion-telefonica-comunicado-342019-16-de
  (PDF: https://www.ift.org.mx/sites/default/files/comunicado_34_ift.pdf)
