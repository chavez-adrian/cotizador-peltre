# Análisis de automatización del proceso comercial — Peltre Nacional

**Fecha:** 2026-06-10
**Objetivo:** identificar qué partes del proceso comercial actual pueden automatizarse o convertirse en apps para vender más. Meta: 2x ventas en 1 año, 10x en 5 años.
**Fuentes:** `PROCESO_COMERCIAL_AS_IS.md`, repo del cotizador, dossier de Peltre Nacional, inventario de proyectos existentes.

---

## Dónde está la oportunidad real

El cotizador ya resolvió la parte de en medio del proceso (cotizar rápido, dar de alta clientes sin errores). Lo que sigue sin automatizar son **los dos extremos del embudo** — la entrada (captura y calificación de leads) y la salida (seguimiento, recompra, post-venta B2B) — y ahí es donde se vende más, no en el centro. Además hay un cuello estructural: **Adrián aparece 3 veces como aprobador manual en cada pedido** (confirmar anticipo, revisar datos, confirmar saldo). Eso no escala a 10x.

**Advertencia honesta:** 2x en un año es alcanzable atacando conversión y recompra del flujo actual. 10x en 5 años **no sale de automatizar el proceso actual** — requiere canales nuevos (distribuidores, exportación, retail) y capacidad de fábrica. Las herramientas de abajo quitan fricción comercial; no fabrican piezas. El plan de inversión en maquinaria y gente tiene que correr en paralelo o la demanda extra solo alarga tiempos de entrega.

---

## Frente A — Convertir más de lo que ya llega (impacto en meses, palanca del 2x)

### 1. Seguimiento automático de cotizaciones ⭐ el ROI más alto y más barato

El AS-IS describe la etapa "Seguimiento" en Bitrix24 pero todo depende de la disciplina del vendedor. La cotización vence a las 4 semanas y nadie dispara recordatorios. En B2B la mayoría de las negociaciones no se pierden por precio — se mueren por silencio.

- **Qué es:** motor que lee el historial de cotizaciones (ya está en Neon/`cotizaciones.json`) y dispara secuencia: día 2 ("¿dudas con la cotización?"), día 7, día 21 ("vence en una semana, ¿congelamos precio?"). Mensajes por WhatsApp/correo + alerta al vendedor para que llame.
- **Por qué primero:** infraestructura ya existe (cotizador en Render, Neon, número de WhatsApp de ventas). Es extender lo construido, no construir de cero.

### 2. Calificación y primera respuesta 24/7 en WhatsApp

Hoy los leads llegan por 9 canales y un vendedor los registra a mano en Bitrix24 (9 campos). La velocidad de primera respuesta es el predictor número uno de conversión B2B — un lead contestado en 5 minutos convierte varias veces más que uno contestado en horas.

- **Qué es:** agente sobre el WhatsApp de ventas que responde al instante, hace la calificación menudeo/mayoreo (la regla es trivial: <100 piezas → Shopify), pregunta los campos del registro (tipo de cliente, ciudad, piezas estimadas, modelos/colores), manda el catálogo, y **crea el lead en Bitrix24 automáticamente** con temperatura sugerida. El vendedor recibe el lead ya calificado y con contexto.
- **Riesgo a cuidar:** que no se sienta robot frente a un comprador HoReCa serio. El agente califica y agenda; no negocia.

### 3. Instrumentación del embudo (saber dónde se pierde)

Hoy no se puede responder con datos: ¿cuántos leads/mes? ¿win rate por segmento? ¿por qué se pierde? La etapa "Analizar la falla" existe pero no hay feedback loop. Sin esto, las demás apuestas son a ciegas. Es un dashboard que cruce Bitrix24 + cotizaciones + pedidos de Operam — encaja naturalmente en `peltre-analisis-mensual` que ya está en desarrollo.

---

## Frente B — Generar demanda nueva (palanca del 10x)

### 4. Cotizador self-service público / catálogo B2B interactivo

La pieza con más potencial de venta nueva. El catálogo PDF es estático; las listas M100–M6000 son fórmulas simples (70%→40% del precio de lista). Nada impide que un prospecto arme su propio carrito en la web, vea el precio mayoreo en vivo según volumen, estime su envío, y deje sus datos para confirmar.

