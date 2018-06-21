define('dom-helper', ['exports', './htmlbars-runtime/morph', './morph-attr', './dom-helper/build-html-dom', './dom-helper/classes', './dom-helper/prop'], function (exports, Morph, AttrMorph, build_html_dom, classes, prop) {

  'use strict';

  var doc = typeof document === 'undefined' ? false : document;

  var deletesBlankTextNodes = doc && (function (document) {
    var element = document.createElement('div');
    element.appendChild(document.createTextNode(''));
    var clonedElement = element.cloneNode(true);
    return clonedElement.childNodes.length === 0;
  })(doc);

  var ignoresCheckedAttribute = doc && (function (document) {
    var element = document.createElement('input');
    element.setAttribute('checked', 'checked');
    var clonedElement = element.cloneNode(false);
    return !clonedElement.checked;
  })(doc);

  var canRemoveSvgViewBoxAttribute = doc && (doc.createElementNS ? (function (document) {
    var element = document.createElementNS(build_html_dom.svgNamespace, 'svg');
    element.setAttribute('viewBox', '0 0 100 100');
    element.removeAttribute('viewBox');
    return !element.getAttribute('viewBox');
  })(doc) : true);

  var canClone = doc && (function (document) {
    var element = document.createElement('div');
    element.appendChild(document.createTextNode(' '));
    element.appendChild(document.createTextNode(' '));
    var clonedElement = element.cloneNode(true);
    return clonedElement.childNodes[0].nodeValue === ' ';
  })(doc);

  // This is not the namespace of the element, but of
  // the elements inside that elements.
  function interiorNamespace(element) {
    if (element && element.namespaceURI === build_html_dom.svgNamespace && !build_html_dom.svgHTMLIntegrationPoints[element.tagName]) {
      return build_html_dom.svgNamespace;
    } else {
      return null;
    }
  }

  // The HTML spec allows for "omitted start tags". These tags are optional
  // when their intended child is the first thing in the parent tag. For
  // example, this is a tbody start tag:
  //
  // <table>
  //   <tbody>
  //     <tr>
  //
  // The tbody may be omitted, and the browser will accept and render:
  //
  // <table>
  //   <tr>
  //
  // However, the omitted start tag will still be added to the DOM. Here
  // we test the string and context to see if the browser is about to
  // perform this cleanup.
  //
  // http://www.whatwg.org/specs/web-apps/current-work/multipage/syntax.html#optional-tags
  // describes which tags are omittable. The spec for tbody and colgroup
  // explains this behavior:
  //
  // http://www.whatwg.org/specs/web-apps/current-work/multipage/tables.html#the-tbody-element
  // http://www.whatwg.org/specs/web-apps/current-work/multipage/tables.html#the-colgroup-element
  //

  var omittedStartTagChildTest = /<([\w:]+)/;
  function detectOmittedStartTag(string, contextualElement) {
    // Omitted start tags are only inside table tags.
    if (contextualElement.tagName === 'TABLE') {
      var omittedStartTagChildMatch = omittedStartTagChildTest.exec(string);
      if (omittedStartTagChildMatch) {
        var omittedStartTagChild = omittedStartTagChildMatch[1];
        // It is already asserted that the contextual element is a table
        // and not the proper start tag. Just see if a tag was omitted.
        return omittedStartTagChild === 'tr' || omittedStartTagChild === 'col';
      }
    }
  }

  function buildSVGDOM(html, dom) {
    var div = dom.document.createElement('div');
    div.innerHTML = '<svg>' + html + '</svg>';
    return div.firstChild.childNodes;
  }

  var guid = 1;

  function ElementMorph(element, dom, namespace) {
    this.element = element;
    this.dom = dom;
    this.namespace = namespace;
    this.guid = "element" + guid++;

    this.state = {};
    this.isDirty = true;
  }

  // renderAndCleanup calls `clear` on all items in the morph map
  // just before calling `destroy` on the morph.
  //
  // As a future refactor this could be changed to set the property
  // back to its original/default value.
  ElementMorph.prototype.clear = function () {};

  ElementMorph.prototype.destroy = function () {
    this.element = null;
    this.dom = null;
  };

  /*
   * A class wrapping DOM functions to address environment compatibility,
   * namespaces, contextual elements for morph un-escaped content
   * insertion.
   *
   * When entering a template, a DOMHelper should be passed:
   *
   *   template(context, { hooks: hooks, dom: new DOMHelper() });
   *
   * TODO: support foreignObject as a passed contextual element. It has
   * a namespace (svg) that does not match its internal namespace
   * (xhtml).
   *
   * @class DOMHelper
   * @constructor
   * @param {HTMLDocument} _document The document DOM methods are proxied to
   */
  function DOMHelper(_document) {
    this.document = _document || document;
    if (!this.document) {
      throw new Error("A document object must be passed to the DOMHelper, or available on the global scope");
    }
    this.canClone = canClone;
    this.namespace = null;
  }

  var prototype = DOMHelper.prototype;
  prototype.constructor = DOMHelper;

  prototype.getElementById = function (id, rootNode) {
    rootNode = rootNode || this.document;
    return rootNode.getElementById(id);
  };

  prototype.insertBefore = function (element, childElement, referenceChild) {
    return element.insertBefore(childElement, referenceChild);
  };

  prototype.appendChild = function (element, childElement) {
    return element.appendChild(childElement);
  };

  prototype.childAt = function (element, indices) {
    var child = element;

    for (var i = 0; i < indices.length; i++) {
      child = child.childNodes.item(indices[i]);
    }

    return child;
  };

  // Note to a Fellow Implementor:
  // Ahh, accessing a child node at an index. Seems like it should be so simple,
  // doesn't it? Unfortunately, this particular method has caused us a surprising
  // amount of pain. As you'll note below, this method has been modified to walk
  // the linked list of child nodes rather than access the child by index
  // directly, even though there are two (2) APIs in the DOM that do this for us.
  // If you're thinking to yourself, "What an oversight! What an opportunity to
  // optimize this code!" then to you I say: stop! For I have a tale to tell.
  //
  // First, this code must be compatible with simple-dom for rendering on the
  // server where there is no real DOM. Previously, we accessed a child node
  // directly via `element.childNodes[index]`. While we *could* in theory do a
  // full-fidelity simulation of a live `childNodes` array, this is slow,
  // complicated and error-prone.
  //
  // "No problem," we thought, "we'll just use the similar
  // `childNodes.item(index)` API." Then, we could just implement our own `item`
  // method in simple-dom and walk the child node linked list there, allowing
  // us to retain the performance advantages of the (surely optimized) `item()`
  // API in the browser.
  //
  // Unfortunately, an enterprising soul named Samy Alzahrani discovered that in
  // IE8, accessing an item out-of-bounds via `item()` causes an exception where
  // other browsers return null. This necessitated a... check of
  // `childNodes.length`, bringing us back around to having to support a
  // full-fidelity `childNodes` array!
  //
  // Worst of all, Kris Selden investigated how browsers are actualy implemented
  // and discovered that they're all linked lists under the hood anyway. Accessing
  // `childNodes` requires them to allocate a new live collection backed by that
  // linked list, which is itself a rather expensive operation. Our assumed
  // optimization had backfired! That is the danger of magical thinking about
  // the performance of native implementations.
  //
  // And this, my friends, is why the following implementation just walks the
  // linked list, as surprised as that may make you. Please ensure you understand
  // the above before changing this and submitting a PR.
  //
  // Tom Dale, January 18th, 2015, Portland OR
  prototype.childAtIndex = function (element, index) {
    var node = element.firstChild;

    for (var idx = 0; node && idx < index; idx++) {
      node = node.nextSibling;
    }

    return node;
  };

  prototype.appendText = function (element, text) {
    return element.appendChild(this.document.createTextNode(text));
  };

  prototype.setAttribute = function (element, name, value) {
    element.setAttribute(name, String(value));
  };

  prototype.getAttribute = function (element, name) {
    return element.getAttribute(name);
  };

  prototype.setAttributeNS = function (element, namespace, name, value) {
    element.setAttributeNS(namespace, name, String(value));
  };

  prototype.getAttributeNS = function (element, namespace, name) {
    return element.getAttributeNS(namespace, name);
  };

  if (canRemoveSvgViewBoxAttribute) {
    prototype.removeAttribute = function (element, name) {
      element.removeAttribute(name);
    };
  } else {
    prototype.removeAttribute = function (element, name) {
      if (element.tagName === 'svg' && name === 'viewBox') {
        element.setAttribute(name, null);
      } else {
        element.removeAttribute(name);
      }
    };
  }

  prototype.setPropertyStrict = function (element, name, value) {
    if (value === undefined) {
      value = null;
    }

    if (value === null && (name === 'value' || name === 'type' || name === 'src')) {
      value = '';
    }

    element[name] = value;
  };

  prototype.getPropertyStrict = function (element, name) {
    return element[name];
  };

  prototype.setProperty = function (element, name, value, namespace) {
    var lowercaseName = name.toLowerCase();
    if (element.namespaceURI === build_html_dom.svgNamespace || lowercaseName === 'style') {
      if (prop.isAttrRemovalValue(value)) {
        element.removeAttribute(name);
      } else {
        if (namespace) {
          element.setAttributeNS(namespace, name, value);
        } else {
          element.setAttribute(name, value);
        }
      }
    } else {
      var _normalizeProperty = prop.normalizeProperty(element, name);

      var normalized = _normalizeProperty.normalized;
      var type = _normalizeProperty.type;

      if (type === 'prop') {
        element[normalized] = value;
      } else {
        if (prop.isAttrRemovalValue(value)) {
          element.removeAttribute(name);
        } else {
          if (namespace && element.setAttributeNS) {
            element.setAttributeNS(namespace, name, value);
          } else {
            element.setAttribute(name, value);
          }
        }
      }
    }
  };

  if (doc && doc.createElementNS) {
    // Only opt into namespace detection if a contextualElement
    // is passed.
    prototype.createElement = function (tagName, contextualElement) {
      var namespace = this.namespace;
      if (contextualElement) {
        if (tagName === 'svg') {
          namespace = build_html_dom.svgNamespace;
        } else {
          namespace = interiorNamespace(contextualElement);
        }
      }
      if (namespace) {
        return this.document.createElementNS(namespace, tagName);
      } else {
        return this.document.createElement(tagName);
      }
    };
    prototype.setAttributeNS = function (element, namespace, name, value) {
      element.setAttributeNS(namespace, name, String(value));
    };
  } else {
    prototype.createElement = function (tagName) {
      return this.document.createElement(tagName);
    };
    prototype.setAttributeNS = function (element, namespace, name, value) {
      element.setAttribute(name, String(value));
    };
  }

  prototype.addClasses = classes.addClasses;
  prototype.removeClasses = classes.removeClasses;

  prototype.setNamespace = function (ns) {
    this.namespace = ns;
  };

  prototype.detectNamespace = function (element) {
    this.namespace = interiorNamespace(element);
  };

  prototype.createDocumentFragment = function () {
    return this.document.createDocumentFragment();
  };

  prototype.createTextNode = function (text) {
    return this.document.createTextNode(text);
  };

  prototype.createComment = function (text) {
    return this.document.createComment(text);
  };

  prototype.repairClonedNode = function (element, blankChildTextNodes, isChecked) {
    if (deletesBlankTextNodes && blankChildTextNodes.length > 0) {
      for (var i = 0, len = blankChildTextNodes.length; i < len; i++) {
        var textNode = this.document.createTextNode(''),
            offset = blankChildTextNodes[i],
            before = this.childAtIndex(element, offset);
        if (before) {
          element.insertBefore(textNode, before);
        } else {
          element.appendChild(textNode);
        }
      }
    }
    if (ignoresCheckedAttribute && isChecked) {
      element.setAttribute('checked', 'checked');
    }
  };

  prototype.cloneNode = function (element, deep) {
    var clone = element.cloneNode(!!deep);
    return clone;
  };

  prototype.AttrMorphClass = AttrMorph['default'];

  prototype.createAttrMorph = function (element, attrName, namespace) {
    return new this.AttrMorphClass(element, attrName, this, namespace);
  };

  prototype.ElementMorphClass = ElementMorph;

  prototype.createElementMorph = function (element, namespace) {
    return new this.ElementMorphClass(element, this, namespace);
  };

  prototype.createUnsafeAttrMorph = function (element, attrName, namespace) {
    var morph = this.createAttrMorph(element, attrName, namespace);
    morph.escaped = false;
    return morph;
  };

  prototype.MorphClass = Morph['default'];

  prototype.createMorph = function (parent, start, end, contextualElement) {
    if (contextualElement && contextualElement.nodeType === 11) {
      throw new Error("Cannot pass a fragment as the contextual element to createMorph");
    }

    if (!contextualElement && parent && parent.nodeType === 1) {
      contextualElement = parent;
    }
    var morph = new this.MorphClass(this, contextualElement);
    morph.firstNode = start;
    morph.lastNode = end;
    return morph;
  };

  prototype.createFragmentMorph = function (contextualElement) {
    if (contextualElement && contextualElement.nodeType === 11) {
      throw new Error("Cannot pass a fragment as the contextual element to createMorph");
    }

    var fragment = this.createDocumentFragment();
    return Morph['default'].create(this, contextualElement, fragment);
  };

  prototype.replaceContentWithMorph = function (element) {
    var firstChild = element.firstChild;

    if (!firstChild) {
      var comment = this.createComment('');
      this.appendChild(element, comment);
      return Morph['default'].create(this, element, comment);
    } else {
      var morph = Morph['default'].attach(this, element, firstChild, element.lastChild);
      morph.clear();
      return morph;
    }
  };

  prototype.createUnsafeMorph = function (parent, start, end, contextualElement) {
    var morph = this.createMorph(parent, start, end, contextualElement);
    morph.parseTextAsHTML = true;
    return morph;
  };

  // This helper is just to keep the templates good looking,
  // passing integers instead of element references.
  prototype.createMorphAt = function (parent, startIndex, endIndex, contextualElement) {
    var single = startIndex === endIndex;
    var start = this.childAtIndex(parent, startIndex);
    var end = single ? start : this.childAtIndex(parent, endIndex);
    return this.createMorph(parent, start, end, contextualElement);
  };

  prototype.createUnsafeMorphAt = function (parent, startIndex, endIndex, contextualElement) {
    var morph = this.createMorphAt(parent, startIndex, endIndex, contextualElement);
    morph.parseTextAsHTML = true;
    return morph;
  };

  prototype.insertMorphBefore = function (element, referenceChild, contextualElement) {
    var insertion = this.document.createComment('');
    element.insertBefore(insertion, referenceChild);
    return this.createMorph(element, insertion, insertion, contextualElement);
  };

  prototype.appendMorph = function (element, contextualElement) {
    var insertion = this.document.createComment('');
    element.appendChild(insertion);
    return this.createMorph(element, insertion, insertion, contextualElement);
  };

  prototype.insertBoundary = function (fragment, index) {
    // this will always be null or firstChild
    var child = index === null ? null : this.childAtIndex(fragment, index);
    this.insertBefore(fragment, this.createTextNode(''), child);
  };

  prototype.setMorphHTML = function (morph, html) {
    morph.setHTML(html);
  };

  prototype.parseHTML = function (html, contextualElement) {
    var childNodes;

    if (interiorNamespace(contextualElement) === build_html_dom.svgNamespace) {
      childNodes = buildSVGDOM(html, this);
    } else {
      var nodes = build_html_dom.buildHTMLDOM(html, contextualElement, this);
      if (detectOmittedStartTag(html, contextualElement)) {
        var node = nodes[0];
        while (node && node.nodeType !== 1) {
          node = node.nextSibling;
        }
        childNodes = node.childNodes;
      } else {
        childNodes = nodes;
      }
    }

    // Copy node list to a fragment.
    var fragment = this.document.createDocumentFragment();

    if (childNodes && childNodes.length > 0) {
      var currentNode = childNodes[0];

      // We prepend an <option> to <select> boxes to absorb any browser bugs
      // related to auto-select behavior. Skip past it.
      if (contextualElement.tagName === 'SELECT') {
        currentNode = currentNode.nextSibling;
      }

      while (currentNode) {
        var tempNode = currentNode;
        currentNode = currentNode.nextSibling;

        fragment.appendChild(tempNode);
      }
    }

    return fragment;
  };

  var parsingNode;

  // Used to determine whether a URL needs to be sanitized.
  prototype.protocolForURL = function (url) {
    if (!parsingNode) {
      parsingNode = this.document.createElement('a');
    }

    parsingNode.href = url;
    return parsingNode.protocol;
  };

  exports['default'] = DOMHelper;

});
define('dom-helper.jshint', function () {

  'use strict';

  QUnit.module('JSHint - .');
  QUnit.test('dom-helper.js should pass jshint', function (assert) {
    assert.ok(true, 'dom-helper.js should pass jshint.');
  });

});
define('dom-helper/build-html-dom', ['exports'], function (exports) {

  'use strict';

  /* global XMLSerializer:false */
  var svgHTMLIntegrationPoints = { foreignObject: 1, desc: 1, title: 1 };
  var svgNamespace = 'http://www.w3.org/2000/svg';

  var doc = typeof document === 'undefined' ? false : document;

  // Safari does not like using innerHTML on SVG HTML integration
  // points (desc/title/foreignObject).
  var needsIntegrationPointFix = doc && (function (document) {
    if (document.createElementNS === undefined) {
      return;
    }
    // In FF title will not accept innerHTML.
    var testEl = document.createElementNS(svgNamespace, 'title');
    testEl.innerHTML = "<div></div>";
    return testEl.childNodes.length === 0 || testEl.childNodes[0].nodeType !== 1;
  })(doc);

  // Internet Explorer prior to 9 does not allow setting innerHTML if the first element
  // is a "zero-scope" element. This problem can be worked around by making
  // the first node an invisible text node. We, like Modernizr, use &shy;
  var needsShy = doc && (function (document) {
    var testEl = document.createElement('div');
    testEl.innerHTML = "<div></div>";
    testEl.firstChild.innerHTML = "<script><\/script>";
    return testEl.firstChild.innerHTML === '';
  })(doc);

  // IE 8 (and likely earlier) likes to move whitespace preceeding
  // a script tag to appear after it. This means that we can
  // accidentally remove whitespace when updating a morph.
  var movesWhitespace = doc && (function (document) {
    var testEl = document.createElement('div');
    testEl.innerHTML = "Test: <script type='text/x-placeholder'><\/script>Value";
    return testEl.childNodes[0].nodeValue === 'Test:' && testEl.childNodes[2].nodeValue === ' Value';
  })(doc);

  var tagNamesRequiringInnerHTMLFix = doc && (function (document) {
    var tagNamesRequiringInnerHTMLFix;
    // IE 9 and earlier don't allow us to set innerHTML on col, colgroup, frameset,
    // html, style, table, tbody, tfoot, thead, title, tr. Detect this and add
    // them to an initial list of corrected tags.
    //
    // Here we are only dealing with the ones which can have child nodes.
    //
    var tableNeedsInnerHTMLFix;
    var tableInnerHTMLTestElement = document.createElement('table');
    try {
      tableInnerHTMLTestElement.innerHTML = '<tbody></tbody>';
    } catch (e) {} finally {
      tableNeedsInnerHTMLFix = tableInnerHTMLTestElement.childNodes.length === 0;
    }
    if (tableNeedsInnerHTMLFix) {
      tagNamesRequiringInnerHTMLFix = {
        colgroup: ['table'],
        table: [],
        tbody: ['table'],
        tfoot: ['table'],
        thead: ['table'],
        tr: ['table', 'tbody']
      };
    }

    // IE 8 doesn't allow setting innerHTML on a select tag. Detect this and
    // add it to the list of corrected tags.
    //
    var selectInnerHTMLTestElement = document.createElement('select');
    selectInnerHTMLTestElement.innerHTML = '<option></option>';
    if (!selectInnerHTMLTestElement.childNodes[0]) {
      tagNamesRequiringInnerHTMLFix = tagNamesRequiringInnerHTMLFix || {};
      tagNamesRequiringInnerHTMLFix.select = [];
    }
    return tagNamesRequiringInnerHTMLFix;
  })(doc);

  function scriptSafeInnerHTML(element, html) {
    // without a leading text node, IE will drop a leading script tag.
    html = '&shy;' + html;

    element.innerHTML = html;

    var nodes = element.childNodes;

    // Look for &shy; to remove it.
    var shyElement = nodes[0];
    while (shyElement.nodeType === 1 && !shyElement.nodeName) {
      shyElement = shyElement.firstChild;
    }
    // At this point it's the actual unicode character.
    if (shyElement.nodeType === 3 && shyElement.nodeValue.charAt(0) === "\u00AD") {
      var newValue = shyElement.nodeValue.slice(1);
      if (newValue.length) {
        shyElement.nodeValue = shyElement.nodeValue.slice(1);
      } else {
        shyElement.parentNode.removeChild(shyElement);
      }
    }

    return nodes;
  }

  function buildDOMWithFix(html, contextualElement) {
    var tagName = contextualElement.tagName;

    // Firefox versions < 11 do not have support for element.outerHTML.
    var outerHTML = contextualElement.outerHTML || new XMLSerializer().serializeToString(contextualElement);
    if (!outerHTML) {
      throw "Can't set innerHTML on " + tagName + " in this browser";
    }

    html = fixSelect(html, contextualElement);

    var wrappingTags = tagNamesRequiringInnerHTMLFix[tagName.toLowerCase()];

    var startTag = outerHTML.match(new RegExp("<" + tagName + "([^>]*)>", 'i'))[0];
    var endTag = '</' + tagName + '>';

    var wrappedHTML = [startTag, html, endTag];

    var i = wrappingTags.length;
    var wrappedDepth = 1 + i;
    while (i--) {
      wrappedHTML.unshift('<' + wrappingTags[i] + '>');
      wrappedHTML.push('</' + wrappingTags[i] + '>');
    }

    var wrapper = document.createElement('div');
    scriptSafeInnerHTML(wrapper, wrappedHTML.join(''));
    var element = wrapper;
    while (wrappedDepth--) {
      element = element.firstChild;
      while (element && element.nodeType !== 1) {
        element = element.nextSibling;
      }
    }
    while (element && element.tagName !== tagName) {
      element = element.nextSibling;
    }
    return element ? element.childNodes : [];
  }

  var buildDOM;
  if (needsShy) {
    buildDOM = function buildDOM(html, contextualElement, dom) {
      html = fixSelect(html, contextualElement);

      contextualElement = dom.cloneNode(contextualElement, false);
      scriptSafeInnerHTML(contextualElement, html);
      return contextualElement.childNodes;
    };
  } else {
    buildDOM = function buildDOM(html, contextualElement, dom) {
      html = fixSelect(html, contextualElement);

      contextualElement = dom.cloneNode(contextualElement, false);
      contextualElement.innerHTML = html;
      return contextualElement.childNodes;
    };
  }

  function fixSelect(html, contextualElement) {
    if (contextualElement.tagName === 'SELECT') {
      html = "<option></option>" + html;
    }

    return html;
  }

  var buildIESafeDOM;
  if (tagNamesRequiringInnerHTMLFix || movesWhitespace) {
    buildIESafeDOM = function buildIESafeDOM(html, contextualElement, dom) {
      // Make a list of the leading text on script nodes. Include
      // script tags without any whitespace for easier processing later.
      var spacesBefore = [];
      var spacesAfter = [];
      if (typeof html === 'string') {
        html = html.replace(/(\s*)(<script)/g, function (match, spaces, tag) {
          spacesBefore.push(spaces);
          return tag;
        });

        html = html.replace(/(<\/script>)(\s*)/g, function (match, tag, spaces) {
          spacesAfter.push(spaces);
          return tag;
        });
      }

      // Fetch nodes
      var nodes;
      if (tagNamesRequiringInnerHTMLFix[contextualElement.tagName.toLowerCase()]) {
        // buildDOMWithFix uses string wrappers for problematic innerHTML.
        nodes = buildDOMWithFix(html, contextualElement);
      } else {
        nodes = buildDOM(html, contextualElement, dom);
      }

      // Build a list of script tags, the nodes themselves will be
      // mutated as we add test nodes.
      var i, j, node, nodeScriptNodes;
      var scriptNodes = [];
      for (i = 0; i < nodes.length; i++) {
        node = nodes[i];
        if (node.nodeType !== 1) {
          continue;
        }
        if (node.tagName === 'SCRIPT') {
          scriptNodes.push(node);
        } else {
          nodeScriptNodes = node.getElementsByTagName('script');
          for (j = 0; j < nodeScriptNodes.length; j++) {
            scriptNodes.push(nodeScriptNodes[j]);
          }
        }
      }

      // Walk the script tags and put back their leading text nodes.
      var scriptNode, textNode, spaceBefore, spaceAfter;
      for (i = 0; i < scriptNodes.length; i++) {
        scriptNode = scriptNodes[i];
        spaceBefore = spacesBefore[i];
        if (spaceBefore && spaceBefore.length > 0) {
          textNode = dom.document.createTextNode(spaceBefore);
          scriptNode.parentNode.insertBefore(textNode, scriptNode);
        }

        spaceAfter = spacesAfter[i];
        if (spaceAfter && spaceAfter.length > 0) {
          textNode = dom.document.createTextNode(spaceAfter);
          scriptNode.parentNode.insertBefore(textNode, scriptNode.nextSibling);
        }
      }

      return nodes;
    };
  } else {
    buildIESafeDOM = buildDOM;
  }

  var buildHTMLDOM;
  if (needsIntegrationPointFix) {
    buildHTMLDOM = function buildHTMLDOM(html, contextualElement, dom) {
      if (svgHTMLIntegrationPoints[contextualElement.tagName]) {
        return buildIESafeDOM(html, document.createElement('div'), dom);
      } else {
        return buildIESafeDOM(html, contextualElement, dom);
      }
    };
  } else {
    buildHTMLDOM = buildIESafeDOM;
  }

  exports.svgHTMLIntegrationPoints = svgHTMLIntegrationPoints;
  exports.svgNamespace = svgNamespace;
  exports.buildHTMLDOM = buildHTMLDOM;

});
define('dom-helper/build-html-dom.jshint', function () {

  'use strict';

  QUnit.module('JSHint - dom-helper');
  QUnit.test('dom-helper/build-html-dom.js should pass jshint', function (assert) {
    assert.ok(true, 'dom-helper/build-html-dom.js should pass jshint.');
  });

});
define('dom-helper/classes', ['exports'], function (exports) {

  'use strict';

  var doc = typeof document === 'undefined' ? false : document;

  // PhantomJS has a broken classList. See https://github.com/ariya/phantomjs/issues/12782
  var canClassList = doc && (function () {
    var d = document.createElement('div');
    if (!d.classList) {
      return false;
    }
    d.classList.add('boo');
    d.classList.add('boo', 'baz');
    return d.className === 'boo baz';
  })();

  function buildClassList(element) {
    var classString = element.getAttribute('class') || '';
    return classString !== '' && classString !== ' ' ? classString.split(' ') : [];
  }

  function intersect(containingArray, valuesArray) {
    var containingIndex = 0;
    var containingLength = containingArray.length;
    var valuesIndex = 0;
    var valuesLength = valuesArray.length;

    var intersection = new Array(valuesLength);

    // TODO: rewrite this loop in an optimal manner
    for (; containingIndex < containingLength; containingIndex++) {
      valuesIndex = 0;
      for (; valuesIndex < valuesLength; valuesIndex++) {
        if (valuesArray[valuesIndex] === containingArray[containingIndex]) {
          intersection[valuesIndex] = containingIndex;
          break;
        }
      }
    }

    return intersection;
  }

  function addClassesViaAttribute(element, classNames) {
    var existingClasses = buildClassList(element);

    var indexes = intersect(existingClasses, classNames);
    var didChange = false;

    for (var i = 0, l = classNames.length; i < l; i++) {
      if (indexes[i] === undefined) {
        didChange = true;
        existingClasses.push(classNames[i]);
      }
    }

    if (didChange) {
      element.setAttribute('class', existingClasses.length > 0 ? existingClasses.join(' ') : '');
    }
  }

  function removeClassesViaAttribute(element, classNames) {
    var existingClasses = buildClassList(element);

    var indexes = intersect(classNames, existingClasses);
    var didChange = false;
    var newClasses = [];

    for (var i = 0, l = existingClasses.length; i < l; i++) {
      if (indexes[i] === undefined) {
        newClasses.push(existingClasses[i]);
      } else {
        didChange = true;
      }
    }

    if (didChange) {
      element.setAttribute('class', newClasses.length > 0 ? newClasses.join(' ') : '');
    }
  }

  var addClasses, removeClasses;
  if (canClassList) {
    addClasses = function addClasses(element, classNames) {
      if (element.classList) {
        if (classNames.length === 1) {
          element.classList.add(classNames[0]);
        } else if (classNames.length === 2) {
          element.classList.add(classNames[0], classNames[1]);
        } else {
          element.classList.add.apply(element.classList, classNames);
        }
      } else {
        addClassesViaAttribute(element, classNames);
      }
    };
    removeClasses = function removeClasses(element, classNames) {
      if (element.classList) {
        if (classNames.length === 1) {
          element.classList.remove(classNames[0]);
        } else if (classNames.length === 2) {
          element.classList.remove(classNames[0], classNames[1]);
        } else {
          element.classList.remove.apply(element.classList, classNames);
        }
      } else {
        removeClassesViaAttribute(element, classNames);
      }
    };
  } else {
    addClasses = addClassesViaAttribute;
    removeClasses = removeClassesViaAttribute;
  }

  exports.addClasses = addClasses;
  exports.removeClasses = removeClasses;

});
define('dom-helper/classes.jshint', function () {

  'use strict';

  QUnit.module('JSHint - dom-helper');
  QUnit.test('dom-helper/classes.js should pass jshint', function (assert) {
    assert.ok(true, 'dom-helper/classes.js should pass jshint.');
  });

});
define('dom-helper/prop', ['exports'], function (exports) {

  'use strict';

  exports.isAttrRemovalValue = isAttrRemovalValue;
  exports.normalizeProperty = normalizeProperty;

  function isAttrRemovalValue(value) {
    return value === null || value === undefined;
  }

  /*
   *
   * @method normalizeProperty
   * @param element {HTMLElement}
   * @param slotName {String}
   * @returns {Object} { name, type }
   */

  function normalizeProperty(element, slotName) {
    var type, normalized;

    if (slotName in element) {
      normalized = slotName;
      type = 'prop';
    } else {
      var lower = slotName.toLowerCase();
      if (lower in element) {
        type = 'prop';
        normalized = lower;
      } else {
        type = 'attr';
        normalized = slotName;
      }
    }

    if (type === 'prop' && preferAttr(element.tagName, normalized)) {
      type = 'attr';
    }

    return { normalized: normalized, type: type };
  }

  // properties that MUST be set as attributes, due to:
  // * browser bug
  // * strange spec outlier
  var ATTR_OVERRIDES = {

    // phantomjs < 2.0 lets you set it as a prop but won't reflect it
    // back to the attribute. button.getAttribute('type') === null
    BUTTON: { type: true, form: true },

    INPUT: {
      // TODO: remove when IE8 is droped
      // Some versions of IE (IE8) throw an exception when setting
      // `input.list = 'somestring'`:
      // https://github.com/emberjs/ember.js/issues/10908
      // https://github.com/emberjs/ember.js/issues/11364
      list: true,
      // Some version of IE (like IE9) actually throw an exception
      // if you set input.type = 'something-unknown'
      type: true,
      form: true
    },

    // element.form is actually a legitimate readOnly property, that is to be
    // mutated, but must be mutated by setAttribute...
    SELECT: { form: true },
    OPTION: { form: true },
    TEXTAREA: { form: true },
    LABEL: { form: true },
    FIELDSET: { form: true },
    LEGEND: { form: true },
    OBJECT: { form: true }
  };

  function preferAttr(tagName, propName) {
    var tag = ATTR_OVERRIDES[tagName.toUpperCase()];
    return tag && tag[propName.toLowerCase()] || false;
  }

});
define('dom-helper/prop.jshint', function () {

  'use strict';

  QUnit.module('JSHint - dom-helper');
  QUnit.test('dom-helper/prop.js should pass jshint', function (assert) {
    assert.ok(true, 'dom-helper/prop.js should pass jshint.');
  });

});
define('htmlbars-compiler-tests/compile-tests', ['../htmlbars-compiler/compiler'], function (compiler) {

  'use strict';

  QUnit.module('compile: buildMeta');

  test('is merged into meta in template', function () {
    var template = compiler.compile('Hi, {{name}}!', {
      buildMeta: function () {
        return { blah: 'zorz' };
      }
    });

    equal(template.meta.blah, 'zorz', 'return value from buildMeta was pass through');
  });

  test('the program is passed to the callback function', function () {
    var template = compiler.compile('Hi, {{name}}!', {
      buildMeta: function (program) {
        return { loc: program.loc };
      }
    });

    equal(template.meta.loc.start.line, 1, 'the loc was passed through from program');
  });

  test('value keys are properly stringified', function () {
    var template = compiler.compile('Hi, {{name}}!', {
      buildMeta: function () {
        return { 'loc-derp.lol': 'zorz' };
      }
    });

    equal(template.meta['loc-derp.lol'], 'zorz', 'return value from buildMeta was pass through');
  });

  test('returning undefined does not throw errors', function () {
    var template = compiler.compile('Hi, {{name}}!', {
      buildMeta: function () {
        return;
      }
    });

    ok(template.meta, 'meta is present in template, even if empty');
  });

  test('options are not required for `compile`', function () {
    var template = compiler.compile('Hi, {{name}}!');

    ok(template.meta, 'meta is present in template, even if empty');
  });

});
define('htmlbars-compiler-tests/compile-tests.jshint', function () {

  'use strict';

  QUnit.module('JSHint - htmlbars-compiler-tests');
  QUnit.test('htmlbars-compiler-tests/compile-tests.js should pass jshint', function (assert) {
    assert.ok(true, 'htmlbars-compiler-tests/compile-tests.js should pass jshint.');
  });

});
define('htmlbars-compiler-tests/diffing-test', ['../htmlbars-compiler/compiler', '../htmlbars-runtime/hooks', '../htmlbars-util/object-utils', '../dom-helper', '../htmlbars-test-helpers'], function (compiler, defaultHooks, object_utils, DOMHelper, htmlbars_test_helpers) {

  'use strict';

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

    registerHelper('each', function (params) {
      var list = params[0];

      for (var i = 0, l = list.length; i < l; i++) {
        var item = list[i];
        if (this.arity > 0) {
          this.yieldItem(item.key, [item]);
        }
      }
    });
  }

  QUnit.module("Diffing", {
    beforeEach: commonSetup
  });

  test("Morph order is preserved when rerendering with duplicate keys", function () {
    var template = compiler.compile("<ul>{{#each items as |item|}}<li>{{item.name}}</li>{{/each}}</ul>");

    var a1 = { key: "a", name: "A1" };
    var a2 = { key: "a", name: "A2" };
    var b1 = { key: "b", name: "B1" };
    var b2 = { key: "b", name: "B2" };

    var result = template.render({ items: [a1, a2, b1, b2] }, env);
    htmlbars_test_helpers.equalTokens(result.fragment, "<ul><li>A1</li><li>A2</li><li>B1</li><li>B2</li></ul>");

    var morph = result.nodes[0].morphList.firstChildMorph;
    morph.state.initialName = 'A1';
    morph.nextMorph.state.initialName = 'A2';
    morph.nextMorph.nextMorph.state.initialName = 'B1';
    morph.nextMorph.nextMorph.nextMorph.state.initialName = 'B2';

    function getNames() {
      var names = [];
      var morph = result.nodes[0].morphList.firstChildMorph;

      while (morph) {
        names.push(morph.state.initialName);
        morph = morph.nextMorph;
      }

      return names;
    }

    result.rerender(env, { items: [a1, b2, b1, a2] });

    htmlbars_test_helpers.equalTokens(result.fragment, "<ul><li>A1</li><li>B2</li><li>B1</li><li>A2</li></ul>");
    deepEqual(getNames(), ['A1', 'B1', 'B2', 'A2']);

    result.rerender(env, { items: [b1, a2] });

    htmlbars_test_helpers.equalTokens(result.fragment, "<ul><li>B1</li><li>A2</li></ul>");
    deepEqual(getNames(), ['B1', 'A1']);
  });

  test("duplicate keys are allowed when duplicate is last morph", function () {
    var template = compiler.compile("<ul>{{#each items as |item|}}<li>{{item.name}}</li>{{/each}}</ul>");

    var a1 = { key: "a", name: "A1" };
    var a2 = { key: "a", name: "A2" };

    var result = template.render({ items: [] }, env);

    result.rerender(env, { items: [a1] });
    htmlbars_test_helpers.equalTokens(result.fragment, "<ul><li>A1</li></ul>");

    result.rerender(env, { items: [a1, a2] });
    htmlbars_test_helpers.equalTokens(result.fragment, "<ul><li>A1</li><li>A2</li></ul>");
  });

});
define('htmlbars-compiler-tests/diffing-test.jshint', function () {

  'use strict';

  QUnit.module('JSHint - htmlbars-compiler-tests');
  QUnit.test('htmlbars-compiler-tests/diffing-test.js should pass jshint', function (assert) {
    assert.ok(true, 'htmlbars-compiler-tests/diffing-test.js should pass jshint.');
  });

});
define('htmlbars-compiler-tests/dirtying-test', ['../htmlbars-compiler/compiler', '../htmlbars-runtime/render', '../htmlbars-runtime/hooks', '../htmlbars-util/template-utils', '../htmlbars-util/object-utils', '../dom-helper', '../htmlbars-test-helpers'], function (compiler, render, defaultHooks, template_utils, object_utils, DOMHelper, htmlbars_test_helpers) {

  'use strict';

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

});
define('htmlbars-compiler-tests/dirtying-test.jshint', function () {

  'use strict';

  QUnit.module('JSHint - htmlbars-compiler-tests');
  QUnit.test('htmlbars-compiler-tests/dirtying-test.js should pass jshint', function (assert) {
    assert.ok(false, 'htmlbars-compiler-tests/dirtying-test.js should pass jshint.\nhtmlbars-compiler-tests/dirtying-test.js: line 731, col 7, \'layout\' was used before it was defined.\n\n1 error');
  });

});
define('htmlbars-compiler-tests/fragment-test', ['../htmlbars-compiler/fragment-opcode-compiler', '../htmlbars-compiler/fragment-javascript-compiler', '../dom-helper', '../htmlbars-syntax/parser', '../htmlbars-test-helpers'], function (FragmentOpcodeCompiler, FragmentJavaScriptCompiler, DOMHelper, parser, htmlbars_test_helpers) {

  'use strict';

  var xhtmlNamespace = "http://www.w3.org/1999/xhtml",
      svgNamespace = "http://www.w3.org/2000/svg";

  function fragmentFor(ast) {
    /* jshint evil: true */
    var fragmentOpcodeCompiler = new FragmentOpcodeCompiler['default'](),
        fragmentCompiler = new FragmentJavaScriptCompiler['default']();

    var opcodes = fragmentOpcodeCompiler.compile(ast);
    var program = fragmentCompiler.compile(opcodes);

    var fn = new Function("dom", 'return ' + program)();

    return fn(new DOMHelper['default']());
  }

  QUnit.module('fragment');

  test('compiles a fragment', function () {
    var ast = parser.preprocess("<div>{{foo}} bar {{baz}}</div>");
    var divNode = fragmentFor(ast).firstChild;

    htmlbars_test_helpers.equalHTML(divNode, "<div><!----> bar <!----></div>");
  });

  if (document && document.createElementNS) {
    test('compiles an svg fragment', function () {
      var ast = parser.preprocess("<div><svg><circle/><foreignObject><span></span></foreignObject></svg></div>");
      var divNode = fragmentFor(ast).firstChild;

      equal(divNode.childNodes[0].namespaceURI, svgNamespace, 'svg has the right namespace');
      equal(divNode.childNodes[0].childNodes[0].namespaceURI, svgNamespace, 'circle has the right namespace');
      equal(divNode.childNodes[0].childNodes[1].namespaceURI, svgNamespace, 'foreignObject has the right namespace');
      equal(divNode.childNodes[0].childNodes[1].childNodes[0].namespaceURI, xhtmlNamespace, 'span has the right namespace');
    });
  }

  test('compiles an svg element with classes', function () {
    var ast = parser.preprocess('<svg class="red right hand"></svg>');
    var svgNode = fragmentFor(ast).firstChild;

    equal(svgNode.getAttribute('class'), 'red right hand');
  });

  if (document && document.createElementNS) {
    test('compiles an svg element with proper namespace', function () {
      var ast = parser.preprocess('<svg><use xlink:title="nice-title"></use></svg>');
      var svgNode = fragmentFor(ast).firstChild;

      equal(svgNode.childNodes[0].getAttributeNS('http://www.w3.org/1999/xlink', 'title'), 'nice-title');
      equal(svgNode.childNodes[0].attributes[0].namespaceURI, 'http://www.w3.org/1999/xlink');
      equal(svgNode.childNodes[0].attributes[0].name, 'xlink:title');
      equal(svgNode.childNodes[0].attributes[0].localName, 'title');
      equal(svgNode.childNodes[0].attributes[0].value, 'nice-title');
    });
  }

  test('converts entities to their char/string equivalent', function () {
    var ast = parser.preprocess("<div title=\"&quot;Foo &amp; Bar&quot;\">lol &lt; &#60;&#x3c; &#x3C; &LT; &NotGreaterFullEqual; &Borksnorlax;</div>");
    var divNode = fragmentFor(ast).firstChild;

    equal(divNode.getAttribute('title'), '"Foo & Bar"');
    equal(htmlbars_test_helpers.getTextContent(divNode), "lol < << < < ≧̸ &Borksnorlax;");
  });

});
define('htmlbars-compiler-tests/fragment-test.jshint', function () {

  'use strict';

  QUnit.module('JSHint - htmlbars-compiler-tests');
  QUnit.test('htmlbars-compiler-tests/fragment-test.js should pass jshint', function (assert) {
    assert.ok(true, 'htmlbars-compiler-tests/fragment-test.js should pass jshint.');
  });

});
define('htmlbars-compiler-tests/hooks-test', ['../htmlbars-compiler/compiler', '../htmlbars-runtime/hooks', '../htmlbars-util/object-utils', '../dom-helper', '../htmlbars-test-helpers'], function (compiler, defaultHooks, object_utils, DOMHelper, htmlbars_test_helpers) {

  'use strict';

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
  }

  QUnit.module("HTML-based compiler (dirtying)", {
    beforeEach: commonSetup
  });

  test("the invokeHelper hook gets invoked to call helpers", function () {
    hooks.getRoot = function (scope, key) {
      return [{ value: scope.self[key] }];
    };

    var invoked = false;
    hooks.invokeHelper = function (morph, env, scope, visitor, params, hash, helper, templates, context) {
      invoked = true;

      deepEqual(params, [{ value: "hello world" }]);
      ok(templates.template.yieldIn, "templates are passed");
      ok(scope.self, "the scope was passed");
      ok(morph.state, "the morph was passed");

      return { value: helper.call(context, [params[0].value], hash, templates) };
    };

    registerHelper('print', function (params) {
      return params.join('');
    });

    var object = { val: 'hello world' };
    var template = compiler.compile('<div>{{print val}}</div>');
    var result = template.render(object, env);

    htmlbars_test_helpers.equalTokens(result.fragment, '<div>hello world</div>');

    ok(invoked, "The invokeHelper hook was invoked");
  });

});
define('htmlbars-compiler-tests/hooks-test.jshint', function () {

  'use strict';

  QUnit.module('JSHint - htmlbars-compiler-tests');
  QUnit.test('htmlbars-compiler-tests/hooks-test.js should pass jshint', function (assert) {
    assert.ok(true, 'htmlbars-compiler-tests/hooks-test.js should pass jshint.');
  });

});
define('htmlbars-compiler-tests/html-compiler-test', ['../htmlbars-compiler/compiler', '../htmlbars-util/array-utils', '../htmlbars-runtime/hooks', '../htmlbars-util/object-utils', '../dom-helper', '../htmlbars-test-helpers'], function (compiler, array_utils, defaultHooks, object_utils, DOMHelper, htmlbars_test_helpers) {

  'use strict';

  var xhtmlNamespace = "http://www.w3.org/1999/xhtml",
      svgNamespace = "http://www.w3.org/2000/svg";

  var hooks, helpers, partials, env;

  function registerHelper(name, callback) {
    helpers[name] = callback;
  }

  function registerPartial(name, html) {
    partials[name] = compiler.compile(html);
  }

  function compilesTo(html, expected, context) {
    var template = compiler.compile(html);
    var fragment = template.render(context, env, { contextualElement: document.body }).fragment;
    htmlbars_test_helpers.equalTokens(fragment, expected === undefined ? html : expected);
    return fragment;
  }

  function commonSetup() {
    hooks = object_utils.merge({}, defaultHooks['default']);
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

  QUnit.module("HTML-based compiler (output)", {
    beforeEach: commonSetup
  });

  test("Simple content produces a document fragment", function () {
    var template = compiler.compile("content");
    var fragment = template.render({}, env).fragment;

    htmlbars_test_helpers.equalTokens(fragment, "content");
  });

  test("Simple elements are created", function () {
    var template = compiler.compile("<h1>hello!</h1><div>content</div>");
    var fragment = template.render({}, env).fragment;

    htmlbars_test_helpers.equalTokens(fragment, "<h1>hello!</h1><div>content</div>");
  });

  test("Simple elements can be re-rendered", function () {
    var template = compiler.compile("<h1>hello!</h1><div>content</div>");
    var result = template.render({}, env);
    var fragment = result.fragment;

    var oldFirstChild = fragment.firstChild;

    result.revalidate();

    strictEqual(fragment.firstChild, oldFirstChild);
    htmlbars_test_helpers.equalTokens(fragment, "<h1>hello!</h1><div>content</div>");
  });

  test("Simple elements can have attributes", function () {
    var template = compiler.compile("<div class='foo' id='bar'>content</div>");
    var fragment = template.render({}, env).fragment;

    htmlbars_test_helpers.equalTokens(fragment, '<div class="foo" id="bar">content</div>');
  });

  test("Simple elements can have an empty attribute", function () {
    var template = compiler.compile("<div class=''>content</div>");
    var fragment = template.render({}, env).fragment;

    htmlbars_test_helpers.equalTokens(fragment, '<div class="">content</div>');
  });

  test("presence of `disabled` attribute without value marks as disabled", function () {
    var template = compiler.compile('<input disabled>');
    var inputNode = template.render({}, env).fragment.firstChild;

    ok(inputNode.disabled, 'disabled without value set as property is true');
  });

  test("Null quoted attribute value calls toString on the value", function () {
    var template = compiler.compile('<input disabled="{{isDisabled}}">');
    var inputNode = template.render({ isDisabled: null }, env).fragment.firstChild;

    ok(inputNode.disabled, 'string of "null" set as property is true');
  });

  test("Null unquoted attribute value removes that attribute", function () {
    var template = compiler.compile('<input disabled={{isDisabled}}>');
    var inputNode = template.render({ isDisabled: null }, env).fragment.firstChild;

    htmlbars_test_helpers.equalTokens(inputNode, '<input>');
  });

  test("unquoted attribute string is just that", function () {
    var template = compiler.compile('<input value=funstuff>');
    var inputNode = template.render({}, env).fragment.firstChild;

    equal(inputNode.tagName, 'INPUT', 'input tag');
    equal(inputNode.value, 'funstuff', 'value is set as property');
  });

  test("unquoted attribute expression is string", function () {
    var template = compiler.compile('<input value={{funstuff}}>');
    var inputNode = template.render({ funstuff: "oh my" }, env).fragment.firstChild;

    equal(inputNode.tagName, 'INPUT', 'input tag');
    equal(inputNode.value, 'oh my', 'string is set to property');
  });

  test("unquoted attribute expression works when followed by another attribute", function () {
    var template = compiler.compile('<div foo={{funstuff}} name="Alice"></div>');
    var divNode = template.render({ funstuff: "oh my" }, env).fragment.firstChild;

    htmlbars_test_helpers.equalTokens(divNode, '<div name="Alice" foo="oh my"></div>');
  });

  test("Unquoted attribute value with multiple nodes throws an exception", function () {
    expect(4);

    QUnit.throws(function () {
      compiler.compile('<img class=foo{{bar}}>');
    }, expectedError(1));
    QUnit.throws(function () {
      compiler.compile('<img class={{foo}}{{bar}}>');
    }, expectedError(1));
    QUnit.throws(function () {
      compiler.compile('<img \nclass={{foo}}bar>');
    }, expectedError(2));
    QUnit.throws(function () {
      compiler.compile('<div \nclass\n=\n{{foo}}&amp;bar ></div>');
    }, expectedError(4));

    function expectedError(line) {
      return new Error("An unquoted attribute value must be a string or a mustache, " + "preceeded by whitespace or a '=' character, and " + ("followed by whitespace or a '>' character (on line " + line + ")"));
    }
  });

  test("Simple elements can have arbitrary attributes", function () {
    var template = compiler.compile("<div data-some-data='foo'>content</div>");
    var divNode = template.render({}, env).fragment.firstChild;
    htmlbars_test_helpers.equalTokens(divNode, '<div data-some-data="foo">content</div>');
  });

  test("checked attribute and checked property are present after clone and hydrate", function () {
    var template = compiler.compile("<input checked=\"checked\">");
    var inputNode = template.render({}, env).fragment.firstChild;
    equal(inputNode.tagName, 'INPUT', 'input tag');
    equal(inputNode.checked, true, 'input tag is checked');
  });

  function shouldBeVoid(tagName) {
    var html = "<" + tagName + " data-foo='bar'><p>hello</p>";
    var template = compiler.compile(html);
    var fragment = template.render({}, env).fragment;

    var div = document.createElement("div");
    div.appendChild(fragment.cloneNode(true));

    var tag = '<' + tagName + ' data-foo="bar">';
    var closing = '</' + tagName + '>';
    var extra = "<p>hello</p>";
    html = htmlbars_test_helpers.normalizeInnerHTML(div.innerHTML);

    QUnit.push(html === tag + extra || html === tag + closing + extra, html, tag + closing + extra, tagName + " should be a void element");
  }

  test("Void elements are self-closing", function () {
    var voidElements = "area base br col command embed hr img input keygen link meta param source track wbr";

    array_utils.forEach(voidElements.split(" "), function (tagName) {
      shouldBeVoid(tagName);
    });
  });

  test("The compiler can handle nesting", function () {
    var html = '<div class="foo"><p><span id="bar" data-foo="bar">hi!</span></p></div>&nbsp;More content';
    var template = compiler.compile(html);
    var fragment = template.render({}, env).fragment;

    htmlbars_test_helpers.equalTokens(fragment, html);
  });

  test("The compiler can handle quotes", function () {
    compilesTo('<div>"This is a title," we\'re on a boat</div>');
  });

  test("The compiler can handle backslashes", function () {
    compilesTo('<div>This is a backslash: \\</div>');
  });

  test("The compiler can handle newlines", function () {
    compilesTo("<div>common\n\nbro</div>");
  });

  test("The compiler can handle comments", function () {
    compilesTo("<div>{{! Better not break! }}content</div>", '<div>content</div>', {});
  });

  test("The compiler can handle HTML comments", function () {
    compilesTo('<div><!-- Just passing through --></div>');
  });

  test("The compiler can handle HTML comments with mustaches in them", function () {
    compilesTo('<div><!-- {{foo}} --></div>', '<div><!-- {{foo}} --></div>', { foo: 'bar' });
  });

  test("The compiler can handle HTML comments with complex mustaches in them", function () {
    compilesTo('<div><!-- {{foo bar baz}} --></div>', '<div><!-- {{foo bar baz}} --></div>', { foo: 'bar' });
  });

  test("The compiler can handle HTML comments with multi-line mustaches in them", function () {
    compilesTo('<div><!-- {{#each foo as |bar|}}\n{{bar}}\n\n{{/each}} --></div>');
  });

  test('The compiler can handle comments with no parent element', function () {
    compilesTo('<!-- {{foo}} -->');
  });

  // TODO: Revisit partial syntax.
  // test("The compiler can handle partials in handlebars partial syntax", function() {
  //   registerPartial('partial_name', "<b>Partial Works!</b>");
  //   compilesTo('<div>{{>partial_name}} Plaintext content</div>', '<div><b>Partial Works!</b> Plaintext content</div>', {});
  // });

  test("The compiler can handle partials in helper partial syntax", function () {
    registerPartial('partial_name', "<b>Partial Works!</b>");
    compilesTo('<div>{{partial "partial_name"}} Plaintext content</div>', '<div><b>Partial Works!</b> Plaintext content</div>', {});
  });

  test("The compiler can handle simple handlebars", function () {
    compilesTo('<div>{{title}}</div>', '<div>hello</div>', { title: 'hello' });
  });

  test("The compiler can handle escaping HTML", function () {
    compilesTo('<div>{{title}}</div>', '<div>&lt;strong&gt;hello&lt;/strong&gt;</div>', { title: '<strong>hello</strong>' });
  });

  test("The compiler can handle unescaped HTML", function () {
    compilesTo('<div>{{{title}}}</div>', '<div><strong>hello</strong></div>', { title: '<strong>hello</strong>' });
  });

  test("The compiler can handle top-level unescaped HTML", function () {
    compilesTo('{{{html}}}', '<strong>hello</strong>', { html: '<strong>hello</strong>' });
  });

  test("The compiler can handle top-level unescaped tr", function () {
    var template = compiler.compile('{{{html}}}');
    var context = { html: '<tr><td>Yo</td></tr>' };
    var fragment = template.render(context, env, { contextualElement: document.createElement('table') }).fragment;

    equal(fragment.firstChild.nextSibling.tagName, 'TR', "root tr is present");
  });

  test("The compiler can handle top-level unescaped td inside tr contextualElement", function () {
    var template = compiler.compile('{{{html}}}');
    var context = { html: '<td>Yo</td>' };
    var fragment = template.render(context, env, { contextualElement: document.createElement('tr') }).fragment;

    equal(fragment.firstChild.nextSibling.tagName, 'TD', "root td is returned");
  });

  test("The compiler can handle unescaped tr in top of content", function () {
    registerHelper('test', function () {
      return this.yield();
    });

    var template = compiler.compile('{{#test}}{{{html}}}{{/test}}');
    var context = { html: '<tr><td>Yo</td></tr>' };
    var fragment = template.render(context, env, { contextualElement: document.createElement('table') }).fragment;

    equal(fragment.firstChild.nextSibling.nextSibling.tagName, 'TR', "root tr is present");
  });

  test("The compiler can handle unescaped tr inside fragment table", function () {
    registerHelper('test', function () {
      return this.yield();
    });

    var template = compiler.compile('<table>{{#test}}{{{html}}}{{/test}}</table>');
    var context = { html: '<tr><td>Yo</td></tr>' };
    var fragment = template.render(context, env, { contextualElement: document.createElement('div') }).fragment;
    var tableNode = fragment.firstChild;

    equal(tableNode.firstChild.nextSibling.tagName, 'TR', "root tr is present");
  });

  test("The compiler can handle simple helpers", function () {
    registerHelper('testing', function (params) {
      return params[0];
    });

    compilesTo('<div>{{testing title}}</div>', '<div>hello</div>', { title: 'hello' });
  });

  test("Helpers propagate the owner render node", function () {
    registerHelper('id', function () {
      return this.yield();
    });

    var template = compiler.compile('<div>{{#id}}<p>{{#id}}<span>{{#id}}{{name}}{{/id}}</span>{{/id}}</p>{{/id}}</div>');
    var context = { name: "Tom Dale" };
    var result = template.render(context, env);

    htmlbars_test_helpers.equalTokens(result.fragment, '<div><p><span>Tom Dale</span></p></div>');

    var root = result.root;
    strictEqual(root, root.childNodes[0].ownerNode);
    strictEqual(root, root.childNodes[0].childNodes[0].ownerNode);
    strictEqual(root, root.childNodes[0].childNodes[0].childNodes[0].ownerNode);
  });

  test("The compiler can handle sexpr helpers", function () {
    registerHelper('testing', function (params) {
      return params[0] + "!";
    });

    compilesTo('<div>{{testing (testing "hello")}}</div>', '<div>hello!!</div>', {});
  });

  test("The compiler can handle multiple invocations of sexprs", function () {
    registerHelper('testing', function (params) {
      return "" + params[0] + params[1];
    });

    compilesTo('<div>{{testing (testing "hello" foo) (testing (testing bar "lol") baz)}}</div>', '<div>helloFOOBARlolBAZ</div>', { foo: "FOO", bar: "BAR", baz: "BAZ" });
  });

  test("The compiler passes along the hash arguments", function () {
    registerHelper('testing', function (params, hash) {
      return hash.first + '-' + hash.second;
    });

    compilesTo('<div>{{testing first="one" second="two"}}</div>', '<div>one-two</div>');
  });

  test("second render respects whitespace", function () {
    var template = compiler.compile('Hello {{ foo }} ');
    template.render({}, env, { contextualElement: document.createElement('div') });
    var fragment = template.render({}, env, { contextualElement: document.createElement('div') }).fragment;
    equal(fragment.childNodes.length, 3, 'fragment contains 3 text nodes');
    equal(htmlbars_test_helpers.getTextContent(fragment.childNodes[0]), 'Hello ', 'first text node ends with one space character');
    equal(htmlbars_test_helpers.getTextContent(fragment.childNodes[2]), ' ', 'last text node contains one space character');
  });

  test("Morphs are escaped correctly", function () {
    registerHelper('testing-unescaped', function (params) {
      return params[0];
    });

    registerHelper('testing-escaped', function (params) {
      if (this.yield) {
        return this.yield();
      }

      return params[0];
    });

    compilesTo('<div>{{{testing-unescaped "<span>hi</span>"}}}</div>', '<div><span>hi</span></div>');
    compilesTo('<div>{{testing-escaped "<hi>"}}</div>', '<div>&lt;hi&gt;</div>');
    compilesTo('<div>{{#testing-escaped}}<em></em>{{/testing-escaped}}</div>', '<div><em></em></div>');
    compilesTo('<div><testing-escaped><em></em></testing-escaped></div>', '<div><em></em></div>');
  });

  test("Attributes can use computed values", function () {
    compilesTo('<a href="{{url}}">linky</a>', '<a href="linky.html">linky</a>', { url: 'linky.html' });
  });

  test("Mountain range of nesting", function () {
    var context = { foo: "FOO", bar: "BAR", baz: "BAZ", boo: "BOO", brew: "BREW", bat: "BAT", flute: "FLUTE", argh: "ARGH" };
    compilesTo('{{foo}}<span></span>', 'FOO<span></span>', context);
    compilesTo('<span></span>{{foo}}', '<span></span>FOO', context);
    compilesTo('<span>{{foo}}</span>{{foo}}', '<span>FOO</span>FOO', context);
    compilesTo('{{foo}}<span>{{foo}}</span>{{foo}}', 'FOO<span>FOO</span>FOO', context);
    compilesTo('{{foo}}<span></span>{{foo}}', 'FOO<span></span>FOO', context);
    compilesTo('{{foo}}<span></span>{{bar}}<span><span><span>{{baz}}</span></span></span>', 'FOO<span></span>BAR<span><span><span>BAZ</span></span></span>', context);
    compilesTo('{{foo}}<span></span>{{bar}}<span>{{argh}}<span><span>{{baz}}</span></span></span>', 'FOO<span></span>BAR<span>ARGH<span><span>BAZ</span></span></span>', context);
    compilesTo('{{foo}}<span>{{bar}}<a>{{baz}}<em>{{boo}}{{brew}}</em>{{bat}}</a></span><span><span>{{flute}}</span></span>{{argh}}', 'FOO<span>BAR<a>BAZ<em>BOOBREW</em>BAT</a></span><span><span>FLUTE</span></span>ARGH', context);
  });

  // test("Attributes can use computed paths", function() {
  //   compilesTo('<a href="{{post.url}}">linky</a>', '<a href="linky.html">linky</a>', { post: { url: 'linky.html' }});
  // });

  /*

  test("It is possible to use RESOLVE_IN_ATTR for data binding", function() {
    var callback;

    registerHelper('RESOLVE_IN_ATTR', function(parts, options) {
      return boundValue(function(c) {
        callback = c;
        return this[parts[0]];
      }, this);
    });

    var object = { url: 'linky.html' };
    var fragment = compilesTo('<a href="{{url}}">linky</a>', '<a href="linky.html">linky</a>', object);

    object.url = 'clippy.html';
    callback();

    equalTokens(fragment, '<a href="clippy.html">linky</a>');

    object.url = 'zippy.html';
    callback();

    equalTokens(fragment, '<a href="zippy.html">linky</a>');
  });
  */

  test("Attributes can be populated with helpers that generate a string", function () {
    registerHelper('testing', function (params) {
      return params[0];
    });

    compilesTo('<a href="{{testing url}}">linky</a>', '<a href="linky.html">linky</a>', { url: 'linky.html' });
  });
  /*
  test("A helper can return a stream for the attribute", function() {
    registerHelper('testing', function(path, options) {
      return streamValue(this[path]);
    });

    compilesTo('<a href="{{testing url}}">linky</a>', '<a href="linky.html">linky</a>', { url: 'linky.html'});
  });
  */
  test("Attribute helpers take a hash", function () {
    registerHelper('testing', function (params, hash) {
      return hash.path;
    });

    compilesTo('<a href="{{testing path=url}}">linky</a>', '<a href="linky.html">linky</a>', { url: 'linky.html' });
  });
  /*
  test("Attribute helpers can use the hash for data binding", function() {
    var callback;

    registerHelper('testing', function(path, hash, options) {
      return boundValue(function(c) {
        callback = c;
        return this[path] ? hash.truthy : hash.falsy;
      }, this);
    });

    var object = { on: true };
    var fragment = compilesTo('<div class="{{testing on truthy="yeah" falsy="nope"}}">hi</div>', '<div class="yeah">hi</div>', object);

    object.on = false;
    callback();
    equalTokens(fragment, '<div class="nope">hi</div>');
  });
  */
  test("Attributes containing multiple helpers are treated like a block", function () {
    registerHelper('testing', function (params) {
      return params[0];
    });

    compilesTo('<a href="http://{{foo}}/{{testing bar}}/{{testing "baz"}}">linky</a>', '<a href="http://foo.com/bar/baz">linky</a>', { foo: 'foo.com', bar: 'bar' });
  });

  test("Attributes containing a helper are treated like a block", function () {
    expect(2);

    registerHelper('testing', function (params) {
      deepEqual(params, [123]);
      return "example.com";
    });

    compilesTo('<a href="http://{{testing 123}}/index.html">linky</a>', '<a href="http://example.com/index.html">linky</a>', { person: { url: 'example.com' } });
  });
  /*
  test("It is possible to trigger a re-render of an attribute from a child resolution", function() {
    var callback;

    registerHelper('RESOLVE_IN_ATTR', function(path, options) {
      return boundValue(function(c) {
        callback = c;
        return this[path];
      }, this);
    });

    var context = { url: "example.com" };
    var fragment = compilesTo('<a href="http://{{url}}/index.html">linky</a>', '<a href="http://example.com/index.html">linky</a>', context);

    context.url = "www.example.com";
    callback();

    equalTokens(fragment, '<a href="http://www.example.com/index.html">linky</a>');
  });

  test("A child resolution can pass contextual information to the parent", function() {
    var callback;

    registerHelper('RESOLVE_IN_ATTR', function(path, options) {
      return boundValue(function(c) {
        callback = c;
        return this[path];
      }, this);
    });

    var context = { url: "example.com" };
    var fragment = compilesTo('<a href="http://{{url}}/index.html">linky</a>', '<a href="http://example.com/index.html">linky</a>', context);

    context.url = "www.example.com";
    callback();

    equalTokens(fragment, '<a href="http://www.example.com/index.html">linky</a>');
  });

  test("Attribute runs can contain helpers", function() {
    var callbacks = [];

    registerHelper('RESOLVE_IN_ATTR', function(path, options) {
      return boundValue(function(c) {
        callbacks.push(c);
        return this[path];
      }, this);
    });

    registerHelper('testing', function(path, options) {
      return boundValue(function(c) {
        callbacks.push(c);

        if (options.paramTypes[0] === 'id') {
          return this[path] + '.html';
        } else {
          return path;
        }
      }, this);
    });

    var context = { url: "example.com", path: 'index' };
    var fragment = compilesTo('<a href="http://{{url}}/{{testing path}}/{{testing "linky"}}">linky</a>', '<a href="http://example.com/index.html/linky">linky</a>', context);

    context.url = "www.example.com";
    context.path = "yep";
    forEach(callbacks, function(callback) { callback(); });

    equalTokens(fragment, '<a href="http://www.example.com/yep.html/linky">linky</a>');

    context.url = "nope.example.com";
    context.path = "nope";
    forEach(callbacks, function(callback) { callback(); });

    equalTokens(fragment, '<a href="http://nope.example.com/nope.html/linky">linky</a>');
  });
  */
  test("A simple block helper can return the default document fragment", function () {
    registerHelper('testing', function () {
      return this.yield();
    });

    compilesTo('{{#testing}}<div id="test">123</div>{{/testing}}', '<div id="test">123</div>');
  });

  // TODO: NEXT
  test("A simple block helper can return text", function () {
    registerHelper('testing', function () {
      return this.yield();
    });

    compilesTo('{{#testing}}test{{else}}not shown{{/testing}}', 'test');
  });

  test("A block helper can have an else block", function () {
    registerHelper('testing', function (params, hash, options) {
      return options.inverse.yield();
    });

    compilesTo('{{#testing}}Nope{{else}}<div id="test">123</div>{{/testing}}', '<div id="test">123</div>');
  });

  test("A block helper can pass a context to be used in the child", function () {
    registerHelper('testing', function (params, hash, options) {
      var context = { title: 'Rails is omakase' };
      return options.template.render(context);
    });

    compilesTo('{{#testing}}<div id="test">{{title}}</div>{{/testing}}', '<div id="test">Rails is omakase</div>');
  });

  test("Block helpers receive hash arguments", function () {
    registerHelper('testing', function (params, hash) {
      if (hash.truth) {
        return this.yield();
      }
    });

    compilesTo('{{#testing truth=true}}<p>Yep!</p>{{/testing}}{{#testing truth=false}}<p>Nope!</p>{{/testing}}', '<p>Yep!</p><!---->');
  });

  test("Node helpers can modify the node", function () {
    registerHelper('testing', function (params, hash, options) {
      options.element.setAttribute('zomg', 'zomg');
    });

    compilesTo('<div {{testing}}>Node helpers</div>', '<div zomg="zomg">Node helpers</div>');
  });

  test("Node helpers can modify the node after one node appended by top-level helper", function () {
    registerHelper('top-helper', function () {
      return document.createElement('span');
    });
    registerHelper('attr-helper', function (params, hash, options) {
      options.element.setAttribute('zomg', 'zomg');
    });

    compilesTo('<div {{attr-helper}}>Node helpers</div>{{top-helper}}', '<div zomg="zomg">Node helpers</div><span></span>');
  });

  test("Node helpers can modify the node after one node prepended by top-level helper", function () {
    registerHelper('top-helper', function () {
      return document.createElement('span');
    });
    registerHelper('attr-helper', function (params, hash, options) {
      options.element.setAttribute('zomg', 'zomg');
    });

    compilesTo('{{top-helper}}<div {{attr-helper}}>Node helpers</div>', '<span></span><div zomg="zomg">Node helpers</div>');
  });

  test("Node helpers can modify the node after many nodes returned from top-level helper", function () {
    registerHelper('top-helper', function () {
      var frag = document.createDocumentFragment();
      frag.appendChild(document.createElement('span'));
      frag.appendChild(document.createElement('span'));
      return frag;
    });
    registerHelper('attr-helper', function (params, hash, options) {
      options.element.setAttribute('zomg', 'zomg');
    });

    compilesTo('{{top-helper}}<div {{attr-helper}}>Node helpers</div>', '<span></span><span></span><div zomg="zomg">Node helpers</div>');
  });

  test("Node helpers can be used for attribute bindings", function () {
    registerHelper('testing', function (params, hash, options) {
      var value = hash.href,
          element = options.element;

      element.setAttribute('href', value);
    });

    var object = { url: 'linky.html' };
    var template = compiler.compile('<a {{testing href=url}}>linky</a>');
    var result = template.render(object, env);

    htmlbars_test_helpers.equalTokens(result.fragment, '<a href="linky.html">linky</a>');
    object.url = 'zippy.html';

    result.dirty();
    result.revalidate();

    htmlbars_test_helpers.equalTokens(result.fragment, '<a href="zippy.html">linky</a>');
  });

  test('Components - Called as helpers', function () {
    registerHelper('x-append', function (params, hash) {
      QUnit.deepEqual(hash, { text: "de" });
      this.yield();
    });
    var object = { bar: 'e', baz: 'c' };
    compilesTo('a<x-append text="d{{bar}}">b{{baz}}</x-append>f', 'abcf', object);
  });

  test('Components - Unknown helpers fall back to elements', function () {
    var object = { size: 'med', foo: 'b' };
    compilesTo('<x-bar class="btn-{{size}}">a{{foo}}c</x-bar>', '<x-bar class="btn-med">abc</x-bar>', object);
  });

  test('Components - Text-only attributes work', function () {
    var object = { foo: 'qux' };
    compilesTo('<x-bar id="test">{{foo}}</x-bar>', '<x-bar id="test">qux</x-bar>', object);
  });

  test('Components - Empty components work', function () {
    compilesTo('<x-bar></x-bar>', '<x-bar></x-bar>', {});
  });

  test('Components - Text-only dashed attributes work', function () {
    var object = { foo: 'qux' };
    compilesTo('<x-bar aria-label="foo" id="test">{{foo}}</x-bar>', '<x-bar aria-label="foo" id="test">qux</x-bar>', object);
  });

  test('Repaired text nodes are ensured in the right place', function () {
    var object = { a: "A", b: "B", c: "C", d: "D" };
    compilesTo('{{a}} {{b}}', 'A B', object);
    compilesTo('<div>{{a}}{{b}}{{c}}wat{{d}}</div>', '<div>ABCwatD</div>', object);
    compilesTo('{{a}}{{b}}<img><img><img><img>', 'AB<img><img><img><img>', object);
  });

  test("Simple elements can have dashed attributes", function () {
    var template = compiler.compile("<div aria-label='foo'>content</div>");
    var fragment = template.render({}, env).fragment;

    htmlbars_test_helpers.equalTokens(fragment, '<div aria-label="foo">content</div>');
  });

  test("Block params", function () {
    registerHelper('a', function () {
      this.yieldIn(compiler.compile("A({{yield 'W' 'X1'}})"));
    });
    registerHelper('b', function () {
      this.yieldIn(compiler.compile("B({{yield 'X2' 'Y'}})"));
    });
    registerHelper('c', function () {
      this.yieldIn(compiler.compile("C({{yield 'Z'}})"));
    });
    var t = '{{#a as |w x|}}{{w}},{{x}} {{#b as |x y|}}{{x}},{{y}}{{/b}} {{w}},{{x}} {{#c as |z|}}{{x}},{{z}}{{/c}}{{/a}}';
    compilesTo(t, 'A(W,X1 B(X2,Y) W,X1 C(X1,Z))', {});
  });

  test("Block params - Helper should know how many block params it was called with", function () {
    expect(4);

    registerHelper('count-block-params', function (params, hash, options) {
      equal(options.template.arity, hash.count, 'Helpers should receive the correct number of block params in options.template.blockParams.');
    });

    compiler.compile('{{#count-block-params count=0}}{{/count-block-params}}').render({}, env, { contextualElement: document.body });
    compiler.compile('{{#count-block-params count=1 as |x|}}{{/count-block-params}}').render({}, env, { contextualElement: document.body });
    compiler.compile('{{#count-block-params count=2 as |x y|}}{{/count-block-params}}').render({}, env, { contextualElement: document.body });
    compiler.compile('{{#count-block-params count=3 as |x y z|}}{{/count-block-params}}').render({}, env, { contextualElement: document.body });
  });

  test('Block params in HTML syntax', function () {
    var layout = compiler.compile("BAR({{yield 'Xerxes' 'York' 'Zed'}})");

    registerHelper('x-bar', function () {
      this.yieldIn(layout);
    });
    compilesTo('<x-bar as |x y zee|>{{zee}},{{y}},{{x}}</x-bar>', 'BAR(Zed,York,Xerxes)', {});
  });

  test('Block params in HTML syntax - Throws exception if given zero parameters', function () {
    expect(2);

    QUnit.throws(function () {
      compiler.compile('<x-bar as ||>foo</x-bar>');
    }, /Cannot use zero block parameters: 'as \|\|'/);
    QUnit.throws(function () {
      compiler.compile('<x-bar as | |>foo</x-bar>');
    }, /Cannot use zero block parameters: 'as \| \|'/);
  });

  test('Block params in HTML syntax - Works with a single parameter', function () {
    registerHelper('x-bar', function () {
      return this.yield(['Xerxes']);
    });
    compilesTo('<x-bar as |x|>{{x}}</x-bar>', 'Xerxes', {});
  });

  test('Block params in HTML syntax - Works with other attributes', function () {
    registerHelper('x-bar', function (params, hash) {
      deepEqual(hash, { firstName: 'Alice', lastName: 'Smith' });
    });
    compiler.compile('<x-bar firstName="Alice" lastName="Smith" as |x y|></x-bar>').render({}, env, { contextualElement: document.body });
  });

  test('Block params in HTML syntax - Ignores whitespace', function () {
    expect(3);

    registerHelper('x-bar', function () {
      return this.yield(['Xerxes', 'York']);
    });
    compilesTo('<x-bar as |x y|>{{x}},{{y}}</x-bar>', 'Xerxes,York', {});
    compilesTo('<x-bar as | x y|>{{x}},{{y}}</x-bar>', 'Xerxes,York', {});
    compilesTo('<x-bar as | x y |>{{x}},{{y}}</x-bar>', 'Xerxes,York', {});
  });

  test('Block params in HTML syntax - Helper should know how many block params it was called with', function () {
    expect(4);

    registerHelper('count-block-params', function (params, hash, options) {
      equal(options.template.arity, parseInt(hash.count, 10), 'Helpers should receive the correct number of block params in options.template.blockParams.');
    });

    compiler.compile('<count-block-params count="0"></count-block-params>').render({ count: 0 }, env, { contextualElement: document.body });
    compiler.compile('<count-block-params count="1" as |x|></count-block-params>').render({ count: 1 }, env, { contextualElement: document.body });
    compiler.compile('<count-block-params count="2" as |x y|></count-block-params>').render({ count: 2 }, env, { contextualElement: document.body });
    compiler.compile('<count-block-params count="3" as |x y z|></count-block-params>').render({ count: 3 }, env, { contextualElement: document.body });
  });

  test("Block params in HTML syntax - Throws an error on invalid block params syntax", function () {
    expect(3);

    QUnit.throws(function () {
      compiler.compile('<x-bar as |x y>{{x}},{{y}}</x-bar>');
    }, /Invalid block parameters syntax: 'as |x y'/);
    QUnit.throws(function () {
      compiler.compile('<x-bar as |x| y>{{x}},{{y}}</x-bar>');
    }, /Invalid block parameters syntax: 'as \|x\| y'/);
    QUnit.throws(function () {
      compiler.compile('<x-bar as |x| y|>{{x}},{{y}}</x-bar>');
    }, /Invalid block parameters syntax: 'as \|x\| y\|'/);
  });

  test("Block params in HTML syntax - Throws an error on invalid identifiers for params", function () {
    expect(3);

    QUnit.throws(function () {
      compiler.compile('<x-bar as |x foo.bar|></x-bar>');
    }, /Invalid identifier for block parameters: 'foo\.bar' in 'as \|x foo\.bar|'/);
    QUnit.throws(function () {
      compiler.compile('<x-bar as |x "foo"|></x-bar>');
    }, /Invalid identifier for block parameters: '"foo"' in 'as \|x "foo"|'/);
    QUnit.throws(function () {
      compiler.compile('<x-bar as |foo[bar]|></x-bar>');
    }, /Invalid identifier for block parameters: 'foo\[bar\]' in 'as \|foo\[bar\]\|'/);
  });

  QUnit.module("HTML-based compiler (invalid HTML errors)", {
    beforeEach: commonSetup
  });

  test("A helpful error message is provided for unclosed elements", function () {
    expect(2);

    QUnit.throws(function () {
      compiler.compile('\n<div class="my-div" \n foo={{bar}}>\n<span>\n</span>\n');
    }, /Unclosed element `div` \(on line 2\)\./);
    QUnit.throws(function () {
      compiler.compile('\n<div class="my-div">\n<span>\n');
    }, /Unclosed element `span` \(on line 3\)\./);
  });

  test("A helpful error message is provided for unmatched end tags", function () {
    expect(2);

    QUnit.throws(function () {
      compiler.compile("</p>");
    }, /Closing tag `p` \(on line 1\) without an open tag\./);
    QUnit.throws(function () {
      compiler.compile("<em>{{ foo }}</em> \n {{ bar }}\n</div>");
    }, /Closing tag `div` \(on line 3\) without an open tag\./);
  });

  test("A helpful error message is provided for end tags for void elements", function () {
    expect(3);

    QUnit.throws(function () {
      compiler.compile("<input></input>");
    }, /Invalid end tag `input` \(on line 1\) \(void elements cannot have end tags\)./);
    QUnit.throws(function () {
      compiler.compile("<div>\n  <input></input>\n</div>");
    }, /Invalid end tag `input` \(on line 2\) \(void elements cannot have end tags\)./);
    QUnit.throws(function () {
      compiler.compile("\n\n</br>");
    }, /Invalid end tag `br` \(on line 3\) \(void elements cannot have end tags\)./);
  });

  test("A helpful error message is provided for end tags with attributes", function () {
    QUnit.throws(function () {
      compiler.compile('<div>\nSomething\n\n</div foo="bar">');
    }, /Invalid end tag: closing tag must not have attributes, in `div` \(on line 4\)\./);
  });

  test("A helpful error message is provided for mismatched start/end tags", function () {
    QUnit.throws(function () {
      compiler.compile("<div>\n<p>\nSomething\n\n</div>");
    }, /Closing tag `div` \(on line 5\) did not match last open tag `p` \(on line 2\)\./);
  });

  test("error line numbers include comment lines", function () {
    QUnit.throws(function () {
      compiler.compile("<div>\n<p>\n{{! some comment}}\n\n</div>");
    }, /Closing tag `div` \(on line 5\) did not match last open tag `p` \(on line 2\)\./);
  });

  test("error line numbers include mustache only lines", function () {
    QUnit.throws(function () {
      compiler.compile("<div>\n<p>\n{{someProp}}\n\n</div>");
    }, /Closing tag `div` \(on line 5\) did not match last open tag `p` \(on line 2\)\./);
  });

  test("error line numbers include block lines", function () {
    QUnit.throws(function () {
      compiler.compile("<div>\n<p>\n{{#some-comment}}\n{{/some-comment}}\n</div>");
    }, /Closing tag `div` \(on line 5\) did not match last open tag `p` \(on line 2\)\./);
  });

  test("error line numbers include whitespace control mustaches", function () {
    QUnit.throws(function () {
      compiler.compile("<div>\n<p>\n{{someProp~}}\n\n</div>{{some-comment}}");
    }, /Closing tag `div` \(on line 5\) did not match last open tag `p` \(on line 2\)\./);
  });

  test("error line numbers include multiple mustache lines", function () {
    QUnit.throws(function () {
      compiler.compile("<div>\n<p>\n{{some-comment}}</div>{{some-comment}}");
    }, /Closing tag `div` \(on line 3\) did not match last open tag `p` \(on line 2\)\./);
  });

  if (document.createElement('div').namespaceURI) {

    QUnit.module("HTML-based compiler (output, svg)", {
      beforeEach: commonSetup
    });

    test("Simple elements can have namespaced attributes", function () {
      var template = compiler.compile("<svg xlink:title='svg-title'>content</svg>");
      var svgNode = template.render({}, env).fragment.firstChild;

      htmlbars_test_helpers.equalTokens(svgNode, '<svg xlink:title="svg-title">content</svg>');
      equal(svgNode.attributes[0].namespaceURI, 'http://www.w3.org/1999/xlink');
    });

    test("Simple elements can have bound namespaced attributes", function () {
      var template = compiler.compile("<svg xlink:title={{title}}>content</svg>");
      var svgNode = template.render({ title: 'svg-title' }, env).fragment.firstChild;

      htmlbars_test_helpers.equalTokens(svgNode, '<svg xlink:title="svg-title">content</svg>');
      equal(svgNode.attributes[0].namespaceURI, 'http://www.w3.org/1999/xlink');
    });

    test("SVG element can have capitalized attributes", function () {
      var template = compiler.compile("<svg viewBox=\"0 0 0 0\"></svg>");
      var svgNode = template.render({}, env).fragment.firstChild;
      htmlbars_test_helpers.equalTokens(svgNode, '<svg viewBox=\"0 0 0 0\"></svg>');
    });

    test("The compiler can handle namespaced elements", function () {
      var html = '<svg><path stroke="black" d="M 0 0 L 100 100"></path></svg>';
      var template = compiler.compile(html);
      var svgNode = template.render({}, env).fragment.firstChild;

      equal(svgNode.namespaceURI, svgNamespace, "creates the svg element with a namespace");
      htmlbars_test_helpers.equalTokens(svgNode, html);
    });

    test("The compiler sets namespaces on nested namespaced elements", function () {
      var html = '<svg><path stroke="black" d="M 0 0 L 100 100"></path></svg>';
      var template = compiler.compile(html);
      var svgNode = template.render({}, env).fragment.firstChild;

      equal(svgNode.childNodes[0].namespaceURI, svgNamespace, "creates the path element with a namespace");
      htmlbars_test_helpers.equalTokens(svgNode, html);
    });

    test("The compiler sets a namespace on an HTML integration point", function () {
      var html = '<svg><foreignObject>Hi</foreignObject></svg>';
      var template = compiler.compile(html);
      var svgNode = template.render({}, env).fragment.firstChild;

      equal(svgNode.namespaceURI, svgNamespace, "creates the svg element with a namespace");
      equal(svgNode.childNodes[0].namespaceURI, svgNamespace, "creates the foreignObject element with a namespace");
      htmlbars_test_helpers.equalTokens(svgNode, html);
    });

    test("The compiler does not set a namespace on an element inside an HTML integration point", function () {
      var html = '<svg><foreignObject><div></div></foreignObject></svg>';
      var template = compiler.compile(html);
      var svgNode = template.render({}, env).fragment.firstChild;

      equal(svgNode.childNodes[0].childNodes[0].namespaceURI, xhtmlNamespace, "creates the div inside the foreignObject without a namespace");
      htmlbars_test_helpers.equalTokens(svgNode, html);
    });

    test("The compiler pops back to the correct namespace", function () {
      var html = '<svg></svg><svg></svg><div></div>';
      var template = compiler.compile(html);
      var fragment = template.render({}, env).fragment;

      equal(fragment.childNodes[0].namespaceURI, svgNamespace, "creates the first svg element with a namespace");
      equal(fragment.childNodes[1].namespaceURI, svgNamespace, "creates the second svg element with a namespace");
      equal(fragment.childNodes[2].namespaceURI, xhtmlNamespace, "creates the div element without a namespace");
      htmlbars_test_helpers.equalTokens(fragment, html);
    });

    test("The compiler pops back to the correct namespace even if exiting last child", function () {
      var html = '<div><svg></svg></div><div></div>';
      var fragment = compiler.compile(html).render({}, env).fragment;

      equal(fragment.firstChild.namespaceURI, xhtmlNamespace, "first div's namespace is xhtmlNamespace");
      equal(fragment.firstChild.firstChild.namespaceURI, svgNamespace, "svg's namespace is svgNamespace");
      equal(fragment.lastChild.namespaceURI, xhtmlNamespace, "last div's namespace is xhtmlNamespace");
    });

    test("The compiler preserves capitalization of tags", function () {
      var html = '<svg><linearGradient id="gradient"></linearGradient></svg>';
      var template = compiler.compile(html);
      var fragment = template.render({}, env).fragment;

      htmlbars_test_helpers.equalTokens(fragment, html);
    });

    test("svg can live with hydration", function () {
      var template = compiler.compile('<svg></svg>{{name}}');

      var fragment = template.render({ name: 'Milly' }, env, { contextualElement: document.body }).fragment;

      equal(fragment.childNodes[0].namespaceURI, svgNamespace, "svg namespace inside a block is present");
    });

    test("top-level unsafe morph uses the correct namespace", function () {
      var template = compiler.compile('<svg></svg>{{{foo}}}');
      var fragment = template.render({ foo: '<span>FOO</span>' }, env, { contextualElement: document.body }).fragment;

      equal(htmlbars_test_helpers.getTextContent(fragment), 'FOO', 'element from unsafe morph is displayed');
      equal(fragment.childNodes[1].namespaceURI, xhtmlNamespace, 'element from unsafe morph has correct namespace');
    });

    test("nested unsafe morph uses the correct namespace", function () {
      var template = compiler.compile('<svg>{{{foo}}}</svg><div></div>');
      var fragment = template.render({ foo: '<path></path>' }, env, { contextualElement: document.body }).fragment;

      equal(fragment.childNodes[0].childNodes[0].namespaceURI, svgNamespace, 'element from unsafe morph has correct namespace');
    });

    test("svg can take some hydration", function () {
      var template = compiler.compile('<div><svg>{{name}}</svg></div>');

      var fragment = template.render({ name: 'Milly' }, env).fragment;
      equal(fragment.firstChild.childNodes[0].namespaceURI, svgNamespace, "svg namespace inside a block is present");
      htmlbars_test_helpers.equalTokens(fragment.firstChild, '<div><svg>Milly</svg></div>', "html is valid");
    });

    test("root svg can take some hydration", function () {
      var template = compiler.compile('<svg>{{name}}</svg>');
      var fragment = template.render({ name: 'Milly' }, env).fragment;
      var svgNode = fragment.firstChild;

      equal(svgNode.namespaceURI, svgNamespace, "svg namespace inside a block is present");
      htmlbars_test_helpers.equalTokens(svgNode, '<svg>Milly</svg>', "html is valid");
    });

    test("Block helper allows interior namespace", function () {
      var isTrue = true;

      registerHelper('testing', function (params, hash, options) {
        if (isTrue) {
          return this.yield();
        } else {
          return options.inverse.yield();
        }
      });

      var template = compiler.compile('{{#testing}}<svg></svg>{{else}}<div><svg></svg></div>{{/testing}}');

      var fragment = template.render({ isTrue: true }, env, { contextualElement: document.body }).fragment;
      equal(fragment.firstChild.nextSibling.namespaceURI, svgNamespace, "svg namespace inside a block is present");

      isTrue = false;
      fragment = template.render({ isTrue: false }, env, { contextualElement: document.body }).fragment;
      equal(fragment.firstChild.nextSibling.namespaceURI, xhtmlNamespace, "inverse block path has a normal namespace");
      equal(fragment.firstChild.nextSibling.firstChild.namespaceURI, svgNamespace, "svg namespace inside an element inside a block is present");
    });

    test("Block helper allows namespace to bleed through", function () {
      registerHelper('testing', function () {
        return this.yield();
      });

      var template = compiler.compile('<div><svg>{{#testing}}<circle />{{/testing}}</svg></div>');

      var fragment = template.render({ isTrue: true }, env).fragment;
      var svgNode = fragment.firstChild.firstChild;
      equal(svgNode.namespaceURI, svgNamespace, "svg tag has an svg namespace");
      equal(svgNode.childNodes[0].namespaceURI, svgNamespace, "circle tag inside block inside svg has an svg namespace");
    });

    test("Block helper with root svg allows namespace to bleed through", function () {
      registerHelper('testing', function () {
        return this.yield();
      });

      var template = compiler.compile('<svg>{{#testing}}<circle />{{/testing}}</svg>');

      var fragment = template.render({ isTrue: true }, env).fragment;
      var svgNode = fragment.firstChild;
      equal(svgNode.namespaceURI, svgNamespace, "svg tag has an svg namespace");
      equal(svgNode.childNodes[0].namespaceURI, svgNamespace, "circle tag inside block inside svg has an svg namespace");
    });

    test("Block helper with root foreignObject allows namespace to bleed through", function () {
      registerHelper('testing', function () {
        return this.yield();
      });

      var template = compiler.compile('<foreignObject>{{#testing}}<div></div>{{/testing}}</foreignObject>');

      var fragment = template.render({ isTrue: true }, env, { contextualElement: document.createElementNS(svgNamespace, 'svg') }).fragment;
      var svgNode = fragment.firstChild;
      equal(svgNode.namespaceURI, svgNamespace, "foreignObject tag has an svg namespace");
      equal(svgNode.childNodes[0].namespaceURI, xhtmlNamespace, "div inside morph and foreignObject has xhtml namespace");
    });
  }

});
define('htmlbars-compiler-tests/html-compiler-test.jshint', function () {

  'use strict';

  QUnit.module('JSHint - htmlbars-compiler-tests');
  QUnit.test('htmlbars-compiler-tests/html-compiler-test.js should pass jshint', function (assert) {
    assert.ok(true, 'htmlbars-compiler-tests/html-compiler-test.js should pass jshint.');
  });

});
define('htmlbars-compiler-tests/htmlbars-compiler.jshint', function () {

  'use strict';

  QUnit.module('JSHint - htmlbars-compiler-tests');
  QUnit.test('htmlbars-compiler-tests/htmlbars-compiler.js should pass jshint', function (assert) {
    assert.ok(true, 'htmlbars-compiler-tests/htmlbars-compiler.js should pass jshint.');
  });

});
define('htmlbars-compiler-tests/htmlbars-compiler/compiler.jshint', function () {

  'use strict';

  QUnit.module('JSHint - htmlbars-compiler-tests/htmlbars-compiler');
  QUnit.test('htmlbars-compiler-tests/htmlbars-compiler/compiler.js should pass jshint', function (assert) {
    assert.ok(true, 'htmlbars-compiler-tests/htmlbars-compiler/compiler.js should pass jshint.');
  });

});
define('htmlbars-compiler-tests/htmlbars-compiler/fragment-javascript-compiler.jshint', function () {

  'use strict';

  QUnit.module('JSHint - htmlbars-compiler-tests/htmlbars-compiler');
  QUnit.test('htmlbars-compiler-tests/htmlbars-compiler/fragment-javascript-compiler.js should pass jshint', function (assert) {
    assert.ok(true, 'htmlbars-compiler-tests/htmlbars-compiler/fragment-javascript-compiler.js should pass jshint.');
  });

});
define('htmlbars-compiler-tests/htmlbars-compiler/fragment-opcode-compiler.jshint', function () {

  'use strict';

  QUnit.module('JSHint - htmlbars-compiler-tests/htmlbars-compiler');
  QUnit.test('htmlbars-compiler-tests/htmlbars-compiler/fragment-opcode-compiler.js should pass jshint', function (assert) {
    assert.ok(true, 'htmlbars-compiler-tests/htmlbars-compiler/fragment-opcode-compiler.js should pass jshint.');
  });

});
define('htmlbars-compiler-tests/htmlbars-compiler/hydration-javascript-compiler.jshint', function () {

  'use strict';

  QUnit.module('JSHint - htmlbars-compiler-tests/htmlbars-compiler');
  QUnit.test('htmlbars-compiler-tests/htmlbars-compiler/hydration-javascript-compiler.js should pass jshint', function (assert) {
    assert.ok(true, 'htmlbars-compiler-tests/htmlbars-compiler/hydration-javascript-compiler.js should pass jshint.');
  });

});
define('htmlbars-compiler-tests/htmlbars-compiler/hydration-opcode-compiler.jshint', function () {

  'use strict';

  QUnit.module('JSHint - htmlbars-compiler-tests/htmlbars-compiler');
  QUnit.test('htmlbars-compiler-tests/htmlbars-compiler/hydration-opcode-compiler.js should pass jshint', function (assert) {
    assert.ok(true, 'htmlbars-compiler-tests/htmlbars-compiler/hydration-opcode-compiler.js should pass jshint.');
  });

});
define('htmlbars-compiler-tests/htmlbars-compiler/template-compiler.jshint', function () {

  'use strict';

  QUnit.module('JSHint - htmlbars-compiler-tests/htmlbars-compiler');
  QUnit.test('htmlbars-compiler-tests/htmlbars-compiler/template-compiler.js should pass jshint', function (assert) {
    assert.ok(true, 'htmlbars-compiler-tests/htmlbars-compiler/template-compiler.js should pass jshint.');
  });

});
define('htmlbars-compiler-tests/htmlbars-compiler/template-visitor.jshint', function () {

  'use strict';

  QUnit.module('JSHint - htmlbars-compiler-tests/htmlbars-compiler');
  QUnit.test('htmlbars-compiler-tests/htmlbars-compiler/template-visitor.js should pass jshint', function (assert) {
    assert.ok(true, 'htmlbars-compiler-tests/htmlbars-compiler/template-visitor.js should pass jshint.');
  });

});
define('htmlbars-compiler-tests/htmlbars-compiler/utils.jshint', function () {

  'use strict';

  QUnit.module('JSHint - htmlbars-compiler-tests/htmlbars-compiler');
  QUnit.test('htmlbars-compiler-tests/htmlbars-compiler/utils.js should pass jshint', function (assert) {
    assert.ok(true, 'htmlbars-compiler-tests/htmlbars-compiler/utils.js should pass jshint.');
  });

});
define('htmlbars-compiler-tests/hydration-opcode-compiler-test', ['../htmlbars-compiler/hydration-opcode-compiler', '../htmlbars-syntax/parser', '../htmlbars-compiler/compiler'], function (HydrationOpcodeCompiler, parser, compiler) {

  'use strict';

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

});
define('htmlbars-compiler-tests/hydration-opcode-compiler-test.jshint', function () {

  'use strict';

  QUnit.module('JSHint - htmlbars-compiler-tests');
  QUnit.test('htmlbars-compiler-tests/hydration-opcode-compiler-test.js should pass jshint', function (assert) {
    assert.ok(true, 'htmlbars-compiler-tests/hydration-opcode-compiler-test.js should pass jshint.');
  });

});
define('htmlbars-compiler-tests/template-compiler-test', ['../htmlbars-compiler/template-compiler', '../htmlbars-syntax/parser'], function (TemplateCompiler, parser) {

  'use strict';

  QUnit.module("TemplateCompiler");

  function countNamespaceChanges(template) {
    var ast = parser.preprocess(template);
    var compiler = new TemplateCompiler['default']();
    var program = compiler.compile(ast);
    var matches = program.match(/dom\.setNamespace/g);
    return matches ? matches.length : 0;
  }

  test("it omits unnecessary namespace changes", function () {
    equal(countNamespaceChanges('<div></div>'), 0); // sanity check
    equal(countNamespaceChanges('<div><svg></svg></div><svg></svg>'), 1);
    equal(countNamespaceChanges('<div><svg></svg></div><div></div>'), 2);
    equal(countNamespaceChanges('<div><svg><title>foobar</title></svg></div><svg></svg>'), 1);
    equal(countNamespaceChanges('<div><svg><title><h1>foobar</h1></title></svg></div><svg></svg>'), 3);
  });

});
define('htmlbars-compiler-tests/template-compiler-test.jshint', function () {

  'use strict';

  QUnit.module('JSHint - htmlbars-compiler-tests');
  QUnit.test('htmlbars-compiler-tests/template-compiler-test.js should pass jshint', function (assert) {
    assert.ok(true, 'htmlbars-compiler-tests/template-compiler-test.js should pass jshint.');
  });

});
define('htmlbars-compiler-tests/template-visitor-node-test', ['../htmlbars-syntax/parser', '../htmlbars-compiler/template-visitor'], function (parser, TemplateVisitor) {

  'use strict';

  function actionsEqual(input, expectedActions) {
    var ast = parser.preprocess(input);

    var templateVisitor = new TemplateVisitor['default']();
    templateVisitor.visit(ast);
    var actualActions = templateVisitor.actions;

    // Remove the AST node reference from the actions to keep tests leaner
    for (var i = 0; i < actualActions.length; i++) {
      actualActions[i][1].shift();
    }

    deepEqual(actualActions, expectedActions);
  }

  QUnit.module("TemplateVisitor");

  test("empty", function () {
    var input = "";
    actionsEqual(input, [['startProgram', [0, []]], ['endProgram', [0]]]);
  });

  test("basic", function () {
    var input = "foo{{bar}}<div></div>";
    actionsEqual(input, [['startProgram', [0, []]], ['text', [0, 3]], ['mustache', [1, 3]], ['openElement', [2, 3, 0, []]], ['closeElement', [2, 3]], ['endProgram', [0]]]);
  });

  test("nested HTML", function () {
    var input = "<a></a><a><a><a></a></a></a>";
    actionsEqual(input, [['startProgram', [0, []]], ['openElement', [0, 2, 0, []]], ['closeElement', [0, 2]], ['openElement', [1, 2, 0, []]], ['openElement', [0, 1, 0, []]], ['openElement', [0, 1, 0, []]], ['closeElement', [0, 1]], ['closeElement', [0, 1]], ['closeElement', [1, 2]], ['endProgram', [0]]]);
  });

  test("mustaches are counted correctly", function () {
    var input = "<a><a>{{foo}}</a><a {{foo}}><a>{{foo}}</a><a>{{foo}}</a></a></a>";
    actionsEqual(input, [['startProgram', [0, []]], ['openElement', [0, 1, 2, []]], ['openElement', [0, 2, 1, []]], ['mustache', [0, 1]], ['closeElement', [0, 2]], ['openElement', [1, 2, 3, []]], ['openElement', [0, 2, 1, []]], ['mustache', [0, 1]], ['closeElement', [0, 2]], ['openElement', [1, 2, 1, []]], ['mustache', [0, 1]], ['closeElement', [1, 2]], ['closeElement', [1, 2]], ['closeElement', [0, 1]], ['endProgram', [0]]]);
  });

  test("empty block", function () {
    var input = "{{#a}}{{/a}}";
    actionsEqual(input, [['startProgram', [0, []]], ['endProgram', [1]], ['startProgram', [1, []]], ['block', [0, 1]], ['endProgram', [0]]]);
  });

  test("block with inverse", function () {
    var input = "{{#a}}b{{^}}{{/a}}";
    actionsEqual(input, [['startProgram', [0, []]], ['endProgram', [1]], ['startProgram', [0, []]], ['text', [0, 1]], ['endProgram', [1]], ['startProgram', [2, []]], ['block', [0, 1]], ['endProgram', [0]]]);
  });

  test("nested blocks", function () {
    var input = "{{#a}}{{#a}}<b></b>{{/a}}{{#a}}{{b}}{{/a}}{{/a}}{{#a}}b{{/a}}";
    actionsEqual(input, [['startProgram', [0, []]], ['text', [0, 1]], ['endProgram', [1]], ['startProgram', [0, []]], ['mustache', [0, 1]], ['endProgram', [2]], ['startProgram', [0, []]], ['openElement', [0, 1, 0, []]], ['closeElement', [0, 1]], ['endProgram', [2]], ['startProgram', [2, []]], ['block', [0, 2]], ['block', [1, 2]], ['endProgram', [1]], ['startProgram', [2, []]], ['block', [0, 2]], ['block', [1, 2]], ['endProgram', [0]]]);
  });

  test("component", function () {
    var input = "<x-foo>bar</x-foo>";
    actionsEqual(input, [['startProgram', [0, []]], ['text', [0, 1]], ['endProgram', [1]], ['startProgram', [1, []]], ['component', [0, 1]], ['endProgram', [0]]]);
  });

  test("comment", function () {
    var input = "<!-- some comment -->";
    actionsEqual(input, [['startProgram', [0, []]], ['comment', [0, 1]], ['endProgram', [0]]]);
  });

});
define('htmlbars-compiler-tests/template-visitor-node-test.jshint', function () {

  'use strict';

  QUnit.module('JSHint - htmlbars-compiler-tests');
  QUnit.test('htmlbars-compiler-tests/template-visitor-node-test.js should pass jshint', function (assert) {
    assert.ok(true, 'htmlbars-compiler-tests/template-visitor-node-test.js should pass jshint.');
  });

});
define('htmlbars-runtime', ['exports', './htmlbars-runtime/hooks', './htmlbars-runtime/render', '../htmlbars-util/morph-utils', '../htmlbars-util/template-utils', './htmlbars-runtime/expression-visitor', 'htmlbars-runtime/hooks'], function (exports, hooks, render, morph_utils, template_utils, expression_visitor, htmlbars_runtime__hooks) {

  'use strict';

  var internal = {
    blockFor: template_utils.blockFor,
    manualElement: render.manualElement,
    hostBlock: htmlbars_runtime__hooks.hostBlock,
    continueBlock: htmlbars_runtime__hooks.continueBlock,
    hostYieldWithShadowTemplate: htmlbars_runtime__hooks.hostYieldWithShadowTemplate,
    visitChildren: morph_utils.visitChildren,
    validateChildMorphs: expression_visitor.validateChildMorphs,
    clearMorph: template_utils.clearMorph
  };

  exports.hooks = hooks['default'];
  exports.render = render['default'];
  exports.internal = internal;

});
define('htmlbars-runtime.jshint', function () {

  'use strict';

  QUnit.module('JSHint - .');
  QUnit.test('htmlbars-runtime.js should pass jshint', function (assert) {
    assert.ok(true, 'htmlbars-runtime.js should pass jshint.');
  });

});
define('htmlbars-runtime/expression-visitor', ['exports', '../htmlbars-util/object-utils', '../htmlbars-util/morph-utils'], function (exports, object_utils, morph_utils) {

  'use strict';

  var base = {
    acceptExpression: function (node, env, scope) {
      var ret = { value: null };

      // Primitive literals are unambiguously non-array representations of
      // themselves.
      if (typeof node !== 'object' || node === null) {
        ret.value = node;
        return ret;
      }

      switch (node[0]) {
        // can be used by manualElement
        case 'value':
          ret.value = node[1];break;
        case 'get':
          ret.value = this.get(node, env, scope);break;
        case 'subexpr':
          ret.value = this.subexpr(node, env, scope);break;
        case 'concat':
          ret.value = this.concat(node, env, scope);break;
      }

      return ret;
    },

    acceptParams: function (nodes, env, scope) {
      var arr = new Array(nodes.length);

      for (var i = 0, l = nodes.length; i < l; i++) {
        arr[i] = this.acceptExpression(nodes[i], env, scope).value;
      }

      return arr;
    },

    acceptHash: function (pairs, env, scope) {
      var object = {};

      for (var i = 0, l = pairs.length; i < l; i += 2) {
        object[pairs[i]] = this.acceptExpression(pairs[i + 1], env, scope).value;
      }

      return object;
    },

    // [ 'get', path ]
    get: function (node, env, scope) {
      return env.hooks.get(env, scope, node[1]);
    },

    // [ 'subexpr', path, params, hash ]
    subexpr: function (node, env, scope) {
      var path = node[1],
          params = node[2],
          hash = node[3];
      return env.hooks.subexpr(env, scope, path, this.acceptParams(params, env, scope), this.acceptHash(hash, env, scope));
    },

    // [ 'concat', parts ]
    concat: function (node, env, scope) {
      return env.hooks.concat(env, this.acceptParams(node[1], env, scope));
    },

    linkParamsAndHash: function (env, scope, morph, path, params, hash) {
      if (morph.linkedParams) {
        params = morph.linkedParams.params;
        hash = morph.linkedParams.hash;
      } else {
        params = params && this.acceptParams(params, env, scope);
        hash = hash && this.acceptHash(hash, env, scope);
      }

      morph_utils.linkParams(env, scope, morph, path, params, hash);
      return [params, hash];
    }
  };

  var AlwaysDirtyVisitor = object_utils.merge(Object.create(base), {
    // [ 'block', path, params, hash, templateId, inverseId ]
    block: function (node, morph, env, scope, template, visitor) {
      var path = node[1],
          params = node[2],
          hash = node[3],
          templateId = node[4],
          inverseId = node[5];
      var paramsAndHash = this.linkParamsAndHash(env, scope, morph, path, params, hash);

      morph.isDirty = morph.isSubtreeDirty = false;
      env.hooks.block(morph, env, scope, path, paramsAndHash[0], paramsAndHash[1], templateId === null ? null : template.templates[templateId], inverseId === null ? null : template.templates[inverseId], visitor);
    },

    // [ 'inline', path, params, hash ]
    inline: function (node, morph, env, scope, visitor) {
      var path = node[1],
          params = node[2],
          hash = node[3];
      var paramsAndHash = this.linkParamsAndHash(env, scope, morph, path, params, hash);

      morph.isDirty = morph.isSubtreeDirty = false;
      env.hooks.inline(morph, env, scope, path, paramsAndHash[0], paramsAndHash[1], visitor);
    },

    // [ 'content', path ]
    content: function (node, morph, env, scope, visitor) {
      var path = node[1];

      morph.isDirty = morph.isSubtreeDirty = false;

      if (isHelper(env, scope, path)) {
        env.hooks.inline(morph, env, scope, path, [], {}, visitor);
        if (morph.linkedResult) {
          morph_utils.linkParams(env, scope, morph, '@content-helper', [morph.linkedResult], null);
        }
        return;
      }

      var params;
      if (morph.linkedParams) {
        params = morph.linkedParams.params;
      } else {
        params = [env.hooks.get(env, scope, path)];
      }

      morph_utils.linkParams(env, scope, morph, '@range', params, null);
      env.hooks.range(morph, env, scope, path, params[0], visitor);
    },

    // [ 'element', path, params, hash ]
    element: function (node, morph, env, scope, visitor) {
      var path = node[1],
          params = node[2],
          hash = node[3];
      var paramsAndHash = this.linkParamsAndHash(env, scope, morph, path, params, hash);

      morph.isDirty = morph.isSubtreeDirty = false;
      env.hooks.element(morph, env, scope, path, paramsAndHash[0], paramsAndHash[1], visitor);
    },

    // [ 'attribute', name, value ]
    attribute: function (node, morph, env, scope) {
      var name = node[1],
          value = node[2];
      var paramsAndHash = this.linkParamsAndHash(env, scope, morph, '@attribute', [value], null);

      morph.isDirty = morph.isSubtreeDirty = false;
      env.hooks.attribute(morph, env, scope, name, paramsAndHash[0][0]);
    },

    // [ 'component', path, attrs, templateId, inverseId ]
    component: function (node, morph, env, scope, template, visitor) {
      var path = node[1],
          attrs = node[2],
          templateId = node[3],
          inverseId = node[4];
      var paramsAndHash = this.linkParamsAndHash(env, scope, morph, path, [], attrs);
      var templates = {
        default: template.templates[templateId],
        inverse: template.templates[inverseId]
      };

      morph.isDirty = morph.isSubtreeDirty = false;
      env.hooks.component(morph, env, scope, path, paramsAndHash[0], paramsAndHash[1], templates, visitor);
    },

    // [ 'attributes', template ]
    attributes: function (node, morph, env, scope, parentMorph, visitor) {
      var template = node[1];
      env.hooks.attributes(morph, env, scope, template, parentMorph, visitor);
    }
  });

  exports['default'] = object_utils.merge(Object.create(base), {
    // [ 'block', path, params, hash, templateId, inverseId ]
    block: function (node, morph, env, scope, template, visitor) {
      dirtyCheck(env, morph, visitor, function (visitor) {
        AlwaysDirtyVisitor.block(node, morph, env, scope, template, visitor);
      });
    },

    // [ 'inline', path, params, hash ]
    inline: function (node, morph, env, scope, visitor) {
      dirtyCheck(env, morph, visitor, function (visitor) {
        AlwaysDirtyVisitor.inline(node, morph, env, scope, visitor);
      });
    },

    // [ 'content', path ]
    content: function (node, morph, env, scope, visitor) {
      dirtyCheck(env, morph, visitor, function (visitor) {
        AlwaysDirtyVisitor.content(node, morph, env, scope, visitor);
      });
    },

    // [ 'element', path, params, hash ]
    element: function (node, morph, env, scope, template, visitor) {
      dirtyCheck(env, morph, visitor, function (visitor) {
        AlwaysDirtyVisitor.element(node, morph, env, scope, template, visitor);
      });
    },

    // [ 'attribute', name, value ]
    attribute: function (node, morph, env, scope, template) {
      dirtyCheck(env, morph, null, function () {
        AlwaysDirtyVisitor.attribute(node, morph, env, scope, template);
      });
    },

    // [ 'component', path, attrs, templateId ]
    component: function (node, morph, env, scope, template, visitor) {
      dirtyCheck(env, morph, visitor, function (visitor) {
        AlwaysDirtyVisitor.component(node, morph, env, scope, template, visitor);
      });
    },

    // [ 'attributes', template ]
    attributes: function (node, morph, env, scope, parentMorph, visitor) {
      AlwaysDirtyVisitor.attributes(node, morph, env, scope, parentMorph, visitor);
    }
  });

  function dirtyCheck(_env, morph, visitor, callback) {
    var isDirty = morph.isDirty;
    var isSubtreeDirty = morph.isSubtreeDirty;
    var env = _env;

    if (isSubtreeDirty) {
      visitor = AlwaysDirtyVisitor;
    }

    if (isDirty || isSubtreeDirty) {
      callback(visitor);
    } else {
      if (morph.buildChildEnv) {
        env = morph.buildChildEnv(morph.state, env);
      }
      morph_utils.validateChildMorphs(env, morph, visitor);
    }
  }

  function isHelper(env, scope, path) {
    return env.hooks.keywords[path] !== undefined || env.hooks.hasHelper(env, scope, path);
  }

  exports.AlwaysDirtyVisitor = AlwaysDirtyVisitor;

});
define('htmlbars-runtime/expression-visitor.jshint', function () {

  'use strict';

  QUnit.module('JSHint - htmlbars-runtime');
  QUnit.test('htmlbars-runtime/expression-visitor.js should pass jshint', function (assert) {
    assert.ok(true, 'htmlbars-runtime/expression-visitor.js should pass jshint.');
  });

});
define('htmlbars-runtime/hooks', ['exports', './render', '../morph-range/morph-list', '../htmlbars-util/object-utils', '../htmlbars-util/morph-utils', '../htmlbars-util/template-utils'], function (exports, render, MorphList, object_utils, morph_utils, template_utils) {

  'use strict';

  exports.wrap = wrap;
  exports.wrapForHelper = wrapForHelper;
  exports.hostYieldWithShadowTemplate = hostYieldWithShadowTemplate;
  exports.createScope = createScope;
  exports.createFreshScope = createFreshScope;
  exports.bindShadowScope = bindShadowScope;
  exports.createChildScope = createChildScope;
  exports.bindSelf = bindSelf;
  exports.updateSelf = updateSelf;
  exports.bindLocal = bindLocal;
  exports.updateLocal = updateLocal;
  exports.bindBlock = bindBlock;
  exports.block = block;
  exports.continueBlock = continueBlock;
  exports.hostBlock = hostBlock;
  exports.handleRedirect = handleRedirect;
  exports.handleKeyword = handleKeyword;
  exports.linkRenderNode = linkRenderNode;
  exports.inline = inline;
  exports.keyword = keyword;
  exports.invokeHelper = invokeHelper;
  exports.classify = classify;
  exports.partial = partial;
  exports.range = range;
  exports.element = element;
  exports.attribute = attribute;
  exports.subexpr = subexpr;
  exports.get = get;
  exports.getRoot = getRoot;
  exports.getChild = getChild;
  exports.getValue = getValue;
  exports.getCellOrValue = getCellOrValue;
  exports.component = component;
  exports.concat = concat;
  exports.hasHelper = hasHelper;
  exports.lookupHelper = lookupHelper;
  exports.bindScope = bindScope;
  exports.updateScope = updateScope;

  function wrap(template) {
    if (template === null) {
      return null;
    }

    return {
      meta: template.meta,
      arity: template.arity,
      raw: template,
      render: function (self, env, options, blockArguments) {
        var scope = env.hooks.createFreshScope();

        options = options || {};
        options.self = self;
        options.blockArguments = blockArguments;

        return render['default'](template, env, scope, options);
      }
    };
  }

  function wrapForHelper(template, env, scope, morph, renderState, visitor) {
    if (!template) {
      return {
        yieldIn: yieldInShadowTemplate(null, env, scope, morph, renderState, visitor)
      };
    }

    var yieldArgs = yieldTemplate(template, env, scope, morph, renderState, visitor);

    return {
      meta: template.meta,
      arity: template.arity,
      yield: yieldArgs,
      yieldItem: yieldItem(template, env, scope, morph, renderState, visitor),
      yieldIn: yieldInShadowTemplate(template, env, scope, morph, renderState, visitor),
      raw: template,

      render: function (self, blockArguments) {
        yieldArgs(blockArguments, self);
      }
    };
  }

  // Called by a user-land helper to render a template.
  function yieldTemplate(template, env, parentScope, morph, renderState, visitor) {
    return function (blockArguments, self) {
      // Render state is used to track the progress of the helper (since it
      // may call into us multiple times). As the user-land helper calls
      // into library code, we track what needs to be cleaned up after the
      // helper has returned.
      //
      // Here, we remember that a template has been yielded and so we do not
      // need to remove the previous template. (If no template is yielded
      // this render by the helper, we assume nothing should be shown and
      // remove any previous rendered templates.)
      renderState.morphToClear = null;

      // In this conditional is true, it means that on the previous rendering pass
      // the helper yielded multiple items via `yieldItem()`, but this time they
      // are yielding a single template. In that case, we mark the morph list for
      // cleanup so it is removed from the DOM.
      if (morph.morphList) {
        template_utils.clearMorphList(morph.morphList, morph, env);
        renderState.morphListToClear = null;
      }

      var scope = parentScope;

      if (morph.lastYielded && isStableTemplate(template, morph.lastYielded)) {
        return morph.lastResult.revalidateWith(env, undefined, self, blockArguments, visitor);
      }

      // Check to make sure that we actually **need** a new scope, and can't
      // share the parent scope. Note that we need to move this check into
      // a host hook, because the host's notion of scope may require a new
      // scope in more cases than the ones we can determine statically.
      if (self !== undefined || parentScope === null || template.arity) {
        scope = env.hooks.createChildScope(parentScope);
      }

      morph.lastYielded = { self: self, template: template, shadowTemplate: null };

      // Render the template that was selected by the helper
      render['default'](template, env, scope, { renderNode: morph, self: self, blockArguments: blockArguments });
    };
  }

  function yieldItem(template, env, parentScope, morph, renderState, visitor) {
    // Initialize state that tracks multiple items being
    // yielded in.
    var currentMorph = null;

    // Candidate morphs for deletion.
    var candidates = {};

    // Reuse existing MorphList if this is not a first-time
    // render.
    var morphList = morph.morphList;
    if (morphList) {
      currentMorph = morphList.firstChildMorph;
    }

    // Advances the currentMorph pointer to the morph in the previously-rendered
    // list that matches the yielded key. While doing so, it marks any morphs
    // that it advances past as candidates for deletion. Assuming those morphs
    // are not yielded in later, they will be removed in the prune step during
    // cleanup.
    // Note that this helper function assumes that the morph being seeked to is
    // guaranteed to exist in the previous MorphList; if this is called and the
    // morph does not exist, it will result in an infinite loop
    function advanceToKey(key) {
      var seek = currentMorph;

      while (seek.key !== key) {
        candidates[seek.key] = seek;
        seek = seek.nextMorph;
      }

      currentMorph = seek.nextMorph;
      return seek;
    }

    return function (_key, blockArguments, self) {
      if (typeof _key !== 'string') {
        throw new Error("You must provide a string key when calling `yieldItem`; you provided " + _key);
      }

      // At least one item has been yielded, so we do not wholesale
      // clear the last MorphList but instead apply a prune operation.
      renderState.morphListToClear = null;
      morph.lastYielded = null;

      var morphList, morphMap;

      if (!morph.morphList) {
        morph.morphList = new MorphList['default']();
        morph.morphMap = {};
        morph.setMorphList(morph.morphList);
      }

      morphList = morph.morphList;
      morphMap = morph.morphMap;

      // A map of morphs that have been yielded in on this
      // rendering pass. Any morphs that do not make it into
      // this list will be pruned from the MorphList during the cleanup
      // process.
      var handledMorphs = renderState.handledMorphs;
      var key = undefined;

      if (_key in handledMorphs) {
        // In this branch we are dealing with a duplicate key. The strategy
        // is to take the original key and append a counter to it that is
        // incremented every time the key is reused. In order to greatly
        // reduce the chance of colliding with another valid key we also add
        // an extra string "--z8mS2hvDW0A--" to the new key.
        var collisions = renderState.collisions;
        if (collisions === undefined) {
          collisions = renderState.collisions = {};
        }
        var count = collisions[_key] | 0;
        collisions[_key] = ++count;

        key = _key + '--z8mS2hvDW0A--' + count;
      } else {
        key = _key;
      }

      if (currentMorph && currentMorph.key === key) {
        yieldTemplate(template, env, parentScope, currentMorph, renderState, visitor)(blockArguments, self);
        currentMorph = currentMorph.nextMorph;
        handledMorphs[key] = currentMorph;
      } else if (morphMap[key] !== undefined) {
        var foundMorph = morphMap[key];

        if (key in candidates) {
          // If we already saw this morph, move it forward to this position
          morphList.insertBeforeMorph(foundMorph, currentMorph);
        } else {
          // Otherwise, move the pointer forward to the existing morph for this key
          advanceToKey(key);
        }

        handledMorphs[foundMorph.key] = foundMorph;
        yieldTemplate(template, env, parentScope, foundMorph, renderState, visitor)(blockArguments, self);
      } else {
        var childMorph = render.createChildMorph(env.dom, morph);
        childMorph.key = key;
        morphMap[key] = handledMorphs[key] = childMorph;
        morphList.insertBeforeMorph(childMorph, currentMorph);
        yieldTemplate(template, env, parentScope, childMorph, renderState, visitor)(blockArguments, self);
      }

      renderState.morphListToPrune = morphList;
      morph.childNodes = null;
    };
  }

  function isStableTemplate(template, lastYielded) {
    return !lastYielded.shadowTemplate && template === lastYielded.template;
  }

  function yieldInShadowTemplate(template, env, parentScope, morph, renderState, visitor) {
    var hostYield = hostYieldWithShadowTemplate(template, env, parentScope, morph, renderState, visitor);

    return function (shadowTemplate, self) {
      hostYield(shadowTemplate, env, self, []);
    };
  }

  function hostYieldWithShadowTemplate(template, env, parentScope, morph, renderState, visitor) {
    return function (shadowTemplate, env, self, blockArguments) {
      renderState.morphToClear = null;

      if (morph.lastYielded && isStableShadowRoot(template, shadowTemplate, morph.lastYielded)) {
        return morph.lastResult.revalidateWith(env, undefined, self, blockArguments, visitor);
      }

      var shadowScope = env.hooks.createFreshScope();
      env.hooks.bindShadowScope(env, parentScope, shadowScope, renderState.shadowOptions);
      blockToYield.arity = template.arity;
      env.hooks.bindBlock(env, shadowScope, blockToYield);

      morph.lastYielded = { self: self, template: template, shadowTemplate: shadowTemplate };

      // Render the shadow template with the block available
      render['default'](shadowTemplate.raw, env, shadowScope, { renderNode: morph, self: self, blockArguments: blockArguments });
    };

    function blockToYield(env, blockArguments, self, renderNode, shadowParent, visitor) {
      if (renderNode.lastResult) {
        renderNode.lastResult.revalidateWith(env, undefined, undefined, blockArguments, visitor);
      } else {
        var scope = parentScope;

        // Since a yielded template shares a `self` with its original context,
        // we only need to create a new scope if the template has block parameters
        if (template.arity) {
          scope = env.hooks.createChildScope(parentScope);
        }

        render['default'](template, env, scope, { renderNode: renderNode, self: self, blockArguments: blockArguments });
      }
    }
  }

  function isStableShadowRoot(template, shadowTemplate, lastYielded) {
    return template === lastYielded.template && shadowTemplate === lastYielded.shadowTemplate;
  }

  function optionsFor(template, inverse, env, scope, morph, visitor) {
    // If there was a template yielded last time, set morphToClear so it will be cleared
    // if no template is yielded on this render.
    var morphToClear = morph.lastResult ? morph : null;
    var renderState = new template_utils.RenderState(morphToClear, morph.morphList || null);

    return {
      templates: {
        template: wrapForHelper(template, env, scope, morph, renderState, visitor),
        inverse: wrapForHelper(inverse, env, scope, morph, renderState, visitor)
      },
      renderState: renderState
    };
  }

  function thisFor(options) {
    return {
      arity: options.template.arity,
      yield: options.template.yield,
      yieldItem: options.template.yieldItem,
      yieldIn: options.template.yieldIn
    };
  }

  /**
    Host Hook: createScope

    @param {Scope?} parentScope
    @return Scope

    Corresponds to entering a new HTMLBars block.

    This hook is invoked when a block is entered with
    a new `self` or additional local variables.

    When invoked for a top-level template, the
    `parentScope` is `null`, and this hook should return
    a fresh Scope.

    When invoked for a child template, the `parentScope`
    is the scope for the parent environment.

    Note that the `Scope` is an opaque value that is
    passed to other host hooks. For example, the `get`
    hook uses the scope to retrieve a value for a given
    scope and variable name.
  */

  function createScope(env, parentScope) {
    if (parentScope) {
      return env.hooks.createChildScope(parentScope);
    } else {
      return env.hooks.createFreshScope();
    }
  }

  function createFreshScope() {
    // because `in` checks have unpredictable performance, keep a
    // separate dictionary to track whether a local was bound.
    // See `bindLocal` for more information.
    return { self: null, blocks: {}, locals: {}, localPresent: {} };
  }

  /**
    Host Hook: bindShadowScope

    @param {Scope?} parentScope
    @return Scope

    Corresponds to rendering a new template into an existing
    render tree, but with a new top-level lexical scope. This
    template is called the "shadow root".

    If a shadow template invokes `{{yield}}`, it will render
    the block provided to the shadow root in the original
    lexical scope.

    ```hbs
    {{!-- post template --}}
    <p>{{props.title}}</p>
    {{yield}}

    {{!-- blog template --}}
    {{#post title="Hello world"}}
      <p>by {{byline}}</p>
      <article>This is my first post</article>
    {{/post}}

    {{#post title="Goodbye world"}}
      <p>by {{byline}}</p>
      <article>This is my last post</article>
    {{/post}}
    ```

    ```js
    helpers.post = function(params, hash, options) {
      options.template.yieldIn(postTemplate, { props: hash });
    };

    blog.render({ byline: "Yehuda Katz" });
    ```

    Produces:

    ```html
    <p>Hello world</p>
    <p>by Yehuda Katz</p>
    <article>This is my first post</article>

    <p>Goodbye world</p>
    <p>by Yehuda Katz</p>
    <article>This is my last post</article>
    ```

    In short, `yieldIn` creates a new top-level scope for the
    provided template and renders it, making the original block
    available to `{{yield}}` in that template.
  */

  function bindShadowScope(env /*, parentScope, shadowScope */) {
    return env.hooks.createFreshScope();
  }

  function createChildScope(parent) {
    var scope = Object.create(parent);
    scope.locals = Object.create(parent.locals);
    return scope;
  }

  /**
    Host Hook: bindSelf

    @param {Scope} scope
    @param {any} self

    Corresponds to entering a template.

    This hook is invoked when the `self` value for a scope is ready to be bound.

    The host must ensure that child scopes reflect the change to the `self` in
    future calls to the `get` hook.
  */

  function bindSelf(env, scope, self) {
    scope.self = self;
  }

  function updateSelf(env, scope, self) {
    env.hooks.bindSelf(env, scope, self);
  }

  /**
    Host Hook: bindLocal

    @param {Environment} env
    @param {Scope} scope
    @param {String} name
    @param {any} value

    Corresponds to entering a template with block arguments.

    This hook is invoked when a local variable for a scope has been provided.

    The host must ensure that child scopes reflect the change in future calls
    to the `get` hook.
  */

  function bindLocal(env, scope, name, value) {
    scope.localPresent[name] = true;
    scope.locals[name] = value;
  }

  function updateLocal(env, scope, name, value) {
    env.hooks.bindLocal(env, scope, name, value);
  }

  /**
    Host Hook: bindBlock

    @param {Environment} env
    @param {Scope} scope
    @param {Function} block

    Corresponds to entering a shadow template that was invoked by a block helper with
    `yieldIn`.

    This hook is invoked with an opaque block that will be passed along
    to the shadow template, and inserted into the shadow template when
    `{{yield}}` is used. Optionally provide a non-default block name
    that can be targeted by `{{yield to=blockName}}`.
  */

  function bindBlock(env, scope, block) {
    var name = arguments.length <= 3 || arguments[3] === undefined ? 'default' : arguments[3];

    scope.blocks[name] = block;
  }

  /**
    Host Hook: block

    @param {RenderNode} renderNode
    @param {Environment} env
    @param {Scope} scope
    @param {String} path
    @param {Array} params
    @param {Object} hash
    @param {Block} block
    @param {Block} elseBlock

    Corresponds to:

    ```hbs
    {{#helper param1 param2 key1=val1 key2=val2}}
      {{!-- child template --}}
    {{/helper}}
    ```

    This host hook is a workhorse of the system. It is invoked
    whenever a block is encountered, and is responsible for
    resolving the helper to call, and then invoke it.

    The helper should be invoked with:

    - `{Array} params`: the parameters passed to the helper
      in the template.
    - `{Object} hash`: an object containing the keys and values passed
      in the hash position in the template.

    The values in `params` and `hash` will already be resolved
    through a previous call to the `get` host hook.

    The helper should be invoked with a `this` value that is
    an object with one field:

    `{Function} yield`: when invoked, this function executes the
    block with the current scope. It takes an optional array of
    block parameters. If block parameters are supplied, HTMLBars
    will invoke the `bindLocal` host hook to bind the supplied
    values to the block arguments provided by the template.

    In general, the default implementation of `block` should work
    for most host environments. It delegates to other host hooks
    where appropriate, and properly invokes the helper with the
    appropriate arguments.
  */

  function block(morph, env, scope, path, params, hash, template, inverse, visitor) {
    if (handleRedirect(morph, env, scope, path, params, hash, template, inverse, visitor)) {
      return;
    }

    continueBlock(morph, env, scope, path, params, hash, template, inverse, visitor);
  }

  function continueBlock(morph, env, scope, path, params, hash, template, inverse, visitor) {
    hostBlock(morph, env, scope, template, inverse, null, visitor, function (options) {
      var helper = env.hooks.lookupHelper(env, scope, path);
      return env.hooks.invokeHelper(morph, env, scope, visitor, params, hash, helper, options.templates, thisFor(options.templates));
    });
  }

  function hostBlock(morph, env, scope, template, inverse, shadowOptions, visitor, callback) {
    var options = optionsFor(template, inverse, env, scope, morph, visitor);
    template_utils.renderAndCleanup(morph, env, options, shadowOptions, callback);
  }

  function handleRedirect(morph, env, scope, path, params, hash, template, inverse, visitor) {
    if (!path) {
      return false;
    }

    var redirect = env.hooks.classify(env, scope, path);
    if (redirect) {
      switch (redirect) {
        case 'component':
          env.hooks.component(morph, env, scope, path, params, hash, { default: template, inverse: inverse }, visitor);break;
        case 'inline':
          env.hooks.inline(morph, env, scope, path, params, hash, visitor);break;
        case 'block':
          env.hooks.block(morph, env, scope, path, params, hash, template, inverse, visitor);break;
        default:
          throw new Error("Internal HTMLBars redirection to " + redirect + " not supported");
      }
      return true;
    }

    if (handleKeyword(path, morph, env, scope, params, hash, template, inverse, visitor)) {
      return true;
    }

    return false;
  }

  function handleKeyword(path, morph, env, scope, params, hash, template, inverse, visitor) {
    var keyword = env.hooks.keywords[path];
    if (!keyword) {
      return false;
    }

    if (typeof keyword === 'function') {
      return keyword(morph, env, scope, params, hash, template, inverse, visitor);
    }

    if (keyword.willRender) {
      keyword.willRender(morph, env);
    }

    var lastState, newState;
    if (keyword.setupState) {
      lastState = object_utils.shallowCopy(morph.state);
      newState = morph.state = keyword.setupState(lastState, env, scope, params, hash);
    }

    if (keyword.childEnv) {
      // Build the child environment...
      env = keyword.childEnv(morph.state, env);

      // ..then save off the child env builder on the render node. If the render
      // node tree is re-rendered and this node is not dirty, the child env
      // builder will still be invoked so that child dirty render nodes still get
      // the correct child env.
      morph.buildChildEnv = keyword.childEnv;
    }

    var firstTime = !morph.rendered;

    if (keyword.isEmpty) {
      var isEmpty = keyword.isEmpty(morph.state, env, scope, params, hash);

      if (isEmpty) {
        if (!firstTime) {
          template_utils.clearMorph(morph, env, false);
        }
        return true;
      }
    }

    if (firstTime) {
      if (keyword.render) {
        keyword.render(morph, env, scope, params, hash, template, inverse, visitor);
      }
      morph.rendered = true;
      return true;
    }

    var isStable;
    if (keyword.isStable) {
      isStable = keyword.isStable(lastState, newState);
    } else {
      isStable = stableState(lastState, newState);
    }

    if (isStable) {
      if (keyword.rerender) {
        var newEnv = keyword.rerender(morph, env, scope, params, hash, template, inverse, visitor);
        env = newEnv || env;
      }
      morph_utils.validateChildMorphs(env, morph, visitor);
      return true;
    } else {
      template_utils.clearMorph(morph, env, false);
    }

    // If the node is unstable, re-render from scratch
    if (keyword.render) {
      keyword.render(morph, env, scope, params, hash, template, inverse, visitor);
      morph.rendered = true;
      return true;
    }
  }

  function stableState(oldState, newState) {
    if (object_utils.keyLength(oldState) !== object_utils.keyLength(newState)) {
      return false;
    }

    for (var prop in oldState) {
      if (oldState[prop] !== newState[prop]) {
        return false;
      }
    }

    return true;
  }

  function linkRenderNode() /* morph, env, scope, params, hash */{
    return;
  }

  /**
    Host Hook: inline

    @param {RenderNode} renderNode
    @param {Environment} env
    @param {Scope} scope
    @param {String} path
    @param {Array} params
    @param {Hash} hash

    Corresponds to:

    ```hbs
    {{helper param1 param2 key1=val1 key2=val2}}
    ```

    This host hook is similar to the `block` host hook, but it
    invokes helpers that do not supply an attached block.

    Like the `block` hook, the helper should be invoked with:

    - `{Array} params`: the parameters passed to the helper
      in the template.
    - `{Object} hash`: an object containing the keys and values passed
      in the hash position in the template.

    The values in `params` and `hash` will already be resolved
    through a previous call to the `get` host hook.

    In general, the default implementation of `inline` should work
    for most host environments. It delegates to other host hooks
    where appropriate, and properly invokes the helper with the
    appropriate arguments.

    The default implementation of `inline` also makes `partial`
    a keyword. Instead of invoking a helper named `partial`,
    it invokes the `partial` host hook.
  */

  function inline(morph, env, scope, path, params, hash, visitor) {
    if (handleRedirect(morph, env, scope, path, params, hash, null, null, visitor)) {
      return;
    }

    var value = undefined,
        hasValue = undefined;
    if (morph.linkedResult) {
      value = env.hooks.getValue(morph.linkedResult);
      hasValue = true;
    } else {
      var options = optionsFor(null, null, env, scope, morph);

      var helper = env.hooks.lookupHelper(env, scope, path);
      var result = env.hooks.invokeHelper(morph, env, scope, visitor, params, hash, helper, options.templates, thisFor(options.templates));

      if (result && result.link) {
        morph.linkedResult = result.value;
        morph_utils.linkParams(env, scope, morph, '@content-helper', [morph.linkedResult], null);
      }

      if (result && 'value' in result) {
        value = env.hooks.getValue(result.value);
        hasValue = true;
      }
    }

    if (hasValue) {
      if (morph.lastValue !== value) {
        morph.setContent(value);
      }
      morph.lastValue = value;
    }
  }

  function keyword(path, morph, env, scope, params, hash, template, inverse, visitor) {
    handleKeyword(path, morph, env, scope, params, hash, template, inverse, visitor);
  }

  function invokeHelper(morph, env, scope, visitor, _params, _hash, helper, templates, context) {
    var params = normalizeArray(env, _params);
    var hash = normalizeObject(env, _hash);
    return { value: helper.call(context, params, hash, templates) };
  }

  function normalizeArray(env, array) {
    var out = new Array(array.length);

    for (var i = 0, l = array.length; i < l; i++) {
      out[i] = env.hooks.getCellOrValue(array[i]);
    }

    return out;
  }

  function normalizeObject(env, object) {
    var out = {};

    for (var prop in object) {
      out[prop] = env.hooks.getCellOrValue(object[prop]);
    }

    return out;
  }

  function classify() /* env, scope, path */{
    return null;
  }

  var keywords = {
    partial: function (morph, env, scope, params) {
      var value = env.hooks.partial(morph, env, scope, params[0]);
      morph.setContent(value);
      return true;
    },

    yield: function (morph, env, scope, params, hash, template, inverse, visitor) {
      // the current scope is provided purely for the creation of shadow
      // scopes; it should not be provided to user code.

      var to = env.hooks.getValue(hash.to) || 'default';
      if (scope.blocks[to]) {
        scope.blocks[to](env, params, hash.self, morph, scope, visitor);
      }
      return true;
    },

    hasBlock: function (morph, env, scope, params) {
      var name = env.hooks.getValue(params[0]) || 'default';
      return !!scope.blocks[name];
    },

    hasBlockParams: function (morph, env, scope, params) {
      var name = env.hooks.getValue(params[0]) || 'default';
      return !!(scope.blocks[name] && scope.blocks[name].arity);
    }

  };

  function partial(renderNode, env, scope, path) {
    var template = env.partials[path];
    return template.render(scope.self, env, {}).fragment;
  }

  /**
    Host hook: range

    @param {RenderNode} renderNode
    @param {Environment} env
    @param {Scope} scope
    @param {any} value

    Corresponds to:

    ```hbs
    {{content}}
    {{{unescaped}}}
    ```

    This hook is responsible for updating a render node
    that represents a range of content with a value.
  */

  function range(morph, env, scope, path, value, visitor) {
    if (handleRedirect(morph, env, scope, path, [value], {}, null, null, visitor)) {
      return;
    }

    value = env.hooks.getValue(value);

    if (morph.lastValue !== value) {
      morph.setContent(value);
    }

    morph.lastValue = value;
  }

  /**
    Host hook: element

    @param {RenderNode} renderNode
    @param {Environment} env
    @param {Scope} scope
    @param {String} path
    @param {Array} params
    @param {Hash} hash

    Corresponds to:

    ```hbs
    <div {{bind-attr foo=bar}}></div>
    ```

    This hook is responsible for invoking a helper that
    modifies an element.

    Its purpose is largely legacy support for awkward
    idioms that became common when using the string-based
    Handlebars engine.

    Most of the uses of the `element` hook are expected
    to be superseded by component syntax and the
    `attribute` hook.
  */

  function element(morph, env, scope, path, params, hash, visitor) {
    if (handleRedirect(morph, env, scope, path, params, hash, null, null, visitor)) {
      return;
    }

    var helper = env.hooks.lookupHelper(env, scope, path);
    if (helper) {
      env.hooks.invokeHelper(null, env, scope, null, params, hash, helper, { element: morph.element });
    }
  }

  /**
    Host hook: attribute

    @param {RenderNode} renderNode
    @param {Environment} env
    @param {String} name
    @param {any} value

    Corresponds to:

    ```hbs
    <div foo={{bar}}></div>
    ```

    This hook is responsible for updating a render node
    that represents an element's attribute with a value.

    It receives the name of the attribute as well as an
    already-resolved value, and should update the render
    node with the value if appropriate.
  */

  function attribute(morph, env, scope, name, value) {
    value = env.hooks.getValue(value);

    if (morph.lastValue !== value) {
      morph.setContent(value);
    }

    morph.lastValue = value;
  }

  function subexpr(env, scope, helperName, params, hash) {
    var helper = env.hooks.lookupHelper(env, scope, helperName);
    var result = env.hooks.invokeHelper(null, env, scope, null, params, hash, helper, {});
    if (result && 'value' in result) {
      return env.hooks.getValue(result.value);
    }
  }

  /**
    Host Hook: get

    @param {Environment} env
    @param {Scope} scope
    @param {String} path

    Corresponds to:

    ```hbs
    {{foo.bar}}
      ^

    {{helper foo.bar key=value}}
             ^           ^
    ```

    This hook is the "leaf" hook of the system. It is used to
    resolve a path relative to the current scope.
  */

  function get(env, scope, path) {
    if (path === '') {
      return scope.self;
    }

    var keys = path.split('.');
    var value = env.hooks.getRoot(scope, keys[0])[0];

    for (var i = 1; i < keys.length; i++) {
      if (value) {
        value = env.hooks.getChild(value, keys[i]);
      } else {
        break;
      }
    }

    return value;
  }

  function getRoot(scope, key) {
    if (scope.localPresent[key]) {
      return [scope.locals[key]];
    } else if (scope.self) {
      return [scope.self[key]];
    } else {
      return [undefined];
    }
  }

  function getChild(value, key) {
    return value[key];
  }

  function getValue(reference) {
    return reference;
  }

  function getCellOrValue(reference) {
    return reference;
  }

  function component(morph, env, scope, tagName, params, attrs, templates, visitor) {
    if (env.hooks.hasHelper(env, scope, tagName)) {
      return env.hooks.block(morph, env, scope, tagName, params, attrs, templates.default, templates.inverse, visitor);
    }

    componentFallback(morph, env, scope, tagName, attrs, templates.default);
  }

  function concat(env, params) {
    var value = "";
    for (var i = 0, l = params.length; i < l; i++) {
      value += env.hooks.getValue(params[i]);
    }
    return value;
  }

  function componentFallback(morph, env, scope, tagName, attrs, template) {
    var element = env.dom.createElement(tagName);
    for (var name in attrs) {
      element.setAttribute(name, env.hooks.getValue(attrs[name]));
    }
    var fragment = render['default'](template, env, scope, {}).fragment;
    element.appendChild(fragment);
    morph.setNode(element);
  }

  function hasHelper(env, scope, helperName) {
    return env.helpers[helperName] !== undefined;
  }

  function lookupHelper(env, scope, helperName) {
    return env.helpers[helperName];
  }

  function bindScope() /* env, scope */{
    // this function is used to handle host-specified extensions to scope
    // other than `self`, `locals` and `block`.
  }

  function updateScope(env, scope) {
    env.hooks.bindScope(env, scope);
  }

  exports['default'] = {
    // fundamental hooks that you will likely want to override
    bindLocal: bindLocal,
    bindSelf: bindSelf,
    bindScope: bindScope,
    classify: classify,
    component: component,
    concat: concat,
    createFreshScope: createFreshScope,
    getChild: getChild,
    getRoot: getRoot,
    getValue: getValue,
    getCellOrValue: getCellOrValue,
    keywords: keywords,
    linkRenderNode: linkRenderNode,
    partial: partial,
    subexpr: subexpr,

    // fundamental hooks with good default behavior
    bindBlock: bindBlock,
    bindShadowScope: bindShadowScope,
    updateLocal: updateLocal,
    updateSelf: updateSelf,
    updateScope: updateScope,
    createChildScope: createChildScope,
    hasHelper: hasHelper,
    lookupHelper: lookupHelper,
    invokeHelper: invokeHelper,
    cleanupRenderNode: null,
    destroyRenderNode: null,
    willCleanupTree: null,
    didCleanupTree: null,
    willRenderNode: null,
    didRenderNode: null,

    // derived hooks
    attribute: attribute,
    block: block,
    createScope: createScope,
    element: element,
    get: get,
    inline: inline,
    range: range,
    keyword: keyword
  };

  exports.keywords = keywords;

});
define('htmlbars-runtime/hooks.jshint', function () {

  'use strict';

  QUnit.module('JSHint - htmlbars-runtime');
  QUnit.test('htmlbars-runtime/hooks.js should pass jshint', function (assert) {
    assert.ok(true, 'htmlbars-runtime/hooks.js should pass jshint.');
  });

});
define('htmlbars-runtime/morph', ['exports', '../morph-range'], function (exports, MorphBase) {

  'use strict';

  var guid = 1;

  function HTMLBarsMorph(domHelper, contextualElement) {
    this.super$constructor(domHelper, contextualElement);

    this.state = {};
    this.ownerNode = null;
    this.isDirty = false;
    this.isSubtreeDirty = false;
    this.lastYielded = null;
    this.lastResult = null;
    this.lastValue = null;
    this.buildChildEnv = null;
    this.morphList = null;
    this.morphMap = null;
    this.key = null;
    this.linkedParams = null;
    this.linkedResult = null;
    this.childNodes = null;
    this.rendered = false;
    this.guid = "range" + guid++;
  }

  HTMLBarsMorph.empty = function (domHelper, contextualElement) {
    var morph = new HTMLBarsMorph(domHelper, contextualElement);
    morph.clear();
    return morph;
  };

  HTMLBarsMorph.create = function (domHelper, contextualElement, node) {
    var morph = new HTMLBarsMorph(domHelper, contextualElement);
    morph.setNode(node);
    return morph;
  };

  HTMLBarsMorph.attach = function (domHelper, contextualElement, firstNode, lastNode) {
    var morph = new HTMLBarsMorph(domHelper, contextualElement);
    morph.setRange(firstNode, lastNode);
    return morph;
  };

  var prototype = HTMLBarsMorph.prototype = Object.create(MorphBase['default'].prototype);
  prototype.constructor = HTMLBarsMorph;
  prototype.super$constructor = MorphBase['default'];

  exports['default'] = HTMLBarsMorph;

});
define('htmlbars-runtime/morph.jshint', function () {

  'use strict';

  QUnit.module('JSHint - htmlbars-runtime');
  QUnit.test('htmlbars-runtime/morph.js should pass jshint', function (assert) {
    assert.ok(true, 'htmlbars-runtime/morph.js should pass jshint.');
  });

});
define('htmlbars-runtime/render', ['exports', '../htmlbars-util/array-utils', '../htmlbars-util/morph-utils', './expression-visitor', './morph', '../htmlbars-util/template-utils', '../htmlbars-util/void-tag-names'], function (exports, array_utils, morph_utils, ExpressionVisitor, Morph, template_utils, voidMap) {

  'use strict';

  exports.manualElement = manualElement;
  exports.attachAttributes = attachAttributes;
  exports.createChildMorph = createChildMorph;
  exports.getCachedFragment = getCachedFragment;

  exports['default'] = render;

  var svgNamespace = "http://www.w3.org/2000/svg";
  function render(template, env, scope, options) {
    var dom = env.dom;
    var contextualElement;

    if (options) {
      if (options.renderNode) {
        contextualElement = options.renderNode.contextualElement;
      } else if (options.contextualElement) {
        contextualElement = options.contextualElement;
      }
    }

    dom.detectNamespace(contextualElement);

    var renderResult = RenderResult.build(env, scope, template, options, contextualElement);
    renderResult.render();

    return renderResult;
  }

  function RenderResult(env, scope, options, rootNode, ownerNode, nodes, fragment, template, shouldSetContent) {
    this.root = rootNode;
    this.fragment = fragment;

    this.nodes = nodes;
    this.template = template;
    this.statements = template.statements.slice();
    this.env = env;
    this.scope = scope;
    this.shouldSetContent = shouldSetContent;

    this.bindScope();

    if (options.attributes !== undefined) {
      nodes.push({ state: {} });
      this.statements.push(['attributes', attachAttributes(options.attributes)]);
    }

    if (options.self !== undefined) {
      this.bindSelf(options.self);
    }
    if (options.blockArguments !== undefined) {
      this.bindLocals(options.blockArguments);
    }

    this.initializeNodes(ownerNode);
  }

  RenderResult.build = function (env, scope, template, options, contextualElement) {
    var dom = env.dom;
    var fragment = getCachedFragment(template, env);
    var nodes = template.buildRenderNodes(dom, fragment, contextualElement);

    var rootNode, ownerNode, shouldSetContent;

    if (options && options.renderNode) {
      rootNode = options.renderNode;
      ownerNode = rootNode.ownerNode;
      shouldSetContent = true;
    } else {
      rootNode = dom.createMorph(null, fragment.firstChild, fragment.lastChild, contextualElement);
      ownerNode = rootNode;
      initializeNode(rootNode, ownerNode);
      shouldSetContent = false;
    }

    if (rootNode.childNodes) {
      morph_utils.visitChildren(rootNode.childNodes, function (node) {
        template_utils.clearMorph(node, env, true);
      });
    }

    rootNode.childNodes = nodes;
    return new RenderResult(env, scope, options, rootNode, ownerNode, nodes, fragment, template, shouldSetContent);
  };

  function manualElement(tagName, attributes) {
    var statements = [];

    for (var key in attributes) {
      if (typeof attributes[key] === 'string') {
        continue;
      }
      statements.push(["attribute", key, attributes[key]]);
    }

    statements.push(['content', 'yield']);

    var template = {
      arity: 0,
      cachedFragment: null,
      hasRendered: false,
      buildFragment: function buildFragment(dom) {
        var el0 = dom.createDocumentFragment();
        if (tagName === 'svg') {
          dom.setNamespace(svgNamespace);
        }
        var el1 = dom.createElement(tagName);

        for (var key in attributes) {
          if (typeof attributes[key] !== 'string') {
            continue;
          }
          dom.setAttribute(el1, key, attributes[key]);
        }

        if (!voidMap['default'][tagName]) {
          var el2 = dom.createComment("");
          dom.appendChild(el1, el2);
        }

        dom.appendChild(el0, el1);

        return el0;
      },
      buildRenderNodes: function buildRenderNodes(dom, fragment) {
        var element = dom.childAt(fragment, [0]);
        var morphs = [];

        for (var key in attributes) {
          if (typeof attributes[key] === 'string') {
            continue;
          }
          morphs.push(dom.createAttrMorph(element, key));
        }

        morphs.push(dom.createMorphAt(element, 0, 0));
        return morphs;
      },
      statements: statements,
      locals: [],
      templates: []
    };

    return template;
  }

  function attachAttributes(attributes) {
    var statements = [];

    for (var key in attributes) {
      if (typeof attributes[key] === 'string') {
        continue;
      }
      statements.push(["attribute", key, attributes[key]]);
    }

    var template = {
      arity: 0,
      cachedFragment: null,
      hasRendered: false,
      buildFragment: function buildFragment(dom) {
        var el0 = this.element;
        if (el0.namespaceURI === "http://www.w3.org/2000/svg") {
          dom.setNamespace(svgNamespace);
        }
        for (var key in attributes) {
          if (typeof attributes[key] !== 'string') {
            continue;
          }
          dom.setAttribute(el0, key, attributes[key]);
        }

        return el0;
      },
      buildRenderNodes: function buildRenderNodes(dom) {
        var element = this.element;
        var morphs = [];

        for (var key in attributes) {
          if (typeof attributes[key] === 'string') {
            continue;
          }
          morphs.push(dom.createAttrMorph(element, key));
        }

        return morphs;
      },
      statements: statements,
      locals: [],
      templates: [],
      element: null
    };

    return template;
  }

  RenderResult.prototype.initializeNodes = function (ownerNode) {
    array_utils.forEach(this.root.childNodes, function (node) {
      initializeNode(node, ownerNode);
    });
  };

  RenderResult.prototype.render = function () {
    this.root.lastResult = this;
    this.root.rendered = true;
    this.populateNodes(ExpressionVisitor.AlwaysDirtyVisitor);

    if (this.shouldSetContent && this.root.setContent) {
      this.root.setContent(this.fragment);
    }
  };

  RenderResult.prototype.dirty = function () {
    morph_utils.visitChildren([this.root], function (node) {
      node.isDirty = true;
    });
  };

  RenderResult.prototype.revalidate = function (env, self, blockArguments, scope) {
    this.revalidateWith(env, scope, self, blockArguments, ExpressionVisitor['default']);
  };

  RenderResult.prototype.rerender = function (env, self, blockArguments, scope) {
    this.revalidateWith(env, scope, self, blockArguments, ExpressionVisitor.AlwaysDirtyVisitor);
  };

  RenderResult.prototype.revalidateWith = function (env, scope, self, blockArguments, visitor) {
    if (env !== undefined) {
      this.env = env;
    }
    if (scope !== undefined) {
      this.scope = scope;
    }
    this.updateScope();

    if (self !== undefined) {
      this.updateSelf(self);
    }
    if (blockArguments !== undefined) {
      this.updateLocals(blockArguments);
    }

    this.populateNodes(visitor);
  };

  RenderResult.prototype.destroy = function () {
    var rootNode = this.root;
    template_utils.clearMorph(rootNode, this.env, true);
  };

  RenderResult.prototype.populateNodes = function (visitor) {
    var env = this.env;
    var scope = this.scope;
    var template = this.template;
    var nodes = this.nodes;
    var statements = this.statements;
    var i, l;

    for (i = 0, l = statements.length; i < l; i++) {
      var statement = statements[i];
      var morph = nodes[i];

      if (env.hooks.willRenderNode) {
        env.hooks.willRenderNode(morph, env, scope);
      }

      switch (statement[0]) {
        case 'block':
          visitor.block(statement, morph, env, scope, template, visitor);break;
        case 'inline':
          visitor.inline(statement, morph, env, scope, visitor);break;
        case 'content':
          visitor.content(statement, morph, env, scope, visitor);break;
        case 'element':
          visitor.element(statement, morph, env, scope, template, visitor);break;
        case 'attribute':
          visitor.attribute(statement, morph, env, scope);break;
        case 'component':
          visitor.component(statement, morph, env, scope, template, visitor);break;
        case 'attributes':
          visitor.attributes(statement, morph, env, scope, this.fragment, visitor);break;
      }

      if (env.hooks.didRenderNode) {
        env.hooks.didRenderNode(morph, env, scope);
      }
    }
  };

  RenderResult.prototype.bindScope = function () {
    this.env.hooks.bindScope(this.env, this.scope);
  };

  RenderResult.prototype.updateScope = function () {
    this.env.hooks.updateScope(this.env, this.scope);
  };

  RenderResult.prototype.bindSelf = function (self) {
    this.env.hooks.bindSelf(this.env, this.scope, self);
  };

  RenderResult.prototype.updateSelf = function (self) {
    this.env.hooks.updateSelf(this.env, this.scope, self);
  };

  RenderResult.prototype.bindLocals = function (blockArguments) {
    var localNames = this.template.locals;

    for (var i = 0, l = localNames.length; i < l; i++) {
      this.env.hooks.bindLocal(this.env, this.scope, localNames[i], blockArguments[i]);
    }
  };

  RenderResult.prototype.updateLocals = function (blockArguments) {
    var localNames = this.template.locals;

    for (var i = 0, l = localNames.length; i < l; i++) {
      this.env.hooks.updateLocal(this.env, this.scope, localNames[i], blockArguments[i]);
    }
  };

  function initializeNode(node, owner) {
    node.ownerNode = owner;
  }

  function createChildMorph(dom, parentMorph, contextualElement) {
    var morph = Morph['default'].empty(dom, contextualElement || parentMorph.contextualElement);
    initializeNode(morph, parentMorph.ownerNode);
    return morph;
  }

  function getCachedFragment(template, env) {
    var dom = env.dom,
        fragment;
    if (env.useFragmentCache && dom.canClone) {
      if (template.cachedFragment === null) {
        fragment = template.buildFragment(dom);
        if (template.hasRendered) {
          template.cachedFragment = fragment;
        } else {
          template.hasRendered = true;
        }
      }
      if (template.cachedFragment) {
        fragment = dom.cloneNode(template.cachedFragment, true);
      }
    } else if (!fragment) {
      fragment = template.buildFragment(dom);
    }

    return fragment;
  }

});
define('htmlbars-runtime/render.jshint', function () {

  'use strict';

  QUnit.module('JSHint - htmlbars-runtime');
  QUnit.test('htmlbars-runtime/render.js should pass jshint', function (assert) {
    assert.ok(true, 'htmlbars-runtime/render.js should pass jshint.');
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
define('morph-attr', ['exports', './morph-attr/sanitize-attribute-value', './dom-helper/prop', './dom-helper/build-html-dom', './htmlbars-util'], function (exports, sanitize_attribute_value, prop, build_html_dom, htmlbars_util) {

  'use strict';

  function getProperty() {
    return this.domHelper.getPropertyStrict(this.element, this.attrName);
  }

  function updateProperty(value) {
    if (this._renderedInitially === true || !prop.isAttrRemovalValue(value)) {
      var element = this.element;
      var attrName = this.attrName;

      if (attrName === 'value' && element.tagName === 'INPUT' && element.value === value) {
        // Do nothing. Attempts to avoid accidently changing the input cursor location.
        // See https://github.com/tildeio/htmlbars/pull/447 for more details.
      } else {
          // do not render if initial value is undefined or null
          this.domHelper.setPropertyStrict(element, attrName, value);
        }
    }

    this._renderedInitially = true;
  }

  function getAttribute() {
    return this.domHelper.getAttribute(this.element, this.attrName);
  }

  function updateAttribute(value) {
    if (prop.isAttrRemovalValue(value)) {
      this.domHelper.removeAttribute(this.element, this.attrName);
    } else {
      this.domHelper.setAttribute(this.element, this.attrName, value);
    }
  }

  function getAttributeNS() {
    return this.domHelper.getAttributeNS(this.element, this.namespace, this.attrName);
  }

  function updateAttributeNS(value) {
    if (prop.isAttrRemovalValue(value)) {
      this.domHelper.removeAttribute(this.element, this.attrName);
    } else {
      this.domHelper.setAttributeNS(this.element, this.namespace, this.attrName, value);
    }
  }

  var UNSET = { unset: true };

  var guid = 1;

  function AttrMorph(element, attrName, domHelper, namespace) {
    this.element = element;
    this.domHelper = domHelper;
    this.namespace = namespace !== undefined ? namespace : htmlbars_util.getAttrNamespace(attrName);
    this.state = {};
    this.isDirty = false;
    this.isSubtreeDirty = false;
    this.escaped = true;
    this.lastValue = UNSET;
    this.lastResult = null;
    this.lastYielded = null;
    this.childNodes = null;
    this.linkedParams = null;
    this.linkedResult = null;
    this.guid = "attr" + guid++;
    this.ownerNode = null;
    this.rendered = false;
    this._renderedInitially = false;

    if (this.namespace) {
      this._update = updateAttributeNS;
      this._get = getAttributeNS;
      this.attrName = attrName;
    } else {
      var _normalizeProperty = prop.normalizeProperty(this.element, attrName);

      var normalized = _normalizeProperty.normalized;
      var type = _normalizeProperty.type;

      if (element.namespaceURI === build_html_dom.svgNamespace || attrName === 'style' || type === 'attr') {
        this._update = updateAttribute;
        this._get = getAttribute;
        this.attrName = normalized;
      } else {
        this._update = updateProperty;
        this._get = getProperty;
        this.attrName = normalized;
      }
    }
  }

  AttrMorph.prototype.setContent = function (value) {
    if (this.lastValue === value) {
      return;
    }
    this.lastValue = value;

    if (this.escaped) {
      var sanitized = sanitize_attribute_value.sanitizeAttributeValue(this.domHelper, this.element, this.attrName, value);
      this._update(sanitized, this.namespace);
    } else {
      this._update(value, this.namespace);
    }
  };

  AttrMorph.prototype.getContent = function () {
    var value = this.lastValue = this._get();
    return value;
  };

  // renderAndCleanup calls `clear` on all items in the morph map
  // just before calling `destroy` on the morph.
  //
  // As a future refactor this could be changed to set the property
  // back to its original/default value.
  AttrMorph.prototype.clear = function () {};

  AttrMorph.prototype.destroy = function () {
    this.element = null;
    this.domHelper = null;
  };

  exports['default'] = AttrMorph;

  exports.sanitizeAttributeValue = sanitize_attribute_value.sanitizeAttributeValue;

});
define('morph-attr.jshint', function () {

  'use strict';

  QUnit.module('JSHint - .');
  QUnit.test('morph-attr.js should pass jshint', function (assert) {
    assert.ok(true, 'morph-attr.js should pass jshint.');
  });

});
define('morph-attr/sanitize-attribute-value', ['exports'], function (exports) {

  'use strict';

  exports.sanitizeAttributeValue = sanitizeAttributeValue;

  var badProtocols = {
    'javascript:': true,
    'vbscript:': true
  };

  var badTags = {
    'A': true,
    'BODY': true,
    'LINK': true,
    'IMG': true,
    'IFRAME': true,
    'BASE': true,
    'FORM': true
  };

  var badTagsForDataURI = {
    'EMBED': true
  };

  var badAttributes = {
    'href': true,
    'src': true,
    'background': true,
    'action': true
  };

  var badAttributesForDataURI = {
    'src': true
  };

  function sanitizeAttributeValue(dom, element, attribute, value) {
    var tagName;

    if (!element) {
      tagName = null;
    } else {
      tagName = element.tagName.toUpperCase();
    }

    if (value && value.toHTML) {
      return value.toHTML();
    }

    if ((tagName === null || badTags[tagName]) && badAttributes[attribute]) {
      var protocol = dom.protocolForURL(value);
      if (badProtocols[protocol] === true) {
        return 'unsafe:' + value;
      }
    }

    if (badTagsForDataURI[tagName] && badAttributesForDataURI[attribute]) {
      return 'unsafe:' + value;
    }

    return value;
  }

  exports.badAttributes = badAttributes;

});
define('morph-attr/sanitize-attribute-value.jshint', function () {

  'use strict';

  QUnit.module('JSHint - morph-attr');
  QUnit.test('morph-attr/sanitize-attribute-value.js should pass jshint', function (assert) {
    assert.ok(true, 'morph-attr/sanitize-attribute-value.js should pass jshint.');
  });

});
define('morph-range', ['exports', './morph-range/utils'], function (exports, utils) {

  'use strict';

  function Morph(domHelper, contextualElement) {
    this.domHelper = domHelper;
    // context if content if current content is detached
    this.contextualElement = contextualElement;
    // inclusive range of morph
    // these should be nodeType 1, 3, or 8
    this.firstNode = null;
    this.lastNode = null;

    // flag to force text to setContent to be treated as html
    this.parseTextAsHTML = false;

    // morph list graph
    this.parentMorphList = null;
    this.previousMorph = null;
    this.nextMorph = null;
  }

  Morph.empty = function (domHelper, contextualElement) {
    var morph = new Morph(domHelper, contextualElement);
    morph.clear();
    return morph;
  };

  Morph.create = function (domHelper, contextualElement, node) {
    var morph = new Morph(domHelper, contextualElement);
    morph.setNode(node);
    return morph;
  };

  Morph.attach = function (domHelper, contextualElement, firstNode, lastNode) {
    var morph = new Morph(domHelper, contextualElement);
    morph.setRange(firstNode, lastNode);
    return morph;
  };

  Morph.prototype.setContent = function Morph$setContent(content) {
    if (content === null || content === undefined) {
      return this.clear();
    }

    var type = typeof content;
    switch (type) {
      case 'string':
        if (this.parseTextAsHTML) {
          return this.domHelper.setMorphHTML(this, content);
        }
        return this.setText(content);
      case 'object':
        if (typeof content.nodeType === 'number') {
          return this.setNode(content);
        }
        /* Handlebars.SafeString */
        if (typeof content.toHTML === 'function') {
          return this.setHTML(content.toHTML());
        }
        if (this.parseTextAsHTML) {
          return this.setHTML(content.toString());
        }
      /* falls through */
      case 'boolean':
      case 'number':
        return this.setText(content.toString());
      default:
        throw new TypeError('unsupported content');
    }
  };

  Morph.prototype.clear = function Morph$clear() {
    var node = this.setNode(this.domHelper.createComment(''));
    return node;
  };

  Morph.prototype.setText = function Morph$setText(text) {
    var firstNode = this.firstNode;
    var lastNode = this.lastNode;

    if (firstNode && lastNode === firstNode && firstNode.nodeType === 3) {
      firstNode.nodeValue = text;
      return firstNode;
    }

    return this.setNode(text ? this.domHelper.createTextNode(text) : this.domHelper.createComment(''));
  };

  Morph.prototype.setNode = function Morph$setNode(newNode) {
    var firstNode, lastNode;
    switch (newNode.nodeType) {
      case 3:
        firstNode = newNode;
        lastNode = newNode;
        break;
      case 11:
        firstNode = newNode.firstChild;
        lastNode = newNode.lastChild;
        if (firstNode === null) {
          firstNode = this.domHelper.createComment('');
          newNode.appendChild(firstNode);
          lastNode = firstNode;
        }
        break;
      default:
        firstNode = newNode;
        lastNode = newNode;
        break;
    }

    this.setRange(firstNode, lastNode);

    return newNode;
  };

  Morph.prototype.setRange = function (firstNode, lastNode) {
    var previousFirstNode = this.firstNode;
    if (previousFirstNode !== null) {

      var parentNode = previousFirstNode.parentNode;
      if (parentNode !== null) {
        utils.insertBefore(parentNode, firstNode, lastNode, previousFirstNode);
        utils.clear(parentNode, previousFirstNode, this.lastNode);
      }
    }

    this.firstNode = firstNode;
    this.lastNode = lastNode;

    if (this.parentMorphList) {
      this._syncFirstNode();
      this._syncLastNode();
    }
  };

  Morph.prototype.destroy = function Morph$destroy() {
    this.unlink();

    var firstNode = this.firstNode;
    var lastNode = this.lastNode;
    var parentNode = firstNode && firstNode.parentNode;

    this.firstNode = null;
    this.lastNode = null;

    utils.clear(parentNode, firstNode, lastNode);
  };

  Morph.prototype.unlink = function Morph$unlink() {
    var parentMorphList = this.parentMorphList;
    var previousMorph = this.previousMorph;
    var nextMorph = this.nextMorph;

    if (previousMorph) {
      if (nextMorph) {
        previousMorph.nextMorph = nextMorph;
        nextMorph.previousMorph = previousMorph;
      } else {
        previousMorph.nextMorph = null;
        parentMorphList.lastChildMorph = previousMorph;
      }
    } else {
      if (nextMorph) {
        nextMorph.previousMorph = null;
        parentMorphList.firstChildMorph = nextMorph;
      } else if (parentMorphList) {
        parentMorphList.lastChildMorph = parentMorphList.firstChildMorph = null;
      }
    }

    this.parentMorphList = null;
    this.nextMorph = null;
    this.previousMorph = null;

    if (parentMorphList && parentMorphList.mountedMorph) {
      if (!parentMorphList.firstChildMorph) {
        // list is empty
        parentMorphList.mountedMorph.clear();
        return;
      } else {
        parentMorphList.firstChildMorph._syncFirstNode();
        parentMorphList.lastChildMorph._syncLastNode();
      }
    }
  };

  Morph.prototype.setHTML = function (text) {
    var fragment = this.domHelper.parseHTML(text, this.contextualElement);
    return this.setNode(fragment);
  };

  Morph.prototype.setMorphList = function Morph$appendMorphList(morphList) {
    morphList.mountedMorph = this;
    this.clear();

    var originalFirstNode = this.firstNode;

    if (morphList.firstChildMorph) {
      this.firstNode = morphList.firstChildMorph.firstNode;
      this.lastNode = morphList.lastChildMorph.lastNode;

      var current = morphList.firstChildMorph;

      while (current) {
        var next = current.nextMorph;
        current.insertBeforeNode(originalFirstNode, null);
        current = next;
      }
      originalFirstNode.parentNode.removeChild(originalFirstNode);
    }
  };

  Morph.prototype._syncFirstNode = function Morph$syncFirstNode() {
    var morph = this;
    var parentMorphList;
    while (parentMorphList = morph.parentMorphList) {
      if (parentMorphList.mountedMorph === null) {
        break;
      }
      if (morph !== parentMorphList.firstChildMorph) {
        break;
      }
      if (morph.firstNode === parentMorphList.mountedMorph.firstNode) {
        break;
      }

      parentMorphList.mountedMorph.firstNode = morph.firstNode;

      morph = parentMorphList.mountedMorph;
    }
  };

  Morph.prototype._syncLastNode = function Morph$syncLastNode() {
    var morph = this;
    var parentMorphList;
    while (parentMorphList = morph.parentMorphList) {
      if (parentMorphList.mountedMorph === null) {
        break;
      }
      if (morph !== parentMorphList.lastChildMorph) {
        break;
      }
      if (morph.lastNode === parentMorphList.mountedMorph.lastNode) {
        break;
      }

      parentMorphList.mountedMorph.lastNode = morph.lastNode;

      morph = parentMorphList.mountedMorph;
    }
  };

  Morph.prototype.insertBeforeNode = function Morph$insertBeforeNode(parentNode, refNode) {
    utils.insertBefore(parentNode, this.firstNode, this.lastNode, refNode);
  };

  Morph.prototype.appendToNode = function Morph$appendToNode(parentNode) {
    utils.insertBefore(parentNode, this.firstNode, this.lastNode, null);
  };

  exports['default'] = Morph;

});
define('morph-range.jshint', function () {

  'use strict';

  QUnit.module('JSHint - .');
  QUnit.test('morph-range.js should pass jshint', function (assert) {
    assert.ok(false, 'morph-range.js should pass jshint.\nmorph-range.js: line 221, col 49, Expected a conditional expression and instead saw an assignment.\nmorph-range.js: line 241, col 49, Expected a conditional expression and instead saw an assignment.\n\n2 errors');
  });

});
define('morph-range.umd', ['./morph-range'], function (Morph) {

  'use strict';

  (function (root, factory) {
    if (typeof define === 'function' && define.amd) {
      define([], factory);
    } else if (typeof exports === 'object') {
      module.exports = factory();
    } else {
      root.Morph = factory();
    }
  })(undefined, function () {
    return Morph['default'];
  });

});
define('morph-range.umd.jshint', function () {

  'use strict';

  QUnit.module('JSHint - .');
  QUnit.test('morph-range.umd.js should pass jshint', function (assert) {
    assert.ok(false, 'morph-range.umd.js should pass jshint.\nmorph-range.umd.js: line 4, col 39, \'define\' is not defined.\nmorph-range.umd.js: line 5, col 5, \'define\' is not defined.\nmorph-range.umd.js: line 7, col 5, \'module\' is not defined.\n\n3 errors');
  });

});
define('morph-range/morph-list', ['exports', './utils'], function (exports, utils) {

  'use strict';

  function MorphList() {
    // morph graph
    this.firstChildMorph = null;
    this.lastChildMorph = null;

    this.mountedMorph = null;
  }

  var prototype = MorphList.prototype;

  prototype.clear = function MorphList$clear() {
    var current = this.firstChildMorph;

    while (current) {
      var next = current.nextMorph;
      current.previousMorph = null;
      current.nextMorph = null;
      current.parentMorphList = null;
      current = next;
    }

    this.firstChildMorph = this.lastChildMorph = null;
  };

  prototype.destroy = function MorphList$destroy() {};

  prototype.appendMorph = function MorphList$appendMorph(morph) {
    this.insertBeforeMorph(morph, null);
  };

  prototype.insertBeforeMorph = function MorphList$insertBeforeMorph(morph, referenceMorph) {
    if (morph.parentMorphList !== null) {
      morph.unlink();
    }
    if (referenceMorph && referenceMorph.parentMorphList !== this) {
      throw new Error('The morph before which the new morph is to be inserted is not a child of this morph.');
    }

    var mountedMorph = this.mountedMorph;

    if (mountedMorph) {

      var parentNode = mountedMorph.firstNode.parentNode;
      var referenceNode = referenceMorph ? referenceMorph.firstNode : mountedMorph.lastNode.nextSibling;

      utils.insertBefore(parentNode, morph.firstNode, morph.lastNode, referenceNode);

      // was not in list mode replace current content
      if (!this.firstChildMorph) {
        utils.clear(this.mountedMorph.firstNode.parentNode, this.mountedMorph.firstNode, this.mountedMorph.lastNode);
      }
    }

    morph.parentMorphList = this;

    var previousMorph = referenceMorph ? referenceMorph.previousMorph : this.lastChildMorph;
    if (previousMorph) {
      previousMorph.nextMorph = morph;
      morph.previousMorph = previousMorph;
    } else {
      this.firstChildMorph = morph;
    }

    if (referenceMorph) {
      referenceMorph.previousMorph = morph;
      morph.nextMorph = referenceMorph;
    } else {
      this.lastChildMorph = morph;
    }

    this.firstChildMorph._syncFirstNode();
    this.lastChildMorph._syncLastNode();
  };

  prototype.removeChildMorph = function MorphList$removeChildMorph(morph) {
    if (morph.parentMorphList !== this) {
      throw new Error("Cannot remove a morph from a parent it is not inside of");
    }

    morph.destroy();
  };

  exports['default'] = MorphList;

});
define('morph-range/morph-list.jshint', function () {

  'use strict';

  QUnit.module('JSHint - morph-range');
  QUnit.test('morph-range/morph-list.js should pass jshint', function (assert) {
    assert.ok(true, 'morph-range/morph-list.js should pass jshint.');
  });

});
define('morph-range/morph-list.umd', ['./morph-list'], function (MorphList) {

  'use strict';

  (function (root, factory) {
    if (typeof define === 'function' && define.amd) {
      define([], factory);
    } else if (typeof exports === 'object') {
      module.exports = factory();
    } else {
      root.MorphList = factory();
    }
  })(undefined, function () {
    return MorphList['default'];
  });

});
define('morph-range/morph-list.umd.jshint', function () {

  'use strict';

  QUnit.module('JSHint - morph-range');
  QUnit.test('morph-range/morph-list.umd.js should pass jshint', function (assert) {
    assert.ok(false, 'morph-range/morph-list.umd.js should pass jshint.\nmorph-range/morph-list.umd.js: line 4, col 39, \'define\' is not defined.\nmorph-range/morph-list.umd.js: line 5, col 5, \'define\' is not defined.\nmorph-range/morph-list.umd.js: line 7, col 5, \'module\' is not defined.\n\n3 errors');
  });

});
define('morph-range/utils', ['exports'], function (exports) {

  'use strict';

  exports.clear = clear;
  exports.insertBefore = insertBefore;

  function clear(parentNode, firstNode, lastNode) {
    if (!parentNode) {
      return;
    }

    var node = firstNode;
    var nextNode;
    do {
      nextNode = node.nextSibling;
      parentNode.removeChild(node);
      if (node === lastNode) {
        break;
      }
      node = nextNode;
    } while (node);
  }

  function insertBefore(parentNode, firstNode, lastNode, refNode) {
    var node = firstNode;
    var nextNode;
    do {
      nextNode = node.nextSibling;
      parentNode.insertBefore(node, refNode);
      if (node === lastNode) {
        break;
      }
      node = nextNode;
    } while (node);
  }

});
define('morph-range/utils.jshint', function () {

  'use strict';

  QUnit.module('JSHint - morph-range');
  QUnit.test('morph-range/utils.js should pass jshint', function (assert) {
    assert.ok(true, 'morph-range/utils.js should pass jshint.');
  });

});