define('htmlbars-test-helpers', ['exports', '../simple-html-tokenizer', '../htmlbars-util/array-utils'], function (exports, simple_html_tokenizer, array_utils) {

  'use strict';

  exports.equalInnerHTML = equalInnerHTML;
  exports.equalHTML = equalHTML;
  exports.equalTokens = equalTokens;
  exports.normalizeInnerHTML = normalizeInnerHTML;
  exports.isCheckedInputHTML = isCheckedInputHTML;
  exports.getTextContent = getTextContent;

  function equalInnerHTML(fragment, html) {
    var actualHTML = normalizeInnerHTML(fragment.innerHTML);
    QUnit.push(actualHTML === html, actualHTML, html);
  }

  function equalHTML(node, html) {
    var fragment;
    if (!node.nodeType && node.length) {
      fragment = document.createDocumentFragment();
      while (node[0]) {
        fragment.appendChild(node[0]);
      }
    } else {
      fragment = node;
    }

    var div = document.createElement("div");
    div.appendChild(fragment.cloneNode(true));

    equalInnerHTML(div, html);
  }

  function generateTokens(fragmentOrHtml) {
    var div = document.createElement("div");
    if (typeof fragmentOrHtml === 'string') {
      div.innerHTML = fragmentOrHtml;
    } else {
      div.appendChild(fragmentOrHtml.cloneNode(true));
    }

    return { tokens: simple_html_tokenizer.tokenize(div.innerHTML), html: div.innerHTML };
  }

  function equalTokens(fragment, html, message) {
    if (fragment.fragment) {
      fragment = fragment.fragment;
    }
    if (html.fragment) {
      html = html.fragment;
    }

    var fragTokens = generateTokens(fragment);
    var htmlTokens = generateTokens(html);

    function normalizeTokens(token) {
      if (token.type === 'StartTag') {
        token.attributes = token.attributes.sort(function (a, b) {
          if (a[0] > b[0]) {
            return 1;
          }
          if (a[0] < b[0]) {
            return -1;
          }
          return 0;
        });
      }
    }

    array_utils.forEach(fragTokens.tokens, normalizeTokens);
    array_utils.forEach(htmlTokens.tokens, normalizeTokens);

    var msg = "Expected: " + html + "; Actual: " + fragTokens.html;

    if (message) {
      msg += " (" + message + ")";
    }

    deepEqual(fragTokens.tokens, htmlTokens.tokens, msg);
  }

  // detect side-effects of cloning svg elements in IE9-11
  var ieSVGInnerHTML = (function () {
    if (!document.createElementNS) {
      return false;
    }
    var div = document.createElement('div');
    var node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    div.appendChild(node);
    var clone = div.cloneNode(true);
    return clone.innerHTML === '<svg xmlns="http://www.w3.org/2000/svg" />';
  })();

  function normalizeInnerHTML(actualHTML) {
    if (ieSVGInnerHTML) {
      // Replace `<svg xmlns="http://www.w3.org/2000/svg" height="50%" />` with `<svg height="50%"></svg>`, etc.
      // drop namespace attribute
      actualHTML = actualHTML.replace(/ xmlns="[^"]+"/, '');
      // replace self-closing elements
      actualHTML = actualHTML.replace(/<([^ >]+) [^\/>]*\/>/gi, function (tag, tagName) {
        return tag.slice(0, tag.length - 3) + '></' + tagName + '>';
      });
    }

    return actualHTML;
  }

  // detect weird IE8 checked element string
  var checkedInput = document.createElement('input');
  checkedInput.setAttribute('checked', 'checked');
  var checkedInputString = checkedInput.outerHTML;

  function isCheckedInputHTML(element) {
    equal(element.outerHTML, checkedInputString);
  }

  // check which property has the node's text content
  var textProperty = document.createElement('div').textContent === undefined ? 'innerText' : 'textContent';

  function getTextContent(el) {
    // textNode
    if (el.nodeType === 3) {
      return el.nodeValue;
    } else {
      return el[textProperty];
    }
  }

});
define('htmlbars-test-helpers.jshint', function () {

  'use strict';

  QUnit.module('JSHint - .');
  QUnit.test('htmlbars-test-helpers.js should pass jshint', function (assert) {
    assert.ok(true, 'htmlbars-test-helpers.js should pass jshint.');
  });

});
define('htmlbars-util', ['exports', './htmlbars-util/safe-string', './htmlbars-util/handlebars/utils', './htmlbars-util/namespaces', './htmlbars-util/morph-utils'], function (exports, SafeString, utils, namespaces, morph_utils) {

	'use strict';



	exports.SafeString = SafeString['default'];
	exports.escapeExpression = utils.escapeExpression;
	exports.getAttrNamespace = namespaces.getAttrNamespace;
	exports.validateChildMorphs = morph_utils.validateChildMorphs;
	exports.linkParams = morph_utils.linkParams;
	exports.dump = morph_utils.dump;

});
define('htmlbars-util.jshint', function () {

  'use strict';

  QUnit.module('JSHint - .');
  QUnit.test('htmlbars-util.js should pass jshint', function (assert) {
    assert.ok(true, 'htmlbars-util.js should pass jshint.');
  });

});
define('htmlbars-util/array-utils', ['exports'], function (exports) {

  'use strict';

  exports.forEach = forEach;
  exports.map = map;

  function forEach(array, callback, binding) {
    var i, l;
    if (binding === undefined) {
      for (i = 0, l = array.length; i < l; i++) {
        callback(array[i], i, array);
      }
    } else {
      for (i = 0, l = array.length; i < l; i++) {
        callback.call(binding, array[i], i, array);
      }
    }
  }

  function map(array, callback) {
    var output = [];
    var i, l;

    for (i = 0, l = array.length; i < l; i++) {
      output.push(callback(array[i], i, array));
    }

    return output;
  }

  var getIdx;
  if (Array.prototype.indexOf) {
    getIdx = function (array, obj, from) {
      return array.indexOf(obj, from);
    };
  } else {
    getIdx = function (array, obj, from) {
      if (from === undefined || from === null) {
        from = 0;
      } else if (from < 0) {
        from = Math.max(0, array.length + from);
      }
      for (var i = from, l = array.length; i < l; i++) {
        if (array[i] === obj) {
          return i;
        }
      }
      return -1;
    };
  }

  var isArray = Array.isArray || function (array) {
    return Object.prototype.toString.call(array) === '[object Array]';
  };

  var indexOfArray = getIdx;

  exports.isArray = isArray;
  exports.indexOfArray = indexOfArray;

});
define('htmlbars-util/array-utils.jshint', function () {

  'use strict';

  QUnit.module('JSHint - htmlbars-util');
  QUnit.test('htmlbars-util/array-utils.js should pass jshint', function (assert) {
    assert.ok(true, 'htmlbars-util/array-utils.js should pass jshint.');
  });

});
define('htmlbars-util/handlebars/safe-string', ['exports'], function (exports) {

  'use strict';

  // Build out our basic SafeString type
  function SafeString(string) {
    this.string = string;
  }

  SafeString.prototype.toString = SafeString.prototype.toHTML = function () {
    return '' + this.string;
  };

  exports['default'] = SafeString;

});
define('htmlbars-util/handlebars/safe-string.jshint', function () {

  'use strict';

  QUnit.module('JSHint - htmlbars-util/handlebars');
  QUnit.test('htmlbars-util/handlebars/safe-string.js should pass jshint', function (assert) {
    assert.ok(true, 'htmlbars-util/handlebars/safe-string.js should pass jshint.');
  });

});
define('htmlbars-util/handlebars/utils', ['exports'], function (exports) {

  'use strict';

  exports.extend = extend;
  exports.indexOf = indexOf;
  exports.escapeExpression = escapeExpression;
  exports.isEmpty = isEmpty;
  exports.blockParams = blockParams;
  exports.appendContextPath = appendContextPath;

  var escape = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '`': '&#x60;'
  };

  var badChars = /[&<>"'`]/g,
      possible = /[&<>"'`]/;

  function escapeChar(chr) {
    return escape[chr];
  }

  function extend(obj /* , ...source */) {
    for (var i = 1; i < arguments.length; i++) {
      for (var key in arguments[i]) {
        if (Object.prototype.hasOwnProperty.call(arguments[i], key)) {
          obj[key] = arguments[i][key];
        }
      }
    }

    return obj;
  }

  var toString = Object.prototype.toString;

  var isFunction = function (value) {
    return typeof value === 'function';
  };
  // fallback for older versions of Chrome and Safari
  /* istanbul ignore next */
  if (isFunction(/x/)) {
    isFunction = function (value) {
      return typeof value === 'function' && toString.call(value) === '[object Function]';
    };
  }
  var isFunction;
  var isArray = Array.isArray || function (value) {
    return value && typeof value === 'object' ? toString.call(value) === '[object Array]' : false;
  };

  function indexOf(array, value) {
    for (var i = 0, len = array.length; i < len; i++) {
      if (array[i] === value) {
        return i;
      }
    }
    return -1;
  }

  function escapeExpression(string) {
    if (typeof string !== 'string') {
      // don't escape SafeStrings, since they're already safe
      if (string && string.toHTML) {
        return string.toHTML();
      } else if (string == null) {
        return '';
      } else if (!string) {
        return string + '';
      }

      // Force a string conversion as this will be done by the append regardless and
      // the regex test will do this transparently behind the scenes, causing issues if
      // an object's to string has escaped characters in it.
      string = '' + string;
    }

    if (!possible.test(string)) {
      return string;
    }
    return string.replace(badChars, escapeChar);
  }

  function isEmpty(value) {
    if (!value && value !== 0) {
      return true;
    } else if (isArray(value) && value.length === 0) {
      return true;
    } else {
      return false;
    }
  }

  function blockParams(params, ids) {
    params.path = ids;
    return params;
  }

  function appendContextPath(contextPath, id) {
    return (contextPath ? contextPath + '.' : '') + id;
  }

  exports.toString = toString;
  exports.isFunction = isFunction;
  exports.isArray = isArray;

});
define('htmlbars-util/handlebars/utils.jshint', function () {

  'use strict';

  QUnit.module('JSHint - htmlbars-util/handlebars');
  QUnit.test('htmlbars-util/handlebars/utils.js should pass jshint', function (assert) {
    assert.ok(false, 'htmlbars-util/handlebars/utils.js should pass jshint.\nhtmlbars-util/handlebars/utils.js: line 68, col 25, Expected \'===\' and instead saw \'==\'.\n\n1 error');
  });

});
define('htmlbars-util/morph-utils', ['exports'], function (exports) {

  'use strict';

  exports.visitChildren = visitChildren;
  exports.validateChildMorphs = validateChildMorphs;
  exports.linkParams = linkParams;
  exports.dump = dump;

  function visitChildren(nodes, callback) {
    if (!nodes || nodes.length === 0) {
      return;
    }

    nodes = nodes.slice();

    while (nodes.length) {
      var node = nodes.pop();
      callback(node);

      if (node.childNodes) {
        nodes.push.apply(nodes, node.childNodes);
      } else if (node.firstChildMorph) {
        var current = node.firstChildMorph;

        while (current) {
          nodes.push(current);
          current = current.nextMorph;
        }
      } else if (node.morphList) {
        var current = node.morphList.firstChildMorph;

        while (current) {
          nodes.push(current);
          current = current.nextMorph;
        }
      }
    }
  }

  function validateChildMorphs(env, morph, visitor) {
    var morphList = morph.morphList;
    if (morph.morphList) {
      var current = morphList.firstChildMorph;

      while (current) {
        var next = current.nextMorph;
        validateChildMorphs(env, current, visitor);
        current = next;
      }
    } else if (morph.lastResult) {
      morph.lastResult.revalidateWith(env, undefined, undefined, undefined, visitor);
    } else if (morph.childNodes) {
      // This means that the childNodes were wired up manually
      for (var i = 0, l = morph.childNodes.length; i < l; i++) {
        validateChildMorphs(env, morph.childNodes[i], visitor);
      }
    }
  }

  function linkParams(env, scope, morph, path, params, hash) {
    if (morph.linkedParams) {
      return;
    }

    if (env.hooks.linkRenderNode(morph, env, scope, path, params, hash)) {
      morph.linkedParams = { params: params, hash: hash };
    }
  }

  function dump(node) {
    console.group(node, node.isDirty);

    if (node.childNodes) {
      map(node.childNodes, dump);
    } else if (node.firstChildMorph) {
      var current = node.firstChildMorph;

      while (current) {
        dump(current);
        current = current.nextMorph;
      }
    } else if (node.morphList) {
      dump(node.morphList);
    }

    console.groupEnd();
  }

  function map(nodes, cb) {
    for (var i = 0, l = nodes.length; i < l; i++) {
      cb(nodes[i]);
    }
  }

});
define('htmlbars-util/morph-utils.jshint', function () {

  'use strict';

  QUnit.module('JSHint - htmlbars-util');
  QUnit.test('htmlbars-util/morph-utils.js should pass jshint', function (assert) {
    assert.ok(true, 'htmlbars-util/morph-utils.js should pass jshint.');
  });

});
define('htmlbars-util/namespaces', ['exports'], function (exports) {

  'use strict';

  exports.getAttrNamespace = getAttrNamespace;

  var defaultNamespaces = {
    html: 'http://www.w3.org/1999/xhtml',
    mathml: 'http://www.w3.org/1998/Math/MathML',
    svg: 'http://www.w3.org/2000/svg',
    xlink: 'http://www.w3.org/1999/xlink',
    xml: 'http://www.w3.org/XML/1998/namespace'
  };

  function getAttrNamespace(attrName) {
    var namespace;

    var colonIndex = attrName.indexOf(':');
    if (colonIndex !== -1) {
      var prefix = attrName.slice(0, colonIndex);
      namespace = defaultNamespaces[prefix];
    }

    return namespace || null;
  }

});
define('htmlbars-util/namespaces.jshint', function () {

  'use strict';

  QUnit.module('JSHint - htmlbars-util');
  QUnit.test('htmlbars-util/namespaces.js should pass jshint', function (assert) {
    assert.ok(true, 'htmlbars-util/namespaces.js should pass jshint.');
  });

});
define('htmlbars-util/object-utils', ['exports'], function (exports) {

  'use strict';

  exports.merge = merge;
  exports.shallowCopy = shallowCopy;
  exports.keySet = keySet;
  exports.keyLength = keyLength;

  function merge(options, defaults) {
    for (var prop in defaults) {
      if (options.hasOwnProperty(prop)) {
        continue;
      }
      options[prop] = defaults[prop];
    }
    return options;
  }

  function shallowCopy(obj) {
    return merge({}, obj);
  }

  function keySet(obj) {
    var set = {};

    for (var prop in obj) {
      if (obj.hasOwnProperty(prop)) {
        set[prop] = true;
      }
    }

    return set;
  }

  function keyLength(obj) {
    var count = 0;

    for (var prop in obj) {
      if (obj.hasOwnProperty(prop)) {
        count++;
      }
    }

    return count;
  }

});
define('htmlbars-util/object-utils.jshint', function () {

  'use strict';

  QUnit.module('JSHint - htmlbars-util');
  QUnit.test('htmlbars-util/object-utils.js should pass jshint', function (assert) {
    assert.ok(true, 'htmlbars-util/object-utils.js should pass jshint.');
  });

});
define('htmlbars-util/quoting', ['exports'], function (exports) {

  'use strict';

  exports.hash = hash;
  exports.repeat = repeat;
  exports.escapeString = escapeString;
  exports.string = string;
  exports.array = array;

  function escapeString(str) {
    str = str.replace(/\\/g, "\\\\");
    str = str.replace(/"/g, '\\"');
    str = str.replace(/\n/g, "\\n");
    return str;
  }

  function string(str) {
    return '"' + escapeString(str) + '"';
  }

  function array(a) {
    return "[" + a + "]";
  }

  function hash(pairs) {
    return "{" + pairs.join(", ") + "}";
  }

  function repeat(chars, times) {
    var str = "";
    while (times--) {
      str += chars;
    }
    return str;
  }

});
define('htmlbars-util/quoting.jshint', function () {

  'use strict';

  QUnit.module('JSHint - htmlbars-util');
  QUnit.test('htmlbars-util/quoting.js should pass jshint', function (assert) {
    assert.ok(true, 'htmlbars-util/quoting.js should pass jshint.');
  });

});
define('htmlbars-util/safe-string', ['exports', './handlebars/safe-string'], function (exports, SafeString) {

	'use strict';

	exports['default'] = SafeString['default'];

});
define('htmlbars-util/safe-string.jshint', function () {

  'use strict';

  QUnit.module('JSHint - htmlbars-util');
  QUnit.test('htmlbars-util/safe-string.js should pass jshint', function (assert) {
    assert.ok(true, 'htmlbars-util/safe-string.js should pass jshint.');
  });

});
define('htmlbars-util/template-utils', ['exports', '../htmlbars-util/morph-utils'], function (exports, morph_utils) {

  'use strict';

  exports.RenderState = RenderState;
  exports.blockFor = blockFor;
  exports.renderAndCleanup = renderAndCleanup;
  exports.clearMorph = clearMorph;
  exports.clearMorphList = clearMorphList;

  function RenderState(renderNode, morphList) {
    // The morph list that is no longer needed and can be
    // destroyed.
    this.morphListToClear = morphList;

    // The morph list that needs to be pruned of any items
    // that were not yielded on a subsequent render.
    this.morphListToPrune = null;

    // A map of morphs for each item yielded in during this
    // rendering pass. Any morphs in the DOM but not in this map
    // will be pruned during cleanup.
    this.handledMorphs = {};
    this.collisions = undefined;

    // The morph to clear once rendering is complete. By
    // default, we set this to the previous morph (to catch
    // the case where nothing is yielded; in that case, we
    // should just clear the morph). Otherwise this gets set
    // to null if anything is rendered.
    this.morphToClear = renderNode;

    this.shadowOptions = null;
  }

  function blockFor(render, template, blockOptions) {
    var block = function (env, blockArguments, self, renderNode, parentScope, visitor) {
      if (renderNode.lastResult) {
        renderNode.lastResult.revalidateWith(env, undefined, self, blockArguments, visitor);
      } else {
        var options = { renderState: new RenderState(renderNode) };

        var scope = blockOptions.scope;
        var shadowScope = scope ? env.hooks.createChildScope(scope) : env.hooks.createFreshScope();
        var attributes = blockOptions.attributes;

        env.hooks.bindShadowScope(env, parentScope, shadowScope, blockOptions.options);

        if (self !== undefined) {
          env.hooks.bindSelf(env, shadowScope, self);
        } else if (blockOptions.self !== undefined) {
          env.hooks.bindSelf(env, shadowScope, blockOptions.self);
        }

        bindBlocks(env, shadowScope, blockOptions.yieldTo);

        renderAndCleanup(renderNode, env, options, null, function () {
          options.renderState.morphToClear = null;
          render(template, env, shadowScope, { renderNode: renderNode, blockArguments: blockArguments, attributes: attributes });
        });
      }
    };

    block.arity = template.arity;

    return block;
  }

  function bindBlocks(env, shadowScope, blocks) {
    if (!blocks) {
      return;
    }
    if (typeof blocks === 'function') {
      env.hooks.bindBlock(env, shadowScope, blocks);
    } else {
      for (var name in blocks) {
        if (blocks.hasOwnProperty(name)) {
          env.hooks.bindBlock(env, shadowScope, blocks[name], name);
        }
      }
    }
  }

  function renderAndCleanup(morph, env, options, shadowOptions, callback) {
    // The RenderState object is used to collect information about what the
    // helper or hook being invoked has yielded. Once it has finished either
    // yielding multiple items (via yieldItem) or a single template (via
    // yieldTemplate), we detect what was rendered and how it differs from
    // the previous render, cleaning up old state in DOM as appropriate.
    var renderState = options.renderState;
    renderState.collisions = undefined;
    renderState.shadowOptions = shadowOptions;

    // Invoke the callback, instructing it to save information about what it
    // renders into RenderState.
    var result = callback(options);

    // The hook can opt-out of cleanup if it handled cleanup itself.
    if (result && result.handled) {
      return;
    }

    var morphMap = morph.morphMap;

    // Walk the morph list, clearing any items that were yielded in a previous
    // render but were not yielded during this render.
    var morphList = renderState.morphListToPrune;
    if (morphList) {
      var handledMorphs = renderState.handledMorphs;
      var item = morphList.firstChildMorph;

      while (item) {
        var next = item.nextMorph;

        // If we don't see the key in handledMorphs, it wasn't
        // yielded in and we can safely remove it from DOM.
        if (!(item.key in handledMorphs)) {
          delete morphMap[item.key];
          clearMorph(item, env, true);
          item.destroy();
        }

        item = next;
      }
    }

    morphList = renderState.morphListToClear;
    if (morphList) {
      clearMorphList(morphList, morph, env);
    }

    var toClear = renderState.morphToClear;
    if (toClear) {
      clearMorph(toClear, env);
    }
  }

  function clearMorph(morph, env, destroySelf) {
    var cleanup = env.hooks.cleanupRenderNode;
    var destroy = env.hooks.destroyRenderNode;
    var willCleanup = env.hooks.willCleanupTree;
    var didCleanup = env.hooks.didCleanupTree;

    function destroyNode(node) {
      if (cleanup) {
        cleanup(node);
      }
      if (destroy) {
        destroy(node);
      }
    }

    if (willCleanup) {
      willCleanup(env, morph, destroySelf);
    }
    if (cleanup) {
      cleanup(morph);
    }
    if (destroySelf && destroy) {
      destroy(morph);
    }

    morph_utils.visitChildren(morph.childNodes, destroyNode);

    // TODO: Deal with logical children that are not in the DOM tree
    morph.clear();
    if (didCleanup) {
      didCleanup(env, morph, destroySelf);
    }

    morph.lastResult = null;
    morph.lastYielded = null;
    morph.childNodes = null;
  }

  function clearMorphList(morphList, morph, env) {
    var item = morphList.firstChildMorph;

    while (item) {
      var next = item.nextMorph;
      delete morph.morphMap[item.key];
      clearMorph(item, env, true);
      item.destroy();

      item = next;
    }

    // Remove the MorphList from the morph.
    morphList.clear();
    morph.morphList = null;
  }

});
define('htmlbars-util/template-utils.jshint', function () {

  'use strict';

  QUnit.module('JSHint - htmlbars-util');
  QUnit.test('htmlbars-util/template-utils.js should pass jshint', function (assert) {
    assert.ok(true, 'htmlbars-util/template-utils.js should pass jshint.');
  });

});
define('htmlbars-util/void-tag-names', ['exports', './array-utils'], function (exports, array_utils) {

  'use strict';

  var voidTagNames = "area base br col command embed hr img input keygen link meta param source track wbr";
  var voidMap = {};

  array_utils.forEach(voidTagNames.split(" "), function (tagName) {
    voidMap[tagName] = true;
  });

  exports['default'] = voidMap;

});
define('htmlbars-util/void-tag-names.jshint', function () {

  'use strict';

  QUnit.module('JSHint - htmlbars-util');
  QUnit.test('htmlbars-util/void-tag-names.js should pass jshint', function (assert) {
    assert.ok(true, 'htmlbars-util/void-tag-names.js should pass jshint.');
  });

});
define('morph-attr-tests/attr-morph-test', ['../dom-helper', 'htmlbars-util/safe-string'], function (DOMHelper, SafeString) {

  'use strict';

  /* jshint scripturl:true */

  var svgNamespace = "http://www.w3.org/2000/svg",
      xlinkNamespace = "http://www.w3.org/1999/xlink";
  var domHelper = new DOMHelper['default']();

  QUnit.module('AttrMorph');

  test("can update a dom node", function () {
    var element = domHelper.createElement('div');
    var morph = domHelper.createAttrMorph(element, 'id');
    morph.setContent('twang');
    equal(element.id, 'twang', 'id property is set');
    equal(element.getAttribute('id'), 'twang', 'id attribute is set');
  });

  test("can clear", function () {
    expect(0);
    var element = domHelper.createElement('div');
    var morph = domHelper.createAttrMorph(element, 'id');
    morph.clear();
  });

  test("calling destroy does not throw", function () {
    expect(1);
    var element = domHelper.createElement('div');
    var morph = domHelper.createAttrMorph(element, 'id');

    morph.destroy();

    equal(morph.element, null, 'clears element from morph');
  });

  test("can update property", function () {
    var element = domHelper.createElement('input');
    var morph = domHelper.createAttrMorph(element, 'disabled');
    morph.setContent(true);
    equal(element.disabled, true, 'disabled property is set');
    morph.setContent(false);
    equal(element.disabled, false, 'disabled property is set');
  });

  test("does not add undefined properties on initial render", function () {
    var element = domHelper.createElement('div');
    var morph = domHelper.createAttrMorph(element, 'id');
    morph.setContent(undefined);
    equal(element.id, '', 'property should not be set');
    morph.setContent('foo-bar');
    equal(element.id, 'foo-bar', 'property should be set');
  });

  test("does not add null properties on initial render", function () {
    var element = domHelper.createElement('div');
    var morph = domHelper.createAttrMorph(element, 'id');
    morph.setContent(null);
    equal(element.id, '', 'property should not be set');
    morph.setContent('foo-bar');
    equal(element.id, 'foo-bar', 'property should be set');
  });

  test("can update attribute", function () {
    var element = domHelper.createElement('div');
    var morph = domHelper.createAttrMorph(element, 'data-bop');
    morph.setContent('kpow');
    equal(element.getAttribute('data-bop'), 'kpow', 'data-bop attribute is set');
    morph.setContent(null);
    equal(element.getAttribute('data-bop'), undefined, 'data-bop attribute is removed');
  });

  test("can remove ns attribute with null", function () {
    var element = domHelper.createElement('svg');
    domHelper.setAttribute(element, 'xlink:title', 'Great Title', xlinkNamespace);
    var morph = domHelper.createAttrMorph(element, 'xlink:title', xlinkNamespace);
    morph.setContent(null);
    equal(element.getAttribute('xlink:title'), undefined, 'ns attribute is removed');
  });

  test("can remove attribute with undefined", function () {
    var element = domHelper.createElement('div');
    element.setAttribute('data-bop', 'kpow');
    var morph = domHelper.createAttrMorph(element, 'data-bop');
    morph.setContent(undefined);
    equal(element.getAttribute('data-bop'), undefined, 'data-bop attribute is removed');
  });

  test("can remove ns attribute with undefined", function () {
    var element = domHelper.createElement('svg');
    domHelper.setAttribute(element, 'xlink:title', 'Great Title', xlinkNamespace);
    var morph = domHelper.createAttrMorph(element, 'xlink:title', xlinkNamespace);
    morph.setContent(undefined);
    equal(element.getAttribute('xlink:title'), undefined, 'ns attribute is removed');
  });

  test("can update svg attribute", function () {
    domHelper.setNamespace(svgNamespace);
    var element = domHelper.createElement('svg');
    var morph = domHelper.createAttrMorph(element, 'height');
    morph.setContent('50%');
    equal(element.getAttribute('height'), '50%', 'svg attr is set');
    morph.setContent(null);
    equal(element.getAttribute('height'), undefined, 'svg attr is removed');
  });

  test("can update style attribute", function () {
    var element = domHelper.createElement('div');
    var morph = domHelper.createAttrMorph(element, 'style');
    morph.setContent('color: red;');
    equal(element.getAttribute('style'), 'color: red;', 'style attr is set');
    morph.setContent(null);
    equal(element.getAttribute('style'), undefined, 'style attr is removed');
  });

  var badTags = [{ tag: 'a', attr: 'href' }, { tag: 'body', attr: 'background' }, { tag: 'link', attr: 'href' }, { tag: 'img', attr: 'src' }, { tag: 'iframe', attr: 'src' }];

  for (var i = 0, l = badTags.length; i < l; i++) {
    (function () {
      var subject = badTags[i];

      test(subject.tag + " " + subject.attr + " is sanitized when using blacklisted protocol", function () {
        var element = document.createElement(subject.tag);
        var morph = domHelper.createAttrMorph(element, subject.attr);
        morph.setContent('javascript://example.com');

        equal(element.getAttribute(subject.attr), 'unsafe:javascript://example.com', 'attribute is escaped');
      });

      test(subject.tag + " " + subject.attr + " is not sanitized when using non-whitelisted protocol with a SafeString", function () {
        var element = document.createElement(subject.tag);
        var morph = domHelper.createAttrMorph(element, subject.attr);
        try {
          morph.setContent(new SafeString['default']('javascript://example.com'));

          equal(element.getAttribute(subject.attr), 'javascript://example.com', 'attribute is not escaped');
        } catch (e) {
          // IE does not allow javascript: to be set on img src
          ok(true, 'caught exception ' + e);
        }
      });

      test(subject.tag + " " + subject.attr + " is not sanitized when using unsafe attr morph", function () {
        var element = document.createElement(subject.tag);
        var morph = domHelper.createUnsafeAttrMorph(element, subject.attr);
        try {
          morph.setContent('javascript://example.com');

          equal(element.getAttribute(subject.attr), 'javascript://example.com', 'attribute is not escaped');
        } catch (e) {
          // IE does not allow javascript: to be set on img src
          ok(true, 'caught exception ' + e);
        }
      });
    })(); //jshint ignore:line
  }

  if (document && document.createElementNS) {

    test("detects attribute's namespace if it is not passed as an argument", function () {
      var element = domHelper.createElement('div');
      var morph = domHelper.createAttrMorph(element, 'xlink:href');
      morph.setContent('#circle');
      equal(element.attributes[0].namespaceURI, 'http://www.w3.org/1999/xlink', 'attribute has correct namespace');
    });

    test("can update namespaced attribute", function () {
      domHelper.setNamespace(svgNamespace);
      var element = domHelper.createElement('svg');
      var morph = domHelper.createAttrMorph(element, 'xlink:href', 'http://www.w3.org/1999/xlink');
      morph.setContent('#other');
      equal(element.getAttributeNS('http://www.w3.org/1999/xlink', 'href'), '#other', 'namespaced attr is set');
      equal(element.attributes[0].namespaceURI, 'http://www.w3.org/1999/xlink');
      equal(element.attributes[0].name, 'xlink:href');
      equal(element.attributes[0].localName, 'href');
      equal(element.attributes[0].value, '#other');
      morph.setContent(null);
      // safari returns '' while other browsers return undefined
      equal(!!element.getAttributeNS('http://www.w3.org/1999/xlink', 'href'), false, 'namespaced attr is removed');
    });
  }

  test("embed src as data uri is sanitized", function () {
    var element = document.createElement('embed');
    var morph = domHelper.createAttrMorph(element, 'src');
    morph.setContent('data:image/svg+xml;base64,PH');

    equal(element.getAttribute('src'), 'unsafe:data:image/svg+xml;base64,PH', 'attribute is escaped');
  });

});
define('morph-attr-tests/attr-morph-test.jshint', function () {

  'use strict';

  QUnit.module('JSHint - morph-attr-tests');
  QUnit.test('morph-attr-tests/attr-morph-test.js should pass jshint', function (assert) {
    assert.ok(false, 'morph-attr-tests/attr-morph-test.js should pass jshint.\nmorph-attr-tests/attr-morph-test.js: line 125, col 4, Functions declared within loops referencing an outer scoped variable may lead to confusing semantics.\n\n1 error');
  });

});
define('morph-attr-tests/attr-morph/sanitize-attribute-value-test', ['morph-attr/sanitize-attribute-value', 'htmlbars-util/safe-string', 'htmlbars-util/array-utils', '../../dom-helper'], function (sanitize_attribute_value, SafeString, array_utils, DOMHelper) {

  'use strict';

  var domHelper = new DOMHelper['default']();

  QUnit.module('sanitizeAttributeValue(null, "*")');

  var goodProtocols = ['https', 'http', 'ftp', 'tel', 'file'];

  for (var i = 0, l = goodProtocols.length; i < l; i++) {
    buildProtocolTest(goodProtocols[i]);
  }

  function buildProtocolTest(protocol) {
    test('allows ' + protocol + ' protocol when element is not provided', function () {
      expect(1);

      var attributeValue = protocol + '://foo.com';
      var actual = sanitize_attribute_value.sanitizeAttributeValue(domHelper, null, 'href', attributeValue);

      equal(actual, attributeValue, 'protocol not escaped');
    });
  }

  test('blocks javascript: protocol', function () {
    /* jshint scripturl:true */

    expect(1);

    var attributeValue = 'javascript:alert("foo")';
    var actual = sanitize_attribute_value.sanitizeAttributeValue(domHelper, null, 'href', attributeValue);

    equal(actual, 'unsafe:' + attributeValue, 'protocol escaped');
  });

  test('blocks blacklisted protocols', function () {
    /* jshint scripturl:true */

    expect(1);

    var attributeValue = 'javascript:alert("foo")';
    var actual = sanitize_attribute_value.sanitizeAttributeValue(domHelper, null, 'href', attributeValue);

    equal(actual, 'unsafe:' + attributeValue, 'protocol escaped');
  });

  test('does not block SafeStrings', function () {
    /* jshint scripturl:true */

    expect(1);

    var attributeValue = 'javascript:alert("foo")';
    var actual = sanitize_attribute_value.sanitizeAttributeValue(domHelper, null, 'href', new SafeString['default'](attributeValue));

    equal(actual, attributeValue, 'protocol unescaped');
  });

  test("blocks data uri for EMBED", function () {
    /* jshint scripturl:true */

    expect(1);

    var attributeValue = 'data:image/svg+xml;base64,...';
    var actual = sanitize_attribute_value.sanitizeAttributeValue(domHelper, { tagName: 'EMBED' }, 'src', attributeValue);

    equal(actual, 'unsafe:' + attributeValue, 'protocol escaped');
  });

  test("doesn't sanitize data uri for IMG", function () {
    /* jshint scripturl:true */

    expect(1);

    var attributeValue = 'data:image/svg+xml;base64,...';
    var actual = sanitize_attribute_value.sanitizeAttributeValue(domHelper, { tagName: 'IMG' }, 'src', attributeValue);

    equal(actual, attributeValue, 'protocol should not have been escaped');
  });

  var badTags = ['A', 'BODY', 'LINK', 'IMG', 'IFRAME', 'BASE', 'FORM'];

  var badAttributes = ['href', 'src', 'background', 'action'];

  var someIllegalProtocols = ['javascript', 'vbscript'];

  array_utils.forEach(badTags, function (tagName) {
    array_utils.forEach(badAttributes, function (attrName) {
      array_utils.forEach(someIllegalProtocols, function (protocol) {
        test(' <' + tagName + ' ' + attrName + '="' + protocol + ':something"> ...', function () {
          equal(sanitize_attribute_value.sanitizeAttributeValue(domHelper, { tagName: tagName }, attrName, protocol + ':something'), 'unsafe:' + protocol + ':something');
        });
      });
    });
  });

});
define('morph-attr-tests/attr-morph/sanitize-attribute-value-test.jshint', function () {

  'use strict';

  QUnit.module('JSHint - morph-attr-tests/attr-morph');
  QUnit.test('morph-attr-tests/attr-morph/sanitize-attribute-value-test.js should pass jshint', function (assert) {
    assert.ok(true, 'morph-attr-tests/attr-morph/sanitize-attribute-value-test.js should pass jshint.');
  });

});
define('morph-attr-tests/morph-attr.jshint', function () {

  'use strict';

  QUnit.module('JSHint - morph-attr-tests');
  QUnit.test('morph-attr-tests/morph-attr.js should pass jshint', function (assert) {
    assert.ok(true, 'morph-attr-tests/morph-attr.js should pass jshint.');
  });

});
define('morph-attr-tests/morph-attr/sanitize-attribute-value.jshint', function () {

  'use strict';

  QUnit.module('JSHint - morph-attr-tests/morph-attr');
  QUnit.test('morph-attr-tests/morph-attr/sanitize-attribute-value.js should pass jshint', function (assert) {
    assert.ok(true, 'morph-attr-tests/morph-attr/sanitize-attribute-value.js should pass jshint.');
  });

});