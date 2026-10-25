import { getStaticString } from '../ast';
import type { AstNode, SecurityRule } from '../types';

/** Escapes run-time values for markdown fields; injected into every script by the runner. */
export const ESCAPE_HELPER = 'escapeHtml';

const REPLACE_METHODS = new Set(['replace', 'replaceAll']);

const keyName = (node: AstNode): string | null => {
  if (!node.computed && node.key?.type === 'Identifier') return node.key.name;
  return getStaticString(node.key);
};

const memberName = (node: AstNode): string | null => {
  if (node.type !== 'MemberExpression') return null;
  if (!node.computed && node.property.type === 'Identifier') return node.property.name;
  return getStaticString(node.property);
};

const unwrap = (node: AstNode): AstNode =>
  node.type === 'ChainExpression' || node.type === 'ParenthesizedExpression' ? unwrap(node.expression) : node;

/**
 * True when every part of `node` is either literal text (checked by no-unsafe-markup)
 * or escaped with `escapeHtml(...)`, so the value cannot carry markup from run time.
 */
const isSafeValue = (input: AstNode | null | undefined, fields: Set<string>): boolean => {
  if (!input) return true;
  const node = unwrap(input);
  switch (node.type) {
    case 'Literal':
      return node.regex === undefined;
    case 'TemplateLiteral':
      return node.expressions.every((expression: AstNode) => isSafeValue(expression, fields));
    case 'BinaryExpression':
      return node.operator === '+' && isSafeValue(node.left, fields) && isSafeValue(node.right, fields);
    case 'LogicalExpression':
      return isSafeValue(node.left, fields) && isSafeValue(node.right, fields);
    case 'ConditionalExpression':
      return isSafeValue(node.consequent, fields) && isSafeValue(node.alternate, fields);
    case 'CallExpression':
      if (node.callee.type === 'Identifier' && node.callee.name === ESCAPE_HELPER) return true;
      if (node.callee.type === 'Identifier' && node.callee.name === 'String') {
        return node.arguments.length === 1 && isSafeValue(node.arguments[0], fields);
      }
      // `doc.rawHtml.replace(old, escapeHtml(price))` edits content already stored in the field.
      if (REPLACE_METHODS.has(memberName(node.callee) ?? '')) {
        return isSafeValue(node.callee.object, fields) && isSafeValue(node.arguments[1], fields);
      }
      return false;
    case 'MemberExpression':
      // Reading the field's current value (`component.rawHtml`) keeps stored content.
      return fields.has(memberName(node) ?? '');
    default:
      return false;
  }
};

export const noDynamicMarkup: SecurityRule = {
  id: 'no-dynamic-markup',
  severity: 'error',
  description: 'Markdown fields may only receive literal content or escaped run-time values.',
  rationale:
    'Fields listed in markdownFields are rendered as HTML on the site. A value computed at run time, such as HTML from a feed, cannot be checked before it is published. Write literal markup and wrap every run-time value (prices, names) in escapeHtml(...), which the runner provides, e.g. `<td>${escapeHtml(price)}</td>`, or rawHtml.replace(old, escapeHtml(price)).',
  create: (context) => {
    const fields = new Set(context.options.markdownFields ?? []);
    if (fields.size === 0) return {};

    const check = (node: AstNode, field: string, value: AstNode | null | undefined) => {
      if (isSafeValue(value, fields)) return;
      context.report(
        node,
        `"${field}" is a markdown field: set it to literal markup and wrap run-time values in ${ESCAPE_HELPER}(...).`
      );
    };

    const reportShadowing = (node: AstNode | null | undefined) => {
      if (node?.type === 'Identifier' && node.name === ESCAPE_HELPER) {
        context.report(node, `${ESCAPE_HELPER} is provided by the runner and must not be redefined.`);
      }
    };

    return {
      Property: (node) => {
        const field = keyName(node);
        if (field && fields.has(field)) check(node, field, node.value);
      },
      AssignmentExpression: (node) => {
        reportShadowing(node.left);
        const field = memberName(node.left);
        if (!field || !fields.has(field)) return;
        // `x.rawHtml += value` keeps the current value, so only the added part needs checking.
        check(node, field, node.right);
      },
      VariableDeclarator: (node) => reportShadowing(node.id),
      FunctionDeclaration: (node) => {
        reportShadowing(node.id);
        node.params.forEach(reportShadowing);
      },
      FunctionExpression: (node) => node.params.forEach(reportShadowing),
      ArrowFunctionExpression: (node) => node.params.forEach(reportShadowing),
    };
  },
};
