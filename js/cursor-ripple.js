/* ===================================================================
   Papi — sitewide cursor ripple
   A soft gold ripple trails the pointer across every section, echoing
   the hero's liquid-glass material (js/hero-slime.js) without actually
   re-running that metaball simulation sitewide. Each ripple is a small
   div animated purely by a CSS keyframe (transform+opacity — both
   compositor-only), not a canvas/WebGL redraw loop: this project has
   already been burned twice by backdrop-filter and twice more by large
   sustained filter:blur() (see the removal comments in style.css, e.g.
   the fan-card and testimonials-glow ones) — a sitewide effect is
   exactly the highest-risk place to reintroduce that class of jank, so
   this sticks to the same "layered gradients over a real filter"
   pattern those fixes already converged on. JS only runs on mousemove,
   throttled by distance travelled, to decide whether to spawn one —
   there is no per-frame render loop for this at all.
=================================================================== */
(function(){
  if(window.matchMedia && window.matchMedia('(hover:none), (pointer:coarse)').matches) return;
  if(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const layer = document.getElementById('cursorRippleLayer');
  if(!layer) return;

  const SPAWN_DIST = 28;       // px of cumulative pointer travel between spawns — a trail while
                                 // moving, nothing while still, rather than one per raw mousemove
  const MAX_ALIVE = 10;         // guards against a burst of fast mouse-shaking spawning unbounded divs
  const RIPPLE_MS = 800;        // must match the @keyframes duration in style.css
  const BASE_SIZE = 16;         // px, matches .cursor-ripple's own base width/height
  // speed is travel/time between consecutive samples (px/ms) — clamped and
  // remapped to a 0..1 "energy" used to scale each ripple's peak size/opacity,
  // so a fast flick of the mouse reads as a slightly bigger/brighter ripple
  // than a slow, idle drift — the "material has energy" cue from the pitch,
  // for the cost of one extra multiply per spawn
  const SPEED_FOR_MAX_ENERGY = 1.6;

  let lastX = null, lastY = null, lastT = null;
  let travelled = 0;
  let aliveCount = 0;

  function spawnRipple(x, y, energy){
    if(aliveCount >= MAX_ALIVE) return;
    aliveCount++;

    const el = document.createElement('div');
    el.className = 'cursor-ripple';
    const scale = 0.85 + energy * 0.5; // modest size bump only, stays subtle even at full energy
    el.style.setProperty('--ripple-peak-scale', (2.0 * scale).toFixed(2));
    el.style.setProperty('--ripple-peak-opacity', (0.10 + energy * 0.10).toFixed(3));
    // a CSS animation targeting `transform` fully owns that property the
    // instant it starts (its keyframe values replace any inline
    // el.style.transform entirely, not blend with it) — so the cursor
    // position has to travel in via these two custom properties instead,
    // which the keyframe itself reads via var(--rx)/var(--ry) (see
    // @keyframes cursorRippleExpand in style.css) and keeps constant
    // across both its 0%/100% steps while scale/opacity animate
    el.style.setProperty('--rx', `${(x - BASE_SIZE/2).toFixed(1)}px`);
    el.style.setProperty('--ry', `${(y - BASE_SIZE/2).toFixed(1)}px`);

    let removed = false;
    function remove(){
      if(removed) return;
      removed = true;
      el.remove();
      aliveCount--;
    }
    el.addEventListener('animationend', remove);
    // defensive fallback (same pattern as the newsletter popup's own timers)
    // in case animationend doesn't fire for some edge case
    setTimeout(remove, RIPPLE_MS + 100);

    layer.appendChild(el);
  }

  window.addEventListener('mousemove', (e)=>{
    const x = e.clientX, y = e.clientY;
    const now = performance.now();

    if(lastX === null){
      lastX = x; lastY = y; lastT = now;
      return;
    }

    const dx = x - lastX, dy = y - lastY;
    const dist = Math.sqrt(dx*dx + dy*dy);
    const dt = Math.max(1, now - lastT); // avoid div-by-zero on back-to-back same-ms events
    const speed = dist / dt;

    travelled += dist;
    lastX = x; lastY = y; lastT = now;

    if(travelled >= SPAWN_DIST){
      travelled = 0;
      const energy = Math.max(0, Math.min(1, speed / SPEED_FOR_MAX_ENERGY));
      spawnRipple(x, y, energy);
    }
  }, { passive:true });
})();
