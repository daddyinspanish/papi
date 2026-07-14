/* ===================================================================
   Papi — loading screen
   Stage 1: the four letters land one at a time — P, then A, then P,
   then I — into a 2x2 square.
   Stage 2: the letters fade and four colored tiles build the same
   2x2 formation, one at a time.
   Stage 3: the whole loader dissolves smoothly into the hero — no
   drag/FLIP into the wordmark, it just fades in on its own.
=================================================================== */
(function(){
  const loader   = document.getElementById('loader');
  const lettersEl= document.getElementById('loaderLetters');
  const letters  = Array.from(lettersEl.querySelectorAll('.letter'));
  const squaresEl= document.getElementById('loaderSquares');
  const squares  = Array.from(squaresEl.querySelectorAll('.sq'));
  const hero     = document.getElementById('hero');
  const brandMark= document.getElementById('brandMark');
  const body     = document.body;

  const EASE = 'cubic-bezier(.16,1,.3,1)';
  const STEP = 420;   // ms between each letter landing
  const LAND = 620;   // ms for a single letter's land animation
  const SQ_STEP = 260; // ms between each square appearing
  const SQ_LAND = 480; // ms for a single square's reveal

  // a dedicated neon set just for the loader tiles — brighter and more
  // saturated than the site's muted brand palette (window.Papi.palette,
  // used everywhere else) on purpose: this is a brief, playful flourish,
  // not the main brand accent
  const palette = [[255,200,40],[255,45,149],[45,226,230],[123,255,60]];

  letters.forEach((el)=>{
    el.style.transform = 'translateY(28px) scale(.4)';
    el.style.filter = 'blur(10px)';
    el.style.opacity = '0';
  });
  squares.forEach((el, i)=>{
    const c = palette[i % palette.length];
    const light = `rgb(${Math.min(255,c[0]+40)},${Math.min(255,c[1]+40)},${Math.min(255,c[2]+40)})`;
    const dark = `rgb(${Math.max(0,c[0]-30)},${Math.max(0,c[1]-30)},${Math.max(0,c[2]-30)})`;
    el.style.background = `linear-gradient(150deg, ${light}, rgb(${c[0]},${c[1]},${c[2]}) 55%, ${dark})`;
    el.style.setProperty('--sq-glow', `rgba(${c[0]},${c[1]},${c[2]},.55)`);
  });

  function playLetters(){
    letters.forEach((el, i)=>{
      setTimeout(()=>{
        el.style.transition = `transform ${LAND}ms ${EASE}, opacity .4s ease, filter .5s ease`;
        el.style.transform = 'translateY(0) scale(1)';
        el.style.filter = 'blur(0px)';
        el.style.opacity = '1';
      }, i * STEP);
    });
  }

  function playSquares(){
    // letters step aside for the square formation
    lettersEl.style.transition = 'opacity .4s ease';
    lettersEl.style.opacity = '0';

    squares.forEach((el, i)=>{
      setTimeout(()=>{
        el.style.opacity = '1';
        el.style.transform = 'scale(1) rotate(0deg) rotateY(0deg)';
      }, 250 + i * SQ_STEP);
    });
  }

  function start(){
    playLetters();
    const lastLetterLandsAt = (letters.length - 1) * STEP + LAND;

    setTimeout(playSquares, lastLetterLandsAt + 500);

    const lastSquareLandsAt = 250 + (squares.length - 1) * SQ_STEP + SQ_LAND;
    setTimeout(exitLoader, lastLetterLandsAt + 500 + lastSquareLandsAt + 550);
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
