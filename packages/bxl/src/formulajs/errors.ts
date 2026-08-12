/**
 * Excel-compatible error sentinels.
 *
 * formulajs/ is standalone — it throws `ExcelError` with an `EXCEL_ERROR.*`
 * code. Upstream Formula.js returns these as plain strings; we throw them so
 * they propagate cleanly. `src/bxl/bridge/formula-contrib-native.ts`
 * catches and rewraps as the jq-side error type.
 */
export class ExcelError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'ExcelError';
  }
}

export const EXCEL_ERROR = {
  nil: '#NULL!',
  div0: '#DIV/0!',
  value: '#VALUE!',
  ref: '#REF!',
  name: '#NAME?',
  num: '#NUM!',
  na: '#N/A',
  error: '#ERROR!',
  data: '#GETTING_DATA',
} as const;

export type ExcelErrorCode = (typeof EXCEL_ERROR)[keyof typeof EXCEL_ERROR];

export const EXCEL_ERROR_TYPE_INDEX: Record<ExcelErrorCode, number> = {
  [EXCEL_ERROR.nil]: 1,
  [EXCEL_ERROR.div0]: 2,
  [EXCEL_ERROR.value]: 3,
  [EXCEL_ERROR.ref]: 4,
  [EXCEL_ERROR.name]: 5,
  [EXCEL_ERROR.num]: 6,
  [EXCEL_ERROR.na]: 7,
  [EXCEL_ERROR.data]: 8,
  [EXCEL_ERROR.error]: 9,
};

export function throwExcelError(code: ExcelErrorCode): never {
  throw new ExcelError(code);
}

export function isExcelErrorCode(value: unknown): value is ExcelErrorCode {
  return (
    typeof value === 'string' &&
    Object.values(EXCEL_ERROR).includes(value as ExcelErrorCode)
  );
}

export function asExcelErrorMessage(error: unknown): string {
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}
