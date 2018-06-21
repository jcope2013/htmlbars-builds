'use strict';

var HydrationOpcodeCompiler = require('../htmlbars-compiler/hydration-opcode-compiler');
var parser = require('../htmlbars-syntax/parser');
var compiler = require('../htmlbars-compiler/compiler');

function opcodesFor(html, options) {
  var ast = parser.preprocess(html, options),
      compiler1 = new HydrationOpcodeCompiler['default'](options);
  compiler1.compile(ast);
  return compiler1.opcodes;
}

QUnit.module("HydrationOpcodeCompiler opcode generation");

function loc(startCol, endCol) {
  var startLine = arguments.length <= 2 || arguments[2] === undefined ? 1 : arguments[2];
  var endLine = arguments.length <= 3 || arguments[3] === undefined ? 1 : arguments[3];
  var source = arguments.length <= 4 || arguments[4] === undefined ? null : arguments[4];

  return ['loc', [source, [startLine, startCol], [endLine, endCol]]];
}

function sloc(startCol, endCol) {
  var startLine = arguments.length <= 2 || arguments[2] === undefined ? 1 : arguments[2];
  var endLine = arguments.length <= 3 || arguments[3] === undefined ? 1 : arguments[3];
  var source = arguments.length <= 4 || arguments[4] === undefined ? null : arguments[4];

  return ['loc', [source, [startLine, startCol], [endLine, endCol]]];
}

