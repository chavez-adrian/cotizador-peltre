// La liga copia -> persona de origen del Contacto de entrega (#564, ADR-0024 regla 6):
// dato del cotizador, consultable por domicilio y person_id de origen. Sin
// DATABASE_URL el store cae a data/copias-contacto.json, que es el camino que ejercitan
// estas pruebas con el archivo fijado y restaurado (#411).
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { fotoDatos, fijarDatos } from './helpers/datos-aislados.js';

delete process.env.DATABASE_URL;
const __dirname = dirname(fileURLToPath(import.meta.url));
const JSON_PATH = join(__dirname, '..', 'data', 'copias-contacto.json');
const store = await import('../lib/copias-contacto-store.js');

let restaurar;
before(() => { restaurar = fotoDatos([JSON_PATH]); });
after(() => restaurar());
beforeEach(() => fijarDatos(JSON_PATH, []));

test('sin liga guardada, buscar devuelve null', async () => {
  assert.equal(await store.buscar('564', '61'), null);
});

test('la liga guardada se encuentra por domicilio y persona de origen, con la copia y el cliente', async () => {
  await store.guardar({ clienteId: 15, domicilioId: 564, origenPersonId: 61, copiaPersonId: 1301 });
  const liga = await store.buscar('564', '61');
  assert.equal(liga.copiaPersonId, '1301');
  assert.equal(liga.clienteId, '15');
  assert.equal(await store.buscar('15', '61'), null);
  assert.equal(await store.buscar('564', '1249'), null);
});

test('guardar otra copia para el mismo domicilio y origen reemplaza la liga, sin duplicarla', async () => {
  await store.guardar({ clienteId: '15', domicilioId: '564', origenPersonId: '61', copiaPersonId: '1301' });
  await store.guardar({ clienteId: '15', domicilioId: '15', origenPersonId: '61', copiaPersonId: '1302' });
  await store.guardar({ clienteId: '15', domicilioId: '564', origenPersonId: '61', copiaPersonId: '1303' });
  assert.equal((await store.buscar('564', '61')).copiaPersonId, '1303');
  assert.equal((await store.buscar('15', '61')).copiaPersonId, '1302');
});
