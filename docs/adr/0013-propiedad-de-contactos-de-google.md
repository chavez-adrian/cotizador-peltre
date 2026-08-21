# Los Contactos de Google propios se reescriben enteros; los adoptados solo cambian de nombre

La libreta de Contactos de Google de `pppeltre@gmail.com` no es un almacén nuestro: es la agenda de un teléfono que alguien ya venía usando, con contactos que una persona escribió a mano. La sincronización entra ahí como invitada, y toda esta decisión se sigue de eso.

Un celular que el sistema conoce y que la libreta todavía no tiene produce un contacto **propio**: lo creó la sincronización y se reescribe completo en cada pasada, porque no hay nada humano que preservar y así queda siempre igual al sistema. Un celular que el sistema conoce y que **ya tenía** contacto en la libreta se **adopta**: se le corrige el nombre y la organización, y se dejan intactos sus teléfonos, correos y direcciones. La alternativa —escribir también esos campos— se descartó al ver el mecanismo real: la actualización de la API de Google reemplaza campos en vez de fusionarlos, de modo que mandar un solo teléfono borra los demás. Un barrido que corre cada quince minutos, indefinidamente, estaría borrando el fijo de la oficina o el segundo celular que alguien agregó a mano, cada vez, sin dejar rastro. La consistencia total de la libreta no vale ese precio.

Por la misma razón nada se borra nunca. Un contacto propio que pierde su respaldo en el origen se marca inactivo y deja de actualizarse. Borrar sería irreversible en la práctica, porque la función de deshacer de Google revierte la libreta entera a un instante y no un contacto suelto; y un fallo transitorio de Operam que devuelva menos clientes de la cuenta se leería como una desaparición masiva. Además, quien te escribe desde un número viejo es exactamente el caso que esta libreta existe para resolver.

Cuando un mismo celular es prospecto vivo y cliente en Operam a la vez —caso que el propio pipeline produce, porque el prospecto convertido no sale del seguimiento— gana el cliente. Esto invierte a propósito la precedencia que usa la clasificación de un celular contra el embudo, donde se consulta primero al prospecto. No es una inconsistencia: allá la pregunta es "¿ya lo conozco?" y conviene empezar por la fuente barata; aquí es "¿qué etiqueta describe mejor a esta persona?", y la respuesta es la que trae nombre comercial real en lugar de una ciudad.

## Consecuencias

La libreta crece y no se poda sola: acumula inactivos y contactos adoptados que quizá ya no correspondan a nadie. Es el costo aceptado de no borrar, y se vigila desde el panel de administración, no desde el código.

Un contacto adoptado nunca converge del todo con el sistema: conserva datos que nosotros no escribimos y que pueden contradecir a Operam. Es deliberado. Si algún día se quiere unificar, la vía es que una persona lo decida contacto por contacto, no que un barrido lo imponga.

La distinción entre propio y adoptado deja de ser un detalle interno y pasa a ser estado que hay que persistir: sin saber cuál es cuál, la siguiente pasada no sabe qué le está permitido escribir.
