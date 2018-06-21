'use strict';

var Morph = require('./morph-range');

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