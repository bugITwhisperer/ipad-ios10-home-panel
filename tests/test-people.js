/* Calendar tags configured outside the code: Script Property PEOPLE on the
   calendar script, e.g.  a@x.com=E:#2e9e5b, b@y.com=D:#2f6fd1
   Run from the repo root:  node --test
   P1–P6 here, P7 = whole suite. */
"use strict";
process.env.TZ = "Europe/Warsaw";
var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var path = require("path");
var h = require("./helpers");

function plain(x) { return JSON.parse(JSON.stringify(x)); }
function props(map) { return function (k) { return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null; }; }

test("P1 PEOPLE with three people -> labels and colours", function () {
  var g = h.loadCalScript();
  var p = plain(g.peopleFrom(props({ PEOPLE: "Em@X.com=E:#2e9e5b, d@y.com = D : #2F6FD1 ,k@z.pl=Kasia:#aa3300" })));
  assert.deepEqual(p, {
    "em@x.com": { label: "E", color: "#2e9e5b" },
    "d@y.com": { label: "D", color: "#2f6fd1" },
    "k@z.pl": { label: "Kasia", color: "#aa3300" }
  });
  assert.equal(g.whoOf(["EM@x.com"], p), "E", "case does not matter");
  assert.equal(g.colorOf(["d@y.com"], p), "#2f6fd1");
  assert.equal(g.colorOf(["obcy@q.com"], p), "", "others get no colour");
});

test("P2 colour is optional: palette in list order", function () {
  var g = h.loadCalScript();
  var p = plain(g.peopleFrom(props({ PEOPLE: "a@x=A, b@x=B:#123456, c@x=C" })));
  assert.equal(p["a@x"].color, g.PALETTE[0]);
  assert.equal(p["b@x"].color, "#123456");
  assert.equal(p["c@x"].color, g.PALETTE[2]);
});

test("P3 bad colour or entry is not trusted", function () {
  var g = h.loadCalScript();
  var p = plain(g.peopleFrom(props({ PEOPLE: "a@x=A:red;x, b@x=B:#12345, =C, d@x=, e@x=<b>:#111111, junk" })));
  assert.equal(p["a@x"].color, g.PALETTE[0], "not a #rrggbb -> palette");
  assert.equal(p["b@x"].color, g.PALETTE[1]);
  assert.equal(Object.keys(p).indexOf(""), -1, "no address -> skipped");
  assert.equal(p["d@x"], undefined, "no label -> skipped");
  assert.equal(p["e@x"].label, "<b>", "label kept as text, the panel escapes it");
  assert.equal(Object.keys(p).length, 3);
});

test("P4 no PEOPLE -> nobody (login shown); old EMAIL_E / EMAIL_D are ignored", function () {
  var g = h.loadCalScript();
  assert.deepEqual(plain(g.peopleFrom(props({}))), {});
  assert.deepEqual(plain(g.peopleFrom(props({ EMAIL_E: "em@x.com", EMAIL_D: "d@y.com" }))), {},
                   "old settings no longer read");
  assert.equal(g.whoOf(["jan@x.com"], {}), "jan");
  var both = plain(g.peopleFrom(props({ PEOPLE: "n@x=N", EMAIL_E: "em@x.com" })));
  assert.deepEqual(Object.keys(both), ["n@x"]);
});

test("P5 panel draws the tag in the colour from the data, text escaped", function () {
  var p = h.loadPanel();
  assert.equal(p.tagHtml("E", "#2e9e5b"), '<span class="tag" style="background-color:#2e9e5b">E</span>');
  assert.equal(p.tagHtml("<b>", "#111111"), '<span class="tag" style="background-color:#111111">&lt;b&gt;</span>');
  assert.equal(p.tagHtml("jan", ""), '<span class="tag tag-x">jan</span>');
  assert.equal(p.tagHtml("x", "red;background:url(y)"), '<span class="tag tag-x">x</span>', "bad colour ignored");
  assert.equal(p.tagHtml("", "#111111"), "");
  var html = h.readRepoFile("index.html");
  assert.doesNotMatch(html, /tag-e|tag-d/, "no per-person colours in the panel");
  var cs = p.createCalState();
  p.onCalResult(cs, { ok: true, events: [{ title: "a", start: "2026-09-30T10:00", end: "2026-09-30T11:00",
                                          allDay: false, who: "E", color: "#2e9e5b" }] },
                new Date("2026-09-30T09:00:00+02:00"));
  assert.match(p.calHtml(cs, new Date("2026-09-30T09:00:00+02:00"), "tomorrow", 5),
               /<span class="tag" style="background-color:#2e9e5b">E<\/span>/);
});

test("P6 no panel account name or personal address in the repo", function () {
  var root = path.join(__dirname, "..");
  ["index.html", "README.md", "README.en.md", "DECISION-LOG.md",
   "apps-script/Calendar.gs", "apps-script/Code.gs", "apps-script/Sheet.gs"].forEach(function (f) {
    var s = fs.readFileSync(path.join(root, f), "utf8");
    assert.doesNotMatch(s, /puxle/i, f);
    assert.doesNotMatch(s, /miller\.emilia|bugitwhisperer@/i, f);
  });
});

test("P7 old EMAIL_E / EMAIL_D settings are gone from code and docs", function () {
  ["apps-script/Calendar.gs", "README.md", "README.en.md", "tests/TESTY.md"].forEach(function (f) {
    assert.doesNotMatch(h.readRepoFile(f), /EMAIL_[ED]\b/, f);
  });
});
