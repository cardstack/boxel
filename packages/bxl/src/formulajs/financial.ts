import { EXCEL_ERROR, throwExcelError } from './errors.ts';
import {
  daysBetween,
  parseExcelDate,
  parseExcelDateArray,
  yearFrac,
} from './dateSerial.ts';
import {
  flattenExcelArgs,
  parseExcelNumber,
  parseExcelNumberArray,
} from './common.ts';

function parseCashFlows(values: unknown) {
  const parsed = parseExcelNumberArray(flattenExcelArgs(values));
  const positive = parsed.some((value) => value > 0);
  const negative = parsed.some((value) => value < 0);

  if (!positive || !negative) {
    throwExcelError(EXCEL_ERROR.num);
  }

  return parsed;
}

/**
 * Whether the rate a solver stopped at is really a root, asked two ways.
 *
 * A net present value of zero settles it outright, which is the ordinary case
 * and also what a double root gives, since the curve touches zero without
 * crossing. But discounting amplifies rounding — dividing by `(1 + rate)^n`
 * multiplies the error in `1 + rate` by the same factor — so near -100%, or
 * over a long series, the smallest residual any double can produce is nowhere
 * near zero. There, what marks a root is the crossing itself: the sign flips
 * across a neighbourhood a few billion ulps wide, which rounding does not do
 * and a rate that is not a root does not do.
 */
function isNetPresentValueRoot(
  netPresentValue: (rate: number) => number,
  rate: number,
  tolerance: number,
) {
  const residual = netPresentValue(rate);
  if (!Number.isFinite(residual)) return false;
  if (Math.abs(residual) <= tolerance) return true;

  const nudge = Math.max(Math.abs(rate), 1e-8) * 1e-9;
  const below = netPresentValue(rate - nudge);
  const above = netPresentValue(rate + nudge);
  return (
    Number.isFinite(below) &&
    Number.isFinite(above) &&
    Math.sign(below) !== Math.sign(above)
  );
}

export function excelFv(
  rateLike: unknown,
  nperLike: unknown,
  paymentLike: unknown,
  valueLike = 0,
  typeLike = 0,
) {
  const rate = parseExcelNumber(rateLike);
  const nper = parseExcelNumber(nperLike);
  const payment = parseExcelNumber(paymentLike);
  const value = parseExcelNumber(valueLike);
  const type = parseExcelNumber(typeLike);

  if (rate === 0) {
    return -(value + payment * nper);
  }

  const term = Math.pow(1 + rate, nper);
  const result =
    type === 1
      ? value * term + (payment * (1 + rate) * (term - 1)) / rate
      : value * term + (payment * (term - 1)) / rate;
  return -result;
}

export function excelFvSchedule(principalLike: unknown, scheduleLike: unknown) {
  const principal = parseExcelNumber(principalLike);
  const schedule = parseExcelNumberArray(scheduleLike);
  return schedule.reduce((future, rate) => future * (1 + rate), principal);
}

export function excelNpv(rateLike: unknown, valuesLike: unknown) {
  const rate = parseExcelNumber(rateLike);
  const values = parseExcelNumberArray(flattenExcelArgs(valuesLike));

  let result = 0;
  for (let i = 0; i < values.length; i++) {
    result += values[i] / Math.pow(1 + rate, i + 1);
  }
  return result;
}

export function excelEffect(nominalRateLike: unknown, nperyLike: unknown) {
  const nominalRate = parseExcelNumber(nominalRateLike);
  let npery = parseExcelNumber(nperyLike);

  if (nominalRate <= 0 || npery < 1) {
    throwExcelError(EXCEL_ERROR.num);
  }

  npery = Math.trunc(npery);
  return Math.pow(1 + nominalRate / npery, npery) - 1;
}

export function excelNominal(effectRateLike: unknown, nperyLike: unknown) {
  const effectRate = parseExcelNumber(effectRateLike);
  let npery = parseExcelNumber(nperyLike);

  if (effectRate <= 0 || npery < 1) {
    throwExcelError(EXCEL_ERROR.num);
  }

  npery = Math.trunc(npery);
  return (Math.pow(effectRate + 1, 1 / npery) - 1) * npery;
}

