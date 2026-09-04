# PROGRESS — sesión 2026-09-04 (incidente cliente 517 / cotización 1263)

## Estado: #327 y #328 CERRADOS y en producción

`main` = `cc31b22` (merge de `fix/327-328-cache-y-domicilio-quote` sobre los 12 commits que
main había avanzado, #307-#312). Suite **3271 / 0**. Render desplegando.

El sondeo que bloqueaba el merge se ejecutó y salió **positivo**.

## El sondeo (2026-09-04)

Pregunta: ¿FrontAccounting persiste `delivery_address` cuando se lo manda un `ProcessOrder`?
`deliver_to` es un `<input>`, `delivery_address` un `<textarea>` — de ahí la duda.

Método: escritura de **solo header** sobre el quote de prueba **1216** (cliente 15, el
desechable), sin tocar partidas, y restauración al terminar.

Resultado: **sí persiste**, confirmado por las tres lecturas (GET de la API, formulario
re-parseado, vista read-only). Las partidas quedaron intactas (1 línea antes, 1 después) y los
valores originales se restauraron y se verificaron.

Dos hallazgos que salieron de regalo:

- **La vista read-only sí expone el domicilio**, así que `compararQuoteVista` *podría*
  verificarlo. No se hizo — #328 autorizaba dejarlo sin verificar. Ticket aparte si se quiere.
- **El POST de solo header no toca el carrito**: es la evidencia que pedía **#331** (camino
  barato para reescrituras que solo cambian el header). Comentada ahí.

Documentado como punto 5 de `peltre-operam.md` §12.7.

## Issues de esta sesión

| # | Estado |
|---|---|
| #327 | **CERRADO** — caché del padrón (`a99da16`). Falta que Adrián verifique en prod: upgrade fiscal → el buscador sirve el nombre y el RFC nuevos de inmediato |
| #328 | **CERRADO** — domicilio de entrega en la huella (`d01c582`), sondeo positivo |
| #329 | Abierto — `contact_phone`/`contact_email` del quote nunca viajan |
| #330 | Abierto — branch del cliente degradado (`br_name` viejo, `br_address` " CP 56577") |
| #331 | Abierto — camino "solo header" para reescrituras baratas. **Ya tiene la evidencia en vivo**; falta decidir cómo se detecta el caso (la huella es hoy un solo hash) |
| #332 | Abierto — `delivery_address` omite el número interior. **Entrar junto con #329**: misma función, la migración de huella se paga una vez |
| #333 | Abierto — **decisión de dominio**: ¿la cotización guardada es documento congelado o vista viva? Necesita `/grilling` en sesión limpia, no un fix. Material en `.temporales/handoff-snapshot-cliente.md` |

## Siguiente acción al reanudar

Nada bloqueado. Lo que sigue, por orden de valor:

1. **#333** — la sesión de `/grilling` (fue el motivo del corte anterior).
2. **#329 + #332 juntos** — tocan la misma función.
3. **#331** — ya con la medición hecha.

## Estado de la cotización 1263 — OJO, SIGUE VIGENTE

**Adrián la corrigió A MANO en Operam** el 2026-09-04: dirección de entrega, lista de precios
y envío.

⚠️ **NO regenerar la 1263 desde el cotizador.** El envío y los precios son **partidas**, y la
reescritura borra todas las partidas y las re-agrega desde el snapshot local, que no sabe nada
de esos tres cambios. Con #328 ya desplegado, la primera regeneración **sí** dispara
reescritura (la huella cambió de forma). Se perdería el trabajo manual.

Si alguna vez hay que tocarla: primero re-elegir el cliente y recapturar todo en el cotizador,
y sólo entonces generar.

## Decisiones y restricciones descubiertas (se conservan)

- **`cache.ts = 0` no sirve** para invalidar: `obtenerCache` es stale-while-revalidate
  (`if (cache.mapa) return cache`), así que el vendedor que re-busca a los 2 s sigue viendo lo
  viejo mientras el refresh de ~7 s vuela.
- **El detalle y el listado de clientes traen las MISMAS llaves.** Medido en vivo contra el
  padrón completo (478 clientes, muestra de 5 incluido el 517): mismos `contacts`, `branches` y
  teléfonos, cero pérdida. Por eso meter el detalle al caché es seguro. Ningún mock puede
  demostrar esto — lección de #194.
- **`delivery_address` es columna propia del quote**, no derivada del branch. Medido: el pedido
  convertido la hereda, y el listado de pedidos la devuelve por pedido.
- **El formulario de FA declara `delivery_address` con comillas SIMPLES** (`<textarea
  name='delivery_address'>`). Un grep con comillas dobles no lo ve — así falló el diagnóstico
  inicial. El mock de la web legacy en `test/server.test.js` ya lo refleja.
- **Agregar campos a la huella hace que las guardadas no coincidan**, así que la primera
  regeneración de cada cotización ya subida pedirá una reescritura. No es un falso positivo que
  tapar: hasta #328 el domicilio del quote nunca se comparó. Documentado en
  `contenidoQuoteCambio`.
- **Push a `main` = producción** (Render auto-deploy).

## Hallazgos del code-review que se cerraron (commit 65a4f30)

- `actualizarClienteEnCache` exigía `cache.clientes` a secas; un listado que vuelve vacío deja
  `[]`, que es un caché "caliente", y se habría fabricado un padrón de **un** cliente (el freno
  del barrido de contactos de #231 sólo detecta la fuente vacía). Ahora `?.length`.
- El `refrescarIndice()` del fallo de verificación estaba en un `catch` demasiado ancho: releía
  el padrón entero aunque el caché ya estuviera al día. Acotado con `cacheAlDia`.
- Los invariantes de `actualizarClienteEnCache` no los probaba nadie (los tests pasaban igual
  con la posición rota). Tests unitarios agregados y verificados contra un sabotaje.
- Cuatro guardas duplicadas en `serializarBodyQuote` → `sustituirSiViene`.
