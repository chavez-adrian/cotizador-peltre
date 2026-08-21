import { test } from 'node:test';
import assert from 'node:assert/strict';

import { aFormatoWhatsApp, nombreVisible, planificarContactos, MASCARAS } from '../lib/contactos-logica.js';

// El formato MEDIDO en el dispositivo (#226, 2026-08-21): E.164 limpio, +52 y
// los diez digitos, SIN el "1". Contradice la documentacion de WhatsApp y el
// comportamiento observado manda. Estas pruebas son el punto unico de cambio si
// algun dia WhatsApp cambia: si cambia, cambia esta funcion y estas lineas.
test('el celular mexicano se escribe +52 y diez digitos, sin el "1"', () => {
  assert.equal(aFormatoWhatsApp('+52 5512345678'), '+525512345678');
});

test('un celular guardado con el "1" de WhatsApp pierde ese "1"', () => {
  assert.equal(aFormatoWhatsApp('+52 1 55 1234 5678'), '+525512345678');
});

test('un celular de otro pais conserva su codigo tal cual', () => {
  assert.equal(aFormatoWhatsApp('+1 212 555 0134'), '+12125550134');
});

test('un celular sin codigo de pais se asume mexicano', () => {
  assert.equal(aFormatoWhatsApp('5512345678'), '+525512345678');
});

test('sin celular no hay nada que escribir', () => {
  assert.equal(aFormatoWhatsApp(''), '');
  assert.equal(aFormatoWhatsApp(null), '');
});

// El nombre visible se lee "Persona - Empresa" (CONTEXT.md "Contacto de
// Google"): WhatsApp muestra SOLO el nombre, nunca la organizacion, y lo corta
// alrededor de los 25 caracteres, asi que la persona va primero.
test('el nombre visible pone la persona primero y la empresa despues', () => {
  assert.equal(
    nombreVisible({ persona: 'Laura Mendez', empresa: 'Cocinas del Valle' }),
    'Laura Mendez - Cocinas del Valle'
  );
});

test('sin empresa declarada, la ciudad da el contexto', () => {
  assert.equal(
    nombreVisible({ persona: 'Laura Mendez', ciudad: 'Puebla' }),
    'Laura Mendez - Puebla'
  );
});

test('la empresa gana a la ciudad cuando existen las dos', () => {
  assert.equal(
    nombreVisible({ persona: 'Laura Mendez', empresa: 'Cocinas del Valle', ciudad: 'Puebla' }),
    'Laura Mendez - Cocinas del Valle'
  );
});

test('sin empresa ni ciudad queda el nombre de la persona solo', () => {
  assert.equal(nombreVisible({ persona: 'Laura Mendez' }), 'Laura Mendez');
});

test('sin persona el nombre cae a la empresa, nunca a una cadena vacia', () => {
  assert.equal(nombreVisible({ empresa: 'Cocinas del Valle', ciudad: 'Puebla' }), 'Cocinas del Valle');
  assert.equal(nombreVisible({ ciudad: 'Puebla' }), 'Puebla');
});

// --- Tres defectos hallados en la primera carga real (#247, hijo de #224) ---

// Defecto 1: el contacto General de Operam suele llevar como nombre el de la
// empresa (ct.name == cust_ref), y componer "Persona - Empresa" con la misma
// cadena dos veces produce "Ajijic Spot - Ajijic Spot".
test('persona y empresa iguales colapsan a una sola aparicion', () => {
  assert.equal(nombreVisible({ persona: 'Ajijic Spot', empresa: 'Ajijic Spot' }), 'Ajijic Spot');
});

test('persona y empresa iguales salvo mayusculas/acentos/espacios tambien colapsan', () => {
  assert.equal(nombreVisible({ persona: 'AJIJIC SPOT', empresa: 'Ajijic Spot' }), 'Ajijic Spot');
  assert.equal(nombreVisible({ persona: 'El Pendulo', empresa: '  EL  PENDULO ' }), 'El Pendulo');
  assert.equal(nombreVisible({ persona: 'Jose Perez', empresa: 'JOSE PEREZ' }), 'Jose Perez');
});

test('persona y ciudad iguales tambien colapsan (vale para cualquier fuente)', () => {
  assert.equal(nombreVisible({ persona: 'Puebla', ciudad: 'PUEBLA' }), 'Puebla');
});

// Defecto 2: aFormatoWhatsApp no aplicaba el recorte de extension de ultimos10
// y escribia el numero de extension pegado al celular (#247, ejemplos reales
// del CSV: +525553952615116, +527773124849111).
test('la extension se recorta igual que en ultimos10, antes de formatear', () => {
  assert.equal(aFormatoWhatsApp('55 5395 2615 ext 116'), '+525553952615');
  assert.equal(aFormatoWhatsApp('5553952615,116'), '+525553952615');
});

test('un celular extranjero no cambia por el recorte de extension', () => {
  assert.equal(aFormatoWhatsApp('+1 212 555 0134'), '+12125550134');
  assert.equal(aFormatoWhatsApp('+507 6000-1234'), '+50760001234');
});

