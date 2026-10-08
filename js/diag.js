/* Big Insane 3D · Diagnóstico guiado */
(function () {
  'use strict';
  var B = window.BI3D, esc = B.esc;
  var $ = function (id) { return document.getElementById(id); };
  var st = { printer: null, mat: null, sym: null, qi: 0, fixes: [] };

  function paTerm(c) { return c.p.family === 'bambu' ? 'Flow Dynamics (fator K)' : 'Pressure Advance'; }
  function bedHi(c) { return Math.min(c.p.bedMax, c.m.bed[1]); }

  /* cada sintoma: perguntas (sim/não) que somam soluções; depois soluções gerais */
  var S = {
    adesao: { t: 'A primeira camada não gruda', q: [
      { t: 'Você lavou a mesa com detergente neutro e água antes desta impressão?', no: function () { return ['Lave a mesa', 'Detergente neutro e água morna, seque com papel e não toque mais com os dedos. Álcool sozinho só espalha a gordura. É a causa nº 1.']; } },
      { t: 'Olhando a primeira camada, as linhas saem redondas e separadas, com espaço entre elas?', yes: function () { return ['O bico está longe da mesa', 'Abaixe o Z-offset em passos de 0,02 mm até as linhas saírem achatadas e encostadas. Rode o nivelamento automático antes.']; } },
      { t: 'O bico raspa na mesa ou a primeira camada sai transparente e ondulada?', yes: function () { return ['O bico está perto demais', 'Suba o Z-offset em passos de 0,02 mm.']; } },
      { t: 'A peça tem pouca área encostando na mesa (base pequena ou pontuda)?', yes: function () { return ['Aumente a área de contato', 'Ative um brim de 5 mm. Se der, gire a peça para a face maior ficar para baixo.']; } }
    ], g: function (c) { return [
      ['Ajuste a primeira camada', 'Mesa ' + Math.min(c.m.bedT + 5, bedHi(c)) + ' °C, primeira camada a 20 mm/s e 0,25 mm de altura.'],
      ['Placa certa', c.mk === 'PETG' ? 'PETG em placa lisa gruda demais e pode arrancar pedaço. Prefira a texturizada.' : 'Placa texturizada (PEI) é a mais fácil para começar.']]; } },

    warping: { t: 'Os cantos levantam (empena)', q: [
      { t: 'Tem janela aberta, ventilador ou ar-condicionado perto da impressora?', yes: function () { return ['Corte o vento', 'Corrente de ar esfria um lado da peça e ela entorta. Afaste a impressora ou proteja com uma caixa.']; } },
      { t: 'A peça é grande e chata, ou comprida?', yes: function () { return ['Brim ou "orelhas"', 'Brim de 8 mm, ou discos finos de 15 mm nos cantos (no fatiador: adicionar forma → disco).']; } }
    ], g: function (c) { return [
      ['Temperatura da mesa', c.m.name + ': use ' + Math.min(c.m.bed[1], c.p.bedMax) + ' °C.' + (c.p.id === 'a1mini' && (c.mk === 'ABS' || c.mk === 'ASA') ? ' A A1 mini vai só até 80 °C, então ABS e ASA não são indicados nela.' : '')],
      ['Ventoinha no começo', 'Desligue a ventoinha nas 3 primeiras camadas.'],
      c.m.enclosed ? ['Precisa de caixa', c.m.name + ' praticamente exige impressora fechada.'] : ['Mesa limpa', 'Lave com detergente e água: gruda melhor e segura os cantos.']]; } },

    fios: { t: 'Fios de teia entre as partes (stringing)', q: [
      { t: 'O rolo ficou fora da embalagem ou da caixa seca por mais de 1 dia?', yes: function (c) { return ['Seque o filamento', 'Filamento úmido é a causa nº 1, principalmente ' + (c.mk === 'PETG' ? 'no seu PETG' : 'no PETG') + '. Seque por 6 a 8 horas' + (c.p.id === 'kobra4' ? ' (o ACE 2 Pro do Kobra 4 Combo seca)' : ' num secador de filamento') + '.']; } },
      { t: 'Você ouve estalos ou vê vapor saindo do bico?', yes: function () { return ['É umidade, com certeza', 'Estalo e vapor são água fervendo no bico. Secar resolve; mexer em retração não.']; } }
    ], g: function (c) { return [
      ['Baixe a temperatura', 'Teste ' + (c.m.temp - 5) + ' °C. Bico quente demais escorre.'],
      ['Retração', 'Para extrusor direto: 0,8 mm (PLA) ou 1,0 mm (PETG). Suba 0,2 mm por vez e não passe de 1,5 mm.'],
      ['Limpeza (wipe)', 'Ative o wipe de 2 mm e aumente a velocidade de deslocamento.']]; } },

    falha: { t: 'Falta plástico, buracos, paredes finas', q: [
      { t: 'As falhas aparecem mais nas partes rápidas (preenchimento) do que nas lentas?', yes: function (c) { return ['O bico não acompanha a velocidade', 'Passe o G-code no Raio-X para ver qual parte passa do limite de fluxo. Valor comum para ' + c.m.name + ': ' + c.m.vol + ' mm³/s. Baixe a velocidade dessa parte ou faça o teste de fluxo volumétrico.']; } },
      { t: 'O extrusor faz "clec-clec" (estalo de engrenagem)?', yes: function () { return ['Extrusor patinando', 'Pode ser bico parcialmente entupido ou velocidade alta demais. Faça um cold pull (veja o sintoma "Entupiu") e baixe a velocidade.']; } },
      { t: 'O filamento está enroscado no rolo ou o tubo está dobrado?', yes: function () { return ['Caminho do filamento', 'Desenrosque o rolo, confira se gira livre e se o tubo não tem dobra forte.']; } }
    ], g: function (c) { return [
      ['Calibre o fluxo', 'Faça o teste de Flow Rate. O valor comum fica entre 0,95 e 1,00.'],
      ['Temperatura', 'Confirme ' + c.m.temp + ' °C para ' + c.m.name + '. Bico frio derrete menos plástico.']]; } },

    fraca: { t: 'A peça quebra fácil ou as camadas separam', q: [
      { t: 'Ela quebra entre as camadas (separa como se descolasse)?', yes: function (c) { return ['União fraca entre camadas', 'Suba o bico para ' + Math.min(c.m.noz[1], c.m.temp + 10) + ' °C e reduza a ventoinha' + (c.mk === 'PETG' ? ' para 40%' : '') + '.']; } },
      { t: 'A peça vai segurar peso ou sofrer esforço?', yes: function () { return ['Configure como peça funcional', '4 paredes, preenchimento de 35 a 40% em gyroid, 5 camadas de topo e fundo. Parede resiste mais que preenchimento.']; } },
      { t: 'Ela fica no sol, no carro ou perto de calor?', yes: function (c) { return ['Material errado', c.mk === 'PLA' ? 'PLA amolece perto de 55 a 60 °C. Use PETG.' : 'Use PETG ou ASA para calor.']; } }
    ], g: function () { return [['Orientação', 'A peça é mais fraca entre camadas. Deite a peça para o esforço ficar ao longo das linhas, não separando as camadas.']]; } },

    topo: { t: 'Topo com buracos ou com relevo', q: [
      { t: 'O topo tem buracos ou parece uma rede?', yes: function () { return ['Topo fino', 'Use 5 ou 6 camadas de topo e preenchimento de pelo menos 15%.']; } },
      { t: 'O topo tem relevo, com o bico arrastando?', yes: function () { return ['Plástico sobrando', 'O flow está alto. Faça o teste de Flow Rate e baixe 0,02 por vez.']; } }
    ], g: function () { return [['Acabamento extra', 'Ative o ironing (passar a ferro) no topo, com fluxo de 10 a 15%.']]; } },

    ondas: { t: 'Ondulações depois dos cantos (ringing)', q: [
      { t: 'A impressora está numa mesa que balança?', yes: function () { return ['Base firme', 'Coloque num lugar firme e pesado. Uma placa de pedra ou concreto embaixo ajuda muito.']; } },
      { t: 'Você usa o modo de velocidade esporte ou máximo?', yes: function () { return ['Modo mais calmo', 'Volte para o modo padrão para peças que precisam ficar bonitas.']; } }
    ], g: function (c) { return [
      ['Aceleração', 'Baixe a aceleração das paredes para 5.000 mm/s²' + (c.p.family === 'bambu' ? '' : ' e rode a calibração de vibração (input shaping) da impressora') + '.'],
      ['Correias', 'Confira a tensão: firme, sem ficar mole.']]; } },

    pe: { t: 'A base sai mais larga (pé de elefante)', q: [
      { t: 'A primeira camada está bem esmagada e brilhante?', yes: function () { return ['Bico perto demais', 'Suba o Z-offset 0,02 mm.']; } }
    ], g: function (c) { return [
      ['Compensação', 'Ative a compensação de pé de elefante: ' + (c.mk === 'PETG' ? '0,20' : '0,15') + ' mm.'],
      ['Mesa', 'Use ' + c.m.bed[0] + ' a ' + c.m.bedT + ' °C. Mesa mais quente deixa a base mole.']]; } },

    medida: { t: 'O encaixe não entra ou a medida sai errada', q: [
      { t: 'Furos saem menores e pinos maiores do que o desenho?', yes: function () { return ['Plástico sobrando nas paredes', 'Calibre o flow. Se continuar, use a compensação de furos (X-Y hole compensation) de 0,1 mm ou deixe 0,2 mm de folga no desenho.']; } },
      { t: 'O erro está só na parte de baixo da peça?', yes: function (c) { return ['Pé de elefante', 'Ative a compensação de pé de elefante (' + (c.mk === 'PETG' ? '0,20' : '0,15') + ' mm).']; } }
    ], g: function () { return [['Folga no desenho', 'Para encaixe deslizante, deixe 0,2 a 0,3 mm de folga. Para encaixe justo, 0,1 mm. Imprima um teste pequeno antes da peça grande.']]; } },

    entupiu: { t: 'Entupiu ou não sai plástico', q: [
      { t: 'O filamento chega até o bico (o extrusor puxa, mas não sai nada)?', yes: function () { return ['Bico entupido: cold pull', 'Aqueça a 240 °C, empurre um pouco de filamento, deixe esfriar até uns 90 °C e puxe com firmeza. A ponta sai com a sujeira. Repita até sair limpo.']; } },
      { t: 'Você usou retração maior que 2 mm?', yes: function () { return ['Retração demais', 'Em extrusor direto, retração longa puxa plástico mole para a parte fria e trava. Volte para 0,8 a 1,0 mm.']; } }
    ], g: function (c) { return [
      ['Velocidade', 'Não passe do fluxo volumétrico do material (' + c.m.name + ': cerca de ' + c.m.vol + ' mm³/s).'],
      ['Bico gasto', 'Se imprime muito PETG ou filamento com carga (madeira, glitter, fibra), troque o bico a cada 3 meses.']]; } },

    cor: { t: 'Cor misturada no multicor', q: [
      { t: 'A mancha aparece quando troca de cor escura para clara?', yes: function () { return ['Purga curta', 'Escuro para claro precisa de 2 a 3 vezes mais purga. Use 400 a 800 mm³; preto ou vermelho para branco, até 900 mm³.']; } }
    ], g: function () { return [
      ['Ordem das cores', 'Ordene do claro para o escuro e coloque no slot 1 a cor que mais aparece.'],
      ['Gastar menos', 'Use a purga no preenchimento ou num objeto extra, e imprima várias cópias juntas: a purga é por troca, não por peça.']]; } }
  };

  function sel(id, items, cur) {
    $(id).innerHTML = items.map(function (it) { return '<button type="button" class="dg-opt' + (cur === it[0] ? ' on' : '') + '" data-v="' + esc(it[0]) + '">' + esc(it[1]) + '</button>'; }).join('');
  }

  function render() {
    var out = $('dg-body');
    if (!st.printer) {
      out.innerHTML = '<div class="dg-step"><span class="num">Passo 1 de 3</span><h3>Qual é a sua impressora?</h3><div class="dg-opts" id="dg-o"></div></div>';
      sel('dg-o', B.PRINTERS.map(function (p) { return [p.id, p.name]; }));
      bind(function (v) { st.printer = v; render(); });
    } else if (!st.mat) {
      out.innerHTML = '<div class="dg-step"><span class="num">Passo 2 de 3</span><h3>Qual material?</h3><div class="dg-opts" id="dg-o"></div></div>' + back();
      sel('dg-o', Object.keys(B.MATERIALS).map(function (k) { return [k, k]; }));
      bind(function (v) { st.mat = v; render(); });
    } else if (!st.sym) {
      out.innerHTML = '<div class="dg-step"><span class="num">Passo 3 de 3</span><h3>O que está acontecendo?</h3><div class="dg-opts sym" id="dg-o"></div></div>' + back();
      sel('dg-o', Object.keys(S).map(function (k) { return [k, S[k].t]; }));
      bind(function (v) { st.sym = v; st.qi = 0; st.fixes = []; render(); });
    } else if (st.qi < S[st.sym].q.length) {
      var q = S[st.sym].q[st.qi];
      out.innerHTML = '<div class="dg-step"><span class="num">' + esc(S[st.sym].t) + ' · pergunta ' + (st.qi + 1) + ' de ' + S[st.sym].q.length + '</span><h3>' + esc(q.t) + '</h3><div class="dg-opts"><button type="button" class="dg-opt" data-v="yes">Sim</button><button type="button" class="dg-opt" data-v="no">Não</button><button type="button" class="dg-opt" data-v="nd">Não sei</button></div></div>' + back();
      bind(function (v) {
        var f = v === 'yes' ? q.yes : v === 'no' ? q.no : null;
        if (f) st.fixes.push(f(ctx()));
        st.qi++; render();
      });
    } else {
      var c = ctx(), all = st.fixes.concat(S[st.sym].g(c));
      var h = '<div class="dg-step"><span class="num">Resultado · ' + esc(c.p.name) + ' · ' + esc(c.m.name) + '</span><h3>' + esc(S[st.sym].t) + ': faça nesta ordem</h3><ol class="dg-fix">';
      all.forEach(function (f) { h += '<li><b>' + esc(f[0]) + '</b><p>' + esc(f[1]) + '</p></li>'; });
      h += '</ol><p class="rx-note">Mude uma coisa por vez e teste com uma peça pequena. Assim você sabe o que resolveu.</p>' +
        '<div class="btns"><button type="button" class="cta" id="dg-new">Outro problema</button><a class="ghost" href="problemas.html">Ver todos os problemas</a><a class="ghost" href="raiox.html">Conferir o G-code</a></div></div>';
      out.innerHTML = h;
      $('dg-new').onclick = function () { st.sym = null; render(); };
    }
    var bk = $('dg-back'); if (bk) bk.onclick = goBack;
  }
  function ctx() { return { p: B.printerById(st.printer), m: B.MATERIALS[st.mat], mk: st.mat }; }
  function back() { return '<button type="button" class="dg-back" id="dg-back">← Voltar</button>'; }
  function goBack() {
    if (st.sym && st.qi > 0) { st.qi = 0; st.fixes = []; st.sym = null; }
    else if (st.sym) st.sym = null; else if (st.mat) st.mat = null; else st.printer = null;
    render();
  }
  function bind(fn) {
    Array.prototype.forEach.call(document.querySelectorAll('#dg-body .dg-opt'), function (b) {
      b.addEventListener('click', function () { fn(b.getAttribute('data-v')); });
    });
  }
  document.addEventListener('DOMContentLoaded', render);
})();
