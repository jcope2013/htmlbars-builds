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