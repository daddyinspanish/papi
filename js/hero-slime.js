/* ===================================================================
   Papi — HeroSlime
   A living, deformable mass of pale glass slime for the hero
   background, rendered as a single WebGL fragment shader (via
   Three.js) rather than separate shapes: a handful of "control
   points" are combined into one continuous scalar field using
   polynomial smooth-min blending (the standard metaball technique),
   so wherever two points drift close together they visibly merge
   into one mass instead of overlapping as two separate silhouettes,
   and pull apart into two again cleanly as they separate.

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

   This is deliberately just the free-wander liquid, forever — no
   scroll-driven choreography, no cube formation, no corner dock. That
   whole system (a tall 400vh pinned hero, a wander→coalesce→close→
   hold→dock state machine, a canvas that reparented itself onto
   <body> to escape into a corner logo) existed in an earlier version
   of this file and has been removed wholesale on request, along with
   the hero copy it used to reveal — the hero is now just this liquid
   mass on a plain white background, with "Papi" living inside it: the
   mass starts as one big bubble fully covering the word (see
   CONFIG.introDurationMs/introSizeBoost, and introT in loop() below),
   easing open into the normal free-wandering liquid as "Papi" fades
   in and its own letters start independently riding whichever real
   control point actually covers each of them (see getPoints/
   requestPointSizes below, read/driven by js/title-dock.js's
   flowLetterFrame) — including splitting apart across separate points
   if the mass itself splits, since a single shared position has no
   guarantee of ever being covered once the points aren't all mutually
   touching.

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
   still gated as tightly as reasonably possible (skipped under
   prefers-reduced-motion, reduced quality on narrow viewports) to keep
   any such pause as brief and cheap as possible, but it is not, and
   cannot be, a fix for that underlying iOS behavior.
=================================================================== */
import * as THREE from './vendor/three.module.min.js';

