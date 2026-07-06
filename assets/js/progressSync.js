/* ===========================================================================
   THE CERTIFICATION LAUNCHPAD BRIDGE  ::  shipped into every exam site (cert-hub companion).
   1) Injects a "<- Launchpad" link into the top bar (back to the hub).
   2) Answers the hub's cross-origin requests (hidden-iframe + postMessage):
        examProgress:request -> readiness snapshot (examProgress:v1)
        examProgress:export  -> full local data dump  (examProgress:dump)
        examProgress:import  -> restore a data dump    (examProgress:imported)
        examProgress:clear   -> wipe local data        (examProgress:cleared)
   The hub only ever orchestrates; this site stays the system of record. No
   accounts, no servers. Each exam site is its own origin, so its localStorage
   belongs entirely to that one exam.
   =========================================================================== */
(function () {
  "use strict";

  function hubUrl() {
    var h = location.hostname;
    if (h === "localhost" || h === "127.0.0.1" || h === "") {
      return location.protocol + "//" + (h || "localhost") + ":8113/";
    }
    return "../cert-hub/"; /* sibling GitHub Pages site when deployed */
  }

  function injectHubLink() {
    try {
      var bar = document.querySelector(".topbar");
      if (!bar || document.getElementById("clHubLink")) return;
      var a = document.createElement("a");
      a.id = "clHubLink";
      a.href = hubUrl();
      a.textContent = "← Launchpad";
      a.title = "Back to The Certification Launchpad - all certification exams";
      /* Prominent filled button, parked on the right next to the DASHBOARD page tag. */
      a.style.cssText = "display:inline-flex;align-items:center;margin-right:14px;padding:9px 16px;" +
        "background:var(--cyan);color:#04222a;border:1px solid var(--cyan);border-radius:9px;" +
        "text-decoration:none;white-space:nowrap;font-family:var(--f-hud,sans-serif);font-size:13px;" +
        "font-weight:700;letter-spacing:.04em;box-shadow:0 6px 18px -8px rgba(53,213,230,.85);";
      var tag = bar.querySelector(".pagetag");
      if (tag) bar.insertBefore(a, tag);
      else bar.appendChild(a);
    } catch (e) {}
  }

  /* ---- standardized readiness snapshot from this site's own activity ---- */
  function buildPayload() {
    if (!window.APP || !APP.store) return null;
    var h = [];
    try { h = APP.store.history() || []; } catch (e) { h = []; }
    var flash = null;
    try { flash = window.FLASH ? FLASH.analytics() : null; } catch (e) {}
    var pbqDone = 0;
    try { pbqDone = (APP.store.get("pbqDone", []) || []).length; } catch (e) {}

    var hasActivity = h.length || (flash && flash.mastered) || pbqDone;
    if (!hasActivity) return null; /* -> hub shows "Not started" */

    var quizzes = h.filter(function (r) { return r.mode !== "pbq" && typeof r.pct === "number"; });
    var mocks = h.filter(function (r) { return r.mode === "mock" && typeof r.scaled === "number"; });
    var pbqs = h.filter(function (r) { return r.mode === "pbq" && typeof r.pct === "number"; });

    var qAnswered = 0, qCorrect = 0, lastActive = null;
    h.forEach(function (r) {
      qAnswered += (r.total || 0); qCorrect += (r.correct || 0);
      if (r.ts && (!lastActive || r.ts > lastActive)) lastActive = r.ts;
    });
    function mean(arr, f) { return arr.length ? arr.reduce(function (a, r) { return a + f(r); }, 0) / arr.length : null; }
    var avgQuiz = mean(quizzes, function (r) { return r.pct; });
    var avgPbq = mean(pbqs, function (r) { return r.pct; });
    var bestMock = mocks.length ? Math.max.apply(null, mocks.map(function (r) { return r.scaled; })) : null;
    var flashRatio = (flash && flash.total) ? flash.mastered / flash.total : null;

    var sig = [];
    if (avgQuiz != null) sig.push([avgQuiz / 100, 0.35]);
    if (bestMock != null) sig.push([bestMock / 900, 0.35]);
    if (flashRatio != null) sig.push([flashRatio, 0.20]);
    if (avgPbq != null) sig.push([avgPbq / 100, 0.10]);
    var wsum = sig.reduce(function (a, s) { return a + s[1]; }, 0);
    var score = wsum ? sig.reduce(function (a, s) { return a + s[0] * s[1]; }, 0) / wsum : 0;
    score = Math.max(0, Math.min(1, score));

    var label = score >= 0.88 ? "Exam-ready" : score >= 0.75 ? "Almost ready" :
                score >= 0.6 ? "Getting close" : score >= 0.4 ? "Building skills" : "Getting started";

    return {
      readiness: { score: score, label: label },
      activity: {
        sessions: h.length, questionsAnswered: qAnswered, questionsCorrect: qCorrect,
        flashcardsMastered: flash ? flash.mastered : 0, flashcardsTotal: flash ? flash.total : 0,
        pbqsCompleted: pbqDone || pbqs.length, bestMockScaled: bestMock
      },
      lastActive: lastActive
    };
  }

  function persist(p) { try { if (p && window.APP && APP.store) APP.store.set("examProgress.v1", p); } catch (e) {} }

  /* ---- full local-data dump / restore / wipe (for hub Backup & Restore) ---- */
  function dumpStorage() {
    var o = {};
    try { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); o[k] = localStorage.getItem(k); } } catch (e) {}
    return o;
  }
  function importStorage(data) {
    if (!data || typeof data !== "object") return;
    try { Object.keys(data).forEach(function (k) { localStorage.setItem(k, data[k]); }); } catch (e) {}
  }
  function reply(src, msg) { try { if (src) src.postMessage(msg, "*"); } catch (e) {} }

  window.addEventListener("message", function (e) {
    var d = e.data; if (!d || !d.type) return;
    if (d.type === "examProgress:request") {
      var payload = buildPayload(); persist(payload);
      reply(e.source, { type: "examProgress:v1", slug: d.slug, payload: payload });
    } else if (d.type === "examProgress:export") {
      reply(e.source, { type: "examProgress:dump", slug: d.slug, data: dumpStorage() });
    } else if (d.type === "examProgress:import") {
      importStorage(d.data);
      reply(e.source, { type: "examProgress:imported", slug: d.slug });
    } else if (d.type === "examProgress:clear") {
      try { localStorage.clear(); } catch (err) {}
      reply(e.source, { type: "examProgress:cleared", slug: d.slug });
    }
  });

  function init() { injectHubLink(); persist(buildPayload());
    if ("serviceWorker" in navigator) { try { navigator.serviceWorker.register("sw.js"); } catch (e) {} } }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
