import { buscarPorCelular } from './prospectos-store.js';
import { matchCliente } from './indice-telefonos.js';
import { esProspecto } from './etiquetas-contacto.js';

// Clasificacion de un celular contra el embudo (issue #46): prospecto propio
// del cotizador primero, cliente Operam despues (indice best effort -- si
// Operam falla clasifica libre, trade-off aceptado de CONTEXT.md "Prospecto").
// La consumen POST /api/prospectos (captura), el hook de cotizacion y
// GET /api/prospectos/clasificar.
//
// "Prospecto" es una ETIQUETA del Contacto (#344, ADR-0016), no "tener fila en
// la tabla": la decide lib/etiquetas-contacto.js y desde #342 las dos cosas
// dejaron de coincidir. El Contacto que nacio de la migracion (marca
// sinCaptura) existe para que una Oportunidad historica tenga de quien ser --
// nadie lo capturo nunca, y decir que es prospecto es decirle al vendedor que
// alguien lo trabajo. Lo que ese Contacto SI tiene es Cliente Operam: el del
// indice de telefonos, o el que su propia ficha trae ligado.
//
// Un Contacto sin captura del que no se conoce ningun Cliente Operam se sigue
// reportando como prospecto: el guardrail que importa (un celular que ya es
// Contacto no se vuelve a capturar) tiene que aguantar, y darle su propio tipo
// pertenece a #343, que es quien reescribe las respuestas de la captura.
export async function clasificarCelular(celular) {
  const contacto = await buscarPorCelular(celular);
  if (esProspecto(contacto)) return { tipo: 'prospecto', prospecto: contacto };
  const cliente = await matchCliente(celular);
  if (cliente) return { tipo: 'cliente', cliente };
  const ligado = contacto && contacto.data && contacto.data.cliente_id;
  if (ligado != null && ligado !== '') {
    return { tipo: 'cliente', cliente: { customer_id: ligado, cust_name: contacto.nombre || '' } };
  }
  if (contacto) return { tipo: 'prospecto', prospecto: contacto };
  return { tipo: 'libre' };
}