(function(){
  const canvas = document.getElementById('heroSlime');
  if(!canvas) return;

  // ===================================================================
  // CONFIG — the knobs asked for, gathered in one place. Everything
  // below reads from this object; nothing else in the file needs to
  // change to retune the feel.
  // ===================================================================
  const CONFIG = {
    numControlPoints: 8,     // how many metaballs make up the mass — more reads as a bigger, busier organism
    slimeSize: 0.105,        // base radius of each control point, in aspect-corrected 0..1 space
    movementSpeed: 0.24,     // how quickly points travel toward their (slowly wandering) targets
    // raised further still (was 0.88) — the free-wander open right after
    // the loader was reading as too lively/erratic (points visibly
    // darting toward each newly-picked target rather than drifting),
    // since viscosity is what actually resists a SUDDEN change in
    // direction; damping alone (which only decays existing velocity)
    // can't smooth out a sharp direction change on its own
    viscosity: 0.93,
    damping: 0.94,           // raw velocity decay every frame — higher = keeps drifting longer before settling
    // lowered (was 0.18) — a gentler pull toward each wander target
    // means less sudden acceleration when the (slowly-evolving) noise
    // field hands a point a meaningfully different target, which is
    // most of what actually read as "crazy/darting" rather than a slow
    // smooth drift
    elasticity: 0.11,
    surfaceTension: 0.10,    // smooth-min blend radius between points — higher = merges/rounds off more readily
    noiseStrength: 0.16,     // how much procedural noise deforms the surface and shading
    // lowered (was 0.26) — a lighter cursor touch on the liquid itself,
    // so the mass reacts as a gentle nudge rather than a strong shove
    // that could fling a point (and whatever letters are riding it)
    // around hard enough to stress the containment margin
    mouseForce: 0.12,
    mouseRadius: 0.38,       // how close the cursor needs to be (aspect-corrected 0..1 space) to affect a point
    opacity: 0.92,           // overall opacity ceiling — actual per-pixel transparency is driven
                             // by the glass material's own fresnel-based bodyAlpha below, not this alone
    highlightIntensity: 0.5, // bumped up (was 0.4) for a crisper specular pop against the now much
                              // more transparent body — see the "premium clear glass" retune below
    edgeSoftness: 0.004,     // a crisp boundary rather than a soft, blurred-looking fade
    mobileQuality: 0.55,     // resolution + point-count scale under MOBILE_WIDTH
    mobileWidth: 640,
    stretchAmount: 5.5,      // how much a point elongates along its velocity direction
    compressAmount: 1.8,     // how much it compresses perpendicular to that direction while moving
    // premium/Apple-style clear glass retune: the shader refracts a
    // view ray through the surface and samples a baked, non-repeating
    // texture, then tints the result with these two colors — pulled
    // WAY down in saturation from the earlier warm-gold version (was
    // [0.94,0.83,0.60]/[1.00,0.97,0.88]) toward near-white with just a
    // whisper of champagne warmth, so the body itself reads as clear
    // glass rather than a tinted liquid. See makeEnvTexture() below and
    // the goldRef remap in the shader for the other two places this
    // same "reduce the yellow, keep only a faint edge tint" pass
    // touches — the old warm hue had three independent sources
    // (this tint, the baked env texture's own colors, and a separate
    // gold-ramp override in the shader), and all three needed pulling
    // back together or any one of them left visible yellow bleeding
    // through regardless of what the other two did.
    colorMid:    [0.97, 0.955, 0.92],
    colorBright: [1.00, 0.995, 0.985],
    maxDt: 1000/24,          // caps the simulation step so a long paused-JS gap (see file header) resumes
                             // with a normal-sized step instead of one huge one — same lesson learned the
                             // hard way earlier rebuilding this hero background: an uncapped dt fed into a
                             // physics integrator produces a single-frame explosion, not a smooth catch-up

    // ---- intro: the mass starts as one big bubble sitting over "Papi",
    // fully covering it, then eases open into the normal free-wandering
    // liquid — see introT in loop() below, and the tightened initial
    // spread on the points array a little further down (a bubble needs
    // the points to already be close together the moment the very
    // first frame renders, not slowly drift into place). ----
    introDurationMs: 2000,  // how long the whole bubble-to-wander easing takes
    introSizeBoost: 2.4,    // each point's radius starts this many times CONFIG.slimeSize (so the
                             // merged bubble is comfortably bigger than "Papi"'s own text, at any
                             // screen size), easing back down to 1x by the time introT reaches 1
  };

  const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isMobile = window.innerWidth < CONFIG.mobileWidth;
  const primaryCount = isMobile ? Math.max(4, Math.round(CONFIG.numControlPoints * 0.7)) : CONFIG.numControlPoints;
  const pointCount = primaryCount;
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
    // per-point radius override — every point normally renders at
    // uSlimeSize, EXCEPT whichever ones title-dock.js has asked to be
    // grown (see window.Papi.requestPointSizes in the JS below), each
    // to whatever size is enough to contain the specific letter(s) of
    // "Papi" currently riding it. Kept as a separate array rather than
    // folding into uPoints' otherwise-unused vec4 slot so the existing
    // xy/zw (position/velocity) layout there doesn't need to change.
    uniform float uPointSize[${pointCount}];
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
        float dist = length(d) - uPointSize[i];
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
      // broad soft dimple a low exponent produces. Tightened further
      // (was 220) for a crisper reflection against the now much more
      // transparent body.
      float spec = pow(max(0.0, dot(reflectDir, viewDir)), 260.0);
      // a second, much broader/softer highlight on top of the tight
      // sparkle — real glass and liquid surfaces show both a pinpoint
      // hotspot *and* a wider glossy sheen around it; a single tight
      // exponent alone reads as hard plastic rather than glossy liquid
      float sheen = pow(max(0.0, dot(reflectDir, viewDir)), 14.0);
      // sharpened slightly (was 3.2) for a more defined edge rather
      // than a soft glow — "crisp reflections"
      float fresnel = pow(1.0 - max(0.0, dot(normal, viewDir)), 3.6);
      float rimGlow = fresnel;

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
      // increased (was 2.1) for more visible bending — more transmission/
      // refraction, less "tinted flat fill"
      float bendScale = 2.8;
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
      color = mix(color, vec3(1.0, 0.97, 0.9), rimGlow * 0.72);
      // real contrast — a shallow, uniformly-bright range reads as flat,
      // soft plastic; glass needs a genuine dark side to read as
      // reflective/refractive rather than uniformly lit paint. Floor
      // raised (was 0.42) for more light transmission through the body.
      color *= (0.55 + 0.45*diff);

      // several of the steps above (the fresnel-white mix, the specular
      // add) each individually wash a little toward white — stacked
      // together they left a slightly pink/neutral cast, so simply
      // boosting saturation amplified *that* cast into peach/salmon
      // rather than a clean tint. Remapping onto a fixed, now near-
      // white ramp keyed by luminance guarantees the hue itself stays
      // a consistent faint champagne rather than drifting, without
      // dominating the actual refracted/lit detail underneath — kept
      // very light (0.08, was a blanket 0.4) so this reads as a rim/
      // edge tint accent rather than a body-wide colour override; this,
      // the ramp's own much paler endpoints (was 0.58,0.46,0.28 →
      // 1.0,0.9,0.68 — a real amber-gold range), and uColorMid/Bright
      // above are the three places the old warm-gold hue lived, all
      // pulled back together.
      float lum = dot(color, vec3(0.299, 0.587, 0.114));
      vec3 goldRef = mix(vec3(0.90, 0.87, 0.80), vec3(1.0, 0.98, 0.94), lum);
      color = mix(color, goldRef, 0.08);

      // real page content sits behind this canvas — alpha blending
      // toward a white page dilutes even a fully-saturated colour
      // toward pale at low alpha, no matter how rich the computed
      // colour itself is. Floor pulled way down (was 0.28) for a
      // genuinely near-transparent centre — the fresnel edge still
      // climbs to near-opaque at a grazing angle, exactly the way a
      // real glass or water surface brightens and turns opaque-looking
      // right at its own silhouette edge while staying clear through
      // the middle.
      float bodyAlphaFloor = 0.10;
      float bodyAlpha = mix(bodyAlphaFloor, 0.92, rimGlow);

      gl_FragColor = vec4(color, edge*uOpacity*bodyAlpha);
    }
  `;

  // ===================================================================
  // control-point physics
  // ===================================================================
  // per-point noise offsets — large, decorrelated seeds so no two
  // points ever sample the same phase of the wander noise, which is
  // what keeps the whole mass from ever looking like it's repeating.
  const points = [];
  // per-point render sizes, in the same normalized 0..1 space as
  // CONFIG.slimeSize. Every point defaults to the current normal size
  // (see slimeSizeNow in loop()) unless title-dock.js has asked for a
  // specific point to be bigger — see window.Papi.requestPointSizes and
  // requestedSizes below. currentSizes is recomputed every frame in
  // renderOnce() (normalSize vs the latest request, whichever is
  // bigger) and is also what's exposed via getPoints() so title-dock.js
  // is always reasoning about the size that's ACTUALLY being rendered,
  // not a stale or predicted one.
  let currentSizes = new Array(pointCount).fill(CONFIG.slimeSize);
  // per-point minimum-size requests from title-dock.js, normalized —
  // index i asks point i to render at least this big (0 = no request,
  // just use the normal current size). This is the entire mechanism
  // behind "grow the bubble Papi splits off into so it can always
  // fit": title-dock.js decides, every frame, which real point each
  // letter (or group of letters) is riding and how big that letter
  // group's own bounding circle is, and asks for exactly that — this
  // file has no idea what a "letter" or "word" is, it just renders
  // whatever sizes it's told, per point. Persists between calls (rather
  // than resetting every frame) since title-dock.js's own rAF chain is
  // a separate loop that isn't guaranteed to run in lockstep with this
  // one — a stale-by-one-frame request is fine, a request that silently
  // reverts to 0 every frame this file's own loop happens to run first
  // is not.
  let requestedSizes = new Array(pointCount).fill(0);
  // tight on purpose (was a much wider *0.3) — the intro bubble (see
  // CONFIG.introDurationMs above) needs the points already close
  // together the moment the very first frame renders, not slowly
  // drifting into a cluster over the first second while introT's own
  // near-zero wander range keeps their TARGET already basically
  // coincident anyway — starting the points themselves far apart would
  // still show them visibly travelling inward first, which reads as
  // "the liquid is gathering itself" rather than "there's already one
  // bubble here."
  for(let i=0;i<pointCount;i++){
    points.push({
      x: 0.5 + (Math.random()-0.5)*0.05,
      y: 0.5 + (Math.random()-0.5)*0.05,
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

  // cached once per rendered frame (see loop() below), not read fresh
  // via canvas.getBoundingClientRect() on every single mousemove/
  // touchmove event — touchmove in particular can fire dozens of times
  // a second during an ordinary touch-scroll gesture (scrolling on a
  // touch device *is* a touchmove gesture), which meant every scroll on
  // iPhone was forcing an extra synchronous layout read on top of
  // everything else already reacting to that same scroll. A frame or
  // two of staleness on a rect used only for a soft cursor-push effect
  // is imperceptible.
  let canvasRect = { left: 0, top: 0, width: 1, height: 1 };
  function toLocalNorm(clientX, clientY){
    return [(clientX - canvasRect.left) / canvasRect.width, (clientY - canvasRect.top) / canvasRect.height];
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

  const WANDER_RANGE = 0.36; // how far from center (0.5,0.5) a target can wander — normalized units,
                              // scaled the same way as the point positions themselves (see the aspect
                              // fix in the shader's field()), so this roams proportionally regardless
                              // of whether the viewport is portrait or landscape.
  const WANDER_SPEED = 0.00014; // how fast the noise field driving targets itself evolves

  function stepPoints(dtMs, elapsedMs, introT){
    if(mouse.active && performance.now() - lastMoveTime > MOUSE_IDLE_MS) mouse.active = false;
    const dtScale = dtMs / 16.6667; // normalizes physics to "per ~60fps frame" units, using the capped dt

    // 0 at the very start (every point's own wander target collapses to
    // exactly the shared centre, (0.5,0.5), regardless of that point's
    // own noise phase — this is what keeps the whole mass reading as
    // one bubble rather than several already-separating blobs) rising
    // to 1 (full WANDER_RANGE, the normal free-wander behaviour) as the
    // intro eases open — see CONFIG.introDurationMs/introT in loop().
    const wanderRangeNow = WANDER_RANGE * introT;

    for(let i=0;i<points.length;i++){
      const p = points[i];
      const nx = noise2(p.seedX + elapsedMs*WANDER_SPEED, 0) * 2 - 1;
      const ny = noise2(p.seedY + elapsedMs*WANDER_SPEED, 100) * 2 - 1;
      const targetX = 0.5 + nx*wanderRangeNow;
      const targetY = 0.5 + ny*wanderRangeNow;

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
  // Pulled way down in saturation (was a vivid gold gradient/blob set)
  // to near-white/pale-champagne — this is the actual "world" being
  // refracted, so leaving it gold would keep bleeding yellow through
  // no matter how the shader-side tint below is tuned.
  // ===================================================================
  function makeEnvTexture(){
    const size = 512;
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
    uPointSize: { value: new Array(pointCount).fill(CONFIG.slimeSize) },
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
    if(w === W && h === H) return;
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
    // >10px tolerance — see the --stable-vh comment in index.html's <head>
    if(Math.abs(w - lastResizeW) <= 10) return;
    lastResizeW = w;
    clearTimeout(window.__papiSlimeResizeT);
    window.__papiSlimeResizeT = setTimeout(resize, 150);
  });

  let revealed = false;
  let lastTs = null;
  let rafId = null;

  function renderOnce(elapsedMs, slimeSizeNow){
    uniforms.uTime.value = elapsedMs / 1000;
    for(let i=0;i<points.length;i++){
      const p = points[i];
      uniforms.uPoints.value[i].set(p.x, p.y, p.vx * CONFIG.movementSpeed, p.vy * CONFIG.movementSpeed);
      // every point renders at the current normal size UNLESS
      // title-dock.js has asked for it specifically to be bigger (see
      // requestedSizes/window.Papi.requestPointSizes above) — never
      // smaller than normal, so a stale/zero request never shrinks a
      // point below its usual size.
      const sizeNow = Math.max(slimeSizeNow, requestedSizes[i] || 0);
      currentSizes[i] = sizeNow;
      uniforms.uPointSize.value[i] = sizeNow;
    }
    renderer.render(scene, camera);
  }

  // capped at 60 rather than left fully uncapped — the hero is meant to
  // be the smoothest thing on the page, so this stays at 60 even though
  // it's the single biggest sustained GPU contributor (still saves real
  // work on 120Hz ProMotion iPhones, without the visible slow-down a
  // lower cap gave this motion when tried).
  const RENDER_FPS = 60;
  const RENDER_INTERVAL = 1000 / RENDER_FPS;
  let lastRenderTs = 0;
  // accumulated from the same capped per-frame dt used for the point
  // physics below, deliberately NOT a raw `ts - startTs` wall-clock
  // delta — a raw delta is exactly what turned "Papi still jumps at
  // the beginning" from a rare glitch into a near-guaranteed one: any
  // stall in the first couple seconds of load (a throttled/backgrounded
  // tab, a slow device still parsing/compiling, a font swap, a GC
  // pause — all things a fresh page load is especially prone to) makes
  // the very next rendered frame's raw elapsed time jump straight past
  // CONFIG.introDurationMs in one step, snapping introT to 1 and Papi's
  // opacity/position to their end state instantly instead of easing.
  // Accumulating from the same maxDt-capped dt already used for the
  // point physics (see the maxDt comment above) guarantees the intro
  // always plays out over a real minimum number of rendered frames no
  // matter what stalls happen around it — a stall just makes it take
  // longer in wall-clock terms, never skips it.
  let elapsedAccum = 0;
  // 0 the moment the mass is first revealed (one bubble, covering
  // "Papi"), easing to 1 once it's fully open into the normal free-
  // wander liquid — see CONFIG.introDurationMs, the wanderRangeNow
  // scaling in stepPoints(), and the uSlimeSize scaling just below.
  // Exposed via getIntroT so title-dock.js can hand off from "still
  // covered by the bubble" to "actively tracking/following the now-
  // open liquid" at the true moment that finishes, rather than a
  // guessed fixed timer (which is what used to read as a visible jump
  // on slower devices that hadn't actually caught up to that guess yet).
  let latestIntroT = 0;
  function smoothstep01(t){
    const c = Math.max(0, Math.min(1, t));
    return c*c*(3-2*c);
  }

  function loop(ts){
    if(!revealed){ rafId = requestAnimationFrame(loop); return; }

    if(ts - lastRenderTs < RENDER_INTERVAL){
      rafId = requestAnimationFrame(loop);
      return;
    }
    lastRenderTs = ts;
    // refreshed here (once per rendered frame, already capped above)
    // rather than on every raw mousemove/touchmove event — see the
    // note by canvasRect's declaration
    canvasRect = canvas.getBoundingClientRect();

    const dt = lastTs === null ? 16.6667 : Math.min(ts - lastTs, CONFIG.maxDt);
    lastTs = ts;
    elapsedAccum += dt;
    const elapsed = elapsedAccum;

    const introT = smoothstep01(elapsed / CONFIG.introDurationMs);
    latestIntroT = introT;
    // eases from introSizeBoost× down to the normal 1x — a single
    // uniform shared by every point, so the whole cluster shrinks
    // together as it opens up rather than any one point changing size
    // independently of the others
    const slimeSizeNow = CONFIG.slimeSize * (CONFIG.introSizeBoost - (CONFIG.introSizeBoost - 1) * introT);
    uniforms.uSlimeSize.value = slimeSizeNow;

    stepPoints(dt, elapsed, introT);
    renderOnce(elapsed, slimeSizeNow);

    rafId = requestAnimationFrame(loop);
  }

  resize();

  if(prefersReducedMotion){
    // a single static frame, already fully settled (introT=1) rather
    // than frozen mid-intro — no ongoing simulation and no render loop
    // at all otherwise
    uniforms.uSlimeSize.value = CONFIG.slimeSize;
    stepPoints(16.6667, 0, 1);
    latestIntroT = 1;
    renderOnce(0, CONFIG.slimeSize);
  } else {
    rafId = requestAnimationFrame(loop);
  }

  // ===================================================================
  // real-time edge repulsion — a JS-side re-implementation of the
  // shader's own field()/smin() (see the FRAGMENT source above), used
  // to answer "how far is this exact screen point from the liquid's
  // TRUE current edge, and which way is inward?" for any letter's
  // actual final rendered position, not just its tracked target.
  //
  // The per-letter tracking in title-dock.js (nearest-point targeting,
  // per-point size requests) keeps each letter's TARGET safely inside —
  // but the letters also get pushed around afterward by the cursor
  // (see FLOW_PUSH in title-dock.js), an offset that was never checked
  // against the liquid's real shape at all. This is what actually
  // guarantees containment regardless of that or any other source of
  // displacement: sample the real field at wherever a letter actually
  // ends up, and if that's too close to (or past) the true edge, hand
  // back a correction vector pushing it back in — the liquid's own
  // outline physically repelling the letter, exactly as asked for.
  // ===================================================================
  function sminJS(a, b, k){
    const h = Math.max(0, Math.min(1, 0.5 + 0.5*(b-a)/k));
    return b*(1-h) + a*h - k*h*(1-h);
  }
  // takes already aspect-corrected "p-space" coordinates (see the
  // shader's own field(p, aspect) and its surrounding comment) — 1 unit
  // in this space is exactly H real screen pixels, isotropically in
  // both axes, which is what makes a gradient computed here point the
  // same real-world direction as in plain screen pixels (see
  // getInwardPushPx below).
  function sampleFieldRaw(px, py){
    const aspect = W / H;
    let f = 1e5;
    for(let i=0;i<points.length;i++){
      const p = points[i];
      const ptx = p.x*aspect, pty = p.y;
      let dx = px-ptx, dy = py-pty;
      const vx = p.vx*CONFIG.movementSpeed, vy = p.vy*CONFIG.movementSpeed;
      const speed = Math.sqrt(vx*vx + vy*vy);
      if(speed > 0.0005){
        const dirx = vx/speed, diry = vy/speed;
        const along = dx*dirx + dy*diry;
        const perpx = dx - dirx*along, perpy = dy - diry*along;
        const stretch = 1 + speed*CONFIG.stretchAmount;
        const compress = 1 + speed*CONFIG.compressAmount;
        dx = dirx*(along/stretch) + perpx*compress;
        dy = diry*(along/stretch) + perpy*compress;
      }
      const dist = Math.sqrt(dx*dx + dy*dy) - currentSizes[i];
      f = sminJS(f, dist, CONFIG.surfaceTension);
    }
    return f; // negative = inside, 0 = right at the edge, positive = outside; magnitude in p-space units (1 unit = H px)
  }

  window.Papi = window.Papi || {};
  window.Papi.resizeField = resize;
  // every control point's own current position (normalized 0..1, same
  // space as point.x/y) and its ACTUAL currently-rendered radius
  // (already normalized the same way, including any boost granted via
  // requestPointSizes below) — read every frame by title-dock.js so it
  // can work out, per letter, which real point (if any) already covers
  // that letter's ideal position, or which one to ride instead if none
  // do. This file has no notion of "letters" or "words" at all — it
  // just hands back the raw, real, current state of the field and
  // accepts size requests against it.
  window.Papi.getPoints = () => points.map((p, i) => ({ x: p.x, y: p.y, radius: currentSizes[i] }));
  // the canvas's own actual current rendered size, in real pixels — the
  // ONLY correct basis for converting the normalized positions/radii
  // above into on-screen pixels. Position needs per-axis conversion
  // (x * width, y * height); a RADIUS needs a single isotropic factor,
  // and that factor is specifically height (not width, not
  // min(width,height)) — the shader's own aspect correction (see
  // field()'s ptPos/p) makes its whole distance/radius space isotropic
  // in units of screen HEIGHT (both vUv.y and vUv.x*aspect reduce to
  // screenCoord/height). Handing back the canvas's own W/H (rather than
  // title-dock.js reading window.innerWidth/innerHeight itself) also
  // keeps both files using the exact same numbers the shader is
  // actually using right now, avoiding yet another momentary mismatch
  // of the kind already fixed once this session (H can briefly differ
  // from window.innerHeight around an iOS address-bar collapse).
  window.Papi.getCanvasSize = () => ({ width: W, height: H });
  // asks specific points to render at least this big — sizesNormArray
  // is a plain array, one normalized radius per point index (0 = no
  // request, keep the normal current size). This is the entire
  // mechanism behind "grow the bubble Papi splits off into so it can
  // always fit," generalized to work per-letter/per-group rather than
  // for the whole word at once: title-dock.js decides which point(s)
  // "Papi"'s letters are currently riding and how big each needs to be,
  // this file just renders it. See requestedSizes/currentSizes above.
  window.Papi.requestPointSizes = function(sizesNormArray){
    requestedSizes = sizesNormArray;
    // prefers-reduced-motion renders exactly one static frame up front
    // (see below) rather than an ongoing loop — without this, a size
    // request arriving after that frame (title-dock.js's own rAF chain
    // keeps running regardless of this file's reduced-motion state)
    // would never actually get drawn, silently breaking containment
    // for exactly the visitors this mode exists to accommodate. One
    // extra static render on request, still no ongoing animation.
    if(prefersReducedMotion) renderOnce(0, CONFIG.slimeSize);
  };
  // 0 through the opening intro bubble, 1 once fully settled into the
  // normal free-wander liquid — see the comment on latestIntroT above
  window.Papi.getIntroT = () => latestIntroT;
  // given a page pixel position and how far inside the liquid it needs
  // to stay (marginPx — typically a letter's own half-extent, so its
  // whole bounding circle stays covered, not just its centre point),
  // returns {dx, dy}: exactly the correction needed to bring that point
  // back to at least marginPx inside the liquid's TRUE current edge —
  // {0, 0} if it's already safely inside. This is the actual "let the
  // outline repel the letters" mechanism: title-dock.js calls this on
  // every letter's real final position (after its own tracking AND
  // cursor-push physics have both already been applied) and adds the
  // result directly to that letter's transform, so the liquid's real
  // current shape is the last word on where a letter can ever end up,
  // regardless of what pushed it there.
  window.Papi.getInwardPush = function(pageX, pageY, marginPx){
    if(!W || !H) return { dx: 0, dy: 0 };
    const aspect = W / H;
    const px = (pageX / W) * aspect, py = pageY / H;
    const marginNorm = marginPx / H;
    const eps = 0.004;
    const f0 = sampleFieldRaw(px, py);
    const overshoot = f0 + marginNorm; // > 0 means we're closer to (or past) the edge than the requested margin allows
    if(overshoot <= 0) return { dx: 0, dy: 0 };
    const fx = sampleFieldRaw(px+eps, py) - sampleFieldRaw(px-eps, py);
    const fy = sampleFieldRaw(px, py+eps) - sampleFieldRaw(px, py-eps);
    const gLen = Math.sqrt(fx*fx + fy*fy) || 1;
    // unit outward normal — direction is identical in p-space and real
    // screen pixels (p-space is real pixels uniformly scaled by 1/H, an
    // isotropic scale that preserves every angle), so this can be
    // applied directly to page-pixel coordinates with no reprojection
    const gxN = fx/gLen, gyN = fy/gLen;
    const pushPx = overshoot * H;
    return { dx: -gxN*pushPx, dy: -gyN*pushPx };
  };
  window.Papi.revealField = function(){
    if(revealed) return;
    revealed = true;
    requestAnimationFrame(()=>{ canvas.classList.add('is-visible'); });
  };
})();
