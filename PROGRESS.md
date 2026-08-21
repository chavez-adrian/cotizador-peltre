# PROGRESS — sesión 2026-08-21 · sincronización de contactos a Google (#224)

Estado al cierre. **No hay una sola línea de implementación escrita**: la sesión produjo
diseño, documentación y tres scripts de apoyo, todo en `main`. Los dos tickets que
dependían de trabajo humano están hechos y verificados en vivo, así que el desarrollo
puede arrancar de inmediato.

> Esta sección corresponde a la sesión del sync de contactos. Más abajo se conserva
> íntegro el PROGRESS de la sesión del **406 de Operam**, que tiene sus propios
> pendientes y no forma parte de este trabajo.

---

## 1. Qué se estaba haciendo y por qué

Adrián preguntó si se podían sincronizar los contactos de Operam y del cotizador con
los Contactos de Google de `pppeltre@gmail.com`, para que el WhatsApp Business del
Android asociado muestre nombres de clientes en lugar de números desconocidos.

La cadena es: **Operam + cotizador → Contactos de Google → Android → WhatsApp Business**.
WhatsApp no tiene API de contactos; muestra lo que hay en la agenda del teléfono, que se
alimenta de la cuenta de Google. No hay otro camino.

Se siguió el flujo de Matt Pocock de punta a punta: `/research` → `/grill-with-docs` →
`/to-spec` → `/to-tickets`, y luego ejecución de los dos primeros tickets.

---

## 2. Estado exacto: qué quedó en `main`

Commits de esta sesión, en orden:

| Commit | Qué |
|---|---|
| `a4942e1` | CONTEXT.md (término *Contacto de Google*), ADR-0013, nota de research |
| `507f6a4` | `scripts/autorizar-google.mjs` — obtiene el refresh token, un solo uso |
| `b7a2a8a` | research: publicar la app NO exige enlaces de privacidad (verificado en vivo) |
| `37f41c0` | `scripts/verificar-google.mjs` — verificador read-only de credenciales |
| `dd37a9d` | fix: el verificador pedía el scope `profile`, que a propósito no tenemos |
| `26752b9` | `scripts/probar-formato-telefono.mjs` — mide el formato por API |
| `3330929` | research: WhatsApp NO exige el "1" tras el +52 (medido en el dispositivo) |

Documentos:

- `CONTEXT.md` — término **Contacto de Google**, con sus clases *propio* y *adoptado*,
  colocado junto a *Contacto de cliente* para que la distinción se vea.
- `docs/adr/0013-propiedad-de-contactos-de-google.md` — política de propiedad.
- `docs/research/sincronizacion-contactos-google.md` — 893 líneas, fuentes primarias,
  ya corregido con dos hallazgos medidos en vivo.
- `CLAUDE.md` — rango de ADRs actualizado a 0001-0013.

Issues en GitHub (`chavez-adrian/cotizador-peltre`):

- **#224** — spec padre (`ready-for-agent`), 33 user stories.
- **#225** — credenciales OAuth. **HECHO** salvo un criterio (ver §4).
- **#226** — formato del teléfono. **MEDIDO**, resultado documentado. Falta borrar el
  contacto de prueba.
- **#227** — tracer bullet. **SIN BLOQUEADORES, listo para tomar.**
- **#228, #229, #230** — dependen de #227.
- **#231** — depende de #228.
- **#232** — humo final, depende de #226 y de #228-#231.

---

## 3. Decisiones tomadas (las 13 del grill)

1. **Un solo teléfono**, una sola cuenta de Google. Los vendedores en sus celulares no
   ven nada; está fuera de alcance.
2. **Frescura de minutos** — es lo que justifica construir en vez de importar un CSV.
3. **Barrido periódico en dos ritmos, sin ganchos.** Prospectos cada ~15 min desde Neon;
   clientes de Operam heredando el caché horario de `indice-telefonos.js`. **Cero cambios
   en las 8 rutas de alta existentes.**
4. **Entra todo**, incluidos prospectos en *No útil* y *Perdida*: el descartado que
   reaparece es justo a quien más útil resulta identificar.
5. **Aviso de privacidad**: se sigue adelante y Adrián agrega una línea sobre proveedores
   tecnológicos en Shopify. Tarea manual, fuera del repo. Pesa más porque el correo
   también se sincroniza.
6. **Nombre `Persona - Empresa`**, con el nombre comercial (`cust_ref`) y no la razón
   social; ciudad como respaldo si el prospecto no declaró empresa.
