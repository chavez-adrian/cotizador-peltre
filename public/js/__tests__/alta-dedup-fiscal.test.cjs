'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let calcularDiffFiscal;
let buildDiffFiscalHtml;
let buildDedupExactoConDiffHtml;
let buildActualizarFiscalPayload;
let buildCandidatosRfcGenericoHtml;
let buildNotasConTaxId;
let buildNotasConActividades;
before(async () => {
  ({ calcularDiffFiscal, buildDiffFiscalHtml, buildDedupExactoConDiffHtml, buildActualizarFiscalPayload, buildCandidatosRfcGenericoHtml, buildNotasConTaxId, buildNotasConActividades } = await import('../alta-logica.js'));
});

// === calcularDiffFiscal ===
// Compara los datos fiscales de la CSF recien subida (formato altaState.datos)
// contra el cliente ya guardado en Operam (formato crudo de /api/buscar-cliente-duplicado).
// El diff resultante usa NOMBRES DE CAMPO DE OPERAM como llave (CustName, tax_id, street, ...)
// porque bodyDesdeDiffFiscal(diff) las traduce a llaves de escritura y las manda al PUT
// de Operam -- si la llave fuera un id de DOM (cl-razon-social) el PATCH mandaria campos
// que Operam no reconoce. Esto difiere a proposito del calcularDiff viejo (deuda tecnica).

const clienteOperamBase = {
  customer_id: 77,
  CustName: 'Peltre Nacional SA de CV',
  tax_id: 'PNA010203ABC',
  idcif: 'IDCIF123',
  street: 'Reforma',
  street_number: '100',
  suite_number: 'A',
  district: 'Juarez',
  postal_code: '06600',
  city: 'CDMX',
  state: 'CDMX',
  cfdi_regimen_fiscal: '601',
};

const csfDatosIguales = {
  rfc: 'PNA010203ABC',
  razonSocial: 'Peltre Nacional SA de CV',
  idcif: 'IDCIF123',
  calle: 'Reforma',
  numExt: '100',
  numInt: 'A',
  colonia: 'Juarez',
  cp: '06600',
  municipio: 'CDMX',
  estado: 'CDMX',
  regimenFiscal: '601',
};

test('G1: calcularDiffFiscal retorna objeto vacio cuando no hay diferencias', () => {
  const diff = calcularDiffFiscal(clienteOperamBase, csfDatosIguales);
  assert.deepEqual(diff, {});
});

test('G2: calcularDiffFiscal detecta cambio en razon social (CustName)', () => {
  const csfDatos = { ...csfDatosIguales, razonSocial: 'Peltre Nacional Industrias SA de CV' };
  const diff = calcularDiffFiscal(clienteOperamBase, csfDatos);
  assert.ok('CustName' in diff, 'debe usar CustName como llave (nombre de campo Operam)');
  assert.equal(diff.CustName.anterior, 'Peltre Nacional SA de CV');
  assert.equal(diff.CustName.nuevo, 'Peltre Nacional Industrias SA de CV');
});

test('G3: calcularDiffFiscal detecta cambio de domicilio fiscal completo', () => {
  const csfDatos = {
    ...csfDatosIguales,
    calle: 'Insurgentes',
    numExt: '200',
    numInt: 'B',
    colonia: 'Roma',
    cp: '06700',
    municipio: 'Guadalajara',
    estado: 'Jalisco',
  };
  const diff = calcularDiffFiscal(clienteOperamBase, csfDatos);
  assert.equal(diff.street.anterior, 'Reforma');
  assert.equal(diff.street.nuevo, 'Insurgentes');
  assert.equal(diff.street_number.nuevo, '200');
  assert.equal(diff.suite_number.nuevo, 'B');
  assert.equal(diff.district.nuevo, 'Roma');
  assert.equal(diff.postal_code.nuevo, '06700');
  assert.equal(diff.city.nuevo, 'Guadalajara');
  assert.equal(diff.state.nuevo, 'Jalisco');
});

test('G4: calcularDiffFiscal detecta cambio de regimen fiscal (cfdi_regimen_fiscal)', () => {
  const csfDatos = { ...csfDatosIguales, regimenFiscal: '612' };
  const diff = calcularDiffFiscal(clienteOperamBase, csfDatos);
  assert.equal(diff.cfdi_regimen_fiscal.anterior, '601');
  assert.equal(diff.cfdi_regimen_fiscal.nuevo, '612');
});

test('G5: calcularDiffFiscal detecta cambio de RFC (tax_id) e idcif', () => {
  const csfDatos = { ...csfDatosIguales, rfc: 'NUE010101XYZ', idcif: 'IDCIF999' };
  const diff = calcularDiffFiscal(clienteOperamBase, csfDatos);
  assert.equal(diff.tax_id.anterior, 'PNA010203ABC');
  assert.equal(diff.tax_id.nuevo, 'NUE010101XYZ');
  assert.equal(diff.idcif.anterior, 'IDCIF123');
  assert.equal(diff.idcif.nuevo, 'IDCIF999');
});

test('G6: calcularDiffFiscal ignora diferencias de espacios en blanco al inicio/final', () => {
  const csfDatos = { ...csfDatosIguales, razonSocial: '  Peltre Nacional SA de CV  ' };
  const diff = calcularDiffFiscal(clienteOperamBase, csfDatos);
  assert.deepEqual(diff, {}, 'no debe marcar diferencia solo por espacios');
});

test('G7: calcularDiffFiscal trata valores null/undefined del cliente Operam como cadena vacia', () => {
  const clienteIncompleto = { customer_id: 5, CustName: 'Cliente X', tax_id: 'CLX010101AB1' };
  const csfDatos = { ...csfDatosIguales, rfc: 'CLX010101AB1', razonSocial: 'Cliente X', idcif: 'NUEVO' };
  const diff = calcularDiffFiscal(clienteIncompleto, csfDatos);
  assert.equal(diff.idcif.anterior, '');
  assert.equal(diff.idcif.nuevo, 'NUEVO');
  assert.ok(!('CustName' in diff), 'sin diferencia real no debe aparecer en el diff');
});

test('G7b: calcularDiffFiscal omite campos de domicilio ausentes en la CSF/formulario capturado (ausente != vacio)', () => {
  // Desde la regla 4 de #95, altaManualLeerFormulario SI incluye calle/numExt/numInt/
  // colonia (opcionales en la pestana manual). Pero siguen pudiendo faltar en formularios
  // viejos/parciales -- calcularDiffFiscal no debe reportarlos como "cambio a (vacio)"
  // cuando la llave esta simplemente ausente del objeto capturado; eso seria un falso
  // positivo que generaria friccion y confusion (rompe AC1: "diff claro").
  const csfDatosDeAltaManual = {
    rfc: 'PNA010203ABC',
    razonSocial: 'Peltre Nacional SA de CV',
    idcif: 'IDCIF123',
    cp: '06600',
    municipio: 'CDMX',
    estado: 'CDMX',
    regimenFiscal: '601',
    // sin calle, numExt, numInt, colonia -- ausentes, como produce altaManualLeerFormulario
  };
  const diff = calcularDiffFiscal(clienteOperamBase, csfDatosDeAltaManual);
  assert.deepEqual(diff, {}, 'no debe reportar diferencias en campos que el formulario no recolecto');
});

