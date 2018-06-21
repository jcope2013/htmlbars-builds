'use strict';

var Tokenizer = require('./tokenizer');
var EntityParser = require('./entity-parser');
var namedCodepoints = require('./char-refs/full');



exports['default'] = tokenize;
function tokenize(input) {
  var tokenizer = new Tokenizer['default'](new EntityParser['default'](namedCodepoints['default']));
  return tokenizer.tokenize(input);
}