import config, { defaultConfig, getPluginConfig } from '../config';
import { createMockStrapi } from './mock-strapi';

describe('plugin config', () => {
  it('defaults both features to enabled', () => {
    expect(config.default).toEqual({
      securityCheck: true,
      syntaxHighlighting: true,
      allowedNetworkOrigins: [],
      scratchDirectory: null,
      markdownFields: [],
      publishGuard: null,
      allowedContentTypes: null,
    });
    expect(defaultConfig).toBe(config.default);
  });

  it('accepts booleans and empty config', () => {
    expect(() => config.validator({})).not.toThrow();
    expect(() => config.validator({ securityCheck: false, syntaxHighlighting: true })).not.toThrow();
  });

  it('rejects non-boolean values', () => {
    expect(() => config.validator({ securityCheck: 'false' as any })).toThrow(/securityCheck.*boolean/);
    expect(() => config.validator({ syntaxHighlighting: 1 as any })).toThrow(/syntaxHighlighting/);
  });

  it('validates the egress and scratch directory allow-lists', () => {
    expect(() =>
      config.validator({ allowedNetworkOrigins: ['https://gateway.internal'], scratchDirectory: '/srv/scratch' })
    ).not.toThrow();
    expect(() => config.validator({ allowedNetworkOrigins: 'https://x' as any })).toThrow(/allowedNetworkOrigins/);
    expect(() => config.validator({ allowedNetworkOrigins: ['https://x/path'] })).toThrow(/allowedNetworkOrigins/);
    expect(() => config.validator({ allowedNetworkOrigins: ['file:///etc'] })).toThrow(/allowedNetworkOrigins/);
    expect(() => config.validator({ scratchDirectory: 'tmp' })).toThrow(/scratchDirectory/);
    expect(() => config.validator({ scratchDirectory: '/' })).toThrow(/scratchDirectory/);
    expect(() => config.validator({ scratchDirectory: '/srv/../etc' })).toThrow(/scratchDirectory/);
  });

  it('validates markdownFields and publishGuard', () => {
    expect(() => config.validator({ markdownFields: ['rawHtml', 'description'], publishGuard: () => [] })).not.toThrow();
    expect(() => config.validator({ publishGuard: null })).not.toThrow();
    expect(() => config.validator({ markdownFields: 'rawHtml' as any })).toThrow(/markdownFields/);
    expect(() => config.validator({ markdownFields: ['marketing.tables.rawHtml'] })).toThrow(/markdownFields/);
    expect(() => config.validator({ publishGuard: 'guard' as any })).toThrow(/publishGuard/);
  });

  it('validates allowedContentTypes', () => {
    expect(() => config.validator({ allowedContentTypes: ['api::landing.landing', 'plugin::upload.file'] })).not.toThrow();
    expect(() => config.validator({ allowedContentTypes: null })).not.toThrow();
    expect(() => config.validator({ allowedContentTypes: [] })).not.toThrow();
    expect(() => config.validator({ allowedContentTypes: 'api::landing.landing' as any })).toThrow(/allowedContentTypes/);
    expect(() => config.validator({ allowedContentTypes: ['landing'] })).toThrow(/allowedContentTypes/);
  });

  it('never widens a malformed content-type restriction', () => {
    const read = (value: unknown) => getPluginConfig(createMockStrapi({ allowedContentTypes: value }).strapi).allowedContentTypes;
    expect(read(undefined)).toBeNull();
    expect(read(null)).toBeNull();
    expect(read(['api::landing.landing', 'nope', 3])).toEqual(['api::landing.landing']);
    expect(read('api::landing.landing')).toEqual([]);
  });

  it('rejects any attempt to configure auth', () => {
    expect(() => config.validator({ enforceAuth: false } as any)).toThrow(/always required/);
  });

  it('reads config, keeping safe defaults unless explicitly false', () => {
    expect(getPluginConfig(createMockStrapi().strapi)).toEqual(defaultConfig);
    expect(getPluginConfig(createMockStrapi({ securityCheck: false }).strapi)).toEqual({
      ...defaultConfig,
      securityCheck: false,
    });
    expect(getPluginConfig(createMockStrapi({ syntaxHighlighting: 'no' }).strapi).syntaxHighlighting).toBe(true);
  });

  it('falls back to deny-all for malformed allow-lists', () => {
    const read = (values: Record<string, unknown>) => getPluginConfig(createMockStrapi(values).strapi);
    expect(read({ allowedNetworkOrigins: ['https://gateway.internal', 'nope', 3] }).allowedNetworkOrigins).toEqual([
      'https://gateway.internal',
    ]);
    expect(read({ allowedNetworkOrigins: 'https://x' }).allowedNetworkOrigins).toEqual([]);
    expect(read({ scratchDirectory: '/srv/scratch' }).scratchDirectory).toBe('/srv/scratch');
    expect(read({ scratchDirectory: '../x' }).scratchDirectory).toBeNull();
    expect(read({ markdownFields: ['rawHtml', 'a.b', 3] }).markdownFields).toEqual(['rawHtml']);
    expect(read({ markdownFields: 'rawHtml' }).markdownFields).toEqual([]);
    expect(read({ publishGuard: 'x' }).publishGuard).toBeNull();
  });
});
