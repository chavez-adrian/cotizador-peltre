// Boton Volver unico (#200): la pastilla con flecha + texto que va a la
// izquierda, ANTES del titulo, en la barra de una vista y dentro de un paso.
// Modulo PURO: arma el HTML; quien lo pinta conserva su onclick y su destino.
// Los 6 botones estaticos de index.html llevan las mismas clases y reciben
// ICONO_VOLVER al arrancar app.js.

import { ICONO_VOLVER } from './iconos.js';
import { escapeHtml } from './prospectos-logica.js';

export function botonVolverHtml({ texto, onclick, superficie = 'paso' }) {
  return '<button type="button" class="volver volver-' + superficie + '" onclick="' + onclick + '">' +
    ICONO_VOLVER + escapeHtml(texto) + '</button>';
}
