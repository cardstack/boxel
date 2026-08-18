import type { CoverageCase } from './case.ts';

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
  // Period 2 rather than period 1: with payments at the start of the period,
  // period 1's interest is zero, and zero is what a constant, a dropped rate
  // or a dropped principal would all return.
  {
    covers: 'IPMT/6',
    source: 'IPMT(0.1, 2, 3, 1000, 0, 1)',
    expected: -63.44410876132934,
    tolerance: 1e-9,
  },
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
  {
    covers: 'CUMPRINC/6',
    // Two periods of three, not the whole term: cumulative principal over a
    // full term is -pv whatever the rate, so a full-term case cannot see the
    // rate, the period bounds or the payment timing.
    source: 'CUMPRINC(0.1, 3, 1000, 1, 2, 0)',
    expected: -634.4410876132924,
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
  {
    covers: 'MIRR/3',
    // The finance rate discounts the negative flows and the reinvestment rate
    // compounds the positive ones, so the series needs an outflow after
    // period 0 for the first rate to reach anything, and the two rates have
    // to differ for the case to tell them apart. The sign change mid-series
    // is also what makes the flows' time slots matter: on a series whose only
    // outflow is period 0, dropping the slots and mis-scaling the horizon
    // cancel exactly, and every answer stays correct by accident.
    //
    // The value is the geometric mean between the two ends the rate joins:
    // the positives carried to the final period at 12%, over the negatives
    // brought back to period zero at 8%, annualised across the four periods
    // between them.
    source: 'MIRR([-1000, 300, -200, 500, 400], 0.08, 0.12)',
    expected: 0.04208570671566214,
    tolerance: 1e-9,
  },
  // Dated flows a whole non-leap year apart make the discount exponent 1.
  {
    covers: 'XNPV/3',
    source: 'XNPV(0.1, [-100, 121], ["2023-01-01", "2024-01-01"])',
    expected: 10,
    tolerance: 1e-9,
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
  },
  {
    covers: 'XIRR/2',
    source: 'XIRR([-1, 3, -2.5], ["2020-01-01", "2021-01-01", "2022-01-01"])',
    throws: /#NUM!/,
  },
  {
    covers: 'XIRR/2',
    source: 'XIRR([-100, 110], ["2023-01-01", "2024-01-01"])',
    expected: 0.1,
    tolerance: 1e-7,
  },
  // 2021 and 2022 are both non-leap, so the dated exponents are exactly 1 and
  // 2 and the two-root series above applies unchanged.
  {
    covers: 'XIRR/3',
    source:
      'XIRR([-100, 230, -132], ["2021-01-01", "2022-01-01", "2023-01-01"], 0.3)',
    expected: 0.2,
    tolerance: 1e-7,
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
    // Settling mid-period rather than on the coupon date, so the accrual is a
    // fraction the dates decide: 90 of 360 days on the default 30/360 basis.
    source: 'ACCRINT("2023-01-01", "2023-07-01", "2023-04-01", 0.1, 1000, 2)',
    expected: 25,
    tolerance: 1e-9,
  },
  {
    covers: 'ACCRINT/7',
    // Excel accrues par * (rate / frequency) * the accrued days over the
    // length of the quasi-coupon period they fall in — periods counted back
    // from first_interest. Settling 90 days into the period that runs
    // 2023-01-01 to 2023-07-01 gives 1000 * 0.05 * 90/181.
    //
    // On every basis with a fixed year length that reduces to
    // par * rate * YEARFRAC(issue, settlement), which is why only basis 1
    // separates the two readings.
    source:
      'ACCRINT("2023-01-15", "2023-07-01", "2023-04-15", 0.1, 1000, 2, 1)',
    expected: 24.861878453038674,
    tolerance: 1e-9,
    knownDefect:
      'ACCRINT computes par * rate * YEARFRAC(issue, settlement, basis) and ' +
      'never reads first_interest or frequency, so on basis 1 it divides by ' +
      "the year rather than by the quasi-coupon period's own length",
    produces: { expected: 24.65753424657534, tolerance: 1e-9 },
  },
  // On the default 30/360 basis a coupon period is 360/frequency days by
  // definition, so the dates are inert here and the frequency is what the
  // case can pin. Basis 3 is the same shape over a 365-day year. The
  // date-sensitive convention is basis 1, covered below.
  {
    covers: 'COUPDAYS/3',
    source: 'COUPDAYS("2023-01-15", "2024-01-01", 4)',
    expected: 90,
  },
  {
    covers: 'COUPDAYS/4',
    source: 'COUPDAYS("2023-01-15", "2024-01-01", 2, 3)',
    expected: 182.5,
  },
  // Basis 1 is actual/actual, the one convention that measures a real calendar
  // span: settlement falls in the period from 2010-11-15 to 2011-05-15, which
  // is 181 days long.
  {
    covers: 'COUPDAYS/4',
    source: 'COUPDAYS("2011-01-25", "2011-11-15", 2, 1)',
    expected: 181,
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
  },
  // A maturity on the last day of a short month keeps the schedule on month
  // ends too: the coupon date behind 2026-02-28 is 2025-08-31, not the 28th, so
  // the period holding settlement is 181 days rather than 184.
  {
    covers: 'COUPDAYS/4',
    source: 'COUPDAYS("2026-01-15", "2026-02-28", 2, 1)',
    expected: 181,
  },
  {
    covers: 'COUPDAYS/4',
    source: 'COUPDAYS("2027-11-15", "2028-02-29", 2, 1)',
    expected: 182,
  },
  // The dates are checked whatever the basis, even where the answer does not
  // read them, so one argument list cannot be an error under one convention and
  // an answer under another.
  {
    covers: 'COUPDAYS/4',
    source: 'COUPDAYS("2024-01-01", "2023-01-01", 2, 0)',
    throws: /#NUM!/,
  },
  {
    covers: 'COUPDAYS/4',
    source: 'COUPDAYS("2023-01-15", "2024-01-01", 2, 5)',
    throws: /#NUM!/,
  },
  {
    covers: 'DISC/4',
    source: 'DISC("2023-01-01", "2023-07-01", 97.5, 100)',
    expected: 0.05,
    tolerance: 1e-9,
  },
  {
    covers: 'DISC/5',
    source: 'DISC("2023-01-01", "2023-07-01", 97.5, 100, 3)',
    expected: 9.125 / 181,
    tolerance: 1e-9,
  },
  {
    covers: 'PRICEDISC/4',
    source: 'PRICEDISC("2023-01-01", "2023-07-01", 0.05, 100)',
    expected: 97.5,
    tolerance: 1e-9,
  },
  {
    covers: 'PRICEDISC/5',
    source: 'PRICEDISC("2023-01-01", "2023-07-01", 0.05, 100, 3)',
    expected: 100 * (1 - 0.05 * (181 / 365)),
    tolerance: 1e-9,
  },
  {
    covers: 'TBILLEQ/3',
    source: 'TBILLEQ("2023-01-01", "2023-04-01", 0.04)',
    expected: 14.6 / 356.4,
    tolerance: 1e-9,
  },
  // A Treasury bill is short-dated by definition, so a maturity more than a
  // year out is an error rather than an extrapolation.
  {
    covers: 'TBILLEQ/3',
    source: 'TBILLEQ("2023-01-01", "2024-04-01", 0.04)',
    throws: /#NUM!/,
  },
  {
    covers: 'TBILLPRICE/3',
    source: 'TBILLPRICE("2023-01-01", "2024-04-01", 0.04)',
    throws: /#NUM!/,
  },
  {
    covers: 'TBILLYIELD/3',
    source: 'TBILLYIELD("2023-01-01", "2024-04-01", 98)',
    throws: /#NUM!/,
  },
  {
    covers: 'TBILLPRICE/3',
    source: 'TBILLPRICE("2023-01-01", "2023-04-01", 0.04)',
    expected: 99,
    tolerance: 1e-9,
  },
  {
    covers: 'TBILLYIELD/3',
    source: 'TBILLYIELD("2023-01-01", "2023-04-01", 98)',
    expected: 8 / 98,
    tolerance: 1e-9,
  },
];
