/* ===================================================================
   Papi — logo marquee
   A seamlessly-looping horizontal row of companies Papi has worked
   with. Per direct request, logos are curated and added by hand later
   rather than auto-populated here — this file just needs each one
   added to the LOGOS array below, as {name, src}. Leave LOGOS empty
   and the whole section hides itself (no empty-looking gap on the
   page) until the first real logo is added.

   HOW TO ADD A LOGO:
   1. Put the image file somewhere under img/ (e.g. img/logos/acme.png).
   2. Add one line to LOGOS below:
        { name: 'Acme Co.', src: 'img/logos/acme.png' },
   3. That's it — list each logo ONCE; this file duplicates the whole
      row itself to make the loop seamless, so adding it twice here
      would make it loop twice as fast as intended.

   The track is built once, then duplicated exactly once (so the CSS
   animation can scroll a full -50% and land back on an identical
   copy, the same seamless-loop technique used elsewhere on this site
   for looping marquees) — see css/style.css's own .logo-marquee-track
   comment for the animation itself.
=================================================================== */
(function(){
  // Source files live in ~/Desktop/Papi Website logos; these are the same
  // artwork cropped tight to the visible logo (so each fits its uniform
  // display box the same way) and saved as transparent WebP.
  const LOGOS = [
    { name: '4M Dental Implant Center', src: 'img/logos/4m-dental-implant-center.webp?v=1' },
    { name: 'Black Health Connect', src: 'img/logos/black-health-connect.webp?v=1' },
    { name: 'California Dental Group of North Anaheim', src: 'img/logos/california-dental-group.webp?v=1' },
    { name: 'Dent All by Dr. Z', src: 'img/logos/dent-all.webp?v=1' },
    { name: 'Dental Scanning Solutions', src: 'img/logos/dental-scanning-solutions.webp?v=1' },
    { name: 'Figueroa Furniture', src: 'img/logos/figueroa-furniture.webp?v=1' },
  ];

  const section = document.getElementById('logoMarqueeSection');
  const track = document.getElementById('logoMarqueeTrack');
  if(!section || !track) return;
  if(!LOGOS.length){ section.style.display = 'none'; return; }

  function buildRow(){
    const row = document.createDocumentFragment();
    LOGOS.forEach(logo=>{
      const item = document.createElement('div');
      item.className = 'logo-marquee-item';
      const img = document.createElement('img');
      img.src = logo.src;
      img.alt = logo.name;
      img.loading = 'lazy';
      item.appendChild(img);
      row.appendChild(item);
    });
    return row;
  }

  // built twice (not once + a CSS-duplicated ::after, since that can't
  // hold <img> elements) so a -50% translateX loop always lands on an
  // identical second copy, reading as endless rather than resetting
  track.appendChild(buildRow());
  track.appendChild(buildRow());

  // same off-screen-pause convention as the rest of the site's
  // continuous CSS animations (see js/anim-idle.js) — this section
  // isn't in that file's generic GROUPS list since it doesn't exist
  // until logos are actually added, but the mechanism is identical:
  // .is-anim-idle + !important, toggled by one IntersectionObserver.
  if('IntersectionObserver' in window){
    const io = new IntersectionObserver((entries)=>{
      track.classList.toggle('is-anim-idle', !entries[0].isIntersecting);
    }, { threshold: 0 });
    io.observe(section);
  }
})();
