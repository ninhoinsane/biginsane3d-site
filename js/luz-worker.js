/* Big Insane 3D · Luz e cor · trabalho pesado em segundo plano (a página não trava) */
importScripts('earcut.min.js?v=224', 'oficina-core.js?v=20261016e', 'luz-core.js?v=20261016e');
var LZ = self.BI3D_LUZ, OF = self.BI3D_OF, cache = null;
function step(t, p) { self.postMessage({ type: 'progress', text: t, p: p }); }
function now() { return performance.now(); }

/* ---------- Foto em cores ---------- */
function prepFoto(d) {
  var t0 = now(), img = d.img, w = img.w, h = img.h, px = d.W / w, fix = null;
  if (d.autoFix) { fix = LZ.autoFix(img.data, w * h); img = { w: w, h: h, data: fix.data }; }
  var N = Math.round((d.Hmax - d.h0) / d.lh) + 1, nb = Math.max(1, 1 + Math.round((d.base - d.h0) / d.lh));
  var zTop = [0]; for (var n = 1; n <= N; n++) zTop.push(+(d.h0 + (n - 1) * d.lh).toFixed(4));
  // amostra para o otimizador (até ~40 mil pixels) e resume em 256 cores
  step('Lendo as cores da foto…', 0.05);
  var stride = Math.max(1, Math.round(Math.sqrt(w * h / 20000))), labs = [], tmp = [0, 0, 0];
  for (var y = 0; y < h; y += stride) for (var x = 0; x < w; x += stride) { var o = (y * w + x) * 4; LZ.lab(LZ.S2L[img.data[o]], LZ.S2L[img.data[o + 1]], LZ.S2L[img.data[o + 2]], tmp); labs.push(tmp[0], tmp[1], tmp[2]); }
  var la = new Float32Array(labs), cl = LZ.clusters(la, la.length / 3, 160), clFast = LZ.clusters(la, la.length / 3, 64);
  var tCl = now() - t0;
  step('Testando a ordem das cores e as alturas de troca…', 0.15);
  var t1 = now();
  var opt = LZ.optimize({ fils: d.fils, N: N, nb: nb, h0: d.h0, lh: d.lh, beta: d.beta, maxFil: d.maxFil, cl: cl, clFast: clFast, progress: function (f) { step('Testando a ordem das cores e as alturas de troca…', 0.15 + 0.55 * f); } });
  var best = Math.min.apply(null, opt.opcoes.map(function (o) { return o.err; }));
  var rec = 0; for (var i = 0; i < opt.opcoes.length; i++) if (opt.opcoes[i].err <= best + 1.0) { rec = i; break; }
  cache = { d: d, img: img, w: w, h: h, px: px, N: N, nb: nb, zTop: zTop, opt: opt };
  return { opcoes: opt.opcoes.map(function (o) { return { nFil: o.nFil, err: o.err, fils: o.fils.map(function (f) { return f.nome; }), hex: o.fils.map(function (f) { return f.hex; }), starts: o.starts }; }),
    rec: rec, evals: opt.evals, N: N, nb: nb, alvo: fix ? fix.data : null, fix: fix ? { ganho: fix.ganho, preto: fix.preto, branco: fix.branco } : null, tempos: { cores: tCl, otimizador: now() - t1 } };
}
function buildFoto(idx) {
  var c = cache, d = c.d, o = c.opt.opcoes[idx], t0 = now();
  step('Calculando a altura de cada ponto…', 0.72);
  var pal = LZ.stackPalette(o.fils, o.starts, c.N, d.h0, d.lh, d.beta), PL = LZ.palLab(pal, c.N);
  var nmap = LZ.assignHeights(c.img.data, c.w, c.h, PL, c.nb, c.N, d.smooth);
  var st = LZ.errorStats(c.img.data, c.w, c.h, nmap, PL);
  var tA = now() - t0;
  // prévia simulada e mapa de erro (RGBA)
  var prev = new Uint8ClampedArray(c.w * c.h * 4), heat = new Uint8ClampedArray(c.w * c.h * 4);
  for (var p = 0; p < c.w * c.h; p++) {
    var n = nmap[p]; prev[p * 4] = LZ.l2s(pal[n * 3]); prev[p * 4 + 1] = LZ.l2s(pal[n * 3 + 1]); prev[p * 4 + 2] = LZ.l2s(pal[n * 3 + 2]); prev[p * 4 + 3] = 255;
    var e = Math.min(1, st.errs[p] / 15); heat[p * 4] = Math.round(255 * Math.min(1, e * 2)); heat[p * 4 + 1] = Math.round(255 * Math.min(1, 2 - e * 2)); heat[p * 4 + 2] = 40; heat[p * 4 + 3] = 255;
  }
  step('Montando a peça em degraus de camada…', 0.82);
  var t1 = now(), tri = terraces(nmap, c.w, c.h, c.px, c.zTop, c.nb, c.N), tM = now() - t1;
  // volume real (100% de preenchimento) e trocas
  var vol = 0; for (p = 0; p < c.w * c.h; p++) vol += c.zTop[Math.max(nmap[p], c.nb)];
  vol *= c.px * c.px;
  var changes = o.starts.slice(1).map(function (s, i) { return { z: c.zTop[s], camada: s, fil: i + 1, nome: o.fils[i + 1].nome, hex: o.fils[i + 1].hex }; });
  var maxN = 0; for (p = 0; p < nmap.length; p++) if (nmap[p] > maxN) maxN = nmap[p];
  // prévia 3D: triângulos separados por faixa de cor (altura ×3 só para ver os degraus), feito aqui para a página não travar
  var bands = o.starts.slice(1).map(function (s) { return c.zTop[s]; }), cnt = o.fils.map(function () { return 0; }), bandOf = new Uint8Array(tri.length / 9);
  for (var f = 0; f < tri.length; f += 9) { var zc = Math.max(tri[f + 2], tri[f + 5], tri[f + 8]) - 0.001, k = 0; while (k < bands.length && zc >= bands[k]) k++; bandOf[f / 9] = k; cnt[k]++; }
  var view = cnt.map(function (n) { return new Float32Array(n * 9); }), pos = cnt.map(function () { return 0; });
  for (f = 0; f < tri.length; f += 9) { var b = bandOf[f / 9], V = view[b], q = pos[b]; for (var j = 0; j < 9; j++) V[q + j] = (j % 3 === 2) ? tri[f + j] * 3 : tri[f + j]; pos[b] = q + 9; }
  return { tri: tri, view: view, preview: prev, heat: heat, stats: { media: st.media, mediana: st.mediana, p95: st.p95, ate3: st.ate3, acima10: st.acima10 }, vol: vol, changes: changes,
    fils: o.fils.map(function (f) { return { nome: f.nome, hex: f.hex }; }), altura: c.zTop[maxN], camadas: maxN, w: c.w, h: c.h, tempos: { alturas: tA, malha: tM } };
}
// degraus: cada camada vira uma fatia exata (o fatiador corta no meio da camada, então não sobra arredondamento)
function terraces(nmap, w, h, px, zTop, nb, N) {
  var out = [], W = w * px, H = h * px;
  OF.extrude([{ outer: [[0, 0], [W, 0], [W, H], [0, H]], holes: [] }], 0, zTop[nb], out);
  var mask = new Float32Array(w * h), blur = new Float32Array(w * h), minA = Math.max(0.15, 3 * px * px);
  for (var n = nb + 1; n <= N; n++) {
    var any = false;
    for (var p = 0; p < w * h; p++) { mask[p] = nmap[p] >= n ? 1 : 0; if (mask[p]) any = true; }
    if (!any) break;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) { // borrão 3x3: contorno suave e sempre dentro do degrau de baixo
      var s = 0, k = 0; for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) { var xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < w && yy < h) { s += mask[yy * w + xx]; k++; } }
      blur[y * w + x] = s / k;
    }
    var d = new Float32Array(w * h); for (p = 0; p < w * h; p++) d[p] = (blur[p] - 0.5) * px;
    var F = new OF.Field(w, h, px, px / 2, H - px / 2, d);
    var polys = OF.polygons(F, px * 0.45).filter(function (pg) { return Math.abs(area(pg.outer)) >= minA; });
    polys.forEach(function (pg) { pg.holes = pg.holes.filter(function (r) { return Math.abs(area(r)) >= minA; }); });
    OF.extrude(polys, zTop[n - 1], zTop[n], out);
    if ((n - nb) % 4 === 0) step('Montando a peça em degraus de camada… ' + Math.round((n - nb) / (N - nb) * 100) + '%', 0.82 + 0.15 * (n - nb) / (N - nb));
  }
  return new Float32Array(out);
}
function area(r) { var s = 0; for (var i = 0, n = r.length; i < n; i++) { var a = r[i], b = r[(i + 1) % n]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; }

/* ---------- Litofania ---------- */
function buildLito(d) {
  var t0 = now();
  step('Convertendo brilho em espessura…', 0.1);
  var th = LZ.lithoThickness(d.lum, d.tmin, d.tmax, (d.fil.k[0] + d.fil.k[1] + d.fil.k[2]) / 3);
  var prev = LZ.lithoPreview(th.t, d.fil), n = d.w * d.h, img = new Uint8ClampedArray(n * 4);
  // normaliza a prévia pelo ponto mais claro possível (espessura mínima), como o olho se acostuma à luz
  var white = [0, 1, 2].map(function (ch) { return d.fil.a[ch] * Math.exp(-d.fil.k[ch] * d.tmin); });
  var dL = 0, cnt = 0;
  for (var p = 0; p < n; p++) {
    for (var ch = 0; ch < 3; ch++) img[p * 4 + ch] = LZ.l2s(prev[p * 3 + ch] / white[ch]);
    img[p * 4 + 3] = 255;
    // erro de tom: luminosidade (L*) prevista com luz por trás × a da foto, as duas pelo próprio branco
    if (p % 5 === 0) {
      var q = prev[p * 3] / white[0] * 0.2126 + prev[p * 3 + 1] / white[1] * 0.7152 + prev[p * 3 + 2] / white[2] * 0.0722;
      dL += Math.abs(LZ.Lof(Math.min(1, q)) - LZ.Lof(Math.min(1, d.lum[p] / th.Yw))); cnt++;
    }
  }
  step('Montando a malha…', 0.4);
  var t1 = now();
  var tri = LZ.lithoMesh({ t: th.t, w: d.w, h: d.h, W: d.W, H: d.H, tmax: d.tmax, forma: d.forma, pe: d.pe, base: d.base, border: d.border, res: d.res, furo: d.furo, angulo: d.angulo });
  var tM = now() - t1, vol = OF.volume(tri);
  return { tri: tri, preview: img, w: d.w, h: d.h, vol: vol, contraste: th.contraste, dL: dL / Math.max(1, cnt), tempos: { espessura: t1 - t0, malha: tM } };
}

self.onmessage = function (ev) {
  var d = ev.data, t0 = now();
  try {
    var r, tr = [];
    if (d.kind === 'foto') { r = prepFoto(d); r.build = buildFoto(r.rec); r.escolha = r.rec; }
    else if (d.kind === 'foto-escolha') { r = { build: buildFoto(d.idx), escolha: d.idx }; }
    else if (d.kind === 'lito') r = buildLito(d);
    var b = r.build || r;
    [b.tri, b.preview, b.heat, r.alvo].concat(b.view || []).forEach(function (x) { if (x && x.buffer && tr.indexOf(x.buffer) < 0) tr.push(x.buffer); });
    r.total = now() - t0;
    self.postMessage({ type: 'done', kind: d.kind, result: r }, tr);
  } catch (e) { self.postMessage({ type: 'error', msg: String(e && e.message || e) }); }
};
