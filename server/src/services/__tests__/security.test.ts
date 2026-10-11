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
