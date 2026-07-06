/* ============================================================================
   CISA  ::  app.js
   Primary router, theme manager, analytics store, dashboard renderer, and the
   textbook reading interface.

   Architecture
   ------------
   - contentData.js loads first and defines the global `CISA` namespace with
     exam facts and per-domain metadata. The dense per-domain reading content is
     split into lazy-loaded modules under assets/js/content/domainN.js, fetched
     on demand by openDomain() the first time a Domain Study card is opened.
   - the question bank (content/quiz1..5.js), the PBQ database (content/pbqs.js), and the
     the assessment engines, exposing `window.QUIZ`.
   - app.js (this file) wires everything together: it renders the dashboard
     cards, runs a hash-free view router that swaps the main view in and out of
     a single #view container, manages the light/dark theme, persists analytics
     to localStorage, and exposes a small `window.APP` surface the engine calls
     for navigation, toasts, confirms, and history.

   By Professor Rizwan Virani.
   ========================================================================== */
(function () {
  "use strict";

  var S = window.CISA || {};
  var EX = (S && S.exam) || {};            // single source of truth for exam figures
  var PASS = EX.passing;                    // passing scaled score (from CISA.exam)
  var SCALE_HI = EX.scaleHigh;              // top of the scaled-score band
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var dash = $("#dashboard");
  var view = $("#view");
  var cardsHost = $("#cards");
  var pageTag = $("#pageTag");

  /* ---------------------------------------------------------------------------
     Small DOM helper. el('div.foo#bar', {attr}, [children|string])
     --------------------------------------------------------------------------- */
  function el(spec, attrs, kids) {
    var m = spec.match(/^([a-z0-9]+)/i);
    var tag = m ? m[1] : "div";
    var node = document.createElement(tag);
    var idm = spec.match(/#([\w-]+)/); if (idm) node.id = idm[1];
    var cls = (spec.match(/\.([\w-]+)/g) || []).map(function (c) { return c.slice(1); });
    if (cls.length) node.className = cls.join(" ");
    if (attrs) for (var k in attrs) {
      if (k === "html") node.innerHTML = attrs[k];
      else if (k === "text") node.textContent = attrs[k];
      else if (k.slice(0, 2) === "on" && typeof attrs[k] === "function") node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null && attrs[k] !== false) node.setAttribute(k, attrs[k]);
    }
    if (kids != null) (Array.isArray(kids) ? kids : [kids]).forEach(function (c) {
      if (c == null) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ===========================================================================
     THEME MANAGER  (mirrors the SOC Range model exactly: data-theme on <html>)
     =========================================================================== */
  var Theme = (function () {
    var KEY = "cisa.theme";
    function current() { return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark"; }
    function apply(t) {
      if (t === "light") document.documentElement.setAttribute("data-theme", "light");
      else document.documentElement.removeAttribute("data-theme");
    }
    var saved = null; try { saved = localStorage.getItem(KEY); } catch (e) {}
    apply(saved === "light" ? "light" : "dark");
    function build() {
      var b = el("button.theme-fab#themeFab", { type: "button", "aria-label": "Toggle light or dark theme" });
      function label() { b.textContent = current() === "light" ? "◑ Dark" : "◐ Light"; }
      label();
      b.addEventListener("click", function () {
        var next = current() === "light" ? "dark" : "light";
        apply(next); try { localStorage.setItem(KEY, next); } catch (e) {} label();
      });
      document.body.appendChild(b);
    }
    return { build: build };
  })();

  /* ===========================================================================
     ANALYTICS STORE  (localStorage: history, in-progress, reading bookmarks)
     =========================================================================== */
  var Store = (function () {
    var HKEY = "cisa.history.v1";
    var read = function (k, fb) { try { return JSON.parse(localStorage.getItem(k)) || fb; } catch (e) { return fb; } };
    var write = function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
    return {
      history: function () { return read(HKEY, []); },
      record: function (rec) {
        var h = read(HKEY, []);
        rec.ts = Date.now();
        h.unshift(rec);
        if (h.length > 200) h = h.slice(0, 200);
        write(HKEY, h);
        return rec;
      },
      clear: function () { write(HKEY, []); },
      // generic per-key persistence used by the mock-resume feature
      get: function (k, fb) { return read("cisa." + k, fb); },
      set: function (k, v) { write("cisa." + k, v); },
      del: function (k) { try { localStorage.removeItem("cisa." + k); } catch (e) {} }
    };
  })();

  /* ===========================================================================
     TOAST + CONFIRM
     =========================================================================== */
  var toastTimer = null;
  function toast(msg) {
    var t = $("#toast"); if (!t) { t = el("div.toast#toast"); document.body.appendChild(t); }
    t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2600);
  }
  function confirmDialog(title, body, okLabel, onOk) {
    var box = el("div.box", null, [
      el("h3", { text: title }),
      el("p", { text: body }),
      el("div.btnrow", null, [
        el("button.btn.ghost", { text: "Cancel", onclick: close }),
        el("button.btn.primary", { text: okLabel || "Confirm", onclick: function () { close(); onOk && onOk(); } })
      ])
    ]);
    var modal = el("div.modal.show", null, box);
    function close() { modal.remove(); }
    modal.addEventListener("click", function (e) { if (e.target === modal) close(); });
    document.body.appendChild(modal);
  }

  /* ===========================================================================
     ROUTER  ::  dashboard  <->  workspace view
     A view is { tag, render(host) }. We keep it intentionally simple: one slot.
     =========================================================================== */
  var Router = (function () {
    var stack = [];
    function setTag(t) { if (pageTag) pageTag.textContent = (t || "DASHBOARD").toUpperCase(); }
    /* Render whatever is on top of the stack, or the dashboard when the stack is empty. */
    function paint() {
      if (!stack.length) {
        view.hidden = true; view.innerHTML = "";
        dash.hidden = false; setTag("DASHBOARD");
      } else {
        var v = stack[stack.length - 1];
        dash.hidden = true; view.hidden = false; view.innerHTML = "";
        setTag(v.tag || "WORKSPACE");
        v.render(view);
      }
      window.scrollTo({ top: 0, behavior: "auto" });
    }
    function open(viewObj) {
      stack.push(viewObj);
      /* Push a history entry so the hardware Back button unwinds INTO the app
         instead of leaving the site. The state carries our stack depth. */
      try { history.pushState({ appDepth: stack.length }, ""); } catch (e) {}
      paint();
    }
    /* Swap the current top view in place WITHOUT pushing a new history entry, so a
       lazy "Loading…" placeholder and the content that replaces it share ONE history
       entry. Without this, a lazily-loaded card (domain readers, flashcard decks)
       pushes two entries for one open, and the hardware Back button lands on the
       stale loader instead of returning to the dashboard. Falls back to open() when
       nothing is on the stack yet. */
    function replace(viewObj) {
      if (!stack.length) { open(viewObj); return; }
      stack[stack.length - 1] = viewObj;
      paint();
    }
    function showDashboard() {
      /* Unwind the entries we pushed so the hardware Back button and the in-app
         "Back to Dashboard" buttons stay in sync; popstate then repaints. */
      var n = stack.length;
      stack = [];
      if (n > 0) { try { history.go(-n); return; } catch (e) {} }
      paint();
    }
    /* Hardware Back/Forward: trim to the depth encoded in the state (0 = dashboard)
       and repaint, keeping navigation INSIDE the app instead of exiting the site. */
    window.addEventListener("popstate", function (e) {
      var depth = (e.state && e.state.appDepth) || 0;
      if (depth < stack.length) stack = stack.slice(0, depth);
      paint();
    });
    return { showDashboard: showDashboard, open: open, replace: replace, setTag: setTag };
  })();

  /* Breadcrumb back-to-dashboard bar used at the top of every workspace. */
  function crumb(label, opts) {
    opts = opts || {};
    return el("div.crumb", null, [
      el("button.back", { text: "Back to Dashboard", onclick: function () { if (opts.onBack) opts.onBack(); else Router.showDashboard(); } }),
      el("span.where", { text: label })
    ]);
  }

  /* Prominent bottom bar so readers don't have to scroll back to the top to
     return to the dashboard. */
  function backBar(opts) {
    opts = opts || {};
    return el("div.backbar", null, [
      el("button.back.big", { text: "Back to Dashboard", onclick: function () { if (opts.onBack) opts.onBack(); else { Router.showDashboard(); } } }),
      el("button.btn.ghost.totop", { text: "Back to top ↑", onclick: function () { window.scrollTo({ top: 0, behavior: "smooth" }); } })
    ]);
  }

  /* ===========================================================================
     PUBLIC SURFACE used by quizEngine.js
     =========================================================================== */
  window.APP = {
    el: el, esc: esc, toast: toast, confirm: confirmDialog, crumb: crumb, backBar: backBar,
    open: Router.open, replace: Router.replace, dashboard: Router.showDashboard, store: Store,
    domainMeta: function (id) { return (S.domainMeta || []).filter(function (d) { return d.id === id; })[0]; },
    domainColor: function (id) { return "d" + id; }
  };

  /* ===========================================================================
     DASHBOARD CARDS  (5 card groups, all data-driven)
     =========================================================================== */
  function statCard() {
    var h = Store.history();
    var quizzes = h.filter(function (r) { return r.mode !== "pbq"; });
    var best = 0, mocks = h.filter(function (r) { return r.mode === "mock"; });
    mocks.forEach(function (m) { if (m.scaled > best) best = m.scaled; });
    var avg = quizzes.length ? Math.round(quizzes.reduce(function (a, r) { return a + (r.pct || 0); }, 0) / quizzes.length) : 0;
    var pbqDone = (Store.get("pbqDone", []) || []).length;
    var flash = window.FLASH ? FLASH.analytics() : null;
    return el("div.kpis", null, [
      kpi(h.length, "Sessions logged", "cyan"),
      kpi(quizzes.length ? avg + "%" : "—", "Avg quiz score", avg >= 80 ? "good" : avg >= 60 ? "warn" : (quizzes.length ? "crit" : "")),
      kpi(mocks.length ? best : "—", "Best mock (scaled)", best >= PASS ? "good" : (mocks.length ? "warn" : "")),
      kpi(pbqDone + "/" + (S.pbqs ? S.pbqs.length : 30), "PBQs completed", ""),
      flash ? kpi(flash.mastered + "/" + flash.total, "Cards mastered", flash.mastered >= 250 ? "good" : (flash.mastered ? "warn" : "")) : null
    ]);
  }
  function kpi(v, k, mod) { return el("div.kpi" + (mod ? "." + mod : ""), null, [el("div.v", { text: String(v) }), el("div.k", { text: k })]); }

  function card(opts) {
    var c = el("button.card" + (opts.cls ? "." + opts.cls : ""), { type: "button", onclick: opts.onClick });
    var top = el("div.kome", null, [
      el("span.ico", { text: opts.icon || "▣" }),
      opts.tag ? el("span.tag" + (opts.tagCls ? "." + opts.tagCls : ""), { text: opts.tag }) : null
    ]);
    c.appendChild(top);
    c.appendChild(el("h3", { text: opts.title }));
    c.appendChild(el("div.desc", { html: opts.desc }));
    if (opts.foot) c.appendChild(el("div.foot", null, [
      el("span", { text: opts.foot }),
      el("span.go", { text: (opts.cta || "Open") + " →" })
    ]));
    return c;
  }

  /* ===========================================================================
     COLLAPSIBLE DASHBOARD SECTIONS  (multi-open, state remembered per browser)
     Each section is an independent collapsible panel; the header always shows a
     count summary so collapsing never hides WHAT is there, only the cards. The
     "00 Your progress" panel is pinned open. Default on first visit: collapsed.
     =========================================================================== */
  var DASH_KEY = "dash.v3"; // v2: reset any stale saved layout so the expanded default applies
  var DASH_DEFAULT_OPEN = true; // sections start expanded; users can collapse and the choice sticks
  function dashState() { return Store.get(DASH_KEY, {}) || {}; }
  function sectionOpen(num) { var st = dashState(); return (num in st) ? !!st[num] : DASH_DEFAULT_OPEN; }
  function setSectionOpen(num, open) { var st = dashState(); st[num] = open; Store.set(DASH_KEY, st); }

  /* Required browser-optimization notice, injected directly above the
     interactive launch controls in the PBQ (06) and Labs (07) sections. */
  function dashSection(num, title, summary, opts) {
    opts = opts || {};
    var pinned = !!opts.pinned;
    var open = pinned ? true : sectionOpen(num);
    var panel = el("div.dpanel" + (open ? ".open" : "") + (pinned ? ".pinned" : ""));
    var head = el("button.dpanel-head", { type: "button", "aria-expanded": open ? "true" : "false" }, [
      el("span.dnum", { text: num }),
      el("span.dtitle", { text: title }),
      el("span.dsummary", summary ? { html: summary } : null),
      pinned ? el("span.dpinned", { text: "PINNED" }) : el("span.dchev", { html: "›" })
    ]);
    if (!pinned) head.addEventListener("click", function () {
      var nowOpen = !panel.classList.contains("open");
      panel.classList.toggle("open", nowOpen);
      head.setAttribute("aria-expanded", nowOpen ? "true" : "false");
      setSectionOpen(num, nowOpen);
    });
    /* body(grid 0fr) > inner(overflow:hidden) > pad(padding+content). Padding
       lives on `pad` INSIDE the clipped inner, so a collapsed section hides
       completely with no readable sliver. */
    var pad = el("div.dpanel-pad");
    var inner = el("div.dpanel-inner", null, pad);
    panel.appendChild(head);
    panel.appendChild(el("div.dpanel-body", null, inner));
    cardsHost.appendChild(panel);
    return pad;
  }
  function dashToolbar() {
    function setAll(open) {
      cardsHost.querySelectorAll(".dpanel:not(.pinned)").forEach(function (p) {
        p.classList.toggle("open", open);
        var h = p.querySelector(".dpanel-head"); if (h) h.setAttribute("aria-expanded", open ? "true" : "false");
      });
      var st = dashState();
      ["01", "02", "03", "04", "05", "06", "07", "08"].forEach(function (n) { st[n] = open; });
      Store.set(DASH_KEY, st);
    }
    return el("div.dashtools", null, [
      el("div.dashtools-label", { text: "Study material" }),
      el("div.dashtools-btns", null, [
        el("button.btn.ghost.dashbtn", { text: "Expand all", onclick: function () { setAll(true); } }),
        el("button.btn.ghost.dashbtn", { text: "Collapse all", onclick: function () { setAll(false); } })
      ])
    ]);
  }

  function renderDashboard() {
    cardsHost.innerHTML = "";
    cardsHost.appendChild(dashToolbar());
    var totalSections = (S.domainMeta || []).reduce(function (a, d) { return a + (d.sectionCount || 0); }, 0);
    var nDomains = (S.domainMeta || []).length;

    /* 00 · progress snapshot (pinned open) */
    var b0 = dashSection("00", "Your progress", "", { pinned: true });
    b0.appendChild(statCard());

    /* tip: sections are collapsible */
    cardsHost.appendChild(el("div.dashnote", { html: "<span class='ico'>💡</span> <span><b>Tip:</b> collapse any section you're not using &mdash; tap its header (or use <b>Collapse all</b> above) to fold it away and focus on one area at a time. Your layout is remembered.</span>" }));

    /* ---- 01 · Exam Mechanics & Career Alignment ---- */
    var b1 = dashSection("01", "Exam mechanics & career alignment", "Exam + career");
    b1.appendChild(el("p.sectsub", { text: "Start here. Understand how the CISA is scored and delivered as a fixed-form, 150-question exam, and where the credential fits in an IS audit and assurance career." }));
    var g1 = el("div.grid");
    g1.appendChild(card({
      icon: "🎓", tag: "OVERVIEW", title: "Exam Mechanics", cls: "",
      desc: "Format, timing, scoring, and question style of the CISA &mdash; the high-stakes details every candidate should internalize before sitting the test.",
      foot: EX.minutes + " min · " + EX.itemsLabel + " items · " + PASS + " to pass", cta: "Read",
      onClick: function () { openExamMechanics(); }
    }));
    g1.appendChild(card({
      icon: "🧭", tag: "CAREER", title: "Career Guidance", tagCls: "ghost",
      desc: "Where CISA sits on the career ladder: the IS audit, assurance, and control judgment it certifies, and the IT auditor, audit manager, and GRC-track roles it unlocks.",
      foot: "Advanced · Vendor-neutral", cta: "Read",
      onClick: function () { openCareer(); }
    }));
    b1.appendChild(g1);

    /* ---- 02 · Student Analytics & Readiness Summary ---- */
    var bReadiness = dashSection("02", "Student analytics & readiness summary", Store.history().length + " sessions logged");
    var gReadiness = el("div.grid");
    gReadiness.appendChild(card({
      icon: "📊", tag: "ANALYTICS", title: "Performance Analytics", tagCls: "ghost",
      desc: "Your full test history, average scores, weakest domains, mock-exam readiness trend, and flashcard recall progress.",
      foot: Store.history().length + " sessions logged", cta: "Review",
      onClick: function () { openAnalytics(); }
    }));
    gReadiness.appendChild(card({
      icon: "🎯", tag: "READINESS", title: "Readiness Summary", tagCls: "ghost",
      desc: "A profile of your exam readiness across quizzes, PBQs, flashcards, labs, and taxonomy, with a projected outcome, strengths versus gaps, and targeted next steps.",
      foot: "Profile and projected outcome", cta: "View",
      onClick: function () { openReadiness(); }
    }));
    bReadiness.appendChild(gReadiness);

    /* ---- 02 · Study & preparation material (lazy-loaded domain modules) ---- */
    var b2 = dashSection("03", "Study & preparation material", nDomains + " domains · " + totalSections + " topics");
    b2.appendChild(el("p.sectsub", { text: "Six domains, each a rigorous reading interface with deep technical definitions, comparison tables, exam tips, and real-world scenarios." }));
    var g2 = el("div.grid");
    (S.domainMeta || []).forEach(function (d) {
      /* Section counts come from domainMeta so the card is accurate without
         eagerly loading the (now lazily fetched) reading module. */
      var loaded = (S.reading && S.reading[d.id]) || null;
      var nSections = loaded ? loaded.length : (d.sectionCount || 0);
      g2.appendChild(card({
        icon: d.icon || "📘", tag: "DOMAIN " + d.id, tagCls: "d" + d.id, cls: "domain d" + d.id,
        title: d.title,
        desc: d.short,
        foot: nSections + " sections · " + (d.objectives ? d.objectives.length : 0) + " objectives", cta: "Study",
        onClick: function () { openDomain(d.id); }
      }));
    });
    b2.appendChild(g2);

    /* ---- 03 · Rapid Recall Flashcards (lazy-loaded decks, Leitner SRS) ---- */
    var flashSummary = ((window.FLASH ? FLASH.DECK_SIZE : 100) * nDomains) + " cards" + (window.FLASH ? " · " + FLASH.allDue() + " due" : "");
    var b3 = dashSection("04", "Rapid recall flashcards", flashSummary);
    b3.appendChild(el("p.sectsub", { html: "Active recall with <b>spaced repetition</b> — 100 cards per domain (acronyms + key terms). Grade each card and the Leitner scheduler resurfaces what you're forgetting and retires what you know." }));
    if (window.FLASH) {
      var gf = el("div.grid");
      (S.domainMeta || []).forEach(function (d) {
        var due = FLASH.domainDue(d.id);
        gf.appendChild(card({
          icon: "🃏", tag: "D" + d.id + " DECK", tagCls: "d" + d.id, cls: "domain d" + d.id,
          title: "Domain " + d.id + " Flashcards",
          desc: d.title,
          foot: FLASH.DECK_SIZE + " cards · " + due + " to review", cta: "Drill",
          onClick: function () { FLASH.openDeck(d.id); }
        }));
      });
      b3.appendChild(gf);
      var gf2 = el("div.grid");
      gf2.appendChild(card({
        icon: "🔤", tag: "MASTER", tagCls: "ghost",
        title: "Master Acronym Drill",
        desc: "Every CISA acronym across all five domains in one deck &mdash; the highest-yield rote material on the exam.",
        foot: "All-domain acronyms", cta: "Drill",
        onClick: function () { FLASH.openMaster(); }
      }));
      gf2.appendChild(card({
        icon: "📅", tag: "DUE TODAY", tagCls: "ghost",
        title: "All Due Today",
        desc: "A mixed review session of every card the spaced-repetition scheduler says you're due to see &mdash; across all domains.",
        foot: FLASH.allDue() + " cards due", cta: "Review",
        onClick: function () { FLASH.openDueAll(); }
      }));
      b3.appendChild(gf2);
    }

    /* ---- 04 · Practice Quizzes ---- */
    var b4 = dashSection("05", "Practice quizzes", (S.questions ? S.questions.length : "800+") + " questions · 4 modes");
    b4.appendChild(el("p.sectsub", { html: "Drawn at random from a bank of <b>" + (S.questions ? S.questions.length : "800+") + "</b> original items, graded with full rationale. Domain quizzes isolate one objective set; the quick quiz mixes all five." }));

    var g3a = el("div.grid small");
    (S.domainMeta || []).forEach(function (d) {
      var n = (S.questions || []).filter(function (q) { return q.domain === d.id; }).length;
      g3a.appendChild(card({
        cls: "qcard", icon: "", tag: "D" + d.id, tagCls: "d" + d.id,
        title: "Domain " + d.id + " Quiz",
        desc: "10 questions · " + d.title.split(" ").slice(0, 3).join(" "),
        onClick: function () { QUIZ.startDomainQuiz(d.id); }
      }));
    });
    b4.appendChild(g3a);

    var g3b = el("div.grid");
    g3b.appendChild(card({
      icon: "⚡", tag: "QUICK", title: "Randomized Quick Quiz",
      desc: "Ten questions drawn uniformly from all five domains &mdash; a fast, mixed knowledge check with full rationale on every item.",
      foot: "10 questions · all domains", cta: "Launch",
      onClick: function () { QUIZ.startQuickQuiz(); }
    }));
    var weakDom = window.QUIZ ? QUIZ.weakestDomain() : null;
    g3b.appendChild(card({
      icon: "🎯", tag: "ADAPTIVE", title: "Adaptive Practice",
      desc: "A 10-question set weighted toward your weakest objectives (and questions you've missed before), based on your quiz history. It sharpens as you practice.",
      foot: weakDom ? "Currently targeting " + weakDom : "Adapts to your performance", cta: "Launch",
      onClick: function () { QUIZ.startAdaptive(); }
    }));
    var missedN = window.QUIZ ? QUIZ.missedCount() : 0;
    g3b.appendChild(card({
      icon: "🔁", tag: "RETRY", title: "Missed Questions",
      desc: "Re-attempt only the questions you've previously gotten wrong. Answer one correctly and it leaves your retry queue.",
      foot: missedN ? missedN + " in your retry queue" : "Nothing missed yet", cta: "Review",
      onClick: function () { QUIZ.startMissed(); }
    }));
    b4.appendChild(g3b);

    /* ---- 06 · Performance-based question simulators ---- */
    var nFmt = (S.pbqFormats || []).length;
    var b6 = dashSection("06", "Performance-based question simulators", (S.pbqs ? S.pbqs.length : 30) + " simulations · " + nFmt + " modules");
    b6.appendChild(el("p.sectsub", { html: "A database of <b>" + (S.pbqs ? S.pbqs.length : 30) + "</b> hands-on PBQs across " + nFmt + " formats. Read the exhibit, configure each field, and submit for graded feedback mapped to the objective." }));
    var g4 = el("div.grid");
    (S.pbqFormats || []).forEach(function (f) {
      var n = (S.pbqs || []).filter(function (p) { return p.format === f.id; }).length;
      g4.appendChild(card({
        icon: f.icon, tag: f.badge || ("FORMAT " + f.id), tagCls: "d" + f.domainColor,
        title: f.title,
        desc: f.desc,
        foot: n + " simulations · objective " + f.obj, cta: "Train",
        onClick: function () { QUIZ.openPBQFormat(f.id); }
      }));
    });
    g4.appendChild(card({
      icon: "🧩", tag: "DRAG AND DROP", title: "Technical Taxonomy Mapping", tagCls: "ghost",
      desc: "A hands-on drag and drop classification engine: sort real-world scenarios into the correct categories across the exam taxonomy, then check your answers for instant color-coded feedback.",
      foot: "Sorting scenarios across the exam taxonomy", cta: "Open",
      onClick: function () { openTaxonomy(); }
    }));
    b6.appendChild(g4);

    /* ---- 07 . Hands-on labs ---- */
    var nLabs = (window.LABS && window.LABS.length) ? window.LABS.length : 20;
    var bLabs = dashSection("07", "Hands-on labs", nLabs + " interactive sandbox labs");
    bLabs.appendChild(el("p.sectsub", { html: "Scenario-driven, live-fire laboratory exercises. Flip a card to review its learning objectives, then launch a full-screen interactive sandbox console with a live terminal log." }));
    renderLabsInline(bLabs);

    /* ---- 08 · Mock Certification Exam ---- */
    var b5 = dashSection("08", "Mock certification exam", EX.maxQuestions + " questions · timed");
    b5.appendChild(el("p.sectsub", { html: "A realistic, full-length simulation of the CISA &mdash; " + EX.maxQuestions + " questions weighted to the official domain percentages. Sit it under timed conditions to benchmark your readiness." }));
    var g3c = el("div.grid");
    g3c.appendChild(card({
      icon: "🧪", tag: "MOCK EXAM", title: "Full-Length Mock Exam",
      desc: "A realistic " + EX.minutes + "-minute simulation: " + EX.maxQuestions + " questions weighted to the exact domain percentages, with a countdown timer, question flagging, and a domain-by-domain scoring dashboard.",
      foot: EX.maxQuestions + " questions · " + EX.minutes + " minutes · timed", cta: "Begin",
      onClick: function () { QUIZ.startMock(); }
    }));
    b5.appendChild(g3c);

    /* ---- 09 · Supplemental Learning Hub ---- */
    var b7 = dashSection("09", "Supplemental learning hub", "Library and certification explorer");
    var g5 = el("div.grid");
    g5.appendChild(card({
      icon: "🔗", tag: "LIBRARY", title: "External Resources Library", tagCls: "ghost",
      desc: "Vetted, free study tools: the official ISACA CISA exam content outline, canonical review manuals, video walkthroughs, and trusted community resources.",
      foot: "Curated free resources", cta: "Browse",
      onClick: function () { openResources(); }
    }));
    g5.appendChild(card({
      icon: "🧭", tag: "EXPLORER", title: "Industry Certification Explorer", tagCls: "ghost",
      desc: "Plan your certification journey: browse 39 industry certifications across 12 vendors with live filters, costs, full exam blueprints, DoD 8140 mapping, and salary and role insights.",
      foot: "39 certifications · 12 vendors", cta: "Explore",
      onClick: function () { openCertExplorer(); }
    }));
    b7.appendChild(g5);
  }

  /* ===========================================================================
     READING INTERFACE  (domain textbook view + simple static readers)
     =========================================================================== */
  /* ===========================================================================
     INDUSTRY CERTIFICATION EXPLORER  (catalog + drill-down; data: window.CERTS,
     lazy-loaded from assets/js/content/certs.js). Site-agnostic.
     =========================================================================== */
  function certVer() { var v = window.CISA_VER || ""; return v ? "?v=" + v : ""; }
  function loadCerts(cb) {
    if (window.CERTS && window.CERTS.length) { cb(); return; }
    var sc = document.createElement("script");
    sc.src = "assets/js/content/certs.js" + certVer();
    sc.async = true;
    sc.onload = function () { (window.CERTS && window.CERTS.length) ? cb() : cb(new Error("empty")); };
    sc.onerror = function () { cb(new Error("load")); };
    document.head.appendChild(sc);
  }
  function openCertExplorer() {
    Router.open({ tag: "Cert explorer", render: function (host) {
      host.appendChild(crumb("Industry Certification Explorer"));
      host.appendChild(el("div.phead", null, [el("h1", { text: "Industry Certification Explorer" }), el("span.sub", { text: "Your interactive guide to planning the certification journey. Click any card for full exam details." })]));
      var mount = el("div");
      host.appendChild(mount);
      host.appendChild(backBar());
      if (window.CERTS && window.CERTS.length) { renderCertCatalog(mount); }
      else {
        mount.appendChild(el("div.empty", { html: "<span class='hud' style='color:var(--cyan)'>▰▰▰</span> Loading certification catalog..." }));
        loadCerts(function (e) { if (e) { toast("Could not load the certification catalog."); } else { mount.innerHTML = ""; renderCertCatalog(mount); } });
      }
    } });
  }
  function certStat(v, k) { return el("div.cert-stat", null, [el("div.cs-v", { text: String(v) }), el("div.cs-k", { text: k })]); }
  function renderCertCatalog(mount) {
    var all = window.CERTS.slice();
    var state = { difficulty: "", domain: "", vendor: "", q: "" };
    var diffs = ["Beginner", "Intermediate", "Advanced", "Expert"];
    var domains = all.map(function (c) { return c.domain; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).sort();
    var vendors = all.map(function (c) { return c.vendor; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).sort();

    mount.appendChild(el("div.cert-stats", null, [
      certStat(all.length, "Certifications"), certStat(vendors.length, "Vendors"),
      certStat(diffs.length, "Difficulty levels"), certStat(domains.length, "Knowledge domains")
    ]));

    var grid = el("div.cert-grid");
    var showing = el("span.cert-showing");
    function redraw() {
      var list = all.filter(function (c) {
        if (state.difficulty && c.difficulty !== state.difficulty) return false;
        if (state.domain && c.domain !== state.domain) return false;
        if (state.vendor && c.vendor !== state.vendor) return false;
        if (state.q) { var hay = (c.name + " " + c.abbr + " " + c.vendor + " " + c.examCode).toLowerCase(); if (hay.indexOf(state.q.toLowerCase()) < 0) return false; }
        return true;
      });
      showing.textContent = "Showing " + list.length + " / " + all.length;
      grid.innerHTML = "";
      if (!list.length) { grid.appendChild(el("div.empty", { text: "No certifications match these filters." })); return; }
      list.forEach(function (c) { grid.appendChild(certCardEl(c, list)); });
    }
    function field(label, opts, allLabel, onCh) {
      var s = el("select.cert-sel");
      s.appendChild(el("option", { value: "", text: allLabel }));
      opts.forEach(function (o) { s.appendChild(el("option", { value: o, text: o })); });
      s.addEventListener("change", function () { onCh(s.value); });
      return el("label.cert-field", null, [el("span.cert-flabel", { text: label }), s]);
    }
    var diffField = field("Difficulty", diffs, "All difficulties", function (v) { state.difficulty = v; redraw(); });
    var domField = field("Domain", domains, "All domains", function (v) { state.domain = v; redraw(); });
    var venField = field("Vendor", vendors, "All vendors", function (v) { state.vendor = v; redraw(); });
    var search = el("input.cert-search", { type: "text", placeholder: "e.g. CISA" });
    search.addEventListener("input", function () { state.q = search.value; redraw(); });
    var reset = el("button.btn.danger.sm", { text: "↺ Reset", onclick: function () {
      state = { difficulty: "", domain: "", vendor: "", q: "" }; search.value = "";
      diffField.querySelector("select").value = ""; domField.querySelector("select").value = ""; venField.querySelector("select").value = ""; redraw();
    } });

    mount.appendChild(el("div.cert-controls", null, [
      diffField, domField, venField,
      el("label.cert-field.grow", null, [el("span.cert-flabel", { text: "Search" }), search]),
      el("div.cert-resetwrap", null, [reset, showing])
    ]));
    mount.appendChild(grid);
    redraw();
  }
  function certCardEl(c, list) {
    var b = el("button.cert-card", { type: "button", onclick: function () { renderCertDetail(c, list); } });
    b.appendChild(el("span.cc-id", { text: "#" + c.id }));
    b.appendChild(el("div.cc-vendor", { text: c.vendor }));
    b.appendChild(el("h3.cc-name", { text: c.name }));
    b.appendChild(el("div.cc-abbr", { text: c.abbr }));
    b.appendChild(el("div.cc-cost", { text: c.cost }));
    var pills = el("div.cc-pills");
    c.tags.forEach(function (t) { pills.appendChild(el("span.cc-pill", { text: t })); });
    b.appendChild(pills);
    return b;
  }
  function renderCertDetail(cert, list) {
    var idx = list.indexOf(cert);
    var overlay = el("div.cert-modal.show");
    function close() { overlay.remove(); document.removeEventListener("keydown", onKey); }
    function nav(d) { var n = idx + d; if (n < 0 || n >= list.length) return; close(); renderCertDetail(list[n], list); }
    function onKey(e) { if (e.key === "Escape") close(); else if (e.key === "ArrowRight") nav(1); else if (e.key === "ArrowLeft") nav(-1); }
    document.addEventListener("keydown", onKey);

    function box(label, val) { return el("div.cd-box", null, [el("div.cd-blabel", { text: label }), el("div.cd-bval", { text: val })]); }
    function container(label, val) { return el("div.cd-container", null, [el("div.cd-clabel", { text: label }), el("div.cd-cval", { text: val })]); }
    function studyGroup(label, items) { var ul = el("ul.cd-list"); items.forEach(function (i) { ul.appendChild(el("li", { text: i })); }); return el("div.cd-studygroup", null, [el("div.cd-clabel", { text: label }), ul]); }

    overlay.appendChild(el("div.cd-box-outer", null, [
      el("div.cd-head", null, [
        el("div.cd-meta", null, [
          el("div.cd-eyebrow", { text: "CERT #" + cert.id + " · " + cert.vendor }),
          el("h2", { text: cert.name }),
          el("div.cd-abbr", { text: cert.abbr }),
          el("div.cc-pills", null, cert.tags.map(function (t) { return el("span.cc-pill", { text: t }); }))
        ]),
        el("button.cd-close", { text: "✕", "aria-label": "Close", onclick: close })
      ]),
      el("div.cd-body", null, [
        el("div.cd-boxes", null, [
          box("Exam code / version", cert.examCode),
          box("Questions and format", cert.format),
          box("Duration", cert.duration),
          box("Passing score", cert.passing),
          box("Cost", cert.cost),
          box("Validity period", cert.validity),
          box("Testing options", cert.testing)
        ]),
        container("⚠ Prerequisites", cert.prereq),
        container("♻ Renewal requirements", cert.renewal),
        container("🛡 DoD 8140 compliance", cert.dod8140),
        el("div.cd-sect", { text: "Advanced student insights" }),
        container("📊 Exam domain weights", cert.weights),
        container("🧪 PBQ and hands-on scenarios", cert.pbq),
        container("💼 ROI and market insights", cert.roi),
        el("div.cd-sect", { text: "Vetted study materials" }),
        el("div.cd-study", null, [studyGroup("Free", cert.free), studyGroup("Paid", cert.paid)]),
        el("div.cd-nav", null, [
          el("button.btn", { text: "◀ Prev cert", disabled: idx === 0 ? "disabled" : null, onclick: function () { nav(-1); } }),
          el("button.btn.primary", { text: "Close detail", onclick: close }),
          el("button.btn", { text: "Next cert ▶", disabled: idx === list.length - 1 ? "disabled" : null, onclick: function () { nav(1); } })
        ])
      ])
    ]));
    overlay.addEventListener("click", function (e) { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
  }


  /* ===========================================================================
     TECHNICAL TAXONOMY MAPPING  (drag and drop classification; data:
     window.TAXONOMY, lazy-loaded from assets/js/content/taxonomy.js, per site).
     =========================================================================== */
  function taxShuffle(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function loadTaxonomy(cb) {
    if (window.TAXONOMY && window.TAXONOMY.length) { cb(); return; }
    var sc = document.createElement("script");
    sc.src = "assets/js/content/taxonomy.js" + certVer();
    sc.async = true;
    sc.onload = function () { (window.TAXONOMY && window.TAXONOMY.length) ? cb() : cb(new Error("empty")); };
    sc.onerror = function () { cb(new Error("load")); };
    document.head.appendChild(sc);
  }
  function openTaxonomy() {
    Router.open({ tag: "Taxonomy mapping", render: function (host) {
      host.appendChild(crumb("Technical Taxonomy Mapping"));
      host.appendChild(el("div.phead", null, [el("h1", { text: "Technical Taxonomy Mapping" }), el("span.sub", { text: "Hands-on drag and drop classification across the exam taxonomy." })]));
      var mount = el("div");
      host.appendChild(mount);
      host.appendChild(backBar());
      if (window.TAXONOMY && window.TAXONOMY.length) { renderTaxShell(mount); }
      else {
        mount.appendChild(el("div.empty", { html: "<span class='hud' style='color:var(--cyan)'>▰▰▰</span> Loading classification activities..." }));
        loadTaxonomy(function (e) { if (e) { toast("Could not load the classification activities."); } else { mount.innerHTML = ""; renderTaxShell(mount); } });
      }
    } });
  }
  function renderTaxShell(container) {
    var acts = window.TAXONOMY || [];
    if (!acts.length) { container.appendChild(el("div.empty", { text: "No activities available." })); return; }
    var tabs = el("div.tax-tabs");
    var board = el("div.tax-board");
    acts.forEach(function (a, i) { tabs.appendChild(el("button.tax-tab", { text: (i + 1) + ". " + a.title, onclick: function () { setActive(i); } })); });
    function setActive(i) {
      Array.prototype.forEach.call(tabs.children, function (b, bi) { b.classList.toggle("on", bi === i); });
      renderTaxBoard(board, acts[i], i + 1);
    }
    container.appendChild(tabs);
    container.appendChild(board);
    setActive(0);
  }
  function renderTaxBoard(mount, act, num) {
    mount.innerHTML = "";
    var palette = ["#3b82f6", "#a78bfa", "#fb8b3c", "#46d18a", "#34d5e6", "#f7c948", "#fb5071", "#5aa9e6"];
    var dragEl = null, selected = null;

    mount.appendChild(el("div.tax-banner", null, [
      el("span.tax-pill", { text: "ACTIVITY " + num }),
      el("div.tax-bannertext", null, [el("h3", { text: act.title }), el("div.tax-sub", { text: act.subtitle })])
    ]));
    mount.appendChild(el("div.tax-instr", { html: "<b>Instructions:</b> " + esc(act.instructions) + " <b style='color:var(--cyan)'>On a touchscreen:</b> tap a chip to select it, then tap the category to place it." }));

    var pool = el("div.tax-pool");
    var grid = el("div.tax-zones");
    var summary = el("div.tax-summary");

    function clearSummary() { summary.className = "tax-summary"; summary.textContent = ""; }
    function deselect() { if (selected) { selected.classList.remove("sel"); selected = null; } }
    function select(chip) { deselect(); selected = chip; chip.classList.add("sel"); }
    function toPool(chip) { chip.classList.remove("placed", "correct", "wrong", "sel"); chip.style.removeProperty("--c"); pool.appendChild(chip); if (selected === chip) selected = null; clearSummary(); }
    function placeInZone(chip, zone) { chip.classList.remove("correct", "wrong", "sel"); chip.classList.add("placed"); chip.style.setProperty("--c", zone.dataset.color); zone.appendChild(chip); if (selected === chip) selected = null; clearSummary(); }

    function makeChip(item) {
      var chip = el("div.tax-chip", { draggable: "true" });
      chip.dataset.cat = item.cat;
      chip.appendChild(el("span.tax-text", { text: item.text }));
      var x = el("span.tax-x", { text: "✕", title: "Return to pool" });
      x.addEventListener("click", function (e) { e.stopPropagation(); toPool(chip); });
      chip.appendChild(x);
      chip.addEventListener("dragstart", function (e) { dragEl = chip; chip.classList.add("dragging"); try { e.dataTransfer.setData("text/plain", "chip"); e.dataTransfer.effectAllowed = "move"; } catch (er) {} });
      chip.addEventListener("dragend", function () { chip.classList.remove("dragging"); dragEl = null; });
      chip.addEventListener("click", function (e) { e.stopPropagation(); if (selected === chip) deselect(); else select(chip); });
      return chip;
    }
    function wireDrop(container, isZone) {
      container.addEventListener("dragover", function (e) { e.preventDefault(); container.classList.add("over"); });
      container.addEventListener("dragleave", function (e) { if (e.target === container) container.classList.remove("over"); });
      container.addEventListener("drop", function (e) { e.preventDefault(); container.classList.remove("over"); if (!dragEl) return; if (isZone) placeInZone(dragEl, container); else toPool(dragEl); });
      container.addEventListener("click", function (e) { if (selected) { if (isZone) placeInZone(selected, container); else toPool(selected); } });
    }

    act.categories.forEach(function (c, ci) {
      var color = palette[ci % palette.length];
      var zone = el("div.tax-zone");
      zone.dataset.cat = c.id; zone.dataset.color = color;
      zone.appendChild(el("div.tax-zonehead", null, [el("span.tax-dot", { style: "background:" + color }), el("span.tax-zonelabel", { text: c.label })]));
      wireDrop(zone, true);
      grid.appendChild(zone);
    });
    wireDrop(pool, false);
    taxShuffle(act.items).forEach(function (item) { pool.appendChild(makeChip(item)); });

    function check() {
      var chips = mount.querySelectorAll(".tax-chip");
      var total = chips.length, correct = 0;
      Array.prototype.forEach.call(chips, function (chip) {
        chip.classList.remove("correct", "wrong");
        var zone = chip.closest(".tax-zone");
        if (!zone) { if (!chip.classList.contains("placed")) chip.style.removeProperty("--c"); return; }
        if (zone.dataset.cat === chip.dataset.cat) { chip.classList.add("correct"); chip.style.setProperty("--c", "#46d18a"); correct++; }
        else { chip.classList.add("wrong"); chip.style.setProperty("--c", "#fb5071"); }
      });
      summary.className = "tax-summary show " + (correct === total ? "ok" : "bad");
      summary.textContent = (correct === total)
        ? "Perfect. " + correct + " / " + total + " correct. Every scenario is in the right category."
        : correct + " / " + total + " correct. Red chips indicate misplaced items; try moving them to a different category.";
    }
    function reset() {
      var chips = []; Array.prototype.forEach.call(mount.querySelectorAll(".tax-chip"), function (c) { chips.push(c); });
      deselect();
      taxShuffle(chips).forEach(function (chip) { toPool(chip); });
      clearSummary();
    }

    mount.appendChild(pool);
    mount.appendChild(grid);
    mount.appendChild(el("div.tax-controls", null, [
      el("button.btn.primary", { text: "Check Answers", onclick: check }),
      el("button.btn.ghost", { text: "Reset", onclick: reset })
    ]));
    mount.appendChild(summary);
  }


  /* ===========================================================================
     HANDS-ON LABS  (card-flip catalog + full-screen interactive sandbox console;
     data: window.LABS, lazy-loaded from assets/js/content/labs.js, per site).
     =========================================================================== */
  function loadLabs(cb) {
    if (window.LABS && window.LABS.length) { cb(); return; }
    var sc = document.createElement("script");
    sc.src = "assets/js/content/labs.js" + certVer();
    sc.async = true;
    sc.onload = function () { (window.LABS && window.LABS.length) ? cb() : cb(new Error("empty")); };
    sc.onerror = function () { cb(new Error("load")); };
    document.head.appendChild(sc);
  }
  function prettyGroup(g) { return String(g || "").toLowerCase().replace(/\b\w/g, function (c) { return c.toUpperCase(); }).replace(/\bAnd\b/g, "and"); }
  function labDoneSet() { var a = Store.get("labsDone", []) || [], m = {}; a.forEach(function (x) { m[x] = true; }); return m; }
  function markLabDone(id) { if (!id) return; var a = Store.get("labsDone", []) || []; if (a.indexOf(id) < 0) { a.push(id); Store.set("labsDone", a); } }
  function labGroups() {
    var labs = window.LABS || [], seen = {}, order = [];
    labs.forEach(function (l) { if (!seen[l.group]) { seen[l.group] = true; order.push(l.group); } });
    return order.map(function (g) { return { group: g, labs: labs.filter(function (l) { return l.group === g; }) }; });
  }

  /* ---- dashboard section: one card per subject group ---- */
  function renderLabsInline(host) {
    if (window.LABS && window.LABS.length) { host.appendChild(labGroupGrid()); return; }
    var ph = el("div.empty", { html: "<span class='hud' style='color:var(--cyan)'>▰▰▰</span> Loading laboratory catalog..." });
    host.appendChild(ph);
    loadLabs(function (e) { if (e) { ph.textContent = "Could not load the laboratory catalog."; } else { host.replaceChild(labGroupGrid(), ph); } });
  }
  function labGroupGrid() {
    var icons = ["🧩", "🛡️", "🏗️", "⚙️", "📦", "🎯", "🔧", "☁️"];
    var done = labDoneSet();
    var grid = el("div.grid");
    labGroups().forEach(function (g, idx) {
      var dn = g.labs.filter(function (l) { return done[l.id]; }).length;
      var nL = g.labs.length, labWord = nL === 1 ? " lab" : " labs";
      grid.appendChild(card({
        icon: icons[idx % icons.length], tag: "LAB GROUP", title: prettyGroup(g.group), tagCls: "ghost",
        desc: nL + " hands-on" + labWord + " covering " + prettyGroup(g.group) + ". Flip each card to review its objectives, then launch the interactive sandbox console.",
        foot: nL + labWord + " · " + dn + " completed", cta: "Open",
        onClick: (function (grp) { return function () { openLabGroup(grp); }; })(g.group)
      }));
    });
    return grid;
  }
  function openLabGroup(group) {
    Router.open({ tag: "Hands-on labs", render: function (host) {
      host.appendChild(crumb(prettyGroup(group) + " labs"));
      host.appendChild(el("div.phead", null, [
        el("h1", { text: prettyGroup(group) }),
        el("span.sub", { text: "Flip a card to review its objectives, then launch the full-screen interactive sandbox console." })
      ]));
      var grid = el("div.lab-grid");
      (window.LABS || []).forEach(function (lab, i) { if (lab.group === group) grid.appendChild(buildLabCard(lab, i)); });
      host.appendChild(grid);
      host.appendChild(backBar());
    } });
  }

  function buildLabCard(lab, i) {
    var card = el("div.lab-card");
    var inner = el("div.lab-card-inner");
    var isDone = (Store.get("labsDone", []) || []).indexOf(lab.id) >= 0;

    var front = el("div.lab-face.lab-front" + (isDone ? ".lab-isdone" : ""));
    front.appendChild(el("div.lab-eyebrow", { text: lab.group || "LAB" }));
    front.appendChild(el("div.lab-idtag", { text: lab.id || ("Lab " + (i + 1)) }));
    front.appendChild(el("h3.lab-title", { text: lab.title || "" }));
    front.appendChild(el("p.lab-desc", { text: lab.desc || "" }));
    if (isDone) front.appendChild(el("span.lab-doneflag", { text: "✔ Completed" }));
    var revBtn = el("button.btn.ghost.lab-flipbtn", { type: "button", text: "Review Objectives ↻" });
    revBtn.addEventListener("click", function () { card.classList.add("flipped"); });
    front.appendChild(el("div.lab-front-foot", null, revBtn));

    var back = el("div.lab-face.lab-back");
    back.appendChild(el("div.lab-back-title", { text: "LEARNING OBJECTIVES" }));
    var ul = el("ul.lab-obj");
    (lab.objectives || []).forEach(function (o) { ul.appendChild(el("li", { text: o })); });
    back.appendChild(el("div.lab-obj-scroll", null, ul));
    var launchBtn = el("button.btn.primary.lab-launch", { type: "button", text: "Launch " + (lab.id || ("Lab " + (i + 1))) + " ▶" });
    launchBtn.addEventListener("click", function () { openLabSandbox(lab, i); });
    var closeBtn = el("button.btn.ghost", { type: "button", text: "Close" });
    closeBtn.addEventListener("click", function () { card.classList.remove("flipped"); });
    back.appendChild(el("div.lab-back-actions", null, [launchBtn, closeBtn]));

    inner.appendChild(front);
    inner.appendChild(back);
    card.appendChild(inner);
    return card;
  }

  /* ----- full-screen interactive sandbox ----- */
  function openLabSandbox(lab, i) {
    var con = lab.console || {};
    var done = {};
    var tasks = con.tasks || [];
    var overlay = el("div.lab-sandbox");
    document.documentElement.style.overflow = "hidden";

    function close() {
      document.documentElement.style.overflow = "";
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }
    function resetLab() { close(); openLabSandbox(lab, i); toast("Lab reset to the starting state."); }
    function exitButtons() {
      return el("div.lab-exitbar.bottom", null, [
        el("div.lab-exitgroup", null, [
          el("button.lab-exit", { type: "button", html: "✕ Exit Lab", onclick: function () { close(); } }),
          el("button.lab-exit.lab-exit-reset", { type: "button", html: "↺ Reset Lab", onclick: resetLab })
        ])
      ]);
    }

    var logBody = el("div.lab-termlog-body");
    function pad2(n) { return (n < 10 ? "0" : "") + n; }
    function stamp() { var d = new Date(); return "[" + pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds()) + "] "; }
    function logLine(text, cls) {
      var line = el("div.lab-logline" + (cls ? "." + cls : ""), { text: stamp() + text });
      logBody.appendChild(line); logBody.scrollTop = logBody.scrollHeight;
    }

    var objWrap = el("div.lab-sb-obj");
    objWrap.appendChild(el("div.lab-sb-label", { text: "OBJECTIVES" }));
    var taskEls = {};
    tasks.forEach(function (t) {
      var row = el("div.lab-task", null, [el("span.lab-task-box", { text: "" }), el("span.lab-task-label", { text: t.label })]);
      taskEls[t.id] = row; objWrap.appendChild(row);
    });
    var banner = el("div.lab-complete-banner", { text: "" });
    objWrap.appendChild(banner);

    function taskById(id) { for (var k = 0; k < tasks.length; k++) if (tasks[k].id === id) return tasks[k].label; return null; }
    function completeTask(id) {
      if (!id || done[id]) return;
      done[id] = true;
      if (taskEls[id]) taskEls[id].classList.add("done");
      logLine("[OK] Objective complete: " + (taskById(id) || id), "ok");
      var total = tasks.length, doneN = Object.keys(done).length;
      if (total && doneN >= total) {
        banner.textContent = "✔ LAB COMPLETE — all objectives met";
        banner.classList.add("show");
        logLine("[SYS] All objectives complete. " + (lab.id || "Lab") + " passed.", "ok");
        markLabDone(lab.id);
      }
    }

    var cfgWrap = el("div.lab-sb-config");
    (con.configs || []).forEach(function (cfg) {
      var sel = el("select.lab-select");
      sel.appendChild(el("option", { value: "", text: "-- select --" }));
      (cfg.options || []).forEach(function (o) { sel.appendChild(el("option", { value: o, text: o })); });
      sel.addEventListener("change", function () {
        if (!sel.value) return;
        logLine("[CONFIG] " + cfg.label + ": " + sel.value);
        if (cfg.correct && sel.value === cfg.correct) { completeTask(cfg.task); }
        else if (cfg.correct) { logLine("[WARN] " + sel.value + " is not optimal for this scenario.", "warn"); }
      });
      cfgWrap.appendChild(el("div.lab-field", null, [el("label.lab-flabel", { text: cfg.label }), sel]));
    });

    var payWrap = el("div");
    if (con.payload) {
      var ta = el("textarea.lab-payload", { placeholder: con.payload.placeholder || "Enter payload..." });
      var pbtn = el("button.btn.primary.lab-exec", { type: "button", text: con.payload.button || "Execute" });
      pbtn.addEventListener("click", function () {
        var v = (ta.value || "").trim();
        if (!v) { logLine("[ERR] Nothing to execute. Enter a payload first.", "warn"); return; }
        logLine("> " + v); logLine(con.payload.response || "[SYS] Payload accepted.", "ok"); completeTask(con.payload.task);
      });
      payWrap.appendChild(el("div.lab-sb-label", { text: con.payload.label || "PAYLOAD INJECTION" }));
      payWrap.appendChild(ta);
      payWrap.appendChild(el("div.lab-exec-row", null, pbtn));
    }

    var host = con.host || "sandbox";
    var cmds = con.commands || [];
    function findCmd(raw) {
      var q = raw.toLowerCase();
      for (var k = 0; k < cmds.length; k++) { if (q === cmds[k].cmd.toLowerCase()) return cmds[k]; }
      for (var j = 0; j < cmds.length; j++) { if (q.indexOf(cmds[j].cmd.toLowerCase()) === 0) return cmds[j]; }
      return null;
    }
    function runCommand(raw) {
      raw = (raw || "").trim(); if (!raw) return;
      logLine("student@" + host + ":~$ " + raw);
      var low = raw.toLowerCase();
      if (low === "help" || low === "?") { logLine("Available commands: " + cmds.map(function (c) { return c.cmd; }).join(", ") + ", status, clear, whoami, ls"); return; }
      if (low === "clear") { logBody.innerHTML = ""; return; }
      if (low === "whoami") { logLine("student (Cloud Security Professional)"); return; }
      if (low === "ls") { logLine("scenario.cfg  objectives.txt  evidence/  logs/"); return; }
      if (low === "status") { logLine("Objectives: " + Object.keys(done).length + " / " + tasks.length + " complete."); return; }
      var hit = findCmd(raw);
      if (hit) { (hit.out || "").split("\n").forEach(function (l) { logLine(l); }); completeTask(hit.task); }
      else { logLine("command not found: " + raw.split(" ")[0] + "  (type 'help')", "warn"); }
    }
    var cmdInput = el("input.lab-cmd-input", { type: "text", placeholder: "type a command, then press Enter  (try 'help')", spellcheck: "false", autocomplete: "off" });
    cmdInput.addEventListener("keydown", function (e) { if (e.key === "Enter") { runCommand(cmdInput.value); cmdInput.value = ""; } });
    var cmdLine = el("div.lab-cmd", null, [el("span.lab-prompt", { text: "student@" + host + ":~$" }), cmdInput]);

    var head = el("div.lab-sb-head", null, [
      el("div", null, [
        el("span.lab-sb-eyebrow", { text: lab.group || "LAB" }),
        el("h2.lab-sb-title", { text: (lab.id ? lab.id + " — " : "") + (lab.title || "") })
      ]),
      el("div.lab-sb-headright", null, [el("span.lab-sb-status", { text: "SANDBOX ONLINE" })])
    ]);
    var leftCol = el("div.lab-sb-left", null, [
      head, objWrap,
      (con.configs && con.configs.length) ? el("div.lab-sb-label", { text: "CONFIGURATION" }) : null,
      (con.configs && con.configs.length) ? cfgWrap : null,
      payWrap,
      el("div.lab-sb-label", { text: "COMMAND CONSOLE" }),
      cmdLine
    ]);
    var rightCol = el("div.lab-termlog", null, [
      el("div.lab-termlog-head", null, [el("span.lab-dots", { html: "<i></i><i></i><i></i>" }), el("span", { text: "TERMINAL_LOG :: SYS_ADMIN" })]),
      logBody
    ]);
    overlay.appendChild(el("div.lab-sb-main", null, [leftCol, rightCol]));
    overlay.appendChild(exitButtons());
    document.body.appendChild(overlay);
    overlay.scrollTop = 0;

    logLine("[SYS] " + (lab.id || "Lab") + " :: " + (lab.title || "") + " initialized.");
    (con.boot || []).forEach(function (l) { logLine(l); });
    logLine("[SYS] Awaiting technician action. Type 'help' for available commands.");
  }

  /* ----- labs progress block for the Performance Analytics page ----- */
  function renderLabsAnalytics(mount) {
    function draw() {
      mount.innerHTML = "";
      var labs = window.LABS || [], done = Store.get("labsDone", []) || [];
      var total = labs.length, doneN = labs.filter(function (l) { return done.indexOf(l.id) >= 0; }).length;
      mount.appendChild(el("div.kpis", null, [
        kpi(total ? doneN + "/" + total : doneN, "Labs completed", doneN ? (total && doneN >= total ? "good" : "cyan") : ""),
        kpi(total ? Math.round(doneN / total * 100) + "%" : "—", "Completion", total && doneN >= total ? "good" : (doneN ? "warn" : "")),
        kpi(total ? (total - doneN) : "—", "Remaining", "")
      ]));
      if (!total) { mount.appendChild(el("div.empty", { text: "Open Hands-on Labs to begin — each lab you finish will appear here." })); return; }
      var gbars = el("div.dombars.spaced", { style: "margin-top:12px" });
      labGroups().forEach(function (g) {
        var dn = g.labs.filter(function (l) { return done.indexOf(l.id) >= 0; }).length;
        var pct = Math.round(dn / g.labs.length * 100);
        gbars.appendChild(el("div.dombar", null, [
          el("div.name", { text: prettyGroup(g.group) }),
          el("div.track", null, el("i", { style: "width:" + pct + "%;background:var(--cyan)" })),
          el("div.pct", { html: dn + "/" + g.labs.length })
        ]));
      });
      mount.appendChild(gbars);
    }
    if (window.LABS && window.LABS.length) { draw(); }
    else { mount.appendChild(el("div.empty", { text: "Loading lab progress..." })); loadLabs(function () { draw(); }); }
  }

  /* ===========================================================================
     READINESS SUMMARY  (synthesizes every tracked metric into an exam-readiness
     profile: overall score, projected outcome, per-activity and per-domain
     breakdowns, strengths versus gaps, and targeted recommendations).
     =========================================================================== */
  function recordTaxScore(num, correct, total) {
    if (!total) return;
    var pct = Math.round(correct / total * 100);
    var tx = Store.get("taxScores", {}) || {}, k = String((num || 1) - 1);
    if (tx[k] == null || pct > tx[k]) { tx[k] = pct; Store.set("taxScores", tx); }
  }
  function rdColor(v) { return v >= 75 ? "#46d18a" : v >= 55 ? "#f7c948" : "#fb5071"; }
  function readinessBand(s) {
    if (s >= 85) return { label: "Exam-ready", cls: "good" };
    if (s >= 75) return { label: "On track", cls: "good" };
    if (s >= 60) return { label: "Approaching readiness", cls: "warn" };
    if (s >= 40) return { label: "Developing", cls: "warn" };
    return { label: "Foundations", cls: "crit" };
  }
  function computeReadiness() {
    var h = Store.history();
    var quizzes = h.filter(function (r) { return r.mode !== "mock" && r.mode !== "pbq"; });
    var mocks = h.filter(function (r) { return r.mode === "mock"; });
    var fa = window.FLASH ? FLASH.analytics() : null;
    var pbqTotal = (S.pbqs || []).length || 30, pbqDone = (Store.get("pbqDone", []) || []).length;
    var labTotal = (window.LABS || []).length, labDone = (Store.get("labsDone", []) || []).length;
    var tx = Store.get("taxScores", {}) || {}, txKeys = Object.keys(tx), taxTotal = (window.TAXONOMY || []).length;

    var bestMock = null; mocks.forEach(function (m) { if (m.scaled != null && (bestMock == null || m.scaled > bestMock)) bestMock = m.scaled; });
    var quizAvg = quizzes.length ? Math.round(quizzes.reduce(function (a, r) { return a + (r.pct || 0); }, 0) / quizzes.length) : null;
    var flashVal = (fa && fa.studied) ? Math.round(0.5 * (fa.total ? fa.mastered / fa.total * 100 : 0) + 0.5 * (fa.accuracy == null ? 0 : fa.accuracy)) : null;
    var taxVal = txKeys.length ? Math.round(txKeys.reduce(function (a, k) { return a + tx[k]; }, 0) / txKeys.length) : null;

    var dims = [
      { key: "quiz", label: "Domain quizzes", weight: 1.4, value: quizAvg, has: quizzes.length > 0, kind: "score", detail: quizzes.length ? (quizzes.length + " sessions, avg " + quizAvg + "%") : "not attempted" },
      { key: "mock", label: "Mock exam", weight: 1.6, value: bestMock != null ? Math.round(bestMock / SCALE_HI * 100) : null, has: mocks.length > 0, kind: "score", detail: bestMock != null ? ("best " + bestMock + "/" + SCALE_HI) : "not attempted" },
      { key: "pbq", label: "PBQ simulators", weight: 1.2, value: pbqTotal ? Math.round(pbqDone / pbqTotal * 100) : 0, has: true, kind: "completion", detail: pbqDone + "/" + pbqTotal + " completed" },
      { key: "flash", label: "Flashcards", weight: 1.0, value: flashVal, has: !!(fa && fa.studied), kind: "score", detail: fa && fa.studied ? (fa.mastered + "/" + fa.total + " mastered, " + (fa.accuracy == null ? 0 : fa.accuracy) + "% recall") : "not started" },
      { key: "labs", label: "Hands-on labs", weight: 0.9, value: labTotal ? Math.round(labDone / labTotal * 100) : 0, has: true, kind: "completion", detail: labDone + "/" + (labTotal || 20) + " completed" },
      { key: "tax", label: "Taxonomy mapping", weight: 0.8, value: taxVal, has: txKeys.length > 0, kind: "score", detail: txKeys.length ? (txKeys.length + "/" + (taxTotal || 8) + " activities, avg " + taxVal + "%") : "not attempted" }
    ];

    var sw = 0, ss = 0;
    dims.forEach(function (d) { if (d.has && d.value != null) { ss += d.value * d.weight; sw += d.weight; } });
    var overall = sw ? Math.round(ss / sw) : 0;
    var anyActivity = !!(quizzes.length || mocks.length || (fa && fa.studied) || pbqDone || labDone || txKeys.length);

    var tally = {}; (S.domainMeta || []).forEach(function (d) { tally[d.id] = { c: 0, n: 0 }; });
    h.forEach(function (r) { if (!r.domainStats) return; for (var k in r.domainStats) { if (tally[k]) { tally[k].c += r.domainStats[k].correct; tally[k].n += r.domainStats[k].total; } } });
    var domains = (S.domainMeta || []).map(function (d) {
      var q = tally[d.id].n ? Math.round(tally[d.id].c / tally[d.id].n * 100) : null;
      var f = (fa && fa.byDomain && fa.byDomain[d.id] && fa.byDomain[d.id].total) ? Math.round(fa.byDomain[d.id].mastered / fa.byDomain[d.id].total * 100) : null;
      var vals = []; if (q != null) vals.push(q); if (f != null) vals.push(f);
      var val = vals.length ? Math.round(vals.reduce(function (a, b) { return a + b; }, 0) / vals.length) : null;
      return { id: d.id, title: d.title, quiz: q, flash: f, value: val };
    });

    return { dims: dims, overall: overall, anyActivity: anyActivity, domains: domains, bestMock: bestMock, fa: fa, pbqDone: pbqDone, pbqTotal: pbqTotal, labDone: labDone, labTotal: labTotal || 20, mocks: mocks.length, quizzes: quizzes.length, taxAttempted: txKeys.length, taxTotal: taxTotal || 8 };
  }
  function readinessOutcome(R) {
    if (R.bestMock != null) {
      var m = R.bestMock;
      if (m >= PASS + 50) return { cls: "good", text: "Strong pass projected. Your best mock of " + m + " out of " + SCALE_HI + " clears the " + PASS + " passing line with margin." };
      if (m >= PASS) return { cls: "good", text: "On track to pass. Your best mock of " + m + " out of " + SCALE_HI + " is at or above the " + PASS + " passing line. Keep it consistent." };
      if (m >= PASS - 70) return { cls: "warn", text: "Borderline. Your best mock of " + m + " out of " + SCALE_HI + " sits just under the " + PASS + " line. A focused push should get you there." };
      return { cls: "crit", text: "Not yet. Your best mock of " + m + " out of " + SCALE_HI + " is below passing. Keep building before you book the exam." };
    }
    if (R.overall >= 80) return { cls: "good", text: "Tracking toward a pass based on your practice so far. Take a full timed mock exam to confirm a projected score." };
    if (R.overall >= 60) return { cls: "warn", text: "Borderline. Your practice shows promise but needs more depth. Take a timed mock exam to benchmark where you stand." };
    return { cls: "crit", text: "Not ready yet. Build broader coverage across quizzes, PBQs, and labs, then take a timed mock exam to benchmark." };
  }
  function readinessRecs(R) {
    var recs = [];
    if (!R.mocks) recs.push({ text: "Take a full-length, timed mock exam to benchmark and project your score.", btn: "Start mock exam", action: function () { Router.showDashboard(); if (window.QUIZ) QUIZ.startMock(); } });
    var sorted = R.dims.filter(function (d) { return d.has && d.value != null; }).slice().sort(function (a, b) { return a.value - b.value; });
    sorted.filter(function (d) { return d.value < 65; }).slice(0, 3).forEach(function (d) {
      if (d.key === "quiz") recs.push({ text: "Run more domain quizzes and study the rationale on every miss. Your quiz average is " + d.value + " percent." });
      else if (d.key === "pbq") recs.push({ text: "Work through more PBQ simulators. You have completed " + R.pbqDone + " of " + R.pbqTotal + "." });
      else if (d.key === "flash") recs.push({ text: "Drill flashcards to lift recall" + (R.fa && R.fa.due ? (". " + R.fa.due + " cards are due now") : "") + ".", btn: (R.fa && R.fa.due && window.FLASH) ? "Review due cards" : null, action: (R.fa && R.fa.due && window.FLASH) ? function () { FLASH.openDueAll(); } : null });
      else if (d.key === "labs") recs.push({ text: "Finish more hands-on labs. You have completed " + R.labDone + " of " + R.labTotal + "." });
      else if (d.key === "tax") recs.push({ text: "Practice Technical Taxonomy Mapping to sharpen classification. Your average is " + d.value + " percent." });
    });
    R.dims.forEach(function (d) {
      if (!d.has && d.kind === "score" && d.key !== "mock") {
        if (d.key === "quiz") recs.push({ text: "Start with domain quizzes to establish a baseline score." });
        else if (d.key === "flash") recs.push({ text: "Open a flashcard deck to start building spaced-repetition recall." });
        else if (d.key === "tax") recs.push({ text: "Try the Technical Taxonomy Mapping activities to practice classification." });
      }
    });
    var domsWith = R.domains.filter(function (d) { return d.value != null; }).slice().sort(function (a, b) { return a.value - b.value; });
    if (domsWith.length) { var w = domsWith[0]; if (w.value < 70) recs.push({ text: "Your weakest exam domain is D" + w.id + " " + w.title + " at " + w.value + " percent. Prioritize it in study and quizzes." }); }
    if (!recs.length) recs.push({ text: "You are well-rounded across every area. Keep your edge with periodic mock exams and flashcard reviews." });
    return recs.slice(0, 6);
  }
  function renderRecs(host, R) {
    var rl = el("div.rd-recs");
    readinessRecs(R).forEach(function (rec) {
      var row = el("div.rd-rec", null, [el("span.rd-recdot", { text: "▸" }), el("span.rd-rectext", { html: rec.text })]);
      if (rec.action) row.appendChild(el("button.btn.ghost.sm", { type: "button", text: rec.btn || "Open", onclick: rec.action }));
      rl.appendChild(row);
    });
    host.appendChild(rl);
  }
  function openReadiness() {
    Router.open({ tag: "Readiness summary", render: function (host) {
      host.appendChild(crumb("Readiness summary"));
      host.appendChild(el("div.phead", null, [
        el("h1", { text: "Readiness Summary" }),
        el("span.sub", { text: "A profile of your exam readiness across every activity, with a projected outcome and targeted next steps." })
      ]));
      var mount = el("div"); host.appendChild(mount); host.appendChild(backBar());
      mount.appendChild(el("div.empty", { html: "<span class='hud' style='color:var(--cyan)'>▰▰▰</span> Building your readiness profile..." }));
      var pending = 2;
      function go() { if (--pending > 0) return; renderReadiness(mount); }
      loadLabs(go); loadTaxonomy(go);
    } });
  }
  function renderReadiness(mount) {
    mount.innerHTML = "";
    var R = computeReadiness();
    if (!R.anyActivity) {
      mount.appendChild(el("div.rd-outcome.warn", null, [
        el("div.rd-octitle", { text: "Getting started" }),
        el("div.rd-octext", { text: "You have not logged any activity yet. Work through the areas below and your readiness score, projected outcome, and tailored recommendations will appear here." })
      ]));
      mount.appendChild(el("div.secthead", { text: "Recommended next steps" }));
      renderRecs(mount, R);
      return;
    }
    var band = readinessBand(R.overall);
    mount.appendChild(el("div.rd-hero." + band.cls, null, [
      el("div.rd-scorewrap", null, [el("div.rd-score", { text: R.overall + "%" }), el("div.rd-band", { text: band.label })]),
      el("div.rd-meter", null, el("i", { style: "width:" + R.overall + "%" })),
      el("div.rd-herosub", { text: "Overall readiness, weighted across " + R.dims.filter(function (d) { return d.has; }).length + " of 6 activity areas." })
    ]));
    var oc = readinessOutcome(R);
    mount.appendChild(el("div.rd-outcome." + oc.cls, null, [el("div.rd-octitle", { text: "Projected exam outcome" }), el("div.rd-octext", { text: oc.text })]));

    mount.appendChild(el("div.secthead", { text: "Readiness by activity" }));
    var abars = el("div.dombars.spaced");
    R.dims.forEach(function (d) {
      var has = d.has && d.value != null, pct = has ? d.value : 0;
      abars.appendChild(el("div.dombar", null, [
        el("div.name", { text: d.label + " · " + d.detail }),
        el("div.track", null, el("i", { style: "width:" + pct + "%;background:" + (has ? rdColor(d.value) : "var(--line)") })),
        el("div.pct", { html: has ? d.value + "%" : "<span class='note'>not started</span>" })
      ]));
    });
    mount.appendChild(abars);

    mount.appendChild(el("div.secthead", { text: "Readiness by exam domain" }));
    var dbars = el("div.dombars.spaced");
    R.domains.forEach(function (d) {
      var has = d.value != null, pct = has ? d.value : 0;
      dbars.appendChild(el("div.dombar", null, [
        el("div.name", { text: "D" + d.id + " · " + d.title }),
        el("div.track", null, el("i", { style: "width:" + pct + "%;background:var(--d" + d.id + ")" })),
        el("div.pct", { html: has ? d.value + "%" : "<span class='note'>n/a</span>" })
      ]));
    });
    mount.appendChild(dbars);

    var done = R.dims.filter(function (d) { return d.has && d.value != null; }).slice().sort(function (a, b) { return b.value - a.value; });
    var strengths = done.filter(function (d) { return d.value >= 70; }).slice(0, 3);
    var focus = done.filter(function (d) { return d.value < 60; }).slice(0, 3);
    mount.appendChild(el("div.secthead", { text: "Strengths and focus areas" }));
    mount.appendChild(el("div.rd-cols", null, [
      el("div.rd-col", null, [el("h4", { text: "Your strengths" }), strengths.length ? el("ul", null, strengths.map(function (d) { return el("li", { html: "<b>" + d.label + "</b> · " + d.value + "%" }); })) : el("div.empty", { text: "No clear strengths yet. Keep practicing to build them." })]),
      el("div.rd-col", null, [el("h4", { text: "Focus areas" }), focus.length ? el("ul", null, focus.map(function (d) { return el("li", { html: "<b>" + d.label + "</b> · " + d.value + "%" }); })) : el("div.empty", { text: "Nothing is lagging badly. Nice work." })])
    ]));

    mount.appendChild(el("div.secthead", { text: "Recommended next steps" }));
    renderRecs(mount, R);
    mount.appendChild(el("div.rd-note", { text: "This readiness profile is an indicative study aid based on your activity in this platform. It is not a prediction of your official exam result." }));
  }


  function readerView(tag, title, sub, sections) {
    return {
      tag: tag,
      render: function (host) {
        host.appendChild(crumb(title));
        host.appendChild(el("div.phead", null, [el("h1", { text: title }), sub ? el("span.sub", { text: sub }) : null]));

        var toc = el("nav.toc", null, [el("div.eyebrow", { text: "Contents" })]);
        var prose = el("div.prose");
        sections.forEach(function (s, i) {
          var sid = "sec-" + i;
          var a = el("a", { href: "#" + sid, text: s.heading, onclick: function (e) {
            e.preventDefault(); var t = document.getElementById(sid);
            if (t) t.scrollIntoView({ behavior: "smooth", block: "start" });
          } });
          if (i === 0) a.classList.add("active");
          toc.appendChild(a);
          prose.appendChild(el("section#" + sid, null, [el("h2", { text: s.heading })].concat(
            fragmentFromHTML(s.body)
          )));
        });

        host.appendChild(el("div.reader", null, [toc, prose]));
        host.appendChild(backBar());

        /* scrollspy: highlight the active TOC link */
        var links = toc.querySelectorAll("a");
        var secs = prose.querySelectorAll("section");
        var spy = function () {
          var pos = window.scrollY + 120, idx = 0;
          secs.forEach(function (sec, i) { if (sec.offsetTop <= pos) idx = i; });
          links.forEach(function (l, i) { l.classList.toggle("active", i === idx); });
        };
        window.addEventListener("scroll", spy, { passive: true });
      }
    };
  }
  function fragmentFromHTML(html) {
    var d = document.createElement("div"); d.innerHTML = html || "";
    return Array.prototype.slice.call(d.childNodes);
  }

  /* Lazily fetch a domain's reading module the first time it's opened, so the
     dashboard loads fast and each module is only paid for on demand. The fetched
     script populates CISA.reading[id]; once cached it renders instantly. */
  var domainModuleState = {}; // id -> "loading" | "loaded"
  function loadDomainModule(id, onReady, onFail) {
    if (S.reading && S.reading[id] && S.reading[id].length) { domainModuleState[id] = "loaded"; onReady(); return; }
    var s = document.createElement("script");
    s.src = "assets/js/content/domain" + id + ".js" + (window.CISA_VER ? "?v=" + window.CISA_VER : "");
    s.async = true;
    s.onload = function () {
      if (S.reading && S.reading[id] && S.reading[id].length) { domainModuleState[id] = "loaded"; onReady(); }
      else { domainModuleState[id] = undefined; onFail(); }
    };
    s.onerror = function () { domainModuleState[id] = undefined; onFail(); };
    document.head.appendChild(s);
    domainModuleState[id] = "loading";
  }

  function openDomain(id) {
    var d = APP.domainMeta(id);
    function render() {
      var sections = (S.reading && S.reading[id]) || [];
      Router.replace(readerView("Domain " + id, d.title, "CISA Domain " + id + " · " + d.weight + "% of the exam", sections));
    }
    /* Already cached → render immediately. Otherwise show a light loading view
       while the module is fetched, then swap to the reader. */
    if (S.reading && S.reading[id] && S.reading[id].length) { render(); return; }
    Router.open({
      tag: "Domain " + id, render: function (host) {
        host.appendChild(crumb(d.title));
        host.appendChild(el("div.phead", null, [el("h1", { text: d.title }), el("span.sub", { text: "Loading study material…" })]));
        host.appendChild(el("div.empty", { html: "<span class='hud' style='color:var(--cyan)'>▰▰▰</span> Loading Domain " + id + " content…" }));
      }
    });
    loadDomainModule(id, render, function () { toast("Could not load Domain " + id + " study material. Check your connection and try again."); });
  }

  function openExamMechanics() { Router.open(readerView("Exam mechanics", "Exam Mechanics: CISA", "How the exam is built, delivered, and scored", S.examMechanics || [])); }
  function openCareer() { Router.open(readerView("Career guidance", "Career Guidance", "Where CISA fits in your path", S.careerGuidance || [])); }

  /* ===========================================================================
     RESOURCES LIBRARY
     =========================================================================== */
  function openResources() {
    Router.open({
      tag: "Resources", render: function (host) {
        host.appendChild(crumb("External resources"));
        host.appendChild(el("div.phead", null, [el("h1", { text: "External Resources Library" }), el("span.sub", { text: "Verified, free study tools" })]));
        host.appendChild(el("p.sectsub", { text: "These open in a new tab. We link only to free, reputable resources; we do not host or endorse paid “exam dump” sites." }));
        var list = el("div.reslist");
        (S.resources || []).forEach(function (r) {
          list.appendChild(el("a.resitem", { href: r.url, target: "_blank", rel: "noopener noreferrer" }, [
            el("span.ricon", { text: r.icon || "🔗" }),
            el("div", null, [
              el("h3", { text: r.title }),
              el("p", { html: r.desc }),
              el("span.host", { text: r.host })
            ])
          ]));
        });
        host.appendChild(list);
        host.appendChild(backBar());
      }
    });
  }

  /* ===========================================================================
     ANALYTICS VIEW
     =========================================================================== */
  function openAnalytics() {
    Router.open({
      tag: "Analytics", render: function (host) {
        host.appendChild(crumb("Performance analytics"));
        host.appendChild(el("div.phead", null, [el("h1", { text: "Performance Analytics" })]));
        var h = Store.history();
        host.appendChild(statCard());
        host.appendChild(el("div.btnrow", { style: "margin-top:14px" }, [
          el("button.btn.danger.sm", { text: "Reset performance analytics", onclick: function () {
            confirmDialog("Reset performance analytics?", "This permanently erases all saved performance data — test history, PBQ completion, flashcard recall, hands-on lab progress, and taxonomy practice. This cannot be undone.", "Reset everything", function () {
              Store.clear(); Store.del("pbqDone"); Store.del("flash.v1"); Store.del("labsDone"); Store.del("taxScores");
              openAnalytics(); toast("Performance analytics reset.");
            });
          } })
        ]));

        /* weakest-domain breakdown across all quiz/mock sessions */
        var tally = {}; (S.domainMeta || []).forEach(function (d) { tally[d.id] = { c: 0, n: 0 }; });
        h.forEach(function (r) {
          if (!r.domainStats) return;
          for (var k in r.domainStats) { if (tally[k]) { tally[k].c += r.domainStats[k].correct; tally[k].n += r.domainStats[k].total; } }
        });
        host.appendChild(el("div.secthead", { text: "Mastery by domain" }));
        var bars = el("div.dombars.spaced");
        (S.domainMeta || []).forEach(function (d) {
          var t = tally[d.id]; var pct = t.n ? Math.round(t.c / t.n * 100) : 0;
          bars.appendChild(el("div.dombar", null, [
            el("div.name", { text: "D" + d.id + " · " + d.title }),
            el("div.track", null, el("i", { style: "width:" + pct + "%;background:var(--d" + d.id + ")" })),
            el("div.pct", { html: t.n ? pct + "%" : "<span class='note'>n/a</span>" })
          ]));
        });
        host.appendChild(bars);

        /* flashcard recall (from the spaced-repetition schedule) */
        host.appendChild(el("div.secthead", { text: "Flashcard recall" }));
        if (window.FLASH) {
          var fa = FLASH.analytics();
          host.appendChild(el("div.kpis", null, [
            kpi(fa.studied + "/" + fa.total, "Cards studied", fa.studied ? "cyan" : ""),
            kpi(fa.mastered, "Mastered", fa.mastered ? "good" : ""),
            kpi(fa.due, "Due now", fa.due ? "warn" : "good"),
            kpi(fa.accuracy == null ? "—" : fa.accuracy + "%", "Recall accuracy", fa.accuracy == null ? "" : (fa.accuracy >= 80 ? "good" : fa.accuracy >= 60 ? "warn" : "crit"))
          ]));
          if (!fa.studied) {
            host.appendChild(el("div.empty", { text: "No flashcards studied yet — open a deck under Rapid Recall Flashcards to start building recall." }));
          } else {
            var fbars = el("div.dombars.spaced", { style: "margin-top:12px" });
            (S.domainMeta || []).forEach(function (d) {
              var b = fa.byDomain[d.id]; var pct = Math.round(b.mastered / b.total * 100);
              fbars.appendChild(el("div.dombar", null, [
                el("div.name", { text: "D" + d.id + " · " + d.title }),
                el("div.track", null, el("i", { style: "width:" + pct + "%;background:var(--d" + d.id + ")" })),
                el("div.pct", { html: b.mastered + "/" + b.total + " <span class='note'>(" + b.studied + " seen)</span>" })
              ]));
            });
            host.appendChild(fbars);
          }
        } else {
          host.appendChild(el("div.empty", { text: "Flashcards unavailable." }));
        }

        host.appendChild(el("div.secthead", { text: "Hands-on labs" }));
        var labsMount = el("div"); host.appendChild(labsMount); renderLabsAnalytics(labsMount);

                host.appendChild(el("div.secthead", { text: "Session history" }));
        if (!h.length) { host.appendChild(el("div.empty", { text: "No sessions yet. Take a quiz or a mock exam and your results will appear here." })); host.appendChild(backBar()); return; }
        var tbl = el("table.htable");
        tbl.appendChild(el("thead", null, el("tr", null, ["When", "Mode", "Detail", "Score"].map(function (t) { return el("th", { text: t }); }))));
        var tb = el("tbody");
        h.slice(0, 60).forEach(function (r) {
          var when = new Date(r.ts);
          var pass = r.mode === "mock" ? r.scaled >= PASS : r.pct >= 70;
          var scoreCell = r.mode === "mock"
            ? el("span.pillscore." + (pass ? "pass" : "fail"), { text: r.scaled + " / " + SCALE_HI })
            : el("span.pillscore." + (pass ? "pass" : "fail"), { text: r.pct + "%" });
          tb.appendChild(el("tr", null, [
            el("td", { html: "<span class='mono'>" + when.toLocaleDateString() + "</span> " + when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }),
            el("td", { text: r.modeLabel || r.mode }),
            el("td", { text: r.detail || "" }),
            el("td", null, scoreCell)
          ]));
        });
        tbl.appendChild(tb);
        host.appendChild(tbl);
        host.appendChild(backBar());
      }
    });
  }

  /* ===========================================================================
     BOOT
     =========================================================================== */
  /* Populate the hero exam-line from CISA.exam so the figures live in exactly
     one place (the single source of truth) and never as HTML literals. */
  function fillExamLine() {
    var elx = $("#examline"); if (!elx || !EX) return;
    elx.innerHTML =
      "<span>⏱ <b>" + EX.minutes + " minutes</b></span>" +
      "<span>❓ <b>" + EX.itemsLabel + " items</b> (" + EX.format + ")</span>" +
      "<span>\u{1f3af} <b>passing " + EX.passing + "</b> / " + EX.scaleHigh + "</span>" +
      "<span>\u{1f4da} <b>" + ((S.domainMeta || []).length || EX.domains) + " domains</b></span>";
  }

  function boot() {
    Theme.build();
    fillExamLine();
    $("#homeBrand").addEventListener("click", function (e) { e.preventDefault(); Router.showDashboard(); renderDashboard(); });
    renderDashboard();
    // expose a couple of renderers the engine may want to bounce back to
    window.APP.renderDashboard = renderDashboard;
    window.APP.openAnalytics = openAnalytics;
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
