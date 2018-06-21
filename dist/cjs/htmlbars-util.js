'use strict';

var SafeString = require('./htmlbars-util/safe-string');
var utils = require('./htmlbars-util/handlebars/utils');
var namespaces = require('./htmlbars-util/namespaces');
var morph_utils = require('./htmlbars-util/morph-utils');

exports.SafeString = SafeString['default'];
exports.escapeExpression = utils.escapeExpression;
exports.getAttrNamespace = namespaces.getAttrNamespace;
exports.validateChildMorphs = morph_utils.validateChildMorphs;
exports.linkParams = morph_utils.linkParams;
exports.dump = morph_utils.dump;