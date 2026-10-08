// Boton Volver unico (#200): la pastilla con flecha + texto que va a la
// izquierda, ANTES del titulo, en la barra de una vista y dentro de un paso.
// Modulo PURO: arma el HTML del boton de un paso; quien lo pinta conserva su
// onclick y su destino. Los 6 botones de barra nacen en index.html con las
// clases `volver volver-barra` y reciben ICONO_VOLVER al arrancar app.js.

import { ICONO_VOLVER } from './iconos.js';
import { escapeHtml } from './prospectos-logica.js';

export function botonVolverHtml({ texto, onclick }) {
  return '<button type="button" class="volver volver-paso" onclick="' + onclick + '">' +
    ICONO_VOLVER + escapeHtml(texto) + '</button>';
}
