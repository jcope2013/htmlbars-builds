'use strict';

exports.isSpace = isSpace;
exports.isAlpha = isAlpha;
exports.preprocessInput = preprocessInput;

function isSpace(char) {
  return (/[\t\n\f ]/.test(char)
  );
}

function isAlpha(char) {
  return (/[A-Za-z]/.test(char)
  );
}

function preprocessInput(input) {
  return input.replace(/\r\n?/g, "\n");
}