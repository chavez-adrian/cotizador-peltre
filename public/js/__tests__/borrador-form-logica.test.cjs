'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let llaveBorradorFormulario;
let serializarBorradorFormulario;
let deserializarBorradorFormulario;
let RESTAURACION_FORM, decidirRestauracionFormulario;
let valoresAplicables, campoRestaurable;
let EVENTOS_BORRADOR_FORM, borradorFormularioMuerePorEvento;
let RESTAURACION_SUPERFICIE, AVISO_CONSTANCIA, planRestauracionFormulario;
let esCampoDeConstancia, esCampoDeCapturaManual;

const AHORA = 1755400000000;
const MINUTO = 60 * 1000;
const HORA = 60 * MINUTO;
const DIA = 24 * HORA;

function borradorConEdad(ms) {
  return serializarBorradorFormulario({
    formId: 'prospecto',
    valores: { 'pr-nombre': 'Juan' },
    ahora: AHORA - ms,
  });
}

before(async () => {
  ({
    llaveBorradorFormulario,
    serializarBorradorFormulario,
    deserializarBorradorFormulario,
    RESTAURACION_FORM, decidirRestauracionFormulario,
    valoresAplicables, campoRestaurable,
    EVENTOS_BORRADOR_FORM, borradorFormularioMuerePorEvento,
    RESTAURACION_SUPERFICIE, AVISO_CONSTANCIA, planRestauracionFormulario,
    esCampoDeConstancia, esCampoDeCapturaManual,
  } = await import('../borrador-form-logica.js'));
});

// Borrador guardado como lo guarda la superficie de verdad y leido como lo lee:
// el plan nunca se prueba contra un objeto inventado a mano (#350, criterio 5).
function borradorGuardado(formId, valores) {
  return deserializarBorradorFormulario(
    JSON.stringify(serializarBorradorFormulario({ formId, valores, ahora: AHORA })),
    formId,
  );
}

const CAMPOS_ALTA = [
  'csf-rfc', 'csf-razon-social', 'csf-nombre-corto', 'csf-calle', 'csf-cp',
  'manual-rfc', 'manual-razon-social',
  'alta-lista-precios', 'alta-segmento', 'cl-email-factura', 'env-calle',
];

test('la llave del borrador de formulario separa por formulario y por vendedor', () => {
  assert.equal(llaveBorradorFormulario('prospecto', 3), 'borrador:form:prospecto:3');
  assert.notEqual(
    llaveBorradorFormulario('prospecto', 3),
    llaveBorradorFormulario('prospecto', 4),
  );
  assert.notEqual(
    llaveBorradorFormulario('prospecto', 3),
    llaveBorradorFormulario('alta-cliente', 3),
  );
});

test('sin formulario o sin vendedor no hay llave', () => {
  assert.equal(llaveBorradorFormulario('prospecto', null), null);
  assert.equal(llaveBorradorFormulario('prospecto', undefined), null);
  assert.equal(llaveBorradorFormulario('prospecto', ''), null);
  assert.equal(llaveBorradorFormulario('', 3), null);
  assert.equal(llaveBorradorFormulario(null, 3), null);
});

test('el vendedor con id 0 tiene llave propia, no se confunde con no tener vendedor', () => {
  assert.equal(llaveBorradorFormulario('prospecto', 0), 'borrador:form:prospecto:0');
});

test('el borrador guarda los campos con texto, sellado con formulario y reloj', () => {
  const borrador = serializarBorradorFormulario({
    formId: 'prospecto',
    valores: { 'pr-nombre': 'Juan Perez', 'pr-ciudad': 'Puebla' },
    ahora: AHORA,
  });
  assert.equal(borrador.formId, 'prospecto');
  assert.equal(borrador.actualizado, AHORA);
  assert.deepEqual(borrador.valores, { 'pr-nombre': 'Juan Perez', 'pr-ciudad': 'Puebla' });
});

test('el borrador conserva el texto tal cual se tecleo, sin recortar', () => {
  const borrador = serializarBorradorFormulario({
    formId: 'prospecto',
    valores: { 'pr-notas': 'pidio catalogo ' },
    ahora: AHORA,
  });
  assert.equal(borrador.valores['pr-notas'], 'pidio catalogo ');
});

test('los campos vacios no se guardan', () => {
  const borrador = serializarBorradorFormulario({
    formId: 'prospecto',
    valores: { 'pr-nombre': 'Juan', 'pr-ciudad': '', 'pr-correo': '   ', 'pr-canal': null },
    ahora: AHORA,
  });
  assert.deepEqual(borrador.valores, { 'pr-nombre': 'Juan' });
});

