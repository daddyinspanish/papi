/* ===================================================================
   Papi — live demos
   Each card shows a real full-page capture of the site (a tall WebP,
   see img/demos/) inside the browser frame, so there is ALWAYS
   something real on screen — never a blank frame or a play button:

     - idle: the capture drifts slowly down and back on its own
     - desktop hover: the capture scrolls with the cursor, like moving
       through the real page
     - rest the cursor on it (after actually moving it) and the REAL
       site loads over the capture and takes over; on touch devices a
       tap does the same

   Nothing external ever loads on page load, scroll, or a cursor merely
   passing by — each demo is a full separate production site (one makes
   100+ requests just for its hero), so a site only loads after a
   deliberate hover-rest or tap, only ONE is ever live at a time, and
   it is unloaded again (iframe src blanked — display:none does not stop
   an iframe's scripts) the moment the visitor scrolls past this
   section or opens another demo. Data-saver / 2G connections skip the
   hover trigger and keep click/tap only.

   `url` below is each site's own real custom domain — host, iframe src
   and the "Visit full site" link are all derived from it. To refresh a
   capture, replace the files in img/demos/ and bump the ?v= on them.
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
  function clamp01(x){ return Math.max(0, Math.min(1, x)); }

  const finePointer = !!(window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches);
  const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const phoneMQ = window.matchMedia ? window.matchMedia('(max-width: 700px)') : { matches:false };
  const conn = navigator.connection;
  const savingData = !!(conn && (conn.saveData || /(^|-)2g$/.test(conn.effectiveType || '')));
  const canHoverLoad = finePointer && !savingData;

  const HOVER_MIN_TRAVEL = 40;   // px of real cursor travel before a rest can count
  const HOVER_REST_MS = 800;     // cursor stillness (inside the frame) that means "go live"
  const AMBIENT_RANGE_MAX = 1700; // css px the idle drift covers (the hero + first sections)
  const AMBIENT_PERIOD = 36000;  // ms for one full down-and-back drift
  const SCROLL_GAIN = 2.3;       // px the preview scrolls per px the cursor moves

  // add another demo here later — everything below (cards, dots,
  // preview, hover-load, swipe) is built from this array
  const DEMOS = [
    {
      name: 'California Dental Group of North Anaheim',
      industry: 'Dentists',
      url: 'https://cdgnorth.com',
      preview: { desktop: 'img/demos/cdg-desktop.webp?v=2', mobile: 'img/demos/cdg-mobile.webp?v=2' },
    },
    {
      name: 'Dental Scanning Solutions',
      industry: 'Dental Technology',
      url: 'https://dscanningsolutions.com',
      preview: { desktop: 'img/demos/dss-desktop.webp?v=1', mobile: 'img/demos/dss-mobile.webp?v=1' },
    },
    {
      name: 'Figueroa Furniture',
      industry: 'Furniture & Home',
      url: 'https://figueroa-furniture.com',
      preview: { desktop: 'img/demos/fig-desktop.webp?v=1', mobile: 'img/demos/fig-mobile.webp?v=1' },
    },
  ];

  const n = DEMOS.length;
  const cards = [];
  const dots = [];
  const states = [];

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
          <span class="live-demo-status" aria-live="polite">Preview</span>
        </div>
        <div class="live-demo-frame-wrap">
          <div class="live-demo-preview" aria-hidden="true"><img alt="" decoding="async" draggable="false"></div>
          <iframe class="live-demo-iframe" data-src="${demo.url}" title="${demo.name} — live site" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"></iframe>
          <button type="button" class="live-demo-load-btn" aria-label="Open the live ${demo.name} site">
            <span class="live-demo-load-text">
              <span class="live-demo-hint live-demo-hint--fine">Rest your cursor here to go live</span>
              <span class="live-demo-hint live-demo-hint--touch">Tap to go live</span>
              <span class="live-demo-hint live-demo-hint--busy">Going live…</span>
            </span>
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

    const s = {
      i, demo, card,
      wrap: card.querySelector('.live-demo-frame-wrap'),
      preview: card.querySelector('.live-demo-preview'),
      img: card.querySelector('.live-demo-preview img'),
      iframe: card.querySelector('iframe'),
      btn: card.querySelector('.live-demo-load-btn'),
      status: card.querySelector('.live-demo-status'),
      attached: false, ready: false,
      visible: false, live: false, loading: false,
      max: 0, cur: 0, t0: 0,
      hover: false, tgt: 0, travel: 0, lx: 0, ly: 0,
      restTimer: 0, failTimer: 0, token: 0,
    };
    states.push(s);

    s.btn.addEventListener('click', ()=> goLive(i));

    // cursor-driven scrolling + hover-rest-to-go-live (mouse only)
    s.wrap.addEventListener('pointerenter', (e)=>{
      if(e.pointerType !== 'mouse') return;
      s.hover = true;
      s.travel = 0;
      s.lx = e.clientX; s.ly = e.clientY;
      s.tgt = s.cur; // take over from wherever the idle drift has got to
    });
    s.wrap.addEventListener('pointermove', (e)=>{
      if(e.pointerType !== 'mouse' || !s.hover) return;
      const dy = e.clientY - s.ly;
      const d = Math.hypot(e.clientX - s.lx, dy);
      s.lx = e.clientX; s.ly = e.clientY;
      // the preview scrolls by how far the cursor MOVES, not by where it
      // sits in the frame: an absolute mapping sent the whole tall page to
      // its very bottom/top whenever the cursor neared the frame's edge, and
      // jolted whenever the page itself scrolled under a resting cursor.
      // Relative movement can't jump, and a scroll-under-a-resting-cursor
      // event has no movement at all.
      if(dy) s.tgt = Math.max(0, Math.min(s.max, s.tgt + dy * SCROLL_GAIN));
      if(d <= 3) return; // jitter isn't intent
      s.travel += d;
      armRest(s);
    });
    s.wrap.addEventListener('pointerleave', (e)=>{
      if(e.pointerType !== 'mouse') return;
      s.hover = false;
      clearTimeout(s.restTimer);
      resumeAmbient(s);
    });

    if('IntersectionObserver' in window){
      const vio = new IntersectionObserver((entries)=>{
        const nowVisible = entries[0].isIntersecting;
        if(nowVisible && !s.visible){
          // every time a preview comes back into view it starts again
          // from the hero — the off-screen jump is invisible
          s.cur = 0;
          s.preview.scrollTop = 0;
          s.t0 = performance.now();
        }
        s.visible = nowVisible;
        syncLoop();
      }, { threshold: 0.15 });
      vio.observe(s.wrap);
    } else {
      s.visible = true;
    }
  });

  // nothing to browse between with only one demo — matches the CSS's
  // own .is-single rule, which hides the whole controls row
  if(controls) controls.classList.toggle('is-single', n <= 1);

  function goTo(i){
    const clamped = Math.max(0, Math.min(n - 1, i));
    cards[clamped].scrollIntoView({ behavior:'smooth', inline:'center', block:'nearest' });
  }

  // ---- the preview image ----
  function previewSrc(s){ return phoneMQ.matches ? s.demo.preview.mobile : s.demo.preview.desktop; }
  function measure(s){
    s.max = Math.max(0, s.img.offsetHeight - s.preview.clientHeight);
  }
  function attachPreview(i){
    const s = states[i];
    if(!s || s.attached) return;
    s.attached = true;
    s.img.addEventListener('load', ()=>{
      measure(s);
      s.ready = true;
      s.preview.classList.add('is-ready');
      syncLoop();
    });
    s.img.src = previewSrc(s);
  }
  function attachAround(i){
    attachPreview(i);
    const later = window.requestIdleCallback || ((fn)=> setTimeout(fn, 600));
    later(()=>{ attachPreview(i - 1); attachPreview(i + 1); });
  }
  if(phoneMQ.addEventListener){
    phoneMQ.addEventListener('change', ()=>{
      states.forEach((s)=>{ if(s.attached){ s.img.src = previewSrc(s); } });
    });
  }
  window.addEventListener('resize', ()=>{ states.forEach((s)=>{ if(s.ready) measure(s); }); });

  // ---- cursor tracking / idle drift ----
  function armRest(s){
    clearTimeout(s.restTimer);
    if(!canHoverLoad || s.live || s.loading || s.travel < HOVER_MIN_TRAVEL) return;
    s.restTimer = setTimeout(()=>{ if(s.hover) goLive(s.i); }, HOVER_REST_MS);
  }
  function ambientRange(s){ return Math.min(s.max, AMBIENT_RANGE_MAX); }
  // continue the idle drift from wherever the cursor left the preview,
  // instead of snapping to wherever the drift's own clock would be
  function resumeAmbient(s){
    const range = ambientRange(s);
    const frac = range ? clamp01(s.cur / range) : 0;
    const phase = Math.acos(1 - 2 * frac); // ascending half of the drift
    s.t0 = performance.now() - (phase / (Math.PI * 2)) * AMBIENT_PERIOD;
  }

  let raf = 0, last = 0;
  function frame(ts){
    raf = requestAnimationFrame(frame);
    const dt = last ? Math.min(ts - last, 64) : 16;
    last = ts;
    for(const s of states){
      if(!s.visible || !s.ready || s.live) continue;
      let target;
      if(s.loading){
        target = 0; // ease back to the hero, where the real site starts
      } else if(s.hover){
        target = s.tgt;
      } else if(reduceMotion){
        target = 0;
      } else {
        const range = ambientRange(s);
        const phase = ((ts - s.t0) / AMBIENT_PERIOD) * Math.PI * 2;
        target = range * (0.5 - 0.5 * Math.cos(phase));
      }
      const tau = s.hover ? 110 : (s.loading ? 140 : 60);
      s.cur += (target - s.cur) * (reduceMotion ? 1 : 1 - Math.exp(-dt / tau));
      s.preview.scrollTop = s.cur;
    }
  }
  function syncLoop(){
    const want = !document.hidden && states.some((s)=> s.visible && s.ready && !s.live);
    if(want && !raf){ last = 0; raf = requestAnimationFrame(frame); }
    else if(!want && raf){ cancelAnimationFrame(raf); raf = 0; }
  }
  document.addEventListener('visibilitychange', syncLoop);

  // ---- going live / unloading ----
  function setStatus(s, text){ if(s.status) s.status.textContent = text; }

  function goLive(i){
    const s = states[i];
    if(!s || s.live || s.loading || !s.iframe.dataset.src) return;
    states.forEach((o)=>{ if(o !== s) unloadCard(o.i); });
    clearTimeout(s.restTimer);
    s.loading = true;
    s.card.classList.add('is-loading');
    s.btn.disabled = true;
    setStatus(s, 'Loading…');
    const token = ++s.token;
    s.iframe.addEventListener('load', ()=>{
      if(token !== s.token || !s.loading) return;
      clearTimeout(s.failTimer);
      s.loading = false;
      s.live = true;
      s.card.classList.remove('is-loading');
      s.card.classList.add('is-loaded');
      setStatus(s, 'Live');
      syncLoop();
    }, { once:true });
    // a site that never answers shouldn't leave the card stuck on "Going live…"
    s.failTimer = setTimeout(()=>{ if(s.loading) unloadCard(i); }, 20000);
    s.iframe.src = s.iframe.dataset.src;
  }

  function unloadCard(i){
    const s = states[i];
    if(!s) return;
    clearTimeout(s.restTimer);
    clearTimeout(s.failTimer);
    s.token++;
    const src = s.iframe.getAttribute('src');
    if(src && src !== 'about:blank') s.iframe.src = 'about:blank';
    const wasActive = s.live || s.loading;
    s.live = false;
    s.loading = false;
    s.card.classList.remove('is-loaded', 'is-loading');
    s.btn.disabled = false;
    setStatus(s, 'Preview');
    if(wasActive){
      s.cur = 0;
      s.preview.scrollTop = 0;
      s.t0 = performance.now();
      syncLoop();
    }
  }

  // an iframe's own scripts keep running once loaded and nothing else
  // stops them, so scrolling past this section blanks every live frame
  // (the previews just carry on being previews)
  if('IntersectionObserver' in window){
    let hasBeenVisible = false;
    const leaveIO = new IntersectionObserver((entries)=>{
      if(entries[0].isIntersecting){ hasBeenVisible = true; return; }
      if(!hasBeenVisible) return;
      states.forEach((s)=> unloadCard(s.i));
    }, { threshold: 0 });
    leaveIO.observe(section);

    // fetch the capture images a little before the section arrives, so
    // the first thing seen is already the real site, not an empty frame
    const nearIO = new IntersectionObserver((entries)=>{
      if(entries[0].isIntersecting){ attachAround(activeIndex); nearIO.disconnect(); }
    }, { rootMargin: '1600px 0px 1600px 0px' });
    nearIO.observe(section);
  } else {
    attachAround(0);
  }

  // ---- whichever card sits centered in the stack gets the active dot
  // (and its neighbours' captures get fetched).
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
    // swiping away from a live site shuts it down (back to its preview)
    states.forEach((s)=>{ if(s.i !== activeIndex) unloadCard(s.i); });
    attachAround(activeIndex);
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
