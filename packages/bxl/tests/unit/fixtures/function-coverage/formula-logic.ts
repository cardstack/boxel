import type { CoverageCase } from './case.ts';

const scored = { score: 85 };

export const formulaLogicCases: CoverageCase[] = [
  // Branching.
  //
  // A wholly scalar IF/IFS program is answered by the compiled-scalar fast
  // path, which carries its own copy of both and never reaches the builtin.
  // The blank guard on each condition keeps these programs on the builtin
  // route, which is also where a non-scalar formula lands in production.
  { covers: 'TRUE/0', source: 'TRUE()', expected: true },
  { covers: 'FALSE/0', source: 'FALSE()', expected: false },
  {
    covers: 'IF/3',
    source: 'IF(ISBLANK(.nickname), "anonymous", "known")',
    input: { nickname: null },
    expected: 'anonymous',
  },
  // With the else branch omitted, a false condition yields Excel's FALSE.
  {
    covers: 'IF/2',
    source: 'IF(ISBLANK(.nickname), "anonymous")',
    input: { nickname: 'Ada' },
    expected: false,
  },
  // A condition is read with jq truthiness, not Excel's: only null and false
  // are false, so the number 0 takes the true branch where Excel takes the
  // false one. The compiled-scalar copy of IF reads truthiness the same way.
  // The blank call in the branch that is not taken is what keeps this program
  // off the fast path and on the builtin this case covers.
  {
    covers: 'IF/3',
    source: 'IF(.count, "some", ISBLANK(.count))',
    input: { count: 0 },
    expected: 'some',
  },
  // One grading ladder per IFS arity, each won by a different band.
  {
    covers: 'IFS/4',
    source: 'IFS(ISBLANK(.score), "unscored", .score >= 90, "A")',
    input: { score: 95 },
    expected: 'A',
  },
  {
    covers: 'IFS/6',
    source:
      'IFS(ISBLANK(.score), "unscored", .score >= 90, "A", .score >= 80, "B")',
    input: scored,
    expected: 'B',
  },
  {
    covers: 'IFS/8',
    source:
      'IFS(ISBLANK(.score), "unscored", .score >= 90, "A", .score >= 80, "B", .score >= 70, "C")',
    input: { score: 75 },
    expected: 'C',
  },
  // 85 satisfies the C and D bands too; the first true pair must win.
  {
    covers: 'IFS/10',
    source:
      'IFS(ISBLANK(.score), "unscored", .score >= 90, "A", .score >= 80, "B", .score >= 70, "C", .score >= 60, "D")',
    input: scored,
    expected: 'B',
  },
  // No pair matches: IFS has no default arm and falls through to #N/A.
  {
    covers: 'IFS/12',
    source:
      'IFS(ISBLANK(.score), "unscored", .score >= 90, "A", .score >= 80, "B", .score >= 70, "C", .score >= 60, "D", .score >= 50, "E")',
    input: { score: 30 },
    throws: /#N\/A/,
  },
  {
    covers: 'IFS/14',
    source:
      'IFS(ISBLANK(.score), "unscored", .score >= 90, "A", .score >= 80, "B", .score >= 70, "C", .score >= 60, "D", .score >= 50, "E", .score >= 40, "F")',
    input: { score: 45 },
    expected: 'F',
  },
  {
    covers: 'IFS/16',
    source:
      'IFS(ISBLANK(.score), "unscored", .score >= 90, "A", .score >= 80, "B", .score >= 70, "C", .score >= 60, "D", .score >= 50, "E", .score >= 40, "F", .score >= 30, "G")',
    input: { score: null },
    expected: 'unscored',
  },
  // The readable compiler packs SWITCH's variadic arguments into one array,
  // hence arity 1: [expr, match1, result1, ..., default].
  { covers: 'SWITCH/1', source: 'SWITCH("b", "a", 1, "b", 2, 0)', expected: 2 },
  // An odd argument count means the last one is a default, taken when no arm
  // matches; without it an unmatched value is #N/A.
  { covers: 'SWITCH/1', source: 'SWITCH("z", "a", 1, "b", 2, 0)', expected: 0 },
  {
    covers: 'SWITCH/1',
    source: 'SWITCH("z", "a", 1, "b", 2)',
    throws: /#N\/A/,
  },
  // Error sentinels
  { covers: 'NA/0', source: 'NA()', throws: /#N\/A/ },
  { covers: 'ERROR_TYPE/1', source: 'ERROR_TYPE(MOD(1, 0))', expected: 2 },
  { covers: 'IFERROR/2', source: 'IFERROR(MOD(1, 0), 0)', expected: 0 },
  { covers: 'IFNA/2', source: 'IFNA(NA(), "missing")', expected: 'missing' },
  // IFNA catches only #N/A; other errors pass through.
  { covers: 'IFNA/2', source: 'IFNA(MOD(1, 0), 0)', throws: /#DIV\/0!/ },
  { covers: 'ISERROR/1', source: 'ISERROR(NA())', expected: true },
  // #N/A is the one error ISERR does not count.
  { covers: 'ISERR/1', source: 'ISERR(NA())', expected: false },
  { covers: 'ISERR/1', source: 'ISERR(MOD(1, 0))', expected: true },
  { covers: 'ISNA/1', source: 'ISNA(NA())', expected: true },
  // Combinators. The packed array is the range, so text entries are ignored
  // rather than raising #VALUE!.
  { covers: 'AND/1', source: 'AND([true, "text", true])', expected: true },
  { covers: 'OR/1', source: 'OR([false, "text"])', expected: false },
  // XOR is a parity check, not any-true: three trues stay true.
  { covers: 'XOR/1', source: 'XOR([true, true, true])', expected: true },
  // Readable syntax lowers NOT(x) to jq `not`, so the Excel builtin — which
  // applies Excel truthiness and rejects text — is reachable only in
  // canonical jq.
  { covers: 'NOT/1', source: 'NOT(0)', readableSyntax: false, expected: true },
  // Information functions
  // Excel-strict: only null is blank; an empty string is not.
  { covers: 'ISBLANK/1', source: 'ISBLANK("")', expected: false },
  // A non-integer argument is truncated toward zero before the parity test.
  { covers: 'ISEVEN/1', source: 'ISEVEN(2.5)', expected: true },
  {
    covers: 'ISEVEN/1',
    source: 'ISEVEN(-2.5)',
    expected: true,
  },
  { covers: 'ISODD/1', source: 'ISODD(3.5)', expected: true },
  {
    covers: 'ISODD/1',
    source: 'ISODD(-2.5)',
    expected: false,
  },
  { covers: 'ISLOGICAL/1', source: 'ISLOGICAL(FALSE())', expected: true },
  // Numeric text is still text, never a number.
  { covers: 'ISNUMBER/1', source: 'ISNUMBER("5")', expected: false },
  { covers: 'ISTEXT/1', source: 'ISTEXT("")', expected: true },
  { covers: 'ISNONTEXT/1', source: 'ISNONTEXT(null)', expected: true },
  { covers: 'N/1', source: 'N(TRUE())', expected: 1 },
  // Excel type codes: 1 number, 2 text, 4 logical, 16 error, 64 array.
  { covers: 'TYPE/1', source: 'TYPE([1, 2])', expected: 64 },
  // BXL predicate helpers
  // Both bounds are inclusive.
  { covers: 'between/3', source: 'between(10, 1, 10)', expected: true },
  {
    covers: 'implies/2',
    source: 'implies(.premium, present(.account))',
    input: { premium: true, account: null },
    expected: false,
  },
  // A false premise passes vacuously.
  {
    covers: 'when/2',
    source: 'when(.premium, present(.account))',
    input: { premium: false, account: null },
    expected: true,
  },
  // Unlike ISBLANK, present treats the empty string as absent.
  {
    covers: 'present/1',
    source: 'present(.name)',
    input: { name: '' },
    expected: false,
  },
  {
    covers: 'nonempty/1',
    source: 'nonempty(.tags)',
    input: { tags: ['a', '', null, 'b'] },
    expected: ['a', 'b'],
  },
  {
    covers: 'overlaps/1',
    source: '.tags | overlaps(["billing", "legal"])',
    input: { tags: ['sales', 'billing'] },
    expected: true,
  },
];
