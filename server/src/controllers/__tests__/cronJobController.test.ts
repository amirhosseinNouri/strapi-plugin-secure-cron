import { createCtx, createMockStrapi } from '../../__tests__/mock-strapi';
import securityService from '../../services/security';
import controllerFactory, { PUBLISH_GUARD_ERROR_NAME, SECURITY_ERROR_NAME } from '../cronJobController';

const tomorrow = () => new Date(Date.now() + 86400000).toISOString();

const validInput = (overrides: Record<string, unknown> = {}) => ({
  name: 'Nightly',
  schedule: '0 3 * * *',
  script: 'console.log("ok")',
  iterationsLimit: -1,
  startDate: new Date().toISOString(),
  endDate: tomorrow(),
  ...overrides,
});

const existingJob = (overrides: Record<string, unknown> = {}): any => ({
  id: 1,
  documentId: 'abc',
  ...validInput(),
  iterationsCount: 0,
  publicationDate: null,
  ...overrides,
});

const setup = (config: Record<string, unknown> = {}) => {
  const mock = createMockStrapi(config);
  const cronJob = {
    getAll: jest.fn().mockResolvedValue([]),
    getOne: jest.fn(),
    create: jest.fn(async (data) => ({ id: 1, documentId: 'new', ...data })),
    update: jest.fn(async (documentId, data) => ({ ...existingJob(), documentId, ...data })),
    publish: jest.fn(async (documentId) => existingJob({ documentId, publicationDate: 'now' })),
    unpublish: jest.fn(async (documentId) => existingJob({ documentId })),
    delete: jest.fn(),
  };
  const cron = {
    validateData: jest.fn(),
    updateSchedule: jest.fn().mockResolvedValue(true),
    isScheduled: jest.fn().mockReturnValue(true),
    trigger: jest.fn().mockResolvedValue({ success: true, logs: [['ok']] }),
  };
  // Use the real validator.
  const realCron = require('../../services/cron').default(mock);
  cron.validateData.mockImplementation(realCron.validateData);
  mock.services['cron-job'] = cronJob;
  mock.services.cron = cron;
  mock.services.security = securityService(mock);
  const controller = controllerFactory(mock);
  const events = () => mock.strapi.eventHub.emit.mock.calls.map(([name]: [string]) => name.replace('strapi-plugin-cron.cron-job.', ''));
  const payload = (action: string) =>
    mock.strapi.eventHub.emit.mock.calls.find(([name]: [string]) => name.endsWith(`.${action}`))?.[1];
  return { ...mock, controller, cronJob, cron, events, payload };
};

describe('read endpoints', () => {
  it('lists jobs', async () => {
    const { controller, cronJob } = setup();
    cronJob.getAll.mockResolvedValue([existingJob()]);
    const ctx = createCtx();
    await controller.getAll(ctx);
    expect(ctx.body).toHaveLength(1);
  });

  it('returns one job or 404', async () => {
    const { controller, cronJob } = setup();
    cronJob.getOne.mockResolvedValueOnce(existingJob());
    const ctx = createCtx({ params: { documentId: 'abc' } });
    await controller.getOne(ctx);
    expect(ctx.body.documentId).toBe('abc');

    cronJob.getOne.mockResolvedValueOnce(null);
    const missing = createCtx({ params: { documentId: 'nope' } });
    await controller.getOne(missing);
    expect(missing.status).toBe(404);
  });

  it('exposes settings and rules', async () => {
    const { controller } = setup({ syntaxHighlighting: false });
    const ctx = createCtx();
    await controller.settings(ctx);
    expect(ctx.body).toEqual({ securityCheck: true, syntaxHighlighting: false });
    await controller.rules(ctx);
    expect(ctx.body.length).toBeGreaterThan(10);
  });
});

