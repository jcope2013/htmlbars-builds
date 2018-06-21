define('htmlbars-syntax-tests/htmlbars-syntax.jshint', function () {

  'use strict';

  QUnit.module('JSHint - htmlbars-syntax-tests');
  QUnit.test('htmlbars-syntax-tests/htmlbars-syntax.js should pass jshint', function (assert) {
    assert.ok(true, 'htmlbars-syntax-tests/htmlbars-syntax.js should pass jshint.');
  });

});
define('htmlbars-syntax-tests/htmlbars-syntax/builders.jshint', function () {

  'use strict';

  QUnit.module('JSHint - htmlbars-syntax-tests/htmlbars-syntax');
  QUnit.test('htmlbars-syntax-tests/htmlbars-syntax/builders.js should pass jshint', function (assert) {
    assert.ok(true, 'htmlbars-syntax-tests/htmlbars-syntax/builders.js should pass jshint.');
  });

});
define('htmlbars-syntax-tests/htmlbars-syntax/parser.jshint', function () {

  'use strict';

  QUnit.module('JSHint - htmlbars-syntax-tests/htmlbars-syntax');
  QUnit.test('htmlbars-syntax-tests/htmlbars-syntax/parser.js should pass jshint', function (assert) {
    assert.ok(true, 'htmlbars-syntax-tests/htmlbars-syntax/parser.js should pass jshint.');
  });

});
define('htmlbars-syntax-tests/htmlbars-syntax/parser/handlebars-node-visitors.jshint', function () {

  'use strict';

  QUnit.module('JSHint - htmlbars-syntax-tests/htmlbars-syntax/parser');
  QUnit.test('htmlbars-syntax-tests/htmlbars-syntax/parser/handlebars-node-visitors.js should pass jshint', function (assert) {
    assert.ok(true, 'htmlbars-syntax-tests/htmlbars-syntax/parser/handlebars-node-visitors.js should pass jshint.');
  });

});
define('htmlbars-syntax-tests/htmlbars-syntax/parser/tokenizer-event-handlers.jshint', function () {

  'use strict';

  QUnit.module('JSHint - htmlbars-syntax-tests/htmlbars-syntax/parser');
  QUnit.test('htmlbars-syntax-tests/htmlbars-syntax/parser/tokenizer-event-handlers.js should pass jshint', function (assert) {
    assert.ok(true, 'htmlbars-syntax-tests/htmlbars-syntax/parser/tokenizer-event-handlers.js should pass jshint.');
  });

});
define('htmlbars-syntax-tests/htmlbars-syntax/utils.jshint', function () {

  'use strict';

  QUnit.module('JSHint - htmlbars-syntax-tests/htmlbars-syntax');
  QUnit.test('htmlbars-syntax-tests/htmlbars-syntax/utils.js should pass jshint', function (assert) {
    assert.ok(true, 'htmlbars-syntax-tests/htmlbars-syntax/utils.js should pass jshint.');
  });

});
define('htmlbars-syntax-tests/htmlbars-syntax/walker.jshint', function () {

  'use strict';

  QUnit.module('JSHint - htmlbars-syntax-tests/htmlbars-syntax');
  QUnit.test('htmlbars-syntax-tests/htmlbars-syntax/walker.js should pass jshint', function (assert) {
    assert.ok(true, 'htmlbars-syntax-tests/htmlbars-syntax/walker.js should pass jshint.');
  });

});
define('htmlbars-syntax-tests/loc-node-test', ['../htmlbars-syntax'], function (htmlbars_syntax) {

  'use strict';

  QUnit.module("Parser - Location Info");

  function locEqual(node, startLine, startColumn, endLine, endColumn, message) {

    var expected = {
      source: null,
      start: { line: startLine, column: startColumn },
      end: { line: endLine, column: endColumn }
    };

    deepEqual(node.loc, expected, message);
  }

  test("programs", function () {
    var ast = htmlbars_syntax.parse("\n  {{#if foo}}\n    {{bar}}\n       {{/if}}\n    ");

    locEqual(ast, 1, 0, 5, 4, 'outer program');

    // startColumn should be 13 not 2.
    // This should be fixed upstream in Handlebars.
    locEqual(ast.body[1].program, 2, 2, 4, 7, 'nested program');
  });

  test("blocks", function () {
    var ast = htmlbars_syntax.parse("\n  {{#if foo}}\n    {{#if bar}}\n        test\n        {{else}}\n      test\n  {{/if    }}\n       {{/if\n      }}\n    ");

    locEqual(ast.body[1], 2, 2, 9, 8, 'outer block');
    locEqual(ast.body[1].program.body[0], 3, 4, 7, 13, 'nested block');
  });

  test("mustache", function () {
    var ast = htmlbars_syntax.parse("\n    {{foo}}\n    {{#if foo}}\n      bar: {{bar\n        }}\n    {{/if}}\n  ");

    locEqual(ast.body[1], 2, 4, 2, 11, 'outer mustache');
    locEqual(ast.body[3].program.body[1], 4, 11, 5, 10, 'inner mustache');
  });

  test("element modifier", function () {
    var ast = htmlbars_syntax.parse("\n    <div {{bind-attr\n      foo\n      bar=wat}}></div>\n  ");

    locEqual(ast.body[1].modifiers[0], 2, 9, 4, 15, 'element modifier');
  });

  test("html elements", function () {
    var ast = htmlbars_syntax.parse("\n    <section>\n      <br>\n      <div>\n        <hr />\n      </div>\n    </section>\n  ");

    var _ast$body = ast.body;
    var section = _ast$body[1];
    var _section$children = section.children;
    var br = _section$children[1];
    var div = _section$children[3];
    var _div$children = div.children;
    var hr = _div$children[1];

    locEqual(section, 2, 4, 7, 14, 'section element');
    locEqual(br, 3, 6, 3, 10, 'br element');
    locEqual(div, 4, 6, 6, 12, 'div element');
    locEqual(hr, 5, 8, 5, 14, 'hr element');
  });

  test("components", function () {
    var ast = htmlbars_syntax.parse("\n    <el-page>\n      <el-header></el-header>\n      <el-input />\n      <el-footer>\n          </el-footer>\n    </el-page>\n  ");

    var _ast$body2 = ast.body;
    var page = _ast$body2[1];
    var _page$program$body = page.program.body;
    var header = _page$program$body[1];
    var input = _page$program$body[3];
    var footer = _page$program$body[5];

    locEqual(page, 2, 4, 7, 14, 'page component');
    locEqual(header, 3, 6, 3, 29, 'header component');
    locEqual(input, 4, 6, 4, 18, 'input component');
    locEqual(footer, 5, 6, 6, 22, 'footer component');
  });

});
define('htmlbars-syntax-tests/loc-node-test.jshint', function () {

  'use strict';

  QUnit.module('JSHint - htmlbars-syntax-tests');
  QUnit.test('htmlbars-syntax-tests/loc-node-test.js should pass jshint', function (assert) {
    assert.ok(true, 'htmlbars-syntax-tests/loc-node-test.js should pass jshint.');
  });

});
define('htmlbars-syntax-tests/parser-node-test', ['../htmlbars-syntax/handlebars/compiler/base', '../htmlbars-syntax/parser', '../htmlbars-syntax/builders'], function (base, parser, b) {

  'use strict';

  QUnit.module("HTML-based compiler (AST)");

  function normalizeNode(obj) {
    if (obj && typeof obj === 'object') {
      var newObj;
      if (obj.splice) {
        newObj = new Array(obj.length);

        for (var i = 0; i < obj.length; i++) {
          newObj[i] = normalizeNode(obj[i]);
        }
      } else {
        newObj = {};

        for (var key in obj) {
          if (obj.hasOwnProperty(key)) {
            newObj[key] = normalizeNode(obj[key]);
          }
        }

        if (newObj.type) {
          newObj._type = newObj.type;
          delete newObj.type;
        }

        newObj.loc = null;
      }
      return newObj;
    } else {
      return obj;
    }
  }

  function astEqual(actual, expected, message) {
    // Perform a deepEqual but recursively remove the locInfo stuff
    // (e.g. line/column information about the compiled template)
    // that we don't want to have to write into our test cases.

    if (typeof actual === 'string') {
      actual = parser.preprocess(actual);
    }
    if (typeof expected === 'string') {
      expected = parser.preprocess(expected);
    }

    actual = normalizeNode(actual);
    expected = normalizeNode(expected);

    deepEqual(actual, expected, message);
  }

  test("a simple piece of content", function () {
    var t = 'some content';
    astEqual(t, b['default'].program([b['default'].text('some content')]));
  });

  test("allow simple AST to be passed", function () {
    var ast = parser.preprocess(base.parse("simple"));

    astEqual(ast, b['default'].program([b['default'].text("simple")]));
  });

  test("allow an AST with mustaches to be passed", function () {
    var ast = parser.preprocess(base.parse("<h1>some</h1> ast {{foo}}"));

    astEqual(ast, b['default'].program([b['default'].element("h1", [], [], [b['default'].text("some")]), b['default'].text(" ast "), b['default'].mustache(b['default'].path('foo'))]));
  });

  test("self-closed element", function () {
    var t = '<g />';
    astEqual(t, b['default'].program([b['default'].element("g")]));
  });

  test("elements can have empty attributes", function () {
    var t = '<img id="">';
    astEqual(t, b['default'].program([b['default'].element("img", [b['default'].attr("id", b['default'].text(""))])]));
  });

  test("svg content", function () {
    var t = "<svg></svg>";
    astEqual(t, b['default'].program([b['default'].element("svg")]));
  });

  test("html content with html content inline", function () {
    var t = '<div><p></p></div>';
    astEqual(t, b['default'].program([b['default'].element("div", [], [], [b['default'].element("p")])]));
  });

  test("html content with svg content inline", function () {
    var t = '<div><svg></svg></div>';
    astEqual(t, b['default'].program([b['default'].element("div", [], [], [b['default'].element("svg")])]));
  });

  var integrationPoints = ['foreignObject', 'desc', 'title'];
  function buildIntegrationPointTest(integrationPoint) {
    return function integrationPointTest() {
      var t = '<svg><' + integrationPoint + '><div></div></' + integrationPoint + '></svg>';
      astEqual(t, b['default'].program([b['default'].element("svg", [], [], [b['default'].element(integrationPoint, [], [], [b['default'].element("div")])])]));
    };
  }
  for (var i = 0, length = integrationPoints.length; i < length; i++) {
    test("svg content with html content inline for " + integrationPoints[i], buildIntegrationPointTest(integrationPoints[i]));
  }

  test("a piece of content with HTML", function () {
    var t = 'some <div>content</div> done';
    astEqual(t, b['default'].program([b['default'].text("some "), b['default'].element("div", [], [], [b['default'].text("content")]), b['default'].text(" done")]));
  });

  test("a piece of Handlebars with HTML", function () {
    var t = 'some <div>{{content}}</div> done';
    astEqual(t, b['default'].program([b['default'].text("some "), b['default'].element("div", [], [], [b['default'].mustache(b['default'].path('content'))]), b['default'].text(" done")]));
  });

  test("Handlebars embedded in an attribute (quoted)", function () {
    var t = 'some <div class="{{foo}}">content</div> done';
    astEqual(t, b['default'].program([b['default'].text("some "), b['default'].element("div", [b['default'].attr("class", b['default'].concat([b['default'].path('foo')]))], [], [b['default'].text("content")]), b['default'].text(" done")]));
  });

  test("Handlebars embedded in an attribute (unquoted)", function () {
    var t = 'some <div class={{foo}}>content</div> done';
    astEqual(t, b['default'].program([b['default'].text("some "), b['default'].element("div", [b['default'].attr("class", b['default'].mustache(b['default'].path('foo')))], [], [b['default'].text("content")]), b['default'].text(" done")]));
  });

  test("Handlebars embedded in an attribute (sexprs)", function () {
    var t = 'some <div class="{{foo (foo "abc")}}">content</div> done';
    astEqual(t, b['default'].program([b['default'].text("some "), b['default'].element("div", [b['default'].attr("class", b['default'].concat([b['default'].mustache(b['default'].path('foo'), [b['default'].sexpr(b['default'].path('foo'), [b['default'].string('abc')])])]))], [], [b['default'].text("content")]), b['default'].text(" done")]));
  });

  test("Handlebars embedded in an attribute with other content surrounding it", function () {
    var t = 'some <a href="http://{{link}}/">content</a> done';
    astEqual(t, b['default'].program([b['default'].text("some "), b['default'].element("a", [b['default'].attr("href", b['default'].concat([b['default'].string("http://"), b['default'].path('link'), b['default'].string("/")]))], [], [b['default'].text("content")]), b['default'].text(" done")]));
  });

  test("A more complete embedding example", function () {
    var t = "{{embed}} {{some 'content'}} " + "<div class='{{foo}} {{bind-class isEnabled truthy='enabled'}}'>{{ content }}</div>" + " {{more 'embed'}}";
    astEqual(t, b['default'].program([b['default'].mustache(b['default'].path('embed')), b['default'].text(' '), b['default'].mustache(b['default'].path('some'), [b['default'].string('content')]), b['default'].text(' '), b['default'].element("div", [b['default'].attr("class", b['default'].concat([b['default'].path('foo'), b['default'].string(' '), b['default'].mustache(b['default'].path('bind-class'), [b['default'].path('isEnabled')], b['default'].hash([b['default'].pair('truthy', b['default'].string('enabled'))]))]))], [], [b['default'].mustache(b['default'].path('content'))]), b['default'].text(' '), b['default'].mustache(b['default'].path('more'), [b['default'].string('embed')])]));
  });

  test("Simple embedded block helpers", function () {
    var t = "{{#if foo}}<div>{{content}}</div>{{/if}}";
    astEqual(t, b['default'].program([b['default'].block(b['default'].path('if'), [b['default'].path('foo')], b['default'].hash(), b['default'].program([b['default'].element('div', [], [], [b['default'].mustache(b['default'].path('content'))])]))]));
  });

  test("Involved block helper", function () {
    var t = '<p>hi</p> content {{#testing shouldRender}}<p>Appears!</p>{{/testing}} more <em>content</em> here';
    astEqual(t, b['default'].program([b['default'].element('p', [], [], [b['default'].text('hi')]), b['default'].text(' content '), b['default'].block(b['default'].path('testing'), [b['default'].path('shouldRender')], b['default'].hash(), b['default'].program([b['default'].element('p', [], [], [b['default'].text('Appears!')])])), b['default'].text(' more '), b['default'].element('em', [], [], [b['default'].text('content')]), b['default'].text(' here')]));
  });

  test("Element modifiers", function () {
    var t = "<p {{action 'boom'}} class='bar'>Some content</p>";
    astEqual(t, b['default'].program([b['default'].element('p', [b['default'].attr('class', b['default'].text('bar'))], [b['default'].elementModifier(b['default'].path('action'), [b['default'].string('boom')])], [b['default'].text('Some content')])]));
  });

  test("Tokenizer: MustacheStatement encountered in tagName state", function () {
    var t = "<input{{bar}}>";
    astEqual(t, b['default'].program([b['default'].element('input', [], [b['default'].elementModifier(b['default'].path('bar'))])]));
  });

  test("Tokenizer: MustacheStatement encountered in beforeAttributeName state", function () {
    var t = "<input {{bar}}>";
    astEqual(t, b['default'].program([b['default'].element('input', [], [b['default'].elementModifier(b['default'].path('bar'))])]));
  });

  test("Tokenizer: MustacheStatement encountered in attributeName state", function () {
    var t = "<input foo{{bar}}>";
    astEqual(t, b['default'].program([b['default'].element('input', [b['default'].attr('foo', b['default'].text(''))], [b['default'].elementModifier(b['default'].path('bar'))])]));
  });

  test("Tokenizer: MustacheStatement encountered in afterAttributeName state", function () {
    var t = "<input foo {{bar}}>";
    astEqual(t, b['default'].program([b['default'].element('input', [b['default'].attr('foo', b['default'].text(''))], [b['default'].elementModifier(b['default'].path('bar'))])]));
  });

  test("Tokenizer: MustacheStatement encountered in afterAttributeValue state", function () {
    var t = "<input foo=1 {{bar}}>";
    astEqual(t, b['default'].program([b['default'].element('input', [b['default'].attr('foo', b['default'].text('1'))], [b['default'].elementModifier(b['default'].path('bar'))])]));
  });

  test("Tokenizer: MustacheStatement encountered in afterAttributeValueQuoted state", function () {
    var t = "<input foo='1'{{bar}}>";
    astEqual(t, b['default'].program([b['default'].element('input', [b['default'].attr('foo', b['default'].text('1'))], [b['default'].elementModifier(b['default'].path('bar'))])]));
  });

  test("Stripping - mustaches", function () {
    var t = "foo {{~content}} bar";
    astEqual(t, b['default'].program([b['default'].text('foo'), b['default'].mustache(b['default'].path('content')), b['default'].text(' bar')]));

    t = "foo {{content~}} bar";
    astEqual(t, b['default'].program([b['default'].text('foo '), b['default'].mustache(b['default'].path('content')), b['default'].text('bar')]));
  });

  test("Stripping - blocks", function () {
    var t = "foo {{~#wat}}{{/wat}} bar";
    astEqual(t, b['default'].program([b['default'].text('foo'), b['default'].block(b['default'].path('wat'), [], b['default'].hash(), b['default'].program()), b['default'].text(' bar')]));

    t = "foo {{#wat}}{{/wat~}} bar";
    astEqual(t, b['default'].program([b['default'].text('foo '), b['default'].block(b['default'].path('wat'), [], b['default'].hash(), b['default'].program()), b['default'].text('bar')]));
  });

  test("Stripping - programs", function () {
    var t = "{{#wat~}} foo {{else}}{{/wat}}";
    astEqual(t, b['default'].program([b['default'].block(b['default'].path('wat'), [], b['default'].hash(), b['default'].program([b['default'].text('foo ')]), b['default'].program())]));

    t = "{{#wat}} foo {{~else}}{{/wat}}";
    astEqual(t, b['default'].program([b['default'].block(b['default'].path('wat'), [], b['default'].hash(), b['default'].program([b['default'].text(' foo')]), b['default'].program())]));

    t = "{{#wat}}{{else~}} foo {{/wat}}";
    astEqual(t, b['default'].program([b['default'].block(b['default'].path('wat'), [], b['default'].hash(), b['default'].program(), b['default'].program([b['default'].text('foo ')]))]));

    t = "{{#wat}}{{else}} foo {{~/wat}}";
    astEqual(t, b['default'].program([b['default'].block(b['default'].path('wat'), [], b['default'].hash(), b['default'].program(), b['default'].program([b['default'].text(' foo')]))]));
  });

  test("Stripping - removes unnecessary text nodes", function () {
    var t = "{{#each~}}\n  <li> foo </li>\n{{~/each}}";
    astEqual(t, b['default'].program([b['default'].block(b['default'].path('each'), [], b['default'].hash(), b['default'].program([b['default'].element('li', [], [], [b['default'].text(' foo ')])]))]));
  });

  // TODO: Make these throw an error.
  //test("Awkward mustache in unquoted attribute value", function() {
  //  var t = "<div class=a{{foo}}></div>";
  //  astEqual(t, b.program([
  //    b.element('div', [ b.attr('class', concat([b.string("a"), b.sexpr([b.path('foo')])])) ])
  //  ]));
  //
  //  t = "<div class=a{{foo}}b></div>";
  //  astEqual(t, b.program([
  //    b.element('div', [ b.attr('class', concat([b.string("a"), b.sexpr([b.path('foo')]), b.string("b")])) ])
  //  ]));
  //
  //  t = "<div class={{foo}}b></div>";
  //  astEqual(t, b.program([
  //    b.element('div', [ b.attr('class', concat([b.sexpr([b.path('foo')]), b.string("b")])) ])
  //  ]));
  //});

  test("Components", function () {
    var t = "<x-foo a=b c='d' e={{f}} id='{{bar}}' class='foo-{{bar}}'>{{a}}{{b}}c{{d}}</x-foo>{{e}}";
    astEqual(t, b['default'].program([b['default'].component('x-foo', [b['default'].attr('a', b['default'].text('b')), b['default'].attr('c', b['default'].text('d')), b['default'].attr('e', b['default'].mustache(b['default'].path('f'))), b['default'].attr('id', b['default'].concat([b['default'].path('bar')])), b['default'].attr('class', b['default'].concat([b['default'].string('foo-'), b['default'].path('bar')]))], b['default'].program([b['default'].mustache(b['default'].path('a')), b['default'].mustache(b['default'].path('b')), b['default'].text('c'), b['default'].mustache(b['default'].path('d'))])), b['default'].mustache(b['default'].path('e'))]));
  });

  test("Components with disableComponentGeneration", function () {
    var t = "begin <x-foo>content</x-foo> finish";
    var actual = parser.preprocess(t, {
      disableComponentGeneration: true
    });

    astEqual(actual, b['default'].program([b['default'].text("begin "), b['default'].element("x-foo", [], [], [b['default'].text("content")]), b['default'].text(" finish")]));
  });

  test("Components with disableComponentGeneration === false", function () {
    var t = "begin <x-foo>content</x-foo> finish";
    var actual = parser.preprocess(t, {
      disableComponentGeneration: false
    });

    astEqual(actual, b['default'].program([b['default'].text("begin "), b['default'].component("x-foo", [], b['default'].program([b['default'].text("content")])), b['default'].text(" finish")]));
  });

  test("an HTML comment", function () {
    var t = 'before <!-- some comment --> after';
    astEqual(t, b['default'].program([b['default'].text("before "), b['default'].comment(" some comment "), b['default'].text(" after")]));
  });

  test("allow {{null}} to be passed as helper name", function () {
    var ast = parser.preprocess(base.parse("{{null}}"));

    astEqual(ast, b['default'].program([b['default'].mustache(b['default'].null())]));
  });

  test("allow {{null}} to be passed as a param", function () {
    var ast = parser.preprocess(base.parse("{{foo null}}"));

    astEqual(ast, b['default'].program([b['default'].mustache(b['default'].path('foo'), [b['default'].null()])]));
  });

  test("allow {{undefined}} to be passed as helper name", function () {
    var ast = parser.preprocess(base.parse("{{undefined}}"));

    astEqual(ast, b['default'].program([b['default'].mustache(b['default'].undefined())]));
  });

  test("allow {{undefined}} to be passed as a param", function () {
    var ast = parser.preprocess(base.parse("{{foo undefined}}"));

    astEqual(ast, b['default'].program([b['default'].mustache(b['default'].path('foo'), [b['default'].undefined()])]));
  });

});
define('htmlbars-syntax-tests/parser-node-test.jshint', function () {

  'use strict';

  QUnit.module('JSHint - htmlbars-syntax-tests');
  QUnit.test('htmlbars-syntax-tests/parser-node-test.js should pass jshint', function (assert) {
    assert.ok(true, 'htmlbars-syntax-tests/parser-node-test.js should pass jshint.');
  });

});
define('htmlbars-syntax-tests/plugin-node-test', ['../htmlbars-syntax/walker', '../htmlbars-syntax/parser'], function (Walker, parser) {

  'use strict';

  QUnit.module('Compiler plugins: AST');

  test('AST plugins can be provided to the compiler', function () {
    expect(1);

    function Plugin() {}
    Plugin.prototype.transform = function () {
      ok(true, 'transform was called!');
    };

    parser.preprocess('<div></div>', {
      plugins: {
        ast: [Plugin]
      }
    });
  });

  test('provides syntax package as `syntax` prop if value is null', function () {
    expect(1);

    function Plugin() {}
    Plugin.prototype.transform = function () {
      equal(this.syntax.Walker, Walker['default']);
    };

    parser.preprocess('<div></div>', {
      plugins: {
        ast: [Plugin]
      }
    });
  });

  test('AST plugins can modify the AST', function () {
    expect(1);

    var expected = "OOOPS, MESSED THAT UP!";

    function Plugin() {}
    Plugin.prototype.transform = function () {
      return expected;
    };

    var ast = parser.preprocess('<div></div>', {
      plugins: {
        ast: [Plugin]
      }
    });

    equal(ast, expected, 'return value from AST transform is used');
  });

  test('AST plugins can be chained', function () {
    expect(2);

    var expected = "OOOPS, MESSED THAT UP!";

    function Plugin() {}
    Plugin.prototype.transform = function () {
      return expected;
    };

    function SecondaryPlugin() {}
    SecondaryPlugin.prototype.transform = function (ast) {
      equal(ast, expected, 'return value from AST transform is used');

      return 'BOOM!';
    };

    var ast = parser.preprocess('<div></div>', {
      plugins: {
        ast: [Plugin, SecondaryPlugin]
      }
    });

    equal(ast, 'BOOM!', 'return value from last AST transform is used');
  });

});
define('htmlbars-syntax-tests/plugin-node-test.jshint', function () {

  'use strict';

  QUnit.module('JSHint - htmlbars-syntax-tests');
  QUnit.test('htmlbars-syntax-tests/plugin-node-test.js should pass jshint', function (assert) {
    assert.ok(true, 'htmlbars-syntax-tests/plugin-node-test.js should pass jshint.');
  });

});
define('htmlbars-syntax-tests/walker-node-test', ['../htmlbars-syntax/parser', '../htmlbars-syntax/walker'], function (parser, Walker) {

  'use strict';

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

});
define('htmlbars-syntax-tests/walker-node-test.jshint', function () {

  'use strict';

  QUnit.module('JSHint - htmlbars-syntax-tests');
  QUnit.test('htmlbars-syntax-tests/walker-node-test.js should pass jshint', function (assert) {
    assert.ok(true, 'htmlbars-syntax-tests/walker-node-test.js should pass jshint.');
  });

});