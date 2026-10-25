import { useFetchClient } from '@strapi/strapi/admin';
import { useMemo } from 'react';
import type {
  ContentFinding,
  CronJob,
  CronJobInputData,
  PluginSettings,
  SecurityCheckResult,
  TriggerResult,
} from '../../../types';
import { PLUGIN_ID } from '../../../utils/plugin';

export type ApiErrorDetails = {
  errors?: Array<{ path: string[]; message: string }>;
  requiresAcknowledgement?: boolean;
  findings?: SecurityCheckResult['findings'];
  contentFindings?: ContentFinding[];
  [key: string]: unknown;
};

export class ApiError extends Error {
  status: number | undefined;
  details: ApiErrorDetails;

  constructor(name: string, message: string, status?: number, details: ApiErrorDetails = {}) {
    super(message);
    this.name = name;
    this.status = status;
    this.details = details;
  }
}

/** Normalises Strapi error payloads ({ error: { name, message, details } }) into ApiError. */
export const toApiError = (error: any): ApiError => {
  const payload = error?.response?.data?.error;
  if (payload) {
    // ctx.badRequest('ValidationError', details) puts the name in `message`.
    const name = payload.message === 'ValidationError' ? 'ValidationError' : payload.name;
    return new ApiError(name, payload.message, payload.status, payload.details ?? {});
  }
  return new ApiError('Error', error?.message ?? 'Unexpected error', error?.status);
};

const base = `/${PLUGIN_ID}`;

export type CronJobPayload = CronJobInputData & { acknowledgeWarnings?: boolean };

export const useCronApi = () => {
  const { get, post, put, del } = useFetchClient();

  return useMemo(() => {
    const call = async <T>(request: Promise<{ data: T }>): Promise<T> => {
      try {
        const { data } = await request;
        return data;
      } catch (error) {
        throw toApiError(error);
      }
    };

    return {
      getSettings: () => call<PluginSettings>(get(`${base}/settings`)),
      getAllCronJobs: () => call<CronJob[]>(get(`${base}/cron-jobs`)),
      getCronJob: (documentId: string) => call<CronJob>(get(`${base}/cron-jobs/${documentId}`)),
      createNewCronJob: (data: CronJobPayload) => call<CronJob>(post(`${base}/cron-jobs`, data)),
      updateCronJob: ({ documentId, data }: { documentId: string; data: CronJobPayload }) =>
        call<CronJob>(put(`${base}/cron-jobs/${documentId}`, data)),
      publishCronJob: (documentId: string) =>
        call<CronJob>(put(`${base}/cron-jobs/publish/${documentId}`)),
      unpublishCronJob: (documentId: string) =>
        call<CronJob>(put(`${base}/cron-jobs/unpublish/${documentId}`)),
      deleteCronJob: (documentId: string) => call(del(`${base}/cron-jobs/${documentId}`)),
      triggerCronJob: (documentId: string) =>
        call<TriggerResult>(post(`${base}/cron-jobs/trigger/${documentId}`)),
      validateScript: (script: string) =>
        call<SecurityCheckResult>(post(`${base}/cron-jobs/validate-script`, { script })),
    };
  }, [get, post, put, del]);
};

export type CronApi = ReturnType<typeof useCronApi>;
