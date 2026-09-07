// El buscador de la vista Clientes, por Contacto (#346, spec #337, ADR-0016,
// CONTEXT.md "Contacto" / "Cliente Operam"): nucleo PURO, sin IO.
//
// Hasta este ticket la vista mezclaba dos listas -- los Clientes Operam que
// devolvia Operam y los prospectos del vendedor -- y la misma persona salia dos
// veces: Jorge Orea como registro de Operam y como prospecto, aunque el
// prospecto ya estuviera ligado a ese mismo `customer_id`. No era un problema de
// fusionar filas parecidas: el sistema no distinguia a la PERSONA de la ENTIDAD
// LEGAL.
//
// Aqui la unidad de la fila es el Contacto (un celular) y los Clientes Operam
// cuelgan de el. La relacion es de MUCHOS A MUCHOS en los dos sentidos:
//   - un Contacto tiene varios Clientes Operam (su empresa y la de su socio), y
//     los ve todos en su fila, una sola vez cada uno;
//   - un Cliente Operam tiene varios Contactos (la linea del restaurante y el
//     celular de la compradora), y aparece bajo CADA uno -- pero entonces ya no
//     vuelve a salir como fila suelta, que es la duplicacion que este ticket
//     cierra.
// Un Cliente Operam del que no conocemos a nadie sigue siendo su propia fila:
// es el padron historico, y esconderlo seria perderlo.
//
// La liga Contacto -> Cliente Operam llega resuelta por el llamador, con las dos
// fuentes de ADR-0016: `celularesPorCliente` es la derivada del indice de
// telefonos (el celular en cualquiera de las seis casillas) y `clientesOperam`
// de cada Contacto son las que el cotizador persistio (lib/ligas-contacto.js).

import { ultimos10 } from './telefono-llave.js';

// Los ids de Operam llegan como numero por unos caminos y como texto por otros:
// la comparacion es SIEMPRE por valor, como el resto del repo.
function idTexto(id) {
  return String(id);
}

// clientesOperam: las filas de Clientes Operam del resultado, cada una con `id`.
// contactos: las fichas de Contacto que entran al resultado, cada una con
//   `celular` y, opcionalmente, los Clientes Operam que ya se le conocen.
// celularesPorCliente: Map(customer_id -> celulares de sus seis casillas).
export function filasBuscadorClientes({ clientesOperam = [], contactos = [], celularesPorCliente = new Map() } = {}) {
  const contactoPorCelular = new Map();
  for (const c of contactos) {
    const cel = ultimos10(c && c.celular);
    if (cel.length === 10 && !contactoPorCelular.has(cel)) contactoPorCelular.set(cel, c);
  }

  // De quien es cada Cliente Operam del resultado. Se recorre una sola vez y se
  // apunta en los dos sentidos: lo que cuelga de cada Contacto y que ya no
  // necesita fila propia.
  //
  // "Ya cuelga de alguien" tiene DOS fuentes, y las dos tienen que apagar la
  // fila suelta: la derivada (su celular esta en una casilla de este Contacto) y
  // la que el cotizador persistio (el Contacto llega con el en su lista). Con
  // solo la primera, un Cliente Operam ligado a mano cuyo celular Operam no
  // conoce salia anidado Y suelto -- la duplicacion que el ticket cierra.
  const anidadosPorCelular = new Map();
  const conContacto = new Set();
  for (const c of contactos) {
    for (const suyo of c.clientesOperam || []) conContacto.add(idTexto(suyo && suyo.id));
  }
  for (const cliente of clientesOperam) {
    const celulares = new Set(
      (celularesPorCliente.get(idTexto(cliente && cliente.id)) || []).map(ultimos10));
    for (const cel of celulares) {
      const ficha = contactoPorCelular.get(cel);
      if (!ficha) continue;
      conContacto.add(idTexto(cliente.id));
      if (!anidadosPorCelular.has(cel)) anidadosPorCelular.set(cel, []);
      anidadosPorCelular.get(cel).push(cliente);
    }
  }

  const filasContacto = contactos.map(c => {
    const cel = ultimos10(c && c.celular);
    const propios = c.clientesOperam || [];
    const vistos = new Set(propios.map(x => idTexto(x && x.id)));
    const derivados = (anidadosPorCelular.get(cel) || []).filter(x => !vistos.has(idTexto(x && x.id)));
    return { ...c, tipo: 'contacto', clientesOperam: [...propios, ...derivados] };
  });

  const sueltos = clientesOperam
    .filter(c => !conContacto.has(idTexto(c && c.id)))
    .map(c => ({ ...c, tipo: 'operam' }));

  return [...filasContacto, ...sueltos];
}
