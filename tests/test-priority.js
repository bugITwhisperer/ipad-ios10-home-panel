/* Zakupy/ToDo: Todoist p1 (red flag) goes to the top, with a red bar.
   Run from the repo root:  node --test
   Numbers match the agreed test list (P1–P11). Manual tests on the iPad: PM1–PM4. */
"use strict";
process.env.TZ = "Europe/Warsaw";
var test = require("node:test");
var assert = require("node:assert/strict");
var h = require("./helpers");

function plain(x) { return x === undefined ? x : JSON.parse(JSON.stringify(x)); }
function same(actual, expected, msg) { assert.deepEqual(plain(actual), plain(expected), msg); }
function waw(iso) { return new Date(iso + "+02:00"); }

var NOW = waw("2026-10-08T18:00:00");
var PZ = "6Xzak0000001", PT = "6Xtodo000002";

/* Todoist API v1: priority 4 = p1 (red), 3 = p2, 2 = p3, 1 = no flag */
function task(id, content, projectId, priority) {
  var t = { id: id, content: content, project_id: projectId, checked: false };
  if (priority !== undefined) t.priority = priority;
  return t;
}
function doneTask(id, content, projectId, at, priority) {
  var t = { id: id, content: content, project_id: projectId, checked: true,
            completed_at: at.toISOString() };
  if (priority !== undefined) t.priority = priority;
  return t;
}
function page(results, cursor) { return { results: results, next_cursor: cursor || null }; }
function donePage(items) { return { items: items, next_cursor: null }; }
function actEvent(objectId, content, projectId, at) {
  return { event_type: "completed", object_type: "item", object_id: objectId,
           parent_project_id: projectId, event_date: at.toISOString(),
           extra_data: { content: content, is_recurring: true } };
}

function fakeDeps(opts) {
  opts = opts || {};
  var calls = [];
  var pages = { active: opts.active || [page([])],
                done: opts.done || [donePage([])],
                activity: opts.activity || [page([])] };
  return {
    calls: calls, secret: "s3cret", token: "tok",
    projects: { zakupy: PZ, todo: PT },
    now: NOW, dayOf: h.dayOf,
    api: function (method, path, params) {
      calls.push(method + " " + path);
      if (path === "/tasks/filter") return { code: 200, body: pages.active.shift() || page([]) };
      if (path === "/tasks/completed/by_completion_date") return { code: 200, body: pages.done.shift() || donePage([]) };
      if (path === "/activities") return { code: 200, body: pages.activity.shift() || page([]) };
      return { code: 404, body: null };
    }
  };
}
function load(d) { return h.loadGScript().handle({ key: "s3cret" }, d); }
function texts(list) { return list.map(function (i) { return i.text; }); }

/* ======================= Apps Script (apps-script/Code.gs) ======================= */

test("P1 Todoist priority 4 (p1) -> urgent: true", function () {
  var out = load(fakeDeps({ active: [page([task("a1", "leki psa", PZ, 4)])] }));
  same(out.zakupy, [{ id: "a1", text: "leki psa", done: false, urgent: true }]);
});

test("P2 priority 1/2/3 (no flag, p2, p3) -> no urgent field, shape unchanged", function () {
  var out = load(fakeDeps({ active: [page([
    task("b1", "a", PT, 1), task("b2", "b", PT, 2), task("b3", "c", PT, 3)
  ])] }));
  same(out.todo, [
    { id: "b1", text: "a", done: false },
    { id: "b2", text: "b", done: false },
    { id: "b3", text: "c", done: false }
  ]);
});

test("P3 order: p1 -> other active -> done today; Todoist order kept inside each group", function () {
  var out = load(fakeDeps({
    active: [page([
      task("a1", "mleko", PZ, 1), task("a2", "karma", PZ, 4),
      task("a3", "chleb", PZ, 3), task("a4", "żwirek", PZ, 4)
    ])],
    done: [donePage([doneTask("a5", "masło", PZ, waw("2026-10-08T09:00:00"), 1)])]
  }));
  same(texts(out.zakupy), ["karma", "żwirek", "mleko", "chleb", "masło"]);
});

test("P4 missing or odd priority -> ordinary task, no crash", function () {
  var out = load(fakeDeps({ active: [page([
    task("b1", "brak", PT), task("b2", "zero", PT, 0), task("b3", "pięć", PT, 5),
    task("b4", "tekst", PT, "4"), task("b5", "null", PT, null)
  ])] }));
  assert.equal(out.ok, true);
  same(texts(out.todo), ["brak", "zero", "pięć", "tekst", "null"], "order unchanged");
  out.todo.forEach(function (it) { assert.equal(it.urgent, undefined, it.text + " must not be urgent"); });
});

test("P5 p1 done today -> at the bottom, struck through, without urgent", function () {
  var out = load(fakeDeps({
    active: [page([task("b1", "zwykłe", PT, 1)])],
    done: [donePage([doneTask("b2", "pilne zrobione", PT, waw("2026-10-08T10:00:00"), 4)])]
  }));
  same(out.todo, [
    { id: "b1", text: "zwykłe", done: false },
    { id: "b2", text: "pilne zrobione", done: true }
  ]);
});

