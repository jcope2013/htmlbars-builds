'use strict';

var EventedTokenizer = require('./simple-html-tokenizer/evented-tokenizer');
var Tokenizer = require('./simple-html-tokenizer/tokenizer');
var tokenize = require('./simple-html-tokenizer/tokenize');
var Generator = require('./simple-html-tokenizer/generator');
var generate = require('./simple-html-tokenizer/generate');
var tokens = require('./simple-html-tokenizer/tokens');

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