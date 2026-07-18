/* ===================================================================
   Papi — page init
   No loading screen: the hero and its liquid field are revealed as
   soon as the display font is ready (with a safety timeout, in case
   the font takes unusually long or fails to load), rather than gating
   the whole page behind an animated wordmark first. Replaces the old
   loader.js, which used to trigger this same reveal only once its own
   multi-second animation had finished playing.
=================================================================== */
(function(){
  const hero = document.getElementById('hero');

  function start(){
    hero.classList.add('is-visible');
    hero.removeAttribute('aria-hidden');

    // the "PAPI" brand mark (top-right) and the big centre "Papi" word
    // are both on screen at once, permanently, now that the hero no
    // longer fades one out in favor of the other — nothing to defer.
    const brandMark = document.getElementById('brandMark');
    if(brandMark) brandMark.querySelectorAll('span').forEach(s => s.style.opacity = '1');

    if(window.Papi && window.Papi.revealFlow) window.Papi.revealFlow();
    if(window.Papi && window.Papi.revealSocial) window.Papi.revealSocial();
    if(window.Papi && window.Papi.revealCursor) window.Papi.revealCursor();
    if(window.Papi && window.Papi.revealField) window.Papi.revealField();
    if(window.Papi && window.Papi.resizeField) window.Papi.resizeField();
  }

  // hero-slime.js is loaded as a module (see index.html), which — unlike
  // this plain script — is deferred: it doesn't actually execute until
  // the whole document has finished parsing, slightly AFTER this script
  // itself already ran. window.Papi.revealField (defined there) can
  // therefore still be missing at the exact instant fontsReady/safety
  // below resolves, especially since document.fonts.ready has a real,
  // observed tendency to resolve almost immediately when nothing has
  // actually requested a font yet — the previous loading-screen version
  // of this reveal never hit this race only because its own multi-
  // second wordmark animation happened to run long enough to cover for
  // it by accident, not because the ordering was actually safe. Waiting
  // (briefly, polled) for revealField to actually exist before calling
  // start() closes that gap directly rather than relying on incidental
  // timing again.
  function whenFieldReady(cb){
    if(window.Papi && window.Papi.revealField){ cb(); return; }
    let waited = 0;
    const POLL_MS = 16;
    const MAX_WAIT_MS = 2000;
    const id = setInterval(()=>{
      waited += POLL_MS;
      if((window.Papi && window.Papi.revealField) || waited >= MAX_WAIT_MS){
        clearInterval(id);
        cb();
      }
    }, POLL_MS);
  }

  const fontsReady = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
  const safety = new Promise(res => setTimeout(res, 900));
  Promise.race([fontsReady, safety]).then(()=> whenFieldReady(start));
})();