test('G7c: calcularDiffFiscal SI reporta domicilio vacio cuando el campo fue capturado explicitamente como cadena vacia', () => {
  // Distincion clave: si el campo SI esta presente mtu en csfDatos pero vacio (el
  // formulario de CSF si lo recolecta y el vendedor lo dejo en blanco / la CSF no lo trae),
  // SI debe compararse -- ahi si es una diferencia real digna de mostrarse.
  const csfDatosConCalleVacia = { ...csfDatosIguales, calle: '' };
  const diff = calcularDiffFiscal(clienteOperamBase, csfDatosConCalleVacia);
  assert.equal(diff.street.anterior, 'Reforma');
  assert.equal(diff.street.nuevo, '');
});

// === buildActualizarFiscalPayload ===
// Body del PUT /api/actualizar-cliente-fiscal/:id (upgrade de CSF, issue #85):
// recorre DIFF_FISCAL_CAMPOS y arma { [campoOperam]: csfDatos[csf] } para escribir
// los datos fiscales reales sobre el cliente generico existente. Es la MISMA tabla
// que calcularDiffFiscal, para que lo que se manda y lo que se verifica sean simetricos.

test('U1: buildActualizarFiscalPayload mapea los datos de la CSF a nombres de campo de Operam', () => {
  const body = buildActualizarFiscalPayload(csfDatosIguales);
  assert.equal(body.cust_name, 'Peltre Nacional SA de CV');
  assert.equal(body.tax_id, 'PNA010203ABC');
  assert.equal(body.idcif, 'IDCIF123');
  assert.equal(body.street, 'Reforma');
  assert.equal(body.street_number, '100');
  assert.equal(body.suite_number, 'A');
  assert.equal(body.district, 'Juarez');
  assert.equal(body.postal_code, '06600');
  assert.equal(body.city, 'CDMX');
  assert.equal(body.state, 'CDMX');
  assert.equal(body.cfdi_regimen_fiscal, '601');
});

test('U2: buildActualizarFiscalPayload NO incluye llaves de DOM ni campos ajenos a la tabla fiscal', () => {
  const body = buildActualizarFiscalPayload(csfDatosIguales);
  assert.ok(!('razonSocial' in body), 'no debe filtrar la llave csf cruda');
  assert.ok(!('rfc' in body), 'no debe filtrar la llave csf cruda');
  assert.ok(!('sales_type' in body), 'no debe inventar campos comerciales');
});

test('U3: buildActualizarFiscalPayload omite campos que la CSF no recolecto (ausente != vacio)', () => {
  const csfSinDomicilio = {
    rfc: 'PNA010203ABC', razonSocial: 'Peltre Nacional SA de CV', idcif: 'IDCIF123',
    cp: '06600', municipio: 'CDMX', estado: 'CDMX', regimenFiscal: '601',
  };
  const body = buildActualizarFiscalPayload(csfSinDomicilio);
  assert.ok(!('street' in body), 'sin calle capturada no debe mandar street vacio (nukearia el dato en Operam)');
  assert.ok(!('district' in body));
  assert.equal(body.tax_id, 'PNA010203ABC');
  assert.equal(body.postal_code, '06600');
});

// La simetria entre lo enviado y lo verificado vive ahora en W4: desde #169 el payload
// usa llaves de ESCRITURA (cust_name) y la verificacion lee las del GET (CustName), asi
// que comparar el payload consigo mismo ya no representa lo que ocurre en Operam.

// === Regla 1 (issue #95): nombre corto (cust_ref) viaja en el upgrade fiscal ===
// Antes cust_ref no estaba en DIFF_FISCAL_CAMPOS: el vendedor lo capturaba en
// csf-nombre-corto/manual-nombre-corto y se descartaba silenciosamente al confirmar
// un upgrade (gap #11 de MAPEO_CAMPOS_CLIENTE.md).

test('R1: calcularDiffFiscal detecta cambio en el nombre corto (cust_ref)', () => {
  const csfDatos = { ...csfDatosIguales, nombreCorto: 'Peltre Nal' };
  const cliente = { ...clienteOperamBase, cust_ref: 'Otro Alias' };
  const diff = calcularDiffFiscal(cliente, csfDatos);
  assert.ok('cust_ref' in diff, 'debe usar cust_ref como llave (nombre de campo Operam)');
  assert.equal(diff.cust_ref.anterior, 'Otro Alias');
  assert.equal(diff.cust_ref.nuevo, 'Peltre Nal');
});

test('R2: buildActualizarFiscalPayload incluye cust_ref cuando la CSF trae nombreCorto', () => {
  const body = buildActualizarFiscalPayload({ ...csfDatosIguales, nombreCorto: 'Peltre Nal' });
  assert.equal(body.cust_ref, 'Peltre Nal');
});

test('R3: buildActualizarFiscalPayload omite cust_ref si el formulario no recolecto nombreCorto (ausente != vacio)', () => {
  const body = buildActualizarFiscalPayload(csfDatosIguales);
  assert.ok(!('cust_ref' in body));
});

// === Regla 2 (issue #95): Uso de CFDI se manda SIEMPRE, default S01 ===
// A diferencia de los demas campos (ausente != vacio, no se manda si el formulario
// no lo recolecto), el Uso de CFDI es una excepcion de dominio: el vendedor puede
// no haberlo especificado y aun asi debe viajar con el default "Sin efectos
// fiscales" en vez de quedar fuera del PUT (gap #13 de MAPEO_CAMPOS_CLIENTE.md).

test('R4: buildActualizarFiscalPayload manda timbrado_uso_cfdi con el valor capturado', () => {
  const body = buildActualizarFiscalPayload({ ...csfDatosIguales, usoCfdi: 'G01' });
  assert.equal(body.timbrado_uso_cfdi, 'G01');
});

test('R5: buildActualizarFiscalPayload default S01 cuando usoCfdi viene vacio', () => {
  const body = buildActualizarFiscalPayload({ ...csfDatosIguales, usoCfdi: '' });
  assert.equal(body.timbrado_uso_cfdi, 'S01');
});

test('R6: buildActualizarFiscalPayload default S01 cuando usoCfdi ni siquiera se capturo (a diferencia de los demas campos, SI se manda)', () => {
  const body = buildActualizarFiscalPayload(csfDatosIguales);
  assert.equal(body.timbrado_uso_cfdi, 'S01');
});

test('R7: calcularDiffFiscal compara timbrado_uso_cfdi tomando en cuenta el default S01', () => {
  const clienteConOtroUso = { ...clienteOperamBase, timbrado_uso_cfdi: 'G03' };
  const diff = calcularDiffFiscal(clienteConOtroUso, { ...csfDatosIguales, usoCfdi: 'S01' });
  assert.equal(diff.timbrado_uso_cfdi.anterior, 'G03');
  assert.equal(diff.timbrado_uso_cfdi.nuevo, 'S01');
});

// === Regla 3 (issue #95): email de facturacion viaja en el upgrade fiscal ===
// Limitacion de plataforma (ADR-0002): los contactos no son configurables via API
// v3 (POST /contacts 501, PUT con array contacts se ignora). Lo automatizable es
// persistir el correo en invoice_email del cliente (gap #14 de MAPEO_CAMPOS_CLIENTE.md).

test('R8: buildActualizarFiscalPayload incluye invoice_email cuando se capturo', () => {
  const body = buildActualizarFiscalPayload({ ...csfDatosIguales, invoiceEmail: 'facturacion@peltre.mx' });
  assert.equal(body.invoice_email, 'facturacion@peltre.mx');
});

