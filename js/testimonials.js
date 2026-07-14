/* ===================================================================
   Papi — testimonials
   A tall section with a sticky inner viewport (same pattern as the
   showcase and cube sections). One testimonial card is "active" at a
   time; as the visitor scrolls, it slides out to the left while the
   next one slides in from the right — a horizontal filmstrip rather
   than a vertical scroll, so it doesn't feel like just another
   "scroll up" moment stacked on everything else on the page.

   It loops: scrolling past the last testimonial brings the first one
   back in from the right (and reversing brings the last one back in
   from the left) — treating the testimonials as a circle rather than
   a dead-ended list, so there's no "end" to abruptly stop at.

   Dot pagination at the bottom mirrors progress and is clickable,
   same idea as the showcase's clickable trade list.
=================================================================== */
(function(){
  const section = document.getElementById('testimonialsSection');
  const stack = document.getElementById('testimonialStack');
  const dotsEl = document.getElementById('testimonialDots');
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

  // reserve the final 1/n of the scroll range to loop back to the
  // first testimonial, rather than dead-ending on the last one
  function scrollToIndex(i){
    const sectionTop = section.offsetTop;
    const scrollable = Math.max(1, section.offsetHeight - window.innerHeight);
    const target = sectionTop + (i / n) * scrollable;
    window.scrollTo({ top: target, behavior: 'smooth' });
  }

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
    dot.addEventListener('click', ()=> scrollToIndex(i));
    dotsEl.appendChild(dot);
    dots.push(dot);
  });

  // one extra "lap" of scroll room to loop back to the first card —
  // 130vh per testimonial (not 70) so each one holds long enough to
  // actually read before the next slides in, rather than flipping past
  section.style.height = ((n + 1) * 130) + 'vh';

  // shortest signed distance between two points on a circle of
  // circumference n — this is what makes the whole thing loop: card 0
  // reads as "close" both right after card n-1 and right before it
  function circularDelta(a, b){
    let d = a - b;
    d = ((d % n) + n) % n; // 0..n
    if(d > n / 2) d -= n;  // fold into -n/2..n/2
    return d;
  }

  function update(){
    const sectionTop = section.offsetTop;
    const sectionHeight = section.offsetHeight;
    const scrollable = Math.max(1, sectionHeight - window.innerHeight);
    const progress = Math.max(0, Math.min(1, (window.scrollY - sectionTop) / scrollable));
    const activeFloat = progress * n; // 0..n, where n wraps back to 0

    cards.forEach((card, i)=>{
      const d = circularDelta(activeFloat, i);
      const blend = Math.max(0, 1 - Math.abs(d));
      // cards already passed (d > 0) exit to the left; cards still
      // ahead (d < 0) wait off to the right, ready to slide in — left
      // to right, like reading forward through the list
      const dir = d > 0 ? -1 : 1;
      const offset = (1 - blend) * 70 * dir;
      const scale = 0.94 + blend * 0.06;
      card.style.opacity = blend.toFixed(3);
      card.style.transform = `translateX(${offset.toFixed(1)}px) scale(${scale.toFixed(3)})`;
      card.style.zIndex = String(Math.round(blend * 100));
      card.style.pointerEvents = blend > 0.6 ? 'auto' : 'none';
    });

    dots.forEach((dot, i)=>{
      dot.classList.toggle('is-active', Math.abs(circularDelta(activeFloat, i)) < 0.5);
    });
  }

  // batch to one update per animation frame — same reasoning as the
  // showcase and title-dock scroll handlers: raw 'scroll' events can
  // fire faster than the screen repaints
  let ticking = false;
  function requestUpdate(){
    if(ticking) return;
    ticking = true;
    requestAnimationFrame(()=>{ update(); ticking = false; });
  }
  window.addEventListener('scroll', requestUpdate, { passive:true });
  window.addEventListener('resize', requestUpdate);
  update();
})();
