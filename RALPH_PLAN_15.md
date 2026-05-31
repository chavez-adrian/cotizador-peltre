# RALPH PLAN -- Issue #15

## Objetivo
Guard de RFC duplicado en captura manual de cliente.
Al salir del campo `cl-rfc` en `#panel-manual`, buscar en Operam. Si hay match: mostrar banner, cargar campos, habilitar flujo de actualizacion.

## Tareas

### Tarea 1 -- buildManualRfcStatusBanner (funcion pura)
- Nueva funcion `buildManualRfcStatusBanner(cliente)` en helpers.cjs
- Reutiliza misma logica que `buildCsfDuplicadoBanner` (misma cadena)
- O simplemente es un alias / wrapper
- Tests en `manual-rfc-guard.test.cjs`

### Tarea 2 -- shouldTriggerRfcSearch (funcion pura)
- `shouldTriggerRfcSearch(rfc)` retorna true si rfc.trim().length >= 12
- Test: rfc de 12 chars retorna true, 11 false, vacio false

### Tarea 3 -- HTML: elemento #manual-rfc-status en panel-manual
- Agregar `<div id="manual-rfc-status" style="display:none"></div>` en `#panel-manual`
- El panel manual actualmente solo tiene un section-divider

### Tarea 4 -- logica de blur en app.js
- Event listener en DOMContentLoaded para `blur` en `cl-rfc`
- Solo se dispara si el panel manual esta activo (panel-manual visible)
- Solo si shouldTriggerRfcSearch(rfc)
- Llama `buscarRfcEnManual(rfc)`

### Tarea 5 -- funcion buscarRfcEnManual(rfc)
- Llama `/api/operam/clientes?q=rfc`
- Si match: applyPreFillMap + buildClienteSnapshot + csfClienteExistente = ... + mostrar banner + mostrar #csf-panel-confirmacion (o un equivalente en el panel manual)
- Si no match: no hace nada
- Si falla: mostrar aviso no bloqueante "No se pudo verificar en Operam"

### Tarea 6 -- Mostrar boton "Actualizar en Operam" en panel manual
- Revisar si el `#csf-panel-confirmacion` es suficiente o si se necesita un elemento adicional
- El panel manual no tiene ese elemento; el panel csf si lo tiene
- Opcion A: reusar #csf-panel-confirmacion (requiere que confirmarCambios() no dependa del panel CSF)
- Opcion B: agregar un boton separado en panel-manual que dispare confirmarCambios()
- Decision: Agregar `#manual-panel-confirmacion` en panel-manual, o mover el panel de confirmacion fuera de panel-csf

## Archivos a modificar
- `public/js/__tests__/helpers.cjs` -- nuevas funciones puras
- `public/js/__tests__/manual-rfc-guard.test.cjs` -- tests nuevos
- `public/js/app.js` -- event listener + buscarRfcEnManual
- `public/index.html` -- #manual-rfc-status + panel confirmacion en panel-manual

## Iteraciones estimadas
1. Tests para shouldTriggerRfcSearch + implementacion en helpers.cjs
2. HTML: agregar #manual-rfc-status y panel confirmacion en panel-manual
3. Funcion buscarRfcEnManual + event listener en app.js
4. Edge cases: error de Operam, RFC < 12 chars, panel no activo
5. Integracion final + tests de no-regresion
