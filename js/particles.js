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
   the field holds still as a wide "world of cubes" cluster around
   the title, gently orbiting its centre — until the visitor starts
   scrolling and the subtitle appears (window.Papi.growField, called
   from title-dock.js), at which point the same cluster continues
   growing outward from exactly the reveal amount it already had (no
   restart, no fade-to-black) until it fills the whole screen. A
   'papi:fieldgrown' event fires on window once it's done.
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
  //   held    -> wide centre cluster shown, holds still
  //   active  -> growing outward from centre
  //   done    -> always fully shown
  let introPhase = 'pending';
  let introStart = null;
  const INTRO_DURATION = 2100; // slow but not draggy
  const INTRO_FEATHER = 0.2;
  const HELD_REVEAL = 0.24; // a wide "world of cubes" cluster while held

  // slow continuous orbit of the held cluster around its centre —
  // only while held; once growth starts the tiles settle to their
  // true static grid spot so a full screen of tiles never has to orbit
  let orbitPhase = 0;
  const ORBIT_SPEED = 0.00007; // radians/ms — one turn roughly every 90s

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
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.offsetWidth;
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
    cell = W < 640 ? 58 : (W < 1100 ? 76 : 96);
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

  window.addEventListener('mousemove', (e)=>{
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.active = true;
    lastMoveTime = performance.now();
  });
  window.addEventListener('mouseleave', ()=>{ mouse.active = false; });
  window.addEventListener('touchmove', (e)=>{
    if(e.touches && e.touches[0]){
      mouse.x = e.touches[0].clientX;
      mouse.y = e.touches[0].clientY;
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

    // release the cursor effect once the pointer has sat still a
    // while, or once the hero has scrolled out of view entirely
    if(mouse.active && ts - lastMoveTime > IDLE_MS) mouse.active = false;
    let heroVisible = true;
    if(heroEl){
      const r = heroEl.getBoundingClientRect();
      heroVisible = r.bottom > 0 && r.top < window.innerHeight;
    }
    const pushActive = mouse.active && heroVisible;

    // advance the sweep
    sweepProgress += dt / SWEEP_DURATION;
    if(sweepProgress > 1 + FEATHER){
      sweepProgress = 0;
      colorIndex = (colorIndex + 1) % palette().length;
      direction *= -1;
    }

    // advance the intro reveal (wide centre cluster growing outward)
    let introProgress = 1;
    if(introPhase === 'held'){
      introProgress = HELD_REVEAL;
      orbitPhase += dt * ORBIT_SPEED;
    } else if(introPhase === 'active'){
      const raw = Math.min(1, (ts - introStart) / INTRO_DURATION);
      const eased = raw < 0.5 ? 2*raw*raw : 1 - Math.pow(-2*raw+2, 2)/2; // ease-in-out, fluid
      // continue smoothly from exactly the reveal amount held already
      // showed — never restart from 0, or the cluster would visibly
      // fade to black and rebuild from the centre
      //
      // target 1 + INTRO_FEATHER, not 1 — reveal is a smoothstep band
      // (dist - FEATHER .. dist + FEATHER), and the farthest tiles sit
      // at dist ~= 1 (normalized against the diagonal corner distance).
      // Stopping at exactly 1 left every tile past dist ~0.8 still
      // mid-fade when the phase flipped to 'done' and reveal got
      // hard-set to 1 — a visible pop on wide desktop screens, where
      // whole edges of tiles sit above that 0.8 line (barely any do on
      // a narrow, tall phone screen, which is why it was desktop-only)
      introProgress = lerp(HELD_REVEAL, 1 + INTRO_FEATHER, eased);
      if(raw >= 1){
        introPhase = 'done';
        window.dispatchEvent(new Event('papi:fieldgrown'));
      }
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

        // while held, the whole cluster slowly orbits its centre; once
        // growth starts it settles smoothly to its true static spot
        // orbit target is expressed around the tile's cell-centre (to
        // keep the circular path true), then shifted back to the same
        // top-left convention as the static hx/hy grid slot — otherwise
        // the very first orbiting frame lands half a cell away from
        // where the tile actually is and the whole cluster bounces
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
        const [r,g,b] = hslToRgb(hh, ss, ll);

        let reveal = 1;
        if(introPhase === 'active' || introPhase === 'held'){
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
    const [ar,ag,ab] = hslToRgb(midHue, midSat, midLight);
    root.style.setProperty('--accent', `${ar|0}, ${ag|0}, ${ab|0}`);

    // "style" and other UI accents always contrast the current
    // background: complementary hue, pushed light or dark depending on
    // the background's own lightness so it's never a dull, low-contrast
    // mid-tone (that dark-grey dead zone)
    const contrastHue = (midHue + 0.5) % 1;
    const contrastLight = midLight > 0.55 ? 0.24 : 0.76;
    const [cr,cg,cb] = hslToRgb(contrastHue, Math.max(0.55, midSat), contrastLight);
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

  // if the visitor somehow starts scrolling (browser scroll-position
  // restore on reload, an iOS quirk, anything) before the loader has
  // handed off, growField() below can get called while introPhase is
  // still 'pending' — remember that request instead of dropping it, so
  // revealField() can act on it once the field is actually ready. Not
  // remembering it was the bug: the fill would silently never run, and
  // the visitor would just land straight in the next section.
  let pendingGrow = false;
  function startGrow(){
    introStart = performance.now();
    introPhase = 'active';
  }

  // shows the wide still centre cluster and holds — called once the
  // loader hands off
  window.Papi.revealField = function(){
    if(introPhase !== 'pending') return;
    introPhase = 'held';
    if(pendingGrow) startGrow();
  };
  // starts the outward grow — called once the visitor begins scrolling
  window.Papi.growField = function(){
    if(introPhase === 'held') startGrow();
    else if(introPhase === 'pending') pendingGrow = true;
  };
  window.Papi.isFieldGrown = function(){ return introPhase === 'done'; };
})();