export function excelPmt(
  rateLike: unknown,
  nperLike: unknown,
  pvLike: unknown,
  fvLike = 0,
  typeLike = 0,
) {
  const rate = parseExcelNumber(rateLike);
  const nper = parseExcelNumber(nperLike);
  const pv = parseExcelNumber(pvLike);
  const fv = parseExcelNumber(fvLike);
  const type = parseExcelNumber(typeLike);

  if (rate === 0) {
    return -(pv + fv) / nper;
  }

  const term = Math.pow(1 + rate, nper);
  const result =
    type === 1
      ? ((fv * rate) / (term - 1) + (pv * rate) / (1 - 1 / term)) / (1 + rate)
      : (fv * rate) / (term - 1) + (pv * rate) / (1 - 1 / term);
  return -result;
}

export function excelIpmt(
  rateLike: unknown,
  perLike: unknown,
  nperLike: unknown,
  pvLike: unknown,
  fvLike = 0,
  typeLike = 0,
) {
  const rate = parseExcelNumber(rateLike);
  const per = parseExcelNumber(perLike);
  const nper = parseExcelNumber(nperLike);
  const pv = parseExcelNumber(pvLike);
  const fv = parseExcelNumber(fvLike);
  const type = parseExcelNumber(typeLike);

  if (per < 1 || per > nper) {
    throwExcelError(EXCEL_ERROR.num);
  }

  const payment = excelPmt(rate, nper, pv, fv, type);
  const interest =
    per === 1
      ? type === 1
        ? 0
        : -pv
      : type === 1
        ? excelFv(rate, per - 2, payment, pv, 1) - payment
        : excelFv(rate, per - 1, payment, pv, 0);

  return interest * rate;
}

export function excelPpmt(
  rateLike: unknown,
  perLike: unknown,
  nperLike: unknown,
  pvLike: unknown,
  fvLike = 0,
  typeLike = 0,
) {
  const rate = parseExcelNumber(rateLike);
  const per = parseExcelNumber(perLike);
  const nper = parseExcelNumber(nperLike);
  const pv = parseExcelNumber(pvLike);
  const fv = parseExcelNumber(fvLike);
  const type = parseExcelNumber(typeLike);

  return (
    excelPmt(rate, nper, pv, fv, type) -
    excelIpmt(rate, per, nper, pv, fv, type)
  );
}

export function excelPv(
  rateLike: unknown,
  nperLike: unknown,
  pmtLike: unknown,
  fvLike = 0,
  typeLike = 0,
) {
  const rate = parseExcelNumber(rateLike);
  const nper = parseExcelNumber(nperLike);
  const pmt = parseExcelNumber(pmtLike);
  const fv = parseExcelNumber(fvLike);
  const type = parseExcelNumber(typeLike);

  return rate === 0
    ? -pmt * nper - fv
    : (((1 - Math.pow(1 + rate, nper)) / rate) * pmt * (1 + rate * type) - fv) /
        Math.pow(1 + rate, nper);
}

export function excelNper(
  rateLike: unknown,
  pmtLike: unknown,
  pvLike: unknown,
  fvLike = 0,
  typeLike = 0,
) {
  const rate = parseExcelNumber(rateLike);
  const pmt = parseExcelNumber(pmtLike);
  const pv = parseExcelNumber(pvLike);
  const fv = parseExcelNumber(fvLike);
  const type = parseExcelNumber(typeLike);

  if (rate === 0) {
    return -(pv + fv) / pmt;
  }

  const numerator = pmt * (1 + rate * type) - fv * rate;
  const denominator = pv * rate + pmt * (1 + rate * type);
  return Math.log(numerator / denominator) / Math.log(1 + rate);
}

