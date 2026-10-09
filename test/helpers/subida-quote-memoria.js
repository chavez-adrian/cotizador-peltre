// Adaptadores EN MEMORIA para los tests de lib/subida-quote.js (#524, ADR-0022).
// Implementan las MISMAS dependencias que el modulo recibe por `deps` -- el store
// de cotizaciones, `actualizarQuoteOperam` de la web legacy y la cola de
// reintentos del post-fix -- y registran que se les pidio, para que las reglas de
// la Subida del quote se prueben sin tocar globalThis.fetch ni levantar el
// servidor. Los resolutores del encabezado (`listaDelQuote`,
// `transportistaDelQuote`) los pasa el handler en produccion; aqui son fijos.
//
// `actualizar` es lo que contesta `actualizarQuoteOperam`: un objeto (se devuelve
// tal cual) o una funcion `(folio, data, opciones) => resultado`. Los desenlaces
// tipicos estan en RESULTADOS_ACTUALIZAR. `colgarActualizar()` deja la siguiente
// llamada en vuelo hasta que se llame a `soltar(resultado)`: asi se prueba el
// candado con dos operaciones concurrentes.
//
// Crear por el camino normal (#525) suma las dependencias de la subida:
// `resolver` contesta resolverClienteDeCotizacion, `subir` contesta
// subirCotizacionOperam y `corregir` contesta corregirVigenciaQuote (un objeto, o
// una funcion que puede lanzar); `prospectos` son los Contactos que
// buscarPorCelular encuentra por los ultimos 10 digitos, y `ligarFalla` hace
// lanzar a ligarCliente. `secuencia` registra TODAS las llamadas en el orden en
// que ocurrieron (nombre de la dependencia + argumentos): es lo que prueba que
// el folio, la huella y el motivo se guardan antes del post-fix.
//
// Crear con alta de cliente (#526) suma `alta`, lo que contesta darDeAlta (un
// objeto, o una funcion `(solicitud) => resultado`; una prueba que quiera el alta
// REAL la compone sobre test/helpers/operam-memoria.js y la pasa aqui), y
// `listasPrecios`, lo que contesta obtenerListasPrecios. Las dos quedan en
// `secuencia` como el resto.
//
// El Contacto de entrega en el domicilio (#561) entra como `contactoEntrega`, lo que
// contesta escribirContactoEntrega del modulo Contactos en Operam (un objeto, o una
// funcion `(solicitud) => resultado` que puede lanzar). Por defecto no escribe nada ni
// agrega pasos, para que las pruebas de otras reglas no cambien.
//
// La Fusion de Contactos (#565) entra como `fusion`, lo que contesta fundirContactos
// (un objeto, o una funcion `(solicitud) => resultado` que puede lanzar).

const clonar = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));

export const RESULTADOS_ACTUALIZAR = {
  exito: () => ({ ok: true, escrito: true, verificado: true, discrepancias: [] }),
  falloAntesDeEscribir: () => ({
    ok: false, escrito: false, verificado: false, discrepancias: [],
    error: 'FA no agrego la partida SKU-NUEVO: se abandona la edicion sin confirmar',
  }),
  escritoSinVerificar: () => ({
    ok: false, escrito: true, verificado: false,
    discrepancias: ['partida SKU-NUEVO: cantidad 2 en Operam, se esperaba 3'],
    error: 'El quote quedo distinto de lo esperado',
  }),
  // Lo minimo que alguien podria devolver: sin error, discrepancias, escrito ni
  // verificado. El modulo los normaliza (null, [], false, false).
  sinCampos: () => ({ ok: false }),
};

export const LISTA_ESCRITA = {
  aplica: true, esperado: '15', escrita: true, yaCorrecto: false, ok: true, verificado: true, encontrado: '15',
};

export const TRANSPORTISTA_ESCRITO = {
  aplica: true, esperado: '3', escrita: true, yaCorrecto: false, ok: true, verificado: true, encontrado: '3',
};

// #556: el telefono y el correo del Contacto de entrega de la cotizacion de ejemplo
// (el correo, opcional, vacio), escritos y releidos.
export const TELEFONO_ENTREGA_ESCRITO = {
  aplica: true, esperado: '5512345678', escrita: true, yaCorrecto: false, ok: true, verificado: true, encontrado: '5512345678', motivo: null,
};

export const CORREO_ENTREGA_ESCRITO = {
  aplica: true, esperado: '', escrita: true, yaCorrecto: false, ok: true, verificado: true, encontrado: '', motivo: null,
};

export const POSTFIX_VERIFICADO = {
  ok: true, verificado: true, esperado: '2026-08-27', encontrado: '2026-08-27',
  lista: LISTA_ESCRITA, transportista: TRANSPORTISTA_ESCRITO,
  telefonoEntrega: TELEFONO_ENTREGA_ESCRITO, correoEntrega: CORREO_ENTREGA_ESCRITO,
};

const ultimos10 = (x) => String(x || '').replace(/\D/g, '').slice(-10);
const resolverValor = (v, args) => (typeof v === 'function' ? v(...args) : clonar(v));

