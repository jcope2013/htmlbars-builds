'use strict';

var compiler = require('../htmlbars-compiler/compiler');
var render = require('../htmlbars-runtime/render');
var defaultHooks = require('../htmlbars-runtime/hooks');
var template_utils = require('../htmlbars-util/template-utils');
var object_utils = require('../htmlbars-util/object-utils');
var DOMHelper = require('../dom-helper');
var htmlbars_test_helpers = require('../htmlbars-test-helpers');

var hooks, helpers, partials, env;

function registerHelper(name, callback) {
  helpers[name] = callback;
}

function commonSetup() {
  hooks = object_utils.merge({}, defaultHooks['default']);
  hooks.keywords = object_utils.merge({}, defaultHooks['default'].keywords);
  helpers = {};
  partials = {};

  env = {
    dom: new DOMHelper['default'](),
    hooks: hooks,
    helpers: helpers,
    partials: partials,
    useFragmentCache: true
  };

  registerHelper('if', function (params, hash, options) {
    if (!!params[0]) {
      return options.template.yield();
    } else if (options.inverse.yield) {
      return options.inverse.yield();
    }
  });

  registerHelper('each', function (params) {
    var list = params[0];

    for (var i = 0, l = list.length; i < l; i++) {
      var item = list[i];
      if (this.arity > 0) {
        this.yieldItem(item.key, [item]);
      } else {
        this.yieldItem(item.key, undefined, item);
      }
    }
  });
}

QUnit.module("HTML-based compiler (dirtying)", {
  beforeEach: commonSetup
});

test("a simple implementation of a dirtying rerender", function () {
  var object = { condition: true, value: 'hello world' };
  var template = compiler.compile('<div>{{#if condition}}<p>{{value}}</p>{{else}}<p>Nothing</p>{{/if}}</div>');
  var result = template.render(object, env);
  var valueNode = result.fragment.firstChild.firstChild.firstChild;

  htmlbars_test_helpers.equalTokens(result.fragment, '<div><p>hello world</p></div>', "Initial render");

  result.rerender();

  htmlbars_test_helpers.equalTokens(result.fragment, '<div><p>hello world</p></div>', "After dirtying but not updating");
  strictEqual(result.fragment.firstChild.firstChild.firstChild, valueNode, "The text node was not blown away");

  // Even though the #if was stable, a dirty child node is updated
  object.value = 'goodbye world';
  result.rerender();
  htmlbars_test_helpers.equalTokens(result.fragment, '<div><p>goodbye world</p></div>', "After updating and dirtying");
  strictEqual(result.fragment.firstChild.firstChild.firstChild, valueNode, "The text node was not blown away");

  // Should not update since render node is not marked as dirty
  object.condition = false;
  result.revalidate();
  htmlbars_test_helpers.equalTokens(result.fragment, '<div><p>goodbye world</p></div>', "After flipping the condition but not dirtying");
  strictEqual(result.fragment.firstChild.firstChild.firstChild, valueNode, "The text node was not blown away");

  result.rerender();
  htmlbars_test_helpers.equalTokens(result.fragment, '<div><p>Nothing</p></div>', "And then dirtying");
  QUnit.notStrictEqual(result.fragment.firstChild.firstChild.firstChild, valueNode, "The text node was not blown away");
});

test("a simple implementation of a dirtying rerender without inverse", function () {
  var object = { condition: true, value: 'hello world' };
  var template = compiler.compile('<div>{{#if condition}}<p>{{value}}</p>{{/if}}</div>');
  var result = template.render(object, env);

  htmlbars_test_helpers.equalTokens(result.fragment, '<div><p>hello world</p></div>', "Initial render");

  // Should not update since render node is not marked as dirty
  object.condition = false;

  result.rerender();
  htmlbars_test_helpers.equalTokens(result.fragment, '<div><!----></div>', "If the condition is false, the morph becomes empty");

  object.condition = true;

  result.rerender();
  htmlbars_test_helpers.equalTokens(result.fragment, '<div><p>hello world</p></div>', "If the condition is false, the morph becomes empty");
});

