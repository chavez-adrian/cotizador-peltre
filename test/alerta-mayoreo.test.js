import { test } from 'node:test';
import assert from 'node:assert/strict';

import { destinatariosAlertaMayoreo, mensajeAlertaMayoreo, vcardDeProspecto, nombreArchivoVCard } from '../lib/alerta-mayoreo.js';

// Nucleo puro de la alerta por correo de captura publica de mayoreo (issue #163,
// ADR-0012; CONTEXT.md "Captura publica": "Cada captura publica avisa por correo a
// quienes tienen el permiso de asignacion"). Sin red, sin IO -- solo el armado de
// destinatarios y del mensaje. Mismo patron que test/sync-operam.test.js.

test('destinatariosAlertaMayoreo: incluye vendedores con permiso de asignacion y admins con correo', () => {
  const vendedores = [
    { id: 1, name: 'Admin Uno', role: 'admin', email: 'admin@pppeltre.mx' },
    { id: 2, name: 'Vendedor Con Permiso', role: 'vendedor', puedeAsignar: true, email: 'conpermiso@pppeltre.mx' },
    { id: 3, name: 'Vendedor Sin Permiso', role: 'vendedor', email: 'sinpermiso@pppeltre.mx' },
  ];
  const destinatarios = destinatariosAlertaMayoreo(vendedores);
  assert.deepEqual(destinatarios.sort(), ['admin@pppeltre.mx', 'conpermiso@pppeltre.mx']);
});

test('destinatariosAlertaMayoreo: deduplica el mismo correo (case-insensitive), un admin que ademas tiene el permiso', () => {
  const vendedores = [
    { id: 1, name: 'Admin y Asigna', role: 'admin', email: 'Admin@pppeltre.mx' },
    { id: 2, name: 'Admin y Asigna Otra Vez', role: 'admin', email: 'admin@PPPELTRE.MX' },
  ];
  const destinatarios = destinatariosAlertaMayoreo(vendedores);
  assert.deepEqual(destinatarios, ['Admin@pppeltre.mx']);
});

test('destinatariosAlertaMayoreo: sin destinatarios validos devuelve arreglo vacio', () => {
  const vendedores = [
    { id: 1, name: 'Vendedor Sin Permiso', role: 'vendedor', email: 'sinpermiso@pppeltre.mx' },
    { id: 2, name: 'Vendedor Con Permiso Sin Correo', role: 'vendedor', puedeAsignar: true },
  ];
  assert.deepEqual(destinatariosAlertaMayoreo(vendedores), []);
});

test('destinatariosAlertaMayoreo: sin admin con correo, cae al fallback ALERTA_ADMIN_EMAIL', () => {
  const vendedores = [
    { id: 1, name: 'Admin Sin Correo', role: 'admin' },
    { id: 2, name: 'Vendedor Con Permiso', role: 'vendedor', puedeAsignar: true, email: 'conpermiso@pppeltre.mx' },
  ];
  const destinatarios = destinatariosAlertaMayoreo(vendedores, { adminEmailFallback: 'fallback@pppeltre.mx' });
  assert.deepEqual(destinatarios.sort(), ['conpermiso@pppeltre.mx', 'fallback@pppeltre.mx']);
});

// --- mensajeAlertaMayoreo: asunto y cuerpo con los datos del prospecto ---

test('mensajeAlertaMayoreo: arma asunto y cuerpo con nombre, celular, ciudad, tipo de proyecto y cantidad', () => {
  const vendedores = [
    { id: 1, name: 'Vendedor Con Permiso', role: 'vendedor', puedeAsignar: true, email: 'conpermiso@pppeltre.mx' },
  ];
  const prospecto = {
    nombre: 'Juan Perez', celular: '+525512345678', ciudad: 'Ixtapaluca',
    tipoProyecto: 'Restaurantes', cantidadEstimada: '+350',
  };
  const mensaje = mensajeAlertaMayoreo(prospecto, vendedores);
  assert.deepEqual(mensaje.to, ['conpermiso@pppeltre.mx']);
  assert.equal(mensaje.subject, 'Nuevo prospecto de mayoreo');
  assert.match(mensaje.text, /Juan Perez/);
  assert.match(mensaje.text, /\+525512345678/);
  assert.match(mensaje.text, /Ixtapaluca/);
  assert.match(mensaje.text, /Restaurantes/);
  assert.match(mensaje.text, /\+350/);
});