export function subidaQuoteEnMemoria({
  cotizaciones = [],
  actualizar = RESULTADOS_ACTUALIZAR.exito(),
  lista = '15',
  transportista = { shipVia: 3, linea: 'Lalamove', motivo: null },
  cola = [],
  ahora = '2026-10-03T12:00:00.000Z',
  resolver = { customerId: 15, branchId: 15 },
  subir = { folio: '1330', customerId: 15 },
  corregir = POSTFIX_VERIFICADO,
  prospectos = [],
  ligarFalla = null,
  alta = { tipo: 'lograda', clienteId: 900, domicilioId: 800, creadoNuevo: true, pasos: [] },
  listasPrecios = [{ id: 12, nombre: 'Precio de lista' }, { id: 15, nombre: 'M100' }],
  contactoEntrega = { tipo: 'lograda', escrito: false, pasos: [] },
  fusion = { tipo: 'lograda', fundido: false, motivo: 'sin-contacto-viejo', pasos: [] },
} = {}) {
  const registros = new Map(cotizaciones.map((c) => [c.id, clonar(c)]));
  const enCola = new Set(cola.map(String));
  const llamadas = {
    obtener: [], actualizarDatos: [], actualizarQuoteOperam: [], sacarDeLaColaPostFix: [],
    setFolioOperam: [], resolverClienteDeCotizacion: [], subirCotizacionOperam: [],
    corregirVigenciaQuote: [], encolarPostFix: [], buscarPorCelular: [], ligarCliente: [], darDeAlta: [], obtenerListasPrecios: [],
    escribirContactoEntrega: [], fundirContactos: [],
  };
  const secuencia = [];
  const anotar = (nombre, args) => {
    const a = clonar(args);
    llamadas[nombre].push(a);
    secuencia.push([nombre, a]);
  };
  let colgada = null;

  const deps = {
    async obtener(id) {
      llamadas.obtener.push(id);
      secuencia.push(['obtener', id]);
      return clonar(registros.get(id) ?? null);
    },
    async actualizarDatos(id, campos) {
      llamadas.actualizarDatos.push([id, clonar(campos)]);
      secuencia.push(['actualizarDatos', [id, clonar(campos)]]);
      const r = registros.get(id);
      if (!r) return false;
      r.data = { ...(r.data || {}), ...clonar(campos) };
      return true;
    },
    async actualizarQuoteOperam(folio, data, opciones) {
      llamadas.actualizarQuoteOperam.push([folio, clonar(data), clonar(opciones)]);
      if (colgada) {
        const c = colgada;
        colgada = null;
        return c.promesa;
      }
      return typeof actualizar === 'function' ? actualizar(folio, data, opciones) : clonar(actualizar);
    },
    async sacarDeLaColaPostFix(folio) {
      llamadas.sacarDeLaColaPostFix.push(folio);
      secuencia.push(['sacarDeLaColaPostFix', folio]);
      enCola.delete(String(folio));
    },
    async setFolioOperam(id, folio) {
      anotar('setFolioOperam', [id, folio]);
      const r = registros.get(id);
      if (r) r.folioOperam = folio == null ? null : String(folio);
    },
    async resolverClienteDeCotizacion(data) {
      anotar('resolverClienteDeCotizacion', [data]);
      return resolverValor(resolver, [data]);
    },
    async subirCotizacionOperam(data, opciones) {
      anotar('subirCotizacionOperam', opciones === undefined ? [data] : [data, opciones]);
      return resolverValor(subir, [data, opciones]);
    },
    async corregirVigenciaQuote(folio, vigencia, opciones) {
      anotar('corregirVigenciaQuote', [folio, vigencia, opciones]);
      return resolverValor(corregir, [folio, vigencia, opciones]);
    },
    encolarPostFix(fila) {
      anotar('encolarPostFix', [fila]);
    },
    async buscarPorCelular(celular) {
      anotar('buscarPorCelular', [celular]);
      return clonar(prospectos.find((p) => ultimos10(p.celular) === ultimos10(celular))) ?? undefined;
    },
    async ligarCliente(id, clienteId, evento) {
      anotar('ligarCliente', [id, clienteId, evento]);
      if (ligarFalla) throw ligarFalla;
      return true;
    },
    async darDeAlta(solicitud) {
      anotar('darDeAlta', [solicitud]);
      // Sin clonar: el resultado puede traer `segmentoDiferido`, una funcion.
      return typeof alta === 'function' ? alta(solicitud) : { ...alta, pasos: [...(alta.pasos || [])] };
    },
    async escribirContactoEntrega(solicitud) {
      anotar('escribirContactoEntrega', [solicitud]);
      return resolverValor(contactoEntrega, [solicitud]);
    },
    async fundirContactos(solicitud) {
      anotar('fundirContactos', [solicitud]);
      return resolverValor(fusion, [solicitud]);
    },
    async obtenerListasPrecios() {
      anotar('obtenerListasPrecios', []);
      return clonar(listasPrecios);
    },
    listaDelQuote: () => lista,
    transportistaDelQuote: () => ({ ...transportista }),
    ahora: () => new Date(ahora),
  };

  return {
    deps,
    llamadas,
    secuencia,
    registro: (id) => clonar(registros.get(id) ?? null),
    enCola: (folio) => enCola.has(String(folio)),
    colgarActualizar() {
      let soltar;
      const promesa = new Promise((res) => { soltar = res; });
      colgada = { promesa };
      return { soltar };
    },
  };
}
