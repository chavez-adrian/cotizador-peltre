// Formulario publico de captacion de mayoreo (issue #157, ADR-0012). Solo pega
// el DOM con mayoreo-logica.js: los catalogos, la validacion y el armado del
// payload viven ALLA (un modulo, varios consumidores) para que el servidor
// valide exactamente lo mismo que el navegador.
//
// Nota sobre la trampa #112 (onclick inline resuelve contra window): esta pagina
// no usa NI UN onclick inline -- todos los manejadores se enganchan con
// addEventListener sobre los elementos, asi que no hay simbolo que exponer a
// window ni forma de que un handler quede muerto en silencio.

import {
  TIPOS_PROYECTO, CANTIDADES, CUANDO_OPCIONES,
  sugerirDominioCorreo, validarMayoreo, paisDelFormulario,
} from './mayoreo-logica.js';

const form = document.getElementById('form-mayoreo');
const exito = document.getElementById('exito');
const btnEnviar = document.getElementById('btn-enviar');
const errorEnvio = document.getElementById('error-envio');
const campoOtro = form.querySelector('[data-campo="otro"]');
const sugCorreo = document.getElementById('sug-correo');
const sugCorreoTexto = document.getElementById('sug-correo-texto');

const val = id => (document.getElementById(id).value || '').trim();
const grupo = campo => form.querySelector(`[data-campo="${campo}"]`);

function textoOpcion(v) {
  const t = document.createElement('option');
  t.textContent = v;
  return t;
}

// Los catalogos cerrados se pintan desde el modulo compartido: si manana cambia
// una opcion, cambia en un solo lugar y el servidor la valida igual.
for (const tipo of TIPOS_PROYECTO) document.getElementById('f-tipo').appendChild(textoOpcion(tipo));

function pintarChips(contenedor, nombre, valores, etiqueta) {
  for (const [i, v] of valores.entries()) {
    const id = `${nombre}-${i}`;
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = nombre;
    input.id = id;
    input.value = v;
    const label = document.createElement('label');
    label.htmlFor = id;
    label.textContent = etiqueta ? etiqueta(v) : v;
    contenedor.append(input, label);
  }
}
pintarChips(document.getElementById('chips-cant'), 'cant', CANTIDADES, v => `${v} piezas`);
pintarChips(document.getElementById('chips-cuando'), 'cuando', CUANDO_OPCIONES);

function chipElegido(nombre) {
  const marcado = form.querySelector(`input[name="${nombre}"]:checked`);
  return marcado ? marcado.value : '';
}

function leerFormulario() {
  return {
    tipo: val('f-tipo'),
    otro: val('f-otro'),
    empresa: val('f-empresa'),
    cant: chipElegido('cant'),
    cp: val('f-cp'),
    ciudad: val('f-ciudad'),
    cuando: chipElegido('cuando'),
    nombre: val('f-nombre'),
    apellido: val('f-apellido'),
    cargo: val('f-cargo'),
    celCode: val('f-pais'),
    cel: val('f-cel'),
    correo: val('f-correo'),
    web: val('f-web'),
    promos: document.getElementById('f-promos').checked,
    fax: val('f-fax'),
  };
}

function marcar(campo, mensaje) {
  const g = grupo(campo);
  if (!g) return;
  const aviso = g.querySelector('[data-mal]');
  if (mensaje) {
    g.classList.add('mal');
    if (aviso) aviso.textContent = mensaje;
  } else {
    g.classList.remove('mal');
  }
}

function limpiarErrores() {
  for (const g of form.querySelectorAll('.campo.mal')) g.classList.remove('mal');
  errorEnvio.classList.remove('ver');
}

// El campo "Cual?" solo existe cuando el tipo es Otro; al ocultarlo se vacia para
// que no viaje texto de una opcion que el prospecto ya descarto.
function sincronizarOtro() {
  const esOtro = document.getElementById('f-tipo').value === 'Otro';
  campoOtro.hidden = !esOtro;
  if (!esOtro) {
    document.getElementById('f-otro').value = '';
    marcar('otro', null);
  }
}

document.getElementById('f-tipo').addEventListener('change', () => {
  sincronizarOtro();
  marcar('tipo', null);
});

// Corregir un error mientras se escribe apaga su aviso: dejar el campo en rojo
// despues de arreglarlo es ruido.
form.addEventListener('input', e => {
  const g = e.target.closest('[data-campo]');
  if (g) g.classList.remove('mal');
});
form.addEventListener('change', e => {
  if (e.target.name === 'cant') marcar('cant', null);
  if (e.target.name === 'cuando') marcar('cuando', null);
});