test('R9: buildActualizarFiscalPayload omite invoice_email si no se capturo (ausente != vacio)', () => {
  const body = buildActualizarFiscalPayload(csfDatosIguales);
  assert.ok(!('invoice_email' in body));
});

test('R10: calcularDiffFiscal detecta cambio de invoice_email', () => {
  const cliente = { ...clienteOperamBase, invoice_email: 'viejo@peltre.mx' };
  const diff = calcularDiffFiscal(cliente, { ...csfDatosIguales, invoiceEmail: 'nuevo@peltre.mx' });
  assert.equal(diff.invoice_email.anterior, 'viejo@peltre.mx');
  assert.equal(diff.invoice_email.nuevo, 'nuevo@peltre.mx');
});

// === Regla 5 (issue #95): Tax ID extranjero se guarda en notas ===
// No hay campo dedicado en la API v3 de Operam para Tax ID extranjero (se requiere
// para documentacion de exportacion). Decision de Adrian: va al campo de notas del
// cliente, con un prefijo claro y SIN borrar notas existentes.

test('N1: buildNotasConTaxId sin notas previas antepone la linea Tax ID', () => {
  const notas = buildNotasConTaxId('', 'US123456789');
  assert.equal(notas, 'Tax ID: US123456789');
});

test('N2: buildNotasConTaxId con notas previas las conserva, agregando la linea Tax ID al inicio', () => {
  const notas = buildNotasConTaxId('Actividades economicas (CSF 2026-01-01):\n- Comercio', 'US123456789');
  assert.equal(notas, 'Tax ID: US123456789\nActividades economicas (CSF 2026-01-01):\n- Comercio');
});

test('N3: buildNotasConTaxId sin taxIdExtranjero retorna undefined (no toca notas)', () => {
  assert.equal(buildNotasConTaxId('Notas previas', ''), undefined);
  assert.equal(buildNotasConTaxId('Notas previas', null), undefined);
  assert.equal(buildNotasConTaxId('Notas previas', undefined), undefined);
});

test('N4: buildNotasConTaxId no duplica la linea si ya esta presente (reintento idempotente)', () => {
  const yaTiene = 'Tax ID: US123456789\nActividades economicas (CSF 2026-01-01):\n- Comercio';
  const notas = buildNotasConTaxId(yaTiene, 'US123456789');
  assert.equal(notas, yaTiene);
});

test('N5: buildNotasConTaxId sin notas previas ni taxIdExtranjero -> undefined', () => {
  assert.equal(buildNotasConTaxId('', ''), undefined);
  assert.equal(buildNotasConTaxId(null, null), undefined);
});

test('N6: buildActualizarFiscalPayload incluye notes con Tax ID cuando se capturo taxIdExtranjero', () => {
  const body = buildActualizarFiscalPayload({ ...csfDatosIguales, taxIdExtranjero: 'US123456789' }, 'Notas previas del cliente');
  assert.equal(body.notes, 'Tax ID: US123456789\nNotas previas del cliente');
});

test('N7: buildActualizarFiscalPayload sin taxIdExtranjero NO agrega notes', () => {
  const body = buildActualizarFiscalPayload(csfDatosIguales, 'Notas previas del cliente');
  assert.ok(!('notes' in body));
});

test('N8: buildActualizarFiscalPayload no filtra taxIdExtranjero como llave cruda', () => {
  const body = buildActualizarFiscalPayload({ ...csfDatosIguales, taxIdExtranjero: 'US123456789' });
  assert.ok(!('taxIdExtranjero' in body));
});

// === Issue #171: actividades economicas de la CSF -> notas del cliente ===
// El upgrade fiscal (#85) nunca tocaba notes para las actividades: el template
// "Actividades economicas (CSF ):" solo lo armaba buildClienteBody (alta), y
// ningun flujo llenaba cliente.actividades. buildNotasConActividades sigue el
// MISMO patron que buildNotasConTaxId (regla 5 de #95): compone sobre notas
// existentes, nunca las pisa, y es idempotente en reintentos.

test('AC1: buildNotasConActividades sin notas previas arma la seccion completa', () => {
  const notas = buildNotasConActividades('', ['Comercio al por menor'], '8 DE MAYO DE 2026');
  assert.equal(notas, 'Actividades economicas (CSF 8 DE MAYO DE 2026):\n- Comercio al por menor');
});

test('AC2: buildNotasConActividades con notas previas las conserva y agrega la seccion al final', () => {
  const notas = buildNotasConActividades('Tax ID: US123456789', ['Comercio al por menor'], '8 DE MAYO DE 2026');
  assert.equal(notas, 'Tax ID: US123456789\nActividades economicas (CSF 8 DE MAYO DE 2026):\n- Comercio al por menor');
});

test('AC3: buildNotasConActividades sin actividades retorna undefined (no toca notas)', () => {
  assert.equal(buildNotasConActividades('Notas previas', [], '2026-05-08'), undefined);
  assert.equal(buildNotasConActividades('Notas previas', null, '2026-05-08'), undefined);
  assert.equal(buildNotasConActividades('Notas previas', undefined, '2026-05-08'), undefined);
});

test('AC4: buildNotasConActividades REEMPLAZA la seccion previa (de una CSF anterior) en vez de duplicarla', () => {
  const previas = 'Celular: 5512345678\nActividades economicas (CSF 2025-01-01):\n- Actividad vieja';
  const notas = buildNotasConActividades(previas, ['Actividad nueva', 'Otra actividad (30%)'], '2026-05-08');
  assert.equal(notas, 'Celular: 5512345678\nActividades economicas (CSF 2026-05-08):\n- Actividad nueva\n- Otra actividad (30%)');
});

test('AC5: buildNotasConActividades es idempotente -- reintento con la misma CSF no acumula secciones', () => {
  const primera = buildNotasConActividades('Celular: 5512345678', ['Comercio al por menor'], '2026-05-08');
  const segunda = buildNotasConActividades(primera, ['Comercio al por menor'], '2026-05-08');
  assert.equal(segunda, primera);
});

test('AC5b: buildNotasConActividades con actividades pero sin csf_fecha (CSF sin "Fecha de emision") omite el parentesis, nunca "(CSF ):" vacio', () => {
  const notas = buildNotasConActividades('', ['Otros intermediarios del comercio al por menor'], '');
  assert.ok(!notas.includes('(CSF )'), 'nunca debe imprimir el parentesis vacio');
  assert.equal(notas, 'Actividades economicas:\n- Otros intermediarios del comercio al por menor');
});

test('AC5c: buildNotasConActividades reemplaza una seccion previa SIN fecha por una nueva CON fecha (el regex reconoce ambas formas de encabezado)', () => {
  const previas = 'Actividades economicas:\n- Actividad vieja';
  const notas = buildNotasConActividades(previas, ['Actividad nueva'], '2026-05-08');
  assert.equal(notas, 'Actividades economicas (CSF 2026-05-08):\n- Actividad nueva');
});

test('AC6: buildActualizarFiscalPayload incluye notes con la seccion de actividades cuando la CSF las trae', () => {
  const body = buildActualizarFiscalPayload(
    { ...csfDatosIguales, actividades: ['Comercio al por menor'], csf_fecha: '2026-05-08' },
    'Notas previas del cliente'
  );
  assert.equal(body.notes, 'Notas previas del cliente\nActividades economicas (CSF 2026-05-08):\n- Comercio al por menor');
});