export function excelRate(
  nperLike: unknown,
  pmtLike: unknown,
  pvLike: unknown,
  fvLike = 0,
  typeLike = 0,
  guessLike = 0.1,
) {
  const nper = parseExcelNumber(nperLike);
  const pmt = parseExcelNumber(pmtLike);
  const pv = parseExcelNumber(pvLike);
  const fv = parseExcelNumber(fvLike);
  let type = parseExcelNumber(typeLike);
  let rate = parseExcelNumber(guessLike);

  const epsMax = 1e-10;
  const iterMax = 100;
  type = type ? 1 : 0;

  for (let i = 0; i < iterMax; i++) {
    if (rate <= -1) {
      throwExcelError(EXCEL_ERROR.num);
    }

    let y: number;
    let f: number;

    if (Math.abs(rate) < epsMax) {
      y = pv * (1 + nper * rate) + pmt * (1 + rate * type) * nper + fv;
    } else {
      f = Math.pow(1 + rate, nper);
      y = pv * f + pmt * (1 / rate + type) * (f - 1) + fv;
    }

    if (Math.abs(y) < epsMax) {
      return rate;
    }

    let dy: number;
    if (Math.abs(rate) < epsMax) {
      dy = pv * nper + pmt * type * nper;
    } else {
      f = Math.pow(1 + rate, nper);
      const df = nper * Math.pow(1 + rate, nper - 1);
      dy =
        pv * df +
        pmt * (1 / rate + type) * df +
        pmt * (-1 / (rate * rate)) * (f - 1);
    }

    rate -= y / dy;
  }

  return rate;
}

export function excelCumipmt(
  rateLike: unknown,
  nperLike: unknown,
  pvLike: unknown,
  startPeriodLike: unknown,
  endPeriodLike: unknown,
  typeLike: unknown,
) {
  const rate = parseExcelNumber(rateLike);
  const nper = parseExcelNumber(nperLike);
  const pv = parseExcelNumber(pvLike);
  let startPeriod = parseExcelNumber(startPeriodLike);
  const endPeriod = parseExcelNumber(endPeriodLike);
  const type = parseExcelNumber(typeLike);

  if (rate <= 0 || nper <= 0 || pv <= 0) {
    throwExcelError(EXCEL_ERROR.num);
  }

  if (startPeriod < 1 || endPeriod < 1 || startPeriod > endPeriod) {
    throwExcelError(EXCEL_ERROR.num);
  }

  if (type !== 0 && type !== 1) {
    throwExcelError(EXCEL_ERROR.num);
  }

  const payment = excelPmt(rate, nper, pv, 0, type);
  let interest = 0;

  if (startPeriod === 1) {
    if (type === 0) {
      interest = -pv;
    }
    startPeriod++;
  }

  for (let period = startPeriod; period <= endPeriod; period++) {
    interest +=
      type === 1
        ? excelFv(rate, period - 2, payment, pv, 1) - payment
        : excelFv(rate, period - 1, payment, pv, 0);
  }

  return interest * rate;
}

export function excelCumprinc(
  rateLike: unknown,
  nperLike: unknown,
  pvLike: unknown,
  startPeriodLike: unknown,
  endPeriodLike: unknown,
  typeLike: unknown,
) {
  const rate = parseExcelNumber(rateLike);
  const nper = parseExcelNumber(nperLike);
  const pv = parseExcelNumber(pvLike);
  let startPeriod = parseExcelNumber(startPeriodLike);
  const endPeriod = parseExcelNumber(endPeriodLike);
  const type = parseExcelNumber(typeLike);

  if (rate <= 0 || nper <= 0 || pv <= 0) {
    throwExcelError(EXCEL_ERROR.num);
  }

  if (startPeriod < 1 || endPeriod < 1 || startPeriod > endPeriod) {
    throwExcelError(EXCEL_ERROR.num);
  }

  if (type !== 0 && type !== 1) {
    throwExcelError(EXCEL_ERROR.num);
  }

  const payment = excelPmt(rate, nper, pv, 0, type);
  let principal = 0;

  if (startPeriod === 1) {
    principal = type === 0 ? payment + pv * rate : payment;
    startPeriod++;
  }

  for (let period = startPeriod; period <= endPeriod; period++) {
    principal +=
      type > 0
        ? payment - (excelFv(rate, period - 2, payment, pv, 1) - payment) * rate
        : payment - excelFv(rate, period - 1, payment, pv, 0) * rate;
  }

  return principal;
}

