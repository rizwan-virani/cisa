/* Back-to-Top FAB — floating pill that parks just above the light/dark theme
   toggle, appears once you scroll down, and smooth-scrolls to the top. Mirrors
   the SOC Range control. Self-contained, no dependencies. */
(function () {
  function init() {
    if (document.getElementById("toTopFab") || !document.body) return;
    var b = document.createElement("button");
    b.id = "toTopFab";
    b.className = "totop-fab";
    b.type = "button";
    b.setAttribute("aria-label", "Back to top");
    b.innerHTML = "↑ Top";
    document.body.appendChild(b);
    var THRESHOLD = 280;
    function update() {
      var y = window.pageYOffset || document.documentElement.scrollTop || 0;
      b.classList.toggle("show", y > THRESHOLD);
    }
    b.addEventListener("click", function () {
      try { window.scrollTo({ top: 0, behavior: "smooth" }); }
      catch (e) { window.scrollTo(0, 0); }
    });
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update, { passive: true });
    update();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
