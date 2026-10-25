import { scheduledJobs } from 'node-schedule';
import { createMockStrapi } from '../../__tests__/mock-strapi';
import cronService from '../cron';
import securityService from '../security';

const tomorrow = () => new Date(Date.now() + 86400000).toISOString();
const yesterday = () => new Date(Date.now() - 86400000).toISOString();

const job = (overrides: Record<string, unknown> = {}): any => ({
  id: 1,
  documentId: `doc-${Math.random().toString(36).slice(2)}`,
  name: 'Job',
  schedule: '* * * * *',
  script: 'console.log("hi")',
  iterationsLimit: -1,
  iterationsCount: 0,
  startDate: yesterday(),
  endDate: tomorrow(),
  publicationDate: new Date().toISOString(),
  ...overrides,
});

const setup = (config: Record<string, unknown> = {}) => {
  const mock = createMockStrapi(config);
  const cronJob = { getPublished: jest.fn().mockResolvedValue([]), update: jest.fn() };
  mock.services['cron-job'] = cronJob;
  mock.services.security = securityService(mock);
  const service = cronService(mock);
  mock.services.cron = service;
  return { ...mock, service, cronJob };
};

afterEach(() => {
  for (const scheduled of Object.values(scheduledJobs)) scheduled.cancel();
});

describe('cron service scheduling', () => {
  it('schedules every published job on initialize', async () => {
    const { service, cronJob } = setup();
    const a = job();
    const b = job();
    cronJob.getPublished.mockResolvedValue([a, b]);
    await service.initialize();
    expect(service.isScheduled(a)).toBe(true);
    expect(service.isScheduled(b)).toBe(true);
  });

  it('does not schedule unpublished jobs and cancels existing schedules', async () => {
    const { service } = setup();
    const a = job();
    await service.updateSchedule(a);
    expect(service.isScheduled(a)).toBe(true);
    expect(await service.updateSchedule({ ...a, publicationDate: null })).toBe(false);
    expect(service.isScheduled(a)).toBe(false);
  });

  it('reschedules with the latest script when a job is updated', async () => {
    const { service } = setup();
    const a = job({ script: 'console.log("v1")' });
    await service.updateSchedule(a);
    const first = scheduledJobs[a.documentId];
    await service.updateSchedule({ ...a, script: 'console.log("v2")' });
    const second = scheduledJobs[a.documentId];
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
  });

  it('refuses to schedule scripts that fail the security check', async () => {
    const { service, strapi } = setup();
    const bad = job({ script: 'process.exit(1)' });
    expect(await service.updateSchedule(bad)).toBe(false);
    expect(service.isScheduled(bad)).toBe(false);
    expect(strapi.log.warn).toHaveBeenCalled();
    expect(strapi.eventHub.emit).toHaveBeenCalledWith(
      'strapi-plugin-cron.cron-job.run.failed',
      expect.objectContaining({ details: expect.objectContaining({ reason: 'security-check' }) })
    );
  });

  it('schedules dangerous scripts when the check is disabled', async () => {
    const { service } = setup({ securityCheck: false });
    const bad = job({ script: 'process.exit(1)' });
    expect(await service.updateSchedule(bad)).toBe(true);
  });

  it('returns false when node-schedule rejects the window', async () => {
    const { service } = setup();
    const expired = job({ startDate: yesterday(), endDate: yesterday() });
    expect(await service.updateSchedule(expired)).toBe(false);
  });

  it('cancelAll only cancels jobs it scheduled', async () => {
    const { service } = setup();
    const { scheduleJob } = jest.requireActual('node-schedule');
    const foreign = scheduleJob('foreign-job', '* * * * *', () => {});
    const own = job();
    await service.updateSchedule(own);
    service.cancelAll();
    expect(service.isScheduled(own)).toBe(false);
    expect(scheduledJobs['foreign-job']).toBe(foreign);
  });
});

describe('cron service validation', () => {
  it('returns parsed data for valid input', () => {
    const { service } = setup();
    const { errors, data } = service.validateData({
      name: 'n',
      schedule: '* * * * *',
      script: 'x',
      iterationsLimit: -1,
      startDate: new Date().toISOString(),
      endDate: tomorrow(),
      extra: 'stripped',
    } as any);
    expect(errors).toBeNull();
    expect(data).not.toHaveProperty('extra');
    expect(data.startDate).toBeInstanceOf(Date);
  });

  it('returns issues for invalid input', () => {
    const { errors, data } = setup().service.validateData({} as any);
    expect(data).toBeNull();
    expect(errors.map((issue: any) => issue.path[0])).toEqual(
      expect.arrayContaining(['name', 'schedule', 'script', 'iterationsLimit', 'startDate', 'endDate'])
    );
  });

  it('allows past start dates only on update', () => {
    const { service } = setup();
    const input: any = {
      name: 'n',
      schedule: '* * * * *',
      script: 'x',
      iterationsLimit: -1,
      startDate: yesterday(),
      endDate: tomorrow(),
    };
    expect(service.validateData(input).errors).not.toBeNull();
    expect(service.validateData(input, { isUpdate: true }).errors).toBeNull();
  });

  it('rejects blank scripts and end dates before start dates', () => {
    const { service } = setup();
    const { errors } = service.validateData({
      name: 'n',
      schedule: '* * * * *',
      script: '   ',
      iterationsLimit: -1,
      startDate: new Date(Date.now() + 3 * 86400000).toISOString(),
      endDate: tomorrow(),
    } as any);
    expect(errors.map((issue: any) => issue.path[0]).sort()).toEqual(['endDate', 'script']);
  });
});

