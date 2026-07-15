/* ===================================================================
   Papi — HeroSlime
   A living, deformable mass of gold slime for the hero background,
   rendered as a single WebGL fragment shader (via Three.js) rather
   than separate shapes: a handful of "control points" are combined
   into one continuous scalar field using polynomial smooth-min
   blending (the standard metaball technique), so wherever two points
   drift close together they visibly merge into one mass instead of
   overlapping as two separate silhouettes, and pull apart into two
   again cleanly as they separate.

   Each control point runs its own small physics simulation: it drifts
   toward a wander target that itself wanders continuously (driven by
   per-point offset noise, so no two points ever move in sync and the
   whole thing never visibly loops), accelerating toward that target,
   losing energy to viscosity/damping, and getting a push/pull from the
   cursor when it's nearby. None of that tries to look "bouncy" — high
   viscosity and damping (see CONFIG below) are what make it read as
   heavy and sticky rather than springy.

   The shader adds two more layers on top of the raw merged silhouette:
   procedural noise deforms the surface (so edges and internal shading
   ripple organically instead of staying perfectly smooth), and each
   point's own current velocity stretches its contribution to the field
   along its direction of travel — the same "squash and stretch"
   principle traditional animation uses for anything heavy and fluid,
   here computed directly rather than being a separate keyframed effect.

   IMPORTANT, and worth being direct about: this renders through a
   requestAnimationFrame loop, same as every JS-driven animation this
   hero background has gone through before. iOS Safari deliberately
   pauses JS execution — rAF included — for as long as a finger is
   actively dragging the screen; nothing about moving to WebGL changes
   that, and no shader can keep rendering if the JS thread it's called
   from isn't running. What's different this time is the reason for
   choosing this approach isn't "will this survive a scroll gesture" —
   it's the specific slime/metaball look this was asked for, which
   isn't achievable with compositor-only CSS. The render loop below is
   still gated as tightly as reasonably possible (paused off-screen,
   skipped under prefers-reduced-motion, reduced quality on narrow
   viewports) to keep any such pause as brief and cheap as possible,
   but it is not, and cannot be, a fix for that underlying iOS behavior.
=================================================================== */
import * as THREE from './vendor/three.module.min.js';

