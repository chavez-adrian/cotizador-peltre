export function parsearCSF(texto) {
  const get = (regex) => {
    const m = texto.match(regex);
    return m ? m[1].trim() : '';
  };

  const rfc = get(/R\.?F\.?C\.?\s*:?\s*([A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3})/i);

  const razonSocial = (() => {
    const pm = get(/Denominaci[oó]n\/?Raz[oó]n\s*Social\s*:\s*(.+?)(?=\n|R\.?F\.?C)/is);
    if (pm) return pm.trim();
    const nombre = get(/Nombre\s*(?:\(s\))?\s*:\s*([A-ZÁÉÍÓÚÑ ]+?)(?=\n)/i);
    const ap1 = get(/Primer\s*Apellido\s*:\s*([A-ZÁÉÍÓÚÑ ]+?)(?=\n)/i);
    const ap2 = get(/Segundo\s*Apellido\s*:\s*([A-ZÁÉÍÓÚÑ ]+?)(?=\n)/i);
    return [nombre, ap1, ap2].filter(Boolean).join(' ').trim();
  })();

  const idcif = get(/idCIF\s*:\s*(\d+)/i);
  const cp = get(/C[oó]digo\s*Postal\s*:?\s*(\d{5})/i);
  const calle = get(/Nombre\s*de\s*(?:la\s*)?Vialidad\s*:\s*([^\n]+)/i);
  const numExt = get(/N[uú]mero\s*Exterior\s*:\s*([^\n]+)/i);
  const numInt = get(/N[uú]mero\s*Interior\s*:\s*([^\n]*)/i);
  const colonia = get(/Nombre\s*de\s*la\s*Colonia\s*:\s*([^\n]+)/i);
  const municipio = get(/Nombre\s*del\s*Municipio[^\n:]*:\s*([^\n]+)/i);
  const estado = get(/Nombre\s*de\s*la\s*Entidad\s*Federativa\s*:\s*([^\n]+)/i);

  const regimenFiscal = (() => {
    const m = texto.match(/R[eé]gimen\s*Fiscal\s*:\s*(\d{3})/i);
    return m ? m[1] : '';
  })();

  const nombreCorto = razonSocial.split(' ').slice(0, 3).join(' ');

  return {
    rfc,
    razonSocial,
    nombreCorto,
    idcif,
    cp,
    calle,
    numExt,
    numInt: numInt || '',
    colonia,
    municipio,
    estado,
    pais: 'MX',
    regimenFiscal,
  };
}
