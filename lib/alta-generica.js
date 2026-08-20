import { RFC_GENERICOS } from './deduplicacion.js';
import { nombrePropio } from './cruce-bitrix.js';

// Logica pura del alta temprana de cliente generico (issue #81, ADR-0006): decide
// cuando una cotizacion pertenece a una oportunidad SIN cliente en Operam y
// construye el payload del cliente generico. Sin IO; la orquestacion (dedup en
// capas, POST a Operam, persistencia, subida) vive en server.js
// (POST /api/cotizacion/operam/:id).

// Fuente distinguible en clientes_log para el alta generica automatica (las del
// alta manual son 'csf-upload' / 'cotizador').
export const FUENTE_ALTA_GENERICA = 'cotizador-generico';

// Fuente propia de la creacion de sucursal bajo un cliente existente (#211): no
// es un alta de cliente, asi que la auditoria tiene que poder distinguirla del
// alta generica para saber despues como crecieron las cuentas multi-plaza.
export const FUENTE_SUCURSAL_CREADA = 'sucursal-creada';

export function rfcGenericoPara(pais) {
  return !pais || pais === 'MX' ? 'XAXX010101000' : 'XEXX010101000';
}

// Sin cliente en Operam = sin id de cliente y sin RFC real resoluble. Un RFC
// generico capturado NO identifica (multiples clientes lo comparten, ADR-0001):
// resolverlo por RFC exacto subiria la cotizacion a cualquier generico existente.
// Ademas exige los datos minimos del contacto: sin nombre resoluble no hay con
// que crear ni deduplicar por nombre (tokens vacios siempre dan 'libre') y sin
// telefono no hay llave de dedup de capa 1 (celular) -- una cotizacion legacy sin
// esos datos toma el camino viejo, que responde su 422 claro sin efectos, en vez
// de crear un cliente fantasma.
export function necesitaAltaGenerica(entry) {
  const e = entry || {};
  const c = e.data?.cliente || {};
  if (c.customerId != null || c.operamId != null) return false;
  const rfc = String(c.rfc || '').toUpperCase().trim();
  if (rfc && !RFC_GENERICOS.has(rfc)) return false;
  const nombre = String(c.razonSocial || c.nombreCorto || e.cliente || '').trim();
  const telefono = String(c.telefono || '').trim();
  return nombre !== '' && telefono !== '';
}

// Lista de precios del cliente generico = tier de la cotizacion mapeado por
// nombre al catalogo de Operam. Si el tier no tiene lista homonima (p.ej.
// "Menudeo", que no existe en Operam) cae a "Precio de lista": omitir sales_type
// delega el default de Operam (M550), el peor caso para un cliente de menudeo
// (issue #92).
export function resolverSalesTypeId(tier, listasPrecios) {
  const listas = Array.isArray(listasPrecios) ? listasPrecios : [];
  return listas.find(l => l.nombre === tier)?.id ?? listas.find(l => l.nombre === 'Precio de lista')?.id;
}

// Payload para crearClienteDirecto: nombre real del contacto y vendedor real
// (ADR-0006); lista de precios = tier de la cotizacion mapeado al id numerico de
// Operam (la lista con la que se cotizo). El resto de defaults (uso CFDI S01,
// regimen 612, terminos de pago...) los aplica buildClienteBody, los mismos del
// alta actual. celular_nota lleva el celular a notes, como en el alta manual.
export function buildClienteGenerico(entry, { salesman, salesTypeId } = {}) {
  const c = entry.data?.cliente || {};
  const cliente = {
    tax_id: rfcGenericoPara(c.pais),
    CustName: c.razonSocial || c.nombreCorto || entry.cliente || '',
    pais: c.pais || 'MX',
    celular_nota: c.telefono || '',
  };
  if (c.nombreCorto) cliente.cust_ref = c.nombreCorto;
  if (c.telefono) cliente.phone = c.telefono;
  if (c.emailEntrega) cliente.email = c.emailEntrega;
  if (c.emailFactura) cliente.invoice_email = c.emailFactura;
  if (c.segmentoId) cliente.segmento_id = c.segmentoId;
  if (salesman != null) cliente.salesman = salesman;
  if (salesTypeId != null) cliente.sales_type = salesTypeId;
  return cliente;
}

