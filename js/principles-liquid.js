/* ===================================================================
   Papi — Principles: one liquid sphere, seven embedded elements
   A single realistic gold liquid sphere (a proper analytic 3D sphere
   normal faked from a 2D distance field). Scrolling drives the camera
   "into" it — the sphere grows to fill more of the screen — while
   *panning* across a fixed abstract surface so a different, distinct
   embedded element comes into focus at each of the seven stages,
   rather than zooming toward one single, increasingly generic patch of
   texture. Each element is its own simple shape (a solid core, a
   flowing path, a ring, a soft glow, a sequence of nodes, parallel
   motion streaks, a resolved point-in-a-ring) standing in for what it
   represents, embedded right in the liquid rather than laid on top of
   it as a separate flat icon.

   Panning works by keeping seven fixed positions in an abstract
   "surface space" (uFeaturePos, set once, never move) and easing
   uPan — where in that space is currently centred under the camera —
   toward the active stage's position. The visible surface noise and
   every element's shape are both sampled relative to (screen position
   - uPan), so panning is what actually swaps which element is in view.

   Both radius (the sphere's growth) and pan are pure functions of
   scroll position (eased for smoothness, never accumulated) — the
   architecture proven throughout this site: scrolling back up walks
   the exact same function backward, all the way to the first element,
   for free.
=================================================================== */
import * as THREE from './vendor/three.module.min.js';

