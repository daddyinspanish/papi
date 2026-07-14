/* ===================================================================
   Papi — elegant custom cursor
   A small dot tracks the pointer closely while a soft ring trails
   behind it with a slower lerp, giving that "dragging" lag feel. The
   ring grows on interactive elements and on press. Stays invisible
   until the loader has fully finished (window.Papi.revealCursor,
   called from loader.js) — no cursor during the loading sequence.
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

  document.querySelectorAll('a, .cta, button, .fan-card, .showcase-item').forEach(el=>{
    el.addEventListener('mouseenter', ()=> cursor.classList.add('is-active'));
    el.addEventListener('mouseleave', ()=> cursor.classList.remove('is-active'));
  });

  function frame(){
    if(performance.now() - lastMoveTime > IDLE_MS){
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
