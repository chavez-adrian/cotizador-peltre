// EL modulo Fusion de Contactos (#565, enmienda 2026-10-09 a ADR-0016, GLOSSARY.md
// "Contacto"). Reglas de modulo de dominio en CODING_STANDARDS.md.
//
// La identidad del Contacto ES su celular (ultimos 10 digitos), asi que cambiar de
// numero es otro Contacto. La excepcion: cuando el vendedor cambia desde el cotizador
// el numero de un Contacto en Operam, el person_id (que no cambia al editarlo) dice que
// es la misma persona, y el Contacto del numero viejo se funde solo en el del nuevo con
// su historial, sus Oportunidades y sus etiquetas. Lo dispara la Subida del quote cuando
// el modulo Contactos en Operam CONFIRMA (relectura) que cambio el numero de identidad
// de la persona -- Cel > Telefono > Secundario, el que el cotizador le propone (revision
// de #557) --; un numero nuevo sin person_id detras nunca llega aqui y se sigue fundiendo
// a mano.
//
// Hasta #565 no existia ninguna fusion de Contactos en el codigo ("se funde a mano").
//
// Fundir es mover todo lo que cuelga del Contacto viejo al del numero nuevo:
//   - sus Oportunidades propias (`contacto_id` Y `contacto10`: el tablero las cruza por
//     las dos llaves), antes separando la que su ficha todavia sintetizaba (#343), y la
//     del Contacto nuevo si va a recibir alguna -- con Oportunidades propias, la ficha
//     deja de sintetizar la suya --;
//   - sus cotizaciones (la liga fija `contacto_celular` de #342; la fusion es su unica
//     excepcion legitima) y las historicas sin liga que cruzaban por lo tecleado;
//     de ellas, el telefono del paso Cliente (`data.cliente.telefono`) que era el numero
//     viejo pasa al nuevo (si no, abrirla ofrecia al Contacto con el viejo y Copiar
//     nacia con el); el del Contacto de entrega viaja en el quote y no se toca;
//   - sus ligas a Clientes Operam (se UNEN, nunca se reemplazan) y lo que la ficha del
//     nuevo no tenga (nombre, ciudad, Origen, vendedor, empresa, correo...): lo que ya
//     tiene el Contacto que queda manda; las notas se juntan;
//   - la etiqueta prospecto: si a uno lo capturaron, el que queda lo esta.
// Las demas etiquetas son derivadas (cotizado, Ya compro) y se siguen solas de lo
// movido. Cliente en linea sale de los pedidos de la tienda por NUMERO y no se mueve.
//
// Si el numero nuevo todavia no es un Contacto, el viejo se MUDA al numero nuevo (misma
// ficha, mismo id, mismos eventos) en vez de crear otro y fundir. Si el numero viejo no
// era un Contacto, no hay nada que fundir.
//
// La fusion QUEDA REGISTRADA como un evento `fusion` en el Contacto que queda: de que
// numero a que numero, por que person_id, desde que cotizacion, que Contacto se fundio
// (con sus eventos) y que se movio. Al final se borra la ficha vieja.
//
// No es transaccional (el fallback JSON tampoco podria serlo): si un paso falla a
// medias, el desenlace dice que ya se movio.
//
// D4 (decisiones de Adrian 2026-10-09): la fusion ya no corre sola. La Subida del quote
// le pregunta antes al vendedor con lo que leyo `resumenDelCambioDeNumero` (cuantas
// oportunidades y cotizaciones pasan al numero nuevo y si el numero viejo tiene las de
// OTRAS personas: telefono compartido), y solo funde con su confirmacion. Ningun texto
// que ve el vendedor dice "fundir" ni "fusion": el paso se llama "Contacto movido al
// numero nuevo" (public/js/cambio-numero-logica.js). El evento `fusion` guarda la ficha
// vieja COMPLETA (`fichaAnterior`) para poder deshacer a mano.
//
// Solicitud: { celularViejo, celularNuevo, personId, cotizacion?: { id, folio }, vendedor? }
//
// Valores (paso `name: 'fusion de Contactos'`, Mensaje en dos capas):
//   { tipo: 'lograda', fundido: true, forma: 'fundido' | 'mudado', contactoId,
//     contactoFundido, oportunidades, cotizaciones, pasos }
//   { tipo: 'lograda', fundido: false, motivo, pasos }   (paso `omitido`, nada escrito)
//       motivo: 'sin-numero' (alguno no tiene 10 digitos), 'mismo-numero',
//       'sin-contacto-viejo'.
//   { tipo: 'bloqueo', motivo: 'registro', mensaje, detalle, pasos }
//       un store fallo; paso `warn` con lo que alcanzo a moverse.
//
// `resumenDelCambioDeNumero({ celularViejo, nombres }, deps)` (D4) solo LEE: `{
// contactoViejo, oportunidades, cotizaciones, otrasPersonas, cotizacionesDeOtras }` --
// lo que fundir moveria, los nombres de otras personas en las cotizaciones del numero
// viejo y cuantas de esas cotizaciones son suyas (regla en `otrasPersonas`,
// lib/fusion-contactos-logica.js: se compara contra el Contacto del numero viejo y
// contra `nombres`, los de la persona en Operam y como Contacto de entrega).
//
// deps: `contactos` (lib/prospectos-store.js: buscarPorCelular, cambiarCelular,
// actualizarDatos, registrarEvento, borrar), `oportunidades`
// (lib/oportunidades-store.js: listar, crear, reasignarContacto), `cotizaciones`
// (lib/cotizaciones-store.js: listar, moverContactoCelular, setContactoCelular,
// setTelefonoCliente) y
// `ahora()`. En memoria: test/helpers/fusion-contactos-memoria.js.
// Lo que la ficha del Contacto que queda gana del que se funde es puro y vive en
// lib/fusion-contactos-logica.js (`fichaFundida`).

