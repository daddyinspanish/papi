/* ===================================================================
   Papi — floating glowing yellow cube
   A complete 6-face 3D cube with a glowing amber/yellow material — all
   six faces exist (not just the three visible from one fixed angle).
   Each face carries one of the three principles behind every Papi
   website (Trust, Clarity, Next Step) — see the PRINCIPLES/FACES maps
   below to change the wording without touching the animation.

   It tumbles on BOTH axes tied to how far the visitor has scrolled
   down the page (a pure single-axis spin can never bring the top or
   bottom face flat to the camera, no matter how long you scroll — the
   section is a tall sticky-scroll section, same pattern as the
   showcase, so there's enough scroll room for the tumble to actually
   get all the way around). A gentle cursor-driven wobble sits on top.

   Clicking any face snaps/zooms the cube to look at it head-on and
   locks page scroll; clicking anywhere else releases it back to the
   normal tumble and un-locks scroll. A blurred, contrasting glow field
   sits behind it and orbits in sync, so the backdrop reads as moving
   with the cube rather than sitting still behind it.

   The section sits right after the hero. Nothing here — not the
   title, not the cube — is visible yet at the very top of the
   section's scroll. Everything below is driven directly off scroll
   position (never a fixed-duration real-time animation): first the
   title's words rise and come into focus one after another (the same
   entrance language as the hero title's letter-by-letter reveal, so
   the two sections read as one brand), then, with the title mostly
   revealed, the cube fades in and drops from just under the hero
   edge, settling well before the halfway point of the section's intro
   range. Only once it's settled does the tumble described above take
   over. Driving all of it off scroll (rather than a one-shot animation
   triggered once and left to play out in real time) means it can
   never finish playing before the visitor actually looks at it, and
   it reverses cleanly if they scroll back up.
=================================================================== */
(function(){
  const stage = document.getElementById('cubeStage');
  const group = document.getElementById('cubeGroup');
  const bg = document.getElementById('cubeBg');
  const section = document.getElementById('cubeSection');
  const eyebrowEl = document.querySelector('.cube-eyebrow');
  const interactHint = document.getElementById('cubeInteractHint');
  if(!stage || !group) return;

  // shown once the cube has settled; dismissed for good the first
  // time someone actually interacts with it (clicks a face, or has
  // tumbled it a meaningful amount by scrolling)
  let hintDismissed = false;
  function dismissHint(){
    if(hintDismissed || !interactHint) return;
    hintDismissed = true;
    interactHint.classList.remove('is-visible');
  }

  // split the eyebrow into words so they can cascade in one after
  // another, same idea as the hero title's per-letter reveal
  let eyebrowWords = [];
  if(eyebrowEl){
    const text = eyebrowEl.textContent.trim();
    eyebrowEl.innerHTML = '';
    eyebrowWords = text.split(/\s+/).map(word=>{
      const span = document.createElement('span');
      span.className = 'cube-eyebrow-word';
      span.textContent = word;
      eyebrowEl.appendChild(span);
      return span;
    });
  }

  const wrap = document.createElement('div');
  wrap.className = 'glow-cube-wrap';

  // the three principles behind every Papi website, each carried by
  // one opposite pair of faces so all three read no matter which way
  // the cube has orbited to — front/top/right (the faces visible from
  // the base viewing angle) each show a different principle, and the
  // face directly opposite each one repeats it
  const PRINCIPLES = {
    trust:    { heading: 'Trust',     points: ['Professional first impressions', 'Credibility', 'Confidence'] },
    clarity:  { heading: 'Clarity',   points: ['Clear messaging', 'Simple navigation', 'Easy to understand'] },
    nextStep: { heading: 'Next Step', points: ['Purposeful calls to action', 'Easy contact', 'Simple booking & quotes'] },
  };
  const FACES = [
    { cls: 'front',  key: 'trust' },
    { cls: 'top',    key: 'clarity' },
    { cls: 'right',  key: 'nextStep' },
    { cls: 'back',   key: 'trust' },
    { cls: 'bottom', key: 'clarity' },
    { cls: 'left',   key: 'nextStep' },
  ];

  function faceMarkup(cls, key){
    const p = PRINCIPLES[key];
    const points = p.points.map(pt => `<li>${pt}</li>`).join('');
    return `<span class="face face--${cls}">
      <span class="face-inner">
        <span class="face-label">${p.heading}</span>
        <ul class="face-points">${points}</ul>
      </span>
    </span>`;
  }

  const cube = document.createElement('div');
  cube.className = 'glow-cube';
  cube.innerHTML = FACES.map(f => faceMarkup(f.cls, f.key)).join('');

  wrap.appendChild(cube);
  group.appendChild(wrap);

  const glows = bg ? Array.from(bg.querySelectorAll('.glow')) : [];
  // radius + phase offset each glow blob orbits at, so the field feels
  // layered and dimensional rather than sliding as one flat sheet
  const ORBIT = [
    { rx: 46, ry: 40, phase: 0 },
    { rx: 34, ry: 30, phase: 2.4 },
    { rx: 26, ry: 44, phase: 4.6 },
  ];

  function measureDepth(){
    // measure the wrapper, not the cube itself — the cube already has a
    // 3D rotation applied to it every frame, and getBoundingClientRect()
    // on a rotated element returns its foreshortened screen projection,
    // not its true face size, which was throwing the depth off (visible
    // as gaps/seams where the top and side faces met the front face)
    const rect = wrap.getBoundingClientRect();
    group.style.setProperty('--wc-depth', `${rect.width}px`);
  }

  // cached, not recomputed every frame from live window.innerHeight —
  // on iOS Safari, innerHeight grows as the address bar collapses
  // partway through a scroll gesture, which was making the reveal
  // range keep expanding mid-scroll (moving the goalposts), so the
  // title and cube took noticeably longer to finish revealing there
  // than the same scroll distance would on desktop
  let introRange = 0;
  let sectionTop = 0;
  let sectionEndScrollY = Infinity;
  let viewportH = 0;
  function measureIntroRange(){
    viewportH = window.innerHeight;
    introRange = viewportH * INTRO_FALL_VH;
    sectionTop = section ? section.offsetTop : 0;
    // the scrollY at which this section has fully scrolled past — used
    // to freeze the tumble once the visitor has moved on to the next
    // section, instead of it continuing to spin based on scroll that
    // now belongs to a completely different part of the page
    sectionEndScrollY = section
      ? sectionTop + Math.max(0, section.offsetHeight - viewportH)
      : Infinity;
  }

  requestAnimationFrame(()=>{ measureDepth(); measureIntroRange(); });
  if(document.fonts && document.fonts.ready) document.fonts.ready.then(measureIntroRange);

  // ignore resize events that only changed height — the same mobile
  // address-bar show/hide that motivated caching introRange above
  // also fires plain 'resize' events, and re-measuring on every one
  // of those would reintroduce the exact same moving-goalposts issue
  let lastResizeW = window.innerWidth;
  window.addEventListener('resize', ()=>{
    const w = window.innerWidth;
    if(w === lastResizeW) return;
    lastResizeW = w;
    clearTimeout(window.__papiCubeResizeT);
    window.__papiCubeResizeT = setTimeout(()=>{ measureDepth(); measureIntroRange(); }, 150);
  });

  let mouseX = window.innerWidth/2, mouseY = window.innerHeight/2;
  let tiltX = 0, tiltY = 0;

  window.addEventListener('mousemove', (e)=>{
    mouseX = e.clientX;
    mouseY = e.clientY;
  });
  window.addEventListener('touchmove', (e)=>{
    const t = e.touches && e.touches[0];
    if(!t) return;
    mouseX = t.clientX;
    mouseY = t.clientY;
  }, { passive:true });

  // how far the cube tumbles per pixel scrolled, tied to the page's
  // total scroll so it keeps turning no matter how long the visitor
  // keeps scrolling, up or down, with no clamp. Read directly in the
  // rAF loop below rather than on a separate 'scroll' listener —
  // frame() already runs every frame, so a second listener would just
  // be redundant work on every raw scroll event.
  const DEG_PER_PX = 0.2;
  // pitch swings +/-120 degrees around BASE_RX as you scroll, which
  // comfortably sweeps past +/-90 (the angle that brings the top or
  // bottom face flat to the camera) — a plain yaw-only spin can only
  // ever cycle the four side faces and structurally can't reach those
  // two, no matter how far you scroll
  const TUMBLE_AMP = 120;

  // base viewing angle at rest (matches the reference photo: looking
  // slightly down at a corner, seeing the top plus two side faces),
  // plus a gentle cursor-driven wobble layered on top of the tumble
  const BASE_RX = -24;
  const BASE_RY = -38;
  const MAX_TILT = 14;

  // clicking a face zooms the cube to look at it head-on; the values
  // are the cube rotation that exactly cancels that face's own fixed
  // rotation (see the face--* transforms in style.css)
  const FACE_ANGLES = {
    front:  { rx: 0,   ry: 0 },
    back:   { rx: 0,   ry: 180 },
    top:    { rx: -90, ry: 0 },
    bottom: { rx: 90,  ry: 0 },
    right:  { rx: 0,   ry: -90 },
    left:   { rx: 0,   ry: 90 },
  };
  const FOCUS_SCALE = 1.4;
  const sticky = stage.closest('.cube-sticky');

  // the section's intro range, in viewport-heights: 0 = the very top
  // of the section's scroll (nothing visible yet), 1 = fully settled,
  // tumble takes over from here on. Title finishes first, then there's
  // a deliberate pause, then the cube falls — slowly, over a long
  // stretch of the range rather than a quick snap — so the two beats
  // never overlap and the fall itself reads as smooth/subtle rather
  // than sudden.
  const INTRO_FALL_VH = 0.7;
  const TITLE_REVEAL_END = 0.06;
  const CUBE_FALL_START = 0.1;
  const CUBE_FALL_END = 0.5;

  function smoothstep(edge0, edge1, x){
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  }
  // a gentle bounce-settle — overshoots just slightly past rest, then
  // eases back, like it settles into the floor rather than either
  // stopping dead or springing hard. c1 is deliberately much softer
  // than the standard "back" ease (1.70158) for an elegant landing
  // rather than a bouncy/springy one.
  function easeOutBounceSoft(x){
    const c1 = 1.12, c3 = c1 + 1;
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
  }

  let focusedFace = null;
  let curRx = BASE_RX, curRy = BASE_RY, curScale = 1;

  function focusFace(key, faceEl){
    if(focusedFace === key) return;
    dismissHint();
    if(!focusedFace){
      if(window.Papi && window.Papi.lockScroll) window.Papi.lockScroll();
      if(sticky) sticky.classList.add('is-focused');
    }
    focusedFace = key;
    // a bright flash on the label itself, like a ray of light just
    // caught it, right as it snaps into focus — self-removing so it's
    // free to replay the next time any face (including this same one)
    // is focused again
    const label = faceEl && faceEl.querySelector('.face-label');
    if(label){
      label.classList.remove('is-shining');
      void label.offsetWidth;
      label.classList.add('is-shining');
      label.addEventListener('animationend', ()=> label.classList.remove('is-shining'), { once:true });
    }
  }
  function unfocusFace(){
    if(!focusedFace) return;
    focusedFace = null;
    if(window.Papi && window.Papi.unlockScroll) window.Papi.unlockScroll();
    if(sticky) sticky.classList.remove('is-focused');
  }

  cube.addEventListener('click', (e)=>{
    const faceEl = e.target.closest('.face');
    if(!faceEl) return;
    e.stopPropagation();
    const cls = Array.from(faceEl.classList).find(c => c.indexOf('face--') === 0);
    const key = cls && cls.slice('face--'.length);
    if(!key || !FACE_ANGLES[key]) return;
    if(focusedFace === key) unfocusFace();
    else focusFace(key, faceEl);
  });
  // clicking anywhere outside a face (even elsewhere within the stage,
  // or anywhere else on the page) releases focus and resumes scroll
  document.addEventListener('click', ()=>{ if(focusedFace) unfocusFace(); });

  // the visible "tap to exit" hint that appears while zoomed in — this
  // would already work via the document-level handler above (it's
  // outside .cube-stage), but wiring it explicitly keeps that intent
  // obvious rather than relying on event bubbling
  const exitHint = document.getElementById('cubeExitHint');
  if(exitHint){
    exitHint.addEventListener('click', (e)=>{
      e.stopPropagation();
      unfocusFace();
    });
  }

  function frame(){
    // this loop runs forever regardless of scroll position, doing a
    // forced-layout getBoundingClientRect() read plus several style
    // writes every single frame — harmless while the section is
    // actually on screen, but with nothing gating it, it kept doing
    // that same work the entire time the visitor was scrolling through
    // *other* sections too, competing for main-thread time with
    // whatever those sections were animating. That contention is what
    // showed up as the cube itself hitching/freezing for a moment
    // partway through its own section's scroll. Skipping the work
    // outright while the section isn't visible removes that
    // competition; everything here is a pure function of the current
    // scroll position, so there's no accumulated state to pick back up
    // — it just recomputes fresh the moment it's back in view.
    const sectionRect = section ? section.getBoundingClientRect() : null;
    const sectionVisible = !sectionRect || (sectionRect.bottom > 0 && sectionRect.top < window.innerHeight);
    if(!sectionVisible){
      requestAnimationFrame(frame);
      return;
    }

    const rect = stage.getBoundingClientRect();
    const cx = rect.left + rect.width/2;
    const cy = rect.top + rect.height/2;
    const normX = Math.max(-1, Math.min(1, (mouseX - cx) / (rect.width/2 || 1)));
    const normY = Math.max(-1, Math.min(1, (mouseY - cy) / (rect.height/2 || 1)));

    tiltX += (normX - tiltX) * 0.045;
    tiltY += (normY - tiltY) * 0.045;

    // counts from the moment the section's top edge crosses into the
    // viewport from the bottom (same convention as the quote form's
    // reveal), not only once it's scrolled all the way up to the very
    // top — waiting for that left a dead stretch where the section was
    // already on screen (title-dock had already swapped to
    // "Principles") but nothing here had started appearing yet, which
    // read as scrolling into an empty page
    const introRaw = Math.max(0, Math.min(1, (window.scrollY - sectionTop + viewportH) / (introRange || 1)));

    // --- title: each word rises and comes into focus in turn, tied
    // directly to scroll position (not a fixed-duration animation, so
    // it can never finish playing before the visitor actually looks) ---
    const n = eyebrowWords.length;
    if(n){
      const spread = TITLE_REVEAL_END * 0.55; // how much of the window is spent staggering word starts
      const dur = TITLE_REVEAL_END * 0.55;    // each word's own reveal length (overlaps the next word's start)
      for(let i=0;i<n;i++){
        const start = n > 1 ? (i / (n - 1)) * spread : 0;
        const p = smoothstep(start, start + dur, introRaw);
        const el = eyebrowWords[i];
        el.style.opacity = p.toFixed(3);
        el.style.transform = `translateY(${((1 - p) * 16).toFixed(1)}px)`;
        el.style.filter = `blur(${((1 - p) * 5).toFixed(2)}px)`;
      }
    }

    // --- cube: invisible (opacity 0, not just off-position) until the
    // title has fully revealed and a beat has passed, then fades in
    // and drops slowly, smoothly, from just under the hero edge ---
    const cubeRaw = smoothstep(CUBE_FALL_START, CUBE_FALL_END, introRaw);
    const cubeEased = easeOutBounceSoft(cubeRaw);

    // the tumble only starts accumulating once the fall has landed —
    // scrolling through the intro itself doesn't also spin the cube.
    // Clamped to the section's own end, too — past that point the
    // visitor has moved on to the next section, and without this the
    // cube kept tumbling based on scroll that had nothing to do with
    // it anymore, which showed up as it seeming to move on its own
    // right around when the next section came into view.
    const clampedScrollY = Math.min(window.scrollY, sectionEndScrollY);
    const postIntroScroll = Math.max(0, clampedScrollY - sectionTop - introRange + viewportH);
    const scrollRotation = postIntroScroll * DEG_PER_PX;

    // over the last viewport-height of this section's own scroll (i.e.
    // as the visitor approaches the next section), ease the tumble
    // back to its neutral resting angle instead of leaving the cube
    // wherever it happened to be spinning — otherwise it kept rotating
    // right up until the section boundary and the visitor would land
    // on the next section with it stuck mid-spin
    const distFromSectionEnd = Math.max(0, sectionEndScrollY - clampedScrollY);
    const recenterT = 1 - smoothstep(0, viewportH || 1, distFromSectionEnd);

    // a small continuous drift once the title has revealed, tied
    // directly to ongoing scroll rather than time — otherwise, once
    // its own reveal finished, it sat completely inert for the entire
    // rest of the (very long) section while only the cube's rotation
    // gave any sign scrolling was still doing anything. Fades out
    // alongside the tumble as the cube recenters near the section end.
    if(eyebrowEl){
      const driftY = Math.sin(postIntroScroll * 0.0035) * 5 * (1 - recenterT);
      eyebrowEl.style.transform = `translateY(${driftY.toFixed(1)}px)`;
    }

    // show the interaction hint once it's landed; dismiss it for good
    // once the visitor has actually tumbled it a bit (or clicked, per
    // dismissHint() in focusFace above) — it's done its job either way
    if(interactHint && !hintDismissed){
      if(cubeRaw >= 0.98) interactHint.classList.add('is-visible');
      if(scrollRotation > 15) dismissHint();
    }

    let targetRx, targetRy, targetScale;
    if(focusedFace){
      const a = FACE_ANGLES[focusedFace];
      targetRx = a.rx;
      targetRy = a.ry;
      targetScale = FOCUS_SCALE;
    } else {
      // the tumble and cursor-tilt contributions both fade out as
      // recenterT climbs, unwinding smoothly back to BASE_RX/BASE_RY
      // rather than jumping — recenterT itself only starts moving off
      // 0 within the last viewport-height of scroll, so this never
      // touches the tumble during the rest of the section
      const settle = 1 - recenterT;
      targetRx = BASE_RX + (Math.sin(scrollRotation * Math.PI / 180) * TUMBLE_AMP - tiltY * MAX_TILT * 0.5) * settle;
      targetRy = BASE_RY + (scrollRotation + tiltX * MAX_TILT) * settle;
      // just a hint bigger while still dropping in, settling to its
      // normal size right as it lands — subtle on purpose
      targetScale = 1 + (1 - cubeEased) * 0.08;
    }

    curRx += (targetRx - curRx) * 0.12;
    curRy += (targetRy - curRy) * 0.12;
    curScale += (targetScale - curScale) * 0.12;
    cube.style.transform = `scale(${curScale.toFixed(3)}) rotateX(${curRx.toFixed(2)}deg) rotateY(${curRy.toFixed(2)}deg)`;

    // the fall itself lives on the group (not the wrap or cube, which
    // already own the idle-float CSS animation and the rotate/scale
    // above) so none of these transforms fight each other. A modest
    // distance — "falling from just under the hero," not from way up —
    // and opacity (not position) is what guarantees it's fully hidden
    // beforehand, regardless of where it happens to sit.
    // derived from the cached introRange (not a fresh window.innerHeight
    // read) for the same reason introRange itself is cached — avoids
    // the fall distance drifting mid-gesture on iOS
    const fallDistance = introRange * 0.25;
    const fallY = -fallDistance * (1 - cubeEased);
    group.style.opacity = cubeRaw.toFixed(3);
    group.style.transform = `translateY(${fallY.toFixed(1)}px)`;

    // the background glow orbits on the same scroll angle (kept bounded
    // via sin/cos regardless of how far scrollRotation has climbed),
    // plus a small additional cursor-driven push for extra depth
    const orbitRad = scrollRotation * Math.PI / 180;
    for(let i=0;i<glows.length;i++){
      const o = ORBIT[i] || ORBIT[0];
      const orbitX = Math.cos(orbitRad + o.phase) * o.rx;
      const orbitY = Math.sin(orbitRad + o.phase) * o.ry;
      const cursorX = tiltX * o.rx * 0.35;
      const cursorY = tiltY * o.ry * 0.35;
      glows[i].style.transform = `translate3d(${(orbitX + cursorX).toFixed(1)}px, ${(orbitY + cursorY).toFixed(1)}px, 0)`;
    }

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
