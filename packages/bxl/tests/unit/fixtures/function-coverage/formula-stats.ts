import type { CoverageCase } from './case.ts';

// LINEST results are arrays of numbers (and "#N/A" cells); compare them
// cell by cell, numbers within a relative tolerance.
function closeTo(expected: unknown, tolerance = 1e-9) {
  const near = (a: unknown, e: unknown, path: string): void => {
    if (Array.isArray(e)) {
      if (!Array.isArray(a) || a.length !== e.length) {
        throw new Error(
          `${path}: expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`,
        );
      }
      e.forEach((cell, i) => near(a[i], cell, `${path}[${i}]`));
      return;
    }
    if (typeof e === 'number') {
      if (
        typeof a !== 'number' ||
        Math.abs(a - e) > tolerance * Math.max(1, Math.abs(e))
      ) {
        throw new Error(`${path}: expected ${e}, got ${JSON.stringify(a)}`);
      }
      return;
    }
    if (a !== e)
      throw new Error(
        `${path}: expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`,
      );
  };
  return (outputs: unknown[]) => {
    if (outputs.length !== 1) throw new Error('expected a single output');
    near(outputs[0], expected, 'result');
  };
}

// Microsoft's LINEST example 3: assessed value of 11 office buildings from
// floor space, offices, entrances and age.
const OFFICES = [
  [2310, 2, 2, 20, 142000],
  [2333, 2, 2, 12, 144000],
  [2356, 3, 1.5, 33, 151000],
  [2379, 3, 2, 43, 150000],
  [2402, 2, 3, 53, 139000],
  [2425, 4, 2, 23, 169000],
  [2448, 2, 1.5, 99, 126000],
  [2471, 2, 2, 34, 142900],
  [2494, 3, 3, 23, 163000],
  [2517, 4, 4, 55, 169000],
  [2540, 2, 3, 22, 149000],
];
const OFFICES_Y = JSON.stringify(OFFICES.map((r) => r[4]));
const OFFICES_X = JSON.stringify(OFFICES.map((r) => r.slice(0, 4)));

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
  // LINEST: least squares with Excel's argument shapes and result layout.
  // Coefficients come back in reverse variable order, then the intercept.
  // Expected values from Microsoft's LINEST examples, and exact rational
  // arithmetic for the rest.
  {
    covers: 'LINEST/1',
    // No x: x is {1, 2, 3}. Fit of [1, 2, 4] is 1.5x − 2/3.
    source: 'LINEST([1, 2, 4])',
    check: closeTo([1.5, -2 / 3]),
  },
  {
    covers: 'LINEST/2',
    source: 'LINEST([1, 9, 5, 7], [0, 4, 2, 3])',
    check: closeTo([2, 1]),
  },
  {
    covers: 'LINEST/3',
    // const FALSE forces the line through the origin.
    source: 'LINEST([1, 9, 5, 7], [0, 4, 2, 3], false)',
    check: closeTo([2.310344828, 0], 1e-9),
  },
  {
    covers: 'LINEST/4',
    // Through the origin with stats: se_b is #N/A, R² is uncentred, df = n − k.
    source: 'LINEST([1, 9, 5, 7], [0, 4, 2, 3], false, true)',
    check: closeTo(
      [
        [2.310344828, 0],
        [0.1177810433, '#N/A'],
        [0.9922634836, 0.6342703293],
        [384.7714286, 3],
        [154.7931034, 1.206896552],
      ],
      1e-9,
    ),
  },
  {
    covers: 'LINEST/4',
    // Microsoft example 3: four variables, intercept and stats.
    source: `LINEST(${OFFICES_Y}, ${OFFICES_X}, true, true)`,
    check: closeTo(
      [
        [-234.2371645, 2553.21066, 12529.76817, 27.64138737, 52317.83051],
        [13.26801148, 530.6691519, 400.0668382, 5.429374042, 12237.3616],
        [0.996747993, 970.5784629, '#N/A', '#N/A', '#N/A'],
        [459.7536742, 6, '#N/A', '#N/A', '#N/A'],
        [1732393319, 5652135.316, '#N/A', '#N/A', '#N/A'],
      ],
      1e-8,
    ),
  },
  {
    covers: 'LINEST/4',
    // Two variables through the origin, x given one row per observation.
    source:
      'LINEST([3, 5, 8, 9, 13], [[1, 2], [2, 1], [3, 3], [4, 2], [5, 4]], false, true)',
    check: closeTo(
      [
        [0.619047619, 2.047619048, 0],
        [0.2038925806, 0.1603096022, '#N/A'],
        [0.9987684729, 0.377964473, '#N/A'],
        [1216.5, 3, '#N/A'],
        [347.5714286, 0.4285714286, '#N/A'],
      ],
      1e-9,
    ),
  },
  {
    covers: 'LINEST/4',
    // An exact fit: standard errors 0, R² 1, F #N/A.
    source: 'LINEST([1, 9, 5, 7], [0, 4, 2, 3], true, true)',
    check: closeTo(
      [
        [2, 1],
        [0, 0],
        [1, 0],
        ['#N/A', 2],
        [35, 0],
      ],
      1e-9,
    ),
  },
  {
    covers: 'LINEST/4',
    // Collinear columns (the second is twice the first): one is dropped with
    // coefficient 0 and se 0, and df counts only the kept column. Which of
    // the two Excel drops is undocumented; here pivoting keeps the larger.
    source:
      'LINEST([1, 2, 3, 4, 5], [[1, 2], [2, 4], [3, 6], [4, 8], [5, 10]], true, true)',
    check: closeTo(
      [
        [0.5, 0, 0],
        [0, 0, 0],
        [1, 0, '#N/A'],
        ['#N/A', 3, '#N/A'],
        [10, 0, '#N/A'],
      ],
      1e-9,
    ),
  },
  {
    covers: 'LINEST/2',
    // A one-row y reads each row of x as a variable.
    source: 'LINEST([[3, 5, 8, 9, 13]], [[1, 2, 3, 4, 5], [2, 1, 3, 2, 4]])',
    check: closeTo([2 / 3, 31 / 15, -1 / 5], 1e-9),
  },
  {
    covers: 'LINEST/2',
    // x rows must match y's length.
    source: 'LINEST([1, 2, 3], [1, 2])',
    throws: /#REF!/,
  },
  {
    covers: 'LINEST/2',
    source: 'LINEST([1, 2, "three"], [1, 2, 3])',
    throws: /#VALUE!/,
  },
  {
    covers: 'RSQ/2',
    // r² for the regression data set: (√0.6)² = 0.6.
    source: 'RSQ([2, 4, 5, 4, 5], [1, 2, 3, 4, 5])',
    expected: 0.6,
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
