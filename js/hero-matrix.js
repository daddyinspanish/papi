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
    fontSizeMobile: 13,
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

  function renderFrame(steps){
    ctx.clearRect(0, 0, W, H);
    const maxRow = H / rowH;

    columns.forEach(col => {
      for(let j = 0; j < col.length; j++){
        const rowY = col.y - j;
        if(rowY < 0) continue;
        const py = rowY * rowH;
        if(py > H) break;

        const alpha = j === 0
          ? CONFIG.headAlpha
          : CONFIG.headAlpha * Math.pow(CONFIG.tailFalloff, j) * 0.6;
        if(alpha < 0.015) continue;

        const ch = CHARS[(Math.random() * CHARS.length) | 0];
        ctx.fillStyle = j === 0
          ? `rgba(226,246,255,${alpha})`
          : `rgba(122,180,214,${alpha})`;
        ctx.fillText(ch, col.x, py);
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
