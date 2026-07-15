/* ===================================================================
   Papi — solid color-sweep pixel field
   Tiles sit in a fixed grid, always visible. The whole grid shares
   one dominant color at a time. A soft band sweeps from bottom to
   middle to top (then reverses), blending in HSL space so
   transitions stay vivid (no muddy grey mid-point).

   The cursor is a gravity-free "parting" force: tiles near it push
   apart a little, then spring back home once it moves on. Nothing
   sticks — the moment the cursor leaves, stops covering a tile, sits
   still too long (idle), or the hero scrolls out of view, the effect
   releases and tiles ease straight back to rest.

   On first reveal (window.Papi.revealField, called from loader.js),
   the field shows a "world of cubes" cluster around the title that
   orbits its centre continuously, breathing in size as it goes —
   expanding outward, then reversing back into the tighter orbit,
   forever. This used to instead do a one-shot grow-to-fill-the-
   screen triggered by the visitor scrolling, gated behind a scroll
   lock so the page couldn't move until it finished — that read as a
   freeze/stutter right when scrolling from the hero into the next
   section, and it meant the animation only ever played once. The
   breathing loop is fully self-contained and independent of scroll,
   so there's nothing left to gate scrolling on.
=================================================================== */
(function(){
  const canvas = document.getElementById('fieldCanvas');
  if(!canvas) return;
  const ctx = canvas.getContext('2d');
  const root = document.documentElement;
  const heroEl = document.getElementById('hero');

  let W, H, DPR;
  let cell = 90;
  let tiles = [];
  let cols = 0, rows = 0;
  let maxDist = 1;
  let centerX = 0, centerY = 0;

  const mouse = { x:-9999, y:-9999, active:false };
  let lastMoveTime = 0;
  const IDLE_MS = 1400; // cursor effect releases if the pointer sits still this long

  function palette(){
    return (window.Papi && window.Papi.palette) || [[201,168,105],[168,54,68]];
  }

  // --- color sweep state ---
  let colorIndex = 0;
  let direction = 1;          // 1 = sweeps bottom -> top, -1 = top -> bottom
  let sweepProgress = 0;      // 0..1 (+feather) across the current sweep
  const SWEEP_DURATION = 7200; // ms — slow, smooth wash
  const FEATHER = 0.2;        // width of the soft blend band
  let lastTime = null;

  // --- intro reveal state:
  //   pending -> hidden, before the loader hands off
  //   held    -> the "world of cubes" cluster, shown forever from here
  //              on — continuously orbiting and breathing in size
  let introPhase = 'pending';
  let heldStart = null;
  const INTRO_FEATHER = 0.2;
  const HELD_REVEAL = 0.24;     // tightest point of the breathing cluster
  const EXPANDED_REVEAL = 0.5;  // widest point — how far out it expands
  const BREATHE_PERIOD = 4200;  // ms for one full expand-then-reverse cycle

  // the very first color the field shows eases up from a soft, pale
  // tint rather than snapping straight to the fully saturated/bright
  // color the instant the field appears — appearing already at full
  // brightness with no ramp read as a glitch/pop rather than an
  // intentional reveal. Starts ticking the moment the field is first
  // shown (revealField), independent of scroll.
  let colorWarmupStart = null;
  // was 1800ms — long enough that the field was still visibly pale/
  // dim while the hero title was fading in over it at the same time,
  // making the title harder to read right when it mattered most
  // (especially noticeable on iPhone). Still enough of a ramp to avoid
  // the flat "pop to full brightness" look, just resolved much faster.
  const COLOR_WARMUP_DURATION = 650;

  // continuous orbit of the cluster around its centre, forever
  let orbitPhase = 0;
  const ORBIT_SPEED = 0.00022; // radians/ms — noticeably faster than the old ~90s/turn drift

  function smoothstep(edge0, edge1, x){
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  }
  function lerp(a,b,t){ return a + (b-a)*t; }
  function lerpHue(h1,h2,t){
    let d = h2 - h1;
    if(d > 0.5) d -= 1;
    if(d < -0.5) d += 1;
    let h = h1 + d*t;
    if(h < 0) h += 1;
    if(h > 1) h -= 1;
    return h;
  }

  // --- rgb <-> hsl — colors are mixed in HSL so transitions stay vivid
  // instead of passing through a muddy grey midpoint like raw RGB lerp does
  function rgbToHsl(r,g,b){
    r/=255; g/=255; b/=255;
    const max=Math.max(r,g,b), min=Math.min(r,g,b);
    let h,s; const l=(max+min)/2;
    if(max===min){ h=s=0; }
    else{
      const d = max-min;
      s = l>0.5 ? d/(2-max-min) : d/(max+min);
      switch(max){
        case r: h=(g-b)/d+(g<b?6:0); break;
        case g: h=(b-r)/d+2; break;
        default: h=(r-g)/d+4;
      }
      h/=6;
    }
    return [h,s,l];
  }
  function hslToRgb(h,s,l){
    if(s===0) return [l*255,l*255,l*255];
    const hue2rgb=(p,q,t)=>{
      if(t<0) t+=1;
      if(t>1) t-=1;
      if(t<1/6) return p+(q-p)*6*t;
      if(t<1/2) return q;
      if(t<2/3) return p+(q-p)*(2/3-t)*6;
      return p;
    };
    const q = l<0.5 ? l*(1+s) : l+s-l*s;
    const p = 2*l-q;
    return [
      hue2rgb(p,q,h+1/3)*255,
      hue2rgb(p,q,h)*255,
      hue2rgb(p,q,h-1/3)*255,
    ];
  }

  function resize(){
    W = canvas.offsetWidth;
    // capped lower on narrow/phone-width screens — this canvas redraws
    // every tile every frame forever (the orbit/breathe loop never
    // idles down), and a Retina phone's devicePixelRatio (often 3)
    // means clearRect/fillRect are working over roughly 2x the pixel
    // area a capped-at-2 DPR already implies, purely for a soft,
    // blurred-looking background field that doesn't need that
    // sharpness — that extra cost is what was showing up as the
    // animation stalling/stuttering ("freezing") specifically on
    // iPhone as soon as scrolling (and everything else competing for
    // the main thread with it) started.
    DPR = Math.min(window.devicePixelRatio || 1, W < 640 ? 1 : 2);
    H = canvas.offsetHeight || window.innerHeight;
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    ctx.setTransform(DPR,0,0,DPR,0,0);
    buildGrid();
  }

  function buildGrid(){
    // carry over any tile already in motion (orbiting, mid-push, mid-
    // grow) by grid slot — buildGrid can fire more than once for
    // reasons that have nothing to do with a real layout change
    // (fonts finishing load, the scrollbar appearing/disappearing
    // right as the loader hands off, a mobile browser's address bar
    // hiding on scroll). Resetting every tile straight back to its
    // static hx/hy each time made those innocuous re-measures look
    // like the orbit glitching or the cursor-push pulsing.
    const oldByKey = new Map();
    for(let i=0;i<tiles.length;i++){
      oldByKey.set(tiles[i].key, tiles[i]);
    }
    tiles = [];
    // bigger (so fewer) tiles on narrow screens — was 58, cutting the
    // per-frame tile count by roughly a third on a typical phone width,
    // on top of the DPR cap above, to reduce this canvas's per-frame
    // cost specifically where it was freezing/stuttering
    cell = W < 640 ? 76 : (W < 1100 ? 76 : 96);
    cols = Math.ceil(W / cell) + 1;
    rows = Math.ceil(H / cell) + 1;
    centerX = W / 2;
    centerY = H / 2;
    maxDist = Math.sqrt(centerX*centerX + centerY*centerY) || 1;
    for(let r=0;r<rows;r++){
      for(let c=0;c<cols;c++){
        const hx = c*cell;
        const hy = r*cell;
        const dx = (hx + cell/2) - centerX;
        const dy = (hy + cell/2) - centerY;
        const key = r + '_' + c;
        const old = oldByKey.get(key);
        tiles.push({
          key,
          hx, hy,
          x: old ? old.x : hx,
          y: old ? old.y : hy,
          vx: old ? old.vx : 0,
          vy: old ? old.vy : 0,
          ny: H ? hy / H : 0,
          gap: old ? old.gap : 2 + Math.random()*2,
          dist: Math.sqrt(dx*dx + dy*dy) / maxDist,
          angle0: Math.atan2(dy, dx),
          radius: Math.sqrt(dx*dx + dy*dy),
        });
      }
    }
  }

  // ignore resize events that only changed height — a mobile browser
  // showing/hiding its address bar on scroll fires these constantly,
  // and buildGrid (even preserved) is needless work for a non-change
  let lastResizeW = window.innerWidth;
  window.addEventListener('resize', ()=>{
    const w = window.innerWidth;
    if(w === lastResizeW) return;
    lastResizeW = w;
    clearTimeout(window.__papiResizeT);
    window.__papiResizeT = setTimeout(resize, 150);
  });
  window.addEventListener('load', resize);
  if(document.fonts && document.fonts.ready) document.fonts.ready.then(resize);

  // tiles are positioned in canvas-local coordinates (0,0 at the
  // canvas's own top-left), but mouse/touch events report viewport-
  // relative coordinates — those only happen to match at the very top
  // of the page with zero scroll. The moment the hero has scrolled at
  // all, the canvas's viewport position shifts up while tile positions
  // don't, so without this conversion the push effect drifts out of
  // sync with the cursor by however far the page has scrolled — tiles
  // lower on the field need the cursor further down than the viewport
  // even allows, reading as "hovering near the bottom does nothing."
  function toCanvasXY(clientX, clientY){
    const rect = canvas.getBoundingClientRect();
    return [clientX - rect.left, clientY - rect.top];
  }

  window.addEventListener('mousemove', (e)=>{
    const [x,y] = toCanvasXY(e.clientX, e.clientY);
    mouse.x = x;
    mouse.y = y;
    mouse.active = true;
    lastMoveTime = performance.now();
  });
  window.addEventListener('mouseleave', ()=>{ mouse.active = false; });
  window.addEventListener('touchmove', (e)=>{
    if(e.touches && e.touches[0]){
      const [x,y] = toCanvasXY(e.touches[0].clientX, e.touches[0].clientY);
      mouse.x = x;
      mouse.y = y;
      mouse.active = true;
      lastMoveTime = performance.now();
    }
  }, { passive:true });

  // cursor "parting" force — a tight, noticeable reaction without
  // affecting a huge area of the field
  const RADIUS = 190;
  const PUSH = 0.28;
  const SPRING = 0.03;
  const DAMPING = .88;

  function step(ts){
    if(lastTime === null) lastTime = ts;
    const dt = ts - lastTime;
    lastTime = ts;

    let heroVisible = true;
    if(heroEl){
      const r = heroEl.getBoundingClientRect();
      heroVisible = r.bottom > 0 && r.top < window.innerHeight;
    }
    // used to skip the whole redraw once the hero scrolled fully out of
    // view, to stop it competing for frame time with whatever the next
    // section was animating. On iPhone specifically that pause-then-
    // resume was itself visible right at the edge of the hero's visible
    // range (innerHeight shifting slightly as Safari's address bar
    // collapses mid-scroll flips heroVisible back and forth), reading
    // as the orbit stalling and restarting rather than running
    // continuously. Letting it just run all the time avoids that
    // entirely — simpler and never has a pause/resume seam to begin with.

    // release the cursor effect once the pointer has sat still a while
    if(mouse.active && ts - lastMoveTime > IDLE_MS) mouse.active = false;
    const pushActive = mouse.active && heroVisible;

    // advance the sweep
    sweepProgress += dt / SWEEP_DURATION;
    if(sweepProgress > 1 + FEATHER){
      sweepProgress = 0;
      colorIndex = (colorIndex + 1) % palette().length;
      direction *= -1;
    }

    // advance the intro reveal — a wide centre cluster that orbits and
    // breathes in size forever: expanding outward, then reversing back
    // into the tighter orbit, on a continuous loop
    let introProgress = 1;
    if(introPhase === 'held'){
      orbitPhase += dt * ORBIT_SPEED;
      const cyclePos = ((ts - heldStart) % BREATHE_PERIOD) / BREATHE_PERIOD; // 0..1
      const tri = cyclePos < 0.5 ? cyclePos * 2 : (1 - cyclePos) * 2; // 0 -> 1 -> 0
      const eased = smoothstep(0, 1, tri); // soften the triangle's corners
      introProgress = lerp(HELD_REVEAL, EXPANDED_REVEAL, eased);
    }

    // 0 right as the field first appears, easing to 1 over
    // COLOR_WARMUP_DURATION — blended in below toward a paler, softer
    // tint at 0 so the very first color the visitor sees isn't already
    // at full saturation/brightness
    let colorWarmup = 1;
    if(colorWarmupStart !== null){
      const wraw = Math.min(1, (ts - colorWarmupStart) / COLOR_WARMUP_DURATION);
      colorWarmup = wraw < 0.5 ? 2*wraw*wraw : 1 - Math.pow(-2*wraw+2, 2)/2;
    }

    const pal = palette();
    const curColor = pal[colorIndex];
    const nextColor = pal[(colorIndex + 1) % pal.length];
    const [h0,s0,l0] = rgbToHsl(curColor[0], curColor[1], curColor[2]);
    const [h1,s1,l1] = rgbToHsl(nextColor[0], nextColor[1], nextColor[2]);

    ctx.clearRect(0,0,W,H);

    if(introPhase !== 'pending'){
      const orbiting = introPhase === 'held';
      for(let i=0;i<tiles.length;i++){
        const t = tiles[i];

        if(pushActive){
          const dx = t.x - mouse.x;
          const dy = t.y - mouse.y;
          const dist = Math.sqrt(dx*dx + dy*dy) + 0.01;
          if(dist < RADIUS){
            const force = (1 - dist/RADIUS) * PUSH;
            const ang = Math.atan2(dy, dx);
            t.vx += Math.cos(ang)*force;
            t.vy += Math.sin(ang)*force;
          }
        }

        // the whole cluster orbits its centre forever — orbit target is
        // expressed around the tile's cell-centre (to keep the circular
        // path true), then shifted back to the same top-left convention
        // as the static hx/hy grid slot — otherwise the very first
        // orbiting frame lands half a cell away from where the tile
        // actually is and the whole cluster bounces
        const homeX = orbiting ? centerX + t.radius * Math.cos(t.angle0 + orbitPhase) - cell/2 : t.hx;
        const homeY = orbiting ? centerY + t.radius * Math.sin(t.angle0 + orbitPhase) - cell/2 : t.hy;

        t.vx += (homeX - t.x) * SPRING;
        t.vy += (homeY - t.y) * SPRING;
        t.vx *= DAMPING;
        t.vy *= DAMPING;
        t.x += t.vx;
        t.y += t.vy;

        // where this tile sits along the current sweep direction
        const thresh = direction === 1 ? (1 - t.ny) : t.ny;
        const mix = smoothstep(thresh - FEATHER, thresh + FEATHER, sweepProgress);
        const hh = lerpHue(h0, h1, mix);
        const ss = lerp(s0, s1, mix);
        const ll = lerp(l0, l1, mix);
        // ease in from a paler, less saturated version of this same
        // hue rather than the fully-saturated color — see colorWarmup
        const ss2 = colorWarmup >= 1 ? ss : lerp(ss * 0.3, ss, colorWarmup);
        const ll2 = colorWarmup >= 1 ? ll : lerp(Math.min(1, ll + (1 - ll) * 0.6), ll, colorWarmup);
        const [r,g,b] = hslToRgb(hh, ss2, ll2);

        let reveal = 1;
        if(introPhase === 'held'){
          reveal = smoothstep(t.dist - INTRO_FEATHER, t.dist + INTRO_FEATHER, introProgress);
          if(reveal <= 0.001) continue;
        }

        const scale = 0.35 + 0.65 * reveal;
        const size = (cell - t.gap) * scale;
        const ccx = t.x + (cell - t.gap) / 2;
        const ccy = t.y + (cell - t.gap) / 2;

        ctx.globalAlpha = reveal;
        ctx.fillStyle = `rgb(${r|0},${g|0},${b|0})`;
        ctx.fillRect(ccx - size/2, ccy - size/2, size, size);
      }
      ctx.globalAlpha = 1;
    }

    // whatever color the vertical middle currently shows becomes the
    // page's shared accent (headline gradient, cta hover, cursor glow)
    const midMix = smoothstep(0.5 - FEATHER, 0.5 + FEATHER, sweepProgress);
    const midHue = lerpHue(h0, h1, midMix);
    const midSat = lerp(s0, s1, midMix);
    const midLight = lerp(l0, l1, midMix);
    // same warmup ease applied to the shared accent, so the CTA/cursor
    // glow that reads off it don't pop to full strength ahead of the
    // field itself still easing in
    const midSat2 = colorWarmup >= 1 ? midSat : lerp(midSat * 0.3, midSat, colorWarmup);
    const midLight2 = colorWarmup >= 1 ? midLight : lerp(Math.min(1, midLight + (1 - midLight) * 0.6), midLight, colorWarmup);
    const [ar,ag,ab] = hslToRgb(midHue, midSat2, midLight2);
    root.style.setProperty('--accent', `${ar|0}, ${ag|0}, ${ab|0}`);

    // "style" and other UI accents always contrast the current
    // background — staying strictly within the black/gold brand
    // instead of rotating to a complementary hue (which, with a
    // gold-only field, meant this used to drift to an off-brand blue).
    // Near-black when the field is bright/gold, bright gold-cream when
    // the field is dark. Blended smoothly by midLight itself (not a
    // hard snap at the 0.5 threshold) — a hard cutover meant the color
    // could flip instantly to its opposite between one frame and the
    // next, which read as an abrupt jump no CSS transition could catch
    // since a brand-new value lands every frame regardless.
    const contrastT = smoothstep(0.42, 0.58, midLight);
    const cr = lerp(232, 20, contrastT);
    const cg = lerp(205, 16, contrastT);
    const cb = lerp(120, 8, contrastT);
    root.style.setProperty('--style-contrast', `${cr|0}, ${cg|0}, ${cb|0}`);

    // a softer tint of the live accent, blended toward cream — used for
    // small supporting text (the eyebrow) that needs color but not
    // full-strength contrast
    const cream = [243,237,226];
    const tr = lerp(ar, cream[0], 0.45);
    const tg = lerp(ag, cream[1], 0.45);
    const tb = lerp(ab, cream[2], 0.45);
    root.style.setProperty('--accent-tint', `${tr|0}, ${tg|0}, ${tb|0}`);

    requestAnimationFrame(step);
  }

  resize();
  requestAnimationFrame(step);

  window.Papi = window.Papi || {};
  window.Papi.resizeField = resize;

  // shows the orbiting, breathing "world of cubes" cluster — called
  // once the loader hands off. Runs forever from here; nothing else
  // ever changes introPhase again.
  window.Papi.revealField = function(){
    if(introPhase !== 'pending') return;
    introPhase = 'held';
    heldStart = performance.now();
    colorWarmupStart = performance.now();
  };
})();
