/* Loads code under test without a browser or Google.
   - index.html: runs its <script> in a sandbox (no `document`, so the
     wiring block is skipped) and returns module.exports.
   - apps-script/Code.gs: runs it in a sandbox and returns module.exports. */
"use strict";
var fs = require("fs");
var path = require("path");
var vm = require("vm");

var ROOT = path.join(__dirname, "..");

function runInSandbox(code, file) {
  var sandbox = { module: { exports: {} }, console: console };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: file });
  return sandbox.module.exports;
}

function loadPanel() {
  var html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  var m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("index.html: no inline <script> found");
  return runInSandbox(m[1], "index.html");
}

function loadGScript() {
  var file = path.join(ROOT, "apps-script", "Code.gs");
  if (!fs.existsSync(file)) throw new Error("apps-script/Code.gs does not exist yet");
  return runInSandbox(fs.readFileSync(file, "utf8"), "Code.gs");
}

/* calendar backend — a separate Apps Script project on the panel's own account */
function loadCalScript() {
  var file = path.join(ROOT, "apps-script", "Calendar.gs");
  if (!fs.existsSync(file)) throw new Error("apps-script/Calendar.gs does not exist yet");
  return runInSandbox(fs.readFileSync(file, "utf8"), "Calendar.gs");
}

function readRepoFile(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/* "2026-09-23" for a Date, in Warsaw time — the same job
   Utilities.formatDate(d, "Europe/Warsaw", "yyyy-MM-dd") does in Apps Script */
var fmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit"
});
function dayOf(d) { return fmt.format(d); }

module.exports = { loadPanel: loadPanel, loadGScript: loadGScript, loadCalScript: loadCalScript,
                   readRepoFile: readRepoFile, dayOf: dayOf };
