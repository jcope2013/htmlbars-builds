'use strict';

exports.preprocess = preprocess;
exports.Parser = Parser;

var base = require('./handlebars/compiler/base');
var syntax = require('../htmlbars-syntax');
var EventedTokenizer = require('../simple-html-tokenizer/evented-tokenizer');
var EntityParser = require('../simple-html-tokenizer/entity-parser');
var fullCharRefs = require('../simple-html-tokenizer/char-refs/full');
var handlebarsNodeVisitors = require('./parser/handlebars-node-visitors');
var tokenizerEventHandlers = require('./parser/tokenizer-event-handlers');

function preprocess(html, options) {
  var ast = typeof html === 'object' ? html : base.parse(html);
  var combined = new Parser(html, options).acceptNode(ast);

  if (options && options.plugins && options.plugins.ast) {
    for (var i = 0, l = options.plugins.ast.length; i < l; i++) {
      var plugin = new options.plugins.ast[i](options);

      plugin.syntax = syntax;

      combined = plugin.transform(combined);
    }
  }

  return combined;
}

exports['default'] = preprocess;

var entityParser = new EntityParser['default'](fullCharRefs['default']);

function Parser(source, options) {
  this.options = options || {};
  this.elementStack = [];
  this.tokenizer = new EventedTokenizer['default'](this, entityParser);

  this.currentNode = null;
  this.currentAttribute = null;

  if (typeof source === 'string') {
    this.source = source.split(/(?:\r\n?|\n)/g);
  }
}

for (var key in handlebarsNodeVisitors['default']) {
  Parser.prototype[key] = handlebarsNodeVisitors['default'][key];
}

for (var key in tokenizerEventHandlers['default']) {
  Parser.prototype[key] = tokenizerEventHandlers['default'][key];
}

Parser.prototype.acceptNode = function (node) {
  return this[node.type](node);
};

Parser.prototype.currentElement = function () {
  return this.elementStack[this.elementStack.length - 1];
};

Parser.prototype.sourceForMustache = function (mustache) {
  var firstLine = mustache.loc.start.line - 1;
  var lastLine = mustache.loc.end.line - 1;
  var currentLine = firstLine - 1;
  var firstColumn = mustache.loc.start.column + 2;
  var lastColumn = mustache.loc.end.column - 2;
  var string = [];
  var line;

  if (!this.source) {
    return '{{' + mustache.path.id.original + '}}';
  }

  while (currentLine < lastLine) {
    currentLine++;
    line = this.source[currentLine];

    if (currentLine === firstLine) {
      if (firstLine === lastLine) {
        string.push(line.slice(firstColumn, lastColumn));
      } else {
        string.push(line.slice(firstColumn));
      }
    } else if (currentLine === lastLine) {
      string.push(line.slice(0, lastColumn));
    } else {
      string.push(line);
    }
  }

  return string.join('\n');
};