import test from 'node:test';
import assert from 'node:assert';
import { identidadesBitrix, normalizarCorreo, clasificarBitrix, canalDeSource, esTelefonoMexicano } from '../lib/cruce-bitrix.js';

// Fabricas minimas: solo los campos que el nucleo lee. Los formatos de telefono
// son los REALES del export de Bitrix (#158), verificados sobre
// data/export-bitrix/2026-08-16 el 2026-08-16.
function lead(campos = {}) {
  return {
    ID: '1',
    NAME: 'Lead',
    STATUS_ID: 'NEW',
    STATUS_SEMANTIC_ID: 'P',
    SOURCE_ID: 'WEBFORM',
    DATE_CREATE: '2026-08-01T00:00:00+03:00',
    LAST_ACTIVITY_TIME: '2026-08-01T00:00:00+03:00',
    ...campos,
  };
}

function contacto(campos = {}) {
  return {
    ID: '1',
    NAME: 'Contacto',
    TYPE_ID: 'CLIENT',
    SOURCE_ID: 'REPEAT_SALE',
    DATE_CREATE: '2026-08-01T00:00:00+03:00',
    LAST_ACTIVITY_TIME: '2026-08-01T00:00:00+03:00',
    ...campos,
  };
}

function compania(campos = {}) {
  return { ID: '1', TITLE: 'Empresa SA', DATE_CREATE: '2026-08-01T00:00:00+03:00', ...campos };
}

function deal(campos = {}) {
  return {
    ID: '1',
    TITLE: 'Deal',
    CLOSED: 'N',
    STAGE_SEMANTIC_ID: 'P',
    STAGE_ID: 'UC_IFKFCP',
    LAST_ACTIVITY_TIME: '2026-08-01T00:00:00+03:00',
    ...campos,
  };
}

function actividad(campos = {}) {
  return { ID: '1', OWNER_TYPE_ID: '3', OWNER_ID: '1', CREATED: '2026-08-01T00:00:00+03:00', ...campos };
}

function tel(...valores) {
  return valores.map((VALUE, i) => ({ ID: String(i), VALUE, VALUE_TYPE: 'WORK', TYPE_ID: 'PHONE' }));
}

function mail(...valores) {
  return valores.map((VALUE, i) => ({ ID: String(i), VALUE, VALUE_TYPE: 'WORK', TYPE_ID: 'EMAIL' }));
}

// --- Fusion de identidades dentro del propio Bitrix ---

test('un lead y un contacto con el mismo celular en formatos distintos son UNA identidad', () => {
  const identidades = identidadesBitrix({
    leads: [lead({ ID: '10', NAME: 'Ana', PHONE: tel('+525566125268') })],
    contactos: [contacto({ ID: '20', NAME: 'Ana Perez', PHONE: tel('55 6612 5268') })],
  });

  assert.equal(identidades.length, 1);
  assert.deepEqual([...identidades[0].telefonos], ['5566125268']);
  assert.deepEqual(
    identidades[0].origenes.map(o => `${o.tipo}:${o.id}`).sort(),
    ['contacto:20', 'lead:10']
  );
});

test('los formatos mexicanos mixtos (+52, 52, 044, 045, +521, con espacios y guiones) colapsan en una identidad', () => {
  const formatos = [
    '+525566125268',
    '52 55 6612 5268',
    '0445566125268',
    '045 55-6612-5268',
    '+521 55 6612 5268',
    '5566125268',
    '(55) 6612 5268',
  ];
  const identidades = identidadesBitrix({
    contactos: formatos.map((valor, i) => contacto({ ID: String(100 + i), PHONE: tel(valor) })),
  });

  assert.equal(identidades.length, 1);
  assert.deepEqual([...identidades[0].telefonos], ['5566125268']);
  assert.equal(identidades[0].origenes.length, formatos.length);
});

