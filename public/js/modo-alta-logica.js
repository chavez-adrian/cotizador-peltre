// Modo del alta (#539, ADR-0023). El panel del alta y el de la actualizacion fiscal
// son el MISMO nodo (#376); en que modo esta lo decide este modulo, no la pantalla.
// app.js guarda UN objeto de estado y lo reemplaza con lo que devuelve una transicion
// (aplicarModoAlta); nadie mas lo escribe.
//
// - clienteId: el customer_id del Cliente Operam cuya actualizacion fiscal esta abierta,
//   o null (alta). Es la PRESENCIA del id la que decide el modo: el 0 sigue siendo id.
// - origen: desde donde se abrio la actualizacion ('paso' | 'clientes' | 'resumen'), o null.
// - comercialPrecargado: la linea base de la Seccion 2 (#197). undefined = no hay panel
//   comercial (los datos viajan tal cual, camino de "Actualizar este"); null = la
//   precarga fallo o no ha llegado (no viaja nada comercial); objeto = la precarga.
//
// Cada transicion reproduce lo que hacia su camino de app.js antes de #539, con sus
// asimetrias (tabla del ADR-0023): unificarlas es otro ticket. Ninguna muta el estado
// recibido.

export const MODO_ALTA_INICIAL = Object.freeze({ clienteId: null, origen: null, comercialPrecargado: undefined });

// abrirAcordeonAlta, al abrir (plegar no cambia el modo).
export function alAbrirAlta(m) {
  return { ...m, clienteId: null, origen: null, comercialPrecargado: undefined };
}

// pcAbrirUpgradeFiscal: la precarga queda en null hasta que llegue.
export function alAbrirActualizacion(m, clienteId, origen) {
  return { ...m, clienteId, origen: origen || null, comercialPrecargado: null };
}

// pcPrecargarComercialUpgrade, con la lectura lograda. No mira el modo: si llega
// despues de cerrar el panel o de abrir otro cliente, se escribe igual (asimetria 4).
export function alPrecargarComercial(m, pre) {
  return { ...m, comercialPrecargado: pre };
}

// pcEjecutarUpgradeFiscal, con la respuesta lograda. La fallida no es transicion: el
// modo se queda prendido para reintentar.
export function alLograrActualizacion(m) {
  return { ...m, clienteId: null, origen: null, comercialPrecargado: undefined };
}

// altaCandidatoActualizar ("Actualizar este" del duplicado por RFC): no toca el origen
// (asimetria 2) y deja la precarga en undefined, porque el segmento que se capturo en
// el alta SI tiene que viajar (#193).
export function alActualizarCandidato(m, clienteId) {
  return { ...m, clienteId, comercialPrecargado: undefined };
}

// altaCandidatoCrearNuevo: el modo vuelve a alta; la precarga se queda (asimetria 1).
export function alCrearNuevoCandidato(m) {
  return { ...m, clienteId: null, origen: null };
}

// devolverPanelACasa: el modo vuelve a alta; la precarga se queda (asimetria 1).
export function alCerrarPanel(m) {
  return { ...m, clienteId: null, origen: null };
}
