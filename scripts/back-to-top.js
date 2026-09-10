const button = document.getElementById("backToTop");

if (button) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  let frame = 0;

  function update() {
    frame = 0;
    const y = Math.max(0, window.scrollY);
    const range = document.documentElement.scrollHeight - window.innerHeight;
    const progress = range > 0 ? Math.min(1, y / range) : 0;
    button.hidden = y < Math.max(500, window.innerHeight * 0.75);
    button.style.setProperty("--page-progress", (progress * 100).toFixed(2));
    button.style.setProperty("--orbit-turn", reduced.matches ? "0deg" : `${(progress * 100).toFixed(1)}deg`);
  }

  function requestUpdate() {
    if (!frame && !document.hidden) frame = requestAnimationFrame(update);
  }

  function resetPointer() {
    button.style.setProperty("--pointer-x", "0px");
    button.style.setProperty("--pointer-y", "0px");
  }

  button.addEventListener("pointermove", (event) => {
    if (reduced.matches || !finePointer.matches || event.pointerType !== "mouse") return;
    const rect = button.getBoundingClientRect();
    button.style.setProperty("--pointer-x", `${((event.clientX - rect.left) / rect.width - 0.5) * 8}px`);
    button.style.setProperty("--pointer-y", `${((event.clientY - rect.top) / rect.height - 0.5) * 8}px`);
  }, { passive: true });
  button.addEventListener("pointerleave", resetPointer);
  button.addEventListener("click", () => {
    // Move keyboard focus to a visible control at the destination without
    // letting focus itself jump ahead of the smooth scroll.
    document.getElementById("newAnimationButton")?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: reduced.matches ? "instant" : "smooth" });
  });
  window.addEventListener("scroll", requestUpdate, { passive: true });
  window.addEventListener("resize", requestUpdate, { passive: true });
  window.addEventListener("blur", resetPointer);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      cancelAnimationFrame(frame);
      frame = 0;
    } else requestUpdate();
  });
  reduced.addEventListener("change", () => { resetPointer(); requestUpdate(); });
  new ResizeObserver(requestUpdate).observe(document.body);
  update();
}
