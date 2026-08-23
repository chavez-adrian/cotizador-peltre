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
import { ingerirPedido, MOTIVOS } from './pedidos-shopify-logica.js';
import * as pedidosStore from './pedidos-shopify-store.js';

// Lock en memoria propio, como el del barrido de contactos: ASUME UNA SOLA
// INSTANCIA (Render plan Starter). Es aparte del de contactos a proposito --
// los dos barridos corren a ritmos distintos y ninguno debe poder frenar al
// otro.
let sondeoEnCurso = false;

// Umbral de pedidos NUEVOS SEGUIDOS sin ningun candidato de telefono antes de
// registrarlo como error de datos (issue #257, ADR-0014: "si un dia los
// pedidos empiezan a llegar sin telefono, la fuente no falla: se vacia hacia
// adelante"). Chico a proposito: un pedido suelto sin telefono es normal (hay
// compradores que no lo dejan en ninguna direccion), pero tres SEGUIDOS ya es
// la senal de que Shopify dejo de entregarlo al token, no ruido de un
// comprador aislado.
const UMBRAL_SIN_TELEFONO_SEGUIDOS = 3;

function resumenVacio(omitido) {
  return { omitido, leidos: 0, filas: 0, descartes: [], errores: [] };
}

// Cuenta los descartes por motivo para el panel (#257): "3 sin codigo de pais,
// 1 telefono no reconocido", en vez de una lista plana de 300 renglones.
function descartesPorMotivo(descartes) {
  const conteo = new Map();
  for (const d of descartes) {
    const motivo = d.motivo || 'sin motivo';
    conteo.set(motivo, (conteo.get(motivo) || 0) + 1);
  }
  return [...conteo.entries()].map(([motivo, cantidad]) => ({ motivo, cantidad }));
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
    // Cuenta la racha de pedidos NUEVOS sin ningun telefono a lo largo de TODA
    // la pasada, no por pagina: un umbral que se reiniciara en cada pagina de
    // 100 nunca se cumpliria si Shopify decidiera partir la racha justo ahi.
    let sinTelefonoSeguidos = 0;
    let avisoSinTelefonoAgregado = false;
    while (hayMas) {
      const pagina = await leerPaginaDePedidos({ desde, cursor });
      const filas = [];
      let ultimoVisto = null;
      for (const nodo of pagina.nodos) {
        resumen.leidos += 1;
        const ingerido = ingerirPedido(nodo);
        filas.push(...ingerido.filas);
        resumen.descartes.push(...ingerido.descartes);
        const esSinTelefono = ingerido.filas.length === 0
          && ingerido.descartes.length === 1
          && ingerido.descartes[0].motivo === MOTIVOS.sinTelefono;
        sinTelefonoSeguidos = esSinTelefono ? sinTelefonoSeguidos + 1 : 0;
        if (sinTelefonoSeguidos === UMBRAL_SIN_TELEFONO_SEGUIDOS && !avisoSinTelefonoAgregado) {
          avisoSinTelefonoAgregado = true;
          resumen.errores.push({ motivo: MOTIVOS.sinTelefono, categoria: 'datos' });
        }
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
  // totales (#257): lo que el panel de /admin pinta para este barrido --
  // lib/contactos-observabilidad.js no conoce esta forma, solo la conserva.
  resumen.totales = {
    leidos: resumen.leidos,
    filas: resumen.filas,
    descartesPorMotivo: descartesPorMotivo(resumen.descartes),
  };
  return resumen;
}
