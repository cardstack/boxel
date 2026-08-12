import {
  excelAccrint,
  excelCoupdays,
  excelCumipmt,
  excelCumprinc,
  excelDb,
  excelDdb,
  excelDisc,
  excelDollarde,
  excelDollarfr,
  excelEffect,
  excelFv,
  excelFvSchedule,
  excelIpmt,
  excelIrr,
  excelIspmt,
  excelMirr,
  excelNominal,
  excelNper,
  excelNpv,
  excelPduration,
  excelPmt,
  excelPpmt,
  excelPricedisc,
  excelPv,
  excelRate,
  excelRri,
  excelSln,
  excelSyd,
  excelTbilleq,
  excelTbillprice,
  excelTbillyield,
  excelXirr,
  excelXnpv,
} from '../../formulajs/financial.js';
import { EXCEL_ERROR, throwExcelError } from '../../formulajs/errors.js';
import { parseExcelString } from '../../formulajs/common.js';
import {
  BareNativeFilter,
  wrapBareNativeFilters,
} from '../../jqtools/evaluate/filters/lib/nativeFilter.js';

// IRR/NPV/XIRR/XNPV accept rows-of-objects and project a column out by key.
// Mirror of the helper that lives in formula-contrib-native.ts; duplicated
// here so this lazy chunk doesn't have to import the eager module back.
function asRowObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function expectRows(rowsLike: unknown): Record<string, unknown>[] {
  if (!Array.isArray(rowsLike)) {
    throwExcelError(EXCEL_ERROR.value);
  }

  return rowsLike.map((row) => asRowObject(row));
}

function colValues(rowsLike: unknown, keyLike: unknown) {
  const rows = expectRows(rowsLike);
  const key = parseExcelString(keyLike);
  return rows.map((row) =>
    Object.prototype.hasOwnProperty.call(row, key) ? row[key] : null,
  );
}

