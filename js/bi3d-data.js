/* Big Insane 3D · dados compartilhados entre as ferramentas */
(function (root) {
  'use strict';
  var PRINTERS = [
    { id: 'a1mini', name: 'Bambu Lab A1 mini', re: /a1\s*mini/i, bedMax: 80, accMax: 10000, bedslinger: true, family: 'bambu', slicer: 'Bambu Studio' },
    { id: 'a1', name: 'Bambu Lab A1', re: /(bambu[^,;]*\ba1\b|^a1$)/i, bedMax: 100, accMax: 10000, bedslinger: true, family: 'bambu', slicer: 'Bambu Studio' },
    { id: 'kobrax', name: 'Anycubic Kobra X', re: /kobra\s*x/i, bedMax: 100, accMax: 20000, bedslinger: null, family: 'anycubic', slicer: 'Anycubic Slicer Next' },
    { id: 'kobra4', name: 'Anycubic Kobra 4', re: /kobra\s*4/i, bedMax: 100, accMax: 20000, bedslinger: true, family: 'anycubic', slicer: 'Anycubic Slicer Next' },
    { id: 'ad5x', name: 'Flashforge AD5X', re: /ad5x|adventurer\s*5x/i, bedMax: 110, accMax: 20000, bedslinger: false, family: 'flashforge', slicer: 'Orca-Flashforge' },
    { id: 'outra', name: 'Outra impressora', re: /$^/, bedMax: 120, accMax: 20000, bedslinger: null, family: 'outra', slicer: 'seu fatiador' }
  ];
  var MATERIALS = {
    PLA:  { name: 'PLA',  noz: [190, 230], bed: [45, 65], fan: [50, 100], vol: 20, dens: 1.24, temp: 210, bedT: 60, enclosed: false },
    PETG: { name: 'PETG', noz: [225, 255], bed: [70, 90], fan: [20, 60],  vol: 15, dens: 1.27, temp: 240, bedT: 80, enclosed: false },
    TPU:  { name: 'TPU',  noz: [210, 240], bed: [25, 60], fan: [30, 100], vol: 4,  dens: 1.21, temp: 225, bedT: 45, enclosed: false },
    ABS:  { name: 'ABS',  noz: [235, 270], bed: [90, 110], fan: [0, 40],  vol: 18, dens: 1.04, temp: 250, bedT: 100, enclosed: true },
    ASA:  { name: 'ASA',  noz: [235, 270], bed: [90, 110], fan: [0, 40],  vol: 18, dens: 1.07, temp: 255, bedT: 100, enclosed: true }
  };
  function findPrinter(text) {
    text = String(text || '');
    for (var i = 0; i < PRINTERS.length; i++) if (PRINTERS[i].re.test(text)) return PRINTERS[i];
    return null;
  }
  function printerById(id) { for (var i = 0; i < PRINTERS.length; i++) if (PRINTERS[i].id === id) return PRINTERS[i]; return PRINTERS[PRINTERS.length - 1]; }
  function normMaterial(t) {
    t = String(t || '').toUpperCase();
    if (/^PETG|^PET\b|^PCTG/.test(t)) return 'PETG';
    if (/^PLA/.test(t)) return 'PLA';
    if (/^TPU|^TPE/.test(t)) return 'TPU';
    if (/^ABS/.test(t)) return 'ABS';
    if (/^ASA/.test(t)) return 'ASA';
    return null;
  }
  /* Caderno de calibração: fica só no navegador (localStorage) */
  var KEY = 'bi3d_caderno_v1';
  function loadCaderno() { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; } }
  function saveCaderno(list) { try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch (e) { return false; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function num(v) { var x = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isFinite(x) ? x : NaN; }
  function fmt(x, d) { return isFinite(x) ? x.toFixed(d == null ? 1 : d).replace('.', ',') : '—'; }
  root.BI3D = { PRINTERS: PRINTERS, MATERIALS: MATERIALS, findPrinter: findPrinter, printerById: printerById, normMaterial: normMaterial,
    loadCaderno: loadCaderno, saveCaderno: saveCaderno, esc: esc, num: num, fmt: fmt };
})(this);
