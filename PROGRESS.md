# PROGRESS — sesión 2026-08-21/22 · sincronización de contactos a Google (#224): código completo y primera carga real

Estado al cierre. **Todo el código de la spec está en `main` y desplegado en Render**
(último commit de esta sesión: `aff0d50`, suite **2664/0**). La primera carga real ya
ocurrió sola. Lo que queda es verificación humana.

> Más abajo se conserva íntegro el PROGRESS de la sesión del **406 de Operam**, que
> tiene sus propios pendientes.

---

## 1. Qué se hizo

Orquestación multi-agente con Adrián AFK: un agente por ticket, cada uno con el skill
`/mattpocock-skills:implement` incrustado verbatim, TDD en el seam acordado y
`/code-review` (dos subagentes Sonnet). Opus para el núcleo (#227, #228, #229, #231);
Sonnet para panel/correo (#230) y los fixes (#247, #249). Worktrees aislados para
paralelizar; el orquestador integró en `main` coordinándose por mensajes con la sesión
`cotizador-bug-242-245-246`, que mergeaba #242/#245/#246 en paralelo (solape solo en
`server.js`, regiones distintas, cero conflictos reales).

| Ticket | Commits | Qué |
|---|---|---|
| #227 | 59910c9, 9ce73e7 | `contactos-logica` (núcleo puro → plan), `google-contactos` (People API, fetch, refresh), `contactos-store` (tabla `contactos_google`, llave `celular10`), `contactos-io`; barrido 15 min bajo `isMain` |
| #228 | 821c571, 16ea881 | `enumerarTelefonosClientes` (3 tipos + domicilios); cliente gana al prospecto; un solo timer para las dos fuentes |
| #230 | 45cfab9 → 757a6ba | `contactos-observabilidad{,-io,-store}`, vista en `/admin`, `GET /api/admin/contactos-google`, correo diario con SMTP de mayoreo; barrido único registrado como `contactos` |
| #229 | f107ecd, 989eedb → 9bbb8aa | `leerLibreta()` paginada; clase `adoptado` con máscara corta y dos pruebas candado |
| #231 | 4adb4ab, a9400b9 | grupo `Cotizador inactivos`, `inactivo_desde` (auto-migrado), tope 20 % Y >5, freno si falta una fuente, reactivación; cero DELETE |
| #247 | ddc2e2d, 87cf93e | X - X colapsado; extensión recortada (`sinExtension`); persona en MAYÚSCULAS titulada sin excepción de tokens cortos |
| #249 | aff0d50 | 404 en PATCH → se olvida la fila del mapeo; la pasada siguiente recrea o adopta |

Cerrados además: #226 (Jorge es cliente real; Alejandro lo renombra).

## 2. La carga real (CSV del 2026-08-21)

431 contactos = 15 manuales + 379 fichas de 318 clientes + 36 prospectos + Jorge.
**Render auto-despliega `main` con las `GOOGLE_*` vivas, así que la carga corrió sola
en cuanto #227/#228 entraron** — sin respaldo CSV previo y antes de que #229 (adopción)
estuviera desplegado, lo que produjo 4 duplicados (manual + sistema). Al limpiarlos a
mano se borraron fichas del sistema (no las manuales) → 404 en cada pasada → #249.

La corrida de las 18:01 del 21 fue la primera con #247 y aplicó las ~140 correcciones.

## 3. Estado esperado tras el deploy de #249 (verificar en `/admin`)

1. Primera pasada: 4 avisos `[datos] ficha borrada en Google, se olvida del mapeo`.
2. Segunda pasada: sin errores, "Última exitosa" avanza, no sale correo. En la libreta
   "Ed" queda adoptada como "Ed Marti - Operadora Gastronomica Agua Blanca"; Emilio,
   Mayra y Jorge se recrean.
3. Los 8 clientes de prueba (487, 495-498, 503) ya limpiados en Operam pasan a la
   etiqueta "Cotizador inactivos" cuando se refresque el caché horario de clientes.

## 4. Lo que falta (todo HITL)

- **#232** — humo: panel en verde; muestra en contacts.google.com (nombres
  `Persona - Empresa`, sin X - X ni mayúsculas); Alejandro confirma nombres en WhatsApp
  Business con un cliente, un prospecto y uno que era manual; los 8 de prueba bajo
  "Cotizador inactivos". Anotar conteo y casos raros; cerrar #232 y #224.
- **#225** — a partir del **2026-08-29** mirar `/admin`: última corrida reciente y sin
  error de autorización = el permiso sobrevivió a los 7 días → cerrar. No hace falta el
  script ni dar credenciales.
- Aviso de privacidad en Shopify (línea sobre proveedores tecnológicos), fuera del repo.

## 5. Decisiones de una línea que Adrián puede cambiar

- Nombre del grupo `Cotizador inactivos` (`NOMBRE_GRUPO_INACTIVOS`, `google-contactos.js`):
  renombrarlo después deja huérfano el anterior.
- Umbral del tope de inactivación 20 % Y >5 (`contactos-logica.js`): apuesta, no medición.
- Etiquetas `Entregas` / `Facturacion` para teléfonos sin persona (`ROL_SIN_PERSONA`,
  `ETIQUETA_DOMICILIO`).
- `userDefined` del adoptado se reemplaza (un campo personalizado ajeno se perdería).
- Sin backoff de 429 en el cliente de People API.

## 6. Lecciones de método

- **Empujar a `main` es desplegar a producción con credenciales vivas.** El plan decía
  "carga a propósito y con respaldo"; el deploy automático lo volvió letra muerta. La
  próxima vez que una feature escriba en un sistema externo, gatear el barrido con una
  variable o desplegar la escritura al final.
- **Las instrucciones a humanos sobre "cuál copia borrar" fallan**, aunque la ficha del
  sistema se reconozca por su campo `origen`. El sistema tiene que tolerar borrados
  manuales (#249), no depender de que no ocurran.
- Los worktrees no traen `.env`: sin él fallan 26 tests de operam-web por `Invalid URL`.
  Copiar el `.env` (sin `GOOGLE_*` ni `DATABASE_URL`) antes de correr la suite.
- Un encadenado `a && b; c && d` en Bash sigue tras el fallo de `b`: un commit entró con
  pruebas rotas y hubo que enmendarlo. Encadenar todo con `&&` o cortar con `set -e`.

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
