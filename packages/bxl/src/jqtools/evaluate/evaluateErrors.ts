import { JqEvaluateError, NotImplementedError } from '../errors.ts';
import { notDefinedHint } from './runtimeState.ts';
import { typeOf } from './utils/utils.ts';

export function notDefinedError(name: string) {
  const hint = notDefinedHint(name);
  return new JqEvaluateError(
    `'${name}' is not defined${hint ? `. ${hint}` : ''}`,
  );
}

export function notImplementedError(featureName: string) {
  return new NotImplementedError(`Feature '${featureName}' is not implemented`);
}

export function cannotIndexError(val: any, index: any) {
  return new JqEvaluateError(
    `Cannot index ${typeOf(val)} with ${typeOf(index)}`,
  );
}

export function cannotSliceError(val: any) {
  return new JqEvaluateError(`Cannot slice ${typeOf(val)}`);
}
