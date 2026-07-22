/* ===================================================================
   Papi — Process Hero interactions
   Three independent jobs, kept in one file since they all share the
   same hero markup:
   1. The 4-step reveal panel — click a hotspot, its own radial
      gradient + copy fades in (anchored at that exact hotspot);
      the shared .process-hero-title dissolves out while it's open
      and glitches back in once it's dismissed. Also handles the
      "line that loads as you click, unlocks the CTA" mechanic (see
      markLoaded() below).
   2. Smooth-scrolling for both hero CTAs, replacing the browser's
      own instant anchor-jump with a real scrollIntoView so it reads
      as a natural, eased scroll rather than a snap.
=================================================================== */
(function(){
  const hero = document.querySelector('.process-hero');
  if(!hero) return;

  const hotspots = Array.from(hero.querySelectorAll('.process-hotspot'));

  // ===================================================================
  // 1. reveal panel + headline dissolve/glitch
  // ===================================================================
  const reveal = document.getElementById('processReveal');
  const revealIndex = document.getElementById('processRevealIndex');
  const revealTitle = document.getElementById('processRevealTitle');
  const revealText = document.getElementById('processRevealText');
  const heroTitle = hero.querySelector('.process-hero-title');
  const heroHint = hero.querySelector('.process-hero-hint');

  // per direct request: "make sure the steps do not come out as
  // double digits" — single digit (1/2/3/4), not the old zero-padded
  // 01/02/03/04
  const STEPS = {
    discover: {
      index: '1',
      title: 'Discover',
      text: 'We start by learning your business inside and out — your goals, your customers, what’s working and what isn’t.',
    },
    steps: {
      index: '2',
      title: 'Steps',
      text: 'A clear, honest roadmap from first sketch to final launch, so you always know exactly what happens next.',
    },
    structure: {
      index: '3',
      title: 'Structure',
      text: 'Real, considered architecture beneath every page — built to hold up as your business grows, not just look good on day one.',
    },
    delivery: {
      index: '4',
      title: 'Delivery',
      text: 'A finished site that’s fast, easy to manage, and ready to start bringing in business from day one.',
    },
  };

  // per direct request: "have number 1 bigger in pulsing, and then
  // switch the bigger pulsing to every other number as they interact"
  // — exactly one hotspot carries the bigger/faster "is-emphasized"
  // pulse at a time (see its own keyframes in style.css), starting at
  // #1 (discover, the first hotspot in DOM order) so a first-time
  // visitor has an obvious "start here" cue instead of 4 identical
  // dots. Advances to the next hotspot in sequence every time ANY step
  // is opened, so the cue keeps walking 1→2→3→4→1... as they explore,
  // rather than staying stuck highlighting whichever one they already
  // used.
  let emphasisIndex = 0;
  function updateEmphasis(){
    hotspots.forEach((h, i) => h.classList.toggle('is-emphasized', i === emphasisIndex));
  }
  updateEmphasis();

  // per direct request: "have them in a line, that loads every time you
  // click on one, until the last one loads the website then releases
  // the view our work button" — completedSteps tracks distinct steps
  // ever opened (a Set, so re-opening one doesn't double-count); each
  // new one grows .process-hotspot-track-fill by another quarter, and
  // marks that dot permanently "loaded" (gold fill + checkmark). Once
  // all 4 are in, the CTA's own .is-locked class lifts.
  const completedSteps = new Set();
  const trackFill = document.getElementById('processTrackFill');
  const cta = document.getElementById('processHeroCta');

  function markLoaded(key, hotspotEl){
    if(completedSteps.has(key)) return;
    completedSteps.add(key);
    hotspotEl.classList.add('is-loaded');
    const numEl = hotspotEl.querySelector('.process-hotspot-number');
    if(numEl) numEl.textContent = '✓';
    if(trackFill) trackFill.style.transform = `scaleX(${completedSteps.size / hotspots.length})`;
    if(completedSteps.size >= hotspots.length && cta && cta.classList.contains('is-locked')){
      cta.classList.remove('is-locked');
      cta.classList.add('is-unlocked');
    }
  }
  // blocks the locked CTA from firing on click OR keyboard Enter —
  // pointer-events:none in the CSS already stops a mouse click, but a
  // focused <a> still activates on Enter regardless of pointer-events,
  // so this guard is what actually closes that gap. Registered before
  // bindSmoothScroll's own click listener further down (same element),
  // so stopImmediatePropagation here also blocks that handler from
  // ever firing while still locked.
  if(cta){
    cta.addEventListener('click', (e) => {
      if(cta.classList.contains('is-locked')){
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    });
  }

  // per direct request: "a different glitch form after every step, to
  // add style" — 4 distinct keyframe variants live in style.css
  // (.is-glitch-a/-b/-c/-d, each pointing at its own @keyframes);
  // cycles through them in sequence rather than always replaying the
  // same one, same cyclic-index pattern as updateEmphasis() above
  const GLITCH_VARIANTS = ['is-glitch-a', 'is-glitch-b', 'is-glitch-c', 'is-glitch-d'];
  let glitchVariantIndex = 0;

  let activeKey = null;
  let glitchTimeout = null;

  function showStep(key, hotspotEl){
    const data = STEPS[key];
    if(!data || !reveal) return;
    // live position instead of a cached dataset value — cheap enough
    // to compute on every click, and removes any need to keep a
    // separate resize listener in sync with it
    const heroRect = hero.getBoundingClientRect();
    const dotEl = hotspotEl.querySelector('.process-hotspot-dot') || hotspotEl;
    const dotRect = dotEl.getBoundingClientRect();
    reveal.style.setProperty('--reveal-x', `${dotRect.left + dotRect.width / 2 - heroRect.left}px`);
    reveal.style.setProperty('--reveal-y', `${dotRect.top + dotRect.height / 2 - heroRect.top}px`);

    markLoaded(key, hotspotEl);

    revealIndex.textContent = data.index;
    revealTitle.textContent = data.title;
    revealText.textContent = data.text;

    hotspots.forEach(h => h.classList.toggle('is-active', h === hotspotEl));
    reveal.classList.add('is-visible');
    reveal.setAttribute('aria-hidden', 'false');
    activeKey = key;

    // per direct request: "dissolve the title" while a step is open —
    // clears any glitch-back-in still mid-flight from a rapid re-click
    if(heroTitle){
      clearTimeout(glitchTimeout);
      heroTitle.classList.remove('is-glitching-in');
      heroTitle.classList.add('is-dissolved');
    }
    // per direct request: "once touched it fades away" — the "Touch Dot
    // to Interact" hint has done its job the moment someone actually
    // opens a step, so it steps out of the way alongside the title
    if(heroHint) heroHint.classList.add('is-hidden');

    // move the "bigger pulsing" cue on to the next number in sequence
    emphasisIndex = (emphasisIndex + 1) % hotspots.length;
    updateEmphasis();
  }

  function hideReveal(){
    if(!reveal) return;
    reveal.classList.remove('is-visible');
    reveal.setAttribute('aria-hidden', 'true');
    hotspots.forEach(h => h.classList.remove('is-active'));
    activeKey = null;

    // per direct request: "make it glitch appear back when someone
    // clicks out of the step" — swaps straight from fully-dissolved to
    // the glitch keyframes (see style.css's own
    // processHeroTitleGlitchIn), which starts from the same invisible
    // state rather than double-animating a plain fade-in underneath it
    if(heroTitle){
      heroTitle.classList.remove('is-dissolved');
      // clear whichever variant (if any) is still on from a previous
      // run before forcing the reflow below, so a rapid re-open/close
      // can't leave two variant classes stacked on the element at once
      GLITCH_VARIANTS.forEach(v => heroTitle.classList.remove(v));
      // force a reflow between removing/re-adding the class so the
      // animation restarts even if it's re-triggered before the
      // previous run finished (rapid open/close) — reading offsetWidth
      // is the standard, side-effect-free way to force this
      void heroTitle.offsetWidth;
      const variant = GLITCH_VARIANTS[glitchVariantIndex];
      glitchVariantIndex = (glitchVariantIndex + 1) % GLITCH_VARIANTS.length;
      heroTitle.classList.add('is-glitching-in', variant);
      clearTimeout(glitchTimeout);
      glitchTimeout = setTimeout(() => heroTitle.classList.remove('is-glitching-in', variant), 650);
    }
    // per direct request: "when they leave out of step, it fades back
    // in" — plain fade, no glitch (that's the title's own distinct
    // treatment), matching the hint's own simple fade-out on open
    if(heroHint) heroHint.classList.remove('is-hidden');
  }

  if(reveal && hotspots.length){
    hotspots.forEach(hotspot => {
      const key = hotspot.dataset.step;
      hotspot.addEventListener('click', () => {
        if(activeKey === key){ hideReveal(); return; }
        showStep(key, hotspot);
      });
    });

    reveal.addEventListener('click', (e) => {
      if(e.target === reveal) hideReveal();
    });
    const closeBtn = reveal.querySelector('.process-reveal-close');
    if(closeBtn) closeBtn.addEventListener('click', hideReveal);

    document.addEventListener('keydown', (e) => {
      if(e.key === 'Escape' && activeKey) hideReveal();
    });
  }

  // ===================================================================
  // 2. smooth-scrolling hero CTAs (per direct request: "when we scroll
  // on the start a project can we slowly scroll... and not just snap
  // them", "when we click show our work are you able to stick scroll
  // into the live demo section, just like ... scrolling ... naturally")
  // — a plain <a href="#section"> jumps instantly with no sitewide
  // smooth-scroll CSS enabled (see this site's own established
  // convention of doing this per-link via scrollIntoView rather than a
  // global scroll-behavior, e.g. the old process-room's own neon quick
  // nav); this matches that same pattern for both hero CTAs
  // ===================================================================
  function bindSmoothScroll(selector){
    const link = hero.querySelector(selector);
    if(!link) return;
    link.addEventListener('click', (e) => {
      const targetId = link.getAttribute('href');
      const target = targetId && document.querySelector(targetId);
      if(!target) return; // fall back to the plain anchor jump
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
  bindSmoothScroll('.process-hero-cta');
  bindSmoothScroll('.process-hero-start');

  // ===================================================================
  // 3. pause the hotspot dots' pulse once the hero scrolls out of view
  // ===================================================================
  // per direct request: "make the dots stop pulsing when the viewer is
  // in section 2, and when they get back to section 1 they start
  // glowing again" — style.css's own processHotspotPulse keyframe runs
  // "infinite" with nothing to ever stop it, so it kept animating
  // (box-shadow, which forces a repaint each cycle) for the rest of the
  // session even once the hero itself was long scrolled past. Toggling
  // one class here — driven by real intersection, not a viewport-size
  // media query — is what makes this apply identically on desktop and
  // mobile, matching the exact same off-screen-pause treatment already
  // applied to the hero's own WebGL canvas (js/process-hero-slime.js).
  if('IntersectionObserver' in window){
    const heroVisibilityIO = new IntersectionObserver((entries) => {
      hero.classList.toggle('is-scrolled-away', !entries[0].isIntersecting);
    }, { threshold: 0 });
    heroVisibilityIO.observe(hero);
  }
})();
