// The realm route an automation run's admission asks about the operations
// its automation declares: a `GET` carrying the run's token, with no body.
// The realm checks each declared operation as the run's identity, the way a
// call of it would be checked, without opening any key, and answers
// `{ data: { type: 'run-admission', id: <run id>, attributes } }` whose
// attributes are a `RunAdmissionAnswer`. Anything but the run's own token in
// its own realm is refused (403 `not-a-run`).
export const RUN_ADMISSION_PATH = '/_run-admission';

// The query parameter naming the kind of run asking (`AdmittedRunKind`). For
// a run of the automation's triggers (`trigger`), the realm also checks each
// binding's automation approval against the automation as it reads now, and
// refuses one that ended or no longer matches (`key-approval-ended`).
export const RUN_ADMISSION_KIND_PARAM = 'kind';

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
