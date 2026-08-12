import {
  assertValidBxlProfile,
  parseBxlAst,
  type BxlAstNode,
  type BxlAstOptions,
  type BxlAstProgram,
  type BxlContextPathNode,
  type BxlLiteralNode,
  type BxlPathNode,
  type BxlPathPart,
} from '../ast/index.js';
export { SQL_PREDICATE_MODULE } from './predicate-module.js';
export type {
  BxlSqlPredicateMapping,
  BxlSqlPredicateModule,
} from './predicate-module.js';

export type BxlPredicateSqlPathUsage =
  | 'value'
  | 'text'
  | 'array'
  | 'timestamp';

export interface BxlPredicateSqlPath {
  root: 'current' | 'Record';
  parts: string[];
}

export interface BxlPredicateSqlValue {
  sql: string;
  usage: BxlPredicateSqlPathUsage;
}

export interface BxlPredicateSqlOptions
  extends Omit<BxlAstOptions, 'profile'> {
  context?: Record<string, unknown>;
  placeholder?: (index: number, value: unknown) => string;
  pathToSql?: (
    path: BxlPredicateSqlPath,
    usage: BxlPredicateSqlPathUsage,
  ) => string;
  ageToSql?: (value: BxlPredicateSqlValue) => string;
  matchesToSql?: (query: BxlPredicateSqlValue) => string;
  searchTextSql?: string;
}

export interface BxlPredicateSqlResult {
  sql: string;
  params: unknown[];
  source?: string;
  canonicalSource?: string;
}

export class BxlPredicateSqlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BxlPredicateSqlError';
  }
}

export function compileBxlPredicateToSql(
  expression: string,
  options: BxlPredicateSqlOptions = {},
): BxlPredicateSqlResult {
  const program = parseBxlAst(expression, {
    ...options,
    profile: 'predicate',
  });
  assertValidBxlProfile(program, { profile: 'predicate' });
  const compiled = compileBxlPredicateAstToSql(program, options);
  return {
    ...compiled,
    source: program.source,
    canonicalSource: program.canonicalSource,
  };
}

export function compileBxlPredicateAstToSql(
  programOrNode: BxlAstProgram | BxlAstNode,
  options: BxlPredicateSqlOptions = {},
): BxlPredicateSqlResult {
  assertValidBxlProfile(programOrNode, { profile: 'predicate' });
  const node = programOrNode.type === 'program'
    ? programOrNode.body
    : programOrNode;
  if (!node) {
    throw new BxlPredicateSqlError('Cannot compile an empty BXL predicate.');
  }
  const compiler = new PredicateSqlCompiler(options);
  return compiler.compile(node);
}

class PredicateSqlCompiler {
  private readonly params: unknown[] = [];

  constructor(private readonly options: BxlPredicateSqlOptions) {}

  compile(node: BxlAstNode): BxlPredicateSqlResult {
    return {
      sql: this.compileBoolean(node),
      params: this.params,
    };
  }

  private compileBoolean(node: BxlAstNode): string {
    if (node.type === 'binary') {
      if (node.operator === 'and' || node.operator === 'or') {
        const keyword = node.operator.toUpperCase();
        return `(${this.compileBoolean(node.left)} ${keyword} ${this.compileBoolean(node.right)})`;
      }

      if (node.operator === '|') {
        return this.compilePredicatePipe(node.left, node.right);
      }

      if (isComparisonOperator(node.operator)) {
        return this.compileComparison(node.operator, node.left, node.right);
      }
    }

    if (node.type === 'call') {
      const name = node.name.toLowerCase();
      if (name === 'present') {
        this.expectArity(node, 1);
        const value = this.compileValue(node.args[0], 'text');
        return `((${value.sql}) IS NOT NULL AND CAST((${value.sql}) AS text) <> '')`;
      }
      if (name === 'matches') {
        this.expectArity(node, 1);
        const query = this.compileValue(node.args[0], 'text');
        return this.options.matchesToSql
          ? this.options.matchesToSql(query)
          : `(to_tsvector('english', coalesce(${this.options.searchTextSql ?? '"search_text"'}, '')) @@ websearch_to_tsquery('english', ${query.sql}))`;
      }
      if (name === 'between') {
        this.expectArity(node, 3);
        return this.compileBetween(node.args[0], node.args[1], node.args[2]);
      }
      if (name === 'like') {
        this.expectArity(node, 2);
        return this.compileLike(node.args[0], node.args[1]);
      }
      if (name === 'not') {
        this.expectArity(node, 1);
        return `(NOT (${this.compileBoolean(node.args[0])}))`;
      }
    }

    if (isBooleanLiteral(node)) {
      return node.value ? 'TRUE' : 'FALSE';
    }

    const value = this.compileValue(node, 'value');
    return `((${value.sql}) = TRUE)`;
  }

