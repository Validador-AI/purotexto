// =============================================================================
// functions/api/webhook-polar.js  —  Avisos de Polar (suscripciones en dólares)
// =============================================================================
// Polar llama a esta dirección (POST /api/webhook-polar) cada vez que pasa algo
// con una suscripción: se crea, se renueva, se cancela, vence, etc.
// Acá se verifica que el aviso sea de verdad de Polar (firma secreta) y se le
// prende o apaga el Premium a la persona en Supabase (profiles).
//
// Variables en Cloudflare:
//   POLAR_WEBHOOK_SECRET (Secret)  — el "Secret" que muestra Polar al crear el webhook (empieza con whsec_)
//   SUPABASE_SERVICE_ROLE_KEY      — ya existente
//
// Eventos que hay que tildar al crear el webhook en Polar:
//   subscription.active, subscription.updated, subscription.canceled,
//   subscription.uncanceled, subscription.revoked, order.paid
//
// Reglas de acceso:
//   · Suscripción activa ........ Premium hasta el fin del período pagado (+2 días de margen)
//   · Cancelada (fin de período)  Premium hasta que termine el período ya pagado
//   · Revocada / impaga ......... Se apaga
//   · Pago fallado (past_due) ... No se cambia nada (Polar reintenta el cobro)
// =============================================================================

