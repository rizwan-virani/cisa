/* ============================================================================
   CISA  ::  flashEngine.js  —  Rapid Recall Flashcards
   Active-recall flashcards with a Leitner spaced-repetition scheduler.

   - Cards live in lazy-loaded per-domain modules (assets/js/content/flashN.js),
     each populating CISA.flash[N] with 100 cards { id, d, t, obj, front, back }.
   - Scheduling state persists to localStorage (cisa.flash.v1) keyed by card id,
     so the same acronym studied in its domain deck and in the Master Acronym Drill
     shares one memory.
   - Five Leitner boxes; correct answers promote a card to a longer interval,
     misses send it back to box 1. Due cards resurface; the rest stay out of the way.

   Exposes window.FLASH for the dashboard. Resolves window.APP lazily (loads after).
   By Professor Rizwan Virani.
   ========================================================================== */
(function () {
  "use strict";

  var S = window.CISA;
  var A, el;
  function ready() { A = window.APP; el = A.el; }

  var DECK_SIZE = 100;
  var SESSION_NEW = 20;      // new cards introduced per review session
  var SESSION_CAP = 40;      // max cards per review session
  var DAY = 86400000;
  var BOX_DAYS = [0, 0, 1, 3, 7, 16]; // interval per box (index 1..5); box 1 = same day (5 Leitner boxes, NOT domains)

  /* Domain id list derived from the single source of truth so this engine works
     for any domain count (CISA has 6). Never hardcode 5 / 500 / [1..5] here. */
  function DOMS() { return (S.domainMeta || []).map(function (d) { return d.id; }); }
  function TOTAL_CARDS() { return DOMS().length * DECK_SIZE; }

  function ver() { return window.CISA_VER ? "?v=" + window.CISA_VER : ""; }
  function now() { return Date.now(); }
  function shuffle(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

  /* ---- Leitner store (localStorage via APP.store; APP is global by use time) ---- */
  function store() { return window.APP.store.get("flash.v1", {}) || {}; }
  function saveStore(o) { window.APP.store.set("flash.v1", o); }
  function isDue(s) { return !s || s.due <= now(); }
  function grade(st, id, g) {
    var s = st[id] || { box: 1, reps: 0, lapses: 0, due: 0 };
    s.reps = (s.reps || 0) + 1; s.last = now();
    if (g === 1) { s.box = 1; s.lapses = (s.lapses || 0) + 1; s.due = now(); }              // Missed → relearn
    else if (g === 2) { s.box = Math.max(1, s.box); s.due = now() + BOX_DAYS[s.box] * DAY; } // Almost → hold box
    else { s.box = Math.min(5, (s.box || 1) + 1); s.due = now() + BOX_DAYS[s.box] * DAY; }   // Got it → promote
    st[id] = s; return s;
  }

  /* ---- lazy module loading ---- */
  function loadModule(n, cb) {
    if (S.flash && S.flash[n] && S.flash[n].length) { cb(); return; }
    var sc = document.createElement("script");
    sc.src = "assets/js/content/flash" + n + ".js" + ver();
    sc.async = true;
    sc.onload = function () { (S.flash && S.flash[n] && S.flash[n].length) ? cb() : cb(new Error("empty")); };
    sc.onerror = function () { cb(new Error("load")); };
    document.head.appendChild(sc);
  }
  function loadAll(cb) {
    var need = DOMS().filter(function (n) { return !(S.flash && S.flash[n] && S.flash[n].length); });
    if (!need.length) { cb(); return; }
    var done = 0, err = null;
    need.forEach(function (n) { loadModule(n, function (e) { if (e) err = e; if (++done === need.length) cb(err); }); });
  }
  function loadingView(title, domains, cb) {
    A.open({
      tag: "Flashcards", render: function (host) {
        host.appendChild(A.crumb(title));
        host.appendChild(el("div.phead", null, [el("h1", { text: title }), el("span.sub", { text: "Loading cards…" })]));
        host.appendChild(el("div.empty", { html: "<span class='hud' style='color:var(--cyan)'>▰▰▰</span> Loading flashcards…" }));
      }
    });
    var loader = domains === "all" ? loadAll : function (done) { loadModule(domains, done); };
    loader(function (e) { if (e) { A.toast("Could not load flashcards. Check your connection."); } else { cb(); } });
  }

  /* ---- card-set helpers ---- */
  function masterAcronyms() {
    var seen = {}, out = [];
    DOMS().forEach(function (n) {
      (S.flash[n] || []).forEach(function (c) {
        if (c.t === "acronym") { var k = c.front.toUpperCase(); if (!seen[k]) { seen[k] = 1; out.push(c); } }
      });
    });
    return out;
  }
  function allCards() { var out = []; DOMS().forEach(function (n) { out = out.concat(S.flash[n] || []); }); return out; }

  function tally(cards, st) {
    var t = { total: cards.length, fresh: 0, dueSeen: 0, learning: 0, known: 0 };
    cards.forEach(function (c) {
      var s = st[c.id];
      if (!s) { t.fresh++; return; }
      if (s.due <= now()) t.dueSeen++;
      if (s.box >= 4) t.known++; else t.learning++;
    });
    t.due = t.fresh + t.dueSeen;
    return t;
  }

  function kpi(v, k, mod) { return el("div.kpi" + (mod ? "." + mod : ""), null, [el("div.v", { text: String(v) }), el("div.k", { text: k })]); }

  /* ===========================================================================
     DECK INTRO  (stats + mode selection)
     =========================================================================== */
  function deckIntro(opts) {
    var cards = opts.cards;
    var st = store();
    var t = tally(cards, st);
    var hasAcr = !opts.acronymsOnly && cards.some(function (c) { return c.t === "acronym"; });

    A.replace({
      tag: "Flashcards · " + opts.short, render: function (host) {
        host.appendChild(A.crumb(opts.title, { onBack: function () { A.dashboard(); A.renderDashboard(); } }));
        host.appendChild(el("div.phead", null, [el("h1", { text: opts.title }), el("span.sub", { text: cards.length + " cards · Leitner spaced repetition" })]));

        host.appendChild(el("div.kpis", null, [
          kpi(t.due, "Due now", t.due ? "cyan" : ""),
          kpi(t.fresh, "New", ""),
          kpi(t.learning, "Learning", t.learning ? "warn" : ""),
          kpi(t.known, "Known", t.known ? "good" : "")
        ]));

        host.appendChild(el("div.btnrow", { style: "margin-top:20px" }, [
          el("button.btn.primary", { text: t.due ? "Start review (" + Math.min(SESSION_CAP, t.due) + ")" : "All caught up — review anyway", onclick: function () { startSession(opts, "review", null); } }),
          el("button.btn", { text: "Cram all " + cards.length, onclick: function () { startSession(opts, "cram", null); } }),
          hasAcr ? el("button.btn.ghost", { text: "Acronyms only", onclick: function () { startSession(opts, "review", function (c) { return c.t === "acronym"; }); } }) : null
        ]));

        host.appendChild(el("div.callout-box", { html:
          "<b>How spaced repetition works:</b> grade each card honestly — <em>Missed</em> sends it back to box 1 to relearn, " +
          "<em>Almost</em> holds it, and <em>Got it</em> promotes it to a longer interval (1 → 3 → 7 → 16 days). " +
          "Cards you know drop out of rotation; cards you miss come back soon. <em>Cram</em> flips through every card without affecting your schedule." }));

        host.appendChild(A.backBar());
      }
    });
  }

  /* ===========================================================================
     STUDY SESSION
     =========================================================================== */
  function startSession(opts, mode, filter) {
    var st = store();
    var pool = filter ? opts.cards.filter(filter) : opts.cards.slice();
    var queue;
    if (mode === "cram") {
      queue = shuffle(pool);
    } else {
      var dueSeen = pool.filter(function (c) { return st[c.id] && st[c.id].due <= now(); });
      var fresh = pool.filter(function (c) { return !st[c.id]; });
      queue = shuffle(dueSeen).concat(shuffle(fresh).slice(0, SESSION_NEW)).slice(0, SESSION_CAP);
      if (!queue.length) queue = shuffle(pool).slice(0, SESSION_CAP); // "review anyway" when nothing due
    }
    if (!queue.length) { A.toast("No cards to study."); return; }

    var idx = 0, flipped = false;
    var res = { again: 0, almost: 0, got: 0 };

    A.open({
      tag: "Flashcards · " + opts.short, render: function (host) {
        host.appendChild(A.crumb(opts.title, { onBack: function () { deckIntro(opts); } }));
        host.appendChild(el("div.phead", null, [el("h1", { text: opts.title }), el("span.sub", { text: mode === "cram" ? "Cram mode — not scheduled" : "Review — spaced repetition" })]));
        var pane = el("div#flashpane");
        host.appendChild(pane);
        draw(pane);

        // keyboard: space = flip, 1/2/3 = grade, arrows for cram
        var onKey = function (e) {
          if (!document.body.contains(pane)) { document.removeEventListener("keydown", onKey); return; }
          if (e.key === " " || e.key === "Enter") { e.preventDefault(); flipped = !flipped; draw(pane); }
          else if (mode !== "cram" && flipped && (e.key === "1" || e.key === "2" || e.key === "3")) { e.preventDefault(); answer(pane, parseInt(e.key, 10)); }
          else if (mode === "cram" && (e.key === "ArrowRight")) { e.preventDefault(); next(pane); }
          else if (mode === "cram" && e.key === "ArrowLeft" && idx > 0) { e.preventDefault(); idx--; flipped = false; draw(pane); }
        };
        document.addEventListener("keydown", onKey);
      }
    });

    function draw(pane) {
      if (idx >= queue.length) { summary(pane); return; }
      pane.innerHTML = "";
      var c = queue[idx];
      var wrap = el("div.flashwrap");

      var bar = el("div.qmeta", null, [
        el("div.progressbar", null, el("i", { style: "width:" + (idx / queue.length * 100) + "%" })),
        el("div.qcount", { text: (idx + 1) + " / " + queue.length })
      ]);
      wrap.appendChild(bar);

      var card = el("div.flashcard" + (flipped ? ".flipped" : ""), { onclick: function () { flipped = !flipped; draw(pane); } });
      var inner = el("div.inner");
      inner.appendChild(el("div.face.front", null, [
        el("span.ftype." + (c.t === "acronym" ? "acr" : "trm"), { text: c.t === "acronym" ? "ACRONYM" : "TERM" }),
        el("div.fmain", { html: c.front }),
        el("div.fhintnote", { text: "click or press Space to flip" })
      ]));
      inner.appendChild(el("div.face.back", null, [
        el("span.fobj", { text: "D" + c.d + " · obj " + c.obj }),
        el("div.fback", { html: c.back })
      ]));
      card.appendChild(inner);
      wrap.appendChild(card);

      if (mode === "cram") {
        wrap.appendChild(el("div.qnav", null, [
          el("button.btn.ghost", { text: "← Prev", disabled: idx === 0 ? "disabled" : null, onclick: function () { if (idx > 0) { idx--; flipped = false; draw(pane); } } }),
          el("button.btn.primary", { text: idx === queue.length - 1 ? "Finish" : "Next →", onclick: function () { next(pane); } })
        ]));
      } else if (!flipped) {
        wrap.appendChild(el("div.flashgrade", null, [el("button.btn.primary.wide", { text: "Show answer", onclick: function () { flipped = true; draw(pane); } })]));
      } else {
        wrap.appendChild(el("div.flashgrade", null, [
          el("button.gradebtn.miss", { html: "<b>Missed</b><span>relearn · 1</span>", onclick: function () { answer(pane, 1); } }),
          el("button.gradebtn.almost", { html: "<b>Almost</b><span>hold · 2</span>", onclick: function () { answer(pane, 2); } }),
          el("button.gradebtn.got", { html: "<b>Got it</b><span>promote · 3</span>", onclick: function () { answer(pane, 3); } })
        ]));
      }
      pane.appendChild(wrap);
    }

    function answer(pane, g) {
      var st2 = store();
      grade(st2, queue[idx].id, g);
      saveStore(st2);
      if (g === 1) res.again++; else if (g === 2) res.almost++; else res.got++;
      idx++; flipped = false; draw(pane);
    }
    function next(pane) { idx++; flipped = false; draw(pane); }

    function summary(pane) {
      pane.innerHTML = "";
      var box = el("div.results");
      var total = res.again + res.almost + res.got;
      var hero = el("div.scorehero");
      hero.appendChild(el("div.verdict.pass", { text: mode === "cram" ? "Deck complete" : "Session complete" }));
      if (mode !== "cram") {
        hero.appendChild(el("div.scaled", { html: "<b style='color:var(--ink)'>" + total + "</b> cards reviewed" }));
        hero.appendChild(el("div.kpis", { style: "margin-top:16px" }, [
          kpi(res.got, "Got it", "good"), kpi(res.almost, "Almost", "warn"), kpi(res.again, "Missed", res.again ? "crit" : "")
        ]));
      } else {
        hero.appendChild(el("div.scaled", { text: queue.length + " cards flipped" }));
      }
      box.appendChild(hero);
      box.appendChild(el("div.btnrow", { style: "justify-content:center;margin-top:18px" }, [
        el("button.btn.primary", { text: "Back to deck", onclick: function () { deckIntro(opts); } }),
        el("button.btn", { text: "Study again", onclick: function () { startSession(opts, mode, filter); } }),
        el("button.btn.ghost", { text: "Dashboard", onclick: function () { A.dashboard(); A.renderDashboard(); } })
      ]));
      pane.appendChild(box);
    }
  }

  /* ===========================================================================
     PUBLIC ENTRY POINTS
     =========================================================================== */
  function openDeck(n) {
    ready();
    var meta = A.domainMeta(n);
    loadingView("Domain " + n + " Flashcards", n, function () {
      deckIntro({ short: "Domain " + n, title: "Domain " + n + " — " + meta.title, color: "d" + n, cards: (S.flash[n] || []).slice() });
    });
  }
  function openMaster() {
    ready();
    loadingView("Master Acronym Drill", "all", function () {
      deckIntro({ short: "Acronyms", title: "Master Acronym Drill", color: "d1", acronymsOnly: true, cards: masterAcronyms() });
    });
  }
  function openDueAll() {
    ready();
    loadingView("All Due Today", "all", function () {
      deckIntro({ short: "All due", title: "All Domains — Due Today", color: "d4", cards: allCards() });
    });
  }

  window.FLASH = {
    DECK_SIZE: DECK_SIZE,
    domainDue: function (n) {
      var st = store(), notDue = 0;
      for (var id in st) { if (id.indexOf("F" + n + "-") === 0 && st[id].due > now()) notDue++; }
      return DECK_SIZE - notDue; // unseen + due
    },
    allDue: function () {
      var st = store(), notDue = 0;
      for (var id in st) { if (/^F\d+-/.test(id) && st[id].due > now()) notDue++; }
      return TOTAL_CARDS() - notDue;
    },
    masterAcronymCount: function () { return (S.flash && DOMS().every(function (n) { return S.flash[n]; })) ? masterAcronyms().length : null; },
    /* Aggregate recall stats from the Leitner schedule alone (no card data
       needed). "Mastered" = box 4-5 (7-16 day intervals); recall accuracy is the
       lifetime share of reviews that were not a lapse. */
    analytics: function () {
      var st = store();
      var self = this;
      var agg = { total: TOTAL_CARDS(), studied: 0, mastered: 0, learning: 0, reps: 0, lapses: 0 };
      var byD = {}; DOMS().forEach(function (n) { byD[n] = { total: DECK_SIZE, studied: 0, mastered: 0, due: self.domainDue(n) }; });
      for (var id in st) {
        var m = /^F(\d+)-/.exec(id); if (!m) continue;
        var d = +m[1], s = st[id], mastered = (s.box || 1) >= 4;
        agg.studied++; agg.reps += s.reps || 0; agg.lapses += s.lapses || 0;
        if (mastered) agg.mastered++; else agg.learning++;
        if (byD[d]) { byD[d].studied++; if (mastered) byD[d].mastered++; }
      }
      agg.due = this.allDue();
      agg.accuracy = agg.reps ? Math.round((agg.reps - agg.lapses) / agg.reps * 100) : null;
      agg.byDomain = byD;
      return agg;
    },
    openDeck: openDeck, openMaster: openMaster, openDueAll: openDueAll
  };
})();
