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
  if(!section || !fanEl || !listEl) return;

  function smoothstep(edge0, edge1, x){
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
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

  const cards = [];
  const items = [];

  // clicking a card enlarges it in place (straightened, well above the
  // rest of the fan) so its preview is actually readable, rather than
  // only ever being seen at the small, angled size the rest of the fan
  // uses — collapses on a second click, clicking any other card, or
  // clicking anywhere outside the fan
  let expandedIndex = null;
  function setExpanded(i){
    expandedIndex = i;
    cards.forEach((c, ci)=> c.classList.toggle('is-expanded', ci === i));
    // both ancestors normally clip to keep the fan's rotated/off-centre
    // cards from spilling past the section — the expanded card is
    // meant to spill past that on purpose, so overflow opens up only
    // while one actually is expanded
    if(sticky) sticky.classList.toggle('has-expanded-card', i !== null);
    fanEl.classList.toggle('has-expanded-card', i !== null);
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
    card.style.borderColor = `rgba(${rgb},.4)`;
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
      <button type="button" class="fan-card-close" aria-label="Close preview">✕</button>`;
    card.addEventListener('click', (e)=>{
      // clicking the close button (only reachable while already
      // expanded) collapses instead of re-triggering the expand/jump
      if(e.target.closest('.fan-card-close')){ setExpanded(null); return; }
      if(expandedIndex === i){ setExpanded(null); return; }
      setExpanded(i);
      scrollToIndex(i);
    });
    card.addEventListener('keydown', (e)=>{
      if(e.key === 'Enter' || e.key === ' '){
        e.preventDefault();
        if(expandedIndex === i){ setExpanded(null); } else { setExpanded(i); scrollToIndex(i); }
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

  section.style.height = (n * 80) + 'vh';

  function lerp(a,b,t){ return a + (b-a)*t; }

  let itemStep = 90;

  function measureStep(){
    if(items[0]) itemStep = items[0].offsetHeight * 1.05 || itemStep;
  }
  measureStep();

  function update(){
    const sectionTop = section.offsetTop;
    const sectionHeight = section.offsetHeight;
    const scrollable = Math.max(1, sectionHeight - window.innerHeight);
    const progress = Math.max(0, Math.min(1, (window.scrollY - sectionTop) / scrollable));
    const activeFloat = progress * (n - 1);

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
        // straightened, well above the rest of the fan, and notably
        // larger than even the normal "active" size — the point is to
        // actually be able to read the preview, not just recenter it
        const expandScale = (isNarrow ? 1.55 : 1.75);
        card.style.transform = `translateY(${(minTy - 10).toFixed(1)}px) rotate(0deg) scale(${expandScale})`;
        card.style.opacity = '1';
        card.style.zIndex = '500';
      } else {
        card.style.transform = `translateY(${ty.toFixed(1)}px) rotate(${angle.toFixed(1)}deg) scale(${scale.toFixed(3)})`;
        card.style.opacity = opacity.toFixed(2);
        card.style.zIndex = String(Math.round(blend * 100) + 1);
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
  window.addEventListener('resize', ()=>{ measureStep(); requestUpdate(); });
  update();
  updateEntrance();
})();
