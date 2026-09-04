const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const postcss = require("postcss");
const test = require("node:test");

const stylesheet = path.join(__dirname, "..", "renderer", "src", "app.css");

test("renderer stylesheet is syntactically valid (#100)", () => {
  const css = fs.readFileSync(stylesheet, "utf8");

  assert.doesNotThrow(() => postcss.parse(css, { from: stylesheet }));
});

test("renderer stylesheet guard rejects an unclosed block (#100)", () => {
  assert.throws(
    () => postcss.parse(".future-regression { color: red;", { from: "fixture.css" }),
    /Unclosed block/,
  );
});
