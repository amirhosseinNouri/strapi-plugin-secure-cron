import { Core } from '@strapi/strapi';
import type { ContentFinding, CronJob, CronJobInputData, SecurityCheckResult } from '../../../types';
import { PLUGIN_ID } from '../../../utils/plugin';
import {
  emitAuditEvent,
  requestContext,
  type AuditAction,
  type RequestContext,
} from '../audit/events';
import { getPluginConfig } from '../config';
import { changedFields, describeScriptChange, hashScript } from '../audit/script-change';

const EDITABLE_FIELDS: Array<keyof CronJobInputData> = [
  'name',
  'schedule',
  'script',
  'iterationsLimit',
  'startDate',
  'endDate',
];

export const SECURITY_ERROR_NAME = 'SecurityCheckError';
export const PUBLISH_GUARD_ERROR_NAME = 'PublishGuardError';

type Operation = 'create' | 'update' | 'publish' | 'trigger';

const FIX_AND_RETRY: Partial<Record<Operation, string>> = {
  publish:
    'This cron job cannot be turned on because its script fails the security check. Fix the errors below in the script, save it, then turn the job on again.',
  trigger:
    'This cron job cannot run because its script fails the security check. Fix the errors below in the script, save it, then run it again.',
};

const sendSecurityError = (
  ctx: any,
  result: SecurityCheckResult,
  requiresAcknowledgement: boolean,
  operation: Operation
) => {
  ctx.status = 422;
  ctx.body = {
    data: null,
    error: {
      status: 422,
      name: SECURITY_ERROR_NAME,
      message: requiresAcknowledgement
        ? 'The script has security warnings that must be acknowledged before saving.'
        : (FIX_AND_RETRY[operation] ?? 'The script failed the security check.'),
      details: {
        requiresAcknowledgement,
        errors: result.errors,
        warnings: result.warnings,
        findings: result.findings,
      },
    },
  };
};

const GUARD_MESSAGES: Record<'publish' | 'trigger', string> = {
  publish:
    'This cron job cannot be turned on until the content it updates is fixed. Resolve the issues below, save the content or the script, then turn the job on again.',
  trigger:
    'This cron job cannot run until the content it updates is fixed. Resolve the issues below, save the content or the script, then run it again.',
};

const sendGuardError = (ctx: any, findings: ContentFinding[], operation: 'publish' | 'trigger') => {
  ctx.status = 422;
  ctx.body = {
    data: null,
    error: {
      status: 422,
      name: PUBLISH_GUARD_ERROR_NAME,
      message: GUARD_MESSAGES[operation],
      details: { contentFindings: findings },
    },
  };
};

