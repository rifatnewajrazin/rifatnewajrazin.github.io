/* Rifat Newaj Razin — animated redesign prototype
   GSAP + ScrollTrigger + Lenis. Degrades gracefully if any fail.

   ---------- client-side navigation ----------
   The two templates (home, case study) are swapped in-place with fetch +
   DOMParser instead of doing real page loads, and every internal link goes
   through the SAME cover -> swap -> lift transition, driven by pushState.
   The browser's own back/forward button also fires that same transition
   (via popstate), so "back" is a genuine, consistent reverse of "forward" —
   not a different, uncontrolled browser behaviour. Direct/cold loads of
   either template still work standalone (this file boots the current view
   the same way whether it was just parsed by the browser or just swapped
   in), and a failed/blocked fetch always falls back to a plain full
   navigation, so nothing here can strand the user on a dead page. */
(function () {
  var root = document.documentElement;
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var haveGSAP = !!(window.gsap && window.ScrollTrigger);

  // never let the browser restore a previous scroll position on reload
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  window.scrollTo(0, 0);

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------- route matching ----------
     Suffix-based so it works the same whether the site is hosted at the
     domain root or under /redesign/, and both locally and in production. */
  function routeKind(pathname) {
    if (/\/work\/case(\.html)?$/.test(pathname)) return 'case';
    if (/\/(index\.html)?$/.test(pathname)) return 'home';
    return null;
  }
  function detectView(doc) {
    return doc.querySelector('.case-hero') ? 'case' : 'home';
  }

  // The URL shown in the address bar (bare "/redesign/") can differ from
  // what we actually fetch: relying on a host's directory-index behaviour
  // to resolve "/redesign/" to its index.html is one more thing that can
  // vary by host/config, so fetch the explicit filename instead.
  function fetchTarget(url) {
    var path = url.pathname;
    if (routeKind(path) === 'home' && !/\/index\.html$/.test(path)) {
      path = path.replace(/\/$/, '') + '/index.html';
    }
    return url.origin + path + url.search;
  }

  /* ============================================================
     PAGE TRANSITION OVERLAY — independent of GSAP, plain CSS
     transitions + rAF, so it can never be left half-finished by a
     library that failed to load.
     ============================================================ */
  var overlay = document.getElementById('pageTransition');
  var lenis = null; // set once GSAP/Lenis boot below; router checks it defensively

  function cover() {
    return new Promise(function (resolve) {
      if (!overlay || reduce) { resolve(); return; }
      if (lenis) lenis.stop();
      overlay.style.transform = 'translateY(0)';
      var done = false;
      function go() { if (done) return; done = true; resolve(); }
      overlay.addEventListener('transitionend', go, { once: true });
      setTimeout(go, 700); // failsafe: never let a stalled transition block navigation
    });
  }
  function lift() {
    if (!overlay || reduce) return;
    void overlay.offsetHeight; // commit the "covering" frame before animating away
    var lifted = false;
    function go() { if (lifted) return; lifted = true; overlay.style.transform = 'translateY(-100%)'; }
    requestAnimationFrame(function () { requestAnimationFrame(go); });
    setTimeout(go, 80); // failsafe: rAF can be throttled/suspended (backgrounded tab)
  }

  /* ============================================================
     ROUTER — fetch + swap <main>, instead of a real navigation.
     ============================================================ */
  var routing = false;

  function swapMainTo(doc) {
    var newMain = doc.querySelector('main');
    if (!newMain) throw new Error('fetched document has no <main>');
    // must read BEFORE replaceWith: it MOVES newMain out of doc (not a
    // copy), so detecting the view from doc afterwards always finds nothing.
    var view = detectView(doc);
    if (window.ScrollTrigger) ScrollTrigger.getAll().forEach(function (st) { st.kill(); });
    root.classList.remove('reveal-all');
    document.title = doc.title;
    document.querySelector('main').replaceWith(newMain);
    window.scrollTo(0, 0);
    if (lenis) lenis.scrollTo(0, { immediate: true });
    return view;
  }

  function goTo(url, push) {
    if (routing) return;
    routing = true;
    cover().then(function () {
      return fetch(fetchTarget(url), { cache: 'no-store' });
    }).then(function (r) {
      if (!r.ok) throw new Error('bad response ' + r.status);
      return r.text();
    }).then(function (html) {
      var doc = new DOMParser().parseFromString(html, 'text/html');
      var view = swapMainTo(doc);
      if (push) history.pushState({ rnrSpa: true }, '', url.href);
      initView(view, url);
      lift();
      routing = false;
    }).catch(function () {
      // fetch/parse failed for some reason — a real navigation always works
      location.href = url.href;
    });
  }

  (function wireRouterLinks() {
    document.addEventListener('click', function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target.closest && e.target.closest('a[href]');
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      var href = a.getAttribute('href');
      if (!href || href.indexOf('mailto:') === 0 || href.indexOf('tel:') === 0) return;
      var url;
      try { url = new URL(href, location.href); } catch (err) { return; }
      if (url.origin !== location.origin) return;

      // "same page" means the same route (by KIND, not raw pathname — a
      // link to "/redesign/" and a cold load at "/redesign/index.html" are
      // the same page, just two valid URL forms for it) AND the same query
      // string, so e.g. "Next project" (same kind, different ?slug=) is
      // correctly treated as real navigation, not an in-page anchor. The
      // nav bar lives outside <main> and never gets swapped, so its links
      // always use absolute paths precisely so this comparison stays
      // reliable no matter which view is showing.
      var kind = routeKind(url.pathname);
      var samePage = !!kind && kind === routeKind(location.pathname) && url.search === location.search;
      if (samePage && url.hash) {
        e.preventDefault();
        if (url.hash === '#' || url.hash === '#top') { if (lenis) lenis.scrollTo(0); else window.scrollTo({ top: 0 }); return; }
        var t = document.querySelector(url.hash);
        if (t) { if (lenis) lenis.scrollTo(t, { offset: 0 }); else t.scrollIntoView(); }
        return;
      }
      if (samePage) return; // link to exactly where we already are

      e.preventDefault();
      if (!kind) { location.href = url.href; return; } // unrecognised route — plain nav, always works
      goTo(url, true);
    });

    window.addEventListener('popstate', function () {
      var url = new URL(location.href);
      if (!routeKind(url.pathname)) return; // left our SPA routes entirely; let the browser handle it
      if (routing) return;
      routing = true;
      cover().then(function () { return fetch(fetchTarget(url), { cache: 'no-store' }); })
        .then(function (r) { return r.text(); })
        .then(function (html) {
          var doc = new DOMParser().parseFromString(html, 'text/html');
          var view = swapMainTo(doc);
          initView(view, url);
          lift();
          routing = false;
        })
        .catch(function () {
          // fetch/parse failed — the address bar already shows the target
          // URL (the browser updates it before firing popstate), so a real
          // reload of it is the only way to avoid stranding stale content
          // under the new URL.
          location.reload();
        });
    });

    // a page restored from bfcache can carry whatever transform was left on
    // it — always resolve back to fully hidden.
    window.addEventListener('pageshow', function (e) {
      if (e.persisted && overlay) overlay.style.transform = 'translateY(-100%)';
    });
  })();

  /* ============================================================
     PER-VIEW SETUP — every one of these is safe to call again after
     a swap: they either re-query the live DOM fresh each time (no
     stale element references survive a swap) or are naturally
     idempotent. window/document-level listeners are wired exactly
     once, in wireGlobalOnce(), and internally re-query the current
     DOM rather than capturing elements via closure.
     ============================================================ */

  // ---------- reveal-on-scroll (independent of GSAP) ----------
  var revealIO = null;
  var revealAllTimer = null;
  function revealObserverInit() {
    root.classList.add('js-ready');
    if (revealIO) revealIO.disconnect();
    var items = [].slice.call(document.querySelectorAll('[data-anim]'));
    clearTimeout(revealAllTimer);
    if (!items.length) return;
    function revealAll() { root.classList.add('reveal-all'); }
    if (!('IntersectionObserver' in window)) { revealAll(); return; }
    revealIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); revealIO.unobserve(e.target); }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -8% 0px' });
    items.forEach(function (el) { revealIO.observe(el); });
    revealAllTimer = setTimeout(revealAll, 5000); // hard fallback: nothing stays hidden past 5s
  }

  // ---------- hero scroll effect (independent of GSAP / rAF) ----------
  // Queries `.hero` fresh on every tick rather than capturing it once, so
  // it keeps working correctly across repeated swaps into/out of home.
  (function wireHeroScrollEffect() {
    var ticking = false;
    function apply() {
      ticking = false;
      var hero = document.querySelector('.hero');
      if (!hero) return;
      var h = hero.offsetHeight || window.innerHeight;
      var p = Math.min(1, Math.max(0, window.scrollY / h));
      var pf = Math.min(1, p / 0.18);
      hero.style.setProperty('--hp', p.toFixed(4));
      hero.style.setProperty('--hpf', pf.toFixed(4));
    }
    function onScroll() {
      if (ticking) return;
      ticking = true;
      if (window.requestAnimationFrame) requestAnimationFrame(apply);
      else setTimeout(apply, 16);
      setTimeout(function () { if (ticking) apply(); }, 120);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', apply);
    window.__rnrApplyHeroScroll = apply;
  })();

  // ---------- nav dark-section invert (independent of GSAP) ----------
  var navInvertIO = null;
  function navInvertRebuild() {
    var nav = document.getElementById('nav');
    var darkSections = document.querySelectorAll('.statement');
    if (navInvertIO) { navInvertIO.disconnect(); navInvertIO = null; }
    if (!nav) return;
    if (!darkSections.length || !('IntersectionObserver' in window)) { nav.classList.remove('on-dark'); return; }
    var navH = nav.offsetHeight || 70;
    var bottom = Math.max(0, Math.round(window.innerHeight - navH));
    navInvertIO = new IntersectionObserver(function (entries) {
      var onDark = entries.some(function (e) { return e.isIntersecting; });
      nav.classList.toggle('on-dark', onDark);
    }, { rootMargin: '0px 0px -' + bottom + 'px 0px', threshold: 0 });
    darkSections.forEach(function (el) { navInvertIO.observe(el); });
  }
  (function () {
    var rt;
    window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(navInvertRebuild, 200); });
  })();

  // ---------- work grid (data-driven; independent of GSAP) ----------
  function renderWorkGrid() {
    var grid = document.querySelector('.work-grid');
    if (!grid) return Promise.resolve();
    return fetch('/redesign/data/work.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (data) {
        var items = data && data.items;
        if (!items || !items.length) return; // keep the static fallback cards
        grid.innerHTML = '';
        items.forEach(function (item, i) {
          var a = document.createElement('a');
          a.className = 'work-cell';
          a.href = '/redesign/work/case.html?slug=' + encodeURIComponent(item.slug || '');
          a.style.transitionDelay = (i * 0.06).toFixed(2) + 's';
          a.innerHTML =
            '<span class="wc-year">' + esc(item.year) + '</span>' +
            '<span class="wc-title">' + esc(item.title) + '</span>' +
            '<span class="wc-cat">' + esc(item.category) + '</span>';
          grid.appendChild(a);
        });
        var count = document.querySelector('.work-head .count');
        if (count) count.textContent = items.length + (items.length === 1 ? ' project' : ' projects');
      });
  }

  // ---------- case-study populate (independent of GSAP) ----------
  function paragraphs(text) {
    return String(text || '').split(/\n\s*\n/).map(function (p) {
      return '<p>' + esc(p.trim()).replace(/\n/g, '<br>') + '</p>';
    }).join('');
  }
  function setShot(el, src, fallbackClass) {
    if (!el || !src) return;
    el.innerHTML = '<img src="' + esc(src) + '" alt="">';
    el.classList.remove(fallbackClass);
  }
  function populateCaseView(url) {
    var slug = new URLSearchParams(url.search).get('slug');
    return fetch('/redesign/data/work.json', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var items = (data && data.items) || [];
        if (!items.length) return;
        var i = items.findIndex(function (it) { return it.slug === slug; });
        if (i === -1) i = 0;
        var item = items[i];
        var next = items[(i + 1) % items.length];

        document.title = item.title + ' — Rifat Newaj Razin';
        var pageTitle = document.getElementById('pageTitle');
        if (pageTitle) pageTitle.textContent = document.title;
        setText('caseTitle', item.title);
        setText('metaYear', item.year || '—');
        setText('metaRole', item.role || '—');
        setText('metaDeliverables', item.deliverables || '—');
        setText('metaClient', item.client || '—');
        setHTML('briefText', paragraphs(item.brief));
        setHTML('approachText', paragraphs(item.approach));
        setHTML('outcomeText', paragraphs(item.outcome));

        setShot(document.getElementById('shotCover'), item.cover, 'a');
        var gallery = item.gallery || [];
        setShot(document.getElementById('shotB'), gallery[0], 'b');
        setShot(document.getElementById('shotC'), gallery[1], 'c');

        var nextLink = document.getElementById('nextProjectLink');
        if (nextLink) {
          nextLink.textContent = (next.title || '') + ' ↗';
          nextLink.href = '/redesign/work/case.html?slug=' + encodeURIComponent(next.slug || '');
        }
      })
      .catch(function () { /* static "—" placeholders stay as a safe fallback */ });
  }
  function setText(id, v) { var el = document.getElementById(id); if (el) el.textContent = v; }
  function setHTML(id, v) { var el = document.getElementById(id); if (el) el.innerHTML = v; }

  // ---------- lightbox (independent of GSAP) — wired once, delegated ----------
  (function wireLightbox() {
    var lb = document.getElementById('lightbox');
    var lbImg = document.getElementById('lightboxImg');
    if (!lb || !lbImg) return;
    function open(src, alt) {
      lbImg.src = src;
      lbImg.alt = alt || '';
      lb.classList.add('open');
      lb.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
    }
    function close() {
      lb.classList.remove('open');
      lb.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
    }
    document.addEventListener('click', function (e) {
      var img = e.target.closest && e.target.closest('.shot img, .instax-img img');
      if (img) { open(img.src, img.alt); return; }
      if (e.target === lb || e.target.id === 'lightboxClose') close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
    });
  })();

  // ---------- marquee builder (independent of GSAP) ----------
  function buildMarquee() {
    var track = document.getElementById('marqueeTrack');
    var seq = document.getElementById('marqueeSeq');
    if (!track || !seq) return;
    if (!seq.dataset.html) seq.dataset.html = seq.innerHTML;
    seq.innerHTML = seq.dataset.html;
    while (track.children.length > 1) track.removeChild(track.lastChild);
    var unit = seq.dataset.html;
    var guard = 0;
    while (seq.scrollWidth < window.innerWidth && guard++ < 20) {
      seq.insertAdjacentHTML('beforeend', unit);
    }
    var clone = seq.cloneNode(true);
    clone.removeAttribute('id');
    clone.setAttribute('aria-hidden', 'true');
    track.appendChild(clone);
    track.style.setProperty('--marquee-dur', (seq.scrollWidth / 55).toFixed(2) + 's');
  }
  (function () {
    var rt;
    window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(buildMarquee, 250); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(buildMarquee);
  })();

  // ---------- magnetic buttons (re-wired per swap: elements are new) ----------
  function wireMagnetic() {
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
  }

  /* ---------- fit hero lines to one shared width ----------
     Every line is scaled to span the SAME target width — the space actually
     available in the hero — so the two lines read as one justified block. */
  var FLANK_BREAKPOINT = 820;
  var heroResizeObserver = null;

  function fitMaxFontSize() {
    var hero = document.querySelector('.hero');
    var h = (hero ? hero.clientHeight : window.innerHeight) || window.innerHeight;
    return Math.max(48, h * 0.34);
  }
  function equaliseFlanks() {
    var fl = document.querySelector('.flank-l');
    var fr = document.querySelector('.flank-r');
    if (!fl || !fr) return;
    fl.style.width = ''; fr.style.width = '';
    if (window.innerWidth <= FLANK_BREAKPOINT) return;
    var w = Math.max(fl.offsetWidth, fr.offsetWidth);
    if (w > 0) { fl.style.width = w + 'px'; fr.style.width = w + 'px'; }
  }
  function heroAvailableWidth() {
    var hero = document.querySelector('.hero');
    var hcs = getComputedStyle(hero);
    var full = hero.clientWidth - parseFloat(hcs.paddingLeft || 0) - parseFloat(hcs.paddingRight || 0);
    if (window.innerWidth <= FLANK_BREAKPOINT) return full;
    var fl = document.querySelector('.flank-l');
    var fr = document.querySelector('.flank-r');
    if (!fl || !fr) return full;
    var flank = fl.offsetParent || fr.offsetParent;
    if (!flank) return full;
    var flankLeft = flank.getBoundingClientRect().left;
    var lRight = flankLeft + fl.offsetLeft + fl.offsetWidth;
    var rLeft = flankLeft + fr.offsetLeft;
    var gap = 40;
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
  (function () {
    var fitRT;
    function scheduleFit() { clearTimeout(fitRT); fitRT = setTimeout(fitHero, 120); }
    window.addEventListener('resize', scheduleFit);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', scheduleFit);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitHero);
    window.__rnrScheduleFit = scheduleFit;
  })();

  /* ---------- split helpers ---------- */
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
  }

  /* ---------- scroll-driven GSAP effects (home view only) ---------- */
  function buildHomeScrollFx() {
    var stWords = document.querySelectorAll('.statement-text .word');
    if (stWords.length) {
      gsap.to(stWords, {
        color: '#f4f1e9', ease: 'none', stagger: { each: 0.4 },
        scrollTrigger: { trigger: '.statement', start: 'top 72%', end: 'bottom 62%', scrub: true }
      });
    }
    var abWords = document.querySelectorAll('.about-lead .word');
    if (abWords.length) {
      gsap.set(abWords, { opacity: 0.25 });
      gsap.to(abWords, {
        opacity: 1, ease: 'none', stagger: { each: 0.14 },
        scrollTrigger: { trigger: '.about-lead', start: 'top 80%', end: 'bottom 72%', scrub: true }
      });
    }
    document.querySelectorAll('[data-count]').forEach(function (el) {
      var end = +el.dataset.count, suf = el.dataset.suffix || '', o = { v: 0 };
      el.textContent = '0' + suf;
      ScrollTrigger.create({
        trigger: el, start: 'top 88%', once: true,
        onEnter: function () {
          gsap.to(o, { v: end, duration: 1.4, ease: 'power2.out',
            onUpdate: function () { el.textContent = Math.round(o.v) + suf; } });
        }
      });
    });
  }

  /* ---------- "other versions" doodads (home view) ----------
     Decorative SVGs that drift inside the #versions section and parallax a
     little on scroll. Rebuilt on every home load (the .vers-doodads box is
     inside <main>, so a swap gives us a fresh, empty one). Purely ambient:
     the layer is pointer-events:none. Skipped without GSAP / on narrow
     layouts / under reduced motion. */
  function buildVersionsDoodads() {
    var box = document.querySelector('.vers-doodads');
    if (!box || !haveGSAP || reduce) return;
    if (matchMedia('(max-width: 820px)').matches) return;
    box.innerHTML = '';

    var S = {
      note: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 24V7l14-3v14"/><circle cx="8" cy="24" r="4"/><circle cx="22" cy="21" r="4"/></svg>',
      phones: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 20v-4a11 11 0 0 1 22 0v4"/><rect x="3" y="19" width="6" height="9" rx="2"/><rect x="23" y="19" width="6" height="9" rx="2"/></svg>',
      tape: '<svg viewBox="0 0 40 28" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="2" y="2" width="36" height="24" rx="3"/><circle cx="14" cy="14" r="4"/><circle cx="26" cy="14" r="4"/><path d="M12 22h16"/></svg>',
      bike: '<svg viewBox="0 0 40 28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="20" r="6"/><circle cx="31" cy="20" r="6"/><path d="M9 20l7-11h9l-6 11M16 9h-3M25 9l3 4"/></svg>',
      pace: '<svg viewBox="0 0 30 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l8 6-8 6M14 6l8 6-8 6"/></svg>',
      spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3v6M12 15v6M3 12h6M15 12h6"/></svg>'
    };
    var ITEMS = [
      { svg: S.note,   w: 30, ax: 0.06, ay: 0.13 },
      { svg: S.phones, w: 34, ax: 0.94, ay: 0.10 },
      { svg: S.bike,   w: 46, ax: 0.91, ay: 0.52 },
      { svg: S.tape,   w: 42, ax: 0.05, ay: 0.55 },
      { svg: S.pace,   w: 32, ax: 0.95, ay: 0.87 },
      { svg: S.spark,  w: 22, ax: 0.09, ay: 0.9  }
    ];
    ITEMS.forEach(function (cfg) {
      var el = document.createElement('div');
      el.className = 'vers-doodad';
      el.style.width = cfg.w + 'px';
      el.innerHTML = cfg.svg;
      box.appendChild(el);
      var rot = Math.random() * 24 - 12;
      gsap.set(el, { left: (cfg.ax * 100) + '%', top: (cfg.ay * 100) + '%', xPercent: -50, yPercent: -50, rotation: rot });
      gsap.to(el, {
        x: '+=' + (Math.random() * 20 - 10),
        y: '+=' + (Math.random() * 28 - 14),
        rotation: rot + (Math.random() * 10 - 5),
        duration: 4 + Math.random() * 4, ease: 'sine.inOut', repeat: -1, yoyo: true
      });
    });
    gsap.to(box.children, {
      yPercent: -20, ease: 'none',
      scrollTrigger: { trigger: '.versions', start: 'top bottom', end: 'bottom top', scrub: true }
    });
  }

  // nav hide on scroll-down — always active, every view. Deliberate, not
  // jumpy: requires a sustained scroll of THRESHOLD px in one direction
  // before it reacts, so a small wheel/trackpad wobble can't flicker it.
  function buildNavHideOnScroll() {
    var nav = document.getElementById('nav');
    if (!nav) return;
    var HIDE_AT = 140, THRESHOLD = 28;
    var lastY = window.scrollY || 0, accum = 0, navHidden = false;
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
  }

  /* ============================================================
     FLOATIES — draggable "desktop clutter" over the whole site.
     The #floaties layer lives outside <main>, so it is built ONCE
     (here) and then persists untouched through every client-side
     swap. Requires GSAP; skipped on narrow/touch layouts and under
     reduced motion (the CSS hides the layer there too, this just
     avoids doing the work). Each object floats on a slow yoyo tween
     that a drag interrupts; on release it gets a short inertia throw
     and then resumes bobbing around wherever it landed.
     ============================================================ */
  function initFloaties() {
    var layer = document.getElementById('floaties');
    if (!layer || !haveGSAP || reduce) return;
    if (layer.dataset.ready) return;
    if (matchMedia('(max-width: 820px)').matches || matchMedia('(pointer: coarse)').matches) return;
    layer.dataset.ready = '1';

    var FOLDER =
      '<svg viewBox="0 0 48 40" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M2 7h15l4 5h25v25a1 1 0 0 1-1 1H2z" fill="#f4f1e9" ' +
      'stroke="#565248" stroke-width="2" stroke-linejoin="round"/></svg>';

    // type: 'card' (framed photo — swap src / add entries as you like, GIFs
    // included), 'glyph' (plain display-face text), or 'svg' (inline markup).
    // ax/ay are the anchor as a fraction of the viewport, kept away from the
    // horizontal centre where the headline sits.
    var ITEMS = [
      { type: 'card',  src: '/redesign/uploads/gemini_generated_image_s0743bs0743bs074.jpeg', w: 148, h: 116, ax: 0.09, ay: 0.24 },
      { type: 'card',  src: '/redesign/uploads/gemini_generated_image_dhwd31dhwd31dhwd.jpeg', w: 122, h: 150, ax: 0.9,  ay: 0.18 },
      { type: 'card',  src: '/redesign/uploads/gemini_generated_image_iub7luiub7luiub7.jpeg', w: 132, h: 104, ax: 0.13, ay: 0.72 },
      { type: 'card',  src: '/redesign/uploads/gemini_generated_image_3l5b3t3l5b3t3l5b.jpeg', w: 138, h: 138, ax: 0.88, ay: 0.7  },
      { type: 'glyph', text: '\\( ^_^ )/', size: 20, ax: 0.5, ay: 0.9 },
      { type: 'glyph', text: '{ ˆ-ˆ }', size: 20, ax: 0.06, ay: 0.47 },
      { type: 'svg',   svg: FOLDER, w: 46, ax: 0.94, ay: 0.44 }
    ];

    function rand(a, b) { return a + Math.random() * (b - a); }
    function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

    var objs = [];

    function build(cfg) {
      var el = document.createElement('div');
      el.className = 'floatie is-' + cfg.type;
      if (cfg.type === 'card') {
        el.style.width = cfg.w + 'px';
        el.innerHTML = '<img src="' + esc(cfg.src) + '" alt="" draggable="false" ' +
          'style="height:' + (cfg.h || Math.round(cfg.w * 0.8)) + 'px">';
      } else if (cfg.type === 'glyph') {
        el.style.fontSize = (cfg.size || 20) + 'px';
        el.textContent = cfg.text;
      } else {
        el.style.width = cfg.w + 'px';
        el.innerHTML = cfg.svg;
      }
      layer.appendChild(el);
      return el;
    }

    function place(o) {
      var vw = window.innerWidth, vh = window.innerHeight;
      var r = o.el.getBoundingClientRect();
      o.x = clamp(o.cfg.ax * vw - r.width / 2, 8, vw - r.width - 8);
      o.y = clamp(o.cfg.ay * vh - r.height / 2, 8, vh - r.height - 8);
      gsap.set(o.el, { x: o.x, y: o.y, rotation: o.rot });
    }

    function bob(o) {
      if (o.tween) o.tween.kill();
      o.tween = gsap.to(o.el, {
        x: '+=' + rand(-16, 16), y: '+=' + rand(-22, 22), rotation: o.rot + rand(-4, 4),
        duration: rand(4, 7), ease: 'sine.inOut', repeat: -1, yoyo: true
      });
    }

    ITEMS.forEach(function (cfg) {
      var o = { cfg: cfg, el: build(cfg), rot: cfg.type === 'glyph' ? 0 : rand(-9, 9), tween: null };
      place(o);
      objs.push(o);
    });

    gsap.from(layer.children, { autoAlpha: 0, duration: 0.6, stagger: 0.06, delay: 0.25,
      onComplete: function () { objs.forEach(bob); } });

    // ---------- drag (plain Pointer Events, no plugin) ----------
    objs.forEach(function (o) {
      var el = o.el, dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
      var lastX = 0, lastY = 0, lastT = 0, vx = 0, vy = 0;

      el.addEventListener('pointerdown', function (e) {
        dragging = true;
        el.setPointerCapture(e.pointerId);
        if (o.tween) o.tween.kill();
        gsap.killTweensOf(el);
        o.x = gsap.getProperty(el, 'x'); o.y = gsap.getProperty(el, 'y');
        sx = e.clientX; sy = e.clientY; ox = o.x; oy = o.y;
        lastX = e.clientX; lastY = e.clientY; lastT = e.timeStamp; vx = vy = 0;
        el.style.zIndex = String(++initFloaties._top);
      });

      el.addEventListener('pointermove', function (e) {
        if (!dragging) return;
        var vw = window.innerWidth, vh = window.innerHeight, r = el.getBoundingClientRect();
        o.x = clamp(ox + (e.clientX - sx), -r.width * 0.4, vw - r.width * 0.6);
        o.y = clamp(oy + (e.clientY - sy), -r.height * 0.4, vh - r.height * 0.6);
        gsap.set(el, { x: o.x, y: o.y });
        var dt = e.timeStamp - lastT;
        if (dt > 0) { vx = (e.clientX - lastX) / dt; vy = (e.clientY - lastY) / dt; }
        lastX = e.clientX; lastY = e.clientY; lastT = e.timeStamp;
      });

      function end(e) {
        if (!dragging) return;
        dragging = false;
        try { el.releasePointerCapture(e.pointerId); } catch (err) {}
        var vw = window.innerWidth, vh = window.innerHeight, r = el.getBoundingClientRect();
        o.x = clamp(o.x + vx * 90, 8, vw - r.width - 8);
        o.y = clamp(o.y + vy * 90, 8, vh - r.height - 8);
        gsap.to(el, {
          x: o.x, y: o.y, duration: 0.7, ease: 'power2.out',
          onComplete: function () {
            o.cfg.ax = (o.x + r.width / 2) / window.innerWidth;
            o.cfg.ay = (o.y + r.height / 2) / window.innerHeight;
            bob(o);
          }
        });
      }
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
    });
    initFloaties._top = 15;

    var frt;
    window.addEventListener('resize', function () {
      clearTimeout(frt);
      frt = setTimeout(function () { objs.forEach(function (o) { bob(o); place(o); }); }, 200);
    });
  }

  /* ============================================================
     BOOT / initView — the single entry point run on cold load AND
     after every client-side swap.
     ============================================================ */
  function scrollToHash(url) {
    if (!url.hash) return;
    var t = document.querySelector(url.hash);
    if (!t) return;
    if (lenis) lenis.scrollTo(t, { offset: 0, immediate: true }); else t.scrollIntoView();
  }

  function initView(view, url) {
    // cover() stops Lenis before every transition (so it can't fight the
    // page-transition scroll reset) — resume it before scrollToHash needs
    // it. Harmless/idempotent on a cold boot, where Lenis was never stopped.
    if (lenis) lenis.start();
    revealObserverInit();
    navInvertRebuild();

    if (view === 'home') {
      document.querySelectorAll('[data-split="words"]').forEach(function (el) {
        if (!el.querySelector('.word')) splitWords(el);
      });
      renderWorkGrid();
      buildMarquee();
      fitHero();
      if (window.__rnrApplyHeroScroll) window.__rnrApplyHeroScroll();
      if (heroResizeObserver) heroResizeObserver.disconnect();
      if (window.ResizeObserver) {
        var hero = document.querySelector('.hero');
        if (hero) { heroResizeObserver = new ResizeObserver(function () { fitHero(); }); heroResizeObserver.observe(hero); }
      }
      if (haveGSAP) { wireMagnetic(); buildHomeScrollFx(); buildVersionsDoodads(); }
    } else if (view === 'case') {
      populateCaseView(url);
    }

    if (haveGSAP) { buildNavHideOnScroll(); ScrollTrigger.refresh(); }
    scrollToHash(url);
  }

  /* ============================================================
     Fallback path — GSAP/Lenis failed to load, or the visitor prefers
     reduced motion. Content must still be fully usable.
     ============================================================ */
  if (!haveGSAP || reduce) {
    document.body.classList.add('intro-done');
    document.querySelectorAll('[data-anim]').forEach(function (el) { el.style.opacity = 1; });
    document.querySelectorAll('.statement-text .word').forEach(function (w) { w.style.color = '#f4f1e9'; });
    initView(detectView(document), new URL(location.href));
    return;
  }

  root.classList.add('js-ready');
  gsap.registerPlugin(ScrollTrigger);
  lenis = new Lenis({ duration: 1.15, smoothWheel: true, wheelMultiplier: 0.9 });
  window.__lenis = lenis;
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add(function (t) { lenis.raf(t * 1000); });
  gsap.ticker.lagSmoothing(0);

  // Built once here so it covers every GSAP boot path below (intro, no-intro
  // cold load, cold load of the case view) without being tied to initView,
  // which re-runs on every swap.
  initFloaties();

  /* ---------- INTRO ---------- */
  // Only a cold/direct load of the homepage gets the full "RNR." panel-lift
  // reveal — it can never replay on client-side navigation, since that
  // never reloads the document.
  if (!document.getElementById('intro')) {
    document.body.classList.add('intro-done');
    initView(detectView(document), new URL(location.href));
    return;
  }

  lenis.stop();
  gsap.set('main, .foot', { filter: 'blur(16px)', autoAlpha: 0.35 });
  gsap.set('.intro-mark', { opacity: 0, y: 10 });

  var fontsReady = (document.fonts && document.fonts.ready)
    ? Promise.race([document.fonts.ready, new Promise(function (r) { setTimeout(r, 2500); })])
    : Promise.resolve();

  var introFinished = false;
  function finishIntro() {
    if (introFinished) return;
    introFinished = true;
    document.body.classList.add('intro-done');
    gsap.set('main, .foot', { autoAlpha: 1, clearProps: 'filter' });
    lenis.start();
    initView('home', new URL(location.href));
    setTimeout(function () { gsap.set('.hero-name', { opacity: 1 }); }, 500);
  }
  setTimeout(finishIntro, 4200); // failsafe — registered now, not inside onComplete

  fontsReady.then(function () {
    fitHero();
    if (introFinished) return;
    gsap.timeline({ onComplete: finishIntro, defaults: { ease: 'power2.inOut' } })
      .to('.intro-mark', { opacity: 1, y: 0, duration: 0.5 })
      .to({}, { duration: 0.7 })
      .to('.intro-mark', { opacity: 0, duration: 0.35 }, 'reveal')
      .to('#intro', { yPercent: -100, duration: 1.25, ease: 'expo.inOut' }, 'reveal')
      .to('main, .foot', { filter: 'blur(0px)', autoAlpha: 1, duration: 1.1, ease: 'power3.out' }, 'reveal+=0.25');
  });
})();
