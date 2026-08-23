# Documentos legales de la tienda (pppeltre.mx)

Copia de lo que está **publicado** en Shopify al 2026-08-23. Viven aquí porque el cotizador es quien
copia datos personales de compradores a la libreta de Google (ADR-0014) y el aviso de privacidad es
lo que autoriza ese tratamiento: si cambia el tratamiento, cambia el aviso, y conviene que los dos
se revisen juntos.

**Esta carpeta no se despliega ni se lee desde el código.** Es el respaldo y el punto de partida
para la siguiente edición. La fuente de verdad para el cliente es lo publicado en Shopify.

| Archivo | Dónde vive publicado |
|---|---|
| `aviso-privacidad-integral.html` | Tienda online › Páginas › **privacidad** → https://pppeltre.mx/pages/privacidad |
| `aviso-privacidad-simplificado.html` | Configuración › Políticas › **Política de privacidad** (la que ve el checkout) → https://pppeltre.mx/policies/privacy-policy |
| `terminos-y-condiciones.html` | Configuración › Políticas › **Términos del servicio** → https://pppeltre.mx/policies/terms-of-service |

## Cómo actualizarlos

El token de Shopify del cotizador **no puede escribir** páginas ni políticas (le faltan
`write_content` y `write_legal_policies`, y no conviene tocarle los scopes: ver la nota del token en
`docs/arquitectura.md`). La publicación es **manual**:

1. Editar el archivo de esta carpeta.
2. En el admin de Shopify, abrir el destino de la tabla, entrar a la vista HTML (botón `<>`), borrar
   todo el contenido anterior y pegar el archivo completo.
3. Verificar la URL publicada. **Ojo**: el 2026-08-23 el pegado de los Términos se cortó a media
   frase y se perdieron las últimas cinco secciones sin ningún aviso. Después de pegar hay que
   comprobar que el documento termina en su última línea, no solo que "se ve bien" al principio.
4. Actualizar la fecha de "Última actualización" en el archivo y en lo publicado.

## Qué contienen y por qué

**Aviso de Privacidad Integral.** Reescrito el 2026-08-23 sobre el que ya existía. Lo que se agregó:
el número e historial de pedidos entre los datos recabados; la finalidad de atención por WhatsApp
con la mención explícita de que el contacto se registra en la libreta de la empresa; los proveedores
de infraestructura (Shopify, Google, Render, Neon, WhatsApp) con servidores fuera de México; los
plazos de respuesta ARCO de la ley (20 días + 15); y una **sección 7 de Conservación** que no
existía. Esa sección es la que sostiene la decisión de conservar los contactos "para siempre"
(ADR-0014): se ancla a una finalidad que no caduca —atender consultas sobre compras anteriores y
reconocer al cliente en compras posteriores— y compromete el borrado **a solicitud del titular**,
que es exactamente lo que implementa `scripts/excluir-celular.mjs` (#259).

**Aviso Simplificado.** Es nuevo. Reemplazó a un texto truncado que nombraba a **"Gaia Design"**
—una empresa ajena—, copiado de una plantilla y publicado durante años en el checkout. Remite al
Integral en lugar de duplicarlo, para que los dos no se desincronicen.

**Términos y Condiciones.** Reescritos sobre la versión anterior. Cambios de fondo:

- **Envíos internacionales**: el texto anterior decía que solo se entregaba dentro de México, cuando
  el padrón real tiene 73 pedidos a Estados Unidos y 3 a Canadá. Se ajustó la cláusula de compra y se
  agregó una sección propia (cliente como importador, aranceles del país destino a su cargo, plazos
  sin contar aduana, quién paga el flete de retorno).
- **Cláusulas retiradas por ser probablemente nulas frente a la LFPC**: volver a cobrar la tarjeta
  "sin autorización ni notificación previa" tras un contracargo; cancelar pedidos pagados "por
  cualquier razón, en cualquier momento"; el plazo de 3 días para reclamar vicios aparentes;
  "ningún cliente podrá solicitar una garantía más amplia"; y "no podrá realizar reembolsos
  parciales" (que además contradecía la sección internacional y era falso operativamente).
- La garantía excluía "los productos **transportados**", lo que en una tienda en línea excluye todo.
- **Legislación aplicable y jurisdicción** (no existía): ley mexicana, PROFECO en vía
  administrativa, tribunales a elección del Cliente, con carve-out para relaciones B2B.
- Retraso mayor a **30 días hábiles** sobre el plazo prometido da derecho a cancelar (decisión del
  dueño 2026-08-23; se propuso 15 días naturales y lo cambió).
- La aceptación se redactó como conformidad al confirmar y pagar, **no** como aceptación expresa:
  Shopify no ofrece casilla de términos en el checkout fuera del plan Plus, y el documento no debe
  afirmar algo que no ocurre. Si algún día se quiere prueba de la aceptación, hace falta una app que
  registre fecha y hora.

Los tres documentos se redactaron con apoyo de un agente de revisión y **no han sido revisados por
un abogado**. Los cambios de fondo listados arriba reducen la exposición respecto del texto anterior,
pero la revisión legal sigue pendiente.
