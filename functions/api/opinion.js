// =============================================================================
// functions/api/opinion.js  —  Recibe el "¿Te sirvió?" de la página
// =============================================================================
// Guarda en la tabla public.opiniones de Supabase: si fue útil (sí/no), un
// comentario opcional (hasta 500 caracteres), la página y el "origen" (de dónde
// llegó la persona, si el enlace traía ?origen=...).
// NO guarda el texto analizado, ni el nombre, ni el mail. De la IP guarda solo un
// código ("hash") que sirve para frenar abusos (máximo 5 opiniones por hora).
// Nada se publica solo: las opiniones las ves vos en Supabase (Table Editor).
// =============================================================================

const SUPABASE_URL_POR_DEFECTO = 'https://bprvlyzdnsykwjamumhw.supabase.co';
const ESPERA_SUPABASE_MS = 6000;
const MAX_COMENTARIO = 500;
const MAX_POR_HORA = 5;

function responder(estado, objeto, extra) {
  return new Response(JSON.stringify(objeto), {
    status: estado,
    headers: Object.assign(
      { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      extra || {}
    ),
  });
}

function urlSupabase(env) {
  return String(env.SUPABASE_URL || SUPABASE_URL_POR_DEFECTO).replace(/\/+$/, '');
}

function encabezadosServicio(env) {
  const clave = env.SUPABASE_SERVICE_ROLE_KEY;
  const h = { apikey: clave, 'Content-Type': 'application/json' };
  if (clave.startsWith('eyJ')) h.Authorization = 'Bearer ' + clave;
  return h;
}

async function pedirSupabase(url, opciones) {
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), ESPERA_SUPABASE_MS);
  try {
    return await fetch(url, Object.assign({ signal: control.signal }, opciones));
  } finally {
    clearTimeout(reloj);
  }
}

async function hashear(texto) {
  const datos = new TextEncoder().encode(texto);
  const resumen = await crypto.subtle.digest('SHA-256', datos);
  return Array.from(new Uint8Array(resumen)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Solo aceptamos pedidos que vengan de la propia página.
function origenPermitido(request) {
  const origen = request.headers.get('origin');
  if (!origen) return true;
  try {
    const host = new URL(origen).hostname;
    return host === 'purotexto.com' || host === 'www.purotexto.com' || host.endsWith('.pages.dev') || host === 'localhost';
  } catch (e) {
    return false;
  }
}

function limpiarTexto(valor, largo) {
  return String(valor == null ? '' : valor)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, largo);
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'POST') {
    return responder(405, { error: 'Método no permitido.' }, { Allow: 'POST' });
  }
  if (!origenPermitido(request)) {
    return responder(403, { error: 'Pedido no permitido.' });
  }
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Falta la variable de entorno SUPABASE_SERVICE_ROLE_KEY');
    return responder(500, { error: 'No pudimos guardar tu opinión ahora. Probá más tarde.' });
  }

  const largoPedido = Number(request.headers.get('content-length') || 0);
  if (largoPedido > 5000) return responder(413, { error: 'El mensaje es demasiado largo.' });

  let cuerpo = {};
  try {
    cuerpo = await request.json();
  } catch (e) {
    cuerpo = {};
  }

  if (!cuerpo || (cuerpo.util !== 'si' && cuerpo.util !== 'no')) {
    return responder(400, { error: 'Falta indicar si te sirvió o no.' });
  }
  const util = cuerpo.util === 'si';
  const comentario = limpiarTexto(cuerpo.comentario, MAX_COMENTARIO);
  let pagina = limpiarTexto(cuerpo.pagina, 60);
  if (pagina && pagina.charAt(0) !== '/') pagina = '';
  let origen = limpiarTexto(cuerpo.origen, 40);
  if (!/^[a-zA-Z0-9_-]*$/.test(origen)) origen = '';

  try {
    const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'desconocida';
    const ipHash = await hashear('opinion|' + ip + '|' + env.SUPABASE_SERVICE_ROLE_KEY);

    // Freno de abusos: máximo MAX_POR_HORA opiniones por hora desde la misma conexión.
    const hace1h = new Date(Date.now() - 3600 * 1000).toISOString();
    const consulta =
      urlSupabase(env) + '/rest/v1/opiniones?select=id&ip_hash=eq.' + ipHash +
      '&created_at=gte.' + encodeURIComponent(hace1h) + '&limit=' + MAX_POR_HORA;
    const previas = await pedirSupabase(consulta, { method: 'GET', headers: encabezadosServicio(env) });
    if (previas.ok) {
      const filas = await previas.json();
      if (Array.isArray(filas) && filas.length >= MAX_POR_HORA) {
        return responder(429, { error: 'Ya recibimos varias opiniones tuyas. ¡Gracias! Probá más tarde.' });
      }
    }

    const guardado = await pedirSupabase(urlSupabase(env) + '/rest/v1/opiniones', {
      method: 'POST',
      headers: Object.assign({}, encabezadosServicio(env), { Prefer: 'return=minimal' }),
      body: JSON.stringify({
        util: util,
        comentario: comentario || null,
        pagina: pagina || null,
        origen: origen || null,
        ip_hash: ipHash,
      }),
    });
    if (!guardado.ok) {
      console.error('No se pudo guardar la opinión. Estado:', guardado.status);
      return responder(502, { error: 'No pudimos guardar tu opinión ahora. Probá más tarde.' });
    }
    return responder(200, { ok: true });
  } catch (e) {
    console.error('Error al guardar la opinión:', e && e.name);
    return responder(502, { error: 'No pudimos guardar tu opinión ahora. Probá más tarde.' });
  }
}
