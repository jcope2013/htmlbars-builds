'use strict';

exports.manualElement = manualElement;
exports.attachAttributes = attachAttributes;
exports.createChildMorph = createChildMorph;
exports.getCachedFragment = getCachedFragment;

var array_utils = require('../htmlbars-util/array-utils');
var morph_utils = require('../htmlbars-util/morph-utils');
var ExpressionVisitor = require('./expression-visitor');
var Morph = require('./morph');
var template_utils = require('../htmlbars-util/template-utils');
var voidMap = require('../htmlbars-util/void-tag-names');



exports['default'] = render;

var svgNamespace = "http://www.w3.org/2000/svg";
function render(template, env, scope, options) {
  var dom = env.dom;
  var contextualElement;

  if (options) {
    if (options.renderNode) {
      contextualElement = options.renderNode.contextualElement;
    } else if (options.contextualElement) {
      contextualElement = options.contextualElement;
    }
  }

  dom.detectNamespace(contextualElement);

  var renderResult = RenderResult.build(env, scope, template, options, contextualElement);
  renderResult.render();

  return renderResult;
}

function RenderResult(env, scope, options, rootNode, ownerNode, nodes, fragment, template, shouldSetContent) {
  this.root = rootNode;
  this.fragment = fragment;

  this.nodes = nodes;
  this.template = template;
  this.statements = template.statements.slice();
  this.env = env;
  this.scope = scope;
  this.shouldSetContent = shouldSetContent;

  this.bindScope();

  if (options.attributes !== undefined) {
    nodes.push({ state: {} });
    this.statements.push(['attributes', attachAttributes(options.attributes)]);
  }

  if (options.self !== undefined) {
    this.bindSelf(options.self);
  }
  if (options.blockArguments !== undefined) {
    this.bindLocals(options.blockArguments);
  }

  this.initializeNodes(ownerNode);
}

RenderResult.build = function (env, scope, template, options, contextualElement) {
  var dom = env.dom;
  var fragment = getCachedFragment(template, env);
  var nodes = template.buildRenderNodes(dom, fragment, contextualElement);

  var rootNode, ownerNode, shouldSetContent;

  if (options && options.renderNode) {
    rootNode = options.renderNode;
    ownerNode = rootNode.ownerNode;
    shouldSetContent = true;
  } else {
    rootNode = dom.createMorph(null, fragment.firstChild, fragment.lastChild, contextualElement);
    ownerNode = rootNode;
    initializeNode(rootNode, ownerNode);
    shouldSetContent = false;
  }

  if (rootNode.childNodes) {
    morph_utils.visitChildren(rootNode.childNodes, function (node) {
      template_utils.clearMorph(node, env, true);
    });
  }

  rootNode.childNodes = nodes;
  return new RenderResult(env, scope, options, rootNode, ownerNode, nodes, fragment, template, shouldSetContent);
};

function manualElement(tagName, attributes) {
  var statements = [];

  for (var key in attributes) {
    if (typeof attributes[key] === 'string') {
      continue;
    }
    statements.push(["attribute", key, attributes[key]]);
  }

  statements.push(['content', 'yield']);

  var template = {
    arity: 0,
    cachedFragment: null,
    hasRendered: false,
    buildFragment: function buildFragment(dom) {
      var el0 = dom.createDocumentFragment();
      if (tagName === 'svg') {
        dom.setNamespace(svgNamespace);
      }
      var el1 = dom.createElement(tagName);

      for (var key in attributes) {
        if (typeof attributes[key] !== 'string') {
          continue;
        }
        dom.setAttribute(el1, key, attributes[key]);
      }

      if (!voidMap['default'][tagName]) {
        var el2 = dom.createComment("");
        dom.appendChild(el1, el2);
      }

      dom.appendChild(el0, el1);

      return el0;
    },
    buildRenderNodes: function buildRenderNodes(dom, fragment) {
      var element = dom.childAt(fragment, [0]);
      var morphs = [];

      for (var key in attributes) {
        if (typeof attributes[key] === 'string') {
          continue;
        }
        morphs.push(dom.createAttrMorph(element, key));
      }

      morphs.push(dom.createMorphAt(element, 0, 0));
      return morphs;
    },
    statements: statements,
    locals: [],
    templates: []
  };

  return template;
}

function attachAttributes(attributes) {
  var statements = [];

  for (var key in attributes) {
    if (typeof attributes[key] === 'string') {
      continue;
    }
    statements.push(["attribute", key, attributes[key]]);
  }

  var template = {
    arity: 0,
    cachedFragment: null,
    hasRendered: false,
    buildFragment: function buildFragment(dom) {
      var el0 = this.element;
      if (el0.namespaceURI === "http://www.w3.org/2000/svg") {
        dom.setNamespace(svgNamespace);
      }
      for (var key in attributes) {
        if (typeof attributes[key] !== 'string') {
          continue;
        }
        dom.setAttribute(el0, key, attributes[key]);
      }

      return el0;
    },
    buildRenderNodes: function buildRenderNodes(dom) {
      var element = this.element;
      var morphs = [];

      for (var key in attributes) {
        if (typeof attributes[key] === 'string') {
          continue;
        }
        morphs.push(dom.createAttrMorph(element, key));
      }

      return morphs;
    },
    statements: statements,
    locals: [],
    templates: [],
    element: null
  };

  return template;
}

