/* ===================================================================
   Papi — Principles: one liquid mass that splits, merges, and shatters
   No more zooming the camera into a single patch of surface. Instead,
   one liquid orb is choreographed through a specific physical sequence
   as the visitor scrolls, each move built to physically *feel* like
   the principle it represents rather than just being labelled next to
   generic footage:

     Trust              — one whole, stable, settled orb
     Reliable Navigation — splits into two, orbiting gently in place
     Effective CTAs      — splits further into three, juggling each other
     Customer Feeling    — the three rejoin into one, now rendered as a
                            faceted liquid crystal rather than plain liquid
     Clear Storytelling  — that crystal turns a full 360°, its facets
                            catching the light in turn
     Purposeful Motion   — the crystal shakes
     Conversion          — the crystal shatters into fragments

   The orb positions (1/2/3-way split), the facet rotation, and the
   shatter progress are all pure functions of scroll position — the
   established pattern across this whole site — so scrolling back up
   reverses every stage of this cleanly: fragments reassemble, the
   shake settles, the crystal turns back, and the three orbs rejoin
   back down to one. The shake and the orbit/juggle wobble are the only
   time-based (not scroll-based) motion here, layered on top for life;
   neither one accumulates anything, both are pure functions of elapsed
   time, so they can never drift or need to "catch up."

   Material is deliberately not a flat matte fill: alpha and brightness
   both vary with the fresnel term, so the body reads as more glass-
   like/transparent while the rim and specular stay bright and sharp —
   a shinier, less solid-looking liquid than the flat gold fill used
   before.
=================================================================== */
import * as THREE from './vendor/three.module.min.js';

