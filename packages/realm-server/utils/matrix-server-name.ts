import { parseMatrixFederationAllowlist } from '@cardstack/runtime-common/matrix-server-name';

// The name of the Matrix server the paired homeserver serves, from
// `MATRIX_SERVER_NAME`: the `:server` suffix of every user id it issues, and
// what a bare localpart is qualified with (ADR 004 §1.2). It is configured
// rather than derived from `MATRIX_URL`, because Matrix delegation lets the
// name differ from the homeserver's hostname. The development and test
// homeservers are named `localhost`, which is the value when the variable is
// unset. A deployment names its server in the start scripts of both the realm
// server and the worker. `MatrixClient` refuses to log in when the homeserver
// issues a user id on another server, so a wrong value fails at the first
// login. That check does not stop a user being named first: a worker names
// each job's realm user with this value before it logs in.
export function matrixServerNameFromEnv(): string {
  return process.env.MATRIX_SERVER_NAME || 'localhost';
}

// The homeservers this realm server verifies OpenID tokens with besides the
// paired one, from `MATRIX_FEDERATION_ALLOWLIST` (comma-separated server
// names). Unset or empty means none: a session request naming any other
// server is refused before the server is looked up (ADR 004 §1.3).
export function matrixFederationAllowlistFromEnv(): string[] {
  return parseMatrixFederationAllowlist(
    process.env.MATRIX_FEDERATION_ALLOWLIST,
  );
}
