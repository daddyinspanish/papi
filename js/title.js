/* ===================================================================
   Papi — title interaction
   - Entrance (window.Papi.revealTitle, called from loader.js), a
     choreographed sequence rather than a uniform per-letter stagger:
     "Built with " flies in from the left, "purpose" flies in from the
     right, then "not", "just", "design" each bounce into place one
     after another.
   - Slow, smooth gyro tilt toward the cursor, strongest near the title.
   - As the visitor scrolls the hero away, each letter drifts outward
     from the title's own centre and grows slightly while fading —
     like the words are expanding out into the field's orbiting cluster
     — rather than the wave-like ripple this used to do. Purely a
     function of the current scroll position (not an accumulated
     value), so it reverses cleanly back to normal on its own if the
     visitor scrolls back up. The same physics runs on the subtitle's
     letters once its own entrance (owned by title-dock.js) has settled.
   - Moving the cursor near the title (or subtitle) pushes the nearby
     letters apart, like they're being parted, then they spring back.
=================================================================== */
(function(){
  const title = document.getElementById('heroTitle');
  if(!title) return;

  function smoothstep(edge0, edge1, x){
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
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

  let mouseX = window.innerWidth/2, mouseY = window.innerHeight/2;

  function createCharGroup(chars){
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
          const dx = st.homeX - centerX;
          const dy = st.homeY - centerY;
          const dist = Math.hypot(dx, dy) || 1;
          ex = (dx / dist) * explodeProgress * EXPLODE_DISTANCE;
          ey = (dy / dist) * explodeProgress * EXPLODE_DISTANCE;
          escale = 1 + explodeProgress * EXPLODE_SCALE;
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

  // ---- subtitle: same per-letter ripple/push, once its own entrance
  // (a block "rolling into place," owned by title-dock.js) has settled.
  // Splitting it into spans here doesn't touch that entrance — it
  // still animates the whole element; these are just along for the ride
  // until the ripple physics takes over their individual transforms. ----
  const sub = document.getElementById('heroSub');
  let subChars = [];
  let subGroup = null;
  let subEffectsLive = false;
  if(sub){
    const text = sub.textContent;
    sub.innerHTML = '';
    Array.from(text).forEach(ch=>{
      const span = document.createElement('span');
      span.className = 'char';
      span.textContent = ch === ' ' ? ' ' : ch;
      sub.appendChild(span);
      subChars.push(span);
    });
    subGroup = createCharGroup(subChars);
  }
  window.addEventListener('papi:subtitlerevealed', ()=>{
    if(!subGroup) return;
    subGroup.computeHomes();
    subEffectsLive = true;
  });

  window.addEventListener('resize', ()=>{
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
  let curExplodeProgress = 0;

  function frame(){
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

    curX += (targetX - curX) * 0.035;
    curY += (targetY - curY) * 0.035;

    title.style.transform = `rotateX(${(-curY*MAX_TILT).toFixed(2)}deg) rotateY(${(curX*MAX_TILT).toFixed(2)}deg)`;

    const targetExplode = (effectsLive || subEffectsLive) ? getExplodeProgress() : 0;
    curExplodeProgress += (targetExplode - curExplodeProgress) * 0.06;
    if(effectsLive) titleGroup.update(idle, curExplodeProgress);
    if(subEffectsLive) subGroup.update(idle, curExplodeProgress);

    requestAnimationFrame(frame);
  }
  frame();
})();
