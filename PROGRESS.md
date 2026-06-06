# PROGRESS — Sesion grill-with-docs issue #26

**Fecha:** 2026-06-06  
**Estado:** Fase de discovery y documentacion COMPLETA. Implementacion pendiente.

---

## Lo que se hizo

Se realizó una sesion completa de `/grill-with-docs` para afinar el PRD del issue #26
("Completar flujo de alta de clientes conforme al SOP-COM-OPERAM-001").

Durante la sesion se ejecutaron pruebas empiricas contra la API de Operam produccion
para verificar o refutar suposiciones del PRD. Todos los hallazgos fueron persistidos
en los archivos de documentacion.

---

## Hallazgos empiricos clave (verificados 2026-06-06)

### Flujo correcto de creacion de cliente

```
POST /api/v3/sales/customers
  → Operam auto-crea branch ("Una sucursal por defecto ha sido creada automaticamente")
  → Respuesta: {id: customer_id}

GET /api/v3/sales/customers/{customer_id}
  → branch_code = branch_id del branch auto-creado

PUT /api/v3/sales/branches/{branch_id}
  → Configurar branch con domicilio y parametros
```

NO existe `POST /api/v3/sales/branches` como operacion de alta.

### Nombres de campos correctos en PUT /branches (NO son los de GET)

| Campo correcto | Campo incorrecto (de GET) |
|---|---|
| `br_ref` | `branch_ref` |
| `location: 40` (entero) | `default_location: "40"` |
| `ship_via: 1` (entero) | `default_ship_via: "1"` |

### sales_account

Siempre vacio en la API incluso en clientes bien configurados via UI.
Operam lo deriva internamente del `tax_group_id`. NUNCA enviar `sales_account`.
Setear solo `tax_group_id: 1` (MX) o `tax_group_id: 2` (extranjero).

### Contactos

- `POST /api/v3/sales/contacts` → 501
- `PUT /api/v3/sales/customers/{id}` con array `contacts` → silenciosamente ignorado
  (incluso con IDs de contactos existentes, verificado contra produccion)
- Operam auto-genera un contacto General al crear el cliente
  (usa cust_ref como nombre, phone y email del cliente)
- Contactos Invoices/Deliveries y campo Celular: SOLO manual en UI de Operam

### Catalogos

- `GET /api/v3/sales/sales_types` → funciona; retorna todas las listas de precios
- Endpoints de segmentos y vendedores de Operam → 501
- Decision: endpoint propio `/api/catalogos` con segmentos y vendedores hardcodeados,
  listas_precios dinamicas desde Operam

---

## Archivos actualizados en esta sesion

| Archivo | Que se actualizo |
|---|---|
| `data/vendedores.json` | Nombres reales + campo `operam_id` separado del `id` interno |
| `CONTEXT.md` | Termino "Contacto de cliente" — API auto-genera General; PUT ignorado |
| `MAPEO_CAMPOS_CLIENTE.md` | Gaps #2,#3,#4,#5,#6; seccion 2.4 comercial; seccion 4 hardcoded; nota header |
| `docs/adr/0002-alta-cliente-operacion-atomica.md` | Flujo POST+GET+PUT; campos correctos; nota sales_account |
| `CLAUDE.md` | operam-client exports (actualizarBranchCliente); seccion /api/catalogos |
| `GitHub issue #26` | Reescritura completa con todas las decisiones de implementacion |

---

## Estado de Jaime Abaroa Santos

- Telefono: +524441769026
- Email: abaroasantos@hotmail.com
- `operam_id: null` en vendedores.json
- **Accion pre-deploy:** dar de alta como vendedor en Operam UI y actualizar `operam_id`
- Hasta entonces, /api/catalogos lo excluye del selector de vendedores

---

## Proxima tarea: Implementacion

El PRD del issue #26 esta listo para implementacion. Orden sugerido:

### 1. Nuevo endpoint GET /api/catalogos (server.js)
Segmentos y vendedores hardcodeados + listas_precios desde Operam.
Test: verifica segmentos (11), vendedores solo con operam_id, listas mayoreo.

### 2. actualizarBranchCliente() en lib/operam-client.js
GET /customers/{id} para obtener branch_code + PUT /branches/{id} con campos correctos.
Campos required: br_name, br_ref. Campos clave: location:40, ship_via:1, tax_group_id.
NO incluir sales_account en el body.
Test: body correcto para MX vs extranjero; sales_account ausente.

### 3. buildClienteBody() en lib/operam-client.js
Agregar: sales_type, segmento_id, salesman (operam_id).
Cambiar: timbrado_uso_cfdi desde input (S01 como fallback).
Cambiar: area derivado del pais (MX→1, US→5, CA→7, otros→6).
Mantener: payment_terms: 9 hardcodeado.
Test: area por pais, sales_type presente, salesman = operam_id.

### 4. POST /api/crear-cliente (server.js)
Flujo atomico: POST customer → GET branch_id → PUT branch.
Manejo de estado parcial: si customer_id existe en el retry, skip POST.
Test: alta completa, fallo en PUT branch, reintento sin duplicar.

### 5. Modulo de deduplicacion (nuevo, puro)
normalizarNombre() + detectarDuplicados().
Test: RFC real duplicado, RFC generico con match de nombre, falso positivo.

### 6. Frontend index.html + app.js
Panel de alta integrado, selectores desde /api/catalogos, indicador de progreso,
botones "Cotizar ahora" / "Terminar".

---

## Segmentos (hardcoded en /api/catalogos)

Obtener la lista confirmada de Operam antes de hardcodear.
En la sesion de grill se confirmo que son 11 incluyendo "Sin segmento" (ID=0).
IDs exactos pendientes de verificar.

## Listas de precios mayoreo (filtro para /api/catalogos)

M100, M350, M550, M1500, M6000, M6001, US100, US350, US550, US1500, US6000
(las listas de menudeo y otras se excluyen del selector)
