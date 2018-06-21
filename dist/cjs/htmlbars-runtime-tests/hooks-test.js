'use strict';

var htmlbars_runtime = require('../htmlbars-runtime');
var object_utils = require('../htmlbars-util/object-utils');
var compiler = require('../htmlbars-compiler/compiler');
var htmlbars_test_helpers = require('../htmlbars-test-helpers');
var DOMHelper = require('../dom-helper');

var hooks, helpers, partials, env;

function registerHelper(name, callback) {
  helpers[name] = callback;
}

function commonSetup() {
  hooks = object_utils.merge({}, htmlbars_runtime.hooks);
  hooks.keywords = object_utils.merge({}, htmlbars_runtime.hooks.keywords);
  helpers = {};
  partials = {};

  env = {
    dom: new DOMHelper['default'](),
    hooks: hooks,
    helpers: helpers,
    partials: partials,
    useFragmentCache: true
  };
}

QUnit.module("htmlbars-runtime: hooks", {
  beforeEach: commonSetup
});

test("inline hook correctly handles false-like values", function () {

  registerHelper('get', function (params) {
    return params[0];
  });

  var object = { val: 'hello' };
  var template = compiler.compile('<div>{{get val}}</div>');
  var result = template.render(object, env);

  htmlbars_test_helpers.equalTokens(result.fragment, '<div>hello</div>');

  object.val = '';

  result.rerender();

  htmlbars_test_helpers.equalTokens(result.fragment, '<div></div>');
});

test("inline hook correctly handles false-like values", function () {

  registerHelper('get', function (params) {
    return params[0];
  });

  var object = { val: 'hello' };
  var template = compiler.compile('<div>{{get val}}</div>');
  var result = template.render(object, env);

  htmlbars_test_helpers.equalTokens(result.fragment, '<div>hello</div>');

  object.val = '';

  result.rerender();

  htmlbars_test_helpers.equalTokens(result.fragment, '<div></div>');
});