test('AC7: buildActualizarFiscalPayload sin actividades NO agrega notes', () => {
  const body = buildActualizarFiscalPayload(csfDatosIguales, 'Notas previas del cliente');
  assert.ok(!('notes' in body));
});

test('AC8: buildActualizarFiscalPayload combina Tax ID extranjero Y actividades en la misma escritura de notes', () => {
  const body = buildActualizarFiscalPayload(
    { ...csfDatosIguales, taxIdExtranjero: 'US123456789', actividades: ['Comercio al por menor'], csf_fecha: '2026-05-08' },
    'Notas previas del cliente'
  );
  assert.equal(body.notes, 'Tax ID: US123456789\nNotas previas del cliente\nActividades economicas (CSF 2026-05-08):\n- Comercio al por menor');
});

test('AC9: buildActualizarFiscalPayload con notasActuales null (relectura fallida) omite notes aunque haya actividades', () => {
  const body = buildActualizarFiscalPayload({ ...csfDatosIguales, actividades: ['Comercio al por menor'] }, null);
  assert.ok(!('notes' in body));
});

// === Regla 6 (issue #95): segmento_id viaja en el upgrade, con verificacion post-escritura ===
// Quirk documentado (#74/CLAUDE.md): PUT customers puede ignorar segmento_id en
// silencio. Al agregarlo a DIFF_FISCAL_CAMPOS, calcularDiffFiscal lo verifica
// GRATIS via el mismo mecanismo generico que ya usa el endpoint de upgrade para
// camposNoActualizados (#85/#96) -- no requiere codigo nuevo en server.js.
//
// #172: el GET de detalle NO devuelve `segmento_id` plano -- devuelve un objeto
// anidado `segmento: { id, clave, description }` (verificado en vivo, cliente 491).
// Los mocks de aqui usan esa forma real, no el campo plano que la API nunca entrega.

test('R11: buildActualizarFiscalPayload incluye segmento_id cuando se capturo', () => {
  const body = buildActualizarFiscalPayload({ ...csfDatosIguales, segmentoId: '3' });
  assert.equal(body.segmento_id, '3');
});

test('R12: buildActualizarFiscalPayload omite segmento_id si no se capturo', () => {
  const body = buildActualizarFiscalPayload(csfDatosIguales);
  assert.ok(!('segmento_id' in body));
});

test('R13: calcularDiffFiscal detecta el quirk -- Operam ignoro segmento_id (el releido sigue con el valor viejo, forma anidada real)', () => {
  const clienteReleido = { ...clienteOperamBase, segmento: { id: '1', clave: '000', description: 'Sin segmento' } };
  const diff = calcularDiffFiscal(clienteReleido, { ...csfDatosIguales, segmentoId: '3' });
  assert.equal(diff.segmento_id.anterior, '1');
  assert.equal(diff.segmento_id.nuevo, '3');
});

test('R14: calcularDiffFiscal NO reporta cambio de segmento cuando el capturado coincide con segmento.id anidado', () => {
  const clienteReleido = { ...clienteOperamBase, segmento: { id: '3', clave: '003', description: 'Restaurantes, hoteles' } };
  const diff = calcularDiffFiscal(clienteReleido, { ...csfDatosIguales, segmentoId: '3' });
  assert.ok(!('segmento_id' in diff));
});

test('G8: buildDiffFiscalHtml retorna string con cada cambio antes -> despues', () => {
  const diff = {
    CustName: { anterior: 'Antes SA', nuevo: 'Despues SA' },
    cfdi_regimen_fiscal: { anterior: '601', nuevo: '612' },
  };
  const html = buildDiffFiscalHtml(diff);
  assert.ok(typeof html === 'string');
  assert.ok(html.includes('Antes SA'), 'debe mostrar valor anterior');
  assert.ok(html.includes('Despues SA'), 'debe mostrar valor nuevo');
  assert.ok(html.includes('601') && html.includes('612'), 'debe mostrar cambio de regimen');
});

test('G8b: buildDiffFiscalHtml muestra "(vacio)" cuando el valor anterior o nuevo es cadena vacia (legibilidad del diff, AC1)', () => {
  // Observado manualmente en navegador (iter 4): un campo que pasa de tener valor a
  // cadena vacia (o viceversa) debe mostrarse como "(vacio)", no como un hueco en blanco
  // que el vendedor podria interpretar como un error de renderizado.
  const diff = {
    idcif: { anterior: '', nuevo: 'IDCIF999', label: 'IdCIF (SAT)' },
    street: { anterior: 'Reforma 100', nuevo: '', label: 'Calle' },
  };
  const html = buildDiffFiscalHtml(diff);
  const ocurrencias = (html.match(/\(vacio\)/g) || []).length;
  assert.equal(ocurrencias, 2, 'debe mostrar "(vacio)" tanto para anterior vacio como para nuevo vacio');
});

test('G9: buildDiffFiscalHtml usa etiquetas legibles, no nombres crudos de campo Operam', () => {
  const diff = { CustName: { anterior: 'A', nuevo: 'B' }, tax_id: { anterior: 'X', nuevo: 'Y' } };
  const html = buildDiffFiscalHtml(diff);
  assert.ok(/raz[oó]n social/i.test(html), 'CustName debe traducirse a una etiqueta legible (Razon Social)');
  assert.ok(/rfc/i.test(html), 'tax_id debe traducirse a una etiqueta legible (RFC)');
});

test('G10: buildDiffFiscalHtml incluye botones confirmar y descartar', () => {
  const diff = { CustName: { anterior: 'A', nuevo: 'B' } };
  const html = buildDiffFiscalHtml(diff);
  assert.ok(/confirmar/i.test(html), 'debe ofrecer boton de confirmar actualizacion');
  assert.ok(/descartar|no actualizar|continuar sin/i.test(html), 'debe ofrecer boton de descartar');
});

test('G11: buildDiffFiscalHtml con diff vacio retorna cadena vacia (sin friccion, AC4)', () => {
  const html = buildDiffFiscalHtml({});
  assert.equal(html, '', 'sin diferencias no debe renderizar ningun panel');
});

// === buildDedupExactoConDiffHtml ===
// Compone el banner "RFC ya existe" (igual al flujo actual, AC3: "Usar este cliente"
// SIEMPRE disponible) + el panel de diff fiscal cuando aplica (AC1/AC4: solo si hay
// diferencias). Es deliberadamente NO bloqueante -- el vendedor puede usar el cliente
// existente sin resolver el diff primero (decision de diseno: paso paralelo/opcional,
// ver razonamiento en ralph-progress.txt iter 2).

const clienteExacto = { id: 77, customer_id: 77, CustName: 'Peltre Nacional SA de CV', RFC: 'PNA010203ABC', tax_id: 'PNA010203ABC' };

test('G12: buildDedupExactoConDiffHtml sin diferencias fiscales NO agrega panel de diff (AC4, sin friccion)', () => {
  const csfDatosIgualesAlCliente = {
    razonSocial: 'Peltre Nacional SA de CV', rfc: 'PNA010203ABC', idcif: '', calle: '',
    numExt: '', numInt: '', colonia: '', cp: '', municipio: '', estado: '', regimenFiscal: '',
  };
  const html = buildDedupExactoConDiffHtml(clienteExacto, csfDatosIgualesAlCliente);
  assert.ok(html.includes('Usar este cliente'), 'banner exacto debe seguir presente');
  assert.ok(!html.includes('diff-fiscal-panel'), 'sin diferencias no debe renderizar panel de diff');
});

