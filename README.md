# strapi-plugin-secure-cron

**Security-hardened cron jobs for the Strapi 5 admin panel.**

A fork of [@innovato/strapi-plugin-cron](https://github.com/innovato/strapi-plugin-cron) that fixes an
unauthenticated remote-code-execution issue and adds the controls you need before letting people
schedule JavaScript inside your CMS:

- 🔐 **Admin authentication always required**: every route is an admin route. There is no `auth: false` and no option to turn auth off.
- 👥 **Fine-grained RBAC**: grant *read / create / update / delete / trigger* per role from
  *Settings → Roles → Plugins → Cron*.
- 🧑‍💻 **Attribution**: every job records `createdBy` and `updatedBy`, shown in the list and detail pages.
- 🧾 **Audit events**: every change, blocked attempt, acknowledgement and failed run is emitted on
  Strapi's event hub, so any audit plugin can record it.
- 🛡️ **Script security check**: scripts are statically analysed (AST rules) when you type, on save,
  on publish, before scheduling and before a manual run. Dangerous code is blocked, suspicious code needs an acknowledgement.
- ✍️ **Real code editor**: CodeMirror with JavaScript highlighting, inline findings and a full-screen mode.
- 🔁 **Edits take effect immediately**: saving a published job reschedules it with the new script.

![Cron plugin for Strapi](screenshot.png)

## Installation

```sh
npm install strapi-plugin-secure-cron
```

`config/plugins.ts`:

```ts
export default ({ env }) => ({
  'strapi-plugin-cron': {
    enabled: true,
    config: {
      securityCheck: env.bool('CRON_PLUGIN_SECURITY_CHECK', true),
      syntaxHighlighting: env.bool('CRON_PLUGIN_SYNTAX_HIGHLIGHT', true),
      // Optional allow-lists; both default to deny-all.
      allowedNetworkOrigins: ['https://egress-gateway.internal'],
      scratchDirectory: '/srv/cron-scratch',
      // Attributes the site renders as markdown/HTML (see no-dynamic-markup).
      markdownFields: ['rawHtml', 'description'],
      // Content types scripts may use; they then get only strapi.documents() and strapi.log.
      allowedContentTypes: ['api::landing.landing'],
      // Optional project check before a job is turned on or test-run.
      publishGuard: async ({ strapi, cronJob }) => [],
      // 'error' (default) keeps a job off on guard errors; 'warn' turns it on and shows them as warnings.
      publishGuardMode: 'error',
    },
  },
});
```

The plugin keeps the original plugin id (`strapi-plugin-cron`). Existing `cron_jobs` data and the
`/strapi-plugin-cron/*` route prefix stay compatible when you migrate from the upstream package.

Then rebuild the admin panel: `npm run build`.

### Configuration

| Key | Default | Description |
| --- | --- | --- |
| `securityCheck` | `true` | Run the script security check. When `false`, scripts are neither checked nor blocked. |
| `syntaxHighlighting` | `true` | Use the CodeMirror editor. When `false`, a plain monospace textarea is used (full screen still works). |
| `allowedNetworkOrigins` | `[]` | Origins scripts may call with `fetch`, `strapi.fetch` or `WebSocket`, e.g. an internal egress gateway. A literal URL on one of these origins skips the `no-network-calls` warning; any other call still needs acknowledgement. |
| `markdownFields` | `[]` | Attribute names the site renders as markdown or HTML. Scripts may only set them to literal markup, or literal markup with run-time values wrapped in `escapeHtml()`; anything else is a `no-dynamic-markup` error. Names are matched on any object, so list only fields that really are rendered as markup. |
| `publishGuard` | `null` | `async ({ strapi, cronJob }) => ContentFinding[]`, run when a job is turned on or test-run, after its script passes the check. Return `{ severity, message, link? }` findings; any `error` keeps the job off and is shown in the admin panel with its link. A guard that throws counts as an error. Use it for project rules the script check cannot see, such as content the job would break. |
| `publishGuardMode` | `'error'` | How `publishGuard` errors are applied. `'error'` keeps the job off (or stops the test run). `'warn'` turns the job on (or runs it) and shows every finding as a warning in the job list, with its link; use it when the project enforces the rule elsewhere, e.g. at publish time. A guard that throws always blocks. |
| `allowedContentTypes` | `null` | Content-type UIDs scripts may access. When set, scripts receive a `strapi` object with only `documents(uid)` for these UIDs and `log`; `strapi.db`, `entityService`, services, plugins and every other content type are unavailable at run time and are `no-unlisted-content-types` errors in the check. `[]` allows none. `null` keeps the full `strapi` object. |
| `scratchDirectory` | `null` | Absolute directory that file paths in a script may point into. Paths elsewhere, `..` traversal and symlink calls are always `no-filesystem-access` errors. Scripts get no `fs` handle at runtime, so this only relaxes the static check. |

Authentication cannot be configured. A config containing `enforceAuth` is rejected at startup.

## Permissions

After installing, super admins have every permission. Grant the others in *Settings → Administration
panel → Roles → (role) → Plugins → Cron*:

| Permission | Allows |
| --- | --- |
| Read cron jobs | See the menu entry, the list, job details and logs |
| Create cron jobs | Create jobs (and use live script validation) |
| Update and publish cron jobs | Edit, publish and unpublish jobs (and use live script validation) |
| Delete cron jobs | Delete jobs |
| Trigger cron jobs manually | Run a job immediately ("Test run") |

## Writing scripts

A script is the body of an **async function** with three variables in scope:

- `strapi`: the Strapi instance, or only `strapi.documents(uid)` and `strapi.log` when `allowedContentTypes` is set
- `cronJob`: the job being run (name, iteration counters, …)
- `console`: a console scoped to this run. Its output becomes the job's *latest execution log*.
- `escapeHtml(value)`: escapes a run-time value so it renders as text inside markup. Values written to
  `markdownFields` must use it:

```js
// Allowed: literal markup with escaped values, or editing the stored markup.
data: { rawHtml: `<table><tr><td>${escapeHtml(price)}</td></tr></table>` }
data: { rawHtml: component.rawHtml.replace('{{price}}', escapeHtml(price)) }
// Error: markup from a feed cannot be checked before it is published.
data: { rawHtml: feed.blocks[id] }
```

```js
const drafts = await strapi.documents('api::article.article').findMany({
  filters: { publishedAt: { $null: true } },
});
console.log(`Found ${drafts.length} drafts`);
```

`resolve()` / `reject()` from the upstream plugin are still available for older scripts.

**File-based scripts (`executeScriptFromFile` / `pathToScript`) were removed.** They bypassed the
security check and allowed path traversal. Paste the script into the editor instead.

## Writing safe scripts

Every script goes through a static security check. Findings come in two levels:

- **⛔ error**: the script cannot be saved, published, scheduled or triggered. Turning a job on or
  test-running it re-runs the check, so a job saved before a rule was added stays off until its script
  is fixed and saved.
- **⚠️ warning**: the script can be saved only after ticking *"I reviewed the security warnings"*.
  The acknowledgement is recorded as an audit event. Unchanged scripts don't need to be acknowledged again.

> The check is a defense layer, not a sandbox. It stops careless dangerous code and obvious malware,
> but someone with script-editing rights and enough determination can still get around static analysis.
> Grant *create* and *update* only to people you would trust with server access.

<!-- rules:start -->
| Rule | Severity | What it catches and why |
| --- | --- | --- |
| `no-child-process` | ⛔ error | Spawning processes is not allowed. child_process (exec, execSync, execFile, spawn, spawnSync, fork) runs shell commands with the permissions of the Strapi server. Any mention of the module, its internal bindings or its functions is rejected. |
| `no-dangerous-modules` | ⛔ error | Loading Node.js system modules is not allowed. Modules such as child_process, fs, net, http and vm give a script shell, filesystem and network access to the server. Use the strapi APIs passed to the script instead. |
| `no-dynamic-module-loading` | ⛔ error | Loading modules is not allowed in cron scripts. The module allow-list for cron scripts is empty: require(), import(), module.require and createRequire are how a script escapes the strapi API surface and loads packages from node_modules. Computed module names also defeat static review. Everything a cron script needs is available on the strapi object. |
| `no-native-modules` | ⛔ error | Loading native code is not allowed. Native addons (.node files), FFI libraries (ffi, ffi-napi, koffi), bindings and node-gyp run machine code inside the server process, outside the reach of any JavaScript check. |
| `no-code-evaluation` | ⛔ error | Evaluating strings as code is not allowed. eval, the Function constructor (including Function.constructor and the async/generator variants), node:vm and string-based timers run arbitrary code that cannot be reviewed or security-checked. Write the logic directly in the script. |
| `no-process-access` | ⛔ error | Accessing the Node.js process object is not allowed. process exposes environment variables (secrets), process.exit, process.binding, process.dlopen and process.mainModule.require, which bypass every other safeguard. Every use of process is rejected. |
| `no-filesystem-access` | ⛔ error | Filesystem access outside the scratch directory is not allowed. Reading or writing server files leaks secrets (.env, keys) and lets a script plant code. Absolute system paths, ".." traversal, symlinks and fs calls are rejected; only paths inside the configured scratchDirectory are allowed. |
| `no-global-tampering` | ⛔ error | Modifying globals, built-in prototypes or the strapi object is not allowed. Overwriting globals, prototypes or strapi internals changes the behaviour of the whole server process, not only the script, and is a common persistence technique. |
| `no-prototype-escape` | ⛔ error | Reaching constructors through prototypes is not allowed. Chains like x.constructor.constructor or __proto__ reach the Function constructor and evaluate arbitrary code without the words eval or Function appearing in the script. |
| `no-raw-database` | ⛔ error | Raw database access is not allowed. strapi.db.connection (knex) and .raw() run arbitrary SQL, bypassing Strapi validation and access control, and can read admin users, tokens and secrets. Use strapi.documents() instead. |
| `no-strapi-internals` | ⛔ error | Accessing sensitive strapi internals is not allowed. Cron scripts should work with content through strapi.documents(). Configuration, server lifecycle and container internals expose secrets or can take the server down. |
| `no-sensitive-services` | ⛔ error | Accessing admin or users-permissions internals is not allowed. Admin users, roles, API tokens and users-permissions accounts control who can access the CMS. A cron script that can read or change them is an account-takeover risk. |
| `no-insecure-transport` | ⛔ error | Plain-HTTP URLs are not allowed. Content fetched over http:// or ws:// can be read and replaced by anyone on the network path, so a script that publishes it lets them inject content into the site. Use https:// (wss:// for WebSockets). allowedNetworkOrigins does not exempt plain-HTTP origins. |
| `no-unsafe-markup` | ⛔ error | The script contains markup that is not allowed in content. Content fields such as markdown and raw HTML are rendered into the public site. Scripts, styles, frames, forms, meta/link/base tags, event handlers, style attributes and javascript: URLs inject code, change other parts of the page or collect user input. Write plain content markup only. |
| `no-dynamic-markup` | ⛔ error | Markdown fields may only receive literal content or escaped run-time values. Fields listed in markdownFields are rendered as HTML on the site. A value computed at run time, such as HTML from a feed, cannot be checked before it is published. Write literal markup and wrap every run-time value (prices, names) in escapeHtml(...), which the runner provides, e.g. `<td>${escapeHtml(price)}</td>`, or rawHtml.replace(old, escapeHtml(price)). |
| `no-unlisted-content-types` | ⛔ error | Scripts may only use strapi.documents() on the content types listed in allowedContentTypes. When allowedContentTypes is configured, scripts receive a strapi object with only documents() for those content types and log. strapi.db.query, entityService, services, plugins and other content types reach data the job must not touch, such as other cron jobs and their secrets, and skip draft/publish handling. Name the content type as a literal, e.g. strapi.documents('api::landing.landing'). |
| `no-obfuscation` | ⚠️ warning | The script contains patterns commonly used to hide code. Encoded payloads, heavy escape sequences and character-code assembly hide what a script really does from reviewers and from this check. Keep scripts readable; store large data in content types instead. |
| `no-dynamic-property-access` | ⚠️ warning | Computed property access on strapi or globals cannot be checked. strapi[name] or globalThis[name] lets a script reach any internal at runtime, so the static check cannot tell what it touches. Use literal property names. |
| `no-infinite-loops` | ⚠️ warning | The script contains a loop that never exits. Scripts run inside the Strapi server process. A loop without an exit blocks the event loop and freezes the whole CMS. |
| `no-network-calls` | ⚠️ warning | The script makes outbound network requests. fetch, strapi.fetch, WebSocket, XMLHttpRequest and EventSource can send CMS data to third parties (the http, https, net and dns modules are blocked outright). Make sure the destination is trusted before acknowledging, or list your internal gateway in allowedNetworkOrigins and call it with a literal URL to skip the warning. |
| `no-bulk-deletes` | ⚠️ warning | The script deletes content in bulk. deleteMany() or delete() inside a loop can wipe a whole collection on every tick. Double-check the filters before acknowledging. |
| `no-self-modification` | ⚠️ warning | The script accesses cron jobs themselves. A cron job that edits cron jobs can rewrite scripts after they passed this check, without leaving an audit trail of who changed them. Manage cron jobs through the admin panel. |
| `no-deprecated-apis` | ⚠️ warning | The script uses a deprecated Strapi API. strapi.entityService is deprecated in Strapi 5 and skips document-level logic. Use strapi.documents() instead. |
<!-- rules:end -->

### Adding rules

Rules live in `server/src/security/rules/`, one file per rule, registered in `rules/index.ts`. Each rule
is `{ id, severity, description, rationale, create(context) }`, where `create` returns AST visitors
keyed by node type (ESLint style) that call `context.report(node, message)`. Add bad and good samples for the
rule to `server/src/security/__tests__/rules.test.ts` (a test fails if a rule has no cases), then run
`npm run docs:rules` to refresh the table above.

## Audit events

Events are emitted on `strapi.eventHub` as `strapi-plugin-cron.cron-job.<action>`:

| Action | When |
| --- | --- |
| `create`, `update`, `delete` | A job is created, edited or deleted (`update` includes changed fields, script hashes and a unified diff capped at 64 KB) |
| `publish`, `unpublish` | A job is (un)scheduled |
| `trigger` | Someone pressed *Test run* |
| `run.succeeded` | A manual run finished |
| `run.failed` | A manual or scheduled run threw, or a published script failed the check at schedule time |
| `blocked` | A save, publish or trigger was refused by the security check |
| `warnings-acknowledged` | A script with warnings was saved after acknowledgement |

Payload:

```ts
{
  action: 'update',
  user: { id, documentId, firstname, lastname, username, email } | null, // null for scheduled runs
  entity: { type: 'cron-job', uid: 'plugin::strapi-plugin-cron.cron-job', id: documentId, displayName: name },
  ipAddress: string | null,
  timestamp: string,
  details: { ... },
}
```

With [prima-audit](https://www.npmjs.com/package/prima-audit) ≥ 2.1:

```ts
'prima-audit': { config: { eventSubscriptions: ['strapi-plugin-cron.*'] } }
```

## HTTP API

All routes are admin routes under `/strapi-plugin-cron` and require an admin session token plus the
listed permission.

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/cron-jobs`, `/cron-jobs/:documentId`, `/settings`, `/security-rules` | read |
| POST | `/cron-jobs` | create |
| PUT | `/cron-jobs/:documentId`, `/cron-jobs/publish/:documentId`, `/cron-jobs/unpublish/:documentId` | update |
| DELETE | `/cron-jobs/:documentId` | delete |
| POST | `/cron-jobs/trigger/:documentId` | trigger |
| POST | `/cron-jobs/validate-script` | create or update |

Saving a script with warnings requires `"acknowledgeWarnings": true` in the body. A refused save
responds `422` with `error.name = "SecurityCheckError"` and the findings in `error.details`.

## Development

```sh
npm install
npm run test:unit         # server unit tests (coverage gate: 90%)
npm run test:admin        # admin React tests (coverage gate: 80%)
npm run test:integration  # builds, boots a real Strapi 5 app on SQLite and exercises the HTTP API
npm test                  # all of the above
```

## License

MIT. Based on the work of [Innovato](https://innovato.nl) and [mjnoach](https://github.com/mjnoach).