test('mensajeAlertaMayoreo: sin destinatarios validos devuelve null (no arma mensaje)', () => {
  const vendedores = [{ id: 1, name: 'Vendedor Sin Permiso', role: 'vendedor' }];
  const prospecto = { nombre: 'Juan Perez', celular: '+525512345678', ciudad: 'Ixtapaluca' };
  assert.equal(mensajeAlertaMayoreo(prospecto, vendedores), null);
});

// --- #165: informacion completa, celular con link de WhatsApp, vCard adjunta ---

const VENDEDORES_165 = [
  { id: 1, name: 'Vendedor Con Permiso', role: 'vendedor', puedeAsignar: true, email: 'conpermiso@pppeltre.mx' },
];

const PROSPECTO_COMPLETO = {
  nombre: 'Juan Perez', celular: '+525512345678', ciudad: 'Ixtapaluca', cp: '56530',
  tipoProyecto: 'Otro', tipoProyectoOtro: 'Panaderia', cantidadEstimada: '+350',
  empresa: 'Hotel Azul', cargo: 'Compras', correo: 'juan@hotelazul.mx',
  cuando: 'En los próximos 3 meses', web: '@hotelazul',
  promos: { acepta: true, fecha: '2026-08-17T10:00:00.000Z' },
};

const FRAGMENTOS_PROSPECTO_COMPLETO = [
  'Juan Perez', '+525512345678', 'Ixtapaluca', 'CP 56530',
  'Otro (Panaderia)', '+350', 'Hotel Azul', 'Compras', 'juan@hotelazul.mx',
  'En los próximos 3 meses', '@hotelazul', '2026-08-17T10:00:00.000Z',
];

test('mensajeAlertaMayoreo: el texto plano trae TODOS los campos capturados', () => {
  const mensaje = mensajeAlertaMayoreo(PROSPECTO_COMPLETO, VENDEDORES_165);
  for (const fragmento of FRAGMENTOS_PROSPECTO_COMPLETO) {
    assert.ok(mensaje.text.includes(fragmento), `texto sin "${fragmento}"`);
  }
});

test('mensajeAlertaMayoreo: el html trae los mismos campos que el texto plano (fallback equivalente)', () => {
  const mensaje = mensajeAlertaMayoreo(PROSPECTO_COMPLETO, VENDEDORES_165);
  for (const fragmento of FRAGMENTOS_PROSPECTO_COMPLETO) {
    assert.ok(mensaje.html.includes(fragmento), `html sin "${fragmento}"`);
  }
});

test('mensajeAlertaMayoreo: los campos opcionales vacios NO se imprimen', () => {
  const prospecto = {
    nombre: 'Juan Perez', celular: '+525512345678', ciudad: 'Ixtapaluca',
    tipoProyecto: 'Restaurantes', cantidadEstimada: '+350',
  };
  const mensaje = mensajeAlertaMayoreo(prospecto, VENDEDORES_165);
  for (const etiqueta of ['Empresa', 'Cargo', 'Correo', 'Para cuando', 'Sitio web', 'Promociones', 'CP ']) {
    assert.ok(!mensaje.text.includes(etiqueta), `no debia imprimir "${etiqueta}"`);
  }
});

test('mensajeAlertaMayoreo: promos solo se imprime cuando acepto (con fecha); si no acepto, se omite', () => {
  const base = { nombre: 'Juan Perez', celular: '+525512345678', ciudad: 'Ixtapaluca', tipoProyecto: 'Restaurantes', cantidadEstimada: '+350' };
  const rechazo = mensajeAlertaMayoreo({ ...base, promos: { acepta: false } }, VENDEDORES_165);
  assert.ok(!rechazo.text.includes('Promociones'));
  const aceptado = mensajeAlertaMayoreo({ ...base, promos: { acepta: true, fecha: '2026-08-17' } }, VENDEDORES_165);
  assert.match(aceptado.text, /Promociones: Si \(2026-08-17\)/);
});

test('mensajeAlertaMayoreo: el html envuelve el celular en un link de wa.me (un clic abre WhatsApp)', () => {
  const mensaje = mensajeAlertaMayoreo(PROSPECTO_COMPLETO, VENDEDORES_165);
  assert.match(mensaje.html, /<a href="https:\/\/wa\.me\/525512345678">\+525512345678<\/a>/);
});

