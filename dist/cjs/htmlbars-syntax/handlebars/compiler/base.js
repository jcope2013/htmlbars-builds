'use strict';

exports.parse = parse;

var parser = require('./parser');
var AST = require('./ast');
var WhitespaceControl = require('./whitespace-control');
var Helpers = require('./helpers');
var utils = require('../utils');

var yy = {};
utils.extend(yy, Helpers, AST['default']);

function parse(input, options) {
  // Just return if an already-compiled AST was passed in.
  if (input.type === 'Program') {
    return input;
  }

  parser['default'].yy = yy;

  // Altering the shared object here, but this is ok as parser is a sync operation
  yy.locInfo = function (locInfo) {
    return new yy.SourceLocation(options && options.srcName, locInfo);
  };

  var strip = new WhitespaceControl['default']();
  return strip.accept(parser['default'].parse(input));
}

exports.parser = parser['default'];