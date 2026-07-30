import { readFileSync, writeFileSync, unlinkSync } from 'fs';

// OneDrive toma locks intermitentes (EBUSY) sobre los data/*.json mientras los
// sincroniza: un readFileSync/writeFileSync sin reintento tumba ~1 de cada 3
// corridas de la suite (issue #117). Reintento corto con espera SINCRONA
// (los stores y los tests operan el disco de forma sincrona a proposito).
// Solo EBUSY: otros codigos (EPERM, ENOENT...) son errores reales del caller.
const REINTENTOS = 10;
const ESPERA_MS = 50;

function dormir(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function conReintentoEBUSY(fn, { esperaMs = ESPERA_MS } = {}) {
  for (let i = 0; ; i++) {
    try {
      return fn();
    } catch (e) {
      if (e.code !== 'EBUSY' || i >= REINTENTOS - 1) throw e;
      dormir(esperaMs);
    }
  }
}

export function leerArchivoSync(path) {
  return conReintentoEBUSY(() => readFileSync(path, 'utf8'));
}

export function escribirArchivoSync(path, contenido) {
  conReintentoEBUSY(() => writeFileSync(path, contenido));
}

export function borrarArchivoSync(path) {
  conReintentoEBUSY(() => unlinkSync(path));
}
