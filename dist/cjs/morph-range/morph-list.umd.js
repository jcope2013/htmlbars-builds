'use strict';

var MorphList = require('./morph-list');

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