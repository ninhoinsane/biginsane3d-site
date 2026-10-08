/* Big Insane 3D · Raio-X do G-code · leitura em segundo plano
   Lê o arquivo em pedaços dentro do navegador. Nada é enviado para servidor. */
importScripts('raiox-core.js?v=20261008e');

self.onmessage = function (ev) {
  var blob = ev.data.blob, opts = ev.data.opts || {};
  var rx = new self.RaioX(opts);
  var total = blob.size, CHUNK = 4 * 1024 * 1024, pos = 0, rest = '';
  var dec = new TextDecoder('utf-8');

  function next() {
    if (pos >= total) {
      rest += dec.decode();
      if (rest) rx.line(rest);
      self.postMessage({ type: 'done', result: rx.finish() });
      return;
    }
    var part = blob.slice(pos, Math.min(total, pos + CHUNK));
    part.arrayBuffer().then(function (buf) {
      pos += buf.byteLength;
      var text = rest + dec.decode(buf, { stream: true });
      var lines = text.split('\n');
      rest = lines.pop();
      for (var i = 0; i < lines.length; i++) rx.line(lines[i]);
      self.postMessage({ type: 'progress', p: pos / total });
      next();
    }).catch(function (e) { self.postMessage({ type: 'error', msg: String(e && e.message || e) }); });
  }
  try { next(); } catch (e) { self.postMessage({ type: 'error', msg: String(e && e.message || e) }); }
};
