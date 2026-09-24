// Verificador EN VIVO de la tarifa Tresguerras (issue #437).
//
// Por que no es un test de la suite: la suite prueba el nucleo contra respuestas
// reales guardadas y el IO contra un fetch mockeado. Ningun mock puede detectar
// que Tresguerras movio su cotizador publico, cambio los nombres del formulario o
// la forma de la respuesta, o renovo su certificado con otro emisor (el TLS del
// cotizador depende de un intermedio que se le agrega a mano, acotado a su host).
// Este script le pregunta a Tresguerras de verdad, por el MISMO camino que usa
// el servidor (node:https con la verificacion TLS completa, sin -k).
//
// READ-ONLY: dos POST al cotizador publico (Poblaciones y CotizarNew), uno a la
// vez. Solo cotiza: no genera guias ni agenda recolecciones. Cero Operam.
//
// Uso:
//   node scripts/verificar-tresguerras.mjs [cpDestino]
//
// Ruta de referencia: fabrica (56577) -> Monterrey (64000), 8 cajas de
// 0.5 x 0.4 x 0.4 m de 25 kg, valor declarado $10,000 (medido 2026-09-23:
// puerta a puerta $3,930.95).
//
// exit 0 = la opcion "Cotizar con Tresguerras" sirve, 1 = esta rota.
import { postHttps } from '../lib/tresguerras.js';
import {
  URL_POBLACIONES, URL_COTIZAR, COLONIA_FABRICA,
  cuerpoPoblaciones, origenYDestino, datosFormCotizacion, cuerpoCotizar, tarjetaDesdeCotizacion,
} from '../lib/tresguerras-logica.js';

const cp = process.argv[2] || '64000';
const CAJAS = [{ cantidad: 8, medidasCm: [50, 40, 40], pesoKg: 25 }];
const VALOR_DECLARADO = 10000;

function falla(msg, detalle) {
  console.error(`\nFALLA: ${msg}`);
  if (detalle) console.error(detalle);
  process.exit(1);
}

async function pedir(nombre, url, cuerpo) {
  let r;
  try {
    r = await postHttps(url, cuerpo);
  } catch (err) {
    falla(`${nombre}: no se pudo hablar con Tresguerras (${err.code || ''} ${err.message})`,
      /certificate|CERT/i.test(`${err.code} ${err.message}`)
        ? 'El TLS no verifica: probablemente renovaron el certificado con otro emisor. Revisa el intermedio de lib/tresguerras.js.'
        : '');
  }
  console.log(`${nombre}: respondio ${r.status} (${r.texto.length} caracteres)`);
  if (r.status !== 200) falla(`${nombre} respondio ${r.status}`);
  try { return JSON.parse(r.texto); } catch { falla(`${nombre} ya no responde JSON: movieron la pagina.`, r.texto.slice(0, 500)); }
}

const pob = await pedir('Poblaciones', URL_POBLACIONES, cuerpoPoblaciones(cp));
const od = origenYDestino(pob, cp);
if (od.aviso) falla(od.aviso, JSON.stringify(pob).slice(0, 800));
console.log(`  origen:  poblacion ${od.origen.poblacion}, colonia ${od.origen.colonia}`);
console.log(`  destino: poblacion ${od.destino.poblacion}, colonia ${od.destino.colonia}`);
if (od.origen.colonia !== COLONIA_FABRICA) {
  console.log(`  AVISO: la colonia de la fabrica (${COLONIA_FABRICA}) ya no viene en el origen; se cotizo con la primera.`);
}

const datosForm = datosFormCotizacion({ ...od, cpDestino: cp, cajas: CAJAS, valorDeclarado: VALOR_DECLARADO });
const cot = await pedir('CotizarNew', URL_COTIZAR, cuerpoCotizar(datosForm));
const r = tarjetaDesdeCotizacion(cot, cp);
if (r.aviso) falla(r.aviso, `Terrestre.error: ${cot?.Terrestre?.error}; precioTotal: ${JSON.stringify(cot?.Terrestre?.precioTotal)}`);

const { rate } = r;
console.log(`\n  ${rate.serviceDescription}: $${rate.totalPrice.toFixed(2)} ${rate.currency} con IVA`);
console.log(`  dias de transito: ${rate.days ?? '(no se leyo)'}`);
console.log(`  desglose: ${rate.desglose ? JSON.stringify(rate.desglose) : '(no se leyo)'}`);
if (rate.days === null || !rate.desglose) {
  falla('La tarifa salio pero el desglose (dias, flete, recoleccion, entrega, seguro) ya no se lee: cambio el HTML de Terrestre.purtaPuerta.');
}
console.log('\nLa opcion "Cotizar con Tresguerras" sirve: el vendedor veria esta tarjeta puerta a puerta.');
