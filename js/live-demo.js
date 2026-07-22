/* ===================================================================
   Papi — live demos
   Real, live iframe embeds of sites Papi has actually built — not
   screenshots — inside a browser-chrome-style frame, so a visitor can
   scroll *inside* the frame and explore the real site for themselves.
   Swipeable row (native scroll-snap, same pattern as testimonials.js)
   when there's more than one; a single demo just sits centered with
   no dots/arrows since there's nothing to browse between yet.

   Each iframe's src is assigned shortly after the *page's own* load
   event, not gated by scroll proximity — even moved up to sit right
   after Contrast (per direct request, so a visitor reaches real work
   sooner), a fast scroller still takes a real beat to get here, which
   is normally plenty of lead time for someone else's whole website to
   finish loading in the background. Waiting until the card was
   already nearly in view instead meant the "Loading live site…"
   placeholder was often still showing right as it scrolled in. The
   small delay after 'load' keeps this from competing with the main
   page's own critical first paint.
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
    {
      name: 'Velocity Tire Co.',
      industry: 'Tires & Auto Performance',
      url: 'https://velocity-tire-co.vercel.app',
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

  // ---- start every card's iframe loading well ahead of scroll
  // arrival — see the header comment above for why this isn't gated
  // by scroll proximity at all ----
  function loadAllCards(){
    cards.forEach(card=>{
      const iframe = card.querySelector('iframe');
      if(!iframe || !iframe.dataset.src) return;
      iframe.addEventListener('load', ()=> card.classList.add('is-loaded'), { once:true });
      iframe.src = iframe.dataset.src;
    });
  }
  if(document.readyState === 'complete'){
    setTimeout(loadAllCards, 400);
  } else {
    window.addEventListener('load', ()=> setTimeout(loadAllCards, 400));
  }

  // ---- pause/resume both iframes based on whether this section is
  // actually in view — per direct request: "pause them once the
  // viewer is past the live demo section, and when they scroll back
  // they get unpaused". Two entire external websites keep running
  // their own JS indefinitely once loaded, with nothing above ever
  // stopping them — display:none/visibility:hidden does NOT reliably
  // stop an iframe's own scripts from continuing to run in the
  // background, so blanking each iframe's src is the only real way to
  // actually stop that work once the visitor has moved on.
  //
  // This intentionally does NOT touch anything before the section's
  // first-ever visit: loadAllCards() above already deliberately starts
  // loading both sites well ahead of scroll arrival so neither one
  // ever shows its "Loading live site…" placeholder right as it
  // scrolls in. The section starts off-screen below the fold, so this
  // observer's very first reading is "not intersecting" — reacting to
  // that would blank the iframes before the visitor ever arrives and
  // bring back exactly the loading flash this was built to avoid. The
  // hasBeenVisible guard makes sure pausing only ever happens on a
  // real "was visible, now scrolled away" transition.
  if('IntersectionObserver' in window){
    let hasBeenVisible = false;
    const visibilityIO = new IntersectionObserver((entries)=>{
      const isVisible = entries[0].isIntersecting;
      if(isVisible){
        hasBeenVisible = true;
        cards.forEach(card=>{
          const iframe = card.querySelector('iframe');
          if(!iframe || !iframe.dataset.src) return;
          if(iframe.getAttribute('src') === 'about:blank'){
            card.classList.remove('is-loaded');
            iframe.addEventListener('load', ()=> card.classList.add('is-loaded'), { once:true });
            iframe.src = iframe.dataset.src;
          }
        });
        return;
      }
      if(!hasBeenVisible) return;
      cards.forEach(card=>{
        const iframe = card.querySelector('iframe');
        if(!iframe) return;
        const src = iframe.getAttribute('src');
        if(src && src !== 'about:blank'){
          iframe.src = 'about:blank';
          card.classList.remove('is-loaded');
        }
      });
    }, { threshold: 0 });
    visibilityIO.observe(section);
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
