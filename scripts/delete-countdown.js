// Reloading during the grace period leaves the saved library untouched.
export function confirmDelayedDeletion(count, commit) {
  return new Promise((resolve, reject) => {
    const notice = document.createElement("div");
    notice.className = "delete-countdown";
    notice.innerHTML = `<span class="delete-countdown-circle" aria-hidden="true"><b>5</b></span>
      <span role="status" aria-live="polite"></span><button type="button">Cancel</button>`;
    const circle = notice.querySelector(".delete-countdown-circle");
    const number = circle.querySelector("b");
    const status = notice.querySelector('[role="status"]');
    const cancel = notice.querySelector("button");
    const deadline = performance.now() + 5000;
    let previous = 0;
    let timer;
    const cleanup = () => { clearInterval(timer); notice.remove(); };
    const tick = async () => {
      const remaining = Math.max(0, deadline - performance.now());
      const seconds = Math.ceil(remaining / 1000);
      circle.style.setProperty("--remaining", `${remaining / 5000 * 360}deg`);
      if (seconds !== previous) {
        number.textContent = seconds;
        status.textContent = `${count} animation${count === 1 ? "" : "s"} deleting in ${seconds}s. Refresh or cancel to keep.`;
        previous = seconds;
      }
      if (remaining > 0) return;
      clearInterval(timer);
      cancel.disabled = true;
      status.textContent = "Deleting…";
      try { resolve(await commit()); } catch (error) { reject(error); }
      finally { cleanup(); }
    };
    cancel.addEventListener("click", () => { cleanup(); resolve(false); });
    document.body.append(notice);
    tick();
    timer = setInterval(tick, 50);
  });
}
