# PROGRESS — sesion 2026-08-20 (#234 vCard de la alerta de mayoreo rota en iPhone)

## Que se hizo y por que

Adrian reporto que la ficha `.vcf` adjunta a la alerta de captura publica de mayoreo
"solo sirve para Android" y pidio agregar "la version equivalente para iPhone".

**La premisa era falsa y ese reencuadre es el hallazgo principal de la sesion.**
`.vcf` (vCard) ES el formato de iPhone — Apple es practicamente la implementacion de
referencia del estandar. El sintoma real que reporto ("la empresa se guarda como
nombre") es la firma exacta de una vCard 3.0 **sin la propiedad `N:`**, que en esa
version es obligatoria. Android la deduce de `FN:`; Contactos de Apple, sin `N:`,
interpreta la ficha como ficha de empresa y promueve `ORG:` a titulo del contacto.

El arreglo es una linea, no un archivo nuevo.

**Segundo hallazgo, que elimino toda heuristica de particion del nombre:** el
formulario publico YA pide Nombre y Apellido como dos campos obligatorios separados
(`public/mayoreo.html`); se aplanan en `unirNombre()` (`public/js/mayoreo-logica.js`)
solo para la tarjeta del pipeline. Pero `dispararAlertaMayoreo` (`server.js`) ya
alcanza el cuerpo CRUDO del formulario — de hecho ya toma de ahi `cargo` y el texto
libre de "Otro", precisamente porque no sobreviven a `buildCapturaMayoreo`. El
apellido viaja por esa misma via, exacto, sin adivinar.

Sesion de puro diseno: grilling -> spec -> desglose en tickets. **Cero cambios de
codigo.**

## Estado exacto

Working tree: solo este `PROGRESS.md`. Ningun archivo de codigo tocado. Suite no
ejecutada (no hacia falta: no se toco codigo).

Publicado en GitHub (`chavez-adrian/cotizador-peltre`):

- **#234** — spec/PRD completa. Cuerpo actualizado al final de la sesion para que la
  seccion de siglas refleje la regla vigente de #235 (la version original aceptaba
  suavizar TODAS las siglas) y para incluir la tabla de desglose en tickets.
- **#235** — capitalizar nombre/apellido/empresa al capturar. Sin bloqueo.
- **#236** — emitir `N:` en la vCard. Sin bloqueo. **Cierra el bug reportado, solo.**
- **#237** — `TITLE:` (cargo) + `URL:` (sitio web) en la ficha. Bloqueado por #236.
- **#238** — `NOTE:` fechada con contexto comercial. Bloqueado por #237.
- **#239** — nombrar el adjunto con el prospecto + declarar charset UTF-8. Sin bloqueo.

Los cinco con etiqueta `ready-for-agent`; #236 lleva ademas `bug`. Cada cuerpo es un
brief autocontenido (que construir, criterios de aceptacion, seams de prueba con su
prior art, verificacion manual). No necesitan mas contexto que sus lecturas obligatorias.

## Decisiones tomadas

- **Se queda en vCard 3.0.** Es lo que mejor digieren Contactos de Apple y el CardDAV
  de Google (confirmado en `docs/research/sincronizacion-contactos-google.md`). Subir
  a 4.0 tambien quitaria el sintoma —ahi `N:` es opcional— pero pierde compatibilidad
  con lectores viejos sin ganar nada.
- **NO se pliegan las lineas a 75 octetos** pese al `SHOULD` del RFC. La `NOTE`
  etiquetada va a exceder ese ancho. Desviacion consciente: iOS y el importador de
  Google aceptan lineas sin plegar. Primer lugar donde mirar si algun lector se
  atraganta en el futuro.
- **Capitalizacion:** particulas del espanol (`de del la las los y`) en minuscula
  salvo como primera palabra del campo. **Siglas:** un token en mayusculas de hasta 4
  letras se preserva SOLO si el campo no viene entero en mayusculas. El criterio de
  largo por si solo NO sirve — `JUAN` tiene 4 letras, asi que preservar todo token
  corto convertiria `JUAN PEREZ` en `JUAN Perez`, peor que hoy. El contraste del
  campo es la unica senal real. Encima, lista fija que se respeta siempre:
  `SA CV RL SC CDMX FEDEX DHL UPS`.
- **La normalizacion se aplica al GUARDAR**, no al mostrar: un solo lugar corrige y
  la tarjeta, el correo y la ficha heredan. El dato crudo se pierde; asumido.
- **Dos normalizaciones distintas que no deben confundirse:** el nombre del ARCHIVO
  va sin acentos (restriccion de clientes de correo); el nombre del CONTACTO los
  conserva siempre.
- **La funcion de capitalizacion NO puede llamarse `normalizarNombre`** — ese simbolo
  ya existe en `lib/deduplicacion.js` con otro proposito (tokenizar para comparar
  candidatos en la dedup).
- **El nombre del archivo lo decide el NUCLEO PURO**, que pasa a devolver
  `{ ..., vcard, vcardFilename }`; el wrapper de IO queda como pasamanos. Motivo: toda
  la logica de la ficha en un unico seam puro ya existente, en vez de esconder la
  normalizacion detras del mock de nodemailer.
- **La fecha la inyecta quien llama**, nunca el nucleo puro (mismo contrato que
  `buildCapturaMayoreo(form, fechaISO)`). Hoy `server.js` calcula el instante en linea
  al armar la captura; hay que subirlo a una constante local y pasarlo tambien a la
  alerta en los TRES puntos donde se dispara.
- **El consentimiento de promociones (LFPDPPP) NO entra en la nota de la vCard.** Su
  fuente de verdad es la tarjeta del prospecto; congelarlo en la agenda personal de un
  vendedor invita a usar una copia obsoleta.

## Restricciones descubiertas

- Los cuatro seams de prueba de esta area YA EXISTEN; no hay que abrir ninguno:
  nucleo puro de la alerta, wrapper de IO con nodemailer inyectado, endpoint publico
  via `_inyectarAlertaMayoreo`, y la suite de logica de mayoreo del frontend. Hay
  prior art exacto para el test del apellido: el test de #165 que verifica que el
  texto libre de "Otro" viaja por separado.
- **Ningun test puede confirmar el arreglo de fondo.** Que Contactos de Apple importe
  bien la ficha solo lo prueba un iPhone real — misma clase de trampa que el
  `onclick`/`window` de #112 que CLAUDE.md ya documenta como invisible en code review.
- Nada de esto es retroactivo: la ficha se genera al vuelo en cada correo, asi que los
  prospectos ya capturados y los contactos ya guardados mal en el telefono de Adrian
  NO se tocan. Si quiere recuperarlos, es ticket aparte.
- No colisiona con el sync de contactos a Google (#224 / #225-#232): ese empuja a UNA
  cuenta de Gmail via People API; esto sirve a cada vendedor en su propio telefono.

## Siguiente accion exacta al reanudar

Lanzar agentes implementadores sobre **#235, #236 y #239 EN PARALELO** — los tres
estan sin bloqueo y tocan modulos distintos. El cuerpo de cada issue es el brief
completo.

Despues, en serie: **#237** (necesita #236 cerrado) y luego **#238** (necesita #237).
Van encadenados porque los tres reescriben el mismo constructor `vcardDeProspecto`.

Si hay que priorizar una sola cosa: **#236**, que es la unica que cierra el bug que
Adrian reporto. Las otras cuatro son acompanamiento.

Al cerrar cada ticket queda **verificacion manual a cargo de Adrian**: capturar una vez
el formulario publico de mayoreo y abrir el correo resultante en un iPhone real.
