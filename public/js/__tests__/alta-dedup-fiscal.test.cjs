'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let calcularDiffFiscal;
let buildDiffFiscalHtml;
let buildDedupExactoConDiffHtml;
let buildActualizarFiscalPayload;
let buildCandidatosRfcGenericoHtml;
let buildNotasConTaxId;
before(async () => {
  ({ calcularDiffFiscal, buildDiffFiscalHtml, buildDedupExactoConDiffHtml, buildActualizarFiscalPayload, buildCandidatosRfcGenericoHtml, buildNotasConTaxId } = await import('../alta-logica.js'));
});

// === calcularDiffFiscal ===
// Compara los datos fiscales de la CSF recien subida (formato altaState.datos)
// contra el cliente ya guardado en Operam (formato crudo de /api/buscar-cliente-duplicado).
// El diff resultante usa NOMBRES DE CAMPO DE OPERAM como llave (CustName, tax_id, street, ...)
// porque actualizarCliente(id, diff) hace body[fieldId] = nuevo y lo manda directo al PUT
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
  assert.equal(body.CustName, 'Peltre Nacional SA de CV');
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

test('U4: buildActualizarFiscalPayload es simetrico con calcularDiffFiscal: el diff contra el payload aplicado es vacio', () => {
  const body = buildActualizarFiscalPayload(csfDatosIguales);
  const diff = calcularDiffFiscal(body, csfDatosIguales);
  assert.deepEqual(diff, {}, 'lo que se manda al PUT debe verificar sin diferencias');
});

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

// === Regla 6 (issue #95): segmento_id viaja en el upgrade, con verificacion post-escritura ===
// Quirk documentado (#74/CLAUDE.md): PUT customers puede ignorar segmento_id en
// silencio. Al agregarlo a DIFF_FISCAL_CAMPOS, calcularDiffFiscal lo verifica
// GRATIS via el mismo mecanismo generico que ya usa el endpoint de upgrade para
// camposNoActualizados (#85/#96) -- no requiere codigo nuevo en server.js.

test('R11: buildActualizarFiscalPayload incluye segmento_id cuando se capturo', () => {
  const body = buildActualizarFiscalPayload({ ...csfDatosIguales, segmentoId: '3' });
  assert.equal(body.segmento_id, '3');
});

test('R12: buildActualizarFiscalPayload omite segmento_id si no se capturo', () => {
  const body = buildActualizarFiscalPayload(csfDatosIguales);
  assert.ok(!('segmento_id' in body));
});

test('R13: calcularDiffFiscal detecta el quirk -- Operam ignoro segmento_id (el releido sigue con el valor viejo)', () => {
  const clienteReleido = { ...clienteOperamBase, segmento_id: '1' }; // valor viejo, PUT lo ignoro
  const diff = calcularDiffFiscal(clienteReleido, { ...csfDatosIguales, segmentoId: '3' });
  assert.equal(diff.segmento_id.anterior, '1');
  assert.equal(diff.segmento_id.nuevo, '3');
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