// Defecto 3: la persona en MAYUSCULAS grita ("BRENDA GARCIA", "ALEJANDRA
// VAZQUEZ - MAG IMPRESIONES"). Se normaliza a Titulo con el mismo criterio que
// referencia-cliente.js; un nombre ya en mixto no se toca; la organizacion no
// se toca por este ticket.
test('la persona toda en mayusculas se normaliza a Titulo', () => {
  assert.equal(nombreVisible({ persona: 'BRENDA GARCIA', empresa: 'Cocinas del Valle' }),
    'Brenda Garcia - Cocinas del Valle');
});

test('un nombre ya en mixto no se toca', () => {
  assert.equal(nombreVisible({ persona: 'Brenda Garcia', empresa: 'Cocinas del Valle' }),
    'Brenda Garcia - Cocinas del Valle');
  assert.equal(nombreVisible({ persona: 'BGE Esquivel', empresa: 'Cocinas del Valle' }),
    'BGE Esquivel - Cocinas del Valle');
});

test('la organizacion no se toca aunque venga en mayusculas', () => {
  assert.equal(nombreVisible({ persona: 'ALEJANDRA VAZQUEZ', empresa: 'MAG IMPRESIONES' }),
    'Alejandra Vazquez - MAG IMPRESIONES');
});

// Tokens cortos (#247): en la PERSONA no hay excepcion para siglas de 3 letras.
// Medido en la primera carga real: los tokens cortos en mayusculas eran nombres
// de pila y abreviaturas ("DAN", "MA."), no siglas comerciales. Una sigla que
// venga en el campo de persona se titula como palabra; es el precio de no dejar
// "ANA LOPEZ" gritando.
test('un token corto dentro de la persona se titula como palabra', () => {
  assert.equal(nombreVisible({ persona: 'MAG IMPRESIONES', empresa: 'Cocinas del Valle' }),
    'Mag Impresiones - Cocinas del Valle');
});

test('una inicial con punto se conserva, el apellido se titula', () => {
  assert.equal(nombreVisible({ persona: 'J. LOPEZ', empresa: 'Cocinas del Valle' }),
    'J. Lopez - Cocinas del Valle');
});

test('un nombre de pila corto en mayusculas se titula como cualquier otro', () => {
  assert.equal(nombreVisible({ persona: 'ANA LOPEZ', empresa: 'Cocinas del Valle' }),
    'Ana Lopez - Cocinas del Valle');
  assert.equal(nombreVisible({ persona: 'MA. ELENA RUIZ', empresa: 'Cocinas del Valle' }),
    'Ma. Elena Ruiz - Cocinas del Valle');
});

// La huella de una ficha afectada por cualquiera de los tres defectos cambia:
// un mapeo con la huella del formato viejo produce 'actualizar' en la siguiente
// pasada, y asi el barrido corrige solas las 140 fichas ya escritas en
// produccion sin intervencion manual.
test('una ficha afectada por los tres defectos cambia de huella y el plan la actualiza', () => {
  const conDefectos = {
    id: 40, celular: '55 5395 2615 ext 116', nombre: 'BRENDA GARCIA', ciudad: 'BRENDA GARCIA',
    etapa: 'por_cotizar', data: {},
  };
  const mapeo = [{
    celular10: '5553952615', resourceName: 'people/c40', etag: 'e40',
    clase: 'propio', huella: 'huella-del-formato-viejo',
  }];
  const plan = planificarContactos({ prospectos: [conDefectos], mapeo });
  assert.equal(plan.crear.length, 0, 'no se crea una segunda ficha para el mismo celular');
  assert.equal(plan.actualizar.length, 1);
  assert.equal(plan.actualizar[0].ficha.nombreVisible, 'Brenda Garcia');
  assert.equal(plan.actualizar[0].ficha.telefono, '+525553952615');
});

// --- El plan de escrituras (nucleo puro, objetos literales, sin red) ---

const PROSPECTO = {
  id: 12, celular: '+52 5512345678', nombre: 'Laura Mendez', ciudad: 'Puebla',
  etapa: 'por_cotizar', data: { empresa: 'Cocinas del Valle', correo: 'laura@cocinas.mx' },
};

function fichaCreada(plan) {
  assert.equal(plan.crear.length, 1);
  return plan.crear[0].ficha;
}

test('un prospecto que la libreta no conoce entra en la lista de crear', () => {
  const plan = planificarContactos({ prospectos: [PROSPECTO], mapeo: [] });
  const ficha = fichaCreada(plan);
  assert.equal(ficha.nombreVisible, 'Laura Mendez - Cocinas del Valle');
  assert.equal(ficha.telefono, '+525512345678');
  assert.equal(ficha.correo, 'laura@cocinas.mx');
  assert.equal(plan.actualizar.length, 0);
});

test('la ficha se identifica por el celular normalizado, no por lo que se escribe en Google', () => {
  const ficha = fichaCreada(planificarContactos({ prospectos: [PROSPECTO], mapeo: [] }));
  assert.equal(ficha.celular10, '5512345678');
});

test('el prospecto sin correo produce ficha igual, sin correo', () => {
  const sinCorreo = { ...PROSPECTO, data: { empresa: 'Cocinas del Valle' } };
  const ficha = fichaCreada(planificarContactos({ prospectos: [sinCorreo], mapeo: [] }));
  assert.equal(ficha.correo, '');
});

