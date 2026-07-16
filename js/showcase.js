/* ===================================================================
   Papi — showcase section
   A tall section with a sticky viewport inside it. As the visitor
   scrolls through it, business names rise into place one at a time in
   a vertical carousel on the right, while a fan of live-demo preview
   cards on the left flips through in sync — the current name's card
   straightens to the front, the rest recede into the fan. Cards and
   names are clickable — they jump the page straight to that trade.
   (The docked top-right section label is handled centrally in
   title-dock.js, which swaps it per section as you scroll.)
=================================================================== */
(function(){
  const section = document.getElementById('showcase');
  const sticky = document.querySelector('.showcase-sticky');
  const fanEl = document.getElementById('showcaseFan');
  const listEl = document.getElementById('showcaseItems');
  const phraseEl = document.getElementById('showcasePhrase');
  const titleEl = document.getElementById('showcaseTitle');
  // the quote anchors below the whole header block (title + subtitle),
  // so the subtitle's own bottom edge — not the title's — is the right
  // reference now that there are two lines here instead of one
  const eyebrowEl = document.querySelector('.showcase-subtitle');
  if(!section || !fanEl || !listEl) return;

  function smoothstep(edge0, edge1, x){
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  }

  // a small buzz each time the active trade changes — iOS doesn't
  // support the Vibration API at all (Safari has never implemented it,
  // and every browser on iOS is WebKit underneath, so that's true for
  // Chrome-on-iOS too), so this is silently a no-op there; it's a real,
  // felt effect on Android Chrome/Firefox, which do support it
  const canVibrate = 'vibrate' in navigator;
  function hapticTick(){
    if(canVibrate) navigator.vibrate(12);
  }

  // the whole sticky content (eyebrow, trade names, fan of cards) rises
  // and fades in together as the section approaches from below, tied
  // directly to scroll position rather than a fixed-duration animation
  // triggered once — a one-shot reveal could finish before or after
  // the visitor's own scroll speed, which is what made this section
  // feel like it was just "there" instantly rather than easing in.
  // Without this, the first card/name was already at full opacity and
  // scale (the carousel's own per-card math already has it fully
  // active at progress 0) the moment the section came on screen at all.
  function updateEntrance(){
    if(!sticky) return;
    const rect = section.getBoundingClientRect();
    const vh = window.innerHeight;
    const raw = (vh - rect.top) / (vh * 0.8);
    const p = smoothstep(0, 1, Math.max(0, Math.min(1, raw)));
    sticky.style.opacity = p.toFixed(3);
    sticky.style.transform = `translateY(${((1 - p) * 30).toFixed(1)}px)`;
    // once the entrance has fully played out, the title settles into a
    // slow, continuous glow-pulse (see .showcase-title.is-glowing in
    // style.css) — a plain reveal (riding along with the rest of the
    // sticky's own fade-in above) rather than the scramble/chromatic-
    // aberration glitch this used to do, which read as a rendering bug
    // rather than an intentional effect. Purely a function of `p`
    // (itself just scroll position), so scrolling back up before it's
    // fully revealed turns the glow back off with no separate teardown.
    if(titleEl) titleEl.classList.toggle('is-glowing', p >= 0.999);
  }

  const categories = [
    { name:'Roofing',         icon:'🏠', img:'assets/trades/roofing.jpg' },
    { name:'Dentists',        icon:'🦷', img:'assets/trades/dentists.jpg' },
    { name:'Plumbers',        icon:'🔧', img:'assets/trades/plumbers.jpg' },
    { name:'Electricians',    icon:'⚡', img:'assets/trades/electricians.jpg' },
    { name:'Real Estate',     icon:'🏢', img:'assets/trades/real-estate.jpg' },
    { name:'Law Firms',       icon:'⚖️', img:'assets/trades/law-firms.jpg' },
    { name:'Restaurants',     icon:'🍽️', img:'assets/trades/restaurants.jpg' },
    { name:'Fitness Studios', icon:'💪', img:'assets/trades/fitness-studios.jpg' },
  ];

  function palette(){
    return (window.Papi && window.Papi.palette) || [[201,168,105]];
  }

  const n = categories.length;

  function scrollToIndex(i){
    const sectionTop = section.offsetTop;
    const scrollable = Math.max(1, section.offsetHeight - window.innerHeight);
    const target = sectionTop + (i / (n - 1)) * scrollable;
    window.scrollTo({ top: target, behavior:'smooth' });
  }

  // a short, punchy line over whichever card is currently expanded —
  // picked fresh each time a card opens, rather than the same caption
  // every time
  const PHRASES = [
    'This could be your site.',
    'Your business deserves this.',
    'Imagine your name here.',
    'Built like this — for you.',
    'Yours could look this good.',
    "Let's build your next site.",
    'See yourself here?',
    'This is what possible looks like.',
  ];
  // a different entrance each time, so the phrase keeps catching the
  // eye instead of fading in the same way every time a card opens
  const PHRASE_ANIMS = ['anim-rise', 'anim-pop', 'anim-slide-left', 'anim-slide-right', 'anim-blur'];

  const cards = [];
  const items = [];

  // clicking a card enlarges it in place (straightened, well above the
  // rest of the fan) so its preview is actually readable, rather than
  // only ever being seen at the small, angled size the rest of the fan
  // uses — collapses on a second click, clicking the close button, or
  // clicking anywhere outside the fan. Page scroll is locked for as
  // long as a card is expanded (same lock the cube section uses for a
  // focused face) — without this, an ordinary scroll to keep reading
  // the page would silently swap or exit the expanded card, which felt
  // like losing your place by accident.
  let expandedIndex = null;
  // the expanded card's true (unscaled) size, captured once right as
  // it expands — update() uses this as the basis for the real resize
  // below rather than re-measuring every frame, since after the first
  // frame the card's own offsetWidth/Height would reflect the already-
  // resized (expanded) box, not its original size
  let expandedBaseW = 0, expandedBaseH = 0;
  function setExpanded(i){
    const wasExpanded = expandedIndex !== null;
    const prevIndex = expandedIndex;
    expandedIndex = i;
    if(i !== null){
      expandedBaseW = cards[i].offsetWidth;
      expandedBaseH = cards[i].offsetHeight;
    }
    cards.forEach((c, ci)=> c.classList.toggle('is-expanded', ci === i));
    // re-parented straight onto <body> while expanded, and back into
    // its normal slot in the fan on collapse. .fan-card.is-expanded is
    // position:fixed so it centers on the actual viewport — but
    // .showcase-sticky (its normal ancestor) has its own transform
    // applied for the entrance animation, and CSS spec makes any
    // transformed ancestor become the fixed-position containing block
    // instead of the viewport, which was silently throwing off the
    // centering (and the cutoff-prevention math along with it).
    if(i !== null){
      document.body.appendChild(cards[i]);
    } else if(prevIndex !== null){
      const nextCard = cards[prevIndex + 1];
      if(nextCard && nextCard.parentNode === fanEl) fanEl.insertBefore(cards[prevIndex], nextCard);
      else fanEl.appendChild(cards[prevIndex]);
      // clear the expanded-state inline styles in this same synchronous
      // pass, not on the next requestUpdate() frame — the values above
      // (a large width/height/top computed to center the card in the
      // *viewport* while it was position:fixed) would otherwise still
      // be sitting on the element for that one frame while it's now
      // position:absolute back in the fan instead, re-interpreting
      // those same numbers against a completely different containing
      // block. That flashed the card at a nonsense spot for a frame
      // before the next update() call corrected it — the "glitches to
      // a different position" on close. Clearing them now instead
      // gives the browser a clean, empty starting style to paint on
      // the very next frame, so the transform/opacity transition
      // requestUpdate() applies afterward has a real, continuous
      // starting point to animate from.
      const prevCard = cards[prevIndex];
      prevCard.style.top = '';
      prevCard.style.width = '';
      prevCard.style.height = '';
      prevCard.style.transform = '';
      prevCard.style.removeProperty('--card-scale');
    }
    // both ancestors normally clip to keep the fan's rotated/off-centre
    // cards from spilling past the section — the expanded card is
    // meant to spill past that on purpose, so overflow opens up only
    // while one actually is expanded. This also shrinks the gap between
    // the eyebrow/items/fan flex column, which — since the column is
    // vertically centered as a whole — actually moves the eyebrow
    // itself (a smaller combined stack height re-centers lower). That
    // has to happen *before* the eyebrow's position is read for the
    // quote below: reading it first and applying this after meant the
    // quote got pinned to the eyebrow's old spot, while the eyebrow
    // itself then visibly shifted down toward it — the section title
    // sliding right above the quote on expand, and back on collapse.
    if(sticky) sticky.classList.toggle('has-expanded-card', i !== null);
    fanEl.classList.toggle('has-expanded-card', i !== null);
    // sits where the trade names normally do (those fade out below,
    // in the items loop) — keeps the focus on the image itself rather
    // than adding another caption on top of the card
    if(phraseEl){
      phraseEl.classList.remove(...PHRASE_ANIMS);
      if(i !== null){
        // re-parent the quote onto <body> too, the same way the
        // expanded card itself does — and for the same reason. A
        // previous attempt instead bumped .showcase's own z-index
        // above the card's so the quote (nested inside it) could stack
        // on top — but .showcase has its own big opaque section
        // background, so that dragged the *entire section's
        // background* above the card too, hiding the card completely
        // behind it (all that was left visible was the quote, floating
        // on that background — the "fan cards disappear, only the
        // quote shows" bug). A nested stacking context can never reach
        // out past its own ancestor's position in a higher one, which
        // is why only moving the quote itself — not raising an
        // ancestor — actually works here.
        //
        // Positioned from the section eyebrow's own on-screen spot,
        // not wherever the quote happened to already be sitting inside
        // the fan — the fan's position varies with layout (stacked
        // under the trade names on narrow screens vs. beside them on
        // desktop), so anchoring to it directly meant the card's own
        // expand math (which uses this same quote position as its
        // floor) could end up computing a start point *above* where
        // the quote actually was, letting the two overlap on iPhone.
        // Anchoring to the eyebrow instead is stable regardless of
        // that layout, and guarantees "quote below the section title"
        // as a hard rule rather than an incidental side effect.
        const eyebrowRect = eyebrowEl ? eyebrowEl.getBoundingClientRect() : null;
        const gap = window.innerWidth < 640 ? 40 : 48;
        // capped — the section title is now a full mission-statement
        // sentence rather than a short one-line eyebrow, and wraps to
        // several lines in the narrow desktop left column, which pushed
        // this anchor (and the expand math in update() below, which
        // treats wherever this actually renders as a hard floor) low
        // enough to starve the expanded card down to a sliver docked at
        // the bottom of the screen. Capping the value used here keeps
        // the quote and the sizing math referencing the exact same
        // point (unlike a previous attempt that capped only the sizing
        // math's own copy of this number, letting the two drift apart
        // and overlap on iPhone) — just a lower ceiling on both.
        const quoteTop = Math.min(
          eyebrowRect ? eyebrowRect.bottom + gap : window.innerHeight * 0.14,
          window.innerHeight * 0.32
        );
        phraseEl.style.position = 'fixed';
        phraseEl.style.top = `${quoteTop.toFixed(1)}px`;
        phraseEl.style.left = '0';
        phraseEl.style.right = '0';
        phraseEl.style.width = 'auto';
        phraseEl.style.margin = '0';
        phraseEl.style.zIndex = '600';
        document.body.appendChild(phraseEl);
        phraseEl.textContent = PHRASES[Math.floor(Math.random() * PHRASES.length)];
        // force a reflow before adding the animation class back — without
        // this, picking the same animation two expands in a row wouldn't
        // replay it (the class never technically changed from the
        // browser's point of view)
        void phraseEl.offsetWidth;
        phraseEl.classList.add(PHRASE_ANIMS[Math.floor(Math.random() * PHRASE_ANIMS.length)]);
      } else {
        // back into its normal spot inside the fan, inline styles
        // cleared so the CSS-driven positioning takes back over
        phraseEl.style.position = '';
        phraseEl.style.top = '';
        phraseEl.style.left = '';
        phraseEl.style.right = '';
        phraseEl.style.width = '';
        phraseEl.style.margin = '';
        phraseEl.style.zIndex = '';
        fanEl.appendChild(phraseEl);
      }
    }
    // window.Papi.lockScroll/unlockScroll (js/accent.js) rather than a
    // plain classList.add('scroll-lock') here — a bare overflow:hidden
    // isn't enough to actually stop iOS Safari's own touch-driven
    // momentum scrolling; a stray touch can still drag the page while
    // "locked," and the snap-back once that drag ended read as the
    // whole page pausing/freezing right as a card was expanded. accent.js's
    // version additionally intercepts the touchmove/wheel input itself,
    // which is what actually stops that. It only touches
    // document.documentElement (not body), so it doesn't conflict with
    // the expanded card's own position:fixed centering below.
    if(i !== null && !wasExpanded){
      window.Papi.lockScroll();
    } else if(i === null && wasExpanded){
      window.Papi.unlockScroll();
    }
    requestUpdate();
  }
  document.addEventListener('click', (e)=>{
    if(expandedIndex !== null && !e.target.closest('.fan-card')) setExpanded(null);
  });

  categories.forEach((cat, i)=>{
    const c = palette()[i % palette().length];
    const rgb = `${c[0]},${c[1]},${c[2]}`;

    const card = document.createElement('div');
    card.className = 'fan-card';
    // no more per-category border tint — the new frosted-glass look
    // uses one consistent white border/glow across every card
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', `Jump to ${cat.name}`);
    // real live-site preview where we have one; the emoji glyph stays
    // as the placeholder for categories that don't have a screenshot
    // yet, so the fan never has an empty/broken card
    const heroContent = cat.img
      ? `<img src="${cat.img}" alt="${cat.name} website preview" loading="lazy">`
      : cat.icon;
    card.innerHTML = `
      <div class="fan-bar"><span></span><span></span><span></span></div>
      <div class="fan-hero" style="background:rgba(${rgb},.16)">${heroContent}</div>
      <div class="fan-body">
        <div class="fan-name">${cat.name}</div>
        <div class="fan-line"></div>
        <div class="fan-line short"></div>
      </div>
      <span class="fan-card-exit-dot" aria-hidden="true"></span>`;
    // a mouse click focusing the card is what was triggering the
    // browser's own "scroll newly focused element into view" behavior
    // (worse once the card is scaled up 1.75x) — preventing default on
    // mousedown stops focus from being assigned on a mouse click at
    // all, without affecting real keyboard Tab navigation, which still
    // focuses it normally (Enter/Space below still activates it)
    card.addEventListener('mousedown', (e)=> e.preventDefault());
    // expanding is purely an in-place enlargement now — it used to also
    // scroll-to-center the card, but that scroll and a visitor's own
    // subsequent scroll fought each other (the auto-collapse-on-scroll
    // above would immediately undo the very scroll that opened it)
    card.addEventListener('click', (e)=>{
      if(expandedIndex === i){ setExpanded(null); return; }
      setExpanded(i);
    });
    card.addEventListener('keydown', (e)=>{
      if(e.key === 'Enter' || e.key === ' '){
        e.preventDefault();
        if(expandedIndex === i){ setExpanded(null); } else { setExpanded(i); }
      }
    });
    fanEl.appendChild(card);
    cards.push(card);

    const item = document.createElement('div');
    item.className = 'showcase-item';
    item.textContent = cat.name;
    item.setAttribute('role', 'button');
    item.setAttribute('tabindex', '0');
    item.setAttribute('aria-label', `Jump to ${cat.name}`);
    const jumpOnly = ()=> scrollToIndex(i);
    item.addEventListener('click', jumpOnly);
    item.addEventListener('keydown', (e)=>{ if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); jumpOnly(); } });
    listEl.appendChild(item);
    items.push(item);
  });

  // was n*80vh — a bit less scroll distance per trade name means the
  // carousel advances through all of them a little faster for the
  // same amount of scrolling
  section.style.height = (n * 68) + 'vh';

  function lerp(a,b,t){ return a + (b-a)*t; }

  let itemStep = 90;

  function measureStep(){
    if(items[0]) itemStep = items[0].offsetHeight * 1.05 || itemStep;
  }
  measureStep();

  // once fully scrolled past (or not yet reached), the cards/items/
  // background icons below are already sitting at their pinned resting
  // state — every section on this page runs its own scroll-driven
  // update on every single 'scroll' event site-wide, so recomputing
  // and re-writing styles across 8 cards + 8 trade names + 14
  // background icons here on every scroll frame long after leaving
  // this section was pure waste stacking on top of every other section
  // doing the same thing — exactly the kind of accumulated per-frame
  // cost that showed up as stutter scrolling through the sections
  // below this one. pinnedLow/pinnedHigh let the resting state still
  // get written exactly once when first settling into it (so the very
  // first call, well before the section is ever scrolled to, still
  // lays everything out correctly) and skip every redundant call after.
  let pinnedLow = false, pinnedHigh = false;
  // null (not 0) so the very first computation only sets the baseline
  // instead of firing a buzz on page load, before the visitor has
  // actually scrolled from one trade to another
  let lastHapticIndex = null;

  function update(){
    const sectionTop = section.offsetTop;
    const sectionHeight = section.offsetHeight;
    const scrollable = Math.max(1, sectionHeight - window.innerHeight);
    const rawProgress = (window.scrollY - sectionTop) / scrollable;

    // the pin-and-skip below must never apply while a card is expanded
    // — the LAST card only ever becomes active/clickable right at
    // progress===1, the exact same boundary this pin exists to skip
    // past, and real touch-scroll momentum overshoots it constantly.
    // Skipping this whole function on the very update() call
    // setExpanded() triggers meant the last card's expand never got as
    // far as actually being positioned — it looked like the card just
    // didn't open at all.
    if(rawProgress < 0){
      if(pinnedLow && expandedIndex === null) return;
      pinnedLow = true;
    } else {
      pinnedLow = false;
    }
    if(rawProgress > 1){
      if(pinnedHigh && expandedIndex === null) return;
      pinnedHigh = true;
    } else {
      pinnedHigh = false;
    }

    const progress = Math.max(0, Math.min(1, rawProgress));
    const activeFloat = progress * (n - 1);

    // one small buzz per trade crossed, not one per scroll frame — only
    // while actually browsing the fan (not while a card is expanded,
    // where scroll is locked anyway and activeFloat can't change)
    if(expandedIndex === null){
      const nearestIndex = Math.round(activeFloat);
      if(lastHapticIndex !== null && nearestIndex !== lastHapticIndex) hapticTick();
      lastHapticIndex = nearestIndex;
    }

    // the mission-statement title only needs to be read once, right as
    // the section settles in — it fades out fairly early into the
    // card-by-card scroll (rather than sitting at full opacity for the
    // entire section) so it stops competing with the fan for attention,
    // and is hidden outright while a card is expanded (nothing about an
    // enlarged live-site preview needs a title floating above it)
    if(titleEl){
      const titleFadeOut = smoothstep(0.1, 0.32, progress);
      titleEl.style.opacity = expandedIndex !== null ? '0' : (1 - titleFadeOut).toFixed(3);
    }

    // the fan's pop is toned down on narrow screens — full pop plus the
    // fixed-height mobile fan container was pushing the active card's
    // top edge above the viewport (looked like it was cut off by the
    // hero above it)
    const isNarrow = window.innerWidth < 640;
    const maxScale = isNarrow ? 1.08 : 1.22;
    const minTy = isNarrow ? -4 : -14;

    const angleStep = 9;
    cards.forEach((card, i)=>{
      const d = activeFloat - i;
      const blend = Math.max(0, 1 - Math.abs(d));
      const baseAngle = (i - (n - 1) / 2) * angleStep;
      const angle = baseAngle * (1 - blend * 0.92);
      const scale = lerp(0.74, maxScale, blend);
      // fully invisible when not active, not just faded 25% — with 8
      // cards stacked in the exact same spot, that floor meant every
      // one of them stayed at least partly visible at once, reading
      // as a messy jumble instead of one card at a time
      const opacity = Math.max(0, (blend - 0.08) / 0.92);
      const ty = lerp(26, minTy, blend);

      if(i === expandedIndex){
        // cleared in case this exact card was hidden behind a
        // *different* expanded card earlier (see the branch below,
        // which sets transition:none for an instant hide) — without
        // this, that leftover inline override would silently kill this
        // card's own smooth grow-into-place transition the next time
        // it's the one being expanded
        card.style.transition = '';
        // fixed + centered in the viewport (see .fan-card.is-expanded)
        // rather than scaled up in place, so it's centered on-screen
        // wherever the visitor currently is. Vertically centered in
        // whatever space is actually left below the quote (measured
        // directly, not guessed) — the quote's own box still occupies
        // its normal spot up top, and giving the card the whole
        // viewport height to grow into let it cover the quote (and the
        // section eyebrow above that) instead of sitting under them.
        const baseH = expandedBaseH || card.offsetHeight;
        const baseW = expandedBaseW || card.offsetWidth;

        const margin = isNarrow ? 14 : 20;
        // the quote is now pinned relative to the section eyebrow, not
        // wherever it happened to already be sitting (see setExpanded)
        // — a reliable, predictable position rather than one that
        // varied with layout. That's what makes it safe to treat
        // quoteRect.bottom as a hard floor here: the card's top can
        // never end up above it, so the two can no longer overlap. A
        // previous version instead capped how far down this floor
        // could sit (to guarantee the card a minimum size), which
        // could let the floor slide up *past* the quote's real
        // position when space was tight — exactly what showed up as
        // the quote and the expanded card overlapping on iPhone.
        const quoteRect = phraseEl ? phraseEl.getBoundingClientRect() : null;
        const topBound = quoteRect && quoteRect.bottom > 0
          ? quoteRect.bottom + margin
          : window.innerHeight * 0.26;
        // stopping short of the very bottom of the viewport (rather
        // than reaching all the way down to it) pulls the centered
        // result up noticeably — letting the range reach the bottom
        // edge dragged the midpoint down further than felt right,
        // sitting the expanded card lower than the headroom available
        // actually called for. Desktop can stop further from the edge
        // than mobile, which has less room to spare in the first place.
        const bottomBound = isNarrow
          ? Math.min(window.innerHeight - margin, window.innerHeight * 0.86)
          : Math.min(window.innerHeight - margin, window.innerHeight * 0.84);
        const availableHeight = Math.max(120, bottomBound - topBound);
        const uncappedScale = isNarrow ? 1.55 : 1.75;
        const maxCardHeight = Math.min(availableHeight, window.innerHeight * 0.8);
        const expandScale = Math.min(uncappedScale, maxCardHeight / baseH);
        const centerY = topBound + availableHeight / 2;
        card.style.top = `${centerY.toFixed(1)}px`;
        // a real resize (width/height), not transform:scale() — scaling
        // this element via transform was stretching an already-
        // rasterized bitmap of it (border-radius + overflow:hidden +
        // backdrop-filter force it onto its own composited layer),
        // which is what was actually causing the blur, not a subpixel
        // rounding issue. A real resize makes the browser lay out and
        // paint it fresh at its true size instead. --card-scale carries
        // the same factor to the CSS below so padding/font-size/etc.
        // grow with it exactly like transform:scale() used to.
        card.style.width = `${(baseW * expandScale).toFixed(1)}px`;
        card.style.height = `${(baseH * expandScale).toFixed(1)}px`;
        card.style.setProperty('--card-scale', expandScale.toFixed(3));
        card.style.transform = 'translate(-50%, -50%)';
        card.style.opacity = '1';
        card.style.zIndex = '500';
        card.style.pointerEvents = '';
      } else if(expandedIndex !== null){
        // fully hidden (not just faded/angled away) while another card
        // is expanded — leaving them at their normal fan opacity meant
        // a neighboring card could still peek out from around/behind
        // the expanded one, reading as visual clutter under its name.
        // transition:none forces that hide to be instant rather than
        // fading over the stylesheet's own .3s — this card is still
        // sitting at its old (rotated, off-centre) fan transform, which
        // isn't concentric with the expanded card's centered position,
        // so during that .3s fade it was visibly poking out past the
        // expanded card's edges instead of being covered by it.
        card.style.transition = 'none';
        card.style.top = '';
        card.style.width = '';
        card.style.height = '';
        card.style.opacity = '0';
        card.style.pointerEvents = 'none';
      } else {
        // clears any leftover inline "top"/width/height from a previous
        // expand — the normal (non-expanded) position and size are
        // plain CSS (the fan spread relies on the flex parent's
        // alignment plus a much smaller transform:scale for its static
        // position/size), so stale values left set would misplace or
        // wrongly size it here. transition restored (cleared above
        // while hidden behind an expanded card) so the normal fan's own
        // transform/opacity animations work again.
        card.style.transition = '';
        card.style.top = '';
        card.style.width = '';
        card.style.height = '';
        card.style.removeProperty('--card-scale');
        card.style.transform = `translateY(${ty.toFixed(1)}px) rotate(${angle.toFixed(1)}deg) scale(${scale.toFixed(3)})`;
        card.style.opacity = opacity.toFixed(2);
        card.style.zIndex = String(Math.round(blend * 100) + 1);
        card.style.pointerEvents = '';
      }
      card.classList.toggle('is-active', blend > 0.82);
    });

    items.forEach((item, i)=>{
      const offset = i - activeFloat;
      const dist = Math.abs(offset);
      // the expanded card grows tall enough to reach into the trade-name
      // list above it — rather than let the two overlap, the names fade
      // out of the way while a card is expanded (its own CSS transition
      // on opacity handles the fade smoothly) and back in once collapsed
      const opacity = expandedIndex !== null ? 0 : Math.max(0, 1 - dist / 2.1);
      const scale = lerp(0.78, 1, Math.max(0, 1 - dist / 1.6));
      item.style.transform = `translateY(${(offset * itemStep - 0.5*itemStep).toFixed(1)}px) scale(${scale.toFixed(3)})`;
      item.style.opacity = opacity.toFixed(2);
      item.style.pointerEvents = expandedIndex !== null ? 'none' : '';
      item.classList.toggle('is-active', dist < 0.4);
    });
  }

  // batch to one update per animation frame — raw 'scroll' events can
  // fire faster than the screen repaints during a fast/momentum
  // scroll, and running this (a forced layout read plus writes across
  // every card and item) redundantly several times between frames is
  // what showed up as stutter scrolling through this section
  let ticking = false;
  function requestUpdate(){
    if(ticking) return;
    ticking = true;
    requestAnimationFrame(()=>{ update(); updateEntrance(); ticking = false; });
  }

  window.addEventListener('scroll', requestUpdate, { passive:true });
  // width-only guard — on iOS Safari, scrolling for the first time in a
  // session collapses the address bar, firing a 'resize' that changes
  // innerHeight but not innerWidth. Without this, that one resize
  // would run a full recompute across every fan card and trade-name
  // item, landing right at the exact moment of the first scroll.
  let lastResizeWShowcase = window.innerWidth;
  window.addEventListener('resize', ()=>{
    const w = window.innerWidth;
    if(w === lastResizeWShowcase) return;
    lastResizeWShowcase = w;
    measureStep();
    requestUpdate();
  });
  update();
  updateEntrance();
})();
