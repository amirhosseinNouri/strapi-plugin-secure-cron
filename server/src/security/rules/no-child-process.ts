import { getMemberPath, isVariableReference, stringVisitors } from '../ast';
import type { SecurityRule } from '../types';

/** Module and internal binding names that spawn processes. */
const SPAWN_MODULES = /(?:^|[^\w])(?:child_process|spawn_sync|process_wrap)(?:$|[^\w])/;
/** Called bare, any of these is a process spawn. */
const SPAWN_FUNCTIONS = new Set(['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync', 'fork']);
/** As methods, `exec` is left out because RegExp#exec is everyday code. */
const SPAWN_METHODS = new Set(['execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync', 'fork']);

export const noChildProcess: SecurityRule = {
  id: 'no-child-process',
  severity: 'error',
  description: 'Spawning processes is not allowed.',
  rationale:
    'child_process (exec, execSync, execFile, spawn, spawnSync, fork) runs shell commands with the permissions of the Strapi server. Any mention of the module, its internal bindings or its functions is rejected.',
  create: (context) => ({
    ...stringVisitors((node, value) => {
      if (SPAWN_MODULES.test(value)) context.report(node, 'Referencing child_process is not allowed.');
    }),
    Identifier: (node, ancestors) => {
      if (!SPAWN_FUNCTIONS.has(node.name)) return;
      const parent = ancestors[ancestors.length - 2];
      if (!isVariableReference(node, parent)) return;
      context.report(node, `${node.name}() spawns a process and is not allowed.`);
    },
    CallExpression: (node) => {
      const path = getMemberPath(node.callee);
      if (!path || path.length < 2) return;
      const method = path[path.length - 1];
      if (SPAWN_METHODS.has(method)) context.report(node, `${method}() spawns a process and is not allowed.`);
    },
  }),
};