test('un prospecto descartado (No util) o perdido tambien produce contacto', () => {
  for (const etapa of ['no_util', 'perdida']) {
    const plan = planificarContactos({ prospectos: [{ ...PROSPECTO, etapa }], mapeo: [] });
    assert.equal(plan.crear.length, 1, `etapa ${etapa}`);
  }
});

test('un prospecto sin celular utilizable no produce escritura', () => {
  const plan = planificarContactos({ prospectos: [{ ...PROSPECTO, celular: '' }], mapeo: [] });
  assert.equal(plan.crear.length, 0);
  assert.equal(plan.actualizar.length, 0);
});

test('la segunda pasada sobre el mismo estado no escribe nada', () => {
  const primera = planificarContactos({ prospectos: [PROSPECTO], mapeo: [] });
  // El mapeo que la envoltura habria persistido tras aplicar la primera pasada.
  const mapeo = [{
    celular10: '5512345678', resourceName: 'people/c1', etag: 'e1',
    clase: 'propio', huella: primera.crear[0].huella,
  }];
  const segunda = planificarContactos({ prospectos: [PROSPECTO], mapeo });
  assert.equal(segunda.crear.length, 0);
  assert.equal(segunda.actualizar.length, 0);
});

test('cambiar el formato del telefono ACTUALIZA la ficha existente, no la duplica', () => {
  // Ficha creada con un formato viejo (con el "1"): misma llave, otra huella.
  const mapeo = [{
    celular10: '5512345678', resourceName: 'people/c1', etag: 'e1',
    clase: 'propio', huella: 'huella-del-formato-viejo',
  }];
  const plan = planificarContactos({ prospectos: [PROSPECTO], mapeo });
  assert.equal(plan.crear.length, 0, 'no se crea una segunda ficha para el mismo celular');
  assert.equal(plan.actualizar.length, 1);
  assert.equal(plan.actualizar[0].resourceName, 'people/c1');
  assert.equal(plan.actualizar[0].etag, 'e1');
  assert.equal(plan.actualizar[0].ficha.telefono, '+525512345678');
});

test('la ficha propia se reescribe entera: su mascara nombra todos los campos', () => {
  const mapeo = [{ celular10: '5512345678', resourceName: 'people/c1', etag: 'e1', clase: 'propio', huella: 'vieja' }];
  const plan = planificarContactos({ prospectos: [PROSPECTO], mapeo });
  assert.deepEqual(
    [...plan.actualizar[0].mascara].sort(),
    ['correo', 'nombreVisible', 'organizacion', 'origen', 'telefono']
  );
});

test('un celular que desaparece del origen no produce borrado: el plan no tiene por donde borrar', () => {
  const mapeo = [{ celular10: '5512345678', resourceName: 'people/c1', etag: 'e1', clase: 'propio', huella: 'x' }];
  const plan = planificarContactos({ prospectos: [], mapeo });
  assert.deepEqual(Object.keys(plan).sort(), ['actualizar', 'crear', 'errores', 'inactivar'],
    'ninguna lista de borrado: lo que pierde respaldo se inactiva (#231), jamas se elimina');
  assert.equal(plan.crear.length, 0);
  assert.equal(plan.actualizar.length, 0);
});

test('una ficha de clase que aun no sabemos escribir no se toca (ADR-0013)', () => {
  // El fallo caro es pisar un contacto ajeno con la mascara ancha del propio.
  // La clase de ejemplo es la que #231 traera; 'adoptado' dejo de servir aqui
  // cuando #229 le registro mascara, y esa es exactamente la garantia: mientras
  // una clase no tenga mascara registrada, no se escribe.
  const mapeo = [{ celular10: '5512345678', resourceName: 'people/c1', etag: 'e1', clase: 'inactivo', huella: 'vieja' }];
  const plan = planificarContactos({ prospectos: [PROSPECTO], mapeo });
  assert.equal(plan.crear.length, 0);
  assert.equal(plan.actualizar.length, 0);
});

// --- Los clientes de Operam como segunda fuente (#228) ---
//
// Cada entrada de `clientes` es UN TELEFONO con su procedencia, no un cliente:
// la produce enumerarTelefonosClientes (lib/indice-telefonos.js), que es quien
// conoce la forma de Operam. Aqui no se sabe que existen CustName, br_name ni
// action.
const TELEFONO_CLIENTE = {
  customerId: '101', nombreCorto: 'Cocinas del Valle',
  razonSocial: 'COCINAS DEL VALLE SA DE CV',
  telefono: '+52 55 4444 1111', persona: 'Laura Mendez', rol: 'general',
  correo: 'laura@cocinas.mx', domicilio: '', fuente: 'contacto',
};

test('un Contacto de cliente produce ficha con la persona y el nombre corto', () => {
  const plan = planificarContactos({ clientes: [TELEFONO_CLIENTE], mapeo: [] });
  const ficha = fichaCreada(plan);
  assert.equal(ficha.nombreVisible, 'Laura Mendez - Cocinas del Valle');
  assert.equal(ficha.telefono, '+525544441111');
  assert.equal(ficha.correo, 'laura@cocinas.mx');
  assert.equal(ficha.organizacion, 'Cocinas del Valle');
});

