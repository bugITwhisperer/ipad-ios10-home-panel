/* Sheet backend (apps-script/Sheet.gs) — the Google Sheet version of Zakupy/ToDo,
   kept compatible with the current panel so you can switch back from Todoist.
   Run from the repo root:  node --test
   G1–G6 here, G7 = whole suite. */
"use strict";
process.env.TZ = "Europe/Warsaw";
var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var path = require("path");
var vm = require("vm");
var h = require("./helpers");

function loadSheet() {
  var file = path.join(__dirname, "..", "apps-script", "Sheet.gs");
  assert.ok(fs.existsSync(file), "apps-script/Sheet.gs exists");
  var sb = { module: { exports: {} }, console: console };
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(file, "utf8"), sb, { filename: "Sheet.gs" });
  return sb.module.exports;
}
function plain(x) { return JSON.parse(JSON.stringify(x)); }

var NOW = new Date("2026-09-30T20:00:00+02:00");
var dayOf = function (d) { return h.dayOf(d); };
/* rows from row 4 down: [checkbox, date, text, doneAt] */
function fakeDeps(tabs) {
  var writes = [];
  return {
    writes: writes,
    deps: {
      secret: "K", now: NOW, today: "2026-09-30", dayOf: dayOf,
      readRows: function (n) { return tabs[n] || []; },
      lastRow: function (n) { return 3 + (tabs[n] || []).length; },
      writeRow: function (n, row, v) { writes.push([n, row, v[0], v[1]]); }
    }
  };
}
function tabs() {
  return {
    "Zakupy": [[false, "", "mleko", ""], [false, "", "", ""], [true, "", "chleb", NOW]],
    "To do": [[false, "", "pranie", ""]]
  };
}

test("G1 list items are { id: row as text, text, done } — same shape as Todoist", function () {
  var s = loadSheet(), f = fakeDeps(tabs());
  var out = plain(s.handle({ key: "K" }, f.deps));
  assert.equal(out.ok, true);
  assert.deepEqual(out.zakupy, [{ id: "4", text: "mleko", done: false }, { id: "6", text: "chleb", done: true }]);
  assert.deepEqual(out.todo, [{ id: "4", text: "pranie", done: false }]);
});

test("G2 tick by id writes the checkbox and the done time into that row", function () {
  var s = loadSheet(), f = fakeDeps(tabs());
  assert.deepEqual(plain(s.handle({ key: "K", tick: "zakupy", id: "4", done: "1" }, f.deps)), { ok: true });
  assert.equal(f.writes.length, 1);
  assert.deepEqual([f.writes[0][0], f.writes[0][1], f.writes[0][2]], ["Zakupy", 4, true]);
  assert.equal(f.writes[0][3], NOW);
  s.handle({ key: "K", tick: "zakupy", id: "6", done: "0" }, f.deps);
  assert.deepEqual(f.writes[1], ["Zakupy", 6, false, ""], "unticking clears completed at");
});

test("G3 bad id -> bad-tick, nothing written", function () {
  var s = loadSheet(), f = fakeDeps(tabs());
  ["abc", "", "3", "99", "5", "4;x", undefined].forEach(function (id) {
    assert.deepEqual(plain(s.handle({ key: "K", tick: "zakupy", id: id, done: "1" }, f.deps)),
                     { ok: false, error: "bad-tick" }, "id " + id);
  });
  assert.deepEqual(plain(s.handle({ key: "K", tick: "nope", id: "4", done: "1" }, f.deps)).error, "bad-tick");
  assert.deepEqual(plain(s.handle({ key: "K", tick: "zakupy", id: "4", done: "2" }, f.deps)).error, "bad-tick");
  assert.equal(f.writes.length, 0);
});

test("G4 wrong or missing key -> auth, nothing read or written", function () {
  var s = loadSheet(), f = fakeDeps(tabs());
  [{}, { key: "x" }, { key: "" }].forEach(function (p) {
    assert.deepEqual(plain(s.handle(p, f.deps)), { ok: false, error: "auth" });
  });
  f.deps.secret = "";
  assert.deepEqual(plain(s.handle({ key: "" }, f.deps)), { ok: false, error: "auth" }, "no key configured");
  assert.equal(f.writes.length, 0);
});

test("G5 manual edit in the Sheet: untick clears completed at, tick sets it", function () {
  var s = loadSheet();
  assert.deepEqual(plain(s.sheetEditFix({ sheet: "Zakupy", row: 4, col: 1, values: [[false]] }, NOW)),
                   [{ row: 4, doneAt: "" }]);
  assert.deepEqual(plain(s.sheetEditFix({ sheet: "To do", row: 5, col: 1, values: [[true]] }, NOW)),
                   plain([{ row: 5, doneAt: NOW }]));
  assert.deepEqual(plain(s.sheetEditFix({ sheet: "Zakupy", row: 4, col: 3, values: [["x"]] }, NOW)), [], "other columns ignored");
  assert.deepEqual(plain(s.sheetEditFix({ sheet: "Inne", row: 4, col: 1, values: [[true]] }, NOW)), [], "other tabs ignored");
});

test("G6 the current panel shows and ticks items coming from the Sheet", function () {
  var s = loadSheet(), p = h.loadPanel(), f = fakeDeps(tabs());
  var ls = p.createListState();
  p.onFetchResult(ls, plain(s.handle({ key: "K" }, f.deps)));
  var html = p.listsHtml(ls, 7);
  assert.match(html, /data-list="zakupy" data-id="4">mleko</);
  assert.match(html, /class="item done" data-list="zakupy" data-id="6">chleb</);
  var r = p.tickStart(ls, "zakupy", "4");
  assert.deepEqual(plain(r.request), { tick: "zakupy", id: "4", done: "1" });
  assert.deepEqual(plain(s.handle({ key: "K", tick: r.request.tick, id: r.request.id, done: r.request.done }, f.deps)), { ok: true });
});
