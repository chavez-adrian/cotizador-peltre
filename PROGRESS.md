# PROGRESS — sesión 2026-09-04 (incidente cliente 517 / cotización 1263)

Corte planeado por contexto lleno. Todo commiteado y pusheado; nada se pierde.

## La siguiente acción exacta al reanudar

**El sondeo de escritura sobre el cliente 15 — Adrián YA lo autorizó explícitamente en
esta sesión (2026-09-04).** Es lo único que bloquea el merge de #328 a `main`.

Qué hay que probar: que FrontAccounting **persiste `delivery_address`** cuando se lo manda
un `ProcessOrder`. Es el mismo mecanismo que ya escribe `delivery_date`, `Comments` y
`cust_ref` (los tres medidos en su momento con el quote 1216), pero para este campo NO
está medido. `deliver_to` es un `<input>`; `delivery_address` es un `<textarea>` — de ahí
la duda.

Receta:
1. Rama: `fix/327-328-cache-y-domicilio-quote` (ya pusheada).
2. Cliente desechable para escrituras de prueba: **el 15, "Adrian Chavez Rosete"**.
3. Crear (o reusar) un quote de prueba suyo, correr `actualizarQuoteOperam` con un
   domicilio distinto, y **releer** para confirmar que quedó escrito.
4. `compararQuoteVista` (`lib/operam-web.js`) NO compara la dirección. Si la vista
   read-only no la expone, se deja sin verificar (mismo trato que `verificado:false`) — no
   bloquea; así lo autoriza el issue #328.
5. Si persiste → mergear a main. Si NO persiste → revertir la parte de
   `serializarBodyQuote`/`actualizarQuoteOperam` y dejar solo la huella (que igual avisa
   del cambio), y documentarlo en #328.

> **Push a `main` = producción** (Render auto-deploy). La rama no despliega.

## Qué se hizo

Diagnóstico completo (`/diagnosing-bugs`) + `/code-review` de dos ejes. **Suite 3242 / 0.**

Tres commits en `fix/327-328-cache-y-domicilio-quote`:

- `a99da16` — **#327**: el caché del padrón (`lib/indice-telefonos.js`, TTL 1 h) no se
  enteraba del upgrade fiscal, así que el buscador seguía sirviendo el nombre y el RFC
  genérico viejos. `actualizarClienteEnCache` se alimenta de la relectura que el endpoint
  ya hacía (cero llamadas extra a Operam).
- `d01c582` — **#328**: `deliver_to` y `delivery_address` no estaban en la huella del
  quote, así que corregir el domicilio de entrega no contaba como cambio y el vendedor
  recibía "el quote de Operam ya coincide" (falso). Ahora salen de `armarContenidoQuote`
  (una definición para el POST y la huella) y se reescriben por la web legacy.
- `65a4f30` — correcciones del code-review (ver abajo).

## Issues abiertos por esta sesión

| # | Qué es |
|---|---|
| #327 | Caché del padrón — **implementado**, listo para merge |
| #328 | Domicilio de entrega en la huella — **implementado**, bloqueado por el sondeo |
| #329 | `contact_phone`/`contact_email` del quote nunca viajan |
| #330 | Branch del cliente degradado (`br_name` viejo, `br_address` " CP 56577") |
| #331 | Camino "solo header" para reescrituras baratas (mejora de costo) |
| #332 | `delivery_address` omite el número interior. **Entrar junto con #329**: tocan la misma función y así la migración de huella se paga una vez |
| #333 | **Decisión de dominio**: ¿la cotización guardada es documento congelado o vista viva? Necesita `/grilling` en sesión limpia, no un fix |

Material del #333 también en `.temporales/handoff-snapshot-cliente.md` (fuera del repo).

## Decisiones y restricciones descubiertas

- **`cache.ts = 0` no sirve** para invalidar: `obtenerCache` es stale-while-revalidate
  (`if (cache.mapa) return cache`), así que el vendedor que re-busca a los 2 s sigue viendo
  lo viejo mientras el refresh de ~7 s vuela.
- **El detalle y el listado de clientes traen las MISMAS llaves.** Medido en vivo contra el
  padrón completo (478 clientes, muestra de 5 incluido el 517): mismos `contacts`,
  `branches` y teléfonos, cero pérdida. Por eso meter el detalle al caché es seguro. Ningún
  mock puede demostrar esto — lección de #194.
- **`delivery_address` es columna propia del quote**, no derivada del branch. Medido: el
  pedido convertido la hereda, y el listado de pedidos la devuelve por pedido.
- **El formulario de FA declara `delivery_address` con comillas SIMPLES** (`<textarea
  name='delivery_address'>`). Un grep con comillas dobles no lo ve — así fallé el
  diagnóstico inicial. El mock de la web legacy en `test/server.test.js` no lo reflejaba;
  ahora sí.
- **Agregar campos a la huella hace que las guardadas no coincidan**, así que la primera
  regeneración de cada cotización ya subida pedirá una reescritura. No es un falso positivo
  que tapar: hasta #328 el domicilio del quote nunca se comparó. Documentado en
  `contenidoQuoteCambio`.

## Estado de la cotización 1263 — OJO

**Adrián ya la corrigió A MANO en Operam** el 2026-09-04: dirección de entrega, lista de
precios y envío.

⚠️ **NO regenerar la 1263 desde el cotizador.** El envío y los precios son **partidas**, y
la reescritura borra todas las partidas y las re-agrega desde el snapshot local, que no
sabe nada de esos tres cambios. Con #328 desplegado, la primera regeneración **sí**
dispara reescritura (la huella cambió de forma). Se perdería el trabajo manual.

Si alguna vez hay que tocarla: primero re-elegir el cliente y recapturar todo en el
cotizador, y sólo entonces generar.

## Hallazgos del code-review que ya se cerraron (commit 65a4f30)

- `actualizarClienteEnCache` exigía `cache.clientes` a secas; un listado que vuelve vacío
  deja `[]`, que es un caché "caliente", y se habría fabricado un padrón de **un** cliente
  (el freno del barrido de contactos de #231 sólo detecta la fuente vacía). Ahora `?.length`.
- El `refrescarIndice()` del fallo de verificación estaba en un `catch` demasiado ancho:
  releía el padrón entero aunque el caché ya estuviera al día. Acotado con `cacheAlDia`.
- Los invariantes de `actualizarClienteEnCache` no los probaba nadie (los tests pasaban
  igual con la posición rota). Tests unitarios agregados y verificados contra un sabotaje.
- Cuatro guardas duplicadas en `serializarBodyQuote` → `sustituirSiViene`.

## Pendientes de decisión de Adrián

- Nada bloqueante salvo el sondeo, que ya autorizó.
- #333 quiere sesión de `/grilling` limpia (era el motivo del corte).
