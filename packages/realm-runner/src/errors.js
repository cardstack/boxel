export class RealmRunnerError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'RealmRunnerError';
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

export function errorDetails(error) {
  if (error instanceof RealmRunnerError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
    };
  }
  return {
    code: 'RUNTIME_ERROR',
    message: error instanceof Error ? error.message : String(error),
  };
}
