import { CALL, getMemberPath, isVariableReference } from '../ast';
import type { SecurityRule } from '../types';

const TIMER_FUNCTIONS = new Set(['setTimeout', 'setInterval', 'setImmediate']);
const GLOBAL_OBJECTS = new Set(['globalThis', 'global', 'window', 'self']);
/** node:vm entry points; distinctive enough to reject on any object. */
const VM_METHODS = new Set(['runInContext', 'runInNewContext', 'runInThisContext', 'compileFunction', 'createContext']);
const VM_CONSTRUCTORS = new Set(['Script', 'SourceTextModule', 'SyntheticModule']);
const FUNCTION_LITERALS = new Set(['FunctionExpression', 'ArrowFunctionExpression', 'ClassExpression']);
const GET_PROTOTYPE = new Set(['Object.getPrototypeOf', 'Reflect.getPrototypeOf']);

const calleeName = (callee: any): string | null => {
  const path = getMemberPath(callee);
  if (!path) return null;
  if (path.length === 1) return path[0];
  if (path.length === 2 && GLOBAL_OBJECTS.has(path[0])) return path[1];
  return null;
};

/** `fn.constructor`, `Function.constructor` and `Object.getPrototypeOf(fn).constructor` all yield a Function constructor. */
const reachesFunctionConstructor = (node: any): boolean => {
  const object = node.object;
  if (FUNCTION_LITERALS.has(object.type)) return true;
  const path = getMemberPath(object);
  if (!path) return false;
  if (path[0] === 'Function') return true;
  if (path[path.length - 1] === CALL && object.type === 'CallExpression') {
    const callee = getMemberPath(object.callee)?.join('.');
    return Boolean(callee && GET_PROTOTYPE.has(callee) && FUNCTION_LITERALS.has(object.arguments[0]?.type));
  }
  return false;
};

const propertyName = (node: any): string | null => {
  const path = getMemberPath(node);
  if (path) return path[path.length - 1];
  return node.computed ? null : node.property?.name ?? null;
};

export const noCodeEvaluation: SecurityRule = {
  id: 'no-code-evaluation',
  severity: 'error',
  description: 'Evaluating strings as code is not allowed.',
  rationale:
    'eval, the Function constructor (including Function.constructor and the async/generator variants), node:vm and string-based timers run arbitrary code that cannot be reviewed or security-checked. Write the logic directly in the script.',
  create: (context) => {
    const checkCall = (node: any) => {
      const name = calleeName(node.callee);
      if (name === 'eval') context.report(node, 'eval() is not allowed.');
      else if (name === 'Function') context.report(node, 'The Function constructor is not allowed.');
      else if (name && TIMER_FUNCTIONS.has(name)) {
        const [first] = node.arguments;
        if (first && (first.type === 'Literal' || first.type === 'TemplateLiteral')) {
          context.report(node, `${name}() with a string argument evaluates code and is not allowed.`);
        }
      }
      const path = getMemberPath(node.callee);
      const last = path?.[path.length - 1];
      if (!last) return;
      if (VM_METHODS.has(last)) context.report(node, `vm.${last}() evaluates code and is not allowed.`);
      else if (node.type === 'NewExpression' && path!.length > 1 && VM_CONSTRUCTORS.has(last)) {
        context.report(node, `new vm.${last}() evaluates code and is not allowed.`);
      }
    };
    return {
      CallExpression: checkCall,
      NewExpression: checkCall,
      MemberExpression: (node) => {
        if (propertyName(node) === 'constructor' && reachesFunctionConstructor(node)) {
          context.report(node, 'Reaching the Function constructor is not allowed.');
        }
      },
      Identifier: (node, ancestors) => {
        if (node.name !== 'eval' && node.name !== 'Function') return;
        const parent = ancestors[ancestors.length - 2];
        if (!isVariableReference(node, parent)) return;
        if ((parent?.type === 'CallExpression' || parent?.type === 'NewExpression') && parent.callee === node) return;
        if (node.name === 'Function') {
          // `x instanceof Function` is a type check; `Function.constructor` is reported above.
          if (parent?.type === 'BinaryExpression' && parent.operator === 'instanceof') return;
          if (parent?.type === 'MemberExpression' && parent.object === node) return;
        }
        context.report(node, `Referencing ${node.name} is not allowed.`);
      },
    };
  },
};
