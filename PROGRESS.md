# PROGRESS — issue #53 (tracer del embudo: bottom-nav + 7 etapas + migracion + tablero unico)

Rama: `issue-53-tracer-embudo` (base main, commit fundacion 6e2ebc2 que alineo CONTEXT.md + ADR-0005). NO merge a main, NO push a main.

## Criterios de aceptacion (#53)
- AC1: app abre con bottom-nav (Cotizar, Hoy, Pipeline, Mas)
- AC2: Pipeline = 1 tablero de 7 columnas (+ salidas accesibles) con conmutador a lista
- AC3: cada prospecto y cotizacion existente cae en la columna correcta (mapeo de migracion)
- AC4: migracion idempotente y conserva historial de eventos
- AC5: modulo pipeline con pruebas (vocabulario, orden, labels) + migracion con cobertura viejo->nuevo

## Plan de ciclos (vertical, 1 test -> 1 impl, 1 commit, 1 checkpoint)
1. lib/pipeline.js puro: etapas, salidas, orden, labels (AC5)
2. lib/migrar-pipeline.js puro: mapeo etapa prospecto viejo->nuevo + estado cotizacion->etapa, idempotente, preserva eventos (AC3/AC4/AC5)
3. stores adoptan vocabulario nuevo (default etapa por_cotizar) (AC3)
4. tablero unico de 7 columnas (public/js/pipeline-logica.js) con agrupacion + conmutador lista (AC2)
5. bottom-nav en index.html + app.js con Pipeline vivo (AC1)

## Baseline
- `npm test` = 483 pass / 0 fail (verificado antes de empezar).

## Estado actual: ISSUE #53 COMPLETO. Todos los AC verdes, suite 496/496.
Ciclo 1 CERRADO (d5f777b): lib/pipeline.js, 5 tests. Vocabulario AC5.
Ciclo 2 CERRADO (fcd3d90): lib/migrar-pipeline.js, 10 tests. Mapeo idempotente AC3/AC4/AC5.
Ciclo 3 CERRADO (50a7ddc): stores + server + dominio + public/js/pipeline-logica.js (9 tests). AC2/AC3/AC4.
Ciclo 4 CERRADO (7fc762b): cotizaciones-store migra al leer; bottom-nav + destino Pipeline vivo con tablero unico + conmutador lista/tablero. AC1/AC2.

Verificado en browser (chrome-devtools, datos reales): bottom-nav Cotizar/Hoy/Pipeline/Mas; Pipeline 7 columnas (Por Cotizar 3, Seguimiento 55, $1.28M sumado); toggle lista/tablero; Hoy->seguimiento; Mas->Historial/Prospectos; 0 errores de consola. Screenshot en .temporales/pipeline-tablero.png.

DEMO (2 min): npm start -> http://localhost:3000 -> login -> abre en Cotizar con barra inferior -> tocar Pipeline: tablero de 7 columnas con las cotizaciones en Seguimiento y los prospectos en Por Cotizar -> Lista/Tablero conmuta -> Hoy y Mas enlazan a las pantallas existentes.

Decisiones ciclo 2/3:
- migrarCotizacion respeta etapa ya presente del pipeline (idempotencia + futuro post-venta); solo deriva del estado si no hay etapa nueva. Default prospecto sin etapa -> por_cotizar.
- Migracion en la frontera de LECTURA del store (no reescribe disco): idempotente, AC4 natural.
- Avance manual de etapa de prospeccion (nuevo->contactado->calificado) ELIMINADO (ADR-0005). Unica transicion manual viva: salida a No util. por_cotizar->seguimiento la dispara la cotizacion (auto) o folio Operam (otro issue).
- reunion-resultado: solo cierra a No util (calificado eliminado; CONTEXT.md "Reunion de diagnostico").
- CONTRADICCION POTENCIAL evaluada y descartada: el issue dice "tarjetas se ven en su columna, NO transiciones especiales"; pero "stores adoptan vocabulario nuevo" obliga a tocar el hook/cola/transiciones existentes que usaban el vocabulario viejo. No invente reglas nuevas: solo reexprese las existentes al vocabulario nuevo y elimine lo que ADR-0005 obsoleta.

## Notas de diseno / hallazgos
- Datos prospectos.json: etapas nuevo/contactado/calificado/no_util, todos con vendedor.
- cotizaciones.json: 55 filas, casi todas estado null (=> abierta). Una "abierta".
- Mapeo ADR-0005: nuevo/contactado/calificado -> por_cotizar; cotizado -> seguimiento; no_util se conserva.
  Estado cotizacion: abierta/null/ganada -> seguimiento (sin dato Operam post-venta en este slice); perdida/descartada -> perdida (salen del tablero).
- Vocabulario canonico (CONTEXT.md): no_asignado, por_cotizar, seguimiento, anticipo_pagado, pedido_liberado, saldo_pagado, producto_entregado; salidas no_util, perdida.
- Prior art: node:test+supertest, app sin listen() (isMain), logica pura frontend en .cjs via import() dinamico.
- Alcance #53: tarjetas existen y se ven en su columna; NO transiciones especiales ni demas destinos completos.
