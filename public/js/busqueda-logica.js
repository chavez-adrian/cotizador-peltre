// Nucleo puro del buscador en vivo de las listas (#289): caja de texto +
// rango de fechas Desde/Hasta, el control que el Historial estrena en #146/#148
// y que ahora comparten Prospectos, Rescatados, Pipeline y Hoy.
//
// Una sola implementacion para las cinco vistas: cada una declara QUE campos
// son buscables y de donde sale su fecha (`camposDe` / `digitosDe` / `fechaDe`
// o `diaDe`), y este modulo pone la normalizacion de texto, el match por
// digitos y la comparacion del rango. Sin efectos de navegador: lo importan
// app.js (ESM nativo) y los tests .cjs via import() dinamico.

import { normalizarBusqueda } from './alta-logica.js';

// Solo digitos, sin recortar a 10 (a diferencia de ultimos10 de
// lib/telefono-llave.js): aqui se busca una subcadena parcial del celular, no
// se calcula la llave de identidad.
function soloDigitos(valor) {
  if (valor == null) return '';
  return String(valor).replace(/\D/g, '');
}

// El dia LOCAL de un instante. El input nativo de fecha entrega yyyy-mm-dd, un
// dia calendario sin zona horaria. A diferencia de los scripts de backend que
// comparan contra el dia UTC (backfill-operam.mjs, sync-operam-io.js), aqui el
// dia se calcula en hora LOCAL: este nucleo solo corre en el navegador (nunca
// en server.js) y las tarjetas que usan este camino pintan la fecha con
// toLocaleDateString. Usar UTC desincroniza el filtro de lo que el vendedor ve
// en pantalla -- una cotizacion guardada como '2026-08-13' (medianoche UTC) se
// pinta "12 ago" en Mexico_City, y filtrando "Desde 13" no debe aparecer.
function diaLocal(fecha) {
  if (!fecha) return '';
  const d = new Date(fecha);
  const anio = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${anio}-${mes}-${dia}`;
}

// "Desde" y "Hasta" son independientes: solo uno acota por ese lado (#148).
function enRangoDia(dia, desde, hasta) {
  if (!desde && !hasta) return true;
  if (!dia) return false;
  if (desde && dia < desde) return false;
  if (hasta && dia > hasta) return false;
  return true;
}

function comoLista(valor) {
  if (valor == null) return [];
  return Array.isArray(valor) ? valor : [valor];
}

// Con que dia calendario compara el rango este listado. Las vistas cuya tarjeta
// convierte la fecha a hora local declaran `fechaDe` (un instante); las que
// pintan el dia tal cual viene, sin pasar por Date -- Rescatados, cuya fecha es
// la del quote en Operam (bandeja-logica.fmtFecha) -- declaran `diaDe`, y ese
// dia se compara literal. La diferencia importa: en un huso negativo las dos
// convenciones caen en dias distintos, y el filtro tiene que coincidir con lo
// que dice la tarjeta.
function diaDelItem(item, { fechaDe, diaDe }) {
  if (diaDe) return diaDe(item);
  return fechaDe ? diaLocal(fechaDe(item)) : '';
}

// El criterio de las cinco vistas: `{ texto, desde, hasta }`, combinados con
// AND. `camposDe` da los campos de texto del item (los ausentes no estorban) y
// `digitosDe` los telefonos que se comparan por digitos. Devuelve siempre un
// arreglo nuevo: ninguna vista muta su listado en memoria al filtrar.
export function filtrarPorCriterio(items, criterio, opciones = {}) {
  const { camposDe, digitosDe } = opciones;
  const lista = items || [];
  const texto = normalizarBusqueda(criterio?.texto);
  const desde = criterio?.desde || '';
  const hasta = criterio?.hasta || '';
  if (!texto && !desde && !hasta) return lista.slice();
  const digitos = soloDigitos(criterio?.texto);
  return lista.filter(item => {
    if (texto) {
      const enCampos = comoLista(camposDe ? camposDe(item) : null)
        .some(campo => normalizarBusqueda(campo).includes(texto));
      const enDigitos = !!digitos && comoLista(digitosDe ? digitosDe(item) : null)
        .some(tel => soloDigitos(tel).includes(digitos));
      if (!enCampos && !enDigitos) return false;
    }
    return enRangoDia(diaDelItem(item, opciones), desde, hasta);
  });
}
