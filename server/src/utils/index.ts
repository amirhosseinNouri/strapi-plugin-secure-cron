export type LogLine = string[];

export type ScopedConsole = Pick<Console, 'log' | 'info' | 'warn' | 'error' | 'debug'>;

const serializeArg = (arg: unknown): string => {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return arg.stack ?? `${arg.name}: ${arg.message}`;
  if (arg === undefined) return 'undefined';
  if (typeof arg === 'function') return `[Function ${arg.name || 'anonymous'}]`;
  if (typeof arg === 'bigint' || typeof arg === 'symbol') return arg.toString();
  try {
    return JSON.stringify(arg) ?? String(arg);
  } catch {
    return String(arg);
  }
};

/**
 * A console object handed to a script instead of the global one, so concurrent
 * jobs never mix their output and scripts cannot capture other code's logs.
 */
export const createScopedConsole = (
  forward?: (level: keyof ScopedConsole, line: string) => void
): { lines: LogLine[]; console: ScopedConsole } => {
  const lines: LogLine[] = [];
  const write =
    (level: keyof ScopedConsole) =>
    (...args: unknown[]) => {
      const line = args.map(serializeArg);
      lines.push(level === 'log' || level === 'info' ? line : [`[${level}]`, ...line]);
      forward?.(level, line.join(' '));
    };
  return {
    lines,
    console: {
      log: write('log'),
      info: write('info'),
      warn: write('warn'),
      error: write('error'),
      debug: write('debug'),
    },
  };
};

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escapes a run-time value for use inside markdown/HTML content, so it renders as
 * text. Passed to every script; the no-dynamic-markup rule requires it.
 */
export const escapeHtml = (value: unknown): string =>
  String(value ?? '').replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);

/**
 * The strapi object scripts get when allowedContentTypes is configured: documents() for
 * those content types and log, nothing else. Enforced at run time, so renamed variables
 * or built-up strings cannot reach strapi.db, services or other content types.
 */
export const createScopedStrapi = (strapi: any, allowedContentTypes: string[]) =>
  Object.freeze({
    documents: (uid: unknown) => {
      if (typeof uid !== 'string' || !allowedContentTypes.includes(uid)) {
        throw new Error(
          `The content type "${String(uid)}" is not allowed. Allowed content types: ${allowedContentTypes.join(', ') || 'none'}.`
        );
      }
      return strapi.documents(uid);
    },
    log: strapi.log,
  });

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...args: unknown[]) => Promise<unknown>;

/**
 * Runs a script as the body of an async function. Scripts may `await`, or call
 * the legacy `resolve()` / `reject()` callbacks kept for backwards compatibility,
 * and use `escapeHtml()` for run-time values written to markdown fields.
 */
export const runScript = (
  script: string,
  args: { strapi: unknown; cronJob: unknown; console: ScopedConsole }
): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    let fn: (...args: unknown[]) => Promise<unknown>;
    try {
      fn = new AsyncFunction('strapi', 'cronJob', 'console', 'resolve', 'reject', 'escapeHtml', script);
    } catch (error) {
      reject(error);
      return;
    }
    fn(args.strapi, args.cronJob, args.console, () => resolve(), reject, escapeHtml).then(
      () => resolve(),
      reject
    );
  });
