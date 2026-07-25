/* ===================================================================
   Papi — page init
   No loading screen: the hero is revealed as soon as the display font
   is ready (with a safety timeout, in case the font takes unusually
   long or fails to load), rather than gating the whole page behind an
   animated wordmark first. Replaces the old loader.js, which used to
   trigger this same reveal only once its own multi-second animation
   had finished playing.

   BUG FIX: per the recurring "page goes black after clicking Enter"
   reports — this file predates js/loader-gate.js's sound-consent gate
   and was never reconciled with it: it still reveals #hero completely
   independently, at fonts-ready or a 900ms safety timeout, regardless
   of whether the loader is even on screen yet. Since most visitors
   take longer than 900ms to read the loader and choose, this fires
   BEFORE the click in the common case, not the rare one. #hero's own
   opacity:0 (see its CSS) makes it a CSS containing block for any
   position:fixed descendant — and js/scroll-journey-hero.js's GSAP pin
   on .process-hero is exactly that, created earlier in script order,
   before this file runs. Flipping #hero to opacity:1 here changes that
   containing block out from under an already-created fixed pin,
   without ever calling ScrollTrigger.refresh() to let GSAP re-anchor
   to the real viewport afterward — only loader-gate.js's OWN dismiss()
   does that, and by the time it runs the pin may already be measuring
   against a stale reference frame. Gating this behind the loader's own
   dismissed state removes the race instead of patching around it: this
   now only ever fires early if there's no loader on the page at all
   (or it's already been dismissed), so the one path that changes
   #hero's opacity while a pin can be listening for it is the one path
   that already calls refresh() afterward.
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
  }

  function armStart(){
    const fontsReady = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
    const safety = new Promise(res => setTimeout(res, 900));
    Promise.race([fontsReady, safety]).then(start);
  }

  const loaderEl = document.getElementById('papiLoader');
  if(loaderEl && !loaderEl.classList.contains('is-dismissed')){
    document.addEventListener('papi:enter', armStart, { once: true });
  } else {
    armStart();
  }
})();