test("a dirtying rerender using `yieldIn`", function () {
  var component = compiler.compile("<p>{{yield}}</p>");
  var template = compiler.compile("<div><simple-component>{{title}}</simple-component></div>");

  registerHelper("simple-component", function () {
    return this.yieldIn(component);
  });

  var object = { title: "Hello world" };
  var result = template.render(object, env);

  var valueNode = getValueNode();
  htmlbars_test_helpers.equalTokens(result.fragment, '<div><p>Hello world</p></div>');

  result.rerender();

  htmlbars_test_helpers.equalTokens(result.fragment, '<div><p>Hello world</p></div>');
  strictEqual(getValueNode(), valueNode);

  object.title = "Goodbye world";

  result.rerender();
  htmlbars_test_helpers.equalTokens(result.fragment, '<div><p>Goodbye world</p></div>');
  strictEqual(getValueNode(), valueNode);

  function getValueNode() {
    return result.fragment.firstChild.firstChild.firstChild;
  }
});

test("a dirtying rerender using `yieldIn` and self", function () {
  var component = compiler.compile("<p><span>{{attrs.name}}</span>{{yield}}</p>");
  var template = compiler.compile("<div><simple-component name='Yo! '>{{title}}</simple-component></div>");

  registerHelper("simple-component", function (params, hash) {
    return this.yieldIn(component, { attrs: hash });
  });

  var object = { title: "Hello world" };
  var result = template.render(object, env);

  var nameNode = getNameNode();
  var titleNode = getTitleNode();
  htmlbars_test_helpers.equalTokens(result.fragment, '<div><p><span>Yo! </span>Hello world</p></div>');

  rerender();
  htmlbars_test_helpers.equalTokens(result.fragment, '<div><p><span>Yo! </span>Hello world</p></div>');
  assertStableNodes();

  object.title = "Goodbye world";

  rerender();
  htmlbars_test_helpers.equalTokens(result.fragment, '<div><p><span>Yo! </span>Goodbye world</p></div>');
  assertStableNodes();

  function rerender() {
    result.rerender();
  }

  function assertStableNodes() {
    strictEqual(getNameNode(), nameNode);
    strictEqual(getTitleNode(), titleNode);
  }

  function getNameNode() {
    return result.fragment.firstChild.firstChild.firstChild.firstChild;
  }

  function getTitleNode() {
    return result.fragment.firstChild.firstChild.firstChild.nextSibling;
  }
});

test("a dirtying rerender using `yieldIn`, self and block args", function () {
  var component = compiler.compile("<p>{{yield attrs.name}}</p>");
  var template = compiler.compile("<div><simple-component name='Yo! ' as |key|><span>{{key}}</span>{{title}}</simple-component></div>");

  registerHelper("simple-component", function (params, hash) {
    return this.yieldIn(component, { attrs: hash });
  });

  var object = { title: "Hello world" };
  var result = template.render(object, env);

  var nameNode = getNameNode();
  var titleNode = getTitleNode();
  htmlbars_test_helpers.equalTokens(result.fragment, '<div><p><span>Yo! </span>Hello world</p></div>');

  rerender();
  htmlbars_test_helpers.equalTokens(result.fragment, '<div><p><span>Yo! </span>Hello world</p></div>');
  assertStableNodes();

  object.title = "Goodbye world";

  rerender();
  htmlbars_test_helpers.equalTokens(result.fragment, '<div><p><span>Yo! </span>Goodbye world</p></div>');
  assertStableNodes();

  function rerender() {
    result.rerender();
  }

  function assertStableNodes() {
    strictEqual(getNameNode(), nameNode);
    strictEqual(getTitleNode(), titleNode);
  }

  function getNameNode() {
    return result.fragment.firstChild.firstChild.firstChild.firstChild;
  }

  function getTitleNode() {
    return result.fragment.firstChild.firstChild.firstChild.nextSibling;
  }
});

