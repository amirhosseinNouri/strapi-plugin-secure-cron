import { getMemberPath, stringVisitors } from '../ast';
import type { SecurityRule } from '../types';

/** Packages whose only purpose is building or loading native addons. */
const NATIVE_PACKAGES = new Set([
  'bindings',
  'ffi',
  'ffi-napi',
  'ffi-rs',
  'koffi',
  'node-addon-api',
  'node-gyp',
  'node-gyp-build',
  'node-pre-gyp',
  '@mapbox/node-pre-gyp',
  'prebuild-install',
  'ref-napi',
]);

/** Matches `addon.node`, `./build/Release/x.node` and `x.node?query`, not `api::x.node` uids. */
const NODE_ADDON_FILE = /(?:^|[/\\])[\w.-]+\.node(?:[?#].*)?$/;

const packageName = (specifier: string) => {
  const parts = specifier.trim().replace(/^node:/, '').split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
};

export const noNativeModules: SecurityRule = {
  id: 'no-native-modules',
  severity: 'error',
  description: 'Loading native code is not allowed.',
  rationale:
    'Native addons (.node files), FFI libraries (ffi, ffi-napi, koffi), bindings and node-gyp run machine code inside the server process, outside the reach of any JavaScript check.',
  create: (context) => ({
    ...stringVisitors((node, value) => {
      if (NATIVE_PACKAGES.has(packageName(value))) {
        context.report(node, `Referencing the native module loader "${value}" is not allowed.`);
      } else if (NODE_ADDON_FILE.test(value.trim())) {
        context.report(node, `Referencing the native addon "${value}" is not allowed.`);
      }
    }),
    MemberExpression: (node) => {
      const path = getMemberPath(node);
      if (path?.[path.length - 1] === 'dlopen') context.report(node, 'dlopen() loads native code and is not allowed.');
    },
  }),
};
