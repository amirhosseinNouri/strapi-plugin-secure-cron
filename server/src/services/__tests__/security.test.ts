import { createMockStrapi } from '../../__tests__/mock-strapi';
import securityService from '../security';

describe('security service', () => {
  it('checks scripts when enabled', () => {
    const service = securityService(createMockStrapi());
    expect(service.isEnabled()).toBe(true);
    const result = service.check('process.exit(1)');
    expect(result).toMatchObject({ enabled: true, passed: false, errors: 1 });
  });

  it('applies the configured egress and scratch directory allow-lists', () => {
    const script = "await fetch('https://gateway.internal/x');\nfs.readFileSync('/srv/scratch/in.json');";
    expect(securityService(createMockStrapi()).check(script).passed).toBe(false);
    const configured = securityService(
      createMockStrapi({ allowedNetworkOrigins: ['https://gateway.internal'], scratchDirectory: '/srv/scratch' })
    );
    expect(configured.check(script)).toMatchObject({ passed: true, findings: [] });
  });

  it('passes the configured markdownFields to the check', () => {
    const script = 'const c = { rawHtml: feed.html };';
    expect(securityService(createMockStrapi()).check(script).passed).toBe(true);
    expect(securityService(createMockStrapi({ markdownFields: ['rawHtml'] })).check(script)).toMatchObject({
      passed: false,
      findings: [expect.objectContaining({ ruleId: 'no-dynamic-markup' })],
    });
  });

  describe('guard', () => {
    const job: any = { documentId: 'abc', name: 'Prices', script: '' };

    it('returns no findings without a publishGuard or when the check is off', async () => {
      expect(await securityService(createMockStrapi()).guard(job)).toEqual([]);
      const guard = jest.fn(() => [{ severity: 'error', message: 'x' }]);
      expect(await securityService(createMockStrapi({ securityCheck: false, publishGuard: guard })).guard(job)).toEqual([]);
      expect(guard).not.toHaveBeenCalled();
    });

    it('passes strapi and the job to the guard and returns its findings', async () => {
      const { strapi } = createMockStrapi();
      const guard = jest.fn(async () => [{ severity: 'error' as const, message: 'food/home is misused' }]);
      strapi.plugin = jest.fn(() => ({ config: (key: string) => (key === 'publishGuard' ? guard : undefined) }));
      expect(await securityService({ strapi }).guard(job)).toEqual([{ severity: 'error', message: 'food/home is misused' }]);
      expect(guard).toHaveBeenCalledWith({ strapi, cronJob: job });
    });

    it("reports error findings as warnings in 'warn' mode, but still blocks when the guard throws", async () => {
      const guard = () => [
        { severity: 'error' as const, message: 'food/home is misused', link: '/admin/x' },
        { severity: 'warning' as const, message: 'heads up' },
      ];
      expect(await securityService(createMockStrapi({ publishGuard: guard, publishGuardMode: 'warn' })).guard(job)).toEqual([
        { severity: 'warning', message: 'food/home is misused', link: '/admin/x' },
        { severity: 'warning', message: 'heads up' },
      ]);
      const throwing = securityService(
        createMockStrapi({ publishGuardMode: 'warn', publishGuard: () => { throw new Error('db down'); } })
      );
      expect(await throwing.guard(job)).toEqual([{ severity: 'error', message: 'The publish guard failed: db down' }]);
    });

    it('fails closed when the guard throws or returns garbage', async () => {
      const throwing = securityService(createMockStrapi({ publishGuard: () => { throw new Error('db down'); } }));
      expect(await throwing.guard(job)).toEqual([{ severity: 'error', message: 'The publish guard failed: db down' }]);
      const garbage = securityService(createMockStrapi({ publishGuard: () => 'nope' }));
      expect(await garbage.guard(job)).toEqual([]);
    });
  });

  it('treats a missing script as empty', () => {
    expect(securityService(createMockStrapi()).check(undefined)).toMatchObject({ enabled: true, passed: true });
  });

  it('returns a disabled, passing result when the check is turned off', () => {
    const service = securityService(createMockStrapi({ securityCheck: false }));
    expect(service.isEnabled()).toBe(false);
    expect(service.check('process.exit(1)')).toEqual({
      enabled: false,
      passed: true,
      errors: 0,
      warnings: 0,
      findings: [],
    });
  });

  it('lists rule metadata without implementation', () => {
    const rules = securityService(createMockStrapi()).listRules();
    expect(rules.length).toBeGreaterThan(10);
    expect(Object.keys(rules[0]).sort()).toEqual(['description', 'id', 'rationale', 'severity']);
  });
});
