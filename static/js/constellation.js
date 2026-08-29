/* ============================================================================
   HajibagheriLabs homepage — scroll-driven 3D particle constellation, v2.

   The ONE place a library is used: Three.js, lazy-loaded from a CDN via the
   import map in the page <head>. No build step. Everything else on the page
   stays vanilla JS. This file owns ONLY the homepage constellation.

   TECHNIQUE
   - One THREE.Points cloud with a custom ShaderMaterial. Every particle is a
     HOLLOW, stroke-only triangle sprite (canvas-generated texture, rotated
     per-particle in the fragment shader). Never filled dots.
   - Particle positions come from MeshSurfaceSampler over three source meshes:
       brain  = two wrinkled ("gyri") sphere lobes + a parametric stem curve
       bulb   = LatheGeometry (dome, neck, screw base), tilted like the ref
       globe  = sphere whose samples are kept only where a coarse ASCII
                continent map says "land" (oceans stay near-empty)
   - Morphing: ONE buffer, three position attribute sets (aPos1/aPos2 +
     `position` as shape 0), blended in the vertex shader by a scroll-driven
     uProgress with per-particle stagger + mid-flight bowing so it's organic.
   - Per-particle color is chosen per SHAPE (three color attributes) from the
     reference palette — yellow / violet / white / teal / magenta — with
     per-shape spatial weighting (bulb: amber crown, bone body, violet-teal
     neck; brain: yellow gyri crests; globe: even mix on land).
   - Sizes: mostly tiny, ~2% large accents. Each triangle slowly spins.
   - A second sparse Points cloud drifts in the void around the shape.
   - The whole system slowly spins about each shape's own axis; genuine depth
     via perspective size attenuation + mild depth fade.

   Behaviors: text RIGHT / shape LEFT in all sections (RTL), canvas fades out
   past the end of the wrapper, per-section text fade, reduced-motion = one
   static shape, pause off-screen, DPR clamp, mobile = fewer particles.
   ========================================================================== */
