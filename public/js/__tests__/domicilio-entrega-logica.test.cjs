'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let CAMPOS_DOMICILIO, camposDomicilioVacios, valoresDeDomicilio, planDomicilioAsistido, indiceDeDomicilio;

before(async () => {
  ({ CAMPOS_DOMICILIO, camposDomicilioVacios, valoresDeDomicilio, planDomicilioAsistido, indiceDeDomicilio } =
    await import('../domicilio-entrega-logica.js'));
});

const DOM_A = {
  branch_code: 564, descripcion: 'Bosques de Europa',
  calle: 'Bosques de Europa 12', numInt: '3', colonia: 'Bosques', cp: '54700',
  municipio: 'Cuautitlan Izcalli', estado: 'Mexico',
};
const DOM_B = {
  branch_code: 15, descripcion: 'Pestalozzi',
  calle: 'Pestalozzi 900', numInt: '', colonia: '', cp: '',
  municipio: '', estado: '',
};

// --- valoresDeDomicilio ---

test('un domicilio ausente son los seis campos vacios', () => {
  assert.deepEqual(valoresDeDomicilio(null), camposDomicilioVacios());
  assert.deepEqual(Object.keys(valoresDeDomicilio(null)), CAMPOS_DOMICILIO);
});

test('el domicilio aporta solo los seis campos de la direccion', () => {
  assert.deepEqual(valoresDeDomicilio(DOM_A), {
    calle: 'Bosques de Europa 12', numInt: '3', colonia: 'Bosques', cp: '54700',
    municipio: 'Cuautitlan Izcalli', estado: 'Mexico',
  });
});

test('el respaldo llena SOLO los huecos del domicilio, nunca pisa lo que trae', () => {
  const respaldo = { calle: 'Calle fiscal 1', colonia: 'Centro', cp: '06000', municipio: 'Cuauhtemoc', estado: 'CDMX' };
  assert.deepEqual(valoresDeDomicilio(DOM_B, respaldo), {
    calle: 'Pestalozzi 900', numInt: '', colonia: 'Centro', cp: '06000',
    municipio: 'Cuauhtemoc', estado: 'CDMX',
  });
});

// --- planDomicilioAsistido ---

test('un campo vacio recibe lo del domicilio y el selector lo recuerda', () => {
  const plan = planDomicilioAsistido(camposDomicilioVacios(), camposDomicilioVacios(), valoresDeDomicilio(DOM_A));
  assert.equal(plan.valores.calle, 'Bosques de Europa 12');
  assert.equal(plan.delSelector.calle, 'Bosques de Europa 12');
});

test('lo que tecleo el vendedor no lo pisa el domicilio, y el selector suelta el campo', () => {
  const plan = planDomicilioAsistido(
    { ...camposDomicilioVacios(), calle: 'Donde de verdad entregan 45' },
    camposDomicilioVacios(),
    valoresDeDomicilio(DOM_A),
  );
  assert.equal(plan.valores.calle, 'Donde de verdad entregan 45');
  assert.equal(plan.delSelector.calle, '');
});

test('lo que puso el selector antes si lo reemplaza el domicilio nuevo', () => {
  const previo = planDomicilioAsistido(camposDomicilioVacios(), camposDomicilioVacios(), valoresDeDomicilio(DOM_A));
  const plan = planDomicilioAsistido(previo.valores, previo.delSelector, valoresDeDomicilio(DOM_B));
  assert.equal(plan.valores.calle, 'Pestalozzi 900');
  assert.equal(plan.delSelector.calle, 'Pestalozzi 900');
});

// El corazon de #409: sin esto, cambiar de domicilio deja la calle del nuevo con
// el CP del anterior -- una direccion que no existe en ningun lado.
test('el campo que el domicilio nuevo no trae se BORRA si lo habia puesto el selector', () => {
  const previo = planDomicilioAsistido(camposDomicilioVacios(), camposDomicilioVacios(), valoresDeDomicilio(DOM_A));
  assert.equal(previo.valores.cp, '54700');
  const plan = planDomicilioAsistido(previo.valores, previo.delSelector, valoresDeDomicilio(DOM_B));
  assert.equal(plan.valores.cp, '');
  assert.equal(plan.valores.municipio, '');
  assert.equal(plan.delSelector.cp, '');
});

test('el campo que escribio el vendedor NO se borra al cambiar a un domicilio sin ese dato', () => {
  const previo = planDomicilioAsistido(camposDomicilioVacios(), camposDomicilioVacios(), valoresDeDomicilio(DOM_A));
  const aMano = { ...previo.valores, cp: '11560' };
  const plan = planDomicilioAsistido(aMano, previo.delSelector, valoresDeDomicilio(DOM_B));
  assert.equal(plan.valores.cp, '11560');
  assert.equal(plan.delSelector.cp, '');
});

// El respaldo vale para TODO domicilio, no solo para el primero: los dos branches
// del cliente 15 estan vacios en el ERP (#330) y soltarlo al cambiar de domicilio
// borraria la unica direccion conocida del cliente.
test('cambiar a un domicilio vacio cae al respaldo del cliente, no a la nada', () => {
  const respaldo = { calle: 'Bosques de Europa 163', colonia: 'Bosques de Aragon', cp: '57170', municipio: 'Nezahualcoyotl', estado: 'Mexico' };
  const inicial = planDomicilioAsistido(
    camposDomicilioVacios(), camposDomicilioVacios(), valoresDeDomicilio(DOM_B, respaldo),
  );
  assert.equal(inicial.valores.cp, '57170');
  const tras = planDomicilioAsistido(
    inicial.valores, inicial.delSelector, valoresDeDomicilio({ branch_code: 15 }, respaldo),
  );
  assert.equal(tras.valores.cp, '57170');
  assert.equal(tras.valores.calle, 'Bosques de Europa 163');
});

test('un domicilio sin datos solo borra lo del selector y deja intacto lo demas', () => {
  const aMano = { ...camposDomicilioVacios(), calle: 'Tecleado 1' };
  const plan = planDomicilioAsistido(aMano, camposDomicilioVacios(), valoresDeDomicilio(null));
  assert.deepEqual(plan.valores, aMano);
  assert.deepEqual(plan.delSelector, camposDomicilioVacios());
});

// --- indiceDeDomicilio ---

test('el branch_code del registro decide en que domicilio arranca el selector', () => {
  assert.equal(indiceDeDomicilio([DOM_A, DOM_B], 15), 1);
  assert.equal(indiceDeDomicilio([DOM_A, DOM_B], 564), 0);
});

// El branchId viaja como texto en la cotizacion guardada y como numero en Operam.
test('el branch_code compara por texto, no por tipo', () => {
  assert.equal(indiceDeDomicilio([DOM_A, DOM_B], '15'), 1);
});

test('sin branchId, ajeno o sin lista, el selector arranca en el primero', () => {
  assert.equal(indiceDeDomicilio([DOM_A, DOM_B], null), 0);
  assert.equal(indiceDeDomicilio([DOM_A, DOM_B], 999), 0);
  assert.equal(indiceDeDomicilio([], 15), 0);
  assert.equal(indiceDeDomicilio(null, 15), 0);
});
