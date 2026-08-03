/* ===================================================================
   Papi — FAQ chatbot
   Per direct request: "Add a FAQ chatbot, where someone might ask the
   most asked questions, and my bot answers them." A fully client-side,
   rule-based matcher — this is a static site with no backend, so
   there's no server/API to wire a "real" AI chatbot up to. The first 5
   entries below are sourced verbatim from the FAQ accordion
   (index.html's #faqList) — keep those two in sync if the accordion's
   own copy ever changes. Pricing/business-types/portfolio/getting-
   started were added next, each grounded in something already true and
   visible elsewhere on this same page (the quote form's own industry
   list, the Live Demo section, the quote/call flow) rather than a
   fabricated capability claim. The final 6 (e-commerce, SEO, domain/
   email, contract terms, redesigns, page limits) answer real business
   facts this file can't infer from the page itself — those were
   confirmed directly, in chat, before ever going live, rather than
   guessed.

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
    // grounded in the quote form's own real "Business / industry" list
    // (index.html's #qIndustry/#nIndustry <select>) rather than a
    // fabricated capability claim — those 8 options plus "Other" are
    // the actual answer to this question, not a guess
    {
      q: 'What kind of businesses do you make websites for?',
      a: "Mostly local service businesses — roofers, dentists, plumbers, electricians, real estate agents, law firms, restaurants, and fitness studios, plus anything else local (there's an \"Other\" option on the quote form for that). Take a look at the Live Demo section above for real examples.",
      keywords: ['businesses', 'business', 'industries', 'industry', 'type', 'types', 'kind', 'kinds', 'niche', 'clients', 'trades', 'trade', 'roofer', 'roofing', 'dentist', 'plumber', 'electrician', 'realtor', 'restaurant', 'gym', 'fitness'],
    },
    // grounded in the real Live Demo section already on this page
    {
      q: 'Can I see examples of your work?',
      a: 'Yes — scroll up to the Live Demo section on this page to click through real Papi-built websites.',
      keywords: ['examples', 'portfolio', 'work', 'sample', 'samples', 'see', 'previous', 'past', 'demo', 'demos', 'showcase'],
    },
    // grounded in the real quote form / Book a Call flow already on
    // this page — not a separate onboarding process
    {
      q: 'How do I get started?',
      a: "Fill out the free quote form further down this page, or use the Book a Call tab right beside it — whichever's easier, we'll take it from there.",
      keywords: ['started', 'start', 'begin', 'beginning', 'process', 'next', 'steps', 'step', 'sign', 'join'],
    },
    // the 6 entries below were confirmed directly, in chat, before
    // going live — not inferred or guessed
    {
      q: 'Do you build online stores?',
      a: "Yes — for online stores we typically build on Shopify's backend, giving you a fully manageable e-commerce platform paired with a custom Papi design.",
      keywords: ['online', 'store', 'stores', 'ecommerce', 'shop', 'shopify', 'sell', 'selling', 'products', 'cart', 'checkout'],
    },
    {
      q: 'Do you offer SEO?',
      a: 'Yes — every Papi site is built with SEO fundamentals in place from day one, and we can go further with ongoing optimization if you need it.',
      keywords: ['seo', 'search', 'google', 'ranking', 'rank', 'optimization', 'optimize', 'discoverable', 'discoverability'],
    },
    {
      q: 'Can you help with my domain and business email?',
      a: "Yes — we handle domain registration, and if you don't already have a business email, we can set that up for you too.",
      keywords: ['domain', 'domains', 'url', 'register', 'registration', 'email', 'emails', 'address'],
    },
    {
      q: 'Is there a contract, or can I cancel anytime?',
      a: "No contracts — you pay a one-time design fee to build the site, then a simple month-to-month fee for hosting and maintenance afterward, which you're free to cancel anytime.",
      keywords: ['contract', 'contracts', 'cancel', 'cancellation', 'commitment', 'lock', 'locked', 'monthly', 'month', 'term', 'terms'],
    },
    {
      q: 'Can you redesign my existing website?',
      a: "Yes — we can redesign and improve an existing website. If it's especially outdated, we'll usually recommend a complete rebuild instead, since that gets a better result than patching an old foundation.",
      keywords: ['redesign', 'existing', 'current', 'revamp', 'rebuild', 'outdated', 'old', 'refresh', 'update'],
    },
    {
      q: 'Is there a limit on how many pages my website can have?',
      a: "No — there's no limit on the number of pages your website can have.",
      keywords: ['pages', 'page', 'limit', 'many', 'multiple'],
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

  // per direct request: a plain "hey/hi/hello" shouldn't fall through to
  // the generic FALLBACK just because it doesn't share a keyword with
  // any real question — matched separately, up front, so it always gets
  // a warm, direct greeting back instead of "I don't have an answer for
  // that one yet." Anchored to the start of the message (^) so it still
  // catches "hey there" or "hi, quick question" but doesn't fire on an
  // unrelated message that merely contains "hi" mid-word.
  const GREETING_RE = /^(hey|hi|hello|hiya|howdy|yo)\b/i;
  const GREETING_REPLY = 'Hey! How can I help you today?';

  function respond(message){
    addMessage(message, 'user');
    const isGreeting = GREETING_RE.test(message.trim());
    const match = isGreeting ? null : findAnswer(message);
    const reply = isGreeting ? GREETING_REPLY : (match ? match.a : FALLBACK);
    // a short fixed delay reads as "typing" without needing a real
    // typing-indicator UI for a knowledge base this small
    setTimeout(() => addMessage(reply, 'bot'), 350);
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
