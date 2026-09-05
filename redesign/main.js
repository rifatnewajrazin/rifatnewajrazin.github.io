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
  window.__rnrBooted = true; // tells the inline head-script's 4s failsafe to stand down
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

  /* Directional wipe. dir 'up' (default, used going deeper — home -> case):
     the panel enters from the BOTTOM, covers, then exits off the TOP, so
     the whole move reads as an upward sweep. dir 'down' (going back to
     home): enters from the TOP, exits off the BOTTOM — the exact reverse.
     cover() hard-resets the panel to its off-screen start edge (transition
     briefly disabled) so the direction is consistent no matter where the
     previous transition left it. */
  function cover(dir) {
    return new Promise(function (resolve) {
      if (!overlay || reduce) { resolve(); return; }
      if (lenis) lenis.stop();
      var from = dir === 'down' ? '-100%' : '100%';
      overlay.style.transition = 'none';
      overlay.style.transform = 'translateY(' + from + ')';
      void overlay.offsetHeight;      // commit the start edge with no animation
      overlay.style.transition = '';  // back to the stylesheet's transition
      var done = false;
      function go() { if (done) return; done = true; resolve(); }
      overlay.addEventListener('transitionend', go, { once: true });
      setTimeout(go, 700); // failsafe: never let a stalled transition block navigation
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { overlay.style.transform = 'translateY(0)'; });
      });
    });
  }
  function lift(dir) {
    if (!overlay || reduce) return;
    void overlay.offsetHeight; // commit the "covering" frame before animating away
    var to = dir === 'down' ? '100%' : '-100%';
    var lifted = false;
    function go() { if (lifted) return; lifted = true; overlay.style.transform = 'translateY(' + to + ')'; }
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

  function goTo(url, push, dir) {
    if (routing) return;
    routing = true;
    cover(dir).then(function () {
      return fetch(fetchTarget(url), { cache: 'no-store' });
    }).then(function (r) {
      if (!r.ok) throw new Error('bad response ' + r.status);
      return r.text();
    }).then(function (html) {
      var doc = new DOMParser().parseFromString(html, 'text/html');
      var view = swapMainTo(doc);
      if (push) history.pushState({ rnrSpa: true }, '', url.href);
      initView(view, url);
      lift(dir);
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
        // keep the address bar in sync with where we just scrolled, so a
        // refresh restores THIS position instead of an older hash. replace
        // (not push) — these are scrolls, not history steps, and popstate
        // here does a full view swap which is overkill for a scroll.
        if (url.hash === '#' || url.hash === '#top') {
          if (lenis) lenis.scrollTo(0); else window.scrollTo({ top: 0 });
          history.replaceState(history.state, '', url.pathname + url.search);
          return;
        }
        var t = document.querySelector(url.hash);
        if (t) {
          if (lenis) lenis.scrollTo(t, { offset: 0 }); else t.scrollIntoView();
          history.replaceState(history.state, '', url.pathname + url.search + url.hash);
        }
        return;
      }
      if (samePage) return; // link to exactly where we already are

      e.preventDefault();
      if (!kind) { location.href = url.href; return; } // unrecognised route — plain nav, always works
      // going to home = downward wipe; going deeper (case / next project) = upward
      goTo(url, true, kind === 'home' ? 'down' : 'up');
    });

    window.addEventListener('popstate', function () {
      var url = new URL(location.href);
      var kind = routeKind(url.pathname);
      if (!kind) return; // left our SPA routes entirely; let the browser handle it
      if (routing) return;
      routing = true;
      var dir = kind === 'home' ? 'down' : 'up';
      cover(dir).then(function () { return fetch(fetchTarget(url), { cache: 'no-store' }); })
        .then(function (r) { return r.text(); })
        .then(function (html) {
          var doc = new DOMParser().parseFromString(html, 'text/html');
          var view = swapMainTo(doc);
          initView(view, url);
          lift(dir);
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

  // ---------- nav / toggle colour-band invert (independent of GSAP) ----------
  // Both the top nav and the bottom-right theme toggle re-tint to the
  // "on band" light while the coral/blue .statement sits behind them.
  // Nav: an IntersectionObserver on the strip under the header. Toggle:
  // a real rect-overlap test each frame — a bottom strip can't be used
  // there because the section after the hero always pokes into it.
  var navInvertIO = null;
  function updateToggleBand() {
    var toggle = document.getElementById('themeToggle');
    if (!toggle) return;
    var t = toggle.getBoundingClientRect();
    var on = false;
    document.querySelectorAll('.statement').forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (r.top < t.bottom && r.bottom > t.top) on = true;   // vertical overlap
    });
    toggle.classList.toggle('on-band', on);
  }
  var toggleBandTick = false;
  function scheduleToggleBand() {
    if (toggleBandTick) return;
    toggleBandTick = true;
    requestAnimationFrame(function () { toggleBandTick = false; updateToggleBand(); });
  }
  function navInvertRebuild() {
    var nav = document.getElementById('nav');
    var darkSections = document.querySelectorAll('.statement');
    if (navInvertIO) { navInvertIO.disconnect(); navInvertIO = null; }

    if (nav) {
      if (!darkSections.length || !('IntersectionObserver' in window)) {
        nav.classList.remove('on-dark');
      } else {
        var navH = nav.offsetHeight || 70;
        var below = Math.max(0, Math.round(window.innerHeight - navH));
        navInvertIO = new IntersectionObserver(function (entries) {
          nav.classList.toggle('on-dark', entries.some(function (e) { return e.isIntersecting; }));
        }, { rootMargin: '0px 0px -' + below + 'px 0px', threshold: 0 });
        darkSections.forEach(function (el) { navInvertIO.observe(el); });
      }
    }
    updateToggleBand();
  }
  window.addEventListener('scroll', scheduleToggleBand, { passive: true });
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
      });
  }

  // ---------- "B-Sides" section (data-driven; independent of GSAP) ----------
  // Rebuilds #versions from data/versions.json. The markup in index.html is
  // the no-JS / fetch-failure fallback; when the JSON loads it's replaced
  // with the CMS-editable rows. One photo => a single Instax card; two or
  // more => .instax-gallery, laid out as centred rows of two (.instax-pair)
  // that overlap slightly; a lone last card is centred, not left-hanging.
  // per-caption colour (matched on the caption text, case-insensitive).
  // Unlisted captions keep the default muted colour. If a caption is
  // renamed in the CMS its entry here needs the same edit.
  var CAPTION_TONE = {
    'the work nobody sees': 'cap-teal',
    'the one who enjoys it the most': 'cap-pink',
    'running 7.5km': 'cap-teal',
    'cycling on victory day': 'cap-pink',
    'my first 15km': 'cap-teal',
    'sleeping among 150+ people': 'cap-pink',
    'forced-to-speak': 'cap-teal',
    'lalakhal, sylhet': 'cap-pink',
    'lama, bandarban': 'cap-teal'
  };
  function versCard(p) {
    // onerror: a dangling image path (e.g. the file was deleted in the CMS
    // but still referenced) degrades to the "add photo" placeholder instead
    // of a broken-image icon — the card keeps its size and the layout holds.
    var inner = p && p.image
      ? '<div class="instax-img"><img src="' + esc(p.image) + '" alt="' +
          esc(p.caption || '') + '" loading="lazy" decoding="async" ' +
          'onerror="var d=this.parentNode;this.remove();if(d)d.setAttribute(\'data-ph\',\'add photo\')"></div>'
      : '<div class="instax-img" data-ph="add photo"></div>';
    var capTone = p && p.caption
      ? (CAPTION_TONE[String(p.caption).trim().toLowerCase()] || '') : '';
    return '<figure class="instax">' + inner +
      (p && p.caption
        ? '<figcaption class="' + capTone + '">' + esc(p.caption) + '</figcaption>'
        : '') +
      '</figure>';
  }
  function versRowHTML(row, i) {
    var photos = (row && row.photos) || [];
    // drop half-filled photo slots (caption but no image); if that empties
    // the row, keep one slot so an unfilled row still shows a placeholder.
    var withImg = photos.filter(function (p) { return p && p.image; });
    var render = withImg.length ? withImg : photos.slice(0, 1);
    var media;
    if (render.length > 1) {
      var pairs = '';
      for (var g = 0; g < render.length; g += 2) {
        pairs += '<div class="instax-pair">' +
          render.slice(g, g + 2).map(versCard).join('') + '</div>';
      }
      media = '<div class="instax-gallery">' + pairs + '</div>';
    } else {
      media = versCard(render[0]);
    }
    // row headings cycle coral -> teal -> pink -> teal down the section
    var tone = ['vr-coral', 'vr-teal', 'vr-pink', 'vr-teal'][i % 4];
    return '<div class="vers-row ' + tone + (row && row.flip ? ' flip' : '') + '" data-anim ' +
        'style="transition-delay:' + (i * 0.06).toFixed(2) + 's">' +
        media +
        '<div class="vers-note"><h3>' + esc(row && row.heading) + '</h3>' +
        paragraphs(row && row.body) +
        '</div>' +   // .vers-note
      '</div>';       // .vers-row
  }
  function renderVersions() {
    var section = document.querySelector('.versions');
    if (!section) return Promise.resolve();
    return fetch('/redesign/data/versions.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (data) {
        var rows = data && data.rows;
        if (!rows || !rows.length) return; // keep the static fallback rows
        if (data.title) {
          var h = document.getElementById('versionsTitle');
          if (h) h.textContent = data.title;
        }
        var count = section.querySelector('.section-head .count');
        if (count && data.subtitle) count.textContent = data.subtitle;

        // Drop the old rows, keep .section-head and .vers-doodads intact.
        [].slice.call(section.querySelectorAll('.vers-row')).forEach(function (el) {
          el.parentNode.removeChild(el);
        });
        section.insertAdjacentHTML('beforeend', rows.map(versRowHTML).join(''));
      });
  }

  // ---------- statement band text (CMS-editable) ----------
  // Optional override: data/statement.json -> { "text": "..." }.
  // The markup in index.html is the no-JS / fetch-failure fallback.
  // Runs before the generic [data-split] pass; when the JSON lands we
  // swap the copy, re-split it into .word spans and rebuild the tween.
  function renderStatement() {
    var el = document.querySelector('.statement-text');
    if (!el) return Promise.resolve();
    return fetch('/redesign/data/statement.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (data) {
        var text = data && typeof data.text === 'string' && data.text.trim();
        if (text) {
          splitStatement(el, text);              // rebuild from the CMS copy
        } else if (!el.querySelector('.word')) {
          splitStatement(el, el.textContent);    // fallback copy, not yet split
        }
        buildStatementFx();         // retarget the scroll tween (no-op without GSAP)
        if (haveGSAP && window.ScrollTrigger) ScrollTrigger.refresh();
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

  /* ---------- theme toggle ----------
     data-theme is set on <html> before first paint by the inline head
     script: light by default, dark only if the visitor previously chose
     it (localStorage). The OS setting is deliberately ignored so every
     first visit lands in light. This just flips the theme, persists the
     choice, and keeps the button label/state and the OS <meta
     theme-color> in sync. Lives outside <main>, wired once. */
  (function wireThemeToggle() {
    var root = document.documentElement;
    var btn = document.getElementById('themeToggle');
    var meta = document.querySelector('meta[name="theme-color"]');
    function paperColour() {
      return getComputedStyle(root).getPropertyValue('--paper').trim() || '#fdfdfd';
    }
    function sync() {
      var dark = root.getAttribute('data-theme') === 'dark';
      if (btn) {
        btn.setAttribute('aria-pressed', dark ? 'true' : 'false');
        btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
      }
      if (meta) meta.setAttribute('content', paperColour());
    }
    sync();
    if (!btn) return;
    btn.addEventListener('click', function () {
      var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('theme', next); } catch (e) {}
      sync();
      // layout metrics ScrollTrigger cached don't change, but a refresh is
      // cheap insurance after a big repaint.
      if (window.ScrollTrigger) window.ScrollTrigger.refresh();
    });
  })();

  /* ---------- click doodles ----------
     A quick hand-drawn line is drawn wherever you click — just the stroke
     writing itself on, a brief hold, then a quiet fade-out. No scale/pop.
     Vanilla, wired once; the host layer is a fixed, pointer-events:none
     sibling of <main>, so it rides over every view and survives client-side
     swaps without re-wiring. Mouse/pen only (a doodle on every touch-tap
     would fight scrolling) and skipped entirely under reduced motion. */
  (function wireClickDoodles() {
    if (reduce) return;
    var NS = 'http://www.w3.org/2000/svg';
    // loose pen strokes in a 0..48 box, roughly centred so a random
    // rotation still reads naturally. Lines only — no rings.
    var MARKS = [
      'M6 27 C15 22 22 30 28 25 S40 21 43 24',   // gentle wave
      'M7 24 C18 23 30 25 41 24',                // near-straight dash
      'M6 30 C14 20 24 34 33 22 S41 26 43 20',   // springy zigzag
      'M8 20 C16 26 24 18 32 26 S40 20 42 27',   // shallow scallop
      'M6 22 C20 21 22 33 34 30 S41 25 43 27'    // hook-tailed streak
    ];
    var host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText =
      'position:fixed;inset:0;pointer-events:none;z-index:140;overflow:hidden';
    document.body.appendChild(host);

    var lastAt = 0, clickN = 0;
    function stamp(x, y) {
      var now = Date.now();
      if (now - lastAt < 55) return;      // ignore frantic double-fires
      lastAt = now;
      while (host.children.length > 22) host.removeChild(host.firstChild);

      var size = 46 + Math.random() * 26;
      var rot = (Math.random() * 60 - 30).toFixed(1);
      var svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 48 48');
      svg.setAttribute('fill', 'none');
      var path = document.createElementNS(NS, 'path');
      path.setAttribute('d', MARKS[(Math.random() * MARKS.length) | 0]);
      path.setAttribute('stroke', 'currentColor');
      path.setAttribute('stroke-width', '3');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(path);
      svg.style.cssText =
        'position:absolute;left:' + (x - size / 2).toFixed(1) + 'px;' +
        'top:' + (y - size / 2).toFixed(1) + 'px;' +
        'width:' + size.toFixed(1) + 'px;height:' + size.toFixed(1) + 'px;' +
        'color:var(' + (clickN++ % 2 ? '--teal' : '--coral') + ');opacity:1;' +  /* alternate green / blue */
        'transform:rotate(' + rot + 'deg);will-change:opacity';
      host.appendChild(svg);

      var len = path.getTotalLength();
      path.style.strokeDasharray = len;
      path.style.strokeDashoffset = len;

      requestAnimationFrame(function () {
        // just the line writing itself on
        path.style.transition = 'stroke-dashoffset .38s cubic-bezier(.3,.7,.2,1)';
        path.style.strokeDashoffset = '0';
      });
      setTimeout(function () {
        // …then it quietly goes
        svg.style.transition = 'opacity .45s ease';
        svg.style.opacity = '0';
        setTimeout(function () { if (svg.parentNode) svg.parentNode.removeChild(svg); }, 470);
      }, 620);
    }

    window.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'touch') return;
      if (e.button && e.button !== 0) return;
      // the hero floaties own the pointerdown gesture for dragging
      if (e.target.closest && e.target.closest('.floatie')) return;
      stamp(e.clientX, e.clientY);
    }, { passive: true });
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
  // The rotating role label must not resize the layout as words cycle, so we
  // reserve the width of the widest role up front and pin .flank-l to it.
  // Re-measured here (inside the resize-driven fitHero path) and on font load.
  var ROTATE_WORDS = [];
  function lockFlankWidth() {
    var rotator = document.querySelector('.flank-l .rotator');
    var textEl = document.querySelector('.flank-l .rotator-text');
    if (!rotator || !textEl) return;
    if (ROTATE_WORDS.length < 2) { rotator.style.minWidth = ''; return; }
    var prev = textEl.textContent, max = 0;
    ROTATE_WORDS.forEach(function (w) {
      textEl.textContent = w;
      max = Math.max(max, textEl.getBoundingClientRect().width);
    });
    textEl.textContent = prev;
    if (max > 0) rotator.style.minWidth = Math.ceil(max + 2) + 'px';
  }

  function equaliseFlanks() {
    var fl = document.querySelector('.flank-l');
    var fr = document.querySelector('.flank-r');
    if (!fl || !fr) return;
    lockFlankWidth();
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

  /* ---------- rotating role label (hero flank) ----------
     Cycles .rotator-text through the comma-separated data-rotate list:
     auto-advances on a timer, advances on click / Enter / Space, pauses on
     hover/focus and while the hero is off-screen. The stitched underline is
     pure CSS (hover / focus-visible only). Idempotent — safe to call again
     after an SPA <main> swap; the previous timer/observer are torn down
     first. Honours prefers-reduced-motion (no auto-advance). */
  var flankRotator = { timer: null, io: null };
  function setupFlankRotator() {
    if (flankRotator.timer) { clearInterval(flankRotator.timer); flankRotator.timer = null; }
    if (flankRotator.io) { flankRotator.io.disconnect(); flankRotator.io = null; }

    var btn = document.querySelector('.flank-l .rotator');
    var word = document.querySelector('.flank-l .rotator-text');
    var hero = document.querySelector('.hero');
    if (!btn || !word) return;

    var list = String(btn.getAttribute('data-rotate') || '')
      .split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (!list.length) list = [word.textContent.trim()];
    ROTATE_WORDS = list;

    var i = 0;
    word.textContent = list[0];               // keep DOM in sync with the list
    lockFlankWidth();                          // reserve width for the widest role
    if (window.__rnrScheduleFit) window.__rnrScheduleFit();

    var INTERVAL = 2800;

    function show(n) {
      i = (n % list.length + list.length) % list.length;
      word.textContent = list[i];
    }
    function advance() { show(i + 1); }

    function start() {
      if (flankRotator.timer || reduce || list.length < 2) return;
      flankRotator.timer = setInterval(advance, INTERVAL);
    }
    function stop() {
      if (flankRotator.timer) { clearInterval(flankRotator.timer); flankRotator.timer = null; }
    }

    btn.addEventListener('click', function () { advance(); stop(); start(); });
    btn.addEventListener('mouseenter', stop);
    btn.addEventListener('mouseleave', start);
    btn.addEventListener('focus', stop);
    btn.addEventListener('blur', start);

    start();

    // Pause the timer while the hero is scrolled off screen (it's faded out
    // by the scroll transform down there anyway) — saves needless work. The
    // observer only ever toggles an already-running/stopped timer; the line
    // above is what actually gets it going on load.
    if (hero && window.IntersectionObserver) {
      flankRotator.io = new IntersectionObserver(function (entries) {
        if (entries[0].isIntersecting) start(); else stop();
      }, { threshold: 0 });
      flankRotator.io.observe(hero);
    }
  }

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

  // Statement band: keep the author's paragraph breaks (blank line = new
  // paragraph). Each paragraph is a block-level .stmt-line wrapping its
  // own .word spans, so the scroll light-up (which targets
  // `.statement-text .word`) still works unchanged.
  function splitStatement(el, text) {
    var paras = String(text || '').trim().split(/\n\s*\n/);
    el.textContent = '';
    paras.forEach(function (p) {
      p = p.trim().replace(/\s+/g, ' ');
      if (!p) return;
      var line = document.createElement('span');
      line.className = 'stmt-line';
      // *asterisks* mark a script-hand accent run; every word inside keeps
      // its own .word span (scroll light-up), plus a .hi class.
      p.split('*').forEach(function (chunk, i) {
        var hi = (i % 2 === 1);
        chunk.split(' ').forEach(function (w) {
          if (!w) return;
          var s = document.createElement('span');
          s.className = hi ? 'word hi' : 'word';
          s.textContent = w;
          line.appendChild(s);
        });
      });
      el.appendChild(line);
    });
  }

  /* ---------- statement band: words light up on scroll ----------
     Split out so renderStatement() can rebuild it after the CMS text
     lands (the .word spans it tweens get recreated). */
  function buildStatementFx() {
    if (!haveGSAP) return;
    if (buildStatementFx._st) { buildStatementFx._st.kill(); buildStatementFx._st = null; }
    var stWords = document.querySelectorAll('.statement-text .word');
    if (!stWords.length) return;
    gsap.set(stWords, { clearProps: 'color' });
    var tween = gsap.to(stWords, {
      color: '#fdfdfd', ease: 'none', stagger: { each: 0.4 },
      // fully lit by the time the scrap reaches the middle of the screen
      scrollTrigger: { trigger: '.statement', start: 'top 68%', end: 'center 58%', scrub: true }
    });
    buildStatementFx._st = tween.scrollTrigger || null;
  }

  /* ---------- scroll-driven GSAP effects (home view only) ---------- */
  function buildHomeScrollFx() {
    buildStatementFx();
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

  /* ---------- "B-Sides" doodads (home view) ----------
     Each row gets 3–5 small line-art doodads themed to that row's text
     (music / touring / running / introversion / photography …), scattered
     ONLY in the side gutters beside the row — never over the note or the
     photos. Rebuilt after renderVersions() and again on resize (positions
     are measured in px). Ambient + pointer-events:none. Skipped without
     GSAP, on narrow layouts, and under reduced motion. */
  function versDoodadArt() {
    function s(vb, body) {
      return '<svg viewBox="0 0 ' + vb + '" fill="none" stroke="currentColor" ' +
        'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + body + '</svg>';
    }
    return {
      // music / backstage
      headphones: s('32 32', '<path d="M5 20v-4a11 11 0 0 1 22 0v4"/><rect x="3" y="19" width="6" height="9" rx="2"/><rect x="23" y="19" width="6" height="9" rx="2"/>'),
      note:  s('32 32', '<path d="M12 24V7l14-3v14"/><circle cx="8" cy="24" r="4"/><circle cx="22" cy="21" r="4"/>'),
      tape:  s('40 28', '<rect x="2" y="2" width="36" height="24" rx="3"/><circle cx="14" cy="14" r="4"/><circle cx="26" cy="14" r="4"/><path d="M12 22h16"/>'),
      plug:  s('26 28', '<path d="M9 2v6M17 2v6M6 8h14v4a7 7 0 0 1-14 0zM13 19v7"/>'),
      spark: s('24 24', '<path d="M12 3v6M12 15v6M3 12h6M15 12h6"/>'),
      // touring / planning
      clipboard: s('28 30', '<rect x="5" y="4" width="18" height="23" rx="2"/><path d="M10 4V2h8v2M9 12h10M9 17h10M9 22h6"/>'),
      pin:   s('28 30', '<path d="M14 27s9-8.5 9-16A9 9 0 0 0 5 11c0 7.5 9 16 9 16z"/><circle cx="14" cy="11" r="3.5"/>'),
      calendar: s('32 32', '<rect x="4" y="6" width="24" height="22" rx="2"/><path d="M4 12h24M11 3v6M21 3v6"/>'),
      tag:   s('32 32', '<path d="M4 4h10l14 14-10 10L4 14z"/><circle cx="10" cy="10" r="2.5"/>'),
      compass: s('32 32', '<circle cx="16" cy="16" r="13"/><path d="M22 10l-4 12-6-6z"/>'),
      // running / cycling
      bike:  s('40 28', '<circle cx="9" cy="20" r="6"/><circle cx="31" cy="20" r="6"/><path d="M9 20l7-11h9l-6 11M16 9h-3M25 9l3 4"/>'),
      shoe:  s('32 26', '<path d="M3 13c4 0 6-4 9-4s3 4 7 5 8 1 8 5v3H3z"/><path d="M3 20h24"/>'),
      stopwatch: s('32 32', '<circle cx="16" cy="18" r="11"/><path d="M16 18v-7M13 3h6M24 8l2-2"/>'),
      mountain: s('32 28', '<path d="M3 25l9-16 6 10 4-6 7 12z"/><path d="M10 14l2 3"/>'),
      pace:  s('30 24', '<path d="M4 6l8 6-8 6M14 6l8 6-8 6"/>'),
      // introvert / extrovert / crowd
      masks: s('30 24', '<path d="M4 5h9v8a4.5 4.5 0 0 1-9 0zM15 5h9v8a4.5 4.5 0 0 1-9 0z"/><path d="M7 8h.01M10 8h.01M18 8h.01M21 8h.01"/>'),
      bubble: s('28 26', '<path d="M4 5h20v13H12l-6 5v-5H4z"/>'),
      crowd: s('30 26', '<circle cx="9" cy="8" r="3"/><circle cx="21" cy="8" r="3"/><path d="M3 23c0-5 3-8 6-8s6 3 6 8M15 23c0-5 3-8 6-8s6 3 6 8"/>'),
      loner: s('24 26', '<circle cx="12" cy="8" r="4.2"/><path d="M4 24c0-6 4-9 8-9s8 3 8 9"/>'),
      battery: s('30 24', '<rect x="3" y="7" width="21" height="12" rx="2"/><path d="M24 11h3v4h-3M7 10v6"/>'),
      // photography / frames
      camera: s('32 30', '<rect x="3" y="8" width="26" height="18" rx="2"/><circle cx="16" cy="17" r="5"/><path d="M10 8l2-3h8l2 3"/>'),
      aperture: s('32 32', '<circle cx="16" cy="16" r="12"/><path d="M6 10l10 6M26 10l-10 6M16 28V16"/>'),
      crop:  s('28 28', '<path d="M8 3v18h18M3 8h18v18"/>'),
      sun:   s('30 30', '<circle cx="15" cy="15" r="5"/><path d="M15 3v3M15 24v3M3 15h3M24 15h3M6 6l2 2M22 22l2 2M24 6l-2 2M6 24l2-2"/>')
    };
  }
  var VERS_THEMES = [
    { test: /music|show|stage|backstage|band|live|gig|sound|visual.*run|artist/i,
      set: ['headphones', 'note', 'tape', 'plug', 'spark'] },
    { test: /plan|tour|budget|proposal|group|organi|logisti|schedul|push everyone|commit/i,
      set: ['clipboard', 'pin', 'calendar', 'tag', 'compass'] },
    { test: /cycl|\brun\b|runn|marathon|\bkm\b|kilomet|mile|ride|riding|pace|endur|dopamine/i,
      set: ['bike', 'shoe', 'stopwatch', 'mountain', 'pace'] },
    { test: /introvert|extrovert|crowd|people|alone|social|dualit|quiet|shy|confidence/i,
      set: ['masks', 'bubble', 'crowd', 'loner', 'battery'] },
    { test: /photo|frame|angle|lens|camera|shoot|picture|third eye|beautiful frame/i,
      set: ['camera', 'aperture', 'crop', 'sun', 'mountain'] }
  ];
  var VERS_GENERIC = ['spark', 'note', 'pin', 'compass', 'sun'];

  function buildVersionsDoodads() {
    var section = document.querySelector('.versions');
    var box = section && section.querySelector('.vers-doodads');
    if (!box || !haveGSAP || reduce) return;

    // tear down a previous build (resize / repeat home visit)
    if (buildVersionsDoodads._tweens) {
      buildVersionsDoodads._tweens.forEach(function (t) { t.kill(); });
    }
    buildVersionsDoodads._tweens = [];
    if (buildVersionsDoodads._st) { buildVersionsDoodads._st.kill(); buildVersionsDoodads._st = null; }
    box.innerHTML = '';

    // narrow screens keep a lighter scatter (1–2 per row, a touch smaller)
    var narrow = matchMedia('(max-width: 820px)').matches;

    var ART = versDoodadArt();
    var secRect = section.getBoundingClientRect();
    var cs = getComputedStyle(section);
    var zoneL = (parseFloat(cs.paddingLeft) || 0) + 4;
    var zoneR = secRect.width - (parseFloat(cs.paddingRight) || 0) - 4;

    function pickSet(row) {
      var h = row.querySelector('h3'), p = row.querySelector('p');
      var t = (h ? h.textContent : '') + ' ' + (p ? p.textContent : '');
      for (var i = 0; i < VERS_THEMES.length; i++) {
        if (VERS_THEMES[i].test.test(t)) return VERS_THEMES[i].set;
      }
      return VERS_GENERIC;
    }
    function rnd(a, b) { return a + Math.random() * (b - a); }

    // rectangles (section-local, inflated) that a doodad must never touch:
    // the prose, the photos, and the section heading.
    var KEEP = 18;
    var avoid = [].slice.call(section.querySelectorAll('.vers-note, .instax, .section-head'))
      .map(function (el) {
        var r = el.getBoundingClientRect();
        return {
          l: r.left - secRect.left - KEEP, r: r.right - secRect.left + KEEP,
          t: r.top - secRect.top - KEEP, b: r.bottom - secRect.top + KEEP
        };
      });
    function isFree(x, y, w) {
      if (x < zoneL || x + w > zoneR || y < 4 || y + w > secRect.height - 4) return false;
      for (var i = 0; i < avoid.length; i++) {
        var a = avoid[i];
        if (x + w > a.l && x < a.r && y + w > a.t && y < a.b) return false;
      }
      // don't stack doodads on each other
      for (var j = 0; j < box.children.length; j++) {
        var c = box.children[j];
        var cx = parseFloat(c.style.left), cy = parseFloat(c.style.top), cw = parseFloat(c.style.width);
        if (x + w > cx - 12 && x < cx + cw + 12 && y + w > cy - 12 && y < cy + cw + 12) return false;
      }
      return true;
    }

    [].slice.call(section.querySelectorAll('.vers-row')).forEach(function (row) {
      var set = pickSet(row);
      var rRect = row.getBoundingClientRect();
      // reach into the gap ABOVE the row (the big row margin) and a little below
      var yLo = Math.max(4, (rRect.top - secRect.top) - 96);
      var yHi = Math.min(secRect.height - 4, (rRect.bottom - secRect.top) + 44);

      var want = narrow ? (1 + Math.floor(Math.random() * 2))   // 1–2
                        : (3 + Math.floor(Math.random() * 3));  // 3–5
      var got = 0, tries = 0;
      while (got < want && tries++ < 500) {
        var w = narrow ? rnd(18, 30) : rnd(24, 44);
        var x = rnd(zoneL, zoneR - w);
        var y = rnd(yLo, Math.max(yLo + 1, yHi - w));
        if (!isFree(x, y, w)) continue;

        var el = document.createElement('div');
        el.className = 'vers-doodad';
        el.style.width = w.toFixed(1) + 'px';
        el.style.left = x.toFixed(1) + 'px';
        el.style.top = y.toFixed(1) + 'px';
        el.innerHTML = ART[set[got % set.length]] || ART.spark;
        box.appendChild(el);

        var rot = rnd(-16, 16);
        gsap.set(el, { rotation: rot });
        // fade in rather than pop (matters if a resize does force a rebuild)
        buildVersionsDoodads._tweens.push(
          gsap.from(el, { autoAlpha: 0, duration: 0.5, ease: 'power1.out', delay: got * 0.05 })
        );
        // gentle drift…
        buildVersionsDoodads._tweens.push(gsap.to(el, {
          x: '+=' + rnd(-7, 7).toFixed(1), y: '+=' + rnd(-9, 9).toFixed(1),
          duration: rnd(4, 8), ease: 'sine.inOut', repeat: -1, yoyo: true
        }));
        // …and a livelier rock on its own slower clock, so it looks alive
        // rather than static. Each doodad gets its own swing, speed and
        // start delay so the cluster never rotates in unison.
        buildVersionsDoodads._tweens.push(gsap.to(el, {
          rotation: rot + (Math.random() < 0.5 ? -1 : 1) * rnd(7, 14),
          duration: rnd(2.6, 5), ease: 'sine.inOut', repeat: -1, yoyo: true,
          delay: rnd(0, 2)
        }));
        got++;
      }
    });

    if (box.children.length) {
      buildVersionsDoodads._st = gsap.to(box.children, {
        yPercent: -14, ease: 'none',
        scrollTrigger: { trigger: '.versions', start: 'top bottom', end: 'bottom top', scrub: true }
      }).scrollTrigger;
    }

    // Rebuild when the section's WIDTH changes — a real layout change (window
    // resize, orientation, font swap). Height-only changes (mobile URL bar
    // sliding away as you scroll, an image settling) must NOT trigger a
    // rebuild: that clears the layer and re-scatters every doodad to fresh
    // random spots, which reads as a jump/flicker mid-scroll. Debounced.
    buildVersionsDoodads._lastW = Math.round(secRect.width);
    if (!buildVersionsDoodads._reflowWired) {
      buildVersionsDoodads._reflowWired = true;
      var vdt;
      var kick = function () {
        clearTimeout(vdt);
        vdt = setTimeout(function () {
          var sec = document.querySelector('.versions');
          if (!sec || !sec.querySelector('.vers-doodads')) return;
          if (Math.abs(sec.getBoundingClientRect().width - buildVersionsDoodads._lastW) < 24) return;
          buildVersionsDoodads();
        }, 260);
      };
      window.addEventListener('resize', kick);
      window.addEventListener('orientationchange', kick);
      if (window.ResizeObserver) {
        buildVersionsDoodads._ro = new ResizeObserver(kick);
      }
    }
    // (re)attach the observer only when the section element itself changes
    // (first build, or a client-side swap gave us a new one) — never on an
    // ordinary rebuild, or observe()'s initial callback would loop.
    if (buildVersionsDoodads._ro && buildVersionsDoodads._roTarget !== section) {
      buildVersionsDoodads._ro.disconnect();
      buildVersionsDoodads._ro.observe(section);
      buildVersionsDoodads._roTarget = section;
    }
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
    // Narrow screens keep a smaller, ambient-only set: fewer objects, no drag
    // (dragging fights the scroll on touch). The parallax already no-ops on
    // touch pointers, so what's left is just the idle bob.
    var narrow = matchMedia('(max-width: 820px)').matches;

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
    var DEFAULT_ITEMS = [
      { type: 'svg', svg: D.laptop,   w: 128, ax: 0.13, ay: 0.30 },
      { type: 'svg', svg: D.monitor,  w: 86,  ax: 0.87, ay: 0.23 },
      { type: 'svg', svg: D.keyboard, w: 124, ax: 0.80, ay: 0.80 },
      { type: 'svg', svg: D.mouse,    w: 56,  ax: 0.20, ay: 0.74 },
      { type: 'svg', svg: D.cursor,   w: 44,  ax: 0.63, ay: 0.18 },
      { type: 'svg', svg: D.notebook, w: 58,  ax: 0.07, ay: 0.58 },
      { type: 'svg', svg: D.wallet,   w: 80,  ax: 0.93, ay: 0.56 },
      { type: 'svg', svg: D.undo,     w: 96,  ax: 0.46, ay: 0.87 },
      { type: 'kao', text: '\\( ^_^ )/', size: 30, ax: 0.50, ay: 0.12 },
      { type: 'kao', text: '{ ˆ-ˆ }',    size: 28, ax: 0.33, ay: 0.65 },
      { type: 'kao', text: '>_<',        size: 30, ax: 0.70, ay: 0.64 },
      { type: 'kao', text: '; )',        size: 30, ax: 0.10, ay: 0.17 }
    ];

    // Optional CMS override: data/floaties.json. Each entry ->
    //   { type:"doodle",  preset:"laptop", x:13, y:30, width:128 }
    //   { type:"image",   src:"/redesign/uploads/x.svg", x:50, y:20, width:90 }
    //   { type:"kaomoji", text:"\\( ^_^ )/", x:50, y:12, size:30 }
    // x / y are percentages across the hero (0–100; 0–1 also accepted).
    // A missing file, empty list, or malformed JSON just keeps DEFAULT_ITEMS.
    function frac(v, dflt) {
      var n = parseFloat(v);
      if (!isFinite(n)) return dflt;
      if (n > 1) n = n / 100;
      return Math.min(1, Math.max(0, n));
    }
    function mapFloatieEntry(e) {
      if (!e || typeof e !== 'object') return null;
      var t = String(e.type || '').toLowerCase();
      var ax = frac(e.x, 0.5), ay = frac(e.y, 0.5);
      if (t === 'image') {
        if (!e.src) return null;
        return { type: 'img', src: String(e.src), w: +e.width || 90, ax: ax, ay: ay };
      }
      if (t === 'kaomoji' || t === 'kao') {
        if (!e.text) return null;
        return { type: 'kao', text: String(e.text), size: +e.size || 28, ax: ax, ay: ay };
      }
      // default: built-in doodle
      var svg = D[String(e.preset || '').toLowerCase()];
      if (!svg) return null;
      return { type: 'svg', svg: svg, w: +e.width || 90, ax: ax, ay: ay };
    }

    var buildToken = (initFloaties._token = (initFloaties._token || 0) + 1);

    return fetch('/redesign/data/floaties.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (data) {
        // a newer initFloaties() call started while we were fetching — stand down
        if (initFloaties._token !== buildToken) return;
        layer.innerHTML = '';

        var custom = data && Array.isArray(data.items)
          ? data.items.map(mapFloatieEntry).filter(Boolean)
          : [];
        var ITEMS = custom.length ? custom : DEFAULT_ITEMS;

        buildFloaties(ITEMS);
      });

    function buildFloaties(ITEMS) {
    // trim to a light spread on narrow screens
    if (narrow && ITEMS.length > 5) {
      ITEMS = ITEMS.filter(function (_, i) { return i % Math.ceil(ITEMS.length / 5) === 0; });
    }
    var objs = [];

    // narrow screens get a noticeably smaller, quieter set behind the name
    var SIZE = narrow ? 0.58 : 1;
    function build(cfg) {
      var el = document.createElement('div');
      el.className = 'floatie is-' + cfg.type;
      var inner = document.createElement('div');
      inner.className = 'floatie-in';
      if (cfg.type === 'img') {
        el.style.width = (cfg.w * SIZE) + 'px';
        var img = new Image();
        img.src = cfg.src; img.alt = ''; img.draggable = false;
        img.onerror = function () { el.remove(); objs = objs.filter(function (o) { return o.el !== el; }); };
        inner.appendChild(img);
      } else if (cfg.type === 'svg') {
        el.style.width = (cfg.w * SIZE) + 'px';
        inner.innerHTML = cfg.svg;
      } else {
        inner.style.fontSize = ((cfg.size || 26) * SIZE) + 'px';
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

    // idle life: a slow x/y drift + a STEPPED rotation on every object so it
    // ticks between poses (stop-motion feel) instead of gliding. Each gets
    // its own step count (2 or 3), swing (small or a bit wider), speed and
    // pause, so no two tick together.
    function bob(o) {
      if (o.drift) o.drift.kill();
      if (o.spin) o.spin.kill();
      gsap.set(o.inner, { rotation: o.rot });
      o.drift = gsap.to(o.inner, {
        x: rand(-10, 10), y: rand(-14, 14),
        duration: rand(4.5, 8), ease: 'sine.inOut', repeat: -1, yoyo: true
      });
      var steps = Math.random() < 0.5 ? 2 : 3;
      var swing = rand(3, 13) * (Math.random() < 0.5 ? -1 : 1);
      o.spin = gsap.to(o.inner, {
        rotation: o.rot + swing,
        duration: rand(0.7, 1.9), ease: 'steps(' + steps + ')',
        repeat: -1, yoyo: true, repeatDelay: rand(0, 1.3)
      });
    }

    ITEMS.forEach(function (cfg) {
      var made = build(cfg);
      var o = {
        cfg: cfg, el: made.el, inner: made.inner, drift: null, spin: null,
        rot: cfg.type === 'kao' ? rand(-8, 8) : rand(-14, 14),
        depth: cfg.type === 'kao' ? rand(0.5, 0.9) : rand(0.5, 1.3)
      };
      place(o);
      objs.push(o);
    });

    // idle motion starts immediately; the entrance fade runs independently
    // on the outer node (autoAlpha) and never touches the inner bob.
    objs.forEach(bob);
    gsap.from(layer.children, { autoAlpha: 0, duration: 0.6, stagger: 0.05, delay: 0.2 });

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
    // skipped on narrow screens — a drag gesture there just eats the scroll
    initFloaties._top = 2;
    if (!narrow) objs.forEach(function (o) {
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
    } // buildFloaties
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
      document.querySelectorAll('[data-split="words"]:not(.statement-text)').forEach(function (el) {
        if (!el.querySelector('.word')) splitWords(el);
      });
      renderStatement();
      renderWorkGrid();
      renderVersions().then(function () {
        // the real rows exist now — reveal them and build their doodads
        // against the actual laid-out geometry (not the static fallback).
        revealObserverInit();
        if (haveGSAP) buildVersionsDoodads();
        if (haveGSAP && window.ScrollTrigger) ScrollTrigger.refresh();
      });
      buildMarquee();
      setupFlankRotator();
      fitHero();
      if (window.__rnrApplyHeroScroll) window.__rnrApplyHeroScroll();
      if (heroResizeObserver) heroResizeObserver.disconnect();
      if (window.ResizeObserver) {
        var hero = document.querySelector('.hero');
        if (hero) { heroResizeObserver = new ResizeObserver(function () { fitHero(); }); heroResizeObserver.observe(hero); }
      }
      // buildVersionsDoodads() runs in the renderVersions().then() above,
      // once the real rows are in the DOM and laid out.
      if (haveGSAP) { wireMagnetic(); buildHomeScrollFx(); initFloaties(); }
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
    document.querySelectorAll('.statement-text .word').forEach(function (w) { w.style.color = '#fdfdfd'; });
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
