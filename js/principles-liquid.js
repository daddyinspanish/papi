/* ===================================================================
   Papi — Principles: one liquid sphere the visitor scrolls INTO
   A single realistic gold liquid sphere (a proper analytic 3D sphere
   normal faked from a 2D distance field — not the multi-point metaball
   mass the hero uses — so it reads as one coherent, round, glossy
   object rather than several blobs merging). Scrolling drives two
   things at once, both pure functions of scroll position:

   1. uRadius grows continuously, so the sphere appears to fill more
      and more of the screen — the "camera pushing in" — until, by the
      final stage, its edge is pushed off-screen entirely and the whole
      viewport is filled with its surface, as if the visitor is now
      standing inside it.
   2. uDetailLevel rises from 0 to 1, progressively revealing finer
      octaves of procedural surface noise. At the start the surface is
      smooth and calm; by the end, the finest, highest-frequency octave
      is fully revealed — a fine, granular texture standing in for "the
      tiny particles that build the entire mass."

   Each of the seven principles gets one moment along this same
   continuous push-in, announced by a single leader line (one shared
   SVG <line>, not seven) drawn from wherever the sphere's currently-
   visible surface is out to that principle's own fixed label position
   — "connect each part... with a line," per spec, one at a time.

   Reversible for free: every value here (radius, detail, line
   endpoints, label opacity) is computed fresh each frame directly from
   the current scroll position, never accumulated — scrolling back up
   just walks the same function backward, all the way to the original
   whole, smooth, ungrown sphere.
=================================================================== */
import * as THREE from './vendor/three.module.min.js';

