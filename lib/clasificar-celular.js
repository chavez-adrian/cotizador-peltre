import { buscarPorCelular } from './prospectos-store.js';
import { matchCliente } from './indice-telefonos.js';

// Clasificacion de un celular contra el embudo (issue #46): prospecto propio
// del cotizador primero, cliente Operam despues (indice best effort -- si
// Operam falla clasifica libre, trade-off aceptado de CONTEXT.md "Prospecto").
// La consumen POST /api/prospectos (captura), el hook de cotizacion y
// GET /api/prospectos/clasificar.
export async function clasificarCelular(celular) {
  const prospecto = await buscarPorCelular(celular);
  if (prospecto) return { tipo: 'prospecto', prospecto };
  const cliente = await matchCliente(celular);
  if (cliente) return { tipo: 'cliente', cliente };
  return { tipo: 'libre' };
}