export function excelIrr(valuesLike: unknown, guessLike = 0.1) {
  const values = parseCashFlows(valuesLike);
  let guess = parseExcelNumber(guessLike);

  const npv = (rate: number) => {
    const safeRate = rate <= -1 ? -0.999999999 : rate;
    let result = values[0];
    const r = 1 + safeRate;
    let factor = 1;

    for (let i = 1; i < values.length; i++) {
      factor *= r;
      result += values[i] / factor;
    }

    return result;
  };

  const npvDerivative = (rate: number) => {
    const safeRate = rate <= -1 ? -0.999999999 : rate;
    const r = 1 + safeRate;
    let result = 0;
    let factor = r;

    for (let i = 1; i < values.length; i++) {
      result -= (i * values[i]) / factor;
      factor *= r;
    }

    return result / r;
  };

  const epsMax = 1e-10;

  for (let i = 0; i < 50; i++) {
    const resultValue = npv(guess);
    const derivative = npvDerivative(guess);

    if (Math.abs(derivative) < epsMax) {
      break;
    }

    const nextGuess = Math.max(
      -0.99999999,
      Math.min(guess - resultValue / derivative, 1000),
    );
    const settled = Math.abs(nextGuess - guess) <= epsMax;
    guess = nextGuess;
    if (settled) {
      break;
    }
  }

  // Newton's method walks to some rate whether or not a root exists, and a
  // series like [-1, 3, -2.5] has none, so the rate it settled on only counts
  // if the net present value there really is zero.
  if (!isNetPresentValueRoot(npv, guess, epsMax)) {
    throwExcelError(EXCEL_ERROR.num);
  }

  return guess;
}

export function excelXnpv(
  rateLike: unknown,
  valuesLike: unknown,
  datesLike: unknown,
) {
  const rate = parseExcelNumber(rateLike);
  const values = parseExcelNumberArray(flattenExcelArgs(valuesLike));
  const dates = parseExcelDateArray(flattenExcelArgs(datesLike));

  let result = 0;
  for (let i = 0; i < values.length; i++) {
    result +=
      values[i] / Math.pow(1 + rate, daysBetween(dates[0], dates[i]) / 365);
  }

  return result;
}

export function excelXirr(
  valuesLike: unknown,
  datesLike: unknown,
  guessLike = 0.1,
) {
  const values = parseCashFlows(valuesLike);
  const dates = parseExcelDateArray(flattenExcelArgs(datesLike));
  let guess = parseExcelNumber(guessLike);

  const irrResult = (rate: number) => {
    const r = rate + 1;
    let result = values[0];

    for (let i = 1; i < values.length; i++) {
      result += values[i] / Math.pow(r, daysBetween(dates[0], dates[i]) / 365);
    }
    return result;
  };

  const irrDerivative = (rate: number) => {
    const r = rate + 1;
    let result = 0;

    for (let i = 1; i < values.length; i++) {
      const frac = daysBetween(dates[0], dates[i]) / 365;
      result -= (frac * values[i]) / Math.pow(r, frac + 1);
    }
    return result;
  };

  const epsMax = 1e-10;

  for (let i = 0; i < 100; i++) {
    const nextGuess = guess - irrResult(guess) / irrDerivative(guess);
    if (!Number.isFinite(nextGuess)) {
      break;
    }
    const settled = Math.abs(nextGuess - guess) <= epsMax;
    guess = nextGuess;
    if (settled) {
      break;
    }
  }

  // As for IRR: a rate the search never brought to zero is not a root. A rate
  // at or below -100% is not one either — discounting by it raises a negative
  // number to a fractional power, so the residual there is not even a number.
  if (guess <= -1 || !isNetPresentValueRoot(irrResult, guess, epsMax)) {
    throwExcelError(EXCEL_ERROR.num);
  }

  return guess;
}

