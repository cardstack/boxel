// Who owns the evaluations workspace and writes the result cards, and where
// the workspace is created. The eval users that drive the browsers are
// separate (EVAL_USERS in the spec).

export const REALM_SERVER_URL =
  process.env.EVAL_REALM_SERVER_URL ?? 'https://localhost:4201';
export const WRITER_USER = process.env.EVAL_WRITER_USER ?? 'user';
export const WRITER_PASSWORD = process.env.EVAL_WRITER_PASSWORD ?? 'password';
