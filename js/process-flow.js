/* ===================================================================
   Papi — process section: one step at a time + a flowing liquid stream
   Two jobs in this file, both driven off the same scroll progress:

   1) Crossfading which of the 4 .process-step-content blocks is
      visible — same tall-outer-section (.process-section, 400vh) +
      sticky-inner-viewport (.process-sticky) pattern as
      js/contrast.js's own section, and the same "a pure function of
      scroll position, not a one-shot trigger" approach, so scrolling
      back up un-reveals a later step cleanly with no separate reverse
      logic needed. Each step gets an equal quarter of the section's
      scroll range; only ever one is above 0 opacity at a time (the
      brief overlap right at each boundary is the crossfade itself).

   2) A single WebGL metaball scene (same smin-blended-circles +
      refraction technique as the rest of this page's liquid — see
      js/hero-slime.js's own header) spanning the whole sticky
      viewport: a handful of small "droplets" continuously fall from
      above, merging into — and back out of — one bigger, stationary
      "hub" mass sitting right behind the centred text as they pass
      through it. That merge/split is just the metaball field's own
      smin blending doing its normal job on points that happen to
      wander close together; there's no special-cased "docking"
      behaviour needed to make a falling droplet look like it drags
      through the hub on its way past — it's the same physics already
      driving every other liquid shape on this page. This runs
      continuously (not gated to a single step's own scroll window),
      which is what reads as water actually running down throughout
      the whole section rather than only during a transition.
=================================================================== */
import * as THREE from './vendor/three.module.min.js';

