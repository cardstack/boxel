import {
  buildExcelDate,
  excelDatedif,
  excelDatevalue,
  excelDay,
  excelDays360,
  excelMonth,
  excelNetworkdays,
  excelNetworkdaysIntl,
  excelWeeknum,
  excelWorkday,
  excelWorkdayIntl,
  excelYear,
  yearFrac,
} from '../../formulajs/dateSerial.js';
import { parseExcelNumber } from '../../formulajs/common.js';
import {
  BareNativeFilter,
  wrapBareNativeFilters,
} from '../../jqtools/evaluate/filters/lib/nativeFilter.js';

const bareNativeFilters: Record<string, BareNativeFilter> = {
  *'DATE/3'(_input, year, month, day) {
    yield buildExcelDate(
      parseExcelNumber(year),
      parseExcelNumber(month),
      parseExcelNumber(day),
    );
  },
  *'DATEDIF/3'(_input, start, end, unit) {
    yield excelDatedif(start, end, unit);
  },
  *'DATEVALUE/1'(_input, text) {
    yield excelDatevalue(text);
  },
  *'DAY/1'(_input, value) {
    yield excelDay(value);
  },
  *'DAYS360/2'(_input, start, end) {
    yield excelDays360(start, end);
  },
  *'DAYS360/3'(_input, start, end, method) {
    yield excelDays360(start, end, method);
  },
  *'MONTH/1'(_input, value) {
    yield excelMonth(value);
  },
  *'NETWORKDAYS_INTL/2'(_input, start, end) {
    yield excelNetworkdaysIntl(start, end);
  },
  *'NETWORKDAYS_INTL/3'(_input, start, end, weekend) {
    yield excelNetworkdaysIntl(start, end, weekend);
  },
  *'NETWORKDAYS_INTL/4'(_input, start, end, weekend, holidays) {
    yield excelNetworkdaysIntl(start, end, weekend, holidays);
  },
  *'NETWORKDAYS/2'(_input, start, end) {
    yield excelNetworkdays(start, end);
  },
  *'NETWORKDAYS/3'(_input, start, end, holidays) {
    yield excelNetworkdays(start, end, holidays);
  },
  *'WEEKNUM/1'(_input, serial) {
    yield excelWeeknum(serial);
  },
  *'WEEKNUM/2'(_input, serial, returnType) {
    yield excelWeeknum(serial, returnType);
  },
  *'WORKDAY_INTL/2'(_input, start, days) {
    yield excelWorkdayIntl(start, days);
  },
  *'WORKDAY_INTL/3'(_input, start, days, weekend) {
    yield excelWorkdayIntl(start, days, weekend);
  },
  *'WORKDAY_INTL/4'(_input, start, days, weekend, holidays) {
    yield excelWorkdayIntl(start, days, weekend, holidays);
  },
  *'WORKDAY/2'(_input, start, days) {
    yield excelWorkday(start, days);
  },
  *'WORKDAY/3'(_input, start, days, holidays) {
    yield excelWorkday(start, days, holidays);
  },
  *'YEAR/1'(_input, value) {
    yield excelYear(value);
  },
  *'YEARFRAC/2'(_input, startDate, endDate) {
    yield yearFrac(startDate, endDate);
  },
  *'YEARFRAC/3'(_input, startDate, endDate, basis) {
    yield yearFrac(startDate, endDate, parseExcelNumber(basis));
  },
};

export const formulaDateSerialNativeFilters =
  wrapBareNativeFilters(bareNativeFilters);
