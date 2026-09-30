/* Zakupy/ToDo (Todoist via Apps Script). Run from the repo root:  node --test
   Numbers match the agreed test list. Manual tests (iPad, live Todoist: D1–D5) are not here. */
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

var NOW = waw("2026-09-23T18:00:00");

/* one active Todoist task as GET /tasks/filter returns it */
function task(id, content, projectId, extra) {
  var t = { id: id, content: content, project_id: projectId, checked: false };
  for (var k in (extra || {})) t[k] = extra[k];
  return t;
}
/* one completed task as GET /tasks/completed/by_completion_date returns it */
function doneTask(id, content, projectId, completedAt) {
  return { id: id, content: content, project_id: projectId, checked: true,
           completed_at: completedAt.toISOString() };
}

var PZ = "6Xzak0000001", PT = "6Xtodo000002";   /* fake project ids */

/* fake Todoist access for handle(): api(method, path, params) -> {code, body} */
function fakeDeps(opts) {
  opts = opts || {};
  var calls = [];
  var pages = { active: opts.active || [{ results: [], next_cursor: null }],
                done:   opts.done   || [{ items: [], next_cursor: null }] };
  return {
    calls: calls,
    secret: "s3cret",
    token: "tok",
    projects: { zakupy: PZ, todo: PT },
    now: opts.now || NOW,
    dayOf: h.dayOf,
    api: function (method, path, params) {
      calls.push({ method: method, path: path, params: plain(params || {}) });
      if (opts.fail) return { code: opts.fail, body: null };
      if (method === "GET" && path === "/tasks/filter") {
        return { code: 200, body: pages.active.shift() || { results: [], next_cursor: null } };
      }
      if (method === "GET" && path === "/tasks/completed/by_completion_date") {
        return { code: 200, body: pages.done.shift() || { items: [], next_cursor: null } };
      }
      if (method === "POST" && /^\/tasks\/[^/]+\/(close|reopen)$/.test(path)) {
        return { code: 204, body: null };
      }
      return { code: 404, body: null };
    }
  };
}
function page(results, cursor) { return { results: results, next_cursor: cursor || null }; }
function donePage(items, cursor) { return { items: items, next_cursor: cursor || null }; }
function texts(list) { return list.map(function (i) { return i.text; }); }

/* ======================= A. Apps Script (apps-script/Code.gs) — Todoist ======================= */

test("A1 active tasks are split by project, in Todoist order", function () {
  var g = h.loadGScript();
  var d = fakeDeps({ active: [page([
    task("a1", "mleko", PZ), task("b1", "odkurzyć", PT),
    task("a2", "chleb", PZ), task("b2", "weterynarz", PT)
  ])] });
  var out = g.handle({ key: "s3cret" }, d);
  assert.equal(out.ok, true);
  same(texts(out.zakupy), ["mleko", "chleb"]);
  same(texts(out.todo), ["odkurzyć", "weterynarz"]);
  same(out.zakupy[0], { id: "a1", text: "mleko", done: false }, "item shape: id (string), text, done");
});

test("A2 task from another project (e.g. Inbox) is skipped; empty text too", function () {
  var g = h.loadGScript();
  var d = fakeDeps({ active: [page([
    task("x1", "prywatne", "6Xinbox00000"), task("a1", "  ", PZ), task("a2", " jajka ", PZ)
  ])] });
  var out = g.handle({ key: "s3cret" }, d);
  same(out.zakupy, [{ id: "a2", text: "jajka", done: false }]);
  same(out.todo, []);
});

test("A3 done today is visible and marked done; done yesterday is not", function () {
  var g = h.loadGScript();
  var d = fakeDeps({
    active: [page([task("a3", "masło", PZ)])],
    done: [donePage([
      doneTask("a1", "mleko", PZ, waw("2026-09-22T20:00:00")),
      doneTask("a2", "chleb", PZ, waw("2026-09-23T08:00:00"))
    ])]
  });
  var out = g.handle({ key: "s3cret" }, d);
  same(out.zakupy, [
    { id: "a3", text: "masło", done: false },
    { id: "a2", text: "chleb", done: true }
  ], "active first, then done today");
});