test('mensajeAlertaMayoreo: wa.me correcto tambien para un celular no-MX', () => {
  const prospecto = { ...PROSPECTO_COMPLETO, celular: '+1 (555) 123-4567' };
  const mensaje = mensajeAlertaMayoreo(prospecto, VENDEDORES_165);
  assert.match(mensaje.html, /https:\/\/wa\.me\/15551234567/);
});

test('mensajeAlertaMayoreo: el html escapa datos de usuario (sin XSS via nombre/empresa)', () => {
  const prospecto = { ...PROSPECTO_COMPLETO, nombre: '<script>alert(1)</script>' };
  const mensaje = mensajeAlertaMayoreo(prospecto, VENDEDORES_165);
  assert.ok(!mensaje.html.includes('<script>alert(1)</script>'));
  assert.ok(mensaje.html.includes('&lt;script&gt;'));
});

test('vcardDeProspecto: arma un vcf valido con FN, TEL, EMAIL y ORG', () => {
  const vcf = vcardDeProspecto(PROSPECTO_COMPLETO);
  assert.match(vcf, /^BEGIN:VCARD/);
  assert.match(vcf, /END:VCARD$/);
  assert.match(vcf, /FN:Juan Perez/);
  assert.match(vcf, /TEL;TYPE=CELL:\+525512345678/);
  assert.match(vcf, /EMAIL:juan@hotelazul\.mx/);
  assert.match(vcf, /ORG:Hotel Azul/);
});

test('vcardDeProspecto: sin correo ni empresa, omite EMAIL y ORG pero sigue siendo un vcf valido', () => {
  const vcf = vcardDeProspecto({ nombre: 'Juan Perez', celular: '+525512345678' });
  assert.match(vcf, /BEGIN:VCARD/);
  assert.match(vcf, /FN:Juan Perez/);
  assert.match(vcf, /TEL;TYPE=CELL:\+525512345678/);
  assert.ok(!vcf.includes('EMAIL:'));
  assert.ok(!vcf.includes('ORG:'));
  assert.match(vcf, /END:VCARD/);
});

// --- #236: N: (nombre estructurado), lo que arregla el contacto en iPhone ---

test('#236: vcardDeProspecto emite N: con el apellido primero y el nombre de pila despues', () => {
  const vcf = vcardDeProspecto({ ...PROSPECTO_COMPLETO, nombrePila: 'Juan', apellido: 'Perez' });
  assert.ok(vcf.split('\r\n').includes('N:Perez;Juan;;;'), `vcf sin N: correcta:\n${vcf}`);
  // El bug de #234 era que ORG: se volvia el nombre del contacto: FN y ORG
  // siguen igual, lo que cambia es que ya hay N: que las desambigua.
  assert.match(vcf, /FN:Juan Perez/);
  assert.match(vcf, /ORG:Hotel Azul/);
});

test('#236: sin los campos separados, N: cae al nombre completo en el componente de nombre de pila', () => {
  const vcf = vcardDeProspecto({ nombre: 'Juan Perez', celular: '+525512345678' });
  assert.ok(vcf.split('\r\n').includes('N:;Juan Perez;;;'), `vcf sin N: de respaldo:\n${vcf}`);
});

test('#236: la vCard se mantiene en VERSION:3.0 (la que digiere Contactos de Apple)', () => {
  const vcf = vcardDeProspecto({ nombre: 'Juan Perez', nombrePila: 'Juan', apellido: 'Perez', celular: '+525512345678' });
  assert.ok(vcf.split('\r\n').includes('VERSION:3.0'));
});

test('#236: los componentes de N: escapan los reservados de vCard sin romper la estructura', () => {
  const vcf = vcardDeProspecto({
    nombre: 'Ana; de la O Perez, Jr.\\', nombrePila: 'Ana; de la O', apellido: 'Perez, Jr.\\',
    celular: '+525512345678',
  });
  const linea = vcf.split('\r\n').find(l => l.startsWith('N:'));
  assert.equal(linea, 'N:Perez\\, Jr.\\\\;Ana\\; de la O;;;');
});

test('#236: el caso minimo (nombre, apellido y celular) sale como vcf valido con N:', () => {
  const vcf = vcardDeProspecto({ nombre: 'Laura Mendoza', nombrePila: 'Laura', apellido: 'Mendoza', celular: '+525512345678' });
  assert.deepEqual(vcf.split('\r\n'), [
    'BEGIN:VCARD',
    'VERSION:3.0',
    'N:Mendoza;Laura;;;',
    'FN:Laura Mendoza',
    'TEL;TYPE=CELL:+525512345678',
    'END:VCARD',
  ]);
});

