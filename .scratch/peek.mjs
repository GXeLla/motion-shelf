import { readFileSync } from "node:fs";
import { buildWholeAnimation, buildAnimationSections } from "../scripts/animation-code.js";
import { normalizeAnimation } from "../scripts/storage.js";

const read = (f) => {
  const t = readFileSync("animations/" + f, "utf8");
  const i = t.indexOf("{", t.indexOf("@motion-shelf"));
  return normalizeAnimation(JSON.parse(t.slice(i, t.indexOf("*/", i)).trim()));
};

const animation = read(process.argv[2] || "3d-image-turn-reveal.css");
console.log("sections: " + buildAnimationSections(animation).map((s) => s.label).join(" | "));
console.log("─".repeat(72));
console.log(buildWholeAnimation(animation));
