/* Home-screen and tab icons (variant B). Run from the repo root:  node --test
   I1–I2 here, I3 = whole suite, M7 = iPad (re-add to home screen). */
"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var path = require("path");
var h = require("./helpers");

var ROOT = path.join(__dirname, "..");
function pngSize(rel) {
  var b = fs.readFileSync(path.join(ROOT, rel));
  assert.equal(b.toString("ascii", 1, 4), "PNG", rel + " is a PNG");
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

test("I1 icon PNGs exist with the right sizes", function () {
  assert.deepEqual(pngSize("icons/apple-touch-icon.png"), [180, 180]);
  assert.deepEqual(pngSize("icons/icon-152.png"), [152, 152]);
  assert.deepEqual(pngSize("icons/favicon-32.png"), [32, 32]);
  assert.ok(fs.existsSync(path.join(ROOT, "icons/icon.svg")), "editable source kept");
});

test("I2 index.html links the icons with relative paths (Pages serves from a subfolder)", function () {
  var html = h.readRepoFile("index.html");
  assert.match(html, /<link rel="apple-touch-icon" sizes="152x152" href="icons\/icon-152\.png">/);
  assert.match(html, /<link rel="apple-touch-icon" sizes="180x180" href="icons\/apple-touch-icon\.png">/);
  assert.match(html, /<link rel="icon" type="image\/png" sizes="32x32" href="icons\/favicon-32\.png">/);
  assert.doesNotMatch(html, /href="\/icons/, "no root-relative icon paths");
});
