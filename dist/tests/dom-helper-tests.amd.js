define('dom-helper-tests/dom-helper-node-test', ['../dom-helper'], function (DOMHelper) {

  'use strict';

  var dom;

  QUnit.module('DOM Helper (Node)', {
    afterEach: function () {
      dom = null;
    }
  });

  if (typeof document === 'undefined') {
    test('it throws when instantiated without document', function () {
      var throws = false;
      try {
        dom = new DOMHelper['default']();
      } catch (e) {
        throws = true;
      }
      ok(throws, 'dom helper cannot instantiate');
    });
  }

  test('it instantiates with a stub document', function () {
    var called = false;
    var element = {};
    var doc = {
      createElement: function () {
        called = true;
        return element;
      }
    };
    dom = new DOMHelper['default'](doc);
    ok(dom, 'dom helper can instantiate');
    var createdElement = dom.createElement('div');
    equal(createdElement, element, 'dom helper calls passed stub');
  });

});
define('dom-helper-tests/dom-helper-node-test.jshint', function () {

  'use strict';

  QUnit.module('JSHint - dom-helper-tests');
  QUnit.test('dom-helper-tests/dom-helper-node-test.js should pass jshint', function (assert) {
    assert.ok(true, 'dom-helper-tests/dom-helper-node-test.js should pass jshint.');
  });

});
define('dom-helper-tests/dom-helper-test', ['../dom-helper', '../htmlbars-test-helpers'], function (DOMHelper, htmlbars_test_helpers) {

  'use strict';

  var xhtmlNamespace = "http://www.w3.org/1999/xhtml",
      xlinkNamespace = "http://www.w3.org/1999/xlink",
      svgNamespace = "http://www.w3.org/2000/svg";

  var foreignNamespaces = ['foreignObject', 'desc', 'title'];

  var dom, i, foreignNamespace;

  // getAttributes may return null or "" for nonexistent attributes,
  // depending on the browser.  So we find it out here and use it later.
  var disabledAbsentValue = (function () {
    var div = document.createElement("input");
    return div.getAttribute("disabled");
  })();

  QUnit.module('DOM Helper', {
    beforeEach: function () {
      dom = new DOMHelper['default']();
    },
    afterEach: function () {
      dom = null;
    }
  });

  test('#createElement', function () {
    var node = dom.createElement('div');
    equal(node.tagName, 'DIV');
    htmlbars_test_helpers.equalHTML(node, '<div></div>');
  });

  test('#childAtIndex', function () {
    var node = dom.createElement('div');

    var child1 = dom.createElement('p');
    var child2 = dom.createElement('img');

    strictEqual(dom.childAtIndex(node, 0), null);
    strictEqual(dom.childAtIndex(node, 1), null);
    strictEqual(dom.childAtIndex(node, 2), null);

    dom.appendChild(node, child1);
    strictEqual(dom.childAtIndex(node, 0).tagName, 'P');
    strictEqual(dom.childAtIndex(node, 1), null);
    strictEqual(dom.childAtIndex(node, 2), null);

    dom.insertBefore(node, child2, child1);
    strictEqual(dom.childAtIndex(node, 0).tagName, 'IMG');
    strictEqual(dom.childAtIndex(node, 1).tagName, 'P');
    strictEqual(dom.childAtIndex(node, 2), null);
  });

  test('#appendText adds text', function () {
    var node = dom.createElement('div');
    var text = dom.appendText(node, 'Howdy');
    ok(!!text, 'returns node');
    htmlbars_test_helpers.equalHTML(node, '<div>Howdy</div>');
  });

  test('#setAttribute', function () {
    var node = dom.createElement('div');
    dom.setAttribute(node, 'id', 'super-tag');
    htmlbars_test_helpers.equalHTML(node, '<div id="super-tag"></div>');
    dom.setAttribute(node, 'id', null);
    htmlbars_test_helpers.equalHTML(node, '<div id="null"></div>');

    node = dom.createElement('input');
    ok(node.getAttribute('disabled') === disabledAbsentValue, 'precond: disabled is absent');
    dom.setAttribute(node, 'disabled', true);
    ok(node.getAttribute('disabled') !== disabledAbsentValue, 'disabled set to true is present');
    dom.setAttribute(node, 'disabled', false);
    ok(node.getAttribute('disabled') !== disabledAbsentValue, 'disabled set to false is present');
  });

  test('#setAttributeNS', function () {
    var node = dom.createElement('svg');
    dom.setAttributeNS(node, xlinkNamespace, 'xlink:href', 'super-fun');
    // chrome adds (xmlns:xlink="http://www.w3.org/1999/xlink") property while others don't
    // thus equalHTML is not useful
    var el = document.createElement('div');
    el.appendChild(node);
    // phantomjs omits the prefix, thus we can't find xlink:
    ok(el.innerHTML.indexOf('href="super-fun"') > 0);
    dom.setAttributeNS(node, xlinkNamespace, 'href', null);

    ok(el.innerHTML.indexOf('href="null"') > 0);
  });

  test('#getElementById', function () {
    var parentNode = dom.createElement('div'),
        childNode = dom.createElement('div');
    dom.setAttribute(parentNode, 'id', 'parent');
    dom.setAttribute(childNode, 'id', 'child');
    dom.appendChild(parentNode, childNode);
    dom.document.body.appendChild(parentNode);
    htmlbars_test_helpers.equalHTML(dom.getElementById('child'), '<div id="child"></div>');
    dom.document.body.removeChild(parentNode);
  });

  test('#setPropertyStrict', function () {
    var node = dom.createElement('div');
    dom.setPropertyStrict(node, 'id', 'super-tag');
    htmlbars_test_helpers.equalHTML(node, '<div id="super-tag"></div>');

    node = dom.createElement('input');
    ok(node.getAttribute('disabled') === disabledAbsentValue, 'precond: disabled is absent');
    dom.setPropertyStrict(node, 'disabled', true);
    ok(node.getAttribute('disabled') !== disabledAbsentValue, 'disabled is present');
    dom.setPropertyStrict(node, 'disabled', false);
    ok(node.getAttribute('disabled') === disabledAbsentValue, 'disabled has been removed');
  });

  // IE dislikes undefined or null for value
  test('#setPropertyStrict value', function () {
    var node = dom.createElement('input');
    dom.setPropertyStrict(node, 'value', undefined);
    equal(node.value, '', 'blank string is set for undefined');
    dom.setPropertyStrict(node, 'value', null);
    equal(node.value, '', 'blank string is set for undefined');
  });

  // IE dislikes undefined or null for type
  test('#setPropertyStrict type', function () {
    var node = dom.createElement('input');
    dom.setPropertyStrict(node, 'type', undefined);
    equal(node.type, 'text', 'text default is set for undefined');
    dom.setPropertyStrict(node, 'type', null);
    equal(node.type, 'text', 'text default is set for undefined');
  });

  // setting undefined or null to src makes a network request
  test('#setPropertyStrict src', function () {
    var node = dom.createElement('img');
    dom.setPropertyStrict(node, 'src', undefined);
    notEqual(node.src, undefined, 'blank string is set for undefined');
    dom.setPropertyStrict(node, 'src', null);
    notEqual(node.src, null, 'blank string is set for undefined');
  });

  test('#removeAttribute', function () {
    var node = dom.createElement('div');
    dom.setAttribute(node, 'id', 'super-tag');
    htmlbars_test_helpers.equalHTML(node, '<div id="super-tag"></div>', 'precond - attribute exists');

    dom.removeAttribute(node, 'id');
    htmlbars_test_helpers.equalHTML(node, '<div></div>', 'attribute was removed');
  });

  test('#removeAttribute of SVG', function () {
    dom.setNamespace(svgNamespace);
    var node = dom.createElement('svg');
    dom.setAttribute(node, 'viewBox', '0 0 100 100');
    htmlbars_test_helpers.equalHTML(node, '<svg viewBox="0 0 100 100"></svg>', 'precond - attribute exists');

    dom.removeAttribute(node, 'viewBox');
    htmlbars_test_helpers.equalHTML(node, '<svg></svg>', 'attribute was removed');
  });

  test('#setProperty', function () {
    var node = dom.createElement('div');
    dom.setProperty(node, 'id', 'super-tag');
    htmlbars_test_helpers.equalHTML(node, '<div id="super-tag"></div>');
    dom.setProperty(node, 'id', null);
    ok(node.getAttribute('id') !== 'super-tag', 'null property sets to the property');

    node = dom.createElement('div');
    dom.setProperty(node, 'data-fun', 'whoopie');
    htmlbars_test_helpers.equalHTML(node, '<div data-fun="whoopie"></div>');
    dom.setProperty(node, 'data-fun', null);
    htmlbars_test_helpers.equalHTML(node, '<div></div>', 'null attribute removes the attribute');

    node = dom.createElement('input');
    dom.setProperty(node, 'disabled', true);
    equal(node.disabled, true);
    dom.setProperty(node, 'disabled', false);
    equal(node.disabled, false);

    node = dom.createElement('div');
    dom.setProperty(node, 'style', 'color: red;');
    htmlbars_test_helpers.equalHTML(node, '<div style="color: red;"></div>');
  });

  test('#setProperty removes attr with undefined', function () {
    var node = dom.createElement('div');
    dom.setProperty(node, 'data-fun', 'whoopie');
    htmlbars_test_helpers.equalHTML(node, '<div data-fun="whoopie"></div>');
    dom.setProperty(node, 'data-fun', undefined);
    htmlbars_test_helpers.equalHTML(node, '<div></div>', 'undefined attribute removes the attribute');
  });

  test('#setProperty uses setAttribute for special non-compliant element props', function () {
    expect(6);

    var badPairs = [{ tagName: 'button', key: 'type', value: 'submit', selfClosing: false }, { tagName: 'input', key: 'type', value: 'x-not-supported', selfClosing: true }];

    badPairs.forEach(function (pair) {
      var node = dom.createElement(pair.tagName);
      var setAttribute = node.setAttribute;

      node.setAttribute = function (attrName, value) {
        equal(attrName, pair.key, 'setAttribute called with correct attrName');
        equal(value, pair.value, 'setAttribute called with correct value');
        return setAttribute.call(this, attrName, value);
      };

      dom.setProperty(node, pair.key, pair.value);

      // e.g. <button type="submit"></button>
      var expected = '<' + pair.tagName + ' ' + pair.key + '="' + pair.value + '">';
      if (pair.selfClosing === false) {
        expected += '</' + pair.tagName + '>';
      }

      htmlbars_test_helpers.equalHTML(node, expected, 'output html is correct');
    });
  });

  test('#addClasses', function () {
    var node = dom.createElement('div');
    dom.addClasses(node, ['super-fun']);
    equal(node.className, 'super-fun');
    dom.addClasses(node, ['super-fun']);
    equal(node.className, 'super-fun');
    dom.addClasses(node, ['super-blast']);
    equal(node.className, 'super-fun super-blast');
    dom.addClasses(node, ['bacon', 'ham']);
    equal(node.className, 'super-fun super-blast bacon ham');
  });

  test('#removeClasses', function () {
    var node = dom.createElement('div');
    node.setAttribute('class', 'this-class that-class');
    dom.removeClasses(node, ['this-class']);
    equal(node.className, 'that-class');
    dom.removeClasses(node, ['this-class']);
    equal(node.className, 'that-class');
    dom.removeClasses(node, ['that-class']);
    equal(node.className, '');
    node.setAttribute('class', 'woop moop jeep');
    dom.removeClasses(node, ['moop', 'jeep']);
    equal(node.className, 'woop');
  });

  test('#createElement of tr with contextual table element', function () {
    var tableElement = document.createElement('table'),
        node = dom.createElement('tr', tableElement);
    equal(node.tagName, 'TR');
    htmlbars_test_helpers.equalHTML(node, '<tr></tr>');
  });

  test('#createMorph has optional contextualElement', function () {
    var parent = document.createElement('div'),
        fragment = document.createDocumentFragment(),
        start = document.createTextNode(''),
        end = document.createTextNode(''),
        morph,
        thrown;

    try {
      morph = dom.createMorph(fragment, start, end, fragment);
    } catch (e) {
      thrown = true;
    }
    ok(thrown, 'Exception thrown when a fragment is provided for contextualElement');

    morph = dom.createMorph(fragment, start, end, parent);
    equal(morph.contextualElement, parent, "morph's contextualElement is parent");

    morph = dom.createMorph(parent, start, end);
    equal(morph.contextualElement, parent, "morph's contextualElement is parent");
  });

  test('#appendMorph', function () {
    var element = document.createElement('div');

    dom.appendText(element, 'a');
    var morph = dom.appendMorph(element);
    dom.appendText(element, 'c');

    morph.setContent('b');

    equal(element.innerHTML, 'abc');
  });

  test('#insertMorphBefore', function () {
    var element = document.createElement('div');

    dom.appendText(element, 'a');
    var c = dom.appendText(element, 'c');
    var morph = dom.insertMorphBefore(element, c);

    morph.setContent('b');

    equal(element.innerHTML, 'abc');
  });

  test('#parseHTML combinations', function () {
    var parsingCombinations = [
    // omitted start tags
    //
    ['table', '<tr><td>Yo</td></tr>', 'TR'], ['table', '<tbody><tr></tr></tbody>', 'TBODY'], ['table', '<col></col>', 'COL'],
    // elements with broken innerHTML in IE9 and down
    ['select', '<option></option>', 'OPTION'], ['colgroup', '<col></col>', 'COL'], ['tbody', '<tr></tr>', 'TR'], ['tfoot', '<tr></tr>', 'TR'], ['thead', '<tr></tr>', 'TR'], ['tr', '<td></td>', 'TD'], ['div', '<script></script>', 'SCRIPT']];

    var contextTag, content, expectedTagName, contextElement, nodes;
    for (var p = 0; p < parsingCombinations.length; p++) {
      contextTag = parsingCombinations[p][0];
      content = parsingCombinations[p][1];
      expectedTagName = parsingCombinations[p][2];

      contextElement = document.createElement(contextTag);
      nodes = dom.parseHTML(content, contextElement).childNodes;
      equal(nodes[0].tagName, expectedTagName, '#parseHTML of ' + content + ' returns a ' + expectedTagName + ' inside a ' + contextTag + ' context');
    }
  });

  test('#parseHTML of script then tr inside table context wraps the tr in a tbody', function () {
    var tableElement = document.createElement('table'),
        nodes = dom.parseHTML('<script></script><tr><td>Yo</td></tr>', tableElement).childNodes;
    // The HTML spec suggests the first item must be the child of
    // the omittable start tag. Here script is the first child, so no-go.
    equal(nodes.length, 2, 'Leading script tag corrupts');
    equal(nodes[0].tagName, 'SCRIPT');
    equal(nodes[1].tagName, 'TBODY');
  });

  test('#parseHTML of select allows the initial implicit option selection to remain', function () {
    var div = document.createElement('div');
    var select = dom.parseHTML('<select><option></option></select>', div).childNodes[0];

    ok(select.childNodes[0].selected, 'first element is selected');
  });

  test('#parseHTML of options removes an implicit selection', function () {
    var select = document.createElement('select');
    var options = dom.parseHTML('<option value="1"></option><option value="2"></option>', select).childNodes;

    ok(!options[0].selected, 'first element is not selected');
    ok(!options[1].selected, 'second element is not selected');
  });

  test('#parseHTML of options leaves an explicit first selection', function () {
    var select = document.createElement('select');
    var options = dom.parseHTML('<option value="1" selected></option><option value="2"></option>', select).childNodes;

    ok(options[0].selected, 'first element is selected');
    ok(!options[1].selected, 'second element is not selected');
  });

  test('#parseHTML of options leaves an explicit second selection', function () {
    var select = document.createElement('select');
    var options = dom.parseHTML('<option value="1"></option><option value="2" selected="selected"></option>', select).childNodes;

    ok(!options[0].selected, 'first element is not selected');
    ok(options[1].selected, 'second element is selected');
  });

  test('#parseHTML of script then tr inside tbody context', function () {
    var tbodyElement = document.createElement('tbody'),
        nodes = dom.parseHTML('<script></script><tr><td>Yo</td></tr>', tbodyElement).childNodes;
    equal(nodes.length, 2, 'Leading script tag corrupts');
    equal(nodes[0].tagName, 'SCRIPT');
    equal(nodes[1].tagName, 'TR');
  });

  test('#parseHTML with retains whitespace', function () {
    var div = document.createElement('div');
    var nodes = dom.parseHTML('leading<script id="first"></script> <script id="second"></script><div><script></script> <script></script>, indeed.</div>', div).childNodes;
    equal(nodes[0].data, 'leading');
    equal(nodes[1].tagName, 'SCRIPT');
    equal(nodes[2].data, ' ');
    equal(nodes[3].tagName, 'SCRIPT');
    equal(nodes[4].tagName, 'DIV');
    equal(nodes[4].childNodes[0].tagName, 'SCRIPT');
    equal(nodes[4].childNodes[1].data, ' ');
    equal(nodes[4].childNodes[2].tagName, 'SCRIPT');
    equal(nodes[4].childNodes[3].data, ', indeed.');
  });

  test('#parseHTML with retains whitespace of top element', function () {
    var div = document.createElement('div');
    var nodes = dom.parseHTML('<span>hello <script id="first"></script> yeah</span>', div).childNodes;
    equal(nodes[0].tagName, 'SPAN');
    htmlbars_test_helpers.equalHTML(nodes, '<span>hello <script id="first"></script> yeah</span>');
  });

  test('#parseHTML with retains whitespace after script', function () {
    var div = document.createElement('div');
    var nodes = dom.parseHTML('<span>hello</span><script id="first"></script><span><script></script> kwoop</span>', div).childNodes;
    equal(nodes[0].tagName, 'SPAN');
    equal(nodes[1].tagName, 'SCRIPT');
    equal(nodes[2].tagName, 'SPAN');
    htmlbars_test_helpers.equalHTML(nodes, '<span>hello</span><script id="first"></script><span><script></script> kwoop</span>');
  });

  test('#parseHTML of number', function () {
    var div = document.createElement('div');
    var nodes = dom.parseHTML(5, div).childNodes;
    equal(nodes[0].data, '5');
    htmlbars_test_helpers.equalHTML(nodes, '5');
  });

  test('#protocolForURL', function () {
    var protocol = dom.protocolForURL("http://www.emberjs.com");
    equal(protocol, "http:");

    // Inherit protocol from document if unparseable
    protocol = dom.protocolForURL("   javascript:lulzhacked()");
    /*jshint scripturl:true*/
    equal(protocol, "javascript:");
  });

  test('#cloneNode shallow', function () {
    var divElement = document.createElement('div');

    divElement.appendChild(document.createElement('span'));

    var node = dom.cloneNode(divElement, false);

    equal(node.tagName, 'DIV');
    htmlbars_test_helpers.equalHTML(node, '<div></div>');
  });

  test('#cloneNode deep', function () {
    var divElement = document.createElement('div');

    divElement.appendChild(document.createElement('span'));

    var node = dom.cloneNode(divElement, true);

    equal(node.tagName, 'DIV');
    htmlbars_test_helpers.equalHTML(node, '<div><span></span></div>');
  });

  test('dom node has empty text after cloning and ensuringBlankTextNode', function () {
    var div = document.createElement('div');

    div.appendChild(document.createTextNode(''));

    var clonedDiv = dom.cloneNode(div, true);

    equal(clonedDiv.nodeType, 1);
    htmlbars_test_helpers.equalHTML(clonedDiv, '<div></div>');
    // IE's native cloneNode drops blank string text
    // nodes. Assert repairClonedNode brings back the blank
    // text node.
    dom.repairClonedNode(clonedDiv, [0]);
    equal(clonedDiv.childNodes.length, 1);
    equal(clonedDiv.childNodes[0].nodeType, 3);
  });

  test('dom node has empty start text after cloning and ensuringBlankTextNode', function () {
    var div = document.createElement('div');

    div.appendChild(document.createTextNode(''));
    div.appendChild(document.createElement('span'));

    var clonedDiv = dom.cloneNode(div, true);

    equal(clonedDiv.nodeType, 1);
    htmlbars_test_helpers.equalHTML(clonedDiv, '<div><span></span></div>');
    // IE's native cloneNode drops blank string text
    // nodes. Assert denormalizeText brings back the blank
    // text node.
    dom.repairClonedNode(clonedDiv, [0]);
    equal(clonedDiv.childNodes.length, 2);
    equal(clonedDiv.childNodes[0].nodeType, 3);
  });

  test('dom node checked after cloning and ensuringChecked', function () {
    var input = document.createElement('input');

    input.setAttribute('checked', 'checked');
    ok(input.checked, 'input is checked');

    var clone = dom.cloneNode(input, false);

    // IE's native cloneNode copies checked attributes but
    // not the checked property of the DOM node.
    dom.repairClonedNode(clone, [], true);

    htmlbars_test_helpers.isCheckedInputHTML(clone, '<input checked="checked">');
    ok(clone.checked, 'clone is checked');
  });

  if ('namespaceURI' in document.createElement('div')) {

    QUnit.module('DOM Helper namespaces', {
      beforeEach: function () {
        dom = new DOMHelper['default']();
      },
      afterEach: function () {
        dom = null;
      }
    });

    test('#createElement div is xhtml', function () {
      var node = dom.createElement('div');
      equal(node.namespaceURI, xhtmlNamespace);
    });

    test('#createElement of svg with svg namespace', function () {
      dom.setNamespace(svgNamespace);
      var node = dom.createElement('svg');
      equal(node.tagName, 'svg');
      equal(node.namespaceURI, svgNamespace);
    });

    test('#createElement of path with detected svg contextual element', function () {
      dom.setNamespace(svgNamespace);
      var node = dom.createElement('path');
      equal(node.tagName, 'path');
      equal(node.namespaceURI, svgNamespace);
    });

    test('#createElement of path with svg contextual element', function () {
      var node = dom.createElement('path', document.createElementNS(svgNamespace, 'svg'));
      equal(node.tagName, 'path');
      equal(node.namespaceURI, svgNamespace);
    });

    test('#createElement of svg with div namespace', function () {
      var node = dom.createElement('svg', document.createElement('div'));
      equal(node.tagName, 'svg');
      equal(node.namespaceURI, svgNamespace);
    });

    test('#getElementById with different root node', function () {
      var doc = document.implementation.createDocument(xhtmlNamespace, 'html', null),
          body = document.createElementNS(xhtmlNamespace, 'body'),
          parentNode = dom.createElement('div'),
          childNode = dom.createElement('div');

      doc.documentElement.appendChild(body);
      dom.setAttribute(parentNode, 'id', 'parent');
      dom.setAttribute(childNode, 'id', 'child');
      dom.appendChild(parentNode, childNode);
      dom.appendChild(body, parentNode);
      htmlbars_test_helpers.equalHTML(dom.getElementById('child', doc), '<div id="child"></div>');
    });

    test('#setProperty with namespaced attributes', function () {
      var node;

      dom.setNamespace(svgNamespace);
      node = dom.createElement('svg');
      dom.setProperty(node, 'viewBox', '0 0 0 0');
      htmlbars_test_helpers.equalHTML(node, '<svg viewBox="0 0 0 0"></svg>');

      dom.setProperty(node, 'xlink:title', 'super-blast', xlinkNamespace);
      // chrome adds (xmlns:xlink="http://www.w3.org/1999/xlink") property while others don't
      // thus equalHTML is not useful
      var el = document.createElement('div');
      el.appendChild(node);
      // phantom js omits the prefix so we can't look for xlink:
      ok(el.innerHTML.indexOf('title="super-blast"') > 0);

      dom.setProperty(node, 'xlink:title', null, xlinkNamespace);
      equal(node.getAttribute('xlink:title'), null, 'ns attr is removed');
    });

    test("#setProperty removes namespaced attr with undefined", function () {
      var node;

      node = dom.createElement('svg');
      dom.setProperty(node, 'xlink:title', 'Great Title', xlinkNamespace);
      dom.setProperty(node, 'xlink:title', undefined, xlinkNamespace);
      equal(node.getAttribute('xlink:title'), undefined, 'ns attr is removed');
    });

    for (i = 0; i < foreignNamespaces.length; i++) {
      foreignNamespace = foreignNamespaces[i];

      test('#createElement of div with ' + foreignNamespace + ' contextual element', function () {
        var node = dom.createElement('div', document.createElementNS(svgNamespace, foreignNamespace));
        equal(node.tagName, 'DIV');
        equal(node.namespaceURI, xhtmlNamespace);
      }); // jshint ignore:line

      test('#parseHTML of div with ' + foreignNamespace, function () {
        dom.setNamespace(xhtmlNamespace);
        var foreignObject = document.createElementNS(svgNamespace, foreignNamespace),
            nodes = dom.parseHTML('<div></div>', foreignObject).childNodes;
        equal(nodes[0].tagName, 'DIV');
        equal(nodes[0].namespaceURI, xhtmlNamespace);
      }); // jshint ignore:line
    }

    test('#parseHTML of path with svg contextual element', function () {
      dom.setNamespace(svgNamespace);
      var svgElement = document.createElementNS(svgNamespace, 'svg'),
          nodes = dom.parseHTML('<path></path>', svgElement).childNodes;
      equal(nodes[0].tagName, 'path');
      equal(nodes[0].namespaceURI, svgNamespace);
    });

    test('#parseHTML of stop with linearGradient contextual element', function () {
      dom.setNamespace(svgNamespace);
      var svgElement = document.createElementNS(svgNamespace, 'linearGradient'),
          nodes = dom.parseHTML('<stop />', svgElement).childNodes;
      equal(nodes[0].tagName, 'stop');
      equal(nodes[0].namespaceURI, svgNamespace);
    });

    test('#addClasses on SVG', function () {
      var node = document.createElementNS(svgNamespace, 'svg');
      dom.addClasses(node, ['super-fun']);
      equal(node.getAttribute('class'), 'super-fun');
      dom.addClasses(node, ['super-fun']);
      equal(node.getAttribute('class'), 'super-fun');
      dom.addClasses(node, ['super-blast']);
      equal(node.getAttribute('class'), 'super-fun super-blast');
    });

    test('#removeClasses on SVG', function () {
      var node = document.createElementNS(svgNamespace, 'svg');
      node.setAttribute('class', 'this-class that-class');
      dom.removeClasses(node, ['this-class']);
      equal(node.getAttribute('class'), 'that-class');
      dom.removeClasses(node, ['this-class']);
      equal(node.getAttribute('class'), 'that-class');
      dom.removeClasses(node, ['that-class']);
      equal(node.getAttribute('class'), '');
    });
  }

});
define('dom-helper-tests/dom-helper-test.jshint', function () {

  'use strict';

  QUnit.module('JSHint - dom-helper-tests');
  QUnit.test('dom-helper-tests/dom-helper-test.js should pass jshint', function (assert) {
    assert.ok(false, 'dom-helper-tests/dom-helper-test.js should pass jshint.\ndom-helper-tests/dom-helper-test.js: line 602, col 78, Functions declared within loops referencing an outer scoped variable may lead to confusing semantics.\ndom-helper-tests/dom-helper-test.js: line 608, col 52, Functions declared within loops referencing an outer scoped variable may lead to confusing semantics.\n\n2 errors');
  });

});
define('dom-helper-tests/dom-helper.jshint', function () {

  'use strict';

  QUnit.module('JSHint - dom-helper-tests');
  QUnit.test('dom-helper-tests/dom-helper.js should pass jshint', function (assert) {
    assert.ok(true, 'dom-helper-tests/dom-helper.js should pass jshint.');
  });

});
define('dom-helper-tests/dom-helper/build-html-dom.jshint', function () {

  'use strict';

  QUnit.module('JSHint - dom-helper-tests/dom-helper');
  QUnit.test('dom-helper-tests/dom-helper/build-html-dom.js should pass jshint', function (assert) {
    assert.ok(true, 'dom-helper-tests/dom-helper/build-html-dom.js should pass jshint.');
  });

});
define('dom-helper-tests/dom-helper/classes.jshint', function () {

  'use strict';

  QUnit.module('JSHint - dom-helper-tests/dom-helper');
  QUnit.test('dom-helper-tests/dom-helper/classes.js should pass jshint', function (assert) {
    assert.ok(true, 'dom-helper-tests/dom-helper/classes.js should pass jshint.');
  });

});
define('dom-helper-tests/dom-helper/prop.jshint', function () {

  'use strict';

  QUnit.module('JSHint - dom-helper-tests/dom-helper');
  QUnit.test('dom-helper-tests/dom-helper/prop.js should pass jshint', function (assert) {
    assert.ok(true, 'dom-helper-tests/dom-helper/prop.js should pass jshint.');
  });

});
define('dom-helper-tests/element-morph-test', ['../dom-helper'], function (DOMHelper) {

  'use strict';

  var dom;
  QUnit.module('DOM Helper: ElementMorph', {
    beforeEach: function () {
      dom = new DOMHelper['default']();
    },

    afterEach: function () {
      dom = null;
    }
  });

  test('contains a clear method', function () {
    expect(0);

    var el = dom.createElement('div');
    var node = dom.createElementMorph(el);

    node.clear();
  });

  test('resets element and dom on destroy', function () {
    expect(2);

    var el = dom.createElement('div');
    var node = dom.createElementMorph(el);

    node.destroy();

    equal(node.element, null, 'element was reset to null');
    equal(node.dom, null, 'dom was reset to null');
  });

});
define('dom-helper-tests/element-morph-test.jshint', function () {

  'use strict';

  QUnit.module('JSHint - dom-helper-tests');
  QUnit.test('dom-helper-tests/element-morph-test.js should pass jshint', function (assert) {
    assert.ok(true, 'dom-helper-tests/element-morph-test.js should pass jshint.');
  });

});
define('dom-helper-tests/prop-test', ['dom-helper/prop'], function (prop) {

  'use strict';

  QUnit.module('dom-helper prop');

  test('type.attr, for element props that for one reason or another need to be treated as attrs', function () {
    expect(12);

    [{ tagName: 'TEXTAREA', key: 'form' }, { tagName: 'BUTTON', key: 'type' }, { tagName: 'INPUT', key: 'type' }, { tagName: 'INPUT', key: 'list' }, { tagName: 'INPUT', key: 'form' }, { tagName: 'OPTION', key: 'form' }, { tagName: 'INPUT', key: 'form' }, { tagName: 'BUTTON', key: 'form' }, { tagName: 'LABEL', key: 'form' }, { tagName: 'FIELDSET', key: 'form' }, { tagName: 'LEGEND', key: 'form' }, { tagName: 'OBJECT', key: 'form' }].forEach(function (pair) {
      var element = {
        tagName: pair.tagName
      };

      Object.defineProperty(element, pair.key, {
        set: function () {
          throw new Error('I am a bad browser!');
        }
      });

      deepEqual(prop.normalizeProperty(element, pair.key), {
        normalized: pair.key,
        type: 'attr'
      }, ' ' + pair.tagName + '.' + pair.key);
    });
  });

  var TAG_EVENT_PAIRS = [{ tagName: 'form', key: 'onsubmit' }, { tagName: 'form', key: 'onSubmit' }, { tagName: 'form', key: 'ONSUBMIT' }, { tagName: 'video', key: 'canplay' }, { tagName: 'video', key: 'canPlay' }, { tagName: 'video', key: 'CANPLAY' }];

  test('type.eventHandlers should all be props: Chrome', function () {
    expect(6);
    TAG_EVENT_PAIRS.forEach(function (pair) {
      var element = {
        tagName: pair.tagName
      };

      Object.defineProperty(element, pair.key, {
        set: function () {},
        get: function () {}
      });

      deepEqual(prop.normalizeProperty(element, pair.key), {
        normalized: pair.key,
        type: 'prop'
      }, ' ' + pair.tagName + '.' + pair.key);
    });
  });

  test('type.eventHandlers should all be props: Safari style (which has screwed up stuff)', function () {
    expect(24);

    TAG_EVENT_PAIRS.forEach(function (pair) {
      var parent = {
        tagName: pair.tagName
      };

      Object.defineProperty(parent, pair.key, {
        set: undefined,
        get: undefined
      });

      var element = Object.create(parent);

      ok(Object.getOwnPropertyDescriptor(element, pair.key) === undefined, 'ensure we mimic silly safari');
      ok(Object.getOwnPropertyDescriptor(parent, pair.key).set === undefined, 'ensure we mimic silly safari');

      var _normalizeProperty = prop.normalizeProperty(element, pair.key);

      var normalized = _normalizeProperty.normalized;
      var type = _normalizeProperty.type;

      equal(normalized, pair.key, 'normalized: ' + pair.tagName + '.' + pair.key);
      equal(type, 'prop', 'type: ' + pair.tagName + '.' + pair.key);
    });
  });

});
define('dom-helper-tests/prop-test.jshint', function () {

  'use strict';

  QUnit.module('JSHint - dom-helper-tests');
  QUnit.test('dom-helper-tests/prop-test.js should pass jshint', function (assert) {
    assert.ok(true, 'dom-helper-tests/prop-test.js should pass jshint.');
  });

});
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