(function(){
  const section = document.getElementById('principlesSection');
  const canvas = document.getElementById('principlesCanvas');
  if(!section || !canvas) return;

  const STAGE_COUNT = 7;
  const ORB_COUNT = 3;

  const CONFIG = {
    baseRadius: 0.30,
    opacity: 0.96,
    edgeSoftness: 0.010,
    mobileQuality: 0.55,
    mobileWidth: 640,
    maxDt: 1000/24,
    easeRate: 0.15,
    colorDeep:   [0.50, 0.34, 0.10],
    colorMid:    [0.90, 0.68, 0.28],
    colorBright: [1.00, 0.92, 0.68],
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
  // per-stage-boundary orb offsets (local units, aspect-corrected).
  // Orb C deliberately overlaps orb A at stage 1 (only two are ever
  // visually distinct there) and all three collapse back to (0,0) from
  // stage 3 onward, where the crystal choreography (rotate/shake/
  // shatter) takes over instead of position.
  // ===================================================================
  const ORB_PRESETS = [
    [[0,0],        [0,0],        [0,0]],       // 0 start of Trust
    [[-0.30,0],    [0.30,0],     [-0.30,0]],   // 1 end of Trust / Navigation split
    [[-0.30,-0.20],[0.30,-0.20], [0,0.32]],    // 2 end of Navigation / CTA split (3-way)
    [[0,0],        [0,0],        [0,0]],       // 3 end of CTA / Feeling — rejoined, crystal begins
    [[0,0],        [0,0],        [0,0]],       // 4 end of Feeling / Storytelling
    [[0,0],        [0,0],        [0,0]],       // 5 end of Storytelling / Motion
    [[0,0],        [0,0],        [0,0]],       // 6 end of Motion / Conversion
    [[0,0],        [0,0],        [0,0]],       // 7 end of Conversion
  ];
  // per-stage orb radius (smaller once split, so total "volume" feels
  // conserved rather than each split piece staying full-size)
  const ORB_RADIUS_SCALE = [1.0, 0.62, 0.5, 1.0, 1.0, 1.0, 1.0, 1.0];

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
    uniform vec2 uCenter;
    uniform float uOpacity;
    uniform float uEdgeSoftness;
    uniform vec2 uOrbPos[${ORB_COUNT}];
    uniform float uOrbRadius;
    uniform float uSurfaceTension;
    uniform float uCrystalT;      // 0 = plain liquid, 1 = fully faceted crystal
    uniform float uFacetRotation; // radians — turns the facet pattern (Storytelling)
    uniform float uShatter;       // 0..1 — Conversion
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
    float smin(float a, float b, float k){
      float h = clamp(0.5 + 0.5*(b-a)/k, 0.0, 1.0);
      return mix(b, a, h) - k*h*(1.0-h);
    }

    void main(){
      float aspect = uResolution.x / uResolution.y;
      vec2 p = vec2(vUv.x*aspect, vUv.y);
      vec2 center = vec2(uCenter.x*aspect, uCenter.y);
      vec2 q = p - center;

      // shatter: work out which of a ring of wedges this fragment
      // belongs to, then sample backward along that wedge's own
      // outward direction — what renders at an already-displaced pixel
      // is whatever the liquid looked like further toward the centre,
      // which is what makes each wedge read as having physically
      // moved outward, leaving empty space behind it as uShatter grows
      const float WEDGES = 9.0;
      float ang = atan(q.y, q.x);
      float wedgeAngle = (floor(ang/(6.28318/WEDGES)) + 0.5) * (6.28318/WEDGES);
      vec2 wedgeDir = vec2(cos(wedgeAngle), sin(wedgeAngle));
      float shatterDist = uShatter * 0.85;
      float shatterSpin = uShatter * (mod(wedgeAngle, 2.0) - 1.0) * 0.6;
      vec2 sq = q - wedgeDir*shatterDist;
      float cs = cos(-shatterSpin), sn = sin(-shatterSpin);
      sq = mat2(cs,-sn,sn,cs) * sq;

      // liquid field — up to three smooth-min-blended orbs, collapsing
      // to one once ORB_PRESETS brings them back to (0,0)
      float f = 1.0e5;
      for(int i=0;i<${ORB_COUNT};i++){
        float d = length(sq - uOrbPos[i]) - uOrbRadius;
        f = smin(f, d, uSurfaceTension);
      }

      float alphaShape = 1.0 - smoothstep(-uEdgeSoftness, uEdgeSoftness, f);
      // fragments fade out a little as they fly apart, like dust
      // trailing off rather than stopping dead
      float shatterFade = 1.0 - uShatter*0.55;
      float alpha = alphaShape * shatterFade;
      if(alpha <= 0.003) discard;

      // fake 3D normal from the field's own gradient
      float eps = 0.006;
      float fx = ( (length((sq+vec2(eps,0.0)) - uOrbPos[0]) - uOrbRadius) - f );
      float fy = ( (length((sq+vec2(0.0,eps)) - uOrbPos[0]) - uOrbRadius) - f );
      // (approximate gradient using orb 0 alone is fine — used only for
      // shading direction, not the field value itself, and reads
      // correctly near whichever orb currently dominates locally)
      vec3 normal = normalize(vec3(-fx, -fy, eps*2.2));

      // crystal facets: snap the normal's angle to a coarse set of
      // directions for a cut-gem look, blended in by uCrystalT and
      // turned by uFacetRotation (the Storytelling "360 view")
      float nAngle = atan(normal.y, normal.x) + uFacetRotation;
      float facetCount = 12.0;
      float snapped = (floor(nAngle/(6.28318/facetCount) + 0.5)) * (6.28318/facetCount) - uFacetRotation;
      vec2 facetXY = vec2(cos(snapped), sin(snapped)) * length(normal.xy);
      vec3 facetNormal = normalize(vec3(facetXY, normal.z));
      vec3 shadeNormal = normalize(mix(normal, facetNormal, uCrystalT));

      // fine liquid-surface grain, faded out as the crystal takes over
      // (a cut crystal shouldn't look like it has a wet, grainy skin)
      vec2 noiseP = sq*7.0 + uTime*0.01;
      float n  = fbm(noiseP);
      float n1 = fbm(noiseP+vec2(eps*4.0,0.0));
      float n2 = fbm(noiseP+vec2(0.0,eps*4.0));
      vec3 bumpNormal = normalize(shadeNormal + vec3((n1-n),(n2-n),0.0) * 1.6 * (1.0-uCrystalT*0.7));

      vec3 viewDir = vec3(0.0,0.0,1.0);
      vec3 lightDir = normalize(vec3(-0.4, 0.55, 0.7));

      float diff = max(0.0, dot(bumpNormal, lightDir));
      float specExp = mix(46.0, 90.0, uCrystalT); // tighter, sharper highlight once crystal
      float spec = pow(max(0.0, dot(reflect(-lightDir, bumpNormal), viewDir)), specExp);
      float fresnel = pow(1.0 - max(0.0, dot(normal, viewDir)), 2.4);

      float depthT = clamp(dot(normal, viewDir), 0.0, 1.0);
      vec3 base = mix(uColorDeep, uColorMid, smoothstep(0.0, 0.6, depthT));
      base = mix(base, uColorBright, smoothstep(0.5, 1.0, depthT)*0.5);

      // shinier, more transparent material: body brightness leans more
      // on the fresnel/rim term than a flat fill, and alpha itself
      // dips in the body (more glass-like) while staying solid at the
      // rim — a stronger version of this once crystal
      float bodyAlpha = mix(0.82, 0.62, uCrystalT) + fresnel*mix(0.18,0.38,uCrystalT);
      vec3 color = base*(0.4 + 0.4*diff)
        + vec3(1.0, 0.96, 0.85) * spec * mix(0.6, 1.0, uCrystalT)
        + vec3(1.0, 0.85, 0.5) * fresnel * mix(0.55, 0.8, uCrystalT);

      gl_FragColor = vec4(color, alpha*uOpacity*bodyAlpha);
    }
  `;

  const renderer = new THREE.WebGLRenderer({ canvas, alpha:true, antialias:false, powerPreference:'low-power' });
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const uniforms = {
    uResolution: { value: new THREE.Vector2(1,1) },
    uTime: { value: 0 },
    uCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uOpacity: { value: CONFIG.opacity },
    uEdgeSoftness: { value: CONFIG.edgeSoftness },
    uOrbPos: { value: [new THREE.Vector2(0,0), new THREE.Vector2(0,0), new THREE.Vector2(0,0)] },
    uOrbRadius: { value: CONFIG.baseRadius },
    uSurfaceTension: { value: 0.10 },
    uCrystalT: { value: 0 },
    uFacetRotation: { value: 0 },
    uShatter: { value: 0 },
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
    // both clientWidth and window.innerWidth can legitimately read 0 for
    // a brief moment (a tab not yet laid out, briefly backgrounded,
    // etc.) — feeding that straight to uResolution turns the shader's
    // very first line (aspect = x/y) into 0/0 = NaN, which silently
    // discards every fragment for the rest of that render. Skipping the
    // update when either dimension is still 0 just keeps whatever the
    // last valid size was (1x1 initially) until a real measurement
    // comes in, rather than ever handing the shader a NaN to propagate.
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    if(!w || !h) return;
    W = w;
    H = h;
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

  let curOrbX = [0,0,0], curOrbY = [0,0,0];
  let curRadiusScale = 1;
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
    const stageIndex = Math.min(STAGE_COUNT - 1, Math.floor(stageFloat));
    const stageNext = stageIndex + 1;
    const stageFrac = smoothstep(0, 1, stageFloat - stageIndex);

    // idle wobble — a gentle time-based orbit/juggle, amplitude scaled
    // by how far apart the orbs currently are (so it's invisible while
    // merged, and reads as "moving in place"/"juggling" once split) —
    // a pure function of elapsed time, never accumulated
    const t = ts / 1000;

    for(let i=0;i<ORB_COUNT;i++){
      const a = ORB_PRESETS[stageIndex][i];
      const b = ORB_PRESETS[stageNext][i];
      let tx = a[0] + (b[0]-a[0]) * stageFrac;
      let ty = a[1] + (b[1]-a[1]) * stageFrac;
      const spread = Math.hypot(tx, ty);
      const wobble = Math.min(1, spread / 0.25);
      tx += Math.sin(t*1.3 + i*2.1) * 0.035 * wobble;
      ty += Math.cos(t*1.05 + i*2.7) * 0.035 * wobble;
      curOrbX[i] += (tx - curOrbX[i]) * alpha;
      curOrbY[i] += (ty - curOrbY[i]) * alpha;
      uniforms.uOrbPos.value[i].set(curOrbX[i], curOrbY[i]);
    }

    const radiusA = ORB_RADIUS_SCALE[stageIndex];
    const radiusB = ORB_RADIUS_SCALE[stageNext];
    const targetRadiusScale = radiusA + (radiusB - radiusA) * stageFrac;
    curRadiusScale += (targetRadiusScale - curRadiusScale) * alpha;
    uniforms.uOrbRadius.value = CONFIG.baseRadius * curRadiusScale;

    // crystal blend ramps in as the three orbs finish rejoining (stage
    // 2 -> 3), then stays fully crystal for every stage after
    uniforms.uCrystalT.value = smoothstep(2.4, 3.2, stageFloat);

    // Storytelling (stage index 4, i.e. stageFloat 4..5): one full
    // rotation of the facet pattern, start to finish across that stage
    uniforms.uFacetRotation.value = smoothstep(4, 5, stageFloat) * Math.PI * 2;

    // Purposeful Motion (stage index 5, stageFloat 5..6): a shake —
    // several sine waves at different frequencies, amplitude ramped in
    // and back out across the stage so it doesn't cut in/out abruptly
    const motionActive = smoothstep(5, 5.15, stageFloat) * (1 - smoothstep(5.85, 6, stageFloat));
    const shakeX = (Math.sin(t*38.0) + Math.sin(t*17.0)*0.6) * 0.028 * motionActive;
    const shakeY = (Math.cos(t*33.0) + Math.sin(t*21.0)*0.6) * 0.028 * motionActive;
    uniforms.uCenter.value.set(0.5 + shakeX, 0.5 + shakeY);

    // Conversion (stage index 6, stageFloat 6..7): shatter
    uniforms.uShatter.value = smoothstep(6, 6.9, stageFloat);

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
    uniforms.uOrbRadius.value = CONFIG.baseRadius;
    renderer.render(scene, camera);
    if(introEl) introEl.style.opacity = '0';
    stageTextEls.forEach((el, i)=>{ el.style.opacity = i === 0 ? '1' : '0'; });
    if(lineEl) lineEl.style.opacity = '1';
  } else {
    requestAnimationFrame(step);
  }
})();
