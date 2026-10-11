import { getMemberPath, getStaticString, isVariableReference } from '../ast';
import type { CheckOptions, SecurityRule } from '../types';

const GLOBAL_OBJECTS = new Set(['globalThis', 'global', 'window', 'self']);
const NETWORK_FUNCTIONS = new Set(['fetch', 'strapi.fetch', 'navigator.sendBeacon']);
const NETWORK_CONSTRUCTORS = new Set(['WebSocket', 'XMLHttpRequest', 'EventSource', 'WebTransport']);
const NETWORK_GLOBALS = new Set(['fetch', ...NETWORK_CONSTRUCTORS]);

/** `globalThis.fetch` -> `fetch`; other paths are joined as-is. */
const networkName = (callee: any): string | null => {
  const path = getMemberPath(callee);
  if (!path) return null;
  if (path.length === 2 && GLOBAL_OBJECTS.has(path[0])) return path[1];
  return path.join('.');
};

const isCallee = (node: any, parent: any) =>
  (parent?.type === 'CallExpression' || parent?.type === 'NewExpression') && parent.callee === node;

const toOrigin = (url: string): string | null => {
  try {
    const origin = new URL(url.trim()).origin;
    return origin === 'null' ? null : origin;
  } catch {
    return null;
  }
};

/** True when `url` is a static URL whose origin is on the configured allow-list. */
export const isAllowedDestination = (url: string | null, options: CheckOptions): boolean => {
  if (url === null) return false;
  const origin = toOrigin(url);
  if (!origin) return false;
  return (options.allowedNetworkOrigins ?? []).some((allowed) => toOrigin(allowed) === origin);
};

export const noNetworkCalls: SecurityRule = {
  id: 'no-network-calls',
  severity: 'warning',
  description: 'The script makes outbound network requests.',
  rationale:
    'fetch, strapi.fetch, WebSocket, XMLHttpRequest and EventSource can send CMS data to third parties (the http, https, net and dns modules are blocked outright). Make sure the destination is trusted before acknowledging, or list your internal gateway in allowedNetworkOrigins and call it with a literal URL to skip the warning.',
  create: (context) => {
    const check = (node: any, name: string) => {
      if (isAllowedDestination(getStaticString(node.arguments[0]), context.options)) return;
      const destination = getStaticString(node.arguments[0]) === null ? 'a computed URL' : 'a destination outside allowedNetworkOrigins';
      context.report(node, `${name} to ${destination} needs review.`);
    };
    return {
      CallExpression: (node) => {
        const name = networkName(node.callee);
        if (name && NETWORK_FUNCTIONS.has(name)) check(node, `${name}()`);
      },
      NewExpression: (node) => {
        const name = networkName(node.callee);
        if (name && NETWORK_CONSTRUCTORS.has(name)) check(node, `new ${name}()`);
      },
      // Aliases (`const f = fetch`) would hide the destination from the checks above.
      Identifier: (node, ancestors) => {
        if (!NETWORK_GLOBALS.has(node.name)) return;
        const parent = ancestors[ancestors.length - 2];
        if (!isVariableReference(node, parent) || isCallee(node, parent)) return;
        context.report(node, `Referencing ${node.name} outside a direct call hides its destination.`);
      },
      MemberExpression: (node, ancestors) => {
        if (getMemberPath(node)?.length !== 2) return;
        const name = networkName(node);
        if (!name || !(NETWORK_GLOBALS.has(name) || NETWORK_FUNCTIONS.has(name))) return;
        if (isCallee(node, ancestors[ancestors.length - 2])) return;
        context.report(node, `Referencing ${name} outside a direct call hides its destination.`);
      },
    };
  },
};