test('G13: buildDedupExactoConDiffHtml con diferencias fiscales agrega el panel de diff Y conserva "Usar este cliente" (AC1+AC3, no bloqueante)', () => {
  const csfDatosConCambios = {
    razonSocial: 'Peltre Nacional Industrias SA de CV', rfc: 'PNA010203ABC', idcif: '',
    calle: '', numExt: '', numInt: '', colonia: '', cp: '', municipio: '', estado: '', regimenFiscal: '',
  };
  const html = buildDedupExactoConDiffHtml(clienteExacto, csfDatosConCambios);
  assert.ok(html.includes('Usar este cliente'), 'boton Usar este cliente debe seguir disponible (no bloquea)');
  assert.ok(html.includes('diff-fiscal-panel'), 'con diferencias debe mostrar el panel de diff');
  assert.ok(html.includes('Peltre Nacional Industrias SA de CV'), 'debe mostrar el valor nuevo de razon social');
});

test('G14: buildDedupExactoConDiffHtml sin csfDatos (undefined) no truena y omite el diff', () => {
  const html = buildDedupExactoConDiffHtml(clienteExacto, undefined);
  assert.ok(html.includes('Usar este cliente'));
  assert.ok(!html.includes('diff-fiscal-panel'));
});

// #196: el banner "Este RFC ya existe en Operam" muestra el nombre corto
// (cust_ref del cliente encontrado) entre parentesis, con el formato unico
// (nombreConCorto) -- mismo criterio que las demas superficies.
test('G13b (#196): buildDedupExactoConDiffHtml muestra el nombre corto del cliente cuando existe', () => {
  const clienteConCorto = { ...clienteExacto, cust_ref: 'Peltre Nal' };
  const html = buildDedupExactoConDiffHtml(clienteConCorto, undefined);
  assert.ok(html.includes('Peltre Nacional SA de CV (Peltre Nal)'), 'debe mostrar razon social + nombre corto');
});

test('G13c (#196): buildDedupExactoConDiffHtml sin nombre corto no agrega parentesis vacio', () => {
  const html = buildDedupExactoConDiffHtml(clienteExacto, undefined);
  assert.ok(!html.includes('Peltre Nacional SA de CV ('), 'sin cust_ref no debe haber parentesis de nombre corto');
});

test('G14b: buildDedupExactoConDiffHtml produce .dedup-exacto y .diff-fiscal-panel como hermanos (no anidados) -- contrato estructural para que altaDedupMostrarDomicilios pueda agregar el selector de domicilio sin ocultar el panel de diff (AC3, no bloqueante)', () => {
  // altaDedupMostrarDomicilios (app.js ~2944) hace
  // dedupDiv.querySelector('.dedup-exacto, .dedup-candidatos').appendChild(domDiv) --
  // si el panel de diff quedara ANIDADO dentro de .dedup-exacto, ese querySelector lo
  // encontraria igual, pero si algun dia alguien envuelve ambos en un contenedor comun
  // el comportamiento de "Usar este cliente" + diff coexistiendo (decision iter 2:
  // paso paralelo/opcional) podria romperse silenciosamente. Este test fija la forma
  // esperada: concatenacion de hermanos, ambos hijos directos del contenedor del dedup.
  const csfDatosConCambios = {
    razonSocial: 'Peltre Nacional Industrias SA de CV', rfc: 'PNA010203ABC', idcif: '',
    calle: '', numExt: '', numInt: '', colonia: '', cp: '', municipio: '', estado: '', regimenFiscal: '',
  };
  const html = buildDedupExactoConDiffHtml(clienteExacto, csfDatosConCambios);
  const idxExacto = html.indexOf('class="dedup-exacto"');
  const idxCierreExacto = html.indexOf('</div>', idxExacto);
  const idxPanel = html.indexOf('diff-fiscal-panel');
  assert.ok(idxExacto >= 0 && idxPanel >= 0, 'ambos elementos deben existir');
  assert.ok(idxPanel > idxCierreExacto, '.diff-fiscal-panel debe aparecer DESPUES de cerrar .dedup-exacto (hermano, no anidado)');
});

// === buildCandidatosRfcGenericoHtml (issue #78) ===
// Candidatos detectados cuando llega un RFC REAL y no hay match exacto, pero si
// hay clientes con RFC generico cuyo nombre o telefono coinciden. A diferencia
// de la rama generica de ADR-0001 (buildDedupCandidatosHtml en helpers.cjs, que
// NUNCA ofrece crear nuevo), aqui SI se ofrece -- el RFC de entrada es real y
// crear un cliente nuevo es un camino legitimo si el candidato resulta ser otra
// empresa.

const candidatosGenericos = [
  { id: 30, CustName: 'Siscani Group SA de CV', cust_ref: 'SISCANI', RFC: 'XAXX010101000', _similitud: 2, _telefonoMatch: false },
  { id: 40, CustName: 'Grupo ABC', cust_ref: 'ABC', RFC: 'XAXX010101000', _similitud: 0, _telefonoMatch: true },
];

test('V1: buildCandidatosRfcGenericoHtml contiene alerta y muestra los candidatos', () => {
  const html = buildCandidatosRfcGenericoHtml(candidatosGenericos);
  assert.ok(typeof html === 'string');
  assert.ok(html.includes('Siscani Group'), 'debe mostrar el nombre del candidato');
  assert.ok(html.includes('Grupo ABC'), 'debe mostrar el segundo candidato');
});

test('V2: buildCandidatosRfcGenericoHtml incluye boton "Actualizar este" por candidato, ligado a altaCandidatoActualizar(id)', () => {
  const html = buildCandidatosRfcGenericoHtml(candidatosGenericos);
  assert.ok(html.includes('Actualizar este'), 'debe ofrecer actualizar');
  assert.ok(html.includes('altaCandidatoActualizar(30)'), 'debe ligar el boton al id del candidato 30');
  assert.ok(html.includes('altaCandidatoActualizar(40)'), 'debe ligar el boton al id del candidato 40');
});

test('V3: buildCandidatosRfcGenericoHtml SI ofrece crear nuevo cliente (a diferencia de la rama generica de ADR-0001)', () => {
  const html = buildCandidatosRfcGenericoHtml(candidatosGenericos);
  assert.ok(/crear nuevo/i.test(html), 'debe ofrecer crear nuevo cliente');
  assert.ok(html.includes('altaCandidatoCrearNuevo()'), 'debe ligar la accion a altaCandidatoCrearNuevo');
});

test('V4: buildCandidatosRfcGenericoHtml distingue la senal de telefono de la de nombre', () => {
  const html = buildCandidatosRfcGenericoHtml(candidatosGenericos);
  assert.ok(/tel[ée]fono/i.test(html), 'debe mencionar la senal de telefono para el candidato que matcheo por telefono');
});

test('V5: buildCandidatosRfcGenericoHtml con lista vacia retorna cadena vacia', () => {
  assert.equal(buildCandidatosRfcGenericoHtml([]), '');
  assert.equal(buildCandidatosRfcGenericoHtml(undefined), '');
});

