'use strict';

var parser = require('../htmlbars-syntax/parser');
var Walker = require('../htmlbars-syntax/walker');

function compareWalkedNodes(html, expected) {
  var ast = parser.preprocess(html);
  var walker = new Walker['default']();
  var nodes = [];

  walker.visit(ast, function (node) {
    nodes.push(node.type);
  });

  deepEqual(nodes, expected);
}

QUnit.module('AST Walker');

test('walks elements', function () {
  compareWalkedNodes('<div><li></li></div>', ['Program', 'ElementNode', 'ElementNode']);
});

test('walks blocks', function () {
  compareWalkedNodes('{{#foo}}<li></li>{{/foo}}', ['Program', 'BlockStatement', 'Program', 'ElementNode']);
});

test('walks components', function () {
  compareWalkedNodes('<my-foo><li></li></my-foo>', ['Program', 'ComponentNode', 'Program', 'ElementNode']);
});