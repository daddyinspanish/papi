/* ===================================================================
   Papi — "How content strategy works" steps (#csTimeline)
   Same scroll-driven motion as the "How it's built" steps (see
   js/process-hero.js), per direct request to give the new steps the same
   immersive feel:

     - a bright line fills down the dotted track as you scroll
       (--cs-progress)
     - each number pops to life the moment the line reaches it, and stays
       lit (cumulative, so scrolling back up reverses it cleanly)
     - only the CURRENT step's card is lifted; it settles back when the
       next step takes over
     - each step slides in from its own side the first time it scrolls
       into view

   Everything is a pure function of scroll position, so it is reversible.
   Reduced motion: states still update, but the CSS removes the animations
   and the slide-in.
=================================================================== */
(function(){
  const timeline = document.getElementById('csTimeline');
  if(!timeline) return;
  const steps = Array.from(timeline.querySelectorAll('.cs-step'));
  const nums = steps.map((s) => s.querySelector('.cs-num'));
  const cards = steps.map((s) => s.querySelector('.cs-card'));
  if(!steps.length) return;

  const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  const fill = document.createElement('div');
  fill.className = 'cs-fill';
  fill.setAttribute('aria-hidden', 'true');
  timeline.appendChild(fill);

  // ---- slide-in entrance, once per step
  if('IntersectionObserver' in window && !reduceMotion){
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if(!e.isIntersecting) return;
        e.target.classList.add('is-in');
        io.unobserve(e.target);
      });
    }, { threshold: 0.25, rootMargin: '0px 0px -8% 0px' });
    steps.forEach((s) => io.observe(s));
  } else {
    steps.forEach((s) => s.classList.add('is-in'));
  }

  // ---- scroll-driven fill / numbers / current card
  let ticking = false;
  function update(){
    ticking = false;
    const rect = timeline.getBoundingClientRect();
    if(!rect.height) return;
    // a touch below the middle of the screen: a number lighting just before
    // it is centered reads as responsive rather than late (same as the steps above)
    const referenceY = window.innerHeight * 0.6;
    const progress = Math.max(0, Math.min(1, (referenceY - rect.top) / rect.height));
    timeline.style.setProperty('--cs-progress', progress.toFixed(4));

    let current = -1;
    nums.forEach((num, i) => {
      const nr = num.getBoundingClientRect();
      const centerY = (nr.top + nr.height / 2) - rect.top;
      const lit = progress >= centerY / rect.height;
      num.classList.toggle('is-active', lit);
      if(lit) current = i;
    });
    cards.forEach((card, i) => card.classList.toggle('is-active', i === current));

    // the connected-dot sphere behind the steps (js/strategy-ball.js): it forms
    // as the line fills (finished just before the last number). It stays
    // centered on the line and simply follows you down the list.
    if(window.PapiStrategyBall){
      window.PapiStrategyBall.setProgress(progress / 0.92);
      window.PapiStrategyBall.redraw();
    }
  }
  function requestUpdate(){
    if(ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  }
  window.addEventListener('scroll', requestUpdate, { passive: true });
  let lastW = window.innerWidth;
  window.addEventListener('resize', () => {
    const w = window.innerWidth;
    if(Math.abs(w - lastW) <= 10) return; // ignore mobile toolbar resizes
    lastW = w;
    requestUpdate();
  });
  update();

  // the fill's glow pulses forever — pause it while the timeline is off-screen
  if('IntersectionObserver' in window){
    new IntersectionObserver((entries) => {
      timeline.classList.toggle('is-idle', !entries[0].isIntersecting);
    }, { threshold: 0, rootMargin: '120px 0px' }).observe(timeline);
  }
})();
