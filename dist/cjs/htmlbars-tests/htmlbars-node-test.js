'use strict';

var htmlbars = require('../htmlbars');

QUnit.module('htmlbars');

test("compile is exported", function () {
  ok(typeof htmlbars.compile === 'function', 'compile is exported');
});