/* Panel iPad — backend for Zakupy/ToDo (Google Apps Script, bound to the Sheet).
   Source of truth lives in the repo (apps-script/Code.gs); paste it into the
   Apps Script editor as the whole of Code.gs.

   Data comes from Todoist (two shared projects: Zakupy, ToDo). The script is
   the middleman, so the Todoist token never reaches the iPad or the repo.
   The Sheet stays as a backup only (onEdit below still keeps it tidy); going
   back to it = paste apps-script/Sheet.gs here instead + new deployment version
   (same URL and key, nothing to change on the iPad). See README.

   Script Properties (Project Settings -> Script Properties):
     KEY               key the iPad sends (run generateKey() to create it)
     TODOIST_TOKEN     Todoist -> Settings -> Integrations -> Developer -> API token
     ZAKUPY_PROJECT_ID id of the "Zakupy" project
     TODO_PROJECT_ID   id of the "ToDo" project
   After setting them run smokeTest() once and read the Execution log.

   API (JSONP, GET only):
     ?key=K&callback=cb                             -> cb({ok, zakupy:[...], todo:[...]})
     ?key=K&callback=cb&tick=zakupy&id=6Xab&done=1  -> cb({ok})   (done=0 reopens)
   Item: { id: "<Todoist task id>", text: "...", done: true|false }
   Shown: tasks with no date, due today or overdue, plus tasks completed today
   (Europe/Warsaw), struck through until midnight. Recurring tasks are not
   "completed" by Todoist (it moves them to the next date), so those come from
   the activity log and carry recurring: true; they cannot be unticked.
   Errors: {ok:false, error: "auth" | "config" | "bad-tick" | "todoist" [, status]} */

var TZ = "Europe/Warsaw";
var CALLBACK_RE = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/;
var TODOIST_BASE = "https://api.todoist.com/api/v1";
var LISTS = { zakupy: "Zakupy", todo: "ToDo" };      /* API key -> Todoist project name */
var FILTER = "(no date | today | overdue) & (#" + LISTS.zakupy + " | #" + LISTS.todo + ")";
var TASK_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
var MAX_PAGES = 10;                                   /* safety stop for pagination */

/* Sheet backup: tab names and first data row, used only by onEdit */
var FIRST_ROW = 4;                                  /* rows 1-3: title, blank, header */
var SHEETS = { zakupy: "Zakupy", todo: "To do" };

function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

function cellText(v) {
  return String(v === null || v === undefined ? "" : v).replace(/^\s+|\s+$/g, "");
}

