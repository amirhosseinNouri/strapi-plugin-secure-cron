import * as acorn from 'acorn';

jest.mock('acorn', () => {
  const actual = jest.requireActual('acorn');
  return { ...actual, parse: jest.fn(actual.parse) };
});
import { checkScript, PARSE_ERROR_RULE_ID } from '../engine';
import type { SecurityRule } from '../types';

describe('checkScript', () => {
  it('returns a passing result for an empty script', () => {
    expect(checkScript('')).toEqual({ passed: true, errors: 0, warnings: 0, findings: [] });
  });

  it('accepts top-level await and return like the runtime wrapper', () => {
    expect(checkScript('await Promise.resolve(1); return;').passed).toBe(true);
  });

  it('reports syntax errors as a single blocking finding with a location', () => {
    const result = checkScript('const x = ;\n');
    expect(result.passed).toBe(false);
    expect(result.errors).toBe(1);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      ruleId: PARSE_ERROR_RULE_ID,
      severity: 'error',
      line: 1,
      column: 11,
    });
    expect(result.findings[0].message).toMatch(/^Syntax error: Unexpected token$/);
  });

  it('handles parse errors without location information', () => {
    (acorn.parse as jest.Mock).mockImplementationOnce(() => {
      throw 'boom';
    });
    const result = checkScript('x');
    expect(result.findings[0]).toMatchObject({
      ruleId: PARSE_ERROR_RULE_ID,
      line: 1,
      column: 1,
      message: 'Syntax error: boom',
    });
  });

  it('rejects module syntax because scripts run as function bodies', () => {
    const result = checkScript("import fs from 'fs';");
    expect(result.findings.map((f) => f.ruleId)).toContain(PARSE_ERROR_RULE_ID);
  });

  it('counts errors and warnings and sorts findings by position', () => {
    const result = checkScript("await strapi.documents('api::a.a').deleteMany({});\nprocess.exit(1);\nwhile (true) {}");
    expect(result.errors).toBe(1);
    expect(result.warnings).toBe(2);
    expect(result.passed).toBe(false);
    expect(result.findings.map((f) => f.line)).toEqual([1, 2, 3]);
  });

  it('passes allow-list options to rules', () => {
    const options = { allowedNetworkOrigins: ['https://gateway.internal'], scratchDirectory: '/srv/scratch' };
    const allowed = "await fetch('https://gateway.internal/hooks/x');\nfs.writeFileSync('/srv/scratch/out.json', '{}');";
    expect(checkScript(allowed).passed).toBe(false);
    expect(checkScript(allowed, undefined, options)).toMatchObject({ passed: true, findings: [] });

    const denied = checkScript(
      "await fetch('https://gateway.internal.evil.com/x');\nfs.writeFileSync('/srv/scratch/../app/.env', '');",
      undefined,
      options
    );
    expect(denied.findings.map((f) => f.ruleId).sort()).toEqual([
      'no-filesystem-access',
      'no-filesystem-access',
      'no-network-calls',
    ]);
  });

  it('sorts errors before warnings at the same position', () => {
    const at = (severity: 'error' | 'warning', id: string): SecurityRule => ({
      id,
      severity,
      description: id,
      rationale: id,
      create: (context) => ({ Program: (node) => context.report(node) }),
    });
    const result = checkScript('1', [at('warning', 'w'), at('error', 'e')]);
    expect(result.findings.map((f) => f.ruleId)).toEqual(['e', 'w']);
  });

  it('deduplicates identical reports and uses the description by default', () => {
    const rule: SecurityRule = {
      id: 'dup',
      severity: 'warning',
      description: 'Default message',
      rationale: 'r',
      create: (context) => ({
        Literal: (node) => {
          context.report(node);
          context.report(node);
        },
      }),
    };
    const result = checkScript('1', [rule]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ message: 'Default message', line: 1, column: 1, endColumn: 2 });
  });

  it('falls back to line 1 when a node has no location', () => {
    const rule: SecurityRule = {
      id: 'noloc',
      severity: 'error',
      description: 'd',
      rationale: 'r',
      create: (context) => ({ Program: () => context.report({ type: 'X', start: 0, end: 0 }) }),
    };
    expect(checkScript('1', [rule]).findings[0]).toMatchObject({ line: 1, column: 1, endLine: 1 });
  });

  it('passes the source to rules', () => {
    const seen: string[] = [];
    const rule: SecurityRule = {
      id: 'src',
      severity: 'warning',
      description: 'd',
      rationale: 'r',
      create: (context) => {
        seen.push(context.source);
        return {};
      },
    };
    checkScript('const a = 1;', [rule]);
    expect(seen).toEqual(['const a = 1;']);
  });
});
