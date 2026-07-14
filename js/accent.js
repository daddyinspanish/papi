/* ===================================================================
   Papi — shared palette
   A curated set of jewel tones. particles.js sweeps through these as
   one solid background color at a time and writes the live --accent
   CSS variable, so the headline gradient and CTA hover stay in sync
   with whatever color currently fills the field.
=================================================================== */
(function(){
  const palette = [
    [201,168,105], // gold
    [168, 54, 68], // burgundy
    [ 58,140,110], // emerald
    [ 70, 98,168], // sapphire
    [198,120,140], // rose
    [140, 80,160], // plum
    [190,120, 80], // copper
    [ 60,150,150], // teal
    [100,100,200], // indigo
    [180, 70, 70], // crimson
  ];

  window.Papi = window.Papi || {};
  window.Papi.palette = palette;
})();
