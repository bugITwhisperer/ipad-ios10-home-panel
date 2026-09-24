/* S4 - does every view fit the iPad screen (1024x768, landscape)?
   RT6 - does the real page rotate views on its own?
   Optional, runs a real browser. Not part of `node --test`.

   One-time setup (repo root):   npm install
                                 npx playwright install chromium
   Run:                          npm run layout

   Chromium is not iOS 10 Safari - this catches "something grew too big",
   the final check is still the iPad itself. */
process.env.TZ = "Europe/Warsaw";
var path = require("path");
var chromium = require("playwright").chromium;
var fx = require("./fixtures.js");

var PAGE = "file://" + path.join(__dirname, "..", "index.html");
var W = 1024, H = 768;
var MIN_GAP = 8;   /* px that must stay free under the lowest element */

var LIST = { ok: true,
  zakupy: [{ row: 4, text: "marchewka 6szt", done: false }, { row: 5, text: "banany 3szt", done: true },
           { row: 6, text: "bardzo długa pozycja zakupowa która musi się zawinąć do drugiej albo trzeciej linii", done: false },
           { row: 7, text: "https://sklep.example.com/produkt/bardzodlugiadresbezspacjiktorymusisiezlamac", done: false }],
  todo: [{ row: 4, text: "zdecydować się na pakiet medyczny i porównać oferty trzech firm przed końcem miesiąca", done: false },
         { row: 5, text: "krótkie", done: true }] };


/* calendar fixture: today 2026-09-23 (Wed), clock 12:00 */
var CAL = { ok: true, events: [
  { title: "Śniadanie z rodzicami", start: "2026-09-23T09:00", end: "2026-09-23T10:30", allDay: false, who: "E" },
  { title: "Urodziny Kasi", start: "2026-09-23", end: "2026-09-24", allDay: true, who: "D" },
  { title: "Weterynarz — szczepienie Puzzel i przegląd zębów, zabrać książeczkę zdrowia", start: "2026-09-23T11:30", end: "2026-09-23T12:30", allDay: false, who: "E" },
  { title: "Kino", start: "2026-09-23T19:00", end: "2026-09-23T21:30", allDay: false, who: "jan.kowalski" },
  { title: "Impreza u Kasi", start: "2026-09-24T22:00", end: "2026-09-25T02:00", allDay: false, who: "D" },
  { title: "Zakupy na tydzień", start: "2026-09-24T10:00", end: "2026-09-24T11:00", allDay: false, who: "E" },
  { title: "Wyjazd w góry", start: "2026-09-26", end: "2026-09-29", allDay: true, who: "D" },
  { title: "Dentysta", start: "2026-09-29T08:00", end: "2026-09-29T09:00", allDay: false, who: "E" },
  { title: "Spotkanie", start: "2026-09-30T17:00", end: "2026-09-30T18:00", allDay: false, who: "D" }
] };

var failures = 0;
function report(name, bottom, extra) {
  var ok = bottom <= H - MIN_GAP && !extra;
  if (!ok) failures++;
  console.log("  " + (ok ? "PASS" : "FAIL") + "  " + name + "  (dol: " + bottom + " / " + H + ")" + (extra ? "  " + extra : ""));
}