(function () {
  "use strict";

  // ===========================================================================
  // CONFIG
  // ===========================================================================
  var CONFIG = {
    count: 14000,          // shape particles (desktop)
    mobileCount: 4800,
    ambientCount: 240,     // drifting void particles (desktop)
    mobileAmbientCount: 90,

    cameraZ: 3.3,
    fov: 50,
    dprMax: 2,

    spinSpeed: 0.06,       // rad/s about the current shape's own axis
    mouseParallax: 0.28,   // world units of camera sway (desktop only)
    scrollDolly: 0.25,     // subtle camera push across the whole scroll
    heroShiftX: -0.88,     // shape sits LEFT, text RIGHT (desktop, RTL)

    // Reference palette (brighter than UI tokens so additive points read).
    palette: {
      yellow: 0xffc042,
      violet: 0x8f66ff,
      white: 0xf5f2ff,
      teal: 0x2ec5a2,
      magenta: 0xd45fc4,
    },
  };

  // Coarse equirectangular continent map (64x32, '#'=land) for the globe.
  // Row 0 = 90..84N … row 31 = 84..90S. Deliberately low-res: the reference
  // only needs "continents dense, oceans empty", not cartographic accuracy.
  var WORLD_MAP = [
    "................................................................",
    "............####......######.......#............................",
    "...........#######...########......#...........##########.......",
    "..#####.##########...#######.....############################...",
    ".##################...#####.##...##############################.",
    ".##################.....#.....#..###############################",
    "......########..####.........##################################.",
    "........#############.........##############################....",
    "........#############........###.##########################.....",
    ".........###########.........##..##.######################......",
    "..........##########........#############################.......",
    "...........######.#........#################.###########........",
    "............#####.........#################.###########.........",
    "..............###.........###########.####...###...#####........",
    "...............####........##############.....#....###.##.......",
    "................######........###########..........######.###...",
    "................##########.....##########..........###########..",
    "................##########.....##########...........####...##...",
    "................#########......#########.#..........#######.....",
    ".................#######.......########..#.........#########....",
    ".................######.........######.............#########....",
    ".................#####..........#####..............#######..#...",
    ".................####............###...................###..##..",
    ".................###....................................#...##..",
    ".................###............................................",
    ".................##.............................................",
    "................................................................",
    "................................................................",
    "................................................................",
    "....######....########....#######......########....######.......",
    "################################################################",
    "################################################################",
  ];

  // ===========================================================================
  var wrapper = document.querySelector("[data-constellation]");
  var canvas = document.querySelector("[data-constellation-canvas]");
  if (!wrapper || !canvas) {
    return;
  }

  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var isMobile = window.matchMedia("(max-width: 899px)").matches;
  var textEls = mapTextBySection();

  if (!hasWebGL()) {
    canvas.style.display = "none";
    showAllText();
    return;
  }

  var THREE = null;
  var renderer, scene, camera, group, points, ambient;
  var shapeMat, ambientMat;
  var N = isMobile ? CONFIG.mobileCount : CONFIG.count;
  var NA = isMobile ? CONFIG.mobileAmbientCount : CONFIG.ambientCount;
  var running = false;
  var inView = true;
  var rafId = null;
  var lastT = 0;
  var globalT = 0;   // scroll progress 0..2 (shape index space)
  var spinT = 0;     // accumulated spin angle
  var groupX = 0;
  var mouse = { x: 0, y: 0 };
  var camOff = { x: 0, y: 0 };

  // Per-shape orientation: spin axis (own axis after baked tilt) + initial yaw
  // so the brain opens on its side profile like the reference.
  var SHAPE_AXES = [
    [0, 1, 0],                                    // brain: upright
    [-Math.sin(0.47), Math.cos(0.47), 0],         // bulb: tilted axis
    [Math.sin(-0.18), Math.cos(-0.18), 0],        // globe: slight axial tilt
  ];
  // brain: side profile; bulb: slight turn; globe: face the land-rich
  // hemisphere (Europe/Africa/Asia) instead of the empty Atlantic.
  var SHAPE_YAW = [-1.45, 0.35, -0.6];

  init();

  async function init() {
    try {
      THREE = await import("three");
    } catch (e) {
      canvas.style.display = "none";
      showAllText();
      return;
    }

    var samplerMod;
    try {
      samplerMod = await import("three/addons/math/MeshSurfaceSampler.js");
    } catch (e) {
      canvas.style.display = "none";
      showAllText();
      return;
    }
    var MeshSurfaceSampler = samplerMod.MeshSurfaceSampler;

    setupThree();
    buildShapePoints(MeshSurfaceSampler);
    buildAmbientPoints();

    if (reducedMotion) {
      // ONE static shape (brain), centered, no motion at all.
      group.position.x = 0;
      applyOrientation(0);
      showAllText();
      resize();
      renderer.render(scene, camera);
      var staticFade = function () {
        fadeCanvas(wrapper.getBoundingClientRect(), window.innerHeight);
      };
      staticFade();
      window.addEventListener("scroll", staticFade, { passive: true });
      window.addEventListener("resize", debounce(function () {
        resize();
        renderer.render(scene, camera);
        staticFade();
      }, 200));
      return;
    }

    resize();
    window.addEventListener("resize", debounce(resize, 150));
    if (!isMobile) {
      window.addEventListener("mousemove", onMouse, { passive: true });
    }

    var io = new IntersectionObserver(function (entries) {
      inView = entries[0].isIntersecting;
      canvas.classList.toggle("is-paused", !inView);
      if (inView && !document.hidden) {
        start();
      } else {
        stop();
      }
    }, { threshold: 0 });
    io.observe(wrapper);

    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        stop();
      } else if (inView) {
        start();
      }
    });

    start();
  }

  // ---- Three.js setup -------------------------------------------------------
  function setupThree() {
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    renderer.setClearColor(0x000000, 0);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(CONFIG.fov, 1, 0.1, 100);
    camera.position.z = CONFIG.cameraZ;
    group = new THREE.Group();
    scene.add(group);
  }

  // ---- Hollow triangle sprite (shared by both clouds) -----------------------
  function makeTriangleTexture() {
    var S = 128;
    var c = document.createElement("canvas");
    c.width = S;
    c.height = S;
    var ctx = c.getContext("2d");
    ctx.clearRect(0, 0, S, S);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 5;
    ctx.lineJoin = "round";
    var cx = S / 2, cy = S / 2, R = 46;
    ctx.beginPath();
    for (var k = 0; k < 3; k++) {
      var a = -Math.PI / 2 + (k * 2 * Math.PI) / 3;
      var x = cx + R * Math.cos(a);
      var y = cy + R * Math.sin(a);
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
    var tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 4;
    return tex;
  }

  // ---- Shaders --------------------------------------------------------------
  // Fragment is shared: rotate the sprite UV per particle, sample the hollow
  // triangle, tint, fade.
  var FRAG = [
    "uniform sampler2D uTex;",
    "uniform float uOpacity;",
    "varying vec3 vColor;",
    "varying float vAlpha;",
    "varying float vRot;",
    "void main() {",
    "  vec2 uv = gl_PointCoord - 0.5;",
    "  float s = sin(vRot), c = cos(vRot);",
    "  uv = mat2(c, -s, s, c) * uv + 0.5;",
    "  float a = texture2D(uTex, uv).a;",
    "  if (a < 0.02) discard;",
    "  gl_FragColor = vec4(vColor, a * vAlpha * uOpacity);",
    "}",
  ].join("\n");

  // Shape cloud vertex shader: 3-way morph + stagger + bow + spin about the
  // current shape axis + breathing drift + size attenuation + depth fade.
  var SHAPE_VERT = [
    "uniform float uProgress;",   // 0..2 across the three sections
    "uniform float uTime;",
    "uniform float uPixelScale;", // drawingBufferHeight / (2*tan(fov/2))
    "uniform vec3 uAxis;",        // current spin axis (lerped per frame)
    "uniform float uAngle;",      // current spin angle (incl. per-shape yaw)
    "attribute vec3 aPos1;",
    "attribute vec3 aPos2;",
    "attribute vec3 aCol0;",
    "attribute vec3 aCol1;",
    "attribute vec3 aCol2;",
    "attribute float aSize;",
    "attribute vec4 aRand;",      // x stagger, y spin speed, z rot0, w phase
    "varying vec3 vColor;",
    "varying float vAlpha;",
    "varying float vRot;",
    "float stag(float t, float s) {",
    "  float k = 0.45;",          // stagger spread: particles depart in waves
    "  float u = clamp(t * (1.0 + k) - s * k, 0.0, 1.0);",
    "  return u * u * (3.0 - 2.0 * u);",
    "}",
    "vec3 rotAxis(vec3 v, vec3 ax, float ang) {",
    "  float c = cos(ang), s = sin(ang);",
    "  return v * c + cross(ax, v) * s + ax * dot(ax, v) * (1.0 - c);",
    "}",
    "void main() {",
    "  float t0 = stag(clamp(uProgress, 0.0, 1.0), aRand.x);",
    "  float t1 = stag(clamp(uProgress - 1.0, 0.0, 1.0), aRand.x);",
    "  vec3 p = mix(mix(position, aPos1, t0), aPos2, t1);",
    "  vec3 col = mix(mix(aCol0, aCol1, t0), aCol2, t1);",
    // bow outward mid-flight so morphs read organic, not linear
    "  float bow = sin(t0 * 3.14159) + sin(t1 * 3.14159);",
    "  p += normalize(p + vec3(0.0001)) * bow * (0.10 + 0.30 * fract(aRand.w * 7.13));",
    // slow spin of the whole constellation about the shape's own axis
    "  p = rotAxis(p, uAxis, uAngle);",
    // breathing: tiny individual drift so the cloud is never frozen
    "  p += 0.016 * vec3(",
    "    sin(uTime * 0.35 + aRand.w * 6.2831),",
    "    cos(uTime * 0.28 + aRand.w * 12.566),",
    "    sin(uTime * 0.31 + aRand.w * 9.4247));",
    "  vec4 mv = modelViewMatrix * vec4(p, 1.0);",
    "  float dist = max(-mv.z, 0.6);",
    "  gl_PointSize = clamp(aSize * uPixelScale / dist, 1.0, 220.0);",
    "  float fade = smoothstep(5.2, 2.4, dist);",   // mild depth fade
    "  vAlpha = mix(0.30, 1.0, fade);",
    "  vColor = col;",
    "  vRot = aRand.z + uTime * aRand.y;",          // slow individual spin
    "  gl_Position = projectionMatrix * mv;",
    "}",
  ].join("\n");

  // Ambient cloud vertex shader: anchored particles that wander slowly.
  var AMBIENT_VERT = [
    "uniform float uTime;",
    "uniform float uPixelScale;",
    "attribute vec3 aColor;",
    "attribute float aSize;",
    "attribute vec4 aRand;",      // x drift amp, y spin speed, z rot0, w phase
    "varying vec3 vColor;",
    "varying float vAlpha;",
    "varying float vRot;",
    "void main() {",
    "  vec3 p = position + aRand.x * vec3(",
    "    sin(uTime * 0.11 + aRand.w * 6.2831),",
    "    sin(uTime * 0.09 + aRand.w * 12.566),",
    "    sin(uTime * 0.13 + aRand.w * 9.4247));",
    "  vec4 mv = modelViewMatrix * vec4(p, 1.0);",
    "  float dist = max(-mv.z, 0.6);",
    "  gl_PointSize = clamp(aSize * uPixelScale / dist, 1.0, 300.0);",
    "  float fade = smoothstep(6.5, 2.0, dist);",
    "  vAlpha = mix(0.25, 1.0, fade);",
    "  vColor = aColor;",
    "  vRot = aRand.z + uTime * aRand.y;",
    "  gl_Position = projectionMatrix * mv;",
    "}",
  ].join("\n");

  // ---- Palette helpers ------------------------------------------------------
  function hexToRgb(hex) {
    return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
  }
  var PAL = {
    yellow: hexToRgb(CONFIG.palette.yellow),
    violet: hexToRgb(CONFIG.palette.violet),
    white: hexToRgb(CONFIG.palette.white),
    teal: hexToRgb(CONFIG.palette.teal),
    magenta: hexToRgb(CONFIG.palette.magenta),
  };

  // Pick a palette color from {name: weight} and write it (with brightness
  // jitter) into arr at index i*3. dim scales everything (ocean points etc.).
  function writeColor(arr, i, weights, dim) {
    var total = 0, name;
    for (name in weights) total += weights[name];
    var r = Math.random() * total, acc = 0, chosen = "white";
    for (name in weights) {
      acc += weights[name];
      if (r <= acc) { chosen = name; break; }
    }
    var c = PAL[chosen];
    // narrow jitter: brightening clamps channels at 1 and desaturates colors
    var b = (0.7 + 0.35 * Math.random()) * (dim || 1);
    arr[i * 3] = Math.min(c[0] * b, 1);
    arr[i * 3 + 1] = Math.min(c[1] * b, 1);
    arr[i * 3 + 2] = Math.min(c[2] * b, 1);
  }

  // ===========================================================================
  // SHAPE BUILDING — sample meshes into {positions, colors} buffers
  // ===========================================================================

  // -- Brain: two wrinkled sphere lobes (MeshSurfaceSampler) + a stem curve --
  function wrinkle(x, y, z) {
    return (
      0.50 * Math.sin(6.8 * x + 1.7 * Math.sin(4.3 * z)) +
      0.33 * Math.sin(5.1 * y + 2.1 * Math.sin(3.7 * x)) +
      0.27 * Math.sin(8.3 * z + 1.3 * Math.sin(5.2 * y))
    );
  }

  function buildLobeGeometry(side) {
    var g = new THREE.SphereGeometry(1, 96, 72);
    var pos = g.attributes.position;
    // Bake the wrinkle "crest" value into a vertex color channel so the
    // surface sampler can interpolate the TRUE displacement field — the
    // reference's golden gyri rivers follow the outward crests.
    var crest = new Float32Array(pos.count * 3);
    for (var i = 0; i < pos.count; i++) {
      var ux = pos.getX(i), uy = pos.getY(i), uz = pos.getZ(i);
      var w = wrinkle(ux * 2.0, uy * 2.0, uz * 2.0);
      crest[i * 3] = clamp((w + 1.1) / 2.2, 0, 1);
      var r = 1 + 0.16 * w;
      var x = ux * r * 0.55, y = uy * r * 0.74, z = uz * r * 1.05;
      // frontal taper (front = +z): slightly narrower toward the front
      if (z > 0.5) x *= 1 - 0.18 * (z - 0.5);
      // flatter base like a real brain (temporal lobes sit on a plane)
      if (y < -0.35) y = -0.35 + (y + 0.35) * 0.72;
      // hemisphere offset + medial fissure (keep a visible gap at x≈0)
      x = x * 0.92 + side * 0.30;
      if (side > 0) x = Math.max(x, 0.05);
      else x = Math.min(x, -0.05);
      pos.setXYZ(i, x, y, z);
    }
    g.setAttribute("color", new THREE.BufferAttribute(crest, 3));
    return g;
  }

  function brainShape(MeshSurfaceSampler, n) {
    var posOut = new Float32Array(n * 3);
    var colOut = new Float32Array(n * 3);
    var stemCount = Math.floor(n * 0.05);
    var lobeCount = n - stemCount;
    var half = Math.floor(lobeCount / 2);

    var idx = 0;
    var p = new THREE.Vector3();
    var cSample = new THREE.Color();
    for (var s = 0; s < 2; s++) {
      var side = s === 0 ? -1 : 1;
      var count = s === 0 ? half : lobeCount - half;
      var mesh = new THREE.Mesh(buildLobeGeometry(side));
      var sampler = new MeshSurfaceSampler(mesh).build();
      for (var i = 0; i < count; i++) {
        sampler.sample(p, undefined, cSample);
        posOut[idx * 3] = p.x;
        posOut[idx * 3 + 1] = p.y;
        posOut[idx * 3 + 2] = p.z;
        // yellow follows gyri crests (baked into color.r) + top bias, like
        // the reference's golden ridge rivers; interior mixes white/violet.
        var crest = smoothstep(0.50, 0.75, cSample.r);
        var top = Math.max(0, p.y);
        // crests glow, valleys dim — the ridge/valley contrast of the ref
        writeColor(colOut, idx, {
          yellow: 0.12 + 1.30 * crest + 0.18 * top,
          white: 0.20,
          violet: 0.20,
          teal: 0.08,
          magenta: 0.09,
        }, 0.68 + 0.40 * crest);
        idx++;
      }
      mesh.geometry.dispose();
    }

    // Stem: parametric tube along a curve dropping down-back from the lobes.
    var curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, -0.52, -0.10),
      new THREE.Vector3(0, -0.74, -0.24),
      new THREE.Vector3(0.02, -1.02, -0.34),
    ]);
    var tmp = new THREE.Vector3();
    for (var j = 0; j < stemCount; j++) {
      var u = Math.random();
      curve.getPointAt(u, tmp);
      var rad = 0.07 * (1.15 - 0.55 * u);
      var ang = Math.random() * Math.PI * 2;
      posOut[idx * 3] = tmp.x + Math.cos(ang) * rad;
      posOut[idx * 3 + 1] = tmp.y + (Math.random() - 0.5) * 0.02;
      posOut[idx * 3 + 2] = tmp.z + Math.sin(ang) * rad;
      writeColor(colOut, idx, { white: 0.45, violet: 0.35, teal: 0.08, magenta: 0.12 }, 0.75);
      idx++;
    }
    return { pos: posOut, col: colOut };
  }

  // -- Bulb: LatheGeometry (dome, neck, screw base), amber crown / bone body /
  //    violet-teal neck, tilted like the reference ----------------------------
  function bulbShape(MeshSurfaceSampler, n) {
    var pts = [
      new THREE.Vector2(0.015, 0.0),
      new THREE.Vector2(0.075, 0.012),
      new THREE.Vector2(0.10, 0.045),
    ];
    // screw base: rippled radius reads as thread rings
    for (var k = 0; k <= 6; k++) {
      var yy = 0.06 + (k / 6) * 0.14;
      pts.push(new THREE.Vector2(0.105 + 0.013 * Math.sin(k * 2.6), yy));
    }
    pts.push(
      new THREE.Vector2(0.115, 0.235),
      new THREE.Vector2(0.135, 0.30),
      new THREE.Vector2(0.20, 0.40),
      new THREE.Vector2(0.27, 0.50),
      new THREE.Vector2(0.315, 0.60),
      new THREE.Vector2(0.335, 0.70),
      new THREE.Vector2(0.325, 0.79),
      new THREE.Vector2(0.28, 0.87),
      new THREE.Vector2(0.20, 0.935),
      new THREE.Vector2(0.10, 0.98),
      new THREE.Vector2(0.0, 1.0)
    );
    var mesh = new THREE.Mesh(new THREE.LatheGeometry(pts, 96));
    var sampler = new MeshSurfaceSampler(mesh).build();

    var posOut = new Float32Array(n * 3);
    var colOut = new Float32Array(n * 3);
    var p = new THREE.Vector3();
    var tilt = 0.47;
    var ct = Math.cos(tilt), st = Math.sin(tilt);
    for (var i = 0; i < n; i++) {
      sampler.sample(p);
      var h = p.y; // 0 base .. 1 crown, BEFORE tilt — drives the color zones
      var hj = h + (Math.random() - 0.5) * 0.06; // soften zone boundaries
      var wts;
      if (hj < 0.05) wts = { yellow: 0.45, teal: 0.35, violet: 0.12, white: 0.08 };
      else if (hj < 0.14) wts = { teal: 0.55, violet: 0.32, magenta: 0.05, white: 0.08 };
      else if (hj < 0.30) wts = { violet: 0.65, teal: 0.18, magenta: 0.09, white: 0.08 };
      else if (hj < 0.70) wts = { white: 0.76, violet: 0.06, yellow: 0.08, teal: 0.04, magenta: 0.06 };
      else if (hj < 0.84) wts = { yellow: 0.50, white: 0.43, magenta: 0.04, violet: 0.03 };
      else wts = { yellow: 0.85, white: 0.15 };
      writeColor(colOut, i, wts, 1);
      // center, scale to world, tilt (dome up-left / base down-right)
      var x = p.x, y = (p.y - 0.5) * 2.3, z = p.z;
      x *= 2.3; z *= 2.3;
      posOut[i * 3] = x * ct - y * st;
      posOut[i * 3 + 1] = x * st + y * ct;
      posOut[i * 3 + 2] = z;
    }
    mesh.geometry.dispose();
    return { pos: posOut, col: colOut };
  }

  // -- Globe: sphere samples kept only on land (coarse continent map);
  //    a few dim ocean points keep the sphere legible ------------------------
  function isLand(p, R) {
    var lat = Math.asin(clamp(p.y / R, -1, 1));           // -π/2..π/2
    var lon = Math.atan2(p.x, p.z);                       // -π..π
    var row = Math.floor((0.5 - lat / Math.PI) * WORLD_MAP.length);
    row = clamp(row, 0, WORLD_MAP.length - 1);
    var rowStr = WORLD_MAP[row];
    var col = Math.floor((lon / (2 * Math.PI) + 0.5) * rowStr.length);
    col = clamp(col, 0, rowStr.length - 1);
    return rowStr.charAt(col) === "#";
  }

  function globeShape(MeshSurfaceSampler, n) {
    var R = 1.15;
    var mesh = new THREE.Mesh(new THREE.SphereGeometry(R, 128, 96));
    var sampler = new MeshSurfaceSampler(mesh).build();
    var posOut = new Float32Array(n * 3);
    var colOut = new Float32Array(n * 3);
    var oceanFlag = new Uint8Array(n);
    var p = new THREE.Vector3();
    var tilt = -0.18;
    var ct = Math.cos(tilt), st = Math.sin(tilt);
    var i = 0, guard = 0, guardMax = n * 60;
    while (i < n && guard < guardMax) {
      guard++;
      sampler.sample(p);
      var land = isLand(p, R);
      if (!land && Math.random() > 0.10) continue; // oceans stay near-empty
      if (land) {
        writeColor(colOut, i, { yellow: 0.30, violet: 0.28, teal: 0.18, magenta: 0.14, white: 0.10 }, 1);
      } else {
        writeColor(colOut, i, { white: 0.6, violet: 0.4 }, 0.22);
        oceanFlag[i] = 1;
      }
      var x = p.x, y = p.y, z = p.z;
      posOut[i * 3] = x * ct - y * st;
      posOut[i * 3 + 1] = x * st + y * ct;
      posOut[i * 3 + 2] = z;
      i++;
    }
    // guard exhausted (shouldn't happen): fill leftovers on land row 16
    for (; i < n; i++) {
      posOut[i * 3] = 0; posOut[i * 3 + 1] = 0; posOut[i * 3 + 2] = R;
      writeColor(colOut, i, { violet: 1 }, 1);
    }
    mesh.geometry.dispose();
    return { pos: posOut, col: colOut, ocean: oceanFlag };
  }

  // ===========================================================================
  // BUFFER ASSEMBLY
  // ===========================================================================
  function buildShapePoints(MeshSurfaceSampler) {
    var brain = brainShape(MeshSurfaceSampler, N);
    var bulb = bulbShape(MeshSurfaceSampler, N);
    var globe = globeShape(MeshSurfaceSampler, N);

    var geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(brain.pos, 3));
    geo.setAttribute("aPos1", new THREE.BufferAttribute(bulb.pos, 3));
    geo.setAttribute("aPos2", new THREE.BufferAttribute(globe.pos, 3));
    geo.setAttribute("aCol0", new THREE.BufferAttribute(brain.col, 3));
    geo.setAttribute("aCol1", new THREE.BufferAttribute(bulb.col, 3));
    geo.setAttribute("aCol2", new THREE.BufferAttribute(globe.col, 3));

    // Sizes: mostly tiny; ~2% large accents. Ocean points half-size.
    var sizes = new Float32Array(N);
    var rand = new Float32Array(N * 4);
    for (var i = 0; i < N; i++) {
      var accent = Math.random() < 0.02;
      var s = accent
        ? 0.05 + 0.04 * Math.random()
        : 0.018 + 0.028 * Math.pow(Math.random(), 1.5);
      if (globe.ocean[i]) s *= 0.45;
      sizes[i] = s;
      rand[i * 4] = Math.random();                              // stagger
      rand[i * 4 + 1] = (Math.random() < 0.5 ? -1 : 1) *
        (0.15 + 0.4 * Math.random());                           // spin speed
      rand[i * 4 + 2] = Math.random() * Math.PI * 2;            // rot0
      rand[i * 4 + 3] = Math.random();                          // phase
    }
    geo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute("aRand", new THREE.BufferAttribute(rand, 4));

    shapeMat = new THREE.ShaderMaterial({
      uniforms: {
        uTex: { value: makeTriangleTexture() },
        // below 1 so additive overlaps saturate to white more slowly and
        // the palette keeps its color in dense regions
        uOpacity: { value: 0.78 },
        uProgress: { value: 0 },
        uTime: { value: 0 },
        uPixelScale: { value: 1000 },
        uAxis: { value: new THREE.Vector3(0, 1, 0) },
        uAngle: { value: 0 },
      },
      vertexShader: SHAPE_VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    points = new THREE.Points(geo, shapeMat);
    points.frustumCulled = false;
    group.add(points);
    groupX = isMobile ? 0 : CONFIG.heroShiftX;
    group.position.x = groupX;
  }

  function buildAmbientPoints() {
    var geo = new THREE.BufferGeometry();
    var pos = new Float32Array(NA * 3);
    var col = new Float32Array(NA * 3);
    var sizes = new Float32Array(NA);
    var rand = new Float32Array(NA * 4);
    for (var i = 0; i < NA; i++) {
      // spread across the whole viewport void, some closer to the camera
      pos[i * 3] = (Math.random() * 2 - 1) * 3.6;
      pos[i * 3 + 1] = (Math.random() * 2 - 1) * 2.2;
      pos[i * 3 + 2] = -2.5 + Math.random() * 4.0;
      var accent = i < 3; // a couple of BIG bright triangles like the refs
      if (accent) {
        // one guaranteed anchor (the refs' big triangle near the shape),
        // the rest random on the shape side of the frame
        if (i === 0) {
          pos[i * 3] = -1.7; pos[i * 3 + 1] = -0.85; pos[i * 3 + 2] = 0.8;
        } else {
          pos[i * 3] = -0.8 - Math.random() * 1.6;
        }
        writeColor(col, i, { white: 0.6, yellow: 0.4 }, 1);
        sizes[i] = 0.14 + 0.10 * Math.random();
      } else {
        writeColor(col, i, { white: 0.35, yellow: 0.25, violet: 0.2, teal: 0.12, magenta: 0.08 }, 0.5);
        sizes[i] = 0.02 + 0.03 * Math.random();
      }
      rand[i * 4] = 0.12 + 0.25 * Math.random();                // drift amp
      rand[i * 4 + 1] = (Math.random() < 0.5 ? -1 : 1) *
        (0.05 + 0.2 * Math.random());                           // spin speed
      rand[i * 4 + 2] = Math.random() * Math.PI * 2;            // rot0
      rand[i * 4 + 3] = Math.random();                          // phase
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute("aRand", new THREE.BufferAttribute(rand, 4));

    ambientMat = new THREE.ShaderMaterial({
      uniforms: {
        uTex: { value: shapeMat.uniforms.uTex.value },
        uOpacity: { value: 0.75 },
        uTime: { value: 0 },
        uPixelScale: { value: 1000 },
      },
      vertexShader: AMBIENT_VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    ambient = new THREE.Points(geo, ambientMat);
    ambient.frustumCulled = false;
    scene.add(ambient); // NOT in the shifted group: fills the whole viewport
  }

  // ---- Scroll progress / orientation ---------------------------------------
  function applyOrientation(t) {
    var seg = clamp(Math.floor(t), 0, SHAPE_AXES.length - 1);
    var next = Math.min(seg + 1, SHAPE_AXES.length - 1);
    var f = clamp(t - seg, 0, 1);
    var ax = SHAPE_AXES[seg], bx = SHAPE_AXES[next];
    var v = shapeMat.uniforms.uAxis.value;
    v.set(
      lerp(ax[0], bx[0], f),
      lerp(ax[1], bx[1], f),
      lerp(ax[2], bx[2], f)
    ).normalize();
    shapeMat.uniforms.uAngle.value = spinT + lerp(SHAPE_YAW[seg], SHAPE_YAW[next], f);
  }

  function updateProgress() {
    var rect = wrapper.getBoundingClientRect();
    var vh = window.innerHeight;
    globalT = clamp(-rect.top / vh, 0, 2);
    fadeCanvas(rect, vh);
    for (var i = 0; i < textEls.length; i++) {
      if (!textEls[i]) continue;
      var d = clamp(1 - Math.abs(globalT - i) * 1.4, 0, 1);
      textEls[i].style.opacity = d.toFixed(3);
      textEls[i].style.transform = "translateY(" + ((1 - d) * 24).toFixed(1) + "px)";
    }
  }

  // Fade the fixed canvas out as the wrapper scrolls past the viewport.
  function fadeCanvas(rect, vh) {
    canvas.style.opacity = clamp((rect.bottom - vh * 0.2) / (vh * 0.5), 0, 1);
  }

  function frame(now) {
    rafId = requestAnimationFrame(frame);
    if (!running) return;
    var dt = lastT ? (now - lastT) / 1000 : 0.016;
    lastT = now;
    if (dt > 0.05) dt = 0.05;

    updateProgress();
    spinT += CONFIG.spinSpeed * dt;

    shapeMat.uniforms.uProgress.value = globalT;
    shapeMat.uniforms.uTime.value += dt;
    ambientMat.uniforms.uTime.value += dt;
    applyOrientation(globalT);

    var targetX = isMobile ? 0 : CONFIG.heroShiftX;
    groupX += (targetX - groupX) * 0.08;
    group.position.x = groupX;

    camOff.x += (mouse.x * CONFIG.mouseParallax - camOff.x) * 0.05;
    camOff.y += (mouse.y * CONFIG.mouseParallax - camOff.y) * 0.05;
    camera.position.x = camOff.x;
    camera.position.y = camOff.y;
    camera.position.z = CONFIG.cameraZ + globalT * CONFIG.scrollDolly;
    camera.lookAt(0, 0, 0);

    renderer.render(scene, camera);
  }

  function start() {
    if (running) return;
    running = true;
    lastT = 0;
    rafId = requestAnimationFrame(frame);
  }
  function stop() {
    running = false;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  // ---- Helpers --------------------------------------------------------------
  function resize() {
    var w = window.innerWidth;
    var h = window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, CONFIG.dprMax));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // world-size -> device-pixel size factor for gl_PointSize
    var size = new THREE.Vector2();
    renderer.getDrawingBufferSize(size);
    var pixelScale = size.y / (2 * Math.tan((CONFIG.fov * Math.PI) / 360));
    shapeMat.uniforms.uPixelScale.value = pixelScale;
    ambientMat.uniforms.uPixelScale.value = pixelScale;
  }

  function onMouse(e) {
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -((e.clientY / window.innerHeight) * 2 - 1);
  }

  function mapTextBySection() {
    var arr = [];
    document.querySelectorAll("[data-cstl-section]").forEach(function (sec) {
      var idx = parseInt(sec.getAttribute("data-cstl-section"), 10);
      arr[idx] = sec.querySelector("[data-cstl-text]");
    });
    return arr;
  }

  function showAllText() {
    document.querySelectorAll("[data-cstl-text]").forEach(function (el) {
      el.style.opacity = "1";
      el.style.transform = "none";
    });
  }

  function hasWebGL() {
    try {
      var c = document.createElement("canvas");
      return !!(window.WebGLRenderingContext &&
        (c.getContext("webgl2") || c.getContext("webgl")));
    } catch (e) {
      return false;
    }
  }

  function smoothstep(a, b, x) {
    var t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function debounce(fn, ms) {
    var id;
    return function () { clearTimeout(id); id = setTimeout(fn, ms); };
  }
})();