test("A4 'done today' window starts at Warsaw midnight, sent in UTC", function () {
  var g = h.loadGScript();
  same(g.todayRange(NOW, h.dayOf),
       { since: "2026-09-22T22:00:00Z", until: "2026-09-23T16:00:00Z" });
  var d = fakeDeps();
  g.handle({ key: "s3cret" }, d);
  var c = d.calls.filter(function (x) { return x.path === "/tasks/completed/by_completion_date"; })[0];
  assert.ok(c, "completed endpoint called");
  assert.equal(c.params.since, "2026-09-22T22:00:00Z");
  assert.equal(c.params.until, "2026-09-23T16:00:00Z");
});

test("A4b DST change days: window still starts at local midnight", function () {
  var g = h.loadGScript();
  /* 25 Oct 2026: clocks go back at 03:00, so midnight is still +02:00 */
  same(g.todayRange(waw("2026-10-25T12:00:00", "+01:00"), h.dayOf).since, "2026-10-24T22:00:00Z");
  /* 29 Mar 2026: clocks go forward at 02:00, so midnight is still +01:00 */
  same(g.todayRange(waw("2026-03-29T12:00:00", "+02:00"), h.dayOf).since, "2026-03-28T23:00:00Z");
  /* just after midnight */
  same(g.todayRange(waw("2026-09-23T00:00:30"), h.dayOf).since, "2026-09-22T22:00:00Z");
});

test("A5 wrong or missing key returns an error and calls nothing", function () {
  var g = h.loadGScript();
  [{}, { key: "" }, { key: "zly" }].forEach(function (params) {
    var d = fakeDeps();
    var out = g.handle(params, d);
    assert.equal(out.ok, false);
    assert.equal(out.error, "auth");
    assert.equal(out.zakupy, undefined);
    assert.equal(d.calls.length, 0, "Todoist must not be called");
  });
});

test("A5b empty secret in Script Properties never authorizes", function () {
  var g = h.loadGScript();
  var d = fakeDeps();
  d.secret = "";
  assert.equal(g.handle({ key: "" }, d).ok, false);
});

test("A5c missing Todoist token or project id -> 'config' error, no calls", function () {
  var g = h.loadGScript();
  var cases = [
    function (d) { d.token = ""; },
    function (d) { d.projects = { zakupy: "", todo: PT }; },
    function (d) { d.projects = { zakupy: PZ }; }
  ];
  cases.forEach(function (breakIt, i) {
    var d = fakeDeps();
    breakIt(d);
    same(g.handle({ key: "s3cret" }, d), { ok: false, error: "config" }, "case " + i);
    same(g.handle({ key: "s3cret", tick: "zakupy", id: "a1", done: "1" }, d),
         { ok: false, error: "config" }, "tick, case " + i);
    assert.equal(d.calls.length, 0, "no Todoist call, case " + i);
  });
});

test("A6 done=1 closes the task, done=0 reopens it", function () {
  var g = h.loadGScript();
  var d = fakeDeps();
  same(g.handle({ key: "s3cret", tick: "zakupy", id: "a1", done: "1" }, d), { ok: true });
  same(d.calls, [{ method: "POST", path: "/tasks/a1/close", params: {} }]);

  var d2 = fakeDeps();
  same(g.handle({ key: "s3cret", tick: "todo", id: "b7", done: "0" }, d2), { ok: true });
  same(d2.calls, [{ method: "POST", path: "/tasks/b7/reopen", params: {} }]);
});

test("A7 tick with a bad list, id or done returns an error and calls nothing", function () {
  var g = h.loadGScript();
  var bad = [
    { tick: "inne", id: "a1", done: "1" },           /* unknown list */
    { tick: "zakupy", done: "1" },                   /* no id */
    { tick: "zakupy", id: "", done: "1" },           /* empty id */
    { tick: "zakupy", id: "../projects", done: "1" },/* path tricks */
    { tick: "zakupy", id: "a1/close?x", done: "1" }, /* path tricks */
    { tick: "zakupy", id: new Array(66).join("a"), done: "1" }, /* too long */
    { tick: "zakupy", id: "a1", done: "x" }          /* done must be 0 or 1 */
  ];
  bad.forEach(function (p) {
    var d = fakeDeps();
    p.key = "s3cret";
    var out = g.handle(p, d);
    assert.equal(out.ok, false, JSON.stringify(p));
    assert.equal(out.error, "bad-tick");
    assert.equal(d.calls.length, 0, "no call for " + JSON.stringify(p));
  });
});

