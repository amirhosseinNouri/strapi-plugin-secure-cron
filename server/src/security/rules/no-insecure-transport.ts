import { stringVisitors } from '../ast';
import type { SecurityRule } from '../types';

const INSECURE_URL = /^\s*(?:http|ws):\/\//i;
const INSECURE_MARKUP_URL = /\b(?:src|srcset|href|action|formaction|poster|data)\s*=\s*["']?\s*(?:http|ws):\/\//i;
/** XML namespace identifiers (`xmlns="http://www.w3.org/2000/svg"`) are names, not requests. */
const XML_NAMESPACE = /^\s*http:\/\/www\.w3\.org\//i;

const preview = (value: string) => {
  const trimmed = value.trim();
  return trimmed.length > 60 ? `${trimmed.slice(0, 57)}...` : trimmed;
};

export const noInsecureTransport: SecurityRule = {
  id: 'no-insecure-transport',
  severity: 'error',
  description: 'Plain-HTTP URLs are not allowed.',
  rationale:
    'Content fetched over http:// or ws:// can be read and replaced by anyone on the network path, so a script that publishes it lets them inject content into the site. Use https:// (wss:// for WebSockets). allowedNetworkOrigins does not exempt plain-HTTP origins.',
  create: (context) =>
    stringVisitors((node, value) => {
      if (INSECURE_URL.test(value) && !XML_NAMESPACE.test(value)) {
        context.report(node, `The plain-HTTP URL "${preview(value)}" is not allowed. Use https:// or wss://.`);
      } else if (INSECURE_MARKUP_URL.test(value)) {
        context.report(node, 'Markup that loads or links to a plain-HTTP URL is not allowed. Use https://.');
      }
    }),
};