export function excelMirr(
  valuesLike: unknown,
  financeRateLike: unknown,
  reinvestRateLike: unknown,
) {
  const values = parseExcelNumberArray(flattenExcelArgs(valuesLike));
  const financeRate = parseExcelNumber(financeRateLike);
  const reinvestRate = parseExcelNumber(reinvestRateLike);

  // Each series keeps every flow's time slot, with a zero standing in for the
  // flows of the other sign, so a flow is discounted by when it happens and
  // not by its position among flows that share its sign.
  const payments = values.map((value) => (value < 0 ? value : 0));
  const incomes = values.map((value) => (value >= 0 ? value : 0));

  if (
    !values.some((value) => value < 0) ||
    !values.some((value) => value >= 0)
  ) {
    throwExcelError(EXCEL_ERROR.div0);
  }

  // NPV discounts from period one, so (1+reinvestRate)^n carries the positives
  // forward to the final period while (1+financeRate) brings the negatives
  // back to period zero — the two ends the rate is the geometric mean between.
  const numerator =
    -excelNpv(reinvestRate, incomes) *
    Math.pow(1 + reinvestRate, values.length);
  const denominator = excelNpv(financeRate, payments) * (1 + financeRate);

  return Math.pow(numerator / denominator, 1 / (values.length - 1)) - 1;
}

/**
 * Interest accrued from issue to settlement, which a bond pays a coupon at a
 * time: `rate / frequency` per quasi-coupon period, earned in proportion to
 * the share of each period the holding covers.
 */
export function excelAccrint(
  issueLike: unknown,
  firstInterestLike: unknown,
  settlementLike: unknown,
  rateLike: unknown,
  parLike: unknown,
  frequencyLike: unknown,
  basisLike = 0,
) {
  const issue = parseExcelDate(issueLike);
  // Parsed for every basis, even though only actual/actual reads the schedule
  // it anchors: the same arguments must not be an error under one convention
  // and an answer under another.
  const firstInterest = parseExcelDate(firstInterestLike);
  const settlement = parseExcelDate(settlementLike);
  const rate = parseExcelNumber(rateLike);
  const par = parseExcelNumber(parLike);
  const frequency = parseExcelNumber(frequencyLike);
  const basis = parseExcelNumber(basisLike);

  if (![1, 2, 4].includes(frequency)) {
    throwExcelError(EXCEL_ERROR.num);
  }

  if (![0, 1, 2, 3, 4].includes(basis)) {
    throwExcelError(EXCEL_ERROR.num);
  }

  if (rate <= 0 || par <= 0 || settlement <= issue) {
    throwExcelError(EXCEL_ERROR.num);
  }

  if (basis === 1) {
    return (
      par *
      (rate / frequency) *
      accruedCoupons(issue, settlement, firstInterest, frequency)
    );
  }

  // Every other basis gives all coupon periods the same nominal length,
  // year/frequency, so each period's share is the segment's year fraction
  // times the frequency — and summed over the holding the frequency cancels,
  // leaving the whole accrual at par * rate * YEARFRAC however the schedule
  // falls. `first_interest` and `frequency` reach the answer only through the
  // period lengths, so on these bases they have nothing left to say.
  return par * rate * yearFrac(issue, settlement, basis);
}

export function excelSln(
  costLike: unknown,
  salvageLike: unknown,
  lifeLike: unknown,
) {
  const cost = parseExcelNumber(costLike);
  const salvage = parseExcelNumber(salvageLike);
  const life = parseExcelNumber(lifeLike);

  if (life === 0) {
    throwExcelError(EXCEL_ERROR.num);
  }

  return (cost - salvage) / life;
}

export function excelSyd(
  costLike: unknown,
  salvageLike: unknown,
  lifeLike: unknown,
  perLike: unknown,
) {
  const cost = parseExcelNumber(costLike);
  const salvage = parseExcelNumber(salvageLike);
  const life = parseExcelNumber(lifeLike);
  let per = parseExcelNumber(perLike);

  if (life === 0 || per < 1 || per > life) {
    throwExcelError(EXCEL_ERROR.num);
  }

  per = Math.trunc(per);
  return ((cost - salvage) * (life - per + 1) * 2) / (life * (life + 1));
}

// ═══════════════════════════════════════════════════════════════
// Financial additions
// ═══════════════════════════════════════════════════════════════

