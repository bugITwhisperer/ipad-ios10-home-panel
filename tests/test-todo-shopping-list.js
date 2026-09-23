/* Stage C — Zakupy/ToDo. Run from the repo root:  node --test
   Numbers match the agreed test list. Manual tests 21–23 (iPad) are not here. */
"use strict";
process.env.TZ = "Europe/Warsaw";
var test = require("node:test");
var assert = require("node:assert/strict");
var h = require("./helpers");

/* code under test runs in its own sandbox, so its objects have a different
   prototype; compare plain data, not object identity */
function plain(x) { return x === undefined ? x : JSON.parse(JSON.stringify(x)); }
function same(actual, expected, msg) { assert.deepEqual(plain(actual), plain(expected), msg); }

/* Warsaw wall-clock -> Date (explicit offsets, so TZ of the machine never matters) */
function waw(iso, offset) { return new Date(iso + (offset || "+02:00")); }

var TODAY = "2026-09-23";
var NOW = waw("2026-09-23T18:00:00");

/* one sheet row as Apps Script returns it: [checkbox, Date col, text, "Zrobione o"] */
function row(done, text, doneAt) { return [done, "", text, doneAt === undefined ? "" : doneAt]; }

/* fake Sheet access for handle() */
function fakeDeps(sheets) {
  var calls = { read: [], write: [] };
  return {
    calls: calls,
    secret: "s3cret",
    today: TODAY,
    dayOf: h.dayOf,
    now: NOW,
    readRows: function (name) { calls.read.push(name); return sheets[name] || []; },
    lastRow: function (name) { return 3 + (sheets[name] || []).length; },
    writeRow: function (name, r, values) { calls.write.push({ name: name, row: r, values: values }); }
  };
}

/* ======================= A. Apps Script (gscript/Code.gs) ======================= */

test("A1 both lists come back in sheet order", function () {
  var g = h.loadGScript();
  var d = fakeDeps({
    "Zakupy": [row(false, "mleko"), row(false, "chleb")],
    "To do":  [row(false, "odkurzyć"), row(false, "weterynarz")]
  });
  var out = g.handle({ key: "s3cret" }, d);
  assert.equal(out.ok, true);
  same(out.zakupy.map(function (i) { return i.text; }), ["mleko", "chleb"]);
  same(out.todo.map(function (i) { return i.text; }), ["odkurzyć", "weterynarz"]);
  same(out.zakupy.map(function (i) { return i.row; }), [4, 5], "data starts at row 4");
});

test("A2 empty and whitespace-only rows are skipped", function () {
  var g = h.loadGScript();
  var r = g.readList([row(false, ""), row(false, "   "), row(false, "jajka"), row(false, "")],
                     TODAY, h.dayOf, NOW);
  same(r.items, [{ row: 6, text: "jajka", done: false }]);
});

test("A3 done yesterday is hidden, done today is visible and marked done", function () {
  var g = h.loadGScript();
  var r = g.readList([
    row(true,  "mleko", waw("2026-09-22T20:00:00")),
    row(true,  "chleb", waw("2026-09-23T08:00:00")),
    row(false, "masło")
  ], TODAY, h.dayOf, NOW);
  same(r.items, [
    { row: 5, text: "chleb", done: true },
    { row: 6, text: "masło", done: false }
  ]);
});

test("A3b ticked in Sheets app (no time yet) stays visible and gets a time filled in", function () {
  var g = h.loadGScript();
  var r = g.readList([row(true, "kawa", "")], TODAY, h.dayOf, NOW);
  same(r.items, [{ row: 4, text: "kawa", done: true }]);
  assert.equal(r.fills.length, 1);
  assert.equal(r.fills[0].row, 4);
  assert.equal(r.fills[0].doneAt.getTime(), NOW.getTime());
});

test("A4 midnight boundary in Warsaw time", function () {
  var g = h.loadGScript();
  var r = g.readList([
    row(true, "przed", waw("2026-09-22T23:59:00")),
    row(true, "po",    waw("2026-09-23T00:00:00"))
  ], TODAY, h.dayOf, NOW);
  same(r.items.map(function (i) { return i.text; }), ["po"]);
});

