/* Big Insane 3D · Caderno de calibração (salvo só no navegador) */
(function () {
  'use strict';
  var B = window.BI3D, esc = B.esc, num = B.num, fmt = B.fmt;
  var $ = function (id) { return document.getElementById(id); };
  var FIELDS = ['name', 'printer', 'mat', 'nozzle', 'temp', 'bed', 'pa', 'flow', 'vol', 'retr', 'fan', 'date', 'notes'];
  var editing = null;

  function today() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function msg(t) { $('cd-msg').textContent = t; }

  function fillDefaults() {
    var m = B.MATERIALS[$('cd-mat').value];
    if (!m) return;
    if (!$('cd-temp').value) $('cd-temp').placeholder = m.temp;
    $('cd-bed').placeholder = m.bedT; $('cd-vol').placeholder = m.vol; $('cd-fan').placeholder = m.fan[1];
  }

  function read() {
    var o = {};
    FIELDS.forEach(function (f) { o[f] = $('cd-' + f).value.trim(); });
    o.material = o.mat; delete o.mat;
    return o;
  }
  function write(o) {
    FIELDS.forEach(function (f) { var k = f === 'mat' ? 'material' : f; $('cd-' + f).value = o && o[k] != null ? o[k] : ''; });
    if (!o) { $('cd-nozzle').value = '0,4'; $('cd-date').value = today(); }
    fillDefaults();
  }

  function validate(o) {
    if (!o.name) return 'Dê um nome ao filamento (marca e cor).';
    var checks = [['temp', 150, 320, 'Temperatura do bico'], ['bed', 0, 130, 'Mesa'], ['pa', 0, 2, 'Pressure advance'], ['flow', 0.5, 1.5, 'Flow ratio'], ['vol', 0.5, 80, 'Fluxo volumétrico'], ['retr', 0, 10, 'Retração'], ['fan', 0, 100, 'Ventoinha'], ['nozzle', 0.1, 1.2, 'Bico']];
    for (var i = 0; i < checks.length; i++) {
      var c = checks[i], v = o[c[0]];
      if (v === '') continue;
      var n = num(v);
      if (!isFinite(n) || n < c[1] || n > c[2]) return c[3] + ' fora do esperado (' + c[1] + ' a ' + c[2] + ').';
    }
    return null;
  }

  function save() {
    var o = read(), err = validate(o);
    if (err) { msg(err); return; }
    var list = B.loadCaderno();
    if (editing != null && list[editing]) list[editing] = o; else list.push(o);
    if (!B.saveCaderno(list)) { msg('Não consegui salvar. O navegador pode estar em modo anônimo ou com armazenamento bloqueado.'); return; }
    msg('Salvo: ' + o.name + '.');
    editing = null; $('cd-ftitle').textContent = 'Novo filamento'; write(null); list_();
  }

  function list_() {
    var list = B.loadCaderno(), box = $('cd-list');
    if (!list.length) { box.innerHTML = '<p class="rx-note">Nenhum filamento salvo ainda.</p>'; return; }
    var h = '<div class="tbl"><table><tr><th>Filamento</th><th>Impressora</th><th>Bico / mesa</th><th>PA</th><th>Flow</th><th>Fluxo máx.</th><th>Retração</th><th></th></tr>';
    list.forEach(function (o, i) {
      var p = B.printerById(o.printer);
      h += '<tr><td><b>' + esc(o.name) + '</b><br><span class="rx-note">' + esc(o.material || '') + ' · bico ' + esc(o.nozzle || '') + ' · ' + esc(o.date || '') + '</span>' + (o.notes ? '<br><span class="rx-note">' + esc(o.notes) + '</span>' : '') + '</td>' +
        '<td>' + esc(p.name) + '</td><td>' + esc(o.temp || '—') + ' / ' + esc(o.bed || '—') + ' °C</td><td>' + esc(o.pa || '—') + '</td><td>' + esc(o.flow || '—') + '</td><td>' + esc(o.vol || '—') + '</td><td>' + esc(o.retr || '—') + '</td>' +
        '<td style="white-space:nowrap"><button type="button" class="copy" style="position:static" data-a="ed" data-i="' + i + '">editar</button> <button type="button" class="copy" style="position:static" data-a="cp" data-i="' + i + '">copiar</button> <button type="button" class="copy" style="position:static" data-a="rm" data-i="' + i + '">apagar</button></td></tr>';
    });
    box.innerHTML = h + '</table></div>';
    Array.prototype.forEach.call(box.querySelectorAll('button'), function (b) {
      b.addEventListener('click', function () {
        var i = +b.getAttribute('data-i'), a = b.getAttribute('data-a'), l = B.loadCaderno(), o = l[i];
        if (!o) return;
        if (a === 'ed') { editing = i; write(o); $('cd-ftitle').textContent = 'Editando: ' + o.name; $('cd-form').scrollIntoView({ behavior: 'smooth' }); }
        if (a === 'rm' && confirm('Apagar "' + o.name + '" do caderno?')) { l.splice(i, 1); B.saveCaderno(l); list_(); }
        if (a === 'cp') {
          var t = o.name + '\nBico: ' + (o.temp || '—') + ' °C | Mesa: ' + (o.bed || '—') + ' °C\nPressure advance: ' + (o.pa || '—') + ' | Flow ratio: ' + (o.flow || '—') +
            '\nFluxo volumétrico máx.: ' + (o.vol || '—') + ' mm³/s | Retração: ' + (o.retr || '—') + ' mm | Ventoinha máx.: ' + (o.fan || '—') + '%';
          try { navigator.clipboard.writeText(t).then(function () { b.textContent = 'copiado'; setTimeout(function () { b.textContent = 'copiar'; }, 1500); }); } catch (e) {}
        }
      });
    });
  }

  function exportJSON() {
    var data = { app: 'biginsane3d-caderno', versao: 1, exportado: new Date().toISOString(), filamentos: B.loadCaderno() };
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = 'caderno-calibracao-' + today() + '.json';
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function importJSON(file) {
    if (file.size > 2 * 1024 * 1024) { msg('Arquivo grande demais para um caderno.'); return; }
    var r = new FileReader();
    r.onload = function () {
      try {
        var d = JSON.parse(r.result), arr = Array.isArray(d) ? d : d.filamentos;
        if (!Array.isArray(arr)) throw new Error('formato');
        var clean = arr.filter(function (o) { return o && typeof o === 'object' && typeof o.name === 'string'; }).map(function (o) {
          var c = {}; ['name', 'printer', 'material', 'nozzle', 'temp', 'bed', 'pa', 'flow', 'vol', 'retr', 'fan', 'date', 'notes'].forEach(function (k) { c[k] = o[k] == null ? '' : String(o[k]).slice(0, 200); });
          return c;
        });
        var list = B.loadCaderno().concat(clean);
        B.saveCaderno(list); list_(); msg(clean.length + ' filamento(s) importado(s).');
      } catch (e) { msg('Esse arquivo não é um caderno válido.'); }
    };
    r.readAsText(file);
  }

  function flowCalc() {
    var cur = num($('cd-fcur').value), w = num($('cd-fw').value), m = num($('cd-fm').value), o = $('cd-fout');
    if (!(cur > 0 && w > 0 && m > 0)) { o.innerHTML = 'Digite a média medida.'; return; }
    var nf = cur * w / m;
    o.innerHTML = 'Novo flow ratio: <b>' + fmt(nf, 2) + '</b> <button type="button" class="copy" style="position:static" id="cd-use">usar no caderno</button>';
    $('cd-use').onclick = function () { $('cd-flow').value = fmt(nf, 2); };
  }

  document.addEventListener('DOMContentLoaded', function () {
    $('cd-printer').innerHTML = B.PRINTERS.map(function (p) { return '<option value="' + p.id + '">' + esc(p.name) + '</option>'; }).join('');
    $('cd-mat').innerHTML = Object.keys(B.MATERIALS).map(function (k) { return '<option>' + k + '</option>'; }).join('');
    $('cd-mat').addEventListener('change', fillDefaults);
    write(null);
    $('cd-save').onclick = save;
    $('cd-clear').onclick = function () { editing = null; $('cd-ftitle').textContent = 'Novo filamento'; write(null); msg(''); };
    $('cd-export').onclick = exportJSON;
    $('cd-import').onclick = function () { $('cd-ifile').click(); };
    $('cd-ifile').addEventListener('change', function () { if (this.files[0]) importJSON(this.files[0]); this.value = ''; });
    ['cd-fcur', 'cd-fw', 'cd-fm'].forEach(function (id) { $(id).addEventListener('input', flowCalc); });
    list_();
  });
})();