test("A7b JSONP callback name is validated (no code injection)", function () {
  var g = h.loadGScript();
  assert.equal(g.jsonpWrap("__gs1", { ok: true }), '__gs1({"ok":true})');
  assert.equal(g.jsonpWrap("alert(1);//", { ok: true }), null);
  assert.equal(g.jsonpWrap("", { ok: true }), null);
});

test("A8 Todoist 401/429/5xx or a thrown error -> {ok:false, error:'todoist'}, no crash", function () {
  var g = h.loadGScript();
  [401, 403, 429, 500, 503].forEach(function (code) {
    var d = fakeDeps({ fail: code });
    var out = g.handle({ key: "s3cret" }, d);
    same(out, { ok: false, error: "todoist", status: code }, "list, " + code);
    var t = g.handle({ key: "s3cret", tick: "zakupy", id: "a1", done: "1" }, fakeDeps({ fail: code }));
    same(t, { ok: false, error: "todoist", status: code }, "tick, " + code);
  });
  var d = fakeDeps();
  d.api = function () { throw new Error("DNS error"); };
  same(g.handle({ key: "s3cret" }, d), { ok: false, error: "todoist" });
});

test("A9 the filter asks for no date | today | overdue in both projects", function () {
  var g = h.loadGScript();
  var d = fakeDeps();
  g.handle({ key: "s3cret" }, d);
  var c = d.calls.filter(function (x) { return x.path === "/tasks/filter"; })[0];
  assert.ok(c, "filter endpoint called");
  assert.equal(c.method, "GET");
  var q = c.params.query;
  assert.match(q, /no date/);
  assert.match(q, /today/);
  assert.match(q, /overdue/);
  assert.match(q, /#Zakupy/);
  assert.match(q, /#ToDo/);
  assert.match(q, /^\(.*\) & \(.*\)$/, "dates AND projects, both in brackets");
});

test("A10 pagination: next_cursor fetches the next page, items are joined", function () {
  var g = h.loadGScript();
  var d = fakeDeps({
    active: [page([task("a1", "mleko", PZ)], "CUR1"), page([task("a2", "chleb", PZ)])],
    done: [donePage([doneTask("a3", "ser", PZ, waw("2026-09-23T09:00:00"))], "CUR2"),
           donePage([doneTask("a4", "wino", PZ, waw("2026-09-23T10:00:00"))])]
  });
  var out = g.handle({ key: "s3cret" }, d);
  same(texts(out.zakupy), ["mleko", "chleb", "ser", "wino"]);
  var f = d.calls.filter(function (x) { return x.path === "/tasks/filter"; });
  assert.equal(f.length, 2);
  assert.equal(f[1].params.cursor, "CUR1");
  var c = d.calls.filter(function (x) { return x.path === "/tasks/completed/by_completion_date"; });
  assert.equal(c.length, 2);
  assert.equal(c[1].params.cursor, "CUR2");
});

test("A10b pagination stops after a safe number of pages", function () {
  var g = h.loadGScript();
  var endless = [];
  for (var i = 0; i < 50; i++) endless.push(page([task("a" + i, "p" + i, PZ)], "C" + i));
  var d = fakeDeps({ active: endless });
  g.handle({ key: "s3cret" }, d);
  var f = d.calls.filter(function (x) { return x.path === "/tasks/filter"; });
  assert.ok(f.length <= 10, "at most 10 pages, got " + f.length);
});

test("A11 task both active and done today (recurring) is shown once, as active", function () {
  var g = h.loadGScript();
  var d = fakeDeps({
    active: [page([task("b1", "wynieść śmieci", PT, { due: { date: "2026-09-23", is_recurring: true } })])],
    done: [donePage([doneTask("b1", "wynieść śmieci", PT, waw("2026-09-23T07:00:00"))])]
  });
  var out = g.handle({ key: "s3cret" }, d);
  same(out.todo, [{ id: "b1", text: "wynieść śmieci", done: false }]);
});

test("A12 one list load = exactly 2 Todoist calls (active + done), both GET", function () {
  var g = h.loadGScript();
  var d = fakeDeps();
  g.handle({ key: "s3cret" }, d);
  same(d.calls.map(function (x) { return x.method + " " + x.path; }).sort(),
       ["GET /tasks/completed/by_completion_date", "GET /tasks/filter"]);
});

/* ---- E. manual edits in the Sheet: onEdit keeps "Zrobione o" (col D) in step with the checkbox ---- */

/* one edit as onEdit(e) sees it: tab name, top-left row/col, 2D values */
function edit(sheet, row, col, values) { return { sheet: sheet, row: row, col: col, values: values }; }

test("E1 ticking a checkbox in col A writes the current time into col D", function () {
  var g = h.loadGScript();
  var w = g.sheetEditFix(edit("Zakupy", 5, 1, [[true]]), NOW);
  assert.equal(w.length, 1);
  assert.equal(w[0].row, 5);
  assert.equal(w[0].doneAt.getTime(), NOW.getTime());
});

test("E2 unticking a checkbox in col A clears col D", function () {
  var g = h.loadGScript();
  same(g.sheetEditFix(edit("To do", 7, 1, [[false]]), NOW), [{ row: 7, doneAt: "" }]);
  same(g.sheetEditFix(edit("To do", 7, 1, [[""]]), NOW), [{ row: 7, doneAt: "" }],
       "checkbox cleared with Delete counts as unticked");
});

test("E3 editing another column (text in C, date in D) changes nothing", function () {
  var g = h.loadGScript();
  same(g.sheetEditFix(edit("Zakupy", 5, 3, [["mleko"]]), NOW), []);
  same(g.sheetEditFix(edit("Zakupy", 5, 4, [[""]]), NOW), []);
});

test("E4 header rows 1–3 and other tabs are ignored", function () {
  var g = h.loadGScript();
  same(g.sheetEditFix(edit("Zakupy", 3, 1, [[true]]), NOW), [], "header row");
  same(g.sheetEditFix(edit("Arkusz1", 5, 1, [[true]]), NOW), [], "other tab");
  same(g.sheetEditFix(edit("Zakupy", 2, 1, [[true], [false], [true]]), NOW),
       [{ row: 4, doneAt: NOW }], "range starting in the header: only rows 4+ count");
});

test("E5 several rows at once: each row gets its own value; range wider than col A works", function () {
  var g = h.loadGScript();
  same(g.sheetEditFix(edit("Zakupy", 4, 1, [[true], [false], [true]]), NOW),
       [{ row: 4, doneAt: NOW }, { row: 5, doneAt: "" }, { row: 6, doneAt: NOW }]);
  /* rows pasted over A:C — col A is the first value in each row */
  same(g.sheetEditFix(edit("To do", 8, 1, [[false, "", "x"], [true, "", "y"]]), NOW),
       [{ row: 8, doneAt: "" }, { row: 9, doneAt: NOW }]);
  /* range B:D does not touch col A */
  same(g.sheetEditFix(edit("To do", 8, 2, [["", "x", ""]]), NOW), []);
});

test("E6 Code.gs has onEdit(e) wired to sheetEditFix and writing col D", function () {
  var gs = h.readRepoFile("apps-script/Code.gs");
  var m = gs.match(/function onEdit\(e\) \{[\s\S]*?\n\}/);
  assert.ok(m, "function onEdit(e) exists");
  assert.match(m[0], /sheetEditFix\(/, "uses the tested logic");
  assert.match(m[0], /getRange\([^)]*, 4\)/, "writes into column D");
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
    zakupy: [{ id: "6Xa1", text: "mleko", done: false }, { id: "6Xa2", text: "chleb", done: true }],
    todo:   [{ id: "6Xb1", text: "odkurzyć", done: false }]
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

test("B8d setup has a 'Wyczyść' button that empties the field (no dead 'Anuluj')", function () {
  var html = h.readRepoFile("index.html");
  var setup = html.match(/<div id="setup"[\s\S]*?<div id="lista">/)[0];
  assert.match(setup, /data-act="clear"[^>]*>Wyczy(ś|&#347;)(ć|&#263;)</, "button labelled Wyczyść");
  assert.doesNotMatch(setup, /Anuluj|data-act="cancel"/, "old button gone");
  var js = html.match(/function act\(name\) \{[\s\S]*?\n    \}\n/)[0];
  assert.match(js, /name === "clear"[\s\S]*el\("setup-url"\)\.value = ""/, "clear empties the input");
  assert.match(js, /name === "clear"[\s\S]*el\("setup-err"\)\.innerHTML = ""/, "and the error text");
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
  assert.match(html, /class="item done"[^>]*data-list="zakupy"[^>]*data-id="6Xa2"[^>]*>chleb</);
  assert.match(html, /class="item"[^>]*data-list="zakupy"[^>]*data-id="6Xa1"[^>]*>mleko</);
});

test("B12 empty list shows 'Pusto'", function () {
  var p = h.loadPanel();
  var ls = p.createListState();
  p.onFetchResult(ls, { ok: true, zakupy: [], todo: [{ id: "6Xb9", text: "x", done: false }] });
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
  var r = p.tickStart(ls, "zakupy", "6Xa1");
  same(r.request, { tick: "zakupy", id: "6Xa1", done: "1" });
  assert.equal(ls.data.zakupy[0].done, true, "optimistic");
  p.tickResult(ls, "zakupy", "6Xa1", false);
  assert.equal(ls.data.zakupy[0].done, false, "reverted");
  assert.match(ls.message, /Nie uda/);

  var r2 = p.tickStart(ls, "zakupy", "6Xa2");
  same(r2.request, { tick: "zakupy", id: "6Xa2", done: "0" }, "untick");
  p.tickResult(ls, "zakupy", "6Xa2", true);
  assert.equal(ls.data.zakupy[1].done, false);
});

test("B15b tap sends the id as text: attribute read as-is, URL-encoded", function () {
  var html = h.readRepoFile("index.html");
  assert.doesNotMatch(html, /data-row/, "old row attribute gone");
  assert.doesNotMatch(html, /Number\(item\.getAttribute\("data-id"\)\)/, "id is a string, never Number()");
  assert.match(html, /item\.getAttribute\("data-id"\)/, "tap handler reads data-id");
  var p = h.loadPanel();
  var env = fakeEnv();
  p.jsonpRequest(env, GOOD_URL, { tick: "zakupy", id: "a b&c=1", done: "1" }, function () {});
  assert.match(env.appended[0].src, /&id=a%20b%26c%3D1&/);
});

test("B16 fast double tap -> one request", function () {
  var p = h.loadPanel();
  var ls = p.createListState();
  p.onFetchResult(ls, sampleData());
  assert.notEqual(p.tickStart(ls, "todo", "6Xb1").request, null);
  assert.equal(p.tickStart(ls, "todo", "6Xb1").request, null);
  assert.equal(ls.data.todo[0].done, true, "second tap did not flip it back");
});

test("B17 item text is shown as text, never as HTML", function () {
  var p = h.loadPanel();
  var ls = p.createListState();
  p.onFetchResult(ls, { ok: true, todo: [],
    zakupy: [{ id: "6Xa1", text: '<b>ser</b> & "wino"', done: false }] });
  var html = p.listsHtml(ls, 8);
  assert.doesNotMatch(html, /<b>ser/);
  assert.match(html, /&lt;b&gt;ser&lt;\/b&gt; &amp; &quot;wino&quot;/);
});

test("B18 repo guard: no Web App URL, key or Todoist token in committed code", function () {
  var html = h.readRepoFile("index.html");
  var gs = h.readRepoFile("apps-script/Code.gs");
  [html, gs].forEach(function (src) {
    assert.doesNotMatch(src, /macros\/s\/AK[\w-]{10,}/, "deployment URL found");
    assert.doesNotMatch(src, /[?&]key=[A-Za-z0-9]{6,}/, "key found");
    assert.doesNotMatch(src, /\b[0-9a-f]{40}\b/, "Todoist token (40 hex chars) found");
  });
  assert.match(gs, /PropertiesService/, "key must come from Script Properties");
  assert.match(gs, /getProperty\("TODOIST_TOKEN"\)/, "Todoist token must come from Script Properties");
});

test("B19 more items than fit -> '+N więcej'; tap expands", function () {
  var p = h.loadPanel();
  var ls = p.createListState();
  var many = [];
  for (var i = 0; i < 11; i++) many.push({ id: "6Xp" + i, text: "p" + i, done: false });
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
  p.jsonpRequest(env, GOOD_URL, { tick: "zakupy", id: "6Xa1", done: "1" },
                 function (res) { got.push(res); });
  var s = env.appended[0];
  var cb = s.src.match(/[?&]callback=([^&]+)/)[1];
  assert.match(s.src, /^https:\/\/script\.google\.com\/macros\/s\/AKfake_ID-123\/exec\?key=abc&/);
  assert.match(s.src, /&tick=zakupy&id=6Xa1&done=1/);
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