test("A4b DST change day (25 Oct 2026, clocks go back)", function () {
  var g = h.loadGScript();
  var now = waw("2026-10-25T12:00:00", "+01:00");
  var r = g.readList([
    row(true, "sobota 23:30", waw("2026-10-24T23:30:00", "+02:00")),
    row(true, "niedziela 00:30", waw("2026-10-25T00:30:00", "+02:00")),
    row(true, "niedziela 23:30", waw("2026-10-25T23:30:00", "+01:00"))
  ], "2026-10-25", h.dayOf, now);
  same(r.items.map(function (i) { return i.text; }),
                   ["niedziela 00:30", "niedziela 23:30"]);
});

test("A5 wrong or missing key returns an error and reads nothing", function () {
  var g = h.loadGScript();
  [{}, { key: "" }, { key: "zly" }].forEach(function (params) {
    var d = fakeDeps({ "Zakupy": [row(false, "mleko")] });
    var out = g.handle(params, d);
    assert.equal(out.ok, false);
    assert.equal(out.error, "auth");
    assert.equal(out.zakupy, undefined);
    assert.equal(d.calls.read.length, 0, "sheet must not be read");
  });
});

test("A5b empty secret in Script Properties never authorizes", function () {
  var g = h.loadGScript();
  var d = fakeDeps({});
  d.secret = "";
  assert.equal(g.handle({ key: "" }, d).ok, false);
});

test("A6 tick writes done + time, untick clears both", function () {
  var g = h.loadGScript();
  var d = fakeDeps({ "Zakupy": [row(false, "mleko")] });
  assert.equal(g.handle({ key: "s3cret", tick: "zakupy", row: "4", done: "1" }, d).ok, true);
  same(d.calls.write[0].name, "Zakupy");
  assert.equal(d.calls.write[0].row, 4);
  assert.equal(d.calls.write[0].values[0], true);
  assert.equal(d.calls.write[0].values[1].getTime(), NOW.getTime());

  var d2 = fakeDeps({ "To do": [row(true, "x", NOW)] });
  assert.equal(g.handle({ key: "s3cret", tick: "todo", row: "4", done: "0" }, d2).ok, true);
  same(d2.calls.write[0].values, [false, ""]);
});

test("A7 tick on a bad list or row returns an error and writes nothing", function () {
  var g = h.loadGScript();
  var bad = [
    { tick: "inne", row: "4", done: "1" },     /* unknown list */
    { tick: "zakupy", row: "3", done: "1" },   /* header row */
    { tick: "zakupy", row: "99", done: "1" },  /* past the end */
    { tick: "zakupy", row: "abc", done: "1" }, /* not a number */
    { tick: "zakupy", row: "5", done: "1" },   /* empty row (no text) */
    { tick: "zakupy", row: "4", done: "x" }    /* done must be 0 or 1 */
  ];
  bad.forEach(function (p) {
    var d = fakeDeps({ "Zakupy": [row(false, "mleko"), row(false, "")] });
    p.key = "s3cret";
    var out = g.handle(p, d);
    assert.equal(out.ok, false, JSON.stringify(p));
    assert.equal(out.error, "bad-tick");
    assert.equal(d.calls.write.length, 0, "no write for " + JSON.stringify(p));
  });
});

test("A7b JSONP callback name is validated (no code injection)", function () {
  var g = h.loadGScript();
  assert.equal(g.jsonpWrap("__gs1", { ok: true }), '__gs1({"ok":true})');
  assert.equal(g.jsonpWrap("alert(1);//", { ok: true }), null);
  assert.equal(g.jsonpWrap("", { ok: true }), null);
});

/* ======================= B. iPad page (index.html) ======================= */

function memStorage(initial) {
  var data = initial || {};
  return {
    getItem: function (k) { return data.hasOwnProperty(k) ? data[k] : null; },
    setItem: function (k, v) { data[k] = String(v); },
    _data: data
  };
}
var throwingStorage = {
  getItem: function () { throw new Error("QuotaExceededError"); },
  setItem: function () { throw new Error("QuotaExceededError"); }
};
var GOOD_URL = "https://script.google.com/macros/s/AKfake_ID-123/exec?key=abc";

function sampleData() {
  return {
    ok: true,
    zakupy: [{ row: 4, text: "mleko", done: false }, { row: 5, text: "chleb", done: true }],
    todo:   [{ row: 4, text: "odkurzyć", done: false }]
  };
}