function equalOpcodes(actual, expected) {
  var equiv = QUnit.equiv(actual, expected);

  var exString = "";
  var acString = "";
  var i = 0;

  for (; i < actual.length; i++) {
    var a = actual[i];
    var e = expected && expected[i];

    a = a ? JSON.stringify(a).replace(/"/g, "'") : "";
    e = e ? JSON.stringify(e).replace(/"/g, "'") : "";

    exString += e + "\n";
    acString += a + "\n";
  }

  if (expected) {
    for (; i < expected.length; i++) {
      var e = expected[i];

      e = e ? JSON.stringify(e).replace(/"/g, "'") : "";

      acString += "\n";
      exString += e + "\n";
    }
  }

  QUnit.push(equiv, acString, exString);
}

function equalStatements(actual, expected) {
  equalOpcodes(actual, expected);
}

function testCompile(string, templateSource, opcodes) {
  for (var _len = arguments.length, statementList = Array(_len > 3 ? _len - 3 : 0), _key = 3; _key < _len; _key++) {
    statementList[_key - 3] = arguments[_key];
  }

  QUnit.module("Compiling " + string + ": " + templateSource);

  test("opcodes", function () {
    equalOpcodes(opcodesFor(templateSource), opcodes);
  });

  var template = compiler.compile(templateSource).raw;
  var statements = statementList.shift();

  test("statements for the root template", function () {
    equalStatements(template.statements, statements);
  });

  test("correct list of child templates", function () {
    equal(template.templates.length, statementList.length, "list of child templates should match the expected list of statements");
  });

  for (var i = 0, l = statementList.length; i < l; i++) {
    statementTest(template.templates, statementList, i);
  }

  function statementTest(templates, list, i) {
    test("statements for template " + i, function () {
      equalStatements(templates[i].statements, list[i]);
    });
  }
}

var s = {
  content: function (path, loc) {
    return ['content', path, sloc.apply(undefined, loc)];
  },

  block: function (name, loc) {
    var template = arguments.length <= 2 || arguments[2] === undefined ? null : arguments[2];
    var params = arguments.length <= 3 || arguments[3] === undefined ? [] : arguments[3];
    var hash = arguments.length <= 4 || arguments[4] === undefined ? [] : arguments[4];
    var inverse = arguments.length <= 5 || arguments[5] === undefined ? null : arguments[5];

    return ['block', name, params, hash, template, inverse, sloc.apply(undefined, loc)];
  },

  inline: function (name) {
    var params = arguments.length <= 1 || arguments[1] === undefined ? [] : arguments[1];
    var hash = arguments.length <= 2 || arguments[2] === undefined ? [] : arguments[2];
    var loc = arguments.length <= 3 || arguments[3] === undefined ? null : arguments[3];

    return ['inline', name, params, hash, sloc.apply(undefined, loc)];
  },

  element: function (name) {
    var params = arguments.length <= 1 || arguments[1] === undefined ? [] : arguments[1];
    var hash = arguments.length <= 2 || arguments[2] === undefined ? [] : arguments[2];
    var loc = arguments.length <= 3 || arguments[3] === undefined ? null : arguments[3];

    return ['element', name, params, hash, sloc.apply(undefined, loc)];
  },

  attribute: function (name, expression) {
    return ['attribute', name, expression];
  },

  component: function (path) {
    var attrs = arguments.length <= 1 || arguments[1] === undefined ? [] : arguments[1];
    var template = arguments.length <= 2 || arguments[2] === undefined ? null : arguments[2];

    return ['component', path, attrs, template];
  },

  get: function (path, loc) {
    return ['get', path, sloc.apply(undefined, loc)];
  },

  concat: function () {
    for (var _len2 = arguments.length, args = Array(_len2), _key2 = 0; _key2 < _len2; _key2++) {
      args[_key2] = arguments[_key2];
    }

    return ['concat', args];
  },

  subexpr: function (name) {
    var params = arguments.length <= 1 || arguments[1] === undefined ? [] : arguments[1];
    var hash = arguments.length <= 2 || arguments[2] === undefined ? [] : arguments[2];
    var loc = arguments.length <= 3 || arguments[3] === undefined ? null : arguments[3];

    return ['subexpr', name, params, hash, sloc.apply(undefined, loc)];
  }
};

testCompile("simple example", "<div>{{foo}} bar {{baz}}</div>", [["consumeParent", [0]], ["shareElement", [0]], ["createMorph", [0, [0], 0, 0, true]], ["createMorph", [1, [0], 2, 2, true]], ["pushLiteral", ["foo"]], ["printContentHook", [loc(5, 12)]], ["pushLiteral", ["baz"]], ["printContentHook", [loc(17, 24)]], ["popParent", []]], [s.content('foo', [5, 12]), s.content('baz', [17, 24])]);

testCompile("simple block", "<div>{{#foo}}{{/foo}}</div>", [["consumeParent", [0]], ["createMorph", [0, [0], 0, 0, true]], ["prepareObject", [0]], ["prepareArray", [0]], ["pushLiteral", ["foo"]], ["printBlockHook", [0, null, loc(5, 21)]], ["popParent", []]], [s.block('foo', [5, 21], 0)], []);

testCompile("simple block with block params", "<div>{{#foo as |bar baz|}}{{/foo}}</div>", [["consumeParent", [0]], ["createMorph", [0, [0], 0, 0, true]], ["prepareObject", [0]], ["prepareArray", [0]], ["pushLiteral", ["foo"]], ["printBlockHook", [0, null, loc(5, 34)]], ["popParent", []]], [s.block('foo', [5, 34], 0)], []);

testCompile("element with a sole mustache child", "<div>{{foo}}</div>", [["consumeParent", [0]], ["createMorph", [0, [0], 0, 0, true]], ["pushLiteral", ["foo"]], ["printContentHook", [loc(5, 12)]], ["popParent", []]], [s.content('foo', [5, 12])]);

testCompile("element with a mustache between two text nodes", "<div> {{foo}} </div>", [["consumeParent", [0]], ["createMorph", [0, [0], 1, 1, true]], ["pushLiteral", ["foo"]], ["printContentHook", [loc(6, 13)]], ["popParent", []]], [s.content('foo', [6, 13])]);

testCompile("mustache two elements deep", "<div><div>{{foo}}</div></div>", [["consumeParent", [0]], ["consumeParent", [0]], ["createMorph", [0, [0, 0], 0, 0, true]], ["pushLiteral", ["foo"]], ["printContentHook", [loc(10, 17)]], ["popParent", []], ["popParent", []]], [s.content('foo', [10, 17])]);

testCompile("two sibling elements with mustaches", "<div>{{foo}}</div><div>{{bar}}</div>", [["consumeParent", [0]], ["createMorph", [0, [0], 0, 0, true]], ["pushLiteral", ["foo"]], ["printContentHook", [loc(5, 12)]], ["popParent", []], ["consumeParent", [1]], ["createMorph", [1, [1], 0, 0, true]], ["pushLiteral", ["bar"]], ["printContentHook", [loc(23, 30)]], ["popParent", []]], [s.content('foo', [5, 12]), s.content('bar', [23, 30])]);

testCompile("mustaches at the root", "{{foo}} {{bar}}", [["createMorph", [0, [], 0, 0, true]], ["createMorph", [1, [], 2, 2, true]], ["openBoundary", []], ["pushLiteral", ["foo"]], ["printContentHook", [loc(0, 7)]], ["closeBoundary", []], ["pushLiteral", ["bar"]], ["printContentHook", [loc(8, 15)]]], [s.content('foo', [0, 7]), s.content('bar', [8, 15])]);

testCompile("back to back mustaches should have a text node inserted between them", "<div>{{foo}}{{bar}}{{baz}}wat{{qux}}</div>", [["consumeParent", [0]], ["shareElement", [0]], ["createMorph", [0, [0], 0, 0, true]], ["createMorph", [1, [0], 1, 1, true]], ["createMorph", [2, [0], 2, 2, true]], ["createMorph", [3, [0], 4, 4, true]], ["pushLiteral", ["foo"]], ["printContentHook", [loc(5, 12)]], ["pushLiteral", ["bar"]], ["printContentHook", [loc(12, 19)]], ["pushLiteral", ["baz"]], ["printContentHook", [loc(19, 26)]], ["pushLiteral", ["qux"]], ["printContentHook", [loc(29, 36)]], ["popParent", []]], [s.content('foo', [5, 12]), s.content('bar', [12, 19]), s.content('baz', [19, 26]), s.content('qux', [29, 36])]);

testCompile("helper usage", "<div>{{foo 'bar' baz.bat true 3.14}}</div>", [["consumeParent", [0]], ["createMorph", [0, [0], 0, 0, true]], ["prepareObject", [0]], ["pushLiteral", [3.14]], ["pushLiteral", [true]], ["pushGetHook", ["baz.bat", loc(17, 24)]], ["pushLiteral", ["bar"]], ["prepareArray", [4]], ["pushLiteral", ["foo"]], ["printInlineHook", [loc(5, 36)]], ["popParent", []]], [s.inline('foo', ['bar', s.get('baz.bat', [17, 24]), true, 3.14], [], [5, 36])]);

testCompile("node mustache", "<div {{foo}}></div>", [["consumeParent", [0]], ["prepareObject", [0]], ["prepareArray", [0]], ["pushLiteral", ["foo"]], ["shareElement", [0]], ["createElementMorph", [0, 0]], ["printElementHook", [loc(5, 12)]], ["popParent", []]], [s.element('foo', [], [], [5, 12])]);

testCompile("node helper", "<div {{foo 'bar'}}></div>", [["consumeParent", [0]], ["prepareObject", [0]], ["pushLiteral", ["bar"]], ["prepareArray", [1]], ["pushLiteral", ["foo"]], ["shareElement", [0]], ["createElementMorph", [0, 0]], ["printElementHook", [loc(5, 18)]], ["popParent", []]], [s.element('foo', ['bar'], [], [5, 18])]);

testCompile("attribute mustache", "<div class='before {{foo}} after'></div>", [["consumeParent", [0]], ["pushLiteral", [" after"]], ["pushGetHook", ["foo", loc(21, 24)]], ["pushLiteral", ["before "]], ["prepareArray", [3]], ["pushConcatHook", [0]], ["pushLiteral", ["class"]], ["shareElement", [0]], ["createAttrMorph", [0, 0, "class", true, null]], ["printAttributeHook", []], ["popParent", []]], [s.attribute('class', s.concat('before ', s.get('foo', [21, 24]), ' after'))]);

testCompile("quoted attribute mustache", "<div class='{{foo}}'></div>", [["consumeParent", [0]], ["pushGetHook", ["foo", loc(14, 17)]], ["prepareArray", [1]], ["pushConcatHook", [0]], ["pushLiteral", ["class"]], ["shareElement", [0]], ["createAttrMorph", [0, 0, "class", true, null]], ["printAttributeHook", []], ["popParent", []]], [s.attribute('class', s.concat(s.get('foo', [14, 17])))]);

testCompile("safe bare attribute mustache", "<div class={{foo}}></div>", [["consumeParent", [0]], ["pushGetHook", ["foo", loc(13, 16)]], ["pushLiteral", ["class"]], ["shareElement", [0]], ["createAttrMorph", [0, 0, "class", true, null]], ["printAttributeHook", []], ["popParent", []]], [s.attribute('class', s.get('foo', [13, 16]))]);

testCompile("unsafe bare attribute mustache", "<div class={{{foo}}}></div>", [["consumeParent", [0]], ["pushGetHook", ["foo", loc(14, 17)]], ["pushLiteral", ["class"]], ["shareElement", [0]], ["createAttrMorph", [0, 0, "class", false, null]], ["printAttributeHook", []], ["popParent", []]], [s.attribute('class', s.get('foo', [14, 17]))]);

testCompile("attribute helper", "<div class='before {{foo 'bar'}} after'></div>", [["consumeParent", [0]], ["pushLiteral", [" after"]], ["prepareObject", [0]], ["pushLiteral", ["bar"]], ["prepareArray", [1]], ["pushLiteral", ["foo"]], ["pushSexprHook", [loc(19, 32)]], ["pushLiteral", ["before "]], ["prepareArray", [3]], ["pushConcatHook", [0]], ["pushLiteral", ["class"]], ["shareElement", [0]], ["createAttrMorph", [0, 0, "class", true, null]], ["printAttributeHook", []], ["popParent", []]], [s.attribute('class', s.concat('before ', s.subexpr('foo', ['bar'], [], [19, 32]), ' after'))]);

testCompile("attribute helpers", "<div class='before {{foo 'bar'}} after' id={{bare}}></div>{{morphThing}}<span class='{{ohMy}}'></span>", [["consumeParent", [0]], ["shareElement", [0]], ["pushLiteral", [" after"]], ["prepareObject", [0]], ["pushLiteral", ["bar"]], ["prepareArray", [1]], ["pushLiteral", ["foo"]], ["pushSexprHook", [loc(19, 32)]], ["pushLiteral", ["before "]], ["prepareArray", [3]], ["pushConcatHook", [0]], ["pushLiteral", ["class"]], ["createAttrMorph", [0, 0, "class", true, null]], ["printAttributeHook", []], ["pushGetHook", ['bare', loc(45, 49)]], ["pushLiteral", ['id']], ["createAttrMorph", [1, 0, 'id', true, null]], ["printAttributeHook", []], ["popParent", []], ["createMorph", [2, [], 1, 1, true]], ["pushLiteral", ['morphThing']], ["printContentHook", [loc(58, 72)]], ["consumeParent", [2]], ["pushGetHook", ['ohMy', loc(87, 91)]], ["prepareArray", [1]], ["pushConcatHook", [3]], ["pushLiteral", ['class']], ["shareElement", [1]], ["createAttrMorph", [3, 1, 'class', true, null]], ["printAttributeHook", []], ["popParent", []]], [s.attribute('class', s.concat('before ', s.subexpr('foo', ['bar'], [], [19, 32]), ' after')), s.attribute('id', s.get('bare', [45, 49])), s.content('morphThing', [58, 72]), s.attribute('class', s.concat(s.get('ohMy', [87, 91])))]);

testCompile('component helpers', "<my-component>hello</my-component>", [["createMorph", [0, [], 0, 0, true]], ["openBoundary", []], ["closeBoundary", []], ["prepareObject", [0]], ["pushLiteral", ["my-component"]], ["printComponentHook", [0, 0, loc(0, 34)]]], [s.component('my-component', [], 0)], []);