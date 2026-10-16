/* Big Insane 3D · Oficina de peças · interface
   Cada ferramenta desenha a peça em 2D (texto, QR, imagem), o motor (oficina-core.js) transforma em 3D
   e o projeto sai com o perfil oficial da impressora e as cores nos lugares certos. */
(function () {
  'use strict';
  var O = window.BI3D_OF, $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s).replace(/[<>&"]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]; }); };
  var nf = function (v, d) { return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); };

  var PRINTERS = [
    { id: 'kobra4', name: 'Anycubic Kobra 4', unit: 'ACE', bambu: false },
    { id: 'kobrax', name: 'Anycubic Kobra X', unit: 'ACE', bambu: false },
    { id: 'a1mini', name: 'Bambu Lab A1 mini', unit: 'AMS lite', bambu: true },
    { id: 'a1', name: 'Bambu Lab A1', unit: 'AMS lite', bambu: true },
    { id: 'ad5x', name: 'Flashforge AD5X', unit: 'IFS', bambu: false }
  ];
  var FONTS = [
    { id: 'Fredoka', name: 'Fredoka · arredondada', file: 'Fredoka.ttf', weight: '700', range: '300 700' },
    { id: 'Anton', name: 'Anton · alta e forte', file: 'Anton.ttf', weight: '400' },
    { id: 'LuckiestGuy', name: 'Luckiest Guy · desenho', file: 'LuckiestGuy.ttf', weight: '400' },
    { id: 'Righteous', name: 'Righteous · moderna', file: 'Righteous.ttf', weight: '400' },
    { id: 'Pacifico', name: 'Pacifico · cursiva', file: 'Pacifico.ttf', weight: '400' },
    { id: 'Lobster', name: 'Lobster · cursiva grossa', file: 'Lobster.ttf', weight: '400' }
  ];
  var fontReady = {};
  function loadFont(id) {
    if (fontReady[id]) return fontReady[id];
    var f = FONTS.filter(function (x) { return x.id === id; })[0] || FONTS[0];
    var desc = f.range ? { weight: f.range } : {};
    var ff = new FontFace('BI3D-' + f.id, 'url(fonts/' + f.file + ')', desc);
    fontReady[id] = ff.load().then(function (x) { document.fonts.add(x); return f; });
    return fontReady[id];
  }
  function fontOpts(def) { return FONTS.map(function (f) { return [f.id, f.name]; }); }

  /* ---------- texto -> campo ----------
     o: { text, font, size (altura das letras, mm) | width (largura total, mm), gap (entre linhas, × altura), ls (espaço entre letras, × altura),
          align, m: {l,r,t,b} margens em mm } ; grid (opcional): desenha no mesmo campo de outra camada, centrado em o.cx, o.cy */
  function lineBox(ctx, t, ls) {
    if (!ls) { var m = ctx.measureText(t || ' '); return { l: m.actualBoundingBoxLeft, r: m.actualBoundingBoxRight, a: m.actualBoundingBoxAscent, d: m.actualBoundingBoxDescent }; }
    var x = 0, b = { l: -1e9, r: -1e9, a: 0, d: 0 };
    Array.from(t).forEach(function (ch) {
      var m = ctx.measureText(ch);
      b.l = Math.max(b.l, m.actualBoundingBoxLeft - x); b.r = Math.max(b.r, x + m.actualBoundingBoxRight);
      b.a = Math.max(b.a, m.actualBoundingBoxAscent); b.d = Math.max(b.d, m.actualBoundingBoxDescent);
      x += m.width + ls;
    });
    if (b.r < -1e8) b = { l: 0, r: 0, a: 0, d: 0 };
    return b;
  }
  function drawLine(ctx, t, x, y, ls) {
    if (!ls) { ctx.fillText(t, x, y); return; }
    Array.from(t).forEach(function (ch) { ctx.fillText(ch, x, y); x += ctx.measureText(ch).width + ls; });
  }
  function textLayer(o, grid) {
    var f = FONTS.filter(function (x) { return x.id === o.font; })[0] || FONTS[0];
    var fam = '"BI3D-' + f.id + '"', lines = String(o.text || ' ').split('\n').map(function (s) { return s.replace(/\s+$/, ''); });
    if (!lines.some(function (s) { return s.trim(); })) lines = [' '];
    var mc = document.createElement('canvas').getContext('2d'); mc.font = f.weight + ' 100px ' + fam;
    var ls = (o.ls || 0) * 100, boxes = lines.map(function (t) { return lineBox(mc, t, ls); });
    var lh = Math.max.apply(null, boxes.map(function (b) { return b.a + b.d; })) || 70;
    var asc = Math.max.apply(null, boxes.map(function (b) { return b.a; })) || 50;
    var bb = lh * (o.gap || 1.08);
    var wRef = Math.max.apply(null, boxes.map(function (b) { return b.l + b.r; })) || 1;
    var hRef = boxes[0].a + (lines.length - 1) * bb + boxes[lines.length - 1].d;
    var k = o.width ? o.width / wRef : (o.size || 12) / lh; // mm por pixel de referência
    var m = o.m || { l: 2, r: 2, t: 2, b: 2 };
    var W, H, px, ox, oy, cw, ch;
    if (grid) { px = grid.px; cw = grid.w; ch = grid.h; ox = grid.ox; oy = grid.oy; W = cw * px; H = ch * px; }
    else {
      W = wRef * k + m.l + m.r; H = hRef * k + m.t + m.b;
      px = Math.max(o.px || 0, Math.max(W, H) / 1000, 0.055);
      cw = Math.ceil(W / px) + 1; ch = Math.ceil(H / px) + 1; ox = -m.l - wRef * k / 2; oy = m.t + hRef * k / 2;
    }
    var cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
    var ctx = cv.getContext('2d'), s = k / px; // pixels de canvas por pixel de referência
    ctx.font = f.weight + ' ' + (100 * s) + 'px ' + fam; ctx.fillStyle = '#fff'; ctx.textBaseline = 'alphabetic';
    // canto superior esquerdo do bloco de texto, em pixels do canvas
    var tx, ty;
    if (grid) { tx = ((o.cx || 0) - wRef * k / 2 - ox) / px; ty = (oy - (o.cy || 0) - hRef * k / 2) / px; }
    else { tx = m.l / px; ty = m.t / px; }
    var baselines = [];
    lines.forEach(function (t, i) {
      var b = boxes[i], lw = b.l + b.r, dx = o.align === 'left' ? 0 : o.align === 'right' ? wRef - lw : (wRef - lw) / 2;
      var x = tx + (dx + b.l) * s, y = ty + (boxes[0].a + i * bb) * s;
      ctx.save(); ctx.scale(1, 1); drawLine(ctx, t, x, y, ls * s); ctx.restore();
      baselines.push(oy - y * px);
    });
    var img = ctx.getImageData(0, 0, cw, ch).data, cov = new Float32Array(cw * ch);
    for (var i = 0; i < cw * ch; i++) cov[i] = img[i * 4 + 3] / 255;
    return { F: O.fromCoverage(cov, cw, ch, px, ox, oy), baselines: baselines, k: k, w: wRef * k, h: hRef * k, letter: lh * k, asc: asc * k };
  }

  /* ---------- ferramentas ---------- */
  var COMMON_PRINT = '<b>Imprime deitado, sem suporte.</b>';
  var TOOLS = {
    chaveiro: {
      name: 'Chaveiro com nome', ico: '🔑', sub: 'Nome em relevo com borda e argola. Duas cores ou uma pausa para trocar o filamento.',
      colors: [['cBase', 'Base'], ['cNome', 'Nome']],
      fields: [
        { id: 'text', label: 'Nome (Enter para 2 linhas)', type: 'textarea', def: 'Ana' },
        { id: 'font', label: 'Fonte', type: 'select', def: 'Fredoka', opts: fontOpts() },
        { id: 'size', label: 'Altura das letras (mm)', type: 'num', def: 14, min: 6, max: 40 },
        { id: 'border', label: 'Borda em volta (mm)', type: 'num', def: 3, min: 1.5, max: 8 },
        { id: 'ring', label: 'Argola', type: 'select', def: 'esq', opts: [['esq', 'À esquerda'], ['topo', 'Em cima'], ['nao', 'Sem argola']] },
        { id: 'hole', label: 'Furo da argola (mm)', type: 'num', def: 4.5, min: 2.5, max: 8, show: function (v) { return v.ring !== 'nao'; } },
        { id: 'tb', label: 'Espessura da base (mm)', type: 'num', def: 3, min: 1.6, max: 6, adv: true },
        { id: 'rel', label: 'Relevo do nome (mm)', type: 'num', def: 1.2, min: 0.4, max: 3, adv: true },
        { id: 'cBase', label: 'Cor da base', type: 'color', def: '#FFFFFF' },
        { id: 'cNome', label: 'Cor do nome', type: 'color', def: '#E0218A' }
      ],
      build: function (v) {
        var holeR = v.hole / 2, ringR = holeR + 2.2, mg = v.border + (v.ring === 'nao' ? 3 : ringR * 2 + 4);
        return loadFont(v.font).then(function () {
          var T = textLayer({ text: v.text, font: v.font, size: v.size, m: { l: mg, r: v.border + 3, t: v.ring === 'topo' ? mg : v.border + 3, b: v.border + 3 } });
          var F = T.F, base = O.redist(O.close(O.offset(F, v.border), 2.5)), bb = O.bbox(base);
          if (v.ring !== 'nao' && bb) {
            var cx = v.ring === 'topo' ? (bb.minX + bb.maxX) / 2 : bb.minX - holeR - 0.4, cy = v.ring === 'topo' ? bb.maxY + holeR + 0.4 : (bb.minY + bb.maxY) / 2;
            base = O.subtract(O.redist(O.close(O.union(base, O.circle(F, cx, cy, ringR)), 2)), O.circle(F, cx, cy, holeR));
          }
          return { layers: [{ F: base, z0: 0, z1: v.tb, color: 0, name: 'base' }, { F: F, z0: v.tb, z1: v.tb + v.rel, color: 1, name: 'nome' }], thin: F, name: 'chaveiro-' + v.text };
        });
      }
    },
    topo: {
      name: 'Topo de bolo', ico: '🎂', sub: 'Frase cursiva com contorno e palitos. Sai numa peça só, já ligada.',
      colors: [['cBase', 'Contorno'], ['cTexto', 'Frase']],
      fields: [
        { id: 'text', label: 'Frase (Enter para nova linha)', type: 'textarea', def: 'Feliz\nAniversário' },
        { id: 'font', label: 'Fonte', type: 'select', def: 'Pacifico', opts: fontOpts() },
        { id: 'width', label: 'Largura total (mm)', type: 'num', def: 140, min: 60, max: 240 },
        { id: 'border', label: 'Contorno (mm)', type: 'num', def: 3, min: 1.5, max: 8 },
        { id: 'sticks', label: 'Palitos', type: 'select', def: '2', opts: [['2', 'Dois palitos'], ['1', 'Um palito'], ['0', 'Sem palito (enfeite)']] },
        { id: 'slen', label: 'Comprimento do palito (mm)', type: 'num', def: 60, min: 30, max: 120, show: function (v) { return v.sticks !== '0'; } },
        { id: 'tb', label: 'Espessura (mm)', type: 'num', def: 2.4, min: 1.6, max: 5, adv: true },
        { id: 'rel', label: 'Relevo da frase (mm, 0 = cor única)', type: 'num', def: 1, min: 0, max: 3, adv: true },
        { id: 'cBase', label: 'Cor do contorno', type: 'color', def: '#D4AF37' },
        { id: 'cTexto', label: 'Cor da frase', type: 'color', def: '#FFFFFF' }
      ],
      build: function (v) {
        var slen = v.sticks === '0' ? 0 : v.slen;
        return loadFont(v.font).then(function () {
          var T = textLayer({ text: v.text, font: v.font, width: v.width - 2 * v.border, gap: 0.95, m: { l: v.border + 3, r: v.border + 3, t: v.border + 3, b: v.border + slen + 6 } });
          var F = T.F, base = O.redist(O.close(O.offset(F, v.border), 3)), notes = [];
          var bb = O.bbox(base);
          if (O.components(base).count > 1 && bb) { // letras soltas: barra embaixo liga tudo
            base = O.redist(O.close(O.union(base, O.rect(F, bb.minX + v.border, bb.minY, bb.maxX - v.border, bb.minY + 4, 1.5)), 2));
            notes.push('Algumas partes ficavam soltas: coloquei uma barra embaixo para virar uma peça só.');
          }
          bb = O.bbox(base);
          if (slen && bb) {
            var xs = v.sticks === '1' ? [(bb.minX + bb.maxX) / 2] : [bb.minX + (bb.maxX - bb.minX) * 0.3, bb.minX + (bb.maxX - bb.minX) * 0.7];
            xs.forEach(function (x) {
              base = O.union(base, O.polygon(F, [[x - 2.5, bb.minY + 6], [x + 2.5, bb.minY + 6], [x + 2.5, bb.minY - slen + 8], [x, bb.minY - slen], [x - 2.5, bb.minY - slen + 8]]));
            });
            base = O.redist(O.close(base, 1.5));
          }
          var layers = [{ F: base, z0: 0, z1: v.tb, color: 0, name: 'contorno' }];
          if (v.rel > 0) layers.push({ F: F, z0: v.tb, z1: v.tb + v.rel, color: 1, name: 'frase' });
          return { layers: layers, thin: F, notes: notes, single: !(v.rel > 0), name: 'topo-' + v.text.split('\n')[0] };
        });
      }
    },
    letreiro: {
      name: 'Letreiro em pé', ico: '🔠', sub: 'Palavra grande que fica em pé, com uma frase na frente. As letras se encostam sozinhas.',
      colors: [['cBase', 'Palavra'], ['cFrente', 'Frase da frente']],
      fields: [
        { id: 'text', label: 'Palavra grande', type: 'text', def: 'AMOR' },
        { id: 'font', label: 'Fonte da palavra', type: 'select', def: 'Anton', opts: fontOpts() },
        { id: 'size', label: 'Altura das letras (mm)', type: 'num', def: 50, min: 20, max: 150 },
        { id: 'depth', label: 'Espessura (mm, é o que deixa em pé)', type: 'num', def: 14, min: 6, max: 40 },
        { id: 'front', label: 'Frase da frente (vazio = nenhuma)', type: 'text', def: 'para sempre' },
        { id: 'ffont', label: 'Fonte da frase', type: 'select', def: 'Pacifico', opts: fontOpts() },
        { id: 'fsize', label: 'Altura da frase (mm)', type: 'num', def: 14, min: 5, max: 60 },
        { id: 'fy', label: 'Posição da frase (− baixo, + cima, mm)', type: 'num', def: 0, min: -80, max: 80, step: 1 },
        { id: 'fx', label: 'Posição da frase (− esquerda, + direita, mm)', type: 'num', def: 0, min: -150, max: 150, step: 1, adv: true },
        { id: 'bar', label: 'Base reta embaixo (fica mais firme)', type: 'check', def: true },
        { id: 'rel', label: 'Relevo da frase (mm)', type: 'num', def: 1.2, min: 0.4, max: 3, adv: true },
        { id: 'cBase', label: 'Cor da palavra', type: 'color', def: '#F5F0E6' },
        { id: 'cFrente', label: 'Cor da frase', type: 'color', def: '#C8102E' }
      ],
      cache: {},
      build: function (v) {
        var self = this;
        return Promise.all([loadFont(v.font), loadFont(v.ffont)]).then(function () {
          var key = [v.text, v.font, v.size].join('|'), notes = [];
          function render(ls, coarse) { return textLayer({ text: v.text.replace(/\n/g, ' '), font: v.font, size: v.size, ls: ls, px: coarse ? Math.max(0.25, v.size / 120) : 0, m: { l: 6, r: 6, t: 6, b: 6 } }); }
          // procura o espaçamento que deixa todas as letras encostadas (uma peça só)
          var T = self.cache.key === key ? self.cache.T : null;
          if (!T) {
            T = render(0);
            if (O.components(T.F).count > 1) {
              var lo = -0.35, hi = 0, best = null;
              for (var it = 0; it < 7; it++) { var mid = (lo + hi) / 2; if (O.components(render(mid, true).F).count === 1) { best = mid; lo = mid; } else hi = mid; }
              if (best !== null) {
                for (var tr = 0; tr < 4; tr++) { T = render(best - 0.004 - tr * 0.01); if (O.components(T.F).count === 1) break; }
                notes.push(O.components(T.F).count === 1 ? 'Aproximei as letras para elas se encostarem e virarem uma peça só.' : 'As letras quase se encostam: ligue a base reta embaixo.');
              } else notes.push('As letras não se encostaram: ligue a base reta embaixo ou escolha uma fonte mais grossa.');
            }
            self.cache = { key: key, T: T };
          }
          var F = T.F, base = O.clipY(F, T.baselines[0] - 0.01, null); // fundo reto na linha de base: fica em pé
          var bb = O.bbox(base);
          if (v.bar && bb) base = O.union(base, O.rect(F, bb.minX, T.baselines[0], bb.maxX, T.baselines[0] + Math.max(3, v.size * 0.07), 0));
          base = O.redist(base);
          if (/[gjpqyçQ]/.test(v.text)) notes.push('Letras com perna para baixo (g, j, p, q, y) foram cortadas na linha de base para a peça ficar em pé.');
          var layers = [{ F: base, z0: 0, z1: v.depth, color: 0, name: 'palavra' }];
          if (String(v.front || '').trim()) {
            var fr = textLayer({ text: v.front, font: v.ffont, size: v.fsize, cx: v.fx, cy: (T.baselines[0] + T.letter / 2) + v.fy }, F).F;
            var face = O.offset(base, -0.8), clip = O.intersect(fr, face);
            if (O.area(clip) < O.area(fr) * 0.97) notes.push('Parte da frase passava da palavra e foi cortada (não pode ficar no ar). Ajuste a posição ou o tamanho.');
            if (O.area(clip) > 1) layers.push({ F: clip, z0: v.depth, z1: v.depth + v.rel, color: 1, name: 'frase' });
          }
          notes.push('Imprime deitado com a frase para cima. Depois é só colocar em pé.');
          return { layers: layers, thin: F, notes: notes, single: layers.length < 2, name: 'letreiro-' + v.text };
        });
      }
    },
    qr: {
      name: 'Placa QR e Pix', ico: '▦', sub: 'Placa de balcão com Pix, Instagram, cardápio ou Wi-Fi. O código sai em relevo e lê no celular.',
      colors: [['cPlaca', 'Placa'], ['cCodigo', 'Código']],
      fields: [
        { id: 'kind', label: 'O que o QR abre', type: 'select', def: 'pix', opts: [['pix', 'Pix (copia e cola)'], ['link', 'Link (Instagram, cardápio, site)'], ['wifi', 'Wi-Fi'], ['texto', 'Texto']] },
        { id: 'pkey', label: 'Chave Pix (CPF, CNPJ, e-mail, telefone ou aleatória)', type: 'text', def: '', show: function (v) { return v.kind === 'pix'; } },
        { id: 'pname', label: 'Nome de quem recebe', type: 'text', def: '', show: function (v) { return v.kind === 'pix'; } },
        { id: 'pcity', label: 'Cidade', type: 'text', def: '', show: function (v) { return v.kind === 'pix'; } },
        { id: 'pval', label: 'Valor fixo (vazio = cliente digita)', type: 'text', def: '', show: function (v) { return v.kind === 'pix'; } },
        { id: 'url', label: 'Link', type: 'text', def: 'https://instagram.com/', show: function (v) { return v.kind === 'link'; } },
        { id: 'ssid', label: 'Nome da rede', type: 'text', def: '', show: function (v) { return v.kind === 'wifi'; } },
        { id: 'wpass', label: 'Senha', type: 'text', def: '', show: function (v) { return v.kind === 'wifi'; } },
        { id: 'free', label: 'Texto', type: 'textarea', def: '', show: function (v) { return v.kind === 'texto'; } },
        { id: 'label', label: 'Escrito embaixo (vazio = nada)', type: 'text', def: 'PIX' },
        { id: 'width', label: 'Largura da placa (mm)', type: 'num', def: 80, min: 40, max: 200 },
        { id: 'hang', label: 'Furo para pendurar', type: 'check', def: false },
        { id: 'tb', label: 'Espessura da placa (mm)', type: 'num', def: 3, min: 2, max: 6, adv: true },
        { id: 'rel', label: 'Relevo do código (mm)', type: 'num', def: 1, min: 0.6, max: 2, adv: true },
        { id: 'cPlaca', label: 'Cor da placa (clara)', type: 'color', def: '#FFFFFF' },
        { id: 'cCodigo', label: 'Cor do código (escura)', type: 'color', def: '#111111' }
      ],
      payload: function (v) {
        if (v.kind === 'pix') return v.pkey ? O.pix({ key: v.pkey, name: v.pname, city: v.pcity, amount: v.pval }) : '';
        if (v.kind === 'wifi') return v.ssid ? 'WIFI:T:' + (v.wpass ? 'WPA' : 'nopass') + ';S:' + v.ssid.replace(/([\\;,:"])/g, '\\$1') + ';P:' + (v.wpass || '').replace(/([\\;,:"])/g, '\\$1') + ';;' : '';
        if (v.kind === 'link') return v.url;
        return v.free;
      },
      build: function (v) {
        var data = this.payload(v), demo = false;
        if (!data && v.kind === 'pix') { data = O.pix({ key: 'exemplo@biginsane3d.com', name: 'SEU NOME', city: 'SUA CIDADE' }); demo = true; }
        if (!data) return Promise.reject(new Error(v.kind === 'pix' ? 'Preencha a chave Pix.' : v.kind === 'wifi' ? 'Preencha o nome da rede.' : 'Preencha o conteúdo do QR.'));
        var q = qrcode(0, 'M'); q.addData(unescape(encodeURIComponent(data))); q.make();
        var n = q.getModuleCount(), W = v.width, mod = (W - 6) / (n + 4), side = mod * n, notes = [];
        if (mod < 1.2) notes.push('Cada quadradinho do código ficou com ' + nf(mod, 2) + ' mm. Abaixo de 1,2 mm o bico 0,4 mm não desenha bem: aumente a placa.');
        var label = String(v.label || '').trim(), labH = label ? Math.max(6, Math.min(14, W * 0.12)) : 0, hangH = v.hang ? 9 : 0;
        var Ht = W + labH + hangH;
        var px = Math.max(0.05, Math.min(mod / 5, Math.max(W, Ht) / 900)), m = 3;
        var w = Math.ceil((W + 2 * m) / px), h = Math.ceil((Ht + 2 * m) / px), ox = -W / 2 - m, oy = Ht / 2 + m;
        var F = new O.Field(w, h, px, ox, oy), cov = new Float32Array(w * h);
        var qx0 = -side / 2, qy0 = Ht / 2 - hangH - mod * 2 - 3; // canto de cima do código
        for (var j = 0; j < h; j++) { var y = oy - (j + 0.5) * px, r = Math.floor((qy0 - y) / mod); if (r < 0 || r >= n) continue;
          for (var i = 0; i < w; i++) { var x = ox + (i + 0.5) * px, c = Math.floor((x - qx0) / mod); if (c >= 0 && c < n && q.isDark(r, c)) cov[j * w + i] = 1; } }
        var code = O.fromCoverage(cov, w, h, px, ox, oy);
        var plate = O.rect(F, -W / 2, -Ht / 2, W / 2, Ht / 2, 4);
        if (v.hang) plate = O.subtract(plate, O.circle(F, 0, Ht / 2 - 5, 2.5));
        var p = loadFont('Fredoka');
        return p.then(function () {
          if (label) {
            var lt = textLayer({ text: label, font: 'Fredoka', size: labH * 0.72, cx: 0, cy: qy0 - side - mod * 2 - labH / 2 + 1 }, F).F;
            var lb = O.bbox(lt); if (lb && lb.maxX - lb.minX > W - 8) notes.push('O texto de baixo é maior que a placa: diminua o texto ou aumente a placa.');
            code = O.union(code, O.intersect(lt, O.offset(plate, -1.5)));
          }
          if (demo) notes.unshift('Isto é um exemplo. Coloque a sua chave Pix, o seu nome e a cidade para liberar o download.');
          notes.push('Antes de imprimir, aponte a câmera do celular para o código na tela e confira. ' + (v.kind === 'pix' ? 'No Pix, teste no app do banco.' : ''));
          return { layers: [{ F: plate, z0: 0, z1: v.tb, color: 0, name: 'placa' }, { F: code, z0: v.tb, z1: v.tb + v.rel, color: 1, name: 'codigo' }], notes: notes, info: { payload: data, modules: n, mod: mod }, demo: demo, name: 'placa-' + v.kind };
        });
      }
    },
    logo: {
      name: 'Logo ou desenho em cores', ico: '🎨', sub: 'Envie uma imagem (logo, desenho, emoji). A ferramenta separa as cores e monta a peça colorida.',
      colors: [],
      fields: [
        { id: 'img', label: 'Imagem (PNG ou JPG; fundo liso ajuda)', type: 'file' },
        { id: 'width', label: 'Largura (mm)', type: 'num', def: 70, min: 20, max: 200 },
        { id: 'k', label: 'Quantas cores', type: 'select', def: '3', opts: [['2', '2 cores'], ['3', '3 cores'], ['4', '4 cores']] },
        { id: 'bg', label: 'Tirar o fundo da imagem', type: 'check', def: true },
        { id: 'shape', label: 'Formato', type: 'select', def: 'recorte', opts: [['recorte', 'Recortado no desenho'], ['placa', 'Placa arredondada'], ['circulo', 'Círculo']] },
        { id: 'border', label: 'Borda em volta (mm)', type: 'num', def: 2, min: 0, max: 8 },
        { id: 'hang', label: 'Furo (chaveiro ou pendurar)', type: 'check', def: false },
        { id: 'tb', label: 'Espessura da base (mm)', type: 'num', def: 2, min: 1.2, max: 6, adv: true },
        { id: 'rel', label: 'Altura de cada cor (mm)', type: 'num', def: 0.6, min: 0.4, max: 2, adv: true },
        { id: 'detail', label: 'Menor detalhe (mm)', type: 'num', def: 0.6, min: 0.3, max: 2, adv: true }
      ],
      img: null, pal: null,
      build: function (v) {
        var self = this, im = self.img;
        if (!im) return Promise.reject(new Error('Escolha uma imagem.'));
        var k = +v.k, W = v.width, H = W * im.height / im.width, m = v.border + (v.hang ? 12 : 3) + 2;
        var px = Math.max(Math.max(W, H) / 800, 0.07), w = Math.ceil((W + 2 * m) / px), h = Math.ceil((H + 2 * m) / px), ox = -W / 2 - m, oy = H / 2 + m;
        var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        var ctx = cv.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(im, m / px, m / px, W / px, H / px);
        var d = ctx.getImageData(0, 0, w, h).data, x0 = Math.round(m / px), y0 = Math.round(m / px), x1 = Math.round((m + W) / px) - 1, y1 = Math.round((m + H) / px) - 1;
        // k-médias nas cores (amostra), centros iniciais espalhados
        var samp = [], step = Math.max(1, Math.floor(Math.sqrt((x1 - x0) * (y1 - y0) / 40000)));
        for (var y = y0; y <= y1; y += step) for (var x = x0; x <= x1; x += step) { var o = (y * w + x) * 4; if (d[o + 3] > 128) samp.push([d[o], d[o + 1], d[o + 2]]); }
        var transparent = false; for (y = y0; y <= y1 && !transparent; y += step) for (x = x0; x <= x1; x += step) if (d[(y * w + x) * 4 + 3] < 128) { transparent = true; break; }
        var kk = Math.max(1, transparent ? k - 1 : k), C = [samp[0] || [255, 255, 255]];
        while (C.length < kk && samp.length) {
          var far = null, fd = -1;
          samp.forEach(function (s) { var md = Math.min.apply(null, C.map(function (c) { return (s[0] - c[0]) * (s[0] - c[0]) + (s[1] - c[1]) * (s[1] - c[1]) + (s[2] - c[2]) * (s[2] - c[2]); })); if (md > fd) { fd = md; far = s; } });
          C.push(far.slice());
        }
        for (var it = 0; it < 12; it++) {
          var acc = C.map(function () { return [0, 0, 0, 0]; });
          samp.forEach(function (s) { var bi = 0, bd = 1e12; C.forEach(function (c, ci) { var dd = (s[0] - c[0]) * (s[0] - c[0]) + (s[1] - c[1]) * (s[1] - c[1]) + (s[2] - c[2]) * (s[2] - c[2]); if (dd < bd) { bd = dd; bi = ci; } }); var a = acc[bi]; a[0] += s[0]; a[1] += s[1]; a[2] += s[2]; a[3]++; });
          C = C.map(function (c, ci) { var a = acc[ci]; return a[3] ? [a[0] / a[3], a[1] / a[3], a[2] / a[3]] : c; });
        }
        var lab = new Int8Array(w * h).fill(-1), cnt = C.map(function () { return 0; }), edge = C.map(function () { return 0; });
        for (y = y0; y <= y1; y++) for (x = x0; x <= x1; x++) {
          o = (y * w + x) * 4; if (d[o + 3] < 128) continue;
          var bi = 0, bd = 1e12; for (var ci = 0; ci < C.length; ci++) { var c = C[ci], dd = (d[o] - c[0]) * (d[o] - c[0]) + (d[o + 1] - c[1]) * (d[o + 1] - c[1]) + (d[o + 2] - c[2]) * (d[o + 2] - c[2]); if (dd < bd) { bd = dd; bi = ci; } }
          lab[y * w + x] = bi; cnt[bi]++; if (x === x0 || x === x1 || y === y0 || y === y1) edge[bi]++;
        }
        var hex = function (c) { return '#' + c.map(function (x) { return ('0' + Math.round(x).toString(16)).slice(-2); }).join('').toUpperCase(); };
        // base: a cor do fundo (tirando o fundo) ou a cor que mais aparece (placa inteira)
        var bgi = -1, ref = v.bg ? edge : cnt;
        if (!transparent) { bgi = 0; ref.forEach(function (e, i) { if (e > ref[bgi]) bgi = i; }); }
        // ordem: fundo (se houver) e depois da maior área para a menor
        var order = C.map(function (c, i) { return i; }).filter(function (i) { return i !== bgi && cnt[i] > 0; }).sort(function (a, b) { return cnt[b] - cnt[a]; });
        var key = C.map(hex).join(',') + '|' + bgi;
        if (!self.pal || self.pal.key !== key) self.pal = { key: key, colors: order.map(function (i) { return hex(C[i]); }), base: bgi >= 0 ? hex(C[bgi]) : (transparent ? '#FFFFFF' : hex(C[order[0]])) };
        var regions = order.map(function (i) {
          var cov = new Float32Array(w * h); for (var p = 0; p < w * h; p++) if (lab[p] === i) cov[p] = 1;
          return O.open(O.close(O.fromCoverage(cov, w, h, px, ox, oy), v.detail / 2), v.detail / 2);
        });
        var anyF = regions[0] || O.rect(new O.Field(w, h, px, ox, oy), -W / 2, -H / 2, W / 2, H / 2, 0), notes = [];
        if (!v.bg && !transparent && v.shape === 'recorte') v.shape = 'placa';
        var sil;
        if (!v.bg && !transparent) sil = O.rect(anyF, -W / 2, -H / 2, W / 2, H / 2, 0);
        else sil = regions.length ? O.redist(O.close(O.union.apply(null, regions), 1.5)) : anyF;
        var base;
        if (v.shape === 'placa') { var bb = O.bbox(sil) || { minX: -W / 2, maxX: W / 2, minY: -H / 2, maxY: H / 2 }; base = O.rect(anyF, bb.minX - v.border, bb.minY - v.border, bb.maxX + v.border, bb.maxY + v.border, Math.min(6, v.border + 3)); }
        else if (v.shape === 'circulo') { var b2 = O.bbox(sil) || { minX: -W / 2, maxX: W / 2, minY: -H / 2, maxY: H / 2 }; base = O.circle(anyF, (b2.minX + b2.maxX) / 2, (b2.minY + b2.maxY) / 2, Math.hypot(b2.maxX - b2.minX, b2.maxY - b2.minY) / 2 + v.border); }
        else base = O.redist(O.close(O.offset(sil, v.border), 2));
        if (O.components(base).count > 1) notes.push('O desenho tem partes soltas: use "Placa arredondada" ou aumente a borda para virar uma peça só.');
        if (v.hang) { var b3 = O.bbox(base); if (b3) { var cx = (b3.minX + b3.maxX) / 2, cy = b3.maxY + 1.6; base = O.subtract(O.redist(O.close(O.union(base, O.circle(anyF, cx, cy, 4.6)), 2)), O.circle(anyF, cx, cy, 2.3)); } }
        // cada cor só onde tem base embaixo
        var inner = O.offset(O.redist(base), -0.4);
        regions = regions.map(function (r) { return O.intersect(r, inner); });
        var cols = self.pal.colors, layers = [{ F: base, z0: 0, z1: v.tb, color: 0, name: 'base' }];
        regions.forEach(function (r, i) { if (O.area(r) > 0.5) layers.push({ F: r, color: i + 1, name: 'cor ' + (i + 1) }); });
        return Promise.resolve({ layers: layers, stack: true, notes: notes, palette: [self.pal.base].concat(cols), name: 'logo' });
      }
    },
    vaso: {
      name: 'Vaso e cachepô', ico: '🏺', sub: 'Vaso paramétrico para o modo vaso: parede única, imprime rápido e gasta pouco.',
      colors: [['cor', 'Vaso']],
      fields: [
        { id: 'style', label: 'Estilo', type: 'select', def: 'ondas', opts: [['liso', 'Liso'], ['ondas', 'Ondas'], ['facetado', 'Facetado'], ['petalas', 'Pétalas']] },
        { id: 'height', label: 'Altura (mm)', type: 'num', def: 120, min: 30, max: 250 },
        { id: 'baseD', label: 'Diâmetro da base (mm)', type: 'num', def: 70, min: 20, max: 200 },
        { id: 'topD', label: 'Diâmetro da boca (mm)', type: 'num', def: 90, min: 20, max: 240 },
        { id: 'belly', label: 'Barriga (mm a mais no meio)', type: 'num', def: 10, min: -20, max: 40 },
        { id: 'lobes', label: 'Ondas, lados ou pétalas', type: 'num', def: 10, min: 3, max: 40, show: function (v) { return v.style !== 'liso'; } },
        { id: 'amp', label: 'Intensidade (%)', type: 'num', def: 8, min: 1, max: 30, show: function (v) { return v.style === 'ondas' || v.style === 'petalas'; } },
        { id: 'twist', label: 'Torção (graus)', type: 'num', def: 90, min: -360, max: 360, step: 5 },
        { id: 'cor', label: 'Cor', type: 'color', def: '#7FB8A4' }
      ],
      build: function (v) {
        var tri = O.vase({ height: v.height, baseD: v.baseD, topD: v.topD, belly: v.belly, style: v.style, lobes: v.lobes, amp: v.amp, twist: v.twist });
        return Promise.resolve({ mesh: [{ tri: tri, color: 0, name: 'vaso' }], vase: true, notes: ['Modo vaso ligado no projeto: parede única em espiral, sem costura. Para segurar água, use PETG ou passe verniz por dentro.'], name: 'vaso-' + v.style });
      }
    }
  };
  var ORDER = ['chaveiro', 'topo', 'letreiro', 'qr', 'logo', 'vaso'];
  // ferramentas com tela própria (Foto em cores, Litofania, Medir filamento: js/luz-ui.js)
  if (window.BI3D_LUZUI) Object.keys(window.BI3D_LUZUI.tools).forEach(function (id) { TOOLS[id] = window.BI3D_LUZUI.tools[id]; if (!TOOLS[id].fields) TOOLS[id].fields = []; ORDER.push(id); });

  /* ---------- estado e formulário ---------- */
  var cur = 'chaveiro', vals = {}, last = null, tplCache = {}, timer = 0, busy = false, again = false;
  function store(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem('bi3d_of_' + k) || 'null'); localStorage.setItem('bi3d_of_' + k, JSON.stringify(v)); } catch (e) { return null; } }
  function defaults(id) { var o = {}; TOOLS[id].fields.forEach(function (f) { if (f.type !== 'file') o[f.id] = f.def; }); return o; }
  function load(id) { var s = store('t_' + id) || {}, d = defaults(id); Object.keys(d).forEach(function (k) { if (s[k] !== undefined) d[k] = s[k]; }); return d; }

  function renderTabs() {
    $('of-tabs').innerHTML = ORDER.map(function (id) { var t = TOOLS[id]; return '<button type="button" role="tab" data-t="' + id + '" aria-selected="' + (id === cur) + '" class="of-tab' + (id === cur ? ' on' : '') + '"><span>' + t.ico + '</span>' + esc(t.name) + '</button>'; }).join('');
  }
  function fieldHTML(f, v) {
    var id = 'of-f-' + f.id, val = v[f.id], lab = '<label for="' + id + '">' + esc(f.label) + '</label>';
    if (f.type === 'textarea') return lab + '<textarea id="' + id + '" rows="2">' + esc(val) + '</textarea>';
    if (f.type === 'select') return lab + '<select id="' + id + '">' + f.opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(val) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>';
    if (f.type === 'check') return '<label class="pp-check"><input type="checkbox" id="' + id + '"' + (val ? ' checked' : '') + '> ' + esc(f.label) + '</label>';
    if (f.type === 'color') return lab + '<div class="of-color"><input type="color" id="' + id + '" value="' + esc(val) + '"><span>' + esc(val) + '</span></div>';
    if (f.type === 'file') return lab + '<input type="file" id="' + id + '" accept="image/png,image/jpeg,image/webp">';
    if (f.type === 'num') return lab + '<input id="' + id + '" inputmode="decimal" value="' + esc(String(val).replace('.', ',')) + '">';
    return lab + '<input id="' + id + '" value="' + esc(val) + '">';
  }
  function renderForm() {
    var t = TOOLS[cur], v = vals[cur];
    $('of-sub').textContent = t.sub;
    if (t.custom) { t.mount(ctx()); return; }
    var main = t.fields.filter(function (f) { return !f.adv && (!f.show || f.show(v)); }), adv = t.fields.filter(function (f) { return f.adv && (!f.show || f.show(v)); });
    $('of-form').innerHTML = '<div class="row">' + main.map(function (f) { return '<div class="of-f of-' + f.type + '">' + fieldHTML(f, v) + '</div>'; }).join('') + '</div>' +
      (adv.length ? '<details class="of-adv"><summary>Medidas finas</summary><div class="in"><div class="row">' + adv.map(function (f) { return '<div class="of-f">' + fieldHTML(f, v) + '</div>'; }).join('') + '</div></div></details>' : '') +
      '<div id="of-pal"></div>';
    t.fields.forEach(function (f) {
      var el = $('of-f-' + f.id); if (!el) return;
      var ev = f.type === 'select' || f.type === 'check' || f.type === 'file' ? 'change' : 'input';
      el.addEventListener(ev, function () {
        if (f.type === 'file') { readImage(el.files[0]); return; }
        var x = f.type === 'check' ? el.checked : el.value;
        if (f.type === 'num') { x = parseFloat(String(x).replace(',', '.')); if (!isFinite(x)) return; if (f.min !== undefined) x = Math.max(f.min, Math.min(f.max, x)); }
        if (f.type === 'color' && el.nextElementSibling) el.nextElementSibling.textContent = x.toUpperCase();
        v[f.id] = x; store('t_' + cur, v);
        if (t.fields.some(function (g) { return g.show; }) && (f.type === 'select' || f.type === 'check')) { renderForm(); }
        schedule(f.type === 'text' || f.type === 'textarea' || f.type === 'num' ? 450 : 60);
      });
    });
    if (cur === 'logo') renderPalette();
  }
  function renderPalette() {
    var t = TOOLS.logo, el = $('of-pal'); if (!el) return;
    if (!t.pal) { el.innerHTML = t.img ? '' : '<p class="rx-note">Sem imagem? <button type="button" class="ghost of-mini" id="of-demo">Testar com um desenho nosso</button></p>'; var b = $('of-demo'); if (b) b.onclick = demoImage; return; }
    var all = [t.pal.base].concat(t.pal.colors), names = ['Base'].concat(t.pal.colors.map(function (c, i) { return 'Cor ' + (i + 1); }));
    el.innerHTML = '<label>Cores que a ferramenta encontrou (clique para trocar pelo filamento que você tem)</label><div class="of-swatches">' + all.map(function (c, i) {
      return '<label class="of-sw"><input type="color" data-i="' + i + '" value="' + c + '"><span>' + names[i] + '</span></label>'; }).join('') + '</div>';
    Array.prototype.forEach.call(el.querySelectorAll('input[type=color]'), function (inp) {
      inp.addEventListener('input', function () { var i = +inp.dataset.i; if (i === 0) t.pal.base = inp.value.toUpperCase(); else t.pal.colors[i - 1] = inp.value.toUpperCase(); schedule(80, true); });
    });
  }
  function readImage(file) {
    if (!file) return;
    if (file.size > 15 * 1048576) { showErr('Imagem acima de 15 MB.'); return; }
    var url = URL.createObjectURL(file), im = new Image();
    im.onload = function () { TOOLS.logo.img = im; TOOLS.logo.pal = null; schedule(10); };
    im.onerror = function () { showErr('Não consegui abrir essa imagem. Use PNG ou JPG.'); };
    im.src = url;
  }
  function demoImage() {
    var c = document.createElement('canvas'); c.width = 600; c.height = 600; var x = c.getContext('2d');
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, 600, 600);
    x.fillStyle = '#ffcc00'; x.beginPath(); x.arc(300, 300, 250, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#222222'; x.beginPath(); x.ellipse(215, 240, 32, 48, 0, 0, Math.PI * 2); x.fill(); x.beginPath(); x.ellipse(385, 240, 32, 48, 0, 0, Math.PI * 2); x.fill();
    x.strokeStyle = '#222222'; x.lineWidth = 34; x.lineCap = 'round'; x.beginPath(); x.arc(300, 320, 140, 0.15 * Math.PI, 0.85 * Math.PI); x.stroke();
    x.fillStyle = '#e8434b'; x.beginPath(); x.ellipse(160, 360, 40, 26, 0, 0, Math.PI * 2); x.fill(); x.beginPath(); x.ellipse(440, 360, 40, 26, 0, 0, Math.PI * 2); x.fill();
    var im = new Image(); im.onload = function () { TOOLS.logo.img = im; TOOLS.logo.pal = null; schedule(10); }; im.src = c.toDataURL('image/png');
  }

  /* ---------- gerar ---------- */
  function printer() { var id = $('of-printer').value; return PRINTERS.filter(function (p) { return p.id === id; })[0] || PRINTERS[0]; }
  function tpl(id) {
    if (tplCache[id]) return Promise.resolve(tplCache[id]);
    return fetch('perfis-oficiais/' + id + '.json').then(function (r) { if (!r.ok) throw new Error('Perfil da impressora não encontrado.'); return r.json(); }).then(function (j) { tplCache[id] = j; return j; });
  }
  function schedule(ms) { clearTimeout(timer); timer = setTimeout(run, ms || 300); }
  function showErr(msg) { $('of-out').innerHTML = '<div class="box warn"><b>Falta um detalhe</b><p>' + esc(msg) + '</p></div>'; $('of-dl').disabled = true; $('of-stl').disabled = true; }

  // o que as ferramentas com tela própria podem usar daqui
  function ctx() {
    return { $: $, esc: esc, nf: nf, printer: printer, multi: function () { return $('of-mode').value === 'multi'; }, mat: function () { return $('of-mat').value; }, tpl: tpl,
      store: store, slug: slug, save: save, view: function (meshes, bed, opts) { try { BI3D_VIEW.show($('of-3d'), meshes, bed, opts); } catch (e) { $('of-3d').innerHTML = '<p class="rx-note" style="padding:16px">Seu navegador não abriu a visualização 3D, mas o arquivo sai normal.</p>'; } },
      out: function (html) { $('of-out').innerHTML = html; }, state: function (t) { $('of-state').textContent = t || ''; }, err: showErr,
      setLast: function (L) { last = L; $('of-dl').disabled = !L || !!L.demo; $('of-stl').disabled = !L || !!L.demo; } };
  }
  function run() {
    if (TOOLS[cur].custom) { TOOLS[cur].run(ctx()); return; }
    if (busy) { again = true; return; }
    busy = true; again = false;
    var t = TOOLS[cur], v = vals[cur], pr = printer(), multi = $('of-mode').value === 'multi', mat = $('of-mat').value;
    $('of-state').textContent = 'Montando a peça…';
    var t0 = performance.now();
    Promise.all([t.build(v), tpl(pr.id)]).then(function (a) {
      var res = a[0], tp = a[1], cfgGrid = O.layerGrid(tp.process && tp.process.std ? tp.process.std : {});
      // cores de cada camada
      var palette = res.palette || t.colors.map(function (c) { return v[c[0]]; });
      var parts = [], pauses = [];
      if (res.mesh) parts = res.mesh.map(function (m) { return { tri: m.tri, color: m.color, name: m.name }; });
      else {
        var L = res.layers.slice();
        // alturas sempre no fim de uma camada do fatiador (a troca de cor cai certinho)
        var zb = cfgGrid.snap(L[0].z1);
        L[0].z1 = zb;
        if (res.stack) { // logo: modo multicor = todas as cores na mesma altura; modo pausa = degraus, uma cor por altura
          var rel = cfgGrid.snap(zb + v.rel) - zb;
          L.slice(1).forEach(function (l, i) {
            if (multi) { l.z0 = zb; l.z1 = zb + rel; }
            else { l.z0 = zb + i * rel; l.z1 = zb + (i + 1) * rel; l.F = O.union.apply(null, L.slice(1 + i).map(function (x) { return x.F; })); }
          });
        } else L.slice(1).forEach(function (l) { var h = l.z1 - l.z0; l.z0 = zb; l.z1 = cfgGrid.snap(zb + h); });
        L.forEach(function (l) {
          var polys = O.polygons(l.F);
          if (polys.length) parts.push({ tri: O.toTri(O.extrude(polys, l.z0, l.z1)), color: l.color, name: l.name, z0: l.z0 });
        });
      }
      if (!parts.length) throw new Error('A peça ficou vazia. Confira o texto ou a imagem.');
      var used = [], colorsUsed = [];
      parts.forEach(function (p) { if (used.indexOf(p.color) < 0) used.push(p.color); });
      used.sort(function (a, b) { return a - b; });
      colorsUsed = used.map(function (c) { return palette[c] || '#FFFFFF'; });
      var single = used.length < 2 || res.single;
      var info = { cfg: {}, colors: multi && !single ? colorsUsed : [colorsUsed[0]], types: [mat], nFil: multi && !single ? colorsUsed.length : 1, designerDiffs: [], printer: '' };
      var r = BI3D_PREP.buildConfig(info, tp, { material: mat, quality: 'std' });
      var cfg = r.cfg;
      if (!cfg.machine_pause_gcode && pr.bambu) cfg.machine_pause_gcode = 'M400 U1';
      if (res.vase) { cfg.spiral_mode = '1'; cfg.wall_loops = '1'; cfg.top_shell_layers = '0'; cfg.bottom_shell_layers = '4'; cfg.sparse_infill_density = '0%'; cfg.enable_support = '0'; }
      else { cfg.enable_support = '0'; cfg.brim_type = 'no_brim'; }
      parts.forEach(function (p) { p.extruder = multi && !single ? used.indexOf(p.color) + 1 : 1; });
      if (!multi && !single) { // uma pausa onde começa cada cor nova
        var starts = {}; parts.forEach(function (p) { if (p.z0 > 0) starts[p.color] = Math.min(starts[p.color] || 1e9, p.z0); });
        Object.keys(starts).sort(function (a, b) { return starts[a] - starts[b]; }).forEach(function (c) {
          pauses.push({ z: +(starts[c] + cfgGrid.lh).toFixed(3), color: palette[c], gcode: cfg.machine_pause_gcode || 'M600', note: 'Troque para ' + palette[c] });
        });
      }
      var tris = parts.map(function (p) { return p.tri; }), b = O.bounds(tris), size = [b[3] - b[0], b[4] - b[1], b[5] - b[2]];
      var area = (cfg.printable_area || ['0x0', '256x0', '256x256', '0x256']).map(function (s) { return String(s).split('x').map(Number); });
      var bed = [Math.max.apply(null, area.map(function (p) { return p[0]; })), Math.max.apply(null, area.map(function (p) { return p[1]; }))];
      var vol = parts.reduce(function (s, p) { return s + O.volume(p.tri); }, 0) / 1000, dens = mat === 'PETG' ? 1.27 : 1.24;
      var grams = res.vase ? vaseGrams(tris[0], size[2]) * dens : parts.reduce(function (g, p) { var V = O.volume(p.tri), A = surf(p.tri), sh = Math.min(V, A * 0.85); return g + (sh + Math.max(0, V - sh) * 0.15) / 1000 * dens; }, 0);
      last = { parts: parts, cfg: cfg, bed: bed, pauses: pauses, name: res.name, size: size, colors: colorsUsed, multi: multi && !single, palette: palette };
      // aviso de partes finas demais
      var notes = (res.notes || []).slice();
      if (res.thin && O.area(res.thin) > 0) { var lost = 1 - O.area(O.open(res.thin, 0.35)) / O.area(res.thin); if (lost > 0.06) notes.unshift('Algumas partes do texto têm menos de 0,7 mm e podem sumir na impressão. Use uma fonte mais grossa ou aumente o tamanho.'); }
      var fits = size[0] <= bed[0] && size[1] <= bed[1] || size[0] <= bed[1] && size[1] <= bed[0];
      if (!fits) notes.unshift('A peça (' + nf(size[0]) + ' × ' + nf(size[1]) + ' mm) é maior que a mesa da ' + pr.name + ' (' + bed[0] + ' × ' + bed[1] + ' mm). Diminua o tamanho.');
      if (size[2] > (+cfg.printable_height || 250)) notes.unshift('Mais alto que a impressora consegue.');
      if (multi && colorsUsed.length > 4) notes.unshift('A peça usa ' + colorsUsed.length + ' cores e a ' + pr.unit + ' troca até 4.');
      show(res, size, grams, notes, pr, performance.now() - t0);
    }).catch(function (e) { showErr(e && e.message || String(e)); last = null; })
      .then(function () { busy = false; $('of-state').textContent = ''; if (again) run(); });
  }
  function surf(tri) { var a = 0; for (var i = 0; i < tri.length; i += 9) { var ux = tri[i + 3] - tri[i], uy = tri[i + 4] - tri[i + 1], uz = tri[i + 5] - tri[i + 2], vx = tri[i + 6] - tri[i], vy = tri[i + 7] - tri[i + 1], vz = tri[i + 8] - tri[i + 2]; a += Math.sqrt(Math.pow(uy * vz - uz * vy, 2) + Math.pow(uz * vx - ux * vz, 2) + Math.pow(ux * vy - uy * vx, 2)) / 2; } return a; }
  function vaseGrams(tri, H) { // parede única de 0,45 mm + fundo de 4 camadas
    var side = 0, bottom = 0;
    for (var i = 0; i < tri.length; i += 9) {
      var ux = tri[i + 3] - tri[i], uy = tri[i + 4] - tri[i + 1], uz = tri[i + 5] - tri[i + 2], vx = tri[i + 6] - tri[i], vy = tri[i + 7] - tri[i + 1], vz = tri[i + 8] - tri[i + 2];
      var cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx, a = Math.sqrt(cx * cx + cy * cy + cz * cz) / 2;
      if (Math.abs(cz) / (2 * a || 1) > 0.99) { if (tri[i + 2] < 0.01) bottom += a; } else side += a;
    }
    return (side * 0.45 + bottom * 0.8) / 1000;
  }
  function show(res, size, grams, notes, pr, ms) {
    var L = last, view = $('of-3d');
    // centraliza na mesa
    var b = O.bounds(L.parts.map(function (p) { return p.tri; })), dx = L.bed[0] / 2 - (b[0] + b[3]) / 2, dy = L.bed[1] / 2 - (b[1] + b[4]) / 2;
    var meshes = L.parts.map(function (p) { return { tri: O.translate(p.tri, dx, dy, -b[2]), color: L.palette[p.color] || '#ddd' }; });
    try { window.__bi3dNoAuto = false; BI3D_VIEW.show(view, meshes, L.bed, { showBed: false, autoRotate: false, fit: res.vase ? 1.9 : 1.6, top: !res.vase && L.size[2] < Math.max(L.size[0], L.size[1]) * 0.5 }); } catch (e) { view.innerHTML = '<p class="rx-note" style="padding:16px">Seu navegador não abriu a visualização 3D, mas o arquivo sai normal.</p>'; }
    var chips = L.colors.map(function (c, i) { return '<span class="of-chip"><i style="background:' + c + '"></i>' + (L.multi ? 'Filamento ' + (i + 1) : i === 0 ? 'Começa com' : 'Depois') + ' · ' + c + '</span>'; }).join('');
    var how = L.multi ? '<p>' + L.colors.length + ' cores: a ' + esc(pr.unit) + ' troca sozinha. A troca só acontece onde a cor muda, nas últimas camadas.</p>'
      : L.pauses.length ? '<p><b>Sem ' + esc(pr.unit) + ':</b> a impressora pausa ' + L.pauses.length + (L.pauses.length > 1 ? ' vezes' : ' vez') + '. Em cada pausa, troque o filamento e continue:</p><ol class="of-pauses">' + L.pauses.map(function (p) { return '<li>Na altura ' + nf(p.z, 2) + ' mm → <span class="of-chip"><i style="background:' + p.color + '"></i>' + p.color + '</span></li>'; }).join('') + '</ol>' : '<p>Uma cor só.</p>';
    var info = res.info && res.info.payload ? '<details class="of-adv"><summary>Conteúdo do QR</summary><div class="in"><p class="rx-note" style="word-break:break-all;font-family:var(--mono)">' + esc(res.info.payload) + '</p><p class="rx-note">' + res.info.modules + ' × ' + res.info.modules + ' quadradinhos de ' + nf(res.info.mod, 2) + ' mm.</p></div></details>' : '';
    $('of-out').innerHTML = '<div class="of-sum"><div><b>' + nf(size[0]) + ' × ' + nf(size[1]) + ' × ' + nf(size[2], 1) + ' mm</b><span>tamanho</span></div><div><b>~' + nf(grams, grams < 10 ? 1 : 0) + ' g</b><span>filamento da peça</span></div><div><b>' + L.colors.length + '</b><span>' + (L.colors.length > 1 ? 'cores' : 'cor') + '</span></div><div><b>' + esc(pr.name.replace(/^(Anycubic|Bambu Lab|Flashforge) /, '')) + '</b><span>perfil oficial</span></div></div>' +
      '<div class="of-chips">' + chips + '</div><div class="box tip">' + how + '</div>' +
      notes.map(function (n) { return '<div class="box' + (/maior|menos de|sumir|soltas|não se encostaram|Mais alto|exemplo/.test(n) ? ' warn' : '') + '"><p>' + esc(n) + '</p></div>'; }).join('') + info +
      '<p class="rx-note">' + COMMON_PRINT + ' Montado em ' + nf(ms / 1000, 1) + ' s no seu navegador. O peso é estimado; o exato aparece no fatiador e no <a href="raiox.html">Raio-X</a>.</p>';
    $('of-dl').disabled = !!res.demo; $('of-stl').disabled = !!res.demo;
    if (cur === 'logo') renderPalette();
  }
  function slug(s) { return String(s || 'peca').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'peca'; }
  function save(blob, name) { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000); }

  function init() {
    if (!O || !window.BI3D_PREP) return;
    ORDER.forEach(function (id) { vals[id] = load(id); });
    var h = location.hash.replace('#', ''); if (TOOLS[h]) cur = h; else if (store('cur') && TOOLS[store('cur')]) cur = store('cur');
    $('of-printer').innerHTML = PRINTERS.map(function (p) { return '<option value="' + p.id + '">' + esc(p.name) + '</option>'; }).join('');
    ['printer', 'mat', 'mode'].forEach(function (k) { var s = store('g_' + k); if (s) $('of-' + k).value = s; $('of-' + k).addEventListener('change', function () { store('g_' + k, $('of-' + k).value); updateMode(); schedule(30); }); });
    function updateMode() { var p = printer(); $('of-mode').options[0].text = 'Tenho ' + p.unit + ' (troca de cor sozinha)'; $('of-mode').options[1].text = 'Não tenho ' + p.unit + ' (pausa para trocar o filamento)'; }
    updateMode();
    $('of-tabs').addEventListener('click', function (e) { var b = e.target.closest('[data-t]'); if (!b) return; cur = b.dataset.t; store('cur', cur); history.replaceState(null, '', '#' + cur); renderTabs(); renderForm(); $('of-out').innerHTML = ''; schedule(10); });
    $('of-dl').addEventListener('click', function () {
      if (!last) return;
      var b = $('of-dl'); b.disabled = true; b.textContent = 'Gerando…';
      O.project({ parts: last.parts, cfg: last.cfg, bed: last.bed, name: last.name, pauses: last.pauses, changes: last.changes, mode: last.mode }).then(function (blob) { save(blob, slug(last.name) + '-' + printer().id + '.3mf'); })
        .catch(function (e) { showErr(String(e && e.message || e)); }).then(function () { b.disabled = false; b.textContent = 'Baixar projeto 3MF pronto'; });
    });
    $('of-stl').addEventListener('click', function () { if (!last) return; save(new Blob([O.stl(last.parts.map(function (p) { return p.tri; }))], { type: 'model/stl' }), slug(last.name) + '.stl'); });
    renderTabs(); renderForm(); schedule(10);
  }
  window.BI3D_OFICINA = { tools: TOOLS, textLayer: textLayer, loadFont: loadFont, last: function () { return last; } };
  if (document.readyState !== 'loading') init(); else document.addEventListener('DOMContentLoaded', init);
})();
