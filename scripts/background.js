const DEFAULT_SPARK_COUNT = 90;
const SMALL_SCREEN_SPARK_COUNT = 55;

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function createSpark(index) {
  const spark = document.createElement("span");
  const isTinyStar = index % 9 === 0;
  const size = randomBetween(0.7, 1.8);
  const opacity = randomBetween(0.18, 0.62);
  const driftX = randomBetween(-10, 10);
  const driftY = randomBetween(-14, 7);

  spark.className = `ambient-spark${isTinyStar ? " ambient-spark--star" : ""}`;
  spark.style.setProperty("--spark-x", `${randomBetween(1, 99).toFixed(2)}%`);
  spark.style.setProperty("--spark-y", `${randomBetween(2, 98).toFixed(2)}%`);
  spark.style.setProperty("--spark-size", `${size.toFixed(2)}px`);
  spark.style.setProperty("--spark-cross-size", `${(size * 3.2).toFixed(2)}px`);
  spark.style.setProperty("--spark-opacity", opacity.toFixed(2));
  spark.style.setProperty("--spark-opacity-soft", (opacity * 0.42).toFixed(2));
  spark.style.setProperty("--spark-opacity-high", (opacity * 0.78).toFixed(2));
  spark.style.setProperty("--spark-duration", `${randomBetween(5.5, 12).toFixed(2)}s`);
  spark.style.setProperty("--spark-delay", `${randomBetween(-12, 0).toFixed(2)}s`);
  spark.style.setProperty("--spark-drift-x", `${driftX.toFixed(2)}px`);
  spark.style.setProperty("--spark-drift-y", `${driftY.toFixed(2)}px`);
  spark.style.setProperty("--spark-drift-mid-x", `${(driftX * 0.45).toFixed(2)}px`);
  spark.style.setProperty("--spark-drift-mid-y", `${(driftY * 0.45).toFixed(2)}px`);

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
