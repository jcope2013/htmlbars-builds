'use strict';

var hooks = require('./htmlbars-runtime/hooks');
var render = require('./htmlbars-runtime/render');
var morph_utils = require('../htmlbars-util/morph-utils');
var template_utils = require('../htmlbars-util/template-utils');
var expression_visitor = require('./htmlbars-runtime/expression-visitor');
var htmlbars_runtime__hooks = require('htmlbars-runtime/hooks');

var internal = {
  blockFor: template_utils.blockFor,
  manualElement: render.manualElement,
  hostBlock: htmlbars_runtime__hooks.hostBlock,
  continueBlock: htmlbars_runtime__hooks.continueBlock,
  hostYieldWithShadowTemplate: htmlbars_runtime__hooks.hostYieldWithShadowTemplate,
  visitChildren: morph_utils.visitChildren,
  validateChildMorphs: expression_visitor.validateChildMorphs,
  clearMorph: template_utils.clearMorph
};

exports.hooks = hooks['default'];
exports.render = render['default'];
exports.internal = internal;