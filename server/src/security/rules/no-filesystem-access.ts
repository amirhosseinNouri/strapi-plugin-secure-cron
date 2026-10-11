import path from 'path';
import { getMemberPath, getStaticString, isVariableReference, stringVisitors } from '../ast';
import type { CheckOptions, SecurityRule } from '../types';

/** Top-level directories of Linux, macOS and container images. */
const SYSTEM_ROOTS = new Set([
  'Applications', 'Library', 'System', 'Users', 'Volumes', 'bin', 'boot', 'dev', 'etc', 'home', 'lib',
  'lib32', 'lib64', 'media', 'mnt', 'opt', 'private', 'proc', 'root', 'run', 'sbin', 'snap', 'srv',
  'sys', 'tmp', 'usr', 'var',
]);
const TRAVERSAL = /(?:^|[/\\])\.\.(?:[/\\]|$)/;
const WINDOWS_PATH = /^(?:[a-zA-Z]:[\\/]|\\\\[^\\])/;
const HOME_PATH = /^~[\\/]/;
const FILE_URL = /^file:/i;

/**
 * fs functions, flagged on any object: a script has no legitimate way to hold an fs handle.
 * Names that are common outside fs (open, access, watch, link) are left out.
 */
const FS_METHODS = new Set([
  'accessSync', 'appendFile', 'appendFileSync', 'chmod', 'chmodSync', 'chown', 'chownSync',
  'copyFile', 'copyFileSync', 'cpSync', 'createReadStream', 'createWriteStream', 'existsSync', 'lchmod',
  'lchmodSync', 'lchown', 'lchownSync', 'linkSync', 'lutimes', 'lutimesSync', 'mkdirSync',
  'mkdtemp', 'mkdtempSync', 'openSync', 'opendir', 'opendirSync', 'readFile', 'readFileSync',
  'readdir', 'readdirSync', 'readlink', 'readlinkSync', 'realpathSync', 'renameSync', 'rmSync',
  'rmdir', 'rmdirSync', 'statSync', 'lstatSync', 'symlink', 'symlinkSync', 'truncate', 'truncateSync',
  'unlink', 'unlinkSync', 'utimes', 'utimesSync', 'watchFile', 'writeFile', 'writeFileSync',
]);
const LINK_METHODS = new Set(['linkSync', 'symlink', 'symlinkSync', 'lchmod', 'lchmodSync', 'lchown', 'lchownSync', 'lutimes', 'lutimesSync', 'readlink', 'readlinkSync']);
const PATH_GLOBALS = new Set(['__dirname', '__filename']);

/** True when `value` is an absolute path inside the configured scratch directory. */
export const isInScratchDirectory = (value: string, options: CheckOptions): boolean => {
  const scratch = options.scratchDirectory;
  if (!scratch || !path.posix.isAbsolute(scratch) || TRAVERSAL.test(value)) return false;
  const root = path.posix.normalize(scratch).replace(/\/+$/, '');
  const target = path.posix.normalize(value);
  return target === root || target.startsWith(`${root}/`);
};

/** Describes why a string is a forbidden filesystem path, or null. */
export const forbiddenPath = (raw: string, options: CheckOptions): string | null => {
  const value = raw.trim();
  if (!value || /\s/.test(value)) return null;
  if (TRAVERSAL.test(value)) return 'Path traversal with ".." is not allowed.';
  if (isInScratchDirectory(value, options)) return null;
  if (FILE_URL.test(value)) return 'file: URLs are not allowed.';
  if (WINDOWS_PATH.test(value) || HOME_PATH.test(value)) return `The absolute path "${value}" is not allowed.`;
  const [, root] = /^\/+([^/?#]+)/.exec(value) ?? [];
  if (root && SYSTEM_ROOTS.has(root)) return `The system path "${value}" is not allowed.`;
  return null;
};

export const noFilesystemAccess: SecurityRule = {
  id: 'no-filesystem-access',
  severity: 'error',
  description: 'Filesystem access outside the scratch directory is not allowed.',
  rationale:
    'Reading or writing server files leaks secrets (.env, keys) and lets a script plant code. Absolute system paths, ".." traversal, symlinks and fs calls are rejected; only paths inside the configured scratchDirectory are allowed.',
  create: (context) => ({
    ...stringVisitors((node, value) => {
      const reason = forbiddenPath(value, context.options);
      if (reason) context.report(node, reason);
    }),
    Identifier: (node, ancestors) => {
      if (!PATH_GLOBALS.has(node.name) || !isVariableReference(node, ancestors[ancestors.length - 2])) return;
      context.report(node, `${node.name} exposes the server filesystem layout and is not allowed.`);
    },
    CallExpression: (node) => {
      const calleePath = getMemberPath(node.callee);
      if (!calleePath || calleePath.length < 2) return;
      const method = calleePath[calleePath.length - 1];
      if (!FS_METHODS.has(method)) return;
      if (LINK_METHODS.has(method)) {
        context.report(node, `${method}() creates or follows links and is not allowed.`);
        return;
      }
      const target = getStaticString(node.arguments[0]);
      if (target === null || !isInScratchDirectory(target, context.options)) {
        context.report(node, `${method}() outside the scratch directory is not allowed.`);
      }
    },
  }),
};
