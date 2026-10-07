/* ===================================================================
   Papi — magnetic cursor effect on the hero title + subtitle letters
   Per direct request, "I want the cursor to have an effect on the
   title letters and subtitles letters too" — each letter lifts,
   scales up slightly, and tints toward the brand emerald the closer
   the cursor gets to it, easing back to rest as the cursor moves away.

   Reuses the title's existing .hero-title-char spans (already split by
   js/scroll-journey-hero.js for its own glitch-dissolve effect) rather
   than re-splitting the title itself — this script runs AFTER that one
   in index.html's own script order, so those spans already exist by
   the time this IIFE runs. The subtitle has no split of its own yet, so
   this does that part itself, same per-word-then-per-character
   technique (and same reason: a bare run of per-letter spans with no
   word-level wrapper lets the browser break a line mid-word — already
   fixed once on the title itself, see that file's own BUG FIX comment).

   Moves each letter via the separate `translate`/`scale` CSS properties
   rather than `transform`, specifically so this composes cleanly
   alongside scroll-journey-hero.js's own `transform` tween on the same
   title characters (the CSS rendering pipeline applies translate,
   rotate, scale and transform together, not as competing values) —
   the two effects run independently without fighting over one property.
=================================================================== */
(function(){
  if(window.matchMedia && (window.matchMedia('(hover: none), (pointer: coarse)').matches || window.matchMedia('(prefers-reduced-motion: reduce)').matches)) return;

  const hero = document.querySelector('.process-hero');
  const titleEl = document.querySelector('.process-hero-title');
  const subEl = document.querySelector('.process-hero-sub');
  if(!hero || (!titleEl && !subEl)) return;

  if(subEl){
    // the subtitle now holds two stacked lines (rotated by js/hero-rotator.js),
    // so split by walking TEXT NODES to keep that markup intact (same
    // technique and reason as the title split in js/scroll-journey-hero.js)
    const nodes = [];
    const walker = document.createTreeWalker(subEl, NodeFilter.SHOW_TEXT);
    while(walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node) => {
      if(!node.nodeValue.trim()) return;
      const frag = document.createDocumentFragment();
      node.nodeValue.split(/( )/).forEach((part) => {
        if(!part) return;
        if(part === ' '){ frag.appendChild(document.createTextNode(' ')); return; }
        const word = document.createElement('span');
        word.className = 'hero-sub-word';
        Array.from(part).forEach((ch) => {
          const c = document.createElement('span');
          c.className = 'hero-sub-char';
          c.textContent = ch;
          word.appendChild(c);
        });
        frag.appendChild(word);
      });
      node.parentNode.replaceChild(frag, node);
    });
  }

  const chars = [
    ...(titleEl ? Array.from(titleEl.querySelectorAll('.hero-title-char')) : []),
    ...(subEl ? Array.from(subEl.querySelectorAll('.hero-sub-char')) : []),
  ];
  if(!chars.length) return;

  const RADIUS = 120; // px — how far the cursor's influence reaches
  const LIFT = 9; // px — max lift at the cursor's exact position
  const SCALE = 1.22; // max scale at the cursor's exact position

  // the hero is GSAP-pinned for its whole scroll-journey (js/scroll-
  // journey-hero.js) — these letters' on-screen position never actually
  // changes from scroll while that pin holds, only on an actual resize,
  // so caching rects just once (+ on resize) is correct and far cheaper
  // than recomputing getBoundingClientRect() for 100+ spans every frame
  const active = [];          // letters currently away from rest, or easing back (see frame())
  let rects = [];
  function cacheRects(){
    // any letter still mid-effect keeps no stale inline style across a re-measure
    rects.forEach((r) => { if(r.live || r.q){ r.el.style.translate = ''; r.el.style.scale = ''; r.el.style.color = ''; } });
    active.length = 0;
    rects = chars.map((el) => {
      const r = el.getBoundingClientRect();
      // BUG FIX, caught before shipping: `currentColor` can't be used
      // INSIDE the `color` property's own value (it's circular — color
      // defines what currentColor even means) — every browser treats
      // that as an invalid declaration. Capturing each letter's actual
      // resolved inherited color once, up front, gives color-mix() a
      // real base color to blend toward the brand emerald instead.
      const baseColor = el.style.color || getComputedStyle(el).color;
      return { el, cx: r.left + r.width / 2, cy: r.top + r.height / 2, baseColor, live: false, cur: 0, q: 0 };
    });
  }
  cacheRects();

  let lastResizeW = window.innerWidth;
  window.addEventListener('resize', () => {
    const w = window.innerWidth;
    if(Math.abs(w - lastResizeW) <= 10) return;
    lastResizeW = w;
    cacheRects();
  });
  // the rotating title phrase (js/hero-rotator.js) moves the letters after
  // "Building Websites"/"Creating Content" whenever it swaps — re-measure
  window.addEventListener('papi:herotitle', cacheRects);
  // the letters' base color is cached above, so re-read it after a light/dark flip
  // (wait out the 0.35s theme cross-fade first so it isn't captured mid-blend)
  window.addEventListener('papi:themechange', () => { setTimeout(cacheRects, 500); });

  let isHeroVisible = true;
  if('IntersectionObserver' in window){
    const io = new IntersectionObserver((entries) => { isHeroVisible = entries[0].isIntersecting; }, { threshold: 0 });
    io.observe(hero);
  }

  let mouseX = -9999, mouseY = -9999;

  // PERF (per report: "lag when I move my cursor"). Profiled: each letter
  // near the cursor used to run three CSS transitions (translate, scale,
  // color) on every mouse move — about 200 letters over a canvas that
  // repaints every frame — and that alone dropped the hero from 60fps to
  // 30fps on a slower machine. The easing now happens here instead: each
  // letter eases toward its target amount (0..1) once per frame, only
  // letters that are actually moving are visited, and a letter's style is
  // written only when its (quantized) amount changes. Same look, no
  // per-letter animation machinery.
  let rafId = 0, lastTs = 0, mouseMoved = false;
  const EASE_MS = 90;         // time constant of the easing (feels like the old .3s curve)

  function target(r){
    const dx = r.cx - mouseX, dy = r.cy - mouseY;
    if(dx > RADIUS || dx < -RADIUS || dy > RADIUS || dy < -RADIUS) return 0;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const influence = Math.max(0, 1 - dist / RADIUS);
    return influence * influence; // ease-in — falls off gently near the radius edge, snaps up closer to the cursor
  }
  function paint(r){
    const q = Math.round(r.cur * 40);
    if(q === r.q) return;
    r.q = q;
    if(q === 0){
      r.el.style.translate = '';
      r.el.style.scale = '';
      r.el.style.color = '';
      return;
    }
    const e = q / 40;
    r.el.style.translate = `0 ${(-LIFT * e).toFixed(2)}px`;
    r.el.style.scale = (1 + (SCALE - 1) * e).toFixed(3);
    r.el.style.color = `color-mix(in srgb, ${r.baseColor}, #10b981 ${Math.round(e * 85)}%)`;
  }
  function frame(ts){
    rafId = 0;
    const dt = lastTs ? Math.min(ts - lastTs, 64) : 16;
    lastTs = ts;
    if(!isHeroVisible){ lastTs = 0; return; }
    const k = 1 - Math.exp(-dt / EASE_MS);
    // pick up letters newly inside the radius (cheap box test; the full
    // list is only walked while the pointer is actually on the hero)
    if(mouseMoved && mouseX > -9000){
      mouseMoved = false;
      for(const r of rects){
        if(r.live) continue;
        if(target(r) > 0.002){ r.live = true; active.push(r); }
      }
    }
    for(let i = active.length - 1; i >= 0; i--){
      const r = active[i];
      const tg = (mouseX > -9000) ? target(r) : 0;
      r.cur += (tg - r.cur) * k;
      if(Math.abs(tg - r.cur) < 0.004 && tg === 0){ r.cur = 0; paint(r); r.live = false; active.splice(i, 1); continue; }
      paint(r);
    }
    if(active.length || mouseMoved) rafId = requestAnimationFrame(frame);
    else lastTs = 0;
  }
  function requestUpdate(){
    if(!rafId) rafId = requestAnimationFrame(frame);
  }

  window.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    mouseMoved = true;
    requestUpdate();
  }, { passive: true });

  hero.addEventListener('mouseleave', () => {
    mouseX = -9999;
    mouseY = -9999;
    mouseMoved = false;
    requestUpdate();
  });
})();
