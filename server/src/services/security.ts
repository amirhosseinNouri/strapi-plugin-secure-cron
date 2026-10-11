import type { Core } from '@strapi/strapi';
import type { SecurityCheckResult } from '../../../types';
import { getPluginConfig } from '../config';
import { checkScript, rules } from '../security';

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  isEnabled(): boolean {
    return getPluginConfig(strapi).securityCheck;
  },

  check(script: string | null | undefined): SecurityCheckResult {
    if (!this.isEnabled()) {
      return { enabled: false, passed: true, errors: 0, warnings: 0, findings: [] };
    }
    const { allowedNetworkOrigins, scratchDirectory } = getPluginConfig(strapi);
    return { enabled: true, ...checkScript(script ?? '', rules, { allowedNetworkOrigins, scratchDirectory }) };
  },

  listRules() {
    return rules.map(({ id, severity, description, rationale }) => ({
      id,
      severity,
      description,
      rationale,
    }));
  },
});
