/* Big Insane 3D · Criar peça com IA · monta o pedido certo para a IA, com as regras de impressão da sua máquina */
(function () {
  'use strict';
  var B = window.BI3D, esc = B.esc, num = B.num;
  var $ = function (id) { return document.getElementById(id); };
  var BEDS = { kobra4: [260, 260, 260], kobrax: [260, 260, 260], a1mini: [180, 180, 180], a1: [256, 256, 256], ad5x: [220, 220, 220] };
  var NAMES = { kobra4: 'Anycubic Kobra 4', kobrax: 'Anycubic Kobra X', a1mini: 'Bambu Lab A1 mini', a1: 'Bambu Lab A1', ad5x: 'Flashforge AD5X' };

  function v(id) { return ($(id).value || '').trim(); }

  function rules() {
    var p = $('cr-printer').value, bed = BEDS[p], nozzle = num(v('cr-nozzle')) || 0.4, mat = $('cr-mat').value;
    var line = nozzle * 1.05, wall = Math.max(0.8, Math.ceil(line * 3 * 10) / 10), detail = Math.ceil(nozzle * 2 * 10) / 10;
    return { printer: NAMES[p], bed: bed, nozzle: nozzle, mat: mat, wall: wall, detail: detail,
      fitSlide: mat === 'PETG' ? 0.35 : 0.3, fitPress: mat === 'PETG' ? 0.15 : 0.1, colors: Math.min(4, Math.max(1, num(v('cr-colors')) || 1)) };
  }

  function figurePrompt(d, r) {
    var size = d.size ? d.size + ' mm tall' : 'about 80 mm tall';
    var en = '3D model for FDM 3D printing: ' + (d.what || 'a figure') + '. ' + (d.style ? 'Style: ' + d.style + '. ' : '') + (d.details ? d.details + '. ' : '') +
      'Requirements: one single solid watertight manifold mesh, no floating or disconnected parts, flat stable base, ' +
      'chunky readable features (no details thinner than ' + r.detail + ' mm at ' + size + ' scale), no paper-thin capes, hair strands or spikes, ' +
      'avoid long horizontal overhangs, arms and limbs attached to the body, ' + (r.colors > 1 ? 'clearly separated color regions with simple shapes (max ' + r.colors + ' colors), ' : '') +
      'clean topology, neutral pose, centered, no text, no background, no base plate engraving.';
    var pt = 'Modelo 3D para impressão FDM: ' + (d.what || 'uma figura') + '. ' + (d.style ? 'Estilo: ' + d.style + '. ' : '') + (d.details ? d.details + '. ' : '') +
      'Requisitos: uma única malha sólida e fechada, sem partes soltas, base plana e estável, detalhes grossos e legíveis (nada mais fino que ' + r.detail + ' mm no tamanho de ' + (d.size || '80') + ' mm), ' +
      'sem capas, fios de cabelo ou pontas finas como papel, sem balanços horizontais longos, braços e pernas presos ao corpo' + (r.colors > 1 ? ', áreas de cor bem separadas (no máximo ' + r.colors + ' cores)' : '') + ', pose neutra, centralizado, sem fundo.';
    var img = 'Product render of ' + (d.what || 'a figure') + (d.style ? ', ' + d.style : '') + ', full body, front three-quarter view, neutral pose, simple solid colors, ' +
      'thick chunky shapes, no thin parts, plain white background, soft studio light, designed to be 3D printed as a collectible figure.';
    return { en: en, pt: pt, img: img };
  }

  function partPrompt(d, r) {
    var t = 'Você é um engenheiro de produto especialista em impressão 3D FDM. Escreva um modelo paramétrico em OpenSCAD para a peça abaixo.\n\n' +
      'PEÇA: ' + (d.what || '(descreva a peça)') + '\n' +
      (d.use ? 'USO: ' + d.use + '\n' : '') +
      (d.dims ? 'MEDIDAS QUE IMPORTAM: ' + d.dims + '\n' : '') +
      (d.details ? 'DETALHES: ' + d.details + '\n' : '') +
      '\nIMPRESSORA E MATERIAL\n' +
      '- Impressora: ' + r.printer + ', área máxima ' + r.bed.join(' × ') + ' mm, bico ' + r.nozzle + ' mm.\n' +
      '- Material: ' + r.mat + (r.mat === 'PETG' ? ' (tenaz, aguenta calor até uns 75 °C)' : ' (rígido, amolece perto de 55 °C)') + '.\n' +
      '\nREGRAS OBRIGATÓRIAS DE IMPRESSÃO\n' +
      '1. Espessura mínima de parede: ' + r.wall + ' mm. Paredes que vão sofrer esforço: pelo menos ' + (r.wall * 2).toFixed(1) + ' mm.\n' +
      '2. Nada de balanço acima de 45° sem apoio. Troque balanços por chanfros de 45°. Furos horizontais grandes: use formato de gota (teardrop).\n' +
      '3. A peça deve ter uma face plana para apoiar na mesa. Diga qual é.\n' +
      '4. Folgas: encaixe deslizante ' + r.fitSlide + ' mm, encaixe justo ' + r.fitPress + ' mm, rosca impressa com folga de ' + r.fitSlide + ' mm.\n' +
      '5. Arredonde ou chanfre cantos internos que recebem força (raio mínimo 1 mm).\n' +
      '6. Se precisar de parafuso, use furos para M3 (3,4 mm) ou M4 (4,5 mm) e alojamento para porca sextavada com folga de 0,2 mm.\n' +
      (r.colors > 1 ? '7. Separe em módulos diferentes as partes de cada cor (no máximo ' + r.colors + ' cores) para eu exportar cada uma.\n' : '') +
      '\nFORMATO DA RESPOSTA\n' +
      '- Primeiro: as medidas que você assumiu, em uma lista curta.\n' +
      '- Depois: o código OpenSCAD completo, com todas as medidas como variáveis no topo e comentários em português.\n' +
      '- Por último: a orientação na mesa, se precisa de suporte e quantas paredes e preenchimento usar.\n' +
      '- Não use bibliotecas externas. O código precisa rodar no OpenSCAD puro.';
    return t;
  }

  function render() {
    var d = { what: v('cr-what'), use: v('cr-use'), dims: v('cr-dims'), size: v('cr-size'), style: v('cr-style'), details: v('cr-details') };
    var r = rules(), kind = $('cr-kind').value, h = [];
    if (!d.what) { $('cr-out').innerHTML = '<p class="rx-note">Descreva a peça para montar o pedido.</p>'; return; }
    if (kind === 'figura') {
      var f = figurePrompt(d, r);
      h.push(block('Prompt para gerador 3D (em inglês, funciona melhor)', f.en, 'Cole em um gerador de 3D por texto. A descrição da peça vai do jeito que você escreveu: se o gerador não entender português, escreva só a descrição em inglês. Se o gerador aceitar imagem, gere primeiro a imagem abaixo e envie a imagem.'));
      h.push(block('Prompt para gerar a imagem de referência', f.img, 'Use em um gerador de imagem e depois envie a imagem para o gerador 3D. Costuma dar resultado melhor que só texto.'));
      h.push(block('Versão em português', f.pt, 'Para geradores que aceitam português.'));
      h.push('<div class="box"><b>Depois de gerar</b><p>Baixe em STL ou 3MF e envie no <a href="preparar.html">Preparar para imprimir</a>. Ele acha a melhor posição e liga suporte só se precisar. Modelos gerados por IA às vezes vêm com furos na malha: o fatiador costuma consertar sozinho ao abrir.</p></div>');
    } else {
      h.push(block('Pedido para a IA escrever o modelo (Claude, ChatGPT, Gemini)', partPrompt(d, r), 'Cole numa conversa nova. A IA devolve o código OpenSCAD.'));
      h.push('<div class="box"><b>Como transformar o código em peça</b><p>1. Instale o OpenSCAD (grátis, openscad.org). 2. Cole o código e aperte F6. 3. Confira as medidas e ajuste as variáveis do topo. 4. Arquivo → Exportar → STL. 5. Envie no <a href="preparar.html">Preparar para imprimir</a>. Imprima uma versão pequena primeiro para testar o encaixe.</p></div>');
    }
    $('cr-out').innerHTML = h.join('');
    Array.prototype.forEach.call(document.querySelectorAll('#cr-out .copy'), function (b) {
      b.addEventListener('click', function () {
        var t = b.parentNode.querySelector('pre').textContent;
        try { navigator.clipboard.writeText(t).then(function () { b.textContent = 'copiado'; setTimeout(function () { b.textContent = 'copiar'; }, 1500); }); } catch (e) {}
      });
    });
  }
  function block(title, text, help) {
    return '<h3>' + esc(title) + '</h3><p class="rx-note">' + esc(help) + '</p><div style="position:relative"><pre class="cfg" style="white-space:pre-wrap">' + esc(text) + '</pre><button type="button" class="copy">copiar</button></div>';
  }
  function kindUI() {
    var fig = $('cr-kind').value === 'figura';
    Array.prototype.forEach.call(document.querySelectorAll('.cr-fig'), function (e) { e.style.display = fig ? '' : 'none'; });
    Array.prototype.forEach.call(document.querySelectorAll('.cr-part'), function (e) { e.style.display = fig ? 'none' : ''; });
    render();
  }
  document.addEventListener('DOMContentLoaded', function () {
    $('cr-printer').innerHTML = Object.keys(NAMES).map(function (k) { return '<option value="' + k + '">' + esc(NAMES[k]) + '</option>'; }).join('');
    try { var p = localStorage.getItem('bi3d_prep_printer'), m = localStorage.getItem('bi3d_prep_mat'); if (p && NAMES[p]) $('cr-printer').value = p; if (m) $('cr-mat').value = m; } catch (e) {}
    Array.prototype.forEach.call(document.querySelectorAll('#cr-form input, #cr-form select, #cr-form textarea'), function (el) { el.addEventListener('input', render); el.addEventListener('change', render); });
    $('cr-kind').addEventListener('change', kindUI);
    kindUI();
  });
})();
