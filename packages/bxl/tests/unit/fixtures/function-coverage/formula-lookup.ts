import type { CoverageCase } from './case.ts';

// Shared row fixture for the `*_BY` family and the column projections the
// classic range functions read. Tools rows: qty 5 + 8, total 120 + 200;
// Paint rows: qty 2 + 1, total 40 + 15; North holds rows 1 and 4.
const LEDGER = [
  { sku: 'A-1', category: 'Tools', region: 'North', qty: 5, total: 120 },
  { sku: 'B-2', category: 'Paint', region: 'South', qty: 2, total: 40 },
  { sku: 'C-3', category: 'Tools', region: 'South', qty: 8, total: 200 },
  { sku: 'D-4', category: 'Paint', region: 'North', qty: 1, total: 15 },
];

export const formulaLookupCases: CoverageCase[] = [
  // Shape helpers. COL projects one key across row objects; COLUMNS reads
  // the width of the first row; ROWS is the outer length.
  {
    covers: 'COL/2',
    source: 'COL(., "qty")',
    input: LEDGER,
    expected: [5, 2, 8, 1],
  },
  {
    covers: 'COLUMNS/1',
    source: 'COLUMNS([[1, 2, 3], [4, 5, 6]])',
    expected: 3,
  },
  { covers: 'ROWS/1', source: 'ROWS([[1, 2, 3], [4, 5, 6]])', expected: 2 },
  { covers: 'CHOOSE/2', source: 'CHOOSE(2, ["a", "b", "c"])', expected: 'b' },
  // Criteria aggregation. Criteria strings take comparison operators and
  // case-insensitive * / ? wildcards, not just equality.
  {
    covers: 'COUNTIF/2',
    source: 'COUNTIF(["north", "south", "northeast"], "north*")',
    expected: 2,
  },
  { covers: 'SUMIF/2', source: 'SUMIF([12, 40, 9, 25], ">10")', expected: 77 },
  {
    covers: 'SUMIF/3',
    source: 'SUMIF(COL(., "category"), "Tools", COL(., "total"))',
    input: LEDGER,
    expected: 320,
  },
  {
    covers: 'AVERAGEIF/2',
    source: 'AVERAGEIF([2, 4, 6, 8], ">3")',
    expected: 6,
  },
  {
    covers: 'AVERAGEIF/3',
    source: 'AVERAGEIF(COL(., "region"), "North", COL(., "qty"))',
    input: LEDGER,
    expected: 3,
  },
  // The `*_BY` variants take the value key BEFORE the criteria key — the
  // reverse of Excel's SUMIF, where the sum range comes last. The `*IFS_BY`
  // forms AND together an object of per-key criteria.
  {
    covers: 'COUNTIF_BY/3',
    source: 'COUNTIF_BY(., "region", "North")',
    input: LEDGER,
    expected: 2,
  },
  {
    covers: 'SUMIF_BY/4',
    source: 'SUMIF_BY(., "total", "category", "Tools")',
    input: LEDGER,
    expected: 320,
  },
  {
    covers: 'AVERAGEIF_BY/4',
    source: 'AVERAGEIF_BY(., "qty", "category", "Tools")',
    input: LEDGER,
    expected: 6.5,
  },
  {
    covers: 'COUNTIFS_BY/2',
    source: 'COUNTIFS_BY(., { category: "Paint", region: "South" })',
    input: LEDGER,
    expected: 1,
  },
  {
    covers: 'SUMIFS_BY/3',
    source: 'SUMIFS_BY(., "total", { category: "Tools", region: "South" })',
    input: LEDGER,
    expected: 200,
  },
  {
    covers: 'AVERAGEIFS_BY/3',
    source: 'AVERAGEIFS_BY(., "qty", { region: "South" })',
    input: LEDGER,
    expected: 5,
  },
  // MATCH returns a 1-based position; the default match type 1 finds the
  // largest value <= the lookup in an ascending array.
  { covers: 'MATCH/2', source: 'MATCH(7, [1, 3, 5, 9])', expected: 3 },
  {
    covers: 'MATCH/3',
    source: 'MATCH("beta", ["alpha", "beta", "gamma"], 0)',
    expected: 2,
  },
  // INDEX over a 1-D array treats the single index as the position.
  { covers: 'INDEX/2', source: 'INDEX(["a", "b", "c"], 2)', expected: 'b' },
  { covers: 'INDEX/3', source: 'INDEX([[1, 2], [3, 4]], 2, 1)', expected: 3 },
  // `def INDEX` delegates to a differently named worker, because a jq
  // definition wins over a native of the same key: an `INDEX` definition
  // calling `INDEX` would only recurse. The worker is callable in its own
  // right, so it is pinned here rather than only through the wrapper.
  {
    covers: '_EXCEL_INDEX/2',
    source: '_EXCEL_INDEX(["a", "b", "c"]; 2)',
    readableSyntax: false,
    expected: 'b',
  },
  {
    covers: '_EXCEL_INDEX/3',
    source: '_EXCEL_INDEX([[1, 2], [3, 4]]; 2; 1)',
    readableSyntax: false,
    expected: 3,
  },
  // Legacy vector LOOKUP: without a result vector it returns from the lookup
  // vector itself, approximate (largest value <= lookup, ascending data).
  { covers: 'LOOKUP/2', source: 'LOOKUP(6, [1, 4, 9])', expected: 4 },
  {
    covers: 'LOOKUP/3',
    source: 'LOOKUP(4, [1, 4, 9], ["low", "mid", "high"])',
    expected: 'mid',
  },
  {
    covers: 'LOOKUP_BY/4',
    source: 'LOOKUP_BY(., "sku", "C-3", "total")',
    input: LEDGER,
    expected: 200,
  },
  // VLOOKUP/HLOOKUP default to approximate match, which requires the lookup
  // row/column sorted ascending; the 4-arg forms pass the flag explicitly.
  {
    covers: 'VLOOKUP/3',
    source: 'VLOOKUP(35, [[10, "bronze"], [25, "silver"], [50, "gold"]], 2)',
    expected: 'silver',
  },
  {
    covers: 'VLOOKUP/4',
    source: 'VLOOKUP("B-2", [["A-1", 120], ["B-2", 40]], 2, false)',
    expected: 40,
  },
  {
    covers: 'HLOOKUP/3',
    source: 'HLOOKUP(50, [[1, 10, 100], ["one", "ten", "hundred"]], 2)',
    expected: 'ten',
  },
  {
    covers: 'HLOOKUP/4',
    source: 'HLOOKUP("Q2", [["Q1", "Q2", "Q3"], [100, 140, 180]], 2, false)',
    expected: 140,
  },
  // VLOOKUP_BY defaults to exact match; the 5-arg form opts into approximate
  // banding over a sorted key column.
  {
    covers: 'VLOOKUP_BY/4',
    source: 'VLOOKUP_BY(., "sku", "B-2", "total")',
    input: LEDGER,
    expected: 40,
  },
  {
    covers: 'VLOOKUP_BY/5',
    source: 'VLOOKUP_BY(., "min", 250, "tier", true)',
    input: [
      { min: 0, tier: 'basic' },
      { min: 100, tier: 'silver' },
      { min: 500, tier: 'gold' },
    ],
    expected: 'silver',
  },
  // XLOOKUP arities: /4 adds the not-found value, /5 the match mode
  // (-1 = next smaller), /6 the search mode (-1 = last-to-first).
  {
    covers: 'XLOOKUP/3',
    source: 'XLOOKUP("B", ["A", "B", "C"], [1, 2, 3])',
    expected: 2,
  },
  {
    covers: 'XLOOKUP/4',
    source: 'XLOOKUP("Z", ["A", "B"], [1, 2], "none")',
    expected: 'none',
  },
  {
    covers: 'XLOOKUP/5',
    source:
      'XLOOKUP(35, [10, 25, 50], ["bronze", "silver", "gold"], "none", -1)',
    expected: 'silver',
  },
  {
    covers: 'XLOOKUP/6',
    source: 'XLOOKUP("A", ["A", "B", "A"], [1, 2, 3], "none", 0, -1)',
    expected: 3,
  },
];
