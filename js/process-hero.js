/* ===================================================================
   Papi — Process Hero + Our Process interactions
   Three independent jobs, kept in one file since they used to share
   one markup block (now split across two sections — see each job's
   own comment for which root element it actually targets):
   1. The 4-step reveal panel — click a hotspot, its own radial
      gradient + copy fades in (anchored at that exact hotspot);
      the hero's own .process-hero-title dissolves out while it's open
      and glitches back in once it's dismissed. Per direct request
      ("move the Step process right after the live Demo"), the dots/
      reveal panel now live in their own #ourProcessSection further
      down the page rather than inside the hero — this still reaches
      into the hero just to dissolve/glitch its title, everything else
      here targets stepsSection instead.
   2. Smooth-scrolling for both hero CTAs, replacing the browser's
      own instant anchor-jump with a real scrollIntoView so it reads
      as a natural, eased scroll rather than a snap.
   3. Pausing the hotspot dots' pulse once #ourProcessSection scrolls
      out of view.
=================================================================== */
(function(){
  const hero = document.querySelector('.process-hero');
  const stepsSection = document.querySelector('.our-process-section');
  if(!hero && !stepsSection) return;

  const hotspots = stepsSection ? Array.from(stepsSection.querySelectorAll('.process-hotspot')) : [];

  // ===================================================================
  // 1. reveal panel + headline dissolve/glitch
  // ===================================================================
  const reveal = document.getElementById('processReveal');
  const revealIndex = document.getElementById('processRevealIndex');
  const revealTitle = document.getElementById('processRevealTitle');
  const revealText = document.getElementById('processRevealText');
  const heroTitle = hero ? hero.querySelector('.process-hero-title') : null;

  const revealIcon = document.getElementById('processRevealIcon');
  const revealContent = document.getElementById('processRevealContent');

  // per direct request: "make sure the steps do not come out as
  // double digits" — single digit (1/2/3/4), not the old zero-padded
  // 01/02/03/04. Per a later direct request ("add icons to the
  // steps, to show more life") each step also carries its own inline-
  // SVG inner markup (no outer <svg> tag — that shell already exists
  // once in the HTML at #processRevealIcon, this just swaps its
  // innerHTML) rather than 4 separate <svg> elements toggled with
  // CSS, so there's only ever one icon in the DOM to animate/measure.
  const STEPS = {
    discover: {
      index: '1',
      title: 'Discover',
      text: 'We start by learning your business inside and out — your goals, your customers, what’s working and what isn’t.',
      icon: '<circle cx="10" cy="10" r="6"/><line x1="14.5" y1="14.5" x2="20" y2="20"/>',
    },
    steps: {
      index: '2',
      title: 'Steps',
      text: 'A clear, honest roadmap from first sketch to final launch, so you always know exactly what happens next.',
      icon: '<path d="M4 20v-4h4v-4h4v-4h4v-4h4"/>',
    },
    structure: {
      index: '3',
      title: 'Structure',
      text: 'Real, considered architecture beneath every page — built to hold up as your business grows, not just look good on day one.',
      icon: '<rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.2"/><rect x="13" y="3.5" width="7.5" height="7.5" rx="1.2"/><rect x="3.5" y="13" width="7.5" height="7.5" rx="1.2"/><rect x="13" y="13" width="7.5" height="7.5" rx="1.2"/>',
    },
    delivery: {
      index: '4',
      title: 'Delivery',
      text: 'A finished site that’s fast, easy to manage, and ready to start bringing in business from day one.',
      icon: '<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/>',
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
  // click on one" — completedSteps tracks distinct steps ever opened
  // (a Set, so re-opening one doesn't double-count); each new one
  // grows .process-hotspot-track-fill by another quarter and marks
  // that dot permanently "loaded" (gold fill + checkmark). This used
  // to also unlock the hero's own CTA once all 4 were done — per a
  // later direct request the CTA moved up into the hero and is always
  // active now, so this is purely a self-contained progress indicator,
  // no longer wired to anything outside this section.
  const completedSteps = new Set();
  const trackFill = document.getElementById('processTrackFill');

  function markLoaded(key, hotspotEl){
    if(completedSteps.has(key)) return;
    completedSteps.add(key);
    hotspotEl.classList.add('is-loaded');
    const numEl = hotspotEl.querySelector('.process-hotspot-number');
    if(numEl) numEl.textContent = '✓';
    if(trackFill) trackFill.style.transform = `scaleX(${completedSteps.size / hotspots.length})`;
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
    if(!data || !reveal || !stepsSection) return;
    // live position instead of a cached dataset value — cheap enough
    // to compute on every click, and removes any need to keep a
    // separate resize listener in sync with it
    const sectionRect = stepsSection.getBoundingClientRect();
    const dotEl = hotspotEl.querySelector('.process-hotspot-dot') || hotspotEl;
    const dotRect = dotEl.getBoundingClientRect();
    reveal.style.setProperty('--reveal-x', `${dotRect.left + dotRect.width / 2 - sectionRect.left}px`);
    reveal.style.setProperty('--reveal-y', `${dotRect.top + dotRect.height / 2 - sectionRect.top}px`);

    markLoaded(key, hotspotEl);

    revealIndex.textContent = data.index;
    revealTitle.textContent = data.title;
    revealText.textContent = data.text;
    if(revealIcon) revealIcon.innerHTML = data.icon;

    hotspots.forEach(h => h.classList.toggle('is-active', h === hotspotEl));
    reveal.classList.add('is-visible');
    reveal.setAttribute('aria-hidden', 'false');
    activeKey = key;

    // per direct request: "make the background in the process section
    // darken when the step is clicked" — dims/blurs the eyebrow/title/
    // dot-line behind the reveal overlay (on top of that overlay's own
    // radial-gradient darkening) so the open step reads as a spotlit
    // focus rather than a panel merely floating over the same content
    if(stepsSection) stepsSection.classList.add('is-active');

    // per direct request: "dissolve the title" while a step is open —
    // clears any glitch-back-in still mid-flight from a rapid re-click
    if(heroTitle){
      clearTimeout(glitchTimeout);
      heroTitle.classList.remove('is-glitching-in');
      heroTitle.classList.add('is-dissolved');
    }
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
    if(stepsSection) stepsSection.classList.remove('is-active');

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

    // per direct request: "make the steps swipeable, to be able to go
    // from 1-4 after someone clicks one, allow for them to be able to
    // swipe into the other step" — Pointer Events (not separate touch/
    // mouse handlers) so this works identically with a real finger and
    // with a mouse drag. STEP_ORDER mirrors hotspots' own DOM order
    // (1→2→3→4); clamped at both ends rather than wrapping, since
    // "go from 1-4" reads as a bounded range, not a loop.
    const STEP_ORDER = hotspots.map(h => h.dataset.step);
    let swapTimeout = null;

    function swapToStep(offset){
      if(!activeKey) return;
      const idx = STEP_ORDER.indexOf(activeKey);
      const nextIdx = idx + offset;
      if(nextIdx < 0 || nextIdx >= STEP_ORDER.length) return;
      const nextKey = STEP_ORDER[nextIdx];
      const nextHotspot = hotspots[nextIdx];
      const data = STEPS[nextKey];
      if(!data) return;

      // quick crossfade, swap the text+icon+anchor underneath while
      // invisible, fade back in — deliberately NOT hideReveal()+
      // showStep(), which would replay the whole .6s panel open/close
      // transition and feel sluggish for what should be a snappy swipe.
      // A plain opacity crossfade (rather than a directional slide)
      // keeps this to one CSS class and one timeout instead of the
      // two-phase "animate out, jump, animate in" dance a real slide
      // would need.
      if(revealContent) revealContent.classList.add('is-swiping');
      clearTimeout(swapTimeout);
      swapTimeout = setTimeout(() => {
        const sectionRect = stepsSection.getBoundingClientRect();
        const dotEl = nextHotspot.querySelector('.process-hotspot-dot') || nextHotspot;
        const dotRect = dotEl.getBoundingClientRect();
        reveal.style.setProperty('--reveal-x', `${dotRect.left + dotRect.width / 2 - sectionRect.left}px`);
        reveal.style.setProperty('--reveal-y', `${dotRect.top + dotRect.height / 2 - sectionRect.top}px`);

        markLoaded(nextKey, nextHotspot);
        revealIndex.textContent = data.index;
        revealTitle.textContent = data.title;
        revealText.textContent = data.text;
        if(revealIcon) revealIcon.innerHTML = data.icon;
        hotspots.forEach(h => h.classList.toggle('is-active', h === nextHotspot));
        activeKey = nextKey;

        if(revealContent) revealContent.classList.remove('is-swiping');
      }, 160);
    }

    const SWIPE_THRESHOLD = 50;
    let swipeStartX = null, swipeStartY = null, swipeAxis = null;

    reveal.addEventListener('pointerdown', (e) => {
      if(!reveal.classList.contains('is-visible')) return;
      swipeStartX = e.clientX;
      swipeStartY = e.clientY;
      swipeAxis = null;
    });
    reveal.addEventListener('pointermove', (e) => {
      if(swipeStartX === null) return;
      const dx = e.clientX - swipeStartX;
      const dy = e.clientY - swipeStartY;
      // direction lock on the first few px of real movement — decides
      // once whether this gesture is a horizontal swipe (ours to
      // handle) or a vertical one (leave alone, e.g. page scroll)
      if(swipeAxis === null && (Math.abs(dx) > 10 || Math.abs(dy) > 10)){
        swipeAxis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      }
      if(swipeAxis === 'x') e.preventDefault();
    });
    function endSwipe(e){
      if(swipeStartX === null) return;
      const dx = e.clientX - swipeStartX;
      if(swipeAxis === 'x' && Math.abs(dx) > SWIPE_THRESHOLD){
        swapToStep(dx < 0 ? 1 : -1); // swiped left -> next step, right -> previous
      }
      swipeStartX = null;
      swipeStartY = null;
      swipeAxis = null;
    }
    reveal.addEventListener('pointerup', endSwipe);
    reveal.addEventListener('pointercancel', () => { swipeStartX = null; swipeStartY = null; swipeAxis = null; });
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
    if(!hero) return;
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
  // 3. pause the hotspot dots' pulse once #ourProcessSection scrolls
  // out of view
  // ===================================================================
  // per direct request: "make the dots stop pulsing when the viewer is
  // in section 2, and when they get back to section 1 they start
  // glowing again" — style.css's own processHotspotPulse keyframe runs
  // "infinite" with nothing to ever stop it, so it kept animating
  // (box-shadow, which forces a repaint each cycle) for the rest of the
  // session even once this section was long scrolled past. Toggling
  // one class here — driven by real intersection, not a viewport-size
  // media query — is what makes this apply identically on desktop and
  // mobile. Now observes stepsSection (where the dots actually live)
  // instead of the hero.
  if(stepsSection && 'IntersectionObserver' in window){
    const stepsVisibilityIO = new IntersectionObserver((entries) => {
      stepsSection.classList.toggle('is-scrolled-away', !entries[0].isIntersecting);
    }, { threshold: 0 });
    stepsVisibilityIO.observe(stepsSection);
  }
})();