test('un registro puente fusiona dos identidades que ya estaban separadas', () => {
  const identidades = identidadesBitrix({
    contactos: [
      contacto({ ID: '30', PHONE: tel('+525566125268') }),
      contacto({ ID: '31', PHONE: tel('+525599887766') }),
      contacto({ ID: '32', PHONE: tel('+525566125268', '+525599887766') }),
    ],
  });

  assert.equal(identidades.length, 1);
  assert.deepEqual([...identidades[0].telefonos].sort(), ['5566125268', '5599887766']);
  assert.equal(identidades[0].origenes.length, 3);
});

test('un telefono de menos de 10 digitos no produce llave y no fusiona con nadie', () => {
  const identidades = identidadesBitrix({
    contactos: [
      contacto({ ID: '40', PHONE: tel('1051') }),
      contacto({ ID: '41', PHONE: tel('4236') }),
    ],
  });

  assert.equal(identidades.length, 2);
  assert.deepEqual([...identidades[0].telefonos], []);
  assert.deepEqual([...identidades[1].telefonos], []);
});

test('un lead SIN telefono se fusiona con su contacto via CONTACT_ID (37 casos reales del export)', () => {
  const identidades = identidadesBitrix({
    leads: [lead({ ID: '154', NAME: 'ARIANA', PHONE: [], CONTACT_ID: '664' })],
    contactos: [contacto({ ID: '664', NAME: 'ARIANA VICTORICA', PHONE: tel('+5530357875') })],
  });

  assert.equal(identidades.length, 1);
  assert.deepEqual([...identidades[0].telefonos], ['5530357875']);
  assert.deepEqual(
    identidades[0].origenes.map(o => `${o.tipo}:${o.id}`).sort(),
    ['contacto:664', 'lead:154']
  );
});

test('un CONTACT_ID que no existe no inventa fusion ni rompe', () => {
  const identidades = identidadesBitrix({
    leads: [lead({ ID: '70', PHONE: [], CONTACT_ID: '99999' })],
    contactos: [contacto({ ID: '71', PHONE: tel('+525566125268') })],
  });

  assert.equal(identidades.length, 2);
});

// --- Correo como llave secundaria ---

test('el correo se normaliza a minusculas y sin espacios; lo vacio no produce llave', () => {
  assert.equal(normalizarCorreo('  Ventas@Peltre.MX '), 'ventas@peltre.mx');
  assert.equal(normalizarCorreo(''), null);
  assert.equal(normalizarCorreo(null), null);
  assert.equal(normalizarCorreo('no-es-correo'), null);
});

test('la identidad junta los correos de todos sus origenes', () => {
  const identidades = identidadesBitrix({
    leads: [lead({ ID: '50', PHONE: tel('+525566125268'), EMAIL: mail('Ana@Ejemplo.MX') })],
    contactos: [contacto({ ID: '51', PHONE: tel('5566125268'), EMAIL: mail('ana.perez@ejemplo.mx') })],
  });

  assert.equal(identidades.length, 1);
  assert.deepEqual([...identidades[0].correos].sort(), ['ana.perez@ejemplo.mx', 'ana@ejemplo.mx']);
});

test('dos registros con el mismo correo pero distinto celular NO se fusionan (el celular es la llave)', () => {
  const identidades = identidadesBitrix({
    contactos: [
      contacto({ ID: '60', PHONE: tel('+525566125268'), EMAIL: mail('ventas@empresa.mx') }),
      contacto({ ID: '61', PHONE: tel('+525599887766'), EMAIL: mail('ventas@empresa.mx') }),
    ],
  });

  assert.equal(identidades.length, 2);
});

// --- Clasificacion (a) ya existe / (b) candidato vivo / (c) resto ---

const HOY = new Date('2026-08-16T00:00:00Z');

function vacio() {
  return { telefonos: new Set(), correos: new Set() };
}

function clasificar(exportBitrix, { cotizador = vacio(), operam = vacio(), ...opts } = {}) {
  return clasificarBitrix({ exportBitrix, cotizador, operam }, { hoy: HOY, ...opts });
}

