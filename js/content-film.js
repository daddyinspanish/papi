/* ===================================================================
   Papi — Content & Film
   Per direct request: a service section for content strategy + video
   production, scoped to dental practices specifically (per direct
   request, not the general multi-industry pitch the rest of the page
   makes). VIDEOS below holds Papi's real portfolio clips; if it ever has
   — unlike js/logo-marquee.js's empty-array convention (which hides
   its whole section), this section was explicitly asked to be visible
   fewer than 3 entries, the remaining slots render clearly-labeled
   placeholders instead of real players.

   HOW TO ADD A REAL VIDEO:
   1. Put the file somewhere under videos/ (e.g. videos/content/
      patient-testimonial.mp4), plus an optional poster image under img/.
   2. Add one entry to VIDEOS below:
        { title: 'Patient Testimonial', src: 'videos/content/patient-testimonial.mp4?v=1', poster: 'img/content/patient-testimonial.jpg' },
   3. That's it — real entries render an actual <video>, remaining
      placeholder slots (if VIDEOS has fewer than 3) keep showing as
      "coming soon" so the grid never looks sparsely populated.
=================================================================== */
(function(){
  const grid = document.getElementById('contentFilmGrid');
  if(!grid) return;

  // per direct request: Papi's own portfolio footage. All three are
  // vertical 9:16, re-encoded for the web (720x1280 H.264, faststart,
  // ~2-5MB each vs 70-400MB originals — originals live outside the
  // repo in ~/Desktop/Papi Website Videos). Poster images are real
  // frames pulled from each clip. Nothing here downloads until a
  // visitor taps play (preload="none" in buildVideoCard), so a page view
  // costs only the ~30KB posters, not the videos.
  const VIDEOS = [
    { title: '4M Dental Implant Center Transformation', src: 'videos/content/4m-transformation.mp4?v=1', poster: 'img/content/4m-transformation.webp?v=1' },
    { title: 'Starring Dr. Kamran Pakdamanian', src: 'videos/content/dr-kamran.mp4?v=1', poster: 'img/content/dr-kamran.webp?v=1' },
    { title: 'Andy Choi, Multi Family Investor', src: 'videos/content/andy-choi.mp4?v=1', poster: 'img/content/andy-choi.webp?v=1' },
  ];

  // placeholder categories — the kinds of dental-practice content this
  // service actually covers, shown until real footage fills these
  // slots in. Not real client work; labeled clearly as such.
  const PLACEHOLDER_SLOTS = [
    { label: 'Patient Testimonials', text: 'Real patients, on camera, explaining why they chose your practice.' },
    { label: 'Treatment Explainers', text: 'Short, clear videos that make procedures feel less intimidating before someone ever calls.' },
    { label: 'Behind the Scenes', text: 'Your team, your office, your equipment — the footage that builds trust before the first visit.' },
  ];

  const players = [];

  function buildVideoCard(video){
    const card = document.createElement('div');
    card.className = 'content-film-card';
    // preload="none" + poster: the browser fetches nothing but the
    // poster until the visitor actually taps play (saves bandwidth —
    // these are served as static files, so every byte played counts).
    // Native controls are only switched on once playback starts, so the
    // poster shows our own play button instead of each browser's own.
    card.innerHTML = `
      <div class="content-film-player">
        <video class="content-film-video" src="${video.src}" poster="${video.poster}" playsinline preload="none" aria-label="${video.title}"></video>
        <button type="button" class="content-film-play" aria-label="Play video: ${video.title}">
          <span class="content-film-play-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>
          </span>
        </button>
      </div>
      <p class="content-film-card-title content-film-card-title--caption">${video.title}</p>`;

    const el = card.querySelector('video');
    const btn = card.querySelector('.content-film-play');
    const showPoster = () => { el.controls = false; card.classList.remove('is-playing'); };
    btn.addEventListener('click', () => {
      // one at a time — also stops a second clip downloading in parallel
      players.forEach((p) => { if(p !== el) p.pause(); });
      el.controls = true;
      card.classList.add('is-playing');
      el.play().catch(showPoster);
    });
    el.addEventListener('ended', () => { el.currentTime = 0; showPoster(); });
    players.push(el);
    return card;
  }

  function buildPlaceholderCard(slot){
    const card = document.createElement('div');
    card.className = 'content-film-card content-film-card--placeholder';
    card.innerHTML = `
      <div class="content-film-placeholder-frame" aria-hidden="true">
        <span class="content-film-placeholder-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M10 8.5v7l6-3.5-6-3.5z" fill="currentColor" stroke="none"/></svg>
        </span>
        <span class="content-film-placeholder-tag">Coming soon</span>
      </div>
      <p class="content-film-card-title">${slot.label}</p>
      <p class="content-film-card-text">${slot.text}</p>`;
    return card;
  }

  // real videos fill the first slots; placeholders make up the rest,
  // so the grid always shows 3 cards regardless of how many real clips
  // exist yet
  const frag = document.createDocumentFragment();
  for(let i = 0; i < 3; i++){
    if(VIDEOS[i]) frag.appendChild(buildVideoCard(VIDEOS[i]));
    else frag.appendChild(buildPlaceholderCard(PLACEHOLDER_SLOTS[i % PLACEHOLDER_SLOTS.length]));
  }
  grid.appendChild(frag);

  // pause a clip the moment it's scrolled mostly out of view — same
  // convention as js/live-demo.js's embeds, so nothing keeps
  // playing/streaming behind the visitor's back
  if('IntersectionObserver' in window){
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => { if(!en.isIntersecting && !en.target.paused) en.target.pause(); });
    }, { threshold: 0.2 });
    players.forEach((p) => io.observe(p));
  }
})();
