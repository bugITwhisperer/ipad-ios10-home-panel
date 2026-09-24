/* Calendar view. Run from the repo root:  node --test
   Numbers match the agreed test list (A1–A6 script, B7–B29 panel, 30 = whole suite).
   Extra A-tests (A0, A7, A8) carry over the stage C security rules to the new script.
   Manual tests M1–M7 (iPad) are not here. */
"use strict";
process.env.TZ = "Europe/Warsaw";
var test = require("node:test");
var assert = require("node:assert/strict");
var h = require("./helpers");

function plain(x) { return x === undefined ? x : JSON.parse(JSON.stringify(x)); }
function same(actual, expected, msg) { assert.deepEqual(plain(actual), plain(expected), msg); }

/* Warsaw wall-clock -> Date (explicit offset, so the machine's TZ never matters) */
function waw(iso, offset) { return new Date(iso + (offset || "+02:00")); }

/* "2026-09-25T22:00" for a Date, in Warsaw time — what
   Utilities.formatDate(d, "Europe/Warsaw", "yyyy-MM-dd'T'HH:mm") returns */
var fmtT = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hour12: false
});
function localIso(d) { return fmtT.format(d).replace(" ", "T"); }

var NOW = waw("2026-09-25T18:00:00");          /* Friday */
var EM = "em.test@example.com";
var DO = "dorota.test@example.com";
var PEOPLE = {}; PEOPLE[EM] = "E"; PEOPLE[DO] = "D";

/* ======================= A. Apps Script (apps-script/Calendar.gs) ======================= */

/* fake CalendarEvent — only the methods the script may call */
function gEv(title, start, end, creators, allDay) {
  return {
    getTitle: function () { return title; },
    getStartTime: function () { return start; },
    getEndTime: function () { return end; },
    isAllDayEvent: function () { return !!allDay; },
    getAllDayStartDate: function () { return start; },
    getAllDayEndDate: function () { return end; },   /* Google: the day AFTER the last day */
    getCreators: function () { return creators || []; }
  };
}

function calDeps(events, extra) {
  var calls = { getEvents: [] };
  var d = {
    calls: calls,
    secret: "s3cret",
    now: NOW,
    people: PEOPLE,
    dayOf: h.dayOf,
    localIso: localIso,
    getEvents: function (from, to) { calls.getEvents.push({ from: from, to: to }); return events; }
  };
  var k;
  for (k in (extra || {})) d[k] = extra[k];
  return d;
}

test("A0 wrong or missing key -> error, calendar not read", function () {
  var g = h.loadCalScript();
  [{}, { key: "" }, { key: "zly" }].forEach(function (p) {
    var d = calDeps([]);
    var out = g.handle(p, d);
    assert.equal(out.ok, false);
    assert.equal(out.error, "auth");
    assert.equal(d.calls.getEvents.length, 0);
  });
  var d2 = calDeps([], { secret: "" });
  assert.equal(g.handle({ key: "" }, d2).ok, false, "empty secret never authorizes");
});

test("A1 range: today 00:00 -> today + 8 days 00:00 (today + 7 more days)", function () {
  var g = h.loadCalScript();
  var r = g.calRange(NOW);
  assert.equal(r.start.getTime(), waw("2026-09-25T00:00:00").getTime());
  assert.equal(r.end.getTime(), waw("2026-10-03T00:00:00").getTime());
  var d = calDeps([]);
  g.handle({ key: "s3cret" }, d);
  assert.equal(d.calls.getEvents.length, 1);
  assert.equal(d.calls.getEvents[0].from.getTime(), r.start.getTime());
  assert.equal(d.calls.getEvents[0].to.getTime(), r.end.getTime());
});