// #196: el parentesis ad hoc "(" + (c.cust_ref || '') + ")" imprimia un "()"
// vacio cuando el candidato no tenia nombre corto. Migrado al helper unico
// nombreConCorto, que omite el parentesis entero en ese caso.
test('V6 (#196): candidato sin cust_ref NO produce el parentesis vacio "()"', () => {
  const html = buildCandidatosRfcGenericoHtml([
    { id: 50, CustName: 'Sin Nombre Corto SA', RFC: 'XAXX010101000', _similitud: 1, _telefonoMatch: false },
  ]);
  assert.ok(!html.includes('Sin Nombre Corto SA</strong> ()'), 'nunca debe imprimir el parentesis vacio junto al nombre');
  assert.ok(html.includes('Sin Nombre Corto SA'), 'debe seguir mostrando el nombre');
});

// === Fixes de la revision de #95 ===

test('R-FIX1: buildActualizarFiscalPayload OMITE notes cuando las notas previas no se pudieron leer (null)', () => {
  const body = buildActualizarFiscalPayload({ rfc: 'ABC010101AAA', taxIdExtranjero: 'US-99-1234' }, null);
  assert.ok(!('notes' in body), 'con notasActuales null el payload NO debe llevar notes (pisaria notas reales del cliente)');
});

test('R-FIX1b: buildActualizarFiscalPayload SI manda notes cuando las notas previas se leyeron vacias', () => {
  const body = buildActualizarFiscalPayload({ rfc: 'ABC010101AAA', taxIdExtranjero: 'US-99-1234' }, '');
  assert.equal(body.notes, 'Tax ID: US-99-1234');
});

test('R-FIX2: emailFacturaParaUpgrade solo incluye el email cuando el upgrade se abrio desde el paso Cliente', async () => {
  const { emailFacturaParaUpgrade } = await import('../alta-logica.js');
  assert.equal(emailFacturaParaUpgrade('paso', ' fact@cliente.mx '), 'fact@cliente.mx');
  assert.equal(emailFacturaParaUpgrade('clientes', 'fact@otro.mx'), undefined,
    'desde la vista Clientes el campo cl-email-factura puede traer el email de OTRO cliente (fuga de contexto)');
  assert.equal(emailFacturaParaUpgrade(null, 'fact@otro.mx'), undefined);
  assert.equal(emailFacturaParaUpgrade('paso', '  '), undefined);
});

// === Issue #169: la LLAVE DE ESCRITURA del PUT no es la de lectura ===
//
// Sondeo en vivo sobre el cliente 491 (2026-08-17, Operam 3.26.32): el PUT
// /api/v3/sales/customers/:id IGNORA en silencio la llave `CustName` (la que
// devuelve el GET) y solo persiste el nombre con `cust_name` (la misma del POST de
// creacion). Ademas el PUT hace ECO de los campos que acepto: lo enviado que no
// vuelve en la respuesta es exactamente lo que Operam ignoro.

test('W1: buildActualizarFiscalPayload escribe la razon social con cust_name, no con CustName (#169)', () => {
  const body = buildActualizarFiscalPayload(csfDatosIguales);
  assert.equal(body.cust_name, 'Peltre Nacional SA de CV', 'la llave de ESCRITURA del PUT es cust_name');
  assert.ok(!('CustName' in body), 'CustName es la llave de LECTURA; en el PUT Operam la ignora en silencio');
});

test('W2: calcularDiffFiscal sigue leyendo la razon social de CustName (llave del GET)', () => {
  const diff = calcularDiffFiscal({ ...clienteOperamBase, CustName: 'PROSPECTO SIN RAZON SOCIAL' }, csfDatosIguales);
  assert.equal(diff.CustName.anterior, 'PROSPECTO SIN RAZON SOCIAL');
  assert.equal(diff.CustName.nuevo, 'Peltre Nacional SA de CV');
});

test('W3: calcularDiffFiscal lee el regimen de `regimen` (llave real del GET de Operam), sin falso positivo', () => {
  const clienteComoLoDevuelveOperam = { ...clienteOperamBase, cfdi_regimen_fiscal: undefined, regimen: '601' };
  const diff = calcularDiffFiscal(clienteComoLoDevuelveOperam, csfDatosIguales);
  assert.ok(!('cfdi_regimen_fiscal' in diff), 'el GET expone el regimen como `regimen`; compararlo contra cfdi_regimen_fiscal reportaba un rechazo que nunca ocurrio');
});

test('W3b: calcularDiffFiscal SI detecta un regimen distinto leido de `regimen`', () => {
  const cliente = { ...clienteOperamBase, cfdi_regimen_fiscal: undefined, regimen: '616' };
  const diff = calcularDiffFiscal(cliente, csfDatosIguales);
  assert.equal(diff.cfdi_regimen_fiscal.anterior, '616');
  assert.equal(diff.cfdi_regimen_fiscal.nuevo, '601');
});

test('W4: el payload del PUT verifica limpio contra el cliente tal como lo devuelve el GET', () => {
  const body = buildActualizarFiscalPayload(csfDatosIguales);
  const comoLoDevuelveElGet = { ...body, CustName: body.cust_name, regimen: body.cfdi_regimen_fiscal };
  const diff = calcularDiffFiscal(comoLoDevuelveElGet, csfDatosIguales);
  assert.deepEqual(diff, {}, 'lo que se manda al PUT debe verificar sin diferencias tras la relectura');
});

test('W5: camposNoAplicados reporta el campo que Operam NO devolvio en el eco, con el motivo', async () => {
  const { camposNoAplicados } = await import('../alta-logica.js');
  const diff = { CustName: { anterior: 'VIEJO', nuevo: 'Nuevo SA', label: 'Razon Social' } };
  const salida = camposNoAplicados(diff, { version: '3.26.32', tax_id: 'PNA010203ABC' });
  assert.equal(salida.length, 1);
  assert.equal(salida[0].campo, 'CustName');
  assert.equal(salida[0].nuevo, 'Nuevo SA');
  assert.match(salida[0].motivo, /Operam/, 'el vendedor debe leer el motivo real, no solo el campo');
});

test('W6: camposNoAplicados NO reporta un campo que Operam SI confirmo en el eco del PUT', async () => {
  const { camposNoAplicados } = await import('../alta-logica.js');
  // idcif no viene en el GET de detalle de Operam, asi que la relectura lo marca como
  // distinto aunque el PUT lo haya escrito: el eco es la unica confirmacion posible.
  const diff = { idcif: { anterior: '', nuevo: 'IDCIF123', label: 'IdCIF (SAT)' } };
  assert.deepEqual(camposNoAplicados(diff, { version: '3.26.32', idcif: 'IDCIF123' }), []);
});

test('W7: camposNoAplicados usa la llave de ESCRITURA para leer el eco (CustName -> cust_name)', async () => {
  const { camposNoAplicados } = await import('../alta-logica.js');
  const diff = { CustName: { anterior: 'VIEJO', nuevo: 'Nuevo SA', label: 'Razon Social' } };
  assert.deepEqual(camposNoAplicados(diff, { version: '3.26.32', cust_name: 'Nuevo SA' }), [],
    'el eco viene con la llave del body (cust_name), no con la del GET');
});

test('W8: camposNoAplicados sin eco utilizable reporta todo el diff (nada que absolver)', async () => {
  const { camposNoAplicados } = await import('../alta-logica.js');
  const diff = { CustName: { anterior: 'VIEJO', nuevo: 'Nuevo SA', label: 'Razon Social' } };
  assert.equal(camposNoAplicados(diff, null).length, 1);
  assert.equal(camposNoAplicados(diff, undefined).length, 1);
});

