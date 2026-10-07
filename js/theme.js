/* ===================================================================
   Papi — light/dark theme
   The theme is the data-theme attribute on <html>, set before first
   paint by the inline script in index.html's <head> (saved choice, else
   the device's setting). This file wires up the toggle button, keeps
   following the device while the visitor hasn't chosen, remembers an
   explicit choice, and announces every change with a `papi:themechange`
   event so the canvas animations (hero grid, steps background, review
   streaks, demo network) can swap their colors.

   window.PapiTheme.get()      -> 'light' | 'dark'
   window.PapiTheme.cssVar(n)  -> the computed value of a CSS variable
=================================================================== */
(function(){
  const root = document.documentElement;
  const btn = document.getElementById('themeToggle');
  const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const KEY = 'papi-theme';
  const META_COLORS = { light: '#f8f6f2', dark: '#0a110f' };

  function get(){ return root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'; }
  function cssVar(name){ return getComputedStyle(root).getPropertyValue(name).trim(); }

  function syncUi(){
    const dark = get() === 'dark';
    if(btn){
      btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
      btn.setAttribute('aria-pressed', dark ? 'true' : 'false');
      btn.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if(meta) meta.setAttribute('content', META_COLORS[dark ? 'dark' : 'light']);
  }

  let fadeTimer = 0;
  function apply(theme, animate){
    if(theme === get()) { syncUi(); return; }
    if(animate){
      root.classList.add('theme-fade');
      clearTimeout(fadeTimer);
      fadeTimer = setTimeout(() => root.classList.remove('theme-fade'), 450);
    }
    root.setAttribute('data-theme', theme);
    syncUi();
    window.dispatchEvent(new CustomEvent('papi:themechange', { detail: { theme } }));
  }

  function saved(){ try{ const t = localStorage.getItem(KEY); return (t === 'dark' || t === 'light') ? t : null; }catch(e){ return null; } }

  if(btn){
    btn.addEventListener('click', () => {
      const next = get() === 'dark' ? 'light' : 'dark';
      try{ localStorage.setItem(KEY, next); }catch(e){}
      apply(next, true);
    });
  }

  // follow the device until the visitor makes their own choice
  if(mq){
    const onChange = (e) => { if(!saved()) apply(e.matches ? 'dark' : 'light', true); };
    if(mq.addEventListener) mq.addEventListener('change', onChange);
    else if(mq.addListener) mq.addListener(onChange);
  }

  window.PapiTheme = { get, cssVar };
  syncUi();
})();
