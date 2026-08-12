import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularPaquetes } from '../lib/calcular-envio.js';

// La calca no ocupa caja ni pesa aparte: va APLICADA sobre la pieza, que ya
// viaja con su propio empaque. Sin excluirla, el modelo se derivaba con
// codigo.slice(0,4) -> 'CAL1', ausente de boxMap, y cada cotizacion con calca
// arrastraba un warning falso "Modelo CAL1 sin empaque configurado" (issue #91).
test('#91-envio-1: la calca no produce warning de empaque', () => {
  const { warnings } = calcularPaquetes([
    { codigo: 'PV08B1A321124', cantidad: 600 },
    { codigo: 'CAL1050', cantidad: 600 },
  ]);
  assert.deepStrictEqual(warnings, []);
});

test('#91-envio-2: la calca no agrega cajas ni peso al envio', () => {
  const soloProducto = calcularPaquetes([{ codigo: 'PV08B1A321124', cantidad: 600 }]);
  const conCalca = calcularPaquetes([
    { codigo: 'PV08B1A321124', cantidad: 600 },
    { codigo: 'CAL1050', cantidad: 600 },
  ]);
  assert.deepStrictEqual(conCalca.packages, soloProducto.packages);
  assert.deepStrictEqual(conCalca.resumen, soloProducto.resumen);
});

test('#91-envio-3: un modelo de producto sin empaque configurado SI sigue avisando', () => {
  const { warnings } = calcularPaquetes([{ codigo: 'ZZ99B1A321124', cantidad: 10 }]);
  assert.ok(warnings.some(w => w.includes('ZZ99')), 'el aviso real no se pierde al excluir la calca');
});