// #172: sondeo en vivo (clientes 491/492, Operam 3.26.32) confirmo que segmento_id NO
// persiste por ningun camino de la API v3 -- ni POST, ni PUT bundleado, ni PUT dedicado
// (a diferencia de dimension_id, que un PUT dedicado si corrige). El eco del PUT nunca
// trae segmento_id, asi que camposNoAplicados debe reportarlo SIEMPRE, incluso cuando
// el eco confirma el resto de los campos del mismo PUT.
test('W9: camposNoAplicados reporta segmento_id como no aplicado aunque el eco confirme otros campos del mismo PUT', async () => {
  const { camposNoAplicados } = await import('../alta-logica.js');
  const diff = {
    cust_ref: { anterior: 'Viejo', nuevo: 'Nuevo Corto', label: 'Nombre corto' },
    segmento_id: { anterior: '1', nuevo: '3', label: 'Segmento' },
  };
  const salida = camposNoAplicados(diff, { version: '3.26.32', cust_ref: 'Nuevo Corto' });
  assert.equal(salida.length, 1);
  assert.equal(salida[0].campo, 'segmento_id');
});

// === Configuracion comercial en el upgrade fiscal (issue #197) ===
// El vendedor VE la Seccion 2 durante el upgrade; hasta #197 lo que corrigiera ahi no
// viajaba (perdida silenciosa, misma clase que #193 arreglo para el alta). La lista de
// precios vive en `sales_type` del CLIENTE: verificado EN VIVO el 2026-08-19 con un GET
// read-only del cliente 491 -- llega como id plano en string ("15" = M100), la MISMA
// llave para leer y escribir (a diferencia de CustName/cust_name, #169), y el
// <option value> del selector ya es ese id (server.js expone {id, nombre} del catalogo).
// El mismo GET confirmo lo demas: `segmento` anidado, `invoice_email` AUSENTE de la
// lectura y `salesman_name` colgando de branches[0].

test('C1: buildActualizarFiscalPayload incluye sales_type cuando se capturo la lista de precios', () => {
  const body = buildActualizarFiscalPayload({ ...csfDatosIguales, salesType: '16' });
  assert.equal(body.sales_type, '16');
});

test('C2: buildActualizarFiscalPayload omite sales_type si no se capturo (ausente != vacio)', () => {
  const body = buildActualizarFiscalPayload(csfDatosIguales);
  assert.ok(!('sales_type' in body));
});

test('C3: calcularDiffFiscal compara la lista de precios contra sales_type, la llave real del GET', () => {
  const cliente = { ...clienteOperamBase, sales_type: '15' };
  const diff = calcularDiffFiscal(cliente, { ...csfDatosIguales, salesType: '16' });
  assert.equal(diff.sales_type.anterior, '15');
  assert.equal(diff.sales_type.nuevo, '16');
  assert.equal(diff.sales_type.label, 'Lista de precios');
});

test('C4: calcularDiffFiscal no reporta la lista de precios cuando el capturado es el que ya tiene el cliente', () => {
  const cliente = { ...clienteOperamBase, sales_type: '15' };
  const diff = calcularDiffFiscal(cliente, { ...csfDatosIguales, salesType: '15' });
  assert.ok(!('sales_type' in diff));
});

// Precarga de la Seccion 2 al abrir el upgrade (decision 1 de #197). Sin precarga la
// feature seria un arma: mandar los campos con su default pisaria datos reales del
// cliente. La forma del objeto es la del GET de detalle verificado en vivo.

test('C5: precargaComercialUpgrade lee la lista y el segmento con las llaves reales del GET', async () => {
  const { precargaComercialUpgrade } = await import('../alta-logica.js');
  const pre = precargaComercialUpgrade({
    customer_id: 491, sales_type: '15', segmento: { id: '3', clave: '003', description: 'Restaurantes' },
  });
  assert.equal(pre.salesType, '15');
  assert.equal(pre.segmentoId, '3');
});

test('C6: precargaComercialUpgrade deja el email de facturacion VACIO (el GET no lo expone; decision 1)', async () => {
  const { precargaComercialUpgrade } = await import('../alta-logica.js');
  // Ni siquiera cuando el objeto trae la llave: el GET de detalle no la devuelve
  // (verificado en vivo), asi que un valor ahi vendria de otra superficie y precargarlo
  // haria creer al vendedor que ese es el correo que Operam tiene guardado.
  const pre = precargaComercialUpgrade({ customer_id: 491, invoice_email: 'de-otro-lado@peltre.mx' });
  assert.equal(pre.invoiceEmail, '');
});

test('C7: precargaComercialUpgrade toma el vendedor de branches[0].salesman_name (solo para mostrar)', async () => {
  const { precargaComercialUpgrade } = await import('../alta-logica.js');
  const pre = precargaComercialUpgrade({
    customer_id: 491,
    branches: [{ branch_code: '535', salesman_name: 'Adrian Chavez' }],
  });
  assert.equal(pre.vendedorNombre, 'Adrian Chavez');
});

test('C8: precargaComercialUpgrade devuelve cadenas vacias (nunca undefined) cuando el cliente no trae esos campos', async () => {
  const { precargaComercialUpgrade } = await import('../alta-logica.js');
  const pre = precargaComercialUpgrade({ customer_id: 491 });
  assert.deepEqual(pre, { salesType: '', segmentoId: '', invoiceEmail: '', vendedorNombre: '' });
});

// Decision 2 de #197: del panel comercial solo viaja lo que CAMBIO respecto a lo
// precargado. Lo que no viaja no se escribe y no se verifica -- exactamente la
// semantica "ausente != vacio" que ya usa buildActualizarFiscalPayload.

const PRECARGA_491 = { salesType: '15', segmentoId: '3', invoiceEmail: '', vendedorNombre: 'Adrian Chavez' };

test('C9: sin tocar nada la Seccion 2, ningun campo comercial viaja en el upgrade', async () => {
  const { datosUpgradeConComercial } = await import('../alta-logica.js');
  const datos = datosUpgradeConComercial(csfDatosIguales, PRECARGA_491, { salesType: '15', segmentoId: '3', invoiceEmail: '' });
  assert.ok(!('salesType' in datos));
  assert.ok(!('segmentoId' in datos));
  assert.ok(!('invoiceEmail' in datos));
});

test('C10: cambiar la lista de precios la hace viajar, sin arrastrar los demas campos comerciales', async () => {
  const { datosUpgradeConComercial } = await import('../alta-logica.js');
  const datos = datosUpgradeConComercial(csfDatosIguales, PRECARGA_491, { salesType: '16', segmentoId: '3', invoiceEmail: '' });
  assert.equal(datos.salesType, '16');
  assert.ok(!('segmentoId' in datos));
  assert.ok(!('invoiceEmail' in datos));
  assert.equal(buildActualizarFiscalPayload(datos).sales_type, '16');
});

test('C11: escribir un email de facturacion lo hace viajar (la precarga siempre esta vacia)', async () => {
  const { datosUpgradeConComercial } = await import('../alta-logica.js');
  const datos = datosUpgradeConComercial(csfDatosIguales, PRECARGA_491, { salesType: '15', segmentoId: '3', invoiceEmail: 'facturacion@peltre.mx' });
  assert.equal(datos.invoiceEmail, 'facturacion@peltre.mx');
});

test('C12: cambiar el segmento lo hace viajar (y con el corre el post-fix web del segmento)', async () => {
  const { datosUpgradeConComercial } = await import('../alta-logica.js');
  const datos = datosUpgradeConComercial(csfDatosIguales, PRECARGA_491, { salesType: '15', segmentoId: '7', invoiceEmail: '' });
  assert.equal(datos.segmentoId, '7');
});

