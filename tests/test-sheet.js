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
var ID_MILK = "11111111-1111-4111-8111-111111111111";
var ID_BREAD = "22222222-2222-4222-8222-222222222222";
var ID_LAUNDRY = "33333333-3333-4333-8333-333333333333";
var dayOf = function (d) { return h.dayOf(d); };
/* rows from row 4 down: [checkbox, date, text, doneAt, stable id] */
function fakeDeps(tabs) {
  var writes = [];
  return {
    writes: writes,
    deps: {
      secret: "K", now: NOW, today: "2026-09-30", dayOf: dayOf,
      readRows: function (n) { return tabs[n] || []; },
      writeRow: function (n, row, v) { writes.push([n, row, v[0], v[1]]); }
    }
  };
}
function tabs() {
  return {
    "Zakupy": [[false, "", "mleko", "", ID_MILK], [false, "", "", "", ""],
               [true, "", "chleb", NOW, ID_BREAD]],
    "To do": [[false, "", "pranie", "", ID_LAUNDRY]]
  };
}

test("G1 list items use stable ids and keep the Todoist shape", function () {
  var s = loadSheet(), f = fakeDeps(tabs());
  var out = plain(s.handle({ key: "K" }, f.deps));
  assert.equal(out.ok, true);
  assert.deepEqual(out.zakupy, [{ id: ID_MILK, text: "mleko", done: false },
                                { id: ID_BREAD, text: "chleb", done: true }]);
  assert.deepEqual(out.todo, [{ id: ID_LAUNDRY, text: "pranie", done: false }]);
});

test("G2 tick by id writes the checkbox and the done time into that row", function () {
  var s = loadSheet(), f = fakeDeps(tabs());
  assert.deepEqual(plain(s.handle({ key: "K", tick: "zakupy", id: ID_MILK, done: "1" }, f.deps)), { ok: true });
  assert.equal(f.writes.length, 1);
  assert.deepEqual([f.writes[0][0], f.writes[0][1], f.writes[0][2]], ["Zakupy", 4, true]);
  assert.equal(f.writes[0][3], NOW);
  s.handle({ key: "K", tick: "zakupy", id: ID_BREAD, done: "0" }, f.deps);
  assert.deepEqual(f.writes[1], ["Zakupy", 6, false, ""], "unticking clears completed at");
});

test("G2b sort after fetch still ticks the same stable item", function () {
  var s = loadSheet(), source = tabs(), f = fakeDeps(source);
  var initial = plain(s.handle({ key: "K" }, f.deps));
  source["Zakupy"].reverse();
  assert.deepEqual(plain(s.handle({ key: "K", tick: "zakupy", id: initial.zakupy[0].id, done: "1" }, f.deps)),
                   { ok: true });
  assert.deepEqual(f.writes[0], ["Zakupy", 6, true, NOW], "writes to the moved row carrying the same ID");
});

test("G2c first read assigns stable IDs and replaces duplicates", function () {
  var s = loadSheet(), rows = [
    [false, "", "mleko", "", ID_MILK],
    [false, "", "chleb", "", ID_MILK],
    [false, "", "masło", "", ""],
    [false, "", "", "", ID_LAUNDRY]
  ];
  var generated = [ID_BREAD, ID_LAUNDRY];
  var result = s.ensureRowIds(rows, function () { return generated.shift(); });
  assert.equal(result.changed, true);
  assert.deepEqual(rows.map(function (r) { return r[4]; }), [ID_MILK, ID_BREAD, ID_LAUNDRY, ""]);
  assert.deepEqual(s.ensureRowIds(rows, function () { throw new Error("ID should already exist"); }).changed, false);
});

test("G3 bad id -> bad-tick, nothing written", function () {
  var s = loadSheet(), f = fakeDeps(tabs());
  ["abc", "", "3", "99", "5", "4;x", "44444444-4444-4444-8444-444444444444", undefined].forEach(function (id) {
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
  assert.match(html, new RegExp('data-list="zakupy" data-id="' + ID_MILK + '">mleko</'));
  assert.match(html, new RegExp('class="item done" data-list="zakupy" data-id="' + ID_BREAD + '">chleb</'));
  var r = p.tickStart(ls, "zakupy", ID_MILK);
  assert.deepEqual(plain(r.request), { tick: "zakupy", id: ID_MILK, done: "1" });
  assert.deepEqual(plain(s.handle({ key: "K", tick: r.request.tick, id: r.request.id, done: r.request.done }, f.deps)), { ok: true });
});
