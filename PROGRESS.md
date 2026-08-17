# PROGRESS — cotizador-peltre

> Este archivo es solo para **retomar**: estado, backlog activo, cómo orquestar, y decisiones/lecciones que NO viven en otro lado. El detalle de cada issue cerrado está en **git** (commits) y en el **comentario de cierre del issue** en GitHub; las decisiones de dominio en **CONTEXT.md**/ADRs; el API de Operam en **peltre-operam.md**; la arquitectura por módulo en **docs/arquitectura.md**. No duplicar ese detalle aquí. Las secciones de sesiones pasadas se PODAN al cerrar sesión — se recuperan con `git log -p PROGRESS.md` (última poda: 2026-08-17).

## ARRANCAR AQUÍ (2026-08-17, sesión "orquestación spec #155 completa + sesión HITL #164")

**LA SPEC #155 (salida de Bitrix24) ESTÁ CERRADA COMPLETA — 9/9 tickets, 4 días antes del vencimiento (2026-08-21).** `main` = `8ab773d`, árbol limpio, **suite 1968/0** (venía de 1835). Esta sesión se trabajó **directo en `main`** (decisión del orquestador: agentes secuenciales de contexto limpio, un ticket a la vez, /implement incrustado en el prompt, modelo según el ticket, verificación del orquestador antes de cada cierre). El detalle de cada ticket vive en su comentario de cierre: #157 (captura pública opaca), #158 (export verificado 73/328/295/60 en Dropbox), #159 (26 prospectos importados con gate), #160 (CP GeoNames), #161 (intl-tel-input + libphonenumber), #162 (Turnstile; fail-open ratificado en ADR-0012), #163 (alerta por correo), #164 (Shopify vía iframe con evidencia + research `docs/research/iframe-embed-shopify.md`).

**Estado operativo desde hoy:** `pppeltre.mx/pages/peltre-de-mayoreo` sirve el formulario propio vía iframe (cero Bitrix en el sitio); cada captura alerta por correo a Alejandro + admin; Alejandro tiene 26 leads importados en Por Cotizar más su permiso de asignación activo.

**⚠️ ACCIONES DE ADRIÁN PENDIENTES (dijo que las haría):**
1. **Borrar el webhook entrante de Bitrix** (Aplicaciones → Recursos para desarrolladores) — ya sin uso; era el candado de seguridad pendiente.
2. **Rotar la contraseña de `contacto@pppeltre.mx`** (quedó en el transcript de la sesión) actualizando `SMTP_PASS` en Render **en el mismo momento**. La `DATABASE_URL` de Neon también quedó en el transcript (rotarla exige tocar Render a la vez; decisión suya).

**SIGUIENTE ACCIÓN AL RETOMAR:**
1. **#165** correo de alerta enriquecido (datos completos + link `wa.me` + vCard adjunta) — `ready-for-agent` (Sonnet), especificado con AC. **Adrián lo pidió pero NO ha dado el "adelante" de implementación** (regla de autorización explícita por fase): confirmarlo antes de lanzar agente.
2. **#51** UI tableros Bitrix — sin relación con la spec; requiere re-scope contra el lienzo cobalto existente + prototipo aprobado ANTES.
3. Esperando a Adrián, no a un agente: **#145** (`ready-for-human`), **#133**/**#105** (`needs-info`), **#72** (sandbox Lalamove), los **31 candidatos de la bandeja** (Más → Rescatados), migración calcas `ACT`→`SER`, cancelar quotes de prueba **1216/1219** en la UI de Operam, **#132** (rama viva `feat-prefactura-prototipo`), fórmulas Excel `precios_pna!K80:O82`, `boxMap` de 8 modelos.