// --- #237: TITLE: (cargo) y URL: (sitio web/redes) en la vCard ---

test('#237: vcardDeProspecto emite TITLE: con el cargo y URL: con el sitio web cuando ambos vienen', () => {
  const vcf = vcardDeProspecto(PROSPECTO_COMPLETO);
  assert.match(vcf, /TITLE:Compras/);
  assert.match(vcf, /URL:@hotelazul/);
});

test('#237: sin cargo, TITLE: se omite por completo', () => {
  const vcf = vcardDeProspecto({ ...PROSPECTO_COMPLETO, cargo: undefined });
  assert.ok(!vcf.includes('TITLE:'));
});

test('#237: sin sitio web, URL: se omite por completo', () => {
  const vcf = vcardDeProspecto({ ...PROSPECTO_COMPLETO, web: undefined });
  assert.ok(!vcf.includes('URL:'));
});

test('#237: TITLE: y URL: conviven con N:, FN:, TEL, EMAIL y ORG en la misma ficha sin desplazarlos', () => {
  const vcf = vcardDeProspecto({ ...PROSPECTO_COMPLETO, nombrePila: 'Juan', apellido: 'Perez' });
  const lineas = vcf.split('\r\n');
  assert.ok(lineas.includes('N:Perez;Juan;;;'));
  assert.ok(lineas.includes('FN:Juan Perez'));
  assert.ok(lineas.includes('TEL;TYPE=CELL:+525512345678'));
  assert.ok(lineas.includes('EMAIL:juan@hotelazul.mx'));
  assert.ok(lineas.includes('ORG:Hotel Azul'));
  assert.ok(lineas.includes('TITLE:Compras'));
  assert.ok(lineas.includes('URL:@hotelazul'));
});

test('#237: TITLE: y URL: escapan los reservados de vCard igual que los demas campos', () => {
  const vcf = vcardDeProspecto({
    nombre: 'Juan Perez', celular: '+525512345678',
    cargo: 'Gerente; Compras, Norte', web: 'https://x.com/hotel;azul,mx',
  });
  const lineaTitle = vcf.split('\r\n').find(l => l.startsWith('TITLE:'));
  const lineaUrl = vcf.split('\r\n').find(l => l.startsWith('URL:'));
  assert.equal(lineaTitle, 'TITLE:Gerente\\; Compras\\, Norte');
  assert.equal(lineaUrl, 'URL:https://x.com/hotel\\;azul\\,mx');
});

test('#237: el caso minimo (sin cargo ni sitio web) sigue produciendo una ficha valida sin TITLE: ni URL:', () => {
  const vcf = vcardDeProspecto({ nombre: 'Laura Mendoza', nombrePila: 'Laura', apellido: 'Mendoza', celular: '+525512345678' });
  assert.deepEqual(vcf.split('\r\n'), [
    'BEGIN:VCARD',
    'VERSION:3.0',
    'N:Mendoza;Laura;;;',
    'FN:Laura Mendoza',
    'TEL;TYPE=CELL:+525512345678',
    'END:VCARD',
  ]);
});

// --- #238: NOTE: con el contexto comercial de la captura, etiquetado y fechado ---

// El `cuando` del prospecto de #165 se sustituye por uno en ASCII para poder
// afirmar la nota completa caracter por caracter sin acentos en el fuente.
const FECHA_CAPTURA_238 = '2026-08-20T19:30:00.000Z';
const PROSPECTO_238 = { ...PROSPECTO_COMPLETO, cuando: 'En 3 meses', fechaCaptura: FECHA_CAPTURA_238 };

function notaDe(prospecto) {
  return vcardDeProspecto(prospecto).split('\r\n').find(l => l.startsWith('NOTE:'));
}

test('#238: la ficha emite NOTE: con el encabezado fechado y las cuatro lineas de contexto', () => {
  assert.equal(
    notaDe(PROSPECTO_238),
    'NOTE:Mayoreo pp.peltre - 2026-08-20\\nTipo: Otro (Panaderia)\\nPiezas: +350\\nPara: En 3 meses\\nCiudad: Ixtapaluca (CP 56530)',
  );
});

