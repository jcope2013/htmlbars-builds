'use strict';

var htmlbars_util = require('../htmlbars-util');

QUnit.module('htmlbars-util');

test("SafeString is exported", function () {
  ok(typeof htmlbars_util.SafeString === 'function', 'SafeString is exported');
});