'use strict';

require('./htmlbars-syntax');
var compiler = require('./htmlbars-compiler/compiler');
var Walker = require('./htmlbars-syntax/walker');

/*
 * @overview  HTMLBars
 * @copyright Copyright 2011-2014 Tilde Inc. and contributors
 * @license   Licensed under MIT license
 *            See https://raw.githubusercontent.com/tildeio/htmlbars/master/LICENSE
 * @version   0.13.37.26987516
 */

// Break cycles in the module loader.

exports.compile = compiler.compile;
exports.compileSpec = compiler.compileSpec;
exports.Walker = Walker['default'];