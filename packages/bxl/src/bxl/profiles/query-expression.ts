import { parseBxlAst, type BxlProfileIssue } from '../ast/index.ts';
import { prepareSpreadsheetFormula } from '../sql/formula-eval.ts';
import { classifyBxlProfileFunction } from './function-safety.ts';

/**
 * The Profile.query refusals for an expression a query carries (a sort
 * `expression`, with or without `top`, or a blend's expression signal), as
 * error issues; none when it may run.
 *
 * A spreadsheet formula is read as the spreadsheet interpreter reads it, so a
 * bare name is a field (`input * 2` reads the field `input`), and only the
 * functions it calls are checked against the profile. Anything the
 * interpreter does not take (a binding from `LET`, a jq construct) is checked
 * node by node under Profile.query. A source that does not parse has no
 * issues here: compiling it reports the syntax error.
 */
export function queryExpressionIssues(source: string): BxlProfileIssue[] {
  let called: string[] = [];
  let spreadsheet = true;
  try {
    prepareSpreadsheetFormula(source, {
      callFunction(name) {
        called.push(name);
        return () => null;
      },
    });
  } catch {
    spreadsheet = false;
  }
  if (spreadsheet) {
    let issues: BxlProfileIssue[] = [];
    for (let name of new Set(called)) {
      let decision = classifyBxlProfileFunction('query', name);
      if (decision.safety === 'deny') {
        issues.push({
          code: 'query-call-banned',
          severity: 'error',
          message: `Profile.query computes one value from a row in a query and cannot use ${name}${decision.message ? `: ${decision.message}` : ''}.`,
          nodeType: 'call',
        });
      }
    }
    return issues;
  }
  let program;
  try {
    program = parseBxlAst(source.trim(), { profile: 'query' });
  } catch (e) {
    // a module directive reads code from elsewhere; any other syntax error
    // is the compiler's to report
    let word = /"(import|include)" is a reserved word/.exec(
      String((e as Error)?.message),
    )?.[1];
    return word
      ? [
          {
            code: 'query-module-banned',
            severity: 'error',
            message: `Profile.query computes one value from a row in a query and cannot use jq \`${word}\`.`,
          },
        ]
      : [];
  }
  return program.profileIssues.filter((issue) => issue.severity === 'error');
}