  private compilePredicatePipe(left: BxlAstNode, right: BxlAstNode): string {
    if (right.type !== 'call') {
      throw new BxlPredicateSqlError('Only IN(...), overlaps(...), and not predicate pipes can compile to SQL.');
    }

    if (right.name === 'IN') {
      this.expectArity(right, 1);
      return this.compileIn(left, right.args[0]);
    }

    if (right.name === 'overlaps') {
      this.expectArity(right, 1);
      return this.compileOverlaps(left, right.args[0]);
    }

    if (right.name === 'not' && right.args.length === 0) {
      return `(NOT (${this.compileBoolean(left)}))`;
    }

    throw new BxlPredicateSqlError(`Cannot compile pipe into ${right.name}() as a SQL predicate.`);
  }

  private compileComparison(
    operator: string,
    leftNode: BxlAstNode,
    rightNode: BxlAstNode,
  ): string {
    const left = this.compileValue(leftNode, 'value');
    const right = this.compileValue(rightNode, 'value');

    if (isNullLiteral(leftNode)) {
      return this.compileNullComparison(right.sql, reverseComparisonOperator(operator));
    }
    if (isNullLiteral(rightNode)) {
      return this.compileNullComparison(left.sql, operator);
    }

    const sqlOperator = operator === '==' ? '=' : operator === '!=' ? '<>' : operator;
    return `((${left.sql}) ${sqlOperator} (${right.sql}))`;
  }

  private compileBetween(
    valueNode: BxlAstNode,
    lowerNode: BxlAstNode,
    upperNode: BxlAstNode,
  ): string {
    const value = this.compileValue(valueNode, 'value');
    const lower = this.compileValue(lowerNode, 'value');
    const upper = this.compileValue(upperNode, 'value');
    return `((${value.sql}) BETWEEN (${lower.sql}) AND (${upper.sql}))`;
  }

  private compileLike(valueNode: BxlAstNode, patternNode: BxlAstNode): string {
    const value = this.compileValue(valueNode, 'text');
    const pattern = this.compileValue(patternNode, 'text');
    return `((${value.sql}) LIKE (${pattern.sql}))`;
  }

  private compileNullComparison(sql: string, operator: string): string {
    if (operator === '==' || operator === '=') {
      return `((${sql}) IS NULL)`;
    }
    if (operator === '!=' || operator === '<>') {
      return `((${sql}) IS NOT NULL)`;
    }
    throw new BxlPredicateSqlError(`Cannot use ${operator} with null in a SQL predicate.`);
  }

  private compileIn(valueNode: BxlAstNode, collectionNode: BxlAstNode): string {
    const value = this.compileValue(valueNode, 'value');
    const staticCollection = this.staticValue(collectionNode);
    if (staticCollection !== undefined) {
      if (!Array.isArray(staticCollection)) {
        throw new BxlPredicateSqlError('IN expects an array on the right-hand side.');
      }
      if (staticCollection.length === 0) {
        return 'FALSE';
      }
      return `((${value.sql}) IN (${staticCollection.map((item) => this.addParam(item)).join(', ')}))`;
    }

    const collection = this.compileValue(collectionNode, 'array');
    return `((${value.sql}) = ANY(${collection.sql}))`;
  }

