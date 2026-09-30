/* Zakupy/ToDo list picker: 2w1 | Zakupy | ToDo.
   Run from the repo root:  node --test
   Numbers match the agreed list L1–L10 (L9 = tests/layout-check.js, L10 = whole suite).
   Manual M5 (iPad) is not here. */
"use strict";
process.env.TZ = "Europe/Warsaw";
var test = require("node:test");
var assert = require("node:assert/strict");
var h = require("./helpers");

var HTML = h.readRepoFile("index.html");
var JS = HTML.match(/<script>([\s\S]*?)<\/script>/)[1];
function buttons(html) { return html.match(/<button[^>]*>[^<]*<\/button>/g) || []; }
function items(n, prefix) {
  var a = [], i;
  for (i = 1; i <= n; i++) a.push({ id: prefix + i, text: prefix + i, done: false });
  return a;
}
function state(p, z, t) {
  var ls = p.createListState();
  p.onFetchResult(ls, { ok: true, zakupy: z, todo: t });
  return ls;
}
/* texts per column, in order */
function columns(html) {
  return html.split(/<div class="col(?: expanded)?">/).slice(1).map(function (c) {
    return (c.match(/class="item[^"]*"[^>]*>[^<]*</g) || []).map(function (x) { return x.replace(/.*>/, "").replace(/<$/, ""); });
  });
}
function heads(html) {
  return (html.match(/<p class="col-head">([^<]*)<\/p>/g) || []).map(function (x) { return x.replace(/<[^>]*>/g, ""); });
}

test("L1 three segment buttons above the lists, '2w1' lit by default", function () {
  var p = h.loadPanel();
  var r = p.createRanges();
  assert.equal(r["list-pick"], "both");
  var b = buttons(p.segHtml(r["list-pick"], p.LIST_PICKS));
  assert.deepEqual(b.map(function (x) { return x.match(/>([^<]*)</)[1]; }), ["2w1", "Zakupy", "ToDo"]);
  assert.deepEqual(b.map(function (x) { return x.match(/data-range="([^"]+)"/)[1]; }), ["both", "zakupy", "todo"]);
  b.forEach(function (x) { assert.match(x, /type="button"/); });
  assert.match(b[0], /class="on"/);
  var view = HTML.match(/<div class="view" id="view-lista">[\s\S]*?\n  <\/div>/)[0];
  assert.match(view, /<div class="seg" id="list-pick"><\/div>/);
  assert.ok(view.indexOf('id="list-pick"') < view.indexOf('id="lista"'), "above the lists");
  assert.match(JS, /el\("list-pick"\)\.innerHTML = segHtml\(ranges\["list-pick"\], LIST_PICKS\)/);
});

test("L2 list choice is independent of weather and calendar ranges", function () {
  var p = h.loadPanel();
  var r = p.createRanges();
  assert.equal(p.pickRange(r, "list-pick", "todo"), true);
  assert.equal(r.range, "tomorrow");
  assert.equal(r["cal-range"], "tomorrow");
  assert.equal(p.pickRange(r, "list-pick", "3"), false, "day ranges not valid here");
  assert.equal(p.pickRange(r, "range", "zakupy"), false, "list names not valid for weather");
  assert.equal(p.pickRange(r, "range", "5"), true);
  assert.equal(r["list-pick"], "todo");
});

test("L3 '2w1' = today's layout: two columns, Zakupy and ToDo", function () {
  var p = h.loadPanel();
  var ls = state(p, items(3, "z"), items(2, "t"));
  var html = p.listsHtml(ls, 7, "both");
  assert.equal(html, p.listsHtml(ls, 7), "default is 'both'");
  assert.deepEqual(heads(html), ["Zakupy", "ToDo"]);
  assert.deepEqual(columns(html), [["z1", "z2", "z3"], ["t1", "t2"]]);
});

test("L4 one list spreads over two columns: 1–7 left, 8–14 right, header once", function () {
  var p = h.loadPanel();
  var ls = state(p, items(10, "z"), items(4, "t"));
  var html = p.listsHtml(ls, 7, "zakupy");
  assert.deepEqual(heads(html), ["Zakupy"]);
  var c = columns(html);
  assert.deepEqual(c[0], ["z1", "z2", "z3", "z4", "z5", "z6", "z7"]);
  assert.deepEqual(c[1], ["z8", "z9", "z10"]);
  assert.doesNotMatch(html, /data-list="todo"/);
  html = p.listsHtml(ls, 7, "todo");
  assert.deepEqual(heads(html), ["ToDo"]);
  assert.deepEqual(columns(html), [["t1", "t2", "t3", "t4"], []]);
});

test("L5 over 14: '+N więcej' under the right column; expanded = split in half; collapses", function () {
  var p = h.loadPanel();
  var ls = state(p, items(17, "z"), []);
  var html = p.listsHtml(ls, 7, "zakupy");
  var c = columns(html);
  assert.equal(c[0].length, 7);
  assert.equal(c[1].length, 7);
  var right = html.split(/<div class="col(?: expanded)?">/)[2];
  assert.match(right, /data-list="zakupy">\+3 wi(ę|\\u0119)cej/);
  p.expandList(ls, "zakupy");
  html = p.listsHtml(ls, 7, "zakupy");
  c = columns(html);
  assert.equal(c[0].length, 9);
  assert.equal(c[1].length, 8);
  assert.doesNotMatch(html, /wi(ę|ę)cej/);
  var st = p.createState();
  st.pausedUntil = 0;
  p.collapseIfIdle(ls, st, new Date());
  assert.equal(columns(p.listsHtml(ls, 7, "zakupy"))[1].length, 7, "collapsed again");
});

test("L6 empty single list shows 'Pusto'", function () {
  var p = h.loadPanel();
  var html = p.listsHtml(state(p, [], items(2, "t")), 7, "zakupy");
  assert.equal((html.match(/Pusto/g) || []).length, 1);
});

test("L7 tap on the list segment repaints without fetching", function () {
  var m = JS.match(/var seg = withAttr\(t, "data-range"\);[\s\S]*?if \(seg\) \{([\s\S]*?)return;/);
  assert.ok(m);
  assert.match(m[1], /touched\(null\)/);
  assert.doesNotMatch(m[1], /fetchList|jsonpRequest/);
  var pl = JS.match(/function paintList\(\) \{[\s\S]*?\n    \}\n/)[0];
  assert.match(pl, /listsHtml\(ls, LIST_MAX_ROWS, ranges\["list-pick"\]\)/);
});

test("L8 items stay tappable (data-list + data-id) in every mode", function () {
  var p = h.loadPanel();
  var ls = state(p, items(9, "z"), items(1, "t"));
  ["both", "zakupy", "todo"].forEach(function (mode) {
    var html = p.listsHtml(ls, 7, mode);
    var all = html.match(/class="item[^"]*"[^>]*>/g) || [];
    assert.ok(all.length > 0, mode);
    all.forEach(function (x) { assert.match(x, /data-list="(zakupy|todo)" data-id="[^"]+"/, mode); });
  });
});
