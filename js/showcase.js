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
  const fanEl = document.getElementById('showcaseFan');
  const listEl = document.getElementById('showcaseItems');
  const eyebrowEl = document.querySelector('.showcase-eyebrow');
  if(!section || !fanEl || !listEl) return;

  if(eyebrowEl && 'IntersectionObserver' in window){
    const eyebrowObserver = new IntersectionObserver((entries)=>{
      entries.forEach(entry=>{
        if(entry.isIntersecting){
          eyebrowEl.classList.add('is-visible');
          eyebrowObserver.unobserve(entry.target);
        }
      });
    }, { threshold:0.4 });
    eyebrowObserver.observe(eyebrowEl);
  }

  const categories = [
    { name:'Roofing',         icon:'🏠' },
    { name:'Dentists',        icon:'🦷' },
    { name:'Plumbers',        icon:'🔧' },
    { name:'Electricians',    icon:'⚡' },
    { name:'Real Estate',     icon:'🏢' },
    { name:'Law Firms',       icon:'⚖️' },
    { name:'Restaurants',     icon:'🍽️' },
    { name:'Fitness Studios', icon:'💪' },
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

  categories.forEach((cat, i)=>{
    const c = palette()[i % palette().length];
    const rgb = `${c[0]},${c[1]},${c[2]}`;

    const card = document.createElement('div');
    card.className = 'fan-card';
    card.style.borderColor = `rgba(${rgb},.4)`;
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', `Jump to ${cat.name}`);
    card.innerHTML = `
      <div class="fan-bar"><span></span><span></span><span></span></div>
      <div class="fan-hero" style="background:rgba(${rgb},.16)">${cat.icon}</div>
      <div class="fan-body">
        <div class="fan-name">${cat.name}</div>
        <div class="fan-line"></div>
        <div class="fan-line short"></div>
      </div>`;
    const jump = ()=> scrollToIndex(i);
    card.addEventListener('click', jump);
    card.addEventListener('keydown', (e)=>{ if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); jump(); } });
    fanEl.appendChild(card);
    cards.push(card);

    const item = document.createElement('div');
    item.className = 'showcase-item';
    item.textContent = cat.name;
    item.setAttribute('role', 'button');
    item.setAttribute('tabindex', '0');
    item.setAttribute('aria-label', `Jump to ${cat.name}`);
    item.addEventListener('click', jump);
    item.addEventListener('keydown', (e)=>{ if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); jump(); } });
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
      card.style.transform = `translateY(${ty.toFixed(1)}px) rotate(${angle.toFixed(1)}deg) scale(${scale.toFixed(3)})`;
      card.style.opacity = opacity.toFixed(2);
      card.style.zIndex = String(Math.round(blend * 100) + 1);
      card.classList.toggle('is-active', blend > 0.82);
    });

    items.forEach((item, i)=>{
      const offset = i - activeFloat;
      const dist = Math.abs(offset);
      const opacity = Math.max(0, 1 - dist / 2.1);
      const scale = lerp(0.78, 1, Math.max(0, 1 - dist / 1.6));
      item.style.transform = `translateY(${(offset * itemStep - 0.5*itemStep).toFixed(1)}px) scale(${scale.toFixed(3)})`;
      item.style.opacity = opacity.toFixed(2);
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
    requestAnimationFrame(()=>{ update(); ticking = false; });
  }

  window.addEventListener('scroll', requestUpdate, { passive:true });
  window.addEventListener('resize', ()=>{ measureStep(); requestUpdate(); });
  update();
})();
