/* ===================================================================
   Papi — hero "Papi" liquid-follow + persistent-nav scroll state
   Two separate jobs live in this one file: the hero's own "Papi" word
   (fading in as hero-slime.js's own intro liquid-bubble opens up
   around it, then a perpetual idle ripple + cursor-push + liquid-
   follow loop, never fading out again — see flowLetterFrame) and the
   social icon row's one-time entrance, plus — entirely independent of
   the hero — driving the persistent nav's (#siteHeader) own scroll-
   dependent state: a dark-on-light text flip while it's still
   transparent and over one of the site's two light zones (the hero,
   and the contrast section further down), and a solid background once
   it's been scrolled past the hero (see .is-solid in style.css) so it
   sits cleanly on top of later sections' own pinned content instead of
   needing to duck out of the way of it. An earlier version of this
   file drove a small crossfading corner label here instead of a real
   nav — retired once the hero gained one with actual destinations.

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
  const siteHeader = document.getElementById('siteHeader');
  const heroSlimeCanvas = document.getElementById('heroSlime');

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
  // the canvas's own current position relative to the viewport — see
  // the comment on updateFieldFollow below for why this exists: it
  // used to be safe to assume window.Papi.getPoints()' canvas-local
  // coordinates WERE page coordinates, because #heroSlime used to fill
  // the entire hero starting at the very top of the page. Now that the
  // canvas is confined to .hero-visual-col (the right-hand column, no
  // longer starting at viewport (0,0)), that assumption breaks unless
  // this offset is folded in. Measured in the SAME call as the letters'
  // own getBoundingClientRect() below (computeFlowHomes), not on some
  // independent timer — both need to reflect the exact same scroll
  // position for the arithmetic to stay consistent (getBoundingClientRect
  // is always viewport-relative, i.e. it shifts as the page scrolls;
  // as long as both this offset and every st.homeX/Y are captured
  // together, the DIFFERENCE between them stays correct regardless of
  // how much scrolling happens afterward, since neither side is ever
  // live-updated mid-scroll — see updateFieldFollow for how they're
  // recombined).
  let canvasOffsetX = 0, canvasOffsetY = 0;
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
  // the word's own fixed home centre (average of every letter's own
  // natural, undisturbed position) — "Papi" is now pinned here at all
  // times (see updateFieldFollow below); it no longer travels around
  // chasing whichever liquid point is nearest, now that the liquid
  // roams the WHOLE hero rather than staying confined near the word.
  let homeCenterX = 0, homeCenterY = 0;
  function computeFlowHomes(){
    if(heroSlimeCanvas){
      const cr = heroSlimeCanvas.getBoundingClientRect();
      canvasOffsetX = cr.left;
      canvasOffsetY = cr.top;
    }
    let sumX = 0, sumY = 0;
    flowLetterState.forEach(st=>{
      const r = st.el.getBoundingClientRect();
      st.homeX = r.left + r.width/2;
      st.homeY = r.top + r.height/2;
      st.halfExtent = Math.sqrt((r.width/2)**2 + (r.height/2)**2);
      sumX += st.homeX; sumY += st.homeY;
    });
    if(flowLetterState.length){
      homeCenterX = sumX / flowLetterState.length;
      homeCenterY = sumY / flowLetterState.length;
      flowLetterState.forEach(st=>{
        st.homeOffX = st.homeX - homeCenterX;
        st.homeOffY = st.homeY - homeCenterY;
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
  const EDGE_PUSH_BUFFER = 6;     // extra px beyond a letter's own half-extent for the real-time inward-push
                                   // check below (getInwardPush) — a little slack so the correction kicks in
                                   // just before a letter would actually reach the true edge, not right at it
  // how far outside the liquid's own real edge "Papi" is pinned to still
  // count as "the liquid came back" — measured in canvas-height units so
  // it scales with screen size, same convention as driftPx below
  const HOME_CAPTURE_RANGE = 0.30;
  // 0 = the liquid is nowhere near Papi's pinned spot (word just sits at
  // home, rippling/reacting to the cursor as always); 1 = the liquid's
  // real edge already reaches home (word rides it exactly like before
  // this pin behaviour existed) — read by flowLetterFrame below to also
  // fade the edge-repulsion push in/out, not just position tracking.
  let latestCaptureT = 0;
  // recomputes every letter's field-follow target this frame and sends
  // updated size requests to hero-slime.js — see the file-level comment
  // above for the overall approach. `snap`, true only on the very first
  // call right after the intro bubble finishes, sets each letter's
  // offset directly to its target instead of easing into it (matching
  // this file's existing convention of a hard snap at handoff, not a
  // visible slide-in from nothing).
  //
  // "Papi" is now pinned at its own fixed home spot (homeCenterX/Y) at
  // all times — it no longer travels around the hero chasing whichever
  // liquid point is nearest, now that the liquid roams the WHOLE hero
  // rather than staying confined to the word's own corner of it (see
  // hero-slime.js's own #heroSlime CSS comment). Instead: find whichever
  // real point is nearest home, and only pull the word toward riding it
  // — using the same shared-anchor/peel-off mechanics as before — once
  // that point's actual edge has drifted close enough to genuinely be
  // "back" at Papi's spot. captureT (0..1) eases that pull in and out
  // smoothly rather than snapping, so the handoff reads as the liquid
  // reaching Papi, not a sudden jump.
  // persisted (not re-derived from scratch every frame) so the "which
  // real point is nearest" search below can require a genuine, clearly
  // better candidate before switching — without this, two points sitting
  // at similar distances flip back and forth as sub-pixel noise nudges
  // them, and every flip snapped the target (and the drift-clamped
  // displayed position right along with it, well outside what
  // FIELD_FOLLOW_LERP's slow easing implies) to a completely different
  // real point instantly. That flicker between two almost-equally-near
  // points, not any one single large jump, is what actually read as
  // "Papi glitching in place."
  let primaryIdx = 0;
  // only switch to a new nearest point once it's at least this much
  // closer than the one currently held — a plain "always take the
  // strictly closest" comparison switches on every frame two points
  // happen to cross paths, which given the wander noise driving them is
  // constant.
  const ANCHOR_SWITCH_MARGIN = 0.82;
  function updateFieldFollow(snap){
    if(!(window.Papi && window.Papi.getPoints && window.Papi.getCanvasSize)) return;
    const pts = window.Papi.getPoints();
    const size = window.Papi.getCanvasSize();
    const cw = size.width, ch = size.height;
    if(!cw || !ch || !pts.length) return;

    // + canvasOffsetX/Y — converts each point's canvas-LOCAL position
    // into the same frozen-viewport frame st.homeX/Y are captured in
    // (see the comment on canvasOffsetX above); radius needs no offset,
    // only position does.
    const ptsPx = pts.map(p => ({ x: p.x*cw + canvasOffsetX, y: p.y*ch + canvasOffsetY, radius: p.radius*ch }));
    // small fixed wobble/lag budget, scaled to the canvas rather than a
    // flat pixel count so it reads proportionally the same across
    // screen sizes — independent of any letter's own fit requirement,
    // so the two can never combine to ask for more room than was
    // actually reserved (see the sizeRequests math below)
    const driftPx = ch * 0.02;

    // whichever real point is nearest Papi's fixed home spot right now —
    // sticky (see ANCHOR_SWITCH_MARGIN above): only reassigned when a
    // candidate is clearly better than whichever index is already held,
    // not just technically closer by a hair.
    if(primaryIdx >= ptsPx.length) primaryIdx = 0;
    let curDist = Math.hypot(ptsPx[primaryIdx].x-homeCenterX, ptsPx[primaryIdx].y-homeCenterY);
    for(let j=0;j<ptsPx.length;j++){
      if(j === primaryIdx) continue;
      const d = Math.hypot(ptsPx[j].x-homeCenterX, ptsPx[j].y-homeCenterY);
      if(d < curDist * ANCHOR_SWITCH_MARGIN){ primaryIdx = j; curDist = d; }
    }
    const nearest = ptsPx[primaryIdx];
    const distToHome = curDist;
    // <=0 once the liquid's own real edge already reaches home; ramps
    // out to HOME_CAPTURE_RANGE*ch further beyond that
    const gap = distToHome - nearest.radius;
    const captureRangePx = ch * HOME_CAPTURE_RANGE;
    const captureT = 1 - smoothstep(0, captureRangePx, gap);
    latestCaptureT = captureT;

    primaryAnchorPageX = nearest.x;
    primaryAnchorPageY = nearest.y;

    const sizeRequests = new Array(ptsPx.length).fill(0);

    flowLetterState.forEach(st=>{
      const idealX = primaryAnchorPageX + st.homeOffX;
      const idealY = primaryAnchorPageY + st.homeOffY;
      const neededR = st.halfExtent*LETTER_FIT_SAFETY + driftPx;
      const distToPrimary = Math.sqrt((idealX-primaryAnchorPageX)**2 + (idealY-primaryAnchorPageY)**2);

      let rideX = st.homeX, rideY = st.homeY;
      if(captureT > 0.01){
        // only ask the nearby point to grow enough to cover me at my
        // natural word-relative spot while it's actually in play
        // (captureT > 0) — asking a point that's still far from home to
        // balloon out just to reach it would visibly drag the liquid
        // toward Papi rather than the other way around.
        sizeRequests[primaryIdx] = Math.max(sizeRequests[primaryIdx], (distToPrimary+neededR)/ch * captureT);
        if(distToPrimary + neededR <= ptsPx[primaryIdx].radius){
          // the shared point already (for real, using its current
          // rendered radius, not a hoped-for one) covers me here
          rideX = idealX; rideY = idealY;
        } else {
          // not currently covered riding the group — peel off and ride
          // whichever real point is nearest to where I was last riding,
          // guaranteeing I'm always somewhere the liquid actually is
          // right now, never floating in empty space between blobs.
          // Same sticky margin as the shared anchor above and for the
          // same reason — this per-letter fallback used to be re-picked
          // from scratch every frame too, which could flip a peeled-off
          // letter between two real points independently of (and just
          // as visibly as) the shared-anchor flicker.
          if(st.rideIdx === undefined || st.rideIdx >= ptsPx.length) st.rideIdx = primaryIdx;
          let bd = Math.hypot(ptsPx[st.rideIdx].x-st.anchorPageX, ptsPx[st.rideIdx].y-st.anchorPageY);
          for(let j=0;j<ptsPx.length;j++){
            if(j === st.rideIdx) continue;
            const d = Math.hypot(ptsPx[j].x-st.anchorPageX, ptsPx[j].y-st.anchorPageY);
            if(d < bd * ANCHOR_SWITCH_MARGIN){ st.rideIdx = j; bd = d; }
          }
          // a fraction of this letter's own natural spacing, not the
          // point's raw centre — without this, any two letters that
          // both happen to peel off onto the SAME point landed at the
          // exact same position and rendered fully overlapping (glyphs
          // stacked on top of each other), which read as a glitch/pop
          // the instant it happened. A partial offset (not the full
          // homeOffX/Y — that's what didn't fit here in the first
          // place) keeps them visibly separate while still hugging the
          // point they're actually riding.
          const peelOffX = st.homeOffX*0.4, peelOffY = st.homeOffY*0.4;
          rideX = ptsPx[st.rideIdx].x + peelOffX;
          rideY = ptsPx[st.rideIdx].y + peelOffY;
          const peelNeededR = Math.hypot(peelOffX, peelOffY) + neededR;
          sizeRequests[st.rideIdx] = Math.max(sizeRequests[st.rideIdx], peelNeededR/ch * captureT);
        }
      }
      st.anchorPageX = rideX; st.anchorPageY = rideY;

      // blends between "stay put at home" (captureT 0) and "ride the
      // liquid" (captureT 1) — this is the actual pin behaviour: far
      // from home the target collapses to st.homeX/Y exactly (offset 0),
      // and only eases toward the real ride position as the liquid's
      // own edge genuinely approaches.
      const targetX = st.homeX + (rideX - st.homeX) * captureT;
      const targetY = st.homeY + (rideY - st.homeY) * captureT;

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
  // resize isn't the only thing that can move the letters/canvas out
  // from under their own frozen homeX/Y + canvasOffsetX/Y (see the
  // comment on canvasOffsetX above) — a web font finishing its swap
  // after the handoff already ran, or images further down the hero
  // (the trusted-by logo icons, say) finishing load and nudging layout,
  // can too, and neither fires a 'resize' event. Re-measuring once
  // fonts are actually ready and once the whole page has fully loaded
  // — the same two extra checkpoints measureZones() below already uses
  // for the same class of problem — plus one short delayed re-check as
  // a last safety net for anything that settles just after that, is
  // what actually keeps "Papi" from drifting out of sync with the
  // liquid it's supposed to be riding after a late reflow like that.
  if(document.fonts && document.fonts.ready){
    document.fonts.ready.then(()=>{ if(flowEffectsLive) computeFlowHomes(); });
  }
  window.addEventListener('load', ()=>{ if(flowEffectsLive) computeFlowHomes(); });

  // ripple (a continuous idle wave through the letters) + cursor push,
  // combined into one transform per letter per frame — see the note
  // above on why this replaced a plain CSS animation.
  const FLOW_PUSH_RADIUS = 85;
  // lowered (was 0.34) — a lighter cursor touch on the letters
  // themselves, so a passing cursor reads as a gentle ripple rather
  // than a shove strong enough to push a letter toward the liquid's
  // real edge (see EDGE_PUSH_MARGIN/getInwardPush further down, which
  // now catches this offset too, but a smaller push to begin with
  // means that correction rarely has to do much work)
  const FLOW_PUSH = 0.15;
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
      // one more re-measure shortly after handoff, as a last safety net
      // on top of the fonts.ready/load listeners above — covers
      // anything that nudges layout in the brief window right after
      // the intro finishes (a font swap or image load landing at
      // exactly the wrong moment) without waiting on a 'resize' event
      // that might never come.
      setTimeout(()=>{ if(flowEffectsLive) computeFlowHomes(); }, 1000);
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
        let totalX = st.offX + st.x;
        let totalY = st.offY + st.y + rippleY;
        // the liquid's own outline physically repelling the letter —
        // applied last, directly to the FINAL position (after tracking,
        // ripple, and cursor-push have all already been added), so it
        // catches every source of displacement rather than just the
        // field-follow target. window.Papi.getInwardPush samples the
        // real, current liquid shape (hero-slime.js's own field(), not
        // an estimate) and returns however much correction is needed to
        // stay at least marginPx inside — {0,0} if already safely
        // inside — so this is a hard floor, not a spring: whatever the
        // letter's own physics computed, it can never actually end up
        // outside. getInwardPush expects canvas-LOCAL coordinates (it
        // has no idea where its own canvas sits in the viewport), so
        // canvasOffsetX/Y — the same offset used above for ptsPx, just
        // subtracted instead of added — converts back from this file's
        // frozen-viewport frame into that local space first.
        // ramped by latestCaptureT over a wide band (smoothstep, not a
        // hard cutoff) — while the liquid is far from Papi's pinned spot
        // (captureT near 0) this stays a no-op, since there's no nearby
        // real liquid for the word to be "contained" by (and sampling
        // getInwardPush way out there would return a correction the size
        // of that whole gap, snapping the letter toward the distant
        // liquid). A hard on/off toggle at a single threshold was tried
        // first and caused a visible stutter every time captureT drifted
        // back and forth across that one value — this ramp reaches full
        // strength by captureT 0.65 (the ORIGINAL hard-floor behaviour:
        // whatever the letter's tracking, ripple, and cursor-push physics
        // computed, it still can never actually end up outside the
        // liquid it's supposedly riding) but gets there smoothly.
        if(window.Papi && window.Papi.getInwardPush && latestCaptureT > 0.001){
          const pushT = smoothstep(0.35, 0.65, latestCaptureT);
          const marginPx = st.halfExtent + EDGE_PUSH_BUFFER;
          const push = window.Papi.getInwardPush(st.homeX+totalX-canvasOffsetX, st.homeY+totalY-canvasOffsetY, marginPx);
          totalX += push.dx * pushT; totalY += push.dy * pushT;
        }
        st.el.style.transform = `translate(${totalX.toFixed(2)}px, ${totalY.toFixed(2)}px) skewX(${skew.toFixed(2)}deg)`;
      });
    }
    requestAnimationFrame(flowLetterFrame);
  }
  requestAnimationFrame(flowLetterFrame);

  window.Papi = window.Papi || {};
  window.Papi.revealSocial = revealSocial;

  const heroEl = document.getElementById('hero');
  const contrastSectionEl = document.getElementById('contrastSection');

  // the persistent nav (see .site-header in style.css) needs two
  // scroll-driven things: a dark-on-light flip for its own text while
  // it's still transparent and over one of the site's two light zones
  // (the hero, and the contrast section further down), and a solid
  // background once it's left the hero entirely — see .is-solid, which
  // is what actually keeps it from colliding with .contrast-sticky/
  // .showcase-sticky once those sections pin their own content to the
  // viewport's top edge. Both only depend on scroll position and a
  // couple of section boundaries, measured once (not on every scroll
  // event — offsetTop/offsetHeight force a synchronous layout read)
  // and re-measured on resize/fonts-ready, same convention as the rest
  // of this file and contrast.js's own sizing.
  let heroHeight = 0;
  let contrastTop = 0, contrastBottom = 0;
  function measureZones(){
    heroHeight = heroEl ? heroEl.offsetHeight : 0;
    if(contrastSectionEl){
      contrastTop = contrastSectionEl.offsetTop;
      contrastBottom = contrastTop + contrastSectionEl.offsetHeight;
    }
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

  function update(){
    // the nav's own text only needs to flip to dark-on-light while
    // it's BOTH still transparent AND over one of this site's white
    // zones — the hero (a plain white background now, always) and the
    // contrast section, also white. Every other section has a dark
    // background, where the static gold/cream text already reads fine
    // on its own. (See .site-header:not(.is-solid) in style.css for
    // the other half of that scoping.)
    const onHero = window.scrollY < heroHeight;
    const onContrast = contrastSectionEl
      ? window.scrollY >= contrastTop && window.scrollY < contrastBottom
      : false;
    document.body.classList.toggle('on-light-section', onHero || onContrast);
    // solid background as soon as the hero's been scrolled past — see
    // the comment above this function for why (keeps the nav sitting
    // cleanly on top of later sections' own pinned content instead of
    // needing to duck out of the way of it, the way the old small
    // corner brand mark used to).
    if(siteHeader) siteHeader.classList.toggle('is-solid', !onHero);
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
