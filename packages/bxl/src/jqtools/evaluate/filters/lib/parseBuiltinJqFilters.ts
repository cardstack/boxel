import type { DefAst } from '../../../parser/AST.ts';
import { parse } from '../../../parser/Parser.ts';
import { JqEvaluateError } from '../../../errors.ts';

export function parseBuiltinJqFilters(code: string): Record<string, DefAst> {
  const out: Record<string, DefAst> = {};
  let ast = parse(code).expr;
  while (ast) {
    if (ast.type !== 'def') {
      throw new JqEvaluateError('Could not parse the built-in jq filters');
    }
    out[ast.name] = ast;

    ast = ast.next;
  }

  return out;
}
