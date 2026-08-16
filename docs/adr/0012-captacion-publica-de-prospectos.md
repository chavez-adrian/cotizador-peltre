# ADR-0012: Captación pública de prospectos (formulario de mayoreo)

- **Estado:** Aprobado (2026-08-15). Decisión de Adrián.
- **Antecedentes:** #57 (alta de prospecto sin vendedor, `POST /api/prospectos/sin-asignar`, que dejó la exposición pública como decisión posterior — este ADR es esa decisión), ADR-0004 (CRM mínimo de prospectos), #153 (permiso por checkbox de vendedor, patrón que reusa el permiso de asignación), CONTEXT.md §"Captura pública (formulario de mayoreo)".
- **Investigación de soporte:** `docs/research/formulario-mayoreo-captura.md` (2026-08-15).

## Contexto

La suscripción de Bitrix24 vence el 2026-08-21 y con ella muere el formulario de captación embebido en la página de mayoreo de Shopify. Se decidió reemplazarlo con un formulario propio servido por el cotizador, que escribe prospectos directamente en el pipeline (etapa No Asignado). Eso obliga a tres decisiones que un lector futuro encontrará sorprendentes sin este contexto.

## Decisión

### 1. Existe exactamente un punto de entrada público de escritura, y su respuesta es opaca

Todo el cotizador exige JWT; el formulario de mayoreo introduce la única ruta de escritura sin autenticación (el prospecto es un desconocido en internet). Sus defensas: Cloudflare Turnstile verificado server-side, campo honeypot y rate limit por IP (en memoria — válido mientras Render corra una sola instancia, misma restricción que `subidasOperamEnCurso`).

La respuesta pública es **siempre la misma** ("gracias, te contactamos"), sin importar si por dentro el celular ya era prospecto, ya era cliente de Operam, o se registró evento en una tarjeta existente. La alternativa obvia — reusar las respuestas informativas del endpoint autenticado ("este celular ya lo atiende X", "es del cliente Y") — convertiría el formulario en un oráculo para enumerar la cartera de clientes marcando teléfonos. La regla de Visibilidad del glosario aplica dentro del equipo; hacia internet no se revela nada.

### 2. Turnstile es la única dependencia de terceros en runtime del formulario

La regla de la casa es vendorear todos los assets (sin CDNs). Turnstile no puede cumplirla: Cloudflare exige cargar `challenges.cloudflare.com/turnstile/v0/api.js` desde sus servidores y prohíbe proxiarlo o cachearlo (así rotan sus defensas anti-bot sin avisar). Se acepta como **excepción única y deliberada**: no es descuido, y no es precedente para introducir otros CDNs. Si Cloudflare está caído, el formulario no se puede enviar — se acepta ese modo de falla a cambio de la protección. Precisión ratificada al implementar #162 (2026-08-16): ese fail-closed aplica al visitante que no obtuvo token porque el widget no cargó; si el visitante SÍ obtuvo token y lo que falla es la llamada de red servidor→siteverify, la captura pasa (fail-open, precedente Dropbox/envia.com: un tercero caído no mata una captura propia) — solo un token que Cloudflare evalúa y rechaza explícitamente descarta el envío. Detalle en `lib/turnstile.js`.

### 3. El catálogo postal es autohospedado (GeoNames), no un servicio externo

La resolución CP → ciudad/estado (México, US, Canadá) se sirve desde un índice generado a partir de los datos públicos de GeoNames (~2.3 MB JSON, ~384 KB gzip) cargado en memoria en el único proceso Node. Se evaluó y rechazó todo el mercado de servicios (zippopotam.us sirve datos congelados de 2019 — verificado con el CP 56530 de Ixtapaluca; Google/COPOMEX/Smarty/Loqate agregan llave, cuota, latencia y riesgo de proveedor que a decenas de envíos al mes no compran nada). Consecuencias asumidas: el índice se refresca manualmente con un script de sync cuando haga falta, y un CP nuevo que no resuelva degrada al campo de ciudad manual — el respaldo que existe de todas formas. Trampas del dataset mexicano documentadas en la investigación: la "ciudad" es el municipio (`admin name2`, no la colonia de `place name`) y "Distrito Federal" se normaliza a CDMX.

## Consecuencias

- El wrapper público (`POST /api/prospectos/publico`) reusa la validación y los guardrails de dedup de #57; lo que agrega es la capa de defensa y la opacidad. La lógica de dominio no se duplica.
- El rate limit en memoria y el índice postal en memoria refuerzan la restricción existente de instancia única de Render (ya documentada en CLAUDE.md §Deploy).
- Un lead que llega fuera de horario depende de la notificación por correo y de la cola Hoy (que adopta las tarjetas No Asignado para quien tiene el permiso de asignación) — no de que alguien abra el tablero por iniciativa propia.