  private compileOverlaps(leftNode: BxlAstNode, rightNode: BxlAstNode): string {
    const leftStatic = this.staticValue(leftNode);
    const rightStatic = this.staticValue(rightNode);

    if (Array.isArray(leftStatic) && leftStatic.length === 0) {
      return 'FALSE';
    }
    if (Array.isArray(rightStatic) && rightStatic.length === 0) {
      return 'FALSE';
    }

    const left = Array.isArray(leftStatic)
      ? this.sqlArray(leftStatic)
      : this.compileValue(leftNode, 'array').sql;
    const right = Array.isArray(rightStatic)
      ? this.sqlArray(rightStatic)
      : this.compileValue(rightNode, 'array').sql;

    return `((${left}) && (${right}))`;
  }

  private compileValue(
    node: BxlAstNode,
    usage: BxlPredicateSqlPathUsage,
  ): BxlPredicateSqlValue {
    if (node.type === 'literal') {
      return { sql: this.literalSql(node), usage };
    }

    if (node.type === 'path') {
      return { sql: this.sqlForCurrentPath(node, usage), usage };
    }

    if (node.type === 'contextPath') {
      if (node.root === 'Record') {
        return { sql: this.sqlForRecordPath(node, usage), usage };
      }
      return { sql: this.addParam(this.resolveContextValue(node)), usage };
    }

    if (node.type === 'unary' && node.operator === '-') {
      const value = this.compileValue(node.expr, usage);
      return { sql: `(-(${value.sql}))`, usage };
    }

    if (node.type === 'binary' && node.operator === '//') {
      const left = this.compileValue(node.left, usage);
      const right = this.compileValue(node.right, usage);
      return { sql: `COALESCE((${left.sql}), (${right.sql}))`, usage };
    }

    if (node.type === 'binary' && isArithmeticOperator(node.operator)) {
      const left = this.compileValue(node.left, usage);
      const right = this.compileValue(node.right, usage);
      return {
        sql: `((${left.sql}) ${node.operator} (${right.sql}))`,
        usage,
      };
    }

    if (node.type === 'call' && node.name.toLowerCase() === 'age') {
      this.expectArity(node, 1);
      const value = this.compileValue(node.args[0], 'timestamp');
      return {
        sql: this.options.ageToSql
          ? this.options.ageToSql(value)
          : `AGE(${value.sql})`,
        usage,
      };
    }

    if (node.type === 'array') {
      const value = this.staticValue(node);
      if (!Array.isArray(value)) {
        throw new BxlPredicateSqlError('Only literal arrays can compile as SQL values.');
      }
      return { sql: this.sqlArray(value), usage: 'array' };
    }

    throw new BxlPredicateSqlError(`Cannot compile ${node.type} as a SQL value.`);
  }

  private literalSql(node: BxlLiteralNode): string {
    switch (node.valueType) {
      case 'string':
      case 'number':
      case 'boolean':
        return this.addParam(node.value);
      case 'null':
        return 'NULL';
      case 'interpolated-string':
        throw new BxlPredicateSqlError('Interpolated strings cannot compile to SQL predicate parameters.');
    }
  }

  private staticValue(node: BxlAstNode): unknown | undefined {
    if (node.type === 'literal') {
      if (node.valueType === 'interpolated-string') {
        throw new BxlPredicateSqlError('Interpolated strings cannot compile to SQL predicate parameters.');
      }
      return node.value;
    }

    if (node.type === 'array') {
      return this.arrayItems(node).map((item) => {
        const value = this.staticValue(item);
        if (value === undefined) {
          throw new BxlPredicateSqlError('Only literal or context-backed arrays can compile to SQL arrays.');
        }
        return value;
      });
    }

    if (node.type === 'contextPath' && node.root !== 'Record') {
      return this.resolveContextValue(node);
    }

    return undefined;
  }

  private arrayItems(node: Extract<BxlAstNode, { type: 'array' }>): BxlAstNode[] {
    if (!node.expr) {
      return [];
    }
    return flattenComma(node.expr);
  }

  private sqlArray(values: unknown[]): string {
    if (values.length === 0) {
      return 'ARRAY[]';
    }
    return `ARRAY[${values.map((value) => this.addParam(value)).join(', ')}]`;
  }

