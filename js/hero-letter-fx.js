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
    subEl.innerHTML = subEl.textContent
      .split(' ')
      .map((word) => `<span class="hero-sub-word">${Array.from(word).map((ch) => `<span class="hero-sub-char">${ch}</span>`).join('')}</span>`)
      .join(' ');
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
  let rects = [];
  function cacheRects(){
    rects = chars.map((el) => {
      const r = el.getBoundingClientRect();
      // BUG FIX, caught before shipping: `currentColor` can't be used
      // INSIDE the `color` property's own value (it's circular — color
      // defines what currentColor even means) — every browser treats
      // that as an invalid declaration. Capturing each letter's actual
      // resolved inherited color once, up front, gives color-mix() a
      // real base color to blend toward the brand emerald instead.
      const baseColor = el.style.color || getComputedStyle(el).color;
      return { el, cx: r.left + r.width / 2, cy: r.top + r.height / 2, baseColor };
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

  let isHeroVisible = true;
  if('IntersectionObserver' in window){
    const io = new IntersectionObserver((entries) => { isHeroVisible = entries[0].isIntersecting; }, { threshold: 0 });
    io.observe(hero);
  }

  let mouseX = -9999, mouseY = -9999;
  let ticking = false;
  function update(){
    ticking = false;
    if(!isHeroVisible) return;
    for(const r of rects){
      const dx = r.cx - mouseX, dy = r.cy - mouseY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const influence = Math.max(0, 1 - dist / RADIUS);
      const eased = influence * influence; // ease-in — falls off gently near the radius edge, snaps up closer to the cursor
      if(eased <= 0.002){
        r.el.style.translate = '';
        r.el.style.scale = '';
        r.el.style.color = '';
        continue;
      }
      r.el.style.translate = `0 ${(-LIFT * eased).toFixed(2)}px`;
      r.el.style.scale = (1 + (SCALE - 1) * eased).toFixed(3);
      r.el.style.color = `color-mix(in srgb, ${r.baseColor}, #10b981 ${Math.round(eased * 85)}%)`;
    }
  }
  function requestUpdate(){
    if(ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  }

  window.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    requestUpdate();
  }, { passive: true });

  hero.addEventListener('mouseleave', () => {
    mouseX = -9999;
    mouseY = -9999;
    requestUpdate();
  });
})();
