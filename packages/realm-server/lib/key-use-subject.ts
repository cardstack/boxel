import type {
  CallApiUseSubject,
  OperationFailure,
} from '@cardstack/runtime-common/card-operations';

// Which share or personal key a refusal raised while a `callApi`'s slots are
// being filled came from, so the refusal is recorded against it
// (`lib/key-uses.ts`). The refusal a caller receives carries none of this: a
// reader isn't told which of a realm's shares refused them.
const refusedBy = new WeakMap<OperationFailure, CallApiUseSubject>();

// Marks `failure` as raised by `subject`, and answers it, for a throw site to
// write `throw refusedFrom(subject, failure)`.
export function refusedFrom(
  subject: CallApiUseSubject,
  failure: OperationFailure,
): OperationFailure {
  refusedBy.set(failure, subject);
  return failure;
}

export function subjectOfRefusal(
  failure: OperationFailure,
): CallApiUseSubject | undefined {
  return refusedBy.get(failure);
}
