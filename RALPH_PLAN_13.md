# RALPH PLAN -- cotizador-peltre#13: Guard de RFC duplicado en flujo CSF

## Objetivo
En procesarCSF(), despues de parsear el PDF, buscar el RFC en Operam ANTES de que el usuario
toque "Crear en Operam". Si hay match:
- Mostrar banner: "Este cliente ya esta registrado en Operam (ID X -- Nombre)..."
- Cargar todos los campos del formulario con datos del cliente existente
- Cambiar boton "Crear en Operam" a "Actualizar en Operam"
- Guardar cliente_id y snapshot original en estado local (para issue #14)

## Repo
C:\Users\chave\OneDrive\Documents\_Claude\cotizador\
GitHub: chavez-adrian/cotizador-peltre rama main

## Archivos clave
- public/js/app.js -- procesarCSF() (~L1178), crearClienteDesdeCSF() (~L1258), buscarClienteOperam() (~L1348)
- public/js/__tests__/helpers.cjs -- funciones puras exportadas para tests
- public/index.html -- #btn-crear-csf, #csf-preview, #csf-status
- server.js -- GET /api/operam/clientes?q=RFC (ya existe, no cambiar)

## Estado actual
- 65 tests pasan
- Issue #12 completo: buildPreFillMap, applyPreFillMap, buildEntregaPayload, buildCsfPayload en helpers.cjs

## Iteraciones planeadas (max 10)

### Iteracion 1 -- Extraer funcion pura buildOperamPreFillMap(cliente)
Extraer la logica de llenado de campos desde seleccionarClienteOperam() a una funcion pura
testeable. Retorna objeto id->valor igual que buildPreFillMap pero con datos de cliente Operam.
Test: helpers.cjs + test que verifica que el mapa tiene los campos correctos.

### Iteracion 2 -- Extraer funcion pura buildCsfDuplicadoBanner(cliente)
Funcion pura que dado un cliente Operam retorna el texto del banner.
"Este cliente ya esta registrado en Operam (ID X -- Nombre). Sus datos han sido cargados."
Test: verifica formato del texto con id y nombre.

### Iteracion 3 -- Extraer funcion pura buildClienteSnapshot(fields, getVal)
Funcion pura que dado una lista de IDs de campos y una funcion getVal retorna objeto id->valor
(snapshot de los campos actuales del formulario, necesario para el diff del issue #14).
Test: verifica que retorna todos los IDs con sus valores.

### Iteracion 4 -- Implementar buscarRfcEnOperam(rfc, apiFetch) + integracion en procesarCSF()
Implementar la logica de deteccion en procesarCSF():
1. Llama GET /api/operam/clientes?q=RFC
2. Si hay match exacto de RFC: aplica campos, muestra banner, cambia boton, guarda estado
3. Si no hay match: flujo normal
Funciones puras: buildBusquedaRfcUrl(rfc) para testear la URL.
Test: verifica que la URL de busqueda se construye correctamente.

### Iteracion 5 -- Test de integracion de deteccion + no-regresion
Tests para buildOperamPreFillMap con datos reales, buildClienteSnapshot con campos vacios,
y verificar que el flujo sin match no altera ningun estado de la UI.

## Variables de estado a agregar
- csfClienteExistente: { id, nombre, snapshot } | null
- (csfDatosExtraidos ya existe)

## Definition of Done
- [ ] buildOperamPreFillMap extraida y testeada
- [ ] Banner aparece al parsear CSF con RFC existente (sin clic)
- [ ] Campos del formulario se llenan con datos del cliente Operam
- [ ] Boton cambia a "Actualizar en Operam"
- [ ] cliente_id y snapshot guardados en estado local
- [ ] Flujo sin match sigue igual
- [ ] Todos los tests pasan (>= 65)
- [ ] Commit por iteracion
- [ ] Push a main
