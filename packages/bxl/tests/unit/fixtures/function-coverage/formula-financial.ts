import { TIMEZONES, type CoverageCase } from './case.ts';

// Expected values are derived from the published Excel definitions, not from
// the implementation: zero-rate TVM results are exact quotients, nonzero-rate
// anchors come from hand-amortized two-period loans (the repeating decimals
// are written as fractions), and solver results (RATE, IRR, XIRR) invert a
// closed-form case so the root is known. Excel's cash-flow sign convention
// holds throughout: money out is negative, money in is positive, so a
// positive present value yields a negative payment.
export const formulaFinancialCases: CoverageCase[] = [
  // Time value of money. A 10%, two-period, 1000 loan amortizes to payments
  // of 12100/21; the same loan with a -100 balloon pays 3700/7 per period.
  { covers: 'FV/3', source: 'FV(0, 12, -100)', expected: 1200 },
  {
    covers: 'FV/4',
    source: 'FV(0.1, 2, 0, -100)',
    expected: 121,
    tolerance: 1e-9,
  },
  // Type 1: 100 deposited at the start of each period grows to 121 + 110.
  {
    covers: 'FV/5',
    source: 'FV(0.1, 2, -100, 0, 1)',
    expected: 231,
    tolerance: 1e-9,
  },
  { covers: 'PMT/3', source: 'PMT(0, 12, -1200)', expected: 100 },
  { covers: 'PMT/4', source: 'PMT(0, 10, -800, -200)', expected: 100 },
  // An annuity-due payment is the ordinary payment discounted one period.
  {
    covers: 'PMT/5',
    source: 'PMT(0.1, 2, -100, 0, 1)',
    expected: 1100 / 21,
    tolerance: 1e-9,
  },
  { covers: 'PV/3', source: 'PV(0, 12, -100)', expected: 1200 },
  {
    covers: 'PV/4',
    source: 'PV(0.1, 2, 0, -121)',
    expected: 100,
    tolerance: 1e-9,
  },
  {
    covers: 'PV/5',
    source: 'PV(0.1, 2, -100, 0, 1)',
    expected: 2100 / 11,
    tolerance: 1e-9,
  },
  { covers: 'NPER/3', source: 'NPER(0, -100, 1200)', expected: 12 },
  {
    covers: 'NPER/4',
    source: 'NPER(0.1, 0, -100, 121)',
    expected: 2,
    tolerance: 1e-9,
  },
  // Begin-period payments of 110/2.1 retire a 100 loan at 10% in two periods.
  {
    covers: 'NPER/5',
    source: 'NPER(0.1, -52.38095238095238, 100, 0, 1)',
    expected: 2,
    tolerance: 1e-9,
  },
  // RATE inverts PMT: 121/2.1 per period settles 100 at 10% in two periods.
  {
    covers: 'RATE/3',
    source: 'RATE(2, -57.61904761904762, 100)',
    expected: 0.1,
    tolerance: 1e-7,
  },
  // Zero-coupon: doubling in ten periods is a rate of 2^(1/10) - 1.
  {
    covers: 'RATE/4',
    source: 'RATE(10, 0, -1000, 2000)',
    expected: 2 ** 0.1 - 1,
    tolerance: 1e-7,
  },
  {
    covers: 'RATE/5',
    source: 'RATE(2, -52.38095238095238, 100, 0, 1)',
    expected: 0.1,
    tolerance: 1e-7,
  },
  // Flows of -100, +230, -132 solve to -100r^2 + 30r - 2 = 0, whose two roots
  // are 10% and 20%, so the guess decides which rate comes back: the default
  // 0.1 finds 10%, and a guess past the turning point finds 20%.
  {
    covers: 'RATE/6',
    source: 'RATE(2, 230, -100, -362, 0, 0.3)',
    expected: 0.2,
    tolerance: 1e-7,
  },
  // First-period interest on an ordinary annuity is the rate on the whole pv.
  {
    covers: 'IPMT/4',
    source: 'IPMT(0.1, 1, 3, 1000)',
    expected: -100,
    tolerance: 1e-9,
  },
  {
    covers: 'IPMT/5',
    source: 'IPMT(0.1, 2, 2, 1000, -100)',
    expected: -400 / 7,
    tolerance: 1e-9,
  },
  // Type 1 pays at the period start, so the first period accrues no interest.
  { covers: 'IPMT/6', source: 'IPMT(0.1, 1, 3, 1000, 0, 1)', expected: 0 },
  {
    covers: 'PPMT/4',
    source: 'PPMT(0.1, 1, 2, 1000)',
    expected: -10000 / 21,
    tolerance: 1e-9,
  },
  {
    covers: 'PPMT/5',
    source: 'PPMT(0.1, 2, 2, 1000, -100)',
    expected: -3300 / 7,
    tolerance: 1e-9,
  },
  {
    covers: 'PPMT/6',
    source: 'PPMT(0.1, 1, 2, 1000, 0, 1)',
    expected: -11000 / 21,
    tolerance: 1e-9,
  },
  {
    covers: 'CUMIPMT/6',
    source: 'CUMIPMT(0.1, 2, 1000, 1, 2, 0)',
    expected: -3200 / 21,
    tolerance: 1e-9,
  },
  // Principal repaid over the full term is the whole loan.
  {
    covers: 'CUMPRINC/6',
    source: 'CUMPRINC(0.1, 2, 1000, 1, 2, 0)',
    expected: -1000,
    tolerance: 1e-9,
  },
  // Even-principal loan: after one of four periods, 3/4 of 4000 still accrues.
  {
    covers: 'ISPMT/4',
    source: 'ISPMT(0.1, 1, 4, 4000)',
    expected: -300,
    tolerance: 1e-9,
  },
  // Rate-of-return family, over flows whose roots are exact.
  {
    covers: 'NPV/2',
    source: 'NPV(0.1, [110, 121])',
    expected: 200,
    tolerance: 1e-9,
  },
  {
    covers: 'NPV_BY/3',
    source: 'NPV_BY(0.1, ., "amount")',
    input: [{ amount: 110 }, { amount: 121 }],
    expected: 200,
    tolerance: 1e-9,
  },
  {
    covers: 'IRR/1',
    source: 'IRR([-100, 110])',
    expected: 0.1,
    tolerance: 1e-7,
  },
  { covers: 'IRR/1', source: 'IRR([100, 110])', throws: /#NUM!/ },
  // -1, +3, -2.5 changes sign twice but its net present value never reaches
  // zero at any rate, so there is no internal rate of return to report. The
  // iteration still ends somewhere, which is why the result is checked
  // against the series rather than taken on trust.
  { covers: 'IRR/1', source: 'IRR([-1, 3, -2.5])', throws: /#NUM!/ },
  // A rate near -100% is a root the residual cannot show: dividing by a
  // 1 + rate of a millionth multiplies rounding by the same factor, so the net
  // present value at the exact root is a millionth rather than zero. What marks
  // it is the crossing. 0.001 discounted at -99.9999% is exactly 1000.
  {
    covers: 'IRR/1',
    source: 'IRR([-1000, 0.001])',
    expected: -0.999999,
    tolerance: 1e-9,
  },
  // A double root touches zero without crossing it, so this one is carried by
  // the residual instead: 230 and -132.25 put both roots at 15%.
  {
    covers: 'IRR/1',
    source: 'IRR([-100, 230, -132.25])',
    expected: 0.15,
    tolerance: 1e-6,
  },
  // Two sign changes give -100, +230, -132 exact roots at 10% and 20%, so a
  // guess above the turning point returns the higher one. The same series
  // carries the guess arities of IRR_BY, XIRR and XIRR_BY.
  {
    covers: 'IRR/2',
    source: 'IRR([-100, 230, -132], 0.3)',
    expected: 0.2,
    tolerance: 1e-7,
  },
  {
    covers: 'IRR_BY/2',
    source: 'IRR_BY(., "cash")',
    input: [{ cash: -100 }, { cash: 110 }],
    expected: 0.1,
    tolerance: 1e-7,
  },
  {
    covers: 'IRR_BY/3',
    source: 'IRR_BY(., "cash", 0.3)',
    input: [{ cash: -100 }, { cash: 230 }, { cash: -132 }],
    expected: 0.2,
    tolerance: 1e-7,
  },
  // Equal 10% finance and reinvest rates collapse MIRR to (121/100)^(1/2)-1.
  {
    covers: 'MIRR/3',
    source: 'MIRR([-100, 0, 121], 0.1, 0.1)',
    expected: 0.1,
    tolerance: 1e-9,
  },
  // Dated flows a whole non-leap year apart make the discount exponent 1.
  {
    covers: 'XNPV/3',
    source: 'XNPV(0.1, [-100, 121], ["2023-01-01", "2024-01-01"])',
    expected: 10,
    tolerance: 1e-9,
    zones: TIMEZONES,
  },
  {
    covers: 'XNPV_BY/4',
    source: 'XNPV_BY(0.1, ., "amt", "on")',
    input: [
      { amt: -100, on: '2023-01-01' },
      { amt: 121, on: '2024-01-01' },
    ],
    expected: 10,
    tolerance: 1e-9,
    zones: TIMEZONES,
  },
  {
    covers: 'XIRR/2',
    source: 'XIRR([-1, 3, -2.5], ["2020-01-01", "2021-01-01", "2022-01-01"])',
    throws: /#NUM!/,
    zones: TIMEZONES,
  },
  {
    covers: 'XIRR/2',
    source: 'XIRR([-100, 110], ["2023-01-01", "2024-01-01"])',
    expected: 0.1,
    tolerance: 1e-7,
    zones: TIMEZONES,
  },
  // 2021 and 2022 are both non-leap, so the dated exponents are exactly 1 and
  // 2 and the two-root series above applies unchanged.
  {
    covers: 'XIRR/3',
    source:
      'XIRR([-100, 230, -132], ["2021-01-01", "2022-01-01", "2023-01-01"], 0.3)',
    expected: 0.2,
    tolerance: 1e-7,
    zones: TIMEZONES,
  },
  {
    covers: 'XIRR_BY/3',
    source: 'XIRR_BY(., "amt", "on")',
    input: [
      { amt: -100, on: '2023-01-01' },
      { amt: 110, on: '2024-01-01' },
    ],
    expected: 0.1,
    tolerance: 1e-7,
    zones: TIMEZONES,
  },
  {
    covers: 'XIRR_BY/4',
    source: 'XIRR_BY(., "amt", "on", 0.3)',
    input: [
      { amt: -100, on: '2021-01-01' },
      { amt: 230, on: '2022-01-01' },
      { amt: -132, on: '2023-01-01' },
    ],
    expected: 0.2,
    tolerance: 1e-7,
    zones: TIMEZONES,
  },
  // Rate conversions: EFFECT and NOMINAL invert each other at 10%/semiannual.
  {
    covers: 'EFFECT/2',
    source: 'EFFECT(0.1, 2)',
    expected: 0.1025,
    tolerance: 1e-12,
  },
  {
    covers: 'NOMINAL/2',
    source: 'NOMINAL(0.1025, 2)',
    expected: 0.1,
    tolerance: 1e-12,
  },
  {
    covers: 'PDURATION/3',
    source: 'PDURATION(0.1, 100, 121)',
    expected: 2,
    tolerance: 1e-9,
  },
  {
    covers: 'RRI/3',
    source: 'RRI(2, 100, 121)',
    expected: 0.1,
    tolerance: 1e-12,
  },
  {
    covers: 'FVSCHEDULE/2',
    source: 'FVSCHEDULE(100, [0.1, 0.2])',
    expected: 132,
    tolerance: 1e-9,
  },
  // Fractional-dollar notation: 1.02 in 16ths is 1 + 2/16.
  {
    covers: 'DOLLARDE/2',
    source: 'DOLLARDE(1.02, 16)',
    expected: 1.125,
    tolerance: 1e-9,
  },
  { covers: 'DOLLARDE/2', source: 'DOLLARDE(1.02, 0)', throws: /#DIV\/0!/ },
  {
    covers: 'DOLLARFR/2',
    source: 'DOLLARFR(1.125, 16)',
    expected: 1.02,
    tolerance: 1e-9,
  },
  // Depreciation of 10000 to a 1000 salvage over 5 years.
  { covers: 'SLN/3', source: 'SLN(10000, 1000, 5)', expected: 1800 },
  { covers: 'SYD/4', source: 'SYD(10000, 1000, 5, 1)', expected: 3000 },
  { covers: 'DDB/4', source: 'DDB(10000, 1000, 5, 1)', expected: 4000 },
  {
    covers: 'DDB/5',
    source: 'DDB(10000, 1000, 5, 1, 1.5)',
    expected: 3000,
    tolerance: 1e-9,
  },
  // DB rounds the declining rate to three decimals: 1 - (0.1)^(1/6) -> 0.319.
  {
    covers: 'DB/4',
    source: 'DB(1000000, 100000, 6, 1)',
    expected: 319000,
    tolerance: 1e-6,
  },
  {
    covers: 'DB/5',
    source: 'DB(1000000, 100000, 6, 1, 7)',
    expected: 2233000 / 12,
    tolerance: 1e-6,
  },
  // Bills and bonds: date pairs picked for round day counts (90 actual days
  // to April, 181 actual days / 180 on a 30-360 basis to July).
  {
    covers: 'ACCRINT/6',
    source: 'ACCRINT("2023-01-01", "2023-07-01", "2023-07-01", 0.1, 1000, 2)',
    expected: 50,
    tolerance: 1e-9,
    zones: TIMEZONES,
  },
  {
    covers: 'ACCRINT/7',
    source:
      'ACCRINT("2023-01-01", "2023-07-01", "2023-07-01", 0.1, 1000, 2, 3)',
    expected: 18100 / 365,
    tolerance: 1e-9,
    zones: TIMEZONES,
  },
  {
    covers: 'COUPDAYS/3',
    source: 'COUPDAYS("2023-01-15", "2024-01-01", 2)',
    expected: 180,
    zones: TIMEZONES,
  },
  {
    covers: 'COUPDAYS/4',
    source: 'COUPDAYS("2023-01-15", "2024-01-01", 2, 3)',
    expected: 182.5,
    zones: TIMEZONES,
  },
  // Basis 1 is actual/actual, the one convention that measures a real calendar
  // span: settlement falls in the period from 2010-11-15 to 2011-05-15, which
  // is 181 days long.
  {
    covers: 'COUPDAYS/4',
    source: 'COUPDAYS("2011-01-25", "2011-11-15", 2, 1)',
    expected: 181,
    zones: TIMEZONES,
  },
  // A maturity on the last day of the month keeps the schedule on month ends:
  // the coupon dates behind 2026-08-31 are 2026-02-28 and 2025-08-31, so
  // settlement sits in a 181-day period. Measuring each date from the one
  // before it would carry February's clamp forward to an August 28th and
  // report 184.
  {
    covers: 'COUPDAYS/4',
    source: 'COUPDAYS("2025-09-01", "2026-08-31", 2, 1)',
    expected: 181,
    zones: TIMEZONES,
  },
  // A maturity on the last day of a short month keeps the schedule on month
  // ends too: the coupon date behind 2026-02-28 is 2025-08-31, not the 28th, so
  // the period holding settlement is 181 days rather than 184.
  {
    covers: 'COUPDAYS/4',
    source: 'COUPDAYS("2026-01-15", "2026-02-28", 2, 1)',
    expected: 181,
    zones: TIMEZONES,
  },
  {
    covers: 'COUPDAYS/4',
    source: 'COUPDAYS("2027-11-15", "2028-02-29", 2, 1)',
    expected: 182,
    zones: TIMEZONES,
  },
  // The dates are checked whatever the basis, even where the answer does not
  // read them, so one argument list cannot be an error under one convention and
  // an answer under another.
  {
    covers: 'COUPDAYS/4',
    source: 'COUPDAYS("2024-01-01", "2023-01-01", 2, 0)',
    throws: /#NUM!/,
    zones: TIMEZONES,
  },
  {
    covers: 'COUPDAYS/4',
    source: 'COUPDAYS("2023-01-15", "2024-01-01", 2, 5)',
    throws: /#NUM!/,
    zones: TIMEZONES,
  },
  {
    covers: 'DISC/4',
    source: 'DISC("2023-01-01", "2023-07-01", 97.5, 100)',
    expected: 0.05,
    tolerance: 1e-9,
    zones: TIMEZONES,
  },
  {
    covers: 'DISC/5',
    source: 'DISC("2023-01-01", "2023-07-01", 97.5, 100, 3)',
    expected: 9.125 / 181,
    tolerance: 1e-9,
    zones: TIMEZONES,
  },
  {
    covers: 'PRICEDISC/4',
    source: 'PRICEDISC("2023-01-01", "2023-07-01", 0.05, 100)',
    expected: 97.5,
    tolerance: 1e-9,
    zones: TIMEZONES,
  },
  {
    covers: 'PRICEDISC/5',
    source: 'PRICEDISC("2023-01-01", "2023-07-01", 0.05, 100, 3)',
    expected: 100 * (1 - 0.05 * (181 / 365)),
    tolerance: 1e-9,
    zones: TIMEZONES,
  },
  {
    covers: 'TBILLEQ/3',
    source: 'TBILLEQ("2023-01-01", "2023-04-01", 0.04)',
    expected: 14.6 / 356.4,
    tolerance: 1e-9,
    zones: TIMEZONES,
  },
  // A Treasury bill is short-dated by definition, so a maturity more than a
  // year out is an error rather than an extrapolation.
  {
    covers: 'TBILLEQ/3',
    source: 'TBILLEQ("2023-01-01", "2024-04-01", 0.04)',
    throws: /#NUM!/,
    zones: TIMEZONES,
  },
  {
    covers: 'TBILLPRICE/3',
    source: 'TBILLPRICE("2023-01-01", "2024-04-01", 0.04)',
    throws: /#NUM!/,
    zones: TIMEZONES,
  },
  {
    covers: 'TBILLYIELD/3',
    source: 'TBILLYIELD("2023-01-01", "2024-04-01", 98)',
    throws: /#NUM!/,
    zones: TIMEZONES,
  },
  {
    covers: 'TBILLPRICE/3',
    source: 'TBILLPRICE("2023-01-01", "2023-04-01", 0.04)',
    expected: 99,
    tolerance: 1e-9,
    zones: TIMEZONES,
  },
  {
    covers: 'TBILLYIELD/3',
    source: 'TBILLYIELD("2023-01-01", "2023-04-01", 98)',
    expected: 8 / 98,
    tolerance: 1e-9,
    zones: TIMEZONES,
  },
];
