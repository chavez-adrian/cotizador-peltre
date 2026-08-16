// Rate limit por IP de la captura publica de mayoreo (issue #157, ADR-0012).
// Vive en memoria: valido mientras Render corra UNA sola instancia, la misma
// restriccion que el lock subidasOperamEnCurso y el indice postal (CLAUDE.md
// seccion Deploy). Con varias instancias habria que moverlo a Neon o a un lock
// distribuido.
//
// No es una defensa contra un atacante decidido (una botnet rota IPs): es el
// freno barato contra el envio repetido y el bot tonto. La defensa fuerte es
// Turnstile (#162).

export const MAX_CAPTURAS_POR_IP = 5;
export const VENTANA_MS = 60 * 60 * 1000;

const golpes = new Map();

// Registra un intento de la IP y dice si procede. Cuenta SIEMPRE, incluso los
// rechazados: quien insiste pasado el tope no se rehabilita antes por insistir.
export function permitirCaptura(ip, ahora = Date.now()) {
  const llave = String(ip || 'desconocida');
  const desde = ahora - VENTANA_MS;
  // Poda perezosa: sin esto el Map crece sin techo en un proceso de larga vida.
  for (const [k, marcas] of golpes) {
    const vivas = marcas.filter(t => t > desde);
    if (vivas.length) golpes.set(k, vivas);
    else golpes.delete(k);
  }
  const marcas = golpes.get(llave) || [];
  marcas.push(ahora);
  golpes.set(llave, marcas);
  return marcas.length <= MAX_CAPTURAS_POR_IP;
}

export function resetRateLimitPublico() {
  golpes.clear();
}