const bareNativeFilters: Record<string, BareNativeFilter> = {
  *'ACCRINT/6'(_input, issue, firstInterest, settlement, rate, par, frequency) {
    yield excelAccrint(issue, firstInterest, settlement, rate, par, frequency);
  },
  *'ACCRINT/7'(
    _input,
    issue,
    firstInterest,
    settlement,
    rate,
    par,
    frequency,
    basis,
  ) {
    yield excelAccrint(
      issue,
      firstInterest,
      settlement,
      rate,
      par,
      frequency,
      basis,
    );
  },
  *'COUPDAYS/3'(_input, settlement, maturity, frequency) {
    yield excelCoupdays(settlement, maturity, frequency);
  },
  *'COUPDAYS/4'(_input, settlement, maturity, frequency, basis) {
    yield excelCoupdays(settlement, maturity, frequency, basis);
  },
  *'CUMIPMT/6'(_input, rate, nper, pv, startPeriod, endPeriod, type) {
    yield excelCumipmt(rate, nper, pv, startPeriod, endPeriod, type);
  },
  *'CUMPRINC/6'(_input, rate, nper, pv, startPeriod, endPeriod, type) {
    yield excelCumprinc(rate, nper, pv, startPeriod, endPeriod, type);
  },
  *'DB/4'(_input, cost, salvage, life, period) {
    yield excelDb(cost, salvage, life, period);
  },
  *'DB/5'(_input, cost, salvage, life, period, month) {
    yield excelDb(cost, salvage, life, period, month);
  },
  *'DDB/4'(_input, cost, salvage, life, period) {
    yield excelDdb(cost, salvage, life, period);
  },
  *'DDB/5'(_input, cost, salvage, life, period, factor) {
    yield excelDdb(cost, salvage, life, period, factor);
  },
  *'DISC/4'(_input, settlement, maturity, pr, redemption) {
    yield excelDisc(settlement, maturity, pr, redemption);
  },
  *'DISC/5'(_input, settlement, maturity, pr, redemption, basis) {
    yield excelDisc(settlement, maturity, pr, redemption, basis);
  },
  *'DOLLARDE/2'(_input, fractional, fraction) {
    yield excelDollarde(fractional, fraction);
  },
  *'DOLLARFR/2'(_input, decimal, fraction) {
    yield excelDollarfr(decimal, fraction);
  },
  *'EFFECT/2'(_input, nominalRate, npery) {
    yield excelEffect(nominalRate, npery);
  },
  *'FV/3'(_input, rate, nper, payment) {
    yield excelFv(rate, nper, payment);
  },
  *'FV/4'(_input, rate, nper, payment, value) {
    yield excelFv(rate, nper, payment, value);
  },
  *'FV/5'(_input, rate, nper, payment, value, type) {
    yield excelFv(rate, nper, payment, value, type);
  },
  *'FVSCHEDULE/2'(_input, principal, schedule) {
    yield excelFvSchedule(principal, schedule);
  },
  *'IPMT/4'(_input, rate, per, nper, pv) {
    yield excelIpmt(rate, per, nper, pv);
  },
  *'IPMT/5'(_input, rate, per, nper, pv, fv) {
    yield excelIpmt(rate, per, nper, pv, fv);
  },
  *'IPMT/6'(_input, rate, per, nper, pv, fv, type) {
    yield excelIpmt(rate, per, nper, pv, fv, type);
  },
  *'IRR_BY/2'(_input, rows, valueKey) {
    yield excelIrr(colValues(rows, valueKey));
  },
  *'IRR_BY/3'(_input, rows, valueKey, guess) {
    yield excelIrr(colValues(rows, valueKey), guess);
  },
  *'IRR/1'(_input, values) {
    yield excelIrr(values);
  },
  *'IRR/2'(_input, values, guess) {
    yield excelIrr(values, guess);
  },
  *'ISPMT/4'(_input, rate, per, nper, pv) {
    yield excelIspmt(rate, per, nper, pv);
  },
  *'MIRR/3'(_input, values, financeRate, reinvestRate) {
    yield excelMirr(values, financeRate, reinvestRate);
  },
  *'NOMINAL/2'(_input, effectRate, npery) {
    yield excelNominal(effectRate, npery);
  },
  *'NPER/3'(_input, rate, pmt, pv) {
    yield excelNper(rate, pmt, pv);
  },
  *'NPER/4'(_input, rate, pmt, pv, fv) {
    yield excelNper(rate, pmt, pv, fv);
  },
  *'NPER/5'(_input, rate, pmt, pv, fv, type) {
    yield excelNper(rate, pmt, pv, fv, type);
  },
  *'NPV_BY/3'(_input, rate, rows, valueKey) {
    yield excelNpv(rate, colValues(rows, valueKey));
  },
  *'NPV/2'(_input, rate, values) {
    yield excelNpv(rate, values);
  },
  *'PDURATION/3'(_input, rate, pv, fv) {
    yield excelPduration(rate, pv, fv);
  },
  *'PMT/3'(_input, rate, nper, pv) {
    yield excelPmt(rate, nper, pv);
  },
  *'PMT/4'(_input, rate, nper, pv, fv) {
    yield excelPmt(rate, nper, pv, fv);
  },
  *'PMT/5'(_input, rate, nper, pv, fv, type) {
    yield excelPmt(rate, nper, pv, fv, type);
  },
  *'PPMT/4'(_input, rate, per, nper, pv) {
    yield excelPpmt(rate, per, nper, pv);
  },
  *'PPMT/5'(_input, rate, per, nper, pv, fv) {
    yield excelPpmt(rate, per, nper, pv, fv);
  },
  *'PPMT/6'(_input, rate, per, nper, pv, fv, type) {
    yield excelPpmt(rate, per, nper, pv, fv, type);
  },
  *'PRICEDISC/4'(_input, settlement, maturity, disc, redemption) {
    yield excelPricedisc(settlement, maturity, disc, redemption);
  },
  *'PRICEDISC/5'(_input, settlement, maturity, disc, redemption, basis) {
    yield excelPricedisc(settlement, maturity, disc, redemption, basis);
  },
  *'PV/3'(_input, rate, nper, pmt) {
    yield excelPv(rate, nper, pmt);
  },
  *'PV/4'(_input, rate, nper, pmt, fv) {
    yield excelPv(rate, nper, pmt, fv);
  },
  *'PV/5'(_input, rate, nper, pmt, fv, type) {
    yield excelPv(rate, nper, pmt, fv, type);
  },
  *'RATE/3'(_input, nper, pmt, pv) {
    yield excelRate(nper, pmt, pv);
  },
  *'RATE/4'(_input, nper, pmt, pv, fv) {
    yield excelRate(nper, pmt, pv, fv);
  },
  *'RATE/5'(_input, nper, pmt, pv, fv, type) {
    yield excelRate(nper, pmt, pv, fv, type);
  },
  *'RATE/6'(_input, nper, pmt, pv, fv, type, guess) {
    yield excelRate(nper, pmt, pv, fv, type, guess);
  },
  *'RRI/3'(_input, nper, pv, fv) {
    yield excelRri(nper, pv, fv);
  },
  *'SLN/3'(_input, cost, salvage, life) {
    yield excelSln(cost, salvage, life);
  },
  *'SYD/4'(_input, cost, salvage, life, per) {
    yield excelSyd(cost, salvage, life, per);
  },
  *'TBILLEQ/3'(_input, settlement, maturity, discount) {
    yield excelTbilleq(settlement, maturity, discount);
  },
  *'TBILLPRICE/3'(_input, settlement, maturity, discount) {
    yield excelTbillprice(settlement, maturity, discount);
  },
  *'TBILLYIELD/3'(_input, settlement, maturity, price) {
    yield excelTbillyield(settlement, maturity, price);
  },
  *'XIRR_BY/3'(_input, rows, valueKey, dateKey) {
    yield excelXirr(colValues(rows, valueKey), colValues(rows, dateKey));
  },
  *'XIRR_BY/4'(_input, rows, valueKey, dateKey, guess) {
    yield excelXirr(colValues(rows, valueKey), colValues(rows, dateKey), guess);
  },
  *'XIRR/2'(_input, values, dates) {
    yield excelXirr(values, dates);
  },
  *'XIRR/3'(_input, values, dates, guess) {
    yield excelXirr(values, dates, guess);
  },
  *'XNPV_BY/4'(_input, rate, rows, valueKey, dateKey) {
    yield excelXnpv(rate, colValues(rows, valueKey), colValues(rows, dateKey));
  },
  *'XNPV/3'(_input, rate, values, dates) {
    yield excelXnpv(rate, values, dates);
  },
};

export const formulaFinancialNativeFilters =
  wrapBareNativeFilters(bareNativeFilters);