test("A2 each event has exactly title, start, end, allDay, who", function () {
  var g = h.loadCalScript();
  var out = g.handle({ key: "s3cret" }, calDeps([
    gEv("Weterynarz", waw("2026-09-26T10:00:00"), waw("2026-09-26T11:00:00"), [EM]),
    gEv("Urlop", waw("2026-09-28T00:00:00"), waw("2026-09-30T00:00:00"), [DO], true)
  ]));
  assert.equal(out.ok, true);
  same(out.events, [
    { title: "Weterynarz", start: "2026-09-26T10:00", end: "2026-09-26T11:00", allDay: false, who: "E" },
    { title: "Urlop", start: "2026-09-28", end: "2026-09-30", allDay: true, who: "D" }
  ]);
});

test("A3 creator -> E / D / login of anyone else", function () {
  var g = h.loadCalScript();
  assert.equal(g.whoOf([EM], PEOPLE), "E");
  assert.equal(g.whoOf([DO], PEOPLE), "D");
  assert.equal(g.whoOf(["Em.Test@Example.com"], PEOPLE), "E", "case does not matter");
  assert.equal(g.whoOf(["jan.kowalski@gmail.com"], PEOPLE), "jan.kowalski");
  assert.equal(g.whoOf([], PEOPLE), "", "no creator -> no tag");
});

test("A4 no e-mail address anywhere in the response", function () {
  var g = h.loadCalScript();
  var out = g.handle({ key: "s3cret" }, calDeps([
    gEv("a", waw("2026-09-26T10:00:00"), waw("2026-09-26T11:00:00"), [EM]),
    gEv("b", waw("2026-09-26T12:00:00"), waw("2026-09-26T13:00:00"), [DO]),
    gEv("c", waw("2026-09-26T14:00:00"), waw("2026-09-26T15:00:00"), ["jan.kowalski@gmail.com"])
  ]));
  assert.doesNotMatch(JSON.stringify(out), /@/);
});

test("A5 empty calendar -> ok with an empty list", function () {
  var g = h.loadCalScript();
  same(g.handle({ key: "s3cret" }, calDeps([])), { ok: true, events: [] });
});

test("A6 calendar throws -> {ok:false, error:'server'}, no crash", function () {
  var g = h.loadCalScript();
  var d = calDeps([], { getEvents: function () { throw new Error("Calendar down"); } });
  same(g.handle({ key: "s3cret" }, d), { ok: false, error: "server" });
});

test("A7 JSONP callback name is validated (no code injection)", function () {
  var g = h.loadCalScript();
  assert.equal(g.jsonpWrap("__gc1", { ok: true }), '__gc1({"ok":true})');
  assert.equal(g.jsonpWrap("alert(1);//", { ok: true }), null);
  assert.equal(g.jsonpWrap("", { ok: true }), null);
});

test("A8 repo guard: no e-mail, deployment URL or key in Calendar.gs", function () {
  var gs = h.readRepoFile("apps-script/Calendar.gs");
  assert.doesNotMatch(gs, /[A-Za-z0-9._-]+@(gmail|example)\.com/, "e-mail found");
  assert.doesNotMatch(gs, /macros\/s\/AK[\w-]{10,}/, "deployment URL found");
  assert.match(gs, /PropertiesService/, "key and e-mails come from Script Properties");
});

test("A23 DST day (25 Oct 2026): range and hours stay on Warsaw wall clock", function () {
  var g = h.loadCalScript();
  var now = waw("2026-10-25T12:00:00", "+01:00");
  var r = g.calRange(now);
  assert.equal(r.start.getTime(), waw("2026-10-25T00:00:00", "+02:00").getTime(), "midnight still in summer time");
  assert.equal(r.end.getTime(), waw("2026-11-02T00:00:00", "+01:00").getTime());
  var out = g.handle({ key: "s3cret" }, calDeps([
    gEv("Po zmianie", waw("2026-10-25T09:00:00", "+01:00"), waw("2026-10-25T10:00:00", "+01:00"), [EM])
  ], { now: now }));
  assert.equal(out.events[0].start, "2026-10-25T09:00");
});

/* ======================= B. iPad page (index.html) ======================= */

