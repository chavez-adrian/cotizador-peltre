# ADR-0003: Unificar el alta de cliente en el cotizador principal

## Status

Accepted

## Context

Actualmente el flujo de alta de cliente vive en `csf-upload.html` (herramienta standalone sin JWT) y el cotizador principal vive en `index.html` (con JWT). El vendedor debe usar dos herramientas distintas para lo que es un solo flujo: identificar al cliente y cotizar. Con el rediseño del alta (deduplicación, selección de cliente existente, edición de configuración comercial, creación de domicilio, contactos), `csf-upload.html` se convierte en una pantalla de gestión de clientes de pleno derecho — demasiado compleja para ser una herramienta standalone auxiliar.

## Decision

El flujo de alta y gestión de cliente se integra en el cotizador principal (`index.html`). `csf-upload.html` se depreca.

El vendedor inicia siempre en el cotizador. Si el cliente no existe en Operam, el flujo de alta se abre dentro del mismo cotizador sin cambiar de herramienta. Al terminar el alta, el cliente queda seleccionado y el vendedor continúa a la cotización sin interrupciones.

## Consequences

- El vendedor tiene un solo punto de entrada para todo el flujo comercial: buscar cliente → (si no existe) dar de alta → cotizar.
- `csf-upload.html` se mantiene temporalmente como fallback hasta que el flujo unificado esté en producción y validado.
- El alta de cliente ahora requiere JWT (el vendedor debe estar autenticado). Esto es más seguro y consistente con el resto del cotizador.
- La ruta `/api/crear-cliente` conserva su interfaz pero pasa a ser invocada desde el cotizador principal en vez de desde `csf-upload.html`.
- El frontend de `index.html` crece significativamente. Considerar si alguna parte del flujo de alta merece extraerse como módulo JS independiente para mantener manejable `app.js`.