describe('cron service execution', () => {
  it('triggers a run, stores the log and reports success', async () => {
    const { service, cronJob } = setup();
    const a = job({ script: 'console.log("ran", cronJob.name)' });
    const result = await service.trigger(a);
    expect(result.success).toBe(true);
    expect(result.logs[1]).toEqual(['ran', 'Job']);
    expect(cronJob.update).toHaveBeenCalledWith(a.documentId, { latestExecutionLog: result.logs });
  });

  it('gives scripts the full strapi object without allowedContentTypes, and a scoped one with it', async () => {
    const open = setup({ securityCheck: false });
    expect(await open.service.trigger(job({ script: 'if (!strapi.eventHub) throw new Error("not the full object")' }))).toMatchObject({
      success: true,
    });

    const scoped = setup({ securityCheck: false, allowedContentTypes: ['api::landing.landing'] });
    expect(await scoped.service.trigger(job({ script: 'if (strapi.eventHub || strapi.db) throw new Error("internals leaked")' }))).toMatchObject({
      success: true,
    });
    expect(
      await scoped.service.trigger(job({ script: "const k = ['plugin::strapi-plugin-cron', 'cron-job'].join('.'); strapi.documents(k)" }))
    ).toMatchObject({ success: false, error: expect.stringMatching(/is not allowed/) });
    await scoped.service.trigger(job({ script: "strapi.documents('api::landing.landing')" }));
    expect(scoped.strapi.documents).toHaveBeenCalledWith('api::landing.landing');
  });

  it('reports failures with the error message', async () => {
    const { service, strapi } = setup();
    const result = await service.trigger(job({ script: 'throw new Error("kaput")' }));
    expect(result).toMatchObject({ success: false, error: 'kaput' });
    expect(result.logs.some((line) => line[0] === '[error]')).toBe(true);
    expect(strapi.log.error).toHaveBeenCalled();
  });

  it('handles non-error throws and missing scripts', async () => {
    const { service } = setup();
    expect(await service.trigger(job({ script: 'throw "plain"' }))).toMatchObject({ success: false, error: 'plain' });
    expect(await service.trigger(job({ script: undefined }))).toMatchObject({ success: true });
  });

  it('runs on schedule, counts iterations and stops at the limit', async () => {
    const { service, cronJob } = setup();
    const a = job({ iterationsLimit: 1 });
    await service.updateSchedule(a);
    const scheduled = scheduledJobs[a.documentId];
    await (scheduled as any).job();
    expect(cronJob.update).toHaveBeenCalledWith(a.documentId, {
      latestExecutionLog: expect.any(Array),
      iterationsCount: 1,
    });
    await (scheduled as any).job();
    expect(cronJob.update).toHaveBeenCalledTimes(1);
    expect(service.isScheduled(a)).toBe(false);
  });

  it('emits run.failed when a scheduled run throws', async () => {
    const { service, strapi } = setup();
    const a = job({ script: 'throw new Error("scheduled boom")' });
    await service.updateSchedule(a);
    await (scheduledJobs[a.documentId] as any).job();
    expect(strapi.eventHub.emit).toHaveBeenCalledWith(
      'strapi-plugin-cron.cron-job.run.failed',
      expect.objectContaining({
        user: null,
        details: expect.objectContaining({ manual: false, iteration: 1, error: 'scheduled boom' }),
      })
    );
  });

  it('logs instead of crashing when storing the result fails', async () => {
    const { service, cronJob, strapi } = setup();
    cronJob.update.mockRejectedValueOnce(new Error('db'));
    const a = job();
    await service.updateSchedule(a);
    await expect((scheduledJobs[a.documentId] as any).job()).resolves.toBeUndefined();
    expect(strapi.log.error).toHaveBeenCalledWith(expect.stringContaining('crashed'), expect.any(Error));
  });

  it('forwards script console output to the strapi logger with levels', async () => {
    const { service, strapi } = setup();
    await service.trigger(job({ script: 'console.warn("w"); console.debug("d"); console.info("i")' }));
    expect(strapi.log.warn).toHaveBeenCalledWith(expect.stringContaining('Job: w'));
    expect(strapi.log.debug).toHaveBeenCalledWith(expect.stringContaining('Job: d'));
    expect(strapi.log.info).toHaveBeenCalledWith(expect.stringContaining('Job: i'));
  });
});
