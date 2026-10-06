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
// Desde #540 el estado lleva tambien la constancia en memoria, plana junto al modo
// (las funciones puras de alta-logica.js la reciben entera y copian con `...csf`):
// - status ('idle' | 'loading' | 'success' | 'error'), rfc (el RFC dueno del PDF, #350),
//   fileName, mensaje (el del error de lectura), datos, pdfBase64, regimenesDetectados
//   ({ rfc, codigos }, #390), confirmado (se escribe y nadie lo lee: estado muerto).
// - constanciaDeUpgrade: el customer_id del upgrade que se adueno de la constancia (#491).
// - lectura: el numero de la lectura del PDF vigente (#491), o null.
// - lecturas: contador MONOTONO de lecturas; ninguna transicion lo regresa, porque un
//   numero repetido haria vigente a una lectura huerfana.
//
// Cada transicion reproduce lo que hacia su camino de app.js antes de #539/#540, con
// sus asimetrias (tablas del ADR-0023): unificarlas es otro ticket. Ninguna muta el
// estado recibido.
//
// Desde #541 cada transicion devuelve { estado, acciones }: `acciones` son las
// instrucciones de pantalla que hacia a mano su funcion de app.js, en el MISMO orden,
// y las ejecuta UN ejecutor (aplicarModoAlta) despues de asignar el estado. Una lista
// vacia tambien es literal de la tabla: la actualizacion lograda no recoge el panel,
// no reenciende "Dar de alta" ni oculta el banner (asimetria 4 de la pantalla).

import { constanciaAlAbrirAlta, sinConstancia, estadoTrasErrorLectura, lecturaVigente } from './alta-logica.js';

// Los tipos que entiende el ejecutor de app.js. Un tipo fuera de esta lista lo hace lanzar.
// - recogerPanel: oculta #panel-alta-cliente y lo devuelve a su casa (#412, #489).
// - cerrarBorrador { formId }: deja de autoguardar esa superficie sin matar su borrador (#185).
// - botonDarDeAlta { habilitado }: "Dar de alta" existe solo en modo alta (#376).
// - banner { cliente }: { id, nombre, rfc } lo muestra; null lo vacia y lo oculta (#94).
// - candarSecciones: Secciones 3 y 4 a su candado y la 3 a modo captura (#376, #371).
// - limpiarProgreso: las palomas de "Progreso del alta" a vacio (#432).
export const ACCIONES_MODO = Object.freeze([
  'recogerPanel', 'cerrarBorrador', 'botonDarDeAlta', 'banner', 'candarSecciones', 'limpiarProgreso',
]);

// El boton se deriva del estado YA cambiado, nunca es literal (como lo hacia
// altaBotonDarDeAltaSegunModo, que leia el modo despues de la transicion).
const boton = estado => ({ tipo: 'botonDarDeAlta', habilitado: estado.clienteId == null });
const sinPantalla = estado => ({ estado, acciones: [] });

export const MODO_ALTA_INICIAL = Object.freeze({
  clienteId: null,
  origen: null,
  comercialPrecargado: undefined,
  status: 'idle',
  rfc: null,
  fileName: null,
  mensaje: null,
  datos: null,
  pdfBase64: null,
  regimenesDetectados: null,
  confirmado: false,
  constanciaDeUpgrade: null,
  lectura: null,
  lecturas: 0,
});

// abrirAcordeonAlta, al abrir (plegar no cambia el modo). La constancia que dejo un
// upgrade no es de este alta (#491): pasa por constanciaAlAbrirAlta.
// Pantalla: solo el boton y el banner; el candado y las palomas los pone el reinicio, y
// solo si el alta anterior se completo (asimetria 1 de la pantalla).
export function alAbrirAlta(m) {
  const { estado: conConstancia } = constanciaAlAbrirAlta(m);
  const estado = { ...conConstancia, clienteId: null, origen: null, comercialPrecargado: undefined };
  return { estado, acciones: [boton(estado), { tipo: 'banner', cliente: null }] };
}

// Lo que abrir el alta le dice a app.js (#540): si la constancia se descarto y la copia
// confirmada de la Seccion 1 (altaState.datos) que sobrevive. Se calcula sobre el estado
// ANTERIOR a alAbrirAlta y por la misma regla.
export function aperturaDelAlta(m, datosAlta = null) {
  const { descartada, datosAlta: sobrevive } = constanciaAlAbrirAlta(m, datosAlta);
  return { descartada, datosAlta: sobrevive };
}

// altaReiniciarPanel, tras un alta ya completada (#192). No toca la marca del upgrade
// ni el mensaje (asimetria 4 de la constancia).
export function alReiniciarAlta(m) {
  const estado = {
    ...m,
    status: 'idle',
    rfc: null,
    fileName: null,
    datos: null,
    pdfBase64: null,
    regimenesDetectados: null,
    confirmado: false,
    lectura: null,
  };
  return { estado, acciones: [boton(estado), { tipo: 'limpiarProgreso' }, { tipo: 'candarSecciones' }] };
}