// La precedencia de ADR-0013, y es la INVERSA de la que usa la clasificacion de
// un celular contra el embudo (lib/clasificar-celular.js). Alla la pregunta es
// "ya lo conozco?" y conviene empezar por la fuente barata; aqui es "que
// etiqueta describe mejor a esta persona?", y la respuesta es la que trae
// nombre comercial real en lugar de una ciudad. Quien la "corrija" que lea
// ADR-0013 antes.
test('un celular que es prospecto vivo Y cliente produce UNA ficha, la del cliente', () => {
  const mismoCelular = { ...TELEFONO_CLIENTE, telefono: '+52 55 1234 5678' };
  const plan = planificarContactos({ prospectos: [PROSPECTO], clientes: [mismoCelular], mapeo: [] });
  assert.equal(plan.crear.length, 1, 'una sola ficha para el celular compartido');
  assert.equal(plan.crear[0].ficha.nombreVisible, 'Laura Mendez - Cocinas del Valle');
  assert.equal(plan.crear[0].ficha.origen, 'cotizador:cliente:101', 'gana el cliente');
});

// El nombre fiscal en MAYUSCULAS del SAT es ilegible en una lista de chats
// ("COCINAS DEL VALLE SA DE CV"), pero es lo unico que queda cuando el cliente
// no tiene nombre corto: se normaliza a forma legible en vez de dejarse fuera.
test('un cliente sin nombre corto cae a la razon social legible, nunca a vacio', () => {
  const sinNombreCorto = { ...TELEFONO_CLIENTE, nombreCorto: '' };
  const ficha = fichaCreada(planificarContactos({ clientes: [sinNombreCorto], mapeo: [] }));
  assert.equal(ficha.nombreVisible, 'Laura Mendez - Cocinas del Valle SA de CV');
  assert.equal(ficha.organizacion, 'Cocinas del Valle SA de CV');
});

test('un cliente sin nombre corto NI razon social sigue mostrando a la persona', () => {
  const pelado = { ...TELEFONO_CLIENTE, nombreCorto: '', razonSocial: '' };
  const ficha = fichaCreada(planificarContactos({ clientes: [pelado], mapeo: [] }));
  assert.equal(ficha.nombreVisible, 'Laura Mendez');
});

test('un cliente sin persona, sin nombre corto y sin razon social se nombra por su id', () => {
  // "Nunca una cadena vacia" no puede depender de que Operam siempre traiga
  // razon social: un contacto General sin nombre en un cliente sin ningun nombre
  // dejaria la ficha sin nombre visible, que es justo lo prohibido.
  const anonimo = { ...TELEFONO_CLIENTE, persona: '', rol: 'general', nombreCorto: '', razonSocial: '' };
  const ficha = fichaCreada(planificarContactos({ clientes: [anonimo], mapeo: [] }));
  assert.equal(ficha.nombreVisible, 'Cliente 101');
});

// El telefono de un domicilio de entrega muchas veces no trae persona: trae el
// nombre del lugar ("Almacen Norte", "Recepcion"), que dice mas que cualquier
// etiqueta generica sobre quien contesta ese numero.
const TELEFONO_DOMICILIO = {
  customerId: '101', nombreCorto: 'Cocinas del Valle', razonSocial: 'COCINAS DEL VALLE SA DE CV',
  telefono: '55 7777 2222', persona: '', rol: '', correo: '',
  domicilio: 'Almacen Norte', fuente: 'domicilio',
};

test('el telefono de un domicilio de entrega tambien produce ficha', () => {
  const conPersona = { ...TELEFONO_DOMICILIO, persona: 'Beto Ramos' };
  const ficha = fichaCreada(planificarContactos({ clientes: [conPersona], mapeo: [] }));
  assert.equal(ficha.nombreVisible, 'Beto Ramos - Cocinas del Valle');
  assert.equal(ficha.telefono, '+525577772222');
});

test('un domicilio sin persona se identifica por el nombre del domicilio', () => {
  const ficha = fichaCreada(planificarContactos({ clientes: [TELEFONO_DOMICILIO], mapeo: [] }));
  assert.equal(ficha.nombreVisible, 'Almacen Norte - Cocinas del Valle');
});

test('un domicilio sin persona ni nombre queda como Entregas, nunca como la empresa sola', () => {
  // Quien contesta el WhatsApp tiene que poder distinguir este numero del de
  // quien compra: no es "la empresa", es el numero al que se entrega.
  const anonimo = { ...TELEFONO_DOMICILIO, domicilio: '' };
  const ficha = fichaCreada(planificarContactos({ clientes: [anonimo], mapeo: [] }));
  assert.equal(ficha.nombreVisible, 'Entregas - Cocinas del Valle');
});

test('un Contacto de cliente sin nombre se identifica por su tipo', () => {
  // El glosario ya lo dice: del contacto de facturacion a menudo solo se conoce
  // el correo, y su nombre se registra como "Facturacion".
  const facturacion = { ...TELEFONO_CLIENTE, persona: '', rol: 'invoice', correo: 'pagos@cocinas.mx' };
  assert.equal(
    fichaCreada(planificarContactos({ clientes: [facturacion], mapeo: [] })).nombreVisible,
    'Facturacion - Cocinas del Valle'
  );
  const entregas = { ...TELEFONO_CLIENTE, persona: '', rol: 'delivery' };
  assert.equal(
    fichaCreada(planificarContactos({ clientes: [entregas], mapeo: [] })).nombreVisible,
    'Entregas - Cocinas del Valle'
  );
});

