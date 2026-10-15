/* Big Insane 3D · Oficina · motor
   Desenho 2D em pixels -> campo de distância -> contornos -> peça 3D fechada -> projeto 3MF multicor.
   Roda no navegador e no Node (testes). Não usa servidor. */
(function (root) {
  'use strict';
  var earcut = root.earcut || (typeof require === 'function' ? require('./earcut.min.js') : null);
  var JSZipRef = root.JSZip || (typeof require === 'function' ? require('./jszip.min.js') : null);

  /* ---------- campo: grade de pixels com medida em mm ----------
     d: Float32Array com distância com sinal em mm (positivo = dentro da peça)
     x do pixel i = ox + i*px ; y do pixel j = oy - j*px (o y do desenho cresce para baixo) */
  function Field(w, h, px, ox, oy, d) { this.w = w; this.h = h; this.px = px; this.ox = ox || 0; this.oy = oy || 0; this.d = d || new Float32Array(w * h).fill(-1e3); }
  Field.prototype.like = function (d) { return new Field(this.w, this.h, this.px, this.ox, this.oy, d); };

  // distância exata (Felzenszwalb & Huttenlocher) em uma linha
  function edt1(f, n, d, v, z) {
    var k = 0, q, s; v[0] = 0; z[0] = -1e30; z[1] = 1e30;
    for (q = 1; q < n; q++) {
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = 1e30;
    }
    k = 0;
    for (q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
  }
  // distância (em pixels) de cada pixel até o pixel marcado mais próximo
  function distTo(mark, w, h) {
    var INF = 1e12, n = Math.max(w, h), f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
    var g = new Float64Array(w * h), x, y, any = false;
    for (var i = 0; i < w * h; i++) { g[i] = mark[i] ? 0 : INF; if (mark[i]) any = true; }
    var out = new Float32Array(w * h);
    if (!any) { out.fill(1e4); return out; }
    for (x = 0; x < w; x++) { for (y = 0; y < h; y++) f[y] = g[y * w + x]; edt1(f, h, d, v, z); for (y = 0; y < h; y++) g[y * w + x] = d[y]; }
    for (y = 0; y < h; y++) { for (x = 0; x < w; x++) f[x] = g[y * w + x]; edt1(f, w, d, v, z); for (x = 0; x < w; x++) out[y * w + x] = Math.sqrt(d[x]); }
    return out;
  }

  /* cobertura (0..1, ex.: alfa do canvas) -> campo com sinal. Mantém a suavidade da borda (antisserrilhado). */
  function fromCoverage(cov, w, h, px, ox, oy) {
    var n = w * h, inside = new Uint8Array(n), outside = new Uint8Array(n);
    for (var i = 0; i < n; i++) { if (cov[i] >= 0.5) inside[i] = 1; else outside[i] = 1; }
    var dIn = distTo(inside, w, h), dOut = distTo(outside, w, h), d = new Float32Array(n);
    for (i = 0; i < n; i++) {
      var s = inside[i] ? dOut[i] - 0.5 : -(dIn[i] - 0.5);
      if (Math.abs(s) <= 0.5) s = cov[i] - 0.5; // borda: usa a cobertura real
      d[i] = s * px;
    }
    return new Field(w, h, px, ox, oy, d);
  }
  // recalcula a distância a partir do formato (necessário depois de juntar/cortar formas, antes de engrossar)
  function redist(F) {
    var n = F.w * F.h, cov = new Float32Array(n), s = 1 / F.px;
    for (var i = 0; i < n; i++) cov[i] = Math.max(0, Math.min(1, F.d[i] * s + 0.5));
    return fromCoverage(cov, F.w, F.h, F.px, F.ox, F.oy);
  }
  function union() { var a = arguments, F = a[0], d = new Float32Array(F.d); for (var k = 1; k < a.length; k++) { var b = a[k].d; for (var i = 0; i < d.length; i++) if (b[i] > d[i]) d[i] = b[i]; } return F.like(d); }
  function intersect(A, B) { var d = new Float32Array(A.d.length); for (var i = 0; i < d.length; i++) d[i] = Math.min(A.d[i], B.d[i]); return A.like(d); }
  function subtract(A, B) { var d = new Float32Array(A.d.length); for (var i = 0; i < d.length; i++) d[i] = Math.min(A.d[i], -B.d[i]); return A.like(d); }
  // engrossa (r > 0) ou afina (r < 0) em mm. Use redist antes se o campo veio de união/corte.
  function offset(F, r) { var d = new Float32Array(F.d.length); for (var i = 0; i < d.length; i++) d[i] = F.d[i] + r; return F.like(d); }
  // fecha reentrâncias e buracos menores que r (engrossa e afina de volta)
  function close(F, r) { return offset(redist(offset(F, r)), -r); }
  // remove pontas e ilhas mais finas que r
  function open(F, r) { return offset(redist(offset(F, -r)), r); }
  function area(F) { var c = 0; for (var i = 0; i < F.d.length; i++) if (F.d[i] > 0) c++; return c * F.px * F.px; }
  function bbox(F) {
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, w = F.w;
    for (var j = 0; j < F.h; j++) for (var i = 0; i < w; i++) if (F.d[j * w + i] > 0) { if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; if (j > y1) y1 = j; }
    if (x1 < 0) return null;
    return { minX: F.ox + x0 * F.px, maxX: F.ox + x1 * F.px, minY: F.oy - y1 * F.px, maxY: F.oy - y0 * F.px };
  }
  // formas simples em mm
  function circle(F, cx, cy, r) {
    var d = new Float32Array(F.w * F.h);
    for (var j = 0; j < F.h; j++) for (var i = 0; i < F.w; i++) { var x = F.ox + i * F.px - cx, y = F.oy - j * F.px - cy; d[j * F.w + i] = r - Math.sqrt(x * x + y * y); }
    return F.like(d);
  }
  function rect(F, x0, y0, x1, y1, rr) {
    rr = rr || 0;
    var d = new Float32Array(F.w * F.h), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, hx = (x1 - x0) / 2 - rr, hy = (y1 - y0) / 2 - rr;
    for (var j = 0; j < F.h; j++) for (var i = 0; i < F.w; i++) {
      var qx = Math.abs(F.ox + i * F.px - cx) - hx, qy = Math.abs(F.oy - j * F.px - cy) - hy;
      var o = Math.sqrt(Math.max(qx, 0) * Math.max(qx, 0) + Math.max(qy, 0) * Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
      d[j * F.w + i] = rr - o;
    }
    return F.like(d);
  }
  // polígono qualquer (pontos em mm, qualquer sentido)
  function polygon(F, pts) {
    var d = new Float32Array(F.w * F.h), n = pts.length;
    for (var j = 0; j < F.h; j++) for (var i = 0; i < F.w; i++) {
      var x = F.ox + i * F.px, y = F.oy - j * F.px, best = 1e9, ins = false;
      for (var a = 0, b = n - 1; a < n; b = a++) {
        var ax = pts[a][0], ay = pts[a][1], bx = pts[b][0], by = pts[b][1], vx = bx - ax, vy = by - ay;
        var t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy || 1)));
        var ex = ax + t * vx - x, ey = ay + t * vy - y, e = ex * ex + ey * ey; if (e < best) best = e;
        if (((ay > y) !== (by > y)) && (x < vx * (y - ay) / (vy || 1e-12) + ax)) ins = !ins;
      }
      d[j * F.w + i] = (ins ? 1 : -1) * Math.sqrt(best);
    }
    return F.like(d);
  }
  // maior distância até a borda (metade da parte mais grossa)
  function maxInside(F) { var m = -1e9; for (var i = 0; i < F.d.length; i++) if (F.d[i] > m) m = F.d[i]; return m; }
  // corta tudo abaixo (y < y0) ou acima (y > y1) de uma linha horizontal
  function clipY(F, y0, y1) {
    var d = new Float32Array(F.d);
    for (var j = 0; j < F.h; j++) { var y = F.oy - j * F.px, lim = Math.min(y0 === null ? 1e9 : y - y0, y1 === null ? 1e9 : y1 - y); for (var i = 0; i < F.w; i++) if (lim < d[j * F.w + i]) d[j * F.w + i] = lim; }
    return F.like(d);
  }
  // quantas partes soltas a forma tem (vizinhança de 4)
  function components(F) {
    var w = F.w, h = F.h, n = w * h, lab = new Int32Array(n), c = 0, st = new Int32Array(n), sizes = [];
    for (var s = 0; s < n; s++) {
      if (F.d[s] <= 0 || lab[s]) continue;
      c++; var sp = 0, cnt = 0; st[sp++] = s; lab[s] = c;
      while (sp) {
        var p = st[--sp], x = p % w, y = (p - x) / w; cnt++;
        if (x > 0 && F.d[p - 1] > 0 && !lab[p - 1]) { lab[p - 1] = c; st[sp++] = p - 1; }
        if (x < w - 1 && F.d[p + 1] > 0 && !lab[p + 1]) { lab[p + 1] = c; st[sp++] = p + 1; }
        if (y > 0 && F.d[p - w] > 0 && !lab[p - w]) { lab[p - w] = c; st[sp++] = p - w; }
        if (y < h - 1 && F.d[p + w] > 0 && !lab[p + w]) { lab[p + w] = c; st[sp++] = p + w; }
      }
      sizes.push(cnt * F.px * F.px);
    }
    return { count: c, labels: lab, areas: sizes };
  }

  /* ---------- contornos (marching squares com interpolação) ---------- */
  function contours(F) {
    var w = F.w, h = F.h, d = F.d, W = w + 2, NEG = -1e3;
    function val(i, j) { return (i < 0 || j < 0 || i >= w || j >= h) ? NEG : d[j * w + i]; }
    // ponto de cruzamento em cada aresta da grade: id = ((j+1)*W + (i+1))*2 + (0 horizontal | 1 vertical)
    var px = [], py = [], idOf = new Map();
    function pt(i, j, horiz) {
      var id = ((j + 1) * W + (i + 1)) * 2 + (horiz ? 0 : 1), k = idOf.get(id);
      if (k !== undefined) return k;
      var a = val(i, j), b = horiz ? val(i + 1, j) : val(i, j + 1), t = a / (a - b);
      if (!(t >= 0 && t <= 1)) t = 0.5;
      t = Math.min(0.999, Math.max(0.001, t));
      k = px.length; idOf.set(id, k);
      px.push(horiz ? i + t : i); py.push(horiz ? j : j + t);
      return k;
    }
    var nb = new Map(); // ponto -> [vizinho, vizinho]
    function seg(a, b) {
      var la = nb.get(a); if (!la) nb.set(a, la = []); la.push(b);
      var lb = nb.get(b); if (!lb) nb.set(b, lb = []); lb.push(a);
    }
    for (var j = -1; j < h; j++) for (var i = -1; i < w; i++) {
      var v0 = val(i, j), v1 = val(i + 1, j), v2 = val(i + 1, j + 1), v3 = val(i, j + 1);
      var c = (v0 > 0 ? 1 : 0) | (v1 > 0 ? 2 : 0) | (v2 > 0 ? 4 : 0) | (v3 > 0 ? 8 : 0);
      if (c === 0 || c === 15) continue;
      // arestas: topo (i,j)-(i+1,j) ; direita (i+1,j)-(i+1,j+1) ; baixo (i,j+1)-(i+1,j+1) ; esquerda (i,j)-(i,j+1)
      var T = function () { return pt(i, j, true); }, R = function () { return pt(i + 1, j, false); }, B = function () { return pt(i, j + 1, true); }, L = function () { return pt(i, j, false); };
      switch (c) {
        case 1: case 14: seg(L(), T()); break;
        case 2: case 13: seg(T(), R()); break;
        case 3: case 12: seg(L(), R()); break;
        case 4: case 11: seg(R(), B()); break;
        case 6: case 9: seg(T(), B()); break;
        case 7: case 8: seg(L(), B()); break;
        case 5: case 10:
          var center = (v0 + v1 + v2 + v3) / 4;
          if ((c === 5) === (center > 0)) { seg(L(), B()); seg(T(), R()); } // cantos de dentro ligados pelo centro
          else { seg(L(), T()); seg(R(), B()); }
          break;
      }
    }
    // liga os segmentos em voltas fechadas
    var used = new Uint8Array(px.length), loops = [];
    nb.forEach(function (list, start) {
      if (used[start]) return;
      var loop = [], prev = -1, cur = start, guard = 0;
      while (!used[cur] && guard++ < 1e7) {
        used[cur] = 1; loop.push(cur);
        var l = nb.get(cur), next = l[0] === prev ? l[1] : l[0];
        if (l.length > 2) { for (var q = 0; q < l.length; q++) if (!used[l[q]]) { next = l[q]; break; } }
        prev = cur; cur = next;
        if (cur === undefined) break;
      }
      if (loop.length >= 3) loops.push(loop.map(function (k) { return [F.ox + px[k] * F.px, F.oy - py[k] * F.px]; }));
    });
    return loops;
  }

  function signedArea(r) { var s = 0; for (var i = 0, n = r.length; i < n; i++) { var a = r[i], b = r[(i + 1) % n]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; }
  // Douglas-Peucker em volta fechada
  function simplify(r, tol) {
    var n = r.length; if (n < 8) return r;
    var far = 0, best = -1;
    for (var i = 1; i < n; i++) { var dx = r[i][0] - r[0][0], dy = r[i][1] - r[0][1], dd = dx * dx + dy * dy; if (dd > best) { best = dd; far = i; } }
    function dp(a, b, out) {
      var A = r[a], B = r[b % n], vx = B[0] - A[0], vy = B[1] - A[1], L = vx * vx + vy * vy, mx = -1, mi = -1;
      for (var k = a + 1; k < b; k++) {
        var P = r[k % n], t = L ? ((P[0] - A[0]) * vx + (P[1] - A[1]) * vy) / L : 0; t = Math.max(0, Math.min(1, t));
        var ex = A[0] + t * vx - P[0], ey = A[1] + t * vy - P[1], e = ex * ex + ey * ey;
        if (e > mx) { mx = e; mi = k; }
      }
      if (mx > tol * tol) { dp(a, mi, out); out.push(r[mi % n]); dp(mi, b, out); }
    }
    var out = [r[0]]; dp(0, far, out); out.push(r[far]); dp(far, n, out);
    return out.length >= 3 ? out : r;
  }
  function inRing(p, r) {
    var x = p[0], y = p[1], ins = false;
    for (var i = 0, j = r.length - 1; i < r.length; j = i++) {
      var xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) ins = !ins;
    }
    return ins;
  }
  /* campo -> polígonos com furos: [{ outer: [[x,y]...] (anti-horário), holes: [[...]] (horário) }] */
  function polygons(F, tol) {
    var loops = contours(F).map(function (r) { return simplify(r, tol === undefined ? F.px * 0.35 : tol); })
      .map(function (r) { return { r: r, a: signedArea(r) }; }).filter(function (o) { return Math.abs(o.a) > F.px * F.px * 2; });
    loops.forEach(function (o) {
      o.b = o.r.reduce(function (b, p) { return [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[0]), Math.max(b[3], p[1])]; }, [1e9, 1e9, -1e9, -1e9]);
    });
    // profundidade: em quantas voltas maiores cada volta está; o pai é a menor delas
    loops.sort(function (a, b) { return Math.abs(b.a) - Math.abs(a.a); });
    loops.forEach(function (o, i) {
      o.depth = 0; o.parent = -1; var p = o.r[0];
      for (var k = 0; k < i; k++) {
        var q = loops[k];
        if (p[0] < q.b[0] || p[0] > q.b[2] || p[1] < q.b[1] || p[1] > q.b[3]) continue;
        if (inRing(p, q.r)) { o.depth++; o.parent = k; }
      }
    });
    var polys = [], idx = {};
    loops.forEach(function (o, i) {
      if (o.depth % 2 === 0) { var ring = o.a < 0 ? o.r.slice().reverse() : o.r; idx[i] = polys.length; polys.push({ outer: ring, holes: [] }); }
    });
    loops.forEach(function (o) {
      if (o.depth % 2 === 1 && idx[o.parent] !== undefined) polys[idx[o.parent]].holes.push(o.a > 0 ? o.r.slice().reverse() : o.r);
    });
    return polys;
  }

  /* ---------- extrusão: polígonos -> triângulos fechados (Float32Array, mm) ---------- */
  function extrude(polys, z0, z1, out) {
    out = out || [];
    polys.forEach(function (pg) {
      var flat = [], holes = [], rings = [pg.outer].concat(pg.holes);
      rings.forEach(function (r, k) { if (k) holes.push(flat.length / 2); r.forEach(function (p) { flat.push(p[0], p[1]); }); });
      var t = earcut(flat, holes.length ? holes : null, 2);
      for (var i = 0; i < t.length; i += 3) {
        var a = t[i] * 2, b = t[i + 1] * 2, c = t[i + 2] * 2;
        var cr = (flat[b] - flat[a]) * (flat[c + 1] - flat[a + 1]) - (flat[b + 1] - flat[a + 1]) * (flat[c] - flat[a]);
        if (cr < 0) { var s = b; b = c; c = s; }
        out.push(flat[a], flat[a + 1], z1, flat[b], flat[b + 1], z1, flat[c], flat[c + 1], z1); // topo
        out.push(flat[a], flat[a + 1], z0, flat[c], flat[c + 1], z0, flat[b], flat[b + 1], z0); // fundo
      }
      rings.forEach(function (r) {
        for (var i = 0, n = r.length; i < n; i++) {
          var A = r[i], B = r[(i + 1) % n];
          out.push(A[0], A[1], z0, B[0], B[1], z0, B[0], B[1], z1);
          out.push(A[0], A[1], z0, B[0], B[1], z1, A[0], A[1], z1);
        }
      });
    });
    return out;
  }
  function toTri(arr) { return arr instanceof Float32Array ? arr : new Float32Array(arr); }
  function volume(tri) { var v = 0; for (var i = 0; i < tri.length; i += 9) { var ax = tri[i], ay = tri[i + 1], az = tri[i + 2], bx = tri[i + 3], by = tri[i + 4], bz = tri[i + 5], cx = tri[i + 6], cy = tri[i + 7], cz = tri[i + 8]; v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6; } return v; }
  function bounds(tris) {
    var b = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9];
    tris.forEach(function (t) { for (var i = 0; i < t.length; i += 3) { if (t[i] < b[0]) b[0] = t[i]; if (t[i + 1] < b[1]) b[1] = t[i + 1]; if (t[i + 2] < b[2]) b[2] = t[i + 2]; if (t[i] > b[3]) b[3] = t[i]; if (t[i + 1] > b[4]) b[4] = t[i + 1]; if (t[i + 2] > b[5]) b[5] = t[i + 2]; } });
    return b;
  }
  function translate(tri, dx, dy, dz) { var o = new Float32Array(tri.length); for (var i = 0; i < tri.length; i += 3) { o[i] = tri[i] + dx; o[i + 1] = tri[i + 1] + dy; o[i + 2] = tri[i + 2] + dz; } return o; }

  /* ---------- camadas e pausas ----------
     altura de cada camada do fatiador: primeira = h0, depois lh. snap() leva uma altura para o fim de camada mais próximo */
  function layerGrid(cfg) {
    var h0 = parseFloat(cfg && cfg.initial_layer_print_height) || 0.2, lh = parseFloat(cfg && cfg.layer_height) || 0.2;
    return { h0: h0, lh: lh, snap: function (z) { if (z <= h0) return h0; return +(h0 + Math.max(1, Math.round((z - h0) / lh)) * lh).toFixed(3); } };
  }

  /* ---------- projeto 3MF (Bambu Studio / OrcaSlicer / Anycubic Slicer Next) ----------
     parts: [{ tri (mm, peça centrada em x/y, z >= 0), name, extruder (1..n) }]
     pauses: [{ z (topo da camada antes da qual pausa), color, note }] ; bed: [largura, profundidade] */
  function meshXML(tri, id, out) {
    var map = new Map(), V = [], T = [], q = 1e4;
    for (var i = 0; i < tri.length; i += 3) {
      var key = Math.round(tri[i] * q) + '_' + Math.round(tri[i + 1] * q) + '_' + Math.round(tri[i + 2] * q), k = map.get(key);
      if (k === undefined) { k = V.length / 3; map.set(key, k); V.push(tri[i], tri[i + 1], tri[i + 2]); }
      T.push(k);
    }
    var b = ['  <object id="' + id + '" type="model">\n   <mesh>\n    <vertices>\n'];
    for (var v = 0; v < V.length; v += 3) b.push('     <vertex x="' + +V[v].toFixed(4) + '" y="' + +V[v + 1].toFixed(4) + '" z="' + +V[v + 2].toFixed(4) + '"/>\n');
    b.push('    </vertices>\n    <triangles>\n');
    var faces = 0;
    for (var t = 0; t < T.length; t += 3) if (T[t] !== T[t + 1] && T[t + 1] !== T[t + 2] && T[t] !== T[t + 2]) { b.push('     <triangle v1="' + T[t] + '" v2="' + T[t + 1] + '" v3="' + T[t + 2] + '"/>\n'); faces++; }
    b.push('    </triangles>\n   </mesh>\n  </object>\n');
    out.push(b.join(''));
    return faces;
  }
  function xmlEsc(s) { return String(s).replace(/[<>&"]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]; }); }

  function project(o) {
    var parts = o.parts, cfg = o.cfg, name = xmlEsc(o.name || 'peca'), bed = o.bed || [256, 256], app = o.appVersion || '2.0.0.3';
    var b = bounds(parts.map(function (p) { return p.tri; }));
    var cx = (b[0] + b[3]) / 2, cy = (b[1] + b[4]) / 2, oid = parts.length + 1;
    var objs = [], faces = [];
    parts.forEach(function (p, i) { faces.push(meshXML(translate(p.tri, -cx, -cy, -b[2]), i + 1, objs)); });
    var NS = 'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06"';
    var sub = '<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" ' + NS + ' requiredextensions="p">\n <metadata name="BambuStudio:3mfVersion">1</metadata>\n <resources>\n' + objs.join('') + ' </resources>\n <build/>\n</model>\n';
    var main = '<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" ' + NS + ' requiredextensions="p">\n' +
      ' <metadata name="Application">BambuStudio-' + app + '</metadata>\n <metadata name="BambuStudio:3mfVersion">1</metadata>\n <metadata name="Title">' + name + '</metadata>\n <metadata name="Designer">Big Insane 3D · Oficina</metadata>\n' +
      ' <resources>\n  <object id="' + oid + '" type="model">\n   <components>\n' +
      parts.map(function (p, i) { return '    <component p:path="/3D/Objects/object_1.model" objectid="' + (i + 1) + '" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>\n'; }).join('') +
      '   </components>\n  </object>\n </resources>\n <build>\n  <item objectid="' + oid + '" transform="1 0 0 0 1 0 0 0 1 ' + (bed[0] / 2).toFixed(3) + ' ' + (bed[1] / 2).toFixed(3) + ' 0" printable="1"/>\n </build>\n</model>\n';
    var ms = '<?xml version="1.0" encoding="UTF-8"?>\n<config>\n  <object id="' + oid + '">\n    <metadata key="name" value="' + name + '"/>\n    <metadata key="extruder" value="' + (parts[0].extruder || 1) + '"/>\n' +
      parts.map(function (p, i) {
        return '    <part id="' + (i + 1) + '" subtype="normal_part">\n      <metadata key="name" value="' + xmlEsc(p.name) + '"/>\n      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>\n' +
          '      <metadata key="extruder" value="' + (p.extruder || 1) + '"/>\n      <mesh_stat face_count="' + faces[i] + '" edges_fixed="0" degenerate_facets="0" facets_removed="0" facets_reversed="0" backwards_edges="0"/>\n    </part>\n';
      }).join('') + '  </object>\n  <plate>\n    <metadata key="plater_id" value="1"/>\n    <metadata key="plater_name" value=""/>\n    <metadata key="locked" value="false"/>\n' +
      '    <model_instance>\n      <metadata key="object_id" value="' + oid + '"/>\n      <metadata key="instance_id" value="0"/>\n    </model_instance>\n  </plate>\n</config>\n';
    var zip = new JSZipRef();
    zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n <Default Extension="png" ContentType="image/png"/>\n <Default Extension="gcode" ContentType="text/x.gcode"/>\n</Types>\n');
    zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n</Relationships>\n');
    zip.file('3D/_rels/3dmodel.model.rels', '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n <Relationship Target="/3D/Objects/object_1.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n</Relationships>\n');
    zip.file('3D/3dmodel.model', main);
    zip.file('3D/Objects/object_1.model', sub);
    zip.file('Metadata/model_settings.config', ms);
    zip.file('Metadata/project_settings.config', JSON.stringify(cfg, null, 4));
    if (o.pauses && o.pauses.length) {
      zip.file('Metadata/custom_gcode_per_layer.xml', '<?xml version="1.0" encoding="utf-8"?>\n<custom_gcodes_per_layer>\n<plate>\n<plate_info id="1"/>\n' +
        o.pauses.map(function (p) { return '<layer top_z="' + p.z + '" type="1" extruder="1" color="' + xmlEsc(p.color || '#FFFFFF') + '" extra="' + xmlEsc(p.note || 'Troque o filamento') + '" gcode="' + xmlEsc(p.gcode || 'M601') + '"/>\n'; }).join('') +
        '<mode value="SingleExtruder"/>\n</plate>\n</custom_gcodes_per_layer>\n');
    }
    return zip.generateAsync({ type: o.nodebuffer ? 'nodebuffer' : 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 }, mimeType: 'model/3mf' });
  }

  /* STL binário de todas as partes juntas (para quem usa outro fatiador) */
  function stl(tris) {
    var n = 0; tris.forEach(function (t) { n += t.length / 9; });
    var buf = new ArrayBuffer(84 + n * 50), dv = new DataView(buf), o = 84;
    var head = 'Big Insane 3D - Oficina'; for (var i = 0; i < head.length; i++) dv.setUint8(i, head.charCodeAt(i));
    dv.setUint32(80, n, true);
    var b = bounds(tris), cx = (b[0] + b[3]) / 2, cy = (b[1] + b[4]) / 2;
    tris.forEach(function (t) {
      for (var f = 0; f < t.length; f += 9) {
        o += 12;
        for (var k = 0; k < 9; k++) dv.setFloat32(o + k * 4, t[f + k] - (k % 3 === 0 ? cx : k % 3 === 1 ? cy : b[2]), true);
        o += 38;
      }
    });
    return buf;
  }

  /* ---------- Pix (BR Code estático do Banco Central) ---------- */
  function crc16(s) {
    var crc = 0xFFFF;
    for (var i = 0; i < s.length; i++) { crc ^= s.charCodeAt(i) << 8; for (var k = 0; k < 8; k++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF; }
    return ('0000' + crc.toString(16).toUpperCase()).slice(-4);
  }
  function ascii(s, max) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E]/g, '').trim().slice(0, max); }
  function emv(id, v) { return id + ('0' + v.length).slice(-2) + v; }
  function pix(o) {
    var key = String(o.key || '').trim();
    if (/^\(?\d{2}\)?\s?9?\d{4}-?\d{4}$/.test(key.replace(/\s/g, '')) && key.indexOf('@') < 0) key = '+55' + key.replace(/\D/g, ''); // telefone
    else if (/^[\d.\-/]+$/.test(key)) key = key.replace(/\D/g, ''); // CPF/CNPJ
    var acc = emv('00', 'br.gov.bcb.pix') + emv('01', key) + (o.desc ? emv('02', ascii(o.desc, 40)) : '');
    var s = emv('00', '01') + emv('26', acc) + emv('52', '0000') + emv('53', '986');
    var val = parseFloat(String(o.amount || '').replace(',', '.'));
    if (val > 0) s += emv('54', val.toFixed(2));
    s += emv('58', 'BR') + emv('59', ascii(o.name, 25) || 'RECEBEDOR') + emv('60', ascii(o.city, 15) || 'BRASIL') + emv('62', emv('05', ascii(o.txid, 25).replace(/[^A-Za-z0-9]/g, '') || '***')) + '6304';
    return s + crc16(s);
  }

  /* ---------- vaso paramétrico (sólido fechado; imprime no modo vaso) ---------- */
  function vase(o) {
    var H = o.height, rb = o.baseD / 2, rt = o.topD / 2, belly = o.belly || 0, bellyAt = o.bellyAt || 0.45, N = o.seg || 180, M = Math.max(40, Math.round(H / 1.2));
    var style = o.style || 'liso', lobes = o.lobes || 8, amp = (o.amp || 0) / 100, twist = (o.twist || 0) * Math.PI / 180;
    function radius(t) { // perfil: base -> barriga -> boca, suave
      var u = t <= bellyAt ? t / bellyAt * 0.5 : 0.5 + (t - bellyAt) / (1 - bellyAt) * 0.5;
      return Math.max(3, rb + (rt - rb) * t + belly * Math.sin(Math.PI * u));
    }
    function shape(a, t) {
      var ang = a + twist * t;
      if (style === 'ondas') return 1 + amp * Math.cos(lobes * ang);
      if (style === 'facetado') { var k = Math.PI / lobes, x = ((ang % (2 * k)) + 2 * k) % (2 * k) - k; return Math.cos(k) / Math.cos(x); }
      if (style === 'petalas') return 1 + amp * (Math.pow(Math.abs(Math.cos(lobes / 2 * ang)), 0.6) - 0.5);
      return 1;
    }
    var P = [];
    for (var j = 0; j <= M; j++) {
      var t = j / M, r = radius(t), ring = [];
      for (var i = 0; i < N; i++) { var a = i / N * Math.PI * 2, s = r * shape(a, t); ring.push([Math.cos(a) * s, Math.sin(a) * s, t * H]); }
      P.push(ring);
    }
    var out = [];
    for (j = 0; j < M; j++) for (i = 0; i < N; i++) {
      var A = P[j][i], B = P[j][(i + 1) % N], C = P[j + 1][(i + 1) % N], D = P[j + 1][i];
      out.push(A[0], A[1], A[2], B[0], B[1], B[2], C[0], C[1], C[2], A[0], A[1], A[2], C[0], C[1], C[2], D[0], D[1], D[2]);
    }
    for (i = 0; i < N; i++) { // tampas
      var a0 = P[0][i], b0 = P[0][(i + 1) % N]; out.push(0, 0, 0, b0[0], b0[1], 0, a0[0], a0[1], 0);
      var a1 = P[M][i], b1 = P[M][(i + 1) % N]; out.push(0, 0, H, a1[0], a1[1], H, b1[0], b1[1], H);
    }
    return new Float32Array(out);
  }

  var API = { Field: Field, distTo: distTo, fromCoverage: fromCoverage, redist: redist, union: union, intersect: intersect, subtract: subtract, offset: offset, close: close, open: open,
    area: area, bbox: bbox, circle: circle, rect: rect, polygon: polygon, maxInside: maxInside, clipY: clipY, components: components, contours: contours, polygons: polygons, extrude: extrude, toTri: toTri, volume: volume,
    bounds: bounds, translate: translate, layerGrid: layerGrid, project: project, stl: stl, pix: pix, crc16: crc16, vase: vase };
  root.BI3D_OF = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof self !== 'undefined' ? self : this);
