/* Big Insane 3D · Preparador · trabalho pesado em segundo plano (a página não trava) */
importScripts('jszip.min.js?v=20261009c', 'preparar-core.js?v=20261009c', 'malha.js?v=20261009c');

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
      if (!fits) warn.push('A peça (' + an.size.map(function (x) { return Math.round(x); }).join(' × ') + ' mm) é maior que a área da sua impressora (' + bx + ' × ' + by + ' × ' + bz + ' mm). Reduza a escala ou corte a peça no fatiador.');
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
    self.postMessage({ type: 'done', result: res }, tr);
  }).catch(function (e) {
    self.postMessage({ type: 'error', msg: String(e && e.message || e) });
  });
};