export function excelDb(
  costLike: unknown,
  salvageLike: unknown,
  lifeLike: unknown,
  periodLike: unknown,
  monthLike: unknown = 12,
) {
  const cost = parseExcelNumber(costLike);
  const salvage = parseExcelNumber(salvageLike);
  const life = parseExcelNumber(lifeLike);
  const period = Math.floor(parseExcelNumber(periodLike));
  const month = Math.floor(parseExcelNumber(monthLike));

  if (
    cost < 0 ||
    salvage < 0 ||
    life <= 0 ||
    period < 1 ||
    month < 1 ||
    month > 12
  ) {
    throwExcelError(EXCEL_ERROR.num);
  }

  const rate = +(1 - Math.pow(salvage / cost, 1 / life)).toFixed(3);
  let total = 0;
  let depn: number;
  for (let i = 1; i <= period; i++) {
    if (i === 1) {
      depn = (cost * rate * month) / 12;
    } else if (i === life + 1) {
      depn = ((cost - total) * rate * (12 - month)) / 12;
    } else {
      depn = (cost - total) * rate;
    }
    total += depn;
  }
  return depn!;
}

export function excelDdb(
  costLike: unknown,
  salvageLike: unknown,
  lifeLike: unknown,
  periodLike: unknown,
  factorLike: unknown = 2,
) {
  const cost = parseExcelNumber(costLike);
  const salvage = parseExcelNumber(salvageLike);
  const life = parseExcelNumber(lifeLike);
  const period = parseExcelNumber(periodLike);
  const factor = parseExcelNumber(factorLike);

  if (cost < 0 || salvage < 0 || life <= 0 || period < 1 || factor <= 0) {
    throwExcelError(EXCEL_ERROR.num);
  }

  let total = 0;
  let depn = 0;
  for (let i = 1; i <= period; i++) {
    depn = Math.min((cost - total) * (factor / life), cost - salvage - total);
    depn = Math.max(depn, 0);
    total += depn;
  }
  return depn;
}

export function excelIspmt(
  rateLike: unknown,
  perLike: unknown,
  nperLike: unknown,
  pvLike: unknown,
) {
  const rate = parseExcelNumber(rateLike);
  const per = parseExcelNumber(perLike);
  const nper = parseExcelNumber(nperLike);
  const pv = parseExcelNumber(pvLike);
  return pv * rate * (per / nper - 1);
}

export function excelPduration(
  rateLike: unknown,
  pvLike: unknown,
  fvLike: unknown,
) {
  const rate = parseExcelNumber(rateLike);
  const pv = parseExcelNumber(pvLike);
  const fv = parseExcelNumber(fvLike);
  if (rate <= 0 || pv <= 0 || fv <= 0) throwExcelError(EXCEL_ERROR.num);
  return (Math.log(fv) - Math.log(pv)) / Math.log(1 + rate);
}

export function excelRri(nperLike: unknown, pvLike: unknown, fvLike: unknown) {
  const nper = parseExcelNumber(nperLike);
  const pv = parseExcelNumber(pvLike);
  const fv = parseExcelNumber(fvLike);
  if (nper <= 0 || pv === 0) throwExcelError(EXCEL_ERROR.num);
  return Math.pow(fv / pv, 1 / nper) - 1;
}

export function excelDollarde(fractionalLike: unknown, fractionLike: unknown) {
  const fractional = parseExcelNumber(fractionalLike);
  const fraction = Math.floor(parseExcelNumber(fractionLike));
  if (fraction < 0) throwExcelError(EXCEL_ERROR.num);
  if (fraction === 0) throwExcelError(EXCEL_ERROR.div0);
  const sign = fractional >= 0 ? 1 : -1;
  const abs = Math.abs(fractional);
  const intPart = Math.floor(abs);
  const decPart = abs - intPart;
  const digits = Math.ceil(Math.log10(fraction));
  return sign * (intPart + (decPart * Math.pow(10, digits)) / fraction);
}

export function excelDollarfr(decimalLike: unknown, fractionLike: unknown) {
  const decimal = parseExcelNumber(decimalLike);
  const fraction = Math.floor(parseExcelNumber(fractionLike));
  if (fraction < 0) throwExcelError(EXCEL_ERROR.num);
  if (fraction === 0) throwExcelError(EXCEL_ERROR.div0);
  const sign = decimal >= 0 ? 1 : -1;
  const abs = Math.abs(decimal);
  const intPart = Math.floor(abs);
  const decPart = abs - intPart;
  const digits = Math.ceil(Math.log10(fraction));
  return sign * (intPart + (decPart * fraction) / Math.pow(10, digits));
}

