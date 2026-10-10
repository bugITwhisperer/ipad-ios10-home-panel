/* "zmien adres" link pinned to the bottom of the screen (Kalendarz + Zakupy/ToDo).
   Run from the repo root:  node --test
   Manual test M7 (iPad, both themes) is not here. */
"use strict";
process.env.TZ = "Europe/Warsaw";
var test = require("node:test");
var assert = require("node:assert/strict");
var h = require("./helpers");

function css() {
  var html = h.readRepoFile("index.html");
  return html.match(/<style>([\s\S]*?)<\/style>/)[1];
}
/* body of the first rule whose selector is exactly `sel` */
function rule(sel) {
  var esc = sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  var m = css().match(new RegExp("(^|\\n)" + esc + "\\s*\\{([^}]*)\\}"));
  assert.ok(m, "CSS rule not found: " + sel);
  return m[2];
}

test("C6 'zmien adres' is pinned to the bottom, in line with the version label", function () {
  var foot = rule(".list-foot");
  assert.match(foot, /position:\s*absolute/, "pinned, not flowing under the columns");

  var verBottom = rule("#ver").match(/bottom:\s*(\d+)px/);
  assert.ok(verBottom, "#ver has a bottom offset");
  assert.match(foot, new RegExp("bottom:\\s*" + verBottom[1] + "px"), "same bottom as #ver");

  var pad = rule("#app").match(/padding:\s*(\d+)px\s+(\d+)px\s+(\d+)px\s+(\d+)px/);
  assert.ok(pad, "#app has a 4-value padding");
  assert.match(foot, new RegExp("left:\\s*" + pad[4] + "px"), "left edge = content left edge");

  assert.match(foot, /(^|[;\s])margin:\s*0[;\s]/, "no margin pushing it around");
});

test("C7 nothing else overrides the pinned link", function () {
  assert.doesNotMatch(rule(".list-foot"), /margin-top/, "old flowing margin-top gone");
  var s = css().replace(/\/\*[\s\S]*?\*\//g, "");
  var re = /([^{}]+)\{([^}]*)\}/g, m;
  while ((m = re.exec(s))) {
    var sel = m[1].replace(/^\s+|\s+$/g, "");
    if (sel.indexOf(".list-foot") === -1 || sel === ".list-foot") continue;
    assert.doesNotMatch(m[2], /position|margin/, "override in: " + sel);
  }
});
