/* ===================================================================
   Papi — Principles liquid section
   One persistent gold-liquid metaball scene (same shader technique as
   the hero's js/hero-slime.js — a scalar field from a handful of
   control points, blended with polynomial smooth-min so nearby points
   visibly merge into one continuous mass) that morphs through seven
   arrangements as the visitor scrolls through this section, each one
   built to suggest the principle it accompanies (Trust, Reliable
   Navigation, Effective Calls to Action, Customer Feeling, Clear
   Storytelling, Purposeful Motion, Conversion).

   Everything here is driven directly by scroll position, the same
   established pattern as every other scroll-linked piece on this page
   (title.js's explode, the old cube's tumble, quote-form's reveal):
   stageFloat is a pure function of (scrollY - sectionTop), never an
   accumulator, so scrolling back up reverses every transformation
   cleanly on its own with no separate "reverse" logic and no risk of
   the discontinuity-after-a-pause bug this site spent a long time
   chasing down elsewhere. Control points still ease toward their
   scroll-derived targets with velocity/damping (a liquid catching up,
   not snapping) — safe to do because the target itself is always
   correct for the current scroll position, never a stale accumulated
   value.

   Same honesty as hero-slime.js: this renders through a
   requestAnimationFrame loop, so iOS Safari can still pause it during
   an active touch-scroll. Kept as cheap as reasonably possible (one
   shared shader, gated on section visibility, paused entirely under
   prefers-reduced-motion) but that's a mitigation, not a fix for the
   underlying platform behavior.
=================================================================== */
import * as THREE from './vendor/three.module.min.js';

