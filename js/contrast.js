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
  const stageWrap = document.querySelector('.contrast-stage-wrap');
  if(!section || !stage) return;

  const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function smoothstep(e0, e1, x){
    const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  }

  // the "after" hero's background video sits fully clipped (0 visible
  // width) behind the wipe for most of this section's scroll range —
  // some browsers never actually start decoding an autoplay video that
  // has zero rendered area at load time, so it was just sitting on its
  // first frame once the wipe finally revealed it. Kicking playback
  // off explicitly via JS (idempotent — safe to call again) sidesteps
  // that rather than relying on the autoplay attribute alone.
  const heroVideo = document.querySelector('.mock-hero-video');
  function ensureVideoPlaying(){
    if(!heroVideo || !heroVideo.paused) return;
    const playPromise = heroVideo.play();
    if(playPromise && playPromise.catch) playPromise.catch(()=>{});
  }
  ensureVideoPlaying();

  const afterTitle = document.querySelector('.mock-logo--after');
  const stageTitleBefore = document.querySelector('.contrast-stage-title-before');
  const stageTitleAfter = document.querySelector('.contrast-stage-title-after');

  const introEyebrow = document.querySelector('#contrastIntro .contrast-eyebrow');
  const introHeading = document.querySelector('#contrastIntro .contrast-heading');
  const introOne = document.getElementById('contrastHeadingOne');
  const introCue = document.getElementById('contrastScrollCue');

  // "One" gets its own scale + color animation (not opacity — it still
  // rides along with introHeading's own fade above, this just layers a
  // distinct "arriving and turning gold" beat on top of that)
  const INK_RGB = [23, 24, 26];
  const GOLD_RGB = [138, 106, 31]; // --gold-deep
  function lerpColor(a, b, t){
    const r = Math.round(a[0] + (b[0]-a[0])*t);
    const g = Math.round(a[1] + (b[1]-a[1])*t);
    const bl = Math.round(a[2] + (b[2]-a[2])*t);
    return `rgb(${r}, ${g}, ${bl})`;
  }

  // "The other gets ignored." is typed out character by character (see
  // TYPE_START/TYPE_END in update()) rather than just fading in — split
  // once here into per-character spans, plus a blinking caret appended
  // right after them, both driven purely by scroll progress so typing
  // (and reversing back to blank on scroll-up) needs no separate logic
  const emEl = document.getElementById('contrastHeadingEm');
  const emChars = [];
  let emCursorEl = null;
  if(emEl){
    const text = emEl.textContent;
    emEl.textContent = '';
    Array.from(text).forEach(ch=>{
      const span = document.createElement('span');
      span.className = 'type-char';
      span.textContent = ch === ' ' ? ' ' : ch;
      emEl.appendChild(span);
      emChars.push(span);
    });
    emCursorEl = document.createElement('span');
    emCursorEl.className = 'contrast-heading-em-cursor';
    emCursorEl.textContent = '|';
    emEl.appendChild(emCursorEl);
  }

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
    // .contrast-stage-wrap now carries its own scroll-driven scale()
    // transform (see update() below) — getBoundingClientRect reports
    // POST-transform geometry for every descendant, so measuring while
    // that scale is anything but 1 would bake the current scale factor
    // into the stored pixel height. Neutralize it for the measurement,
    // then put it back.
    const prevTransform = stageWrap ? stageWrap.style.transform : '';
    if(stageWrap) stageWrap.style.transform = 'none';
    const h = Math.ceil(Math.max(contentHeight(beforeMock), contentHeight(afterMock)));
    if(stageWrap) stageWrap.style.transform = prevTransform;
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

  // the first ~2/3 of the section's scroll range is the intro scene —
  // eyebrow -> heading ("One" arriving separately and turning gold) ->
  // "The other gets ignored." typed out in red -> "keep scrolling" cue
  // -> handoff to the stage. Slower/more spread out than a first pass
  // at this (which had almost no dead time to fill before the liquid
  // was made to roam through this section too — with that now filling
  // the space, the reveal can afford to actually breathe). The wipe
  // itself gets the remaining third, remapped below so its own internal
  // pacing (label crossfade, counters) is unchanged relative to that
  // narrower window. Every value here is a pure function of `progress`,
  // so scrolling back up reverses the whole sequence — entrance
  // included — with no separate teardown logic.
  const WIPE_START = 0.66;

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

  // once fully scrolled past (or not yet reached), every value update()
  // touches is already pinned at its resting end/start state — every
  // one of this page's sections runs its own scroll-driven update on
  // every single 'scroll' event site-wide, forever, so recomputing and
  // re-writing ~20 styles (plus the per-character typed-text loop)
  // here on every scroll frame long after leaving this section was
  // pure waste stacking on top of every other section doing the same
  // thing — exactly the kind of accumulated per-frame cost that showed
  // up as stutter/lag scrolling through the sections below this one.
  // pinnedLow/pinnedHigh let the resting state still get written
  // exactly once when first settling into it (so the very first call,
  // before the visitor has scrolled at all, still lays everything out
  // correctly) and skip every redundant call after.
  let pinnedLow = false, pinnedHigh = false;

  function update(){
    const scrollable = Math.max(1, sectionHeight - viewportH);
    const rawProgress = (window.scrollY - sectionTop) / scrollable;

    if(rawProgress < 0){
      if(pinnedLow) return;
      pinnedLow = true;
    } else {
      pinnedLow = false;
    }
    if(rawProgress > 1){
      // rawProgress reaching 1 is when the sticky content is *about* to
      // release, not when it's actually left the screen — the sticky
      // still holds it fully visible for one more viewport-height of
      // scroll after that. Pausing right at progress=1 (the previous
      // behavior) froze the video on-screen, mid-view, for that entire
      // stretch, which read as it just breaking rather than the section
      // intentionally being done with it. Checking the section's real
      // on-screen position instead means it keeps playing right up
      // until it's actually scrolled out of view. Only checked while
      // still playing, so this forced-layout read stops costing
      // anything at all once the video is actually paused.
      if(heroVideo && !heroVideo.paused && section.getBoundingClientRect().bottom <= 0){
        heroVideo.pause();
      }
      if(pinnedHigh) return;
      pinnedHigh = true;
    } else {
      pinnedHigh = false;
    }

    const progress = Math.max(0, Math.min(1, rawProgress));

    if(introEyebrow){
      const s = fadeThrough(progress, 0, 0.09, 0.50, 0.62, 10, 18);
      introEyebrow.style.opacity = String(s.opacity);
      introEyebrow.style.transform = `translateY(${s.y.toFixed(1)}px)`;
    }
    if(introHeading){
      const s = fadeThrough(progress, 0.06, 0.18, 0.50, 0.62, 14, 22);
      introHeading.style.opacity = String(s.opacity);
      introHeading.style.transform = `translateY(${s.y.toFixed(1)}px)`;
    }
    // "One" rides along with introHeading's opacity/rise above (it's a
    // child of it) but layers its own scale + ink-to-gold color on top,
    // over a slightly longer window, so it visibly keeps "arriving" a
    // beat after the rest of the sentence has already settled in place
    if(introOne){
      const oneT = smoothstep(0.06, 0.22, progress);
      introOne.style.transform = `scale(${(0.6 + 0.4 * oneT).toFixed(3)})`;
      introOne.style.color = lerpColor(INK_RGB, GOLD_RGB, oneT);
    }
    // "The other gets ignored." types itself out character by character
    // — a hard per-character cut (no per-char fade) is what actually
    // reads as typed rather than just a staggered fade-in
    if(emChars.length){
      const typeT = smoothstep(0.22, 0.46, progress);
      const visibleCount = Math.floor(typeT * emChars.length);
      emChars.forEach((el, i)=>{ el.style.opacity = i < visibleCount ? '1' : '0'; });
      if(emCursorEl) emCursorEl.classList.toggle('is-typing', typeT > 0 && typeT < 1);
    }
    if(introCue){
      const s = fadeThrough(progress, 0.48, 0.54, 0.56, 0.62, 10, 14);
      introCue.style.opacity = String(s.opacity);
      introCue.style.transform = `translateY(${s.y.toFixed(1)}px)`;
    }

    // the stage (and its title above it) materialize together as the
    // intro clears out of the way — fading/scaling/rising into place as
    // one unit, rather than just being there the instant the section is
    // reached. This has to target the wrap, not the stage alone — the
    // stage-title sits outside #contrastStage as its sibling, so
    // animating only the stage left the title appearing on its own,
    // ahead of the box it's meant to be labeling.
    const stageIn = smoothstep(0.56, WIPE_START, progress);
    const stageInTarget = stageWrap || stage;
    stageInTarget.style.opacity = String(stageIn);
    stageInTarget.style.transform = `translateY(${((1 - stageIn) * 26).toFixed(1)}px) scale(${(0.94 + 0.06 * stageIn).toFixed(3)})`;

    const wipeT = smoothstep(WIPE_START, 1, progress);

    // 100% at the start of the wipe phase (fully hidden) down to 0%
    // (fully revealed) — style.css's clip-path reads this directly
    const wipePct = (1 - wipeT) * 100;
    stage.style.setProperty('--wipe', wipePct.toFixed(2) + '%');

    // the stage's own title crossfades from "Old Website" to "Papi
    // Website" in gold over the same range the after mock's nav logo
    // fades in — one more label describing which mock you're looking
    // at, changing right along with the wipe instead of independently
    if(stageTitleBefore) stageTitleBefore.style.opacity = String(1 - smoothstep(0.55, 0.95, wipeT));
    if(stageTitleAfter) stageTitleAfter.style.opacity = String(smoothstep(0.55, 0.95, wipeT));
    if(afterTitle) afterTitle.style.opacity = String(smoothstep(0.55, 0.95, wipeT));

    if(wipeT > 0.3) startCounters();
    // re-asserted every frame the wipe is active (not just once up
    // front) — if the video ever got paused while it had zero visible
    // area (some browsers do this as a background-tab/off-screen power
    // optimization), this is what actually resumes it once the wipe
    // gives it real pixels again. ensureVideoPlaying() is a no-op
    // whenever it's already playing, so this is cheap.
    if(wipeT > 0) ensureVideoPlaying();
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
    (stageWrap || stage).style.opacity = '1';
    (stageWrap || stage).style.transform = 'none';
    stage.style.setProperty('--wipe', '0%');
    if(introEyebrow) introEyebrow.style.opacity = '0';
    if(introHeading) introHeading.style.opacity = '0';
    if(introCue) introCue.style.opacity = '0';
    if(stageTitleBefore) stageTitleBefore.style.opacity = '0';
    if(stageTitleAfter) stageTitleAfter.style.opacity = '1';
    if(afterTitle) afterTitle.style.opacity = '1';
    if(introOne){
      introOne.style.transform = 'scale(1)';
      introOne.style.color = lerpColor(INK_RGB, GOLD_RGB, 1);
    }
    emChars.forEach(el => { el.style.opacity = '1'; });
    if(emCursorEl) emCursorEl.classList.remove('is-typing');
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
