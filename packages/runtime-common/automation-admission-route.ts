// The realm route an automation run's admission asks about the operations
// its automation declares: a `GET` carrying the run's token, with no body.
// The realm checks each declared operation as the run's identity, the way a
// call of it would be checked, without opening any key, and answers
// `{ data: { type: 'run-admission', id: <run id>, attributes } }` whose
// attributes are a `RunAdmissionAnswer`. Anything but the run's own token in
// its own realm is refused (403 `not-a-run`).
export const RUN_ADMISSION_PATH = '/_run-admission';

export interface RunAdmissionAnswer {
  // The first refusal, or null when every declared operation would be
  // served.
  refusal: {
    code: string;
    detail: string;
    // The declared operation refused, and the type it is declared on, when
    // the refusal is about one.
    operation?: string;
    targetType?: { module: string; name: string };
  } | null;
  // How many declared operations were checked, when none was refused.
  operations?: number;
}
