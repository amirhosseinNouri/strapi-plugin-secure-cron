import { Core } from '@strapi/strapi';
import type { CronJob, CronJobInputData, SecurityCheckResult } from '../../../types';
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

const sendSecurityError = (
  ctx: any,
  result: SecurityCheckResult,
  requiresAcknowledgement: boolean
) => {
  ctx.status = 422;
  ctx.body = {
    data: null,
    error: {
      status: 422,
      name: SECURITY_ERROR_NAME,
      message: requiresAcknowledgement
        ? 'The script has security warnings that must be acknowledged before saving.'
        : 'The script failed the security check.',
      details: {
        requiresAcknowledgement,
        errors: result.errors,
        warnings: result.warnings,
        findings: result.findings,
      },
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
      operation: 'create' | 'update' | 'publish' | 'trigger';
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
      sendSecurityError(ctx, result, false);
      return null;
    }

    const acknowledged = ctx.request.body?.acknowledgeWarnings === true;
    if (requireAcknowledgement && result.warnings > 0 && !acknowledged) {
      sendSecurityError(ctx, result, true);
      return null;
    }
    return result;
  };

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

      const cronJob: CronJob = await cronJobService().publish(existing.documentId, ctx.state.user);
      await audit('publish', requestContext(ctx), cronJob, {
        scriptHash: hashScript(cronJob.script),
        scheduled: cronService().isScheduled(cronJob),
      });
      ctx.body = cronJob;
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

      const context = requestContext(ctx);
      await audit('trigger', context, existing, { scriptHash: hashScript(existing.script) });
      const result = await cronService().trigger(existing);
      await audit(result.success ? 'run.succeeded' : 'run.failed', context, existing, {
        manual: true,
        ...(result.error ? { error: result.error } : {}),
      });
      ctx.body = result;
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