test('una identidad cuyo telefono ya esta en el cotizador cae en (a) con la llave que matcheo', () => {
  const r = clasificar(
    { contactos: [contacto({ ID: '80', NAME: 'Ya Cliente', PHONE: tel('+525566125268') })] },
    { cotizador: { telefonos: new Set(['5566125268']), correos: new Set() } }
  );

  assert.equal(r.candidatos.length, 0);
  assert.equal(r.yaExiste.length, 1);
  assert.equal(r.yaExiste[0].llave, 'telefono');
  assert.equal(r.yaExiste[0].donde, 'cotizador');
});

test('el correo es llave SECUNDARIA: matchea contra Operam aunque el telefono no coincida', () => {
  const r = clasificar(
    { contactos: [contacto({ ID: '81', PHONE: tel('+525511112222'), EMAIL: mail('Juan@Ejemplo.MX') })] },
    { operam: { telefonos: new Set(), correos: new Set(['juan@ejemplo.mx']) } }
  );

  assert.equal(r.yaExiste.length, 1);
  assert.equal(r.yaExiste[0].llave, 'correo');
  assert.equal(r.yaExiste[0].donde, 'operam');
});

test('el telefono gana al correo cuando ambos matchean (precedencia de llaves)', () => {
  const r = clasificar(
    { contactos: [contacto({ ID: '82', PHONE: tel('+525566125268'), EMAIL: mail('juan@ejemplo.mx') })] },
    {
      cotizador: { telefonos: new Set(['5566125268']), correos: new Set() },
      operam: { telefonos: new Set(), correos: new Set(['juan@ejemplo.mx']) },
    }
  );

  assert.equal(r.yaExiste.length, 1);
  assert.equal(r.yaExiste[0].llave, 'telefono');
  assert.equal(r.yaExiste[0].donde, 'cotizador');
});

// --- Criterio de VIVO ---

test('un contacto viejo sin ninguna senal cae en (c) por sin-senal-de-vida', () => {
  const r = clasificar({
    contactos: [contacto({
      ID: '90',
      PHONE: tel('+525566125268'),
      DATE_CREATE: '2025-09-06T07:57:39+03:00',
      LAST_ACTIVITY_TIME: '2025-09-06T07:57:39+03:00',
    })],
  });

  assert.equal(r.candidatos.length, 0);
  assert.equal(r.resto.length, 1);
  assert.equal(r.resto[0].motivo, 'sin-senal-de-vida');
});

test('un lead en proceso con actividad dentro de la ventana es candidato', () => {
  const r = clasificar({
    leads: [lead({
      ID: '91',
      PHONE: tel('+525566125268'),
      STATUS_SEMANTIC_ID: 'P',
      DATE_CREATE: '2026-07-30T00:00:00+03:00',
      LAST_ACTIVITY_TIME: '2026-07-30T00:00:00+03:00',
    })],
  });

  assert.equal(r.candidatos.length, 1);
  assert.ok(r.candidatos[0].senales.includes('lead-en-proceso'));
});

test('un deal abierto y reciente hace candidato a su contacto aunque el contacto no se haya tocado', () => {
  const r = clasificar({
    contactos: [contacto({
      ID: '92',
      PHONE: tel('+525566125268'),
      DATE_CREATE: '2025-09-06T00:00:00+03:00',
      LAST_ACTIVITY_TIME: '2025-09-06T00:00:00+03:00',
    })],
    deals: [deal({ ID: '500', CONTACT_ID: '92', LAST_ACTIVITY_TIME: '2026-07-01T00:00:00+03:00' })],
  });

  assert.equal(r.candidatos.length, 1);
  assert.ok(r.candidatos[0].senales.includes('deal-abierto'));
});

test('un deal PERDIDO y viejo no da vida', () => {
  const r = clasificar({
    contactos: [contacto({
      ID: '93',
      PHONE: tel('+525566125268'),
      DATE_CREATE: '2025-09-06T00:00:00+03:00',
      LAST_ACTIVITY_TIME: '2025-09-06T00:00:00+03:00',
    })],
    deals: [deal({
      ID: '501',
      CONTACT_ID: '93',
      CLOSED: 'Y',
      STAGE_ID: 'LOSE',
      STAGE_SEMANTIC_ID: 'F',
      LAST_ACTIVITY_TIME: '2026-07-01T00:00:00+03:00',
    })],
  });

  assert.equal(r.candidatos.length, 0);
  assert.equal(r.resto[0].motivo, 'sin-senal-de-vida');
});