test('C13: vaciar un campo ya precargado NO viaja: una cadena vacia borraria en Operam un dato real', async () => {
  // El selector se repuebla desde el catalogo (altaEsperarCatalogosCompletos) y eso lo
  // resetea a "": si el vacio viajara, una carrera del catalogo le dejaria al cliente
  // la lista de precios en blanco sin que nadie lo pidiera.
  const { datosUpgradeConComercial } = await import('../alta-logica.js');
  const datos = datosUpgradeConComercial(csfDatosIguales, PRECARGA_491, { salesType: '', segmentoId: '', invoiceEmail: '' });
  assert.ok(!('salesType' in datos));
  assert.ok(!('segmentoId' in datos));
});

test('C14: sin precarga (el GET del cliente fallo) NO viaja nada comercial, aunque el panel traiga valores', async () => {
  const { datosUpgradeConComercial } = await import('../alta-logica.js');
  const datos = datosUpgradeConComercial(csfDatosIguales, null, { salesType: '16', segmentoId: '7', invoiceEmail: 'x@peltre.mx' });
  assert.ok(!('salesType' in datos));
  assert.ok(!('segmentoId' in datos));
  assert.ok(!('invoiceEmail' in datos));
});

test('C15: el segmento que el formulario ya traia NO se cuela cuando no cambio respecto a la precarga', async () => {
  // altaCsfLeerFormulario lee #alta-segmento SIEMPRE (lo necesita el alta), asi que sin
  // esta poda el upgrade seguiria mandando segmento_id en cada confirmacion.
  const { datosUpgradeConComercial } = await import('../alta-logica.js');
  const conSegmento = { ...csfDatosIguales, segmentoId: '3' };
  const datos = datosUpgradeConComercial(conSegmento, PRECARGA_491, { salesType: '15', segmentoId: '3', invoiceEmail: '' });
  assert.ok(!('segmentoId' in datos));
  assert.equal(datos.rfc, csfDatosIguales.rfc, 'los datos fiscales siguen intactos');
  assert.equal(datos.razonSocial, csfDatosIguales.razonSocial);
});

// Decision 7 de #197: la precarga es un DEFAULT, no captura -- no debe dejar un
// borrador espurio (#185) que la proxima visita restaure como si el vendedor lo
// hubiera tecleado. Lo que lo garantiza es estructural: la superficie del borrador del
// upgrade es #alta-body-1 (Seccion 1) y los campos que la precarga escribe viven en
// #alta-body-2, fuera de su alcance. Este test es la unica forma de que mover un campo
// de seccion no rompa esa garantia en silencio (el resto solo se ve en navegador: el
// upgrade ademas cierra el autoguardado de la superficie 'alta-completa', que SI
// envuelve al panel entero).
test('C16: los campos que precarga el upgrade viven fuera de #alta-body-1, la superficie de su borrador', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
  const inicio = html.indexOf('id="alta-body-1"');
  const fin = html.indexOf('id="alta-body-2"');
  assert.ok(inicio > 0 && fin > inicio, 'el panel debe seguir teniendo las dos secciones en ese orden');
  const seccion1 = html.slice(inicio, fin);
  assert.ok(seccion1.includes('id="csf-rfc"'), 'el recorte debe ser de verdad la Seccion 1 (si no, el test pasaria en vacio)');
  for (const id of ['alta-lista-precios', 'alta-segmento', 'alta-email-factura', 'alta-vendedor', 'alta-celular']) {
    assert.ok(!seccion1.includes(`id="${id}"`), `${id} no puede vivir dentro de #alta-body-1`);
    assert.ok(html.includes(`id="${id}"`), `${id} debe seguir existiendo en el panel`);
  }
});

test('C17: la precarga normaliza a texto lo que Operam entregue como numero (un 15 no debe verse como cambio contra "15")', async () => {
  const { precargaComercialUpgrade, datosUpgradeConComercial } = await import('../alta-logica.js');
  const pre = precargaComercialUpgrade({ sales_type: 15, segmento: { id: 3 } });
  assert.equal(pre.salesType, '15');
  const datos = datosUpgradeConComercial(csfDatosIguales, pre, { salesType: '15', segmentoId: '3', invoiceEmail: '' });
  assert.ok(!('salesType' in datos));
  assert.ok(!('segmentoId' in datos));
});

// Decision 4 de #197: en modo upgrade, vendedor y celular se ven pero NO se editan.
// El vendedor es campo de la SUCURSAL y PUT /branches es un REPLACE destructivo sobre
// sucursales ya configuradas (#189, danos reales en #195); el celular es la llave de
// identidad del prospecto. En modo ALTA los dos siguen capturandose como siempre.

test('C18: en modo upgrade el vendedor y el celular quedan deshabilitados, con nota corta cada uno', async () => {
  const { modoComercialUpgrade } = await import('../alta-logica.js');
  const modo = modoComercialUpgrade(500, 'Adrian Chavez');
  assert.equal(modo.bloqueado, true);
  assert.match(modo.vendedorNota, /Operam/, 'la nota debe decir donde SI se cambia');
  assert.match(modo.vendedorNota, /Adrian Chavez/, 'y mostrar el vendedor actual (solo lectura)');
  assert.match(modo.celularNota, /prospecto/i);
});

test('C19: en modo alta nada se bloquea y el email vuelve a su placeholder normal', async () => {
  const { modoComercialUpgrade } = await import('../alta-logica.js');
  const modo = modoComercialUpgrade(null, '');
  assert.equal(modo.bloqueado, false);
  assert.equal(modo.vendedorNota, '');
  assert.equal(modo.celularNota, '');
  assert.equal(modo.emailPlaceholder, 'facturacion@empresa.com');
});

test('C20: en modo upgrade el email de facturacion avisa que no es legible desde Operam (decision 1)', async () => {
  const { modoComercialUpgrade } = await import('../alta-logica.js');
  const modo = modoComercialUpgrade(500, '');
  assert.match(modo.emailPlaceholder, /no visible desde Operam/i);
  assert.equal(modo.vendedorNota.startsWith('--'), false, 'sin vendedor conocido, la nota no arranca con el separador huerfano');
});

// Tercer estado de la linea base (#197 sin romper #193): hay un camino al upgrade que
// NO pasa por el panel con precarga -- "Actualizar este" sobre un candidato generico
// (altaCandidatoActualizar, #78) entra con los datos que el vendedor capturo en el ALTA.
// Ahi el segmento SI es captura suya y tiene que viajar; podarlo por falta de linea base
// desharia el fix de #193. Por eso `undefined` (esta superficie no aporta configuracion
// comercial) es distinto de `null` (la precarga corrio y fallo: no hay con que comparar).
test('C21: sin panel comercial (precarga ausente, no fallida) los datos viajan tal cual, con el segmento capturado en el alta', async () => {
  const { datosUpgradeConComercial } = await import('../alta-logica.js');
  const datosDelAlta = { ...csfDatosIguales, segmentoId: '3' };
  const datos = datosUpgradeConComercial(datosDelAlta, undefined, { salesType: '', segmentoId: '', invoiceEmail: '' });
  assert.deepEqual(datos, datosDelAlta);
  assert.equal(buildActualizarFiscalPayload(datos).segmento_id, '3');
});
