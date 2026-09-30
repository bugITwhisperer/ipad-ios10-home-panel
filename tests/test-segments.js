/* Range segments (Jutro | 3 dni | 5 dni | 7 dni) replacing both dropdowns.
   Run from the repo root:  node --test
   Numbers match the agreed test list S1–S12. S11 = the older suites still pass,
   S12 = tests/layout-check.js. Manual M1–M3 (iPad) are not here. */
"use strict";
process.env.TZ = "Europe/Warsaw";
var test = require("node:test");
var assert = require("node:assert/strict");
var h = require("./helpers");

var HTML = h.readRepoFile("index.html");
var JS = HTML.match(/<script>([\s\S]*?)<\/script>/)[1];
function view(id) {
  return HTML.match(new RegExp('<div class="view" id="view-' + id + '">[\\s\\S]*?\\n  </div>'))[0];
}
function fn(name) {
  var m = JS.match(new RegExp("function " + name + "\\([^)]*\\) \\{[\\s\\S]*?\\n    \\}\\n"));
  assert.ok(m, "function " + name + " found in the wiring block");
  return m[0];
}
function buttons(html) { return html.match(/<button[^>]*>[^<]*<\/button>/g) || []; }

var NOW = new Date("2026-09-30T21:16:00+02:00");   /* Wednesday */
function ev(title, start, end) { return { title: title, start: start, end: end, allDay: false, who: "" }; }
function calState() {
  var p = h.loadPanel();
  var cs = p.createCalState();
  p.onCalResult(cs, { ok: true, events: [ev("Nfz internista", "2026-09-30T10:30", "2026-09-30T10:45")] },
                new Date("2026-09-30T21:10:00+02:00"));
  return { p: p, cs: cs };
}