test("P6 recurring p1 (active again + ticked today) -> shown once, active, urgent", function () {
  var out = load(fakeDeps({
    active: [page([task("b1", "zwykłe", PT, 1), task("b9", "tabletka", PT, 4)])],
    done: [donePage([doneTask("b9", "tabletka", PT, waw("2026-10-08T08:00:00"), 4)])],
    activity: [page([actEvent("b9", "tabletka", PT, waw("2026-10-08T08:00:00"))])]
  }));
  same(out.todo, [
    { id: "b9", text: "tabletka", done: false, urgent: true },
    { id: "b1", text: "zwykłe", done: false }
  ]);
});

test("P7 pagination: p1 from page 2 still goes to the top; still 3 calls", function () {
  var d = fakeDeps({ active: [
    page([task("a1", "mleko", PZ, 1), task("a2", "chleb", PZ, 1)], "cur2"),
    page([task("a3", "karma", PZ, 4)])
  ] });
  var out = load(d);
  same(texts(out.zakupy), ["karma", "mleko", "chleb"]);
  assert.equal(d.calls.filter(function (c) { return c !== "GET /tasks/filter"; }).length, 2,
               "only the extra page is new; done + activity calls unchanged");
});

/* ======================= iPad page (index.html) ======================= */

function htmlFor(data) {
  var p = h.loadPanel();
  var ls = p.createListState();
  p.onFetchResult(ls, data);
  return p.listsHtml(ls, 8);
}

test("P8 urgent -> class=\"item urgent\"; text and id still escaped", function () {
  var html = htmlFor({ ok: true, todo: [], zakupy: [
    { id: "6Xa1", text: '<b>ser</b> & "wino"', done: false, urgent: true },
    { id: "6Xa2", text: "chleb", done: false }
  ] });
  assert.match(html, /class="item urgent"[^>]*data-id="6Xa1"[^>]*>&lt;b&gt;ser&lt;\/b&gt; &amp; &quot;wino&quot;</);
  assert.match(html, /class="item"[^>]*data-id="6Xa2"[^>]*>chleb</, "ordinary item unchanged");
  assert.doesNotMatch(html, /<b>ser/);
});

test("P9 done + urgent -> struck through, no red bar", function () {
  var html = htmlFor({ ok: true, todo: [], zakupy: [
    { id: "6Xa1", text: "karma", done: true, urgent: true }
  ] });
  assert.match(html, /class="item done"[^>]*data-id="6Xa1"/);
  assert.doesNotMatch(html, /urgent/);
});

test("P9b tapping an urgent item strikes it and drops the bar at once", function () {
  var p = h.loadPanel();
  var ls = p.createListState();
  p.onFetchResult(ls, { ok: true, todo: [], zakupy: [
    { id: "6Xa1", text: "karma", done: false, urgent: true }
  ] });
  p.tickStart(ls, "zakupy", "6Xa1");
  var html = p.listsHtml(ls, 8);
  assert.match(html, /class="item done"[^>]*data-id="6Xa1"/);
  assert.doesNotMatch(html, /urgent/);
});

test("P10 the panel does not sort: HTML order = server order", function () {
  var html = htmlFor({ ok: true, todo: [], zakupy: [
    { id: "6Xa1", text: "mleko", done: false },
    { id: "6Xa2", text: "karma", done: false, urgent: true },
    { id: "6Xa3", text: "chleb", done: true }
  ] });
  var order = html.match(/data-id="[^"]+"/g);
  same(order, ['data-id="6Xa1"', 'data-id="6Xa2"', 'data-id="6Xa3"']);
});

function css() {
  return h.readRepoFile("index.html").match(/<style>([\s\S]*?)<\/style>/)[1];
}
function rule(sel) {
  var esc = sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  var m = css().match(new RegExp("(^|\\n)" + esc + "\\s*\\{([^}]*)\\}"));
  assert.ok(m, "CSS rule not found: " + sel);
  return m[2];
}
function hexOf(body) {
  var m = body.match(/border-left-color:\s*#([0-9a-fA-F]{6})/);
  assert.ok(m, "border-left-color #rrggbb missing");
  return m[1].toLowerCase();
}
function isRed(hex) {
  var r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
  return r >= 150 && r > g * 2 && r > b * 2;
}

test("P11 CSS: .item.urgent has a wider red left bar, in both themes", function () {
  var dark = rule(".item.urgent");
  var w = dark.match(/border-left-width:\s*(\d+)px/);
  assert.ok(w, "border-left-width in px (iOS 10)");
  assert.ok(+w[1] > 3, "wider than the normal 3px bar");
  assert.ok(isRed(hexOf(dark)), "dark theme bar is red");
  /* body.light .item outranks .item.urgent, so light needs its own rule */
  var light = rule("body.light .item.urgent");
  assert.ok(isRed(hexOf(light)), "light theme bar is red");
});
