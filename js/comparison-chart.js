/* ===================================================================
   Papi — customer comparison chart
   A line chart (an outdated site vs a Papi-built one) across a few
   common metrics. Both lines sit fully undrawn until the chart
   actually scrolls into view, then draw themselves in left-to-right
   (a standard SVG stroke-dasharray/dashoffset reveal) — a one-time
   animation rather than something that replays every time the section
   passes through the viewport, which would read as gimmicky rather
   than informative.
=================================================================== */
(function(){
  const section = document.getElementById('comparisonSection');
  const chartBox = document.getElementById('comparisonChart');
  const stat = document.getElementById('comparisonStat');
  if(!section || !chartBox) return;

  const lineOld = document.getElementById('comparisonLineOld');
  const linePapi = document.getElementById('comparisonLinePapi');
  const stats = Array.from(chartBox.querySelectorAll('.comparison-stat-value'));

  // undrawn starting state — each path's own length becomes both its
  // dash length and its offset, so the whole line sits hidden past its
  // own start point until the offset animates back down to 0
  [lineOld, linePapi].forEach(path=>{
    if(!path) return;
    const len = path.getTotalLength();
    path.style.strokeDasharray = String(len);
    path.style.strokeDashoffset = String(len);
  });

  function countUp(el){
    const target = parseInt(el.dataset.value, 10) || 0;
    const duration = 1000;
    const start = performance.now();
    function frame(ts){
      const t = Math.min(1, (ts - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = `+${Math.round(target * eased)}%`;
      if(t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  let revealed = false;
  function reveal(){
    if(revealed) return;
    revealed = true;
    chartBox.classList.add('is-visible');
    if(stat) stat.classList.add('is-visible');

    // the outdated-site line draws first and unhurried; the Papi line
    // starts a beat behind it and draws faster — so it visibly overtakes
    // the other line rather than the two just appearing side by side
    if(lineOld){
      lineOld.style.transition = 'stroke-dashoffset 1.1s var(--ease-out)';
      requestAnimationFrame(()=>{ lineOld.style.strokeDashoffset = '0'; });
    }
    if(linePapi){
      linePapi.style.transition = 'stroke-dashoffset 1.5s var(--ease-out) .25s';
      requestAnimationFrame(()=>{ linePapi.style.strokeDashoffset = '0'; });
    }
    // trails the line's own draw-in slightly, staggered per point, so
    // each count-up lands roughly as the line actually reaches it
    stats.forEach((el, i) => setTimeout(()=> countUp(el), 500 + i * 550));
  }

  if('IntersectionObserver' in window){
    const io = new IntersectionObserver((entries)=>{
      entries.forEach(entry => { if(entry.isIntersecting) reveal(); });
    }, { threshold: 0.35 });
    io.observe(section);
  } else {
    reveal();
  }

  // IntersectionObserver only reports a crossing the browser actually
  // renders a frame for — a fast enough scroll (a hard flick, or just
  // a struggling/thermally-throttled phone rendering fewer frames per
  // second) can jump straight past the 0.35 threshold without ever
  // painting the in-between moment, leaving the observer's callback
  // never fired and this chart stuck at its default (undrawn lines, 0%
  // stats) state for the rest of the visit. This plain scroll fallback
  // checks the section's actual on-screen position directly instead of
  // relying on the observer ever getting a chance to fire, and removes
  // itself once revealed, so it costs nothing for the rest of the visit.
  if(!revealed){
    let ticking = false;
    function checkFallback(){
      ticking = false;
      if(revealed) return;
      // true once the section has been reached OR scrolled past
      // entirely — revealing something already off-screen is harmless
      if(section.getBoundingClientRect().top < window.innerHeight) reveal();
      if(revealed) window.removeEventListener('scroll', onScroll);
    }
    function onScroll(){
      if(ticking) return;
      ticking = true;
      requestAnimationFrame(checkFallback);
    }
    window.addEventListener('scroll', onScroll, { passive:true });
    checkFallback();
  }
})();
