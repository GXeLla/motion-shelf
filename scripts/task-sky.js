// Decorative only: one SVG for distant stars, CSS for the moving foreground.
const sky = document.querySelector(".stargazing-page .ambient-background");
if (sky && !sky.querySelector(".celestial-sky")) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 1600 1000");
  svg.setAttribute("preserveAspectRatio", "xMidYMid slice");
  svg.classList.add("celestial-sky");
  svg.setAttribute("aria-hidden", "true");
  // Stable positions avoid a new sky every time the page is opened.
  let seed = 8391;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let index = 0; index < 520; index += 1) {
    const star = document.createElementNS(ns, "circle");
    star.setAttribute("cx", (random() * 1600).toFixed(1));
    star.setAttribute("cy", (random() * 1000).toFixed(1));
    star.setAttribute("r", (0.35 + random() * (index % 13 === 0 ? 1.5 : 0.65)).toFixed(2));
    star.setAttribute("fill", index % 7 === 0 ? "#ffdbad" : "#d5ece8");
    star.setAttribute("opacity", (0.15 + random() * 0.6).toFixed(2));
    svg.append(star);
  }
  const constellations = [
    [[55, 150], [118, 106], [176, 170], [240, 145], [277, 215]],
    [[1210, 120], [1280, 165], [1370, 115], [1450, 176], [1515, 138]],
    [[970, 810], [1050, 750], [1110, 828], [1205, 791], [1260, 890]],
  ];
  constellations.forEach((points) => {
    const line = document.createElementNS(ns, "polyline");
    line.setAttribute("points", points.map((point) => point.join(",")).join(" "));
    line.classList.add("sky-constellation");
    svg.append(line);
    points.forEach(([x, y]) => {
      const star = document.createElementNS(ns, "path");
      star.setAttribute("d", `M ${x - 5} ${y} h 10 M ${x} ${y - 5} v 10`);
      star.classList.add("sky-beacon");
      svg.append(star);
    });
  });
  sky.prepend(svg);
  for (let index = 0; index < 3; index += 1) {
    const meteor = document.createElement("span");
    meteor.className = "sky-meteor";
    meteor.style.setProperty("--meteor-top", `${12 + index * 28}%`);
    meteor.style.setProperty("--meteor-left", `${38 + index * 19}%`);
    meteor.style.setProperty("--meteor-delay", `${4 + index * 9}s`);
    sky.append(meteor);
  }
}
