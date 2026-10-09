/* Big Insane 3D · visualizador 3D (three.js r128, MIT). Mostra a peça sobre a mesa da impressora. */
(function (root) {
  'use strict';
  var current = null;

  function dispose() {
    if (!current) return;
    cancelAnimationFrame(current.raf);
    if (current.ro) current.ro.disconnect();
    current.controls.dispose();
    current.scene.traverse(function (o) { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    current.renderer.dispose();
    if (current.renderer.domElement.parentNode) current.renderer.domElement.parentNode.removeChild(current.renderer.domElement);
    current = null;
  }

  /* meshes: [{ tri: Float32Array (coordenadas na mesa, mm), color: '#hex', overhang: true }] ; bed: [largura, profundidade] */
  function show(el, meshes, bed, opts) {
    opts = opts || {};
    dispose();
    var W = el.clientWidth || 600, H = el.clientHeight || 380;
    var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(W, H);
    el.appendChild(renderer.domElement);
    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(38, W / H, 1, 5000);
    camera.up.set(0, 0, 1);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x30343a, 0.85));
    var sun = new THREE.DirectionalLight(0xffffff, 0.75); sun.position.set(-200, -300, 500); scene.add(sun);
    var fill = new THREE.DirectionalLight(0xffb070, 0.25); fill.position.set(300, 200, 150); scene.add(fill);

    // mesa
    var bw = bed[0], bd = bed[1];
    var plate = new THREE.Mesh(new THREE.PlaneGeometry(bw, bd), new THREE.MeshStandardMaterial({ color: 0x1b1f26, roughness: 0.95 }));
    plate.position.set(bw / 2, bd / 2, -0.3); scene.add(plate);
    var grid = new THREE.GridHelper(Math.max(bw, bd), Math.round(Math.max(bw, bd) / 20), 0x3a404a, 0x262b33);
    grid.rotation.x = Math.PI / 2; grid.position.set(bw / 2, bd / 2, -0.2); scene.add(grid);
    var edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(bw, bd, 0.01)), new THREE.LineBasicMaterial({ color: 0xff6a1a }));
    edge.position.set(bw / 2, bd / 2, -0.25); scene.add(edge);

    var box = new THREE.Box3();
    meshes.forEach(function (m) {
      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(m.tri, 3));
      g.computeVertexNormals();
      var mat;
      if (m.overhang) {
        var n = m.tri.length / 9, col = new Float32Array(m.tri.length), base = new THREE.Color(m.color || '#d8d3cc'), red = new THREE.Color('#ff4d3d');
        var zmin = Infinity; for (var i = 2; i < m.tri.length; i += 3) if (m.tri[i] < zmin) zmin = m.tri[i];
        for (var f = 0; f < n; f++) {
          var o = f * 9, ux = m.tri[o + 3] - m.tri[o], uy = m.tri[o + 4] - m.tri[o + 1], uz = m.tri[o + 5] - m.tri[o + 2];
          var vx = m.tri[o + 6] - m.tri[o], vy = m.tri[o + 7] - m.tri[o + 1], vz = m.tri[o + 8] - m.tri[o + 2];
          var cz = ux * vy - uy * vx, l = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, cz) || 1;
          var lo = Math.min(m.tri[o + 2], m.tri[o + 5], m.tri[o + 8]);
          var c = (cz / l < -0.7071 && lo - zmin > 0.3) ? red : base;
          for (var k = 0; k < 3; k++) { col[o + k * 3] = c.r; col[o + k * 3 + 1] = c.g; col[o + k * 3 + 2] = c.b; }
        }
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.05, flatShading: m.tri.length / 9 < 4000 });
      } else {
        mat = new THREE.MeshStandardMaterial({ color: m.color || '#d8d3cc', roughness: 0.6, metalness: 0.05 });
      }
      g.computeBoundingBox();
      (m.positions || [[0, 0]]).forEach(function (p) {
        var mesh = new THREE.Mesh(g, mat); mesh.position.set(p[0], p[1], 0); scene.add(mesh);
        var bb = g.boundingBox.clone(); bb.min.x += p[0]; bb.max.x += p[0]; bb.min.y += p[1]; bb.max.y += p[1]; box.union(bb);
      });
    });

    var center = new THREE.Vector3(); box.getCenter(center);
    if (!isFinite(center.x)) center.set(bw / 2, bd / 2, 0);
    var size = new THREE.Vector3(); box.getSize(size);
    var span = Math.max(size.x, size.y, size.z, 40), fitBed = opts.showBed ? Math.max(bw, bd) * 0.9 : 0;
    var dist = Math.max(span * 2.1, fitBed * 1.4);
    camera.position.set(center.x - dist * 0.55, center.y - dist * 0.85, center.z + dist * 0.6);
    var controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.target.copy(center); controls.enableDamping = true; controls.dampingFactor = 0.08;
    controls.autoRotate = opts.autoRotate !== false; controls.autoRotateSpeed = 1.6;
    controls.minDistance = 10; controls.maxDistance = 3000;
    var stop = function () { controls.autoRotate = false; };
    renderer.domElement.addEventListener('pointerdown', stop); renderer.domElement.addEventListener('wheel', stop, { passive: true });
    controls.update();

    current = { renderer: renderer, scene: scene, camera: camera, controls: controls, raf: 0 };
    (function loop() { current.raf = requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); })();
    if (window.ResizeObserver) {
      current.ro = new ResizeObserver(function () {
        var w = el.clientWidth, h = el.clientHeight; if (!w || !h) return;
        renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
      });
      current.ro.observe(el);
    }
  }

  root.BI3D_VIEW = { show: show, dispose: dispose };
})(this);
