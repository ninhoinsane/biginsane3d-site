/* Big Insane 3D · Malha: lê STL/3MF de qualquer origem, analisa a peça,
   escolhe a melhor posição e monta um projeto .3mf novo. Roda no navegador. */
(function (root) {
  'use strict';

  /* ---------- leitura ---------- */
  function parseSTL(buf) {
    var dv = new DataView(buf), n = buf.byteLength >= 84 ? dv.getUint32(80, true) : 0;
    if (buf.byteLength === 84 + n * 50 && n > 0) {
      var tri = new Float32Array(n * 9);
      for (var i = 0; i < n; i++) {
        var o = 84 + i * 50 + 12;
        for (var j = 0; j < 9; j++) tri[i * 9 + j] = dv.getFloat32(o + j * 4, true);
      }
      return tri;
    }
    var txt = new TextDecoder().decode(new Uint8Array(buf));
    var re = /vertex\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)/g, m, a = [];
    while ((m = re.exec(txt))) a.push(+m[1], +m[2], +m[3]);
    if (!a.length || a.length % 9) throw new Error('Não consegui ler esse STL. O arquivo pode estar corrompido.');
    return new Float32Array(a);
  }

  function mul(a, b) { // matrizes 3x4 (linha a linha, 3MF usa coluna-maior em transform: m00 m01 m02 m10 ... m30 m31 m32)
    return [
      a[0] * b[0] + a[1] * b[3] + a[2] * b[6], a[0] * b[1] + a[1] * b[4] + a[2] * b[7], a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
      a[3] * b[0] + a[4] * b[3] + a[5] * b[6], a[3] * b[1] + a[4] * b[4] + a[5] * b[7], a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
      a[6] * b[0] + a[7] * b[3] + a[8] * b[6], a[6] * b[1] + a[7] * b[4] + a[8] * b[7], a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
      a[9] * b[0] + a[10] * b[3] + a[11] * b[6] + b[9], a[9] * b[1] + a[10] * b[4] + a[11] * b[7] + b[10], a[9] * b[2] + a[10] * b[5] + a[11] * b[8] + b[11]
    ];
  }
  var ID = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
  function parseT(s) { if (!s) return ID; var a = s.trim().split(/\s+/).map(Number); return a.length === 12 ? a : ID; }

  // 3MF de qualquer programa: junta todas as malhas com suas transformações (sem DOM, roda em segundo plano)
  function attrs(tag) { var o = {}, m, re = /([\w:]+)\s*=\s*"([^"]*)"/g; while ((m = re.exec(tag))) o[m[1]] = m[2]; return o; }
  function parse3MFMeshes(zip) {
    var rootFile = zip.file('3D/3dmodel.model') || zip.file(/\.model$/i)[0];
    if (!rootFile) return Promise.reject(new Error('Esse .3mf não tem modelo 3D dentro.'));
    var docs = {}, chunks = [], items = 0;
    function load(path) {
      path = path.replace(/^\//, '');
      if (docs[path]) return Promise.resolve(docs[path]);
      var f = zip.file(path); if (!f) return Promise.reject(new Error('Parte do modelo não encontrada: ' + path));
      return f.async('string').then(function (t) {
        var objs = {}, re = /<object\b([^>]*)>([\s\S]*?)<\/object>/g, m;
        while ((m = re.exec(t))) objs[attrs(m[1]).id] = m[2];
        docs[path] = { text: t, objs: objs }; return docs[path];
      });
    }
    function meshOf(body, T) {
      var vs = body.match(/<vertex\b[^>]*\/>/g) || [], V = new Float64Array(vs.length * 3), i, a;
      for (i = 0; i < vs.length; i++) {
        a = attrs(vs[i]); var x = +a.x, y = +a.y, z = +a.z;
        V[i * 3] = x * T[0] + y * T[3] + z * T[6] + T[9]; V[i * 3 + 1] = x * T[1] + y * T[4] + z * T[7] + T[10]; V[i * 3 + 2] = x * T[2] + y * T[5] + z * T[8] + T[11];
      }
      var ts = body.match(/<triangle\b[^>]*\/>/g) || [], tri = new Float32Array(ts.length * 9);
      for (i = 0; i < ts.length; i++) {
        a = attrs(ts[i]); var p = [+a.v1, +a.v2, +a.v3];
        for (var k = 0; k < 3; k++) { tri[i * 9 + k * 3] = V[p[k] * 3]; tri[i * 9 + k * 3 + 1] = V[p[k] * 3 + 1]; tri[i * 9 + k * 3 + 2] = V[p[k] * 3 + 2]; }
      }
      return tri;
    }
    function walk(path, id, T) {
      return load(path).then(function (doc) {
        var body = doc.objs[id]; if (body == null) return;
        if (/<mesh\b/.test(body)) chunks.push(meshOf(body, T));
        var comps = body.match(/<component\b[^>]*\/?>/g) || [], jobs = [];
        comps.forEach(function (c) { var a = attrs(c); jobs.push(walk(a['p:path'] || path, a.objectid, mul(parseT(a.transform), T))); });
        return Promise.all(jobs);
      });
    }
    var rootPath = rootFile.name;
    return load(rootPath).then(function (doc) {
      var build = (doc.text.match(/<build\b[\s\S]*?<\/build>/) || [''])[0], its = build.match(/<item\b[^>]*\/?>/g) || [], jobs = [];
      its.forEach(function (it) { var a = attrs(it); if (a.printable === '0') return; items++; jobs.push(walk(rootPath, a.objectid, parseT(a.transform))); });
      return Promise.all(jobs);
    }).then(function () {
      var total = chunks.reduce(function (s, c) { return s + c.length; }, 0), out = new Float32Array(total), o = 0;
      chunks.forEach(function (c) { out.set(c, o); o += c.length; });
      if (!total) throw new Error('Não encontrei nenhuma malha no 3MF.');
      return { tri: out, objects: items };
    });
  }

  /* ---------- análise ---------- */
  function rotFromTo(n) { // rotação que leva o vetor n para (0,0,-1)
    var x = n[0], y = n[1], z = n[2], t = [0, 0, -1];
    var c = -z, ax = [y * t[2] - z * t[1], z * t[0] - x * t[2], x * t[1] - y * t[0]];
    var s = Math.hypot(ax[0], ax[1], ax[2]);
    if (s < 1e-9) return c > 0 ? [1, 0, 0, 0, 1, 0, 0, 0, 1] : [1, 0, 0, 0, -1, 0, 0, 0, -1];
    ax = [ax[0] / s, ax[1] / s, ax[2] / s];
    var C = 1 - c, a = ax[0], b = ax[1], d = ax[2];
    return [c + a * a * C, a * b * C - d * s, a * d * C + b * s,
      b * a * C + d * s, c + b * b * C, b * d * C - a * s,
      d * a * C - b * s, d * b * C + a * s, c + d * d * C];
  }

  function faceData(tri) {
    var n = tri.length / 9, N = new Float32Array(n * 3), A = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var o = i * 9, ux = tri[o + 3] - tri[o], uy = tri[o + 4] - tri[o + 1], uz = tri[o + 5] - tri[o + 2];
      var vx = tri[o + 6] - tri[o], vy = tri[o + 7] - tri[o + 1], vz = tri[o + 8] - tri[o + 2];
      var cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx, l = Math.hypot(cx, cy, cz);
      A[i] = l / 2; if (l > 0) { N[i * 3] = cx / l; N[i * 3 + 1] = cy / l; N[i * 3 + 2] = cz / l; }
    }
    return { N: N, A: A };
  }

  function evaluate(tri, fd, R) {
    var n = fd.A.length, zmin = Infinity, zmax = -Infinity, r6 = R[6], r7 = R[7], r8 = R[8], i, z;
    for (i = 0; i < tri.length; i += 3) { z = r6 * tri[i] + r7 * tri[i + 1] + r8 * tri[i + 2]; if (z < zmin) zmin = z; if (z > zmax) zmax = z; }
    var step = Math.max(1, Math.floor(n / 80000)), over = 0, base = 0, total = 0;
    for (var f = 0; f < n; f += step) {
      var nz = r6 * fd.N[f * 3] + r7 * fd.N[f * 3 + 1] + r8 * fd.N[f * 3 + 2], a = fd.A[f] * step, o = f * 9;
      var z0 = r6 * tri[o] + r7 * tri[o + 1] + r8 * tri[o + 2], z1 = r6 * tri[o + 3] + r7 * tri[o + 4] + r8 * tri[o + 5], z2 = r6 * tri[o + 6] + r7 * tri[o + 7] + r8 * tri[o + 8];
      var lo = Math.min(z0, z1, z2), hi = Math.max(z0, z1, z2);
      total += a;
      if (nz < -0.985 && hi - zmin < 0.3) base += a;
      else if (nz < -0.7071 && lo - zmin > 0.3) over += a;
    }
    return { over: over, base: base, total: total, height: zmax - zmin };
  }

  function analyze(tri, opts) {
    opts = opts || {};
    var fd = faceData(tri), n = fd.A.length;
    // candidatas: 6 lados + as 8 maiores faces planas
    // candidatas: 6 lados + as 10 maiores faces planas (direção exata = média das normais da face, ponderada pela área)
    var cands = [[0, 0, -1], [0, 0, 1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]], bins = {};
    for (var i = 0; i < n; i++) {
      var k = Math.round(fd.N[i * 3] * 40) + ',' + Math.round(fd.N[i * 3 + 1] * 40) + ',' + Math.round(fd.N[i * 3 + 2] * 40);
      var b0 = bins[k] || (bins[k] = { a: 0, x: 0, y: 0, z: 0 }), ai = fd.A[i];
      b0.a += ai; b0.x += fd.N[i * 3] * ai; b0.y += fd.N[i * 3 + 1] * ai; b0.z += fd.N[i * 3 + 2] * ai;
    }
    Object.keys(bins).sort(function (a, b) { return bins[b].a - bins[a].a; }).slice(0, 10).forEach(function (k) {
      var b1 = bins[k], l = Math.hypot(b1.x, b1.y, b1.z); if (l > 0) cands.push([b1.x / l, b1.y / l, b1.z / l]);
    });
    var orig = evaluate(tri, fd, [1, 0, 0, 0, 1, 0, 0, 0, 1]), best = null, list = [];
    if (opts.keepOrientation) best = { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], e: orig };
    else cands.forEach(function (c) {
      var R = rotFromTo(c), e = evaluate(tri, fd, R);
      list.push({ c: c.map(function (x) { return +x.toFixed(2); }), over: Math.round(e.over), base: Math.round(e.base), h: Math.round(e.height) });
      if (e.base < Math.max(20, 0.004 * e.total)) return; // precisa de base apoiada de verdade
      var score = e.over - 0.5 * e.base + 0.02 * e.height * Math.sqrt(e.total);
      if (!best || score < best.score) best = { R: R, e: e, score: score };
    });
    // se a posição original do criador já é boa, mantém (ele pode ter motivo: acabamento, resistência)
    if (best && !opts.keepOrientation && orig.base >= Math.max(20, 0.004 * orig.total)) {
      var so = orig.over - 0.5 * orig.base + 0.02 * orig.height * Math.sqrt(orig.total);
      if (so <= best.score + 0.08 * Math.abs(best.score) + 0.01 * orig.total) best = { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], e: orig, score: so };
    }
    if (!best) best = { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], e: orig };
    // aplica a rotação e mede tamanho e volume
    var out = new Float32Array(tri.length), mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity], vol = 0;
    var R = best.R;
    for (var t = 0; t < tri.length; t += 3) {
      var x = tri[t], y = tri[t + 1], z = tri[t + 2];
      var X = R[0] * x + R[1] * y + R[2] * z, Y = R[3] * x + R[4] * y + R[5] * z, Z = R[6] * x + R[7] * y + R[8] * z;
      out[t] = X; out[t + 1] = Y; out[t + 2] = Z;
      if (X < mn[0]) mn[0] = X; if (X > mx[0]) mx[0] = X; if (Y < mn[1]) mn[1] = Y; if (Y > mx[1]) mx[1] = Y; if (Z < mn[2]) mn[2] = Z; if (Z > mx[2]) mx[2] = Z;
    }
    for (var f = 0; f < out.length; f += 9) {
      vol += (out[f] * (out[f + 4] * out[f + 8] - out[f + 5] * out[f + 7]) - out[f + 1] * (out[f + 3] * out[f + 8] - out[f + 5] * out[f + 6]) + out[f + 2] * (out[f + 3] * out[f + 7] - out[f + 4] * out[f + 6])) / 6;
    }
    var size = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
    return { tri: out, min: mn, max: mx, size: size, volume: Math.abs(vol), triangles: n,
      before: orig, after: best.e, candidates: list, rotated: !opts.keepOrientation && best.R.join() !== '1,0,0,0,1,0,0,0,1' };
  }

  /* ---------- escrita de um projeto novo ---------- */
  // posições em grade para várias cópias, centralizadas na mesa
  function gridPositions(size, bx, by, copies, gap) {
    var w = size[0] + gap, d = size[1] + gap;
    var cols = Math.max(1, Math.floor((bx + gap) / w)), rows = Math.max(1, Math.floor((by + gap) / d));
    var n = Math.max(1, Math.min(copies || 1, cols * rows));
    var c = Math.min(cols, Math.ceil(Math.sqrt(n))), r = Math.ceil(n / c), out = [];
    for (var i = 0; i < n; i++) {
      var ci = i % c, ri = Math.floor(i / c);
      out.push([bx / 2 + (ci - (c - 1) / 2) * w, by / 2 + (ri - (r - 1) / 2) * d]);
    }
    return out;
  }

  function buildModelParts(tri, centers, appVersion) {
    var map = new Map(), V = [], T = new Uint32Array(tri.length / 3), idx, key, q = 1e4;
    for (var i = 0, t = 0; i < tri.length; i += 3, t++) {
      key = Math.round(tri[i] * q) + '_' + Math.round(tri[i + 1] * q) + '_' + Math.round(tri[i + 2] * q);
      idx = map.get(key);
      if (idx === undefined) { idx = V.length / 3; map.set(key, idx); V.push(tri[i], tri[i + 1], tri[i + 2]); }
      T[t] = idx;
    }
    map = null;
    var parts = ['<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021">\n' +
      ' <metadata name="Application">BambuStudio-' + appVersion + '</metadata>\n <metadata name="BambuStudio:3mfVersion">1</metadata>\n <metadata name="Title">Big Insane 3D</metadata>\n' +
      ' <resources>\n  <object id="1" type="model">\n   <mesh>\n    <vertices>\n'];
    var buf = [];
    for (var v = 0; v < V.length; v += 3) {
      buf.push('<vertex x="' + Math.round(V[v] * 1e5) / 1e5 + '" y="' + Math.round(V[v + 1] * 1e5) / 1e5 + '" z="' + Math.round(V[v + 2] * 1e5) / 1e5 + '"/>');
      if (buf.length === 20000) { parts.push(buf.join('\n') + '\n'); buf = []; }
    }
    parts.push(buf.join('\n') + '\n    </vertices>\n    <triangles>\n'); buf = [];
    for (var k = 0; k < T.length; k += 3) {
      if (T[k] !== T[k + 1] && T[k + 1] !== T[k + 2] && T[k] !== T[k + 2]) buf.push('<triangle v1="' + T[k] + '" v2="' + T[k + 1] + '" v3="' + T[k + 2] + '"/>');
      if (buf.length === 20000) { parts.push(buf.join('\n') + '\n'); buf = []; }
    }
    parts.push(buf.join('\n') + '\n    </triangles>\n   </mesh>\n  </object>\n </resources>\n' +
      ' <build>\n' + centers.map(function (c) { return '  <item objectid="1" transform="1 0 0 0 1 0 0 0 1 ' + c[0].toFixed(3) + ' ' + c[1].toFixed(3) + ' 0" printable="1"/>'; }).join('\n') + '\n </build>\n</model>\n');
    return parts;
  }

  function newProject(an, cfg, name, appVersion, copies) {
    // centraliza a peça na mesa, apoiada em z = 0
    var area = (cfg.printable_area || ['0x0', '256x0', '256x256', '0x256']).map(function (p) { return p.split('x').map(Number); });
    var bx = Math.max.apply(null, area.map(function (p) { return p[0]; })), by = Math.max.apply(null, area.map(function (p) { return p[1]; }));
    var cx = (an.min[0] + an.max[0]) / 2, cy = (an.min[1] + an.max[1]) / 2;
    var tri = new Float32Array(an.tri.length);
    for (var i = 0; i < tri.length; i += 3) { tri[i] = an.tri[i] - cx; tri[i + 1] = an.tri[i + 1] - cy; tri[i + 2] = an.tri[i + 2] - an.min[2]; }
    var zip = new JSZip(), safe = String(name || 'peca').replace(/[<>&"]/g, '');
    zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n <Default Extension="png" ContentType="image/png"/>\n <Default Extension="gcode" ContentType="text/x.gcode"/>\n</Types>\n');
    zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n</Relationships>\n');
    var centers = gridPositions(an.size, bx, by, copies, 8);
    an.copies = centers.length; an.centers = centers; an.centeredTri = tri; an.bed = [bx, by];
    zip.file('3D/3dmodel.model', new Blob(buildModelParts(tri, centers, appVersion || '2.0.0.3')));
    zip.file('Metadata/model_settings.config', '<?xml version="1.0" encoding="UTF-8"?>\n<config>\n  <object id="1">\n    <metadata key="name" value="' + safe + '"/>\n    <metadata key="extruder" value="1"/>\n    <part id="1" subtype="normal_part">\n      <metadata key="name" value="' + safe + '"/>\n      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>\n    </part>\n  </object>\n  <plate>\n    <metadata key="plater_id" value="1"/>\n    <metadata key="plater_name" value=""/>\n    <metadata key="locked" value="false"/>\n' + centers.map(function (c, i) { return '    <model_instance>\n      <metadata key="object_id" value="1"/>\n      <metadata key="instance_id" value="' + i + '"/>\n    </model_instance>\n'; }).join('') + '  </plate>\n</config>\n');
    zip.file('Metadata/project_settings.config', JSON.stringify(cfg, null, 4));
    return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 }, mimeType: 'model/3mf' });
  }

  // só o tamanho ocupado na mesa (rápido: lê os vértices sem montar triângulos)
  function parse3MFBounds(zip) {
    var rootFile = zip.file('3D/3dmodel.model');
    if (!rootFile) return Promise.reject(new Error('Esse .3mf não tem modelo 3D dentro.'));
    var docs = {}, b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    function load(path) {
      path = path.replace(/^\//, '');
      if (docs[path]) return Promise.resolve(docs[path]);
      var f = zip.file(path); if (!f) return Promise.reject(new Error('Parte do modelo não encontrada: ' + path));
      return f.async('string').then(function (t) {
        var objs = {}, re = /<object\b([^>]*)>([\s\S]*?)<\/object>/g, m;
        while ((m = re.exec(t))) objs[attrs(m[1]).id] = m[2];
        docs[path] = { text: t, objs: objs }; return docs[path];
      });
    }
    function walk(path, id, T) {
      return load(path).then(function (doc) {
        var body = doc.objs[id]; if (body == null) return;
        var re = /<vertex\s+x="([^"]+)"\s+y="([^"]+)"\s+z="([^"]+)"/g, m;
        while ((m = re.exec(body))) {
          var x = +m[1], y = +m[2], z = +m[3];
          var X = x * T[0] + y * T[3] + z * T[6] + T[9], Y = x * T[1] + y * T[4] + z * T[7] + T[10];
          if (X < b.minX) b.minX = X; if (X > b.maxX) b.maxX = X; if (Y < b.minY) b.minY = Y; if (Y > b.maxY) b.maxY = Y;
        }
        var comps = body.match(/<component\b[^>]*\/?>/g) || [], jobs = [];
        comps.forEach(function (c) { var a = attrs(c); jobs.push(walk(a['p:path'] || path, a.objectid, mul(parseT(a.transform), T))); });
        return Promise.all(jobs);
      });
    }
    var rootPath = rootFile.name;
    return load(rootPath).then(function (doc) {
      var build = (doc.text.match(/<build\b[\s\S]*?<\/build>/) || [''])[0], its = build.match(/<item\b[^>]*\/?>/g) || [], jobs = [];
      its.forEach(function (it) { var a = attrs(it); if (a.printable === '0') return; jobs.push(walk(rootPath, a.objectid, parseT(a.transform))); });
      return Promise.all(jobs);
    }).then(function () { if (!isFinite(b.minX)) throw new Error('Não encontrei a peça no 3MF.'); return b; });
  }

  // centraliza em x/y e apoia em z = 0
  function centerOnBed(tri) {
    var mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity], i, a;
    for (i = 0; i < tri.length; i += 3) for (a = 0; a < 3; a++) { if (tri[i + a] < mn[a]) mn[a] = tri[i + a]; if (tri[i + a] > mx[a]) mx[a] = tri[i + a]; }
    var cx = (mn[0] + mx[0]) / 2, cy = (mn[1] + mx[1]) / 2, out = new Float32Array(tri.length);
    for (i = 0; i < tri.length; i += 3) { out[i] = tri[i] - cx; out[i + 1] = tri[i + 1] - cy; out[i + 2] = tri[i + 2] - mn[2]; }
    return { tri: out, size: [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]] };
  }

  // organiza em prateleiras; abre outra mesa quando não cabe
  function packPlates(sizes, bx, by, gap) {
    var order = sizes.map(function (s, i) { return i; }).sort(function (a, b) { return sizes[b][1] - sizes[a][1]; });
    var plates = [], cur = null;
    function newPlate() { cur = { items: [], x: gap, y: gap, rowH: 0 }; plates.push(cur); }
    newPlate();
    order.forEach(function (i) {
      var w = sizes[i][0], d = sizes[i][1];
      if (cur.x + w > bx - gap + 0.01) { cur.x = gap; cur.y += cur.rowH + gap; cur.rowH = 0; }
      if (cur.y + d > by - gap + 0.01) { newPlate(); }
      cur.items.push({ i: i, x: cur.x + w / 2, y: cur.y + d / 2 });
      cur.x += w + gap; if (d > cur.rowH) cur.rowH = d;
    });
    // centraliza o conjunto de cada mesa
    plates.forEach(function (p) {
      var minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
      p.items.forEach(function (it) { var s = sizes[it.i]; minx = Math.min(minx, it.x - s[0] / 2); maxx = Math.max(maxx, it.x + s[0] / 2); miny = Math.min(miny, it.y - s[1] / 2); maxy = Math.max(maxy, it.y + s[1] / 2); });
      var dx = bx / 2 - (minx + maxx) / 2, dy = by / 2 - (miny + maxy) / 2;
      p.items.forEach(function (it) { it.x += dx; it.y += dy; });
    });
    return plates.map(function (p) { return p.items; });
  }

  function meshParts(tri, id, out) {
    var map = new Map(), V = [], T = new Uint32Array(tri.length / 3), q = 1e4, idx, key;
    for (var i = 0, t = 0; i < tri.length; i += 3, t++) {
      key = Math.round(tri[i] * q) + '_' + Math.round(tri[i + 1] * q) + '_' + Math.round(tri[i + 2] * q);
      idx = map.get(key); if (idx === undefined) { idx = V.length / 3; map.set(key, idx); V.push(tri[i], tri[i + 1], tri[i + 2]); }
      T[t] = idx;
    }
    map = null;
    out.push('  <object id="' + id + '" type="model">\n   <mesh>\n    <vertices>\n');
    var buf = [];
    for (var v = 0; v < V.length; v += 3) {
      buf.push('<vertex x="' + Math.round(V[v] * 1e5) / 1e5 + '" y="' + Math.round(V[v + 1] * 1e5) / 1e5 + '" z="' + Math.round(V[v + 2] * 1e5) / 1e5 + '"/>');
      if (buf.length === 20000) { out.push(buf.join('\n') + '\n'); buf = []; }
    }
    out.push(buf.join('\n') + '\n    </vertices>\n    <triangles>\n'); buf = [];
    for (var k = 0; k < T.length; k += 3) {
      if (T[k] !== T[k + 1] && T[k + 1] !== T[k + 2] && T[k] !== T[k + 2]) buf.push('<triangle v1="' + T[k] + '" v2="' + T[k + 1] + '" v3="' + T[k + 2] + '"/>');
      if (buf.length === 20000) { out.push(buf.join('\n') + '\n'); buf = []; }
    }
    out.push(buf.join('\n') + '\n    </triangles>\n   </mesh>\n  </object>\n');
  }

  /* objs: [{ tri (centralizado), x, y, name }] */
  function newProjectMulti(objs, cfg, appVersion) {
    var parts = ['<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021">\n' +
      ' <metadata name="Application">BambuStudio-' + (appVersion || '2.0.0.3') + '</metadata>\n <metadata name="BambuStudio:3mfVersion">1</metadata>\n <metadata name="Title">Big Insane 3D</metadata>\n <resources>\n'];
    objs.forEach(function (o, i) { meshParts(o.tri, i + 1, parts); });
    parts.push(' </resources>\n <build>\n' + objs.map(function (o, i) { return '  <item objectid="' + (i + 1) + '" transform="1 0 0 0 1 0 0 0 1 ' + o.x.toFixed(3) + ' ' + o.y.toFixed(3) + ' 0" printable="1"/>'; }).join('\n') + '\n </build>\n</model>\n');
    var ms = '<?xml version="1.0" encoding="UTF-8"?>\n<config>\n' + objs.map(function (o, i) {
      var nm = String(o.name).replace(/[<>&"]/g, '');
      return '  <object id="' + (i + 1) + '">\n    <metadata key="name" value="' + nm + '"/>\n    <metadata key="extruder" value="1"/>\n    <part id="1" subtype="normal_part">\n      <metadata key="name" value="' + nm + '"/>\n      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>\n    </part>\n  </object>\n';
    }).join('') + '  <plate>\n    <metadata key="plater_id" value="1"/>\n    <metadata key="plater_name" value=""/>\n    <metadata key="locked" value="false"/>\n' +
      objs.map(function (o, i) { return '    <model_instance>\n      <metadata key="object_id" value="' + (i + 1) + '"/>\n      <metadata key="instance_id" value="0"/>\n    </model_instance>\n'; }).join('') + '  </plate>\n</config>\n';
    var zip = new JSZip();
    zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n <Default Extension="png" ContentType="image/png"/>\n <Default Extension="gcode" ContentType="text/x.gcode"/>\n</Types>\n');
    zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n</Relationships>\n');
    zip.file('3D/3dmodel.model', new Blob(parts));
    zip.file('Metadata/model_settings.config', ms);
    zip.file('Metadata/project_settings.config', JSON.stringify(cfg, null, 4));
    return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 }, mimeType: 'model/3mf' });
  }

  root.BI3D_MALHA = { centerOnBed: centerOnBed, packPlates: packPlates, newProjectMulti: newProjectMulti, parseSTL: parseSTL, parse3MFMeshes: parse3MFMeshes, parse3MFBounds: parse3MFBounds, analyze: analyze, newProject: newProject };
})(this);
