import { readFileSync } from 'node:fs';
import { deepStrictEqual, ok, strictEqual } from 'node:assert';

interface TextMatePattern {
  name?: string;
  match?: string;
  begin?: string;
  end?: string;
  patterns?: TextMatePattern[];
  include?: string;
}

interface TextMateGrammar {
  name: string;
  scopeName: string;
  fileTypes: string[];
  patterns: TextMatePattern[];
  repository: Record<string, { patterns: TextMatePattern[] }>;
}

const grammarUrl = new URL(
  '../../src/bxl/syntax/bxl.tmLanguage.json',
  import.meta.url,
);
const grammar = JSON.parse(readFileSync(grammarUrl, 'utf8')) as TextMateGrammar;

strictEqual(grammar.name, 'BXL');
strictEqual(grammar.scopeName, 'source.bxl');
deepStrictEqual(grammar.fileTypes, ['bxl', 'jqxl', 'jqxlexpr']);

const requiredRepositories = [
  'selectors',
  'comments',
  'strings',
  'variables',
  'formats',
  'excel-functions',
  'jq-functions',
  'keywords',
  'constants',
  'numbers',
  'members',
  'operators',
  'punctuation',
];

for (const key of requiredRepositories) {
  ok(grammar.repository[key], `expected ${key} repository`);
}

function visitPatterns(patterns: TextMatePattern[], visitor: (pattern: TextMatePattern) => void) {
  for (const pattern of patterns) {
    visitor(pattern);
    if (pattern.patterns) {
      visitPatterns(pattern.patterns, visitor);
    }
  }
}

for (const collection of Object.values(grammar.repository)) {
  visitPatterns(collection.patterns, (pattern) => {
    if (pattern.match) {
      new RegExp(pattern.match);
    }
    if (pattern.begin) {
      new RegExp(pattern.begin);
    }
    if (pattern.end) {
      new RegExp(pattern.end);
    }
  });
}

function firstMatch(repositoryKey: string, sample: string): string | undefined {
  const patterns = grammar.repository[repositoryKey].patterns;
  return patterns.find((pattern) => pattern.match && new RegExp(pattern.match).test(sample))?.name;
}

strictEqual(firstMatch('comments', '# comment'), 'comment.line.number-sign.bxl');
strictEqual(firstMatch('comments', '#3'), undefined);
strictEqual(firstMatch('variables', '$root'), 'variable.other.dollar.bxl');
strictEqual(firstMatch('formats', '@json'), 'support.function.format.bxl');
strictEqual(firstMatch('excel-functions', 'ROUND('), 'support.function.excel.bxl');
strictEqual(firstMatch('validation-functions', 'isEmail('), 'support.function.validation.bxl');
strictEqual(firstMatch('jq-functions', 'map('), 'support.function.jq.bxl');
strictEqual(firstMatch('selectors', 'row 4'), 'keyword.other.selector-row.bxl');
strictEqual(firstMatch('selectors', '#3'), 'constant.numeric.zero-based-index.bxl');
strictEqual(firstMatch('selectors', '#-2'), 'constant.numeric.zero-based-index.bxl');
strictEqual(firstMatch('selectors', '#last'), 'keyword.other.selector-hash.bxl');
strictEqual(firstMatch('selectors', '#last-3'), 'keyword.other.selector-hash.bxl');
strictEqual(firstMatch('numbers', '89.04'), 'constant.numeric.bxl');
strictEqual(firstMatch('keywords', 'IN'), 'keyword.operator.predicate.bxl');
strictEqual(firstMatch('keywords', 'LIKE'), 'keyword.operator.predicate.bxl');
strictEqual(firstMatch('keywords', 'BETWEEN'), 'keyword.operator.predicate.bxl');
strictEqual(firstMatch('jq-functions', 'overlaps('), 'support.function.jq.bxl');

console.log('BXL syntax highlighting grammar: validation passed');