test('un prospecto que se vuelve cliente CORRIGE su ficha, no la duplica', () => {
  // El caso que produce el propio pipeline: el prospecto convertido no sale del
  // seguimiento, asi que sigue vivo en las dos fuentes. Misma llave (el celular
  // normalizado), otra huella.
  const primera = planificarContactos({ prospectos: [PROSPECTO], mapeo: [] });
  const mapeo = [{
    celular10: '5512345678', resourceName: 'people/c1', etag: 'e1',
    clase: 'propio', huella: primera.crear[0].huella,
  }];
  const yaCliente = { ...TELEFONO_CLIENTE, telefono: '+52 55 1234 5678' };
  const segunda = planificarContactos({ prospectos: [PROSPECTO], clientes: [yaCliente], mapeo });
  assert.equal(segunda.crear.length, 0);
  assert.equal(segunda.actualizar.length, 1);
  assert.equal(segunda.actualizar[0].resourceName, 'people/c1');
  assert.equal(segunda.actualizar[0].ficha.origen, 'cotizador:cliente:101');
});

test('dos pasadas seguidas con clientes no escriben nada la segunda', () => {
  const primera = planificarContactos({ clientes: [TELEFONO_CLIENTE], mapeo: [] });
  const mapeo = [{
    celular10: '5544441111', resourceName: 'people/c1', etag: 'e1',
    clase: 'propio', huella: primera.crear[0].huella,
  }];
  const segunda = planificarContactos({ clientes: [TELEFONO_CLIENTE], mapeo });
  assert.equal(segunda.crear.length, 0);
  assert.equal(segunda.actualizar.length, 0);
});

test('un telefono de cliente que no arma celular no produce escritura', () => {
  const corto = { ...TELEFONO_CLIENTE, telefono: '12345' };
  const plan = planificarContactos({ clientes: [corto], mapeo: [] });
  assert.equal(plan.crear.length, 0);
  assert.equal(plan.actualizar.length, 0);
});

test('un Contacto general sin nombre deja la empresa sola: inventarle un rol seria mentir', () => {
  const general = { ...TELEFONO_CLIENTE, persona: '', rol: 'general' };
  assert.equal(
    fichaCreada(planificarContactos({ clientes: [general], mapeo: [] })).nombreVisible,
    'Cocinas del Valle'
  );
});

// --- Adopcion de contactos que ya estaban en la libreta (#229) ---
//
// `libreta` es lo que Google devuelve hoy, leido por la envoltura: una lista de
// { resourceName, etag, telefonos[] } con los telefonos CRUDOS, en el formato en
// que una persona los guardo a mano. Aqui solo se comparan por sus ultimos10.

const EN_LA_LIBRETA = {
  resourceName: 'people/c9', etag: 'etag-9',
  telefonos: ['+52 55 1234 5678'],
};

test('un celular que ya tenia contacto en la libreta NO produce una segunda ficha', () => {
  const plan = planificarContactos({
    prospectos: [PROSPECTO], mapeo: [], libreta: [EN_LA_LIBRETA],
  });
  assert.equal(plan.crear.length, 0, 'crear una segunda ficha del mismo numero es el bug');
  assert.equal(plan.actualizar.length, 1);
  assert.equal(plan.actualizar[0].clase, 'adoptado');
  assert.equal(plan.actualizar[0].resourceName, 'people/c9');
  assert.equal(plan.actualizar[0].etag, 'etag-9');
});

test('el contacto adoptado pasa a mostrar el nombre canonico del sistema', () => {
  const plan = planificarContactos({
    prospectos: [PROSPECTO], mapeo: [], libreta: [{ ...EN_LA_LIBRETA, telefonos: ['5512345678'] }],
  });
  assert.equal(plan.actualizar[0].ficha.nombreVisible, 'Laura Mendez - Cocinas del Valle');
});

// =========================================================================
// CANDADO ADR-0013. Esta prueba no es un caso mas de la tabla: es lo unico que
// impide reintroducir un borrado silencioso de datos ajenos.
//
// La actualizacion de la People API REEMPLAZA los campos que nombra la mascara
// en vez de fusionarlos. Si alguien "simplifica" unificando esta mascara con la
// del propio -- o le agrega `telefono` para que la ficha quede completa -- el
// barrido pasara a borrar, en cada contacto adoptado, todo telefono, correo y
// direccion que una persona guardo a mano y que no sea el que nosotros
// escribimos. Cada quince minutos. Indefinidamente. Sin error, sin log y sin
// forma practica de deshacerlo (la ventana de deshacer de Google revierte la
// libreta ENTERA a un instante, no un contacto suelto).
//
// Si esta prueba falla, la respuesta correcta NO es actualizarla.
// =========================================================================
test('CANDADO ADR-0013: la mascara de un adoptado nunca incluye telefono, correo ni direcciones', () => {
  const prohibidos = ['telefono', 'correo', 'direccion', 'direcciones'];
  for (const campo of prohibidos) {
    assert.equal(MASCARAS.adoptado.includes(campo), false,
      `la mascara del adoptado no puede nombrar "${campo}": nombrarlo lo BORRA`);
  }
  assert.deepEqual(MASCARAS.adoptado, ['nombreVisible', 'organizacion', 'origen']);

  // Y lo mismo sobre la entrada del plan, que es lo que de verdad viaja a
  // Google: la mascara del modulo podria estar bien y la del plan no.
  const plan = planificarContactos({
    prospectos: [PROSPECTO], mapeo: [], libreta: [EN_LA_LIBRETA],
  });
  const adoptado = plan.actualizar[0];
  assert.equal(adoptado.clase, 'adoptado');
  for (const campo of prohibidos) {
    assert.equal(adoptado.mascara.includes(campo), false,
      `el plan no puede mandar "${campo}" en la mascara de un adoptado`);
  }
});

