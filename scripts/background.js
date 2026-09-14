const DEFAULT_SPARK_COUNT = 64;
const SMALL_SCREEN_SPARK_COUNT = 30;

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function createSpark(index) {
  const spark = document.createElement("span");
  const isSoft = index % 7 === 0;
  const colors = [
    ["#c3b9ff", "#a99aef55"],
    ["#a49de2", "#9180df44"],
    ["#91cfc8", "#6abbb344"],
    ["#dac59b", "#bda16c33"],
  ];
  const [color, glow] = colors[index % 10 < 7 ? index % 2 : 2 + index % 2];
  const size = randomBetween(1.2, isSoft ? 3.2 : 2.3);
  const opacity = randomBetween(0.22, 0.65);
  const driftX = randomBetween(-100, 100);
  const duration = randomBetween(18, 34);

  spark.className = `ambient-spark${isSoft ? " ambient-spark--soft" : ""}`;
  spark.style.setProperty("--spark-color", color);
  spark.style.setProperty("--spark-glow", glow);
  spark.style.setProperty("--spark-end-x", `${randomBetween(-130, 130).toFixed(2)}px`);
  // Cross the full viewport upward, including the depth layer’s overscan.
  spark.style.setProperty("--spark-end-y", "calc(-100vh - 200px)");
  spark.style.setProperty("--spark-x", `${randomBetween(1, 99).toFixed(2)}%`);
  spark.style.setProperty("--spark-y", "100%");
  spark.style.setProperty("--spark-size", `${size.toFixed(2)}px`);
  spark.style.setProperty("--spark-opacity", opacity.toFixed(2));
  spark.style.setProperty("--spark-opacity-soft", (opacity * 0.42).toFixed(2));
  spark.style.setProperty("--spark-opacity-high", (opacity * 0.78).toFixed(2));
  spark.style.setProperty("--spark-duration", `${duration.toFixed(2)}s`);
  spark.style.setProperty("--spark-delay", `${randomBetween(-duration, 0).toFixed(2)}s`);
  spark.style.setProperty("--spark-drift-x", `${driftX.toFixed(2)}px`);
  spark.style.setProperty("--spark-drift-y", "calc(-65vh - 130px)");
  spark.style.setProperty("--spark-drift-mid-x", `${randomBetween(-70, 70).toFixed(2)}px`);
  spark.style.setProperty("--spark-drift-mid-y", "calc(-30vh - 60px)");

  return spark;
}

export function initializeAmbientBackground() {
  const sparkField = document.getElementById("ambientSparks");

  if (!sparkField || sparkField.childElementCount) return;

  const count = window.matchMedia("(max-width: 700px)").matches
    ? SMALL_SCREEN_SPARK_COUNT
    : DEFAULT_SPARK_COUNT;
  const fragment = document.createDocumentFragment();

  for (let index = 0; index < count; index += 1) {
    fragment.appendChild(createSpark(index));
  }

  sparkField.appendChild(fragment);
}