test('un formulario que no dejo nada capturado no produce borrador', () => {
  assert.equal(serializarBorradorFormulario({
    formId: 'prospecto',
    valores: { 'pr-nombre': '', 'pr-ciudad': '' },
    ahora: AHORA,
  }), null);
  assert.equal(serializarBorradorFormulario({ formId: 'prospecto', valores: {}, ahora: AHORA }), null);
  assert.equal(serializarBorradorFormulario({ formId: 'prospecto', ahora: AHORA }), null);
});

test('un archivo adjunto no viaja en el borrador aunque llegue entre los valores', () => {
  const borrador = serializarBorradorFormulario({
    formId: 'prospecto',
    valores: { 'pr-nombre': 'Juan', 'csf-input': { name: 'constancia.pdf' } },
    ahora: AHORA,
  });
  assert.deepEqual(borrador.valores, { 'pr-nombre': 'Juan' });
});

test('sin formulario no hay borrador que guardar', () => {
  assert.equal(serializarBorradorFormulario({ valores: { a: 'b' }, ahora: AHORA }), null);
});

test('lo guardado vuelve a salir igual del texto de localStorage', () => {
  const guardado = JSON.stringify(serializarBorradorFormulario({
    formId: 'prospecto',
    valores: { 'pr-nombre': 'Juan Perez', 'pr-celular': '5512345678' },
    ahora: AHORA,
  }));
  const leido = deserializarBorradorFormulario(guardado, 'prospecto');
  assert.deepEqual(leido.valores, { 'pr-nombre': 'Juan Perez', 'pr-celular': '5512345678' });
  assert.equal(leido.actualizado, AHORA);
});

test('un borrador de version desconocida se descarta en silencio', () => {
  const otraVersion = JSON.stringify({
    v: 99, formId: 'prospecto', actualizado: AHORA, valores: { 'pr-nombre': 'Juan' },
  });
  assert.equal(deserializarBorradorFormulario(otraVersion, 'prospecto'), null);
});

test('un borrador ilegible o de otra forma no interrumpe: simplemente no hay nada que restaurar', () => {
  assert.equal(deserializarBorradorFormulario('{no es json', 'prospecto'), null);
  assert.equal(deserializarBorradorFormulario(null, 'prospecto'), null);
  assert.equal(deserializarBorradorFormulario('', 'prospecto'), null);
  assert.equal(deserializarBorradorFormulario(JSON.stringify({
    v: 1, formId: 'prospecto', actualizado: AHORA, valores: 'Juan',
  }), 'prospecto'), null);
  assert.equal(deserializarBorradorFormulario(JSON.stringify({
    v: 1, formId: 'prospecto', valores: { 'pr-nombre': 'Juan' },
  }), 'prospecto'), null);
});

test('un borrador de otro formulario no prellena este', () => {
  const deAlta = JSON.stringify(serializarBorradorFormulario({
    formId: 'alta-cliente',
    valores: { 'cl-rfc': 'XAXX010101000' },
    ahora: AHORA,
  }));
  assert.equal(deserializarBorradorFormulario(deAlta, 'prospecto'), null);
  assert.ok(deserializarBorradorFormulario(deAlta, 'alta-cliente'));
});

test('el borrador de formulario prellena sin preguntar, sin importar cuanto tardo el vendedor', () => {
  assert.equal(decidirRestauracionFormulario(borradorConEdad(0), AHORA), RESTAURACION_FORM.PREFILL);
  assert.equal(decidirRestauracionFormulario(borradorConEdad(40 * MINUTO), AHORA), RESTAURACION_FORM.PREFILL);
  assert.equal(decidirRestauracionFormulario(borradorConEdad(3 * DIA), AHORA), RESTAURACION_FORM.PREFILL);
  assert.equal(decidirRestauracionFormulario(borradorConEdad(29 * DIA), AHORA), RESTAURACION_FORM.PREFILL);
});

test('a los 30 dias sin tocarlo el borrador de formulario ya expiro', () => {
  assert.equal(decidirRestauracionFormulario(borradorConEdad(31 * DIA), AHORA), RESTAURACION_FORM.EXPIRADO);
  assert.equal(decidirRestauracionFormulario(borradorConEdad(90 * DIA), AHORA), RESTAURACION_FORM.EXPIRADO);
});

test('un reloj desfasado nunca le cuesta el trabajo al vendedor', () => {
  assert.equal(decidirRestauracionFormulario(borradorConEdad(-2 * DIA), AHORA), RESTAURACION_FORM.PREFILL);
});

test('sin borrador no hay decision que tomar', () => {
  assert.equal(decidirRestauracionFormulario(null, AHORA), null);
  assert.equal(decidirRestauracionFormulario({ valores: { a: 'b' } }, AHORA), null);
});

