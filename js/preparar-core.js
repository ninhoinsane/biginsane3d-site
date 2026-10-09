/* Big Insane 3D · Preparador · converte um projeto .3mf para a sua impressora
   Usa os perfis oficiais do fabricante (máquina, processo e filamento) e mantém
   o modelo, a pintura de cores e as escolhas do criador. Roda 100% no navegador. */
(function (root) {
  'use strict';

  // ajustes do criador que valem a pena manter (são da peça, não da impressora)
  var KEEP_FROM_DESIGNER = [
    'enable_support', 'support_type', 'support_style', 'support_threshold_angle', 'support_on_build_plate_only',
    'support_top_z_distance', 'support_bottom_z_distance', 'support_interface_top_layers', 'support_interface_bottom_layers',
    'tree_support_branch_angle', 'tree_support_branch_diameter', 'support_critical_regions_only', 'raft_layers',
    'wall_loops', 'top_shell_layers', 'bottom_shell_layers', 'sparse_infill_density', 'sparse_infill_pattern',
    'brim_type', 'brim_width', 'brim_object_gap', 'seam_position', 'ironing_type', 'fuzzy_skin', 'fuzzy_skin_thickness',
    'fuzzy_skin_point_distance', 'spiral_mode', 'only_one_wall_top', 'only_one_wall_first_layer', 'detect_thin_wall',
    'top_surface_pattern', 'bottom_surface_pattern', 'infill_direction', 'print_sequence', 'xy_hole_compensation',
    'xy_contour_compensation', 'elefant_foot_compensation', 'wall_generator', 'interface_shells', 'reduce_infill_retraction'
  ];
  var LABEL = {
    enable_support: 'suporte', support_type: 'tipo de suporte', support_style: 'estilo do suporte', support_threshold_angle: 'ângulo do suporte',
    support_on_build_plate_only: 'suporte só na mesa', support_top_z_distance: 'distância do suporte', support_bottom_z_distance: 'distância do suporte (base)',
    support_interface_top_layers: 'interface do suporte', support_interface_bottom_layers: 'interface do suporte (base)', tree_support_branch_angle: 'ângulo dos galhos',
    tree_support_branch_diameter: 'diâmetro dos galhos', support_critical_regions_only: 'suporte só no essencial', raft_layers: 'raft',
    wall_loops: 'paredes', top_shell_layers: 'camadas de topo', bottom_shell_layers: 'camadas de fundo', sparse_infill_density: 'preenchimento',
    sparse_infill_pattern: 'padrão do preenchimento', brim_type: 'brim', brim_width: 'largura do brim', brim_object_gap: 'folga do brim',
    seam_position: 'costura', ironing_type: 'ironing', fuzzy_skin: 'textura fuzzy', fuzzy_skin_thickness: 'espessura da textura', fuzzy_skin_point_distance: 'densidade da textura',
    spiral_mode: 'modo vaso', only_one_wall_top: 'uma parede no topo', only_one_wall_first_layer: 'uma parede na 1ª camada', detect_thin_wall: 'paredes finas',
    top_surface_pattern: 'padrão do topo', bottom_surface_pattern: 'padrão do fundo', infill_direction: 'direção do preenchimento', print_sequence: 'ordem de impressão',
    xy_hole_compensation: 'compensação de furos', xy_contour_compensation: 'compensação de contorno', elefant_foot_compensation: 'pé de elefante',
    wall_generator: 'gerador de paredes', interface_shells: 'cascas de interface', reduce_infill_retraction: 'retração no preenchimento'
  };
  var PRESET_META = ['_name', 'compatible_printers', 'compatible_printers_condition', 'compatible_prints', 'compatible_prints_condition', 'renamed_from'];

  function isArr(v) { return Object.prototype.toString.call(v) === '[object Array]'; }
  function rep(arr, n) { var out = []; for (var i = 0; i < n; i++) out.push(arr[Math.min(i, arr.length - 1)]); return out; }

  function readProject(file) {
    return JSZip.loadAsync(file).then(function (zip) {
      var pf = zip.file('Metadata/project_settings.config');
      if (!pf) throw new Error('Esse .3mf não tem configurações de fatiador. Se for um modelo puro, abra no fatiador e salve como projeto (.3mf).');
      return pf.async('string').then(function (txt) {
        var cfg = JSON.parse(txt);
        var colors = isArr(cfg.filament_colour) ? cfg.filament_colour : [cfg.filament_colour || '#FFFFFF'];
        var types = isArr(cfg.filament_type) ? cfg.filament_type : [cfg.filament_type || 'PLA'];
        var plates = zip.file(/^Metadata\/plate_\d+\.png$/).length || 1;
        var sliced = zip.file(/^Metadata\/plate_\d+\.gcode$/).length > 0;
        var diffs = isArr(cfg.different_settings_to_system) ? String(cfg.different_settings_to_system[0] || '').split(';').filter(Boolean) : [];
        return { zip: zip, cfg: cfg, colors: colors, types: types, nFil: colors.length, plates: plates, sliced: sliced,
          printer: cfg.printer_model || cfg.printer_settings_id || '', process: cfg.print_settings_id || '', designerDiffs: diffs, name: file.name };
      });
    });
  }

  /* opts: { target, material, quality: 'std'|'fine'|'mini', goal, calib: {temp, bed, pa, flow, vol, retr, fan}, purge: {infill, tower} } */
  function buildConfig(info, tpl, opts) {
    var orig = info.cfg, n = info.nFil, changes = [];
    var q = opts.quality;
    if (!q || q === 'auto') { // segue a altura de camada que o criador escolheu
      var lh = parseFloat(orig.layer_height);
      q = !(lh > 0) ? 'std' : lh <= 0.13 ? 'mini' : lh <= 0.17 ? 'fine' : 'std';
    }
    var fil = tpl.filament[opts.material], proc = tpl.process[q] || tpl.process.std, mach = tpl.machine;
    var cfg = {};
    // 1) parte do projeto original (mantém tudo que é da peça e do projeto)
    Object.keys(orig).forEach(function (k) { cfg[k] = orig[k]; });
    // 2) máquina e processo oficiais da impressora de destino
    [mach, proc].forEach(function (src) { Object.keys(src).forEach(function (k) { if (PRESET_META.indexOf(k) < 0) cfg[k] = src[k]; }); });
    // campos de "filamento por tipo de linha" só valem se o projeto original usava (senão podem forçar uma cor só)
    ['wall_filament', 'sparse_infill_filament', 'solid_infill_filament', 'support_filament', 'support_interface_filament'].forEach(function (k) {
      if (orig[k] === undefined) delete cfg[k]; else cfg[k] = orig[k];
    });
    // 3) filamento oficial, repetido para cada cor do projeto
    Object.keys(fil).forEach(function (k) {
      if (PRESET_META.indexOf(k) >= 0) return;
      cfg[k] = isArr(fil[k]) ? rep(fil[k], n) : fil[k];
    });
    cfg.filament_colour = info.colors.slice();
    cfg.filament_type = rep([opts.material], n);
    // 4) identidade dos presets: o fatiador reconhece como perfis oficiais
    cfg.printer_settings_id = mach._name; cfg.print_settings_id = proc._name;
    cfg.filament_settings_id = rep([fil._name], n);
    cfg.print_compatible_printers = [mach._name];
    cfg.default_print_profile = proc._name; cfg.default_filament_profile = [fil._name];
    if (mach.printer_model) cfg.printer_model = mach.printer_model;
    changes.push('Impressora: ' + (mach.printer_model || mach._name) + ' com o perfil oficial do fabricante');
    changes.push('Processo: ' + proc._name);
    changes.push('Filamento: ' + fil._name + (n > 1 ? ' em ' + n + ' cores' : ''));

    // 5) mantém as escolhas do criador que são da peça
    var kept = [];
    KEEP_FROM_DESIGNER.forEach(function (k) {
      if (orig[k] === undefined) return;
      var designerTouched = info.designerDiffs.indexOf(k) >= 0 || /^(enable_support|support_type|brim_type|wall_loops|sparse_infill_density|spiral_mode|fuzzy_skin|ironing_type|raft_layers)$/.test(k);
      if (designerTouched && JSON.stringify(cfg[k]) !== JSON.stringify(orig[k])) { cfg[k] = orig[k]; kept.push(k); }
    });
    if (kept.length) changes.push('Mantido do criador: ' + kept.map(function (k) { return LABEL[k] || k; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(', '));
    if (info.designerDiffs.indexOf('layer_height') >= 0 && orig.layer_height) { cfg.layer_height = orig.layer_height; changes.push('Altura de camada do criador: ' + orig.layer_height + ' mm'); }

    // 6) tipo de peça
    if (opts.goal === 'funcional') {
      set(cfg, changes, 'wall_loops', '4', 'Paredes: 4 (peça funcional)');
      set(cfg, changes, 'sparse_infill_density', '35%', 'Preenchimento: 35%');
      set(cfg, changes, 'sparse_infill_pattern', 'gyroid', 'Padrão do preenchimento: gyroid');
      set(cfg, changes, 'top_shell_layers', '5', 'Camadas de topo: 5');
      set(cfg, changes, 'bottom_shell_layers', '4', 'Camadas de fundo: 4');
    }
    // 7) valores do caderno de calibração
    var c = opts.calib || {};
    function filNum(key, v, label) { if (v > 0) { cfg[key] = rep([String(v)], n); changes.push(label + ': ' + String(v).replace('.', ',') + ' (seu caderno)'); } }
    if (c.temp > 0) {
      // a Anycubic guarda uma temperatura por tipo de bico (HS, BRASS): grava em todas
      Object.keys(cfg).forEach(function (k) {
        if (/^nozzle_temperature(_[A-Z]+)?$/.test(k)) cfg[k] = rep([String(c.temp)], n);
        if (/^nozzle_temperature_initial_layer(_[A-Z]+)?$/.test(k)) cfg[k] = rep([String(c.temp + 5)], n);
      });
      changes.push('Bico: ' + c.temp + ' °C (seu caderno)');
    }
    if (c.bed > 0) ['hot_plate_temp', 'textured_plate_temp', 'cool_plate_temp', 'eng_plate_temp', 'hot_plate_temp_initial_layer', 'textured_plate_temp_initial_layer'].forEach(function (k) { if (cfg[k] !== undefined) cfg[k] = rep([String(c.bed)], n); });
    if (c.bed > 0) changes.push('Mesa: ' + c.bed + ' °C (seu caderno)');
    filNum('pressure_advance', c.pa, 'Pressure advance'); if (c.pa > 0) cfg.enable_pressure_advance = rep(['1'], n);
    filNum('filament_flow_ratio', c.flow, 'Flow ratio');
    filNum('filament_max_volumetric_speed', c.vol, 'Fluxo volumétrico máximo');
    filNum('filament_retraction_length', c.retr, 'Retração');
    filNum('fan_max_speed', c.fan, 'Ventoinha máxima');

    // 8) purga
    var p = opts.purge || {};
    if (n > 1) {
      if (p.infill) set(cfg, changes, 'flush_into_infill', '1', 'Purga dentro do preenchimento da peça: ligada');
      if (p.support !== false) set(cfg, changes, 'flush_into_support', '1', 'Purga dentro do suporte: ligada');
      if (p.tower === false) set(cfg, changes, 'enable_prime_tower', '0', 'Torre de purga: desligada');
      // tabela de purga: mantém a do projeto quando tem o tamanho certo, senão cria uma pela cor
      var mat = isArr(orig.flush_volumes_matrix) ? orig.flush_volumes_matrix : [];
      if (mat.length > n * n && mat.length % (n * n) === 0) { // impressora de 2 bicos (ex.: X2D, H2D): usa a tabela do primeiro bico
        cfg.flush_volumes_matrix = mat.slice(0, n * n); changes.push('Tabela de purga do criador aproveitada');
      } else if (mat.length !== n * n) { cfg.flush_volumes_matrix = flushMatrix(info.colors); changes.push('Tabela de purga calculada pelas cores'); }
      else cfg.flush_volumes_matrix = mat;
      if (!isArr(cfg.flush_volumes_vector)) cfg.flush_volumes_vector = rep(['140'], n * 2);
    }
    // 9) registro do que mudou em relação ao perfil oficial (o fatiador mostra como "modificado")
    var diffs = [];
    Object.keys(cfg).forEach(function (k) {
      if (proc[k] !== undefined && JSON.stringify(proc[k]) !== JSON.stringify(cfg[k]) && PRESET_META.indexOf(k) < 0) diffs.push(k);
    });
    var fdiffs = [];
    Object.keys(fil).forEach(function (k) { if (PRESET_META.indexOf(k) < 0 && isArr(fil[k]) && JSON.stringify(rep(fil[k], n)) !== JSON.stringify(cfg[k]) && k !== 'filament_colour') fdiffs.push(k); });
    cfg.different_settings_to_system = [diffs.sort().join(';')].concat(rep([fdiffs.sort().join(';')], n)).concat(['']);
    return { cfg: cfg, changes: changes };
  }

  function set(cfg, changes, k, v, label) { if (String(cfg[k]) !== v) { cfg[k] = v; changes.push(label); } }

  // tabela de purga por cor: escuro para claro precisa de bem mais que claro para escuro
  function lum(hex) {
    var h = String(hex || '#ffffff').replace('#', '');
    if (h.length < 6) h = 'ffffff';
    var r = parseInt(h.substr(0, 2), 16) / 255, g = parseInt(h.substr(2, 2), 16) / 255, b = parseInt(h.substr(4, 2), 16) / 255;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function flushMatrix(colors) {
    var n = colors.length, m = [];
    for (var i = 0; i < n; i++) for (var j = 0; j < n; j++) {
      if (i === j) { m.push('0'); continue; }
      var d = lum(colors[i]) - lum(colors[j]); // positivo = do claro para o escuro
      var v = d >= 0 ? 140 + 160 * (1 - d) : 200 + 650 * (-d);
      m.push(String(Math.round(v)));
    }
    return m;
  }

  function writeProject(info, cfg) {
    var zip = info.zip;
    zip.file('Metadata/project_settings.config', JSON.stringify(cfg, null, 4));
    // G-code fatiado de outra impressora dentro do projeto não serve mais
    zip.file(/^Metadata\/plate_\d+\.gcode(\.md5)?$/).forEach(function (f) { zip.remove(f.name); });
    return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 }, mimeType: 'model/3mf' });
  }

  /* várias cópias na mesma mesa (só projetos de 1 placa): duplica os itens com deslocamento em grade.
     box = {minX, minY, maxX, maxY} da peça já posicionada; bed = [largura, profundidade] */
  function addCopies(zip, copies, box, bed, gap) {
    var w = box.maxX - box.minX + gap, d = box.maxY - box.minY + gap;
    var cols = Math.max(1, Math.floor((bed[0] + gap) / w)), rows = Math.max(1, Math.floor((bed[1] + gap) / d));
    var n = Math.max(1, Math.min(copies, cols * rows));
    if (n < 2) return Promise.resolve(1);
    var c = Math.min(cols, Math.ceil(Math.sqrt(n))), r = Math.ceil(n / c);
    var cx = (box.minX + box.maxX) / 2, cy = (box.minY + box.maxY) / 2, offs = [];
    for (var i = 0; i < n; i++) {
      var ci = i % c, ri = Math.floor(i / c);
      offs.push([bed[0] / 2 + (ci - (c - 1) / 2) * w - cx, bed[1] / 2 + (ri - (r - 1) / 2) * d - cy]);
    }
    var mf = zip.file('3D/3dmodel.model'), sf = zip.file('Metadata/model_settings.config');
    return Promise.all([mf.async('string'), sf ? sf.async('string') : Promise.resolve(null)]).then(function (a) {
      var t = a[0], m = /(<build\b[^>]*>)([\s\S]*?)(<\/build>)/.exec(t);
      if (!m) return 1;
      var items = m[2].match(/<item\b[^>]*\/>/g) || [], out = [];
      offs.forEach(function (o, k) {
        items.forEach(function (it) {
          var it2 = it.replace(/transform="([^"]+)"/, function (_, tr) {
            var v = tr.trim().split(/\s+/).map(Number); v[9] += o[0]; v[10] += o[1];
            return 'transform="' + v.map(function (x) { return +x.toFixed(6); }).join(' ') + '"';
          });
          if (k) it2 = it2.replace(/\s*p:UUID="[^"]*"/, '');
          out.push(it2);
        });
      });
      zip.file('3D/3dmodel.model', t.slice(0, m.index) + m[1] + '\n  ' + out.join('\n  ') + '\n ' + m[3] + t.slice(m.index + m[0].length));
      if (a[1]) {
        var st = a[1], insts = st.match(/<model_instance>[\s\S]*?<\/model_instance>/g) || [], add = [];
        for (var k = 1; k < n; k++) insts.forEach(function (ins) {
          add.push(ins.replace(/(key="instance_id" value=")(\d+)/, function (_, p, x) { return p + (+x + k); }).replace(/\s*<metadata key="identify_id"[^>]*\/>/, ''));
        });
        var last = st.lastIndexOf('</model_instance>');
        if (last >= 0 && add.length) { last += '</model_instance>'.length; st = st.slice(0, last) + '\n    ' + add.join('\n    ') + st.slice(last); }
        zip.file('Metadata/model_settings.config', st);
      }
      return n;
    });
  }

  root.BI3D_PREP = { readProject: readProject, buildConfig: buildConfig, writeProject: writeProject, flushMatrix: flushMatrix, addCopies: addCopies };
})(this);
