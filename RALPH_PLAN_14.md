# RALPH PLAN -- cotizador-peltre#14: Actualizar cliente existente en Operam con diff

## Objetivo
Cuando el boton "Actualizar en Operam" es clicado en el flujo CSF:
1. Calcular diff entre snapshot guardado y valores actuales del formulario
2. Si no hay cambios: mostrar "No hay cambios que guardar" en csf-status, no llamar backend
3. Si hay cambios: mostrar panel de confirmacion listando campos modificados
4. Al confirmar: llamar PATCH /api/operam/clientes/:id con solo el diff
5. Al cancelar: ocultar panel, volver a estado de edicion

## Repo
C:\Users\chave\OneDrive\Documents\_Claude\cotizador\
GitHub: chavez-adrian/cotizador-peltre rama main

## Archivos clave
- public/js/app.js -- crearClienteDesdeCSF() modificada, nuevas funciones de UI
- public/js/__tests__/helpers.cjs -- exportar calcularDiff
- test/operam.test.js -- test del nuevo endpoint PATCH
- server.js -- nuevo endpoint PATCH /api/operam/clientes/:id
- lib/operam-client.js -- nueva funcion actualizarCliente(id, diff)

## Estado actual
- 82 tests pasan (issue #13 completo, no pusheado)
- csfClienteExistente = { id, nombre, snapshot } disponible
- CSF_FORM_FIELD_IDS definido en app.js

## Iteraciones planeadas

### Iteracion 1 -- calcularDiff pure function
Funcion pura: dado snapshot (id->val previo) y formValues (id->val actual),
retorna objeto con solo los campos que cambiaron: { fieldId: { anterior, nuevo } }
- Ignora campos que no estan en ambos lados
- Compara por string trim
- null/undefined/'' se tratan como ''
Test: csf-diff.test.cjs en __tests__/

### Iteracion 2 -- actualizarCliente en lib/operam-client.js
Funcion que hace PUT a /api/v3/sales/customers/:id con los campos del diff
- Solo los valores nuevos (no el objeto {anterior, nuevo})
- Lanza error si result: false
Test: unitario mockando fetch

### Iteracion 3 -- PATCH /api/operam/clientes/:id en server.js
Nuevo endpoint que:
- Recibe { diff } en body
- Llama actualizarCliente(id, diff)
- Devuelve { ok: true } o error
Test: test/operam.test.js con mockFetchByUrl

### Iteracion 4 -- Frontend: detectar diff en crearClienteDesdeCSF
Cuando csfClienteExistente != null (modo actualizacion):
- Calcular diff entre snapshot y form actual
- Si vacio: mostrar "No hay cambios que guardar" y return
- Si hay cambios: mostrar panel de confirmacion con lista de campos
Test: csf-guard.test.cjs verificando comportamiento de no-cambios

### Iteracion 5 -- Frontend: panel de confirmacion completo
- mostrarPanelConfirmacion(diff): muestra panel con campos modificados
- confirmarCambios(): llama PATCH, muestra resultado, limpia estado
- cancelarConfirmacion(): oculta panel
Test: csf-guard.test.cjs o nuevo archivo csf-actualizar.test.cjs

### Iteracion 6 -- No-regresion + edge cases
- Flujo de creacion sin match sigue igual
- Error de Operam muestra mensaje claro
- Verificar todos los tests pasan

## FIELD LABELS para mostrar en panel de confirmacion
Mapa de field ID -> nombre legible:
- cl-razon-social: "Razon Social"
- cl-nombre-corto: "Nombre Corto"
- cl-rfc: "RFC"
- cl-cp-fiscal: "CP Fiscal"
- cl-telefono: "Telefono"
- cl-nombre-entrega: "Nombre de Entrega"
- cl-calle: "Calle"
- cl-num-int: "Num Interior"
- cl-colonia: "Colonia"
- cl-cp-entrega: "CP Entrega"
- cl-municipio: "Municipio"
- cl-estado: "Estado"
- cl-cel-entrega: "Celular Entrega"
- cl-email-entrega: "Email Entrega"

## Definition of Done
- [ ] calcularDiff pura y testeada
- [ ] actualizarCliente en operam-client.js testeada
- [ ] PATCH /api/operam/clientes/:id en server.js
- [ ] No-cambios muestra mensaje sin llamar backend
- [ ] Panel de confirmacion lista campos modificados
- [ ] Al confirmar, Operam recibe solo campos modificados
- [ ] Error de Operam muestra mensaje claro
- [ ] Todos los tests pasan (>= 82)
- [ ] Commit por iteracion
- [ ] Push a main al final
