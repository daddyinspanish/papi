/* ===================================================================
   Papi — ShowcaseLiquid
   Two small extra gold-glass masses, flanking the fan of preview cards
   — the same metaball/refraction material js/hero-slime.js uses for
   the hero (and, reparented, the contrast section), reused here as two
   independent, much smaller instances rather than a third appearance
   of that same single mass. Each slides in from its own side (left/
   right) as the visitor nears the last couple of cards — the same
   scroll range js/showcase.js fades this section's own backdrop from
   black to cream over — and slides back out on scroll-up, a pure
   function of scroll position like everything else on this page.

   The shader/physics below is deliberately a near-duplicate of
   hero-slime.js's rather than a shared import: same reasoning as that
   file's own duplicated noise functions — this runs independently,
   smaller and simpler (fewer control points, no cursor interaction),
   and the two having no runtime dependency on each other means neither
   can break by editing the other.
=================================================================== */
import * as THREE from './vendor/three.module.min.js';

(function(){
  const section = document.getElementById('showcase');
  const leftCanvas = document.getElementById('showcaseLiquidLeft');
  const rightCanvas = document.getElementById('showcaseLiquidRight');
  if(!section || !leftCanvas || !rightCanvas) return;

  const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(prefersReducedMotion) return; // purely decorative — skip entirely rather than a static frame nobody asked for

  function smoothstep(e0, e1, x){
    const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  }

  const CONFIG = {
    numControlPoints: 3,
    slimeSize: 0.16,
    movementSpeed: 0.22,
    viscosity: 0.88,
    damping: 0.94,
    elasticity: 0.16,
    surfaceTension: 0.11,
    noiseStrength: 0.16,
    opacity: 0.92,
    highlightIntensity: 0.4,
    edgeSoftness: 0.004,
    stretchAmount: 4.5,
    compressAmount: 1.6,
    colorMid:    [0.90, 0.68, 0.28],
    colorBright: [1.00, 0.92, 0.68],
    maxDt: 1000/24,
    wanderRange: 0.34,
    wanderSpeed: 0.00026,
  };
  const pointCount = CONFIG.numControlPoints;

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
    uniform vec4 uPoints[${pointCount}];
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
    vec3 envSample(vec2 dir){
      vec2 uv = clamp(dir*0.5 + 0.5, 0.0, 1.0);
      return texture2D(uEnvMap, uv).rgb;
    }
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

      float eps = 0.006;
      float fx = field(p+vec2(eps,0.0), aspect) - field(p-vec2(eps,0.0), aspect);
      float fy = field(p+vec2(0.0,eps), aspect) - field(p-vec2(0.0,eps), aspect);
      float gLen = length(vec2(fx, fy));
      vec2 gDir = gLen > 0.00001 ? vec2(fx, fy)/gLen : vec2(1.0, 0.0);

      float pathT = clamp(-f / (uSlimeSize*0.55), 0.0, 1.0);
      float domeHoriz = clamp(1.0 - pathT, 0.0, 1.0);
      float domeVert = sqrt(max(0.0, 1.0 - domeHoriz*domeHoriz));
      vec3 normal = normalize(vec3(-gDir*domeHoriz, domeVert + 0.02));

      vec2 noiseP = p*7.0 + uTime*0.05;
      float ng  = fbm(noiseP);
      float ng1 = fbm(noiseP+vec2(eps*4.0,0.0));
      float ng2 = fbm(noiseP+vec2(0.0,eps*4.0));
      vec3 bumpNormal = normalize(normal + vec3((ng1-ng),(ng2-ng),0.0) * 0.3);

      vec3 viewDir = vec3(0.0, 0.0, 1.0);
      vec3 lightDir = normalize(vec3(-0.35, 0.55, 0.7));

      float diff = max(0.0, dot(bumpNormal, lightDir));
      vec3 reflectDir = reflect(-lightDir, bumpNormal);
      float spec = pow(max(0.0, dot(reflectDir, viewDir)), 220.0);
      float sheen = pow(max(0.0, dot(reflectDir, viewDir)), 12.0);
      float fresnel = pow(1.0 - max(0.0, dot(normal, viewDir)), 3.2);

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

      float absorb = pow(pathT, 0.7);
      vec3 tint = mix(vec3(1.0), mix(uColorMid, uColorBright, 0.4), absorb);
      vec3 color = envColor * tint;

      color += vec3(1.0, 0.98, 0.94) * spec * (1.6 + uHighlightIntensity);
      color += vec3(1.0, 0.95, 0.82) * sheen * 0.22;
      color = mix(color, vec3(1.0, 0.97, 0.9), fresnel * 0.6);
      color *= 0.42 + 0.58*diff;

      float lum = dot(color, vec3(0.299, 0.587, 0.114));
      vec3 goldRef = mix(vec3(0.45, 0.26, 0.05), vec3(1.0, 0.68, 0.18), lum);
      color = mix(color, goldRef, 0.88);

      float bodyAlpha = mix(0.36, 0.97, fresnel);
      gl_FragColor = vec4(color, edge*uOpacity*bodyAlpha);
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

  function makeEnvTexture(){
    const size = 256;
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    const base = ctx.createLinearGradient(0, 0, 0, size);
    base.addColorStop(0, '#fffaf0');
    base.addColorStop(0.55, '#ffcf5c');
    base.addColorStop(1, '#c67d1e');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);
    const blobColors = ['#fffbe8', '#ffe6a8', '#ffcf5c', '#f0aa3c', '#d68a2a'];
    let seed = 7;
    function rand(){
      seed = (seed*1103515245 + 12345) & 0x7fffffff;
      return (seed % 10000) / 10000;
    }
    for(let i=0;i<16;i++){
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

  // one instance's worth of state/render-loop, factored out since both
  // sides are identical except for canvas element and a seed offset
  // (so the two don't wander in lockstep, mirrored)
  function createInstance(canvas, seedOffset){
    const points = [];
    for(let i=0;i<pointCount;i++){
      points.push({
        x: 0.5 + (Math.random()-0.5)*0.3,
        y: 0.5 + (Math.random()-0.5)*0.3,
        vx: 0, vy: 0,
        seedX: seedOffset + Math.random()*1000,
        seedY: seedOffset + Math.random()*1000,
      });
    }

    function stepPoints(dtMs, elapsedMs){
      const dtScale = dtMs / 16.6667;
      for(let i=0;i<points.length;i++){
        const p = points[i];
        const nx = noise2(p.seedX + elapsedMs*CONFIG.wanderSpeed, 0) * 2 - 1;
        const ny = noise2(p.seedY + elapsedMs*CONFIG.wanderSpeed, 100) * 2 - 1;
        const targetX = 0.5 + nx*CONFIG.wanderRange;
        const targetY = 0.5 + ny*CONFIG.wanderRange;
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
      vertexShader: VERTEX, fragmentShader: FRAGMENT, uniforms,
      transparent: true, depthTest: false, depthWrite: false,
    });
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));

    function resize(){
      const w = canvas.clientWidth || 200;
      const h = canvas.clientHeight || 200;
      if(!w || !h) return;
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(w, h, false);
      uniforms.uResolution.value.set(w, h);
    }

    function renderOnce(elapsedMs){
      uniforms.uTime.value = elapsedMs / 1000;
      for(let i=0;i<points.length;i++){
        const p = points[i];
        const v = uniforms.uPoints.value[i];
        v.set(p.x, p.y, p.vx * CONFIG.movementSpeed, p.vy * CONFIG.movementSpeed);
      }
      renderer.render(scene, camera);
    }

    return { stepPoints, resize, renderOnce };
  }

  const left = createInstance(leftCanvas, 0);
  const right = createInstance(rightCanvas, 500);
  left.resize();
  right.resize();

  let lastResizeW = window.innerWidth;
  window.addEventListener('resize', ()=>{
    const w = window.innerWidth;
    if(w === lastResizeW) return;
    lastResizeW = w;
    clearTimeout(window.__papiShowcaseLiquidResizeT);
    window.__papiShowcaseLiquidResizeT = setTimeout(()=>{ left.resize(); right.resize(); }, 150);
  });

  // slides in from off-screen on its own side as the visitor nears the
  // last couple of cards (the same range js/showcase.js fades this
  // section's backdrop from black to cream over), and back out again
  // on scroll-up — a pure function of scroll position, reversible with
  // no separate teardown logic
  const ENTER_START = 0.62, ENTER_END = 0.82;
  const EXIT_START = 0.92, EXIT_END = 1.0;
  let lastTs = null, elapsedStart = null;
  let running = false;

  // capped at 60 rather than left fully uncapped — still saves real
  // work on 120Hz ProMotion iPhones, without the visible slow-down a
  // lower cap (30fps was tried and reverted per feedback) gave this
  // particular motion. These two only render at all for the short
  // stretch this section is actually in view, unlike the hero's own
  // metaball (see hero-slime.js), which is the far bigger, continuous
  // contributor to sustained GPU load and stays capped lower.
  const RENDER_FPS = 60;
  const RENDER_INTERVAL = 1000 / RENDER_FPS;
  let lastRenderTs = 0;

  function loop(ts){
    const rect = section.getBoundingClientRect();
    const visible = rect.bottom > 0 && rect.top < window.innerHeight;
    if(!visible){ running = false; return; }
    running = true;

    const sectionTop = section.offsetTop;
    const scrollable = Math.max(1, section.offsetHeight - window.innerHeight);
    const progress = Math.max(0, Math.min(1, (window.scrollY - sectionTop) / scrollable));

    const enterT = smoothstep(ENTER_START, ENTER_END, progress);
    const exitT = smoothstep(EXIT_START, EXIT_END, progress);
    const t = enterT * (1 - exitT);

    const slidePx = (1 - t) * 90;
    leftCanvas.style.opacity = String(t);
    leftCanvas.style.transform = `translateY(-50%) translateX(${(-slidePx).toFixed(1)}px)`;
    rightCanvas.style.opacity = String(t);
    rightCanvas.style.transform = `translateY(-50%) translateX(${slidePx.toFixed(1)}px)`;

    if(t <= 0.001){
      requestAnimationFrame(loop);
      return;
    }

    if(ts - lastRenderTs < RENDER_INTERVAL){
      requestAnimationFrame(loop);
      return;
    }
    lastRenderTs = ts;

    const dt = lastTs === null ? 16.6667 : Math.min(ts - lastTs, CONFIG.maxDt);
    lastTs = ts;
    if(elapsedStart === null) elapsedStart = ts;
    const elapsed = ts - elapsedStart;

    left.stepPoints(dt, elapsed);
    left.renderOnce(elapsed);
    right.stepPoints(dt, elapsed * 0.92);
    right.renderOnce(elapsed * 0.92);

    requestAnimationFrame(loop);
  }

  window.addEventListener('scroll', ()=>{
    if(running) return;
    running = true;
    requestAnimationFrame(loop);
  }, { passive:true });
  requestAnimationFrame(loop);
})();
