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
define('htmlbars-compiler', ['exports', './htmlbars-compiler/compiler'], function (exports, compiler) {

	'use strict';



	exports.compile = compiler.compile;
	exports.compileSpec = compiler.compileSpec;
	exports.template = compiler.template;

});
define('htmlbars-compiler/compiler', ['exports', '../htmlbars-syntax/parser', './template-compiler', '../htmlbars-runtime/hooks', '../htmlbars-runtime/render'], function (exports, parser, TemplateCompiler, hooks, render) {

  'use strict';

  exports.compileSpec = compileSpec;
  exports.template = template;
  exports.compile = compile;

  function compileSpec(string, options) {
    var ast = parser.preprocess(string, options);
    var compiler = new TemplateCompiler['default'](options);
    var program = compiler.compile(ast);
    return program;
  }

  /*
   * @method template
   * @param {TemplateSpec} templateSpec A precompiled template
   * @return {Template} A template spec string
   */

  function template(templateSpec) {
    return new Function("return " + templateSpec)();
  }

  /*
   * Compile a string into a template rendering function
   *
   * Example usage:
   *
   *     // Template is the hydration portion of the compiled template
   *     var template = compile("Howdy {{name}}");
   *
   *     // Template accepts three arguments:
   *     //
   *     //   1. A context object
   *     //   2. An env object
   *     //   3. A contextualElement (optional, document.body is the default)
   *     //
   *     // The env object *must* have at least these two properties:
   *     //
   *     //   1. `hooks` - Basic hooks for rendering a template
   *     //   2. `dom` - An instance of DOMHelper
   *     //
   *     import {hooks} from 'htmlbars-runtime';
   *     import {DOMHelper} from 'morph';
   *     var context = {name: 'whatever'},
   *         env = {hooks: hooks, dom: new DOMHelper()},
   *         contextualElement = document.body;
   *     var domFragment = template(context, env, contextualElement);
   *
   * @method compile
   * @param {String} string An HTMLBars template string
   * @param {Object} options A set of options to provide to the compiler
   * @return {Template} A function for rendering the template
   */

  function compile(string, options) {
    return hooks.wrap(template(compileSpec(string, options)), render['default']);
  }

});
define('htmlbars-compiler/fragment-javascript-compiler', ['exports', './utils', '../htmlbars-util/quoting'], function (exports, utils, quoting) {

  'use strict';

  var svgNamespace = "http://www.w3.org/2000/svg",

  // http://www.w3.org/html/wg/drafts/html/master/syntax.html#html-integration-point
  svgHTMLIntegrationPoints = { 'foreignObject': true, 'desc': true, 'title': true };

  function FragmentJavaScriptCompiler() {
    this.source = [];
    this.depth = -1;
  }

  exports['default'] = FragmentJavaScriptCompiler;

  FragmentJavaScriptCompiler.prototype.compile = function (opcodes, options) {
    this.source.length = 0;
    this.depth = -1;
    this.indent = options && options.indent || "";
    this.namespaceFrameStack = [{ namespace: null, depth: null }];
    this.domNamespace = null;

    this.source.push('function buildFragment(dom) {\n');
    utils.processOpcodes(this, opcodes);
    this.source.push(this.indent + '}');

    return this.source.join('');
  };

  FragmentJavaScriptCompiler.prototype.createFragment = function () {
    var el = 'el' + ++this.depth;
    this.source.push(this.indent + '  var ' + el + ' = dom.createDocumentFragment();\n');
  };

  FragmentJavaScriptCompiler.prototype.createElement = function (tagName) {
    var el = 'el' + ++this.depth;
    if (tagName === 'svg') {
      this.pushNamespaceFrame({ namespace: svgNamespace, depth: this.depth });
    }
    this.ensureNamespace();
    this.source.push(this.indent + '  var ' + el + ' = dom.createElement(' + quoting.string(tagName) + ');\n');
    if (svgHTMLIntegrationPoints[tagName]) {
      this.pushNamespaceFrame({ namespace: null, depth: this.depth });
    }
  };

  FragmentJavaScriptCompiler.prototype.createText = function (str) {
    var el = 'el' + ++this.depth;
    this.source.push(this.indent + '  var ' + el + ' = dom.createTextNode(' + quoting.string(str) + ');\n');
  };

  FragmentJavaScriptCompiler.prototype.createComment = function (str) {
    var el = 'el' + ++this.depth;
    this.source.push(this.indent + '  var ' + el + ' = dom.createComment(' + quoting.string(str) + ');\n');
  };

  FragmentJavaScriptCompiler.prototype.returnNode = function () {
    var el = 'el' + this.depth;
    this.source.push(this.indent + '  return ' + el + ';\n');
  };

  FragmentJavaScriptCompiler.prototype.setAttribute = function (name, value, namespace) {
    var el = 'el' + this.depth;
    if (namespace) {
      this.source.push(this.indent + '  dom.setAttributeNS(' + el + ',' + quoting.string(namespace) + ',' + quoting.string(name) + ',' + quoting.string(value) + ');\n');
    } else {
      this.source.push(this.indent + '  dom.setAttribute(' + el + ',' + quoting.string(name) + ',' + quoting.string(value) + ');\n');
    }
  };

  FragmentJavaScriptCompiler.prototype.appendChild = function () {
    if (this.depth === this.getCurrentNamespaceFrame().depth) {
      this.popNamespaceFrame();
    }
    var child = 'el' + this.depth--;
    var el = 'el' + this.depth;
    this.source.push(this.indent + '  dom.appendChild(' + el + ', ' + child + ');\n');
  };

  FragmentJavaScriptCompiler.prototype.getCurrentNamespaceFrame = function () {
    return this.namespaceFrameStack[this.namespaceFrameStack.length - 1];
  };

  FragmentJavaScriptCompiler.prototype.pushNamespaceFrame = function (frame) {
    this.namespaceFrameStack.push(frame);
  };

  FragmentJavaScriptCompiler.prototype.popNamespaceFrame = function () {
    return this.namespaceFrameStack.pop();
  };

  FragmentJavaScriptCompiler.prototype.ensureNamespace = function () {
    var correctNamespace = this.getCurrentNamespaceFrame().namespace;
    if (this.domNamespace !== correctNamespace) {
      this.source.push(this.indent + '  dom.setNamespace(' + (correctNamespace ? quoting.string(correctNamespace) : 'null') + ');\n');
      this.domNamespace = correctNamespace;
    }
  };

});
define('htmlbars-compiler/fragment-opcode-compiler', ['exports', './template-visitor', './utils', '../htmlbars-util', '../htmlbars-util/array-utils'], function (exports, TemplateVisitor, utils, htmlbars_util, array_utils) {

  'use strict';

  function FragmentOpcodeCompiler() {
    this.opcodes = [];
  }

  exports['default'] = FragmentOpcodeCompiler;

  FragmentOpcodeCompiler.prototype.compile = function (ast) {
    var templateVisitor = new TemplateVisitor['default']();
    templateVisitor.visit(ast);

    utils.processOpcodes(this, templateVisitor.actions);

    return this.opcodes;
  };

  FragmentOpcodeCompiler.prototype.opcode = function (type, params) {
    this.opcodes.push([type, params]);
  };

  FragmentOpcodeCompiler.prototype.text = function (text) {
    this.opcode('createText', [text.chars]);
    this.opcode('appendChild');
  };

  FragmentOpcodeCompiler.prototype.comment = function (comment) {
    this.opcode('createComment', [comment.value]);
    this.opcode('appendChild');
  };

  FragmentOpcodeCompiler.prototype.openElement = function (element) {
    this.opcode('createElement', [element.tag]);
    array_utils.forEach(element.attributes, this.attribute, this);
  };

  FragmentOpcodeCompiler.prototype.closeElement = function () {
    this.opcode('appendChild');
  };

  FragmentOpcodeCompiler.prototype.startProgram = function () {
    this.opcodes.length = 0;
    this.opcode('createFragment');
  };

  FragmentOpcodeCompiler.prototype.endProgram = function () {
    this.opcode('returnNode');
  };

  FragmentOpcodeCompiler.prototype.mustache = function () {
    this.pushMorphPlaceholderNode();
  };

  FragmentOpcodeCompiler.prototype.component = function () {
    this.pushMorphPlaceholderNode();
  };

  FragmentOpcodeCompiler.prototype.block = function () {
    this.pushMorphPlaceholderNode();
  };

  FragmentOpcodeCompiler.prototype.pushMorphPlaceholderNode = function () {
    this.opcode('createComment', [""]);
    this.opcode('appendChild');
  };

  FragmentOpcodeCompiler.prototype.attribute = function (attr) {
    if (attr.value.type === 'TextNode') {
      var namespace = htmlbars_util.getAttrNamespace(attr.name);
      this.opcode('setAttribute', [attr.name, attr.value.chars, namespace]);
    }
  };

  FragmentOpcodeCompiler.prototype.setNamespace = function (namespace) {
    this.opcode('setNamespace', [namespace]);
  };

});
define('htmlbars-compiler/hydration-javascript-compiler', ['exports', './utils', '../htmlbars-util/quoting'], function (exports, utils, quoting) {

  'use strict';

  function HydrationJavaScriptCompiler() {
    this.stack = [];
    this.source = [];
    this.mustaches = [];
    this.parents = [['fragment']];
    this.parentCount = 0;
    this.morphs = [];
    this.fragmentProcessing = [];
    this.hooks = undefined;
  }

  exports['default'] = HydrationJavaScriptCompiler;

  var prototype = HydrationJavaScriptCompiler.prototype;

  prototype.compile = function (opcodes, options) {
    this.stack.length = 0;
    this.mustaches.length = 0;
    this.source.length = 0;
    this.parents.length = 1;
    this.parents[0] = ['fragment'];
    this.morphs.length = 0;
    this.fragmentProcessing.length = 0;
    this.parentCount = 0;
    this.indent = options && options.indent || "";
    this.hooks = {};
    this.hasOpenBoundary = false;
    this.hasCloseBoundary = false;
    this.statements = [];
    this.expressionStack = [];
    this.locals = [];
    this.hasOpenBoundary = false;
    this.hasCloseBoundary = false;

    utils.processOpcodes(this, opcodes);

    if (this.hasOpenBoundary) {
      this.source.unshift(this.indent + "  dom.insertBoundary(fragment, 0);\n");
    }

    if (this.hasCloseBoundary) {
      this.source.unshift(this.indent + "  dom.insertBoundary(fragment, null);\n");
    }

    var i, l;

    var indent = this.indent;

    var morphs;

    var result = {
      createMorphsProgram: '',
      hydrateMorphsProgram: '',
      fragmentProcessingProgram: '',
      statements: this.statements,
      locals: this.locals,
      hasMorphs: false
    };

    result.hydrateMorphsProgram = this.source.join('');

    if (this.morphs.length) {
      result.hasMorphs = true;
      morphs = indent + '  var morphs = new Array(' + this.morphs.length + ');\n';

      for (i = 0, l = this.morphs.length; i < l; ++i) {
        var morph = this.morphs[i];
        morphs += indent + '  morphs[' + i + '] = ' + morph + ';\n';
      }
    }

    if (this.fragmentProcessing.length) {
      var processing = "";
      for (i = 0, l = this.fragmentProcessing.length; i < l; ++i) {
        processing += this.indent + '  ' + this.fragmentProcessing[i] + '\n';
      }
      result.fragmentProcessingProgram = processing;
    }

    var createMorphsProgram;
    if (result.hasMorphs) {
      createMorphsProgram = 'function buildRenderNodes(dom, fragment, contextualElement) {\n' + result.fragmentProcessingProgram + morphs;

      if (this.hasOpenBoundary) {
        createMorphsProgram += indent + "  dom.insertBoundary(fragment, 0);\n";
      }

      if (this.hasCloseBoundary) {
        createMorphsProgram += indent + "  dom.insertBoundary(fragment, null);\n";
      }

      createMorphsProgram += indent + '  return morphs;\n' + indent + '}';
    } else {
      createMorphsProgram = 'function buildRenderNodes() { return []; }';
    }

    result.createMorphsProgram = createMorphsProgram;

    return result;
  };

  prototype.prepareArray = function (length) {
    var values = [];

    for (var i = 0; i < length; i++) {
      values.push(this.expressionStack.pop());
    }

    this.expressionStack.push(values);
  };

  prototype.prepareObject = function (size) {
    var pairs = [];

    for (var i = 0; i < size; i++) {
      pairs.push(this.expressionStack.pop(), this.expressionStack.pop());
    }

    this.expressionStack.push(pairs);
  };

  prototype.openBoundary = function () {
    this.hasOpenBoundary = true;
  };

  prototype.closeBoundary = function () {
    this.hasCloseBoundary = true;
  };

  prototype.pushLiteral = function (value) {
    this.expressionStack.push(value);
  };

  prototype.pushGetHook = function (path, meta) {
    this.expressionStack.push(['get', path, meta]);
  };

  prototype.pushSexprHook = function (meta) {
    this.expressionStack.push(['subexpr', this.expressionStack.pop(), this.expressionStack.pop(), this.expressionStack.pop(), meta]);
  };

  prototype.pushConcatHook = function () {
    this.expressionStack.push(['concat', this.expressionStack.pop()]);
  };

  prototype.printSetHook = function (name) {
    this.locals.push(name);
  };

  prototype.printBlockHook = function (templateId, inverseId, meta) {
    this.statements.push(['block', this.expressionStack.pop(), // path
    this.expressionStack.pop(), // params
    this.expressionStack.pop(), // hash
    templateId, inverseId, meta]);
  };

  prototype.printInlineHook = function (meta) {
    var path = this.expressionStack.pop();
    var params = this.expressionStack.pop();
    var hash = this.expressionStack.pop();

    this.statements.push(['inline', path, params, hash, meta]);
  };

  prototype.printContentHook = function (meta) {
    this.statements.push(['content', this.expressionStack.pop(), meta]);
  };

  prototype.printComponentHook = function (templateId) {
    this.statements.push(['component', this.expressionStack.pop(), // path
    this.expressionStack.pop(), // attrs
    templateId]);
  };

  prototype.printAttributeHook = function () {
    this.statements.push(['attribute', this.expressionStack.pop(), // name
    this.expressionStack.pop() // value;
    ]);
  };

  prototype.printElementHook = function (meta) {
    this.statements.push(['element', this.expressionStack.pop(), // path
    this.expressionStack.pop(), // params
    this.expressionStack.pop(), // hash
    meta]);
  };

  prototype.createMorph = function (morphNum, parentPath, startIndex, endIndex, escaped) {
    var isRoot = parentPath.length === 0;
    var parent = this.getParent();

    var morphMethod = escaped ? 'createMorphAt' : 'createUnsafeMorphAt';
    var morph = "dom." + morphMethod + "(" + parent + "," + (startIndex === null ? "-1" : startIndex) + "," + (endIndex === null ? "-1" : endIndex) + (isRoot ? ",contextualElement)" : ")");

    this.morphs[morphNum] = morph;
  };

  prototype.createAttrMorph = function (attrMorphNum, elementNum, name, escaped, namespace) {
    var morphMethod = escaped ? 'createAttrMorph' : 'createUnsafeAttrMorph';
    var morph = "dom." + morphMethod + "(element" + elementNum + ", '" + name + (namespace ? "', '" + namespace : '') + "')";
    this.morphs[attrMorphNum] = morph;
  };

  prototype.createElementMorph = function (morphNum, elementNum) {
    var morphMethod = 'createElementMorph';
    var morph = "dom." + morphMethod + "(element" + elementNum + ")";
    this.morphs[morphNum] = morph;
  };

  prototype.repairClonedNode = function (blankChildTextNodes, isElementChecked) {
    var parent = this.getParent(),
        processing = 'if (this.cachedFragment) { dom.repairClonedNode(' + parent + ',' + quoting.array(blankChildTextNodes) + (isElementChecked ? ',true' : '') + '); }';
    this.fragmentProcessing.push(processing);
  };

  prototype.shareElement = function (elementNum) {
    var elementNodesName = "element" + elementNum;
    this.fragmentProcessing.push('var ' + elementNodesName + ' = ' + this.getParent() + ';');
    this.parents[this.parents.length - 1] = [elementNodesName];
  };

  prototype.consumeParent = function (i) {
    var newParent = this.lastParent().slice();
    newParent.push(i);

    this.parents.push(newParent);
  };

  prototype.popParent = function () {
    this.parents.pop();
  };

  prototype.getParent = function () {
    var last = this.lastParent().slice();
    var frag = last.shift();

    if (!last.length) {
      return frag;
    }

    return 'dom.childAt(' + frag + ', [' + last.join(', ') + '])';
  };

  prototype.lastParent = function () {
    return this.parents[this.parents.length - 1];
  };

});
define('htmlbars-compiler/hydration-opcode-compiler', ['exports', './template-visitor', './utils', '../htmlbars-util', '../htmlbars-util/array-utils', '../htmlbars-syntax/utils'], function (exports, TemplateVisitor, utils, htmlbars_util, array_utils, htmlbars_syntax__utils) {

  'use strict';

  function detectIsElementChecked(element) {
    for (var i = 0, len = element.attributes.length; i < len; i++) {
      if (element.attributes[i].name === 'checked') {
        return true;
      }
    }
    return false;
  }

  function HydrationOpcodeCompiler() {
    this.opcodes = [];
    this.paths = [];
    this.templateId = 0;
    this.currentDOMChildIndex = 0;
    this.morphs = [];
    this.morphNum = 0;
    this.element = null;
    this.elementNum = -1;
  }

  exports['default'] = HydrationOpcodeCompiler;

  HydrationOpcodeCompiler.prototype.compile = function (ast) {
    var templateVisitor = new TemplateVisitor['default']();
    templateVisitor.visit(ast);

    utils.processOpcodes(this, templateVisitor.actions);

    return this.opcodes;
  };

  HydrationOpcodeCompiler.prototype.accept = function (node) {
    this[node.type](node);
  };

  HydrationOpcodeCompiler.prototype.opcode = function (type) {
    var params = [].slice.call(arguments, 1);
    this.opcodes.push([type, params]);
  };

  HydrationOpcodeCompiler.prototype.startProgram = function (program, c, blankChildTextNodes) {
    this.opcodes.length = 0;
    this.paths.length = 0;
    this.morphs.length = 0;
    this.templateId = 0;
    this.currentDOMChildIndex = -1;
    this.morphNum = 0;

    var blockParams = program.blockParams || [];

    for (var i = 0; i < blockParams.length; i++) {
      this.opcode('printSetHook', blockParams[i], i);
    }

    if (blankChildTextNodes.length > 0) {
      this.opcode('repairClonedNode', blankChildTextNodes);
    }
  };

  HydrationOpcodeCompiler.prototype.insertBoundary = function (first) {
    this.opcode(first ? 'openBoundary' : 'closeBoundary');
  };

  HydrationOpcodeCompiler.prototype.endProgram = function () {
    distributeMorphs(this.morphs, this.opcodes);
  };

  HydrationOpcodeCompiler.prototype.text = function () {
    ++this.currentDOMChildIndex;
  };

  HydrationOpcodeCompiler.prototype.comment = function () {
    ++this.currentDOMChildIndex;
  };

  HydrationOpcodeCompiler.prototype.openElement = function (element, pos, len, mustacheCount, blankChildTextNodes) {
    distributeMorphs(this.morphs, this.opcodes);
    ++this.currentDOMChildIndex;

    this.element = this.currentDOMChildIndex;

    this.opcode('consumeParent', this.currentDOMChildIndex);

    // If our parent reference will be used more than once, cache its reference.
    if (mustacheCount > 1) {
      shareElement(this);
    }

    var isElementChecked = detectIsElementChecked(element);
    if (blankChildTextNodes.length > 0 || isElementChecked) {
      this.opcode('repairClonedNode', blankChildTextNodes, isElementChecked);
    }

    this.paths.push(this.currentDOMChildIndex);
    this.currentDOMChildIndex = -1;

    array_utils.forEach(element.attributes, this.attribute, this);
    array_utils.forEach(element.modifiers, this.elementModifier, this);
  };

  HydrationOpcodeCompiler.prototype.closeElement = function () {
    distributeMorphs(this.morphs, this.opcodes);
    this.opcode('popParent');
    this.currentDOMChildIndex = this.paths.pop();
  };

  HydrationOpcodeCompiler.prototype.mustache = function (mustache, childIndex, childCount) {
    this.pushMorphPlaceholderNode(childIndex, childCount);

    var opcode;

    if (htmlbars_syntax__utils.isHelper(mustache)) {
      prepareHash(this, mustache.hash);
      prepareParams(this, mustache.params);
      preparePath(this, mustache.path);
      opcode = 'printInlineHook';
    } else {
      preparePath(this, mustache.path);
      opcode = 'printContentHook';
    }

    var morphNum = this.morphNum++;
    var start = this.currentDOMChildIndex;
    var end = this.currentDOMChildIndex;
    this.morphs.push([morphNum, this.paths.slice(), start, end, mustache.escaped]);

    this.opcode(opcode, meta(mustache));
  };

  function meta(node) {
    var loc = node.loc;
    if (!loc) {
      return [];
    }

    var source = loc.source;
    var start = loc.start;
    var end = loc.end;

    return ['loc', [source || null, [start.line, start.column], [end.line, end.column]]];
  }

  HydrationOpcodeCompiler.prototype.block = function (block, childIndex, childCount) {
    this.pushMorphPlaceholderNode(childIndex, childCount);

    prepareHash(this, block.hash);
    prepareParams(this, block.params);
    preparePath(this, block.path);

    var morphNum = this.morphNum++;
    var start = this.currentDOMChildIndex;
    var end = this.currentDOMChildIndex;
    this.morphs.push([morphNum, this.paths.slice(), start, end, true]);

    var templateId = this.templateId++;
    var inverseId = block.inverse === null ? null : this.templateId++;

    this.opcode('printBlockHook', templateId, inverseId, meta(block));
  };

  HydrationOpcodeCompiler.prototype.component = function (component, childIndex, childCount) {
    this.pushMorphPlaceholderNode(childIndex, childCount);

    var program = component.program || {};
    var blockParams = program.blockParams || [];

    var attrs = component.attributes;
    for (var i = attrs.length - 1; i >= 0; i--) {
      var name = attrs[i].name;
      var value = attrs[i].value;

      // TODO: Introduce context specific AST nodes to avoid switching here.
      if (value.type === 'TextNode') {
        this.opcode('pushLiteral', value.chars);
      } else if (value.type === 'MustacheStatement') {
        this.accept(htmlbars_syntax__utils.unwrapMustache(value));
      } else if (value.type === 'ConcatStatement') {
        prepareParams(this, value.parts);
        this.opcode('pushConcatHook', this.morphNum);
      }

      this.opcode('pushLiteral', name);
    }

    var morphNum = this.morphNum++;
    var start = this.currentDOMChildIndex;
    var end = this.currentDOMChildIndex;
    this.morphs.push([morphNum, this.paths.slice(), start, end, true]);

    this.opcode('prepareObject', attrs.length);
    this.opcode('pushLiteral', component.tag);
    this.opcode('printComponentHook', this.templateId++, blockParams.length, meta(component));
  };

  HydrationOpcodeCompiler.prototype.attribute = function (attr) {
    var value = attr.value;
    var escaped = true;
    var namespace = htmlbars_util.getAttrNamespace(attr.name);

    // TODO: Introduce context specific AST nodes to avoid switching here.
    if (value.type === 'TextNode') {
      return;
    } else if (value.type === 'MustacheStatement') {
      escaped = value.escaped;
      this.accept(htmlbars_syntax__utils.unwrapMustache(value));
    } else if (value.type === 'ConcatStatement') {
      prepareParams(this, value.parts);
      this.opcode('pushConcatHook', this.morphNum);
    }

    this.opcode('pushLiteral', attr.name);

    var attrMorphNum = this.morphNum++;

    if (this.element !== null) {
      shareElement(this);
    }

    this.opcode('createAttrMorph', attrMorphNum, this.elementNum, attr.name, escaped, namespace);
    this.opcode('printAttributeHook');
  };

  HydrationOpcodeCompiler.prototype.elementModifier = function (modifier) {
    prepareHash(this, modifier.hash);
    prepareParams(this, modifier.params);
    preparePath(this, modifier.path);

    // If we have a helper in a node, and this element has not been cached, cache it
    if (this.element !== null) {
      shareElement(this);
    }

    publishElementMorph(this);
    this.opcode('printElementHook', meta(modifier));
  };

  HydrationOpcodeCompiler.prototype.pushMorphPlaceholderNode = function (childIndex, childCount) {
    if (this.paths.length === 0) {
      if (childIndex === 0) {
        this.opcode('openBoundary');
      }
      if (childIndex === childCount - 1) {
        this.opcode('closeBoundary');
      }
    }
    this.comment();
  };

  HydrationOpcodeCompiler.prototype.MustacheStatement = function (mustache) {
    prepareHash(this, mustache.hash);
    prepareParams(this, mustache.params);
    preparePath(this, mustache.path);
    this.opcode('pushSexprHook', meta(mustache));
  };

  HydrationOpcodeCompiler.prototype.SubExpression = function (sexpr) {
    prepareHash(this, sexpr.hash);
    prepareParams(this, sexpr.params);
    preparePath(this, sexpr.path);
    this.opcode('pushSexprHook', meta(sexpr));
  };

  HydrationOpcodeCompiler.prototype.PathExpression = function (path) {
    this.opcode('pushGetHook', path.original, meta(path));
  };

  HydrationOpcodeCompiler.prototype.StringLiteral = function (node) {
    this.opcode('pushLiteral', node.value);
  };

  HydrationOpcodeCompiler.prototype.BooleanLiteral = function (node) {
    this.opcode('pushLiteral', node.value);
  };

  HydrationOpcodeCompiler.prototype.NumberLiteral = function (node) {
    this.opcode('pushLiteral', node.value);
  };

  HydrationOpcodeCompiler.prototype.UndefinedLiteral = function (node) {
    this.opcode('pushLiteral', node.value);
  };

  HydrationOpcodeCompiler.prototype.NullLiteral = function (node) {
    this.opcode('pushLiteral', node.value);
  };

  function preparePath(compiler, path) {
    compiler.opcode('pushLiteral', path.original);
  }

  function prepareParams(compiler, params) {
    for (var i = params.length - 1; i >= 0; i--) {
      var param = params[i];
      compiler[param.type](param);
    }

    compiler.opcode('prepareArray', params.length);
  }

  function prepareHash(compiler, hash) {
    var pairs = hash.pairs;

    for (var i = pairs.length - 1; i >= 0; i--) {
      var key = pairs[i].key;
      var value = pairs[i].value;

      compiler[value.type](value);
      compiler.opcode('pushLiteral', key);
    }

    compiler.opcode('prepareObject', pairs.length);
  }

  function shareElement(compiler) {
    compiler.opcode('shareElement', ++compiler.elementNum);
    compiler.element = null; // Set element to null so we don't cache it twice
  }

  function publishElementMorph(compiler) {
    var morphNum = compiler.morphNum++;
    compiler.opcode('createElementMorph', morphNum, compiler.elementNum);
  }

  function distributeMorphs(morphs, opcodes) {
    if (morphs.length === 0) {
      return;
    }

    // Splice morphs after the most recent shareParent/consumeParent.
    var o;
    for (o = opcodes.length - 1; o >= 0; --o) {
      var opcode = opcodes[o][0];
      if (opcode === 'shareElement' || opcode === 'consumeParent' || opcode === 'popParent') {
        break;
      }
    }

    var spliceArgs = [o + 1, 0];
    for (var i = 0; i < morphs.length; ++i) {
      spliceArgs.push(['createMorph', morphs[i].slice()]);
    }
    opcodes.splice.apply(opcodes, spliceArgs);
    morphs.length = 0;
  }

});
define('htmlbars-compiler/template-compiler', ['exports', './fragment-opcode-compiler', './fragment-javascript-compiler', './hydration-opcode-compiler', './hydration-javascript-compiler', './template-visitor', './utils', '../htmlbars-util/quoting', '../htmlbars-util/array-utils'], function (exports, FragmentOpcodeCompiler, FragmentJavaScriptCompiler, HydrationOpcodeCompiler, HydrationJavaScriptCompiler, TemplateVisitor, utils, quoting, array_utils) {

  'use strict';

  function TemplateCompiler(options) {
    this.options = options || {};
    this.consumerBuildMeta = this.options.buildMeta || function () {};
    this.fragmentOpcodeCompiler = new FragmentOpcodeCompiler['default']();
    this.fragmentCompiler = new FragmentJavaScriptCompiler['default']();
    this.hydrationOpcodeCompiler = new HydrationOpcodeCompiler['default']();
    this.hydrationCompiler = new HydrationJavaScriptCompiler['default']();
    this.templates = [];
    this.childTemplates = [];
  }

  exports['default'] = TemplateCompiler;

  var dynamicNodes = {
    mustache: true,
    block: true,
    component: true
  };

  TemplateCompiler.prototype.compile = function (ast) {
    var templateVisitor = new TemplateVisitor['default']();
    templateVisitor.visit(ast);

    var normalizedActions = [];
    var actions = templateVisitor.actions;

    for (var i = 0, l = actions.length - 1; i < l; i++) {
      var action = actions[i];
      var nextAction = actions[i + 1];

      normalizedActions.push(action);

      if (action[0] === "startProgram" && nextAction[0] in dynamicNodes) {
        normalizedActions.push(['insertBoundary', [true]]);
      }

      if (nextAction[0] === "endProgram" && action[0] in dynamicNodes) {
        normalizedActions.push(['insertBoundary', [false]]);
      }
    }

    normalizedActions.push(actions[actions.length - 1]);

    utils.processOpcodes(this, normalizedActions);

    return this.templates.pop();
  };

  TemplateCompiler.prototype.startProgram = function (program, childTemplateCount, blankChildTextNodes) {
    this.fragmentOpcodeCompiler.startProgram(program, childTemplateCount, blankChildTextNodes);
    this.hydrationOpcodeCompiler.startProgram(program, childTemplateCount, blankChildTextNodes);

    this.childTemplates.length = 0;
    while (childTemplateCount--) {
      this.childTemplates.push(this.templates.pop());
    }
  };

  TemplateCompiler.prototype.insertBoundary = function (first) {
    this.hydrationOpcodeCompiler.insertBoundary(first);
  };

  TemplateCompiler.prototype.getChildTemplateVars = function (indent) {
    var vars = '';
    if (this.childTemplates) {
      for (var i = 0; i < this.childTemplates.length; i++) {
        vars += indent + 'var child' + i + ' = ' + this.childTemplates[i] + ';\n';
      }
    }
    return vars;
  };

  TemplateCompiler.prototype.getHydrationHooks = function (indent, hooks) {
    var hookVars = [];
    for (var hook in hooks) {
      hookVars.push(hook + ' = hooks.' + hook);
    }

    if (hookVars.length > 0) {
      return indent + 'var hooks = env.hooks, ' + hookVars.join(', ') + ';\n';
    } else {
      return '';
    }
  };

  TemplateCompiler.prototype.endProgram = function (program, programDepth) {
    this.fragmentOpcodeCompiler.endProgram(program);
    this.hydrationOpcodeCompiler.endProgram(program);

    var indent = quoting.repeat("  ", programDepth);
    var options = {
      indent: indent + "    "
    };

    // function build(dom) { return fragment; }
    var fragmentProgram = this.fragmentCompiler.compile(this.fragmentOpcodeCompiler.opcodes, options);

    // function hydrate(fragment) { return mustaches; }
    var hydrationPrograms = this.hydrationCompiler.compile(this.hydrationOpcodeCompiler.opcodes, options);

    var blockParams = program.blockParams || [];

    var templateSignature = 'context, rootNode, env, options';
    if (blockParams.length > 0) {
      templateSignature += ', blockArguments';
    }

    var statements = array_utils.map(hydrationPrograms.statements, function (s) {
      return indent + '      ' + JSON.stringify(s);
    }).join(",\n");

    var locals = JSON.stringify(hydrationPrograms.locals);

    var templates = array_utils.map(this.childTemplates, function (_, index) {
      return 'child' + index;
    }).join(', ');

    var template = '(function() {\n' + this.getChildTemplateVars(indent + '  ') + indent + '  return {\n' + this.buildMeta(indent + '    ', program) + indent + '    arity: ' + blockParams.length + ',\n' + indent + '    cachedFragment: null,\n' + indent + '    hasRendered: false,\n' + indent + '    buildFragment: ' + fragmentProgram + ',\n' + indent + '    buildRenderNodes: ' + hydrationPrograms.createMorphsProgram + ',\n' + indent + '    statements: [\n' + statements + '\n' + indent + '    ],\n' + indent + '    locals: ' + locals + ',\n' + indent + '    templates: [' + templates + ']\n' + indent + '  };\n' + indent + '}())';

    this.templates.push(template);
  };

  TemplateCompiler.prototype.buildMeta = function (indent, program) {
    var meta = this.consumerBuildMeta(program) || {};

    var head = indent + 'meta: ';
    var stringMeta = JSON.stringify(meta, null, 2).replace(/\n/g, '\n' + indent);
    var tail = ',\n';

    return head + stringMeta + tail;
  };

  TemplateCompiler.prototype.openElement = function (element, i, l, r, c, b) {
    this.fragmentOpcodeCompiler.openElement(element, i, l, r, c, b);
    this.hydrationOpcodeCompiler.openElement(element, i, l, r, c, b);
  };

  TemplateCompiler.prototype.closeElement = function (element, i, l, r) {
    this.fragmentOpcodeCompiler.closeElement(element, i, l, r);
    this.hydrationOpcodeCompiler.closeElement(element, i, l, r);
  };

  TemplateCompiler.prototype.component = function (component, i, l, s) {
    this.fragmentOpcodeCompiler.component(component, i, l, s);
    this.hydrationOpcodeCompiler.component(component, i, l, s);
  };

  TemplateCompiler.prototype.block = function (block, i, l, s) {
    this.fragmentOpcodeCompiler.block(block, i, l, s);
    this.hydrationOpcodeCompiler.block(block, i, l, s);
  };

  TemplateCompiler.prototype.text = function (string, i, l, r) {
    this.fragmentOpcodeCompiler.text(string, i, l, r);
    this.hydrationOpcodeCompiler.text(string, i, l, r);
  };

  TemplateCompiler.prototype.comment = function (string, i, l, r) {
    this.fragmentOpcodeCompiler.comment(string, i, l, r);
    this.hydrationOpcodeCompiler.comment(string, i, l, r);
  };

  TemplateCompiler.prototype.mustache = function (mustache, i, l, s) {
    this.fragmentOpcodeCompiler.mustache(mustache, i, l, s);
    this.hydrationOpcodeCompiler.mustache(mustache, i, l, s);
  };

  TemplateCompiler.prototype.setNamespace = function (namespace) {
    this.fragmentOpcodeCompiler.setNamespace(namespace);
  };

});
define('htmlbars-compiler/template-visitor', ['exports'], function (exports) {

  'use strict';

  var push = Array.prototype.push;

  function Frame() {
    this.parentNode = null;
    this.children = null;
    this.childIndex = null;
    this.childCount = null;
    this.childTemplateCount = 0;
    this.mustacheCount = 0;
    this.actions = [];
  }

  /**
   * Takes in an AST and outputs a list of actions to be consumed
   * by a compiler. For example, the template
   *
   *     foo{{bar}}<div>baz</div>
   *
   * produces the actions
   *
   *     [['startProgram', [programNode, 0]],
   *      ['text', [textNode, 0, 3]],
   *      ['mustache', [mustacheNode, 1, 3]],
   *      ['openElement', [elementNode, 2, 3, 0]],
   *      ['text', [textNode, 0, 1]],
   *      ['closeElement', [elementNode, 2, 3],
   *      ['endProgram', [programNode]]]
   *
   * This visitor walks the AST depth first and backwards. As
   * a result the bottom-most child template will appear at the
   * top of the actions list whereas the root template will appear
   * at the bottom of the list. For example,
   *
   *     <div>{{#if}}foo{{else}}bar<b></b>{{/if}}</div>
   *
   * produces the actions
   *
   *     [['startProgram', [programNode, 0]],
   *      ['text', [textNode, 0, 2, 0]],
   *      ['openElement', [elementNode, 1, 2, 0]],
   *      ['closeElement', [elementNode, 1, 2]],
   *      ['endProgram', [programNode]],
   *      ['startProgram', [programNode, 0]],
   *      ['text', [textNode, 0, 1]],
   *      ['endProgram', [programNode]],
   *      ['startProgram', [programNode, 2]],
   *      ['openElement', [elementNode, 0, 1, 1]],
   *      ['block', [blockNode, 0, 1]],
   *      ['closeElement', [elementNode, 0, 1]],
   *      ['endProgram', [programNode]]]
   *
   * The state of the traversal is maintained by a stack of frames.
   * Whenever a node with children is entered (either a ProgramNode
   * or an ElementNode) a frame is pushed onto the stack. The frame
   * contains information about the state of the traversal of that
   * node. For example,
   *
   *   - index of the current child node being visited
   *   - the number of mustaches contained within its child nodes
   *   - the list of actions generated by its child nodes
   */

  function TemplateVisitor() {
    this.frameStack = [];
    this.actions = [];
    this.programDepth = -1;
  }

  // Traversal methods

  TemplateVisitor.prototype.visit = function (node) {
    this[node.type](node);
  };

  TemplateVisitor.prototype.Program = function (program) {
    this.programDepth++;

    var parentFrame = this.getCurrentFrame();
    var programFrame = this.pushFrame();

    programFrame.parentNode = program;
    programFrame.children = program.body;
    programFrame.childCount = program.body.length;
    programFrame.blankChildTextNodes = [];
    programFrame.actions.push(['endProgram', [program, this.programDepth]]);

    for (var i = program.body.length - 1; i >= 0; i--) {
      programFrame.childIndex = i;
      this.visit(program.body[i]);
    }

    programFrame.actions.push(['startProgram', [program, programFrame.childTemplateCount, programFrame.blankChildTextNodes.reverse()]]);
    this.popFrame();

    this.programDepth--;

    // Push the completed template into the global actions list
    if (parentFrame) {
      parentFrame.childTemplateCount++;
    }
    push.apply(this.actions, programFrame.actions.reverse());
  };

  TemplateVisitor.prototype.ElementNode = function (element) {
    var parentFrame = this.getCurrentFrame();
    var elementFrame = this.pushFrame();

    elementFrame.parentNode = element;
    elementFrame.children = element.children;
    elementFrame.childCount = element.children.length;
    elementFrame.mustacheCount += element.modifiers.length;
    elementFrame.blankChildTextNodes = [];

    var actionArgs = [element, parentFrame.childIndex, parentFrame.childCount];

    elementFrame.actions.push(['closeElement', actionArgs]);

    for (var i = element.attributes.length - 1; i >= 0; i--) {
      this.visit(element.attributes[i]);
    }

    for (i = element.children.length - 1; i >= 0; i--) {
      elementFrame.childIndex = i;
      this.visit(element.children[i]);
    }

    elementFrame.actions.push(['openElement', actionArgs.concat([elementFrame.mustacheCount, elementFrame.blankChildTextNodes.reverse()])]);
    this.popFrame();

    // Propagate the element's frame state to the parent frame
    if (elementFrame.mustacheCount > 0) {
      parentFrame.mustacheCount++;
    }
    parentFrame.childTemplateCount += elementFrame.childTemplateCount;
    push.apply(parentFrame.actions, elementFrame.actions);
  };

  TemplateVisitor.prototype.AttrNode = function (attr) {
    if (attr.value.type !== 'TextNode') {
      this.getCurrentFrame().mustacheCount++;
    }
  };

  TemplateVisitor.prototype.TextNode = function (text) {
    var frame = this.getCurrentFrame();
    if (text.chars === '') {
      frame.blankChildTextNodes.push(domIndexOf(frame.children, text));
    }
    frame.actions.push(['text', [text, frame.childIndex, frame.childCount]]);
  };

  TemplateVisitor.prototype.BlockStatement = function (node) {
    var frame = this.getCurrentFrame();

    frame.mustacheCount++;
    frame.actions.push(['block', [node, frame.childIndex, frame.childCount]]);

    if (node.inverse) {
      this.visit(node.inverse);
    }
    if (node.program) {
      this.visit(node.program);
    }
  };

  TemplateVisitor.prototype.ComponentNode = function (node) {
    var frame = this.getCurrentFrame();

    frame.mustacheCount++;
    frame.actions.push(['component', [node, frame.childIndex, frame.childCount]]);

    if (node.program) {
      this.visit(node.program);
    }
  };

  TemplateVisitor.prototype.PartialStatement = function (node) {
    var frame = this.getCurrentFrame();
    frame.mustacheCount++;
    frame.actions.push(['mustache', [node, frame.childIndex, frame.childCount]]);
  };

  TemplateVisitor.prototype.CommentStatement = function (text) {
    var frame = this.getCurrentFrame();
    frame.actions.push(['comment', [text, frame.childIndex, frame.childCount]]);
  };

  TemplateVisitor.prototype.MustacheStatement = function (mustache) {
    var frame = this.getCurrentFrame();
    frame.mustacheCount++;
    frame.actions.push(['mustache', [mustache, frame.childIndex, frame.childCount]]);
  };

  // Frame helpers

  TemplateVisitor.prototype.getCurrentFrame = function () {
    return this.frameStack[this.frameStack.length - 1];
  };

  TemplateVisitor.prototype.pushFrame = function () {
    var frame = new Frame();
    this.frameStack.push(frame);
    return frame;
  };

  TemplateVisitor.prototype.popFrame = function () {
    return this.frameStack.pop();
  };

  exports['default'] = TemplateVisitor;

  // Returns the index of `domNode` in the `nodes` array, skipping
  // over any nodes which do not represent DOM nodes.
  function domIndexOf(nodes, domNode) {
    var index = -1;

    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];

      if (node.type !== 'TextNode' && node.type !== 'ElementNode') {
        continue;
      } else {
        index++;
      }

      if (node === domNode) {
        return index;
      }
    }

    return -1;
  }

});
define('htmlbars-compiler/utils', ['exports'], function (exports) {

  'use strict';

  exports.processOpcodes = processOpcodes;

  function processOpcodes(compiler, opcodes) {
    for (var i = 0, l = opcodes.length; i < l; i++) {
      var method = opcodes[i][0];
      var params = opcodes[i][1];
      if (params) {
        compiler[method].apply(compiler, params);
      } else {
        compiler[method].call(compiler);
      }
    }
  }

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
define('htmlbars-syntax', ['exports', './htmlbars-syntax/walker', './htmlbars-syntax/builders', './htmlbars-syntax/parser'], function (exports, Walker, builders, parse) {

	'use strict';



	exports.Walker = Walker['default'];
	exports.builders = builders['default'];
	exports.parse = parse['default'];

});
define('htmlbars-syntax/builders', ['exports'], function (exports) {

  'use strict';

  exports.buildMustache = buildMustache;
  exports.buildBlock = buildBlock;
  exports.buildElementModifier = buildElementModifier;
  exports.buildPartial = buildPartial;
  exports.buildComment = buildComment;
  exports.buildConcat = buildConcat;
  exports.buildElement = buildElement;
  exports.buildComponent = buildComponent;
  exports.buildAttr = buildAttr;
  exports.buildText = buildText;
  exports.buildSexpr = buildSexpr;
  exports.buildPath = buildPath;
  exports.buildString = buildString;
  exports.buildBoolean = buildBoolean;
  exports.buildNumber = buildNumber;
  exports.buildNull = buildNull;
  exports.buildUndefined = buildUndefined;
  exports.buildHash = buildHash;
  exports.buildPair = buildPair;
  exports.buildProgram = buildProgram;

  function buildMustache(path, params, hash, raw, loc) {
    return {
      type: "MustacheStatement",
      path: path,
      params: params || [],
      hash: hash || buildHash([]),
      escaped: !raw,
      loc: buildLoc(loc)
    };
  }

  function buildBlock(path, params, hash, program, inverse, loc) {
    return {
      type: "BlockStatement",
      path: path,
      params: params || [],
      hash: hash || buildHash([]),
      program: program || null,
      inverse: inverse || null,
      loc: buildLoc(loc)
    };
  }

  function buildElementModifier(path, params, hash, loc) {
    return {
      type: "ElementModifierStatement",
      path: path,
      params: params || [],
      hash: hash || buildHash([]),
      loc: buildLoc(loc)
    };
  }

  function buildPartial(name, params, hash, indent) {
    return {
      type: "PartialStatement",
      name: name,
      params: params || [],
      hash: hash || buildHash([]),
      indent: indent
    };
  }

  function buildComment(value) {
    return {
      type: "CommentStatement",
      value: value
    };
  }

  function buildConcat(parts) {
    return {
      type: "ConcatStatement",
      parts: parts || []
    };
  }

  // Nodes

  function buildElement(tag, attributes, modifiers, children, loc) {
    return {
      type: "ElementNode",
      tag: tag || "",
      attributes: attributes || [],
      modifiers: modifiers || [],
      children: children || [],
      loc: buildLoc(loc)
    };
  }

  function buildComponent(tag, attributes, program, loc) {
    return {
      type: "ComponentNode",
      tag: tag,
      attributes: attributes,
      program: program,
      loc: buildLoc(loc)
    };
  }

  function buildAttr(name, value) {
    return {
      type: "AttrNode",
      name: name,
      value: value
    };
  }

  function buildText(chars, loc) {
    return {
      type: "TextNode",
      chars: chars || "",
      loc: buildLoc(loc)
    };
  }

  // Expressions

  function buildSexpr(path, params, hash) {
    return {
      type: "SubExpression",
      path: path,
      params: params || [],
      hash: hash || buildHash([])
    };
  }

  function buildPath(original) {
    return {
      type: "PathExpression",
      original: original,
      parts: original.split('.')
    };
  }

  function buildString(value) {
    return {
      type: "StringLiteral",
      value: value,
      original: value
    };
  }

  function buildBoolean(value) {
    return {
      type: "BooleanLiteral",
      value: value,
      original: value
    };
  }

  function buildNumber(value) {
    return {
      type: "NumberLiteral",
      value: value,
      original: value
    };
  }

  function buildNull() {
    return {
      type: "NullLiteral",
      value: null,
      original: null
    };
  }

  function buildUndefined() {
    return {
      type: "UndefinedLiteral",
      value: undefined,
      original: undefined
    };
  }

  // Miscellaneous

  function buildHash(pairs) {
    return {
      type: "Hash",
      pairs: pairs || []
    };
  }

  function buildPair(key, value) {
    return {
      type: "HashPair",
      key: key,
      value: value
    };
  }

  function buildProgram(body, blockParams, loc) {
    return {
      type: "Program",
      body: body || [],
      blockParams: blockParams || [],
      loc: buildLoc(loc)
    };
  }

  function buildSource(source) {
    return source || null;
  }

  function buildPosition(line, column) {
    return {
      line: typeof line === 'number' ? line : null,
      column: typeof column === 'number' ? column : null
    };
  }

  function buildLoc(startLine, startColumn, endLine, endColumn, source) {
    if (arguments.length === 1) {
      var loc = startLine;

      if (typeof loc === 'object') {
        return {
          source: buildSource(loc.source),
          start: buildPosition(loc.start.line, loc.start.column),
          end: buildPosition(loc.end.line, loc.end.column)
        };
      } else {
        return null;
      }
    } else {
      return {
        source: buildSource(source),
        start: buildPosition(startLine, startColumn),
        end: buildPosition(endLine, endColumn)
      };
    }
  }

  exports['default'] = {
    mustache: buildMustache,
    block: buildBlock,
    partial: buildPartial,
    comment: buildComment,
    element: buildElement,
    elementModifier: buildElementModifier,
    component: buildComponent,
    attr: buildAttr,
    text: buildText,
    sexpr: buildSexpr,
    path: buildPath,
    string: buildString,
    boolean: buildBoolean,
    number: buildNumber,
    undefined: buildUndefined,
    null: buildNull,
    concat: buildConcat,
    hash: buildHash,
    pair: buildPair,
    program: buildProgram,
    loc: buildLoc,
    pos: buildPosition
  };

});
define('htmlbars-syntax/handlebars/compiler/ast', ['exports'], function (exports) {

  'use strict';

  var AST = {
    Program: function (statements, blockParams, strip, locInfo) {
      this.loc = locInfo;
      this.type = 'Program';
      this.body = statements;

      this.blockParams = blockParams;
      this.strip = strip;
    },

    MustacheStatement: function (path, params, hash, escaped, strip, locInfo) {
      this.loc = locInfo;
      this.type = 'MustacheStatement';

      this.path = path;
      this.params = params || [];
      this.hash = hash;
      this.escaped = escaped;

      this.strip = strip;
    },

    BlockStatement: function (path, params, hash, program, inverse, openStrip, inverseStrip, closeStrip, locInfo) {
      this.loc = locInfo;
      this.type = 'BlockStatement';

      this.path = path;
      this.params = params || [];
      this.hash = hash;
      this.program = program;
      this.inverse = inverse;

      this.openStrip = openStrip;
      this.inverseStrip = inverseStrip;
      this.closeStrip = closeStrip;
    },

    PartialStatement: function (name, params, hash, strip, locInfo) {
      this.loc = locInfo;
      this.type = 'PartialStatement';

      this.name = name;
      this.params = params || [];
      this.hash = hash;

      this.indent = '';
      this.strip = strip;
    },

    ContentStatement: function (string, locInfo) {
      this.loc = locInfo;
      this.type = 'ContentStatement';
      this.original = this.value = string;
    },

    CommentStatement: function (comment, strip, locInfo) {
      this.loc = locInfo;
      this.type = 'CommentStatement';
      this.value = comment;

      this.strip = strip;
    },

    SubExpression: function (path, params, hash, locInfo) {
      this.loc = locInfo;

      this.type = 'SubExpression';
      this.path = path;
      this.params = params || [];
      this.hash = hash;
    },

    PathExpression: function (data, depth, parts, original, locInfo) {
      this.loc = locInfo;
      this.type = 'PathExpression';

      this.data = data;
      this.original = original;
      this.parts = parts;
      this.depth = depth;
    },

    StringLiteral: function (string, locInfo) {
      this.loc = locInfo;
      this.type = 'StringLiteral';
      this.original = this.value = string;
    },

    NumberLiteral: function (number, locInfo) {
      this.loc = locInfo;
      this.type = 'NumberLiteral';
      this.original = this.value = Number(number);
    },

    BooleanLiteral: function (bool, locInfo) {
      this.loc = locInfo;
      this.type = 'BooleanLiteral';
      this.original = this.value = bool === 'true';
    },

    UndefinedLiteral: function (locInfo) {
      this.loc = locInfo;
      this.type = 'UndefinedLiteral';
      this.original = this.value = undefined;
    },

    NullLiteral: function (locInfo) {
      this.loc = locInfo;
      this.type = 'NullLiteral';
      this.original = this.value = null;
    },

    Hash: function (pairs, locInfo) {
      this.loc = locInfo;
      this.type = 'Hash';
      this.pairs = pairs;
    },
    HashPair: function (key, value, locInfo) {
      this.loc = locInfo;
      this.type = 'HashPair';
      this.key = key;
      this.value = value;
    },

    // Public API used to evaluate derived attributes regarding AST nodes
    helpers: {
      // a mustache is definitely a helper if:
      // * it is an eligible helper, and
      // * it has at least one parameter or hash segment
      helperExpression: function (node) {
        return !!(node.type === 'SubExpression' || node.params.length || node.hash);
      },

      scopedId: function (path) {
        return (/^\.|this\b/.test(path.original)
        );
      },

      // an ID is simple if it only has one part, and that part is not
      // `..` or `this`.
      simpleId: function (path) {
        return path.parts.length === 1 && !AST.helpers.scopedId(path) && !path.depth;
      }
    }
  };

  // Must be exported as an object rather than the root of the module as the jison lexer
  // must modify the object to operate properly.
  exports['default'] = AST;

});
define('htmlbars-syntax/handlebars/compiler/base', ['exports', './parser', './ast', './whitespace-control', './helpers', '../utils'], function (exports, parser, AST, WhitespaceControl, Helpers, utils) {

  'use strict';

  exports.parse = parse;

  var yy = {};
  utils.extend(yy, Helpers, AST['default']);

  function parse(input, options) {
    // Just return if an already-compiled AST was passed in.
    if (input.type === 'Program') {
      return input;
    }

    parser['default'].yy = yy;

    // Altering the shared object here, but this is ok as parser is a sync operation
    yy.locInfo = function (locInfo) {
      return new yy.SourceLocation(options && options.srcName, locInfo);
    };

    var strip = new WhitespaceControl['default']();
    return strip.accept(parser['default'].parse(input));
  }

  exports.parser = parser['default'];

});
define('htmlbars-syntax/handlebars/compiler/helpers', ['exports', '../exception'], function (exports, Exception) {

  'use strict';

  exports.SourceLocation = SourceLocation;
  exports.id = id;
  exports.stripFlags = stripFlags;
  exports.stripComment = stripComment;
  exports.preparePath = preparePath;
  exports.prepareMustache = prepareMustache;
  exports.prepareRawBlock = prepareRawBlock;
  exports.prepareBlock = prepareBlock;

  function SourceLocation(source, locInfo) {
    this.source = source;
    this.start = {
      line: locInfo.first_line,
      column: locInfo.first_column
    };
    this.end = {
      line: locInfo.last_line,
      column: locInfo.last_column
    };
  }

  function id(token) {
    if (/^\[.*\]$/.test(token)) {
      return token.substr(1, token.length - 2);
    } else {
      return token;
    }
  }

  function stripFlags(open, close) {
    return {
      open: open.charAt(2) === '~',
      close: close.charAt(close.length - 3) === '~'
    };
  }

  function stripComment(comment) {
    return comment.replace(/^\{\{~?\!-?-?/, '').replace(/-?-?~?\}\}$/, '');
  }

  function preparePath(data, parts, locInfo) {
    locInfo = this.locInfo(locInfo);

    var original = data ? '@' : '',
        dig = [],
        depth = 0,
        depthString = '';

    for (var i = 0, l = parts.length; i < l; i++) {
      var part = parts[i].part,

      // If we have [] syntax then we do not treat path references as operators,
      // i.e. foo.[this] resolves to approximately context.foo['this']
      isLiteral = parts[i].original !== part;
      original += (parts[i].separator || '') + part;

      if (!isLiteral && (part === '..' || part === '.' || part === 'this')) {
        if (dig.length > 0) {
          throw new Exception['default']('Invalid path: ' + original, { loc: locInfo });
        } else if (part === '..') {
          depth++;
          depthString += '../';
        }
      } else {
        dig.push(part);
      }
    }

    return new this.PathExpression(data, depth, dig, original, locInfo);
  }

  function prepareMustache(path, params, hash, open, strip, locInfo) {
    // Must use charAt to support IE pre-10
    var escapeFlag = open.charAt(3) || open.charAt(2),
        escaped = escapeFlag !== '{' && escapeFlag !== '&';

    return new this.MustacheStatement(path, params, hash, escaped, strip, this.locInfo(locInfo));
  }

  function prepareRawBlock(openRawBlock, content, close, locInfo) {
    if (openRawBlock.path.original !== close) {
      var errorNode = { loc: openRawBlock.path.loc };

      throw new Exception['default'](openRawBlock.path.original + " doesn't match " + close, errorNode);
    }

    locInfo = this.locInfo(locInfo);
    var program = new this.Program([content], null, {}, locInfo);

    return new this.BlockStatement(openRawBlock.path, openRawBlock.params, openRawBlock.hash, program, undefined, {}, {}, {}, locInfo);
  }

  function prepareBlock(openBlock, program, inverseAndProgram, close, inverted, locInfo) {
    // When we are chaining inverse calls, we will not have a close path
    if (close && close.path && openBlock.path.original !== close.path.original) {
      var errorNode = { loc: openBlock.path.loc };

      throw new Exception['default'](openBlock.path.original + ' doesn\'t match ' + close.path.original, errorNode);
    }

    program.blockParams = openBlock.blockParams;

    var inverse = undefined,
        inverseStrip = undefined;

    if (inverseAndProgram) {
      if (inverseAndProgram.chain) {
        inverseAndProgram.program.body[0].closeStrip = close.strip;
      }

      inverseStrip = inverseAndProgram.strip;
      inverse = inverseAndProgram.program;
    }

    if (inverted) {
      inverted = inverse;
      inverse = program;
      program = inverted;
    }

    return new this.BlockStatement(openBlock.path, openBlock.params, openBlock.hash, program, inverse, openBlock.strip, inverseStrip, close && close.strip, this.locInfo(locInfo));
  }

});
define('htmlbars-syntax/handlebars/compiler/parser', ['exports'], function (exports) {

    'use strict';

    /* istanbul ignore next */
    /* Jison generated parser */
    var handlebars = (function () {
        var parser = { trace: function trace() {},
            yy: {},
            symbols_: { "error": 2, "root": 3, "program": 4, "EOF": 5, "program_repetition0": 6, "statement": 7, "mustache": 8, "block": 9, "rawBlock": 10, "partial": 11, "content": 12, "COMMENT": 13, "CONTENT": 14, "openRawBlock": 15, "END_RAW_BLOCK": 16, "OPEN_RAW_BLOCK": 17, "helperName": 18, "openRawBlock_repetition0": 19, "openRawBlock_option0": 20, "CLOSE_RAW_BLOCK": 21, "openBlock": 22, "block_option0": 23, "closeBlock": 24, "openInverse": 25, "block_option1": 26, "OPEN_BLOCK": 27, "openBlock_repetition0": 28, "openBlock_option0": 29, "openBlock_option1": 30, "CLOSE": 31, "OPEN_INVERSE": 32, "openInverse_repetition0": 33, "openInverse_option0": 34, "openInverse_option1": 35, "openInverseChain": 36, "OPEN_INVERSE_CHAIN": 37, "openInverseChain_repetition0": 38, "openInverseChain_option0": 39, "openInverseChain_option1": 40, "inverseAndProgram": 41, "INVERSE": 42, "inverseChain": 43, "inverseChain_option0": 44, "OPEN_ENDBLOCK": 45, "OPEN": 46, "mustache_repetition0": 47, "mustache_option0": 48, "OPEN_UNESCAPED": 49, "mustache_repetition1": 50, "mustache_option1": 51, "CLOSE_UNESCAPED": 52, "OPEN_PARTIAL": 53, "partialName": 54, "partial_repetition0": 55, "partial_option0": 56, "param": 57, "sexpr": 58, "OPEN_SEXPR": 59, "sexpr_repetition0": 60, "sexpr_option0": 61, "CLOSE_SEXPR": 62, "hash": 63, "hash_repetition_plus0": 64, "hashSegment": 65, "ID": 66, "EQUALS": 67, "blockParams": 68, "OPEN_BLOCK_PARAMS": 69, "blockParams_repetition_plus0": 70, "CLOSE_BLOCK_PARAMS": 71, "path": 72, "dataName": 73, "STRING": 74, "NUMBER": 75, "BOOLEAN": 76, "UNDEFINED": 77, "NULL": 78, "DATA": 79, "pathSegments": 80, "SEP": 81, "$accept": 0, "$end": 1 },
            terminals_: { 2: "error", 5: "EOF", 13: "COMMENT", 14: "CONTENT", 16: "END_RAW_BLOCK", 17: "OPEN_RAW_BLOCK", 21: "CLOSE_RAW_BLOCK", 27: "OPEN_BLOCK", 31: "CLOSE", 32: "OPEN_INVERSE", 37: "OPEN_INVERSE_CHAIN", 42: "INVERSE", 45: "OPEN_ENDBLOCK", 46: "OPEN", 49: "OPEN_UNESCAPED", 52: "CLOSE_UNESCAPED", 53: "OPEN_PARTIAL", 59: "OPEN_SEXPR", 62: "CLOSE_SEXPR", 66: "ID", 67: "EQUALS", 69: "OPEN_BLOCK_PARAMS", 71: "CLOSE_BLOCK_PARAMS", 74: "STRING", 75: "NUMBER", 76: "BOOLEAN", 77: "UNDEFINED", 78: "NULL", 79: "DATA", 81: "SEP" },
            productions_: [0, [3, 2], [4, 1], [7, 1], [7, 1], [7, 1], [7, 1], [7, 1], [7, 1], [12, 1], [10, 3], [15, 5], [9, 4], [9, 4], [22, 6], [25, 6], [36, 6], [41, 2], [43, 3], [43, 1], [24, 3], [8, 5], [8, 5], [11, 5], [57, 1], [57, 1], [58, 5], [63, 1], [65, 3], [68, 3], [18, 1], [18, 1], [18, 1], [18, 1], [18, 1], [18, 1], [18, 1], [54, 1], [54, 1], [73, 2], [72, 1], [80, 3], [80, 1], [6, 0], [6, 2], [19, 0], [19, 2], [20, 0], [20, 1], [23, 0], [23, 1], [26, 0], [26, 1], [28, 0], [28, 2], [29, 0], [29, 1], [30, 0], [30, 1], [33, 0], [33, 2], [34, 0], [34, 1], [35, 0], [35, 1], [38, 0], [38, 2], [39, 0], [39, 1], [40, 0], [40, 1], [44, 0], [44, 1], [47, 0], [47, 2], [48, 0], [48, 1], [50, 0], [50, 2], [51, 0], [51, 1], [55, 0], [55, 2], [56, 0], [56, 1], [60, 0], [60, 2], [61, 0], [61, 1], [64, 1], [64, 2], [70, 1], [70, 2]],
            performAction: function anonymous(yytext, yyleng, yylineno, yy, yystate, $$, _$) {

                var $0 = $$.length - 1;
                switch (yystate) {
                    case 1:
                        return $$[$0 - 1];
                        break;
                    case 2:
                        this.$ = new yy.Program($$[$0], null, {}, yy.locInfo(this._$));
                        break;
                    case 3:
                        this.$ = $$[$0];
                        break;
                    case 4:
                        this.$ = $$[$0];
                        break;
                    case 5:
                        this.$ = $$[$0];
                        break;
                    case 6:
                        this.$ = $$[$0];
                        break;
                    case 7:
                        this.$ = $$[$0];
                        break;
                    case 8:
                        this.$ = new yy.CommentStatement(yy.stripComment($$[$0]), yy.stripFlags($$[$0], $$[$0]), yy.locInfo(this._$));
                        break;
                    case 9:
                        this.$ = new yy.ContentStatement($$[$0], yy.locInfo(this._$));
                        break;
                    case 10:
                        this.$ = yy.prepareRawBlock($$[$0 - 2], $$[$0 - 1], $$[$0], this._$);
                        break;
                    case 11:
                        this.$ = { path: $$[$0 - 3], params: $$[$0 - 2], hash: $$[$0 - 1] };
                        break;
                    case 12:
                        this.$ = yy.prepareBlock($$[$0 - 3], $$[$0 - 2], $$[$0 - 1], $$[$0], false, this._$);
                        break;
                    case 13:
                        this.$ = yy.prepareBlock($$[$0 - 3], $$[$0 - 2], $$[$0 - 1], $$[$0], true, this._$);
                        break;
                    case 14:
                        this.$ = { path: $$[$0 - 4], params: $$[$0 - 3], hash: $$[$0 - 2], blockParams: $$[$0 - 1], strip: yy.stripFlags($$[$0 - 5], $$[$0]) };
                        break;
                    case 15:
                        this.$ = { path: $$[$0 - 4], params: $$[$0 - 3], hash: $$[$0 - 2], blockParams: $$[$0 - 1], strip: yy.stripFlags($$[$0 - 5], $$[$0]) };
                        break;
                    case 16:
                        this.$ = { path: $$[$0 - 4], params: $$[$0 - 3], hash: $$[$0 - 2], blockParams: $$[$0 - 1], strip: yy.stripFlags($$[$0 - 5], $$[$0]) };
                        break;
                    case 17:
                        this.$ = { strip: yy.stripFlags($$[$0 - 1], $$[$0 - 1]), program: $$[$0] };
                        break;
                    case 18:
                        var inverse = yy.prepareBlock($$[$0 - 2], $$[$0 - 1], $$[$0], $$[$0], false, this._$),
                            program = new yy.Program([inverse], null, {}, yy.locInfo(this._$));
                        program.chained = true;

                        this.$ = { strip: $$[$0 - 2].strip, program: program, chain: true };

                        break;
                    case 19:
                        this.$ = $$[$0];
                        break;
                    case 20:
                        this.$ = { path: $$[$0 - 1], strip: yy.stripFlags($$[$0 - 2], $$[$0]) };
                        break;
                    case 21:
                        this.$ = yy.prepareMustache($$[$0 - 3], $$[$0 - 2], $$[$0 - 1], $$[$0 - 4], yy.stripFlags($$[$0 - 4], $$[$0]), this._$);
                        break;
                    case 22:
                        this.$ = yy.prepareMustache($$[$0 - 3], $$[$0 - 2], $$[$0 - 1], $$[$0 - 4], yy.stripFlags($$[$0 - 4], $$[$0]), this._$);
                        break;
                    case 23:
                        this.$ = new yy.PartialStatement($$[$0 - 3], $$[$0 - 2], $$[$0 - 1], yy.stripFlags($$[$0 - 4], $$[$0]), yy.locInfo(this._$));
                        break;
                    case 24:
                        this.$ = $$[$0];
                        break;
                    case 25:
                        this.$ = $$[$0];
                        break;
                    case 26:
                        this.$ = new yy.SubExpression($$[$0 - 3], $$[$0 - 2], $$[$0 - 1], yy.locInfo(this._$));
                        break;
                    case 27:
                        this.$ = new yy.Hash($$[$0], yy.locInfo(this._$));
                        break;
                    case 28:
                        this.$ = new yy.HashPair(yy.id($$[$0 - 2]), $$[$0], yy.locInfo(this._$));
                        break;
                    case 29:
                        this.$ = yy.id($$[$0 - 1]);
                        break;
                    case 30:
                        this.$ = $$[$0];
                        break;
                    case 31:
                        this.$ = $$[$0];
                        break;
                    case 32:
                        this.$ = new yy.StringLiteral($$[$0], yy.locInfo(this._$));
                        break;
                    case 33:
                        this.$ = new yy.NumberLiteral($$[$0], yy.locInfo(this._$));
                        break;
                    case 34:
                        this.$ = new yy.BooleanLiteral($$[$0], yy.locInfo(this._$));
                        break;
                    case 35:
                        this.$ = new yy.UndefinedLiteral(yy.locInfo(this._$));
                        break;
                    case 36:
                        this.$ = new yy.NullLiteral(yy.locInfo(this._$));
                        break;
                    case 37:
                        this.$ = $$[$0];
                        break;
                    case 38:
                        this.$ = $$[$0];
                        break;
                    case 39:
                        this.$ = yy.preparePath(true, $$[$0], this._$);
                        break;
                    case 40:
                        this.$ = yy.preparePath(false, $$[$0], this._$);
                        break;
                    case 41:
                        $$[$0 - 2].push({ part: yy.id($$[$0]), original: $$[$0], separator: $$[$0 - 1] });this.$ = $$[$0 - 2];
                        break;
                    case 42:
                        this.$ = [{ part: yy.id($$[$0]), original: $$[$0] }];
                        break;
                    case 43:
                        this.$ = [];
                        break;
                    case 44:
                        $$[$0 - 1].push($$[$0]);
                        break;
                    case 45:
                        this.$ = [];
                        break;
                    case 46:
                        $$[$0 - 1].push($$[$0]);
                        break;
                    case 53:
                        this.$ = [];
                        break;
                    case 54:
                        $$[$0 - 1].push($$[$0]);
                        break;
                    case 59:
                        this.$ = [];
                        break;
                    case 60:
                        $$[$0 - 1].push($$[$0]);
                        break;
                    case 65:
                        this.$ = [];
                        break;
                    case 66:
                        $$[$0 - 1].push($$[$0]);
                        break;
                    case 73:
                        this.$ = [];
                        break;
                    case 74:
                        $$[$0 - 1].push($$[$0]);
                        break;
                    case 77:
                        this.$ = [];
                        break;
                    case 78:
                        $$[$0 - 1].push($$[$0]);
                        break;
                    case 81:
                        this.$ = [];
                        break;
                    case 82:
                        $$[$0 - 1].push($$[$0]);
                        break;
                    case 85:
                        this.$ = [];
                        break;
                    case 86:
                        $$[$0 - 1].push($$[$0]);
                        break;
                    case 89:
                        this.$ = [$$[$0]];
                        break;
                    case 90:
                        $$[$0 - 1].push($$[$0]);
                        break;
                    case 91:
                        this.$ = [$$[$0]];
                        break;
                    case 92:
                        $$[$0 - 1].push($$[$0]);
                        break;
                }
            },
            table: [{ 3: 1, 4: 2, 5: [2, 43], 6: 3, 13: [2, 43], 14: [2, 43], 17: [2, 43], 27: [2, 43], 32: [2, 43], 46: [2, 43], 49: [2, 43], 53: [2, 43] }, { 1: [3] }, { 5: [1, 4] }, { 5: [2, 2], 7: 5, 8: 6, 9: 7, 10: 8, 11: 9, 12: 10, 13: [1, 11], 14: [1, 18], 15: 16, 17: [1, 21], 22: 14, 25: 15, 27: [1, 19], 32: [1, 20], 37: [2, 2], 42: [2, 2], 45: [2, 2], 46: [1, 12], 49: [1, 13], 53: [1, 17] }, { 1: [2, 1] }, { 5: [2, 44], 13: [2, 44], 14: [2, 44], 17: [2, 44], 27: [2, 44], 32: [2, 44], 37: [2, 44], 42: [2, 44], 45: [2, 44], 46: [2, 44], 49: [2, 44], 53: [2, 44] }, { 5: [2, 3], 13: [2, 3], 14: [2, 3], 17: [2, 3], 27: [2, 3], 32: [2, 3], 37: [2, 3], 42: [2, 3], 45: [2, 3], 46: [2, 3], 49: [2, 3], 53: [2, 3] }, { 5: [2, 4], 13: [2, 4], 14: [2, 4], 17: [2, 4], 27: [2, 4], 32: [2, 4], 37: [2, 4], 42: [2, 4], 45: [2, 4], 46: [2, 4], 49: [2, 4], 53: [2, 4] }, { 5: [2, 5], 13: [2, 5], 14: [2, 5], 17: [2, 5], 27: [2, 5], 32: [2, 5], 37: [2, 5], 42: [2, 5], 45: [2, 5], 46: [2, 5], 49: [2, 5], 53: [2, 5] }, { 5: [2, 6], 13: [2, 6], 14: [2, 6], 17: [2, 6], 27: [2, 6], 32: [2, 6], 37: [2, 6], 42: [2, 6], 45: [2, 6], 46: [2, 6], 49: [2, 6], 53: [2, 6] }, { 5: [2, 7], 13: [2, 7], 14: [2, 7], 17: [2, 7], 27: [2, 7], 32: [2, 7], 37: [2, 7], 42: [2, 7], 45: [2, 7], 46: [2, 7], 49: [2, 7], 53: [2, 7] }, { 5: [2, 8], 13: [2, 8], 14: [2, 8], 17: [2, 8], 27: [2, 8], 32: [2, 8], 37: [2, 8], 42: [2, 8], 45: [2, 8], 46: [2, 8], 49: [2, 8], 53: [2, 8] }, { 18: 22, 66: [1, 32], 72: 23, 73: 24, 74: [1, 25], 75: [1, 26], 76: [1, 27], 77: [1, 28], 78: [1, 29], 79: [1, 31], 80: 30 }, { 18: 33, 66: [1, 32], 72: 23, 73: 24, 74: [1, 25], 75: [1, 26], 76: [1, 27], 77: [1, 28], 78: [1, 29], 79: [1, 31], 80: 30 }, { 4: 34, 6: 3, 13: [2, 43], 14: [2, 43], 17: [2, 43], 27: [2, 43], 32: [2, 43], 37: [2, 43], 42: [2, 43], 45: [2, 43], 46: [2, 43], 49: [2, 43], 53: [2, 43] }, { 4: 35, 6: 3, 13: [2, 43], 14: [2, 43], 17: [2, 43], 27: [2, 43], 32: [2, 43], 42: [2, 43], 45: [2, 43], 46: [2, 43], 49: [2, 43], 53: [2, 43] }, { 12: 36, 14: [1, 18] }, { 18: 38, 54: 37, 58: 39, 59: [1, 40], 66: [1, 32], 72: 23, 73: 24, 74: [1, 25], 75: [1, 26], 76: [1, 27], 77: [1, 28], 78: [1, 29], 79: [1, 31], 80: 30 }, { 5: [2, 9], 13: [2, 9], 14: [2, 9], 16: [2, 9], 17: [2, 9], 27: [2, 9], 32: [2, 9], 37: [2, 9], 42: [2, 9], 45: [2, 9], 46: [2, 9], 49: [2, 9], 53: [2, 9] }, { 18: 41, 66: [1, 32], 72: 23, 73: 24, 74: [1, 25], 75: [1, 26], 76: [1, 27], 77: [1, 28], 78: [1, 29], 79: [1, 31], 80: 30 }, { 18: 42, 66: [1, 32], 72: 23, 73: 24, 74: [1, 25], 75: [1, 26], 76: [1, 27], 77: [1, 28], 78: [1, 29], 79: [1, 31], 80: 30 }, { 18: 43, 66: [1, 32], 72: 23, 73: 24, 74: [1, 25], 75: [1, 26], 76: [1, 27], 77: [1, 28], 78: [1, 29], 79: [1, 31], 80: 30 }, { 31: [2, 73], 47: 44, 59: [2, 73], 66: [2, 73], 74: [2, 73], 75: [2, 73], 76: [2, 73], 77: [2, 73], 78: [2, 73], 79: [2, 73] }, { 21: [2, 30], 31: [2, 30], 52: [2, 30], 59: [2, 30], 62: [2, 30], 66: [2, 30], 69: [2, 30], 74: [2, 30], 75: [2, 30], 76: [2, 30], 77: [2, 30], 78: [2, 30], 79: [2, 30] }, { 21: [2, 31], 31: [2, 31], 52: [2, 31], 59: [2, 31], 62: [2, 31], 66: [2, 31], 69: [2, 31], 74: [2, 31], 75: [2, 31], 76: [2, 31], 77: [2, 31], 78: [2, 31], 79: [2, 31] }, { 21: [2, 32], 31: [2, 32], 52: [2, 32], 59: [2, 32], 62: [2, 32], 66: [2, 32], 69: [2, 32], 74: [2, 32], 75: [2, 32], 76: [2, 32], 77: [2, 32], 78: [2, 32], 79: [2, 32] }, { 21: [2, 33], 31: [2, 33], 52: [2, 33], 59: [2, 33], 62: [2, 33], 66: [2, 33], 69: [2, 33], 74: [2, 33], 75: [2, 33], 76: [2, 33], 77: [2, 33], 78: [2, 33], 79: [2, 33] }, { 21: [2, 34], 31: [2, 34], 52: [2, 34], 59: [2, 34], 62: [2, 34], 66: [2, 34], 69: [2, 34], 74: [2, 34], 75: [2, 34], 76: [2, 34], 77: [2, 34], 78: [2, 34], 79: [2, 34] }, { 21: [2, 35], 31: [2, 35], 52: [2, 35], 59: [2, 35], 62: [2, 35], 66: [2, 35], 69: [2, 35], 74: [2, 35], 75: [2, 35], 76: [2, 35], 77: [2, 35], 78: [2, 35], 79: [2, 35] }, { 21: [2, 36], 31: [2, 36], 52: [2, 36], 59: [2, 36], 62: [2, 36], 66: [2, 36], 69: [2, 36], 74: [2, 36], 75: [2, 36], 76: [2, 36], 77: [2, 36], 78: [2, 36], 79: [2, 36] }, { 21: [2, 40], 31: [2, 40], 52: [2, 40], 59: [2, 40], 62: [2, 40], 66: [2, 40], 69: [2, 40], 74: [2, 40], 75: [2, 40], 76: [2, 40], 77: [2, 40], 78: [2, 40], 79: [2, 40], 81: [1, 45] }, { 66: [1, 32], 80: 46 }, { 21: [2, 42], 31: [2, 42], 52: [2, 42], 59: [2, 42], 62: [2, 42], 66: [2, 42], 69: [2, 42], 74: [2, 42], 75: [2, 42], 76: [2, 42], 77: [2, 42], 78: [2, 42], 79: [2, 42], 81: [2, 42] }, { 50: 47, 52: [2, 77], 59: [2, 77], 66: [2, 77], 74: [2, 77], 75: [2, 77], 76: [2, 77], 77: [2, 77], 78: [2, 77], 79: [2, 77] }, { 23: 48, 36: 50, 37: [1, 52], 41: 51, 42: [1, 53], 43: 49, 45: [2, 49] }, { 26: 54, 41: 55, 42: [1, 53], 45: [2, 51] }, { 16: [1, 56] }, { 31: [2, 81], 55: 57, 59: [2, 81], 66: [2, 81], 74: [2, 81], 75: [2, 81], 76: [2, 81], 77: [2, 81], 78: [2, 81], 79: [2, 81] }, { 31: [2, 37], 59: [2, 37], 66: [2, 37], 74: [2, 37], 75: [2, 37], 76: [2, 37], 77: [2, 37], 78: [2, 37], 79: [2, 37] }, { 31: [2, 38], 59: [2, 38], 66: [2, 38], 74: [2, 38], 75: [2, 38], 76: [2, 38], 77: [2, 38], 78: [2, 38], 79: [2, 38] }, { 18: 58, 66: [1, 32], 72: 23, 73: 24, 74: [1, 25], 75: [1, 26], 76: [1, 27], 77: [1, 28], 78: [1, 29], 79: [1, 31], 80: 30 }, { 28: 59, 31: [2, 53], 59: [2, 53], 66: [2, 53], 69: [2, 53], 74: [2, 53], 75: [2, 53], 76: [2, 53], 77: [2, 53], 78: [2, 53], 79: [2, 53] }, { 31: [2, 59], 33: 60, 59: [2, 59], 66: [2, 59], 69: [2, 59], 74: [2, 59], 75: [2, 59], 76: [2, 59], 77: [2, 59], 78: [2, 59], 79: [2, 59] }, { 19: 61, 21: [2, 45], 59: [2, 45], 66: [2, 45], 74: [2, 45], 75: [2, 45], 76: [2, 45], 77: [2, 45], 78: [2, 45], 79: [2, 45] }, { 18: 65, 31: [2, 75], 48: 62, 57: 63, 58: 66, 59: [1, 40], 63: 64, 64: 67, 65: 68, 66: [1, 69], 72: 23, 73: 24, 74: [1, 25], 75: [1, 26], 76: [1, 27], 77: [1, 28], 78: [1, 29], 79: [1, 31], 80: 30 }, { 66: [1, 70] }, { 21: [2, 39], 31: [2, 39], 52: [2, 39], 59: [2, 39], 62: [2, 39], 66: [2, 39], 69: [2, 39], 74: [2, 39], 75: [2, 39], 76: [2, 39], 77: [2, 39], 78: [2, 39], 79: [2, 39], 81: [1, 45] }, { 18: 65, 51: 71, 52: [2, 79], 57: 72, 58: 66, 59: [1, 40], 63: 73, 64: 67, 65: 68, 66: [1, 69], 72: 23, 73: 24, 74: [1, 25], 75: [1, 26], 76: [1, 27], 77: [1, 28], 78: [1, 29], 79: [1, 31], 80: 30 }, { 24: 74, 45: [1, 75] }, { 45: [2, 50] }, { 4: 76, 6: 3, 13: [2, 43], 14: [2, 43], 17: [2, 43], 27: [2, 43], 32: [2, 43], 37: [2, 43], 42: [2, 43], 45: [2, 43], 46: [2, 43], 49: [2, 43], 53: [2, 43] }, { 45: [2, 19] }, { 18: 77, 66: [1, 32], 72: 23, 73: 24, 74: [1, 25], 75: [1, 26], 76: [1, 27], 77: [1, 28], 78: [1, 29], 79: [1, 31], 80: 30 }, { 4: 78, 6: 3, 13: [2, 43], 14: [2, 43], 17: [2, 43], 27: [2, 43], 32: [2, 43], 45: [2, 43], 46: [2, 43], 49: [2, 43], 53: [2, 43] }, { 24: 79, 45: [1, 75] }, { 45: [2, 52] }, { 5: [2, 10], 13: [2, 10], 14: [2, 10], 17: [2, 10], 27: [2, 10], 32: [2, 10], 37: [2, 10], 42: [2, 10], 45: [2, 10], 46: [2, 10], 49: [2, 10], 53: [2, 10] }, { 18: 65, 31: [2, 83], 56: 80, 57: 81, 58: 66, 59: [1, 40], 63: 82, 64: 67, 65: 68, 66: [1, 69], 72: 23, 73: 24, 74: [1, 25], 75: [1, 26], 76: [1, 27], 77: [1, 28], 78: [1, 29], 79: [1, 31], 80: 30 }, { 59: [2, 85], 60: 83, 62: [2, 85], 66: [2, 85], 74: [2, 85], 75: [2, 85], 76: [2, 85], 77: [2, 85], 78: [2, 85], 79: [2, 85] }, { 18: 65, 29: 84, 31: [2, 55], 57: 85, 58: 66, 59: [1, 40], 63: 86, 64: 67, 65: 68, 66: [1, 69], 69: [2, 55], 72: 23, 73: 24, 74: [1, 25], 75: [1, 26], 76: [1, 27], 77: [1, 28], 78: [1, 29], 79: [1, 31], 80: 30 }, { 18: 65, 31: [2, 61], 34: 87, 57: 88, 58: 66, 59: [1, 40], 63: 89, 64: 67, 65: 68, 66: [1, 69], 69: [2, 61], 72: 23, 73: 24, 74: [1, 25], 75: [1, 26], 76: [1, 27], 77: [1, 28], 78: [1, 29], 79: [1, 31], 80: 30 }, { 18: 65, 20: 90, 21: [2, 47], 57: 91, 58: 66, 59: [1, 40], 63: 92, 64: 67, 65: 68, 66: [1, 69], 72: 23, 73: 24, 74: [1, 25], 75: [1, 26], 76: [1, 27], 77: [1, 28], 78: [1, 29], 79: [1, 31], 80: 30 }, { 31: [1, 93] }, { 31: [2, 74], 59: [2, 74], 66: [2, 74], 74: [2, 74], 75: [2, 74], 76: [2, 74], 77: [2, 74], 78: [2, 74], 79: [2, 74] }, { 31: [2, 76] }, { 21: [2, 24], 31: [2, 24], 52: [2, 24], 59: [2, 24], 62: [2, 24], 66: [2, 24], 69: [2, 24], 74: [2, 24], 75: [2, 24], 76: [2, 24], 77: [2, 24], 78: [2, 24], 79: [2, 24] }, { 21: [2, 25], 31: [2, 25], 52: [2, 25], 59: [2, 25], 62: [2, 25], 66: [2, 25], 69: [2, 25], 74: [2, 25], 75: [2, 25], 76: [2, 25], 77: [2, 25], 78: [2, 25], 79: [2, 25] }, { 21: [2, 27], 31: [2, 27], 52: [2, 27], 62: [2, 27], 65: 94, 66: [1, 95], 69: [2, 27] }, { 21: [2, 89], 31: [2, 89], 52: [2, 89], 62: [2, 89], 66: [2, 89], 69: [2, 89] }, { 21: [2, 42], 31: [2, 42], 52: [2, 42], 59: [2, 42], 62: [2, 42], 66: [2, 42], 67: [1, 96], 69: [2, 42], 74: [2, 42], 75: [2, 42], 76: [2, 42], 77: [2, 42], 78: [2, 42], 79: [2, 42], 81: [2, 42] }, { 21: [2, 41], 31: [2, 41], 52: [2, 41], 59: [2, 41], 62: [2, 41], 66: [2, 41], 69: [2, 41], 74: [2, 41], 75: [2, 41], 76: [2, 41], 77: [2, 41], 78: [2, 41], 79: [2, 41], 81: [2, 41] }, { 52: [1, 97] }, { 52: [2, 78], 59: [2, 78], 66: [2, 78], 74: [2, 78], 75: [2, 78], 76: [2, 78], 77: [2, 78], 78: [2, 78], 79: [2, 78] }, { 52: [2, 80] }, { 5: [2, 12], 13: [2, 12], 14: [2, 12], 17: [2, 12], 27: [2, 12], 32: [2, 12], 37: [2, 12], 42: [2, 12], 45: [2, 12], 46: [2, 12], 49: [2, 12], 53: [2, 12] }, { 18: 98, 66: [1, 32], 72: 23, 73: 24, 74: [1, 25], 75: [1, 26], 76: [1, 27], 77: [1, 28], 78: [1, 29], 79: [1, 31], 80: 30 }, { 36: 50, 37: [1, 52], 41: 51, 42: [1, 53], 43: 100, 44: 99, 45: [2, 71] }, { 31: [2, 65], 38: 101, 59: [2, 65], 66: [2, 65], 69: [2, 65], 74: [2, 65], 75: [2, 65], 76: [2, 65], 77: [2, 65], 78: [2, 65], 79: [2, 65] }, { 45: [2, 17] }, { 5: [2, 13], 13: [2, 13], 14: [2, 13], 17: [2, 13], 27: [2, 13], 32: [2, 13], 37: [2, 13], 42: [2, 13], 45: [2, 13], 46: [2, 13], 49: [2, 13], 53: [2, 13] }, { 31: [1, 102] }, { 31: [2, 82], 59: [2, 82], 66: [2, 82], 74: [2, 82], 75: [2, 82], 76: [2, 82], 77: [2, 82], 78: [2, 82], 79: [2, 82] }, { 31: [2, 84] }, { 18: 65, 57: 104, 58: 66, 59: [1, 40], 61: 103, 62: [2, 87], 63: 105, 64: 67, 65: 68, 66: [1, 69], 72: 23, 73: 24, 74: [1, 25], 75: [1, 26], 76: [1, 27], 77: [1, 28], 78: [1, 29], 79: [1, 31], 80: 30 }, { 30: 106, 31: [2, 57], 68: 107, 69: [1, 108] }, { 31: [2, 54], 59: [2, 54], 66: [2, 54], 69: [2, 54], 74: [2, 54], 75: [2, 54], 76: [2, 54], 77: [2, 54], 78: [2, 54], 79: [2, 54] }, { 31: [2, 56], 69: [2, 56] }, { 31: [2, 63], 35: 109, 68: 110, 69: [1, 108] }, { 31: [2, 60], 59: [2, 60], 66: [2, 60], 69: [2, 60], 74: [2, 60], 75: [2, 60], 76: [2, 60], 77: [2, 60], 78: [2, 60], 79: [2, 60] }, { 31: [2, 62], 69: [2, 62] }, { 21: [1, 111] }, { 21: [2, 46], 59: [2, 46], 66: [2, 46], 74: [2, 46], 75: [2, 46], 76: [2, 46], 77: [2, 46], 78: [2, 46], 79: [2, 46] }, { 21: [2, 48] }, { 5: [2, 21], 13: [2, 21], 14: [2, 21], 17: [2, 21], 27: [2, 21], 32: [2, 21], 37: [2, 21], 42: [2, 21], 45: [2, 21], 46: [2, 21], 49: [2, 21], 53: [2, 21] }, { 21: [2, 90], 31: [2, 90], 52: [2, 90], 62: [2, 90], 66: [2, 90], 69: [2, 90] }, { 67: [1, 96] }, { 18: 65, 57: 112, 58: 66, 59: [1, 40], 66: [1, 32], 72: 23, 73: 24, 74: [1, 25], 75: [1, 26], 76: [1, 27], 77: [1, 28], 78: [1, 29], 79: [1, 31], 80: 30 }, { 5: [2, 22], 13: [2, 22], 14: [2, 22], 17: [2, 22], 27: [2, 22], 32: [2, 22], 37: [2, 22], 42: [2, 22], 45: [2, 22], 46: [2, 22], 49: [2, 22], 53: [2, 22] }, { 31: [1, 113] }, { 45: [2, 18] }, { 45: [2, 72] }, { 18: 65, 31: [2, 67], 39: 114, 57: 115, 58: 66, 59: [1, 40], 63: 116, 64: 67, 65: 68, 66: [1, 69], 69: [2, 67], 72: 23, 73: 24, 74: [1, 25], 75: [1, 26], 76: [1, 27], 77: [1, 28], 78: [1, 29], 79: [1, 31], 80: 30 }, { 5: [2, 23], 13: [2, 23], 14: [2, 23], 17: [2, 23], 27: [2, 23], 32: [2, 23], 37: [2, 23], 42: [2, 23], 45: [2, 23], 46: [2, 23], 49: [2, 23], 53: [2, 23] }, { 62: [1, 117] }, { 59: [2, 86], 62: [2, 86], 66: [2, 86], 74: [2, 86], 75: [2, 86], 76: [2, 86], 77: [2, 86], 78: [2, 86], 79: [2, 86] }, { 62: [2, 88] }, { 31: [1, 118] }, { 31: [2, 58] }, { 66: [1, 120], 70: 119 }, { 31: [1, 121] }, { 31: [2, 64] }, { 14: [2, 11] }, { 21: [2, 28], 31: [2, 28], 52: [2, 28], 62: [2, 28], 66: [2, 28], 69: [2, 28] }, { 5: [2, 20], 13: [2, 20], 14: [2, 20], 17: [2, 20], 27: [2, 20], 32: [2, 20], 37: [2, 20], 42: [2, 20], 45: [2, 20], 46: [2, 20], 49: [2, 20], 53: [2, 20] }, { 31: [2, 69], 40: 122, 68: 123, 69: [1, 108] }, { 31: [2, 66], 59: [2, 66], 66: [2, 66], 69: [2, 66], 74: [2, 66], 75: [2, 66], 76: [2, 66], 77: [2, 66], 78: [2, 66], 79: [2, 66] }, { 31: [2, 68], 69: [2, 68] }, { 21: [2, 26], 31: [2, 26], 52: [2, 26], 59: [2, 26], 62: [2, 26], 66: [2, 26], 69: [2, 26], 74: [2, 26], 75: [2, 26], 76: [2, 26], 77: [2, 26], 78: [2, 26], 79: [2, 26] }, { 13: [2, 14], 14: [2, 14], 17: [2, 14], 27: [2, 14], 32: [2, 14], 37: [2, 14], 42: [2, 14], 45: [2, 14], 46: [2, 14], 49: [2, 14], 53: [2, 14] }, { 66: [1, 125], 71: [1, 124] }, { 66: [2, 91], 71: [2, 91] }, { 13: [2, 15], 14: [2, 15], 17: [2, 15], 27: [2, 15], 32: [2, 15], 42: [2, 15], 45: [2, 15], 46: [2, 15], 49: [2, 15], 53: [2, 15] }, { 31: [1, 126] }, { 31: [2, 70] }, { 31: [2, 29] }, { 66: [2, 92], 71: [2, 92] }, { 13: [2, 16], 14: [2, 16], 17: [2, 16], 27: [2, 16], 32: [2, 16], 37: [2, 16], 42: [2, 16], 45: [2, 16], 46: [2, 16], 49: [2, 16], 53: [2, 16] }],
            defaultActions: { 4: [2, 1], 49: [2, 50], 51: [2, 19], 55: [2, 52], 64: [2, 76], 73: [2, 80], 78: [2, 17], 82: [2, 84], 92: [2, 48], 99: [2, 18], 100: [2, 72], 105: [2, 88], 107: [2, 58], 110: [2, 64], 111: [2, 11], 123: [2, 70], 124: [2, 29] },
            parseError: function parseError(str, hash) {
                throw new Error(str);
            },
            parse: function parse(input) {
                var self = this,
                    stack = [0],
                    vstack = [null],
                    lstack = [],
                    table = this.table,
                    yytext = "",
                    yylineno = 0,
                    yyleng = 0,
                    recovering = 0,
                    TERROR = 2,
                    EOF = 1;
                this.lexer.setInput(input);
                this.lexer.yy = this.yy;
                this.yy.lexer = this.lexer;
                this.yy.parser = this;
                if (typeof this.lexer.yylloc == "undefined") this.lexer.yylloc = {};
                var yyloc = this.lexer.yylloc;
                lstack.push(yyloc);
                var ranges = this.lexer.options && this.lexer.options.ranges;
                if (typeof this.yy.parseError === "function") this.parseError = this.yy.parseError;
                function popStack(n) {
                    stack.length = stack.length - 2 * n;
                    vstack.length = vstack.length - n;
                    lstack.length = lstack.length - n;
                }
                function lex() {
                    var token;
                    token = self.lexer.lex() || 1;
                    if (typeof token !== "number") {
                        token = self.symbols_[token] || token;
                    }
                    return token;
                }
                var symbol,
                    preErrorSymbol,
                    state,
                    action,
                    a,
                    r,
                    yyval = {},
                    p,
                    len,
                    newState,
                    expected;
                while (true) {
                    state = stack[stack.length - 1];
                    if (this.defaultActions[state]) {
                        action = this.defaultActions[state];
                    } else {
                        if (symbol === null || typeof symbol == "undefined") {
                            symbol = lex();
                        }
                        action = table[state] && table[state][symbol];
                    }
                    if (typeof action === "undefined" || !action.length || !action[0]) {
                        var errStr = "";
                        if (!recovering) {
                            expected = [];
                            for (p in table[state]) if (this.terminals_[p] && p > 2) {
                                expected.push("'" + this.terminals_[p] + "'");
                            }
                            if (this.lexer.showPosition) {
                                errStr = "Parse error on line " + (yylineno + 1) + ":\n" + this.lexer.showPosition() + "\nExpecting " + expected.join(", ") + ", got '" + (this.terminals_[symbol] || symbol) + "'";
                            } else {
                                errStr = "Parse error on line " + (yylineno + 1) + ": Unexpected " + (symbol == 1 ? "end of input" : "'" + (this.terminals_[symbol] || symbol) + "'");
                            }
                            this.parseError(errStr, { text: this.lexer.match, token: this.terminals_[symbol] || symbol, line: this.lexer.yylineno, loc: yyloc, expected: expected });
                        }
                    }
                    if (action[0] instanceof Array && action.length > 1) {
                        throw new Error("Parse Error: multiple actions possible at state: " + state + ", token: " + symbol);
                    }
                    switch (action[0]) {
                        case 1:
                            stack.push(symbol);
                            vstack.push(this.lexer.yytext);
                            lstack.push(this.lexer.yylloc);
                            stack.push(action[1]);
                            symbol = null;
                            if (!preErrorSymbol) {
                                yyleng = this.lexer.yyleng;
                                yytext = this.lexer.yytext;
                                yylineno = this.lexer.yylineno;
                                yyloc = this.lexer.yylloc;
                                if (recovering > 0) recovering--;
                            } else {
                                symbol = preErrorSymbol;
                                preErrorSymbol = null;
                            }
                            break;
                        case 2:
                            len = this.productions_[action[1]][1];
                            yyval.$ = vstack[vstack.length - len];
                            yyval._$ = { first_line: lstack[lstack.length - (len || 1)].first_line, last_line: lstack[lstack.length - 1].last_line, first_column: lstack[lstack.length - (len || 1)].first_column, last_column: lstack[lstack.length - 1].last_column };
                            if (ranges) {
                                yyval._$.range = [lstack[lstack.length - (len || 1)].range[0], lstack[lstack.length - 1].range[1]];
                            }
                            r = this.performAction.call(yyval, yytext, yyleng, yylineno, this.yy, action[1], vstack, lstack);
                            if (typeof r !== "undefined") {
                                return r;
                            }
                            if (len) {
                                stack = stack.slice(0, -1 * len * 2);
                                vstack = vstack.slice(0, -1 * len);
                                lstack = lstack.slice(0, -1 * len);
                            }
                            stack.push(this.productions_[action[1]][0]);
                            vstack.push(yyval.$);
                            lstack.push(yyval._$);
                            newState = table[stack[stack.length - 2]][stack[stack.length - 1]];
                            stack.push(newState);
                            break;
                        case 3:
                            return true;
                    }
                }
                return true;
            }
        };
        /* Jison generated lexer */
        var lexer = (function () {
            var lexer = { EOF: 1,
                parseError: function parseError(str, hash) {
                    if (this.yy.parser) {
                        this.yy.parser.parseError(str, hash);
                    } else {
                        throw new Error(str);
                    }
                },
                setInput: function (input) {
                    this._input = input;
                    this._more = this._less = this.done = false;
                    this.yylineno = this.yyleng = 0;
                    this.yytext = this.matched = this.match = '';
                    this.conditionStack = ['INITIAL'];
                    this.yylloc = { first_line: 1, first_column: 0, last_line: 1, last_column: 0 };
                    if (this.options.ranges) this.yylloc.range = [0, 0];
                    this.offset = 0;
                    return this;
                },
                input: function () {
                    var ch = this._input[0];
                    this.yytext += ch;
                    this.yyleng++;
                    this.offset++;
                    this.match += ch;
                    this.matched += ch;
                    var lines = ch.match(/(?:\r\n?|\n).*/g);
                    if (lines) {
                        this.yylineno++;
                        this.yylloc.last_line++;
                    } else {
                        this.yylloc.last_column++;
                    }
                    if (this.options.ranges) this.yylloc.range[1]++;

                    this._input = this._input.slice(1);
                    return ch;
                },
                unput: function (ch) {
                    var len = ch.length;
                    var lines = ch.split(/(?:\r\n?|\n)/g);

                    this._input = ch + this._input;
                    this.yytext = this.yytext.substr(0, this.yytext.length - len - 1);
                    //this.yyleng -= len;
                    this.offset -= len;
                    var oldLines = this.match.split(/(?:\r\n?|\n)/g);
                    this.match = this.match.substr(0, this.match.length - 1);
                    this.matched = this.matched.substr(0, this.matched.length - 1);

                    if (lines.length - 1) this.yylineno -= lines.length - 1;
                    var r = this.yylloc.range;

                    this.yylloc = { first_line: this.yylloc.first_line,
                        last_line: this.yylineno + 1,
                        first_column: this.yylloc.first_column,
                        last_column: lines ? (lines.length === oldLines.length ? this.yylloc.first_column : 0) + oldLines[oldLines.length - lines.length].length - lines[0].length : this.yylloc.first_column - len
                    };

                    if (this.options.ranges) {
                        this.yylloc.range = [r[0], r[0] + this.yyleng - len];
                    }
                    return this;
                },
                more: function () {
                    this._more = true;
                    return this;
                },
                less: function (n) {
                    this.unput(this.match.slice(n));
                },
                pastInput: function () {
                    var past = this.matched.substr(0, this.matched.length - this.match.length);
                    return (past.length > 20 ? '...' : '') + past.substr(-20).replace(/\n/g, "");
                },
                upcomingInput: function () {
                    var next = this.match;
                    if (next.length < 20) {
                        next += this._input.substr(0, 20 - next.length);
                    }
                    return (next.substr(0, 20) + (next.length > 20 ? '...' : '')).replace(/\n/g, "");
                },
                showPosition: function () {
                    var pre = this.pastInput();
                    var c = new Array(pre.length + 1).join("-");
                    return pre + this.upcomingInput() + "\n" + c + "^";
                },
                next: function () {
                    if (this.done) {
                        return this.EOF;
                    }
                    if (!this._input) this.done = true;

                    var token, match, tempMatch, index, col, lines;
                    if (!this._more) {
                        this.yytext = '';
                        this.match = '';
                    }
                    var rules = this._currentRules();
                    for (var i = 0; i < rules.length; i++) {
                        tempMatch = this._input.match(this.rules[rules[i]]);
                        if (tempMatch && (!match || tempMatch[0].length > match[0].length)) {
                            match = tempMatch;
                            index = i;
                            if (!this.options.flex) break;
                        }
                    }
                    if (match) {
                        lines = match[0].match(/(?:\r\n?|\n).*/g);
                        if (lines) this.yylineno += lines.length;
                        this.yylloc = { first_line: this.yylloc.last_line,
                            last_line: this.yylineno + 1,
                            first_column: this.yylloc.last_column,
                            last_column: lines ? lines[lines.length - 1].length - lines[lines.length - 1].match(/\r?\n?/)[0].length : this.yylloc.last_column + match[0].length };
                        this.yytext += match[0];
                        this.match += match[0];
                        this.matches = match;
                        this.yyleng = this.yytext.length;
                        if (this.options.ranges) {
                            this.yylloc.range = [this.offset, this.offset += this.yyleng];
                        }
                        this._more = false;
                        this._input = this._input.slice(match[0].length);
                        this.matched += match[0];
                        token = this.performAction.call(this, this.yy, this, rules[index], this.conditionStack[this.conditionStack.length - 1]);
                        if (this.done && this._input) this.done = false;
                        if (token) return token;else return;
                    }
                    if (this._input === "") {
                        return this.EOF;
                    } else {
                        return this.parseError('Lexical error on line ' + (this.yylineno + 1) + '. Unrecognized text.\n' + this.showPosition(), { text: "", token: null, line: this.yylineno });
                    }
                },
                lex: function lex() {
                    var r = this.next();
                    if (typeof r !== 'undefined') {
                        return r;
                    } else {
                        return this.lex();
                    }
                },
                begin: function begin(condition) {
                    this.conditionStack.push(condition);
                },
                popState: function popState() {
                    return this.conditionStack.pop();
                },
                _currentRules: function _currentRules() {
                    return this.conditions[this.conditionStack[this.conditionStack.length - 1]].rules;
                },
                topState: function () {
                    return this.conditionStack[this.conditionStack.length - 2];
                },
                pushState: function begin(condition) {
                    this.begin(condition);
                } };
            lexer.options = {};
            lexer.performAction = function anonymous(yy, yy_, $avoiding_name_collisions, YY_START) {

                function strip(start, end) {
                    return yy_.yytext = yy_.yytext.substr(start, yy_.yyleng - end);
                }

                var YYSTATE = YY_START;
                switch ($avoiding_name_collisions) {
                    case 0:
                        if (yy_.yytext.slice(-2) === "\\\\") {
                            strip(0, 1);
                            this.begin("mu");
                        } else if (yy_.yytext.slice(-1) === "\\") {
                            strip(0, 1);
                            this.begin("emu");
                        } else {
                            this.begin("mu");
                        }
                        if (yy_.yytext) return 14;

                        break;
                    case 1:
                        return 14;
                        break;
                    case 2:
                        this.popState();
                        return 14;

                        break;
                    case 3:
                        yy_.yytext = yy_.yytext.substr(5, yy_.yyleng - 9);
                        this.popState();
                        return 16;

                        break;
                    case 4:
                        return 14;
                        break;
                    case 5:
                        this.popState();
                        return 13;

                        break;
                    case 6:
                        return 59;
                        break;
                    case 7:
                        return 62;
                        break;
                    case 8:
                        return 17;
                        break;
                    case 9:
                        this.popState();
                        this.begin('raw');
                        return 21;

                        break;
                    case 10:
                        return 53;
                        break;
                    case 11:
                        return 27;
                        break;
                    case 12:
                        return 45;
                        break;
                    case 13:
                        this.popState();return 42;
                        break;
                    case 14:
                        this.popState();return 42;
                        break;
                    case 15:
                        return 32;
                        break;
                    case 16:
                        return 37;
                        break;
                    case 17:
                        return 49;
                        break;
                    case 18:
                        return 46;
                        break;
                    case 19:
                        this.unput(yy_.yytext);
                        this.popState();
                        this.begin('com');

                        break;
                    case 20:
                        this.popState();
                        return 13;

                        break;
                    case 21:
                        return 46;
                        break;
                    case 22:
                        return 67;
                        break;
                    case 23:
                        return 66;
                        break;
                    case 24:
                        return 66;
                        break;
                    case 25:
                        return 81;
                        break;
                    case 26:
                        // ignore whitespace
                        break;
                    case 27:
                        this.popState();return 52;
                        break;
                    case 28:
                        this.popState();return 31;
                        break;
                    case 29:
                        yy_.yytext = strip(1, 2).replace(/\\"/g, '"');return 74;
                        break;
                    case 30:
                        yy_.yytext = strip(1, 2).replace(/\\'/g, "'");return 74;
                        break;
                    case 31:
                        return 79;
                        break;
                    case 32:
                        return 76;
                        break;
                    case 33:
                        return 76;
                        break;
                    case 34:
                        return 77;
                        break;
                    case 35:
                        return 78;
                        break;
                    case 36:
                        return 75;
                        break;
                    case 37:
                        return 69;
                        break;
                    case 38:
                        return 71;
                        break;
                    case 39:
                        return 66;
                        break;
                    case 40:
                        return 66;
                        break;
                    case 41:
                        return 'INVALID';
                        break;
                    case 42:
                        return 5;
                        break;
                }
            };
            lexer.rules = [/^(?:[^\x00]*?(?=(\{\{)))/, /^(?:[^\x00]+)/, /^(?:[^\x00]{2,}?(?=(\{\{|\\\{\{|\\\\\{\{|$)))/, /^(?:\{\{\{\{\/[^\s!"#%-,\.\/;->@\[-\^`\{-~]+(?=[=}\s\/.])\}\}\}\})/, /^(?:[^\x00]*?(?=(\{\{\{\{\/)))/, /^(?:[\s\S]*?--(~)?\}\})/, /^(?:\()/, /^(?:\))/, /^(?:\{\{\{\{)/, /^(?:\}\}\}\})/, /^(?:\{\{(~)?>)/, /^(?:\{\{(~)?#)/, /^(?:\{\{(~)?\/)/, /^(?:\{\{(~)?\^\s*(~)?\}\})/, /^(?:\{\{(~)?\s*else\s*(~)?\}\})/, /^(?:\{\{(~)?\^)/, /^(?:\{\{(~)?\s*else\b)/, /^(?:\{\{(~)?\{)/, /^(?:\{\{(~)?&)/, /^(?:\{\{(~)?!--)/, /^(?:\{\{(~)?![\s\S]*?\}\})/, /^(?:\{\{(~)?)/, /^(?:=)/, /^(?:\.\.)/, /^(?:\.(?=([=~}\s\/.)|])))/, /^(?:[\/.])/, /^(?:\s+)/, /^(?:\}(~)?\}\})/, /^(?:(~)?\}\})/, /^(?:"(\\["]|[^"])*")/, /^(?:'(\\[']|[^'])*')/, /^(?:@)/, /^(?:true(?=([~}\s)])))/, /^(?:false(?=([~}\s)])))/, /^(?:undefined(?=([~}\s)])))/, /^(?:null(?=([~}\s)])))/, /^(?:-?[0-9]+(?:\.[0-9]+)?(?=([~}\s)])))/, /^(?:as\s+\|)/, /^(?:\|)/, /^(?:([^\s!"#%-,\.\/;->@\[-\^`\{-~]+(?=([=~}\s\/.)|]))))/, /^(?:\[[^\]]*\])/, /^(?:.)/, /^(?:$)/];
            lexer.conditions = { "mu": { "rules": [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42], "inclusive": false }, "emu": { "rules": [2], "inclusive": false }, "com": { "rules": [5], "inclusive": false }, "raw": { "rules": [3, 4], "inclusive": false }, "INITIAL": { "rules": [0, 1, 42], "inclusive": true } };
            return lexer;
        })();
        parser.lexer = lexer;
        function Parser() {
            this.yy = {};
        }Parser.prototype = parser;parser.Parser = Parser;
        return new Parser();
    })();exports['default'] = handlebars;

});
define('htmlbars-syntax/handlebars/compiler/visitor', ['exports', '../exception', './ast'], function (exports, Exception, AST) {

  'use strict';

  function Visitor() {
    this.parents = [];
  }

  Visitor.prototype = {
    constructor: Visitor,
    mutating: false,

    // Visits a given value. If mutating, will replace the value if necessary.
    acceptKey: function (node, name) {
      var value = this.accept(node[name]);
      if (this.mutating) {
        // Hacky sanity check:
        if (value && (!value.type || !AST['default'][value.type])) {
          throw new Exception['default']('Unexpected node type "' + value.type + '" found when accepting ' + name + ' on ' + node.type);
        }
        node[name] = value;
      }
    },

    // Performs an accept operation with added sanity check to ensure
    // required keys are not removed.
    acceptRequired: function (node, name) {
      this.acceptKey(node, name);

      if (!node[name]) {
        throw new Exception['default'](node.type + ' requires ' + name);
      }
    },

    // Traverses a given array. If mutating, empty respnses will be removed
    // for child elements.
    acceptArray: function (array) {
      for (var i = 0, l = array.length; i < l; i++) {
        this.acceptKey(array, i);

        if (!array[i]) {
          array.splice(i, 1);
          i--;
          l--;
        }
      }
    },

    accept: function (object) {
      if (!object) {
        return;
      }

      if (this.current) {
        this.parents.unshift(this.current);
      }
      this.current = object;

      var ret = this[object.type](object);

      this.current = this.parents.shift();

      if (!this.mutating || ret) {
        return ret;
      } else if (ret !== false) {
        return object;
      }
    },

    Program: function (program) {
      this.acceptArray(program.body);
    },

    MustacheStatement: function (mustache) {
      this.acceptRequired(mustache, 'path');
      this.acceptArray(mustache.params);
      this.acceptKey(mustache, 'hash');
    },

    BlockStatement: function (block) {
      this.acceptRequired(block, 'path');
      this.acceptArray(block.params);
      this.acceptKey(block, 'hash');

      this.acceptKey(block, 'program');
      this.acceptKey(block, 'inverse');
    },

    PartialStatement: function (partial) {
      this.acceptRequired(partial, 'name');
      this.acceptArray(partial.params);
      this.acceptKey(partial, 'hash');
    },

    ContentStatement: function () /* content */{},
    CommentStatement: function () /* comment */{},

    SubExpression: function (sexpr) {
      this.acceptRequired(sexpr, 'path');
      this.acceptArray(sexpr.params);
      this.acceptKey(sexpr, 'hash');
    },

    PathExpression: function () /* path */{},

    StringLiteral: function () /* string */{},
    NumberLiteral: function () /* number */{},
    BooleanLiteral: function () /* bool */{},
    UndefinedLiteral: function () /* literal */{},
    NullLiteral: function () /* literal */{},

    Hash: function (hash) {
      this.acceptArray(hash.pairs);
    },
    HashPair: function (pair) {
      this.acceptRequired(pair, 'value');
    }
  };

  exports['default'] = Visitor;

});
define('htmlbars-syntax/handlebars/compiler/whitespace-control', ['exports', './visitor'], function (exports, Visitor) {

  'use strict';

  function WhitespaceControl() {}
  WhitespaceControl.prototype = new Visitor['default']();

  WhitespaceControl.prototype.Program = function (program) {
    var isRoot = !this.isRootSeen;
    this.isRootSeen = true;

    var body = program.body;
    for (var i = 0, l = body.length; i < l; i++) {
      var current = body[i],
          strip = this.accept(current);

      if (!strip) {
        continue;
      }

      var _isPrevWhitespace = isPrevWhitespace(body, i, isRoot),
          _isNextWhitespace = isNextWhitespace(body, i, isRoot),
          openStandalone = strip.openStandalone && _isPrevWhitespace,
          closeStandalone = strip.closeStandalone && _isNextWhitespace,
          inlineStandalone = strip.inlineStandalone && _isPrevWhitespace && _isNextWhitespace;

      if (strip.close) {
        omitRight(body, i, true);
      }
      if (strip.open) {
        omitLeft(body, i, true);
      }

      if (inlineStandalone) {
        omitRight(body, i);

        if (omitLeft(body, i)) {
          // If we are on a standalone node, save the indent info for partials
          if (current.type === 'PartialStatement') {
            // Pull out the whitespace from the final line
            current.indent = /([ \t]+$)/.exec(body[i - 1].original)[1];
          }
        }
      }
      if (openStandalone) {
        omitRight((current.program || current.inverse).body);

        // Strip out the previous content node if it's whitespace only
        omitLeft(body, i);
      }
      if (closeStandalone) {
        // Always strip the next node
        omitRight(body, i);

        omitLeft((current.inverse || current.program).body);
      }
    }

    return program;
  };
  WhitespaceControl.prototype.BlockStatement = function (block) {
    this.accept(block.program);
    this.accept(block.inverse);

    // Find the inverse program that is involed with whitespace stripping.
    var program = block.program || block.inverse,
        inverse = block.program && block.inverse,
        firstInverse = inverse,
        lastInverse = inverse;

    if (inverse && inverse.chained) {
      firstInverse = inverse.body[0].program;

      // Walk the inverse chain to find the last inverse that is actually in the chain.
      while (lastInverse.chained) {
        lastInverse = lastInverse.body[lastInverse.body.length - 1].program;
      }
    }

    var strip = {
      open: block.openStrip.open,
      close: block.closeStrip.close,

      // Determine the standalone candiacy. Basically flag our content as being possibly standalone
      // so our parent can determine if we actually are standalone
      openStandalone: isNextWhitespace(program.body),
      closeStandalone: isPrevWhitespace((firstInverse || program).body)
    };

    if (block.openStrip.close) {
      omitRight(program.body, null, true);
    }

    if (inverse) {
      var inverseStrip = block.inverseStrip;

      if (inverseStrip.open) {
        omitLeft(program.body, null, true);
      }

      if (inverseStrip.close) {
        omitRight(firstInverse.body, null, true);
      }
      if (block.closeStrip.open) {
        omitLeft(lastInverse.body, null, true);
      }

      // Find standalone else statments
      if (isPrevWhitespace(program.body) && isNextWhitespace(firstInverse.body)) {
        omitLeft(program.body);
        omitRight(firstInverse.body);
      }
    } else if (block.closeStrip.open) {
      omitLeft(program.body, null, true);
    }

    return strip;
  };

  WhitespaceControl.prototype.MustacheStatement = function (mustache) {
    return mustache.strip;
  };

  WhitespaceControl.prototype.PartialStatement = WhitespaceControl.prototype.CommentStatement = function (node) {
    /* istanbul ignore next */
    var strip = node.strip || {};
    return {
      inlineStandalone: true,
      open: strip.open,
      close: strip.close
    };
  };

  function isPrevWhitespace(body, i, isRoot) {
    if (i === undefined) {
      i = body.length;
    }

    // Nodes that end with newlines are considered whitespace (but are special
    // cased for strip operations)
    var prev = body[i - 1],
        sibling = body[i - 2];
    if (!prev) {
      return isRoot;
    }

    if (prev.type === 'ContentStatement') {
      return (sibling || !isRoot ? /\r?\n\s*?$/ : /(^|\r?\n)\s*?$/).test(prev.original);
    }
  }
  function isNextWhitespace(body, i, isRoot) {
    if (i === undefined) {
      i = -1;
    }

    var next = body[i + 1],
        sibling = body[i + 2];
    if (!next) {
      return isRoot;
    }

    if (next.type === 'ContentStatement') {
      return (sibling || !isRoot ? /^\s*?\r?\n/ : /^\s*?(\r?\n|$)/).test(next.original);
    }
  }

  // Marks the node to the right of the position as omitted.
  // I.e. {{foo}}' ' will mark the ' ' node as omitted.
  //
  // If i is undefined, then the first child will be marked as such.
  //
  // If mulitple is truthy then all whitespace will be stripped out until non-whitespace
  // content is met.
  function omitRight(body, i, multiple) {
    var current = body[i == null ? 0 : i + 1];
    if (!current || current.type !== 'ContentStatement' || !multiple && current.rightStripped) {
      return;
    }

    var original = current.value;
    current.value = current.value.replace(multiple ? /^\s+/ : /^[ \t]*\r?\n?/, '');
    current.rightStripped = current.value !== original;
  }

  // Marks the node to the left of the position as omitted.
  // I.e. ' '{{foo}} will mark the ' ' node as omitted.
  //
  // If i is undefined then the last child will be marked as such.
  //
  // If mulitple is truthy then all whitespace will be stripped out until non-whitespace
  // content is met.
  function omitLeft(body, i, multiple) {
    var current = body[i == null ? body.length - 1 : i - 1];
    if (!current || current.type !== 'ContentStatement' || !multiple && current.leftStripped) {
      return;
    }

    // We omit the last node if it's whitespace only and not preceeded by a non-content node.
    var original = current.value;
    current.value = current.value.replace(multiple ? /\s+$/ : /[ \t]+$/, '');
    current.leftStripped = current.value !== original;
    return current.leftStripped;
  }

  exports['default'] = WhitespaceControl;

});
define('htmlbars-syntax/handlebars/exception', ['exports'], function (exports) {

  'use strict';


  var errorProps = ['description', 'fileName', 'lineNumber', 'message', 'name', 'number', 'stack'];

  function Exception(message, node) {
    var loc = node && node.loc,
        line = undefined,
        column = undefined;
    if (loc) {
      line = loc.start.line;
      column = loc.start.column;

      message += ' - ' + line + ':' + column;
    }

    var tmp = Error.prototype.constructor.call(this, message);

    // Unfortunately errors are not enumerable in Chrome (at least), so `for prop in tmp` doesn't work.
    for (var idx = 0; idx < errorProps.length; idx++) {
      this[errorProps[idx]] = tmp[errorProps[idx]];
    }

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, Exception);
    }

    if (loc) {
      this.lineNumber = line;
      this.column = column;
    }
  }

  Exception.prototype = new Error();

  exports['default'] = Exception;

});
define('htmlbars-syntax/handlebars/safe-string', ['exports'], function (exports) {

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
define('htmlbars-syntax/handlebars/utils', ['exports'], function (exports) {

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
define('htmlbars-syntax/parser', ['exports', './handlebars/compiler/base', '../htmlbars-syntax', '../simple-html-tokenizer/evented-tokenizer', '../simple-html-tokenizer/entity-parser', '../simple-html-tokenizer/char-refs/full', './parser/handlebars-node-visitors', './parser/tokenizer-event-handlers'], function (exports, base, syntax, EventedTokenizer, EntityParser, fullCharRefs, handlebarsNodeVisitors, tokenizerEventHandlers) {

  'use strict';

  exports.preprocess = preprocess;
  exports.Parser = Parser;

  function preprocess(html, options) {
    var ast = typeof html === 'object' ? html : base.parse(html);
    var combined = new Parser(html, options).acceptNode(ast);

    if (options && options.plugins && options.plugins.ast) {
      for (var i = 0, l = options.plugins.ast.length; i < l; i++) {
        var plugin = new options.plugins.ast[i](options);

        plugin.syntax = syntax;

        combined = plugin.transform(combined);
      }
    }

    return combined;
  }

  exports['default'] = preprocess;

  var entityParser = new EntityParser['default'](fullCharRefs['default']);

  function Parser(source, options) {
    this.options = options || {};
    this.elementStack = [];
    this.tokenizer = new EventedTokenizer['default'](this, entityParser);

    this.currentNode = null;
    this.currentAttribute = null;

    if (typeof source === 'string') {
      this.source = source.split(/(?:\r\n?|\n)/g);
    }
  }

  for (var key in handlebarsNodeVisitors['default']) {
    Parser.prototype[key] = handlebarsNodeVisitors['default'][key];
  }

  for (var key in tokenizerEventHandlers['default']) {
    Parser.prototype[key] = tokenizerEventHandlers['default'][key];
  }

  Parser.prototype.acceptNode = function (node) {
    return this[node.type](node);
  };

  Parser.prototype.currentElement = function () {
    return this.elementStack[this.elementStack.length - 1];
  };

  Parser.prototype.sourceForMustache = function (mustache) {
    var firstLine = mustache.loc.start.line - 1;
    var lastLine = mustache.loc.end.line - 1;
    var currentLine = firstLine - 1;
    var firstColumn = mustache.loc.start.column + 2;
    var lastColumn = mustache.loc.end.column - 2;
    var string = [];
    var line;

    if (!this.source) {
      return '{{' + mustache.path.id.original + '}}';
    }

    while (currentLine < lastLine) {
      currentLine++;
      line = this.source[currentLine];

      if (currentLine === firstLine) {
        if (firstLine === lastLine) {
          string.push(line.slice(firstColumn, lastColumn));
        } else {
          string.push(line.slice(firstColumn));
        }
      } else if (currentLine === lastLine) {
        string.push(line.slice(0, lastColumn));
      } else {
        string.push(line);
      }
    }

    return string.join('\n');
  };

});
define('htmlbars-syntax/parser/handlebars-node-visitors', ['exports', '../builders', '../utils'], function (exports, b, utils) {

  'use strict';

  exports['default'] = {

    Program: function (program) {
      var body = [];
      var node = b['default'].program(body, program.blockParams, program.loc);
      var i,
          l = program.body.length;

      this.elementStack.push(node);

      if (l === 0) {
        return this.elementStack.pop();
      }

      for (i = 0; i < l; i++) {
        this.acceptNode(program.body[i]);
      }

      // Ensure that that the element stack is balanced properly.
      var poppedNode = this.elementStack.pop();
      if (poppedNode !== node) {
        throw new Error("Unclosed element `" + poppedNode.tag + "` (on line " + poppedNode.loc.start.line + ").");
      }

      return node;
    },

    BlockStatement: function (block) {
      delete block.inverseStrip;
      delete block.openString;
      delete block.closeStrip;

      if (this.tokenizer.state === 'comment') {
        this.appendToCommentData('{{' + this.sourceForMustache(block) + '}}');
        return;
      }

      if (this.tokenizer.state !== 'comment' && this.tokenizer.state !== 'data' && this.tokenizer.state !== 'beforeData') {
        throw new Error("A block may only be used inside an HTML element or another block.");
      }

      block = acceptCommonNodes(this, block);
      var program = block.program ? this.acceptNode(block.program) : null;
      var inverse = block.inverse ? this.acceptNode(block.inverse) : null;

      var node = b['default'].block(block.path, block.params, block.hash, program, inverse, block.loc);
      var parentProgram = this.currentElement();
      utils.appendChild(parentProgram, node);
    },

    MustacheStatement: function (rawMustache) {
      var tokenizer = this.tokenizer;
      var path = rawMustache.path;
      var params = rawMustache.params;
      var hash = rawMustache.hash;
      var escaped = rawMustache.escaped;
      var loc = rawMustache.loc;

      var mustache = b['default'].mustache(path, params, hash, !escaped, loc);

      if (tokenizer.state === 'comment') {
        this.appendToCommentData('{{' + this.sourceForMustache(mustache) + '}}');
        return;
      }

      acceptCommonNodes(this, mustache);

      switch (tokenizer.state) {
        // Tag helpers
        case "tagName":
          addElementModifier(this.currentNode, mustache);
          tokenizer.state = "beforeAttributeName";
          break;
        case "beforeAttributeName":
          addElementModifier(this.currentNode, mustache);
          break;
        case "attributeName":
        case "afterAttributeName":
          this.beginAttributeValue(false);
          this.finishAttributeValue();
          addElementModifier(this.currentNode, mustache);
          tokenizer.state = "beforeAttributeName";
          break;
        case "afterAttributeValueQuoted":
          addElementModifier(this.currentNode, mustache);
          tokenizer.state = "beforeAttributeName";
          break;

        // Attribute values
        case "beforeAttributeValue":
          appendDynamicAttributeValuePart(this.currentAttribute, mustache);
          tokenizer.state = 'attributeValueUnquoted';
          break;
        case "attributeValueDoubleQuoted":
        case "attributeValueSingleQuoted":
        case "attributeValueUnquoted":
          appendDynamicAttributeValuePart(this.currentAttribute, mustache);
          break;

        // TODO: Only append child when the tokenizer state makes
        // sense to do so, otherwise throw an error.
        default:
          utils.appendChild(this.currentElement(), mustache);
      }

      return mustache;
    },

    ContentStatement: function (content) {
      var changeLines = 0;
      if (content.rightStripped) {
        changeLines = leadingNewlineDifference(content.original, content.value);
      }

      this.tokenizer.line = this.tokenizer.line + changeLines;
      this.tokenizer.tokenizePart(content.value);
      this.tokenizer.flushData();
    },

    CommentStatement: function (comment) {
      return comment;
    },

    PartialStatement: function (partial) {
      utils.appendChild(this.currentElement(), partial);
      return partial;
    },

    SubExpression: function (sexpr) {
      return acceptCommonNodes(this, sexpr);
    },

    PathExpression: function (path) {
      delete path.data;
      delete path.depth;

      return path;
    },

    Hash: function (hash) {
      for (var i = 0; i < hash.pairs.length; i++) {
        this.acceptNode(hash.pairs[i].value);
      }

      return hash;
    },

    StringLiteral: function () {},
    BooleanLiteral: function () {},
    NumberLiteral: function () {},
    UndefinedLiteral: function () {},
    NullLiteral: function () {}
  };

  function leadingNewlineDifference(original, value) {
    if (value === '') {
      // if it is empty, just return the count of newlines
      // in original
      return original.split("\n").length - 1;
    }

    // otherwise, return the number of newlines prior to
    // `value`
    var difference = original.split(value)[0];
    var lines = difference.split(/\n/);

    return lines.length - 1;
  }

  function acceptCommonNodes(compiler, node) {
    compiler.acceptNode(node.path);

    if (node.params) {
      for (var i = 0; i < node.params.length; i++) {
        compiler.acceptNode(node.params[i]);
      }
    } else {
      node.params = [];
    }

    if (node.hash) {
      compiler.acceptNode(node.hash);
    } else {
      node.hash = b['default'].hash();
    }

    return node;
  }

  function addElementModifier(element, mustache) {
    var path = mustache.path;
    var params = mustache.params;
    var hash = mustache.hash;
    var loc = mustache.loc;

    var modifier = b['default'].elementModifier(path, params, hash, loc);
    element.modifiers.push(modifier);
  }

  function appendDynamicAttributeValuePart(attribute, part) {
    attribute.isDynamic = true;
    attribute.parts.push(part);
  }

});
define('htmlbars-syntax/parser/tokenizer-event-handlers', ['exports', '../../htmlbars-util/void-tag-names', '../builders', '../utils'], function (exports, voidMap, b, utils) {

  'use strict';

  exports['default'] = {
    reset: function () {
      this.currentNode = null;
    },

    // Comment

    beginComment: function () {
      this.currentNode = b['default'].comment("");
    },

    appendToCommentData: function (char) {
      this.currentNode.value += char;
    },

    finishComment: function () {
      utils.appendChild(this.currentElement(), this.currentNode);
    },

    // Data

    beginData: function () {
      this.currentNode = b['default'].text();
    },

    appendToData: function (char) {
      this.currentNode.chars += char;
    },

    finishData: function () {
      utils.appendChild(this.currentElement(), this.currentNode);
    },

    // Tags - basic

    beginStartTag: function () {
      this.currentNode = {
        type: 'StartTag',
        name: "",
        attributes: [],
        modifiers: [],
        selfClosing: false,
        loc: null
      };
    },

    beginEndTag: function () {
      this.currentNode = {
        type: 'EndTag',
        name: "",
        attributes: [],
        modifiers: [],
        selfClosing: false,
        loc: null
      };
    },

    finishTag: function () {
      var _tokenizer = this.tokenizer;
      var tagLine = _tokenizer.tagLine;
      var tagColumn = _tokenizer.tagColumn;
      var line = _tokenizer.line;
      var column = _tokenizer.column;

      var tag = this.currentNode;
      tag.loc = b['default'].loc(tagLine, tagColumn, line, column);

      if (tag.type === 'StartTag') {
        this.finishStartTag();

        if (voidMap['default'].hasOwnProperty(tag.name) || tag.selfClosing) {
          this.finishEndTag(true);
        }
      } else if (tag.type === 'EndTag') {
        this.finishEndTag(false);
      }
    },

    finishStartTag: function () {
      var _currentNode = this.currentNode;
      var name = _currentNode.name;
      var attributes = _currentNode.attributes;
      var modifiers = _currentNode.modifiers;

      var loc = b['default'].loc(this.tokenizer.tagLine, this.tokenizer.tagColumn);
      var element = b['default'].element(name, attributes, modifiers, [], loc);
      this.elementStack.push(element);
    },

    finishEndTag: function (isVoid) {
      var tag = this.currentNode;

      var element = this.elementStack.pop();
      var parent = this.currentElement();
      var disableComponentGeneration = this.options.disableComponentGeneration === true;

      validateEndTag(tag, element, isVoid);

      element.loc.end.line = this.tokenizer.line;
      element.loc.end.column = this.tokenizer.column;

      if (disableComponentGeneration || element.tag.indexOf("-") === -1) {
        utils.appendChild(parent, element);
      } else {
        var program = b['default'].program(element.children);
        utils.parseComponentBlockParams(element, program);
        var component = b['default'].component(element.tag, element.attributes, program, element.loc);
        utils.appendChild(parent, component);
      }
    },

    markTagAsSelfClosing: function () {
      this.currentNode.selfClosing = true;
    },

    // Tags - name

    appendToTagName: function (char) {
      this.currentNode.name += char;
    },

    // Tags - attributes

    beginAttribute: function () {
      var tag = this.currentNode;
      if (tag.type === 'EndTag') {
        throw new Error("Invalid end tag: closing tag must not have attributes, " + ("in `" + tag.name + "` (on line " + this.tokenizer.line + ")."));
      }

      this.currentAttribute = {
        name: "",
        parts: [],
        isQuoted: false,
        isDynamic: false
      };
    },

    appendToAttributeName: function (char) {
      this.currentAttribute.name += char;
    },

    beginAttributeValue: function (isQuoted) {
      this.currentAttribute.isQuoted = isQuoted;
    },

    appendToAttributeValue: function (char) {
      var parts = this.currentAttribute.parts;

      if (typeof parts[parts.length - 1] === 'string') {
        parts[parts.length - 1] += char;
      } else {
        parts.push(char);
      }
    },

    finishAttributeValue: function () {
      var _currentAttribute = this.currentAttribute;
      var name = _currentAttribute.name;
      var parts = _currentAttribute.parts;
      var isQuoted = _currentAttribute.isQuoted;
      var isDynamic = _currentAttribute.isDynamic;

      var value = assembleAttributeValue(parts, isQuoted, isDynamic, this.tokenizer.line);

      this.currentNode.attributes.push(b['default'].attr(name, value));
    }
  };

  function assembleAttributeValue(parts, isQuoted, isDynamic, line) {
    if (isDynamic) {
      if (isQuoted) {
        return assembleConcatenatedValue(parts);
      } else {
        if (parts.length === 1) {
          return parts[0];
        } else {
          throw new Error("An unquoted attribute value must be a string or a mustache, " + "preceeded by whitespace or a '=' character, and " + ("followed by whitespace or a '>' character (on line " + line + ")"));
        }
      }
    } else {
      return b['default'].text(parts.length > 0 ? parts[0] : "");
    }
  }

  function assembleConcatenatedValue(parts) {
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i];

      if (typeof part === 'string') {
        parts[i] = b['default'].string(parts[i]);
      } else {
        if (part.type === 'MustacheStatement') {
          parts[i] = utils.unwrapMustache(part);
        } else {
          throw new Error("Unsupported node in quoted attribute value: " + part.type);
        }
      }
    }

    return b['default'].concat(parts);
  }

  function validateEndTag(tag, element, selfClosing) {
    var error;

    if (voidMap['default'][tag.name] && !selfClosing) {
      // EngTag is also called by StartTag for void and self-closing tags (i.e.
      // <input> or <br />, so we need to check for that here. Otherwise, we would
      // throw an error for those cases.
      error = "Invalid end tag " + formatEndTagInfo(tag) + " (void elements cannot have end tags).";
    } else if (element.tag === undefined) {
      error = "Closing tag " + formatEndTagInfo(tag) + " without an open tag.";
    } else if (element.tag !== tag.name) {
      error = "Closing tag " + formatEndTagInfo(tag) + " did not match last open tag `" + element.tag + "` (on line " + element.loc.start.line + ").";
    }

    if (error) {
      throw new Error(error);
    }
  }

  function formatEndTagInfo(tag) {
    return "`" + tag.name + "` (on line " + tag.loc.end.line + ")";
  }

});
define('htmlbars-syntax/utils', ['exports', '../htmlbars-util/array-utils'], function (exports, array_utils) {

  'use strict';

  exports.parseComponentBlockParams = parseComponentBlockParams;
  exports.childrenFor = childrenFor;
  exports.appendChild = appendChild;
  exports.isHelper = isHelper;
  exports.unwrapMustache = unwrapMustache;

  var ID_INVERSE_PATTERN = /[!"#%-,\.\/;->@\[-\^`\{-~]/;

  // Checks the component's attributes to see if it uses block params.
  // If it does, registers the block params with the program and
  // removes the corresponding attributes from the element.

  function parseComponentBlockParams(element, program) {
    var l = element.attributes.length;
    var attrNames = [];

    for (var i = 0; i < l; i++) {
      attrNames.push(element.attributes[i].name);
    }

    var asIndex = array_utils.indexOfArray(attrNames, 'as');

    if (asIndex !== -1 && l > asIndex && attrNames[asIndex + 1].charAt(0) === '|') {
      // Some basic validation, since we're doing the parsing ourselves
      var paramsString = attrNames.slice(asIndex).join(' ');
      if (paramsString.charAt(paramsString.length - 1) !== '|' || paramsString.match(/\|/g).length !== 2) {
        throw new Error('Invalid block parameters syntax: \'' + paramsString + '\'');
      }

      var params = [];
      for (i = asIndex + 1; i < l; i++) {
        var param = attrNames[i].replace(/\|/g, '');
        if (param !== '') {
          if (ID_INVERSE_PATTERN.test(param)) {
            throw new Error('Invalid identifier for block parameters: \'' + param + '\' in \'' + paramsString + '\'');
          }
          params.push(param);
        }
      }

      if (params.length === 0) {
        throw new Error('Cannot use zero block parameters: \'' + paramsString + '\'');
      }

      element.attributes = element.attributes.slice(0, asIndex);
      program.blockParams = params;
    }
  }

  function childrenFor(node) {
    if (node.type === 'Program') {
      return node.body;
    }
    if (node.type === 'ElementNode') {
      return node.children;
    }
  }

  function appendChild(parent, node) {
    childrenFor(parent).push(node);
  }

  function isHelper(mustache) {
    return mustache.params && mustache.params.length > 0 || mustache.hash && mustache.hash.pairs.length > 0;
  }

  function unwrapMustache(mustache) {
    if (isHelper(mustache)) {
      return mustache;
    } else {
      return mustache.path;
    }
  }

});
define('htmlbars-syntax/walker', ['exports'], function (exports) {

  'use strict';

  function Walker(order) {
    this.order = order;
    this.stack = [];
  }

  exports['default'] = Walker;

  Walker.prototype.visit = function (node, callback) {
    if (!node) {
      return;
    }

    this.stack.push(node);

    if (this.order === 'post') {
      this.children(node, callback);
      callback(node, this);
    } else {
      callback(node, this);
      this.children(node, callback);
    }

    this.stack.pop();
  };

  var visitors = {
    Program: function (walker, node, callback) {
      for (var i = 0; i < node.body.length; i++) {
        walker.visit(node.body[i], callback);
      }
    },

    ElementNode: function (walker, node, callback) {
      for (var i = 0; i < node.children.length; i++) {
        walker.visit(node.children[i], callback);
      }
    },

    BlockStatement: function (walker, node, callback) {
      walker.visit(node.program, callback);
      walker.visit(node.inverse, callback);
    },

    ComponentNode: function (walker, node, callback) {
      walker.visit(node.program, callback);
    }
  };

  Walker.prototype.children = function (node, callback) {
    var visitor = visitors[node.type];
    if (visitor) {
      visitor(this, node, callback);
    }
  };

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
define('htmlbars-util/safe-string', ['exports', './handlebars/safe-string'], function (exports, SafeString) {

	'use strict';

	exports['default'] = SafeString['default'];

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
define('htmlbars-util/void-tag-names', ['exports', './array-utils'], function (exports, array_utils) {

  'use strict';

  var voidTagNames = "area base br col command embed hr img input keygen link meta param source track wbr";
  var voidMap = {};

  array_utils.forEach(voidTagNames.split(" "), function (tagName) {
    voidMap[tagName] = true;
  });

  exports['default'] = voidMap;

});
define('htmlbars', ['exports', './htmlbars-syntax', './htmlbars-compiler/compiler', './htmlbars-syntax/walker'], function (exports, __dep0__, compiler, Walker) {

	'use strict';

	/*
	 * @overview  HTMLBars
	 * @copyright Copyright 2011-2014 Tilde Inc. and contributors
	 * @license   Licensed under MIT license
	 *            See https://raw.githubusercontent.com/tildeio/htmlbars/master/LICENSE
	 * @version   VERSION_STRING_PLACEHOLDER
	 */

	// Break cycles in the module loader.

	exports.compile = compiler.compile;
	exports.compileSpec = compiler.compileSpec;
	exports.Walker = Walker['default'];

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
define('simple-html-tokenizer', ['exports', './simple-html-tokenizer/evented-tokenizer', './simple-html-tokenizer/tokenizer', './simple-html-tokenizer/tokenize', './simple-html-tokenizer/generator', './simple-html-tokenizer/generate', './simple-html-tokenizer/tokens'], function (exports, EventedTokenizer, Tokenizer, tokenize, Generator, generate, tokens) {

	'use strict';

	/*jshint boss:true*/

	exports.EventedTokenizer = EventedTokenizer['default'];
	exports.Tokenizer = Tokenizer['default'];
	exports.tokenize = tokenize['default'];
	exports.Generator = Generator['default'];
	exports.generate = generate['default'];
	exports.StartTag = tokens.StartTag;
	exports.EndTag = tokens.EndTag;
	exports.Chars = tokens.Chars;
	exports.Comment = tokens.Comment;

});
define('simple-html-tokenizer.umd', ['./simple-html-tokenizer'], function (simple_html_tokenizer) {

  'use strict';

  /* global define:false, module:false */
  (function (root, factory) {
    if (typeof define === 'function' && define.amd) {
      define([], factory);
    } else if (typeof exports === 'object') {
      module.exports = factory();
    } else {
      root.HTML5Tokenizer = factory();
    }
  })(undefined, function () {
    return {
      EventedTokenizer: simple_html_tokenizer.EventedTokenizer,
      Tokenizer: simple_html_tokenizer.Tokenizer,
      tokenize: simple_html_tokenizer.tokenize,
      Generator: simple_html_tokenizer.Generator,
      generate: simple_html_tokenizer.generate,
      StartTag: simple_html_tokenizer.StartTag,
      EndTag: simple_html_tokenizer.EndTag,
      Chars: simple_html_tokenizer.Chars,
      Comment: simple_html_tokenizer.Comment
    };
  });

});
define('simple-html-tokenizer/char-refs/full', ['exports'], function (exports) {

  'use strict';

  exports['default'] = {
    AElig: [198],
    AMP: [38],
    Aacute: [193],
    Abreve: [258],
    Acirc: [194],
    Acy: [1040],
    Afr: [120068],
    Agrave: [192],
    Alpha: [913],
    Amacr: [256],
    And: [10835],
    Aogon: [260],
    Aopf: [120120],
    ApplyFunction: [8289],
    Aring: [197],
    Ascr: [119964],
    Assign: [8788],
    Atilde: [195],
    Auml: [196],
    Backslash: [8726],
    Barv: [10983],
    Barwed: [8966],
    Bcy: [1041],
    Because: [8757],
    Bernoullis: [8492],
    Beta: [914],
    Bfr: [120069],
    Bopf: [120121],
    Breve: [728],
    Bscr: [8492],
    Bumpeq: [8782],
    CHcy: [1063],
    COPY: [169],
    Cacute: [262],
    Cap: [8914],
    CapitalDifferentialD: [8517],
    Cayleys: [8493],
    Ccaron: [268],
    Ccedil: [199],
    Ccirc: [264],
    Cconint: [8752],
    Cdot: [266],
    Cedilla: [184],
    CenterDot: [183],
    Cfr: [8493],
    Chi: [935],
    CircleDot: [8857],
    CircleMinus: [8854],
    CirclePlus: [8853],
    CircleTimes: [8855],
    ClockwiseContourIntegral: [8754],
    CloseCurlyDoubleQuote: [8221],
    CloseCurlyQuote: [8217],
    Colon: [8759],
    Colone: [10868],
    Congruent: [8801],
    Conint: [8751],
    ContourIntegral: [8750],
    Copf: [8450],
    Coproduct: [8720],
    CounterClockwiseContourIntegral: [8755],
    Cross: [10799],
    Cscr: [119966],
    Cup: [8915],
    CupCap: [8781],
    DD: [8517],
    DDotrahd: [10513],
    DJcy: [1026],
    DScy: [1029],
    DZcy: [1039],
    Dagger: [8225],
    Darr: [8609],
    Dashv: [10980],
    Dcaron: [270],
    Dcy: [1044],
    Del: [8711],
    Delta: [916],
    Dfr: [120071],
    DiacriticalAcute: [180],
    DiacriticalDot: [729],
    DiacriticalDoubleAcute: [733],
    DiacriticalGrave: [96],
    DiacriticalTilde: [732],
    Diamond: [8900],
    DifferentialD: [8518],
    Dopf: [120123],
    Dot: [168],
    DotDot: [8412],
    DotEqual: [8784],
    DoubleContourIntegral: [8751],
    DoubleDot: [168],
    DoubleDownArrow: [8659],
    DoubleLeftArrow: [8656],
    DoubleLeftRightArrow: [8660],
    DoubleLeftTee: [10980],
    DoubleLongLeftArrow: [10232],
    DoubleLongLeftRightArrow: [10234],
    DoubleLongRightArrow: [10233],
    DoubleRightArrow: [8658],
    DoubleRightTee: [8872],
    DoubleUpArrow: [8657],
    DoubleUpDownArrow: [8661],
    DoubleVerticalBar: [8741],
    DownArrow: [8595],
    DownArrowBar: [10515],
    DownArrowUpArrow: [8693],
    DownBreve: [785],
    DownLeftRightVector: [10576],
    DownLeftTeeVector: [10590],
    DownLeftVector: [8637],
    DownLeftVectorBar: [10582],
    DownRightTeeVector: [10591],
    DownRightVector: [8641],
    DownRightVectorBar: [10583],
    DownTee: [8868],
    DownTeeArrow: [8615],
    Downarrow: [8659],
    Dscr: [119967],
    Dstrok: [272],
    ENG: [330],
    ETH: [208],
    Eacute: [201],
    Ecaron: [282],
    Ecirc: [202],
    Ecy: [1069],
    Edot: [278],
    Efr: [120072],
    Egrave: [200],
    Element: [8712],
    Emacr: [274],
    EmptySmallSquare: [9723],
    EmptyVerySmallSquare: [9643],
    Eogon: [280],
    Eopf: [120124],
    Epsilon: [917],
    Equal: [10869],
    EqualTilde: [8770],
    Equilibrium: [8652],
    Escr: [8496],
    Esim: [10867],
    Eta: [919],
    Euml: [203],
    Exists: [8707],
    ExponentialE: [8519],
    Fcy: [1060],
    Ffr: [120073],
    FilledSmallSquare: [9724],
    FilledVerySmallSquare: [9642],
    Fopf: [120125],
    ForAll: [8704],
    Fouriertrf: [8497],
    Fscr: [8497],
    GJcy: [1027],
    GT: [62],
    Gamma: [915],
    Gammad: [988],
    Gbreve: [286],
    Gcedil: [290],
    Gcirc: [284],
    Gcy: [1043],
    Gdot: [288],
    Gfr: [120074],
    Gg: [8921],
    Gopf: [120126],
    GreaterEqual: [8805],
    GreaterEqualLess: [8923],
    GreaterFullEqual: [8807],
    GreaterGreater: [10914],
    GreaterLess: [8823],
    GreaterSlantEqual: [10878],
    GreaterTilde: [8819],
    Gscr: [119970],
    Gt: [8811],
    HARDcy: [1066],
    Hacek: [711],
    Hat: [94],
    Hcirc: [292],
    Hfr: [8460],
    HilbertSpace: [8459],
    Hopf: [8461],
    HorizontalLine: [9472],
    Hscr: [8459],
    Hstrok: [294],
    HumpDownHump: [8782],
    HumpEqual: [8783],
    IEcy: [1045],
    IJlig: [306],
    IOcy: [1025],
    Iacute: [205],
    Icirc: [206],
    Icy: [1048],
    Idot: [304],
    Ifr: [8465],
    Igrave: [204],
    Im: [8465],
    Imacr: [298],
    ImaginaryI: [8520],
    Implies: [8658],
    Int: [8748],
    Integral: [8747],
    Intersection: [8898],
    InvisibleComma: [8291],
    InvisibleTimes: [8290],
    Iogon: [302],
    Iopf: [120128],
    Iota: [921],
    Iscr: [8464],
    Itilde: [296],
    Iukcy: [1030],
    Iuml: [207],
    Jcirc: [308],
    Jcy: [1049],
    Jfr: [120077],
    Jopf: [120129],
    Jscr: [119973],
    Jsercy: [1032],
    Jukcy: [1028],
    KHcy: [1061],
    KJcy: [1036],
    Kappa: [922],
    Kcedil: [310],
    Kcy: [1050],
    Kfr: [120078],
    Kopf: [120130],
    Kscr: [119974],
    LJcy: [1033],
    LT: [60],
    Lacute: [313],
    Lambda: [923],
    Lang: [10218],
    Laplacetrf: [8466],
    Larr: [8606],
    Lcaron: [317],
    Lcedil: [315],
    Lcy: [1051],
    LeftAngleBracket: [10216],
    LeftArrow: [8592],
    LeftArrowBar: [8676],
    LeftArrowRightArrow: [8646],
    LeftCeiling: [8968],
    LeftDoubleBracket: [10214],
    LeftDownTeeVector: [10593],
    LeftDownVector: [8643],
    LeftDownVectorBar: [10585],
    LeftFloor: [8970],
    LeftRightArrow: [8596],
    LeftRightVector: [10574],
    LeftTee: [8867],
    LeftTeeArrow: [8612],
    LeftTeeVector: [10586],
    LeftTriangle: [8882],
    LeftTriangleBar: [10703],
    LeftTriangleEqual: [8884],
    LeftUpDownVector: [10577],
    LeftUpTeeVector: [10592],
    LeftUpVector: [8639],
    LeftUpVectorBar: [10584],
    LeftVector: [8636],
    LeftVectorBar: [10578],
    Leftarrow: [8656],
    Leftrightarrow: [8660],
    LessEqualGreater: [8922],
    LessFullEqual: [8806],
    LessGreater: [8822],
    LessLess: [10913],
    LessSlantEqual: [10877],
    LessTilde: [8818],
    Lfr: [120079],
    Ll: [8920],
    Lleftarrow: [8666],
    Lmidot: [319],
    LongLeftArrow: [10229],
    LongLeftRightArrow: [10231],
    LongRightArrow: [10230],
    Longleftarrow: [10232],
    Longleftrightarrow: [10234],
    Longrightarrow: [10233],
    Lopf: [120131],
    LowerLeftArrow: [8601],
    LowerRightArrow: [8600],
    Lscr: [8466],
    Lsh: [8624],
    Lstrok: [321],
    Lt: [8810],
    Map: [10501],
    Mcy: [1052],
    MediumSpace: [8287],
    Mellintrf: [8499],
    Mfr: [120080],
    MinusPlus: [8723],
    Mopf: [120132],
    Mscr: [8499],
    Mu: [924],
    NJcy: [1034],
    Nacute: [323],
    Ncaron: [327],
    Ncedil: [325],
    Ncy: [1053],
    NegativeMediumSpace: [8203],
    NegativeThickSpace: [8203],
    NegativeThinSpace: [8203],
    NegativeVeryThinSpace: [8203],
    NestedGreaterGreater: [8811],
    NestedLessLess: [8810],
    NewLine: [10],
    Nfr: [120081],
    NoBreak: [8288],
    NonBreakingSpace: [160],
    Nopf: [8469],
    Not: [10988],
    NotCongruent: [8802],
    NotCupCap: [8813],
    NotDoubleVerticalBar: [8742],
    NotElement: [8713],
    NotEqual: [8800],
    NotEqualTilde: [8770, 824],
    NotExists: [8708],
    NotGreater: [8815],
    NotGreaterEqual: [8817],
    NotGreaterFullEqual: [8807, 824],
    NotGreaterGreater: [8811, 824],
    NotGreaterLess: [8825],
    NotGreaterSlantEqual: [10878, 824],
    NotGreaterTilde: [8821],
    NotHumpDownHump: [8782, 824],
    NotHumpEqual: [8783, 824],
    NotLeftTriangle: [8938],
    NotLeftTriangleBar: [10703, 824],
    NotLeftTriangleEqual: [8940],
    NotLess: [8814],
    NotLessEqual: [8816],
    NotLessGreater: [8824],
    NotLessLess: [8810, 824],
    NotLessSlantEqual: [10877, 824],
    NotLessTilde: [8820],
    NotNestedGreaterGreater: [10914, 824],
    NotNestedLessLess: [10913, 824],
    NotPrecedes: [8832],
    NotPrecedesEqual: [10927, 824],
    NotPrecedesSlantEqual: [8928],
    NotReverseElement: [8716],
    NotRightTriangle: [8939],
    NotRightTriangleBar: [10704, 824],
    NotRightTriangleEqual: [8941],
    NotSquareSubset: [8847, 824],
    NotSquareSubsetEqual: [8930],
    NotSquareSuperset: [8848, 824],
    NotSquareSupersetEqual: [8931],
    NotSubset: [8834, 8402],
    NotSubsetEqual: [8840],
    NotSucceeds: [8833],
    NotSucceedsEqual: [10928, 824],
    NotSucceedsSlantEqual: [8929],
    NotSucceedsTilde: [8831, 824],
    NotSuperset: [8835, 8402],
    NotSupersetEqual: [8841],
    NotTilde: [8769],
    NotTildeEqual: [8772],
    NotTildeFullEqual: [8775],
    NotTildeTilde: [8777],
    NotVerticalBar: [8740],
    Nscr: [119977],
    Ntilde: [209],
    Nu: [925],
    OElig: [338],
    Oacute: [211],
    Ocirc: [212],
    Ocy: [1054],
    Odblac: [336],
    Ofr: [120082],
    Ograve: [210],
    Omacr: [332],
    Omega: [937],
    Omicron: [927],
    Oopf: [120134],
    OpenCurlyDoubleQuote: [8220],
    OpenCurlyQuote: [8216],
    Or: [10836],
    Oscr: [119978],
    Oslash: [216],
    Otilde: [213],
    Otimes: [10807],
    Ouml: [214],
    OverBar: [8254],
    OverBrace: [9182],
    OverBracket: [9140],
    OverParenthesis: [9180],
    PartialD: [8706],
    Pcy: [1055],
    Pfr: [120083],
    Phi: [934],
    Pi: [928],
    PlusMinus: [177],
    Poincareplane: [8460],
    Popf: [8473],
    Pr: [10939],
    Precedes: [8826],
    PrecedesEqual: [10927],
    PrecedesSlantEqual: [8828],
    PrecedesTilde: [8830],
    Prime: [8243],
    Product: [8719],
    Proportion: [8759],
    Proportional: [8733],
    Pscr: [119979],
    Psi: [936],
    QUOT: [34],
    Qfr: [120084],
    Qopf: [8474],
    Qscr: [119980],
    RBarr: [10512],
    REG: [174],
    Racute: [340],
    Rang: [10219],
    Rarr: [8608],
    Rarrtl: [10518],
    Rcaron: [344],
    Rcedil: [342],
    Rcy: [1056],
    Re: [8476],
    ReverseElement: [8715],
    ReverseEquilibrium: [8651],
    ReverseUpEquilibrium: [10607],
    Rfr: [8476],
    Rho: [929],
    RightAngleBracket: [10217],
    RightArrow: [8594],
    RightArrowBar: [8677],
    RightArrowLeftArrow: [8644],
    RightCeiling: [8969],
    RightDoubleBracket: [10215],
    RightDownTeeVector: [10589],
    RightDownVector: [8642],
    RightDownVectorBar: [10581],
    RightFloor: [8971],
    RightTee: [8866],
    RightTeeArrow: [8614],
    RightTeeVector: [10587],
    RightTriangle: [8883],
    RightTriangleBar: [10704],
    RightTriangleEqual: [8885],
    RightUpDownVector: [10575],
    RightUpTeeVector: [10588],
    RightUpVector: [8638],
    RightUpVectorBar: [10580],
    RightVector: [8640],
    RightVectorBar: [10579],
    Rightarrow: [8658],
    Ropf: [8477],
    RoundImplies: [10608],
    Rrightarrow: [8667],
    Rscr: [8475],
    Rsh: [8625],
    RuleDelayed: [10740],
    SHCHcy: [1065],
    SHcy: [1064],
    SOFTcy: [1068],
    Sacute: [346],
    Sc: [10940],
    Scaron: [352],
    Scedil: [350],
    Scirc: [348],
    Scy: [1057],
    Sfr: [120086],
    ShortDownArrow: [8595],
    ShortLeftArrow: [8592],
    ShortRightArrow: [8594],
    ShortUpArrow: [8593],
    Sigma: [931],
    SmallCircle: [8728],
    Sopf: [120138],
    Sqrt: [8730],
    Square: [9633],
    SquareIntersection: [8851],
    SquareSubset: [8847],
    SquareSubsetEqual: [8849],
    SquareSuperset: [8848],
    SquareSupersetEqual: [8850],
    SquareUnion: [8852],
    Sscr: [119982],
    Star: [8902],
    Sub: [8912],
    Subset: [8912],
    SubsetEqual: [8838],
    Succeeds: [8827],
    SucceedsEqual: [10928],
    SucceedsSlantEqual: [8829],
    SucceedsTilde: [8831],
    SuchThat: [8715],
    Sum: [8721],
    Sup: [8913],
    Superset: [8835],
    SupersetEqual: [8839],
    Supset: [8913],
    THORN: [222],
    TRADE: [8482],
    TSHcy: [1035],
    TScy: [1062],
    Tab: [9],
    Tau: [932],
    Tcaron: [356],
    Tcedil: [354],
    Tcy: [1058],
    Tfr: [120087],
    Therefore: [8756],
    Theta: [920],
    ThickSpace: [8287, 8202],
    ThinSpace: [8201],
    Tilde: [8764],
    TildeEqual: [8771],
    TildeFullEqual: [8773],
    TildeTilde: [8776],
    Topf: [120139],
    TripleDot: [8411],
    Tscr: [119983],
    Tstrok: [358],
    Uacute: [218],
    Uarr: [8607],
    Uarrocir: [10569],
    Ubrcy: [1038],
    Ubreve: [364],
    Ucirc: [219],
    Ucy: [1059],
    Udblac: [368],
    Ufr: [120088],
    Ugrave: [217],
    Umacr: [362],
    UnderBar: [95],
    UnderBrace: [9183],
    UnderBracket: [9141],
    UnderParenthesis: [9181],
    Union: [8899],
    UnionPlus: [8846],
    Uogon: [370],
    Uopf: [120140],
    UpArrow: [8593],
    UpArrowBar: [10514],
    UpArrowDownArrow: [8645],
    UpDownArrow: [8597],
    UpEquilibrium: [10606],
    UpTee: [8869],
    UpTeeArrow: [8613],
    Uparrow: [8657],
    Updownarrow: [8661],
    UpperLeftArrow: [8598],
    UpperRightArrow: [8599],
    Upsi: [978],
    Upsilon: [933],
    Uring: [366],
    Uscr: [119984],
    Utilde: [360],
    Uuml: [220],
    VDash: [8875],
    Vbar: [10987],
    Vcy: [1042],
    Vdash: [8873],
    Vdashl: [10982],
    Vee: [8897],
    Verbar: [8214],
    Vert: [8214],
    VerticalBar: [8739],
    VerticalLine: [124],
    VerticalSeparator: [10072],
    VerticalTilde: [8768],
    VeryThinSpace: [8202],
    Vfr: [120089],
    Vopf: [120141],
    Vscr: [119985],
    Vvdash: [8874],
    Wcirc: [372],
    Wedge: [8896],
    Wfr: [120090],
    Wopf: [120142],
    Wscr: [119986],
    Xfr: [120091],
    Xi: [926],
    Xopf: [120143],
    Xscr: [119987],
    YAcy: [1071],
    YIcy: [1031],
    YUcy: [1070],
    Yacute: [221],
    Ycirc: [374],
    Ycy: [1067],
    Yfr: [120092],
    Yopf: [120144],
    Yscr: [119988],
    Yuml: [376],
    ZHcy: [1046],
    Zacute: [377],
    Zcaron: [381],
    Zcy: [1047],
    Zdot: [379],
    ZeroWidthSpace: [8203],
    Zeta: [918],
    Zfr: [8488],
    Zopf: [8484],
    Zscr: [119989],
    aacute: [225],
    abreve: [259],
    ac: [8766],
    acE: [8766, 819],
    acd: [8767],
    acirc: [226],
    acute: [180],
    acy: [1072],
    aelig: [230],
    af: [8289],
    afr: [120094],
    agrave: [224],
    alefsym: [8501],
    aleph: [8501],
    alpha: [945],
    amacr: [257],
    amalg: [10815],
    amp: [38],
    and: [8743],
    andand: [10837],
    andd: [10844],
    andslope: [10840],
    andv: [10842],
    ang: [8736],
    ange: [10660],
    angle: [8736],
    angmsd: [8737],
    angmsdaa: [10664],
    angmsdab: [10665],
    angmsdac: [10666],
    angmsdad: [10667],
    angmsdae: [10668],
    angmsdaf: [10669],
    angmsdag: [10670],
    angmsdah: [10671],
    angrt: [8735],
    angrtvb: [8894],
    angrtvbd: [10653],
    angsph: [8738],
    angst: [197],
    angzarr: [9084],
    aogon: [261],
    aopf: [120146],
    ap: [8776],
    apE: [10864],
    apacir: [10863],
    ape: [8778],
    apid: [8779],
    apos: [39],
    approx: [8776],
    approxeq: [8778],
    aring: [229],
    ascr: [119990],
    ast: [42],
    asymp: [8776],
    asympeq: [8781],
    atilde: [227],
    auml: [228],
    awconint: [8755],
    awint: [10769],
    bNot: [10989],
    backcong: [8780],
    backepsilon: [1014],
    backprime: [8245],
    backsim: [8765],
    backsimeq: [8909],
    barvee: [8893],
    barwed: [8965],
    barwedge: [8965],
    bbrk: [9141],
    bbrktbrk: [9142],
    bcong: [8780],
    bcy: [1073],
    bdquo: [8222],
    becaus: [8757],
    because: [8757],
    bemptyv: [10672],
    bepsi: [1014],
    bernou: [8492],
    beta: [946],
    beth: [8502],
    between: [8812],
    bfr: [120095],
    bigcap: [8898],
    bigcirc: [9711],
    bigcup: [8899],
    bigodot: [10752],
    bigoplus: [10753],
    bigotimes: [10754],
    bigsqcup: [10758],
    bigstar: [9733],
    bigtriangledown: [9661],
    bigtriangleup: [9651],
    biguplus: [10756],
    bigvee: [8897],
    bigwedge: [8896],
    bkarow: [10509],
    blacklozenge: [10731],
    blacksquare: [9642],
    blacktriangle: [9652],
    blacktriangledown: [9662],
    blacktriangleleft: [9666],
    blacktriangleright: [9656],
    blank: [9251],
    blk12: [9618],
    blk14: [9617],
    blk34: [9619],
    block: [9608],
    bne: [61, 8421],
    bnequiv: [8801, 8421],
    bnot: [8976],
    bopf: [120147],
    bot: [8869],
    bottom: [8869],
    bowtie: [8904],
    boxDL: [9559],
    boxDR: [9556],
    boxDl: [9558],
    boxDr: [9555],
    boxH: [9552],
    boxHD: [9574],
    boxHU: [9577],
    boxHd: [9572],
    boxHu: [9575],
    boxUL: [9565],
    boxUR: [9562],
    boxUl: [9564],
    boxUr: [9561],
    boxV: [9553],
    boxVH: [9580],
    boxVL: [9571],
    boxVR: [9568],
    boxVh: [9579],
    boxVl: [9570],
    boxVr: [9567],
    boxbox: [10697],
    boxdL: [9557],
    boxdR: [9554],
    boxdl: [9488],
    boxdr: [9484],
    boxh: [9472],
    boxhD: [9573],
    boxhU: [9576],
    boxhd: [9516],
    boxhu: [9524],
    boxminus: [8863],
    boxplus: [8862],
    boxtimes: [8864],
    boxuL: [9563],
    boxuR: [9560],
    boxul: [9496],
    boxur: [9492],
    boxv: [9474],
    boxvH: [9578],
    boxvL: [9569],
    boxvR: [9566],
    boxvh: [9532],
    boxvl: [9508],
    boxvr: [9500],
    bprime: [8245],
    breve: [728],
    brvbar: [166],
    bscr: [119991],
    bsemi: [8271],
    bsim: [8765],
    bsime: [8909],
    bsol: [92],
    bsolb: [10693],
    bsolhsub: [10184],
    bull: [8226],
    bullet: [8226],
    bump: [8782],
    bumpE: [10926],
    bumpe: [8783],
    bumpeq: [8783],
    cacute: [263],
    cap: [8745],
    capand: [10820],
    capbrcup: [10825],
    capcap: [10827],
    capcup: [10823],
    capdot: [10816],
    caps: [8745, 65024],
    caret: [8257],
    caron: [711],
    ccaps: [10829],
    ccaron: [269],
    ccedil: [231],
    ccirc: [265],
    ccups: [10828],
    ccupssm: [10832],
    cdot: [267],
    cedil: [184],
    cemptyv: [10674],
    cent: [162],
    centerdot: [183],
    cfr: [120096],
    chcy: [1095],
    check: [10003],
    checkmark: [10003],
    chi: [967],
    cir: [9675],
    cirE: [10691],
    circ: [710],
    circeq: [8791],
    circlearrowleft: [8634],
    circlearrowright: [8635],
    circledR: [174],
    circledS: [9416],
    circledast: [8859],
    circledcirc: [8858],
    circleddash: [8861],
    cire: [8791],
    cirfnint: [10768],
    cirmid: [10991],
    cirscir: [10690],
    clubs: [9827],
    clubsuit: [9827],
    colon: [58],
    colone: [8788],
    coloneq: [8788],
    comma: [44],
    commat: [64],
    comp: [8705],
    compfn: [8728],
    complement: [8705],
    complexes: [8450],
    cong: [8773],
    congdot: [10861],
    conint: [8750],
    copf: [120148],
    coprod: [8720],
    copy: [169],
    copysr: [8471],
    crarr: [8629],
    cross: [10007],
    cscr: [119992],
    csub: [10959],
    csube: [10961],
    csup: [10960],
    csupe: [10962],
    ctdot: [8943],
    cudarrl: [10552],
    cudarrr: [10549],
    cuepr: [8926],
    cuesc: [8927],
    cularr: [8630],
    cularrp: [10557],
    cup: [8746],
    cupbrcap: [10824],
    cupcap: [10822],
    cupcup: [10826],
    cupdot: [8845],
    cupor: [10821],
    cups: [8746, 65024],
    curarr: [8631],
    curarrm: [10556],
    curlyeqprec: [8926],
    curlyeqsucc: [8927],
    curlyvee: [8910],
    curlywedge: [8911],
    curren: [164],
    curvearrowleft: [8630],
    curvearrowright: [8631],
    cuvee: [8910],
    cuwed: [8911],
    cwconint: [8754],
    cwint: [8753],
    cylcty: [9005],
    dArr: [8659],
    dHar: [10597],
    dagger: [8224],
    daleth: [8504],
    darr: [8595],
    dash: [8208],
    dashv: [8867],
    dbkarow: [10511],
    dblac: [733],
    dcaron: [271],
    dcy: [1076],
    dd: [8518],
    ddagger: [8225],
    ddarr: [8650],
    ddotseq: [10871],
    deg: [176],
    delta: [948],
    demptyv: [10673],
    dfisht: [10623],
    dfr: [120097],
    dharl: [8643],
    dharr: [8642],
    diam: [8900],
    diamond: [8900],
    diamondsuit: [9830],
    diams: [9830],
    die: [168],
    digamma: [989],
    disin: [8946],
    div: [247],
    divide: [247],
    divideontimes: [8903],
    divonx: [8903],
    djcy: [1106],
    dlcorn: [8990],
    dlcrop: [8973],
    dollar: [36],
    dopf: [120149],
    dot: [729],
    doteq: [8784],
    doteqdot: [8785],
    dotminus: [8760],
    dotplus: [8724],
    dotsquare: [8865],
    doublebarwedge: [8966],
    downarrow: [8595],
    downdownarrows: [8650],
    downharpoonleft: [8643],
    downharpoonright: [8642],
    drbkarow: [10512],
    drcorn: [8991],
    drcrop: [8972],
    dscr: [119993],
    dscy: [1109],
    dsol: [10742],
    dstrok: [273],
    dtdot: [8945],
    dtri: [9663],
    dtrif: [9662],
    duarr: [8693],
    duhar: [10607],
    dwangle: [10662],
    dzcy: [1119],
    dzigrarr: [10239],
    eDDot: [10871],
    eDot: [8785],
    eacute: [233],
    easter: [10862],
    ecaron: [283],
    ecir: [8790],
    ecirc: [234],
    ecolon: [8789],
    ecy: [1101],
    edot: [279],
    ee: [8519],
    efDot: [8786],
    efr: [120098],
    eg: [10906],
    egrave: [232],
    egs: [10902],
    egsdot: [10904],
    el: [10905],
    elinters: [9191],
    ell: [8467],
    els: [10901],
    elsdot: [10903],
    emacr: [275],
    empty: [8709],
    emptyset: [8709],
    emptyv: [8709],
    emsp: [8195],
    emsp13: [8196],
    emsp14: [8197],
    eng: [331],
    ensp: [8194],
    eogon: [281],
    eopf: [120150],
    epar: [8917],
    eparsl: [10723],
    eplus: [10865],
    epsi: [949],
    epsilon: [949],
    epsiv: [1013],
    eqcirc: [8790],
    eqcolon: [8789],
    eqsim: [8770],
    eqslantgtr: [10902],
    eqslantless: [10901],
    equals: [61],
    equest: [8799],
    equiv: [8801],
    equivDD: [10872],
    eqvparsl: [10725],
    erDot: [8787],
    erarr: [10609],
    escr: [8495],
    esdot: [8784],
    esim: [8770],
    eta: [951],
    eth: [240],
    euml: [235],
    euro: [8364],
    excl: [33],
    exist: [8707],
    expectation: [8496],
    exponentiale: [8519],
    fallingdotseq: [8786],
    fcy: [1092],
    female: [9792],
    ffilig: [64259],
    fflig: [64256],
    ffllig: [64260],
    ffr: [120099],
    filig: [64257],
    fjlig: [102, 106],
    flat: [9837],
    fllig: [64258],
    fltns: [9649],
    fnof: [402],
    fopf: [120151],
    forall: [8704],
    fork: [8916],
    forkv: [10969],
    fpartint: [10765],
    frac12: [189],
    frac13: [8531],
    frac14: [188],
    frac15: [8533],
    frac16: [8537],
    frac18: [8539],
    frac23: [8532],
    frac25: [8534],
    frac34: [190],
    frac35: [8535],
    frac38: [8540],
    frac45: [8536],
    frac56: [8538],
    frac58: [8541],
    frac78: [8542],
    frasl: [8260],
    frown: [8994],
    fscr: [119995],
    gE: [8807],
    gEl: [10892],
    gacute: [501],
    gamma: [947],
    gammad: [989],
    gap: [10886],
    gbreve: [287],
    gcirc: [285],
    gcy: [1075],
    gdot: [289],
    ge: [8805],
    gel: [8923],
    geq: [8805],
    geqq: [8807],
    geqslant: [10878],
    ges: [10878],
    gescc: [10921],
    gesdot: [10880],
    gesdoto: [10882],
    gesdotol: [10884],
    gesl: [8923, 65024],
    gesles: [10900],
    gfr: [120100],
    gg: [8811],
    ggg: [8921],
    gimel: [8503],
    gjcy: [1107],
    gl: [8823],
    glE: [10898],
    gla: [10917],
    glj: [10916],
    gnE: [8809],
    gnap: [10890],
    gnapprox: [10890],
    gne: [10888],
    gneq: [10888],
    gneqq: [8809],
    gnsim: [8935],
    gopf: [120152],
    grave: [96],
    gscr: [8458],
    gsim: [8819],
    gsime: [10894],
    gsiml: [10896],
    gt: [62],
    gtcc: [10919],
    gtcir: [10874],
    gtdot: [8919],
    gtlPar: [10645],
    gtquest: [10876],
    gtrapprox: [10886],
    gtrarr: [10616],
    gtrdot: [8919],
    gtreqless: [8923],
    gtreqqless: [10892],
    gtrless: [8823],
    gtrsim: [8819],
    gvertneqq: [8809, 65024],
    gvnE: [8809, 65024],
    hArr: [8660],
    hairsp: [8202],
    half: [189],
    hamilt: [8459],
    hardcy: [1098],
    harr: [8596],
    harrcir: [10568],
    harrw: [8621],
    hbar: [8463],
    hcirc: [293],
    hearts: [9829],
    heartsuit: [9829],
    hellip: [8230],
    hercon: [8889],
    hfr: [120101],
    hksearow: [10533],
    hkswarow: [10534],
    hoarr: [8703],
    homtht: [8763],
    hookleftarrow: [8617],
    hookrightarrow: [8618],
    hopf: [120153],
    horbar: [8213],
    hscr: [119997],
    hslash: [8463],
    hstrok: [295],
    hybull: [8259],
    hyphen: [8208],
    iacute: [237],
    ic: [8291],
    icirc: [238],
    icy: [1080],
    iecy: [1077],
    iexcl: [161],
    iff: [8660],
    ifr: [120102],
    igrave: [236],
    ii: [8520],
    iiiint: [10764],
    iiint: [8749],
    iinfin: [10716],
    iiota: [8489],
    ijlig: [307],
    imacr: [299],
    image: [8465],
    imagline: [8464],
    imagpart: [8465],
    imath: [305],
    imof: [8887],
    imped: [437],
    "in": [8712],
    incare: [8453],
    infin: [8734],
    infintie: [10717],
    inodot: [305],
    "int": [8747],
    intcal: [8890],
    integers: [8484],
    intercal: [8890],
    intlarhk: [10775],
    intprod: [10812],
    iocy: [1105],
    iogon: [303],
    iopf: [120154],
    iota: [953],
    iprod: [10812],
    iquest: [191],
    iscr: [119998],
    isin: [8712],
    isinE: [8953],
    isindot: [8949],
    isins: [8948],
    isinsv: [8947],
    isinv: [8712],
    it: [8290],
    itilde: [297],
    iukcy: [1110],
    iuml: [239],
    jcirc: [309],
    jcy: [1081],
    jfr: [120103],
    jmath: [567],
    jopf: [120155],
    jscr: [119999],
    jsercy: [1112],
    jukcy: [1108],
    kappa: [954],
    kappav: [1008],
    kcedil: [311],
    kcy: [1082],
    kfr: [120104],
    kgreen: [312],
    khcy: [1093],
    kjcy: [1116],
    kopf: [120156],
    kscr: [120000],
    lAarr: [8666],
    lArr: [8656],
    lAtail: [10523],
    lBarr: [10510],
    lE: [8806],
    lEg: [10891],
    lHar: [10594],
    lacute: [314],
    laemptyv: [10676],
    lagran: [8466],
    lambda: [955],
    lang: [10216],
    langd: [10641],
    langle: [10216],
    lap: [10885],
    laquo: [171],
    larr: [8592],
    larrb: [8676],
    larrbfs: [10527],
    larrfs: [10525],
    larrhk: [8617],
    larrlp: [8619],
    larrpl: [10553],
    larrsim: [10611],
    larrtl: [8610],
    lat: [10923],
    latail: [10521],
    late: [10925],
    lates: [10925, 65024],
    lbarr: [10508],
    lbbrk: [10098],
    lbrace: [123],
    lbrack: [91],
    lbrke: [10635],
    lbrksld: [10639],
    lbrkslu: [10637],
    lcaron: [318],
    lcedil: [316],
    lceil: [8968],
    lcub: [123],
    lcy: [1083],
    ldca: [10550],
    ldquo: [8220],
    ldquor: [8222],
    ldrdhar: [10599],
    ldrushar: [10571],
    ldsh: [8626],
    le: [8804],
    leftarrow: [8592],
    leftarrowtail: [8610],
    leftharpoondown: [8637],
    leftharpoonup: [8636],
    leftleftarrows: [8647],
    leftrightarrow: [8596],
    leftrightarrows: [8646],
    leftrightharpoons: [8651],
    leftrightsquigarrow: [8621],
    leftthreetimes: [8907],
    leg: [8922],
    leq: [8804],
    leqq: [8806],
    leqslant: [10877],
    les: [10877],
    lescc: [10920],
    lesdot: [10879],
    lesdoto: [10881],
    lesdotor: [10883],
    lesg: [8922, 65024],
    lesges: [10899],
    lessapprox: [10885],
    lessdot: [8918],
    lesseqgtr: [8922],
    lesseqqgtr: [10891],
    lessgtr: [8822],
    lesssim: [8818],
    lfisht: [10620],
    lfloor: [8970],
    lfr: [120105],
    lg: [8822],
    lgE: [10897],
    lhard: [8637],
    lharu: [8636],
    lharul: [10602],
    lhblk: [9604],
    ljcy: [1113],
    ll: [8810],
    llarr: [8647],
    llcorner: [8990],
    llhard: [10603],
    lltri: [9722],
    lmidot: [320],
    lmoust: [9136],
    lmoustache: [9136],
    lnE: [8808],
    lnap: [10889],
    lnapprox: [10889],
    lne: [10887],
    lneq: [10887],
    lneqq: [8808],
    lnsim: [8934],
    loang: [10220],
    loarr: [8701],
    lobrk: [10214],
    longleftarrow: [10229],
    longleftrightarrow: [10231],
    longmapsto: [10236],
    longrightarrow: [10230],
    looparrowleft: [8619],
    looparrowright: [8620],
    lopar: [10629],
    lopf: [120157],
    loplus: [10797],
    lotimes: [10804],
    lowast: [8727],
    lowbar: [95],
    loz: [9674],
    lozenge: [9674],
    lozf: [10731],
    lpar: [40],
    lparlt: [10643],
    lrarr: [8646],
    lrcorner: [8991],
    lrhar: [8651],
    lrhard: [10605],
    lrm: [8206],
    lrtri: [8895],
    lsaquo: [8249],
    lscr: [120001],
    lsh: [8624],
    lsim: [8818],
    lsime: [10893],
    lsimg: [10895],
    lsqb: [91],
    lsquo: [8216],
    lsquor: [8218],
    lstrok: [322],
    lt: [60],
    ltcc: [10918],
    ltcir: [10873],
    ltdot: [8918],
    lthree: [8907],
    ltimes: [8905],
    ltlarr: [10614],
    ltquest: [10875],
    ltrPar: [10646],
    ltri: [9667],
    ltrie: [8884],
    ltrif: [9666],
    lurdshar: [10570],
    luruhar: [10598],
    lvertneqq: [8808, 65024],
    lvnE: [8808, 65024],
    mDDot: [8762],
    macr: [175],
    male: [9794],
    malt: [10016],
    maltese: [10016],
    map: [8614],
    mapsto: [8614],
    mapstodown: [8615],
    mapstoleft: [8612],
    mapstoup: [8613],
    marker: [9646],
    mcomma: [10793],
    mcy: [1084],
    mdash: [8212],
    measuredangle: [8737],
    mfr: [120106],
    mho: [8487],
    micro: [181],
    mid: [8739],
    midast: [42],
    midcir: [10992],
    middot: [183],
    minus: [8722],
    minusb: [8863],
    minusd: [8760],
    minusdu: [10794],
    mlcp: [10971],
    mldr: [8230],
    mnplus: [8723],
    models: [8871],
    mopf: [120158],
    mp: [8723],
    mscr: [120002],
    mstpos: [8766],
    mu: [956],
    multimap: [8888],
    mumap: [8888],
    nGg: [8921, 824],
    nGt: [8811, 8402],
    nGtv: [8811, 824],
    nLeftarrow: [8653],
    nLeftrightarrow: [8654],
    nLl: [8920, 824],
    nLt: [8810, 8402],
    nLtv: [8810, 824],
    nRightarrow: [8655],
    nVDash: [8879],
    nVdash: [8878],
    nabla: [8711],
    nacute: [324],
    nang: [8736, 8402],
    nap: [8777],
    napE: [10864, 824],
    napid: [8779, 824],
    napos: [329],
    napprox: [8777],
    natur: [9838],
    natural: [9838],
    naturals: [8469],
    nbsp: [160],
    nbump: [8782, 824],
    nbumpe: [8783, 824],
    ncap: [10819],
    ncaron: [328],
    ncedil: [326],
    ncong: [8775],
    ncongdot: [10861, 824],
    ncup: [10818],
    ncy: [1085],
    ndash: [8211],
    ne: [8800],
    neArr: [8663],
    nearhk: [10532],
    nearr: [8599],
    nearrow: [8599],
    nedot: [8784, 824],
    nequiv: [8802],
    nesear: [10536],
    nesim: [8770, 824],
    nexist: [8708],
    nexists: [8708],
    nfr: [120107],
    ngE: [8807, 824],
    nge: [8817],
    ngeq: [8817],
    ngeqq: [8807, 824],
    ngeqslant: [10878, 824],
    nges: [10878, 824],
    ngsim: [8821],
    ngt: [8815],
    ngtr: [8815],
    nhArr: [8654],
    nharr: [8622],
    nhpar: [10994],
    ni: [8715],
    nis: [8956],
    nisd: [8954],
    niv: [8715],
    njcy: [1114],
    nlArr: [8653],
    nlE: [8806, 824],
    nlarr: [8602],
    nldr: [8229],
    nle: [8816],
    nleftarrow: [8602],
    nleftrightarrow: [8622],
    nleq: [8816],
    nleqq: [8806, 824],
    nleqslant: [10877, 824],
    nles: [10877, 824],
    nless: [8814],
    nlsim: [8820],
    nlt: [8814],
    nltri: [8938],
    nltrie: [8940],
    nmid: [8740],
    nopf: [120159],
    not: [172],
    notin: [8713],
    notinE: [8953, 824],
    notindot: [8949, 824],
    notinva: [8713],
    notinvb: [8951],
    notinvc: [8950],
    notni: [8716],
    notniva: [8716],
    notnivb: [8958],
    notnivc: [8957],
    npar: [8742],
    nparallel: [8742],
    nparsl: [11005, 8421],
    npart: [8706, 824],
    npolint: [10772],
    npr: [8832],
    nprcue: [8928],
    npre: [10927, 824],
    nprec: [8832],
    npreceq: [10927, 824],
    nrArr: [8655],
    nrarr: [8603],
    nrarrc: [10547, 824],
    nrarrw: [8605, 824],
    nrightarrow: [8603],
    nrtri: [8939],
    nrtrie: [8941],
    nsc: [8833],
    nsccue: [8929],
    nsce: [10928, 824],
    nscr: [120003],
    nshortmid: [8740],
    nshortparallel: [8742],
    nsim: [8769],
    nsime: [8772],
    nsimeq: [8772],
    nsmid: [8740],
    nspar: [8742],
    nsqsube: [8930],
    nsqsupe: [8931],
    nsub: [8836],
    nsubE: [10949, 824],
    nsube: [8840],
    nsubset: [8834, 8402],
    nsubseteq: [8840],
    nsubseteqq: [10949, 824],
    nsucc: [8833],
    nsucceq: [10928, 824],
    nsup: [8837],
    nsupE: [10950, 824],
    nsupe: [8841],
    nsupset: [8835, 8402],
    nsupseteq: [8841],
    nsupseteqq: [10950, 824],
    ntgl: [8825],
    ntilde: [241],
    ntlg: [8824],
    ntriangleleft: [8938],
    ntrianglelefteq: [8940],
    ntriangleright: [8939],
    ntrianglerighteq: [8941],
    nu: [957],
    num: [35],
    numero: [8470],
    numsp: [8199],
    nvDash: [8877],
    nvHarr: [10500],
    nvap: [8781, 8402],
    nvdash: [8876],
    nvge: [8805, 8402],
    nvgt: [62, 8402],
    nvinfin: [10718],
    nvlArr: [10498],
    nvle: [8804, 8402],
    nvlt: [60, 8402],
    nvltrie: [8884, 8402],
    nvrArr: [10499],
    nvrtrie: [8885, 8402],
    nvsim: [8764, 8402],
    nwArr: [8662],
    nwarhk: [10531],
    nwarr: [8598],
    nwarrow: [8598],
    nwnear: [10535],
    oS: [9416],
    oacute: [243],
    oast: [8859],
    ocir: [8858],
    ocirc: [244],
    ocy: [1086],
    odash: [8861],
    odblac: [337],
    odiv: [10808],
    odot: [8857],
    odsold: [10684],
    oelig: [339],
    ofcir: [10687],
    ofr: [120108],
    ogon: [731],
    ograve: [242],
    ogt: [10689],
    ohbar: [10677],
    ohm: [937],
    oint: [8750],
    olarr: [8634],
    olcir: [10686],
    olcross: [10683],
    oline: [8254],
    olt: [10688],
    omacr: [333],
    omega: [969],
    omicron: [959],
    omid: [10678],
    ominus: [8854],
    oopf: [120160],
    opar: [10679],
    operp: [10681],
    oplus: [8853],
    or: [8744],
    orarr: [8635],
    ord: [10845],
    order: [8500],
    orderof: [8500],
    ordf: [170],
    ordm: [186],
    origof: [8886],
    oror: [10838],
    orslope: [10839],
    orv: [10843],
    oscr: [8500],
    oslash: [248],
    osol: [8856],
    otilde: [245],
    otimes: [8855],
    otimesas: [10806],
    ouml: [246],
    ovbar: [9021],
    par: [8741],
    para: [182],
    parallel: [8741],
    parsim: [10995],
    parsl: [11005],
    part: [8706],
    pcy: [1087],
    percnt: [37],
    period: [46],
    permil: [8240],
    perp: [8869],
    pertenk: [8241],
    pfr: [120109],
    phi: [966],
    phiv: [981],
    phmmat: [8499],
    phone: [9742],
    pi: [960],
    pitchfork: [8916],
    piv: [982],
    planck: [8463],
    planckh: [8462],
    plankv: [8463],
    plus: [43],
    plusacir: [10787],
    plusb: [8862],
    pluscir: [10786],
    plusdo: [8724],
    plusdu: [10789],
    pluse: [10866],
    plusmn: [177],
    plussim: [10790],
    plustwo: [10791],
    pm: [177],
    pointint: [10773],
    popf: [120161],
    pound: [163],
    pr: [8826],
    prE: [10931],
    prap: [10935],
    prcue: [8828],
    pre: [10927],
    prec: [8826],
    precapprox: [10935],
    preccurlyeq: [8828],
    preceq: [10927],
    precnapprox: [10937],
    precneqq: [10933],
    precnsim: [8936],
    precsim: [8830],
    prime: [8242],
    primes: [8473],
    prnE: [10933],
    prnap: [10937],
    prnsim: [8936],
    prod: [8719],
    profalar: [9006],
    profline: [8978],
    profsurf: [8979],
    prop: [8733],
    propto: [8733],
    prsim: [8830],
    prurel: [8880],
    pscr: [120005],
    psi: [968],
    puncsp: [8200],
    qfr: [120110],
    qint: [10764],
    qopf: [120162],
    qprime: [8279],
    qscr: [120006],
    quaternions: [8461],
    quatint: [10774],
    quest: [63],
    questeq: [8799],
    quot: [34],
    rAarr: [8667],
    rArr: [8658],
    rAtail: [10524],
    rBarr: [10511],
    rHar: [10596],
    race: [8765, 817],
    racute: [341],
    radic: [8730],
    raemptyv: [10675],
    rang: [10217],
    rangd: [10642],
    range: [10661],
    rangle: [10217],
    raquo: [187],
    rarr: [8594],
    rarrap: [10613],
    rarrb: [8677],
    rarrbfs: [10528],
    rarrc: [10547],
    rarrfs: [10526],
    rarrhk: [8618],
    rarrlp: [8620],
    rarrpl: [10565],
    rarrsim: [10612],
    rarrtl: [8611],
    rarrw: [8605],
    ratail: [10522],
    ratio: [8758],
    rationals: [8474],
    rbarr: [10509],
    rbbrk: [10099],
    rbrace: [125],
    rbrack: [93],
    rbrke: [10636],
    rbrksld: [10638],
    rbrkslu: [10640],
    rcaron: [345],
    rcedil: [343],
    rceil: [8969],
    rcub: [125],
    rcy: [1088],
    rdca: [10551],
    rdldhar: [10601],
    rdquo: [8221],
    rdquor: [8221],
    rdsh: [8627],
    real: [8476],
    realine: [8475],
    realpart: [8476],
    reals: [8477],
    rect: [9645],
    reg: [174],
    rfisht: [10621],
    rfloor: [8971],
    rfr: [120111],
    rhard: [8641],
    rharu: [8640],
    rharul: [10604],
    rho: [961],
    rhov: [1009],
    rightarrow: [8594],
    rightarrowtail: [8611],
    rightharpoondown: [8641],
    rightharpoonup: [8640],
    rightleftarrows: [8644],
    rightleftharpoons: [8652],
    rightrightarrows: [8649],
    rightsquigarrow: [8605],
    rightthreetimes: [8908],
    ring: [730],
    risingdotseq: [8787],
    rlarr: [8644],
    rlhar: [8652],
    rlm: [8207],
    rmoust: [9137],
    rmoustache: [9137],
    rnmid: [10990],
    roang: [10221],
    roarr: [8702],
    robrk: [10215],
    ropar: [10630],
    ropf: [120163],
    roplus: [10798],
    rotimes: [10805],
    rpar: [41],
    rpargt: [10644],
    rppolint: [10770],
    rrarr: [8649],
    rsaquo: [8250],
    rscr: [120007],
    rsh: [8625],
    rsqb: [93],
    rsquo: [8217],
    rsquor: [8217],
    rthree: [8908],
    rtimes: [8906],
    rtri: [9657],
    rtrie: [8885],
    rtrif: [9656],
    rtriltri: [10702],
    ruluhar: [10600],
    rx: [8478],
    sacute: [347],
    sbquo: [8218],
    sc: [8827],
    scE: [10932],
    scap: [10936],
    scaron: [353],
    sccue: [8829],
    sce: [10928],
    scedil: [351],
    scirc: [349],
    scnE: [10934],
    scnap: [10938],
    scnsim: [8937],
    scpolint: [10771],
    scsim: [8831],
    scy: [1089],
    sdot: [8901],
    sdotb: [8865],
    sdote: [10854],
    seArr: [8664],
    searhk: [10533],
    searr: [8600],
    searrow: [8600],
    sect: [167],
    semi: [59],
    seswar: [10537],
    setminus: [8726],
    setmn: [8726],
    sext: [10038],
    sfr: [120112],
    sfrown: [8994],
    sharp: [9839],
    shchcy: [1097],
    shcy: [1096],
    shortmid: [8739],
    shortparallel: [8741],
    shy: [173],
    sigma: [963],
    sigmaf: [962],
    sigmav: [962],
    sim: [8764],
    simdot: [10858],
    sime: [8771],
    simeq: [8771],
    simg: [10910],
    simgE: [10912],
    siml: [10909],
    simlE: [10911],
    simne: [8774],
    simplus: [10788],
    simrarr: [10610],
    slarr: [8592],
    smallsetminus: [8726],
    smashp: [10803],
    smeparsl: [10724],
    smid: [8739],
    smile: [8995],
    smt: [10922],
    smte: [10924],
    smtes: [10924, 65024],
    softcy: [1100],
    sol: [47],
    solb: [10692],
    solbar: [9023],
    sopf: [120164],
    spades: [9824],
    spadesuit: [9824],
    spar: [8741],
    sqcap: [8851],
    sqcaps: [8851, 65024],
    sqcup: [8852],
    sqcups: [8852, 65024],
    sqsub: [8847],
    sqsube: [8849],
    sqsubset: [8847],
    sqsubseteq: [8849],
    sqsup: [8848],
    sqsupe: [8850],
    sqsupset: [8848],
    sqsupseteq: [8850],
    squ: [9633],
    square: [9633],
    squarf: [9642],
    squf: [9642],
    srarr: [8594],
    sscr: [120008],
    ssetmn: [8726],
    ssmile: [8995],
    sstarf: [8902],
    star: [9734],
    starf: [9733],
    straightepsilon: [1013],
    straightphi: [981],
    strns: [175],
    sub: [8834],
    subE: [10949],
    subdot: [10941],
    sube: [8838],
    subedot: [10947],
    submult: [10945],
    subnE: [10955],
    subne: [8842],
    subplus: [10943],
    subrarr: [10617],
    subset: [8834],
    subseteq: [8838],
    subseteqq: [10949],
    subsetneq: [8842],
    subsetneqq: [10955],
    subsim: [10951],
    subsub: [10965],
    subsup: [10963],
    succ: [8827],
    succapprox: [10936],
    succcurlyeq: [8829],
    succeq: [10928],
    succnapprox: [10938],
    succneqq: [10934],
    succnsim: [8937],
    succsim: [8831],
    sum: [8721],
    sung: [9834],
    sup: [8835],
    sup1: [185],
    sup2: [178],
    sup3: [179],
    supE: [10950],
    supdot: [10942],
    supdsub: [10968],
    supe: [8839],
    supedot: [10948],
    suphsol: [10185],
    suphsub: [10967],
    suplarr: [10619],
    supmult: [10946],
    supnE: [10956],
    supne: [8843],
    supplus: [10944],
    supset: [8835],
    supseteq: [8839],
    supseteqq: [10950],
    supsetneq: [8843],
    supsetneqq: [10956],
    supsim: [10952],
    supsub: [10964],
    supsup: [10966],
    swArr: [8665],
    swarhk: [10534],
    swarr: [8601],
    swarrow: [8601],
    swnwar: [10538],
    szlig: [223],
    target: [8982],
    tau: [964],
    tbrk: [9140],
    tcaron: [357],
    tcedil: [355],
    tcy: [1090],
    tdot: [8411],
    telrec: [8981],
    tfr: [120113],
    there4: [8756],
    therefore: [8756],
    theta: [952],
    thetasym: [977],
    thetav: [977],
    thickapprox: [8776],
    thicksim: [8764],
    thinsp: [8201],
    thkap: [8776],
    thksim: [8764],
    thorn: [254],
    tilde: [732],
    times: [215],
    timesb: [8864],
    timesbar: [10801],
    timesd: [10800],
    tint: [8749],
    toea: [10536],
    top: [8868],
    topbot: [9014],
    topcir: [10993],
    topf: [120165],
    topfork: [10970],
    tosa: [10537],
    tprime: [8244],
    trade: [8482],
    triangle: [9653],
    triangledown: [9663],
    triangleleft: [9667],
    trianglelefteq: [8884],
    triangleq: [8796],
    triangleright: [9657],
    trianglerighteq: [8885],
    tridot: [9708],
    trie: [8796],
    triminus: [10810],
    triplus: [10809],
    trisb: [10701],
    tritime: [10811],
    trpezium: [9186],
    tscr: [120009],
    tscy: [1094],
    tshcy: [1115],
    tstrok: [359],
    twixt: [8812],
    twoheadleftarrow: [8606],
    twoheadrightarrow: [8608],
    uArr: [8657],
    uHar: [10595],
    uacute: [250],
    uarr: [8593],
    ubrcy: [1118],
    ubreve: [365],
    ucirc: [251],
    ucy: [1091],
    udarr: [8645],
    udblac: [369],
    udhar: [10606],
    ufisht: [10622],
    ufr: [120114],
    ugrave: [249],
    uharl: [8639],
    uharr: [8638],
    uhblk: [9600],
    ulcorn: [8988],
    ulcorner: [8988],
    ulcrop: [8975],
    ultri: [9720],
    umacr: [363],
    uml: [168],
    uogon: [371],
    uopf: [120166],
    uparrow: [8593],
    updownarrow: [8597],
    upharpoonleft: [8639],
    upharpoonright: [8638],
    uplus: [8846],
    upsi: [965],
    upsih: [978],
    upsilon: [965],
    upuparrows: [8648],
    urcorn: [8989],
    urcorner: [8989],
    urcrop: [8974],
    uring: [367],
    urtri: [9721],
    uscr: [120010],
    utdot: [8944],
    utilde: [361],
    utri: [9653],
    utrif: [9652],
    uuarr: [8648],
    uuml: [252],
    uwangle: [10663],
    vArr: [8661],
    vBar: [10984],
    vBarv: [10985],
    vDash: [8872],
    vangrt: [10652],
    varepsilon: [1013],
    varkappa: [1008],
    varnothing: [8709],
    varphi: [981],
    varpi: [982],
    varpropto: [8733],
    varr: [8597],
    varrho: [1009],
    varsigma: [962],
    varsubsetneq: [8842, 65024],
    varsubsetneqq: [10955, 65024],
    varsupsetneq: [8843, 65024],
    varsupsetneqq: [10956, 65024],
    vartheta: [977],
    vartriangleleft: [8882],
    vartriangleright: [8883],
    vcy: [1074],
    vdash: [8866],
    vee: [8744],
    veebar: [8891],
    veeeq: [8794],
    vellip: [8942],
    verbar: [124],
    vert: [124],
    vfr: [120115],
    vltri: [8882],
    vnsub: [8834, 8402],
    vnsup: [8835, 8402],
    vopf: [120167],
    vprop: [8733],
    vrtri: [8883],
    vscr: [120011],
    vsubnE: [10955, 65024],
    vsubne: [8842, 65024],
    vsupnE: [10956, 65024],
    vsupne: [8843, 65024],
    vzigzag: [10650],
    wcirc: [373],
    wedbar: [10847],
    wedge: [8743],
    wedgeq: [8793],
    weierp: [8472],
    wfr: [120116],
    wopf: [120168],
    wp: [8472],
    wr: [8768],
    wreath: [8768],
    wscr: [120012],
    xcap: [8898],
    xcirc: [9711],
    xcup: [8899],
    xdtri: [9661],
    xfr: [120117],
    xhArr: [10234],
    xharr: [10231],
    xi: [958],
    xlArr: [10232],
    xlarr: [10229],
    xmap: [10236],
    xnis: [8955],
    xodot: [10752],
    xopf: [120169],
    xoplus: [10753],
    xotime: [10754],
    xrArr: [10233],
    xrarr: [10230],
    xscr: [120013],
    xsqcup: [10758],
    xuplus: [10756],
    xutri: [9651],
    xvee: [8897],
    xwedge: [8896],
    yacute: [253],
    yacy: [1103],
    ycirc: [375],
    ycy: [1099],
    yen: [165],
    yfr: [120118],
    yicy: [1111],
    yopf: [120170],
    yscr: [120014],
    yucy: [1102],
    yuml: [255],
    zacute: [378],
    zcaron: [382],
    zcy: [1079],
    zdot: [380],
    zeetrf: [8488],
    zeta: [950],
    zfr: [120119],
    zhcy: [1078],
    zigrarr: [8669],
    zopf: [120171],
    zscr: [120015],
    zwj: [8205],
    zwnj: [8204]
  };

});
define('simple-html-tokenizer/char-refs/min', ['exports'], function (exports) {

  'use strict';

  exports['default'] = {
    quot: [34],
    amp: [38],
    apos: [39],
    lt: [60],
    gt: [62]
  };

});
define('simple-html-tokenizer/entity-parser', ['exports'], function (exports) {

  'use strict';

  function EntityParser(namedCodepoints) {
    this.namedCodepoints = namedCodepoints;
  }

  EntityParser.prototype.parse = function (tokenizer) {
    var input = tokenizer.input.slice(tokenizer.index);
    var matches = input.match(/^#(?:x|X)([0-9A-Fa-f]+);/);
    if (matches) {
      tokenizer.index += matches[0].length;
      return String.fromCharCode(parseInt(matches[1], 16));
    }
    matches = input.match(/^#([0-9]+);/);
    if (matches) {
      tokenizer.index += matches[0].length;
      return String.fromCharCode(parseInt(matches[1], 10));
    }
    matches = input.match(/^([A-Za-z]+);/);
    if (matches) {
      var codepoints = this.namedCodepoints[matches[1]];
      if (codepoints) {
        tokenizer.index += matches[0].length;
        for (var i = 0, buffer = ''; i < codepoints.length; i++) {
          buffer += String.fromCharCode(codepoints[i]);
        }
        return buffer;
      }
    }
  };

  exports['default'] = EntityParser;

});
define('simple-html-tokenizer/evented-tokenizer', ['exports', './utils'], function (exports, utils) {

  'use strict';

  function EventedTokenizer(delegate, entityParser) {
    this.delegate = delegate;
    this.entityParser = entityParser;

    this.state = null;
    this.input = null;

    this.index = -1;
    this.line = -1;
    this.column = -1;
    this.tagLine = -1;
    this.tagColumn = -1;

    this.reset();
  }

  EventedTokenizer.prototype = {
    reset: function () {
      this.state = 'beforeData';
      this.input = '';

      this.index = 0;
      this.line = 1;
      this.column = 0;

      this.tagLine = -1;
      this.tagColumn = -1;

      this.delegate.reset();
    },

    tokenize: function (input) {
      this.reset();
      this.tokenizePart(input);
      this.tokenizeEOF();
    },

    tokenizePart: function (input) {
      this.input += utils.preprocessInput(input);

      while (this.index < this.input.length) {
        this.states[this.state].call(this);
      }
    },

    tokenizeEOF: function () {
      this.flushData();
    },

    flushData: function () {
      if (this.state === 'data') {
        this.delegate.finishData();
        this.state = 'beforeData';
      }
    },

    peek: function () {
      return this.input.charAt(this.index);
    },

    consume: function () {
      var char = this.peek();

      this.index++;

      if (char === "\n") {
        this.line++;
        this.column = 0;
      } else {
        this.column++;
      }

      return char;
    },

    consumeCharRef: function () {
      return this.entityParser.parse(this);
    },

    markTagStart: function () {
      this.tagLine = this.line;
      this.tagColumn = this.column;
    },

    states: {
      beforeData: function () {
        var char = this.peek();

        if (char === "<") {
          this.state = 'tagOpen';
          this.markTagStart();
          this.consume();
        } else {
          this.state = 'data';
          this.delegate.beginData();
        }
      },

      data: function () {
        var char = this.peek();

        if (char === "<") {
          this.delegate.finishData();
          this.state = 'tagOpen';
          this.markTagStart();
          this.consume();
        } else if (char === "&") {
          this.consume();
          this.delegate.appendToData(this.consumeCharRef() || "&");
        } else {
          this.consume();
          this.delegate.appendToData(char);
        }
      },

      tagOpen: function () {
        var char = this.consume();

        if (char === "!") {
          this.state = 'markupDeclaration';
        } else if (char === "/") {
          this.state = 'endTagOpen';
        } else if (utils.isAlpha(char)) {
          this.state = 'tagName';
          this.delegate.beginStartTag();
          this.delegate.appendToTagName(char.toLowerCase());
        }
      },

      markupDeclaration: function () {
        var char = this.consume();

        if (char === "-" && this.input.charAt(this.index) === "-") {
          this.index++;
          this.state = 'commentStart';
          this.delegate.beginComment();
        }
      },

      commentStart: function () {
        var char = this.consume();

        if (char === "-") {
          this.state = 'commentStartDash';
        } else if (char === ">") {
          this.delegate.finishComment();
          this.state = 'beforeData';
        } else {
          this.delegate.appendToCommentData(char);
          this.state = 'comment';
        }
      },

      commentStartDash: function () {
        var char = this.consume();

        if (char === "-") {
          this.state = 'commentEnd';
        } else if (char === ">") {
          this.delegate.finishComment();
          this.state = 'beforeData';
        } else {
          this.delegate.appendToCommentData("-");
          this.state = 'comment';
        }
      },

      comment: function () {
        var char = this.consume();

        if (char === "-") {
          this.state = 'commentEndDash';
        } else {
          this.delegate.appendToCommentData(char);
        }
      },

      commentEndDash: function () {
        var char = this.consume();

        if (char === "-") {
          this.state = 'commentEnd';
        } else {
          this.delegate.appendToCommentData("-" + char);
          this.state = 'comment';
        }
      },

      commentEnd: function () {
        var char = this.consume();

        if (char === ">") {
          this.delegate.finishComment();
          this.state = 'beforeData';
        } else {
          this.delegate.appendToCommentData("--" + char);
          this.state = 'comment';
        }
      },

      tagName: function () {
        var char = this.consume();

        if (utils.isSpace(char)) {
          this.state = 'beforeAttributeName';
        } else if (char === "/") {
          this.state = 'selfClosingStartTag';
        } else if (char === ">") {
          this.delegate.finishTag();
          this.state = 'beforeData';
        } else {
          this.delegate.appendToTagName(char);
        }
      },

      beforeAttributeName: function () {
        var char = this.consume();

        if (utils.isSpace(char)) {
          return;
        } else if (char === "/") {
          this.state = 'selfClosingStartTag';
        } else if (char === ">") {
          this.delegate.finishTag();
          this.state = 'beforeData';
        } else {
          this.state = 'attributeName';
          this.delegate.beginAttribute();
          this.delegate.appendToAttributeName(char);
        }
      },

      attributeName: function () {
        var char = this.consume();

        if (utils.isSpace(char)) {
          this.state = 'afterAttributeName';
        } else if (char === "/") {
          this.state = 'selfClosingStartTag';
        } else if (char === "=") {
          this.state = 'beforeAttributeValue';
        } else if (char === ">") {
          this.delegate.beginAttributeValue(false);
          this.delegate.finishAttributeValue();
          this.delegate.finishTag();
          this.state = 'beforeData';
        } else {
          this.delegate.appendToAttributeName(char);
        }
      },

      afterAttributeName: function () {
        var char = this.consume();

        if (utils.isSpace(char)) {
          return;
        } else if (char === "/") {
          this.state = 'selfClosingStartTag';
        } else if (char === "=") {
          this.state = 'beforeAttributeValue';
        } else if (char === ">") {
          this.delegate.beginAttributeValue(false);
          this.delegate.finishAttributeValue();
          this.delegate.finishTag();
          this.state = 'beforeData';
        } else {
          this.delegate.beginAttributeValue(false);
          this.delegate.finishAttributeValue();
          this.state = 'attributeName';
          this.delegate.beginAttribute();
          this.delegate.appendToAttributeName(char);
        }
      },

      beforeAttributeValue: function () {
        var char = this.consume();

        if (utils.isSpace(char)) {} else if (char === '"') {
          this.state = 'attributeValueDoubleQuoted';
          this.delegate.beginAttributeValue(true);
        } else if (char === "'") {
          this.state = 'attributeValueSingleQuoted';
          this.delegate.beginAttributeValue(true);
        } else if (char === ">") {
          this.delegate.beginAttributeValue(false);
          this.delegate.finishAttributeValue();
          this.delegate.finishTag();
          this.state = 'beforeData';
        } else {
          this.state = 'attributeValueUnquoted';
          this.delegate.beginAttributeValue(false);
          this.delegate.appendToAttributeValue(char);
        }
      },

      attributeValueDoubleQuoted: function () {
        var char = this.consume();

        if (char === '"') {
          this.delegate.finishAttributeValue();
          this.state = 'afterAttributeValueQuoted';
        } else if (char === "&") {
          this.delegate.appendToAttributeValue(this.consumeCharRef('"') || "&");
        } else {
          this.delegate.appendToAttributeValue(char);
        }
      },

      attributeValueSingleQuoted: function () {
        var char = this.consume();

        if (char === "'") {
          this.delegate.finishAttributeValue();
          this.state = 'afterAttributeValueQuoted';
        } else if (char === "&") {
          this.delegate.appendToAttributeValue(this.consumeCharRef("'") || "&");
        } else {
          this.delegate.appendToAttributeValue(char);
        }
      },

      attributeValueUnquoted: function () {
        var char = this.consume();

        if (utils.isSpace(char)) {
          this.delegate.finishAttributeValue();
          this.state = 'beforeAttributeName';
        } else if (char === "&") {
          this.delegate.appendToAttributeValue(this.consumeCharRef(">") || "&");
        } else if (char === ">") {
          this.delegate.finishAttributeValue();
          this.delegate.finishTag();
          this.state = 'beforeData';
        } else {
          this.delegate.appendToAttributeValue(char);
        }
      },

      afterAttributeValueQuoted: function () {
        var char = this.peek();

        if (utils.isSpace(char)) {
          this.consume();
          this.state = 'beforeAttributeName';
        } else if (char === "/") {
          this.consume();
          this.state = 'selfClosingStartTag';
        } else if (char === ">") {
          this.consume();
          this.delegate.finishTag();
          this.state = 'beforeData';
        } else {
          this.state = 'beforeAttributeName';
        }
      },

      selfClosingStartTag: function () {
        var char = this.peek();

        if (char === ">") {
          this.consume();
          this.delegate.markTagAsSelfClosing();
          this.delegate.finishTag();
          this.state = 'beforeData';
        } else {
          this.state = 'beforeAttributeName';
        }
      },

      endTagOpen: function () {
        var char = this.consume();

        if (utils.isAlpha(char)) {
          this.state = 'tagName';
          this.delegate.beginEndTag();
          this.delegate.appendToTagName(char.toLowerCase());
        }
      }
    }
  };

  exports['default'] = EventedTokenizer;

});
define('simple-html-tokenizer/generate', ['exports', './generator'], function (exports, Generator) {

  'use strict';



  exports['default'] = generate;
  function generate(tokens) {
    var generator = new Generator['default']();
    return generator.generate(tokens);
  }

});
define('simple-html-tokenizer/generator', ['exports'], function (exports) {

  'use strict';

  var escape = (function () {
    var test = /[&<>"'`]/;
    var replace = /[&<>"'`]/g;
    var map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#x27;",
      "`": "&#x60;"
    };
    function escapeChar(char) {
      return map[char];
    }
    return function escape(string) {
      if (!test.test(string)) {
        return string;
      }
      return string.replace(replace, escapeChar);
    };
  })();

  function Generator() {
    this.escape = escape;
  }

  Generator.prototype = {
    generate: function (tokens) {
      var buffer = '';
      var token;
      for (var i = 0; i < tokens.length; i++) {
        token = tokens[i];
        buffer += this[token.type](token);
      }
      return buffer;
    },

    escape: function (text) {
      var unsafeCharsMap = this.unsafeCharsMap;
      return text.replace(this.unsafeChars, function (char) {
        return unsafeCharsMap[char] || char;
      });
    },

    StartTag: function (token) {
      var out = "<";
      out += token.tagName;

      if (token.attributes.length) {
        out += " " + this.Attributes(token.attributes);
      }

      out += ">";

      return out;
    },

    EndTag: function (token) {
      return "</" + token.tagName + ">";
    },

    Chars: function (token) {
      return this.escape(token.chars);
    },

    Comment: function (token) {
      return "<!--" + token.chars + "-->";
    },

    Attributes: function (attributes) {
      var out = [],
          attribute;

      for (var i = 0, l = attributes.length; i < l; i++) {
        attribute = attributes[i];

        out.push(this.Attribute(attribute[0], attribute[1]));
      }

      return out.join(" ");
    },

    Attribute: function (name, value) {
      var attrString = name;

      if (value) {
        value = this.escape(value);
        attrString += "=\"" + value + "\"";
      }

      return attrString;
    }
  };

  exports['default'] = Generator;

});
define('simple-html-tokenizer/tokenize', ['exports', './tokenizer', './entity-parser', './char-refs/full'], function (exports, Tokenizer, EntityParser, namedCodepoints) {

  'use strict';



  exports['default'] = tokenize;
  function tokenize(input) {
    var tokenizer = new Tokenizer['default'](new EntityParser['default'](namedCodepoints['default']));
    return tokenizer.tokenize(input);
  }

});
define('simple-html-tokenizer/tokenizer', ['exports', './evented-tokenizer', './tokens'], function (exports, EventedTokenizer, tokens) {

  'use strict';

  function Tokenizer(entityParser) {
    this.tokenizer = new EventedTokenizer['default'](this, entityParser);

    this.token = null;
    this.startLine = -1;
    this.startColumn = -1;

    this.reset();
  }

  Tokenizer.prototype = {
    tokenize: function (input) {
      this.tokens = [];
      this.tokenizer.tokenize(input);
      return this.tokens;
    },

    tokenizePart: function (input) {
      this.tokens = [];
      this.tokenizer.tokenizePart(input);
      return this.tokens;
    },

    tokenizeEOF: function () {
      this.tokens = [];
      this.tokenizer.tokenizeEOF();
      return this.tokens[0];
    },

    reset: function () {
      this.token = null;
      this.startLine = 1;
      this.startColumn = 0;
    },

    addLocInfo: function () {
      this.token.loc = {
        start: {
          line: this.startLine,
          column: this.startColumn
        },
        end: {
          line: this.tokenizer.line,
          column: this.tokenizer.column
        }
      };

      this.startLine = this.tokenizer.line;
      this.startColumn = this.tokenizer.column;
    },

    // Data

    beginData: function () {
      this.token = new tokens.Chars();
      this.tokens.push(this.token);
    },

    appendToData: function (char) {
      this.token.chars += char;
    },

    finishData: function () {
      this.addLocInfo();
    },

    // Comment

    beginComment: function () {
      this.token = new tokens.Comment();
      this.tokens.push(this.token);
    },

    appendToCommentData: function (char) {
      this.token.chars += char;
    },

    finishComment: function () {
      this.addLocInfo();
    },

    // Tags - basic

    beginStartTag: function () {
      this.token = new tokens.StartTag();
      this.tokens.push(this.token);
    },

    beginEndTag: function () {
      this.token = new tokens.EndTag();
      this.tokens.push(this.token);
    },

    finishTag: function () {
      this.addLocInfo();
    },

    markTagAsSelfClosing: function () {
      this.token.selfClosing = true;
    },

    // Tags - name

    appendToTagName: function (char) {
      this.token.tagName += char;
    },

    // Tags - attributes

    beginAttribute: function () {
      this._currentAttribute = ["", "", null];
      this.token.attributes.push(this._currentAttribute);
    },

    appendToAttributeName: function (char) {
      this._currentAttribute[0] += char;
    },

    beginAttributeValue: function (isQuoted) {
      this._currentAttribute[2] = isQuoted;
    },

    appendToAttributeValue: function (char) {
      this._currentAttribute[1] = this._currentAttribute[1] || "";
      this._currentAttribute[1] += char;
    },

    finishAttributeValue: function () {}
  };

  exports['default'] = Tokenizer;

});
define('simple-html-tokenizer/tokens', ['exports'], function (exports) {

  'use strict';

  exports.StartTag = StartTag;
  exports.EndTag = EndTag;
  exports.Chars = Chars;
  exports.Comment = Comment;

  function StartTag(tagName, attributes, selfClosing) {
    this.type = 'StartTag';
    this.tagName = tagName || '';
    this.attributes = attributes || [];
    this.selfClosing = selfClosing === true;
  }

  function EndTag(tagName) {
    this.type = 'EndTag';
    this.tagName = tagName || '';
  }

  function Chars(chars) {
    this.type = 'Chars';
    this.chars = chars || "";
  }

  function Comment(chars) {
    this.type = 'Comment';
    this.chars = chars || '';
  }

});
define('simple-html-tokenizer/utils', ['exports'], function (exports) {

  'use strict';

  exports.isSpace = isSpace;
  exports.isAlpha = isAlpha;
  exports.preprocessInput = preprocessInput;

  function isSpace(char) {
    return (/[\t\n\f ]/.test(char)
    );
  }

  function isAlpha(char) {
    return (/[A-Za-z]/.test(char)
    );
  }

  function preprocessInput(input) {
    return input.replace(/\r\n?/g, "\n");
  }

});