test('una actividad reciente registrada contra el DEAL ligado cuenta como senal de vida', () => {
  const r = clasificar({
    contactos: [contacto({
      ID: '94',
      PHONE: tel('+525566125268'),
      DATE_CREATE: '2025-09-06T00:00:00+03:00',
      LAST_ACTIVITY_TIME: '2025-09-06T00:00:00+03:00',
    })],
    deals: [deal({
      ID: '502',
      CONTACT_ID: '94',
      CLOSED: 'Y',
      STAGE_SEMANTIC_ID: 'S',
      LAST_ACTIVITY_TIME: '2025-09-06T00:00:00+03:00',
    })],
    actividades: [actividad({ OWNER_TYPE_ID: '2', OWNER_ID: '502', CREATED: '2026-07-20T00:00:00+03:00' })],
  });

  assert.equal(r.candidatos.length, 1);
  assert.ok(r.candidatos[0].senales.includes('actividad-reciente'));
});

test('un lead JUNK no entra al embudo aunque tenga actividad reciente (juicio humano explicito)', () => {
  const r = clasificar({
    leads: [lead({
      ID: '95',
      PHONE: tel('+525566125268'),
      STATUS_ID: 'JUNK',
      STATUS_SEMANTIC_ID: 'F',
      DATE_CREATE: '2026-07-30T00:00:00+03:00',
      LAST_ACTIVITY_TIME: '2026-07-30T00:00:00+03:00',
    })],
  });

  assert.equal(r.candidatos.length, 0);
  assert.equal(r.resto[0].motivo, 'descartado-en-bitrix');
});

test('un lead JUNK CON deal abierto si entra: el deal abierto contradice el descarte', () => {
  const r = clasificar({
    leads: [lead({ ID: '96', PHONE: tel('+525566125268'), STATUS_ID: 'JUNK', STATUS_SEMANTIC_ID: 'F', CONTACT_ID: '97' })],
    contactos: [contacto({ ID: '97', PHONE: tel('+525566125268') })],
    deals: [deal({ ID: '503', CONTACT_ID: '97', LAST_ACTIVITY_TIME: '2026-07-01T00:00:00+03:00' })],
  });

  assert.equal(r.candidatos.length, 1);
  assert.ok(r.candidatos[0].senales.includes('deal-abierto'));
});

test('sin celular no se puede importar: cae en (c) aunque sea reciente', () => {
  const r = clasificar({
    leads: [lead({ ID: '98', PHONE: [], DATE_CREATE: '2026-07-30T00:00:00+03:00' })],
  });

  assert.equal(r.candidatos.length, 0);
  assert.equal(r.resto[0].motivo, 'sin-celular');
});

test('sin celular pero con correo conocido cae en (a): el cruce se evalua ANTES que la falta de celular', () => {
  const r = clasificar(
    { leads: [lead({ ID: '99', PHONE: [], EMAIL: mail('ya@existe.mx') })] },
    { operam: { telefonos: new Set(), correos: new Set(['ya@existe.mx']) } }
  );

  assert.equal(r.yaExiste.length, 1);
  assert.equal(r.resto.length, 0);
});

test('la ventana de vivo es un parametro: el mismo dato cambia de lado a 90 y a 365 dias', () => {
  const exportBitrix = {
    leads: [lead({
      ID: '200',
      PHONE: tel('+525566125268'),
      STATUS_SEMANTIC_ID: 'P',
      DATE_CREATE: '2026-02-25T00:00:00+03:00',
      LAST_ACTIVITY_TIME: '2026-03-18T00:00:00+03:00',
    })],
  };

  assert.equal(clasificar(exportBitrix, { ventanaDias: 90 }).candidatos.length, 0);
  assert.equal(clasificar(exportBitrix, { ventanaDias: 365 }).candidatos.length, 1);
});

