/* syncsquare editorial — reveals + reading progress */
(function () {
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* reveals */
  var reveals = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window) || reduced) {
    reveals.forEach(function (el) { el.classList.add('in'); });
  } else {
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); obs.unobserve(e.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    reveals.forEach(function (r) { obs.observe(r); });
  }

  /* reading progress — the petrol hairline */
  var bar = document.querySelector('.read-progress i');
  if (bar) {
    var raf = null;
    function update() {
      raf = null;
      var h = document.documentElement;
      var max = h.scrollHeight - h.clientHeight;
      bar.style.width = (max > 0 ? (h.scrollTop / max) * 100 : 0) + '%';
    }
    window.addEventListener('scroll', function () { if (!raf) raf = requestAnimationFrame(update); }, { passive: true });
    update();
  }

  /* magnetic primaries — a 3px lean, no more */
  if (!window.matchMedia('(hover: none)').matches && !reduced) {
    document.querySelectorAll('.nav-cta, .button-light').forEach(function (el) {
      el.addEventListener('mousemove', function (e) {
        var r = el.getBoundingClientRect();
        var x = (e.clientX - r.left - r.width / 2) / r.width;
        var y = (e.clientY - r.top - r.height / 2) / r.height;
        el.style.transform = 'translate(' + (x * 5).toFixed(1) + 'px,' + (y * 3).toFixed(1) + 'px)';
      });
      el.addEventListener('mouseleave', function () { el.style.transform = ''; });
    });
  }
})();
