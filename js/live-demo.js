/* ===================================================================
   Papi — live demos
   Per direct follow-up request, "the screenshots are nice, but it does
   not really show a live site unless you click visit full site... are
   we able to show the actual live site" — real, live iframe embeds
   (not screenshots). Per a further follow-up, the screenshot poster is
   gone too, replaced by an animated "gas" loader (.live-demo-gas, see
   its own CSS comment) behind the "View live site" button; clicking it
   dissolves the gas away into the real production site.

   Nothing loads automatically — not on page load, not on proximity/
   scroll, not on swiping to a card — only an explicit click on that
   card's own button calls loadCard() below. Each of these embeds is a
   full separate production site (one of them makes 100+ requests just
   for its hero), and this section sits on essentially every visit to
   the homepage, so anything short of "only load what's actually
   clicked" turns every visitor into load on 1-3 external sites' worth
   of traffic whether they wanted to see them or not. This exact
   click-to-load + pause-off-screen mechanism shipped once before, for
   an earlier set of demos — see this file's own git history (the
   commit converting iframes to click-to-load) if more detail is ever
   needed than the comments below carry.

   `url` below is each site's own real custom domain (not its
   *.vercel.app address) per direct request, "have the actual domains
   for each demo live site" — host/iframe-src/"Visit full site" link
   are all derived from this one value, so that's the only thing that
   needed to change.
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
      name: 'California Dental Group of North Anaheim',
      industry: 'Dentists',
      url: 'https://cdgnorth.com',
    },
    {
      name: 'Dental Scanning Solutions',
      industry: 'Dental Technology',
      url: 'https://dscanningsolutions.com',
    },
    {
      name: 'Figueroa Furniture',
      industry: 'Furniture & Home',
      url: 'https://figueroa-furniture.com',
    },
  ];

  const n = DEMOS.length;
  const cards = [];
  const dots = [];
  // indices the visitor has explicitly clicked "view live site" on —
  // gates every automatic reload below (swiping to a card, scrolling
  // back to the section) so nothing ever loads an external site the
  // visitor didn't ask for, while still feeling seamless for one they
  // already opted into once this visit
  const userInitiated = new Set();

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
          <iframe class="live-demo-iframe" data-src="${demo.url}" title="${demo.name} — live site preview" loading="lazy" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"></iframe>
          <div class="live-demo-gas" aria-hidden="true">
            <span class="live-demo-gas-blob"></span><span class="live-demo-gas-blob"></span><span class="live-demo-gas-blob"></span>
          </div>
          <button type="button" class="live-demo-load-btn" aria-label="Load the live ${demo.name} site">
            <span class="live-demo-load-icon" aria-hidden="true">▶</span>
            <span class="live-demo-load-text">View live site</span>
          </button>
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

    const loadBtn = card.querySelector('.live-demo-load-btn');
    if(loadBtn) loadBtn.addEventListener('click', ()=>{ userInitiated.add(i); loadCard(i); });
  });

  // nothing to browse between with only one demo — matches the CSS's
  // own .is-single rule, which hides the whole controls row
  if(controls) controls.classList.toggle('is-single', n <= 1);

  function goTo(i){
    const clamped = Math.max(0, Math.min(n - 1, i));
    cards[clamped].scrollIntoView({ behavior:'smooth', inline:'center', block:'nearest' });
  }

  // every demo starts as its screenshot poster — a real, external
  // production site only ever starts loading in response to an
  // explicit click on that card's own "View live site" button, wired
  // above. That's the whole fix: none of these sites cost anything for
  // a visitor who never asks to see one live, no matter how far they
  // scroll or how many times they refresh.
  function loadCard(i){
    const card = cards[i];
    if(!card) return;
    const iframe = card.querySelector('iframe');
    if(!iframe || !iframe.dataset.src) return;
    const src = iframe.getAttribute('src');
    if(src && src !== 'about:blank') return; // already loading/loaded
    const loadBtn = card.querySelector('.live-demo-load-btn');
    if(loadBtn){
      loadBtn.disabled = true;
      const label = loadBtn.querySelector('.live-demo-load-text');
      if(label) label.textContent = 'Loading live site…';
    }
    iframe.addEventListener('load', ()=> card.classList.add('is-loaded'), { once:true });
    iframe.src = iframe.dataset.src;
  }

  // pause/resume loaded iframes based on whether this section is
  // actually in view. Two+ entire external websites keep running their
  // own JS indefinitely once loaded, with nothing above ever stopping
  // them — display:none/visibility:hidden does NOT reliably stop an
  // iframe's own scripts from continuing to run in the background, so
  // blanking each loaded iframe's src is the only real way to actually
  // stop that work once the visitor has scrolled past.
  //
  // This never auto-loads a card the visitor hasn't clicked on: only
  // re-loads cards[activeIndex] on return if it's in userInitiated
  // (i.e. the visitor already explicitly loaded it once before
  // scrolling away) — a card nobody has clicked just goes back to
  // showing its screenshot + button, exactly like on first arrival.
  // The hasBeenVisible guard makes sure pausing only ever happens on a
  // real "was visible, now scrolled away" transition, not on the
  // section's first (off-screen) reading at page load.
  if('IntersectionObserver' in window){
    let hasBeenVisible = false;
    const visibilityIO = new IntersectionObserver((entries)=>{
      const isVisible = entries[0].isIntersecting;
      if(isVisible){
        hasBeenVisible = true;
        if(userInitiated.has(activeIndex)) loadCard(activeIndex);
        return;
      }
      if(!hasBeenVisible) return;
      cards.forEach((card)=>{
        const iframe = card.querySelector('iframe');
        if(!iframe) return;
        const src = iframe.getAttribute('src');
        if(src && src !== 'about:blank'){
          iframe.src = 'about:blank';
          card.classList.remove('is-loaded');
          const loadBtn = card.querySelector('.live-demo-load-btn');
          if(loadBtn){
            loadBtn.disabled = false;
            const label = loadBtn.querySelector('.live-demo-load-text');
            if(label) label.textContent = 'View live site';
          }
        }
      });
    }, { threshold: 0 });
    visibilityIO.observe(section);
  }

  // ---- whichever card sits centered in the stack gets the active dot.
  // Swiping to a card doesn't auto-load it — each card only ever loads
  // on an explicit click of its own button (see loadCard()'s comment)
  // — but if the visitor already clicked that card once earlier in
  // this visit, swiping back to it should feel seamless rather than
  // making them click again, so this still reloads it automatically
  // when userInitiated already has it.
  //
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
    if(userInitiated.has(activeIndex)) loadCard(activeIndex);
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