test("block helpers whose template has a morph at the edge", function () {
  registerHelper('id', function (params, hash, options) {
    return options.template.yield();
  });

  var template = compiler.compile("{{#id}}{{value}}{{/id}}");
  var object = { value: "hello world" };
  var result = template.render(object, env);

  htmlbars_test_helpers.equalTokens(result.fragment, 'hello world');
  var firstNode = result.root.firstNode;
  equal(firstNode.nodeType, 3, "first node of the parent template");
  equal(firstNode.nodeValue, "", "its content should be empty");

  var secondNode = firstNode.nextSibling;
  equal(secondNode.nodeType, 3, "first node of the helper template should be a text node");
  equal(secondNode.nodeValue, "", "its content should be empty");

  var textContent = secondNode.nextSibling;
  equal(textContent.nodeType, 3, "second node of the helper should be a text node");
  equal(textContent.nodeValue, "hello world", "its content should be hello world");

  var fourthNode = textContent.nextSibling;
  equal(fourthNode.nodeType, 3, "last node of the helper should be a text node");
  equal(fourthNode.nodeValue, "", "its content should be empty");

  var lastNode = fourthNode.nextSibling;
  equal(lastNode.nodeType, 3, "last node of the parent template should be a text node");
  equal(lastNode.nodeValue, "", "its content should be empty");

  strictEqual(lastNode.nextSibling, null, "there should only be five nodes");
});

test("clean content doesn't get blown away", function () {
  var template = compiler.compile("<div>{{value}}</div>");
  var object = { value: "hello" };
  var result = template.render(object, env);

  var textNode = result.fragment.firstChild.firstChild;
  equal(textNode.nodeValue, "hello");

  object.value = "goodbye";
  result.revalidate(); // without setting the node to dirty

  htmlbars_test_helpers.equalTokens(result.fragment, '<div>hello</div>');

  var textRenderNode = result.root.childNodes[0];

  textRenderNode.setContent = function () {
    ok(false, "Should not get called");
  };

  object.value = "hello";
  result.rerender();
});

test("helper calls follow the normal dirtying rules", function () {
  registerHelper('capitalize', function (params) {
    return params[0].toUpperCase();
  });

  var template = compiler.compile("<div>{{capitalize value}}</div>");
  var object = { value: "hello" };
  var result = template.render(object, env);

  var textNode = result.fragment.firstChild.firstChild;
  equal(textNode.nodeValue, "HELLO");

  object.value = "goodbye";
  result.revalidate(); // without setting the node to dirty

  htmlbars_test_helpers.equalTokens(result.fragment, '<div>HELLO</div>');

  var textRenderNode = result.root.childNodes[0];

  result.rerender();

  htmlbars_test_helpers.equalTokens(result.fragment, '<div>GOODBYE</div>');

  textRenderNode.setContent = function () {
    ok(false, "Should not get called");
  };

  // Checks normalized value, not raw value
  object.value = "GoOdByE";
  result.rerender();
});

test("attribute nodes follow the normal dirtying rules", function () {
  var template = compiler.compile("<div class={{value}}>hello</div>");
  var object = { value: "world" };

  var result = template.render(object, env);

  htmlbars_test_helpers.equalTokens(result.fragment, "<div class='world'>hello</div>", "Initial render");

  object.value = "universe";
  result.revalidate(); // without setting the node to dirty

  htmlbars_test_helpers.equalTokens(result.fragment, "<div class='world'>hello</div>", "Revalidating without dirtying");

  var attrRenderNode = result.root.childNodes[0];

  result.rerender();

  htmlbars_test_helpers.equalTokens(result.fragment, "<div class='universe'>hello</div>", "Revalidating after dirtying");

  attrRenderNode.setContent = function () {
    ok(false, "Should not get called");
  };

  object.value = "universe";
  result.rerender();
});

test("attribute nodes w/ concat follow the normal dirtying rules", function () {
  var template = compiler.compile("<div class='hello {{value}}'>hello</div>");
  var object = { value: "world" };
  var result = template.render(object, env);

  htmlbars_test_helpers.equalTokens(result.fragment, "<div class='hello world'>hello</div>");

  object.value = "universe";
  result.revalidate(); // without setting the node to dirty

  htmlbars_test_helpers.equalTokens(result.fragment, "<div class='hello world'>hello</div>");

  var attrRenderNode = result.root.childNodes[0];

  result.rerender();

  htmlbars_test_helpers.equalTokens(result.fragment, "<div class='hello universe'>hello</div>");

  attrRenderNode.setContent = function () {
    ok(false, "Should not get called");
  };

  object.value = "universe";
  result.rerender();
});