(function(){
  const section = document.getElementById('heroProcess');
  const sticky = document.querySelector('.process-sticky');
  const canvas = document.getElementById('processFlow');
  const steps = Array.from(document.querySelectorAll('.process-step-content'));
  const dots = Array.from(document.querySelectorAll('.process-progress-dot'));
  if(!section || !sticky || !canvas || !steps.length) return;

  const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function smoothstep(edge0, edge1, x){
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  }
  // standard "ease out back" — overshoots past 1 before settling, which
  // is the entire zoom + bounce effect on the title: at t=0 this is
  // exactly 0 (so it starts from nothing, a real zoom-in rather than a
  // fade at fixed size), climbs past 1 partway through, then eases back
  // down to land exactly on 1 — a pure function of t, so it scrubs
  // cleanly forwards AND backwards with scroll instead of being a
  // fire-and-forget CSS animation that can't reverse mid-flight.
  function easeOutBack(t){
    const c1 = 1.7, c3 = c1 + 1;
    const x = Math.max(0, Math.min(1, t));
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
  }

  // cached once rather than re-queried every scroll frame
  const stepParts = steps.map(el => ({
    el,
    num: el.querySelector('.hero-process-num'),
    title: el.querySelector('h3'),
    para: el.querySelector('p'),
  }));

  // ===================================================================
  // part 1 — scroll progress + step crossfade (contrast.js's own
  // measure/update pattern)
  // ===================================================================
  let sectionTop = 0, sectionHeight = 0, viewportH = 0;
  function measure(){
    viewportH = window.innerHeight;
    sectionTop = section.offsetTop;
    sectionHeight = section.offsetHeight;
    update();
  }

  const SEGMENT = 1 / steps.length;
  // half-width of the crossfade window, CENTRED on each boundary
  // between two steps (not confined to one side of it) — a step's own
  // fade-out and its neighbour's fade-in share the exact same window,
  // so at the boundary itself both sit at 0.5 opacity, a true
  // crossfade. Confining fade-out to before the boundary and fade-in
  // to strictly after it (what this used to do) left a real gap right
  // at the boundary where NEITHER step had any opacity at all, since
  // the two windows were only adjacent, never overlapping.
  const FADE_MARGIN = SEGMENT * 0.11;
  let latestProgress = 0;

  // tracks whenever scroll crosses a step boundary (in EITHER
  // direction) so js/process-flow.js's own render loop can trigger a
  // real decaying ripple through the liquid right at that moment — see
  // lastBoundaryCrossMs below and uRippleTime in the shader. null on
  // the very first call specifically so loading the page already
  // scrolled mid-section doesn't fire a spurious ripple immediately.
  let lastRoundedStep = null;
  let lastBoundaryCrossMs = -9999;
  // each ripple's own strength/decay, read by renderFlowFrame — set
  // whenever a boundary trigger fires below, alongside
  // lastBoundaryCrossMs, so the ripple that's about to play uses
  // whichever amplitude belongs to the step just entered (or to the
  // final exit) rather than one fixed strength throughout.
  let lastRippleAmpMul = 1;
  let lastRippleDecay = 1.8;
  // multiplier for the ripple fired when ENTERING step index 1/2/3
  // (index 0 never fires one — that step is already visible on load) —
  // each one noticeably bigger than the last, per "first step small,
  // second bigger, third bigger still".
  const RIPPLE_AMP_BY_STEP = [0, 1, 1.7, 2.5];
  // the biggest of all four, and the one that also shatters the hub
  // (see exitProgress/hubShatterT below) — fired once scroll crosses
  // OUT of the section's last step into whatever comes next, not on a
  // fixed timer, so scrolling back up cancels it cleanly like
  // everything else in this file.
  const EXIT_RIPPLE_AMP_MUL = 3.6;
  const EXIT_RIPPLE_DECAY = 1.1;
  let lastExitedPast = null;
  // 0 through the whole section, ramping 0->1 over the one viewport-
  // height of extra scroll it takes .process-sticky to actually finish
  // scrolling away once unpinned (see the CSS: position:sticky simply
  // releases at the parent's own bottom edge and continues in normal
  // flow from there) — a pure function of scroll position like
  // everything else here, so driving the hub-shatter/title-hide off it
  // un-shatters cleanly if scrolled back up instead of needing separate
  // reverse logic.
  let latestExitProgress = 0;

  let pinnedLow = false, pinnedHigh = false;
  function update(){
    const scrollable = Math.max(1, sectionHeight - viewportH);
    const rawProgress = (window.scrollY - sectionTop) / scrollable;

    if(rawProgress < 0){
      if(pinnedLow) return;
      pinnedLow = true;
    } else pinnedLow = false;

    // how far past the point where .process-sticky actually starts to
    // unpin we've scrolled, in viewport heights — that point is
    // sectionTop+scrollable (exactly where rawProgress hits 1), NOT
    // sectionTop+sectionHeight: sticky positioning releases as soon as
    // the PARENT's remaining height runs out, which happens a full
    // viewport-height before the parent's own bottom edge (the sticky
    // is itself one viewport tall). Using sectionHeight here instead
    // measured from a point where the sticky had ALREADY fully
    // scrolled away, so the whole shatter sequence below was playing
    // out after the liquid was already off-screen rather than while it
    // was still visibly scrolling away.
    //
    // Computed BEFORE the pinnedHigh early-return below so that guard
    // can keep this (and the shatter it drives) recomputing for as
    // long as there's still something left to animate, rather than
    // freezing the moment rawProgress first ticks past 1 (which is
    // what the old single rawProgress>1 check did, and which is
    // exactly why the last step's title used to stay visible forever).
    const exitPastPx = window.scrollY - (sectionTop + scrollable);
    const exitProgress = Math.max(0, Math.min(1, exitPastPx / viewportH));

    // same "skip the redundant recompute once fully settled" optimization
    // as contrast.js/quote-form.js, just gated on the shatter/exit
    // sequence actually having finished (exitProgress reaching 1) rather
    // than merely having started.
    if(rawProgress > 1){
      if(pinnedHigh && exitProgress >= 1) return;
      pinnedHigh = true;
    } else pinnedHigh = false;

    const progress = Math.max(0, Math.min(1, rawProgress));
    latestProgress = progress;
    latestExitProgress = exitProgress;

    // segment BOUNDARIES sit at stepFloat = 1, 2, 3 (integers) —
    // Math.floor is what detects crossing one of those; Math.round
    // (tried first) instead flags a "crossing" at each step's own
    // MIDPOINT (0.5, 1.5, 2.5...), which never lines up with an actual
    // transition at all, so the ripple below was silently never firing.
    const stepFloat = progress * steps.length;
    const flooredStep = Math.min(Math.floor(stepFloat), steps.length - 1);
    if(lastRoundedStep === null){
      lastRoundedStep = flooredStep;
    } else if(flooredStep !== lastRoundedStep){
      lastRoundedStep = flooredStep;
      lastBoundaryCrossMs = performance.now();
      lastRippleAmpMul = RIPPLE_AMP_BY_STEP[flooredStep] || 1;
      lastRippleDecay = 1.8;
    }

    // the fourth, biggest ripple — fires once when exitProgress first
    // ticks above 0 (just like the step-boundary crossings above, but
    // for "crossed the section's own final edge" instead of "crossed
    // into a step"), and reverses the same way if scrolled back up.
    const nowExited = exitProgress > 0;
    if(lastExitedPast === null){
      lastExitedPast = nowExited;
    } else if(nowExited !== lastExitedPast){
      lastExitedPast = nowExited;
      if(nowExited){
        lastBoundaryCrossMs = performance.now();
        lastRippleAmpMul = EXIT_RIPPLE_AMP_MUL;
        lastRippleDecay = EXIT_RIPPLE_DECAY;
      }
    }

    // fades the whole step out in sync with the hub shattering (see
    // hubShatterT in renderFlowFrame) rather than leaving the last
    // step's title sitting on screen after the liquid behind it has
    // already broken apart.
    const exitFade = 1 - smoothstep(0, 1, exitProgress);

    // defaults to the LAST step, not the first — once exitFade has
    // dragged every step's opacity below 0.5 (see exitFade above),
    // nothing below ever overrides this default, and the section is
    // always being exited FROM its last step, never its first, so that's
    // the dot that should stay lit while everything else fades away.
    let activeIndex = steps.length - 1;
    stepParts.forEach(({el, num, title, para}, i)=>{
      const segStart = i * SEGMENT;
      const segEnd = segStart + SEGMENT;
      // the very first step starts fully visible (nothing to fade in
      // from before scroll has even begun) and the very last stays
      // visible once reached (nothing after it to crossfade into) —
      // every step in between fades in and out through a window
      // CENTRED on its own boundary (shared with whichever neighbour
      // is crossfading against it there), so the two sides of any
      // given transition are always simultaneously partway visible
      // rather than one finishing before the other starts.
      const fadeIn = i === 0 ? 1 : smoothstep(segStart - FADE_MARGIN, segStart + FADE_MARGIN, progress);
      const fadeOut = i === steps.length - 1 ? 0 : smoothstep(segEnd - FADE_MARGIN, segEnd + FADE_MARGIN, progress);
      const opacity = fadeIn * (1 - fadeOut) * exitFade;
      el.style.opacity = opacity.toFixed(3);

      // staggered reveal within that same fade-in window — the number
      // settles first, then the title (zooming + bouncing in via
      // easeOutBack), then the description, each remapping the SAME
      // 0..1 fadeIn through its own later-starting sub-window rather
      // than running off an independent timer, so the whole cascade
      // still scrubs perfectly with scroll in both directions.
      const numT = smoothstep(0, 0.55, fadeIn);
      const titleT = smoothstep(0.12, 0.85, fadeIn);
      const paraT = smoothstep(0.32, 1, fadeIn);
      const shrinkOut = 1 - fadeOut * 0.18;

      if(num) num.style.transform = `translateY(${((1 - numT) * 14).toFixed(1)}px)`;
      if(title){
        const scale = easeOutBack(titleT) * shrinkOut;
        title.style.transform = `translateY(${((1 - titleT) * 24).toFixed(1)}px) scale(${scale.toFixed(3)})`;
      }
      if(para) para.style.transform = `translateY(${((1 - paraT) * 16).toFixed(1)}px)`;

      if(opacity > 0.5) activeIndex = i;
    });

    dots.forEach((d, i)=> d.classList.toggle('is-active', i === activeIndex));
  }

  requestAnimationFrame(measure);
  if(document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
  window.addEventListener('load', measure);
  let lastResizeW = window.innerWidth;
  window.addEventListener('resize', ()=>{
    const w = window.innerWidth;
    if(Math.abs(w - lastResizeW) <= 10) return;
    lastResizeW = w;
    clearTimeout(window.__papiProcessResizeT);
    window.__papiProcessResizeT = setTimeout(measure, 150);
  });
  let ticking = false;
  window.addEventListener('scroll', ()=>{
    if(ticking) return;
    ticking = true;
    requestAnimationFrame(()=>{ update(); ticking = false; });
  }, { passive: true });
  update();

  // ===================================================================
  // part 2 — the liquid stream itself
  // ===================================================================
  const POINT_COUNT = 7; // 1 hub + 6 falling droplets
  const HUB_IDX = 0;

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
    uniform vec4 uPoints[${POINT_COUNT}]; // xy = position, z = radius, w unused
    uniform float uSurfaceTension;
    uniform float uNoiseStrength;
    uniform float uRippleTime; // seconds since the last step-boundary crossing
    uniform float uRippleAmp; // this ripple's own strength — see RIPPLE_AMP_BY_STEP/EXIT_RIPPLE_AMP_MUL in the JS
    uniform float uRippleDecay;
    uniform vec3 uColorMid;
    uniform vec3 uColorBright;
    uniform sampler2D uEnvMap;

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
    vec3 envSample(vec2 dir){
      vec2 uv = clamp(dir*0.5 + 0.5, 0.0, 1.0);
      return texture2D(uEnvMap, uv).rgb;
    }

    float field(vec2 p, float aspect){
      float f = 1.0e5;
      for(int i=0;i<${POINT_COUNT};i++){
        vec4 pt = uPoints[i];
        vec2 ptPos = vec2(pt.x*aspect, pt.y);
        float dist = length(p-ptPos) - pt.z;
        f = smin(f, dist, uSurfaceTension);
      }
      return f;
    }

    void main(){
      float aspect = uResolution.x / uResolution.y;
      vec2 p = vec2(vUv.x*aspect, vUv.y);

      float n = fbm(p*3.0 + uTime*0.05) - 0.5;
      float raw = field(p, aspect);

      // a real expanding-ring ripple through the surface itself (not a
      // color overlay) — perturbing the same field value everything
      // else below (refraction, normals, shading) already reads from,
      // so the ring actually bends light and casts a highlight as it
      // passes, the way a real disturbance in water would, rather than
      // just a flat wave painted on top. Centred on the hub (always at
      // normalized (0.5, 0.5)) and timed to uRippleTime — see the
      // lastBoundaryCrossMs comment in the JS above — so a ring fires
      // right as scroll crosses into each new step and decays away over
      // roughly a second — see RIPPLE_AMP_BY_STEP/EXIT_RIPPLE_AMP_MUL in
      // the JS above for why its strength (uRippleAmp) isn't a single
      // fixed number: each step's own ripple is bigger than the last,
      // and the final one (exiting the section) is the biggest of all
      // and doubles as the hub-shatter trigger — rather than rippling
      // constantly.
      float distFromHub = length(p - vec2(0.5*aspect, 0.5));
      float rippleEnvelope = exp(-uRippleTime*uRippleDecay);
      float ripple = sin(distFromHub*24.0 - uRippleTime*10.0) * rippleEnvelope * uRippleAmp;

      float f = raw - n*uNoiseStrength*0.13 - ripple;

      float edge = 1.0 - smoothstep(0.0, 0.005, f);
      if(edge <= 0.003) discard;

      float eps = 0.006;
      float fx = field(p+vec2(eps,0.0), aspect) - field(p-vec2(eps,0.0), aspect);
      float fy = field(p+vec2(0.0,eps), aspect) - field(p-vec2(0.0,eps), aspect);
      float gLen = length(vec2(fx, fy));
      vec2 gDir = gLen > 0.00001 ? vec2(fx, fy)/gLen : vec2(1.0, 0.0);

      float pathT = clamp(-f / 0.09, 0.0, 1.0);
      float domeHoriz = clamp(1.0 - pathT, 0.0, 1.0);
      float domeVert = sqrt(max(0.0, 1.0 - domeHoriz*domeHoriz));
      vec3 normal = normalize(vec3(-gDir*domeHoriz, domeVert + 0.02));

      vec3 viewDir = vec3(0.0, 0.0, 1.0);
      vec3 lightDir = normalize(vec3(-0.35, 0.55, 0.7));
      float diff = max(0.0, dot(normal, lightDir));
      vec3 reflectDir = reflect(-lightDir, normal);
      float spec = pow(max(0.0, dot(reflectDir, viewDir)), 240.0);
      float sheen = pow(max(0.0, dot(reflectDir, viewDir)), 13.0);
      float fresnel = pow(1.0 - max(0.0, dot(normal, viewDir)), 3.6);

      vec3 refractDir = refract(-viewDir, normal, 1.0/1.55);
      if(dot(refractDir, refractDir) < 0.0001) refractDir = -viewDir;
      vec3 envColor = envSample(refractDir.xy * 2.6);

      float absorb = pow(pathT, 0.7);
      vec3 tint = mix(vec3(1.0), mix(uColorMid, uColorBright, 0.4), absorb);
      vec3 color = envColor * tint;
      // same cool-blue sparkle/rim treatment as js/hero-slime.js's own
      // material — see its comment on this exact spot for why (a
      // warm-only highlight on a warm body reads as plastic; a cool
      // glint against it is the actual glass/liquid cue).
      color += vec3(0.82, 0.93, 1.0) * spec * 1.7;
      color += vec3(1.0, 0.95, 0.85) * sheen * 0.2;
      color = mix(color, vec3(0.8, 0.91, 1.0), fresnel*0.62);
      color *= (0.58 + 0.42*diff);

      float bodyAlphaFloor = 0.12;
      float bodyAlpha = mix(bodyAlphaFloor, 0.92, fresnel);

      gl_FragColor = vec4(color, edge*bodyAlpha);
    }
  `;

  function makeEnvTexture(){
    const size = 256;
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    const base = ctx.createLinearGradient(0, 0, 0, size);
    base.addColorStop(0, '#ffffff');
    base.addColorStop(0.55, '#fdf6ea');
    base.addColorStop(1, '#f2e4cc');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);
    const blobColors = ['#ffffff', '#fdf8ee', '#faf1e0', '#f5e8d0', '#eeddc0'];
    let seed = 99;
    function rand(){
      seed = (seed*1103515245 + 12345) & 0x7fffffff;
      return (seed % 10000) / 10000;
    }
    for(let i=0;i<16;i++){
      const r = size*(0.08 + rand()*0.22);
      const x = rand()*size, y = rand()*size;
      ctx.filter = `blur(${Math.round(size*0.015 + rand()*size*0.025)}px)`;
      ctx.globalAlpha = 0.4 + rand()*0.4;
      ctx.fillStyle = blobColors[i % blobColors.length];
      ctx.beginPath();
      ctx.ellipse(x, y, r, r*(0.6+rand()*0.6), rand()*Math.PI, 0, Math.PI*2);
      ctx.fill();
    }
    ctx.filter = 'none';
    ctx.globalAlpha = 1;
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return tex;
  }

  const CONFIG = {
    hubRadius: 0.205,
    hubPulseAmp: 0.12,
    dropletRadius: 0.045,
    dropletRadiusVar: 0.02,
    surfaceTension: 0.07,
    noiseStrength: 0.15,
    colorMid: [0.97, 0.955, 0.92],
    colorBright: [1.00, 0.995, 0.985],
  };

  // droplets fall (y increases over time) from above the viewport,
  // wrapping back to above once they pass below it — a continuous
  // loop, same "rise and wrap" idea as js/process-fog.js's own wisps,
  // just inverted and rendered as real metaball liquid instead of
  // soft fog. Each has a fixed home X near the centre (where the hub
  // sits) with a small sway, so the fall path drifts close enough to
  // the hub for the smin blend to actually merge them as they pass —
  // that merge is what reads as "dragging through" each step.
  const DROPLETS = [];
  (function seed(){
    let s = 424242;
    function rand(){ s = (s*1103515245+12345)&0x7fffffff; return (s%100000)/100000; }
    for(let i=0;i<POINT_COUNT-1;i++){
      DROPLETS.push({
        homeX: 0.5 + (rand()-0.5)*0.22,
        swayAmp: 0.02 + rand()*0.035,
        swayPeriod: 7 + rand()*6,
        swayPhase: rand()*Math.PI*2,
        startY: rand()*1.4 - 0.3,
        fallSpeed: 0.05 + rand()*0.035, // fraction of viewport-height per second
        radius: CONFIG.dropletRadius + (rand()-0.5)*CONFIG.dropletRadiusVar,
        // fixed, seeded outward direction/distance used only once the
        // hub shatters (see hubShatterT in renderFlowFrame) — each
        // droplet gets blown outward from the hub's centre along its
        // own angle rather than all fragments flying the same way,
        // which is what actually reads as a burst instead of a slide.
        burstAngle: rand() * Math.PI * 2,
        burstDist: 0.22 + rand() * 0.4,
      });
    }
  })();

  const renderer = new THREE.WebGLRenderer({ canvas, alpha:true, antialias:false, powerPreference:'low-power' });
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const uniforms = {
    uResolution: { value: new THREE.Vector2(1,1) },
    uTime: { value: 0 },
    uPoints: { value: new Array(POINT_COUNT).fill(0).map(()=> new THREE.Vector4(0,0,0,0)) },
    uSurfaceTension: { value: CONFIG.surfaceTension },
    uNoiseStrength: { value: CONFIG.noiseStrength },
    uRippleTime: { value: 999 },
    uRippleAmp: { value: 0.055 },
    uRippleDecay: { value: 1.8 },
    uColorMid: { value: new THREE.Vector3(...CONFIG.colorMid) },
    uColorBright: { value: new THREE.Vector3(...CONFIG.colorBright) },
    uEnvMap: { value: makeEnvTexture() },
  };
  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX, fragmentShader: FRAGMENT, uniforms,
    transparent: true, depthTest: false, depthWrite: false,
  });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));

  let W = 1, H = 1;
  function resizeCanvas(){
    const w = sticky.clientWidth || 1, h = sticky.clientHeight || 1;
    if(!w || !h) return;
    if(w === W && h === H) return;
    W = w; H = h;
    const pr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(pr);
    renderer.setSize(W, H, false);
    uniforms.uResolution.value.set(W, H);
  }
  resizeCanvas();

  function renderFlowFrame(elapsedMs){
    const t = elapsedMs / 1000;
    uniforms.uTime.value = t;

    // gentle pulse right as scroll crosses each step boundary — a
    // small "gulp" reaction timed to the same progress driving the
    // text crossfade above, rather than running on its own unrelated
    // clock. Kept small now that uRippleTime below carries most of the
    // actual transition reaction, so the two don't stack into an
    // overly strong combined effect.
    const stepFloat = latestProgress * steps.length;
    const distToBoundary = Math.abs(stepFloat - Math.round(stepFloat));
    const pulse = 1 + (1 - smoothstep(0, 0.12, distToBoundary)) * CONFIG.hubPulseAmp;

    // 0 through the whole section, easing to 1 across latestExitProgress
    // (see its own comment in update() above) — shrinks the hub to
    // nothing exactly as the biggest/final ripple fires, so "the ripple
    // that breaks it" and "the hub actually breaking" are the same
    // moment rather than two separately-timed effects.
    const hubShatterT = smoothstep(0, 1, latestExitProgress);
    uniforms.uPoints.value[HUB_IDX].set(0.5, 0.5, Math.max(0, CONFIG.hubRadius * pulse * (1 - hubShatterT)), 0);
    // real elapsed wall-clock time since the last crossing (see
    // lastBoundaryCrossMs in the scroll handler above) — NOT the same
    // clock as elapsedMs/t above, which restarts from 0 every time this
    // render loop itself starts/stops (e.g. scrolling the section out
    // of view and back). performance.now() stays consistent across
    // that, so the ripple's own decay timing is never thrown off by
    // the render loop pausing and resuming in between.
    uniforms.uRippleTime.value = (performance.now() - lastBoundaryCrossMs) / 1000;
    uniforms.uRippleAmp.value = 0.055 * lastRippleAmpMul;
    uniforms.uRippleDecay.value = lastRippleDecay;

    DROPLETS.forEach((d, i)=>{
      const idx = i + 1;
      let yFrac = (d.startY + t * d.fallSpeed) % 1.4;
      if(yFrac < 0) yFrac += 1.4;
      const y = yFrac - 0.2;
      const sway = Math.sin(t * (2*Math.PI/d.swayPeriod) + d.swayPhase) * d.swayAmp;
      let px = d.homeX + sway;
      let py = 1 - y;
      // the hub "shattering" blows each currently-falling droplet
      // outward from the hub's own centre along its fixed seeded
      // angle/distance, scaled by the SAME hubShatterT driving the hub
      // itself down to nothing — reads as the hub bursting into
      // whichever pieces already happen to be nearby, rather than a
      // separate bolted-on animation, and un-shatters cleanly if
      // scrolled back up since hubShatterT is itself just a function of
      // scroll position. Radius shrinks toward "tiny little bubbles"
      // rather than to nothing, so the fragments stay visible as they
      // scatter instead of vanishing outright.
      if(hubShatterT > 0.001){
        px += Math.cos(d.burstAngle) * d.burstDist * hubShatterT;
        py += Math.sin(d.burstAngle) * d.burstDist * hubShatterT;
      }
      const radiusNow = d.radius * (1 - hubShatterT * 0.6);
      uniforms.uPoints.value[idx].set(px, py, Math.max(0.006, radiusNow), 0);
    });

    renderer.render(scene, camera);
  }

  const RENDER_FPS = 45;
  const RENDER_INTERVAL = 1000 / RENDER_FPS;
  let running = false, rafId = null, startTs = null, lastRenderTs = 0;
  function loop(ts){
    if(!running) return;
    if(startTs === null) startTs = ts;
    if(ts - lastRenderTs >= RENDER_INTERVAL){
      lastRenderTs = ts;
      renderFlowFrame(ts - startTs);
    }
    rafId = requestAnimationFrame(loop);
  }
  function start(){
    if(running || prefersReducedMotion) return;
    running = true;
    rafId = requestAnimationFrame(loop);
  }
  function stop(){
    running = false;
    if(rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  if(prefersReducedMotion){
    renderFlowFrame(0);
  } else if('IntersectionObserver' in window){
    const io = new IntersectionObserver((entries)=>{
      entries.forEach(entry=> entry.isIntersecting ? start() : stop());
    }, { rootMargin: '200px 0px' });
    io.observe(section);
  } else {
    start();
  }

  let lastResizeWFlow = window.innerWidth;
  window.addEventListener('resize', ()=>{
    const w = window.innerWidth;
    if(Math.abs(w - lastResizeWFlow) <= 10) return;
    lastResizeWFlow = w;
    clearTimeout(window.__papiProcessFlowResizeT);
    window.__papiProcessFlowResizeT = setTimeout(resizeCanvas, 150);
  });
  if(document.fonts && document.fonts.ready) document.fonts.ready.then(resizeCanvas);
  window.addEventListener('load', resizeCanvas);
})();
