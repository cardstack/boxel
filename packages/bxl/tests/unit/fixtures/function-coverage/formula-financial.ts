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
  //
  // ACCRINT pays par * (rate / frequency) per quasi-coupon period on the
  // schedule first_interest sits on, at the given frequency, counted from one
  // reference boundary: periods behind it the holding covers whole each earn a
  // coupon, the period the holding opens in earns the share of its own length
  // it covers, and settlement's distance from the boundary is added as a signed
  // share of a single period.
  //
  // Every basis reads the schedule. The count coincides with
  // par * rate * YEARFRAC wherever every period the holding touches measures
  // its nominal year/frequency, which a 30/360 schedule landing on month ends
  // or on a day of 28 or less generally does — so agreement there is the rule
  // rather than a coincidence, and several cases below sit on it. The two part
  // where a period's own day count differs from the nominal, which is every
  // actual/360 and actual/365 period and a 30/360 one whose boundaries carry
  // different day numbers.
  {
    covers: 'ACCRINT/6',
    // Settling mid-period rather than on the coupon date, so the accrual is a
    // fraction the dates decide: 90 of the 180 30/360 days in the period the
    // holding both opens and closes in, on the default basis.
    source: 'ACCRINT("2023-01-01", "2023-07-01", "2023-04-01", 0.1, 1000, 2)',
    expected: 25,
    tolerance: 1e-9,
  },
  {
    covers: 'ACCRINT/6',
    // A holding that runs past a coupon date, on a schedule whose periods each
    // count the nominal 180 30/360 days: two coupons less the 104 days
    // settlement falls short of 2023-11-15 comes to 1000 * 0.1 * 256/360. A
    // frequency left uncancelled would scale that by 2 or by a half.
    source: 'ACCRINT("2022-11-15", "2023-05-15", "2023-08-01", 0.1, 1000, 2)',
    expected: 71.11111111111111,
    tolerance: 1e-9,
  },
  {
    covers: 'ACCRINT/7',
    // Settling 90 actual days into the period that runs 2023-01-01 to
    // 2023-07-01, which is 181 days long: 1000 * 0.05 * 90/181. Dividing by
    // the year instead would give 24.657, and reading the period off a
    // schedule anchored anywhere but 2023-07-01 would give neither.
    source:
      'ACCRINT("2023-01-15", "2023-07-01", "2023-04-15", 0.1, 1000, 2, 1)',
    expected: 24.861878453038674,
    tolerance: 1e-9,
  },
  {
    covers: 'ACCRINT/7',
    // Held from issue to the first payment, so the holding is one whole
    // quasi-coupon period and earns exactly one coupon — 1000 * 0.05 — however
    // many days the calendar put in it. Dividing the 181 days by the year
    // instead would pay 49.589 for a full period's holding.
    source:
      'ACCRINT("2022-11-15", "2023-05-15", "2023-05-15", 0.1, 1000, 2, 1)',
    expected: 50,
    tolerance: 1e-9,
  },
  {
    covers: 'ACCRINT/7',
    // A holding that spans a coupon date earns from both periods, and on
    // actual/actual the two periods are not the same length: one full coupon
    // for 2022-11-15 to 2023-05-15, then 78 of the 184 days in 2023-05-15 to
    // 2023-11-15. No single YEARFRAC over the whole holding produces this,
    // since the halves divide by 181 and 184 respectively.
    source:
      'ACCRINT("2022-11-15", "2023-05-15", "2023-08-01", 0.1, 1000, 2, 1)',
    expected: 71.19565217391303,
    tolerance: 1e-9,
  },
  {
    covers: 'ACCRINT/7',
    // Issued after its first interest payment, so the schedule is the one
    // extended forward from the anchor rather than counted back from it: the
    // quarterly dates behind 2023-12-01 are 2023-09-01 and 2023-06-01, and
    // settlement closes the 91-day period issue opened 9 days into.
    source:
      'ACCRINT("2023-09-10", "2023-03-01", "2023-12-01", 0.06, 1000, 4, 1)',
    expected: 13.516483516483516,
    tolerance: 1e-9,
  },
  {
    covers: 'ACCRINT/7',
    // A month-end anchor keeps the whole schedule on month ends: behind
    // 2023-08-31 sit 2023-02-28 and 2022-08-31, so issue accrues 18 of the 181
    // days in the period ending February and settlement 46 of the 184 in the
    // one after — 1000 * 0.05 * (18/181 + 46/184). Measuring each date from the
    // one before it would carry February's clamp forward to an August 28th and
    // divide by the wrong lengths. Issue also shares February with a coupon
    // date it precedes, which is the case whole months alone misplace.
    source:
      'ACCRINT("2023-02-10", "2023-08-31", "2023-04-15", 0.1, 1000, 2, 1)',
    expected: 17.472375690607734,
    tolerance: 1e-9,
  },
  {
    covers: 'ACCRINT/6',
    // The schedule anchor is read before any accrual is counted, so a
    // first_interest that is not a date is an error on every basis rather than
    // an argument some convention could leave unexamined.
    source: 'ACCRINT("2023-01-01", "not a date", "2023-04-01", 0.1, 1000, 2)',
    throws: /#VALUE!/,
  },
  {
    covers: 'ACCRINT/7',
    // Only periods behind the reference boundary earn a whole coupon. Here
    // settlement sits on the anchor, so the boundary is the coupon date one
    // period behind it, 2023-07-01: the period before that is covered whole and
    // earns exactly one coupon, and the 184 actual days from the boundary to
    // settlement are a share of the nominal 180 — 1000 * 0.05 * (1 + 184/180).
    // Measuring the holding as a whole instead divides its 365 actual days by
    // 360 and pays 101.38888888888889, which is what an implementation that
    // never reads the schedule answers.
    source:
      'ACCRINT("2023-01-01", "2024-01-01", "2024-01-01", 0.1, 1000, 2, 2)',
    expected: 101.11111111111111,
    tolerance: 1e-9,
  },
  // One holding read on all five bases, against Excel's own answers for it:
  // 10000 at 7% semiannual, issued 1990-03-04 and settled 1992-03-04 on a
  // schedule anchored by a 1993-03-31 first payment. The anchor is a month end,
  // so the schedule is too — 1989-09-30, 1990-03-31, 1990-09-30, 1991-03-31,
  // 1991-09-30, 1992-03-31, 1992-09-30. Settlement lands 1.15 periods short of
  // the reference boundary at 1992-09-30, which makes the remainder negative and
  // leaves five whole coupons to carry the balance, and the holding opens 27
  // days short of the end of the period behind 1990-03-31.
  //
  // Every basis answers differently, and only basis 4 coincides with
  // par * rate * YEARFRAC, which pays 1400 on basis 0, 1400.638686 on basis 1,
  // 1421.388889 on basis 2 and 1401.917808 on basis 3. LibreOffice's ACCRINT
  // measures the whole holding and answers 1400, 1401.917808, 1421.388889,
  // 1401.917808 and 1400 — its basis-1 divisor being a flat 365 rather than its
  // own YEARFRAC, which is why that one matches neither column.
  {
    covers: 'ACCRINT/7',
    // 30/360 US: five coupons, plus 27 of the opening period's own 180 days,
    // less the 206 days settlement falls short of the boundary over the
    // nominal 180.
    source:
      'ACCRINT("1990-03-04", "1993-03-31", "1992-03-04", 0.07, 10000, 2, 0)',
    expected: 1401.9444444444443,
    tolerance: 1e-9,
  },
  {
    covers: 'ACCRINT/7',
    // Actual/actual, the one basis that divides by real calendar lengths: the
    // opening period and the reference period both run 182 days, so it is
    // 5 + (27 - 210)/182 coupons.
    source:
      'ACCRINT("1990-03-04", "1993-03-31", "1992-03-04", 0.07, 10000, 2, 1)',
    expected: 1398.076923076923,
    tolerance: 1e-9,
  },
  {
    covers: 'ACCRINT/7',
    // Actual/360 counts elapsed days on the calendar — 27 and 210 — while
    // sizing the opening period on a 30/360 schedule and the reference period
    // at the nominal 180. Both come to 180 on this schedule; the case below
    // with a February boundary is the one that separates them.
    source:
      'ACCRINT("1990-03-04", "1993-03-31", "1992-03-04", 0.07, 10000, 2, 2)',
    expected: 1394.1666666666667,
    tolerance: 1e-9,
  },
  {
    covers: 'ACCRINT/7',
    // Actual/365 counts elapsed days on the calendar too, and is the one basis
    // that sizes every period at a nominal 182.5 rather than counting one.
    source:
      'ACCRINT("1990-03-04", "1993-03-31", "1992-03-04", 0.07, 10000, 2, 3)',
    expected: 1399.0410958904108,
    tolerance: 1e-9,
  },
  {
    covers: 'ACCRINT/7',
    // The European 30/360 reads 1990-03-31 as the 30th, so the opening period
    // contributes 26 of 180 rather than 27 and the coupons come to exactly five
    // less one. The total equalling par * rate * YEARFRAC is what this basis
    // does generally, since its count is a difference of per-date values and so
    // telescopes across the schedule; what the case pins is the day-31 clamp,
    // since leaving that 31st where it stands pays 1401.65.
    source:
      'ACCRINT("1990-03-04", "1993-03-31", "1992-03-04", 0.07, 10000, 2, 4)',
    expected: 1400,
    tolerance: 1e-9,
  },
  {
    covers: 'ACCRINT/7',
    // Excel's own answer for an issue on the last day of February, on the basis
    // whose 30/360 reads one as the 30th. The schedule runs on the 5th of the
    // month from a 2010-07-05 anchor, so there are 33 whole coupons behind the
    // reference boundary at 2010-01-05 and settlement falls 29.7 periods short
    // of it; what February reaches is the opening share, 125 of the 180 days in
    // the period ending 1993-07-05. Reading that 28th as the 28th makes it 127
    // and pays 1400 — the answer a 30/360 carrying the day-31 rules alone gives,
    // which is what DAYS360 counts.
    source:
      'ACCRINT("1993-02-28", "2010-07-05", "1995-02-28", 0.07, 10000, 2, 0)',
    expected: 1396.1111111111113,
    tolerance: 1e-9,
  },
  {
    covers: 'ACCRINT/7',
    // A holding from one February month end to the next is a whole year and
    // earns exactly one coupon, which is what both February rules exist to
    // deliver: the opening 28th reads as the 30th and so does the closing 29th,
    // leaving a clean 360 days. Leaving the closing end where it stands counts
    // 359 and pays 99.72; leaving the opening end pays 100.56.
    source:
      'ACCRINT("2023-02-28", "2024-02-29", "2024-02-29", 0.1, 1000, 1, 0)',
    expected: 100,
    tolerance: 1e-9,
  },
  // A February schedule boundary with a partial opening period, which is what
  // separates the three readings a 30/360 period length could take. The anchor
  // 2023-08-31 is a month end so the schedule is 2022-08-31, 2023-02-28,
  // 2023-08-31; the holding opens inside the first period and settles inside the
  // second. The period 2022-08-31 to 2023-02-28 measures 180 days with both ends
  // pulled back, 178 with the closing end left conditional, and a nominal 180.
  //
  // No published Excel answer reaches this shape — Excel's own exported vectors
  // put no February on a schedule boundary — so what these two cases pin is the
  // reading the Excel-validated reference takes for each basis, which the
  // verified cases above cannot distinguish.
  {
    covers: 'ACCRINT/7',
    // 30/360 US sizes a period with both ends pulled back: 133 of 180 for the
    // opening period, plus 120 of the nominal 180 from the boundary to
    // settlement. Leaving the closing end conditional divides by 178 and pays
    // 70.69, and this is also where each February rule shows separately — the
    // closing one against 70.69, the opening one against 70.83.
    source:
      'ACCRINT("2022-10-15", "2023-08-31", "2023-06-30", 0.1, 1000, 2, 0)',
    expected: 70.27777777777777,
    tolerance: 1e-9,
  },
  {
    covers: 'ACCRINT/7',
    // Actual/360 counts the opening share in actual days, 136, but sizes that
    // period on a 30/360 schedule with the closing end left conditional — 178,
    // where the nominal 180 would pay 71.67.
    source:
      'ACCRINT("2022-10-15", "2023-08-31", "2023-06-30", 0.1, 1000, 2, 2)',
    expected: 72.09113607990012,
    tolerance: 1e-9,
  },
  {
    covers: 'ACCRINT/7',
    // Settling past the anchor puts the reference boundary at the first coupon
    // date at or after settlement, and settlement's day of the month is later
    // than the anchor's, so the boundary is 2024-05-15 rather than the
    // 2023-11-15 that whole-month arithmetic alone reaches. The tail is then the
    // 177 days settlement falls short of it over that period's own 182, against
    // four whole coupons and 125 of the opening period's 181 days. Stopping a
    // boundary early pays 1301.22, and dividing the tail by the whole stretch
    // from the anchor to the boundary — two periods, 366 days — pays 1472.45.
    source:
      'ACCRINT("2022-01-10", "2023-05-15", "2023-11-20", 0.07, 10000, 2, 1)',
    expected: 1301.3280917977052,
    tolerance: 1e-9,
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
  // The bond functions read their numeric arguments the way the rest of the
  // package reads them. A basis that is not a number is an error rather than
  // the default it would coerce to, and a fractional basis or frequency names
  // the whole one it sits on rather than nothing at all.
  {
    covers: 'DISC/5',
    source: 'DISC("2023-01-01", "2023-07-01", 97.5, 100, "x")',
    throws: /#VALUE!/,
  },
  {
    covers: 'PRICEDISC/5',
    source: 'PRICEDISC("2023-01-01", "2023-07-01", 0.05, 100, "x")',
    throws: /#VALUE!/,
  },
  {
    covers: 'ACCRINT/7',
    // Frequency 2.9 is semi-annual and basis 4.9 is the European 30/360, where
    // reading either whole number off the fraction is the difference between an
    // answer and a #NUM!. Accruing 75 30/360 days of a 10% coupon on 1000 par:
    // the European rule pulls the January 31st issue onto the 30th.
    source:
      'ACCRINT("2023-01-31", "2023-07-01", "2023-04-15", 0.1, 1000, 2.9, 4.9)',
    expected: 1000 * 0.1 * (75 / 360),
  },
  // Settlement has to fall before maturity, which is the term these price over.
  // A year fraction measures how long a span is rather than which way it runs,
  // so it cannot report a transposed pair on their behalf.
  {
    covers: 'DISC/4',
    // Transposed, where the discount would otherwise come back negative.
    source: 'DISC("2023-07-01", "2023-01-01", 97.5, 100)',
    throws: /#NUM!/,
  },
  {
    covers: 'PRICEDISC/4',
    // Settling on the maturity date leaves no term to discount over, and a
    // price for it would be redemption at face value.
    source: 'PRICEDISC("2023-01-01", "2023-01-01", 0.05, 100)',
    throws: /#NUM!/,
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