7. **En colisión gana el cliente sobre el prospecto.** Invierte a propósito la precedencia
   de `clasificarCelular`; el porqué está en ADR-0013.
8. **Las fichas ajenas se adoptan** (Adrián eligió esto contra la recomendación inicial).
9. **Propia: se escribe completa. Adoptada: solo nombre y organización.** Nunca sus
   teléfonos, correos ni direcciones.
10. **Todos los teléfonos** de Operam: contactos y domicilios (~812 fichas).
11. **Sin respaldo → inactivo, nunca borrar.**
12. **Se incluye el correo** en la ficha.
13. **Panel en /admin + correo diario** mientras la sincronización no complete, reusando
    el SMTP de `lib/alerta-mayoreo-io.js`.

**Seam de prueba acordado (uno solo):** un núcleo puro que recibe
`(prospectos, clientesOperam, libreta, mapeo)` y devuelve un plan
`{crear, actualizar con máscara, inactivar}`. El IO solo ejecuta el plan y no decide nada.
Mismo reparto que `sync-operam.js` frente a `sync-operam-io.js`.

---

## 4. Lo que falta, paso a paso

### 4.1 Pendientes de Adrián (menores)

1. **Borrar el contacto de prueba** "Jorge Prueba Exitosa" en `contacts.google.com`
   (`people/c4838503116925933073`). Es el único criterio sin marcar de #226.
2. **A partir del 2026-08-29**, volver a correr `node scripts/verificar-google.mjs` con las
   tres variables `GOOGLE_*`. Si sigue funcionando, la autorización sobrevivió a los siete
   días y **#225 se cierra del todo**. Es la prueba de que publicar la app surtió efecto.
3. **Agregar la línea al aviso de privacidad** en Shopify (decisión 5).

### 4.2 El desarrollo