test('una ficha propia SI se escribe completa, como hasta ahora', () => {
  // El candado es del adoptado y solo del adoptado: al propio lo creo la
  // sincronizacion y no hay nada humano que preservar ahi.
  const plan = planificarContactos({ prospectos: [PROSPECTO], mapeo: [], libreta: [] });
  assert.deepEqual([...plan.crear[0].mascara].sort(),
    ['correo', 'nombreVisible', 'organizacion', 'origen', 'telefono']);
});

test('la clase persistida manda: un adoptado sigue adoptado aunque se relea la libreta', () => {
  const mapeo = [{
    celular10: '5512345678', resourceName: 'people/c9', etag: 'etag-9',
    clase: 'adoptado', huella: 'de-otra-pasada',
  }];
  const plan = planificarContactos({ prospectos: [PROSPECTO], mapeo, libreta: [EN_LA_LIBRETA] });
  assert.equal(plan.actualizar.length, 1);
  assert.equal(plan.actualizar[0].clase, 'adoptado');
  assert.deepEqual(plan.actualizar[0].mascara, MASCARAS.adoptado);
});

test('la clase persistida manda: un propio NO se degrada a adoptado por estar en la libreta', () => {
  // Un propio esta en la libreta por definicion: lo creamos nosotros. Si la
  // clase se recalculara mirando Google, la segunda pasada convertiria todo
  // propio en adoptado y dejaria de corregirle el telefono para siempre.
  const mapeo = [{
    celular10: '5512345678', resourceName: 'people/c1', etag: 'e1',
    clase: 'propio', huella: 'vieja',
  }];
  const plan = planificarContactos({ prospectos: [PROSPECTO], mapeo, libreta: [EN_LA_LIBRETA] });
  assert.equal(plan.actualizar[0].clase, 'propio');
  assert.equal(plan.actualizar[0].resourceName, 'people/c1', 'manda el mapeo, no la libreta');
  assert.ok(plan.actualizar[0].mascara.includes('telefono'));
});

test('la huella del adoptado se calcula sobre su mascara corta: la segunda pasada no escribe', () => {
  const primera = planificarContactos({ prospectos: [PROSPECTO], mapeo: [], libreta: [EN_LA_LIBRETA] });
  const mapeo = [{
    celular10: '5512345678', resourceName: 'people/c9', etag: 'etag-9',
    clase: 'adoptado', huella: primera.actualizar[0].huella,
  }];
  const segunda = planificarContactos({ prospectos: [PROSPECTO], mapeo, libreta: [EN_LA_LIBRETA] });
  assert.equal(segunda.crear.length, 0);
  assert.equal(segunda.actualizar.length, 0, 'nada cambio: cero escrituras');
});

test('a un adoptado le cambia el correo en el sistema y NO se escribe nada', () => {
  // El correo no esta en su mascara: si entrara en la huella, cada cambio de un
  // campo que no se escribe produciria un PATCH inutil cada quince minutos.
  const primera = planificarContactos({ prospectos: [PROSPECTO], mapeo: [], libreta: [EN_LA_LIBRETA] });
  const mapeo = [{
    celular10: '5512345678', resourceName: 'people/c9', etag: 'etag-9',
    clase: 'adoptado', huella: primera.actualizar[0].huella,
  }];
  const otroCorreo = { ...PROSPECTO, data: { ...PROSPECTO.data, correo: 'otro@cocinas.mx' } };
  const segunda = planificarContactos({ prospectos: [otroCorreo], mapeo, libreta: [EN_LA_LIBRETA] });
  assert.equal(segunda.actualizar.length, 0);
});

test('el celular se reconoce en la libreta sin importar como lo escribio la persona', () => {
  // La coincidencia es por ultimos10, no por la cadena: en la libreta real hay
  // numeros con el "1" de WhatsApp, con espacios y con parentesis.
  for (const crudo of ['+52 1 55 1234 5678', '(55) 1234-5678', '55-1234-5678']) {
    const plan = planificarContactos({
      prospectos: [PROSPECTO], mapeo: [], libreta: [{ ...EN_LA_LIBRETA, telefonos: [crudo] }],
    });
    assert.equal(plan.crear.length, 0, `no debe crear otra ficha para ${crudo}`);
    assert.equal(plan.actualizar[0].clase, 'adoptado');
  }
});

test('un contacto de la libreta con otro numero no adopta nada', () => {
  const ajeno = { resourceName: 'people/c8', etag: 'e8', telefonos: ['55 0000 1111'] };
  const plan = planificarContactos({ prospectos: [PROSPECTO], mapeo: [], libreta: [ajeno] });
  assert.equal(plan.crear.length, 1);
  assert.equal(plan.actualizar.length, 0);
});

