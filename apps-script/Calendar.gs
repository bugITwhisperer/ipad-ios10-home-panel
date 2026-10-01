/* Panel iPad — backend for the calendar view (Google Apps Script).
   A SEPARATE project on the panel's own Google account, so it can only see
   the panel's calendar. Source of truth lives in the repo
   (apps-script/Calendar.gs); paste it into the editor as the whole of Code.gs.

   Setup, once (on the panel account):
     1. Project Settings -> Time zone: (GMT+01:00) Warsaw.
     2. Project Settings -> Script Properties -> add (optional)
          PEOPLE = <address>=<label>[:#rrggbb], <address>=<label>[:#rrggbb], ...
          e.g.     <address 1>=A:#2e9e5b, <address 2>=P
        Events created by these people get that label in that colour
        (no colour -> next one from PALETTE). Anyone else: login before @.
        The addresses never go into the repo and never leave the script.
     3. Run generateKey() -> copy the key from the Execution log.
     4. Deploy -> New deployment -> Web app, Execute as: Me, Who has access: Anyone.
     5. On the iPad (Kalendarz tab) paste:  <Web app URL>?key=<key>

   API (JSONP, GET only):
     ?key=K&callback=cb -> cb({ok:true, events:[...]})
   Event: { title, start, end, allDay, who, color }
     timed:   start/end "yyyy-MM-ddTHH:mm" (Warsaw wall clock)
     all-day: start/end "yyyy-MM-dd", end is the day AFTER the last day
     who:     label from PEOPLE | login (part before @) of anyone else | ""
     color:   "#rrggbb" for people from PEOPLE, "" otherwise */

var TZ = "Europe/Warsaw";
var CAL_DAYS = 8;                                   /* today + 7 more days */
var CALLBACK_RE = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/;

/* today 00:00 -> today + CAL_DAYS 00:00, in the script's time zone (Warsaw).
   Date(y, m, d + n) keeps midnight right across the DST change. */
function calRange(now) {
  var y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  return { start: new Date(y, m, d), end: new Date(y, m, d + CAL_DAYS) };
}

var PALETTE = ["#2e9e5b", "#2f6fd1", "#b7632a", "#8a4fc4", "#c43d6b", "#1c8a8a"];
var COLOR_RE = /^#[0-9a-f]{6}$/;

/* "a@x=A:#2e9e5b, b@y=B" -> { "a@x": {label, color}, ... }. Entries without an
   address or a label are skipped; a missing or bad colour takes PALETTE[n],
   n = position among the valid entries. */
function parsePeople(text) {
  var out = {}, parts = String(text || "").split(","), n = 0, i;
  for (i = 0; i < parts.length; i++) {
    var eq = parts[i].indexOf("=");
    if (eq < 0) continue;
    var mail = parts[i].slice(0, eq).replace(/\s+/g, "").toLowerCase();
    var rest = parts[i].slice(eq + 1);
    var colon = rest.lastIndexOf(":");
    var label = (colon < 0 ? rest : rest.slice(0, colon)).replace(/^\s+|\s+$/g, "");
    var color = colon < 0 ? "" : rest.slice(colon + 1).replace(/\s+/g, "").toLowerCase();
    if (!mail || !label) continue;
    if (!COLOR_RE.test(color)) color = PALETTE[n % PALETTE.length];
    out[mail] = { label: label, color: color };
    n++;
  }
  return out;
}

/* get(name) -> Script Property value or null. People come from PEOPLE;
   without it nobody (the panel shows logins). */
function peopleFrom(get) {
  var p = get("PEOPLE");
  if (p && String(p).replace(/\s+/g, "")) return parsePeople(p);
  return {};
}

function personOf(creators, people) {
  if (!creators || !creators.length) return null;
  var mail = String(creators[0]).toLowerCase();
  return Object.prototype.hasOwnProperty.call(people, mail) ? people[mail] : null;
}

