import type { Core } from '@strapi/strapi';
import { PLUGIN_ID } from '../../../utils/plugin';

export type PluginConfig = {
  /** Run the static security check on scripts before they are saved, scheduled or triggered. */
  securityCheck: boolean;
  /** Use the syntax-highlighting code editor in the admin panel. */
  syntaxHighlighting: boolean;
  /** Origins (an internal egress gateway) that scripts may send requests to. Empty denies all egress. */
  allowedNetworkOrigins: string[];
  /** Absolute directory scripts may reference file paths in. Null denies all filesystem paths. */
  scratchDirectory: string | null;
};

export const defaultConfig: PluginConfig = {
  securityCheck: true,
  syntaxHighlighting: true,
  allowedNetworkOrigins: [],
  scratchDirectory: null,
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

/** Reads the resolved plugin config; anything but an explicit `false` keeps the safe default. */
export const getPluginConfig = (strapi: Core.Strapi): PluginConfig => {
  const plugin = strapi.plugin(PLUGIN_ID);
  const read = (key: keyof PluginConfig) => (plugin.config(key) as unknown) !== false;
  // Allow-lists only ever relax a check, so anything malformed falls back to "deny".
  const origins = plugin.config('allowedNetworkOrigins') as unknown;
  const scratch = plugin.config('scratchDirectory') as unknown;
  return {
    securityCheck: read('securityCheck'),
    syntaxHighlighting: read('syntaxHighlighting'),
    allowedNetworkOrigins: Array.isArray(origins) ? origins.filter(isOrigin) : [],
    scratchDirectory: typeof scratch === 'string' && isScratchDirectory(scratch) ? scratch : null,
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
    if ('enforceAuth' in config) {
      throw new Error(
        'strapi-plugin-secure-cron: "enforceAuth" is not supported. Admin authentication is always required.'
      );
    }
  },
};
