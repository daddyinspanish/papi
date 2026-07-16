/* ===================================================================
   Papi — live demos
   Real, live iframe embeds of sites Papi has actually built — not
   screenshots — inside a browser-chrome-style frame, so a visitor can
   scroll *inside* the frame and explore the real site for themselves.
   Swipeable row (native scroll-snap, same pattern as testimonials.js)
   when there's more than one; a single demo just sits centered with
   no dots/arrows since there's nothing to browse between yet.

   Each iframe's src is only assigned once its card is actually about
   to scroll into view (a plain scroll-position check on the section,
   not an IntersectionObserver alone — the same reasoning as
   comparison-chart.js: a fast scroll/flick can skip clean past a
   threshold the browser never renders an in-between frame for). Until
   then the frame sits empty so a visit that never reaches this
   section never pays for loading someone else's whole live website.
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

  // add another demo here later — everything below (cards, dots,
  // lazy-load, swipe) is built from this array
  const DEMOS = [
    {
      name: 'Atlas Relocation Co.',
      industry: 'Moving & Relocation',
      url: 'https://moving-website-three.vercel.app',
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
      <div class="live-demo-browser">
        <div class="live-demo-browser-bar">
          <span class="live-demo-dot"></span><span class="live-demo-dot"></span><span class="live-demo-dot"></span>
          <span class="live-demo-url">${host}</span>
        </div>
        <div class="live-demo-frame-wrap">
          <span class="live-demo-loading">Loading live site…</span>
          <iframe class="live-demo-iframe" data-src="${demo.url}" title="${demo.name} — live site preview" loading="lazy" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"></iframe>
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

  // ---- lazy-load each card's iframe once it's actually about to
  // scroll into view ----
  const loadedCards = new Set();
  function maybeLoadCards(){
    cards.forEach(card=>{
      if(loadedCards.has(card)) return;
      const rect = card.getBoundingClientRect();
      if(rect.top > window.innerHeight * 1.3 || rect.bottom < -200) return;
      const iframe = card.querySelector('iframe');
      if(!iframe || !iframe.dataset.src) return;
      loadedCards.add(card);
      iframe.addEventListener('load', ()=> card.classList.add('is-loaded'), { once:true });
      iframe.src = iframe.dataset.src;
    });
  }

  // ---- whichever card sits centered in the stack gets the active dot ----
  let activeIndex = 0;
  function updateActive(){
    if(n <= 1) return;
    const stackRect = stack.getBoundingClientRect();
    const stackCenter = stackRect.left + stackRect.width / 2;
    let closest = 0, closestDist = Infinity;
    cards.forEach((card, i)=>{
      const r = card.getBoundingClientRect();
      const dist = Math.abs((r.left + r.width / 2) - stackCenter);
      if(dist < closestDist){ closestDist = dist; closest = i; }
    });
    if(closest === activeIndex) return;
    activeIndex = closest;
    dots.forEach((dot, i)=> dot.classList.toggle('is-active', i === activeIndex));
  }
  if(dots[0]) dots[0].classList.add('is-active');

  let stackTicking = false;
  stack.addEventListener('scroll', ()=>{
    if(stackTicking) return;
    stackTicking = true;
    requestAnimationFrame(()=>{ updateActive(); stackTicking = false; });
  }, { passive:true });

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
    requestAnimationFrame(()=>{ updateEntrance(); maybeLoadCards(); ticking = false; });
  }
  window.addEventListener('scroll', requestUpdate, { passive:true });
  // width-only guard — matches the same pattern used elsewhere on the
  // site: an iOS/in-app-browser chrome-collapse resize changes
  // innerHeight, not innerWidth, and shouldn't be treated as a real
  // layout change
  let lastResizeW = window.innerWidth;
  window.addEventListener('resize', ()=>{
    const w = window.innerWidth;
    if(w === lastResizeW) return;
    lastResizeW = w;
    requestUpdate();
  });
  updateEntrance();
  maybeLoadCards();
})();
