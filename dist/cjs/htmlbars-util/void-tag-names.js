'use strict';

var array_utils = require('./array-utils');

var voidTagNames = "area base br col command embed hr img input keygen link meta param source track wbr";
var voidMap = {};

array_utils.forEach(voidTagNames.split(" "), function (tagName) {
  voidMap[tagName] = true;
});

exports['default'] = voidMap;