(function(){
  const canvas = document.getElementById('heroSlime');
  if(!canvas) return;
  const heroEl = document.getElementById('hero');

  // ===================================================================
  // CONFIG — the knobs asked for, gathered in one place. Everything
  // below reads from this object; nothing else in the file needs to
  // change to retune the feel.
  // ===================================================================
  const CONFIG = {
    numControlPoints: 7,     // how many metaballs make up the mass — more reads as a bigger, busier organism
    slimeSize: 0.105,        // base radius of each control point, in aspect-corrected 0..1 space
    movementSpeed: 0.24,     // how quickly points travel toward their (slowly wandering) targets
    viscosity: 0.88,         // resistance to *changing* velocity — higher = heavier, slower to redirect
    damping: 0.94,           // raw velocity decay every frame — higher = keeps drifting longer before settling
    elasticity: 0.18,        // how strongly a point accelerates toward its current wander target
    surfaceTension: 0.10,    // smooth-min blend radius between points — higher = merges/rounds off more readily
    noiseStrength: 0.16,     // how much procedural noise deforms the surface and shading
    mouseForce: 0.22,        // strength of the cursor push/pull
    mouseRadius: 0.30,       // how close the cursor needs to be (aspect-corrected 0..1 space) to affect a point
    mergeDistance: 1.35,     // multiplies surfaceTension for points explicitly flagged as a "linked pair" (see WANDER_LINKS)
    opacity: 0.7,            // kept low deliberately — this sits directly behind the hero title/CTA, which must stay readable
    highlightIntensity: 0.4,
    edgeSoftness: 0.035,
    mobileQuality: 0.55,     // resolution + point-count scale under MOBILE_WIDTH
    mobileWidth: 640,
    stretchAmount: 5.5,      // how much a point elongates along its velocity direction
    compressAmount: 1.8,     // how much it compresses perpendicular to that direction while moving
    // these three MUST be monotonically increasing in luminance, edge
    // to core — the first attempt at a lightened palette picked a mid
    // tone that was, by luminance, darker than both the edge and core
    // colors either side of it, which rendered as a dark ring around
    // every point no matter how smoothly the two were interpolated:
    // smooth interpolation only guarantees a smooth transition *between*
    // the colors you give it, not that the result brightens in one
    // consistent direction. Edge is a warm-but-fairly-rich gold rather
    // than pale white — the alpha fade (edgeSoftness) already handles
    // blending the true boundary into the white page; this is the color
    // just inside that, not the boundary itself.
    // entirely gold — no white/cream anywhere in the ramp, including
    // the "core" (that used to run all the way up to near-white/cream,
    // which read as a white highlight rather than shiny gold). Still
    // monotonically increasing in luminance edge to core (see above)
    // to avoid the dark-ring bug, just staying gold the whole way.
    colorEdge:  [0.75, 0.55, 0.18],
    colorMid:   [0.92, 0.72, 0.30],
    colorCore:  [1.00, 0.82, 0.35],
    maxDt: 1000/24,          // caps the simulation step so a long paused-JS gap (see file header) resumes
                             // with a normal-sized step instead of one huge one — same lesson learned the
                             // hard way earlier rebuilding this hero background: an uncapped dt fed into a
                             // physics integrator produces a single-frame explosion, not a smooth catch-up
  };

  const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isMobile = window.innerWidth < CONFIG.mobileWidth;
  const pointCount = isMobile ? Math.max(4, Math.round(CONFIG.numControlPoints * 0.7)) : CONFIG.numControlPoints;
  const qualityScale = isMobile ? CONFIG.mobileQuality : 1;

  // ===================================================================
  // shaders
  // ===================================================================
  const VERTEX = `
    varying vec2 vUv;
    void main(){
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `;

  const FRAGMENT = `
    precision highp float;
    varying vec2 vUv;
    uniform vec2 uResolution;
    uniform float uTime;
    uniform vec4 uPoints[${pointCount}]; // xy = position (0..1), zw = velocity
    uniform float uSlimeSize;
    uniform float uSurfaceTension;
    uniform float uNoiseStrength;
    uniform float uOpacity;
    uniform float uHighlightIntensity;
    uniform float uEdgeSoftness;
    uniform float uStretchAmount;
    uniform float uCompressAmount;
    uniform vec3 uColorEdge;
    uniform vec3 uColorMid;
    uniform vec3 uColorCore;

    float hash(vec2 p){
      p = fract(p*vec2(123.34, 456.21));
      p += dot(p, p+45.32);
      return fract(p.x*p.y);
    }
    float valueNoise(vec2 p){
      vec2 i = floor(p);
      vec2 f = fract(p);
      float a = hash(i);
      float b = hash(i+vec2(1.0,0.0));
      float c = hash(i+vec2(0.0,1.0));
      float d = hash(i+vec2(1.0,1.0));
      vec2 u = f*f*(3.0-2.0*f);
      return mix(a,b,u.x) + (c-a)*u.y*(1.0-u.x) + (d-b)*u.x*u.y;
    }
    float fbm(vec2 p){
      float v = 0.0;
      float amp = 0.5;
      for(int i=0;i<3;i++){
        v += amp * valueNoise(p);
        p *= 2.02;
        amp *= 0.5;
      }
      return v;
    }
    float smin(float a, float b, float k){
      float h = clamp(0.5 + 0.5*(b-a)/k, 0.0, 1.0);
      return mix(b, a, h) - k*h*(1.0-h);
    }

    // aspect passed in explicitly rather than each call recomputing it —
    // more importantly, this is what fixes control points only ever
    // showing up in a narrow strip on portrait/narrow screens: the
    // fragment coordinate below is aspect-corrected (p.x scaled by
    // aspect) but the control points themselves, coming straight from
    // JS in plain 0..1 space, were being compared against that scaled
    // coordinate un-scaled — on a portrait phone (aspect ~0.46), the
    // visible fragment x-range becomes roughly 0..0.46, while points
    // still lived around x=0.3..0.7, so most of the mass sat outside
    // that range entirely and only ever showed up hugging one edge.
    // Scaling the point position by the same aspect factor puts both
    // in the same coordinate space, so a point at normalized (0.5, 0.5)
    // always lands at the visual centre regardless of aspect ratio.
    float field(vec2 p, float aspect){
      float f = 1.0e5;
      for(int i=0;i<${pointCount};i++){
        vec4 pt = uPoints[i];
        vec2 ptPos = vec2(pt.x*aspect, pt.y);
        vec2 d = p - ptPos;
        vec2 vel = pt.zw;
        float speed = length(vel);
        if(speed > 0.0005){
          vec2 dir = vel/speed;
          float along = dot(d, dir);
          vec2 perp = d - dir*along;
          float stretch = 1.0 + speed*uStretchAmount;
          float compress = 1.0 + speed*uCompressAmount;
          d = dir*(along/stretch) + perp*compress;
        }
        float dist = length(d) - uSlimeSize;
        f = smin(f, dist, uSurfaceTension);
      }
      return f;
    }

    void main(){
      float aspect = uResolution.x / uResolution.y;
      vec2 p = vec2(vUv.x*aspect, vUv.y);

      float n = fbm(p*3.2 + uTime*0.045) - 0.5;
      float raw = field(p, aspect);
      float f = raw - n*uNoiseStrength*0.14;

      float edge = 1.0 - smoothstep(0.0, uEdgeSoftness, f);
      if(edge <= 0.003) discard;

      // fake normal from the field's own gradient, used only for soft
      // diffuse shading (rounded, cloud-like depth) — deliberately no
      // specular term here anymore: a sharp specular highlight is
      // exactly what read as "pointy" hotspots on the mass rather than
      // a smooth, heavy liquid surface
      float eps = 0.006;
      float fx = field(p+vec2(eps,0.0), aspect) - field(p-vec2(eps,0.0), aspect);
      float fy = field(p+vec2(0.0,eps), aspect) - field(p-vec2(0.0,eps), aspect);
      vec3 normal = normalize(vec3(-fx, -fy, eps*2.4));

      vec3 lightDir = normalize(vec3(-0.35, 0.55, 0.7));
      // remapped into a narrower, higher floor range — the raw dot
      // product put each point's own dead-centre (where the surface
      // faces the camera straight-on, not the light) noticeably dimmer
      // than the area actually facing the light beside it, which
      // rendered as a small dark dot at every point's centre
      float diff = clamp(dot(normal, lightDir), 0.0, 1.0);
      diff = 0.6 + diff * 0.4;

      // a clean two-segment monotonic ramp (edge -> mid -> core) rather
      // than two independent additive blends — the previous version
      // mixed edge->mid over most of the range and *separately* faded
      // in up to 50% core on top of that, which dipped through a
      // darker middle tone before brightening again toward the centre.
      // That dip, combined with the true boundary already fading pale
      // via alpha, was rendering as a dark ring around each point
      // instead of one smoothly-lit mass.
      float depthT = clamp(-f / (uSlimeSize*0.85), 0.0, 1.0);
      vec3 base = depthT < 0.5
        ? mix(uColorEdge, uColorMid, smoothstep(0.0, 0.5, depthT))
        : mix(uColorMid, uColorCore, smoothstep(0.5, 1.0, depthT));
      // highlightIntensity now scales how much the diffuse (soft, broad)
      // shading brightens the lit side — no sharp specular term at all
      vec3 color = base*(0.62 + diff*(0.3 + uHighlightIntensity*0.25));

      gl_FragColor = vec4(color, edge*uOpacity);
    }
  `;

  // ===================================================================
  // control-point physics
  // ===================================================================
  // per-point noise offsets — large, decorrelated seeds so no two
  // points ever sample the same phase of the wander noise, which is
  // what keeps the whole mass from ever looking like it's repeating
  const points = [];
  for(let i=0;i<pointCount;i++){
    points.push({
      x: 0.5 + (Math.random()-0.5)*0.3,
      y: 0.5 + (Math.random()-0.5)*0.3,
      vx: 0, vy: 0,
      seedX: Math.random()*1000,
      seedY: Math.random()*1000,
    });
  }

  // small self-contained value-noise (same shape as the shader's, kept
  // separate/duplicated deliberately rather than shared — this one runs
  // in plain JS for the wander targets, the shader's own copy runs on
  // the GPU; nothing needs to keep them numerically identical, they
  // just both need to be "smooth, non-repeating noise")
  function hash2(x, y){
    const s = Math.sin(x*127.1 + y*311.7) * 43758.5453;
    return s - Math.floor(s);
  }
  function noise2(x, y){
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const a = hash2(xi, yi), b = hash2(xi+1, yi), c = hash2(xi, yi+1), d = hash2(xi+1, yi+1);
    const ux = xf*xf*(3-2*xf), uy = yf*yf*(3-2*yf);
    return a + (b-a)*ux + (c-a)*uy*(1-ux) + (d-b)*ux*uy;
  }

  const mouse = { x: -1, y: -1, active: false };
  let lastMoveTime = 0;
  const MOUSE_IDLE_MS = 1200;

  function toLocalNorm(clientX, clientY){
    const rect = canvas.getBoundingClientRect();
    return [(clientX - rect.left) / rect.width, (clientY - rect.top) / rect.height];
  }
  window.addEventListener('mousemove', (e)=>{
    const [x,y] = toLocalNorm(e.clientX, e.clientY);
    mouse.x = x; mouse.y = y; mouse.active = true;
    lastMoveTime = performance.now();
  });
  window.addEventListener('mouseleave', ()=>{ mouse.active = false; });
  window.addEventListener('touchmove', (e)=>{
    const t = e.touches && e.touches[0];
    if(!t) return;
    const [x,y] = toLocalNorm(t.clientX, t.clientY);
    mouse.x = x; mouse.y = y; mouse.active = true;
    lastMoveTime = performance.now();
  }, { passive:true });

  const WANDER_RANGE = 0.30; // how far from center (0.5,0.5) a target can wander — normalized units,
                              // scaled the same way as the point positions themselves (see the aspect
                              // fix in the shader's field()), so this roams proportionally regardless
                              // of whether the viewport is portrait or landscape
  const WANDER_SPEED = 0.00028; // how fast the noise field driving targets itself evolves

  function stepPoints(dtMs, elapsedMs){
    if(mouse.active && performance.now() - lastMoveTime > MOUSE_IDLE_MS) mouse.active = false;
    const dtScale = dtMs / 16.6667; // normalizes physics to "per ~60fps frame" units, using the capped dt

    for(let i=0;i<points.length;i++){
      const p = points[i];
      const nx = noise2(p.seedX + elapsedMs*WANDER_SPEED, 0) * 2 - 1;
      const ny = noise2(p.seedY + elapsedMs*WANDER_SPEED, 100) * 2 - 1;
      const targetX = 0.5 + nx*WANDER_RANGE;
      const targetY = 0.5 + ny*WANDER_RANGE;

      let ax = (targetX - p.x) * CONFIG.elasticity;
      let ay = (targetY - p.y) * CONFIG.elasticity;

      if(mouse.active){
        const dx = p.x - mouse.x;
        const dy = p.y - mouse.y;
        const dist = Math.sqrt(dx*dx + dy*dy) + 0.0001;
        if(dist < CONFIG.mouseRadius){
          const force = (1 - dist / CONFIG.mouseRadius) * CONFIG.mouseForce;
          ax += (dx/dist) * force;
          ay += (dy/dist) * force;
        }
      }

      // viscosity resists how much new acceleration can change velocity
      // (thick fluid), damping decays existing velocity independently
      // (energy loss) — two distinct knobs for two distinct feelings
      p.vx += ax * (1 - CONFIG.viscosity) * dtScale;
      p.vy += ay * (1 - CONFIG.viscosity) * dtScale;
      p.vx *= CONFIG.damping;
      p.vy *= CONFIG.damping;

      p.x += p.vx * CONFIG.movementSpeed * dtScale;
      p.y += p.vy * CONFIG.movementSpeed * dtScale;
    }
  }

  // ===================================================================
  // three.js setup
  // ===================================================================
  const renderer = new THREE.WebGLRenderer({ canvas, alpha:true, antialias:false, powerPreference:'low-power' });
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const uniforms = {
    uResolution: { value: new THREE.Vector2(1,1) },
    uTime: { value: 0 },
    uPoints: { value: new Array(pointCount).fill(0).map(()=> new THREE.Vector4(0,0,0,0)) },
    uSlimeSize: { value: CONFIG.slimeSize },
    uSurfaceTension: { value: CONFIG.surfaceTension },
    uNoiseStrength: { value: CONFIG.noiseStrength },
    uOpacity: { value: CONFIG.opacity },
    uHighlightIntensity: { value: CONFIG.highlightIntensity },
    uEdgeSoftness: { value: CONFIG.edgeSoftness },
    uStretchAmount: { value: CONFIG.stretchAmount },
    uCompressAmount: { value: CONFIG.compressAmount },
    uColorEdge: { value: new THREE.Vector3(...CONFIG.colorEdge) },
    uColorMid: { value: new THREE.Vector3(...CONFIG.colorMid) },
    uColorCore: { value: new THREE.Vector3(...CONFIG.colorCore) },
  };

  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  scene.add(quad);

  let W = 1, H = 1;
  function resize(){
    W = canvas.clientWidth || window.innerWidth;
    H = canvas.clientHeight || window.innerHeight;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2) * qualityScale;
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(W, H, false);
    uniforms.uResolution.value.set(W, H);
  }

  let lastResizeW = window.innerWidth;
  window.addEventListener('resize', ()=>{
    const w = window.innerWidth;
    if(w === lastResizeW) return;
    lastResizeW = w;
    clearTimeout(window.__papiSlimeResizeT);
    window.__papiSlimeResizeT = setTimeout(resize, 150);
  });

  let revealed = false;
  let lastTs = null;
  let rafId = null;

  function renderOnce(elapsedMs){
    uniforms.uTime.value = elapsedMs / 1000;
    for(let i=0;i<points.length;i++){
      const p = points[i];
      const v = uniforms.uPoints.value[i];
      v.set(p.x, p.y, p.vx * CONFIG.movementSpeed, p.vy * CONFIG.movementSpeed);
    }
    renderer.render(scene, camera);
  }

  function loop(ts){
    if(!revealed){ rafId = requestAnimationFrame(loop); return; }

    let heroVisible = true;
    if(heroEl){
      const r = heroEl.getBoundingClientRect();
      heroVisible = r.bottom > 0 && r.top < window.innerHeight;
    }
    if(!heroVisible){ rafId = requestAnimationFrame(loop); return; }

    const dt = lastTs === null ? 16.6667 : Math.min(ts - lastTs, CONFIG.maxDt);
    lastTs = ts;
    if(elapsedStart === null) elapsedStart = ts;
    const elapsed = ts - elapsedStart;

    stepPoints(dt, elapsed);
    renderOnce(elapsed);

    rafId = requestAnimationFrame(loop);
  }
  let elapsedStart = null;

  resize();

  if(prefersReducedMotion){
    // a single static frame — settle the points near center once, no
    // ongoing simulation and no render loop at all
    stepPoints(16.6667, 0);
    renderOnce(0);
  } else {
    rafId = requestAnimationFrame(loop);
  }

  // a plain-JS approximation of "how covered is this screen point by
  // the mass right now" — used by title.js to swap "purpose"'s color
  // between a dark-on-white default and a light-on-gold alternate
  // depending on whether the slime currently happens to be behind it.
  // Deliberately just the single closest point's distance, not a full
  // smooth-min merge across all of them: this only needs to be a
  // reasonable, smooth proxy for "is the mass roughly here," not a
  // pixel-accurate match to the shader's own rendered edge.
  window.Papi = window.Papi || {};
  window.Papi.getSlimeCoverage = function(clientX, clientY){
    const rect = canvas.getBoundingClientRect();
    if(!rect.width || !rect.height) return 0;
    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;
    const aspect = rect.width / rect.height;
    let minDist = Infinity;
    for(let i=0;i<points.length;i++){
      const p = points[i];
      const dx = (x - p.x) * aspect;
      const dy = (y - p.y);
      const dist = Math.sqrt(dx*dx + dy*dy) - CONFIG.slimeSize;
      if(dist < minDist) minDist = dist;
    }
    return 1 - Math.max(0, Math.min(1, minDist / (CONFIG.slimeSize * 0.9)));
  };
  window.Papi.resizeField = resize;
  window.Papi.revealField = function(){
    if(revealed) return;
    revealed = true;
    requestAnimationFrame(()=>{ canvas.classList.add('is-visible'); });
  };
})();
