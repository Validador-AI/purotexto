// =============================================================================
// functions/api/crear-pago.js  —  Crea el link de pago de Premium
// =============================================================================
// La página (precios.html) le pide acá el link de pago, indicando con qué quiere
// pagar. Esta función verifica quién es la persona (por su sesión de Supabase),
// le pide el link al proveedor y se lo devuelve. Responde en /api/crear-pago.
//
//   POST /api/crear-pago
//   Encabezado:  Authorization: Bearer <token de sesión>
//   Cuerpo:      { "proveedor": "polar" | "mercadopago", "periodo": "mensual" | "anual" }
//                (si falta "periodo", se toma "mensual")
//   Respuesta:   200 { url }   |   4xx/5xx { error }
//
// Variables en Cloudflare (Settings → Variables and Secrets):
//   Ya existentes:  SUPABASE_SERVICE_ROLE_KEY (Secret)
//   Polar (dólares): POLAR_ACCESS_TOKEN (Secret), POLAR_PRODUCT_ID (plan mensual),
//                   POLAR_PRODUCT_ID_ANUAL (plan anual),
//                   POLAR_SERVER (opcional: "sandbox" para pruebas; vacío = producción real)
//   Mercado Pago:   MP_ACCESS_TOKEN (Secret),
//                   MP_PRECIO_ARS (mensual, ej: 14900), MP_PRECIO_ARS_ANUAL (ej: 149000)
//   Opcional:       SITIO_URL (por defecto https://purotexto.com)
//
// IMPORTANTE: el user_id viaja al proveedor como dato "propio" del pago (en Polar,
// como external_customer_id). Después
// el webhook lo usa para saber a quién activarle el Premium. Sale siempre del
// token verificado acá, nunca de lo que mande la página.
// =============================================================================

const SUPABASE_URL_POR_DEFECTO = 'https://bprvlyzdnsykwjamumhw.supabase.co';
const SITIO_POR_DEFECTO = 'https://purotexto.com';
const ESPERA_MS = 10000;

function responder(estado, objeto) {
  return new Response(JSON.stringify(objeto), {
    status: estado,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function urlSupabase(env) {
  return String(env.SUPABASE_URL || SUPABASE_URL_POR_DEFECTO).replace(/\/+$/, '');
}

function urlSitio(env) {
  return String(env.SITIO_URL || SITIO_POR_DEFECTO).replace(/\/+$/, '');
}

async function pedir(url, opciones) {
  const control = new AbortController();
  const temporizador = setTimeout(() => control.abort(), ESPERA_MS);
  try {
    return await fetch(url, Object.assign({ signal: control.signal }, opciones));
  } finally {
    clearTimeout(temporizador);
  }
}

function encabezadosServicio(env) {
  const clave = env.SUPABASE_SERVICE_ROLE_KEY;
  const encabezados = { apikey: clave, 'Content-Type': 'application/json' };
  if (clave.startsWith('eyJ')) encabezados.Authorization = 'Bearer ' + clave;
  return encabezados;
}

// Le pregunta a Supabase de quién es el token. Devuelve { id, email } o null.
async function usuarioDelToken(env, token) {
  const respuesta = await pedir(urlSupabase(env) + '/auth/v1/user', {
    method: 'GET',
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + token },
  });
  if (respuesta.status === 401 || respuesta.status === 403) return null;
  if (!respuesta.ok) throw new Error('Supabase auth respondió ' + respuesta.status);
  const usuario = await respuesta.json();
  return usuario && usuario.id ? { id: usuario.id, email: usuario.email || '' } : null;
}

// Lee el estado Premium actual de la persona.
async function perfilPremium(env, userId) {
  const url =
    urlSupabase(env) +
    '/rest/v1/profiles?select=is_premium,premium_hasta,premium_proveedor&limit=1&id=eq.' +
    encodeURIComponent(userId);
  const respuesta = await pedir(url, { method: 'GET', headers: encabezadosServicio(env) });
  if (!respuesta.ok) throw new Error('profiles respondió ' + respuesta.status);
  const filas = await respuesta.json();
  return Array.isArray(filas) && filas.length > 0 ? filas[0] : null;
}

// Idioma del checkout de Polar: el primero de la lista del navegador que Polar tenga traducido.
// Si no hay ninguno, español (el idioma del sitio).
const IDIOMAS_POLAR = ['es', 'en', 'fr', 'de', 'nl', 'sv'];
function idiomaCheckout(request) {
  const cabecera = request.headers.get('accept-language') || '';
  for (const parte of cabecera.split(',')) {
    const codigo = parte.split(';')[0].trim().toLowerCase().split('-')[0];
    if (IDIOMAS_POLAR.includes(codigo)) return codigo;
  }
  return 'es';
}

// ----- Polar: suscripción en dólares (tarjeta) --------------------------------
// Polar actúa como "Merchant of Record": es quien vende, cobra y se ocupa de los impuestos.
async function crearLinkPolar(env, usuario, periodo, ip, idioma) {
  const producto = periodo === 'anual' ? env.POLAR_PRODUCT_ID_ANUAL : env.POLAR_PRODUCT_ID;
  const base =
    String(env.POLAR_SERVER || '').trim().toLowerCase() === 'sandbox'
      ? 'https://sandbox-api.polar.sh'
      : 'https://api.polar.sh';
  const sitio = urlSitio(env);

  const cuerpo = {
    products: [String(producto).trim()],
    external_customer_id: usuario.id, // vuelve en el webhook: data.customer.external_id
    metadata: { user_id: usuario.id, periodo }, // se copia a la suscripción
    success_url: sitio + '/cuenta.html?pago=ok',
    return_url: sitio + '/precios.html',
    locale: idioma, // idioma del checkout de Polar
  };
  if (usuario.email) cuerpo.customer_email = usuario.email;
  // Para que Polar detecte bien el país (impuestos y moneda) hay que pasarle la IP real de la persona.
  if (ip) cuerpo.customer_ip_address = ip;

  const respuesta = await pedir(base + '/v1/checkouts/', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Polar-Version': '2026-10',
      Authorization: 'Bearer ' + String(env.POLAR_ACCESS_TOKEN).trim(),
    },
    body: JSON.stringify(cuerpo),
  });
  const datos = await respuesta.json().catch(() => null);
  if (!respuesta.ok) {
    console.error('Polar rechazó el checkout. Estado:', respuesta.status, JSON.stringify(datos && (datos.detail || datos.error || datos)));
    throw new Error('polar');
  }
  const url = datos && datos.url;
  if (!url) throw new Error('Polar no devolvió el link');
  return url;
}

