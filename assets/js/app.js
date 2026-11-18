(() => {
  'use strict';

  const canvas = document.getElementById('mapCanvas');        // WebGL: daratan (digambar GPU)
  const labelCanvas = document.getElementById('labelCanvas'); // 2D ringan: label + hiasan (+ fallback tanpa WebGL)
  const lctx = labelCanvas.getContext('2d');
  const stage = document.querySelector('.map-stage');
  const loading = document.getElementById('loadingScreen');
  const status = document.getElementById('mapStatus');
  const searchInput = document.getElementById('searchInput');
  const searchResults = document.getElementById('searchResults');
  const infoCard = document.getElementById('infoCard');
  const scaleText = document.getElementById('scaleText');

  // Satu mesin peta untuk empat halaman, dipilih lewat <body data-level="...">:
  //  prov (index.html)      → semua provinsi
  //  kab  (provinsi.html)   → kabupaten/kota milik ?kode=<kode provinsi>
  //  kec  (kabupaten.html)  → kecamatan milik ?kode=<kode kabupaten/kota>   (&prov=&provnama= untuk tombol kembali)
  //  kel  (kecamatan.html)  → kelurahan/desa milik ?kode=<kode kecamatan>   (&kab=&kabnama=&prov=&provnama=)
  const params = new URLSearchParams(location.search);
  const LEVEL = document.body.dataset.level || 'prov';
  const isDetail = LEVEL !== 'prov';
  const provCode = params.get('kode');           // kode induk wilayah yang ditampilkan
  const provName = params.get('nama') || '';     // nama induk
  const upCode = params.get('prov') || '';       // provinsi dari wilayah ini (level kec & kel)
  const upName = params.get('provnama') || '';
  const kabCode = params.get('kab') || '';       // kabupaten/kota dari kecamatan ini (level kel)
  const kabName = params.get('kabnama') || '';
  const enc = encodeURIComponent;
  const LEVELS = {
    prov: {
      unit: 'provinsi', eps: 0.004, url: () => 'assets/data/provinsi.json',
      next: f => `provinsi.html?kode=${enc(f._code)}&nama=${enc(f._name)}`, openLabel: 'Buka peta kabupaten/kota →',
      meta: () => 'Provinsi di wilayah Negara Kesatuan Republik Indonesia. Klik dua kali untuk membuka peta kabupaten/kota.'
    },
    kab: {
      unit: 'kabupaten/kota', eps: 0.0006, url: () => `assets/data/kabupaten/${enc(provCode)}.json`,
      next: f => `kabupaten.html?kode=${enc(f._code)}&nama=${enc(f._name)}&prov=${enc(provCode)}&provnama=${enc(provName)}`,
      openLabel: 'Buka peta kecamatan →',
      meta: () => `Kabupaten/kota di ${provName || 'provinsi ini'}. Klik dua kali untuk membuka peta kecamatan.`
    },
    kec: {
      unit: 'kecamatan', eps: 0.0003, url: () => `assets/data/kecamatan/${enc(provCode)}.json`,
      next: f => `kecamatan.html?kode=${enc(f._code)}&nama=${enc(f._name)}&kab=${enc(provCode)}&kabnama=${enc(provName)}&prov=${enc(upCode)}&provnama=${enc(upName)}`,
      openLabel: 'Buka peta kelurahan/desa →',
      meta: () => `Kecamatan di ${provName || 'wilayah ini'}. Klik dua kali untuk membuka peta kelurahan/desa.`
    },
    kel: {
      // Satu file per kabupaten/kota (2 segmen pertama kode kecamatan), disaring ke kecamatan yang dipilih.
      unit: 'kelurahan/desa', eps: 0.0001,
      url: () => `assets/data/kelurahan/${enc(String(provCode).split('.').slice(0, 2).join('.'))}.json`,
      filter: f => String(getCode(f)).startsWith(provCode + '.'), next: null,
      meta: () => `Kelurahan/desa di Kecamatan ${provName || 'ini'}.`
    }
  };
  const CFG = LEVELS[LEVEL] || LEVELS.prov;
  const UNIT = CFG.unit;

  const state = {
    features: [], selected: null, width: 0, height: 0, dpr: 1,
    zoom: 1, panX: 0, panY: 0, fit: null, dragging: false,
    pointerX: 0, pointerY: 0, moved: false, showLabels: true,
    searchItems: [], raf: 0, useGL: false, vertexData: null
  };

  const rgba = (hex, a = 1) => {
    const n = parseInt(hex.slice(1), 16);
    // premultiplied alpha, sesuai blendFunc(ONE, ONE_MINUS_SRC_ALPHA)
    return [((n >> 16) & 255) / 255 * a, ((n >> 8) & 255) / 255 * a, (n & 255) / 255 * a, a];
  };

  const LAND_TOP = ['#b3cf98', '#9fc58f', '#8bb482', '#7ca77b'];
  const LAND_SIDE = ['#799f78', '#6f9674', '#648a70', '#587e69'];
  const palette = {
    label: '#315b4e',
    outline2d: 'rgba(56,99,78,.68)', sideStroke2d: 'rgba(53,91,70,.22)',
    selectedFill2d: '#d9c18a', selectedStroke2d: '#a97843',
    top: LAND_TOP.map(h => rgba(h)), side: LAND_SIDE.map(h => rgba(h)),
    outline: rgba('#38634e', .68), sideStroke: rgba('#355b46', .22),
    selectedFill: rgba('#d9c18a'), selectedStroke: rgba('#a97843')
  };
  const SIDE_DEPTH = 6;          // tebal sisi 2.5D (px)
  const SIMPLIFY_EPS = CFG.eps;  // buang titik yang lebih rapat dari ini (unit dunia, ± 400 m)

  function setStatus(message, bad = false) {
    status.innerHTML = `<span class="status-dot" style="background:${bad ? '#c77d67' : '#83a979'}"></span><span>${message}</span>`;
  }

  function getFeatures(payload) {
    if (payload?.type === 'FeatureCollection' && Array.isArray(payload.features)) return payload.features;
    if (payload?.data?.type === 'FeatureCollection') return payload.data.features || [];
    if (payload?.geojson?.type === 'FeatureCollection') return payload.geojson.features || [];
    if (Array.isArray(payload?.data)) {
      const geo = payload.data.find(x => x?.type === 'FeatureCollection');
      if (geo) return geo.features || [];
      return payload.data.filter(x => x?.geometry?.coordinates);
    }
    if (Array.isArray(payload?.features)) return payload.features;
    return [];
  }

  // Nama/kode bisa berada di feature.properties (GeoJSON standar) ATAU langsung di objek (format API sendiri),
  // dengan nama field yang bervariasi; kita cari di keduanya, lalu tebak dari nama field.
  function fieldSources(feature) {
    return [feature.properties, feature, feature.attributes, feature.data].filter(o => o && typeof o === 'object');
  }
  function getName(feature) {
    const keys = ['name', 'nama', 'province_name', 'provinsi', 'nama_provinsi', 'wilayah', 'NAME_1', 'NAMOBJ', 'nmprov', 'WADMPR', 'label', 'title'];
    const sources = fieldSources(feature);
    for (const o of sources) for (const k of keys) if (typeof o[k] === 'string' && o[k].trim()) return o[k].trim();
    for (const o of sources) {
      for (const k of Object.keys(o)) {
        if (/(name|nama|nm|prov)/i.test(k) && typeof o[k] === 'string' && o[k].trim() && !/(code|kode|id)$/i.test(k)) return o[k].trim();
      }
    }
    return 'Wilayah tanpa nama';
  }
  function getCode(feature) {
    const keys = ['code', 'kode', 'province_code', 'kode_provinsi', 'KODE_PROV', 'kode_wilayah', 'id'];
    for (const o of fieldSources(feature)) for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k];
    return '—';
  }

  function geometryPolygons(geometry) {
    if (!geometry) return [];
    if (geometry.type === 'Polygon') return [geometry.coordinates];
    if (geometry.type === 'MultiPolygon') return geometry.coordinates;
    return [];
  }

  // Proyeksi: equirectangular dengan shear kecil untuk kesan isometric halus.
  function project(lon, lat) {
    const lon0 = 118, lat0 = -2;
    const x = (lon - lon0) * Math.cos(lat0 * Math.PI / 180) + (lat - lat0) * 0.105;
    const y = -(lat - lat0) + (lon - lon0) * 0.045;
    return [x, y];
  }

  /* ───────────────────────── WebGL ───────────────────────── */

  let gl = null, program = null, vbo = null;
  const loc = {};

  const VERT = `
    attribute vec2 a_pos;
    uniform vec2 u_res;
    uniform vec2 u_center;
    uniform vec2 u_pan;
    uniform vec2 u_off;
    uniform float u_scale;
    void main() {
      vec2 s = u_res * 0.5 + (a_pos - u_center) * u_scale + u_pan + u_off;
      gl_Position = vec4(s.x / u_res.x * 2.0 - 1.0, 1.0 - s.y / u_res.y * 2.0, 0.0, 1.0);
    }`;
  const FRAG = `
    precision mediump float;
    uniform vec4 u_color;
    void main() { gl_FragColor = u_color; }`;

  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) || 'Shader gagal dikompilasi');
    return sh;
  }

  function initGL() {
    try {
      gl = canvas.getContext('webgl', {
        antialias: true, alpha: true, premultipliedAlpha: true,
        stencil: true, depth: false, powerPreference: 'high-performance'
      });
      if (!gl) return false;
      if (!gl.getContextAttributes().stencil) return false;
      program = gl.createProgram();
      gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Program WebGL gagal di-link');
      loc.pos = gl.getAttribLocation(program, 'a_pos');
      for (const n of ['res', 'center', 'pan', 'off', 'scale', 'color']) loc[n] = gl.getUniformLocation(program, 'u_' + n);
      vbo = gl.createBuffer();
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      return true;
    } catch (error) {
      console.warn('WebGL tidak dapat dipakai, beralih ke Canvas 2D:', error);
      gl = null;
      return false;
    }
  }

  function uploadGeometry() {
    if (!gl || !state.vertexData) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, state.vertexData, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc.pos);
    gl.vertexAttribPointer(loc.pos, 2, gl.FLOAT, false, 0, 0);
  }

  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); });
  canvas.addEventListener('webglcontextrestored', () => {
    if (initGL()) { uploadGeometry(); requestRender(); }
  });

  /* ─────────────── Geometri: dibangun sekali, di-upload ke GPU ─────────────── */

  // Setiap provinsi menjadi:
  //  - kipas segitiga per ring  → isi (even-odd) memakai stencil buffer, tanpa triangulasi mahal
  //  - pasangan garis per ring  → outline
  //  - satu quad bounding box   → pengecat isi yang lolos uji stencil
  function buildGeometry() {
    const tri = [], lines = [], quads = [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const eps2 = SIMPLIFY_EPS * SIMPLIFY_EPS;

    for (const f of state.features) {
      f._rings = [];
      f._triStart = tri.length / 2;
      f._lineStart = lines.length / 2;
      let sx = 0, sy = 0, n = 0;
      let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;

      for (const polygon of geometryPolygons(f.geometry)) {
        for (const ring of polygon) {
          const pts = [];
          let lx = NaN, ly = NaN;
          for (let i = 0; i < ring.length; i++) {
            const lon = ring[i][0], lat = ring[i][1];
            sx += lon; sy += lat; n++;
            const [x, y] = project(lon, lat);
            if (i === 0 || (x - lx) * (x - lx) + (y - ly) * (y - ly) >= eps2) { pts.push(x, y); lx = x; ly = y; }
          }
          const m = pts.length / 2;
          if (m < 3) continue;
          const r = Float32Array.from(pts);
          f._rings.push(r);
          for (let i = 0; i < m; i++) {
            const x = r[i * 2], y = r[i * 2 + 1];
            if (x < bx0) bx0 = x; if (x > bx1) bx1 = x;
            if (y < by0) by0 = y; if (y > by1) by1 = y;
            const j = (i + 1) % m;
            lines.push(x, y, r[j * 2], r[j * 2 + 1]);
          }
          for (let i = 1; i < m - 1; i++) tri.push(r[0], r[1], r[i * 2], r[i * 2 + 1], r[i * 2 + 2], r[i * 2 + 3]);
        }
      }

      f._triCount = tri.length / 2 - f._triStart;
      f._lineCount = lines.length / 2 - f._lineStart;
      f._quadStart = quads.length / 2;
      const pad = 0.02;
      f._bbox = [bx0 - pad, by0 - pad, bx1 + pad, by1 + pad];
      const [a, b, c, d] = f._bbox;
      quads.push(a, b, c, b, c, d, a, b, c, d, a, d);
      if (Number.isFinite(bx0)) {
        minX = Math.min(minX, bx0); maxX = Math.max(maxX, bx1);
        minY = Math.min(minY, by0); maxY = Math.max(maxY, by1);
      }
      // Titik label = centroid pulau/daratan terbesar milik provinsi (bukan rata-rata semua titik,
      // yang bisa jatuh di laut untuk provinsi kepulauan).
      let best = null, bestA = 0, totalA = 0;
      for (const r of f._rings) {
        const m = r.length / 2;
        let a2 = 0, cx = 0, cy = 0;
        for (let i = 0; i < m; i++) {
          const j = (i + 1) % m;
          const cr = r[i * 2] * r[j * 2 + 1] - r[j * 2] * r[i * 2 + 1];
          a2 += cr; cx += (r[i * 2] + r[j * 2]) * cr; cy += (r[i * 2 + 1] + r[j * 2 + 1]) * cr;
        }
        const area = Math.abs(a2) / 2;
        totalA += area;
        if (area > bestA && a2 !== 0) { bestA = area; best = [cx / (3 * a2), cy / (3 * a2)]; }
      }
      const lonlat = n ? [sx / n, sy / n] : [118, -2];
      f._cw = best || project(lonlat[0], lonlat[1]); // pusat label (koordinat dunia)
      f._area = totalA;
      f._label = f._name.toUpperCase().replace(/^KABUPATEN\s+/, 'KAB. ');
    }
    state.labelOrder = [...state.features].sort((p, q) => q._area - p._area); // provinsi besar diutamakan

    // Susun satu buffer: [segitiga][garis][quad]
    const triV = tri.length / 2, lineV = lines.length / 2;
    const data = new Float32Array(tri.length + lines.length + quads.length);
    data.set(tri, 0); data.set(lines, tri.length); data.set(quads, tri.length + lines.length);
    for (const f of state.features) { f._lineStart += triV; f._quadStart += triV + lineV; }
    state.vertexData = data;
    state.bounds = Number.isFinite(minX)
      ? { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY } : null;
  }

  async function fetchJson(url) {
    const response = await fetch(url, { headers: { Accept: 'application/geo+json, application/json' } });
    if (!response.ok) throw new Error(`Server data menjawab ${response.status}`);
    return response.json();
  }
  const digits = v => String(v ?? '').replace(/\D/g, '');

  // Membaca file lokal; jika ada beberapa sumber, dicoba berurutan.
  async function fetchRegions() {
    // Sepenuhnya offline: hanya membaca file lokal di assets/data (dibuat oleh tools/*.py).
    const sources = [{ url: CFG.url(), filter: CFG.filter }];
    let lastError = null;
    for (const src of sources) {
      try {
        let list = getFeatures(await fetchJson(src.url)).filter(f => f.geometry && f.geometry.coordinates);
        if (src.filter) list = list.filter(src.filter);
        if (list.length) return list;
        lastError = new Error('Data wilayah tidak ditemukan pada respons.');
      } catch (error) {
        lastError = error;
        console.warn('Sumber data gagal:', src.url, error.message);
      }
    }
    throw lastError || new Error('Data wilayah tidak ditemukan.');
  }

  async function loadProvinces() {
    setStatus(`Mengambil data batas ${UNIT}...`);
    try {
      const features = await fetchRegions();
      console.info('Contoh data wilayah (cek nama field di sini):', Object.keys(features[0]), features[0].properties || {});
      state.features = features.map((feature, index) => ({ ...feature, _id: index, _name: getName(feature), _code: getCode(feature) }));
      state.searchItems = state.features.map(f => ({ name: f._name, code: f._code, feature: f }));
      buildGeometry();
      state.useGL = !!gl;
      if (state.useGL) uploadGeometry();
      scaleText.textContent = `Tampilan kepulauan Indonesia · ${state.useGL ? 'GPU (WebGL)' : 'Canvas 2D'}`;
      resize();
      loading.classList.add('hidden');
      setStatus(`${state.features.length} ${UNIT} siap dijelajahi`);
    } catch (error) {
      console.error(error);
      loading.querySelector('strong').textContent = 'Peta belum dapat dimuat';
      loading.querySelector('span').textContent = `${error.message} Periksa koneksi internet lalu muat ulang halaman.`;
      loading.querySelector('.loader-island').style.display = 'none';
      setStatus('Data wilayah tidak tersedia', true);
    }
  }

  /* ───────────────────────── Ukuran & kamera ───────────────────────── */

  function resize() {
    const rect = stage.getBoundingClientRect();
    state.dpr = Math.min(window.devicePixelRatio || 1, 2);
    state.width = rect.width; state.height = rect.height;
    for (const c of [canvas, labelCanvas]) {
      c.width = Math.round(rect.width * state.dpr);
      c.height = Math.round(rect.height * state.dpr);
      c.style.width = `${rect.width}px`; c.style.height = `${rect.height}px`;
    }
    lctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    if (state.bounds) {
      const b = state.bounds;
      const padX = Math.min(90, state.width * .1);
      const padY = Math.min(105, state.height * .16);
      state.fit = {
        scale: Math.min((state.width - padX * 2) / b.width, (state.height - padY * 2) / b.height),
        cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2
      };
      state.panX = 0; state.panY = 0; state.zoom = 1;
    }
    requestRender();
  }

  function worldToScreen(x, y) {
    const scale = state.fit.scale * state.zoom;
    return [state.width / 2 + (x - state.fit.cx) * scale + state.panX,
      state.height / 2 + (y - state.fit.cy) * scale + state.panY];
  }

  /* ───────────────────────── Render ───────────────────────── */

  // Semua perubahan kamera hanya meminta render; digabung maksimal 1x per frame.
  function requestRender() {
    if (state.raf) return;
    state.raf = requestAnimationFrame(() => { state.raf = 0; render(); });
  }

  function setColor(c) { gl.uniform4f(loc.color, c[0], c[1], c[2], c[3]); }

  function glFill(f, color, offY) {
    gl.uniform2f(loc.off, 0, offY);
    gl.enable(gl.STENCIL_TEST);
    // 1) tandai area dalam (even-odd) di stencil, tanpa menulis warna
    gl.colorMask(false, false, false, false);
    gl.stencilFunc(gl.ALWAYS, 0, 0xff);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.INVERT);
    gl.drawArrays(gl.TRIANGLES, f._triStart, f._triCount);
    // 2) cat bounding quad hanya di area yang ditandai, lalu bersihkan stencil
    gl.colorMask(true, true, true, true);
    gl.stencilFunc(gl.NOTEQUAL, 0, 0xff);
    gl.stencilOp(gl.ZERO, gl.ZERO, gl.ZERO);
    setColor(color);
    gl.drawArrays(gl.TRIANGLES, f._quadStart, 6);
    gl.disable(gl.STENCIL_TEST);
  }

  function glStroke(f, color, offX, offY) {
    gl.uniform2f(loc.off, offX, offY);
    setColor(color);
    gl.drawArrays(gl.LINES, f._lineStart, f._lineCount);
  }

  function renderGL() {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.stencilMask(0xff);
    gl.clearColor(0, 0, 0, 0);
    gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.enableVertexAttribArray(loc.pos);
    gl.vertexAttribPointer(loc.pos, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(loc.res, state.width, state.height);
    gl.uniform2f(loc.center, state.fit.cx, state.fit.cy);
    gl.uniform2f(loc.pan, state.panX, state.panY);
    gl.uniform1f(loc.scale, state.fit.scale * state.zoom);

    for (const f of state.features) {              // sisi 2.5D
      glFill(f, palette.side[f._id % 4], SIDE_DEPTH);
      glStroke(f, palette.sideStroke, 0, SIDE_DEPTH);
    }
    for (const f of state.features) {              // permukaan atas
      if (state.selected === f) continue;
      glFill(f, palette.top[f._id % 4], 0);
      glStroke(f, palette.outline, 0, 0);
    }
    const s = state.selected;                       // yang dipilih digambar terakhir agar outline terlihat
    if (s) {
      glFill(s, palette.selectedFill, 0);
      for (const [dx, dy] of [[-.5, -.5], [.5, -.5], [-.5, .5], [.5, .5]]) glStroke(s, palette.selectedStroke, dx, dy);
    }
  }

  // Fallback bila WebGL tidak tersedia: Path2D dalam koordinat dunia + transform (tanpa hitung ulang titik).
  function getPath(f) {
    if (f._path) return f._path;
    const p = new Path2D();
    for (const r of f._rings) {
      p.moveTo(r[0], r[1]);
      for (let i = 2; i < r.length; i += 2) p.lineTo(r[i], r[i + 1]);
      p.closePath();
    }
    return (f._path = p);
  }

  function render2DMap() {
    const scale = state.fit.scale * state.zoom, px = 1 / scale;
    lctx.save();
    lctx.translate(state.width / 2 + state.panX - state.fit.cx * scale, state.height / 2 + state.panY - state.fit.cy * scale);
    lctx.scale(scale, scale);
    lctx.lineJoin = 'round';
    for (const f of state.features) {
      const path = getPath(f);
      lctx.save(); lctx.translate(0, SIDE_DEPTH * px);
      lctx.fillStyle = LAND_SIDE[f._id % 4]; lctx.strokeStyle = palette.sideStroke2d; lctx.lineWidth = .7 * px;
      lctx.fill(path, 'evenodd'); lctx.stroke(path); lctx.restore();
    }
    for (const f of state.features) {
      const path = getPath(f), sel = state.selected === f;
      lctx.fillStyle = sel ? palette.selectedFill2d : LAND_TOP[f._id % 4];
      lctx.strokeStyle = sel ? palette.selectedStroke2d : palette.outline2d;
      lctx.lineWidth = (sel ? 1.8 : .8) * px;
      lctx.fill(path, 'evenodd'); lctx.stroke(path);
    }
    lctx.restore();
  }

  function renderOverlay() {
    if (!isDetail && state.zoom > .78) {
      lctx.fillStyle = 'rgba(239,239,196,.28)';
      for (const f of state.features) {
        const [x, y] = worldToScreen(f._cw[0], f._cw[1]);
        lctx.beginPath(); lctx.ellipse(x - 2, y - 2, 8 * state.zoom, 2.6 * state.zoom, -.25, 0, Math.PI * 2); lctx.fill();
      }
    }
    if (state.showLabels) {
      // Nama provinsi selalu tampil; ukuran membesar saat zoom, dan label yang bertabrakan
      // disembunyikan (provinsi terbesar didahulukan) sehingga tetap terbaca.
      const size = Math.min(14, 9 + state.zoom * 1.4);
      lctx.textAlign = 'center'; lctx.textBaseline = 'middle';
      lctx.font = `700 ${size}px "DM Sans", sans-serif`;
      lctx.lineWidth = 3.5; lctx.lineJoin = 'round';
      const placed = [];
      for (const f of state.labelOrder || state.features) {
        const [x, y] = worldToScreen(f._cw[0], f._cw[1]);
        if (x < -60 || x > state.width + 60 || y < -20 || y > state.height + 20) continue;
        const w = lctx.measureText(f._label).width / 2 + 3, h = size / 2 + 2;
        const x0 = x - w, x1 = x + w, y0 = y - h, y1 = y + h;
        if (placed.some(p => x0 < p[2] && x1 > p[0] && y0 < p[3] && y1 > p[1])) continue;
        placed.push([x0, y0, x1, y1]);
        lctx.strokeStyle = 'rgba(240,247,240,.92)'; lctx.strokeText(f._label, x, y);
        lctx.fillStyle = palette.label; lctx.fillText(f._label, x, y);
      }
    }
  }

  function render() {
    if (!state.fit || !state.width || !state.height) return;
    lctx.clearRect(0, 0, state.width, state.height);
    if (state.useGL && gl && !gl.isContextLost()) renderGL(); else render2DMap();
    renderOverlay();
  }

  /* ───────────────────────── Interaksi ───────────────────────── */

  // Hit-test even-odd langsung pada data dunia; hanya dijalankan saat klik (bukan tiap frame).
  function pickAt(x, y) {
    const scale = state.fit.scale * state.zoom;
    const wx = (x - state.width / 2 - state.panX) / scale + state.fit.cx;
    const wy = (y - state.height / 2 - state.panY) / scale + state.fit.cy;
    for (let k = state.features.length - 1; k >= 0; k--) {
      const f = state.features[k], b = f._bbox;
      if (wx < b[0] || wx > b[2] || wy < b[1] || wy > b[3]) continue;
      let inside = false;
      for (const r of f._rings) {
        const n = r.length / 2;
        for (let i = 0, j = n - 1; i < n; j = i++) {
          const xi = r[i * 2], yi = r[i * 2 + 1], xj = r[j * 2], yj = r[j * 2 + 1];
          if ((yi > wy) !== (yj > wy) && wx < (xj - xi) * (wy - yi) / (yj - yi) + xi) inside = !inside;
        }
      }
      if (inside) return f;
    }
    return null;
  }

  function selectFeature(feature, zoomTo = false) {
    state.selected = feature;
    document.getElementById('regionName').textContent = feature._name;
    document.getElementById('regionMeta').textContent = CFG.meta();
    document.getElementById('regionCode').textContent = `KODE ${feature._code}`;
    infoCard.classList.add('visible');
    if (zoomTo) {
      state.zoom = Math.max(state.zoom, 2.1);
      const scale = state.fit.scale * state.zoom;
      state.panX = -(feature._cw[0] - state.fit.cx) * scale;
      state.panY = -(feature._cw[1] - state.fit.cy) * scale;
    }
    requestRender();
    setStatus(`Wilayah dipilih: ${feature._name}`);
  }

  function zoomAt(factor, x = state.width / 2, y = state.height / 2) {
    if (!state.fit) return;
    const old = state.zoom; const next = Math.max(.65, Math.min(5.5, old * factor));
    if (next === old) return;
    const ratio = next / old;
    state.panX = x - (x - state.panX - state.width / 2) * ratio - state.width / 2;
    state.panY = y - (y - state.panY - state.height / 2) * ratio - state.height / 2;
    state.zoom = next; requestRender();
  }

  function resetView() {
    if (!state.fit) return;
    state.zoom = 1; state.panX = 0; state.panY = 0; state.selected = null;
    infoCard.classList.remove('visible'); requestRender(); setStatus(`${state.features.length} ${UNIT} siap dijelajahi`);
  }

  canvas.addEventListener('pointerdown', event => {
    state.dragging = true; state.moved = false; state.pointerX = event.clientX; state.pointerY = event.clientY;
    canvas.classList.add('dragging'); canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', event => {
    if (!state.dragging) return;
    const dx = event.clientX - state.pointerX, dy = event.clientY - state.pointerY;
    if (Math.abs(dx) + Math.abs(dy) > 2) state.moved = true;
    state.panX += dx; state.panY += dy; state.pointerX = event.clientX; state.pointerY = event.clientY; requestRender();
  });
  canvas.addEventListener('pointerup', event => {
    state.dragging = false; canvas.classList.remove('dragging');
    if (!state.moved && state.fit) {
      const rect = canvas.getBoundingClientRect();
      const hit = pickAt(event.clientX - rect.left, event.clientY - rect.top);
      if (hit) selectFeature(hit);
    }
  });
  canvas.addEventListener('pointercancel', () => { state.dragging = false; canvas.classList.remove('dragging'); });
  canvas.addEventListener('wheel', event => { event.preventDefault(); const rect = canvas.getBoundingClientRect(); zoomAt(event.deltaY < 0 ? 1.12 : .89, event.clientX - rect.left, event.clientY - rect.top); }, { passive: false });

  document.getElementById('zoomIn').addEventListener('click', () => zoomAt(1.22));
  document.getElementById('zoomOut').addEventListener('click', () => zoomAt(.82));
  document.getElementById('resetView').addEventListener('click', resetView);
  document.getElementById('northReset').addEventListener('click', resetView);
  document.getElementById('closeCard').addEventListener('click', () => infoCard.classList.remove('visible'));
  document.getElementById('toggleLabels').addEventListener('click', () => { state.showLabels = !state.showLabels; requestRender(); });

  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLocaleLowerCase('id');
    if (!q) { searchResults.classList.remove('show'); searchResults.innerHTML = ''; return; }
    const matches = state.searchItems.filter(item => item.name.toLocaleLowerCase('id').includes(q)).slice(0, 7);
    searchResults.innerHTML = matches.length ? matches.map((item, index) => `<div class="search-result" data-index="${index}">${item.name}</div>`).join('') : '<div class="search-result">Wilayah tidak ditemukan</div>';
    searchResults.classList.add('show');
    [...searchResults.querySelectorAll('.search-result[data-index]')].forEach(el => el.addEventListener('click', () => {
      const item = matches[Number(el.dataset.index)]; selectFeature(item.feature, true); searchInput.value = item.name; searchResults.classList.remove('show');
    }));
  });
  searchInput.addEventListener('keydown', event => { if (event.key === 'Enter') { const first = searchResults.querySelector('[data-index="0"]'); if (first) first.click(); } if (event.key === 'Escape') searchResults.classList.remove('show'); });
  document.addEventListener('click', event => { if (!event.target.closest('.search-panel')) searchResults.classList.remove('show'); });

  const aboutDialog = document.getElementById('aboutDialog');
  document.getElementById('aboutButton').addEventListener('click', () => aboutDialog.showModal());
  document.getElementById('closeAbout').addEventListener('click', () => aboutDialog.close());
  // Turun satu tingkat (klik dua kali pada peta, atau tombol di kartu info). Tingkat terdalam tidak punya "next".
  function openNext(f) {
    if (!f || !CFG.next) return;
    location.href = CFG.next(f);
  }
  canvas.addEventListener('dblclick', event => {
    if (!CFG.next || !state.fit) return;
    const rect = canvas.getBoundingClientRect();
    openNext(pickAt(event.clientX - rect.left, event.clientY - rect.top));
  });
  const openBtn = document.getElementById('openRegion');
  if (openBtn) openBtn.addEventListener('click', () => openNext(state.selected));

  function applyModeUI() {
    if (openBtn) { if (CFG.next) openBtn.textContent = CFG.openLabel; else openBtn.style.display = 'none'; }
    if (!isDetail) return;
    document.title = `${provName || 'Wilayah'} — Terra Indonesia`;
    const title = document.getElementById('headTitle');
    if (title) {
      const em = document.createElement('em'); em.textContent = { kab: 'kabupaten & kota', kec: 'kecamatan', kel: 'kelurahan & desa' }[LEVEL];
      const head = LEVEL === 'kel' ? `Kec. ${provName || 'Wilayah'}` : (provName || 'Wilayah');
      title.textContent = ''; title.append(document.createTextNode(head), document.createElement('br'), em);
    }
    const eyebrow = document.querySelector('.map-heading .eyebrow');
    if (eyebrow) eyebrow.textContent = ({ kab: 'PETA PROVINSI', kec: upName || 'PETA KABUPATEN/KOTA', kel: kabName || 'PETA KECAMATAN' }[LEVEL]).toUpperCase();
    const back = document.getElementById('backLink');
    if (back) {
      if (LEVEL === 'kel' && kabCode) {
        back.href = `kabupaten.html?kode=${enc(kabCode)}&nama=${enc(kabName)}&prov=${enc(upCode)}&provnama=${enc(upName)}`;
        back.textContent = `← ${kabName || 'Kecamatan'}`;
      } else if (LEVEL === 'kec' && upCode) { back.href = `provinsi.html?kode=${enc(upCode)}&nama=${enc(upName)}`; back.textContent = `← ${upName || 'Kabupaten/kota'}`; }
      else { back.href = 'index.html'; back.textContent = '← Semua provinsi'; }
    }
    const kicker = document.querySelector('.card-kicker'); if (kicker) kicker.textContent = `${UNIT.toUpperCase()} TERPILIH`;
    searchInput.placeholder = `Cari ${UNIT}...`; searchInput.setAttribute('aria-label', `Cari ${UNIT}`);
  }
  applyModeUI();
  window.addEventListener('resize', resize);

  initGL();
  loadProvinces();
})();
