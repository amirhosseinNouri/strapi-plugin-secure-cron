import type { AstNode } from './types';

/** Marker segment for a computed member access whose key cannot be resolved statically. */
export const DYNAMIC = '*';
/** Marker segment for a call expression inside a member chain, e.g. `strapi.plugin('x').service`. */
export const CALL = '()';

const unwrap = (node: AstNode): AstNode => {
  let current = node;
  while (
    current &&
    (current.type === 'ChainExpression' ||
      current.type === 'ParenthesizedExpression' ||
      current.type === 'TSNonNullExpression')
  ) {
    current = current.expression;
  }
  return current;
};

/** Returns the string value of a literal or an expression-free template literal. */
export const getStaticString = (node: AstNode | null | undefined): string | null => {
  if (!node) return null;
  const target = unwrap(node);
  if (target.type === 'Literal' && typeof target.value === 'string') return target.value;
  if (target.type === 'TemplateLiteral' && target.expressions.length === 0) {
    return target.quasis.map((quasi: AstNode) => quasi.value.cooked ?? '').join('');
  }
  return null;
};

const getPropertyName = (node: AstNode): string => {
  if (!node.computed) {
    return node.property.type === 'PrivateIdentifier' ? `#${node.property.name}` : node.property.name;
  }
  const value = getStaticString(node.property);
  if (value !== null) return value;
  if (node.property.type === 'Literal' && typeof node.property.value === 'number') {
    return String(node.property.value);
  }
  return DYNAMIC;
};

/**
 * Flattens a member chain into its segments:
 * `strapi.db.connection` -> ['strapi', 'db', 'connection'],
 * `strapi['config']` -> ['strapi', 'config'],
 * `strapi.plugin('x').service` -> ['strapi', 'plugin', '()', 'service'].
 * Returns null when the chain does not start from an identifier, `this` or a call.
 */
export const getMemberPath = (input: AstNode | null | undefined): string[] | null => {
  if (!input) return null;
  const node = unwrap(input);
  switch (node.type) {
    case 'Identifier':
      return [node.name];
    case 'ThisExpression':
      return ['this'];
    case 'MemberExpression': {
      const objectPath = getMemberPath(node.object);
      if (!objectPath) return null;
      return [...objectPath, getPropertyName(node)];
    }
    case 'CallExpression': {
      const calleePath = getMemberPath(node.callee);
      if (!calleePath) return null;
      return [...calleePath, CALL];
    }
    default:
      return null;
  }
};

export const pathStartsWith = (path: string[] | null, prefix: string[]): boolean => {
  if (!path || path.length < prefix.length) return false;
  return prefix.every((segment, index) => path[index] === segment);
};

/**
 * True when `node` (an Identifier) is read as a variable, as opposed to being a
 * non-computed property name, an object key, a label or a declaration name.
 */
export const isVariableReference = (node: AstNode, parent: AstNode | undefined): boolean => {
  if (!parent) return true;
  switch (parent.type) {
    case 'MemberExpression':
      return parent.object === node || (parent.computed && parent.property === node);
    case 'Property':
    case 'PropertyDefinition':
    case 'MethodDefinition':
      if (parent.key === node && !parent.computed) {
        // `{ process }` shorthand reads the variable.
        return parent.type === 'Property' && parent.shorthand && parent.value === node;
      }
      return parent.value === node || (parent.computed && parent.key === node);
    case 'LabeledStatement':
    case 'BreakStatement':
    case 'ContinueStatement':
      return false;
    case 'FunctionDeclaration':
    case 'FunctionExpression':
    case 'ClassDeclaration':
    case 'ClassExpression':
      return parent.id !== node && !parent.params?.includes(node);
    case 'VariableDeclarator':
      return parent.init === node;
    case 'ExportSpecifier':
    case 'ImportSpecifier':
    case 'ImportDefaultSpecifier':
    case 'ImportNamespaceSpecifier':
      return false;
    default:
      return true;
  }
};

export const LOOP_TYPES = new Set([
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
  'WhileStatement',
  'DoWhileStatement',
]);

export const FUNCTION_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
]);

const ITERATION_METHODS = new Set(['forEach', 'map', 'flatMap', 'filter', 'reduce', 'some', 'every']);

/** True when the node sits inside a loop statement or an array iteration callback. */
export const isInsideLoop = (ancestors: AstNode[]): boolean => {
  // ancestors[ancestors.length - 1] is the node itself.
  for (let index = ancestors.length - 2; index >= 0; index -= 1) {
    const ancestor = ancestors[index];
    if (LOOP_TYPES.has(ancestor.type)) return true;
    if (FUNCTION_TYPES.has(ancestor.type)) {
      const parent = ancestors[index - 1];
      if (parent?.type === 'CallExpression' && parent.arguments.includes(ancestor)) {
        const calleePath = getMemberPath(parent.callee);
        const method = calleePath?.[calleePath.length - 1];
        if (method && ITERATION_METHODS.has(method)) return true;
      }
    }
  }
  return false;
};

/** Visitors calling `check` with the value of every string literal and template chunk. */
export const stringVisitors = (
  check: (node: AstNode, value: string) => void
): Record<'Literal' | 'TemplateElement', (node: AstNode) => void> => ({
  Literal: (node) => {
    if (typeof node.value === 'string') check(node, node.value);
  },
  TemplateElement: (node) => check(node, node.value.cooked ?? node.value.raw),
});
