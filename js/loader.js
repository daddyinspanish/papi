/* ===================================================================
   Papi — loading screen
   The four letters — P, then A, then P, then I — land one at a time,
   each filling with a sweep of gold light as it lands (a shimmering
   ray passing through, left dark-gold behind it, brighter gold ahead
   of it). No separate tile-building stage — once the letters have
   filled in, the loader dissolves straight into the hero.
=================================================================== */
(function(){
  const loader   = document.getElementById('loader');
  const lettersEl= document.getElementById('loaderLetters');
  const letters  = Array.from(lettersEl.querySelectorAll('.letter'));
  const hero     = document.getElementById('hero');
  const brandMark= document.getElementById('brandMark');
  const body     = document.body;

  const EASE = 'cubic-bezier(.16,1,.3,1)';
  const STEP = 420;    // ms between each letter landing
  const LAND = 620;    // ms for a single letter's land animation
  const RAY_TAIL = 350; // how much longer the gold sweep runs past the landing itself

  letters.forEach((el)=>{
    el.style.transform = 'translateY(28px) scale(.4)';
    el.style.filter = 'blur(10px)';
    el.style.opacity = '0';
    el.style.backgroundPosition = '180% 0';
  });

  function playLetters(){
    letters.forEach((el, i)=>{
      setTimeout(()=>{
        el.style.transition = `transform ${LAND}ms ${EASE}, opacity .4s ease, filter .5s ease, background-position ${LAND + RAY_TAIL}ms ${EASE}`;
        el.style.transform = 'translateY(0) scale(1)';
        el.style.filter = 'blur(0px)';
        el.style.opacity = '1';
        el.style.backgroundPosition = '-80% 0';
      }, i * STEP);
    });
  }

  function start(){
    playLetters();
    const lastLetterLandsAt = (letters.length - 1) * STEP + LAND + RAY_TAIL;
    setTimeout(exitLoader, lastLetterLandsAt + 500);
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
  // starting the reveal, so letters don't pop from a fallback font
  const fontsReady = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
  const safety = new Promise(res => setTimeout(res, 900));
  Promise.race([fontsReady, safety]).then(start);
})();
