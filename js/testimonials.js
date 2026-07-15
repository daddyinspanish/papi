/* ===================================================================
   Papi — testimonials
   A horizontally swipeable row (native scroll-snap, so touch drag just
   works with no JS needed for the gesture itself) rather than the
   vertical scroll-hijacked slideshow this used to be — browsing
   testimonials and scrolling down the page are now fully independent,
   so nobody has to swipe/scroll through all of them just to reach the
   form below. Dot pagination (and prev/next arrows on non-touch
   devices) mirror and control which card is centered.
=================================================================== */
(function(){
  const section = document.getElementById('testimonialsSection');
  const sticky = document.querySelector('.testimonials-sticky');
  const stack = document.getElementById('testimonialStack');
  const dotsEl = document.getElementById('testimonialDots');
  const prevBtn = document.getElementById('testimonialPrev');
  const nextBtn = document.getElementById('testimonialNext');
  const headingEl = document.querySelector('.testimonials-heading');
  if(!section || !stack || !dotsEl) return;

  function smoothstep(edge0, edge1, x){
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  }

  // split into words so they can sign on one after another, each with
  // its own slight rotation/swoop rather than the whole line just
  // fading in flat — reads more like a flourish than a plain reveal
  let headingWords = [];
  if(headingEl){
    const text = headingEl.textContent.trim();
    headingEl.innerHTML = '';
    headingWords = text.split(/\s+/).map(word=>{
      const span = document.createElement('span');
      span.className = 'testimonials-heading-word';
      span.textContent = word;
      headingEl.appendChild(span);
      headingEl.appendChild(document.createTextNode(' '));
      return span;
    });
  }

  // once, the first time the section has mostly settled into view, the
  // stack actually scrolls itself a little and back — a real preview
  // of the drag gesture rather than just a static "swipe to browse"
  // label, so it's obvious the row responds to a real swipe
  let hasNudged = false;
  function maybeNudge(bodyP){
    if(hasNudged || bodyP < 0.96) return;
    hasNudged = true;
    setTimeout(()=>{
      stack.scrollBy({ left: 60, behavior:'smooth' });
      setTimeout(()=>{ stack.scrollBy({ left: -60, behavior:'smooth' }); }, 500);
    }, 500);
  }

  // the whole section rises and fades in as it enters from below, tied
  // directly to scroll position (same convention as the cube title and
  // quote form) rather than a fixed-duration animation triggered once —
  // and the heading signs itself in, word by word, over the same window
  function updateEntrance(){
    if(!sticky) return;
    const rect = section.getBoundingClientRect();
    const vh = window.innerHeight;
    const raw = (vh - rect.top) / (vh * 0.75);
    const p = Math.max(0, Math.min(1, raw));
    const bodyP = smoothstep(0, 1, p);
    sticky.style.opacity = bodyP.toFixed(3);
    sticky.style.transform = `translateY(${((1 - bodyP) * 34).toFixed(1)}px)`;
    maybeNudge(bodyP);

    const wn = headingWords.length;
    if(wn){
      const signP = smoothstep(0.15, 0.85, p); // starts a beat after the section itself begins rising
      const spread = 0.6;
      for(let i=0;i<wn;i++){
        const start = wn > 1 ? (i / (wn - 1)) * spread : 0;
        const wp = smoothstep(start, start + (1 - spread), signP);
        const el = headingWords[i];
        const rot = (1 - wp) * (i % 2 === 0 ? -10 : 10);
        el.style.opacity = wp.toFixed(3);
        el.style.transform = `translateY(${((1 - wp) * 22).toFixed(1)}px) rotate(${rot.toFixed(1)}deg)`;
      }
    }
  }

  const TESTIMONIALS = [
    { icon:'🏠', industry:'Roofing', quote:'Papi gave us a site that finally looks as solid as the roofs we build. Calls started coming in the same week.', result:'+38% more calls in month one', name:'Marcus T.', role:'Owner' },
    { icon:'🦷', industry:'Dentists', quote:'Patients tell us the website is what made them trust us enough to book. That had never happened before.', result:'Bookings up 3x since launch', name:'Dr. Elena R.', role:'Practice Owner' },
    { icon:'🔧', industry:'Plumbers', quote:'We used to lose jobs to companies with nicer websites. Now we’re the nicer website.', result:'Fully booked within 6 weeks', name:'Sam D.', role:'Owner' },
    { icon:'⚡', industry:'Electricians', quote:'Simple, clean, and it actually explains what we do. Quote requests doubled in two months.', result:'Quote requests doubled', name:'Priya K.', role:'Operations Lead' },
    { icon:'🏢', industry:'Real Estate', quote:'It feels like a listing people already trust before they even call. That credibility closes deals.', result:'Listings viewed 5x longer', name:'Jordan M.', role:'Broker' },
    { icon:'⚖️', industry:'Law Firms', quote:'Clients read the homepage and already feel like they know what happens next. That’s rare in our industry.', result:'Consultations up 60%', name:'Andre F.', role:'Partner' },
    { icon:'🍽️', industry:'Restaurants', quote:'Reservations went up the week we launched. People said it finally looked like the food tastes.', result:'Booked out most weekends', name:'Nina S.', role:'Owner' },
    { icon:'💪', industry:'Fitness Studios', quote:'New members mention the website in their first class. It set the tone before they even walked in.', result:'New members every week', name:'Théo B.', role:'Founder' },
  ];

  const n = TESTIMONIALS.length;
  const cards = [];
  const dots = [];

  TESTIMONIALS.forEach((t, i)=>{
    const card = document.createElement('div');
    card.className = 'testimonial-card';
    card.innerHTML = `
      <span class="testimonial-icon">${t.icon}</span>
      <p class="testimonial-industry">${t.industry}</p>
      <blockquote class="testimonial-quote">“${t.quote}”</blockquote>
      <p class="testimonial-result">${t.result}</p>
      <div class="testimonial-stars" aria-hidden="true">★★★★★</div>
      <p class="testimonial-name">${t.name} <span>— ${t.role}</span></p>`;
    // lets a visitor tap a neighboring (not-yet-centered) card to jump
    // straight to it, instead of only being able to get there by
    // swiping all the way — same idea as the showcase's fan cards
    card.addEventListener('click', ()=> goTo(i));
    stack.appendChild(card);
    cards.push(card);

    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'testimonial-dot';
    dot.setAttribute('aria-label', `Show the ${t.industry} testimonial`);
    dot.addEventListener('click', ()=> goTo(i));
    dotsEl.appendChild(dot);
    dots.push(dot);
  });

  function goTo(i){
    const clamped = Math.max(0, Math.min(n - 1, i));
    cards[clamped].scrollIntoView({ behavior:'smooth', inline:'center', block:'nearest' });
  }

  let activeIndex = 0;
  function updateActive(){
    // whichever card's centre sits closest to the stack's own centre
    const stackRect = stack.getBoundingClientRect();
    const stackCenter = stackRect.left + stackRect.width / 2;
    let closest = 0;
    let closestDist = Infinity;
    cards.forEach((card, i)=>{
      const r = card.getBoundingClientRect();
      const cardCenter = r.left + r.width / 2;
      const dist = Math.abs(cardCenter - stackCenter);
      if(dist < closestDist){ closestDist = dist; closest = i; }
    });
    if(closest === activeIndex) return;
    activeIndex = closest;
    cards.forEach((card, i)=> card.classList.toggle('is-active', i === activeIndex));
    dots.forEach((dot, i)=> dot.classList.toggle('is-active', i === activeIndex));
  }

  // batch to one check per animation frame — the stack's own 'scroll'
  // event (from swiping/dragging) can fire very rapidly
  let ticking = false;
  function requestUpdate(){
    if(ticking) return;
    ticking = true;
    requestAnimationFrame(()=>{ updateActive(); ticking = false; });
  }
  stack.addEventListener('scroll', requestUpdate, { passive:true });
  window.addEventListener('resize', ()=>{ requestUpdate(); updateEntrance(); });

  let entranceTicking = false;
  window.addEventListener('scroll', ()=>{
    if(entranceTicking) return;
    entranceTicking = true;
    requestAnimationFrame(()=>{ updateEntrance(); entranceTicking = false; });
  }, { passive:true });
  updateEntrance();

  if(prevBtn) prevBtn.addEventListener('click', ()=> goTo(activeIndex - 1));
  if(nextBtn) nextBtn.addEventListener('click', ()=> goTo(activeIndex + 1));

  // first card starts active; run once layout has settled
  requestAnimationFrame(()=>{
    cards[0].classList.add('is-active');
    dots[0].classList.add('is-active');
  });
})();