test("B8 no saved URL -> setup screen", function () {
  var p = h.loadPanel();
  assert.equal(p.initialScreen(memStorage()), "setup");
});

test("B8b only a real /exec URL with a key is accepted", function () {
  var p = h.loadPanel();
  assert.equal(p.isValidExecUrl(GOOD_URL), true);
  assert.equal(p.isValidExecUrl("  " + GOOD_URL + "  "), true, "spaces from pasting are ok");
  assert.equal(p.isValidExecUrl("https://script.google.com/macros/s/AKfake/exec"), false, "no key");
  assert.equal(p.isValidExecUrl("https://docs.google.com/spreadsheets/d/1riG/edit"), false, "sheet URL");
  assert.equal(p.isValidExecUrl("https://script.googleusercontent.com/macros/echo?user_content_key=x"), false, "redirect URL");
});

test("B8c spaces and line breaks inside a pasted URL are removed, not rejected", function () {
  var p = h.loadPanel();
  var messy = "https://script.google.com/macros/s/AKfake_ID-123/exec? key=abc\n";
  assert.equal(p.isValidExecUrl(messy), true);
  var s = memStorage();
  assert.equal(p.saveUrl(s, "  https://script.google.com/macros/s/AKfake_ID-123/exec?key= abc "), true);
  assert.equal(p.getSavedUrl(s), GOOD_URL, "stored without any spaces");
});

test("B9 saved URL -> panel, setup skipped", function () {
  var p = h.loadPanel();
  var s = memStorage();
  assert.equal(p.saveUrl(s, GOOD_URL), true);
  assert.equal(p.getSavedUrl(s), GOOD_URL);
  assert.equal(p.initialScreen(s), "panel");
});

test("B10 storage that throws -> message, no crash", function () {
  var p = h.loadPanel();
  assert.equal(p.getSavedUrl(throwingStorage), null);
  assert.equal(p.saveUrl(throwingStorage, GOOD_URL), false);
  assert.equal(p.initialScreen(throwingStorage), "storage-error");
});

test("B11 two columns, done items struck through", function () {
  var p = h.loadPanel();
  var ls = p.createListState();
  p.onFetchResult(ls, sampleData());
  var html = p.listsHtml(ls, 8);
  assert.match(html, /Zakupy/);
  assert.match(html, /ToDo/);
  assert.match(html, /class="item done"[^>]*data-list="zakupy"[^>]*data-row="5"[^>]*>chleb</);
  assert.match(html, /class="item"[^>]*data-list="zakupy"[^>]*data-row="4"[^>]*>mleko</);
});

test("B12 empty list shows 'Pusto'", function () {
  var p = h.loadPanel();
  var ls = p.createListState();
  p.onFetchResult(ls, { ok: true, zakupy: [], todo: [{ row: 4, text: "x", done: false }] });
  var html = p.listsHtml(ls, 8);
  assert.equal((html.match(/Pusto/g) || []).length, 1);
});

test("B13 fetch only when the list view opens, never on a plain refresh", function () {
  var p = h.loadPanel();
  assert.equal(p.needsFetch("pogoda", "lista"), true, "rotation into the view");
  assert.equal(p.needsFetch("kalendarz", "lista"), true, "tab tap into the view");
  assert.equal(p.needsFetch("lista", "lista"), false, "60 s screen refresh while on view");
  assert.equal(p.needsFetch("lista", "pogoda"), false);
  assert.equal(p.needsFetch("pogoda", "kalendarz"), false);
});

test("B14 network error keeps the last list and shows 'offline'", function () {
  var p = h.loadPanel();
  var ls = p.createListState();
  p.onFetchResult(ls, sampleData());
  p.onFetchResult(ls, { error: "timeout" });
  assert.equal(ls.offline, true);
  var html = p.listsHtml(ls, 8);
  assert.match(html, /offline/);
  assert.match(html, /mleko/);
  p.onFetchResult(ls, sampleData());
  assert.equal(ls.offline, false, "clears on next success");
});

test("B14b auth error from the script is shown, not treated as offline", function () {
  var p = h.loadPanel();
  var ls = p.createListState();
  p.onFetchResult(ls, { ok: false, error: "auth" });
  assert.match(p.listsHtml(ls, 8), /klucz/i);
});