(function(){
  const section = document.getElementById('principlesSection');
  const canvas = document.getElementById('principlesCanvas');
  if(!section || !canvas) return;

  const STAGE_COUNT = 7;

  const CONFIG = {
    radiusStart: 0.20,   // sphere radius at scroll-start, aspect-corrected 0..1 units
    radiusEnd: 4.2,      // radius at scroll-end — big enough that the edge is well off-screen
    opacity: 1,
    mobileQuality: 0.55,
    mobileWidth: 640,
    maxDt: 1000/24,
    easeRate: 0.16,      // how quickly radius/detail ease toward their scroll-derived target each frame
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

  // ===================================================================
  // shader
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
    uniform float uRadius;
    uniform float uDetailLevel;
    uniform vec2 uCenter;
    uniform float uOpacity;
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
    // reveals one more, finer octave as uDetailLevel climbs from 0 to 1 —
    // the actual mechanism behind "more and more detail as you zoom in,
    // down to the tiny particles"
    const int OCTAVES = 4;
    float progressiveFbm(vec2 p, float detail){
      float v = 0.0;
      float amp = 0.5;
      vec2 pp = p;
      for(int i=0;i<OCTAVES;i++){
        float reveal = smoothstep(float(i)/float(OCTAVES), float(i+1)/float(OCTAVES), detail);
        v += amp * valueNoise(pp) * reveal;
        pp *= 2.15;
        amp *= 0.55;
      }
      return v;
    }

    void main(){
      float aspect = uResolution.x / uResolution.y;
      vec2 p = vec2(vUv.x*aspect, vUv.y);
      vec2 d = p - uCenter;
      float dist = length(d);

      float edgeSoft = 0.014;
      float alpha = 1.0 - smoothstep(uRadius - edgeSoft, uRadius, dist);
      if(alpha <= 0.003) discard;

      // fake a true 3D sphere from this 2D distance field: a point at
      // distance dist from centre, on a sphere of radius uRadius, has
      // a z-depth of sqrt(radius squared minus dist squared) by the
      // sphere equation — this gives a real, correctly-curved spherical
      // normal (brightest facing the light, dimming smoothly toward the
      // silhouette edge) rather than a flat disc or a fake gradient
      float zLocal = sqrt(max(0.0, uRadius*uRadius - dist*dist));
      vec3 normal = normalize(vec3(d, zLocal));

      // surface noise sampled at a fixed screen-space frequency (not
      // scaled by uRadius) — as the sphere grows, the *same* noise
      // features simply take up more of the screen, which is exactly
      // what "zooming in on existing detail" should look like
      vec2 noiseP = p*9.0 + uTime*0.015;
      float eps = 0.01;
      float n  = progressiveFbm(noiseP, uDetailLevel);
      float n1 = progressiveFbm(noiseP+vec2(eps,0.0), uDetailLevel);
      float n2 = progressiveFbm(noiseP+vec2(0.0,eps), uDetailLevel);
      vec3 bumpNormal = normalize(normal + vec3((n1-n), (n2-n), 0.0) * (2.0 + uDetailLevel*3.5));

      vec3 viewDir = vec3(0.0, 0.0, 1.0);
      vec3 lightDir = normalize(vec3(-0.4, 0.55, 0.7));

      float diff = max(0.0, dot(bumpNormal, lightDir));
      float spec = pow(max(0.0, dot(reflect(-lightDir, bumpNormal), viewDir)), 46.0);
      float fresnel = pow(1.0 - max(0.0, dot(normal, viewDir)), 3.0);

      float depthT = clamp(dot(normal, viewDir), 0.0, 1.0);
      vec3 base = mix(uColorDeep, uColorMid, smoothstep(0.0, 0.6, depthT));
      base = mix(base, uColorBright, smoothstep(0.5, 1.0, depthT)*0.45);

      vec3 color = base*(0.45 + 0.55*diff)
        + vec3(1.0, 0.95, 0.82) * spec * 0.55
        + vec3(1.0, 0.82, 0.45) * fresnel * 0.5;

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
    uDetailLevel: { value: 0 },
    uCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uOpacity: { value: CONFIG.opacity },
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

  // ===================================================================
  // per-stage fixed label anchors (fraction of the sticky viewport) —
  // alternating sides for visual rhythm, the final stage centred low
  // as a conclusive close. The leader line always points from the
  // sphere's current surface toward whichever one of these is active.
  // ===================================================================
  const LABEL_ANCHORS = [
    { x: 0.16, y: 0.26 }, // 0 Trust
    { x: 0.80, y: 0.32 }, // 1 Reliable Navigation
    { x: 0.14, y: 0.52 }, // 2 Effective Calls to Action
    { x: 0.80, y: 0.50 }, // 3 Customer Feeling
    { x: 0.16, y: 0.72 }, // 4 Clear Storytelling
    { x: 0.78, y: 0.68 }, // 5 Purposeful Motion
    { x: 0.50, y: 0.84 }, // 6 Conversion
  ];
  const ATTACH_RADIUS_CAP = 0.4; // visual attachment stays sensibly on-screen even once uRadius grows huge

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
  let curDetail = 0;
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

    const targetRadius = CONFIG.radiusStart + (CONFIG.radiusEnd - CONFIG.radiusStart) * overall;
    const targetDetail = overall;
    curRadius += (targetRadius - curRadius) * alpha;
    curDetail += (targetDetail - curDetail) * alpha;

    uniforms.uRadius.value = curRadius;
    uniforms.uDetailLevel.value = curDetail;
    uniforms.uTime.value = ts / 1000;
    renderer.render(scene, camera);

    // text sync — find whichever stage is currently dominant (for the
    // line, which points at exactly one at a time) while still cross-
    // fading every stage's own opacity independently
    let activeStage = 0, activeOpacity = -1;
    if(introEl) introEl.style.opacity = (1 - smoothstep(0, 0.1, stageFloat)).toFixed(3);
    stageTextEls.forEach(el=>{
      const n = Number(el.dataset.stage);
      const o = stageOpacity(n, stageFloat);
      const anchor = LABEL_ANCHORS[n];
      const x = anchor.x * W;
      const y = anchor.y * H;
      el.style.opacity = o.toFixed(3);
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      const cta = el.querySelector('.principles-cta');
      if(cta) cta.style.pointerEvents = o > 0.6 ? 'auto' : 'none';
      if(o > activeOpacity){ activeOpacity = o; activeStage = n; }
    });

    // leader line: from a point on the sphere's currently-visible
    // surface, in the direction of the active stage's label, out to
    // that same fixed label position
    if(lineEl && activeOpacity > 0.02){
      const anchor = LABEL_ANCHORS[activeStage];
      const aspect = W / H;
      const centerXpx = 0.5 * W;
      const centerYpx = 0.5 * H;
      const labelXpx = anchor.x * W;
      const labelYpx = anchor.y * H;
      const angle = Math.atan2(labelYpx - centerYpx, (labelXpx - centerXpx));
      // convert the capped attachment radius (aspect-corrected shader
      // units) into screen pixels along that same angle
      const attachR = Math.min(curRadius, ATTACH_RADIUS_CAP);
      // shader space -> pixel space: x scaled by (W/aspect-correction),
      // y scaled by H directly (see uCenter/aspect handling in the
      // fragment shader — x was multiplied by aspect there, so we
      // divide back out here)
      const dxShader = attachR * Math.cos(angle);
      const dyShader = attachR * Math.sin(angle);
      const startX = centerXpx + (dxShader / aspect) * W;
      const startY = centerYpx + dyShader * H;
      lineEl.setAttribute('x1', startX.toFixed(1));
      lineEl.setAttribute('y1', startY.toFixed(1));
      lineEl.setAttribute('x2', labelXpx.toFixed(1));
      lineEl.setAttribute('y2', labelYpx.toFixed(1));
      lineEl.style.opacity = activeOpacity.toFixed(3);
    } else if(lineEl){
      lineEl.style.opacity = '0';
    }
  }

  resize();
  measure();

  if(prefersReducedMotion){
    uniforms.uRadius.value = CONFIG.radiusStart;
    uniforms.uDetailLevel.value = 0;
    renderer.render(scene, camera);
    if(introEl) introEl.style.opacity = '0';
    stageTextEls.forEach((el, i)=>{
      const anchor = LABEL_ANCHORS[i] || LABEL_ANCHORS[0];
      el.style.opacity = i === 0 ? '1' : '0';
      el.style.transform = `translate(${(anchor.x*W).toFixed(1)}px, ${(anchor.y*H).toFixed(1)}px)`;
    });
  } else {
    requestAnimationFrame(step);
  }
})();
