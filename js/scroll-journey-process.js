/* ===================================================================
   Papi — Scroll Journey: How It's Built (400vh pinned depth sequence)
   Per direct request: turn the 4 process steps into one pinned,
   scroll-controlled sequence (~400vh) — each active panel moves to
   { z:0, opacity:1, scale:1, rotationY:0 }, the previous one to
   { xPercent:-55, z:-240, rotationY:12, scale:0.82, opacity:0.3 }, the
   next one to the mirrored { xPercent:55, z:-240, rotationY:-12,
   scale:0.82, opacity:0.3 } — continuous, scrubbed, with momentum
   handed off from step to step rather than a repeated fade-in.

   Builds its 4 .process-panel elements from window.PapiSteps
   (js/process-hero.js's own single source of truth for the step copy/
   icons — set on window there specifically so this file doesn't
   duplicate any content). The hotspot dots stay exactly where they
   already were; this file just takes over what drives their
   is-active/is-loaded state and #processTrackFill (continuously, by
   scroll progress) instead of process-hero.js's old click-count
   version, and repoints their click handler at a scrollTo instead of
   the old modal.

   Implementation note: every panel's position is driven by a single
   continuous function of "distance in steps from the currently active
   one" (r = panelIndex - activeFloat) rather than four separate
   discrete tweens — this is what makes the handoff between steps read
   as one continuous, momentum-carrying motion instead of four
   independent fade-ins.
=================================================================== */
(function(){
  if(!window.gsap || !window.ScrollTrigger) return;

  const section = document.getElementById('ourProcessSection');
  const stage = document.getElementById('processStage');
  const glow = stage ? stage.querySelector('.process-stage-glow') : null;
  const trackFill = document.getElementById('processTrackFill');
  const hotspotLine = document.getElementById('processHotspotLine');
  const hotspots = hotspotLine ? Array.from(hotspotLine.querySelectorAll('.process-hotspot')) : [];
  const STEPS = window.PapiSteps;
  const ORDER = window.PapiStepOrder;
  if(!section || !stage || !STEPS || !ORDER || !ORDER.length) return;

  gsap.registerPlugin(ScrollTrigger);

  // ---- build the 4 panels from the shared STEPS data ----
  const panels = ORDER.map((key) => {
    const data = STEPS[key];
    if(!data) return null;
    const panel = document.createElement('div');
    panel.className = 'process-panel';
    panel.dataset.step = key;
    panel.innerHTML =
      '<svg class="process-reveal-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + data.icon + '</svg>' +
      '<span class="process-reveal-index">' + data.index + '</span>' +
      '<h3 class="process-reveal-title">' + data.title + '</h3>' +
      '<p class="process-reveal-text">' + data.text + '</p>';
    stage.appendChild(panel);
    return panel;
  }).filter(Boolean);

  const n = panels.length;
  if(!n) return;

  function clamp01(v){ return Math.max(0, Math.min(1, v)); }
  function lerp(a, b, t){ return a + (b - a) * t; }

  const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(prefersReducedMotion){
    panels.forEach((p) => { p.style.opacity = '1'; });
    if(trackFill) trackFill.style.transform = 'scaleX(1)';
    return;
  }

  // ---- state keyframes, exactly per direct spec ----
  const DESKTOP_STATE = {
    active:   { xPercent: 0,   z: 0,    rotationY: 0,   scale: 1,    opacity: 1   },
    previous: { xPercent: -55, z: -240, rotationY: 12,  scale: 0.82, opacity: 0.3 },
    next:     { xPercent: 55,  z: -240, rotationY: -12, scale: 0.82, opacity: 0.3 },
    hidden:   { xPercent: 0,   z: -400, rotationY: 0,   scale: 0.7,  opacity: 0   },
  };
  // mobile: per direct request, "remove heavy Z-depth and use shorter
  // slide/scale transitions" — no z/rotationY at all, smaller travel.
  // BUG FIX: per follow-up report, "you can barely read things because
  // one step is seen behind the other" — on a narrow mobile screen,
  // panels are wide relative to the viewport, so even a large %
  // shift still leaves real overlap while a panel is mid-transition
  // (this is a continuous scrub, not a set of 4 discrete snaps — most
  // of the scroll range IS "mid-transition"). Combined with the
  // z-index fix above (so the active panel's own opaque background
  // now properly sits in front of, not beside, its neighbors), pushed
  // this further still: previous/next are nearly off-screen (±92%)
  // and faint enough (0.14) to read as a background hint rather than
  // competing, readable text.
  const MOBILE_STATE = {
    active:   { xPercent: 0,   rotationY: 0, scale: 1,    opacity: 1    },
    previous: { xPercent: -92, rotationY: 0, scale: 0.8,  opacity: 0.14 },
    next:     { xPercent: 92,  rotationY: 0, scale: 0.8,  opacity: 0.14 },
    hidden:   { xPercent: 0,   rotationY: 0, scale: 0.72, opacity: 0    },
  };

  // blends smoothly between the named states based on r = signed
  // distance (in step-units) from "currently active": 0 at active,
  // -1 fully previous, +1 fully next, |r|>=2 fully hidden — continuous
  // in between, which is what carries momentum from step to step
  // instead of four separate fade-ins.
  function stateAt(states, r){
    const ar = Math.abs(r);
    let from, to, t;
    if(ar <= 1){
      from = states.active;
      to = r < 0 ? states.previous : states.next;
      t = ar;
    } else {
      from = r < 0 ? states.previous : states.next;
      to = states.hidden;
      t = clamp01(ar - 1);
    }
    const out = {};
    Object.keys(states.active).forEach((k) => { out[k] = lerp(from[k], to[k], t); });
    return out;
  }

  const loadedSteps = new Set();
  let liveTrigger = null;

  function markLoaded(activeIndex){
    if(loadedSteps.has(activeIndex)) return;
    loadedSteps.add(activeIndex);
    const h = hotspots[activeIndex];
    if(!h) return;
    h.classList.add('is-loaded');
    const numEl = h.querySelector('.process-hotspot-number');
    if(numEl) numEl.textContent = '✓';
  }

  function render(states, progress){
    const activeFloat = progress * (n - 1);

    panels.forEach((panel, i) => {
      const r = i - activeFloat;
      const s = stateAt(states, r);
      gsap.set(panel, s);
      panel.style.pointerEvents = s.opacity > 0.05 ? 'auto' : 'none';
      // BUG FIX: per report, "you can barely read things because one
      // step is seen behind the other" — every panel shared the same
      // CSS z-index, so they painted in plain DOM order regardless of
      // which one was actually "active," meaning a later panel could
      // visually sit on TOP of the active one's text instead of
      // cleanly behind it. Ranking z-index by closeness to active here
      // guarantees whichever panel is most "in front" conceptually is
      // also literally on top, so its own opaque background properly
      // occludes neighbors instead of both showing through at once.
      panel.style.zIndex = String(Math.round((1 - Math.min(Math.abs(r), 1)) * 10) + 1);
    });

    const activeIndex = Math.max(0, Math.min(n - 1, Math.round(activeFloat)));
    hotspots.forEach((h, i) => {
      const isActive = i === activeIndex;
      h.classList.toggle('is-active', isActive);
      h.classList.toggle('is-emphasized', isActive);
    });
    markLoaded(activeIndex);

    if(trackFill) trackFill.style.transform = 'scaleX(' + progress.toFixed(4) + ')';

    // subtle background-light movement, tied to the same active float —
    // plain radial-gradient position/opacity shift, no filter:blur (see
    // .process-stage-glow's own CSS comment)
    if(glow){
      const glowShift = (activeFloat - (n - 1) / 2) * 18;
      gsap.set(glow, { x: glowShift, opacity: 0.4 + 0.2 * Math.sin(activeFloat * Math.PI) });
    }
  }

  // click-to-jump wiring bound ONCE (not per matchMedia breakpoint —
  // gsap.matchMedia auto-reverts gsap-created animations/ScrollTriggers
  // on breakpoint change, but a plain addEventListener here would just
  // keep stacking duplicate listeners across resizes if bound inside
  // the mm.add() context instead). Reads liveTrigger by closure
  // reference, so it always targets whichever ScrollTrigger is current.
  hotspots.forEach((hotspot, i) => {
    hotspot.addEventListener('click', () => {
      if(!liveTrigger) return;
      const target = liveTrigger.start + (i / (n - 1)) * (liveTrigger.end - liveTrigger.start);
      window.scrollTo({ top: target, behavior: 'smooth' });
    });
  });

  const mm = gsap.matchMedia();
  mm.add({
    isDesktop: '(min-width: 641px)',
    isMobile: '(max-width: 640px)',
  }, (context) => {
    const states = context.conditions.isDesktop ? DESKTOP_STATE : MOBILE_STATE;
    const end = context.conditions.isDesktop ? '+=400%' : '+=220%';

    const trigger = ScrollTrigger.create({
      trigger: section,
      pin: true,
      start: 'top top',
      end: end,
      scrub: 1,
      onUpdate: (self) => render(states, self.progress),
    });
    liveTrigger = trigger;
    render(states, trigger.progress);
  });

  // BUG FIX: per report, "on mobile when reaching the last section,
  // there is a big black space after that section reaches the very
  // bottom." Mobile Safari's address bar auto-hides shortly after the
  // page settles, growing the real usable viewport — but GSAP's pin
  // spacers (across all three scroll-journey files, which is why this
  // lives here as the last one to load, once everything is already
  // pinned) are sized once, from whatever viewport height was current
  // when each pin was first set up. If that measurement happened while
  // Safari's chrome was still visible, every pin spacer ends up
  // oversized relative to the real, settled viewport, and that excess
  // shows up as dead scroll space after the final section. One
  // ScrollTrigger.refresh() after a real settle delay re-measures
  // every pin against the final viewport — same "wait for it to
  // settle" convention already used for --stable-vh elsewhere on this
  // site, just applied to GSAP's own measurements instead.
  window.addEventListener('load', () => {
    setTimeout(() => ScrollTrigger.refresh(), 600);
  });

  // BUG FIX: per follow-up report, "in desktop after reaching how we
  // build it, there seems to be an empty space in the bottom section."
  // The one-shot refresh above only ever fires once, 600ms after
  // 'load' — fine for the mobile Safari chrome-settle case it was
  // written for, but desktop has no such single settle moment. Any
  // later layout shift that changes the page's total height (a web
  // font swapping in, a live-demo iframe finishing load, a testimonial
  // image landing) after that one refresh already ran leaves every
  // pin-spacer sized against stale measurements, showing up as dead
  // scroll space once you're past the affected section. A
  // ResizeObserver on <body> catches any such height change for the
  // rest of the page's life (not just once) and asks GSAP to
  // re-measure every pin against it, debounced so a burst of shifts
  // (several images landing back to back) only triggers one refresh.
  if('ResizeObserver' in window){
    let resizeT = null;
    const ro = new ResizeObserver(() => {
      clearTimeout(resizeT);
      resizeT = setTimeout(() => ScrollTrigger.refresh(), 200);
    });
    ro.observe(document.body);
  }
})();
