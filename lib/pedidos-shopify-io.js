// Envoltura de IO del sondeo de pedidos de la tienda en linea (spec #254,
// ticket #255). Lee Shopify pagina por pagina (lib/shopify-pedidos.js), pasa
// cada nodo por el nucleo puro (lib/pedidos-shopify-logica.js) y persiste el
// resultado (lib/pedidos-shopify-store.js). No decide nada: mismo reparto que
// lib/contactos-io.js frente a lib/contactos-logica.js.
//
// Dos reglas que viven aqui:
//   - El cursor se persiste al terminar CADA pagina, no al final del sondeo: un
//     fallo a la mitad conserva lo ya leido y la siguiente corrida arranca de
//     ahi. Volver a leer un pedido es inofensivo -- el store hace upsert.
//   - Un fallo de Shopify JAMAS altera nada mas: sale en el resumen y ya. Este
//     modulo no lo invoca ninguna ruta, y el barrido de contactos lee la TABLA,
//     no este sondeo, asi que una tienda caida no toca la libreta de Google.

import { credencialesConfiguradas, leerPaginaDePedidos } from './shopify-pedidos.js';
import { ingerirPedido } from './pedidos-shopify-logica.js';
import * as pedidosStore from './pedidos-shopify-store.js';

// Lock en memoria propio, como el del barrido de contactos: ASUME UNA SOLA
// INSTANCIA (Render plan Starter). Es aparte del de contactos a proposito --
// los dos barridos corren a ritmos distintos y ninguno debe poder frenar al
// otro.
let sondeoEnCurso = false;

function resumenVacio(omitido) {
  return { omitido, leidos: 0, filas: 0, descartes: [], errores: [] };
}

export async function sondearPedidosShopify() {
  if (!credencialesConfiguradas()) return resumenVacio('sin credenciales');
  if (sondeoEnCurso) return resumenVacio('sondeo en curso');
  sondeoEnCurso = true;
  const resumen = resumenVacio(null);
  try {
    // El filtro es `updated_at:>=` y no `>`: el ultimo pedido visto vuelve a
    // llegar en cada corrida, que es el precio de no poder perder ninguno de
    // los que compartan esa misma marca de tiempo.
    const desde = await pedidosStore.leerCursor();
    let cursor = null;
    let hayMas = true;
    while (hayMas) {
      const pagina = await leerPaginaDePedidos({ desde, cursor });
      const filas = [];
      let ultimoVisto = null;
      for (const nodo of pagina.nodos) {
        resumen.leidos += 1;
        const ingerido = ingerirPedido(nodo);
        filas.push(...ingerido.filas);
        resumen.descartes.push(...ingerido.descartes);
        const actualizado = nodo?.updatedAt || '';
        if (actualizado > (ultimoVisto || '')) ultimoVisto = actualizado;
      }
      await pedidosStore.guardar(filas);
      resumen.filas += filas.length;
      // Solo avanza: una pagina sin pedidos nuevos no reescribe el cursor, y
      // asi dos corridas seguidas sobre el mismo estado no escriben la segunda.
      if (ultimoVisto && ultimoVisto > (desde || '')) await pedidosStore.guardarCursor(ultimoVisto);
      hayMas = pagina.hasNextPage;
      cursor = pagina.cursor;
    }
  } catch (err) {
    resumen.errores.push({ motivo: err.message });
  } finally {
    sondeoEnCurso = false;
  }
  return resumen;
}
