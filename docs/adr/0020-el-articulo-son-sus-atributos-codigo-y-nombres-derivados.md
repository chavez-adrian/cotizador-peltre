# ADR-0020: El artículo son sus atributos; el código y los nombres son derivados que nunca se interpretan

## Status

Accepted (2026-09-15). Complementa ADR-0018 (el Alta de artículo nace en el maestro) y cierra la discrepancia que ese ADR dejó pendiente. Origen: sesión de `grill-with-docs` + `domain-modeling` con Adrián, con lectura directa de `LISTA DE PRECIOS 2026 Abril.xlsx`.

## Context

Hoy la identidad de un artículo es la **combinación** de sus partes (modelo, color 1, color 2, textura, capas, filetes, color de riso, y opcionalmente decorado y piezas por paquete), y tanto el código como los nombres se derivan de ella por fórmula. Esa arquitectura es correcta y se conserva. Lo que falla es **dónde vive la combinación**: en la hoja `carga_artículos` del Excel (1,270 filas), mientras que el cotizador la **adivina** descomponiendo el código de Operam (`decodificarSku`) y guarda una tabla congelada de lecturas para los 230 códigos legacy que no siguen la convención y para los que tienen dedazo.

Leer el código es frágil por construcción: son 12 posiciones fijas más un código de decorado de 2 caracteres opcional (`MJ`, pero también `01`…`15`) más los dígitos del paquete, así que `…1012` no se descompone sin ambigüedad. Y las excepciones de nombre ("Taza 8 Museo Jumex filete negro") no tienen dónde declararse: viven calladas en la tabla congelada.

## Decision

- El Maestro de artículos tiene una **tabla de artículos** cuyas columnas son los **atributos** de la combinación. Es la `carga_artículos` del Excel en su lugar correcto, y **se siembra desde ella** (las 1,270 filas), con el patrón de semilla de la casa.
- El **código** y **cada nombre por canal** (nombre interno de Operam, descripción comercial, Shopify, GS1 en español e inglés, Amazon) son **funciones puras de los atributos y del vocabulario** del maestro. Se calculan; **nunca se vuelven a interpretar** desde el código. Para artículos nuevos `decodificarSku` deja de ser fuente de atributos; para los históricos, la tabla sembrada lo sustituye.
- Un artículo puede llevar un **nombre sobrescrito** por canal, declarado en el maestro y visible como excepción en el panel. Ahí van los nombres que rompen la plantilla; la tabla congelada de lecturas del complemento se retira.
- **El nombre es único entre artículos activos** y el alta lo valida. Hoy la taxonomía tiene colores con etiqueta idéntica y código distinto (A3/A4 "Azul", M1/M3 "Menta", N1/N3 "Negro", R1/R2 "Rojo", Y2/Y4 "Crema", P1/P2/P3 "Rosa"); dos artículos distintos con el mismo nombre en Operam son la misma trampa que SA08/SC08.
- **La semilla se verifica artículo por artículo contra Operam antes de entrar**: código derivado = código en Operam, nombre derivado = descripción en Operam, y cada diferencia se resuelve marcándola como excepción o corrigiendo la regla. Esa verificación es la prueba de que la convención quedó bien escrita.

## Considered Options

- **Un código mejor diseñado** (separadores, largo fijo para decorado y paquete). Rechazada: cambiaría los códigos de los artículos existentes en Operam, GS1 y Shopify, y seguiría siendo interpretar en vez de registrar.
- **Plantillas de nombre editables desde el admin** en lugar de funciones en código. Pospuesta: son seis proyecciones de los mismos atributos y hoy no cambian; si con el tiempo se editan seguido, se vuelven datos. Empezar por plantillas sería máquina sin uso.
- **Seguir leyendo el código y solo mejorar la tabla de excepciones.** Rechazada: deja la ambigüedad de largo variable y mantiene tres lugares para el mismo hecho (Excel, código, tabla congelada).

## Consequences

- La discrepancia "artículo en Operam que el maestro no sabe describir" (pendiente en ADR-0018) desaparece para los 1,270 artículos sembrados. Un artículo creado directo en Operam después de la siembra sí es una anomalía, y el reporte de paridad lo denuncia.
- El vocabulario que la derivación necesita entra completo al maestro, con todas sus formas: colores (con género y número, inglés), decorados y colaboraciones, texturas (con su género, que rige la forma del color 2), capas, filetes, colores de filete, la regla textura + capas → letra de precio, y las listas. Es lo que #303 pasa a cubrir.
- Hallazgos que quedan **anotados, no resueltos**: "color oreja" se captura pero no entra al código ni al nombre, así que hoy no distingue artículos; las tres filas de "madera" en la regla de letras son otra línea de producto con otra lógica de precio y piden que la regla pueda ser específica por modelo.
