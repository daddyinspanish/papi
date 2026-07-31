/* ===================================================================
   Papi — Hero Matrix Rain
   Per direct request: "a glitch inspired matrix of falling numbers
   characters in the background alongside the liquid, something that
   is constantly happening in the background." A plain 2D-canvas
   falling-digit rain (classic Matrix look, but brand-tinted aqua
   instead of green) — originally sat BEHIND js/process-hero-slime.js's
   own liquid-glass canvas so both were visible at once; per a later
   direct request that liquid-glass layer was removed entirely, so
   this is now the hero's whole background visual on its own. Every
   column is redrawn fresh each frame with a randomized digit per cell
   (the standard "shimmering" matrix-rain trick) rather than persisting
   trails via a semi-transparent fillRect overlay — that overlay
   technique never actually clears (alpha compositing asymptotically
   approaches fully opaque), which would eventually paint over the
   hero's own dark gradient background entirely. clearRect + redraw
   every frame keeps this reliably transparent everywhere but the
   digits themselves, no matter how long it runs.

   BUG FIX: per report, "when someone makes the website be loaded into
   an extended monitor, that the numbers do not just stretch... make
   sure same quality is across all types of sizing" — resize() already
   recomputes the canvas's drawing-buffer resolution from the CSS size
   × devicePixelRatio, but that only ever re-ran on a window 'resize'
   event. Moving an already-open window from one display to another
   (e.g. a laptop's Retina panel to a non-Retina external monitor, or
   vice versa — exactly what "extended monitor" setups do) changes
   window.devicePixelRatio WITHOUT necessarily firing 'resize' at all,
   since the CSS-pixel viewport size can stay identical while only the
   backing pixel density changes. Left unhandled, the canvas keeps
   rendering at the OLD dpr's resolution while the browser silently
   rescales that bitmap to match the new display's pixel density —
   exactly the stretched/blurry look reported. watchDpr() below uses a
   matchMedia resolution query (the standard technique, since there's
   no native "devicePixelRatio change" event) to catch that and
   re-run resize() at the correct new density, then re-arms itself for
   whatever the new dpr is.
=================================================================== */
(function(){
  const canvas = document.getElementById('processHeroMatrix');
  if(!canvas) return;
  const ctx = canvas.getContext('2d');
  if(!ctx) return;

  const CONFIG = {
    fontSize: 16,
    // BUG FIX: per report (screenshot of the Instagram in-app browser,
    // now that the black-screen bug is fixed and the hero is actually
    // visible there), "the numbers look too big" — 13px on a real phone
    // viewport reads noticeably larger relative to screen width than on
    // a desktop test window, since there's far less width for the same
    // digit size to sit inside. Smaller value here also raises column
    // density (cellW is derived from fontSize below), which reads closer
    // to the classic dense matrix-rain look on a narrow viewport too.
    fontSizeMobile: 9,
    mobileWidth: 640,
    // BUG FIX: per follow-up report, "the speed of the matrix now seems
    // like its raining... make sure its a bit smoother, a bit slower."
    // The previous 0.48-1.25 (a 1.7x bump over the original 0.28-0.72)
    // read as too fast/heavy once the timing fix below made it actually
    // smooth — dialed back to a more modest bump over the original.
    // Speeds below are "rows per ideal 60fps frame" — renderFrame()
    // scales the actual step by real elapsed time (see BUG FIX further
    // down), so this reads as smooth motion at any render cadence
    // instead of choppy steps.
    speedMin: 0.32,
    speedMax: 0.8,
    streamMin: 6,
    streamMax: 16,
    headAlpha: 0.55,
    // per-row falloff behind the head — smaller value fades out faster
    tailFalloff: 0.80,
  };

  const CHARS = '0123456789';
  const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let W = 0, H = 0, fontSize = CONFIG.fontSize, rowH = CONFIG.fontSize, cellW = CONFIG.fontSize * 0.62;
  let columns = [];

  // cursor/touch repulsion — tracked in CSS pixels (canvas is DPR-scaled
  // via ctx.setTransform in resize(), so drawing coordinates already
  // match CSS pixels; no extra conversion needed here). Starts far
  // off-canvas so nothing is pushed before the first real pointer move.
  const REPEL_RADIUS = 110;
  const REPEL_MAX_PUSH = 34;
  let pointerX = -9999, pointerY = -9999;
  // the canvas itself is pointer-events:none (so it never blocks clicks
  // on the title/CTA above it — see .process-hero-matrix in style.css),
  // so the listener has to live on its parent section instead; pointer
  // coordinates are still measured against the canvas's own bounding
  // box, which is what renderFrame()'s drawing coordinates are in.
  //
  // Per direct request: "make sure the cursor effects are also on
  // mobile, that way when someone touches the screen the numbers get
  // affected" — this used to be gated to hover:hover+pointer:fine only
  // (desktop), since touch has no continuous "hover" state to speak of.
  // Pointer events already unify mouse/pen/touch, though, so binding
  // unconditionally and reacting to an actual finger contact (rather
  // than a hover that touch can never produce) covers both without any
  // separate touch-specific code path: pointermove fires while a finger
  // drags across the hero, and pointerup/pointercancel below reset the
  // push the moment contact ends, since touch has no "pointerleave" of
  // its own the way a mouse does.
  const heroSection = canvas.closest('.process-hero');
  if(!prefersReducedMotion && heroSection){
    heroSection.addEventListener('pointermove', (e) => {
      const rect = canvas.getBoundingClientRect();
      pointerX = e.clientX - rect.left;
      pointerY = e.clientY - rect.top;
    }, { passive: true });
    heroSection.addEventListener('pointerleave', () => {
      pointerX = -9999;
      pointerY = -9999;
    }, { passive: true });
    heroSection.addEventListener('pointerup', () => {
      pointerX = -9999;
      pointerY = -9999;
    }, { passive: true });
    heroSection.addEventListener('pointercancel', () => {
      pointerX = -9999;
      pointerY = -9999;
    }, { passive: true });
  }

  function randRange(min, max){ return min + Math.random() * (max - min); }

  function makeColumn(x){
    return {
      x,
      // negative start staggers each column's first appearance instead
      // of every column beginning in lockstep on the very first frame
      y: -randRange(0, 40),
      speed: randRange(CONFIG.speedMin, CONFIG.speedMax),
      length: Math.floor(randRange(CONFIG.streamMin, CONFIG.streamMax)),
    };
  }

  function buildColumns(){
    const count = Math.ceil(W / cellW) + 1;
    columns = new Array(count).fill(0).map((_, i) => makeColumn(i * cellW));
  }

  function resize(){
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    if(!w || !h) return;
    const isMobile = window.innerWidth < CONFIG.mobileWidth;
    fontSize = isMobile ? CONFIG.fontSizeMobile : CONFIG.fontSize;
    rowH = fontSize;
    cellW = fontSize * 0.62;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = `${fontSize}px "Courier New", monospace`;
    ctx.textBaseline = 'top';

    W = w;
    H = h;
    buildColumns();
  }

  let lastResizeW = window.innerWidth;
  window.addEventListener('resize', () => {
    const w = window.innerWidth;
    if(Math.abs(w - lastResizeW) <= 10) return; // see the --stable-vh comment elsewhere on this site
    lastResizeW = w;
    clearTimeout(window.__papiHeroMatrixResizeT);
    window.__papiHeroMatrixResizeT = setTimeout(resize, 150);
  });

  // see this file's own BUG FIX note up top — catches a display change
  // (e.g. dragging the window onto a different-dpi external monitor)
  // that a plain 'resize' listener can miss entirely
  function watchDpr(){
    if(!window.matchMedia) return;
    const dpr = window.devicePixelRatio || 1;
    const mq = window.matchMedia(`(resolution: ${dpr}dppx)`);
    const onChange = () => { resize(); watchDpr(); };
    if(mq.addEventListener) mq.addEventListener('change', onChange, { once: true });
    else if(mq.addListener) mq.addListener(onChange); // older Safari
  }
  watchDpr();

  // BUG FIX: per report, "something is causing my phone to turn really
  // hot" — every fillText call in the loop below used to build a brand
  // new rgba(...) template-literal string, per character, every single
  // frame (streamMax=16 rows × ~50 mobile columns × up to 24fps = tens
  // of thousands of short-lived string allocations per second). Alpha
  // only ever depends on the row's fixed position in its own stream
  // (CONFIG.tailFalloffraised to a fixed power of j), never on anything
  // that changes frame to frame, so every possible fillStyle string is
  // knowable up front — computed once here instead of reallocated on
  // every character on every frame. Pure GC-pressure reduction, zero
  // visual difference (identical values, just cached).
  // per direct request to make the falling numbers actually read as
  // yellow/gold — the first R/B-channel-swap pass (matching every other
  // color on the site) landed too close to white/cream here, since the
  // original blue was itself a near-white icy tint with barely any
  // saturation to carry over. Using the site's own established gold
  // tones directly instead: the head matches the "glow gold" accent
  // used site-wide for hover/glitch states (rgba(255,221,122) / #ffdd7a),
  // the tail matches --gold (203,168,105), both properly saturated.
  const HEAD_FILLSTYLE = `rgba(255,221,122,${CONFIG.headAlpha})`;
  const TAIL_FILLSTYLES = new Array(CONFIG.streamMax).fill(null).map((_, j) => {
    if(j === 0) return null; // row 0 always uses HEAD_FILLSTYLE instead
    const alpha = CONFIG.headAlpha * Math.pow(CONFIG.tailFalloff, j) * 0.6;
    return alpha < 0.015 ? null : `rgba(203,168,105,${alpha})`;
  });

  function renderFrame(steps){
    ctx.clearRect(0, 0, W, H);
    const maxRow = H / rowH;
    const hasPointer = pointerX > -1000;

    columns.forEach(col => {
      // repulsion is per-column, not per-character — pushing every
      // digit in a falling stream by the same amount keeps the stream
      // reading as one continuous line bending around the cursor,
      // rather than digits scattering independently of their neighbors
      let pushX = 0;
      if(hasPointer){
        const dx = col.x - pointerX;
        // compare against the column's vertical center-ish rather than
        // per-character, since the push is horizontal-only anyway and
        // a per-column push looks more like a "field" bending around
        // the cursor than a per-character jitter
        const dy = (col.y * rowH) - pointerY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if(dist < REPEL_RADIUS){
          const falloff = 1 - dist / REPEL_RADIUS;
          pushX = (dist < 0.01 ? 1 : dx / dist) * falloff * falloff * REPEL_MAX_PUSH;
        }
      }

      for(let j = 0; j < col.length; j++){
        const rowY = col.y - j;
        if(rowY < 0) continue;
        const py = rowY * rowH;
        if(py > H) break;

        const style = j === 0 ? HEAD_FILLSTYLE : TAIL_FILLSTYLES[j];
        if(!style) continue;

        const ch = CHARS[(Math.random() * CHARS.length) | 0];
        ctx.fillStyle = style;
        ctx.fillText(ch, col.x + pushX, py);
      }

      col.y += col.speed * steps;
      if(col.y - col.length > maxRow){
        col.y = -randRange(0, 20);
        col.speed = randRange(CONFIG.speedMin, CONFIG.speedMax);
        col.length = Math.floor(randRange(CONFIG.streamMin, CONFIG.streamMax));
      }
    });
  }

  resize();

  if(prefersReducedMotion){
    // one static frame, no falling motion, matching this site's usual
    // reduced-motion treatment elsewhere
    renderFrame(0);
    return;
  }

  // BUG FIX (matching the same pattern already used in js/process-hero-
  // slime.js): pause the render loop whenever the hero isn't actually
  // on-screen or the tab itself isn't visible, so this doesn't keep
  // burning CPU/battery for the rest of the session once scrolled past.
  //
  // BUG FIX: per report, "the speed of the matrix is very choppy now,"
  // this file used to throttle rendering to a fixed CONFIG.renderFPS
  // while ALSO advancing every column by a fixed `col.speed` per CALL
  // rather than per unit of real time — with those two bugs stacked,
  // the throttle's own uneven gap-to-gap timing (a 28fps target doesn't
  // divide evenly into a real 60Hz/120Hz display's frame timing) read
  // as visible stutter. `steps` below fixes that half: it scales the
  // actual movement by real elapsed time (in units of "one ideal 60fps
  // frame"), so however long actually passed between renders, the rain
  // covers the proportionally correct distance — smooth at ANY render
  // cadence, throttled or not.
  //
  // BUG FIX: per later, separate report — "make sure this website does
  // not make phones hot" — a full re-render of every column, every
  // single real display frame (up to 120Hz on newer phones), for the
  // entire time the hero is on screen, is continuous, avoidable CPU/GPU
  // work with no visual benefit for a background rain effect. Capping
  // to a fixed target again is safe from the choppiness above now that
  // `steps` decouples correctness from cadence — unlike the original
  // 28fps bug, capping no longer costs any smoothness, just power.
  // Mobile gets a lower target than desktop since phones are the
  // specific concern.
  const REFERENCE_FRAME_MS = 1000 / 60;
  const MAX_STEPS = 4;
  const RENDER_INTERVAL = 1000 / (window.innerWidth < CONFIG.mobileWidth ? 24 : 30);
  let lastRenderTs = 0;
  let rafId = null;
  let isHeroVisible = true;

  function loop(ts){
    if(ts - lastRenderTs >= RENDER_INTERVAL){
      const dt = lastRenderTs ? ts - lastRenderTs : REFERENCE_FRAME_MS;
      lastRenderTs = ts;
      const steps = Math.min(dt / REFERENCE_FRAME_MS, MAX_STEPS);
      renderFrame(steps);
    }
    rafId = requestAnimationFrame(loop);
  }
  function startLoop(){
    if(rafId !== null) return;
    rafId = requestAnimationFrame(loop);
  }
  function stopLoop(){
    if(rafId !== null){ cancelAnimationFrame(rafId); rafId = null; }
  }
  function syncLoop(){
    if(isHeroVisible && !document.hidden) startLoop(); else stopLoop();
  }

  if('IntersectionObserver' in window){
    const io = new IntersectionObserver((entries) => {
      isHeroVisible = entries[0].isIntersecting;
      syncLoop();
    }, { threshold: 0 });
    io.observe(canvas);
  }
  document.addEventListener('visibilitychange', syncLoop);
  // starts unconditionally rather than routing through syncLoop() —
  // some environments report document.hidden === true even on initial
  // load before any real visibilitychange has fired, which would
  // otherwise leave this canvas blank forever until some other event
  // happened to call syncLoop(). Real backgrounding still pauses it
  // correctly via the visibilitychange listener above.
  startLoop();
})();
