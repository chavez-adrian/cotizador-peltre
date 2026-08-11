# La calca en el carrito determina el decorado, y lo fija

Hasta ahora la marca de producto decorado era un checkbox manual en el resumen (#90), un parche consciente: no había forma de meter una calca al carrito, así que no había nada de dónde derivarla. Al habilitarse la calca como partida (#91), la marca pasa a derivarse del contenido: **si hay calca en el carrito, la cotización es decorada y el vendedor no puede apagar esa marca**; sin calca, el checkbox manual sigue disponible.

La asimetría es deliberada. La marca no es cosmética: activa el gate de #61, que impide llegar a *Pedido liberado* sin las 6 autorizaciones del proveedor de calca. Dejarla editable con calca presente permitiría esquivar el gate justo en el caso donde más importa; volverla puramente derivada dejaría sin forma de marcar el decorado a mano y las texturas decoradas, que son decorado real y no producen partida en el carrito. De ahí la regla: la calca es piso, no techo.

## Consecuencias

Quitar la calca de una cotización no revierte la marca ni descarta el checklist — la marca vuelve a ser editable conservando su valor, y apagarla es un acto explícito del vendedor. El motivo es que los pasos completados representan gestiones reales con un proveedor externo (arte final enviado, dummy autorizado); un cambio en el carrito no puede borrar ese registro. Es el mismo criterio de no-retroceso que ya rige el avance de etapa en el sync post-venta.