testEachHelper("An implementation of #each using block params", "<ul>{{#each list as |item|}}<li class={{item.class}}>{{item.name}}</li>{{/each}}</ul>");

testEachHelper("An implementation of #each using a self binding", "<ul>{{#each list}}<li class={{class}}>{{name}}</li>{{/each}}</ul>");

function testEachHelper(testName, templateSource) {
  test(testName, function () {
    var template = compiler.compile(templateSource);
    var object = { list: [{ key: "1", name: "Tom Dale", "class": "tomdale" }, { key: "2", name: "Yehuda Katz", "class": "wycats" }] };
    var result = template.render(object, env);

    var itemNode = getItemNode('tomdale');
    var nameNode = getNameNode('tomdale');

    htmlbars_test_helpers.equalTokens(result.fragment, "<ul><li class='tomdale'>Tom Dale</li><li class='wycats'>Yehuda Katz</li></ul>", "Initial render");

    rerender();
    assertStableNodes('tomdale', "after no-op rerender");
    htmlbars_test_helpers.equalTokens(result.fragment, "<ul><li class='tomdale'>Tom Dale</li><li class='wycats'>Yehuda Katz</li></ul>", "After no-op re-render");

    result.revalidate();
    assertStableNodes('tomdale', "after non-dirty rerender");
    htmlbars_test_helpers.equalTokens(result.fragment, "<ul><li class='tomdale'>Tom Dale</li><li class='wycats'>Yehuda Katz</li></ul>", "After no-op re-render");

    object = { list: [object.list[1], object.list[0]] };
    rerender(object);
    assertStableNodes('tomdale', "after changing the list order");
    htmlbars_test_helpers.equalTokens(result.fragment, "<ul><li class='wycats'>Yehuda Katz</li><li class='tomdale'>Tom Dale</li></ul>", "After changing the list order");

    object = { list: [{ key: "1", name: "Martin Muñoz", "class": "mmun" }, { key: "2", name: "Kris Selden", "class": "krisselden" }] };
    rerender(object);
    assertStableNodes('mmun', "after changing the list entries, but with stable keys");
    htmlbars_test_helpers.equalTokens(result.fragment, "<ul><li class='mmun'>Martin Muñoz</li><li class='krisselden'>Kris Selden</li></ul>", "After changing the list entries, but with stable keys");

    object = { list: [{ key: "1", name: "Martin Muñoz", "class": "mmun" }, { key: "2", name: "Kristoph Selden", "class": "krisselden" }, { key: "3", name: "Matthew Beale", "class": "mixonic" }] };

    rerender(object);
    assertStableNodes('mmun', "after adding an additional entry");
    htmlbars_test_helpers.equalTokens(result.fragment, "<ul><li class='mmun'>Martin Muñoz</li><li class='krisselden'>Kristoph Selden</li><li class='mixonic'>Matthew Beale</li></ul>", "After adding an additional entry");

    object = { list: [{ key: "1", name: "Martin Muñoz", "class": "mmun" }, { key: "3", name: "Matthew Beale", "class": "mixonic" }] };

    rerender(object);
    assertStableNodes('mmun', "after removing the middle entry");
    htmlbars_test_helpers.equalTokens(result.fragment, "<ul><li class='mmun'>Martin Muñoz</li><li class='mixonic'>Matthew Beale</li></ul>", "after removing the middle entry");

    object = { list: [{ key: "1", name: "Martin Muñoz", "class": "mmun" }, { key: "4", name: "Stefan Penner", "class": "stefanpenner" }, { key: "5", name: "Robert Jackson", "class": "rwjblue" }] };

    rerender(object);
    assertStableNodes('mmun', "after adding two more entries");
    htmlbars_test_helpers.equalTokens(result.fragment, "<ul><li class='mmun'>Martin Muñoz</li><li class='stefanpenner'>Stefan Penner</li><li class='rwjblue'>Robert Jackson</li></ul>", "After adding two more entries");

    // New node for stability check
    itemNode = getItemNode('rwjblue');
    nameNode = getNameNode('rwjblue');

    object = { list: [{ key: "5", name: "Robert Jackson", "class": "rwjblue" }] };

    rerender(object);
    assertStableNodes('rwjblue', "after removing two entries");
    htmlbars_test_helpers.equalTokens(result.fragment, "<ul><li class='rwjblue'>Robert Jackson</li></ul>", "After removing two entries");

    object = { list: [{ key: "1", name: "Martin Muñoz", "class": "mmun" }, { key: "4", name: "Stefan Penner", "class": "stefanpenner" }, { key: "5", name: "Robert Jackson", "class": "rwjblue" }] };

    rerender(object);
    assertStableNodes('rwjblue', "after adding back entries");
    htmlbars_test_helpers.equalTokens(result.fragment, "<ul><li class='mmun'>Martin Muñoz</li><li class='stefanpenner'>Stefan Penner</li><li class='rwjblue'>Robert Jackson</li></ul>", "After adding back entries");

    // New node for stability check
    itemNode = getItemNode('mmun');
    nameNode = getNameNode('mmun');

    object = { list: [{ key: "1", name: "Martin Muñoz", "class": "mmun" }] };

    rerender(object);
    assertStableNodes('mmun', "after removing from the back");
    htmlbars_test_helpers.equalTokens(result.fragment, "<ul><li class='mmun'>Martin Muñoz</li></ul>", "After removing from the back");

    object = { list: [] };

    rerender(object);
    strictEqual(result.fragment.firstChild.firstChild.nodeType, 8, "there are no li's after removing the remaining entry");
    htmlbars_test_helpers.equalTokens(result.fragment, "<ul><!----></ul>", "After removing the remaining entries");

    function rerender(context) {
      result.rerender(env, context);
    }

    function assertStableNodes(className, message) {
      strictEqual(getItemNode(className), itemNode, "The item node has not changed " + message);
      strictEqual(getNameNode(className), nameNode, "The name node has not changed " + message);
    }

    function getItemNode(className) {
      // <li>
      var itemNode = result.fragment.firstChild.firstChild;

      while (itemNode) {
        if (itemNode.getAttribute('class') === className) {
          break;
        }
        itemNode = itemNode.nextSibling;
      }

      ok(itemNode, "Expected node with class='" + className + "'");
      return itemNode;
    }

    function getNameNode(className) {
      // {{item.name}}
      var itemNode = getItemNode(className);
      ok(itemNode, "Expected child node of node with class='" + className + "', but no parent node found");

      var childNode = itemNode && itemNode.firstChild;
      ok(childNode, "Expected child node of node with class='" + className + "', but not child node found");

      return childNode;
    }
  });
}

