import { DefAst } from '../../../parser/AST.js';
import { parse } from '../../../parser/Parser.js';
import { JqEvaluateError } from '../../../errors.js';

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