(async function () {
  var browser = await chromium.launch();
  try {
    var themes = ["dark", "light"];
    for (var t = 0; t < themes.length; t++) {
      var theme = themes[t];
      var page = await browser.newPage({ viewport: { width: W, height: H } });
      var errors = [];
      page.on("pageerror", function (e) { errors.push(e.message); });
      await page.clock.install({ time: new Date("2026-09-23T12:00:00+02:00") });
      await page.route("https://api.open-meteo.com/**", function (r) {
        r.fulfill({ contentType: "application/json",
          body: JSON.stringify(fx.make({ date: "2026-09-23", sunrise: "06:35", sunset: "18:45" })) });
      });
      await page.route("https://script.google.com/**", function (r) {
        var u = new URL(r.request().url());
        var cb = u.searchParams.get("callback");
        var data = u.pathname.indexOf("AKcalcheck") > -1 ? CAL : LIST;
        r.fulfill({ contentType: "application/javascript", body: cb + "(" + JSON.stringify(data) + ")" });
      });
      await page.addInitScript(function (th) {
        localStorage.setItem("panel-theme", th);
        localStorage.setItem("gscriptUrl", "https://script.google.com/macros/s/AKlayoutcheck/exec?key=test");
        localStorage.setItem("gcalUrl", "https://script.google.com/macros/s/AKcalcheck/exec?key=test");
      }, theme);
      await page.goto(PAGE);
      await page.waitForTimeout(300);

      console.log("\n" + theme);
      var modes = ["tomorrow", "3", "5", "7"];
      for (var m = 0; m < modes.length; m++) {
        await page.selectOption("#range", modes[m]);
        await page.waitForTimeout(100);
        var b = await page.$eval("#strip-next", function (e) { return Math.round(e.getBoundingClientRect().bottom); });
        report("pogoda / " + modes[m], b);
      }

      await page.click('.tab[data-view="lista"]');
      await page.waitForSelector(".item");
      var list = await page.evaluate(function (w) {
        var bottom = 0, wide = 0;
        var els = document.querySelectorAll("#view-lista .item, #view-lista .list-foot");
        for (var i = 0; i < els.length; i++) {
          var r = els[i].getBoundingClientRect();
          if (r.bottom > bottom) bottom = r.bottom;
          if (r.right > w) wide++;
        }
        return { bottom: Math.round(bottom), wide: wide };
      }, W);
      report("lista", list.bottom, list.wide ? list.wide + " kafelkow wychodzi za prawa krawedz" : "");

      await page.click('.tab[data-view="kalendarz"]');
      await page.waitForSelector(".ev");
      for (var cm = 0; cm < modes.length; cm++) {
        await page.selectOption("#cal-range", modes[cm]);
        await page.waitForTimeout(100);
        var cal = await page.evaluate(function (w) {
          var bottom = 0, wide = 0;
          var els = document.querySelectorAll("#view-kalendarz .col, #view-kalendarz .list-foot");
          for (var i = 0; i < els.length; i++) {
            var r = els[i].getBoundingClientRect();
            if (r.bottom > bottom) bottom = r.bottom;
            if (r.right > w) wide++;
          }
          return { bottom: Math.round(bottom), wide: wide };
        }, W);
        report("kalendarz / " + modes[cm], cal.bottom, cal.wide ? cal.wide + " elementow wychodzi za prawa krawedz" : "");
        if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + "/kalendarz-" + theme + "-" + modes[cm] + ".png" });
      }

      if (errors.length) { failures++; console.log("  FAIL  bledy strony: " + errors.join(" | ")); }
      await page.close();
    }
    /* RT6 - real page, simulated clock: all three views must come up in 25 min */
    console.log("\nrotacja (25 symulowanych minut)");
    var rp = await browser.newPage({ viewport: { width: W, height: H } });
    await rp.clock.install({ time: new Date("2026-09-23T12:00:00+02:00") });
    await rp.route("https://api.open-meteo.com/**", function (r) {
      r.fulfill({ contentType: "application/json",
        body: JSON.stringify(fx.make({ date: "2026-09-23", sunrise: "06:35", sunset: "18:45" })) });
    });
    await rp.goto(PAGE);
    await rp.waitForTimeout(300);
    var seen = {}, order = [];
    for (var min = 0; min <= 25; min++) {
      var v = await rp.$eval(".tab.on", function (e) { return e.textContent; });
      if (!Object.prototype.hasOwnProperty.call(seen, v)) { seen[v] = min; order.push(v + "@" + min); }
      await rp.clock.runFor(60000);
      await rp.waitForTimeout(20);
    }
    var all = Object.keys(seen).length === 3;
    if (!all) failures++;
    console.log("  " + (all ? "PASS" : "FAIL") + "  widoki: " + order.join(", "));
    await rp.close();
  } finally {
    await browser.close();
  }
  console.log("\n" + (failures ? failures + " FAIL" : "wszystko miesci sie na ekranie") + "\n");
  process.exit(failures ? 1 : 0);
})();