test('el canal sale del SOURCE_ID; un source sin equivalente deja canal en null', () => {
  assert.equal(canalDeSource('WEBFORM'), 'Formulario web');
  assert.equal(canalDeSource('REPEAT_SALE'), 'Feria/Expo');
  assert.equal(canalDeSource('WZdaac8842-31c5-4d24-b0b4-1e3f81aef185'), 'WhatsApp');
  assert.equal(canalDeSource('CALL'), null);
  assert.equal(canalDeSource(''), null);

  const r = clasificar({
    leads: [lead({ ID: '201', PHONE: tel('+525566125268'), SOURCE_ID: 'CALL', DATE_CREATE: '2026-07-30T00:00:00+03:00' })],
  });
  assert.equal(r.candidatos[0].canal, null);
});

// --- Companias: contexto de la persona, no candidatos por si mismas ---

test('una compania referida por un contacto NO es identidad aparte: solo aporta el nombre de la empresa', () => {
  const identidades = identidadesBitrix({
    contactos: [contacto({ ID: '300', NAME: 'Ana', PHONE: tel('+525566125268'), COMPANY_ID: '900' })],
    companias: [compania({ ID: '900', TITLE: 'Los Aguachiles' })],
  });

  assert.equal(identidades.length, 1);

  const r = clasificar({
    contactos: [contacto({ ID: '300', NAME: 'Ana', PHONE: tel('+525566125268'), COMPANY_ID: '900' })],
    companias: [compania({ ID: '900', TITLE: 'Los Aguachiles' })],
  });
  assert.equal(r.candidatos.length, 1);
  assert.equal(r.candidatos[0].empresa, 'Los Aguachiles');
});

test('dos contactos de la MISMA compania siguen siendo dos personas distintas', () => {
  const identidades = identidadesBitrix({
    contactos: [
      contacto({ ID: '301', NAME: 'Ana', PHONE: tel('+525566125268'), COMPANY_ID: '901' }),
      contacto({ ID: '302', NAME: 'Beto', PHONE: tel('+525599887766'), COMPANY_ID: '901' }),
    ],
    companias: [compania({ ID: '901' })],
  });

  assert.equal(identidades.length, 2);
});

test('una compania HUERFANA (que ningun contacto ni lead refiere) si cuenta como identidad propia', () => {
  const identidades = identidadesBitrix({
    contactos: [contacto({ ID: '303', PHONE: tel('+525566125268'), COMPANY_ID: '902' })],
    companias: [compania({ ID: '902' }), compania({ ID: '903', TITLE: 'Huerfana SA' })],
  });

  assert.equal(identidades.length, 2);
  const huerfana = identidades.find(i => i.origenes.some(o => o.id === '903'));
  assert.ok(huerfana, 'la compania huerfana debe aparecer como identidad');
});

test('el titulo placeholder "Company #123" de Bitrix no se muestra como empresa', () => {
  const r = clasificar({
    contactos: [contacto({ ID: '304', PHONE: tel('+525566125268'), COMPANY_ID: '904' })],
    companias: [compania({ ID: '904', TITLE: 'Company #564' })],
  });

  assert.equal(r.candidatos[0].empresa, '');
});

test('se distingue un telefono mexicano de uno extranjero (el "+" suelto de un numero de 10 digitos no lo vuelve extranjero)', () => {
  // 10 digitos = numero nacional mexicano, aunque Bitrix le haya pegado un "+".
  assert.equal(esTelefonoMexicano('+2225592022'), true);
  assert.equal(esTelefonoMexicano('5566125268'), true);
  assert.equal(esTelefonoMexicano('+525566125268'), true);
  assert.equal(esTelefonoMexicano('+521 55 6612 5268'), true);
  // Con lada de pais distinta de 52 si es extranjero.
  assert.equal(esTelefonoMexicano('+15052046498'), false);
  assert.equal(esTelefonoMexicano('+573162321278'), false);
  assert.equal(esTelefonoMexicano('+56983177005'), false);
});