describe('create', () => {
  it('creates a job with the current user and emits create', async () => {
    const { controller, cronJob, events, payload } = setup();
    const ctx = createCtx({ body: validInput({ id: 99, createdBy: 1 }) });
    await controller.create(ctx);
    expect(ctx.status).toBe(200);
    const [data, user] = cronJob.create.mock.calls[0] as any[];
    expect(data).not.toHaveProperty('id');
    expect(data).not.toHaveProperty('createdBy');
    expect(user.id).toBe(7);
    expect(events()).toEqual(['create']);
    expect(payload('create')).toMatchObject({
      user: { id: 7, email: 'ada@example.com' },
      ipAddress: '10.0.0.1',
      entity: { id: 'new', displayName: 'Nightly' },
      details: { scriptHash: expect.any(String), schedule: '0 3 * * *' },
    });
  });

  it('returns validation errors', async () => {
    const { controller, cronJob } = setup();
    const ctx = createCtx({ body: validInput({ name: '' }) });
    await controller.create(ctx);
    expect(ctx.badRequest).toHaveBeenCalledWith('ValidationError', expect.anything());
    expect(cronJob.create).not.toHaveBeenCalled();
  });

  it('handles a missing body', async () => {
    const { controller } = setup();
    const ctx = createCtx({ body: undefined });
    await controller.create(ctx);
    expect(ctx.status).toBe(400);
  });

  it('blocks scripts with security errors and audits the attempt', async () => {
    const { controller, cronJob, events, payload } = setup();
    const ctx = createCtx({ body: validInput({ script: "require('child_process').exec('id')" }) });
    await controller.create(ctx);
    expect(ctx.status).toBe(422);
    expect(ctx.body.error).toMatchObject({
      name: SECURITY_ERROR_NAME,
      details: { requiresAcknowledgement: false, errors: expect.any(Number) },
    });
    expect(cronJob.create).not.toHaveBeenCalled();
    expect(events()).toEqual(['blocked']);
    expect(payload('blocked').details).toMatchObject({ operation: 'create', findings: expect.any(Array) });
    expect(payload('blocked').entity.displayName).toBe('Nightly');
  });

  it('requires acknowledgement for warnings', async () => {
    const { controller, cronJob, events } = setup();
    const ctx = createCtx({ body: validInput({ script: "await fetch('https://hooks.example')" }) });
    await controller.create(ctx);
    expect(ctx.status).toBe(422);
    expect(ctx.body.error.details.requiresAcknowledgement).toBe(true);
    expect(cronJob.create).not.toHaveBeenCalled();
    expect(events()).toEqual([]);
  });

  it('saves acknowledged warnings and audits the acknowledgement', async () => {
    const { controller, cronJob, events, payload } = setup();
    const ctx = createCtx({
      body: validInput({ script: "await fetch('https://hooks.example')", acknowledgeWarnings: true }),
    });
    await controller.create(ctx);
    expect(ctx.status).toBe(200);
    expect(cronJob.create.mock.calls[0][0]).not.toHaveProperty('acknowledgeWarnings');
    expect(events()).toEqual(['create', 'warnings-acknowledged']);
    expect(payload('warnings-acknowledged').details.findings[0].ruleId).toBe('no-network-calls');
  });

  it('skips the check entirely when disabled', async () => {
    const { controller, cronJob } = setup({ securityCheck: false });
    const ctx = createCtx({ body: validInput({ script: 'process.exit(1)' }) });
    await controller.create(ctx);
    expect(ctx.status).toBe(200);
    expect(cronJob.create).toHaveBeenCalled();
  });
});

describe('update', () => {
  it('404s for unknown jobs', async () => {
    const { controller, cronJob } = setup();
    cronJob.getOne.mockResolvedValue(null);
    const ctx = createCtx({ params: { documentId: 'x' }, body: validInput() });
    await controller.update(ctx);
    expect(ctx.status).toBe(404);
  });

  it('validates input', async () => {
    const { controller, cronJob } = setup();
    cronJob.getOne.mockResolvedValue(existingJob());
    const ctx = createCtx({ params: { documentId: 'abc' }, body: { name: '' } });
    await controller.update(ctx);
    expect(ctx.status).toBe(400);
    const empty = createCtx({ params: { documentId: 'abc' }, body: undefined });
    await controller.update(empty);
    expect(empty.status).toBe(400);
  });

  it('updates with the current user, reschedules published jobs and audits a diff', async () => {
    const { controller, cronJob, cron, events, payload } = setup();
    cronJob.getOne.mockResolvedValue(existingJob({ publicationDate: 'yesterday', script: 'console.log(1)' }));
    const ctx = createCtx({
      params: { documentId: 'abc' },
      body: validInput({ script: 'console.log(2)', name: 'Renamed' }),
    });
    await controller.update(ctx);
    expect(ctx.status).toBe(200);
    expect((cronJob.update.mock.calls[0] as any[])[2].id).toBe(7);
    expect(cron.updateSchedule).toHaveBeenCalled();
    expect(events()).toEqual(['update']);
    expect(payload('update').details).toMatchObject({
      changedFields: expect.arrayContaining(['name', 'script']),
      published: true,
      rescheduled: true,
      script: { diff: expect.stringContaining('+console.log(2)') },
    });
  });

  it('does not reschedule drafts', async () => {
    const { controller, cronJob, cron, payload } = setup();
    cronJob.getOne.mockResolvedValue(existingJob());
    const ctx = createCtx({ params: { documentId: 'abc' }, body: validInput({ name: 'x' }) });
    await controller.update(ctx);
    expect(cron.updateSchedule).not.toHaveBeenCalled();
    expect(payload('update').details).toMatchObject({ rescheduled: false, script: null });
  });

  it('allows past start dates for existing jobs', async () => {
    const { controller, cronJob } = setup();
    cronJob.getOne.mockResolvedValue(existingJob());
    const ctx = createCtx({
      params: { documentId: 'abc' },
      body: validInput({ startDate: new Date(Date.now() - 5 * 86400000).toISOString() }),
    });
    await controller.update(ctx);
    expect(ctx.status).toBe(200);
  });

  it('blocks a script change that fails the check', async () => {
    const { controller, cronJob, events } = setup();
    cronJob.getOne.mockResolvedValue(existingJob());
    const ctx = createCtx({ params: { documentId: 'abc' }, body: validInput({ script: 'eval(x)' }) });
    await controller.update(ctx);
    expect(ctx.status).toBe(422);
    expect(cronJob.update).not.toHaveBeenCalled();
    expect(events()).toEqual(['blocked']);
  });

  it('only requires acknowledgement when the script changes', async () => {
    const { controller, cronJob, events } = setup();
    const warned = "await fetch('https://x')";
    cronJob.getOne.mockResolvedValue(existingJob({ script: warned }));
    const unchanged = createCtx({ params: { documentId: 'abc' }, body: validInput({ script: warned, name: 'y' }) });
    await controller.update(unchanged);
    expect(unchanged.status).toBe(200);
    expect(events()).toEqual(['update']);

    const changed = createCtx({
      params: { documentId: 'abc' },
      body: validInput({ script: `${warned};\nconsole.log(1)` }),
    });
    await controller.update(changed);
    expect(changed.status).toBe(422);

    const acknowledged = createCtx({
      params: { documentId: 'abc' },
      body: validInput({ script: `${warned};\nconsole.log(1)`, acknowledgeWarnings: true }),
    });
    await controller.update(acknowledged);
    expect(acknowledged.status).toBe(200);
    expect(events()).toEqual(['update', 'update', 'warnings-acknowledged']);
  });
});

