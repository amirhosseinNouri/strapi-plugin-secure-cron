import { getMemberPath, isVariableReference } from '../ast';
import type { AstNode, SecurityRule } from '../types';

const GLOBAL_OBJECTS = new Set(['globalThis', 'global', 'window', 'self']);

const REASONS = new Map<string, string>(Object.entries({
  env: 'process.env exposes secrets such as database credentials and API keys.',
  exit: 'process.exit() shuts the server down.',
  abort: 'process.abort() shuts the server down.',
  kill: 'process.kill() signals other processes.',
  binding: 'process.binding() reaches native Node.js internals.',
  _linkedBinding: 'process._linkedBinding() reaches native Node.js internals.',
  dlopen: 'process.dlopen() loads native code into the server.',
  mainModule: 'process.mainModule.require loads any module.',
  getBuiltinModule: 'process.getBuiltinModule() loads any Node.js module.',
}));

/** Names the specific danger when `member` reads a known property of process. */
const messageFor = (member: AstNode | undefined, processNode: AstNode): string => {
  if (member?.type === 'MemberExpression' && member.object === processNode) {
    const path = getMemberPath(member);
    const property = path?.[path.length - 1];
    const reason = property && REASONS.get(property);
    if (reason) return `Accessing process.${property} is not allowed: ${reason}`;
  }
  return 'Accessing process is not allowed.';
};

export const noProcessAccess: SecurityRule = {
  id: 'no-process-access',
  severity: 'error',
  description: 'Accessing the Node.js process object is not allowed.',
  rationale:
    'process exposes environment variables (secrets), process.exit, process.binding, process.dlopen and process.mainModule.require, which bypass every other safeguard. Every use of process is rejected.',
  create: (context) => ({
    Identifier: (node, ancestors) => {
      if (node.name !== 'process') return;
      const parent = ancestors[ancestors.length - 2];
      if (!isVariableReference(node, parent)) return;
      context.report(node, messageFor(parent, node));
    },
    MemberExpression: (node, ancestors) => {
      const path = getMemberPath(node);
      if (path && path.length === 2 && GLOBAL_OBJECTS.has(path[0]) && path[1] === 'process') {
        context.report(node, messageFor(ancestors[ancestors.length - 2], node));
      }
    },
  }),
};