export function excelDisc(
  settlementLike: unknown,
  maturityLike: unknown,
  prLike: unknown,
  redemptionLike: unknown,
  basisLike: unknown = 0,
) {
  // Called for validation only — parseExcelDate throws on a malformed date.
  parseExcelDate(settlementLike);
  parseExcelDate(maturityLike);
  const pr = parseExcelNumber(prLike);
  const redemption = parseExcelNumber(redemptionLike);
  if (pr <= 0 || redemption <= 0) throwExcelError(EXCEL_ERROR.num);
  const yf = yearFrac(settlementLike, maturityLike, Number(basisLike));
  return (redemption - pr) / redemption / yf;
}

export function excelPricedisc(
  settlementLike: unknown,
  maturityLike: unknown,
  discLike: unknown,
  redemptionLike: unknown,
  basisLike: unknown = 0,
) {
  const disc = parseExcelNumber(discLike);
  const redemption = parseExcelNumber(redemptionLike);
  const yf = yearFrac(settlementLike, maturityLike, Number(basisLike));
  return redemption * (1 - disc * yf);
}

/** The last day of the month `date` falls in. */
function lastDayOfMonth(date: Date) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
}

/** A date `months` on, clamped to the target month's last day. */
function addMonthsClamped(date: Date, months: number) {
  const shifted = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1),
  );
  shifted.setUTCDate(Math.min(date.getUTCDate(), lastDayOfMonth(shifted)));
  return shifted;
}

/**
 * A coupon date `months` from `anchor` — a known date on the bond's schedule,
 * its maturity or its first interest payment. A bond whose anchor is the last
 * day of a month pays on the last day of every month in its schedule, so
 * clamping the day number is not enough: a February 28th anchor would give an
 * August 28th where the schedule wants the 31st.
 */
function addCouponMonths(anchor: Date, months: number) {
  const shifted = new Date(
    Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + months, 1),
  );
  const endOfMonth = anchor.getUTCDate() === lastDayOfMonth(anchor);
  shifted.setUTCDate(
    endOfMonth
      ? lastDayOfMonth(shifted)
      : Math.min(anchor.getUTCDate(), lastDayOfMonth(shifted)),
  );
  return shifted;
}

/**
 * How many coupons' worth of interest accrues over `start` → `settlement` on
 * an actual/actual basis: each quasi-coupon period the holding touches
 * contributes the share of its own real length the holding covers, and the
 * shares sum. A holding that spans a period and a half earns one and a half
 * coupons, and the two halves divide by their own lengths — which is why no
 * single year fraction over the whole holding can stand in for the sum.
 *
 * The periods are the schedule `anchor` — the first interest payment — sits
 * on, extended in both directions at `frequency` a year, since a bond can be
 * issued periods before its first payment and still be accruing periods after
 * it. Every boundary is measured from the anchor rather than from the boundary
 * before it, so a month-end schedule stays on month ends instead of carrying
 * February's clamp forward.
 */
function accruedCoupons(
  start: Date,
  settlement: Date,
  anchor: Date,
  frequency: number,
) {
  const monthsPerPeriod = 12 / frequency;
  const couponDate = (periods: number) =>
    addCouponMonths(anchor, periods * monthsPerPeriod);

  // Counting whole months from the anchor names the period `start` falls in,
  // to within one: month arithmetic cannot see the day numbers, so a boundary
  // later in the month than `start` is one the count still claims. It can only
  // err in that direction — the period after the counted one begins in a later
  // month than `start`, so it can never have started already — which makes one
  // step back the whole correction.
  let periods = Math.floor(
    ((start.getUTCFullYear() - anchor.getUTCFullYear()) * 12 +
      start.getUTCMonth() -
      anchor.getUTCMonth()) /
      monthsPerPeriod,
  );
  if (couponDate(periods).getTime() > start.getTime()) periods--;

  let shares = 0;
  let periodStart = couponDate(periods);
  while (periodStart.getTime() < settlement.getTime()) {
    const periodEnd = couponDate(periods + 1);
    // The span's own ends bound the first and last periods; the ones between
    // are covered whole.
    const segmentStart =
      periodStart.getTime() > start.getTime() ? periodStart : start;
    const segmentEnd =
      periodEnd.getTime() < settlement.getTime() ? periodEnd : settlement;
    shares +=
      daysBetween(segmentStart, segmentEnd) /
      daysBetween(periodStart, periodEnd);
    periods++;
    periodStart = periodEnd;
  }

  return shares;
}