test("B15 tap strikes at once; server error reverts with a message", function () {
  var p = h.loadPanel();
  var ls = p.createListState();
  p.onFetchResult(ls, sampleData());
  var r = p.tickStart(ls, "zakupy", 4);
  same(r.request, { tick: "zakupy", row: 4, done: "1" });
  assert.equal(ls.data.zakupy[0].done, true, "optimistic");
  p.tickResult(ls, "zakupy", 4, false);
  assert.equal(ls.data.zakupy[0].done, false, "reverted");
  assert.match(ls.message, /Nie uda/);

  var r2 = p.tickStart(ls, "zakupy", 5);
  same(r2.request, { tick: "zakupy", row: 5, done: "0" }, "untick");
  p.tickResult(ls, "zakupy", 5, true);
  assert.equal(ls.data.zakupy[1].done, false);
});

test("B16 fast double tap -> one request", function () {
  var p = h.loadPanel();
  var ls = p.createListState();
  p.onFetchResult(ls, sampleData());
  assert.notEqual(p.tickStart(ls, "todo", 4).request, null);
  assert.equal(p.tickStart(ls, "todo", 4).request, null);
  assert.equal(ls.data.todo[0].done, true, "second tap did not flip it back");
});

test("B17 item text is shown as text, never as HTML", function () {
  var p = h.loadPanel();
  var ls = p.createListState();
  p.onFetchResult(ls, { ok: true, todo: [],
    zakupy: [{ row: 4, text: '<b>ser</b> & "wino"', done: false }] });
  var html = p.listsHtml(ls, 8);
  assert.doesNotMatch(html, /<b>ser/);
  assert.match(html, /&lt;b&gt;ser&lt;\/b&gt; &amp; &quot;wino&quot;/);
});

test("B18 repo guard: no Web App URL or key in committed code", function () {
  var html = h.readRepoFile("index.html");
  var gs = h.readRepoFile("gscript/Code.gs");
  [html, gs].forEach(function (src) {
    assert.doesNotMatch(src, /macros\/s\/AK[\w-]{10,}/, "deployment URL found");
    assert.doesNotMatch(src, /[?&]key=[A-Za-z0-9]{6,}/, "key found");
  });
  assert.match(gs, /PropertiesService/, "key must come from Script Properties");
});

test("B19 more items than fit -> '+N więcej'; tap expands", function () {
  var p = h.loadPanel();
  var ls = p.createListState();
  var many = [];
  for (var i = 0; i < 11; i++) many.push({ row: 4 + i, text: "p" + i, done: false });
  p.onFetchResult(ls, { ok: true, zakupy: many, todo: [] });
  var html = p.listsHtml(ls, 8);
  assert.match(html, /\+3 więcej/);
  assert.doesNotMatch(html, />p8</);
  p.expandList(ls, "zakupy");
  html = p.listsHtml(ls, 8);
  assert.doesNotMatch(html, /więcej/);
  assert.match(html, />p10</);
});

test("B20 expanded column collapses when rotation resumes", function () {
  var p = h.loadPanel();
  var ls = p.createListState();
  var state = p.createState();
  var t0 = waw("2026-09-23T12:00:00");
  p.onTouch(state, t0, "2026-09-23T06:40");
  p.expandList(ls, "zakupy");
  p.collapseIfIdle(ls, state, new Date(t0.getTime() + p.PAUSE_MS - 1000));
  assert.equal(ls.expanded.zakupy, true, "still inside the 5 min pause");
  p.collapseIfIdle(ls, state, new Date(t0.getTime() + p.PAUSE_MS));
  assert.equal(ls.expanded.zakupy, false, "pause over -> collapsed");
});

/* ---- JSONP transport (replaces XHR after test 21) ---- */

function fakeEnv() {
  var timers = [], appended = [];
  var env = {
    window: {},
    setTimeout: function (fn, ms) { timers.push({ fn: fn, ms: ms, live: true }); return timers.length - 1; },
    clearTimeout: function (id) { if (timers[id]) timers[id].live = false; },
    document: {
      createElement: function () { return { parentNode: null }; },
      body: {
        appendChild: function (el) { el.parentNode = this; appended.push(el); },
        removeChild: function (el) { el.parentNode = null; }
      }
    }
  };
  env.fireTimeouts = function () { timers.forEach(function (t) { if (t.live) { t.live = false; t.fn(); } }); };
  env.appended = appended;
  env.timers = timers;
  return env;
}

