/* ===================================================================
   Papi — live demos
   Real, live iframe embeds of sites Papi has actually built — not
   screenshots — inside a browser-chrome-style frame, so a visitor can
   scroll *inside* the frame and explore the real site for themselves.
   Swipeable row (native scroll-snap, same pattern as testimonials.js)
   when there's more than one; a single demo just sits centered with
   no dots/arrows since there's nothing to browse between yet.

   Each iframe's src is assigned once the section comes within a
   generous lead distance of the viewport (IntersectionObserver,
   rootMargin extended well past the bottom edge — see
   loadWhenNear() below), not the instant the page loads.

   BUG FIX: per report, "when i refresh the page on safari and mobile,
   the page sometimes just goes black" — this used to force all 3
   iframes' src on unconditionally ~400ms after the page's own load
   event, on EVERY page load/refresh, regardless of whether the
   visitor had scrolled anywhere near this section yet (it's the very
   first section after the hero in DOM order, but the hero itself is a
   300-400%-tall pinned scroll section, so on a fresh load this section
   actually sits several viewport-heights below scrollY:0). That meant
   every single refresh forced three separate live production websites
   — each with their own images/fonts/JS — to start loading into
   memory at once, on top of everything else this page already does
   (a continuously-animating canvas, several GSAP pin-spacers, a custom
   cursor). Mobile Safari has a much tighter per-tab memory ceiling
   than desktop; tipping over it makes WebKit's own out-of-memory
   killer silently discard the page, which is exactly a black/blank
   tab that needs a manual reload — worse, doing this unconditionally
   on every refresh made it reproducible independent of how far the
   visitor actually scrolled. A generous proximity margin (see
   PRELOAD_MARGIN below) keeps the same "no loading flash for a normal
   scroller" goal this file originally called out, while no longer
   forcing all 3 sites into memory on a refresh where the visitor
   hasn't even started scrolling yet.
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
      name: 'Velocity Tire Co.',
      industry: 'Tires & Auto Performance',
      url: 'https://velocity-tire-co.vercel.app',
    },
    {
      name: 'Haverstone Remodeling',
      industry: 'Home Remodeling',
      url: 'https://haverstone-remodeling.vercel.app',
    },
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

  // ---- start a single card's iframe loading once the section is
  // within a generous lead distance of the viewport — see this file's
  // header comment for why this is proximity-gated now instead of
  // firing unconditionally on every page load ----
  //
  // FURTHER BUG FIX: per follow-up report, "if i want to refresh it the
  // second time, that is when i get the black screen" — this used to
  // load ALL 3 demos' iframes at once (loadAllCards()), even though the
  // swipeable stack only ever shows ONE of them at a time. Two full
  // external websites were sitting fully loaded in memory the entire
  // time doing nothing but running their own background JS, for every
  // single visit. That's 3x the memory footprint the fix above already
  // targeted, for no visible benefit — and matches the "not the first
  // refresh, but the one after" pattern exactly: WebKit doesn't
  // necessarily reclaim 100% of a heavy page's peak memory the instant
  // it navigates away, so a second reload's own peak, stacked on
  // whatever the first reload's process hadn't fully released yet, is
  // what tips it over the ceiling. Loading only the active card (and
  // the next one on-demand, right as the visitor actually swipes
  // toward it — see updateActive() below) cuts the steady-state
  // footprint to one external site instead of three.
  function loadCard(i){
    const card = cards[i];
    if(!card) return;
    const iframe = card.querySelector('iframe');
    if(!iframe || !iframe.dataset.src) return;
    const src = iframe.getAttribute('src');
    if(src && src !== 'about:blank') return; // already loading/loaded
    iframe.addEventListener('load', ()=> card.classList.add('is-loaded'), { once:true });
    iframe.src = iframe.dataset.src;
  }
  function startPreloadWatch(){
    // 150% of the viewport height ahead is comfortably more lead time
    // than a normal scroll takes to cover, so a visitor who does scroll
    // this far still never sees the "Loading live site…" placeholder —
    // but a visitor who never scrolls this far (or reloads the page
    // before scrolling at all) never forces three external sites into
    // memory for nothing.
    const preloadIO = new IntersectionObserver((entries) => {
      if(!entries[0].isIntersecting) return;
      preloadIO.disconnect();
      loadCard(activeIndex);
    }, { rootMargin: '0px 0px 150% 0px' });
    preloadIO.observe(section);
  }
  if('IntersectionObserver' in window){
    // BUG FIX: this script tag (see index.html's own script order) runs
    // BEFORE GSAP/ScrollTrigger even load, so starting the observer
    // immediately meant its very first proximity check ran against the
    // page's PRE-pin layout — before the hero's own ~300-400%-tall
    // pinned scroll distance existed, #liveDemoSection's real on-page
    // position was still just one short viewport down, well inside the
    // 150% margin — so this fired instantly on every load regardless of
    // where the visitor had actually scrolled, completely defeating the
    // point. Waiting for the same load+settle delay
    // js/scroll-journey-process.js already uses before its own
    // ScrollTrigger.refresh() ensures every pin has been fully measured
    // (and mobile Safari's address bar has settled) before this
    // observer's math can be trusted.
    if(document.readyState === 'complete'){
      setTimeout(startPreloadWatch, 600);
    } else {
      window.addEventListener('load', ()=> setTimeout(startPreloadWatch, 600));
    }
  } else {
    // no IntersectionObserver support — fall back to the old
    // unconditional page-load timer rather than never loading at all,
    // still only the active card rather than all of them
    if(document.readyState === 'complete'){
      setTimeout(()=> loadCard(activeIndex), 400);
    } else {
      window.addEventListener('load', ()=> setTimeout(()=> loadCard(activeIndex), 400));
    }
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
  // first-ever visit: startPreloadWatch()/loadCard() above already
  // deliberately starts loading the active card well ahead of scroll
  // arrival so it never shows its "Loading live site…" placeholder
  // right as it scrolls in. The section starts off-screen below the
  // fold, so this observer's very first reading is "not intersecting"
  // — reacting to that would blank the iframe before the visitor ever
  // arrives and bring back exactly the loading flash this was built to
  // avoid. The hasBeenVisible guard makes sure pausing only ever
  // happens on a real "was visible, now scrolled away" transition.
  //
  // Only re-loads cards[activeIndex] on return, not every card — see
  // loadCard()'s own comment for why this only ever keeps one demo's
  // iframe alive at a time now.
  if('IntersectionObserver' in window){
    let hasBeenVisible = false;
    const visibilityIO = new IntersectionObserver((entries)=>{
      const isVisible = entries[0].isIntersecting;
      if(isVisible){
        hasBeenVisible = true;
        loadCard(activeIndex);
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

  // ---- whichever card sits centered in the stack gets the active dot,
  // and — per the memory-footprint fix above — is the one whose iframe
  // actually gets loaded. Firing loadCard() here means a swipe toward a
  // not-yet-loaded neighbor starts it loading right as the drag begins
  // (updateActive() runs on every scroll frame during the swipe, well
  // before it settles on the new card), not only once the swipe has
  // already finished. ----
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
    loadCard(activeIndex);
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
