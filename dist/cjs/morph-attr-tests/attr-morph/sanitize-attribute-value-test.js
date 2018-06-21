'use strict';

var sanitize_attribute_value = require('morph-attr/sanitize-attribute-value');
var SafeString = require('htmlbars-util/safe-string');
var array_utils = require('htmlbars-util/array-utils');
var DOMHelper = require('../../dom-helper');

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