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

    requestAnimationFrame(frame);
  }
  frame();
})();