- **Por qué funciona:** captura leads a las 2 AM sin vendedor, y el lead llega **con el carrito ya armado** — la mitad del trabajo comercial hecho. El motor de precios, tiers y cálculo de envío ya existe en el cotizador; es exponerlo con otra cara (sin login, sin datos sensibles, precio indicativo sujeto a confirmación).
- Convierte Meta Ads de "manda WhatsApp y espera" a "cotiza ahora mismo" — eso cambia el costo por lead calificado.

### 5. Calculadora para restaurantes (lead magnet)

Está documentado en el dossier: los restauranteros preguntan cuántos platos comprar según asientos. Esa pregunta es una calculadora pública ("X asientos, Y rotación → necesitas Z piezas + reposición anual sugerida") que termina en cotización automática. Barata de hacer, alimenta el punto 4, y posiciona a pp.peltre como el proveedor que asesora — diferenciación de servicio que ya es la estrategia declarada frente a Cinsa/BISA.

### 6. Motor de recompra B2B

Hoy el post-venta B2B es cero (Revie solo cubre Shopify). Pero HoReCa es un negocio de **reposición**: las piezas se pierden, se rayan, el restaurante abre otra sucursal. Venderle a un cliente existente cuesta una fracción de adquirir uno nuevo.

- **Qué es:** a los N meses de la entrega (dato que ya está en Operam), mensaje automático: "¿cómo va la vajilla? reposición al precio de tu lista, aquí tu pedido anterior para repetir en un clic". Con webhooks de Operam ya documentados, el trigger es directo.
- Esta es probablemente la palanca más subestimada del 2x: la cartera actual ya compró una vez.

### 7. Prospección saliente asistida por agente

Para 10x hay que salir a buscar: aperturas de restaurantes/hoteles, distribuidores, retail especializado, museos (la lista de targets ya existe). Un agente que investigue aperturas y prospectos por ciudad/segmento, arme la lista en Bitrix24 y genere borradores de correo personalizados (email-mcp ya crea borradores, nunca envía — el humano aprueba). Esto es más proceso que app, pero el agente quita el 80% del trabajo tedioso que hace que la prospección nunca se haga.

---

## Frente C — Quitar cuellos de escala (lo que truena al crecer)

### 8. Sincronización Operam → Bitrix24

Los webhooks de Operam ya están documentados. Cotización subida → mover a "Presentar Cotización"; pedido creado → "Producción Liberada"; nota de entrega → "Producto entregado". Elimina la captura doble y — más importante — hace que el pipeline refleje la realidad sin depender de la disciplina del vendedor. Sin esto, el dashboard del punto 3 mide ficción.

### 9. Reducir las 3 intervenciones de Adrián por pedido

Hoy: Adrián confirma el depósito, revisa 6 campos antes de convertir a pedido, y confirma el saldo. Con 4 pedidos/semana funciona; con 40 es el cuello de botella de toda la empresa.

- **Camino realista:** los guardrails del alta de cliente ya hicieron el trabajo duro (dedup, validaciones, cuenta de ventas automática). Extender esa lógica a la conversión cotización→pedido: un checklist automático que valide los 6 puntos y presente "todo verde, aprobar en 1 clic" — o solo escale las excepciones. La conciliación de pagos es más dura (Banorte no tiene API amigable), pero un semáforo semiautomático sobre el módulo Bancos de Operam ya quita la mitad de la fricción.

### 10. Notificaciones de estado al cliente

Webhooks de Operam → WhatsApp al cliente: "tu pedido entró a producción", "listo, falta saldo", "enviado, aquí tu guía". Mata las preguntas de "¿cómo va mi pedido?", resuelve el aviso manual de Lalamove, y profesionaliza la experiencia — relevante para que un hotel recomiende con otro hotel.

### 11. Mini-app de calcas

El flujo de personalización es el más largo (6 semanas), el de más margen, y el más manual: cotización con Vitromugs por WhatsApp, formato de posición en Illustrator, dummy, prueba en mufla. Dos piezas automatizables:

- **(a)** cotizador de calca — la matriz ya está definida en el AS-IS (1/8 a 1/1, tintas, mínimo 100 iguales); hoy cada cotización espera respuesta de Vitromugs.
- **(b)** previsualizador de mockup — el cliente sube su logo y lo ve sobre la pieza usando los wireframes existentes. Acortar el ciclo de aprobación visual de días a minutos cierra más proyectos promocionales.

---

## Priorización sugerida

| # | Qué | Esfuerzo | Palanca |
|---|-----|----------|---------|
| 1 | Seguimiento automático de cotizaciones | Bajo (extiende cotizador) | Cerrar lo que hoy se muere en silencio |
| 2 | Sync Operam → Bitrix24 | Bajo (webhooks listos) | Pipeline confiable, base para medir |
| 3 | Bot de calificación WhatsApp → Bitrix24 | Medio | Velocidad de respuesta = conversión |
| 4 | Motor de recompra B2B | Bajo-medio | Venta a cartera existente |
| 5 | Cotizador self-service público + calculadora restaurantes | Medio (reusa el motor) | Demanda nueva 24/7 |
| 6 | Checklist de aprobación de pedido (quitar cuello de Adrián) | Medio | Prerequisito para escalar volumen |
| 7 | Notificaciones de estado al cliente | Bajo | Experiencia, recomendación |
| 8 | Mini-app de calcas (cotizador + mockup) | Medio-alto | Más proyectos promocionales, mejor margen |
| 9 | Prospección saliente asistida | Medio | El motor del 10x junto con el #5 |

Los puntos 1–4 son el paquete del 2x: pura conversión y recompra sobre demanda que ya existe, con infraestructura que ya existe (Render, Neon, webhooks Operam, API v3, email-mcp). Los puntos 5, 8 y 9 son los que abren demanda nueva para la trayectoria 10x — pero ese objetivo va a depender igual o más de capacidad de producción y de canales (distribución, exportación) que de software.

**Siguiente paso natural:** bajar el #1 (seguimiento de cotizaciones) a un diseño concreto — es el que menos cuesta y el que más rápido se nota en ventas.

---

## Avance de implementación

### #1 Seguimiento automático de cotizaciones — ✅ IMPLEMENTADO (2026-06-10)

Commit `3493e93` en `cotizador-peltre`, en producción vía auto-deploy de Render. 21 tests nuevos (suite total: 261, 0 fallas), desarrollado con TDD.

**Decisión de diseño:** cola de seguimiento **asistida**, no envío automático. El envío automático requiere la API de WhatsApp Business de Meta (verificación de negocio, plantillas aprobadas) — otro proyecto. La cola calcula qué toca hoy y el vendedor dispara cada mensaje con un tap; mantiene tono humano y funciona con cero dependencias externas. El motor de cálculo es el mismo si después se conecta la API de Meta.

**Qué se construyó:**

- `lib/seguimiento.js` (lógica pura):
  - `calcularCola(cotizaciones, hoy)` — pasos día 2 / día 7 / día 21 (por vencer) / día 28 (vencida, mensaje de reactivación).
  - Reglas: solo la última cotización por cliente (clave: RFC, fallback nombre); solo el paso más avanzado pendiente (sin spam acumulado); pasos ya registrados no se repiten; ganada/perdida/descartada salen de la cola.
  - `telefonoWa()` — normaliza a formato wa.me (10 dígitos MX → prefijo 52).
  - `mensajeSeguimiento()` — texto redactado por paso.
- API (JWT, mismo auth que el resto):
  - `GET /api/seguimiento` — cola del vendedor (admin ve todo).
  - `POST /api/seguimiento/:id` — registra paso hecho `{ paso, fecha, vendedor }`.
  - `PATCH /api/cotizacion/:id/estado` — abierta / ganada / perdida / descartada.
- Frontend: botón **Seguimiento** en header con badge de pendientes; tarjetas con link `wa.me` prellenado al teléfono del cliente y botones ✓ Hecho / Ganada / Perdida.

