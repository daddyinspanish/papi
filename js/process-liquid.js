/* ===================================================================
   Papi — process-step liquid bubbles
   Each "Discover/Design/Develop/Launch" card gets its own small WebGL
   metaball scene (same smin-blended-circles + refraction technique as
   the hero's own liquid — see js/hero-slime.js) rendered into a canvas
   that fills the card, clipped to its rounded corners for free by the
   card's own overflow:hidden (no border-radius maths needed here at
   all). A handful of small "bubbles" per card drift and merge inside
   it, rendered at full glass brightness; everywhere else the card
   shows a plain translucent liquid tint instead of being fully
   transparent, so the card reads as a pane of liquid the bubbles move
   through, not as a few circles floating over empty space.

   Four independent THREE.WebGLRenderer instances (one per card) rather
   than one shared canvas spanning the whole row — simpler per-card
   physics (each just wanders around its own centre) and no need to
   remap UVs per region. Paused via IntersectionObserver while the row
   is off-screen, same "don't spend GPU on what nobody's looking at"
   principle as the render-rate cap already applied to the hero.
=================================================================== */
import * as THREE from './vendor/three.module.min.js';

(function(){
  const canvases = Array.from(document.querySelectorAll('.hero-process-liquid'));
  if(!canvases.length) return;

  const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const POINT_COUNT = 3;

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
    uniform vec4 uPoints[${POINT_COUNT}];
    uniform float uBubbleSize;
    uniform float uSurfaceTension;
    uniform float uNoiseStrength;
    uniform float uBlendRange;
    uniform float uBaseAlpha;
    uniform vec3 uBaseColorTop;
    uniform vec3 uBaseColorBottom;
    uniform vec3 uBubbleColor;
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
        float dist = length(p-ptPos) - uBubbleSize;
        f = smin(f, dist, uSurfaceTension);
      }
      return f;
    }

    void main(){
      float aspect = uResolution.x / uResolution.y;
      vec2 p = vec2(vUv.x*aspect, vUv.y);

      float n = fbm(p*3.5 + uTime*0.06) - 0.5;
      float raw = field(p, aspect);
      float f = raw - n*uNoiseStrength*0.12;

      // always-present base fill — a plain vertical gradient, cheap,
      // no dependency on the bubble field at all. This is what keeps
      // the card reading as "a pane of liquid" everywhere a bubble
      // isn't, rather than showing empty page background through it.
      vec3 baseColor = mix(uBaseColorTop, uBaseColorBottom, clamp(vUv.y, 0.0, 1.0));

      // surface normal + refraction, same dome-profile trick as the
      // hero's own shader — computed unconditionally (cheap at this
      // small a resolution) and blended in by bubbleT below, which
      // fades to 0 well outside any bubble anyway.
      float eps = 0.008;
      float fx = field(p+vec2(eps,0.0), aspect) - field(p-vec2(eps,0.0), aspect);
      float fy = field(p+vec2(0.0,eps), aspect) - field(p-vec2(0.0,eps), aspect);
      float gLen = length(vec2(fx, fy));
      vec2 gDir = gLen > 0.00001 ? vec2(fx, fy)/gLen : vec2(1.0, 0.0);

      float pathT = clamp(-f / (uBubbleSize*0.6), 0.0, 1.0);
      float domeHoriz = clamp(1.0 - pathT, 0.0, 1.0);
      float domeVert = sqrt(max(0.0, 1.0 - domeHoriz*domeHoriz));
      vec3 normal = normalize(vec3(-gDir*domeHoriz, domeVert + 0.02));

      vec3 viewDir = vec3(0.0, 0.0, 1.0);
      vec3 lightDir = normalize(vec3(-0.35, 0.55, 0.7));
      float diff = max(0.0, dot(normal, lightDir));
      vec3 reflectDir = reflect(-lightDir, normal);
      float spec = pow(max(0.0, dot(reflectDir, viewDir)), 220.0);
      float sheen = pow(max(0.0, dot(reflectDir, viewDir)), 12.0);
      float fresnel = pow(1.0 - max(0.0, dot(normal, viewDir)), 3.4);

      vec3 refractDir = refract(-viewDir, normal, 1.0/1.55);
      if(dot(refractDir, refractDir) < 0.0001) refractDir = -viewDir;
      vec3 envColor = envSample(refractDir.xy * 2.4);

      float absorb = pow(pathT, 0.7);
      vec3 tint = mix(vec3(1.0), uBubbleColor, absorb*0.5);
      vec3 bubbleColor = envColor * tint;
      bubbleColor += vec3(1.0, 0.98, 0.94) * spec * 1.8;
      bubbleColor += vec3(1.0, 0.95, 0.85) * sheen * 0.2;
      bubbleColor = mix(bubbleColor, vec3(1.0, 0.97, 0.9), fresnel*0.65);
      bubbleColor *= (0.78 + 0.22*diff);
      float bubbleAlpha = mix(0.3, 0.88, fresnel);

      // 1 well inside/at a bubble, easing to 0 by uBlendRange beyond its
      // own edge — a NARROW feather (this used to be wide enough that
      // the shaded/dark side of each bubble's own dome bled far out into
      // the surrounding base fill, reading as an oversized drop-shadow
      // rather than a glassy highlight) so bubbles still melt softly
      // into the fill right at their own rim, without dragging their
      // own shading out past it.
      float bubbleT = 1.0 - smoothstep(0.0, uBlendRange, f);

      vec3 color = mix(baseColor, bubbleColor, bubbleT);
      float alpha = mix(uBaseAlpha, bubbleAlpha, bubbleT);

      gl_FragColor = vec4(color, alpha);
    }
  `;

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

  // a small baked, non-repeating pale-champagne image for the bubbles to
  // refract — same reasoning as hero-slime.js's own makeEnvTexture (a
  // live sin()-band pattern spirals into a pinwheel once bent through a
  // curved surface; an irregular raster doesn't), just a smaller bake
  // and shared read-only across every card's own material/renderer.
  function makeEnvTexture(){
    const size = 160;
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    const base = ctx.createLinearGradient(0, 0, 0, size);
    base.addColorStop(0, '#ffffff');
    base.addColorStop(0.55, '#fdf6ea');
    base.addColorStop(1, '#f2e4cc');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);
    const blobColors = ['#ffffff', '#fdf8ee', '#faf1e0', '#f5e8d0'];
    let seed = 7;
    function rand(){
      seed = (seed*1103515245 + 12345) & 0x7fffffff;
      return (seed % 10000) / 10000;
    }
    for(let i=0;i<14;i++){
      const r = size*(0.1 + rand()*0.22);
      const x = rand()*size, y = rand()*size;
      ctx.filter = `blur(${Math.round(size*0.02 + rand()*size*0.03)}px)`;
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

  // per-point horizontal "home" fractions of the canvas's own width — the
  // container is now short and wide (a rectangle sized to hold a title,
  // not a square card), so three points wandering around one shared
  // shared centre would leave the left/right thirds uncovered most of
  // the time. Spreading their own wander centres across the width
  // instead, close enough together (relative to bubbleSize below) that
  // they always stay merged into one continuous pill via surface
  // tension, is what makes the mass actually read as "a bigger rectangle
  // bubble" rather than three separate small circles.
  const POINT_HOME_X = [0.32, 0.5, 0.68];

  function createInstance(canvas){
    const CONFIG = {
      bubbleSize: 0.42,
      surfaceTension: 0.18,
      noiseStrength: 0.14,
      blendRange: 0.10,
      baseAlpha: 0.16,
      baseColorTop: [1.0, 0.99, 0.95],
      baseColorBottom: [0.97, 0.92, 0.82],
      bubbleColor: [0.95, 0.88, 0.72],
      wanderRangeX: 0.07,
      wanderRangeY: 0.16,
      wanderSpeed: 0.00016,
      movementSpeed: 0.22,
      viscosity: 0.93,
      damping: 0.94,
      elasticity: 0.1,
    };

    const points = [];
    for(let i=0;i<POINT_COUNT;i++){
      const homeX = POINT_HOME_X[i % POINT_HOME_X.length];
      points.push({
        x: homeX + (Math.random()-0.5)*0.05,
        y: 0.5 + (Math.random()-0.5)*0.05,
        homeX,
        vx: 0, vy: 0,
        seedX: Math.random()*1000,
        seedY: Math.random()*1000,
      });
    }
    function stepPoints(dtMs, elapsedMs){
      const dtScale = dtMs / 16.6667;
      for(let i=0;i<points.length;i++){
        const p = points[i];
        const nx = noise2(p.seedX + elapsedMs*CONFIG.wanderSpeed, 0) * 2 - 1;
        const ny = noise2(p.seedY + elapsedMs*CONFIG.wanderSpeed, 100) * 2 - 1;
        const targetX = p.homeX + nx*CONFIG.wanderRangeX;
        const targetY = 0.5 + ny*CONFIG.wanderRangeY;
        let ax = (targetX - p.x) * CONFIG.elasticity;
        let ay = (targetY - p.y) * CONFIG.elasticity;
        p.vx += ax * (1 - CONFIG.viscosity) * dtScale;
        p.vy += ay * (1 - CONFIG.viscosity) * dtScale;
        p.vx *= CONFIG.damping;
        p.vy *= CONFIG.damping;
        p.x += p.vx * CONFIG.movementSpeed * dtScale;
        p.y += p.vy * CONFIG.movementSpeed * dtScale;
      }
    }

    const renderer = new THREE.WebGLRenderer({ canvas, alpha:true, antialias:false, powerPreference:'low-power' });
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const uniforms = {
      uResolution: { value: new THREE.Vector2(1,1) },
      uTime: { value: 0 },
      uPoints: { value: new Array(POINT_COUNT).fill(0).map(()=> new THREE.Vector4(0,0,0,0)) },
      uBubbleSize: { value: CONFIG.bubbleSize },
      uSurfaceTension: { value: CONFIG.surfaceTension },
      uNoiseStrength: { value: CONFIG.noiseStrength },
      uBlendRange: { value: CONFIG.blendRange },
      uBaseAlpha: { value: CONFIG.baseAlpha },
      uBaseColorTop: { value: new THREE.Vector3(...CONFIG.baseColorTop) },
      uBaseColorBottom: { value: new THREE.Vector3(...CONFIG.baseColorBottom) },
      uBubbleColor: { value: new THREE.Vector3(...CONFIG.bubbleColor) },
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
      const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
      if(!w || !h) return;
      if(w === W && h === H) return;
      W = w; H = h;
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(W, H, false);
      uniforms.uResolution.value.set(W, H);
    }
    resize();

    function renderOnce(elapsedMs){
      uniforms.uTime.value = elapsedMs / 1000;
      for(let i=0;i<points.length;i++){
        const p = points[i];
        uniforms.uPoints.value[i].set(p.x, p.y, p.vx, p.vy);
      }
      renderer.render(scene, camera);
    }

    const RENDER_FPS = 30; // purely decorative background — no need for 60fps here
    const RENDER_INTERVAL = 1000 / RENDER_FPS;
    const maxDt = 1000/24; // same runaway-dt guard as hero-slime.js
    let running = false, rafId = null, lastTs = null, elapsedAccum = 0, lastRenderTs = 0;

    function loop(ts){
      if(!running) return;
      if(ts - lastRenderTs < RENDER_INTERVAL){
        rafId = requestAnimationFrame(loop);
        return;
      }
      lastRenderTs = ts;
      const dt = lastTs === null ? 16.6667 : Math.min(ts - lastTs, maxDt);
      lastTs = ts;
      elapsedAccum += dt;
      stepPoints(dt, elapsedAccum);
      renderOnce(elapsedAccum);
      rafId = requestAnimationFrame(loop);
    }
    function start(){
      if(running) return;
      running = true;
      lastTs = null;
      rafId = requestAnimationFrame(loop);
    }
    function stop(){
      running = false;
      if(rafId) cancelAnimationFrame(rafId);
      rafId = null;
    }

    if(prefersReducedMotion){
      stepPoints(16.6667, 0);
      renderOnce(0);
    } else {
      start();
    }

    let lastResizeW = window.innerWidth;
    window.addEventListener('resize', ()=>{
      const w = window.innerWidth;
      if(Math.abs(w - lastResizeW) <= 10) return;
      lastResizeW = w;
      clearTimeout(canvas.__papiProcResizeT);
      canvas.__papiProcResizeT = setTimeout(resize, 150);
    });
    if(document.fonts && document.fonts.ready) document.fonts.ready.then(resize);
    window.addEventListener('load', resize);

    return { start, stop };
  }

  const instances = canvases.map(createInstance);

  // pause every instance while the whole process row is off-screen —
  // four extra WebGL contexts is cheap while visible, free to skip
  // entirely once scrolled well past.
  if(!prefersReducedMotion && 'IntersectionObserver' in window){
    const row = document.getElementById('heroProcess');
    if(row){
      const io = new IntersectionObserver((entries)=>{
        entries.forEach(entry=>{
          instances.forEach(inst=> entry.isIntersecting ? inst.start() : inst.stop());
        });
      }, { rootMargin: '200px 0px' });
      io.observe(row);
    }
  }
})();
