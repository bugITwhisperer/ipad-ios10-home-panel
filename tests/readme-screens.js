/* Screenshots of the three views for the README (docs/screens/*.png).
   Run from the repo root:  npm run screens   (needs Playwright, like tests/layout-check.js)
   Test data only: no real names, addresses or keys. Clock fixed at 2026-09-23 12:00.
   Light theme -> <view>.png, dark theme -> <view>-dark.png. THEME=light|dark makes only one. */
"use strict";
var path = require("path");
var fs = require("fs");
var chromium = require("playwright").chromium;
var fx = require("./fixtures.js");

var PAGE = "file://" + path.join(__dirname, "..", "index.html");
var OUT = path.join(__dirname, "..", "docs", "screens");
var THEMES = process.env.THEME ? [process.env.THEME] : ["light", "dark"];

var LIST = { ok: true,
  zakupy: [{ id: "a1", text: "mleko", done: false }, { id: "a2", text: "chleb", done: true },
           { id: "a3", text: "jabłka 1 kg", done: false }, { id: "a4", text: "kawa ziarnista", done: false },
           { id: "a5", text: "karma dla psa", done: false }],
  todo: [{ id: "b1", text: "zapłacić rachunek za prąd", done: false },
         { id: "b2", text: "oddać książki do biblioteki", done: true },
         { id: "b3", text: "umówić przegląd auta", done: false }] };

var CAL = { ok: true, events: [
  { title: "Śniadanie z rodziną", start: "2026-09-23T09:00", end: "2026-09-23T10:30", allDay: false, who: "A", color: "#2e9e5b" },
  { title: "Urodziny Kasi", start: "2026-09-23", end: "2026-09-24", allDay: true, who: "P", color: "#2f6fd1" },
  { title: "Weterynarz — szczepienie", start: "2026-09-23T16:30", end: "2026-09-23T17:00", allDay: false, who: "A", color: "#2e9e5b" },
  { title: "Kino", start: "2026-09-23T19:00", end: "2026-09-23T21:30", allDay: false, who: "jan.kowalski", color: "" },
  { title: "Zakupy na tydzień", start: "2026-09-24T10:00", end: "2026-09-24T11:00", allDay: false, who: "A", color: "#2e9e5b" },
  { title: "Wyjazd w góry", start: "2026-09-26", end: "2026-09-28", allDay: true, who: "P", color: "#2f6fd1" }
] };

async function shoot(browser, THEME) {
  var sfx = THEME === "dark" ? "-dark" : "";
  var page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  await page.clock.install({ time: new Date("2026-09-23T12:00:00+02:00") });
  await page.route("https://api.open-meteo.com/**", function (r) {
    r.fulfill({ contentType: "application/json",
      body: JSON.stringify(fx.make({ date: "2026-09-23", sunrise: "06:35", sunset: "18:45" })) });
  });
  await page.route("https://script.google.com/**", function (r) {
    var u = new URL(r.request().url());
    var data = u.pathname.indexOf("AKcal") > -1 ? CAL : LIST;
    r.fulfill({ contentType: "application/javascript",
      body: u.searchParams.get("callback") + "(" + JSON.stringify(data) + ")" });
  });
  await page.addInitScript(function (th) {
    localStorage.setItem("panel-theme", th);
    localStorage.setItem("gscriptUrl", "https://script.google.com/macros/s/AKlist/exec?key=demo");
    localStorage.setItem("gcalUrl", "https://script.google.com/macros/s/AKcal/exec?key=demo");
  }, THEME);
  await page.goto(PAGE);
  await page.waitForTimeout(300);

  await page.click('#range [data-range="5"]');
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(OUT, "pogoda" + sfx + ".png") });

  await page.click('.tab[data-view="lista"]');
  await page.waitForSelector(".item");
  await page.screenshot({ path: path.join(OUT, "lista" + sfx + ".png") });

  await page.click('.tab[data-view="kalendarz"]');
  await page.waitForSelector(".ev");
  await page.click('#cal-range [data-range="3"]');
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(OUT, "kalendarz" + sfx + ".png") });

  await page.close();
  console.log("docs/screens: pogoda" + sfx + ".png, lista" + sfx + ".png, kalendarz" + sfx + ".png (" + THEME + ")");
}

(async function () {
  fs.mkdirSync(OUT, { recursive: true });
  var browser = await chromium.launch();
  for (var i = 0; i < THEMES.length; i++) await shoot(browser, THEMES[i]);
  await browser.close();
})().catch(function (e) { console.error(e); process.exit(1); });