test('solo se prellenan los campos que el formulario todavia tiene', () => {
  const borrador = deserializarBorradorFormulario(serializarBorradorFormulario({
    formId: 'prospecto',
    valores: { 'pr-nombre': 'Juan', 'pr-ciudad': 'Puebla', 'pr-fax': '5555' },
    ahora: AHORA,
  }), 'prospecto');
  assert.deepEqual(
    valoresAplicables(borrador, ['pr-nombre', 'pr-ciudad', 'pr-correo']),
    { 'pr-nombre': 'Juan', 'pr-ciudad': 'Puebla' },
  );
});

test('sin campos en el formulario no se prellena nada', () => {
  const borrador = deserializarBorradorFormulario(serializarBorradorFormulario({
    formId: 'prospecto', valores: { 'pr-nombre': 'Juan' }, ahora: AHORA,
  }), 'prospecto');
  assert.deepEqual(valoresAplicables(borrador, []), {});
  assert.deepEqual(valoresAplicables(borrador, null), {});
  assert.deepEqual(valoresAplicables(null, ['pr-nombre']), {});
});

test('un archivo adjunto no es restaurable; tampoco lo que no se representa por valor', () => {
  assert.equal(campoRestaurable('file'), false);
  assert.equal(campoRestaurable('FILE'), false);
  assert.equal(campoRestaurable('password'), false);
  assert.equal(campoRestaurable('checkbox'), false);
  assert.equal(campoRestaurable('radio'), false);
  assert.equal(campoRestaurable('text'), true);
  assert.equal(campoRestaurable('tel'), true);
  assert.equal(campoRestaurable('email'), true);
  assert.equal(campoRestaurable('select-one'), true);
  assert.equal(campoRestaurable('textarea'), true);
  assert.equal(campoRestaurable(undefined), true);
});

test('el borrador muere cuando el formulario cumplio o el vendedor lo tiro', () => {
  assert.equal(borradorFormularioMuerePorEvento(EVENTOS_BORRADOR_FORM.ENVIO_EXITOSO), true);
  assert.equal(borradorFormularioMuerePorEvento(EVENTOS_BORRADOR_FORM.CANCELADO), true);
  assert.equal(borradorFormularioMuerePorEvento(EVENTOS_BORRADOR_FORM.LIMPIADO), true);
  assert.equal(borradorFormularioMuerePorEvento(EVENTOS_BORRADOR_FORM.EXPIRADO), true);
});

test('nada mas mata el borrador: salir de la sesion o un evento ajeno lo conservan', () => {
  assert.equal(borradorFormularioMuerePorEvento(EVENTOS_BORRADOR_FORM.LOGOUT), false);
  assert.equal(borradorFormularioMuerePorEvento('cerrar-formulario'), false);
  assert.equal(borradorFormularioMuerePorEvento(undefined), false);
});

// === Que valores se aplican al restaurar (issue #352) ===

test('los campos que llena la constancia se reconocen por concepto, en un solo lugar', () => {
  assert.equal(esCampoDeConstancia('csf-rfc'), true);
  assert.equal(esCampoDeConstancia('csf-regimen-fiscal'), true);
  assert.equal(esCampoDeConstancia('manual-rfc'), false);
  assert.equal(esCampoDeConstancia('alta-segmento'), false);
  assert.equal(esCampoDeConstancia(''), false);
  assert.equal(esCampoDeConstancia(null), false);
  assert.equal(esCampoDeCapturaManual('manual-razon-social'), true);
  assert.equal(esCampoDeCapturaManual('csf-razon-social'), false);
  assert.equal(esCampoDeCapturaManual(undefined), false);
});

test('el alta del camino CSF no repone los campos fiscales: el archivo no sobrevive al borrador', () => {
  const borrador = borradorGuardado('alta-completa', {
    'csf-rfc': 'OGA140604560',
    'csf-razon-social': 'OPERADORA GASTRONOMICA',
    'csf-calle': 'Reforma',
    'alta-lista-precios': '3',
    'cl-email-factura': 'pagos@ejemplo.mx',
    'env-calle': 'Bodega 4',
  });
  const plan = planRestauracionFormulario({
    borrador, idsPresentes: CAMPOS_ALTA, superficie: RESTAURACION_SUPERFICIE.SIN_CONSTANCIA,
  });
  assert.deepEqual(plan.valores, {
    'alta-lista-precios': '3',
    'cl-email-factura': 'pagos@ejemplo.mx',
    'env-calle': 'Bodega 4',
  });
  assert.deepEqual(plan.omitidos.sort(), ['csf-calle', 'csf-razon-social', 'csf-rfc']);
  assert.equal(plan.aviso, AVISO_CONSTANCIA.ALTA);
});

