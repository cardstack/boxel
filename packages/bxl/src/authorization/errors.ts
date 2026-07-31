export type AuthorizationErrorKind =
  | 'invalid-model'
  | 'invalid-expression'
  | 'invalid-identifier'
  | 'invalid-tuple'
  | 'unknown-type'
  | 'unknown-relation'
  | 'unsafe-expression'
  | 'unsupported-expression'
  | 'resolution-depth-exceeded'
  | 'evaluation-limit-exceeded';

export interface AuthorizationErrorRecord {
  kind: AuthorizationErrorKind;
  message: string;
  path?: string;
  cause?: unknown;
}

export type AuthorizationSafeResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: AuthorizationErrorRecord };

export class AuthorizationError extends Error {
  readonly kind: AuthorizationErrorKind;
  readonly path?: string;

  constructor(
    kind: AuthorizationErrorKind,
    message: string,
    options: { path?: string; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AuthorizationError';
    this.kind = kind;
    this.path = options.path;
  }

  toRecord(): AuthorizationErrorRecord {
    return {
      kind: this.kind,
      message: this.message,
      ...(this.path === undefined ? {} : { path: this.path }),
      ...(this.cause === undefined ? {} : { cause: this.cause }),
    };
  }
}

export function toAuthorizationErrorRecord(error: unknown): AuthorizationErrorRecord {
  if (error instanceof AuthorizationError) return error.toRecord();
  return {
    kind: 'invalid-model',
    message: error instanceof Error ? error.message : String(error),
    cause: error,
  };
}
