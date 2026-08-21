# Sincronización de contactos comerciales hacia Contactos de Google (`pppeltre@gmail.com`)

**Fecha de investigación:** 2026-08-20
**Alcance:** OAuth 2.0 de Google para una cuenta Gmail personal (sin Workspace), Google People API v1, formato de teléfono para Android/WhatsApp en México, importación manual por CSV/vCard, y elección de cliente Node.
**Contexto técnico asumido:** Express monolítico en Render (plan Starter, **una sola instancia**, no duerme), ES modules, sin bundler, Neon Postgres como fuente de verdad, precedente de OAuth con refresh token en variables de entorno (`lib/dropbox.js`), unos cientos de contactos con teléfono mexicano, un único usuario final de Google (`pppeltre@gmail.com`), código ASCII estricto.

> **Nota sobre este documento.** Sigue la convención de `docs/research/` establecida en `formulario-mayoreo-captura.md`. Todo dato con URL fue verificado contra la fuente primaria en la fecha indicada. Lo que **no** se pudo verificar contra fuente primaria está marcado con **[NO VERIFICADO]**. Las mediciones propias (instalaciones de npm, descargas, documento de descubrimiento en vivo) están en el apéndice §9 con los comandos para reproducirlas. Los puntos que se resolvieron después, al ejecutarlos contra la cuenta real, quedan marcados **VERIFICADO EN VIVO** con su fecha. A diferencia del código, este archivo sí lleva acentos.

---

## 1. Resumen ejecutivo — qué adoptar exactamente

| Área | Decisión recomendada |
|---|---|
| **Estado de publicación de la app OAuth** | **"In production" desde el primer día.** Nunca dejarla en "Testing": ahí el refresh token muere a los 7 días. En producción y sin verificar, el token no tiene caducidad por estado de publicación. |
| **Verificación de Google** | **No solicitarla.** Cae en el caso documentado "app for your personal use (fewer than 100 users)". El costo es una pantalla de "app no verificada" que Adrián acepta **una sola vez**, y un tope de 100 usuarios nuevos que jamás se alcanzará con 1 usuario. |
| **Scope** | `https://www.googleapis.com/auth/contacts`. **No existe un scope de escritura más acotado**: verificado en el documento de descubrimiento en vivo, los 7 métodos de escritura exigen exactamente ese scope. Es **sensible**, no restringido (no aparece en la lista de restringidos). |
| **Proyecto de Google Cloud** | Créalo con la misma cuenta `pppeltre@gmail.com`. La doc de People API lo permite explícitamente: "You need a Google Account in order to create a project". |
| **Cliente Node** | **REST directo con `fetch`**, calcado de `lib/dropbox.js`. `googleapis` pesa **233 MB** de `node_modules`; `@googleapis/people` pesa 19 MB. Para 7 endpoints y un refresh de token, ninguna de las dos se paga sola. |
| **Escritura por lote** | `people:batchCreateContacts` (≤200) y `people:batchUpdateContacts` (≤200, exige `etag` por contacto). `batchDeleteContacts` acepta ≤500. **Secuencial, nunca en paralelo** (advertencia explícita de Google en cada método). |
| **Marca de origen** | **`userDefined`** (clave `origen` / valor `cotizador:<id>`) como marca **visible y exportable**, y **membresía a un grupo propio** ("Clientes cotizador") como filtro operativo. `clientData` es la alternativa invisible pero no está expuesta en el CSV ni documentada como aislada por app. Detalle y trade-off en §4.5. |
| **Búsqueda por teléfono** | `people:searchContacts` **sí** indexa `phoneNumbers`, pero con **prefijo** y sobre un **caché perezoso** que exige una petición de calentamiento y esperar unos segundos. **No sirve como llave de deduplicación.** Usar `connections.list` con `syncToken` y mantener el índice local en Neon. |
| **Deduplicación / mapeo** | Tabla propia en Neon: `telefono_e164 -> resourceName + etag`. Es la única llave confiable; el `resourceName` es de Google y el `etag` es obligatorio para actualizar. |
| **Sincronización incremental** | `connections.list?requestSyncToken=true` y guardar `nextSyncToken`. **Caduca a los 7 días**; el código debe manejar `EXPIRED_SYNC_TOKEN` cayendo a sync completo. |
| **Formato del teléfono** | **`+52 1 55 XXXX XXXX`** (con el "1"). Ver §6 — esto **contradice** el supuesto que traía el proyecto. |
| **Prueba reversible previa** | Importar un CSV con la plantilla oficial de Google (≤3,000 filas), verificar en el Android, y si algo sale mal usar **Configuración > Deshacer cambios** (ventana de 30 días). |

### 1.1 Tres hallazgos que cambian el diseño

**(a) Los 7 días son reales, pero el diagnóstico habitual es equivocado.** No es "los refresh tokens de Google caducan a los 7 días": es que **el estado de publicación "Testing" caduca las autorizaciones a los 7 días**. Google lo dice sin ambigüedad y añade que la excepción (no caducar) solo aplica a apps que piden únicamente nombre, correo y perfil — que no es nuestro caso. La salida no es renovar el token cada semana ni pedir verificación: es **publicar la app**. Publicar es un botón, no un trámite. Detalle en §2 y §3.

**(b) WhatsApp sigue exigiendo el "1" después del +52 para México, hoy.** El Centro de Ayuda oficial de WhatsApp, verificado el 2026-08-20 en la página que trata precisamente de **guardar contactos en la libreta del teléfono**, dice literalmente: *"Phone numbers in Mexico (country code \"52\") need to have \"1\" after \"+52\", even if they're Nextel numbers."* El proyecto asumía que ese "1" había desaparecido con la reforma de numeración de 2019. **No desapareció en la documentación de WhatsApp.** Consecuencias y el matiz de Android en §6.

**(c) `searchContacts` no sirve para lo que uno querría usarlo.** Es tentador buscar el contacto por teléfono antes de crearlo. La doc oficial advierte que la búsqueda corre sobre un caché perezoso que hay que calentar con una petición de query vacía y **esperar unos segundos** (el ejemplo oficial en Java literalmente hace `Thread.sleep(5)`), que hace **prefijo**, y que el `pageSize` se topa en 30. Además, las escrituras tardan **varios minutos** en propagarse a las lecturas de sincronización. El diseño tiene que mantener su propio índice; la API no es la fuente de verdad del mapeo.

---

## 2. Pregunta 1 — Caducidad del refresh token

### 2.1 Los 7 días: qué dice exactamente Google

La afirmación existe y está en dos lugares independientes de la documentación primaria.