function ev(title, start, end, who, allDay) {
  return { title: title, start: start, end: end, allDay: !!allDay, who: who || "" };
}
function titles(items) { return items.map(function (i) { return i.title; }); }

function memStorage(initial) {
  var data = initial || {};
  return {
    getItem: function (k) { return data.hasOwnProperty(k) ? data[k] : null; },
    setItem: function (k, v) { data[k] = String(v); },
    _data: data
  };
}
var CAL_URL = "https://script.google.com/macros/s/AKcal_ID-456/exec?key=xyz";
var LIST_URL = "https://script.google.com/macros/s/AKfake_ID-123/exec?key=abc";

test("B7 today: ended events struck through till midnight, running ones normal", function () {
  var p = h.loadPanel();
  var items = p.calToday([
    ev("Rano", "2026-09-25T08:00", "2026-09-25T09:00", "E"),
    ev("Trwa", "2026-09-25T17:30", "2026-09-25T19:00", "D"),
    ev("Wieczór", "2026-09-25T20:00", "2026-09-25T21:00", "E")
  ], NOW);
  same(titles(items), ["Rano", "Trwa", "Wieczór"], "nothing disappears today");
  same(items.map(function (i) { return i.past; }), [true, false, false]);
});

test("B8 an event ending exactly now is already struck through", function () {
  var p = h.loadPanel();
  var items = p.calToday([ev("Koniec teraz", "2026-09-25T17:00", "2026-09-25T18:00")], NOW);
  assert.equal(items[0].past, true);
});

test("B9 all-day event today: on top, labelled 'cały dzień', never struck", function () {
  var p = h.loadPanel();
  var items = p.calToday([
    ev("Spotkanie", "2026-09-25T19:00", "2026-09-25T20:00"),
    ev("Urodziny Kasi", "2026-09-25", "2026-09-26", "D", true)
  ], NOW);
  assert.equal(items[0].title, "Urodziny Kasi");
  assert.equal(items[0].time, "cały dzień");
  assert.equal(items[0].past, false);
});

test("B10 order: all-day first, then by start time", function () {
  var p = h.loadPanel();
  var items = p.calToday([
    ev("C", "2026-09-25T21:00", "2026-09-25T22:00"),
    ev("A", "2026-09-25T19:00", "2026-09-25T20:00"),
    ev("Cały", "2026-09-25", "2026-09-26", "", true),
    ev("B", "2026-09-25T19:30", "2026-09-25T20:00")
  ], NOW);
  same(titles(items), ["Cały", "A", "B", "C"]);
});

var WEEK = [
  ev("dziś", "2026-09-25T19:00", "2026-09-25T20:00"),
  ev("sob", "2026-09-26T10:00", "2026-09-26T11:00"),
  ev("nd", "2026-09-27T10:00", "2026-09-27T11:00"),
  ev("pn", "2026-09-28T10:00", "2026-09-28T11:00"),
  ev("wt", "2026-09-29T10:00", "2026-09-29T11:00"),
  ev("śr", "2026-09-30T10:00", "2026-09-30T11:00"),
  ev("czw", "2026-10-01T10:00", "2026-10-01T11:00"),
  ev("pt", "2026-10-02T10:00", "2026-10-02T11:00")
];

test("B11 dropdown Jutro / 3 / 5 / 7 dni counts from tomorrow", function () {
  var p = h.loadPanel();
  function dates(mode) { return p.calDays(WEEK, NOW, mode).map(function (d) { return d.date; }); }
  same(dates("tomorrow"), ["2026-09-26"]);
  same(dates("3"), ["2026-09-26", "2026-09-27", "2026-09-28"]);
  same(dates("5"), ["2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30"]);
  same(dates("7"), ["2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29",
                    "2026-09-30", "2026-10-01", "2026-10-02"]);
});

