/* ===================================================================
   Papi — loading screen
   The wordmark rises into place, then fills from white to gold (a
   hard-edged two-tone gradient sliding across via background-position
   — like it's being poured full of light), then the loader dissolves
   straight into the hero.
=================================================================== */
(function(){
  const loader = document.getElementById('loader');
  const word   = document.getElementById('loaderWord');
  const hero   = document.getElementById('hero');
  const brandMark = document.getElementById('brandMark');
  const body   = document.body;

  const RISE_MS = 700;   // the word settling into place
  const FILL_DELAY = 300; // the gold fill starts a little before the rise finishes
  const FILL_MS = 900;   // how long the white-to-gold fill takes
  const HOLD_MS = 500;   // a beat to look at the finished gold wordmark before exiting

  function start(){
    word.style.transition = `opacity ${RISE_MS}ms ease, transform ${RISE_MS}ms cubic-bezier(.16,1,.3,1)`;
    word.style.opacity = '1';
    word.style.transform = 'translate(-50%,-50%)';

    setTimeout(()=>{
      word.style.transition = `background-position ${FILL_MS}ms cubic-bezier(.65,0,.35,1)`;
      word.style.backgroundPosition = '0% 0';
    }, FILL_DELAY);

    setTimeout(exitLoader, FILL_DELAY + FILL_MS + HOLD_MS);
  }

  function exitLoader(){
    hero.classList.add('is-visible');
    hero.removeAttribute('aria-hidden');
    brandMark.querySelectorAll('span').forEach(s => s.style.opacity = '1');
    if(window.Papi && window.Papi.revealTitle) window.Papi.revealTitle();
    if(window.Papi && window.Papi.revealCursor) window.Papi.revealCursor();
    if(window.Papi && window.Papi.revealField) window.Papi.revealField();
    setTimeout(()=>{
      if(window.Papi && window.Papi.revealCta) window.Papi.revealCta();
    }, 550);
    setTimeout(()=>{
      if(window.Papi && window.Papi.revealSubtitle) window.Papi.revealSubtitle();
    }, 750);

    loader.classList.add('is-done');
    loader.style.transition = 'opacity 1.3s ease';
    loader.style.opacity = '0';

    setTimeout(()=>{
      loader.style.display = 'none';
      body.classList.remove('no-scroll');
      document.documentElement.classList.remove('no-scroll');
      if(window.Papi && window.Papi.resizeField) window.Papi.resizeField();
    }, 1400);
  }

  // wait for the display font to be ready (with a safety timeout) before
  // starting the reveal, so the wordmark doesn't pop from a fallback font
  const fontsReady = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
  const safety = new Promise(res => setTimeout(res, 900));
  Promise.race([fontsReady, safety]).then(start);
})();
