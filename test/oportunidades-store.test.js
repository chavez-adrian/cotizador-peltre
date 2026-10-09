// Store de Oportunidades (#343) en su fallback JSON, el modo en que corre la suite.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { leerArchivoSync } from '../lib/fs-reintento.js';
import { fotoDatos, fijarDatos } from './helpers/datos-aislados.js';
import { reasignarContacto } from '../lib/oportunidades-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OPORTUNIDADES_PATH = join(__dirname, '..', 'data', 'oportunidades.json');

let restaurar;
before(() => { restaurar = fotoDatos([OPORTUNIDADES_PATH]); });
after(() => { restaurar(); });

// Fusion de Contactos (#565): las Oportunidades del Contacto que se funde pasan al que
// queda con las DOS llaves (contacto_id y contacto10); las de otros no se tocan.
test('reasignarContacto mueve las Oportunidades de un Contacto a otro con su llave nueva y devuelve sus ids (#565)', async () => {
  fijarDatos(OPORTUNIDADES_PATH, [
    { id: 30, fecha: '2026-10-01T00:00:00Z', contactoId: 10, contacto10: '5588880000', vendedor: 'Ana', etapa: 'por_cotizar', eventos: [], data: {} },
    { id: 31, fecha: '2026-10-01T00:00:00Z', contactoId: 11, contacto10: '5599990000', vendedor: 'Ana', etapa: 'por_cotizar', eventos: [], data: {} },
    { id: 32, fecha: '2026-10-02T00:00:00Z', contactoId: 10, contacto10: '5588880000', vendedor: 'Ana', etapa: 'perdida', eventos: [], data: {} },
  ]);
  assert.deepEqual(await reasignarContacto(10, 20, '5512345678'), [30, 32]);
  const guardadas = JSON.parse(leerArchivoSync(OPORTUNIDADES_PATH));
  assert.deepEqual(guardadas.map(o => [o.id, o.contactoId, o.contacto10]), [
    [30, 20, '5512345678'], [31, 11, '5599990000'], [32, 20, '5512345678'],
  ]);
  assert.deepEqual(await reasignarContacto(10, 20, '5512345678'), []);
});