test('#238: la fecha de la nota sale del instante inyectado, nunca del reloj', () => {
  const nota = notaDe({ ...PROSPECTO_238, fechaCaptura: '2019-01-02T03:04:05.000Z' });
  assert.ok(nota.includes('Mayoreo pp.peltre - 2019-01-02'), nota);
  assert.ok(!nota.includes(new Date().toISOString().slice(0, 10)), 'el nucleo no debe consultar el reloj');
});

test('#238: sin fecha inyectada el encabezado sale solo, nunca con un valor inventado', () => {
  const nota = notaDe({ ...PROSPECTO_238, fechaCaptura: undefined });
  assert.ok(nota.startsWith('NOTE:Mayoreo pp.peltre\\nTipo: '), nota);
});

test('#238: la nota usa el mismo formato que el correo: "Otro" con su texto libre y el CP opcional', () => {
  assert.ok(notaDe(PROSPECTO_238).includes('Tipo: Otro (Panaderia)'));
  const sinOtro = notaDe({ ...PROSPECTO_238, tipoProyecto: 'Restaurantes', tipoProyectoOtro: '' });
  assert.ok(sinOtro.includes('Tipo: Restaurantes\\n'), 'sin texto libre la linea de tipo cierra ahi');
  const sinCp = notaDe({ ...PROSPECTO_238, cp: '' });
  assert.ok(sinCp.includes('Ciudad: Ixtapaluca'), sinCp);
  assert.ok(!sinCp.includes('CP'), 'el CP es opcional y sin el no queda un parentesis vacio');
});

// Cada dato faltante se omite ENTERO: la nota nunca debe decir "Sin dato" (lo
// que si hace el cuerpo del correo, donde esos campos son obligatorios).
for (const [campo, etiqueta, rastro] of [
  ['tipoProyecto', 'Tipo: ', 'Panaderia'],
  ['cantidadEstimada', 'Piezas: ', '+350'],
  ['cuando', 'Para: ', 'En 3 meses'],
  ['ciudad', 'Ciudad: ', 'CP 56530'],
]) {
  test(`#238: sin ${campo} su linea se omite entera (nunca "Sin dato") y el resto de la nota sigue`, () => {
    const nota = notaDe({ ...PROSPECTO_238, [campo]: '' });
    assert.ok(nota, 'las demas lineas sostienen la nota');
    assert.ok(!nota.includes(etiqueta), `no debia imprimir "${etiqueta}"`);
    assert.ok(!nota.includes(rastro), `tampoco el resto de la linea ("${rastro}")`);
    assert.ok(!nota.includes('Sin dato'), 'la nota omite, no rellena');
    assert.ok(nota.includes('Mayoreo pp.peltre - 2026-08-20'), 'el encabezado se mantiene');
  });
}

test('#238: sin ningun dato de contexto, NOTE: se omite por completo', () => {
  const vcf = vcardDeProspecto({
    nombre: 'Laura Mendoza', nombrePila: 'Laura', apellido: 'Mendoza',
    celular: '+525512345678', fechaCaptura: FECHA_CAPTURA_238,
  });
  assert.ok(!vcf.includes('NOTE:'), vcf);
});

test('#238: el consentimiento de promociones NO viaja en la nota (dato legal, vive en la tarjeta)', () => {
  const nota = notaDe(PROSPECTO_238);
  assert.ok(!nota.includes('Promo'));
  assert.ok(!nota.includes(PROSPECTO_COMPLETO.promos.fecha), 'ni la fecha del consentimiento');
});

test('#238: los saltos de linea de la nota van escapados: NOTE: es UNA sola linea fisica del vcf', () => {
  const lineas = vcardDeProspecto(PROSPECTO_238).split('\r\n');
  assert.equal(lineas.filter(l => l.startsWith('NOTE:')).length, 1);
  assert.ok(!lineas.some(l => l.startsWith('Tipo: ')), 'ninguna linea de la nota se volvio linea del vcf');
  assert.ok(lineas.find(l => l.startsWith('NOTE:')).includes('\\n'));
});

