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
  const stack = document.getElementById('testimonialStack');
  const dotsEl = document.getElementById('testimonialDots');
  const prevBtn = document.getElementById('testimonialPrev');
  const nextBtn = document.getElementById('testimonialNext');
  if(!section || !stack || !dotsEl) return;

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
  window.addEventListener('resize', requestUpdate);

  if(prevBtn) prevBtn.addEventListener('click', ()=> goTo(activeIndex - 1));
  if(nextBtn) nextBtn.addEventListener('click', ()=> goTo(activeIndex + 1));

  // first card starts active; run once layout has settled
  requestAnimationFrame(()=>{
    cards[0].classList.add('is-active');
    dots[0].classList.add('is-active');
  });
})();
