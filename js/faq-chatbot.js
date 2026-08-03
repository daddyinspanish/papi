/* ===================================================================
   Papi — FAQ chatbot
   Per direct request: "Add a FAQ chatbot, where someone might ask the
   most asked questions, and my bot answers them." A fully client-side,
   rule-based matcher — this is a static site with no backend, so
   there's no server/API to wire a "real" AI chatbot up to. The
   knowledge base below is sourced verbatim from the same 5 real Q&A
   pairs already in the FAQ accordion (index.html's #faqList), not
   invented, plus one safe pricing answer that redirects to the real
   quote flow instead of stating a fabricated number — this site is
   deliberately quote-based, not fixed-pricing. Keep these two in sync
   if the FAQ accordion's own copy ever changes.

   Matching is a simple keyword-overlap score against each entry's own
   question+answer text — no NLP library or network call needed for a
   knowledge base this small and fixed.
=================================================================== */
(function(){
  const bot = document.getElementById('faqBot');
  const launcher = document.getElementById('faqBotLauncher');
  const panel = document.querySelector('.faq-bot-panel');
  const closeBtn = document.getElementById('faqBotClose');
  const log = document.getElementById('faqBotLog');
  const suggestions = document.getElementById('faqBotSuggestions');
  const form = document.getElementById('faqBotForm');
  const input = document.getElementById('faqBotInput');
  if(!bot || !launcher || !log || !form || !input) return;

  const KNOWLEDGE = [
    {
      q: 'How long does it take to build my website?',
      a: "Depending on the final plan, a Papi website is completed within 3–5 business days once it's approved.",
    },
    {
      q: 'Do I need to provide the content and photos?',
      a: "We'll send you a brand kit with a few simple questions about your business and brand, plus instructions for submitting your own photos or videos if you have them.",
    },
    {
      q: "Can I make updates myself after it's built?",
      a: "Our websites are a hands-off experience — once it's designed, any updates or changes are handled by Papi, available through a monthly maintenance plan.",
    },
    {
      q: "What if I don't like the design?",
      a: "Revisions are part of the process, not an extra cost — we refine the design with you until it actually feels right before anything goes live.",
    },
    {
      q: 'Do you offer ongoing support after launch?',
      a: 'Yes — hosting, updates, and support plans are available so your site keeps running smoothly long after it goes live.',
    },
    {
      q: 'How much does a website cost?',
      a: "Pricing depends on your project's scope, so we don't quote a flat number here — the fastest way to get an exact price is the free quote form further down this page (or the Book a Call tab right beside it).",
      keywords: ['price', 'cost', 'pricing', 'much', 'expensive', 'cheap', 'budget', 'fee', 'charge'],
    },
  ];

  const STOPWORDS = new Set(['a','an','the','is','are','do','does','did','i','my','you','your','it','to','of','for','and','or','on','in','at','with','can','what','how','if','after','before','me','we','our','will','would']);

  function tokenize(str){
    return (str.toLowerCase().match(/[a-z']+/g) || []).filter((w) => w.length > 1 && !STOPWORDS.has(w));
  }

  // pre-tokenized once, up front, rather than re-splitting every entry
  // on every message typed
  const ENTRIES = KNOWLEDGE.map((entry) => ({
    q: entry.q,
    a: entry.a,
    tokens: new Set(tokenize(entry.q + ' ' + entry.a + ' ' + (entry.keywords || []).join(' '))),
  }));

  function findAnswer(message){
    const words = tokenize(message);
    if(!words.length) return null;
    let best = null;
    let bestScore = 0;
    ENTRIES.forEach((entry) => {
      let score = 0;
      words.forEach((w) => { if(entry.tokens.has(w)) score++; });
      if(score > bestScore){ bestScore = score; best = entry; }
    });
    // require at least one real overlapping word, so stopword-only
    // input ("what is it") doesn't spuriously "match" the first entry
    return bestScore > 0 ? best : null;
  }

  function addMessage(text, who){
    const bubble = document.createElement('div');
    bubble.className = 'faq-bot-msg faq-bot-msg--' + who;
    bubble.textContent = text;
    log.appendChild(bubble);
    log.scrollTop = log.scrollHeight;
  }

  const FALLBACK = "I don't have an answer for that one yet — the quote form further down this page (or the Book a Call tab beside it) is the fastest way to ask a real person directly.";

  function respond(message){
    addMessage(message, 'user');
    const match = findAnswer(message);
    // a short fixed delay reads as "typing" without needing a real
    // typing-indicator UI for a knowledge base this small
    setTimeout(() => addMessage(match ? match.a : FALLBACK, 'bot'), 350);
  }

  function renderSuggestions(){
    suggestions.innerHTML = '';
    KNOWLEDGE.forEach((entry) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'faq-bot-chip';
      chip.textContent = entry.q;
      chip.addEventListener('click', () => respond(entry.q));
      suggestions.appendChild(chip);
    });
  }

  let greeted = false;
  function open(){
    bot.classList.add('is-open');
    bot.setAttribute('aria-hidden', 'false');
    if(!greeted){
      greeted = true;
      addMessage("Hi! I'm Papi's assistant — ask me anything, or tap a question below.", 'bot');
      renderSuggestions();
    }
    input.focus();
  }
  function close(){
    bot.classList.remove('is-open');
    bot.setAttribute('aria-hidden', 'true');
  }

  launcher.addEventListener('click', () => {
    if(bot.classList.contains('is-open')) close(); else open();
  });
  if(closeBtn) closeBtn.addEventListener('click', close);
  window.addEventListener('keydown', (e) => {
    if(e.key === 'Escape' && bot.classList.contains('is-open')) close();
  });
  // click-outside-to-close, ignoring clicks on the launcher itself so
  // the same click that opens it isn't immediately treated as "outside"
  document.addEventListener('click', (e) => {
    if(!bot.classList.contains('is-open')) return;
    if(panel && panel.contains(e.target)) return;
    if(launcher.contains(e.target)) return;
    close();
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const message = input.value.trim();
    if(!message) return;
    input.value = '';
    respond(message);
  });
})();
