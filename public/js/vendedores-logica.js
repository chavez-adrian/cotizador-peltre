// operam_id del vendedor (#434): el numero con el que Operam lo identifica (su
// `salesman`). Nucleo puro sin IO: la MISMA regla la usan el panel /admin (avisa
// antes de guardar) y el PUT de /api/admin/vendedores (rechaza con 400 antes de
// reemplazar el registro). Un texto basura tumbaria el guardado entero en Neon
// (`(v->>'operam_id')::int`), y dos vendedores con el mismo id harian que el
// mapeo inverso del backfill se quedara con el primero.
//
// Vacio = null es una decision valida: quien solo captura formatos no necesita
// id, pero sin el no aparece en los selectores de vendedor.

const INVALIDO = Symbol('operam_id invalido');
// Tope de int en Postgres: arriba Neon truena en ::int con 500 en vez de 400.
const OPERAM_ID_MAX = 2147483647;

function operamIdCapturado(valor) {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === 'string') {
    const texto = valor.trim();
    if (texto === '') return null;
    if (!/^\d+$/.test(texto)) return INVALIDO;
    valor = Number(texto);
  }
  if (typeof valor !== 'number' || !Number.isInteger(valor) || valor <= 0 || valor > OPERAM_ID_MAX) return INVALIDO;
  return valor;
}

function nombreDe(v) {
  return v && v.name ? v.name : `id ${v && v.id}`;
}

// -> { error } con el texto para el admin, o { vendedores } con cada operam_id
// ya como entero o null.
export function validarOperamIds(vendedores) {
  const vistos = new Map();
  const normalizados = [];
  for (const v of vendedores) {
    if (!v) { normalizados.push(v); continue; }
    const operamId = operamIdCapturado(v.operam_id);
    if (operamId === INVALIDO) {
      return { error: `El operam_id de "${nombreDe(v)}" debe ser un numero entero positivo o quedar vacio (se capturo "${v.operam_id}").` };
    }
    if (operamId !== null) {
      if (vistos.has(operamId)) {
        return { error: `El operam_id ${operamId} esta repetido en "${nombreDe(vistos.get(operamId))}" y "${nombreDe(v)}": cada vendedor necesita el suyo.` };
      }
      vistos.set(operamId, v);
    }
    normalizados.push({ ...v, operam_id: operamId });
  }
  return { vendedores: normalizados };
}
