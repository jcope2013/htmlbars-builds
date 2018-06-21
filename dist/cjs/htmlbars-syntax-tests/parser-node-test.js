'use strict';

var base = require('../htmlbars-syntax/handlebars/compiler/base');
var parser = require('../htmlbars-syntax/parser');
var b = require('../htmlbars-syntax/builders');

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