test('#238: NOTE: convive con el resto de la ficha sin desplazar ninguna propiedad', () => {
  const lineas = vcardDeProspecto({ ...PROSPECTO_238, nombrePila: 'Juan', apellido: 'Perez' }).split('\r\n');
  assert.equal(lineas[0], 'BEGIN:VCARD');
  assert.equal(lineas.at(-1), 'END:VCARD');
  for (const linea of [
    'VERSION:3.0', 'N:Perez;Juan;;;', 'FN:Juan Perez', 'TEL;TYPE=CELL:+525512345678',
    'EMAIL:juan@hotelazul.mx', 'ORG:Hotel Azul', 'TITLE:Compras', 'URL:@hotelazul',
  ]) {
    assert.ok(lineas.includes(linea), `la ficha perdio "${linea}"`);
  }
});

test('#238: la nota escapa los reservados de vCard igual que el resto de la ficha', () => {
  const nota = notaDe({ ...PROSPECTO_238, ciudad: 'Ixtapaluca, Mex.', cp: '', tipoProyectoOtro: 'Pan; y cafe' });
  assert.ok(nota.includes('Ciudad: Ixtapaluca\\, Mex.'), nota);
  assert.ok(nota.includes('Tipo: Otro (Pan\\; y cafe)'), nota);
});

// --- #239: nombre del adjunto .vcf nombrado con el prospecto ---

test('#239: nombreArchivoVCard deriva Nombre-Apellido.vcf del nombre completo', () => {
  assert.equal(nombreArchivoVCard({ nombre: 'Juan Perez' }), 'Juan-Perez.vcf');
});

test('#239: nombreArchivoVCard pliega acentos a ASCII (NFD + quitar diacriticas, no una tabla de reemplazos)', () => {
  assert.equal(nombreArchivoVCard({ nombre: 'José Peña' }), 'Jose-Pena.vcf');
});

test('#239: nombreArchivoVCard descarta cualquier caracter que no sea alfanumerico o guion', () => {
  assert.equal(nombreArchivoVCard({ nombre: 'María José, Pérez!!' }), 'Maria-Jose-Perez.vcf');
});

test('#239: nombreArchivoVCard acota el largo del nombre base para no producir un archivo absurdo', () => {
  const nombreLargo = 'Juan '.repeat(30).trim(); // muy por encima del tope de 60
  const archivo = nombreArchivoVCard({ nombre: nombreLargo });
  assert.ok(archivo.endsWith('.vcf'), archivo);
  assert.ok(archivo.length - '.vcf'.length <= 60, `nombre base demasiado largo: ${archivo}`);
});

test('#239: nombreArchivoVCard nunca deja un guion colgando justo antes de la extension (el corte del tope puede caer ahi)', () => {
  // 'Juan-' son 5 caracteres; repetido cae EXACTO en el tope de 60 terminando
  // en guion -- el caso real que expone el recorte, no uno inventado.
  const nombreLargo = 'Juan '.repeat(30).trim();
  const archivo = nombreArchivoVCard({ nombre: nombreLargo });
  assert.equal(archivo, `${'Juan-'.repeat(11)}Juan.vcf`);
  assert.ok(!archivo.endsWith('-.vcf'), archivo);
});

test('#239: nombreArchivoVCard cae al generico "prospecto.vcf" si tras normalizar no queda nada usable', () => {
  assert.equal(nombreArchivoVCard({ nombre: '日本語太郎' }), 'prospecto.vcf');
});

test('#239: nombreArchivoVCard cae al generico con nombre vacio o ausente', () => {
  assert.equal(nombreArchivoVCard({ nombre: '' }), 'prospecto.vcf');
  assert.equal(nombreArchivoVCard({}), 'prospecto.vcf');
});

test('#239: mensajeAlertaMayoreo trae vcardNombreArchivo junto con el resto del mensaje', () => {
  const prospecto = { nombre: 'Juan Perez', celular: '+525512345678', ciudad: 'Ixtapaluca', tipoProyecto: 'Restaurantes', cantidadEstimada: '+350' };
  const mensaje = mensajeAlertaMayoreo(prospecto, VENDEDORES_165);
  assert.equal(mensaje.vcardNombreArchivo, 'Juan-Perez.vcf');
});

test('#239: el nombre del archivo pliega acentos pero la ficha DENTRO conserva el nombre con acentos (dos normalizaciones distintas)', () => {
  const prospecto = { nombre: 'José Peña', celular: '+525512345678' };
  const mensaje = mensajeAlertaMayoreo(prospecto, VENDEDORES_165);
  assert.equal(mensaje.vcardNombreArchivo, 'Jose-Pena.vcf');
  assert.match(mensaje.vcard, /FN:José Peña/);
});
