/* ===================================================================
   Papi — hero title rotator
   Per direct request, "animate in loop from Building websites for
   businesses, to also say creating content for business, similar to the
   way the words change in the title of dentalscale.com": the first part
   of the hero title rolls up out of view while the next phrase rolls up
   into its place, then loops. "for Businesses." never moves — the
   rotating slot simply eases to the width of whichever phrase is showing,
   so the static words glide to their new position instead of jumping.

   Markup (index.html): .hero-rot > .hero-rot-phrase (first one carries
   .is-active). To add a phrase, add another .hero-rot-phrase span.

   It deliberately stands down when it would fight another effect:
   - reduced motion: no rotation at all (first phrase stays).
   - once the visitor scrolls into the hero's dissolve (scrollY > 60) it
     pauses and un-clips the slot, so js/scroll-journey-hero.js's
     falling-letters glitch can fall past the slot's edge instead of being
     cut off by it.
   - off-screen / backgrounded tab: paused.
   Dispatches `papi:herotitle` after each change so js/hero-letter-fx.js
   re-measures where the letters now are.
=================================================================== */
(function(){
  const rot = document.querySelector('.hero-rot');
  if(!rot) return;
  const phrases = Array.from(rot.querySelectorAll('.hero-rot-phrase'));
  if(phrases.length < 2) return;

  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const HOLD_MS = 3200;   // how long each phrase stays up
  const ROLL_MS = 800;    // matches the CSS transition (.75s) + a little

  let current = 0;
  let widths = [];

  const title = rot.closest('.process-hero-title');
  const rest = title && title.querySelector('.hero-title-rest');

  function measure(){
    // absolutely-positioned phrases shrink-wrap, so offsetWidth is each one's natural width
    widths = phrases.map((p) => p.offsetWidth);
    rot.style.width = widths[current] + 'px';
    // does the widest phrase + "for Businesses." fit on ONE line? If not,
    // stack the rotating part on its own line for every phrase, so the
    // number of lines never changes (and nothing jumps) as it rotates.
    if(title && rest){
      const cs = getComputedStyle(title);
      const maxW = parseFloat(cs.maxWidth);
      // measured from the hero section itself, NOT the title's own parent:
      // that wrapper shrink-wraps its content, so using it would make the
      // answer depend on whether we're already stacked (and never recover)
      const copy = title.parentElement;
      const copyCs = getComputedStyle(copy);
      const heroW = (rot.closest('.process-hero') || copy).clientWidth;
      const parentW = heroW - parseFloat(copyCs.paddingLeft || 0) - parseFloat(copyCs.paddingRight || 0);
      const avail = Math.min(isNaN(maxW) ? Infinity : maxW, parentW);
      const space = parseFloat(cs.fontSize) * 0.3;
      rot.classList.toggle('is-stacked', Math.max.apply(null, widths) + space + rest.offsetWidth > avail);
    }
  }

  function ready(){
    rot.classList.add('is-ready');
    measure();
    window.dispatchEvent(new Event('papi:herotitle'));
    if(reduceMotion) return;
    window.addEventListener('resize', () => { measure(); });
    schedule();
  }

  let visible = true;
  if('IntersectionObserver' in window){
    new IntersectionObserver((e) => { visible = e[0].isIntersecting; }, { threshold: 0 }).observe(rot);
  }
  window.addEventListener('scroll', () => {
    rot.classList.toggle('is-static', window.scrollY > 60);
  }, { passive: true });

  const paused = () => document.hidden || !visible || window.scrollY > 60;

  function roll(){
    const next = (current + 1) % phrases.length;
    const cur = phrases[current], nxt = phrases[next];
    rot.style.width = widths[next] + 'px';
    cur.classList.remove('is-active');
    cur.classList.add('is-leaving');
    cur.setAttribute('aria-hidden', 'true');
    nxt.classList.add('is-active');
    nxt.removeAttribute('aria-hidden');
    current = next;
    setTimeout(() => {
      // park the old phrase back below the slot with no transition, so it
      // doesn't visibly slide through the window on its way there
      cur.classList.add('is-reset');
      cur.classList.remove('is-leaving');
      void cur.offsetWidth;
      cur.classList.remove('is-reset');
      window.dispatchEvent(new Event('papi:herotitle'));
    }, ROLL_MS);
  }

  function schedule(){
    setTimeout(() => {
      if(!paused()) roll();
      schedule();
    }, HOLD_MS + ROLL_MS);
  }

  // widths depend on the webfont, so wait for it before measuring
  if(document.fonts && document.fonts.ready) document.fonts.ready.then(ready);
  else window.addEventListener('load', ready);
})();