import * as prospectosStore from './prospectos-store.js';
import * as oportunidadesStore from './oportunidades-store.js';
import * as cotStore from './cotizaciones-store.js';
import { separarContacto } from './oportunidad-pre-io.js';
import { llaveContacto, celularesDeCruce } from './contacto-cotizacion.js';
import { fichaFundida, cotizacionesDelNumero, otrasPersonas } from './fusion-contactos-logica.js';
import { planearSeparacion } from './oportunidad-pre.js';
import { PASO_CAMBIO_DE_NUMERO } from '../public/js/cambio-numero-logica.js';

const PASO_FUSION = PASO_CAMBIO_DE_NUMERO;
const vacio = v => v === undefined || v === null || String(v).trim() === '';

function omitida(motivo, mensaje, detalle) {
  return { tipo: 'lograda', fundido: false, motivo, pasos: [{ name: PASO_FUSION, status: 'omitido', mensaje, detalle }] };
}

function resolverDeps(deps) {
  return {
    contactos: deps.contactos || prospectosStore,
    oportunidades: deps.oportunidades || oportunidadesStore,
    cotizaciones: deps.cotizaciones || cotStore,
    ahora: deps.ahora || (() => new Date()),
  };
}

const SIN_NADA_QUE_MOVER = { contactoViejo: false, oportunidades: 0, cotizaciones: 0, otrasPersonas: [], cotizacionesDeOtras: 0 };

// Lo que la pregunta del cambio de numero le dice al vendedor antes de mover nada. Las
// oportunidades son las que fundir moveria: las propias del Contacto viejo o, si su ficha
// todavia ES su Oportunidad (#343), esa una; las cotizaciones, las de su liga fija y las
// historicas que cruzaban por el numero.
export async function resumenDelCambioDeNumero({ celularViejo, nombres = [] }, deps = {}) {
  const d = resolverDeps(deps);
  const viejo10 = llaveContacto(celularViejo);
  if (!viejo10) return { ...SIN_NADA_QUE_MOVER };
  const viejo = await d.contactos.buscarPorCelular(viejo10);
  if (!viejo) return { ...SIN_NADA_QUE_MOVER };
  const cotizaciones = await d.cotizaciones.listar();
  const propias = (await d.oportunidades.listar()).filter(o => o.contactoId === viejo.id);
  const ligadas = cotizacionesDelNumero(cotizaciones, viejo10);
  const [plan] = planearSeparacion([viejo], cotizaciones, []);
  const referencias = [viejo.nombre, ...nombres];
  const deEntrega = c => c.data?.cliente?.nombreEntrega;
  return {
    contactoViejo: true,
    oportunidades: propias.length || (plan.crear ? 1 : 0),
    cotizaciones: ligadas.length,
    otrasPersonas: otrasPersonas(referencias, ligadas.map(deEntrega)),
    cotizacionesDeOtras: ligadas.filter(c => otrasPersonas(referencias, [deEntrega(c)]).length).length,
  };
}

