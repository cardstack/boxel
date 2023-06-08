export interface MatrixError {
  data: {
    errcode: string;
    error: string;
  };
  httpStatus: number;
  errcode: string;
}
export const eventDebounceMs = 300;

export function isMatrixError(err: any): err is MatrixError {
  return (
    typeof err === 'object' &&
    'data' in err &&
    typeof err.data === 'object' &&
    'errcode' in err.data &&
    typeof err.data.errcode === 'string' &&
    'error' in err.data &&
    typeof err.data.error === 'string' &&
    'httpStatus' in err &&
    typeof err.httpStatus === 'number' &&
    'errcode' in err &&
    typeof err.errcode === 'string'
  );
}
