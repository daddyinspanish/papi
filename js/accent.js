/* ===================================================================
   Papi — shared palette
   The brand is black and gold — full stop. particles.js sweeps
   between just these two as one solid background color at a time and
   writes the live --accent CSS variable, so the headline gradient and
   CTA hover stay in sync with whatever the field currently shows.
   (This used to be a ten-color jewel-tone set; narrowed to the brand
   pair so nothing off-brand ever shows up in the hero field.)
=================================================================== */
(function(){
  const palette = [
    [255,200,40], // gold
    [ 10,  9,  8], // near-black
  ];

  window.Papi = window.Papi || {};
  window.Papi.palette = palette;
})();
