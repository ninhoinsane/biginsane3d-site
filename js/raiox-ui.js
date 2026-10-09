/* Big Insane 3D · Raio-X do G-code · interface e regras */
(function () {
  'use strict';
  var B = window.BI3D, esc = B.esc, fmt = B.fmt, num = B.num;
  var $ = function (id) { return document.getElementById(id); };

  var FEAT_PT = {
    'outer wall': 'Parede externa', 'inner wall': 'Parede interna', 'sparse infill': 'Preenchimento',
    'internal solid infill': 'Preenchimento sólido', 'solid infill': 'Preenchimento sólido', 'top surface': 'Superfície de topo',
    'bottom surface': 'Fundo', 'gap infill': 'Preenchimento de vãos', 'overhang wall': 'Parede em balanço',
    'bridge': 'Ponte', 'internal bridge': 'Ponte interna', 'support': 'Suporte', 'support interface': 'Interface do suporte',
    'support transition': 'Transição do suporte', 'skirt': 'Saia', 'brim': 'Brim', 'prime tower': 'Torre de purga',
    'wipe tower': 'Torre de purga', 'custom': 'G-code inicial/final', 'ironing': 'Ironing (passar a ferro)',
    'external perimeter': 'Parede externa', 'perimeter': 'Parede interna', 'overhang perimeter': 'Parede em balanço',
    'skirt/brim': 'Saia/brim', 'sem tipo': 'Sem tipo'
  };
  function featPT(n) { return FEAT_PT[String(n).toLowerCase()] || n; }

  var WHERE = {
    noz: 'Filamento → Temperatura do bico', bed: 'Filamento → Temperatura da mesa (do tipo de placa que você usa)',
    fan: 'Filamento → Resfriamento → Velocidade da ventoinha', retr: 'Filamento → Substituições → Retração (ou Impressora → Extrusor)',
    flow: 'Filamento → Taxa de fluxo (flow ratio)', pa: 'Filamento → Pressure advance', vol: 'Filamento → Fluxo volumétrico máximo',
    walls: 'Processo → Resistência → Paredes', infill: 'Processo → Resistência → Densidade do preenchimento',
    layer: 'Processo → Qualidade → Altura da camada', l1speed: 'Processo → Velocidade → Primeira camada',
    outer: 'Processo → Velocidade → Parede externa', brim: 'Processo → Outros → Brim (borda)',
    support: 'Processo → Suporte → Tipo', plate: 'Seletor de placa (no topo da tela do fatiador)',
    accel: 'Processo → Velocidade → Aceleração', foot: 'Processo → Qualidade → Compensação de pé de elefante'
  };

  function first(v) { if (v == null) return null; var s = String(v).replace(/^"|"$/g, '').split(/[,;]/)[0].trim(); return s; }
  function cnum(cfg, k) { var v = num(first(cfg[k])); return isFinite(v) ? v : NaN; }

  /* ---------- regras ---------- */
  function evaluate(r, ctx) {
    var cfg = r.config, out = [], P = ctx.printer, M = ctx.mat, mk = ctx.matKey;
    function add(level, title, detail, where) { out.push({ level: level, title: title, detail: detail, where: where || '' }); }

    // temperaturas reais (o que o G-code manda) ou configuradas
    var noz = Math.max(r.maxNozzle || 0, cnum(cfg, 'nozzle_temperature') || 0, cnum(cfg, 'temperature') || 0);
    var plate = first(cfg.curr_bed_type) || '';
    var plateKey = { 'cool plate': 'cool_plate_temp', 'engineering plate': 'eng_plate_temp', 'high temp plate': 'hot_plate_temp', 'textured pei plate': 'textured_plate_temp', 'smooth pei plate': 'hot_plate_temp' }[plate.toLowerCase()];
    var bed = Math.max(r.maxBed || 0, (plateKey && cnum(cfg, plateKey)) || 0, cnum(cfg, 'bed_temperature') || 0, cnum(cfg, 'hot_plate_temp') && !plateKey ? cnum(cfg, 'hot_plate_temp') : 0);
    ctx.noz = noz; ctx.bed = bed; ctx.plate = plate;

    if (P && bed > P.bedMax) add('erro', 'A mesa está acima do máximo da ' + P.name, 'O arquivo pede ' + fmt(bed, 0) + ' °C e a ' + P.name + ' vai só até ' + P.bedMax + ' °C. A mesa não chega lá e a impressora pode travar esperando aquecer.', WHERE.bed);

    if (M) {
      if (noz && noz > M.noz[1]) add('aviso', 'Bico quente demais para ' + M.name, fmt(noz, 0) + ' °C está acima da faixa comum (' + M.noz[0] + ' a ' + M.noz[1] + ' °C). Faz mais fio e piora pontes. Comece em ' + M.temp + ' °C e ajuste com a torre de temperatura.', WHERE.noz);
      else if (noz && noz < M.noz[0]) add('aviso', 'Bico frio demais para ' + M.name, fmt(noz, 0) + ' °C está abaixo da faixa comum (' + M.noz[0] + ' a ' + M.noz[1] + ' °C). As camadas podem descolar e a peça fica fraca.', WHERE.noz);
      else if (noz) add('ok', 'Temperatura do bico dentro da faixa', fmt(noz, 0) + ' °C para ' + M.name + '.');

      if (bed && !(P && bed > P.bedMax)) {
        if (bed > M.bed[1]) add('aviso', 'Mesa quente demais para ' + M.name, fmt(bed, 0) + ' °C pode deixar a base mole e larga (pé de elefante). Faixa comum: ' + M.bed[0] + ' a ' + M.bed[1] + ' °C.', WHERE.bed);
        else if (bed < M.bed[0]) add('aviso', 'Mesa fria demais para ' + M.name, fmt(bed, 0) + ' °C aumenta o risco de os cantos levantarem. Faixa comum: ' + M.bed[0] + ' a ' + M.bed[1] + ' °C.', WHERE.bed);
        else add('ok', 'Temperatura da mesa dentro da faixa', fmt(bed, 0) + ' °C para ' + M.name + '.');
      }

      var fanMax = cnum(cfg, 'fan_max_speed');
      if (isFinite(fanMax)) {
        if (fanMax > M.fan[1]) add('aviso', 'Ventoinha forte demais para ' + M.name, 'Máximo configurado em ' + fmt(fanMax, 0) + '%. Em ' + M.name + ' isso enfraquece a união entre as camadas. Use até ' + M.fan[1] + '%.', WHERE.fan);
        else if (fanMax < M.fan[0]) add('aviso', 'Ventoinha fraca para ' + M.name, 'Máximo em ' + fmt(fanMax, 0) + '%. Balanços e pontes vão sair caídos. Use pelo menos ' + M.fan[0] + '%.', WHERE.fan);
      }

      if (M.enclosed && P && P.id !== 'outra') add('aviso', M.name + ' pede impressora fechada', M.name + ' encolhe ao esfriar e empena em impressora aberta. Use uma caixa ou tampa, e ventile o ambiente (solta vapor).', '');
      if (mk === 'TPU' && r.toolChanges > 0) add('aviso', 'TPU no sistema multicor', 'Filamento flexível costuma enroscar nas caixas multicor (ACE, AMS lite, IFS). Use a entrada direta de filamento.', '');
      if (mk === 'PETG' && /high temp|smooth|cool plate/i.test(plate)) add('aviso', 'PETG em mesa lisa', 'Na placa "' + esc(plate) + '" o PETG gruda tanto que pode arrancar pedaço da superfície. Passe cola em bastão como separador ou use a placa texturizada.', WHERE.plate);
    }

    var retr = cnum(cfg, 'retraction_length');
    if (isFinite(retr)) {
      if (retr > 2) add('aviso', 'Retração longa para extrusor direto', fmt(retr, 1) + ' mm. Em direct drive, acima de 2 mm pode puxar plástico mole para a parte fria e entupir. Use 0,5 a 1,5 mm.', WHERE.retr);
      else if (retr < 0.2) add('dica', 'Retração muito curta', fmt(retr, 2) + ' mm pode deixar fios. Se aparecer stringing, teste 0,8 mm.', WHERE.retr);
    }

    var fr = cnum(cfg, 'filament_flow_ratio');
    if (isFinite(fr) && (fr < 0.9 || fr > 1.1)) add('aviso', 'Taxa de fluxo fora do comum', 'Flow ratio em ' + fmt(fr, 2) + '. O normal fica entre 0,92 e 1,05. Confira com o teste de fluxo.', WHERE.flow);

    if (P && P.family !== 'bambu' && cfg.enable_pressure_advance === '0') add('dica', 'Pressure advance desligado', 'Ligar e calibrar deixa cantos mais retos e sem bolha. Valor de partida: ' + (mk === 'PETG' ? '0,05' : mk === 'TPU' ? '0,10' : '0,03') + '.', WHERE.pa);

    var lh = cnum(cfg, 'layer_height'), nd = cnum(cfg, 'nozzle_diameter');
    if (isFinite(lh) && isFinite(nd)) {
      if (lh > nd * 0.8) add('erro', 'Camada grossa demais para o bico', 'Camada de ' + fmt(lh, 2) + ' mm com bico de ' + fmt(nd, 2) + ' mm. O máximo seguro é 75% do bico (' + fmt(nd * 0.75, 2) + ' mm).', WHERE.layer);
    }

    var l1 = cnum(cfg, 'initial_layer_speed');
    if (isFinite(l1) && l1 > 60) add('aviso', 'Primeira camada rápida', fmt(l1, 0) + ' mm/s na primeira camada aumenta o risco de não grudar. Use 20 a 50 mm/s.', WHERE.l1speed);

    var acc = cnum(cfg, 'default_acceleration');
    if (P && isFinite(acc) && acc > P.accMax) add('dica', 'Aceleração acima do limite da máquina', fmt(acc, 0) + ' mm/s² configurado, mas a ' + P.name + ' vai até ' + P.accMax + '. A impressora limita sozinha, e a previsão de tempo fica otimista.', WHERE.accel);

    // objetivo da peça
    var walls = cnum(cfg, 'wall_loops'), inf = num(String(first(cfg.sparse_infill_density) || '').replace('%', ''));
    if (ctx.goal === 'funcional') {
      if (isFinite(walls) && walls < 3) add('aviso', 'Poucas paredes para peça funcional', walls + ' paredes. Para peça que vai sofrer esforço, use 4. Parede resiste muito mais que preenchimento.', WHERE.walls);
      if (isFinite(inf) && inf < 25) add('aviso', 'Preenchimento baixo para peça funcional', inf + '%. Use 35 a 40% em gyroid.', WHERE.infill);
    }
    if (ctx.goal === 'miniatura') {
      if (isFinite(lh) && lh > 0.16) add('dica', 'Camada grossa para miniatura', fmt(lh, 2) + ' mm. Para rosto e detalhe, use 0,08 a 0,12 mm.', WHERE.layer);
      var ow = cnum(cfg, 'outer_wall_speed');
      if (isFinite(ow) && ow > 100) add('dica', 'Parede externa rápida para miniatura', fmt(ow, 0) + ' mm/s. Para detalhe, use 40 a 60 mm/s.', WHERE.outer);
    }

    // suporte
    if (cfg.enable_support === '1' && /normal/i.test(cfg.support_type || '')) add('dica', 'Suporte normal ligado', 'O suporte em árvore (tree) gasta menos filamento e sai mais fácil na maioria das peças.', WHERE.support);

    // peça alta e fina
    var fsz = String(cfg.first_layer_print_size || r.header.first_layer_print_size || '').split(',').map(parseFloat);
    var zmax = num(r.header.max_z_height || cfg.max_z_height);
    if (fsz.length === 2 && isFinite(fsz[0]) && isFinite(fsz[1]) && isFinite(zmax)) {
      var base = Math.min(fsz[0], fsz[1]);
      var brim = String(cfg.brim_type || '').toLowerCase();
      if (base > 0 && zmax / base > 3 && (brim === 'no_brim' || brim === '' || cfg.brim_width === '0')) {
        add(P && P.bedslinger ? 'aviso' : 'dica', 'Peça alta e fina sem brim', 'A peça tem ' + fmt(zmax, 0) + ' mm de altura sobre uma base de ' + fmt(base, 0) + ' mm.' + (P && P.bedslinger ? ' Na ' + P.name + ' a mesa vai e volta e a peça pode balançar e soltar.' : '') + ' Ative um brim de 5 a 8 mm.', WHERE.brim);
      }
    }

    // fluxo
    var lim = ctx.limit, overT = 0;
    if (lim > 0) {
      for (var i = 0; i < r.hist.length; i++) if ((i + 0.5) * r.binSize > lim) overT += r.hist[i];
      var pct = r.extrTime ? overT / r.extrTime * 100 : 0;
      ctx.overPct = pct;
      if (pct > 5) add('erro', 'O bico não vai dar conta da velocidade', fmt(pct, 0) + '% do tempo de extrusão pede mais de ' + fmt(lim, 1) + ' mm³/s, o limite que você informou. Vai faltar plástico (subextrusão): paredes falhadas e peça fraca. Veja na tabela abaixo a velocidade máxima de cada parte.', WHERE.vol);
      else if (pct > 1) add('aviso', 'Alguns trechos passam do limite do bico', fmt(pct, 1) + '% do tempo de extrusão está acima de ' + fmt(lim, 1) + ' mm³/s. Pode aparecer falha pontual. Veja a tabela de fluxo.', WHERE.vol);
      else add('ok', 'Fluxo dentro do limite do bico', 'Nenhum trecho relevante passa de ' + fmt(lim, 1) + ' mm³/s.');
    }
    var slLim = cnum(cfg, 'filament_max_volumetric_speed');
    if (M && isFinite(slLim) && slLim > M.vol * 1.3) add('dica', 'Limite de fluxo do fatiador alto', 'O perfil de filamento permite ' + fmt(slLim, 0) + ' mm³/s. É mais que o comum para ' + M.name + ' (cerca de ' + M.vol + '). Se aparecer falha em velocidade alta, faça o teste de fluxo volumétrico.', WHERE.vol);

    // multicor
    if (r.toolChanges > 0) {
      var purge = ctx.purgeG, total = r.grams;
      // só a estimativa pela tabela fica fora do total do fatiador; nos outros casos o total já inclui a purga
      var all = total != null ? total + (ctx.purgeHow.indexOf('tabela') >= 0 ? ctx.flushG : 0) : null;
      var share = all && purge != null ? purge / all * 100 : null;
      var d = r.toolChanges + ' trocas de filamento';
      if (purge != null) d += ', cerca de ' + fmt(purge, 1) + ' g descartados' + (share != null ? ' (' + fmt(share, 0) + '% de todo o filamento gasto)' : '') +
        ': ' + fmt(ctx.flushG, 1) + ' g na troca de cor' + (ctx.towerG > 0.05 ? ' e ' + fmt(ctx.towerG, 1) + ' g na torre de purga' : '') + (ctx.purgeHow ? ' (' + ctx.purgeHow + ')' : '');
      d += '.';
      var firmware = ctx.purgeHow.indexOf('tabela') >= 0 || ctx.purgeHow.indexOf('total do fatiador') >= 0;
      d += ' A peça em si usa cerca de ' + fmt(ctx.modelG, 1) + ' g.';
      var tips = ['imprima várias cópias na mesma mesa: a purga é por troca de cor, não por peça (com 2 cópias, cada peça carrega metade do lixo)', 'ordene as cores do claro para o escuro'];
      if (firmware && ctx.towerG > 0.5) tips.push('desligue a torre de purga (economiza cerca de ' + fmt(ctx.towerG, 1) + ' g; teste antes numa peça pequena)');
      if (!firmware) tips.push('ligue a purga dentro do preenchimento');
      tips.push('ou separe a peça em partes de uma cor só');
      if (share != null && share > 30) add('aviso', 'Muita purga na troca de cor', d + ' Para reduzir: ' + tips.join('; ') + '.', firmware ? 'Processo → Outros → Torre de purga' : 'Processo → Outros → Purga');
      else add('dica', 'Impressão multicor', d + ' Confira se a purga entre cor escura e clara é suficiente para não manchar.', '');
    }
    var order = { erro: 0, aviso: 1, dica: 2, ok: 3 };
    out.sort(function (a, b) { return order[a.level] - order[b.level]; });
    return out;
  }

  function score(items) {
    var s = 100;
    items.forEach(function (it) { if (it.level === 'erro') s -= 25; else if (it.level === 'aviso') s -= 8; else if (it.level === 'dica') s -= 2; });
    return Math.max(0, s);
  }

  /* ---------- fluxo de trabalho ---------- */
  var worker = null, lastFile = null, lastResult = null;

  function setProgress(p, label) {
    $('rx-prog').style.display = 'block';
    $('rx-bar').style.width = Math.round(p * 100) + '%';
    $('rx-plabel').textContent = label || ('Lendo o arquivo: ' + Math.round(p * 100) + '%');
  }

  function analyze(file) {
    lastFile = file;
    $('rx-out').innerHTML = '';
    if (file.size > 1024 * 1024 * 1024) { showErr('Arquivo acima de 1 GB. Divida a impressão em placas menores.'); return; }
    var name = file.name.toLowerCase();
    if (/\.3mf$/.test(name)) {
      if (!window.JSZip) { showErr('Não consegui abrir arquivos .3mf neste navegador.'); return; }
      setProgress(0.02, 'Abrindo o arquivo .3mf…');
      JSZip.loadAsync(file).then(function (zip) {
        var g = zip.file(/Metadata\/plate_\d+\.gcode$/i);
        if (!g.length) g = zip.file(/\.gcode$/i);
        if (!g.length) throw new Error('Esse .3mf não tem G-code dentro. No fatiador, use "Exportar G-code da placa" ou "Exportar arquivo fatiado" (.gcode.3mf).');
        return g[0].async('blob');
      }).then(run).catch(function (e) { showErr(e.message || String(e)); });
    } else if (/\.(gcode|gco|g|bgcode)$/.test(name)) {
      if (/\.bgcode$/.test(name)) { showErr('Arquivos .bgcode (binários) ainda não são lidos. Exporte em G-code de texto.'); return; }
      run(file);
    } else {
      showErr('Formato não reconhecido. Use .gcode ou .gcode.3mf.');
    }
  }

  function run(blob) {
    if (worker) worker.terminate();
    worker = new Worker('js/raiox-worker.js?v=20261009f');
    worker.onmessage = function (ev) {
      var m = ev.data;
      if (m.type === 'progress') setProgress(m.p);
      else if (m.type === 'done') { setProgress(1, 'Pronto.'); lastResult = m.result; render(m.result); worker.terminate(); worker = null; }
      else if (m.type === 'error') showErr(m.msg);
    };
    worker.onerror = function (e) { showErr('Erro ao ler o arquivo: ' + (e.message || 'desconhecido')); };
    worker.postMessage({ blob: blob, opts: { diam: num($('rx-diam').value) || 1.75 } });
  }

  function showErr(msg) {
    $('rx-prog').style.display = 'none';
    $('rx-out').innerHTML = '<div class="box warn"><b>Não deu para analisar</b><p>' + esc(msg) + '</p></div>';
  }

  /* ---------- contexto: impressora, material, limite ---------- */
  function buildCtx(r) {
    var cfg = r.config;
    var ptxt = [cfg.printer_model, cfg.printer_settings_id, cfg.printer_variant, r.header['printer_model']].join(' ');
    var sel = $('rx-printer').value;
    var P = sel === 'auto' ? (B.findPrinter(ptxt) || B.printerById('outra')) : B.printerById(sel);
    var ftype = first(cfg.filament_type);
    var mk = $('rx-mat').value === 'auto' ? B.normMaterial(ftype) : $('rx-mat').value;
    var M = mk ? B.MATERIALS[mk] : null;
    var limIn = num($('rx-limit').value), limSrc = 'você informou';
    var lim = limIn;
    if (!(lim > 0)) {
      var cad = B.loadCaderno().filter(function (c) { return c.printer === P.id && c.material === mk && num(c.vol) > 0; });
      if (cad.length) { lim = num(cad[cad.length - 1].vol); limSrc = 'do seu caderno de calibração (' + cad[cad.length - 1].name + ')'; }
      else if (M) { lim = M.vol; limSrc = 'valor comum para ' + M.name + ' (calibre o seu para ter precisão)'; }
      else { lim = cnum(cfg, 'filament_max_volumetric_speed'); limSrc = 'limite do próprio fatiador'; }
    }
    var dens = cnum(cfg, 'filament_density') || (M ? M.dens : 1.24);
    var extrudedG = r.extrVol / 1000 * dens;
    // purga
    // purga: se o G-code já traz a purga (Bambu), mede direto; se a purga é feita pelo firmware
    // (Anycubic ACE e similares), calcula pela sequência real de trocas × tabela de purga do projeto
    var purgeVol = null, purgeHow = '', towerVol = r.primeVol || 0, flushVol = 0;
    if (r.toolChanges > 0) {
      if ((r.stationaryVol || 0) > 50) { flushVol = r.stationaryVol; purgeHow = 'medida no G-code'; }
      else if (r.grams != null && r.grams > extrudedG * 1.02) {
        // purga feita pelo firmware (ex.: ACE da Anycubic): o total do fatiador já inclui; a diferença para o que sai pelo bico é a purga
        flushVol = (r.grams - extrudedG) / dens * 1000; purgeHow = 'total do fatiador menos o que sai pelo bico';
      } else {
        var mat = String(cfg.flush_volumes_matrix || '').split(',').map(parseFloat);
        var nn = Math.round(Math.sqrt(mat.length));
        var mult = cnum(cfg, 'flush_multiplier'); if (!(mult > 0)) mult = 1;
        if (nn > 1 && nn * nn === mat.length) {
          for (var pk in r.pairs) {
            var ab = pk.split('>'), a = +ab[0], b = +ab[1];
            if (a < nn && b < nn && isFinite(mat[a * nn + b])) flushVol += mat[a * nn + b] * r.pairs[pk];
          }
          flushVol *= mult; purgeHow = 'calculada pela tabela de purga e pelas trocas reais';
        }
      }
      purgeVol = flushVol + towerVol;
    }
    return { printer: P, matKey: mk, mat: M, ftype: ftype, limit: lim, limitSrc: limSrc, dens: dens, modelG: Math.max(0, extrudedG - towerVol / 1000 * dens),
      purgeG: purgeVol != null ? purgeVol / 1000 * dens : null, flushG: flushVol / 1000 * dens, towerG: towerVol / 1000 * dens, purgeHow: purgeHow,
      goal: $('rx-goal').value, price: num($('rx-price').value) };
  }

  /* ---------- relatório ---------- */
  function dur(s) { if (!s) return '—'; var h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return (h ? h + ' h ' : '') + m + ' min'; }

  function render(r) {
    var ctx = buildCtx(r), items = evaluate(r, ctx), sc = score(items);
    var nErr = items.filter(function (i) { return i.level === 'erro'; }).length, nAv = items.filter(function (i) { return i.level === 'aviso'; }).length;
    var verdict = nErr ? ['bad', 'Corrija antes de imprimir'] : nAv ? ['warn', 'Dá para imprimir, mas tem pontos de atenção'] : ['good', 'Pode imprimir'];
    var grams = r.grams != null ? r.grams : (r.extrVol / 1000 * ctx.dens);
    var cost = ctx.price > 0 ? grams / 1000 * ctx.price : null;
    var h = [];
    h.push('<div class="rx-verdict ' + verdict[0] + '"><div class="rx-score">' + sc + '</div><div><b>' + verdict[1] + '</b><p>' +
      nErr + ' erro(s), ' + nAv + ' aviso(s). Arquivo: ' + esc(lastFile ? lastFile.name : '') + '</p></div></div>');
    h.push('<div class="rx-cards">');
    [['Impressora', ctx.printer.name + (ctx.printer.id === 'outra' ? '' : '')],
     ['Material', (ctx.ftype || '—') + (ctx.matKey && ctx.matKey !== ctx.ftype ? ' (' + ctx.matKey + ')' : '')],
     ['Tempo estimado', dur(r.estSeconds)],
     ['Filamento', fmt(grams, 1) + ' g'],
     ['Custo do filamento', cost != null ? 'R$ ' + fmt(cost, 2) : 'informe o preço'],
     ['Camadas', r.layers || '—'],
     ['Bico / mesa', (ctx.noz ? fmt(ctx.noz, 0) + ' °C' : '—') + ' / ' + (ctx.bed ? fmt(ctx.bed, 0) + ' °C' : '—')],
     ['Trocas de cor', r.toolChanges ? r.toolChanges + (ctx.purgeG != null ? ' · ' + fmt(ctx.purgeG, 1) + ' g de purga' : '') : 'nenhuma']
    ].forEach(function (c) { h.push('<div class="rx-card"><span>' + c[0] + '</span><b>' + esc(c[1]) + '</b></div>'); });
    h.push('</div>');

    h.push('<h3>O que conferir</h3><div class="rx-items">');
    var lbl = { erro: 'Erro', aviso: 'Atenção', dica: 'Dica', ok: 'Certo' };
    items.forEach(function (it) {
      h.push('<div class="rx-item ' + it.level + '"><span class="rx-tag">' + lbl[it.level] + '</span><div><b>' + esc(it.title) + '</b><p>' + esc(it.detail) + '</p>' +
        (it.where ? '<p class="rx-where">Onde mudar: ' + esc(it.where) + '</p>' : '') + '</div></div>');
    });
    h.push('</div>');

    // fluxo
    h.push('<h3>Fluxo de plástico (mm³/s)</h3><p class="rx-note">Limite usado: <b>' + fmt(ctx.limit, 1) + ' mm³/s</b> (' + esc(ctx.limitSrc) + '). Barras vermelhas são trechos acima do limite.</p>');
    h.push(chart(r, ctx.limit));
    h.push('<div class="tbl"><table><tr><th>Parte da peça</th><th>% do tempo</th><th>Fluxo médio</th><th>Fluxo máx.</th><th>Acima do limite</th><th>Velocidade máx. segura</th></tr>');
    r.features.forEach(function (f) {
      if (f.time / (r.extrTime || 1) < 0.002) return;
      var over = 0; for (var i = 0; i < f.hist.length; i++) if ((i + 0.5) * r.binSize > ctx.limit) over += f.hist[i];
      var op = f.time ? over / f.time * 100 : 0;
      var vmax = f.cross > 0 ? 0.9 * ctx.limit / f.cross : NaN;
      h.push('<tr><td>' + esc(featPT(f.name)) + '</td><td>' + fmt(f.time / r.extrTime * 100, 1) + '%</td><td>' + fmt(f.avgFlow, 1) + '</td><td>' + fmt(f.maxFlow, 1) + '</td><td' + (op > 1 ? ' class="bad"' : '') + '>' + fmt(op, 1) + '%</td><td>' + (op > 1 ? '<b>' + fmt(vmax, 0) + ' mm/s</b>' : 'ok') + '</td></tr>');
    });
    h.push('</table></div>');

    // configurações lidas
    var keys = ['printer_settings_id', 'print_settings_id', 'filament_settings_id', 'curr_bed_type', 'layer_height', 'initial_layer_print_height', 'nozzle_diameter', 'wall_loops', 'top_shell_layers', 'bottom_shell_layers', 'sparse_infill_density', 'sparse_infill_pattern', 'nozzle_temperature', 'nozzle_temperature_initial_layer', 'fan_min_speed', 'fan_max_speed', 'filament_flow_ratio', 'enable_pressure_advance', 'pressure_advance', 'filament_max_volumetric_speed', 'retraction_length', 'retraction_speed', 'z_hop', 'outer_wall_speed', 'inner_wall_speed', 'sparse_infill_speed', 'initial_layer_speed', 'default_acceleration', 'enable_support', 'support_type', 'brim_type', 'brim_width', 'seam_position', 'elefant_foot_compensation'];
    var rows = keys.filter(function (k) { return r.config[k] != null; });
    if (rows.length) {
      h.push('<details><summary>Configurações lidas do arquivo (' + rows.length + ')</summary><div class="in"><div class="tbl"><table>');
      rows.forEach(function (k) { h.push('<tr><td><code>' + esc(k) + '</code></td><td>' + esc(String(r.config[k]).slice(0, 120)) + '</td></tr>'); });
      h.push('</table></div></div></details>');
    } else {
      h.push('<div class="box"><b>Arquivo sem configurações embutidas</b><p>Esse G-code não traz as configurações do fatiador, então só a análise de fluxo, tempo e temperatura foi feita. OrcaSlicer, Bambu Studio, Anycubic Slicer Next e Orca-Flashforge incluem as configurações por padrão.</p></div>');
    }
    h.push('<div class="btns" style="margin-top:20px"><button class="cta" type="button" id="rx-dl">Baixar relatório (.txt)</button><button class="ghost" type="button" id="rx-again">Analisar outro arquivo</button></div>');
    $('rx-out').innerHTML = h.join('');
    $('rx-dl').onclick = function () { download(r, ctx, items, sc); };
    $('rx-again').onclick = function () { $('rx-file').value = ''; $('rx-file').click(); };
    $('rx-out').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function chart(r, lim) {
    var last = 0; for (var i = 0; i < r.hist.length; i++) if (r.hist[i] > 0) last = i;
    var n = Math.max(last + 2, Math.ceil(lim / r.binSize) + 4), max = 0;
    for (i = 0; i < n; i++) max = Math.max(max, r.hist[i] || 0);
    if (!max) return '<p class="rx-note">Nenhuma extrusão encontrada no arquivo.</p>';
    var W = 640, H = 170, bw = W / n, s = ['<svg class="rx-chart" viewBox="0 0 ' + W + ' ' + (H + 22) + '" role="img" aria-label="Distribuição do fluxo de plástico">'];
    for (i = 0; i < n; i++) {
      var v = r.hist[i] || 0, bh = v / max * H, over = (i + 0.5) * r.binSize > lim;
      if (bh > 0) s.push('<rect x="' + (i * bw + 0.5).toFixed(1) + '" y="' + (H - bh).toFixed(1) + '" width="' + Math.max(1, bw - 1).toFixed(1) + '" height="' + bh.toFixed(1) + '" class="' + (over ? 'b-over' : 'b-ok') + '"/>');
    }
    var lx = lim / r.binSize * bw;
    s.push('<line x1="' + lx.toFixed(1) + '" x2="' + lx.toFixed(1) + '" y1="0" y2="' + H + '" class="b-lim"/>');
    for (var t = 0; t <= n * r.binSize; t += 5) s.push('<text x="' + (t / r.binSize * bw).toFixed(1) + '" y="' + (H + 16) + '">' + t + '</text>');
    s.push('</svg>');
    return s.join('');
  }

  function download(r, ctx, items, sc) {
    var L = [];
    L.push('RAIO-X DO G-CODE · Big Insane 3D · biginsane3d.com');
    L.push('Arquivo: ' + (lastFile ? lastFile.name : '') + '   Nota: ' + sc + '/100');
    L.push('Impressora: ' + ctx.printer.name + '   Material: ' + (ctx.ftype || '—'));
    L.push('Tempo: ' + dur(r.estSeconds) + '   Filamento: ' + fmt(r.grams != null ? r.grams : r.extrVol / 1000 * ctx.dens, 1) + ' g   Trocas de cor: ' + r.toolChanges);
    L.push('Limite de fluxo usado: ' + fmt(ctx.limit, 1) + ' mm³/s (' + ctx.limitSrc + ')');
    L.push('');
    items.forEach(function (it) { L.push('[' + it.level.toUpperCase() + '] ' + it.title); L.push('   ' + it.detail); if (it.where) L.push('   Onde mudar: ' + it.where); });
    L.push('');
    L.push('Fluxo por parte (médio / máximo mm³/s):');
    r.features.forEach(function (f) { if (f.time / (r.extrTime || 1) >= 0.002) L.push('  ' + featPT(f.name) + ': ' + fmt(f.avgFlow, 1) + ' / ' + fmt(f.maxFlow, 1)); });
    var blob = new Blob([L.join('\r\n')], { type: 'text/plain;charset=utf-8' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'raio-x-' + (lastFile ? lastFile.name.replace(/\.[^.]+(\.[^.]+)?$/, '') : 'gcode') + '.txt';
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  /* ---------- eventos ---------- */
  function init() {
    var dz = $('rx-drop'), inp = $('rx-file');
    dz.addEventListener('click', function () { inp.click(); });
    dz.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inp.click(); } });
    inp.addEventListener('change', function () { if (inp.files[0]) analyze(inp.files[0]); });
    ['dragenter', 'dragover'].forEach(function (t) { dz.addEventListener(t, function (e) { e.preventDefault(); dz.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (t) { dz.addEventListener(t, function (e) { e.preventDefault(); dz.classList.remove('over'); }); });
    dz.addEventListener('drop', function (e) { var f = e.dataTransfer.files[0]; if (f) analyze(f); });
    ['rx-printer', 'rx-mat', 'rx-goal', 'rx-limit', 'rx-price'].forEach(function (id) {
      $(id).addEventListener('change', function () { if (lastResult) render(lastResult); });
    });
    var sel = $('rx-printer');
    B.PRINTERS.forEach(function (p) { var o = document.createElement('option'); o.value = p.id; o.textContent = p.name; sel.appendChild(o); });
    try { var pr = localStorage.getItem('bi3d_preco_kg'); if (pr) $('rx-price').value = pr; } catch (e) {}
    $('rx-price').addEventListener('change', function () { try { localStorage.setItem('bi3d_preco_kg', $('rx-price').value); } catch (e) {} });
  }
  window.BI3D_RAIOX = {
    analyzeBlob: function (blob, name) { lastFile = { name: name || 'teste.gcode' }; run(blob); },
    renderResult: function (result, name) { lastFile = { name: name || 'teste.gcode' }; lastResult = result; render(result); }
  };
  document.addEventListener('DOMContentLoaded', init);
})();
