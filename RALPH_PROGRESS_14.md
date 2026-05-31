# RALPH PROGRESS -- Issue #14

## Estado
Iteraciones completadas: 6 / 6 - COMPLETO

## Completadas

### Iteracion 1 -- calcularDiff pure function (commit a2e1a09)
- Funcion `calcularDiff(snapshot, formValues)` exportada en `helpers.cjs`
- Retorna `{ fieldId: { anterior, nuevo } }` para campos que cambiaron
- Compara por string trim, trata null/undefined como ''
- Ignora campos que no esten en ambos lados
- 6 tests PASS (88 total)

### Iteracion 2 -- actualizarCliente en lib/operam-client.js (commit 3cadf8f)
- Funcion `actualizarCliente(id, diff)` exportada
- Hace PUT a `/api/v3/sales/customers/:id` con solo los valores nuevos del diff
- Lanza error si Operam responde result: false
- 3 tests PASS (91 total)

### Iteracion 3 -- PATCH /api/operam/clientes/:id en server.js (commit aafb555)
- Endpoint `PATCH /api/operam/clientes/:id` implementado
- Recibe `{ diff }` en body, llama actualizarCliente, devuelve `{ ok: true }` o error 503
- Requiere auth (401 sin token)
- 4 tests PASS (95 total)

### Iteracion 4 -- Frontend: diff + panel confirmacion (commit d37fd39)
- `buildConfirmacionItems(diff)` agregada a helpers.cjs y app.js
- Mapa de labels legibles para 14 campos CSF_FORM_FIELD_IDS
- `crearClienteDesdeCSF()` ramifica: modo creacion vs modo actualizacion
- Si no hay diff: muestra "No hay cambios que guardar." sin llamar backend
- Si hay diff: guarda `csfDiffPendiente`, llama `mostrarPanelConfirmacion(diff)`
- Panel de confirmacion agregado al HTML con lista de cambios
- `confirmarCambios()`: llama PATCH, muestra resultado, limpia estado
- `cancelarConfirmacion()`: oculta panel, muestra csf-preview
- `cancelarCSF()` actualizado para limpiar csfDiffPendiente
- 5 tests PASS (100 total)

### Iteracion 5 -- Edge cases y no-regresion (commit d5bd1ef)
- Tests: diff con todos CSF_FORM_FIELD_IDS detecta solo campos modificados
- Tests: sin modificaciones retorna objeto vacio para 14 campos
- Tests: todos los labels son legibles (no son field IDs)
- Tests: email null y '' se tratan igual
- Tests: orden de campos se mantiene
- 5 tests PASS (105 total)

### Iteracion 6 -- Final verification, push
- 105 tests PASS, 0 FAIL
- Push a main

## Definition of Done - CHECK
- [x] calcularDiff pura y testeada
- [x] actualizarCliente en operam-client.js testeada
- [x] PATCH /api/operam/clientes/:id en server.js
- [x] No-cambios muestra mensaje sin llamar backend
- [x] Panel de confirmacion lista campos modificados
- [x] Al confirmar, Operam recibe solo campos modificados
- [x] Error de Operam muestra mensaje claro
- [x] Todos los tests pasan (105/105)
- [x] Commit por iteracion (5 commits de funcionalidad + 1 final)
- [ ] Push a main
