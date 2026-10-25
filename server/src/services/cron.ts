import type { Core } from '@strapi/strapi';
import { scheduleJob, scheduledJobs } from 'node-schedule';
import { CronJob, CronJobInputData, TriggerResult } from '../../../types';
import { PLUGIN_ID } from '../../../utils/plugin';
import { emitAuditEvent, SYSTEM_CONTEXT } from '../audit/events';
import { getPluginConfig } from '../config';
import { createScopedConsole, createScopedStrapi, runScript, type ScopedConsole } from '../utils';
import { createCronJobSchema } from './cron-job/schema';

const LOG_LEVELS: Record<keyof ScopedConsole, 'info' | 'warn' | 'error' | 'debug'> = {
  log: 'info',
  info: 'info',
  warn: 'warn',
  error: 'error',
  debug: 'debug',
};

export default ({ strapi }: { strapi: Core.Strapi }) => {
  // node-schedule keeps a process-wide registry; track our own job names so
  // shutdown never cancels jobs that belong to other code.
  const ownJobs = new Set<string>();

  const cronJobService = () => strapi.plugin(PLUGIN_ID).service('cron-job');
  const securityService = () => strapi.plugin(PLUGIN_ID).service('security');

  const execute = async (cronJob: CronJob): Promise<TriggerResult> => {
    const { lines, console } = createScopedConsole((level, line) =>
      strapi.log[LOG_LEVELS[level]](`[${PLUGIN_ID}] ${cronJob.name}: ${line}`)
    );
    console.log(`-- ${new Date().toLocaleString()}`);
    try {
      const { allowedContentTypes } = getPluginConfig(strapi);
      const scriptStrapi = allowedContentTypes ? createScopedStrapi(strapi, allowedContentTypes) : strapi;
      await runScript(cronJob.script ?? '', { strapi: scriptStrapi, cronJob, console });
      return { success: true, logs: lines };
    } catch (error: any) {
      console.error(error);
      return { success: false, logs: lines, error: error?.message ?? String(error) };
    }
  };

  const createScheduledCallback = (cronJob: CronJob) => async () => {
    try {
      const hasIterationsLimit = cronJob.iterationsLimit > -1;
      if (hasIterationsLimit && cronJob.iterationsCount >= cronJob.iterationsLimit) {
        scheduledJobs[cronJob.documentId]?.cancel();
        return;
      }
      cronJob.iterationsCount += 1;
      const result = await execute(cronJob);
      await cronJobService().update(cronJob.documentId, {
        latestExecutionLog: result.logs,
        iterationsCount: cronJob.iterationsCount,
      });
      if (!result.success) {
        await emitAuditEvent(strapi, 'run.failed', {
          context: SYSTEM_CONTEXT,
          cronJob,
          details: { manual: false, iteration: cronJob.iterationsCount, error: result.error },
        });
      }
    } catch (error) {
      strapi.log.error(`[${PLUGIN_ID}] scheduled run of "${cronJob.name}" crashed`, error);
    }
  };

  return {
    async initialize() {
      const published: CronJob[] = await cronJobService().getPublished();
      for (const cronJob of published) await this.updateSchedule(cronJob);
    },

    /**
     * (Re)schedules a cron job from its current state. Always cancels the previous
     * schedule first, so an edited script never keeps running in its old form.
     * Returns true when the job is now scheduled.
     */
    async updateSchedule(cronJob: CronJob): Promise<boolean> {
      this.cancel(cronJob);
      if (!cronJob.publicationDate) return false;

      const check = securityService().check(cronJob.script);
      if (!check.passed) {
        strapi.log.warn(
          `[${PLUGIN_ID}] "${cronJob.name}" was not scheduled: its script fails the security check`
        );
        await emitAuditEvent(strapi, 'run.failed', {
          context: SYSTEM_CONTEXT,
          cronJob,
          details: { manual: false, reason: 'security-check', findings: check.findings },
        });
        return false;
      }

      const job = scheduleJob(
        cronJob.documentId,
        { start: cronJob.startDate, end: cronJob.endDate, rule: cronJob.schedule } as any,
        createScheduledCallback(cronJob)
      );
      if (job) ownJobs.add(cronJob.documentId);
      return Boolean(job);
    },

    validateData(data: CronJobInputData, { isUpdate = false }: { isUpdate?: boolean } = {}) {
      const validation = createCronJobSchema({ isUpdate }).safeParse(data);
      if (!validation.success) return { errors: validation.error.issues, data: null };
      return { errors: null, data: validation.data };
    },

    cancel(cronJob: Pick<CronJob, 'documentId'>) {
      scheduledJobs[cronJob.documentId]?.cancel();
      ownJobs.delete(cronJob.documentId);
    },

    cancelAll() {
      for (const documentId of [...ownJobs]) this.cancel({ documentId });
    },

    isScheduled(cronJob: Pick<CronJob, 'documentId'>) {
      return Boolean(scheduledJobs[cronJob.documentId]);
    },

    /** Runs the script once, outside its schedule, and stores the execution log. */
    async trigger(cronJob: CronJob): Promise<TriggerResult> {
      const result = await execute(cronJob);
      await cronJobService().update(cronJob.documentId, { latestExecutionLog: result.logs });
      return result;
    },
  };
};