export default ({ strapi }: { strapi: Core.Strapi }) => {
  const cronJobService = () => strapi.plugin(PLUGIN_ID).service('cron-job');
  const cronService = () => strapi.plugin(PLUGIN_ID).service('cron');
  const securityService = () => strapi.plugin(PLUGIN_ID).service('security');

  const audit = (
    action: AuditAction,
    context: RequestContext,
    cronJob: Partial<CronJob> | null,
    details?: Record<string, unknown>
  ) => emitAuditEvent(strapi, action, { context, cronJob, details });

  /**
   * Runs the security check for an operation. Errors always block; warnings block
   * only when `acknowledgeWarnings` is required and missing. Returns the check
   * result when the operation may continue, or null after responding with 422.
   */
  const vetScript = async (
    ctx: any,
    {
      script,
      operation,
      cronJob,
      requireAcknowledgement,
    }: {
      script: string | null | undefined;
      operation: Operation;
      cronJob: Partial<CronJob> | null;
      requireAcknowledgement: boolean;
    }
  ): Promise<SecurityCheckResult | null> => {
    const result: SecurityCheckResult = securityService().check(script);
    if (!result.enabled) return result;

    if (result.errors > 0) {
      await audit('blocked', requestContext(ctx), cronJob, {
        operation,
        scriptHash: hashScript(script),
        findings: result.findings,
      });
      sendSecurityError(ctx, result, false, operation);
      return null;
    }

    const acknowledged = ctx.request.body?.acknowledgeWarnings === true;
    if (requireAcknowledgement && result.warnings > 0 && !acknowledged) {
      sendSecurityError(ctx, result, true, operation);
      return null;
    }
    return result;
  };

  /**
   * Runs the project's publishGuard. Responds with 422 and returns null when it reports
   * errors; otherwise returns its warnings, which the caller passes back to the admin panel.
   */
  const vetContent = async (
    ctx: any,
    cronJob: CronJob,
    operation: 'publish' | 'trigger'
  ): Promise<ContentFinding[] | null> => {
    const findings: ContentFinding[] = await securityService().guard(cronJob);
    if (!findings.some((finding) => finding.severity === 'error')) return findings;
    await audit('blocked', requestContext(ctx), cronJob, {
      operation,
      reason: 'publish-guard',
      contentFindings: findings,
    });
    sendGuardError(ctx, findings, operation);
    return null;
  };

  const withContentWarnings = <T extends object>(body: T, warnings: ContentFinding[]) =>
    warnings.length ? { ...body, contentWarnings: warnings } : body;

  const loadOr404 = async (ctx: any): Promise<CronJob | null> => {
    const cronJob = await cronJobService().getOne(ctx.params.documentId);
    if (!cronJob) {
      ctx.notFound('Cron job not found');
      return null;
    }
    return cronJob;
  };

  return {
    async getAll(ctx: any) {
      ctx.body = await cronJobService().getAll();
    },

    async getOne(ctx: any) {
      const cronJob = await loadOr404(ctx);
      if (cronJob) ctx.body = cronJob;
    },

    async create(ctx: any) {
      const { errors, data } = cronService().validateData(ctx.request.body ?? {});
      if (errors) return ctx.badRequest('ValidationError', { errors });

      const check = await vetScript(ctx, {
        script: data.script,
        operation: 'create',
        cronJob: { name: data.name },
        requireAcknowledgement: true,
      });
      if (!check) return;

      const context = requestContext(ctx);
      const cronJob: CronJob = await cronJobService().create(data, ctx.state.user);

      await audit('create', context, cronJob, {
        fields: EDITABLE_FIELDS,
        scriptHash: hashScript(cronJob.script),
        schedule: cronJob.schedule,
      });
      if (check.warnings > 0) {
        await audit('warnings-acknowledged', context, cronJob, {
          operation: 'create',
          findings: check.findings,
        });
      }
      ctx.body = cronJob;
    },

    async update(ctx: any) {
      const existing = await loadOr404(ctx);
      if (!existing) return;

      const { errors, data } = cronService().validateData(ctx.request.body ?? {}, {
        isUpdate: true,
      });
      if (errors) return ctx.badRequest('ValidationError', { errors });

      const scriptChanged = data.script !== existing.script;
      const check = await vetScript(ctx, {
        script: data.script,
        operation: 'update',
        cronJob: existing,
        requireAcknowledgement: scriptChanged,
      });
      if (!check) return;

      const context = requestContext(ctx);
      const cronJob: CronJob = await cronJobService().update(
        existing.documentId,
        data,
        ctx.state.user
      );
      const rescheduled = existing.publicationDate
        ? await cronService().updateSchedule(cronJob)
        : false;

      await audit('update', context, cronJob, {
        changedFields: changedFields<CronJobInputData>(existing, data, EDITABLE_FIELDS),
        script: describeScriptChange(existing.script, cronJob.script),
        published: Boolean(existing.publicationDate),
        rescheduled,
      });
      if (scriptChanged && check.warnings > 0) {
        await audit('warnings-acknowledged', context, cronJob, {
          operation: 'update',
          findings: check.findings,
        });
      }
      ctx.body = cronJob;
    },

    async publish(ctx: any) {
      const existing = await loadOr404(ctx);
      if (!existing) return;

      const check = await vetScript(ctx, {
        script: existing.script,
        operation: 'publish',
        cronJob: existing,
        requireAcknowledgement: false,
      });
      if (!check) return;
      const warnings = await vetContent(ctx, existing, 'publish');
      if (!warnings) return;

      const cronJob: CronJob = await cronJobService().publish(existing.documentId, ctx.state.user);
      await audit('publish', requestContext(ctx), cronJob, {
        scriptHash: hashScript(cronJob.script),
        scheduled: cronService().isScheduled(cronJob),
        ...(warnings.length ? { contentWarnings: warnings } : {}),
      });
      ctx.body = withContentWarnings(cronJob, warnings);
    },

    async unpublish(ctx: any) {
      const existing = await loadOr404(ctx);
      if (!existing) return;

      const cronJob: CronJob = await cronJobService().unpublish(
        existing.documentId,
        ctx.state.user
      );
      await audit('unpublish', requestContext(ctx), cronJob);
      ctx.body = cronJob;
    },

    async delete(ctx: any) {
      const existing = await loadOr404(ctx);
      if (!existing) return;

      await cronJobService().delete(existing.documentId);
      await audit('delete', requestContext(ctx), existing, {
        scriptHash: hashScript(existing.script),
        wasPublished: Boolean(existing.publicationDate),
      });
      ctx.body = { documentId: existing.documentId };
    },

    async trigger(ctx: any) {
      const existing = await loadOr404(ctx);
      if (!existing) return;

      const check = await vetScript(ctx, {
        script: existing.script,
        operation: 'trigger',
        cronJob: existing,
        requireAcknowledgement: false,
      });
      if (!check) return;
      const warnings = await vetContent(ctx, existing, 'trigger');
      if (!warnings) return;

      const context = requestContext(ctx);
      await audit('trigger', context, existing, {
        scriptHash: hashScript(existing.script),
        ...(warnings.length ? { contentWarnings: warnings } : {}),
      });
      const result = await cronService().trigger(existing);
      await audit(result.success ? 'run.succeeded' : 'run.failed', context, existing, {
        manual: true,
        ...(result.error ? { error: result.error } : {}),
      });
      ctx.body = withContentWarnings(result, warnings);
    },

    async validateScript(ctx: any) {
      const script = ctx.request.body?.script;
      if (typeof script !== 'string') {
        return ctx.badRequest('ValidationError', {
          errors: [{ path: ['script'], message: 'script must be a string' }],
        });
      }
      ctx.body = securityService().check(script);
    },

    async settings(ctx: any) {
      const { securityCheck, syntaxHighlighting } = getPluginConfig(strapi);
      ctx.body = { securityCheck, syntaxHighlighting };
    },

    async rules(ctx: any) {
      ctx.body = securityService().listRules();
    },
  };
};