test("B12 today's events never appear in the lower section", function () {
  var p = h.loadPanel();
  var all = [];
  p.calDays(WEEK, NOW, "7").forEach(function (d) { all = all.concat(titles(d.items)); });
  assert.equal(all.indexOf("dziś"), -1);
});

test("B13 all-day event does not leak into the next day (end date is exclusive)", function () {
  var p = h.loadPanel();
  var days = p.calDays([ev("Sobota", "2026-09-26", "2026-09-27", "", true)], NOW, "3");
  same(days.map(function (d) { return titles(d.items); }), [["Sobota"], [], []]);
});

test("B14 multi-day event shows on each of its days", function () {
  var p = h.loadPanel();
  var days = p.calDays([ev("Urlop", "2026-09-26", "2026-09-29", "D", true)], NOW, "5");
  same(days.map(function (d) { return titles(d.items); }),
       [["Urlop"], ["Urlop"], ["Urlop"], [], []]);
  var today = p.calToday([ev("Wyjazd", "2026-09-24", "2026-09-27", "E", true)], NOW);
  same(titles(today), ["Wyjazd"], "started yesterday -> still on today");
});

test("B15 overnight event: both days, second day labelled 'do 02:00'", function () {
  var p = h.loadPanel();
  var e = ev("Impreza", "2026-09-26T22:00", "2026-09-27T02:00", "E");
  var days = p.calDays([e], NOW, "3");
  assert.equal(days[0].items[0].time, "22:00–02:00");
  assert.equal(days[1].items[0].time, "do 02:00");
  assert.equal(days[2].items.length, 0);
  /* 01:00 on Sunday: the running event is still in "Dziś" */
  var sunNight = waw("2026-09-27T01:00:00");
  var today = p.calToday([e], sunNight);
  same(titles(today), ["Impreza"]);
  assert.equal(today[0].past, false);
});

test("B16 day header in Polish: 'Pt 25.09'", function () {
  var p = h.loadPanel();
  assert.equal(p.calDayHead("2026-09-25"), "Pt 25.09");
  assert.equal(p.calDayHead("2026-09-27"), "Nd 27.09");
  assert.equal(p.calDayHead("2026-09-30"), "Śr 30.09");
  assert.equal(p.calDayHead("2026-10-01"), "Cz 01.10");
});

function calState(events) {
  var p = h.loadPanel();
  var cs = p.createCalState();
  p.onCalResult(cs, { ok: true, events: events }, waw("2026-09-25T17:55:00"));
  return { p: p, cs: cs };
}

