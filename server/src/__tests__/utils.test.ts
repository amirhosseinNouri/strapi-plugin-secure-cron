import { createScopedConsole, createScopedStrapi, escapeHtml, runScript } from '../utils';

describe('createScopedConsole', () => {
  it('collects lines per level and forwards them', () => {
    const forward = jest.fn();
    const { lines, console } = createScopedConsole(forward);
    console.log('a', 1, { b: 2 });
    console.info('i');
    console.warn('w');
    console.error(new Error('boom'));
    console.debug(undefined, () => 1, function named() {}, BigInt(5), Symbol('s'));
    expect(lines[0]).toEqual(['a', '1', '{"b":2}']);
    expect(lines[1]).toEqual(['i']);
    expect(lines[2]).toEqual(['[warn]', 'w']);
    expect(lines[3][0]).toBe('[error]');
    expect(lines[3][1]).toContain('Error: boom');
    expect(lines[4]).toEqual(['[debug]', 'undefined', '[Function anonymous]', '[Function named]', '5', 'Symbol(s)']);
    expect(forward).toHaveBeenCalledWith('warn', 'w');
  });

  it('serialises circular objects and errors without stacks', () => {
    const { lines, console } = createScopedConsole();
    const circular: any = {};
    circular.self = circular;
    const error = new Error('no stack');
    error.stack = undefined;
    console.log(circular, error);
    expect(lines[0]).toEqual(['[object Object]', 'Error: no stack']);
  });

  it('isolates output between consoles', () => {
    const first = createScopedConsole();
    const second = createScopedConsole();
    first.console.log('one');
    second.console.log('two');
    expect(first.lines).toEqual([['one']]);
    expect(second.lines).toEqual([['two']]);
  });
});

describe('escapeHtml', () => {
  it('escapes markup characters so values render as text', () => {
    expect(escapeHtml('<script>"x" & \'y\'</script>')).toBe('&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/script&gt;');
    expect(escapeHtml(1200)).toBe('1200');
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});

describe('createScopedStrapi', () => {
  const strapi = { documents: jest.fn(() => 'landing-api'), db: { query: jest.fn() }, log: { info: jest.fn() } };

  it('exposes only documents() for allowed content types and log', () => {
    const scoped: any = createScopedStrapi(strapi, ['api::landing.landing']);
    expect(scoped.documents('api::landing.landing')).toBe('landing-api');
    expect(scoped.log).toBe(strapi.log);
    expect(Object.keys(scoped).sort()).toEqual(['documents', 'log']);
    expect(scoped.db).toBeUndefined();
    expect(Object.isFrozen(scoped)).toBe(true);
  });

  it('throws for any other content type', () => {
    const scoped: any = createScopedStrapi(strapi, ['api::landing.landing']);
    expect(() => scoped.documents('plugin::strapi-plugin-cron.cron-job')).toThrow(
      'The content type "plugin::strapi-plugin-cron.cron-job" is not allowed. Allowed content types: api::landing.landing.'
    );
    expect(() => createScopedStrapi(strapi, []).documents('api::landing.landing')).toThrow(/Allowed content types: none/);
  });
});

describe('runScript', () => {
  const args = () => {
    const scoped = createScopedConsole();
    return { scoped, args: { strapi: { name: 'strapi' }, cronJob: { name: 'job' }, console: scoped.console } };
  };

  it('runs scripts with strapi, cronJob and console in scope', async () => {
    const { scoped, args: a } = args();
    await runScript('console.log(strapi.name, cronJob.name)', a);
    expect(scoped.lines).toEqual([['strapi', 'job']]);
  });

  it('gives scripts the escapeHtml helper', async () => {
    const { scoped, args: a } = args();
    await runScript('console.log(escapeHtml("<b>"))', a);
    expect(scoped.lines).toEqual([['&lt;b&gt;']]);
  });

  it('supports await', async () => {
    const { scoped, args: a } = args();
    await runScript('await new Promise((r) => setTimeout(r, 5)); console.log("after")', a);
    expect(scoped.lines).toEqual([['after']]);
  });

  it('supports the legacy resolve callback', async () => {
    const { args: a } = args();
    await expect(runScript('setTimeout(() => resolve(), 5); await new Promise(() => {})', a)).resolves.toBeUndefined();
  });

  it('rejects on thrown errors and legacy reject', async () => {
    const { args: a } = args();
    await expect(runScript('throw new Error("fail")', a)).rejects.toThrow('fail');
    await expect(runScript('reject(new Error("nope"))', a)).rejects.toThrow('nope');
  });

  it('rejects on syntax errors', async () => {
    const { args: a } = args();
    await expect(runScript('const = 1', a)).rejects.toThrow(SyntaxError);
  });

  it('does not touch the global console', async () => {
    const spy = jest.spyOn(global.console, 'log').mockImplementation(() => {});
    const { args: a } = args();
    await runScript('console.log("scoped")', a);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