// ----- Mercado Pago: pago único de 30 días, en pesos --------------------------
async function crearLinkMercadoPago(env, usuario, periodo) {
  const anual = periodo === 'anual';
  const precio = Number(anual ? env.MP_PRECIO_ARS_ANUAL : env.MP_PRECIO_ARS);
  if (!Number.isFinite(precio) || precio <= 0) throw new Error('Falta el precio en pesos del plan ' + periodo);
  const sitio = urlSitio(env);

  const respuesta = await pedir('https://api.mercadopago.com/checkout/preferences', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + env.MP_ACCESS_TOKEN,
    },
    body: JSON.stringify({
      items: [
        {
          id: anual ? 'premium-365-dias' : 'premium-30-dias',
          title: anual ? 'PuroTexto Premium (1 año)' : 'PuroTexto Premium (30 días)',
          quantity: 1,
          currency_id: 'ARS',
          unit_price: precio,
        },
      ],
      payer: usuario.email ? { email: usuario.email } : undefined,
      external_reference: usuario.id, // vuelve en el pago: es el user_id
      metadata: { periodo: anual ? 'anual' : 'mensual' }, // el webhook lo usa para saber cuántos días sumar
      notification_url: sitio + '/api/webhook-mercadopago',
      back_urls: {
        success: sitio + '/cuenta.html?pago=ok',
        pending: sitio + '/cuenta.html?pago=pendiente',
        failure: sitio + '/precios.html?pago=error',
      },
      auto_return: 'approved',
      statement_descriptor: 'PUROTEXTO',
    }),
  });
  const datos = await respuesta.json().catch(() => null);
  if (!respuesta.ok) {
    console.error('Mercado Pago rechazó la preferencia. Estado:', respuesta.status, JSON.stringify(datos && datos.message));
    throw new Error('mercadopago');
  }
  // Si el access token es de PRUEBA, init_point igual sirve con usuarios de prueba.
  const url = datos && datos.init_point;
  if (!url) throw new Error('Mercado Pago no devolvió el link');
  return url;
}

