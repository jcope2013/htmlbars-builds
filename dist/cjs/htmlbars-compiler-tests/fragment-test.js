'use strict';

var FragmentOpcodeCompiler = require('../htmlbars-compiler/fragment-opcode-compiler');
var FragmentJavaScriptCompiler = require('../htmlbars-compiler/fragment-javascript-compiler');
var DOMHelper = require('../dom-helper');
var parser = require('../htmlbars-syntax/parser');
var htmlbars_test_helpers = require('../htmlbars-test-helpers');

var xhtmlNamespace = "http://www.w3.org/1999/xhtml",
    svgNamespace = "http://www.w3.org/2000/svg";

function fragmentFor(ast) {
  /* jshint evil: true */
  var fragmentOpcodeCompiler = new FragmentOpcodeCompiler['default'](),
      fragmentCompiler = new FragmentJavaScriptCompiler['default']();

  var opcodes = fragmentOpcodeCompiler.compile(ast);
  var program = fragmentCompiler.compile(opcodes);

  var fn = new Function("dom", 'return ' + program)();

  return fn(new DOMHelper['default']());
}

QUnit.module('fragment');

test('compiles a fragment', function () {
  var ast = parser.preprocess("<div>{{foo}} bar {{baz}}</div>");
  var divNode = fragmentFor(ast).firstChild;

  htmlbars_test_helpers.equalHTML(divNode, "<div><!----> bar <!----></div>");
});

if (document && document.createElementNS) {
  test('compiles an svg fragment', function () {
    var ast = parser.preprocess("<div><svg><circle/><foreignObject><span></span></foreignObject></svg></div>");
    var divNode = fragmentFor(ast).firstChild;

    equal(divNode.childNodes[0].namespaceURI, svgNamespace, 'svg has the right namespace');
    equal(divNode.childNodes[0].childNodes[0].namespaceURI, svgNamespace, 'circle has the right namespace');
    equal(divNode.childNodes[0].childNodes[1].namespaceURI, svgNamespace, 'foreignObject has the right namespace');
    equal(divNode.childNodes[0].childNodes[1].childNodes[0].namespaceURI, xhtmlNamespace, 'span has the right namespace');
  });
}

test('compiles an svg element with classes', function () {
  var ast = parser.preprocess('<svg class="red right hand"></svg>');
  var svgNode = fragmentFor(ast).firstChild;

  equal(svgNode.getAttribute('class'), 'red right hand');
});

if (document && document.createElementNS) {
  test('compiles an svg element with proper namespace', function () {
    var ast = parser.preprocess('<svg><use xlink:title="nice-title"></use></svg>');
    var svgNode = fragmentFor(ast).firstChild;

    equal(svgNode.childNodes[0].getAttributeNS('http://www.w3.org/1999/xlink', 'title'), 'nice-title');
    equal(svgNode.childNodes[0].attributes[0].namespaceURI, 'http://www.w3.org/1999/xlink');
    equal(svgNode.childNodes[0].attributes[0].name, 'xlink:title');
    equal(svgNode.childNodes[0].attributes[0].localName, 'title');
    equal(svgNode.childNodes[0].attributes[0].value, 'nice-title');
  });
}

test('converts entities to their char/string equivalent', function () {
  var ast = parser.preprocess("<div title=\"&quot;Foo &amp; Bar&quot;\">lol &lt; &#60;&#x3c; &#x3C; &LT; &NotGreaterFullEqual; &Borksnorlax;</div>");
  var divNode = fragmentFor(ast).firstChild;

  equal(divNode.getAttribute('title'), '"Foo & Bar"');
  equal(htmlbars_test_helpers.getTextContent(divNode), "lol < << < < ≧̸ &Borksnorlax;");
});