**#227 es el siguiente y no tiene bloqueadores.** Es el ticket más grande de los ocho y el
que abre las tres ramas siguientes (#228, #229, #230). Adrián preguntó si arrancarlo y la
sesión se cortó antes de decidirlo.

Después: #228 y #229 y #230 en paralelo → #231 → #232.

---

## 5. Restricciones y hechos descubiertos (lo que costó averiguar)

**De Google, medido en vivo:**

- La caducidad de **siete días es del estado "Testing" de la app**, no del token. Se quita
  publicando la app, gratis. `auth/contacts` es scope **sensible pero NO restringido**, así
  que no aplica la evaluación de seguridad CASA.
- **Publicar NO exige** enlaces de home, privacidad ni términos. Resolvió un
  `[NO VERIFICADO]` del research.
- La consola ya no se llama "OAuth consent screen" sino **Google Auth Platform**
  (Branding / Audience / Clients / Data Access / Verification Center). El scope va en
  **Data Access**, y no aparece en el buscador si la People API no está habilitada.
- Al publicar, la consola lleva al **Centro de verificación**, que avisa en rojo que "se
  requiere la verificación". Tiene tono de bloqueo y **no lo es**: el criterio real es que
  **Audience** diga "En producción".
- `updateMask` **reemplaza, no fusiona**: incluir teléfonos en la máscara de un contacto
  adoptado borraría sus demás números, en cada pasada.
- El etag obsoleto responde **400 `failedPrecondition`, no 409**.
- `searchContacts` **no sirve para deduplicar**: caché perezoso, búsqueda por prefijo, tope
  de 30. El mapeo `teléfono → resourceName + etag` **vive en Neon** y es la autoridad.
- `googleapis` pesa **233 MB** instalado. Se usa `fetch` directo, calcado de `lib/dropbox.js`.
- El scope quedó bien acotado: `people/me` responde **403** porque falta `profile`. La app
  puede tocar contactos y **no** leer el perfil del titular.

**Del teléfono, medido el 2026-08-21 (#226):**

- **WhatsApp NO exige el "1" tras el +52**, aunque su documentación lo siga pidiendo. Se
  escribe **E.164 limpio**, idéntico a lo que ya guarda Neon: cero conversión.
- **Google no normaliza**: `canonicalForm` sale idéntico al valor escrito.
- **La libreta tiene solo 15 contactos**, e incluye precargados de operadora
  ("9-1-1 Emergencias", "Denun Ciudadana"). Dos consecuencias: la cadena
  Google ↔ Android **ya sincroniza** (esos precargados llegaron a Google desde el
  teléfono), y **la adopción de #229 será un caso raro** — casi todo será creación.

**De México:**

- **No se puede distinguir un celular de un fijo por el número**: libphonenumber devuelve
  `FIXED_LINE_OR_MOBILE` para todos, incluido el número comercial propio. Filtrar
  conmutadores es imposible y no se intenta.

**De la operación:**

- **El Android lo tiene Alejandro Chávez, no Adrián.** Alejandro es el actor principal de
  las user stories: la convención `Persona - Empresa` la lee a diario. Las pruebas que
  requieren el teléfono se reparten (Adrián escribe por API, Alejandro observa).

---

## 6. Lecciones de método de esta sesión

- **La prueba tiene que ir por el mismo camino que el código.** Crear el contacto de
  prueba a mano en la interfaz de Google habría medido cómo normaliza esa interfaz, no lo
  que hace la API. Por eso existe `scripts/probar-formato-telefono.mjs`.
- **Validar la entrada antes de escribir.** El número de prueba llegó con 12 dígitos tras
  el `+52` (un "55" antepuesto por costumbre a un número de Guadalajara ya completo). Usado
  tal cual, WhatsApp no habría casado nada y la conclusión habría sido "el formato no
  sirve": un falso negativo que habría cambiado el diseño por la razón equivocada.
- **La verticalidad cambia las dependencias.** Al rehacer los tickets como slices
  verticales, la medición del "1" pasó de opcional a bloqueante de #227 — porque #227 dejó
  de ser una capa técnica y pasó a prometer "el nombre aparece en WhatsApp".
- `/to-spec`, `/to-tickets` y `/ask-matt` son **solo-slash**: no se pueden invocar desde el
  modelo, los tiene que correr Adrián.

---

## 7. Riesgo a vigilar en la implementación

La **máscara reducida de los contactos adoptados** (#229) parecerá complejidad innecesaria
a quien no haya leído ADR-0013, y más ahora que sabemos que la adopción será rara.
Unificarla con la de los contactos propios reintroduce un borrado silencioso de datos
ajenos que se repetiría **en cada pasada, cada quince minutos, indefinidamente**. El ticket
lo advierte explícitamente y pide una prueba dedicada, escrita como candado.

---
---

# PROGRESS — sesión 2026-08-21 · el 406 de Operam

Estado al cierre de sesión. Todo lo de código está **en `main` y verificado en vivo**;
lo único pendiente de esta sesión es la curación de issues que quedó en manos de un
agente Fable independiente (ver §6).

---

## 1. Qué se estaba haciendo y por qué

Adrián no podía subir cotizaciones a Operam. Al generar el documento salía como
PRE-COTIZACIÓN con:

```
No se pudo crear el cliente generico en Operam: Operam 406
```

El diagnóstico corrió con el skill `/mattpocock-skills:diagnosing-bugs`.

**El caso concreto:** cotización con id interno **73** (no es folio; los ids internos
no son números de cotización, ADR-0009). Cliente `CUMBIARCA SA`, nombre corto
"Studio Iken", RFC genérico extranjero `XEXX010101000`, entrega en Ciudad de Panamá,
12 partidas + envío FedEx International, total $31,502.63.

---

## 2. Estado exacto: qué quedó en `main`

| Commit | Issue | Qué hace |
|---|---|---|
| `c7f299a` | #242 | `apiCall` y `getToken` dejan de descartar el cuerpo del error de Operam |
| `446cba3` | #243 | El cliente elegido conserva su `customer_id`; la sucursal se pregunta a Operam |
| `4904856` | #244 | La dedup de genéricos deja de partir el universo en dos |

Suite completa al cierre: **2473 / 2473**. Árbol de trabajo limpio.

### Verificación en vivo (lectura read-only contra Operam)

Adrián reintentó tras el deploy, apareció el picker de candidatos, eligió el 499 y
subió:

```
QUOTE 1239: debtor=499  cust_ref="Studio Iken"  branch=546  total=27158
POOL XEXX010101000: 34 clientes   (idéntico a antes del fix)
POOL XAXX010101000: 82 clientes   (idéntico a antes del fix)
```

Las cuatro cosas que había que comprobar: quedó colgada del cliente que ya existía;
**cero duplicados creados**; `branch=546` y **no 1** (prueba del arreglo de la
sucursal); y el `cust_ref` correcto.

---

## 3. Los tres defectos, en orden de descubrimiento

**D1 — El cuerpo del error se tiraba.** `apiCall` lanzaba `Operam ${status}` y
descartaba el cuerpo, que es donde Operam explica. Los dos 406 reales
("Already exists customer with same cust_ref" y "A sales type not found create one")
comparten código y solo se separan por el cuerpo. *No era la causa, pero sin esto el
diagnóstico era ciego.* De paso: `getToken` hacía `r.json()` sin mirar el status y
reventaba con `Unexpected token '<'` cuando Operam rate-limitea con una página HTML.

**D2 — El `customer_id` no viajaba.** `leerClienteFormulario` (`public/js/app.js`)
armaba el cliente del body leyendo **solo los inputs `cl-*`**. El id del cliente
elegido vivía en `pcState.cliente` y nunca llegaba al servidor.
`necesitaAltaGenerica` mira solo `data.cliente.customerId`: sin id y con RFC genérico
concluye "no existe" y manda a crear. Con RFC real no se nota porque
`subirCotizacionOperam` cae al respaldo por RFC; con XAXX/XEXX ese respaldo es
imposible. **No era regresión**: verificado en el historial, el payload nunca llevó el
id (#81 `042f4fc` y #84 `54acdb5`, julio).

> **El bug fabricaba la condición que después lo bloqueaba.** La primera cotización a
> un cliente de RFC genérico elegido por "Ya lo conozco" lo CREA y parece funcionar;
> de ahí en adelante toda cotización nueva para ese cliente choca contra el que se
> creó. Por eso se sentía como algo que "empezó" de golpe llevando meses.

**D3 — La dedup buscaba en un solo grupo.** `poolDedupGenerico` pedía el pool de UN
RFC genérico, elegido con `rfcGenericoPara(c.pais)` — y el país **queda siempre en
`MX`** al elegir un cliente de Operam. Se preguntó por XAXX cuando el 499 vive en
XEXX → veredicto `libre` → **no se mostraba el picker**, que era la salida prevista →
se intentaba crear → 406 sin salida.

---

## 4. Decisiones tomadas (y una que se revirtió)

**El RFC genérico no identifica, así que tampoco puede particionar.** Es el propio
Context de ADR-0001. Cuál de los dos comodines le tocó a un cliente no es atributo
suyo: es el país que capturó quien lo dio de alta.

> **Se descartó re-llavear el pool con el RFC capturado en vez del país.** Ésa fue mi
> primera propuesta y **un agente Fable de segunda opinión la tumbó**, con razón:
> arregla este caso y rompe el espejo (extranjero con país correcto pero RFC tecleado
> `XAXX` deja de encontrar a su gemelo bajo `XEXX`). Cambiar una llave poco confiable
> por otra igual de poco confiable repite el error de diseño que causó el bug. **La
> partición se elimina, no se re-llavea.**

Ese mismo agente cazó una trampa que yo habría pisado: **sin cambiar el filtro de la
rama genérica de `detectarDuplicados`** (era `rfcDe(c) === rfcNorm`, ahora pertenencia
a `RFC_GENERICOS`) **la unión habría sido un no-op** — los candidatos del otro
genérico se descartaban en silencio. Habría comiteado algo que se ve bien y no
arregla nada.

`rfcGenericoDe(cliente)` (núcleo puro en `lib/alta-generica.js`) resuelve el genérico
del cliente: RFC capturado si ya es genérico, si no se deriva del país. Decide el
`tax_id` del alta y el genérico del log — **no** el pool, que ya no se particiona.

---

## 5. Restricciones y hechos descubiertos durante la sesión

- **Operam rate-limitea `/api/v3/*` por IP** con 429 y una página HTML. Duró más de
  10 minutos y bloqueó todo el sondeo en vivo desde esta máquina.
- **`cust_ref` es único global en Operam.** El pool de dedup del cotizador está
  acotado; la restricción no. Ése es el problema de fondo que sigue vivo en #242.
- **No había NINGUNA salida por API** para la cotización atorada: un POST con
  `{customerId: 499}` moría en la revalidación de #208, que recalculaba el mismo pool
  equivocado. `crearNuevo` volvía al 406. El fix del pool no era una opción entre
  varias: era la única.
- **Barrido a las 24 h.** Una cotización con motivo `'dedup'` sin resolver **se borra**
  (`pipeline.js` `HORAS_VIDA_DEDUP=24`, `server.js` `barrerCotizacionesDedupVencidas`,
  por timer horario). El prospecto sobrevive; la cotización no. **Hay que resolver el
  picker el mismo día que aparezca.**
- **`Campos requeridos no se encontraron` quedó descartado como causa.** Los dos
  mensajes venían en la MISMA respuesta 406 (el validador de Operam acumula quejas), y
  el comentario de #92 documenta que omitir `sales_type` es aceptado.
- **Colisión entre sesiones:** hubo otra sesión trabajando en el mismo árbol. Produjo
  16 fallos fantasma en una corrida de la suite (un `data/*.json` leído a medias). El
  archivo pasaba 15/15 aislado. Al final la suite salió 2473/0 con el árbol tranquilo.

---

## 6. Lo que falta — siguiente acción exacta al reanudar

### 6.1 Curación de issues — HECHA por un agente Fable independiente

Adrián delegó la decisión sobre los issues abiertos a un agente Fable, con autoridad
para editar, fusionar o cerrar. **Ya terminó.** Cada issue que tocó lleva un comentario
firmado con su línea de atribución, auditable sin leer diffs.

Qué hizo, y por qué (su criterio, no el mío):

- **#242 — reescrito completo, título nuevo, `ready-for-human`.** Mezclaba cuatro cosas
  y tres ya estaban muertas. El nuevo cuerpo deja **solo el problema vivo** y añade una
  sección "Historia" que cierra cada hilo muerto con su commit. `ready-for-human`
  porque el fix exige elegir entre tres opciones y eso es decisión de producto.
- **#245 — intacto, `ready-for-human`.** Verificó sus tres afirmaciones contra el
  código y las tres se sostienen. No lo tocó porque estaba bien escrito.
- **#246 — intacto, `ready-for-agent`.** Verificado línea por línea; nada requiere
  decisión. Añadió una nota para quien lo implemente: tratar status != 200 y cuerpo
  no-JSON como fallo explícito.
- **#243 y #244 — sin tocar.** Cerrados y verificados en vivo.

No fusionó ni cerró ninguno: los tres describen problemas distintos y vivos.

### 6.2 Issues abiertos al cierre

- **#245 — el que cuesta dinero.** `ready-for-human`. Al elegir un cliente de Operam su
  país queda siempre en `MX`: `pcLimpiarCamposCliente` lo resetea (`app.js:2821`),
  `seleccionarClienteOperam` no lo toca (`app.js:2685`) y `GET /api/operam/clientes`
  no lo devuelve (`server.js:1667`). Consecuencia: **"es sucursal de este cliente"
  (#211) sobre un cliente extranjero crea la sucursal gravada al 16% en vez de
  exportación al 0%.** Decisiones pendientes: mapeo del `country` (texto libre, no ISO)
  y si el campo sigue siendo editable a mano.
- **#242** — `ready-for-human`. `cust_ref` único global sin salida para el vendedor.
  Tres opciones de fix en el cuerpo; la 3 (buscar por `cust_ref` en todo Operam) es la
  única que además **descubre** que el cliente ya existe bajo otro RFC.
- **#246** — `ready-for-agent`. `cargarListasPrecios` sin reintento; si falla queda
  `[]` de por vida. Se descarta en 10 s mirando si el selector de lista de precios
  tiene opciones.

### 6.3 Deuda de arquitectura (no es trabajo de este bug)

`leerClienteFormulario` **no tiene seam de prueba**: `app.js` no es importable en Node
y no hay pruebas de navegador en el repo (verificado: sin Playwright ni Puppeteer).
Ningún test ni code review habría atrapado D2. Es la segunda vez que muerde (ya pasó
en #213).

**El patrón correcto ya existe en el módulo de al lado:**
`buildAltaDarDeAltaPayload` (`public/js/alta-logica.js:980`) es puro, importable,
testeado (`alta-sec4.test.cjs`) y **recibe `customerId` y `branchId` como parámetros
explícitos** — ahí el id no se puede perder porque es parte de la firma. La cotización
no tiene su equivalente. **Esa asimetría es la que produjo el bug.**

→ Handoff a `/improve-codebase-architecture`, como prescribe el post-mortem de
`/diagnosing-bugs`.

---

## 7. Lecciones de método (ya en memoria)

- **Mis 4 hipótesis iniciales asumían la misma premisa falsa**: que Adrián estaba
  dando de alta un cliente nuevo. Estaba eligiendo uno existente. La pregunta barata
  que habría ahorrado el desvío entero era *"¿por qué camino elegiste al cliente?"*, y
  la hice **después** de haber comiteado un fix. **Confirmar el choque no es confirmar
  por qué se llegó a chocar.**
- **Retiré la hipótesis del país al recibir un dato nuevo, y era cierta.** Retirar una
  hipótesis exige la misma evidencia que sostenerla.
- **Apliqué, comiteé, pusheé y abrí issues sin pedir adelante**, varias veces, hasta
  que Adrián me frenó. Cuatro de los cinco issues (#242, #243, #245, #246) fueron
  iniciativa mía sin permiso. Abrir un issue **sí** es una acción: escribe en su
  tracker y le genera trabajo de revisión.
