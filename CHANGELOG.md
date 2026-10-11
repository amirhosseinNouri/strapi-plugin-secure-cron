# Changelog

## Unreleased

### Security

- New error rules: `no-child-process` (any mention of child_process, its internal bindings, or
  exec/execSync/execFile/spawn/spawnSync/fork), `no-native-modules` (.node addons, ffi, bindings,
  node-gyp, dlopen) and `no-filesystem-access` (system absolute paths, `..` traversal, symlinks, fs
  calls, `__dirname`/`__filename`).
- `no-network-calls` (still a warning) also covers `strapi.fetch`, `navigator.sendBeacon`,
  `EventSource` and aliased `fetch`. Calls with a literal URL on an origin listed in the new
  `allowedNetworkOrigins` config skip the warning.
- `no-code-evaluation` also catches `Function.constructor`, aliased `Function`, async/generator
  function constructors and node:vm (`runInContext`, `runInNewContext`, `new vm.Script`, ...).
- `no-dynamic-module-loading` also catches `module.require`, `module.constructor._load` and
  `createRequire`.
- `no-process-access` names the specific danger of `process.env`, `exit`, `binding`, `dlopen`, ...
- New `scratchDirectory` config: file paths inside it pass `no-filesystem-access`.

## 3.0.0: strapi-plugin-secure-cron

First release of the security-hardened fork of `@innovato/strapi-plugin-cron@2.0.2`.

### Security

- **Fixed unauthenticated remote code execution.** Upstream registered every route with
  `auth: false`, so anyone could create and trigger a cron job running arbitrary JavaScript with the
  full `strapi` object. Every route now requires an authenticated admin plus an RBAC permission. Auth
  cannot be disabled.
- Fixed path traversal in file-based scripts by removing file-based scripts.
- Static security check (AST rule engine) on create, update, publish, schedule and manual trigger,
  with live feedback in the editor.
- Scripts get a console scoped to the run instead of the global `console.log` being patched, so concurrent jobs
  no longer leak or capture each other's output.

### Added

- RBAC actions: read, create, update, delete, trigger (*Settings → Roles → Plugins → Cron*).
- `createdBy` / `updatedBy` attribution, shown in the list and on the job page.
- Audit events on `strapi.eventHub` (`strapi-plugin-cron.cron-job.*`).
- CodeMirror editor with JavaScript highlighting, inline findings and full-screen mode.
- Config: `securityCheck` and `syntaxHighlighting` (both default `true`).
- `POST /cron-jobs/validate-script`, `GET /settings`, `GET /security-rules`.
- Scripts can use top-level `await`.
- Unit, admin and integration test suites with CI coverage gates.

### Changed / breaking

- Package renamed to `strapi-plugin-secure-cron`. The plugin id stays `strapi-plugin-cron`, so data and
  routes are compatible.
- `executeScriptFromFile` and `pathToScript` removed. `script` is required.
- Trigger is now `POST /cron-jobs/trigger/:documentId` (was `GET`) and returns `{ success, logs, error? }`.
- Saving a published job reschedules it with the new script (previously the old script kept running).
- Published jobs can be edited.
- The admin panel uses Strapi's authenticated fetch client and follows the admin light/dark theme.
- Node 22 is supported.
