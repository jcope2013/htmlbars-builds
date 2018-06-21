define('htmlbars-runtime-tests/hooks-test', ['../htmlbars-runtime', '../htmlbars-util/object-utils', '../htmlbars-compiler/compiler', '../htmlbars-test-helpers', '../dom-helper'], function (htmlbars_runtime, object_utils, compiler, htmlbars_test_helpers, DOMHelper) {

  'use strict';

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

});
define('htmlbars-runtime-tests/hooks-test.jshint', function () {

  'use strict';

  QUnit.module('JSHint - htmlbars-runtime-tests');
  QUnit.test('htmlbars-runtime-tests/hooks-test.js should pass jshint', function (assert) {
    assert.ok(true, 'htmlbars-runtime-tests/hooks-test.js should pass jshint.');
  });

});
define('htmlbars-runtime-tests/hooks', ['../htmlbars-runtime', '../htmlbars-util/object-utils', '../htmlbars-compiler/compiler', '../htmlbars-test-helpers', '../dom-helper'], function (htmlbars_runtime, object_utils, compiler, htmlbars_test_helpers, DOMHelper) {

  'use strict';

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

  test("subexr hook correctly handles false-like values", function () {
    registerHelper('if', function (params) {
      return params[0] ? params[1] : params[2];
    });

    var object = { val: true };
    var template = compiler.compile('<div data-foo={{if val "stuff" ""}}></div>');
    var result = template.render(object, env);

    htmlbars_test_helpers.equalTokens(result.fragment, '<div data-foo="stuff"></div>');

    object.val = false;

    result.rerender();

    htmlbars_test_helpers.equalTokens(result.fragment, '<div data-foo=""></div>');
  });

});
define('htmlbars-runtime-tests/hooks.jshint', function () {

  'use strict';

  QUnit.module('JSHint - htmlbars-runtime-tests');
  QUnit.test('htmlbars-runtime-tests/hooks.js should pass jshint', function (assert) {
    assert.ok(true, 'htmlbars-runtime-tests/hooks.js should pass jshint.');
  });

});
define('htmlbars-runtime-tests/htmlbars-runtime.jshint', function () {

  'use strict';

  QUnit.module('JSHint - htmlbars-runtime-tests');
  QUnit.test('htmlbars-runtime-tests/htmlbars-runtime.js should pass jshint', function (assert) {
    assert.ok(true, 'htmlbars-runtime-tests/htmlbars-runtime.js should pass jshint.');
  });

});
define('htmlbars-runtime-tests/htmlbars-runtime/expression-visitor.jshint', function () {

  'use strict';

  QUnit.module('JSHint - htmlbars-runtime-tests/htmlbars-runtime');
  QUnit.test('htmlbars-runtime-tests/htmlbars-runtime/expression-visitor.js should pass jshint', function (assert) {
    assert.ok(true, 'htmlbars-runtime-tests/htmlbars-runtime/expression-visitor.js should pass jshint.');
  });

});
define('htmlbars-runtime-tests/htmlbars-runtime/hooks.jshint', function () {

  'use strict';

  QUnit.module('JSHint - htmlbars-runtime-tests/htmlbars-runtime');
  QUnit.test('htmlbars-runtime-tests/htmlbars-runtime/hooks.js should pass jshint', function (assert) {
    assert.ok(true, 'htmlbars-runtime-tests/htmlbars-runtime/hooks.js should pass jshint.');
  });

});
define('htmlbars-runtime-tests/htmlbars-runtime/morph.jshint', function () {

  'use strict';

  QUnit.module('JSHint - htmlbars-runtime-tests/htmlbars-runtime');
  QUnit.test('htmlbars-runtime-tests/htmlbars-runtime/morph.js should pass jshint', function (assert) {
    assert.ok(true, 'htmlbars-runtime-tests/htmlbars-runtime/morph.js should pass jshint.');
  });

});
define('htmlbars-runtime-tests/htmlbars-runtime/render.jshint', function () {

  'use strict';

  QUnit.module('JSHint - htmlbars-runtime-tests/htmlbars-runtime');
  QUnit.test('htmlbars-runtime-tests/htmlbars-runtime/render.js should pass jshint', function (assert) {
    assert.ok(true, 'htmlbars-runtime-tests/htmlbars-runtime/render.js should pass jshint.');
  });

});
define('htmlbars-runtime-tests/main-test', ['../htmlbars-runtime', '../htmlbars-runtime/render', '../htmlbars-compiler/compiler', '../htmlbars-runtime/hooks', '../htmlbars-test-helpers', '../htmlbars-util/template-utils', '../dom-helper'], function (htmlbars_runtime, render, compiler, hooks, htmlbars_test_helpers, template_utils, DOMHelper) {

  'use strict';

  /*globals SVGElement, SVGLinearGradientElement */
  var env = undefined;

  QUnit.module("htmlbars-runtime", {
    setup: function () {
      env = {
        dom: new DOMHelper['default'](),
        hooks: htmlbars_runtime.hooks,
        helpers: {},
        partials: {},
        useFragmentCache: true
      };
    }
  });

  function keys(obj) {
    var ownKeys = [];
    for (var key in obj) {
      if (obj.hasOwnProperty(key)) {
        ownKeys.push(key);
      }
    }
    return ownKeys;
  }

  test("hooks are present", function () {
    var hookNames = ["keywords", "linkRenderNode", "createScope", "classify", "createFreshScope", "createChildScope", "bindShadowScope", "bindScope", "bindSelf", "bindLocal", "bindBlock", "updateScope", "updateSelf", "updateLocal", "lookupHelper", "hasHelper", "invokeHelper", "range", "block", "inline", "keyword", "partial", "component", "element", "attribute", "subexpr", "concat", "get", "getRoot", "getChild", "getValue", "cleanupRenderNode", "destroyRenderNode", "willCleanupTree", "didCleanupTree", "getCellOrValue", "didRenderNode", "willRenderNode"];

    for (var i = 0; i < hookNames.length; i++) {
      var hook = htmlbars_runtime.hooks[hookNames[i]];
      ok(hook !== undefined, "hook " + hookNames[i] + " is present");
    }

    equal(keys(htmlbars_runtime.hooks).length, hookNames.length, "Hooks length match");
  });

  test("manualElement function honors namespaces", function () {
    htmlbars_runtime.hooks.keywords['manual-element'] = {
      render: function (morph, env, scope, params, hash, template, inverse, visitor) {
        var attributes = {
          version: '1.1'
        };

        var layout = render.manualElement('svg', attributes);

        hooks.hostBlock(morph, env, scope, template, inverse, null, visitor, function (options) {
          options.templates.template.yieldIn({ raw: layout }, hash);
        });

        render.manualElement(env, scope, 'span', attributes, morph);
      },

      isStable: function () {
        return true;
      }
    };

    var template = compiler.compile('{{#manual-element}}<linearGradient><stop offset="{{startOffset}}"></stop><stop offset="{{stopOffset}}"></stop></linearGradient>{{/manual-element}}');
    var result = template.render({ startOffset: 0.1, stopOffset: 0.6 }, env);
    ok(result.fragment.childNodes[1] instanceof SVGElement);
    ok(result.fragment.childNodes[1].childNodes[0] instanceof SVGLinearGradientElement);
    htmlbars_test_helpers.equalTokens(result.fragment, '<svg version="1.1"><linearGradient><stop offset="0.1"></stop><stop offset="0.6"></stop></linearGradient></svg>');
  });

  test("manualElement function honors void elements", function () {
    var attributes = {
      class: 'foo-bar'
    };
    var layout = render.manualElement('input', attributes);
    var fragment = layout.buildFragment(new DOMHelper['default']());

    equal(fragment.childNodes.length, 1, 'includes a single element');
    equal(fragment.childNodes[0].childNodes.length, 0, 'no child nodes were added to `<input>` because it is a void tag');
    htmlbars_test_helpers.equalTokens(fragment, '<input class="foo-bar">');
  });

  test("attachAttributes function attaches attributes to an existing element", function () {
    var attributes = {
      class: 'foo-bar',
      other: ['get', 'other']
    };

    var element = document.createElement('div');
    var raw = render.attachAttributes(attributes);
    raw.element = element;

    var template = hooks.wrap(raw);

    var self = { other: "first" };
    var result = template.render(self, env);

    equal(element.getAttribute('class'), "foo-bar", "the attribute was assigned");
    equal(element.getAttribute('other'), "first", "the attribute was assigned");

    self.other = "second";
    result.rerender();

    equal(element.getAttribute('class'), "foo-bar", "the attribute was assigned");
    equal(element.getAttribute('other'), "second", "the attribute was assigned");
  });

  test("the 'attributes' statement attaches an attributes template to a parent", function () {
    env.hooks.attributes = function (morph, env, scope, template, fragment, visitor) {
      var block = morph.state.block;

      if (!block) {
        var element = fragment.firstChild;
        template.element = element;
        block = morph.state.block = template_utils.blockFor(render['default'], template, { scope: scope });
      }

      block(env, [], undefined, morph, undefined, visitor);
    };

    var cleanedUpNodes = [];
    env.hooks.cleanupRenderNode = function (node) {
      cleanedUpNodes.push(node);
    };

    var attributes = {
      class: 'foo-bar',
      other: ['get', 'other']
    };

    var template = compiler.compile("<div>hello</div>");

    var self = { other: "first" };
    var result = template.render(self, env, { attributes: attributes });
    var attributesMorph = result.nodes[result.nodes.length - 1];

    htmlbars_test_helpers.equalTokens(result.fragment, "<div class='foo-bar' other='first'>hello</div>");

    self.other = "second";
    result.rerender();

    htmlbars_test_helpers.equalTokens(result.fragment, "<div class='foo-bar' other='second'>hello</div>");

    var expected = [result.root, attributesMorph, attributesMorph.childNodes[0]];
    template_utils.clearMorph(result.root, env, true);

    deepEqual(cleanedUpNodes, expected);
  });

});
define('htmlbars-runtime-tests/main-test.jshint', function () {

  'use strict';

  QUnit.module('JSHint - htmlbars-runtime-tests');
  QUnit.test('htmlbars-runtime-tests/main-test.js should pass jshint', function (assert) {
    assert.ok(true, 'htmlbars-runtime-tests/main-test.js should pass jshint.');
  });

});