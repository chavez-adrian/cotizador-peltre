// Guarda contra la red REAL bajo node:test (#410). El .env local lleva las
// credenciales de Operam y server.js las carga, asi que una prueba que olvida
// su mock no fallaba: salia a produccion, barria el padron y los pedidos desde
// 2010 y dejaba el proceso vivo minutos (7 archivos = 92% de la suite).
// "Mockeado" = alguien reemplazo globalThis.fetch; el nativo se captura al
// cargar el modulo, antes de que cualquier prueba lo toque.
const FETCH_NATIVO = globalThis.fetch;

const ES_ARCHIVO_DE_PRUEBA = /[.]test[.][cm]?js$/;

export class ErrorRedEnPruebas extends Error {
  constructor(url) {
    super(`Prueba sin mock de fetch: se intento salir a la red real (${url}). Usa mockFetchByUrl / mockOperamFetch o el adaptador en memoria.`);
    this.name = 'ErrorRedEnPruebas';
  }
}

export function corriendoBajoNodeTest() {
  return Boolean(process.env.NODE_TEST_CONTEXT) || ES_ARCHIVO_DE_PRUEBA.test(process.argv[1] || '');
}

export function fetchSinRedEnPruebas(url, init, {
  enPruebas = corriendoBajoNodeTest(),
  fetchNativo = FETCH_NATIVO,
  fetchActual = globalThis.fetch,
} = {}) {
  if (enPruebas && fetchActual === fetchNativo) return Promise.reject(new ErrorRedEnPruebas(url));
  return fetchActual(url, init);
}
