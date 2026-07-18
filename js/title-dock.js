/* ===================================================================
   Papi — scroll-driven title docking
   Two separate jobs live in this one file: the hero's own "Papi" word
   (fading in as hero-slime.js's own intro liquid-bubble opens up
   around it, then a perpetual idle ripple + cursor-push + liquid-
   follow loop, never fading out again — see flowLetterFrame) and the
   social icon row's one-time entrance, plus — entirely independent of
   the hero — the small docked label that crossfades in below the
   brand mark once the visitor scrolls past it, showing which later
   section ("Difference"/"Industries"/"Results"/"Live"/"Proof") the
   viewport is currently over. That label (and the brand mark) flips to
   a dark-on-light look while a white section is behind it, then back
   to light-on-dark once past it into the next dark section.

   The liquid-follow part specifically (updateFieldFollow) tracks each
   letter of "Papi" independently against hero-slime.js's own control
   points, rather than moving the whole word as one rigid block: every
   letter prefers to ride one shared point together, at the letters'
   natural relative spacing, but any letter that shared point genuinely
   can't currently fit peels off and rides whichever real point is
   actually nearest to it instead. That's what keeps "Papi" always
   inside the liquid's real silhouette even as the mass splits apart,
   merges back together, or moves somewhere the whole word can't fit at
   once — the word reorganizes itself around whatever keeps every
   letter genuinely covered, rather than the covering bubble needing to
   be inflated to some guessed-safe size.
=================================================================== */
(function(){
  const heroFlowWord = document.getElementById('heroFlowWord');
  const social   = document.getElementById('heroSocial');
  const titleDock= document.getElementById('titleDock');
  const siteHeader = document.getElementById('siteHeader');
  if(!titleDock) return;

  const SCROLL_RANGE_RATIO = 0.95; // fraction of viewport height for the docked-label reveal distance
  const DOCK_THRESHOLD = 0.62; // when the corner label appears

  // cached, not read live from window.innerHeight on every scroll
  // update — on iOS Safari, innerHeight grows as the address bar
  // collapses partway through the very scroll gesture that triggers
  // this transition, which made everything paced off "dist" below
  // feel like it lagged or jumped partway through
  let viewportH = window.innerHeight;
  function measureViewport(){ viewportH = window.innerHeight; }
  let lastResizeW = window.innerWidth;
  window.addEventListener('resize', ()=>{
    const w = window.innerWidth;
    // >10px tolerance, not exact equality — see the --stable-vh
    // comment in index.html's <head>
    if(Math.abs(w - lastResizeW) <= 10) return;
    lastResizeW = w;
    clearTimeout(window.__papiDockResizeT);
    window.__papiDockResizeT = setTimeout(measureViewport, 150);
  });

  // ---- social icon row: fades/rises in right away, once, and just
  // stays there — no scroll-tied fade. The liquid-drop pop-in itself
  // (see .hero-social.is-visible in style.css) lives entirely in CSS,
  // triggered by the is-visible class added below — it animates each
  // icon's own svg/::before, never this container's opacity, so it
  // can't conflict with the fade this function drives. ----
  let socialEntranceDone = false;
  if(social){
    social.style.transition = 'none';
    social.style.opacity = '0';
  }
  function revealSocial(){
    if(!social) return;
    requestAnimationFrame(()=>{
      social.style.transition = 'opacity .6s ease';
      social.style.opacity = '1';
      social.classList.add('is-visible');
    });
    setTimeout(()=>{
      socialEntranceDone = true;
      social.style.transition = 'none';
    }, 900);
  }

  // ---- "Papi" — split into per-letter spans, each tracking its own
  // small state object so it can both ripple continuously AND get
  // pushed by a nearby cursor (see flowLetterFrame below) — a plain
  // CSS animation can't do the ripple half of that alongside a JS-
  // driven push offset, since a CSS animation targeting transform
  // always wins over an inline style on the same property, silently
  // discarding whatever the push physics writes there. Computing both
  // in one JS loop and writing a single combined transform per frame
  // avoids that fight entirely. After fading in (see PAPI_REVEAL_START/
  // END further down), this just keeps rippling/reacting to the cursor
  // forever — "Papi" never fades or gets pulled away again. ----
  // {el, homeX, homeY, homeOffX, homeOffY, halfExtent, offX, offY,
  //  anchorPageX, anchorPageY, x, y, vx, vy} — see computeFlowHomes and
  // updateFieldFollow below for what each field means.
  let flowLetterState = [];
  if(heroFlowWord){
    const flowText = heroFlowWord.textContent;
    const flowChars = Array.from(flowText);
    heroFlowWord.innerHTML = '';
    flowChars.forEach((ch, i)=>{
      const span = document.createElement('span');
      span.className = 'flow-letter';
      span.textContent = ch;
      // see the CSS note on .flow-letter — windows each letter into its
      // own slice of one gradient sized/offset across the whole word,
      // so the split-into-spans letters still read as a single
      // continuous sweep rather than four separate mini-gradients
      span.style.backgroundSize = `${flowChars.length * 100}% 100%`;
      span.style.backgroundPositionX = flowChars.length > 1 ? `${(i / (flowChars.length - 1)) * 100}%` : '0%';
      heroFlowWord.appendChild(span);
      flowLetterState.push({
        el: span, homeX: 0, homeY: 0, homeOffX: 0, homeOffY: 0, halfExtent: 0,
        offX: 0, offY: 0, anchorPageX: 0, anchorPageY: 0,
        x: 0, y: 0, vx: 0, vy: 0,
      });
    });
  }
  // measures each letter's own natural (undisturbed) position AND its
  // own bounding-circle half-extent (half its box's diagonal — the
  // radius a circle centred on this one letter would need to fully
  // contain it, regardless of how the per-letter ripple physics skews
  // it), plus each letter's offset from the word's own shared centre —
  // see updateFieldFollow below for how these get used: letters try to
  // keep their natural relative spacing (homeOffX/Y) while riding a
  // shared point together, but each letter's OWN halfExtent is what
  // lets it size (or peel off to) real liquid independently if the
  // group can't currently fit it.
  function computeFlowHomes(){
    let sumX = 0, sumY = 0;
    flowLetterState.forEach(st=>{
      const r = st.el.getBoundingClientRect();
      st.homeX = r.left + r.width/2;
      st.homeY = r.top + r.height/2;
      st.halfExtent = Math.sqrt((r.width/2)**2 + (r.height/2)**2);
      sumX += st.homeX; sumY += st.homeY;
    });
    if(flowLetterState.length){
      const centerX = sumX / flowLetterState.length, centerY = sumY / flowLetterState.length;
      flowLetterState.forEach(st=>{
        st.homeOffX = st.homeX - centerX;
        st.homeOffY = st.homeY - centerY;
      });
    }
  }
  let flowEffectsLive = false;

  // "Papi" doesn't just sit centred over the liquid — it's meant to
  // read as actually being carried inside it, contained by the mass's
  // own current outline at all times, even if the mass itself splits
  // apart. Rather than forcing one shared bubble to always be big
  // enough for the WHOLE word (which either looks like an oddly
  // oversized single blob, or fails outright the moment the mass
  // splits somewhere the word can't grow around), each LETTER
  // independently tracks whichever real control point (from
  // window.Papi.getPoints(), hero-slime.js) actually covers it —
  // preferring to ride one shared point together, at the letters'
  // natural relative spacing, but individually peeling off to ride
  // whatever real liquid is nearest to a letter the shared point
  // genuinely can't fit right now. See updateFieldFollow below for the
  // actual mechanics; this is what makes "split into 2 characters...
  // it doesn't matter what it has to do" an accurate description
  // rather than an exaggeration — the word visually reorganizes itself
  // to whatever keeps every letter genuinely covered.
  //
  // Every point's position/radius from getPoints() is normalized
  // (0..1); window.Papi.getCanvasSize() gives the exact width/height
  // hero-slime.js is rendering at right now, used to convert both into
  // real screen pixels here — reading the canvas's OWN tracked size
  // (rather than window.innerWidth/innerHeight independently) keeps
  // this file and hero-slime.js always agreeing on the same numbers,
  // avoiding the kind of momentary mismatch already fixed once this
  // session (window.innerHeight can briefly differ from the canvas's
  // actual rendered height around an iOS address-bar collapse).
  let primaryAnchorPageX = 0, primaryAnchorPageY = 0;
  const FIELD_FOLLOW_LERP = 0.05; // eases toward the target slowly, matching the liquid's own
                                   // heavy, viscous character rather than tracking it instantly
  const LETTER_FIT_SAFETY = 1.2;  // margin over each letter's own exact half-extent — the shader's
                                   // edge falloff means the literal boundary isn't fully opaque, and
                                   // this keeps a letter reading as clearly inside, not brushing the rim
  // recomputes every letter's field-follow target this frame and sends
  // updated size requests to hero-slime.js — see the file-level comment
  // above for the overall approach. `snap`, true only on the very first
  // call right after the intro bubble finishes, sets each letter's
  // offset directly to its target instead of easing into it (matching
  // this file's existing convention of a hard snap at handoff, not a
  // visible slide-in from nothing).
  function updateFieldFollow(snap){
    if(!(window.Papi && window.Papi.getPoints && window.Papi.getCanvasSize)) return;
    const pts = window.Papi.getPoints();
    const size = window.Papi.getCanvasSize();
    const cw = size.width, ch = size.height;
    if(!cw || !ch || !pts.length) return;

    const ptsPx = pts.map(p => ({ x: p.x*cw, y: p.y*ch, radius: p.radius*ch }));
    // small fixed wobble/lag budget, scaled to the canvas rather than a
    // flat pixel count so it reads proportionally the same across
    // screen sizes — independent of any letter's own fit requirement,
    // so the two can never combine to ask for more room than was
    // actually reserved (see the sizeRequests math below)
    const driftPx = ch * 0.02;

    // the word's own shared "preferred" point — sticky nearest-to-its-
    // own-last-position (same hysteresis principle as each letter's own
    // fallback anchor below), so letters try to ride this one point
    // together, at their natural relative spacing, before any of them
    // considers peeling off.
    let bestIdx = 0, bestDist = Infinity;
    for(let j=0;j<ptsPx.length;j++){
      const dx = ptsPx[j].x-primaryAnchorPageX, dy = ptsPx[j].y-primaryAnchorPageY;
      const d = dx*dx + dy*dy;
      if(d < bestDist){ bestDist = d; bestIdx = j; }
    }
    primaryAnchorPageX = ptsPx[bestIdx].x;
    primaryAnchorPageY = ptsPx[bestIdx].y;
    const primaryIdx = bestIdx;

    const sizeRequests = new Array(ptsPx.length).fill(0);

    flowLetterState.forEach(st=>{
      const idealX = primaryAnchorPageX + st.homeOffX;
      const idealY = primaryAnchorPageY + st.homeOffY;
      const neededR = st.halfExtent*LETTER_FIT_SAFETY + driftPx;
      const distToPrimary = Math.sqrt((idealX-primaryAnchorPageX)**2 + (idealY-primaryAnchorPageY)**2);

      // always ask the shared point to grow enough to cover me at my
      // natural word-relative spot, even on a frame it doesn't yet —
      // that's what lets the whole group re-merge once it catches up,
      // rather than a letter that's peeled off staying detached forever
      sizeRequests[primaryIdx] = Math.max(sizeRequests[primaryIdx], (distToPrimary+neededR)/ch);

      let targetX, targetY;
      if(distToPrimary + neededR <= ptsPx[primaryIdx].radius){
        // the shared point already (for real, using its current
        // rendered radius, not a hoped-for one) covers me here
        targetX = idealX; targetY = idealY;
      } else {
        // not currently covered riding the group — peel off and ride
        // whichever real point is nearest to where I was last riding,
        // guaranteeing I'm always somewhere the liquid actually is
        // right now, never floating in empty space between blobs
        let bi = 0, bd = Infinity;
        for(let j=0;j<ptsPx.length;j++){
          const dx = ptsPx[j].x-st.anchorPageX, dy = ptsPx[j].y-st.anchorPageY;
          const d = dx*dx + dy*dy;
          if(d < bd){ bd = d; bi = j; }
        }
        targetX = ptsPx[bi].x; targetY = ptsPx[bi].y;
        sizeRequests[bi] = Math.max(sizeRequests[bi], neededR/ch);
      }
      st.anchorPageX = targetX; st.anchorPageY = targetY;

      const targetOffX = targetX - st.homeX, targetOffY = targetY - st.homeY;
      if(snap){
        st.offX = targetOffX; st.offY = targetOffY;
      } else {
        st.offX += (targetOffX - st.offX) * FIELD_FOLLOW_LERP;
        st.offY += (targetOffY - st.offY) * FIELD_FOLLOW_LERP;
      }
      // clamp the still-easing displayed position to within the small
      // drift budget of where the target REALLY is right now — same
      // "distance from the real target, not from any fixed reference"
      // principle established earlier for the whole word, just applied
      // per letter: however far the ease is still catching up, the
      // *displayed* position can never end up further from the real
      // covering point than the small budget actually reserved for it.
      const curX = st.homeX+st.offX, curY = st.homeY+st.offY;
      const ddx = curX-targetX, ddy = curY-targetY;
      const ddist = Math.sqrt(ddx*ddx + ddy*ddy);
      if(ddist > driftPx && ddist > 0){
        const s = driftPx/ddist;
        st.offX = (targetX+ddx*s) - st.homeX;
        st.offY = (targetY+ddy*s) - st.homeY;
      }
    });

    window.Papi.requestPointSizes(sizeRequests);
  }
  // 2-edge smoothstep, same shape as the one already used further down
  // in update() for the dock-label reveal — kept local here rather
  // than shared, since this file doesn't currently have one top-level
  // helper both call
  function smoothstep(edge0, edge1, x){
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t*t*(3 - 2*t);
  }
  // "Papi" fades in as the liquid's own intro bubble (see
  // CONFIG.introDurationMs/introT in hero-slime.js) opens up, rather
  // than on its own independently-guessed CSS transition timer — there
  // is now only ONE real "is this ready yet" signal (the liquid's own
  // actual progress) driving both the bubble and the word it reveals,
  // instead of two separately-timed things that could (and did, on
  // slower devices, where the bubble hadn't actually finished by the
  // time a fixed timer assumed it had) drift out of sync and read as a
  // visible jump.
  const PAPI_REVEAL_START = 0.45; // fraction of introT where "Papi" starts fading in
  const PAPI_REVEAL_END = 0.95;   // fraction of introT where it reaches full opacity
  // same >10px-tolerance width-only guard as every other resize
  // handler in this file (see the --stable-vh comment in index.html's
  // <head>) — an iOS toolbar collapse fires 'resize' without the
  // letters' own horizontal position actually changing
  let lastResizeWFlow = window.innerWidth;
  window.addEventListener('resize', ()=>{
    const w = window.innerWidth;
    if(Math.abs(w - lastResizeWFlow) <= 10) return;
    lastResizeWFlow = w;
    clearTimeout(window.__papiFlowResizeT);
    window.__papiFlowResizeT = setTimeout(()=>{ if(flowEffectsLive) computeFlowHomes(); }, 200);
  });

  // ripple (a continuous idle wave through the letters) + cursor push,
  // combined into one transform per letter per frame — see the note
  // above on why this replaced a plain CSS animation.
  const FLOW_PUSH_RADIUS = 85;
  const FLOW_PUSH = 0.34;
  const FLOW_SPRING = 0.05;
  const FLOW_DAMPING = 0.82;
  const FLOW_RIPPLE_SPEED = (2 * Math.PI) / 2.6; // matches the old CSS keyframe's 2.6s period
  const FLOW_RIPPLE_PHASE = 0.39; // per-letter phase offset, matches the old 0.16s-of-2.6s stagger
  const FLOW_RIPPLE_AMP = 9;
  let mouseX = -9999, mouseY = -9999;
  window.addEventListener('mousemove', (e)=>{
    mouseX = e.clientX;
    mouseY = e.clientY;
  });

  function flowLetterFrame(){
    const introT = (window.Papi && window.Papi.getIntroT) ? window.Papi.getIntroT() : 1;

    if(heroFlowWord){
      heroFlowWord.style.opacity = String(smoothstep(PAPI_REVEAL_START, PAPI_REVEAL_END, introT));
    }

    // the liquid's own intro bubble (see hero-slime.js) is what's
    // actually covering "Papi" up to this point — the follow/ripple
    // physics below only start once it's finished opening, rather than
    // on a fixed guessed timer, so this always lines up with what the
    // visitor can actually see regardless of how fast that intro
    // played out on their specific device.
    if(!flowEffectsLive && introT >= 1 && heroFlowWord){
      computeFlowHomes();
      // seeds the shared anchor (and every letter's own fallback
      // anchor) at the word's own natural centre, giving
      // updateFieldFollow's very first "nearest point" search a sane
      // starting point rather than (0,0) — self-corrects to whichever
      // real point is actually nearest on that very first call anyway.
      const cx = flowLetterState.length ? flowLetterState.reduce((s, st)=>s+st.homeX, 0)/flowLetterState.length : window.innerWidth/2;
      const cy = flowLetterState.length ? flowLetterState.reduce((s, st)=>s+st.homeY, 0)/flowLetterState.length : window.innerHeight/2;
      primaryAnchorPageX = cx; primaryAnchorPageY = cy;
      flowLetterState.forEach(st=>{ st.anchorPageX = cx; st.anchorPageY = cy; });
      flowEffectsLive = true;
      updateFieldFollow(true);
    }

    if(flowEffectsLive){
      updateFieldFollow(false);
      const t = performance.now() / 1000;
      flowLetterState.forEach((st, i)=>{
        const dx = (st.homeX + st.offX + st.x) - mouseX;
        const dy = (st.homeY + st.offY + st.y) - mouseY;
        const d = Math.sqrt(dx*dx + dy*dy) + 0.01;
        if(d < FLOW_PUSH_RADIUS){
          const force = (1 - d/FLOW_PUSH_RADIUS) * FLOW_PUSH;
          const ang = Math.atan2(dy, dx);
          st.vx += Math.cos(ang) * force;
          st.vy += Math.sin(ang) * force;
        }
        st.vx += (0 - st.x) * FLOW_SPRING;
        st.vy += (0 - st.y) * FLOW_SPRING;
        st.vx *= FLOW_DAMPING;
        st.vy *= FLOW_DAMPING;
        st.x += st.vx;
        st.y += st.vy;

        const ripplePhase = t * FLOW_RIPPLE_SPEED + i * FLOW_RIPPLE_PHASE;
        const rippleY = Math.sin(ripplePhase) * FLOW_RIPPLE_AMP;
        const skew = Math.sin(ripplePhase) * -2;
        const totalX = st.offX + st.x;
        const totalY = st.offY + st.y + rippleY;
        st.el.style.transform = `translate(${totalX.toFixed(2)}px, ${totalY.toFixed(2)}px) skewX(${skew.toFixed(2)}deg)`;
      });
    }
    requestAnimationFrame(flowLetterFrame);
  }
  requestAnimationFrame(flowLetterFrame);

  window.Papi = window.Papi || {};
  window.Papi.revealSocial = revealSocial;

  const showcaseEl = document.getElementById('showcase');
  const heroEl = document.getElementById('hero');
  const contrastSectionEl = document.getElementById('contrastSection');

  // the docked top-right word swaps per section as the visitor scrolls
  // through the page — one word standing in for what that section is
  // about, rather than a single label that only ever meant "showcase"
  const sectionDock = document.getElementById('sectionDock');
  const sectionWords = [
    { el: contrastSectionEl, word: 'Difference', top: 0, bottom: 0 },
    { el: showcaseEl, word: 'Industries', top: 0, bottom: 0 },
    { el: document.getElementById('comparisonSection'), word: 'Results', top: 0, bottom: 0 },
    { el: document.getElementById('liveDemoSection'), word: 'Live', top: 0, bottom: 0 },
    { el: document.getElementById('testimonialsSection'), word: 'Proof', top: 0, bottom: 0 },
  ];
  let currentDockWord = null;

  // this update() runs on every single 'scroll' event for the entire
  // page, forever — offsetTop/offsetHeight force a synchronous layout
  // read, so reading them here (previously: heroEl once, then each
  // section AGAIN inside the sectionWords loop below, on top of a
  // separate live read for onContrast/onShowcase — the same elements'
  // layout measured twice a frame) meant this one script alone forced
  // several extra reflows on every scroll frame, stacking on top of
  // every other section's own scroll handler doing the same kind of
  // thing. None of these positions change from scrolling — only from
  // resize/content changes — so they're measured once (plus on resize/
  // fonts load, same convention as contrast.js's own sizing) instead.
  let heroHeight = 0;
  function measureZones(){
    heroHeight = heroEl ? heroEl.offsetHeight : 0;
    sectionWords.forEach(s=>{
      if(!s.el) return;
      s.top = s.el.offsetTop;
      s.bottom = s.top + s.el.offsetHeight;
    });
    // update()'s own very first call (bottom of this file) runs
    // synchronously, before this rAF-deferred first measurement has
    // ever landed — heroHeight is still its initial 0 then, which
    // silently made onHero (scrollY < heroHeight) false at the very
    // top of the page until the visitor's first scroll happened to
    // trigger a fresh, correctly-measured update() call. Re-running
    // update() every time zones are (re)measured — including this
    // very first time — closes that gap instead of relying on a
    // scroll event to ever paper over it.
    update();
  }
  requestAnimationFrame(measureZones);
  if(document.fonts && document.fonts.ready) document.fonts.ready.then(measureZones);
  window.addEventListener('load', measureZones);
  let lastResizeWZones = window.innerWidth;
  window.addEventListener('resize', ()=>{
    const w = window.innerWidth;
    // >10px tolerance — see the --stable-vh comment in index.html's <head>
    if(Math.abs(w - lastResizeWZones) <= 10) return;
    lastResizeWZones = w;
    clearTimeout(window.__papiDockZonesResizeT);
    window.__papiDockZonesResizeT = setTimeout(measureZones, 150);
  });
  const contrastZone = sectionWords[0];
  const showcaseZone = sectionWords[1];
  const liveDemoZone = sectionWords[3];

  function update(){
    const dist = viewportH * SCROLL_RANGE_RATIO;
    const progress = Math.max(0, Math.min(1, window.scrollY / dist));

    // the brand mark/docked label only need to flip to dark-on-light
    // while over one of this site's white zones — the hero (a plain
    // white background now, always) and the contrast section, also
    // white. Every other section has a dark background, where the
    // static gold/cream colors already read fine on their own.
    const onHero = window.scrollY < heroHeight;
    const onContrast = contrastSectionEl
      ? window.scrollY >= contrastZone.top && window.scrollY < contrastZone.bottom
      : false;
    document.body.classList.toggle('on-light-section', onHero || onContrast);

    // the showcase section's own background trade icons/fan cards fill
    // enough of the top-right corner on narrow screens that the docked
    // brand mark/word cluster sitting on top reads as clutter — same
    // duck-out-of-the-way treatment already used for the contrast
    // section's mock nav below
    const onShowcase = showcaseEl
      ? window.scrollY >= showcaseZone.top && window.scrollY < showcaseZone.bottom
      : false;

    // same duck-out-of-the-way treatment for the live-demo section on
    // narrow screens — its own browser-chrome-style frame already runs
    // right up against the edges of the viewport there, so the docked
    // brand mark/word cluster sitting on top of it read as clutter
    const onLiveDemo = liveDemoZone.el
      ? window.scrollY >= liveDemoZone.top && window.scrollY < liveDemoZone.bottom
      : false;

    // on narrow screens the whole top-right cluster — brand mark and
    // the tagline/word dock beneath it — sits right on top of the
    // contrast section's own mock nav/CTA (there's no room for both at
    // this width) — duck both out of the way for that stretch only,
    // fading back in once the visitor scrolls past the section
    const hideDockForMobileZone = window.innerWidth <= 640 && (onContrast || onShowcase || onLiveDemo);
    titleDock.classList.toggle('is-visible', progress > DOCK_THRESHOLD && !hideDockForMobileZone);
    // the corner "PAPI" brand mark stays hidden for the whole hero
    // section, on every viewport — the big centre "Papi" word (now
    // floating inside the liquid permanently, see flowLetterFrame
    // below) is meant to be the only "Papi" on screen there. Reuses
    // .site-header's existing is-hidden mechanism/transition (already
    // used for the mobile-only showcase/contrast/live-demo duck-out-
    // of-the-way case above) rather than adding a second one.
    if(siteHeader) siteHeader.classList.toggle('is-hidden', hideDockForMobileZone || onHero);

    // pick whichever section the viewport's centre currently sits in
    if(sectionDock){
      const y = window.scrollY + viewportH * 0.5;
      let word = null;
      for(let i=0;i<sectionWords.length;i++){
        const s = sectionWords[i];
        if(!s.el) continue;
        if(y >= s.top && y < s.bottom){ word = s.word; break; }
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
})();
