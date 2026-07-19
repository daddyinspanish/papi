/* ===================================================================
   Papi — page init
   No loading screen: the hero is revealed as soon as the display font
   is ready (with a safety timeout, in case the font takes unusually
   long or fails to load), rather than gating the whole page behind an
   animated wordmark first. Replaces the old loader.js, which used to
   trigger this same reveal only once its own multi-second animation
   had finished playing.
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

  const fontsReady = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
  const safety = new Promise(res => setTimeout(res, 900));
  Promise.race([fontsReady, safety]).then(start);
})();
