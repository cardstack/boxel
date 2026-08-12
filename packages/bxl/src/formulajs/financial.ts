import { EXCEL_ERROR, throwExcelError } from './errors.js';
import {
  daysBetween,
  parseExcelDate,
  parseExcelDateArray,
  yearFrac,
} from './dateSerial.js';
import { flattenExcelArgs, parseExcelNumber, parseExcelNumberArray } from './common.js';

function parseCashFlows(values: unknown) {
  const parsed = parseExcelNumberArray(flattenExcelArgs(values));
  const positive = parsed.some((value) => value > 0);
  const negative = parsed.some((value) => value < 0);

  if (!positive || !negative) {
    throwExcelError(EXCEL_ERROR.num);
  }

  return parsed;
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
      ? ((fv * rate) / (term - 1) + (pv * rate) / (1 - 1 / term)) /
        (1 + rate)
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

  return excelPmt(rate, nper, pv, fv, type) - excelIpmt(rate, per, nper, pv, fv, type);
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

    const nextGuess = guess - resultValue / derivative;
    if (Math.abs(nextGuess - guess) <= epsMax && Math.abs(resultValue) <= epsMax) {
      return nextGuess;
    }
    guess = Math.max(-0.99999999, Math.min(nextGuess, 1000));
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
    result += values[i] / Math.pow(1 + rate, daysBetween(dates[0], dates[i]) / 365);
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
    const resultValue = irrResult(guess);
    const nextGuess = guess - resultValue / irrDerivative(guess);

    if (
      Math.abs(nextGuess - guess) <= epsMax &&
      Math.abs(resultValue) <= epsMax
    ) {
      return nextGuess;
    }

    guess = nextGuess;
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

  const payments = values.filter((value) => value < 0);
  const incomes = values.filter((value) => value >= 0);

  if (payments.length === 0 || incomes.length === 0) {
    throwExcelError(EXCEL_ERROR.div0);
  }

  const numerator =
    -excelNpv(reinvestRate, incomes) * Math.pow(1 + reinvestRate, values.length - 1);
  const denominator = excelNpv(financeRate, payments) * (1 + financeRate);

  return Math.pow(numerator / denominator, 1 / (values.length - 1)) - 1;
}

export function excelAccrint(
  issueLike: unknown,
  _firstInterestLike: unknown,
  settlementLike: unknown,
  rateLike: unknown,
  parLike: unknown,
  frequencyLike: unknown,
  basisLike = 0,
) {
  const issue = parseExcelDate(issueLike);
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

  return par * rate * yearFrac(issue, settlement, basis);
}

export function excelSln(costLike: unknown, salvageLike: unknown, lifeLike: unknown) {
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
  costLike: unknown, salvageLike: unknown, lifeLike: unknown,
  periodLike: unknown, monthLike: unknown = 12,
) {
  const cost = parseExcelNumber(costLike);
  const salvage = parseExcelNumber(salvageLike);
  const life = parseExcelNumber(lifeLike);
  const period = Math.floor(parseExcelNumber(periodLike));
  const month = Math.floor(parseExcelNumber(monthLike));

  if (cost < 0 || salvage < 0 || life <= 0 || period < 1 || month < 1 || month > 12) {
    throwExcelError(EXCEL_ERROR.num);
  }

  const rate = +(1 - Math.pow(salvage / cost, 1 / life)).toFixed(3);
  let total = 0;
  let depn: number;
  for (let i = 1; i <= period; i++) {
    if (i === 1) {
      depn = cost * rate * month / 12;
    } else if (i === life + 1) {
      depn = (cost - total) * rate * (12 - month) / 12;
    } else {
      depn = (cost - total) * rate;
    }
    total += depn;
  }
  return depn!;
}

export function excelDdb(
  costLike: unknown, salvageLike: unknown, lifeLike: unknown,
  periodLike: unknown, factorLike: unknown = 2,
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

export function excelIspmt(rateLike: unknown, perLike: unknown, nperLike: unknown, pvLike: unknown) {
  const rate = parseExcelNumber(rateLike);
  const per = parseExcelNumber(perLike);
  const nper = parseExcelNumber(nperLike);
  const pv = parseExcelNumber(pvLike);
  return pv * rate * (per / nper - 1);
}

export function excelPduration(rateLike: unknown, pvLike: unknown, fvLike: unknown) {
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
  return sign * (intPart + decPart * Math.pow(10, digits) / fraction);
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
  return sign * (intPart + decPart * fraction / Math.pow(10, digits));
}

export function excelDisc(
  settlementLike: unknown, maturityLike: unknown,
  prLike: unknown, redemptionLike: unknown, basisLike: unknown = 0,
) {
  const _settlement = parseExcelDate(settlementLike);
  const _maturity = parseExcelDate(maturityLike);
  const pr = parseExcelNumber(prLike);
  const redemption = parseExcelNumber(redemptionLike);
  if (pr <= 0 || redemption <= 0) throwExcelError(EXCEL_ERROR.num);
  const yf = yearFrac(settlementLike, maturityLike, Number(basisLike));
  return (redemption - pr) / redemption / yf;
}

export function excelPricedisc(
  settlementLike: unknown, maturityLike: unknown,
  discLike: unknown, redemptionLike: unknown, basisLike: unknown = 0,
) {
  const disc = parseExcelNumber(discLike);
  const redemption = parseExcelNumber(redemptionLike);
  const yf = yearFrac(settlementLike, maturityLike, Number(basisLike));
  return redemption * (1 - disc * yf);
}

export function excelCoupdays(
  settlementLike: unknown, maturityLike: unknown,
  frequencyLike: unknown, basisLike: unknown = 0,
) {
  const frequency = Math.floor(parseExcelNumber(frequencyLike));
  const basis = Math.floor(Number(basisLike) || 0);
  if (![1, 2, 4].includes(frequency)) throwExcelError(EXCEL_ERROR.num);
  // Simplified: return days in coupon period based on basis
  switch (basis) {
    case 0: case 4: return 360 / frequency;
    case 1: return 365 / frequency; // approximate for actual/actual
    case 2: return 360 / frequency;
    case 3: return 365 / frequency;
    default: throwExcelError(EXCEL_ERROR.num);
  }
}

export function excelTbilleq(settlementLike: unknown, maturityLike: unknown, discountLike: unknown) {
  const settlement = parseExcelDate(settlementLike);
  const maturity = parseExcelDate(maturityLike);
  const discount = parseExcelNumber(discountLike);
  const dsm = daysBetween(settlement, maturity);
  if (dsm <= 0 || discount <= 0) throwExcelError(EXCEL_ERROR.num);
  return (365 * discount) / (360 - discount * dsm);
}

export function excelTbillprice(settlementLike: unknown, maturityLike: unknown, discountLike: unknown) {
  const settlement = parseExcelDate(settlementLike);
  const maturity = parseExcelDate(maturityLike);
  const discount = parseExcelNumber(discountLike);
  const dsm = daysBetween(settlement, maturity);
  if (dsm <= 0 || discount <= 0) throwExcelError(EXCEL_ERROR.num);
  return 100 * (1 - discount * dsm / 360);
}

export function excelTbillyield(settlementLike: unknown, maturityLike: unknown, priceLike: unknown) {
  const settlement = parseExcelDate(settlementLike);
  const maturity = parseExcelDate(maturityLike);
  const price = parseExcelNumber(priceLike);
  const dsm = daysBetween(settlement, maturity);
  if (dsm <= 0 || price <= 0) throwExcelError(EXCEL_ERROR.num);
  return ((100 - price) / price) * (360 / dsm);
}