test("Returning true from `linkRenderNodes` makes the value itself stable across renders", function () {
  var streams = { hello: { value: "hello" }, world: { value: "world" } };

  hooks.linkRenderNode = function () {
    return true;
  };

  hooks.getValue = function (stream) {
    return stream();
  };

  var concatCalled = 0;
  hooks.concat = function (env, params) {
    ok(++concatCalled === 1, "The concat hook is only invoked one time (invoked " + concatCalled + " times)");
    return function () {
      return params[0].value + params[1] + params[2].value;
    };
  };

  var template = compiler.compile("<div class='{{hello}} {{world}}'></div>");
  var result = template.render(streams, env);

  htmlbars_test_helpers.equalTokens(result.fragment, "<div class='hello world'></div>");

  streams.hello.value = "goodbye";

  result.rerender();

  htmlbars_test_helpers.equalTokens(result.fragment, "<div class='goodbye world'></div>");
});

var destroyedRenderNodeCount;
var destroyedRenderNode;

QUnit.module("HTML-based compiler (dirtying) - pruning", {
  beforeEach: function () {
    commonSetup();
    destroyedRenderNodeCount = 0;
    destroyedRenderNode = null;

    hooks.destroyRenderNode = function (renderNode) {
      destroyedRenderNode = renderNode;
      destroyedRenderNodeCount++;
    };
  }
});

