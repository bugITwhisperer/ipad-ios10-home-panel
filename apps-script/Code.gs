/* Panel iPad — backend for Zakupy/ToDo (Google Apps Script, bound to the Sheet).
   Source of truth lives in the repo (apps-script/Code.gs); paste it into the
   Apps Script editor as the whole of Code.gs.

   Setup, once:
     1. Run generateKey() -> copy the key from the Execution log.
     2. Deploy -> Manage deployments -> edit -> Version: New version.
     3. On the iPad paste:  <Web app URL>?key=<key>

   API (JSONP, GET only):
     ?key=K&callback=cb                          -> cb({ok, zakupy:[...], todo:[...]})
     ?key=K&callback=cb&tick=zakupy&row=5&done=1 -> cb({ok})
   Item: { row: <sheet row>, text: "...", done: true|false }
   A ticked item stays visible until midnight (Europe/Warsaw), then hides. */

var FIRST_ROW = 4;                                  /* rows 1-3: title, blank, header */
var SHEETS = { zakupy: "Zakupy", todo: "To do" };  /* API key -> tab name */
var TZ = "Europe/Warsaw";
var CALLBACK_RE = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/;

function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

function isDate(v) {
  return !!v && typeof v.getTime === "function" && !isNaN(v.getTime());
}

function cellText(v) {
  return String(v === null || v === undefined ? "" : v).replace(/^\s+|\s+$/g, "");
}

/* rows: values from FIRST_ROW down, each [checkbox, date, text, doneAt].
   today: "yyyy-mm-dd" in Warsaw. dayOf(Date) -> "yyyy-mm-dd" in Warsaw.
   Returns visible items plus the rows that were ticked in the Sheets app
   and still need a "done at" time written. */
function readList(rows, today, dayOf, now) {
  var items = [], fills = [], i;
  for (i = 0; i < rows.length; i++) {
    var r = rows[i];
    var text = cellText(r[2]);
    if (!text) continue;
    var rowNo = FIRST_ROW + i;
    var done = r[0] === true;
    if (done) {
      if (isDate(r[3])) {
        if (dayOf(r[3]) < today) continue;          /* done before today -> hidden */
      } else {
        fills.push({ row: rowNo, doneAt: now });    /* ticked in Sheets: start the clock now */
      }
    }
    items.push({ row: rowNo, text: text, done: done });
  }
  return { items: items, fills: fills };
}

function isAuthorized(params, secret) {
  if (typeof secret !== "string" || secret.length === 0) return false;
  return typeof params.key === "string" && params.key === secret;
}

/* deps: { secret, today, dayOf, now, readRows(name), lastRow(name), writeRow(name, row, [done, doneAt]) } */
function handle(params, deps) {
  params = params || {};
  if (!isAuthorized(params, deps.secret)) return { ok: false, error: "auth" };
  if (params.tick !== undefined) return doTick(params, deps);

  var out = { ok: true }, k, j;
  for (k in SHEETS) {
    if (!hasOwn(SHEETS, k)) continue;
    var res = readList(deps.readRows(SHEETS[k]), deps.today, deps.dayOf, deps.now);
    for (j = 0; j < res.fills.length; j++) {
      deps.writeRow(SHEETS[k], res.fills[j].row, [true, res.fills[j].doneAt]);
    }
    out[k] = res.items;
  }
  return out;
}

function doTick(p, deps) {
  var bad = { ok: false, error: "bad-tick" };
  if (typeof p.tick !== "string" || !hasOwn(SHEETS, p.tick)) return bad;
  if (typeof p.row !== "string" || !/^[0-9]{1,6}$/.test(p.row)) return bad;
  if (p.done !== "1" && p.done !== "0") return bad;
  var name = SHEETS[p.tick];
  var row = parseInt(p.row, 10);
  if (row < FIRST_ROW || row > deps.lastRow(name)) return bad;
  var r = deps.readRows(name)[row - FIRST_ROW];
  if (!r || !cellText(r[2])) return bad;             /* never tick an empty row */
  var done = p.done === "1";
  deps.writeRow(name, row, [done, done ? deps.now : ""]);
  return { ok: true };
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
  var ss = SpreadsheetApp.getActive();
  var now = new Date();
  function sheet(name) { return ss.getSheetByName(name); }
  return {
    secret: PropertiesService.getScriptProperties().getProperty("KEY") || "",
    now: now,
    today: Utilities.formatDate(now, TZ, "yyyy-MM-dd"),
    dayOf: function (d) { return Utilities.formatDate(d, TZ, "yyyy-MM-dd"); },
    readRows: function (name) {
      var sh = sheet(name);
      if (!sh) return [];
      var last = sh.getLastRow();
      if (last < FIRST_ROW) return [];
      return sh.getRange(FIRST_ROW, 1, last - FIRST_ROW + 1, 4).getValues();
    },
    lastRow: function (name) {
      var sh = sheet(name);
      return sh ? sh.getLastRow() : 0;
    },
    writeRow: function (name, row, values) {
      var sh = sheet(name);
      sh.getRange(row, 1).setValue(values[0]);
      sh.getRange(row, 4).setValue(values[1]);
    }
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
   (use that if the URL ever leaks). */
function generateKey() {
  var key = Utilities.getUuid().replace(/-/g, "");
  PropertiesService.getScriptProperties().setProperty("KEY", key);
  Logger.log("KEY = " + key);
}

if (typeof module !== "undefined") {
  module.exports = {
    FIRST_ROW: FIRST_ROW, SHEETS: SHEETS,
    readList: readList, isAuthorized: isAuthorized, handle: handle,
    jsonpWrap: jsonpWrap
  };
}
