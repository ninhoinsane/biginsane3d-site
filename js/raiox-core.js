/* Big Insane 3D · Raio-X do G-code · motor de análise
   Roda 100% no navegador. Nenhum dado sai do computador. */
(function (root) {
  'use strict';

  var FLOW_BIN = 0.5, FLOW_BINS = 160; // histograma de fluxo: 0 a 80 mm³/s

  function RaioX(opts) {
    opts = opts || {};
    this.area = Math.PI * Math.pow((opts.diam || 1.75) / 2, 2);
    this.xyzAbs = true; this.eRel = false; this.eModeSet = false;
    this.x = 0; this.y = 0; this.z = 0; this.e = 0; this.f = 0;
    this.feature = 'Sem tipo'; this.tool = null; this.toolChanges = 0; this.toolsUsed = {};
    this.layers = 0; this.lines = 0;
    this.features = {};
    this.hist = new Float64Array(FLOW_BINS);
    this.extrTime = 0; this.extrVol = 0; this.travelLen = 0;
    this.statPos = 0; this.retracted = 0; this.retracts = 0; this.maxRetract = 0;
    this.primeVol = 0;
    this.maxNozzle = 0; this.maxBed = 0; this.maxFan = 0;
    this.config = {}; this.header = {};
    this.comments = { est: null, grams: null, gramsList: null };
  }

  RaioX.prototype.feat = function (name) {
    var f = this.features[name];
    if (!f) f = this.features[name] = { time: 0, len: 0, vol: 0, maxFlow: 0, hist: new Float64Array(FLOW_BINS) };
    return f;
  };

  var PARAM = /([A-Z])(-?\d*\.?\d+(?:[eE][-+]?\d+)?)/g;

  RaioX.prototype.line = function (raw) {
    this.lines++;
    var s = raw.trim();
    if (!s) return;
    if (s.charCodeAt(0) === 59) { this.comment(s.slice(1).trim()); return; }
    var sc = s.indexOf(';');
    var code = (sc >= 0 ? s.slice(0, sc) : s).trim();
    if (!code) return;
    var sp = code.indexOf(' ');
    var cmd = (sp >= 0 ? code.slice(0, sp) : code).toUpperCase();
    var rest = sp >= 0 ? code.slice(sp + 1).toUpperCase() : '';

    if (cmd === 'G1' || cmd === 'G0' || cmd === 'G2' || cmd === 'G3') { this.move(cmd, rest); return; }
    if (cmd === 'G92') {
      var m = /E(-?\d*\.?\d+)/.exec(rest); if (m) this.e = parseFloat(m[1]);
      return;
    }
    if (cmd === 'M82') { this.eRel = false; this.eModeSet = true; return; }
    if (cmd === 'M83') { this.eRel = true; this.eModeSet = true; return; }
    if (cmd === 'G90') { this.xyzAbs = true; if (!this.eModeSet) this.eRel = false; return; }
    if (cmd === 'G91') { this.xyzAbs = false; if (!this.eModeSet) this.eRel = true; return; }
    if (cmd === 'M104' || cmd === 'M109') { var t = /S(\d+\.?\d*)/.exec(rest); if (t) this.maxNozzle = Math.max(this.maxNozzle, +t[1]); return; }
    if (cmd === 'M140' || cmd === 'M190') { var b = /S(\d+\.?\d*)/.exec(rest); if (b) this.maxBed = Math.max(this.maxBed, +b[1]); return; }
    if (cmd === 'M106') {
      var fp = /P(\d+)/.exec(rest); if (fp && +fp[1] > 1) return; // P2/P3 = ventoinha auxiliar ou da câmara
      var fs = /S(\d+\.?\d*)/.exec(rest); if (fs) this.maxFan = Math.max(this.maxFan, Math.min(100, (+fs[1]) / 2.55)); return;
    }
    if (/^T\d+$/.test(cmd)) {
      var n = +cmd.slice(1);
      if (n > 15) return; // T255 e similares não são troca de filamento
      if (this.tool !== null && n !== this.tool) this.toolChanges++;
      this.tool = n; this.toolsUsed[n] = true;
    }
  };

  RaioX.prototype.move = function (cmd, rest) {
    var p = {}, m;
    PARAM.lastIndex = 0;
    while ((m = PARAM.exec(rest))) p[m[1]] = parseFloat(m[2]);
    if (p.F > 0) this.f = p.F;
    var nx = 'X' in p ? (this.xyzAbs ? p.X : this.x + p.X) : this.x;
    var ny = 'Y' in p ? (this.xyzAbs ? p.Y : this.y + p.Y) : this.y;
    var nz = 'Z' in p ? (this.xyzAbs ? p.Z : this.z + p.Z) : this.z;
    var de = 0;
    if ('E' in p) {
      if (this.eRel) de = p.E; else { de = p.E - this.e; this.e = p.E; }
    }
    var dx = nx - this.x, dy = ny - this.y, dz = nz - this.z, len;
    if ((cmd === 'G2' || cmd === 'G3') && ('I' in p || 'J' in p)) {
      var cx = this.x + (p.I || 0), cy = this.y + (p.J || 0);
      var r = Math.hypot(this.x - cx, this.y - cy);
      var a0 = Math.atan2(this.y - cy, this.x - cx), a1 = Math.atan2(ny - cy, nx - cx);
      var da = a1 - a0;
      if (cmd === 'G2') { if (da >= 0) da -= 2 * Math.PI; } else { if (da <= 0) da += 2 * Math.PI; }
      len = Math.hypot(Math.abs(da) * r, dz);
    } else {
      len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    this.x = nx; this.y = ny; this.z = nz;

    if (de < 0) { // retração (parada ou durante o movimento/wipe)
      this.retracted += -de;
      if (len <= 1e-4) { this.retracts++; }
      if (-de > this.maxRetract && -de < 50) this.maxRetract = -de;
      if (len > 1e-4) this.travelLen += len;
      return;
    }
    if (len > 1e-4) {
      if (de > 0 && this.f > 0) {
        var t = len / (this.f / 60), vol = de * this.area, flow = vol / t;
        var bin = Math.min(FLOW_BINS - 1, Math.floor(flow / FLOW_BIN));
        this.retracted = 0;
        var ft = this.feat(this.feature);
        ft.time += t; ft.len += len; ft.vol += vol; ft.hist[bin] += t;
        if (flow > ft.maxFlow) ft.maxFlow = flow;
        this.hist[bin] += t; this.extrTime += t; this.extrVol += vol;
        if (/prime|wipe tower|torre/i.test(this.feature)) this.primeVol += vol;
      } else {
        this.travelLen += len;
      }
    } else if (de > 0) {
      // extrusão com o bico parado: primeiro devolve o que foi retraído, o resto é purga
      var back = Math.min(de, this.retracted);
      this.retracted -= back;
      this.statPos += de - back;
    }
  };

  RaioX.prototype.comment = function (c) {
    var m;
    if ((m = /^(?:TYPE|FEATURE)\s*:\s*(.+)$/i.exec(c))) { this.feature = m[1].trim(); return; }
    if (c === 'LAYER_CHANGE' || c === 'CHANGE_LAYER') { this.layers++; return; }
    if ((m = /estimated printing time \(normal mode\)\s*=\s*(.+)/i.exec(c))) { this.comments.est = m[1]; return; }
    if ((m = /total estimated time\s*:\s*([^;]+)/i.exec(c))) { this.comments.est = m[1]; return; }
    if ((m = /^total filament (?:used|weight) \[g\]\s*[:=]\s*(.+)/i.exec(c))) { this.comments.grams = m[1]; return; }
    if ((m = /^filament used \[g\]\s*[:=]\s*(.+)/i.exec(c))) { this.comments.gramsList = m[1]; return; }
    if ((m = /^([a-z0-9_]+)\s*=\s*(.*)$/i.exec(c))) {
      if (m[2].length < 400) this.config[m[1]] = m[2].trim();
      return;
    }
    if ((m = /^(.+?)\s*[:=]\s*(.+)$/.exec(c))) {
      var k = m[1].trim().toLowerCase(), v = m[2].trim();
      if (k.length < 60 && v.length < 400) this.header[k] = v;
    }
  };

  function parseDur(s) {
    if (!s) return null;
    var t = 0, m, re = /(\d+(?:\.\d+)?)\s*([dhms])/g, ok = false;
    while ((m = re.exec(s))) { ok = true; t += (+m[1]) * ({ d: 86400, h: 3600, m: 60, s: 1 })[m[2]]; }
    return ok ? t : null;
  }
  function firstNums(s) {
    if (!s) return null;
    var a = String(s).split(/[,;]/).map(function (x) { return parseFloat(x); }).filter(function (x) { return isFinite(x); });
    return a.length ? a : null;
  }

  RaioX.prototype.finish = function () {
    var cfg = this.config, hd = this.header;
    // tempo estimado pelo fatiador
    var est = parseDur(this.comments.est);
    if (!est) for (var k in hd) if (/estimated (printing )?time|printing time/.test(k)) { est = parseDur(String(hd[k]).split(';')[0]); if (est) break; }
    // filamento em gramas
    var g = firstNums(this.comments.grams) || firstNums(this.comments.gramsList);
    var grams = g ? g.reduce(function (a, b) { return a + b; }, 0) : null;

    var layers = this.layers || +(hd['total layer number'] || hd['total layers count'] || 0) || null;

    // purga: extrusão parada (líquida) + torre de purga
    var statNet = this.statPos * this.area;
    var feats = [];
    for (var name in this.features) {
      var f = this.features[name];
      feats.push({ name: name, time: f.time, len: f.len, vol: f.vol, maxFlow: f.maxFlow,
        avgFlow: f.time ? f.vol / f.time : 0, cross: f.len ? f.vol / f.len : 0, hist: Array.prototype.slice.call(f.hist) });
    }
    feats.sort(function (a, b) { return b.time - a.time; });
    var tools = Object.keys(this.toolsUsed).map(Number).sort();
    return {
      lines: this.lines, layers: layers, estSeconds: est, grams: grams,
      extrTime: this.extrTime, extrVol: this.extrVol, travelLen: this.travelLen,
      hist: Array.prototype.slice.call(this.hist), binSize: FLOW_BIN,
      features: feats, toolChanges: this.toolChanges, tools: tools,
      stationaryVol: statNet, primeVol: this.primeVol,
      retracts: this.retracts, maxRetract: this.maxRetract,
      maxNozzle: this.maxNozzle, maxBed: this.maxBed, maxFan: this.maxFan,
      config: cfg, header: hd
    };
  };

  root.RaioX = RaioX;
})(typeof self !== 'undefined' ? self : this);
