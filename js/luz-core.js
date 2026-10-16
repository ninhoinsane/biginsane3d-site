/* Big Insane 3D · Luz e cor · motor da Foto em cores (camadas de filamento) e da Litofania
   Sem rede e sem DOM: roda no navegador (worker) e no Node (testes).

   Modelo físico (lei de Beer-Lambert): a luz que atravessa t mm de um filamento cai como
   T(t) = a · e^(-k·t), um k por canal (R, G, B). k e a vêm da escadinha medida com o celular contra a luz.
   - Litofania (luz por trás): brilho = a · e^(-k·t).
   - Foto em cores (luz pela frente): cada camada cobre a de baixo com opacidade 1 - e^(-β·k·t),
     β ≈ 2 porque a luz atravessa a camada na ida e na volta. β é conferido com a peça impressa. */
(function (root) {
  'use strict';

  /* ---------- cor ---------- */
  var S2L = new Float32Array(256);
  for (var i = 0; i < 256; i++) { var c = i / 255; S2L[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function l2s(c) { c = c <= 0 ? 0 : c >= 1 ? 1 : c; c = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; return Math.round(c * 255); }
  function hexToLin(h) { h = String(h || '#ffffff').replace('#', ''); if (h.length < 6) h = 'ffffff'; return [S2L[parseInt(h.substr(0, 2), 16)], S2L[parseInt(h.substr(2, 2), 16)], S2L[parseInt(h.substr(4, 2), 16)]]; }
  function linToHex(c) { return '#' + c.map(function (x) { return ('0' + l2s(x).toString(16)).slice(-2); }).join('').toUpperCase(); }
  function labf(t) { return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; }
  // RGB linear (sRGB, D65) -> CIELAB
  function lab(r, g, b, out) {
    var X = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b, Y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b, Z = 0.0193339 * r + 0.1191920 * g + 0.9503041 * b;
    var fx = labf(X / 0.95047), fy = labf(Y), fz = labf(Z / 1.08883);
    out = out || [0, 0, 0]; out[0] = 116 * fy - 16; out[1] = 500 * (fx - fy); out[2] = 200 * (fy - fz); return out;
  }
  // CIEDE2000 (Sharma, Wu, Dalal 2005)
  var P25 = Math.pow(25, 7), RAD = Math.PI / 180;
  function de2000(L1, a1, b1, L2, a2, b2) {
    var C1 = Math.sqrt(a1 * a1 + b1 * b1), C2 = Math.sqrt(a2 * a2 + b2 * b2), Cb = (C1 + C2) / 2, Cb7 = Math.pow(Cb, 7);
    var G = 0.5 * (1 - Math.sqrt(Cb7 / (Cb7 + P25))), a1p = (1 + G) * a1, a2p = (1 + G) * a2;
    var C1p = Math.sqrt(a1p * a1p + b1 * b1), C2p = Math.sqrt(a2p * a2p + b2 * b2);
    var h1p = (b1 === 0 && a1p === 0) ? 0 : Math.atan2(b1, a1p) / RAD; if (h1p < 0) h1p += 360;
    var h2p = (b2 === 0 && a2p === 0) ? 0 : Math.atan2(b2, a2p) / RAD; if (h2p < 0) h2p += 360;
    var dLp = L2 - L1, dCp = C2p - C1p, dhp = 0;
    if (C1p * C2p !== 0) { dhp = h2p - h1p; if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360; }
    var dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhp * RAD / 2);
    var Lbp = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2, hbp;
    if (C1p * C2p === 0) hbp = h1p + h2p;
    else if (Math.abs(h1p - h2p) <= 180) hbp = (h1p + h2p) / 2;
    else hbp = (h1p + h2p < 360) ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
    var T = 1 - 0.17 * Math.cos((hbp - 30) * RAD) + 0.24 * Math.cos(2 * hbp * RAD) + 0.32 * Math.cos((3 * hbp + 6) * RAD) - 0.20 * Math.cos((4 * hbp - 63) * RAD);
    var dTh = 30 * Math.exp(-Math.pow((hbp - 275) / 25, 2)), Cbp7 = Math.pow(Cbp, 7), Rc = 2 * Math.sqrt(Cbp7 / (Cbp7 + P25));
    var L50 = (Lbp - 50) * (Lbp - 50), Sl = 1 + 0.015 * L50 / Math.sqrt(20 + L50), Sc = 1 + 0.045 * Cbp, Sh = 1 + 0.015 * Cbp * T, Rt = -Math.sin(2 * dTh * RAD) * Rc;
    var l = dLp / Sl, cc = dCp / Sc, hh = dHp / Sh;
    return Math.sqrt(l * l + cc * cc + hh * hh + Rt * cc * hh);
  }

  /* ---------- filamento ----------
     { nome, hex, k: [kr,kg,kb] 1/mm, a: [ar,ag,ab], fonte: 'medido'|'estimado' }
     Sem medida, k vem do TD publicado (HueForge/Prusa): TD ≈ espessura em que passa ~5% da luz -> k = ln(20)/TD */
  function fromTD(nome, hex, td) { var k = Math.log(20) / Math.max(0.05, td); return { nome: nome, hex: hex, k: [k, k, k], a: [0.9, 0.9, 0.9], td: td, fonte: 'estimado' }; }
  function tdOf(f) { var k = (f.k[0] + f.k[1] + f.k[2]) / 3; return Math.log(20) / k; }
  // valores de partida (TD publicado pela Prusa para cores parecidas); a medida do seu rolo substitui
  // contra a luz o PLA branco atenua mais do que o TD (pensado para luz de frente) sugere: ~1,2/mm em medidas publicadas
  // de litofania (cerca de 30% da luz passa por 1 mm). Vale só até você medir o seu rolo.
  var LITO_PADRAO = { nome: 'Branco (estimado)', hex: '#F2F2F2', k: [1.15, 1.2, 1.3], a: [0.9, 0.9, 0.9], fonte: 'estimado' };
  var PADRAO = [
    fromTD('Branco', '#F2F2F2', 5.1), fromTD('Preto', '#161616', 0.3), fromTD('Cinza', '#9FA4A7', 0.7),
    fromTD('Vermelho', '#D03036', 3.3), fromTD('Amarelo', '#EFD006', 7.6), fromTD('Azul', '#0682AC', 6.6),
    fromTD('Verde', '#70A640', 3.0), fromTD('Laranja', '#FE6E31', 6.6), fromTD('Bege', '#D9D4C4', 7.1), fromTD('Marrom', '#482E31', 1.8)
  ];

  /* ---------- escadinha de calibração ---------- */
  // espessuras de cada degrau (camada inicial 0,16 + passos de 0,08): uma janela vazada antes do primeiro
  var DEGRAUS = [0.16, 0.24, 0.32, 0.40, 0.48, 0.64, 0.80, 1.04, 1.36, 1.76, 2.24, 2.80];
  var ESC = { cell: 9, sep: 1.6, frame: 3, h: 14, top: 3.2 };
  // ajusta T(t) = a·e^(-k t) por canal. pts: [{t, v:[r,g,b] linear}], ref: [r,g,b] linear da janela vazada
  function fitLight(pts, ref) {
    var k = [], a = [], r2 = [], usados = [];
    for (var ch = 0; ch < 3; ch++) {
      var xs = [], ys = [];
      pts.forEach(function (p) { var T = p.v[ch] / Math.max(1e-6, ref[ch]); if (T > 0.004 && T < 0.98) { xs.push(p.t); ys.push(Math.log(T)); } });
      usados.push(xs.length);
      if (xs.length < 3) { k.push(NaN); a.push(NaN); r2.push(0); continue; }
      var n = xs.length, mx = xs.reduce(function (s, x) { return s + x; }, 0) / n, my = ys.reduce(function (s, y) { return s + y; }, 0) / n, sxy = 0, sxx = 0, syy = 0;
      for (var j = 0; j < n; j++) { sxy += (xs[j] - mx) * (ys[j] - my); sxx += (xs[j] - mx) * (xs[j] - mx); syy += (ys[j] - my) * (ys[j] - my); }
      var slope = sxy / sxx, icpt = my - slope * mx;
      k.push(-slope); a.push(Math.min(1, Math.exp(icpt))); r2.push(syy ? (sxy * sxy) / (sxx * syy) : 0);
    }
    return { k: k, a: a, r2: r2, usados: usados };
  }
  // amostra a foto ao longo da linha entre o centro da janela (p0) e o centro do último degrau (p1)
  // img: {w,h,data RGBA}; devolve as médias lineares de cada célula (robusta: mediana do miolo)
  function sampleWedge(img, p0, p1, nCells) {
    var dx = (p1[0] - p0[0]) / (nCells - 1), dy = (p1[1] - p0[1]) / (nCells - 1), step = Math.hypot(dx, dy), nx = -dy / step, ny = dx / step;
    var out = [], sat = false;
    for (var c = 0; c < nCells; c++) {
      var cx = p0[0] + dx * c, cy = p0[1] + dy * c, vals = [[], [], []], half = step * 0.28;
      for (var u = -half; u <= half; u += Math.max(1, half / 8)) for (var v = -half; v <= half; v += Math.max(1, half / 8)) {
        var x = Math.round(cx + dx / step * u + nx * v), y = Math.round(cy + dy / step * u + ny * v);
        if (x < 0 || y < 0 || x >= img.w || y >= img.h) continue;
        var o = (y * img.w + x) * 4;
        for (var ch = 0; ch < 3; ch++) { vals[ch].push(img.data[o + ch]); if (c === 0 && img.data[o + ch] >= 250) sat = true; }
      }
      out.push(vals.map(function (arr) { arr.sort(function (p, q) { return p - q; }); var m = arr.length ? arr[arr.length >> 1] : 0; return S2L[m]; }));
    }
    return { cells: out, saturada: sat };
  }
  function analyzeWedge(img, p0, p1) {
    var s = sampleWedge(img, p0, p1, DEGRAUS.length + 1), ref = s.cells[0];
    var pts = DEGRAUS.map(function (t, i) { return { t: t, v: s.cells[i + 1] }; });
    var fit = fitLight(pts, ref), avisos = [];
    if (s.saturada) avisos.push('A janela vazada ficou estourada (branco puro). Toque na tela do celular sobre a janela para baixar a exposição e tire de novo.');
    var lum = pts.map(function (p) { return p.v[0] + p.v[1] + p.v[2]; }), quedas = 0;
    for (var i = 1; i < lum.length; i++) if (lum[i] > lum[i - 1] * 1.08) quedas++;
    if (quedas > 2) avisos.push('Os degraus não ficaram do mais claro para o mais escuro. Confira se tocou primeiro na janela vazada e depois no degrau mais grosso.');
    if (fit.r2.some(function (r) { return r < 0.9; })) avisos.push('A medida ficou irregular (luz desigual atrás da peça?). Use uma luz espalhada: tela branca do PC ou do celular no máximo.');
    return { fit: fit, ref: ref, pts: pts, avisos: avisos };
  }

  /* medida 2 (opcional): a mesma escadinha de frente, deitada sobre papel preto, com luz de cima.
     Refletância R(t) = R∞ · (1 - e^(-β·k·t)): a janela vazada mostra o preto (R = 0) e o degrau mais grosso o R∞.
     Com o k da medida contra a luz, sai o β real do filamento (quanto a luz refletida "enxerga" para dentro). */
  function analyzeFront(img, p0, p1, k) {
    var s = sampleWedge(img, p0, p1, DEGRAUS.length + 1), blk = s.cells[0], full = s.cells[DEGRAUS.length], betas = [];
    for (var ch = 0; ch < 3; ch++) {
      var span = full[ch] - blk[ch]; if (span < 0.02 || !(k[ch] > 0)) continue;
      DEGRAUS.forEach(function (t, i) {
        var f = (s.cells[i + 1][ch] - blk[ch]) / span; // = 1 - e^(-β k t)
        if (f > 0.08 && f < 0.92) betas.push(-Math.log(1 - f) / (k[ch] * t));
      });
    }
    betas.sort(function (a, b) { return a - b; });
    return { beta: betas.length ? betas[betas.length >> 1] : NaN, pontos: betas.length, cor: linToHex(full) };
  }
  // correção de foto escura ou amarelada: balanço de branco (mundo cinza, limitado) e esticar o brilho entre os percentis 0,5% e 99,5%
  function autoFix(data, n) {
    var sum = [0, 0, 0], cnt = 0, Y = new Float32Array(n);
    for (var p = 0; p < n; p++) { var r = S2L[data[p * 4]], g = S2L[data[p * 4 + 1]], b = S2L[data[p * 4 + 2]], y = 0.2126 * r + 0.7152 * g + 0.0722 * b; Y[p] = y; if (y > 0.01 && y < 0.9) { sum[0] += r; sum[1] += g; sum[2] += b; cnt++; } }
    var m = (sum[0] + sum[1] + sum[2]) / 3, gain = sum.map(function (x) { return cnt && x > 0 ? Math.max(0.75, Math.min(1.33, m / x)) : 1; });
    var srt = Array.from(Y).sort(function (a, b) { return a - b; }), lo = srt[Math.floor(n * 0.005)], hi = srt[Math.floor(n * 0.995)];
    var sc = 0.9 / Math.max(0.02, hi - lo), out = new Uint8ClampedArray(data.length);
    for (p = 0; p < n; p++) {
      for (var ch = 0; ch < 3; ch++) out[p * 4 + ch] = l2s(Math.max(0, (S2L[data[p * 4 + ch]] * gain[ch] - lo) * sc));
      out[p * 4 + 3] = 255;
    }
    return { data: out, ganho: gain, preto: lo, branco: hi };
  }
  /* ---------- Foto em cores: aparência de uma pilha de camadas ----------
     sched: { fil: [filamento...], starts: [índice da 1ª camada de cada filamento], N, h0, lh }
     camada i (1..N) tem espessura h0 (i=1) ou lh. Devolve a cor (RGB linear) vista de frente para cada altura n=1..N */
  function stackPalette(fils, starts, N, h0, lh, beta) {
    var pal = new Float32Array((N + 1) * 3), c = [0, 0, 0], fi = 0; // fundo preto (nada atrás)
    for (var n = 1; n <= N; n++) {
      while (fi + 1 < starts.length && n >= starts[fi + 1]) fi++;
      var f = fils[fi], t = n === 1 ? h0 : lh, C = f.lin || (f.lin = hexToLin(f.hex));
      var be = f.beta > 0 ? f.beta : beta; // β medido do próprio filamento, quando existe
      for (var ch = 0; ch < 3; ch++) { var al = 1 - Math.exp(-be * f.k[ch] * t); c[ch] = al * C[ch] + (1 - al) * c[ch]; }
      pal[n * 3] = c[0]; pal[n * 3 + 1] = c[1]; pal[n * 3 + 2] = c[2];
    }
    return pal;
  }
  function palLab(pal, N) { var L = new Float32Array((N + 1) * 3), t = [0, 0, 0]; for (var n = 1; n <= N; n++) { lab(pal[n * 3], pal[n * 3 + 1], pal[n * 3 + 2], t); L[n * 3] = t[0]; L[n * 3 + 1] = t[1]; L[n * 3 + 2] = t[2]; } return L; }

  // k-médias em Lab para resumir a foto em até K cores com peso (deixa o otimizador rápido)
  function clusters(labArr, n, K) {
    K = Math.min(K, n);
    var C = new Float32Array(K * 3), step = n / K;
    for (var k = 0; k < K; k++) { var s = Math.floor(k * step) * 3; C[k * 3] = labArr[s]; C[k * 3 + 1] = labArr[s + 1]; C[k * 3 + 2] = labArr[s + 2]; }
    var asg = new Int32Array(n), W = new Float32Array(K);
    for (var it = 0; it < 8; it++) {
      var acc = new Float64Array(K * 4);
      for (var p = 0; p < n; p++) {
        var L = labArr[p * 3], A = labArr[p * 3 + 1], B = labArr[p * 3 + 2], bi = 0, bd = 1e18;
        for (k = 0; k < K; k++) { var d0 = L - C[k * 3], d1 = A - C[k * 3 + 1], d2 = B - C[k * 3 + 2], d = d0 * d0 + d1 * d1 + d2 * d2; if (d < bd) { bd = d; bi = k; } }
        asg[p] = bi; acc[bi * 4] += L; acc[bi * 4 + 1] += A; acc[bi * 4 + 2] += B; acc[bi * 4 + 3]++;
      }
      for (k = 0; k < K; k++) if (acc[k * 4 + 3]) { C[k * 3] = acc[k * 4] / acc[k * 4 + 3]; C[k * 3 + 1] = acc[k * 4 + 1] / acc[k * 4 + 3]; C[k * 3 + 2] = acc[k * 4 + 2] / acc[k * 4 + 3]; }
    }
    for (p = 0; p < n; p++) W[asg[p]]++;
    return { C: C, W: W, K: K };
  }
  // erro de uma escala de cores: cada cor da foto usa a altura (>= nb) mais parecida.
  // fast = distância Lab simples (ΔE76, para procurar rápido); senão ΔE2000 (para decidir e para mostrar)
  function scheduleError(cl, PL, nb, N, fast) {
    var tot = 0, wsum = 0;
    for (var k = 0; k < cl.K; k++) {
      if (!cl.W[k]) continue;
      var L = cl.C[k * 3], A = cl.C[k * 3 + 1], B = cl.C[k * 3 + 2], best = 1e18;
      for (var n = nb; n <= N; n++) {
        var e;
        if (fast) { var d0 = L - PL[n * 3], d1 = A - PL[n * 3 + 1], d2 = B - PL[n * 3 + 2]; e = d0 * d0 + d1 * d1 + d2 * d2; }
        else e = de2000(L, A, B, PL[n * 3], PL[n * 3 + 1], PL[n * 3 + 2]);
        if (e < best) best = e;
      }
      tot += (fast ? Math.sqrt(best) : best) * cl.W[k]; wsum += cl.W[k];
    }
    return tot / wsum;
  }
  function permutations(arr, m) {
    var out = [];
    (function rec(pre, rest) { if (pre.length === m) { out.push(pre); return; } rest.forEach(function (x, i) { rec(pre.concat([x]), rest.slice(0, i).concat(rest.slice(i + 1))); }); })([], arr);
    return out;
  }
  /* procura a ordem dos filamentos e as alturas de troca com menor ΔE2000 médio, para cada quantidade de filamentos.
     1) busca local em todas as ordens com ΔE76 (rápido); 2) os 3 melhores de cada quantidade são refinados e decididos com ΔE2000.
     o: { fils, N, nb, h0, lh, beta, maxFil, cl (resumo p/ ΔE2000), clFast (resumo menor p/ busca), progress } */
  function optimize(o) {
    var N = o.N, nb = o.nb, res = [], evals = 0, idx = o.fils.map(function (f, i) { return i; }), minGap = 2;
    var clF = o.clFast || o.cl, M = Math.min(o.maxFil, o.fils.length);
    function search(fils, st, fast, guard) {
      function cost(x) { evals++; var pal = stackPalette(fils, [1].concat(x), N, o.h0, o.lh, o.beta); return scheduleError(fast ? clF : o.cl, palLab(pal, N), nb, N, fast); }
      var cur = cost(st), improved = true, g = 0;
      while (improved && g++ < guard) {
        improved = false;
        for (var q = 0; q < st.length; q++) [-4, -2, -1, 1, 2, 4].forEach(function (d) {
          var s2 = st.slice(); s2[q] += d;
          var lo = q ? s2[q - 1] + minGap : nb + 1, hi = q < s2.length - 1 ? s2[q + 1] - minGap : N - minGap + 1;
          if (s2[q] < lo || s2[q] > hi) return;
          var e = cost(s2); if (e < cur - 1e-4) { cur = e; st = s2; improved = true; }
        });
      }
      return { err: cur, st: st };
    }
    for (var m = 1; m <= M; m++) {
      var cands = [];
      permutations(idx, m).forEach(function (perm) {
        var fils = perm.map(function (i) { return o.fils[i]; }), inits = [[], []];
        for (var j = 1; j < m; j++) { inits[0].push(Math.round(nb + 1 + (N - nb - 1) * j / m)); inits[1].push(Math.round(nb + 1 + (N - nb - 1) * j / (m + 1))); }
        (m === 1 ? [[]] : inits).forEach(function (st) { var r = search(fils, st, true, 60); cands.push({ err: r.err, perm: perm, st: r.st }); });
      });
      cands.sort(function (p, q) { return p.err - q.err; });
      var best = null, seen = {};
      cands.filter(function (c) { var k = c.perm.join(',') + '|' + c.st.join(','); if (seen[k]) return false; seen[k] = 1; return true; }).slice(0, 3).forEach(function (c) {
        var fils = c.perm.map(function (i) { return o.fils[i]; }), r = search(fils, c.st.slice(), false, m === 1 ? 0 : 8);
        if (!best || r.err < best.err) best = { err: r.err, perm: c.perm, starts: [1].concat(r.st) };
      });
      if (best) res.push({ nFil: m, err: best.err, fils: best.perm.map(function (i) { return o.fils[i]; }), starts: best.starts });
      if (o.progress) o.progress(m / M);
    }
    return { opcoes: res, evals: evals };
  }
  // altura (n) de cada pixel e estatísticas de erro reais (ΔE2000 pixel a pixel, depois da suavização)
  function assignHeights(img, w, h, PL, nb, N, smooth) {
    var nmap = new Uint8Array(w * h), cache = new Map(), t = [0, 0, 0];
    for (var p = 0; p < w * h; p++) {
      var r = img[p * 4], g = img[p * 4 + 1], b = img[p * 4 + 2], key = (r >> 2) << 12 | (g >> 2) << 6 | (b >> 2), v = cache.get(key);
      if (v === undefined) {
        lab(S2L[r], S2L[g], S2L[b], t); var best = 1e9; v = nb;
        for (var n = nb; n <= N; n++) { var e = de2000(t[0], t[1], t[2], PL[n * 3], PL[n * 3 + 1], PL[n * 3 + 2]); if (e < best) { best = e; v = n; } }
        cache.set(key, v);
      }
      nmap[p] = v;
    }
    for (var s = 0; s < (smooth || 0); s++) nmap = median3(nmap, w, h);
    return nmap;
  }
  function median3(m, w, h) {
    var o = new Uint8Array(m.length), a = new Array(9);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var k = 0; for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) { var xx = Math.min(w - 1, Math.max(0, x + dx)), yy = Math.min(h - 1, Math.max(0, y + dy)); a[k++] = m[yy * w + xx]; }
      a.sort(function (p, q) { return p - q; }); o[y * w + x] = a[4];
    }
    return o;
  }
  function errorStats(img, w, h, nmap, PL) {
    var errs = new Float32Array(w * h), t = [0, 0, 0], cache = new Map();
    for (var p = 0; p < w * h; p++) {
      var n = nmap[p], r = img[p * 4], g = img[p * 4 + 1], b = img[p * 4 + 2], key = ((r >> 2) << 12 | (g >> 2) << 6 | (b >> 2)) * 64 + n, e = cache.get(key);
      if (e === undefined) { lab(S2L[r], S2L[g], S2L[b], t); e = de2000(t[0], t[1], t[2], PL[n * 3], PL[n * 3 + 1], PL[n * 3 + 2]); cache.set(key, e); }
      errs[p] = e;
    }
    var sorted = Array.from(errs).sort(function (p, q) { return p - q; }), sum = 0; for (p = 0; p < sorted.length; p++) sum += sorted[p];
    var pct = function (q) { return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]; };
    var ate = function (lim) { var c = 0; for (var i = 0; i < sorted.length; i++) if (sorted[i] <= lim) c++; return c / sorted.length; };
    return { media: sum / sorted.length, mediana: pct(0.5), p95: pct(0.95), ate3: ate(3), acima10: 1 - ate(10), errs: errs };
  }

  /* ---------- Litofania: espessura de cada pixel ----------
     lum: luminância linear (0..1). O branco da foto (percentil 99%) vira a parte mais fina.
     Ajuste de tom com "joelho": nos tons médios e claros a peça reproduz a luminosidade (L*) exata da foto;
     só as sombras mais escuras que a peça consegue mostrar são comprimidas, sem perder a ordem dos tons.
     Testado contra mapeamento log, linear em sRGB (o do 3dp.rocks) e corte puro: menor erro de tom (ΔL*) nas 3 fotos de teste. */
  function Lof(y) { return 116 * labf(y) - 16; }
  function Yof(L) { var f = (L + 16) / 116; return f > 0.206893 ? f * f * f : (f - 16 / 116) / 7.787; }
  function lithoThickness(lum, tmin, tmax, k) {
    var n = lum.length, s = Array.from(lum).sort(function (p, q) { return p - q; }), Yw = Math.max(1e-4, s[Math.floor(n * 0.99)]);
    var Lmin = Lof(Math.exp(-k * (tmax - tmin))), Lk = Math.min(95, Lmin + 10), out = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var L = Lof(Math.min(1, lum[i] / Yw)), L2 = L >= Lk ? L : Lmin + (Lk - Lmin) * L / Lk;
      out[i] = Math.max(tmin, Math.min(tmax, tmin - Math.log(Math.max(1e-6, Yof(L2))) / k));
    }
    return { t: out, Yw: Yw, Lmin: Lmin, contraste: Math.exp(k * (tmax - tmin)) };
  }
  // brilho previsto com luz por trás (RGB linear relativo à luz)
  function lithoPreview(t, fil) { var n = t.length, out = new Float32Array(n * 3); for (var i = 0; i < n; i++) for (var ch = 0; ch < 3; ch++) out[i * 3 + ch] = fil.a[ch] * Math.exp(-fil.k[ch] * t[i]); return out; }

  /* ---------- malhas ----------
     sólido de grade: duas superfícies (fora e dentro) com nu × nv pontos, fechadas nas bordas.
     P(i,j) devolve [x,y,z] da superfície externa, Q(i,j) da interna. closedU: emenda i = nu-1 com i = 0 (cilindro, esfera) */
  function orient(out, from) { // vira os triângulos se a casca saiu do avesso
    var v = 0;
    for (var i = from; i < out.length; i += 9) v += (out[i] * (out[i + 4] * out[i + 8] - out[i + 5] * out[i + 7]) - out[i + 1] * (out[i + 3] * out[i + 8] - out[i + 5] * out[i + 6]) + out[i + 2] * (out[i + 3] * out[i + 7] - out[i + 4] * out[i + 6]));
    if (v < 0) for (i = from; i < out.length; i += 9) for (var c = 0; c < 3; c++) { var x = out[i + 3 + c]; out[i + 3 + c] = out[i + 6 + c]; out[i + 6 + c] = x; }
  }
  function gridSolid(nu, nv, P, Q, closedU, out) {
    out = out || []; var from = out.length;
    var A = [], B = [];
    for (var j = 0; j < nv; j++) for (var i = 0; i < nu; i++) { A.push(P(i, j)); B.push(Q(i, j)); }
    var id = function (i, j) { return j * nu + (i % nu); };
    function tri(p, q, r) {
      if ((p[0] === q[0] && p[1] === q[1] && p[2] === q[2]) || (q[0] === r[0] && q[1] === r[1] && q[2] === r[2]) || (p[0] === r[0] && p[1] === r[1] && p[2] === r[2])) return;
      out.push(p[0], p[1], p[2], q[0], q[1], q[2], r[0], r[1], r[2]);
    }
    var iu = closedU ? nu : nu - 1;
    for (j = 0; j < nv - 1; j++) for (i = 0; i < iu; i++) {
      var a = id(i, j), b = id(i + 1, j), c = id(i + 1, j + 1), d = id(i, j + 1);
      tri(A[a], A[b], A[c]); tri(A[a], A[c], A[d]);     // fora
      tri(B[a], B[c], B[b]); tri(B[a], B[d], B[c]);     // dentro (sentido invertido)
    }
    for (i = 0; i < iu; i++) { // bordas de baixo (j=0) e de cima (j=nv-1)
      var a0 = id(i, 0), b0 = id(i + 1, 0); tri(A[a0], B[b0], A[b0]); tri(A[a0], B[a0], B[b0]);
      var a1 = id(i, nv - 1), b1 = id(i + 1, nv - 1); tri(A[a1], A[b1], B[b1]); tri(A[a1], B[b1], B[a1]);
    }
    if (!closedU) for (j = 0; j < nv - 1; j++) { // laterais (i=0 e i=nu-1)
      var l0 = id(0, j), l1 = id(0, j + 1); tri(A[l0], A[l1], B[l1]); tri(A[l0], B[l1], B[l0]);
      var r0 = id(nu - 1, j), r1 = id(nu - 1, j + 1); tri(A[r0], B[r1], A[r1]); tri(A[r0], B[r0], B[r1]);
    }
    orient(out, from);
    return out;
  }
  // amostra bilinear de um mapa (w × h) em coordenadas 0..1
  function bil(map, w, h, u, v) {
    var x = Math.max(0, Math.min(w - 1, u * (w - 1))), y = Math.max(0, Math.min(h - 1, v * (h - 1))), x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1), fx = x - x0, fy = y - y0;
    return (map[y0 * w + x0] * (1 - fx) + map[y0 * w + x1] * fx) * (1 - fy) + (map[y1 * w + x0] * (1 - fx) + map[y1 * w + x1] * fx) * fy;
  }
  /* litofania: forma 'plana' | 'curva' | 'cilindro' | 'lua'
     t: espessura (w × h, linha 0 = topo da imagem). W, H em mm. Peças em pé (imprimem na vertical, melhor detalhe). */
  function lithoMesh(o) {
    var t = o.t, w = o.w, h = o.h, W = o.W, H = o.H, res = o.res || 0.4, out = [], tmax = o.tmax, border = o.border || 0;
    var nu = Math.max(8, Math.round(W / res) + 1), nv = Math.max(8, Math.round(H / res) + 1);
    var thick = function (u, v) { // com moldura: borda grossa ajuda a firmar e esconde a emenda
      if (border && (u * W < border || (1 - u) * W < border || v * H < border || (1 - v) * H < border)) return tmax;
      return bil(t, w, h, u, v);
    };
    if (o.forma === 'plana') {
      // imagem no plano XZ (em pé), espessura para +Y (relevo atrás, frente lisa)
      gridSolid(nu, nv, function (i, j) { return [i / (nu - 1) * W, 0, (1 - j / (nv - 1)) * H]; },
        function (i, j) { var u = i / (nu - 1), v = j / (nv - 1); return [u * W, thick(u, v), (1 - v) * H]; }, false, out);
      if (o.pe) addFoot(out, W, tmax, o.pe);
    } else if (o.forma === 'curva' || o.forma === 'cilindro') {
      var full = o.forma === 'cilindro', ang = full ? Math.PI * 2 : (o.angulo || 120) * Math.PI / 180, R = W / ang;
      var nuC = full ? nu - 1 : nu;
      gridSolid(nuC, nv, function (i, j) { var a = (full ? i / nuC : i / (nuC - 1)) * ang - (full ? 0 : ang / 2); return [R * Math.sin(a), -R * Math.cos(a), (1 - j / (nv - 1)) * H]; },
        function (i, j) { var u = full ? i / nuC : i / (nuC - 1), v = j / (nv - 1), a = u * ang - (full ? 0 : ang / 2), r = R - thick(u, v); return [r * Math.sin(a), -r * Math.cos(a), (1 - v) * H]; }, full, out);
      if (full && o.base) addRing(out, R, o.base);
    } else if (o.forma === 'lua') {
      // esfera de diâmetro W com furo embaixo (diâmetro o.furo) para o LED; relevo para fora
      var Rin = W / 2 - tmax, furo = Math.min(W * 0.6, o.furo || 30), thMin = Math.asin(Math.min(0.95, furo / 2 / (Rin + tmax))); // ângulo do furo a partir do polo sul
      var nlat = Math.max(16, Math.round(Math.PI * W / 2 / res)), nlon = Math.max(32, Math.round(Math.PI * W / res));
      var z0 = (Rin + tmax) * Math.cos(thMin), ro0 = (Rin + tmax) * Math.sin(thMin);
      gridSolid(nlon, nlat, function (i, j) {
        var lon = i / nlon * 2 * Math.PI, th = thMin + (Math.PI - thMin) * j / (nlat - 1), u = i / nlon, v = 1 - (th / Math.PI), r = Rin + thick(u, v);
        if (j === 0) return [ro0 * Math.cos(lon), ro0 * Math.sin(lon), 0];
        if (j === nlat - 1) return [0, 0, z0 + Rin + thick(0.5, 0)];
        return [r * Math.sin(th) * Math.cos(lon), r * Math.sin(th) * Math.sin(lon), z0 - r * Math.cos(th)];
      }, function (i, j) {
        var lon = i / nlon * 2 * Math.PI, th = thMin + (Math.PI - thMin) * j / (nlat - 1);
        if (j === 0) return [(ro0 - 3) * Math.cos(lon), (ro0 - 3) * Math.sin(lon), 0];
        if (j === nlat - 1) return [0, 0, z0 + Rin];
        return [Rin * Math.sin(th) * Math.cos(lon), Rin * Math.sin(th) * Math.sin(lon), z0 - Rin * Math.cos(th)];
      }, true, out);
    }
    return new Float32Array(out);
  }
  function box(out, x0, y0, z0, x1, y1, z1) {
    var p = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
    [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]].forEach(function (f) { f.forEach(function (k) { out.push(p[k][0], p[k][1], p[k][2]); }); });
  }
  // pé para a litofania plana ficar em pé: dois blocos que abraçam a placa (peças separadas do mesmo objeto)
  function addFoot(out, W, tmax, d) { var from = out.length; box(out, -2, -d, -4, W + 2, tmax + d, 0); orient(out, from); }
  function addRing(out, R, h) { // anel de apoio embaixo do cilindro
    var n = 96, o2 = [];
    gridSolid(n, 2, function (i, j) { var a = i / n * 2 * Math.PI, r = R + 2; return [r * Math.sin(a), -r * Math.cos(a), -j * h]; },
      function (i, j) { var a = i / n * 2 * Math.PI, r = R - 6; return [r * Math.sin(a), -r * Math.cos(a), -j * h]; }, true, o2);
    for (var i = 0; i < o2.length; i++) out.push(o2[i]);
  }
  // casca a casca, para checar se a malha fechou

  var API = { S2L: S2L, l2s: l2s, hexToLin: hexToLin, linToHex: linToHex, lab: lab, de2000: de2000, fromTD: fromTD, tdOf: tdOf, PADRAO: PADRAO, LITO_PADRAO: LITO_PADRAO, DEGRAUS: DEGRAUS, ESC: ESC,
    fitLight: fitLight, sampleWedge: sampleWedge, analyzeWedge: analyzeWedge, analyzeFront: analyzeFront, autoFix: autoFix, stackPalette: stackPalette, palLab: palLab, clusters: clusters, scheduleError: scheduleError, optimize: optimize,
    assignHeights: assignHeights, median3: median3, errorStats: errorStats, lithoThickness: lithoThickness, Lof: Lof, Yof: Yof, lithoPreview: lithoPreview, lithoMesh: lithoMesh, gridSolid: gridSolid, bil: bil, orient: orient };
  root.BI3D_LUZ = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof self !== 'undefined' ? self : this);
