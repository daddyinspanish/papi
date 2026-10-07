/* ===================================================================
   Papi — converging speed-streak background for the reviews section
   Per direct request: take the look of diagonal bars streaming in from
   two opposite corners, thick and dense at the corner and thinning to
   fine points toward an empty gap in the middle — and keep the site's
   connected-dot-line language.

   Every streak is a beaded line: dots spaced along a straight diagonal,
   joined by a segment whose width tapers as it nears the centre. Two
   clusters (top-right and bottom-left) sit on the same diagonal axis;
   streak offsets from that axis are spread wide at the corners and the
   reach of each streak shortens with its offset, so the cluster funnels
   toward the middle. Streaks slide continuously toward the centre and
   fade out before they reach it, with new ones entering at the corner.
   Where two neighbouring streaks run close together, short cross-links
   join their dots, so the dense edge reads as a connected web while
   the long, lonely streaks stay as single beaded lines.

   Plain 2D canvas; paused off-screen and in a hidden tab; static single
   frame under prefers-reduced-motion.
=================================================================== */
(function(){
  const canvas = document.getElementById('testimonialStreaks');
  if(!canvas) return;
  const ctx = canvas.getContext('2d');
  if(!ctx) return;
  const section = canvas.closest('.testimonials-section');
  if(!section) return;

  const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isPhone = () => window.innerWidth < 640;

  // brand emerald family (dark, mid, bright) — the reference's blues,
  // translated into the site's own palette
  // theme-aware colors (see js/theme.js): read from the CSS variables, and
  // re-read whenever the visitor flips light/dark
  const rootEl = document.documentElement;
  const readVar = (n, fallback) => (getComputedStyle(rootEl).getPropertyValue(n).trim() || fallback);
  const isDarkTheme = () => rootEl.getAttribute('data-theme') === 'dark';
  const PALETTES = {
    light: ['4,120,87', '4,120,87', '16,185,129', '5,150,105', '52,211,153'],
    dark: ['52,211,153', '110,231,183', '16,185,129', '52,211,153', '167,243,208'],
  };
  let PALETTE = PALETTES.light;
  function readTheme(){ PALETTE = isDarkTheme() ? PALETTES.dark : PALETTES.light; }
  readTheme();
  window.addEventListener('papi:themechange', () => { readTheme(); if(prefersReducedMotion) draw(6); });
  const SPACING = 11;          // px between dots along a streak

  let W = 0, H = 0, dpr = 1;
  let ax = 0, ay = 0;          // unit vector along the axis, top-right corner -> centre
  let nx = 0, ny = 0;          // unit normal to the axis
  let reach = 0, band = 0, alphaScale = 1;
  let clusters = [];           // [{ox, oy, sign, streaks}]

  function rnd(a, b){ return a + Math.random() * (b - a); }

  function makeStreaks(count){
    const list = [];
    for(let i = 0; i < count; i++){
      // offsets cluster toward the axis a little, so the middle of the
      // funnel is the densest part
      const u = Math.random() * 2 - 1;
      const o = Math.sign(u) * Math.pow(Math.abs(u), 1.35) * band;
      const falloff = 1 - 0.78 * Math.min(1, Math.abs(o) / band);
      const rm = reach * falloff * rnd(0.82, 1);
      const len = rnd(70, 340) * (0.55 + 0.45 * falloff);
      list.push({
        o, rm, len,
        v: rnd(7, 20),                        // px/s toward the centre (slow drift)
        phase: Math.random() * (rm + len),
        w0: rnd(1, 4.8) * (0.5 + 0.5 * falloff),
        ci: (Math.random() * 5) | 0,
        a0: rnd(0.2, 0.42),
      });
    }
    list.sort((p, q) => p.o - q.o);
    return list;
  }

  function build(){
    const hx = W / 2, hy = H / 2;
    const half = Math.hypot(hx, hy);
    ax = -hx / half; ay = hy / half;          // pointing from top-right corner toward centre
    nx = -ay; ny = ax;
    // phones: the section is tall and narrow, so the same funnel would run
    // straight through the heading — keep it tucked into the corners
    const phone = isPhone();
    reach = half * (phone ? 0.3 : 0.64);
    band = phone ? Math.max(W * 0.3, 90) : Math.min(Math.max(Math.min(W, H) * 0.44, 110), 360);
    alphaScale = phone ? 0.6 : 1;
    const n = isPhone() ? 12 : 30;
    clusters = [
      { ox: W, oy: 0, sign: 1, streaks: makeStreaks(n) },
      { ox: 0, oy: H, sign: -1, streaks: makeStreaks(n) },
    ];
  }

  function resize(){
    const w = section.clientWidth || window.innerWidth;
    const h = section.clientHeight || window.innerHeight;
    if(!w || !h) return;
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    W = w; H = h;
    build();
    if(prefersReducedMotion) draw(6);
  }

  // the same smooth phase field the steps section uses
  // (js/process-flow.js): a few low-frequency sines whose phase is bent by
  // two slower sines. Every dot is nudged sideways by it, so a streak
  // bends and undulates like a ribbon instead of running straight, and
  // neighbouring streaks (same field) bend together.
  const FLOW_AMP = 46;     // px of sideways flow at the tip of a streak
  function phase(x, y, t){
    const u = x * 0.0046, v = y * 0.0036;
    const w1 = Math.sin(u * 1.1 + v * 0.8 + t * 0.33);
    const w2 = Math.sin(v * 1.7 - u * 0.6 - t * 0.26 + 1.3);
    return u * 1.4 + v * 0.9 + 1.6 * w1 + 1.1 * w2 + t * 0.42;
  }

  // streak state at time t: visible slice [s, e] along the axis, or null
  function slice(st, t){
    const span = st.rm + st.len;
    let tail = ((st.phase + st.v * t) % span) - st.len;
    const s = Math.max(tail, 0), e = Math.min(tail + st.len, st.rm);
    if(e - s < 3) return null;
    return { s, e };
  }

  function draw(t){
    ctx.clearRect(0, 0, W, H);
    ctx.lineCap = 'round';

    for(const cl of clusters){
      const dx = ax * cl.sign, dy = ay * cl.sign;
      const prev = { pts: null, o: 0 };
      for(const st of cl.streaks){
        const sl = slice(st, t);
        if(!sl){ prev.pts = null; continue; }
        const mid = (sl.s + sl.e) / 2;
        const f = mid / st.rm;                          // 0 at the corner -> 1 at the tip
        const env = Math.max(0, 1 - Math.pow(f, 2.4));   // stays bold, then fades out before the centre
        const alpha = st.a0 * env * alphaScale;
        if(alpha < 0.02){ prev.pts = null; continue; }
        const width = Math.max(0.8, st.w0 * (1 - 0.6 * f));
        const n = Math.max(1, Math.floor((sl.e - sl.s) / SPACING));
        const step = (sl.e - sl.s) / n;
        const pts = [];
        for(let m = 0; m <= n; m++){
          const a = sl.s + m * step;
          const bx = cl.ox + dx * a + nx * st.o, by = cl.oy + dy * a + ny * st.o;
          // calmer near the corner, freer toward the thin tip
          const ph = phase(bx, by, t);
          const side = FLOW_AMP * (0.3 + 0.7 * (a / st.rm)) * Math.sin(ph);
          const along = 7 * Math.sin(ph * 0.8 + 2.0);
          pts.push(bx + nx * side + dx * along, by + ny * side + dy * along, a);
        }

        // connected line, width tapering along the streak
        ctx.strokeStyle = `rgba(${PALETTE[st.ci]},${alpha.toFixed(3)})`;
        for(let m = 0; m < n; m++){
          const fm = (pts[m * 3 + 2] + step / 2) / st.rm;
          ctx.lineWidth = Math.max(0.7, st.w0 * (1 - 0.6 * Math.min(1, fm)));
          ctx.beginPath();
          ctx.moveTo(pts[m * 3], pts[m * 3 + 1]);
          ctx.lineTo(pts[m * 3 + 3], pts[m * 3 + 4]);
          ctx.stroke();
        }
        // beads
        ctx.fillStyle = `rgba(${PALETTE[st.ci]},${Math.min(0.9, alpha * 1.25).toFixed(3)})`;
        const r = Math.max(0.9, width * 0.42 + 0.5);
        ctx.beginPath();
        for(let m = 0; m <= n; m++){
          ctx.moveTo(pts[m * 3] + r, pts[m * 3 + 1]);
          ctx.arc(pts[m * 3], pts[m * 3 + 1], r, 0, Math.PI * 2);
        }
        ctx.fill();

        // cross-links to the neighbouring streak where the two run close
        if(prev.pts && Math.abs(st.o - prev.o) < 52){
          const pp = prev.pts, pn = pp.length / 3;
          ctx.strokeStyle = `rgba(${PALETTE[st.ci]},${(Math.min(alpha, prev.alpha) * 0.45).toFixed(3)})`;
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          let drawn = 0;
          for(let m = 0; m <= n && drawn < 7; m += 2){
            const a = pts[m * 3 + 2];
            // nearest dot on the previous streak along the axis
            let best = -1, bd = 1e9;
            for(let k = 0; k < pn; k++){
              const d = Math.abs(pp[k * 3 + 2] - a);
              if(d < bd){ bd = d; best = k; }
            }
            if(best < 0 || bd > SPACING * 1.4) continue;
            ctx.moveTo(pts[m * 3], pts[m * 3 + 1]);
            ctx.lineTo(pp[best * 3], pp[best * 3 + 1]);
            drawn++;
          }
          ctx.stroke();
        }
        prev.pts = pts; prev.o = st.o; prev.alpha = alpha;
      }
    }
  }

  // same resize guard as the other background canvases
  let lastW = 0, lastH = 0;
  function handleResize(){
    const w = section.clientWidth || window.innerWidth;
    const h = section.clientHeight || window.innerHeight;
    if(Math.abs(w - lastW) <= 10 && Math.abs(h - lastH) <= 24) return;
    lastW = w; lastH = h;
    resize();
  }
  if('ResizeObserver' in window){
    const ro = new ResizeObserver(() => {
      clearTimeout(window.__papiStreaksResizeT);
      window.__papiStreaksResizeT = setTimeout(handleResize, 150);
    });
    ro.observe(section);
  } else {
    window.addEventListener('resize', () => {
      clearTimeout(window.__papiStreaksResizeT);
      window.__papiStreaksResizeT = setTimeout(handleResize, 150);
    });
  }
  handleResize();

  if(prefersReducedMotion){ draw(6); return; }

  let isVisible = false;
  let rafId = null;
  let startTs = null;
  let lastRenderTs = 0;
  const INTERVAL = 1000 / (isPhone() ? 30 : 45);

  function loop(ts){
    if(startTs === null) startTs = ts;
    if(ts - lastRenderTs >= INTERVAL - 1){
      lastRenderTs = ts;
      draw((ts - startTs) / 1000);
    }
    rafId = requestAnimationFrame(loop);
  }
  function startLoop(){ if(rafId === null) rafId = requestAnimationFrame(loop); }
  function stopLoop(){ if(rafId !== null){ cancelAnimationFrame(rafId); rafId = null; } }
  function syncLoop(){ if(isVisible && !document.hidden) startLoop(); else stopLoop(); }

  if('IntersectionObserver' in window){
    const io = new IntersectionObserver((entries) => {
      isVisible = entries[0].isIntersecting;
      syncLoop();
    }, { threshold: 0, rootMargin: '120px 0px' });
    io.observe(section);
  } else {
    isVisible = true;
  }
  document.addEventListener('visibilitychange', syncLoop);
  syncLoop();
})();