describe('publish / unpublish / delete', () => {
  it('publishes after a passing check', async () => {
    const { controller, cronJob, events, payload } = setup();
    cronJob.getOne.mockResolvedValue(existingJob());
    const ctx = createCtx({ params: { documentId: 'abc' } });
    await controller.publish(ctx);
    expect(cronJob.publish).toHaveBeenCalledWith('abc', expect.objectContaining({ id: 7 }));
    expect(events()).toEqual(['publish']);
    expect(payload('publish').details.scheduled).toBe(true);
  });

  it('refuses to publish a script that fails the check', async () => {
    const { controller, cronJob, events } = setup();
    cronJob.getOne.mockResolvedValue(existingJob({ script: 'process.exit()' }));
    const ctx = createCtx({ params: { documentId: 'abc' } });
    await controller.publish(ctx);
    expect(ctx.status).toBe(422);
    expect(ctx.body.error.message).toMatch(/cannot be turned on.*Fix the errors below in the script, save it, then turn the job on again/);
    expect(cronJob.publish).not.toHaveBeenCalled();
    expect(events()).toEqual(['blocked']);
  });

  it('refuses to publish or run a job when the publish guard reports errors', async () => {
    const contentFindings = [
      { severity: 'error', message: 'food/home: 12 Tables blocks contain non-table HTML.', link: '/admin/x' },
    ];
    const publishGuard = jest.fn(async () => contentFindings);
    const { controller, cronJob, cron, events, payload } = setup({ publishGuard });
    cronJob.getOne.mockResolvedValue(existingJob());

    const ctx = createCtx({ params: { documentId: 'abc' } });
    await controller.publish(ctx);
    expect(ctx.status).toBe(422);
    expect(ctx.body.error).toMatchObject({
      name: PUBLISH_GUARD_ERROR_NAME,
      message: expect.stringMatching(/cannot be turned on until the content it updates is fixed/),
      details: { contentFindings },
    });
    expect(cronJob.publish).not.toHaveBeenCalled();
    expect(events()).toEqual(['blocked']);
    expect(payload('blocked').details).toMatchObject({ operation: 'publish', reason: 'publish-guard', contentFindings });

    const run = createCtx({ params: { documentId: 'abc' } });
    await controller.trigger(run);
    expect(run.status).toBe(422);
    expect(run.body.error.message).toMatch(/cannot run until/);
    expect(cron.trigger).not.toHaveBeenCalled();
  });

  it('publishes when the publish guard only reports warnings', async () => {
    const publishGuard = jest.fn(() => [{ severity: 'warning' as const, message: 'heads up' }]);
    const { controller, cronJob } = setup({ publishGuard });
    cronJob.getOne.mockResolvedValue(existingJob());
    const ctx = createCtx({ params: { documentId: 'abc' } });
    await controller.publish(ctx);
    expect(cronJob.publish).toHaveBeenCalled();
  });

  it('skips the publish guard when the script itself fails', async () => {
    const publishGuard = jest.fn(() => []);
    const { controller, cronJob } = setup({ publishGuard });
    cronJob.getOne.mockResolvedValue(existingJob({ script: "const FEED = 'http://10.0.0.1/feed';" }));
    const ctx = createCtx({ params: { documentId: 'abc' } });
    await controller.publish(ctx);
    expect(ctx.body.error.name).toBe(SECURITY_ERROR_NAME);
    expect(ctx.body.error.details.findings[0].ruleId).toBe('no-insecure-transport');
    expect(publishGuard).not.toHaveBeenCalled();
  });

  it('publishes scripts with warnings without new acknowledgement', async () => {
    const { controller, cronJob } = setup();
    cronJob.getOne.mockResolvedValue(existingJob({ script: "await fetch('https://x')" }));
    const ctx = createCtx({ params: { documentId: 'abc' } });
    await controller.publish(ctx);
    expect(cronJob.publish).toHaveBeenCalled();
  });

  it('unpublishes', async () => {
    const { controller, cronJob, events } = setup();
    cronJob.getOne.mockResolvedValue(existingJob({ publicationDate: 'x' }));
    const ctx = createCtx({ params: { documentId: 'abc' } });
    await controller.unpublish(ctx);
    expect(cronJob.unpublish).toHaveBeenCalledWith('abc', expect.objectContaining({ id: 7 }));
    expect(events()).toEqual(['unpublish']);
  });

  it('deletes and audits the removed script hash', async () => {
    const { controller, cronJob, events, payload } = setup();
    cronJob.getOne.mockResolvedValue(existingJob({ publicationDate: 'x' }));
    const ctx = createCtx({ params: { documentId: 'abc' } });
    await controller.delete(ctx);
    expect(cronJob.delete).toHaveBeenCalledWith('abc');
    expect(ctx.body).toEqual({ documentId: 'abc' });
    expect(events()).toEqual(['delete']);
    expect(payload('delete').details).toMatchObject({ wasPublished: true, scriptHash: expect.any(String) });
  });

  it.each(['publish', 'unpublish', 'delete', 'trigger'] as const)('%s 404s for unknown jobs', async (action) => {
    const { controller, cronJob } = setup();
    cronJob.getOne.mockResolvedValue(null);
    const ctx = createCtx({ params: { documentId: 'x' } });
    await controller[action](ctx);
    expect(ctx.status).toBe(404);
  });
});