test("Pruned render nodes invoke a cleanup hook when replaced", function () {
  var object = { condition: true, value: 'hello world', falsy: "Nothing" };
  var template = compiler.compile('<div>{{#if condition}}<p>{{value}}</p>{{else}}<p>{{falsy}}</p>{{/if}}</div>');

  var result = template.render(object, env);

  htmlbars_test_helpers.equalTokens(result.fragment, "<div><p>hello world</p></div>");

  object.condition = false;
  result.rerender();

  strictEqual(destroyedRenderNodeCount, 1, "cleanup hook was invoked once");
  strictEqual(destroyedRenderNode.lastValue, 'hello world', "The correct render node is passed in");

  object.condition = true;
  result.rerender();

  strictEqual(destroyedRenderNodeCount, 2, "cleanup hook was invoked again");
  strictEqual(destroyedRenderNode.lastValue, 'Nothing', "The correct render node is passed in");
});

test("MorphLists in childNodes are properly cleared", function () {
  var object = {
    condition: true,
    falsy: "Nothing",
    list: [{ key: "1", word: 'Hello' }, { key: "2", word: 'World' }]
  };
  var template = compiler.compile('<div>{{#if condition}}{{#each list as |item|}}<p>{{item.word}}</p>{{/each}}{{else}}<p>{{falsy}}</p>{{/if}}</div>');

  var result = template.render(object, env);

  htmlbars_test_helpers.equalTokens(result.fragment, "<div><p>Hello</p><p>World</p></div>");

  object.condition = false;
  result.rerender();

  htmlbars_test_helpers.equalTokens(result.fragment, "<div><p>Nothing</p></div>");

  strictEqual(destroyedRenderNodeCount, 5, "cleanup hook was invoked for each morph");

  object.condition = true;
  result.rerender();

  strictEqual(destroyedRenderNodeCount, 6, "cleanup hook was invoked again");
});

test("Pruned render nodes invoke a cleanup hook when cleared", function () {
  var object = { condition: true, value: 'hello world' };
  var template = compiler.compile('<div>{{#if condition}}<p>{{value}}</p>{{/if}}</div>');

  var result = template.render(object, env);

  htmlbars_test_helpers.equalTokens(result.fragment, "<div><p>hello world</p></div>");

  object.condition = false;
  result.rerender();

  strictEqual(destroyedRenderNodeCount, 1, "cleanup hook was invoked once");
  strictEqual(destroyedRenderNode.lastValue, 'hello world', "The correct render node is passed in");

  object.condition = true;
  result.rerender();

  strictEqual(destroyedRenderNodeCount, 1, "cleanup hook was not invoked again");
});

test("Pruned lists invoke a cleanup hook when removing elements", function () {
  var object = { list: [{ key: "1", word: "hello" }, { key: "2", word: "world" }] };
  var template = compiler.compile('<div>{{#each list as |item|}}<p>{{item.word}}</p>{{/each}}</div>');

  var result = template.render(object, env);

  htmlbars_test_helpers.equalTokens(result.fragment, "<div><p>hello</p><p>world</p></div>");

  object.list.pop();
  result.rerender();

  strictEqual(destroyedRenderNodeCount, 2, "cleanup hook was invoked once for the wrapper morph and once for the {{item.word}}");
  strictEqual(destroyedRenderNode.lastValue, "world", "The correct render node is passed in");

  object.list.pop();
  result.rerender();

  strictEqual(destroyedRenderNodeCount, 4, "cleanup hook was invoked once for the wrapper morph and once for the {{item.word}}");
  strictEqual(destroyedRenderNode.lastValue, "hello", "The correct render node is passed in");
});

