# ADR-0025: El link a la cotización lleva el número de cotización, no se puede adivinar y vive en un dominio público propio

## Status

Accepted (2026-10-10). Decisión de Adrián. Complementa ADR-0009 (el número de la cotización es el de Operam).

## Context

El link que hoy recibe el cliente por WhatsApp es `https://cotizador-peltre.onrender.com/api/cotizacion/html/<id>`:

- **Lleva el id interno.** El cliente lee "Cotización 1310" en el documento y otro número en el link. Es la doble numeración que ADR-0009 quiso cerrar, colándose por la dirección.
- **Se puede adivinar.** El documento se abre sin sesión a propósito (lo abre el cliente desde WhatsApp) y el id es consecutivo: cambiando el número se abre la cotización de otro cliente, con su nombre, teléfono, domicilio y precios. Poner el número de cotización a secas no lo arregla, lo empeora: ese número viene impreso en el documento.
- **No se ve profesional:** dominio de Render y prefijo `/api`.
- **La aplicación ya no solo cotiza** y pasa a llamarse **Alabeo**. El link circula para siempre en chats de clientes; el nombre de la aplicación puede cambiar.

## Decision

- **Forma del link:** `https://cotizacion.pppeltre.mx/<número de cotización>-<terminación aleatoria>`, y el PDF en la misma dirección con `.pdf`. Una pre-cotización, que no tiene número, usa `pre-<terminación aleatoria>`.
- **La terminación aleatoria identifica la cotización; el número está para que se lea.** Si el número del link ya no es el de la cotización (una pre-cotización que después recibió número), el link lleva a la dirección vigente. Una terminación que no existe responde "no encontrada", igual que cualquier otra dirección inválida, sin confirmar nada.
- **La terminación nace con la cotización y no cambia nunca:** ni al actualizarla conservando su número de cotización ni al recibir número. Copiar crea otra cotización y por lo tanto otra terminación. No se regenera (descartado el 2026-10-10: mandar el link al cliente equivocado es improbable y no justifica la función).
- **Dominio público propio, distinto del de la aplicación.** El equipo trabaja en el dominio de la aplicación, `alabeo.pppeltre.mx`; los links que recibe el cliente salen siempre de `cotizacion.pppeltre.mx`, sin importar desde qué dominio los compartió el vendedor. Ese dominio solo abre links a la cotización; cualquier otra dirección en él lleva a la tienda, `pppeltre.mx`.
- **El id interno queda en el backend.** No aparece en nada que lea una persona.

## Considered Options

- **El número de cotización a secas:** se lee bien, pero cualquiera con un link abre los demás.
- **Pedir sesión para abrir el documento:** el cliente no tiene cuenta; es lo que se comparte.
- **Los links en el dominio de la aplicación:** cuando la aplicación cambie de nombre, los links ya enviados quedarían con el nombre viejo y ese dominio tendría que mantenerse para siempre; además el cliente no sabe qué es el nombre interno de una herramienta. "cotizacion" se explica solo.

## Links ya enviados

Los links con la forma anterior (`/api/cotizacion/html|pdf/<id>`, en cualquier dominio) siguen abriendo sin sesión **60 días** después de que salga el link nuevo, y a partir de ahí piden sesión de vendedor: dejan de abrir para el cliente. Para entonces casi todas esas cotizaciones ya vencieron, y el vendedor que lo necesite comparte el link nuevo. Se descartaron dejarlos abiertos para siempre (el hueco seguiría) y cerrarlos de golpe (los clientes con una cotización vigente se quedarían sin documento).

## Consequences

- Los dos dominios son registros del DNS de `pppeltre.mx` (Cloudflare) que apuntan al mismo servicio de Render.
- `cotizacion.pppeltre.mx` no se puede retirar nunca. `cotizador-peltre.onrender.com` sigue vivo al menos los 60 días de los links ya enviados y mientras algo externo (los avisos de Operam, la página de mayoreo de la tienda) apunte a él.
- Las cotizaciones existentes necesitan su terminación (carga única).
