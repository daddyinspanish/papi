/* ===================================================================
   Papi — live demos
   Per direct request, these are now scrollable screenshots of real
   client sites Papi has built, inside the same browser-chrome-style
   frame used before — a visitor scrolls *inside* the frame (plain
   overflow-y:auto over a tall static image) to see the rest of the
   page. Swipeable row (native scroll-snap, same pattern as
   testimonials.js) when there's more than one; a single demo just
   sits centered with no dots/arrows since there's nothing to browse
   between yet.

   This file used to embed four other real, LIVE production sites via
   iframe instead, which needed a whole click-to-load/pause-off-screen
   mechanism to avoid loading 1-4 external sites' worth of traffic on
   every visit (one of them made 100+ requests just for its hero) —
   see this file's git history if that mechanism is ever needed again
   elsewhere. A static screenshot has none of that cost, so none of it
   is needed here anymore.
=================================================================== */
(function(){
  const section = document.getElementById('liveDemoSection');
  const inner = document.querySelector('.live-demo-inner');
  const stack = document.getElementById('liveDemoStack');
  const dotsEl = document.getElementById('liveDemoDots');
  const controls = document.getElementById('liveDemoControls');
  const prevBtn = document.getElementById('liveDemoPrev');
  const nextBtn = document.getElementById('liveDemoNext');
  if(!section || !stack) return;

  function smoothstep(edge0, edge1, x){
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  }

  // add another demo here later — everything below (cards, dots, swipe)
  // is built from this array
  const DEMOS = [
    {
      name: 'California Dental Group of North Anaheim',
      industry: 'Dentists',
      url: 'https://cdg-north.vercel.app',
      screenshot: 'img/live-demo/cdg-north.jpg',
    },
    {
      name: 'Dental Scanning Solutions',
      industry: 'Dental Technology',
      url: 'https://dental-scanning-solutions.vercel.app',
      screenshot: 'img/live-demo/dental-scanning-solutions.jpg',
    },
    {
      name: 'Figueroa Furniture',
      industry: 'Furniture & Home',
      url: 'https://figueroa-furniture.vercel.app',
      screenshot: 'img/live-demo/figueroa-furniture.jpg',
    },
  ];

  const n = DEMOS.length;
  const cards = [];
  const dots = [];

  DEMOS.forEach((demo, i)=>{
    let host = '';
    try { host = new URL(demo.url).host; } catch(e){ host = demo.url; }

    const card = document.createElement('div');
    card.className = 'live-demo-card';
    card.innerHTML = `
      <div class="live-demo-browser" data-cursor="view">
        <div class="live-demo-browser-bar">
          <span class="live-demo-dot"></span><span class="live-demo-dot"></span><span class="live-demo-dot"></span>
          <span class="live-demo-url">${host}</span>
        </div>
        <div class="live-demo-frame-wrap">
          <img class="live-demo-screenshot" src="${demo.screenshot}" alt="${demo.name} — website screenshot" loading="lazy">
        </div>
      </div>
      <p class="live-demo-name">${demo.name}</p>
      <p class="live-demo-industry">${demo.industry}</p>
      <a class="live-demo-visit" href="${demo.url}" target="_blank" rel="noopener">Visit full site ↗</a>`;
    stack.appendChild(card);
    cards.push(card);

    if(n > 1 && dotsEl){
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'live-demo-dot-btn';
      dot.setAttribute('aria-label', `Show the ${demo.name} demo`);
      dot.addEventListener('click', ()=> goTo(i));
      dotsEl.appendChild(dot);
      dots.push(dot);
    }
  });

  // nothing to browse between with only one demo — matches the CSS's
  // own .is-single rule, which hides the whole controls row
  if(controls) controls.classList.toggle('is-single', n <= 1);

  function goTo(i){
    const clamped = Math.max(0, Math.min(n - 1, i));
    cards[clamped].scrollIntoView({ behavior:'smooth', inline:'center', block:'nearest' });
  }

  // ---- whichever card sits centered in the stack gets the active dot.
  // Detected via IntersectionObserver (threshold:0.6, fires only for
  // whichever single card is actually centered) rather than polling
  // getBoundingClientRect() on scroll, since rAF-throttled polling can
  // drop frames under real-world conditions (backgrounded tab, iOS Low
  // Power Mode) and strand the detection mid-swipe.
  let activeIndex = 0;
  function setActive(i){
    if(i === activeIndex) return;
    activeIndex = i;
    dots.forEach((dot, di)=> dot.classList.toggle('is-active', di === activeIndex));
  }
  if(dots[0]) dots[0].classList.add('is-active');

  if(n > 1 && 'IntersectionObserver' in window){
    const activeIO = new IntersectionObserver((entries)=>{
      entries.forEach((entry)=>{
        if(!entry.isIntersecting) return;
        const i = cards.indexOf(entry.target);
        if(i !== -1) setActive(i);
      });
    }, { root: stack, threshold: 0.6 });
    cards.forEach((card)=> activeIO.observe(card));
  }

  if(prevBtn) prevBtn.addEventListener('click', ()=> goTo(activeIndex - 1));
  if(nextBtn) nextBtn.addEventListener('click', ()=> goTo(activeIndex + 1));

  // ---- whole section rises/fades in as it enters from below, tied
  // directly to scroll position (same convention as every other
  // section on the page) ----
  let entrancePinnedLow = false, entrancePinnedHigh = false;
  function updateEntrance(){
    if(!inner) return;
    const rect = section.getBoundingClientRect();
    const vh = window.innerHeight;
    const raw = (vh - rect.top) / (vh * 0.75);

    if(raw < 0){
      if(entrancePinnedLow) return;
      entrancePinnedLow = true;
    } else {
      entrancePinnedLow = false;
    }
    if(raw > 1){
      if(entrancePinnedHigh) return;
      entrancePinnedHigh = true;
    } else {
      entrancePinnedHigh = false;
    }

    const p = Math.max(0, Math.min(1, raw));
    const bodyP = smoothstep(0, 1, p);
    inner.style.opacity = bodyP.toFixed(3);
    inner.style.transform = `translateY(${((1 - bodyP) * 30).toFixed(1)}px)`;
  }

  let ticking = false;
  function requestUpdate(){
    if(ticking) return;
    ticking = true;
    requestAnimationFrame(()=>{ updateEntrance(); ticking = false; });
  }
  window.addEventListener('scroll', requestUpdate, { passive:true });
  // width-only guard — matches the same pattern used elsewhere on the
  // site: an iOS/in-app-browser chrome-collapse resize changes
  // innerHeight, not innerWidth, and shouldn't be treated as a real
  // layout change
  let lastResizeW = window.innerWidth;
  window.addEventListener('resize', ()=>{
    const w = window.innerWidth;
    // >10px tolerance — see the --stable-vh comment in index.html's <head>
    if(Math.abs(w - lastResizeW) <= 10) return;
    lastResizeW = w;
    requestUpdate();
  });
  updateEntrance();
})();