test('un contacto de la libreta sin telefonos no rompe la pasada', () => {
  const plan = planificarContactos({
    prospectos: [PROSPECTO], mapeo: [],
    libreta: [{ resourceName: 'people/c7', etag: 'e7' }, { resourceName: 'people/c6', etag: 'e6', telefonos: ['123'] }],
  });
  assert.equal(plan.crear.length, 1);
});

test('dos contactos de la libreta con el mismo numero adoptan uno solo', () => {
  // Fusionar o borrar duplicados preexistentes esta fuera de alcance (#224): se
  // adopta el primero y el otro se deja exactamente como esta.
  const gemelo = { resourceName: 'people/c10', etag: 'etag-10', telefonos: ['5512345678'] };
  const plan = planificarContactos({
    prospectos: [PROSPECTO], mapeo: [], libreta: [EN_LA_LIBRETA, gemelo],
  });
  assert.equal(plan.actualizar.length, 1);
  assert.equal(plan.actualizar[0].resourceName, 'people/c9');
});

// --- Lo que pierde respaldo deja de actualizarse, pero no desaparece (#231) ---
//
// Nada se borra NUNCA (ADR-0013): una ficha propia cuyo origen desaparecio pasa
// a un grupo Inactivo y deja de actualizarse, conservando su nombre para que
// quien escriba desde ese numero siga siendo reconocido.
//
// Casi todas estas pruebas pasan un cliente vivo aunque no lo usen: la fuente de
// clientes vacia frena la inactivacion a proposito (ver "sin evidencia"), asi
// que sin el, cualquier caso de esta seccion mediria el freno y no la regla.
const CLIENTE_VIVO = TELEFONO_CLIENTE;

function fichaEnMapeo(extra = {}) {
  return {
    celular10: '5512345678', resourceName: 'people/c1', etag: 'e1',
    clase: 'propio', huella: 'de-una-pasada-vieja', ...extra,
  };
}

test('una ficha propia que se queda sin respaldo entra en inactivar', () => {
  const plan = planificarContactos({
    prospectos: [], clientes: [CLIENTE_VIVO], mapeo: [fichaEnMapeo()],
  });
  assert.deepEqual(plan.inactivar.map(e => e.celular10), ['5512345678']);
  assert.equal(plan.inactivar[0].resourceName, 'people/c1');
});

// =========================================================================
// CANDADO ADR-0013. Un contacto ADOPTADO no era nuestro: lo escribio una
// persona a mano y lo unico que se le corrige es como se lee. Que su origen
// desaparezca del sistema no nos autoriza a marcar el contacto de alguien mas
// -- ni siquiera con una etiqueta. Si esta prueba falla, la respuesta correcta
// NO es actualizarla.
// =========================================================================
test('CANDADO ADR-0013: una ficha adoptada NUNCA se inactiva, aunque su origen desaparezca', () => {
  const plan = planificarContactos({
    prospectos: [], clientes: [CLIENTE_VIVO],
    mapeo: [fichaEnMapeo({ clase: 'adoptado', resourceName: 'people/c9' })],
  });
  assert.deepEqual(plan.inactivar, []);
  assert.deepEqual(plan.actualizar, [], 'tampoco se le escribe: su origen ya no esta');
});

test('una ficha ya inactiva no se vuelve a inactivar en cada pasada', () => {
  // Sin esto el barrido escribiria en Google la misma membresia cada quince
  // minutos, indefinidamente, y el panel reportaria inactivados para siempre.
  const plan = planificarContactos({
    prospectos: [], clientes: [CLIENTE_VIVO],
    mapeo: [fichaEnMapeo({ inactivoDesde: '2026-08-01T00:00:00.000Z' })],
  });
  assert.deepEqual(plan.inactivar, []);
  assert.deepEqual(plan.actualizar, []);
});

test('si el origen reaparece, la ficha inactiva se reactiva en esa misma pasada', () => {
  // La reactivacion viaja como una entrada de `actualizar` marcada `reactivar`:
  // la envoltura la saca del grupo Inactivo y le vuelve a escribir la ficha
  // completa. Una lista propia obligaria al panel y a la envoltura a aprender
  // un cuarto camino para lo mismo.
  const plan = planificarContactos({
    prospectos: [PROSPECTO], clientes: [CLIENTE_VIVO],
    mapeo: [fichaEnMapeo({ inactivoDesde: '2026-08-01T00:00:00.000Z' })],
  });
  assert.deepEqual(plan.inactivar, []);
  const entrada = plan.actualizar.find(e => e.celular10 === '5512345678');
  assert.equal(entrada.reactivar, true);
  assert.equal(entrada.clase, 'propio');
  assert.equal(entrada.resourceName, 'people/c1');
  assert.deepEqual(entrada.mascara, MASCARAS.propio, 'vuelve a ser una ficha propia entera');
});

test('la ficha se reactiva aunque nada haya cambiado desde que se inactivo', () => {
  // Aqui la huella coincide: sin la marca de reactivacion el plan concluiria
  // "nada cambio, cero escrituras" y la ficha se quedaria en el grupo Inactivo
  // para siempre, sin recibir actualizaciones nunca mas.
  const primera = planificarContactos({ prospectos: [PROSPECTO], clientes: [CLIENTE_VIVO], mapeo: [] });
  const huella = primera.crear.find(e => e.celular10 === '5512345678').huella;
  const plan = planificarContactos({
    prospectos: [PROSPECTO], clientes: [CLIENTE_VIVO],
    mapeo: [fichaEnMapeo({ huella, inactivoDesde: '2026-08-01T00:00:00.000Z' })],
  });
  const entrada = plan.actualizar.find(e => e.celular10 === '5512345678');
  assert.equal(entrada.reactivar, true);
});

