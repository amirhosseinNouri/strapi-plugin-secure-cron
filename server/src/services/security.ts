import type { Core } from '@strapi/strapi';
import type { ContentFinding, CronJob, SecurityCheckResult } from '../../../types';
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
    const { allowedNetworkOrigins, scratchDirectory, markdownFields, allowedContentTypes } = getPluginConfig(strapi);
    return {
      enabled: true,
      ...checkScript(script ?? '', rules, {
        allowedNetworkOrigins,
        scratchDirectory,
        markdownFields,
        allowedContentTypes,
      }),
    };
  },

  /**
   * Runs the configured publishGuard before a job is turned on or test-run. A guard
   * that throws fails closed, so a broken guard never lets a job through.
   */
  async guard(cronJob: CronJob): Promise<ContentFinding[]> {
    const { securityCheck, publishGuard } = getPluginConfig(strapi);
    if (!securityCheck || !publishGuard) return [];
    try {
      const findings = await publishGuard({ strapi, cronJob });
      return Array.isArray(findings) ? findings : [];
    } catch (error: any) {
      return [{ severity: 'error', message: `The publish guard failed: ${error?.message ?? String(error)}` }];
    }
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
