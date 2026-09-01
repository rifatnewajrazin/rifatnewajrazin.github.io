/* Rifat Newaj Razin — animated redesign prototype
   GSAP + ScrollTrigger + Lenis. Degrades gracefully if any fail. */
(function () {
  var root = document.documentElement;
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var haveGSAP = !!(window.gsap && window.ScrollTrigger);

  // never let the browser restore a previous scroll position on reload
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  window.scrollTo(0, 0);

  /* ---------- page transitions (cross-page nav; independent of GSAP) ----------
     Exit: an intercepted click on an internal link covers the viewport in ink,
     then navigates. Entry: if the page we're arriving at was reached that way
     (a sessionStorage flag set right before navigating), the overlay — already
     painted "covering" by the inline script in <body>, so there is no flash —
     lifts away to reveal the page. Everything here runs off plain CSS
     transitions and rAF, never GSAP, so it can never be left half-finished by
     a library that failed to load. */
  var NAV_KEY = 'rnr-nav';
  function navFlagGet() { try { return sessionStorage.getItem(NAV_KEY); } catch (e) { return null; } }
  function navFlagSet(v) { try { v === null ? sessionStorage.removeItem(NAV_KEY) : sessionStorage.setItem(NAV_KEY, v); } catch (e) {} }

  (function pageTransitions() {
    var overlay = document.getElementById('pageTransition');
    var flag = navFlagGet();
    var incoming = !reduce && !!overlay && flag === '1';
    if (flag !== null) navFlagSet(null); // consume at most once
    window.__rnrIncomingNav = incoming;

    if (incoming) {
      // force the browser to commit the "covering" frame the inline head
      // script already set, THEN animate away from it — otherwise the style
      // change below can get coalesced into the same frame and never
      // visibly transition.
      void overlay.offsetHeight;
      var lifted = false;
      function lift() { if (lifted) return; lifted = true; overlay.style.transform = 'translateY(-100%)'; }
      requestAnimationFrame(function () { requestAnimationFrame(lift); });
      // failsafe: rAF can be throttled or suspended (e.g. a backgrounded tab)
      // — the overlay must never be left stuck covering the page.
      setTimeout(lift, 80);
    }

    // a page restored from bfcache (browser back/forward) can carry whatever
    // transform was left on it — always resolve back to fully hidden.
    window.addEventListener('pageshow', function (e) {
      if (e.persisted && overlay) overlay.style.transform = 'translateY(-100%)';
    });

    if (!overlay || reduce) return;

    document.addEventListener('click', function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target.closest && e.target.closest('a[href]');
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      var href = a.getAttribute('href');
      if (!href || href.indexOf('mailto:') === 0 || href.indexOf('tel:') === 0) return;
      var url;
      try { url = new URL(href, location.href); } catch (err) { return; }
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.hash) return; // in-page anchor — Lenis handles it

      e.preventDefault();
      navFlagSet('1');
      if (window.__lenis) window.__lenis.stop();
      overlay.style.transform = 'translateY(0)';
      var gone = false;
      function go() { if (gone) return; gone = true; location.href = url.href; }
      overlay.addEventListener('transitionend', go, { once: true });
      setTimeout(go, 700); // failsafe: never let a stalled transition block navigation
    });
  })();

  /* ---------- hero scroll effect (independent of GSAP / rAF) ----------
     A plain scroll listener writes two 0..1 progress values as CSS variables;
     all the movement is expressed in CSS. Scroll events fire reliably even
     when rAF is throttled, so the hero can never be left mid-animation. */
  (function heroScrollEffect() {
    var hero = document.querySelector('.hero');
    if (!hero) return;
    var ticking = false;

    function apply() {
      ticking = false;
      var h = hero.offsetHeight || window.innerHeight;
      var p = Math.min(1, Math.max(0, window.scrollY / h));      // 0..1 over the hero
      var pf = Math.min(1, p / 0.18);                            // labels leave early
      hero.style.setProperty('--hp', p.toFixed(4));
      hero.style.setProperty('--hpf', pf.toFixed(4));
    }
    function onScroll() {
      if (ticking) return;
      ticking = true;
      // rAF when available (smoothest), timeout as a guaranteed fallback
      if (window.requestAnimationFrame) requestAnimationFrame(apply);
      else setTimeout(apply, 16);
      setTimeout(function () { if (ticking) apply(); }, 120);
    }
    apply();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', apply);
  })();

  /* ---------- content reveal (independent of GSAP / rAF) ----------
     CSS handles the transition; IntersectionObserver just toggles a class.
     Runs even if the animation libraries never load, so content can never be
     left invisible. */
  (function revealObserver() {
    var root = document.documentElement;
    root.classList.add('js-ready');

    var items = [].slice.call(document.querySelectorAll('[data-anim]'));
    if (!items.length) return;

    function revealAll() { root.classList.add('reveal-all'); }

    if (!('IntersectionObserver' in window)) { revealAll(); return; }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -8% 0px' });

    items.forEach(function (el) { io.observe(el); });

    // hard fallback: whatever happens, nothing stays hidden past 5s
    setTimeout(revealAll, 5000);
  })();

  /* ---------- nav dark-section invert (independent of GSAP) ----------
     Swaps the nav to a light-on-dark "negative" look while it's actually
     sitting over a dark section (currently just .statement), using an
     IntersectionObserver against a thin strip at the nav's own screen
     position — so it reflects whatever is truly behind it. Replaces the old
     mix-blend-mode:multiply trick, which crushed to black-on-black over a
     dark band and made the nav unreadable rather than legible-in-negative. */
  (function navInvert() {
    var nav = document.getElementById('nav');
    var darkSections = document.querySelectorAll('.statement');
    if (!nav || !darkSections.length || !('IntersectionObserver' in window)) return;

    var io;
    function build() {
      if (io) io.disconnect();
      var navH = nav.offsetHeight || 70;
      var bottom = Math.max(0, Math.round(window.innerHeight - navH));
      io = new IntersectionObserver(function (entries) {
        var onDark = entries.some(function (e) { return e.isIntersecting; });
        nav.classList.toggle('on-dark', onDark);
      }, { rootMargin: '0px 0px -' + bottom + 'px 0px', threshold: 0 });
      darkSections.forEach(function (el) { io.observe(el); });
    }
    build();
    var rt;
    window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(build, 200); });
  })();

  /* ---------- work grid (data-driven; independent of GSAP) ----------
     Renders project cards from data/work.json, which is exactly what the
     CMS at /redesign/admin edits — so uploading images/text there updates
     this grid (and the case-study page) with no code changes. The static
     cards already in the HTML are the no-JS/fetch-failure fallback and are
     only replaced once real data has loaded successfully. */
  (function renderWorkGrid() {
    var grid = document.querySelector('.work-grid');
    if (!grid) return;

    function esc(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }

    fetch('./data/work.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        var items = data && data.items;
        if (!items || !items.length) return; // keep the static fallback cards
        grid.innerHTML = '';
        items.forEach(function (item, i) {
          var a = document.createElement('a');
          a.className = 'work-cell';
          a.href = './work/case.html?slug=' + encodeURIComponent(item.slug || '');
          a.style.transitionDelay = (i * 0.06).toFixed(2) + 's'; // stagger, replaces the old fixed nth-child list
          a.innerHTML =
            '<span class="wc-year">' + esc(item.year) + '</span>' +
            '<span class="wc-title">' + esc(item.title) + '</span>' +
            '<span class="wc-cat">' + esc(item.category) + '</span>';
          grid.appendChild(a);
        });
        // the fallback copy ("Placeholder — real projects to come") is
        // stale the moment real data loads — swap it for an accurate count.
        var count = document.querySelector('.work-head .count');
        if (count) count.textContent = items.length + (items.length === 1 ? ' project' : ' projects');
      })
      .catch(function () { /* keep the static fallback cards */ });
  })();

  if (!haveGSAP || reduce) {
    document.body.classList.add('intro-done');
    showEverything();
    wirePlainAnchors();
    fitHeroPlain();
    return;
  }

  function fitHeroPlain() {
    var name = document.querySelector('.hero-name');
    if (!name) return;
    var run = function () {
      var lines = [].slice.call(name.querySelectorAll('.line'));
      if (!lines.length) return;
      var hero = name.closest('.hero') || name.parentElement;
      var hcs = getComputedStyle(hero);
      var full = hero.clientWidth - parseFloat(hcs.paddingLeft || 0) - parseFloat(hcs.paddingRight || 0);
      var avail = full;
      if (window.innerWidth > 820) {
        var fl = document.querySelector('.flank-l'), fr = document.querySelector('.flank-r');
        if (fl && fr && fl.offsetParent) {
          var fp = fl.offsetParent.getBoundingClientRect().left;
          var c = document.documentElement.clientWidth / 2;
          var inner = 2 * (Math.min(c - (fp + fl.offsetLeft + fl.offsetWidth),
                                    (fp + fr.offsetLeft) - c) - 40);
          if (inner > 120) avail = Math.min(full, inner);
        }
      }
      if (!(avail > 0)) return;
      var target = avail * 0.98;
      var cap = Math.max(48, (hero.clientHeight || innerHeight) * 0.34);
      lines.forEach(function (l) { l.style.fontSize = ''; });
      for (var p = 0; p < 6; p++) {
        var worst = 0;
        lines.forEach(function (l) {
          var w = l.getBoundingClientRect().width;
          if (!(w > 0)) return;
          var fs = parseFloat(getComputedStyle(l).fontSize);
          l.style.fontSize = Math.min(cap, fs * target / w).toFixed(3) + 'px';
          worst = Math.max(worst, Math.abs(w - target));
        });
        if (worst < 1) break;
      }
    };
    run();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(run);
    window.addEventListener('resize', run);
    if (window.ResizeObserver) {
      var h = document.querySelector('.hero');
      if (h) new ResizeObserver(run).observe(h);
    }
  }

  root.classList.add('js-ready');
  gsap.registerPlugin(ScrollTrigger);

  /* ---------- split helpers ---------- */
  function splitChars(el) {
    var targets = el.querySelectorAll('.line');
    if (!targets.length) targets = [el];
    targets.forEach(function (t) {
      var txt = t.textContent, frag = document.createDocumentFragment();
      t.textContent = '';
      txt.split('').forEach(function (ch) {
        var s = document.createElement('span');
        s.className = 'char';
        s.textContent = ch === ' ' ? ' ' : ch;
        frag.appendChild(s);
      });
      t.appendChild(frag);
    });
    return el.querySelectorAll('.char');
  }
  function splitWords(el) {
    var txt = el.textContent.trim().replace(/\s+/g, ' ');
    var frag = document.createDocumentFragment();
    el.textContent = '';
    txt.split(' ').forEach(function (w) {
      var s = document.createElement('span');
      s.className = 'word';
      s.textContent = w;
      frag.appendChild(s);
    });
    el.appendChild(frag);
    return el.querySelectorAll('.word');
  }
  document.querySelectorAll('[data-split="chars"]').forEach(splitChars);
  document.querySelectorAll('[data-split="words"]').forEach(splitWords);

  /* ---------- fit hero lines to one shared width ----------
     Every line is scaled to span the SAME target width — the space actually
     available in the hero — so the two lines read as one justified block.
     (Matching the narrowest line instead made the name tiny on small screens.) */
  var FLANK_BREAKPOINT = 820;   // below this the labels stack under the name

  /* Ceiling for the fitted font size. A short line like "RAZIN" needs a much
     larger size than "RIFAT NEWAJ" to span the same width, so a fixed cap
     would stop it matching. Derive the cap from the hero's height instead, so
     the two-line block always stays comfortably inside the viewport. */
  function fitMaxFontSize() {
    var hero = document.querySelector('.hero');
    var h = (hero ? hero.clientHeight : window.innerHeight) || window.innerHeight;
    return Math.max(48, h * 0.34);
  }

  /* Give both hero labels the same box width so their inner edges mirror each
     other about the page centre — otherwise the longer label eats into one
     side and the clearance around the name is visibly uneven. */
  function equaliseFlanks() {
    var fl = document.querySelector('.flank-l');
    var fr = document.querySelector('.flank-r');
    if (!fl || !fr) return;
    fl.style.width = ''; fr.style.width = '';
    if (window.innerWidth <= FLANK_BREAKPOINT) return;   // stacked on mobile
    // offsetWidth is layout-based: unaffected by the scroll-driven translate
    var w = Math.max(fl.offsetWidth, fr.offsetWidth);
    if (w > 0) { fl.style.width = w + 'px'; fr.style.width = w + 'px'; }
  }

  function heroAvailableWidth() {
    var hero = document.querySelector('.hero');
    var hcs = getComputedStyle(hero);
    var full = hero.clientWidth
      - parseFloat(hcs.paddingLeft || 0)
      - parseFloat(hcs.paddingRight || 0);

    // Below the breakpoint the labels sit under the name, so it may use the
    // whole width. Above it, the name must fit BETWEEN the two labels.
    if (window.innerWidth <= FLANK_BREAKPOINT) return full;

    var fl = document.querySelector('.flank-l');
    var fr = document.querySelector('.flank-r');
    if (!fl || !fr) return full;

    // IMPORTANT: measure the labels' LAYOUT positions (offsetLeft/offsetWidth),
    // not getBoundingClientRect. The scroll effect translates the labels off to
    // the sides, so a rect read while scrolled would report a huge phantom gap
    // and the name would be sized enormously (e.g. landing on #work directly).
    var flank = fl.offsetParent || fr.offsetParent;
    if (!flank) return full;
    var flankLeft = flank.getBoundingClientRect().left;
    var lRight = flankLeft + fl.offsetLeft + fl.offsetWidth;
    var rLeft  = flankLeft + fr.offsetLeft;

    // The two labels have different text widths, so their inner edges are not
    // symmetric about the page centre. Size the name from the SMALLER of the
    // two half-gaps, so the clearance left and right is always equal.
    var gap = 40;                                   // breathing room per side
    var centre = document.documentElement.clientWidth / 2;
    var inner = 2 * (Math.min(centre - lRight, rLeft - centre) - gap);
    return (inner > 120) ? Math.min(full, inner) : full;
  }

  function fitHero() {
    var name = document.querySelector('.hero-name');
    if (!name) return;
    var lines = [].slice.call(name.querySelectorAll('.line'));
    if (!lines.length) return;

    equaliseFlanks();
    var avail = heroAvailableWidth();
    if (!(avail > 0)) return;

    var target = avail * 0.98;
    var maxFs = fitMaxFontSize();

    // Iterate until every line is within 1px of the target. One or two passes
    // leave a visible mismatch because letter-spacing and font metrics do not
    // scale perfectly linearly with font-size.
    lines.forEach(function (l) { l.style.fontSize = ''; });
    for (var pass = 0; pass < 6; pass++) {
      var worst = 0;
      lines.forEach(function (l) {
        var w = l.getBoundingClientRect().width;
        if (!(w > 0)) return;
        var fs = parseFloat(getComputedStyle(l).fontSize);
        var next = Math.min(maxFs, fs * target / w);
        l.style.fontSize = next.toFixed(3) + 'px';
        worst = Math.max(worst, Math.abs(w - target));
      });
      if (worst < 1) break;
    }
  }
  fitHero();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitHero);
  var fitRT;
  function scheduleFit() { clearTimeout(fitRT); fitRT = setTimeout(fitHero, 120); }
  window.addEventListener('resize', scheduleFit);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', scheduleFit);
  // ResizeObserver catches layout changes that never fire a window resize
  // (device emulation, zoom, scrollbar appearing, container reflow)
  if (window.ResizeObserver) {
    var hero = document.querySelector('.hero');
    if (hero) new ResizeObserver(scheduleFit).observe(hero);
  }

  /* ---------- Lenis smooth scroll ---------- */
  var lenis = new Lenis({ duration: 1.15, smoothWheel: true, wheelMultiplier: 0.9 });
  window.__lenis = lenis;            // handle for QC / debugging
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add(function (t) { lenis.raf(t * 1000); });
  gsap.ticker.lagSmoothing(0);

  document.querySelectorAll('a[href^="#"]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      var id = a.getAttribute('href');
      e.preventDefault();
      if (id === '#' || id === '#top') { lenis.scrollTo(0); return; }
      var t = document.querySelector(id);
      if (t) lenis.scrollTo(t, { offset: 0 });
    });
  });

  /* ---------- INTRO ---------- */
  // Only a cold/direct load of the homepage gets the full "RNR." panel-lift
  // reveal. Pages without the intro panel, and any page reached via an
  // internal link (the page-transition overlay already handled the reveal —
  // see pageTransitions() above), skip straight to starting the site.
  if (!document.getElementById('intro') || window.__rnrIncomingNav) {
    document.body.classList.add('intro-done');
    startSite();
    return;
  }

  lenis.stop();

  // homepage starts soft-focused; it "settles" into focus as the panel lifts.
  // NOTE: no y-offset here — translating <main> reads as a scroll jump.
  gsap.set('main, .foot', { filter: 'blur(16px)', autoAlpha: 0.35 });
  gsap.set('.intro-mark', { opacity: 0, y: 10 });

  // Wait for webfonts before showing anything — otherwise "RNR." paints in the
  // fallback face and visibly re-renders when Unica One arrives (FOUT).
  var fontsReady = (document.fonts && document.fonts.ready)
    ? Promise.race([document.fonts.ready, new Promise(function (r) { setTimeout(r, 2500); })])
    : Promise.resolve();

  // Finishing the intro is idempotent and can be triggered either by the
  // timeline completing or by the independent failsafe timer below.
  var introFinished = false;
  function finishIntro() {
    if (introFinished) return;
    introFinished = true;
    document.body.classList.add('intro-done');
    // drop only the filter (a lingering blur filter creates a containing block);
    // never clear transform here — that is what produced the snap.
    gsap.set('main, .foot', { autoAlpha: 1, clearProps: 'filter' });
    lenis.start();
    startSite();
  }

  /* FAILSAFE — registered NOW, not inside the timeline's onComplete.
     If rAF is throttled the timeline never completes, and a rescue that lived
     inside onComplete could never run: the page would stay blurred forever. */
  setTimeout(finishIntro, 4200);

  fontsReady.then(function () {
    fitHero();                       // measure with the real font metrics
    if (introFinished) return;       // failsafe already took over
    gsap.timeline({ onComplete: finishIntro, defaults: { ease: 'power2.inOut' } })
      .to('.intro-mark', { opacity: 1, y: 0, duration: 0.5 })
      .to({}, { duration: 0.7 })
      .to('.intro-mark', { opacity: 0, duration: 0.35 }, 'reveal')
      // panel rises slowly out of frame
      .to('#intro', { yPercent: -100, duration: 1.25, ease: 'expo.inOut' }, 'reveal')
      // …and the homepage focuses in, a touch behind the panel
      .to('main, .foot', { filter: 'blur(0px)', autoAlpha: 1, duration: 1.1, ease: 'power3.out' }, 'reveal+=0.25');
  });

  /* ---------- hero reveal ---------- */
  function startSite() {
    fitHero();
    // name + flank labels are simply present — the panel lift IS the reveal.
    // (separate entrance tweens on these are what kept flickering)
    // Guarded: pages without a hero (the work/case-study template) don't
    // carry these elements, and gsap.set on an empty selector just warns.
    if (document.querySelector('.hero-name')) gsap.set('.hero-name', { opacity: 1, clearProps: 'transform' });
    if (document.querySelector('.hero-flank')) gsap.set('.hero-flank, .hero-flank span', { opacity: 1, clearProps: 'transform' });
    buildScroll();
    startSafetyNet();
  }

  /* ---------- safety net ----------
     If rAF is throttled (backgrounded tab) GSAP tweens can stall. Timers still
     run, so force the intro's final state regardless. Content reveal itself is
     handled by CSS + IntersectionObserver (see revealObserver), never by GSAP. */
  function startSafetyNet() {
    // intro rescue now lives at the intro itself (see finishIntro failsafe);
    // this only guarantees the hero name is never left transparent.
    setTimeout(function () {
      if (document.querySelector('.hero-name')) gsap.set('.hero-name', { opacity: 1 });
    }, 500);
  }

  /* ---------- scroll-driven ---------- */
  function buildScroll() {

    // (hero drift + label retreat are driven by a plain scroll handler writing
    //  CSS variables — see heroScrollEffect. Deliberately not GSAP scrub: a
    //  stalled scrub leaves the name displaced and the labels invisible.)

    // (content reveal is CSS + IntersectionObserver — see revealObserver below)

    // Headings outside the hero use the CSS reveal (their wrapper carries
    // [data-anim]). No per-character tween: a stalled one would leave the
    // letters displaced, and there is no overflow mask to hide that.

    // statement: words go grey -> light as you scroll through the dark band
    var stWords = document.querySelectorAll('.statement-text .word');
    if (stWords.length) {
      gsap.to(stWords, {
        color: '#f4f1e9', ease: 'none', stagger: { each: 0.4 },
        scrollTrigger: { trigger: '.statement', start: 'top 72%', end: 'bottom 62%', scrub: true }
      });
    }

    // about lead: words fade in on scrub
    var abWords = document.querySelectorAll('.about-lead .word');
    if (abWords.length) {
      gsap.set(abWords, { opacity: 0.25 });
      gsap.to(abWords, {
        opacity: 1, ease: 'none', stagger: { each: 0.14 },
        scrollTrigger: { trigger: '.about-lead', start: 'top 80%', end: 'bottom 72%', scrub: true }
      });
    }

    // (marquee is CSS-driven — see the inline builder in index.html)

    // (work cells reveal via the CSS/IntersectionObserver path — no GSAP tween
    //  here, because an inline opacity:0 from a stalled tween would hide them)

    // stat count-up
    document.querySelectorAll('[data-count]').forEach(function (el) {
      var end = +el.dataset.count, suf = el.dataset.suffix || '', o = { v: 0 };
      ScrollTrigger.create({
        trigger: el, start: 'top 88%', once: true,
        onEnter: function () {
          gsap.to(o, { v: end, duration: 1.4, ease: 'power2.out',
            onUpdate: function () { el.textContent = Math.round(o.v) + suf; } });
        }
      });
    });

    // nav hide on scroll-down — deliberate, not jumpy: requires a sustained
    // scroll of THRESHOLD px in one direction before it reacts, so a small
    // wheel/trackpad wobble can't flicker it in and out. Direction reverses
    // reset the accumulator immediately.
    (function () {
      var nav = document.getElementById('nav');
      if (!nav) return;
      var HIDE_AT = 140;   // never hide this close to the top
      var THRESHOLD = 28;  // ignore scroll smaller than this
      var lastY = window.scrollY || 0;
      var accum = 0;
      var navHidden = false;
      function setHidden(v) {
        if (v === navHidden) return;
        navHidden = v;
        gsap.to(nav, { yPercent: v ? -140 : 0, duration: 0.35 });
      }
      ScrollTrigger.create({
        start: 0, end: 'max',
        onUpdate: function (self) {
          var y = self.scroll();
          var dy = y - lastY;
          lastY = y;
          if (dy !== 0 && Math.sign(dy) !== Math.sign(accum)) accum = 0;
          accum += dy;
          if (y <= HIDE_AT) { setHidden(false); accum = 0; }
          else if (accum > THRESHOLD) { setHidden(true); accum = 0; }
          else if (accum < -THRESHOLD) { setHidden(false); accum = 0; }
        }
      });
    })();

    ScrollTrigger.refresh();
  }

  /* ---------- magnetic buttons ---------- */
  document.querySelectorAll('.magnetic').forEach(function (el) {
    el.addEventListener('pointermove', function (e) {
      var r = el.getBoundingClientRect();
      gsap.to(el, {
        x: (e.clientX - r.left - r.width / 2) * 0.3,
        y: (e.clientY - r.top - r.height / 2) * 0.3,
        duration: 0.4, ease: 'power3.out'
      });
    });
    el.addEventListener('pointerleave', function () {
      gsap.to(el, { x: 0, y: 0, duration: 0.6, ease: 'elastic.out(1,0.4)' });
    });
  });

  /* ---------- fallbacks ---------- */
  function showEverything() {
    document.querySelectorAll('[data-anim]').forEach(function (el) { el.style.opacity = 1; });
    document.querySelectorAll('.statement-text .word').forEach(function (w) { w.style.color = '#f4f1e9'; });
  }
  function wirePlainAnchors() {
    document.querySelectorAll('a[href^="#"]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        var id = a.getAttribute('href');
        if (id === '#' || id === '#top') { e.preventDefault(); window.scrollTo({ top: 0 }); return; }
        var t = document.querySelector(id);
        if (t) { e.preventDefault(); t.scrollIntoView(); }
      });
    });
  }
})();