// --- Tope de seguridad: una desaparicion masiva es un fallo de fuente ---
//
// El caso real que hay que frenar: Operam responde 500 (o a medias) y devuelve
// menos clientes de la cuenta. Sin tope, esa pasada leeria la mitad del padron
// como "se quedaron sin respaldo" y etiquetaria cientos de fichas de golpe.

function prospectoNumero(i) {
  return {
    id: 900 + i, celular: `55${10000000 + i}`, nombre: `Prospecto ${i}`,
    ciudad: 'Puebla', data: {},
  };
}

function mapeoDeProspectos(cuantos) {
  return Array.from({ length: cuantos }, (_, i) => ({
    celular10: `55${10000000 + i}`, resourceName: `people/p${i}`, etag: `e${i}`,
    clase: 'propio', huella: 'de-una-pasada-vieja',
  }));
}

test('una desaparicion inverosimil frena la inactivacion y se reporta como error', () => {
  const plan = planificarContactos({
    prospectos: [], clientes: [CLIENTE_VIVO], mapeo: mapeoDeProspectos(20),
  });
  assert.deepEqual(plan.inactivar, [], 'ni una sola ficha se etiqueta en esa pasada');
  assert.equal(plan.errores.length, 1);
  assert.match(plan.errores[0].motivo, /tope de inactivacion/);
  assert.equal(plan.errores[0].categoria, 'datos');
});

test('el tope frena SOLO la inactivacion: crear y actualizar siguen aplicandose', () => {
  const plan = planificarContactos({
    prospectos: [PROSPECTO], clientes: [CLIENTE_VIVO], mapeo: mapeoDeProspectos(20),
  });
  assert.deepEqual(plan.inactivar, []);
  assert.equal(plan.crear.length, 2, 'el prospecto y el telefono del cliente se crean igual');
});

test('una desaparicion normal SI se aplica: el tope no es un freno permanente', () => {
  // Tres de veinte es la rotacion de cualquier semana, no un fallo de fuente.
  const mapeo = mapeoDeProspectos(20);
  const siguen = mapeo.slice(3).map((_, i) => prospectoNumero(i + 3));
  const plan = planificarContactos({ prospectos: siguen, clientes: [CLIENTE_VIVO], mapeo });
  assert.deepEqual(plan.inactivar.map(e => e.celular10), mapeo.slice(0, 3).map(m => m.celular10));
  assert.deepEqual(plan.errores, []);
});

// --- Sin evidencia no hay desaparicion ---
//
// clientesCacheados() se traga el error de Operam y devuelve [] (lo mide la
// suite de la envoltura: "un fallo de Operam no impide que los prospectos
// lleguen a la libreta"). Es decir, desde aqui "Operam caido" y "no hay
// clientes" son EL MISMO dato. Ante esa ambiguedad la unica lectura segura es
// que no hubo pasada valida de esa fuente: se omite la inactivacion entera y se
// reporta. Lo contrario -- inactivar de todas formas -- convierte cada caida de
// Operam en una etiquetada masiva, que es justo lo que el tope quiere evitar.
test('sin la fuente de clientes no se inactiva nada: no es lo mismo vacio que caido', () => {
  const plan = planificarContactos({ prospectos: [], clientes: [], mapeo: [fichaEnMapeo()] });
  assert.deepEqual(plan.inactivar, []);
  assert.equal(plan.errores.length, 1);
  assert.match(plan.errores[0].motivo, /fuente de clientes/);
  assert.equal(plan.errores[0].categoria, 'datos');
});

test('sin nada que inactivar, la falta de fuente no se reporta como error', () => {
  // El freno se reporta cuando FRENA algo. Reportarlo en cada pasada sin
  // candidatos dejaria el barrido permanentemente "con errores" ante el panel
  // de #230 -- y a las 24h empezaria a mandar el correo diario de una averia
  // que no existe.
  const plan = planificarContactos({ prospectos: [PROSPECTO], clientes: [], mapeo: [] });
  assert.deepEqual(plan.errores, []);
});

test('sin fuente de clientes, crear y actualizar siguen aplicandose', () => {
  // La caida de Operam no puede parar la sincronizacion de prospectos: eso ya
  // esta fijado desde #228 y aqui solo se comprueba que el freno no lo rompa.
  const plan = planificarContactos({ prospectos: [PROSPECTO], clientes: [], mapeo: [] });
  assert.equal(plan.crear.length, 1);
});

test('un mapeo pequeno no dispara el tope aunque desaparezca entero', () => {
  // Con cuatro fichas, "el 20%" es menos de una: sin un piso absoluto, el
  // arranque del sistema no podria inactivar nunca nada.
  const plan = planificarContactos({
    prospectos: [], clientes: [CLIENTE_VIVO], mapeo: mapeoDeProspectos(4),
  });
  assert.equal(plan.inactivar.length, 4);
  assert.deepEqual(plan.errores, []);
});
