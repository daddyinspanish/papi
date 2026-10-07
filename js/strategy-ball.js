/* ===================================================================
   Papi — connected-dot sphere behind the "How content strategy works" steps
   Per direct request (with a reference image of a ball of connected dots,
   formed on one side and dissolving into loose dots on the other): as you
   scroll through the steps, a ball of connected lines and dots FORMS.

   The sphere is a Fibonacci lattice of dots, each linked to its few nearest
   neighbours. Every dot also has a scattered position: a loose, drifting
   cloud around the ball, with bigger and smaller dots like the reference.
   Scroll progress (set by js/content-strategy.js through
   window.PapiStrategyBall.setProgress) pulls dots from the cloud onto the
   sphere one after another — each dot has its own threshold, sweeping across
   the ball from one side to the other — and the links fade in between dots
   that have landed. The finished ball keeps turning slowly.

   The canvas is sticky inside the section, so the ball stays centred on
   screen while the steps scroll over it — it follows you down the list,
   centered on the line, and does not move sideways. Colors follow the page's
   data-theme (re-checked every frame, see js/hero-grid.js for why). Runs
   only while the section is on screen; one static frame under reduced
   motion.
=================================================================== */
(function(){
  const canvas = document.getElementById('csBall');
  if(!canvas) return;
  const ctx = canvas.getContext('2d');
  if(!ctx) return;
  const section = canvas.closest('.cs-section');
  if(!section) return;

  const rootEl = document.documentElement;
  const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const isPhone = () => window.innerWidth < 640;

  const PALETTES = {
    light: { rgb: '4,120,87', alpha: 1 },
    dark:  { rgb: '52,211,153', alpha: 0.9 },
  };

  // ---- geometry (built once per size class)
  let N = 0, pts = [], links = [];
  function build(){
    N = isPhone() ? 72 : 124;
    pts = [];
    const golden = Math.PI * (3 - Math.sqrt(5));
    for(let i = 0; i < N; i++){
      const y = 1 - 2 * (i + 0.5) / N;
      const r = Math.sqrt(1 - y * y);
      const th = i * golden;
      pts.push({
        x: Math.cos(th) * r, y, z: Math.sin(th) * r,
        // scattered home: a loose cloud around the ball, bigger toward the outside
        sa: Math.random() * Math.PI * 2,
        sr: 1.08 + Math.random() * 1.15,
        sz: (Math.random() - 0.5) * 1.2,
        ph: Math.random() * Math.PI * 2,
        sp: 0.15 + Math.random() * 0.25,
        big: Math.random() < 0.16,
        sizeScatter: 0,
        thr: 0,
      });
    }
    // formation order: sweeps across the ball from one side to the other,
    // with a little randomness so it reads as organic, not a wipe
    const key = pts.map((p) => p.x * 0.85 + p.y * 0.3 - p.z * 0.15);
    const lo = Math.min(...key), hi = Math.max(...key);
    pts.forEach((p, i) => {
      const s = (hi - key[i]) / (hi - lo);           // 0 at the leading edge, 1 at the far side
      p.thr = s * 0.68 + (Math.random() - 0.5) * 0.08;
      p.thr = Math.max(0, p.thr);
      p.sizeScatter = p.big ? 3.4 + Math.random() * 2.6 : 1.3 + Math.random() * 1.6;
    });
    // each dot links to its 3 nearest neighbours (deduplicated)
    const seen = new Set();
    links = [];
    for(let i = 0; i < N; i++){
      const d = [];
      for(let j = 0; j < N; j++){
        if(i === j) continue;
        const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y, dz = pts[i].z - pts[j].z;
        d.push([dx * dx + dy * dy + dz * dz, j]);
      }
      d.sort((a, b) => a[0] - b[0]);
      for(let k = 0; k < 3; k++){
        const j = d[k][1];
        const key = i < j ? i * 1000 + j : j * 1000 + i;
        if(seen.has(key)) continue;
        seen.add(key);
        links.push([i, j]);
      }
    }
  }

  // ---- sizing
  let W = 0, H = 0, dpr = 1, lastW = 0, lastH = 0;
  function resize(){
    const w = section.clientWidth || window.innerWidth;
    const h = window.innerHeight;
    if(!w || !h) return;
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    W = w; H = h;
    lastW = w; lastH = h;
  }

  // ---- state driven from js/content-strategy.js
  let target = 0, cur = 0;       // formation progress 0..1
  window.PapiStrategyBall = {
    setProgress(p){ target = Math.max(0, Math.min(1, p)); if(reduceMotion) cur = target; },
    redraw(){ if(reduceMotion) draw(0, 1 / 60); },
  };

  const smooth = (x) => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
  const ALEV = 10;
  const linkB = Array.from({ length: ALEV + 1 }, () => []);
  const dotB = Array.from({ length: ALEV + 1 }, () => []);
  const px = new Float32Array(256), py = new Float32Array(256), pe = new Float32Array(256), pr = new Float32Array(256), pa = new Float32Array(256);

  function draw(t, dt){
    const dark = rootEl.getAttribute('data-theme') === 'dark';
    const pal = dark ? PALETTES.dark : PALETTES.light;
    ctx.clearRect(0, 0, W, H);

    // fade the whole ball in/out as the section enters/leaves the screen
    const r = section.getBoundingClientRect();
    const vh = window.innerHeight;
    const vis = smooth((vh - r.top) / (vh * 0.55)) * smooth(r.bottom / (vh * 0.55));
    if(vis <= 0.01) return;

    // ease toward the targets (frame-rate independent)
    if(!reduceMotion){
      cur += (target - cur) * (1 - Math.exp(-dt / 0.35));
    }

    const phone = isPhone();
    // phones: the cards fill the width and hide most of the ball, so it is drawn
    // larger (and a touch stronger) there so its edges show around and between them
    const R = Math.min(W * (phone ? 0.62 : 0.26), H * (phone ? 0.36 : 0.34));
    const cx = W / 2;
    const cy = H * 0.5;
    const ang = t * 0.12 + cur * 1.6;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const tilt = 0.38, ct = Math.cos(tilt), st = Math.sin(tilt);
    const baseA = pal.alpha * vis * (phone ? 0.95 : 1);

    for(let i = 0; i < N; i++){
      const p = pts[i];
      const e = smooth((cur - p.thr) / 0.3);        // 0 = loose dot, 1 = landed on the ball
      // sphere position: rotate about Y, then tilt about X
      const x1 = p.x * ca + p.z * sa, z1 = -p.x * sa + p.z * ca;
      const y2 = p.y * ct - z1 * st, z2 = p.y * st + z1 * ct;
      const persp = 1 + z2 * 0.16;
      const sx = cx + x1 * R * persp, sy = cy + y2 * R * persp;
      // scattered position: a slowly drifting cloud around the ball
      const dr = p.sr * R;
      const wx = Math.cos(p.sa + t * p.sp * 0.4) * dr + Math.sin(t * p.sp + p.ph) * R * 0.05;
      const wy = Math.sin(p.sa + t * p.sp * 0.4) * dr * 0.8 + Math.cos(t * p.sp * 0.8 + p.ph) * R * 0.05;
      const lx = cx + wx, ly = cy + wy;
      px[i] = lx + (sx - lx) * e;
      py[i] = ly + (sy - ly) * e;
      pe[i] = e;
      // size: loose dots are bigger and vary; landed dots are small and shrink with depth
      pr[i] = p.sizeScatter + (1.5 + (z2 + 1) * 0.55 - p.sizeScatter) * e;
      pa[i] = (0.42 + (0.5 - 0.42) * e + e * (z2 + 1) * 0.12) * baseA;
    }

    // links between dots that have landed
    for(let k = 0; k < links.length; k++){
      const a = links[k][0], b = links[k][1];
      const e = Math.min(pe[a], pe[b]);
      if(e < 0.04) continue;
      const q = Math.round(e * e * 0.55 * baseA * ALEV);
      if(q < 1) continue;
      linkB[q > ALEV ? ALEV : q].push(px[a], py[a], px[b], py[b]);
    }
    ctx.lineWidth = 1;
    for(let q = 1; q <= ALEV; q++){
      const arr = linkB[q];
      if(!arr.length) continue;
      ctx.strokeStyle = `rgba(${pal.rgb},${(q / ALEV).toFixed(3)})`;
      ctx.beginPath();
      for(let k = 0; k < arr.length; k += 4){ ctx.moveTo(arr[k], arr[k + 1]); ctx.lineTo(arr[k + 2], arr[k + 3]); }
      ctx.stroke();
      arr.length = 0;
    }
    // dots, bucketed by alpha (radius varies per dot)
    for(let i = 0; i < N; i++){
      const q = Math.max(1, Math.min(ALEV, Math.round(pa[i] * ALEV)));
      dotB[q].push(px[i], py[i], pr[i]);
    }
    for(let q = 1; q <= ALEV; q++){
      const arr = dotB[q];
      if(!arr.length) continue;
      ctx.fillStyle = `rgba(${pal.rgb},${(q / ALEV).toFixed(3)})`;
      ctx.beginPath();
      for(let k = 0; k < arr.length; k += 3){ ctx.moveTo(arr[k] + arr[k + 2], arr[k + 1]); ctx.arc(arr[k], arr[k + 1], arr[k + 2], 0, 6.2832); }
      ctx.fill();
      arr.length = 0;
    }
  }

  build();
  resize();
  // rebuild only on a real size-class change; ignore mobile toolbar resizes
  window.addEventListener('resize', () => {
    const w = section.clientWidth || window.innerWidth;
    const wasPhone = N <= 72;
    if(Math.abs(w - lastW) > 10 || Math.abs(window.innerHeight - lastH) > 140){
      resize();
      if(wasPhone !== isPhone()) build();
    }
  });
  window.addEventListener('papi:themechange', () => { if(reduceMotion) draw(0, 1 / 60); });

  if(reduceMotion){ draw(0, 1 / 60); return; }

  let raf = 0, last = 0, t0 = null, visible = false;
  const INTERVAL = 1000 / (isPhone() ? 30 : 45);
  function loop(ts){
    raf = requestAnimationFrame(loop);
    if(t0 === null) t0 = ts;
    if(ts - last < INTERVAL - 1) return;
    const dt = last ? Math.min((ts - last) / 1000, 0.1) : 1 / 60;
    last = ts;
    draw((ts - t0) / 1000, dt);
  }
  function sync(){
    const want = visible && !document.hidden;
    if(want && !raf){ last = 0; raf = requestAnimationFrame(loop); }
    else if(!want && raf){ cancelAnimationFrame(raf); raf = 0; }
  }
  if('IntersectionObserver' in window){
    new IntersectionObserver((entries) => { visible = entries[0].isIntersecting; sync(); }, { threshold: 0, rootMargin: '80px 0px' }).observe(section);
  } else { visible = true; }
  document.addEventListener('visibilitychange', sync);
  sync();
})();
