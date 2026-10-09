/* Big Insane 3D · Preparador · interface */
(function () {
  'use strict';
  var B = window.BI3D, esc = B.esc, fmt = B.fmt;
  var $ = function (id) { return document.getElementById(id); };
  var TARGETS = [
    { id: 'kobra4', name: 'Anycubic Kobra 4', slicer: 'Anycubic Slicer Next', slots: 4 },
    { id: 'kobrax', name: 'Anycubic Kobra X', slicer: 'Anycubic Slicer Next', slots: 4 },
    { id: 'a1mini', name: 'Bambu Lab A1 mini', slicer: 'Bambu Studio', slots: 4 },
    { id: 'a1', name: 'Bambu Lab A1', slicer: 'Bambu Studio', slots: 4 },
    { id: 'ad5x', name: 'Flashforge AD5X', slicer: 'Orca-Flashforge', slots: 4 }
  ];
  var file = null, worker = null, tplCache = {};

  function pref(k, v) { try { if (v === undefined) return localStorage.getItem('bi3d_prep_' + k); localStorage.setItem('bi3d_prep_' + k, v); } catch (e) { return null; } }
  function target() { var id = $('pp-printer').value; for (var i = 0; i < TARGETS.length; i++) if (TARGETS[i].id === id) return TARGETS[i]; return TARGETS[0]; }

  function calibFor(pid, mat) {
    var list = B.loadCaderno().filter(function (c) { return c.printer === pid && c.material === mat; });
    if (!list.length) return null;
    var c = list[list.length - 1], n = function (v) { var x = B.num(v); return x > 0 ? x : 0; };
    return { name: c.name, temp: n(c.temp), bed: n(c.bed), pa: n(c.pa), flow: n(c.flow), vol: n(c.vol), retr: n(c.retr), fan: n(c.fan) };
  }

  function showCalib() {
    var c = calibFor($('pp-printer').value, $('pp-mat').value);
    $('pp-calib').innerHTML = c ? 'Vou usar os valores do seu caderno: <b>' + esc(c.name) + '</b>.' :
      'Sem valores no seu <a href="caderno.html">caderno de calibração</a> para essa combinação: uso o perfil oficial do fabricante.';
  }

  function pick(f) {
    if (!f) return;
    if (!/\.(3mf|stl)$/i.test(f.name)) { err('Use um arquivo .3mf ou .stl.'); return; }
    if (f.size > 300 * 1024 * 1024) { err('Arquivo acima de 300 MB. Simplifique a malha antes.'); return; }
    file = f;
    $('pp-file').innerHTML = '<b>' + esc(f.name) + '</b> · ' + fmt(f.size / 1048576, 1) + ' MB';
    $('pp-go').disabled = false; $('pp-out').innerHTML = '';
  }

  function err(msg) { $('pp-prog').style.display = 'none'; $('pp-out').innerHTML = '<div class="box warn"><b>Não deu certo</b><p>' + esc(msg) + '</p></div>'; }

  function loadTpl(id) {
    if (tplCache[id]) return Promise.resolve(tplCache[id]);
    return fetch('perfis-oficiais/' + id + '.json').then(function (r) { if (!r.ok) throw new Error('Perfil da impressora não encontrado.'); return r.json(); })
      .then(function (j) { tplCache[id] = j; return j; });
  }

  function go() {
    if (!file) return;
    var t = target(), mat = $('pp-mat').value, goal = $('pp-goal').value;
    pref('printer', t.id); pref('mat', mat); pref('goal', goal);
    var quality = goal === 'miniatura' ? 'mini' : $('pp-quality').value;
    var opts = { target: t.id, material: mat, quality: quality, goal: goal, calib: calibFor(t.id, mat), slots: t.slots,
      keepOrientation: $('pp-keep').checked, purge: { tower: !$('pp-notower').checked },
      copies: Math.max(1, Math.min(50, parseInt($('pp-copies').value, 10) || 1)),
      split: $('pp-split').checked, connector: $('pp-conn').value, rod: +$('pp-rod').value,
      magnet: (function (v) { var a = v.split('x').map(Number); return { d: a[0], t: a[1] }; })($('pp-mag').value) };
    $('pp-go').disabled = true; $('pp-out').innerHTML = '';
    $('pp-prog').style.display = 'block'; prog(0.02, 'Carregando os perfis oficiais da ' + t.name + '…');
    Promise.all([loadTpl(t.id), file.arrayBuffer()]).then(function (a) {
      if (worker) worker.terminate();
      worker = new Worker('js/preparar-worker.js?v=20261009f');
      worker.onmessage = function (ev) {
        var m = ev.data;
        if (m.type === 'progress') prog(m.p, m.text);
        else if (m.type === 'error') { err(m.msg); $('pp-go').disabled = false; }
        else { done(m.result, t, mat, goal, opts); $('pp-go').disabled = false; worker.terminate(); worker = null; }
      };
      worker.onerror = function (e) { err('Erro ao processar: ' + (e.message || 'desconhecido')); $('pp-go').disabled = false; };
      worker.postMessage({ buffer: a[1], name: file.name, tpl: a[0], opts: opts }, [a[1]]);
    }).catch(function (e) { err(e.message); $('pp-go').disabled = false; });
  }

  function prog(p, text) { $('pp-bar').style.width = Math.round(p * 100) + '%'; $('pp-plabel').textContent = text || ''; }

  function done(r, t, mat, goal, opts) {
    prog(1, 'Pronto.');
    var base = file.name.replace(/\.(gcode\.)?(3mf|stl)$/i, '');
    var outName = base + '_' + t.id + '_' + mat + '.3mf';
    var url = URL.createObjectURL(r.blob);
    var h = ['<div class="rx-verdict ' + (r.warnings && r.warnings.length ? 'warn' : 'good') + '"><div class="rx-score">✓</div><div><b>Pronto para a sua ' + esc(t.name) + '</b><p>' +
      esc(mat) + ' · ' + ({ decorativa: 'peça decorativa', funcional: 'peça funcional', miniatura: 'miniatura' })[goal] + (opts.calib ? ' · com o seu caderno' : '') + '</p></div></div>'];
    if (r.blobs && r.blobs.length > 1) {
      h.push('<div class="btns" style="margin:4px 0 24px">' + r.blobs.map(function (b, i) {
        return '<a class="' + (i ? 'ghost' : 'cta') + '" href="' + URL.createObjectURL(b) + '" download="' + esc(outName.replace(/\.3mf$/, '_mesa' + (i + 1) + '.3mf')) + '">Baixar mesa ' + (i + 1) + '</a>';
      }).join('') + '</div>');
    } else h.push('<div class="btns" style="margin:4px 0 24px"><a class="cta" id="pp-dl" href="' + url + '" download="' + esc(outName) + '">Baixar projeto pronto (.3mf)</a></div>');
    if (r.preview && r.preview.plates && window.THREE) {
      h.push('<div class="pp-plates">' + r.preview.plates.map(function (pl, i) { return '<button type="button" class="dg-opt' + (i ? '' : ' on') + '" data-plate="' + i + '">Mesa ' + (i + 1) + ' · ' + pl.length + ' peça' + (pl.length > 1 ? 's' : '') + '</button>'; }).join('') + '</div>');
      h.push('<div class="view3d" id="pp-3d"><div class="view3d-help">Arraste para girar · role para aproximar · cada parte numa cor · pinos em cinza</div></div>');
    }
    if (r.preview && r.preview.tri && window.THREE) h.push('<div class="view3d" id="pp-3d"><div class="view3d-help">Arraste para girar · role para aproximar · <span class="v-red">vermelho</span> = área em balanço</div></div>');
    (r.warnings || []).forEach(function (w) { h.push('<div class="rx-item aviso"><span class="rx-tag">Atenção</span><div><p>' + esc(w) + '</p></div></div>'); });
    if (r.mesh) {
      var m = r.mesh, overB = m.before.total ? m.before.over / m.before.total * 100 : 0, overA = m.after.total ? m.after.over / m.after.total * 100 : 0;
      h.push('<div class="rx-cards" style="margin-top:16px">');
      [['Tamanho', m.size.map(function (x) { return Math.round(x); }).join(' × ') + ' mm'], ['Volume', fmt(m.volume / 1000, 1) + ' cm³'],
       ['Peso aproximado', fmt(m.volume / 1000 * (mat === 'PETG' ? 1.27 : 1.24) * 0.45, 0) + ' g'], ['Posição', m.rotated ? 'girada para imprimir melhor' : 'mantida a original'],
       ['Área apoiada na mesa', fmt(m.after.base / 100, 1) + ' cm²'], ['Área em balanço', fmt(overA, 0) + '%' + (m.rotated ? ' (antes ' + fmt(overB, 0) + '%)' : '')]
      ].forEach(function (c) { h.push('<div class="rx-card"><span>' + c[0] + '</span><b>' + esc(c[1]) + '</b></div>'); });
      h.push('</div><p class="rx-note">Peso aproximado com paredes e 15% de preenchimento. O fatiador dá o valor exato.</p>');
    } else if (r.nFil) {
      h.push('<p class="rx-note">Projeto de ' + esc(r.from || 'outra impressora') + ' com ' + r.nFil + ' cor(es) e ' + r.plates + ' placa(s). O modelo, as cores pintadas e as escolhas do criador foram mantidos.</p>');
    }
    h.push('<h3>O que eu fiz por você</h3><ul class="pp-list">');
    r.changes.forEach(function (c) { h.push('<li>' + esc(c) + '</li>'); });
    h.push('</ul>');
    h.push('<h3>Agora é só</h3><ol class="pp-list"><li>Abra o arquivo no <b>' + esc(t.slicer) + '</b>. Se ele perguntar, escolha carregar as configurações do projeto.</li>' +
      '<li>Clique em <b>Fatiar</b> e confira a prévia.</li><li>Quer conferir antes de imprimir? Exporte o G-code e arraste no <a href="raiox.html">Raio-X</a>.</li></ol>');
    $('pp-out').innerHTML = h.join('');
    if (r.preview && r.preview.plates && window.BI3D_VIEW) {
      var PAL = ['#ff8a3d', '#5aa9e6', '#7ed957', '#e66bd1', '#f2c94c', '#9b8cff', '#4fd1c5', '#ff6b6b'];
      var showPlate = function (k) {
        var n = 0, meshes = r.preview.plates[k].map(function (o) { return { tri: o.tri, color: o.kind === 'pino' ? '#9aa3ae' : PAL[(n++) % PAL.length], positions: [[o.x, o.y]] }; });
        try { BI3D_VIEW.show($('pp-3d'), meshes, r.preview.bed, { showBed: true }); } catch (e) { $('pp-3d').innerHTML = '<p class="rx-note" style="padding:16px">Seu navegador não conseguiu abrir a visualização 3D.</p>'; }
        Array.prototype.forEach.call(document.querySelectorAll('.pp-plates button'), function (b) { b.classList.toggle('on', +b.getAttribute('data-plate') === k); });
      };
      Array.prototype.forEach.call(document.querySelectorAll('.pp-plates button'), function (b) { b.addEventListener('click', function () { showPlate(+b.getAttribute('data-plate')); }); });
      showPlate(0);
    }
    if (r.preview && r.preview.tri && window.THREE && window.BI3D_VIEW) {
      try { BI3D_VIEW.show($('pp-3d'), [{ tri: r.preview.tri, color: mat === 'PETG' ? '#9fb7c9' : '#e6e0d8', overhang: true, positions: r.preview.centers }], r.preview.bed, { showBed: true }); }
      catch (e) { $('pp-3d').innerHTML = '<p class="rx-note" style="padding:16px">Seu navegador não conseguiu abrir a visualização 3D.</p>'; }
    }
    $('pp-out').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  document.addEventListener('DOMContentLoaded', function () {
    $('pp-printer').innerHTML = TARGETS.map(function (t) { return '<option value="' + t.id + '">' + esc(t.name) + '</option>'; }).join('');
    var p = pref('printer'), m = pref('mat'), g = pref('goal');
    if (p) $('pp-printer').value = p; if (m) $('pp-mat').value = m; if (g) $('pp-goal').value = g;
    ['pp-printer', 'pp-mat'].forEach(function (id) { $(id).addEventListener('change', showCalib); });
    showCalib();
    var dz = $('pp-drop'), inp = $('pp-input');
    dz.addEventListener('click', function () { inp.click(); });
    dz.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inp.click(); } });
    inp.addEventListener('change', function () { pick(inp.files[0]); });
    ['dragenter', 'dragover'].forEach(function (ty) { dz.addEventListener(ty, function (e) { e.preventDefault(); dz.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (ty) { dz.addEventListener(ty, function (e) { e.preventDefault(); dz.classList.remove('over'); }); });
    dz.addEventListener('drop', function (e) { pick(e.dataTransfer.files[0]); });
    $('pp-go').addEventListener('click', go);
    Array.prototype.forEach.call(document.querySelectorAll('.pp-try button'), function (b) {
      b.addEventListener('click', function () {
        var src = b.getAttribute('data-ex'); b.disabled = true;
        fetch(src).then(function (r) { if (!r.ok) throw new Error('Exemplo não encontrado.'); return r.blob(); }).then(function (bl) {
          pick(new File([bl], src.split('/').pop(), { type: 'model/stl' })); b.disabled = false; go();
        }).catch(function (e) { b.disabled = false; err(e.message); });
      });
    });
    var magVis = function () { $('pp-magbox').style.display = $('pp-conn').value === 'imas' ? '' : 'none'; $('pp-rodbox').style.display = $('pp-conn').value === 'vareta' ? '' : 'none'; };
    $('pp-conn').addEventListener('change', magVis); magVis();
  });
})();
