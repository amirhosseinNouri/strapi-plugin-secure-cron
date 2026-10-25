import { DYNAMIC, getMemberPath, getStaticString, isVariableReference } from '../ast';
import type { SecurityRule } from '../types';

/** The only strapi members a script gets when allowedContentTypes is set (see createScopedStrapi). */
export const SCOPED_STRAPI_MEMBERS = new Set(['documents', 'log']);

export const noUnlistedContentTypes: SecurityRule = {
  id: 'no-unlisted-content-types',
  severity: 'error',
  description: 'Scripts may only use strapi.documents() on the content types listed in allowedContentTypes.',
  rationale:
    'When allowedContentTypes is configured, scripts receive a strapi object with only documents() for those content types and log. strapi.db.query, entityService, services, plugins and other content types reach data the job must not touch, such as other cron jobs and their secrets, and skip draft/publish handling. Name the content type as a literal, e.g. strapi.documents(\'api::landing.landing\').',
  create: (context) => {
    const allowed = context.options.allowedContentTypes;
    if (!Array.isArray(allowed)) return {};
    const listed = allowed.length ? allowed.join(', ') : 'none';

    return {
      MemberExpression: (node, ancestors) => {
        const path = getMemberPath(node);
        if (path?.[0] !== 'strapi' || path.length !== 2) return;
        const parent = ancestors[ancestors.length - 2];
        const member = path[1];

        if (member === DYNAMIC) {
          context.report(node, 'Computed access on strapi is not allowed; use strapi.documents(...) or strapi.log.');
          return;
        }
        if (!SCOPED_STRAPI_MEMBERS.has(member)) {
          context.report(
            node,
            member === 'db'
              ? 'strapi.db is not allowed. Use strapi.documents(...) on an allowed content type instead.'
              : `strapi.${member} is not available to scripts. Only strapi.documents(...) and strapi.log are.`
          );
          return;
        }
        if (member !== 'documents') return;
        if (parent?.type !== 'CallExpression' || parent.callee !== node) {
          context.report(node, 'strapi.documents must be called directly, so the content type can be checked.');
          return;
        }
        const uid = getStaticString(parent.arguments[0]);
        if (uid === null) {
          context.report(parent, 'The content type passed to strapi.documents() must be a literal string.');
        } else if (!allowed.includes(uid)) {
          context.report(parent, `The content type "${uid}" is not allowed. Allowed content types: ${listed}.`);
        }
      },
      // `const s = strapi`, `helper(strapi)` and `{ strapi }` would hide what is accessed.
      Identifier: (node, ancestors) => {
        if (node.name !== 'strapi') return;
        const parent = ancestors[ancestors.length - 2];
        if (!isVariableReference(node, parent)) return;
        if (parent?.type === 'MemberExpression' && parent.object === node) return;
        context.report(node, 'strapi may only be used as strapi.documents(...) or strapi.log.');
      },
    };
  },
};
