/* ===================================================================
   Papi — elegant custom cursor
   A small dot tracks the pointer closely while a soft ring trails
   behind it with a slower lerp, giving that "dragging" lag feel. The
   ring grows on interactive elements and on press. Stays invisible
   until window.Papi.revealCursor is called (see js/init.js).
=================================================================== */
(function(){
  if(window.matchMedia && window.matchMedia('(hover:none), (pointer:coarse)').matches) return;

  const cursor = document.getElementById('customCursor');
  const ring = cursor && cursor.querySelector('.cursor-ring');
  const dot = cursor && cursor.querySelector('.cursor-dot');
  if(!cursor) return;

  let targetX = window.innerWidth/2, targetY = window.innerHeight/2;
  let dotX = targetX, dotY = targetY;
  let ringX = targetX, ringY = targetY;
  let lastMoveTime = performance.now();
  const IDLE_MS = 1400; // fades away if the pointer sits still this long

  // per heat/reliability audit: this rAF loop had no backgrounded-tab
  // guard at all, unlike its two siblings (hero-matrix.js, cursor-
  // trail.js) which both already stop on visibilitychange — a
  // backgrounded tab kept this repainting two translate3d styles every
  // frame forever, for no visible benefit.
  let rafId = null;
  document.addEventListener('visibilitychange', () => {
    if(document.hidden){
      if(rafId !== null){ cancelAnimationFrame(rafId); rafId = null; }
    } else if(rafId === null){
      rafId = requestAnimationFrame(frame);
    }
  });

  window.addEventListener('mousemove', (e)=>{
    targetX = e.clientX;
    targetY = e.clientY;
    lastMoveTime = performance.now();
    cursor.classList.remove('is-hidden');
    cursor.classList.remove('is-idle');
  });

  window.Papi = window.Papi || {};
  window.Papi.revealCursor = ()=> cursor.classList.add('is-ready');

  document.addEventListener('mouseleave', ()=> cursor.classList.add('is-hidden'));
  document.addEventListener('mouseenter', ()=> cursor.classList.remove('is-hidden'));

  window.addEventListener('mousedown', ()=> cursor.classList.add('is-active'));
  window.addEventListener('mouseup', ()=> cursor.classList.remove('is-active'));

  document.querySelectorAll('a, button').forEach(el=>{
    el.addEventListener('mouseenter', ()=> cursor.classList.add('is-active'));
    el.addEventListener('mouseleave', ()=> cursor.classList.remove('is-active'));
  });

  // Awwwards personality pass — site-wide cursor language: a generic
  // hook for any element marked data-cursor="X" to swap the ring into
  // an .is-X variant (see css/style.css for the drag/view treatments),
  // instead of every hover on the site reading as the same generic
  // "clickable" state. Bound once, same as the a/button loop above —
  // this runs after live-demo.js/testimonials.js have already built
  // their cards (see index.html's own script order), so their dynamic
  // [data-cursor] elements are already in the DOM by the time this runs.
  document.querySelectorAll('[data-cursor]').forEach(el=>{
    const variantClass = 'is-' + el.dataset.cursor;
    el.addEventListener('mouseenter', ()=> cursor.classList.add(variantClass));
    el.addEventListener('mouseleave', ()=> cursor.classList.remove(variantClass));
  });

  // BUG FIX: per report (screenshot attached), the custom cursor gets
  // visibly "stuck" — frozen mid-shape at a fixed spot — while hovering
  // the Live Demo section's embedded iframes. Root cause: an iframe is
  // a separate browsing context with its own document, so once the real
  // pointer moves onto one, this file's own window-level 'mousemove'
  // listener (which drives targetX/targetY every frame) stops receiving
  // events entirely — dotX/ringX/ringY simply stop updating, freezing
  // the cursor exactly where it was the instant it crossed onto the
  // iframe. .live-demo-stack's own [data-cursor="drag"] mouseenter/
  // mouseleave (above) is unaffected by this (mouseleave correctly
  // never fires just for moving onto a child element), so the frozen
  // cursor also keeps whatever shape it had — together, a static,
  // stuck-looking cursor exactly like the one in the report. Hiding the
  // cursor for as long as the pointer is over any iframe sidesteps the
  // cross-frame tracking gap outright — the browser's own real cursor
  // shows over the iframe's own content anyway, and 'is-hidden' clears
  // itself automatically the moment the pointer re-enters the parent
  // page and the mousemove listener above starts firing again.
  document.querySelectorAll('iframe').forEach(frame=>{
    frame.addEventListener('mouseenter', ()=> cursor.classList.add('is-hidden'));
  });

  function frame(){
    // BUG FIX: found via a MutationObserver audit — this unconditionally
    // called classList.add('is-idle') on every single animation frame
    // once idle, forever (not just once on the idle transition).
    // classList.add() still fires an attribute mutation even when the
    // class is already present, so this was rewriting the cursor's
    // class attribute ~60 times/second, at rest, on every page load,
    // for the cursor's entire lifetime — needless style-recalc churn
    // fighting for the same frame budget as the matrix canvas and any
    // active GSAP scrub tween. The contains() guard makes this fire
    // exactly once per idle transition instead.
    if(!cursor.classList.contains('is-idle') && performance.now() - lastMoveTime > IDLE_MS){
      cursor.classList.add('is-idle');
    }

    dotX += (targetX - dotX) * 0.45;
    dotY += (targetY - dotY) * 0.45;
    ringX += (targetX - ringX) * 0.12;
    ringY += (targetY - ringY) * 0.12;

    if(dot) dot.style.transform = `translate3d(${dotX}px, ${dotY}px, 0)`;
    if(ring) ring.style.transform = `translate3d(${ringX}px, ${ringY}px, 0)`;

    rafId = requestAnimationFrame(frame);
  }
  rafId = requestAnimationFrame(frame);
})();