test("B24a JSONP request: callback param, success, cleanup", function () {
  var p = h.loadPanel();
  var env = fakeEnv(), got = [];
  p.jsonpRequest(env, GOOD_URL, { tick: "zakupy", row: 4, done: "1" },
                 function (res) { got.push(res); });
  var s = env.appended[0];
  var cb = s.src.match(/[?&]callback=([^&]+)/)[1];
  assert.match(s.src, /^https:\/\/script\.google\.com\/macros\/s\/AKfake_ID-123\/exec\?key=abc&/);
  assert.match(s.src, /&tick=zakupy&row=4&done=1/);
  env.window[cb]({ ok: true });
  same(got, [{ ok: true }]);
  assert.equal(s.parentNode, null, "script tag removed");
  assert.equal(env.timers[0].live, false, "timeout cleared");
});

test("B24b JSONP timeout after 15 s -> error once; late answer ignored", function () {
  var p = h.loadPanel();
  var env = fakeEnv(), got = [];
  p.jsonpRequest(env, GOOD_URL, {}, function (res) { got.push(res); });
  assert.equal(env.timers[0].ms, 15000);
  var cb = env.appended[0].src.match(/[?&]callback=([^&]+)/)[1];
  env.fireTimeouts();
  same(got, [{ error: "timeout" }]);
  if (typeof env.window[cb] === "function") env.window[cb]({ ok: true });
  assert.equal(got.length, 1, "late answer must not call back again");
});

test("B24c JSONP script load error -> network error", function () {
  var p = h.loadPanel();
  var env = fakeEnv(), got = [];
  p.jsonpRequest(env, GOOD_URL, {}, function (res) { got.push(res); });
  env.appended[0].onerror();
  same(got, [{ error: "network" }]);
});

test("B24d each request gets its own callback name", function () {
  var p = h.loadPanel();
  var env = fakeEnv();
  p.jsonpRequest(env, GOOD_URL, {}, function () {});
  p.jsonpRequest(env, GOOD_URL, {}, function () {});
  var a = env.appended[0].src.match(/callback=([^&]+)/)[1];
  var b = env.appended[1].src.match(/callback=([^&]+)/)[1];
  assert.notEqual(a, b);
});

/* ---- C. layout on the real iPad (iOS 10 Safari) ---- */

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

test("C1 columns split the width evenly on iOS 10 (no unitless flex-basis 0)", function () {
  var col = rule(".col");
  assert.match(col, /flex:\s*1 1 0%/, "flex-basis must be 0% - old Safari ignores a bare 0");
  assert.match(col, /(^|[;\s])width:\s*0[;\s]/, "width: 0 so long text cannot push the column wider");
  assert.match(col, /-webkit-box-flex:\s*1/, "old -webkit-box fallback kept");
  assert.doesNotMatch(css(), /flex:\s*[\d.]+\s+[\d.]+\s+0\s*;/, "no bare 0 basis anywhere");
});

test("C2 long item text wraps and is fully visible", function () {
  var item = rule(".item");
  assert.match(item, /white-space:\s*normal/);
  assert.match(item, /word-wrap:\s*break-word/, "long words without spaces break too");
  assert.doesNotMatch(item, /nowrap|ellipsis/, "no cutting off with ...");
  assert.doesNotMatch(css(), /\.item[^{]*\{[^}]*(nowrap|ellipsis)/, "no other .item rule cuts text");
});

test("C3 a column taller than the screen scrolls instead of spilling out", function () {
  var col = rule(".col");
  assert.match(col, /max-height:\s*\d+px/);
  assert.match(col, /overflow-y:\s*auto/);
  assert.match(col, /-webkit-overflow-scrolling:\s*touch/, "momentum scroll on iOS");
});

test("C5 CSS is well-formed: every { has its }", function () {
  var s = css().replace(/\/\*[\s\S]*?\*\//g, "");
  var depth = 0, i;
  for (i = 0; i < s.length; i++) {
    if (s[i] === "{") depth++;
    if (s[i] === "}") depth--;
    assert.ok(depth >= 0 && depth <= 1, "brace out of place near: " + s.slice(Math.max(0, i - 40), i + 1));
  }
  assert.equal(depth, 0, "unclosed rule");
});
