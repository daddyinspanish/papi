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

   Every tile is a real DOM element, not a pixel drawn on a shared
   <canvas>. That used to be a canvas: one clearRect + a fresh fillRect
   per tile, every frame, forever. On-device debug data proved the
   JS/rAF loop itself was never the problem (it kept ticking within a
   frame or two of on-time the whole time a freeze happened) — the
   freeze was iOS Safari deferring the canvas's own repaint/raster
   step for the length of a touch-scroll gesture, independent of
   whether the JS driving it was healthy. transform/opacity on a real
   element are pure compositor properties: the browser can update them
   by recompositing an already-rasterized layer, with no repaint step
   to defer, which is exactly why the CSS scroll-timeline pieces
   elsewhere on this page (the hero text fade, the cube's fade-in)
   never had this problem. Moving the tiles themselves onto that same
   footing is what actually closes the gap — background-color is the
   one property below that still triggers a per-tile repaint, but the
   color sweep moves so slowly (a 7+ second cycle) that deferring it
   for the length of a single gesture is not something anyone perceives.
=================================================================== */
(function(){
  const container = document.getElementById('fieldCanvas');
  if(!container) return;
  const root = document.documentElement;
  const heroEl = document.getElementById('hero');

  let W, H;
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
  // deliberately NOT "current progress + a per-frame increment" — see
  // the note above step() for why that shape is exactly what caused
  // the visible "restart" glitch, and why every piece of state in this
  // file is now computed fresh from elapsed real time instead.
  let sweepStart = null;
  const SWEEP_DURATION = 7200; // ms — slow, smooth wash
  const FEATHER = 0.2;        // width of the soft blend band
  const CYCLE_LEN = SWEEP_DURATION * (1 + FEATHER); // ms for one full sweep, including the feather overshoot before it resets

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

  // continuous orbit of the cluster around its centre, forever — also
  // computed fresh from elapsed time each frame (orbitPhase = elapsed *
  // ORBIT_SPEED), not accumulated frame to frame
  const ORBIT_SPEED = 0.00022; // radians/ms — noticeably faster than the old ~90s/turn drift

  // orbitPhase above is always correct — a pure function of elapsed
  // time, verified on-device to never jump to a wrong value even after
  // a real multi-hundred-ms Safari JS pause. But "correct" doesn't mean
  // "doesn't visibly teleport": each tile's home position is a direct
  // function of orbitPhase, and if JS was genuinely paused for 700ms,
  // there was simply no repaint at all for that whole stretch — the
  // last frame anyone saw is wherever the cluster was *before* the
  // pause, and the very next frame reflects the fully-caught-up, far
  // -advanced angle *after* it, with nothing shown in between. Handing
  // that big-but-correct jump straight to the tiles' spring physics
  // below gives every tile's home position a single huge one-frame
  // displacement, and the spring (tuned for the tiny per-frame deltas
  // of normal motion) responds with a visible kick/recoil — reading as
  // exactly the same "snap" the accumulator bug caused, just via a
  // different mechanism this time (a legitimately-moved target instead
  // of a wrongly-computed one).
  // orbitDisplay chases orbitPhase at a capped max rate instead of
  // jumping straight to it, so tile homes only ever move a small,
  // bounded amount per repaint — turning an arbitrarily long gap into a
  // brief, quick catch-up glide (a handful of frames, arriving in a
  // burst right as JS resumes) rather than an instant teleport. The
  // trade is that orbitDisplay briefly lags behind the "true" angle
  // after an unusually long gap instead of being perfectly exact the
  // instant JS resumes — the right trade for a decorative background
  // field, where a smooth catch-up reads as intentional and a snap
  // reads as broken.
  // the max step is deliberately NOT scaled by that frame's own measured
  // dt — sizing it off the very gap it's meant to cap would make the
  // cap grow right along with the jump it's supposed to be limiting
  // (a 700ms gap produces both a ~0.15rad true delta *and*, if scaled by
  // that same 700ms, a max step comfortably bigger than 0.15rad — never
  // actually capping anything). It's a fixed budget instead: at most
  // ORBIT_CATCHUP_MULT times what a single normal ~16.7ms frame would
  // have moved, no matter how long the real gap was.
  let orbitDisplay = null;
  const ORBIT_CATCHUP_MULT = 4; // display can move at most 4x a normal frame's worth of orbit per repaint

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
  // hoisted out of hslToRgb — it used to be redefined as a fresh
  // closure on every single call (up to 100+ times per frame, one per
  // tile, forever), which is its own small allocation on top of the array below
  function hue2rgb(p,q,t){
    if(t<0) t+=1;
    if(t>1) t-=1;
    if(t<1/6) return p+(q-p)*6*t;
    if(t<1/2) return q;
    if(t<2/3) return p+(q-p)*(2/3-t)*6;
    return p;
  }
  // reused across every call rather than allocating a fresh 3-element
  // array each time — both call sites immediately destructure the
  // result into plain numbers and never hold onto the array itself, so
  // sharing one mutable output is safe. With up to 100+ tiles updated
  // every frame forever, that's a continuous stream of small array
  // allocations removed — exactly the kind of steady garbage-collector
  // pressure that can surface as an occasional stall on a phone,
  // regardless of which specific moment it happens to land on.
  const rgbOut = [0,0,0];
  function hslToRgb(h,s,l){
    if(s===0){ rgbOut[0]=rgbOut[1]=rgbOut[2]=l*255; return rgbOut; }
    const q = l<0.5 ? l*(1+s) : l+s-l*s;
    const p = 2*l-q;
    rgbOut[0] = hue2rgb(p,q,h+1/3)*255;
    rgbOut[1] = hue2rgb(p,q,h)*255;
    rgbOut[2] = hue2rgb(p,q,h-1/3)*255;
    return rgbOut;
  }

  function resize(){
    W = container.offsetWidth;
    H = container.offsetHeight || window.innerHeight;
    buildGrid();
  }

  function buildGrid(){
    // carry over any tile already in motion (orbiting, mid-push, mid-
    // grow) by grid slot, including its actual DOM element — buildGrid
    // can fire more than once for reasons that have nothing to do with
    // a real layout change (fonts finishing load, the scrollbar
    // appearing/disappearing right as the loader hands off, a mobile
    // browser's address bar hiding on scroll). Resetting every tile
    // straight back to its static hx/hy each time made those innocuous
    // re-measures look like the orbit glitching or the cursor-push
    // pulsing; recreating every element from scratch each time would
    // also mean briefly having zero tiles on screen mid-rebuild.
    const oldByKey = new Map();
    for(let i=0;i<tiles.length;i++){
      oldByKey.set(tiles[i].key, tiles[i]);
    }
    const usedKeys = new Set();
    tiles = [];
    // bigger (so fewer) tiles on narrow screens — was 58, cutting the
    // per-frame tile count by roughly a third on a typical phone width
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
        usedKeys.add(key);
        const gap = old ? old.gap : 2 + Math.random()*2;
        // the tile's own box is sized once here, in real CSS pixels —
        // never touched again after this. The per-frame reveal/breathe
        // grow-shrink below is a transform:scale() around that fixed
        // box, not a width/height change, which is what keeps every
        // per-frame update to pure compositor properties
        const size = cell - gap;
        let el = old ? old.el : document.createElement('div');
        if(!old){
          el.className = 'field-tile';
          container.appendChild(el);
        }
        el.style.width = `${size}px`;
        el.style.height = `${size}px`;
        tiles.push({
          key,
          hx, hy,
          x: old ? old.x : hx,
          y: old ? old.y : hy,
          vx: old ? old.vx : 0,
          vy: old ? old.vy : 0,
          ny: H ? hy / H : 0,
          gap, size,
          dist: Math.sqrt(dx*dx + dy*dy) / maxDist,
          angle0: Math.atan2(dy, dx),
          radius: Math.sqrt(dx*dx + dy*dy),
          el,
        });
      }
    }
    // drop any element left over from a shrunk grid (rare — only
    // happens on a big enough resize to change row/col counts)
    oldByKey.forEach((oldTile, key)=>{
      if(!usedKeys.has(key) && oldTile.el && oldTile.el.parentNode){
        oldTile.el.parentNode.removeChild(oldTile.el);
      }
    });
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

  // tiles are positioned in container-local coordinates (0,0 at the
  // container's own top-left), but mouse/touch events report viewport-
  // relative coordinates — those only happen to match at the very top
  // of the page with zero scroll. The moment the hero has scrolled at
  // all, the container's viewport position shifts up while tile
  // positions don't, so without this conversion the push effect drifts
  // out of sync with the cursor by however far the page has scrolled —
  // tiles lower on the field need the cursor further down than the
  // viewport even allows, reading as "hovering near the bottom does nothing."
  function toLocalXY(clientX, clientY){
    const rect = container.getBoundingClientRect();
    return [clientX - rect.left, clientY - rect.top];
  }

  window.addEventListener('mousemove', (e)=>{
    const [x,y] = toLocalXY(e.clientX, e.clientY);
    mouse.x = x;
    mouse.y = y;
    mouse.active = true;
    lastMoveTime = performance.now();
  });
  window.addEventListener('mouseleave', ()=>{ mouse.active = false; });
  window.addEventListener('touchmove', (e)=>{
    if(e.touches && e.touches[0]){
      const [x,y] = toLocalXY(e.touches[0].clientX, e.touches[0].clientY);
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

  // ---------------------------------------------------------------
  // Every piece of ongoing state below (the sweep, its color index
  // and direction, the orbit angle) used to be a per-frame accumulator
  // — advanced by "elapsed since last frame * rate" and carried
  // forward frame to frame. That's fine as long as frames keep
  // arriving roughly every 16ms, but iOS Safari deliberately pauses
  // JS (rAF included) for as long as a finger is actively dragging the
  // screen, then delivers one frame with however much real time
  // actually elapsed since the last one — sometimes several hundred
  // milliseconds. Fed into "elapsed * rate" that's a single-frame
  // jump to a wildly different value: the orbit snapping to a new
  // angle, the sweep jumping partway through a cycle, all in one
  // frame. That's the "restart" — not the animation actually
  // restarting, but a discontinuity landing exactly when Safari's
  // paused JS catches up.
  //
  // Every one of these is now instead computed fresh each frame
  // directly from *how much real time has passed since a fixed start
  // point* (matching the pattern the breathing cycle already used
  // correctly). There is no accumulator left to jump — a long gap
  // between frames just means the next frame computes the exact
  // angle/progress that real elapsed time says it should be, and
  // applies it directly. Whatever the gap was, the motion itself is
  // still just a continuous, ordinary function of time; it never
  // stops being that function, it just isn't sampled as often for
  // that one gap.
  function step(ts){
    let heroVisible = true;
    if(heroEl){
      const r = heroEl.getBoundingClientRect();
      heroVisible = r.bottom > 0 && r.top < window.innerHeight;
    }

    // release the cursor effect once the pointer has sat still a while
    if(mouse.active && ts - lastMoveTime > IDLE_MS) mouse.active = false;
    const pushActive = mouse.active && heroVisible;

    // the sweep: a full cycle (0 -> 1+FEATHER, then reset) takes
    // CYCLE_LEN ms. cycleCount is how many full cycles have completed
    // since sweepStart; sweepProgress is just how far into the
    // *current* cycle elapsed time now sits.
    if(sweepStart === null) sweepStart = ts;
    const sweepElapsed = ts - sweepStart;
    const cycleFloat = sweepElapsed / CYCLE_LEN;
    const cycleCount = Math.floor(cycleFloat);
    const sweepProgress = (cycleFloat - cycleCount) * (1 + FEATHER);
    const colorIndex = cycleCount % palette().length;
    const direction = (cycleCount % 2 === 0) ? 1 : -1;

    // advance the intro reveal — a wide centre cluster that orbits and
    // breathes in size forever: expanding outward, then reversing back
    // into the tighter orbit, on a continuous loop
    let introProgress = 1;
    let orbitPhase = 0;
    if(introPhase === 'held'){
      const heldElapsed = ts - heldStart;
      orbitPhase = heldElapsed * ORBIT_SPEED;
      const cyclePos = (heldElapsed % BREATHE_PERIOD) / BREATHE_PERIOD; // 0..1
      const tri = cyclePos < 0.5 ? cyclePos * 2 : (1 - cyclePos) * 2; // 0 -> 1 -> 0
      const eased = smoothstep(0, 1, tri); // soften the triangle's corners
      introProgress = lerp(HELD_REVEAL, EXPANDED_REVEAL, eased);
    }

    // orbitDisplay chases the always-correct orbitPhase at a capped max
    // rate (see the note above ORBIT_CATCHUP_MULT) — this is what the
    // tiles' home positions actually use below, so an unusually long
    // gap resolves as a brief catch-up glide instead of every tile
    // teleporting to its new home in one frame. Fixed budget per call,
    // not scaled by this frame's own dt — see the note above.
    if(orbitDisplay === null) orbitDisplay = orbitPhase;
    const orbitMaxStep = ORBIT_SPEED * 16.6667 * ORBIT_CATCHUP_MULT;
    const orbitRawDelta = orbitPhase - orbitDisplay;
    orbitDisplay += Math.max(-orbitMaxStep, Math.min(orbitMaxStep, orbitRawDelta));

    // no-op unless ?debug=1 was used to turn on js/debug-hud.js — flags
    // any frame gap long enough to be a real Safari JS pause (not
    // ordinary jitter) and records what these values were right when it
    // happened, so a gap that shows up on a real iPhone leaves hard
    // numbers behind instead of just "it froze again"
    window.PapiDebug.log('particles', { ts, sweepProgress, orbitPhase, orbitDisplay, introProgress });

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
        const homeX = orbiting ? centerX + t.radius * Math.cos(t.angle0 + orbitDisplay) - cell/2 : t.hx;
        const homeY = orbiting ? centerY + t.radius * Math.sin(t.angle0 + orbitDisplay) - cell/2 : t.hy;

        t.vx += (homeX - t.x) * SPRING;
        t.vy += (homeY - t.y) * SPRING;
        t.vx *= DAMPING;
        t.vy *= DAMPING;
        t.x += t.vx;
        t.y += t.vy;

        let reveal = 1;
        if(introPhase === 'held'){
          reveal = smoothstep(t.dist - INTRO_FEATHER, t.dist + INTRO_FEATHER, introProgress);
        }

        // position and scale/opacity are transform/opacity only — pure
        // compositor properties, applied every frame regardless of
        // reveal (unlike the old canvas version, skipping a hidden
        // tile's draw call isn't saving any real paint work here, since
        // there's no shared bitmap to redraw). t.el's own box is a
        // fixed size set once in buildGrid, so translate3d(t.x, t.y, 0)
        // alone (no extra centering math) lands it exactly where the
        // old ccx/ccy-centered fillRect used to draw, because scale()
        // pivots around transform-origin:center by default rather than
        // moving the box's top-left.
        const scale = 0.35 + 0.65 * reveal;
        t.el.style.transform = `translate3d(${t.x.toFixed(1)}px, ${t.y.toFixed(1)}px, 0) scale(${scale.toFixed(3)})`;
        t.el.style.opacity = reveal.toFixed(3);

        // checked before any of the sweep/hue/rgb math below — most
        // tiles in the grid sit outside the visible cluster at any
        // given moment (introPhase is 'held' forever now; the cluster
        // never grows to fill the whole screen), so there's no reason
        // to pay for a full color computation only to paint it fully
        // transparent. background-color is the one property here that
        // still triggers a real per-tile repaint (unlike the transform/
        // opacity above), so skipping it when nothing will show is
        // worth it both for the color math and for that paint cost.
        if(reveal <= 0.001) continue;

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

        t.el.style.backgroundColor = `rgb(${r|0},${g|0},${b|0})`;
      }
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
