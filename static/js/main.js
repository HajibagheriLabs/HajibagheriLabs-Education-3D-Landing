/* HajibagheriLabs — base interactions. Vanilla JS, no dependencies.
   Back-to-top only. NO scroll/particle animation here — that lives only in the
   homepage constellation. */
(function () {
  "use strict";

  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---- Back-to-top -------------------------------------------------------- */
  var toTop = document.querySelector("[data-to-top]");
  if (toTop) {
    var ticking = false;
    function syncToTop() {
      ticking = false;
      var show = window.scrollY > window.innerHeight * 0.9;
      toTop.hidden = false;
      toTop.classList.toggle("is-visible", show);
    }
    window.addEventListener("scroll", function () {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(syncToTop);
      }
    }, { passive: true });
    syncToTop();
    toTop.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
    });
  }
})();
