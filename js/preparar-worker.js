/* Big Insane 3D · Preparador · trabalho pesado em segundo plano (a página não trava) */
importScripts('earcut.min.js?v=20261009e', 'cortar.js?v=20261009e', 'jszip.min.js?v=20261009e', 'preparar-core.js?v=20261009e', 'malha.js?v=20261009e');

// indica o melhor encaixe para a peça
function BI3D_CORTE_REC(sp, opts) {
  var minArea = Math.min.apply(null, sp.cuts.map(function (c) { return c.area; }));
  if (minArea < 300) return 'a seção do corte é pequena; só cola funciona melhor aqui.';
  if (opts.goal === 'funcional') return minArea > 2500 ? 'vareta de metal de 4 ou 5 mm + cola: é a junção mais forte para peça grande que leva esforço.' : 'pinos + cola. É a junção mais forte nesse tamanho; ímã não aguenta esforço.';
  if (opts.connector === 'imas') return 'ímãs são ótimos para peças que você quer desmontar (transporte, pintura). Para ficar firme de vez, use pinos + cola.';
  return 'pinos + cola para peça fixa. Se quiser desmontar para transportar ou pintar, gere de novo com ímãs' + (minArea > 1500 ? ' de 10 × 3 mm.' : ' de 6 × 3 mm.');
}

// divide, gira cada parte para a melhor posição, organiza nas mesas e monta um projeto por mesa
function splitFlow(an, r, warn, name, tpl, opts, bed) {
  var sp = BI3D_CORTE.split(an.tri, bed, { connector: opts.connector || 'auto', magnet: opts.magnet, rod: opts.rod });
  an.tri = null;
  var base = name.replace(/\.[^.]+$/, ''), objs = [];
  sp.parts.forEach(function (p, i) {
    step('Posicionando a parte ' + (i + 1) + ' de ' + sp.parts.length + '…', 0.55 + 0.25 * i / sp.parts.length);
    var a2 = BI3D_MALHA.analyze(p, { keepOrientation: !!(sp.pegParts && sp.pegParts[i]) }), c = BI3D_MALHA.centerOnBed(a2.tri);
    objs.push({ tri: c.tri, size: c.size, name: base + ' - parte ' + (i + 1), kind: 'parte' });
  });
  sp.pins.forEach(function (p, i) { var c = BI3D_MALHA.centerOnBed(p); objs.push({ tri: c.tri, size: c.size, name: 'pino ' + (i + 1), kind: 'pino' }); });
  var tooBig = objs.filter(function (o) { return o.size[2] > bed[2] || Math.min(o.size[0], o.size[1]) > Math.min(bed[0], bed[1]) || Math.max(o.size[0], o.size[1]) > Math.max(bed[0], bed[1]); });
  if (tooBig.length) warn.push('Alguma parte ainda ficou maior que a mesa depois de girar. Confira no fatiador.');
  var plates = BI3D_MALHA.packPlates(objs.map(function (o) { return o.size; }), bed[0], bed[1], 8);
  r.changes.push('Peça dividida em ' + sp.parts.length + ' partes (' + sp.cuts.length + ' corte' + (sp.cuts.length > 1 ? 's' : '') + ')');
  var nPin = 0, nMag = 0, nGlue = 0, nPeg = 0, nRod = 0, rodSpec = null;
  sp.cuts.forEach(function (c) {
    if (c.kind === 'pinos') nPin += c.count; else if (c.kind === 'imas') nMag += c.count;
    else if (c.kind === 'macho') nPeg += c.count; else if (c.kind === 'vareta') { nRod += c.count; rodSpec = c.spec; } else nGlue++;
  });
  if (nPeg) r.changes.push(nPeg + ' pinos integrados (macho e fêmea): o pino já sai impresso numa parte e encaixa no furo da outra, com 0,5 mm de folga. A parte com pino é impressa na posição original para o pino não ficar para baixo');
  if (nRod) r.changes.push(nRod + ' furos de cada lado para vareta de ' + (rodSpec.r * 2) + ' mm (metal, palito de churrasco ou arame). Corte cada vareta com ' + Math.round(rodSpec.depth * 2 - 1) + ' mm');
  if (nPin) r.changes.push(nPin + ' pinos de encaixe já no arquivo (Ø ' + (sp.pinSpecs[0].r * 2).toFixed(0) + ' mm, furos com 0,4 mm de folga): passe cola nas faces e encaixe');
  if (nMag) r.changes.push(nMag + ' alojamentos de cada lado para ímãs de ' + opts.magnet.d + ' × ' + opts.magnet.t + ' mm (' + (nMag * 2) + ' ímãs no total). Pingue cola instantânea no fundo e confira a polaridade antes de colar o segundo lado');
  if (nGlue) r.changes.push(nGlue + ' corte' + (nGlue > 1 ? 's' : '') + ' sem encaixe: cole com cola instantânea (PLA) ou epóxi');
  var recs = BI3D_CORTE_REC(sp, opts);
  if (recs) r.changes.push('Recomendação: ' + recs);
  if (plates.length > 1) r.changes.push('As partes foram organizadas em ' + plates.length + ' mesas: um arquivo para cada');
  sp.notes.forEach(function (n) { warn.push(n); });
  step('Montando os arquivos…', 0.85);
  var jobs = plates.map(function (pl) {
    return BI3D_MALHA.newProjectMulti(pl.map(function (it) { var o = objs[it.i]; return { tri: o.tri, x: it.x, y: it.y, name: o.name }; }), r.cfg, tpl.appVersion || '2.0.0.3');
  });
  return Promise.all(jobs).then(function (blobs) {
    var preview = { plates: plates.map(function (pl) { return pl.map(function (it) { var o = objs[it.i]; return { tri: o.tri, x: it.x, y: it.y, kind: o.kind }; }); }), bed: [bed[0], bed[1]] };
    return { blob: blobs[0], blobs: blobs, kind: 'partes', preview: preview, changes: r.changes, warnings: warn, parts: sp.parts.length, pins: sp.pins.length,
      mesh: { size: an.size, volume: an.volume, triangles: an.triangles, rotated: an.rotated, before: an.before, after: an.after } };
  });
}

