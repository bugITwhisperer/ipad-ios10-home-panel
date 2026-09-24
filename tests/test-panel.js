/* Run from the repo root:  node tests/test-panel.js
   Reads the page straight from ../index.html - no generated files needed. */
process.env.TZ = "Europe/Warsaw";   /* night mode and DST tests assume Polish time */
var fs = require("fs");
var path = require("path");
var Module = require("module");

var HTML = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
var SRC = HTML.match(/<script>([\s\S]*?)<\/script>/)[1];
var app = (function () {
  var m = new Module(path.join(__dirname, "panel-app.js"));
  m._compile(SRC, "panel-app.js");
  return m.exports;
})();
var fx = require("./fixtures.js");

var pass = 0, fail = 0, todo = 0;
function t(id, name, fn) {
  try { fn(); pass++; console.log("  PASS  " + id + "  " + name); }
  catch (e) { fail++; console.log("  FAIL  " + id + "  " + name + "\n        -> " + e.message); }
}
/* test for a feature not built yet: listed, not run, does not fail the suite */
function todoT(id, name, fn) { todo++; console.log("  TODO  " + id + "  " + name); }
function eq(a, b, what) {
  if (String(a) !== String(b))
    throw new Error((what || "") + " expected <" + b + "> got <" + a + ">");
}
function ok(c, what) { if (!c) throw new Error(what || "expected truthy"); }


/* sunrise fixtures — the code must read these, never hardcode a time */
var SUN_SUMMER = "2026-06-21T04:10";
var SUN_WINTER = "2025-12-21T07:20";
var SUN_MID    = "2026-09-23T06:35";

function at(y, m, d, hh, mm) { return new Date(y, m - 1, d, hh, mm, 0, 0); }

console.log("\nGRUPA 5 - rotacja");

t(24, "kolejnosc: pogoda -> lista -> kalendarz -> pogoda", function () {
  var s = app.createState();
  eq(app.currentView(s), "pogoda", "start");
  app.advance(s); eq(app.currentView(s), "lista");
  app.advance(s); eq(app.currentView(s), "kalendarz");
  app.advance(s); eq(app.currentView(s), "pogoda", "wraca na poczatek");
});

t(25, "czasy 10/5/5 min, petla 20 min", function () {
  var v = app.VIEWS;
  eq(v.length, 3);
  eq(v[0].ms, 600000, "pogoda 10 min");
  eq(v[1].ms, 300000, "zakupy/todo 5 min");
  eq(v[2].ms, 300000, "kalendarz 5 min");
  var sum = 0, i;
  for (i = 0; i < v.length; i++) sum += v[i].ms;
  eq(sum, 1200000, "petla 20 min");
  eq(v[0].ms / sum, 0.5, "pogoda polowa czasu");
});

t(26, "po pelnej petli wraca do pogody, nie zatrzymuje sie", function () {
  var s = app.createState(), i;
  for (i = 0; i < 30; i++) app.advance(s);
  eq(app.currentView(s), "pogoda", "30 obrotow = 10 pelnych petli");
  ok(s.viewIndex >= 0 && s.viewIndex < app.VIEWS.length, "indeks w zakresie");
});

