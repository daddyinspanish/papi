/* ===================================================================
   Papi — title interaction
   - Entrance (window.Papi.revealTitle, called from loader.js), a
     choreographed sequence rather than a uniform per-letter stagger:
     "Built with " flies in from the left, "purpose" flies in from the
     right, then "not", "just", "design" each bounce into place one
     after another.
   - Slow, smooth gyro tilt toward the cursor, strongest near the title.
   - As the visitor scrolls the hero away, each of the title's letters
     drifts outward from the title's own centre and grows slightly
     while fading — like the words are expanding out into the field's
     orbiting cluster — rather than the wave-like ripple this used to
     do. The subtitle instead sinks straight down as one line and
     fades, rather than repeating the title's own explode. Both are
     purely a function of the current scroll position (not an
     accumulated value), so they reverse cleanly back to normal on
     their own if the visitor scrolls back up. The same per-letter
     push/ripple physics runs on both, once each one's own entrance
     (owned by title-dock.js for the subtitle) has settled.
   - Moving the cursor near the title (or subtitle) pushes the nearby
     letters apart, like they're being parted, then they spring back.
=================================================================== */
(function(){
  const title = document.getElementById('heroTitle');
  if(!title) return;
  const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function smoothstep(edge0, edge1, x){
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  }

  // scales a flat per-frame lerp rate by how much real time actually
  // passed, capped so a very long gap still glides quickly rather than
  // snapping in one frame — see the matching note on curExplodeProgress
  // below for what this fixes and why (the exact bug pattern already
  // found and fixed this week in reviews-cube.js's own rotation easing)
  function timeAlpha(perFrameRate, dt, cap){
    return Math.min(cap, 1 - Math.pow(1 - perFrameRate, dt / 16.6667));
  }

  // ---- shared per-character "parting" push physics + scroll-driven
  // outward "explode" — used for both the title and the subtitle, so
  // the two share one implementation instead of two copies of the same
  // formulas ----
  const PUSH_RADIUS = 85;
  const PUSH = 0.34;
  const SPRING = 0.05;
  const DAMPING = .82;
  const EXPLODE_DISTANCE = 150; // px a letter drifts outward at full progress
  const EXPLODE_SCALE = 0.55;   // extra scale a letter grows to at full progress
  const DROP_DISTANCE = 80;     // px the subtitle sinks by at full progress
  const DROP_SHRINK = 0.15;     // extra shrink the subtitle settles into as it sinks

  let mouseX = window.innerWidth/2, mouseY = window.innerHeight/2;

  // exitMode 'explode' (default, the title) drifts each letter outward
  // from the group's own centre as it fades; 'drop' (the subtitle)
  // sinks the whole line straight down instead — a distinct exit so
  // the subtitle doesn't just repeat the title's own effect
  function createCharGroup(chars, exitMode){
    const charState = chars.map(()=>({ homeX:0, homeY:0, x:0, y:0, vx:0, vy:0 }));
    // the group's own centre — each letter's outward "explode" drift
    // is measured from here, so the whole word expands outward from
    // its own middle rather than every letter drifting the same
    // direction
    let centerX = 0, centerY = 0;
    function computeHomes(){
      let sumX = 0, sumY = 0;
      chars.forEach((el, i)=>{
        const r = el.getBoundingClientRect();
        const hx = r.left + r.width/2;
        const hy = r.top + r.height/2;
        charState[i].homeX = hx;
        charState[i].homeY = hy;
        sumX += hx;
        sumY += hy;
      });
      centerX = sumX / chars.length;
      centerY = sumY / chars.length;
    }
    function update(idle, explodeProgress){
      chars.forEach((el, i)=>{
        const st = charState[i];
        if(!idle){
          const dx = (st.homeX + st.x) - mouseX;
          const dy = (st.homeY + st.y) - mouseY;
          const d = Math.sqrt(dx*dx + dy*dy) + 0.01;
          if(d < PUSH_RADIUS){
            const force = (1 - d/PUSH_RADIUS) * PUSH;
            const ang = Math.atan2(dy, dx);
            st.vx += Math.cos(ang) * force;
            st.vy += Math.sin(ang) * force;
          }
        }
        st.vx += (0 - st.x) * SPRING;
        st.vy += (0 - st.y) * SPRING;
        st.vx *= DAMPING;
        st.vy *= DAMPING;
        st.x += st.vx;
        st.y += st.vy;

        let ex = 0, ey = 0, escale = 1;
        if(explodeProgress > 0.001){
          if(exitMode === 'drop'){
            // straight down, uniformly — the whole line sinks together
            // rather than each letter scattering its own direction
            ey = explodeProgress * DROP_DISTANCE;
            escale = 1 - explodeProgress * DROP_SHRINK;
          } else {
            const dx = st.homeX - centerX;
            const dy = st.homeY - centerY;
            const dist = Math.hypot(dx, dy) || 1;
            ex = (dx / dist) * explodeProgress * EXPLODE_DISTANCE;
            ey = (dy / dist) * explodeProgress * EXPLODE_DISTANCE;
            escale = 1 + explodeProgress * EXPLODE_SCALE;
          }
        }
        el.style.transform = `translate(${(st.x + ex).toFixed(2)}px, ${(st.y + ey).toFixed(2)}px) scale(${escale.toFixed(3)})`;
      });
    }
    return { computeHomes, update };
  }

  // ---- title: split into per-letter spans, tagged by which entrance
  // group they belong to (em/br preserved). "purpose"'s letters are
  // spans nested inside <em> rather than the <em> itself being one
  // unit — the color styling still applies cleanly since color
  // inherits down to the nested spans, and this way "purpose" gets the
  // same letter-by-letter push/ripple physics as the rest of the title
  // instead of moving as one rigid block. ----
  const units = [];
  const groups = [];
  function appendGroup(parent, text, type, order){
    const startIdx = units.length;
    Array.from(text).forEach(ch=>{
      const span = document.createElement('span');
      span.className = 'char';
      span.textContent = ch === ' ' ? ' ' : ch;
      parent.appendChild(span);
      units.push(span);
    });
    groups.push({ type, order, startIdx, endIdx: units.length - 1 });
  }

  title.innerHTML = '';
  appendGroup(title, 'Built with ', 'fly-left', 0);
  const em = document.createElement('em');
  title.appendChild(em);
  appendGroup(em, 'purpose', 'fly-right', 1);
  title.appendChild(document.createElement('br'));
  appendGroup(title, 'not ', 'bounce', 2);
  appendGroup(title, 'just ', 'bounce', 3);
  appendGroup(title, 'design', 'bounce', 4);

  const chars = units;
  const groupOfIndex = new Array(chars.length);
  groups.forEach(g=>{
    for(let i=g.startIdx;i<=g.endIdx;i++) groupOfIndex[i] = g;
  });
  const titleGroup = createCharGroup(chars);

  // ---- title entrance: fly-left / fly-right / sequential bounce ----
  chars.forEach((el, i)=>{
    const g = groupOfIndex[i];
    el.style.transition = 'none';
    el.style.opacity = '0';
    if(g.type === 'fly-left') el.style.transform = 'translateX(-60vw)';
    else if(g.type === 'fly-right') el.style.transform = 'translateX(60vw)';
    else el.style.transform = 'translateY(-22px) scale(.6)';
  });

  let effectsLive = false;

  function computeHomes(){ titleGroup.computeHomes(); }

  function revealTitle(){
    revealEyebrow();
    const FLY_DURATION = 800;
    const FLY_EASE = 'cubic-bezier(.16,1,.3,1)';
    const BOUNCE_DURATION = 560;
    const BOUNCE_EASE = 'cubic-bezier(.34,1.56,.64,1)';
    const FLY_LEFT_START = 0;
    const FLY_RIGHT_START = 320;
    const BOUNCE_START_BASE = 980;
    const BOUNCE_STAGGER = 230;

    let maxEnd = 0;
    groups.forEach(g=>{
      const isBounce = g.type === 'bounce';
      const startDelay = g.type === 'fly-left' ? FLY_LEFT_START
        : g.type === 'fly-right' ? FLY_RIGHT_START
        : BOUNCE_START_BASE + (g.order - 2) * BOUNCE_STAGGER;
      const duration = isBounce ? BOUNCE_DURATION : FLY_DURATION;
      const ease = isBounce ? BOUNCE_EASE : FLY_EASE;

      setTimeout(()=>{
        for(let i=g.startIdx;i<=g.endIdx;i++){
          const el = chars[i];
          el.style.transition = `opacity .5s ease, transform ${duration}ms ${ease}`;
          el.style.opacity = '1';
          el.style.transform = 'translateY(0) translateX(0) scale(1)';
        }
      }, startDelay);

      const end = startDelay + duration;
      if(end > maxEnd) maxEnd = end;
    });

    setTimeout(()=>{
      chars.forEach(el => { el.style.transition = 'none'; });
      computeHomes();
      effectsLive = true;
    }, maxEnd + 80);
  }

  window.Papi = window.Papi || {};
  window.Papi.revealTitle = revealTitle;

  // splits text into per-letter spans for the push/ripple physics,
  // same as appendGroup above, but keeps each WORD wrapped in its own
  // no-wrap span first — splitting straight into individual letter
  // spans with nothing grouping them meant the browser's line-breaking
  // no longer knew a word and its own trailing punctuation (like the
  // comma right after "trust,") belonged together, and could wrap a
  // line between them — showing up on iPhone as a comma stranded alone
  // at the start of the next line. The letters inside each word wrapper
  // are still their own spans, so the per-letter physics is unaffected;
  // only the whitespace between words stays outside those wrappers, as
  // the actual breakable point a line can wrap at.
  function appendWordWrapped(parent, text, collector){
    text.split(/(\s+)/).forEach(part=>{
      if(part === '') return;
      if(/^\s+$/.test(part)){
        Array.from(part).forEach(()=>{
          const span = document.createElement('span');
          span.className = 'char';
          span.textContent = ' ';
          parent.appendChild(span);
          collector.push(span);
        });
        return;
      }
      const wordWrap = document.createElement('span');
      wordWrap.className = 'word-wrap';
      Array.from(part).forEach(ch=>{
        const span = document.createElement('span');
        span.className = 'char';
        span.textContent = ch;
        wordWrap.appendChild(span);
        collector.push(span);
      });
      parent.appendChild(wordWrap);
    });
  }

  // ---- subtitle: same per-letter ripple/push, once its own entrance
  // (a block "rolling into place," owned by title-dock.js) has settled.
  // Splitting it into spans here doesn't touch that entrance — it
  // still animates the whole element; these are just along for the ride
  // until the ripple physics takes over their individual transforms.
  // Sinks straight down and fades on scroll-exit ('drop' mode) rather
  // than repeating the title's own outward-explode effect.
  //
  // Only the static prefix ("Designed to build ") is split into these
  // per-letter spans — the rotating word after it (#heroSubWord) is
  // kept as one intact element instead, since its own text keeps
  // changing (see the scramble-cycle below) and needs a stable node to
  // rewrite, not 70 individual one-off letter spans rebuilt each time.
  // It still fades with the rest of #heroSub (title-dock.js fades the
  // whole element), just without the extra per-letter drift on exit. ----
  const sub = document.getElementById('heroSub');
  let subChars = [];
  let subGroup = null;
  let subEffectsLive = false;
  let subWordEl = null;
  if(sub){
    const prefixText = 'Designed to build ';
    sub.innerHTML = '';
    appendWordWrapped(sub, prefixText, subChars);
    subWordEl = document.createElement('span');
    subWordEl.className = 'sub-word';
    subWordEl.id = 'heroSubWord';
    sub.appendChild(subWordEl);
    subGroup = createCharGroup(subChars, 'drop');
  }
  window.addEventListener('papi:subtitlerevealed', ()=>{
    if(!subGroup) return;
    subGroup.computeHomes();
    subEffectsLive = true;
    startSubWordCycle();
  });

  // ---- subtitle's rotating word: a "decoding" scramble reveal rather
  // than a typewriter — every letter is visible immediately as random
  // glyphs, then each one locks into its real letter at its own
  // slightly-staggered moment, reading like a code/cipher resolving
  // rather than being typed out one character at a time. Cycles through
  // a fixed word list forever, holding on each real word for a beat. ----
  const SUB_WORDS = ['trust', 'direction', 'action'];
  const SCRAMBLE_CHARS = '!<>-_/[]{}=+*^?#01';
  function scrambleTo(el, text, duration, onDone){
    const len = text.length;
    const start = performance.now();
    // spread out when each letter "locks in" across most of the
    // duration, with a little randomness so they don't all resolve in
    // one visible wave left-to-right
    const lockTimes = Array.from({ length: len }, (_, i) =>
      (i / Math.max(1, len - 1)) * duration * 0.6 + Math.random() * duration * 0.4
    );
    function step(now){
      const elapsed = now - start;
      let out = '';
      for(let i=0;i<len;i++){
        out += elapsed >= lockTimes[i] ? text[i] : SCRAMBLE_CHARS[Math.floor(Math.random()*SCRAMBLE_CHARS.length)];
      }
      el.textContent = out;
      if(elapsed < duration){
        requestAnimationFrame(step);
      } else {
        el.textContent = text;
        if(onDone) onDone();
      }
    }
    requestAnimationFrame(step);
  }
  let subWordCycleStarted = false;
  function startSubWordCycle(){
    if(!subWordEl || subWordCycleStarted) return;
    subWordCycleStarted = true;
    if(prefersReducedMotion){ subWordEl.textContent = SUB_WORDS[0]; return; }
    const HOLD_MS = 1900;
    let idx = 0;
    function next(){
      scrambleTo(subWordEl, SUB_WORDS[idx], 650, ()=>{
        setTimeout(()=>{
          idx = (idx + 1) % SUB_WORDS.length;
          next();
        }, HOLD_MS);
      });
    }
    next();
  }

  // ---- eyebrow ("Est. Business-Ready Websites"): same per-letter
  // cursor push physics as the title/subtitle, plus its own entrance —
  // a per-letter "shine" sweep (a bright gold flash that settles to the
  // resting color) rather than a plain fade, echoing the loader's own
  // gold-fill-through-the-letters reveal so the two read as one brand
  // moment rather than two different techniques ----
  const eyebrow = document.getElementById('heroEyebrow');
  let eyebrowChars = [];
  let eyebrowGroup = null;
  let eyebrowEffectsLive = false;
  if(eyebrow){
    const text = eyebrow.textContent;
    eyebrow.innerHTML = '';
    appendWordWrapped(eyebrow, text, eyebrowChars);
    eyebrowGroup = createCharGroup(eyebrowChars);
  }
  function revealEyebrow(){
    if(!eyebrow || !eyebrowChars.length) return;
    const STAGGER = 26;
    const SHINE_DURATION = 700;
    eyebrowChars.forEach((el, i)=>{
      el.style.animation = `eyebrowShine ${SHINE_DURATION}ms ease forwards`;
      el.style.animationDelay = `${i * STAGGER}ms`;
    });
    const total = (eyebrowChars.length - 1) * STAGGER + SHINE_DURATION;
    setTimeout(()=>{
      eyebrowChars.forEach(el => { el.style.animation = 'none'; });
      eyebrowGroup.computeHomes();
      eyebrowEffectsLive = true;
    }, total + 60);
  }

  // width-only guard — on iOS Safari, scrolling for the very first time
  // in a session collapses the address bar, which fires a 'resize'
  // event that changes innerHeight but not innerWidth. Without this
  // check, that one resize would trigger a full recompute here: a
  // forced getBoundingClientRect() read for every one of the title's
  // and subtitle's 100+ individual letter spans, combined, landing
  // right at the exact moment of the first scroll — one real
  // contributor to something reacting badly right then.
  let lastResizeWTitle = window.innerWidth;
  window.addEventListener('resize', ()=>{
    const w = window.innerWidth;
    if(w === lastResizeWTitle) return;
    lastResizeWTitle = w;
    clearTimeout(window.__papiTitleResizeT);
    window.__papiTitleResizeT = setTimeout(()=>{
      if(effectsLive) computeHomes();
      if(subEffectsLive) subGroup.computeHomes();
    }, 200);
  });

  // ---- slow proximity-based tilt ----
  let curX = 0, curY = 0;
  let lastMoveTime = performance.now();
  const IDLE_MS = 1400; // the push/tilt effects release if the pointer sits still this long

  window.addEventListener('mousemove', (e)=>{
    mouseX = e.clientX;
    mouseY = e.clientY;
    lastMoveTime = performance.now();
  });
  window.addEventListener('touchmove', (e)=>{
    const t = e.touches && e.touches[0];
    if(!t) return;
    mouseX = t.clientX;
    mouseY = t.clientY;
    lastMoveTime = performance.now();
  }, { passive:true });

  const MAX_TILT = 9;
  const PROXIMITY_RANGE = 620;

  // ---- scroll-driven explode progress — 0 at the top of the hero,
  // ramping to 1 over the same stretch title-dock.js fades the hero
  // out over. Computed fresh from the current scroll position every
  // frame (not accumulated), so it just tracks backward on its own if
  // the visitor scrolls back up — no separate reverse logic needed. ----
  const EXPLODE_RANGE_RATIO = 0.95; // matches title-dock.js's own SCROLL_RANGE_RATIO
  function getExplodeProgress(){
    const dist = window.innerHeight * EXPLODE_RANGE_RATIO;
    const raw = Math.max(0, Math.min(1, window.scrollY / dist));
    return smoothstep(0.15, 0.9, raw);
  }
  // eased toward the raw scroll-based target rather than applied
  // directly — reading it straight off scroll position meant that if
  // a visitor scrolled down during the ~2s entrance sequence (before
  // effectsLive flips true and the per-char transform starts applying
  // at all), the very first frame it turned on could jump straight to
  // a large mid-scroll value with no ramp-up, since transitions are
  // deliberately turned off on these elements once the entrance ends.
  // That snap — plus everything needing a beat to catch up — is what
  // read as the hero "restarting" and freezing for a moment on scroll.
  //
  // the easing rate itself used to be a flat 0.06 "per frame" (assuming
  // ~16.7ms between frames) — scrolling back up quickly drops the
  // target fast, and closing only 6% of that gap per frame meant the
  // exploded letters visibly sat still, stuck out at their scrolled-out
  // position, for the better part of a second before catching back up
  // to their real (already-correct) home — reading exactly like a
  // freeze right as you scroll back. timeAlpha below scales the rate by
  // actual elapsed time and raises the base rate, so it converges in a
  // handful of frames regardless of frame timing, capped so it still
  // glides rather than teleporting after a real pause.
  let curExplodeProgress = 0;
  const heroElForTilt = document.getElementById('hero');
  let lastFrameTs = null;

  // heroBottom is measured once (plus on resize/fonts load), not read
  // live via getBoundingClientRect() on every single frame forever —
  // see the note below on what that forced-layout read was costing
  let heroBottom = heroElForTilt ? heroElForTilt.offsetHeight : 0;
  function measureHeroBottom(){
    heroBottom = heroElForTilt ? heroElForTilt.offsetTop + heroElForTilt.offsetHeight : 0;
  }
  requestAnimationFrame(measureHeroBottom);
  if(document.fonts && document.fonts.ready) document.fonts.ready.then(measureHeroBottom);
  window.addEventListener('load', measureHeroBottom);

  function frame(ts){
    if(ts === undefined) ts = performance.now();
    const dt = lastFrameTs === null ? 16.6667 : ts - lastFrameTs;
    lastFrameTs = ts;

    // this used to call heroElForTilt.getBoundingClientRect() every
    // single frame, forever, for the entire rest of the page visit,
    // long after the hero (and its title) had faded to invisible and
    // scrolled away — a forced-layout read plus a full physics update
    // across 100+ letter spans (title + subtitle combined) that has no
    // visible effect once the title's own opacity has already reached
    // 0. heroBottom above gives the same on/off-screen answer via
    // plain arithmetic against window.scrollY instead, with no forced
    // layout at all.
    const heroVisible = !heroElForTilt || window.scrollY < heroBottom;
    if(!heroVisible){
      requestAnimationFrame(frame);
      return;
    }

    const idle = performance.now() - lastMoveTime > IDLE_MS;

    const rect = title.getBoundingClientRect();
    const cx = rect.left + rect.width/2;
    const cy = rect.top + rect.height/2;
    const dist = Math.hypot(mouseX - cx, mouseY - cy);
    const proximity = idle ? 0 : Math.max(0, 1 - dist / PROXIMITY_RANGE);

    const normX = (mouseX - cx) / (rect.width/2 || 1);
    const normY = (mouseY - cy) / (rect.height/2 || 1);

    const targetX = Math.max(-1, Math.min(1, normX)) * proximity;
    const targetY = Math.max(-1, Math.min(1, normY)) * proximity;

    const tiltAlpha = timeAlpha(0.035, dt, 0.4);
    curX += (targetX - curX) * tiltAlpha;
    curY += (targetY - curY) * tiltAlpha;

    title.style.transform = `rotateX(${(-curY*MAX_TILT).toFixed(2)}deg) rotateY(${(curX*MAX_TILT).toFixed(2)}deg)`;

    const targetExplode = (effectsLive || subEffectsLive) ? getExplodeProgress() : 0;
    const explodeAlpha = timeAlpha(0.12, dt, 0.4);
    curExplodeProgress += (targetExplode - curExplodeProgress) * explodeAlpha;
    if(effectsLive) titleGroup.update(idle, curExplodeProgress);
    if(subEffectsLive) subGroup.update(idle, curExplodeProgress);
    if(eyebrowEffectsLive) eyebrowGroup.update(idle, 0);

    requestAnimationFrame(frame);
  }
  frame();
})();
