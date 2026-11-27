# PuroTexto

Sitio web con herramientas de texto con IA, en español: detecta si un texto suena humano o a IA, lo reescribe para que suene natural, resume, traduce con contexto, verifica gramática, compara textos y cuenta palabras.

Sitio: https://purotexto.com

## Cómo está armado

| Pieza | Qué hace |
|---|---|
| **Cloudflare Pages** | Publica el sitio. Cada vez que se sube un cambio a GitHub, se vuelve a desplegar solo. |
| **GitHub** | Guarda el código. |
| **Supabase** | Cuentas de usuario, cupos de uso diarios, perfiles Premium y opiniones. |
| **Gemini (Google)** | El modelo de IA de todas las herramientas. |
| **Polar** | Cobro de Premium con tarjeta, en dólares. |
| **Mercado Pago** | Cobro de Premium en pesos. |
| **Cloudflare Turnstile** | Verificación anti-bots al iniciar sesión y registrarse. |

## Carpetas

- `public/` — el sitio que ve la gente (páginas, estilos y scripts).
- `functions/api/` — los "intermediarios": código que corre en Cloudflare y guarda las claves secretas.
- `wrangler.toml` — configuración de Cloudflare Pages (nombre del proyecto y carpeta `public`).
- `package.json` y `package-lock.json` — la única librería que usa el proyecto. No los edites ni los borres.

Las carpetas `public` y `functions` tienen que llamarse exactamente así.

## Páginas (`public/`)

**Herramientas**

| Página | Herramienta |
|---|---|
| `index.html` | Detector de IA (también acepta PDF y Word) |
| `parafraseador.html` | Parafraseador (humanizar texto) |
| `resumen.html` | Resumen IA |
| `traductor.html` | Traductor con contexto |
| `gramatica.html` | Verificador de gramática |
| `comparacion.html` | Comparación de textos |
| `contador.html` | Contador de palabras |

**Otras páginas:** `articulos.html` y los cuatro `articulo-*.html`, `precios.html`, `cuenta.html`, `acerca.html`, `contacto.html`, `privacidad.html` y `terminos.html`.

**Scripts compartidos**

| Archivo | Para qué sirve |
|---|---|
| `limites.js` | Cupos de uso diarios (Freemium) en todas las herramientas. |
| `captcha-auth.js` | Verificación anti-bots (Turnstile) en inicio de sesión y registro. |
| `exportar-pdf.js` | Exportar a PDF (solo Premium). |
| `opinion-widget.js` | El cuadro "¿Te sirvió?" en el inicio. |
| `pwa.js`, `sw.js`, `manifest.json` | Hacen que el sitio se pueda instalar como app. |
| `tema.js` | Botón de modo claro/oscuro. |
| `supabase-js.js` | Librería de Supabase. |

**Publicidad:** los archivos `anuncio-*.html` son los espacios de anuncios. Tienen `noindex` para que Google no los indexe.

**Otros:** `_headers` (seguridad y caché), `robots.txt`, `sitemap.xml`, íconos e imágenes para compartir.

## Intermediarios (`functions/api/`)

Cada archivo se publica solo en `/api/<nombre>`.

| Archivo | Qué hace |
|---|---|
| `analizar.js` | Detector de IA. Lee texto, PDF y Word. |
| `parafrasear.js` | Parafraseador. |
| `resumir.js` | Resumen IA. |
| `traducir.js` | Traductor con contexto. |
| `gramatica.js` | Verificador de gramática. |
| `comparar.js` | Comparación de textos. |
| `opinion.js` | Guarda el "¿Te sirvió?". |
| `precios.js` | Devuelve los precios en pesos para mostrar en `precios.html`. |
| `crear-pago.js` | Crea el link de pago (Polar o Mercado Pago). Manda a Polar el idioma del navegador (si no lo reconoce, español). |
| `webhook-polar.js` | Recibe los avisos de Polar y activa o desactiva el Premium. |
| `webhook-mercadopago.js` | Recibe los avisos de Mercado Pago y activa el Premium. |

## Límites de uso

| Tipo de cuenta | Análisis por día | Largo por texto |
|---|---|---|
| Sin cuenta | 3 | 5.000 caracteres |
| Registrada (gratis) | 10 | 8.000 caracteres |
| Premium | 20 | 20.000 caracteres |

El conteo se valida en el servidor (Supabase). Si Gemini falla, el análisis se le devuelve al cupo. Los números tienen que coincidir entre las funciones, las páginas y `precios.html`.

## Variables de entorno

Se cargan en Cloudflare: **Settings → Variables and Secrets**. Acá solo están los nombres, **nunca escribas valores en el código ni en GitHub**.

| Variable | Para qué |
|---|---|
| `GEMINI_API_KEY` | Clave gratuita de Gemini (anónimos y registrados). |
| `GEMINI_API_KEY_PREMIUM` | Clave paga de Gemini (Premium y países donde Google exige el servicio pago: Espacio Económico Europeo, Reino Unido y Suiza). |
| `GEMINI_MODEL` | Opcional. Cambia el modelo de todas las herramientas a la vez. Por defecto, `gemini-3.5-flash-lite`. |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave secreta de Supabase. |
| `SUPABASE_URL` | Opcional. Si falta, se usa la dirección por defecto. |
| `SITIO_URL` | Dirección del sitio (para volver desde el pago). |
| `POLAR_ACCESS_TOKEN` | Acceso a la API de Polar. |
| `POLAR_PRODUCT_ID` | Plan mensual en Polar. |
| `POLAR_PRODUCT_ID_ANUAL` | Plan anual en Polar. |
| `POLAR_WEBHOOK_SECRET` | Firma de los avisos de Polar. |
| `POLAR_SERVER` | Opcional. `sandbox` para pruebas; vacío es producción real. |
| `MP_ACCESS_TOKEN` | Acceso a la API de Mercado Pago. |
| `MP_PRECIO_ARS` | Precio mensual en pesos. |
| `MP_PRECIO_ARS_ANUAL` | Precio anual en pesos. |
| `MP_WEBHOOK_SECRET` | Firma de los avisos de Mercado Pago. |

## Cómo actualizar el sitio

1. Entrá al repositorio en GitHub.
2. Abrí la carpeta donde va el archivo (`public/` o `functions/api/`).
3. **Add file → Upload files**, subí el archivo y elegí **Commit changes**. Si tiene el mismo nombre, reemplaza al anterior.
4. Cloudflare detecta el cambio y despliega solo. Esperá uno o dos minutos y probá el sitio.

Si después de un cambio el celular sigue mostrando la versión vieja, cambiá el número de `VERSION` en `public/sw.js`.

## Si algo falla

- **Una herramienta da error:** revisá los **Logs** del proyecto en Cloudflare Pages. Los mensajes dicen qué variable falta o qué respondió el servicio.
- **"El modelo no existe":** revisá `GEMINI_MODEL`.
- **"La clave no es válida":** revisá `GEMINI_API_KEY` o `GEMINI_API_KEY_PREMIUM`.
- **Un pago no activa el Premium:** revisá los avisos (webhooks) en el panel de Polar o de Mercado Pago, y los logs de `webhook-polar` o `webhook-mercadopago`.

## Tené en cuenta

- Ningún detector de IA es 100% seguro: el resultado es una señal, no una prueba.
- Los PDF tienen que tener texto seleccionable. Los escaneados (fotos de páginas) no se pueden leer.
- Los archivos subidos se leen en memoria y no se guardan.
