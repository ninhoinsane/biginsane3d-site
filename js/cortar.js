/* Big Insane 3D · Dividir em partes · corta a peça por planos, fecha os cortes,
   abre furos de encaixe e gera os pinos. Precisa de earcut (ISC). Roda em segundo plano. */
(function (root) {
  'use strict';

  /* ---------- malha indexada ---------- */
  function weld(tri) {
    var map = new Map(), V = [], T = new Uint32Array(tri.length / 3), q = 1e5;
    for (var i = 0, t = 0; i < tri.length; i += 3, t++) {
      var key = Math.round(tri[i] * q) + ',' + Math.round(tri[i + 1] * q) + ',' + Math.round(tri[i + 2] * q), id = map.get(key);
      if (id === undefined) { id = V.length / 3; map.set(key, id); V.push(tri[i], tri[i + 1], tri[i + 2]); }
      T[t] = id;
    }
    return { V: V, T: T };
  }

  var AX = { 0: [1, 2], 1: [2, 0], 2: [0, 1] }; // eixos do plano (u, v) para cada eixo de corte

  /* ---------- corte por um plano ---------- */
  function cutMesh(tri, axis, c) {
    var m = weld(tri), V = m.V, T = m.T, n = T.length / 3;
    // evita vértice exatamente no plano
    for (var i = axis; i < V.length; i += 3) if (Math.abs(V[i] - c) < 1e-6) V[i] += 2e-6;
    var below = [], above = [], segs = [], pts = [], edgeMap = new Map();
    function P(a, b) { // ponto de interseção na aresta a-b (mesmo id para os dois triângulos vizinhos)
      var k = a < b ? a + '_' + b : b + '_' + a, id = edgeMap.get(k);
      if (id !== undefined) return id;
      var da = V[a * 3 + axis] - c, db = V[b * 3 + axis] - c, t = da / (da - db);
      var p = [V[a * 3] + (V[b * 3] - V[a * 3]) * t, V[a * 3 + 1] + (V[b * 3 + 1] - V[a * 3 + 1]) * t, V[a * 3 + 2] + (V[b * 3 + 2] - V[a * 3 + 2]) * t];
      p[axis] = c; id = pts.length; pts.push(p); edgeMap.set(k, id); return id;
    }
    function push(arr, p0, p1, p2) { arr.push(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2]); }
    function vtx(i) { return [V[i * 3], V[i * 3 + 1], V[i * 3 + 2]]; }
    for (var f = 0; f < n; f++) {
      var a = T[f * 3], b = T[f * 3 + 1], d = T[f * 3 + 2];
      var sa = V[a * 3 + axis] < c, sb = V[b * 3 + axis] < c, sd = V[d * 3 + axis] < c;
      if (sa === sb && sb === sd) { push(sa ? below : above, vtx(a), vtx(b), vtx(d)); continue; }
      // gira para o vértice sozinho ficar primeiro (mantém o sentido)
      var o = sa === sb ? [d, a, b] : sa === sd ? [b, d, a] : [a, b, d];
      var lone = o[0], lb = V[lone * 3 + axis] < c;
      var pab = P(o[0], o[1]), pac = P(o[0], o[2]);
      var A = vtx(o[0]), Bv = vtx(o[1]), C = vtx(o[2]), PAB = pts[pab], PAC = pts[pac];
      push(lb ? below : above, A, PAB, PAC);
      push(lb ? above : below, PAB, Bv, C); push(lb ? above : below, PAB, C, PAC);
      segs.push(lb ? [pab, pac] : [pac, pab]); // bordas da parte de baixo, sentido consistente
    }
    var loops = chain(segs, pts);
    return { below: below, above: above, loops: loops, pts: pts };
  }

  function chain(segs, pts) {
    var next = new Map(); segs.forEach(function (s) { next.set(s[0], s[1]); });
    var seen = new Set(), loops = [];
    next.forEach(function (_, start) {
      if (seen.has(start)) return;
      var loop = [], cur = start, guard = 0;
      while (cur !== undefined && !seen.has(cur) && guard++ < 1e7) { seen.add(cur); loop.push(cur); cur = next.get(cur); }
      if (loop.length >= 3 && cur === start) loops.push(loop.map(function (i) { return pts[i]; }));
    });
    return loops;
  }

  /* ---------- geometria 2D da seção ---------- */
  function to2d(loop, axis) { var u = AX[axis][0], v = AX[axis][1]; return loop.map(function (p) { return [p[u], p[v]]; }); }
  function area(poly) { var s = 0; for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) s += (poly[j][0] - poly[i][0]) * (poly[j][1] + poly[i][1]); return s / 2; }
  function inside(pt, poly) {
    var c = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      if (((poly[i][1] > pt[1]) !== (poly[j][1] > pt[1])) && (pt[0] < (poly[j][0] - poly[i][0]) * (pt[1] - poly[i][1]) / (poly[j][1] - poly[i][1]) + poly[i][0])) c = !c;
    }
    return c;
  }
  function inRegion(pt, polys) { var k = 0; polys.forEach(function (p) { if (inside(pt, p)) k++; }); return k % 2 === 1; }
  function edgeDist(pt, polys) {
    var best = Infinity;
    polys.forEach(function (p) {
      for (var i = 0, j = p.length - 1; i < p.length; j = i++) {
        var ax = p[j][0], ay = p[j][1], bx = p[i][0], by = p[i][1], dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
        var t = l ? Math.max(0, Math.min(1, ((pt[0] - ax) * dx + (pt[1] - ay) * dy) / l)) : 0;
        var d = Math.hypot(pt[0] - ax - t * dx, pt[1] - ay - t * dy); if (d < best) best = d;
      }
    });
    return best;
  }

  // agrupa contornos: externos com seus buracos
  function group(polys) {
    var info = polys.map(function (p, i) {
      var depth = 0; polys.forEach(function (q, j) { if (j !== i && inside(p[0], q)) depth++; });
      return { p: p, depth: depth, a: Math.abs(area(p)) };
    });
    var outers = info.filter(function (x) { return x.depth % 2 === 0; }).map(function (x) { return { outer: x.p, a: x.a, holes: [] }; });
    info.filter(function (x) { return x.depth % 2 === 1; }).forEach(function (h) {
      var best = null; outers.forEach(function (o) { if (inside(h.p[0], o.outer) && (!best || o.a < best.a)) best = o; });
      if (best) best.holes.push(h.p);
    });
    return outers;
  }

  /* ---------- tampa (com furos dos pinos) ---------- */
  function cap(polys2d, axis, c, pins, pinR, wantNormalSign) {
    var out = [], u = AX[axis][0], v = AX[axis][1];
    group(polys2d).forEach(function (g) {
      var rings = [g.outer].concat(g.holes);
      pins.forEach(function (pc) { if (inside(pc, g.outer)) rings.push(circle(pc, pinR)); });
      var flat = [], holes = [];
      rings.forEach(function (r, i) { if (i) holes.push(flat.length / 2); r.forEach(function (p) { flat.push(p[0], p[1]); }); });
      var idx = earcut(flat, holes.length ? holes : null, 2);
      for (var k = 0; k < idx.length; k += 3) {
        var tri3 = [idx[k], idx[k + 1], idx[k + 2]].map(function (ii) { var p = [0, 0, 0]; p[u] = flat[ii * 2]; p[v] = flat[ii * 2 + 1]; p[axis] = c; return p; });
        orient(out, tri3, axis, wantNormalSign);
      }
    });
    return out;
  }
  function circle(c0, r) { var a = [], N = 28; for (var i = 0; i < N; i++) { var t = i / N * Math.PI * 2; a.push([c0[0] + r * Math.cos(t), c0[1] + r * Math.sin(t)]); } return a; }
  function normalOf(t) {
    var ux = t[1][0] - t[0][0], uy = t[1][1] - t[0][1], uz = t[1][2] - t[0][2], vx = t[2][0] - t[0][0], vy = t[2][1] - t[0][1], vz = t[2][2] - t[0][2];
    return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
  }
  function orient(out, t, axis, sign) { // garante a normal no sentido pedido ao longo do eixo
    var nrm = normalOf(t); if (nrm[axis] * sign < 0) t = [t[0], t[2], t[1]];
    out.push(t[0][0], t[0][1], t[0][2], t[1][0], t[1][1], t[1][2], t[2][0], t[2][1], t[2][2]);
  }

  // parede e fundo do furo; dir = -1 (furo para baixo) ou +1 (para cima)
  function pinHole(pc, r, axis, c, depth, dir) {
    var out = [], u = AX[axis][0], v = AX[axis][1], ring = circle(pc, r), N = ring.length, cb = c + dir * depth;
    function P(p2, w) { var p = [0, 0, 0]; p[u] = p2[0]; p[v] = p2[1]; p[axis] = w; return p; }
    for (var i = 0; i < N; i++) {
      var a = ring[i], b = ring[(i + 1) % N];
      var t1 = [P(a, c), P(b, c), P(b, cb)], t2 = [P(a, c), P(b, cb), P(a, cb)];
      [t1, t2].forEach(function (t) { // normal apontando para o centro do furo (para fora do sólido)
        var nrm = normalOf(t), mid = [(t[0][u] + t[1][u] + t[2][u]) / 3, (t[0][v] + t[1][v] + t[2][v]) / 3];
        if (nrm[u] * (pc[0] - mid[0]) + nrm[v] * (pc[1] - mid[1]) < 0) t = [t[0], t[2], t[1]];
        out.push(t[0][0], t[0][1], t[0][2], t[1][0], t[1][1], t[1][2], t[2][0], t[2][1], t[2][2]);
      });
      orient(out, [P(pc, cb), P(a, cb), P(b, cb)], axis, -dir); // fundo olhando para a abertura
    }
    return out;
  }

  // pino integrado saindo da face do corte; dir = +1 (para cima) ou -1
  function pegOut(pc, r, axis, c, len, dir) {
    var out = [], u = AX[axis][0], v = AX[axis][1], ring = circle(pc, r), top = circle(pc, Math.max(0.6, r - 0.4)), N = ring.length;
    var c1 = c + dir * (len - 0.4), c2 = c + dir * len;
    function P(p2, w) { var p = [0, 0, 0]; p[u] = p2[0]; p[v] = p2[1]; p[axis] = w; return p; }
    function outward(t) { // normal para fora do eixo do pino
      var nrm = normalOf(t), mid = [(t[0][u] + t[1][u] + t[2][u]) / 3, (t[0][v] + t[1][v] + t[2][v]) / 3];
      if (nrm[u] * (mid[0] - pc[0]) + nrm[v] * (mid[1] - pc[1]) < 0) t = [t[0], t[2], t[1]];
      out.push(t[0][0], t[0][1], t[0][2], t[1][0], t[1][1], t[1][2], t[2][0], t[2][1], t[2][2]);
    }
    for (var i = 0; i < N; i++) {
      var a = ring[i], b = ring[(i + 1) % N], ta = top[i], tb = top[(i + 1) % N];
      outward([P(a, c), P(b, c), P(b, c1)]); outward([P(a, c), P(b, c1), P(a, c1)]);
      outward([P(a, c1), P(b, c1), P(tb, c2)]); outward([P(a, c1), P(tb, c2), P(ta, c2)]);
      orient(out, [P(pc, c2), P(ta, c2), P(tb, c2)], axis, dir);
    }
    return out;
  }

  // pino cilíndrico com chanfro de 0,4 mm nas pontas, em pé (eixo Z), base em z = 0
  function pinMesh(r, len) {
    var out = [], N = 28, ch = 0.4, zs = [[0, r - ch], [ch, r], [len - ch, r], [len, r - ch]];
    function ring(z, rr) { var a = []; for (var i = 0; i < N; i++) { var t = i / N * Math.PI * 2; a.push([rr * Math.cos(t), rr * Math.sin(t), z]); } return a; }
    var rings = zs.map(function (s) { return ring(s[0], s[1]); });
    function add(a, b, c) { out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); }
    for (var k = 0; k < rings.length - 1; k++) for (var i = 0; i < N; i++) {
      var a = rings[k][i], b = rings[k][(i + 1) % N], c = rings[k + 1][(i + 1) % N], d = rings[k + 1][i];
      add(a, b, c); add(a, c, d);
    }
    for (var j = 1; j < N - 1; j++) { add(rings[0][0], rings[0][j + 1], rings[0][j]); add(rings[3][0], rings[3][j], rings[3][j + 1]); }
    return new Float32Array(out);
  }

  // escolhe até 2 posições de pino longe das bordas, com material dos dois lados
  function choosePins(sec, secBelow, secAbove, r, margin) {
    var all = [].concat.apply([], sec), minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    all.forEach(function (p) { if (p[0] < minx) minx = p[0]; if (p[0] > maxx) maxx = p[0]; if (p[1] < miny) miny = p[1]; if (p[1] > maxy) maxy = p[1]; });
    var step = Math.max(1, Math.min(maxx - minx, maxy - miny) / 40), cand = [];
    for (var x = minx + step / 2; x < maxx; x += step) for (var y = miny + step / 2; y < maxy; y += step) {
      var pt = [x, y];
      if (!inRegion(pt, sec) || edgeDist(pt, sec) < r + margin) continue;
      if (!inRegion(pt, secBelow) || edgeDist(pt, secBelow) < r + 1) continue;
      if (!inRegion(pt, secAbove) || edgeDist(pt, secAbove) < r + 1) continue;
      cand.push(pt);
    }
    if (!cand.length) return [];
    if (cand.length === 1) return cand;
    var best = null, bd = -1;
    for (var i = 0; i < cand.length; i += Math.max(1, Math.floor(cand.length / 300))) for (var j = i + 1; j < cand.length; j += Math.max(1, Math.floor(cand.length / 300))) {
      var d = Math.hypot(cand[i][0] - cand[j][0], cand[i][1] - cand[j][1]); if (d > bd) { bd = d; best = [cand[i], cand[j]]; }
    }
    return bd > 4 * r ? best : [cand[Math.floor(cand.length / 2)]];
  }

  function sectionAt(tri, axis, c) { return cutMesh(tri, axis, c).loops.map(function (l) { return to2d(l, axis); }); }

  /* ---------- divide até caber ---------- */
  function split(tri, bed, opts) {
    opts = opts || {};
    var margin = opts.margin || 6, size = bbox(tri), lims = [bed[0] - margin, bed[1] - margin, bed[2] - 2], notes = [];
    var parts = [{ tri: tri }], pinList = [], cuts = [];
    opts.magnet = opts.magnet || { d: 8, t: 3 };
    [2, 0, 1].forEach(function (axis) {
      var len = size.max[axis] - size.min[axis], lim = lims[axis];
      if (len <= lim) return;
      var nCuts = Math.ceil(len / lim) - 1, stepL = len / (nCuts + 1);
      for (var k = 1; k <= nCuts; k++) {
        var c = size.min[axis] + stepL * k, nextParts = [];
        parts.forEach(function (p) {
          var b = bbox(p.tri);
          if (c <= b.min[axis] + 0.5 || c >= b.max[axis] - 0.5) { nextParts.push(p); return; }
          var res = cutMesh(p.tri, axis, c);
          if (!res.loops.length) { nextParts.push(p); return; }
          var sec = res.loops.map(function (l) { return to2d(l, axis); });
          // encaixe: pinos soltos, alojamentos para ímã ou só cola. No automático, tenta pino grande, depois pequeno, depois cola.
          var want = opts.connector || 'auto', pins = [], spec = null, used = 'cola';
          var rod = opts.rod || 3;
          var tries = want === 'imas' ? [{ kind: 'imas', r: 0, hole: (opts.magnet.d + 0.2) / 2, depth: opts.magnet.t + 0.2 }]
            : want === 'cola' ? []
            : want === 'vareta' ? [{ kind: 'vareta', r: rod / 2, hole: rod / 2 + 0.15, depth: Math.max(8, rod * 3) }]
            : want === 'macho' ? [{ kind: 'macho', r: 2.5, hole: 2.75, depth: 6 }, { kind: 'macho', r: 1.6, hole: 1.85, depth: 4 }]
            : [{ kind: 'pinos', r: 2.5, hole: 2.7, depth: 6 }, { kind: 'pinos', r: 1.5, hole: 1.7, depth: 4 }];
          for (var ti = 0; ti < tries.length && !pins.length; ti++) {
            var sp = tries[ti];
            pins = choosePins(sec, sectionAt(p.tri, axis, c - sp.depth - 1), sectionAt(p.tri, axis, c + sp.depth + 1), sp.hole, sp.kind === 'imas' ? 1.6 : 2);
            if (pins.length) { spec = sp; used = sp.kind; }
          }
          if (!pins.length && want !== 'cola') notes.push(want === 'imas' ? 'Um dos cortes é pequeno demais para o ímã escolhido: nesse corte, só cola.' : 'Um dos cortes ficou fino demais para pino: nesse corte, só cola.');
          cuts.push({ kind: used, count: pins.length, spec: spec, area: sec.reduce(function (s, q) { return s + Math.abs(area(q)); }, 0) });
          if (used === 'pinos') pins.forEach(function () { pinList.push(spec); });
          if (!spec) spec = { hole: 0, depth: 0 };
          var low, high;
          if (used === 'macho') { // parte de baixo recebe o pino; a de cima, o furo com folga
            low = res.below.concat(cap(sec, axis, c, pins, spec.r, +1));
            high = res.above.concat(cap(sec, axis, c, pins, spec.hole, -1));
            pins.forEach(function (pc) { low = low.concat(pegOut(pc, spec.r, axis, c, spec.depth - 0.5, +1)); high = high.concat(pinHole(pc, spec.hole, axis, c, spec.depth, +1)); });
          } else {
            low = res.below.concat(cap(sec, axis, c, pins, spec.hole, +1));
            high = res.above.concat(cap(sec, axis, c, pins, spec.hole, -1));
            pins.forEach(function (pc) { low = low.concat(pinHole(pc, spec.hole, axis, c, spec.depth, -1)); high = high.concat(pinHole(pc, spec.hole, axis, c, spec.depth, +1)); });
          }
          nextParts.push({ tri: new Float32Array(low), peg: used === 'macho' || p.peg }, { tri: new Float32Array(high), peg: p.peg });
        });
        parts = nextParts;
      }
    });
    var pinsOut = pinList.map(function (sp) { return pinMesh(sp.r, sp.depth * 2 - 1); });
    return { parts: parts.map(function (p) { return p.tri; }), pegParts: parts.map(function (p) { return !!p.peg; }), pins: pinsOut, pinSpecs: pinList, cuts: cuts, notes: notes };
  }
  function bbox(tri) {
    var mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (var i = 0; i < tri.length; i += 3) for (var a = 0; a < 3; a++) { var x = tri[i + a]; if (x < mn[a]) mn[a] = x; if (x > mx[a]) mx[a] = x; }
    return { min: mn, max: mx };
  }

  // confere se a malha é fechada (cada aresta usada exatamente 2 vezes)
  function closedCheck(tri) {
    var m = weld(tri), cnt = new Map(), bad = 0;
    for (var i = 0; i < m.T.length; i += 3) for (var e = 0; e < 3; e++) {
      var a = m.T[i + e], b = m.T[i + (e + 1) % 3], k = a < b ? a + '_' + b : b + '_' + a; cnt.set(k, (cnt.get(k) || 0) + 1);
    }
    cnt.forEach(function (v) { if (v !== 2) bad++; });
    return { edges: cnt.size, bad: bad };
  }

  root.BI3D_CORTE = { split: split, cutMesh: cutMesh, closedCheck: closedCheck, pinMesh: pinMesh, bbox: bbox };
})(this);
