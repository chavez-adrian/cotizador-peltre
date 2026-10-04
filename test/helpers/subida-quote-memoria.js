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

export function subidaQuoteEnMemoria({
  cotizaciones = [],
  actualizar = RESULTADOS_ACTUALIZAR.exito(),
  lista = '15',
  transportista = { shipVia: 3, linea: 'Lalamove', motivo: null },
  cola = [],
  ahora = '2026-10-03T12:00:00.000Z',
} = {}) {
  const registros = new Map(cotizaciones.map((c) => [c.id, clonar(c)]));
  const enCola = new Set(cola.map(String));
  const llamadas = { obtener: [], actualizarDatos: [], actualizarQuoteOperam: [], sacarDeLaColaPostFix: [] };
  let colgada = null;

  const deps = {
    async obtener(id) {
      llamadas.obtener.push(id);
      return clonar(registros.get(id) ?? null);
    },
    async actualizarDatos(id, campos) {
      llamadas.actualizarDatos.push([id, clonar(campos)]);
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
      enCola.delete(String(folio));
    },
    listaDelQuote: () => lista,
    transportistaDelQuote: () => ({ ...transportista }),
    ahora: () => new Date(ahora),
  };

  return {
    deps,
    llamadas,
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
