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
  sugerirDominioCorreo, validarMayoreo, paisDelFormulario, eventoDeQuery,
} from './mayoreo-logica.js';
import {
  celCodeDelWidget, numeroDelWidget, avisoTelefonoWidget, opcionesWidget,
  cablearCapturaMx,
} from './telefono-widget.js';

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

// --- Widget internacional de celular (issue #161) ---
//
// intl-tel-input VENDOREADO (public/vendor/intl-tel-input, sin CDN -- la unica
// excepcion de la casa es Turnstile). Mexico fijo (initialCountry 'mx'), SIN
// lookup por IP (docs/research/formulario-mayoreo-captura.md 2.5: el servicio
// gratuito que sugiere la doc oficial se agoto en la primera llamada de la
// investigacion). loadUtils carga libphonenumber en diferido via import()
// nativo del navegador -- no hay paso de build, la ruta es local (2.3).
// La config es la compartida (opcionesWidget, telefono-widget.js): la misma con
// la que nacen los campos del alta interna, incluido el buscador de pais en
// espanol -- una sola config, cero copias espejo.
const inputCel = document.getElementById('f-cel');
const iti = window.intlTelInput(inputCel, opcionesWidget());
// Cableado de captura MX (issue #199): mismo helper que el alta interna monta
// via montarTelefono (telefono-widget.js) -- pegar o teclear el legacy
// "1 55 3466 7689" bajo +52 quedaba en un numero distinto y se guardaba en
// silencio porque mayoreo arma su propia instancia sin pasar por ese cableado.
cablearCapturaMx(iti, inputCel);

// celCode sigue siendo el contrato de mayoreo-logica.js (celularDeMayoreo,
// paisDelFormulario -- issue #160): MX/US/CA mapean a los prefijos de la casa y
// cualquier otro pais que el widget permita elegir cae al generico '+'
// (CODIGOS_PAIS lo amplio para esto, #161). No se traduce a mano el numero:
// intl-tel-input entrega el E.164 completo con getNumber(), y
// combinarTelefonoConCodigo (alta-logica.js) ya sabe respetarlo tal cual cuando
// el numero llega con '+'. Los dos helpers viven en telefono-widget.js desde
// #176: el alta interna monta cinco instancias del mismo widget y necesitaba la
// misma traduccion -- un modulo, varios consumidores.

// Turnstile (issue #162): el widget de Cloudflare (challenges.cloudflare.com/
// turnstile/v0/api.js, cargado por server.js SOLO si hay TURNSTILE_SITE_KEY --
// ver GET /mayoreo) se renderiza de forma implicita a partir del div
// data-sitekey del HTML e inserta el a su vez un input oculto
// name="cf-turnstile-response" DENTRO del <form>. No hace falta llamar a la API
// de turnstile.getResponse(): basta leer ese input al enviar. Si el widget no
// se pinto (dev, sin sitekey) el input no existe y viaja vacio -- el servidor
// ya sabe omitir la verificacion sin llave (lib/turnstile.js).
function turnstileToken() {
  const campo = form.querySelector('[name="cf-turnstile-response"]');
  return campo ? campo.value : '';
}

// QR del stand (issue #264): la liga impresa es /mayoreo?evento=<nombre>. El
// parametro viaja tal cual al servidor, que decide si coincide con el evento
// activo -- este formulario no sabe ni le importa cual es el evento activo.
const eventoDeLaLiga = eventoDeQuery(location.search);

function leerFormulario() {
  return {
    evento: eventoDeLaLiga,
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
    celCode: celCodeDelWidget(iti),
    cel: numeroDelWidget(iti, val('f-cel')),
    correo: val('f-correo'),
    web: val('f-web'),
    promos: document.getElementById('f-promos').checked,
    fax: val('f-fax'),
    turnstileToken: turnstileToken(),
  };
}

// Validacion del celular con el propio widget: mas precisa que el chequeo de
// largo de validarMayoreo (mayoreo-logica.js), que a proposito es laxo para no
// rechazar un lead legitimo. Vacio no es su responsabilidad -- eso ya lo
// marca validarMayoreo como obligatorio. La tabla de mensajes vive en
// telefono-widget.js desde #176 (una sola vez, la comparten los dos formularios).
function validarCelularWidget() {
  return avisoTelefonoWidget(iti, val('f-cel'));
}

inputCel.addEventListener('blur', async () => {
  marcar('cel', await validarCelularWidget());
});

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
// countrychange (no 'change' -- ya no hay <select>): intl-tel-input lo dispara
// en el input original cada vez que el prospecto elige otra bandera.
inputCel.addEventListener('countrychange', resolverCiudadPorCP);

form.addEventListener('submit', async e => {
  e.preventDefault();
  limpiarErrores();
  const datos = leerFormulario();
  const errores = validarMayoreo(datos);
  // El widget valida mas fino que el chequeo de largo de arriba (issue #161);
  // si ese ya marco 'cel' no lo pisamos con un segundo mensaje.
  if (!errores.some(er => er.campo === 'cel')) {
    const celMsg = await validarCelularWidget();
    if (celMsg) errores.push({ campo: 'cel', mensaje: celMsg });
  }
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

// Auto-alto para el embed en Shopify (issue #164): cuando la pagina vive dentro
// de un iframe cross-origin, el padre no puede medirla -- se le avisa la altura
// por postMessage cada vez que cambia (errores inline, campo "otro", pantalla de
// exito). El mensaje solo lleva la altura (nada sensible), por eso el target '*';
// el listener del lado de Shopify filtra por el origen del iframe.
if (window.parent !== window) {
  let ultimaAltura = 0;
  const avisarAltura = () => {
    const alto = document.documentElement.scrollHeight;
    if (alto !== ultimaAltura) {
      ultimaAltura = alto;
      window.parent.postMessage({ mayoreoAlto: alto }, '*');
    }
  };
  new ResizeObserver(avisarAltura).observe(document.body);
  window.addEventListener('load', avisarAltura);
  avisarAltura();
}
