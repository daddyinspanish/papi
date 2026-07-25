/* ===================================================================
   Papi — page init
   No loading screen: the hero is revealed as soon as the display font
   is ready (with a safety timeout, in case the font takes unusually
   long or fails to load), rather than gating the whole page behind
   anything first.

   #hero's own opacity:0 (see its CSS) makes it a CSS containing block
   for any position:fixed descendant — js/scroll-journey-hero.js's GSAP
   pin on .process-hero is exactly that, created earlier in script
   order, before this file runs. Flipping #hero to opacity:1 here
   changes that containing block out from under an already-created
   fixed pin, so ScrollTrigger.refresh() re-anchors it to the real
   viewport right after.
=================================================================== */
(function(){
  const hero = document.getElementById('hero');

  function start(){
    hero.classList.add('is-visible');
    hero.removeAttribute('aria-hidden');

    // the "PAPI" brand mark (top-left) is revealed immediately.
    const brandMark = document.getElementById('brandMark');
    if(brandMark) brandMark.querySelectorAll('span').forEach(s => s.style.opacity = '1');

    if(window.Papi && window.Papi.revealSocial) window.Papi.revealSocial();
    if(window.Papi && window.Papi.revealCursor) window.Papi.revealCursor();
    if(window.ScrollTrigger) window.ScrollTrigger.refresh();
  }

  const fontsReady = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
  const safety = new Promise(res => setTimeout(res, 900));
  Promise.race([fontsReady, safety]).then(start);
})();
