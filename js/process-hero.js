/* ===================================================================
   Papi — Process Hero interactions
   Three independent jobs, kept in one file since they all share the
   same hero markup:
   1. positionHotspots() — keeps each .process-hotspot pinned exactly
      on top of this photo's own baked-in light markers, at any
      viewport size (see its own comment below for the actual math).
   2. The 4-step reveal panel — click a hotspot, its own radial
      gradient + copy fades in (anchored at that exact hotspot);
      the shared .process-hero-title dissolves out while it's open
      and glitches back in once it's dismissed.
   3. Smooth-scrolling for both hero CTAs, replacing the browser's
      own instant anchor-jump with a real scrollIntoView so it reads
      as a natural, eased scroll rather than a snap.
=================================================================== */
(function(){
  const hero = document.querySelector('.process-hero');
  if(!hero) return;

  // ===================================================================
  // 1. hotspot positioning
  // ===================================================================
  // two ENTIRELY separate background photos, each with its own real
  // pixel size — hardcoded rather than measured from a loaded <img>
  // because these are CSS background-images, not <img> elements with
  // their own naturalWidth/naturalHeight to read. The mobile photo
  // (per direct request: "make sure to keep the same settings for
  // desktop different, and for mobile separate so they both can
  // function") is its own portrait-framed render — not a crop of the
  // desktop one — because the desktop photo's wide landscape framing
  // was cropping 2 of the 4 hotspot markers off-screen on a phone's
  // tall/narrow viewport.
  //
  // per direct request: "if the phone is flipped to landscape it
  // changes to the desktop layout" — the mobile photo is only correct
  // for a tall/narrow PORTRAIT phone screen; rotate that same phone to
  // landscape and it's a wide/short viewport again, so it should get
  // the desktop image/layout just like a real desktop would, not the
  // portrait photo squeezed sideways. mobileQuery is the exact same
  // "(max-width:860px) and (orientation:portrait)" the CSS uses to
  // swap the actual background-image — reading it via matchMedia
  // (rather than re-deriving the same condition from window.innerWidth/
  // innerHeight by hand) guarantees this can never drift out of sync
  // with what's actually rendered.
  const mobileQuery = window.matchMedia('(max-width:860px) and (orientation:portrait)');
  const IMG_DESKTOP = { w: 1536, h: 1024 };
  const IMG_MOBILE  = { w: 941, h: 1672 };
  const hotspots = Array.from(hero.querySelectorAll('.process-hotspot'));

  // BUG FIX (per direct request: "align the dots to actually be over
  // the visual dots that are on the image itself"): a flat CSS
  // percentage position looks right at whatever one viewport size it
  // was eyeballed against, then drifts at any other size/aspect ratio
  // — background-size:cover scales the photo up until it fills the
  // container in BOTH directions, cropping whichever axis overflows,
  // and how much gets cropped (and where the crop is centered) changes
  // continuously with the container's own aspect ratio. This
  // reproduces that exact same cover-fit math in JS: same scale
  // (whichever axis needs the bigger multiplier to fill), same
  // centered crop offset, so a hotspot's real on-screen position is
  // derived from the photo's own TRUE current rendered scale/position
  // rather than a percentage that only happens to line up once —
  // re-evaluated on every call so crossing the mobile breakpoint mid-
  // session (resize, rotate) picks up the other photo's own image size
  // and its own data-mobile-px/data-mobile-py marker coordinates
  function positionHotspots(){
    const rect = hero.getBoundingClientRect();
    const containerW = rect.width, containerH = rect.height;
    if(!containerW || !containerH) return;
    const isMobile = mobileQuery.matches;
    const img = isMobile ? IMG_MOBILE : IMG_DESKTOP;
    const scale = Math.max(containerW / img.w, containerH / img.h);
    const renderedW = img.w * scale, renderedH = img.h * scale;
    const offsetX = (containerW - renderedW) / 2;
    const offsetY = (containerH - renderedH) / 2;

    hotspots.forEach(hotspot => {
      const px = parseFloat(isMobile ? hotspot.dataset.mobilePx : hotspot.dataset.px);
      const py = parseFloat(isMobile ? hotspot.dataset.mobilePy : hotspot.dataset.py);
      const left = offsetX + px * scale;
      const top = offsetY + py * scale;
      hotspot.style.left = `${left}px`;
      hotspot.style.top = `${top}px`;
      // stashed for the reveal panel's own gradient anchor below —
      // avoids re-deriving the same math again on click
      hotspot.dataset.screenX = left;
      hotspot.dataset.screenY = top;
    });
  }
  positionHotspots();
  // width-only guard, matching the same pattern used elsewhere on this
  // site (see faq.js/live-demo.js/etc.'s own matching comment) — an iOS
  // address-bar-collapse resize changes innerHeight only, and
  // shouldn't be treated as a real layout change worth repositioning
  // for. Height changes that DO matter (rotating a phone, resizing a
  // real window) still come with a real width change alongside them,
  // which is also what flips mobileQuery's own orientation check —
  // portrait/landscape rotation always swaps width and height wholesale,
  // never a width-only nudge this guard would need to special-case.
  let lastResizeW = window.innerWidth;
  window.addEventListener('resize', () => {
    const w = window.innerWidth;
    if(Math.abs(w - lastResizeW) <= 10) return;
    lastResizeW = w;
    clearTimeout(window.__papiProcessHeroResizeT);
    window.__papiProcessHeroResizeT = setTimeout(positionHotspots, 150);
  });

  // ===================================================================
  // 2. reveal panel + headline dissolve/glitch
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

  let activeKey = null;
  let glitchTimeout = null;

  function showStep(key, hotspotEl){
    const data = STEPS[key];
    if(!data || !reveal) return;
    reveal.style.setProperty('--reveal-x', `${hotspotEl.dataset.screenX}px`);
    reveal.style.setProperty('--reveal-y', `${hotspotEl.dataset.screenY}px`);

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
      // force a reflow between removing/re-adding the class so the
      // animation restarts even if it's re-triggered before the
      // previous run finished (rapid open/close) — reading offsetWidth
      // is the standard, side-effect-free way to force this
      void heroTitle.offsetWidth;
      heroTitle.classList.add('is-glitching-in');
      clearTimeout(glitchTimeout);
      glitchTimeout = setTimeout(() => heroTitle.classList.remove('is-glitching-in'), 650);
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
  // 3. smooth-scrolling hero CTAs (per direct request: "when we scroll
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
  // 4. pause the hotspot dots' pulse once the hero scrolls out of view
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
