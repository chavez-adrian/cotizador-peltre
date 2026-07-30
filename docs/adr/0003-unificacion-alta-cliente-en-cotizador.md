# ADR-0003: Unificar el alta de cliente en el cotizador principal

## Status

Accepted — implementado y cerrado (2026-06-07, cadena #32/#33/#34/#35/#38, epica #36)

## Context

Actualmente el flujo de alta de cliente vive en `csf-upload.html` (herramienta standalone sin JWT) y el cotizador principal vive en `index.html` (con JWT). El vendedor debe usar dos herramientas distintas para lo que es un solo flujo: identificar al cliente y cotizar. Con el rediseño del alta (deduplicación, selección de cliente existente, edición de configuración comercial, creación de domicilio, contactos), `csf-upload.html` se convierte en una pantalla de gestión de clientes de pleno derecho — demasiado compleja para ser una herramienta standalone auxiliar.

## Decision

El flujo de alta y gestión de cliente se integra en el cotizador principal (`index.html`). `csf-upload.html` se depreca.

El vendedor inicia siempre en el cotizador. Si el cliente no existe en Operam, el flujo de alta se abre dentro del mismo cotizador sin cambiar de herramienta. Al terminar el alta, el cliente queda seleccionado y el vendedor continúa a la cotización sin interrupciones.

## Consequences

- El vendedor tiene un solo punto de entrada para todo el flujo comercial: buscar cliente → (si no existe) dar de alta → cotizar. Implementado como acordeon "+ Nuevo cliente" con tabs "Cargar CSF"/"Captura manual" (#27-#31). ~~El boton "+ Nuevo cliente" es el punto de entrada.~~ Superado por el PRD #79 (ADR-0006): #82 quito el acordeon de la pantalla de entrada (el cliente ya no se da de alta ahi, nace generico al cotizar, #81); las tabs "Cargar CSF"/"Captura manual" siguen vivas dentro del mismo `#panel-alta-cliente`, ahora con una entrada nueva desde el chip "Fiscal" de la tarjeta, reorientadas al upgrade del cliente generico (#85) en vez de al alta de uno nuevo.
- ~~`csf-upload.html` se mantiene temporalmente como fallback hasta que el flujo unificado esté en producción y validado.~~ Retirado por completo (#35) — el archivo ya no existe en disco; `GET /csf-upload.html` cae al catch-all SPA.
- El alta de cliente ahora requiere JWT (el vendedor debe estar autenticado). Esto es más seguro y consistente con el resto del cotizador. Las 5 rutas CSF (`/api/crear-cliente`, `/api/buscar-cliente`, `/api/actualizar-cliente/:id`, `/api/log`, `/api/csf-from-url`) usan `authMiddleware`, verificado con sondeo real con/sin token (#35). Una sexta ruta CSF se agrega despues, misma proteccion: `PUT /api/actualizar-cliente-fiscal/:id` (#85).
- La ruta `/api/crear-cliente` conserva su interfaz, ahora invocada unicamente desde el acordeon del cotizador.
- Gap real detectado durante el cierre (capacidad de actualizar datos fiscales de un cliente existente desde CSF, con diff y confirmación) se resolvió como #38 antes de cerrar la cadena.
