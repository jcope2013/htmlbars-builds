'use strict';

var htmlbars_syntax = require('../htmlbars-syntax');

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