function step(t, p) { self.postMessage({ type: 'progress', text: t, p: p }); }

self.onmessage = function (ev) {
  var d = ev.data, name = d.name || 'peca', tpl = d.tpl, opts = d.opts;
  var isSTL = /\.stl$/i.test(name);
  Promise.resolve().then(function () {
    step('Abrindo o arquivo…', 0.05);
    if (isSTL) return null;
    return JSZip.loadAsync(d.buffer).then(function (zip) {
      return zip.file('Metadata/project_settings.config') ? zip : { plain: zip };
    });
  }).then(function (zip) {
    // 1) projeto de fatiador (Bambu Studio, OrcaSlicer, Anycubic Slicer Next, Orca-Flashforge)
    if (zip && !zip.plain) {
      step('Lendo o projeto e as cores…', 0.2);
      return BI3D_PREP.readProject(new Blob([d.buffer])).then(function (info) {
        step('Aplicando os perfis oficiais da sua impressora…', 0.5);
        var r = BI3D_PREP.buildConfig(info, tpl, opts);
        var copiesP = Promise.resolve(1);
        if ((opts.copies || 1) > 1 && info.plates === 1) {
          step('Calculando o espaço para as cópias…', 0.65);
          copiesP = BI3D_MALHA.parse3MFBounds(info.zip).then(function (b) {
            var area = (r.cfg.printable_area || []).map(function (p) { return String(p).split('x').map(Number); });
            var bed = [Math.max.apply(null, area.map(function (p) { return p[0]; })), Math.max.apply(null, area.map(function (p) { return p[1]; }))];
            return BI3D_PREP.addCopies(info.zip, opts.copies, b, bed, 10);
          });
        }
        return copiesP.then(function (nCopies) {
        if (nCopies > 1) r.changes.push(nCopies + ' cópias na mesma mesa: a purga da troca de cor é dividida entre elas');
        else if ((opts.copies || 1) > 1) r.changes.push(info.plates > 1 ? 'Cópias não adicionadas: o projeto tem mais de uma placa' : 'Cabe só 1 cópia na mesa');
        step('Montando o arquivo…', 0.8);
        return BI3D_PREP.writeProject(info, r.cfg).then(function (blob) {
          var warn = [], slots = opts.slots || 4;
          if (info.nFil > slots) warn.push('O projeto usa ' + info.nFil + ' cores e a sua impressora troca até ' + slots + ' sozinha. Junte cores parecidas no fatiador (clique na cor e escolha outra já usada) ou use mais uma unidade multicor.');
          if (info.sliced) warn.push('O arquivo veio fatiado para outra impressora: o G-code antigo foi removido. Fatie de novo.');
          return { blob: blob, kind: 'projeto', changes: r.changes, warnings: warn, colors: info.colors, plates: info.plates, from: info.printer, nFil: info.nFil, copies: nCopies };
        });
        });
      });
    }
    // 2) STL ou 3MF sem configuração (Printables, Thingiverse, Cults, PrusaSlicer…)
    step(isSTL ? 'Lendo o STL…' : 'Lendo as malhas do 3MF…', 0.15);
    var meshP = isSTL ? Promise.resolve({ tri: BI3D_MALHA.parseSTL(d.buffer), objects: 1 }) : BI3D_MALHA.parse3MFMeshes(zip.plain);
    return meshP.then(function (m) {
      step('Analisando a peça e procurando a melhor posição…', 0.35);
      var an = BI3D_MALHA.analyze(m.tri, { keepOrientation: !!opts.keepOrientation });
      m.tri = null;
      var info = { cfg: {}, colors: ['#FFFFFF'], types: [opts.material], nFil: 1, designerDiffs: [], printer: '' };
      var r = BI3D_PREP.buildConfig(info, tpl, opts), warn = [];
      // suporte: só onde precisa (árvore automática) quando a peça tem balanço de verdade
      var overPct = an.after.total ? an.after.over / an.after.total * 100 : 0;
      if (overPct > 5 && an.after.over > 300) {
        r.cfg.enable_support = '1'; r.cfg.support_type = 'tree(auto)'; r.cfg.support_threshold_angle = '45';
        r.changes.push('Suporte em árvore automático ligado: ' + overPct.toFixed(0) + '% da superfície fica em balanço. Se a peça foi desenhada para imprimir sem suporte, desligue no fatiador e economize filamento');
      } else { r.cfg.enable_support = '0'; r.changes.push('Sem suporte: a peça se sustenta sozinha nessa posição'); }
      // cabe na mesa?
      var area = (r.cfg.printable_area || []).map(function (p) { return String(p).split('x').map(Number); });
      var bx = Math.max.apply(null, area.map(function (p) { return p[0]; })), by = Math.max.apply(null, area.map(function (p) { return p[1]; }));
      var bz = +(r.cfg.printable_height || 250);
      var fits = an.size[2] <= bz && ((an.size[0] <= bx && an.size[1] <= by) || (an.size[0] <= by && an.size[1] <= bx));
      if (!fits && opts.split !== false) {
        step('A peça não cabe: dividindo em partes com encaixe…', 0.45);
        return splitFlow(an, r, warn, name, tpl, opts, [bx, by, bz]);
      }
      if (!fits) warn.push('A peça (' + an.size.map(function (x) { return Math.round(x); }).join(' × ') + ' mm) é maior que a área da sua impressora (' + bx + ' × ' + by + ' × ' + bz + ' mm). Ligue "dividir em partes" ou reduza a escala.');
      if (Math.max(an.size[0], an.size[1], an.size[2]) < 3) warn.push('A peça tem menos de 3 mm. O arquivo pode estar em polegadas ou metros: confira a escala.');
      step('Montando o projeto (peças grandes levam mais tempo)…', 0.6);
      return BI3D_MALHA.newProject(an, r.cfg, name.replace(/\.[^.]+$/, ''), tpl.appVersion || '2.0.0.3', opts.copies || 1).then(function (blob) {
        var preview = { tri: an.centeredTri, centers: an.centers, bed: an.bed };
        an.tri = null; an.centeredTri = null;
        if (an.copies > 1) r.changes.push(an.copies + ' cópias na mesa');
        else if ((opts.copies || 1) > 1) r.changes.push('Cabe só 1 cópia na mesa');
        return { blob: blob, kind: 'malha', preview: preview, changes: r.changes, warnings: warn, objects: m.objects,
          mesh: { size: an.size, volume: an.volume, triangles: an.triangles, rotated: an.rotated, before: an.before, after: an.after, candidates: an.candidates } };
      });
    });
  }).then(function (res) {
    step('Pronto.', 1);
    var tr = res.preview && res.preview.tri ? [res.preview.tri.buffer] : [];
    if (res.preview && res.preview.plates) res.preview.plates.forEach(function (pl) { pl.forEach(function (o) { tr.push(o.tri.buffer); }); });
    self.postMessage({ type: 'done', result: res }, tr);
  }).catch(function (e) {
    self.postMessage({ type: 'error', msg: String(e && e.message || e) });
  });
};