test("S1 weather: 4 segment buttons, type=button, no <select id=\"range\">", function () {
  var p = h.loadPanel();
  var b = buttons(p.segHtml("tomorrow"));
  assert.equal(b.length, 4);
  b.forEach(function (x) { assert.match(x, /type="button"/, x); });
  assert.deepEqual(b.map(function (x) { return x.match(/data-range="([^"]+)"/)[1]; }),
                   ["tomorrow", "3", "5", "7"]);
  assert.deepEqual(b.map(function (x) { return x.match(/>([^<]*)</)[1]; }),
                   ["Jutro", "3 dni", "5 dni", "7 dni"]);
  assert.doesNotMatch(HTML, /<select id="range">/);
  assert.match(view("pogoda"), /<div class="seg" id="range"><\/div>/);
});

test("S2 calendar: its own segment container, no <select id=\"cal-range\">", function () {
  assert.doesNotMatch(HTML, /<select id="cal-range">/);
  assert.doesNotMatch(HTML, /<select/, "no dropdown left anywhere");
  assert.match(view("kalendarz"), /<div class="seg" id="cal-range"><\/div>/);
});

test("S3 position: above 'Dzisiaj' in both views, not in the top bar", function () {
  var w = view("pogoda");
  assert.ok(w.indexOf('id="now"') < w.indexOf('id="range"'), "below current conditions");
  assert.ok(w.indexOf('id="range"') < w.indexOf('id="head-today"'), "above Dzisiaj");
  var c = view("kalendarz");
  assert.ok(c.indexOf('id="cal-range"') < c.indexOf('id="kalendarz"'), "above the columns");
  var top = HTML.match(/<div class="top">[\s\S]*?<div class="view"/)[0];
  assert.doesNotMatch(top, /id="range"|id="cal-range"/);
});

test("S4 exactly one segment is lit; picking changes only its own range", function () {
  var p = h.loadPanel();
  ["tomorrow", "3", "5", "7"].forEach(function (v) {
    var on = buttons(p.segHtml(v)).filter(function (x) { return /class="on"/.test(x); });
    assert.equal(on.length, 1, v);
    assert.match(on[0], new RegExp('data-range="' + v + '"'));
  });
  var r = p.createRanges();
  assert.equal(r.range, "tomorrow");
  assert.equal(r["cal-range"], "tomorrow");
  assert.equal(p.pickRange(r, "range", "5"), true);
  assert.equal(r.range, "5");
  assert.equal(p.pickRange(r, "range", "5"), false, "same value = nothing to repaint");
  assert.equal(p.pickRange(r, "range", "9"), false, "unknown value ignored");
  assert.equal(p.pickRange(r, "other", "3"), false, "unknown segment ignored");
  assert.equal(r.range, "5");
});

test("S5 weather and calendar ranges are independent", function () {
  var p = h.loadPanel();
  var r = p.createRanges();
  p.pickRange(r, "range", "7");
  assert.equal(r["cal-range"], "tomorrow");
  p.pickRange(r, "cal-range", "3");
  assert.equal(r.range, "7");
  var pw = fn("paintWeather"), pc = fn("paintCal");
  assert.match(pw, /ranges\.range/);
  assert.doesNotMatch(pw, /cal-range/);
  assert.match(pc, /ranges\["cal-range"\]/);
  assert.doesNotMatch(pc, /ranges\.range\b/);
});

test("S6 weather header: 'Jutro' / 'Najbliższe N dni', never 'Najbliższych'", function () {
  var p = h.loadPanel();
  assert.equal(p.rangeHead("tomorrow"), "Jutro");
  assert.equal(p.rangeHead("3"), "Najbliższe 3 dni");
  assert.equal(p.rangeHead("7"), "Najbliższe 7 dni");
  assert.doesNotMatch(HTML, /Najbli(ż|\\u017c)szych/);
  assert.match(fn("paintWeather"), /rangeHead\(/);
});

test("S7 calendar right column header shows the chosen range", function () {
  var x = calState();
  var html = x.p.calHtml(x.cs, NOW, "5", 5);
  var right = html.split('<div class="col">')[2];
  assert.ok(right.indexOf("Najbliższe 5 dni") > -1, "header in the right column");
  assert.ok(right.indexOf("Najbliższe 5 dni") < right.indexOf("Cz 01.10"), "above the first day");
  html = x.p.calHtml(x.cs, NOW, "tomorrow", 5);
  assert.match(html, /Jutro · Cz 01\.10/);
  assert.doesNotMatch(html, /Najbliższe/);
});

test("S8 calendar left column: 'Dzisiaj · Śr 30.09'", function () {
  var x = calState();
  var html = x.p.calHtml(x.cs, NOW, "3", 5);
  assert.match(html, /Dzisiaj · Śr 30\.09/);
  assert.doesNotMatch(html, /Dziś ·/);
});

test("S9 tap on a segment pauses rotation, no page reload", function () {
  var m = JS.match(/var seg = withAttr\(t, "data-range"\);[\s\S]*?if \(seg\) \{([\s\S]*?)return;/);
  assert.ok(m, "#app click handler has a data-range branch");
  assert.match(m[1], /pickRange\(ranges, seg\.parentNode\.id, seg\.getAttribute\("data-range"\)\)/);
  assert.match(m[1], /touched\(null\)/);
  assert.doesNotMatch(m[1], /location|reload/);
  assert.doesNotMatch(JS, /\.onchange/, "old dropdown handlers gone");
});

test("S10 segments live inside their views, so they hide with them", function () {
  assert.doesNotMatch(JS, /el\("range"\)\.className/, "no header show/hide toggle any more");
  assert.match(JS, /el\("range"\)\.innerHTML = segHtml\(ranges\.range\)/);
  assert.match(JS, /el\("cal-range"\)\.innerHTML = segHtml\(ranges\["cal-range"\]\)/);
  assert.match(HTML, /\.seg button \{[^}]*-webkit-appearance: none/, "iOS default button look removed");
});
