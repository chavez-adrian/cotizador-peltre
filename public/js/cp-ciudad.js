// Resolucion CP -> ciudad/estado en el NAVEGADOR (issue #160; reusada por la
// pantalla unica de expo en #268). La comparten el formulario publico de
// mayoreo (`mayoreo.js`) y la captura de expo (`app.js`): un modulo, dos
// consumidores, cero copias espejo. Aqui vive CUANDO vale la pena preguntarle
// al indice y como se lee la respuesta; como se pinta el resultado (chip,
// campo de respaldo) es de cada pantalla.

// Longitud minima antes de intentar resolver: 5 digitos en MX/US. En CA son 6
// (el codigo COMPLETO, sin contar el espacio): lib/validar-cp.js -- el mismo
// validador que reusa el GET publico -- exige el patron completo de 6
// caracteres antes de aceptar el formato, aunque el indice solo guarde el FSA
// de 3 (normalizarCp lo recorta despues de pasar la validacion). Disparar a los
// 3 caracteres serviria un 400 en cada tecla intermedia sin resolver nunca.
export function longitudMinimaCP(pais) {
  return pais === 'CA' ? 6 : 5;
}

// null = no resolvio, y son cuatro casos que el formulario trata igual (destapa
// su campo de ciudad de respaldo): al CP todavia le faltan caracteres, el
// formato es invalido, el CP no esta en el indice o fallo la llamada.
export async function ciudadPorCP(pais, cpCrudo) {
  const cp = String(cpCrudo == null ? '' : cpCrudo).trim();
  if (cp.replace(/\s+/g, '').length < longitudMinimaCP(pais)) return null;
  try {
    const res = await fetch(`/api/cp/${pais}/${encodeURIComponent(cp)}`);
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error('[cp] no se pudo resolver el CP:', err.message);
    return null;
  }
}