// Domicilio de entrega del paso Envio -> body del PUT de branch (issue #96). El
// paso Envio captura MENOS campos que el alta completa: no hay br_ref ni numero
// exterior separado (la calle carga calle+numero, como en el quote). Se mapea SOLO
// lo que /api/crear-cliente ya lleva al branch; br_ref se omite para que Operam
// conserve la referencia que auto-creo en el POST. addr_reference viene de
// `referencias` (indicaciones de entrega), NO de `referencia` (el cust_ref del
// quote). El customer_id y los quirks location/ship_via/tax_group_id/sales_account
// del PUT los pone actualizarBranchCliente.
//
// Sin calle o sin CP no hay domicilio util: se omiten los campos addr_* (Operam
// conserva lo que auto-creo), pero SIEMPRE se devuelve un objeto -- nunca null
// (issue #189). El PUT debe correr igual porque tax_group_id/sales_account no
// dependen del domicilio sino del pais, y `pais` siempre viaja con el del CLIENTE
// (nunca el del domicilio, que el paso Envio no captura por separado): sin
// domicilio de entrega, esta es la inferencia decidida para saber si el cliente es
// gravado o exportacion (un extranjero que recibe en Mexico quedaria mal
// clasificado, pero es preferible al default fijo de Operam, siempre gravado).
//
// br_name SI se manda (issue #170): Operam auto-crea el branch copiando el
// CustName en MAYUSCULAS del cliente generico (#121) y nadie lo corregia despues.
// Este PUT es el primer momento en que el cotizador ya escribe sobre el branch, asi
// que corrige el nombre aqui en Title Case (misma regla de #159), priorizando el
// contacto de entrega capturado sobre el nombre del cliente.
export function buildBranchGenerico(cliente, { salesman } = {}) {
  const c = cliente || {};
  const calle = String(c.calle || '').trim();
  const cp = String(c.cpEntrega || '').trim();
  const nombreBranch = [c.nombreEntrega, c.nombreCorto, c.razonSocial]
    .map(v => String(v || '').trim())
    .find(Boolean) || '';
  const datos = { pais: c.pais || 'MX' };
  if (calle && cp) {
    datos.addr_street = calle;
    datos.addr_interior = c.numInt || '';
    datos.addr_colony = c.colonia || '';
    datos.addr_city = c.municipio || '';
    datos.addr_state = c.estado || '';
    datos.addr_zip = cp;
    datos.addr_reference = c.referencias || '';
    datos.phone = c.celEntrega || c.telefono || '';
    datos.email = c.emailEntrega || '';
  }
  if (nombreBranch) datos.br_name = nombrePropio(nombreBranch);
  if (salesman != null) datos.salesman = salesman;
  return datos;
}

// "Buscar antes de crear" de la sucursal (#211): devuelve la sucursal que este
// mismo camino ya creo en un intento anterior, o null. Sin esta busqueda un
// reintento puede dejar DOS sucursales identicas bajo el cliente: el POST pudo
// escribir en Operam y fallar despues (la relectura no la vio -- el quirk #74
// que motiva releer -- o la persistencia del branchId no alcanzo a correr), y
// entonces el reintento entra sin nada que reusar.
//
// La llave es nombre MAS domicilio (calle + CP), que es lo unico que identifica
// a la sucursal que ibamos a crear. Solo el nombre no basta (una plaza nueva
// puede llamarse igual que la matriz y seria un falso positivo que manda el
// quote al domicilio equivocado); solo el domicilio tampoco (sin calle/CP
// capturados buildBranchGenerico omite los addr_*, y todas las sucursales sin
// domicilio se verian iguales). Un empate en las tres es, por construccion, la
// misma sucursal.
export function sucursalEquivalente(branches, datos) {
  const norm = v => String(v ?? '').trim().toLowerCase();
  const nombre = norm(datos?.br_name);
  if (!nombre) return null;
  return (branches || []).find(b =>
    norm(b?.br_name) === nombre
    && norm(b?.addr_street) === norm(datos?.addr_street)
    && norm(b?.addr_zip) === norm(datos?.addr_zip)
  ) || null;
}

// Campos verificables del branch (label para el reporte). Se comparan tras el PUT.
// br_name entra aqui (#170): el mismo quirk que motiva esta verificacion (Operam
// ignora campos en silencio, #74) es el que dejo el nombre del branch en MAYUSCULAS
// sin corregir -- sin verificarlo, la correccion podria fallar callada otra vez.
const CAMPOS_BRANCH = [
  ['br_name', 'Nombre'],
  ['addr_street', 'Calle'], ['addr_interior', 'Numero interior'], ['addr_colony', 'Colonia'],
  ['addr_city', 'Municipio'], ['addr_state', 'Estado'], ['addr_zip', 'CP'],
  ['addr_reference', 'Referencias'], ['phone', 'Telefono'], ['email', 'Email'],
];

// Verificacion post-PUT (#96, quirk #74): Operam responde result:true aunque ignore
// campos. Compara el branch releido contra lo enviado y devuelve SOLO los que se
// intentaron escribir (no vacios) y no coinciden.
export function diffBranchDomicilio(branchFresco, enviado) {
  const b = branchFresco || {};
  const e = enviado || {};
  const out = [];
  for (const [campo, label] of CAMPOS_BRANCH) {
    const nuevo = String(e[campo] ?? '').trim();
    if (!nuevo) continue;
    if (String(b[campo] ?? '').trim() !== nuevo) {
      out.push({ campo, label, anterior: b[campo] ?? '', nuevo });
    }
  }
  return out;
}