  private sqlForCurrentPath(
    node: BxlPathNode,
    usage: BxlPredicateSqlPathUsage,
  ): string {
    return this.sqlForPath({ root: 'current', parts: pathParts(node.parts) }, usage);
  }

  private sqlForRecordPath(
    node: BxlContextPathNode,
    usage: BxlPredicateSqlPathUsage,
  ): string {
    return this.sqlForPath({ root: 'Record', parts: pathParts(node.parts) }, usage);
  }

  private sqlForPath(
    path: BxlPredicateSqlPath,
    usage: BxlPredicateSqlPathUsage,
  ): string {
    if (path.parts.length === 0) {
      throw new BxlPredicateSqlError('A SQL predicate path must name a field.');
    }
    return this.options.pathToSql
      ? this.options.pathToSql(path, usage)
      : path.parts.map(quoteIdentifier).join('.');
  }

  private resolveContextValue(node: BxlContextPathNode): unknown {
    const roots = contextRootCandidates(node.root);
    let value: unknown = undefined;
    let found = false;
    for (const root of roots) {
      if (
        this.options.context &&
        Object.prototype.hasOwnProperty.call(this.options.context, root)
      ) {
        value = this.options.context[root];
        found = true;
        break;
      }
    }

    if (!found) {
      throw new BxlPredicateSqlError(`Missing context value for ${node.root}.`);
    }

    for (const part of node.parts) {
      if (part.type !== 'field' && part.type !== 'index') {
        throw new BxlPredicateSqlError(`Context path ${node.root} contains an unpushable path segment.`);
      }
      const key = part.type === 'field' ? part.key : part.value;
      if (value == null || typeof value !== 'object') {
        throw new BxlPredicateSqlError(`Missing context value for ${node.root}.${String(key)}.`);
      }
      value = (value as Record<string | number, unknown>)[key];
    }
    return value;
  }

  private addParam(value: unknown): string {
    this.params.push(value);
    const index = this.params.length;
    return this.options.placeholder
      ? this.options.placeholder(index, value)
      : `$${index}`;
  }

  private expectArity(node: Extract<BxlAstNode, { type: 'call' }>, arity: number): void {
    if (node.args.length !== arity) {
      throw new BxlPredicateSqlError(`${node.name}() expects ${arity} argument${arity === 1 ? '' : 's'}.`);
    }
  }
}

function flattenComma(node: BxlAstNode): BxlAstNode[] {
  if (node.type === 'binary' && node.operator === ',') {
    return [...flattenComma(node.left), ...flattenComma(node.right)];
  }
  return [node];
}

function pathParts(parts: BxlPathPart[]): string[] {
  return parts.map((part) => {
    if (part.type === 'field') {
      return part.key;
    }
    if (part.type === 'index') {
      return String(part.value);
    }
    throw new BxlPredicateSqlError('Iterator, slice, and dynamic paths cannot compile to SQL predicates.');
  });
}

function contextRootCandidates(root: string): string[] {
  if (root.startsWith('@')) {
    return [root, root.slice(1)];
  }
  if (root.startsWith('$')) {
    return [root, root.slice(1)];
  }
  return [root];
}

function isComparisonOperator(operator: string): boolean {
  return ['==', '!=', '<', '<=', '>', '>='].includes(operator);
}

function isArithmeticOperator(operator: string): boolean {
  return ['+', '-', '*', '/', '%'].includes(operator);
}

function reverseComparisonOperator(operator: string): string {
  switch (operator) {
    case '<':
      return '>';
    case '<=':
      return '>=';
    case '>':
      return '<';
    case '>=':
      return '<=';
    default:
      return operator;
  }
}

function isNullLiteral(node: BxlAstNode): boolean {
  return node.type === 'literal' && node.valueType === 'null';
}

function isBooleanLiteral(
  node: BxlAstNode,
): node is Extract<BxlLiteralNode, { valueType: 'boolean' }> {
  return node.type === 'literal' && node.valueType === 'boolean';
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}
