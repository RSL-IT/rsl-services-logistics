// app/utils/isbot.server.js
// Wrap isbot so it works regardless of ESM/CJS shape.
import * as ns from "isbot";

let isbot;
if (typeof ns === "function") {
  isbot = ns;                   // CJS default export as callable
} else if (typeof ns.default === "function") {
  isbot = ns.default;           // ESM default export
} else if (typeof ns.isbot === "function") {
  isbot = ns.isbot;             // Named export (rare)
} else {
  isbot = () => false;          // Safety fallback
}

export default isbot;