// pcAbrirUpgradeFiscal: la precarga queda en null hasta que llegue. Lo que se cargue en
// el panel desde aqui es del upgrade (#491) y la lectura que empezo el alta queda
// huerfana. rfc, fileName, mensaje y confirmado no se tocan (asimetria 1 de la constancia).
// `banner` ({ nombre, rfc }) puede llegar null: el boton del Resumen abre sin el (#94).
export function alAbrirActualizacion(m, clienteId, origen, banner) {
  const estado = {
    ...m,
    clienteId,
    origen: origen || null,
    comercialPrecargado: null,
    status: 'idle',
    datos: null,
    pdfBase64: null,
    regimenesDetectados: null,
    constanciaDeUpgrade: clienteId,
    lectura: null,
  };
  return {
    estado,
    acciones: [
      { tipo: 'banner', cliente: { id: clienteId, nombre: banner?.nombre, rfc: banner?.rfc } },
      { tipo: 'candarSecciones' },
      { tipo: 'limpiarProgreso' },
      boton(estado),
    ],
  };
}

// pcPrecargarComercialUpgrade, con la lectura lograda. No mira el modo: si llega
// despues de cerrar el panel o de abrir otro cliente, se escribe igual (asimetria 4).
export function alPrecargarComercial(m, pre) {
  return sinPantalla({ ...m, comercialPrecargado: pre });
}

// pcEjecutarUpgradeFiscal, con la respuesta lograda. La fallida no es transicion: el
// modo se queda prendido para reintentar. La constancia ya quedo escrita en ESE cliente
// (#491): se marca suya -- por "Actualizar este" la habia cargado el alta --, pero la
// lectura en curso NO se anula (asimetria 2 de la constancia).
export function alLograrActualizacion(m, clienteId) {
  return sinPantalla({ ...m, clienteId: null, origen: null, comercialPrecargado: undefined, constanciaDeUpgrade: clienteId });
}

// altaCandidatoActualizar ("Actualizar este" del duplicado por RFC): no toca el origen
// (asimetria 2) y deja la precarga en undefined, porque el segmento que se capturo en
// el alta SI tiene que viajar (#193). Pantalla: solo apaga el boton (asimetria 3).
export function alActualizarCandidato(m, clienteId) {
  const estado = { ...m, clienteId, comercialPrecargado: undefined };
  return { estado, acciones: [boton(estado)] };
}

// altaCandidatoCrearNuevo: el modo vuelve a alta; la precarga se queda (asimetria 1).
export function alCrearNuevoCandidato(m) {
  const estado = { ...m, clienteId: null, origen: null };
  return { estado, acciones: [boton(estado)] };
}

// Recoger el panel (antes devolverPanelACasa; cinco llamadores): el modo vuelve a alta;
// la precarga se queda (asimetria 1). El borrador del upgrade se nombra con el id del
// estado ANTERIOR y solo si habia actualizacion; el del alta se cierra siempre.
export function alCerrarPanel(m) {
  const estado = { ...m, clienteId: null, origen: null };
  const acciones = [{ tipo: 'recogerPanel' }, { tipo: 'cerrarBorrador', formId: 'alta-completa' }];
  if (m.clienteId != null) acciones.push({ tipo: 'cerrarBorrador', formId: `upgrade-fiscal-${m.clienteId}` });
  acciones.push(boton(estado), { tipo: 'banner', cliente: null });
  return { estado, acciones };
}

// altaCsfProcesarArchivo, al empezar: la lectura nueva es la vigente. Los datos y el PDF
// anteriores siguen en memoria hasta que termine (asimetria 7 de la constancia).
export function alEmpezarLectura(m) {
  const lectura = (m.lecturas || 0) + 1;
  return sinPantalla({ ...m, lecturas: lectura, lectura, status: 'loading' });
}

// altaCsfProcesarArchivo, con el PDF leido. Una lectura que ya no es la vigente no
// escribe nada (#491). rfc y fileName solo cambian si los datos traen RFC (asimetria 6);
// mensaje y confirmado no se tocan (asimetrias 5 y 8).
export function alLeerConstancia(m, lectura, { status, datos, pdfBase64, fileName }) {
  if (!lecturaVigente(m, lectura)) return sinPantalla(m);
  const siguiente = {
    ...m,
    status,
    datos,
    pdfBase64,
    regimenesDetectados: {
      rfc: String(datos.rfc || '').trim().toUpperCase(),
      codigos: datos.regimenesFiscales || [],
    },
  };
  if (datos.rfc) {
    siguiente.rfc = datos.rfc;
    siguiente.fileName = fileName;
  }
  return sinPantalla(siguiente);
}

// altaCsfProcesarArchivo, con el PDF que no se pudo leer (#516). La vieja no escribe.
export function alFallarLectura(m, lectura, mensaje) {
  if (!lecturaVigente(m, lectura)) return sinPantalla(m);
  return sinPantalla(estadoTrasErrorLectura(m, mensaje));
}

// altaCsfConfirmar: la Seccion 1 confirmada. El RFC confirmado es el dueno del PDF
// (#350), solo si hay PDF.
export function alConfirmarConstancia(m, datos) {
  return sinPantalla({ ...m, datos, confirmado: true, rfc: m.pdfBase64 && datos.rfc ? datos.rfc : m.rfc });
}

// altaVaciarConstancia (el "vaciar" del borrador, #491): tambien quita la marca del
// upgrade (asimetria 9).
export function alVaciarConstancia(m) {
  return sinPantalla(sinConstancia(m));
}