test("Pruned lists invoke a cleanup hook on their subtrees when removing elements", function () {
  var object = { list: [{ key: "1", word: "hello" }, { key: "2", word: "world" }] };
  var template = compiler.compile('<div>{{#each list as |item|}}<p>{{#if item.word}}{{item.word}}{{/if}}</p>{{/each}}</div>');

  var result = template.render(object, env);

  htmlbars_test_helpers.equalTokens(result.fragment, "<div><p>hello</p><p>world</p></div>");

  object.list.pop();
  result.rerender();

  strictEqual(destroyedRenderNodeCount, 3, "cleanup hook was invoked once for the wrapper morph and once for the {{item.word}}");
  strictEqual(destroyedRenderNode.lastValue, "world", "The correct render node is passed in");

  object.list.pop();
  result.rerender();

  strictEqual(destroyedRenderNodeCount, 6, "cleanup hook was invoked once for the wrapper morph and once for the {{item.word}}");
  strictEqual(destroyedRenderNode.lastValue, "hello", "The correct render node is passed in");
});

QUnit.module("Manual elements", {
  beforeEach: commonSetup
});

test("Setting up a manual element renders and revalidates", function () {
  hooks.keywords['manual-element'] = {
    render: function (morph, env, scope, params, hash, template, inverse, visitor) {
      var attributes = {
        title: "Tom Dale",
        href: ['concat', ['http://tomdale.', ['get', 'tld']]],
        'data-bar': ['get', 'bar']
      };

      var layout = render.manualElement('span', attributes);

      defaultHooks.hostBlock(morph, env, scope, template, inverse, null, visitor, function (options) {
        options.templates.template.yieldIn({ raw: layout }, hash);
      });

      render.manualElement(env, scope, 'span', attributes, morph);
    },

    isStable: function () {
      return true;
    }
  };

  var template = compiler.compile("{{#manual-element bar='baz' tld='net'}}Hello {{world}}!{{/manual-element}}");
  var result = template.render({ world: "world" }, env);

  htmlbars_test_helpers.equalTokens(result.fragment, "<span title='Tom Dale' href='http://tomdale.net' data-bar='baz'>Hello world!</span>");
});

test("It is possible to nest multiple templates into a manual element", function () {
  hooks.keywords['manual-element'] = {
    render: function (morph, env, scope, params, hash, template, inverse, visitor) {
      var attributes = {
        title: "Tom Dale",
        href: ['concat', ['http://tomdale.', ['get', 'tld']]],
        'data-bar': ['get', 'bar']
      };

      var elementTemplate = render.manualElement('span', attributes);

      var contentBlock = template_utils.blockFor(render['default'], template, { scope: scope });

      var layoutBlock = template_utils.blockFor(render['default'], layout.raw, {
        yieldTo: contentBlock,
        self: { attrs: hash }
      });

      var elementBlock = template_utils.blockFor(render['default'], elementTemplate, {
        yieldTo: layoutBlock,
        self: hash
      });

      elementBlock(env, null, undefined, morph, null, visitor);
    },

    isStable: function () {
      return true;
    }
  };

  var layout = compiler.compile("<em>{{attrs.foo}}. {{yield}}</em>");
  var template = compiler.compile("{{#manual-element foo='foo' bar='baz' tld='net'}}Hello {{world}}!{{/manual-element}}");
  var result = template.render({ world: "world" }, env);

  htmlbars_test_helpers.equalTokens(result.fragment, "<span title='Tom Dale' href='http://tomdale.net' data-bar='baz'><em>foo. Hello world!</em></span>");
});

test("The invoke helper hook can instruct the runtime to link the result", function () {
  var invokeCount = 0;

  env.hooks.invokeHelper = function (morph, env, scope, visitor, params, hash, helper) {
    invokeCount++;
    return { value: helper(params, hash), link: true };
  };

  helpers.double = function (_ref) {
    var input = _ref[0];

    return input * 2;
  };

  var template = compiler.compile("{{double 12}}");
  var result = template.render({}, env);

  htmlbars_test_helpers.equalTokens(result.fragment, "24");
  equal(invokeCount, 1);

  result.rerender();

  htmlbars_test_helpers.equalTokens(result.fragment, "24");
  equal(invokeCount, 1);
});