describe('trigger', () => {
  it('runs the job and audits trigger + success', async () => {
    const { controller, cronJob, cron, events } = setup();
    cronJob.getOne.mockResolvedValue(existingJob());
    const ctx = createCtx({ params: { documentId: 'abc' } });
    await controller.trigger(ctx);
    expect(cron.trigger).toHaveBeenCalled();
    expect(ctx.body).toEqual({ success: true, logs: [['ok']] });
    expect(events()).toEqual(['trigger', 'run.succeeded']);
  });

  it('audits failed manual runs with the error', async () => {
    const { controller, cronJob, cron, payload } = setup();
    cronJob.getOne.mockResolvedValue(existingJob());
    cron.trigger.mockResolvedValue({ success: false, logs: [], error: 'boom' });
    const ctx = createCtx({ params: { documentId: 'abc' } });
    await controller.trigger(ctx);
    expect(payload('run.failed').details).toEqual({ manual: true, error: 'boom' });
  });

  it('refuses to run scripts that fail the check', async () => {
    const { controller, cronJob, cron } = setup();
    cronJob.getOne.mockResolvedValue(existingJob({ script: 'process.exit()' }));
    const ctx = createCtx({ params: { documentId: 'abc' } });
    await controller.trigger(ctx);
    expect(ctx.status).toBe(422);
    expect(cron.trigger).not.toHaveBeenCalled();
  });
});

describe('validateScript', () => {
  it('returns the check result', async () => {
    const { controller } = setup();
    const ctx = createCtx({ body: { script: 'process.exit()' } });
    await controller.validateScript(ctx);
    expect(ctx.body).toMatchObject({ enabled: true, passed: false });
  });

  it('requires a string script', async () => {
    const { controller } = setup();
    const ctx = createCtx({ body: {} });
    await controller.validateScript(ctx);
    expect(ctx.status).toBe(400);
    const none = createCtx({ body: undefined });
    await controller.validateScript(none);
    expect(none.status).toBe(400);
  });
});