test('un alta que nunca vio una constancia se restaura completa y sin aviso', () => {
  const borrador = borradorGuardado('alta-completa', {
    'alta-lista-precios': '3', 'env-calle': 'Bodega 4',
  });
  const plan = planRestauracionFormulario({
    borrador, idsPresentes: CAMPOS_ALTA, superficie: RESTAURACION_SUPERFICIE.SIN_CONSTANCIA,
  });
  assert.deepEqual(plan.valores, { 'alta-lista-precios': '3', 'env-calle': 'Bodega 4' });
  assert.deepEqual(plan.omitidos, []);
  assert.equal(plan.aviso, null);
});

test('el borrador de captura a mano se restaura como siempre, tambien el mixto', () => {
  const manual = borradorGuardado('alta-completa', {
    'manual-rfc': 'OGA140604560', 'manual-razon-social': 'OPERADORA', 'alta-segmento': '7',
  });
  const planManual = planRestauracionFormulario({
    borrador: manual, idsPresentes: CAMPOS_ALTA, superficie: RESTAURACION_SUPERFICIE.SIN_CONSTANCIA,
  });
  assert.deepEqual(planManual.valores, {
    'manual-rfc': 'OGA140604560', 'manual-razon-social': 'OPERADORA', 'alta-segmento': '7',
  });
  assert.equal(planManual.aviso, null);

  // Mixto (se cargo una CSF y luego se capturo a mano): manda el camino manual, o sea
  // que lo tecleado a mano se restaura y no se pide constancia alguna. Los campos de la
  // constancia siguen sin reponerse: el archivo tampoco esta en este borrador, y
  // reponerlos dejaria la pestana CSF completa y a un clic de dar de alta sin respaldo.
  const mixto = borradorGuardado('alta-completa', {
    'csf-rfc': 'OGA140604560', 'manual-rfc': 'XAXX010101000', 'alta-segmento': '7',
  });
  const planMixto = planRestauracionFormulario({
    borrador: mixto, idsPresentes: CAMPOS_ALTA, superficie: RESTAURACION_SUPERFICIE.SIN_CONSTANCIA,
  });
  assert.deepEqual(planMixto.valores, { 'manual-rfc': 'XAXX010101000', 'alta-segmento': '7' });
  assert.deepEqual(planMixto.omitidos, ['csf-rfc']);
  assert.equal(planMixto.aviso, null, 'el camino manual no pide constancia');
});

test('el upgrade fiscal a medias no prellena nada, pero lo dice', () => {
  const borrador = borradorGuardado('upgrade-fiscal-15', {
    'csf-rfc': 'OGA140604560', 'csf-razon-social': 'OPERADORA GASTRONOMICA',
  });
  const plan = planRestauracionFormulario({
    borrador, idsPresentes: ['csf-rfc', 'csf-razon-social', 'manual-rfc'],
    superficie: RESTAURACION_SUPERFICIE.SIN_PRELLENADO,
  });
  assert.deepEqual(plan.valores, {});
  assert.deepEqual(plan.omitidos.sort(), ['csf-razon-social', 'csf-rfc']);
  assert.equal(plan.aviso, AVISO_CONSTANCIA.UPGRADE);
});

test('sin borrador que reanudar no hay aviso que dar', () => {
  for (const superficie of [...Object.values(RESTAURACION_SUPERFICIE), undefined]) {
    const plan = planRestauracionFormulario({ borrador: null, idsPresentes: CAMPOS_ALTA, superficie });
    assert.deepEqual(plan.valores, {});
    assert.deepEqual(plan.omitidos, []);
    assert.equal(plan.aviso, null);
  }
});

test('una superficie sin constancia de por medio (prospecto, edicion) restaura todo, como hoy', () => {
  const borrador = borradorGuardado('prospecto', { 'pr-nombre': 'Juan', 'pr-ciudad': 'Puebla' });
  const plan = planRestauracionFormulario({ borrador, idsPresentes: ['pr-nombre', 'pr-ciudad'] });
  assert.deepEqual(plan.valores, { 'pr-nombre': 'Juan', 'pr-ciudad': 'Puebla' });
  assert.deepEqual(plan.omitidos, []);
  assert.equal(plan.aviso, null);
});

test('un campo de constancia que el formulario ya no tiene no dispara el aviso', () => {
  const borrador = borradorGuardado('alta-completa', {
    'csf-fax': '5555', 'alta-lista-precios': '3',
  });
  const plan = planRestauracionFormulario({
    borrador, idsPresentes: CAMPOS_ALTA, superficie: RESTAURACION_SUPERFICIE.SIN_CONSTANCIA,
  });
  assert.deepEqual(plan.valores, { 'alta-lista-precios': '3' });
  assert.equal(plan.aviso, null);
});

test('un borrador cuyos campos quedaron todos vacios no es nada que restaurar', () => {
  const vacio = JSON.stringify({
    v: 1, formId: 'prospecto', actualizado: AHORA, valores: { 'pr-nombre': '  ' },
  });
  assert.equal(deserializarBorradorFormulario(vacio, 'prospecto'), null);
});
