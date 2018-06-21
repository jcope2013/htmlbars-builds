'use strict';

var Generator = require('./generator');



exports['default'] = generate;
function generate(tokens) {
  var generator = new Generator['default']();
  return generator.generate(tokens);
}