# RALPH PLAN — cotizador-peltre#12: Flujo CSF completo

## Objetivo
Corregir el flujo de alta de cliente desde CSF en el cotizador:
1. Pre-llenar campos de facturación y entrega **al parsear** el PDF (no después de crear)
2. Incluir sub-objeto `entrega` en el payload a operam-server
3. Limpiar el bloque de pre-llenado que quedó en `crearClienteDesdeCSF`

## Repo
`C:\Users\chave\OneDrive\Documents\_Claude\cotizador\`
GitHub: `chavez-adrian/cotizador-peltre` rama `main`

## Archivos clave
- `public/js/app.js` — frontend principal (~2500 líneas, ES modules)
- `public/index.html` — HTML con los campos del formulario de cliente
- Sección CSF en app.js: líneas ~1131-1302
  - `procesarCSF()` — línea 1134: parsea PDF, asigna `csfDatosExtraidos` en línea 1162
  - `crearClienteDesdeCSF()` — línea 1210: crea en Operam, ACTUALMENTE pre-llena aquí (bug)

## Campos existentes en index.html (ya existen, no crear nuevos)
**Facturación:**
- `cl-pais` (select: MX/US/CA)
- `cl-razon-social`, `cl-nombre-corto`, `cl-rfc`, `cl-cp-fiscal`
- `cl-telefono`, `cl-condiciones`, `cl-referencia`

**Entrega:**
- `cl-nombre-entrega` → `br_name` en Operam
- `cl-calle` → `addr_street`
- `cl-num-int` → `addr_interior`
- `cl-colonia` → `addr_colony`
- `cl-cp-entrega` → `addr_zip`
- `cl-municipio` → `addr_city`
- `cl-estado` → `addr_state`
- `cl-cel-entrega` → `phone`
- `cl-email-entrega` → `email`

## Bug actual
En `crearClienteDesdeCSF()` (línea 1252-1270), después de que Operam responde,
se rellena el formulario. Esto debe moverse a `procesarCSF()` línea 1162.

## Endpoint backend
`POST https://operam-server.onrender.com/api/crear-cliente`
Payload nuevo (sub-objeto `entrega` a agregar):
```js
entrega: {
  br_name: val('cl-nombre-entrega'),
  addr_street: val('cl-calle'),
  addr_interior: val('cl-num-int'),
  addr_colony: val('cl-colonia'),
  addr_zip: val('cl-cp-entrega'),
  addr_city: val('cl-municipio'),
  addr_state: val('cl-estado'),
  phone: val('cl-cel-entrega'),
  email: val('cl-email-entrega'),
}
```

## Tests
Directorio: `public/js/__tests__/` (crear si no existe) usando Node.js built-in `node:test`.
Para testear app.js (módulo ES): usar `--experimental-vm-modules` o extraer funciones puras
a un helper testeable. Alternativamente, tests de integración con jsdom si está disponible.
Verificar con: `node --test public/js/__tests__/`

---

## ITERACIONES (5 en total)

### Iteración 1 — Extraer función pura `buildPreFillMap(datos)`
**Tarea:** Crear función `buildPreFillMap(datos)` en app.js que dado un objeto `datos` de CSF devuelve el mapa de id→valor para pre-llenar el formulario. Incluye tanto campos de facturación como de entrega.
```js
// Retorna algo como:
{
  'cl-razon-social': datos.razonSocial,
  'cl-rfc': datos.rfc,
  'cl-cp-fiscal': datos.cp,
  'cl-calle': datos.calle,
  'cl-num-int': datos.numInt,
  'cl-colonia': datos.colonia,
  'cl-cp-entrega': datos.cp,
  'cl-municipio': datos.municipio,
  'cl-estado': datos.estado,
  // cl-nombre-entrega: nombreCorto como sugerencia
}
```
**Test:** `public/js/__tests__/csf.test.js` — verificar que `buildPreFillMap` retorna los valores correctos dado un objeto de datos de CSF.

### Iteración 2 — Mover pre-llenado a `procesarCSF()`
**Tarea:** En `procesarCSF()`, después de asignar `csfDatosExtraidos` (línea 1162), llamar `buildPreFillMap` y aplicar los valores a los campos del formulario. Fijar `cl-pais` a `'MX'`. No sobrescribir `cl-nombre-corto` aún (ese viene de Operam).
**Test:** Mock de `document.getElementById` o verificar que `procesarCSF` llama `buildPreFillMap`.

### Iteración 3 — Extraer función pura `buildEntregaPayload()`
**Tarea:** Crear función `buildEntregaPayload()` en app.js que lee los campos `cl-*` de entrega del DOM y retorna el sub-objeto `entrega` listo para el payload. Debe ser llamable sin side effects salvo lectura del DOM.
**Test:** Verificar la estructura del objeto retornado dado valores conocidos en el DOM (mock o jsdom).

### Iteración 4 — Incluir `entrega` en el payload de `crearClienteDesdeCSF()`
**Tarea:** En `crearClienteDesdeCSF()`, llamar `buildEntregaPayload()` y asignar `payload.entrega` antes del fetch. Remover el bloque de pre-llenado que existe ahí (líneas 1252-1270) ya que ahora ocurre en `procesarCSF()`. Mantener solo la actualización de `cl-nombre-corto` con `data.nombre` post-creación.
**Test:** Verificar que el payload construido incluye el sub-objeto `entrega`.

### Iteración 5 — Verificación de no-regresión
**Tarea:** Revisar que los flujos de "Buscar en Operam" y "Captura manual" no se rompieron. Asegurar que si `csfDatosExtraidos` es null, `crearClienteDesdeCSF()` sale limpio. Agregar `cl-nombre-corto` update post-creación que faltaba.
**Test:** Test de caso edge: `buildEntregaPayload` con campos vacíos, `buildPreFillMap` con datos parciales.

---

## Definition of Done
- [ ] `buildPreFillMap` extraída y testeada
- [ ] Pre-llenado ocurre en `procesarCSF()` al parsear el PDF
- [ ] Bloque de pre-llenado removido de `crearClienteDesdeCSF()`
- [ ] `buildEntregaPayload` extraída y testeada
- [ ] Payload incluye sub-objeto `entrega`
- [ ] Todos los tests pasan
- [ ] Commit por iteración
- [ ] Push a main
