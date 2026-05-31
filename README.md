# cotizador-peltre

Herramienta interna de cotizacion para vendedores de Peltre Nacional SA de CV. Genera cotizaciones de productos de acero esmaltado, calcula envio y las comparte por PDF o WhatsApp. Disenada para uso movil en campo.

**Produccion:** https://cotizador-peltre.onrender.com

## Stack

- Node.js >= 20 / Express — ES modules
- Frontend: HTML + CSS + JS vanilla (sin frameworks)
- PDF: pdfkit
- Autenticacion: JWT (30 dias)
- Integracion: Operam ERP v3, envia.com (cotizacion de envio)

## Requisitos

```
node >= 20
npm install
```

Copiar `.env.example` a `.env` y completar las variables:

| Variable | Descripcion |
|----------|-------------|
| `JWT_SECRET` | Clave secreta para JWT |
| `OPERAM_URL` | URL base de Operam (ej. `https://peltrenacional.operam.pro`) |
| `OPERAM_USER` | Usuario API Operam |
| `OPERAM_PASSWORD` | Contrasena API Operam |
| `ENVIA_API_KEY` | API key de envia.com para cotizar envio |

## Uso

```bash
npm start        # produccion
npm run dev      # desarrollo con --watch
npm test         # todos los tests
```

## Estructura

```
server.js              # API Express + auth + rutas
lib/
  operam-client.js     # cliente Operam v3 (buscar, actualizar, subir cotizacion)
  pdf-generator.js     # genera PDF de cotizacion
  html-generator.js    # genera HTML de cotizacion (para WhatsApp link)
  calcular-envio.js    # calcula paquetes para envia.com
  extract-prices.js    # extrae precios desde Excel
  parsear-csf.js       # extrae datos de PDF de Constancia de Situacion Fiscal
public/
  index.html           # app principal (SPA)
  admin.html           # panel de administracion
  js/app.js            # logica frontend (ES modules, ~2500 lineas)
  js/__tests__/        # tests de funciones puras del frontend
data/
  precios.json         # catalogo de precios (cargado via admin)
  vendedores.json      # lista de vendedores con PIN
  cotizaciones.json    # historial de cotizaciones
  pdfs/                # PDFs generados
  htmls/               # HTMLs generados
test/                  # tests de backend (supertest + node:test)
```

## Flujos principales

### Cotizar
1. Login con ID de vendedor + PIN
2. Seleccionar cliente (buscar en Operam, captura manual, o desde CSF)
3. Agregar productos al carrito (tier de precio calculado automaticamente)
4. Cotizar envio con envia.com (opcional)
5. Generar PDF o HTML, compartir por WhatsApp

### Alta de cliente desde CSF
1. Subir PDF de Constancia de Situacion Fiscal
2. El sistema extrae RFC, razon social y domicilio automaticamente
3. **Guard de duplicado:** si el RFC ya existe en Operam, carga los datos existentes y ofrece actualizacion
4. Si es cliente nuevo: crear en Operam con un clic

### Guard de RFC duplicado
Implementado en tres puntos de entrada:
- **Flujo CSF:** al parsear el PDF, antes de mostrar el boton "Crear en Operam"
- **Captura manual:** al salir del campo RFC (blur), si tiene >= 12 caracteres
- En ambos casos: banner de aviso, carga de datos existentes, flujo de actualizacion con diff y confirmacion

### Actualizar cliente existente
1. Se detecta cliente existente (por RFC)
2. Vendedor puede editar campos en el formulario
3. Al hacer clic en "Actualizar en Operam": se calcula diff con valores originales
4. Se muestra panel de confirmacion con lista de campos que van a cambiar
5. Al confirmar: se envian a Operam solo los campos modificados

## API endpoints

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| POST | `/api/login` | Autenticar vendedor |
| GET | `/api/precios` | Catalogo de precios con config activa |
| POST | `/api/cotizacion/pdf` | Generar PDF y guardar en historial |
| POST | `/api/cotizacion/html` | Generar HTML y guardar en historial |
| GET | `/api/cotizacion/pdf/:id` | Descargar PDF por ID |
| GET | `/api/cotizacion/html/:id` | Ver HTML por ID |
| GET | `/api/cotizaciones` | Historial del vendedor (o todos si admin) |
| POST | `/api/cotizacion/envio` | Cotizar envio con envia.com |
| GET | `/api/operam/clientes` | Buscar clientes en Operam |
| GET | `/api/operam/clientes/:id/domicilios` | Domicilios de un cliente |
| PATCH | `/api/operam/clientes/:id` | Actualizar cliente en Operam (solo campos del diff) |
| POST | `/api/cotizacion/operam/:id` | Subir cotizacion a Operam |
| POST | `/api/admin/precios` | Actualizar precios desde Excel (admin) |
| GET/POST | `/api/admin/config` | Configuracion de catalogo cotizable (admin) |
| GET/PUT | `/api/admin/vendedores` | Gestion de vendedores (admin) |
| GET/PUT | `/api/admin/cajas` | Configuracion de cajas de empaque (admin) |

## Tests

```bash
npm test
# 119 tests, 0 fallas
```

Tests de backend en `test/` (supertest + node:test, ES modules).
Tests de frontend en `public/js/__tests__/` (node:test, CommonJS helpers).
