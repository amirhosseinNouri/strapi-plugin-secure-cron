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
    const { securityCheck, publishGuard, publishGuardMode } = getPluginConfig(strapi);
    if (!securityCheck || !publishGuard) return [];
    let findings: ContentFinding[];
    try {
      const result = await publishGuard({ strapi, cronJob });
      findings = Array.isArray(result) ? result : [];
    } catch (error: any) {
      // A broken guard always blocks, even in 'warn' mode: its findings are unknown.
      return [{ severity: 'error', message: `The publish guard failed: ${error?.message ?? String(error)}` }];
    }
    return publishGuardMode === 'warn'
      ? findings.map((finding) => ({ ...finding, severity: 'warning' as const }))
      : findings;
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
