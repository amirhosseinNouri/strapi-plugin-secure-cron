import { parse } from 'acorn';
import { fullAncestor } from 'acorn-walk';
import { rules as defaultRules } from './rules';
import type { AstNode, CheckOptions, RuleVisitor, SecurityFinding, SecurityRule } from './types';

export type CheckResult = {
  passed: boolean;
  errors: number;
  warnings: number;
  findings: SecurityFinding[];
};

export const PARSE_ERROR_RULE_ID = 'parse-error';

const severityOrder = { error: 0, warning: 1 } as const;

const sortFindings = (a: SecurityFinding, b: SecurityFinding) =>
  a.line - b.line || a.column - b.column || severityOrder[a.severity] - severityOrder[b.severity];

/**
 * Parses the script the way the runner executes it (the body of an async function)
 * and runs every rule over the AST in a single pass.
 *
 * Static analysis is a defense layer, not a sandbox: it raises the bar against
 * accidental or careless dangerous code and obvious malware, but a determined
 * attacker with script-editing rights can still find ways around it.
 */
export const checkScript = (
  source: string,
  rules: SecurityRule[] = defaultRules,
  options: CheckOptions = {}
): CheckResult => {
  const findings: SecurityFinding[] = [];

  let ast: AstNode;
  try {
    ast = parse(source, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
      allowHashBang: false,
      locations: true,
    }) as unknown as AstNode;
  } catch (error: any) {
    const line = error?.loc?.line ?? 1;
    const column = (error?.loc?.column ?? 0) + 1;
    findings.push({
      ruleId: PARSE_ERROR_RULE_ID,
      severity: 'error',
      message: `Syntax error: ${String(error?.message ?? error).replace(/\s*\(\d+:\d+\)$/, '')}`,
      line,
      column,
      endLine: line,
      endColumn: column + 1,
    });
    return { passed: false, errors: 1, warnings: 0, findings };
  }

  const seen = new Set<string>();
  const visitors: Array<{ rule: SecurityRule; visitor: RuleVisitor }> = rules.map((rule) => ({
    rule,
    visitor: rule.create({
      source,
      options,
      report: (node, message) => {
        const start = node.loc?.start ?? { line: 1, column: 0 };
        const end = node.loc?.end ?? start;
        const finding: SecurityFinding = {
          ruleId: rule.id,
          severity: rule.severity,
          message: message ?? rule.description,
          line: start.line,
          column: start.column + 1,
          endLine: end.line,
          endColumn: end.column + 1,
        };
        const key = `${finding.ruleId}:${finding.line}:${finding.column}:${finding.message}`;
        if (seen.has(key)) return;
        seen.add(key);
        findings.push(finding);
      },
    }),
  }));

  fullAncestor(ast as any, (node: any, _state: unknown, ancestors: any[]) => {
    for (const { visitor } of visitors) {
      visitor[node.type]?.(node, ancestors);
    }
  });

  findings.sort(sortFindings);
  const errors = findings.filter((finding) => finding.severity === 'error').length;
  return {
    passed: errors === 0,
    errors,
    warnings: findings.length - errors,
    findings,
  };
};