(function(){
  const section = document.getElementById('principlesSection');
  const canvas = document.getElementById('principlesCanvas');
  if(!section || !canvas) return;

  const STAGE_COUNT = 7;

  const CONFIG = {
    radiusStart: 0.24,
    radiusEnd: 2.3,      // enough growth to feel like diving in, without the ending patch going fully abstract
    opacity: 0.97,       // near-solid — a clean liquid, not a translucent haze
    edgeSoftness: 0.010, // crisp boundary
    mobileQuality: 0.55,
    mobileWidth: 640,
    maxDt: 1000/24,
    easeRate: 0.16,
    colorDeep:   [0.55, 0.38, 0.12],
    colorMid:    [0.90, 0.68, 0.28],
    colorBright: [1.00, 0.90, 0.62],
  };

  const isMobile = window.innerWidth < CONFIG.mobileWidth;
  const qualityScale = isMobile ? CONFIG.mobileQuality : 1;
  const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function smoothstep(e0, e1, x){
    const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  }
  function timeAlpha(perFrameRate, dt, cap){
    return Math.min(cap, 1 - Math.pow(1 - perFrameRate, dt / 16.6667));
  }

  // fixed positions in abstract surface-space, one per stage — spaced
  // far enough apart (see FEATURE_SCALE below) that only the adjacent
  // one is ever partly visible during a transition, never two at once
  const FEATURE_POS = [
    [0.0, 0.0],
    [1.9, 0.35],
    [0.9, -1.7],
    [-1.8, 0.8],
    [-0.75, 1.9],
    [1.7, -1.2],
    [-1.9, -1.0],
  ];

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
    uniform float uRadius;
    uniform float uEdgeSoftness;
    uniform vec2 uCenter;
    uniform float uOpacity;
    uniform vec2 uPan;
    uniform float uActiveStageFloat;
    uniform vec2 uFeaturePos[${STAGE_COUNT}];
    uniform vec3 uColorDeep;
    uniform vec3 uColorMid;
    uniform vec3 uColorBright;

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
        p *= 2.1;
        amp *= 0.55;
      }
      return v;
    }

    float sdCircle(vec2 p, float r){ return length(p) - r; }
    float sdSegment(vec2 p, vec2 a, vec2 b, float r){
      vec2 pa = p-a, ba = b-a;
      float h = clamp(dot(pa,ba)/dot(ba,ba), 0.0, 1.0);
      return length(pa - ba*h) - r;
    }
    float sdAnnulus(vec2 p, float r, float w){ return abs(length(p)-r) - w; }

    // one distinct shape per principle, embedded in the liquid surface —
    // rendered wherever panning currently brings it under the camera,
    // standing in for what each principle actually means rather than
    // just being a generic zoomed-in patch of the same texture
    float elementSDF(vec2 p, int idx){
      if(idx == 0) return sdCircle(p, 0.30);                                    // Trust — one solid, stable core
      if(idx == 1) return sdSegment(p, vec2(-0.36,-0.22), vec2(0.36,0.22), 0.075); // Reliable Navigation — a single flowing path
      if(idx == 2) return sdAnnulus(p, 0.27, 0.055);                            // Effective CTAs — a ring, an opening to focus through
      if(idx == 3) return sdCircle(p, 0.36);                                    // Customer Feeling — soft, enveloping (softened in shading below)
      if(idx == 4){                                                             // Clear Storytelling — a sequence of connected nodes
        float a = sdCircle(p-vec2(-0.30,0.0), 0.095);
        float b = sdCircle(p, 0.095);
        float c = sdCircle(p-vec2(0.30,0.0), 0.095);
        return min(min(a,b),c);
      }
      if(idx == 5){                                                            // Purposeful Motion — parallel streaks
        float a = sdSegment(p-vec2(0.0,-0.16), vec2(-0.28,0.0), vec2(0.28,0.0), 0.04);
        float b = sdSegment(p,                 vec2(-0.34,0.0), vec2(0.34,0.0), 0.04);
        float c = sdSegment(p-vec2(0.0,0.16),  vec2(-0.28,0.0), vec2(0.28,0.0), 0.04);
        return min(min(a,b),c);
      }
      float core = sdCircle(p, 0.14);                                          // Conversion — a resolved point inside a ring
      float ring = sdAnnulus(p, 0.30, 0.035);
      return min(core, ring);
    }

    void main(){
      float aspect = uResolution.x / uResolution.y;
      vec2 p = vec2(vUv.x*aspect, vUv.y);
      vec2 center = vec2(uCenter.x*aspect, uCenter.y);
      vec2 d = p - center;
      float dist = length(d);

      float alpha = 1.0 - smoothstep(uRadius - uEdgeSoftness, uRadius, dist);
      if(alpha <= 0.003) discard;

      float zLocal = sqrt(max(0.0, uRadius*uRadius - dist*dist));
      vec3 normal = normalize(vec3(d, zLocal));

      // world position on the abstract surface — d (screen offset from
      // the sphere's centre) plus the current pan, so panning is what
      // slides a different part of that abstract surface under view
      vec2 worldP = d*2.6 + uPan;

      vec2 noiseP = worldP*2.2 + uTime*0.012;
      float eps = 0.01;
      float n  = fbm(noiseP);
      float n1 = fbm(noiseP+vec2(eps,0.0));
      float n2 = fbm(noiseP+vec2(0.0,eps));
      vec3 bumpNormal = normalize(normal + vec3((n1-n), (n2-n), 0.0) * 2.6);

      // whichever element is nearest under the current pan, and how
      // "active" its stage currently is (fades in/out over the one
      // stage either side of it, matching how far panning has to travel)
      float glow = 0.0;
      float elementInside = 0.0;
      for(int i=0;i<${STAGE_COUNT};i++){
        vec2 local = worldP - uFeaturePos[i];
        float sd = elementSDF(local, i);
        float diff = abs(uActiveStageFloat - float(i));
        float activation = 1.0 - smoothstep(0.0, 1.05, diff);
        float edge = (1.0 - smoothstep(-0.03, 0.05, sd)) * activation;
        glow = max(glow, edge);
        if(sd < 0.0) elementInside = max(elementInside, activation);
      }

      vec3 viewDir = vec3(0.0, 0.0, 1.0);
      vec3 lightDir = normalize(vec3(-0.4, 0.55, 0.7));

      float diff2 = max(0.0, dot(bumpNormal, lightDir));
      float spec = pow(max(0.0, dot(reflect(-lightDir, bumpNormal), viewDir)), 46.0);
      float fresnel = pow(1.0 - max(0.0, dot(normal, viewDir)), 3.0);

      float depthT = clamp(dot(normal, viewDir), 0.0, 1.0);
      vec3 base = mix(uColorDeep, uColorMid, smoothstep(0.0, 0.6, depthT));
      base = mix(base, uColorBright, smoothstep(0.5, 1.0, depthT)*0.45);

      vec3 color = base*(0.45 + 0.55*diff2)
        + vec3(1.0, 0.95, 0.82) * spec * 0.55
        + vec3(1.0, 0.82, 0.45) * fresnel * 0.5;

      // the active element itself reads as a distinctly brighter,
      // slightly paler-gold emissive marking on the liquid surface —
      // not a different colour (stays gold, on-brand), just clearly lit
      // from within rather than only reflecting the same key light
      color = mix(color, vec3(1.0, 0.93, 0.72), elementInside*0.35);
      color += vec3(1.0, 0.88, 0.55) * glow * 0.6;

      gl_FragColor = vec4(color, alpha*uOpacity);
    }
  `;

  const renderer = new THREE.WebGLRenderer({ canvas, alpha:true, antialias:false, powerPreference:'low-power' });
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const uniforms = {
    uResolution: { value: new THREE.Vector2(1,1) },
    uTime: { value: 0 },
    uRadius: { value: CONFIG.radiusStart },
    uEdgeSoftness: { value: CONFIG.edgeSoftness },
    uCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uOpacity: { value: CONFIG.opacity },
    uPan: { value: new THREE.Vector2(0, 0) },
    uActiveStageFloat: { value: 0 },
    uFeaturePos: { value: FEATURE_POS.map(p => new THREE.Vector2(p[0], p[1])) },
    uColorDeep: { value: new THREE.Vector3(...CONFIG.colorDeep) },
    uColorMid: { value: new THREE.Vector3(...CONFIG.colorMid) },
    uColorBright: { value: new THREE.Vector3(...CONFIG.colorBright) },
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
  const lineEl = document.getElementById('principlesLine');

  function stageOpacity(n, stageFloat){
    const local = stageFloat - n;
    if(local < -0.2 || local > 1.0) return 0;
    if(local < 0) return smoothstep(-0.2, 0, local);
    if(local <= 0.8) return 1;
    return 1 - smoothstep(0.8, 1.0, local);
  }

  let curRadius = CONFIG.radiusStart;
  let curPanX = FEATURE_POS[0][0], curPanY = FEATURE_POS[0][1];
  let lastTs = null;
  let sectionVisible = true;

  function step(ts){
    requestAnimationFrame(step);

    const rect = section.getBoundingClientRect();
    sectionVisible = rect.bottom > 0 && rect.top < window.innerHeight;
    if(!sectionVisible) return;

    const dt = lastTs === null ? 16.6667 : Math.min(ts - lastTs, CONFIG.maxDt);
    lastTs = ts;
    const alpha = timeAlpha(CONFIG.easeRate, dt, 0.6);

    const stageFloat = getStageFloat();
    const overall = stageFloat / STAGE_COUNT;
    const stageIndex = Math.min(STAGE_COUNT - 1, Math.floor(stageFloat));
    const stageNext = Math.min(STAGE_COUNT - 1, stageIndex + 1);
    const stageFrac = smoothstep(0, 1, stageFloat - stageIndex);

    const targetRadius = CONFIG.radiusStart + (CONFIG.radiusEnd - CONFIG.radiusStart) * overall;
    const targetPanX = FEATURE_POS[stageIndex][0] + (FEATURE_POS[stageNext][0] - FEATURE_POS[stageIndex][0]) * stageFrac;
    const targetPanY = FEATURE_POS[stageIndex][1] + (FEATURE_POS[stageNext][1] - FEATURE_POS[stageIndex][1]) * stageFrac;

    curRadius += (targetRadius - curRadius) * alpha;
    curPanX += (targetPanX - curPanX) * alpha;
    curPanY += (targetPanY - curPanY) * alpha;

    uniforms.uRadius.value = curRadius;
    uniforms.uPan.value.set(curPanX, curPanY);
    uniforms.uActiveStageFloat.value = stageFloat;
    uniforms.uTime.value = ts / 1000;
    renderer.render(scene, camera);

    if(introEl) introEl.style.opacity = (1 - smoothstep(0, 0.1, stageFloat)).toFixed(3);
    let activeOpacity = 0;
    stageTextEls.forEach(el=>{
      const n = Number(el.dataset.stage);
      const o = stageOpacity(n, stageFloat);
      el.style.opacity = o.toFixed(3);
      const cta = el.querySelector('.principles-cta');
      if(cta) cta.style.pointerEvents = o > 0.6 ? 'auto' : 'none';
      if(o > activeOpacity) activeOpacity = o;
    });
    if(lineEl) lineEl.style.opacity = activeOpacity.toFixed(3);
  }

  resize();
  measure();

  if(prefersReducedMotion){
    uniforms.uRadius.value = CONFIG.radiusStart;
    uniforms.uPan.value.set(FEATURE_POS[0][0], FEATURE_POS[0][1]);
    uniforms.uActiveStageFloat.value = 0;
    renderer.render(scene, camera);
    if(introEl) introEl.style.opacity = '0';
    stageTextEls.forEach((el, i)=>{ el.style.opacity = i === 0 ? '1' : '0'; });
    if(lineEl) lineEl.style.opacity = '1';
  } else {
    requestAnimationFrame(step);
  }
})();
