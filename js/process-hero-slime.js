/* ===================================================================
   Papi — Process Hero Slime
   A leaner variant of js/hero-slime.js's own metaball glass shader
   (see that file's own header for the full technique writeup), reused
   here as a purely decorative, cursor-reactive liquid layer floating
   over the new Process hero's own background photo. This copy drops
   everything hero-slime.js only needed for the OLD "Papi" word-riding
   intro (requestPointSizes/getInwardPush/getPoints/etc.) — nothing
   here needs to track letters, so it's just: metaball physics + shader
   + resize + a self-triggered reveal.
=================================================================== */
import * as THREE from './vendor/three.module.min.js';

(function(){
  const canvas = document.getElementById('processHeroSlime');
  if(!canvas) return;

  const CONFIG = {
    numControlPoints: 6,
    slimeSize: 0.115,
    movementSpeed: 0.22,
    viscosity: 0.93,
    damping: 0.94,
    elasticity: 0.11,
    surfaceTension: 0.10,
    noiseStrength: 0.16,
    // a touch stronger than the top hero's own 0.12/0.38 — this canvas
    // sits over a much busier photographed background, so the cursor's
    // own "moving ripple" needs a slightly bigger, more noticeable pull
    // to still read against that detail
    mouseForce: 0.16,
    mouseRadius: 0.42,
    // lower ceiling than the top hero (was 0.92) — this is an accent
    // floating over a real photo, not the whole visual, so it should
    // read as a subtle glassy disturbance rather than covering the art
    opacity: 0.5,
    highlightIntensity: 0.5,
    edgeSoftness: 0.004,
    mobileQuality: 0.55,
    mobileWidth: 640,
    stretchAmount: 5.5,
    compressAmount: 1.8,
    colorMid:    [0.97, 0.955, 0.92],
    colorBright: [1.00, 0.995, 0.985],
    maxDt: 1000/24,
    introDurationMs: 1400,
    introSizeBoost: 2.0,
  };

  const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isMobile = window.innerWidth < CONFIG.mobileWidth;
  const pointCount = isMobile ? Math.max(3, Math.round(CONFIG.numControlPoints * 0.7)) : CONFIG.numControlPoints;
  const qualityScale = isMobile ? CONFIG.mobileQuality : 1;
  const centerX = 0.5, centerY = 0.5;

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
      float spec = pow(max(0.0, dot(reflectDir, viewDir)), 260.0);
      float sheen = pow(max(0.0, dot(reflectDir, viewDir)), 14.0);
      float fresnel = pow(1.0 - max(0.0, dot(normal, viewDir)), 3.6);
      float rimGlow = fresnel;

      vec3 refractDirG = refract(-viewDir, bumpNormal, 1.0/1.55);
      if(dot(refractDirG, refractDirG) < 0.0001) refractDirG = -viewDir;
      vec3 refractDirR = refract(-viewDir, bumpNormal, 1.0/1.51);
      if(dot(refractDirR, refractDirR) < 0.0001) refractDirR = -viewDir;
      vec3 refractDirB = refract(-viewDir, bumpNormal, 1.0/1.59);
      if(dot(refractDirB, refractDirB) < 0.0001) refractDirB = -viewDir;
      float bendScale = 2.8;
      vec3 envColor = vec3(
        envSample(refractDirR.xy * bendScale).r,
        envSample(refractDirG.xy * bendScale).g,
        envSample(refractDirB.xy * bendScale).b
      );

      float absorb = pow(pathT, 0.7);
      vec3 tint = mix(vec3(1.0), mix(uColorMid, uColorBright, 0.4), absorb);
      vec3 color = envColor * tint;

      color += vec3(0.82, 0.93, 1.0) * spec * (1.6 + uHighlightIntensity);
      color += vec3(1.0, 0.95, 0.82) * sheen * 0.22;
      color = mix(color, vec3(0.8, 0.91, 1.0), rimGlow * 0.62);
      color *= (0.55 + 0.45*diff);

      float lum = dot(color, vec3(0.299, 0.587, 0.114));
      vec3 goldRef = mix(vec3(0.90, 0.87, 0.80), vec3(1.0, 0.98, 0.94), lum);
      color = mix(color, goldRef, 0.08);

      float bodyAlphaFloor = 0.10;
      float bodyAlpha = mix(bodyAlphaFloor, 0.92, rimGlow);

      gl_FragColor = vec4(color, edge*uOpacity*bodyAlpha);
    }
  `;

  const points = [];
  for(let i=0;i<pointCount;i++){
    points.push({
      x: centerX + (Math.random()-0.5)*0.05,
      y: centerY + (Math.random()-0.5)*0.05,
      vx: 0, vy: 0,
      seedX: Math.random()*1000,
      seedY: Math.random()*1000,
    });
  }

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

  const WANDER_RANGE = 0.4;
  const WANDER_SPEED = 0.00014;

  function stepPoints(dtMs, elapsedMs, introT){
    if(mouse.active && performance.now() - lastMoveTime > MOUSE_IDLE_MS) mouse.active = false;
    const dtScale = dtMs / 16.6667;
    const wanderRangeNow = WANDER_RANGE * introT;

    for(let i=0;i<points.length;i++){
      const p = points[i];
      const nx = noise2(p.seedX + elapsedMs*WANDER_SPEED, 0) * 2 - 1;
      const ny = noise2(p.seedY + elapsedMs*WANDER_SPEED, 100) * 2 - 1;
      const targetX = centerX + nx*wanderRangeNow;
      const targetY = centerY + ny*wanderRangeNow;

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

      p.vx += ax * (1 - CONFIG.viscosity) * dtScale;
      p.vy += ay * (1 - CONFIG.viscosity) * dtScale;
      p.vx *= CONFIG.damping;
      p.vy *= CONFIG.damping;

      p.x += p.vx * CONFIG.movementSpeed * dtScale;
      p.y += p.vy * CONFIG.movementSpeed * dtScale;
    }
  }

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
    let seed = 88;
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
    if(Math.abs(w - lastResizeW) <= 10) return;
    lastResizeW = w;
    clearTimeout(window.__papiProcessSlimeResizeT);
    window.__papiProcessSlimeResizeT = setTimeout(resize, 150);
  });

  let lastTs = null;
  let rafId = null;

  function renderOnce(elapsedMs, slimeSizeNow){
    uniforms.uTime.value = elapsedMs / 1000;
    for(let i=0;i<points.length;i++){
      const p = points[i];
      uniforms.uPoints.value[i].set(p.x, p.y, p.vx * CONFIG.movementSpeed, p.vy * CONFIG.movementSpeed);
    }
    uniforms.uSlimeSize.value = slimeSizeNow;
    renderer.render(scene, camera);
  }

  const RENDER_FPS = 60;
  const RENDER_INTERVAL = 1000 / RENDER_FPS;
  let lastRenderTs = 0;
  let elapsedAccum = 0;
  function smoothstep01(t){
    const c = Math.max(0, Math.min(1, t));
    return c*c*(3-2*c);
  }

  function loop(ts){
    if(ts - lastRenderTs < RENDER_INTERVAL){
      rafId = requestAnimationFrame(loop);
      return;
    }
    lastRenderTs = ts;
    canvasRect = canvas.getBoundingClientRect();

    const dt = lastTs === null ? 16.6667 : Math.min(ts - lastTs, CONFIG.maxDt);
    lastTs = ts;
    elapsedAccum += dt;
    const elapsed = elapsedAccum;

    const introT = smoothstep01(elapsed / CONFIG.introDurationMs);
    const slimeSizeNow = CONFIG.slimeSize * (CONFIG.introSizeBoost - (CONFIG.introSizeBoost - 1) * introT);

    stepPoints(dt, elapsed, introT);
    renderOnce(elapsed, slimeSizeNow);

    rafId = requestAnimationFrame(loop);
  }

  resize();

  if(prefersReducedMotion){
    stepPoints(16.6667, 0, 1);
    renderOnce(0, CONFIG.slimeSize);
  } else {
    // BUG FIX (per direct report: "something is making my phone hot
    // when I have this website open"): this render loop was running
    // at 60fps FOREVER, with no pause once the hero section scrolled
    // out of view or the browser tab itself was backgrounded — on a
    // long page like this one, a visitor scrolls past the hero almost
    // immediately, and the GPU kept rendering this canvas behind
    // whatever they were actually looking at for the rest of the
    // session, burning battery/heat for zero visual benefit. Pause the
    // loop whenever the canvas isn't actually on-screen or the tab
    // isn't actually visible, and resume the instant it is again.
    let isHeroVisible = true;
    function startLoop(){
      if(rafId !== null) return;
      lastTs = null; // avoids one giant dt spike counting the paused gap as elapsed time
      rafId = requestAnimationFrame(loop);
    }
    function stopLoop(){
      if(rafId !== null){ cancelAnimationFrame(rafId); rafId = null; }
    }
    function syncLoop(){
      if(isHeroVisible && !document.hidden) startLoop(); else stopLoop();
    }
    if('IntersectionObserver' in window){
      const io = new IntersectionObserver((entries)=>{
        isHeroVisible = entries[0].isIntersecting;
        syncLoop();
      }, { threshold: 0 });
      io.observe(canvas);
    }
    document.addEventListener('visibilitychange', syncLoop);
    startLoop();
  }
})();