t(27, "przelaczenie widoku nie zostawia osieroconych wezlow", function () {
  ok(/\.innerHTML = /.test(SRC), "render przez innerHTML");
  /* jedyny wyjatek: tag <script> transportu JSONP (etap C), sprzatany po kazdej odpowiedzi */
  var jsonp = SRC.match(/function jsonpRequest[\s\S]*?\n\}\n/);
  ok(jsonp, "jsonpRequest istnieje");
  ok(/removeChild\(tag\)/.test(jsonp[0]), "JSONP usuwa swoj tag");
  ok(!/appendChild|insertBefore|createElement/.test(SRC.replace(jsonp[0], "")),
     "poza JSONP nic nie jest dopisywane do DOM");
  ok(/className = "view"/.test(SRC), "widoki chowane klasa, nie usuwane");
  // tabsHtml jest czysty: te same dane -> ten sam string, bez narastania
  var a = app.tabsHtml("pogoda"), b = app.tabsHtml("pogoda");
  eq(a, b, "render deterministyczny");
  eq((a.match(/class="tab/g) || []).length, 3, "zawsze 3 zakladki");
});

console.log("\nGRUPA 6 - dotkniecie w dzien");

t(28, "dotkniecie wstrzymuje rotacje, widok zostaje", function () {
  var s = app.createState();
  var now = at(2026, 9, 23, 14, 0);
  var before = app.decide(s, now, SUN_MID);
  ok(before.rotating, "przed dotknieciem rotuje");
  app.onTouch(s, now, SUN_MID);
  var after = app.decide(s, now, SUN_MID);
  ok(!after.rotating, "po dotknieciu stoi");
  eq(after.view, before.view, "widok bez zmian");
  ok(!after.dark, "w dzien nie ciemnieje");
});

t(29, "po 5 min rotacja wraca sama", function () {
  var s = app.createState();
  var now = at(2026, 9, 23, 14, 0);
  app.onTouch(s, now, SUN_MID);
  ok(!app.decide(s, new Date(now.getTime() + 299000), SUN_MID).rotating,
     "4:59 - nadal pauza");
  ok(app.decide(s, new Date(now.getTime() + 300001), SUN_MID).rotating,
     "5:00 - rotacja wraca");
});

t(30, "dotkniecie w trakcie pauzy przedluza o kolejne 5 min", function () {
  var s = app.createState();
  var t0 = at(2026, 9, 23, 14, 0);
  app.onTouch(s, t0, SUN_MID);
  var t1 = new Date(t0.getTime() + 240000); /* 4 min pozniej */
  app.onTouch(s, t1, SUN_MID);
  ok(!app.decide(s, new Date(t0.getTime() + 301000), SUN_MID).rotating,
     "5 min od pierwszego dotkniecia - wciaz pauza");
  eq(s.pausedUntil, t1.getTime() + app.PAUSE_MS, "licznik liczony od ostatniego dotkniecia");
});

t(31, "reczne przelaczenie tez uruchamia pauze", function () {
  var s = app.createState();
  var now = at(2026, 9, 23, 14, 0);
  app.onManualSwitch(s, now, SUN_MID);
  eq(app.currentView(s), "lista", "widok przeskoczyl");
  ok(!app.decide(s, now, SUN_MID).rotating, "rotacja wstrzymana");
});

console.log("\nGRUPA 7 - tryb nocny");

t(32, "o 00:30 ciemnieje, o 00:29 jeszcze nie", function () {
  var s = app.createState();
  ok(!app.decide(s, at(2026, 9, 23, 0, 29), SUN_MID).dark, "00:29 jasno");
  ok(app.decide(s, at(2026, 9, 23, 0, 30), SUN_MID).dark, "00:30 ciemno");
  ok(!app.decide(s, at(2026, 9, 22, 23, 59), "2026-09-22T06:34").dark, "23:59 jasno");
  // a sunrise carrying another date must not darken the evening either
  ok(!app.decide(s, at(2026, 9, 22, 23, 59), SUN_MID).dark,
     "23:59 jasno takze przy sunrise z innego dnia");
  ok(!app.decide(s, at(2026, 9, 22, 21, 0), SUN_MID).dark, "21:00 jasno");
});

t(33, "rozjasnienie 5 min przed wartoscia sunrise z API", function () {
  var cases = [
    { sun: SUN_SUMMER, y: 2026, m: 6,  d: 21, h: 4, mi: 10 },
    { sun: SUN_WINTER, y: 2025, m: 12, d: 21, h: 7, mi: 20 },
    { sun: SUN_MID,    y: 2026, m: 9,  d: 23, h: 6, mi: 35 }
  ];
  var s = app.createState(), i;
  for (i = 0; i < cases.length; i++) {
    var c = cases[i];
    var sunMs = at(c.y, c.m, c.d, c.h, c.mi).getTime();
    eq(app.dawnTime(c.sun).getTime(), sunMs - 300000,
       "dokladnie 5 min przed sunrise (" + c.sun + ")");
    ok(app.decide(s, new Date(sunMs - 360000), c.sun).dark,
       "6 min przed wschodem - jeszcze ciemno (" + c.sun + ")");
    ok(!app.decide(s, new Date(sunMs - 240000), c.sun).dark,
       "4 min przed wschodem - juz jasno (" + c.sun + ")");
  }
  // dowod, ze zadna godzina nie jest zaszyta: przesuniety sunrise przesuwa swit
  var shifted = "2026-09-23T09:00";
  eq(app.dawnTime(shifted).getTime(), at(2026, 9, 23, 8, 55).getTime(),
     "swit idzie za API, nie za stala");
  eq(app.dawnToday(at(2026, 1, 15, 3, 0), shifted).getTime(),
     at(2026, 1, 15, 8, 55).getTime(),
     "godzina z API, data z biezacego dnia");
});

t(35, "dotkniecie w nocy daje 30 s pelnego interfejsu", function () {
  var s = app.createState();
  var now = at(2026, 9, 23, 2, 0);
  ok(app.decide(s, now, SUN_MID).dark, "przed dotknieciem ciemno");
  app.onTouch(s, now, SUN_MID);
  var d = app.decide(s, now, SUN_MID);
  ok(!d.dark, "ekran sie rozjasnil");
  ok(d.night, "nadal noc");
  ok(!d.rotating, "rotacja stoi");
  ok(!app.decide(s, new Date(now.getTime() + 29000), SUN_MID).dark, "29 s - jasno");
});

t(36, "kolejne dotkniecie resetuje licznik do pelnych 30 s", function () {
  var s = app.createState();
  var t0 = at(2026, 9, 23, 2, 0);
  app.onTouch(s, t0, SUN_MID);
  var t1 = new Date(t0.getTime() + 25000);
  app.onTouch(s, t1, SUN_MID);
  eq(s.wakeUntil, t1.getTime() + app.WAKE_MS, "pelne 30 s od ostatniego dotkniecia");
  ok(!app.decide(s, new Date(t0.getTime() + 40000), SUN_MID).dark,
     "40 s od pierwszego - wciaz jasno");
  ok(s.wakeUntil - t1.getTime() === 30000, "reset, nie sumowanie");
});

t(37, "po wygasnieciu okna wraca ciemnosc, nie widok dzienny", function () {
  var s = app.createState();
  var now = at(2026, 9, 23, 2, 0);
  app.onTouch(s, now, SUN_MID);
  var d = app.decide(s, new Date(now.getTime() + 31000), SUN_MID);
  ok(d.dark, "znow ciemno");
  ok(d.night, "tryb nocny");
  ok(!d.rotating, "rotacja nadal stoi");
});

t(38, "okno trwajace przez wschod nie gasi ekranu po uplywie", function () {
  var s = app.createState();
  var dawn = app.dawnTime(SUN_MID).getTime();
  var now = new Date(dawn - 10000);      /* 10 s przed switem, jeszcze noc */
  ok(app.decide(s, now, SUN_MID).dark, "przed dotknieciem ciemno");
  app.onTouch(s, now, SUN_MID);
  var after = app.decide(s, new Date(now.getTime() + 31000), SUN_MID);
  ok(!after.dark, "okno minelo, ale swit juz byl - ekran zostaje jasny");
  ok(after.rotating, "rotacja rusza");
  ok(!after.night, "noc sie skonczyla");
});

t(39, "rotacja stoi przez cala noc", function () {
  var s = app.createState();
  var hours = [0, 1, 2, 3, 4, 5], i;
  for (i = 0; i < hours.length; i++) {
    var now = at(2026, 12, 21, hours[i], 45);
    var d = app.decide(s, now, SUN_WINTER);
    if (now.getTime() < app.dawnTime(SUN_WINTER).getTime() &&
        now.getTime() >= app.dimStart(now).getTime()) {
      ok(!d.rotating, "o " + hours[i] + ":45 rotacja stoi");
      ok(d.night, "o " + hours[i] + ":45 tryb nocny");
    }
  }
  eq(app.currentView(s), "pogoda", "widok nie zmienil sie przez noc");
});

console.log("\nGRUPA 8 - dlugie dzialanie");

t(40, "symulacja 24 h: stan nie rosnie", function () {
  var s = app.createState();
  var keys0 = Object.keys(s).length;
  var now = at(2026, 9, 23, 6, 0);
  var loops = 0, i;
  /* 24 h / 20 min = 72 petle = 216 obrotow */
  for (i = 0; i < 216; i++) {
    app.advance(s);
    now = new Date(now.getTime() + app.VIEWS[s.viewIndex].ms);
    app.decide(s, now, SUN_MID);
    loops++;
  }
  eq(Object.keys(s).length, keys0, "stan ma stale 3 pola");
  eq(loops, 216, "doba przerobiona");
  eq(app.currentView(s), "pogoda", "konczy na starcie petli");
  ok(s.viewIndex < app.VIEWS.length, "indeks nie ucieka");
});

t(41, "brak narastajacych timerow - kazdy setTimeout ma swoj clear", function () {
  ok(/if \(rotTimer\) \{ clearTimeout\(rotTimer\); rotTimer = null; \}/.test(SRC),
     "rotacja czysci swoj timer przed ustawieniem nowego");
  ok(/if \(winTimer\) \{ clearTimeout\(winTimer\); winTimer = null; \}/.test(SRC),
     "okno pauzy/wybudzenia czysci swoj timer");
  var setCount = (SRC.match(/rotTimer = setTimeout/g) || []).length;
  var clrCount = (SRC.match(/clearTimeout\(rotTimer\)/g) || []).length;
  eq(setCount, clrCount, "tyle samo set co clear dla rotacji");
  /* setInterval wolno uzyc tylko dla stalych cykli, nie w reakcji na zdarzenia */
  var intervals = (SRC.match(/setInterval\(/g) || []).length;
  eq(intervals, 2, "dokladnie 2 setInterval: odswiezanie danych i zegar minutowy");
});

t(42, "lista i zaslepka kalendarza nie wywalaja rotacji", function () {
  ok(/id="view-lista"/.test(HTML), "kontener zakupow istnieje");
  ok(/id="view-kalendarz"/.test(HTML), "kontener kalendarza istnieje");
  ok(/id="lista"/.test(HTML) && /id="setup"/.test(HTML), "widok listy: kontener i ekran konfiguracji");
  ok(HTML.indexOf("<b>Kalendarz</b>") > -1, "zaslepka kalendarza (etap B) nadal jest");
  var s = app.createState(), i;
  var now = at(2026, 9, 23, 14, 0);
  for (i = 0; i < 9; i++) {
    app.advance(s);
    var d = app.decide(s, now, SUN_MID);
    ok(d.view === "pogoda" || d.view === "kalendarz" || d.view === "lista",
       "widok zawsze znany, got " + d.view);
    ok(d.rotating, "rotacja chodzi mimo zaslepek");
  }
});

t("42b", "kazdy widok z VIEWS ma swoj kontener w HTML", function () {
  var i;
  for (i = 0; i < app.VIEWS.length; i++) {
    ok(HTML.indexOf('id="view-' + app.VIEWS[i].id + '"') > -1,
       "brak kontenera dla " + app.VIEWS[i].id);
  }
});

console.log("\nGRUPA 9 - zgodnosc z iOS 10");

t(43, "nadal zero skladni ES6 i nowoczesnego CSS-a", function () {
  var banned = [
    [/\blet\s/, "let"], [/\bconst\s/, "const"], [/=>/, "arrow function"],
    [/`/, "template literal"], [/\bfetch\s*\(/, "fetch"],
    [/\bPromise\b/, "Promise"], [/\basync\s/, "async"], [/\bawait\s/, "await"],
    [/Object\.assign/, "Object.assign"], [/\.includes\(/, ".includes"],
    [/\bclass\s+\w+\s*\{/, "class"], [/\.\.\./, "spread"], [/\bSymbol\b/, "Symbol"]
  ];
  banned.forEach(function (b) {
    if (b[0].test(SRC)) throw new Error("JS: found " + b[1]);
  });
  var css = HTML.match(/<style>([\s\S]*?)<\/style>/)[1];
  if (/--[a-z-]+\s*:/.test(css)) throw new Error("CSS custom property");
  if (/\bgap\s*:/.test(css)) throw new Error("flexbox gap");
  if (/\bgrid-template/.test(css)) throw new Error("CSS grid");
  if (/\bclamp\(|:is\(|:where\(/.test(css)) throw new Error("modern CSS fn/selector");
  if (/display:\s*flex/.test(css) && !/-webkit-box/.test(css))
    throw new Error("flex bez -webkit- fallbacku");
  new (require("vm").Script)(SRC, { filename: "panel-app.js" });
});


console.log("\nGRUPA 10 - dwa paski godzinowe");

var S = fx.summer, W = fx.winter;

t("13a", "dzisiaj: od biezacej godziny do 23:00", function () {
  var c = app.buildToday(S, "2026-06-21T14:30");
  eq(c[0].when, "14:00", "startuje od biezacej godziny");
  eq(c[c.length - 1].when, "23:00", "konczy o 23:00");
  eq(c.length, 10, "14..23");
});

t(14, "minione godziny nieobecne, nie wyszarzone", function () {
  var c = app.buildToday(S, "2026-06-21T14:30"), i;
  for (i = 0; i < c.length; i++) {
    ok(c[i].when >= "14:00", "brak godziny sprzed teraz: " + c[i].when);
    ok(!c[i].past, "zadnego znacznika past");
  }
  ok(app.cellHtml(c[0]).indexOf("opacity") === -1, "brak wyszarzenia w HTML");
});

t("13b", "wschod i zachod nie ograniczaja juz paska dzisiaj", function () {
  /* zachod w fixture 20:50, a mimo to widac 21, 22, 23 */
  var c = app.buildToday(S, "2026-06-21T19:00"), last = [];
  var i;
  for (i = 0; i < c.length; i++) last.push(c[i].when);
  ok(last.indexOf("21:00") > -1 && last.indexOf("23:00") > -1,
     "godziny po zachodzie sa pokazane, got " + last.join(","));
  /* o 04:00, przed wschodem zimowym 07:20, tez widac */
  var wc = app.buildToday(W, "2025-12-21T04:00");
  eq(wc[0].when, "04:00", "przed wschodem tez startuje od teraz");
});

t(16, "o 23:30 zostaje biezaca godzina; dolny pasek nietkniety", function () {
  /* biezaca godzina jest wciaz w toku, wiec zostaje - tak samo jak o 14:30
     pokazujemy 14:00. Gorny pasek pustoszeje dopiero o polnocy, gdy staje
     sie paskiem nowego dnia. */
  var c = app.buildToday(S, "2026-06-21T23:30");
  eq(c.length, 1, "biezaca godzina zostaje");
  eq(c[0].when, "23:00");
  ok(app.buildTomorrow(S).length > 0, "jutro nadal ma dane");
  eq(app.buildDaily(S, 3, "2026-06-21T23:30").length, 3, "3 dni nadal dziala");
});

t("16b", "komunikat o pustym pasku tylko przy brakach w danych z API", function () {
  var gap = JSON.parse(JSON.stringify(S));
  gap.hourly.time = [];
  gap.hourly.temperature_2m = [];
  gap.hourly.weather_code = [];
  gap.hourly.precipitation_probability = [];
  gap.hourly.wind_speed_10m = [];
  eq(app.buildToday(gap, "2026-06-21T14:30").length, 0, "brak danych -> pusty pasek");
  ok(/msg-today/.test(SRC), "jest galaz na pusty pasek");
});

t(44, "jutro: od wschodu jutra do 23:00", function () {
  /* fixture: sunrise 04:15 kazdego dnia */
  var c = app.buildTomorrow(S);
  eq(c[0].when, "04:00", "startuje od godziny wschodu");
  eq(c[c.length - 1].when, "23:00", "konczy o 23:00");
  eq(c.length, 20, "04..23");
});

t(45, "oba paski widoczne naraz i niezalezne", function () {
  var nowIso = "2026-06-21T14:30";
  var a = app.buildToday(S, nowIso);
  var b = app.buildTomorrow(S);
  ok(a.length > 0 && b.length > 0, "oba maja dane");
  eq(a[0].when, "14:00", "gorny od teraz");
  eq(b[0].when, "04:00", "dolny od wschodu");
  ok(HTML.indexOf('id="strip-today"') > -1, "kontener gornego");
  ok(HTML.indexOf('id="strip-next"') > -1, "kontener dolnego");
});

t(46, "dropdown przelacza wylacznie dolny pasek", function () {
  ok(/el\("strip-today"\)\.innerHTML = renderCells\(today\)/.test(SRC),
     "gorny pasek liczony bez odczytu dropdowna");
  var idxToday = SRC.indexOf('el("strip-today").innerHTML');
  var idxRange = SRC.indexOf('el("range").value', SRC.indexOf("function paintWeather"));
  ok(idxToday < idxRange, "gorny pasek renderowany zanim kod siegnie po dropdown");
  ok(/el\("strip-next"\)\.innerHTML = renderCells\(lower\)/.test(SRC),
     "dolny pasek zalezy od wyboru");
});

t(47, "7 dni zwraca 7 kafelkow, API prosi o 8", function () {
  eq(app.buildDaily(S, 7, "2026-06-21T12:00").length, 7);
  ok(/forecast_days=8/.test(SRC), "API prosi o 8 dni");
  ok(HTML.indexOf('<option value="7"') > -1, "opcja w dropdownie");
});

t("47b", "pasek dzienny zaczyna sie od jutra, nie dubluje dzisiaj", function () {
  var c = app.buildDaily(S, 3, "2026-06-21T12:00"), i;
  for (i = 0; i < c.length; i++) {
    ok(c[i].when !== "dzisiaj", "dzisiaj nie powtarza sie na dole");
  }
  eq(c[0].when, "poniedzia\u0142ek", "2026-06-22 to poniedzialek");
});

t(48, "przelaczanie jutro <-> 3 <-> 5 <-> 7 w obie strony", function () {
  var seq = ["tomorrow", "3", "5", "7", "5", "3", "tomorrow", "7"], i;
  for (i = 0; i < seq.length; i++) {
    var m = seq[i];
    var c = (m === "tomorrow")
      ? app.buildTomorrow(S)
      : app.buildDaily(S, Number(m), "2026-06-21T12:00");
    ok(c.length > 0, "tryb " + m + " dal kafelki");
    if (m !== "tomorrow") eq(c.length, Number(m), "tryb " + m + " dal " + m + " kafelkow");
  }
});

t(49, "o 23:00 gorny pasek ma dokladnie 1 kafelek", function () {
  var c = app.buildToday(S, "2026-06-21T23:00");
  eq(c.length, 1);
  eq(c[0].when, "23:00");
});

t(50, "pasek jutra startuje wg wschodu z API, nie wg stalej", function () {
  var summer = app.buildTomorrow(S);
  var winter = app.buildTomorrow(W);
  eq(summer[0].when, "04:00", "lato: wschod 04:15 -> start 04:00");
  eq(winter[0].when, "07:00", "zima: wschod 07:20 -> start 07:00");
  ok(winter.length < summer.length, "krotszy dzien = mniej kafelkow");
  eq(winter.length, 17, "07..23");
});


console.log("\nGRUPA 11 - mini pogoda w naglowku");

t(51, "mini ma te same cztery wartosci co duzy pasek", function () {
  var h = app.miniNowHtml(S);
  ok(h.indexOf("18\u00B0") > -1, "temperatura 17.6 -> 18");
  ok(h.indexOf("14 km/h") > -1, "wiatr 14.3 -> 14");
  ok(h.indexOf("0.2 mm") > -1, "opad");
  ok(h.indexOf("\u26C5") > -1, "ikona dla kodu 2");
  var big = app.nowHtml(S);
  ok(big.indexOf("18\u00B0") > -1 && big.indexOf("14 km/h") > -1,
     "duzy pasek pokazuje to samo");
});

t(52, "widok pogody: dropdown widoczny, mini ukryty", function () {
  ok(/el\("range"\)\.className = onWeather \? "" : "off"/.test(SRC),
     "dropdown chowany poza pogoda");
  ok(/el\("mini"\)\.className = onWeather \? "" : "on"/.test(SRC),
     "mini pokazywany poza pogoda");
  ok(/var onWeather = d\.view === "pogoda"/.test(SRC), "przelacznik oparty o widok");
});

t(53, "kalendarz i zakupy: mini widoczny, dropdown ukryty", function () {
  var s2 = app.createState(), now = at(2026, 9, 23, 14, 0), i;
  var seen = {};
  for (i = 0; i < 3; i++) {
    var v = app.decide(s2, now, SUN_MID).view;
    seen[v] = v !== "pogoda";
    app.advance(s2);
  }
  eq(seen["pogoda"], false, "pogoda -> mini ukryty");
  eq(seen["lista"], true, "zakupy -> mini widoczny");
  eq(seen["kalendarz"], true, "kalendarz -> mini widoczny");
  ok(HTML.indexOf('id="mini"') > -1, "kontener mini istnieje");
  ok(/#mini \{[^}]*display: none/.test(HTML), "domyslnie ukryty");
  ok(/#mini\.on \{ display: inline; \}/.test(HTML), "pokazywany klasa on");
  ok(/select\.off \{ display: none; \}/.test(HTML), "dropdown chowany klasa off");
});

t(54, "przelaczanie nie zostawia obu naraz ani zadnego", function () {
  /* obie klasy ustawiane z tego samego warunku, wiec sa zawsze przeciwne */
  var m = SRC.match(/var onWeather = d\.view === "pogoda";([\s\S]{0,260})/);
  ok(m, "blok przelaczania znaleziony");
  var blk = m[1];
  ok(/el\("range"\)\.className/.test(blk) && /el\("mini"\)\.className/.test(blk),
     "oba ustawiane w jednym miejscu");
  ok(blk.indexOf("onWeather ? \"\" : \"off\"") > -1 &&
     blk.indexOf("onWeather ? \"\" : \"on\"") > -1,
     "przeciwne stany z jednego warunku");
});

t(55, "brak danych z API: mini pokazuje --, nie znika i nie daje NaN", function () {
  var h = app.miniNowHtml(null);
  ok(h.length > 0, "cos sie renderuje");
  ok(h.indexOf("--") > -1, "placeholder");
  ok(h.indexOf("NaN") === -1, "brak NaN");
  var partial = JSON.parse(JSON.stringify(S));
  partial.current.temperature_2m = null;
  partial.current.wind_speed_10m = null;
  partial.current.precipitation = null;
  var p = app.miniNowHtml(partial);
  ok(p.indexOf("NaN") === -1, "brak NaN przy pustych polach");
  ok(p.indexOf("--") > -1, "placeholder przy pustych polach");
});

t(56, "mini renderuje sie w jednej linii", function () {
  var h = app.miniNowHtml(S);
  ok(!/<div|<p |<br/.test(h), "brak elementow blokowych i lamania linii");
  ok(/white-space: nowrap/.test(HTML), "naglowek nie zawija mini");
});

t(57, "pelna petla przelacza mini/dropdown za kazdym razem", function () {
  var s2 = app.createState(), now = at(2026, 9, 23, 14, 0), i;
  var seq = [], flips = 0;
  for (i = 0; i < 9; i++) {
    seq.push(app.decide(s2, now, SUN_MID).view === "pogoda");
    app.advance(s2);
  }
  eq(seq.join(","), "true,false,false,true,false,false,true,false,false",
     "pogoda co trzeci widok");
  for (i = 1; i < seq.length; i++) if (seq[i] !== seq[i - 1]) flips++;
  eq(flips, 5, "9 widokow -> 5 przelaczen naglowka");
  ok(flips > 0, "naglowek faktycznie sie przelacza");
});


console.log("\nGRUPA 12 - motyw ciemny/jasny");

function fakeStore(initial) {
  var v = initial;
  return {
    getItem: function () { return v === undefined ? null : v; },
    setItem: function (k, x) { v = x; },
    read: function () { return v; }
  };
}

t(58, "przelacznik zmienia motyw w obie strony", function () {
  eq(app.nextTheme("dark"), "light");
  eq(app.nextTheme("light"), "dark");
  eq(app.nextTheme(app.nextTheme("dark")), "dark", "dwa klikniecia wracaja");
  eq(app.THEMES.length, 2, "dokladnie dwa motywy");
});

t(59, "ikona pokazuje motyw docelowy, nie biezacy", function () {
  eq(app.themeIcon("dark"), "\u2600\uFE0F", "w ciemnym widac slonce");
  eq(app.themeIcon("light"), "\uD83C\uDF19", "w jasnym widac ksiezyc");
  ok(app.themeIcon("dark") !== app.themeIcon("light"), "ikony sie roznia");
});

t(60, "wybor zapisywany i odczytywany przy starcie", function () {
  var st = fakeStore();
  eq(app.saveTheme(st, "light"), true, "zapis sie udal");
  eq(st.read(), "light", "trafilo do magazynu");
  eq(app.readTheme(st), "light", "odczyt zwraca zapisane");
  app.saveTheme(st, "dark");
  eq(app.readTheme(st), "dark", "nadpisanie dziala");
  ok(/panel-theme/.test(SRC), "klucz nazwany jednoznacznie");
});

t(61, "brak zapisu -> domyslnie ciemny", function () {
  eq(app.readTheme(fakeStore()), "dark", "pusty magazyn");
  eq(app.readTheme(null), "dark", "brak localStorage w ogole");
});

t(62, "uszkodzona wartosc -> ciemny, bez wywrotki", function () {
  eq(app.readTheme(fakeStore("blue")), "dark", "nieznana nazwa");
  eq(app.readTheme(fakeStore("")), "dark", "pusty string");
  eq(app.readTheme(fakeStore("{}")), "dark", "smieci");
  var boom = { getItem: function () { throw new Error("denied"); } };
  eq(app.readTheme(boom), "dark", "wyjatek z localStorage nie wywala strony");
  var boomSet = { setItem: function () { throw new Error("full"); } };
  eq(app.saveTheme(boomSet, "light"), false, "nieudany zapis zwraca false");
  eq(app.saveTheme(fakeStore(), "zielony"), false, "nieznany motyw nie jest zapisywany");
});

t(63, "tryb nocny gasi na czarno przy obu motywach", function () {
  var s2 = app.createState(), night = at(2026, 9, 23, 2, 0);
  ok(app.decide(s2, night, SUN_MID).dark, "noc trwa");
  /* warstwa nocna jest osobna od motywu - klasa body sie nie zmienia */
  eq(app.bodyClass("dark", true), "", "ciemny motyw w nocy");
  eq(app.bodyClass("light", true), "light", "jasny motyw zostaje pod spodem");
  ok(/#night \{[\s\S]{0,160}background-color: #000/.test(HTML),
     "warstwa nocna zawsze czarna");
  ok(!/body\.light #night/.test(HTML), "motyw nie zmienia koloru warstwy nocnej");
});

t(64, "dotkniecie w nocy pokazuje motyw wybrany wczesniej", function () {
  var s2 = app.createState(), night = at(2026, 9, 23, 2, 0);
  app.onTouch(s2, night, SUN_MID);
  ok(!app.decide(s2, night, SUN_MID).dark, "ekran sie rozjasnil");
  eq(app.bodyClass("light", false), "light", "wraca jasny, nie domyslny");
  eq(app.bodyClass("dark", false), "", "ciemny zostaje ciemny");
});

t(65, "o swicie wraca ten sam motyw, nie domyslny", function () {
  var st = fakeStore("light");
  var theme = app.readTheme(st);
  var s2 = app.createState();
  var dawn = app.dawnTime(SUN_MID).getTime();
  eq(app.bodyClass(theme, app.decide(s2, new Date(dawn - 60000), SUN_MID).dark),
     "light", "przed switem motyw jasny pod spodem");
  eq(app.bodyClass(theme, app.decide(s2, new Date(dawn + 60000), SUN_MID).dark),
     "light", "po swicie nadal jasny");
});

t(66, "przelaczenie motywu w nocy zostaje zapamietane", function () {
  var st = fakeStore("dark");
  var theme = app.nextTheme(app.readTheme(st));
  app.saveTheme(st, theme);
  eq(st.read(), "light", "zapisane mimo nocy");
  eq(app.readTheme(st), "light", "przetrwa restart");
  ok(/theme = nextTheme\(theme\);\s*\n\s*saveTheme\(store, theme\);/.test(SRC),
     "zapis nastepuje przy kazdym przelaczeniu");
});

t(67, "motyw przezywa przeladowanie o 4:00", function () {
  var st = fakeStore("light");
  /* przeladowanie = nowy start strony = ponowny odczyt z magazynu */
  eq(app.readTheme(st), "light", "po restarcie ten sam motyw");
  ok(/var theme = readTheme\(store\);/.test(SRC), "motyw czytany na starcie");
  ok(/location\.replace/.test(SRC), "przeladowanie nadal obecne");
});

t(68, "oba motywy trzymaja kontrast", function () {
  var css = HTML.match(/<style>([\s\S]*?)<\/style>/)[1];
  /* jasny motyw jest szary, nie bialy - lagodniejszy na starym LCD */
  var bg = css.match(/body\.light \{ background-color: (#[0-9a-f]{6}); color: (#[0-9a-f]{6}); \}/);
  ok(bg, "jasny motyw ma zdefiniowane tlo i tekst");
  ok(bg[1] !== "#ffffff" && bg[1] !== "#fff", "tlo szare, nie biale");
  ok(bg[1] !== bg[2], "tlo i tekst to nie ten sam kolor");
  function lum(h) {
    return 0.299 * parseInt(h.slice(1, 3), 16) +
           0.587 * parseInt(h.slice(3, 5), 16) +
           0.114 * parseInt(h.slice(5, 7), 16);
  }
  ok(Math.abs(lum(bg[1]) - lum(bg[2])) > 100,
     "wyrazna roznica jasnosci, got " + Math.round(Math.abs(lum(bg[1]) - lum(bg[2]))));
  /* kazdy nadpisany element ma swoj odpowiednik w jasnym motywie */
  var keys = ["\\.cell", "\\.c-temp", "\\.now-temp", "\\.tab", "#mini", "\\.strip-head"];
  keys.forEach(function (k) {
    ok(new RegExp("body\\.light " + k).test(css), "brak wariantu jasnego dla " + k);
  });
});

t(69, "motyw nie wprowadza CSS-a spoza iOS 10", function () {
  var css = HTML.match(/<style>([\s\S]*?)<\/style>/)[1];
  if (/--[a-z-]+\s*:/.test(css)) throw new Error("CSS custom property");
  if (/prefers-color-scheme/.test(css)) throw new Error("prefers-color-scheme (iOS 13+)");
  if (/filter:\s*invert/.test(css)) throw new Error("filter: invert");
  if (/\bcolor-mix\(|\blight-dark\(/.test(css)) throw new Error("modern color fn");
  ok(/body\.light/.test(css), "motyw robiony klasa na body");
});

console.log("\nREGRESJA - etap poprzedni");

t("R1", "logika pogody i prognozy dziennej", function () {
  var noon = "2026-06-21T12:00";
  eq(app.buildDaily(S, 3, noon).length, 3);
  eq(app.buildDaily(S, 5, noon).length, 5);
  var c = app.buildDaily(S, 3, noon)[0];
  eq(c.temp, 19); eq(c.lo, 10); eq(c.rain, 22); eq(c.wind, 14);
  ok(app.nowHtml(S).indexOf("18\u00B0") > -1, "biezaca temperatura");
  ok(app.cellHtml(c).indexOf("NaN") === -1, "brak NaN");
  var broken = JSON.parse(JSON.stringify(S));
  broken.daily.precipitation_probability_max[1] = null;
  ok(app.cellHtml(app.buildDaily(broken, 3, noon)[0]).indexOf("--") > -1, "placeholder");
});

t("R2", "przeladowanie o 4:00 nietkniete", function () {
  var H = 3600000;
  eq(app.msUntil4am(new Date(2026, 8, 23, 23, 0, 0, 0)), 5 * H);
  eq(app.msUntil4am(new Date(2026, 8, 23, 4, 0, 0, 0)), 24 * H, "brak petli");
  var b = new Date(2025, 9, 25, 4, 0, 1, 0);
  var target = new Date(b.getTime() + app.msUntil4am(b));
  eq(target.getHours(), 4, "zmiana czasu obsluzona");
  ok(/http-equiv="Cache-Control"/.test(HTML), "no-cache");
  ok(/location\.replace/.test(SRC), "pelne przeladowanie");
});

console.log("\nGRUPA 13 - blad pobierania pogody");

t("R3", "kazdy el(\"...\") w kodzie wskazuje istniejacy element HTML", function () {
  /* fail() wolal el("strip") i el("msg"), ktorych nie ma -> wyjatek, brak ponownej proby */
  var ids = {}, m, re = /el\("([^"]+)"\)/g;
  while ((m = re.exec(SRC))) ids[m[1]] = true;
  var missing = Object.keys(ids).filter(function (id) {
    return HTML.indexOf('id="' + id + '"') === -1;
  });
  eq(missing.join(","), "", "brakujace id");
});

t("R4", "po bledzie pogody jest dokladnie jedna ponowna proba za minute", function () {
  var body = SRC.match(/function fail\(reason\) \{[\s\S]*?\n    \}\n/);
  ok(body, "fail() istnieje");
  ok(/if \(retryTimer\) \{ clearTimeout\(retryTimer\); retryTimer = null; \}/.test(body[0]),
     "stara proba kasowana, nie dokladana");
  ok(/retryTimer = setTimeout\(load, 60000\)/.test(body[0]), "ponowienie za 60 s");
  ok(/msg-today/.test(body[0]), "komunikat w widoku pogody");
});

console.log("\nGRUPA 14 - kafelki po kompaktowym ostylowaniu");

t("S1", "kafelek godzinowy nie ma wiersza min. temperatury", function () {
  var d = fx.make({ date: "2026-09-23", sunrise: "06:35", sunset: "18:45" });
  var cells = app.buildToday(d, "2026-09-23T12:00");
  ok(cells.length > 0, "sa kafelki godzinowe");
  cells.concat(app.buildTomorrow(d)).forEach(function (c) {
    ok(app.cellHtml(c).indexOf("c-lo") === -1, "godzina " + c.when + " bez c-lo");
  });
});

t("S2", "kafelek dzienny pokazuje min. temperature", function () {
  var d = fx.make({ date: "2026-09-23", sunrise: "06:35", sunset: "18:45" });
  var cells = app.buildDaily(d, 3, "2026-09-23T12:00");
  eq(cells.length, 3, "3 dni");
  cells.forEach(function (c) {
    var m = app.cellHtml(c).match(/<div class="c-lo">([^<]*)<\/div>/);
    ok(m, c.when + " ma c-lo");
    eq(m[1], c.lo + "\u00B0", c.when + " min. temperatura");
  });
});

t("S3", "brak min. temperatury w dniu -> '--', wiersz zostaje (rowna wysokosc kafelkow)", function () {
  var d = fx.make({ date: "2026-09-23", sunrise: "06:35", sunset: "18:45" });
  d.daily.temperature_2m_min[2] = null;
  var cells = app.buildDaily(d, 3, "2026-09-23T12:00");
  var html = app.cellHtml(cells[1]);
  ok(/<div class="c-lo">--<\/div>/.test(html), "pokazuje --, got " + html);
  ok(html.indexOf("NaN") === -1 && html.indexOf("null") === -1, "bez NaN/null");
});

console.log("\nGRUPA 15 - automatyczna rotacja w czasie");

/* simulates the page: the minute refresh calls rotate() every 60 s */
function runMinutes(s, start, minutes, sun, onMinute) {
  var MIN = 60000, t, now, d, seen = [];
  for (t = 0; t <= minutes; t++) {
    now = new Date(start.getTime() + t * MIN);
    d = app.decide(s, now, sun);
    app.rotate(s, now, d.rotating);
    seen.push(app.currentView(s));
    if (onMinute) onMinute(t, now);
  }
  return seen;
}

t("RT1", "minutowe odswiezanie: pogoda 10 min -> lista 5 -> kalendarz 5 -> pogoda", function () {
  var s = app.createState();
  var seen = runMinutes(s, at(2026, 9, 24, 12, 0), 30, SUN_MID);
  eq(seen[0], "pogoda", "start");
  eq(seen[9], "pogoda", "9. minuta");
  eq(seen[10], "lista", "10. minuta");
  eq(seen[14], "lista", "14. minuta");
  eq(seen[15], "kalendarz", "15. minuta");
  eq(seen[20], "pogoda", "20. minuta - pelna petla");
  eq(seen[30], "lista", "30. minuta");
});

t("RT2", "odswiezanie co minute nie przesuwa terminu zmiany", function () {
  var s = app.createState(), first = null;
  runMinutes(s, at(2026, 9, 24, 12, 0), 9, SUN_MID, function (m) {
    if (m === 0) first = s.switchAt;
    eq(s.switchAt, first, "termin w minucie " + m);
  });
  eq(first, at(2026, 9, 24, 12, 10).getTime(), "termin = start + 10 min");
});

t("RT3", "dotkniecie: 5 min pauzy bez zmiany, potem pelny czas widoku", function () {
  var s = app.createState(), t0 = at(2026, 9, 24, 12, 0);
  runMinutes(s, t0, 8, SUN_MID);                     /* 8 min on weather */
  app.onTouch(s, at(2026, 9, 24, 12, 8), SUN_MID);   /* pause until 12:13 */
  var seen = runMinutes(s, at(2026, 9, 24, 12, 8), 20, SUN_MID);
  eq(seen[4], "pogoda", "12:12 - pauza trwa");
  eq(seen[14], "pogoda", "12:22 - 9 min pelnego czasu po pauzie");
  eq(seen[15], "lista", "12:23 - pauza 12:13 + 10 min");
});

t("RT4", "noc: rotacja stoi, po swicie rusza od pelnego czasu", function () {
  var s = app.createState();
  var seen = runMinutes(s, at(2026, 9, 24, 0, 20), 400, SUN_MID);  /* 00:20 -> 07:00 */
  /* 00:20-00:29 rotating (10 min, not yet due), 00:30-06:29 dark, dawn 06:30 */
  for (var m = 10; m < 370; m++) eq(seen[m], seen[10], "w nocy bez zmian, minuta " + m);
  eq(seen[379], seen[370], "06:39 - po swicie jeszcze ten sam widok");
  ok(seen[380] !== seen[370], "06:40 - pelne 10 min po swicie, zmiana");
});

t("RT5", "reczne przelaczenie zakladki: nowy widok dostaje pelny czas po pauzie", function () {
  var s = app.createState(), t0 = at(2026, 9, 24, 12, 0);
  runMinutes(s, t0, 3, SUN_MID);
  app.onManualSwitch(s, at(2026, 9, 24, 12, 3), SUN_MID);         /* -> lista, pause to 12:08 */
  eq(app.currentView(s), "lista");
  var seen = runMinutes(s, at(2026, 9, 24, 12, 3), 12, SUN_MID);
  eq(seen[9], "lista", "12:12 - 4 min po pauzie");
  eq(seen[10], "kalendarz", "12:13 - pauza 12:08 + 5 min");
});

console.log("\n" + pass + " passed, " + fail + " failed, " + todo + " todo\n");
process.exit(fail ? 1 : 0);