export function excelCoupdays(
  settlementLike: unknown,
  maturityLike: unknown,
  frequencyLike: unknown,
  basisLike: unknown = 0,
) {
  const frequency = Math.floor(parseExcelNumber(frequencyLike));
  const basis = Math.floor(Number(basisLike) || 0);
  if (![1, 2, 4].includes(frequency)) throwExcelError(EXCEL_ERROR.num);
  if (basis < 0 || basis > 4) throwExcelError(EXCEL_ERROR.num);

  // Validated for every basis, even though only actual/actual reads the dates:
  // the same arguments must not be an error under one convention and an answer
  // under another.
  const settlement = parseExcelDate(settlementLike);
  const maturity = parseExcelDate(maturityLike);
  const span = daysBetween(settlement, maturity);
  if (!Number.isFinite(span) || span <= 0) {
    throwExcelError(EXCEL_ERROR.num);
  }

  if (basis === 1) {
    // Actual/actual is the one convention where the answer is a real calendar
    // span, so it needs the coupon period settlement falls in. Coupon dates
    // run backwards from maturity a period at a time.
    // Every coupon date is measured from maturity, not from the one before it:
    // stepping back a period at a time from an already-clamped date would carry
    // the clamp forward, so an August 31st maturity would go February 28th and
    // then August 28th instead of back to the month's end.
    const monthsPerPeriod = 12 / frequency;
    let periods = 1;
    let periodEnd = maturity;
    let periodStart = addCouponMonths(maturity, -monthsPerPeriod);
    while (periodStart.getTime() > settlement.getTime()) {
      periods++;
      periodEnd = periodStart;
      periodStart = addCouponMonths(maturity, -periods * monthsPerPeriod);
    }
    return daysBetween(periodStart, periodEnd);
  }

  // Every other basis gives all coupon periods the same nominal length, so the
  // dates do not participate.
  return (basis === 3 ? 365 : 360) / frequency;
}

/**
 * Whether a Treasury bill matures inside a year of settlement, which the
 * TBILL family requires — the instrument they price is short-dated by
 * definition, so a longer span is an error rather than an extrapolation.
 */
function matureWithinAYear(settlement: Date, maturity: Date) {
  return maturity.getTime() <= addMonthsClamped(settlement, 12).getTime();
}

export function excelTbilleq(
  settlementLike: unknown,
  maturityLike: unknown,
  discountLike: unknown,
) {
  const settlement = parseExcelDate(settlementLike);
  const maturity = parseExcelDate(maturityLike);
  const discount = parseExcelNumber(discountLike);
  const dsm = daysBetween(settlement, maturity);
  if (dsm <= 0 || discount <= 0 || !matureWithinAYear(settlement, maturity)) {
    throwExcelError(EXCEL_ERROR.num);
  }
  return (365 * discount) / (360 - discount * dsm);
}

export function excelTbillprice(
  settlementLike: unknown,
  maturityLike: unknown,
  discountLike: unknown,
) {
  const settlement = parseExcelDate(settlementLike);
  const maturity = parseExcelDate(maturityLike);
  const discount = parseExcelNumber(discountLike);
  const dsm = daysBetween(settlement, maturity);
  if (dsm <= 0 || discount <= 0 || !matureWithinAYear(settlement, maturity)) {
    throwExcelError(EXCEL_ERROR.num);
  }
  return 100 * (1 - (discount * dsm) / 360);
}

export function excelTbillyield(
  settlementLike: unknown,
  maturityLike: unknown,
  priceLike: unknown,
) {
  const settlement = parseExcelDate(settlementLike);
  const maturity = parseExcelDate(maturityLike);
  const price = parseExcelNumber(priceLike);
  const dsm = daysBetween(settlement, maturity);
  if (dsm <= 0 || price <= 0 || !matureWithinAYear(settlement, maturity)) {
    throwExcelError(EXCEL_ERROR.num);
  }
  return ((100 - price) / price) * (360 / dsm);
}
