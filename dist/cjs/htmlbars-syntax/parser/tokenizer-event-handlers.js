'use strict';

var voidMap = require('../../htmlbars-util/void-tag-names');
var b = require('../builders');
var utils = require('../utils');

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