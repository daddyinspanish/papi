/* ===================================================================
   Papi — scroll-driven title docking
   On load the title shows; shortly after, the CTA fades/rises in and
   the subtitle rolls into place beneath it like a block dropping in.
   The CTA also has a subtle magnetic pull toward the cursor when it's
   nearby. As the visitor starts scrolling, the background field
   begins its slow grow to fill the screen — scrolling is held in
   place until that grow finishes (with the scroll position defended
   against any browser reset-on-lock quirk), so the hero doesn't move
   while the field is still filling in. Once it's done, scrolling
   continues normally: the whole hero block lifts and fades away
   while a small "Creating style for businesses" label crossfades in
   below the Papi mark, top right, and stays there for the rest of
   the scroll. That label (and the brand mark) flips to a
   dark-on-light look while the white showcase section is behind it,
   then back to light-on-dark once past it into the next dark
   section.
=================================================================== */
(function(){
  const heroCopy = document.getElementById('heroCopy');
  const eyebrow  = document.getElementById('heroEyebrow');
  const title    = document.getElementById('heroTitle');
  const sub      = document.getElementById('heroSub');
  const cta      = document.getElementById('heroCta');
  const titleDock= document.getElementById('titleDock');
  if(!heroCopy || !titleDock) return;

  const SCROLL_RANGE_RATIO = 0.95; // fraction of viewport height for the full transition
  const FADE_START    = 0.42; // everything starts fading out
  const FADE_END       = 0.82; // everything fully gone
  const DOCK_THRESHOLD = 0.62; // when the corner label appears

  // cached, not read live from window.innerHeight on every scroll
  // update — on iOS Safari, innerHeight grows as the address bar
  // collapses partway through the very scroll gesture that triggers
  // this transition, which was making the field-grow release (and
  // everything paced off "dist" below) feel like it lagged or didn't
  // let go smoothly right when it should have
  let viewportH = window.innerHeight;
  function measureViewport(){ viewportH = window.innerHeight; }
  let lastResizeW = window.innerWidth;
  window.addEventListener('resize', ()=>{
    const w = window.innerWidth;
    if(w === lastResizeW) return; // ignore height-only changes (mobile toolbar show/hide)
    lastResizeW = w;
    clearTimeout(window.__papiDockResizeT);
    window.__papiDockResizeT = setTimeout(measureViewport, 150);
  });

  function smoothstep(edge0, edge1, x){
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  }

  // ---- subtitle: rolls into place shortly after the title, once ----
  let subEntranceDone = false;
  if(sub){
    sub.style.transition = 'none';
    sub.style.opacity = '0';
    sub.style.transform = 'translateY(-46px) rotate(-14deg) scale(.82)';
  }
  function revealSubtitle(){
    if(!sub) return;
    requestAnimationFrame(()=>{
      sub.style.transition = 'opacity .6s ease, transform .85s cubic-bezier(.34,1.56,.64,1)';
      sub.style.opacity = '1';
      sub.style.transform = 'translateY(0) rotate(0deg) scale(1)';
    });
    setTimeout(()=>{
      subEntranceDone = true;
      // lets title.js know it's safe to measure the subtitle's
      // characters and start their own scroll/cursor ripple — doing
      // that before the block-roll entrance settles would measure the
      // wrong (mid-animation) positions
      window.dispatchEvent(new Event('papi:subtitlerevealed'));
    }, 950);
  }

  // ---- cta: fades/rises in shortly after the title, then becomes
  // magnetically interactive with the cursor ----
  let ctaEntranceDone = false;
  if(cta){
    cta.style.transition = 'none';
    cta.style.opacity = '0';
    cta.style.transform = 'translateY(18px)';
  }
  function revealCta(){
    if(!cta) return;
    requestAnimationFrame(()=>{
      cta.style.transition = 'opacity .6s ease, transform .6s var(--ease-out)';
      cta.style.opacity = '1';
      cta.style.transform = 'translateY(0)';
    });
    setTimeout(()=>{
      ctaEntranceDone = true;
      cta.style.transition = 'border-color .8s var(--ease-out), background .8s var(--ease-out), color .8s var(--ease-out), opacity .3s ease';
    }, 650);
  }

  window.Papi = window.Papi || {};
  window.Papi.revealSubtitle = revealSubtitle;
  window.Papi.revealCta = revealCta;

  // magnetic pull — the button leans slightly toward a nearby cursor
  let mouseX = -9999, mouseY = -9999;
  let ctaX = 0, ctaY = 0, ctaTargetX = 0, ctaTargetY = 0;
  const MAG_RADIUS = 95;

  window.addEventListener('mousemove', (e)=>{
    mouseX = e.clientX;
    mouseY = e.clientY;
  });

  function magnetFrame(){
    if(cta && ctaEntranceDone){
      const rect = cta.getBoundingClientRect();
      const cx = rect.left + rect.width/2;
      const cy = rect.top + rect.height/2;
      const dx = mouseX - cx, dy = mouseY - cy;
      const dist = Math.hypot(dx, dy);
      if(dist < MAG_RADIUS){
        const pull = 1 - dist / MAG_RADIUS;
        ctaTargetX = dx * pull * 0.32;
        ctaTargetY = dy * pull * 0.32;
      } else {
        ctaTargetX = 0;
        ctaTargetY = 0;
      }
      ctaX += (ctaTargetX - ctaX) * 0.2;
      ctaY += (ctaTargetY - ctaY) * 0.2;
      cta.style.transform = `translate(${ctaX.toFixed(1)}px, ${ctaY.toFixed(1)}px)`;
    }
    requestAnimationFrame(magnetFrame);
  }
  magnetFrame();

  let grown = false;
  const showcaseEl = document.getElementById('showcase');
  const heroEl = document.getElementById('hero');

  // the docked top-right word swaps per section as the visitor scrolls
  // through the page — one word standing in for what that section is
  // about, rather than a single label that only ever meant "showcase"
  const sectionDock = document.getElementById('sectionDock');
  const sectionWords = [
    { el: document.getElementById('cubeSection'), word: 'Principles' },
    { el: showcaseEl, word: 'Craft' },
    { el: document.getElementById('testimonialsSection'), word: 'Proof' },
  ];
  let currentDockWord = null;

  function update(){
    const dist = viewportH * SCROLL_RANGE_RATIO;
    const rawProgress = Math.max(0, Math.min(1, window.scrollY / dist));

    // the background field holds still (a wide centre cluster) until
    // the visitor starts scrolling — then it grows out to fill the
    // screen. Scrolling is locked for that stretch so the section
    // doesn't move until it's finished (see window.Papi.lockScroll in
    // accent.js for why this isn't just a CSS overflow toggle).
    if(!grown && rawProgress > 0.001){
      grown = true;
      if(window.Papi && window.Papi.lockScroll) window.Papi.lockScroll();
      if(window.Papi && window.Papi.growField) window.Papi.growField();
      window.addEventListener('papi:fieldgrown', ()=>{
        if(window.Papi && window.Papi.unlockScroll) window.Papi.unlockScroll();
      }, { once:true });
      // safety net: if 'papi:fieldgrown' never fires for any reason
      // (e.g. growField() was called before the field had finished
      // its own reveal setup, so it silently no-op'd), don't leave
      // scrolling locked forever — release it shortly after the grow
      // (INTRO_DURATION in particles.js) should have finished
      setTimeout(()=>{
        if(window.Papi && window.Papi.unlockScroll) window.Papi.unlockScroll();
      }, 1800);
    }

    // don't let the rest of the transition advance until the field
    // has actually finished growing (defense in depth alongside the
    // scroll lock above)
    const fieldGrown = !(window.Papi && window.Papi.isFieldGrown) || window.Papi.isFieldGrown();
    const progress = fieldGrown ? rawProgress : Math.min(rawProgress, FADE_START);

    const fadeOut = smoothstep(FADE_START, FADE_END, progress);

    if(eyebrow) eyebrow.style.opacity = String(1 - fadeOut);
    if(title) title.style.opacity = String(1 - fadeOut);
    if(cta && ctaEntranceDone) cta.style.opacity = String(1 - fadeOut);
    if(sub && subEntranceDone) sub.style.opacity = String(1 - fadeOut);

    heroCopy.style.transform = `translateY(${-fadeOut * 34}px)`;
    heroCopy.style.pointerEvents = fadeOut > 0.6 ? 'none' : 'auto';

    titleDock.classList.toggle('is-visible', progress > DOCK_THRESHOLD);

    // pick whichever section the viewport's centre currently sits in
    if(sectionDock){
      const y = window.scrollY + viewportH * 0.5;
      let word = null;
      for(let i=0;i<sectionWords.length;i++){
        const s = sectionWords[i];
        if(!s.el) continue;
        const top = s.el.offsetTop, bottom = top + s.el.offsetHeight;
        if(y >= top && y < bottom){ word = s.word; break; }
      }
      sectionDock.classList.toggle('is-visible', progress > DOCK_THRESHOLD && !!word);
      if(word && word !== currentDockWord){
        const isFirstWord = currentDockWord === null;
        currentDockWord = word;
        if(isFirstWord){
          sectionDock.textContent = word;
        } else {
          // crossfade to the new word instead of snapping straight to
          // it — reuses the element's existing opacity transition
          sectionDock.style.opacity = '0';
          setTimeout(()=>{
            sectionDock.textContent = word;
            sectionDock.style.opacity = '';
          }, 320);
        }
      }
    }

    // the brand mark only needs to adapt live (via --style-contrast)
    // while it's actually over the hero's own sweeping gold/black
    // field — that's what was going invisible (gold-on-gold). Every
    // other section already has a fixed dark background, where a
    // static gold reads fine on its own; leaving it on the dynamic
    // color there risked it swinging to near-black-on-near-black.
    const onHero = heroEl ? window.scrollY < heroEl.offsetHeight : false;
    document.body.classList.toggle('on-hero-section', onHero);
  }

  // batch to one update per animation frame — this reads offsetTop/
  // offsetHeight (forces layout) every call, and raw 'scroll' events
  // can fire faster than the screen repaints during a fast scroll
  let ticking = false;
  window.addEventListener('scroll', ()=>{
    if(ticking) return;
    ticking = true;
    requestAnimationFrame(()=>{ update(); ticking = false; });
  }, { passive:true });
  update();

  // jumps to the trades showcase — but only once the hero's own field
  // fill has actually finished. Scrolling straight there used to race
  // the scroll-lock that holds the page during that fill: the lock
  // would yank the in-progress smooth-scroll back, and once released
  // the visitor was just dumped at wherever that collision left them —
  // which read as an abrupt jump instead of one smooth motion.
  if(cta){
    cta.addEventListener('click', (e)=>{
      const showcase = document.getElementById('showcase');
      if(!showcase) return;
      e.preventDefault();

      function goToShowcase(){
        showcase.scrollIntoView({ behavior:'smooth' });
      }
      const fieldGrown = !(window.Papi && window.Papi.isFieldGrown) || window.Papi.isFieldGrown();
      if(fieldGrown){
        goToShowcase();
      } else {
        if(window.Papi && window.Papi.growField) window.Papi.growField();
        window.addEventListener('papi:fieldgrown', goToShowcase, { once:true });
      }
    });
  }
})();
