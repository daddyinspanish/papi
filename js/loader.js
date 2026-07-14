/* ===================================================================
   Papi — loading screen
   The wordmark rises into place, its letters fading in one after
   another, then a gold fill pours through those same letters left to
   right (each letter's own color transitioning, staggered, rather
   than one gradient sliding across the whole word — simpler, and it
   still reads as light pouring through), then the loader dissolves
   straight into the hero.
=================================================================== */
(function(){
  const loader = document.getElementById('loader');
  const word   = document.getElementById('loaderWord');
  const hero   = document.getElementById('hero');
  const brandMark = document.getElementById('brandMark');
  const body   = document.body;

  const RISE_MS = 550;        // the word settling into place
  const LETTER_STAGGER = 60;  // ms between each letter starting its own fade-in
  const LETTER_FADE_MS = 420; // how long each letter's own fade-in takes
  const FILL_GAP = 180;       // pause after the last letter's fade-in before the gold fill starts
  const FILL_STAGGER = 55;    // ms between each letter starting its own color fill
  const FILL_MS = 320;        // how long each letter's own color fill takes
  const HOLD_MS = 500;        // a beat to look at the finished gold wordmark before exiting

  const letters = Array.from(word.textContent).map(ch=>{
    const span = document.createElement('span');
    span.className = 'loader-letter';
    span.textContent = ch;
    return span;
  });
  word.innerHTML = '';
  letters.forEach(l => word.appendChild(l));
  const n = letters.length;

  function start(){
    word.style.transition = `opacity ${RISE_MS}ms ease, transform ${RISE_MS}ms cubic-bezier(.16,1,.3,1)`;
    word.style.opacity = '1';
    word.style.transform = 'translate(-50%,-50%)';

    letters.forEach((l, i)=>{
      setTimeout(()=>{
        l.style.transition = `opacity ${LETTER_FADE_MS}ms ease, transform ${LETTER_FADE_MS}ms cubic-bezier(.16,1,.3,1)`;
        l.style.opacity = '1';
        l.style.transform = 'translateY(0)';
      }, i * LETTER_STAGGER);
    });

    const fillStart = (n - 1) * LETTER_STAGGER + LETTER_FADE_MS + FILL_GAP;
    letters.forEach((l, i)=>{
      setTimeout(()=>{
        l.style.transition = `color ${FILL_MS}ms ease`;
        l.style.color = '#ffd23f';
      }, fillStart + i * FILL_STAGGER);
    });

    const fillEnd = fillStart + (n - 1) * FILL_STAGGER + FILL_MS;
    setTimeout(exitLoader, fillEnd + HOLD_MS);
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
