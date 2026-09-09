// A slim glowing line pinned to the top of the viewport (see .scroll-progress
// in styles.css). Its width mirrors how far the page has been scrolled, so it
// reads as an alive, page-wide effect on every browser -- unlike custom
// scrollbar styling, which some engines partially or fully ignore.
const fill = document.getElementById("scrollProgressFill");

if (fill) {
  let ticking = false;

  function updateProgress() {
    ticking = false;

    const scrollTop = window.scrollY || document.documentElement.scrollTop || 0;
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    const percent = scrollable > 0 ? Math.min(100, Math.max(0, (scrollTop / scrollable) * 100)) : 0;

    fill.style.width = `${percent}%`;
  }

  function requestUpdate() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(updateProgress);
  }

  window.addEventListener("scroll", requestUpdate, { passive: true });
  window.addEventListener("resize", requestUpdate, { passive: true });

  updateProgress();
}
