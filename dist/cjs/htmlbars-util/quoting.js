'use strict';

exports.hash = hash;
exports.repeat = repeat;
exports.escapeString = escapeString;
exports.string = string;
exports.array = array;

function escapeString(str) {
  str = str.replace(/\\/g, "\\\\");
  str = str.replace(/"/g, '\\"');
  str = str.replace(/\n/g, "\\n");
  return str;
}

function string(str) {
  return '"' + escapeString(str) + '"';
}

function array(a) {
  return "[" + a + "]";
}

function hash(pairs) {
  return "{" + pairs.join(", ") + "}";
}

function repeat(chars, times) {
  var str = "";
  while (times--) {
    str += chars;
  }
  return str;
}