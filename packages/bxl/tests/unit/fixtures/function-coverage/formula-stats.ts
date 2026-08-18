import type { CoverageCase } from './case.ts';

export const formulaStatsCases: CoverageCase[] = [
  // Counting trio: one input where all three answers differ — COUNT sees only
  // the numbers, COUNTA everything non-blank, COUNTBLANK only the blanks.
  {
    covers: 'COUNT/1',
    source: 'COUNT([1, 2, "hello", null, 3, null])',
    expected: 3,
  },
  {
    covers: 'COUNTA/1',
    source: 'COUNTA([1, 2, "hello", null, 3, null])',
    expected: 4,
  },
  {
    covers: 'COUNTBLANK/1',
    source: 'COUNTBLANK([1, 2, "hello", null, 3, null])',
    expected: 2,
  },
  {
    covers: 'AVERAGE/1',
    source: 'AVERAGE([2, 4, 6, 8])',
    expected: 5,
  },
  {
    covers: 'MAX/1',
    source: 'MAX([3, 8, 5])',
    expected: 8,
  },
  {
    covers: 'MIN/1',
    source: 'MIN([3, 8, 5])',
    expected: 3,
  },
  // MAXIFS/MINIFS take one list argument packing
  // [values, criteria_range, criteria] — not separate range arguments.
  {
    covers: 'MAXIFS/1',
    source: 'MAXIFS([[10, 40, 25], ["east", "west", "east"], "east"])',
    expected: 25,
  },
  {
    covers: 'MINIFS/1',
    source: 'MINIFS([[10, 40, 25], ["east", "west", "east"], "east"])',
    expected: 10,
  },
  {
    covers: 'MEDIAN/1',
    source: 'MEDIAN([1, 3, 6, 10])',
    expected: 4.5,
  },
  {
    covers: 'LARGE/2',
    source: 'LARGE([3, 5, 3, 8, 1], 2)',
    expected: 5,
  },
  {
    covers: 'SMALL/2',
    // Distinct values, so k and k+1 give different answers and an off-by-one
    // in the rank shows up.
    source: 'SMALL([3, 5, 8, 1, 9], 2)',
    expected: 3,
  },
  // Sample vs population spread: Σ(x−x̄)² = 32 for this set, so the sample
  // divisor (n−1 = 7) and population divisor (n = 8) give clearly different
  // answers — 32/7 ≈ 4.571 vs 32/8 = 4 — and a mixed-up divisor fails.
  {
    covers: 'STDEV/1',
    source: 'STDEV([2, 4, 4, 4, 5, 5, 7, 9])',
    expected: 2.1380899353,
    tolerance: 1e-9,
  },
  {
    covers: 'STDEV_S/1',
    source: 'STDEV_S([2, 4, 4, 4, 5, 5, 7, 9])',
    expected: 2.1380899353,
    tolerance: 1e-9,
  },
  {
    covers: 'STDEV_P/1',
    source: 'STDEV_P([2, 4, 4, 4, 5, 5, 7, 9])',
    expected: 2,
  },
  {
    covers: 'VAR/1',
    source: 'VAR([2, 4, 4, 4, 5, 5, 7, 9])',
    expected: 4.5714285714,
    tolerance: 1e-9,
  },
  {
    covers: 'VAR_S/1',
    source: 'VAR_S([2, 4, 4, 4, 5, 5, 7, 9])',
    expected: 4.5714285714,
    tolerance: 1e-9,
  },
  {
    covers: 'VAR_P/1',
    source: 'VAR_P([2, 4, 4, 4, 5, 5, 7, 9])',
    expected: 4,
  },
  {
    covers: 'AVEDEV/1',
    source: 'AVEDEV([2, 4, 6, 8])',
    expected: 2,
  },
  {
    covers: 'DEVSQ/1',
    source: 'DEVSQ([4, 5, 8, 7, 11, 4, 3])',
    expected: 48,
  },
  {
    covers: 'GEOMEAN/1',
    source: 'GEOMEAN([4, 9])',
    expected: 6,
    tolerance: 1e-12,
  },
  {
    covers: 'HARMEAN/1',
    source: 'HARMEAN([2, 6])',
    expected: 3,
    tolerance: 1e-12,
  },
  // TRIMMEAN excludes floor(n·percent) points split between the two ends:
  // 5 × 0.4 = 2 excludes one from each end, so the 100 outlier drops out.
  {
    covers: 'TRIMMEAN/2',
    source: 'TRIMMEAN([1, 2, 3, 4, 100], 0.4)',
    expected: 3,
  },
  // SKEW and KURT use the sample-corrected estimators (KURT is excess
  // kurtosis, not the raw fourth moment); both values are hand-derived from
  // those definitions and agree with Excel's documented examples.
  {
    covers: 'SKEW/1',
    source: 'SKEW([3, 4, 5, 2, 3, 4, 5, 6, 4, 7])',
    expected: 0.3595430714,
    tolerance: 1e-9,
  },
  {
    covers: 'KURT/1',
    source: 'KURT([3, 4, 5, 2, 3, 4, 5, 6, 4, 7])',
    expected: -0.1517996372,
    tolerance: 1e-9,
  },
  {
    covers: 'PERMUT/2',
    source: 'PERMUT(5, 2)',
    expected: 20,
  },
  // Inclusive vs exclusive percentile definitions disagree at k = 0.3 on four
  // points: INC interpolates rank k(n−1) over [min..max], EXC rank k(n+1).
  {
    covers: 'PERCENTILE_INC/2',
    source: 'PERCENTILE_INC([1, 2, 3, 4], 0.3)',
    expected: 1.9,
    tolerance: 1e-12,
  },
  {
    covers: 'PERCENTILE_EXC/2',
    source: 'PERCENTILE_EXC([1, 2, 3, 4], 0.3)',
    expected: 1.5,
    tolerance: 1e-12,
  },
  {
    covers: 'QUARTILE_INC/2',
    source: 'QUARTILE_INC([1, 2, 3, 4, 5, 6, 7], 1)',
    expected: 2.5,
  },
  {
    covers: 'QUARTILE_EXC/2',
    source: 'QUARTILE_EXC([1, 2, 3, 4, 5, 6, 7], 1)',
    expected: 2,
  },
  // Nine points put 20 at sorted index 1: INC rank i/(n−1) = 1/8, EXC rank
  // (i+1)/(n+1) = 2/10. Both are exact in three significant digits, so
  // Excel's default result truncation (no significance argument here) is a
  // no-op and the two cases still separate the definitions.
  {
    covers: 'PERCENTRANK_INC/2',
    source: 'PERCENTRANK_INC([10, 20, 30, 40, 50, 60, 70, 80, 90], 20)',
    expected: 0.125,
  },
  {
    covers: 'PERCENTRANK_EXC/2',
    source: 'PERCENTRANK_EXC([10, 20, 30, 40, 50, 60, 70, 80, 90], 20)',
    expected: 0.2,
    tolerance: 1e-12,
  },
  // The tied 20s rank 2nd and 3rd descending: RANK_EQ gives ties the best
  // rank, RANK_AVG their average. The third argument flips to ascending when
  // nonzero, so 30 — first descending — ranks last.
  {
    covers: 'RANK_EQ/2',
    source: 'RANK_EQ(20, [10, 20, 20, 30])',
    expected: 2,
  },
  {
    covers: 'RANK_AVG/2',
    source: 'RANK_AVG(20, [10, 20, 20, 30])',
    expected: 2.5,
  },
  {
    covers: 'RANK_EQ/3',
    source: 'RANK_EQ(30, [10, 20, 20, 30], 1)',
    expected: 4,
  },
  // Regression family: arguments are (known_y, known_x) — the y series comes
  // first. Least squares on y = [2,4,5,4,5] over x = [1..5] gives slope
  // 6/10 and intercept 4 − 0.6·3; swapping the series would give slope 1,
  // so these cases pin the argument order.
  {
    covers: 'SLOPE/2',
    source: 'SLOPE([2, 4, 5, 4, 5], [1, 2, 3, 4, 5])',
    expected: 0.6,
    tolerance: 1e-12,
  },
  {
    covers: 'INTERCEPT/2',
    source: 'INTERCEPT([2, 4, 5, 4, 5], [1, 2, 3, 4, 5])',
    expected: 2.2,
    tolerance: 1e-12,
  },
  {
    covers: 'FORECAST/3',
    source: 'FORECAST(6, [2, 4, 5, 4, 5], [1, 2, 3, 4, 5])',
    expected: 5.8,
    tolerance: 1e-12,
  },
  // r = 6/√(10·6) = √0.6 for the regression data set; PEARSON and CORREL
  // are the same statistic.
  {
    covers: 'CORREL/2',
    source: 'CORREL([2, 4, 5, 4, 5], [1, 2, 3, 4, 5])',
    expected: 0.7745966692,
    tolerance: 1e-9,
  },
  {
    covers: 'PEARSON/2',
    source: 'PEARSON([2, 4, 5, 4, 5], [1, 2, 3, 4, 5])',
    expected: 0.7745966692,
    tolerance: 1e-9,
  },
];