**Subproducto:** el registro ganada/perdida empieza a acumular el dato de win rate (#3 del análisis sale casi gratis de aquí).

**Pendientes / deuda conocida:**

1. ~~Migrar `cotizaciones.json` a Neon Postgres~~ — **HECHO 2026-06-10** (ver abajo).
2. La primera vez la cola muestra cotizaciones viejas como "Vencida" — descartar una vez y queda limpia (en el smoke test había 7 pendientes, pasos vencida/dia21).
3. ~~El link de WhatsApp solo se prellena si el vendedor capturó el teléfono~~ — resuelto con el bloqueo duro de teléfono (ver abajo).
4. Futuro: envío automático vía API de WhatsApp Business de Meta, reutilizando el mismo motor.

### Complementos al #1 — bloqueo duro de teléfono y migración a Neon (2026-06-10)

**Bloqueo duro de teléfono con código de país** (commit `68f700c`):
- `validarTelefono` / `separarTelefonoCodigo` en `alta-logica.js`; selectores +52/+1/+1 CA/Otro en `cl-telefono` y `cl-cel-entrega`.
- Gate server-side: `POST /api/cotizacion/pdf|html` responden 400 sin teléfono válido con código de país. El frontend bloquea antes con foco al campo.
- Alta de cliente: teléfono del domicilio ahora obligatorio.
- Motivación: era uno de los 6 puntos que Adrián revisaba a mano antes de convertir a pedido, y elimina el bug latente de tratar números US de 10 dígitos como mexicanos en el link de WhatsApp.

**Migración de cotizaciones a Neon Postgres:**
- DB confirmada con Adrián: la misma del cotizador en producción (`wandering-violet/neondb`, compartida con knowledge-base y bazaar — desorden conocido, se priorizó cero fricción de deploy). Tabla nueva: `cotizaciones`.
- `lib/cotizaciones-store.js`: Postgres con `DATABASE_URL`, fallback a `data/cotizaciones.json` sin ella (dev/tests). Todas las rutas refactorizadas al store.
- Hallazgo: `data/cotizaciones.json` no estaba en git → cada deploy de Render borraba el historial de producción. El historial local (53 entradas) era el más completo; se migraron 49 (4 excluidas por ser de la suite de tests, vendedor Test/Tester).
- Smoke test contra la DB real: listar, cola, crear (id 50 = MAX+1), seguimiento JSONB, estado — todo OK.
- Script idempotente: `scripts/migrar-cotizaciones-neon.mjs`.

### ⚠️ BLOQUEADOR OPERATIVO descubierto (2026-06-10): Render suspendió los 6 servicios

Al verificar el deploy se encontró que **Render suspendió los 6 servicios del workspace** (cotizador-peltre, operam-export, peltre-knowledge-base, peltre-report, dimensionamiento-geometrico, operam-server) alrededor del 8 de junio. El resume por API responde "only services suspended by a user can be resumed" → suspensión de plataforma, casi seguro por agotar las 750 hrs/mes del plan free.

**Causa raíz:** los keepalives de cron-job.org (ping cada 10 min) mantienen los servicios despiertos 24/7 → ~720 hrs/mes POR SERVICIO, contra 750 hrs/mes para TODO el workspace. Con 6 servicios las horas se agotan en ~5 días de cada mes.

**Implicación:** ningún push despliega y las herramientas de producción están caídas hasta resolver en el dashboard de Render. El código de hoy (seguimiento + teléfono + Neon) está pusheado y desplegará solo al reactivar (autoDeploy: yes). Los datos en Neon no se afectan (independiente de Render).

**Decisión de Adrián (2026-06-10):** cambiar el servicio del cotizador a **Starter**.

Pendiente al reactivar:
1. Verificar que el auto-deploy tome el último commit (`5525433` o posterior) — los pushes de hoy quedaron en cola: seguimiento de cotizaciones, bloqueo duro de teléfono y persistencia en Neon.
2. Verificar en producción que `/api/seguimiento` lea de Neon (debe mostrar las 49 cotizaciones migradas; la cola inicial traerá ~7 pendientes vencida/dia21 — descartar las viejas una vez).
3. El keepalive de cron-job.org del cotizador ya no será necesario con Starter (no duerme); considerar quitarlo.
4. Los otros 5 servicios siguen suspendidos hasta julio o hasta decidir su esquema (quitar keepalives para que duerman, consolidar, o pagar los críticos como operam-export).
