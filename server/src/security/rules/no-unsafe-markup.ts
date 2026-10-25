import { stringVisitors } from '../ast';
import type { SecurityRule } from '../types';

/** Elements that run code, load resources, change the page or collect input. */
const FORBIDDEN_TAGS = [
  'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'portal', 'link',
  'meta', 'base', 'form', 'input', 'textarea', 'select', 'noscript', 'template',
];

const CHECKS: Array<{ pattern: RegExp; message: (match: RegExpExecArray) => string }> = [
  {
    pattern: new RegExp(`<\\s*(${FORBIDDEN_TAGS.join('|')})(?![\\w-])`, 'i'),
    message: (match) => `Markup with a <${match[1].toLowerCase()}> element is not allowed in content.`,
  },
  {
    pattern: /<[a-z][^<>]*?\s(on[a-z]+)\s*=/i,
    message: (match) => `Markup with an ${match[1].toLowerCase()} event handler is not allowed in content.`,
  },
  {
    pattern: /<[a-z][^<>]*?\sstyle\s*=/i,
    message: () => 'Markup with a style attribute is not allowed in content. Use the site\'s own components and styles.',
  },
  {
    pattern: /\b(?:javascript|vbscript)\s*:|\bdata\s*:\s*text\/html/i,
    message: () => 'javascript:, vbscript: and data:text/html URLs are not allowed.',
  },
];

export const noUnsafeMarkup: SecurityRule = {
  id: 'no-unsafe-markup',
  severity: 'error',
  description: 'The script contains markup that is not allowed in content.',
  rationale:
    'Content fields such as markdown and raw HTML are rendered into the public site. Scripts, styles, frames, forms, meta/link/base tags, event handlers, style attributes and javascript: URLs inject code, change other parts of the page or collect user input. Write plain content markup only.',
  create: (context) =>
    stringVisitors((node, value) => {
      for (const { pattern, message } of CHECKS) {
        const match = pattern.exec(value);
        if (match) {
          context.report(node, message(match));
          return;
        }
      }
    }),
};
