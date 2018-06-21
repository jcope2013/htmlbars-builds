'use strict';

var compiler = require('./htmlbars-compiler/compiler');

exports.compile = compiler.compile;
exports.compileSpec = compiler.compileSpec;
exports.template = compiler.template;