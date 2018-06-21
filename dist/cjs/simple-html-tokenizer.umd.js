'use strict';

var simple_html_tokenizer = require('./simple-html-tokenizer');

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