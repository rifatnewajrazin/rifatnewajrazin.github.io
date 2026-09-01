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
     FLOATIES — playful "desktop clutter" scattered across the HERO
     only. The .floaties layer lives inside <section class="hero">
     (which is position:relative; overflow:hidden), so the objects
     are clipped to the hero and scroll away with it — they do not
     follow the visitor down the page and never appear on case
     pages. Rebuilt on every home load (the layer is inside <main>,
     so a swap hands us a fresh empty one). Skipped without GSAP, on
     narrow/touch layouts, and under reduced motion.

     Each object has an outer node (absolute position; the drag +
     mouse-parallax target) and an inner node (a slow idle bob, so
     the bob never fights the drag/parallax transform).
     ============================================================ */
  function initFloaties() {
    var hero = document.querySelector('.hero');
    var layer = document.querySelector('.floaties');
    if (!layer || !hero || !haveGSAP || reduce) return;
    if (matchMedia('(max-width: 820px)').matches || matchMedia('(pointer: coarse)').matches) return;

    // rebuild clean (kill any tweens from a previous home visit first)
    layer.querySelectorAll('.floatie, .floatie-in').forEach(function (n) { gsap.killTweensOf(n); });
    layer.innerHTML = '';
    // the layer is a sibling of .hero, so give it the hero's height
    layer.style.height = (hero.offsetHeight || window.innerHeight) + 'px';

    function rand(a, b) { return a + Math.random() * (b - a); }
    function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

    /* Hand-drawn-ish doodles as inline SVG (crisp, themeable via
       currentColor, zero extra requests). To use your own raster art
       instead, drop a transparent PNG in /redesign/uploads/ and change
       that entry to { type: 'img', src: U + 'doodle-x.png', w: … }. */
    var G = function (vb, body) {
      return '<svg viewBox="0 0 ' + vb + '" xmlns="http://www.w3.org/2000/svg" fill="none" ' +
        'stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">' + body + '</svg>';
    };
    var D = {
      laptop:   G('120 96', '<path d="M30 8h60l14 46H16z"/><path d="M8 62h104l-8 24H16z"/><path d="M42 70h36M38 78h44"/>'),
      monitor:  G('96 92', '<rect x="6" y="6" width="84" height="58" rx="6"/><path d="M40 64l-4 16h28l-4-16M28 82h40"/>'),
      keyboard: G('132 74', '<rect x="4" y="18" width="104" height="46" rx="7"/><path d="M14 30h84M14 40h84M14 50h58M80 50h18M108 24c14-4 12-18 20-20"/>'),
      mouse:    G('70 98', '<rect x="14" y="8" width="42" height="62" rx="21"/><path d="M35 8v26M22 20c0-9 26-9 26 0M35 70c-6 10 4 12 2 22"/>'),
      cursor:   G('72 82', '<path d="M18 10l2 48 12-12 8 18 8-4-8-18 16-2z"/><path d="M8 22v8M4 26h8M60 12v6M57 15h6"/>'),
      notebook: G('76 94', '<path d="M22 6h44a4 4 0 0 1 4 4v74a4 4 0 0 1-4 4H22z"/><rect x="32" y="16" width="26" height="14" rx="2"/><path d="M22 12c-10 0-10 8 0 8M22 30c-10 0-10 8 0 8M22 48c-10 0-10 8 0 8M22 66c-10 0-10 8 0 8"/>'),
      wallet:   G('98 76', '<path d="M10 20h64v42a6 6 0 0 1-6 6H16a6 6 0 0 1-6-6z"/><path d="M74 34h16v16H74M20 20c2-11 15-13 25-6"/><circle cx="82" cy="42" r="2.6"/>'),
      undo:     G('116 56', '<rect x="4" y="8" width="46" height="40" rx="8"/><rect x="70" y="8" width="42" height="40" rx="8"/><path d="M56 28h6M59 25v6M20 20a10 10 0 1 1-3 13M17 25v9h9M96 18l-9 20M87 18l9 20M87 18h15"/>')
    };
    var ITEMS = [
      { type: 'svg', svg: D.laptop,   w: 128, ax: 0.13, ay: 0.30 },
      { type: 'svg', svg: D.monitor,  w: 86,  ax: 0.87, ay: 0.23 },
      { type: 'svg', svg: D.keyboard, w: 124, ax: 0.80, ay: 0.80 },
      { type: 'svg', svg: D.mouse,    w: 56,  ax: 0.20, ay: 0.74 },
      { type: 'svg', svg: D.cursor,   w: 44,  ax: 0.63, ay: 0.18 },
      { type: 'svg', svg: D.notebook, w: 58,  ax: 0.07, ay: 0.58 },
      { type: 'svg', svg: D.wallet,   w: 80,  ax: 0.93, ay: 0.56 },
      { type: 'svg', svg: D.undo,     w: 96,  ax: 0.46, ay: 0.87 },
      { type: 'kao', text: '\\( ^_^ )/', size: 30, ax: 0.50, ay: 0.12 },
      { type: 'kao', text: '{ ˆ-ˆ }',    size: 28, ax: 0.31, ay: 0.50 },
      { type: 'kao', text: '>_<',        size: 30, ax: 0.70, ay: 0.64 },
      { type: 'kao', text: '; )',        size: 30, ax: 0.10, ay: 0.17 }
    ];

    var objs = [];

    function build(cfg) {
      var el = document.createElement('div');
      el.className = 'floatie is-' + cfg.type;
      var inner = document.createElement('div');
      inner.className = 'floatie-in';
      if (cfg.type === 'img') {
        el.style.width = cfg.w + 'px';
        var img = new Image();
        img.src = cfg.src; img.alt = ''; img.draggable = false;
        img.onerror = function () { el.remove(); objs = objs.filter(function (o) { return o.el !== el; }); };
        inner.appendChild(img);
      } else if (cfg.type === 'svg') {
        el.style.width = cfg.w + 'px';
        inner.innerHTML = cfg.svg;
      } else {
        inner.style.fontSize = (cfg.size || 26) + 'px';
        inner.textContent = cfg.text;
      }
      el.appendChild(inner);
      layer.appendChild(el);
      return { el: el, inner: inner };
    }

    function place(o) {
      var b = layer.getBoundingClientRect();
      var r = o.el.getBoundingClientRect();
      o.px = clamp(o.cfg.ax * b.width - r.width / 2, 6, b.width - r.width - 6);
      o.py = clamp(o.cfg.ay * b.height - r.height / 2, 6, b.height - r.height - 6);
      gsap.set(o.el, { x: o.px, y: o.py });
    }

    // idle life: a slow drift on x/y, plus a rotation tween — smooth for
    // most, but a "jitter" subset ticks in steps (rotate a few degrees,
    // snap back) so they read as fidgety / alive rather than gliding.
    function bob(o) {
      if (o.drift) o.drift.kill();
      if (o.spin) o.spin.kill();
      gsap.set(o.inner, { rotation: o.rot });
      o.drift = gsap.to(o.inner, {
        x: rand(-10, 10), y: rand(-14, 14),
        duration: rand(4.5, 8), ease: 'sine.inOut', repeat: -1, yoyo: true
      });
      if (o.jitter) {
        o.spin = gsap.to(o.inner, {
          rotation: o.rot + rand(4, 9) * (Math.random() < 0.5 ? -1 : 1),
          duration: rand(0.6, 1.3), ease: 'steps(2)',
          repeat: -1, yoyo: true, repeatDelay: rand(0.2, 1.1)
        });
      } else {
        o.spin = gsap.to(o.inner, {
          rotation: o.rot + rand(-5, 5),
          duration: rand(3.5, 6.5), ease: 'sine.inOut', repeat: -1, yoyo: true
        });
      }
    }

    ITEMS.forEach(function (cfg) {
      var made = build(cfg);
      var o = {
        cfg: cfg, el: made.el, inner: made.inner, drift: null, spin: null,
        rot: cfg.type === 'kao' ? rand(-8, 8) : rand(-14, 14),
        depth: cfg.type === 'kao' ? rand(0.5, 0.9) : rand(0.5, 1.3),
        jitter: Math.random() < 0.45
      };
      place(o);
      objs.push(o);
    });

    gsap.from(layer.children, {
      autoAlpha: 0, duration: 0.6, stagger: 0.05, delay: 0.2,
      onComplete: function () { objs.forEach(bob); }
    });

    // ---------- mouse parallax (whole layer, while not dragging) ----------
    var PARALLAX = 34;
    hero.addEventListener('pointermove', function (e) {
      if (e.pointerType === 'touch') return;
      var b = layer.getBoundingClientRect();
      var fx = (e.clientX - b.left) / b.width - 0.5;
      var fy = (e.clientY - b.top) / b.height - 0.5;
      objs.forEach(function (o) {
        if (o.dragging) return;
        gsap.to(o.el, {
          x: o.px + fx * PARALLAX * o.depth,
          y: o.py + fy * PARALLAX * o.depth,
          duration: 0.7, ease: 'power2.out', overwrite: 'auto'
        });
      });
    });
    hero.addEventListener('pointerleave', function () {
      objs.forEach(function (o) {
        if (o.dragging) return;
        gsap.to(o.el, { x: o.px, y: o.py, duration: 0.9, ease: 'power2.out', overwrite: 'auto' });
      });
    });

    // ---------- drag (plain Pointer Events, no plugin) ----------
    initFloaties._top = 2;
    objs.forEach(function (o) {
      var el = o.el, sx = 0, sy = 0, ox = 0, oy = 0;
      var lastX = 0, lastY = 0, lastT = 0, vx = 0, vy = 0;

      el.addEventListener('pointerdown', function (e) {
        e.preventDefault(); // don't start a text selection on the hero
        o.dragging = true;
        try { el.setPointerCapture(e.pointerId); } catch (err) {}
        gsap.killTweensOf(el);
        o.px = gsap.getProperty(el, 'x'); o.py = gsap.getProperty(el, 'y');
        sx = e.clientX; sy = e.clientY; ox = o.px; oy = o.py;
        lastX = e.clientX; lastY = e.clientY; lastT = e.timeStamp; vx = vy = 0;
        el.style.zIndex = String(++initFloaties._top);
      });

      el.addEventListener('pointermove', function (e) {
        if (!o.dragging) return;
        // generous bounds: an object can be shoved ~75% off any edge, so it
        // roams the whole viewport but can never be lost entirely.
        var b = layer.getBoundingClientRect(), r = el.getBoundingClientRect();
        o.px = clamp(ox + (e.clientX - sx), -r.width * 0.75, b.width - r.width * 0.25);
        o.py = clamp(oy + (e.clientY - sy), -r.height * 0.75, b.height - r.height * 0.25);
        gsap.set(el, { x: o.px, y: o.py });
        var dt = e.timeStamp - lastT;
        if (dt > 0) { vx = (e.clientX - lastX) / dt; vy = (e.clientY - lastY) / dt; }
        lastX = e.clientX; lastY = e.clientY; lastT = e.timeStamp;
      });

      function end(e) {
        if (!o.dragging) return;
        o.dragging = false;
        try { el.releasePointerCapture(e.pointerId); } catch (err) {}
        var b = layer.getBoundingClientRect(), r = el.getBoundingClientRect();
        o.px = clamp(o.px + vx * 80, -r.width * 0.55, b.width - r.width * 0.45);
        o.py = clamp(o.py + vy * 80, -r.height * 0.55, b.height - r.height * 0.45);
        o.cfg.ax = (o.px + r.width / 2) / b.width;
        o.cfg.ay = (o.py + r.height / 2) / b.height;
        gsap.to(el, { x: o.px, y: o.py, duration: 0.7, ease: 'power2.out' });
      }
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
    });

    // resize listener is wired once (window persists across swaps); it acts
    // on whatever the latest build produced.
    initFloaties._objs = objs;
    initFloaties._place = place;
    initFloaties._layer = layer;
    initFloaties._hero = hero;
    if (!initFloaties._resizeWired) {
      initFloaties._resizeWired = true;
      var frt;
      window.addEventListener('resize', function () {
        clearTimeout(frt);
        frt = setTimeout(function () {
          var ly = initFloaties._layer, h = initFloaties._hero;
          if (ly && h) ly.style.height = (h.offsetHeight || window.innerHeight) + 'px';
          (initFloaties._objs || []).forEach(function (o) {
            if (!o.dragging) initFloaties._place(o);
          });
        }, 200);
      });
    }
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
      if (haveGSAP) { wireMagnetic(); buildHomeScrollFx(); buildVersionsDoodads(); initFloaties(); }
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
