/* Segment choices (weather range, calendar range, list picker) survive a page reload.
   Run from the repo root:  node --test
   Numbers match RM1–RM7. Manual M1–M2 (iPad, nightly reload) are not here. */
"use strict";
process.env.TZ = "Europe/Warsaw";
var test = require("node:test");
var assert = require("node:assert/strict");
var h = require("./helpers");

var HTML = h.readRepoFile("index.html");
var JS = HTML.match(/<script>([\s\S]*?)<\/script>/)[1];

function memStorage(initial) {
  var data = initial || {};
  return {
    getItem: function (k) { return data.hasOwnProperty(k) ? data[k] : null; },
    setItem: function (k, v) { data[k] = String(v); },
    _data: data
  };
}
var throwingStorage = {
  getItem: function () { throw new Error("SecurityError"); },
  setItem: function () { throw new Error("QuotaExceededError"); }
};
function plain(x) { return JSON.parse(JSON.stringify(x)); }

test("RM1 nothing saved -> defaults (Jutro, Jutro, 2w1)", function () {
  var p = h.loadPanel();
  assert.deepEqual(plain(p.loadRanges(memStorage())),
                   { "range": "tomorrow", "cal-range": "tomorrow", "list-pick": "both" });
  assert.deepEqual(plain(p.loadRanges(null)),
                   { "range": "tomorrow", "cal-range": "tomorrow", "list-pick": "both" }, "no storage at all");
});

test("RM2 a saved choice comes back after a reload (new page, same storage)", function () {
  var s = memStorage();
  var p1 = h.loadPanel();
  assert.equal(p1.saveRange(s, "range", "7"), true);
  assert.equal(p1.saveRange(s, "cal-range", "7"), true);
  assert.equal(p1.saveRange(s, "list-pick", "zakupy"), true);
  var p2 = h.loadPanel();   /* fresh page = fresh JS state */
  assert.deepEqual(plain(p2.loadRanges(s)),
                   { "range": "7", "cal-range": "7", "list-pick": "zakupy" });
});

test("RM3 each panel is saved on its own key; one never changes another", function () {
  var p = h.loadPanel();
  var s = memStorage();
  p.saveRange(s, "cal-range", "5");
  var r = p.loadRanges(s);
  assert.equal(r["cal-range"], "5");
  assert.equal(r.range, "tomorrow", "weather untouched");
  assert.equal(r["list-pick"], "both", "list untouched");
  assert.equal(Object.keys(s._data).length, 1, "only the calendar key written");
});

test("RM4 unknown or foreign values in storage -> default for that panel only", function () {
  var p = h.loadPanel();
  var s = memStorage();
  p.saveRange(s, "range", "3");
  Object.keys(s._data).forEach(function (k) { if (k.indexOf("range") < 0) delete s._data[k]; });
  var key = Object.keys(s._data)[0];
  var calKey = key.replace("range", "cal-range");
  s._data[calKey] = "9";                     /* not an option */
  var r = p.loadRanges(s);
  assert.equal(r.range, "3");
  assert.equal(r["cal-range"], "tomorrow");
  s._data[key] = "zakupy";                   /* a list value in the weather slot */
  assert.equal(p.loadRanges(s).range, "tomorrow");
});

test("RM5 saveRange refuses unknown panels or values", function () {
  var p = h.loadPanel();
  var s = memStorage();
  assert.equal(p.saveRange(s, "range", "9"), false);
  assert.equal(p.saveRange(s, "other", "3"), false);
  assert.equal(p.saveRange(s, "list-pick", "7"), false);
  assert.equal(Object.keys(s._data).length, 0);
});

test("RM6 storage that throws or is missing -> defaults, no crash", function () {
  var p = h.loadPanel();
  assert.deepEqual(plain(p.loadRanges(throwingStorage)),
                   { "range": "tomorrow", "cal-range": "tomorrow", "list-pick": "both" });
  assert.equal(p.saveRange(throwingStorage, "range", "7"), false);
  assert.equal(p.saveRange(null, "range", "7"), false);
});

test("RM7 wiring: start reads saved ranges, a tap saves the new one", function () {
  assert.match(JS, /var ranges = loadRanges\(store\);/, "start-up reads storage");
  assert.doesNotMatch(JS, /var ranges = createRanges\(\);/, "no fresh defaults on start");
  var tap = JS.match(/if \(seg\) \{[\s\S]*?return;\s*\}/);
  assert.ok(tap, "segment tap handler found");
  assert.match(tap[0], /saveRange\(store,/, "tap saves the choice");
  assert.doesNotMatch(JS, /back to Jutro after a reload/, "old comment gone");
});
