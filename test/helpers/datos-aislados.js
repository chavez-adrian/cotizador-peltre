// Aislamiento de los data/*.json entre suites (#411).
//
// Una suite cuyo resultado dependa de un data/*.json no puede arrancar sobre lo
// que encuentre en el disco: el fixture de otra suite la pone en rojo sin que el
// codigo tenga nada mal, y como esos archivos estan en .gitignore el estado
// corrupto no sale en git status. El par es siempre el mismo -- `fotoDatos` en el
// before() (guarda existencia y TEXTO de lo que se encontro) y `fijarDatos` para
// escribir el punto de partida, aunque sea la lista vacia --, y la funcion que
// devuelve `fotoDatos` restaura al terminar: el archivo que no existia se borra,
// nunca queda en lista vacia.
//
// Todo el acceso pasa por lib/fs-reintento.js (#117), tambien aqui.
import { existsSync } from 'fs';
import { leerArchivoSync, escribirArchivoSync, borrarArchivoSync } from '../../lib/fs-reintento.js';

export function fijarDatos(path, valor) {
  escribirArchivoSync(path, JSON.stringify(valor, null, 2));
}

export function fotoDatos(paths) {
  const foto = paths.map(path => ({
    path,
    existia: existsSync(path),
    texto: existsSync(path) ? leerArchivoSync(path) : null,
  }));
  return function restaurarDatos() {
    for (const { path, existia, texto } of foto) {
      if (existia) escribirArchivoSync(path, texto);
      else if (existsSync(path)) borrarArchivoSync(path);
    }
  };
}
