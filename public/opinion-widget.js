// opinion.js — cuadro "¿Te sirvió este análisis?" debajo del resultado (solo en el inicio)
(function () {
  'use strict';
  var caja = document.getElementById('opinion-caja');
  var resultados = document.getElementById('resultados');
  if (!caja) return;

  // Si el enlace traía ?origen=reddit (o instagram, etc.), lo recordamos para esta visita.
  try {
    var o = new URLSearchParams(location.search).get('origen');
    if (o && /^[a-zA-Z0-9_-]{1,40}$/.test(o)) sessionStorage.setItem('pt_origen', o);
  } catch (e) {}

  var css = document.createElement('style');
  css.textContent =
    '.pt-op{margin:28px auto 0;max-width:560px;padding:18px 20px;border-radius:16px;' +
    'background:var(--superficie,#F5EFE7);border:1px solid var(--linea,#D2C4AF);text-align:center;color:#264B4A}' +
    '.pt-op p{margin:0}' +
    '.pt-op-titulo{font-weight:600;margin-bottom:12px!important}' +
    '.pt-op-botones{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}' +
    '.pt-op button{font:inherit;cursor:pointer;border-radius:999px;padding:9px 18px;' +
    'border:1px solid var(--linea-fuerte,#BCAD97);background:var(--arena-claro,#DFD2BD);color:#264B4A}' +
    '.pt-op button:hover{border-color:#B84E2E}' +
    '.pt-op button[aria-pressed="true"]{background:#264B4A;color:#F5EFE7;border-color:#264B4A}' +
    '.pt-op-detalle{margin-top:14px;text-align:left}' +
    '.pt-op-detalle label{display:block;font-size:.9rem;margin-bottom:6px}' +
    '.pt-op textarea{width:100%;box-sizing:border-box;min-height:70px;resize:vertical;font:inherit;' +
    'font-size:.95rem;padding:10px;border-radius:10px;border:1px solid var(--linea-fuerte,#BCAD97);' +
    'background:#fff8;color:#264B4A}' +
    '.pt-op-nota{font-size:.8rem;opacity:.8;margin-top:6px!important}' +
    '.pt-op .pt-op-enviar{margin-top:10px;background:#B84E2E;color:#fff;border-color:#B84E2E}' +
    '.pt-op-gracias{font-weight:600}.pt-op-error{color:#9A3A1F;font-size:.9rem;margin-top:8px!important}';
  document.head.appendChild(css);

  var voto = null;

  function armar() {
    voto = null;
    caja.innerHTML =
      '<div class="pt-op">' +
      '<p class="pt-op-titulo">¿Te sirvió este análisis?</p>' +
      '<div class="pt-op-botones">' +
      '<button type="button" data-v="si" aria-pressed="false">👍 Sí</button>' +
      '<button type="button" data-v="no" aria-pressed="false">👎 No mucho</button>' +
      '</div>' +
      '<div class="pt-op-detalle" hidden>' +
      '<label for="pt-op-texto">¿Querés contarnos algo? (opcional)</label>' +
      '<textarea id="pt-op-texto" maxlength="500"></textarea>' +
      '<p class="pt-op-nota">No escribas datos personales ni textos privados.</p>' +
      '<button type="button" class="pt-op-enviar">Enviar</button>' +
      '<p class="pt-op-error" role="alert" hidden></p>' +
      '</div>' +
      '</div>';

    var botones = caja.querySelectorAll('[data-v]');
    var detalle = caja.querySelector('.pt-op-detalle');
    botones.forEach(function (b) {
      b.addEventListener('click', function () {
        voto = b.getAttribute('data-v');
        botones.forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        detalle.hidden = false;
      });
    });
    caja.querySelector('.pt-op-enviar').addEventListener('click', enviar);
  }

  function enviar() {
    if (!voto) return;
    var btn = caja.querySelector('.pt-op-enviar');
    var err = caja.querySelector('.pt-op-error');
    err.hidden = true;
    btn.disabled = true;
    var origen = '';
    try { origen = sessionStorage.getItem('pt_origen') || ''; } catch (e) {}
    fetch('/api/opinion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        util: voto,
        comentario: caja.querySelector('#pt-op-texto').value,
        pagina: location.pathname,
        origen: origen
      })
    })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (x) {
        if (x.ok) {
          caja.innerHTML = '<div class="pt-op"><p class="pt-op-gracias">¡Gracias por tu opinión!</p></div>';
        } else {
          err.textContent = (x.d && x.d.error) || 'No pudimos enviar tu opinión. Probá de nuevo.';
          err.hidden = false;
          btn.disabled = false;
        }
      })
      .catch(function () {
        err.textContent = 'No pudimos enviar tu opinión. Revisá tu conexión.';
        err.hidden = false;
        btn.disabled = false;
      });
  }

  // ---- Compartir: WhatsApp y copiar enlace (solo comparte el enlace del sitio, nunca el texto) ----
  var ENLACE = 'https://purotexto.com/?origen=compartido';
  var MENSAJE = 'Probé este detector de IA en español, gratis y sin registro: ' + ENLACE;

  var estiloComp = document.createElement('style');
  estiloComp.textContent =
    '.pt-comp{margin:14px auto 0;max-width:560px;text-align:center;color:#264B4A}' +
    '.pt-comp p{margin:0 0 10px;font-size:.9rem}' +
    '.pt-comp-botones{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}' +
    '.pt-comp a,.pt-comp button{font:inherit;font-size:.95rem;cursor:pointer;text-decoration:none;' +
    'border-radius:999px;padding:9px 18px;border:1px solid #BCAD97;background:#DFD2BD;color:#264B4A}' +
    '.pt-comp a:hover,.pt-comp button:hover{border-color:#B84E2E}' +
    '.pt-comp-ok{min-height:1.2em;font-size:.85rem;margin-top:8px!important}';
  document.head.appendChild(estiloComp);

  var comp = document.createElement('div');
  comp.className = 'pt-comp';
  comp.innerHTML =
    '<p>¿Conocés a alguien a quien le pueda servir?</p>' +
    '<div class="pt-comp-botones">' +
    '<a href="https://wa.me/?text=' + encodeURIComponent(MENSAJE) + '" target="_blank" rel="noopener">Compartir por WhatsApp</a>' +
    '<button type="button" class="pt-comp-copiar">Copiar enlace</button>' +
    '</div>' +
    '<p class="pt-comp-ok" role="status"></p>';
  caja.parentNode.insertBefore(comp, caja.nextSibling);

  comp.querySelector('.pt-comp-copiar').addEventListener('click', function () {
    var aviso = comp.querySelector('.pt-comp-ok');
    function listo(ok) {
      aviso.textContent = ok ? '¡Enlace copiado!' : 'No pudimos copiarlo. Copialo a mano: ' + ENLACE;
      setTimeout(function () { aviso.textContent = ''; }, 4000);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(ENLACE).then(function () { listo(true); }, function () { listo(false); });
    } else {
      listo(false);
    }
  });

  armar();

  // Cada vez que aparece un resultado nuevo, el cuadro vuelve a empezar.
  if (resultados && window.MutationObserver) {
    new MutationObserver(function () { if (!resultados.hidden) armar(); })
      .observe(resultados, { attributes: true, attributeFilter: ['hidden'] });
  }
})();
