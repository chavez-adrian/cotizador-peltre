# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # desarrollo con hot-reload (--watch)
npm start            # produccion
npm test             # todos los tests (0 fallas esperadas)

# Correr un test individual:
node --test test/server.test.js
node --test --test-concurrency=1 public/js/__tests__/alta-csf.test.cjs
```

> `--test-concurrency=1` es obligatorio cuando los tests comparten estado global (`globalThis.fetch` mock o `cotizaciones.json`). Sin el los tests se interfieren.

## Documentos de contexto — leer ANTES de tocar el area

- `docs/arquitectura.md` — **detalle por modulo/tema** (lib/, persistencia, catalogos, auth, quirks de Operam). Este CLAUDE.md es el resumen; el detalle vive alla.
- `GLOSSARY.md` — glosario de dominio (el glosario manda) + `docs/adr/` — decisiones de arquitectura (0001-0017).
- `PROCESO_COMERCIAL_AS_IS.md`, `SOP_crear_cliente_operam.md`, `MAPEO_CAMPOS_CLIENTE.md` — proceso comercial y flujo de clientes; leer antes de cambios a ese flujo.
- `peltre-operam.md` (raiz `_Claude/`) §12 — API de Operam: tipos de transaccion REALES (el MCP `operam-api` los etiqueta mal), cadena `order_`, contrato de escritura del quote. Consultar ANTES de explorar Operam.

## Arquitectura

Servidor Express monolitico (`server.js`) con frontend vanilla JS (`public/js/app.js`). Sin frameworks frontend, sin bundlers.

```
Browser (app.js) → /api/*                        → server.js → lib/* → Operam v3 API / envia.com
                                                             → data/*.json (persistencia en disco)
                                                             → pdfkit / html-generator
                 → /api/crear-cliente             → lib/operam-client.js → Operam
                 → /api/buscar-cliente            → lib/db.js            → Neon (clientes_log)
                 → /api/actualizar-cliente/:id                           → lib/dropbox.js → Dropbox
                 → /api/csf-from-url              → SAT (proxy QR)
```

Patron de la casa: **nucleos PUROS sin IO** compartidos por cross-import entre `server.js` y `public/js` (un modulo, varios consumidores, cero copias espejo). Ejemplos: `alta-logica.js`, `calcas-logica.js`, `cruce-identidad.js`.

### Modulos lib/ (una linea; detalle en docs/arquitectura.md)

| Modulo | Que hace |
|--------|----------|
| `operam-client.js` | Bearer auth con auto-refresh; `buildClienteBody` = UNICO mapeo cliente→Operam (ahi viven los overrides fiscales del RFC generico #121); `buscarClientes` (por NOMBRE) vs `buscarClientesPorRfc` (pool por RFC, #194) no son intercambiables; lectores read-only con retry y throttle anti-429 |
| `lista-precios-cliente.js` | Nucleo puro del cliente sin lista de precios (#285): `clienteSinListaPrecios` (sales_type 0/''/null), el texto accionable y `esErrorRateMoneda` (traduce el 406 "Debe haber al menos un rate de moneda", que en realidad dice que al CLIENTE le falta lista) |
| `cel-operam.js` | Nucleo puro de la casilla **Cel** de Operam (#339, ADR-0016): `CAMPO_CEL` = `fax` (asi viaja en la API lo que la web etiqueta "Cel No.") y `celsNoAplicados`, la verificacion por relectura que comparten los dos caminos del alta; compara por `ultimos10`, no por texto, y el unico lector es `GET /customers/:id` (el `GET /branches/:code` NO expone la llave) |
| `alta-cliente.js` | EL modulo **Alta de cliente** (#364, ADR-0017; reglas en `CODING_STANDARDS.md`): `darDeAlta(solicitud, deps = {})` recorre la secuencia unica del alta (dedup en capas, crear o reutilizar, domicilio, relectura, Cel, segmento al final) y devuelve VALORES -- alta lograda, pregunta al vendedor o bloqueo con motivo --, nunca un status HTTP; `upgradeFiscal` es su otra operacion (gate anti-fusion por RFC exacto). Bloquea antes de escribir sin vendedor con `operam_id` (#466) o con RFC real sin regimen (#492) |
| `subida-quote.js` | EL modulo **Subida del quote** (#524, ADR-0022): `subirQuote(id, solicitud, deps)` es la ENTRADA UNICA (#528) -- crea, o con folio y la marca `data.quoteDesactualizado` actualiza -- dentro del candado por id `conCandadoSubida` (ocupado no espera, NO reentrante), y devuelve VALORES con `camino` y `etapa` que `server.js` solo traduce; los errores del quote pasan por `clasificarErrorQuote` |
| `alta-generica.js` | Constructores PUROS del alta con RFC generico (#81/#83) + PUT del branch con domicilio de entrega (#96). Desde #364 son el **seam interno** de `alta-cliente.js`; la orquestacion vive alla |
| `deduplicacion.js` | RFC genericos + dedup (#78); `DEBTORS_GENERICOS` (el 417 tambien, #459); `normalizarNombre`; `poolClientesParaDedup` = EL armador del pool que comparten los sitios que combinan listas de clientes (#364); `domicilioSinEntregaRegistrada` = EL predicado del branch sin calle con CP 56577 en un cliente no generico |
| `cruce-identidad.js` | Nucleo puro del cruce por identidad (#123): CERRO/COMPRO_OTRA_COSA/SIN_SENAL, banda ±15%, normalizacion de telefono |
| `telefono-llave.js` | `ultimos10` = la UNICA llave de identidad de prospecto |
| `referencia-cliente.js` | Nucleo puro de la Referencia del cliente (#241): cadena `referencia -> nombreCorto -> nombreEntrega -> razonSocial` que comparten el `cust_ref` del quote y el documento (PDF/HTML), truncado a 60 incluido (paridad exacta con Operam); normaliza SOLO el escalon de razon social (llega en MAYUSCULAS del SAT), con el titulador unico de #293 |
| `contactos-observabilidad.js` / `contactos-observabilidad-io.js` / `contactos-observabilidad-store.js` | Observabilidad de los barridos de sync de contactos (#230): estado por barrido en Neon (ultima corrida, ultima exitosa, errores clasificados) y correo diario si se supera el umbral sin corrida exitosa; se ve en `/admin` |
| `contactos-logica.js` / `contactos-io.js` / `google-contactos.js` / `contactos-store.js` | Sync de contactos a la libreta de Google para WhatsApp Business (#224, ADR-0013): nucleo puro que devuelve el plan `{crear, actualizar, inactivar, errores}` desde tres fuentes (Operam gana a prospecto, prospecto a en linea). La mascara del `adoptado` es CORTA a proposito: unificarla con la del propio borra telefonos ajenos. Lo que pierde respaldo se inactiva, nunca se borra, con tope de seguridad |
| `pedidos-shopify-logica.js` / `pedidos-shopify-io.js` / `pedidos-shopify-store.js` / `shopify-pedidos.js` | Clientes en linea: los pedidos de la tienda como TERCERA fuente de la libreta (#255/#256, ADR-0014): nucleo puro pedido -> `{ filas, descartes }` con la regla del telefono en tres escalones (codigo explicito valido, pais de envio confirmado por `isValid`, si no se descarta con motivo); sondeo horario por GraphQL. Una tabla vacia frena TODA inactivacion |
| `higiene-clientes.js` | Reporte admin "Clientes genericos sin actividad" (#86) |
| `correccion-lista-quotes.js` | Nucleo PURO del inventario de los quotes HISTORICOS con la lista equivocada (#406): `planearCorreccionListas` reparte cada cotizacion CON SU MOTIVO y `corregible` es lo unico que toca `--apply` de `scripts/corregir-lista-quotes.mjs`. `data/cancelados.json` NO es censo de quotes cancelados: la cancelacion se verifica EN VIVO |
| `segmento-pendiente.js` | Reporte admin "Clientes con segmento pendiente" (#365): nucleo PURO sobre `clientes_log` -- que Clientes Operam siguen sin su segmento escrito, con el motivo en dos capas y la liga a Operam. El segmento intentado viaja en `fuente` (`segmento:<id>`), que ademas mantiene estas filas fuera del reporte de higiene. Una fila desaparece cuando existe una posterior del mismo cliente con resultado `segmento-escrito` |
| `almacen-domicilios.js` / `almacen-domicilios-io.js` | Reporte admin "Domicilios de entrega fuera del almacen de producto terminado" (#416): nucleo PURO contra `ALMACEN_ESPERADO`, lo no leido aparte (`sinLeer`) y las excepciones en el panel (`excepcionesAlmacen`). El IO barre en SEGUNDO PLANO a ritmo PROPIO de 1100 ms (#438): nunca `_setMinInterval`, que frena a toda la app |
| `contactos-operam.js` | EL modulo **Contactos en Operam** (#559, ADR-0024; reglas en `CODING_STANDARDS.md`): la unica puerta para leer y escribir las personas de Operam de un Cliente Operam y de sus domicilios (`test/contactos-operam-puerta.test.js` falla si algo mas lee `contacts[]`); su planeacion pura vive en `contactos-operam-logica.js`. `escribirContactoEntrega` deja al Contacto de entrega en el domicilio (crea, edita, copia o pregunta) y `contactoEntregaDelAlta` lo fija en el alta; escribe y relee por la web legacy mandando solo el boton de su paso, y solo con el interruptor `CONTACTOS_OPERAM_ESCRITURA` encendido |
| `copias-contacto-store.js` | Liga copia -> persona de origen del Contacto de entrega (#564, ADR-0024 regla 6): dato del cotizador, una por domicilio y `person_id` de origen (`buscar`/`guardar`, guardar otra REEMPLAZA), en Neon (`copias_contacto`) con fallback `data/copias-contacto.json`; la consume solo `contactos-operam.js` por `deps` |
| `contactos-domicilio.js` / `contactos-domicilio-io.js` | Contactos de cada **domicilio de entrega** (#105, #397): solo salen de `GET /api/v3/admin/contact_list`, que IGNORA sus filtros y trae los ~2100 contactos, asi que se lee completo a ritmo propio y se cachea 1 h. `contactos: null` = todavia no hay padron (no se sabe), nunca `[]`. Es SOLO lectura (la API v3 no crea contactos, #467) |
| `contacto-cotizacion.js` | Nucleo PURO de la liga FIJA Oportunidad -> Contacto (#342, ADR-0016): `celularAlNacer` (columna `contacto_celular`), `celularesDeCruce` y la migracion por cuatro fuentes; la guarda de "fija" vive en `cotizaciones-store.setContactoCelular`, que nunca pisa una liga existente |
| `ligas-contacto.js` | Nucleo PURO de la liga Contacto <-> Cliente Operam, MUCHOS A MUCHOS (#345, ADR-0016): `data.clientes_operam` `[{cliente_id, fuente}]` con la singular como primera liga; la fuente `operam` se deriva en lectura y nunca se guarda; `decidirLiga` decide `nada`/`confirmar`/`agregar` antes del POST (#460) |
| `oportunidades.js` | Nucleo PURO de las tarjetas del tablero (#340, ADR-0016): `tarjetasOportunidades` -> una tarjeta por Oportunidad, servida solo por `GET /api/oportunidades`. Perder la cotizacion cierra como Perdida la Oportunidad de la que nacio, con el mismo motivo (#481/#483); reabrirla no la revive. `correo` y `mensajeSeguimiento` de la tarjeta se resuelven aqui (#519) |
| `estado-cliente-operam.js` / `etiquetas-contacto.js` / `actividad-operam.js` | Estados del Cliente Operam y etiquetas del Contacto (#344, ADR-0016), DERIVADOS y nunca guardados; `fuenteIncompleta` declara el hueco de los quotes web no enumerables. `esProspecto` = hay ficha y NO `sinCaptura` (LA definicion). `actividad-operam.js` es el IO con cache de 1 h; el vocabulario vive en `public/js/estado-cliente-logica.js` |
| `buscador-clientes.js` | Nucleo PURO del buscador de la vista Clientes (#346, ADR-0016): una fila por Contacto con sus Clientes Operam anidados, mas los Clientes Operam sin Contacto; lo sirve `GET /api/contactos/buscar`, que comparte helpers con el buscador del paso Cliente (que no cambia) |
| `fusion-contactos.js` | EL modulo **Fusion de Contactos** (#565, enmienda a ADR-0016; reglas en `CODING_STANDARDS.md`): cuando Contactos en Operam confirma por relectura que el numero de identidad de un `person_id` cambio y el vendedor lo confirma (D4), `fundirContactos` funde el Contacto viejo en el nuevo (o lo muda) con sus Oportunidades, cotizaciones y ligas; `moverContactoCelular` es la UNICA excepcion a la liga fija de #342. No es transaccional: una falla a medias es un paso `warn` |
| `oportunidad-pre.js` / `oportunidades-store.js` / `oportunidad-pre-io.js` | La Oportunidad pre-cotizacion vive APARTE del Contacto (#343, ADR-0016) en la tabla `oportunidades`: un Contacto, varias Oportunidades. Mientras la separacion no corre, el Contacto sigue siendo su propia Oportunidad con su mismo id, y las dos tablas comparten espacio de ids |
| `tabla-prospectos.js` | Nucleo PURO de la Tabla de prospectos (#306): el navegador no calcula derivados, los pide a `GET /api/prospectos/tabla` (una fila por Oportunidad). `faltaCotizar` (#400) es EL predicado de "Ya tiene Cliente Operam, falta cotizar": liga Y ninguna cotizacion |
| `sync-operam.js` / `sync-operam-io.js` / `sync-operam-webhook.js` / `operam-webhooks-store.js` | Sync post-venta (#62, ADR-0021): el pedido se busca por DOCUMENTO (`trans_no_from` = folio) sin filtrar cliente; sin pedido propio no escribe nada y dice el `motivo`, y un pedido anulado no cuenta (#512). El barrido (#509) y la ruta de una cotizacion escriben SOLO con `{ aplicar: true }` (#510); los avisos de Operam se atienden en fila. El espejo guarda `fechaEntrega`, `fechaDespacho` y `entregaCompleta` (#531/#534) |
| `turno-barridos.js` | Turno de los barridos largos contra Operam (#509): `enTurno(nombre, fn)` forma al barrido del sync y al barrido diario de post-fixes uno detras de otro (el 2026-10-01 corrieron juntos y los dos recibieron 429); un barrido DISTINTO espera, el MISMO pedido otra vez se omite (`{ omitido: true }`). El worker de la cola de post-fixes no entra al turno |
| `backfill-operam.mjs` | Nucleo puro del backfill historico (#76); excluye cancelados |
| `cancelados.js` | Nucleo PURO de la lista de documentos ANULADOS (#408): `unirCancelados` solo AGREGA a `data/cancelados.json` (una cancelacion no se revierte). Su universo son los candidatos del BACKFILL, no un censo de Operam; el IO vive en `scripts/detectar-cancelados.mjs` |
| `recolector-genericos.mjs` | Lote historico de quotes de debtors genericos → bandeja (#124); orquestado por `scripts/rescatar-genericos.mjs` |
| `catalogo-operam.js` | Catalogo generado desde Operam (#128/#131); orquestado por `scripts/sync-catalogo.mjs`. Las **listas sin escalon** (#298/#299) son las sales_types ACTIVAS que no son escalon de volumen: van al final de `tiers` SIN `min_qty` y se precian con su fila explicita, si no base x factor. Una lista nueva del ERP queda cotizable regenerando el catalogo |
| `operam-web.js` | Web legacy (FrontAccounting): vigencia (#106), actualizar quote conservando folio (#104), descripcion por partida (#139), post-fix del segmento (#172) y cancelados. En el MISMO ProcessOrder viajan la lista (#403), el domicilio (`branch_id`, solo al actualizar, #409) y el transportista (#448) del encabezado, solo si el formulario los OFRECE: un valor ajeno hace que FA rechace el POST entero |
| `postfix-encabezado-quote.js` | Nucleo PURO del **Post-fix del encabezado del quote** (#521/#522): `FILAS_ENCABEZADO_QUOTE` declara una vez los datos que la API v3 no escribe y viajan en el ProcessOrder (vigencia, lista, domicilio, transportista y, desde #556, telefono y correo del Contacto de entrega) con los `momentos` en que aplica; la huella y el reintento de #380 recorren la misma tabla. Un dato nuevo = una fila |
| `postfix-reintento.js` / `postfix-reintento-io.js` / `postfix-pendientes-store.js` | Reintento del post-fix web del quote (#380): lo que la relectura no confirma se encola PERSISTIDO en `postfix_pendientes` y se repite con la misma escritura y backoff; un barrido diario compara SOLO contra `data.huellaQuote`, nunca recalculado. Al agotar avisa por correo a los admin y al vendedor |
| `config-store.js` | Configuracion del panel `/admin` (tipos y texturas, Evento activo, ligas, lineas de transporte #447, condiciones comerciales #324) en Neon (#276); `data/config.json` es SEMILLA y fallback; cache en memoria porque los lectores son sincronos (`leer()`) |
| `modelos-store.js` | Bloque de modelos del **Maestro de articulos** (36 filas x 32 columnas) en Neon (#310, ADR-0016); `data/modelos.json` es SEMILLA de la tabla vacia y fallback sin `DATABASE_URL`; `actualizar(modelo, campos)` solo acepta las columnas de `CAMPOS_EDITABLES`, el resto es de solo lectura hasta #304; `sinFamilia()` son los pendientes que el panel `/admin/catalogo` resalta |
| `vendedores-store.js` | Registro de vendedores (identidad, PIN en claro, rol, operam_id, tope) en Neon (#140/#141); auto-siembra desde `data/vendedores.json` si la tabla esta vacia; el PUT de admin reemplaza el registro completo, y antes `validarOperamIds` (`public/js/vendedores-logica.js`, #434) exige `operam_id` entero positivo o null y sin repetir (400) |
| `db.js` | Pool pg; `query()` retorna null sin pool (graceful); auto-crea `clientes_log` y `operam_webhooks_log` en Neon |
| `clientes-log.js` | Auditoria de altas y cambios de cliente (`clientes_log`), fire-and-forget. Desde #356 `logCliente` devuelve el id de la fila que inserto (`darDeAlta`/`upgradeFiscal` lo sacan como `logId`) y `marcarDropbox(logId, ok)` la corrige cuando la subida de la constancia resuelve: por eso `dropbox_ok` dejo de ser siempre null |
| `dropbox.js` / `dropbox-destinos.js` / `dropbox-subidas-store.js` | `upload({flujo, archivo}, ...)` es EL envoltorio de las cuatro subidas (`csf`, `calca`, `bitrix`, `pago`): el destino lo decide el FLUJO con `DROPBOX_NS_*` + `DROPBOX_PATH_*` (#357) y cada intento queda en `dropbox_subidas` con su namespace (#356/#399), sin lanzar. Fire-and-forget salvo `pago` (#485) |
| `parsear-csf.js` | Puro: extrae RFC/razon social/domicilio/regimen del PDF de CSF **y del validador QR** (#378: otras etiquetas -- `CP`, `Municipio o delegacion`, `Entidad Federativa`, `Colonia`, `Apellido Paterno` -- y el valor EN LA LINEA SIGUIENTE a su etiqueta, que solo se pliega si abajo no viene otra etiqueta); el catalogo del SAT lo cross-importa de `public/js/regimen-fiscal-logica.js` (#191) |
| `sat-qr.js` | Validador QR del SAT (#378), el respaldo cuando el PDF no da RFC: `esHostDelSat`, `htmlATexto` y la descarga por `node:https` -- **no `fetch`**, porque el SAT negocia un DH corto que OpenSSL 3 rechaza (`ERR_SSL_DH_KEY_TOO_SMALL`) y solo `opcionesTlsPara` (SECLEVEL=0 acotado a sus hosts) lo salva. `node scripts/verificar-csf-qr.mjs <url del QR>` lo verifica EN VIVO (read-only); ningun mock puede |
| `pdf-generator.js` / `html-generator.js` | PDFKit / HTML auto-contenido para WhatsApp con el mismo formato: el PDF es la **especificacion de referencia** (formato oficial de Operam) y el HTML lo traduce con **paridad en tres capas** (#326); la duplicacion de layout es deliberada y sus diferencias estan declaradas en el encabezado de `html-generator.js` |
| `calcular-envio.js` | Carrito → paquetes fisicos para envia.com; excluye `ENVIO` y la calca |
| `envia-destino-logica.js` | Nucleo PURO del destino que va a envia.com (#453): calle, colonia, municipio y estado capturados, completados por el indice de CP; sin calle DHL y Estafeta no cotizan y NO se inventa una. El estado viaja como codigo del catalogo de envia.com (MX de 3 letras), nunca crudo |
| `lalamove-logica.js` / `lalamove.js` | Tarifa Lalamove en vivo (#72): nucleo PURO (firma HMAC, vehiculos donde la carga CABE, origen fijo en la fabrica, destino = centroide del CP) + IO que nunca lanza. Es su PROPIA opcion del selector: las opciones de tarifa se comparan con `esOpcionTarifa`, nunca con `'envia'` a secas. En el quote viaja como partida `FLETE_LOCAL` |
| `tresguerras-logica.js` / `tresguerras.js` | Tarifa Tresguerras (#437) por su cotizador PUBLICO (via no oficial, sin credenciales), por `node:https` con el intermedio de Sectigo solo para su host; una tarjeta puerta a puerta "Tarifa estimada" con el precio de `purtaPuerta` (`Terrestre.error` NO es senal). En el quote va como `FLETE_FORANEO`; `node scripts/verificar-tresguerras.mjs` lo verifica en vivo |
| `extract-prices.js` | LEGADO desde el corte #131: contraste contra el Excel, ya no genera `data/precios.json` |
| `validar-cp.js` | Puro: valida CP por pais |
| `fs-reintento.js` | TODO acceso a `data/*.json` pasa por aqui (ver Trampas) |
| `red-en-pruebas.js` | Guarda contra la red REAL bajo `node:test` (#410): `fetchSinRedEnPruebas` rechaza con `ErrorRedEnPruebas` si nadie mockeo `fetch`; `corriendoBajoNodeTest` = `NODE_TEST_CONTEXT` o un `argv[1]` `*.test.*`. Fuera de pruebas es el `fetch` de siempre (ver Tests) |

### Nucleos puros del frontend (`public/js/`, una linea; detalle en docs/arquitectura.md)

| Modulo | Que hace |
|--------|----------|
| `modo-alta-logica.js` | El **Modo del alta** (#539, ADR-0023): el panel del alta y el de la actualizacion fiscal son el MISMO nodo; su modo cambia solo por transiciones puras `al*` que devuelven `{ estado, acciones }`, y en `app.js` el UNICO que lo escribe es `aplicarModoAlta` (ver Trampas) |
| `editar-cotizacion-logica.js` | Modulo HOJA (#502) con el gate `puedeActualizarCotizacion` (lo reexporta `cotizaciones-logica.js`) y `buildBotonEditarHtml`, EL boton Editar del Historial, "Cotizaciones previas" y el Pipeline; oculto con pedido (`tienePedidoAsociado`) |
| `titulo-logica.js` | EL titulador (#293): `aTitulo` es la UNICA regla "texto gritado -> Titulo" y respeta lo ya escrito en mezcla |
| `alta-logica.js` | Logica pura del alta de cliente, incluida `REGLAS_TELEFONO`, que comparten `validarTelefono` y `telefonoValido` |
| `calcas-logica.js` | Calca en el carrito (#91, ADR-0010) y precio manual de calca (#279/#280: `precioEfectivoCalca`, `validarPreciosManualesCalca`, `puedePrecioCalca`) |
| `regimen-fiscal-logica.js` | Catalogo c_RegimenFiscal del SAT + filtro por tipo de RFC (#191); lo usan el selector del alta y `lib/parsear-csf.js` |
| `telefono-widget.js` | Widget intl-tel-input vendoreado + capa estricta que avisa sin bloquear (#176), en mayoreo y en los 6 telefonos del alta |
| `origen-logica.js` | El **Origen** y su herencia (#287): la cotizacion y el cliente lo heredan del prospecto de su mismo celular y lo resuelven SIEMPRE los GET del servidor |
| `busqueda-logica.js` / `filtros-logica.js` | Buscador en vivo de las listas (#289) y selectores de filtro (#456-#458): cada vista declara sus `BUSCABLES_*`; un campo de baja cardinalidad va en selector, NUNCA en la caja de texto; las fechas se leen con `fechaLocal` (ver Trampas) |
| `cp-autollenado.js` | Regla de NO PISAR del autollenado por CP (#291) en el paso Envio y el alta completa (no en expo ni mayoreo) |
| `domicilio-entrega-logica.js` | Selector de **Domicilio de entrega** del paso Envio (#409): la regla de no pisar en los seis campos, el respaldo con la direccion del cliente que sobrevive a los cambios y el aviso (sin bloquear) del almacen que arrastra el domicilio (`ALMACEN_ESPERADO`); aqui vive `CALLE_POR_DEFINIR` |
| `resumen-cotizacion-logica.js` | EL constructor del **Resumen de la cotizacion** para WhatsApp (#307/#311/#312): un renglon por Familia, envio siempre, liga SIEMPRE al HTML |
| `moneda-cliente-logica.js` | Bloqueo por **Moneda del cliente** (#297, ADR-0015): un cliente con `curr_code` distinto de MXN se detiene en el paso Cliente y en la subida (422 `CLIENTE_MONEDA_EXTRANJERA`) |
| `estado-cliente-logica.js` | EL vocabulario de los estados del Cliente Operam y de las etiquetas del Contacto (#344/#346), que `lib/` cross-importa |
| `tier-logica.js` | Auto vs **Lista fijada** y el permiso de lista como MATRIZ (vendedor, lista) (#151-#154, #296, #300); `listaIdDeTier` (#403) traduce el tier al `sales_type` del encabezado y `esEscalonDeVolumen` es lo UNICO que tabula (#298) |
| `franja-cliente-logica.js` | La franja de a quien se cotiza (#480), armada de lo MISMO que se guarda y se sube |
| `perdida-logica.js` | `tienePedido(o)` es LA regla "tiene pedido" (#482): con pedido no hay Perdida (409); catalogo `MOTIVOS_PERDIDA` (#483) |
| `entrega-pedido-logica.js` | Fecha de despacho o de entrega en la tarjeta (#531/#534); nunca pinta el "Requerido para" como Entregado |
| `cancelada-logica.js` | **Cancelada** (#484): solo admin y con pedido, motivo libre, sin tocar Operam; no es `cancelado` (anulado en Operam) |
| `comprobante-pago-logica.js` | **Comprobante de pago** (#485/#486): archivos por EXTENSION; `faltaComprobante` es aviso, no candado |
| `contacto-entrega-logica.js` | `bloqueoContactoEntrega` (#558, ADR-0024): lo que el Contacto de entrega exige para generar o actualizar, con el `campo` a enfocar; tambien el telefono que se propone por persona (`telefonoDePersona`) y la persona elegida (`personaContactoEntrega`) |
| `volver-logica.js` | EL boton Volver (#200): `botonVolverHtml` e `ICONO_VOLVER` |

## Trampas que cuestan horas (no derivables del codigo)

- **`onclick` inline resuelve contra `window`, no contra el modulo (#112).** Si existen `function foo()` de modulo Y `window.foo = ...`, el menu dispara el de `window` y el otro queda muerto — sin error, sin sintoma en tests. Regla: un simbolo por nombre; lo invocado desde `onclick` se expone a `window` JUNTO a su declaracion. Esto NO lo ve un code review: solo aparece **ejecutando en navegador**.
- **El panel del alta y el del upgrade fiscal son EL MISMO nodo (#376, ADR-0023)**: su modo vive en `modoAlta` y cambia SOLO por `aplicarModoAlta(<transicion>)`, que ejecuta tambien lo que la pantalla hace en cada cambio (recoger el panel, candados, palomas, boton, banner); nunca asignar un campo suelto ni recoger o candar por cuenta propia. `errorAltaEnModoUpgrade` en `altaEnviarAlta` impide un alta desde un upgrade, y toda escritura que vuelve de un `await` pregunta `actualizacionVigente` (#542).
- **Llenar los campos `cl-*` NO es reponer la identidad (#394)**: Editar y Copiar reponen `pcState.cliente` con `clienteAlCargarCotizacion`, la liga del registro es FIJA en el servidor (`ligaClienteAlGuardar`) y el vendedor del documento lo decide `vendedorAlGuardar` (#405), nunca quien guarda.
- **`'none'` en el selector de envio son DOS cosas (#419)**: el default de una cotizacion nueva y el "Sin envio" elegido; las distingue `envioDecidido` (`app.js`), no la opcion. La propuesta automatica no es decision: `opt.value =` no dispara `change`, y asi debe quedar.
- **`lib/fs-reintento.js` es obligatorio para `data/*.json`** (#117), en stores Y helpers de tests: OneDrive toma locks EBUSY intermitentes que tumbaban ~1 de cada 3 corridas. Reintenta SOLO EBUSY; EPERM/ENOENT se propagan (un test depende de eso). Nunca `fs` directo.
- **Calca sin precio = null, nunca $0** (#91): el fallback a 0 imprimia calcas gratis. Las piezas de calca NO cuentan para el tier y `decorado` se manda solo en `true`; el renglon sin precio lo juzgan `importeLineaOAusente` + `textoImporteLinea` (#413) y el `?? 0` de `getPrice` es para sumar, nunca para un renglon.
- **Las llaves del PUT de cliente NO son las del GET (#169)**: se escribe `cust_name` y se lee `CustName`; se escribe `cfdi_regimen_fiscal` y se lee `regimen`. Mandar la llave de lectura = campo ignorado en silencio (asi el upgrade fiscal dejo un cliente sin razon social). El mapeo por campo vive en `DIFF_FISCAL_CAMPOS` (`write`/`read`); el PUT responde con el **eco** de lo que acepto, y eso es lo que usa `camposNoAplicados` para decirle al vendedor el motivo real.
- **Hay campos que Operam no devuelve en NINGUNA lectura (#373)**: `idcif` e `invoice_email` van `noLegible` en `DIFF_FISCAL_CAMPOS`: no se comparan (se preguntan aparte, #395) pero SI se escriben, y su unica verificacion es el eco del PUT.
- **Un default del formulario no es captura del vendedor (#248/#250)**: el diff fiscal del dedup se calcula contra `datosFiscalesDelDedup(altaState.datos)`, nunca contra el crudo (el G03 del select pisaria el S01 del cliente); lo comercial vacio sale del diff y se reporta con su motivo real (#372/#379).
- **El `?search=` de Operam NO indexa el RFC (#194)**: busca por NOMBRE; el pool por RFC solo lo da `?tax_id=` (`buscarClientesPorRfc`), y `node scripts/verificar-dedup-rfc.mjs` lo verifica EN VIVO (ningun mock puede).
- **El `cust_ref` (nombre corto) es UNICO GLOBAL en Operam (#242)**: la unicidad no respeta el RFC, asi que la dedup lo busca en el padron COMPLETO cacheado y el 406 sale como 409 `CUST_REF_DUPLICADO`; nunca desambiguar con sufijo automatico.
- **Quirks de escritura de Operam**: 200/`result:true` no garantiza nada -- releer SIEMPRE. `segmento_id` y la lista del quote no se escriben por la API v3 (post-fix web, #172/#403); `PUT /branches` es REPLACE y necesita `customer_id` y `br_ref` (#386); no hay DELETE de clientes. Detalle en `docs/arquitectura.md` §Quirks.
- **El celular ligado a otro Cliente Operam es una PREGUNTA, no un 409 (#345, ADR-0016)**: 428 `CONFIRMAR_OTRA_RAZON_SOCIAL` con `reintentar` dictado por el SERVIDOR; sin confirmar no se sube nada y al confirmar la liga se AGREGA. El 409 que queda es el de la cotizacion ya ligada a otro cliente.
- **El respaldo al sandbox de Dropbox es por AUSENCIA de configuracion, JAMAS por fallo (#357, padre #354)**: con las dos variables del flujo, un error de Dropbox RECHAZA y ahi termina. Un `catch` que reintente contra la ruta de texto reintroduce el bug: Dropbox CREA la ruta que no existe y responde 200, y asi nacio la replica fantasma del arbol de la empresa dentro del sandbox de la app.
- **El barrido del sync NO es acotado (#506, #509)**: escribe sobre TODAS las activas con pedido. Nunca usarlo aplicado como atajo de verificacion: primero `seco: true`, y una sola fila con `POST /api/admin/cotizaciones/:id/reconciliar-operam`; las dos escriben SOLO con `{ "aplicar": true }` (#510). No hay ruta para regresar una etapa.
- **El body del quote web lleva `ProcessOrder` y NUNCA `CancelOrder`** (viven en el mismo form; CancelOrder anula la cotizacion).
- **La comparacion de huella del quote (#114) es SIEMPRE local**: el cotizador manda y una edicion hecha directamente en Operam se pierde (decision explicita).
- **Codigos de calca se BUSCAN en el catalogo, nunca se concatenan**: uno inventado da 406 al subir el quote.
- **La `fecha` de una lista se lee con `fechaLocal` (`busqueda-logica.js`), nunca con `new Date` (#428)**: Neon devuelve el dia sin hora de Operam como medianoche UTC y en Mexico se pintaba, ordenaba y filtraba un dia antes.
- **Contacto de entrega: CP, nombre y celular; la calle no (D3/D3b, #557)**: generar o actualizar exige celular, nombre (sin apellido vale) y CP (`contacto-entrega-logica.js`). La calle vacia se escribe `CALLE_POR_DEFINIR` ("Por definir") y al LEER cuenta como vacia (`esCalleVacia`).
- **ASCII estricto** en codigo y commits: sin acentos, sin comillas tipograficas, sin em-dashes.

## Persistencia (reglas vigentes; historia en docs/arquitectura.md y ADR-0008/0009)

- Neon Postgres (`DATABASE_URL`) es la fuente de verdad en produccion; sin `DATABASE_URL` los stores caen a `data/*.json` (dev y tests). El disco de Render es efimero.
- **La tabla `prospectos` es la de CONTACTOS desde #343** (ADR-0016), no la de tarjetas: la Oportunidad pre-cotizacion vive en `oportunidades` y las rutas `/api/prospectos/:id/*` operan sobre ELLA. Los ids de las dos tablas salen del maximo de ambas (espacio compartido). La separacion de lo existente la aplica `node scripts/migrar-oportunidades.mjs --apply` (idempotente; dry-run por defecto), y el codigo funciona igual antes de que corra.
- **La configuracion del panel `/admin` tambien vive en Neon desde #276** (`lib/config-store.js`). `data/config.json` quedo como semilla de la tabla vacia y como fallback de dev: editarlo en un commit ya NO llega a produccion. Expo nueva o liga nueva se configuran DESDE EL PANEL, no con un commit.
- **El numero de la cotizacion ES el folio de Operam** (ADR-0009), nunca el id interno (clave tecnica de URLs). Un solo punto lo decide: `datosDocumento(entry)` en `server.js`. En la UI siempre `etiquetaFolioOperam` (`pipeline-logica.js`).
- Los GET `/api/cotizacion/pdf/:id` y `/html/:id` REGENERAN desde `data` jsonb y son el UNICO camino que genera documento; `POST /api/cotizacion` solo guarda. Van sin auth a proposito (compartir por WhatsApp).
- El flujo guarda -> espera subida a Operam -> y solo entonces los botones entregan (#504): "Ver HTML" / "Descargar PDF" aparecen con la cotizacion CONFIRMADA y sin cambios (`estadoBotonesDocumento`). Si al crear Operam falla o excede `TIMEOUT_OPERAM_MS`, sale PRE-COTIZACION explicita; al actualizar se espera sin tope.
- Regenerar una cotizacion ya subida compara contra `data.huellaQuote` y actualiza el quote conservando folio solo si cambio (#114-#116); con pedido, 409. Los campos tardios de la huella (lista #403, domicilio #415, transportista #448, vigencia #505) no cuentan como cambio si la huella guardada no los traia; la vigencia la decide el servidor al guardar (`vigenciaAlGuardar`).
- **"Cambio" se persiste (#528)**: con `requiereActualizacionOperam` el guardado escribe `data.quoteDesactualizado` y nunca la quita (la quita la actualizacion lograda). El navegador llama SIEMPRE a `POST /api/cotizacion/operam/:id` (`operarEnOperam`), que decide crear, actualizar o nada.
- Gate `puedeActualizarCotizacion`: solo con folio subido, sin pedido asociado (`data.orderOperam` o, desde #502, el pedido de `data.espejoOperam`) y mismo cliente (#104).
- Con pedido asociado (`tienePedidoAsociado`) `POST /api/cotizacion` con `cotizacionId` responde 409 `MOTIVO_CON_PEDIDO` sin escribir nada, cambie o no el quote (#529); la PRE sin pedido se sigue guardando y la salida es Copiar.

## Auth

- Rutas del cotizador: JWT de 30 dias; el registro de vendedores (ID + PIN) vive en `lib/vendedores-store.js` (Neon con fallback al JSON, #141); rol `admin` desbloquea `/api/admin/*`.
- Login de `/admin` (#440): elige al vendedor con la misma lista publica de `/` (`GET /api/vendedores`, solo id y nombre) y manda `soloAdmin: true`; `POST /api/login` rechaza entonces al no-admin con la MISMA respuesta 401 que un PIN equivocado (no confirma el PIN ni expone quien es admin). Desde #449 `/admin` y `/admin/catalogo` montan EL MISMO login (`public/js/login-admin.js`: selector, llamada y mensaje); un panel de admin nuevo lo monta, no lo copia.
- Limite de intentos del PIN (#450, `lib/limite-login.js`): 5 fallos por vendedor O por IP bloquean 15 min (429, sin revisar el PIN); vive en memoria y las suites que fallan PINes llaman `resetLimiteLogin()` en `beforeEach`.
- Rutas CSF: mismas garantias (`authMiddleware`). El ciclo de vida del cliente tiene 3 caminos autenticados: alta generica al subir cotizacion, upgrade fiscal (#85, gate anti-fusion por RFC exacto) y alta completa. Detalle en `docs/arquitectura.md` §Auth.
- `server.js` carga `.env` manualmente sin dotenv (lineas ~24-30) y PISA `process.env`.

## Tests

**Backend** (`test/`): ES modules, `node:test` + `supertest`. El app se importa sin `listen()` gracias al guard `isMain` en `server.js`. Helpers de archivos: SIEMPRE via `lib/fs-reintento.js`.

**Frontend** (`public/js/__tests__/`): CommonJS (`.cjs`), sin DOM. `app.js` NO es importable en Node (efectos de navegador en scope de modulo); las funciones puras compartidas viven en modulos intermedios (`alta-logica.js`, importado con `await import()` en un `before()`; el resto en `helpers.cjs` via `require`). No escribir tests tautologicos que afirmen literales que el codigo real nunca construye (leccion de #36).

- **El `.env` local NUNCA debe llevar `DATABASE_URL`**: varias suites escriben via stores y con pool le pegarian a Neon real. La suite de vendedores ademas la borra antes de importar `server.js` (defensa extra); el resto confia en la convencion.
- **Ninguna prueba sale a la red de Operam (#410)**: el `.env` local SI lleva `OPERAM_*`; bajo `node:test`, `lib/red-en-pruebas.js` rechaza el `fetch` nativo con `ErrorRedEnPruebas`. El aviso `Prueba sin mock de fetch` en la salida es normal; una prueba que necesite datos de Operam los mockea.
- `npm test` nombra sus dos carpetas (`test/*.test.js` y `public/js/__tests__/*.test.cjs`): sin globs Node ejecutaba `test/helpers/*.js` como pruebas. Un archivo de prueba fuera de esas dos rutas NO corre.
- Mock de Operam: `mockFetchByUrl(urlHandlers)` / `mockOperamFetch(handlers)` interceptan por substring de URL y restauran al terminar.
- **Ninguna suite hereda ni deja `data/*.json` (#411)**: `fotoDatos([rutas])` en el `before()` y `fijarDatos(ruta, valor)` para el punto de partida (`test/helpers/datos-aislados.js`); guardar y restaurar NO basta, lo que evita heredar es FIJAR.
- **El id de una cotizacion inyectada NO sale de la longitud de `data/cotizaciones.json` (#462)**: el store asigna `max(id) + 1` y resuelve con el primer `find(c => c.id === id)`, asi que con ids de dev por encima de la longitud (p. ej. `[10,11,12]`) el `snap.length + 1` de la prueba chocaba con un registro ajeno y el GET devolvia ese. Usar `idLibre(cots)` (maximo + 1) o fijar el punto de partida con `fijarDatos`.
- **La Subida del quote se prueba en el modulo y sus rutas solo la traduccion (#527)**: una regla de `lib/subida-quote.js` va a `test/subida-quote.test.js` / `test/subida-quote-alta.test.js` con los adaptadores en memoria; la traduccion valor -> HTTP va a `test/subida-quote-http.test.js`.
- Testear PDFs: pasar `_compress: false` y buscar strings con `buffer.toString('latin1').includes(str)`.

## Estandares para cambios (lo que revisa /code-review; la Cola nocturna no fusiona sin esto)

- Modulos de dominio (Alta de cliente, Subida del quote, Modo del alta, Contactos en Operam, Fusion de Contactos): sus reglas de criterio viven en `CODING_STANDARDS.md` (#559).
- Nucleos PUROS sin IO en `lib/*-logica.js` / `public/js/*-logica.js` y el IO en `server.js` o `*-io.js` (patron de la casa, ver Arquitectura y `docs/arquitectura.md`); un cambio sigue la convencion del modulo vecino mas parecido.
- Cada criterio de aceptacion (AC) automatizable tiene un test en su costura publica (rutas HTTP con supertest, funciones exportadas de los nucleos) que fallaria si el comportamiento se rompiera; el valor esperado sale del issue o de un ejemplo conocido, nunca de recomputar lo que hace el codigo (tautologico no cuenta). Lo que solo un humano puede verificar (navegador, Operam en vivo, deploy) se declara como AC HITL; no se implementa a ciegas ni se marca hecho.
- Solo lo que el issue pide: sin refactors, sin reformateo, sin features adyacentes. Un cambio de comportamiento existente que el issue no pide es un defecto.
- Commits: conventional commits en ASCII (`feat: ... (#N)`, `fix: ... (#N)`, `test:`, `docs:`). La rama termina con UN commit final (o pocos, logicos) y ninguno `wip:`; se stagea por nombre, nunca `add .` ni `add -A`; `git status` queda limpio (sin logs ni temporales).
- Trailer del commit final: `Closes #N` SOLO si TODOS los AC quedaron cubiertos por tests automatizados; con algun AC HITL, `Refs #N` y la lista de lo que queda para verificacion humana en el cuerpo.
- Un modulo, una regla no obvia o una trampa nueva: UNA oracion en la tabla o seccion de este archivo, con el estilo vecino, y el detalle (historia por ticket, mediciones, casos) en `docs/arquitectura.md`; `test/claude-md.test.js` falla si este archivo pasa su tope. Los dos son CRLF en disco: tras editarlos con node o sed, `git diff --stat` debe mostrar pocas lineas; si muestra el archivo entero, normaliza los finales de linea antes de commitear.
- `data/*.json` no cambian de forma permanente: el test que los escribe los fija y restaura (ver Tests, `datos-aislados.js`). El `.env` de un worktree lleva credenciales falsas y JAMAS `DATABASE_URL`.
- Un simbolo por nombre y lo invocado desde `onclick` expuesto a `window` junto a su declaracion (ver Trampas); `lib/fs-reintento.js` para `data/*.json`; ASCII estricto en codigo, tests, docs y commits (los textos visibles al usuario llevan acentos via entidades HTML o escapes Unicode, nunca mutilados).

## Integraciones externas

- **Operam ERP v3**: `OPERAM_URL` + `OPERAM_USER` + `OPERAM_PASSWORD`. Company ID: `346`. Bearer token.
- **Escritura de Contactos en Operam** (D6, #557): `CONTACTOS_OPERAM_ESCRITURA` = `apagado`, ids de Cliente Operam separados por coma o `todos` (ausente = apagado); gobierna toda escritura de Contactos en Operam y el paso del numero, no #556 ni D3. Vive en el dashboard de Render; las suites la fijan con `test/helpers/interruptor-contactos.js`.
- **Neon Postgres**: `DATABASE_URL`.
- **Dropbox**: `DROPBOX_REFRESH_TOKEN` + `DROPBOX_APP_KEY` + `DROPBOX_APP_SECRET`. Fire-and-forget. Destino por flujo (#357): `DROPBOX_NS_CSF`/`DROPBOX_PATH_CSF`, `DROPBOX_NS_CALCA`/`DROPBOX_PATH_CALCA`, `DROPBOX_NS_BITRIX`/`DROPBOX_PATH_BITRIX`, `DROPBOX_NS_PAGO`/`DROPBOX_PATH_PAGO` (#485; el unico flujo que NO es fire-and-forget) -- un flujo cuenta como configurado solo con AMBAS.
- **envia.com**: `ENVIA_API_KEY`. Consulta en paralelo SOLO los carriers de las **lineas de transporte** `envia` activas del panel `/admin` (#447, `public/js/lineas-transporte-logica.js`; semilla FedEx, DHL, Estafeta -- UPS ya no se ofrece); un codigo que envia.com rechaza sale como aviso con el nombre de la linea. Lalamove y Tresguerras solo cotizan con su linea activa.
- **Lalamove**: `LALAMOVE_API_KEY` + `LALAMOVE_API_SECRET` + `LALAMOVE_BASE_URL` (sandbox `https://rest.sandbox.lalamove.com`; sin la variable, produccion). Sin las llaves, "Cotizar con Lalamove" avisa que no esta configurado.
- **Tresguerras**: sin variables ni credenciales -- cotizador publico de su sitio (`lib/tresguerras.js`, via no oficial, una consulta por clic del vendedor). Si mueven la pagina, "Cotizar con Tresguerras" avisa con la liga para cotizar a mano y `node scripts/verificar-tresguerras.mjs` lo confirma en vivo.
- **Shopify**: `SHOPIFY_API_TOKEN` (`lib/shopify-pedidos.js` y `scripts/fetch-shopify-images.js`). Token de app custom del admin que **ya no se puede recrear** (ADR-0014): no se rota sin respaldo. Solo alcanza los ultimos 60 dias de pedidos.
- **SAT**: proxy en `/api/csf-from-url` para QR de CSF sin texto extraible.

## Deploy

Render.com (plan Starter: no duerme, UNA instancia). Auto-deploy desde `main`. Config en `render.yaml`; las env vars viven en el dashboard de Render, no en el yaml. `GET /health` responde el commit que sirve produccion (`commit`, de `RENDER_GIT_COMMIT`): un deploy se espera comparando contra el hash del push.

> Varias piezas asumen **un solo proceso Node** y viven en memoria: el lock `subidasOperamEnCurso`, la cola de post-fixes de vigencia, el lock del reintento de #380, `conLockComprobantes`, el turno de los barridos (#509) y la fila de avisos de Operam (#510). Con varias instancias habria que moverlas a Neon o a un lock distribuido.
