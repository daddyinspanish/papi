/* ===================================================================
   Papi — Contrast section: same fake business, two websites.
   Wipes the immersive "after" version across the flat "before" one
   (a --wipe CSS custom property driving a clip-path in style.css) as
   the visitor scrolls through this section's sticky range — a pure
   function of scroll position, so scrolling back up wipes it back
   cleanly with no separate reverse logic needed.
=================================================================== */
(function(){
  const section = document.getElementById('contrastSection');
  const stage = document.getElementById('contrastStage');
  if(!section || !stage) return;

  const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function smoothstep(e0, e1, x){
    const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  }

  const beforeLabel = document.querySelector('.contrast-label--before');
  const afterTitle = document.querySelector('.mock-logo--after');

  const introEyebrow = document.querySelector('#contrastIntro .contrast-eyebrow');
  const introHeading = document.querySelector('#contrastIntro .contrast-heading');
  const introCue = document.getElementById('contrastScrollCue');

  // the "after" mock's stat counters (Jobs Completed / Average Rating)
  // count up once, the first time the wipe has revealed enough of the
  // hero to actually see them — not a scroll-driven value like the
  // wipe itself, just a one-shot entrance, so it doesn't re-trigger
  // every time the visitor scrolls back and forth across the threshold
  const counters = Array.from(document.querySelectorAll('.mock-counter'));
  let countersStarted = false;
  function startCounters(){
    if(countersStarted || prefersReducedMotion) return;
    countersStarted = true;
    counters.forEach(el=>{
      const target = Number(el.dataset.target || '0');
      const decimals = Number(el.dataset.decimal || '0');
      const divisor = Math.pow(10, decimals);
      const duration = 1100;
      const start = performance.now();
      function tick(now){
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        const value = (target * eased) / divisor;
        el.textContent = decimals > 0 ? value.toFixed(decimals) : Math.round(value).toString();
        if(t < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
  }

  // .mock-before/.mock-after are position:absolute;inset:0 (stacked
  // exactly on top of each other for the wipe), so the stage's own
  // height can't come from their content the normal way — it has to be
  // set explicitly. A fixed aspect-ratio guessed at one viewport width
  // drifts badly at others (text wraps differently, so real content
  // height differs from the guess), which is exactly what left a slab
  // of empty white space below the marquee/cards on real phones and on
  // desktop. Measuring each mock's actual last child and sizing the
  // stage to the taller of the two tracks real content at any width.
  const beforeMock = document.querySelector('.mock-before');
  const afterMock = document.querySelector('.mock-after');
  function contentHeight(mock){
    const last = mock && mock.lastElementChild;
    if(!last) return 0;
    return last.getBoundingClientRect().bottom - mock.getBoundingClientRect().top;
  }
  function sizeStage(){
    // the stage now carries its own scroll-driven scale() transform
    // (see update() below) — getBoundingClientRect reports POST-
    // transform geometry, so measuring while that scale is anything
    // but 1 would bake the current scale factor into the stored pixel
    // height. Neutralize it for the measurement, then put it back.
    const prevTransform = stage.style.transform;
    stage.style.transform = 'none';
    const h = Math.ceil(Math.max(contentHeight(beforeMock), contentHeight(afterMock)));
    stage.style.transform = prevTransform;
    if(h > 0) stage.style.height = h + 'px';
  }

  let sectionTop = 0, sectionHeight = 0, viewportH = 0;
  function measure(){
    viewportH = window.innerHeight;
    sizeStage();
    sectionTop = section.offsetTop;
    sectionHeight = section.offsetHeight;
  }
  requestAnimationFrame(measure);
  if(document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
  window.addEventListener('load', measure);

  // width-only guard — iOS Safari's address bar collapsing on first
  // scroll fires a resize that changes innerHeight but not innerWidth;
  // re-measuring on that would be pointless work reacting to nothing
  // that actually changed
  let lastResizeW = window.innerWidth;
  window.addEventListener('resize', ()=>{
    const w = window.innerWidth;
    if(w === lastResizeW) return;
    lastResizeW = w;
    clearTimeout(window.__papiContrastResizeT);
    window.__papiContrastResizeT = setTimeout(measure, 150);
  });

  // the first ~40% of the section's scroll range is the intro scene
  // (eyebrow -> heading -> "keep scrolling" cue -> handoff to the
  // stage); the wipe itself gets the remaining ~60%, remapped below so
  // its own internal pacing (label crossfade, counters) is unchanged
  // relative to that narrower window. Every value here is a pure
  // function of `progress`, so scrolling back up reverses the whole
  // sequence — entrance included — with no separate teardown logic.
  const WIPE_START = 0.40;

  // fades in over [inStart,inEnd], holds, then fades back out over
  // [outStart,outEnd] — returns the combined opacity plus a vertical
  // offset that eases from riseIn px (entering) to 0 to -riseOut px
  // (exiting), so each piece drifts up and away rather than just
  // vanishing in place
  function fadeThrough(progress, inStart, inEnd, outStart, outEnd, riseIn, riseOut){
    const fadeIn = smoothstep(inStart, inEnd, progress);
    const fadeOut = smoothstep(outStart, outEnd, progress);
    const opacity = fadeIn * (1 - fadeOut);
    const y = (1 - fadeIn) * riseIn - fadeOut * riseOut;
    return { opacity, y };
  }

  function update(){
    const scrollable = Math.max(1, sectionHeight - viewportH);
    const progress = Math.max(0, Math.min(1, (window.scrollY - sectionTop) / scrollable));

    // the moment the sticky grabs scroll, the visitor's already looking
    // at a blank stretch of matching background (the hero's own fade-
    // out tail runs out before this section is even reached) — a slow
    // fade-in here stacked another empty beat on top of that, reading
    // as a dead pause right where the pin engages. Eyebrow/heading now
    // resolve almost immediately (still a soft rise, just a much
    // shorter one) so there's something on screen right away; only the
    // cue and the eventual handoff to the stage keep a slower pace.
    if(introEyebrow){
      const s = fadeThrough(progress, 0, 0.03, 0.24, 0.34, 10, 18);
      introEyebrow.style.opacity = String(s.opacity);
      introEyebrow.style.transform = `translateY(${s.y.toFixed(1)}px)`;
    }
    if(introHeading){
      const s = fadeThrough(progress, 0.015, 0.06, 0.24, 0.34, 14, 22);
      introHeading.style.opacity = String(s.opacity);
      introHeading.style.transform = `translateY(${s.y.toFixed(1)}px)`;
    }
    if(introCue){
      const s = fadeThrough(progress, 0.09, 0.15, 0.22, 0.30, 10, 14);
      introCue.style.opacity = String(s.opacity);
      introCue.style.transform = `translateY(${s.y.toFixed(1)}px)`;
    }

    // the stage materializes as the intro clears out of the way —
    // fading/scaling/rising into place rather than just being there
    // the instant the section is reached
    const stageIn = smoothstep(0.26, WIPE_START, progress);
    stage.style.opacity = String(stageIn);
    stage.style.transform = `translateY(${((1 - stageIn) * 26).toFixed(1)}px) scale(${(0.94 + 0.06 * stageIn).toFixed(3)})`;

    const wipeT = smoothstep(WIPE_START, 1, progress);

    // 100% at the start of the wipe phase (fully hidden) down to 0%
    // (fully revealed) — style.css's clip-path reads this directly
    const wipePct = (1 - wipeT) * 100;
    stage.style.setProperty('--wipe', wipePct.toFixed(2) + '%');

    // "Outdated Website" fades out over the same range the after mock's
    // own title fades in, over — a crossfade rather than two labels
    // just independently appearing/disappearing whenever the wipe
    // geometry happens to uncover them
    if(beforeLabel) beforeLabel.style.opacity = String(1 - smoothstep(0.55, 0.95, wipeT));
    if(afterTitle) afterTitle.style.opacity = String(smoothstep(0.55, 0.95, wipeT));

    if(wipeT > 0.3) startCounters();
  }

  // batch to one update per animation frame — raw 'scroll' events can
  // fire faster than the screen repaints during a fast scroll
  let ticking = false;
  window.addEventListener('scroll', ()=>{
    if(ticking) return;
    ticking = true;
    requestAnimationFrame(()=>{ update(); ticking = false; });
  }, { passive:true });

  if(prefersReducedMotion){
    // skip the scroll-driven entrance entirely and land straight on the
    // settled end state — the stage visible at full size, the intro
    // (which only ever existed to choreograph getting there) hidden
    stage.style.opacity = '1';
    stage.style.transform = 'none';
    stage.style.setProperty('--wipe', '0%');
    if(introEyebrow) introEyebrow.style.opacity = '0';
    if(introHeading) introHeading.style.opacity = '0';
    if(introCue) introCue.style.opacity = '0';
    if(beforeLabel) beforeLabel.style.opacity = '0';
    if(afterTitle) afterTitle.style.opacity = '1';
    counters.forEach(el=>{
      const target = Number(el.dataset.target || '0');
      const decimals = Number(el.dataset.decimal || '0');
      const value = target / Math.pow(10, decimals);
      el.textContent = decimals > 0 ? value.toFixed(decimals) : value.toString();
    });
  } else {
    update();
  }
})();
