/* Panel iPad — Google SHEET backend for Zakupy/ToDo (fallback for the Todoist one).
   Code.gs = Todoist (in use), Sheet.gs = this file. Both answer the panel in the
   same shape, so switching needs no change on the iPad.

   Switch Todoist -> Sheet: in the Apps Script project bound to the Sheet, replace
   the whole of Code.gs with this file, then Deploy -> Manage deployments -> edit ->
   Version: New version. Same URL and KEY, nothing to paste on the iPad.
   Switch back: the same with apps-script/Code.gs.
   Based on the last Sheet version (tag v0.3.2-arkusz); only row -> id changed.

   Setup, once:
     1. Run generateKey() -> copy the key from the Execution log.
     2. Deploy -> Manage deployments -> edit -> Version: New version.
     3. On the iPad paste:  <Web app URL>?key=<key>

   API (JSONP, GET only):
     ?key=K&callback=cb                          -> cb({ok, zakupy:[...], todo:[...]})
     ?key=K&callback=cb&tick=zakupy&id=<uuid>&done=1  -> cb({ok})
   Item: { id: "<stable row UUID>", text: "...", done: true|false }
   A ticked item stays visible until midnight (Europe/Warsaw), then hides.
   Ticking/unticking by hand in the Sheet: onEdit() below keeps column D
   ("Completed at") in step, so a re-ticked item is not hidden by an old date. */

var FIRST_ROW = 4;                                  /* rows 1-3: title, blank, header */
var SHEETS = { zakupy: "Zakupy", todo: "To do" };  /* API key -> tab name */
var TZ = "Europe/Warsaw";
var CALLBACK_RE = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/;
var ROW_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

function isDate(v) {
  return !!v && typeof v.getTime === "function" && !isNaN(v.getTime());
}

function cellText(v) {
  return String(v === null || v === undefined ? "" : v).replace(/^\s+|\s+$/g, "");
}

function ensureRowIds(rows, createId) {
  var ids = [], seen = {}, changed = false, i, id, text;
  for (i = 0; i < rows.length; i++) {
    text = cellText(rows[i][2]);
    id = cellText(rows[i][4]);
    if (!text) id = "";
    else if (!ROW_ID_RE.test(id) || hasOwn(seen, id)) {
      do { id = createId(); } while (!ROW_ID_RE.test(id) || hasOwn(seen, id));
    }
    if (id !== rows[i][4]) changed = true;
    rows[i][4] = id;
    if (id) seen[id] = true;
    ids.push([id]);
  }
  return { ids: ids, changed: changed };
}

/* rows: values from FIRST_ROW down, each [checkbox, date, text, doneAt, id].
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
    var id = cellText(r[4]);
    if (!ROW_ID_RE.test(id)) continue;
    items.push({ id: id, text: text, done: done });
  }
  return { items: items, fills: fills };
}

function isAuthorized(params, secret) {
  if (typeof secret !== "string" || secret.length === 0) return false;
  return typeof params.key === "string" && params.key === secret;
}

/* deps: { secret, today, dayOf, now, readRows(name), writeRow(name, row, [done, doneAt]) } */
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
  if (typeof p.id !== "string" || !ROW_ID_RE.test(p.id)) return bad;
  if (p.done !== "1" && p.done !== "0") return bad;
  var name = SHEETS[p.tick];
  var rows = deps.readRows(name), row = 0, r = null, i;
  for (i = 0; i < rows.length; i++) {
    if (cellText(rows[i][4]) === p.id) {
      if (r) return bad;                           /* duplicate IDs are ambiguous */
      row = FIRST_ROW + i;
      r = rows[i];
    }
  }
  if (!r || !cellText(r[2])) return bad;             /* never tick an empty row */
  var done = p.done === "1";
  deps.writeRow(name, row, [done, done ? deps.now : ""]);
  return { ok: true };
}

/* Manual edit in the Sheet -> what to write into column D.
   ed: { sheet: tab name, row: top row, col: left column, values: 2D array }.
   Returns [{ row, doneAt }]: doneAt = now for a ticked box, "" for unticked.
   Only column A of the list tabs, rows FIRST_ROW and below, counts. */
function sheetEditFix(ed, now) {
  var out = [], isList = false, k, i;
  for (k in SHEETS) if (hasOwn(SHEETS, k) && SHEETS[k] === ed.sheet) isList = true;
  if (!isList || ed.col !== 1) return out;
  for (i = 0; i < ed.values.length; i++) {
    var row = ed.row + i;
    if (row < FIRST_ROW) continue;
    out.push({ row: row, doneAt: ed.values[i][0] === true ? now : "" });
  }
  return out;
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
      var rows = sh.getRange(FIRST_ROW, 1, last - FIRST_ROW + 1, 5).getValues();
      var idResult = ensureRowIds(rows, function () { return Utilities.getUuid(); });
      if (idResult.changed) sh.getRange(FIRST_ROW, 5, rows.length, 1).setValues(idResult.ids);
      return rows;
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

/* Simple trigger: Google runs it on every edit made by hand in the Sheet
   (not on writes made by this script, e.g. a tap on the iPad). */
function onEdit(e) {
  if (!e || !e.range) return;
  var r = e.range;
  var sh = r.getSheet();
  var fixes = sheetEditFix({ sheet: sh.getName(), row: r.getRow(), col: r.getColumn(),
                             values: r.getValues() }, new Date());
  for (var i = 0; i < fixes.length; i++) {
    sh.getRange(fixes[i].row, 4).setValue(fixes[i].doneAt);
  }
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
    FIRST_ROW: FIRST_ROW, SHEETS: SHEETS, ROW_ID_RE: ROW_ID_RE,
    ensureRowIds: ensureRowIds, readList: readList, isAuthorized: isAuthorized, handle: handle,
    jsonpWrap: jsonpWrap, sheetEditFix: sheetEditFix
  };
}