**Fuente 1 — [Using OAuth 2.0 to Access Google APIs](https://developers.google.com/identity/protocols/oauth2), sección "Refresh token expiration":**

> *"A Google Cloud Platform project with an OAuth consent screen configured for an external user type and a publishing status of 'Testing' is issued a refresh token expiring in 7 days"*

**Fuente 2 — [Manage App Audience](https://support.google.com/cloud/answer/15549945), sección "Publishing status > Testing":**

> *"Authorizations by a test user will expire seven days from the time of consent. If your OAuth client requests an `offline` access type and receives a refresh token, that token will also expire."*

**Es cierto. Y es una propiedad del estado "Testing", no del refresh token de Google.**

La misma página documenta la **única** excepción, y hay que leerla con cuidado porque no nos salva:

> *"The only exception to this behavior is if your app requests a subset of the following: name, email address, and user profile (through the `userinfo.email`, `userinfo.profile`, `openid` scopes or their OpenID Connect equivalents). For such requests, your users do not need to be in the trusted user list, they will not see a warning message, and their authorizations will not expire after 7 days. [...] If your app requests any other OAuth scopes, then this exception does not apply."*

`auth/contacts` es "any other OAuth scope". Con la app en Testing, el token muere cada 7 días **sin excepción posible**.

### 2.2 ¿Cambia si la app está "In production"? Sí, y esa es la solución

La página de Manage App Audience describe el estado "In production" así:

> *"Projects configured with a publishing status of `In production` are available to any user with a Google Account. A project's publishing status is considered In production after selecting the Publish app button."*

**No hay ninguna cláusula de caducidad de autorizaciones para "In production".** La regla de los 7 días está escrita exclusivamente bajo "Testing", en ambas fuentes. Pasar a producción es pulsar "Publish app" — no requiere aprobación de nadie (§3).

### 2.3 Todas las causas documentadas de caducidad de un refresh token

De [Refresh token expiration](https://developers.google.com/identity/protocols/oauth2), lista completa:

| Causa | Verbatim | ¿Nos aplica? |
|---|---|---|
| Revocación por el usuario | *"The user has revoked your app's access"* | Sí, pero es acción deliberada de Adrián. |
| **Inactividad de 6 meses** | *"The refresh token has not been used for six months."* | Sí en teoría. Irrelevante si el sync corre a diario. |
| Cambio de contraseña **con scopes de Gmail** | *"The user changed passwords and the refresh token contains Gmail scopes."* | **No.** `auth/contacts` no es un scope de Gmail. Un cambio de contraseña de `pppeltre@gmail.com` **no** debería tumbar el token. |
| Tope de refresh tokens vivos | *"The user account has exceeded a maximum number of granted (live) refresh tokens."* — el límite documentado es de **100 refresh tokens por cuenta de Google por client ID de OAuth 2.0** | Sí, pero solo si el script de autorización se corre 100+ veces. Al pasar el tope, el más viejo se invalida en silencio. |
| Acceso con caducidad concedida por el usuario | *"The user granted time-based access to your app and the access expired."* | Solo si Adrián elige acceso temporal en la pantalla de consentimiento. |
| Política de administrador | *"If an admin set any of the services requested in your app's scopes to Restricted"* | **No.** Cuenta Gmail personal, sin administrador. |
| Duración de sesión de GCP | *"For Google Cloud Platform APIs — the session length set by the admin could have been exceeded."* | **No.** Sin organización. |

**Conclusión operativa.** Con la app publicada y el sync corriendo con regularidad, la única causa realista de muerte del token es una revocación deliberada. Aun así, el módulo debe tratar el fallo del refresh como un estado esperado: registrar el error y avisar, no reintentar en bucle. El precedente de `lib/dropbox.js` (lanzar con el cuerpo del error) es exactamente la forma correcta.

**Detalle no obvio para el diseño:** el refresh de Google, a diferencia de Dropbox, **puede** devolver un `refresh_token` nuevo. La documentación no promete que el refresh token sea estable de por vida. Si la respuesta del token endpoint trae `refresh_token`, hay que persistirlo. Con el token en una variable de entorno de Render eso no es posible en caliente — ver §8.3.

---

## 3. Pregunta 2 — Publicar la app y el scope de contactos

### 3.1 `auth/contacts` es **sensible**, no restringido

La [lista oficial de scopes restringidos](https://support.google.com/cloud/answer/13464325) enumera todos, agrupados por API: Gmail API, Google Drive API, Google Fit API, Google Chat API, Data Portability API, Photos Ambient API y Google Health API. **Ningún scope de People API ni de Contacts aparece en esa lista.**

La distinción importa por una razón concreta, de la [página de verificación de scopes restringidos](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification):

> *"Every app that requests access to Google users' restricted data and has the ability to access data from or through a third-party server must go through a security assessment from Google-empanelled security assessors."*

Esa evaluación (CASA, vía App Defense Alliance) es cara y anual. **No aplica a `auth/contacts`.** Si el scope fuera restringido, este proyecto sería inviable tal como está planteado; no lo es.

Que sea *sensible* sí implica algo: la [página de scopes](https://developers.google.com/identity/protocols/oauth2/scopes) dice *"Sensitive scopes require review by Google and have a sensitive indicator on the Google Cloud Console's OAuth consent screen configuration page"*, y la [FAQ de verificación](https://support.google.com/cloud/answer/9110914) que *"Apps that request access to scopes categorized as sensitive or restricted must complete Google's OAuth app verification"*. Esa exigencia tiene excepciones explícitas, y caemos en la primera.

### 3.2 Se puede publicar sin verificación — está documentado como caso normal

[When is verification not needed](https://support.google.com/cloud/answer/13464323) lista cinco casos. El primero es literalmente el nuestro:

> *"If the app is for your personal use (**fewer than 100 users**)"*

Y [Unverified apps](https://support.google.com/cloud/answer/7454865) lo repite desde el otro lado: *"You need to go through verification before you launch a user-facing app."* Un sync de contactos que solo autoriza el dueño de la cuenta no es una app de cara al usuario.

**Consecuencias exactas de publicar sin verificar** (verbatim de las mismas páginas):

1. **Pantalla de "app no verificada"** antes del consentimiento: *"The app or script might display an 'unverified app' screen before it displays the consent screen."* Se acepta una vez, en el script local de autorización. Nunca se vuelve a ver.
2. **Tope de usuarios**: *"Apps that present the unverified app screen to users — 100 new users in total, after the app presents the unverified app screen"*, y — dato importante — *"The user cap applies over the entire lifetime of the project, and it cannot be reset or changed."* Con un usuario, sobra por dos órdenes de magnitud.
3. **Security Checkup** puede marcar la app como riesgosa en la cuenta de Google. Cosmético.

### 3.3 "Usuario de prueba listado" vs. "publicar": no son equivalentes

| | Testing (usuario de prueba listado) | In production sin verificar |
|---|---|---|
| Quién puede autorizar | Solo los ≤100 correos en la lista | Cualquier cuenta de Google |
| Pantalla de advertencia | Sí (aviso de acceso de prueba) | Sí (pantalla de app no verificada) |
| **Caducidad de la autorización** | **7 días** | **Ninguna documentada** |
| Tope | 100 usuarios de prueba | 100 usuarios nuevos, de por vida del proyecto |
| Trámite | Ninguno | Pulsar "Publish app" |

La tentación es dejarla en Testing "porque es solo para nosotros". Es exactamente la decisión equivocada: da el mismo aviso al usuario, con las mismas advertencias, y añade una bomba de tiempo semanal. **Publicar es estrictamente mejor.**

Requisito administrativo a tener presente: la [configuración del consentimiento](https://support.google.com/cloud/answer/10311615) dice *"These links are required for all external production apps"* refiriéndose a homepage, política de privacidad y términos, y aclara que sin ellos *"You will not be able to submit your app for verification"*. La exigencia está atada a **someter a verificación**, no a publicar. **VERIFICADO EN VIVO el 2026-08-21** (issue #225, cuenta `pppeltre@gmail.com`): el cambio a producción **no** exigió homepage, política de privacidad ni términos. La app quedó en `Estado de publicación: En producción` / `Tipo de usuario: Usuarios externos` sin enviar nada a revisión, confirmando que la exigencia de esos enlaces está atada a someter a verificación y no a publicar.

Lo que sí ocurre al publicar es que la consola lleva al **Centro de verificación**, que muestra en rojo *"Se requiere la verificación porque tu app solicita permisos sensibles o restringidos"* y *"Tu app requiere una verificación"*. Tiene tono de bloqueo y no lo es: describe los requisitos para **solicitar** la verificación, un camino en el que este proyecto no entra. El criterio real de éxito es lo que diga **Audience**, no el semáforo del Centro de verificación. Detalle en el hilo de #225.

### 3.4 ¿La misma cuenta Gmail puede crear el proyecto? Sí

De [Get ready to use the People API](https://developers.google.com/people/v1/getting-started):

> *"You need a Google Account in order to create a project in the Google API Console."*

No dice "cuenta de Workspace". La [guía de creación de proyecto de Workspace](https://developers.google.com/workspace/guides/create-project) sí menciona organizaciones, pero ese requisito aplica al tipo de usuario **Internal** ("Projects associated with a Google Cloud Organization can configure Internal users"), que no es nuestro caso: nosotros usamos **External + In production**, que es la ruta para cuentas personales.

**[NO VERIFICADO]** si habilitar People API exige activar facturación. La página de getting-started no menciona facturación en absoluto, y la guía de Workspace solo dice *"Depending on the Google Workspace APIs and features that you want to use, you might also need to enable billing"*. No encontré ninguna tabla de precios que liste People API como servicio facturable. Lo prudente es asumir que **no** hace falta tarjeta y comprobarlo al habilitar la API.

### 3.5 ¿Existe un scope de escritura más acotado? No

Esta la verifiqué **en vivo** contra el documento de descubrimiento de la API (revisión `20260819`), que es la definición de la que se generan todas las bibliotecas cliente:

| Método | Scopes aceptados |
|---|---|
| `people:createContact` | `auth/contacts` |
| `people:batchCreateContacts` | `auth/contacts` |
| `people:batchUpdateContacts` | `auth/contacts` |
| `people:batchDeleteContacts` | `auth/contacts` |
| `{resourceName}:updateContact` | `auth/contacts` |
| `{resourceName}:deleteContact` | `auth/contacts` |
| `contactGroups.create` / `contactGroups.members.modify` | `auth/contacts` |
| `people:searchContacts` | `auth/contacts` **o** `auth/contacts.readonly` |
| `otherContacts.list` / `otherContacts.search` | `auth/contacts.other.readonly` |

Los otros scopes del catálogo, con su descripción oficial ([lista de scopes](https://developers.google.com/identity/protocols/oauth2/scopes), sección People API v1):

| Scope | Descripción oficial | ¿Sirve para escribir? |
|---|---|---|
| `auth/contacts` | "See, edit, download, and permanently delete your contacts" | **Sí — el único** |
| `auth/contacts.readonly` | "See and download your contacts" | No |
| `auth/contacts.other.readonly` | "See and download contact info automatically saved in your \"Other contacts\"" | No |
| `auth/directory.readonly` | "See and download your organization's Google Workspace directory" | No, y además requiere Workspace |
| `auth/user.phonenumbers.read` | "See and download your personal phone numbers" | No — son los del **titular de la cuenta**, no sus contactos |
| `auth/user.addresses.read`, `user.emails.read`, `user.birthday.read`, `user.gender.read`, `user.organization.read` | datos del propio perfil | No |

**No hay forma de pedir menos.** El scope que necesitamos incluye "permanently delete your contacts", y eso es lo que Adrián verá en la pantalla de consentimiento. Vale la pena que lo sepa de antemano: **la app puede borrar todos sus contactos** si el código se equivoca. Es un argumento fuerte a favor de que el módulo nunca invoque `batchDeleteContacts` ni `deleteContact` en absoluto (§8.4).

---

## 4. Pregunta 3 — People API: mecánica de escritura por lote

Endpoint base verificado en vivo: `https://people.googleapis.com/`. Todo lo de esta sección proviene de [la referencia REST](https://developers.google.com/people/api/rest/v1/people) y de la guía [Read and Manage Contacts](https://developers.google.com/people/v1/contacts).

### 4.1 Tabla de métodos

| Método | HTTP + path | Tope por llamada | Parámetros obligatorios | Consumo de cuota declarado |
|---|---|---|---|---|
| `createContact` | `POST v1/people:createContact` | 1 | — (`personFields` opcional) | 1 lectura crítica · 1 escritura crítica · 1 Daily Contact Write |
| `batchCreateContacts` | `POST v1/people:batchCreateContacts` | **200 contactos** | `contacts[]`, **`readMask`** | 6 lecturas críticas · 6 escrituras críticas · **200 Daily Contact Writes** |
| `updateContact` | `PATCH v1/{resourceName}:updateContact` | 1 | **`updatePersonFields`**, `person.metadata.sources.etag` | 1 · 1 · 1 |
| `batchUpdateContacts` | `POST v1/people:batchUpdateContacts` | **200 contactos** | `contacts{}`, **`updateMask`**, **`readMask`**, `etag` por contacto | 6 · 6 · **200** |
| `deleteContact` | `DELETE v1/{resourceName}:deleteContact` | 1 | — | 1 Write request |
| `batchDeleteContacts` | `POST v1/people:batchDeleteContacts` | **500 resourceNames** | `resourceNames[]` | 10 Write requests |
| `connections.list` | `GET v1/{resourceName=people/*}/connections` | `pageSize` 1–1000 (default 100) | **`personFields`** | no declarado en la guía |
| `searchContacts` | `GET v1/people:searchContacts` | `pageSize` **tope 30** (default 10) | `query`, **`readMask`** | no declarado |
| `otherContacts.list` | `GET v1/otherContacts` | `pageSize` 1–1000 | **`readMask`** (limitado) | no declarado |
| `contactGroups.create` | `POST v1/contactGroups` | 1 | `contactGroup.name` | no declarado |
| `contactGroups.members.modify` | `POST v1/{resourceName}/members:modify` | **1000** (suma de add + remove) | `resourceNamesToAdd` / `...ToRemove` | no declarado |

**Lo más importante de esta tabla no son los topes, es esta advertencia**, repetida textualmente en **cada uno** de los métodos de mutación:

> *"Mutate requests for the same user should be sent sequentially to avoid increased latency and failures."*

Con un solo usuario de Google, eso significa: **cero concurrencia en todo el sync**. Nada de `Promise.all` sobre lotes. Es una restricción de diseño, no una sugerencia de rendimiento.

### 4.2 Cuotas

La guía declara el **consumo** por petición en tres cubetas nombradas — "Critical read requests (Contact and Profile Reads)", "Critical write requests (Contact Creates and Updates)" y "Daily Contact Writes (Total)" — pero **no publica los límites numéricos de esas cubetas en ninguna página de la documentación**. Verifiqué que `developers.google.com/people/v1/quota` y `/people/v1/limits` devuelven 404: no existe una página de cuotas de People API.

**[NO VERIFICADO]** los valores numéricos de las tres cuotas. Solo son visibles en la página "Quotas & System Limits" del proyecto en la consola de Google Cloud, que no puedo consultar sin la cuenta. Es lo primero que hay que mirar al crear el proyecto.

Lo que sí se puede razonar con lo publicado: un `batchCreateContacts` de 200 contactos consume **200 Daily Contact Writes**, o sea la cubeta diaria se mide **por contacto escrito, no por petición**. Con "unos cientos" de contactos, la carga inicial completa consume unos cientos de unidades de esa cubeta en un día. Es el momento de mayor riesgo de topar la cuota diaria, y es un argumento para **partir la carga inicial en varios días** o al menos para que el código sepa detenerse limpiamente y retomar.

Manejo de errores de tasa: la guía de Drive ([Resolve errors](https://developers.google.com/workspace/drive/api/guides/handle-errors)) documenta `403 rateLimitExceeded` ("the project's rate limit has been reached") y `429 rateLimitExceeded` ("the user has sent too many requests in a given amount of time"), y recomienda en ambos *"use exponential backoff to retry the request"*. **[NO VERIFICADO]** que esa página aplique literalmente a People API — está titulada para Drive; es el patrón estándar de las APIs de Workspace pero no encontré la versión específica de People API.

### 4.3 `etag`: el mecanismo de concurrencia optimista

`Person.etag` es *"The HTTP entity tag of the resource. Used for web cache validation."*

Para actualizar, [la guía](https://developers.google.com/people/v1/contacts) es explícita:

> *"To update an existing contact, you must include the `person.metadata.sources.etag` field in the person for the contact to be updated to make sure the contact has not changed since your last read."*

Y [`updateContact`](https://developers.google.com/people/api/rest/v1/people/updateContact) define qué pasa si está viejo:

> *"The server returns a 400 error with reason `\"failedPrecondition\"` if `person.metadata.sources.etag` is different than the contact's etag, which indicates the contact has changed since its data was read. Clients should get the latest person and merge their updates into the latest person. If making sequential updates to the same person, the etag from the updateContact response should be used to avoid failures."*

**Tres consecuencias de diseño:**

1. El etag obsoleto da **400, no 409**. Un manejador de errores que solo mire el código HTTP no distinguirá "etag viejo" de "payload malformado". Hay que leer `reason: "failedPrecondition"` del cuerpo. Esto es la misma lección que `#194` y que la trampa documentada del PUT de Operam: **el código de estado no es el diagnóstico**.
2. El etag correcto para el segundo update **viene en la respuesta del primero**, no de un GET nuevo. Ahorra media docena de lecturas por contacto.
3. Un etag obsoleto significa que **alguien editó ese contacto fuera del cotizador** — Adrián desde el teléfono, típicamente. La respuesta correcta no es pisar: es releer, fusionar y, si el campo que íbamos a escribir ya tiene un valor humano, **respetarlo**. Es el mismo criterio que `#186` ("solo si estaba en Sin segmento").

Otros 400 documentados de `updateContact`, todos silenciosos si no se leen:

- *"The server returns a 400 error if `person.metadata.sources` is not specified for the contact to be updated or if there is no contact source."*
- *"The server returns a 400 error if memberships are being updated and there are no contact group memberships specified on the person."*
- *"The server returns a 400 error if more than one field is specified on a field that is a singleton for contact sources: `biographies` `birthdays` `genders` `names`"*

Ese último es una trampa real: **`names` es singleton**. No se pueden mandar dos nombres.

### 4.4 `readMask` / `updateMask` / `personFields`: tres máscaras que no son la misma

| Máscara | Dónde | Qué hace | Trampa |
|---|---|---|---|
| `readMask` | `batchCreate`, `batchUpdate`, `searchContacts`, `otherContacts.list` | qué campos devuelve la lectura posterior a la mutación | *"If read mask is left empty, the post-mutate-get is skipped and no data will be returned in the response."* — **vaciarla es la forma de ahorrar la lectura**, y también la forma de quedarse sin los `resourceName` y `etag` nuevos |
| `updateMask` / `updatePersonFields` | `batchUpdate` / `updateContact` | qué campos **se reemplazan** | *"All fields specified in the updateMask will be replaced."* Reemplaza, no fusiona: mandar `phoneNumbers` con un solo número **borra los demás teléfonos** de ese contacto |
| `personFields` | `updateContact`, `connections.list`, `get` | qué campos devuelve la lectura | En `connections.list` es **obligatorio** |
| `sources[]` | todos | qué fuentes leer | *"Defaults to `READ_SOURCE_TYPE_CONTACT` and `READ_SOURCE_TYPE_PROFILE` if not set."* |

Valores válidos de `updatePersonFields` (lista completa y literal): `addresses`, `biographies`, `birthdays`, `calendarUrls`, **`clientData`**, `emailAddresses`, `events`, `externalIds`, `genders`, `imClients`, `interests`, `locales`, `locations`, `memberships`, `miscKeywords`, `names`, `nicknames`, `occupations`, `organizations`, `phoneNumbers`, `relations`, `sipAddresses`, `urls`, **`userDefined`**.

**`clientData` y `userDefined` son escribibles.** Eso responde la mitad de la pregunta 3(a).

### 4.5 Marcar un contacto como "creado por nuestro sistema"

Cuatro candidatos, con su definición literal del recurso `Person`:

| Campo | Definición oficial | Forma | Visible en la UI de Contactos |
|---|---|---|---|
| `clientData[]` | *"Arbitrary client data that is populated by clients. Duplicate keys and values are allowed."* | `{key, value}` | **[NO VERIFICADO]** — no aparece en la plantilla CSV ni en el exportador |
| `userDefined[]` | *"Arbitrary user data that is populated by the end users."* | `{key, value}` | **Sí** — la plantilla CSV oficial tiene `Custom Field <n> - Label` / `- Value` |
| `externalIds[]` | *"An identifier from an external entity related to the person."* — `type` puede ser custom o `account`, `customer`, `loginId`, `network`, `organization` | `{value, type}` | **[NO VERIFICADO]** |
| `memberships[]` (grupo) | *"A person's membership in a group. Only contact group memberships can be modified."* | referencia a `contactGroups/{id}` | **Sí** — son las "Etiquetas" de Google Contactos |

**Recomendación: usar los dos que son visibles, y usarlos para cosas distintas.**

- **Grupo/etiqueta propio** ("Clientes cotizador"), creado una vez con `contactGroups.create`. Es el mecanismo idiomático para *segmentar*: es lo que Google Contactos llama "Etiqueta", lo que aparece en el menú lateral, lo que se puede filtrar y exportar desde la UI, y lo que el CSV de importación soporta nativamente con la columna `Labels` (valores múltiples separados por `:::`). **Es la respuesta a "no pisar contactos ajenos": si el contacto no está en nuestro grupo, no lo tocamos.**
- **`userDefined` con `key: "origen"`, `value: "cotizador:<id>"`**, para el identificador de origen por contacto. Sobrevive a la exportación CSV (`Custom Field 1 - Label` / `- Value`), es legible por un humano que abra el contacto en el teléfono, y es escribible por `updatePersonFields`.

**Por qué no `clientData` a pesar de que su nombre suene hecho a medida.** Su definición dice *"populated by clients"* y *"Duplicate keys and values are allowed"* — o sea, no hay unicidad ni aislamiento por aplicación documentado. Nada indica que otra app no pueda leerlo, escribirlo o duplicarlo. Y como no aparece en el exportador CSV ni en la plantilla de importación, **un dato guardado ahí es invisible para Adrián**: si el sync se rompe y hay que auditar a mano, no hay forma de verlo sin llamar a la API. Un identificador de origen que solo existe dentro del programa que lo escribió no es una marca de origen, es un detalle de implementación.

`externalIds` sería defendible (semánticamente es exactamente "un identificador de una entidad externa relacionada con la persona", y `type` acepta valores custom), pero su visibilidad en la UI no está documentada y no tiene columna en la plantilla CSV. Es una tercera opción razonable, no la primera.

**Restricción crítica de las membresías**, del recurso `ContactGroupMembership`:

> *"Any contact group membership can be removed, but only user group or \"myContacts\" or \"starred\" system groups memberships can be added. A contact must always have at least one contact group membership."*

Y de `contactGroups.members.modify`:

> *"The only system contact groups that can have members added are `contactGroups/myContacts` and `contactGroups/starred`."*

Traducido a diseño: cada contacto que creemos debe pertenecer a **`contactGroups/myContacts` Y a nuestro grupo**. Quitarle `myContacts` para dejarlo solo en el nuestro es exactamente el tipo de "optimización" que rompe la sincronización con el teléfono. **[NO VERIFICADO]** si Android sincroniza contactos fuera de `myContacts`; la documentación de Google no lo dice, pero el riesgo no vale la pena averiguarlo en producción. La respuesta de `members.modify` incluye `canNotRemoveLastContactGroupResourceNames[]`, señal de que el servidor defiende esa invariante activamente.

`contactGroups.create` tiene una restricción operativa a manejar: *"Created contact group names must be unique to the users contact groups. Attempting to create a group with a duplicate name will return a HTTP 409 error."* El código debe hacer `contactGroups.list` primero y crear solo si falta — un 409 al arrancar no debe tumbar el sync.

**[NO VERIFICADO]** el número máximo de grupos de contactos. No está documentado.

### 4.6 `searchContacts`: qué busca y por qué no confiar en él

Definición literal:

> *"The query matches on a contact's `names`, `nickNames`, `emailAddresses`, `phoneNumbers`, and `organizations` fields that are from the `CONTACT` source."*

**Sí busca por número de teléfono.** Pero tres advertencias del propio Google lo descalifican como llave:

1. **Caché perezoso.** De la referencia: *"IMPORTANT: Before searching, clients should send a warmup request with an empty query to update the cache."* De la guía, más explícito: *"Search uses a lazy cache that is updated after a request. Clients should first send a warmup search request with an empty query to make sure the cache has the latest data."* El ejemplo oficial en Java hace literalmente `Thread.sleep(5)` entre el calentamiento y la búsqueda real, con el comentario `// Wait a few seconds`. **La advertencia sobre "warm up the cache" es real y está en la fuente primaria.**
2. **Prefijo, no coincidencia.** *"Search does a prefix match of the query with the fields on a person. For example, a person with name \"foo name\" matches queries such as \"f\", \"fo\", \"foo\", \"foo n\", \"nam\", etc., but not \"oo n\"."* Buscar por los últimos 10 dígitos de un número guardado como `+525512345678` **no lo encontraría**.
3. **`pageSize` topado en 30.**

Y encima, de la guía de sincronización: *"Writes may have a propagation delay of several minutes for sync requests. Incremental syncs are not intended for read-after-write use cases."*

**Conclusión: el mapeo teléfono → `resourceName` vive en Neon, no en Google.** `searchContacts` sirve, a lo más, para una herramienta de diagnóstico manual.

### 4.7 Sincronización incremental con `syncToken`

`people.connections.list` soporta sync incremental:

| Aspecto | Verbatim |
|---|---|
| Cómo pedirlo | `requestSyncToken`: *"Whether the response should return `nextSyncToken` on the last page of results."* |
| Cómo usarlo | `syncToken`: *"A sync token, received from a previous response `nextSyncToken`"* |
| **Caducidad** | *"Sync tokens expire 7 days after the full sync."* |
| Error | *"A request with an expired sync token will get an error with an `google.rpc.ErrorInfo` with reason `'EXPIRED_SYNC_TOKEN'`. In the case of such an error clients should make a full sync request without a syncToken."* |
| Restricción | *"When the syncToken is specified, all other request parameters must match the first call."* |
| Orden | `sortOrder` default `LAST_MODIFIED_ASCENDING` |
| `pageSize` | *"Valid values are between 1 and 1000, inclusive. Defaults to 100 if not set or set to 0."* |

**Otro 7 en el diseño, y de nuevo no es el que uno esperaría.** Un sync semanal con `syncToken` está justo en el filo: si una corrida se salta un día, el token ya caducó. Con unos cientos de contactos, el sync completo (`pageSize=1000`, una o dos páginas) es tan barato que **la recomendación es correr sync completo siempre y usar `syncToken` solo como optimización oportunista** — nunca como la ruta principal cuyo fallo hay que manejar.

La restricción "all other request parameters must match the first call" es una trampa clásica: cambiar `personFields` en un despliegue invalida el token en silencio. Otra razón para no depender de él.

### 4.8 `otherContacts`: fuera de alcance

*"Contacts that are not in a contact group"*, *"typically auto created contacts from interactions"*. `readMask` limitado a `emailAddresses`, `metadata`, `names`, `phoneNumbers`, `photos`. Scope `auth/contacts.other.readonly`. Solo escritura posible: `copyOtherContactToMyContactsGroup`.

Además, la [ayuda de Google Contactos](https://support.google.com/contacts/answer/1069522) dice: *"If you're on an iPhone, iPad, or Android device, you won't see Other Contacts."* **No se sincronizan al teléfono**, así que son irrelevantes para el objetivo (que WhatsApp muestre nombres). Pedir ese scope añadiría una segunda casilla en la pantalla de consentimiento a cambio de nada. **No pedirlo.**

### 4.9 Límites duros de la cuenta de Contactos

De [I get a Contacts error](https://support.google.com/contacts/answer/148779):

> *"You can save up to 25,000 contacts or 20 MB with photos not included. For each contact, you can save up to: 128 KB · 1,024 characters per field (except \"Notes\") · 500 fields total"*

Con unos cientos de contactos sin foto, no hay riesgo. El límite de **1,024 caracteres por campo** sí importa si algún día se vuelca la razón social completa de Operam a `organizations` o notas largas a `biographies`.

---

## 5. Pregunta 4 — Formato del número telefónico

### 5.1 La People API no normaliza lo que escribes; sí calcula una forma canónica

Definición literal del objeto `PhoneNumber`:

```
value          string   "The phone number."
canonicalForm  string   "Output only. The canonicalized ITU-T E.164 form of the phone number."
type           string   home | work | mobile | homeFax | workFax | otherFax | pager |
                        workMobile | workPager | main | googleVoice | other  (o custom)
formattedType  string   "Output only. ..."
```

Tres hechos:

1. **`value` se guarda tal cual.** No hay documentación de que el servidor lo reescriba.
2. **`canonicalForm` existe, es E.164, y la produce el servidor** (`Output only`). O sea: Google sabe normalizar, pero guarda además lo que escribiste.
3. **[NO VERIFICADO]** qué hace el servidor con un número que no puede canonicalizar — si deja `canonicalForm` vacío, si rechaza la escritura, o si lo interpreta contra alguna región por defecto. La documentación no lo dice y no puedo probarlo sin credenciales. Es lo primero a medir en la prueba manual (§7).

**Consecuencia de diseño: escribir siempre E.164 explícito con `+`.** Si `value` se guarda literal, dejar que el servidor adivine la región de un `5512345678` suelto es apostar a un comportamiento indocumentado.

La plantilla CSV oficial dice lo mismo desde el otro lado: *"Phone \<number\> - Value — Phone number for your contact. **Use a \"+\" to indicate a country code.** For example: \"+1 234 567 8901.\" Spaces, dashes, and parenthesis are optional."*

### 5.2 Android: guarda lo que le des y calcula el E.164 él mismo

Verificado contra el **código fuente de AOSP** (`frameworks/base/core/java/android/provider/ContactsContract.java`, rama `main`):

```java
/**
 * The phone number as the user entered it.
 */
public static final String NUMBER = DATA;

/**
 * The phone number's E164 representation. This value can be omitted in which
 * case the provider will try to automatically infer it.  (It'll be left null if the
 * provider fails to infer.)
 * If present, {@link #NUMBER} has to be set as well (it will be ignored otherwise).
 */
public static final String NORMALIZED_NUMBER = DATA4;
```

Es decir: **el Contacts Provider de Android infiere el E.164 por su cuenta** si no se lo das, y si no puede, lo deja nulo. La inferencia depende de la región del dispositivo (`PhoneNumberUtils.formatNumberToE164(String phoneNumber, String defaultCountryIso)` — *"@param defaultCountryIso the ISO 3166-1 two letters country code in UPPER CASE. @return the E.164 representation, or null if the given phone number is not valid."*).

### 5.3 Cómo empareja Android un número con un contacto: por los últimos 7 dígitos

`ContactsContract.PhoneLookup`: *"A table that represents the result of looking up a phone number, for example for caller ID. [...] This query is highly optimized."*

La comparación real la hace `PhoneNumberUtils`, y el parámetro que la gobierna está en `frameworks/base/core/res/res/values/config.xml`:

```xml
<!-- Whether to use the strict phone number matcher by default. -->
<bool name="config_use_strict_phone_number_comparation">false</bool>

<!-- The character count of the minimum match for comparison phone numbers -->
<integer name="config_phonenumber_compare_min_match">7</integer>
```

**Por defecto Android compara de forma laxa, contra los últimos 7 dígitos** (`toCallerIDMinMatch` — *"Returns the rightmost minimum matched characters in the network portion in reversed order"*). El comparador laxo incluso contempla explícitamente el prefijo "1" sobrante: el código lo comenta como *"we ignore the prefix '1' just once"* para el caso NANP.

**Esto es una buena noticia importante:** para el emparejamiento **del sistema Android** (identificador de llamadas, app de Teléfono), `+525512345678` y `+5215512345678` casan igual, porque los últimos 7 dígitos coinciden. El "1" de más o de menos no rompe la agenda del teléfono.

**Pero WhatsApp no usa `PhoneLookup`.** WhatsApp lee la libreta y hace su propia resolución contra sus JIDs de servidor. **[NO VERIFICADO]** el algoritmo de emparejamiento de WhatsApp: no existe documentación pública de él. Lo único que hay es la instrucción de formato que da su propio Centro de Ayuda, y esa instrucción es inequívoca.

### 5.4 El "1" de México: WhatsApp lo sigue exigiendo hoy

Verificado el **2026-08-20** en dos páginas del Centro de Ayuda oficial de WhatsApp, ambas renderizadas en navegador porque el HTML servido está vacío:

**[How to add an international phone number](https://faq.whatsapp.com/640432094208718/)** — la página cuyo primer paso es *"Open your phone's address book"*, o sea, exactamente nuestro caso de uso:

> - *"When adding the contact's phone number, start by entering a plus sign (+)."*
> - *"Make sure to remove any leading 0s or special calling codes."*
> - *"All phone numbers in Argentina (country code \"54\") should have a \"9\" between the country code and area code. The prefix \"15\" must be removed so the final number will have 13 digits total: +54 9 XXX XXX XXXX"*
> - **_"Phone numbers in Mexico (country code \"52\") need to have \"1\" after \"+52\", even if they're Nextel numbers."_**

**[About international phone number format](https://faq.whatsapp.com/1294841057948784/)** repite la misma viñeta de México palabra por palabra.

La versión en español de la primera página existe y traduce las mismas reglas.

**Esto contradice el supuesto que traía el proyecto.** El plan de numeración mexicano eliminó el prefijo "1" para celulares en agosto de 2019 — eso es cierto para marcación telefónica. Pero **WhatsApp mantiene la instrucción en su documentación vigente**, y es la fuente primaria que gobierna el comportamiento de la app que nos importa. La referencia a "Nextel", una marca que dejó de operar en México hace más de una década, sugiere que el texto lleva mucho sin revisarse; pero no puedo tratar "el texto parece viejo" como evidencia de que el comportamiento cambió.

**[NO VERIFICADO]** — y es la pregunta abierta más consecuente de todo el documento — si WhatsApp **hoy** normaliza internamente `+52 55...` y `+52 1 55...` al mismo JID. Circula ampliamente la afirmación de que desde ~2021 el servidor de WhatsApp acepta ambas formas para México, pero **no existe ninguna fuente primaria de WhatsApp que lo diga**, y su propia documentación afirma lo contrario. No hay forma de resolverlo leyendo: hay que medirlo (§7.2).

**Recomendación provisional: escribir `+52 1 <10 dígitos>` en `phoneNumbers[].value`.** Razonamiento asimétrico, no de preferencia:

- Si WhatsApp normaliza ambas formas, escribir con "1" **no cuesta nada** — funciona igual.
- Si WhatsApp **no** normaliza y exige el "1" como dice su doc, escribir sin "1" hace fracasar todo el proyecto en silencio: los contactos existirían y los chats seguirían mostrando números.
- Para la agenda de Android (llamadas, SMS, identificador de llamadas), el "1" de más **es inocuo** porque la comparación es por los últimos 7 dígitos con comparador laxo (§5.3).

El costo del "1" es cosmético: el número se ve raro al abrirlo. El costo de omitirlo, si la doc de WhatsApp tiene razón, es el fracaso total. **Guardar el E.164 real (`+52` sin el "1") en Neon** y aplicar el "1" solo en la capa que construye el payload de Google — así, si la medición de §7.2 demuestra que no hace falta, el cambio es de una línea y una re-sincronización.

---

## 6. Pregunta 5 — Importación manual por CSV (y cómo deshacerla)

Esta es la prueba que hay que correr **antes** de escribir una línea de código.

### 6.1 Formatos aceptados

De [Import your contacts into Google Contacts](https://support.google.com/contacts/answer/15147365):

> *"Import from an existing CSV or vCard file [...] For CSV files, look for the .csv file extension. For vCard files, look for the .vcf file extension."*

El formato "Google CSV" **sigue existiendo** — es la opción de exportación documentada en [Export, back up, or restore contacts](https://support.google.com/contacts/answer/7199294): *"To back up your contacts, select **Google CSV**."*

**Versión de vCard: [NO VERIFICADO] para la importación.** La ayuda dice ".vcf" sin versión. El dato más cercano que sí es primario es la [documentación de CardDAV de People API](https://developers.google.com/people/carddav): *"Google's CardDAV utilizes VCard 3.0 for encoding contact data."* Es razonable inferir que el importador acepta vCard 3.0, pero es inferencia mía. **Recomendación: usar CSV**, que sí está documentado campo por campo.

### 6.2 Encabezados exactos de la plantilla oficial

Google publica una plantilla de Google Sheets y documenta **cada** encabezado. Advertencia literal: *"Do not delete the header row in the template. These headings help make sure your contacts' info is saved to the right place"* y *"A new contact is created for every row that has any entered data."*

**Nombre:** `Name Prefix`, `First Name`, `Middle Name`, `Last Name`, `Name Suffix`, `Phonetic First Name`, `Phonetic Middle Name`, `Phonetic Last Name`, `Nickname`, `File as`

**Contacto:** `Email <number> - Label`, `Email <number> - Value`, `Phone <number> - Label`, `Phone <number> - Value`

**Dirección:** `Address <number> - Label` / `- Country` / `- Street` / `- Extended Address` / `- City` / `- Region` / `- Postal Code` / `- PO Box`

**Organización:** `Organization Name`, `Organization Title`, `Organization Department`

**Eventos:** `Birthday` (*"YYYY-MM-DD or --MM-DD if there's no year"*), `Event <number> - Label`, `Event <number> - Value`

**Otros:** `Relation <n> - Label/Value`, `Website <n> - Label/Value`, **`Custom Field <number> - Label`**, **`Custom Field <number> - Value`**, `Notes`, **`Labels`**

Dos columnas cruciales para nuestro diseño:

- **`Custom Field <n> - Label` / `- Value`**: *"Useful if you'd like to save contact data that doesn't fit in one of the default fields offered above."* Es la contraparte CSV de `userDefined` (§4.5).
- **`Labels`**: *"Names of the labels this contact is a part of. You can enter multiple values here separated by \":::\". For example: \"Work Friends ::: Family ::: Project11.\""* Es la contraparte CSV de las membresías a grupo.

**El CSV puede reproducir exactamente el mismo marcado de origen que la API.** Eso significa que la prueba manual no es un experimento desechable: los contactos que entren por CSV quedan indistinguibles de los que después escribirá el sync, y el sync los podrá adoptar en vez de duplicarlos.

Además: *"If you have contacts with multiple emails, phone numbers, and more, you can insert extra columns in the template."*

### 6.3 Límites de la importación

> *"You import more than 3,000 contacts at a time. If you have more than 3,000 contacts, split them into multiple CSVs before you import them."*
> *"You reach the limit of 25,000 contacts."*

Con unos cientos de registros, una sola importación basta.

### 6.4 Cómo deshacerla — la parte crítica

De [Edit or delete contacts](https://support.google.com/contacts/answer/7280886), sección "Undo changes to contacts":

> *"You can undo all the changes you made to your contacts during the past 30 days, all at once."*
> *"**Important: Contacts deleted permanently from your Trash cannot be recovered.**"*
>
> 1. *"Go to Google Contacts."*
> 2. *"At the top right, click Settings ▸ Undo changes."*
> 3. *"Choose a time to go back to."*
> 4. *"Click Confirm."*
>
> *"Tip: When you restore contacts to a certain time, such as one week ago, any contacts added after that time won't show up."*

Y por separado, la papelera: *"Your contacts are moved to Trash, where they'll stay for 30 days before they're deleted permanently."*

**Cómo hacer la prueba verdaderamente reversible:**

1. **Antes de importar nada**, exportar todo con "Google CSV" y guardarlo fuera de la cuenta. Es el único respaldo que no depende de la ventana de 30 días.
2. Anotar la fecha y hora exactas de la importación.
3. Importar el CSV de prueba (empezar con **5 contactos**, no con los cientos).
4. Verificar en el Android: que aparezcan, y sobre todo que WhatsApp muestre el nombre en un chat existente.
5. Si algo salió mal: **Configuración > Deshacer cambios**, elegir un momento anterior a la importación.

La advertencia del "Tip" es el filo de esta herramienta: **Deshacer cambios revierte *toda* la libreta a ese momento**, no solo lo que importamos. Si Adrián agregó un contacto real desde el teléfono entre la importación y el deshacer, ese contacto también desaparece. Por eso el paso 1 no es opcional, y por eso la prueba debe hacerse en una ventana corta y avisada.

---

## 7. Pregunta 6 — Cliente Node

### 7.1 Los números, medidos

Instalé ambos paquetes en un directorio limpio el 2026-08-20 (comandos en §9.2):

| | `googleapis` | `@googleapis/people` |
|---|---|---|
| Versión / publicada | **176.0.0** · 2026-08-18 | **8.0.0** · 2026-08-03 |
| Licencia | Apache-2.0 | Apache-2.0 |
| `unpackedSize` del paquete | **212,514,827 B (212 MB)** en 1,893 archivos | **566,312 B (566 KB)** en 14 archivos |
| `node_modules` real instalado | **233 MB** / 92 paquetes | **19 MB** / 88 paquetes |
| Dependencias directas | `googleapis-common@^8`, `google-auth-library@10.5.0` | `googleapis-common@^8` |
| Árbol resuelto | — | `googleapis-common@8.0.3` → `google-auth-library@10.5.0` (ambos `node>=18`) |

`googleapis` es el paquete generado que contiene **todas** las APIs de Google. 212 MB de código, del cual usaríamos unos kilobytes. En un despliegue de Render eso es tiempo de build y espacio de imagen a cambio de nada.

`@googleapis/people` **sí existe** y es la versión acotada: 566 KB, 14 archivos. Es la respuesta correcta a "¿existe un paquete más acotado?".

### 7.2 Aun así, la recomendación es REST directo con `fetch`

Ninguna de las dos se paga sola en este proyecto:

1. **La superficie que necesitamos son 7 endpoints REST y un `POST` al token endpoint.** No hay paginación exótica, ni streaming, ni uploads reanudables. Es exactamente el perfil de `lib/dropbox.js`, que resuelve el refresh de OAuth en 18 líneas sin dependencias.
2. **88 paquetes transitivos por conveniencia de tipado.** El repo no usa TypeScript. El beneficio principal de `@googleapis/people` — los tipos generados — no aplica.
3. **Consistencia con la casa.** El patrón documentado en `CLAUDE.md` es núcleos puros + `fetch`. Meter un cliente generado para People y no para Operam crea dos formas de hablar con un tercero.
4. **`google-auth-library@11` exige `node>=22`.** Hoy la resolución cae en la 10.5.0 (`node>=18`), pero es un acoplamiento de versión de Node que este proyecto no tiene por qué adquirir.
5. **La documentación oficial de Node está desactualizada.** El [quickstart de Node.js de People API](https://developers.google.com/people/quickstart/nodejs) dice literalmente `npm install googleapis@105 @google-cloud/local-auth@2.1.0 --save`. `googleapis@105` es de julio de 2022 y hoy va en la 176; `@google-cloud/local-auth@2.1.0` es de junio de 2022 y hoy va en la 3.0.1. Seguir el quickstart al pie de la letra instala software de hace cuatro años. Es una señal razonable de cuánta atención recibe la ruta Node de esta API.

**La forma correcta aquí es un `lib/google-contactos.js` calcado de `lib/dropbox.js`**: caché de access token en memoria con expiración, refresh vía `POST https://oauth2.googleapis.com/token`, y `fetch` contra `https://people.googleapis.com/v1/...` con `Authorization: Bearer`.

### 7.3 El refresh, verbatim

De [Using OAuth 2.0 for Web Server Applications](https://developers.google.com/identity/protocols/oauth2/web-server), sección de refresco: se hace un POST al *"authorization server (`https://oauth2.googleapis.com/token`)"* con estos parámetros en el cuerpo:

| Campo | Valor |
|---|---|
| `client_id` | *"The client ID obtained from the API Console."* |
| `client_secret` | *"Optional. The client secret obtained from the API Console."* |
| `grant_type` | *"this field's value must be set to `refresh_token`."* |
| `refresh_token` | *"The refresh token returned from the authorization code exchange."* |

Idéntico en forma al de Dropbox. DPoP existe como opción recomendada (*"While the use of DPoP is optional, it is recommended for increased security"*) pero exige generar un JWT de prueba firmado por petición y manejar `DPoP-Nonce` — complejidad injustificada para un cliente confidencial de un solo usuario. **No usar DPoP.**

### 7.4 Obtener el refresh token una sola vez, desde un script local

Los parámetros documentados:

- **`access_type=offline`** — *"Set the value to `offline` if your application needs to refresh access tokens when the user is not present at the browser."* / *"Recommended, offline access will give you both an access and refresh token so that your app can refresh the access token without user interaction."*
- **`prompt=consent`** — *"Optional, call the setPrompt function to set 'consent' will prompt the user for consent."* Necesario porque Google **solo devuelve el refresh token en el primer consentimiento**; forzando `consent` se garantiza recibirlo aunque ya se hubiera autorizado antes.
- **Redirect a localhost** — *"For testing, you can specify URIs that refer to the local machine, such as `http://localhost:8080`."* Los `localhost` están exentos del requisito de HTTPS.
- **`state`** — *"Using a state value can increase your assurance that an incoming connection is the result of an authentication request."*

Si en vez de un cliente "Web application" se crea uno de tipo "Desktop app", el redirect documentado es el **loopback IP**: *"`http://127.0.0.1:port` or `http://[::1]:port` — Query your platform for the relevant loopback IP address and start an HTTP listener on a random available port."* ([OAuth para apps instaladas](https://developers.google.com/identity/protocols/oauth2/native-app)).

**Recomendación: cliente tipo "Web application" con `http://localhost:PORT` como redirect autorizado**, y un `scripts/autorizar-google.mjs` que levanta un Express efímero, abre el navegador, recibe el `code`, lo canjea e imprime el `refresh_token` para pegarlo en Render. Un solo uso, nada en producción. Es el mismo tipo de cliente que ya se usa en el servidor, y evita la asimetría de tener dos client IDs.

---

## 8. Arquitectura recomendada

```
                    UNA VEZ, EN LA MAQUINA DE ADRIAN
  +------------------------------------------------------------------+
  |  scripts/autorizar-google.mjs                                     |
  |    1. abre accounts.google.com/o/oauth2/v2/auth                   |
  |         ?client_id=... &redirect_uri=http://localhost:8787        |
  |         &response_type=code &scope=.../auth/contacts              |
  |         &access_type=offline &prompt=consent &state=<aleatorio>   |
  |    2. Adrian acepta la pantalla de "app no verificada" (1 vez)    |
  |    3. Express efimero en :8787 recibe el ?code=                   |
  |    4. POST https://oauth2.googleapis.com/token                    |
  |    5. imprime refresh_token -> pegar en Render (env var)          |
  +------------------------------------------------------------------+
                                 |
                                 v
        GOOGLE_REFRESH_TOKEN + GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET
                                 |
  +------------------------------------------------------------------+
  |            EXPRESS EN RENDER  --  UNA INSTANCIA                   |
  |                                                                   |
  |  lib/contactos-logica.js   (NUCLEO PURO, sin IO)                  |
  |    - aE164(telefono)        -> "+52..."   (Neon guarda esto)      |
  |    - aFormatoWhatsApp(e164) -> "+521..."  (solo al escribir)      |
  |    - nombreVisible(cliente) -> "Nombre - Empresa"                 |
  |    - diff(deseado, actual)  -> {crear[], actualizar[], sinCambio} |
  |                                                                   |
  |  lib/google-contactos.js   (calcado de lib/dropbox.js)            |
  |    - getToken()   cache en memoria + refresh, sin dependencias    |
  |    - listarConexiones()   GET  people/me/connections              |
  |    - crearLote(<=200)     POST people:batchCreateContacts         |
  |    - actualizarLote(<=200) POST people:batchUpdateContacts        |
  |    - asegurarGrupo()      GET/POST contactGroups                  |
  |         SIN batchDelete. SIN deleteContact. Nunca.                |
  |                                                                   |
  |  Neon: contactos_google                                           |
  |    telefono_e164 PK | resource_name | etag | hash_payload |       |
  |    ultimo_sync | origen_id                                        |
  +------------------------------------------------------------------+
                                 |
                                 v   secuencial, lotes de <=200
                    https://people.googleapis.com/v1/
                                 |
                                 v
                    Contactos de pppeltre@gmail.com
                     grupo "Clientes cotizador"
                     userDefined: origen = cotizador:<id>
                                 |
                                 v   sync automatico al iniciar sesion
                    Android  ->  libreta del telefono  ->  WhatsApp Business
```

Sobre la última flecha, de [Sync Google Contacts with your mobile device](https://support.google.com/contacts/answer/2753077):

> *"Your Google contacts sync to your Android device when you sign in. Changes to your contacts will automatically sync to keep them backed up and up to date."*

Y WhatsApp toma sus contactos de ahí — su propia guía para agregar un número internacional empieza con *"Open your phone's address book"*.

### 8.1 Decisiones de diseño y su porqué

1. **El teléfono en E.164 real vive en Neon; el "1" de México se aplica solo al construir el payload de Google.** Aísla una decisión no resuelta (§5.4) en una función pura de una línea. Si la medición demuestra que el "1" sobra, se cambia ahí y se re-sincroniza.
2. **`lib/contactos-logica.js` es núcleo puro sin IO**, siguiendo el patrón de la casa (`alta-logica.js`, `calcas-logica.js`, `cruce-identidad.js`). El diff entre lo deseado y lo que hay en Google es lógica pura y testeable; la llamada HTTP vive fuera.
3. **Nunca borrar.** El scope obliga a pedir permiso de borrado permanente, pero el código no tiene por qué ejercerlo. Un contacto que ya no está en Operam se marca en Neon y se deja de actualizar. Borrar contactos de la libreta de un teléfono de trabajo es un daño irreversible con la ventana de 30 días como único paracaídas; el beneficio no existe.
4. **Nunca tocar lo que no es nuestro.** Antes de actualizar, comprobar que el contacto sigue en el grupo "Clientes cotizador" y que trae el `userDefined` de origen. Si no, saltarlo y registrarlo. Y si el `etag` no cuadra, releer y **respetar el valor humano** (§4.3).
5. **Todo secuencial.** Google lo pide por escrito en cada método de mutación. Con una sola instancia en Render, un lock en memoria como el de `subidasOperamEnCurso` es suficiente — y es la misma restricción de "un solo proceso Node" que ya documenta `CLAUDE.md`.
6. **Sync completo por defecto, `syncToken` como optimización.** Caduca a los 7 días y se invalida si cambian los parámetros; con cientos de contactos, releer todo cuesta una o dos páginas.
7. **`readMask` vacío en `batchCreate` solo si no se necesitan los `resourceName`.** Se necesitan, así que va con `metadata,names,phoneNumbers` — pero conviene saber que vaciarla ahorra la lectura posterior.

### 8.2 Orden de trabajo sugerido

| Paso | Qué | Reversible |
|---|---|---|
| 0 | Exportar "Google CSV" completo de la cuenta y guardarlo fuera | — |
| 1 | Importar **5 contactos** de prueba por CSV con `Labels` y `Custom Field 1` | Sí (Deshacer cambios) |
| 2 | Medir en el Android si WhatsApp muestra el nombre — con y sin el "1" (§7.2 de riesgos) | Sí |
| 3 | Crear el proyecto de Cloud, habilitar People API, consentimiento External, **Publish app** | Sí |
| 4 | `scripts/autorizar-google.mjs`, guardar el refresh token en Render | Sí |
| 5 | Modo dry-run: leer `connections.list`, calcular el diff, no escribir nada | Sí |
| 6 | Escribir el primer lote real de ≤200 | Ventana de 30 días |
| 7 | Sync periódico | — |

Los pasos 1 y 2 no requieren escribir código y responden la pregunta que puede invalidar todo el proyecto. **Hacerlos primero.**

### 8.3 Un problema abierto: el refresh token en variable de entorno

La documentación de Google no promete que el `refresh_token` sea inmutable. Si el token endpoint devolviera uno nuevo, el proceso en Render no puede reescribir su propia variable de entorno.

`lib/dropbox.js` tiene el mismo agujero y no ha dado problemas en producción. La mitigación proporcionada al riesgo es: **si la respuesta del refresh trae `refresh_token` y difiere del de la variable de entorno, registrarlo en un log visible** para que Adrián lo pegue en Render. No vale la pena mover el almacenamiento a Neon por adelantado.

### 8.4 Qué NO hacer

| Antipatrón | Por qué |
|---|---|
| Dejar la app en "Testing" | El refresh token muere a los 7 días. Sin excepción para `auth/contacts`. |
| Pedir verificación a Google | Innecesaria bajo "personal use (fewer than 100 users)"; tarda meses y no aporta nada aquí. |
| Pedir `contacts.other.readonly` "por si acaso" | Los Other Contacts no llegan al Android. Añade una casilla de consentimiento a cambio de nada. |
| Usar `searchContacts` para deduplicar | Caché perezoso, prefijo, `pageSize` 30, propagación de varios minutos. |
| `Promise.all` sobre lotes | Google advierte por escrito contra las mutaciones concurrentes del mismo usuario. |
| Quitar `myContacts` para dejar solo el grupo propio | La API defiende la invariante y el efecto en la sincronización a Android no está documentado. |
| Mandar `phoneNumbers` parcial en un update | `updateMask` **reemplaza**: borraría los demás teléfonos del contacto. |
| Tratar el 400 de etag como error genérico | Es `reason: "failedPrecondition"` y significa "un humano editó esto". Requiere releer y fusionar. |
| Instalar `googleapis` completo | 233 MB de `node_modules` para 7 endpoints. |
| Seguir el quickstart oficial de Node literal | Instala `googleapis@105` (2022) y `@google-cloud/local-auth@2.1.0` (2022). |
| Llamar a `batchDeleteContacts` | El permiso existe; ejercerlo no. |

---

## 9. Apéndice — lo medido y cómo reproducirlo

### 9.1 Documento de descubrimiento en vivo (2026-08-20)

```bash
curl -s "https://people.googleapis.com/\$discovery/rest?version=v1" -o disc.json
```

```
revision 20260819   baseUrl https://people.googleapis.com/

createContact        POST   v1/people:createContact        | scopes: ['.../auth/contacts']
batchCreateContacts  POST   v1/people:batchCreateContacts  | scopes: ['.../auth/contacts']
batchUpdateContacts  POST   v1/people:batchUpdateContacts  | scopes: ['.../auth/contacts']
batchDeleteContacts  POST   v1/people:batchDeleteContacts  | scopes: ['.../auth/contacts']
updateContact        PATCH  v1/{+resourceName}:updateContact | scopes: ['.../auth/contacts']
deleteContact        DELETE v1/{+resourceName}:deleteContact | scopes: ['.../auth/contacts']
searchContacts       GET    v1/people:searchContacts       | scopes: ['.../auth/contacts',
                                                                      '.../auth/contacts.readonly']

connections.list params: sources, requestMask.includeField, requestSyncToken, personFields,
                         sortOrder, pageToken, resourceName, syncToken, pageSize
otherContacts:   search, list, copyOtherContactToMyContactsGroup
contactGroups:   list, delete, batchGet, get, create, update  (+ sub-recurso members.modify)
```

Esto es lo que sustenta §3.5: **no hay ningún método de escritura que acepte un scope distinto de `auth/contacts`.**

### 9.2 Tamaño real de los clientes de npm

```bash
mkdir gapitest && cd gapitest && npm init -y
npm install @googleapis/people --no-audit --no-fund
du -sk node_modules            # 19315 KB   (88 paquetes)

mkdir gapifull && cd gapifull && npm init -y
npm install googleapis --no-audit --no-fund
du -sk node_modules            # 233423 KB  (92 paquetes)
du -sk node_modules/googleapis # 212870 KB
```

Metadatos del registro:

```bash
curl -s https://registry.npmjs.org/googleapis/latest
# version 176.0.0 | Apache-2.0 | unpackedSize 212514827 | fileCount 1893 | node>=18
curl -s https://registry.npmjs.org/@googleapis%2fpeople/latest
# version 8.0.0   | Apache-2.0 | unpackedSize 566312    | fileCount 14   | node>=12
curl -s https://registry.npmjs.org/google-auth-library/latest
# version 11.0.2  | node>=22   <- lo que traeria una resolucion nueva
```

Fechas de publicación (campo `time` del registro):

```
googleapis 176.0.0            -> 2026-08-18
googleapis 105.0.0            -> 2022-07-04   <- lo que pide el quickstart oficial
@googleapis/people 8.0.0      -> 2026-08-03
@google-cloud/local-auth 3.0.1 -> 2024-01-08
@google-cloud/local-auth 2.1.0 -> 2022-06-20  <- lo que pide el quickstart oficial
```

### 9.3 Fuente de Android (AOSP, rama `main`)

```bash
curl -sL "https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/core/java/android/provider/ContactsContract.java?format=TEXT" \
  | base64 -d > ContactsContract.java

curl -sL "https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/core/res/res/values/config.xml?format=TEXT" \
  | base64 -d | grep -A1 config_phonenumber_compare_min_match
```

Resultado:

```xml
<bool    name="config_use_strict_phone_number_comparation">false</bool>
<integer name="config_phonenumber_compare_min_match">7</integer>
```

Y en `ContactsContract.java`:

```java
// CommonDataKinds.Phone
public static final String NUMBER = DATA;            // "as the user entered it"
public static final String NORMALIZED_NUMBER = DATA4; // "E164 representation ... the provider
                                                      //  will try to automatically infer it"
// PhoneLookupColumns
public static final String NORMALIZED_NUMBER = "normalized_number"; // "E164 representation"
```

### 9.4 Cómo se leyó el Centro de Ayuda de WhatsApp

Las páginas de `faq.whatsapp.com` sirven **6 KB de HTML vacío**; el contenido se inyecta por JavaScript y el texto ni siquiera queda en `innerText`. `curl` y los extractores de texto devuelven solo el `<title>`. Hubo que abrirlas en un navegador real y leer el payload SSR incrustado:

```js
const h = document.documentElement.innerHTML;
const strs = [...h.matchAll(/children\\+":\[\\+"([^\[\]{}]{15,500}?)\\+"\]/g)]
               .map(m => m[1].replace(/\\+"/g, '"'));
```

Salida literal de `https://faq.whatsapp.com/640432094208718/?lang=en` (2026-08-20):

```
"Open your phone's address book."
"When adding the contact's phone number, start by entering a plus sign (+)."
"For example, if a contact in the United States (country code \"1\") has the area code \"408\"
 and phone number \"XXX-XXXX\", you'd enter +1 408 XXX XXXX."
"Make sure to remove any leading 0s or special calling codes."
"If you meant to add a local (in country) phone number to your phone's address book, enter the
 number as if you were calling your contact on the phone."
"All phone numbers in Argentina (country code \"54\") should have a \"9\" between the country
 code and area code. The prefix \"15\" must be removed so the final number will have 13 digits
 total: +54 9 XXX XXX XXXX"
"Phone numbers in Mexico (country code \"52\") need to have \"1\" after \"+52\", even if they're
 Nextel numbers."
```

La versión `?lang=es` de la misma página devuelve las mismas reglas traducidas.

### 9.5 Verificación de que no existe página de cuotas de People API

```bash
curl -s -o /dev/null -w '%{http_code}' -L https://developers.google.com/people/v1/quota   # 404
curl -s -o /dev/null -w '%{http_code}' -L https://developers.google.com/people/v1/limits  # 404
```

---

## 10. Riesgos y preguntas abiertas

Todo lo marcado **[NO VERIFICADO]** en el documento, ordenado por cuánto puede costar.

### 10.1 Crítico — puede invalidar el proyecto entero

**¿WhatsApp normaliza hoy `+52 55...` y `+52 1 55...` al mismo destinatario?**
Su documentación vigente dice que hace falta el "1". No existe fuente primaria que diga lo contrario, ni documentación pública del algoritmo de emparejamiento. **Por qué importa:** si la doc está desactualizada y el "1" ya no hace falta, escribir con "1" es inofensivo. Si la doc está vigente y escribimos sin "1", **todos los contactos se crean correctamente y ningún chat muestra el nombre** — un fracaso silencioso, del tipo más caro. **Cómo cerrarlo:** paso 2 de §8.2. Crear dos contactos de prueba con el mismo celular real, uno con `+52 1` y otro con `+52`, en cuentas o momentos distintos, y ver cuál hace que el chat existente muestre el nombre. Es una medición de diez minutos y elimina el mayor riesgo del proyecto.

**¿La People API acepta, rechaza o reescribe un `phoneNumbers[].value` que no puede canonicalizar?**
`canonicalForm` es `Output only`, así que el servidor sabe canonicalizar, pero no está documentado qué pasa cuando falla. **Por qué importa:** si escribimos `+521...` y el servidor lo considera inválido para México, `canonicalForm` podría quedar vacío o el valor podría reescribirse; ambos escenarios cambian lo que llega al teléfono. **Cómo cerrarlo:** en el paso 5 (dry-run), crear un contacto de prueba por API con `+521...` y releerlo con `personFields=phoneNumbers` para ver `value` y `canonicalForm`.

### 10.2 Importante — afecta el diseño, no la viabilidad

**¿`clientData` y `externalIds` son visibles en la UI de Google Contactos?**
No aparecen en la plantilla CSV ni en el exportador, lo que sugiere que no, pero no hay documentación explícita. **Por qué importa:** determina si sirven como marca auditable a mano. La recomendación de §4.5 (`userDefined` + grupo) ya está tomada asumiendo lo peor, así que esto solo abre una alternativa, no cierra un camino.

**¿Android sincroniza contactos que no están en `myContacts`?**
No documentado. **Por qué importa:** si alguien "optimiza" quitando esa membresía, los contactos podrían dejar de llegar al teléfono. Mitigado por la regla de §8.4 de nunca quitarla.

**¿Cuáles son los valores numéricos de las cuotas "Critical read/write requests" y "Daily Contact Writes"?**
No publicados en ninguna página; solo visibles en la consola del proyecto. **Por qué importa:** un `batchCreate` de 200 consume 200 unidades diarias, así que la carga inicial de cientos de contactos es el momento de mayor exposición. **Cómo cerrarlo:** mirar "Quotas & System Limits" del proyecto en cuanto exista.

**¿"Publish app" exige homepage, privacidad y términos?**
La documentación ata ese requisito a *someter a verificación*, no a publicar, pero la redacción admite duda. **Por qué importa:** si los exige, hay un paso extra (servir una página de privacidad desde el cotizador) antes de poder salir de Testing — y salir de Testing es el punto entero de §2.

### 10.3 Menor — conviene saberlo, no bloquea

**¿La guía de errores 403/429 de Drive aplica a People API?**
Está titulada para Drive. Es el patrón estándar de Workspace, pero no encontré la versión específica de People. El backoff exponencial es correcto de todos modos.

**¿Qué versión de vCard acepta el importador de contacts.google.com?**
La ayuda solo dice ".vcf". El dato primario más cercano es que CardDAV de Google usa vCard 3.0. Irrelevante si se usa CSV, que es lo recomendado.

**¿Habilitar People API requiere cuenta de facturación?**
No mencionado en la documentación de la API. No encontré ninguna lista de precios que la incluya. Se resuelve en un clic al habilitarla.

**¿Hay un máximo de grupos de contactos?**
No documentado. Con un solo grupo, irrelevante.

**¿Google puede devolver un `refresh_token` nuevo en el refresco?**
La documentación no lo promete ni lo descarta. Mitigado en §8.3 con un log visible.

---

## 11. Índice de fuentes

**OAuth 2.0 y publicación**
- https://developers.google.com/identity/protocols/oauth2 (§ Refresh token expiration)
- https://developers.google.com/identity/protocols/oauth2/web-server
- https://developers.google.com/identity/protocols/oauth2/native-app
- https://developers.google.com/identity/protocols/oauth2/scopes
- https://support.google.com/cloud/answer/15549945 (Manage App Audience — Testing / In production / OAuth user cap)
- https://support.google.com/cloud/answer/7454865 (Unverified apps)
- https://support.google.com/cloud/answer/13464323 (When is verification not needed)
- https://support.google.com/cloud/answer/13464325 (lista de scopes restringidos)
- https://support.google.com/cloud/answer/9110914 (OAuth API Verification FAQ)
- https://support.google.com/cloud/answer/10311615 (configuración del consentimiento)
- https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification

**People API**
- https://developers.google.com/people/api/rest/v1/people (recurso `Person`: `PhoneNumber`, `ClientData`, `UserDefined`, `ExternalId`, `Membership`)
- https://developers.google.com/people/api/rest/v1/people/batchCreateContacts
- https://developers.google.com/people/api/rest/v1/people/batchUpdateContacts
- https://developers.google.com/people/api/rest/v1/people/batchDeleteContacts
- https://developers.google.com/people/api/rest/v1/people/updateContact
- https://developers.google.com/people/api/rest/v1/people/searchContacts
- https://developers.google.com/people/api/rest/v1/people.connections/list
- https://developers.google.com/people/api/rest/v1/otherContacts/list
- https://developers.google.com/people/api/rest/v1/contactGroups · .../contactGroups/create · .../contactGroups.members/modify
- https://developers.google.com/people/v1/contacts (guía Read and Manage Contacts, con el consumo de cuota por método)
- https://developers.google.com/people/v1/getting-started
- https://developers.google.com/people/carddav
- https://developers.google.com/people/quickstart/nodejs
- https://people.googleapis.com/$discovery/rest?version=v1 (revisión 20260819)

**Google Contactos (producto)**
- https://support.google.com/contacts/answer/15147365 (importar: CSV/vCard, plantilla, encabezados, límite de 3,000)
- https://support.google.com/contacts/answer/7199294 (exportar Google CSV / vCard)
- https://support.google.com/contacts/answer/7280886 (Deshacer cambios, papelera de 30 días)
- https://support.google.com/contacts/answer/1069522 (Other contacts no visibles en Android)
- https://support.google.com/contacts/answer/148779 (límites: 25,000 contactos, 128 KB, 1,024 caracteres por campo)
- https://support.google.com/contacts/answer/2753077 (sincronización con Android)

**Android / AOSP**
- https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/core/java/android/provider/ContactsContract.java
- https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/telephony/java/android/telephony/PhoneNumberUtils.java
- https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/core/res/res/values/config.xml

**WhatsApp**
- https://faq.whatsapp.com/640432094208718/ (How to add an international phone number)
- https://faq.whatsapp.com/1294841057948784/ (About international phone number format)

**npm**
- https://registry.npmjs.org/googleapis · https://registry.npmjs.org/@googleapis%2fpeople
- https://registry.npmjs.org/google-auth-library · https://registry.npmjs.org/googleapis-common
- https://registry.npmjs.org/@google-cloud%2flocal-auth

**Otros**
- https://developers.google.com/workspace/guides/create-project
- https://developers.google.com/workspace/drive/api/guides/handle-errors (403/429 y backoff)
