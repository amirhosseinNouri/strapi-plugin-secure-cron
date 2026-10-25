import type { Core } from '@strapi/strapi';
import type { PublishGuard } from '../../../types';
import { PLUGIN_ID } from '../../../utils/plugin';

export type PublishGuardMode = 'error' | 'warn';
const PUBLISH_GUARD_MODES: PublishGuardMode[] = ['error', 'warn'];

export type PluginConfig = {
  /** Run the static security check on scripts before they are saved, scheduled or triggered. */
  securityCheck: boolean;
  /** Use the syntax-highlighting code editor in the admin panel. */
  syntaxHighlighting: boolean;
  /** Origins (an internal egress gateway) that scripts may send requests to. Empty denies all egress. */
  allowedNetworkOrigins: string[];
  /** Absolute directory scripts may reference file paths in. Null denies all filesystem paths. */
  scratchDirectory: string | null;
  /** Content attribute names rendered as markdown/HTML. Scripts may only write literal or escaped values to them. */
  markdownFields: string[];
  /** Project-specific check run before a job is turned on or test-run; errors keep it off. */
  publishGuard: PublishGuard | null;
  /**
   * How publishGuard errors are applied: 'error' keeps the job off, 'warn' turns it on (or runs it)
   * and shows the findings as warnings.
   */
  publishGuardMode: PublishGuardMode;
  /**
   * Content-type UIDs scripts may access. When set, scripts get a strapi object with only
   * documents() for these UIDs and log. Null leaves the full strapi object (upstream behaviour).
   */
  allowedContentTypes: string[] | null;
};

export const defaultConfig: PluginConfig = {
  securityCheck: true,
  syntaxHighlighting: true,
  allowedNetworkOrigins: [],
  scratchDirectory: null,
  markdownFields: [],
  publishGuard: null,
  publishGuardMode: 'error',
  allowedContentTypes: null,
};

const isOrigin = (value: unknown): boolean => {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) && url.origin === value.replace(/\/+$/, '');
  } catch {
    return false;
  }
};

const isScratchDirectory = (value: unknown): boolean =>
  value === null ||
  (typeof value === 'string' && value.startsWith('/') && value !== '/' && !/(?:^|\/)\.\.(?:\/|$)/.test(value));

const isContentTypeUid = (value: unknown): boolean =>
  typeof value === 'string' && /^[a-z][\w-]*::[\w-]+\.[\w-]+$/.test(value);

const isFieldName = (value: unknown): boolean => typeof value === 'string' && /^[A-Za-z_$][\w$]*$/.test(value);

/** Reads the resolved plugin config; anything but an explicit `false` keeps the safe default. */
export const getPluginConfig = (strapi: Core.Strapi): PluginConfig => {
  const plugin = strapi.plugin(PLUGIN_ID);
  const read = (key: keyof PluginConfig) => (plugin.config(key) as unknown) !== false;
  // Allow-lists only ever relax a check, so anything malformed falls back to "deny".
  const origins = plugin.config('allowedNetworkOrigins') as unknown;
  const scratch = plugin.config('scratchDirectory') as unknown;
  const fields = plugin.config('markdownFields') as unknown;
  const guard = plugin.config('publishGuard') as unknown;
  const guardMode = plugin.config('publishGuardMode') as unknown;
  const contentTypes = plugin.config('allowedContentTypes') as unknown;
  return {
    securityCheck: read('securityCheck'),
    syntaxHighlighting: read('syntaxHighlighting'),
    allowedNetworkOrigins: Array.isArray(origins) ? origins.filter(isOrigin) : [],
    scratchDirectory: typeof scratch === 'string' && isScratchDirectory(scratch) ? scratch : null,
    markdownFields: Array.isArray(fields) ? fields.filter(isFieldName) : [],
    publishGuard: typeof guard === 'function' ? (guard as PublishGuard) : null,
    // Anything but an explicit 'warn' keeps the blocking default.
    publishGuardMode: guardMode === 'warn' ? 'warn' : 'error',
    // A restriction must never silently turn into "everything": anything but null/undefined restricts.
    allowedContentTypes:
      contentTypes === null || contentTypes === undefined
        ? null
        : Array.isArray(contentTypes)
          ? contentTypes.filter(isContentTypeUid)
          : [],
  };
};

const BOOLEAN_KEYS: Array<keyof PluginConfig> = ['securityCheck', 'syntaxHighlighting'];

export default {
  default: defaultConfig,
  validator(config: Partial<PluginConfig> & Record<string, unknown>) {
    for (const key of BOOLEAN_KEYS) {
      if (key in config && typeof config[key] !== 'boolean') {
        throw new Error(
          `strapi-plugin-secure-cron: config "${key}" must be a boolean, received ${typeof config[key]}`
        );
      }
    }
    if ('allowedNetworkOrigins' in config) {
      const origins = config.allowedNetworkOrigins;
      if (!Array.isArray(origins) || !origins.every(isOrigin)) {
        throw new Error(
          'strapi-plugin-secure-cron: config "allowedNetworkOrigins" must be an array of origins such as "https://gateway.internal"'
        );
      }
    }
    if ('scratchDirectory' in config && !isScratchDirectory(config.scratchDirectory)) {
      throw new Error(
        'strapi-plugin-secure-cron: config "scratchDirectory" must be null or an absolute directory path without ".." segments'
      );
    }
    if ('markdownFields' in config) {
      const fields = config.markdownFields;
      if (!Array.isArray(fields) || !fields.every(isFieldName)) {
        throw new Error(
          'strapi-plugin-secure-cron: config "markdownFields" must be an array of attribute names such as "rawHtml"'
        );
      }
    }
    if ('publishGuard' in config && config.publishGuard !== null && typeof config.publishGuard !== 'function') {
      throw new Error('strapi-plugin-secure-cron: config "publishGuard" must be a function or null');
    }
    if ('publishGuardMode' in config && !PUBLISH_GUARD_MODES.includes(config.publishGuardMode as PublishGuardMode)) {
      throw new Error('strapi-plugin-secure-cron: config "publishGuardMode" must be "error" or "warn"');
    }
    if ('allowedContentTypes' in config && config.allowedContentTypes !== null) {
      const contentTypes = config.allowedContentTypes;
      if (!Array.isArray(contentTypes) || !contentTypes.every(isContentTypeUid)) {
        throw new Error(
          'strapi-plugin-secure-cron: config "allowedContentTypes" must be null or an array of content-type UIDs such as "api::landing.landing"'
        );
      }
    }
    if ('enforceAuth' in config) {
      throw new Error(
        'strapi-plugin-secure-cron: "enforceAuth" is not supported. Admin authentication is always required.'
      );
    }
  },
};