// ----- La función principal ---------------------------------------------------
export async function onRequest(context) {
  const { request } = context;
  // Se sacan espacios o saltos de línea que pudieron quedar al pegar las variables.
  const env = Object.assign({}, context.env);
  ['SUPABASE_SERVICE_ROLE_KEY', 'POLAR_ACCESS_TOKEN', 'POLAR_PRODUCT_ID', 'POLAR_PRODUCT_ID_ANUAL', 'MP_ACCESS_TOKEN', 'MP_PRECIO_ARS', 'MP_PRECIO_ARS_ANUAL'].forEach((k) => {
    if (typeof env[k] === 'string') env[k] = env[k].trim();
  });

  // Después de pagar se vuelve al MISMO dominio desde el que se pagó (con o sin www).
  // La sesión se guarda por dominio: si se volviera al otro, la persona aparecería sin sesión iniciada.
  try {
    const origen = new URL(request.url);
    if (origen.hostname === 'purotexto.com' || origen.hostname === 'www.purotexto.com') env.SITIO_URL = origen.origin;
  } catch (e) {
    /* se usa la dirección por defecto */
  }

  if (request.method !== 'POST') {
    return responder(405, { error: 'Método no permitido.' });
  }
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Falta SUPABASE_SERVICE_ROLE_KEY');
    return responder(500, { error: 'El servidor no está configurado todavía.' });
  }

  try {
    // 1) ¿Quién es? Hace falta sesión para pagar.
    const m = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') || '');
    if (!m) {
      return responder(401, { codigo: 'sin_sesion', error: 'Iniciá sesión para pasarte a Premium.' });
    }
    const usuario = await usuarioDelToken(env, m[1].trim());
    if (!usuario) {
      return responder(401, { codigo: 'sesion_invalida', error: 'Tu sesión venció. Volvé a iniciar sesión.' });
    }

    // 2) ¿Qué proveedor eligió?
    let cuerpo = {};
    try {
      cuerpo = await request.json();
    } catch (e) {
      cuerpo = {};
    }
    const proveedor = cuerpo && cuerpo.proveedor;
    if (proveedor !== 'polar' && proveedor !== 'mercadopago') {
      return responder(400, { error: 'Elegí cómo querés pagar.' });
    }

    const periodo = cuerpo && cuerpo.periodo === 'anual' ? 'anual' : 'mensual';

    // 3) Si ya tiene una suscripción activa con tarjeta (Polar), no dejamos crear otra
    // (se cobraría doble). Con Mercado Pago sí se puede pagar de nuevo: suma 30 días.
    const perfil = await perfilPremium(env, usuario.id);
    const vigente = perfil && perfil.is_premium === true && (!perfil.premium_hasta || new Date(perfil.premium_hasta) > new Date());
    if (vigente && proveedor === 'polar' && perfil.premium_proveedor === 'polar') {
      return responder(409, { error: 'Ya tenés una suscripción Premium activa con tarjeta. Para cambiar de plan, escribinos a hola@purotexto.com.' });
    }

    // 4) Pedirle el link al proveedor.
    let url;
    if (proveedor === 'polar') {
      const productoElegido = periodo === 'anual' ? env.POLAR_PRODUCT_ID_ANUAL : env.POLAR_PRODUCT_ID;
      if (!env.POLAR_ACCESS_TOKEN || !productoElegido) {
        console.error('Faltan variables de Polar');
        return responder(503, { error: 'El pago con tarjeta todavía no está disponible.' });
      }
      const ip = request.headers.get('CF-Connecting-IP') || '';
      url = await crearLinkPolar(env, usuario, periodo, ip, idiomaCheckout(request));
    } else {
      const precioElegido = periodo === 'anual' ? env.MP_PRECIO_ARS_ANUAL : env.MP_PRECIO_ARS;
      if (!env.MP_ACCESS_TOKEN || !precioElegido) {
        console.error('Faltan variables de Mercado Pago');
        return responder(503, { error: 'El pago con Mercado Pago todavía no está disponible.' });
      }
      url = await crearLinkMercadoPago(env, usuario, periodo);
    }

    return responder(200, { url });
  } catch (e) {
    console.error('Error en /api/crear-pago:', e && e.name, e && e.message);
    // Se usa 500 y no 502: Cloudflare reemplaza cualquier 502 por su propia página de error y el mensaje no llega.
    return responder(500, { error: 'No pudimos armar el pago. Probá de nuevo en unos minutos.' });
  }
}
