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
        var cb = new URL(r.request().url()).searchParams.get("callback");
        r.fulfill({ contentType: "application/javascript", body: cb + "(" + JSON.stringify(LIST) + ")" });
      });
      await page.addInitScript(function (th) {
        localStorage.setItem("panel-theme", th);
        localStorage.setItem("gscriptUrl", "https://script.google.com/macros/s/AKlayoutcheck/exec?key=test");
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