const SUPABASE_URL_POR_DEFECTO = 'https://bprvlyzdnsykwjamumhw.supabase.co';
const ESPERA_MS = 8000;
const MARGEN_DIAS = 2;
const DIA_MS = 24 * 60 * 60 * 1000;
const TOLERANCIA_SEG = 5 * 60; // un aviso con más de 5 minutos de antigüedad se rechaza
const FORMATO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function responder(estado, objeto) {
  return new Response(JSON.stringify(objeto), {
    status: estado,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function urlSupabase(env) {
  return String(env.SUPABASE_URL || SUPABASE_URL_POR_DEFECTO).replace(/\/+$/, '');
}

function encabezadosServicio(env) {
  const clave = env.SUPABASE_SERVICE_ROLE_KEY;
  const encabezados = { apikey: clave, 'Content-Type': 'application/json' };
  if (clave.startsWith('eyJ')) encabezados.Authorization = 'Bearer ' + clave;
  return encabezados;
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

// ----- Verificación de la firma (estándar "Standard Webhooks") ----------------
function base64ABytes(texto) {
  const binario = atob(texto);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

async function firmarBase64(contenido, clave) {
  const llave = await crypto.subtle.importKey('raw', clave, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const firma = await crypto.subtle.sign('HMAC', llave, new TextEncoder().encode(contenido));
  let binario = '';
  new Uint8Array(firma).forEach((b) => (binario += String.fromCharCode(b)));
  return btoa(binario);
}

// Compara dos textos sin que el tiempo que tarda delate cuántas letras coinciden.
function iguales(a, b) {
  if (a.length !== b.length) return false;
  let diferencia = 0;
  for (let i = 0; i < a.length; i++) diferencia |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferencia === 0;
}

// Devuelve true si la firma recibida coincide con alguna de las claves posibles.
// Los secretos nuevos de Polar son "Standard Webhooks" (clave = lo que sigue a whsec_, en base64);
// los viejos usaban el texto completo del secreto como clave. Se prueban las dos.
async function firmaValida(env, id, marca, cuerpo, encabezadoFirma) {
  const secreto = String(env.POLAR_WEBHOOK_SECRET).trim();
  const contenido = id + '.' + marca + '.' + cuerpo;

  const claves = [];
  try {
    claves.push(base64ABytes(secreto.startsWith('whsec_') ? secreto.slice(6) : secreto));
  } catch (e) {
    /* el secreto no es base64: se prueba solo la otra forma */
  }
  claves.push(new TextEncoder().encode(secreto));

  // El encabezado puede traer varias firmas: "v1,AAAA v1,BBBB"
  const recibidas = String(encabezadoFirma)
    .split(' ')
    .map((p) => p.trim())
    .filter((p) => p.startsWith('v1,'))
    .map((p) => p.slice(3));
  if (recibidas.length === 0) return false;

  for (const clave of claves) {
    const esperada = await firmarBase64(contenido, clave);
    if (recibidas.some((r) => iguales(r, esperada))) return true;
  }
  return false;
}

// ----- Supabase ---------------------------------------------------------------
// Modifica el perfil. Devuelve cuántas filas cambió (0 = no existe el perfil).
async function actualizarPerfil(env, userId, cambios, filtroExtra) {
  const url =
    urlSupabase(env) + '/rest/v1/profiles?id=eq.' + encodeURIComponent(userId) + (filtroExtra || '');
  const respuesta = await pedir(url, {
    method: 'PATCH',
    headers: Object.assign({}, encabezadosServicio(env), { Prefer: 'return=representation' }),
    body: JSON.stringify(cambios),
  });
  if (!respuesta.ok) throw new Error('profiles respondió ' + respuesta.status);
  const filas = await respuesta.json();
  return Array.isArray(filas) ? filas.length : 0;
}

// Guarda el pago en el registro (si ya estaba, lo ignora).
async function registrarPago(env, userId, referencia, evento, monto, moneda) {
  const respuesta = await pedir(urlSupabase(env) + '/rest/v1/pagos?on_conflict=proveedor,referencia', {
    method: 'POST',
    headers: Object.assign({}, encabezadosServicio(env), {
      Prefer: 'resolution=ignore-duplicates,return=minimal',
    }),
    body: JSON.stringify({
      user_id: userId,
      proveedor: 'polar',
      referencia: String(referencia),
      evento,
      monto,
      moneda,
    }),
  });
  if (!respuesta.ok) console.error('No se pudo registrar el pago. Estado:', respuesta.status);
}

// Saca el user_id (el de Supabase) de un objeto de Polar (suscripción u orden).
function userIdDe(objeto) {
  const deCliente = objeto && objeto.customer && objeto.customer.external_id;
  const deMetadata = objeto && objeto.metadata && objeto.metadata.user_id;
  const id = String(deCliente || deMetadata || '');
  return FORMATO_UUID.test(id) ? id : '';
}

// ----- La función principal ---------------------------------------------------
export async function onRequest(context) {
  const { request } = context;
  // Se sacan espacios o saltos de línea que pudieron quedar al pegar las variables.
  const env = Object.assign({}, context.env);
  ['POLAR_WEBHOOK_SECRET', 'SUPABASE_SERVICE_ROLE_KEY'].forEach((k) => {
    if (typeof env[k] === 'string') env[k] = env[k].trim();
  });

  if (request.method !== 'POST') return responder(405, { error: 'Método no permitido.' });
  const falta = [];
  if (!env.POLAR_WEBHOOK_SECRET) falta.push('POLAR_WEBHOOK_SECRET');
  if (!env.SUPABASE_SERVICE_ROLE_KEY) falta.push('SUPABASE_SERVICE_ROLE_KEY');
  if (falta.length) {
    console.error('Faltan variables:', falta.join(', '));
    // TEMPORAL (diagnóstico): se muestra cuáles faltan y qué nombres de variables ve el sitio
    // (solo nombres, nunca valores) para detectar espacios o letras de más. Se saca después.
    const vistas = Object.keys(context.env).filter((k) => /polar|supabase/i.test(k));
    return responder(500, { error: 'No configurado. Falta: ' + falta.join(', '), variables_vistas: vistas });
  }

  // 1) Verificar la firma. Se usa el cuerpo EXACTO, sin tocar.
  const cuerpoTexto = await request.text();
  const id = request.headers.get('webhook-id') || '';
  const marca = request.headers.get('webhook-timestamp') || '';
  const firma = request.headers.get('webhook-signature') || '';

  const segundos = Number(marca);
  const ahoraSeg = Math.floor(Date.now() / 1000);
  if (!id || !firma || !Number.isFinite(segundos) || Math.abs(ahoraSeg - segundos) > TOLERANCIA_SEG) {
    console.warn('Webhook de Polar con encabezados inválidos o fuera de hora');
    return responder(403, { error: 'Aviso inválido.' });
  }
  if (!(await firmaValida(env, id, marca, cuerpoTexto, firma))) {
    console.warn('Webhook de Polar con firma inválida');
    return responder(403, { error: 'Firma inválida.' });
  }

  let aviso;
  try {
    aviso = JSON.parse(cuerpoTexto);
  } catch (e) {
    return responder(400, { error: 'Cuerpo inválido.' });
  }

  const evento = String((aviso && aviso.type) || '');
  const dato = (aviso && aviso.data) || {};

  try {
    // 2) Pagos: se anotan en el registro (comprobantes).
    if (evento === 'order.paid') {
      const userId = userIdDe(dato);
      if (userId) {
        const centavos = Number(dato.total_amount);
        await registrarPago(
          env,
          userId,
          dato.id,
          evento,
          Number.isFinite(centavos) ? centavos / 100 : null,
          dato.currency ? String(dato.currency).toUpperCase() : null
        );
      } else {
        console.error('order.paid de Polar sin user_id válido');
      }
      return responder(200, { ok: true });
    }

    // 3) Cambios de estado de la suscripción: prender o apagar Premium.
    if (!evento.startsWith('subscription.')) return responder(200, { ok: true, ignorado: true });

    const userId = userIdDe(dato);
    if (!userId) {
      console.error('Aviso de Polar sin user_id (¿pago de prueba hecho a mano?). Evento:', evento);
      return responder(200, { ok: true, ignorado: true });
    }

    const estado = String(dato.status || '');
    const ahora = Date.now();

    if (estado === 'active' || estado === 'trialing') {
      const finPeriodo = dato.current_period_end ? new Date(dato.current_period_end).getTime() : NaN;
      const base = Number.isFinite(finPeriodo) ? finPeriodo : ahora + 33 * DIA_MS;
      // Si ya pidió cancelar, no hay renovación pendiente: no hace falta margen.
      const margen = dato.cancel_at_period_end ? 0 : MARGEN_DIAS * DIA_MS;
      const filas = await actualizarPerfil(env, userId, {
        is_premium: true,
        premium_hasta: new Date(base + margen).toISOString(),
        premium_proveedor: 'polar',
      });
      if (filas === 0) throw new Error('No existe el perfil del usuario');
    } else if (estado === 'canceled' || estado === 'unpaid' || estado === 'incomplete_expired') {
      // Solo se apaga si el Premium actual vino de Polar (no pisar uno pagado con Mercado Pago).
      await actualizarPerfil(
        env,
        userId,
        { is_premium: false, premium_hasta: new Date().toISOString() },
        '&premium_proveedor=eq.polar'
      );
    }
    // past_due, incomplete: no se toca nada.

    return responder(200, { ok: true });
  } catch (e) {
    // Un 500 le dice a Polar que reintente más tarde.
    console.error('Error procesando webhook de Polar:', evento, e && e.message);
    return responder(500, { error: 'Error al procesar.' });
  }
}