RenderResult.prototype.initializeNodes = function (ownerNode) {
  array_utils.forEach(this.root.childNodes, function (node) {
    initializeNode(node, ownerNode);
  });
};

RenderResult.prototype.render = function () {
  this.root.lastResult = this;
  this.root.rendered = true;
  this.populateNodes(ExpressionVisitor.AlwaysDirtyVisitor);

  if (this.shouldSetContent && this.root.setContent) {
    this.root.setContent(this.fragment);
  }
};

RenderResult.prototype.dirty = function () {
  morph_utils.visitChildren([this.root], function (node) {
    node.isDirty = true;
  });
};

RenderResult.prototype.revalidate = function (env, self, blockArguments, scope) {
  this.revalidateWith(env, scope, self, blockArguments, ExpressionVisitor['default']);
};

RenderResult.prototype.rerender = function (env, self, blockArguments, scope) {
  this.revalidateWith(env, scope, self, blockArguments, ExpressionVisitor.AlwaysDirtyVisitor);
};

RenderResult.prototype.revalidateWith = function (env, scope, self, blockArguments, visitor) {
  if (env !== undefined) {
    this.env = env;
  }
  if (scope !== undefined) {
    this.scope = scope;
  }
  this.updateScope();

  if (self !== undefined) {
    this.updateSelf(self);
  }
  if (blockArguments !== undefined) {
    this.updateLocals(blockArguments);
  }

  this.populateNodes(visitor);
};

RenderResult.prototype.destroy = function () {
  var rootNode = this.root;
  template_utils.clearMorph(rootNode, this.env, true);
};

RenderResult.prototype.populateNodes = function (visitor) {
  var env = this.env;
  var scope = this.scope;
  var template = this.template;
  var nodes = this.nodes;
  var statements = this.statements;
  var i, l;

  for (i = 0, l = statements.length; i < l; i++) {
    var statement = statements[i];
    var morph = nodes[i];

    if (env.hooks.willRenderNode) {
      env.hooks.willRenderNode(morph, env, scope);
    }

    switch (statement[0]) {
      case 'block':
        visitor.block(statement, morph, env, scope, template, visitor);break;
      case 'inline':
        visitor.inline(statement, morph, env, scope, visitor);break;
      case 'content':
        visitor.content(statement, morph, env, scope, visitor);break;
      case 'element':
        visitor.element(statement, morph, env, scope, template, visitor);break;
      case 'attribute':
        visitor.attribute(statement, morph, env, scope);break;
      case 'component':
        visitor.component(statement, morph, env, scope, template, visitor);break;
      case 'attributes':
        visitor.attributes(statement, morph, env, scope, this.fragment, visitor);break;
    }

    if (env.hooks.didRenderNode) {
      env.hooks.didRenderNode(morph, env, scope);
    }
  }
};

RenderResult.prototype.bindScope = function () {
  this.env.hooks.bindScope(this.env, this.scope);
};

RenderResult.prototype.updateScope = function () {
  this.env.hooks.updateScope(this.env, this.scope);
};

RenderResult.prototype.bindSelf = function (self) {
  this.env.hooks.bindSelf(this.env, this.scope, self);
};

RenderResult.prototype.updateSelf = function (self) {
  this.env.hooks.updateSelf(this.env, this.scope, self);
};

RenderResult.prototype.bindLocals = function (blockArguments) {
  var localNames = this.template.locals;

  for (var i = 0, l = localNames.length; i < l; i++) {
    this.env.hooks.bindLocal(this.env, this.scope, localNames[i], blockArguments[i]);
  }
};

RenderResult.prototype.updateLocals = function (blockArguments) {
  var localNames = this.template.locals;

  for (var i = 0, l = localNames.length; i < l; i++) {
    this.env.hooks.updateLocal(this.env, this.scope, localNames[i], blockArguments[i]);
  }
};

function initializeNode(node, owner) {
  node.ownerNode = owner;
}

function createChildMorph(dom, parentMorph, contextualElement) {
  var morph = Morph['default'].empty(dom, contextualElement || parentMorph.contextualElement);
  initializeNode(morph, parentMorph.ownerNode);
  return morph;
}

function getCachedFragment(template, env) {
  var dom = env.dom,
      fragment;
  if (env.useFragmentCache && dom.canClone) {
    if (template.cachedFragment === null) {
      fragment = template.buildFragment(dom);
      if (template.hasRendered) {
        template.cachedFragment = fragment;
      } else {
        template.hasRendered = true;
      }
    }
    if (template.cachedFragment) {
      fragment = dom.cloneNode(template.cachedFragment, true);
    }
  } else if (!fragment) {
    fragment = template.buildFragment(dom);
  }

  return fragment;
}