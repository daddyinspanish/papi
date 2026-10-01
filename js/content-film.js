/* ===================================================================
   Papi — Content & Film
   Per direct request: a service section for content strategy + video
   production, scoped to dental practices specifically (per direct
   request, not the general multi-industry pitch the rest of the page
   makes). VIDEOS below is empty until real client-work footage exists
   — unlike js/logo-marquee.js's empty-array convention (which hides
   its whole section), this section was explicitly asked to be visible
   now, so an empty VIDEOS array renders clearly-labeled placeholder
   slots instead of real players.

   HOW TO ADD A REAL VIDEO:
   1. Put the file somewhere under videos/ (e.g. videos/content/
      patient-testimonial.mp4), plus an optional poster image under img/.
   2. Add one entry to VIDEOS below:
        { title: 'Patient Testimonial', src: 'videos/content/patient-testimonial.mp4', poster: 'img/content/patient-testimonial.jpg' },
   3. That's it — real entries render an actual <video>, remaining
      placeholder slots (if VIDEOS has fewer than 3) keep showing as
      "coming soon" so the grid never looks sparsely populated.
=================================================================== */
(function(){
  const grid = document.getElementById('contentFilmGrid');
  if(!grid) return;

  const VIDEOS = [
    // { title: 'Patient Testimonial', src: 'videos/content/example.mp4', poster: 'img/content/example.jpg' },
  ];

  // placeholder categories — the kinds of dental-practice content this
  // service actually covers, shown until real footage fills these
  // slots in. Not real client work; labeled clearly as such.
  const PLACEHOLDER_SLOTS = [
    { label: 'Patient Testimonials', text: 'Real patients, on camera, explaining why they chose your practice.' },
    { label: 'Treatment Explainers', text: 'Short, clear videos that make procedures feel less intimidating before someone ever calls.' },
    { label: 'Behind the Scenes', text: 'Your team, your office, your equipment — the footage that builds trust before the first visit.' },
  ];

  function buildVideoCard(video){
    const card = document.createElement('div');
    card.className = 'content-film-card';
    card.innerHTML = `
      <video class="content-film-video" src="${video.src}" ${video.poster ? `poster="${video.poster}"` : ''} controls playsinline preload="metadata"></video>
      <p class="content-film-card-title">${video.title}</p>`;
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
})();
