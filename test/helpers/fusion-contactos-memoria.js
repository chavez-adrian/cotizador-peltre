// Adaptador en memoria de la Fusion de Contactos (#565, CODING_STANDARDS.md regla 4):
// implementa las MISMAS dependencias que `fundirContactos` toma de los stores reales
// (lib/prospectos-store.js = Contactos, lib/oportunidades-store.js,
// lib/cotizaciones-store.js) con la forma que esos stores devuelven, sin tocar
// data/*.json ni Neon.
//
//   const mem = fusionContactosEnMemoria({ contactos, oportunidades, cotizaciones, falla });
//   await fundirContactos(solicitud, mem.deps);
//   mem.estado.contactos / .oportunidades / .cotizaciones  -> lo que quedo
//
// `falla` = { '<grupo>.<funcion>': true } hace lanzar a esa funcion (p. ej.
// `{ 'contactos.borrar': true }`).
import { ultimos10 } from '../../lib/telefono-llave.js';

const clonar = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

export function fusionContactosEnMemoria({ contactos = [], oportunidades = [], cotizaciones = [], falla = {}, ahora = '2026-10-09T18:00:00.000Z' } = {}) {
  const estado = {
    contactos: clonar(contactos).map((c) => ({ eventos: [], data: {}, ...c, celular10: ultimos10(c.celular) })),
    oportunidades: clonar(oportunidades).map((o) => ({ eventos: [], data: {}, ...o })),
    cotizaciones: clonar(cotizaciones).map((c) => ({ contactoCelular: null, ...c })),
  };
  const llamadas = [];
  const paso = (nombre, args) => {
    llamadas.push([nombre, args]);
    if (falla[nombre]) throw new Error(`${nombre} fallo (memoria)`);
  };

  const contactosStore = {
    async buscarPorCelular(celular) {
      paso('contactos.buscarPorCelular', [celular]);
      const c10 = ultimos10(celular);
      return clonar(estado.contactos.find((c) => c.celular10 === c10));
    },
    async cambiarCelular(id, celular) {
      paso('contactos.cambiarCelular', [id, celular]);
      const c = estado.contactos.find((x) => x.id === id);
      if (!c) return false;
      if (estado.contactos.some((x) => x.id !== id && x.celular10 === ultimos10(celular))) {
        throw Object.assign(new Error('celular duplicado'), { code: '23505' });
      }
      c.celular = celular;
      c.celular10 = ultimos10(celular);
      return true;
    },
    async actualizarDatos(id, campos) {
      paso('contactos.actualizarDatos', [id, campos]);
      const c = estado.contactos.find((x) => x.id === id);
      if (!c) return false;
      for (const k of ['nombre', 'ciudad', 'canal', 'vendedor']) if (campos[k] != null) c[k] = campos[k];
      c.data = { ...(c.data || {}), ...(campos.data || {}) };
      return true;
    },
    async registrarEvento(id, evento) {
      paso('contactos.registrarEvento', [id, evento]);
      const c = estado.contactos.find((x) => x.id === id);
      if (!c) return null;
      c.eventos.push(clonar(evento));
      return c.eventos;
    },
    async borrar(id) {
      paso('contactos.borrar', [id]);
      const i = estado.contactos.findIndex((x) => x.id === id);
      if (i === -1) return false;
      estado.contactos.splice(i, 1);
      return true;
    },
  };

  const oportunidadesStore = {
    async listar() {
      paso('oportunidades.listar', []);
      return clonar(estado.oportunidades);
    },
    async crear(entry) {
      paso('oportunidades.crear', [entry]);
      const max = Math.max(0, ...estado.contactos.map((c) => c.id), ...estado.oportunidades.map((o) => o.id));
      const id = entry.id ?? max + 1;
      estado.oportunidades.push({ ...clonar(entry), id, eventos: clonar(entry.eventos || []), data: clonar(entry.data || {}) });
      return id;
    },
    async reasignarContacto(contactoIdViejo, contactoIdNuevo, contacto10) {
      paso('oportunidades.reasignarContacto', [contactoIdViejo, contactoIdNuevo, contacto10]);
      const movidas = estado.oportunidades.filter((o) => o.contactoId === contactoIdViejo);
      for (const o of movidas) { o.contactoId = contactoIdNuevo; o.contacto10 = contacto10; }
      return movidas.map((o) => o.id);
    },
  };

  const cotizacionesStore = {
    async listar() {
      paso('cotizaciones.listar', []);
      return clonar(estado.cotizaciones);
    },
    async moverContactoCelular(de, a) {
      paso('cotizaciones.moverContactoCelular', [de, a]);
      const movidas = estado.cotizaciones.filter((c) => c.contactoCelular === de);
      for (const c of movidas) c.contactoCelular = a;
      return movidas.map((c) => c.id);
    },
    async setContactoCelular(id, celular) {
      paso('cotizaciones.setContactoCelular', [id, celular]);
      const c = estado.cotizaciones.find((x) => x.id === id);
      if (!c || c.contactoCelular) return false;
      c.contactoCelular = celular;
      return true;
    },
    async setTelefonoCliente(id, telefono) {
      paso('cotizaciones.setTelefonoCliente', [id, telefono]);
      const c = estado.cotizaciones.find((x) => x.id === id);
      if (!c || !c.data?.cliente) return false;
      c.data.cliente.telefono = telefono;
      return true;
    },
  };

  return {
    estado,
    llamadas,
    deps: {
      contactos: contactosStore,
      oportunidades: oportunidadesStore,
      cotizaciones: cotizacionesStore,
      ahora: () => new Date(ahora),
    },
  };
}
