/* Big Insane 3D · menu lateral (abre e fecha no celular) */
(function () {
  'use strict';
  function ready(fn) { if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn); }
  ready(function () {
    var body = document.body, btn = document.getElementById('menu-btn'), shade = document.getElementById('side-shade');
    if (!btn) return;
    function set(open) { body.classList.toggle('side-open', open); btn.setAttribute('aria-expanded', open ? 'true' : 'false'); }
    btn.addEventListener('click', function () { set(!body.classList.contains('side-open')); });
    if (shade) shade.addEventListener('click', function () { set(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') set(false); });
    Array.prototype.forEach.call(document.querySelectorAll('.side a'), function (a) { a.addEventListener('click', function () { set(false); }); });
  });
})();
