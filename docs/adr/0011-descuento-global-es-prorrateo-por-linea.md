# El descuento global es un gesto de captura, no una entidad

El vendedor pide con frecuencia bonificar la cotización completa —"un 8% a todo"— y capturar ese mismo número partida por partida es tedioso y se presta a olvidar una línea. El atajo existe (#138): un campo escribe el % en cada partida del carrito, artículos, calcas y envío incluidos. **Lo que no existe es el descuento global como dato.** No se guarda, no viaja en el payload, no aparece como renglón en los totales ni en el documento: el campo aplica el % y desaparece del modelo. La fuente de verdad sigue siendo, y sigue siendo únicamente, el % por línea.

La alternativa era un renglón propio —"Descuento global: −8%"— restado del subtotal, que es como lo hacen muchos cotizadores y como lo pediría un contador. Se descarta por paridad documento↔ERP. Operam captura el descuento en el campo `Disc` de cada partida del quote; no hay un descuento de cabecera al que mapear un renglón global. Sostenerlo obligaría a prorratearlo igual al escribir el quote, y entonces el documento diría una cosa (un renglón) y el ERP otra (n líneas descontadas), con un redondeo propio en medio que haría diferir los dos totales por centavos. Un renglón global además admite combinarse con descuentos por línea, y esa suma de dos descuentos sobre la misma partida es exactamente la ambigüedad que el glosario cierra al declarar que el descuento se aplica sobre el precio de lista del tier vigente.

El costo de la decisión es que el gesto no es reversible como unidad: no hay un "quitar el descuento global" que restaure lo que cada línea tenía antes, porque esa memoria no se guarda. Re-aplicar el atajo con 0 deja todo en cero, que es lo más cercano a deshacer.

## Consecuencias

El campo no guarda estado: muestra el % común a todas las partidas y se queda en blanco en cuanto una diverge —sea porque el vendedor afinó una línea, sea porque agregó un artículo nuevo, que entra sin descuento—. Prefiere quedarse callado a afirmar un global que ya no describe la cotización.

El tope del vendedor (#137) lo frena con la misma función y el mismo mensaje que la captura por línea, y el servidor lo rechaza por el mismo camino, porque para cuando la cotización se guarda ya no queda rastro del atajo: son n líneas con su %. Ningún consumidor aguas abajo —totales, PDF, HTML, quote de Operam, huella de comparación— aprende una regla nueva.