export async function fundirContactos(solicitud, deps = {}) {
  const d = resolverDeps(deps);
  const { celularViejo, celularNuevo, personId } = solicitud;
  const viejo10 = llaveContacto(celularViejo);
  const nuevo10 = llaveContacto(celularNuevo);
  const persona = `persona ${personId}`;
  if (!viejo10 || !nuevo10) {
    return omitida('sin-numero',
      'El n\u00famero anterior o el nuevo no tiene 10 d\u00edgitos: no se movi\u00f3 nada al n\u00famero nuevo.',
      `${persona}: "${celularViejo ?? ''}" -> "${celularNuevo ?? ''}" sin llave de 10 digitos`);
  }
  if (viejo10 === nuevo10) {
    return omitida('mismo-numero', 'El n\u00famero cambi\u00f3 de formato pero es el mismo n\u00famero: no hay nada que mover.',
      `${persona}: ${viejo10} = ${nuevo10}`);
  }
  const hecho = [];
  let etapa = 'leer los Contactos';
  try {
    const viejo = await d.contactos.buscarPorCelular(viejo10);
    if (!viejo) {
      return omitida('sin-contacto-viejo',
        `El n\u00famero anterior (${celularViejo}) no era un Contacto del cotizador: no hab\u00eda nada que pasar al n\u00famero nuevo.`,
        `${persona}: ningun Contacto con ${viejo10}`);
    }
    const nuevo = await d.contactos.buscarPorCelular(nuevo10);
    const cotizaciones = await d.cotizaciones.listar();
    let queda;
    let oportunidades;
    if (!nuevo) {
      etapa = 'mudar el Contacto al numero nuevo';
      await d.contactos.cambiarCelular(viejo.id, celularNuevo);
      hecho.push(`Contacto ${viejo.id} mudado a ${nuevo10}`);
      etapa = 'mover las Oportunidades';
      oportunidades = await d.oportunidades.reasignarContacto(viejo.id, viejo.id, nuevo10);
      queda = viejo;
    } else {
      etapa = 'separar las Oportunidades';
      await separarContacto(viejo, cotizaciones, d.oportunidades);
      const delViejo = (await d.oportunidades.listar()).filter(o => o.contactoId === viejo.id);
      if (delViejo.length) await separarContacto(nuevo, cotizaciones, d.oportunidades);
      etapa = 'mover las Oportunidades';
      oportunidades = await d.oportunidades.reasignarContacto(viejo.id, nuevo.id, nuevo10);
      hecho.push(`oportunidades [${oportunidades.join(', ')}] a ${nuevo.id}`);
      etapa = 'fundir la ficha';
      await d.contactos.actualizarDatos(nuevo.id, fichaFundida(nuevo, viejo));
      hecho.push(`ficha de ${viejo.id} fundida en ${nuevo.id}`);
      queda = nuevo;
    }
    etapa = 'mover las cotizaciones';
    const movidas = await d.cotizaciones.moverContactoCelular(viejo10, nuevo10);
    for (const c of cotizaciones) {
      if (vacio(c.contactoCelular) && celularesDeCruce(c).includes(viejo10) && await d.cotizaciones.setContactoCelular(c.id, nuevo10)) {
        movidas.push(c.id);
      }
    }
    hecho.push(`cotizaciones [${movidas.join(', ')}] a ${nuevo10}`);
    etapa = 'corregir el telefono del paso Cliente';
    const telefonos = [];
    for (const c of cotizaciones) {
      if (movidas.includes(c.id) && llaveContacto(c.data?.cliente?.telefono) === viejo10 && await d.cotizaciones.setTelefonoCliente(c.id, celularNuevo)) {
        telefonos.push(c.id);
      }
    }
    hecho.push(`telefono del paso Cliente [${telefonos.join(', ')}]`);
    etapa = 'registrar la fusion';
    const forma = nuevo ? 'fundido' : 'mudado';
    await d.contactos.registrarEvento(queda.id, {
      tipo: 'fusion', fecha: d.ahora().toISOString(), vendedor: solicitud.vendedor ?? null,
      personId: String(personId), celularDe: viejo10, celularA: nuevo10, forma,
      contactoFundido: viejo.id, ...(nuevo ? { eventosFundidos: viejo.eventos || [] } : {}), fichaAnterior: viejo,
      oportunidades, cotizaciones: movidas, cotizacion: solicitud.cotizacion ?? null,
    });
    hecho.push(`evento fusion en ${queda.id}`);
    if (nuevo) {
      etapa = 'borrar el Contacto viejo';
      await d.contactos.borrar(viejo.id);
    }
    const nombre = queda.nombre || viejo.nombre || 'El Contacto';
    return {
      tipo: 'lograda', fundido: true, forma, contactoId: queda.id, contactoFundido: viejo.id, oportunidades, cotizaciones: movidas,
      pasos: [{
        name: PASO_FUSION, status: 'ok',
        mensaje: nuevo
          ? `${nombre} cambi\u00f3 de n\u00famero (${celularViejo} -> ${celularNuevo}): todo lo del ${celularViejo} pas\u00f3 al Contacto del n\u00famero nuevo, con sus oportunidades y etiquetas.`
          : `${nombre} cambi\u00f3 de n\u00famero (${celularViejo} -> ${celularNuevo}): su Contacto qued\u00f3 con el n\u00famero nuevo, con sus oportunidades y etiquetas.`,
        detalle: `${persona}: Contacto ${viejo.id} (${viejo10}) ${nuevo ? `fundido en ${queda.id}` : 'mudado'} (${nuevo10}); ` +
          `oportunidades [${oportunidades.join(', ')}], cotizaciones [${movidas.join(', ')}], telefono del paso Cliente [${telefonos.join(', ')}]`,
      }],
    };
  } catch (err) {
    const mensaje = `El n\u00famero cambi\u00f3 en Operam, pero no se pudo terminar de pasar lo del ${celularViejo} al ${celularNuevo}: av\u00edsale a un administrador.`;
    const detalle = `${persona}, ${viejo10} -> ${nuevo10}: fallo al ${etapa}: ${err?.message}; hecho: ${hecho.length ? hecho.join('; ') : 'nada'}`;
    return { tipo: 'bloqueo', motivo: 'registro', mensaje, detalle, pasos: [{ name: PASO_FUSION, status: 'warn', mensaje, detalle }] };
  }
}