function isoUtc(ms) { return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z"); }

/* "Done today" window: from Warsaw midnight to now, both in UTC.
   dayOf(Date) -> "yyyy-mm-dd" in Warsaw. Works on DST change days. */
function todayRange(now, dayOf) {
  var t = now.getTime();
  var today = dayOf(new Date(t));
  var p = today.split("-");
  var utcMidnight = Date.UTC(+p[0], +p[1] - 1, +p[2]);
  var k, c;
  for (k = 14; k >= -12; k--) {                   /* earliest instant that is already "today" */
    c = utcMidnight - k * 3600000;
    if (dayOf(new Date(c)) === today && dayOf(new Date(c - 1)) !== today) {
      return { since: isoUtc(c), until: isoUtc(t) };
    }
  }
  return { since: isoUtc(t - 86400000), until: isoUtc(t) };  /* never reached for real zones */
}

function isAuthorized(params, secret) {
  if (typeof secret !== "string" || secret.length === 0) return false;
  return typeof params.key === "string" && params.key === secret;
}

function hasConfig(deps) {
  var pr = deps.projects || {};
  function ok(v) { return typeof v === "string" && v.length > 0; }
  return ok(deps.token) && ok(pr.zakupy) && ok(pr.todo);
}

function todoistError(err) {
  return (err && typeof err.status === "number")
    ? { ok: false, error: "todoist", status: err.status }
    : { ok: false, error: "todoist" };
}

/* all pages of one GET list endpoint; field = "results" or "items" */
function fetchAll(deps, path, params, field) {
  var out = [], cursor = null, page, k;
  for (page = 0; page < MAX_PAGES; page++) {
    var q = {};
    for (k in params) if (hasOwn(params, k)) q[k] = params[k];
    if (cursor) q.cursor = cursor;
    var res = deps.api("GET", path, q);
    if (!res || res.code !== 200) throw { status: res ? res.code : 0 };
    var body = res.body || {};
    var list = body[field] || [];
    for (k = 0; k < list.length; k++) out.push(list[k]);
    cursor = body.next_cursor;
    if (!cursor) break;
  }
  return out;
}

/* deps: { secret, token, projects: {zakupy, todo}, now, dayOf, api(method, path, params) -> {code, body} } */
function handle(params, deps) {
  params = params || {};
  if (!isAuthorized(params, deps.secret)) return { ok: false, error: "auth" };
  if (!hasConfig(deps)) return { ok: false, error: "config" };
  if (params.tick !== undefined) return doTick(params, deps);

  var range = todayRange(deps.now, deps.dayOf);
  var today = deps.dayOf(deps.now);
  var active, done;
  try {
    active = fetchAll(deps, "/tasks/filter", { query: FILTER }, "results");
    done = fetchAll(deps, "/tasks/completed/by_completion_date",
                    { since: range.since, until: range.until }, "items");
  } catch (err) {
    return todoistError(err);
  }
  var activity;
  try {                                                /* optional: only for recurring tasks */
    activity = fetchAll(deps, "/activities",
                        { event_type: "completed", object_type: "item", date_from: range.since }, "results");
  } catch (err2) {
    activity = [];
  }

  var out = { ok: true }, seen = {}, k, i;
  for (k in LISTS) if (hasOwn(LISTS, k)) out[k] = [];

  function listOf(projectId) {
    for (var key in LISTS) {
      if (hasOwn(LISTS, key) && String(deps.projects[key]) === String(projectId)) return key;
    }
    return null;
  }
  function add(id, projectId, content, isDone, recurring) {
    var list = listOf(projectId);
    var text = cellText(content);
    id = String(id);
    if (!list || !text || seen[id]) return;
    seen[id] = true;
    var item = { id: id, text: text, done: isDone };
    if (recurring) item.recurring = true;
    out[list].push(item);
  }

  function isToday(iso) {
    var at = new Date(iso);
    return !isNaN(at.getTime()) && deps.dayOf(at) === today;
  }

  for (i = 0; i < active.length; i++) add(active[i].id, active[i].project_id, active[i].content, false);
  for (i = 0; i < done.length; i++) {
    if (isToday(done[i].completed_at)) add(done[i].id, done[i].project_id, done[i].content, true);
  }
  for (i = 0; i < activity.length; i++) {
    var ev = activity[i], extra = ev.extra_data || {};
    if (extra.is_recurring !== true || !isToday(ev.event_date)) continue;   /* normal tasks: see above */
    add(ev.object_id, ev.parent_project_id, extra.content, true, true);
  }
  return out;
}

function doTick(p, deps) {
  var bad = { ok: false, error: "bad-tick" };
  if (typeof p.tick !== "string" || !hasOwn(LISTS, p.tick)) return bad;
  if (typeof p.id !== "string" || !TASK_ID_RE.test(p.id)) return bad;
  if (p.done !== "1" && p.done !== "0") return bad;
  var candidates;
  try {
    if (p.done === "1") {
      candidates = fetchAll(deps, "/tasks/filter", { query: FILTER }, "results");
    } else {
      var range = todayRange(deps.now, deps.dayOf);
      candidates = fetchAll(deps, "/tasks/completed/by_completion_date",
                            { since: range.since, until: range.until }, "items");
    }
  } catch (err) {
    return todoistError(err);
  }
  var projectId = String(deps.projects[p.tick]), found = false, i;
  for (i = 0; i < candidates.length; i++) {
    if (String(candidates[i].id) === p.id && String(candidates[i].project_id) === projectId) {
      found = true;
      break;
    }
  }
  if (!found) return bad;
  var res;
  try {
    res = deps.api("POST", "/tasks/" + p.id + (p.done === "1" ? "/close" : "/reopen"), {});
  } catch (err) {
    return todoistError(err);
  }
  if (!res || (res.code !== 200 && res.code !== 204)) return todoistError({ status: res ? res.code : 0 });
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

function queryString(params) {
  var parts = [], k;
  for (k in params) {
    if (hasOwn(params, k)) parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(params[k]));
  }
  return parts.length ? "?" + parts.join("&") : "";
}

function gasDeps() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty("TODOIST_TOKEN") || "";
  return {
    secret: props.getProperty("KEY") || "",
    token: token,
    projects: {
      zakupy: props.getProperty("ZAKUPY_PROJECT_ID") || "",
      todo: props.getProperty("TODO_PROJECT_ID") || ""
    },
    now: new Date(),
    dayOf: function (d) { return Utilities.formatDate(d, TZ, "yyyy-MM-dd"); },
    api: function (method, path, params) {
      var url = TODOIST_BASE + path + (method === "GET" ? queryString(params || {}) : "");
      var resp = UrlFetchApp.fetch(url, {
        method: method.toLowerCase(),
        headers: { Authorization: "Bearer " + token },
        muteHttpExceptions: true
      });
      var text = resp.getContentText();
      var body = null;
      try { body = text ? JSON.parse(text) : null; } catch (e) { body = null; }
      return { code: resp.getResponseCode(), body: body };
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

/* Run once from the editor after filling Script Properties (manual test D1).
   Logs every Todoist call with its HTTP code, then the answer the iPad would get.
   Look for: both calls 200, and your tasks under zakupy / todo. */
function smokeTest() {
  var deps = gasDeps();
  var realApi = deps.api;
  deps.api = function (method, path, params) {
    var res = realApi(method, path, params);
    Logger.log(method + " " + path + " -> " + res.code);
    return res;
  };
  Logger.log("filter: " + FILTER);
  Logger.log(JSON.stringify(handle({ key: deps.secret }, deps), null, 2));
}

if (typeof module !== "undefined") {
  module.exports = {
    FIRST_ROW: FIRST_ROW, SHEETS: SHEETS, LISTS: LISTS, FILTER: FILTER,
    isAuthorized: isAuthorized, handle: handle, todayRange: todayRange,
    jsonpWrap: jsonpWrap, sheetEditFix: sheetEditFix
  };
}
