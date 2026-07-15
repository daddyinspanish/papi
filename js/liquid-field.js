/* ===================================================================
   Papi — gold liquid field
   Replaces the old "world of cubes" particle grid entirely. That field
   was tied to scroll indirectly (its home positions and cursor-push
   physics all ran inside the same rAF loop the hero used, competing
   for main-thread time with everything else happening during a
   scroll), and even after being rebuilt from a <canvas> to real DOM
   tiles to escape iOS's paint-defer-during-touch-scroll behavior, the
   freeze persisted. This field is a clean rebuild with a different
   premise: a handful of soft gold blobs drifting through the hero on
   their own, driven only by elapsed real time — never by scroll
   position, never gated on anything scroll-related — so there's
   nothing here for a scroll gesture to ever compete with or interrupt.

   Movement is a slow, continuous drift (each blob its own Lissajous-
   style wander — a couple of sine/cosine terms with a different
   frequency/phase per blob, so they never move in sync), computed
   fresh each frame directly from *how much time has elapsed*, not
   accumulated frame to frame — the same lesson learned the hard way
   rebuilding the old field: an accumulator can jump to a wildly wrong
   value after any gap in frame delivery, a pure function of elapsed
   time never can.

   The cursor is a gravity-free "repel" force layered on top of that
   drift, the same spring-and-damping shape the old field used for its
   push effect: blobs near the pointer are pushed away, then ease back
   to their ambient drift position once it moves on or goes idle.

   Visually, the "thick, shiny liquid" look is built entirely from
   gradients (a bright off-centre highlight easing to a dark edge, plus
   a small glossy specular spot) and a slow CSS-only border-radius
   morph — deliberately not filter:blur(), which is a paint-level
   effect the browser has to recompute whenever the pixels under it
   change. Position updates are transform-only, which the browser can
   satisfy by recompositing an already-rasterized layer with no
   repaint at all.
=================================================================== */
(function(){
  const container = document.getElementById('liquidField');
  if(!container) return;
  const heroEl = document.getElementById('hero');

  const BLOB_COUNT = 7;
  let W = 0, H = 0;
  let blobs = [];
  let revealed = false;

  const mouse = { x:-9999, y:-9999, active:false };
  let lastMoveTime = 0;
  const IDLE_MS = 1400; // repel effect releases if the pointer sits still this long

  // cursor "repel" force — tight and noticeable without affecting a
  // huge area of the field, same shape as the old particle push
  const RADIUS = 230;
  const PUSH = 0.9;
  const SPRING = 0.02;
  const DAMPING = 0.9;

  function rand(min, max){ return min + Math.random() * (max - min); }

  function resize(){
    W = container.offsetWidth;
    H = container.offsetHeight || window.innerHeight;
  }
  let lastResizeW = window.innerWidth;
  window.addEventListener('resize', ()=>{
    const w = window.innerWidth;
    if(w === lastResizeW) return;
    lastResizeW = w;
    clearTimeout(window.__papiLiquidResizeT);
    window.__papiLiquidResizeT = setTimeout(resize, 150);
  });
  window.addEventListener('load', resize);
  if(document.fonts && document.fonts.ready) document.fonts.ready.then(resize);

  // blobs are positioned in container-local coordinates, but mouse/
  // touch events report viewport-relative coordinates — only equal at
  // the very top of the page with zero scroll (same reasoning as the
  // old field's toCanvasXY)
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

  function buildBlobs(){
    for(let i=0;i<BLOB_COUNT;i++){
      const el = document.createElement('div');
      el.className = 'liquid-blob';
      const size = rand(190, 420);
      el.style.width = `${size}px`;
      el.style.height = `${size}px`;
      el.style.animationDuration = `${rand(9, 15).toFixed(2)}s`;
      el.style.animationDelay = `-${rand(0, 12).toFixed(2)}s`;
      container.appendChild(el);

      blobs.push({
        el,
        size,
        // normalized anchor within the field, re-applied against
        // whatever W/H currently are each frame — never stored as an
        // absolute pixel position, so a resize just naturally reflows
        // next frame with no rebuild needed
        baseX: rand(0.12, 0.88),
        baseY: rand(0.12, 0.88),
        ampX: rand(0.14, 0.30),
        ampY: rand(0.12, 0.26),
        freqX: rand(0.00006, 0.00013),
        freqY: rand(0.00005, 0.00011),
        phaseX: rand(0, Math.PI * 2),
        phaseY: rand(0, Math.PI * 2),
        // repel spring state — an offset layered on top of the ambient
        // drift target above, not a replacement for it
        ox: 0, oy: 0, ovx: 0, ovy: 0,
      });
    }
  }

  let revealStart = null;

  // ambient drift is a pure function of elapsed time (ts - revealStart)
  // rather than a per-frame accumulator, for exactly the reason spelled
  // out in the file header — see js/reviews-cube.js and the git history
  // of the old particles.js for the long way this lesson was learned
  function step(ts){
    if(!revealed){ requestAnimationFrame(step); return; }

    let heroVisible = true;
    if(heroEl){
      const r = heroEl.getBoundingClientRect();
      heroVisible = r.bottom > 0 && r.top < window.innerHeight;
    }
    if(!heroVisible){ requestAnimationFrame(step); return; }

    if(revealStart === null) revealStart = ts;
    const elapsed = ts - revealStart;

    if(mouse.active && ts - lastMoveTime > IDLE_MS) mouse.active = false;
    const pushActive = mouse.active;

    for(let i=0;i<blobs.length;i++){
      const b = blobs[i];

      const driftX = b.baseX * W + Math.sin(elapsed * b.freqX + b.phaseX) * b.ampX * W;
      const driftY = b.baseY * H + Math.cos(elapsed * b.freqY + b.phaseY) * b.ampY * H;

      if(pushActive){
        const dx = (driftX + b.ox) - mouse.x;
        const dy = (driftY + b.oy) - mouse.y;
        const dist = Math.sqrt(dx*dx + dy*dy) + 0.01;
        if(dist < RADIUS){
          const force = (1 - dist / RADIUS) * PUSH;
          const ang = Math.atan2(dy, dx);
          b.ovx += Math.cos(ang) * force;
          b.ovy += Math.sin(ang) * force;
        }
      }

      // spring back toward zero offset (the ambient drift position)
      b.ovx += (0 - b.ox) * SPRING;
      b.ovy += (0 - b.oy) * SPRING;
      b.ovx *= DAMPING;
      b.ovy *= DAMPING;
      b.ox += b.ovx;
      b.oy += b.ovy;

      const x = driftX + b.ox - b.size / 2;
      const y = driftY + b.oy - b.size / 2;
      b.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      if(b.el.style.opacity !== '1') b.el.style.opacity = '1';
    }

    window.PapiDebug.log('liquid', { ts });

    requestAnimationFrame(step);
  }

  resize();
  requestAnimationFrame(step);

  window.Papi = window.Papi || {};
  window.Papi.resizeField = function(){ resize(); };
  window.Papi.revealField = function(){
    if(revealed) return;
    revealed = true;
    buildBlobs();
  };
})();
