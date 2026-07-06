/* ============================================================================
   CISA  ::  quizEngine.js  —  ENGINE  (assessment + PBQ runtime)
   The question bank (content/quiz1..8.js) and PBQ database (content/pbqs.js)
   load before this file and populate CISA.questions / CISA.pbqs.
   This engine powers three assessment modes (domain quiz, quick quiz, timed
   mock) plus the performance-based-question simulator, rendering each into the
   shared #view container via window.APP.

   Every exam figure (passing score, scale band, mock length and duration) is
   read from CISA.exam — the single source of truth — never re-literaled.
   ========================================================================== */
(function () {
  "use strict";

  var S = window.CISA;
  var EX = (S && S.exam) || {}; // single source of truth for all exam figures
  /* app.js loads AFTER this file, so window.APP isn't ready at load time.
     Resolve it lazily: every public entry point calls ready() first, which
     binds A and el before any rendering helper runs. */
  var A, el;
  function ready() { A = window.APP; el = A.el; }

  /* ----- sampling helpers (Fisher–Yates) ----- */
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function sample(arr, n) { return shuffle(arr).slice(0, n); }
  function byDomain(d) { return S.questions.filter(function (q) { return q.domain === d; }); }
  var LETTERS = ["A", "B", "C", "D", "E", "F"];

  /* per-question option order is randomized so the answer index isn't a tell. */
  function prepare(q) {
    var order = shuffle(q.options.map(function (o, i) { return i; }));
    return {
      ref: q,
      opts: order.map(function (i) { return q.options[i]; }),
      answer: order.indexOf(q.answer)
    };
  }

  /* domain stats accumulator used by results + analytics */
  function blankStats() { var o = {}; (S.domainMeta || []).forEach(function (d) { o[d.id] = { correct: 0, total: 0 }; }); return o; }

  /* ===========================================================================
     ADAPTIVE / MISSED-QUESTION TRACKING
     Persists two things across every quiz/mock session (localStorage via APP):
       cisa.objstats.v1 = { "1.2": {c, n}, ... }   per-objective accuracy
       cisa.missed.v1   = { "D4-071": 1, ... }      questions answered wrong
     The adaptive set weights selection toward weak/unseen objectives (and prior
     misses); the missed queue re-serves only wrong questions until you get them
     right. Helpers read window.APP directly so the dashboard can call them
     before any quiz entry point binds A.
     =========================================================================== */
  var QS = {
    getObj: function () { return window.APP.store.get("objstats.v1", {}) || {}; },
    getMissed: function () { return window.APP.store.get("missed.v1", {}) || {}; },
    /* fold a graded set into the persistent stores. items = prepared array
       (each has .ref and .answer); picks = chosen indices into shuffled opts. */
    record: function (items, picks) {
      var obj = this.getObj(), missed = this.getMissed();
      items.forEach(function (it, i) {
        var q = it.ref, ok = picks[i] === it.answer;
        var o = obj[q.obj] || { c: 0, n: 0 }; o.n++; if (ok) o.c++; obj[q.obj] = o;
        if (ok) delete missed[q.id]; else missed[q.id] = 1;
      });
      window.APP.store.set("objstats.v1", obj);
      window.APP.store.set("missed.v1", missed);
    },
    missedCount: function () { return Object.keys(this.getMissed()).length; },
    /* weakest domain by accumulated objective accuracy (>= 3 attempts) */
    weakestDomain: function () {
      var obj = this.getObj(), dom = {};
      for (var k in obj) { var d = k[0]; dom[d] = dom[d] || { c: 0, n: 0 }; dom[d].c += obj[k].c; dom[d].n += obj[k].n; }
      var worst = null, worstAcc = 2;
      for (var dd in dom) { if (dom[dd].n >= 3) { var a = dom[dd].c / dom[dd].n; if (a < worstAcc) { worstAcc = a; worst = dd; } } }
      return worst ? ("Domain " + worst) : null;
    }
  };

  /* per-question weight: weak/unseen objectives and prior misses score higher */
  function adaptiveWeight(q, obj, missed) {
    var o = obj[q.obj], w;
    if (!o || !o.n) w = 2.2;                 // unseen objective → encourage coverage
    else w = 1 + 2 * (1 - o.c / o.n);        // weak objective weighted up to 3x
    if (missed[q.id]) w += 1.5;              // a prior miss gets an extra boost
    return w;
  }
  /* weighted sampling without replacement */
  function weightedSample(pool, n, wf) {
    var items = pool.map(function (q) { return { q: q, w: Math.max(0.01, wf(q)) }; });
    var out = [];
    n = Math.min(n, items.length);
    for (var k = 0; k < n; k++) {
      var total = items.reduce(function (a, x) { return a + x.w; }, 0);
      var r = Math.random() * total, acc = 0, idx = 0;
      for (var i = 0; i < items.length; i++) { acc += items[i].w; if (r <= acc) { idx = i; break; } }
      out.push(items[idx].q); items.splice(idx, 1);
    }
    return out;
  }
  function adaptiveSet(n) {
    var obj = QS.getObj(), missed = QS.getMissed();
    return weightedSample(S.questions, n, function (q) { return adaptiveWeight(q, obj, missed); });
  }

  /* ===========================================================================
     LINEAR QUIZ  (domain quiz + quick quiz): immediate feedback per question
     =========================================================================== */
  function runLinearQuiz(opts) {
    ready();
    var items = opts.items.map(prepare);
    var idx = 0, picks = new Array(items.length).fill(null);

    A.open({
      tag: opts.tag,
      render: function (host) {
        var pane = el("div");
        host.appendChild(A.crumb(opts.title, { onBack: function () {
          A.confirm("Leave quiz?", "Your progress on this quiz will not be saved.", "Leave", function () { A.dashboard(); A.renderDashboard(); });
        } }));
        host.appendChild(el("div.phead", null, [el("h1", { text: opts.title }), el("span.sub", { text: opts.sub })]));
        host.appendChild(pane);
        draw(pane);
      }
    });

    function draw(pane) {
      pane.innerHTML = "";
      var wrap = el("div.quizwrap");
      var bar = el("div.qmeta", null, [
        el("div.progressbar", null, el("i", { style: "width:" + (idx / items.length * 100) + "%" })),
        el("div.qcount", { text: "Question " + (idx + 1) + " of " + items.length })
      ]);
      wrap.appendChild(bar);

      var it = items[idx], q = it.ref, answered = picks[idx] != null;
      var dc = "d" + q.domain;
      var qc = el("div.qcard-full");
      qc.appendChild(el("div.qhead", null, [
        el("span.qdombadge." + dc, { text: "DOMAIN " + q.domain }),
        el("span.qobj", { text: "Objective " + q.obj }),
        el("span.qobj", { text: "· " + (q.diff || "medium") })
      ]));
      qc.appendChild(el("div.qtext", { html: q.q }));

      it.opts.forEach(function (text, i) {
        var cls = "opt";
        if (answered) {
          if (i === it.answer) cls += " correct";
          else if (i === picks[idx]) cls += " wrong";
        }
        var b = el("button." + cls.replace(/ /g, "."), { type: "button", disabled: answered ? "disabled" : null });
        b.appendChild(el("span.key", { text: LETTERS[i] }));
        b.appendChild(el("span", { html: text }));
        if (answered && i === it.answer) b.appendChild(el("span.tick", { text: "✓" }));
        if (answered && i === picks[idx] && i !== it.answer) b.appendChild(el("span.tick", { text: "✗" }));
        if (!answered) b.addEventListener("click", function () { picks[idx] = i; draw(pane); });
        qc.appendChild(b);
      });

      if (answered) {
        var correct = picks[idx] === it.answer;
        qc.appendChild(el("div.rationale" + (correct ? "" : ".bad"), null, [
          el("span.lbl", { text: correct ? "Correct" : "Not quite" }),
          el("span", { html: q.explain })
        ]));
      }

      var nav = el("div.qnav", null, [
        el("button.btn.ghost", { text: "← Previous", disabled: idx === 0 ? "disabled" : null, onclick: function () { if (idx > 0) { idx--; draw(pane); } } }),
        answered
          ? el("button.btn.primary", { text: idx === items.length - 1 ? "See results →" : "Next question →", onclick: function () { if (idx === items.length - 1) finish(); else { idx++; draw(pane); } } })
          : el("span.note", { text: "Select an answer to continue." })
      ]);
      qc.appendChild(nav);
      wrap.appendChild(qc);
      pane.appendChild(wrap);
    }

    function finish() {
      var stats = blankStats(), correct = 0, wrongList = [];
      items.forEach(function (it, i) {
        var ok = picks[i] === it.answer;
        stats[it.ref.domain].total++; if (ok) { stats[it.ref.domain].correct++; correct++; }
        if (!ok) wrongList.push({ it: it, pick: picks[i] });
      });
      var pct = Math.round(correct / items.length * 100);
      QS.record(items, picks); // feed adaptive engine + missed-question queue
      A.store.record({ mode: opts.mode, modeLabel: opts.modeLabel, detail: opts.detail, pct: pct, correct: correct, total: items.length, domainStats: stats });
      showResults({
        tag: opts.tag, title: opts.title, mode: opts.mode,
        correct: correct, total: items.length, pct: pct, stats: stats, wrongList: wrongList,
        retry: function () { opts.retry(); }
      });
    }
  }

  /* ===========================================================================
     RESULTS DASHBOARD (shared by quizzes + mock)
     =========================================================================== */
  function showResults(r) {
    A.open({
      tag: "Results", render: function (host) {
        host.appendChild(A.crumb("Results", { onBack: function () { A.dashboard(); A.renderDashboard(); } }));
        host.appendChild(el("div.phead", null, [el("h1", { text: r.title + " — Results" })]));
        var box = el("div.results");

        var isMock = r.mode === "mock";
        var pass = isMock ? r.scaled >= EX.passing : r.pct >= 70;
        var ringcol = pass ? "var(--low)" : (r.pct >= 50 ? "var(--amber)" : "var(--crit)");
        var hero = el("div.scorehero");
        var ring = el("div.scorering", { style: "--pct:" + r.pct + ";--ringcol:" + ringcol });
        ring.appendChild(el("div.inner", null, [el("div.pct", { text: r.pct + "%" }), el("div.lab", { text: r.correct + "/" + r.total })]));
        hero.appendChild(ring);
        hero.appendChild(el("div.verdict." + (pass ? "pass" : "fail"), { text: pass ? (isMock ? "Likely Pass" : "Strong") : (isMock ? "Not Yet Passing" : "Keep Studying") }));
        if (isMock) hero.appendChild(el("div.scaled", { html: "Scaled score <b style='color:var(--ink)'>" + r.scaled + "</b> / " + EX.scaleHigh + " &nbsp;·&nbsp; passing is <b style='color:var(--ink)'>" + EX.passing + "</b>" }));
        else hero.appendChild(el("div.scaled", { text: r.correct + " of " + r.total + " correct" }));
        box.appendChild(hero);

        /* per-domain bars */
        box.appendChild(el("div.secthead", { text: "By domain" }));
        var bars = el("div.dombars");
        (S.domainMeta || []).forEach(function (d) {
          var st = r.stats[d.id]; if (!st || !st.total) return;
          var p = Math.round(st.correct / st.total * 100);
          bars.appendChild(el("div.dombar", null, [
            el("div.name", { text: "D" + d.id + " · " + d.title }),
            el("div.track", null, el("i", { style: "width:" + p + "%;background:var(--d" + d.id + ")" })),
            el("div.pct", { text: st.correct + "/" + st.total })
          ]));
        });
        box.appendChild(bars);

        /* review of missed items, mapped to objectives */
        box.appendChild(el("div.secthead", { text: r.wrongList.length ? "Review missed questions (" + r.wrongList.length + ")" : "Review" }));
        if (!r.wrongList.length) box.appendChild(el("div.empty", { text: "Perfect run — nothing to review. 🎯" }));
        var rl = el("div.reviewlist");
        r.wrongList.forEach(function (w) {
          var q = w.it.ref;
          var yourText = w.pick == null ? "(left blank)" : w.it.opts[w.pick];
          var corrText = w.it.opts[w.it.answer];
          rl.appendChild(el("div.ritem", null, [
            el("p.rq", { html: q.q }),
            el("div.ra", null, [el("span.you.bad", { html: "Your answer: " + A.esc(yourText) })]),
            el("div.ra", null, [el("span.corr", { html: "Correct: " + A.esc(corrText) })]),
            el("div.rationale", null, [el("span.lbl", { text: "Why" }), el("span", { html: q.explain })]),
            el("div.robj", { text: ((S.exam && S.exam.code) || "") + " Domain " + q.domain + " · Objective " + q.obj })
          ]));
        });
        box.appendChild(rl);

        box.appendChild(el("div.btnrow", { style: "margin-top:22px;justify-content:center" }, [
          el("button.btn.primary", { text: "Try another set", onclick: function () { r.retry(); } }),
          el("button.btn", { text: "View analytics", onclick: function () { A.openAnalytics(); } }),
          el("button.btn.ghost", { text: "Back to dashboard", onclick: function () { A.dashboard(); A.renderDashboard(); } })
        ]));
        host.appendChild(box);
      }
    });
  }

  /* ===========================================================================
     TIMED MOCK EXAM  (weighted questions, timer, flagging, palette)
     Length and duration come from CISA.exam (single source of truth).
     =========================================================================== */
  function buildMockSet() {
    var total = EX.maxQuestions, picks = [];
    var meta = S.domainMeta.slice();
    var alloc = meta.map(function (d) { return { d: d.id, n: Math.round(total * d.weight / 100) }; });
    var sum = alloc.reduce(function (a, x) { return a + x.n; }, 0);
    // correct rounding drift onto the highest-weighted domain, whichever it is
    var big = 0; for (var i = 1; i < meta.length; i++) { if (meta[i].weight > meta[big].weight) big = i; }
    alloc[big].n += (total - sum);
    alloc.forEach(function (x) {
      var pool = byDomain(x.d);
      picks = picks.concat(sample(pool, Math.min(x.n, pool.length)));
    });
    return shuffle(picks).map(prepare);
  }

  function startMock() {
    ready();
    if (S.questions.length < EX.maxQuestions) { A.toast("Question bank still loading…"); return; }
    var items = buildMockSet();
    var picks = new Array(items.length).fill(null);
    var flags = new Array(items.length).fill(false);
    var idx = 0;
    var DURATION = EX.minutes * 60; // seconds
    var remaining = DURATION;
    var ticker = null, paneRef = null, ended = false;

    A.open({
      tag: "Mock exam", render: function (host) {
        host.appendChild(A.crumb("Mock exam in progress", { onBack: function () {
          A.confirm("Abandon the mock exam?", "You are mid-exam. Leaving discards this attempt and it will not be scored.", "Abandon exam", function () { stop(); A.dashboard(); A.renderDashboard(); });
        } }));
        host.appendChild(el("div.phead", null, [el("h1", { text: "Full-Length Mock Exam" }), el("span.sub", { text: EX.maxQuestions + " questions · weighted to " + ((S.exam && S.exam.code) || "") + " domains" })]));
        paneRef = el("div"); host.appendChild(paneRef);
        draw();
        ticker = setInterval(tick, 1000);
      }
    });

    function tick() {
      remaining--; updateTimer();
      if (remaining <= 0) { stop(); A.toast("Time! Submitting your exam."); submit(); }
    }
    function stop() { if (ticker) clearInterval(ticker); ticker = null; }
    function fmt(s) { var m = Math.floor(s / 60), ss = s % 60; return (m < 10 ? "0" : "") + m + ":" + (ss < 10 ? "0" : "") + ss; }
    function updateTimer() {
      var t = paneRef && paneRef.querySelector("#mockTimer"); if (!t) return;
      t.textContent = "⏱ " + fmt(remaining);
      t.className = "timer" + (remaining <= 60 ? " crit" : remaining <= 300 ? " warn" : "");
    }

    function draw() {
      if (ended) return;
      paneRef.innerHTML = "";
      var wrap = el("div.quizwrap");
      var answeredCount = picks.filter(function (p) { return p != null; }).length;

      var meta = el("div.qmeta", null, [
        el("div.timer#mockTimer", { text: "⏱ " + fmt(remaining) }),
        el("div.progressbar", null, el("i", { style: "width:" + (answeredCount / items.length * 100) + "%" })),
        el("div.qcount", { text: answeredCount + " / " + items.length + " answered" })
      ]);
      wrap.appendChild(meta);
      updateTimer();

      /* palette */
      var pal = el("div.palette");
      items.forEach(function (_, i) {
        var c = "palette";
        var b = el("button", { text: String(i + 1), onclick: function () { idx = i; draw(); } });
        if (picks[i] != null) b.classList.add("answered");
        if (flags[i]) b.classList.add("flagged");
        if (i === idx) b.classList.add("current");
        pal.appendChild(b);
      });
      wrap.appendChild(pal);

      var it = items[idx], q = it.ref;
      var qc = el("div.qcard-full");
      qc.appendChild(el("div.qhead", null, [
        el("span.qdombadge.d" + q.domain, { text: "DOMAIN " + q.domain }),
        el("span.qobj", { text: "Question " + (idx + 1) + " of " + items.length }),
        el("button.qflag" + (flags[idx] ? ".on" : ""), { text: flags[idx] ? "Flagged" : "Flag for review", onclick: function () { flags[idx] = !flags[idx]; draw(); } })
      ]));
      qc.appendChild(el("div.qtext", { html: q.q }));
      it.opts.forEach(function (text, i) {
        var b = el("button.opt" + (picks[idx] === i ? ".sel" : ""), { type: "button" });
        b.appendChild(el("span.key", { text: LETTERS[i] }));
        b.appendChild(el("span", { html: text }));
        b.addEventListener("click", function () { picks[idx] = (picks[idx] === i ? null : i); draw(); });
        qc.appendChild(b);
      });

      var nav = el("div.qnav", null, [
        el("button.btn.ghost", { text: "← Previous", disabled: idx === 0 ? "disabled" : null, onclick: function () { if (idx > 0) { idx--; draw(); } } }),
        el("div.btnrow", null, [
          idx === items.length - 1
            ? el("button.btn.primary", { text: "Review & submit", onclick: reviewSubmit })
            : el("button.btn.primary", { text: "Next →", onclick: function () { idx++; draw(); } })
        ])
      ]);
      qc.appendChild(nav);
      wrap.appendChild(qc);
      paneRef.appendChild(wrap);
    }

    function reviewSubmit() {
      var unanswered = picks.filter(function (p) { return p == null; }).length;
      var flagged = flags.filter(Boolean).length;
      A.confirm("Submit exam?",
        (unanswered ? unanswered + " question(s) are unanswered and will be marked wrong. " : "All questions answered. ") +
        (flagged ? flagged + " are flagged for review. " : "") + "Submit for scoring?",
        "Submit exam", function () { stop(); submit(); });
    }

    function submit() {
      if (ended) return; ended = true; stop();
      var stats = blankStats(), correct = 0, wrongList = [];
      items.forEach(function (it, i) {
        var ok = picks[i] === it.answer;
        stats[it.ref.domain].total++; if (ok) { stats[it.ref.domain].correct++; correct++; }
        if (!ok) wrongList.push({ it: it, pick: picks[i] });
      });
      var pct = Math.round(correct / items.length * 100);
      var scaled = Math.max(EX.scaleLow, Math.min(EX.scaleHigh, Math.round(EX.scaleLow + pct / 100 * (EX.scaleHigh - EX.scaleLow))));
      QS.record(items, picks); // feed adaptive engine + missed-question queue
      A.store.record({ mode: "mock", modeLabel: "Mock exam", detail: correct + "/" + items.length + " · used " + Math.round((DURATION - remaining) / 60) + " min", pct: pct, scaled: scaled, correct: correct, total: items.length, domainStats: stats });
      showResults({ tag: "Results", title: "Mock Exam", mode: "mock", correct: correct, total: items.length, pct: pct, scaled: scaled, stats: stats, wrongList: wrongList, retry: startMock });
    }
  }

  /* ===========================================================================
     PBQ SIMULATOR  (exhibit + dropdown fields, graded with rationale)
     =========================================================================== */
  function openPBQFormat(fid) {
    ready();
    var fmt = (S.pbqFormats || []).filter(function (f) { return f.id === fid; })[0] || {};
    var list = S.pbqs.filter(function (p) { return p.format === fid; });
    var done = A.store.get("pbqDone", []) || [];

    A.open({
      tag: "PBQ · " + (fmt.badge || ("Format " + fid)), render: function (host) {
        host.appendChild(A.crumb(fmt.title));
        host.appendChild(el("div.phead", null, [el("h1", { text: fmt.title }), el("span.sub", { text: (fmt.badge || ("Format " + fid)) + " · " + list.length + " simulations · objective " + fmt.obj })]));
        host.appendChild(el("p.sectsub", { html: fmt.long || fmt.desc }));
        var grid = el("div.grid");
        list.forEach(function (p, i) {
          var isDone = done.indexOf(p.id) >= 0;
          grid.appendChild((function () {
            var c = el("button.card" + (isDone ? ".domain.d" + p.domain : ""), { type: "button", onclick: function () { runPBQ(list, i, fid); } });
            c.appendChild(el("div.kome", null, [
              el("span.ico", { text: fmt.icon }),
              el("span.tag.d" + p.domain, { text: isDone ? "✓ DONE" : "PBQ " + (i + 1) })
            ]));
            c.appendChild(el("h3", { text: p.title }));
            c.appendChild(el("div.desc", { html: (p.brief || "").slice(0, 120) + ((p.brief || "").length > 120 ? "…" : "") }));
            c.appendChild(el("div.foot", null, [el("span", { text: p.fields.length + " decisions · D" + p.domain }), el("span.go", { text: "Open →" })]));
            return c;
          })());
        });
        host.appendChild(grid);
        if (A.backBar) host.appendChild(A.backBar());
      }
    });
  }

  function runPBQ(list, i, fid) {
    var p = list[i];
    var fmt = (S.pbqFormats || []).filter(function (f) { return f.id === fid; })[0] || {};
    var graded = false;
    var selects = [];

    A.open({
      tag: "PBQ " + p.id, render: function (host) {
        host.appendChild(A.crumb(p.id, { onBack: function () { openPBQFormat(fid); } }));
        host.appendChild(el("div.phead", null, [el("h1", { text: p.title }), el("span.sub", { text: "Domain " + p.domain + " · " + fmt.title })]));
        var wrap = el("div.pbqwrap");
        wrap.appendChild(el("p.pbq-brief", { html: p.brief }));

        if (p.exhibit) {
          wrap.appendChild(el("div.terminal", null, [
            el("div.tbar", null, [el("span.dots", null, [el("i"), el("i"), el("i")]), el("span.ttl", { text: p.exhibitTitle || "exhibit" })]),
            el("pre", { html: p.exhibit })
          ]));
        }

        var fieldsHost = el("div.pbq-fields");
        p.fields.forEach(function (f, fi) {
          var fld = el("div.field");
          fld.appendChild(el("div.flabel", { text: (fi + 1) + ". " + f.label }));
          if (f.hint) fld.appendChild(el("div.fhint", { html: f.hint }));
          var sel = el("select");
          sel.appendChild(el("option", { value: "", text: "— choose —" }));
          f.options.forEach(function (o, oi) { sel.appendChild(el("option", { value: String(oi), text: o })); });
          fld.appendChild(sel);
          fld.appendChild(el("div.fexplain", { html: "<span class='ans'>Correct: " + A.esc(f.options[f.answer]) + ".</span> " + f.explain }));
          fieldsHost.appendChild(fld);
          selects.push({ sel: sel, fld: fld, f: f });
        });
        wrap.appendChild(fieldsHost);

        var summary = el("div", { style: "margin-top:8px" });
        var actions = el("div.qnav", null, [
          el("button.btn.ghost", { text: "← All " + fmt.title.split(" ")[0] + " PBQs", onclick: function () { openPBQFormat(fid); } }),
          el("div.btnrow", null, [
            el("button.btn.primary#pbqGrade", { text: "Submit & grade", onclick: grade }),
            i < list.length - 1 ? el("button.btn", { text: "Next PBQ →", onclick: function () { runPBQ(list, i + 1, fid); } }) : null
          ])
        ]);
        wrap.appendChild(summary);
        wrap.appendChild(actions);
        host.appendChild(wrap);

        function grade() {
          if (graded) { // already graded → act as reset
            selects.forEach(function (s) { s.sel.value = ""; s.sel.disabled = false; s.fld.classList.remove("graded", "correct", "wrong"); });
            graded = false; summary.innerHTML = ""; $set("Submit & grade"); return;
          }
          var miss = selects.some(function (s) { return s.sel.value === ""; });
          if (miss && !confirmProceed()) return;
          var correct = 0;
          selects.forEach(function (s) {
            var val = s.sel.value === "" ? -1 : parseInt(s.sel.value, 10);
            var ok = val === s.f.answer;
            if (ok) correct++;
            s.fld.classList.add("graded"); s.fld.classList.toggle("correct", ok); s.fld.classList.toggle("wrong", !ok);
            s.sel.disabled = true;
          });
          graded = true; $set("Reset");
          var pct = Math.round(correct / selects.length * 100);
          var pass = pct >= 70;
          summary.innerHTML = "";
          summary.appendChild(el("div.rationale" + (pass ? "" : ".bad"), null, [
            el("span.lbl", { text: pass ? "Well configured" : "Needs work" }),
            el("span", { html: "<b>" + correct + " of " + selects.length + "</b> decisions correct (" + pct + "%). " + (p.summary || "") })
          ]));
          /* mark complete */
          var done = A.store.get("pbqDone", []) || [];
          if (done.indexOf(p.id) < 0) { done.push(p.id); A.store.set("pbqDone", done); }
          A.store.record({ mode: "pbq", modeLabel: "PBQ", detail: p.id + " · " + fmt.title.split(" ")[0], pct: pct, correct: correct, total: selects.length, domainStats: (function () { var st = blankStats(); st[p.domain] = { correct: correct, total: selects.length }; return st; })() });
          summary.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
        function $set(t) { var b = host.querySelector("#pbqGrade"); if (b) b.textContent = t; }
        var proceeded = false;
        function confirmProceed() { return window.confirm("Some fields are unset and will be marked incorrect. Grade anyway?"); }
      }
    });
  }

  /* ===========================================================================
     PUBLIC ENGINE SURFACE
     =========================================================================== */
  window.QUIZ = {
    startDomainQuiz: function (d) {
      ready();
      var meta = A.domainMeta(d);
      var pool = byDomain(d);
      if (pool.length < 1) { A.toast("No questions for this domain yet."); return; }
      runLinearQuiz({
        tag: "D" + d + " Quiz", mode: "domain", modeLabel: "Domain quiz",
        title: "Domain " + d + " Quiz", sub: meta.title + " · 10 questions",
        detail: "Domain " + d, items: sample(pool, Math.min(10, pool.length)),
        retry: function () { window.QUIZ.startDomainQuiz(d); }
      });
    },
    startQuickQuiz: function () {
      runLinearQuiz({
        tag: "Quick Quiz", mode: "quick", modeLabel: "Quick quiz",
        title: "Randomized Quick Quiz", sub: "10 questions · all five domains",
        detail: "Mixed", items: sample(S.questions, 10),
        retry: function () { window.QUIZ.startQuickQuiz(); }
      });
    },
    /* Adaptive: 10 questions weighted toward your weakest objectives + prior misses. */
    startAdaptive: function () {
      ready();
      var items = adaptiveSet(10);
      if (!items.length) { A.toast("No questions available."); return; }
      var weak = QS.weakestDomain();
      runLinearQuiz({
        tag: "Adaptive", mode: "adaptive", modeLabel: "Adaptive practice",
        title: "Adaptive Practice",
        sub: "10 questions weighted to your weak areas" + (weak ? " · focus: " + weak : ""),
        detail: weak ? "Weighted · " + weak : "Adaptive", items: items,
        retry: function () { window.QUIZ.startAdaptive(); }
      });
    },
    /* Missed queue: re-serve only previously-wrong questions (answering one
       correctly removes it from the queue via QS.record). */
    startMissed: function () {
      ready();
      var missed = QS.getMissed();
      var pool = S.questions.filter(function (q) { return missed[q.id]; });
      if (!pool.length) { A.toast("No missed questions yet — take a quiz first."); return; }
      runLinearQuiz({
        tag: "Missed", mode: "missed", modeLabel: "Missed questions",
        title: "Missed Questions", sub: pool.length + " in your retry queue",
        detail: "Retry", items: sample(pool, Math.min(15, pool.length)),
        retry: function () { window.QUIZ.startMissed(); }
      });
    },
    missedCount: function () { return QS.missedCount(); },
    weakestDomain: function () { return QS.weakestDomain(); },
    startMock: startMock,
    openPBQFormat: openPBQFormat
  };
})();
