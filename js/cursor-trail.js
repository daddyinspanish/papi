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

  let W = 0, H = 0;
  function resize(){
    const w = window.innerWidth, h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = `${FONT_SIZE}px "Courier New", monospace`;
    ctx.textBaseline = 'top';
    W = w; H = h;
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
      ch: CHARS[(Math.random() * CHARS.length) | 0],
      born: performance.now(),
    });
    if(particles.length > MAX_PARTICLES) particles.splice(0, particles.length - MAX_PARTICLES);
    startLoop();
  }, { passive: true });

  let rafId = null;
  let isPageVisible = true;
  let lastRenderTs = 0;

  function render(now){
    ctx.clearRect(0, 0, W, H);
    particles = particles.filter((p) => {
      const age = now - p.born;
      if(age > LIFE_MS) return false;
      const t = age / LIFE_MS;
      p.x += p.vx;
      p.y += p.vy;
      const alpha = (1 - t) * 0.65;
      // per direct request to move the site's blue accent to gold —
      // was rgba(122,221,255,*), R/B-swapped like every other color
      ctx.fillStyle = `rgba(255,221,122,${alpha.toFixed(3)})`;
      ctx.fillText(p.ch, p.x, p.y);
      return true;
    });
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
