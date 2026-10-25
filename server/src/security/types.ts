import type { SecurityFinding, SecuritySeverity } from '../../../types';

export type AstNode = {
  type: string;
  start: number;
  end: number;
  loc?: { start: { line: number; column: number }; end: { line: number; column: number } };
  [key: string]: any;
};

export type RuleVisitor = Partial<Record<string, (node: AstNode, ancestors: AstNode[]) => void>>;

/** Deployment-specific allow-lists that relax individual rules. Everything is denied by default. */
export type CheckOptions = {
  /** Origins (e.g. `https://gateway.internal`) that network calls may target. */
  allowedNetworkOrigins?: string[];
  /** Absolute directory that file paths in a script may point into. */
  scratchDirectory?: string | null;
  /** Content attribute names rendered as markdown/HTML; see the no-dynamic-markup rule. */
  markdownFields?: string[];
  /** Content-type UIDs scripts may use through strapi.documents(); null leaves access unrestricted. */
  allowedContentTypes?: string[] | null;
};

export type RuleContext = {
  source: string;
  options: CheckOptions;
  report: (node: AstNode, message?: string) => void;
};

export type SecurityRule = {
  /** Stable identifier, shown to users and stored in audit logs. */
  id: string;
  severity: SecuritySeverity;
  /** One-line summary, used as the default finding message. */
  description: string;
  /** Why the rule exists and what to do instead. Rendered in the README. */
  rationale: string;
  create: (context: RuleContext) => RuleVisitor;
};

export type { SecurityFinding, SecuritySeverity };