**Lecciones/reglas nuevas de esta sesión (no viven en otro lado):**
- **La página de Shopify con el iframe se edita SOLO en vista HTML** (`<>`): el editor visual (TinyMCE) sanitiza y puede comerse el `<script>` del auto-alto. Regla permanente, también en el comentario de cierre de #164.
- El export de Bitrix con `select: ['*','UF_*']` **NO trae multifields** (PHONE/EMAIL): hay que pedirlos por nombre. Costó un re-export; quedó corregido en `scripts/export-bitrix.mjs` (referencia si algún día se re-exporta el plan Free).
- SMTP en Render: nombres EXACTOS `SMTP_USER`/`SMTP_PASS` (hubo `SMTP_PASSWORD` + typo `1`-vs-`l` en la contraseña; el wrapper omite en silencio si faltan las vars — diseño de dev que en prod se diagnostica con `[alerta-mayoreo]` en los logs de Render). `SMTP_HOST=mail.pppeltre.mx` es alias válido del Exim de akky.
- Turnstile bloquea navegadores automatizados (correcto): las pruebas end-to-end con widget real requieren humano; las de dedup/opacidad van por tests supertest (W9, 7 ramas).
- El deploy de Render tarda ~2 min tras cambiar env vars; un envío en la ventana cae en la instancia vieja.

## Cómo retomar (protocolo de orquestación)
Tu rol = **ORQUESTADOR**. El trabajo de cada issue lo hace un **subagente fresco** (Agent), uno por issue, con `/implement` incrustado (TDD en costuras acordadas, tests individuales frecuentes, suite completa al final, /code-review de dos ejes, commit por nombre + push). Modelo según el ticket. Esta sesión validó la variante **secuencial directo en `main`** (sin ramas) para cadenas de tickets sobre los mismos archivos; la variante con ramas `issue-NN-slug` del protocolo previo sigue disponible para trabajo paralelo/riesgoso.
1. **Elige el siguiente issue** (ruta crítica primero). Presenta la elección a Adrián si hay decisión de dominio; con autorización de orquestación vigente, avanza y reporta.
2. **Lanza el subagente** con prompt denso: contexto obligatorio (issue + CONTEXT + ADRs + arquitectura + trampas de CLAUDE.md), qué REUSAR, qué está FUERA, verificación en navegador si toca UI (regla #112), válvula de seguridad (parar y reportar ante decisión de dominio), reporte final con números exactos.
3. **Al volver, NO cierres el issue**: verifica TÚ (suite completa, diff, ACs contra código real, spot-checks en Neon/Operam read-only cuando aplique) y cierra con evidencia en el comentario.
4. **Gate humano** para todo lo irreversible o de producción visible (importaciones, Shopify, decisiones de dominio): evidencia primero, "adelante" explícito después. Una autorización no se extiende a la siguiente fase.

**Notas de entorno:** `.env` local NO tiene `DATABASE_URL` → dev/tests usan fallback `data/*.json`; producción usa Neon (proyecto `peltre-report`, host `ep-wandering-violet-ae54ipr4…us-east-2`; la cadena vive en Render y en `peltre-bazaar-ventas\.env` — NO agregarla al `.env` del cotizador; para scripts one-off se pasa inline en la invocación). `.env` local SÍ tiene ya: `BITRIX_WEBHOOK_URL` (morirá al borrar el webhook) y las 3 vars de Dropbox. `gh` y el MCP `operam-api` (lectura) disponibles. **Demos remotas:** túnel `cloudflared tunnel --url http://localhost:3000`; bajarlo al terminar. **UI:** prototipo aprobado ANTES + verificación en navegador.

## Documentación de fundación (en main)
- **CONTEXT.md** — glosario del modelo (oportunidad, 7 etapas, captura pública, cola Hoy). El glosario manda.
- **docs/arquitectura.md** — detalle por módulo/tema; CLAUDE.md es el resumen.
- **docs/adr/0012** — captación pública (respuesta opaca, Turnstile única excepción CDN con fail-open del siteverify precisado, GeoNames autohospedado).
- **docs/research/formulario-mayoreo-captura.md** y **docs/research/iframe-embed-shopify.md** — investigación verificada del formulario y del embed.
- **peltre-operam.md** (raíz `_Claude/`) §12 — API de Operam real. Consultar ANTES de explorar Operam.