/* creators: e-mail list from CalendarEvent.getCreators().
   people: from peopleFrom() (a plain label string also works) */
function whoOf(creators, people) {
  if (!creators || !creators.length) return "";
  var p = personOf(creators, people);
  if (p) return typeof p === "string" ? p : p.label;
  return String(creators[0]).toLowerCase().split("@")[0];
}

function colorOf(creators, people) {
  var p = personOf(creators, people);
  return p && typeof p === "object" ? p.color : "";
}

function toEvent(ev, deps) {
  var all = ev.isAllDayEvent();
  return {
    title: String(ev.getTitle() || ""),
    start: all ? deps.dayOf(ev.getAllDayStartDate()) : deps.localIso(ev.getStartTime()),
    end:   all ? deps.dayOf(ev.getAllDayEndDate())   : deps.localIso(ev.getEndTime()),
    allDay: all,
    who: whoOf(ev.getCreators(), deps.people),
    color: colorOf(ev.getCreators(), deps.people)
  };
}

function isAuthorized(params, secret) {
  if (typeof secret !== "string" || secret.length === 0) return false;
  return typeof params.key === "string" && params.key === secret;
}

/* deps: { secret, now, people, dayOf(Date), localIso(Date), getEvents(from, to) } */
function handle(params, deps) {
  params = params || {};
  if (!isAuthorized(params, deps.secret)) return { ok: false, error: "auth" };
  var r = calRange(deps.now), list, out = [], i;
  try {
    list = deps.getEvents(r.start, r.end) || [];
    for (i = 0; i < list.length; i++) out.push(toEvent(list[i], deps));
  } catch (e) {
    return { ok: false, error: "server" };
  }
  out.sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : 0; });
  return { ok: true, events: out };
}

/* Only a plain identifier may be used as the callback, so the response can
   never carry someone else's code. U+2028/2029 are escaped for old Safari. */
function jsonpWrap(callback, obj) {
  if (typeof callback !== "string" || !CALLBACK_RE.test(callback)) return null;
  var json = JSON.stringify(obj).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  return callback + "(" + json + ")";
}

/* ---------- Apps Script wiring (not unit-tested; needs Google) ---------- */

function gasDeps() {
  var props = PropertiesService.getScriptProperties();
  var people = peopleFrom(function (k) { return props.getProperty(k); });
  return {
    secret: props.getProperty("KEY") || "",
    now: new Date(),
    people: people,
    dayOf: function (x) { return Utilities.formatDate(x, TZ, "yyyy-MM-dd"); },
    localIso: function (x) { return Utilities.formatDate(x, TZ, "yyyy-MM-dd'T'HH:mm"); },
    getEvents: function (from, to) { return CalendarApp.getDefaultCalendar().getEvents(from, to); }
  };
}

function doGet(e) {
  var params = (e && e.parameter) || {};
  var out;
  try {
    out = handle(params, gasDeps());
  } catch (err) {
    out = { ok: false, error: "server" };
  }
  if (params.callback !== undefined) {
    var body = jsonpWrap(params.callback, out);
    if (body !== null) {
      return ContentService.createTextOutput(body)
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    out = { ok: false, error: "callback" };
  }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

/* Run once from the editor. Stores a random key in Script Properties and
   prints it to the Execution log. Running it again replaces the key
   (use that if the URL ever leaks, then deploy a new version). */
function generateKey() {
  var key = Utilities.getUuid().replace(/-/g, "");
  PropertiesService.getScriptProperties().setProperty("KEY", key);
  Logger.log("KEY = " + key);
}

if (typeof module !== "undefined") {
  module.exports = {
    CAL_DAYS: CAL_DAYS, calRange: calRange, whoOf: whoOf, toEvent: toEvent,
    PALETTE: PALETTE, parsePeople: parsePeople, peopleFrom: peopleFrom, colorOf: colorOf,
    isAuthorized: isAuthorized, handle: handle, jsonpWrap: jsonpWrap
  };
}
