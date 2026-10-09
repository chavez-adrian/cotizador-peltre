// EL modulo Fusion de Contactos (#565, enmienda 2026-10-09 a ADR-0016, GLOSSARY.md
// "Contacto"). Reglas de modulo de dominio en CODING_STANDARDS.md.
//
// La identidad del Contacto ES su celular (ultimos 10 digitos), asi que cambiar de
// numero es otro Contacto. La excepcion: cuando el vendedor cambia desde el cotizador
// el Cel de un Contacto en Operam, el person_id (que no cambia al editarlo) dice que es
// la misma persona, y el Contacto del numero viejo se funde solo en el del nuevo con su
// historial, sus Oportunidades y sus etiquetas. Lo dispara la Subida del quote cuando
// el modulo Contactos en Operam CONFIRMA (relectura) el cambio del Cel; un numero nuevo
// sin person_id detras nunca llega aqui y se sigue fundiendo a mano.
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
// deps: `contactos` (lib/prospectos-store.js: buscarPorCelular, cambiarCelular,
// actualizarDatos, registrarEvento, borrar), `oportunidades`
// (lib/oportunidades-store.js: listar, crear, reasignarContacto), `cotizaciones`
// (lib/cotizaciones-store.js: listar, moverContactoCelular, setContactoCelular) y
// `ahora()`. En memoria: test/helpers/fusion-contactos-memoria.js.

import * as prospectosStore from './prospectos-store.js';
import * as oportunidadesStore from './oportunidades-store.js';
import * as cotStore from './cotizaciones-store.js';
import { separarContacto } from './oportunidad-pre-io.js';
import { llaveContacto, celularesDeCruce, esContactoSinCaptura } from './contacto-cotizacion.js';
import { ligasDeContacto, parcheDeLiga } from './ligas-contacto.js';

const PASO_FUSION = 'fusion de Contactos';
const vacio = v => v === undefined || v === null || String(v).trim() === '';
// Lo que la ficha fundida no copia campo por campo: las ligas se unen, la marca de
// captura se decide aparte y las notas se juntan.
const DATA_APARTE = new Set(['cliente_id', 'clientes_operam', 'sinCaptura', 'notas']);

// Nucleo PURO: lo que la ficha del Contacto que queda gana del que se funde.
export function fichaFundida(queda, sefunde) {
  const campos = {};
  for (const k of ['nombre', 'ciudad', 'canal', 'vendedor']) {
    if (vacio(queda[k]) && !vacio(sefunde[k])) campos[k] = sefunde[k];
  }
  const d = queda.data || {};
  const v = sefunde.data || {};
  const data = {};
  for (const [k, valor] of Object.entries(v)) {
    if (!DATA_APARTE.has(k) && vacio(d[k]) && !vacio(valor)) data[k] = valor;
  }
  let ligas = d;
  for (const liga of ligasDeContacto(v)) ligas = parcheDeLiga(ligas, liga.cliente_id, liga.fuente);
  if (ligas !== d) Object.assign(data, ligas);
  if (esContactoSinCaptura(queda) && !esContactoSinCaptura(sefunde)) data.sinCaptura = false;
  if (!vacio(v.notas)) {
    if (vacio(d.notas)) data.notas = v.notas;
    else if (!String(d.notas).includes(v.notas)) data.notas = `${d.notas}\n${v.notas}`;
  }
  return { ...campos, data };
}

function omitida(motivo, mensaje, detalle) {
  return { tipo: 'lograda', fundido: false, motivo, pasos: [{ name: PASO_FUSION, status: 'omitido', mensaje, detalle }] };
}

export async function fundirContactos(solicitud, deps = {}) {
  const d = {
    contactos: deps.contactos || prospectosStore,
    oportunidades: deps.oportunidades || oportunidadesStore,
    cotizaciones: deps.cotizaciones || cotStore,
    ahora: deps.ahora || (() => new Date()),
  };
  const { celularViejo, celularNuevo, personId } = solicitud;
  const viejo10 = llaveContacto(celularViejo);
  const nuevo10 = llaveContacto(celularNuevo);
  const persona = `persona ${personId}`;
  if (!viejo10 || !nuevo10) {
    return omitida('sin-numero',
      'El n\u00famero anterior o el nuevo no tiene 10 d\u00edgitos: los Contactos no se fundieron.',
      `${persona}: "${celularViejo ?? ''}" -> "${celularNuevo ?? ''}" sin llave de 10 digitos`);
  }
  if (viejo10 === nuevo10) {
    return omitida('mismo-numero', 'El Cel cambi\u00f3 de formato pero es el mismo n\u00famero: no hay Contactos que fundir.',
      `${persona}: ${viejo10} = ${nuevo10}`);
  }
  const hecho = [];
  let etapa = 'leer los Contactos';
  try {
    const viejo = await d.contactos.buscarPorCelular(viejo10);
    if (!viejo) {
      return omitida('sin-contacto-viejo',
        `El n\u00famero anterior (${celularViejo}) no era un Contacto del cotizador: no hay nada que fundir.`,
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
    etapa = 'registrar la fusion';
    const forma = nuevo ? 'fundido' : 'mudado';
    await d.contactos.registrarEvento(queda.id, {
      tipo: 'fusion', fecha: d.ahora().toISOString(), vendedor: solicitud.vendedor ?? null,
      personId: String(personId), celularDe: viejo10, celularA: nuevo10, forma,
      contactoFundido: viejo.id, ...(nuevo ? { eventosFundidos: viejo.eventos || [] } : {}),
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
          ? `${nombre} cambi\u00f3 de n\u00famero (${celularViejo} -> ${celularNuevo}): su Contacto anterior se fundi\u00f3 en el del n\u00famero nuevo, con sus oportunidades y etiquetas.`
          : `${nombre} cambi\u00f3 de n\u00famero (${celularViejo} -> ${celularNuevo}): su Contacto qued\u00f3 con el n\u00famero nuevo, con sus oportunidades y etiquetas.`,
        detalle: `${persona}: Contacto ${viejo.id} (${viejo10}) ${nuevo ? `fundido en ${queda.id}` : 'mudado'} (${nuevo10}); ` +
          `oportunidades [${oportunidades.join(', ')}], cotizaciones [${movidas.join(', ')}]`,
      }],
    };
  } catch (err) {
    const mensaje = `El Cel cambi\u00f3 en Operam, pero no se pudo terminar de fundir el Contacto del ${celularViejo} en el del ${celularNuevo}: av\u00edsale a un administrador.`;
    const detalle = `${persona}, ${viejo10} -> ${nuevo10}: fallo al ${etapa}: ${err?.message}; hecho: ${hecho.length ? hecho.join('; ') : 'nada'}`;
    return { tipo: 'bloqueo', motivo: 'registro', mensaje, detalle, pasos: [{ name: PASO_FUSION, status: 'warn', mensaje, detalle }] };
  }
}
