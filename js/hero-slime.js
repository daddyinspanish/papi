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
  const contrastSectionEl = document.getElementById('contrastSection');
  const contrastStickyEl = contrastSectionEl ? contrastSectionEl.querySelector('.contrast-sticky') : null;

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
    opacity: 0.92,           // overall opacity ceiling — actual per-pixel transparency is driven
                             // by the glass material's own fresnel-based bodyAlpha below, not this alone
    highlightIntensity: 0.4,
    edgeSoftness: 0.004,     // a crisp boundary rather than a soft, blurred-looking fade
    mobileQuality: 0.55,     // resolution + point-count scale under MOBILE_WIDTH
    mobileWidth: 640,
    stretchAmount: 5.5,      // how much a point elongates along its velocity direction
    compressAmount: 1.8,     // how much it compresses perpendicular to that direction while moving
    // real transparent glass, not a flat gold fill: the shader refracts
    // a view ray through the surface and samples a baked, non-repeating
    // texture (pale near the top, richer amber lower down) through that
    // bent direction, then tints the result with these two colors
    colorMid:    [0.90, 0.68, 0.28],
    colorBright: [1.00, 0.92, 0.68],
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
    // a real (locally-generated, non-repeating) image to refract — a
    // baked raster texture, not a live formula. A procedural repeating
    // pattern (sin() bands, the first attempt at this) reads as a
    // spiral/pinwheel "optical illusion" once bent through a curved
    // surface, the same way a barber pole looks warped through a lens —
    // technically proves refraction is happening, but reads as a
    // circus effect rather than glass. An irregular image has no
    // repeating structure to spiral, so bending it just looks like
    // looking *through* something.
    vec3 envSample(vec2 dir){
      vec2 uv = clamp(dir*0.5 + 0.5, 0.0, 1.0);
      return texture2D(uEnvMap, uv).rgb;
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

      // an SDF's own gradient is shaped like a *cone* — constant tilt
      // angle, radiating outward at a fixed slope from a singular
      // point at each blob's peak — not a rounded *dome* (flat at the
      // peak, curving smoothly toward the rim). Using it directly as a
      // fake normal (the previous attempt) is exactly why refraction
      // kept showing a radiating sunburst/pinwheel pattern centred on
      // each blob no matter how the colour or contrast was tuned: a
      // cone refracts light into spokes, a dome doesn't. Fixed by
      // keeping only the gradient's *direction* (still correct even
      // under merging, since it points toward the nearest surface
      // feature) and rebuilding a properly rounded dome profile for
      // its magnitude from the same smooth depth metric used for
      // colour below — flat (no tilt) at each peak, growing toward
      // fully horizontal right at the true rim.
      float eps = 0.006;
      float fx = field(p+vec2(eps,0.0), aspect) - field(p-vec2(eps,0.0), aspect);
      float fy = field(p+vec2(0.0,eps), aspect) - field(p-vec2(0.0,eps), aspect);
      float gLen = length(vec2(fx, fy));
      vec2 gDir = gLen > 0.00001 ? vec2(fx, fy)/gLen : vec2(1.0, 0.0);

      // 0 at the true boundary (rim), 1 well inside (each blob's peak)
      // — also reused below, unchanged, for colour absorption
      float pathT = clamp(-f / (uSlimeSize*0.55), 0.0, 1.0);
      float domeHoriz = clamp(1.0 - pathT, 0.0, 1.0);
      float domeVert = sqrt(max(0.0, 1.0 - domeHoriz*domeHoriz));
      vec3 normal = normalize(vec3(-gDir*domeHoriz, domeVert + 0.02));

      // fine liquid-surface grain — much lighter than before. At 1.4
      // this noise perturbation dominated wherever the base normal's
      // own xy components shrank toward zero (near each blob's own
      // local peak), because a tiny noise vector added to a near-zero
      // vector still points in a full range of directions — that's
      // exactly what produced the radiating pinched-crease look (like
      // a tufted cushion) instead of a single clean highlight. A much
      // smaller weight keeps this as subtle grain rather than a
      // direction-dominating artifact.
      vec2 noiseP = p*7.0 + uTime*0.05;
      float ng  = fbm(noiseP);
      float ng1 = fbm(noiseP+vec2(eps*4.0,0.0));
      float ng2 = fbm(noiseP+vec2(0.0,eps*4.0));
      vec3 bumpNormal = normalize(normal + vec3((ng1-ng),(ng2-ng),0.0) * 0.3);

      vec3 viewDir = vec3(0.0, 0.0, 1.0);
      vec3 lightDir = normalize(vec3(-0.35, 0.55, 0.7));

      float diff = max(0.0, dot(bumpNormal, lightDir));
      vec3 reflectDir = reflect(-lightDir, bumpNormal);
      // a real glass sparkle is small, tight, and bright — not the
      // broad soft dimple a low exponent produces
      float spec = pow(max(0.0, dot(reflectDir, viewDir)), 220.0);
      // a second, much broader/softer highlight on top of the tight
      // sparkle — real glass and liquid surfaces show both a pinpoint
      // hotspot *and* a wider glossy sheen around it; a single tight
      // exponent alone reads as hard plastic rather than glossy liquid
      float sheen = pow(max(0.0, dot(reflectDir, viewDir)), 12.0);
      float fresnel = pow(1.0 - max(0.0, dot(normal, viewDir)), 3.2);

      // bend a view ray through the true sphere surface (Snell's law via
      // GLSL's built-in refract()) and sample the high-contrast
      // procedural "world" above through that bent direction — with a
      // normal that actually curves across the whole face (not just the
      // rim), this now visibly distorts rather than reading as a flat
      // colour fill.
      //
      // real glass doesn't bend every wavelength by the same amount —
      // that's why a prism splits white light. Refracting each colour
      // channel at a slightly different index of refraction (a tiny
      // red/blue fringe at the edges) is one of the strongest "this is
      // actually glass, not a tinted shape" cues, and costs only two
      // extra texture samples.
      vec3 refractDirG = refract(-viewDir, bumpNormal, 1.0/1.55);
      if(dot(refractDirG, refractDirG) < 0.0001) refractDirG = -viewDir;
      vec3 refractDirR = refract(-viewDir, bumpNormal, 1.0/1.51);
      if(dot(refractDirR, refractDirR) < 0.0001) refractDirR = -viewDir;
      vec3 refractDirB = refract(-viewDir, bumpNormal, 1.0/1.59);
      if(dot(refractDirB, refractDirB) < 0.0001) refractDirB = -viewDir;
      float bendScale = 2.1;
      vec3 envColor = vec3(
        envSample(refractDirR.xy * bendScale).r,
        envSample(refractDirG.xy * bendScale).g,
        envSample(refractDirB.xy * bendScale).b
      );

      // Beer's-law-style absorption: light that travels further through
      // the glass (deep toward a point's own centre) picks up more of
      // the glass's own colour; near a rim, where the geometric path is
      // short, it stays close to clear — the same reason real glass
      // edges look thin and pale while the body reads richly coloured
      float absorb = pow(pathT, 0.7);
      vec3 tint = mix(vec3(1.0), mix(uColorMid, uColorBright, 0.4), absorb);
      vec3 color = envColor * tint;

      color += vec3(1.0, 0.98, 0.94) * spec * (1.6 + uHighlightIntensity);
      color += vec3(1.0, 0.95, 0.82) * sheen * 0.22;
      color = mix(color, vec3(1.0, 0.97, 0.9), fresnel * 0.6);
      // real contrast — a shallow 0.85..1.0 range (the first attempt)
      // reads as flat, soft plastic; glass needs a genuine dark side to
      // read as reflective/refractive rather than uniformly lit paint
      color *= 0.42 + 0.58*diff;

      // several of the steps above (the fresnel-white mix, the specular
      // add) each individually wash a little toward white — stacked
      // together they left a slightly pink/neutral cast, so simply
      // boosting saturation amplified *that* cast into peach/salmon
      // rather than gold. Remapping onto a fixed gold ramp keyed by
      // luminance guarantees the hue itself is always gold, rather
      // than just amplifying whatever hue happened to survive the
      // steps above; 35% of the original shading detail is kept
      // through so specular/fresnel/refraction dimension still shows
      float lum = dot(color, vec3(0.299, 0.587, 0.114));
      // pushed further from pale/creamy toward vivid, saturated gold —
      // more separation between R/G and B at both ends of the ramp
      // pushed further: a bright end that's still fairly pale (as
      // before) reads as cream/yellow rather than gold once blended —
      // more separation between R and G/B gives an unambiguously
      // saturated gold instead
      vec3 goldRef = mix(vec3(0.45, 0.26, 0.05), vec3(1.0, 0.68, 0.18), lum);
      color = mix(color, goldRef, 0.88);

      // real page content (the hero title/subtitle/CTA) sits behind
      // this canvas — alpha blending toward a white page dilutes even a
      // fully-saturated colour toward pale at low alpha, no matter how
      // rich the computed colour itself is (confirmed by direct
      // comparison: the pre-alpha colour alone renders as vivid
      // saturated gold; the composited result only looked pale because
      // of this dilution, not a colour bug). Transparency and colour
      // vividness genuinely trade off against each other over a white
      // backdrop — 0.36 keeps meaningfully more see-through than the
      // original opaque version while reading as clearly gold rather
      // than washed out
      float bodyAlpha = mix(0.36, 0.97, fresnel);

      gl_FragColor = vec4(color, edge*uOpacity*bodyAlpha);
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

  const WANDER_RANGE = 0.46; // how far from center (0.5,0.5) a target can wander — normalized units,
                              // scaled the same way as the point positions themselves (see the aspect
                              // fix in the shader's field()), so this roams proportionally regardless
                              // of whether the viewport is portrait or landscape. Raised from 0.30 so the
                              // mass actually roams across the whole hero section instead of staying
                              // clustered near the centre.
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
  // a real (baked, non-repeating) image for the glass to refract —
  // rendered once to an offscreen canvas rather than sampled live from
  // a formula. A live periodic pattern (sin() bands, the first attempt)
  // spirals into a circus/pinwheel look once bent through a curved
  // surface; an irregular raster image, like a real photo, has nothing
  // repeating in it to spiral, so bending it just reads as looking
  // *through* something. Soft blurred blobs at varied, randomized
  // scales/positions stand in for out-of-focus background detail.
  // ===================================================================
  function makeEnvTexture(){
    const size = 512;
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const ctx = c.getContext('2d');

    // vivid gold throughout — no brown/desaturated stops. A muddy dark
    // stop here (the first attempt used a flat brown low end) reads as
    // dirt rather than shine no matter how the rest of the shader is
    // tuned, since this is the actual colour being refracted/tinted.
    const base = ctx.createLinearGradient(0, 0, 0, size);
    base.addColorStop(0, '#fffaf0');
    base.addColorStop(0.55, '#ffcf5c');
    base.addColorStop(1, '#c67d1e');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);

    const blobColors = ['#fffbe8', '#ffe6a8', '#ffcf5c', '#f0aa3c', '#d68a2a'];
    let seed = 42;
    function rand(){
      seed = (seed*1103515245 + 12345) & 0x7fffffff;
      return (seed % 10000) / 10000;
    }
    for(let i=0;i<22;i++){
      const r = size*(0.08 + rand()*0.22);
      const x = rand()*size, y = rand()*size;
      ctx.filter = `blur(${Math.round(size*0.012 + rand()*size*0.02)}px)`;
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
  const envTexture = makeEnvTexture();

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
    uColorMid: { value: new THREE.Vector3(...CONFIG.colorMid) },
    uColorBright: { value: new THREE.Vector3(...CONFIG.colorBright) },
    uEnvMap: { value: envTexture },
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
    // both clientWidth and window.innerWidth can legitimately read 0 for
    // a brief moment (a tab not yet laid out, briefly backgrounded,
    // etc.) — feeding that straight to uResolution turns the shader's
    // very first line (aspect = x/y) into 0/0 = NaN, which silently
    // discards every fragment. Skip the update rather than ever handing
    // the shader a NaN to propagate; W/H just keep their last valid size.
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

  // the mass doesn't just belong to the hero — it follows the visitor
  // into the contrast section too, reparented (the same "move the real
  // node, don't duplicate the effect" trick showcase.js already uses
  // for its expanded card/quote) into that section's own sticky so it
  // keeps wandering there, at full opacity, for the whole time that
  // section is pinned — not a brief fade-out tail. It only fades right
  // at the very end, in the last EXIT_FADE_RATIO of one viewport
  // height, as the sticky itself is about to let go into showcase.
  // Reparenting is what makes this cheap: it's still the one canvas,
  // one WebGL context, one simulation the whole time — never two
  // instances running at once — so the extra cost is exactly the cost
  // of rendering while the contrast section is on screen, not more.
  const EXIT_FADE_RATIO = 0.28;
  let zone = 'hero'; // 'hero' | 'contrast' | 'gone'

  function loop(ts){
    if(!revealed){ rafId = requestAnimationFrame(loop); return; }

    const heroRect = heroEl ? heroEl.getBoundingClientRect() : null;
    const inHero = heroRect ? heroRect.bottom > 0 : false;

    let inContrast = false;
    let exitOpacity = 1;
    if(!inHero && contrastStickyEl){
      const cRect = contrastSectionEl.getBoundingClientRect();
      if(cRect.bottom > 0){
        inContrast = true;
        const exitPx = window.innerHeight * EXIT_FADE_RATIO;
        if(cRect.bottom < exitPx) exitOpacity = Math.max(0, cRect.bottom / exitPx);
      }
    }

    const nextZone = inHero ? 'hero' : (inContrast ? 'contrast' : 'gone');
    if(nextZone !== zone){
      if(nextZone === 'contrast' && contrastStickyEl){
        contrastStickyEl.insertBefore(canvas, contrastStickyEl.firstChild);
        canvas.classList.add('is-roaming');
      } else if(nextZone === 'hero' && heroEl){
        heroEl.insertBefore(canvas, heroEl.firstChild);
        canvas.classList.remove('is-roaming');
      }
      // 'gone': leave it parked wherever it last was — paused and
      // faded to nothing, so its parent no longer matters until the
      // visitor scrolls back up into one of the other two zones
      zone = nextZone;
      resize();
    }

    if(zone === 'contrast'){
      canvas.style.opacity = String(exitOpacity);
    } else if(zone === 'hero' && canvas.style.opacity){
      canvas.style.opacity = ''; // hand control back to the .is-visible class's own transition
    }

    if(zone === 'gone'){ rafId = requestAnimationFrame(loop); return; }

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

  window.Papi = window.Papi || {};
  window.Papi.resizeField = resize;
  window.Papi.revealField = function(){
    if(revealed) return;
    revealed = true;
    requestAnimationFrame(()=>{ canvas.classList.add('is-visible'); });
  };
})();
