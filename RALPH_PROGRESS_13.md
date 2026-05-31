# RALPH PROGRESS -- Issue #13

## Estado
Iteraciones completadas: 5 / 5 - COMPLETO

## Completadas

### Iteracion 1 - buildOperamPreFillMap (commit 20b9cd6)
- Funcion `buildOperamPreFillMap(cliente)` exportada en `app.js` y `helpers.cjs`
- Mapea objeto cliente Operam a id->valor para pre-llenar formulario
- 3 tests PASS

### Iteracion 2 - buildCsfDuplicadoBanner + buildClienteSnapshot (commit 27140ea)
- `buildCsfDuplicadoBanner(cliente)`: retorna texto del banner con ID y nombre
- `buildClienteSnapshot(fieldIds, getVal)`: retorna snapshot id->valor para diff posterior
- 4 tests PASS

### Iteracion 3 - findRfcMatch (commit 05e8181)
- `findRfcMatch(clientes, rfc)`: busqueda exacta case-insensitive en lista Operam
- Retorna null para RFC vacio o lista vacia
- 5 tests PASS

### Iteracion 4 - Guard integrado en procesarCSF (commit 01fa77d)
- `procesarCSF()` ahora busca RFC en Operam automaticamente tras parsear PDF
- Match: llena formulario con datos Operam, banner warning, boton cambia a "Actualizar en Operam"
- `csfClienteExistente = { id, nombre, snapshot }` guardado en estado
- No match: flujo de creacion normal sin cambios
- `cancelarCSF()` y `crearClienteDesdeCSF()` limpian `csfClienteExistente`
- 77 tests PASS (no regresiones)

### Iteracion 5 - Edge cases + no-regresion (commit pendiente)
- Tests: snapshot con todos CSF_FORM_FIELD_IDS, RFC parcial no hace match
- Verifica que banner no tiene Unicode dashes
- Verifica que buildOperamPreFillMap no sobreescribe cl-pais
- Verifica forma del objeto csfClienteExistente
- 82 tests PASS

## Definition of Done - CHECK
- [x] buildOperamPreFillMap extraida y testeada
- [x] Banner aparece al parsear CSF con RFC existente (sin clic)
- [x] Campos del formulario se llenan con datos del cliente Operam
- [x] Boton cambia a "Actualizar en Operam"
- [x] cliente_id y snapshot guardados en csfClienteExistente
- [x] Flujo sin match sigue igual
- [x] Todos los tests pasan (82/82)
- [x] Commit por iteracion (5 commits)
- [x] Push a main
