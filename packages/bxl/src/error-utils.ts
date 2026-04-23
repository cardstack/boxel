import { ReadableSyntaxError } from './bxl/compiler/readable-syntax.js';
import { NativeJqDialectError } from './bxl/bridge/native.js';

export type BxlErrorPhase =
  | 'compile'
  | 'tokenize'
  | 'parse'
  | 'evaluate'
  | 'prepare'
  | 'runtime'
  | 'unknown';

export interface BxlErrorRecord {
  phase: BxlErrorPhase;
  name: string;
  message: string;
  stack?: string;
}

export type BxlSafeResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: BxlErrorRecord };

export function toBxlErrorRecord(
  error: unknown,
  fallbackPhase: BxlErrorPhase = 'unknown',
): BxlErrorRecord {
  if (error instanceof NativeJqDialectError) {
    return {
      phase: error.phase,
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  if (error instanceof ReadableSyntaxError) {
    return {
      phase: 'compile',
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  if (error instanceof Error) {
    return {
      phase: fallbackPhase,
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    phase: fallbackPhase,
    name: 'Error',
    message: String(error),
  };
}
