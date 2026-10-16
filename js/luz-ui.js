/* Big Insane 3D · Oficina · Foto em cores, Litofania e Medir filamento (telas próprias dentro da Oficina) */
(function () {
  'use strict';
  var LZ = window.BI3D_LUZ, OF = window.BI3D_OF, B = window.BI3D;
  if (!LZ || !OF) return;
  var esc = function (s) { return String(s).replace(/[<>&"]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]; }); };
  var nf = function (v, d) { return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); };
  var VER = '20261016d';

  /* ---------- trabalhador em segundo plano ---------- */
  var worker = null, pending = null;
  function job(msg, onProg) {
    if (!worker) {
      worker = new Worker('js/luz-worker.js?v=' + VER);
      worker.onmessage = function (ev) {
        var m = ev.data, p = pending; if (!p) return;
        if (m.type === 'progress') { if (p.prog) p.prog(m.text, m.p); return; }
        pending = null;
        if (m.type === 'done') p.ok(m.result); else p.no(new Error(m.msg));
      };
      worker.onerror = function (e) { var p = pending; pending = null; if (p) p.no(new Error('O cálculo parou: ' + (e.message || 'erro no trabalhador'))); };
    }
    if (pending) { worker.terminate(); worker = null; pending.no(new Error('cancelado')); pending = null; return job(msg, onProg); }
    return new Promise(function (ok, no) { pending = { ok: ok, no: no, prog: onProg }; var tr = []; if (msg.img && msg.img.data) tr.push(msg.img.data.buffer); if (msg.lum) tr.push(msg.lum.buffer); worker.postMessage(msg, tr); });
  }

  /* ---------- filamentos: medidos no Caderno + estimados (TD publicado) ---------- */
  function caderno() { return B && B.loadCaderno ? B.loadCaderno() : []; }
  function measured() {
    return caderno().map(function (o, i) { return o.luz && o.luz.k ? { id: 'c' + i, nome: o.name, hex: o.luz.hex || '#FFFFFF', k: o.luz.k, a: o.luz.a || [0.9, 0.9, 0.9], beta: o.luz.beta || 0, fonte: 'medido', td: LZ.tdOf({ k: o.luz.k }) } : null; }).filter(Boolean);
  }
  function filList(extra) {
    var est = LZ.PADRAO.map(function (f, i) { return { id: 'p' + i, nome: f.nome, hex: f.hex, k: f.k, a: f.a, fonte: 'estimado', td: f.td }; });
    return measured().concat(est, extra || []);
  }
  function chip(hex) { return '<i class="lz-dot" style="background:' + esc(hex) + '"></i>'; }

  function loadImage(file) {
    return new Promise(function (ok, no) {
      if (!file) { no(new Error('Escolha uma imagem.')); return; }
      if (file.size > 25 * 1048576) { no(new Error('Imagem acima de 25 MB.')); return; }
      var im = new Image(); im.onload = function () { ok(im); }; im.onerror = function () { no(new Error('Não consegui abrir essa imagem. Use JPG ou PNG.')); };
      im.src = typeof file === 'string' ? file : URL.createObjectURL(file);
    });
  }
  function pixels(im, w, h) { var cv = document.createElement('canvas'); cv.width = w; cv.height = h; var x = cv.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(im, 0, 0, w, h); return x.getImageData(0, 0, w, h); }
  function canvasOf(rgba, w, h, cls) { var cv = document.createElement('canvas'); cv.width = w; cv.height = h; cv.className = cls || 'lz-img'; cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer || rgba), w, h), 0, 0); return cv; }
  function bar(text, p) { return '<div class="rx-prog"><div class="rx-track"><div style="height:100%;width:' + Math.round((p || 0) * 100) + '%;background:var(--acc);transition:width .2s"></div></div><span>' + esc(text || '') + '</span></div>'; }
  function num(v, d) { var x = parseFloat(String(v).replace(',', '.')); return isFinite(x) ? x : d; }
  function bedOf(cfg) { var a = (cfg.printable_area || ['0x0', '256x0', '256x256', '0x256']).map(function (s) { return String(s).split('x').map(Number); }); return [Math.max.apply(null, a.map(function (p) { return p[0]; })), Math.max.apply(null, a.map(function (p) { return p[1]; }))]; }

  /* tempo e filamento: modelo ajustado com projetos fatiados no Anycubic Slicer Next (Kobra 4) — ver _teste/luz-medidas.json */
  // foto (camada 0,08, 100%): ~113 s por cm³ (4 peças fatiadas, erro de -24% a +24%)
  // litofania (camada 0,12, 100%): ~430 s por cm³ (4 formas, erro de -16% a +27%)
  var TEMPO = { foto: { v: 113 }, lito: { v: 430 }, purga: 0.8 };
  function tempo(kind, vol) { return (kind === 'foto' ? TEMPO.foto.v : TEMPO.lito.v) * vol; }
  function hm(s) { s = Math.round(s / 60); return s < 60 ? s + ' min' : Math.floor(s / 60) + ' h ' + (s % 60 ? (s % 60) + ' min' : ''); }

  function cfgFor(c, colors, over) {
    var pr = c.printer();
    return c.tpl(pr.id).then(function (tp) {
      var r = BI3D_PREP.buildConfig({ cfg: {}, colors: colors, types: [c.mat()], nFil: colors.length, designerDiffs: [], printer: '' }, tp, { material: c.mat(), quality: 'std' });
      var cfg = r.cfg; Object.keys(over).forEach(function (k) { cfg[k] = over[k]; });
      if (!cfg.machine_pause_gcode && pr.bambu) cfg.machine_pause_gcode = 'M400 U1';
      return cfg;
    });
  }

  /* ======================= FOTO EM CORES ======================= */
  var foto = { img: null, res: null, sel: null, busy: false, key: '' };
  var FOTO = {
    name: 'Foto em cores', ico: '🖼️', custom: true,
    sub: 'Sua foto vira um quadro em camadas de filamento (estilo HueForge). Com ou sem ACE/AMS, com a prévia e o erro de cor medido.',
    mount: function (c) {
      var v = c.store('foto') || {}, fl = filList();
      if (!foto.sel) foto.sel = v.sel || ['p1', 'p2', 'p8', 'p0']; // preto, cinza, bege, branco
      var mine = measured();
      c.$('of-form').innerHTML =
        '<div class="row"><div class="of-f of-file"><label for="lz-file">Foto (JPG ou PNG)</label><input type="file" id="lz-file" accept="image/jpeg,image/png,image/webp"></div></div>' +
        '<p class="rx-note">Sem foto agora? <button type="button" class="ghost of-mini" id="lz-ex">Usar a foto de exemplo</button> (retrato da NASA, domínio público).</p>' +
        '<div class="row"><div><label for="lz-w">Largura do quadro (mm)</label><input id="lz-w" inputmode="decimal" value="' + esc(v.w || 100) + '"></div>' +
        '<div><label for="lz-max">Máximo de cores</label><select id="lz-max">' + [2, 3, 4].map(function (n) { return '<option' + ((v.max || 4) == n ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></div></div>' +
        '<label class="pp-check"><input type="checkbox" id="lz-fix"' + (v.fix !== false ? ' checked' : '') + '> Corrigir foto escura ou amarelada antes</label>' +
        '<label>Filamentos que você tem (a ferramenta escolhe a ordem e onde trocar)</label><div class="lz-fils" id="lz-fils">' +
        fl.map(function (f) { return '<label class="lz-fil"><input type="checkbox" value="' + f.id + '"' + (foto.sel.indexOf(f.id) >= 0 ? ' checked' : '') + '>' + chip(f.hex) + '<span>' + esc(f.nome) + '<small>' + (f.fonte === 'medido' ? 'medido' : 'estimado') + ' · TD ' + nf(f.td, 1) + '</small></span></label>'; }).join('') + '</div>' +
        (mine.length ? '' : '<p class="rx-note">Os valores de luz dos filamentos são <b>estimados</b> pela tabela da Prusa. Para a prévia bater com a peça, meça os seus rolos na aba <a href="#medir" id="lz-gomedir">Medir filamento</a>.</p>') +
        '<details class="of-adv"><summary>Medidas finas</summary><div class="in"><div class="row">' +
        '<div><label for="lz-hmax">Altura máxima (mm)</label><input id="lz-hmax" inputmode="decimal" value="' + esc(v.hmax || 2) + '"></div>' +
        '<div><label for="lz-base">Base (mm)</label><input id="lz-base" inputmode="decimal" value="' + esc(v.base || 0.48) + '"></div>' +
        '<div><label for="lz-beta">Luz refletida β (sem medida)</label><input id="lz-beta" inputmode="decimal" value="' + esc(v.beta || 1) + '"></div></div>' +
        '<label class="pp-check"><input type="checkbox" id="lz-smooth"' + (v.smooth !== false ? ' checked' : '') + '> Suavizar (tira pontinhos soltos)</label></div></details>' +
        '<div class="btns" style="margin-top:12px"><button type="button" class="cta" id="lz-go">Calcular a peça</button></div>';
      var save = function () { c.store('foto', { w: c.$('lz-w').value, max: c.$('lz-max').value, fix: c.$('lz-fix').checked, hmax: c.$('lz-hmax').value, base: c.$('lz-base').value, beta: c.$('lz-beta').value, smooth: c.$('lz-smooth').checked, sel: foto.sel }); };
      ['lz-w', 'lz-max', 'lz-fix', 'lz-hmax', 'lz-base', 'lz-beta', 'lz-smooth'].forEach(function (id) { c.$(id).addEventListener('change', save); });
      c.$('lz-fils').addEventListener('change', function () { foto.sel = Array.prototype.filter.call(c.$('lz-fils').querySelectorAll('input'), function (x) { return x.checked; }).map(function (x) { return x.value; }); save(); });
      c.$('lz-file').addEventListener('change', function () { loadImage(c.$('lz-file').files[0]).then(function (im) { foto.img = im; FOTO.calc(c); }, function (e) { c.err(e.message); }); });
      c.$('lz-ex').addEventListener('click', function () { loadImage('exemplos/foto-exemplo.jpg').then(function (im) { foto.img = im; FOTO.calc(c); }, function (e) { c.err(e.message); }); });
      c.$('lz-go').addEventListener('click', function () { FOTO.calc(c); });
      var gm = c.$('lz-gomedir'); if (gm) gm.addEventListener('click', function (e) { e.preventDefault(); var b = document.querySelector('[data-t=medir]'); if (b) b.click(); });
    },
    run: function (c) { if (foto.res) FOTO.show(c); else if (!foto.img) c.out('<div class="box"><p>Escolha uma foto para começar. Retratos, pets e paisagens com bom contraste ficam melhores.</p></div>'); },
    calc: function (c) {
      if (!foto.img) { c.err('Escolha uma foto.'); return; }
      var fl = filList(), fils = fl.filter(function (f) { return foto.sel.indexOf(f.id) >= 0; });
      if (fils.length < 2) { c.err('Marque pelo menos 2 filamentos.'); return; }
      var W = Math.max(30, Math.min(250, num(c.$('lz-w').value, 100))), px = Math.max(0.2, W / 700), w = Math.round(W / px), h = Math.round(w * foto.img.height / foto.img.width);
      var Hmax = Math.max(0.8, Math.min(4, num(c.$('lz-hmax').value, 2))), base = Math.max(0.16, Math.min(1.2, num(c.$('lz-base').value, 0.48)));
      var data = pixels(foto.img, w, h);
      foto.res = null; c.setLast(null);
      c.out(bar('Preparando…', 0.02)); c.state('Calculando em segundo plano…');
      var t0 = performance.now();
      job({ kind: 'foto', img: { w: w, h: h, data: data.data }, W: W, fils: fils.map(function (f) { return { nome: f.nome, hex: f.hex, k: f.k, a: f.a, beta: f.beta || 0 }; }), maxFil: +c.$('lz-max').value,
        h0: 0.16, lh: 0.08, Hmax: Hmax, base: base, beta: Math.max(0.3, Math.min(3, num(c.$('lz-beta').value, 1))), smooth: c.$('lz-smooth').checked ? 1 : 0, autoFix: c.$('lz-fix').checked },
        function (t, p) { c.out(bar(t, p)); }).then(function (r) {
        r.W = W; r.px = px; r.ms = performance.now() - t0; r.orig = data.data; foto.res = r; c.state(''); FOTO.show(c);
      }, function (e) { c.state(''); if (e.message !== 'cancelado') c.err(e.message); });
    },
    choose: function (c, idx) {
      var r = foto.res; c.out(bar('Recalculando com ' + r.opcoes[idx].nFil + ' cores…', 0.7)); c.state('Calculando…');
      job({ kind: 'foto-escolha', idx: idx }, function (t, p) { c.out(bar(t, p)); }).then(function (x) { r.build = x.build; r.escolha = idx; c.state(''); FOTO.show(c); }, function (e) { c.state(''); c.err(e.message); });
    },
    show: function (c) {
      var r = foto.res, b = r.build, multi = c.multi(), pr = c.printer(), o = r.opcoes[r.escolha], s = b.stats;
      var dens = c.mat() === 'PETG' ? 1.27 : 1.24, vol = b.vol / 1000, g = vol * dens;
      var nCh = b.changes.length, purge = multi ? nCh * TEMPO.purga : 0, t = tempo('foto', vol);
      var tab = '<div class="tbl"><table><tr><th></th><th>Cores</th><th>' + (multi ? 'Trocas na ' + esc(pr.unit) : 'Pausas') + '</th><th>Erro de cor (ΔE2000 médio)</th><th>Ordem (de baixo para cima)</th></tr>' +
        r.opcoes.map(function (op, i) { return '<tr' + (i === r.escolha ? ' class="lz-on"' : '') + '><td><input type="radio" name="lz-op" value="' + i + '"' + (i === r.escolha ? ' checked' : '') + ' aria-label="Usar ' + op.nFil + ' cores"></td><td>' + op.nFil + (i === r.rec ? ' <em class="lz-rec">recomendado</em>' : '') + '</td><td>' + (op.nFil - 1) + '</td><td><b>' + nf(op.err, 1) + '</b></td><td>' + op.hex.map(function (h, k) { return chip(h) + esc(op.fils[k]); }).join(' › ') + '</td></tr>'; }).join('') + '</table></div>';
      var how = multi ? '<p>A ' + esc(pr.unit) + ' troca sozinha ' + nCh + (nCh === 1 ? ' vez' : ' vezes') + ', sempre na camada inteira (sem purga a cada camada).</p>'
        : '<p><b>Sem ' + esc(pr.unit) + ':</b> a impressora pausa ' + nCh + (nCh === 1 ? ' vez' : ' vezes') + '. Em cada pausa, troque o filamento e continue.</p>';
      var ch = '<ol class="of-pauses"><li>Começa com ' + chip(b.fils[0].hex) + esc(b.fils[0].nome) + '</li>' + b.changes.map(function (x) { return '<li>Na altura ' + nf(x.z, 2) + ' mm (camada ' + x.camada + ') → ' + chip(x.hex) + esc(x.nome) + '</li>'; }).join('') + '</ol>';
      c.out('<div class="lz-imgs" id="lz-imgs"></div>' +
        '<div class="of-sum"><div><b>' + nf(s.media, 1) + '</b><span>ΔE2000 médio</span></div><div><b>' + nf(s.p95, 1) + '</b><span>ΔE dos 5% piores</span></div><div><b>' + nf(s.ate3 * 100) + '%</b><span>quase igual (ΔE ≤ 3)</span></div><div><b>' + nf(s.acima10 * 100, 1) + '%</b><span>cor diferente (ΔE > 10)</span></div></div>' +
        '<p class="rx-note">ΔE2000 compara a prévia com a foto' + (r.fix ? ' corrigida' : '') + ', ponto a ponto: até 1 ninguém percebe, 2 a 3 só de perto, acima de 10 é outra cor. No mapa, verde = perto, vermelho = longe. ' + (measured().length ? '' : '<b>Filamentos estimados:</b> meça os seus para a prévia valer.') + '</p>' +
        tab +
        '<div class="of-sum"><div><b>' + nf(r.W) + ' × ' + nf(r.W * b.h / b.w) + ' mm</b><span>tamanho</span></div><div><b>' + nf(b.altura, 2) + ' mm</b><span>' + b.camadas + ' camadas de 0,08</span></div><div><b>~' + nf(g + purge, 1) + ' g</b><span>filamento' + (multi ? ' (com purga)' : '') + '</span></div><div><b>~' + hm(t) + '</b><span>impressão ±25%' + (multi ? '' : ' + trocas') + '</span></div></div>' +
        '<div class="box tip">' + how + ch + '</div>' +
        '<p class="rx-note">Calculado em ' + nf(r.total / 1000, 1) + ' s no seu navegador (em segundo plano). Peso e tempo estimados por um modelo ajustado com peças fatiadas; o exato aparece no fatiador e no <a href="raiox.html">Raio-X</a>.</p>');
      var box = c.$('lz-imgs');
      [[r.alvo || r.orig, 'Foto' + (r.fix ? ' corrigida' : '')], [b.preview, 'Prévia da peça'], [b.heat, 'Onde a cor erra']].forEach(function (x) { var f = document.createElement('figure'); f.appendChild(canvasOf(x[0], b.w, b.h)); var cap = document.createElement('figcaption'); cap.textContent = x[1]; f.appendChild(cap); box.appendChild(f); });
      Array.prototype.forEach.call(document.querySelectorAll('input[name=lz-op]'), function (inp) { inp.addEventListener('change', function () { FOTO.choose(c, +inp.value); }); });
      // projeto
      var colors = multi ? b.fils.map(function (f) { return f.hex; }) : [b.fils[0].hex];
      cfgFor(c, colors, { layer_height: '0.08', initial_layer_print_height: '0.16', sparse_infill_density: '100%', enable_support: '0', brim_type: 'no_brim', wall_loops: '2', ironing_type: 'no ironing' }).then(function (cfg) {
        var bed = bedOf(cfg);
        var changes = b.changes.map(function (x) { return multi ? { z: +x.z.toFixed(3), type: 2, extruder: x.fil + 1, color: x.hex } : { z: +x.z.toFixed(3), type: 1, extruder: 1, color: x.hex, note: 'Troque para ' + x.nome, gcode: cfg.machine_pause_gcode || 'M600' }; });
        c.setLast({ parts: [{ tri: b.tri, name: 'foto', extruder: 1 }], cfg: cfg, bed: bed, name: 'foto-' + o.nFil + 'cores', changes: changes, mode: multi ? 'MultiAsSingle' : 'SingleExtruder' });
        // 3D: cada faixa de altura com a cor do filamento daquela faixa (separada no trabalhador)
        var ox = bed[0] / 2 - r.W / 2, oy = bed[1] / 2 - r.W * b.h / b.w / 2;
        c.view(b.view.map(function (t, k) { return { tri: OF.translate(t, ox, oy, 0), color: b.fils[k].hex }; }).filter(function (m) { return m.tri.length; }), bed, { showBed: false, autoRotate: false, fit: 1.4, top: true });
      });
    }
  };

  /* ======================= LITOFANIA ======================= */
  var lito = { img: null, res: null, lua: null };
  var LITO = {
    name: 'Litofania', ico: '💡', custom: true,
    sub: 'Foto que aparece com luz por trás: plana, curva, cilindro de luminária ou lua. Imprime em pé, num filamento só (branco).',
    mount: function (c) {
      var v = c.store('lito') || {}, mine = measured(), fl = mine.concat([{ id: 'lp', nome: LZ.LITO_PADRAO.nome, hex: LZ.LITO_PADRAO.hex, k: LZ.LITO_PADRAO.k, a: LZ.LITO_PADRAO.a, fonte: 'estimado' }]);
      var forma = v.forma || 'plana';
      c.$('of-form').innerHTML =
        '<div class="row"><div><label for="lt-forma">Forma</label><select id="lt-forma">' + [['plana', 'Plana (porta-retrato)'], ['curva', 'Curva'], ['cilindro', 'Cilindro de luminária'], ['lua', 'Lua (textura da NASA)']].map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === forma ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div>' +
        '<div><label for="lt-fil">Filamento</label><select id="lt-fil">' + fl.map(function (f) { return '<option value="' + f.id + '"' + (v.fil === f.id ? ' selected' : '') + '>' + esc(f.nome) + (f.fonte === 'medido' ? ' (medido)' : '') + '</option>'; }).join('') + '</select></div></div>' +
        (forma === 'lua' ? '<p class="rx-note">A lua usa o mapa de cor da Lua feito pela NASA (LRO), com a luz por dentro.</p>' :
          '<div class="row"><div class="of-f of-file"><label for="lt-file">Foto</label><input type="file" id="lt-file" accept="image/jpeg,image/png,image/webp"></div></div><p class="rx-note">Sem foto agora? <button type="button" class="ghost of-mini" id="lt-ex">Usar a foto de exemplo</button></p>') +
        '<div class="row">' + (forma === 'lua' ? '<div><label for="lt-w">Diâmetro (mm)</label><input id="lt-w" inputmode="decimal" value="' + esc(v.d || 100) + '"></div><div><label for="lt-furo">Furo do LED (mm)</label><input id="lt-furo" inputmode="decimal" value="' + esc(v.furo || 30) + '"></div>'
          : forma === 'cilindro' ? '<div><label for="lt-w">Diâmetro (mm)</label><input id="lt-w" inputmode="decimal" value="' + esc(v.dc || 70) + '"></div><div><label for="lt-h">Altura (mm)</label><input id="lt-h" inputmode="decimal" value="' + esc(v.h || 120) + '"></div>'
          : '<div><label for="lt-w">Largura (mm)</label><input id="lt-w" inputmode="decimal" value="' + esc(v.w || 100) + '"></div><div><label for="lt-h">Altura (mm, vazio = proporção da foto)</label><input id="lt-h" inputmode="decimal" value="' + esc(v.hh || '') + '"></div>') + '</div>' +
        '<details class="of-adv"><summary>Medidas finas</summary><div class="in"><div class="row"><div><label for="lt-tmin">Parte mais fina (mm)</label><input id="lt-tmin" inputmode="decimal" value="' + esc(v.tmin || 0.8) + '"></div>' +
        '<div><label for="lt-tmax">Parte mais grossa (mm)</label><input id="lt-tmax" inputmode="decimal" value="' + esc(v.tmax || 3) + '"></div><div><label for="lt-border">Moldura (mm)</label><input id="lt-border" inputmode="decimal" value="' + esc(v.border != null ? v.border : 3) + '"></div></div></div></details>' +
        '<div class="btns" style="margin-top:12px"><button type="button" class="cta" id="lt-go">Calcular a peça</button></div>';
      var save = function () {
        var o = c.store('lito') || {}; o.forma = c.$('lt-forma').value; o.fil = c.$('lt-fil').value; o.tmin = c.$('lt-tmin').value; o.tmax = c.$('lt-tmax').value; o.border = c.$('lt-border').value;
        if (forma === 'lua') { o.d = c.$('lt-w').value; o.furo = c.$('lt-furo').value; } else if (forma === 'cilindro') { o.dc = c.$('lt-w').value; o.h = c.$('lt-h').value; } else { o.w = c.$('lt-w').value; o.hh = c.$('lt-h').value; }
        c.store('lito', o);
      };
      Array.prototype.forEach.call(c.$('of-form').querySelectorAll('input:not([type=file]),select'), function (el) { el.addEventListener('change', save); });
      c.$('lt-forma').addEventListener('change', function () { save(); lito.res = null; c.setLast(null); c.out(''); LITO.mount(c); if (c.$('lt-forma').value === 'lua') LITO.calc(c); });
      var f = c.$('lt-file'); if (f) f.addEventListener('change', function () { loadImage(f.files[0]).then(function (im) { lito.img = im; LITO.calc(c); }, function (e) { c.err(e.message); }); });
      var ex = c.$('lt-ex'); if (ex) ex.addEventListener('click', function () { loadImage('exemplos/foto-exemplo.jpg').then(function (im) { lito.img = im; LITO.calc(c); }, function (e) { c.err(e.message); }); });
      c.$('lt-go').addEventListener('click', function () { LITO.calc(c); });
      LITO.fils = fl;
    },
    run: function (c) { if (lito.res) LITO.show(c); else if (!lito.img && c.$('lt-forma') && c.$('lt-forma').value !== 'lua') c.out('<div class="box"><p>Escolha uma foto. Rostos com luz de lado e fundo simples ficam melhores em litofania.</p></div>'); },
    calc: function (c) {
      var forma = c.$('lt-forma').value, fil = LITO.fils.filter(function (f) { return f.id === c.$('lt-fil').value; })[0] || LITO.fils[LITO.fils.length - 1];
      var srcP = forma === 'lua' ? (lito.lua ? Promise.resolve(lito.lua) : loadImage('img/lua-nasa-2k.jpg').then(function (im) { lito.lua = im; return im; })) : (lito.img ? Promise.resolve(lito.img) : Promise.reject(new Error('Escolha uma foto.')));
      srcP.then(function (im) {
        var tmin = Math.max(0.4, Math.min(2, num(c.$('lt-tmin').value, 0.8))), tmax = Math.max(tmin + 0.8, Math.min(6, num(c.$('lt-tmax').value, 3))), border = Math.max(0, Math.min(10, num(c.$('lt-border').value, 3)));
        var W, H, res = forma === 'lua' ? 0.5 : 0.4;
        if (forma === 'lua') { var D = Math.max(50, Math.min(200, num(c.$('lt-w').value, 100))); W = D; H = D / 2; }
        else if (forma === 'cilindro') { W = Math.PI * Math.max(30, Math.min(200, num(c.$('lt-w').value, 70))); H = Math.max(30, Math.min(250, num(c.$('lt-h').value, 120))); }
        else { W = Math.max(30, Math.min(250, num(c.$('lt-w').value, 100))); H = num(c.$('lt-h').value, 0) || W * im.height / im.width; }
        var w = Math.round((forma === 'lua' ? Math.PI * W : W) / res), h = Math.round((forma === 'lua' ? Math.PI * W / 2 : H) / res);
        if (forma === 'lua') { w = Math.min(w, 800); h = Math.round(w / 2); }
        var d = pixels(im, w, h).data, lum = new Float32Array(w * h);
        for (var p = 0; p < w * h; p++) lum[p] = 0.2126 * LZ.S2L[d[p * 4]] + 0.7152 * LZ.S2L[d[p * 4 + 1]] + 0.0722 * LZ.S2L[d[p * 4 + 2]];
        lito.res = null; c.setLast(null); c.out(bar('Preparando…', 0.02)); c.state('Calculando em segundo plano…');
        return job({ kind: 'lito', lum: lum, w: w, h: h, W: W, H: H, forma: forma, tmin: tmin, tmax: tmax, fil: { k: fil.k, a: fil.a }, border: forma === 'lua' ? 0 : border, pe: forma === 'plana' ? 12 : 0, base: forma === 'cilindro' ? 3 : 0, res: res, furo: num(c.$('lt-furo') && c.$('lt-furo').value, 30), angulo: 120 },
          function (t, pp) { c.out(bar(t, pp)); }).then(function (r) { r.forma = forma; r.W = W; r.H = H; r.tmin = tmin; r.tmax = tmax; r.fil = fil; lito.res = r; c.state(''); LITO.show(c); });
      }).catch(function (e) { c.state(''); if (e.message !== 'cancelado') c.err(e.message); });
    },
    show: function (c) {
      var r = lito.res, dens = c.mat() === 'PETG' ? 1.27 : 1.24, vol = r.vol / 1000, bb = OF.bounds([r.tri]), size = [bb[3] - bb[0], bb[4] - bb[1], bb[5] - bb[2]];
      var t = tempo('lito', vol);
      var dica = { plana: 'Imprime em pé, apoiada no pé. Coloque uma luz branca atrás (fita de LED ou a lanterna do celular).', curva: 'Imprime em pé. Ilumine por trás, no meio da curva.', cilindro: 'Imprime em pé, sem suporte. Coloque um LED (vela de LED ou lâmpada fria) dentro.', lua: 'Imprime com o furo para baixo e suporte em árvore só na mesa. Coloque um LED pelo furo.' }[r.forma];
      c.out('<div class="lz-imgs" id="lz-imgs"></div>' +
        '<div class="of-sum"><div><b>' + nf(size[0]) + ' × ' + nf(size[1]) + ' × ' + nf(size[2]) + ' mm</b><span>tamanho</span></div><div><b>' + nf(r.contraste) + ':1</b><span>contraste da peça</span></div><div><b>~' + nf(vol * dens, 0) + ' g</b><span>filamento</span></div><div><b>~' + hm(t) + '</b><span>impressão (±25%)</span></div></div>' +
        '<div class="box tip"><p>' + esc(dica) + '</p><p>Espessura de ' + nf(r.tmin, 1) + ' mm (claro) a ' + nf(r.tmax, 1) + ' mm (escuro), 100% de preenchimento.</p></div>' +
        (r.fil.fonte === 'medido' ? '' : '<div class="box warn"><p>O quanto o seu branco deixa passar a luz está <b>estimado</b>. A prévia e o contraste só valem de verdade depois de medir o seu rolo na aba Medir filamento.</p></div>') +
        '<p class="rx-note">A prévia simula a peça com luz por trás. Calculado em ' + nf(r.total / 1000, 1) + ' s no seu navegador. Peso e tempo estimados; o exato aparece no fatiador.</p>');
      var f = document.createElement('figure'); f.appendChild(canvasOf(r.preview, r.w, r.h, 'lz-img lz-lit')); var cap = document.createElement('figcaption'); cap.textContent = 'Prévia com luz por trás'; f.appendChild(cap); c.$('lz-imgs').appendChild(f);
      var over = { layer_height: '0.12', initial_layer_print_height: '0.2', sparse_infill_density: '100%', wall_loops: '2', ironing_type: 'no ironing' };
      if (r.forma === 'lua') { over.enable_support = '1'; over.support_type = 'tree(auto)'; over.support_on_build_plate_only = '1'; over.brim_type = 'no_brim'; }
      else { over.enable_support = '0'; over.brim_type = 'outer_only'; over.brim_width = '5'; }
      cfgFor(c, [r.fil.hex || '#FFFFFF'], over).then(function (cfg) {
        var bed = bedOf(cfg);
        c.setLast({ parts: [{ tri: r.tri, name: 'litofania', extruder: 1 }], cfg: cfg, bed: bed, name: 'litofania-' + r.forma, changes: [] });
        var dx = bed[0] / 2 - (bb[0] + bb[3]) / 2, dy = bed[1] / 2 - (bb[1] + bb[4]) / 2;
        c.view([{ tri: OF.translate(r.tri, dx, dy, -bb[2]), color: '#F4EFE6' }], bed, { showBed: false, autoRotate: false, fit: 1.5 });
      });
    }
  };

  /* ======================= MEDIR FILAMENTO ======================= */
  var med = { img: null, front: null, pts: [], fpts: [], fit: null, beta: null, mode: 'luz' };
  function escadinha() { // a peça de calibração: moldura grossa, janela vazada e 12 degraus
    var E = LZ.ESC, n = LZ.DEGRAUS.length + 1, L = 2 * E.frame + n * E.cell + (n - 1) * E.sep, Wd = 2 * E.frame + E.h, out = [];
    var cells = []; for (var i = 0; i < n; i++) { var x0 = E.frame + i * (E.cell + E.sep); cells.push([x0, E.frame, x0 + E.cell, E.frame + E.h]); }
    var holes = cells.map(function (c) { return [[c[0], c[1]], [c[0], c[3]], [c[2], c[3]], [c[2], c[1]]]; });
    OF.extrude([{ outer: [[0, 0], [L, 0], [L, Wd], [0, Wd]], holes: holes }], 0, E.top, out);
    LZ.DEGRAUS.forEach(function (t, k) { var c = cells[k + 1]; OF.extrude([{ outer: [[c[0], c[1]], [c[2], c[1]], [c[2], c[3]], [c[0], c[3]]], holes: [] }], 0, t, out); });
    OF.extrude([{ outer: [[-6, Wd / 2 - 4], [0, Wd / 2 - 4], [0, Wd / 2 + 4], [-6, Wd / 2 + 4]], holes: [] }], 0, E.top, out); // aba: marca o lado da janela
    return new Float32Array(out);
  }
  var MEDIR = {
    name: 'Medir filamento', ico: '📏', custom: true,
    sub: 'Mede quanta luz o seu rolo deixa passar, com a escadinha impressa e uma foto do celular. Fica salvo no Caderno e deixa a prévia da Foto em cores e da Litofania fiel.',
    mount: function (c) {
      var list = caderno();
      c.$('of-form').innerHTML =
        '<ol class="lz-steps"><li><b>Imprima a escadinha</b> com o rolo que quer medir (~35 min, ~7 g na Kobra 4). Baixe abaixo: ela já sai com camada de 0,08 e 100% de preenchimento.</li>' +
        '<li><b>Foto contra a luz:</b> deite a escadinha sobre a tela do celular ou do PC com uma imagem toda branca no brilho máximo, no escuro. Fotografe de cima, reto. Toque na janela vazada para baixar a exposição até ela não ficar estourada.</li>' +
        '<li><b>Envie a foto</b> e toque no centro da janela vazada (ao lado da aba) e depois no centro do degrau mais grosso.</li>' +
        '<li><b>Opcional, para a Foto em cores:</b> a mesma escadinha sobre papel preto, com luz de cima, sem flash. Mesmos dois toques.</li></ol>' +
        '<div class="btns"><button type="button" class="ghost" id="md-dl">Baixar escadinha (3MF)</button></div>' +
        '<div class="row"><div><label for="md-rolo">Rolo</label><select id="md-rolo"><option value="novo">Novo rolo…</option>' + list.map(function (o, i) { return '<option value="' + i + '">' + esc(o.name) + (o.luz ? ' (já medido)' : '') + '</option>'; }).join('') + '</select></div>' +
        '<div id="md-novo"><label for="md-nome">Nome do rolo</label><input id="md-nome" placeholder="Ex.: PLA Anycubic branco"></div><div><label for="md-cor">Cor do rolo</label><div class="of-color"><input type="color" id="md-cor" value="#FFFFFF"><span>#FFFFFF</span></div></div></div>' +
        '<div class="row"><div class="of-f of-file"><label for="md-file">Foto contra a luz</label><input type="file" id="md-file" accept="image/*"></div><div class="of-f of-file"><label for="md-front">Foto sobre papel preto (opcional)</label><input type="file" id="md-front" accept="image/*"></div></div>';
      c.$('md-rolo').addEventListener('change', function () { c.$('md-novo').style.display = c.$('md-rolo').value === 'novo' ? '' : 'none'; var o = caderno()[+c.$('md-rolo').value]; if (o && o.luz && o.luz.hex) { c.$('md-cor').value = o.luz.hex; c.$('md-cor').nextElementSibling.textContent = o.luz.hex; } });
      c.$('md-cor').addEventListener('input', function () { c.$('md-cor').nextElementSibling.textContent = c.$('md-cor').value.toUpperCase(); });
      c.$('md-dl').addEventListener('click', function () {
        cfgFor(c, [c.$('md-cor').value.toUpperCase()], { layer_height: '0.08', initial_layer_print_height: '0.16', sparse_infill_density: '100%', wall_loops: '2', enable_support: '0', brim_type: 'no_brim', top_surface_pattern: 'monotonic', bottom_surface_pattern: 'monotonic' }).then(function (cfg) {
          return OF.project({ parts: [{ tri: escadinha(), name: 'escadinha', extruder: 1 }], cfg: cfg, bed: bedOf(cfg), name: 'escadinha-de-luz' });
        }).then(function (blob) { c.save(blob, 'escadinha-de-luz-' + c.printer().id + '.3mf'); });
      });
      c.$('md-file').addEventListener('change', function () { loadImage(c.$('md-file').files[0]).then(function (im) { med.img = im; med.pts = []; med.fit = null; med.mode = 'luz'; MEDIR.draw(c); }, function (e) { c.err(e.message); }); });
      c.$('md-front').addEventListener('change', function () { loadImage(c.$('md-front').files[0]).then(function (im) { med.front = im; med.fpts = []; med.mode = 'frente'; MEDIR.draw(c); }, function (e) { c.err(e.message); }); });
    },
    run: function (c) {
      if (!med.img) {
        c.out('<div class="box"><p>A escadinha tem 12 degraus de 0,16 a 2,80 mm e uma janela vazada que serve de referência da luz. A conta segue a lei de Beer-Lambert: quanto mais grosso, menos luz passa, numa curva que a foto mede.</p></div>');
        var tri = escadinha(), b = OF.bounds([tri]); c.view([{ tri: OF.translate(tri, 130 - (b[0] + b[3]) / 2, 130 - (b[1] + b[4]) / 2, 0), color: '#EDE7DD' }], [260, 260], { showBed: false, autoRotate: false, fit: 1.2, top: true });
      } else MEDIR.draw(c);
    },
    draw: function (c) {
      var front = med.mode === 'frente', im = front ? med.front : med.img, pts = front ? med.fpts : med.pts;
      var maxW = 900, s = Math.min(1, maxW / im.width), w = Math.round(im.width * s), h = Math.round(im.height * s);
      c.out('<p class="rx-note"><b>' + (front ? 'Foto sobre papel preto' : 'Foto contra a luz') + ':</b> ' + (pts.length === 0 ? 'toque no centro da janela vazada.' : pts.length === 1 ? 'agora no centro do degrau mais grosso.' : 'pronto. Toque de novo para refazer.') + '</p><div class="lz-shot" id="md-shot"></div><div id="md-res"></div>');
      var cv = document.createElement('canvas'); cv.width = w; cv.height = h; cv.className = 'lz-shotcv';
      var x = cv.getContext('2d'); x.drawImage(im, 0, 0, w, h);
      var data = x.getImageData(0, 0, w, h);
      pts.forEach(function (p, i) { x.strokeStyle = i ? '#ff6a1a' : '#7ee787'; x.lineWidth = 3; x.beginPath(); x.arc(p[0], p[1], 10, 0, Math.PI * 2); x.stroke(); });
      if (pts.length === 2) {
        x.strokeStyle = 'rgba(255,106,26,.8)'; x.setLineDash([6, 6]); x.beginPath(); x.moveTo(pts[0][0], pts[0][1]); x.lineTo(pts[1][0], pts[1][1]); x.stroke(); x.setLineDash([]);
        var n = LZ.DEGRAUS.length; for (var k = 0; k <= n; k++) { var px = pts[0][0] + (pts[1][0] - pts[0][0]) * k / n, py = pts[0][1] + (pts[1][1] - pts[0][1]) * k / n; x.fillStyle = '#ff6a1a'; x.fillRect(px - 2, py - 2, 4, 4); }
      }
      c.$('md-shot').appendChild(cv);
      cv.addEventListener('click', function (e) {
        var r = cv.getBoundingClientRect(), p = [(e.clientX - r.left) * w / r.width, (e.clientY - r.top) * h / r.height];
        if (pts.length >= 2) pts.length = 0; pts.push(p); MEDIR.draw(c);
      });
      if (pts.length === 2) MEDIR.result(c, { w: w, h: h, data: data.data }, pts, front);
    },
    result: function (c, img, pts, front) {
      var el = c.$('md-res');
      if (front) {
        if (!med.fit) { el.innerHTML = '<div class="box warn"><p>Faça primeiro a foto contra a luz: o β depende dela.</p></div>'; return; }
        var fr = LZ.analyzeFront(img, pts[0], pts[1], med.fit.fit.k); med.beta = fr;
        el.innerHTML = '<div class="of-sum"><div><b>β = ' + (isFinite(fr.beta) ? nf(fr.beta, 2) : '—') + '</b><span>luz refletida (' + fr.pontos + ' pontos)</span></div><div><b>' + chip(fr.cor) + esc(fr.cor) + '</b><span>cor de frente</span></div></div>' + MEDIR.saveBtn();
      } else {
        var r = LZ.analyzeWedge(img, pts[0], pts[1]); med.fit = r;
        var k = r.fit.k, ok = k.every(function (x) { return x > 0 && isFinite(x); });
        el.innerHTML = MEDIR.chart(r) +
          '<div class="of-sum"><div><b>' + (ok ? nf(LZ.tdOf({ k: k }), 2) + ' mm' : '—') + '</b><span>TD equivalente</span></div><div><b>' + k.map(function (x) { return isFinite(x) ? nf(x, 2) : '—'; }).join(' / ') + '</b><span>k por mm (R/G/B)</span></div><div><b>' + r.fit.r2.map(function (x) { return nf(x, 3); }).join(' / ') + '</b><span>ajuste r² (1 = perfeito)</span></div><div><b>' + r.fit.usados.join(' / ') + '</b><span>degraus usados</span></div></div>' +
          r.avisos.map(function (a) { return '<div class="box warn"><p>' + esc(a) + '</p></div>'; }).join('') + (ok ? MEDIR.saveBtn() : '<div class="box warn"><p>Não deu para medir: confira a foto e os toques.</p></div>');
      }
      var sb = c.$('md-save'); if (sb) sb.addEventListener('click', function () { MEDIR.save(c); });
    },
    chart: function (r) { // transmissão medida (pontos) e curva ajustada, escala log
      var W = 520, H = 220, pad = 34, tmax = 3, ymin = Math.log(0.002), x = function (t) { return pad + t / tmax * (W - pad - 10); }, y = function (T) { return 10 + (1 - (Math.log(Math.max(0.002, T)) - ymin) / (0 - ymin)) * (H - pad - 10); };
      var cols = ['#ff5a5a', '#5ad15a', '#5a8cff'], svg = '<svg class="lz-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Luz que passa por espessura">';
      [1, 0.1, 0.01].forEach(function (T) { svg += '<line x1="' + pad + '" x2="' + (W - 10) + '" y1="' + y(T) + '" y2="' + y(T) + '" stroke="#262b33"/><text x="4" y="' + (y(T) + 4) + '" fill="#9aa3ae" font-size="11">' + (T * 100) + '%</text>'; });
      [0, 1, 2, 3].forEach(function (t) { svg += '<text x="' + (x(t) - 6) + '" y="' + (H - 8) + '" fill="#9aa3ae" font-size="11">' + t + ' mm</text>'; });
      for (var ch = 0; ch < 3; ch++) {
        if (isFinite(r.fit.k[ch])) { var d = ''; for (var t = 0; t <= tmax; t += 0.05) d += (t ? 'L' : 'M') + x(t).toFixed(1) + ' ' + y(r.fit.a[ch] * Math.exp(-r.fit.k[ch] * t)).toFixed(1); svg += '<path d="' + d + '" fill="none" stroke="' + cols[ch] + '" stroke-width="1.5" opacity=".7"/>'; }
        r.pts.forEach(function (p) { svg += '<circle cx="' + x(p.t).toFixed(1) + '" cy="' + y(p.v[ch] / r.ref[ch]).toFixed(1) + '" r="3" fill="' + cols[ch] + '"/>'; });
      }
      return svg + '</svg>';
    },
    saveBtn: function () { return '<div class="btns"><button type="button" class="cta" id="md-save">Salvar no Caderno</button></div><p class="rx-note" id="md-msg"></p>'; },
    save: function (c) {
      if (!med.fit) return;
      var list = caderno(), sel = c.$('md-rolo').value, o;
      if (sel === 'novo') { var nm = c.$('md-nome').value.trim(); if (!nm) { c.$('md-msg').textContent = 'Dê um nome ao rolo.'; return; } o = { name: nm, printer: c.printer().id, material: c.mat(), date: new Date().toISOString().slice(0, 10) }; list.push(o); }
      else o = list[+sel];
      o.luz = { k: med.fit.fit.k.map(function (x) { return +x.toFixed(4); }), a: med.fit.fit.a.map(function (x) { return +x.toFixed(4); }), r2: med.fit.fit.r2.map(function (x) { return +x.toFixed(4); }), hex: c.$('md-cor').value.toUpperCase(), beta: med.beta && isFinite(med.beta.beta) ? +med.beta.beta.toFixed(3) : (o.luz && o.luz.beta) || 0, data: new Date().toISOString().slice(0, 10), fonte: 'medido' };
      if (!B.saveCaderno(list)) { c.$('md-msg').textContent = 'Não consegui salvar (navegador em modo anônimo?).'; return; }
      c.$('md-msg').innerHTML = 'Salvo no <a href="caderno.html">Caderno</a>: ' + esc(o.name) + '. A Foto em cores e a Litofania já usam esse valor.';
    }
  };

  window.BI3D_LUZUI = { tools: { foto: FOTO, lito: LITO, medir: MEDIR }, escadinha: escadinha, TEMPO: TEMPO };
})();