test("B17 empty day -> 'Brak wydarzeń'", function () {
  var x = calState([ev("sob", "2026-09-26T10:00", "2026-09-26T11:00")]);
  var html = x.p.calHtml(x.cs, NOW, "3", 5);
  assert.equal((html.match(/Brak wydarze(ń|&#324;)/g) || []).length, 3, "today + 2 empty days");
});

test("B18 too many events -> '+N więcej'; tap expands that day", function () {
  var many = [], i;
  for (i = 0; i < 8; i++) many.push(ev("e" + i, "2026-09-26T1" + i + ":00", "2026-09-26T1" + i + ":30"));
  var x = calState(many);
  var html = x.p.calHtml(x.cs, NOW, "tomorrow", 5);
  assert.match(html, /\+3 wi(ę|&#281;)cej/);
  assert.doesNotMatch(html, />e5</);
  x.p.calExpand(x.cs, "2026-09-26");
  html = x.p.calHtml(x.cs, NOW, "tomorrow", 5);
  assert.doesNotMatch(html, /wi(ę|&#281;)cej/);
  assert.match(html, />e7</);
});

test("B19 overflow hides struck-through events first", function () {
  var p = h.loadPanel();
  var items = [
    { title: "p1", past: true }, { title: "p2", past: true }, { title: "p3", past: true },
    { title: "n1", past: false }, { title: "n2", past: false }
  ];
  var r = p.limitItems(items, 3);
  same(titles(r.shown), ["p3", "n1", "n2"], "newest past one kept, order unchanged");
  assert.equal(r.hidden, 2);
  var r2 = p.limitItems(items.slice(3).concat([{ title: "n3" }, { title: "n4" }]), 3);
  same(titles(r2.shown), ["n1", "n2", "n3"], "no past ones -> cut from the end");
});

test("B20 tags: E green, D blue, login plain", function () {
  var x = calState([
    ev("a", "2026-09-25T19:00", "2026-09-25T20:00", "E"),
    ev("b", "2026-09-25T20:00", "2026-09-25T21:00", "D"),
    ev("c", "2026-09-25T21:00", "2026-09-25T22:00", "jan.kowalski")
  ]);
  var html = x.p.calHtml(x.cs, NOW, "tomorrow", 5);
  assert.match(html, /<span class="tag tag-e">E<\/span>/);
  assert.match(html, /<span class="tag tag-d">D<\/span>/);
  assert.match(html, /<span class="tag tag-x">jan\.kowalski<\/span>/);
  var css = h.readRepoFile("index.html").match(/<style>([\s\S]*?)<\/style>/)[1];
  assert.match(css, /\.tag-e\s*\{[^}]*background-color:\s*#[0-9a-f]{3,6}/i, ".tag-e has a colour");
  assert.match(css, /\.tag-d\s*\{[^}]*background-color:\s*#[0-9a-f]{3,6}/i, ".tag-d has a colour");
  var e = css.match(/\.tag-e\s*\{[^}]*background-color:\s*(#[0-9a-f]{3,6})/i)[1];
  var d = css.match(/\.tag-d\s*\{[^}]*background-color:\s*(#[0-9a-f]{3,6})/i)[1];
  function rgb(hex) {
    hex = hex.slice(1); if (hex.length === 3) hex = hex.replace(/./g, "$&$&");
    return [0, 2, 4].map(function (i) { return parseInt(hex.substr(i, 2), 16); });
  }
  var ge = rgb(e), bd = rgb(d);
  assert.ok(ge[1] > ge[0] && ge[1] > ge[2], "E is green (" + e + ")");
  assert.ok(bd[2] > bd[0] && bd[2] > bd[1], "D is blue (" + d + ")");
});

test("B21 title and login are shown as text, never as HTML", function () {
  var x = calState([ev('<b>Obiad</b> & "wino"', "2026-09-25T19:00", "2026-09-25T20:00", "<i>x</i>")]);
  var html = x.p.calHtml(x.cs, NOW, "tomorrow", 5);
  assert.doesNotMatch(html, /<b>Obiad|<i>x/);
  assert.match(html, /&lt;b&gt;Obiad&lt;\/b&gt; &amp; &quot;wino&quot;/);
});

test("B22 long title wraps, never cut off", function () {
  var css = h.readRepoFile("index.html").match(/<style>([\s\S]*?)<\/style>/)[1];
  var m = css.match(/(^|\n)\.ev-title\s*\{([^}]*)\}/);
  assert.ok(m, "CSS rule .ev-title exists");
  assert.match(m[2], /white-space:\s*normal/);
  assert.match(m[2], /word-wrap:\s*break-word/);
  assert.doesNotMatch(css, /\.ev[^{]*\{[^}]*(nowrap|ellipsis)/, "no .ev rule cuts text");
});

test("B23 DST day (25 Oct 2026): struck / not struck by wall-clock time", function () {
  var p = h.loadPanel();
  var now = waw("2026-10-25T12:00:00", "+01:00");
  var items = p.calToday([
    ev("Było", "2026-10-25T10:00", "2026-10-25T11:30"),
    ev("Trwa", "2026-10-25T11:30", "2026-10-25T12:30")
  ], now);
  same(items.map(function (i) { return i.past; }), [true, false]);
});

test("B24 after midnight 'Dziś' is the new day, without fetching again", function () {
  var x = calState(WEEK);
  var after = waw("2026-09-26T00:05:00");
  same(titles(x.p.calToday(x.cs.data, after)), ["sob"]);
  assert.equal(x.p.calDays(x.cs.data, after, "tomorrow")[0].date, "2026-09-27");
  assert.equal(x.p.needsCalFetch("kalendarz", "kalendarz"), false, "minute refresh does not refetch");
  assert.equal(x.p.needsCalFetch("lista", "kalendarz"), true, "entering the view does");
});

test("B25 network error with data -> keep it, show 'aktualizacja HH:MM'", function () {
  var x = calState(WEEK);
  x.p.onCalResult(x.cs, { error: "timeout" }, NOW);
  var html = x.p.calHtml(x.cs, NOW, "tomorrow", 5);
  assert.match(html, /aktualizacja 17:55/);
  assert.match(html, />dziś</);
  x.p.onCalResult(x.cs, { ok: true, events: WEEK }, NOW);
  assert.doesNotMatch(x.p.calHtml(x.cs, NOW, "tomorrow", 5), /aktualizacja/, "gone after success");
});

test("B26 network error without data -> 'no connection' message; bad key -> key message", function () {
  var p = h.loadPanel();
  var cs = p.createCalState();
  p.onCalResult(cs, { error: "network" }, NOW);
  assert.match(p.calHtml(cs, NOW, "tomorrow", 5), /Brak po(ł|&#322;)(ą|&#261;)czenia z kalendarzem/);
  var cs2 = p.createCalState();
  p.onCalResult(cs2, { ok: false, error: "auth" }, NOW);
  assert.match(p.calHtml(cs2, NOW, "tomorrow", 5), /klucz/i);
});

test("B27 calendar URL has its own key; Zakupy URL untouched", function () {
  var p = h.loadPanel();
  assert.equal(p.CAL_STORAGE_KEY, "gcalUrl");
  var s = memStorage({ gscriptUrl: LIST_URL });
  assert.equal(p.calScreen(s), "setup", "no calendar URL yet -> setup");
  assert.equal(p.initialScreen(s), "panel", "list still set up");
  assert.equal(p.saveCalUrl(s, CAL_URL), true);
  assert.equal(p.getSavedCalUrl(s), CAL_URL);
  assert.equal(s._data.gscriptUrl, LIST_URL, "Zakupy URL not overwritten");
  assert.equal(p.calScreen(s), "panel");
  var html = h.readRepoFile("index.html");
  assert.match(html, /<div id="cal-setup"[\s\S]*?data-act="cal-save"/, "calendar has its own setup form");
});

test("B28 spaces and line breaks in a pasted calendar URL are removed", function () {
  var p = h.loadPanel();
  var s = memStorage();
  assert.equal(p.saveCalUrl(s, "  https://script.google.com/macros/s/AKcal_ID-456/exec? key=xyz\n"), true);
  assert.equal(p.getSavedCalUrl(s), CAL_URL);
});

test("B29 calendar dropdown is its own control, weather dropdown unchanged", function () {
  var html = h.readRepoFile("index.html");
  var sel = html.match(/<select id="cal-range">([\s\S]*?)<\/select>/);
  assert.ok(sel, "select#cal-range exists in the calendar view");
  same(sel[1].match(/value="[^"]+"/g), ['value="tomorrow"', 'value="3"', 'value="5"', 'value="7"']);
  assert.match(sel[1], />Jutro</);
  var calView = html.match(/<div class="view" id="view-kalendarz">[\s\S]*?\n  <\/div>/)[0];
  assert.match(calView, /id="cal-range"/, "inside the calendar view");
  assert.match(html, /<select id="range">/, "weather dropdown still there");
  var js = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.match(js, /el\("cal-range"\)\.onchange/, "calendar dropdown has its own handler");
  var paintW = js.match(/function paintWeather\(\) \{[\s\S]*?\n    \}\n/)[0];
  assert.doesNotMatch(paintW, /cal-range/, "weather never reads the calendar dropdown");
});
