import { getMemberPath, getStaticString, isVariableReference } from '../ast';
import type { SecurityRule } from '../types';

/** Ways to reach a module loader other than the require identifier. */
const LOADER_MEMBERS = new Set(['require', 'createRequire', '_load', '_resolveFilename', 'constructor', 'paths']);

export const noDynamicModuleLoading: SecurityRule = {
  id: 'no-dynamic-module-loading',
  severity: 'error',
  description: 'Loading modules is not allowed in cron scripts.',
  rationale:
    'The module allow-list for cron scripts is empty: require(), import(), module.require and createRequire are how a script escapes the strapi API surface and loads packages from node_modules. Computed module names also defeat static review. Everything a cron script needs is available on the strapi object.',
  create: (context) => ({
    ImportExpression: (node) => {
      if (getStaticString(node.source) === null) {
        context.report(node, 'Dynamic import() with a computed module name is not allowed.');
      } else {
        context.report(node, 'import() is not allowed in cron scripts.');
      }
    },
    MemberExpression: (node) => {
      const path = getMemberPath(node);
      if (path?.length === 2 && path[0] === 'module' && LOADER_MEMBERS.has(path[1])) {
        context.report(node, `module.${path[1]} loads modules and is not allowed.`);
      }
    },
    Identifier: (node, ancestors) => {
      const parent = ancestors[ancestors.length - 2];
      if (node.name === 'createRequire' && isVariableReference(node, parent)) {
        context.report(node, 'createRequire() is not allowed in cron scripts.');
        return;
      }
      if (node.name !== 'require') return;
      if (!isVariableReference(node, parent)) return;
      if (parent?.type === 'CallExpression' && parent.callee === node) {
        if (getStaticString(parent.arguments[0]) === null) {
          context.report(parent, 'require() with a computed module name is not allowed.');
        } else {
          context.report(parent, 'require() is not allowed in cron scripts.');
        }
        return;
      }
      context.report(node, 'Referencing require is not allowed.');
    },
  }),
};
