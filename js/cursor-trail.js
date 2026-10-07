/* ===================================================================
   Papi — sitewide cursor/touch matrix trail
   Per direct request: extend the hero's own falling-number look
   (js/hero-matrix.js) to the cursor itself, everywhere on the site —
   a trail of small digits drops away behind the pointer as it moves,
   fading out, for a bit more of a premium/alive feel outside the hero.

   Per a later direct request ("make sure the cursor effects are also
   on mobile... the numbers also come under the cursor"), this now runs
   on touch too — the only device-only gate left is prefers-reduced-
   motion. Pointer events already unify mouse/pen/touch, so switching
   the spawn listener from 'mousemove' to 'pointermove' covers a
   dragging finger for free, with no separate touch code path.

   A single full-viewport canvas, pointer-events:none, sitting just
   under .custom-cursor's own z-index:2000 (see css/style.css) so the
   real cursor dot/ring always render on top of its own trail (touch
   has no such dot/ring, so this is simply invisible-but-harmless
   there).

   Deliberately spawn-throttled by distance moved (not one per
   pointermove — that can fire far more often than needed for a
   readable trail) and capped at a fixed max live-particle count, so a
   visitor waving the mouse/dragging a finger around can't ever push
   this past a bounded, known cost.

   BUG FIX: per report, "something is causing my phone to turn really
   hot" — right before this file was extended to mobile, it was found
   running its render loop, uncapped, every single real display frame
   (up to 120Hz), for the ENTIRE PAGE LIFETIME regardless of whether
   there was anything to draw — unlike js/hero-matrix.js's own canvas
   (which pauses via IntersectionObserver once scrolled out of view),
   this one is sitewide by design, so it had no "off-screen" moment to
   pause on. Two changes fix that: an FPS cap (matching hero-matrix's
   own mobile/desktop split), and — the bigger win — the loop now stops
   itself completely the instant the last particle finishes fading, and
   only restarts on the next actual spawn. In practice the vast
   majority of a session has zero live particles (between moves/
   touches), so this removes nearly all of its standing cost instead of
   just capping it.
=================================================================== */
(function(){
  const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(prefersReducedMotion) return;

  const isCoarsePointer = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

  const CHARS = '0123456789';
  const SPAWN_MIN_DIST = 22; // px of pointer travel between new digits
  const MAX_PARTICLES = isCoarsePointer ? 45 : 70;
  const LIFE_MS = 950;
  const FONT_SIZE = 13;
  const RENDER_INTERVAL = 1000 / (isCoarsePointer ? 24 : 30);

  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:1980;pointer-events:none;';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if(!ctx) return;

  let W = 0, H = 0, DPR = 1;

  // each digit is rendered ONCE into a tiny sprite; frames then just
  // drawImage() it with globalAlpha. This replaces fillText + a freshly
  // built color string per particle per frame, which re-rasterized glyphs
  // every frame (it was the single biggest named cost in the profile).
  const SPRITE_W = 12, SPRITE_H = 18;
  let sprites = [];
  function buildSprites(){
    sprites = [];
    for(let i = 0; i < CHARS.length; i++){
      const c = document.createElement('canvas');
      c.width = Math.ceil(SPRITE_W * DPR); c.height = Math.ceil(SPRITE_H * DPR);
      const g = c.getContext('2d');
      g.setTransform(DPR, 0, 0, DPR, 0, 0);
      g.font = `${FONT_SIZE}px "Courier New", monospace`;
      g.textBaseline = 'top';
      // brand accent color — kept in sync with --gold-soft (#6ee7b7)
      g.fillStyle = 'rgb(110,231,183)';
      g.fillText(CHARS[i], 1, 1);
      sprites.push(c);
    }
  }
  function resize(){
    const w = window.innerWidth, h = window.innerHeight;
    // capped at 1.5: these are 13px soft digits, and a full-viewport canvas
    // at 2x (5M+ pixels on a laptop) was a real part of the hero lag
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    W = w; H = h;
    DPR = dpr;
    buildSprites();
  }
  let lastResizeW = window.innerWidth;
  window.addEventListener('resize', () => {
    const w = window.innerWidth;
    // width-only guard — see the --stable-vh comment in index.html's <head>
    if(Math.abs(w - lastResizeW) <= 10) return;
    lastResizeW = w;
    resize();
  });
  resize();

  let particles = [];
  let lastSpawnX = -9999, lastSpawnY = -9999;

  document.addEventListener('pointermove', (e) => {
    const dx = e.clientX - lastSpawnX, dy = e.clientY - lastSpawnY;
    if((dx * dx + dy * dy) < SPAWN_MIN_DIST * SPAWN_MIN_DIST) return;
    lastSpawnX = e.clientX;
    lastSpawnY = e.clientY;
    particles.push({
      x: e.clientX + (Math.random() * 10 - 5),
      y: e.clientY,
      vy: 0.35 + Math.random() * 0.35,
      vx: Math.random() * 0.6 - 0.3,
      ci: (Math.random() * CHARS.length) | 0,
      born: performance.now(),
    });
    if(particles.length > MAX_PARTICLES) particles.splice(0, particles.length - MAX_PARTICLES);
    startLoop();
  }, { passive: true });

  let rafId = null;
  let isPageVisible = true;
  let lastRenderTs = 0;

  // only the area the digits actually occupied last frame is cleared —
  // not the whole viewport-sized canvas — and nothing is allocated per frame
  let dirty = null; // {x0,y0,x1,y1} of last frame's drawing, in css px
  function render(now){
    if(dirty){
      ctx.clearRect(dirty.x0 - 2, dirty.y0 - 2, dirty.x1 - dirty.x0 + 4, dirty.y1 - dirty.y0 + 4);
      dirty = null;
    }
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    let w = 0;
    for(let i = 0; i < particles.length; i++){
      const p = particles[i];
      const age = now - p.born;
      if(age > LIFE_MS) continue;
      const t = age / LIFE_MS;
      p.x += p.vx;
      p.y += p.vy;
      ctx.globalAlpha = (1 - t) * 0.65;
      ctx.drawImage(sprites[p.ci], p.x - 1, p.y - 1, SPRITE_W, SPRITE_H);
      if(p.x < x0) x0 = p.x; if(p.y < y0) y0 = p.y;
      if(p.x + SPRITE_W > x1) x1 = p.x + SPRITE_W; if(p.y + SPRITE_H > y1) y1 = p.y + SPRITE_H;
      particles[w++] = p;
    }
    particles.length = w; // compact in place (was a .filter() allocating a new array every frame)
    ctx.globalAlpha = 1;
    if(w) dirty = { x0, y0, x1, y1 };
  }

  function loop(ts){
    if(ts - lastRenderTs >= RENDER_INTERVAL){
      lastRenderTs = ts;
      render(ts);
    }
    // nothing left to animate — stop entirely instead of idling at the
    // capped fps forever; the pointermove handler above restarts this
    // the instant a new particle spawns.
    if(particles.length === 0){ rafId = null; return; }
    rafId = requestAnimationFrame(loop);
  }
  function startLoop(){ if(rafId === null && isPageVisible && !document.hidden) rafId = requestAnimationFrame(loop); }
  function stopLoop(){ if(rafId !== null){ cancelAnimationFrame(rafId); rafId = null; } }
  function syncLoop(){ if(isPageVisible && !document.hidden) startLoop(); else stopLoop(); }

  document.addEventListener('visibilitychange', () => { isPageVisible = !document.hidden; syncLoop(); });
})();