let dominioSugerido = '';
document.getElementById('f-correo').addEventListener('blur', () => {
  const correo = val('f-correo');
  const dominio = sugerirDominioCorreo(correo);
  if (!dominio) {
    sugCorreo.classList.remove('ver');
    return;
  }
  dominioSugerido = `${correo.slice(0, correo.indexOf('@') + 1)}${dominio}`;
  sugCorreoTexto.textContent = `¿Quisiste decir ${dominio}?`;
  sugCorreo.classList.add('ver');
});

document.getElementById('btn-corregir-correo').addEventListener('click', () => {
  if (dominioSugerido) document.getElementById('f-correo').value = dominioSugerido;
  sugCorreo.classList.remove('ver');
  marcar('correo', null);
});

// --- Autoconfirmacion de ciudad por CP (issue #160, ADR-0012 pto. 3) ---
//
// El campo "Ciudad" de #157 deja de estar siempre visible: por default queda
// OCULTO y solo reaparece como respaldo si el CP no resuelve (formato invalido,
// CP fuera del indice, o falla la llamada). Cuando resuelve, el chip confirma
// "Ciudad, Estado" y el input oculto de #f-ciudad se llena por detras -- asi
// validarMayoreo/buildCapturaMayoreo (mayoreo-logica.js) no cambian: siguen
// leyendo un simple string en f.ciudad, venga de la resolucion automatica o de
// lo que el prospecto tecleo a mano.
const campoCp = document.getElementById('f-cp');
const campoCiudadInput = document.getElementById('f-ciudad');
const grupoCiudad = grupo('ciudad');
const chipCp = document.getElementById('chip-cp');

// Longitud minima antes de intentar resolver: 5 digitos en MX/US. En CA son 6
// (el codigo COMPLETO, sin contar el espacio): lib/validar-cp.js -- el mismo
// validador que el GET publico reusa -- exige el patron completo de 6
// caracteres antes de aceptar el formato, aunque el indice solo guarde el FSA
// de 3 (normalizarCp lo recorta despues de pasar la validacion). Disparar a los
// 3 caracteres serviria un 400 en cada tecla intermedia sin resolver nunca.
function longitudMinimaCP(pais) {
  return pais === 'CA' ? 6 : 5;
}

function mostrarFallbackCiudad() {
  chipCp.hidden = true;
  grupoCiudad.hidden = false;
}

async function resolverCiudadPorCP() {
  const cpTecleado = val('f-cp');
  const pais = paisDelFormulario(leerFormulario());
  if (cpTecleado.replace(/\s+/g, '').length < longitudMinimaCP(pais)) {
    mostrarFallbackCiudad();
    return;
  }
  try {
    const res = await fetch(`/api/cp/${pais}/${encodeURIComponent(cpTecleado)}`);
    if (!res.ok) { mostrarFallbackCiudad(); return; }
    const { ciudad, estado } = await res.json();
    campoCiudadInput.value = ciudad;
    chipCp.textContent = `✓ ${ciudad}, ${estado}`;
    chipCp.hidden = false;
    grupoCiudad.hidden = true;
    marcar('ciudad', null);
  } catch (err) {
    console.error('[mayoreo] no se pudo resolver el CP:', err.message);
    mostrarFallbackCiudad();
  }
}

campoCp.addEventListener('input', resolverCiudadPorCP);
campoCp.addEventListener('blur', resolverCiudadPorCP);
document.getElementById('f-pais').addEventListener('change', resolverCiudadPorCP);

form.addEventListener('submit', async e => {
  e.preventDefault();
  limpiarErrores();
  const datos = leerFormulario();
  const errores = validarMayoreo(datos);
  if (errores.length) {
    for (const { campo, mensaje } of errores) marcar(campo, mensaje);
    const primero = grupo(errores[0].campo);
    if (primero) primero.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return;
  }

  btnEnviar.disabled = true;
  try {
    const res = await fetch('/api/prospectos/publico', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(datos),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    form.style.display = 'none';
    exito.classList.add('ver');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    // La respuesta del servidor es opaca a proposito (ADR-0012): lo unico que
    // puede fallar aqui es el envio mismo, y eso si se dice.
    console.error('[mayoreo] no se pudo enviar:', err.message);
    errorEnvio.textContent = 'No pudimos enviar tus datos. Revisa tu conexión e inténtalo de nuevo.';
    errorEnvio.classList.add('ver');
    btnEnviar.disabled = false;
  }
});

sincronizarOtro();
