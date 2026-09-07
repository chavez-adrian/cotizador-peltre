// Las ligas Contacto -> Cliente Operam (#345, spec #337, ADR-0016, CONTEXT.md
// "Contacto" / "Cliente Operam"): nucleo PURO, sin IO.
//
// La relacion es MUCHOS A MUCHOS. La misma persona compra para dos razones
// sociales (su empresa y la de su socio, un restaurante y su matriz) y el
// cotizador guardaba una sola liga: `data.cliente_id` del Contacto. Cotizar a la
// segunda terminaba en un 409 sin salida ("el celular ya esta ligado al cliente
// X y difiere del elegido"), asi que la liga pasa a ser una LISTA y la segunda
// razon social se AGREGA, nunca reemplaza a la primera.
//
// Dos fuentes de liga, con nombre propio en cada entrada:
//   - cotizador: la creo este sistema al subir una cotizacion o al dar de alta;
//     es la unica que se PERSISTE.
//   - operam:  se deriva del indice de telefonos (el celular aparece en alguna
//     de las seis casillas del Cliente Operam) y se calcula EN LECTURA, nunca se
//     guarda: el padron de Operam cambia por fuera y una copia nuestra mentiria.

export const FUENTE_COTIZADOR = 'cotizador';
export const FUENTE_OPERAM = 'operam';

// La llave singular `data.cliente_id` NO desaparece: queda como la PRIMERA liga
// de la lista. Los lectores anteriores a #345 (tabla de prospectos, badge del
// tablero, seguimiento, el paso Cliente) siguen leyendola tal cual y ven lo
// mismo que veian; los que necesitan todas las razones sociales leen la lista.
function normalizar(entrada) {
  if (!entrada || entrada.cliente_id == null) return null;
  return { cliente_id: entrada.cliente_id, fuente: entrada.fuente || FUENTE_COTIZADOR };
}

// El `data` del Contacto -> sus ligas persistidas, en orden y sin repetidos.
export function ligasDeContacto(data) {
  const d = data || {};
  const crudas = [
    ...(d.cliente_id != null ? [{ cliente_id: d.cliente_id, fuente: FUENTE_COTIZADOR }] : []),
    ...(Array.isArray(d.clientes_operam) ? d.clientes_operam : []),
  ];
  const vistos = new Set();
  const ligas = [];
  for (const cruda of crudas) {
    const liga = normalizar(cruda);
    if (!liga) continue;
    const llave = String(liga.cliente_id);
    if (vistos.has(llave)) continue;
    vistos.add(llave);
    ligas.push(liga);
  }
  return ligas;
}

// Los ids de Operam llegan como numero por unos caminos y como texto por otros:
// la comparacion es SIEMPRE por valor, como el resto del repo.
export function estaLigadoA(ligas, clienteId) {
  if (clienteId == null) return false;
  return (ligas || []).some(l => String(l.cliente_id) === String(clienteId));
}

// La liga que hereda el significado del viejo `data.cliente_id`: la primera.
export function ligaPrincipal(ligas) {
  const l = (ligas || [])[0];
  return l ? l.cliente_id : null;
}

// Las ligas persistidas mas la derivada del indice de Operam, marcada con su
// fuente. Una que ya estaba persistida NO se duplica ni cambia de fuente: lo que
// el cotizador hizo consta, y el indice solo agrega lo que nadie anoto.
export function conLigaDerivada(ligas, clienteIdOperam) {
  const base = ligas || [];
  if (clienteIdOperam == null || estaLigadoA(base, clienteIdOperam)) return base;
  return [...base, { cliente_id: clienteIdOperam, fuente: FUENTE_OPERAM }];
}

// El parche que el store mergea en el `data` del Contacto. Devuelve las DOS
// llaves para que un Contacto viejo (solo singular) quede con la lista completa
// y uno nuevo conserve su liga principal.
export function parcheDeLiga(data, clienteId, fuente = FUENTE_COTIZADOR) {
  const ligas = ligasDeContacto(data);
  const completas = estaLigadoA(ligas, clienteId) || clienteId == null
    ? ligas
    : [...ligas, { cliente_id: clienteId, fuente }];
  return { cliente_id: ligaPrincipal(completas), clientes_operam: completas };
}

// Que hacer con la liga al subir una cotizacion a un Cliente Operam:
//   nada      = ya esta ligado (o no hay Cliente Operam que ligar);
//   confirmar = el Contacto ya tiene OTRAS ligas y el vendedor no ha dicho que
//               esto es otra razon social suya -- se le pregunta y NO se sube;
//   agregar   = se sube y la liga se suma a las que ya tenia.
export function decidirLiga(ligas, clienteId, { confirmado = false } = {}) {
  const otras = ligas || [];
  if (clienteId == null || estaLigadoA(otras, clienteId)) return { accion: 'nada', otras };
  if (otras.length && !confirmado) return { accion: 'confirmar', otras };
  return { accion: 'agregar', otras };
}