(function(){
  const section = document.getElementById('principlesSection');
  const canvas = document.getElementById('principlesCanvas');
  if(!section || !canvas) return;

  const STAGE_COUNT = 7;
  const NUM_POINTS = 6;

  const CONFIG = {
    slimeSize: 0.115,
    viscosity: 0.85,
    damping: 0.92,
    elasticity: 0.22,
    surfaceTension: 0.11,
    noiseStrength: 0.14,
    edgeSoftness: 0.035,
    highlightIntensity: 0.4,
    opacity: 0.94,
    stretchAmount: 6.5,
    compressAmount: 2.0,
    mobileQuality: 0.55,
    mobileWidth: 640,
    maxDt: 1000/24,
    colorEdge: [0.75, 0.55, 0.18],
    colorMid:  [0.92, 0.72, 0.30],
    colorCore: [1.00, 0.82, 0.35],
  };

  const isMobile = window.innerWidth < CONFIG.mobileWidth;
  const qualityScale = isMobile ? CONFIG.mobileQuality : 1;
  const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ===================================================================
  // stage presets — each is an 8-point set of NUM_POINTS (x,y) targets
  // in aspect-corrected 0..1 space (0.5,0.5 = centre). Index 0 is the
  // starting arrangement before any scroll into the section; indices
  // 1..7 are what the mass has resolved into by the *end* of each
  // matching stage. Interpolating continuously between consecutive
  // presets as stageFloat advances is what turns "loose scatter" into
  // "gathered and grounded" over the Trust stage, "gathered" into "a
  // flowing directional path" over Navigation, and so on.
  // ===================================================================
  const PRESETS = [
    // 0 — loose, uncertain, scattered (before Trust resolves)
    [[0.30,0.36],[0.63,0.27],[0.44,0.58],[0.71,0.60],[0.24,0.63],[0.56,0.42]],
    // 1 — Trust resolved: tight, symmetric, grounded low-centre cluster
    [[0.43,0.57],[0.57,0.57],[0.50,0.46],[0.46,0.64],[0.54,0.64],[0.50,0.54]],
    // 2 — Reliable Navigation resolved: a flowing diagonal channel,
    // guiding the eye across the screen rather than a static cluster
    [[0.16,0.62],[0.30,0.53],[0.44,0.45],[0.58,0.40],[0.72,0.36],[0.86,0.31]],
    // 3 — Effective CTAs resolved: a ring around the CTA button —
    // points spaced around a circle wide enough that the centre stays
    // open (the button sits there), while neighbours still merge
    [[0.50,0.235],[0.639,0.305],[0.639,0.445],[0.50,0.515],[0.361,0.445],[0.361,0.305]],
    // 4 — Customer Feeling: soft, loose, enveloping single form (this
    // stage's real change is lighting/softness, handled via the
    // uniform overrides below, not a dramatically different shape)
    [[0.40,0.50],[0.60,0.50],[0.50,0.38],[0.42,0.62],[0.58,0.62],[0.50,0.50]],
    // 5 — Clear Storytelling resolved: reconnected after separating —
    // a compact single form again, slightly higher to leave room for
    // the four prompt lines beneath it
    [[0.44,0.42],[0.56,0.42],[0.50,0.33],[0.46,0.50],[0.54,0.50],[0.50,0.40]],
    // 6 — Purposeful Motion: a similar compact form — the point of
    // this stage is the live scroll-velocity stretch (see
    // velocityInfluence below), not a distinct static arrangement
    [[0.43,0.50],[0.57,0.50],[0.50,0.39],[0.45,0.60],[0.55,0.60],[0.50,0.49]],
    // 7 — Conversion resolved: the tightest, most resolved single mass
    [[0.47,0.51],[0.53,0.51],[0.50,0.45],[0.48,0.56],[0.52,0.56],[0.50,0.505]],
  ];

  // per-stage overrides for shader mood (softness/size/tension) —
  // stages not listed just use CONFIG's base values. Interpolated the
  // same continuous way as point positions.
  const MOOD = {
    4: { slimeSize: 0.15, edgeSoftness: 0.07, highlightIntensity: 0.28 }, // Customer Feeling — softer, bigger, gentler light
    7: { slimeSize: 0.10, edgeSoftness: 0.025, highlightIntensity: 0.5 }, // Conversion — tightest, crispest, most resolved
  };
  function moodValue(key, stageIndexFloat){
    const i0 = Math.floor(stageIndexFloat), i1 = Math.min(STAGE_COUNT, i0+1);
    const t = stageIndexFloat - i0;
    const a = (MOOD[i0] && MOOD[i0][key] !== undefined) ? MOOD[i0][key] : CONFIG[key];
    const b = (MOOD[i1] && MOOD[i1][key] !== undefined) ? MOOD[i1][key] : CONFIG[key];
    return a + (b - a) * t;
  }

  function smoothstep(e0, e1, x){
    const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  }

  // ===================================================================
  // shader — identical technique to hero-slime.js (see that file for
  // the reasoning behind each piece: smooth-min metaballs, fbm surface
  // noise, velocity-based anisotropic stretch, monotonic-luminance
  // edge/mid/core ramp, compressed diffuse range to avoid a dark dot
  // at each point's own centre)
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
    uniform vec4 uPoints[${NUM_POINTS}];
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
    float field(vec2 p, float aspect){
      float f = 1.0e5;
      for(int i=0;i<${NUM_POINTS};i++){
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

      float eps = 0.006;
      float fx = field(p+vec2(eps,0.0), aspect) - field(p-vec2(eps,0.0), aspect);
      float fy = field(p+vec2(0.0,eps), aspect) - field(p-vec2(0.0,eps), aspect);
      vec3 normal = normalize(vec3(-fx, -fy, eps*2.4));

      vec3 lightDir = normalize(vec3(-0.35, 0.55, 0.7));
      float diff = clamp(dot(normal, lightDir), 0.0, 1.0);
      diff = 0.6 + diff * 0.4;

      float depthT = clamp(-f / (uSlimeSize*0.85), 0.0, 1.0);
      vec3 base = depthT < 0.5
        ? mix(uColorEdge, uColorMid, smoothstep(0.0, 0.5, depthT))
        : mix(uColorMid, uColorCore, smoothstep(0.5, 1.0, depthT));
      vec3 color = base*(0.62 + diff*(0.3 + uHighlightIntensity*0.25));

      gl_FragColor = vec4(color, edge*uOpacity);
    }
  `;

  const renderer = new THREE.WebGLRenderer({ canvas, alpha:true, antialias:false, powerPreference:'low-power' });
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const uniforms = {
    uResolution: { value: new THREE.Vector2(1,1) },
    uTime: { value: 0 },
    uPoints: { value: new Array(NUM_POINTS).fill(0).map(()=> new THREE.Vector4(0,0,0,0)) },
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
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2), material));

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
    clearTimeout(window.__papiPrinciplesResizeT);
    window.__papiPrinciplesResizeT = setTimeout(resize, 150);
  });

  // control-point physics: eases toward a scroll-derived target with
  // velocity/damping (a liquid catching up), never an accumulator
  const points = [];
  for(let i=0;i<NUM_POINTS;i++){
    points.push({ x: PRESETS[0][i][0], y: PRESETS[0][i][1], vx:0, vy:0 });
  }

  let sectionTop = 0, sectionHeight = 0, viewportH = 0;
  function measure(){
    viewportH = window.innerHeight;
    sectionTop = section.offsetTop;
    sectionHeight = section.offsetHeight;
  }
  requestAnimationFrame(measure);
  if(document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
  window.addEventListener('load', measure);

  function getStageFloat(){
    const scrollable = Math.max(1, sectionHeight - viewportH);
    const raw = (window.scrollY - sectionTop) / scrollable;
    return Math.max(0, Math.min(STAGE_COUNT - 0.0001, raw * STAGE_COUNT));
  }

  const stageTextEls = Array.from(document.querySelectorAll('.principles-stage'));
  const introEl = document.getElementById('principlesIntro');

  function stageOpacity(n, stageFloat){
    const local = stageFloat - n;
    if(local < -0.2 || local > 1.0) return 0;
    if(local < 0) return smoothstep(-0.2, 0, local);
    if(local <= 0.8) return 1;
    return 1 - smoothstep(0.8, 1.0, local);
  }

  let lastScrollY = window.scrollY;
  let lastTs = null;
  let sectionVisible = true;

  function step(ts){
    requestAnimationFrame(step);

    const rect = section.getBoundingClientRect();
    sectionVisible = rect.bottom > 0 && rect.top < window.innerHeight;
    if(!sectionVisible) return;

    const dt = lastTs === null ? 16.6667 : Math.min(ts - lastTs, CONFIG.maxDt);
    lastTs = ts;
    const dtScale = dt / 16.6667;

    const stageFloat = getStageFloat();
    const stageIndex = Math.floor(stageFloat);
    const stageFrac = smoothstep(0, 1, stageFloat - stageIndex);

    // scroll velocity, used only to feed the shader's existing
    // velocity-based stretch — subtle everywhere, emphasized during
    // "Purposeful Motion" (stage index 5) specifically
    const rawVelocity = (window.scrollY - lastScrollY) / Math.max(dt, 1);
    lastScrollY = window.scrollY;
    const velocityInfluence = stageIndex === 5 ? 1.0 : 0.15;
    const scrollVel = Math.max(-2, Math.min(2, rawVelocity)) * velocityInfluence;

    const presetA = PRESETS[stageIndex];
    const presetB = PRESETS[Math.min(PRESETS.length - 1, stageIndex + 1)];

    for(let i=0;i<NUM_POINTS;i++){
      const p = points[i];
      const targetX = presetA[i][0] + (presetB[i][0] - presetA[i][0]) * stageFrac;
      const targetY = presetA[i][1] + (presetB[i][1] - presetA[i][1]) * stageFrac;

      const ax = (targetX - p.x) * CONFIG.elasticity;
      const ay = (targetY - p.y) * CONFIG.elasticity;
      p.vx += ax * (1 - CONFIG.viscosity) * dtScale;
      p.vy += ay * (1 - CONFIG.viscosity) * dtScale;
      p.vx *= CONFIG.damping;
      p.vy *= CONFIG.damping;
      p.x += p.vx * dtScale;
      p.y += p.vy * dtScale;

      const v = uniforms.uPoints.value[i];
      // a shared scroll-velocity component, applied along a fixed
      // downward axis (scrolling itself is vertical) rather than each
      // point's own individual velocity — reads as the whole mass
      // reacting to the scroll gesture together
      v.set(p.x, p.y, p.vx, p.vy + scrollVel);
    }

    uniforms.uSlimeSize.value = moodValue('slimeSize', stageFloat);
    uniforms.uEdgeSoftness.value = moodValue('edgeSoftness', stageFloat);
    uniforms.uHighlightIntensity.value = moodValue('highlightIntensity', stageFloat);
    uniforms.uTime.value = ts / 1000;

    renderer.render(scene, camera);

    // text sync
    if(introEl) introEl.style.opacity = (1 - smoothstep(0, 0.12, stageFloat)).toFixed(3);
    stageTextEls.forEach(el=>{
      const n = Number(el.dataset.stage);
      const o = stageOpacity(n, stageFloat);
      el.style.opacity = o.toFixed(3);
      el.style.transform = `translateY(${((1 - o) * 14).toFixed(1)}px)`;
      const cta = el.querySelector('.principles-cta');
      if(cta) cta.style.pointerEvents = o > 0.6 ? 'auto' : 'none';
    });
  }

  resize();
  measure();

  if(prefersReducedMotion){
    // one static settle near the final resolved form, no ongoing loop
    const finalPreset = PRESETS[PRESETS.length - 1];
    points.forEach((p, i)=>{ p.x = finalPreset[i][0]; p.y = finalPreset[i][1]; });
    for(let i=0;i<NUM_POINTS;i++) uniforms.uPoints.value[i].set(points[i].x, points[i].y, 0, 0);
    renderer.render(scene, camera);
    if(introEl) introEl.style.opacity = '0';
    stageTextEls.forEach(el=>{ el.style.opacity = '1'; el.style.transform = 'none'; });
  } else {
    requestAnimationFrame(step);
  }
})();
